import { PrismaClient } from '@prisma/client'
import { RECIPES } from './data/recetas-dietocalculo.js'

// Loads the ~70 real recipes from the nutritionist's own working spreadsheet
// (DIETOCALCULO.xlsx, sheet "Recetas") into the Recipe/RecipeIngredient tables.
//
// Unlike the SMAE catalog (fase 14), this sheet has no structured columns — every recipe is a
// single free-text cell mixing name, ingredient list and preparation with inconsistent bullets,
// brand names and units. There is no reliable way to parse that programmatically without real
// risk of silently wrong nutrition data, so each recipe below was read and interpreted by hand:
// `ingredients` is the resulting best-effort structured list (ingredient name to search for in
// the catalog + quantity in grams), used only to calculate nutrition; `instructions` keeps the
// original text close to verbatim so the nutritionist can compare against the source. Quantities
// came from, in order of preference: (1) grams stated explicitly in the text, (2) the matched
// SMAE ingredient's own equivalence serving (e.g. "2 rebanadas" of a bread whose SMAE serving is
// "1 rebanada = 25 g" -> 50 g), (3) a standard conversion (1 cda ~15 g, 1 cdita ~5 g, 1 huevo
// ~44 g, 1 clara ~33 g). Pure seasoning/garnish "al gusto" items (sal, salsas, especias) were
// left out of the structured list on purpose — same convention SMAE itself uses for its
// "Libres en energía" group — and are still visible in `instructions`.
//
// Usage: node prisma/import-recetas.js [practiceId]
// Idempotent-ish: matches existing recipes by name and replaces their ingredients instead of
// creating duplicates on re-run.

const prisma = new PrismaClient()
const practiceId = process.argv[2] || '00000000-0000-0000-0000-000000000001'

// A handful of items from the recipes have no real match in the SMAE catalog (checked against
// the imported 2,915 items). Hand-authored here with realistic per-100g values, same convention
// as the rest of the hand-authored catalog (see prisma/seed.js).
const FALLBACK_INGREDIENTS = [
  { name: 'Yogur griego sin azúcar', group: 'Leche descremada', unit: 'gramos', nutrition: { kcal: 59, protein: 10, carbs: 3.6, fat: 0.4, calcium: 110 } },
  { name: 'Leche de coco baja en calorías', group: 'Grasas sin proteínas', unit: 'ml', nutrition: { kcal: 19, protein: 0.2, carbs: 3, fat: 0.5 } },
  { name: 'Chorizo vegano', group: 'Grasas con proteínas', unit: 'gramos', nutrition: { kcal: 180, protein: 16, carbs: 6, fat: 11 } },
]

async function findIngredient(query) {
  return prisma.ingredient.findFirst({ where: { practiceId, name: { contains: query, mode: 'insensitive' } }, orderBy: { name: 'asc' } })
}

async function ensureFallbackIngredients() {
  for (const item of FALLBACK_INGREDIENTS) {
    const existing = await prisma.ingredient.findFirst({ where: { practiceId, name: item.name } })
    if (!existing) await prisma.ingredient.create({ data: { practiceId, ...item } })
  }
}

async function main() {
  await ensureFallbackIngredients()

  const misses = []
  let createdCount = 0
  let updatedCount = 0

  for (const recipe of RECIPES) {
    const resolved = []
    for (const line of recipe.ingredients) {
      const ingredient = await findIngredient(line.query)
      if (!ingredient) { misses.push(`${recipe.name}: "${line.query}"`); continue }
      resolved.push({ ingredientId: ingredient.id, quantity: line.grams, unit: 'g', equivalence: null })
    }
    if (!resolved.length) { misses.push(`${recipe.name}: SIN INGREDIENTES RESUELTOS, se omite`); continue }

    const existing = await prisma.recipe.findFirst({ where: { practiceId, name: recipe.name } })
    let saved
    if (existing) {
      await prisma.recipeIngredient.deleteMany({ where: { recipeId: existing.id } })
      saved = await prisma.recipe.update({ where: { id: existing.id }, data: { mealTypes: [recipe.mealType], instructions: recipe.instructions, ingredients: { create: resolved } }, include: { ingredients: { include: { ingredient: true } } } })
      updatedCount += 1
    } else {
      saved = await prisma.recipe.create({ data: { practiceId, name: recipe.name, mealTypes: [recipe.mealType], portions: 1, instructions: recipe.instructions, nutrition: {}, restrictions: [], ingredients: { create: resolved } }, include: { ingredients: { include: { ingredient: true } } } })
      createdCount += 1
    }

    const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0, vitaminA: 0, vitaminC: 0, folicAcid: 0, calcium: 0, iron: 0, vitaminD: 0, vitaminE: 0, vitaminK: 0, vitaminB12: 0, zinc: 0, iodine: 0, selenium: 0 }
    for (const item of saved.ingredients) {
      const nutrition = item.ingredient.nutrition || {}
      const factor = Number(item.quantity) / 100
      for (const key of Object.keys(totals)) totals[key] += Number(nutrition[key] || 0) * factor
    }
    const nutrition = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value * 10) / 10]))
    await prisma.recipe.update({ where: { id: saved.id }, data: { nutrition, version: { increment: 1 } } })
  }

  console.log(`Recetas: ${createdCount} nuevas, ${updatedCount} actualizadas.`)
  if (misses.length) {
    console.log(`\nIngredientes sin match (${misses.length}), revisar a mano:`)
    for (const miss of misses) console.log(' -', miss)
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
