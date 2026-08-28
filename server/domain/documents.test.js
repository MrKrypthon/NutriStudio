import { describe, expect, it } from 'vitest'
import { buildMenuSnapshot } from './documents.js'

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
