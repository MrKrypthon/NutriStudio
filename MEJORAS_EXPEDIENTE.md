# Mejoras del MVP — Sección Expediente (fase 84)

Transcripción a tareas concretas de `Mejoras del MVP - Seccion Expediente.pdf` (16 páginas, feedback
de la nutrióloga sobre Hoy, Agenda, Pacientes y las 12 secciones del expediente). Se actualiza a
medida que avanza.

- `[x]` hecho y verificado · `[~]` parcial · `[ ]` pendiente

---

## Tanda 1 — Hoy, Agenda, Pacientes (navegación)

- [x] **Hoy.** Clic en el recuadro de una cita de hoy lleva directo a iniciar la consulta (ya existe
  para citas confirmadas; se revisa que cubra el caso general).
- [x] **Agenda — selector de paciente.** "Selecciona…" pasa a admitir texto (buscar por nombre
  mientras se despliegan las opciones) y gana una opción "+ Nuevo paciente".
- [x] **Agenda — duración.** Opciones de minutos 15/30/45 además de las ya existentes.
- [x] **Agenda — confirmar cita.** El primer clic confirma con un mensaje "¿Deseas confirmar la
  cita?" en vez de confirmar en silencio.
- [x] **Agenda — abrir consulta.** Cualquier cita confirmada abre la consulta al seleccionarla, no
  sólo con un segundo clic puntual.
- [x] **Pacientes.** Botón "Agendar cita" en la ficha lateral del paciente.

## Tanda 2 — Resumen

- [x] Reordenar: **Datos del paciente primero**, luego Motivo de consulta.
- [x] Gráficas de progreso (peso, % grasa, masa muscular) con los datos reales de `measurements`.
- [x] Sugerencias (chips) para Motivo de consulta — clic completa una oración de ejemplo.
- [x] Campo "Referencia de la cita" (quién refiere al paciente / motivo de la referencia).

## Tanda 3 — Bioquímico

- [x] Quitar la frase "(se traen en la 2ª consulta)" del campo de estudios solicitados.

## Tanda 4 — Clínico

- [x] Componente reutilizable de **sugerencias con chips + botón "+ Rápido"** (se usa aquí y en
  Monitoreo general, que ya lo tenía a mano en el PDF como referencia).
- [x] Antecedentes personales: chips de sugerencia (Diabetes, Hipertensión, Hipotiroidismo…) y de
  cirugías comunes.
- [x] Nueva sección **Antecedentes Ginecobstétricos** debajo de Antecedentes personales: ciclo y
  menstruación, historia obstétrica, climaterio y terapia hormonal, observaciones.
- [x] Medicamentos y suplementos: chips de sugerencia + botón "+ Rápido" que abre un formulario de
  dos campos (sugerencia + descripción); clic en una sugerencia autocompleta el texto.
- [x] Alergias y sustancias: mismo tratamiento de chips de sugerencia.
- [x] Nueva pestaña **Monitoreo Clínico** antes de Notas: Signos Vitales (frecuencia cardiaca,
  frecuencia respiratoria, oxigenación, temperatura), Pruebas Capilares, Fuerza/Función
  (dinamometría, velocidad de la marcha, Time Up and Go, sentarse-pararse 30 s).

## Tanda 5 — Dietético

- [x] Restructurar Patrón de alimentación: se integra "Hidratación y bebidas" (agua, refrescos/jugos,
  bebidas energéticas, café o té) dentro de Patrón, y se agregan "Restricciones dietéticas" y "Notas
  dietéticas" ahí; se retira la subsección separada "Consumo de agua".
- [x] Historial: agregar "¿Ha utilizado medicamentos para bajar de peso?" y el bloque **Historia
  Dietética** (sabe cocinar, quién prepara los alimentos, come entre comidas, electrodomésticos,
  cambios en los últimos 6 meses, variación con el ánimo, sal agregada).

## Tanda 6 — Diagnóstico

