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

- [~] Buscador por diagnóstico o clave sobre los dominios PES.
- [ ] **Bloqueado**: el catálogo completo de diagnósticos PES por dominio/categoría con sus claves
  (NI-#, NC-#, NB-#, NO-#…) para construir el árbol seleccionable que muestran las capturas. La
  nutrióloga mencionó que lo enviaría aparte; sin él se mantiene el formulario libre actual
  (problema/etiología/evidencia) con el buscador añadido encima de los dominios.

## Tanda 7 — Tratamiento

- [x] Botón "Ir al plan" (lleva al Constructor de plan con el paciente ya seleccionado).
- [x] Campo "Actividad física recomendada".
- [x] Nuevo apartado **Requerimientos** después de Objetivos: se traslada ahí el cálculo de
  superávit/déficit calórico que hoy vive en el Constructor de plan, como referencia dentro del
  expediente.

## Tanda 8 — Monitoreo y Notas

- [x] Monitoreo (general) ya usa chips de sugerencia; se homologa al componente reutilizable de la
  Tanda 4 sin cambiar su contenido.
- [x] Notas: sin cambios de fondo, se revisa que siga el mismo patrón visual.

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

1. **Catálogo de diagnósticos PES** (Tanda 6) — documento por enviar.
2. Confirmar la consolidación de botones de la Tanda 9 si no es lo que tenía en mente.
