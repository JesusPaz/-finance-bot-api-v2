# 🔐 Configuración del Frontend con Auth0

## ✅ Variables de Auth0 Confirmadas

Estas son las variables que tu backend **YA TIENE configuradas**:

```bash
AUTH0_DOMAIN=finance-project-helena.us.auth0.com
AUTH0_AUDIENCE=https://projecthelena.com
AUTH0_ISSUER=https://finance-project-helena.us.auth0.com/
```

---

## 📱 Configuración del Frontend (React)

### **1. Instalar dependencias**

```bash
npm install @auth0/auth0-react
```

---

### **2. Configurar `Auth0Provider` en tu `main.tsx` o `App.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Auth0Provider
      domain="finance-project-helena.us.auth0.com"
      clientId="TU_CLIENT_ID_DE_AUTH0"  // ← REEMPLAZA ESTO
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: "https://projecthelena.com",  // ← DEBE COINCIDIR CON EL BACKEND
        scope: "openid profile email offline_access",  // ← IMPORTANTE: offline_access
      }}
      cacheLocation="localstorage"  // ← Para guardar refresh tokens
      useRefreshTokens={true}       // ← Para renovar tokens automáticamente
    >
      <App />
    </Auth0Provider>
  </React.StrictMode>
);
```

---

### **3. Crear hook personalizado para obtener tokens**

Crea un archivo `src/hooks/useAuth.ts`:

```typescript
import { useAuth0 } from '@auth0/auth0-react';

export const useAuth = () => {
  const {
    user,
    isAuthenticated,
    isLoading,
    loginWithRedirect,
    logout,
    getAccessTokenSilently,
  } = useAuth0();

  const getToken = async (): Promise<string | null> => {
    try {
      const token = await getAccessTokenSilently({
        authorizationParams: {
          audience: "https://projecthelena.com",
          scope: "openid profile email offline_access",
        },
      });
      return token;
    } catch (error) {
      console.error('Error getting access token:', error);
      return null;
    }
  };

  return {
    user,
    isAuthenticated,
    isLoading,
    loginWithRedirect,
    logout,
    getToken,
  };
};
```

---

### **4. Ejemplo: Llamar al API con autenticación**

```typescript
import { useAuth } from './hooks/useAuth';

function DocumentsList() {
  const { getToken } = useAuth();

  const fetchDocuments = async () => {
    try {
      const token = await getToken();
      
      if (!token) {
        console.error('No se pudo obtener el token');
        return;
      }

      const response = await fetch(
        'https://ck6rsfm9rb.execute-api.us-east-2.amazonaws.com/prod/documents?limit=50',
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('Documentos:', data);
      
    } catch (error) {
      console.error('Error fetching documents:', error);
    }
  };

  return (
    <div>
      <button onClick={fetchDocuments}>Ver Documentos</button>
    </div>
  );
}
```

---

## 🔧 Configuración en Auth0 Dashboard

### **1. Ir a tu aplicación en Auth0:**
- https://manage.auth0.com/dashboard/us/finance-project-helena/applications

### **2. En "Settings":**
- ✅ **Application Type**: Single Page Application
- ✅ **Allowed Callback URLs**: `http://localhost:5173, https://tu-dominio.com`
- ✅ **Allowed Logout URLs**: `http://localhost:5173, https://tu-dominio.com`
- ✅ **Allowed Web Origins**: `http://localhost:5173, https://tu-dominio.com`

### **3. En "Advanced Settings" → "Grant Types":**
- ✅ Implicit
- ✅ Authorization Code
- ✅ Refresh Token  ← **IMPORTANTE**

### **4. Copiar tu `Client ID`**
- Lo necesitas para configurar `Auth0Provider`

---

## ❌ Problema: `Missing Refresh Token`

Si ves este error:
```
Missing Refresh Token (audience: 'https://projecthelena.com', scope: 'openid profile email offline_access')
```

**Solución:**
1. ✅ Verifica que en Auth0 Dashboard → Settings → Grant Types → **Refresh Token esté habilitado**
2. ✅ Verifica que `useRefreshTokens={true}` en `Auth0Provider`
3. ✅ Verifica que `offline_access` esté en el scope
4. ✅ Haz **logout** y vuelve a hacer **login** (para obtener un nuevo refresh token)

---

## ✅ Verificar que todo funciona

1. **Login exitoso**: El usuario se redirige a Auth0 y regresa a tu app
2. **Token válido**: `getToken()` retorna un JWT sin errores
3. **API funciona**: Las llamadas al backend retornan 200 (no 401)
4. **CORS OK**: No hay errores de CORS en la consola

---

## 📝 Variables de Entorno para el Frontend

Crea un archivo `.env` en tu frontend:

```bash
VITE_AUTH0_DOMAIN=finance-project-helena.us.auth0.com
VITE_AUTH0_CLIENT_ID=tu_client_id_aqui
VITE_AUTH0_AUDIENCE=https://projecthelena.com
VITE_API_URL=https://ck6rsfm9rb.execute-api.us-east-2.amazonaws.com/prod
```

Y úsalo así:

```typescript
<Auth0Provider
  domain={import.meta.env.VITE_AUTH0_DOMAIN}
  clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
  authorizationParams={{
    redirect_uri: window.location.origin,
    audience: import.meta.env.VITE_AUTH0_AUDIENCE,
    scope: "openid profile email offline_access",
  }}
  cacheLocation="localstorage"
  useRefreshTokens={true}
>
  <App />
</Auth0Provider>
```

---

## 🎉 Resultado Final

Una vez configurado, tu frontend podrá:
- ✅ Autenticar usuarios con Auth0
- ✅ Obtener tokens automáticamente
- ✅ Renovar tokens sin pedirle al usuario que vuelva a hacer login
- ✅ Llamar a todos los endpoints del backend con autenticación
- ✅ Ver documentos, transacciones, y subir PDFs

---

## 🆘 ¿Necesitas ayuda?

1. Verifica la consola del navegador para errores
2. Verifica los logs de CloudWatch del Lambda Authorizer
3. Usa `jwt.io` para decodificar tu token y ver que el `audience` sea correcto

