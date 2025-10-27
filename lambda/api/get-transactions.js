/**
 * API Lambda: GET /transactions
 * Retorna todas las transacciones de un usuario
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { createLogger } = require('../shared/logger');

const dynamoClient = new DynamoDBClient();
const dynamo = DynamoDBDocumentClient.from(dynamoClient);

const logger = createLogger('get-transactions');

const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Handler principal
 */
exports.handler = async (event) => {
  logger.info('GET /transactions', {
    queryParams: event.queryStringParameters
  });

  try {
    // Obtener auth0UserId del authorizer context
    const auth0UserId = event.requestContext?.authorizer?.auth0UserId;
    const userEmail = event.requestContext?.authorizer?.email;
    
    if (!auth0UserId) {
      logger.error('auth0UserId no encontrado en context');
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          success: false,
          error: 'Usuario no autenticado'
        })
      };
    }

    logger.info('Usuario autenticado', { auth0UserId, email: userEmail });

    // IMPORTANTE: Siempre usar auth0UserId del context (no confiar en query params)
    const userId = auth0UserId;
    const limit = parseInt(event.queryStringParameters?.limit || '100');

    // Query por auth0UserId (PK)
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'auth0UserId = :auth0UserId',
      ExpressionAttributeValues: {
        ':auth0UserId': userId
      },
      Limit: limit,
      ScanIndexForward: false // Orden descendente por fecha
    });

    const result = await dynamo.send(command);
    const transactions = result.Items || [];
    const count = result.Count || 0;

    logger.info('Transacciones encontradas', {
      auth0UserId: userId,
      count
    });

    // Agrupar estadísticas
    const stats = {
      total: count,
      debits: transactions.filter(t => t.type === 'DEBIT').length,
      credits: transactions.filter(t => t.type === 'CREDIT').length,
      totalAmount: transactions
        .filter(t => t.type === 'DEBIT')
        .reduce((sum, t) => sum + (t.amount || 0), 0),
      categories: {}
    };

    // Contar por categoría
    transactions.forEach(t => {
      if (t.category) {
        stats.categories[t.category] = (stats.categories[t.category] || 0) + 1;
      }
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: true,
        data: {
          transactions,
          stats
        }
      }, null, 2)
    };

  } catch (error) {
    logger.error('Error obteniendo transacciones', {
      error: error.message,
      stack: error.stack
    });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

