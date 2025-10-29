# 🔍 Guía de AWS X-Ray - Finance Bot API

## ✅ X-Ray está ACTIVADO

He activado X-Ray en todas las funciones Lambda:
- ✅ Worker Lambda (pdf-processor)
- ✅ Presign Lambda (upload-url)
- ✅ Auth0 Authorizer
- ✅ Get Transactions
- ✅ List Documents
- ✅ Get Document Detail

**Costo**: ~$0/mes (dentro de la capa gratuita permanente)

## 🎯 Beneficios de X-Ray

### 1. **Service Map Visual** 📊
- Ver el flujo completo de requests
- Identificar cuellos de botella
- Ver qué servicios se comunican

### 2. **Traces Detallados** 🔍
- Tiempo exacto de cada paso
- Llamadas a S3, DynamoDB, SQS
- Errores y excepciones automáticos

### 3. **Métricas de Performance** ⏱️
- Latencia P50, P90, P99
- Tasa de errores
- Throughput

## 📊 Cómo Acceder a X-Ray

### Opción 1: Consola AWS (Más visual)

1. **Ir a la consola de X-Ray**:
   ```
   https://console.aws.amazon.com/xray/home?region=us-east-2
   ```

2. **Service Map**:
   - En el menú izquierdo, click en "Service map"
   - Verás un diagrama visual de tu aplicación
   - Los nodos rojos indican errores
   - Los números muestran latencia promedio

3. **Traces**:
   - Click en "Traces" en el menú izquierdo
   - Filtra por servicio: `FinanceBotApiV2Stack-PdfWorkerLambda*`
   - Click en cualquier trace para ver detalles

### Opción 2: Desde Lambda (Más rápido)

1. **Ir a tu función Lambda**:
   ```
   https://console.aws.amazon.com/lambda/home?region=us-east-2#/functions/FinanceBotApiV2Stack-PdfWorkerLambdaB52A647C-eR9Yd26QuvGm
   ```

2. **Tab "Monitor"** → **Traces**:
   - Verás los traces de las últimas ejecuciones
   - Click en cualquier trace para ver detalles

## 🔍 Debugging con X-Ray

### Escenario: PDF se queda en "EXTRACTING_TEXT"

#### Paso 1: Ver el Service Map

```
https://console.aws.amazon.com/xray/home?region=us-east-2#/service-map
```

Busca:
- ¿El Worker Lambda se está ejecutando?
- ¿Hay errores (nodos rojos)?
- ¿Qué servicio toma más tiempo?

#### Paso 2: Ver Traces del Worker

1. Ve a **Traces** en X-Ray
2. Filtra por:
   - Service: `PdfWorkerLambda`
   - Time range: Last 10 minutes
   - Status: All o Error (si hay errores)

3. **Ordena por Latency** (más lento primero)
   - Los traces lentos indican dónde se está atorando

#### Paso 3: Analizar un Trace Específico

Click en un trace y verás:

```
┌─ Lambda Invocation (15s total)
│  ├─ SQS Receive Message (0.1s)
│  ├─ S3 GetObject (0.5s)
│  ├─ DynamoDB UpdateItem (0.2s) ← Actualizando estado
│  ├─ [Subsegment] extractTextFromPDF (10s) ← ⚠️ AQUÍ TOMA MÁS TIEMPO
│  │   ├─ S3 GetObject (0.3s)
│  │   └─ [Subsegment] pdftotext (9.5s) ← El problema está aquí
│  ├─ DynamoDB UpdateItem (0.2s)
│  ├─ DynamoDB BatchWriteItem (1s)
│  └─ DynamoDB UpdateItem (0.2s)
```

Esto te dice **exactamente** dónde se está tardando.

## 🚨 Errores Comunes en X-Ray

### 1. **Trace muestra error en S3**
```
S3 GetObject → Error: AccessDenied
```
**Solución**: Problema de permisos IAM

### 2. **Trace muestra timeout**
```
Lambda Invocation → Error: Task timed out after 15.00 seconds
```
**Solución**: Aumentar timeout de Lambda

### 3. **Trace muestra DynamoDB throttling**
```
DynamoDB UpdateItem → Error: ProvisionedThroughputExceededException
```
**Solución**: Cambiar a On-Demand o aumentar capacidad

