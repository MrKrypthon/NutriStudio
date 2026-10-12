const MEAL_TYPE_LABELS = {
  breakfast: 'Desayuno',
  lunch: 'Comida',
  snack: 'Colación',
  dinner: 'Cena',
}

const DAY_LABELS = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
}

const MEAL_TYPE_ORDER = ['breakfast', 'lunch', 'snack', 'dinner']

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

// El plan entregado no va por día sino por opciones intercambiables: por cada tiempo de comida,
// las recetas distintas de la semana en el orden en que aparecen (lunes → domingo). Repetir una
// receta varios días no genera opciones repetidas. Las porciones del tiempo de comida son los
// equivalentes de su primera opción (la receta base de la Distribución).
function buildMealOptions(menu) {
  return MEAL_TYPE_ORDER.map((mealType) => {
    const options = []
    const seen = new Set()
    for (const entry of [...(menu || [])].filter((item) => item.mealType === mealType).sort((a, b) => a.dayOfWeek - b.dayOfWeek)) {
      const key = `${entry.recipeId || entry.recipeName}|${entry.servings || 1}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push(entry)
    }
    const equivalents = options[0]?.equivalents || {}
    const portions = EQUIVALENT_GROUPS
      .map((group) => ({ ...group, quantity: Math.round((equivalents[group.code] || 0) * 2) / 2 }))
      .filter((group) => group.quantity > 0)
    return { mealType, label: MEAL_TYPE_LABELS[mealType] || mealType, options, portions }
  }).filter((row) => row.options.length)
}

// Lee el tamaño real de un JPEG a partir de sus bytes (no del tipo que dice el navegador). Devuelve
// null si no es un JPEG bien formado. Las fotos de receta sólo se aceptan en JPEG a propósito: se
// sirven públicamente y luego las incrusta pdfkit, que al JPEG sólo le lee estos mismos marcadores
// (no lo descomprime), mientras que un PNG lo descomprime y uno dañado puede tumbar el proceso.
function readJpegSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null
    const marker = buffer[offset + 1]
    if (marker === 0xff) { offset += 1; continue }
    // SOF0–SOF15 llevan el tamaño, salvo DHT (C4), JPG (C8) y DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buffer.readUInt16BE(offset + 5)
      const width = buffer.readUInt16BE(offset + 7)
      return width && height ? { width, height } : null
    }
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

export { readJpegSize, MEAL_TYPE_LABELS, DAY_LABELS, MEAL_TYPE_ORDER, EQUIVALENT_GROUPS, buildMenuSnapshot, buildMealOptions, equivalentGroupCode, recipeEquivalents, recipeIngredientLines }
