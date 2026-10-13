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

// Un ingrediente del catálogo como renglón editable de la receta. `grams` es lo que se sirve a la
// paciente; `portions`, cuántos equivalentes de su grupo son esos gramos.
function itemFromIngredient(ingredient, grams) {
  const equivalence = ingredient?.equivalence || {}
  const gramsPerEq = Number(equivalence.grams) || null
  const code = equivalence.source === 'APPROX_500' ? null : equivalentCodeForGroup(equivalence.group) || equivalentCodeForGroup(ingredient?.group)
  const nutrition = ingredient?.nutrition || {}
  return {
    ingredientId: ingredient?.id || null,
    name: String(ingredient?.name || 'Ingrediente'),
    catalogGroup: String(ingredient?.group || ''),
    code: gramsPerEq ? code : null,
    serving: gramsPerEq && equivalence.serving ? String(equivalence.serving) : null,
    gramsPerEq,
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

// Compara lo que suma la receta con lo calculado para el tiempo de comida, grupo por grupo.
// `status`: 'ok' (dentro de ¼ de equivalente), 'low', 'high', o 'extra' (la receta trae un grupo
// que el tiempo no tiene asignado).
const TOLERANCE = 0.25
function compareWithMeal(items, prescribed) {
  const have = itemsEquivalents(items)
  const rows = []
  for (const group of EQUIVALENT_TABLE) {
    const target = Number(prescribed?.[group.code]) || 0
    const actual = have[group.code] || 0
    if (!target && !actual) continue
    const status = !target ? 'extra' : Math.abs(actual - target) <= TOLERANCE ? 'ok' : actual < target ? 'low' : 'high'
    rows.push({ code: group.code, label: group.label, sub: group.sub || null, target, actual, status })
  }
  return { rows, fits: rows.length > 0 && rows.every((row) => row.status === 'ok') }
}

// "Receta dinámica": lleva los ingredientes de cada grupo a las porciones que el tiempo de comida
// tiene calculadas para ese grupo, repartiéndolas en la misma proporción que ya tenían. Los grupos
// que la receta no trae no se inventan (quedan como faltantes en compareWithMeal) y los alimentos
// sin grupo de equivalentes (condimentos, libres) no se tocan.
function fitItemsToMeal(items, prescribed) {
  const have = itemsEquivalents(items)
  return (items || []).map((item) => {
    const target = Number(prescribed?.[item.code]) || 0
    const current = have[item.code] || 0
    if (!item.code || !item.gramsPerEq || !target || !current) return item
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
      grams: round2(grams),
      n: Object.fromEntries(MACRO_KEYS.map((key) => { const number = Number(raw.n?.[key]); return [key, Number.isFinite(number) && number >= 0 && number <= 1000 ? round2(number) : 0] })),
    })
  }
  return result
}

export { equivalentCodeForGroup, itemFromIngredient, itemPortions, recipeItems, itemLine, itemsEquivalents, itemsMacros, compareWithMeal, fitItemsToMeal, swapItem, setItemPortions, normalizeItems }
