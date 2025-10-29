# 🐛 Guía de Debug - Finance Bot API

## Problema Actual
El archivo PDF se sube correctamente pero se queda en estado "EXTRACTING_TEXT" y no progresa.

## ✅ Cambios Implementados

He agregado **logs de debug exhaustivos** en todos los pasos del procesamiento:

### 1. **Worker Lambda** (`lambda/workers/pdf-processor.js`)
- ✅ Logs al inicio y fin del handler
- ✅ Logs detallados en cada paso del procesamiento
- ✅ Logs de cada actualización de estado
- ✅ Logs de errores con stack traces completos

### 2. **PDF Text Extractor** (`lambda/shared/pdf-text-extractor.js`)
- ✅ Logs de descarga del PDF desde S3
- ✅ Logs de ejecución de qpdf (desbloqueo)
- ✅ Logs de ejecución de pdftotext
- ✅ Logs de limpieza de archivos temporales
- ✅ Muestra los primeros 200 caracteres del texto extraído

### 3. **Transaction Parser** (`lambda/shared/transaction-parser.js`)
- ✅ Logs al iniciar el parseo
- ✅ Logs cuando encuentra la sección de transacciones
- ✅ Logs por cada línea que tiene fecha y monto
- ✅ Logs al finalizar con resumen de transacciones

## 🔍 Cómo Ver los Logs

### Opción 1: Ver TODOS los logs (Recomendado para debug)

```bash
./view-all-logs.sh
```

Esto muestra todos los logs del Worker Lambda de los últimos 10 minutos en tiempo real.

También puedes especificar un período de tiempo:
```bash
./view-all-logs.sh 30m   # Últimos 30 minutos
./view-all-logs.sh 1h    # Última hora
./view-all-logs.sh 5m    # Últimos 5 minutos
```

### Opción 2: Ver solo logs con [DEBUG]

```bash
./view-logs.sh
```

Esto filtra solo los logs que contienen `[DEBUG]` para ver el flujo detallado.

## 📋 Proceso de Debug

### Paso 1: Iniciar monitoreo de logs

En una terminal, ejecuta:
```bash
./view-all-logs.sh
```

### Paso 2: Subir un archivo PDF

Desde tu frontend o usando curl/Postman, sube un archivo PDF.

### Paso 3: Observar los logs

Deberías ver una secuencia como esta:

```
🚀 [DEBUG] ===== WORKER LAMBDA INICIADO =====
📥 [DEBUG] Iniciando processRecord
🔍 [DEBUG] Parseando SQS body...
📦 [DEBUG] Evento S3 parseado
🔍 [DEBUG] INICIANDO EXTRACCIÓN DE TEXTO
📄 [DEBUG] Actualizando estado a EXTRACTING_TEXT
⏳ [DEBUG] Llamando a extractTextFromPDF...
🔍 [DEBUG] === INICIO extractTextFromPDF ===
⬇️  [DEBUG] Descargando PDF de S3...
✅ [DEBUG] PDF descargado
💾 [DEBUG] Guardando PDF en archivo temporal
✅ [DEBUG] PDF guardado en archivo temporal
📄 [DEBUG] Extrayendo texto con pdftotext...
⚙️  [DEBUG] Ejecutando pdftotext
✅ [DEBUG] pdftotext ejecutado
📖 [DEBUG] Verificando si existe archivo de salida
✅ [DEBUG] Archivo de salida existe, leyendo...
✅ [DEBUG] Texto extraído exitosamente
🎉 [DEBUG] === FIN extractTextFromPDF (EXITOSO) ===
✅ [DEBUG] extractTextFromPDF completado exitosamente
✅ [DEBUG] Texto extraído
🔍 [DEBUG] INICIANDO PARSEO DE TRANSACCIONES
📊 [DEBUG] Actualizando estado a PARSING
⏳ [DEBUG] Llamando a parseTransactions...
📊 [DEBUG] === INICIO parseTransactions ===
🔍 [DEBUG] Iniciando búsqueda de transacciones
✅ [DEBUG] Sección de transacciones encontrada en línea XX
💰 [DEBUG] Línea XX tiene fecha y monto
✅ [DEBUG] Transacciones parseadas
🎉 [DEBUG] === FIN parseTransactions ===
✅ [DEBUG] parseTransactions completado
💾 [DEBUG] INICIANDO GUARDADO EN DYNAMODB
⏳ [DEBUG] Llamando a saveTransactions...
✅ [DEBUG] saveTransactions completado
✅ [DEBUG] Transacciones guardadas
🎉 [DEBUG] Marcando documento como completado
✅ [DEBUG] Record 1/1 procesado exitosamente
🎉 [DEBUG] ===== WORKER COMPLETADO EXITOSAMENTE =====
```

