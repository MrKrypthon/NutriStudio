// Una receta vista por equivalentes: cada ingrediente del catálogo como "tantas porciones de tal
// grupo" (2 de AOA = 80 g de queso panela). Es lo que permite ajustar una receta a lo calculado para
// un tiempo de comida grupo por grupo, e intercambiar un alimento por otro del mismo grupo sin
// cambiar el aporte. Este módulo no toca la base ni la red: lo usan el servidor y la pantalla.
import { EQUIVALENT_BY_CODE, EQUIVALENT_TABLE } from './equivalents.js'
import { scaleIngredientLine } from '../../src/lib/ingredientLines.js'

const fold = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const round2 = (value) => Math.round(value * 100) / 100
const MACRO_KEYS = ['kcal', 'protein', 'carbs', 'fat']

// Grupo del catálogo ("AOA MBAG", "Cereales S/G", "Leche con azúcar"…) → código del cuadro de
// equivalentes. null para lo que no es un grupo de equivalentes (libres en energía, aproximados).
function equivalentCodeForGroup(group) {
  const name = fold(group)
  if (!name) return null
  if (name.startsWith('verdura')) return 'V'
  if (name.startsWith('fruta')) return 'F'
  if (name.startsWith('cereal')) return /c\/g|con grasa/.test(name) ? 'C_CG' : 'C_SG'
  if (name.startsWith('leguminosa')) return 'LEG'
  if (name.startsWith('aoa') || name.includes('origen animal')) {
    if (name.includes('mbag') || name.includes('muy bajo')) return 'AOA_MB'
    if (name.includes('mag') || name.includes('moderado')) return 'AOA_M'
    if (name.includes('aag') || name.includes('alto')) return 'AOA_A'
    return 'AOA_B'
  }
  if (name.startsWith('leche') || name.startsWith('lacteo')) {
    if (name.includes('semi')) return 'LAC_S'
    if (name.includes('azucar')) return 'LAC_A'
    if (name.includes('entera') || name.includes('con grasa')) return 'LAC_E'
    return 'LAC_D'
  }
  if (name.startsWith('grasa') || name.startsWith('aceite')) return name.includes('con prote') ? 'G_CP' : 'G_SP'
  if (name.startsWith('azucar')) return name.includes('con grasa') ? 'AZ_CG' : 'AZ_SG'
  return null
}

// Nutrimento que define un equivalente de cada grupo en el SMAE, y cuánto trae: un equivalente de
// cereal es lo que aporta 15 g de hidratos; uno de alimento de origen animal, 7 g de proteína; uno
// de grasa, 5 g de lípidos… Con esto se calcula cuántos gramos de un alimento valen un equivalente
// cuando el alimento NO viene del SMAE (los importados de USDA u Open Food Facts, la base de
// alimentos, los "aproximados"): ahí sólo se conoce su composición por 100 g.
const DEFINING = { V: ['kcal', 25], F: ['carbs', 15], C: ['carbs', 15], LEG: ['carbs', 20], AOA: ['protein', 7], LAC: ['protein', 9], G: ['fat', 5], AZ: ['carbs', 10] }
const FAMILY_LABELS = { V: 'Verduras', F: 'Frutas', C: 'Cereales y tubérculos', LEG: 'Leguminosas', AOA: 'Alimentos de origen animal', LAC: 'Leche', G: 'Aceites y grasas', AZ: 'Azúcares' }
// Familia de un código del cuadro: los subgrupos (cereal con/sin grasa, AOA por nivel de grasa,
// tipos de leche…) son el mismo grupo de alimentos a la hora de armar un platillo.
const familyOf = (code) => (code ? code.split('_')[0] : null)

// Subgrupo que le corresponde a un alimento dentro de su familia, por su composición.
function subgroupFor(family, n) {
  const per = (amount, of, base) => (of > 0 ? (amount / of) * base : 0)
  if (family === 'C') return per(n.fat, n.carbs, 15) >= 3 ? 'C_CG' : 'C_SG'
  if (family === 'AOA') { const fat = per(n.fat, n.protein, 7); return fat <= 1.5 ? 'AOA_MB' : fat <= 4 ? 'AOA_B' : fat <= 6.5 ? 'AOA_M' : 'AOA_A' }
  if (family === 'LAC') { if (per(n.carbs, n.protein, 9) >= 20) return 'LAC_A'; const fat = per(n.fat, n.protein, 9); return fat <= 3 ? 'LAC_D' : fat <= 6 ? 'LAC_S' : 'LAC_E' }
  if (family === 'G') return per(n.protein, n.fat, 5) >= 2 ? 'G_CP' : 'G_SP'
  if (family === 'AZ') return per(n.fat, n.carbs, 10) >= 3 ? 'AZ_CG' : 'AZ_SG'
  return family
}

