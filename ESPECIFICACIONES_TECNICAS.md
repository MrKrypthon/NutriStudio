# Nutri Studio: Especificaciones Técnicas

Especificación de referencia para transformar el prototipo visual en una aplicación web funcional. Complementa `ARQUITECTURA.md` y `REQUERIMIENTOS_Y_MAPA.md`.

El esquema persistente inicial está materializado en `prisma/schema.prisma`; `.env.example` contiene las variables necesarias para desarrollo local.

## 1. Alcance de la versión conectada

La primera versión con persistencia debe permitir:

1. Crear y editar pacientes.
2. Agendar citas y bloquear eventos.
3. Crear una consulta asociada a una cita.
4. Completar el expediente por secciones con autoguardado.
5. Calcular métricas antropométricas y requerimientos energéticos.
6. Crear un plan nutricional versionado.
7. Generar un informe PDF y registrar su entrega.

Recetas, equivalentes, transcripción y notificaciones se pueden habilitar detrás de flags hasta que el flujo principal sea estable.

## 2. Convenciones

- API REST bajo `/api/v1`.
- JSON en `camelCase`; base de datos en `snake_case`.
- Fechas ISO 8601 en UTC; la práctica conserva `timeZone` para renderizar.
- IDs UUID v4.
- Respuestas de error con `{ code, message, fields }`.
- Cada recurso incluye `id`, `createdAt`, `updatedAt` y `createdBy` cuando aplique.
- No borrar expedientes ni planes publicados: usar `archivedAt` o nueva versión.

## 3. Historias de usuario prioritarias

### US-01. Preparar el día

Como nutrióloga, quiero ver mis citas, confirmaciones y planes pendientes para decidir qué atender primero.

**Aceptación:** el dashboard carga los cuatro indicadores; cada pendiente lleva a su contexto; un estado vacío explica qué hacer; el horario usa la zona de la práctica.

### US-02. Crear una cita

Como nutrióloga, quiero agendar una consulta seleccionando paciente, fecha, hora, duración, tipo y canal de aviso.

**Aceptación:** no se permiten traslapes; la duración ofrece 15, 30, 45 y 60 minutos; el estado inicial es `pending_confirmation` si se notifica al paciente; se registra el cambio en auditoría.

### US-03. Abrir una consulta

Como nutrióloga, quiero iniciar una consulta desde la cita para completar el expediente correspondiente.

**Aceptación:** se crea una consulta con snapshot de la cita; sólo una consulta puede estar activa por cita; el encabezado identifica al paciente, fecha y estado de guardado.

### US-04. Registrar valoración

Como nutrióloga, quiero capturar datos clínicos por secciones sin perder información.

**Aceptación:** cada sección guarda independientemente; cambiar de pestaña no descarta cambios; se muestran errores por campo; las mediciones nuevas quedan ligadas a la consulta actual.

### US-05. Construir el plan

Como nutrióloga, quiero calcular requerimientos, distribuir macros y asignar recetas a una semana.

**Aceptación:** todo cálculo muestra fórmula y entradas; macros suman 100%; las restricciones se respetan; publicar crea una versión inmutable.

### US-06. Entregar documentos

Como nutrióloga, quiero revisar y descargar el informe antes de compartirlo.

**Aceptación:** puedo seleccionar secciones; la vista previa coincide con el PDF; los campos vacíos se ocultan; el sistema registra usuario, fecha, versión y canal de entrega.

## 4. Modelo de datos

### Practice

```text
id, name, owner_user_id, time_zone, locale, logo_url, default_palette
```

### User

```text
id, practice_id, name, email, role, status, last_login_at
```

`role`: `owner | nutritionist | assistant`.

### Patient

```text
id, practice_id, first_name, last_name, birth_date, sex, email,
phone, occupation, status, consent_data_at, consent_recording_at,
created_at, updated_at, archived_at
```

### Appointment

```text
id, practice_id, patient_id, start_at, end_at, type, status,
notify_via, internal_note, patient_note, recurrence_rule, time_zone
```

`type`: `initial | follow_up | quick_control | emergency | block`.

`status`: `scheduled | pending_confirmation | confirmed | completed | cancelled | no_show`.

### Consultation

```text
id, patient_id, appointment_id, nutritionist_id, started_at,
completed_at, status, template_id, version
```

### ClinicalSection

```text
id, consultation_id, section_key, payload_json, completion_state,
last_saved_at, last_saved_by
```

