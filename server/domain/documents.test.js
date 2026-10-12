import { describe, expect, it } from 'vitest'
import { buildMealOptions, buildMenuSnapshot, equivalentGroupCode, recipeEquivalents, recipeIngredientLines, readImageInfo } from './documents.js'

describe('buildMenuSnapshot', () => {
  const slot = (overrides) => ({ dayOfWeek: 1, mealType: 'breakfast', recipeId: 'r1', servings: 1, recipe: { name: 'Avena', nutrition: { kcal: 200 } }, ...overrides })

  it('drops slots without an assigned recipe', () => {
    const snapshot = buildMenuSnapshot([slot(), slot({ dayOfWeek: 2, recipeId: null, recipe: null })])
    expect(snapshot).toHaveLength(1)
  })

  it('multiplies recipe kcal by servings and rounds it', () => {
    const snapshot = buildMenuSnapshot([slot({ servings: 1.5, recipe: { name: 'Avena', nutrition: { kcal: 200 } } })])
    expect(snapshot[0].kcal).toBe(300)
  })

  it('defaults servings to 1 when missing', () => {
    const snapshot = buildMenuSnapshot([slot({ servings: null })])
    expect(snapshot[0].servings).toBe(1)
    expect(snapshot[0].kcal).toBe(200)
  })

  it('sorts by day of week, then by a fixed meal-time order regardless of input order', () => {
    const snapshot = buildMenuSnapshot([
      slot({ dayOfWeek: 1, mealType: 'dinner' }),
      slot({ dayOfWeek: 1, mealType: 'breakfast' }),
      slot({ dayOfWeek: 1, mealType: 'lunch' }),
      slot({ dayOfWeek: 1, mealType: 'snack' }),
      slot({ dayOfWeek: 2, mealType: 'breakfast' }),
    ])
    expect(snapshot.map((entry) => `${entry.dayOfWeek}:${entry.mealType}`)).toEqual([
      '1:breakfast', '1:lunch', '1:snack', '1:dinner', '2:breakfast',
    ])
  })

  it('falls back to a generic name when the recipe relation is missing', () => {
    const snapshot = buildMenuSnapshot([slot({ recipe: null })])
    expect(snapshot[0].recipeName).toBe('Receta')
  })
})

describe('equivalentGroupCode', () => {
  it('recognizes SMAE and seed group names', () => {
    expect(equivalentGroupCode('AOA MBAG')).toBe('AOA_MB')
    expect(equivalentGroupCode('AOA muy bajo en grasa')).toBe('AOA_MB')
    expect(equivalentGroupCode('AOA BAG')).toBe('AOA_B')
    expect(equivalentGroupCode('AOA MAG')).toBe('AOA_M')
    expect(equivalentGroupCode('AOA AAG')).toBe('AOA_A')
    expect(equivalentGroupCode('Cereales S/G')).toBe('C')
    expect(equivalentGroupCode('Leche descremada')).toBe('LAC')
    expect(equivalentGroupCode('Grasas con proteínas')).toBe('G_CP')
    expect(equivalentGroupCode('Grasa')).toBe('G_SP')
    expect(equivalentGroupCode('Libres en energía')).toBeNull()
  })
})

describe('recipeEquivalents', () => {
  const ingredient = (quantity, equivalence, group = 'Otro') => ({ quantity, ingredient: { group, equivalence } })

  it('divides the grams used by the grams of one equivalent, per recipe portion', () => {
    const recipe = { portions: 2, ingredients: [ingredient(60, { group: 'Cereales S/G', grams: 30 }), ingredient(10, { group: 'Grasas sin proteínas', grams: 5 })] }
    expect(recipeEquivalents(recipe)).toEqual({ C: 1, G_SP: 1 })
  })

  it('skips approximate ingredients and ingredients without an equivalent weight', () => {
    const recipe = { portions: 1, ingredients: [ingredient(100, { group: 'Verduras', grams: 100, source: 'APPROX_500' }), ingredient(50, { group: 'Frutas' })] }
    expect(recipeEquivalents(recipe)).toEqual({})
  })
})

describe('recipeIngredientLines', () => {
  it('prefers the household-measure text of imported recipes', () => {
    expect(recipeIngredientLines({ ingredientsText: [' 1/2 taza de avena ', ''], ingredients: [] })).toEqual(['1/2 taza de avena'])
  })

  it('falls back to the linked catalog ingredients', () => {
    expect(recipeIngredientLines({ ingredients: [{ quantity: '40.000', unit: 'g', ingredient: { name: 'Avena' } }] })).toEqual(['40 g de Avena'])
  })
})

describe('buildMealOptions', () => {
  const entry = (overrides) => ({ dayOfWeek: 1, mealType: 'breakfast', recipeId: 'r1', recipeName: 'Avena', servings: 1, equivalents: {}, ...overrides })

  it('lists each distinct recipe of a meal once, in day order', () => {
    const rows = buildMealOptions([
      entry({ dayOfWeek: 3, recipeId: 'r2', recipeName: 'Huevo' }),
      entry({ dayOfWeek: 1 }),
      entry({ dayOfWeek: 2 }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].options.map((option) => option.recipeName)).toEqual(['Avena', 'Huevo'])
  })

  it('takes the meal portions from its first option, rounded to halves', () => {
    const rows = buildMealOptions([entry({ equivalents: { C: 1.8, F: 0.2, V: 0.3 } })])
    expect(rows[0].portions.map((portion) => [portion.code, portion.quantity])).toEqual([['V', 0.5], ['C', 2]])
  })

  it('omits meals without recipes', () => {
    expect(buildMealOptions([entry({ mealType: 'dinner' })]).map((row) => row.mealType)).toEqual(['dinner'])
  })
})

describe('readImageInfo', () => {
  const png = (width, height) => { const buffer = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer); buffer.writeUInt32BE(13, 8); buffer.write('IHDR', 12, 'latin1'); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20); return buffer }
  const jpeg = (width, height) => { const buffer = Buffer.alloc(40); Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).copy(buffer); Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]).copy(buffer, 20); buffer.writeUInt16BE(height, 25); buffer.writeUInt16BE(width, 27); return buffer }

  it('reads the real type and size of PNG and JPEG files', () => {
    expect(readImageInfo(png(800, 600))).toEqual({ ext: 'png', width: 800, height: 600 })
    expect(readImageInfo(jpeg(1024, 768))).toEqual({ ext: 'jpg', width: 1024, height: 768 })
  })

  it('rejects anything that is not a well-formed JPG or PNG', () => {
    expect(readImageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull()
    expect(readImageInfo(Buffer.alloc(64))).toBeNull()
    expect(readImageInfo(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull()
  })
})
