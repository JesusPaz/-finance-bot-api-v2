/**
 * Parser de Transacciones
 * 
 * Convierte tablas extraídas por Textract en transacciones estructuradas
 */

const { createLogger } = require('./logger');
const logger = createLogger('parser');

/**
 * Parsea tablas de extracto bancario/tarjeta
 * 
 * @param {Array} tables - Tablas extraídas por Textract
 * @returns {Array} Transacciones estructuradas
 */
function parseStatementTables(tables) {
  logger.info('Parseando tablas de extracto', { tables: tables.length });

  const transactions = [];

  for (const table of tables) {
    const tableTransactions = parseTable(table);
    transactions.push(...tableTransactions);
  }

  logger.info('Transacciones parseadas', { count: transactions.length });

  return transactions;
}

/**
 * Parsea una tabla individual
 */
function parseTable(table) {
  if (!table.rows || table.rows.length < 2) {
    return []; // Necesita al menos header + 1 row
  }

  const transactions = [];
  const headers = table.rows[0].map(cell => 
    cell.text.toLowerCase().trim()
  );

  logger.debug('Headers detectados', { headers });

  // Detectar índices de columnas
  const indices = detectColumnIndices(headers);

  if (!indices.date) {
    logger.warn('No se detectó columna de fecha, omitiendo tabla');
    return [];
  }

  // Procesar filas de datos (skip header)
  for (let i = 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    try {
      const transaction = parseRow(row, indices);
      
      if (transaction && transaction.date) {
        transactions.push(transaction);
      }
    } catch (error) {
      logger.warn('Error parseando fila', { row: i, error: error.message });
    }
  }

  return transactions;
}

/**
 * Detecta índices de columnas importantes
 */
function detectColumnIndices(headers) {
  const indices = {};

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];

    // Fecha
    if (header.includes('fecha') || header.includes('date')) {
      indices.date = i;
    }

    // Descripción/Comercio
    if (header.includes('descripción') || 
        header.includes('descripcion') ||
        header.includes('comercio') ||
        header.includes('merchant') ||
        header.includes('detail')) {
      indices.description = i;
    }

    // Monto/Valor
    if (header.includes('monto') || 
        header.includes('valor') ||
        header.includes('amount') ||
        header.includes('importe')) {
      indices.amount = i;
    }

    // Categoría
    if (header.includes('categoría') || 
        header.includes('categoria') ||
        header.includes('category')) {
      indices.category = i;
    }
  }

  return indices;
}

/**
 * Parsea una fila de transacción
 */
function parseRow(row, indices) {
  const transaction = {};

  // Fecha
  if (indices.date !== undefined && row[indices.date]) {
    transaction.date = normalizeDate(row[indices.date].text);
  }

  // Descripción
  if (indices.description !== undefined && row[indices.description]) {
    transaction.description = row[indices.description].text.trim();
    transaction.merchant = extractMerchant(transaction.description);
  }

  // Monto
  if (indices.amount !== undefined && row[indices.amount]) {
    transaction.amount = parseAmount(row[indices.amount].text);
  }

  // Categoría (si existe)
  if (indices.category !== undefined && row[indices.category]) {
    transaction.category = row[indices.category].text.trim();
  }

  // Confianza promedio
  const confidences = row
    .filter(cell => cell.confidence)
    .map(cell => cell.confidence);
  
  if (confidences.length > 0) {
    transaction.confidence = 
      confidences.reduce((a, b) => a + b, 0) / confidences.length;
  }

  return transaction;
}

/**
 * Normaliza fecha a formato YYYY-MM-DD
 */
function normalizeDate(dateStr) {
  if (!dateStr) return null;

  // Limpiar
  let cleaned = dateStr.trim().replace(/\s+/g, ' ');

  try {
    // Formato: DD/MM/YYYY o DD-MM-YYYY
    const match1 = cleaned.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (match1) {
      const [_, day, month, year] = match1;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    // Formato: DD/MM/YY
    const match2 = cleaned.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})/);
    if (match2) {
      const [_, day, month, year] = match2;
      const fullYear = year >= 50 ? `19${year}` : `20${year}`;
      return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    // Formato: YYYY-MM-DD (ya normalizado)
    const match3 = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match3) {
      const [_, year, month, day] = match3;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    logger.warn('Formato de fecha no reconocido', { dateStr });
    return null;

  } catch (error) {
    logger.error('Error normalizando fecha', { dateStr, error: error.message });
    return null;
  }
}

