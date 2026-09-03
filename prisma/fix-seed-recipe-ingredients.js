// One-off migration: give the three seed recipes that were created with hand-typed nutrition
// values (no real ingredients) real ingredients from the SMAE catalog, so they stop being at
// risk of collapsing to 0 kcal the next time something recalculates them (see
// ESTADO_Y_PENDIENTES.md, deuda técnica de fase 30). Safe to re-run: it skips a recipe if it
// already has ingredients linked.
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'

const prisma = new PrismaClient()

const RECIPE_INGREDIENTS = {
  'Bowl de bistec con champiñones': [
    ['Bistec de res', 'AOA MBAG', 150, 5],
    ['Papa cocida', 'Cereales S/G', 150, 1],
    ['Champiñón blanco crudo', 'Base de alimentos', 100, 1],
    ['Aceite de oliva', 'Grasas sin proteínas', 15, 3],
  ],
  'Yogur griego con fruta': [
    ['Yogur griego sin azúcar', 'Leche descremada', 200, 2],
    ['Fresa cruda', 'Base de alimentos', 100, 1],
    ['Granola estándar', 'Cereales C/G', 10, 0.5],
  ],
  'Ensalada tibia de espinacas': [
    ['Espinaca cruda', 'Verduras', 150, 1.5],
    ['Queso panela', 'Lácteos', 80, 1],
    ['Jitomate bola', 'Verduras', 100, 1],
    ['Papa cocida', 'Cereales S/G', 40, 0.5],
    ['Aceite de oliva', 'Grasas sin proteínas', 5, 1],
  ],
}

const RECIPE_NUTRITION_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'vitaminA', 'vitaminC', 'folicAcid', 'calcium', 'iron', 'vitaminD', 'vitaminE', 'vitaminK', 'vitaminB12', 'zinc', 'iodine', 'selenium']
const emptyNutritionTotals = () => Object.fromEntries(RECIPE_NUTRITION_KEYS.map((key) => [key, 0]))

async function main() {
  const practice = await prisma.practice.findFirst()
  for (const [recipeName, ingredients] of Object.entries(RECIPE_INGREDIENTS)) {
    const recipe = await prisma.recipe.findFirst({ where: { practiceId: practice.id, name: recipeName }, include: { ingredients: true } })
    if (!recipe) { console.log(`SKIP (no existe): ${recipeName}`); continue }
    if (recipe.ingredients.length) { console.log(`SKIP (ya tiene ingredientes): ${recipeName}`); continue }

    const rows = []
    for (const [name, group, quantity, equivalence] of ingredients) {
      const ingredient = await prisma.ingredient.findFirst({ where: { practiceId: practice.id, name, group } })
      if (!ingredient) { console.log(`  falta en catálogo: ${name} (${group})`); continue }
      rows.push({ ingredientId: ingredient.id, quantity, unit: 'g', equivalence })
    }
    if (!rows.length) { console.log(`SKIP (ningún ingrediente encontrado): ${recipeName}`); continue }

    await prisma.recipe.update({ where: { id: recipe.id }, data: { ingredients: { create: rows } } })

    const withIngredients = await prisma.recipe.findFirst({ where: { id: recipe.id }, include: { ingredients: { include: { ingredient: true } } } })
    const totals = emptyNutritionTotals()
    for (const item of withIngredients.ingredients) {
      const nutrition = item.ingredient.nutrition || {}
      const factor = Number(item.quantity) / 100
      for (const key of Object.keys(totals)) totals[key] += Number(nutrition[key] || 0) * factor
    }
    const servings = Number(recipe.portions || 1)
    const nutrition = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round((value / servings) * 10) / 10]))
    await prisma.recipe.update({ where: { id: recipe.id }, data: { nutrition } })
    console.log(`OK: ${recipeName} -> ${rows.length} ingredientes, ${nutrition.kcal} kcal`)
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
