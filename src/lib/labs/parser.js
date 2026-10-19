// Analizador de resultados de laboratorio: convierte el texto de un PDF (leído directo del PDF o
// reconocido por OCR) en estudios estructurados { nombre, valor, unidad, rango, estado }.
//
// No depende de ningún servicio externo: es un conjunto de reglas sobre el texto, renglón por
// renglón. Un reporte de laboratorio casi siempre imprime cada estudio en un renglón con el mismo
// orden —nombre, resultado, unidad y valores de referencia— aunque cambien la tipografía, las
// columnas y los nombres. Por eso el algoritmo es:
//   1. Normalizar el renglón (minúsculas, sin acentos, espacios simples) conservando el original.
//   2. Buscar en él el nombre de un estudio del catálogo (sinónimos, siglas); el más temprano gana
//      y, entre los que empiezan igual, el más largo.
//   3. En lo que sigue al nombre: el primer número es el resultado (sin confundirlo con fechas), lo
//      que viene justo después es la unidad, y un "70 - 100", "< 200" o "hasta 150" es el rango.
//   4. Si el renglón trae el nombre pero no el número, se intenta con el siguiente (hay reportes
//      que imprimen el resultado debajo del nombre).
// El resultado siempre es un borrador: la nutrióloga lo revisa y confirma antes de guardarlo.

import { LAB_CATALOG } from './catalog.js'
import { interpretLab } from './interpret.js'

export const normalizeText = (value) => String(value || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[µμ]/g, 'u')
  .replace(/[‐‑‒–—]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()

// Sinónimos ya normalizados, del más largo al más corto. En el texto, los signos se tratan como
// espacios para que "TGO/AST", "C-HDL" o "Ác. úrico" coincidan con "tgo ast", "c hdl", "ac urico".
const toWords = (value) => normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim()
const SYNONYMS = LAB_CATALOG
  .flatMap((entry) => entry.synonyms.map((synonym) => ({ entry, words: toWords(synonym) })))
  .sort((a, b) => b.words.length - a.words.length)

// Unidades frecuentes en reportes mexicanos (se comparan ya normalizadas).
const UNIT_PATTERN = /^(mg\/dl|g\/dl|mg\/l|g\/l|ng\/ml|ng\/dl|pg\/ml|ug\/dl|mcg\/dl|ug\/l|ug\/ml|uui\/ml|uiu\/ml|ui\/ml|mui\/l|miu\/l|mui\/ml|miu\/ml|ui\/l|u\/l|iu\/l|mmol\/l|mmol\/mol|meq\/l|nmol\/l|pmol\/l|umol\/l|mosm\/kg|%|fl|pg|mm\/h|mm\/hr|mm\/1a hora|seg|s|x ?10\^?3\/ul|x ?10\^?6\/ul|x ?10e3\/ul|x ?10e6\/ul|10\^3\/ul|10\^6\/ul|10\^3\/mm3|10\^6\/mm3|miles\/ul|miles\/mm3|millones\/ul|millones\/mm3|mill\/mm3|cel\/ul|cel\/mm3|\/mm3|\/ul|k\/ul|m\/ul|ratio)(?![a-z0-9])/

const NUMBER = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)'
const DATE_LIKE = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/

// "250,000" son miles; "5,6" es decimal (coma decimal, frecuente en reportes en español).
export function parseNumber(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) return Number(text.replace(/,/g, ''))
  // Un cero a la izquierda ("078", "050") sólo puede ser un decimal sin punto: 0.78, 0.50.
  if (/^0\d+$/.test(text)) return Number(`0.${text.slice(1)}`)
  const value = Number(text.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}
// Valor tal como se guarda en el expediente: número limpio (sin separador de miles, punto decimal).
const formatValue = (value) => (value == null ? '' : String(Math.round(value * 10000) / 10000))

// ¿Es posible este valor para el estudio? Leucocitos, plaquetas y eritrocitos también se reportan
// como cuenta absoluta (por mm³), así que se acepta el intervalo escalado.
function isPlausible(entry, value, absolute) {
  if (!entry.plausible || value == null) return true
  let [lo, hi] = entry.plausible
  if (absolute) [lo, hi] = [0, 50]
  if (value >= lo && value <= hi) return true
  if ((entry.key === 'wbc' || entry.key === 'platelets') && value >= lo * 1000 && value <= hi * 1000) return true
  if (entry.key === 'rbc' && value >= lo * 1e6 && value <= hi * 1e6) return true
  return false
}

