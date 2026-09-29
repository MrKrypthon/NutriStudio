/**
 * Reglas de sesión de la consulta.
 *
 * Están aquí y no dentro de la pantalla porque de ellas depende que una visita quede registrada en
 * el día correcto: si "hoy" se calculara mal, una sesión abierta esta mañana se cerraría sola y la
 * captura se partiría en dos consultas, o al revés, la visita de hoy se guardaría dentro de la de
 * ayer.
 */

/** Día natural de una fecha en el calendario local (el día de trabajo de la nutrióloga). */
export function localDay(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * ¿La fecha cae en el día de trabajo de hoy?
 *
 * Se compara contra el calendario **local** y no contra UTC a propósito: en México (UTC-6) una
 * consulta iniciada a las 19:00 ya es del día siguiente en UTC, así que comparar en UTC la daría
 * por "de otro día" a la mañana siguiente y la cerraría sola en mitad del trabajo.
 */
export function isToday(value, now = new Date()) {
  const day = localDay(value)
  return !!day && day === localDay(now)
}

/**
 * ¿Hay que cerrar sola esta sesión antes de abrir el expediente?
 *
 * Sólo las que siguen en curso y son de un día anterior. Una consulta ya cerrada no se toca, y una
 * de hoy es justamente la que se quiere seguir trabajando.
 */
export function shouldAutoClose(consultation, now = new Date()) {
  if (!consultation || consultation.status !== 'IN_PROGRESS') return false
  return !isToday(consultation.startedAt || consultation.createdAt, now)
}
