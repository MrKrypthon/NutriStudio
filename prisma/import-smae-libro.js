import { Prisma, PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'

// Carga en la tabla SmaeFood los alimentos leídos del libro SMAE 5ª ed. (prisma/data/smae-libro.json,
// generado con prisma/tools/smae-libro/extract.py + reconcile.py).
//
// Uso: node prisma/import-smae-libro.js [practiceId]
// Se puede volver a correr: cada renglón se identifica por (hoja, renglón) y se actualiza en su
// lugar. Lo que la nutrióloga ya corrigió a mano en la app (`corrections`) se respeta: esas celdas
// conservan su valor y no vuelven a quedar marcadas para revisión.

const prisma = new PrismaClient()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const practiceId = process.argv[2] || process.env.DEFAULT_PRACTICE_ID || '00000000-0000-0000-0000-000000000001'

async function main() {
  const { foods, summary } = JSON.parse(await readFile(path.join(__dirname, 'data/smae-libro.json'), 'utf-8'))
  const practice = await prisma.practice.findUnique({ where: { id: practiceId } })
  if (!practice) throw new Error(`No existe la práctica ${practiceId}`)
  const existing = await prisma.smaeFood.findMany({ where: { practiceId, edition: summary.edition }, select: { id: true, page: true, row: true, corrections: true } })
  const byKey = new Map(existing.map((item) => [`${item.page}|${item.row}`, item]))
  let created = 0
  let updated = 0
  for (const food of foods) {
    const current = byKey.get(`${food.page}|${food.row}`)
    const corrections = current?.corrections && typeof current.corrections === 'object' ? current.corrections : {}
    const nutrients = { ...food.nutrients }
    const review = { ...food.review }
    const data = { group: food.group, name: food.name, qty: food.qty, qtyText: food.qtyText, unit: food.unit }
    for (const [field, value] of Object.entries(corrections)) {
      if (field in nutrients) nutrients[field] = value
      else if (field in data) data[field] = value
      delete review[field]
    }
    const payload = { ...data, nutrients, review: Object.keys(review).length ? review : Prisma.DbNull }
    if (current) { await prisma.smaeFood.update({ where: { id: current.id }, data: payload }); updated += 1 }
    else { await prisma.smaeFood.create({ data: { practiceId, edition: summary.edition, page: food.page, row: food.row, ...payload } }); created += 1 }
    byKey.delete(`${food.page}|${food.row}`)
  }
  // Renglones que ya no salen de la lectura (p. ej. se corrigió la detección de una hoja).
  const stale = [...byKey.values()].map((item) => item.id)
  if (stale.length) await prisma.smaeFood.deleteMany({ where: { id: { in: stale } } })
  console.log(`SMAE ${summary.edition}ª ed.: ${created} nuevos, ${updated} actualizados, ${stale.length} retirados.`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
