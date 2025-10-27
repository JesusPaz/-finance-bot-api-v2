# 📤 Guía Completa del Flujo de Upload

## 🎯 **Resumen del Sistema**

Tu API permite a usuarios autenticados con Auth0:
1. Subir PDFs bancarios (con o sin contraseña)
2. El sistema los procesa automáticamente
3. Extrae transacciones y las guarda en DynamoDB
4. Permite trackear el estado del procesamiento

---

## 🔐 **Autenticación**

**Todos los endpoints requieren Auth0 JWT** en el header:
```
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6...
```

El Lambda Authorizer valida el token y extrae:
- `auth0UserId`: ID del usuario (ej: `auth0|123456`)
- `email`: Email del usuario

---

## 📋 **FLUJO COMPLETO PASO A PASO**

### **PASO 1: Frontend solicita URL de subida**

```javascript
// Frontend
const response = await fetch('https://sckhlo86t6.execute-api.us-east-2.amazonaws.com/prod/upload-url', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${auth0Token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    filename: 'extracto-bancolombia-enero.pdf',
    password: '1061814443',         // OPCIONAL: Contraseña del PDF
    documentType: 'bank-statement'  // OPCIONAL: Tipo de documento
  })
});

const data = await response.json();
```

**Response:**
```json
{
  "documentId": "abc-123-def-456-uuid",
  "url": "https://finances-data-851725652296.s3.amazonaws.com/",
  "fields": {
    "key": "pdfs/auth0_123/abc-123-def-456-uuid-extracto.pdf",
    "x-amz-meta-auth0-user-id": "auth0|123",
    "x-amz-meta-document-id": "abc-123-def-456-uuid",
    "x-amz-meta-document-type": "bank-statement",
    "x-amz-meta-has-password": "true",
    "Content-Type": "application/pdf",
    "Policy": "...",
    "X-Amz-Signature": "..."
  },
  "key": "pdfs/auth0_123/abc-123-def-456-uuid-extracto.pdf",
  "expiresIn": 600,
  "maxSize": 20000000,
  "message": "Usa estos datos para subir tu PDF",
  "note": "Contraseña guardada para futuros documentos del mismo tipo"
}
```

**⚠️ IMPORTANTE:** Guarda el `documentId` para trackear el estado después.

---

### **PASO 2: Frontend sube PDF a S3**

```javascript
// Frontend hace POST directo a S3 (NO al backend)
const formData = new FormData();

// 1. Primero agregar todos los fields
Object.entries(data.fields).forEach(([key, value]) => {
  formData.append(key, value);
});

// 2. El archivo va AL FINAL
formData.append('file', pdfFile);

// 3. Subir a S3
const uploadResponse = await fetch(data.url, {
  method: 'POST',
  body: formData
  // NO enviar Content-Type header, el browser lo maneja
});

if (uploadResponse.ok) {
  console.log('✅ PDF subido exitosamente');
} else {
  console.error('❌ Error subiendo PDF:', await uploadResponse.text());
}
```

**¿Qué pasa ahora?**
- ✅ S3 recibe el archivo
- ✅ Lo guarda con metadata (userId, documentId, tipo, etc.)
- ✅ Dispara evento → SQS → Worker Lambda (automático)

---

### **PASO 3: Backend procesa automáticamente**

**El Worker Lambda se ejecuta automáticamente:**

```
1. 📨 Recibe evento de SQS con info del archivo
2. 📄 Lee metadata de S3
3. 🔄 Actualiza status → PROCESSING
4. 🔐 Si hasPassword=true:
   a. Busca contraseña en document-passwords table
   b. Actualiza status → DECRYPTING
   c. Desencripta con qpdf
5. 📝 Actualiza status → EXTRACTING_TEXT
6. 🔍 Extrae texto con pdftotext (Poppler)
7. 🔄 Actualiza status → PARSING
8. 📊 Parsea transacciones del texto
9. 💾 Guarda transacciones en DynamoDB (con deduplicación)
10. ✅ Actualiza status → COMPLETED
```

**Estados posibles:**
- `UPLOADED`: Acabas de crear la presigned URL
- `PROCESSING`: Worker empezó a procesar
- `DECRYPTING`: Desencriptando PDF con contraseña
- `EXTRACTING_TEXT`: Extrayendo texto con pdftotext
- `PARSING`: Parseando transacciones
- `COMPLETED`: ✅ Todo exitoso
- `PASSWORD_ERROR`: ❌ Contraseña incorrecta
- `FAILED`: ❌ Otro error

---

### **PASO 4: Frontend consulta estado**

**Opción A: Consultar un documento específico**
```javascript
const response = await fetch(
  `https://sckhlo86t6.execute-api.us-east-2.amazonaws.com/prod/documents/${documentId}`,
  {
    headers: {
      'Authorization': `Bearer ${auth0Token}`
    }
  }
);

