/**
 * Lambda Authorizer para Auth0
 * Valida JWT tokens y extrae el userId (sub)
 */

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { createLogger } = require('../shared/logger');

const logger = createLogger('auth0-authorizer');

// Configuración de Auth0 desde variables de entorno
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN; // ej: "tu-tenant.us.auth0.com"
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE; // ej: "https://api.financebot.com"

// Cliente JWKS para obtener las claves públicas de Auth0
const client = jwksClient({
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
  jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`
});

/**
 * Obtiene la clave pública para verificar el token
 */
function getKey(header, callback) {
  client.getSigningKey(header.kid, function(err, key) {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

/**
 * Verifica y decodifica el JWT token
 */
function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        audience: AUTH0_AUDIENCE,
        issuer: `https://${AUTH0_DOMAIN}/`,
        algorithms: ['RS256']
      },
      (err, decoded) => {
        if (err) {
          reject(err);
        } else {
          resolve(decoded);
        }
      }
    );
  });
}

/**
 * Genera la policy de IAM
 */
function generatePolicy(principalId, effect, resource, context = {}) {
  const authResponse = {
    principalId: principalId
  };

  if (effect && resource) {
    authResponse.policyDocument = {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource
        }
      ]
    };
  }

  // Context que se pasará a las lambdas downstream
  authResponse.context = context;

  return authResponse;
}

/**
 * Handler principal
 */
exports.handler = async (event) => {
  logger.info('Authorizer invocado', {
    methodArn: event.methodArn,
    type: event.type
  });

  // Extraer el token del header Authorization
  const token = event.authorizationToken?.replace('Bearer ', '');

  if (!token) {
    logger.warn('Token no proporcionado');
    throw new Error('Unauthorized');
  }

  try {
    // Verificar el token con Auth0
    const decoded = await verifyToken(token);

    logger.info('Token válido', {
      sub: decoded.sub,
      email: decoded.email
    });

    // Extraer información del usuario
    const auth0UserId = decoded.sub; // ej: "auth0|123456789"
    const email = decoded.email;
    const name = decoded.name;

    // Generar policy de autorización
    const policy = generatePolicy(
      auth0UserId,
      'Allow',
      event.methodArn,
      {
        auth0UserId: auth0UserId,
        email: email || 'unknown',
        name: name || 'unknown'
      }
    );

    logger.info('Autorización exitosa', { auth0UserId });

    return policy;

  } catch (error) {
    logger.error('Error verificando token', {
      error: error.message,
      stack: error.stack
    });

    // Rechazar la petición
    throw new Error('Unauthorized');
  }
};

