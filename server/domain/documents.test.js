import { describe, expect, it } from 'vitest'
import { buildMealOptions, buildMenuSnapshot, equivalentGroupCode, recipeEquivalents, recipeIngredientLines, sanitizeJpeg, normalizeMealTimes, formatMealTime, normalizeRecipeAdjustments, applyRecipeAdjustments, adjustmentFactor } from './documents.js'

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

describe('sanitizeJpeg', () => {
  const segment = (marker, payload) => { const head = Buffer.alloc(4); head[0] = 0xff; head[1] = marker; head.writeUInt16BE(payload.length + 2, 2); return Buffer.concat([head, Buffer.from(payload)]) }
  const sof = (width, height, marker = 0xc0) => { const payload = Buffer.alloc(15); payload[0] = 8; payload.writeUInt16BE(height, 1); payload.writeUInt16BE(width, 3); payload[5] = 3; return segment(marker, payload) }
  const SOI = Buffer.from([0xff, 0xd8])
  const SCAN = Buffer.from([1, 2, 3, 0xff, 0xd9])
  const jpeg = (...segments) => Buffer.concat([SOI, ...segments, segment(0xda, [0, 0, 0]), SCAN])

  it('reads the real size and keeps the image data', () => {
    const dqt = segment(0xdb, [1, 2, 3])
    const result = sanitizeJpeg(jpeg(segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), dqt, sof(1024, 768)))
    expect(result.width).toBe(1024)
    expect(result.height).toBe(768)
    expect(result.data.subarray(-SCAN.length)).toEqual(SCAN)
    expect(result.data.includes(dqt)).toBe(true)
  })

  it('drops metadata segments (EXIF, comments) from what gets stored', () => {
    const exif = segment(0xe1, Buffer.from('Exif\0\0MM\0*datos'))
    const result = sanitizeJpeg(jpeg(exif, segment(0xfe, Buffer.from('comentario')), sof(10, 10)))
    expect(result.data.includes(Buffer.from('Exif'))).toBe(false)
    expect(result.data.includes(Buffer.from('comentario'))).toBe(false)
    // Lo primero tras el SOI ya no es un APPn: el lector de EXIF de pdfkit no tiene nada que leer.
    expect(result.data[3]).toBe(0xc0)
    // Volver a pasarlo no cambia nada.
    expect(sanitizeJpeg(result.data).data).toEqual(result.data)
  })

  it('rejects anything that is not a well-formed JPEG', () => {
    expect(sanitizeJpeg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull()
    expect(sanitizeJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]))).toBeNull()
    expect(sanitizeJpeg(Buffer.alloc(64))).toBeNull()
    expect(sanitizeJpeg(jpeg(sof(0, 768)))).toBeNull()
    expect(sanitizeJpeg(jpeg())).toBeNull()
    expect(sanitizeJpeg(Buffer.concat([SOI, sof(10, 10)]))).toBeNull()
  })

  it('rejects structures other readers could interpret differently', () => {
    // Dos SOF con tamaños distintos.
    expect(sanitizeJpeg(jpeg(sof(10, 10), sof(60000, 60000, 0xc2)))).toBeNull()
    // Relleno 0xFF entre segmentos.
    expect(sanitizeJpeg(Buffer.concat([SOI, Buffer.from([0xff]), sof(10, 10), segment(0xda, [0, 0, 0]), SCAN]))).toBeNull()
    // Segmento que declara más largo del que tiene el archivo.
    expect(sanitizeJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull()
    // Largo menor que el mínimo (un lector ingenuo se quedaría sin avanzar).
    expect(sanitizeJpeg(Buffer.concat([SOI, Buffer.from([0xff, 0xdb, 0, 0]), sof(10, 10), segment(0xda, [0, 0, 0]), SCAN]))).toBeNull()
  })
})

describe('meal times', () => {
  it('keeps only known meals with a valid 24 h time', () => {
    expect(normalizeMealTimes({ breakfast: '10:00', lunch: '25:00', snack: ' 16:30 ', dinner: '', other: '09:00' })).toEqual({ breakfast: '10:00', snack: '16:30' })
    expect(normalizeMealTimes(null)).toEqual({})
    expect(normalizeMealTimes(['10:00'])).toEqual({})
  })

  it('formats the time the way the printed plan writes it', () => {
    expect(formatMealTime('10:00')).toBe('10 am')
    expect(formatMealTime('14:30')).toBe('2:30 pm')
    expect(formatMealTime('00:00')).toBe('12 am')
    expect(formatMealTime('12:00')).toBe('12 pm')
    expect(formatMealTime('')).toBe('')
  })

  it('attaches the time to its meal row', () => {
    const rows = buildMealOptions([{ dayOfWeek: 1, mealType: 'breakfast', recipeId: 'r1', recipeName: 'Avena', servings: 1 }], { breakfast: '10:00' })
    expect(rows[0].time).toBe('10 am')
  })
})

describe('second snack', () => {
  const entry = (overrides) => ({ dayOfWeek: 1, mealType: 'snack', recipeId: 'r1', recipeName: 'Xek', servings: 1, ...overrides })

  it('is its own row between the first snack and dinner, with its own time', () => {
    const rows = buildMealOptions([
      entry({ mealType: 'dinner', recipeName: 'Cuernito' }),
      entry({ mealType: 'snack2', recipeName: 'Esquite' }),
      entry(),
    ], { snack: '16:00', snack2: '18:00' })
    expect(rows.map((row) => [row.mealType, row.label, row.time])).toEqual([['snack', 'Colación', '4 pm'], ['snack2', 'Colación', '6 pm'], ['dinner', 'Cena', '']])
  })

  it('is left out of the plan when it has no recipes', () => {
    expect(buildMealOptions([entry()]).map((row) => row.mealType)).toEqual(['snack'])
  })
})