// Código del cuadro → grupo del catálogo de Ingredientes (los nombres del SMAE). Sirve para buscar
// con qué intercambiar un alimento que no viene del SMAE: por su grupo de equivalentes.
const CATALOG_GROUP_BY_CODE = { V: 'Verduras', F: 'Frutas', C_SG: 'Cereales S/G', C_CG: 'Cereales C/G', LEG: 'Leguminosas', AOA_MB: 'AOA MBAG', AOA_B: 'AOA BAG', AOA_M: 'AOA MAG', AOA_A: 'AOA AAG', LAC_D: 'Leche descremada', LAC_S: 'Leche semidescremada', LAC_E: 'Leche entera', LAC_A: 'Leche con azúcar', G_SP: 'Grasas sin proteínas', G_CP: 'Grasas con proteínas', AZ_SG: 'Azucares sin grasa', AZ_CG: 'Azucares con grasa' }
const catalogGroupForCode = (code) => CATALOG_GROUP_BY_CODE[code] || null

// Grupo de un alimento del que sólo se conoce la composición (sin grupo SMAE reconocible), por de
// dónde viene su energía. Es una aproximación: sirve para que un alimento importado cuente en el
// grupo más parecido, no para clasificarlo oficialmente.
// Frutas de poca energía (fresa, sandía, melón…): por composición no se distinguen de una verdura,
// así que se reconocen por el nombre.
const FRUIT_NAMES = /\b(fresas?|frambuesas?|zarzamoras?|moras?|arandanos?|sandia|melon|papaya|toronja|naranjas?|mandarinas?|duraznos?|guayabas?|pina|manzanas?|peras?|mangos?|uvas?|kiwis?|ciruelas?|cerezas?|tunas?|platanos?|higos?|granada|maracuya|chabacanos?|nectarinas?|lichis?|carambola|tejocotes?|capulin(es)?|mamey|zapote|guanabana|pitahaya|frutos? rojos?)\b/
const foldName = (name) => String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function inferFamily(n, name = '') {
  if (!(n.kcal > 0)) return null
  const fatShare = (n.fat * 9) / n.kcal
  const proteinShare = (n.protein * 4) / n.kcal
  const carbShare = (n.carbs * 4) / n.kcal
  if (fatShare >= 0.7) return 'G'
  if (proteinShare >= 0.35 && carbShare < 0.3) return 'AOA'
  if (carbShare >= 0.5) {
    // Primero las verduras: son tan poco densas que su poca proteína pesa mucho en porcentaje.
    if (n.kcal <= 110 && FRUIT_NAMES.test(foldName(name)) && !/\b(jugo|nectar|mermelada|jarabe|almibar)\b/.test(foldName(name))) return 'F'
    if (n.kcal <= 45) return 'V'
    if (proteinShare >= 0.2) return 'LEG'
    if (n.kcal <= 100 && n.sugar > 0 && n.sugar >= n.carbs * 0.5) return 'F'
    return 'C'
  }
  return null
}

const CALCULATED_SOURCES = new Set(['APROX_500', 'APPROX_500', 'BASE_ALIMENTOS'])
const NUTRIENT_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'sugar']

