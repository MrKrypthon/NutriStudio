// Auto-links each imported recipe's free-text ingredients to the catalog (SMAE + the
// "Aproximados Menu 500" group) and computes Recipe.calculatedNutrition.
//
//   node prisma/tools/link-smae.js --analyze   # coverage report only, no writes
//   node prisma/tools/link-smae.js --write     # link + calculate (needs db:seed + db:import-recetario)
//
// Matching is heuristic (token IDF overlap + a curated alias/synonym table); measures in household
// units are converted to grams using the matched ingredient's own serving when possible, and a
// standard conversion table otherwise. It is meant to approximate, not to be authoritative.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { normalize, parseLine, tokensOf, variants, VOLUME_ML, WEIGHT_UNITS, COUNT_GRAMS } from './ingredientMatch.js'
import { FOODS, DEFAULT_FOOD, APPROX_GROUP } from './recetarioFoods.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const recipes = JSON.parse(readFileSync(path.join(root, 'prisma/data/recetario.json'), 'utf8'))
const smae = JSON.parse(readFileSync(path.join(root, 'prisma/data/smae.json'), 'utf8'))

// Force-known equivalences where the catalog name is too different or ambiguous.
const ALIASES = {
  'huevo entero fresco': 'Huevo',
  huevo: 'Huevo',
  huevos: 'Huevo',
  'clara de huevo': 'Clara de huevo',
  'claras de huevo': 'Clara de huevo',
  clara: 'Clara de huevo',
  claras: 'Clara de huevo',
  sal: 'Sal',
  pimienta: 'Pimienta',
  canela: 'Canela',
  vainilla: 'Vainilla',
  'extracto de vainilla': 'Vainilla',
  'polvo para hornear': 'Polvo para hornear',
  'royal': 'Polvo para hornear',
  avena: 'Avena',
  'avena en hojuelas': 'Avena',
  'harina de avena': 'Avena',
  'leche de almendras': 'Leche de almendra',
  'leche de almendra': 'Leche de almendra',
  'leche vegetal': 'Leche de soya',
  'queso panela': 'Queso Panela',
  'queso oaxaca': 'Queso Oaxaca',
  'queso mozzarella': 'Queso Mozzarella',
  'aceite de oliva': 'Aceite de oliva',
  'aceite de coco': 'Aceite de coco',
  'crema de cacahuate': 'Crema de cacahuate',
  'mantequilla de cacahuate': 'Crema de cacahuate',
  'tortilla de maiz': 'Tortilla',
  'tortilla de harina': 'Tortilla de harina',
  'pechuga de pollo': 'Pechuga de pollo sin piel',
  'pollo': 'Pollo',
  'pechuga de pavo': 'Pechuga de pavo',
  'jamon de pavo': 'Pechuga de pavo',
  'frijol': 'Frijol',
  'frijoles': 'Frijol',
  'jitomate': 'Jitomate',
  'tomate': 'Jitomate',
  'platano': 'Plátano',
  'platano macho': 'Plátano macho',
  'fresa': 'Fresa',
  'fresas': 'Fresa',
  'cacao': 'Cocoa en polvo',
  'cocoa': 'Cocoa en polvo',
  'cocoa en polvo': 'Cocoa en polvo',
  'agua': 'Agua',
}

const catalog = smae.map((row) => {
  const nameTokens = tokensOf(row.name)
  return { ...row, norm: normalize(row.name), tokens: nameTokens, tokenVariants: nameTokens.map((token) => variants(token)) }
})
const tokenDocFreq = new Map()
for (const item of catalog) for (const set of item.tokenVariants) for (const variant of set) tokenDocFreq.set(variant, (tokenDocFreq.get(variant) || 0) + 1)
const idf = (token) => Math.log((catalog.length + 1) / ((tokenDocFreq.get(token) || tokenDocFreq.get([...variants(token)][0]) || 0) + 1)) + 1
const indexByVariant = new Map()
catalog.forEach((item, i) => { for (const set of item.tokenVariants) for (const variant of set) { if (!indexByVariant.has(variant)) indexByVariant.set(variant, []); indexByVariant.get(variant).push(i) } })

const intersects = (a, b) => { for (const value of a) if (b.has(value)) return true; return false }

