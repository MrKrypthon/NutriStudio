# Nutri Studio

Arquitectura funcional y técnica propuesta para una plataforma web de práctica nutricional. Este documento sintetiza el PDF `MVP Software de Nutrición.pdf`, incluyendo la revisión visual de referencias de HeyNutre, Avena y Nutrium.

Para el backlog ejecutable, requisitos y criterios de aceptación por fase, consultar `REQUERIMIENTOS_Y_MAPA.md`.
Para contratos de datos, endpoints, estados de interfaz y definición de terminado, consultar `ESPECIFICACIONES_TECNICAS.md`.

## 1. Producto

Nutri Studio es un espacio de trabajo para nutriólogos que convierte una consulta en un flujo continuo: captación, agenda, consulta clínica, diagnóstico, plan, entrega y seguimiento.

### Principios de diseño

- **Hoy primero:** la pantalla inicial sólo muestra lo accionable: citas, confirmaciones y planes pendientes.
- **Profundidad progresiva:** el expediente conserva todos los campos clínicos, pero los presenta por etapas y no como un formulario infinito.
- **Una fuente de verdad:** paciente, consulta, plan y documentos están vinculados por `patient_id` y `consultation_id`.
- **Cálculos visibles:** cada resultado automático muestra fórmula, valores de entrada y posibilidad de revisión manual.
- **Comunicación integrada:** recordatorios y entrega de planes se modelan como tareas con estado, no como notas sueltas.
- **Privacidad por defecto:** datos clínicos cifrados, auditoría y control de acceso desde el primer MVP.

## 2. Módulos del MVP

### Hoy

Dashboard de operación diaria. KPIs: citas del día, por confirmar, seguimientos por enviar y pacientes activos. Incluye agenda compacta, acciones rápidas y cola de tareas.

### Agenda

Vistas día y semana con intervalos de 15 minutos. Crear dos tipos de bloque: cita y evento. Una cita incluye paciente, fecha, duración, tipo, estado, canal de notificación, nota interna y nota visible para paciente. Preparar integración Google Calendar, pero mantenerla opcional.

### Pacientes

Listado con búsqueda, filtros y estado. El detalle ofrece dos accesos: **Consulta / expediente** y **Plan nutricional**. Mostrar última consulta, próxima cita y tareas abiertas.

### Expediente clínico nutricio

Flujo por pasos con guardado automático y navegación lateral:

1. Resumen y datos generales.
2. Antropométrico: peso, talla, IMC, circunferencias, pliegues, composición corporal y evolución.
3. Bioquímico: laboratorios, fechas, unidades y estado de interpretación.
4. Clínico: antecedentes, patologías, medicamentos, suplementos, alergias, síntomas y signos vitales.
5. Dietético: horarios, preferencias, aversiones, recordatorio 24h, hambre/saciedad y bebidas.
6. Estilo de vida: actividad, sueño, jornada y estrés.
7. Sociocultural: familia, religión/cultura, contexto económico y barreras.
8. Diagnóstico: dominios TND de ingestión, clínicos, conductuales/ambientales y otros.
9. Tratamiento: objetivos, recomendaciones, educación, metas SMART, suplementos y acuerdos.
10. Monitoreo y notas: indicadores de seguimiento, adherencia y próximos puntos a revisar.

La grabación/transcripción debe ser una capacidad separada, con consentimiento explícito y revisión humana antes de escribir campos.

### Plan nutricional

Wizard de cuatro fases: **Evaluación → Plan alimentario → Distribución → Entrega**.

- Evaluación: datos antropométricos, rangos de peso ideal y objetivos.
- Requerimiento: Mifflin, Harris-Benedict, FAO/OMS/ONU, Valencia, Schofield, Cunningham y Katch-McArdle.
- Actividad: factor por nivel (sedentaria, ligera, moderada, intensa) y cálculo alternativo por METS, tiempo y frecuencia.
- Macronutrientes: porcentajes, gramos y kcal con validación de total 100%.
- Distribución: equivalentes por tiempo de comida y porciones editables.
- Recetas: catálogo con filtros por distribución, restricciones, tiempo y objetivo; sustituciones mediante sistema mexicano de equivalentes.
- Semana: asignación visual por día y tiempo, indicaciones, agua y recomendaciones.
- Entrega: vista previa, PDF, asignación al paciente y registro del envío.

### Biblioteca