describe('prescribed equivalents in the delivered plan', () => {
  const menu = [{ dayOfWeek: 1, mealType: 'breakfast', recipeId: 'r1', recipeName: 'Avena', servings: 1, equivalents: { C: 3, F: 1 } }, { dayOfWeek: 1, mealType: 'dinner', recipeId: 'r2', recipeName: 'Cuernito', servings: 1, equivalents: { C: 2 } }]

  it('shows what the nutritionist distributed instead of the recipe estimate', () => {
    const rows = buildMealOptions(menu, {}, { groups: {}, distribution: { breakfast: { C_SG: 1.5, C_CG: 0.5, LAC_D: 1, AZ_SG: 1 } } })
    expect(rows[0].portions.map((portion) => [portion.code, portion.quantity])).toEqual([['C', 2], ['LAC', 1], ['AZ', 1]])
  })

  it('leaves a meal without circles when the plan has a prescription but that meal got none', () => {
    const rows = buildMealOptions(menu, {}, { groups: {}, distribution: { breakfast: { V: 1 } } })
    expect(rows[1].portions).toEqual([])
  })

  it('estimates from the recipe only when the plan has no prescription at all', () => {
    const rows = buildMealOptions(menu, {}, { groups: {}, distribution: {} })
    expect(rows[1].portions.map((portion) => [portion.code, portion.quantity])).toEqual([['C', 2]])
  })
})

describe('recipe adjustments per plan', () => {
  const recipeId = '0f64b6b4-7599-4bdc-8e31-3492605d3499'
  const menu = [{ dayOfWeek: 1, mealType: 'breakfast', recipeId, recipeName: 'Avena', servings: 1, portions: 2, ingredients: ['1 taza de avena'] }, { dayOfWeek: 1, mealType: 'dinner', recipeId, recipeName: 'Avena', servings: 1, portions: 2, ingredients: ['1 taza de avena'] }]

  it('replaces the lines of that recipe only in the meal it was adjusted for', () => {
    const adjusted = applyRecipeAdjustments(menu, { [`breakfast|${recipeId}`]: { lines: ['1/2 taza de avena', ' 1 fruta '] } })
    expect(adjusted[0]).toMatchObject({ ingredients: ['1/2 taza de avena', '1 fruta'], adjusted: true })
    expect(adjusted[1].ingredients).toEqual(['1 taza de avena'])
    expect(adjusted[1].adjusted).toBeUndefined()
    // La receta original (el menú de entrada) no cambia.
    expect(menu[0].ingredients).toEqual(['1 taza de avena'])
  })

  it('drops malformed adjustments', () => {
    expect(normalizeRecipeAdjustments({ [`brunch|${recipeId}`]: { lines: ['x'] }, 'breakfast|not-an-id': { lines: ['x'] }, [`lunch|${recipeId}`]: { lines: [] }, [`dinner|${recipeId}`]: { lines: [3, '', 'ok'] } })).toEqual({ [`dinner|${recipeId}`]: { lines: ['ok'], factor: 1 } })
    expect(normalizeRecipeAdjustments(null)).toEqual({})
  })
})

describe('adjustment factor', () => {
  const recipeId = '0f64b6b4-7599-4bdc-8e31-3492605d3499'
  const adjustments = { [`lunch|${recipeId}`]: { lines: ['3 tortillas'], factor: 1.75 } }

  it('is 1 unless that recipe was adjusted in that meal, and stays within sane bounds', () => {
    expect(adjustmentFactor(adjustments, 'lunch', recipeId)).toBe(1.75)
    expect(adjustmentFactor(adjustments, 'dinner', recipeId)).toBe(1)
    expect(adjustmentFactor(null, 'lunch', recipeId)).toBe(1)
    expect(normalizeRecipeAdjustments({ [`lunch|${recipeId}`]: { lines: ['x'], factor: 999 } })[`lunch|${recipeId}`].factor).toBe(10)
    expect(normalizeRecipeAdjustments({ [`lunch|${recipeId}`]: { lines: ['x'], factor: 'abc' } })[`lunch|${recipeId}`].factor).toBe(1)
  })

  it('scales the energy and the estimated equivalents of the adjusted option', () => {
    const [entry] = applyRecipeAdjustments([{ dayOfWeek: 1, mealType: 'lunch', recipeId, recipeName: 'Quesadillas', servings: 1, kcal: 344, equivalents: { C: 2, AOA_B: 1 }, ingredients: ['2 tortillas'] }], adjustments)
    expect(entry.kcal).toBe(602)
    expect(entry.equivalents).toEqual({ C: 3.5, AOA_B: 1.75 })
  })
})

describe('adjustment limits', () => {
  it('caps valid adjustments without letting junk keys push them out', () => {
    const junk = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`junk-${index}`, { lines: ['x'] }]))
    const id = '0f64b6b4-7599-4bdc-8e31-3492605d3499'
    expect(Object.keys(normalizeRecipeAdjustments({ ...junk, [`lunch|${id}`]: { lines: ['ok'] } }))).toEqual([`lunch|${id}`])
  })
})
