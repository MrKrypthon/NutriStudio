import { describe, expect, it } from 'vitest'
import { avoidTermsFromText, suggestRecipes, suggestRecipesByGroups } from './recipeSuggestions.js'

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

describe('suggestRecipesByGroups', () => {
  const food = (name, group, serving, grams, nutrition) => ({ id: name, name, group, equivalence: { group, serving, grams, source: 'SMAE' }, nutrition })
  const tortilla = food('Tortilla', 'Cereales S/G', '1 pieza', 30, { kcal: 233, protein: 6.6, carbs: 50, fat: 0 })
  const pollo = food('Pollo', 'AOA MBAG', '30 g', 30, { kcal: 133, protein: 23, carbs: 0, fat: 3.3 })
  const espinaca = food('Espinaca', 'Verduras', '2 taza', 120, { kcal: 21, protein: 1.7, carbs: 3.3, fat: 0 })
  const platano = food('Plátano', 'Frutas', '1/2 pieza', 54, { kcal: 111, protein: 0, carbs: 28, fat: 0 })
  const crema = food('Crema', 'Grasas sin proteínas', '1 cda', 15, { kcal: 300, protein: 0, carbs: 0, fat: 33 })
  const make = (id, name, links, extra = {}) => ({ id, name, status: 'ACTIVE', mealTypes: ['lunch'], imageFile: `${id}.jpg`, portions: 1, nutrition: { kcal: 300 }, ingredients: links.map(([ingredient, quantity]) => ({ quantity, ingredient })), ...extra })
  // A la comida le tocan 2 cereales, 3 de origen animal y 1 verdura.
  const prescribed = { C_SG: 2, AOA_B: 3, V: 1 }
  const tacos = make('tacos', 'Tacos de pollo con espinaca', [[tortilla, 30], [pollo, 60], [espinaca, 60]])
  const quesadilla = make('ques', 'Tortillas con pollo', [[tortilla, 60], [pollo, 60]])
  const licuado = make('lic', 'Licuado de plátano con crema', [[platano, 216], [crema, 30]])
  const mixta = make('mix', 'Pollo con tortilla, espinaca y mucha crema', [[tortilla, 60], [pollo, 90], [espinaca, 120], [crema, 60]])

  it('leaves out a recipe that stays far above the energy of the meal even after fitting', () => {
    // Colación de 1 fruta (60 kcal): el plátano se ajusta, pero la crema (no asignada) la deja en ~150 kcal.
    const snack = (recipe) => ({ ...recipe, mealTypes: ['snack'] })
    const fruta = make('fruta', 'Plátano', [[platano, 108]])
    const result = suggestRecipesByGroups([snack(licuado), snack(fruta)], { recipeType: 'snack', prescribed: { F: 1 } })
    expect(result.map((item) => item.recipe.id)).toEqual(['fruta'])
  })

  it('ranks first the recipes made of the groups the meal was given', () => {
    const result = suggestRecipesByGroups([licuado, quesadilla, mixta, tacos], { recipeType: 'lunch', prescribed })
    expect(result.map((item) => item.recipe.id)).toEqual(['tacos', 'ques', 'mix'])
    expect(result[0]).toMatchObject({ coverage: 100, missing: [], extra: [] })
    expect(result[1].missing).toEqual(['V'])
    expect(result[2].extra).toEqual(['G'])
  })

  it('puts desserts and sugary recipes after the rest when the meal has no sugar portions', () => {
    const pastel = make('pastel', 'Pastel de pollo y tortilla', [[tortilla, 30], [pollo, 60], [espinaca, 60]])
    const dulce = make('dulce', 'Tortilla con pollo y espinaca', [[tortilla, 30], [pollo, 60], [espinaca, 60]], { nutrition: { kcal: 300, sugar: 20 } })
    // La quesadilla no trae verdura, pero ninguno de los dos dulces le gana.
    expect(suggestRecipesByGroups([pastel, dulce, quesadilla], { recipeType: 'lunch', prescribed }).map((item) => item.recipe.id)[0]).toBe('ques')
    // Con azúcares asignados al tiempo, el postre ya no se castiga.
    expect(suggestRecipesByGroups([pastel, quesadilla], { recipeType: 'lunch', prescribed: { ...prescribed, AZ_SG: 1 } })[0].recipe.id).toBe('pastel')
  })

  it('leaves out a recipe with the right energy but none of the groups', () => {
    expect(suggestRecipesByGroups([licuado], { recipeType: 'lunch', prescribed })).toEqual([])
  })

  it('returns the recipe already fitted to the portions of the meal', () => {
    const [best] = suggestRecipesByGroups([tacos], { recipeType: 'lunch', prescribed })
    const grams = Object.fromEntries(best.items.map((item) => [item.name, item.grams]))
    // 2 cereales = 60 g de tortilla, 3 AOA = 90 g de pollo, 1 verdura = 120 g de espinaca.
    expect(grams).toEqual({ Tortilla: 60, Pollo: 90, Espinaca: 120 })
    expect(best.kcal).toBe(285)
    expect(best.factor).toBeGreaterThan(1)
  })

  it('counts any fat level of animal protein as the same food group', () => {
    const result = suggestRecipesByGroups([tacos], { recipeType: 'lunch', prescribed: { C_CG: 2, AOA_M: 3, V: 1 } })
    expect(result[0].coverage).toBe(100)
  })

  it('respects what the patient avoids and the meal type, and needs a prescription', () => {
    expect(suggestRecipesByGroups([tacos, quesadilla], { recipeType: 'lunch', prescribed, avoid: ['espinaca'] }).map((item) => item.recipe.id)).toEqual(['ques'])
    expect(suggestRecipesByGroups([tacos], { recipeType: 'dinner', prescribed })).toEqual([])
    expect(suggestRecipesByGroups([tacos], { recipeType: 'lunch', prescribed: {} })).toEqual([])
  })
})
