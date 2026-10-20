import { round1 } from './round.js'

// Nutrición por porción de una receta a partir de sus ingredientes del catálogo. Vive aquí, y no en
// cada lugar que la necesita, porque tres copias se desincronizaron: el script que vincula el
// recetario sumaba sólo los macros y dejaba todas las recetas importadas sin micronutrientes.

// kcal/protein/carbs/fat/fiber/sugar/sodium alimentan el resumen de macros que se ve en todos
// lados; los micronutrientes, el % de adecuación. Todo sale del mismo JSON de nutrición del
// ingrediente, por 100 g, escalado por la cantidad usada.
const RECIPE_NUTRITION_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'vitaminA', 'vitaminC', 'folicAcid', 'calcium', 'iron', 'vitaminD', 'vitaminE', 'vitaminK', 'vitaminB12', 'zinc', 'iodine', 'selenium']
const emptyNutritionTotals = () => Object.fromEntries(RECIPE_NUTRITION_KEYS.map((key) => [key, 0]))

// `ingredients`: renglones con `quantity` (gramos) e `ingredient.nutrition` (por 100 g).
function perServingFromIngredients(ingredients, portions) {
  const totals = emptyNutritionTotals()
  for (const item of ingredients || []) {
    const nutrition = item.ingredient?.nutrition || {}
    const factor = (Number(item.quantity) || 0) / 100
    for (const key of Object.keys(totals)) totals[key] += Number(nutrition[key] || 0) * factor
  }
  const servings = Math.max(1, Number(portions) || 1)
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round1(value / servings)]))
}

// Renglones de ingredientes de una receta tal como llegan del cliente. Gramos positivos que quepan
// en la columna (Decimal 8,3) y sin repetir ingrediente (@@unique recipeId+ingredientId): antes un
// renglón con cantidad negativa se guardaba (y restaba nutrientes) y uno con texto, repetido o
// enorme reventaba en la base con 500. Devuelve null si algún renglón no sirve.
function normalizeRecipeIngredientRows(value) {
  if (!Array.isArray(value)) return null
  const seen = new Set()
  const rows = []
  for (const item of value) {
    const quantity = Number(item?.quantity)
    const equivalence = item?.equivalence === undefined || item?.equivalence === null || item?.equivalence === '' ? null : Number(item.equivalence)
    if (typeof item?.ingredientId !== 'string' || seen.has(item.ingredientId)) return null
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity >= 100000) return null
    if (equivalence !== null && (!Number.isFinite(equivalence) || equivalence < 0 || equivalence >= 100000)) return null
    seen.add(item.ingredientId)
    rows.push({ ingredientId: item.ingredientId, quantity, unit: typeof item.unit === 'string' && item.unit.trim() ? item.unit.trim().slice(0, 20) : 'g', equivalence })
  }
  return rows
}

export { RECIPE_NUTRITION_KEYS, emptyNutritionTotals, normalizeRecipeIngredientRows, perServingFromIngredients }
