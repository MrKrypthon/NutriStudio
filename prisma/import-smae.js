import { PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Loads the Sistema Mexicano de Equivalentes de Alimentos catalog (2,871 items across the
// 19 official SMAE groups) into the Ingredient table for a practice. Source data lives at
// prisma/data/smae.json, extracted once from the nutritionist's own working spreadsheet
// (DIETOCALCULO.xlsx) — the raw spreadsheet is not committed to the repo.
//
// Usage: node prisma/import-smae.js [practiceId]
// Re-running is safe: matches existing SMAE-sourced ingredients by (name, group, serving) and
// updates them in place instead of delete+recreate — a delete would fail once a recipe
// references one of these ingredients (RecipeIngredient.ingredientId is onDelete: Restrict).
// Name alone isn't a safe match key: 47 names in the source Excel appear more than once, some
// as genuine duplicate rows and some as the same food listed under two different SMAE
// categories/servings (e.g. "Doritos Nachos" at 20 g vs. 0.33 bolsita) — (name, group, serving)
// is the smallest key that's actually 1:1 with a distinct source row.

const prisma = new PrismaClient()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const practiceId = process.argv[2] || '00000000-0000-0000-0000-000000000001'

async function main() {
  const raw = await readFile(path.join(__dirname, 'data/smae.json'), 'utf-8')
  const rows = JSON.parse(raw)

  const ingredients = rows.map((row) => {
    // SMAE values are per equivalent serving (netWeight grams), but the app's nutrition
    // engine expects Ingredient.nutrition per 100 g — same convention as every other
    // ingredient in the catalog (see prisma/seed.js).
    const grams = row.netWeight > 0 ? row.netWeight : (row.grossWeight > 0 ? row.grossWeight : 100)
    const factor = 100 / grams
    const round = (value) => Math.round(value * factor * 100) / 100
    return {
      practiceId,
      name: row.name,
      group: row.category,
      unit: row.unit || 'gramos',
      nutrition: {
        kcal: round(row.kcal),
        protein: round(row.protein),
        carbs: round(row.carbs),
        fat: round(row.fat),
        fiber: round(row.fiber),
        sugar: round(row.sugar),
        sodium: round(row.sodium),
        saturatedFat: round(row.satFat),
        monounsaturatedFat: round(row.monoFat),
        polyunsaturatedFat: round(row.polyFat),
        cholesterol: round(row.cholesterol),
        vitaminA: round(row.vitA),
        vitaminC: round(row.vitC),
        folicAcid: round(row.folicAcid),
        calcium: round(row.calcium),
        iron: round(row.iron),
        potassium: round(row.potassium),
        phosphorus: round(row.phosphorus),
        ethanol: round(row.ethanol),
      },
      equivalence: {
        group: row.category,
        serving: `${row.qty} ${row.unit}`.trim(),
        grams: row.netWeight || row.grossWeight || null,
        glycemicIndex: row.gi || null,
        glycemicLoad: row.gl || null,
        source: 'SMAE',
      },
    }
  })

  const existing = await prisma.ingredient.findMany({ where: { practiceId, equivalence: { path: ['source'], equals: 'SMAE' } }, select: { id: true, name: true, group: true, equivalence: true } })
  const matchKey = (name, group, serving) => `${name}|${group}|${serving}`
  const existingByKey = new Map(existing.map((item) => [matchKey(item.name, item.group, item.equivalence?.serving || ''), item.id]))

  let created = 0
  let updated = 0
  for (const data of ingredients) {
    const key = matchKey(data.name, data.group, data.equivalence.serving)
    const existingId = existingByKey.get(key)
    if (existingId) {
      await prisma.ingredient.update({ where: { id: existingId }, data })
      updated += 1
    } else {
      const row = await prisma.ingredient.create({ data })
      existingByKey.set(key, row.id)
      created += 1
    }
  }
  // Deliberately not deleting anything left unmatched in existingByKey: a delete would fail
  // once a recipe references one of these ingredients (RecipeIngredient.ingredientId is
  // onDelete: Restrict), and an orphaned row from a source row that got renamed/removed is
  // safer to leave in place than to risk that failure mid-import.
  console.log(`SMAE: ${created} alimentos nuevos, ${updated} actualizados para la práctica ${practiceId}.`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
