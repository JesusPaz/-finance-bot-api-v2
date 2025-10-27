/**
 * Extrae texto de PDFs usando qpdf + pdftotext (Poppler)
 */

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const { createLogger } = require('./logger');

const execAsync = promisify(exec);
const s3 = new S3Client();
const logger = createLogger('pdf-text-extractor');

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
 * Extrae texto de un PDF usando qpdf (para desbloquear) + pdftotext
 * 
 * @param {string} bucket - Nombre del bucket S3
 * @param {string} key - Key del PDF en S3
 * @param {object} options - Opciones de extracción
 * @param {string} options.password - Contraseña del PDF (opcional)
 * @returns {Promise<string>} - Texto extraído del PDF
 */
async function extractTextFromPDF(bucket, key, options = {}) {
  const { password } = options;
  
  logger.info('Extrayendo texto de PDF', { bucket, key, hasPassword: !!password });
  
  try {
    // 1. Descargar PDF de S3
    const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(getCommand);
    const pdfBuffer = await streamToBuffer(response.Body);
    
    logger.info('PDF descargado', { size: pdfBuffer.length });
    
    // 2. Guardar en archivo temporal
    const inputFile = `/tmp/input_${Date.now()}.pdf`;
    const outputFile = `/tmp/output_${Date.now()}.txt`;
    
    fs.writeFileSync(inputFile, pdfBuffer);
    
    // 3. Si hay contraseña, desbloquear primero con qpdf
    let fileToExtract = inputFile;
    
    if (password) {
      logger.info('Desbloqueando PDF con qpdf');
      
      const unlockedFile = `/tmp/unlocked_${Date.now()}.pdf`;
      const passwordFile = `/tmp/password_${Date.now()}.txt`;
      
      fs.writeFileSync(passwordFile, password);
      
      const qpdfCommand = `/usr/local/bin/qpdf --password-file="${passwordFile}" --decrypt "${inputFile}" "${unlockedFile}"`;
      
      try {
        await execAsync(qpdfCommand);
        logger.info('PDF desbloqueado exitosamente');
        
        fileToExtract = unlockedFile;
        
        // Limpiar archivos temporales de desbloqueo
        fs.unlinkSync(passwordFile);
        fs.unlinkSync(inputFile);
      } catch (error) {
        // Limpiar archivos temporales
        if (fs.existsSync(passwordFile)) fs.unlinkSync(passwordFile);
        if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
        
        logger.error('Error desbloqueando PDF', { error: error.message });
        throw new Error('PDF_UNLOCK_FAILED: No se pudo desbloquear el PDF');
      }
    }
    
    // 4. Extraer texto con pdftotext
    logger.info('Extrayendo texto con pdftotext');
    
    const pdftotextCommand = `pdftotext -layout "${fileToExtract}" "${outputFile}"`;
    
    try {
      await execAsync(pdftotextCommand);
      
      // 5. Leer texto extraído
      if (fs.existsSync(outputFile)) {
        const text = fs.readFileSync(outputFile, 'utf-8');
        
        logger.info('Texto extraído exitosamente', {
          lengthChars: text.length,
          lengthLines: text.split('\n').length
        });
        
        // Limpiar archivos temporales
        fs.unlinkSync(fileToExtract);
        fs.unlinkSync(outputFile);
        
        return text;
      } else {
        throw new Error('pdftotext no generó archivo de salida');
      }
      
    } catch (error) {
      // Limpiar archivos temporales en caso de error
      if (fs.existsSync(fileToExtract)) fs.unlinkSync(fileToExtract);
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      
      logger.error('Error extrayendo texto', { error: error.message });
      throw new Error('TEXT_EXTRACTION_FAILED: ' + error.message);
    }
    
  } catch (error) {
    logger.error('Error en extractTextFromPDF', { error: error.message });
    throw error;
  }
}

module.exports = {
  extractTextFromPDF
};