const data = await response.json();
```

**Response:**
```json
{
  "document": {
    "documentId": "abc-123-def-456-uuid",
    "auth0UserId": "auth0|123",
    "filename": "extracto.pdf",
    "s3Key": "pdfs/auth0_123/abc-123-def-456-uuid-extracto.pdf",
    "documentType": "bank-statement",
    "hasPassword": true,
    "status": "COMPLETED",
    "statusEmoji": "✅",
    "statusMessage": "Documento procesado exitosamente",
    "uploadedAt": "2025-10-27T22:00:00.000Z",
    "processedAt": "2025-10-27T22:00:15.000Z",
    "transactionsExtracted": 45,
    "processingTimeMs": 3500,
    "processingTimeSec": "3.50",
    "fileSizeMB": "1.25",
    "canRetry": false
  }
}
```

**Opción B: Listar todos los documentos**
```javascript
const response = await fetch(
  'https://sckhlo86t6.execute-api.us-east-2.amazonaws.com/prod/documents?limit=50',
  {
    headers: {
      'Authorization': `Bearer ${auth0Token}`
    }
  }
);

const data = await response.json();
```

**Query params opcionales:**
- `status`: Filtrar por estado (ej: `?status=COMPLETED`)
- `limit`: Número de resultados (default: 50)
- `lastEvaluatedKey`: Para paginación

---

### **PASO 5: Consultar transacciones extraídas**

```javascript
const response = await fetch(
  'https://sckhlo86t6.execute-api.us-east-2.amazonaws.com/prod/transactions',
  {
    headers: {
      'Authorization': `Bearer ${auth0Token}`
    }
  }
);

const data = await response.json();
```

**Response:**
```json
{
  "transactions": [
    {
      "transactionId": "hash-de-la-transaccion",
      "auth0UserId": "auth0|123",
      "date": "2025-01-15",
      "merchant": "SUPERMERCADO XYZ",
      "amount": -50000,
      "amountStr": "50,000.00",
      "type": "DEBIT",
      "category": "UNCATEGORIZED",
      "sourceDocumentId": "abc-123-def-456-uuid",
      "documentType": "bank-statement",
      "createdAt": "2025-10-27T22:00:15.000Z"
    }
    // ... más transacciones
  ],
  "count": 45,
  "lastEvaluatedKey": "..."
}
```

---

## 🔐 **Manejo de Contraseñas**

### **Cómo funciona:**

1. **Primera vez con contraseña:**
   ```json
   POST /upload-url
   {
     "filename": "extracto.pdf",
     "password": "1061814443",
     "documentType": "bank-statement"
   }
   ```
   → Se guarda en `document-passwords` table con key `(auth0UserId, documentType)`

2. **Siguiente upload del mismo tipo:**
   ```json
   POST /upload-url
   {
     "filename": "extracto-febrero.pdf",
     "documentType": "bank-statement"
     // NO envías password
   }
   ```
   → El worker automáticamente busca la contraseña guardada

3. **Sobrescribir contraseña:**
   ```json
   POST /upload-url
   {
     "filename": "extracto-marzo.pdf",
     "password": "nueva-contraseña",
     "documentType": "bank-statement"
   }
   ```
   → Actualiza la contraseña guardada

### **Estructura en DynamoDB:**
```
document-passwords table:
  auth0UserId (PK): "auth0|123"
  documentType (SK): "bank-statement"
  password: "1061814443"
  updatedAt: "2025-10-27T22:00:00.000Z"
  userEmail: "user@example.com"
