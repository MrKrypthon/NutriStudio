/**
 * Sexo del paciente en la app: dos opciones, **Hombre** y **Mujer**.
 *
 * El valor que se guarda es el de esas opciones ('Hombre'/'Mujer'), pero como hay datos e
 * integraciones con otros formatos ('Femenino'/'Masculino', 'female'/'male', 'F'/'M'), toda la
 * detección pasa por `normalizeSex`: cualquier variante se resuelve a 'Hombre' o 'Mujer', y lo que
 * no se reconoce devuelve `null`. Así los cálculos que dependen del sexo (antropometría,
 * recordatorio de 24 h, requerimiento energético) no se rompen si el dato viene en otro formato.
 *
 * Ojo con el detalle que motivó este módulo: 'Mujer' empieza con 'm' y 'Hombre' con 'h', así que la
 * vieja heurística `startsWith('m')` para "hombre" clasificaba a una Mujer como Hombre y a un
 * Hombre como Mujer. Aquí la comparación es por prefijo real, no por la primera letra.
 */
export const SEX_OPTIONS = ['Hombre', 'Mujer']

export function normalizeSex(value) {
  const key = String(value ?? '').trim().toLowerCase()
  if (!key) return null
  if (key.startsWith('homb') || key.startsWith('masc') || key === 'male' || key === 'm') return 'Hombre'
  if (key.startsWith('muj') || key.startsWith('fem') || key === 'female' || key === 'f') return 'Mujer'
  return null
}

export const isMaleSex = (value) => normalizeSex(value) === 'Hombre'
export const isFemaleSex = (value) => normalizeSex(value) === 'Mujer'

/** Etiqueta para mostrar: 'Hombre'/'Mujer' si se reconoce el valor; el valor tal cual si no. */
export function sexLabel(value) {
  return normalizeSex(value) || (value ? String(value) : '')
}
