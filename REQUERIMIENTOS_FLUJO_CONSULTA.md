# Requerimientos del flujo de consulta (de las hojas manuscritas)

Transcripción de las dos hojas de la usuaria, con el avance de cada punto. Se actualiza a medida que avanza el flujo.

- `[x]` hecho y verificado
- `[~]` parcial
- `[ ]` pendiente

---

## Hoja 1

### 1. Agenda

- [x] **Sugerencia horario.** En el modal de nueva cita aparecen los próximos espacios libres para la fecha y duración elegidas, dentro del horario de atención (pasos de 15 min); un clic fija la hora.
- [x] **Pedir que traigan estudios en caso de tener.** Casilla "Pedir que traiga sus estudios (análisis) si tiene" que rellena la nota para el paciente.

### 2. Consulta

- [x] **Datos del paciente.** Fecha de nacimiento y ocupación se muestran en Resumen y se pueden **editar desde la consulta** (se guardan en el registro del paciente).
- [x] **Motivo de consulta.** Campo editable al inicio de Resumen (alimenta el resumen de los PDFs de informe y expediente).

#### 2.1 Antropométrico

- [x] **Medición de medidas y fórmulas.** Captura de peso/talla, circunferencias, composición y pliegues; IMC e ICC calculados; gráfica de evolución con mediciones reales.

#### 2.2 Bioquímico

- [x] Estudios de laboratorio con sus interpretaciones (captura manual de estudio/valor/unidad/rango/estado) y PDF adjunto.
- [x] Son **opcionales en la primera consulta** y se sugiere realizarlos/traerlos en la segunda (aclarado en la sección, con tarjeta "Solicitud de estudios").
- [x] Se guardan en el expediente.

#### 2.3 Clínico

- [x] Antecedentes familiares (pestaña **General**).
- [x] Enfermedades.
- [x] Cirugías realizadas.
- [x] Medicamentos.
- [x] Suplementos.
- [x] Interacciones entre medicamentos/suplementos con nutrientes.
- [x] Alergias / intolerancias.
- [x] Tabaco y/o alcohol (si consume y frecuencia).
- [x] Síntomas.
- [x] Exploración física.

#### 2.4 Dietético

- [x] Cuántas comidas realiza en un día y a qué hora.
- [x] Comidas/bebidas preferidas.
- [x] Alimentos que no son de su agrado o que le causan malestar.
- [x] Cuántos vasos de agua toma al día.
- [x] A qué hora tiene más hambre.
- [x] Había asistido a consulta nutricional → de qué tipo, por cuánto tiempo llevó la dieta, por qué razón, resultados, qué tanto se apegó.

**Continuación 2.4** (columna derecha de la hoja 1)

- [x] **Frecuencia de alimentos**: días a la semana que consume cada alimento (leche, queso, carne de pollo, huevo, tortilla, etc.). Tabla de 18 alimentos.
- [x] **Dieta habitual**: el paciente describe lo que come normalmente en desayunos, colaciones, almuerzos y cenas (con cantidades y horarios).
- [x] **Recordatorio 24 horas**: descripción por tiempo de comida (desayuno, colaciones, almuerzo y cena) con horarios y cantidades; el software **suma** calorías, proteína, carbohidratos, grasas (saturadas, monoinsaturadas, polinsaturadas, colesterol), azúcar, fibra, vit A, vit C, vit B9, calcio, hierro, potasio, sodio y fósforo; **compara** con las cantidades ideales por sexo y grupo de edad y calcula el **% de adecuación** (consumo ÷ ideal × 100), interpretado como `<95% Bajo`, `95–105% Normal`, `>105% Alto`.

#### 2.5 Estilo de vida

- [x] Actividad física.
- [x] Sueño.
- [x] Estado de ánimo / estrés.
- [x] Jornada laboral.
- [x] Otros.

#### 2.6 Sociocultural

- [x] Se pregunta si hay barreras económicas para el plan (presupuesto).
- [x] Entorno familiar.
- [x] Prácticas o restricciones religiosas o culturales.

---

## Hoja 2

#### 2.7 Diagnóstico nutricional

- [x] **CESIVA**: tabla con una fila por criterio (Completa, Equilibrada, Suficiente, Inocua, Variada, Adecuada) y columnas Evaluación (Cumple / Parcial / No cumple) y Comentario.
- [x] **Tipo de dieta**: aquí se evalúa la alimentación del paciente.
- [x] **Diagnóstico**: problemas nutricionales asociados a una causa (etiología) y evidenciados con signos/síntomas, en formato PES por dominio.

#### 2.8 Tratamiento o Intervención

- [x] Objetivos (con base al diagnóstico).
- [x] Metas SMART, barreras y soluciones.
- [x] Recomendaciones dietéticas clave.
- [x] Suplementos.
- [x] Educación alimentaria.
- [x] Acuerdos con el paciente.
- [x] Próximos pasos.

---

## Flujo de cierre

> "Acá acaba la consulta, le doy click a **Terminar consulta**, escribo el monto de la consulta y se registra el método de pago y luego le doy a **Terminar y registrar** → luego le pregunto al paciente qué día quisiera tener su siguiente cita. Le doy click al botón **Agendar** o lleno la información, luego le doy a **Crear cita**. Me despido del paciente. Luego le doy click a **descargar expediente**."

- [x] Terminar consulta → monto + método de pago (efectivo / tarjeta / transferencia) → "Terminar y registrar".
- [x] Preguntar la siguiente cita: el modal de cierre ofrece fecha/hora/tipo/duración y "Crear cita".
- [x] Descargar el expediente completo al final del flujo.

---

## Notas de implementación

- Las secciones del expediente y el cierre guiado se construyeron en las fases 68–74; el **recordatorio de 24 h** y la **eliminación del paciente por defecto** se recuperaron en la fase 77 (habían quedado fuera de `main` por un merge anterior a su push).
- Las **referencias de energía/macros/grasas/colesterol/azúcar/potasio/sodio/fósforo** del recordatorio son estándar (DRI/AMDR del IOM y valores FDA), marcadas en el código (`src/lib/recall.js`) para revisión de la nutrióloga. Los micronutrientes usan el IDR transcrito del Excel de trabajo.
- Detalle conocido no bloqueante: la fecha de nacimiento se muestra con conversión de zona horaria (un día antes en husos negativos); pendiente de ajustar a formato UTC.
