/**
 * Qué datos son del **paciente** y cuáles son de **la visita**.
 *
 * Hasta ahora todo vivía dentro de la consulta, así que los antecedentes familiares, las cirugías o
 * las alergias había que recapturarlos en cada sesión o quedaban enterrados en la consulta donde se
 * escribieron la primera vez. Estos campos pasan a guardarse una vez por paciente y se muestran en
 * todas sus consultas.
 *
 * El criterio para mover un campo aquí es que su respuesta **no cambie porque haya pasado una
 * visita**: una cirugía ya realizada sigue realizada, un antecedente familiar sigue ahí. Lo que
 * cambia de una consulta a otra —medicamentos, síntomas, exploración física, consumo de alcohol—
 * se queda en la consulta, porque ahí su valor es el de ese día y tiene sentido compararlo con el
 * de la visita anterior.
 */

// Parentescos de la tabla de antecedentes familiares; deben coincidir con los de la pantalla.
export const FAMILY_RELATIVES = ['Mamá/Papá', 'Abuelos', 'Tíos']
const FAMILY_SUFFIXES = [...FAMILY_RELATIVES, 'Ninguno']

const PATIENT_LEVEL = {
  clinical: new Set([
    'Padecimientos familiares agregados',
    'Enfermedades actuales o previas',
    'Cirugías realizadas',
    'Alergias alimentarias',
    'Intolerancias',
  ]),
  sociocultural: new Set([
    'Restricciones religiosas o culturales',
  ]),
}

/**
 * ¿Es una casilla de la tabla de antecedentes familiares (`Diabetes__Abuelos`, `Obesidad__Ninguno`)
 * o la lista de padecimientos agregados a mano?
 *
 * La tabla se trata como un bloque y no campo a campo: sus casillas sin marcar valen `false`, que es
 * indistinguible de "nunca se tocó", así que consolidarlas por separado haría que un "no" reciente
 * perdiera frente a un "sí" de hace un año.
 */
export function isFamilyHistoryField(sectionKey, key) {
  if (sectionKey !== 'clinical') return false
  return key === 'Padecimientos familiares agregados' || isFamilyHistoryKey(key)
}

function isFamilyHistoryKey(key) {
  const index = key.lastIndexOf('__')
  return index > 0 && FAMILY_SUFFIXES.includes(key.slice(index + 2))
}

/** ¿Este campo pertenece al paciente en vez de a la consulta? */
export function isPatientLevel(sectionKey, fieldKey) {
  if (sectionKey === 'clinical' && isFamilyHistoryKey(fieldKey)) return true
  return !!PATIENT_LEVEL[sectionKey]?.has(fieldKey)
}

/** ¿Alguno de los campos de esta sección es del paciente? Evita trabajo en las secciones que no. */
export function hasPatientLevelFields(sectionKey) {
  return sectionKey === 'clinical' || sectionKey === 'sociocultural'
}

/**
 * Separa un conjunto de cambios en los que van al paciente y los que van a la consulta.
 * Devuelve `{ patient, consultation }`, cada uno con sólo las claves que le tocan.
 */
export function splitUpdates(sectionKey, updates) {
  const patient = {}
  const consultation = {}
  for (const [key, value] of Object.entries(updates)) {
    if (isPatientLevel(sectionKey, key)) patient[key] = value
    else consultation[key] = value
  }
  return { patient, consultation }
}

/**
 * Valores que se muestran en la sección: los de la consulta con los del paciente encima.
 *
 * El del paciente gana porque es el dato vigente; si una consulta antigua guardó una versión previa
 * del mismo campo, lo que debe verse es la actual, que es justamente lo que se quería lograr.
 */
export function mergeValues(sectionKey, consultationPayload = {}, patientPayload = {}) {
  if (!hasPatientLevelFields(sectionKey)) return consultationPayload
  const merged = { ...consultationPayload }
  for (const [key, value] of Object.entries(patientPayload)) merged[key] = value
  return merged
}
