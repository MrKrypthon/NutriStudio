// Interpretación de un estudio frente a su rango de referencia: admite "70-100", "70 a 100",
// "<200" o ">40". Devuelve 'Normal', 'Elevado', 'Bajo' o null si no se puede decidir.
// La usan la captura manual de Bioquímico y el analizador de PDFs de laboratorio.
// "250,000" son miles (plaquetas, leucocitos por mm³); "5,6" es coma decimal. Antes toda coma se
// leía como decimal: 250,000 contra un rango 150000-450000 salía "Bajo".
const toNumber = (text) => Number(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.'))

export function interpretLab(value, range) {
  const v = toNumber(String(value ?? '').trim().replace(/^[<>]=?\s*/, ''))
  if (!Number.isFinite(v) || (v === 0 && String(value).trim() === '')) return null
  const r = String(range || '').trim()
  let m = r.match(/^([<>])=?\s*(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:[.,]\d+)?)/)
  if (m) {
    const bound = toNumber(m[2])
    return m[1] === '<' ? (v < bound ? 'Normal' : 'Elevado') : (v > bound ? 'Normal' : 'Bajo')
  }
  m = r.match(/(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:[.,]\d+)?)\s*(?:-|–|a )\s*(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:[.,]\d+)?)/i)
  if (m) {
    const min = toNumber(m[1])
    const max = toNumber(m[2])
    if (v < min) return 'Bajo'
    if (v > max) return 'Elevado'
    return 'Normal'
  }
  return null
}
