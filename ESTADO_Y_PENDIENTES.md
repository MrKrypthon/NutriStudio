# Nutri Studio: Estado y Pendientes

Este documento es la fuente de verdad para retomar el proyecto, sesión tras sesión. Reemplaza al artifact "Ruta Nutri Studio" (28 de agosto), que quedó desactualizado apenas se avanzó la Fase 1 — vive fuera del repo y nadie lo actualizaba. Este archivo sí vive con el código: **actualízalo al cerrar cada fase**, es más barato que una sesión nueva tenga que reconstruir el estado leyendo git log y archivos uno por uno.

Última verificación contra código real (no contra specs): 1 de septiembre de 2026 (noche).

## Iniciar sesión en local

Desde la fase 9 la app pide login real. Credencial de desarrollo sembrada por `prisma/seed.js`:

- Email: `gabriela@nutristudio.local`
- Contraseña: `nutristudio2026`

`JWT_SECRET` vive en `.env` (no en el repo — cópialo de `.env.example` si falta). Si cambias el usuario/contraseña sembrado, actualiza `DEV_PASSWORD_HASH` en `prisma/seed.js` y vuelve a correr `npm run db:seed`.

## Cómo usar este documento en una sesión nueva

Al abrir una sesión nueva para seguir con el proyecto, en vez de "continúa donde lo dejamos":

> Lee `ESTADO_Y_PENDIENTES.md` y sigue con [nombre del pendiente].

Eso evita que la sesión tenga que releer módulo por módulo para saber qué ya está conectado — que fue la mayor pérdida de tiempo de esta sesión.

## Flujo de trabajo (para perder menos tiempo)

- **Una rama por tema, chica y revisable.** `fase-N-descripcion` para módulos nuevos, `fix-descripcion` para bugs encontrados sobre la marcha. Así ha sido hasta ahora y funciona; el problema no fue el tamaño de las ramas sino lo que sigue.
- **Instala `gh` CLI una vez.** Ahorita cada PR se crea a mano (Claude hace push y pasa el link de "crear PR", tú lo abres, apruebas y mergeas en GitHub). Con `gh auth login` una sola vez, Claude puede crear el PR directamente — un paso menos por fase, y evita el problema de abajo.
- **Mergea pronto, no dejes ramas abiertas mucho tiempo.** El fix de seguridad de `/tasks` (control de acceso roto) se hizo *después* de abrir el PR de Seguimientos, se subió a la misma rama, pero el merge en GitHub se quedó con el estado anterior — el fix no llegó a `main` hasta una rama aparte. Con PRs de vida corta esto no pasa.
- **Si tu `npm run dev:all` ya está corriendo, no lo toques — levanta uno propio en puertos distintos para probar.** Funcionó bien en la fase 9: `PORT=3002 node server/index.js` en segundo plano, y `VITE_API_URL=http://localhost:3002/api/v1 npx vite --port 5175` aparte. Comparten la misma base de datos, así que no hay nada que sincronizar, y al terminar solo hay que matar esos dos procesos por PID exacto (nunca `pkill -f "node server/index.js"`, que también mataría el tuyo si el patrón coincide).
- **No reinicies el servidor de desarrollo si no es necesario, y si lo levantas en segundo plano, apágalo al terminar de probar.** Reiniciar `npm run dev:all` para probar un solo endpoint nuevo se comió tiempo, una vez apagó por accidente la sesión de navegador que ya tenías abierta, y otra vez dejó un proceso vivo en el puerto 3001 que te impidió levantar tu propio `npm run dev:all` en tu terminal. Para probar solo el backend, `curl localhost:3001/api/v1/...` alcanza sin tocar nada del frontend.
- **Verifica en navegador contra el API real, no solo `npm run build`.** Así se encontraron los bugs reales de esta sesión (timezone, `Content-Type` en POST sin body, control de acceso, macros fijos en Recetas) — el build nunca los iba a atrapar.

## Qué es real hoy (probado contra Postgres, no solo compilado)