## 🚨 Qué Buscar en los Logs

### Si se queda en "EXTRACTING_TEXT":

1. **¿Llegó al Worker Lambda?**
   - Busca: `🚀 [DEBUG] ===== WORKER LAMBDA INICIADO =====`
   - Si NO aparece: El problema está en SQS o en el trigger de S3

2. **¿Llegó al paso de extracción?**
   - Busca: `🔍 [DEBUG] INICIANDO EXTRACCIÓN DE TEXTO`
   - Si NO aparece: El problema está antes, en el parsing del evento

3. **¿Se ejecutó pdftotext?**
   - Busca: `⚙️  [DEBUG] Ejecutando pdftotext`
   - Si NO aparece: El problema está en descargar o guardar el PDF

4. **¿Falló pdftotext?**
   - Busca: `❌ [DEBUG] Error en pdftotext`
   - Si aparece: Hay un problema con la extracción de texto

5. **¿Extrajo texto pero está vacío?**
   - Busca: `✅ [DEBUG] Texto extraído exitosamente`
   - Revisa el campo `lengthChars` y `firstChars`

6. **¿No encontró transacciones?**
   - Busca: `⚠️  [DEBUG] No se encontraron transacciones en el PDF`
   - Si aparece: El parser no está detectando el formato del PDF

## 🔧 Problemas Comunes y Soluciones

### 1. El Worker no se ejecuta
**Síntoma**: No aparece ningún log después de subir el PDF

**Posibles causas**:
- El PDF no se está subiendo a la carpeta `pdfs/` en S3
- La notificación de S3 a SQS no está configurada correctamente
- El Worker Lambda no tiene permisos para leer de SQS

**Verificar**:
```bash
# Ver contenido del bucket S3
aws s3 ls s3://finances-data-851725652296/pdfs/ --recursive

# Ver mensajes en SQS
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-2.amazonaws.com/851725652296/pdf-processing-queue \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible
```

### 2. Error al extraer texto
**Síntoma**: `❌ [DEBUG] Error extrayendo texto`

**Posibles causas**:
- PDF protegido con contraseña
- PDF corrupto
- Problema con pdftotext o qpdf

**Solución**: Revisa el mensaje de error completo en los logs

### 3. No encuentra transacciones
**Síntoma**: `⚠️  [DEBUG] No se encontraron transacciones en el PDF`

**Posibles causas**:
- El formato del PDF es diferente al esperado
- El texto extraído no contiene la sección "Nuevos movimientos" o "Movimientos"

**Solución**: 
1. Revisa los primeros caracteres extraídos en: `firstChars`
2. Verifica que el PDF tiene el formato esperado

## 📊 Ver el Estado del Documento

Puedes consultar el estado actual del documento en DynamoDB:

```bash
# Listar todos los documentos de un usuario
aws dynamodb query \
  --table-name document-uploads \
  --key-condition-expression "auth0UserId = :userId" \
  --expression-attribute-values '{":userId":{"S":"TU_USER_ID"}}'

# Ver un documento específico
aws dynamodb get-item \
  --table-name document-uploads \
  --key '{"auth0UserId":{"S":"TU_USER_ID"},"documentId":{"S":"DOCUMENT_ID"}}'
```

## 🎯 Próximos Pasos

1. **Ejecuta** `./view-all-logs.sh` en una terminal
2. **Sube** un archivo PDF desde tu frontend
3. **Observa** los logs y busca dónde se detiene el proceso
4. **Comparte** los logs conmigo para ayudarte a resolver el problema

## 📞 Información de Contacto

Si necesitas ayuda adicional, comparte:
- Los logs completos desde `🚀 [DEBUG] ===== WORKER LAMBDA INICIADO =====` hasta donde se detiene
- El estado del documento en DynamoDB
- El tipo de PDF que estás subiendo

---

**Última actualización**: $(date)


