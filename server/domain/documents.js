import { mealBadgePortions } from './equivalents.js'
import { PLAN_MEALS, PLAN_MEAL_KEYS, formatMealTime, normalizeMealTimes } from './planMeals.js'

// Nombre de cada tiempo de comida en el plan entregado (todas las colaciones son "Colación" y se
// distinguen por su hora, como en el formato en papel) y su orden en el día.
const MEAL_TYPE_LABELS = Object.fromEntries(PLAN_MEALS.map((meal) => [meal.key, meal.printLabel]))
const MEAL_TYPE_ORDER = PLAN_MEAL_KEYS

const DAY_LABELS = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
}

// Grupos de equivalentes que el plan impreso muestra como "porciones" (los círculos de color junto
// a cada tiempo de comida). El catálogo trae el grupo con varios nombres según su origen (SMAE:
// "AOA MBAG", "Cereales S/G"; semilla: "AOA muy bajo en grasa", "Cereal con grasa"), así que se
// reconoce por el texto en vez de por una tabla exacta.
const EQUIVALENT_GROUPS = [
  { code: 'V', label: 'Verduras' },
  { code: 'F', label: 'Frutas' },
  { code: 'C', label: 'Cereales' },
  { code: 'LEG', label: 'Leguminosas' },
  { code: 'AOA_MB', label: 'AOA Muy Bajo' },
  { code: 'AOA_B', label: 'AOA Bajo' },
  { code: 'AOA_M', label: 'AOA Moderado' },
  { code: 'AOA_A', label: 'AOA Alto' },
  { code: 'LAC', label: 'Lácteos' },
  { code: 'G_CP', label: 'Grasa Con Proteína' },
  { code: 'G_SP', label: 'Grasa Sin Proteína' },
  { code: 'AZ', label: 'Azúcares' },
]

function equivalentGroupCode(group) {
  const name = String(group || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (!name) return null
  if (name.startsWith('verdura')) return 'V'
  if (name.startsWith('fruta')) return 'F'
  if (name.startsWith('cereal')) return 'C'
  if (name.startsWith('leguminosa')) return 'LEG'
  if (name.startsWith('aoa')) {
    if (name.includes('mbag') || name.includes('muy bajo')) return 'AOA_MB'
    if (name.includes('mag') || name.includes('moderado')) return 'AOA_M'
    if (name.includes('aag') || name.includes('alto')) return 'AOA_A'
    return 'AOA_B'
  }
  if (name.startsWith('leche') || name.startsWith('lacteo')) return 'LAC'
  if (name.startsWith('grasa')) return name.includes('con prote') ? 'G_CP' : 'G_SP'
  if (name.startsWith('azucar')) return 'AZ'
  return null
}

// Equivalentes por grupo de UNA porción de la receta, a partir de sus ingredientes vinculados al
// catálogo: gramos usados ÷ gramos de un equivalente. No se usa `RecipeIngredient.equivalence`
// (en las recetas importadas guarda la cantidad del renglón original, no equivalentes) ni los
// ingredientes "aproximados", cuya porción de 100 g no es un equivalente SMAE.
function recipeEquivalents(recipe) {
  const totals = {}
  for (const item of recipe?.ingredients || []) {
    const equivalence = item.ingredient?.equivalence || {}
    const grams = Number(equivalence.grams)
    if (!grams || equivalence.source === 'APPROX_500') continue
    const code = equivalentGroupCode(equivalence.group) || equivalentGroupCode(item.ingredient?.group)
    if (!code) continue
    totals[code] = (totals[code] || 0) + Number(item.quantity) / grams
  }
  const portions = Number(recipe?.portions) || 1
  return Object.fromEntries(Object.entries(totals).map(([code, value]) => [code, Math.round((value / portions) * 100) / 100]))
}

const trimNumber = (value) => String(Math.round(Number(value) * 10) / 10)

// Renglones de ingredientes como los lee la paciente: las recetas importadas traen su texto en
// medidas caseras ("1/2 taza de…"); las hechas en la app sólo tienen los ingredientes del catálogo.
function recipeIngredientLines(recipe) {
  const text = Array.isArray(recipe?.ingredientsText) ? recipe.ingredientsText.map((line) => String(line).trim()).filter(Boolean) : []
  if (text.length) return text
  return (recipe?.ingredients || []).filter((item) => item.ingredient?.name).map((item) => `${trimNumber(item.quantity)} ${item.unit || 'g'} de ${item.ingredient.name}`)
}

// Congela la semana asignada al momento de publicar: los MealSlot solo guardan un recipeId
// (referencia viva), así que si la receta se edita después, el PDF de un plan ya publicado no
// debe cambiar. Este snapshot es lo único que la generación de PDF debe leer para ese plan.
// Los campos de receta (foto, ingredientes, equivalentes) sólo salen completos si los slots
// llegan con `recipe.ingredients.ingredient` incluido.
function buildMenuSnapshot(mealSlots) {
  return mealSlots
    .filter((slot) => slot.recipeId)
    .map((slot) => {
      const servings = slot.servings ? Number(slot.servings) : 1
      return {
        dayOfWeek: slot.dayOfWeek,
        mealType: slot.mealType,
        recipeId: slot.recipeId,
        recipeName: slot.recipe?.name || 'Receta',
        servings,
        kcal: Math.round(((slot.recipe?.calculatedNutrition || slot.recipe?.nutrition)?.kcal || 0) * servings),
        imageFile: slot.recipe?.imageFile || null,
        portions: Number(slot.recipe?.portions) || 1,
        ingredients: recipeIngredientLines(slot.recipe),
        equivalents: Object.fromEntries(Object.entries(recipeEquivalents(slot.recipe)).map(([code, value]) => [code, Math.round(value * servings * 100) / 100])),
      }
    })
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || MEAL_TYPE_ORDER.indexOf(a.mealType) - MEAL_TYPE_ORDER.indexOf(b.mealType))
}

