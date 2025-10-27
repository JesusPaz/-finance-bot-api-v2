/**
 * API: POST /upload-url
 * 
 * Genera una URL pre-firmada para que el usuario suba un PDF a S3.
 * También crea un registro inicial en document-uploads con status=UPLOADED.
 */

const { S3Client } = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');
const { DocumentStatus } = require('../shared/document-status');

const s3 = new S3Client();
const dynamoClient = new DynamoDBClient();
const dynamo = DynamoDBDocumentClient.from(dynamoClient);

const PASSWORDS_TABLE = process.env.PASSWORDS_TABLE_NAME;
const UPLOADS_TABLE = process.env.UPLOADS_TABLE_NAME;

/**
 * Handler principal
 * @param {Object} event - API Gateway event
 * @returns {Object} API Gateway responsecd
 */
exports.handler = async (event) => {
  console.log('📝 [upload-url] Request recibido:', {
    path: event.path,
    method: event.httpMethod,
    body: event.body
  });

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS'
      },
      body: ''
    };
  }

  try {
    // Obtener auth0UserId del authorizer context
    const auth0UserId = event.requestContext?.authorizer?.auth0UserId;
    const userEmail = event.requestContext?.authorizer?.email;
    
    if (!auth0UserId) {
      console.error('❌ [upload-url] auth0UserId no encontrado en context');
      return errorResponse(401, 'Usuario no autenticado');
    }

    console.log('👤 [upload-url] Usuario autenticado:', { auth0UserId, email: userEmail });

    // Parsear body
    const body = JSON.parse(event.body || '{}');
    const { filename, password, documentType } = body;

    // Validar input
    if (!filename) {
      console.warn('⚠️  [upload-url] Filename no proporcionado');
      return errorResponse(400, 'filename es requerido');
    }

    // Validar extensión
    if (!filename.toLowerCase().endsWith('.pdf')) {
      console.warn('⚠️  [upload-url] Archivo no es PDF:', filename);
      return errorResponse(400, 'Solo se permiten archivos PDF');
    }

    // Si se proporciona contraseña, guardarla en DynamoDB
    if (password) {
      console.log('🔐 [upload-url] Guardando contraseña para documentos futuros');
      
      try {
        await dynamo.send(new PutCommand({
          TableName: PASSWORDS_TABLE,
          Item: {
            auth0UserId: auth0UserId,
            documentType: documentType || 'default',
            password: password,
            updatedAt: new Date().toISOString(),
            userEmail: userEmail
          }
        }));
        
        console.log('✅ [upload-url] Contraseña guardada exitosamente');
      } catch (dbError) {
        console.error('❌ [upload-url] Error guardando contraseña:', dbError);
        // No fallar el upload si falla guardar la contraseña
      }
    }

    // Generar documentId único
    const documentId = randomUUID();
    
    // Generar key único para S3 incluyendo auth0UserId y documentId
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const sanitizedUserId = auth0UserId.replace(/[^a-zA-Z0-9-]/g, '_');
    const key = `pdfs/${sanitizedUserId}/${documentId}-${sanitizedFilename}`;

    console.log('🔑 [upload-url] Generando presigned POST para:', { documentId, key });

    // Preparar metadata y fields para S3
    const fields = {
      'Content-Type': 'application/pdf'
    };
    
    // Agregar metadata
    fields['x-amz-meta-auth0-user-id'] = auth0UserId;
    fields['x-amz-meta-user-email'] = userEmail || 'unknown';
    fields['x-amz-meta-filename'] = sanitizedFilename;
    fields['x-amz-meta-document-id'] = documentId; // Para trackear en worker
    fields['x-amz-meta-document-type'] = documentType || 'default';
    
    if (password) {
      fields['x-amz-meta-has-password'] = 'true';
    }

    // Crear presigned POST
    const { url, fields: presignedFields } = await createPresignedPost(s3, {
      Bucket: process.env.BUCKET_NAME,
      Key: key,
      Fields: fields,
      Conditions: [
        ['content-length-range', 1, 20_000_000], // 1 byte a 20MB
        ['eq', '$Content-Type', 'application/pdf']
      ],
      Expires: 600 // 10 minutos
    });

    // Crear registro inicial en document-uploads
    const now = new Date().toISOString();
    const uploadRecord = {
      auth0UserId: auth0UserId,
      documentId: documentId,
      filename: sanitizedFilename,
      s3Key: key,
      s3Bucket: process.env.BUCKET_NAME,
      documentType: documentType || 'default',
      hasPassword: !!password,
      status: DocumentStatus.UPLOADED,
      statusComposite: `${auth0UserId}#${DocumentStatus.UPLOADED}`, // Para GSI
      uploadedAt: now,
      fileSize: null, // Se actualizará cuando el archivo se suba
      metadata: {
        presignedUrlCreated: now,
        userEmail: userEmail
      }
    };

    console.log('📊 [upload-url] Creando registro de tracking:', documentId);

    try {
      await dynamo.send(new PutCommand({
        TableName: UPLOADS_TABLE,
        Item: uploadRecord
      }));
      
      console.log('✅ [upload-url] Registro de tracking creado exitosamente');
    } catch (dbError) {
      console.error('❌ [upload-url] Error creando tracking:', dbError);
      // No fallar si el tracking falla, pero loguear el error
    }

    console.log('✅ [upload-url] Presigned POST generado exitosamente');

    return successResponse({
      documentId, // Retornar para que frontend pueda trackear
      url,
      fields: presignedFields,
      key,
      expiresIn: 600,
      maxSize: 20_000_000,
      message: 'Usa estos datos para subir tu PDF',
      note: password 
        ? 'Contraseña guardada para futuros documentos del mismo tipo'
        : 'Sin contraseña configurada'
    });

  } catch (error) {
    console.error('❌ [upload-url] Error:', error);
    return errorResponse(500, 'Error generando URL de subida', error.message);
  }
};

/**
 * Respuesta exitosa
 */
function successResponse(data) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'POST,OPTIONS'
    },
    body: JSON.stringify(data)
  };
}

/**
 * Respuesta de error
 */
function errorResponse(statusCode, message, details = null) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      error: message,
      ...(details && { details })
    })
  };
}
