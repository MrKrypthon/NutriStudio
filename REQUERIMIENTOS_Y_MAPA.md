# Nutri Studio: Requerimientos y Mapa de Construcción

Documento base para construir el software web a partir de `MVP Software de Nutrición.pdf`. Las referencias visuales revisadas son HeyNutre, Avena y Nutrium. Nutri Studio toma la claridad de HeyNutre, la potencia de cálculo y recetas de Avena y el flujo guiado de Nutrium, evitando dashboards saturados y formularios largos sin contexto.

## 1. Objetivo del MVP

Permitir que una nutrióloga gestione el ciclo completo de atención desde un solo espacio:

```text
Contacto -> Cita -> Consulta -> Expediente -> Diagnóstico -> Plan -> Entrega -> Seguimiento
```

El MVP debe resolver primero el trabajo de la profesional. El portal o app del paciente, pagos, marketing y automatizaciones avanzadas quedan fuera de la primera entrega.

## 2. Roles y permisos

| Rol | Puede hacer | No puede hacer |
|---|---|---|
| Propietaria | Configurar consulta, usuarios, plantillas, exportar y ver auditoría | N/A |
| Nutrióloga | Gestionar pacientes, consultas, expedientes, cálculos y planes | Administrar facturación o usuarios, salvo permiso explícito |
| Asistente | Gestionar agenda, datos de contacto y recordatorios | Ver notas clínicas, diagnósticos o resultados sensibles |

Todo acceso a información clínica debe estar vinculado a una práctica y quedar registrado en una bitácora.

## 3. Mapa de módulos

```text
Nutri Studio
├── Acceso y práctica
│   ├── Inicio de sesión
│   ├── Perfil profesional
│   ├── Configuración de horarios y zona horaria
│   └── Usuarios, roles y permisos
├── Hoy
│   ├── Citas del día
│   ├── Pendientes por confirmar
│   ├── Seguimientos por enviar
│   └── Acciones rápidas
├── Agenda
│   ├── Vista día / semana
│   ├── Crear cita
│   ├── Crear evento / bloqueo
│   ├── Confirmaciones y recordatorios
│   └── Sincronización opcional con Google Calendar
├── Pacientes
│   ├── Lista, búsqueda y filtros
│   ├── Alta / edición
│   ├── Línea de tiempo de consultas
│   ├── Expediente clínico nutricio
│   └── Planes y documentos
├── Consulta y expediente
│   ├── Resumen
│   ├── General
│   ├── Antropométrico
│   ├── Bioquímico
│   ├── Clínico
│   ├── Dietético
│   ├── Estilo de vida
│   ├── Sociocultural
│   ├── Diagnóstico TND
│   ├── Tratamiento
│   ├── Monitoreo
│   ├── Notas
│   └── Grabación / transcripción con consentimiento
├── Plan nutricional
│   ├── Evaluación y objetivos
│   ├── Requerimiento energético
│   ├── Actividad física y METS
│   ├── Macronutrientes
│   ├── Equivalentes y porciones
│   ├── Selector de recetas
│   ├── Distribución semanal
│   ├── Indicaciones al paciente
│   └── Publicar y exportar PDF
└── Biblioteca
    ├── Recetas
    ├── Ingredientes
    ├── Sistema mexicano de equivalentes
    ├── Plantillas de consulta
    ├── Plantillas de plan
    └── Material educativo
```

## 4. Requerimientos funcionales

### RF-01. Acceso y contexto

- El usuario inicia sesión y sólo ve datos de su práctica.
- La interfaz muestra nombre, rol, zona horaria y estado del plan.
- La sesión expira y permite cerrar todas las sesiones activas.

### RF-02. Dashboard Hoy

- Mostrar sólo cuatro indicadores: citas de hoy, citas por confirmar, seguimientos por enviar y pacientes activos.
- Mostrar hora, duración, paciente, tipo y estado de cada cita.
- Permitir abrir agenda e iniciar consulta desde cada cita.
- Mostrar la lista de pacientes que aún no confirman.
- Mostrar la cola de planes/informes pendientes de envío.
- No incluir actividad reciente en el MVP; el PDF la considera secundaria.

**Interfaz:** conservar la estructura de HeyNutre, pero con jerarquía editorial más marcada, menos tarjetas y estados accionables. En móvil, las citas se convierten en tarjetas verticales.

### RF-03. Agenda

- Visualizar día y semana.
- Usar intervalos de 15, 30 y 45 minutos, además de horas completas.
- Crear una cita o un evento que bloquee disponibilidad.
- En una cita capturar: paciente, fecha, hora, duración, tipo, notificación, estado, nota interna y nota visible al paciente.
- Tipos iniciales: primera consulta, seguimiento, control rápido y emergencia.
- Permitir repetir una cita y definir disponibilidad semanal.
- Mostrar claramente la zona horaria del profesional y del paciente.

**Interfaz:** modal en dos pasos, como la referencia de Nutrium: primero seleccionar paciente, luego confirmar datos. El formulario debe evitar una pantalla vertical interminable.

