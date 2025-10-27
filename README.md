# Finance Bot API v2

API serverless para procesar PDFs financieros con AWS.

## 🏗️ Arquitectura

```
Usuario → API Gateway → Lambda (Presign) → Presigned URL
                                             ↓
Usuario sube PDF → S3 → SQS Queue → Worker Lambda
```

## 🚀 Stack

- **Node.js 22** en todas las Lambdas
- **S3** para almacenar PDFs
- **SQS** para desacoplar procesamiento
- **Lambda** para lógica de negocio
- **API Gateway** para endpoints REST
- **CDK** para Infrastructure as Code

## 📦 Instalación

```bash
# Instalar dependencias CDK
npm install

# Instalar dependencias Lambda
cd lambda && npm install && cd ..

# Bootstrap CDK (primera vez)
cdk bootstrap --profile personal --account 851725652296 --region us-east-2

# Deploy
cdk deploy --profile personal
```

## 🌐 API

**Base URL:** `https://6s0wi178w0.execute-api.us-east-2.amazonaws.com/prod/`

### POST /upload-url
Obtiene una URL firmada para subir PDFs.

**Request:**
```json
{
  "filename": "extracto.pdf",
  "documentNumber": "1234567890"
}
```

**Nota importante sobre `documentNumber`:**
- 🔐 **Requerido para PDFs cifrados**: Los extractos bancarios suelen estar protegidos con contraseña
- La contraseña típicamente es el número de cédula/documento
- Si no se envía y el PDF está cifrado, el procesamiento fallará
- El sistema intentará automáticamente con variaciones (últimos 4, 6, 8 dígitos)

**Response:**
```json
{
  "url": "https://bucket.s3.amazonaws.com/",
  "fields": { "key": "...", "Policy": "...", "..." },
  "key": "pdfs/123-extracto.pdf"
}
```

## 📁 Estructura

```
finance-bot-api-v2/
├── bin/
│   └── finance-bot-api-v2.ts       # Entry point CDK
├── lib/
│   └── finance-bot-api-v2-stack.ts # Infraestructura
├── lambda/
│   ├── api/                        # API Handlers
│   │   └── upload-url.js           # POST /upload-url
│   ├── workers/                    # Background Workers
│   │   └── pdf-processor.js        # Procesa PDFs
│   ├── shared/                     # Código compartido
│   │   ├── response.js             # HTTP responses
│   │   └── logger.js               # Logging
│   ├── package.json                # Dependencias
│   └── README.md                   # Docs Lambda
├── package.json                     # CDK dependencies
└── README.md
```

## 🧪 Testing

```bash
# Obtener URL
curl -X POST https://6s0wi178w0.execute-api.us-east-2.amazonaws.com/prod/upload-url \
  -H "Content-Type: application/json" \
  -d '{"filename": "test.pdf"}'

# Ver logs del worker
aws logs tail /aws/lambda/FinanceBotApiV2Stack-PdfWorkerLambdaB52A647C-KBgS08WmZCpI \
  --follow --profile personal

# Listar PDFs
aws s3 ls s3://finances-data-851725652296/pdfs/ --profile personal
```

## 📊 Recursos AWS

- **Bucket:** `finances-data-851725652296`
- **Queue:** `pdf-processing-queue`
- **Region:** `us-east-2`
- **Account:** `851725652296`

## 🔧 Comandos CDK

```bash
# Ver cambios antes de deploy
cdk diff --profile personal

# Deploy
cdk deploy --profile personal

# Destruir stack
cdk destroy --profile personal

# Sintetizar CloudFormation
cdk synth
```

## 🔐 Manejo de PDFs Cifrados

Los extractos bancarios/financieros suelen estar protegidos con contraseña. El sistema maneja esto automáticamente:

### Flujo de Desbloqueo

1. **Cliente envía `documentNumber`** en el request de presigned URL
2. Se guarda como metadata en S3 junto con el PDF
3. Cuando el Worker procesa el PDF:
   - Detecta si está cifrado
   - Intenta desbloquear con lista de contraseñas:
     - Número de documento completo
     - Últimos 4, 6, 8 dígitos
     - Números extraídos del nombre del archivo
   - Si lo desbloquea, guarda versión sin cifrar en `unlocked/`
   - Usa la versión desbloqueada para Textract

### Carpetas en S3

- `pdfs/` - PDFs originales (pueden estar cifrados)
- `unlocked/` - PDFs desbloqueados (listos para Textract)

### Ejemplo de uso

```bash
# Con el script de prueba
./test-upload-with-password.sh

# O manualmente con curl
curl -X POST "$API_URL/upload-url" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "extracto.pdf",
    "documentNumber": "1234567890"
  }'
```

## 💰 Costos de AWS Textract

- **AnalyzeDocument** (extractos): $1.50 por 1,000 páginas
- **AnalyzeExpense** (facturas): $50.00 por 1,000 páginas

Para un extracto de 1 página: ~$0.0015 USD

## 🚧 TODO

- [x] Integrar AWS Textract para extraer datos
- [x] Parsear y categorizar transacciones
- [x] Manejo de PDFs cifrados
- [ ] Crear tabla DynamoDB para expenses
- [ ] Agregar autenticación (Auth0)
- [ ] API para listar/actualizar expenses

## 💡 Lambda Functions

### API: upload-url.js
- **Handler:** `api/upload-url.handler`
- **Runtime:** Node.js 22
- **Timeout:** 30s
- **Memory:** 256MB
- **Trigger:** API Gateway
- **Propósito:** Genera presigned URLs para subir PDFs

### Worker: pdf-processor.js
- **Handler:** `workers/pdf-processor.handler`
- **Runtime:** Node.js 22
- **Timeout:** 15 minutos
- **Memory:** 1024MB
- **Trigger:** SQS (batch size: 1)
- **Propósito:** Procesa PDFs subidos a S3

### Shared
- `shared/response.js` - Utilidades para respuestas HTTP
- `shared/logger.js` - Logger consistente con contexto

## 📝 Variables de Entorno

Las Lambdas reciben automáticamente:
- `BUCKET_NAME`: Nombre del bucket S3
- `LOG_LEVEL`: Nivel de logging (INFO por defecto)

## 🔐 Seguridad

- ✅ Bucket S3 privado
- ✅ Encriptación en reposo
- ✅ Presigned URLs con expiración (10 min)
- ✅ IAM roles con permisos mínimos
- ⚠️ Sin autenticación en API (TODO)

## 💰 Costos

Estimado mensual (1000 PDFs):
- S3: ~$0.02
- Lambda: ~$0.10
- SQS: ~$0.01
- API Gateway: ~$0.04
- **Total: ~$0.20/mes**

## 🐛 Troubleshooting

### El worker no se ejecuta
```bash
# Verificar que el PDF se subió
aws s3 ls s3://finances-data-851725652296/pdfs/ --profile personal

# Ver logs
aws logs tail /aws/lambda/[WORKER_NAME] --follow --profile personal

# Ver mensajes en SQS
aws sqs receive-message \
  --queue-url https://sqs.us-east-2.amazonaws.com/851725652296/pdf-processing-queue \
  --profile personal
```

### Error al subir PDF
- Presigned URL expiró (10 min)
- Falta algún field en el POST
- PDF > 20MB

## 📚 Más Info

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [S3 Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [Lambda with SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)

## 📄 Licencia

MIT
