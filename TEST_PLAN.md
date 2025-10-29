# 🧪 Plan de Prueba - Finance Bot API

## ⚠️ IMPORTANTE: Debemos PROBAR primero

Hemos agregado herramientas de debug, pero **NO hemos probado** que el flujo funciona completamente.

## 🎯 Qué vamos a probar:

### Test 1: Upload Básico
1. ✅ Subir un PDF sin contraseña
2. ✅ Ver que aparece en `document-uploads` table
3. ✅ Ver que el Worker se ejecuta
4. ✅ Ver que extrae texto
5. ✅ Ver que parsea transacciones
6. ✅ Ver que guarda en DynamoDB
7. ✅ Ver que el estado cambia: PENDING → PROCESSING → EXTRACTING_TEXT → PARSING → COMPLETED

### Test 2: Verificar Datos
1. ✅ Las transacciones se guardaron en `finance-transactions`
2. ✅ El documento está en estado COMPLETED
3. ✅ Tiene `transactionsExtracted` > 0

## 🔍 Cómo probar AHORA:

### Terminal 1: Logs en tiempo real
```bash
cd /Users/jesus/personal/finance-bot-api-v2
./view-all-logs.sh
```

### Terminal 2: Subir archivo de prueba
```bash
# Verificar que existe el archivo de prueba
ls -lh data/Extracto_930905533_202510_TARJETA_VISA_0930.pdf

# Si no existe, necesitamos uno para probar
```

### Navegador: X-Ray Service Map
```
https://console.aws.amazon.com/xray/home?region=us-east-2#/service-map
```

## 📋 Checklist de Prueba:

### Pre-vuelo:
- [ ] Terminal con logs corriendo
- [ ] X-Ray Service Map abierto
- [ ] Frontend listo para subir archivo
- [ ] PDF de prueba disponible

### Durante el upload:
- [ ] Ver logs: "🚀 [DEBUG] ===== WORKER LAMBDA INICIADO ====="
- [ ] Ver logs: "📥 [DEBUG] Iniciando processRecord"
- [ ] Ver logs: "🔍 [DEBUG] INICIANDO EXTRACCIÓN DE TEXTO"
- [ ] Ver logs: "✅ [DEBUG] Texto extraído exitosamente"
- [ ] Ver logs: "📊 [DEBUG] Transacciones parseadas"
- [ ] Ver logs: "💾 [DEBUG] INICIANDO GUARDADO EN DYNAMODB"
- [ ] Ver logs: "🎉 [DEBUG] Marcando documento como completado"

### Después del upload:
- [ ] Verificar en DynamoDB: documento en estado COMPLETED
- [ ] Verificar en DynamoDB: transacciones guardadas
- [ ] Verificar en X-Ray: trace completo sin errores
- [ ] Verificar en frontend: archivo muestra estado COMPLETED

## 🚨 Si algo falla:

### Error en logs: "❌ [DEBUG] Error extrayendo texto"
**Problema**: pdftotext o qpdf falló
**Revisar**:
- ¿El PDF está corrupto?
- ¿Necesita contraseña?
- ¿qpdf está instalado en Lambda?

### Error en logs: "⚠️ [DEBUG] No se encontraron transacciones"
**Problema**: Parser no reconoce el formato
**Revisar**:
- Ver `firstChars` en logs (primeros 200 caracteres)
- Verificar que el PDF tiene "Nuevos movimientos" o "Movimientos"
- Ajustar el parser para el formato específico

### No aparece ningún log
**Problema**: Worker no se está ejecutando
**Revisar**:
- ¿El PDF se subió a `pdfs/` en S3?
- ¿SQS tiene mensajes?
- ¿Worker tiene permisos?

## 🎯 Comando para verificar estado:

```bash
# Ver mensajes en SQS
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-2.amazonaws.com/851725652296/pdf-processing-queue \
  --attribute-names All

# Ver PDFs en S3
aws s3 ls s3://finances-data-851725652296/pdfs/ --recursive

# Ver último documento subido
aws dynamodb scan \
  --table-name document-uploads \
  --limit 5 \
  --output json | jq '.Items | sort_by(.uploadedAt) | reverse | .[0]'

# Ver últimas transacciones
aws dynamodb scan \
  --table-name finance-transactions \
  --limit 5 \
  --output json | jq '.Items | sort_by(.createdAt) | reverse | .[0]'
```

## ✅ Criterios de Éxito:

**El sistema funciona correctamente si**:
1. ✅ Worker procesa el PDF sin errores
2. ✅ Documento cambia de estado: PENDING → ... → COMPLETED
3. ✅ Se extraen transacciones (count > 0)
4. ✅ Transacciones se guardan en DynamoDB
5. ✅ Todo toma < 30 segundos
6. ✅ X-Ray muestra el flujo completo

## ⚠️ NO estamos seguros hasta probar

**Necesitamos**:
1. Subir un archivo REAL
2. Ver los logs completos
3. Verificar que funciona end-to-end
4. Si falla, arreglar el problema específico que encontremos

---

**Status**: 🟡 LISTO PARA PROBAR (pero no garantizado)


