// Parses "500 Recetas Cero - México.pdf" into prisma/data/recetario.json.
//
// The PDF has no embedded text layer metadata we can rely on beyond plain text, so this shells
// out to poppler's `pdftotext` (must be installed) and parses the resulting text page by page
// (pdftotext separates pages with a form feed). Every recipe page follows the same shape:
//
//   <TITLE, possibly wrapped over lines>
//   <time>            e.g. "50 minutos"
//   <servings>        e.g. "8 porciones"
//   Ingredientes:
//   - <bullet, possibly wrapped>
//   Preparación:
//   1. <step, possibly wrapped>
//   Info Nutricional Aprox.(Por Porción):
//   - Calorías: ~180 kcal
//   - Proteínas: ~5 g
//   - Grasas: ~14 g
//   - Carbohidratos netos: ~5-6 g
//   - Fibra: ~3 g
//
// We deliberately treat the nutrition as per-serving (that's what the book states) and never
// invent ingredient-level data: a recipe may end up with no linked IngredientCatalog rows.
//
// Usage: node prisma/tools/extract-recetario.js [pdfPath] [outJson]

import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')

// The shipped file name uses a combining accent ("Me\u0301xico"), which is awkward to type and
// doesn't match the NFC literal below, so fall back to scanning the repo root for any PDF whose
// name starts with "500 Recetas".
const resolvePdf = () => {
  if (process.argv[2]) return process.argv[2]
  const literal = path.join(root, '500 Recetas Cero - México.pdf')
  if (existsSync(literal)) return literal
  const match = readdirSync(root).find((entry) => /^500 Recetas.*\.pdf$/i.test(entry))
  if (!match) throw new Error('No se encontró "500 Recetas Cero - México.pdf" en la raíz del proyecto.')
  return path.join(root, match)
}

const pdfPath = resolvePdf()
const outPath = process.argv[3] || path.join(root, 'prisma/data/recetario.json')

const SECTIONS = [
  { label: 'POSTRES', mealType: 'dessert' },
  { label: 'DESAYUNO', mealType: 'breakfast' },
  { label: 'ALMUERZO', mealType: 'lunch' },
  { label: 'CENA', mealType: 'dinner' },
  { label: 'BOCADILLOS', mealType: 'snack' },
  { label: 'SALSAS Y PATÉS', mealType: 'sauce' },
  { label: 'SALSAS Y PATES', mealType: 'sauce' },
  { label: 'HARINAS Y LECHES', mealType: 'base' },
]

const norm = (value) => value.normalize('NFC').trim()

const pageTexts = () => {
  const full = execFileSync('pdftotext', [pdfPath, '-'], { maxBuffer: 128 * 1024 * 1024 }).toString('utf8')
  return full.split('\f')
}

const parseNumber = (raw) => {
  const match = raw.match(/-?\d+(?:[.,]\d+)?/)
  if (!match) return null
  return Number(match[0].replace(',', '.'))
}

// "~5-6 g" / "26-28 g" -> midpoint; "~180 kcal" -> 180. Ranges are common in the book.
const parseRange = (raw) => {
  const range = raw.match(/(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)/)
  if (range) return (Number(range[1].replace(',', '.')) + Number(range[2].replace(',', '.'))) / 2
  return parseNumber(raw)
}

const TIME_RE = /^(\d+)\s*(minutos?|mins?|horas?|hrs?|h)\b\.?$/i
const SERVINGS_RE = /^(\d+)\s*(porciones?|porción|porcions?)\b/i

// Join wrapped lines: a bullet/step continues on the next line unless that line is itself a new
// bullet, a numbered step, or a known section heading.
const joinWrapped = (lines, isContinuationBreak) => {
  const items = []
  let current = ''
  for (const line of lines) {
    if (!line) continue
    if (isContinuationBreak(line) || !current) {
      if (current) items.push(current)
      current = line
    } else {
      current += ` ${line}`
    }
  }
  if (current) items.push(current)
  return items
}