const scoreCandidate = (queryTokens, item) => {
  let shared = 0
  let total = 0
  let sharedCount = 0
  for (const queryToken of queryTokens) {
    total += idf(queryToken)
    const queryVariants = variants(queryToken)
    if (item.tokenVariants.some((itemVariants) => intersects(queryVariants, itemVariants))) { shared += idf(queryToken); sharedCount += 1 }
  }
  if (!total) return 0
  const containment = sharedCount === queryTokens.length ? 0.15 : 0
  return { score: shared / total + containment, sharedCount, extra: item.tokens.length - sharedCount }
}

const byName = new Map(catalog.map((item) => [normalize(item.name), item]))

const findMatch = (name) => {
  const alias = ALIASES[name]
  if (alias && byName.has(normalize(alias))) return { item: byName.get(normalize(alias)), score: 1 }
  const queryTokens = tokensOf(name)
  if (!queryTokens.length) return null
  const head = queryTokens[queryTokens.length - 1]
  const headVariants = variants(head)
  const candidateIds = new Set()
  for (const token of queryTokens) for (const variant of variants(token)) for (const id of indexByVariant.get(variant) || []) candidateIds.add(id)
  let best = null
  for (const id of candidateIds) {
    const item = catalog[id]
    // The main noun of the catalog item (its first token) must match the recipe's main noun;
    // otherwise "ajo" happily matches "Pan de ajo" and "cebolla" matches "Aros de cebolla".
    if (!item.tokenVariants.length || !intersects(headVariants, item.tokenVariants[0])) continue
    const result = scoreCandidate(queryTokens, item)
    if (!best || result.score > best.score + 0.0001 || (Math.abs(result.score - best.score) < 0.0001 && (result.extra < best.extra || (result.extra === best.extra && item.name.length < best.item.name.length)))) best = { item, ...result }
  }
  if (best && best.score >= 0.7) return best
  // Seasonings and water are so frequent in composite lines ("sal y pimienta") that a dedicated
  // fallback avoids losing them to a fuzzy mismatch.
  for (const [keyword, target] of [['sal', 'Sal'], ['pimienta', 'Pimienta'], ['canela', 'Canela'], ['vainilla', 'Vainilla'], ['agua', 'Agua']]) {
    if (name.includes(keyword) && byName.has(normalize(target))) return { item: byName.get(normalize(target)), score: 0.6 }
  }
  return null
}

// grams for a parsed line, using the matched catalog item's serving when possible.
const toGrams = (line, item) => {
  const { qty, unit } = line
  if (qty == null) return null
  const servingQty = Number(item.qty) || 1
  const servingUnit = normalize(item.unit || 'gramos')
  const servingGrams = Number(item.netWeight) || Number(item.grossWeight) || null
  if (unit && WEIGHT_UNITS[unit]) return qty * WEIGHT_UNITS[unit]
  if (!unit) {
    // No unit: if the serving is a count (pieza, rebanada), treat the amount as that count.
    if (servingGrams && !VOLUME_ML[servingUnit]) return qty * (servingGrams / servingQty)
    return qty * 100
  }
  if (VOLUME_ML[unit] != null && servingGrams) {
    const servingMl = VOLUME_ML[servingUnit]
    if (servingMl) return qty * ((servingGrams / servingQty) / servingMl) * VOLUME_ML[unit]
    // Serving is a count but the recipe uses a volume; fall back to a generic density.
    return qty * VOLUME_ML[unit] * 0.85
  }
  if (VOLUME_ML[unit] != null) return qty * VOLUME_ML[unit] * 0.85
  if (servingGrams) {
    const servingMl = VOLUME_ML[servingUnit]
    if (servingMl) return qty * ((servingGrams / servingQty) / servingMl) * (COUNT_GRAMS[unit] || 15)
    return qty * (COUNT_GRAMS[unit] || servingGrams / servingQty)
  }
  return qty * (COUNT_GRAMS[unit] || 100)
}

