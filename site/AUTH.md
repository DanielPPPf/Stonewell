# Sistema de Login — Stonewell Capital Partners

> **Estado (actualizado):** el login ya **NO es un stub** — está conectado a
> **AWS Cognito** (autenticación real, validación server-side, tokens JWT) y hay un
> **portal protegido** (`portal.html`). Despliegue y operación: ver
> **`deploy/README.md`**. Este documento conserva el contexto de diseño y las
> recomendaciones de seguridad.

Documentación del sistema de acceso de clientes (*Client Login*). El front-end
(validación, UX, i18n, accesibilidad) sigue como se describe abajo; la sección de
"backend" ya está implementada con Cognito (ver §5).

---

## 1. Resumen

El sitio es estático (HTML/CSS/JS vanilla, sin servidor ni build). Se añadió una
página de acceso de clientes consistente con la marca (navy + dorado), bilingüe
EN/ES, con validación de cliente, estados de carga/error y accesibilidad básica.

**Autenticación:** la función `authenticate()` en `login.js` valida las credenciales
contra **AWS Cognito** (flujo `USER_PASSWORD_AUTH`). En éxito guarda el **ID token
(JWT)** en `sessionStorage` y redirige a `portal.html`, que valida el token en cada
carga y, si falta o expiró, redirige a `login.html`. Los IDs públicos del pool/cliente
están en `assets/auth-config.js` (generados por `deploy/provision-cognito.sh`). Ver §5.

---

## 2. Archivos

| Archivo            | Estado     | Descripción |
|--------------------|------------|-------------|
| `login.html`       | **nuevo**  | Página de acceso de clientes. Header mínimo, tarjeta de login, marca/escudo, toggle de idioma. Marcada `noindex,nofollow`. |
| `login.css`        | **nuevo**  | Estilos de la página de login. Reutiliza las variables de marca de `styles.css`. |
| `login.js`         | **nuevo**  | i18n EN/ES, validación de campos, mostrar/ocultar contraseña, estados de carga, y el *stub* `authenticate()`. |
| `index.html`       | modificado | Enlace **Client Login / Acceso Clientes** añadido al nav principal. |
| `styles.css`       | modificado | Regla `.main-nav a.nav-login` (botón dorado del nav). |

---

## 3. Funcionalidad incluida

- **Bilingüe EN/ES** con el mismo patrón `data-en` / `data-es` del sitio, más
  `data-ph-en` / `data-ph-es` para los *placeholders*. Respeta la preferencia
  guardada en `localStorage` (`stonewell-lang`), compartida con la página principal.
- **Validación de cliente**: email con formato válido, contraseña ≥ 8 caracteres,
  mensajes de error por campo (con `aria-live`) y validación en `blur` + corrección
  en vivo.
- **Mostrar/ocultar contraseña** con etiqueta traducida y `aria-pressed`.
- **Estados de UI**: spinner de carga, deshabilitado durante el envío, región de
  alerta (`role="alert"`) para errores y éxito.
- **"Recordarme"** y **"¿Olvidó su contraseña?"** (este último muestra una nota
  indicando que los restablecimientos se gestionan vía el contacto de Stonewell,
  acorde al modelo "solo por referencia").
- **Accesibilidad**: labels asociados, `aria-describedby`, `aria-invalid`,
  foco gestionado al fallar la validación, soporte de `prefers-reduced-motion`.

---

## 4. Cómo probar

Servir la carpeta `site/` (no abrir con `file://` para que el toggle de idioma y
`localStorage` funcionen de forma consistente):

```bash
cd site
python3 -m http.server 8000
# luego visitar http://localhost:8000/login.html
```

Con cualquier credencial válida en formato, el envío mostrará el error
"Invalid email or password" tras ~1s: es el comportamiento esperado del *stub*.

---

## 5. Conectar un backend (siguiente paso)

La autenticación debe ocurrir en el servidor. Reemplazar el cuerpo de
`authenticate()` en `login.js` por una llamada real, por ejemplo:

```js
const res = await fetch("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "include",            // recibir cookie de sesión HttpOnly
  body: JSON.stringify({ email, password, remember }),
});
if (res.ok)            return { ok: true, redirect: "portal.html" };
if (res.status === 401) return { ok: false, reason: "badCreds" };
if (res.status === 429) return { ok: false, reason: "locked" };
return { ok: false, reason: "network" };
```

Las claves de `reason` (`badCreds`, `locked`, `network`) ya están traducidas en el
objeto `I18N` de `login.js`. Para redirigir tras el login, descomentar la línea
`window.location.href` en el manejador de `submit`.

### Recomendaciones de seguridad para el backend
- **Nunca** validar credenciales ni almacenar contraseñas en el navegador.
- Hash de contraseñas con **bcrypt/argon2**; nunca en texto plano.
- Sesión vía **cookie `HttpOnly` + `Secure` + `SameSite`**, no `localStorage`.
- **Rate limiting / bloqueo** por intentos fallidos (devuelve 429 → `locked`).
- Servir todo el sitio bajo **HTTPS**.
- **CSRF token** si se usan cookies de sesión.
- Considerar **MFA** dado el perfil del portal (clientes/contrapartes).
- El flujo de "olvidé mi contraseña" hoy es manual (por referencia); si se
  automatiza, usar tokens de un solo uso con expiración.

---

## 6. Pendientes / fuera de alcance de esta entrega

- Backend de autenticación y endpoint `/api/auth/login`.
- Página del portal posterior al login (`portal.html`) y protección de rutas.
- Registro/alta de usuarios (probablemente por invitación, dado el modelo de negocio).
- Restablecimiento de contraseña automatizado.