### RF-04. Pacientes

- Listar nombre, contacto, edad/género, última consulta, próxima cita y estado.
- Buscar por nombre, teléfono o email.
- Filtrar por estado: activo, inactivo, sin cita próxima.
- Crear paciente con datos mínimos y completar el expediente después.
- Al seleccionar paciente, ofrecer `Abrir expediente` e `Ir al plan`.
- Mostrar una línea de tiempo de consultas, documentos, citas y planes.

**Interfaz:** conservar la tabla simple de HeyNutre. En desktop usar tabla; en móvil usar tarjetas con la próxima acción visible.

### RF-05. Expediente clínico nutricio

- Guardar automáticamente cada sección y mostrar estado de guardado.
- Permitir navegar por pestañas/secciones sin perder cambios.
- Permitir campos rápidos tipo etiqueta y campos de texto detallado.
- Mantener historial por consulta; no sobrescribir mediciones anteriores.
- Permitir descargar el expediente completo o una selección de secciones.
- Diferenciar datos internos de contenido que aparecerá en el informe del paciente.

**Secciones y campos mínimos:**

| Sección | Contenido |
|---|---|
| Resumen | Datos personales, historial de consultas y alertas |
| General | Motivo, objetivo, referencia y contexto de la cita |
| Antropométrico | Peso, talla, IMC, cintura, cadera, brazo, pliegues, % grasa, músculo y evolución |
| Bioquímico | Estudios, fecha, resultado, unidad, rango y estado interpretativo |
| Clínico | Antecedentes, patologías, cirugías, medicamentos, suplementos, alergias, síntomas y signos vitales |
| Dietético | Comidas, horarios, preferencias, aversiones, recordatorio 24h, hambre/saciedad y bebidas |
| Estilo de vida | Actividad, sueño, trabajo y estrés |
| Sociocultural | Familia, religión/cultura, economía, horarios y barreras |
| Diagnóstico | Diagnósticos TND por dominio, problema, causa y evidencia |
| Tratamiento | Objetivos, recomendaciones, educación, metas SMART, acuerdos y próximos pasos |
| Monitoreo | Adherencia, peso, glucosa, fotos, laboratorios y notas de la próxima visita |
| Notas | Información adicional no clasificada |

### RF-06. Grabación y transcripción

- Mostrar una acción de `Grabar consulta` sólo tras consentimiento explícito.
- Permitir pausar, finalizar y eliminar una grabación.
- Procesar la transcripción de forma asíncrona.
- Mostrar sugerencias de campos, nunca escribir datos clínicos sin revisión humana.
- Guardar quién aceptó y quién confirmó cada sugerencia.

### RF-07. Cálculos nutricionales

- Calcular IMC y rangos de peso ideal a partir de datos antropométricos.
- Permitir elegir Mifflin, Harris-Benedict, FAO/OMS, FAO/OMS/ONU, Valencia, Schofield, Cunningham y Katch-McArdle.
- Permitir factor de actividad sedentario, ligero, moderado e intenso.
- Permitir alternativa por METS con actividad, duración, frecuencia y energía.
- Distribuir carbohidratos, proteínas y grasas por porcentaje, gramos y kcal.
- Validar que la distribución sume 100% y mostrar advertencias comprensibles.
- Mostrar fórmula, versión de cálculo y datos usados.

### RF-08. Constructor de plan

- Guiar el proceso como wizard: evaluación, plan alimentario, distribución y entrega.
- Permitir usar plantilla o copiar plan anterior como punto de partida.
- Distribuir equivalentes por tiempo de comida.
- Seleccionar recetas por catálogo general o por compatibilidad con la distribución.
- Filtrar por restricciones, ingredientes, preferencias, tiempo y objetivo.
- Mostrar calorías, macros y micronutrientes de cada receta.
- Intercambiar ingredientes con equivalentes sin romper las restricciones configuradas.
- Asignar preparaciones a desayuno, comida, colaciones, pre/post-entreno y cena por día.
- Añadir agua, recomendaciones, suplementos, educación y metas SMART.
- Previsualizar, publicar, descargar PDF y registrar la entrega.

**Interfaz:** la matriz de Avena se mantiene para distribución; el catálogo de recetas se presenta como tarjetas con imagen; el detalle se abre en panel lateral para no perder el contexto del plan.

### RF-09. Documentos y PDF

- Generar informe de consulta y menú de alimentación.
- Permitir elegir secciones, ocultar campos vacíos y usar datos de la práctica.
- Mostrar vista previa antes de exportar.
- Versionar el documento generado y registrar fecha, usuario y destinatario.
- Permitir descarga local y preparar envío por WhatsApp/email mediante integración posterior.

### RF-10. Biblioteca

- Crear, editar, archivar y buscar recetas e ingredientes.
- Definir porciones, equivalentes, calorías, macros, micros, ingredientes y pasos.
- Crear plantillas clonables para expediente y planes.
- Evitar que editar una plantilla cambie expedientes o planes ya publicados.

