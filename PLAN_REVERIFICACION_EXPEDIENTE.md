# Plan de re-verificación — Mejoras del MVP, Sección Expediente

Mismo PDF ya trabajado en las fases 84-87 (checksum idéntico). A pedido de la usuaria, esta fase
(93) lo vuelve a recorrer punto por punto contra el código actual en `main` (que ya incluye además
las fases 88-92, hechas por otra sesión concurrente), para confirmar que nada se perdió entre
medio y corregir lo que falte. Commits de esta rama: sólo lo que esté respaldado por una anotación
concreta de este PDF.

`[ ]` por verificar · `[x]` confirmado correcto en el código actual · `[~]` corregido en esta fase

## Hoy
- [x] Clic en el recuadro de una cita confirmada de "Agenda de hoy" llama a `onStartConsultation`,
  que ya navega a iniciar la consulta (`DashboardPage.jsx`).

## Agenda
- [x] Selector de paciente con texto + "+ Nuevo paciente" (tanda 1, fase 84).
- [x] Duración 15/30/45 min (tanda 1).
- [x] Confirmar con mensaje "¿Desea confirmar la cita?" (tanda 1).
- [x] Cualquier clic en una cita confirmada abre la consulta, no sólo el "segundo clic" (tanda 1).

## Pacientes
- [x] Botón "Agendar cita" en la ficha lateral (tanda 1).

## Resumen
- [x] Orden correcto: "Datos del paciente" es la primera subpestaña, "Motivo de consulta" la
  segunda.
- [x] Gráficas de progreso (peso/grasa/músculo).
- [x] Chips de sugerencia en Motivo de consulta y Referencia de la cita: etiquetas exactas
  (Pérdida de peso/Ganancia muscular/Patología/Prevención/Deportivo/Embarazo/Suplementos;
  Recomendación/Médico/Redes/Prensa).

## Bioquímico
- [x] La frase "(se traen en la 2ª consulta)" ya no aparece en ningún campo.

## Clínico
- [x] Antecedentes Ginecobstétricos: los 17 campos del recuadro están todos presentes con la
  etiqueta exacta.
- [x] Medicamentos/Suplementos/Interacciones: chips + "+ Rápido" con "Sugerencia"/"Descripción" y
  autocompletado al hacer clic (componente `SuggestionChips`).
- [x] Alergias/Intolerancias: chips ya existían.
- [~] Tabaco/Alcohol (en "Consumo de sustancias"): el PDF también pide chips ahí (Fumador/Ex
  fumador/No fuma; Consumo ocasional/Consumo regular/No consume) y sólo tenían campos de texto
  plano sin sugerencias — se agregaron `TABACO_SUGGESTIONS`/`ALCOHOL_SUGGESTIONS`.
- [x] Pestaña "Monitoreo Clínico" antes de "Notas", con las 3 tarjetas y sus campos exactos.

## Dietético
- [x] "Restricciones dietéticas" y "Notas dietéticas" en Patrón de alimentación.
- [~] "Hidratación y Bebidas": tenía 4 de los 5 puntos del recuadro — faltaba "Consumo de
  alcohol" (distinto del de Clínico, que es factor de riesgo; éste es parte del patrón de
  bebidas del día). Se agregó.
- [x] "¿Ha utilizado medicamentos para bajar de peso?" en Historial.
- [x] Bloque "Historia Dietética" con los 7 puntos exactos.

## Diagnóstico
- [x] Catálogo completo por dominio con categorías desplegables (fase 84/85).
- [x] Buscador por diagnóstico o clave dentro del selector de términos PES.

## Tratamiento
- [x] Botón "Ir al plan": funciona correctamente (usa el mismo `selectedPatientId` que ya trae el
  expediente abierto, así que llega al plan del paciente correcto, no a uno vacío). Su posición
  está en el encabezado de la sección en vez de junto a las subpestañas como en la referencia —
  diferencia puramente cosmética frente a un mockup ilustrativo, no un requisito escrito; se deja
  así (ya se había confirmado con la usuaria en la fase 87).
- [x] "Actividad física recomendada" en Recomendaciones.
- [x] Apartado "Requerimientos" después de "Objetivos", con balance energético, sliders g/kg y
  botón "Guardar como objetivo" (fase 87).

## Monitoreo / Notas
- [x] Sin cambios de fondo pedidos más allá de lo ya hecho en tanda 8 (las capturas de esa página
  son de otra herramienta, no de esta app).

## Generar informe / Botones
- [x] Aviso de confidencialidad + NOM-004/LFPDPPP en el pie del documento generado (tanda 9).
- [x] Cabecera reducida a 3 botones: Terminar consulta / Agendar / Generar expediente (fase 87).
