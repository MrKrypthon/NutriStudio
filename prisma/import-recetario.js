// Imports the parsed ebook recipes (prisma/data/recetario.json, produced by
// prisma/tools/extract-recetario.js + extract-recetario-images.js) into the Recipe table.
//
// These recipes differ from the handmade catalog: the book gives free-text ingredient lines in
// household measures and per-serving macros, so they are stored with `ingredientsText`,
// `timeMinutes` and `source`, and their `nutrition` holds the per-serving values (the same
// meaning `nutrition` already has everywhere else in the app). Portion scaling multiplies those
// values by the requested number of servings.
//
// Usage:
//   node prisma/import-recetario.js [practiceId] [--reset]
//   --reset deletes previously imported ebooks recipes (source = this script's SOURCE) first.
//
// Idempotent: matches existing rows by practice + source + name + meal type, so re-running
// updates instead of duplicating. (Two recipes share a name across sections — "CALDO TLALPEÑO"
// and "PESCADO A LA VERACRUZANA" — and keying on meal type keeps both.)

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const prisma = new PrismaClient()
const here = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = 'recetario-cero-mexico'

const args = process.argv.slice(2)
const reset = args.includes('--reset')
const practiceId = args.find((arg) => !arg.startsWith('--')) || '00000000-0000-0000-0000-000000000001'

const round1 = (value) => Math.round(value * 10) / 10

const main = async () => {
  const recipes = JSON.parse(readFileSync(path.join(here, 'data/recetario.json'), 'utf8'))
  const practice = await prisma.practice.findUnique({ where: { id: practiceId } })
  if (!practice) throw new Error(`No existe la práctica ${practiceId}. Corre primero npm run db:seed.`)

  if (reset) {
    const deleted = await prisma.recipe.deleteMany({ where: { practiceId, source: SOURCE } })
    console.log(`--reset: ${deleted.count} recetas importadas eliminadas.`)
  }

  let created = 0
  let updated = 0
  let skipped = 0

  for (const item of recipes) {
    if (!item.mealType || !item.name) { skipped += 1; continue }
    const nutrition = {
      kcal: round1(Number(item.nutrition?.kcal) || 0),
      protein: round1(Number(item.nutrition?.protein) || 0),
      carbs: round1(Number(item.nutrition?.carbs) || 0),
      fat: round1(Number(item.nutrition?.fat) || 0),
      fiber: round1(Number(item.nutrition?.fiber) || 0),
    }
    const data = {
      name: item.name,
      mealTypes: [item.mealType],
      portions: item.servings || 1,
      instructions: item.instructions || '',
      nutrition,
      restrictions: ['sin azúcar', 'sin gluten'],
      imageUrl: null,
      imageFile: item.imageFile || null,
      ingredientsText: item.ingredientsText || [],
      timeMinutes: item.timeMinutes ?? null,
      source: SOURCE,
    }

    const existing = await prisma.recipe.findFirst({
      where: { practiceId, source: SOURCE, name: item.name, mealTypes: { has: item.mealType } },
      select: { id: true },
    })
    if (existing) {
      await prisma.recipe.update({ where: { id: existing.id }, data })
      updated += 1
    } else {
      await prisma.recipe.create({ data: { practiceId, ...data } })
      created += 1
    }
  }

  console.log(`Recetario importado: ${created} nuevas, ${updated} actualizadas, ${skipped} omitidas.`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
