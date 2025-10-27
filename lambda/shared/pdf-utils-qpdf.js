/**
 * PDF Utilities con qpdf
 * 
 * Versión alternativa usando qpdf para desbloquear PDFs cifrados
 * qpdf es más robusto que pdf-lib para PDFs bancarios
 */

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createLogger } = require('./logger');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const s3 = new S3Client();
const logger = createLogger('pdf-utils-qpdf');

/**
 * Detecta si un PDF está cifrado usando qpdf
 */
async function isPdfEncrypted(pdfBuffer) {
  try {
    // Escribir buffer a archivo temporal
    const fs = require('fs');
    const path = require('path');
    const tmpFile = `/tmp/check_${Date.now()}.pdf`;
    
    fs.writeFileSync(tmpFile, pdfBuffer);
    
    // Usar qpdf para verificar si está cifrado
    const { stdout, stderr } = await execAsync(`/usr/local/bin/qpdf --check ${tmpFile}`);
    
    // Limpiar archivo temporal
    fs.unlinkSync(tmpFile);
    
    // Si qpdf puede leer sin contraseña, no está cifrado
    return stderr.includes('password required') || stderr.includes('encrypted');
    
  } catch (error) {
    logger.debug('Error verificando cifrado con qpdf', { error: error.message });
    return true; // Asumir cifrado si hay error
  }
}

/**
 * Desbloquea PDF usando qpdf
 */
async function unlockPdfWithQpdf(bucket, key, passwords = []) {
  logger.info('Desbloqueando PDF con qpdf', { 
    bucket, 
    key,
    passwordsToTry: passwords.length 
  });

  try {
    // Descargar PDF
    const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(getCommand);
    const pdfBuffer = await streamToBuffer(response.Body);
    
    logger.info('PDF descargado', { size: pdfBuffer.length });

    // Verificar si está cifrado
    const isEncrypted = await isPdfEncrypted(pdfBuffer);
    
    if (!isEncrypted) {
      logger.info('PDF no está cifrado, no requiere desbloqueo');
      return { 
        unlocked: false, 
        unlockedKey: key, 
        password: null,
        wasEncrypted: false 
      };
    }

    logger.info('PDF está cifrado, intentando desbloquear con qpdf');

    // Probar cada contraseña con qpdf
    for (let i = 0; i < passwords.length; i++) {
      const password = passwords[i];
      
      try {
        logger.info(`Probando contraseña ${i + 1}/${passwords.length}`, { 
          password: password.substring(0, 4) + '***',
          length: password.length 
        });

        const result = await unlockWithQpdf(pdfBuffer, password);
        
        if (result.success) {
          logger.info('✅ PDF desbloqueado exitosamente con qpdf', { 
            usedPassword: password.substring(0, 4) + '***' 
          });

          // Subir versión desbloqueada
          const unlockedKey = key.replace('pdfs/', 'unlocked/');
          
          const putCommand = new PutObjectCommand({
            Bucket: bucket,
            Key: unlockedKey,
            Body: result.buffer,
            ContentType: 'application/pdf',
            Metadata: {
              'original-key': key,
              'unlocked-with-qpdf': 'true',
              'password-used': password.substring(0, 4) + '***'
            }
          });

          // Normalizar el PDF para Textract (qpdf puede ayudar con esto)
          const normalizedFile = `/tmp/normalized_${Date.now()}.pdf`;
          const normalizeCommand = `/usr/local/bin/qpdf --normalize-content=y "${outputFile}" "${normalizedFile}"`;
          
          try {
            await execAsync(normalizeCommand);
            const normalizedBuffer = fs.readFileSync(normalizedFile);
            
            const putNormalizedCommand = new PutObjectCommand({
              Bucket: bucket,
              Key: unlockedKey,
              Body: normalizedBuffer,
              ContentType: 'application/pdf',
              Metadata: {
                'original-key': key,
                'unlocked-with-qpdf': 'true',
                'normalized': 'true',
                'password-used': password.substring(0, 4) + '***'
              }
            });
            
            await s3.send(putNormalizedCommand);
            fs.unlinkSync(normalizedFile);
            
            logger.info('PDF desbloqueado y normalizado guardado en S3', { unlockedKey });
          } catch (normalizeError) {
            logger.warn('No se pudo normalizar, guardando sin normalizar', { 
              error: normalizeError.message.substring(0, 100) 
            });
            
            await s3.send(putCommand);
            logger.info('PDF desbloqueado guardado en S3 (sin normalizar)', { unlockedKey });
          }

          return {
            unlocked: true,
            unlockedKey,
            password,
            wasEncrypted: true
          };
        }
        
      } catch (error) {
        logger.info('Contraseña incorrecta con qpdf', { 
          password: password.substring(0, 4) + '***',
          error: error.message.substring(0, 50) 
        });
        continue;
      }
    }

    // Si ninguna contraseña funcionó
    logger.error('No se pudo desbloquear el PDF con qpdf');
    throw new Error('PDF_LOCKED: No se pudo desbloquear con qpdf. Contraseñas incorrectas.');

  } catch (error) {
    logger.error('Error desbloqueando PDF con qpdf', { error: error.message });
    throw error;
  }
}

