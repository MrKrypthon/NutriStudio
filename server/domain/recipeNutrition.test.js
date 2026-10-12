import { describe, expect, it } from 'vitest'
import { RECIPE_NUTRITION_KEYS, perServingFromIngredients } from './recipeNutrition.js'
import { computeMicronutrientAdequacy } from './micronutrients.js'

const ingredients = [
  { quantity: 200, ingredient: { nutrition: { kcal: 100, protein: 10, carbs: 5, fat: 2, iron: 2, calcium: 50 } } },
  { quantity: 50, ingredient: { nutrition: { kcal: 400, protein: 0, carbs: 100, fat: 0, vitaminC: 20 } } },
]

describe('perServingFromIngredients', () => {
  it('scales per-100 g values by the grams used and divides by the portions', () => {
    const perServing = perServingFromIngredients(ingredients, 2)
    expect(perServing.kcal).toBe(200)
    expect(perServing.protein).toBe(10)
    expect(perServing.carbs).toBe(30)
  })

  it('carries the micronutrients too, not only the macros', () => {
    const perServing = perServingFromIngredients(ingredients, 2)
    expect(Object.keys(perServing)).toEqual(RECIPE_NUTRITION_KEYS)
    expect(perServing.iron).toBe(2)
    expect(perServing.calcium).toBe(50)
    expect(perServing.vitaminC).toBe(5)
  })

  it('treats missing portions and missing nutrition as 1 portion and zero', () => {
    expect(perServingFromIngredients([{ quantity: 100, ingredient: {} }], null).kcal).toBe(0)
    expect(perServingFromIngredients(null, 0).kcal).toBe(0)
  })
})

describe('adequacy of an imported recipe', () => {
  // Una receta importada guarda los macros del libro en `nutrition` y el cálculo SMAE en
  // `calculatedNutrition`, que es lo que lee la adecuación: si ese cálculo no trae micronutrientes,
  // todo el plan sale en 0 %.
  it('reads the micronutrients of the calculated nutrition', () => {
    const recipe = { nutrition: { kcal: 220, protein: 15, carbs: 25, fat: 5, fiber: 3 }, calculatedNutrition: perServingFromIngredients(ingredients, 1) }
    const adequacy = computeMicronutrientAdequacy([{ dayOfWeek: 1, mealType: 'lunch', recipeId: 'r1', servings: 1, recipe }], 38, 'Mujer')
    const iron = adequacy.nutrients.find((nutrient) => nutrient.key === 'iron')
    expect(iron.value).toBeGreaterThan(0)
    expect(iron.percent).toBeGreaterThan(0)
  })
})
