# Stack tecnológico — Nutri Studio / milpa

Inventario del stack **real** del proyecto, actualizado al 20/10/2026, después de las fases 108 (Stripe), 109 (cuentas y auditoría) 110 (preparación para Docker), 111 (autenticación), 112 (migraciones de Prisma), 113 (Docker), 114 (CI), 115 (servidor) y 117 (documentos legales y consentimientos). Las diferencias se comprobaron contra el código en `VALIDACION_STACK_DOCKER.md`. `ARQUITECTURA.md` es el documento de planeación original y ya no coincide del todo con el código.

SaaS para nutriólogos en México, en español. Hay **una cuenta por nutriólogo**, que paga una suscripción y tiene acceso a todo. Lleva pacientes, consultas, expediente clínico, mediciones, diagnósticos PES, planes de alimentación con equivalentes SMAE, recetas, agenda, finanzas, tareas, plantillas y documentos PDF.

## 1. Usuarios y roles

- **Nutriólogo (cuenta o práctica).** Usa la app clínica día a día. Es una `Practice` con sus `User` (roles `OWNER`, `NUTRITIONIST`, `ASSISTANT`); en la práctica, un nutriólogo por cuenta.
- **Paciente.** No entra a la app. Recibe los PDF generados, que se le mandan por fuera (WhatsApp o correo, a mano).
- **Superadministrador.** Tiene su propio modelo, `AdminUser`, separado de `User`. Usa el panel del SaaS (`src/modules/admin/AdminApp.jsx`): crea cuentas, restablece contraseñas, suspende cuentas y ve suscripciones y pagos.

## 2. Frontend

| Pieza | Detalle |
|---|---|
| Framework | **React 19.2.8**: JSX, JavaScript sin TypeScript |
| Build | **Vite 8.2.2** con `@vitejs/plugin-react` 6.1.0 |
| Rutas | Sin librería de rutas. La navegación vive en el estado de `src/app/App.jsx`, más algunos query params (por ejemplo, `?seccion=` en Configuración) |
| Gráficas | **Recharts** (finanzas y progreso) |
| PDF | **pdfjs-dist** para la vista previa (`src/components/PdfPreviewModal.jsx`) |
| OCR | **tesseract.js** (español e inglés), en el navegador, para leer estudios de laboratorio (`src/lib/labs/readLabFile.js`) |
| Login con Google | **Google Identity Services**, el script de Google que se carga solo si el servidor tiene `GOOGLE_CLIENT_ID` (`src/lib/googleIdentity.js`) |
| Estilos | CSS a mano sin framework (`src/styles/globals.css`), con tokens en custom properties |
| Módulos | `src/modules/`: admin, auth, calendar, clinical-record, dashboard, documents, education, equivalences, finance, ingredients, nutrition-plan, patients, recipes, settings, tasks, templates |
| Pruebas | **Vitest 3.2**, para la lógica pura (`src/**/*.test.js`, `server/domain/*.test.js` y `prisma/tools/*.test.js`) |

## 3. Backend y API