`sectionKey`: `summary | general | anthropometric | biochemical | clinical | dietary | lifestyle | sociocultural | diagnosis | treatment | monitoring | notes`.

El contenido variable debe validarse con un schema por sección, no aceptarse como JSON libre sin límites.

### Measurement

```text
id, patient_id, consultation_id, measured_at, weight_kg, height_cm,
waist_cm, hip_cm, body_fat_percent, muscle_mass_kg, method, notes
```

### NutritionPlan

```text
id, patient_id, consultation_id, status, version, goal, formula,
activity_method, activity_factor, mets_payload_json, target_kcal,
carbs_percent, protein_percent, fat_percent, published_at
```

`status`: `draft | ready | published | superseded`.

### Recipe e Ingredient

```text
Recipe: id, practice_id, name, meal_types, portions, instructions,
nutrition_json, restrictions, image_url, status, version
Ingredient: id, name, group, unit, nutrition_json, equivalence_json, status
```

### Document y Task

```text
Document: id, patient_id, consultation_id, plan_id, type, version,
sections_json, storage_key, checksum, generated_at, delivered_at
Task: id, practice_id, patient_id, type, due_at, status, reference_id
```

## 5. Contratos API

### Dashboard

```http
GET /api/v1/dashboard/today?date=2026-08-26
```

```json
{
  "date": "2026-08-26",
  "stats": { "appointments": 4, "pendingConfirmations": 1, "followUps": 3, "activePatients": 24 },
  "appointments": [],
  "tasks": []
}
```

### Pacientes

```http
GET  /api/v1/patients?search=mariana&status=active&page=1&pageSize=25
POST /api/v1/patients
GET  /api/v1/patients/:patientId
PATCH /api/v1/patients/:patientId
GET  /api/v1/patients/:patientId/timeline
```

### Agenda

```http
GET  /api/v1/appointments?from=2026-08-24&to=2026-08-30
POST /api/v1/appointments
PATCH /api/v1/appointments/:appointmentId
POST /api/v1/appointments/:appointmentId/confirm
POST /api/v1/calendar/availability/check
```

Al crear o modificar, el servidor vuelve a comprobar traslapes. La validación del cliente es sólo de ayuda visual.

### Consulta y expediente

```http
POST  /api/v1/patients/:patientId/consultations
GET   /api/v1/consultations/:consultationId
PUT   /api/v1/consultations/:consultationId/sections/:sectionKey
GET   /api/v1/consultations/:consultationId/history
POST  /api/v1/consultations/:consultationId/complete
```

El autoguardado usa:

```http
PUT /api/v1/consultations/:consultationId/sections/:sectionKey
```

El cliente puede enviar `updatedAt`; si la sección fue modificada desde otra sesión, el servidor responde `409 CONCURRENT_EDIT` y evita sobrescribir datos clínicos.

`PUT` debe ser idempotente y aceptar `updatedAt` para detectar edición concurrente. Si la versión cambió, devolver `409 CONCURRENT_EDIT` y permitir comparar.

### Plan y documentos

```http
POST /api/v1/nutrition-plans/calculate
POST /api/v1/patients/:patientId/plans
PUT  /api/v1/plans/:planId/evaluation
PUT  /api/v1/plans/:planId/distribution
PUT  /api/v1/plans/:planId/week
POST /api/v1/plans/:planId/publish
POST /api/v1/documents/consultation-report
POST /api/v1/documents/:documentId/generate-pdf
POST /api/v1/documents/:documentId/deliver
GET  /api/v1/documents/:documentId/download
```

La bandeja documental usa además:

```http
GET  /api/v1/documents?patientId=:patientId&type=consultation_report
POST /api/v1/documents/:documentId/generate
POST /api/v1/documents/:documentId/deliver
```

Un documento no puede marcarse como entregado antes de tener `generatedAt`.

Persistencia del plan:

```http
POST /api/v1/patients/:patientId/plans
GET  /api/v1/plans/:planId
PUT  /api/v1/plans/:planId/distribution
POST /api/v1/plans/:planId/publish
```

La publicación bloquea modificaciones y conserva `publishedAt`. La distribución exige que los macros sumen 100% al crear el plan.

### Recetas e ingredientes

```http
GET  /api/v1/recipes?search=avena&mealType=breakfast&status=ACTIVE
POST /api/v1/recipes
GET  /api/v1/ingredients?search=aguacate&group=grasas
```

