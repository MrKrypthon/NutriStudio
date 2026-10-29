// Asigna una identidad estable (`catalogId`) a las recetas e ingredientes del catálogo y a sus
// copias en cada consultorio. También marca como modificadas las copias que ya no coinciden con la
// base, para que la primera publicación del admin no las sobrescriba sin avisar.
//
//   node prisma/tools/backfill-catalog-ids.js          → sólo informa
//   node prisma/tools/backfill-catalog-ids.js --write  → guarda
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { catalogRecipeWhere } from '../../server/domain/catalogCopy.js'
import { recipeContentSignature } from '../../server/domain/catalogPublish.js'

const prisma = new PrismaClient()
const write = process.argv.includes('--write')
const catalogId = process.env.CATALOG_PRACTICE_ID || process.env.DEFAULT_PRACTICE_ID || '00000000-0000-0000-0000-000000000001'
const key = (recipe) => `${recipe.source ?? ''}\u0000${recipe.name}`
const ingredientKey = (ingredient) => `${ingredient.name}\u0000${ingredient.group}`

async function main() {
  const baseRecipes = await prisma.recipe.findMany({
    where: catalogRecipeWhere(catalogId),
    include: { ingredients: { include: { ingredient: true } } },
  })
  let baseAssigned = 0
  for (const recipe of baseRecipes) {
    if (!recipe.catalogId) {
      recipe.catalogId = randomUUID()
      baseAssigned += 1
    }
    // Las recetas que ya existían se consideran publicadas en su versión actual: sólo los cambios
    // posteriores del admin deben aparecer como "sin publicar".
    if (!recipe.catalogSyncedAt) recipe.catalogSyncedAt = recipe.updatedAt
    if (write) await prisma.recipe.update({ where: { id: recipe.id }, data: { catalogId: recipe.catalogId, catalogSyncedAt: recipe.catalogSyncedAt } })
    for (const item of recipe.ingredients) {
      if (item.ingredient.catalogId) continue
      item.ingredient.catalogId = randomUUID()
      if (write) await prisma.ingredient.update({ where: { id: item.ingredient.id }, data: { catalogId: item.ingredient.catalogId } })
    }
  }
  const byKey = new Map(baseRecipes.map((recipe) => [key(recipe), recipe]))
  const baseIngredients = await prisma.ingredient.findMany({ where: { practiceId: catalogId, catalogId: { not: null } }, select: { name: true, group: true, catalogId: true } })
  const ingredientIds = new Map(baseIngredients.map((item) => [ingredientKey(item), item.catalogId]))

  const practices = await prisma.practice.findMany({ where: { id: { not: catalogId } }, select: { id: true, name: true } })
  let copiesLinked = 0
  let copiesMarked = 0
  let ingredientsLinked = 0
  for (const practice of practices) {
    const [recipes, ingredients] = await Promise.all([
      prisma.recipe.findMany({ where: { practiceId: practice.id }, include: { ingredients: { include: { ingredient: true } } } }),
      prisma.ingredient.findMany({ where: { practiceId: practice.id }, select: { id: true, name: true, group: true, catalogId: true } }),
    ])
    for (const recipe of recipes) {
      if (recipe.catalogId) continue
      const base = byKey.get(key(recipe))
      if (!base) continue
      const same = recipeContentSignature(recipe) === recipeContentSignature(base)
      copiesLinked += 1
      if (!same) copiesMarked += 1
      if (write) {
        await prisma.recipe.update({ where: { id: recipe.id }, data: { catalogId: base.catalogId, ...(same ? { catalogSyncedAt: base.catalogSyncedAt } : { catalogCustomizedAt: new Date() }) } })
      }
    }
    const localByName = new Map(ingredients.map((item) => [ingredientKey(item), item]))
    for (const [localKey, local] of localByName) {
      if (local.catalogId) continue
      const sharedId = ingredientIds.get(localKey)
      if (!sharedId) continue
      ingredientsLinked += 1
      if (write) await prisma.ingredient.update({ where: { id: local.id }, data: { catalogId: sharedId } })
    }
  }
  console.log(`[catálogo] recetas base con id nuevo: ${baseAssigned}${write ? '' : ' (sin --write no se guardó)'}`)
  console.log(`[catálogo] copias vinculadas: ${copiesLinked}; marcadas como modificadas: ${copiesMarked}; ingredientes vinculados: ${ingredientsLinked}`)
  console.log(`[catálogo] ${practices.length} consultorio(s) revisado(s).`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
