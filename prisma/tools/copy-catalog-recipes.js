// Agrega a las cuentas que ya existen las recetas del catálogo que les faltan (por nombre), con sus
// ingredientes reenlazados a los de cada cuenta (mismo nombre y grupo). Sirve cuando el catálogo
// creció después de abrirse la cuenta, p. ej. las recetas del DIETOCÁLCULO, que antes no se
// repartían (ver server/domain/catalogCopy.js). No toca las recetas que la cuenta ya tiene.
//
//   node prisma/tools/copy-catalog-recipes.js [practiceId]          → sólo informa qué agregaría
//   node prisma/tools/copy-catalog-recipes.js [practiceId] --write  → guarda
//
// Sin practiceId recorre todas las prácticas menos la del catálogo (CATALOG_PRACTICE_ID).
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { catalogRecipeWhere, recipeCopy } from '../../server/domain/catalogCopy.js'

const prisma = new PrismaClient()
const write = process.argv.includes('--write')
const onlyPracticeId = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
const catalogId = process.env.CATALOG_PRACTICE_ID || process.env.DEFAULT_PRACTICE_ID || '00000000-0000-0000-0000-000000000001'
const ingredientKey = (ingredient) => `${ingredient.name}\u0000${ingredient.group}`

const main = async () => {
  const catalogRecipes = await prisma.recipe.findMany({ where: catalogRecipeWhere(catalogId), include: { ingredients: { include: { ingredient: { select: { name: true, group: true } } } } } })
  const practices = await prisma.practice.findMany({ where: onlyPracticeId ? { id: onlyPracticeId } : { id: { not: catalogId } }, select: { id: true, name: true } })
  if (onlyPracticeId && !practices.length) throw new Error(`No existe la práctica ${onlyPracticeId}.`)

  for (const practice of practices) {
    const [existing, ingredients] = await Promise.all([
      prisma.recipe.findMany({ where: { practiceId: practice.id }, select: { name: true } }),
      prisma.ingredient.findMany({ where: { practiceId: practice.id, status: 'ACTIVE' }, select: { id: true, name: true, group: true } }),
    ])
    const names = new Set(existing.map((recipe) => recipe.name))
    const ingredientIds = new Map()
    for (const ingredient of ingredients) if (!ingredientIds.has(ingredientKey(ingredient))) ingredientIds.set(ingredientKey(ingredient), ingredient.id)

    const recipeRows = []
    const recipeIngredientRows = []
    let unlinked = 0
    for (const recipe of catalogRecipes.filter((item) => !names.has(item.name))) {
      const row = recipeCopy(recipe, practice.id)
      recipeRows.push(row)
      for (const item of recipe.ingredients) {
        const ingredientId = ingredientIds.get(ingredientKey(item.ingredient))
        if (ingredientId) recipeIngredientRows.push({ recipeId: row.id, ingredientId, quantity: item.quantity, unit: item.unit, equivalence: item.equivalence })
        else unlinked += 1
      }
    }

    if (write && recipeRows.length) {
      await prisma.$transaction(async (tx) => {
        await tx.recipe.createMany({ data: recipeRows })
        if (recipeIngredientRows.length) await tx.recipeIngredient.createMany({ data: recipeIngredientRows })
      }, { timeout: 120000 })
    }
    console.log(`[recetas] ${practice.name}: ${recipeRows.length} ${write ? 'agregadas' : 'se agregarían'} (${recipeIngredientRows.length} ingredientes enlazados${unlinked ? `, ${unlinked} sin ingrediente equivalente en la cuenta` : ''})`)
  }
  if (!write) console.log('[recetas] Sin --write no se guardó nada.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