const foodMatchers = FOODS.map((food) => ({ food, aliases: food.aliases.map((alias) => ({ raw: alias, sets: tokensOf(alias).map((token) => variants(token)) })) }))
const findFood = (term) => {
  const termTokens = tokensOf(term).map((token) => variants(token))
  const hasToken = (set) => termTokens.some((termSet) => intersects(set, termSet))
  let best = null
  for (const { food, aliases } of foodMatchers) {
    for (const alias of aliases) {
      if (!alias.sets.length || !alias.sets.every(hasToken)) continue
      if (!best || alias.raw.length > best.length) best = { food, length: alias.raw.length }
    }
  }
  return best?.food || null
}

// Density (g/ml) for the common "1 taza" style measures, since the approximate foods have no
// catalog serving to derive it from. Flours/powders ~0.45, liquids ~1, chopped solids ~0.6.
const approxDensity = (food) => {
  const name = food.name.toLowerCase()
  if (/(harina|fecula|polvo|cocoa|cacao|grenetina)/.test(name)) return 0.45
  if (/(aceite|leche|agua|jugo|vinagre|salsa|miel|jarabe|crema para batir)/.test(name)) return 1
  if (/(almendra|nuez|cacahuate|coco|granola|avena|arroz|quinoa|amaranto|frijol|lenteja|garbanzo|semilla)/.test(name)) return 0.6
  return 0.75
}

const resolveTerm = (term) => {
  const alias = ALIASES[term]
  if (alias && byName.has(normalize(alias))) return { kind: 'catalog', item: byName.get(normalize(alias)) }
  const food = findFood(term)
  if (food) {
    const exact = byName.get(normalize(food.name))
    return exact ? { kind: 'catalog', item: exact } : { kind: 'approx', food }
  }
  return { kind: 'approx', food: DEFAULT_FOOD }
}

const gramsFor = (line, resolved) => {
  const { qty, unit } = line
  if (qty == null) return null
  if (resolved.kind === 'catalog') return toGrams(line, resolved.item)
  if (unit && WEIGHT_UNITS[unit]) return qty * WEIGHT_UNITS[unit]
  if (unit && VOLUME_ML[unit] != null) return qty * VOLUME_ML[unit] * approxDensity(resolved.food)
  if (unit && COUNT_GRAMS[unit] != null) return qty * COUNT_GRAMS[unit]
  return qty * 100
}

const nutritionPer100 = (food) => ({ kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, fiber: food.fiber })

