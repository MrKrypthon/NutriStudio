// ¿La sección de la consulta ya tiene algo capturado? Aplicar una plantilla clínica sólo precarga las
// secciones vacías: el autoguardado deja secciones con campos en blanco ({ peso: '' }), que cuentan
// como vacías; cualquier texto, número o casilla marcada cuenta como trabajo que no se debe pisar.
export function hasSectionContent(payload) {
  if (payload == null) return false
  if (typeof payload === 'string') return payload.trim() !== ''
  if (typeof payload === 'number') return Number.isFinite(payload)
  if (typeof payload === 'boolean') return payload
  if (Array.isArray(payload)) return payload.some(hasSectionContent)
  if (typeof payload === 'object') return Object.values(payload).some(hasSectionContent)
  return false
}