| Módulo | Qué hace |
|---|---|
| Pacientes | Listar, buscar, filtrar, crear — persistido |
| Selector de paciente | Recorre toda la app (expediente, plan, entrega) con el id real, no un demo fijo |
| Expediente clínico | Autoguardado por sección, control de edición simultánea |
| Motor nutricional | 7 fórmulas, IMC, rango de peso ideal, 26 pruebas unitarias |
| Evaluación y plan | Se guarda en `NutritionPlan` real |
| Distribución semanal + recetas | Catálogo real asignado por día y tiempo de comida |
| Publicación del plan | Congela snapshot del menú; editar la receta después no lo altera |
| PDF del plan | Reproducible con datos reales |
| Importar alimentos | Búsqueda real USDA / Open Food Facts |
| **Agenda** | Crear cita, ver grilla real por semana/día, confirmar pendientes |
| **Seguimientos** | Cola real de documentos (plan/informe) pendientes de entrega, marcar entregado, crear |
| **Hoy** | "Próxima acción" con datos reales de Seguimientos; horas de cita correctas |
| **Consultas** | Historial real de sesiones del paciente |
| **Recetas** | Estado de sincronización, macros y tipo de comida correctos por receta |
| **Configuración** | Nombre profesional, email y zona horaria de la práctica, reales y persistentes |
| **Editar paciente + línea de tiempo** | `PATCH /patients/:id` real; el cajón de cada paciente muestra el historial real de citas, consultas, planes y documentos |
| **Entrega de documentos** | "Marcar como entregado" real sobre `POST /documents/:id/deliver`; el PDF de informe clínico ya imprime mediciones, diagnóstico y tratamiento reales en vez de texto genérico |
| **Autenticación** | Login real con contraseña (bcrypt) + sesión (JWT en `Authorization: Bearer`, sin cookies). `practiceId`/`userId` ya no vienen de un header que cualquiera puede mandar — vienen de la sesión verificada. Esto cierra TODO el patrón de control de acceso roto de golpe, sin necesidad de la auditoría endpoint por endpoint que seguía pendiente. Sin roles aplicados todavía (ver abajo) |
| **Flujo completo tallas → receta → plan** | Probado de punta a punta con una paciente real (Valeria Mendoza Ruiz): expediente con mediciones reales → cálculo de requerimiento (Mifflin-St Jeor, 2114 kcal/día) → 4 alimentos importados en vivo de USDA (pollo, quinoa, espinaca, aguacate) → 2 recetas propias con esos ingredientes y macros calculados de verdad → distribución de 7 días × 4 tiempos → plan publicado → PDF de menú semanal generado y descargado. Queda como paciente de ejemplo real en la base |
| **Plantillas** | Modelo `Template` nuevo. Una plantilla se crea clonando la consulta o el plan más reciente de un paciente (snapshot, no referencia viva); "Usar plantilla" la copia sobre otro paciente — precarga sus secciones de expediente o reemplaza la distribución semanal de su plan en borrador. Probado de punta a punta: plantilla de expediente y de plan creadas desde Valeria, aplicadas a Diego Ramírez y Sofía Hernández respectivamente |
| **Registrar medición** | Botón "Registrar medición de hoy" en la pestaña Antropométrico llama al `POST /consultations/:id/measurements` existente (creado en el flujo de Valeria, nunca conectado hasta ahora) |
| **Generar informe clínico bajo demanda** | Botón "Generar informe"/"Descargar informe" en el expediente crea (`POST /documents/consultation-report`, nuevo) y genera un documento `consultation_report` para la consulta en curso, sin depender de que el seed lo haya creado de antemano |
| **Biblioteca de educación** | Modelo `EducationMaterial` nuevo. Catálogo real con búsqueda y filtro por categoría (server-side, con debounce), crear/editar en una pantalla dedicada, archivar, y "Compartir" real que copia título + contenido al portapapeles (envío real por WhatsApp/email sigue diferido, como el resto de la app). 6 materiales de ejemplo sembrados por `seed.js`, probado creando, editando, compartiendo y archivando uno de prueba |