Para mantener la nutrición consistente después de editar ingredientes:

```http
GET  /api/v1/recipes/:recipeId/nutrition
POST /api/v1/recipes/:recipeId/recalculate
PUT  /api/v1/recipes/:recipeId/ingredients
```

`recalculate` actualiza los valores por porción, incrementa la versión de la receta y conserva la receta como entidad propia. `PUT /ingredients` realiza la sustitución de forma atómica y recalcula automáticamente. Los planes publicados deben conservar un snapshot de esos valores.

Una receta debe devolver `nutrition`, `restrictions` y `mealTypes` para que el selector del plan pueda filtrar sin descargar todo el catálogo. Las recetas publicadas se versionan; una sustitución en un plan crea una copia de la selección, no modifica la receta maestra.

## 6. Estados de interfaz

Todas las vistas deben contemplar estos estados:

| Estado | Comportamiento |
|---|---|
| Loading | Skeleton de la misma estructura; no saltos de layout |
| Empty | Explicación breve y una acción primaria |
| Editing | Campos activos, autosave y navegación no destructiva |
| Saving | Indicador `Guardando...`; bloquear sólo la acción duplicable |
| Saved | `Guardado hace X`; no usar toast como único feedback |
| Error | Mensaje accionable y reintento; conservar valores locales |
| Permission denied | Explicar el permiso faltante sin revelar datos |
| Offline | Aviso persistente y cola local cifrada sólo para borradores |

## 7. Reglas del motor nutricional

- Unidades internas: kg, cm, kcal, gramos, minutos y MET.
- Redondear sólo para mostrar; conservar precisión completa en persistencia.
- IMC: `peso_kg / (talla_m ^ 2)`.
- GET: guardar BMR, factor o cálculo METS por separado para explicar el resultado.
- Macronutrientes: `carbohidratos_kcal / 4`, `proteínas_kcal / 4`, `grasas_kcal / 9`.
- Rechazar porcentajes negativos o suma diferente de 100% con tolerancia máxima de 0.1.
- Marcar resultados fuera de rango para revisión profesional; nunca corregirlos silenciosamente.
- Versionar fórmulas: `mifflin_v1`, `harris_v1`, etc. Cambiar una fórmula no modifica planes publicados.

## 8. Seguridad y cumplimiento

- RBAC en API, no sólo ocultamiento de botones.
- `practiceId` debe derivarse de la sesión, nunca confiar en el body.
- Cifrar campos clínicos sensibles y archivos en almacenamiento.
- No guardar audio en el navegador ni en logs.
- Consentimiento separado para datos, grabación y comunicación.
- Auditoría de lectura/exportación de expediente y cambios de diagnóstico.
- URLs de PDF con expiración y sin exposición del nombre del paciente.
- Retención y eliminación configurables por práctica, sujetos a revisión legal.
- Validar el formato final con asesoría sobre NOM-004-SSA3-2012 y LFPDPPP.

## 9. Tokens visuales

La paleta principal vive en `PaletaDeColores.png`. La apariencia predeterminada de la interfaz es intencionalmente neutra:

```css
--ink: #27332F;
--green: #355C4A;
--mint: #E8F0EA;
--accent: #D3A85B;
--surface: #F7F8F5;
```

Las paletas Coral, Natural, Frutos rojos y personalizada sólo deben cambiar tokens semánticos (`--green`, `--ink`, `--mint`, `--accent`), no colores por componente. Esto garantiza contraste y consistencia.

## 10. Plan de implementación técnica

### Sprint 1

Configurar TypeScript, rutas, cliente HTTP, sesión, layout y tokens. Sustituir mocks de Hoy por `GET /dashboard/today`.

### Sprint 2

CRUD de pacientes y agenda. Agregar validación de traslapes, paginación y tareas de confirmación.

### Sprint 3

Consulta, secciones del expediente, schemas, autoguardado y control de concurrencia.

### Sprint 4

Motor de cálculos con pruebas unitarias y evaluación del plan.

### Sprint 5

Recetas, equivalentes, distribución semanal y versionado.

### Sprint 6

Generación de PDF, entrega, auditoría, permisos y pruebas end-to-end.

## 11. Definición de terminado

Un módulo está terminado cuando tiene API persistente, permisos, loading/empty/error, responsive, accesibilidad básica, pruebas unitarias de reglas y una prueba end-to-end del camino principal. Una interfaz que sólo funciona con datos mock se considera prototipo, no funcionalidad terminada.
