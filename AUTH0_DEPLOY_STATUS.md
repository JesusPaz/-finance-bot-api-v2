# 🔐 Estado del Despliegue con Auth0

## 🚨 PROBLEMA IDENTIFICADO

El **Lambda Authorizer de Auth0** NO estaba recibiendo las variables de entorno correctas porque:

1. ✅ El `.env` **SÍ tiene** las variables de Auth0:
   ```bash
   AUTH0_DOMAIN=finance-project-helena.us.auth0.com
   AUTH0_AUDIENCE=https://projecthelena.com
   AUTH0_ISSUER=https://finance-project-helena.us.auth0.com/
   ```

2. ❌ Pero **CDK NO las lee automáticamente** del `.env`

3. ✅ **Solución implementada:** Script `./deploy.sh` que:
   - Carga las variables del `.env`
   - Las exporta al shell
   - Ejecuta `cdk deploy`

---

## 🔄 ACCIÓN EN CURSO

Estamos **recreando el stack completo desde cero** para asegurar que:

1. El `Auth0Authorizer` Lambda se cree con las variables correctas
2. El `TokenAuthorizer` de API Gateway se vincule correctamente
3. Todos los endpoints protegidos (`/documents`, `/transactions`, `/upload-url`) usen el Authorizer

---

## ✅ UNA VEZ DESPLEGADO, VERIFICA

### **1. Verifica que el Lambda Authorizer existe:**

```bash
aws lambda list-functions --profile personal \
  --query "Functions[?contains(FunctionName, 'Auth0')].FunctionName" \
  --output text
```

**Esperado:** Algo como `FinanceBotApiV2Stack-Auth0AuthorizerXXXXXX`

---

### **2. Verifica las variables de entorno del Authorizer:**

```bash
FUNCTION_NAME=$(aws lambda list-functions --profile personal \
  --query "Functions[?contains(FunctionName, 'Auth0')].FunctionName" \
  --output text)

aws lambda get-function-configuration --function-name $FUNCTION_NAME --profile personal \
  --query 'Environment.Variables' --output json
```

**Esperado:**
```json
{
  "AUTH0_DOMAIN": "finance-project-helena.us.auth0.com",
  "AUTH0_AUDIENCE": "https://projecthelena.com",
  "LOG_LEVEL": "INFO"
}
```

---

### **3. Prueba un endpoint protegido SIN token:**

```bash
curl -X GET "https://ck6rsfm9rb.execute-api.us-east-2.amazonaws.com/prod/documents?limit=5"
```

**Esperado:** 
```json
{"message":"Unauthorized"}
```

---

### **4. Prueba con un token VÁLIDO de Auth0:**

Desde tu frontend React, obtén un token y prueba:

```bash
curl -X GET "https://ck6rsfm9rb.execute-api.us-east-2.amazonaws.com/prod/documents?limit=5" \
  -H "Authorization: Bearer TU_TOKEN_AQUI"
```

**Esperado:** 200 OK con datos

---

## 📊 ENDPOINTS ACTUALES

Todos estos endpoints **REQUIEREN** autenticación con Auth0:

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/upload-url` | Obtener URL pre-firmada para subir PDF |
| GET | `/transactions` | Listar transacciones del usuario |
| GET | `/documents` | Listar documentos del usuario |
| GET | `/documents/{documentId}` | Detalle de un documento específico |

---

## 🆘 SI SIGUE DANDO 401

### **Paso 1: Revisar logs del Authorizer**

```bash
FUNCTION_NAME=$(aws lambda list-functions --profile personal \
  --query "Functions[?contains(FunctionName, 'Auth0')].FunctionName" \
  --output text)

aws logs tail /aws/lambda/$FUNCTION_NAME --follow --profile personal
```

### **Paso 2: Decodificar el token JWT**

Ve a https://jwt.io y pega tu token. Verifica que:
- ✅ `iss` (issuer) = `https://finance-project-helena.us.auth0.com/`
- ✅ `aud` (audience) = `https://projecthelena.com`
- ✅ El token no esté expirado (`exp` > ahora)

### **Paso 3: Verificar que el frontend envía el token correctamente**

```typescript
const token = await getAccessTokenSilently({
  authorizationParams: {
    audience: "https://projecthelena.com",  // ← DEBE COINCIDIR CON EL BACKEND
    scope: "openid profile email offline_access",
  },
});

console.log('Token obtenido:', token.substring(0, 20) + '...');

const response = await fetch('https://ck6rsfm9rb.execute-api.us-east-2.amazonaws.com/prod/documents', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});
```

---

## 🎯 RESULTADO ESPERADO

Después de este despliegue:

1. ✅ El Lambda Authorizer validará tokens JWT correctamente
2. ✅ Los endpoints protegidos rechazarán requests sin token (401)
3. ✅ Los endpoints protegidos aceptarán requests con token válido (200)
4. ✅ El usuario autenticado solo verá SUS datos (filtrado por `auth0UserId`)

---

## 📝 PRÓXIMOS PASOS (Para tu Frontend)

1. Configura `Auth0Provider` con las mismas credenciales
2. Obtén el `CLIENT_ID` de tu aplicación en Auth0 Dashboard
3. Implementa el hook `useAuth` para obtener tokens
4. Llama a los endpoints con el header `Authorization: Bearer ${token}`
5. Maneja errores 401 (redirigir a login)
6. Maneja tokens expirados (refresh automático con `useRefreshTokens={true}`)

---

## ✅ CHECKLIST FINAL

- [ ] Lambda Authorizer desplegado y con variables correctas
- [ ] API Gateway tiene el TokenAuthorizer configurado
- [ ] Endpoints protegidos retornan 401 sin token
- [ ] Endpoints protegidos retornan 200 con token válido
- [ ] Frontend configurado con Auth0Provider
- [ ] Frontend obtiene tokens correctamente
- [ ] CORS funciona (headers `Access-Control-Allow-Origin` presentes)
- [ ] Refresh tokens funcionan (no se pide re-login cada 10 minutos)