| Pieza | Detalle |
|---|---|
| Framework | **Fastify 5.12.1** con `@fastify/cors` 11.3.0. Es un monolito: `server/index.js`, de unas 3,400 líneas y 119 rutas (REST bajo `/api/v1` más `/health`) |
| Lenguaje | **Node.js** con ESM (`"type": "module"`), en JavaScript plano. Versión objetivo: **24 LTS** (`.nvmrc`; las imágenes de Docker usan 24 y ahí pasan todas las pruebas); mínimo 22.13, porque `pdfjs-dist` 6.4 y npm 12 ya no aceptan Node 20 |
| Autenticación | JWT propio (`jsonwebtoken`) y contraseñas con **bcryptjs**. El token lleva `practiceId` y `sv`, la versión de sesión: cambiar la contraseña, que el administrador la restablezca o desvincular Google cierra las sesiones abiertas. El superadministrador usa otro token, firmado con su propio secreto (`ADMIN_JWT_SECRET`), con su propia versión de sesión (`AdminUser.sessionVersion`): salir del panel o `npm run admin:reset-password` cierran todas sus sesiones. La verificación sólo acepta HS256 |
| Protección del acceso | Límite de intentos en memoria (`server/domain/security.js`; cuenta el intento antes de comparar la contraseña, agrupa IPv6 por /64 y nunca suelta un bloqueo vigente al llenarse): 5 por IP y cuenta, 20 por IP y 30 por cuenta cada 15 min en el login; topes parecidos en el panel, Google y cambio de contraseña; responde **429** con `Retry-After`. Con un usuario inexistente se compara igual contra un hash de relleno, para no delatar qué cuentas existen. Con `NODE_ENV=production` la API no arranca si los secretos faltan, miden menos de 32 caracteres, son iguales o son los de ejemplo |
| Documentos legales | Fase 117. `src/lib/legal.js` (versiones, compartido con la API) y `src/modules/legal/` (textos en borrador para revisión legal, páginas públicas `/legal/terminos`, `/legal/privacidad` y `/legal/aviso-pacientes`, imprimible). Mientras un usuario no acepte la versión vigente de los términos y del aviso, la API responde **403** `LEGAL_ACCEPTANCE_REQUIRED` (salvo sesión, cambio de contraseña y las rutas legales) y la app muestra la pantalla para aceptarlos. Cada aceptación queda en `LegalAcceptance` (documento, versión, fecha, IP y navegador). El paciente guarda aparte el consentimiento de datos de salud (`consentDataAt` + `consentVersion`, nunca premarcado) y el de comunicación (`communicationConsentAt`); registrarlos o retirarlos queda en la bitácora |
| Encabezados | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y `Cache-Control: no-store` en todo lo que no fija su propio caché. CORS: cualquier origen en desarrollo; en producción sólo `CORS_ORIGINS` o `APP_URL`. `TRUST_PROXY` hace que la IP de la bitácora y del límite sea la del usuario detrás de Nginx |
| Multi-tenant | Cada consulta a la base se filtra por el `practiceId` de la sesión |
| Cuentas | Las primeras 100 las crea el administrador, con identificador (`loginId`) y contraseña temporal. Las demás se registran con Google (`signupSource` `ADMIN` o `GOOGLE`; las prácticas anteriores tienen `null` y nunca se bloquean). Se entra con correo o identificador |
| Acceso por suscripción | Sin una suscripción vigente, y pasados 7 días de gracia, la API responde **402** `SUBSCRIPTION_REQUIRED`, salvo en las rutas de cobro y de sesión. Una cuenta suspendida recibe **403**. El estado se guarda en caché 30 s |
| PDF | **pdfkit** dibuja a mano el plan de alimentación, los informes y el expediente, sin pasar por HTML |
| Dominio | `server/domain/` contiene lógica pura con pruebas en Vitest: cálculo energético y de macros, micronutrientes, equivalentes SMAE, nutrición y sugerencias de recetas, armado del PDF del plan, plantillas, cuentas (`accounts.js`), cobro (`billing.js`) y copia del catálogo (`catalogCopy.js`) |

## 4. Base de datos

| Pieza | Detalle |
|---|---|
| Motor | **PostgreSQL 16**. En desarrollo corre en Docker Compose (`postgres:16-alpine`) |
| Modelos | **27 modelos** y 9 enums en `prisma/schema.prisma` |
| ORM | **Prisma 6.19** con **migraciones** en `prisma/migrations/` desde la fase 112: línea base `0_init` (el esquema de la fase 111) y después un directorio por cambio. `npm run db:migrate` aplica lo pendiente y adopta una sola vez las bases creadas antes con `db push`, sólo si coinciden con `prisma/baseline/0_init.prisma`. En producción, `prisma migrate deploy`. Ya no se usa `db push` |
| Cuenta y acceso | `Practice` (la cuenta), `User`, `AdminUser` |
| Pacientes y consulta | `Patient`, `Appointment`, `Consultation`, `ClinicalSection`, `PatientSection`, `Measurement`, `Diagnosis`, `LabAttachment` |
| Plan y catálogo | `NutritionPlan`, `MealSlot`, `Recipe`, `RecipeIngredient`, `Ingredient`, `SmaeFood` (libro SMAE), `EducationMaterial`, `SuggestionChip` |
| Documentos y trabajo diario | `Document`, `Template`, `Task` |
| Legal | `LegalAcceptance` (fase 117) |
| Dinero | `FinanceEntry`, `Transaction`, `StripeEvent` (eventos de webhook procesados, para la idempotencia) |
| Auditoría | `AuditEvent` |
| Versionado clínico | Las mediciones, los diagnósticos y los planes se guardan por consulta: se crea una versión nueva en lugar de sobrescribir |
| Catálogo por cuenta | Cada cuenta nueva recibe una copia del catálogo base (alimentos, SMAE y recetas importadas) desde `CATALOG_PRACTICE_ID` |

## 5. Almacenamiento de archivos

