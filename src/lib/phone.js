/**
 * Formato del teléfono en la app: 10 dígitos agrupados 3-3-4, separados por espacio (México).
 *
 * `formatPhone` es idempotente: recibe lo que la persona va tecleando —o un valor ya formateado, o
 * una cadena con paréntesis/guiones/espacios pegada desde otro lado— y devuelve sólo dígitos, con
 * tope de 10, reagrupados. Eso permite llamarlo en cada `onChange` sin acumular separadores, y
 * también normalizar valores viejos guardados con otro formato.
 */
export function formatPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 10)
  const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean)
  return groups.join(' ')
}
