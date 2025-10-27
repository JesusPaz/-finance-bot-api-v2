/**
 * AWS Textract Integration
 * 
 * Extrae datos de documentos financieros usando Textract.
 * Para extractos bancarios/tarjetas de crédito, usamos:
 * - AnalyzeDocument con TABLES para transacciones tabuladas
 * - AnalyzeExpense para facturas/recibos individuales
 */

const { 
  TextractClient, 
  AnalyzeDocumentCommand,
  AnalyzeExpenseCommand 
} = require('@aws-sdk/client-textract');

const { createLogger } = require('./logger');

const textract = new TextractClient();
const logger = createLogger('textract');

/**
 * Analiza un extracto bancario/tarjeta de crédito
 * Extrae tablas con transacciones
 * 
 * @param {string} bucket - Bucket S3
 * @param {string} key - Key del PDF
 * @returns {Object} Resultado con tablas extraídas
 */
async function analyzeStatement(bucket, key) {
  logger.info('Analizando extracto bancario', { bucket, key });

  try {
    const command = new AnalyzeDocumentCommand({
      Document: {
        S3Object: {
          Bucket: bucket,
          Name: key
        }
      },
      FeatureTypes: ['TABLES', 'FORMS'] // Extraer tablas y formularios
    });

    const response = await textract.send(command);
    
    logger.info('Textract completado', { 
      blocks: response.Blocks?.length,
      pages: response.DocumentMetadata?.Pages 
    });

    // Procesar bloques para extraer tablas
    const tables = extractTables(response.Blocks);
    
    logger.info('Tablas extraídas', { count: tables.length });

    return {
      tables,
      pages: response.DocumentMetadata?.Pages,
      raw: response
    };

  } catch (error) {
    logger.error('Error en Textract', { error: error.message });
    throw error;
  }
}

/**
 * Analiza un recibo o factura individual
 * 
 * @param {string} bucket - Bucket S3
 * @param {string} key - Key del PDF
 * @returns {Object} Datos del expense
 */
async function analyzeReceipt(bucket, key) {
  logger.info('Analizando recibo/factura', { bucket, key });

  try {
    const command = new AnalyzeExpenseCommand({
      Document: {
        S3Object: {
          Bucket: bucket,
          Name: key
        }
      }
    });

    const response = await textract.send(command);
    
    logger.info('AnalyzeExpense completado', {
      documents: response.ExpenseDocuments?.length
    });

    return parseExpenseResult(response);

  } catch (error) {
    logger.error('Error en AnalyzeExpense', { error: error.message });
    throw error;
  }
}

/**
 * Extrae tablas de los bloques de Textract
 * 
 * @param {Array} blocks - Bloques de Textract
 * @returns {Array} Tablas estructuradas
 */
function extractTables(blocks) {
  if (!blocks) return [];

  const tables = [];
  const blockMap = new Map();
  
  // Crear mapa de bloques por ID
  blocks.forEach(block => {
    blockMap.set(block.Id, block);
  });

  // Encontrar bloques de tipo TABLE
  const tableBlocks = blocks.filter(b => b.BlockType === 'TABLE');

  for (const tableBlock of tableBlocks) {
    const table = {
      rows: [],
      confidence: tableBlock.Confidence
    };

    if (!tableBlock.Relationships) continue;

    // Obtener celdas de la tabla
    const cellRelationship = tableBlock.Relationships.find(
      r => r.Type === 'CHILD'
    );

    if (!cellRelationship) continue;

    const cells = cellRelationship.Ids
      .map(id => blockMap.get(id))
      .filter(block => block && block.BlockType === 'CELL');

    // Organizar celdas por fila
    const rowMap = new Map();
    
    for (const cell of cells) {
      const rowIndex = cell.RowIndex;
      const colIndex = cell.ColumnIndex;
      
      if (!rowMap.has(rowIndex)) {
        rowMap.set(rowIndex, []);
      }

      const cellText = getCellText(cell, blockMap);
      
      rowMap.get(rowIndex)[colIndex - 1] = {
        text: cellText,
        confidence: cell.Confidence
      };
    }

    // Convertir mapa a array ordenado
    table.rows = Array.from(rowMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([_, cells]) => cells);

    tables.push(table);
  }

  return tables;
}

/**
 * Obtiene el texto de una celda
 */
function getCellText(cell, blockMap) {
  if (!cell.Relationships) return '';

  const childRelationship = cell.Relationships.find(r => r.Type === 'CHILD');
  if (!childRelationship) return '';

  const words = childRelationship.Ids
    .map(id => blockMap.get(id))
    .filter(block => block && block.BlockType === 'WORD')
    .map(block => block.Text)
    .join(' ');

  return words.trim();
}

/**
 * Parsea resultado de AnalyzeExpense
 */
function parseExpenseResult(response) {
  if (!response.ExpenseDocuments || response.ExpenseDocuments.length === 0) {
    return null;
  }

  const doc = response.ExpenseDocuments[0];
  const expense = {};

  // Extraer campos de summary
  if (doc.SummaryFields) {
    for (const field of doc.SummaryFields) {
      const type = field.Type?.Text?.toLowerCase();
      const value = field.ValueDetection?.Text;

      if (type && value) {
        expense[type] = value;
      }
    }
  }

  // Extraer line items si existen
  if (doc.LineItemGroups) {
    expense.items = [];
    for (const group of doc.LineItemGroups) {
      if (group.LineItems) {
        for (const item of group.LineItems) {
          const lineItem = {};
          if (item.LineItemExpenseFields) {
            for (const field of item.LineItemExpenseFields) {
              const type = field.Type?.Text?.toLowerCase();
              const value = field.ValueDetection?.Text;
              if (type && value) {
                lineItem[type] = value;
              }
            }
          }
          expense.items.push(lineItem);
        }
      }
    }
  }

  return expense;
}

/**
 * Detecta el tipo de documento
 * 
 * @param {string} key - Key del archivo
 * @returns {string} 'statement' o 'receipt'
 */
function detectDocumentType(key) {
  const lower = key.toLowerCase();
  
  if (lower.includes('extracto') || 
      lower.includes('statement') || 
      lower.includes('visa') ||
      lower.includes('mastercard')) {
    return 'statement';
  }
  
  return 'receipt';
}

/**
 * Calcula costo aproximado de llamada a Textract
 * 
 * Pricing (us-east-2):
 * - AnalyzeDocument: $1.50 por 1000 páginas
 * - AnalyzeExpense: $50.00 por 1000 páginas
 * 
 * @param {number} pages - Número de páginas
 * @param {string} type - 'statement' o 'receipt'
 * @returns {number} Costo en USD
 */
function estimateCost(pages, type = 'statement') {
  if (type === 'statement') {
    return (pages / 1000) * 1.50;
  } else {
    return (pages / 1000) * 50.00;
  }
}

module.exports = {
  analyzeStatement,
  analyzeReceipt,
  detectDocumentType,
  estimateCost,
  extractTables
};

