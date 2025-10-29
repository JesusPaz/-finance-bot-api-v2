/**
 * Parser de transacciones de extractos bancarios
 */

const crypto = require('crypto');
const { createLogger } = require('./logger');

const logger = createLogger('transaction-parser');

/**
 * Parsea las transacciones del texto extraído de un PDF
 * 
 * @param {string} text - Texto extraído del PDF
 * @param {object} metadata - Metadata del documento
 * @returns {Array} - Array de transacciones parseadas
 */
function parseTransactions(text, metadata = {}) {
  const { sourceDocumentId, auth0UserId, userEmail, documentType } = metadata;
  
  logger.info('📊 [DEBUG] === INICIO parseTransactions ===', {
    textLength: text.length,
    linesCount: text.split('\n').length,
    sourceDocumentId,
    auth0UserId
  });
  
  const lines = text.split('\n');
  const transactions = [];
  
  // Patrones para detectar transacciones
  const datePattern = /(\d{2}\/\d{2}\/\d{4})/; // DD/MM/YYYY
  const amountPattern = /\$\s*([\d.,]+)/g; // $123.456,00
  
  logger.info('🔍 [DEBUG] Iniciando búsqueda de transacciones', {
    totalLines: lines.length,
    datePattern: datePattern.toString(),
    amountPattern: amountPattern.toString()
  });
  
  let inTransactionSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Detectar inicio de sección de transacciones
    if (line.includes('Nuevos movimientos') || 
        line.includes('Movimientos') ||
        (line.includes('Número de') && line.includes('autorización'))) {
      inTransactionSection = true;
      logger.info(`✅ [DEBUG] Sección de transacciones encontrada en línea ${i + 1}`, { line });
      continue;
    }
    
    // Si estamos en la sección de transacciones
    if (inTransactionSection && line.length > 0) {
      
      // Buscar líneas con fechas y montos
      const hasDate = datePattern.test(line);
      const amounts = [...line.matchAll(amountPattern)];
      
      if (hasDate && amounts.length > 0) {
        logger.info(`💰 [DEBUG] Línea ${i + 1} tiene fecha y monto`, { line });
        
        // Extraer fecha
        const dateMatch = line.match(datePattern);
        const date = dateMatch ? dateMatch[1] : null;
        
        // Convertir a formato ISO (YYYY-MM-DD)
        const isoDate = date ? convertToISODate(date) : null;
        
        // Extraer merchant/descripción (texto antes del primer $)
        const parts = line.split('$');
        let merchant = parts[0].trim();
        
        // Limpiar la fecha del merchant
        if (date) {
          merchant = merchant.replace(date, '').trim();
        }
        
        // Extraer número de autorización (primeros dígitos)
        const authNumberMatch = merchant.match(/^(\d{6})/);
        const authNumber = authNumberMatch ? authNumberMatch[1] : null;
        
        // Limpiar merchant (quitar número de autorización)
        if (authNumber) {
          merchant = merchant.replace(authNumber, '').trim();
        }
        
        // Extraer montos
        const extractedAmounts = amounts.map(m => m[1].trim());
        
        // El primer monto es usualmente el monto principal
        const amountStr = extractedAmounts[0] || '0';
        const amount = parseAmount(amountStr);
        
        // Determinar si es débito o crédito
        const isCredit = merchant.toLowerCase().includes('pago') || 
                         merchant.toLowerCase().includes('abono') ||
                         merchant.toLowerCase().includes('reversion');
        
        const type = isCredit ? 'CREDIT' : 'DEBIT';
        
        // Generar hash de idempotencia
        const hash = generateTransactionHash({
          auth0UserId,
          date: isoDate,
          amount,
          merchant,
          authNumber,
          sourceDocumentId
        });
        
        // Auto-categorizar
        const category = autoCategory(merchant);
        
        const transaction = {
          auth0UserId, // Cambiar userId por auth0UserId
          userEmail,
          transactionId: hash, // Usar hash como ID
          date: isoDate,
          merchant: merchant || 'DESCONOCIDO',
          authNumber,
          amount,
          amountStr,
          type,
          category,
          sourceDocumentId,
          documentType, // Tipo de documento en lugar de número
          rawLine: line,
          createdAt: new Date().toISOString()
        };
        
        transactions.push(transaction);
      }
    }
    
    // Detectar fin de sección de transacciones
    if (line.includes('En casos de inconsistencias') || 
        line.includes('Resumen de tu cuenta') ||
        line.includes('Total a pagar')) {
      inTransactionSection = false;
    }
  }
  
  logger.info('✅ [DEBUG] Transacciones parseadas', { 
    count: transactions.length,
    debits: transactions.filter(t => t.type === 'DEBIT').length,
    credits: transactions.filter(t => t.type === 'CREDIT').length
  });
  
  logger.info('🎉 [DEBUG] === FIN parseTransactions ===', {
    totalTransactions: transactions.length
  });
  
  return transactions;
}