const parseNutrition = (lines) => {
  const nutrition = { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }
  const found = {}
  for (const line of lines) {
    const clean = line.replace(/^-\s*/, '').trim()
    const match = clean.match(/^([A-Za-zÁÉÍÓÚáéíóúñÑ ]+):\s*(.+)$/)
    if (!match) continue
    const label = norm(match[1]).toLowerCase()
    const value = parseRange(match[2])
    if (value == null) continue
    if (label.startsWith('calor')) { nutrition.kcal = value; found.kcal = true }
    else if (label.startsWith('prote')) { nutrition.protein = value; found.protein = true }
    else if (label.startsWith('grasa')) { nutrition.fat = value; found.fat = true }
    else if (label.startsWith('carbohidrato')) { nutrition.carbs = value; found.carbs = true }
    else if (label.startsWith('fibra')) { nutrition.fiber = value; found.fiber = true }
  }
  return { nutrition, found }
}

const parsePage = (rawPage, pageNumber) => {
  const lines = rawPage.split('\n').map((line) => norm(line)).filter((line) => line.length > 0)
  if (!lines.length) return null
  const ingredientIndex = lines.findIndex((line) => /^Ingredientes:\s*$/i.test(line))
  if (ingredientIndex < 0) return null
  const prepIndex = lines.findIndex((line, index) => index > ingredientIndex && /^Preparación:\s*$/i.test(line))
  const infoIndex = lines.findIndex((line, index) => index > (prepIndex < 0 ? ingredientIndex : prepIndex) && /^Info Nutricional/i.test(line))

  if (prepIndex < 0 || infoIndex < 0) {
    console.warn(`  ! Página ${pageNumber}: receta incompleta (prep=${prepIndex}, info=${infoIndex}), se omite.`)
    return null
  }

  const header = lines.slice(0, ingredientIndex).filter((line) => !/^\d+$/.test(line) && !/^RECETAS CERO/i.test(line) && !SECTIONS.some((section) => section.label === line))
  const timeLabel = header.find((line) => TIME_RE.test(line)) || null
  const servingsLabel = header.find((line) => SERVINGS_RE.test(line)) || null
  const name = header.filter((line) => line !== timeLabel && line !== servingsLabel).join(' ').trim()

  const timeMinutes = timeLabel ? (() => {
    const match = timeLabel.match(TIME_RE)
    const amount = Number(match[1])
    return /h/i.test(match[2]) ? amount * 60 : amount
  })() : null
  const servingsMatch = servingsLabel ? servingsLabel.match(SERVINGS_RE) : null
  const servings = servingsMatch ? Number(servingsMatch[1]) : 1

  const ingredientsText = joinWrapped(
    lines.slice(ingredientIndex + 1, prepIndex),
    (line) => /^-\s+/.test(line),
  ).map((line) => line.replace(/^-\s+/, '').trim())

  const instructions = joinWrapped(
    lines.slice(prepIndex + 1, infoIndex),
    (line) => /^\d+[.)]\s+/.test(line),
  ).join('\n')

  const { nutrition, found } = parseNutrition(lines.slice(infoIndex + 1))

  return { page: pageNumber, name, timeMinutes, timeLabel, servings, ingredientsText, instructions, nutrition, found }
}

const main = () => {
  const pages = pageTexts()
  const recipes = []
  const currentSection = { label: null, mealType: null }
  let warnings = 0

  pages.forEach((rawPage, index) => {
    const pageNumber = index + 1
    const lines = rawPage.split('\n').map((line) => norm(line)).filter(Boolean)
    for (const section of SECTIONS) {
      if (lines.some((line) => line === section.label)) {
        currentSection.label = section.label.replace('SALSAS Y PATES', 'SALSAS Y PATÉS')
        currentSection.mealType = section.mealType
      }
    }
    const parsed = parsePage(rawPage, pageNumber)
    if (!parsed) return
    if (!parsed.name) { console.warn(`  ! Página ${pageNumber}: sin título, se omite.`); warnings += 1; return }
    const missing = ['kcal', 'protein', 'fat', 'carbs'].filter((key) => !parsed.found[key])
    if (missing.length) { console.warn(`  ! Página ${pageNumber} "${parsed.name}": faltan macros ${missing.join(', ')}`); warnings += 1 }
    delete parsed.found
    recipes.push({ ...parsed, section: currentSection.label, mealType: currentSection.mealType })
  })

  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(recipes, null, 2))
  const byMeal = recipes.reduce((acc, recipe) => ({ ...acc, [recipe.mealType || 'sin_seccion']: (acc[recipe.mealType || 'sin_seccion'] || 0) + 1 }), {})
  console.log(`Recetas extraídas: ${recipes.length} -> ${path.relative(root, outPath)}`)
  console.log('Por sección:', byMeal)
  console.log(`Advertencias: ${warnings}`)
}

main()