**Disco local**, sin S3. Las carpetas están en `storage/`:

| Carpeta | Contenido | Variable para cambiarla |
|---|---|---|
| `documents/` | PDF generados (datos clínicos) | `DOCUMENT_STORAGE_PATH` |
| `lab-attachments/` | Estudios de laboratorio subidos (datos clínicos) | `LAB_ATTACHMENT_STORAGE_PATH` |
| `education-materials/` | Adjuntos de materiales educativos; se crea al subir el primero | `EDUCATION_ATTACHMENT_STORAGE_PATH` |
| `logos/` | Logo de cada práctica | `LOGO_STORAGE_PATH` |
| `ingredients/` | Fotos de ingredientes | `INGREDIENT_IMAGE_STORAGE_PATH` |
| `recipes/` | Las **501 fotos base del recetario, versionadas en git**, mezcladas con las fotos que suben los usuarios (`u-*.jpg`) | `RECIPE_IMAGE_STORAGE_PATH` |

Por esa mezcla, un volumen de Docker montado sobre `storage/recipes` oculta las fotos base: hay que sembrarlo la primera vez o separar las dos carpetas. `.dockerignore` deja fuera de la imagen todo `storage/` salvo esas fotos base.

## 6. Integraciones externas

| Servicio | Uso |
|---|---|
| **Stripe** (SDK `stripe` v18) | Suscripción mensual o anual en MXN con Checkout, Customer Portal y un webhook firmado e idempotente. `paidUntil` solo avanza con facturas pagadas. Por ahora está en **modo de prueba** |
| **Google** (`google-auth-library` v10 en el backend, Identity Services en el frontend) | Entrar y registrarse con Google. La cuenta se identifica por `googleSub`, nunca por el correo; vincular o desvincular Google se hace desde la sesión. La v11 de la librería pide Node 22 |
| **USDA FoodData Central** | Búsqueda de alimentos y valores nutrimentales (`server/providers/food.js`) |
| **Open Food Facts** | Búsqueda de alimentos, como complemento de USDA |

Pendientes:

- No hay IA integrada: los estudios de laboratorio se suben y se transcriben a mano.
- No hay integración de WhatsApp ni de correo: la entrega de un documento se marca a mano (`Document.deliveredAt`).

## 7. Almacenamiento en el navegador

- `localStorage` guarda el token de sesión del nutriólogo y, aparte, el del superadministrador.
- También guarda preferencias de la interfaz: `nutri.sidebar`, `nutri.documents.view` y `nutri.documents.guide`.
- Los datos clínicos no se guardan en el navegador: todo vive en la API y en PostgreSQL.

## 8. Configuración (.env)

`.env.example` documenta las variables de los primeros tres grupos; las rutas de almacenamiento y `SKIP_DB_SYNC` sólo están en el código.

