// Shared helpers to auto-link the imported recipe book's free-text ingredients to the catalog.
// Used first in analysis mode (prisma/tools/link-smae.js) and then to write the links.

export const WEIGHT_UNITS = {
  g: 1, gr: 1, gramo: 1, gramos: 1, kg: 1000, kilo: 1000, kilos: 1000, mg: 0.001,
}

// Volume in ml per unit, for converting between volume units when the catalog serving gives grams.
export const VOLUME_ML = {
  ml: 1, mililitro: 1, mililitros: 1, cc: 1, l: 1000, litro: 1000, litros: 1000,
  taza: 240, tazas: 240, vaso: 240, vasos: 240,
  cda: 15, cucharada: 15, cucharadas: 15,
  cdita: 5, cucharadita: 5, cucharaditas: 5,
}

// Fallback grams per "count" unit when the catalog serving can't tell us.
export const COUNT_GRAMS = {
  pieza: 100, piezas: 100, pz: 100, pza: 100, unidad: 100, unidades: 100,
  huevo: 44, huevos: 44, rebanada: 25, rebanadas: 25, reb: 25,
  rodaja: 15, rodajas: 15, tira: 15, tiras: 15, diente: 5, dientes: 5,
  hoja: 5, hojas: 5, rama: 3, ramas: 3, raja: 3, rajas: 3, sobre: 7, sobres: 7,
  pizca: 0.5, punado: 30, puñado: 30, puño: 30, bolsita: 20, paquete: 20, paquetes: 20,
}

export const UNIT_WORDS = new Set([...Object.keys(WEIGHT_UNITS), ...Object.keys(VOLUME_ML), ...Object.keys(COUNT_GRAMS)])

const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'en', 'con', 'sin', 'al', 'a', 'y', 'o', 'u',
  'para', 'por', 'aprox', 'aproximadamente', 'mas', 'menos', 'muy', 'bien', 'tipo', 'tamano', 'marca',
  'picado', 'picada', 'picados', 'picadas', 'molido', 'molida', 'rallado', 'rallada', 'rebanado',
  'crudo', 'cruda', 'crudos', 'crudas', 'fresco', 'fresca', 'frescos', 'frescas', 'entero', 'entera', 'enteros', 'enteras',
  'cocido', 'cocida', 'cocidos', 'cocidas', 'asado', 'asada', 'horneado', 'horneada', 'natural', 'naturales', 'light',
  'grande', 'grandes', 'chico', 'chica', 'chicos', 'chicas', 'mediano', 'mediana', 'maduro', 'madura', 'maduros', 'maduras',
  'opcional', 'gusto', 'poco', 'poquito', 'cantidad', 'necesaria', 'linea', 'lineas', 'finas', 'finamente',
  'puede', 'puedes', 'usar', 'usarse', 'elige', 'elegir', 'prefiere', 'sabor', 'color', 'parte', 'partes',
])

export const normalize = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[()[\],.;:]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// A numeric amount: "1", "1/2", "1 1/2", "2.5", "2,5". Returns { value, length } for the first match.
export const parseAmount = (text) => {
  const mixed = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/)
  if (mixed) return { value: Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]), length: mixed[0].length }
  const fraction = text.match(/^(\d+)\s*\/\s*(\d+)/)
  if (fraction) return { value: Number(fraction[1]) / Number(fraction[2]), length: fraction[0].length }
  const decimal = text.match(/^(\d+(?:[.,]\d+)?)/)
  if (decimal) return { value: Number(decimal[1].replace(',', '.')), length: decimal[0].length }
  return null
}

// Splits a free-text line into { qty, unit, name }. Handles "2-3 cucharadas", "1/2 taza",
// "Jugo de 1/2 limón", "3 huevos grandes", "1 pizca de sal". qty/unit are null when absent.
export const parseLine = (line) => {
  let text = normalize(line)
  if (!text) return null
  // Drop notes: parentheticals and *asterisk* asides ("*Versión vegana: sustituir pollo…*") are
  // instructions, not the ingredient, and otherwise leak words like "vegana" into matching.
  text = text.replace(/\*[^*]*\*/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
  let qty = null
  let unit = null
  let rest = text
  const rangeMatch = text.match(/(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)/)
  if (rangeMatch) {
    qty = (Number(rangeMatch[1].replace(',', '.')) + Number(rangeMatch[2].replace(',', '.'))) / 2
    rest = (text.slice(0, rangeMatch.index) + ' ' + text.slice(rangeMatch.index + rangeMatch[0].length)).trim()
  } else {
    for (let i = 0; i < text.length; i += 1) {
      if (i > 0 && /[a-z0-9]/.test(text[i - 1])) continue
      const amount = parseAmount(text.slice(i))
      if (!amount) continue
      qty = amount.value
      rest = (text.slice(0, i) + ' ' + text.slice(i + amount.length)).trim()
      // The unit is the token right after the amount only when it isn't a food word.
      const next = text.slice(i + amount.length).trim().split(' ')[0] || ''
      if (UNIT_WORDS.has(next)) unit = next
      break
    }
  }
  let nameSource = rest
  if (unit) {
    nameSource = rest.replace(new RegExp(`(^| )${unit}( |$)`), ' ').replace(/\s+/g, ' ').trim()
  }
  const name = nameSource.split(' ').filter((token) => token && !STOPWORDS.has(token) && !UNIT_WORDS.has(token)).join(' ')
  return { qty, unit, name: name || nameSource, raw: line }
}

export const tokensOf = (value) => normalize(value).split(' ').filter((token) => token.length > 2 && !STOPWORDS.has(token) && !UNIT_WORDS.has(token))

// Spanish plurals are irregular enough ("jitomates" → "jitomate" keeps the -e, "nopales" → "nopal"
// drops -es) that a single rule fails. Return every plausible singular so the matcher can treat
// two tokens as equal when their variant sets intersect.
export const variants = (token) => {
  const list = new Set([token])
  if (token.length > 4 && token.endsWith('es')) list.add(token.slice(0, -2))
  if (token.length > 3 && token.endsWith('s')) list.add(token.slice(0, -1))
  return list
}

