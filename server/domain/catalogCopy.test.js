import { describe, expect, it } from 'vitest'
import { copyCatalog, ingredientCopy, recipeCopy } from './catalogCopy.js'

describe('copia del catálogo para una cuenta nueva', () => {
  it('no comparte fotos subidas a mano, que se borran del disco al cambiarlas', () => {
    expect(recipeCopy({ name: 'A', imageFile: 'u-123.jpg' }, 'p2').imageFile).toBeNull()
    expect(recipeCopy({ name: 'B', imageFile: 'recetario-12.jpg' }, 'p2').imageFile).toBe('recetario-12.jpg')
    expect(ingredientCopy({ name: 'C', imageFile: 'x.jpg' }, 'p2')).not.toHaveProperty('imageFile')
  })

  it('copia ingredientes, libro SMAE y recetas importadas, con los ingredientes de cada receta reenlazados', async () => {
    const created = { ingredient: [], smaeFood: [], recipe: [], recipeIngredient: [] }
    const delegate = (name, rows) => ({ findMany: async () => rows, createMany: async ({ data }) => { created[name].push(...data) } })
    const tx = {
      ingredient: delegate('ingredient', [{ id: 'i1', name: 'Avena', group: 'Cereales', unit: 'g', nutrition: {}, imageFile: 'u-1.jpg' }, { id: 'i2', name: 'Fresa', group: 'Frutas', unit: 'g', nutrition: {} }]),
      smaeFood: delegate('smaeFood', [{ id: 's1', edition: '5', page: 1, row: 1, group: 'Frutas', name: 'Fresa', nutrients: {} }]),
      recipe: delegate('recipe', [{ id: 'r1', name: 'Avena con fresa', source: 'recetario-nut', ingredients: [{ ingredientId: 'i1', quantity: 40, unit: 'g' }, { ingredientId: 'i2', quantity: 100, unit: 'g' }, { ingredientId: 'archivado', quantity: 1, unit: 'g' }] }]),
      recipeIngredient: delegate('recipeIngredient', []),
    }
    const counts = await copyCatalog(tx, 'p1', 'p2')
    expect(counts).toEqual({ ingredients: 2, smaeFoods: 1, recipes: 1, recipeIngredients: 2 })
    expect(created.ingredient.every((row) => row.practiceId === 'p2' && row.id !== 'i1' && row.id !== 'i2')).toBe(true)
    expect(created.smaeFood[0]).toMatchObject({ practiceId: 'p2', page: 1, row: 1 })
    expect(created.smaeFood[0]).not.toHaveProperty('id')
    const recipeId = created.recipe[0].id
    const newIds = new Set(created.ingredient.map((row) => row.id))
    expect(created.recipeIngredient.every((row) => row.recipeId === recipeId && newIds.has(row.ingredientId))).toBe(true)
  })
})
