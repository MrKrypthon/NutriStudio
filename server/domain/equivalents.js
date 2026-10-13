// Cálculo dietético por equivalentes (el "cuadro dietosintético" de la hoja EQ del Excel de la
// nutrióloga): cuántos equivalentes de cada grupo del Sistema Mexicano de Alimentos Equivalentes
// cubren el requerimiento, y cómo se reparten entre los tiempos de comida. Este módulo no toca la
// base ni la red: lo usan igual el servidor (guardar, PDF) y la pantalla (cálculo en vivo).

import { PLAN_MEALS } from './planMeals.js'

// Aporte nutrimental promedio de UN equivalente de cada grupo (SMAE). `badge` es el círculo con que
// el plan impreso muestra el grupo: ahí cereales, leches y azúcares no se subdividen.
const EQUIVALENT_TABLE = [
  { code: 'V', label: 'Verduras', badge: 'V', kcal: 25, protein: 2, fat: 0, carbs: 4 },
  { code: 'F', label: 'Frutas', badge: 'F', kcal: 60, protein: 0, fat: 0, carbs: 15 },
  { code: 'C_SG', label: 'Cereales y tubérculos', sub: 'Sin grasa', badge: 'C', kcal: 70, protein: 2, fat: 0, carbs: 15 },
  { code: 'C_CG', label: 'Cereales y tubérculos', sub: 'Con grasa', badge: 'C', kcal: 115, protein: 2, fat: 5, carbs: 15 },
  { code: 'LEG', label: 'Leguminosas', badge: 'LEG', kcal: 120, protein: 8, fat: 1, carbs: 20 },
  { code: 'AOA_MB', label: 'Alimentos de origen animal', sub: 'Muy bajo en grasa', badge: 'AOA_MB', kcal: 40, protein: 7, fat: 1, carbs: 0 },
  { code: 'AOA_B', label: 'Alimentos de origen animal', sub: 'Bajo en grasa', badge: 'AOA_B', kcal: 55, protein: 7, fat: 3, carbs: 0 },
  { code: 'AOA_M', label: 'Alimentos de origen animal', sub: 'Moderado en grasa', badge: 'AOA_M', kcal: 75, protein: 7, fat: 5, carbs: 0 },
  { code: 'AOA_A', label: 'Alimentos de origen animal', sub: 'Alto en grasa', badge: 'AOA_A', kcal: 100, protein: 7, fat: 8, carbs: 0 },
  { code: 'LAC_D', label: 'Leche', sub: 'Descremada', badge: 'LAC', kcal: 95, protein: 9, fat: 2, carbs: 12 },
  { code: 'LAC_S', label: 'Leche', sub: 'Semidescremada', badge: 'LAC', kcal: 110, protein: 9, fat: 4, carbs: 12 },
  { code: 'LAC_E', label: 'Leche', sub: 'Entera', badge: 'LAC', kcal: 150, protein: 9, fat: 8, carbs: 12 },
  { code: 'LAC_A', label: 'Leche', sub: 'Con azúcar', badge: 'LAC', kcal: 200, protein: 8, fat: 5, carbs: 30 },
  { code: 'G_SP', label: 'Aceites y grasas', sub: 'Sin proteína', badge: 'G_SP', kcal: 45, protein: 0, fat: 5, carbs: 0 },
  { code: 'G_CP', label: 'Aceites y grasas', sub: 'Con proteína', badge: 'G_CP', kcal: 70, protein: 3, fat: 5, carbs: 3 },
  { code: 'AZ_SG', label: 'Azúcares', sub: 'Sin grasa', badge: 'AZ', kcal: 40, protein: 0, fat: 0, carbs: 10 },
  { code: 'AZ_CG', label: 'Azúcares', sub: 'Con grasa', badge: 'AZ', kcal: 85, protein: 0, fat: 5, carbs: 10 },
]
const EQUIVALENT_BY_CODE = Object.fromEntries(EQUIVALENT_TABLE.map((group) => [group.code, group]))

