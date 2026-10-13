// Sugerencia de recetas para un tiempo de comida: de las recetas de su tipo, las que mejor se
// acercan a lo calculado para ese tiempo (energía y reparto de macros), sin los alimentos que la
// paciente evita. Es una propuesta para que la nutrióloga elija, no una prescripción. Este módulo
// no toca la base ni la red: lo usan el servidor y la pantalla.
import { recipeIngredientLines } from './documents.js'
import { EQUIVALENT_BY_CODE } from './equivalents.js'
import { familyOf, familyTotals, fitItemsToMeal, itemsMacros, recipeItems } from './recipeEquivalents.js'

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
  const calculated = recipe?.calculatedNutrition
  const stored = recipe?.nutrition
  // `calculatedNutrition` puede venir como objeto vacío (truthy): se elige la fuente con kcal real
  // para no descartar en silencio una receta que sí tiene nutrición guardada.
  const source = Number(calculated?.kcal) > 0 ? calculated : (stored || calculated || {})
  return { kcal: Number(source.kcal) || 0, protein: Number(source.protein) || 0, carbs: Number(source.carbs) || 0, fat: Number(source.fat) || 0 }
}
const macroShares = (values) => (values.kcal > 0 ? { protein: (values.protein * 4) / values.kcal, carbs: (values.carbs * 4) / values.kcal, fat: (values.fat * 9) / values.kcal } : null)
const roundQuarter = (value) => Math.round(value * 4) / 4
const MIN_FACTOR = 0.5
const MAX_FACTOR = 2

// Coincidencia de términos a evitar: un término corto ("sal") se busca como palabra completa para
// no excluir "salmón"/"salsa"; una raíz larga ("cacahuat", "nuec") se admite como prefijo de palabra.
const termMatchers = (terms) => terms.map((term) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(term.length <= 3 ? `\\b${escaped}\\b` : `\\b${escaped}`)
})
const matchesAnyTerm = (matchers, haystack) => matchers.some((pattern) => pattern.test(haystack))

// Mejores recetas para un tiempo de comida. `target` son las kcal y gramos calculados para ese
// tiempo; cada sugerencia trae el `factor` por el que habría que multiplicar sus cantidades para
// llegar a esas kcal (entre ½ y 2, en cuartos: más allá deja de ser la misma receta).
function suggestRecipes(recipes, { recipeType, target, avoid = [], exclude = [], count = 5 } = {}) {
  const targetKcal = Number(target?.kcal) || 0
  if (targetKcal <= 0) return []
  const targetShares = macroShares({ kcal: targetKcal, protein: Number(target.protein) || 0, carbs: Number(target.carbs) || 0, fat: Number(target.fat) || 0 })
  const terms = avoid.map(normalizeText).map((term) => term.trim()).filter((term) => term.length >= 3)
  const matchers = termMatchers(terms)
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
    if (matchesAnyTerm(matchers, haystack)) continue
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
  return candidates.sort((a, b) => a.score - b.score || String(a.recipe.name || '').localeCompare(String(b.recipe.name || ''))).slice(0, count)
}