const DIVISORS = [1, 10, 100]
function recoverDecimals(entry, parsed, absolute) {
  const warnings = []
  let range = parsed.range || ''
  let min = null
  let max = null
  const pair = range.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/)
  const single = range.match(/^([<>])(\d+(?:\.\d+)?)$/)
  const fixBound = (bound) => {
    const choice = DIVISORS.map((divisor) => bound / divisor).find((candidate) => candidate === 0 || isPlausible(entry, candidate, absolute))
    return choice ?? bound
  }
  if (pair) {
    const [a, b] = [Number(pair[1]), Number(pair[2])]
    // Primero, el mismo divisor para los dos límites ("45-110" → 4.5-11); si ninguno sirve, cada uno.
    const shared = DIVISORS.find((divisor) => [a / divisor, b / divisor].every((bound) => bound === 0 || isPlausible(entry, bound, absolute)))
    ;[min, max] = shared ? [a / shared, b / shared] : [fixBound(a), fixBound(b)]
    if (min > max) [min, max] = [a, b]
    if (min !== a || max !== b) { range = `${formatValue(min)}-${formatValue(max)}`; warnings.push(`El rango venía como «${pair[1]}-${pair[2]}» y se le recuperó el punto decimal. Compáralo con el PDF.`) }
  } else if (single) {
    const bound = Number(single[2])
    const fixed = fixBound(bound)
    if (fixed !== bound) { range = `${single[1]}${formatValue(fixed)}`; warnings.push(`El límite venía como «${single[2]}» y se le recuperó el punto decimal. Compáralo con el PDF.`) }
    ;[min, max] = single[1] === '<' ? [0, fixed] : [fixed, fixed * 10]
  }
  const fitsRange = (candidate) => min == null || (candidate >= min / 5 && candidate <= max * 5)
  let value = parsed.value
  // "4 l" del OCR: la "l" suelta era el dígito 1 (41), no la marca de "bajo".
  if (!isPlausible(entry, value, absolute) && parsed.flagToken === 'l' && Number.isInteger(value) && isPlausible(entry, value * 10 + 1, absolute) && fitsRange(value * 10 + 1)) {
    value = value * 10 + 1
    parsed = { ...parsed, flag: null }
    warnings.push(`El resultado se leyó como «${formatValue(parsed.value)} l»: se tomó como ${formatValue(value)}. Confírmalo en el PDF.`)
  }
  // Sólo se toca un resultado imposible: uno posible pero fuera de rango (triglicéridos 980) es real.
  if (!isPlausible(entry, value, absolute)) {
    const choice = DIVISORS.slice(1).map((divisor) => parsed.value / divisor).find((candidate) => isPlausible(entry, candidate, absolute) && fitsRange(candidate))
    if (choice != null) { value = choice; warnings.push(`El resultado venía como «${formatValue(parsed.value)}» y se le recuperó el punto decimal. Confírmalo en el PDF.`) }
    else warnings.push('El resultado está fuera de lo físicamente posible para este estudio: revísalo en el PDF.')
  }
  return { value, range, warnings, flag: parsed.flag }
}

// Distancia de edición (Levenshtein) acotada, para nombres que el OCR leyó con una o dos letras mal.
function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      rowMin = Math.min(rowMin, current[j])
    }
    if (rowMin > limit) return limit + 1
    previous = current
  }
  return previous[b.length]
}

// Búsqueda aproximada al inicio del renglón: sólo sinónimos de 6 letras o más, con una letra de
// diferencia (dos si el nombre es largo). Así "Crealinina" es Creatinina y "Tíglicérios", Triglicéridos.
function findApproximate(words) {
  const tokens = words.split(' ')
  let best = null
  for (const synonym of SYNONYMS) {
    if (synonym.words.length < 6) continue
    const count = synonym.words.split(' ').length
    if (tokens.length < count + 1) continue
    const candidate = tokens.slice(0, count).join(' ')
    const limit = synonym.words.length >= 9 ? 2 : 1
    const distance = editDistance(candidate, synonym.words, limit)
    if (distance > limit || distance === 0) continue
    if (!best || distance < best.distance || (distance === best.distance && synonym.words.length > best.synonym.words.length)) best = { synonym, start: 0, end: candidate.length, distance, approximate: candidate }
  }
  return best
}

