# Milpa: validación del stack antes de Docker

Fecha: 20/10/2026. Rama: `main` (bf0a29d).

**Alcance.** Para este informe solo se leyó el código, se revisó `node_modules` y se corrieron las pruebas unitarias, que no usan la base: pasan las 284 de 28 archivos. No se modificó ningún archivo, no se instalaron dependencias, no se corrió nada contra la base y no se usaron servicios externos.

**Convención.**

- **Comprobado:** se vio en el código o se ejecutó.
- **Por probar:** es un riesgo que necesita una prueba real.

---

## 1. Stack verificado y versiones reales

| Pieza | Versión instalada | Nota |
|---|---|---|
| Node / npm locales | **20.20.2 / npm 12.2.0** | npm 12 exige Node ≥22.22.2 o ≥24.15 y avisa en cada comando (comprobado) |
| Fastify / @fastify/cors | 5.12.1 / 11.3.0 | En `package.json` figuran como `"latest"` |
| React / React DOM | 19.2.8 | `"latest"` |
| Vite / @vitejs/plugin-react | 8.2.2 / 6.1.0 | `"latest"`; piden Node ^20.19 o ≥22.12 |
| Prisma / @prisma/client | 6.19.3 | `db push`, sin carpeta `prisma/migrations` |
| PostgreSQL | 16 (`postgres:16-alpine`) | Solo en `docker-compose.yml`; la etiqueta no fija la versión menor |
| stripe | 18.5.0 | |
| google-auth-library | 10.9.1 | |
| pdfkit | 0.17.2 | Usa las fuentes de `server/assets/fonts` (1.9 MB) |
| pdfjs-dist | 6.4.299 | **Declara Node ≥22.13**: hoy ya está fuera de rango con Node 20 (comprobado) |
| tesseract.js | 7.0.0 | Solo en el navegador; los archivos se copian a `public/ocr` |
| bcryptjs / jsonwebtoken | 3.0.3 / 9.0.3 | bcryptjs es JS puro, sin binario nativo |
| recharts | 3.10.1 | |
| vitest | 3.2.7 | |
| concurrently | 9.2.4 | |
| dotenv | 16.6.1 | |

**Arquitectura comprobada:**

- Una SPA (React con Vite) y una API monolítica: `server/index.js` tiene 3,436 líneas y **119 rutas**.
- PostgreSQL se usa a través de Prisma.
- No hay Dockerfile, `.dockerignore`, CI, `.nvmrc` ni `engines` en `package.json`.
- Proveedores de alimentos: USDA, que usa `DEMO_KEY` si falta `USDA_API_KEY`, y Open Food Facts.

**Diferencias con `STACK_TECNOLOGICO.md`, que hay que corregir:**

- Son **26 modelos** y 9 enums, no 27 modelos.
- Falta el directorio `storage/education-materials`.
- Faltan 4 variables: `RECIPE_IMAGE_STORAGE_PATH`, `INGREDIENT_IMAGE_STORAGE_PATH`, `EDUCATION_ATTACHMENT_STORAGE_PATH` y `SKIP_DB_SYNC`.
- Dice que `.env.example` documenta cada variable, y es falso: no trae ninguna `*_STORAGE_PATH`.
- No dice que `storage/recipes` mezcla **501 imágenes versionadas en git** con las fotos que suben los usuarios (`u-*.jpg`).
- El README pide «Node 20+», pero pdfjs-dist y npm 12 ya exigen Node 22 o más.

---

## 2. Node.js 24: compatibilidad y riesgos

**Comprobado:**

- El código del servidor no usa APIs obsoletas: ni `new Buffer`, ni `url.parse`, ni `require`, ni `punycode`.
- Las dependencias declaran que soportan Node 24, o no declaran restricción.
- Pasar a Node 24 **arregla** dos desajustes que hoy existen: el de npm 12 y el de pdfjs-dist.
- Hay binarios nativos que dependen de la plataforma:
  - el motor de Prisma, compilado para `debian-openssl-3.0.x`;
  - `@napi-rs/canvas`, una dependencia opcional de pdfjs-dist que el servidor no usa;
  - lightningcss y rolldown, que usa el build.