// Sugerencia por GRUPOS: cuando el tiempo de comida ya tiene equivalentes repartidos, lo que importa
// no es sólo que la receta dé las mismas kcal, sino que esté hecha de los grupos que se le
// asignaron (si tocan 2 cereales, 2 de origen animal y 1 verdura, un licuado de fruta con las
// mismas kcal no sirve). Para cada receta con ingredientes del catálogo:
//
//   1. se traduce a equivalentes por grupo (SMAE; o calculados de la composición para los alimentos
//      importados de USDA y demás — ver deriveEquivalence);
//   2. se mide la COBERTURA: qué parte de la energía prescrita viene de grupos que la receta trae;
//   3. se AJUSTA la receta a las porciones del tiempo (lo mismo que hará al aplicarla) y se mira
//      qué sobra —energía de grupos que el tiempo no tiene— y qué tan cerca queda de las kcal.
//
// Gana la que cubre más grupos, trae menos de lo no asignado y queda más cerca en energía.
// `prescribed` es el cuadro del tiempo ({ código: equivalentes }); `servings`, las porciones que se
// sirven en ese tiempo (la receta se evalúa ya servida).
function suggestRecipesByGroups(recipes, { recipeType, prescribed, servings = 1, avoid = [], exclude = [], count = 5 } = {}) {
  const want = familyTotals(prescribed)
  const families = Object.keys(want)
  if (!families.length) return []
  // Energía prescrita por familia: los equivalentes de cada código por las kcal de su grupo.
  const wantKcal = {}
  for (const [code, amount] of Object.entries(prescribed || {})) {
    const group = EQUIVALENT_BY_CODE[code]
    if (group && Number(amount) > 0) wantKcal[familyOf(code)] = (wantKcal[familyOf(code)] || 0) + Number(amount) * group.kcal
  }
  const targetKcal = Object.values(wantKcal).reduce((sum, value) => sum + value, 0)
  if (!(targetKcal > 0)) return []
  const terms = avoid.map(normalizeText).map((term) => term.trim()).filter((term) => term.length >= 3)
  const matchers = termMatchers(terms)
  const excluded = new Set(exclude)
  const kcalOf = (item) => (Number(item.n?.kcal) || 0) * item.grams / 100
  const candidates = []
  for (const recipe of recipes || []) {
    if (excluded.has(recipe.id) || (recipe.status && recipe.status !== 'ACTIVE')) continue
    if (recipeType && !(recipe.mealTypes || []).includes(recipeType)) continue
    const items = recipeItems(recipe, servings)
    if (!items.length) continue
    const haystack = normalizeText(`${recipe.name} ${recipeIngredientLines(recipe).join(' ')} ${items.map((item) => item.name).join(' ')}`)
    if (matchesAnyTerm(matchers, haystack)) continue
    const have = familyTotals(items)
    const covered = families.filter((family) => have[family] > 0)
    if (!covered.length) continue
    const coverage = covered.reduce((sum, family) => sum + (wantKcal[family] || 0), 0) / targetKcal
    const fitted = fitItemsToMeal(items, prescribed)
    const macros = itemsMacros(fitted)
    if (!(macros.kcal > 0)) continue
    const originalKcal = items.reduce((sum, item) => sum + kcalOf(item), 0)
    // Lo que la receta trae de más: grupos que el tiempo no tiene asignados. Los alimentos sin
    // grupo (condimentos, libres en energía) no cuentan: apenas aportan.
    const extraKcal = fitted.filter((item) => item.code && !want[familyOf(item.code)]).reduce((sum, item) => sum + kcalOf(item), 0)
    const extraShare = extraKcal / macros.kcal
    // Ya ajustada debe quedar cerca de la energía del tiempo: lo que la receta trae de grupos no
    // asignados no se toca, y si con eso se va al doble (un licuado con crema de cacahuate para
    // una colación de fruta) no es una sugerencia para este tiempo.
    if (macros.kcal > targetKcal * 1.6 || macros.kcal < targetKcal * 0.4) continue
    const energyGap = Math.abs(Math.log(macros.kcal / targetKcal))
    // Cuánto hubo que estirar o encoger la receta para que quepa: una que sólo cabe a la cuarta
    // parte (o al doble) no es de verdad un platillo para este tiempo.
    const fitGap = originalKcal > 0 ? Math.abs(Math.log(macros.kcal / originalKcal)) : 0
    const score = (1 - coverage) * 3 + extraShare * 2 + energyGap * 1.5 + fitGap * 0.8 + (recipe.imageFile ? 0 : 0.1)
    candidates.push({
      recipe, score, items: fitted,
      coverage: Math.round(coverage * 100),
      missing: families.filter((family) => !(have[family] > 0)),
      extra: [...new Set(fitted.filter((item) => item.code && !want[familyOf(item.code)] && kcalOf(item) > macros.kcal * 0.05).map((item) => familyOf(item.code)))],
      factor: originalKcal > 0 ? Math.round((macros.kcal / originalKcal) * 100) / 100 : 1,
      baseKcal: Math.round(originalKcal), kcal: Math.round(macros.kcal), protein: Math.round(macros.protein), carbs: Math.round(macros.carbs), fat: Math.round(macros.fat),
    })
  }
  return candidates.sort((a, b) => a.score - b.score || String(a.recipe.name || '').localeCompare(String(b.recipe.name || ''))).slice(0, count)
}

export { avoidTermsFromText, suggestRecipes, suggestRecipesByGroups, normalizeText }
