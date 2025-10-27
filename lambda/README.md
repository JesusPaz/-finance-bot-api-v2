# Lambda Functions

Funciones Lambda organizadas por tipo y responsabilidad.

## 📁 Estructura

```
lambda/
├── api/                    # API Handlers (API Gateway)
│   └── upload-url.js       # POST /upload-url
├── workers/                # Background Workers (SQS/EventBridge)
│   └── pdf-processor.js    # Procesa PDFs desde SQS
├── shared/                 # Código compartido
│   ├── response.js         # Utilidades de respuesta HTTP
│   └── logger.js           # Logger consistente
├── package.json            # Dependencias
└── README.md
```

## 🎯 Tipos de Lambdas

### 📡 API Handlers (`api/`)
Funciones que responden a requests HTTP vía API Gateway.

**Características:**
- Timeout corto (10-30s)
- Memoria baja-media (256-512MB)
- Respuestas síncronas
- CORS habilitado

**Naming:** `[recurso]-[accion].js`
- `upload-url.js` - Genera URL de subida
- `list-expenses.js` - Lista expenses (TODO)
- `update-expense.js` - Actualiza expense (TODO)

### ⚙️ Workers (`workers/`)
Funciones que procesan tareas en background.

**Características:**
- Timeout largo (5-15min)
- Memoria media-alta (512-2048MB)
- Procesamiento asíncrono
- Triggered por SQS, EventBridge, etc.

**Naming:** `[dominio]-[accion].js`
- `pdf-processor.js` - Procesa PDFs
- `expense-categorizer.js` - Categoriza expenses (TODO)
- `report-generator.js` - Genera reportes (TODO)

### 🔧 Shared (`shared/`)
Código reutilizable entre funciones.

**Módulos:**
- `response.js` - Helpers para respuestas HTTP
- `logger.js` - Logging consistente
- `s3.js` - Operaciones S3 (TODO)
- `dynamodb.js` - Operaciones DynamoDB (TODO)
- `textract.js` - Integración Textract (TODO)

## 📝 Ejemplos

### Usar API Handler

```javascript
// api/list-expenses.js
const { success, badRequest } = require('../shared/response');
const { createLogger } = require('../shared/logger');

const logger = createLogger('list-expenses');

exports.handler = async (event) => {
  logger.info('Request recibido');
  
  const { month } = event.queryStringParameters || {};
  
  if (!month) {
    return badRequest('month es requerido');
  }
  
  // Lógica de negocio
  const expenses = await getExpenses(month);
  
  return success({ expenses });
};
```

### Usar Worker

```javascript
// workers/expense-categorizer.js
const { createLogger } = require('../shared/logger');

const logger = createLogger('expense-categorizer');

exports.handler = async (event) => {
  logger.info('Procesando batch', { 
    records: event.Records.length 
  });
  
  for (const record of event.Records) {
    await processExpense(record);
  }
  
  logger.info('Batch completado');
};
```

## 🚀 Desarrollo

### Instalar dependencias
```bash
cd lambda
npm install
```

### Agregar dependencia
```bash
cd lambda
npm install --save nombre-paquete
```

### Testing local (con SAM)
```bash
# API
sam local invoke UploadUrlFunction -e events/api-request.json

# Worker
sam local invoke PdfProcessorFunction -e events/sqs-event.json
```

## 📦 Deployment

CDK empaqueta automáticamente:
- Todos los archivos .js
- node_modules
- package.json

**No incluye:**
- node_modules/ (ya incluido en .gitignore)
- archivos de test
- README.md (documentación)

## 🎨 Convenciones

### Naming
- **Archivos:** kebab-case (`upload-url.js`)
- **Funciones:** camelCase (`processRecord`)
- **Constantes:** UPPER_SNAKE_CASE (`CORS_HEADERS`)

### Logging
```javascript
const { createLogger } = require('../shared/logger');
const logger = createLogger('mi-funcion');

logger.debug('Debug info', { data });
logger.info('Información general');
logger.warn('Advertencia');
logger.error('Error crítico', { error });
```

### Responses (APIs)
```javascript
const { success, badRequest, serverError } = require('../shared/response');

// Success
return success({ data: 'value' });

// Error
return badRequest('Campo requerido');
return serverError('Error interno', error.message);
```

## 📚 Próximas Funciones

### APIs
- [ ] `api/list-expenses.js` - GET /expenses
- [ ] `api/get-expense.js` - GET /expenses/:id
- [ ] `api/update-expense.js` - PUT /expenses/:id
- [ ] `api/delete-expense.js` - DELETE /expenses/:id
- [ ] `api/get-stats.js` - GET /stats

### Workers
- [ ] `workers/expense-categorizer.js` - Categoriza con IA
- [ ] `workers/duplicate-detector.js` - Detecta duplicados
- [ ] `workers/report-generator.js` - Genera reportes mensuales

### Shared
- [ ] `shared/s3.js` - Operaciones S3
- [ ] `shared/dynamodb.js` - Operaciones DynamoDB
- [ ] `shared/textract.js` - Integración Textract
- [ ] `shared/validation.js` - Validaciones comunes
- [ ] `shared/auth.js` - Helpers de autenticación

## 🔐 Variables de Entorno

Todas las funciones reciben:
- `BUCKET_NAME` - Bucket S3 para PDFs
- `TABLE_NAME` - Tabla DynamoDB (cuando se implemente)
- `LOG_LEVEL` - Nivel de logging (DEBUG|INFO|WARN|ERROR)

## 💡 Tips

- ✅ Mantener funciones pequeñas y enfocadas
- ✅ Usar shared/ para código reutilizable
- ✅ Logging consistente con createLogger
- ✅ Validar inputs en APIs
- ✅ Try/catch en workers para retry
- ✅ Documentar con JSDoc

