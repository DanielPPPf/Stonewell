# Sistema de Login — Stonewell Capital Partners

> **Estado (actualizado):** el login ya **NO es un stub** — está conectado a
> **AWS Cognito** con **MFA TOTP obligatorio**, tokens JWT, y el portal
> (`portal.html`) está **protegido en el edge** por una función **Lambda@Edge** que
> verifica la firma del token antes de servir `/portal*`. Despliegue y operación:
> ver **`deploy/README.md`**. Este documento conserva el contexto de diseño.

Documentación del sistema de acceso de clientes (*Client Login*). El front-end
(validación, UX, i18n, accesibilidad) sigue como se describe abajo; la sección de
"backend" ya está implementada con Cognito (ver §5).

---

## 1. Resumen

El sitio es estático (HTML/CSS/JS vanilla, sin servidor ni build). Se añadió una
página de acceso de clientes consistente con la marca (navy + dorado), bilingüe
EN/ES, con validación de cliente, estados de carga/error y accesibilidad básica.

**Autenticación:** `login.js` valida las credenciales contra **AWS Cognito**
(`USER_PASSWORD_AUTH`) y luego exige **MFA TOTP**: en el primer ingreso muestra el
**enrolamiento** (QR + secreto, vía `associateSoftwareToken`/`verifySoftwareToken`);
en ingresos posteriores pide el **código de 6 dígitos** (`sendMFACode`). En éxito
guarda el **ID token (JWT)** en `sessionStorage` **y en una cookie `Secure`
(`stonewell_idt`)**, y redirige a `portal.html`. Los IDs públicos del pool/cliente
están en `assets/auth-config.js` (generados por `deploy/provision-cognito.sh`). Ver §5.

---

## 2. Archivos

| Archivo            | Estado     | Descripción |
|--------------------|------------|-------------|
| `login.html`       | **nuevo**  | Página de acceso de clientes. Header mínimo, tarjeta de login, marca/escudo, toggle de idioma. Marcada `noindex,nofollow`. |
| `login.css`        | **nuevo**  | Estilos de la página de login. Reutiliza las variables de marca de `styles.css`. |
| `login.js`         | **nuevo**  | i18n EN/ES, validación, mostrar/ocultar contraseña, estados de carga, y la autenticación real Cognito + flujos **MFA TOTP** (enrolamiento y reto). |
| `portal.js`        | **nuevo**  | Respaldo de UX del guard (el control real es el edge); limpia sesión y cookie al cerrar sesión. |
| `assets/vendor/`   | **nuevo**  | `amazon-cognito-identity.min.js` + `qrcode.min.js` (generador de QR offline para el enrolamiento TOTP). |
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

Sirviéndolo así, el login llama a Cognito de verdad: con un usuario válido se verá
el enrolamiento TOTP (primer ingreso) o el reto de código (ingresos siguientes). El
gate Lambda@Edge sobre `/portal*` solo aplica en CloudFront, no en el server local
(en local `portal.js` valida el token de `sessionStorage`).

---

## 5. Cómo funciona la autenticación (implementado)

No hay backend propio: **Cognito** es el servidor de identidad y la validación de
credenciales y de MFA ocurre allí, no en el navegador.

**Flujo en `login.js`** (usa `amazon-cognito-identity-js`, vendorizado):
1. `authenticateUser` con `USER_PASSWORD_AUTH`.
2. Como el pool tiene **MFA = ON (software token)**:
   - Primer ingreso → callback `mfaSetup` → `associateSoftwareToken` (devuelve el
     secreto base32) → se pinta el **QR** (`assets/vendor/qrcode.min.js`, offline) y
     el secreto → `verifySoftwareToken(code, …)` completa el enrolamiento y la sesión.
   - Ingresos siguientes → callback `totpRequired` → `sendMFACode(code, …,
     "SOFTWARE_TOKEN_MFA")`.
3. En éxito (`onSuccess`): se guarda el **ID token** en `sessionStorage` **y** en la
   cookie `stonewell_idt` (`Secure; SameSite=Strict; Max-Age=3600`).

**Gate del portal (server-side, en el edge):** una función **Lambda@Edge**
(`deploy/edge-auth/index.js`) corre en *viewer-request* sobre `/portal*` y **verifica
la firma RS256** del token contra el JWKS del pool, más `iss`/`aud`/`exp`/`token_use`.
Token válido → CloudFront sirve la página; ausente o inválido → `302` a `/login.html`.
Así el HTML del portal **nunca** se entrega a una petición anónima o falsificada.
La verificación previa en `portal.js` queda solo como respaldo de UX detrás del edge.

> La cookie no es `HttpOnly` (la fija JS para que el edge la lea), pero como el edge
> verifica la **firma**, no es falsificable; el riesgo residual es robo por XSS.

Operación, IDs de recursos y comandos: **`deploy/README.md`**.

---

## 6. Pendientes / fuera de alcance de esta entrega

- **Reset de contraseña automatizado** (hoy "olvidé mi contraseña" es manual, por
  referencia). Cognito soporta `forgotPassword`/`confirmForgotPassword`; conviene
  configurar **SES** antes de habilitarlo a volumen (hoy el email es `COGNITO_DEFAULT`,
  ~50/día).
- **API autenticada** para datos privados del portal (API Gateway + Lambda con
  *authorizer* de Cognito), cuando el portal sirva contenido real más allá del saludo.
- **Entorno `staging`** separado del de producción.

Ya implementado (antes pendiente): backend de autenticación (Cognito), MFA, portal
protegido y gate de rutas en el edge.