// Ajustes de receta propios de un plan: la nutrióloga reescribe las cantidades de una receta para
// esta paciente (según sus equivalentes) sin tocar la receta del catálogo. Se guardan por tiempo de
// comida y receta: { "<tiempo>|<recipeId>": { lines: [...], factor } }. `lines` es lo que lee la
// paciente; `factor` es por cuánto se multiplicaron las cantidades respecto a la receta en las
// porciones del tiempo (1 = sin cambio) y es lo que permite que energía, macros y micronutrientes
// del plan sigan al ajuste, porque del texto libre no se pueden recalcular.
const adjustmentKey = (mealType, recipeId) => `${mealType}|${recipeId}`

const normalizeFactor = (value) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.min(10, Math.max(0.1, Math.round(number * 100) / 100)) : 1 }

// Factor nutrimental del ajuste de una receta en un tiempo de comida (1 si no tiene ajuste).
function adjustmentFactor(adjustments, mealType, recipeId) {
  const adjustment = adjustments?.[adjustmentKey(mealType, recipeId)]
  return adjustment ? normalizeFactor(adjustment.factor) : 1
}

function normalizeRecipeAdjustments(value) {
  const result = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [key, adjustment] of Object.entries(value).slice(0, 200)) {
    const [mealType, recipeId, ...rest] = String(key).split('|')
    if (rest.length || !MEAL_TYPE_ORDER.includes(mealType) || !/^[0-9a-f-]{36}$/i.test(recipeId || '')) continue
    if (!Array.isArray(adjustment?.lines)) continue
    const lines = adjustment.lines.filter((line) => typeof line === 'string').map((line) => line.trim().slice(0, 240)).filter(Boolean).slice(0, 60)
    if (lines.length) result[adjustmentKey(mealType, recipeId)] = { lines, factor: normalizeFactor(adjustment.factor) }
  }
  return result
}

// Aplica los ajustes del plan al menú: la opción ajustada muestra los renglones reescritos, que ya
// son "lo que le toca" a la paciente (por eso deja de aplicar el aviso de rendimiento/porciones).
function applyRecipeAdjustments(menu, adjustments) {
  const clean = normalizeRecipeAdjustments(adjustments)
  return (menu || []).map((entry) => {
    const adjustment = clean[adjustmentKey(entry.mealType, entry.recipeId)]
    if (!adjustment) return entry
    const scale = (value) => Math.round((Number(value) || 0) * adjustment.factor * 100) / 100
    return { ...entry, ingredients: adjustment.lines, adjusted: true, kcal: Math.round((Number(entry.kcal) || 0) * adjustment.factor), equivalents: Object.fromEntries(Object.entries(entry.equivalents || {}).map(([code, value]) => [code, scale(value)])) }
  })
}

