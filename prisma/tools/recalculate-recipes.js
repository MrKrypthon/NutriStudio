// Recalcula `calculatedNutrition` de las recetas importadas a partir de los ingredientes que ya
// tienen vinculados, sin tocar los vínculos (a diferencia de link-smae.js, que los vuelve a crear
// desde el recetario y pisaría los que se hayan corregido a mano en la app).
//
//   node prisma/tools/recalculate-recipes.js          → sólo informa qué cambiaría
//   node prisma/tools/recalculate-recipes.js --write  → guarda
//
// `nutrition` (los valores originales del libro) no se modifica.
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { perServingFromIngredients } from '../../server/domain/recipeNutrition.js'

const prisma = new PrismaClient()
const write = process.argv.includes('--write')

const main = async () => {
  const recipes = await prisma.recipe.findMany({ where: { source: { not: null }, ingredients: { some: {} } }, include: { ingredients: { include: { ingredient: true } } } })
  let changed = 0
  let macrosMoved = 0
  for (const recipe of recipes) {
    const next = perServingFromIngredients(recipe.ingredients, recipe.portions)
    const current = recipe.calculatedNutrition || {}
    if (JSON.stringify(current) === JSON.stringify(next)) continue
    changed += 1
    // Los macros ya guardados deberían coincidir: si no, el cambio es más que agregar claves.
    if (['kcal', 'protein', 'carbs', 'fat'].some((key) => current[key] !== undefined && Math.abs(Number(current[key]) - next[key]) > 0.11)) macrosMoved += 1
    if (write) await prisma.recipe.update({ where: { id: recipe.id }, data: { calculatedNutrition: next, calculationUpdatedAt: new Date() } })
  }
  console.log(`[recalculate] ${recipes.length} recetas importadas con ingredientes · ${changed} ${write ? 'actualizadas' : 'cambiarían'} · ${macrosMoved} con macros distintos a los guardados${write ? '' : ' · (sin --write no se guardó nada)'}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
