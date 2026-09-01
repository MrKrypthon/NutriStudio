# Nutri Studio: Estado y Pendientes

Este documento es la fuente de verdad para retomar el proyecto, sesión tras sesión. Reemplaza al artifact "Ruta Nutri Studio" (28 de agosto), que quedó desactualizado apenas se avanzó la Fase 1 — vive fuera del repo y nadie lo actualizaba. Este archivo sí vive con el código: **actualízalo al cerrar cada fase**, es más barato que una sesión nueva tenga que reconstruir el estado leyendo git log y archivos uno por uno.

Última verificación contra código real (no contra specs): 31 de agosto de 2026.

## Cómo usar este documento en una sesión nueva

Al abrir una sesión nueva para seguir con el proyecto, en vez de "continúa donde lo dejamos":

> Lee `ESTADO_Y_PENDIENTES.md` y sigue con [nombre del pendiente].

Eso evita que la sesión tenga que releer módulo por módulo para saber qué ya está conectado — que fue la mayor pérdida de tiempo de esta sesión.

## Flujo de trabajo (para perder menos tiempo)

- **Una rama por tema, chica y revisable.** `fase-N-descripcion` para módulos nuevos, `fix-descripcion` para bugs encontrados sobre la marcha. Así ha sido hasta ahora y funciona; el problema no fue el tamaño de las ramas sino lo que sigue.
- **Instala `gh` CLI una vez.** Ahorita cada PR se crea a mano (Claude hace push y pasa el link de "crear PR", tú lo abres, apruebas y mergeas en GitHub). Con `gh auth login` una sola vez, Claude puede crear el PR directamente — un paso menos por fase, y evita el problema de abajo.
- **Mergea pronto, no dejes ramas abiertas mucho tiempo.** El fix de seguridad de `/tasks` (control de acceso roto) se hizo *después* de abrir el PR de Seguimientos, se subió a la misma rama, pero el merge en GitHub se quedó con el estado anterior — el fix no llegó a `main` hasta una rama aparte. Con PRs de vida corta esto no pasa.
- **No reinicies el servidor de desarrollo si no es necesario.** Reiniciar `npm run dev:all` para probar un solo endpoint nuevo se comió tiempo y una vez apagó por accidente la sesión de navegador que ya tenías abierta. Para probar solo el backend, `curl localhost:3001/api/v1/...` alcanza sin tocar nada del frontend.
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

(Negrita = construido en esta sesión: fase 3, 4, 5, y los bugfixes de Recetas y control de acceso.)

## Backend real, pantalla sin conectar

| Qué falta conectar | Detalle |
|---|---|
| Editar paciente | No existe ni `PATCH /patients/:id` ni botón — hay que construir ambos |
| Línea de tiempo del paciente | No existe, ni backend ni pantalla |
| Entrega por WhatsApp/email | `POST /documents/:id/deliver` existe; ningún botón de la interfaz lo llama |
| PDF de informe clínico | Se genera pero con texto genérico — trae mediciones y diagnósticos reales de la BD y nunca los imprime |

## No existe todavía (ni modelo, ni API, ni pantalla real)

| Módulo | Nota |
|---|---|
| Autenticación | Usuario fijo "Gabriela Alonso", sin login/sesión/roles aplicados. Es la más grande — necesita decisión de alcance antes de empezar (ver abajo) |
| Configuración / Ajustes | `Practice` (nombre, zona horaria, paleta) y `User` sí existen en el esquema; la pantalla es 100% estática. Se puede conectar sin tocar el esquema |
| Plantillas | Ni siquiera hay modelo `Template` en la base — necesita diseño de esquema nuevo |
| Biblioteca de educación | Pantalla completamente estática, sin modelo |
| Auditoría | Modelo `AuditEvent` existe; ninguna ruta lo usa |
| Equivalentes SMAE | Bloqueado a propósito — la tabla oficial mexicana requiere licenciarse |
| Grabación / transcripción | Diferido a propósito — exige consentimiento y revisión humana antes de tocarlo |

## Deuda técnica encontrada esta sesión (no bloquea, pero hay que volver)

- **Mismo patrón de control de acceso roto que se corrigió en `/tasks`** existe en endpoints más viejos que nadie ha auditado: `GET/POST /consultations/:id`, `PUT .../sections/:key`, `POST /appointments/:id/confirm`, `GET/PUT/POST /recipes/:id`, `GET/PUT/POST /plans/:id`, endpoints de `/documents`. Ninguno valida que el recurso pertenezca a la práctica de quien llama. Vale la pena una pasada dedicada, probablemente junto con la fase de autenticación.
- El bug de `Content-Type: application/json` forzado en peticiones sin body (ya corregido en el helper compartido `apiRequest`) y el de horas calculadas con reloj local en vez de UTC (ya corregido en Agenda/Hoy/Seguimientos) son clases de bug a vigilar si se agrega código nuevo con fechas o `POST`/endpoints sin body.

## Siguiente fase sugerida

Con "funcionalidad primero" como criterio (tu instrucción de esta sesión), en orden de valor/costo:

1. **Configuración real** — usa `Practice`/`User` que ya existen, sin tocar esquema. Nombre de la práctica, zona horaria, paleta.
2. **Editar paciente + línea de tiempo** — cierra el último hueco de "backend real, pantalla sin conectar" que además es barato (una tabla, sin modelos nuevos).
3. **Entrega por WhatsApp/email + PDF de informe con datos reales** — cierra el círculo de "Entrega" que quedó a medias.
4. **Autenticación** — la más grande. Antes de empezarla conviene una sesión aparte solo para decidir alcance (login+sesión nada más, vs. aplicar roles owner/nutritionist/assistant en cada endpoint, vs. además arreglar el patrón de control de acceso de arriba).
5. **Plantillas / Biblioteca de educación** — quedan al final porque necesitan diseño de esquema nuevo y no bloquean nada del flujo clínico principal.
