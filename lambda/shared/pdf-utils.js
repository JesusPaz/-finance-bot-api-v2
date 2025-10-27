/**
 * PDF Utilities
 * 
 * Maneja operaciones con PDFs, incluyendo:
 * - Detectar si un PDF está cifrado/protegido
 * - Desbloquear PDFs con contraseña
 * - Crear versiones sin contraseña para Textract
 */

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createLogger } = require('./logger');
const { PDFDocument } = require('pdf-lib');

const s3 = new S3Client();
const logger = createLogger('pdf-utils');

/**
 * Detecta si un PDF está cifrado/protegido
 * @param {Buffer} pdfBuffer - Buffer del PDF
 * @returns {boolean} True si está cifrado
 */
function isPdfEncrypted(pdfBuffer) {
  // Los PDFs cifrados tienen el marcador /Encrypt en el diccionario del trailer
  const pdfString = pdfBuffer.toString('latin1');
  return pdfString.includes('/Encrypt');
}

/**
 * Intenta desbloquear un PDF con una lista de contraseñas comunes
 * @param {string} bucket - Bucket de S3
 * @param {string} key - Key del PDF original
 * @param {Array<string>} passwords - Lista de contraseñas a probar
 * @returns {Object} { unlocked: boolean, unlockedKey: string, password: string }
 */
async function unlockPdf(bucket, key, passwords = []) {
  logger.info('Intentando desbloquear PDF', { 
    bucket, 
    key,
    passwordsToTry: passwords.length 
  });

  try {
    // Descargar el PDF original
    const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(getCommand);
    const pdfBuffer = await streamToBuffer(response.Body);

    logger.info('PDF descargado', { size: pdfBuffer.length });

    // Verificar si está cifrado
    if (!isPdfEncrypted(pdfBuffer)) {
      logger.info('PDF no está cifrado, no requiere desbloqueo');
      return { 
        unlocked: false, 
        unlockedKey: key, 
        password: null,
        wasEncrypted: false 
      };
    }

    logger.info('PDF está cifrado, intentando desbloquear');

  // Probar cada contraseña
  for (let i = 0; i < passwords.length; i++) {
    const password = passwords[i];
    try {
      logger.info(`Probando contraseña ${i + 1}/${passwords.length}`, { 
        password: password.substring(0, 4) + '***',
        length: password.length,
        fullPassword: password // Para debugging - mostrar contraseña completa
      });
      
      // Usar pdf-lib para cargar y desbloquear
      const pdfDoc = await PDFDocument.load(pdfBuffer, { 
        ignoreEncryption: false,
        password: password 
      });

      logger.info('✅ PDF desbloqueado exitosamente', { 
        usedPassword: password.substring(0, 4) + '***',
        fullPassword: password // Para debugging
      });

        // Guardar versión sin cifrado
        const unlockedBuffer = await pdfDoc.save({ useObjectStreams: false });
        
        // Subir a S3 en carpeta "unlocked/"
        const unlockedKey = key.replace('pdfs/', 'unlocked/');
        
        const putCommand = new PutObjectCommand({
          Bucket: bucket,
          Key: unlockedKey,
          Body: Buffer.from(unlockedBuffer),
          ContentType: 'application/pdf',
          Metadata: {
            'original-key': key,
            'unlocked-with-password': 'true'
          }
        });

        await s3.send(putCommand);
        
        logger.info('PDF desbloqueado guardado en S3', { unlockedKey });

        return {
          unlocked: true,
          unlockedKey,
          password,
          wasEncrypted: true
        };

      } catch (error) {
        // Si falla, probar siguiente contraseña
        logger.info('Contraseña incorrecta', { 
          password: password.substring(0, 4) + '***',
          error: error.message.substring(0, 50) 
        });
        continue;
      }
    }

    // Listar todas las contraseñas probadas para debugging
    logger.info('Contraseñas probadas', { 
      passwords: passwords.map(p => p.substring(0, 4) + '***')
    });

    // Si ninguna contraseña funcionó
    logger.error('No se pudo desbloquear el PDF con las contraseñas proporcionadas');
    throw new Error('PDF_LOCKED: No se pudo desbloquear. Contraseñas incorrectas.');

  } catch (error) {
    logger.error('Error desbloqueando PDF', { error: error.message });
    throw error;
  }
}

/**
 * Genera lista de contraseñas comunes para extractos bancarios
 * Basado en patrones comunes: número de documento, últimos dígitos, etc.
 * 
 * @param {string} documentNumber - Número de documento del usuario (opcional)
 * @param {Object} metadata - Metadata adicional que puede contener pistas
 * @returns {Array<string>} Lista de contraseñas a probar
 */
function generatePasswordList(documentNumber = null, metadata = {}) {
  const passwords = [];

  // Si se proporciona número de documento
  if (documentNumber) {
    passwords.push(documentNumber); // Completo
    
    // Últimos 4, 6, 8 dígitos
    if (documentNumber.length >= 4) {
      passwords.push(documentNumber.slice(-4));
    }
    if (documentNumber.length >= 6) {
      passwords.push(documentNumber.slice(-6));
    }
    if (documentNumber.length >= 8) {
      passwords.push(documentNumber.slice(-8));
    }
  }

  // Contraseñas comunes de bancos colombianos
  passwords.push('1234', '0000', '123456');

  // Si hay metadata con el filename, extraer números
  if (metadata.filename) {
    const numbers = metadata.filename.match(/\d+/g);
    if (numbers) {
      passwords.push(...numbers);
    }
  }

  // Remover duplicados
  return [...new Set(passwords)];
}

/**
 * Convierte un stream a buffer
 */
async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Procesa un PDF: lo desbloquea si es necesario y retorna la key lista para Textract
 * 
 * @param {string} bucket - Bucket de S3
 * @param {string} key - Key del PDF
 * @param {Object} options - { documentNumber, metadata }
 * @returns {Object} { key: string, wasUnlocked: boolean }
 */
async function preparePdfForTextract(bucket, key, options = {}) {
  logger.info('Preparando PDF para Textract', { bucket, key });

  const { documentNumber, metadata } = options;

  // Generar lista de contraseñas
  const passwords = generatePasswordList(documentNumber, metadata);

  // Intentar desbloquear
  const result = await unlockPdf(bucket, key, passwords);

  if (result.wasEncrypted && !result.unlocked) {
    throw new Error('No se pudo desbloquear el PDF');
  }

  return {
    key: result.unlockedKey,
    wasUnlocked: result.unlocked,
    password: result.password
  };
}

module.exports = {
  isPdfEncrypted,
  unlockPdf,
  generatePasswordList,
  preparePdfForTextract
};