// Equivalencia de un ingrediente: a qué grupo del cuadro pertenece y cuántos gramos valen un
// equivalente. Del SMAE se toma tal cual; de cualquier otra fuente se calcula con su composición.
// `basis` dice de dónde salió: 'smae', 'calculada' (grupo conocido, gramos calculados) o
// 'estimada' (también el grupo se dedujo de la composición).
function deriveEquivalence(ingredient) {
  const equivalence = ingredient?.equivalence || {}
  const nutrition = ingredient?.nutrition || {}
  const n = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, Number(nutrition[key]) || 0]))
  const named = equivalentCodeForGroup(equivalence.group) || equivalentCodeForGroup(ingredient?.group)
  // La porción guardada es un equivalente de verdad cuando viene del SMAE o la capturó la
  // nutrióloga. En los alimentos importados (USDA, Open Food Facts), la base de alimentos y los
  // "aproximados" esa porción es sólo "100 g": no es un equivalente y hay que calcularlo.
  const trusted = typeof equivalence.source !== 'object' && !CALCULATED_SOURCES.has(equivalence.source) && !/^100\s*g/i.test(String(equivalence.serving || '').trim())
  if (trusted && named && Number(equivalence.grams) > 0) {
    return { code: named, gramsPerEq: Number(equivalence.grams), serving: equivalence.serving ? String(equivalence.serving) : null, basis: 'smae' }
  }
  // Un alimento del SMAE que no está en un grupo de equivalentes (libres en energía, bebidas
  // alcohólicas) no tiene equivalente: no se le inventa uno.
  if (trusted && equivalence.source === 'SMAE') return { code: null, gramsPerEq: null, serving: null, basis: null }
  const family = familyOf(named) || inferFamily(n, ingredient.name)
  if (!family) return { code: null, gramsPerEq: null, serving: null, basis: null }
  const [nutrient, amount] = DEFINING[family]
  if (!(n[nutrient] > 0)) return { code: null, gramsPerEq: null, serving: null, basis: null }
  const gramsPerEq = (amount / n[nutrient]) * 100
  // Un "equivalente" de menos de 3 g o de más de 600 g no es una porción real: el alimento no
  // pertenece de verdad a ese grupo (p. ej. una especia clasificada como verdura).
  if (gramsPerEq < 3 || gramsPerEq > 600) return { code: null, gramsPerEq: null, serving: null, basis: null }
  return { code: subgroupFor(family, n), gramsPerEq: round2(gramsPerEq), serving: null, basis: named ? 'calculada' : 'estimada' }
}

// Un ingrediente del catálogo como renglón editable de la receta. `grams` es lo que se sirve a la
// paciente; `portions`, cuántos equivalentes de su grupo son esos gramos.
function itemFromIngredient(ingredient, grams) {
  const derived = deriveEquivalence(ingredient)
  const nutrition = ingredient?.nutrition || {}
  return {
    ingredientId: ingredient?.id || null,
    name: String(ingredient?.name || 'Ingrediente'),
    catalogGroup: String(ingredient?.group || ''),
    code: derived.code,
    serving: derived.serving,
    gramsPerEq: derived.gramsPerEq,
    basis: derived.basis,
    grams: round2(Math.max(0, Number(grams) || 0)),
    // Por 100 g, sólo lo que se necesita para mostrar el aporte de la receta ajustada.
    n: Object.fromEntries(MACRO_KEYS.map((key) => [key, Number(nutrition[key]) || 0])),
  }
}

const itemPortions = (item) => (item.gramsPerEq ? round2(item.grams / item.gramsPerEq) : null)

// Ingredientes de una receta tal como le tocan a la paciente: de "rinde N porciones" a las que se
// sirven en el tiempo de comida.
function recipeItems(recipe, servings = 1) {
  const scale = (Number(servings) || 1) / (Number(recipe?.portions) || 1)
  return (recipe?.ingredients || []).filter((link) => link.ingredient).map((link) => itemFromIngredient(link.ingredient, Number(link.quantity) * scale))
}

// Renglón que lee la paciente: la medida casera del equivalente multiplicada por las porciones
// ("2/3 pieza de aguacate"), o los gramos si el alimento no tiene medida.
function itemLine(item) {
  const grams = item.grams >= 10 ? Math.round(item.grams) : Math.round(item.grams * 10) / 10
  const portions = itemPortions(item)
  if (item.serving && portions) {
    const measure = /^\d|^[¼½¾⅓⅔]/.test(item.serving) ? scaleIngredientLine(item.serving, portions) : item.serving
    if (!/^\d+(\.\d+)?\s*(g|gr|gramos?)$/i.test(item.serving.trim())) return `${measure} de ${item.name} (${grams} g)`
  }
  return `${grams} g de ${item.name}`
}

// Equivalentes por grupo que suman los ingredientes: { C_SG: 2, AOA_B: 1.5 }.
function itemsEquivalents(items) {
  const totals = {}
  for (const item of items || []) {
    const portions = itemPortions(item)
    if (item.code && portions) totals[item.code] = round2((totals[item.code] || 0) + portions)
  }
  return totals
}

function itemsMacros(items) {
  const totals = Object.fromEntries(MACRO_KEYS.map((key) => [key, 0]))
  for (const item of items || []) for (const key of MACRO_KEYS) totals[key] += (Number(item.n?.[key]) || 0) * item.grams / 100
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value * 10) / 10]))
}

// Equivalentes por familia: { C: 2, AOA: 1.5 }. Acepta renglones de receta o un cuadro por código.
function familyTotals(source) {
  const totals = {}
  const add = (code, amount) => { const family = familyOf(code); if (family && amount) totals[family] = round2((totals[family] || 0) + amount) }
  if (Array.isArray(source)) for (const item of source) add(item.code, itemPortions(item) || 0)
  else for (const [code, amount] of Object.entries(source || {})) add(code, Number(amount) || 0)
  return totals
}