const analyze = () => {
  let lines = 0
  let catalog = 0
  let approx = 0
  let fallback = 0
  let skipped = 0
  const approxFoods = new Map()
  const fallbackTerms = new Map()
  for (const recipe of recipes) {
    for (const raw of recipe.ingredientsText || []) {
      const parsed = parseLine(raw)
      if (!parsed || !parsed.name) { skipped += 1; continue }
      lines += 1
      const resolved = resolveTerm(parsed.name)
      if (resolved.kind === 'catalog') { catalog += 1; continue }
      if (resolved.food === DEFAULT_FOOD) { fallback += 1; fallbackTerms.set(parsed.name, (fallbackTerms.get(parsed.name) || 0) + 1); continue }
      approx += 1
      approxFoods.set(resolved.food.name, (approxFoods.get(resolved.food.name) || 0) + 1)
    }
  }
  console.log(`Líneas: ${lines} | SMAE exacto: ${catalog} (${((catalog / lines) * 100).toFixed(1)}%) | aproximados: ${approx} (${((approx / lines) * 100).toFixed(1)}%) | default: ${fallback} | sin cantidad: ${skipped}`)
  console.log(`Alimentos aproximados distintos usados: ${approxFoods.size}`)
  console.log('\nSin tabla (en "Otros"):')
  for (const [name, count] of [...fallbackTerms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) console.log(`  ${count}\t${name}`)
  writeFileSync(path.join(root, 'prisma/data/link-smae-unmatched.json'), JSON.stringify([...fallbackTerms.entries()].sort((a, b) => b[1] - a[1]), null, 2))
}

const write = async () => {
  const prisma = new PrismaClient()
  const practiceId = process.argv.find((arg) => /^[0-9a-f-]{36}$/.test(arg)) || '00000000-0000-0000-0000-000000000001'
  const SOURCE = 'recetario-cero-mexico'
  const dbIngredients = await prisma.ingredient.findMany({ where: { practiceId, status: 'ACTIVE' } })
  const byDbName = new Map(dbIngredients.map((item) => [normalize(item.name), item]))
  const approxCache = new Map()
  const ensureApprox = async (food) => {
    if (approxCache.has(food.key)) return approxCache.get(food.key)
    let ingredient = dbIngredients.find((item) => item.group === APPROX_GROUP && item.name === food.name)
    if (!ingredient) ingredient = await prisma.ingredient.create({ data: { practiceId, name: food.name, group: APPROX_GROUP, unit: 'gramos', nutrition: nutritionPer100(food), equivalence: { group: food.category, serving: '100 g', grams: 100, source: 'APROX_500' } } })
    approxCache.set(food.key, ingredient)
    return ingredient
  }

  let recipesLinked = 0
  let linesCatalog = 0
  let linesApprox = 0
  let linesFallback = 0
  let linesSkipped = 0
  const approxFoods = new Set()
  for (const recipe of recipes) {
    const row = await prisma.recipe.findFirst({ where: { practiceId, source: SOURCE, name: recipe.name, mealTypes: { has: recipe.mealType } }, select: { id: true } })
    if (!row) continue
    const pending = []
    for (const raw of recipe.ingredientsText || []) {
      const parsed = parseLine(raw)
      if (!parsed || !parsed.name) { linesSkipped += 1; continue }
      const resolved = resolveTerm(parsed.name)
      const grams = gramsFor(parsed, resolved)
      if (!grams || grams <= 0) { linesSkipped += 1; continue }
      if (resolved.kind === 'catalog') {
        const db = byDbName.get(normalize(resolved.item.name))
        if (db) { pending.push({ ingredientId: db.id, quantity: grams, unit: 'g', equivalence: parsed.qty || null }); linesCatalog += 1; continue }
      }
      const ingredient = await ensureApprox(resolved.food)
      pending.push({ ingredientId: ingredient.id, quantity: grams, unit: 'g', equivalence: parsed.qty || null })
      approxFoods.add(resolved.food.name)
      if (resolved.food === DEFAULT_FOOD) linesFallback += 1
      else linesApprox += 1
    }
    const merged = new Map()
    for (const link of pending) merged.set(link.ingredientId, { ...link, quantity: (merged.get(link.ingredientId)?.quantity || 0) + link.quantity })
    const links = [...merged.values()].map((link) => ({ ...link, quantity: Math.max(1, Math.round(link.quantity)) }))
    const used = links.length ? await prisma.ingredient.findMany({ where: { id: { in: links.map((link) => link.ingredientId) } } }) : []
    const nutritionById = new Map(used.map((item) => [item.id, item.nutrition || {}]))
    const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    for (const link of links) { const nutrition = nutritionById.get(link.ingredientId) || {}; const factor = link.quantity / 100; for (const key of Object.keys(totals)) totals[key] += Number(nutrition[key] || 0) * factor }
    const servings = Number(recipe.servings) || 1
    const calculatedNutrition = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round((value / servings) * 10) / 10]))
    await prisma.$transaction([
      prisma.recipeIngredient.deleteMany({ where: { recipeId: row.id } }),
      ...(links.length ? [prisma.recipeIngredient.createMany({ data: links.map((link) => ({ recipeId: row.id, ingredientId: link.ingredientId, quantity: link.quantity, unit: link.unit, equivalence: link.equivalence })) })] : []),
      prisma.recipe.update({ where: { id: row.id }, data: { calculatedNutrition: links.length ? calculatedNutrition : null, calculationUpdatedAt: new Date() } }),
    ])
    if (links.length) recipesLinked += 1
  }
  console.log(`Recetas vinculadas: ${recipesLinked}/${recipes.length}`)
  console.log(`Líneas -> SMAE exacto: ${linesCatalog} | aproximados: ${linesApprox} | otros: ${linesFallback} | omitidas (sin cantidad): ${linesSkipped}`)
  console.log(`Alimentos aproximados en "${APPROX_GROUP}": ${approxFoods.size}`)
  await prisma.$disconnect()
}

if (process.argv.includes('--write')) write().catch((error) => { console.error(error); process.exitCode = 1 })
else analyze()