// El plan entregado no va por día sino por opciones intercambiables: por cada tiempo de comida,
// las recetas distintas de la semana en el orden en que aparecen (lunes → domingo). Repetir una
// receta varios días no genera opciones repetidas. Las porciones del tiempo de comida son las que
// la nutrióloga repartió en el paso Equivalentes; si el plan no tiene ese cálculo, se estiman con
// los equivalentes de su primera opción (la receta base de la Distribución).
function buildMealOptions(menu, mealTimes, equivalentPlan) {
  const times = normalizeMealTimes(mealTimes)
  return MEAL_TYPE_ORDER.map((mealType) => {
    const options = []
    const seen = new Set()
    for (const entry of [...(menu || [])].filter((item) => item.mealType === mealType).sort((a, b) => a.dayOfWeek - b.dayOfWeek)) {
      const key = `${entry.recipeId || entry.recipeName}|${entry.servings || 1}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push(entry)
    }
    const prescribed = mealBadgePortions(equivalentPlan?.distribution?.[mealType])
    const equivalents = prescribed.length ? Object.fromEntries(prescribed.map((portion) => [portion.code, portion.quantity])) : options[0]?.equivalents || {}
    const portions = EQUIVALENT_GROUPS
      .map((group) => ({ ...group, quantity: Math.round((equivalents[group.code] || 0) * 2) / 2 }))
      .filter((group) => group.quantity > 0)
    return { mealType, label: MEAL_TYPE_LABELS[mealType] || mealType, time: formatMealTime(times[mealType]), options, portions }
  }).filter((row) => row.options.length)
}

// Revisa un JPEG subido y lo devuelve reescrito sin metadatos: { data, width, height }, o null si no
// es un JPEG bien formado. Las fotos de receta sólo se aceptan en JPEG a propósito: se sirven
// públicamente y luego las incrusta pdfkit, que un PNG lo descomprime (y uno dañado puede tumbar el
// proceso) mientras que al JPEG sólo le recorre los segmentos de cabecera.
//
// El recorrido es deliberadamente igual de simple que el de pdfkit —marcador de 2 bytes, largo de 2
// bytes, siguiente segmento— y más estricto: cualquier cosa que otro lector pudiera interpretar
// distinto (bytes de relleno, largos que se salen del archivo, dos SOF) se rechaza en vez de
// tolerarse. Y se quitan los segmentos APPn y COM: ahí viven EXIF/XMP/ICC, que pdfkit le pasa a un
// lector de EXIF aparte, y no hacen falta para mostrar la foto. Así lo que se guarda es lo que se
// validó y los dos lectores ven exactamente la misma estructura.
function sanitizeJpeg(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  const parts = [buffer.subarray(0, 2)]
  let size = null
  let offset = 2
  while (offset + 4 <= buffer.length) {
    const marker = buffer[offset + 1]
    // Antes de los datos de imagen sólo se admiten segmentos con largo (nada de RSTn, SOI, EOI, TEM
    // ni relleno 0xFF).
    if (buffer[offset] !== 0xff || marker < 0xc0 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd9)) return null
    const length = buffer.readUInt16BE(offset + 2)
    const end = offset + 2 + length
    if (length < 2 || end > buffer.length) return null
    // SOF0–SOF15 llevan el tamaño, salvo DHT (C4), JPG (C8) y DAC (CC).
    if (marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (size || length < 8) return null
      size = { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      if (!size.width || !size.height) return null
    }
    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe
    if (!isMetadata) parts.push(buffer.subarray(offset, end))
    if (marker === 0xda) {
      // SOS: de aquí en adelante son los datos comprimidos, que se copian tal cual.
      if (!size || end >= buffer.length) return null
      parts.push(buffer.subarray(end))
      return { data: Buffer.concat(parts), ...size }
    }
    offset = end
  }
  return null
}

export { normalizeMealTimes, formatMealTime, normalizeRecipeAdjustments, applyRecipeAdjustments, adjustmentKey, adjustmentFactor, sanitizeJpeg, MEAL_TYPE_LABELS, DAY_LABELS, MEAL_TYPE_ORDER, EQUIVALENT_GROUPS, buildMenuSnapshot, buildMealOptions, equivalentGroupCode, recipeEquivalents, recipeIngredientLines }
