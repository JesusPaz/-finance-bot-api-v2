# 🔐 Configuración de Auth0 en el Frontend

## ❌ PROBLEMA ACTUAL

Tu frontend tiene estos errores:
```
Missing Refresh Token (audience: 'https://projecthelena.com', scope: 'openid profile email offline_access')
401 Unauthorized
CORS blocked
```

---

## ✅ SOLUCIÓN

### **1. Configurar Auth0Provider correctamente**

En tu archivo donde inicializas Auth0 (probablemente `main.tsx` o `App.tsx`):

```tsx
import { Auth0Provider } from '@auth0/auth0-react';

<Auth0Provider
  domain="TU_AUTH0_DOMAIN.us.auth0.com"  // ← Reemplaza con tu domain
  clientId="TU_CLIENT_ID"                  // ← Reemplaza con tu Client ID
  authorizationParams={{
    redirect_uri: window.location.origin,
    audience: "https://projecthelena.com",  // ← ESTO DEBE COINCIDIR CON EL BACKEND
    scope: "openid profile email offline_access",  // ← AGREGAR offline_access
  }}
  cacheLocation="localstorage"  // ← Importante para refresh tokens
  useRefreshTokens={true}        // ← ACTIVAR refresh tokens
>
  <App />
</Auth0Provider>
```

---

### **2. Variables de entorno necesarias**

Crea un archivo `.env.local` en tu frontend:

```bash
# Auth0 Configuration
VITE_AUTH0_DOMAIN=tu-tenant.us.auth0.com
VITE_AUTH0_CLIENT_ID=tu_client_id_aqui
VITE_AUTH0_AUDIENCE=https://projecthelena.com
VITE_API_BASE_URL=https://ck6rsfm9rb.execute-api.us-east-2.amazonaws.com/prod
```

Y úsalas así:

```tsx
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

### **3. Configurar Auth0 Dashboard**

Ve a tu aplicación en Auth0 Dashboard y asegúrate de:

#### **a) Application Settings → Application URIs**
```
Allowed Callback URLs:
http://localhost:5173
http://localhost:5173/callback

Allowed Logout URLs:
http://localhost:5173

Allowed Web Origins:
http://localhost:5173

Allowed Origins (CORS):
http://localhost:5173
```

#### **b) Application Settings → Advanced Settings → Grant Types**
Asegúrate de que estos estén habilitados:
- ✅ Authorization Code
- ✅ Refresh Token

#### **c) API → Tu API (https://projecthelena.com)**
- Ve a "Settings"
- Habilita **"Allow Offline Access"**
- En "Token Settings":
  - Token Expiration: `86400` (24 horas)
  - Allow Skipping User Consent: ✅ (para desarrollo)

---

### **4. Hook personalizado para obtener token**

Si estás usando un hook personalizado (`useAuth.ts`), asegúrate de que se vea así:

```typescript
import { useAuth0 } from '@auth0/auth0-react';

export const useAuth = () => {
  const {
    isAuthenticated,
    isLoading,
    user,
    loginWithRedirect,
    logout,
    getAccessTokenSilently
  } = useAuth0();

  const getToken = async () => {
    try {
      const token = await getAccessTokenSilently({
        authorizationParams: {
          audience: import.meta.env.VITE_AUTH0_AUDIENCE,
          scope: "openid profile email offline_access",
        },
      });
      return token;
    } catch (error) {
      console.error('[auth] Error getting token:', error);
      // Si falla, redirigir al login
      await loginWithRedirect();
      throw error;
    }
  };

  return {
    isAuthenticated,
    isLoading,
    user,
    getToken,
    login: loginWithRedirect,
    logout: () => logout({ logoutParams: { returnTo: window.location.origin } }),
  };
};
```

---

### **5. Hacer requests con el token**

```typescript
// documentService.ts
import { useAuth } from './useAuth';

const getAuthHeaders = async (getToken: () => Promise<string>) => {
  try {
    const token = await getToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  } catch (error) {
    console.error('[documentService] Error getting auth headers:', error);
    throw error;
  }
};

export const listDocuments = async (getToken: () => Promise<string>, params?: { status?: string; limit?: number }) => {
  const headers = await getAuthHeaders(getToken);
  
  const queryParams = new URLSearchParams();
  if (params?.status) queryParams.append('status', params.status);
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE_URL}/documents?${queryParams}`,
    { headers }
  );
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.json();
};
```

---

### **6. Usar en tus componentes**

```tsx
// DocumentsList.tsx
import { useAuth } from '../hooks/useAuth';
import { listDocuments } from '../services/documentService';

export const DocumentsList = () => {
  const { getToken, isLoading, isAuthenticated } = useAuth();
  const [documents, setDocuments] = useState([]);

  useEffect(() => {
    if (!isAuthenticated || isLoading) return;

    const fetchDocuments = async () => {
      try {
        const data = await listDocuments(getToken, { limit: 50 });
        setDocuments(data.documents);
      } catch (error) {
        console.error('Error fetching documents:', error);
      }
    };

    fetchDocuments();
  }, [isAuthenticated, isLoading]);

  if (isLoading) return <div>Loading...</div>;
  if (!isAuthenticated) return <div>Please log in</div>;

  return (
    <div>
      {documents.map(doc => (
        <div key={doc.documentId}>{doc.filename}</div>
      ))}
    </div>
  );
};
```

---

## 🔑 **VALORES QUE NECESITAS**

Para configurar tu frontend correctamente, necesitas estos valores de Auth0:

| Variable | Dónde encontrarla |
|----------|-------------------|
| `AUTH0_DOMAIN` | Dashboard → Applications → Tu App → Domain |
| `CLIENT_ID` | Dashboard → Applications → Tu App → Client ID |
| `AUDIENCE` | Dashboard → APIs → Tu API → Identifier |

**IMPORTANTE:** El `AUDIENCE` en el frontend debe coincidir EXACTAMENTE con el configurado en el backend CDK.

---

## 🧪 **TESTING**

1. Limpia localStorage: `localStorage.clear()`
2. Recarga la app
3. Inicia sesión de nuevo
4. Verifica en DevTools → Application → Local Storage que veas:
   - `@@auth0spajs@@::TU_CLIENT_ID::https://projecthelena.com::openid profile email offline_access`

---

## 📌 **RESUMEN**

El problema NO es CORS, es que:
1. Tu frontend no está enviando un token válido
2. O el token no tiene el `audience` correcto
3. O Auth0 no está configurado para dar refresh tokens

Sigue estos pasos en orden y todo funcionará. 🚀

