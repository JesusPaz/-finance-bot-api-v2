/**
 * Worker Lambda: Procesa PDFs subidos a S3
 * - Desbloquea PDFs con qpdf
 * - Extrae texto con pdftotext
 * - Parsea transacciones
 * - Guarda en DynamoDB con validación de duplicados
 */

// ✅ Importar X-Ray primero
const AWSXRay = require('aws-xray-sdk-core');

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

// ✅ Instrumentar clientes AWS con X-Ray
const s3 = AWSXRay.captureAWSv3Client(new S3Client());
const dynamoClient = AWSXRay.captureAWSv3Client(new DynamoDBClient());
const dynamo = DynamoDBDocumentClient.from(dynamoClient);

const logger = createLogger('pdf-processor');

const TABLE_NAME = process.env.TABLE_NAME;
const PASSWORDS_TABLE = process.env.PASSWORDS_TABLE_NAME;

/**
 * Handler principal
 */
exports.handler = async (event) => {
  logger.info('🚀 [DEBUG] ===== WORKER LAMBDA INICIADO =====', {
    records: event.Records?.length || 0,
    timestamp: new Date().toISOString()
  });

  try {
    for (let i = 0; i < event.Records.length; i++) {
      const record = event.Records[i];
      logger.info(`📋 [DEBUG] Procesando record ${i + 1}/${event.Records.length}`);
      await processRecord(record);
      logger.info(`✅ [DEBUG] Record ${i + 1}/${event.Records.length} procesado exitosamente`);
    }

    logger.info('🎉 [DEBUG] ===== WORKER COMPLETADO EXITOSAMENTE =====');
    return { statusCode: 200, body: 'OK' };

  } catch (error) {
    logger.error('💥 [DEBUG] ===== ERROR FATAL EN HANDLER =====', { 
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
  logger.info('📥 [DEBUG] Iniciando processRecord');
  
  try {
    // Parse S3 event desde SQS
    logger.info('🔍 [DEBUG] Parseando SQS body...');
    const sqsBody = JSON.parse(record.body);
    const s3Event = sqsBody.Records?.[0];

    if (!s3Event) {
      logger.error('❌ [DEBUG] No se encontró evento S3 en el mensaje SQS');
      return;
    }

    const bucket = s3Event.s3.bucket.name;
    const key = decodeURIComponent(s3Event.s3.object.key.replace(/\+/g, ' '));
    const eventName = s3Event.eventName;
    const sizeKB = (s3Event.s3.object.size / 1024).toFixed(2);

    logger.info('📦 [DEBUG] Evento S3 parseado', { bucket, key, eventName, sizeKB });

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
    logger.info('🔍 [DEBUG] INICIANDO EXTRACCIÓN DE TEXTO', {
      documentId,
      hasPassword,
      passwordFound: !!password,
      bucket,
      key
    });
    
    // 🔄 ACTUALIZAR ESTADO: DECRYPTING (si tiene contraseña) o EXTRACTING_TEXT
    if (hasPassword && password) {
      logger.info('🔐 [DEBUG] Actualizando estado a DECRYPTING');
      await updateDocumentStatus(auth0UserId, documentId, DocumentStatus.DECRYPTING);
    } else {
      logger.info('📄 [DEBUG] Actualizando estado a EXTRACTING_TEXT');
      await updateDocumentStatus(auth0UserId, documentId, DocumentStatus.EXTRACTING_TEXT);
    }

    logger.info('⏳ [DEBUG] Llamando a extractTextFromPDF...');
    let text;
    try {
      text = await extractTextFromPDF(bucket, key, {
        password: password // Usar contraseña de DynamoDB
      });
      logger.info('✅ [DEBUG] extractTextFromPDF completado exitosamente');
    } catch (extractError) {
      logger.error('❌ [DEBUG] Error extrayendo texto del PDF', { 
        error: extractError.message,
        stack: extractError.stack,
        documentId
      });
      
      // Determinar tipo de error
      if (extractError.message.includes('password') || extractError.message.includes('contraseña')) {
        logger.error('🔑 [DEBUG] Error de contraseña detectado');
        await markPasswordError(auth0UserId, documentId, `Error de contraseña: ${extractError.message}`);
      } else {
        logger.error('💥 [DEBUG] Error de extracción general');
        await markDocumentFailed(auth0UserId, documentId, ErrorType.EXTRACTION_FAILED, extractError.message);
      }
      
      throw extractError;
    }

    logger.info('✅ [DEBUG] Texto extraído', {
      lengthChars: text.length,
      lengthLines: text.split('\n').length,
      firstLines: text.split('\n').slice(0, 5).join(' | '), // Primeras 5 líneas
      documentId
    });

    // **PASO 2: Parsear transacciones**
    logger.info('🔍 [DEBUG] INICIANDO PARSEO DE TRANSACCIONES', { documentId });

    // 🔄 ACTUALIZAR ESTADO: PARSING
    logger.info('📊 [DEBUG] Actualizando estado a PARSING');
    await updateDocumentStatus(auth0UserId, documentId, DocumentStatus.PARSING);

    // Generar ID único para este documento
    const sourceDocumentId = documentId; // Usar el documentId como sourceDocumentId

    let transactions;
    try {
      logger.info('⏳ [DEBUG] Llamando a parseTransactions...');
      transactions = parseTransactions(text, {
        sourceDocumentId,
        auth0UserId, // Usar auth0UserId en lugar de userId
        userEmail,
        documentType
      });
      logger.info('✅ [DEBUG] parseTransactions completado');

      logger.info('✅ [DEBUG] Transacciones parseadas', {
        count: transactions.length,
        debits: transactions.filter(t => t.type === 'DEBIT').length,
        credits: transactions.filter(t => t.type === 'CREDIT').length,
        firstTransaction: transactions.length > 0 ? {
          date: transactions[0].date,
          merchant: transactions[0].merchant,
          amount: transactions[0].amount
        } : null,
        documentId
      });

      if (transactions.length === 0) {
        logger.warn('⚠️  [DEBUG] No se encontraron transacciones en el PDF');
        await markDocumentFailed(auth0UserId, documentId, ErrorType.NO_TRANSACTIONS_FOUND, 'No se encontraron transacciones en el documento');
        throw new Error('No se encontraron transacciones');
      }
    } catch (parseError) {
      logger.error('❌ [DEBUG] Error parseando transacciones', { 
        error: parseError.message,
        stack: parseError.stack,
        documentId
      });
      if (parseError.message !== 'No se encontraron transacciones') {
        await markDocumentFailed(auth0UserId, documentId, ErrorType.PARSING_FAILED, parseError.message);
      }
      throw parseError;
    }

    // **PASO 3: Guardar en DynamoDB con validación de duplicados**
    logger.info('💾 [DEBUG] INICIANDO GUARDADO EN DYNAMODB', { 
      transactionsCount: transactions.length,
      documentId
    });

    let result;
    try {
      logger.info('⏳ [DEBUG] Llamando a saveTransactions...');
      result = await saveTransactions(transactions);
      logger.info('✅ [DEBUG] saveTransactions completado');

      logger.info('✅ [DEBUG] Transacciones guardadas', {
        saved: result.saved,
        duplicates: result.duplicates,
        errors: result.errors,
        documentId
      });
    } catch (saveError) {
      logger.error('❌ [DEBUG] Error guardando transacciones', { 
        error: saveError.message,
        stack: saveError.stack,
        documentId
      });
      await markDocumentFailed(auth0UserId, documentId, ErrorType.DYNAMODB_ERROR, saveError.message);
      throw saveError;
    }

    // **PASO 4: Marcar como COMPLETADO**
    const processingTimeMs = Date.now() - processingStartTime;
    
    logger.info('🎉 [DEBUG] Marcando documento como completado', {
      documentId,
      transactionsCount: transactions.length,
      processingTimeMs
    });
    
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