```

---

## 📊 **Estructura de Datos**

### **document-uploads Table:**
```javascript
{
  auth0UserId: "auth0|123",       // PK
  documentId: "abc-123-uuid",     // SK
  filename: "extracto.pdf",
  s3Key: "pdfs/auth0_123/abc-123-uuid-extracto.pdf",
  s3Bucket: "finances-data-851725652296",
  documentType: "bank-statement",
  hasPassword: true,
  status: "COMPLETED",
  statusComposite: "auth0|123#COMPLETED", // Para GSI
  uploadedAt: "2025-10-27T22:00:00.000Z",
  processingStartedAt: "2025-10-27T22:00:05.000Z",
  processedAt: "2025-10-27T22:00:15.000Z",
  fileSize: 1310720,
  transactionsExtracted: 45,
  processingTimeMs: 3500
}
```

**GSI:** `status-uploadedAt-index`
- PK: `statusComposite` (ej: `"auth0|123#COMPLETED"`)
- SK: `uploadedAt`

---

### **finance-transactions Table:**
```javascript
{
  auth0UserId: "auth0|123",       // PK
  transactionId: "hash-unique",   // SK (SHA256 de date+merchant+amount)
  date: "2025-01-15",
  merchant: "SUPERMERCADO XYZ",
  amount: -50000,
  amountStr: "50,000.00",
  type: "DEBIT",
  category: "UNCATEGORIZED",
  sourceDocumentId: "abc-123-uuid",
  documentType: "bank-statement",
  rawLine: "15/01/2025 SUPERMERCADO XYZ 50,000.00",
  createdAt: "2025-10-27T22:00:15.000Z"
}
```

**GSI:** `auth0UserId-date-index`
- PK: `auth0UserId`
- SK: `date`

**GSI:** `hash-idempotency-index`
- PK: `hash_idempotency` (para deduplicación)

---

## ⚠️ **Errores Comunes**

### **1. Error 401: Unauthorized**
```json
{ "error": "Usuario no autenticado" }
```
**Causa:** Token de Auth0 faltante o inválido
**Solución:** Verificar que envías `Authorization: Bearer <token>`

---

### **2. Error 400: Bad Request**
```json
{ "error": "filename es requerido" }
```
**Causa:** Falta `filename` en el body
**Solución:** Enviar `{ "filename": "archivo.pdf" }`

---

### **3. Error 500: S3 Upload Failed**
**Causa:** Fields en orden incorrecto en FormData
**Solución:** File debe ir AL FINAL del FormData

---

### **4. Status: PASSWORD_ERROR**
```json
{
  "status": "PASSWORD_ERROR",
  "errorMessage": "Error de contraseña: ..."
}
```
**Causa:** Contraseña incorrecta o no encontrada
**Solución:** Hacer nuevo upload con contraseña correcta

---

## 🧪 **Testing con cURL**

### **1. Obtener presigned URL:**
```bash
curl -X POST https://sckhlo86t6.execute-api.us-east-2.amazonaws.com/prod/upload-url \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "test.pdf",
    "password": "1061814443",
    "documentType": "bank-statement"
  }'
```

### **2. Subir a S3:**
```bash
# Guardar los fields del response anterior
curl -X POST "https://finances-data-851725652296.s3.amazonaws.com/" \
  -F "key=pdfs/..." \
  -F "x-amz-meta-auth0-user-id=..." \
  -F "Policy=..." \
  -F "X-Amz-Signature=..." \
  -F "file=@test.pdf"
```

### **3. Consultar estado:**
```bash
curl -X GET "https://sckhlo86t6.execute-api.us-east-2.amazonaws.com/prod/documents/DOCUMENT_ID" \
  -H "Authorization: Bearer YOUR_AUTH0_TOKEN"
```

---

## 🎨 **Ejemplo Completo en React**

```typescript
import { useAuth0 } from '@auth0/auth0-react';

async function uploadPDF(file: File) {
  const { getAccessTokenSilently } = useAuth0();
  const token = await getAccessTokenSilently();

  // 1. Obtener presigned URL
  const urlResponse = await fetch('/upload-url', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filename: file.name,
      password: '1061814443',
      documentType: 'bank-statement'
    })
  });

  const { documentId, url, fields } = await urlResponse.json();

  // 2. Subir a S3
  const formData = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    formData.append(key, value as string);
  });
  formData.append('file', file);

  await fetch(url, {
    method: 'POST',
    body: formData
  });

  // 3. Polling para trackear estado
  const pollStatus = async () => {
    const response = await fetch(`/documents/${documentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const { document } = await response.json();
    
    if (document.status === 'COMPLETED') {
      console.log('✅ Procesado!', document.transactionsExtracted);
      return document;
    } else if (document.status === 'FAILED' || document.status === 'PASSWORD_ERROR') {
      console.error('❌ Error:', document.errorMessage);
      throw new Error(document.errorMessage);
    } else {
      // Seguir polling
      await new Promise(resolve => setTimeout(resolve, 2000));
      return pollStatus();
    }
  };

  return await pollStatus();
}
```

---

## 📝 **Notas Finales**

1. ✅ **Deduplicación automática**: El sistema detecta transacciones duplicadas usando hash
2. ✅ **Contraseñas encriptadas**: Se guardan con AWS Managed Keys
3. ✅ **Archivos aislados por usuario**: Cada usuario solo puede ver sus PDFs
4. ✅ **Procesamiento asíncrono**: El worker procesa en background
5. ✅ **Tracking detallado**: Estados granulares para mejor UX

---

## 🔗 **API Endpoints**

```
Base URL: https://sckhlo86t6.execute-api.us-east-2.amazonaws.com/prod/

POST   /upload-url              → Generar presigned URL
GET    /documents               → Listar documentos
GET    /documents/{documentId}  → Detalle de documento
GET    /transactions            → Listar transacciones
```

**Todos requieren Auth0 JWT en header `Authorization`**

