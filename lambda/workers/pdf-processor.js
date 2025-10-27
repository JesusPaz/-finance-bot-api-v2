/**
 * Worker Lambda: Procesa PDFs subidos a S3
 * - Desbloquea PDFs con qpdf
 * - Extrae texto con pdftotext
 * - Parsea transacciones
 * - Guarda en DynamoDB con validación de duplicados
 */

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, BatchWriteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { extractTextFromPDF } = require('../shared/pdf-text-extractor');
const { parseTransactions } = require('../shared/transaction-parser');
const { createLogger } = require('../shared/logger');
const { 
  updateDocumentStatus, 
  markDocumentFailed, 
  markPasswordError, 
  markDocumentCompleted 
} = require('../shared/document-tracker');
const { DocumentStatus, ErrorType } = require('../shared/document-status');

const s3 = new S3Client();
const dynamoClient = new DynamoDBClient();
const dynamo = DynamoDBDocumentClient.from(dynamoClient);

const logger = createLogger('pdf-processor');

const TABLE_NAME = process.env.TABLE_NAME;
const PASSWORDS_TABLE = process.env.PASSWORDS_TABLE_NAME;

/**
 * Handler principal
 */
exports.handler = async (event) => {
  logger.info('Worker iniciado', {
    records: event.Records?.length || 0,
    bodyPreview: event.body?.substring(0, 200)
  });

  try {
    for (const record of event.Records) {
      await processRecord(record);
    }

    logger.info('Procesamiento completado exitosamente');
    return { statusCode: 200, body: 'OK' };

  } catch (error) {
    logger.error('Error en handler', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
};

/**
 * Procesa un registro de SQS
 */
async function processRecord(record) {
  try {
    // Parse S3 event desde SQS
    const sqsBody = JSON.parse(record.body);
    const s3Event = sqsBody.Records?.[0];

    if (!s3Event) {
      logger.error('No se encontró evento S3 en el mensaje SQS');
      return;
    }

    const bucket = s3Event.s3.bucket.name;
    const key = decodeURIComponent(s3Event.s3.object.key.replace(/\+/g, ' '));
    const eventName = s3Event.eventName;
    const sizeKB = (s3Event.s3.object.size / 1024).toFixed(2);

    logger.info('Evento S3 parseado', { bucket, key, eventName, sizeKB });

    // Solo procesar PDFs en la carpeta pdfs/
    if (!key.startsWith('pdfs/')) {
      logger.info('Archivo no está en carpeta pdfs/, ignorando');
      return;
    }

    logger.info('Procesando PDF', { bucket, key });

    // Obtener metadata del PDF
    const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(getCommand);
    const metadata = response.Metadata || {};

    const auth0UserId = metadata['auth0-user-id'];
    const userEmail = metadata['user-email'];
    const documentId = metadata['document-id']; // UUID del documento
    const documentType = metadata['document-type'] || 'default';
    const hasPassword = metadata['has-password'] === 'true';
    const filename = metadata.filename || key.split('/').pop();
    const fileSize = s3Event.s3.object.size;

    logger.info('Metadata obtenida', {
      contentType: response.ContentType,
      auth0UserId,
      documentId,
      userEmail,
      documentType,
      hasPassword,
      fileSize
    });

    if (!auth0UserId) {
      logger.error('auth0UserId no encontrado en metadata del PDF');
      throw new Error('auth0UserId es requerido en metadata');
    }

    if (!documentId) {
      logger.error('documentId no encontrado en metadata del PDF');
      throw new Error('documentId es requerido en metadata');
    }

    const processingStartTime = Date.now();

    // 🔄 ACTUALIZAR ESTADO: PROCESSING
    await updateDocumentStatus(auth0UserId, documentId, DocumentStatus.PROCESSING, {
      fileSize,
      processingStartedAt: new Date().toISOString()
    });

    // **BUSCAR CONTRASEÑA EN DYNAMODB**
    let password = null;
    if (hasPassword) {
      logger.info('🔐 Buscando contraseña en DynamoDB...');
      
      try {
        const getPasswordCommand = new GetCommand({
          TableName: PASSWORDS_TABLE,
          Key: {
            auth0UserId: auth0UserId,
            documentType: documentType
          }
        });

        const passwordResult = await dynamo.send(getPasswordCommand);
        
        if (passwordResult.Item) {
          password = passwordResult.Item.password;
          logger.info('✅ Contraseña encontrada en DynamoDB');
        } else {
          logger.warn('⚠️  Contraseña no encontrada para este tipo de documento');
        }
      } catch (dbError) {
        logger.error('❌ Error buscando contraseña en DynamoDB', { error: dbError.message });
      }
    }

    // **PASO 1: Extraer texto del PDF**
    logger.info('🔍 Iniciando extracción de texto...');
    
    // 🔄 ACTUALIZAR ESTADO: DECRYPTING (si tiene contraseña) o EXTRACTING_TEXT
    if (hasPassword && password) {
      await updateDocumentStatus(auth0UserId, documentId, DocumentStatus.DECRYPTING);
    } else {
      await updateDocumentStatus(auth0UserId, documentId, DocumentStatus.EXTRACTING_TEXT);
    }

    let text;
    try {
      text = await extractTextFromPDF(bucket, key, {
        password: password // Usar contraseña de DynamoDB
      });
    } catch (extractError) {
      logger.error('❌ Error extrayendo texto del PDF', { error: extractError.message });
      
      // Determinar tipo de error
      if (extractError.message.includes('password') || extractError.message.includes('contraseña')) {
        await markPasswordError(auth0UserId, documentId, `Error de contraseña: ${extractError.message}`);
      } else {
        await markDocumentFailed(auth0UserId, documentId, ErrorType.EXTRACTION_FAILED, extractError.message);
      }
      
      throw extractError;
    }

    logger.info('✅ Texto extraído', {
      lengthChars: text.length,
      lengthLines: text.split('\n').length
    });

    // **PASO 2: Parsear transacciones**
    logger.info('🔍 Parseando transacciones...');

    // 🔄 ACTUALIZAR ESTADO: PARSING
    await updateDocumentStatus(auth0UserId, documentId, DocumentStatus.PARSING);

    // Generar ID único para este documento
    const sourceDocumentId = documentId; // Usar el documentId como sourceDocumentId

    let transactions;
    try {
      transactions = parseTransactions(text, {
        sourceDocumentId,
        auth0UserId, // Usar auth0UserId en lugar de userId
        userEmail,
        documentType
      });

      logger.info('✅ Transacciones parseadas', {
        count: transactions.length,
        debits: transactions.filter(t => t.type === 'DEBIT').length,
        credits: transactions.filter(t => t.type === 'CREDIT').length
      });

      if (transactions.length === 0) {
        logger.warn('⚠️  No se encontraron transacciones en el PDF');
        await markDocumentFailed(auth0UserId, documentId, ErrorType.NO_TRANSACTIONS_FOUND, 'No se encontraron transacciones en el documento');
        throw new Error('No se encontraron transacciones');
      }
    } catch (parseError) {
      logger.error('❌ Error parseando transacciones', { error: parseError.message });
      if (parseError.message !== 'No se encontraron transacciones') {
        await markDocumentFailed(auth0UserId, documentId, ErrorType.PARSING_FAILED, parseError.message);
      }
      throw parseError;
    }

    // **PASO 3: Guardar en DynamoDB con validación de duplicados**
    logger.info('💾 Guardando transacciones en DynamoDB...');

    let result;
    try {
      result = await saveTransactions(transactions);

      logger.info('✅ Transacciones guardadas', {
        saved: result.saved,
        duplicates: result.duplicates,
        errors: result.errors
      });
    } catch (saveError) {
      logger.error('❌ Error guardando transacciones', { error: saveError.message });
      await markDocumentFailed(auth0UserId, documentId, ErrorType.DYNAMODB_ERROR, saveError.message);
      throw saveError;
    }

    // **PASO 4: Marcar como COMPLETADO**
    const processingTimeMs = Date.now() - processingStartTime;
    
    await markDocumentCompleted(auth0UserId, documentId, transactions.length, processingTimeMs);

    logger.info('✅ PDF procesado exitosamente', {
      key,
      documentId,
      transactionsExtracted: transactions.length,
      transactionsSaved: result.saved,
      transactionsDuplicated: result.duplicates,
      processingTimeMs
    });

  } catch (error) {
    logger.error('❌ Error procesando registro', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Guarda transacciones en DynamoDB con validación de duplicados
 */
async function saveTransactions(transactions) {
  let saved = 0;
  let duplicates = 0;
  let errors = 0;

  for (const transaction of transactions) {
    try {
      // Verificar si ya existe (usando transactionId como hash único)
      const getCommand = new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          auth0UserId: transaction.auth0UserId, // Cambiar a auth0UserId
          transactionId: transaction.transactionId
        }
      });

      const existing = await dynamo.send(getCommand);

      if (existing.Item) {
        logger.debug('Transacción ya existe (duplicada)', {
          transactionId: transaction.transactionId,
          date: transaction.date,
          merchant: transaction.merchant
        });
        duplicates++;
        continue;
      }

      // Guardar transacción nueva
      const putCommand = new PutCommand({
        TableName: TABLE_NAME,
        Item: transaction,
        ConditionExpression: 'attribute_not_exists(transactionId)' // Extra safety
      });

      await dynamo.send(putCommand);
      
      logger.debug('Transacción guardada', {
        transactionId: transaction.transactionId,
        date: transaction.date,
        merchant: transaction.merchant,
        amount: transaction.amount
      });

      saved++;

    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Duplicado detectado por ConditionExpression
        duplicates++;
      } else {
        logger.error('Error guardando transacción', {
          error: error.message,
          transaction: transaction.transactionId
        });
        errors++;
      }
    }
  }

  return { saved, duplicates, errors };
}
