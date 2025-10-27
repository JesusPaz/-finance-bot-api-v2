/**
 * API: GET /documents
 * 
 * Lista todos los documentos del usuario con paginación y filtros opcionales.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { DocumentStatus, getStatusMessage, getStatusEmoji } = require('../shared/document-status');

const dynamoClient = new DynamoDBClient();
const dynamo = DynamoDBDocumentClient.from(dynamoClient);

const UPLOADS_TABLE = process.env.UPLOADS_TABLE_NAME;

/**
 * Handler principal
 * @param {Object} event - API Gateway event
 * @returns {Object} API Gateway response
 */
exports.handler = async (event) => {
  console.log('📋 [list-documents] Request recibido:', {
    path: event.path,
    method: event.httpMethod,
    queryParams: event.queryStringParameters,
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
      console.error('❌ [list-documents] auth0UserId no encontrado en context');
      return errorResponse(401, 'Usuario no autenticado');
    }

    console.log('👤 [list-documents] Usuario autenticado:', { auth0UserId });

    // Obtener query parameters
    const queryParams = event.queryStringParameters || {};
    const status = queryParams.status; // Filtro opcional por estado
    const limit = parseInt(queryParams.limit || '50', 10);
    const lastEvaluatedKey = queryParams.cursor ? JSON.parse(Buffer.from(queryParams.cursor, 'base64').toString()) : undefined;

    console.log('🔍 [list-documents] Filtros:', { status, limit, hasCursor: !!lastEvaluatedKey });

    let queryCommand;

    if (status) {
      // Usar GSI para filtrar por estado
      queryCommand = new QueryCommand({
        TableName: UPLOADS_TABLE,
        IndexName: 'status-uploadedAt-index',
        KeyConditionExpression: 'statusComposite = :statusComposite',
        ExpressionAttributeValues: {
          ':statusComposite': `${auth0UserId}#${status}`
        },
        ScanIndexForward: false, // Más recientes primero
        Limit: limit,
        ExclusiveStartKey: lastEvaluatedKey
      });
    } else {
      // Query todos los documentos del usuario
      queryCommand = new QueryCommand({
        TableName: UPLOADS_TABLE,
        KeyConditionExpression: 'auth0UserId = :auth0UserId',
        ExpressionAttributeValues: {
          ':auth0UserId': auth0UserId
        },
        ScanIndexForward: false, // Más recientes primero
        Limit: limit,
        ExclusiveStartKey: lastEvaluatedKey
      });
    }

    const result = await dynamo.send(queryCommand);

    // Formatear documentos para respuesta
    const documents = (result.Items || []).map(formatDocument);

    // Generar cursor para paginación
    const nextCursor = result.LastEvaluatedKey 
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    console.log('✅ [list-documents] Documentos listados:', {
      count: documents.length,
      hasMore: !!nextCursor
    });

    return successResponse({
      documents,
      count: documents.length,
      nextCursor,
      hasMore: !!nextCursor
    });

  } catch (error) {
    console.error('❌ [list-documents] Error:', error);
    return errorResponse(500, 'Error listando documentos', error.message);
  }
};

/**
 * Formatea un documento para la respuesta
 */
function formatDocument(item) {
  const statusEmoji = getStatusEmoji(item.status);
  const statusMessage = getStatusMessage(item.status);

  return {
    documentId: item.documentId,
    filename: item.filename,
    documentType: item.documentType,
    status: item.status,
    statusEmoji,
    statusMessage,
    hasPassword: item.hasPassword,
    uploadedAt: item.uploadedAt,
    processingStartedAt: item.processingStartedAt,
    completedAt: item.completedAt,
    transactionsExtracted: item.transactionsExtracted || 0,
    fileSize: item.fileSize,
    errorMessage: item.errorMessage,
    errorType: item.errorType,
    s3Key: item.s3Key,
    metadata: item.metadata
  };
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

