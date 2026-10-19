// Interpretación de un estudio frente a su rango de referencia: admite "70-100", "70 a 100",
// "<200" o ">40". Devuelve 'Normal', 'Elevado', 'Bajo' o null si no se puede decidir.
// La usan la captura manual de Bioquímico y el analizador de PDFs de laboratorio.
export function interpretLab(value, range) {
  const v = Number(String(value ?? '').replace(/^[<>]=?\s*/, '').replace(',', '.'))
  if (!Number.isFinite(v) || (v === 0 && String(value).trim() === '')) return null
  const r = String(range || '').trim()
  let m = r.match(/^([<>])=?\s*(-?\d+(?:[.,]\d+)?)/)
  if (m) {
    const bound = Number(m[2].replace(',', '.'))
    return m[1] === '<' ? (v < bound ? 'Normal' : 'Elevado') : (v > bound ? 'Normal' : 'Bajo')
  }
  m = r.match(/(-?\d+(?:[.,]\d+)?)\s*(?:-|–|a )\s*(-?\d+(?:[.,]\d+)?)/i)
  if (m) {
    const min = Number(m[1].replace(',', '.'))
    const max = Number(m[2].replace(',', '.'))
    if (v < min) return 'Bajo'
    if (v > max) return 'Elevado'
    return 'Normal'
  }
  return null
}