/**
 * Desbloquea un PDF usando qpdf con una contraseña específica
 */
async function unlockWithQpdf(pdfBuffer, password) {
  const fs = require('fs');
  const path = require('path');
  
  const inputFile = `/tmp/input_${Date.now()}.pdf`;
  const outputFile = `/tmp/output_${Date.now()}.pdf`;
  const passwordFile = `/tmp/password_${Date.now()}.txt`;
  
  try {
    // Escribir PDF a archivo temporal
    fs.writeFileSync(inputFile, pdfBuffer);
    
    // Escribir contraseña a archivo temporal
    fs.writeFileSync(passwordFile, password);
    
    // Usar qpdf instalado en la imagen Docker
    const qpdfPath = '/usr/local/bin/qpdf';
    
    // Usar archivo de contraseña en lugar de variable de entorno
    const command = `${qpdfPath} --password-file="${passwordFile}" --decrypt "${inputFile}" "${outputFile}"`;
    
    logger.info('Ejecutando qpdf', { 
      command: command.replace(password, '***'),
      passwordLength: password.length,
      usingPasswordFile: true
    });
    
    const { stdout, stderr } = await execAsync(command);
    
    // Verificar si se creó el archivo de salida
    if (fs.existsSync(outputFile)) {
      const unlockedBuffer = fs.readFileSync(outputFile);
      
      // Limpiar archivos temporales
      fs.unlinkSync(inputFile);
      fs.unlinkSync(outputFile);
      fs.unlinkSync(passwordFile);
      
      logger.info('PDF desbloqueado exitosamente con qpdf');
      return {
        success: true,
        buffer: unlockedBuffer
      };
    } else {
      throw new Error('qpdf no generó archivo de salida');
    }
    
  } catch (error) {
    logger.debug('Error con qpdf', { error: error.message });
    
    // Limpiar archivos temporales en caso de error
    try {
      if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      if (fs.existsSync(passwordFile)) fs.unlinkSync(passwordFile);
    } catch (cleanupError) {
      // Ignorar errores de limpieza
    }
    
    throw error;
  }
}

/**
 * Convierte stream a buffer
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
 * Genera lista de contraseñas (misma lógica que antes)
 */
function generatePasswordList(documentNumber = null, metadata = {}) {
  const passwords = [];

  if (documentNumber) {
    // PRIORIDAD 1: Contraseña completa
    passwords.push(documentNumber);
    
    // PRIORIDAD 2: Variaciones del número de documento
    if (documentNumber.length >= 4) {
      passwords.push(documentNumber.slice(-4));
    }
    if (documentNumber.length >= 6) {
      passwords.push(documentNumber.slice(-6));
    }
    if (documentNumber.length >= 8) {
      passwords.push(documentNumber.slice(-8));
    }
    
    // PRIORIDAD 3: Variaciones adicionales para números largos
    if (documentNumber.length >= 10) {
      passwords.push(documentNumber.slice(0, 8)); // Primeros 8 dígitos
      passwords.push(documentNumber.slice(2, 10)); // Dígitos del medio
    }
  }

  // Contraseñas comunes
  passwords.push('1234', '0000', '123456');

  // Números del nombre del archivo
  if (metadata.filename) {
    const numbers = metadata.filename.match(/\d+/g);
    if (numbers) {
      passwords.push(...numbers);
    }
  }

  // Eliminar duplicados y mantener orden de prioridad
  const uniquePasswords = [];
  for (const pwd of passwords) {
    if (!uniquePasswords.includes(pwd)) {
      uniquePasswords.push(pwd);
    }
  }

  logger.info('Contraseñas generadas', { 
    total: uniquePasswords.length,
    passwords: uniquePasswords.map(p => p.substring(0, 4) + '***'),
    fullPasswords: uniquePasswords // Para debugging - mostrar contraseñas completas
  });

  return uniquePasswords;
}

/**
 * Procesa PDF usando qpdf
 */
async function preparePdfForTextractWithQpdf(bucket, key, options = {}) {
  logger.info('Preparando PDF para Textract con qpdf', { bucket, key });

  const { documentNumber, metadata } = options;
  const passwords = generatePasswordList(documentNumber, metadata);

  const result = await unlockPdfWithQpdf(bucket, key, passwords);

  if (result.wasEncrypted && !result.unlocked) {
    throw new Error('No se pudo desbloquear el PDF con qpdf');
  }

  return {
    key: result.unlockedKey,
    wasUnlocked: result.unlocked,
    password: result.password
  };
}

module.exports = {
  isPdfEncrypted,
  unlockPdfWithQpdf,
  generatePasswordList,
  preparePdfForTextractWithQpdf
};