- **Base:** `DATABASE_URL`, `PORT`, `JWT_SECRET`, `VITE_API_URL`, `DEFAULT_PRACTICE_ID`, `USDA_API_KEY`.
- **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `APP_URL`.
- **Cuentas:** `GOOGLE_CLIENT_ID` (sin él no aparece el botón de Google) y `CATALOG_PRACTICE_ID`.
- **Almacenamiento, opcionales:** `DOCUMENT_STORAGE_PATH`, `LOGO_STORAGE_PATH`, `LAB_ATTACHMENT_STORAGE_PATH`, `RECIPE_IMAGE_STORAGE_PATH`, `INGREDIENT_IMAGE_STORAGE_PATH`, `EDUCATION_ATTACHMENT_STORAGE_PATH`.
- **Seguridad (fase 111):** `ADMIN_JWT_SECRET` (obligatoria en producción), `CORS_ORIGINS` y `TRUST_PROXY`. `NODE_ENV` va en el entorno del servidor, no en `.env`.
- **Solo desarrollo:** `SKIP_DB_SYNC=1` salta `prisma/sync-dev.js`.
- **Scripts, no la API:** `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `ADMIN_NAME`, para `npm run admin:create`. `NODE_ENV=production` bloquea el seed y la práctica de demostración.

## 9. Desarrollo y herramientas

- `npm run dev:all` levanta la API (puerto 3001) y Vite (puerto 5173) con **concurrently**. Antes sincroniza la base con `prisma/sync-dev.js`.
- `npm test` corre las pruebas con **Vitest**.
- `npm run db:setup` crea el esquema, siembra la base e importa el SMAE, los alimentos base, los recetarios y la práctica de demostración (scripts en `prisma/`). **Solo para desarrollo:** el seed crea cuentas con contraseña conocida y, con `NODE_ENV=production`, tanto el seed como `import-demo-practice.js` se detienen antes de conectarse (`prisma/tools/devOnly.js`).
- `npm run admin:reset-password` cambia la contraseña de un administrador y cierra sus sesiones.
- `npm run admin:create` crea el primer administrador del panel con `ADMIN_EMAIL` y `ADMIN_PASSWORD` del entorno, sin imprimir la contraseña (`prisma/create-admin.js`).
- Las dependencias directas tienen versiones fijas: nada queda en `latest`. Para instalar exactamente las del lockfile, usar `npm ci`.
- **dotenv** carga las variables de entorno.
- Git y GitHub (`MrKrypthon/NutriStudio`): se trabaja en una rama por fase del roadmap y se integra con un PR a `main`.
- **CI** (GitHub Actions, `.github/workflows/ci.yml`): en cada PR, pruebas, build, que las migraciones coincidan con el esquema, y el stack de Docker levantado desde cero con `deploy/smoke.sh`.
- `package.json` declara `engines.node >=22.13`. La API y la CLI de Prisma están en `dependencies`; lo del frontend, en `devDependencies`.

## 10. Infraestructura y despliegue

Desde la fase 113 la app completa corre en contenedores con `docker-compose.app.yml` (detalle y comandos en el README, sección «La app completa en Docker»):

| Pieza | Detalle |
|---|---|
| `db` | `postgres:16.14-alpine`, red interna sin salida ni puertos publicados, volumen `db-data` |
| `migrate` | Imagen de la API; `prisma migrate deploy` antes de que arranque la API |
| `api` | `Dockerfile`: `node:24-bookworm-slim` con `openssl` (motor de Prisma para Debian), `npm ci --omit=dev` (sólo dependencias de la API, ~800 MB en total) y `prisma generate` dentro de la imagen, usuario `node`, `TZ=UTC`, volumen `storage`, healthcheck contra `/health` (que comprueba la base), cierre limpio con SIGTERM |
| `web` | `Dockerfile.web`: build de Vite en Node 24 y `nginx:1.27-alpine` con `deploy/nginx.conf` y `deploy/security-headers.conf` (CSP para Google Identity, Google Fonts, OCR con WebAssembly y vistas previas `blob:`) |
| Catálogo | `npm run catalog:import` (práctica sin usuarios, idempotente) |
| Respaldos | `deploy/backup.sh` y `deploy/restore.sh` (pg_dump + tar del volumen, con SHA-256) |

`.dockerignore` deja fuera de la imagen los secretos, los documentos, los archivos de `storage/` (salvo las fotos base del recetario) y `prisma/data/demo-practice.json`.

En el VPS (fase 115, guía en `DESPLIEGUE.md`):

| Pieza | Detalle |
|---|---|
| HTTPS | `docker-compose.prod.yml` agrega `caddy:2.8.4-alpine` (Let's Encrypt automático, HTTP→HTTPS, HSTS); Nginx deja de publicar su puerto y toma la IP real de Caddy sólo desde la red `edge` (`deploy/nginx-real-ip.conf`) |
| Despliegue | `deploy/deploy.sh [commit]`: respaldo previo, build, migraciones, `smoke.sh` contra el dominio y, si falla, el comando para volver |
| Respaldos | `deploy/backup-offsite.sh` con restic (cifrado, deduplicado; 7 diarios, 4 semanales, 12 mensuales) a Backblaze B2 o S3, cada noche con `deploy/systemd/milpa-backup.timer`; `restore-offsite.sh` los restaura |
| Servidor | `deploy/server-setup.sh` (Ubuntu 24.04): actualizaciones automáticas, Docker con tope de registros, usuario `milpa`, SSH sólo con llave, fail2ban, firewall 22/80/443, swap |

Falta para producción:

- Contratar el VPS y el dominio en **Hostinger** (decidido el 21/10/2026) y el bucket de respaldos (Backblaze B2).

## 11. Resumen en una línea

**Vite 8 + React 19** · **Fastify 5** (Node 24 LTS como objetivo, JavaScript sin TS) · **Prisma 6** · **PostgreSQL 16** · pdfkit · pdfjs-dist · tesseract.js · JWT + bcrypt · **Stripe** · **Google Identity** · USDA / Open Food Facts · Vitest · Docker Compose (PostgreSQL, API, Nginx, Caddy con HTTPS) · restic · VPS _(por contratar)_
