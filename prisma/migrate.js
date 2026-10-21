// Prepara el esquema de la base con las migraciones de prisma/migrations (fase 112). Sirve para una
// base vacía, para una creada antes con `prisma db push` (sin historial) y para una que ya tiene
// historial. Nunca borra datos: una base de `db push` se adopta sólo cuando coincide exactamente con la
// línea base (prisma/baseline/0_init.prisma). Si le falta algo (una base de desarrollo que no corrió
// el último `db push`), primero se completa con `db push` de la línea base SIN --accept-data-loss,
// lo mismo que hacía `dev:all` hasta la fase 111; si eso exigiera borrar datos, se detiene.
//
//   npm run db:migrate                  aplicar lo pendiente (y regenerar el cliente de Prisma)
//   node prisma/migrate.js --no-generate
//
// En producción, con la base creada desde cero por migraciones, basta `npx prisma migrate deploy`.

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { BASELINE_MIGRATION, migrationPlan } from './tools/migrationPlan.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const prismaBin = path.join(root, 'node_modules', '.bin', 'prisma')
const prismaCli = (args, options = {}) => execFileSync(prismaBin, args, { cwd: root, stdio: 'inherit', ...options })

async function databaseState() {
  const prisma = new PrismaClient()
  try {
    // to_regclass busca en el search_path, que Prisma fija al `schema` de DATABASE_URL.
    const [row] = await prisma.$queryRaw`SELECT to_regclass('"_prisma_migrations"') IS NOT NULL AS "hasHistory", to_regclass('"Practice"') IS NOT NULL AS "hasTables"`
    return { hasHistory: Boolean(row.hasHistory), hasTables: Boolean(row.hasTables) }
  } finally {
    await prisma.$disconnect()
  }
}

// Compara la base con la línea base. `--exit-code`: 0 sin diferencias, 2 con diferencias.
function baselineDrift() {
  try {
    execFileSync(prismaBin, ['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/baseline/0_init.prisma', '--exit-code'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    return null
  } catch (error) {
    if (error.status === 2) return String(error.stdout || '').trim()
    throw error
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[migrate] DATABASE_URL no está configurada; copia .env.example a .env.')
    process.exit(1)
  }
  const plan = migrationPlan(await databaseState())
  if (plan === 'baseline-then-deploy') {
    console.log('[migrate] Base creada con `db push` (sin historial): se compara con la línea base.')
    if (baselineDrift()) {
      console.log('[migrate] No coincide todavía: se completa con la línea base (sin borrar datos).')
      try {
        prismaCli(['db', 'push', '--schema', 'prisma/baseline/0_init.prisma', '--skip-generate'])
      } catch {
        console.error('[migrate] Completarla exigiría borrar datos, así que no se marcó nada. Revisa el aviso de arriba.')
        process.exit(1)
      }
      const drift = baselineDrift()
      if (drift) {
        console.error('[migrate] La base sigue sin coincidir con la línea base, así que no se marcó nada. Diferencia:\n')
        console.error(drift)
        console.error('\n[migrate] Corrígela (o reconstruye la base de desarrollo con npm run db:setup sobre una base vacía) y vuelve a correr npm run db:migrate.')
        process.exit(1)
      }
    }
    prismaCli(['migrate', 'resolve', '--applied', BASELINE_MIGRATION])
  }
  prismaCli(['migrate', 'deploy'])
  if (!process.argv.includes('--no-generate')) prismaCli(['generate'])
}

main().catch((error) => {
  console.error(`[migrate] ${error.message}`)
  process.exit(1)
})