// Nombre con que cada grupo está en el catálogo de Ingredientes (SMAE), para consultar sus alimentos.
const CATALOG_GROUP = {
  V: 'Verduras', F: 'Frutas', C_SG: 'Cereales S/G', C_CG: 'Cereales C/G', LEG: 'Leguminosas',
  AOA_MB: 'AOA MBAG', AOA_B: 'AOA BAG', AOA_M: 'AOA MAG', AOA_A: 'AOA AAG',
  LAC_D: 'Leche descremada', LAC_S: 'Leche semidescremada', LAC_E: 'Leche entera', LAC_A: 'Leche con azúcar',
  G_SP: 'Grasas sin proteínas', G_CP: 'Grasas con proteínas', AZ_SG: 'Azucares sin grasa', AZ_CG: 'Azucares con grasa',
}

// Tiempos de comida entre los que se reparten los equivalentes, con su peso relativo.
const EQUIVALENT_MEALS = PLAN_MEALS.map((meal) => ({ key: meal.key, label: meal.label, share: meal.share / 100 }))

const MAX_EQUIVALENTS = 40
// Equivalentes de grasa sin proteína (aceite, aguacate…) que la propuesta intenta no rebasar.
const MAX_ADDED_FAT = 6
// Los equivalentes se prescriben en medios: 0, ½, 1, 1½…
const toHalf = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.min(MAX_EQUIVALENTS, Math.round(number * 2) / 2)
}
const round1 = (value) => Math.round(value * 10) / 10

// Requerimiento en gramos a partir de las kcal y el porcentaje de cada macronutrimento.
function macroTargets({ kcal, carbsPercent, proteinPercent, fatPercent }) {
  const energy = Number(kcal) || 0
  return {
    kcal: Math.round(energy),
    carbs: round1((energy * (Number(carbsPercent) || 0)) / 100 / 4),
    protein: round1((energy * (Number(proteinPercent) || 0)) / 100 / 4),
    fat: round1((energy * (Number(fatPercent) || 0)) / 100 / 9),
  }
}

function equivalentTotals(groups) {
  const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  for (const group of EQUIVALENT_TABLE) {
    const count = Number(groups?.[group.code]) || 0
    for (const key of Object.keys(totals)) totals[key] += count * group[key]
  }
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round1(value)]))
}

// % de adecuación de lo prescrito contra el requerimiento (100 = exacto). El rango aceptado en
// dietocálculo es 95–105 %.
function equivalentAdequacy(totals, targets) {
  return Object.fromEntries(['kcal', 'protein', 'fat', 'carbs'].map((key) => [key, targets?.[key] ? Math.round((totals[key] / targets[key]) * 100) : null]))
}
const adequacyStatus = (percent) => (percent == null ? 'none' : percent < 95 ? 'low' : percent > 105 ? 'high' : 'ok')

// Propuesta inicial de equivalentes para un requerimiento, con el método manual de siempre: se
// fijan los grupos "base" según la energía (verduras, frutas, leguminosas, leche), los cereales
// completan los hidratos de carbono, los alimentos de origen animal completan la proteína y las
// grasas completan los lípidos. Es un punto de partida para ajustar a mano, no una prescripción.
function suggestEquivalents(targets) {
  const kcal = Number(targets?.kcal) || 0
  const carbs = Number(targets?.carbs)
  const protein = Number(targets?.protein)
  const fat = Number(targets?.fat)
  // Sin los tres macros, las restas de abajo daban NaN y el grupo quedaba en 0 en silencio.
  if (kcal <= 0 || !Number.isFinite(carbs) || !Number.isFinite(protein) || !Number.isFinite(fat)) return {}
  const groups = {
    V: kcal < 1400 ? 3 : kcal < 2200 ? 4 : 5,
    F: kcal < 1400 ? 2 : kcal < 2000 ? 3 : 4,
    LEG: kcal < 2000 ? 1 : 2,
    LAC_D: kcal < 2000 ? 1 : 2,
    G_CP: kcal < 1600 ? 1 : kcal < 2400 ? 2 : 3,
  }
  const partial = () => equivalentTotals(groups)
  groups.C_SG = toHalf((carbs - partial().carbs) / EQUIVALENT_BY_CODE.C_SG.carbs)
  // La proteína que falta se reparte entre AOA muy bajo y bajo en grasa.
  const animal = Math.max(0, (protein - partial().protein) / 7)
  groups.AOA_B = toHalf(animal / 2)
  groups.AOA_MB = toHalf(animal - groups.AOA_B)
  const missingFat = () => toHalf((fat - partial().fat) / EQUIVALENT_BY_CODE.G_SP.fat)
  groups.G_SP = 0
  // Si para completar los lípidos harían falta demasiadas grasas añadidas, parte del AOA magro se
  // cambia por moderado en grasa: misma proteína, y los lípidos vienen del alimento y no del aceite.
  while (missingFat() > MAX_ADDED_FAT && groups.AOA_MB >= 0.5) {
    groups.AOA_MB -= 0.5
    groups.AOA_M = (groups.AOA_M || 0) + 0.5
  }
  groups.G_SP = missingFat()
  return Object.fromEntries(Object.entries(groups).filter(([, count]) => count > 0))
}