- Por eso, en Docker hay que correr `npm ci` y `prisma generate` **dentro de la imagen**, nunca copiar el `node_modules` de tu máquina.
- Seis dependencias están en `"latest"`: fastify, @fastify/cors, react, react-dom, vite y @vitejs/plugin-react. Un `npm install` en vez de `npm ci` podría saltar a una versión mayor nueva sin avisar.

**Por probar** (no hay Node 24 en la máquina y no se descargó):

- Prisma 6.19 con Node 24: se considera bajo riesgo, pero hay que verificarlo.
- Vitest 3.2 con Node 24.
- Que el build de Vite y la copia de los archivos del OCR funcionen en la imagen.

**Recomendación:** subir solo Node. No mezclar el cambio con:

- Prisma 7, que rompe la configuración y exige driver adapters;
- google-auth-library 11, que es opcional y puede ir después.

---

## 3. Prisma: estado y estrategia para producción

**Estado comprobado:**

- No hay migraciones: el esquema se aplica con `prisma db push`.
- `prisma/sync-dev.js` corre `db push` automáticamente y, si la base está vacía, también el **seed**. Está conectado a `predev:all`.
- Producción no tiene un historial de cambios reproducible.

**Estrategia propuesta:**

1. **Línea base.** Generar `prisma/migrations/0_init/migration.sql` con `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`, más `migration_lock.toml`.
2. **Bases existentes.** En la base local se marca como aplicada con `prisma migrate resolve --applied 0_init`, sin ejecutar nada. Antes se revisa el desfase con `migrate diff` contra la base local.
3. **Producción.** Arranca vacía y se prepara solo con `prisma migrate deploy`, como paso aparte antes de levantar la API. Nunca `db push` ni seed.
4. **Desarrollo.** Los cambios nuevos se crean con `prisma migrate dev --name …`. `sync-dev.js` pasaría a usar migraciones, o quedaría solo para desarrollo con un aviso claro.
5. **Ventaja extra.** Las migraciones en SQL permiten índices por expresión, que con `db push` no se pueden crear.

---

## 4. Hallazgos de seguridad por prioridad

### Aislamiento por `practiceId`

- Las 119 rutas se revisaron con un script. Todas las rutas de la app filtran por práctica, salvo estas, por diseño:
  - `auth/me`, `logout` y `change-password`, que filtran por usuario;
  - las imágenes públicas;
  - `food/search` y `nutrition-plans/calculate` y `/macros`, que no tocan datos de ninguna cuenta.
- Las rutas `/admin` cruzan cuentas a propósito y solo aceptan el token de administrador.
- Las descargas de archivos clínicos se revisaron a mano: documentos, estudios de laboratorio y materiales educativos filtran por práctica y no permiten salir de la carpeta (path traversal).
- **Por probar:** el escaneo es una heurística. Falta una prueba automática con dos cuentas que intente leer los IDs de la otra en cada ruta.

### Alta (comprobados)

1. **Login sin límite de intentos.** `/auth/login`, `/admin/auth/login` y `/auth/google` permiten fuerza bruta. El acceso al panel de administración solo depende de la contraseña.
2. **El seed crea cuentas con contraseñas fijas.** `prisma/seed.js` crea el administrador y la nutrióloga de demostración con contraseñas escritas en el código, y `sync-dev.js` lo ejecuta solo si la base está vacía. Si eso ocurre en producción, quedan credenciales conocidas.
3. **No hay `.dockerignore`.** Un `COPY . .` metería en la imagen:
   - `.env`;
   - los 18 MB de PDF generados en `storage/documents`;
   - los PDF de la raíz, entre ellos uno cuyo nombre parece un plan de un paciente.
4. **`JWT_SECRET` faltante solo da un aviso.** Lo correcto es que la API no arranque sin él. Además:
   - el token de administrador comparte secreto con los de práctica;
   - no se puede revocar: dura 12 h y no tiene `sessionVersion`.

### Media

5. **Fastify no tiene `trustProxy`.** Detrás de Nginx, la bitácora de auditoría (NOM-024) guardaría la IP del proxy y no la del usuario. Está comprobado en el código; el efecto está por probar.
6. **CORS acepta cualquier origen** (`origin: true`). Como la sesión va en el encabezado `Authorization` y no en cookies, no hay riesgo de CSRF, pero en producción conviene limitarlo a `APP_URL`.
7. **Token de 7 días en `localStorage` y sin encabezados de seguridad** (CSP y otros). Un XSS podría robar la sesión.
8. **La descarga de estudios de laboratorio no manda `Cache-Control: no-store` ni `nosniff`**, a diferencia de la de documentos.
9. **`/health` no comprueba la base de datos**, y la API no cierra limpio al recibir SIGTERM.

