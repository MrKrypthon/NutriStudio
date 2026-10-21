// Catálogo base de producción (fase 113): alimentos SMAE, alimentos base, recetas propias, recetas
// extraídas de PDF, el recetario «500 Recetas Cero» con su cálculo SMAE y el libro SMAE, en una
// práctica-catálogo SIN usuarios. Cada cuenta nueva copia de aquí su catálogo (CATALOG_PRACTICE_ID).
// En desarrollo esa práctica es la de demostración y lo hace prisma/sync-dev.js; en producción el
// seed está bloqueado, así que el catálogo se carga con este script:
//   docker compose -f docker-compose.app.yml run --rm migrate npm run catalog:import
// Es idempotente: cada paso corre sólo si su parte del catálogo falta.

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const practiceId = process.env.CATALOG_PRACTICE_ID || process.env.DEFAULT_PRACTICE_ID || '00000000-0000-0000-0000-000000000001'
const run = (script, ...args) => {
  console.log(`[catálogo] ${script} ${args.join(' ')}`.trim())
  execFileSync(process.execPath, [script, practiceId, ...args], { cwd: root, stdio: 'inherit' })
}

const prisma = new PrismaClient()

async function main() {
  const practice = await prisma.practice.upsert({
    where: { id: practiceId },
    update: {},
    create: { id: practiceId, name: 'Catálogo base (sin usuarios)', defaultPalette: 'minimal' },
    select: { id: true, name: true, _count: { select: { users: true } } },
  })
  if (practice._count.users > 0) console.log(`[catálogo] Aviso: la práctica ${practice.name} tiene usuarios; el catálogo se carga igual.`)

  const smae = await prisma.ingredient.count({ where: { practiceId, equivalence: { path: ['source'], equals: 'SMAE' } } })
  if (smae === 0) { run('prisma/import-smae.js'); run('prisma/import-base-alimentos.js') }

  const own = await prisma.recipe.count({ where: { practiceId, source: null } })
  if (own === 0) run('prisma/import-recetas.js')

  const extracted = await prisma.recipe.count({ where: { practiceId, source: { in: ['recetario-nut', 'menu-vegetariano-2', 'recetario-flexible', 'cheat-meal', 'helados-saludables'] } } })
  if (extracted === 0) run('prisma/import-recetas-nuevas.js')

  const book = await prisma.recipe.count({ where: { practiceId, source: 'recetario-cero-mexico' } })
  if (book < 500) run('prisma/import-recetario.js')

  const withCalc = await prisma.recipe.count({ where: { practiceId, source: 'recetario-cero-mexico', NOT: { calculatedNutrition: { equals: null } } } })
  const total = await prisma.recipe.count({ where: { practiceId, source: 'recetario-cero-mexico' } })
  if (withCalc < total) run('prisma/tools/link-smae.js', '--write')

  const smaeBook = await prisma.smaeFood.count({ where: { practiceId } })
  if (smaeBook === 0) run('prisma/import-smae-libro.js')

  const [ingredients, recipes, smaeFoods] = await Promise.all([
    prisma.ingredient.count({ where: { practiceId } }),
    prisma.recipe.count({ where: { practiceId } }),
    prisma.smaeFood.count({ where: { practiceId } }),
  ])
  console.log(`[catálogo] Listo en ${practiceId}: ${ingredients} alimentos, ${recipes} recetas, ${smaeFoods} filas del libro SMAE.`)
}

main()
  .catch((error) => { console.error(`[catálogo] ${error.message}`); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