- [x] **Catálogo completo**, ya desbloqueado: la nutrióloga envió el documento fuente (eNCPT 2017,
  Academy of Nutrition and Dietetics) y se transcribió a `src/lib/pesTerms.js` — los 4 dominios, sus
  categorías y 162 términos con clave TPAN. Dominios PES ahora muestra, por dominio, las categorías
  desplegables con sus diagnósticos hijos y la cuenta de cada una; un buscador filtra por texto o
  clave en vivo. Elegir un término precarga Problema y la clave TPAN en el formulario, dejando sólo
  etiología y evidencia por capturar — propias de cada paciente y no parte de ningún catálogo.
  Esto se construyó en paralelo por otra sesión trabajando en este mismo repo; de mi parte se
  encontró y corrigió un bug real en los datos que esa sesión entregó: la clave `NC-3.5` ("Tasa de
  crecimiento por debajo de lo esperado") estaba duplicada —una vez en Bioquímicos por error de
  transcripción, una vez en Peso correctamente—, y esa colisión de `key` en React rompía el buscador:
  una búsqueda sin relación con ese término (p. ej. "obesidad") lo mostraba igual, dos veces. Quitada
  la entrada sobrante, verificado que las 162 claves son únicas y que la búsqueda vuelve a filtrar
  con exactitud.

## Tanda 7 — Tratamiento

- [x] Botón "Ir al plan" (lleva al Constructor de plan con el paciente ya seleccionado).
- [x] Campo "Actividad física recomendada".
- [x] Nuevo apartado **Requerimientos** después de Objetivos: balance calórico
  (Normocalórico/Déficit/Superávit) y gramos por kilo de hidratos, proteína y lípidos, con el
  objetivo energético calculado en vivo a partir del peso más reciente ya capturado en
  Antropométrico. Es una calculadora propia y más simple que la del Constructor de plan (que sigue
  siendo la autoridad para armar el menú con fórmulas de GET por edad/sexo/actividad); ésta vive en
  el expediente para registrar el objetivo en g/kg sin salir de la consulta.

## Tanda 8 — Monitoreo y Notas

- [x] Monitoreo (general) gana chips de sugerencia en "Apego al plan" con el mismo componente de la
  Tanda 4. Las capturas de referencia del PDF para esta sección mostraban campos de otra
  herramienta ("Aspectos a revisar en próxima visita", "Indicadores de seguimiento") que no
  corresponden a los campos reales de este Monitoreo — se aplicó el patrón de chips a lo que sí
  existe en pantalla, sin inventar campos nuevos no pedidos explícitamente.
- [x] Notas: sin cambios de fondo, sigue el mismo patrón visual.

## Tanda 9 — Botones y cumplimiento normativo

- [x] **Decisión de diseño** (no estaba en el PDF de forma inequívoca): la captura pide dejar sólo
  "Terminar consulta", "Agendar" y "Generar expediente" visibles. Había 3 tipos de documento ya
  construidos y verificados (informe para paciente, informe clínico, expediente/export) — quitarlos
  habría sido destructivo. Se optó por un menú desplegable único "Generar informe ▾" que agrupa los
  tres, dejando sólo 3 botones sueltos en la barra: Terminar consulta, Agendar, Generar informe.
- [x] El PDF señala que "Generar informe" debe cumplir la NOM-004-SSA3-2012 y la Ley Federal de
  Protección de Datos Personales en Posesión de los Particulares — se agrega el aviso de
  confidencialidad y los datos mínimos de expediente clínico (NOM-004) al pie del documento generado.

---

## Pendiente de la usuaria

1. Confirmar la consolidación de botones de la Tanda 9 si no es lo que tenía en mente.

---

## Resumen de lo entregado

Las 9 tandas están implementadas, verificadas y completas en la rama `fase-84-mejoras-expediente`,
cada una con su propia verificación en navegador contra datos reales y, donde aplicaba, generando
los PDF de verdad para comprobar el resultado.

De paso se corrigió una regresión real que la verificación de la Tanda 2 sacó a la luz: las
subpestañas de cada sección eran `<button>`, un elemento de formulario, y vivían dentro del
`<fieldset disabled>` que bloquea una consulta cerrada (fase 83) — un fieldset deshabilitado apaga
todos los elementos de formulario que contiene, botones incluidos, así que en una consulta ya
cerrada no había forma de cambiar de subsección para revisar lo que se había escrito. Ahora son
`<div role="button">`, que el fieldset no toca.