### Baja

10. Las imágenes de recetas e ingredientes y los logos son públicos por diseño. Sus nombres llevan UUID, así que no se adivinan.
11. Los archivos clínicos se guardan en disco sin cifrar y no hay respaldos todavía; es un tema operativo.

---

## 5. Inventario de archivos persistentes y variables

### Persistentes (volúmenes)

| Ruta | Contenido | Sensible |
|---|---|---|
| Datos de PostgreSQL | Toda la base | **Sí** |
| `storage/documents` | PDF generados con versión y checksum | **Sí** |
| `storage/lab-attachments` | Estudios de laboratorio subidos | **Sí** |
| `storage/education-materials` | Adjuntos de materiales educativos; se crea al usarse | No |
| `storage/logos` | Logos de cada práctica | No |
| `storage/ingredients` | Fotos de ingredientes | No |
| `storage/recipes` | **501 imágenes base versionadas** más las fotos subidas (`u-*.jpg`) | No |

**Problema con `storage/recipes`:** montar un volumen encima oculta las imágenes base. Hay dos salidas:

- sembrar el volumen la primera vez;
- separar las imágenes base de las fotos subidas.

### Se generan en la imagen (no persistentes)

- `dist/`
- `public/ocr/`
- `node_modules`

### Viajan en la imagen

- `server/assets/fonts`
- `prisma/data` y `prisma/tools`, para importar el catálogo

### Variables

