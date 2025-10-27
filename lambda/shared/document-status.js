/**
 * Estados posibles de un documento durante su ciclo de vida
 */
const DocumentStatus = {
  UPLOADED: 'UPLOADED',                   // Archivo subido a S3
  PROCESSING: 'PROCESSING',               // Worker iniciando procesamiento
  DECRYPTING: 'DECRYPTING',              // Desbloqueando PDF con qpdf
  EXTRACTING_TEXT: 'EXTRACTING_TEXT',    // Extrayendo texto con pdftotext
  PARSING: 'PARSING',                     // Parseando transacciones
  COMPLETED: 'COMPLETED',                 // Éxito total
  FAILED: 'FAILED',                       // Error irrecuperable
  PASSWORD_ERROR: 'PASSWORD_ERROR',       // Error de contraseña
  RETRY_PENDING: 'RETRY_PENDING'          // Esperando reintento manual
};

/**
 * Tipos de error que pueden ocurrir durante el procesamiento
 */
const ErrorType = {
  PASSWORD_INCORRECT: 'PASSWORD_INCORRECT',
  PASSWORD_MISSING: 'PASSWORD_MISSING',
  PDF_CORRUPTED: 'PDF_CORRUPTED',
  QPDF_FAILED: 'QPDF_FAILED',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  PARSING_FAILED: 'PARSING_FAILED',
  NO_TRANSACTIONS_FOUND: 'NO_TRANSACTIONS_FOUND',
  DYNAMODB_ERROR: 'DYNAMODB_ERROR',
  S3_ERROR: 'S3_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * Estados que indican que el procesamiento está en curso
 */
const IN_PROGRESS_STATUSES = [
  DocumentStatus.PROCESSING,
  DocumentStatus.DECRYPTING,
  DocumentStatus.EXTRACTING_TEXT,
  DocumentStatus.PARSING
];

/**
 * Estados que indican que el procesamiento terminó (exitoso o con error)
 */
const FINAL_STATUSES = [
  DocumentStatus.COMPLETED,
  DocumentStatus.FAILED,
  DocumentStatus.PASSWORD_ERROR
];

/**
 * Estados que permiten reintentar el procesamiento
 */
const RETRYABLE_STATUSES = [
  DocumentStatus.FAILED,
  DocumentStatus.PASSWORD_ERROR,
  DocumentStatus.RETRY_PENDING
];

/**
 * Verifica si un estado permite reintentar
 */
function canRetry(status) {
  return RETRYABLE_STATUSES.includes(status);
}

/**
 * Verifica si un estado indica procesamiento en curso
 */
function isProcessing(status) {
  return IN_PROGRESS_STATUSES.includes(status);
}

/**
 * Verifica si un estado es final (terminado)
 */
function isFinal(status) {
  return FINAL_STATUSES.includes(status);
}

/**
 * Obtiene un mensaje amigable para cada estado
 */
function getStatusMessage(status) {
  const messages = {
    [DocumentStatus.UPLOADED]: 'Documento subido correctamente',
    [DocumentStatus.PROCESSING]: 'Procesando documento...',
    [DocumentStatus.DECRYPTING]: 'Desbloqueando PDF protegido...',
    [DocumentStatus.EXTRACTING_TEXT]: 'Extrayendo texto del documento...',
    [DocumentStatus.PARSING]: 'Analizando transacciones...',
    [DocumentStatus.COMPLETED]: 'Procesamiento completado exitosamente',
    [DocumentStatus.FAILED]: 'Error al procesar el documento',
    [DocumentStatus.PASSWORD_ERROR]: 'Contraseña incorrecta o faltante',
    [DocumentStatus.RETRY_PENDING]: 'Esperando reintento'
  };
  
  return messages[status] || 'Estado desconocido';
}

/**
 * Obtiene un emoji representativo para cada estado
 */
function getStatusEmoji(status) {
  const emojis = {
    [DocumentStatus.UPLOADED]: '📤',
    [DocumentStatus.PROCESSING]: '⚙️',
    [DocumentStatus.DECRYPTING]: '🔓',
    [DocumentStatus.EXTRACTING_TEXT]: '📄',
    [DocumentStatus.PARSING]: '🔍',
    [DocumentStatus.COMPLETED]: '✅',
    [DocumentStatus.FAILED]: '❌',
    [DocumentStatus.PASSWORD_ERROR]: '🔐',
    [DocumentStatus.RETRY_PENDING]: '⏳'
  };
  
  return emojis[status] || '❓';
}

module.exports = {
  DocumentStatus,
  ErrorType,
  IN_PROGRESS_STATUSES,
  FINAL_STATUSES,
  RETRYABLE_STATUSES,
  canRetry,
  isProcessing,
  isFinal,
  getStatusMessage,
  getStatusEmoji
};

