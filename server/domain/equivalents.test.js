import { describe, expect, it } from 'vitest'
import { EQUIVALENT_MEALS, EQUIVALENT_TABLE, equivalentAdequacy, equivalentTotals, macroTargets, mealBadgePortions, normalizeEquivalentPlan, remainingEquivalents, suggestDistribution, suggestEquivalents } from './equivalents.js'

describe('macroTargets', () => {
  it('turns kcal and macro percentages into grams (the EQ sheet example)', () => {
    // GET 1550 con 800/450/300 kcal de HC/lípidos/proteína → 200 g, 50 g y 75 g.
    expect(macroTargets({ kcal: 1550, carbsPercent: 800 / 15.5, fatPercent: 450 / 15.5, proteinPercent: 300 / 15.5 })).toEqual({ kcal: 1550, carbs: 200, protein: 75, fat: 50 })
  })
})

describe('equivalentTotals', () => {
  it('adds up each group by its average contribution per equivalent', () => {
    expect(equivalentTotals({ V: 4, F: 3, C_SG: 6, AOA_B: 4, G_SP: 3 })).toEqual({ kcal: 100 + 180 + 420 + 220 + 135, protein: 8 + 12 + 28, fat: 12 + 15, carbs: 16 + 45 + 90 })
  })

  it('ignores unknown groups and empty input', () => {
    expect(equivalentTotals({ X: 9 })).toEqual({ kcal: 0, protein: 0, fat: 0, carbs: 0 })
    expect(equivalentTotals(null)).toEqual({ kcal: 0, protein: 0, fat: 0, carbs: 0 })
  })
})

describe('suggestEquivalents', () => {
  it.each([1200, 1550, 1800, 2200, 2600, 3000])('lands within 90–110 %% of every target at %i kcal', (kcal) => {
    const targets = macroTargets({ kcal, carbsPercent: 50, proteinPercent: 20, fatPercent: 30 })
    const adequacy = equivalentAdequacy(equivalentTotals(suggestEquivalents(targets)), targets)
    for (const key of ['kcal', 'protein', 'fat', 'carbs']) {
      expect(adequacy[key], `${key} a ${kcal} kcal`).toBeGreaterThanOrEqual(90)
      expect(adequacy[key], `${key} a ${kcal} kcal`).toBeLessThanOrEqual(110)
    }
  })

  it('only proposes half-equivalent steps and nothing without a requirement', () => {
    const groups = suggestEquivalents(macroTargets({ kcal: 1870, carbsPercent: 45, proteinPercent: 25, fatPercent: 30 }))
    for (const count of Object.values(groups)) expect(Number.isInteger(count * 2)).toBe(true)
    expect(suggestEquivalents({ kcal: 0 })).toEqual({})
  })
})

describe('suggestDistribution', () => {
  const groups = { V: 4, F: 3, C_SG: 7.5, AOA_B: 4.5, G_SP: 2.5, LAC_D: 1 }

  it('hands out exactly the prescribed total of each group', () => {
    const distribution = suggestDistribution(groups)
    for (const code of Object.keys(groups)) expect(remainingEquivalents(groups, distribution, code)).toBe(0)
  })

  it('only uses the meal times that are active', () => {
    const distribution = suggestDistribution(groups, ['breakfast', 'lunch', 'dinner'])
    expect(Object.keys(distribution)).toEqual(['breakfast', 'lunch', 'dinner'])
    for (const code of Object.keys(groups)) expect(remainingEquivalents(groups, distribution, code)).toBe(0)
  })

  it('gives the main meal the biggest share', () => {
    const distribution = suggestDistribution({ C_SG: 10 })
    expect(distribution.lunch.C_SG).toBeGreaterThan(distribution.breakfast.C_SG)
    expect(distribution.breakfast.C_SG).toBeGreaterThan(distribution.snack.C_SG)
  })
})

describe('remainingEquivalents', () => {
  it('reports what is left to hand out, negative when over-assigned', () => {
    expect(remainingEquivalents({ F: 3 }, { breakfast: { F: 1 }, snack: { F: 1 } }, 'F')).toBe(1)
    expect(remainingEquivalents({ F: 1 }, { breakfast: { F: 1 }, snack: { F: 1 } }, 'F')).toBe(-1)
  })
})

