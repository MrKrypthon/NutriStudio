import { describe, expect, it } from 'vitest'
import { avoidTermsFromText, suggestRecipes } from './recipeSuggestions.js'

const recipe = (id, name, kcal, extra = {}) => ({ id, name, status: 'ACTIVE', mealTypes: ['lunch'], imageFile: `${id}.jpg`, nutrition: { kcal, protein: kcal * 0.25 / 4, carbs: kcal * 0.45 / 4, fat: kcal * 0.3 / 9 }, ingredientsText: ['1 taza de arroz', '120 g de pollo'], ...extra })
const target = { kcal: 600, protein: 37.5, carbs: 67.5, fat: 20 }

describe('avoidTermsFromText', () => {
  it('pulls food word stems out of free text, without accents', () => {
    expect(avoidTermsFromText('Hígado; cacahuates, frijoles', 'Ninguna conocida')).toEqual(['higado', 'cacahuat', 'frijol'])
    expect(avoidTermsFromText('', null, undefined)).toEqual([])
  })

  it('adds the foods a recipe would name instead of the family', () => {
    const terms = avoidTermsFromText('Pescado y mariscos')
    expect(terms).toEqual(expect.arrayContaining(['pescado', 'atun', 'salmon', 'marisco', 'camaron']))
    expect(avoidTermsFromText(['Lactosa (leche entera le causa distensión)'])).toEqual(expect.arrayContaining(['lactosa', 'leche', 'queso', 'yogur']))
    expect(avoidTermsFromText('Nueces')).toEqual(expect.arrayContaining(['nuez', 'nuec', 'almendra']))
  })
})

describe('suggestRecipes', () => {
  it('prefers the recipes closest to the meal energy and reports the scaling factor', () => {
    const result = suggestRecipes([recipe('a', 'Pollo con arroz', 590), recipe('b', 'Ensalada', 150), recipe('c', 'Guisado', 400), recipe('d', 'Sopa', 300)], { recipeType: 'lunch', target })
    expect(result.map((item) => [item.recipe.id, item.factor])).toEqual([['a', 1], ['c', 1.5], ['d', 2]])
    expect(result[1].kcal).toBe(600)
  })

  it('leaves out what the patient avoids, in the name or the ingredients', () => {
    const recipes = [recipe('a', 'Filete de PESCADO empanizado', 600), recipe('b', 'Pollo', 600, { ingredientsText: ['200 g de camarón', '1 taza de arroz'] }), recipe('c', 'Guisado de res', 600)]
    expect(suggestRecipes(recipes, { recipeType: 'lunch', target, avoid: ['pescado', 'Camarón'] }).map((item) => item.recipe.id)).toEqual(['c'])
  })

  it('only offers recipes of that meal type, active, not already used, and with ingredients to show', () => {
    const recipes = [recipe('a', 'Desayuno', 600, { mealTypes: ['breakfast'] }), recipe('b', 'Archivada', 600, { status: 'ARCHIVED' }), recipe('c', 'Usada', 600), recipe('d', 'Sin ingredientes', 600, { ingredientsText: [] }), recipe('e', 'Buena', 600)]
    expect(suggestRecipes(recipes, { recipeType: 'lunch', target, exclude: ['c'] }).map((item) => item.recipe.id)).toEqual(['e'])
  })

  it('favours the macro profile of the meal and recipes with a photo', () => {
    const fatty = recipe('a', 'Muy grasosa', 600, { nutrition: { kcal: 600, protein: 10, carbs: 20, fat: 53 } })
    const balanced = recipe('b', 'Balanceada', 600)
    const noPhoto = recipe('c', 'Balanceada sin foto', 600, { imageFile: null })
    expect(suggestRecipes([fatty, noPhoto, balanced], { recipeType: 'lunch', target }).map((item) => item.recipe.id)).toEqual(['b', 'c', 'a'])
  })

  it('returns nothing without a calculated target', () => {
    expect(suggestRecipes([recipe('a', 'Pollo', 600)], { recipeType: 'lunch', target: { kcal: 0 } })).toEqual([])
    expect(suggestRecipes(null, { target })).toEqual([])
  })
})
