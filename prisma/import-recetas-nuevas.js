// Imports recipes extracted from the PDFs in /nuevasRecetas (prisma/data/recetas-nuevas.json)
// following the same shape as the ebook importer (prisma/import-recetario.js): free-text
// ingredient lines in household measures, per-serving macros in `nutrition`, optional imageFile.
//
// Usage:
//   node prisma/import-recetas-nuevas.js [practiceId] [--reset] [--only=source]
//   --reset borra las recetas de estas fuentes antes de reimportar.
//   --only=cheat-meal importa/actualiza sólo esa fuente.
//
// Idempotente: hace match por practice + source + name + meal type, así que re-ejecutar actualiza
// en vez de duplicar.

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const prisma = new PrismaClient()
const here = path.dirname(fileURLToPath(import.meta.url))
const dataFile = path.join(here, 'data/recetas-nuevas.json')

const args = process.argv.slice(2)
const reset = args.includes('--reset')
const only = args.find((arg) => arg.startsWith('--only='))?.split('=')[1] || null
const practiceId = args.find((arg) => !arg.startsWith('--')) || '00000000-0000-0000-0000-000000000001'

const round1 = (value) => Math.round((Number(value) || 0) * 10) / 10

const main = async () => {
  const recipes = JSON.parse(readFileSync(dataFile, 'utf8'))
  const practice = await prisma.practice.findUnique({ where: { id: practiceId } })
  if (!practice) throw new Error(`No existe la práctica ${practiceId}. Corre primero npm run db:seed.`)

  const items = only ? recipes.filter((item) => item.source === only) : recipes
  const sources = [...new Set(items.map((item) => item.source))]

  if (reset) {
    const deleted = await prisma.recipe.deleteMany({ where: { practiceId, source: { in: sources } } })
    console.log(`--reset: ${deleted.count} recetas eliminadas de ${sources.length} fuente(s).`)
  }

  let created = 0
  let updated = 0
  let skipped = 0

  for (const item of items) {
    const mealType = item.mealType || item.mealTypes?.[0]
    if (!mealType || !item.name) { skipped += 1; continue }
    const data = {
      name: item.name,
      mealTypes: [mealType],
      portions: item.servings || 1,
      instructions: item.instructions || '',
      nutrition: {
        kcal: round1(item.nutrition?.kcal),
        protein: round1(item.nutrition?.protein),
        carbs: round1(item.nutrition?.carbs),
        fat: round1(item.nutrition?.fat),
        fiber: round1(item.nutrition?.fiber),
      },
      restrictions: item.restrictions || [],
      imageUrl: null,
      imageFile: item.imageFile || null,
      ingredientsText: item.ingredientsText || [],
      timeMinutes: item.timeMinutes ?? null,
      source: item.source,
    }
    const existing = await prisma.recipe.findFirst({ where: { practiceId, source: item.source, name: item.name, mealTypes: { has: mealType } }, select: { id: true } })
    if (existing) { await prisma.recipe.update({ where: { id: existing.id }, data }); updated += 1 }
    else { await prisma.recipe.create({ data: { practiceId, ...data } }); created += 1 }
  }

  console.log(`Importadas: ${created} nuevas, ${updated} actualizadas, ${skipped} omitidas.`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
