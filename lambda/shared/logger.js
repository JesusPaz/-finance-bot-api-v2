/**
 * Utilidades de logging consistente
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'INFO'];

/**
 * Crea un logger con contexto
 */
function createLogger(context) {
  return {
    debug: (message, data) => log('DEBUG', context, message, data),
    info: (message, data) => log('INFO', context, message, data),
    warn: (message, data) => log('WARN', context, message, data),
    error: (message, data) => log('ERROR', context, message, data)
  };
}

/**
 * Log con nivel
 */
function log(level, context, message, data) {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return;

  const emoji = {
    DEBUG: '🔍',
    INFO: 'ℹ️ ',
    WARN: '⚠️ ',
    ERROR: '❌'
  }[level];

  const timestamp = new Date().toISOString();
  const prefix = `${emoji} [${context}]`;

  if (data) {
    console.log(`${prefix} ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} ${message}`);
  }
}

module.exports = {
  createLogger,
  LOG_LEVELS
};