// Busca el estudio en un renglón ya pasado a palabras. Devuelve el sinónimo y dónde termina.
function findAnalyte(words) {
  let best = null
  for (const synonym of SYNONYMS) {
    const pattern = new RegExp(`(^| )${synonym.words.replace(/ /g, ' ')}( |$)`)
    const match = pattern.exec(words)
    if (!match) continue
    const start = match.index + match[1].length
    // Las siglas de 1 a 3 letras ("k", "na", "hb", "tg") sólo cuentan al principio del renglón:
    // en medio del texto casi siempre son otra cosa ("vitamina K", "x10^3/uL", notas).
    if (synonym.words.length <= 3 && start > 0) continue
    // El nombre debe estar en la primera mitad del renglón: si aparece al final, suele ser una
    // nota ("…en ayuno de 8 horas para glucosa").
    if (start > Math.max(24, words.length * 0.55)) continue
    if (!best || start < best.start || (start === best.start && synonym.words.length > best.synonym.words.length)) best = { synonym, start, end: start + synonym.words.length }
  }
  return best
}

// Rango de referencia en un texto: "70 - 100", "70 a 100", "< 200", "menor a 200", "hasta 150",
// "> 40", "mayor de 40". Devuelve el texto normalizado ("70-100", "<200", ">40") o null.
export function parseRange(text) {
  const t = normalizeText(text).replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
  let match = t.match(new RegExp(`${NUMBER}\\s*(?:-|a|al|–)\\s*${NUMBER}`))
  if (match) return `${formatValue(parseNumber(match[1]))}-${formatValue(parseNumber(match[2]))}`
  match = t.match(new RegExp(`(<=?|≤|menor (?:a|de|que)|inferior a|hasta|max(?:imo)?\\.?)\\s*${NUMBER}`))
  if (match) return `<${formatValue(parseNumber(match[2]))}`
  match = t.match(new RegExp(`(>=?|≥|mayor (?:a|de|que)|superior a|min(?:imo)?\\.?)\\s*${NUMBER}`))
  if (match) return `>${formatValue(parseNumber(match[2]))}`
  return null
}

// Lo que sigue al nombre del estudio: resultado, unidad, marca (alto/bajo) y rango.
// Confusiones típicas del OCR pegadas a un número: "4l" o "l5" son 41 y 15, "1O5" es 105.
const fixOcrDigits = (text) => text
  .replace(/(\d)[o](?=\d|\s|$|[.,])/g, '$10')
  .replace(/(\d)[li|](?=\d|\s|$|[.,])/g, '$11')
  .replace(/(^|\s)[li|](?=\d)/g, '$11')

