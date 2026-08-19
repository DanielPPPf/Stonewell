# Stonewell Client Portal — Roadmap / Fases pendientes

Estado a **2026-08-19**. Lo desplegado en producción (Fase 0 + Fase 1) está documentado
en `site/AUTH.md` §7 y `deploy/README.md`. Este archivo lista lo **pendiente**, por fase.

---

## Fase 2 — Subida de documentos por el cliente ("Enviar a Stonewell" / intake)

**Motivación.** Hoy solo el **staff** sube documentos (modelo data room = la firma
publica → el cliente consulta, acorde a una due diligence real y a lo que pidió el
cliente). Falta el flujo inverso: que el **cliente** entregue documentos **a la firma**
(KYC/AML, prueba de fondos, acreditación de inversionista, contratos/NDA firmados,
formularios fiscales W-8BEN, material solicitado).

**Principio de diseño.** NO es "el cliente añade al data room compartido". Es un
**buzón de entrada separado** (cliente → firma), porque el archivo que sube un cliente
es **input no confiable** y no debe mezclarse con el data room que el visor renderiza.

**Alcance propuesto.**
- Portal del cliente: nueva sección **"Requested Documents / Enviar a Stonewell"**,
  visualmente separada del Data Room (que sigue siendo solo-lectura para el cliente).
- Endpoint nuevo `POST /api/uploads` (cliente autenticado, scoped a su `sub`), a un
  **prefijo/bucket aparte** `intake/<sub>/…` que **solo el staff** lee.
- El staff ve las subidas en `admin.html`; opción (a decidir) de **"aprobar"** un
  documento subido y **promoverlo** al data room oficial del cliente.
- Notificación al staff cuando llega un archivo (SES; ver Fase 2 · notificaciones).

**Sanitización obligatoria (input no confiable).**
1. **Whitelist de tipo real por _magic bytes_**, no por extensión (PDF/JPG/PNG).
2. **Límite de tamaño** y **cuota por cliente**; presigned PUT con condiciones de
   `content-length-range` y `Content-Type`.
3. **Escaneo de malware**: GuardDuty Malware Protection for S3, o Lambda con ClamAV
   disparada por `s3:ObjectCreated` antes de exponerlo al staff.
4. **Nombre saneado** (sin path traversal ni caracteres de control) y
   `Content-Disposition: attachment` al servirlo.
5. **Aislamiento al visualizar**: el staff lo descarga/abre en origen aislado; nunca
   se auto-renderiza con privilegios.
6. **Auditoría** de cada subida (quién, qué, cuándo, IP) — reusar el patrón `LOG#`.
7. Opcional alto nivel: **CDR** (Content Disarm & Reconstruction) para reconstruir el
   archivo y neutralizar contenido activo.

**Decisión abierta (definir al implementar):** ¿el staff solo **recibe/notifica**, o
también puede **aprobar** una subida del cliente y moverla al data room oficial?

---

## Fase 2 — Otros módulos del portal (ya diseñados en el mockup, faltan de producir)
- **Secure Messages** — canal privado cliente ↔ partner (persistido en DynamoDB `MSG#`).
- **Fund Reports** — métricas de desempeño + cartas trimestrales.
- **Access Log (vista)** — el registro `LOG#` ya se captura; falta exponerlo al cliente.
- **Notificaciones SES** — avisar al cliente cuando se postea un documento o se agenda
  una llamada, y al staff cuando el cliente sube un documento (requiere configurar SES;
  hoy el email de Cognito es `COGNITO_DEFAULT`, ~50/día).

---

## Fase 3 — Hardening / operación
- **WAF + rate limiting** sobre la API.
- **Entorno `staging`** separado del de producción.
- **Deploy de Lambdas en el CI** (hoy se hace con `deploy/provision-api.sh`); requiere
  ampliar el rol OIDC con `lambda:UpdateFunctionCode`.
- **Export de auditoría** (descargar el `LOG#` de un cliente).
- **Rotar la IAM key admin expuesta** `AKIA…7OX5` (acción del usuario / Santiago).
- **MFA de respaldo** en la cuenta raíz (segundo dispositivo/llave).

---

## Hecho (referencia)
- ✅ Login Cognito + **MFA TOTP obligatorio** + gate Lambda@Edge (`/portal*`, `/admin*`).
- ✅ Backend propio: DynamoDB + S3 privado + API (HTTP API + JWT authorizer + Lambdas).
- ✅ Portal productizado (Overview + Data Room + Calendar) con datos reales por cliente.
- ✅ Seguridad de documentos por-documento (view-only con marca de agua / descarga).
- ✅ Consola de admin (crear clientes, subir docs, fijar métricas, agendar llamadas).
- ✅ Acceso visible al admin para staff desde el portal (2026-08-19).
