import { describe, expect, it } from 'vitest'
import { catalogGroupForCode, compareWithMeal, deriveEquivalence, equivalentCodeForGroup, fitItemsToMeal, itemFromIngredient, itemLine, itemPortions, itemsEquivalents, itemsMacros, normalizeItems, recipeItems, setItemPortions, swapItem } from './recipeEquivalents.js'

const ingredient = (name, group, serving, grams, nutrition = {}) => ({ id: '0f64b6b4-7599-4bdc-8e31-3492605d3499', name, group, equivalence: { group, serving, grams, source: 'SMAE' }, nutrition: { kcal: 0, protein: 0, carbs: 0, fat: 0, ...nutrition } })
const panela = ingredient('Queso panela', 'AOA BAG', '40 g', 40, { kcal: 137.5, protein: 17.5, carbs: 0, fat: 7.5 })
const tortilla = ingredient('Tortilla de maíz', 'Cereales S/G', '1 pieza', 30, { kcal: 233, protein: 6.6, carbs: 50, fat: 0 })
const aguacate = ingredient('Aguacate', 'Grasas sin proteínas', '1/3 pieza', 31, { kcal: 145, protein: 0, carbs: 0, fat: 16 })
const sal = ingredient('Sal', 'Libres en energía', null, null)

describe('equivalentCodeForGroup', () => {
  it('maps catalog groups to the equivalents table, subgroup included', () => {
    expect(equivalentCodeForGroup('Cereales S/G')).toBe('C_SG')
    expect(equivalentCodeForGroup('Cereales C/G')).toBe('C_CG')
    expect(equivalentCodeForGroup('AOA MBAG')).toBe('AOA_MB')
    expect(equivalentCodeForGroup('AOA MAG')).toBe('AOA_M')
    expect(equivalentCodeForGroup('Leche semidescremada')).toBe('LAC_S')
    expect(equivalentCodeForGroup('Leche con azúcar')).toBe('LAC_A')
    expect(equivalentCodeForGroup('Grasas con proteínas')).toBe('G_CP')
    expect(equivalentCodeForGroup('Azucares con grasa')).toBe('AZ_CG')
    expect(equivalentCodeForGroup('Libres en energía')).toBeNull()
  })
})

describe('recipe as equivalents', () => {
  const recipe = { portions: 2, ingredients: [{ quantity: 160, ingredient: panela }, { quantity: 120, ingredient: tortilla }, { quantity: 31, ingredient: aguacate }, { quantity: 2, ingredient: sal }] }
  const items = recipeItems(recipe, 1)

  it('turns each ingredient into portions of its group, per serving', () => {
    expect(items.map((item) => [item.name, item.code, item.grams, itemPortions(item)])).toEqual([['Queso panela', 'AOA_B', 80, 2], ['Tortilla de maíz', 'C_SG', 60, 2], ['Aguacate', 'G_SP', 15.5, 0.5], ['Sal', null, 1, null]])
    expect(itemsEquivalents(items)).toEqual({ AOA_B: 2, C_SG: 2, G_SP: 0.5 })
  })

  it('writes the line the patient reads from the household measure', () => {
    expect(itemLine(items[1])).toBe('2 piezas de Tortilla de maíz (60 g)')
    // 1/2 equivalente de "1/3 pieza" es 1/6: se lleva a la fracción de cocina más cercana.
    expect(itemLine(items[2])).toBe('1/4 pieza de Aguacate (16 g)')
    expect(itemLine(items[0])).toBe('80 g de Queso panela')
    expect(itemLine(items[3])).toBe('1 g de Sal')
  })

  it('adds up energy and macros from the grams served', () => {
    expect(itemsMacros(items)).toEqual({ kcal: 272.3, protein: 18, carbs: 30, fat: 8.5 })
  })

  it('compares the recipe with what the meal time has calculated', () => {
    const { rows, fits } = compareWithMeal(items, { AOA_B: 2, C_SG: 3, F: 1 })
    expect(rows.map((row) => [row.code, row.target, row.actual, row.status])).toEqual([['F', 1, 0, 'low'], ['C', 3, 2, 'low'], ['AOA', 2, 2, 'ok'], ['G', 0, 0.5, 'extra']])
    // Por familia: 2 de AOA cumplen aunque el cuadro pida otro nivel de grasa.
    expect(compareWithMeal(items, { AOA_MB: 2, C_CG: 2, G_CP: 0.5 }).fits).toBe(true)
    expect(fits).toBe(false)
    expect(compareWithMeal(items, { AOA_B: 2, C_SG: 2, G_SP: 0.5 }).fits).toBe(true)
  })

  it('fits each group to the meal portions without inventing missing groups', () => {
    const fitted = fitItemsToMeal(items, { AOA_B: 1, C_SG: 3, F: 1 })
    expect(itemsEquivalents(fitted)).toEqual({ AOA_B: 1, C_SG: 3, G_SP: 0.5 })
    expect(fitted[3]).toEqual(items[3])
    // No modifica los renglones de entrada.
    expect(items[0].grams).toBe(80)
  })

  it('swaps a food for another one keeping its portions', () => {
    const pollo = ingredient('Pechuga de pollo', 'AOA MBAG', '30 g', 30, { kcal: 110 })
    const swapped = swapItem(items[0], pollo)
    expect([swapped.name, swapped.code, swapped.grams, itemPortions(swapped)]).toEqual(['Pechuga de pollo', 'AOA_MB', 60, 2])
  })

  it('edits portions through the grams of one equivalent', () => {
    expect(setItemPortions(items[1], 1.5).grams).toBe(45)
    expect(setItemPortions(items[3], 3)).toEqual(items[3])
  })
})

