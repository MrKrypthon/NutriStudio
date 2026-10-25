// Catálogo inicial de una cuenta nueva (fase 109). Los alimentos, el libro SMAE y las recetas
// viven por práctica (cada nutriólogo los puede corregir sin afectar a los demás), así que una
// cuenta nueva arranca con una copia de los de la práctica base (CATALOG_PRACTICE_ID, por defecto
// la práctica de siempre).
//
// Se copian sólo los datos de catálogo, nunca pacientes ni nada clínico:
//   - ingredientes activos (SMAE, base de alimentos y los agregados a mano),
//   - el libro SMAE completo, con sus correcciones,
//   - las recetas importadas de recetarios (`source` con valor) y las de la hoja «Recetas» de
//     DIETOCALCULO.xlsx (sin `source`, se reconocen por nombre), con sus ingredientes.
// Las demás recetas propias de la práctica base (`source` vacío, hechas en la app) no se reparten.
//
// Las fotos subidas a mano (`u-…` en recetas, todas las de ingredientes) se borran del disco al
// cambiarlas o quitarlas; compartir ese archivo entre cuentas haría que una le borrara la foto a
// otra, así que la copia no las lleva. Las fotos de los recetarios importados no se borran nunca y
// sí se comparten.
import { randomUUID } from 'node:crypto'
import { DIETOCALCULO_RECIPE_NAMES } from '../../prisma/data/recetas-dietocalculo.js'

const CHUNK = 500

// Recetas de la práctica base que reparte el catálogo.
export const catalogRecipeWhere = (practiceId) => ({
  practiceId,
  status: 'ACTIVE',
  OR: [{ source: { not: null } }, { source: null, name: { in: DIETOCALCULO_RECIPE_NAMES } }],
})

export const ingredientCopy = (ingredient, practiceId, id = randomUUID()) => ({
  id,
  practiceId,
  name: ingredient.name,
  group: ingredient.group,
  unit: ingredient.unit,
  nutrition: ingredient.nutrition,
  equivalence: ingredient.equivalence ?? undefined,
  status: 'ACTIVE',
})

export const smaeFoodCopy = (food, practiceId) => ({
  practiceId,
  edition: food.edition,
  page: food.page,
  row: food.row,
  group: food.group,
  name: food.name,
  qty: food.qty,
  qtyText: food.qtyText,
  unit: food.unit,
  nutrients: food.nutrients,
  review: food.review ?? undefined,
  corrections: food.corrections ?? undefined,
})

export const recipeCopy = (recipe, practiceId, id = randomUUID()) => ({
  id,
  practiceId,
  name: recipe.name,
  mealTypes: recipe.mealTypes,
  portions: recipe.portions,
  instructions: recipe.instructions,
  nutrition: recipe.nutrition,
  restrictions: recipe.restrictions,
  imageUrl: recipe.imageUrl,
  ingredientsText: recipe.ingredientsText ?? undefined,
  timeMinutes: recipe.timeMinutes,
  imageFile: recipe.imageFile?.startsWith('u-') ? null : recipe.imageFile,
  source: recipe.source,
  calculatedNutrition: recipe.calculatedNutrition ?? undefined,
  calculationUpdatedAt: recipe.calculationUpdatedAt,
})

async function createInChunks(delegate, rows) {
  for (let i = 0; i < rows.length; i += CHUNK) await delegate.createMany({ data: rows.slice(i, i + CHUNK) })
}

/**
 * Copia el catálogo de `fromPracticeId` a `toPracticeId` dentro de la transacción `tx`. Devuelve
 * cuántos renglones copió de cada tipo.
 */
export async function copyCatalog(tx, fromPracticeId, toPracticeId) {
  const [ingredients, smaeFoods, recipes] = await Promise.all([
    tx.ingredient.findMany({ where: { practiceId: fromPracticeId, status: 'ACTIVE' } }),
    tx.smaeFood.findMany({ where: { practiceId: fromPracticeId } }),
    tx.recipe.findMany({ where: catalogRecipeWhere(fromPracticeId), include: { ingredients: true } }),
  ])

  const ingredientIds = new Map()
  const ingredientRows = ingredients.map((ingredient) => {
    const row = ingredientCopy(ingredient, toPracticeId)
    ingredientIds.set(ingredient.id, row.id)
    return row
  })
  const recipeRows = []
  const recipeIngredientRows = []
  for (const recipe of recipes) {
    const row = recipeCopy(recipe, toPracticeId)
    recipeRows.push(row)
    for (const item of recipe.ingredients) {
      const ingredientId = ingredientIds.get(item.ingredientId)
      // Un ingrediente archivado no se copia; la receta conserva el resto de sus renglones.
      if (ingredientId) recipeIngredientRows.push({ recipeId: row.id, ingredientId, quantity: item.quantity, unit: item.unit, equivalence: item.equivalence })
    }
  }

  await createInChunks(tx.ingredient, ingredientRows)
  await createInChunks(tx.smaeFood, smaeFoods.map((food) => smaeFoodCopy(food, toPracticeId)))
  await createInChunks(tx.recipe, recipeRows)
  await createInChunks(tx.recipeIngredient, recipeIngredientRows)
  return { ingredients: ingredientRows.length, smaeFoods: smaeFoods.length, recipes: recipeRows.length, recipeIngredients: recipeIngredientRows.length }
}
