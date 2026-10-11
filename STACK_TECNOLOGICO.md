# Stack tecnológico — Nutri (milpa clinical)

Inventario del stack **real** del proyecto (no el propuesto en `ARQUITECTURA.md`, que es el documento de planeación original y ya no coincide del todo con el código). Pensado como insumo para armar un diagrama de arquitectura tipo el de referencia.

## 1. Usuarios / roles

- **Nutrióloga / práctica** (`User`: roles `OWNER`, `NUTRITIONIST`, `ASSISTANT`) — la app clínica día a día.
- **Paciente** — no tiene acceso directo a la app; recibe documentos (PDF) generados y entregados fuera de la app (WhatsApp/email manual, sin integración todavía).
- **SuperAdmin** (`AdminUser`, modelo separado de `User`) — panel de administración del SaaS (`src/modules/admin/AdminApp.jsx`): practices, suscripciones/pagos, estado de cuentas.

## 2. Frontend

| Pieza | Detalle |
|---|---|
| Framework | **React** (JSX, sin TypeScript — a pesar de lo que dice `ARQUITECTURA.md`) |
| Build tool | **Vite** |
| Routing | Sin router de terceros: navegación por estado (`active`/`setActive`) dentro de `src/app/App.jsx` |
| Gráficas | **Recharts** (`src/components/FinanceCharts.jsx`) |
| Estilos | CSS plano a mano, sin framework (`src/styles/globals.css`, ~1250 líneas, tokens vía custom properties) |
| Tests | **Vitest** (unit tests de lógica, `src/**/*.test.js`) |

## 3. Backend / API

| Pieza | Detalle |
|---|---|
| Framework | **Fastify** (`server/index.js`, monolito — no hay microservicios) |
| Lenguaje | Node.js (ESM, `"type": "module"`), JavaScript plano |
| CORS | `@fastify/cors` |
| Auth | JWT propio (`jsonwebtoken`), sesiones stateless; contraseñas con **bcryptjs** |
| Multi-tenant | El JWT lleva `practiceId`; cada consulta a la base se filtra por ese tenant. Hay un segundo tipo de token/sesión para `AdminUser` (panel SaaS, fuera del tenant) |
| Generación de PDF | **pdfkit** — dibuja los documentos a mano (sin HTML→PDF): informe de consulta, informe clínico, expediente completo, menú semanal |
| Dominio / lógica pura | Carpeta `server/domain/` (cálculo energético, macros, micronutrientes, diccionario de alimentos) — testeada aparte con Vitest |

## 4. Base de datos

| Pieza | Detalle |
|---|---|
| Motor | **PostgreSQL 16** (`postgres:16-alpine` vía Docker Compose, solo para desarrollo local) |
| ORM | **Prisma** (`@prisma/client` + `prisma`) |
| Modelos | 23 modelos — `Practice`, `User`, `AdminUser`, `Patient`, `Appointment`, `Consultation`, `ClinicalSection`, `PatientSection`, `Measurement`, `Diagnosis`, `NutritionPlan`, `MealSlot`, `Recipe`, `RecipeIngredient`, `Ingredient`, `EducationMaterial`, `Document`, `Template`, `Task`, `FinanceEntry`, `Transaction`, `LabAttachment`, `AuditEvent` |
| Versionado de datos clínicos | Mediciones/diagnósticos/planes son inmutables por consulta (se versiona, no se sobreescribe) |

## 5. Almacenamiento de archivos

- **Disco local**, no S3/blob storage (a pesar de que `ARQUITECTURA.md` proponía S3-compatible). Carpetas: `storage/documents` (PDFs generados), `storage/logos` (logo de cada práctica), `storage/recipes` (imágenes de recetas). Rutas configurables por `.env` (`DOCUMENT_STORAGE_PATH`, `LOGO_STORAGE_PATH`).

## 6. Integraciones externas

| Servicio | Uso |
|---|---|
| **USDA FoodData Central API** | Búsqueda de alimentos/valores nutrimentales (`server/providers/food.js`) |
| **Open Food Facts API** | Búsqueda de alimentos (fallback/complemento de USDA) |

No hay integración de WhatsApp/email todavía — el envío del plan/informe al paciente se marca manualmente como "entregado" (`Document.deliveredAt`) después de enviarse por fuera de la app.

## 7. Configuración / entorno

Variables de entorno (`.env`): `DATABASE_URL`, `VITE_API_URL`, `DEFAULT_PRACTICE_ID`, `PORT`, `JWT_SECRET`, `DOCUMENT_STORAGE_PATH`, `LOGO_STORAGE_PATH`.

## 8. Desarrollo / tooling

- **Concurrently** — corre API (Fastify) + frontend (Vite) juntos en dev (`npm run dev:all`).
- **dotenv** — carga de variables de entorno.
- Scripts de importación de datos semilla en `prisma/*.js` (catálogo SMAE, recetario, alimentos base, práctica demo).

## 9. Infraestructura / despliegue — **pendiente de definir**

A diferencia del proyecto de referencia (barberías y salones), **Nutri todavía no tiene infraestructura de producción**: no hay `Dockerfile` para la app, no hay `docker-compose` más allá de Postgres local, no hay reverse proxy ni TLS configurados. Esto es lo que falta decidir para el diagrama:

- Contenerización de frontend (build estático de Vite) y backend (Fastify) — hoy sólo Postgres corre en Docker.
- Reverse proxy + TLS (p. ej. Nginx + Let's Encrypt/certbot, igual que en el proyecto de barberías).
- Host/VPS (mismo patrón ya usado en otro proyecto tuyo: Hetzner + Docker Compose es una opción conocida y barata).
- Si el PostgreSQL de producción vive en el mismo VPS (como en la referencia, "no expuesto a internet") o en un servicio administrado aparte.

## 10. Resumen para el diagrama (stack tecnológico)

Next.js → **Vite + React** · NestJS → **Fastify** · (TypeScript → JavaScript, sin TS) · Prisma · PostgreSQL · pdfkit · JWT · Docker _(solo Postgres hoy)_ · Nginx _(por definir)_ · Let's Encrypt _(por definir)_ · Hetzner u otro VPS _(por definir)_
