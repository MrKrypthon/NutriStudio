// Helpers compartidos por el módulo de Finanzas (página, gráfica del dashboard y cierre de consulta).
export const PAYMENT_METHODS = [
  ['CASH', 'Efectivo'],
  ['CARD', 'Tarjeta'],
  ['TRANSFER', 'Transferencia'],
]
export const PAYMENT_METHOD_LABELS = Object.fromEntries(PAYMENT_METHODS)

export const APPOINTMENT_TYPE_FEES = [
  ['INITIAL', 'Primera consulta'],
  ['FOLLOW_UP', 'Seguimiento'],
  ['QUICK_CONTROL', 'Control rápido'],
  ['EMERGENCY', 'Emergencia'],
]

export const EMPTY_FEES = { INITIAL: 0, FOLLOW_UP: 0, QUICK_CONTROL: 0, EMERGENCY: 0 }

// Normaliza la forma guardada en Practice.fees (centavos) a las cuatro claves esperadas.
export const normalizeFees = (fees) => {
  const source = fees && typeof fees === 'object' ? fees : {}
  return Object.fromEntries(APPOINTMENT_TYPE_FEES.map(([key]) => [key, Math.max(0, Math.round(Number(source[key]) || 0))]))
}

export const pesosToCents = (value) => Math.max(0, Math.round((Number(value) || 0) * 100))
export const centsToPesos = (cents) => (Number(cents) || 0) / 100

export const formatMoney = (cents) => ((Number(cents) || 0) / 100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 })
export const formatSignedMoney = (cents) => `${Number(cents) < 0 ? '−' : '+'}${formatMoney(Math.abs(Number(cents) || 0))}`

const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const formatShortDay = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}` }
