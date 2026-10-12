// Cantidades escritas en texto libre ("1/2 taza de avena"): formato y escalado. Lo usan la vista de
// Recetas (porciones a servir) y el ajuste de porciones por plan en el Constructor.
const round1 = (value) => Math.round(value * 10) / 10

// Best-effort fraction formatting so scaling "1/2 taza" by 3 reads "1 1/2 taza", not "1.5 taza".
export const formatQuantity = (value) => {
  if (!Number.isFinite(value) || value <= 0) return ''
  const whole = Math.floor(value)
  const remainder = value - whole
  const fraction = [[1 / 2, '1/2'], [1 / 3, '1/3'], [2 / 3, '2/3'], [1 / 4, '1/4'], [3 / 4, '3/4']]
    .find(([candidate]) => Math.abs(remainder - candidate) < 0.04)
  if (fraction) return [whole > 0 ? whole : '', fraction[1]].filter(Boolean).join(' ')
  return String(round1(value)).replace(/\.0$/, '')
}

// Scales the leading amount of a free-text ingredient line ("2 tazas de avena" -> "3 tazas de
// avena") without touching the rest. Unparseable lines ("al gusto") pass through unchanged.
export const scaleIngredientLine = (line, factor) => {
  if (factor === 1) return line
  // Ranges like "2-3 cucharadas" are common and must scale on both ends.
  const range = line.match(/^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\b/)
  if (range) {
    const low = Number(range[1].replace(',', '.')) * factor
    const high = Number(range[2].replace(',', '.')) * factor
    return `${formatQuantity(low)}-${formatQuantity(high)}${line.slice(range[0].length)}`
  }
  const match = line.match(/^(\d+)\s+(\d+)\/(\d+)\b|^(\d+)\/(\d+)\b|^(\d+(?:[.,]\d+)?)\b/)
  if (!match) return line
  let amount
  let consumed
  if (match[1]) { amount = Number(match[1]) + Number(match[2]) / Number(match[3]); consumed = match[0].length }
  else if (match[4]) { amount = Number(match[4]) / Number(match[5]); consumed = match[0].length }
  else { amount = Number(match[6].replace(',', '.')); consumed = match[6].length }
  const scaled = formatQuantity(amount * factor)
  if (!scaled) return line
  return `${scaled}${line.slice(consumed)}`
}