// Reparte los equivalentes de cada grupo entre los tiempos de comida activos, en medios, según el
// peso de cada tiempo (la comida el mayor, luego desayuno y cena, y las colaciones el menor). Lo que no divide
// exacto se asigna a los tiempos con mayor residuo, así la suma por grupo siempre es el total.
function suggestDistribution(groups, mealKeys = EQUIVALENT_MEALS.map((meal) => meal.key)) {
  const meals = EQUIVALENT_MEALS.filter((meal) => mealKeys.includes(meal.key))
  const distribution = Object.fromEntries(meals.map((meal) => [meal.key, {}]))
  if (!meals.length) return distribution
  const shareTotal = meals.reduce((sum, meal) => sum + meal.share, 0)
  for (const group of EQUIVALENT_TABLE) {
    const halves = Math.round(toHalf(groups?.[group.code]) * 2)
    if (!halves) continue
    const exact = meals.map((meal) => (halves * meal.share) / shareTotal)
    const assigned = exact.map(Math.floor)
    let remaining = halves - assigned.reduce((sum, value) => sum + value, 0)
    const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value), share: meals[index].share })).sort((a, b) => b.rest - a.rest || b.share - a.share)
    for (let turn = 0; remaining > 0; turn++, remaining--) assigned[order[turn % order.length].index] += 1
    meals.forEach((meal, index) => { if (assigned[index]) distribution[meal.key][group.code] = assigned[index] / 2 })
  }
  return distribution
}

// Equivalentes de un grupo que faltan por repartir (negativo = se repartió de más).
function remainingEquivalents(groups, distribution, code) {
  const assigned = EQUIVALENT_MEALS.reduce((sum, meal) => sum + (Number(distribution?.[meal.key]?.[code]) || 0), 0)
  return round1((Number(groups?.[code]) || 0) - assigned)
}

// Limpia lo que llega del cliente antes de guardarlo: sólo grupos y tiempos conocidos, en medios.
function normalizeEquivalentPlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const cleanGroups = (source) => {
    const result = {}
    if (!source || typeof source !== 'object' || Array.isArray(source)) return result
    for (const group of EQUIVALENT_TABLE) {
      const count = toHalf(source[group.code])
      if (count > 0) result[group.code] = count
    }
    return result
  }
  const groups = cleanGroups(value.groups)
  const distribution = {}
  for (const meal of EQUIVALENT_MEALS) {
    const counts = cleanGroups(value.distribution?.[meal.key])
    if (Object.keys(counts).length) distribution[meal.key] = counts
  }
  const extras = normalizeExtras(value.extras)
  if (!Object.keys(groups).length && !Object.keys(distribution).length && !extras.length) return null
  return { groups, distribution, ...(extras.length ? { extras } : {}) }
}

