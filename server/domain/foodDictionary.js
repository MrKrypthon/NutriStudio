import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Spanish -> English food name pairs, extracted from the DICCIONARIO sheet of the
// nutritionist's Excel (fase 20). It's a 1:1 translation of the BASE_ALIMENTOS sheet (fase 17),
// not an independent 996-term list — the sheet's row count includes empty styled rows past the
// 175 real entries, which is where that earlier estimate came from.
//
// USDA and Open Food Facts are English-language databases, so a Spanish query like "aguacate"
// returns nothing useful there. This translates a query to English when we have a known
// translation, before it reaches the providers — the original query is used unchanged when
// there's no match, so this can only improve results, never break an existing search.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pairs = JSON.parse(readFileSync(path.join(__dirname, '../../prisma/data/diccionario.json'), 'utf-8'))
const EXACT = new Map(pairs.map(([es, en]) => [es.toLowerCase(), en]))
// Sorted longest-first so a more specific phrase wins over a shorter one it happens to contain
// (e.g. "espinaca cocida" over "espinaca" if both existed).
const PREFIXES = [...EXACT.entries()].sort((a, b) => b[0].length - a[0].length)

function translateFoodQuery(query) {
  const normalized = query.trim().toLowerCase()
  if (EXACT.has(normalized)) return EXACT.get(normalized)
  const match = PREFIXES.find(([es]) => es.startsWith(normalized) || normalized.startsWith(es))
  return match ? match[1] : null
}

export { translateFoodQuery }