// Compara lo que suma la receta con lo calculado para el tiempo de comida, por grupo de alimentos
// (familia): 2 de AOA cumplen sea pollo o queso, aunque el cuadro pida un nivel de grasa concreto.
// `status`: 'ok' (dentro de ¼ de equivalente), 'low', 'high', o 'extra' (la receta trae un grupo
// que el tiempo no tiene asignado).
const TOLERANCE = 0.25
const FAMILY_ORDER = ['V', 'F', 'C', 'LEG', 'AOA', 'LAC', 'G', 'AZ']
function compareWithMeal(items, prescribed) {
  const have = familyTotals(items)
  const want = familyTotals(prescribed)
  const rows = []
  for (const family of FAMILY_ORDER) {
    const target = want[family] || 0
    const actual = have[family] || 0
    if (!target && !actual) continue
    const status = !target ? 'extra' : Math.abs(actual - target) <= TOLERANCE ? 'ok' : actual < target ? 'low' : 'high'
    rows.push({ code: family, label: FAMILY_LABELS[family], sub: null, target, actual, status })
  }
  return { rows, fits: rows.length > 0 && rows.every((row) => row.status === 'ok') }
}

// "Receta dinámica": lleva los ingredientes de cada grupo a las porciones que el tiempo de comida
// tiene calculadas para ese grupo, repartiéndolas en la misma proporción que ya tenían. Los grupos
// que la receta no trae no se inventan (quedan como faltantes en compareWithMeal) y los alimentos
// sin grupo de equivalentes (condimentos, libres) no se tocan.
function fitItemsToMeal(items, prescribed) {
  const have = familyTotals(items)
  const want = familyTotals(prescribed)
  return (items || []).map((item) => {
    const family = familyOf(item.code)
    const target = want[family] || 0
    const current = have[family] || 0
    if (!family || !item.gramsPerEq || !target || !current) return item
    // En cuartos de equivalente, que es como se sirve.
    const portions = Math.max(0.25, Math.round((itemPortions(item) * target / current) * 4) / 4)
    return { ...item, grams: round2(portions * item.gramsPerEq) }
  })
}

// Cambia un ingrediente por otro del catálogo conservando sus porciones (si ambos tienen medida de
// equivalente) o sus gramos.
function swapItem(item, ingredient) {
  const portions = itemPortions(item)
  const next = itemFromIngredient(ingredient, item.grams)
  return next.gramsPerEq && portions ? { ...next, grams: round2(portions * next.gramsPerEq) } : next
}

const setItemPortions = (item, portions) => (item.gramsPerEq ? { ...item, grams: round2(Math.max(0, Number(portions) || 0) * item.gramsPerEq) } : item)

// Lo que llega del cliente antes de guardarlo en el plan.
function normalizeItems(value) {
  if (!Array.isArray(value)) return []
  const text = (input, max) => (typeof input === 'string' ? input.trim().slice(0, max) : '')
  const result = []
  for (const raw of value.slice(0, 30)) {
    const grams = Number(raw?.grams)
    const name = text(raw?.name, 120)
    if (!name || !Number.isFinite(grams) || grams <= 0 || grams > 5000) continue
    const gramsPerEq = Number(raw.gramsPerEq)
    result.push({
      ingredientId: /^[0-9a-f-]{36}$/i.test(raw.ingredientId || '') ? raw.ingredientId : null,
      name,
      catalogGroup: text(raw.catalogGroup, 60),
      code: EQUIVALENT_BY_CODE[raw.code] ? raw.code : null,
      serving: text(raw.serving, 60) || null,
      gramsPerEq: Number.isFinite(gramsPerEq) && gramsPerEq > 0 && gramsPerEq <= 2000 ? round2(gramsPerEq) : null,
      basis: ['smae', 'calculada', 'estimada'].includes(raw.basis) ? raw.basis : null,
      grams: round2(grams),
      n: Object.fromEntries(MACRO_KEYS.map((key) => { const number = Number(raw.n?.[key]); return [key, Number.isFinite(number) && number >= 0 && number <= 1000 ? round2(number) : 0] })),
    })
  }
  return result
}

export { catalogGroupForCode, deriveEquivalence, familyOf, familyTotals, FAMILY_LABELS, FAMILY_ORDER, equivalentCodeForGroup, itemFromIngredient, itemPortions, recipeItems, itemLine, itemsEquivalents, itemsMacros, compareWithMeal, fitItemsToMeal, swapItem, setItemPortions, normalizeItems }