(Negrita = construido en esta sesión: fase 3 a 10 y 12 en esta rama — fase 11 (Recetas) vive en la rama `fase-11-recetas` con su propio PR, y fase 13 (Biblioteca de educación) es este trabajo — más los bugfixes de control de acceso y CORS.)

**Nota de ramas paralelas:** `fase-11-recetas` se ramificó de `main` después de fase 10 y sigue con su propio PR sin mergear; esta rama (`biblioteca-educacion`, fase 13) se ramificó de `main` después de fase 12. Al mergear fase 11, revisa conflictos en esta tabla — no deberían pisarse porque tocan filas distintas, pero mezclar ambas versiones manualmente es más seguro que aceptar una y descartar la otra.

## Backend real, pantalla sin conectar

| Qué falta conectar | Detalle |
|---|---|
| Configuración — horarios y logo | "Horarios de atención" y "Logo de la práctica" siguen estáticos: no hay modelo para disponibilidad semanal ni almacenamiento de archivos todavía. Nombre/email/zona horaria ya son reales |

## No existe todavía (ni modelo, ni API, ni pantalla real)

| Módulo | Nota |
|---|---|
| Editar estado del paciente (activo/archivado) | `PATCH /patients/:id` no toca `status` todavía; sólo datos de contacto |
| Auditoría | Modelo `AuditEvent` existe; ninguna ruta lo usa |
| Envío real por WhatsApp/email | "Marcar como entregado" ya es real, pero sigue siendo un registro manual — no manda nada. La integración de envío real sigue diferida, como dice RF-09 del documento original |
| Equivalentes SMAE | Bloqueado a propósito — la tabla oficial mexicana requiere licenciarse |
| Grabación / transcripción | Diferido a propósito — exige consentimiento y revisión humana antes de tocarlo |

## Deuda técnica encontrada esta sesión (no bloquea, pero hay que volver)

- ~~Patrón de control de acceso roto (endpoints que confiaban en el header `x-practice-id`, que cualquiera puede mandar)~~ — **resuelto de raíz en fase 9**: ya no existe ese header en absoluto. `practiceId`/`userId` salen de la sesión JWT verificada en un hook global (`onRequest`), así que cada endpoint queda protegido automáticamente, incluidos los que seguían pendientes de auditoría (`consultations`, `appointments/confirm`, `recipes`).
- El bug de `Content-Type: application/json` forzado en peticiones sin body (ya corregido en el helper compartido `apiRequest`) y el de horas calculadas con reloj local en vez de UTC (ya corregido en Agenda/Hoy/Seguimientos) son clases de bug a vigilar si se agrega código nuevo con fechas o `POST`/endpoints sin body.
- **Agenda y Hoy estaban anclados a una fecha demo fija (26 de agosto de 2026)** en vez de la fecha real del sistema — al navegar a la semana actual no se marcaba ningún día como "hoy", y el saludo/agenda de Hoy siempre mostraba el miércoles 26 sin importar qué día fuera en realidad. Ya corregido en ambas pantallas para usar la fecha real (ver AgendaPage y DashboardPage). Si aparece el mismo patrón en otra pantalla, es la misma clase de bug.
- **`@fastify/cors` sin `methods` configurado limita a `GET,HEAD,POST` por default (cambió en v11).** Todo endpoint `PUT` de este API (secciones de expediente, evaluación/distribución de plan, ingredientes de receta, práctica) fallaba en silencio con cualquier llamada cross-origin — solo funcionaba a través del proxy de Vite (mismo origen). Ya corregido explícitamente en el registro de `cors`, pero es la clase de bug que solo aparece al probar contra `npm run dev:all` o en producción real (front y API en dominios distintos) — vale la pena probar ahí, no solo contra el proxy de Vite.
- **`NewRecipePage` guardaba recetas casi inservibles, en silencio, desde que se conectó a la API.** Tres bugs en el mismo archivo, encontrados al construir el flujo de Valeria: (1) mandaba `mealTypes` en español minúsculas (`desayuno`, `comida`...) en vez de las claves en inglés que usa el resto del sistema (`breakfast`, `lunch`...) — el picker de recetas del Constructor de plan filtra por esa clave exacta, así que **ninguna receta creada desde la pantalla real podía aparecer nunca al armar un plan**; (2) "Porciones" y "Preparación" no estaban conectados a estado — lo que se escribiera ahí se descartaba y siempre se guardaba `portions:1` e `instructions:'Preparación pendiente de completar.'`; (3) nunca llamaba a `recipesApi.recalculate` tras crear, así que toda receta nueva se quedaba con `nutrition: {}` (0 kcal) hasta que alguien la recalculara a mano por API. Los tres ya están corregidos y probados por la UI real, no solo por API.