describe('normalizeItems', () => {
  it('keeps well-formed rows and drops the rest', () => {
    const good = itemFromIngredient(tortilla, 60)
    expect(normalizeItems([good, { name: '', grams: 10 }, { name: 'x', grams: -1 }, { name: 'y', grams: 99999 }, 'junk'])).toEqual([good])
    expect(normalizeItems(null)).toEqual([])
    expect(normalizeItems([{ ...good, code: 'ZZ', ingredientId: 'nope', n: { kcal: 'abc' } }])[0]).toMatchObject({ code: null, ingredientId: null, n: { kcal: 0 } })
  })
})

describe('deriveEquivalence for foods that do not come from the SMAE', () => {
  const food = (group, nutrition, equivalence = {}) => ({ id: 'x', name: 'Alimento', group, nutrition, equivalence: { group, serving: '100 g', grams: 100, ...equivalence } })

  it('computes the grams of one equivalent from the nutrient that defines the group', () => {
    // Cereal: 15 g de hidratos. Arroz cocido con 28 g/100 g → 53.6 g por equivalente.
    expect(deriveEquivalence(food('Cereales', { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }, { source: 'APROX_500' }))).toMatchObject({ code: 'C_SG', gramsPerEq: 53.57, basis: 'calculada' })
    // AOA: 7 g de proteína. Pechuga con 31 g/100 g → 22.6 g; por su grasa, muy bajo.
    expect(deriveEquivalence(food('Proteínas', { kcal: 165, protein: 31, carbs: 0, fat: 3.6 }, { group: 'AOA', source: { provider: 'usda' } }))).toMatchObject({ code: 'AOA_MB', gramsPerEq: 22.58, basis: 'calculada' })
    // Grasa: 5 g de lípidos. Aceite → 5 g.
    expect(deriveEquivalence(food('Grasas', { kcal: 884, protein: 0, carbs: 0, fat: 100 }, { source: 'BASE_ALIMENTOS' }))).toMatchObject({ code: 'G_SP', gramsPerEq: 5 })
  })

  it('tells a low-energy fruit from a vegetable by its name when it has no group', () => {
    const strawberry = { kcal: 32, protein: 0.7, carbs: 7.7, fat: 0.3 }
    expect(deriveEquivalence({ ...food('', strawberry, { source: { provider: 'usda' } }), name: 'Fresa cruda' })).toMatchObject({ code: 'F', basis: 'estimada' })
    expect(deriveEquivalence({ ...food('', strawberry, { source: { provider: 'usda' } }), name: 'Calabacita cruda' })).toMatchObject({ code: 'V', basis: 'estimada' })
  })

  it('picks the subgroup from the composition', () => {
    expect(deriveEquivalence(food('Cereales', { kcal: 460, protein: 7, carbs: 60, fat: 20 }, { source: 'APROX_500' })).code).toBe('C_CG')
    expect(deriveEquivalence(food('AOA', { kcal: 300, protein: 20, carbs: 0, fat: 24 }, { source: 'APROX_500' })).code).toBe('AOA_A')
    expect(deriveEquivalence(food('Grasas', { kcal: 600, protein: 20, carbs: 20, fat: 50 }, { source: 'APROX_500' })).code).toBe('G_CP')
  })

  it('estimates the group when the food has no recognizable one', () => {
    expect(deriveEquivalence(food('Importado', { kcal: 884, protein: 0, carbs: 0, fat: 100 }, { group: 'Otros', source: { provider: 'usda' } }))).toMatchObject({ code: 'G_SP', basis: 'estimada' })
    expect(deriveEquivalence(food('Importado', { kcal: 20, protein: 1, carbs: 4, fat: 0.2 }, { group: '', source: { provider: 'usda' } })).code).toBe('V')
    expect(deriveEquivalence(food('Importado', { kcal: 0 }, { group: '' })).code).toBeNull()
  })

  it('keeps the SMAE portion untouched and rejects absurd portions', () => {
    expect(deriveEquivalence({ group: 'Frutas', nutrition: { kcal: 52, carbs: 14 }, equivalence: { group: 'Frutas', serving: '1 pieza', grams: 106, source: 'SMAE' } })).toEqual({ code: 'F', gramsPerEq: 106, serving: '1 pieza', basis: 'smae' })
    // Una especia "clasificada" como verdura: 25 kcal serían 8 g… pero con 2 kcal/100 g serían 1.25 kg.
    expect(deriveEquivalence(food('Verduras', { kcal: 2, protein: 0, carbs: 0.5, fat: 0 }, { source: 'APROX_500' })).code).toBeNull()
  })
})

describe('catalogGroupForCode', () => {
  it('names the catalog group of every code of the equivalents table', async () => {
    const { EQUIVALENT_TABLE } = await import('./equivalents.js')
    for (const group of EQUIVALENT_TABLE) expect(equivalentCodeForGroup(catalogGroupForCode(group.code)), group.code).toBe(group.code)
  })
})