// Renglones propios del plan que no son un grupo de equivalentes: un suplemento, una bebida. Cada
// uno trae su aporte por porción y cuántas porciones tocan en cada tiempo de comida:
// { id, name, kcal, protein, fat, carbs, meals: { <tiempo>: n } }.
const MAX_EXTRAS = 8
function normalizeExtras(value) {
  if (!Array.isArray(value)) return []
  const number = (input, max) => { const parsed = Number(input); return Number.isFinite(parsed) && parsed >= 0 ? Math.min(max, Math.round(parsed * 10) / 10) : 0 }
  const result = []
  for (const raw of value.slice(0, MAX_EXTRAS)) {
    const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, 60) : ''
    if (!name) continue
    const meals = {}
    for (const meal of EQUIVALENT_MEALS) {
      const count = toHalf(raw.meals?.[meal.key])
      if (count > 0) meals[meal.key] = count
    }
    result.push({ id: String(raw.id || `x${result.length}`).replace(/[^a-z0-9]/gi, '').slice(0, 12) || `x${result.length}`, name, kcal: number(raw.kcal, 2000), protein: number(raw.protein, 300), fat: number(raw.fat, 300), carbs: number(raw.carbs, 500), meals })
  }
  return result
}

// Aporte de los renglones propios: de todo el día, o sólo de un tiempo de comida.
function extrasTotals(extras, mealKey = null) {
  const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  for (const extra of extras || []) {
    const count = mealKey ? Number(extra.meals?.[mealKey]) || 0 : Object.values(extra.meals || {}).reduce((sum, value) => sum + (Number(value) || 0), 0)
    for (const key of Object.keys(totals)) totals[key] += count * (Number(extra[key]) || 0)
  }
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round1(value)]))
}

// Menús adicionales de un plan ("Día de entrenamiento", "Fin de semana"): cada uno con sus días de
// la semana, su ajuste de energía respecto al requerimiento del plan y su propio cuadro de
// equivalentes. El menú base es `plan.equivalents` y cubre los días que ningún otro reclama.
const MAX_MENUS = 4
function normalizeMenus(value) {
  if (!Array.isArray(value)) return []
  const taken = new Set()
  const result = []
  for (const raw of value.slice(0, MAX_MENUS)) {
    const name = typeof raw?.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ').slice(0, 40) : ''
    if (!name) continue
    // Un día pertenece a un solo menú: gana el primero que lo pide.
    const days = [...new Set((Array.isArray(raw.days) ? raw.days : []).map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7 && !taken.has(day)))].sort()
    days.forEach((day) => taken.add(day))
    const delta = Math.round(Number(raw.kcalDelta))
    result.push({
      id: String(raw.id || `m${result.length}`).replace(/[^a-z0-9]/gi, '').slice(0, 12) || `m${result.length}`,
      name,
      days,
      kcalDelta: Number.isFinite(delta) ? Math.max(-1500, Math.min(1500, delta)) : 0,
      equivalents: normalizeEquivalentPlan(raw.equivalents) || { groups: {}, distribution: {} },
    })
  }
  return result
}

// Los menús de un plan con los días que le tocan a cada uno, empezando por el base.
function planMenus(equivalents, menus) {
  const extra = normalizeMenus(menus)
  const claimed = new Set(extra.flatMap((menu) => menu.days))
  const base = { id: 'base', name: 'Menú base', days: [1, 2, 3, 4, 5, 6, 7].filter((day) => !claimed.has(day)), kcalDelta: 0, equivalents: equivalents || null }
  return [base, ...extra]
}

const addTotals = (a, b) => Object.fromEntries(['kcal', 'protein', 'fat', 'carbs'].map((key) => [key, round1((Number(a?.[key]) || 0) + (Number(b?.[key]) || 0))]))

// Porciones de un tiempo de comida como las muestra el plan impreso: un círculo por grupo, con
// cereales, leches y azúcares sumados en el suyo.
function mealBadgePortions(mealCounts) {
  const totals = new Map()
  for (const group of EQUIVALENT_TABLE) {
    const count = Number(mealCounts?.[group.code]) || 0
    if (count > 0) totals.set(group.badge, (totals.get(group.badge) || 0) + count)
  }
  return [...totals].map(([code, quantity]) => ({ code, quantity }))
}

export {
  EQUIVALENT_TABLE, EQUIVALENT_BY_CODE, EQUIVALENT_MEALS, CATALOG_GROUP,
  macroTargets, equivalentTotals, equivalentAdequacy, adequacyStatus,
  suggestEquivalents, suggestDistribution, remainingEquivalents, normalizeEquivalentPlan, mealBadgePortions, toHalf,
  normalizeExtras, extrasTotals, addTotals, normalizeMenus, planMenus,
}