## Siguiente fase sugerida

Con "funcionalidad primero" como criterio (tu instrucción de esta sesión), en orden de valor/costo:

1. ~~Configuración real~~ — hecho (fase 6): nombre profesional, email, zona horaria. Horarios de atención y logo siguen pendientes por falta de modelo.
2. ~~Editar paciente + línea de tiempo~~ — hecho (fase 7): `PATCH /patients/:id` real, y el cajón de cada paciente muestra su historial de citas/consultas/planes/documentos. Falta editar `status` (activo/archivado).
3. ~~Entrega + PDF de informe con datos reales~~ — hecho (fase 8): "Marcar como entregado" real, y el PDF de informe clínico imprime mediciones/diagnóstico/tratamiento reales. El envío real por WhatsApp/email sigue diferido a propósito.
4. ~~Autenticación~~ — hecho (fase 9), alcance "login + sesión, sin roles": contraseña con hash real (bcrypt), login/logout, sesión JWT verificada server-side. De paso cierra todo el patrón de control de acceso pendiente (ver deuda técnica). **Decisión explícita del usuario: no se van a aplicar permisos por rol** (Propietaria/Nutrióloga/Asistente) — el modelo y el rol en la sesión quedan ahí sin usarse, y no es un pendiente a retomar.
5. ~~Plantillas~~ — hecho (fase 10): modelo `Template` nuevo, clonables para expediente y plan, probado creando y aplicando ambos tipos entre pacientes reales.
6. ~~Recetas al nivel de Avena/HeyNutre~~ — hecho (fase 11, rama `fase-11-recetas` con PR propio, pendiente de mergear): catálogo real con búsqueda/filtro por tiempo de comida y restricción, editar/archivar, macros reales. De paso se corrigieron tres bugs silenciosos en `NewRecipePage` (ver deuda técnica).
7. ~~Registrar medición + generar informe bajo demanda~~ — hecho (fase 12): dos huecos backend-real-pero-sin-conectar, cerrados. "Registrar medición de hoy" ya alimenta el histórico de `Measurement`; "Generar informe" crea y genera el PDF de consulta sin depender del seed.
8. ~~Biblioteca de educación~~ — hecho (fase 13): modelo `EducationMaterial` nuevo, catálogo real con búsqueda/filtro/crear/editar/archivar y "Compartir" que copia el contenido al portapapeles. Decisión de scope: sin subir archivos (no hay almacenamiento todavía, mismo límite que "Logo de la práctica" en Configuración) — el contenido es texto que se copia para pegar donde se necesite, no un PDF real.

Con esto se completó todo el backlog original del documento de requerimientos. Lo que queda son huecos de infraestructura transversales, no un módulo nuevo:

- **Almacenamiento de archivos** — bloquea tanto el logo de la práctica como adjuntar archivos reales a un material educativo (hoy todo es texto). Sin esto no avanza ninguno de los dos.
- **Instalar `gh` CLI** — sigue pendiente desde fase 9, cada PR se sigue creando a mano.
- **Envío real por WhatsApp/email** — diferido a propósito en todos los módulos que lo tocan (Seguimientos, Educación); es la integración más grande que falta y no bloquea nada mientras "marcar como entregado"/"copiar contenido" sigan siendo el flujo manual.
- **Editar estado del paciente (activo/archivado)** y **Auditoría** (ver tabla de arriba) son los dos huecos menores que quedan sueltos.
