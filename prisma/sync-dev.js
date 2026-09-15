// Makes "git pull && npm run dev:all" enough on a machine that already had the project running.
//
// A pull only updates the code; the database still needs the new columns and the new rows
// (recetario recipes, SMAE catalog, computed SMAE values). This runs before the API starts
// (via the `predev:all` npm hook) and is idempotent:
//   1. `prisma db push` to sync the schema and regenerate the client.
//   2. seed only when the practice doesn't exist yet (fresh database).
//   3. import the catalogs only when they're missing.
//   4. import the recipe book only when it isn't complete.
//   5. recompute the SMAE contrast only for recipes that don't have it yet.
//
// It never overwrites manual edits: existing recipes/ingredients are left alone unless a whole
// dataset is missing. Set SKIP_DB_SYNC=1 to bypass (e.g. when the database is remote/already set).

import { execSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const run = (command) => {
  console.log(`[sync] ${command}`)
  execSync(command, { stdio: 'inherit' })
}

const PRACTICE_ID = process.env.DEFAULT_PRACTICE_ID || '00000000-0000-0000-0000-000000000001'

const main = async () => {
  if (process.env.SKIP_DB_SYNC === '1') { console.log('[sync] SKIP_DB_SYNC=1, se omite'); return }
  if (!process.env.DATABASE_URL) { console.warn('[sync] DATABASE_URL no está configurada; copia .env.example a .env. Se omite la sincronización.'); return }

  try {
    run('npx prisma db push')
  } catch {
    console.error('\n[sync] No se pudo preparar la base de datos. ¿Está corriendo PostgreSQL? Prueba: docker compose up -d postgres\n')
    process.exit(1)
  }

  const prisma = new PrismaClient()
  try {
    const practice = await prisma.practice.findUnique({ where: { id: PRACTICE_ID } })
    const fresh = !practice
    if (fresh) {
      console.log('[sync] Base vacía: sembrando datos iniciales')
      run('npm run db:seed')
    }

    const smaeCount = await prisma.ingredient.count({ where: { practiceId: PRACTICE_ID, equivalence: { path: ['source'], equals: 'SMAE' } } })
    if (smaeCount === 0) {
      console.log('[sync] Falta el catálogo SMAE: importando')
      run('npm run db:import-smae')
      run('npm run db:import-base')
    }

    if (fresh) {
      console.log('[sync] Importando las recetas propias (fase 16)')
      run('npm run db:import-recetas')
    }

    const recetarioCount = await prisma.recipe.count({ where: { practiceId: PRACTICE_ID, source: 'recetario-cero-mexico' } })
    if (recetarioCount < 500) {
      console.log(`[sync] Recetario incompleto (${recetarioCount}/500): importando`)
      run('npm run db:import-recetario')
    }

    const total = await prisma.recipe.count({ where: { practiceId: PRACTICE_ID, source: 'recetario-cero-mexico' } })
    const withCalc = await prisma.recipe.count({ where: { practiceId: PRACTICE_ID, source: 'recetario-cero-mexico', NOT: { calculatedNutrition: { equals: null } } } })
    if (withCalc < total) {
      console.log(`[sync] Cálculo SMAE pendiente (${withCalc}/${total}): calculando`)
      run('npm run db:link-smae')
    }

    console.log('[sync] Base de datos lista.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