/**
 * Parsea monto de string a número
 * Maneja formatos: $1,234.56, 1.234,56, etc.
 */
function parseAmount(amountStr) {
  if (!amountStr) return 0;

  try {
    // Limpiar
    let cleaned = amountStr.trim()
      .replace(/[$€£¥₹]/g, '') // Símbolos de moneda
      .replace(/\s+/g, '');     // Espacios

    // Detectar si usa coma como decimal (europeo) o punto (americano)
    const hasCommaDecimal = /\d+,\d{2}$/.test(cleaned);
    
    if (hasCommaDecimal) {
      // Formato europeo: 1.234,56 -> 1234.56
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato americano: 1,234.56 -> 1234.56
      cleaned = cleaned.replace(/,/g, '');
    }

    const amount = parseFloat(cleaned);

    if (isNaN(amount)) {
      logger.warn('Monto no es número válido', { amountStr, cleaned });
      return 0;
    }

    return amount;

  } catch (error) {
    logger.error('Error parseando monto', { amountStr, error: error.message });
    return 0;
  }
}

/**
 * Extrae nombre del comercio de la descripción
 * Limpia información extra (códigos, ubicaciones, etc)
 */
function extractMerchant(description) {
  if (!description) return 'Unknown';

  let merchant = description.trim();

  // Remover códigos comunes
  merchant = merchant.replace(/\b\d{8,}\b/g, ''); // IDs largos
  merchant = merchant.replace(/\*+/g, '');        // Asteriscos

  // Remover ubicaciones (ciudad, país)
  merchant = merchant.replace(/\b[A-Z]{2,}\s+[A-Z]{2}\b/g, ''); // CO, US, etc

  // Tomar primera parte antes de caracteres especiales
  merchant = merchant.split(/[*-]/)[ 0];

  return merchant.trim() || 'Unknown';
}

/**
 * Determina si una transacción es débito (negativa) o crédito (positiva)
 * Para tarjetas de crédito, generalmente todos los gastos son débitos
 */
function determineSign(amount, description) {
  // Si ya es negativo, mantener
  if (amount < 0) return amount;

  const lower = description.toLowerCase();

  // Palabras que indican crédito (positivo)
  const creditKeywords = ['pago', 'payment', 'abono', 'credit', 'reverso'];
  
  if (creditKeywords.some(kw => lower.includes(kw))) {
    return amount; // Positivo
  }

  // Por defecto, gastos son negativos
  return -Math.abs(amount);
}

/**
 * Auto-categoriza transacción basado en merchant/descripción
 */
function autoCategory(merchant, description) {
  const text = `${merchant} ${description}`.toLowerCase();

  // Comida
  if (text.match(/restaurante|restaurant|cafe|food|comida|rappi|uber\s*eats|dominos|pizza/)) {
    return 'food';
  }

  // Transporte
  if (text.match(/uber|taxi|gasolina|gas|transporte|metro|bus/)) {
    return 'transport';
  }

  // Supermercado
  if (text.match(/super|market|tienda|carulla|exito|jumbo|d1/)) {
    return 'groceries';
  }

  // Entretenimiento
  if (text.match(/cine|netflix|spotify|amazon|prime|youtube|gaming/)) {
    return 'entertainment';
  }

  // Servicios
  if (text.match(/internet|telefono|celular|claro|movistar|tigo|netflix|spotify/)) {
    return 'services';
  }

  // Salud
  if (text.match(/farmacia|medicina|hospital|doctor|clinic/)) {
    return 'health';
  }

  // Pago
  if (text.match(/pago|payment|abono/)) {
    return 'payment';
  }

  return 'other';
}

module.exports = {
  parseStatementTables,
  normalizeDate,
  parseAmount,
  extractMerchant,
  determineSign,
  autoCategory
};

