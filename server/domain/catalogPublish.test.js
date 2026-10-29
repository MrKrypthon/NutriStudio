import { describe, expect, it } from 'vitest'
import { recipeContentSignature } from './catalogPublish.js'

const recipe = (overrides = {}) => ({
  name: 'Avena con fresa',
  mealTypes: ['breakfast'],
  portions: 1,
  instructions: 'Mezclar.',
  ingredientsText: ['1 taza de avena'],
  timeMinutes: 10,
  ingredients: [
    { quantity: 40, unit: 'g', ingredient: { name: 'Avena', group: 'Cereales' } },
    { quantity: 100, unit: 'g', ingredient: { name: 'Fresa', group: 'Frutas' } },
  ],
  ...overrides,
})

describe('recipeContentSignature', () => {
  it('ignores ids y el orden de los ingredientes', () => {
    const reordered = recipe({ ingredients: [...recipe().ingredients].reverse().map((item) => ({ ...item, ingredient: { ...item.ingredient } })) })
    expect(recipeContentSignature(reordered)).toBe(recipeContentSignature(recipe()))
  })

  it('cambia cuando se edita el nombre, la preparación o una cantidad', () => {
    expect(recipeContentSignature(recipe({ name: 'Otra' }))).not.toBe(recipeContentSignature(recipe()))
    expect(recipeContentSignature(recipe({ instructions: 'Hornear.' }))).not.toBe(recipeContentSignature(recipe()))
    expect(recipeContentSignature(recipe({ ingredients: [{ quantity: 50, unit: 'g', ingredient: { name: 'Avena', group: 'Cereales' } }] }))).not.toBe(recipeContentSignature(recipe()))
  })

  it('trata los ingredientes de texto libre como parte del contenido', () => {
    expect(recipeContentSignature(recipe({ ingredients: [], ingredientsText: ['Otra línea'] }))).not.toBe(recipeContentSignature(recipe()))
  })
})
