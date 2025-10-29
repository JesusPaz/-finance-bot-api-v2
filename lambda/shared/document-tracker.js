/**
 * Helper para actualizar el estado de documentos en document-uploads
 */

// ✅ Importar X-Ray primero
const AWSXRay = require('aws-xray-sdk-core');

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { DocumentStatus, ErrorType } = require('./document-status');

// ✅ Instrumentar DynamoDB con X-Ray
const dynamoClient = AWSXRay.captureAWSv3Client(new DynamoDBClient());
const dynamo = DynamoDBDocumentClient.from(dynamoClient);

const UPLOADS_TABLE = process.env.UPLOADS_TABLE_NAME;

/**
 * Actualiza el estado de un documento
 * @param {string} auth0UserId - ID del usuario
 * @param {string} documentId - ID único del documento
 * @param {string} status - Nuevo estado (de DocumentStatus)
 * @param {Object} additionalData - Datos adicionales a actualizar
 */
async function updateDocumentStatus(auth0UserId, documentId, status, additionalData = {}) {
  if (!auth0UserId || !documentId) {
    console.error('❌ [document-tracker] auth0UserId o documentId faltante');
    return;
  }

  try {
    const now = new Date().toISOString();
    const statusComposite = `${auth0UserId}#${status}`;

    // Construir expresión de actualización
    const updateExpression = ['SET #status = :status, #statusComposite = :statusComposite, #updatedAt = :updatedAt'];
    const expressionAttributeNames = {
      '#status': 'status',
      '#statusComposite': 'statusComposite',
      '#updatedAt': 'updatedAt'
    };
    const expressionAttributeValues = {
      ':status': status,
      ':statusComposite': statusComposite,
      ':updatedAt': now
    };

    // Agregar campos condicionales según el estado
    if (status === DocumentStatus.PROCESSING && !additionalData.processingStartedAt) {
      updateExpression.push('#processingStartedAt = :processingStartedAt');
      expressionAttributeNames['#processingStartedAt'] = 'processingStartedAt';
      expressionAttributeValues[':processingStartedAt'] = now;
    }

    if (status === DocumentStatus.COMPLETED && !additionalData.completedAt) {
      updateExpression.push('#completedAt = :completedAt');
      expressionAttributeNames['#completedAt'] = 'completedAt';
      expressionAttributeValues[':completedAt'] = now;
    }

    // Agregar datos adicionales
    Object.entries(additionalData).forEach(([key, value]) => {
      const attrName = `#${key}`;
      const attrValue = `:${key}`;
      updateExpression.push(`${attrName} = ${attrValue}`);
      expressionAttributeNames[attrName] = key;
      expressionAttributeValues[attrValue] = value;
    });

    await dynamo.send(new UpdateCommand({
      TableName: UPLOADS_TABLE,
      Key: {
        auth0UserId,
        documentId
      },
      UpdateExpression: updateExpression.join(', '),
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    }));

    console.log(`✅ [document-tracker] Estado actualizado: ${status}`, { documentId, auth0UserId });

  } catch (error) {
    console.error('❌ [document-tracker] Error actualizando estado:', {
      error: error.message,
      documentId,
      auth0UserId,
      status
    });
    // No lanzar error, solo loguear (el tracking no debe detener el procesamiento)
  }
}

/**
 * Marca un documento como fallido con error
 */
async function markDocumentFailed(auth0UserId, documentId, errorType, errorMessage) {
  await updateDocumentStatus(auth0UserId, documentId, DocumentStatus.FAILED, {
    errorType,
    errorMessage,
    failedAt: new Date().toISOString()
  });
}

/**
 * Marca un documento con error de contraseña
 */
async function markPasswordError(auth0UserId, documentId, errorMessage) {
  await updateDocumentStatus(auth0UserId, documentId, DocumentStatus.PASSWORD_ERROR, {
    errorType: ErrorType.PASSWORD_INCORRECT,
    errorMessage,
    failedAt: new Date().toISOString(),
    canRetry: true
  });
}

/**
 * Marca un documento como completado exitosamente
 */
async function markDocumentCompleted(auth0UserId, documentId, transactionsExtracted, processingTimeMs) {
  await updateDocumentStatus(auth0UserId, documentId, DocumentStatus.COMPLETED, {
    transactionsExtracted,
    processingTimeMs: processingTimeMs
  });
}

/**
 * Obtiene información de un documento
 */
async function getDocument(auth0UserId, documentId) {
  try {
    const result = await dynamo.send(new GetCommand({
      TableName: UPLOADS_TABLE,
      Key: {
        auth0UserId,
        documentId
      }
    }));

    return result.Item || null;
  } catch (error) {
    console.error('❌ [document-tracker] Error obteniendo documento:', error);
    return null;
  }
}

module.exports = {
  updateDocumentStatus,
  markDocumentFailed,
  markPasswordError,
  markDocumentCompleted,
  getDocument
};

