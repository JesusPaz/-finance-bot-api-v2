/**
 * Utilidades para respuestas HTTP de API Gateway
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

/**
 * Respuesta exitosa (200)
 */
function success(data, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS
    },
    body: JSON.stringify(data)
  };
}

/**
 * Respuesta de error genérica
 */
function error(message, statusCode = 500, details = null) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS
    },
    body: JSON.stringify({
      error: message,
      ...(details && { details })
    })
  };
}

/**
 * Bad Request (400)
 */
function badRequest(message, details = null) {
  return error(message, 400, details);
}

/**
 * Unauthorized (401)
 */
function unauthorized(message = 'Unauthorized') {
  return error(message, 401);
}

/**
 * Forbidden (403)
 */
function forbidden(message = 'Forbidden') {
  return error(message, 403);
}

/**
 * Not Found (404)
 */
function notFound(message = 'Not found') {
  return error(message, 404);
}

/**
 * Internal Server Error (500)
 */
function serverError(message = 'Internal server error', details = null) {
  return error(message, 500, details);
}

module.exports = {
  success,
  error,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  serverError,
  CORS_HEADERS
};

