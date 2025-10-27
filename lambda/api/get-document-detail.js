/**
 * API: GET /documents/{documentId}
 * 
 * Obtiene el detalle completo de un documento específico.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { getStatusMessage, getStatusEmoji, canRetry } = require('../shared/document-status');

const dynamoClient = new DynamoDBClient();
const dynamo = DynamoDBDocumentClient.from(dynamoClient);

const UPLOADS_TABLE = process.env.UPLOADS_TABLE_NAME;

/**
 * Handler principal
 * @param {Object} event - API Gateway event
 * @returns {Object} API Gateway response
 */
exports.handler = async (event) => {
  console.log('📄 [get-document-detail] Request recibido:', {
    path: event.path,
    method: event.httpMethod,
    pathParameters: event.pathParameters,
    origin: event.headers?.origin
  });

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: ''
    };
  }

  try {
    // Obtener auth0UserId del authorizer context
    const auth0UserId = event.requestContext?.authorizer?.auth0UserId;
    
    if (!auth0UserId) {
      console.error('❌ [get-document-detail] auth0UserId no encontrado en context');
      return errorResponse(401, 'Usuario no autenticado');
    }

    // Obtener documentId del path
    const documentId = event.pathParameters?.documentId;
    
    if (!documentId) {
      console.warn('⚠️  [get-document-detail] documentId no proporcionado');
      return errorResponse(400, 'documentId es requerido');
    }

    console.log('🔍 [get-document-detail] Buscando documento:', { auth0UserId, documentId });

    // Obtener documento de DynamoDB
    const result = await dynamo.send(new GetCommand({
      TableName: UPLOADS_TABLE,
      Key: {
        auth0UserId,
        documentId
      }
    }));

    if (!result.Item) {
      console.warn('⚠️  [get-document-detail] Documento no encontrado');
      return errorResponse(404, 'Documento no encontrado');
    }

    const document = result.Item;

    // Formatear respuesta
    const statusEmoji = getStatusEmoji(document.status);
    const statusMessage = getStatusMessage(document.status);
    const retryable = canRetry(document.status);

    const response = {
      documentId: document.documentId,
      filename: document.filename,
      documentType: document.documentType,
      status: document.status,
      statusEmoji,
      statusMessage,
      hasPassword: document.hasPassword,
      uploadedAt: document.uploadedAt,
      processingStartedAt: document.processingStartedAt,
      completedAt: document.completedAt,
      failedAt: document.failedAt,
      transactionsExtracted: document.transactionsExtracted || 0,
      fileSize: document.fileSize,
      fileSizeMB: document.fileSize ? (document.fileSize / (1024 * 1024)).toFixed(2) : null,
      s3Key: document.s3Key,
      s3Bucket: document.s3Bucket,
      errorMessage: document.errorMessage,
      errorType: document.errorType,
      canRetry: retryable,
      metadata: document.metadata,
      // Calcular tiempo de procesamiento
      processingTimeMs: calculateProcessingTime(document),
      processingTimeSec: calculateProcessingTime(document) ? (calculateProcessingTime(document) / 1000).toFixed(2) : null
    };

    console.log('✅ [get-document-detail] Documento encontrado:', {
      documentId,
      status: document.status
    });

    return successResponse({ document: response });

  } catch (error) {
    console.error('❌ [get-document-detail] Error:', error);
    return errorResponse(500, 'Error obteniendo documento', error.message);
  }
};

/**
 * Calcula el tiempo de procesamiento en ms
 */
function calculateProcessingTime(document) {
  if (document.processingStartedAt && document.completedAt) {
    const start = new Date(document.processingStartedAt).getTime();
    const end = new Date(document.completedAt).getTime();
    return end - start;
  }
  
  if (document.processingStartedAt && document.failedAt) {
    const start = new Date(document.processingStartedAt).getTime();
    const end = new Date(document.failedAt).getTime();
    return end - start;
  }
  
  // Si está en progreso, calcular tiempo transcurrido
  if (document.processingStartedAt && !document.completedAt && !document.failedAt) {
    const start = new Date(document.processingStartedAt).getTime();
    const now = Date.now();
    return now - start;
  }
  
  return null;
}

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
      'Access-Control-Allow-Methods': 'GET,OPTIONS'
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

