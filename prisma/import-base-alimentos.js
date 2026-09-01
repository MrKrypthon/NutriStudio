import { PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Loads the BASE_ALIMENTOS sheet (174 raw foods) from the nutritionist's Excel. Unlike SMAE
// (fase 14), this sheet has no equivalence/serving columns — every value is already per 100 g,
// and it covers micronutrients SMAE doesn't (vit. D/E/K/B1/B2/B3/B6/B12, magnesium, zinc,
// potassium, sodium, iodine, selenium), which is the whole point of importing it: it unlocks
// the rest of "% Adecuación de micronutrientes" (fase 15/17) beyond fiber/vit.A/vit.C/folato/
// calcio/hierro.
//
// Strategy: where a food's name matches an existing Ingredient exactly (only ~38/174 do — most
// of this sheet is genuinely new foods, not SMAE duplicates), ADD the micronutrient keys that
// ingredient didn't already have (zinc, iodine, selenium, vitamins D/E/K/B12, thiamin,
// riboflavin, niacin, vitB6, magnesium) without touching its existing macros — those already
// came from a more precise per-equivalent SMAE source and shouldn't be overwritten. Where there's
// no match, create a new Ingredient with the full profile, source: 'BASE_ALIMENTOS'. This sheet
// has no food-group column, so new ingredients get group: 'Base de alimentos' — a catch-all,
// still searchable, just outside the 19 SMAE group filters in the UI.
//
// Usage: node prisma/import-base-alimentos.js [practiceId]

const prisma = new PrismaClient()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const practiceId = process.argv[2] || '00000000-0000-0000-0000-000000000001'

const EXTRA_KEYS = ['vitaminD', 'vitaminE', 'vitaminK', 'thiamin', 'riboflavin', 'niacin', 'vitaminB6', 'vitaminB12', 'magnesium', 'zinc', 'iodine', 'selenium']

async function main() {
  const raw = await readFile(path.join(__dirname, 'data/base-alimentos.json'), 'utf-8')
  const rows = JSON.parse(raw)

  let enriched = 0
  let created = 0

  for (const row of rows) {
    const round = (value) => Math.round(Number(value || 0) * 100) / 100
    const extra = {
      vitaminD: round(row.vitD), vitaminE: round(row.vitE), vitaminK: round(row.vitK),
      thiamin: round(row.thiamin), riboflavin: round(row.riboflavin), niacin: round(row.niacin),
      vitaminB6: round(row.vitB6), vitaminB12: round(row.vitB12), magnesium: round(row.magnesium),
      zinc: round(row.zinc), iodine: round(row.iodine), selenium: round(row.selenium),
    }

    const existing = await prisma.ingredient.findFirst({ where: { practiceId, name: row.name } })
    if (existing) {
      const nutrition = { ...extra, ...(existing.nutrition || {}) } // existing values win — don't clobber SMAE macros
      await prisma.ingredient.update({ where: { id: existing.id }, data: { nutrition } })
      enriched += 1
      continue
    }

    await prisma.ingredient.create({
      data: {
        practiceId,
        name: row.name,
        group: 'Base de alimentos',
        unit: 'gramos',
        nutrition: {
          kcal: round(row.kcal), protein: round(row.protein), carbs: round(row.carbs), fat: round(row.fat),
          fiber: round(row.fiber), sugar: round(row.sugar), sodium: round(row.sodium),
          saturatedFat: round(row.satFat), monounsaturatedFat: round(row.monoFat), polyunsaturatedFat: round(row.polyFat),
          cholesterol: round(row.cholesterol), vitaminA: round(row.vitA), vitaminC: round(row.vitC),
          folicAcid: round(row.folate), calcium: round(row.calcium), iron: round(row.iron), potassium: round(row.potassium),
          ...extra,
        },
        equivalence: { source: 'BASE_ALIMENTOS' },
      },
    })
    created += 1
  }

  console.log(`BASE_ALIMENTOS: ${enriched} ingredientes existentes enriquecidos, ${created} nuevos creados para la práctica ${practiceId}.`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