## 5. Requerimientos no funcionales

- Responsive desde 360 px hasta desktop amplio.
- Accesibilidad WCAG 2.2 AA: foco visible, contraste, labels, navegación por teclado y mensajes de error.
- Auto-guardado con indicador `Guardado`, `Guardando` y `Error al guardar`.
- API con validación server-side, paginación, filtros y límites de carga.
- Cifrado TLS y cifrado de archivos clínicos en reposo.
- Auditoría de lecturas sensibles, cambios y exportaciones.
- Copias de seguridad y estrategia de restauración probada.
- Los cálculos deben tener pruebas unitarias con casos clínicos de referencia.
- PDF reproducible: una versión publicada no debe cambiar si se edita la receta original.
- Tiempo objetivo: dashboard menor a 2 segundos con datos cacheados; búsqueda de pacientes menor a 500 ms.

## 6. Mapa de construcción por fases

### Fase 0. Cimientos y sistema visual

**Entregables:** proyecto React/TypeScript, rutas, layout, tokens visuales, componentes de botón/input/modal/card/table, autenticación simulada, estados responsive.

**Pantallas:** login, layout, Hoy inicial.

**Criterio de salida:** la aplicación navega entre secciones, funciona con teclado y mantiene el sistema visual verde bosque/menta/ámbar definido en `ARQUITECTURA.md`.

### Fase 1. Operación diaria

**Entregables:** pacientes, alta/edición, agenda día/semana, crear cita/evento, confirmación y pendientes.

**Pantallas:** `Hoy`, `Agenda`, `Nueva cita`, `Nuevo evento`, `Pacientes`, `Nuevo paciente`.

**Criterio de salida:** una profesional puede crear paciente, agendar consulta y verla reflejada en Hoy sin datos mock.

### Fase 2. Consulta y expediente

**Entregables:** consulta versionada, auto-guardado, secciones clínicas, timeline, permisos por rol y exportación inicial.

**Pantallas:** encabezado de consulta, tabs del expediente, resumen, antropométrico, bioquímico, clínico, dietético, estilo de vida, sociocultural, diagnóstico, tratamiento, monitoreo y notas.

**Criterio de salida:** completar una valoración, regresar a ella y observar la evolución respecto de la consulta anterior.

### Fase 3. Motor nutricional

**Entregables:** fórmulas, IMC, rangos, actividad por factor/METS, macros, equivalentes y pruebas de cálculo.

**Pantallas:** evaluación del plan, requerimientos, distribución de macros y equivalentes.

**Criterio de salida:** cada resultado muestra entradas, fórmula y resultado; los porcentajes inválidos no pueden publicarse.

### Fase 4. Recetas y planificación semanal

**Entregables:** ingredientes, recetas, detalle nutricional, sustituciones y semana visual.

**Pantallas:** biblioteca de recetas, panel de detalle, matriz de porciones y calendario semanal.

**Criterio de salida:** seleccionar una receta, sustituir un ingrediente y comprobar que el plan recalcula sus valores.

### Fase 5. Entrega y seguimiento

**Entregables:** PDF de informe y menú, branding, selección de secciones, cola de envío, recordatorios y seguimiento.

**Pantallas:** configuración de documento, vista previa, cola de pendientes y detalle de entrega.

**Criterio de salida:** publicar una versión inmutable, descargarla y verla reflejada como seguimiento pendiente/completado.

### Fase 6. Automatización responsable

**Entregables:** grabación, transcripción, sugerencias de campos, integraciones de WhatsApp/email/Calendar y portal del paciente.

**Criterio de salida:** ninguna automatización clínica se publica sin consentimiento y confirmación profesional.

## 7. Orden recomendado de interfaces

1. Hoy, porque define navegación, estados y lenguaje visual.
2. Pacientes y Agenda, porque alimentan el flujo operativo.
3. Consulta con Resumen, General y Antropométrico, porque valida el modelo clínico.
4. Resto del expediente, usando el mismo patrón de sección.
5. Evaluación y cálculo del plan.
6. Distribución, recetas y calendario semanal.
7. PDF, seguimiento y automatizaciones.

## 8. Criterios de aceptación transversales

- Cada pantalla tiene un estado vacío, carga, error y éxito.
- Toda acción destructiva solicita confirmación y explica el impacto.
- Los botones principales tienen una sola acción primaria por vista.
- Los formularios largos se dividen por contexto, con navegación anterior/siguiente y guardado automático.
- Los datos de ejemplo visuales deben reemplazarse por API antes de considerar terminado el módulo.
- La UI nunca presenta un cálculo como diagnóstico médico definitivo.

## 9. Fuera de alcance inicial

- Facturación y cobro en línea.
- Marketplace o descubrimiento de nutriólogos.
- App nativa del paciente.
- IA que diagnostique o genere planes sin aprobación.
- Integraciones clínicas externas no definidas.
- Catálogo comercial con derechos de autor no licenciados.
