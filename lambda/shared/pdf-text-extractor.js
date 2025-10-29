/**
 * Extrae texto de PDFs usando qpdf + pdftotext (Poppler)
 */

// ✅ Importar X-Ray primero
const AWSXRay = require('aws-xray-sdk-core');

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const { createLogger } = require('./logger');

const execAsync = promisify(exec);
// ✅ Instrumentar S3 con X-Ray
const s3 = AWSXRay.captureAWSv3Client(new S3Client());
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
  
  logger.info('🔍 [DEBUG] === INICIO extractTextFromPDF ===', { bucket, key, hasPassword: !!password });
  
  try {
    // 1. Descargar PDF de S3
    logger.info('⬇️  [DEBUG] Descargando PDF de S3...');
    const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(getCommand);
    const pdfBuffer = await streamToBuffer(response.Body);
    
    logger.info('✅ [DEBUG] PDF descargado', { size: pdfBuffer.length });
    
    // 2. Guardar en archivo temporal
    const inputFile = `/tmp/input_${Date.now()}.pdf`;
    const outputFile = `/tmp/output_${Date.now()}.txt`;
    
    logger.info('💾 [DEBUG] Guardando PDF en archivo temporal', { inputFile });
    fs.writeFileSync(inputFile, pdfBuffer);
    logger.info('✅ [DEBUG] PDF guardado en archivo temporal');
    
    // 3. Si hay contraseña, desbloquear primero con qpdf
    let fileToExtract = inputFile;
    
    if (password) {
      logger.info('🔐 [DEBUG] Desbloqueando PDF con qpdf...');
      
      const unlockedFile = `/tmp/unlocked_${Date.now()}.pdf`;
      const passwordFile = `/tmp/password_${Date.now()}.txt`;
      
      logger.info('💾 [DEBUG] Guardando contraseña en archivo temporal');
      fs.writeFileSync(passwordFile, password);
      
      const qpdfCommand = `/usr/local/bin/qpdf --password-file="${passwordFile}" --decrypt "${inputFile}" "${unlockedFile}"`;
      logger.info('⚙️  [DEBUG] Ejecutando qpdf', { command: qpdfCommand });
      
      try {
        const { stdout, stderr } = await execAsync(qpdfCommand);
        logger.info('✅ [DEBUG] qpdf ejecutado exitosamente', { stdout, stderr });
        
        fileToExtract = unlockedFile;
        
        // Limpiar archivos temporales de desbloqueo
        fs.unlinkSync(passwordFile);
        fs.unlinkSync(inputFile);
        logger.info('🧹 [DEBUG] Archivos temporales de desbloqueo limpiados');
      } catch (error) {
        // Limpiar archivos temporales
        if (fs.existsSync(passwordFile)) fs.unlinkSync(passwordFile);
        if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
        
        logger.error('❌ [DEBUG] Error desbloqueando PDF', { 
          error: error.message,
          stderr: error.stderr,
          stdout: error.stdout
        });
        throw new Error('PDF_UNLOCK_FAILED: No se pudo desbloquear el PDF');
      }
    }
    
    // 4. Extraer texto con pdftotext
    logger.info('📄 [DEBUG] Extrayendo texto con pdftotext...');
    
    const pdftotextCommand = `pdftotext -layout "${fileToExtract}" "${outputFile}"`;
    logger.info('⚙️  [DEBUG] Ejecutando pdftotext', { command: pdftotextCommand });
    
    try {
      const { stdout, stderr } = await execAsync(pdftotextCommand);
      logger.info('✅ [DEBUG] pdftotext ejecutado', { stdout, stderr });
      
      // 5. Leer texto extraído
      logger.info('📖 [DEBUG] Verificando si existe archivo de salida', { outputFile });
      if (fs.existsSync(outputFile)) {
        logger.info('✅ [DEBUG] Archivo de salida existe, leyendo...');
        const text = fs.readFileSync(outputFile, 'utf-8');
        
        logger.info('✅ [DEBUG] Texto extraído exitosamente', {
          lengthChars: text.length,
          lengthLines: text.split('\n').length,
          firstChars: text.substring(0, 200)
        });
        
        // Limpiar archivos temporales
        logger.info('🧹 [DEBUG] Limpiando archivos temporales...');
        fs.unlinkSync(fileToExtract);
        fs.unlinkSync(outputFile);
        logger.info('✅ [DEBUG] Archivos temporales limpiados');
        
        logger.info('🎉 [DEBUG] === FIN extractTextFromPDF (EXITOSO) ===');
        return text;
      } else {
        logger.error('❌ [DEBUG] Archivo de salida no existe!', { outputFile });
        throw new Error('pdftotext no generó archivo de salida');
      }
      
    } catch (error) {
      // Limpiar archivos temporales en caso de error
      logger.error('❌ [DEBUG] Error en pdftotext, limpiando archivos...');
      if (fs.existsSync(fileToExtract)) fs.unlinkSync(fileToExtract);
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      
      logger.error('❌ [DEBUG] Error extrayendo texto', { 
        error: error.message,
        stderr: error.stderr,
        stdout: error.stdout
      });
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

