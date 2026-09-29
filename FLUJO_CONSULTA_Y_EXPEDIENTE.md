# Flujo de consulta y expediente — diagnóstico y plan (fase 83)

El contenido de la consulta (las 12 secciones, el cierre, el pago, el informe) está completo y
verificado en `REQUERIMIENTOS_FLUJO_CONSULTA.md`. Lo que no está resuelto es **la capa de encima**:
qué sesión abres cuando entras, cómo vuelves a donde te quedaste y qué pasa con lo que escribiste.
Este documento recoge lo que se comprobó y lo que se va a cambiar.

---

## 1. Qué hay hoy

### El modelo de datos

Un paciente tiene **muchas `Consultation`**. Cada una es una sesión con su propio juego de
`ClinicalSection` (las 12 pestañas), sus mediciones, sus diagnósticos y sus documentos. No existe
ninguna entidad "expediente": lo que la interfaz llama *expediente* es **una consulta concreta**
abierta en pantalla. Por eso la pregunta "¿me lleva a la consulta actual, a una pasada o a editar el
expediente?" no tiene respuesta en el código: las tres cosas son la misma pantalla.

### Las cinco puertas de entrada

| Desde | Qué pasa | Qué sesión abre |
|---|---|---|
| **Hoy** → clic en una cita | `startConsultation(pacienteId, citaId)` | La abierta si es de hoy; si no, cierra la vieja y crea una nueva. Marca la cita como `COMPLETED` |
| **Agenda** → clic en una cita | igual que Hoy | igual |
| **Pacientes** → "Abrir expediente" | `setActive('Expediente')` sin cita | La primera `IN_PROGRESS` que encuentre **sea de cuando sea**; si no hay, **crea una nueva** |
| **Consultas** → "Grabar consulta / informe" | igual que Pacientes | igual |
| **Consultas** → flecha de una sesión del historial | `openSession(pacienteId, consultaId)` | Esa sesión concreta, aunque esté cerrada |

Las tres primeras filas comparten el mismo destino, así que la respuesta corta a tu pregunta es:
**"Abrir expediente" no abre el expediente, abre (o inaugura) una consulta**, y cuál te toca depende
de un estado invisible.

---

## 2. Lo que se comprobó

### 2.1 Entrar a mirar crea una consulta

`ClinicalRecordPage` al cargar busca una consulta `IN_PROGRESS` y, si no hay ninguna,
llama a `clinicalApi.create(...)` **antes de que escribas nada**. Abrir el expediente de alguien para
consultar un dato deja una sesión abierta en su historial.

En la base actual hay **6 consultas completamente vacías** (sin secciones, sin mediciones, sin
diagnósticos) sobre 22 totales.

### 2.2 Una sesión abierta absorbe visitas futuras para siempre

El código ya detecta el problema y lo corrige… sólo cuando entras **desde una cita**: si la sesión
abierta es de otro día, la cierra y crea una nueva. Entrando desde **Pacientes** o **Consultas** no
hay cita, así que ese control no corre nunca y se reutiliza la sesión antigua.

Hoy (28-sep) **11 de las 22 consultas están `IN_PROGRESS` con fecha anterior**. La de Jorge Castillo
lleva abierta desde el 1 de septiembre: todo lo que se capture hoy entra en la sesión de hace 27 días.

### 2.3 No sabes en qué sesión estás

La cabecera dice sólo `Consulta nutricional · En curso`. Sin fecha, sin "sesión 3 de 5", sin
distinguir una sesión de hoy de una del mes pasado. Abrir una sesión histórica desde Consultas se ve
exactamente igual que iniciar una nueva, y además **se puede seguir escribiendo en una consulta ya
cerrada**: no hay ningún bloqueo por `status === 'COMPLETED'`.

### 2.4 No puedes volver a donde lo dejaste

Comprobado en el navegador:

```
tras login    URL = /            pantalla = Hoy
en Consultas  URL = /            pantalla = Consultas      ← la URL no cambió
en Pacientes  URL = /pacientes
en Expediente URL = /pacientes   pantalla = Pacientes      ← el expediente no tiene URL propia
TRAS RECARGAR URL = /pacientes   pantalla = Pacientes      ← se perdió el paciente y la sesión
```

El paciente seleccionado vive sólo en memoria (`useState` en `App.jsx`). Una recarga, un F5 sin
querer o volver de otra pestaña te devuelve a la lista. Tampoco tienen URL `Consultas`,
`Seguimientos` ni `Educación`, así que en esas pantallas la migaja de pan y la barra de direcciones
dicen cosas distintas.

### 2.5 Se pierde lo último que escribiste al salir

El autoguardado espera 800 ms tras la última tecla. Al desmontarse, el componente intenta salvar lo
pendiente:

```js
for (const [key, payload] of Object.entries(pendingRef.current)) {
  if (consultation?.id) clinicalApi.saveSection(consultation.id, key, payload, …)
}
```

Dos fallos encadenados en esas tres líneas:

1. La función de limpieza se crea en el efecto cuyas dependencias son `[patientId]`, es decir en el
   primer render, **cuando `consultation` todavía es `null`**. `consultation?.id` es `undefined`, la
   condición nunca se cumple y el guardado nunca se dispara.
2. Si se arreglara sólo eso, se rompería de otra forma: `pendingRef.current[key]` guarda
   `{ payload: … }`, no el payload, así que se enviaría anidado y la sección se guardaría con la
   forma equivocada.