| Grupo | Variables |
|---|---|
| Obligatorias | `DATABASE_URL`, `JWT_SECRET`, `APP_URL` |
| Funcionalidad | `PORT` (3001 por defecto), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`, `GOOGLE_CLIENT_ID`, `CATALOG_PRACTICE_ID`, `USDA_API_KEY` |
| Rutas de almacenamiento | `DOCUMENT_STORAGE_PATH`, `LOGO_STORAGE_PATH`, `LAB_ATTACHMENT_STORAGE_PATH`, `RECIPE_IMAGE_STORAGE_PATH`, `INGREDIENT_IMAGE_STORAGE_PATH`, `EDUCATION_ATTACHMENT_STORAGE_PATH` |
| De build | `VITE_API_URL` se fija al compilar; se recomienda `/api/v1`, con el mismo dominio y proxy |
| Solo desarrollo | `DEFAULT_PRACTICE_ID`, `SKIP_DB_SYNC` |

### Scripts de inicialización

- `db:setup` encadena push, seed, los imports de SMAE, alimentos base, recetas y recetario, el enlace con SMAE y la práctica de demostración.
- Para producción hace falta otra secuencia:
  1. aplicar las migraciones;
  2. importar el catálogo a una práctica-catálogo **sin usuarios de demostración**;
  3. crear el primer administrador con una contraseña que venga del entorno. Ese script todavía no existe.

### Integraciones que Docker debe dejar funcionando

- **Stripe:** el webhook necesita una URL pública con HTTPS; en local se usa el CLI de Stripe.
- **Google:** el dominio tiene que estar en los «Orígenes de JavaScript autorizados». Si se configura `Cross-Origin-Opener-Policy`, debe ser `same-origin-allow-popups` para que funcione el popup.
- **USDA y Open Food Facts:** el contenedor necesita salida a internet.

---

## 6. Requisitos de los contenedores

### PostgreSQL

- Imagen `postgres:16.x` con la versión menor fijada.
- Volumen con nombre y healthcheck con `pg_isready`.
- En local, puerto ligado solo a `127.0.0.1`; en el VPS, sin puerto publicado.
- Usuario y contraseña desde el entorno, no los de ejemplo.

### API

- Imagen `node:24-bookworm-slim` con `openssl`, para que coincida con el motor de Prisma. En Alpine, el motor sería otro (musl).
- Build multi-etapa con `npm ci` y `prisma generate`, y usuario sin privilegios.
- Volumen en `/app/storage` y `env_file` que no entre en la imagen.
- Un servicio de una sola ejecución para `prisma migrate deploy`, del que dependa la API.
- `SKIP_DB_SYNC=1` y `NODE_ENV=production`.
- Healthcheck que compruebe también la base, y `TZ` explícito.

### Frontend

- Una etapa Node 24 corre `npm ci` y `npm run build`, que copia los archivos del OCR.
- Nginx sirve `dist/` con fallback de SPA y hace proxy de `/api` a `api:3001`.
- `client_max_body_size` de al menos 20m, porque la API acepta cuerpos de hasta 15 MB.
- El tipo MIME `application/wasm`, para el OCR.
- Encabezados de seguridad, con una CSP que permita `accounts.google.com`.

---

## 7. Pruebas antes de comprar el VPS

1. **Node 24 desde cero:** `npm ci`, las 284 pruebas y el build.
2. **Compose desde cero:**
   - migraciones en una base vacía;
   - importar el catálogo;
   - crear el administrador e iniciar sesión.
3. **Pruebas de extremo a extremo contra los contenedores:** las de cuentas, Google y sesiones, más Stripe en modo de prueba con su CLI.
4. **Aislamiento entre cuentas:** con dos prácticas, cada una intenta usar los IDs de la otra en todas las rutas.
5. **Persistencia de archivos:**
   - subir un logo, un estudio y una foto, y generar un PDF;
   - hacer `docker compose down` y `up`, y ver que todo sigue ahí, incluidas las imágenes base de recetas.
6. **Simulacro de respaldo:**
   - `pg_dump` más un tar de `storage`;
   - restaurar en un compose nuevo y verificar que todo está.
7. **PDF en el contenedor:** acentos, ñ, fuentes y logo correctos.
8. **OCR servido por Nginx sin internet.**
9. **Proxy:**
   - que una subida de 15 MB pase por Nginx;
   - que la bitácora registre la IP real detrás del proxy;
   - que el límite de intentos de login devuelva 429.
10. **Zona horaria:** que la agenda se vea igual con el contenedor en UTC.

---

## 8. Cambios mínimos propuestos

| # | Archivos | Cambio | Riesgo |
|---|---|---|---|
| 1 | `.dockerignore` (nuevo) | Excluir `.env`, `storage/*`, `node_modules`, `dist`, los PDF e imágenes de la raíz y `.claude` | Bajo |
| 2 | `package.json`, `.nvmrc` (nuevo), `README.md` | `engines` con Node 24; cambiar `"latest"` por las versiones instaladas, para que el lockfile no cambie; script `db:migrate:deploy` | Bajo |
| 3 | `prisma/migrations/0_init/*` (nuevo), `prisma/sync-dev.js` | Línea base de migraciones; en desarrollo, migraciones en lugar de `db push` | **Medio**: la base local tiene que marcarse como aplicada sin desfase |
| 4 | `server/index.js`, dependencia nueva `@fastify/rate-limit` | Límite de intentos en el login; `trustProxy` por variable; CORS limitado a `APP_URL`; no arrancar sin `JWT_SECRET` en producción; `/health` con la base; cierre limpio con SIGTERM; `no-store` y `nosniff` en la descarga de estudios | **Medio**: toca el arranque y la autenticación; se cubre con las pruebas de extremo a extremo |
| 5 | `prisma/seed.js`, `prisma/create-admin.js` (nuevo) | Que el seed se niegue a correr con `NODE_ENV=production`; crear el administrador con la contraseña del entorno | Bajo |
| 6 | `server/index.js` y la carpeta de imágenes base | Separar las 501 imágenes base de las fotos subidas, buscando primero en el volumen y después en la carpeta base | **Medio**: la base guarda solo el nombre del archivo |
| 7 | `Dockerfile` (API), `Dockerfile.web` y `deploy/nginx.conf` (nuevos), `docker-compose.yml`, `.env.example` | Contenedores y healthchecks de la sección 6; documentar las variables `*_STORAGE_PATH` | Bajo a medio |
| 8 | `STACK_TECNOLOGICO.md` | Corregir las diferencias de la sección 1 | Bajo |

**Orden sugerido:**

1. Los cambios 1, 2, 5 y 8, que no cambian el comportamiento.
2. Los cambios 4 y 3.
3. Los cambios 6 y 7.

Pendiente de aprobación antes de modificar cualquier archivo del proyecto.