/**
 * Convierte fecha DD/MM/YYYY a ISO YYYY-MM-DD
 */
function convertToISODate(dateStr) {
  try {
    const [day, month, year] = dateStr.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  } catch (error) {
    return dateStr;
  }
}

/**
 * Parsea un monto con formato colombiano (ej: 123.456,78)
 */
function parseAmount(amountStr) {
  try {
    // Remover puntos (separadores de miles) y reemplazar coma por punto
    const normalized = amountStr.replace(/\./g, '').replace(',', '.');
    return parseFloat(normalized);
  } catch (error) {
    return 0;
  }
}

/**
 * Genera un hash único para una transacción (para idempotencia)
 */
function generateTransactionHash(transaction) {
  const { auth0UserId, date, amount, merchant, authNumber, sourceDocumentId } = transaction;
  
  // Usar información que identifica únicamente una transacción
  const hashInput = [
    auth0UserId, // Cambiar userId por auth0UserId
    date,
    amount,
    merchant,
    authNumber || '',
    sourceDocumentId
  ].join('|');
  
  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

/**
 * Auto-categoriza una transacción basándose en el merchant
 */
function autoCategory(merchant) {
  const merchantLower = merchant.toLowerCase();
  
  // Categorías comunes
  const categories = {
    'RESTAURANTES': ['restaurante', 'pizza', 'burger', 'comida', 'cafe', 'starbucks', 'mc donald', 'frisby', 'dominos', 'juan vald', 'coffee'],
    'SUPERMERCADOS': ['exito', 'carulla', 'mercado', 'super', 'homecenter', 'alkosto'],
    'TRANSPORTE': ['uber', 'taxi', 'parking', 'peaje', 'gasolina', 'ecopetrol', 'eds', 'combustible'],
    'SALUD': ['farmacia', 'drogueria', 'clinica', 'hospital', 'colmedica', 'farmatodo', 'cruz verde'],
    'TECNOLOGIA': ['amazon', 'google', 'apple', 'microsoft', 'netflix', 'spotify', 'openai', 'github', 'cloudflare', 'aws'],
    'ENTRETENIMIENTO': ['cine', 'teatro', 'juego', 'gimnasio', 'fitness', 'deporte', 'sporty'],
    'SERVICIOS': ['telefon', 'internet', 'luz', 'agua', 'gas', 'movistar', 'claro', 'une', 'starlink'],
    'HOGAR': ['homecenter', 'ferreteria', 'mueble', 'decoracion'],
    'EDUCACION': ['universidad', 'colegio', 'curso', 'libro'],
    'VIAJES': ['hotel', 'aero', 'avianca', 'latam', 'viaje'],
    'OTROS_SERVICIOS': ['rappi', 'payu', 'pago']
  };
  
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => merchantLower.includes(keyword))) {
      return category;
    }
  }
  
  return 'SIN_CATEGORIA';
}

module.exports = {
  parseTransactions,
  generateTransactionHash,
  autoCategory
};

