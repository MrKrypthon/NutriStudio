import { describe, expect, it } from 'vitest'
import { resolveIdrBracket, averageDailyMicronutrients, computeMicronutrientAdequacy } from './micronutrients.js'

describe('resolveIdrBracket', () => {
  it('maps age + sex to the matching bracket', () => {
    expect(resolveIdrBracket(2, 'Femenino')).toBe('children')
    expect(resolveIdrBracket(16, 'Masculino')).toBe('male_teen')
    expect(resolveIdrBracket(16, 'Femenino')).toBe('female_teen')
    expect(resolveIdrBracket(35, 'male')).toBe('male_adult')
    expect(resolveIdrBracket(35, 'female')).toBe('female_adult')
    expect(resolveIdrBracket(75, 'Masculino')).toBe('male_senior')
    expect(resolveIdrBracket(75, 'Femenino')).toBe('female_senior')
  })

  it('returns null for ages that fall in the gaps left by the source table', () => {
    expect(resolveIdrBracket(8, 'Femenino')).toBeNull()
  })

  it('returns null when age is missing or not a number', () => {
    expect(resolveIdrBracket(null, 'Femenino')).toBeNull()
    expect(resolveIdrBracket(undefined, 'Femenino')).toBeNull()
  })
})

describe('averageDailyMicronutrients', () => {
  const slot = (overrides) => ({ dayOfWeek: 1, servings: 1, recipe: { nutrition: { fiber: 10, vitaminA: 100, vitaminC: 20, folicAcid: 50, calcium: 200, iron: 2 } }, ...overrides })

  it('skips slots without an assigned recipe', () => {
    const result = averageDailyMicronutrients([slot(), slot({ dayOfWeek: 2, recipe: null })])
    expect(result.fiber).toBe(10)
  })

  it('sums same-day slots before averaging across days', () => {
    const result = averageDailyMicronutrients([slot({ dayOfWeek: 1 }), slot({ dayOfWeek: 1 }), slot({ dayOfWeek: 2 })])
    // day 1 = 20, day 2 = 10 -> average 15
    expect(result.fiber).toBe(15)
  })

  it('multiplies by servings', () => {
    const result = averageDailyMicronutrients([slot({ servings: 2 })])
    expect(result.fiber).toBe(20)
  })

  it('returns null when there are no assigned recipes', () => {
    expect(averageDailyMicronutrients([slot({ recipe: null })])).toBeNull()
  })
})

describe('computeMicronutrientAdequacy', () => {
  const slot = (overrides) => ({ dayOfWeek: 1, servings: 1, recipe: { nutrition: { fiber: 15, vitaminA: 450, vitaminC: 45, folicAcid: 200, calcium: 400, iron: 5 } }, ...overrides })

  it('returns percent adequacy per nutrient for a resolvable bracket', () => {
    const result = computeMicronutrientAdequacy([slot()], 35, 'female')
    expect(result.bracket).toBe('female_adult')
    const calcium = result.nutrients.find((n) => n.key === 'calcium')
    expect(calcium.target).toBe(800)
    expect(calcium.value).toBe(400)
    expect(calcium.percent).toBe(50)
  })

  it('omits nutrients with no reference value for that bracket (e.g. fiber for most adults)', () => {
    const result = computeMicronutrientAdequacy([slot()], 35, 'male')
    expect(result.nutrients.find((n) => n.key === 'fiber')).toBeUndefined()
  })

  it('returns an empty nutrient list when the age has no matching bracket', () => {
    const result = computeMicronutrientAdequacy([slot()], 8, 'female')
    expect(result.bracket).toBeNull()
    expect(result.nutrients).toEqual([])
  })

  it('returns an empty nutrient list when the plan has no assigned recipes yet', () => {
    const result = computeMicronutrientAdequacy([], 35, 'female')
    expect(result.bracket).toBe('female_adult')
    expect(result.nutrients).toEqual([])
  })
})