describe('normalizeEquivalentPlan', () => {
  it('keeps known groups and meals, rounded to halves', () => {
    expect(normalizeEquivalentPlan({ groups: { V: '4', F: 2.3, X: 5, LEG: -1, AOA_B: 999 }, distribution: { breakfast: { V: 1.26 }, brunch: { V: 1 }, dinner: {} } }))
      .toEqual({ groups: { V: 4, F: 2.5, AOA_B: 40 }, distribution: { breakfast: { V: 1.5 } } })
  })

  it('returns null when there is nothing to store', () => {
    expect(normalizeEquivalentPlan(null)).toBeNull()
    expect(normalizeEquivalentPlan({ groups: { V: 0 } })).toBeNull()
    expect(normalizeEquivalentPlan([1, 2])).toBeNull()
  })
})

describe('mealBadgePortions', () => {
  it('merges subgroups into the circle the printed plan shows', () => {
    expect(mealBadgePortions({ C_SG: 1.5, C_CG: 0.5, LAC_D: 1, LAC_E: 1, AOA_B: 2, AZ_SG: 1 }))
      .toEqual([{ code: 'C', quantity: 2 }, { code: 'AOA_B', quantity: 2 }, { code: 'LAC', quantity: 2 }, { code: 'AZ', quantity: 1 }])
  })
})

describe('tables', () => {
  it('has consistent energy for every group (4/4/9 kcal per gram, within SMAE rounding)', () => {
    for (const group of EQUIVALENT_TABLE) expect(Math.abs(group.kcal - (group.protein * 4 + group.carbs * 4 + group.fat * 9)), group.code).toBeLessThanOrEqual(12)
  })

  it('every meal time has a positive share', () => {
    for (const meal of EQUIVALENT_MEALS) expect(meal.share).toBeGreaterThan(0)
  })
})

describe('extras and menus', () => {
  it('counts supplement rows in the day and in their meal', async () => {
    const { extrasTotals, addTotals, normalizeEquivalentPlan } = await import('./equivalents.js')
    const plan = normalizeEquivalentPlan({ groups: { V: 1 }, extras: [{ id: 'a', name: ' Proteína en polvo ', kcal: 160, protein: 31, fat: 3, carbs: 2.3, meals: { snack: 1, brunch: 3 } }, { name: '' }] })
    expect(plan.extras).toEqual([{ id: 'a', name: 'Proteína en polvo', kcal: 160, protein: 31, fat: 3, carbs: 2.3, meals: { snack: 1 } }])
    expect(extrasTotals(plan.extras)).toEqual({ kcal: 160, protein: 31, fat: 3, carbs: 2.3 })
    expect(extrasTotals(plan.extras, 'lunch').kcal).toBe(0)
    expect(addTotals({ kcal: 25, protein: 2, fat: 0, carbs: 4 }, extrasTotals(plan.extras)).kcal).toBe(185)
  })

  it('gives each extra menu its days and leaves the rest to the base menu', async () => {
    const { planMenus, normalizeMenus } = await import('./equivalents.js')
    const menus = [{ id: 't', name: 'Entrenamiento', days: [1, 3, 5, 9], kcalDelta: 200, equivalents: { groups: { C_SG: 8 } } }, { name: 'Fin de semana', days: [5, 6, 7], kcalDelta: 99999 }, { name: '' }]
    const clean = normalizeMenus(menus)
    expect(clean.map((menu) => [menu.name, menu.days, menu.kcalDelta])).toEqual([['Entrenamiento', [1, 3, 5], 200], ['Fin de semana', [6, 7], 1500]])
    expect(planMenus({ groups: { V: 4 } }, menus).map((menu) => [menu.id, menu.days])).toEqual([['base', [2, 4]], ['t', [1, 3, 5]], ['m1', [6, 7]]])
    expect(planMenus(null, null).map((menu) => menu.days)).toEqual([[1, 2, 3, 4, 5, 6, 7]])
  })
})