## 📈 Métricas Útiles

### Ver métricas en X-Ray Console:

1. **Service Map** → Click en un nodo
2. Verás:
   - **Average Latency**: Tiempo promedio
   - **Error Rate**: % de errores
   - **Throughput**: Requests por segundo

### Ver métricas en CloudWatch:

X-Ray envía métricas automáticas a CloudWatch:
```bash
# Ver latencia del Worker Lambda
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=FinanceBotApiV2Stack-PdfWorkerLambdaB52A647C-eR9Yd26QuvGm \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average,Maximum,Minimum
```

## 🎯 Workflow de Debug Recomendado

### Cuando subes un PDF:

1. **Sube el PDF** desde tu frontend

2. **Ve a X-Ray Service Map** (refresca después de 30 segundos)
   ```
   https://console.aws.amazon.com/xray/home?region=us-east-2#/service-map
   ```

3. **Busca el trace más reciente**:
   - Click en "Traces"
   - Ordena por "Time" (más reciente primero)
   - Click en el primer trace

4. **Analiza el timeline**:
   - ¿Dónde toma más tiempo?
   - ¿Hay errores rojos?
   - ¿Qué subsegmento es el problema?

5. **Combina con logs de CloudWatch**:
   ```bash
   ./view-all-logs.sh
   ```
   - Los logs te dan detalles
   - X-Ray te da el contexto visual

## 🔧 Comandos Útiles

### Ver traces recientes del Worker:

```bash
aws xray get-trace-summaries \
  --start-time $(date -u -d '10 minutes ago' +%s) \
  --end-time $(date -u +%s) \
  --filter-expression 'service(id(name: "PdfWorkerLambda", type: "AWS::Lambda::Function"))'
```

### Ver un trace específico:

```bash
# Primero obtén el TraceId del comando anterior
aws xray batch-get-traces --trace-ids <TRACE_ID>
```

## 📊 Dashboard Recomendado

### Crear un dashboard simple:

1. Ve a CloudWatch Dashboard
2. Crea un nuevo dashboard "Finance-Bot-Debug"
3. Agrega widgets:
   - Lambda Duration (Worker)
   - Lambda Errors (Worker)
   - Lambda Invocations (Worker)
   - DynamoDB ConsumedReadCapacity
   - DynamoDB ConsumedWriteCapacity
   - X-Ray Service Map (widget)

## 🎓 Tips Pro

### 1. **Annotations personalizadas**

Puedes agregar annotations en el código para buscar traces específicos:

```javascript
const AWSXRay = require('aws-xray-sdk-core');

// En el código del worker
AWSXRay.getSegment().addAnnotation('documentId', documentId);
AWSXRay.getSegment().addAnnotation('userId', auth0UserId);
```

Luego filtra en X-Ray:
```
annotation.documentId = "abc-123-def"
```

### 2. **Metadata adicional**

```javascript
AWSXRay.getSegment().addMetadata('fileSize', fileSize);
AWSXRay.getSegment().addMetadata('hasPassword', hasPassword);
```

### 3. **Subsegmentos personalizados**

Ya agregamos subsegmentos automáticos en:
- extractTextFromPDF
- parseTransactions
- saveTransactions

Aparecerán en el timeline de X-Ray.

## 🔗 Enlaces Rápidos

- **X-Ray Console**: https://console.aws.amazon.com/xray/home?region=us-east-2
- **Service Map**: https://console.aws.amazon.com/xray/home?region=us-east-2#/service-map
- **Traces**: https://console.aws.amazon.com/xray/home?region=us-east-2#/traces
- **Worker Lambda**: https://console.aws.amazon.com/lambda/home?region=us-east-2#/functions/FinanceBotApiV2Stack-PdfWorkerLambdaB52A647C-eR9Yd26QuvGm

## 💡 Próximos Pasos

1. **Sube un PDF** para generar traces
2. **Ve a X-Ray Service Map** para ver el flujo visual
3. **Analiza el trace** más lento para identificar el problema
4. **Combina con logs** (`./view-all-logs.sh`) para detalles completos

---

**Última actualización**: $(date)


