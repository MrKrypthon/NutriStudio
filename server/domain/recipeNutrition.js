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
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round((value / servings) * 10) / 10]))
}

export { RECIPE_NUTRITION_KEYS, emptyNutritionTotals, perServingFromIngredients }