function parseTail(tailOriginal) {
  const tail = fixOcrDigits(normalizeText(tailOriginal))
  const numberRe = new RegExp(`([<>]=?)?\\s*${NUMBER}`, 'g')
  let match
  while ((match = numberRe.exec(tail))) {
    const from = match.index
    // Saltar fechas (12/05/2026) y horas (08:30), y números pegados a letras (p. ej. "b12").
    if (DATE_LIKE.test(tail.slice(from).replace(/^[<>]=?\s*/, ''))) { numberRe.lastIndex = from + 10; continue }
    if (/^\d{1,2}:\d{2}/.test(tail.slice(from))) continue
    if (from > 0 && /[a-z]/.test(tail[from - 1])) continue
    const value = parseNumber(match[2])
    if (value == null) continue
    const comparator = match[1] || ''
    let rest = tail.slice(numberRe.lastIndex).trim()
    let flag = null
    const flagMatch = rest.match(/^(\*+|h|l|alto|bajo|elevado|a|b)(?![a-z0-9])\s*/)
    const flagToken = flagMatch ? flagMatch[1] : null
    if (flagMatch) { flag = /^(\*|h|alto|elevado|a)/.test(flagMatch[1]) ? 'Elevado' : 'Bajo'; rest = rest.slice(flagMatch[0].length) }
    // La unidad puede venir entre paréntesis: "96 (mg/dl)".
    const unitMatch = rest.replace(/^\(\s*/, '').match(UNIT_PATTERN)
    let unit = ''
    if (unitMatch) { unit = unitMatch[1]; rest = rest.replace(/^\(\s*/, '').slice(unitMatch[0].length).replace(/^\s*\)/, '').trim() }
    if (!flag) {
      const afterUnit = rest.match(/^(\*+|h|l|alto|bajo)(?![a-z0-9])\s*/)
      if (afterUnit) { flag = /^(\*|h|alto)/.test(afterUnit[1]) ? 'Elevado' : 'Bajo'; rest = rest.slice(afterUnit[0].length) }
    }
    return { value, comparator, unit, range: parseRange(rest), flag, flagToken }
  }
  return null
}

// Unidad legible para el expediente (la comparación se hace en minúsculas sin "µ").
const UNIT_DISPLAY = { 'mg/dl': 'mg/dL', 'g/dl': 'g/dL', 'ng/ml': 'ng/mL', 'ng/dl': 'ng/dL', 'pg/ml': 'pg/mL', 'ug/dl': 'µg/dL', 'mcg/dl': 'µg/dL', 'ug/l': 'µg/L', 'ug/ml': 'µg/mL', 'uui/ml': 'µUI/mL', 'uiu/ml': 'µUI/mL', 'ui/ml': 'UI/mL', 'mui/l': 'mUI/L', 'miu/l': 'mUI/L', 'mui/ml': 'mUI/mL', 'miu/ml': 'mUI/mL', 'ui/l': 'UI/L', 'u/l': 'U/L', 'iu/l': 'UI/L', 'mmol/l': 'mmol/L', 'mmol/mol': 'mmol/mol', 'meq/l': 'mEq/L', 'nmol/l': 'nmol/L', 'pmol/l': 'pmol/L', 'umol/l': 'µmol/L', fl: 'fL', 'mm/h': 'mm/h', 'mm/hr': 'mm/h', 'mg/l': 'mg/L', 'g/l': 'g/L' }
const displayUnit = (unit) => {
  if (!unit) return ''
  if (UNIT_DISPLAY[unit]) return UNIT_DISPLAY[unit]
  if (/10\^?e?3|miles|k\/ul/.test(unit)) return 'miles/µL'
  if (/10\^?e?6|millones|mill|m\/ul/.test(unit)) return 'millones/µL'
  return unit.replace(/ul/g, 'µL')
}

// Fecha del estudio: "Fecha de toma: 12/05/2026", "Fecha de muestra 2026-05-12"…
function findStudyDate(lines) {
  for (const line of lines) {
    const n = normalizeText(line)
    const match = n.match(/fecha(?: y hora)? de (?:toma|muestra|recepcion|registro|emision|impresion|resultado)s?[^0-9]{0,6}(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/) || n.match(/fecha(?: y hora)? de (?:toma|muestra|recepcion|registro|emision|impresion|resultado)s?[^0-9]{0,6}(\d{4})-(\d{2})-(\d{2})/)
    if (!match) continue
    let [, a, b, c] = match
    if (a.length === 4) [a, c] = [c, a]
    const year = c.length === 2 ? `20${c}` : c
    return `${year}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`
  }
  return null
}

/**
 * Analiza el texto de un reporte. `input` puede ser un texto con saltos de línea o una lista de
 * renglones. Devuelve { items, studyDate, unmatched } donde cada item es
 * { key, name, group, value, unit, range, status, flag, line }.
 */
export function parseLabReport(input) {
  const lines = (Array.isArray(input) ? input : String(input || '').split(/\r?\n/)).map((line) => String(line || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  const items = []
  const seen = new Set()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const words = toWords(line)
    if (!words || words.length > 220) continue
    const found = findAnalyte(words) || findApproximate(words)
    if (!found) continue
    const { entry } = found.synonym
    // Cortar el renglón original donde termina el nombre: se avanza palabra por palabra en el
    // original hasta cubrir las palabras del sinónimo.
    const tailOriginal = sliceAfterWords(line, found.end)
    let parsed = parseTail(tailOriginal)
    let usedLine = line
    // Resultado en el renglón de abajo (y ese renglón no es otro estudio).
    if (!parsed && lines[i + 1] && !findAnalyte(toWords(lines[i + 1])) && /^[<>]?\s*\d/.test(normalizeText(lines[i + 1]))) {
      parsed = parseTail(lines[i + 1])
      if (parsed) { usedLine = `${line} ${lines[i + 1]}`; i += 1 }
    }
    if (!parsed) continue
    // Porcentaje y absoluto de la fórmula blanca son dos estudios ("Neutrófilos %" y "Neutrófilos #").
    const isPercentVariant = entry.group === 'Biometría hemática' && ['neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils'].includes(entry.key)
    const absolute = isPercentVariant && parsed.unit && parsed.unit !== '%'
    const key = absolute ? `${entry.key}Abs` : entry.key
    if (seen.has(key)) continue
    seen.add(key)
    let unit = displayUnit(parsed.unit) || (absolute ? 'miles/µL' : entry.unit)
    // Leucocitos o plaquetas como cuenta absoluta (250000) van "por mm³", no en miles.
    if ((entry.key === 'wbc' || entry.key === 'platelets') && parsed.value >= 1000) unit = '/mm³'
    const warnings = [...(found.approximate ? [`Nombre reconocido de forma aproximada («${found.approximate}»): confirma que sea ${entry.name}.`] : [])]
    // Punto decimal perdido (frecuente en OCR de escaneos de baja calidad: "31.2" → "312",
    // "2.4 - 5.7" → "24 - 57"): cada número se lleva al primero de valor, valor/10 o valor/100 que
    // sea físicamente posible para ese estudio y coherente con su rango. Se avisa siempre.
    const recovered = recoverDecimals(entry, parsed, absolute)
    parsed.flag = recovered.flag
    const value = `${parsed.comparator}${formatValue(recovered.value)}`
    const range = recovered.range
    warnings.push(...recovered.warnings)
    let status = (range && !parsed.comparator ? interpretLab(value, range) : null)
    // La marca del laboratorio (*, H, L) manda si contradice la interpretación por rango.
    if (parsed.flag && status && status !== 'Normal' && status !== parsed.flag) { warnings.push(`El laboratorio lo marca como ${parsed.flag.toLowerCase()}, pero el rango leído dice ${status.toLowerCase()}. Revísalo.`); status = parsed.flag }
    if (parsed.flag && status === 'Normal') { warnings.push(`El laboratorio lo marca como ${parsed.flag.toLowerCase()} aunque el valor cae en el rango leído. Revísalo.`); status = parsed.flag }
    items.push({
      key,
      name: absolute ? `${entry.name} (absolutos)` : entry.name,
      group: entry.group,
      value,
      unit,
      range,
      flag: parsed.flag,
      status: status || parsed.flag || (range ? 'Normal' : 'Pendiente'),
      warnings,
      line: usedLine,
    })
  }
  return { items, studyDate: findStudyDate(lines), lineCount: lines.length }
}

// Parte del renglón original que sigue a las primeras `wordChars` letras/dígitos normalizados.
function sliceAfterWords(original, endInWords) {
  let consumed = 0
  const normalized = toWords(original)
  const target = normalized.slice(0, endInWords).replace(/ /g, '').length
  for (let i = 0; i < original.length; i++) {
    const char = normalizeText(original[i]).replace(/[^a-z0-9]/g, '')
    consumed += char.length
    if (consumed >= target) return original.slice(i + 1)
  }
  return ''
}

/**
 * Completa una lectura con otra (dos pasadas de OCR con distinta preparación de la imagen): un
 * estudio que en la principal quedó con un valor imposible toma el de la alternativa si ahí es
 * posible, y los que sólo aparecieron en la alternativa se agregan. Todo lo tomado se avisa.
 */
export function mergeAlternative(primary, alternative) {
  if (!alternative?.items?.length) return primary
  const impossible = (item) => item.warnings.some((warning) => warning.includes('físicamente posible'))
  const altByKey = new Map(alternative.items.map((item) => [item.key, item]))
  const items = primary.items.map((item) => {
    const alt = altByKey.get(item.key)
    if (!impossible(item) || !alt || impossible(alt)) return item
    return { ...alt, warnings: [...alt.warnings, `La primera lectura del OCR dio «${item.value}»; se tomó «${alt.value}» de una segunda lectura. Confírmalo en el PDF.`] }
  })
  const keys = new Set(items.map((item) => item.key))
  for (const alt of alternative.items) if (!keys.has(alt.key) && !impossible(alt)) items.push({ ...alt, warnings: [...alt.warnings, 'Sólo apareció en la segunda lectura del OCR: confírmalo en el PDF.'] })
  return { ...primary, items }
}