**Efecto real:** si cambias de pestaña del menú dentro de los 800 ms siguientes a escribir, ese
texto se pierde sin aviso — y el indicador sigue diciendo "Guardado".

### 2.6 Nada se arrastra entre consultas

Cada consulta nace con las secciones vacías. Los antecedentes familiares, las alergias, las cirugías
o las intolerancias —que son datos del **paciente**, no de la visita— hay que volver a capturarlos en
cada sesión, o quedan enterrados en la consulta donde se escribieron. En la práctica esto obliga a
abrir la consulta vieja en otra pestaña para copiar a mano.

---

## 3. La decisión de fondo

Hay que separar dos cosas que hoy son una sola pantalla:

- **El expediente** — todo lo del paciente a lo largo del tiempo. Se entra a mirar, siempre está
  disponible, no crea nada. Es a donde debe llevar "Abrir expediente".
- **La consulta** — la sesión de hoy, que se **inicia con un acto explícito**, se trabaja y se
  cierra. Es a donde debe llevar una cita de Hoy/Agenda, o un botón "Iniciar consulta".

Con esa separación, cada pregunta tuya tiene respuesta:

- *"¿Abrir expediente me lleva a la consulta actual o a una pasada?"* → a ninguna: al expediente, con
  el historial a la vista y la sesión en curso marcada si la hay.
- *"¿Cómo determinamos todo eso?"* → por el acto del profesional, no por adivinar un estado. Una
  consulta existe porque alguien la inició; nunca porque alguien miró.

**Regla propuesta:** una consulta se crea **sólo** al pulsar "Iniciar consulta" o al entrar desde una
cita. Una consulta abierta de un día anterior se cierra automáticamente (con aviso) antes de abrir
una nueva, venga de donde venga.

---

## 4. Plan

Seis pasos, del más dañino al más cosmético. Cada uno es verificable por separado.

### Paso 1 — Que no se pierda lo escrito *(corrección, sin cambio de flujo)*

- Mover el `consultation` de la limpieza a un `ref` para que la función de desmontaje vea el valor
  vigente, y desanidar el payload.
- Añadir un `beforeunload` que fuerce el vaciado pendiente al cerrar la pestaña.
- Prueba: escribir en Clínico, cambiar de módulo antes de 800 ms, volver y comprobar que el texto
  está. Hoy falla.

### Paso 2 — Que abrir a mirar no cree nada

- `ClinicalRecordPage` deja de llamar a `create`. Si no hay sesión en curso, muestra el expediente en
  modo lectura con el botón **Iniciar consulta**.
- `POST /patients/:id/consultations` rechaza crear una segunda sesión abierta para el mismo paciente
  (hoy nada lo impide).
- Script de limpieza para las 6 consultas vacías y las 11 abiertas rancias, a ejecutar una vez y con
  respaldo previo.

### Paso 3 — Cerrar solas las sesiones de días anteriores

- Subir la comprobación de "sesión de otro día" fuera de la rama de la cita, para que valga en las
  cinco puertas de entrada.
- Al cerrarla, dejar constancia (`completedAt` + evento de auditoría) de que la cerró el sistema y no
  la nutrióloga, para no ensuciar Finanzas con un cobro que nadie hizo.

### Paso 4 — Saber siempre en qué sesión estás

- Cabecera con fecha y posición: *"Consulta del 28 sep 2026 · sesión 4 de 7 · En curso"*.
- Selector de sesión dentro del expediente, para moverse entre visitas sin salir a Consultas.
- Una consulta `COMPLETED` se abre **en sólo lectura**, con un botón explícito de "Reabrir para
  corregir" que quede registrado en la auditoría.

### Paso 5 — Poder volver a donde lo dejaste

- URL propia: `/pacientes/:id/expediente` y `/pacientes/:id/consultas/:consultaId`, más los slugs que
  faltan (`/consultas`, `/seguimientos`, `/educacion`).
- Leer el paciente y la sesión de la URL al arrancar, para que recargar no pierda nada.
- La migaja de pan deja de decir "Pacientes" cuando estás dentro de un expediente.

### Paso 6 — Datos del paciente que no se retecleen

- Distinguir lo **permanente** (antecedentes familiares, alergias, cirugías, intolerancias) de lo
  **de la visita** (peso, síntomas de hoy, dieta actual).
- Lo permanente pasa a vivir en el paciente; la consulta lo muestra y lo edita, pero no lo duplica.
- Migración que consolide lo ya capturado tomando el valor más reciente de cada paciente.

---

## 5. Orden y riesgo

| Paso | Riesgo | Toca BD | Por qué va aquí |
|---|---|---|---|
| 1 | bajo | no | Es pérdida de datos clínicos en curso; va primero |
| 2 | bajo | limpieza puntual | Frena la generación de basura antes de limpiar |
| 3 | medio | no | Depende de que el 2 ya no cree sesiones sueltas |
| 4 | bajo | no | Sobre todo interfaz |
| 5 | medio | no | Cambia el enrutado de toda la app |
| 6 | **alto** | migración | El más valioso y el más invasivo; al final y con respaldo |

Los pasos 1 a 4 se pueden entregar juntos en esta rama. El 5 conviene aparte porque toca todas las
pantallas. El 6 merece su propia fase con respaldo de la base antes de migrar.