Recetas, ingredientes, equivalentes, plantillas de consulta, plantillas de plan y materiales de educación. Versionar plantillas para que un cambio no altere planes históricos.

## 3. Arquitectura técnica

### Primera versión

- Frontend: React + Vite + TypeScript en una SPA responsive.
- UI: tokens propios, componentes accesibles y formularios tipados. La base actual usa React + Vite y CSS para validar la dirección visual.
- Backend recomendado: NestJS o Fastify con API REST y jobs asíncronos.
- Base de datos: PostgreSQL. Archivos clínicos y PDFs en almacenamiento S3-compatible.
- Auth: sesiones seguras o JWT rotado, MFA opcional, roles `owner`, `nutritionist`, `assistant`.
- Jobs: cola para PDF, recordatorios, procesamiento de audio y notificaciones.
- Observabilidad: logs estructurados, auditoría de cambios y errores con correlation id.

### Dominios

```text
src/
  app/                 # rutas, providers y layout
  modules/
    dashboard/
    calendar/
    patients/
    clinical-record/
    nutrition-plan/
    recipes/
    ingredients/
    templates/
    documents/
  components/          # primitives y patrones compartidos
  lib/                 # api client, permisos, validaciones
  styles/              # tokens y estilos globales
```

### Entidades esenciales

`Practice`, `User`, `Patient`, `Appointment`, `Consultation`, `ClinicalRecord`, `Measurement`, `LabResult`, `Diagnosis`, `Treatment`, `NutritionPlan`, `MealSlot`, `Recipe`, `Ingredient`, `Equivalence`, `Document`, `Task`, `AuditEvent`.

Las mediciones, diagnósticos y planes son inmutables por consulta: se crean nuevas versiones en cada valoración. Esto permite comparar evolución y reproducir el PDF que recibió el paciente.

## 4. API inicial

```text
GET    /api/dashboard/today
GET    /api/appointments?from=&to=
POST   /api/appointments
GET    /api/patients?search=&status=
POST   /api/patients
GET    /api/patients/:id/consultations
POST   /api/patients/:id/consultations
PATCH  /api/consultations/:id/sections/:section
POST   /api/consultations/:id/transcription
POST   /api/nutrition-plans/calculate
GET    /api/recipes?meal=&filters=
POST   /api/nutrition-plans/:id/publish
POST   /api/documents/:id/pdf
```

## 5. Reglas clínicas y de seguridad

- Los cálculos son ayudas para el profesional, nunca diagnóstico automático.
- Registrar fórmula, versión, entradas, resultado y usuario que confirmó.
- Validar unidades, rangos plausibles y fechas de medición.
- Solicitar consentimiento para grabación, transcripción y comunicación por WhatsApp/email.
- Separar notas internas de notas visibles para el paciente.
- Aplicar mínimo privilegio, cifrado en tránsito/reposo, expiración de enlaces y bitácora de exportaciones.
- Diseñar los informes para revisión legal de la NOM-004-SSA3-2012 y la LFPDPPP; la implementación debe validarse con asesoría especializada en México.

## 6. Roadmap

### Entrega 1: operación básica

Hoy, agenda, pacientes, creación de consulta, expediente general y exportación simple.

### Entrega 2: valor clínico

Secciones clínicas completas, mediciones históricas, diagnósticos TND, cálculo energético y plan por macros.

### Entrega 3: diferenciador

Recetario con equivalentes, distribución semanal, PDF de marca, recordatorios y seguimiento.

### Entrega 4: automatización responsable

Transcripción con consentimiento, sugerencias de campos, plantillas inteligentes, portal/app de paciente e integraciones.

## 7. Decisiones visuales

La referencia visual combina la claridad de los listados de HeyNutre, la densidad funcional de Avena y el wizard de Nutrium, pero evita sus principales problemas: demasiados elementos en el dashboard, formularios planos y acciones dispersas. La paleta fuente es `PaletaDeColores.png` en la raíz: coral `#F05255`, rosa claro `#F7D7D0`, marfil `#F2EEEE`, verde lima `#A5CC4C`, terracota `#B24035`, naranja `#E29248`, amarillo `#F0D625`, verde hoja `#66963F`, morado `#4B246D` y berry `#982E76`. La interfaz usa coral como acción primaria, rosa/marfil como superficies y los tonos inferiores para estados, categorías e iconografía. En móvil, la navegación se compacta y las tablas se convierten en tarjetas apiladas.
