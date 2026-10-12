// Sugerencia de recetas para un tiempo de comida: de las recetas de su tipo, las que mejor se
// acercan a lo calculado para ese tiempo (energía y reparto de macros), sin los alimentos que la
// paciente evita. Es una propuesta para que la nutrióloga elija, no una prescripción. Este módulo
// no toca la base ni la red: lo usan el servidor y la pantalla.
import { recipeIngredientLines } from './documents.js'

const normalizeText = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Palabras de un texto libre del expediente que no nombran un alimento.
const STOPWORDS = new Set(['ninguna', 'ninguno', 'conocida', 'conocido', 'evita', 'evitar', 'causa', 'causan', 'malestar', 'gusta', 'gustan', 'agrada', 'agradan', 'entera', 'entero', 'todo', 'toda', 'tipo', 'algunos', 'algunas', 'cuando', 'porque', 'pero', 'solo', 'mucho', 'mucha', 'poco', 'poca', 'come', 'comer', 'tolera', 'distension', 'dolor', 'gases', 'alergia', 'alergias', 'alergica', 'alergico', 'intolerancia', 'intolerante', 'sensibilidad', 'para', 'como', 'desde', 'hace', 'tiene', 'sobre', 'entre', 'ella', 'esta', 'este', 'esos', 'esas', 'productos', 'alimentos', 'comida', 'comidas', 'bebidas'])

// Quien evita una familia de alimentos evita también los que una receta nombra por su nombre
// propio: "pescado" no aparece en "Filete de salmón". Lista corta y deliberada; la nutrióloga ve
// los términos y puede quitar los que no apliquen.
const RELATED_FOODS = {
  pescado: ['atun', 'salmon', 'tilapia', 'mojarra', 'sardina', 'bacalao', 'trucha', 'huachinango', 'robalo', 'anchoa'],
  marisco: ['camaron', 'pulpo', 'calamar', 'jaiba', 'ostion', 'almeja', 'mejillon', 'langosta', 'surimi'],
  lactosa: ['leche', 'crema', 'queso', 'yogur', 'yoghurt', 'mantequilla', 'requeson'],
  lacteo: ['leche', 'crema', 'queso', 'yogur', 'yoghurt', 'mantequilla', 'requeson'],
  gluten: ['trigo', 'harina de trigo', 'cebada', 'centeno', 'pan ', 'pasta', 'galleta'],
  nuez: ['nuec', 'almendra', 'avellana', 'pistache', 'cacahuat'],
  cerdo: ['tocino', 'chorizo', 'jamon', 'carnitas', 'chicharron', 'longaniza'],
  huevo: ['clara'],
}

// Términos a evitar a partir de lo escrito en el expediente (alergias, intolerancias, lo que no le
// gusta): palabras de cuatro letras o más, sin acentos y reducidas a su raíz. Quedan a la vista de la
// nutrióloga para que quite o agregue antes de pedir sugerencias.
function avoidTermsFromText(...texts) {
  const terms = new Set()
  const add = (term) => { terms.add(term); for (const related of RELATED_FOODS[term] || []) terms.add(related) }
  for (const text of texts.flat()) {
    for (const word of normalizeText(text).split(/[^a-zñ]+/)) {
      if (word.length < 4 || STOPWORDS.has(word)) continue
      // Se guarda la raíz, que aparece tanto en singular como en plural ("cacahuat" está en
      // "cacahuate" y en "cacahuates"); los plurales en -ces llevan además su singular en -z.
      if (word.length > 4 && word.endsWith('ces')) { add(`${word.slice(0, -3)}z`); add(word.slice(0, -2)) }
      else if (word.length > 4 && word.endsWith('es')) add(word.slice(0, -2))
      else if (word.length > 4 && word.endsWith('s')) add(word.slice(0, -1))
      else add(word)
    }
  }
  return [...terms]
}

const nutritionOf = (recipe) => {
  const source = recipe?.calculatedNutrition || recipe?.nutrition || {}
  return { kcal: Number(source.kcal) || 0, protein: Number(source.protein) || 0, carbs: Number(source.carbs) || 0, fat: Number(source.fat) || 0 }
}
const macroShares = (values) => (values.kcal > 0 ? { protein: (values.protein * 4) / values.kcal, carbs: (values.carbs * 4) / values.kcal, fat: (values.fat * 9) / values.kcal } : null)
const roundQuarter = (value) => Math.round(value * 4) / 4
const MIN_FACTOR = 0.5
const MAX_FACTOR = 2

// Mejores recetas para un tiempo de comida. `target` son las kcal y gramos calculados para ese
// tiempo; cada sugerencia trae el `factor` por el que habría que multiplicar sus cantidades para
// llegar a esas kcal (entre ½ y 2, en cuartos: más allá deja de ser la misma receta).
function suggestRecipes(recipes, { recipeType, target, avoid = [], exclude = [], count = 5 } = {}) {
  const targetKcal = Number(target?.kcal) || 0
  if (targetKcal <= 0) return []
  const targetShares = macroShares({ kcal: targetKcal, protein: Number(target.protein) || 0, carbs: Number(target.carbs) || 0, fat: Number(target.fat) || 0 })
  const terms = avoid.map(normalizeText).map((term) => term.trim()).filter((term) => term.length >= 3)
  const excluded = new Set(exclude)
  const candidates = []
  for (const recipe of recipes || []) {
    if (excluded.has(recipe.id) || (recipe.status && recipe.status !== 'ACTIVE')) continue
    if (recipeType && !(recipe.mealTypes || []).includes(recipeType)) continue
    const values = nutritionOf(recipe)
    if (values.kcal <= 0) continue
    const lines = recipeIngredientLines(recipe)
    if (!lines.length) continue
    const haystack = normalizeText(`${recipe.name} ${lines.join(' ')}`)
    if (terms.some((term) => haystack.includes(term))) continue
    const factor = roundQuarter(targetKcal / values.kcal)
    if (factor < MIN_FACTOR || factor > MAX_FACTOR) continue
    const shares = macroShares(values)
    // Lo que pesa: quedar cerca de las kcal ya escalada, escalar lo menos posible, parecerse al
    // reparto de macros del tiempo, y tener foto (el plan impreso la muestra).
    const score = Math.abs(Math.log(targetKcal / (values.kcal * factor))) * 3
      + Math.abs(Math.log(factor)) * 0.6
      + (targetShares ? Math.abs(shares.protein - targetShares.protein) + Math.abs(shares.carbs - targetShares.carbs) + Math.abs(shares.fat - targetShares.fat) : 0)
      + (recipe.imageFile ? 0 : 0.15)
    candidates.push({ recipe, factor, score, kcal: Math.round(values.kcal * factor), protein: Math.round(values.protein * factor), carbs: Math.round(values.carbs * factor), fat: Math.round(values.fat * factor) })
  }
  return candidates.sort((a, b) => a.score - b.score || a.recipe.name.localeCompare(b.recipe.name)).slice(0, count)
}

export { avoidTermsFromText, suggestRecipes, normalizeText }
