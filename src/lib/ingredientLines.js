// Cantidades escritas en texto libre ("1/2 taza de avena"): formato y escalado. Lo usan la vista de
// Recetas (porciones a servir) y el ajuste de porciones por plan en el Constructor.

// Fracciones con las que se mide en la cocina. Una cantidad escalada se lleva a la más cercana:
// nadie puede medir "0.4 huevo" ni "1.9 tortillas".
const KITCHEN_FRACTIONS = [[0, ''], [1 / 4, '1/4'], [1 / 3, '1/3'], [1 / 2, '1/2'], [2 / 3, '2/3'], [3 / 4, '3/4'], [1, '']]

// Cantidad lista para leerse en una receta: en fracciones de cocina ("1 1/2") hasta 10, en enteros
// de 10 en adelante y de 5 en 5 desde 100 (gramos, mililitros). Nunca baja a cero: lo mínimo es 1/4.
export const formatQuantity = (value) => {
  if (!Number.isFinite(value) || value <= 0) return ''
  if (value >= 100) return String(Math.round(value / 5) * 5)
  if (value >= 10) return String(Math.round(value))
  const whole = Math.floor(value)
  const remainder = value - whole
  const [fraction, label] = KITCHEN_FRACTIONS.reduce((best, candidate) => (Math.abs(remainder - candidate[0]) < Math.abs(remainder - best[0]) ? candidate : best))
  const units = whole + (fraction === 1 ? 1 : 0)
  if (!units && !label) return '1/4'
  return [units || '', label].filter(Boolean).join(' ')
}

// Valor de una cantidad ya formateada ("1 1/2" → 1.5): la concordancia se decide con lo que se lee.
const quantityValue = (text) => String(text).split(' ').reduce((sum, part) => { const [top, bottom] = part.split('/'); return sum + (bottom ? Number(top) / Number(bottom) : Number(top)) }, 0)

const VULGAR_FRACTIONS = { '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3 }

// Unidades y piezas que cambian de número con la cantidad ("1 taza" / "2 tazas"). Sólo las de esta
// lista se ajustan: adivinar el plural de cualquier palabra rompería más de lo que arregla.
const COUNT_NOUNS = [['taza', 'tazas'], ['cucharada', 'cucharadas'], ['cucharadita', 'cucharaditas'], ['pieza', 'piezas'], ['rebanada', 'rebanadas'], ['huevo', 'huevos'], ['clara', 'claras'], ['tortilla', 'tortillas'], ['diente', 'dientes'], ['pechuga', 'pechugas'], ['muslo', 'muslos'], ['filete', 'filetes'], ['bistec', 'bisteces'], ['lata', 'latas'], ['manojo', 'manojos'], ['puño', 'puños'], ['pizca', 'pizcas'], ['sobre', 'sobres'], ['hoja', 'hojas'], ['rama', 'ramas'], ['vaso', 'vasos'], ['plátano', 'plátanos'], ['jitomate', 'jitomates'], ['tomate', 'tomates'], ['papa', 'papas'], ['zanahoria', 'zanahorias'], ['calabacita', 'calabacitas'], ['chile', 'chiles'], ['cebolla', 'cebollas'], ['manzana', 'manzanas'], ['nopal', 'nopales'], ['pan', 'panes'], ['galleta', 'galletas']]
const SINGULAR = new Map(COUNT_NOUNS.map(([one, many]) => [many, one]))
const PLURAL = new Map(COUNT_NOUNS)

// Concuerda la palabra que sigue a la cantidad: singular hasta 1 ("1 huevo", "1/2 taza"), plural
// de ahí en adelante ("1 1/2 tazas"). `rest` es el renglón sin la cantidad.
const agreeNoun = (amount, rest) => rest.replace(/^(\s*(?:de\s+)?)([a-záéíóúñ]+)/i, (whole, lead, word) => {
  const lower = word.toLowerCase()
  const next = amount <= 1 ? SINGULAR.get(lower) : PLURAL.get(lower)
  if (!next) return whole
  return lead + (word[0] === word[0].toUpperCase() ? next[0].toUpperCase() + next.slice(1) : next)
})

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
  // "½ taza", "1½ pieza": fracciones tipográficas, solas o pegadas a un entero.
  const vulgar = line.match(/^(\d+)?\s?([¼½¾⅓⅔])/)
  if (vulgar) {
    const amount = ((Number(vulgar[1]) || 0) + VULGAR_FRACTIONS[vulgar[2]]) * factor
    const scaled = formatQuantity(amount)
    return scaled ? `${scaled}${agreeNoun(quantityValue(scaled), line.slice(vulgar[0].length))}` : line
  }
  const match = line.match(/^(\d+)\s+(\d+)\/(\d+)\b|^(\d+)\/(\d+)\b|^(\d+(?:[.,]\d+)?)(?![\d/])/)
  if (!match) return line
  let amount
  let consumed
  if (match[1]) { amount = Number(match[1]) + Number(match[2]) / Number(match[3]); consumed = match[0].length }
  else if (match[4]) { amount = Number(match[4]) / Number(match[5]); consumed = match[0].length }
  else { amount = Number(match[6].replace(',', '.')); consumed = match[6].length }
  const scaled = formatQuantity(amount * factor)
  if (!scaled) return line
  return `${scaled}${agreeNoun(quantityValue(scaled), line.slice(consumed))}`
}
