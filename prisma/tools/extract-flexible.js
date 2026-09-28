// Extrae las recetas de "RECETARIOFLEXIBLE_MI DIETA FLEXIBLE.pdf": una receta por página con
// INGREDIENTES / Información Nutricional (Energía + Macros) / INSTRUCCIONES, y una foto por página.
// Salida: JSON con { source, mealType, name, nutrition, ingredientsText, instructions, imageFile }
// y las imágenes normalizadas en storage/recipes/.
//
// Uso: node prisma/tools/extract-flexible.js [pdfPath] [outJson]

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const pdfPath = process.argv[2] || path.join(root, 'nuevasRecetas/RECETARIOFLEXIBLE_MI DIETA FLEXIBLE.pdf')
const outJson = process.argv[3] || '/tmp/opencode/recetas/flexible.json'
const outDir = path.join(root, 'storage/recipes')
const tmpDir = path.join(root, '.tmp-flexible-images')

const SECTION_MEAL = [
  [/^desayuno/i, 'breakfast'],
  [/^almuerzo/i, 'lunch'],
  [/^cena/i, 'dinner'],
  [/^treat/i, 'dessert'],
  [/^smoothie/i, 'snack'],
  [/^ensalada/i, 'base'],
]

const slugify = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
const clean = (value) => value.replace(/[·�]/g, '').replace(/\s+/g, ' ').trim()
const stripMarker = (value) => value.replace(/^[⁞•\s]+/, '').trim()
const num = (raw) => { const m = String(raw).match(/(\d+(?:[.,]\d+)?)/); return m ? Number(m[1].replace(',', '.')) : 0 }

const pages = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 128 * 1024 * 1024 }).toString('utf8').split('\f')

const imageByPage = () => {
  const out = execFileSync('pdfimages', ['-list', pdfPath], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
  const byPage = new Map()
  for (const line of out.split('\n')) {
    const cells = line.trim().split(/\s+/)
    if (cells.length < 12 || !/^\d+$/.test(cells[0])) continue
    const [page, imgNum, type, width, height] = cells
    if (type === 'smask') continue
    const area = Number(width) * Number(height)
    const list = byPage.get(Number(page)) || []
    list.push({ imgNum, area })
    byPage.set(Number(page), list)
  }
  return byPage
}

const parseRecipe = (raw, pageNumber) => {
  const lines = raw.split('\n').map(clean).filter(Boolean)
  const ingIdx = lines.findIndex((line) => /INGREDIENTES/i.test(line))
  if (ingIdx < 0) return null

  const BOILER = /^(post|out|workout|º|1 porcion|1 porción|porcion|porci[oó]n)$/i
  const titleLines = lines.slice(0, ingIdx).filter((line) => !BOILER.test(line) && !/^\d+$/.test(line) && !/toppings?:/i.test(line) && !/informaci[oó]n nutricional/i.test(line))
  const name = titleLines.join(' ').trim().replace(/\b([A-Z])/g, (m) => m)
  if (!name || name.length < 3) return null

  // Ingredientes: líneas marcadas con "⁞⁞"; las continuaciones (líneas sin marca, que no parecen
  // instrucción/encabezado) se pegan a la anterior.
  const ingredientsText = []
  const NOISE = /INSTRUCCIONES|Informaci[oó]n Nutricional|Energ[ií]a|Macros|kcal|\d\s*g\s*(HCO|Prote|L[ií]pidos)|^\d+[.)]\s|^(Post|Workout|porcion|porci[oó]n|NOTA)/i
  for (const line of lines.slice(ingIdx + 1)) {
    if (/⁞|•/.test(line)) { ingredientsText.push(stripMarker(line)); continue }
    if (!ingredientsText.length) continue
    if (NOISE.test(line) || /^(Desayunos?|Almuerzos?|Cenas?|Treats|Smoothies|Ensaladas)/i.test(line)) continue
    ingredientsText[ingredientsText.length - 1] += ` ${line}`
  }

  // Nutrición: regex estrictas sobre toda la página (las columnas se mezclan con -layout).
  const nutrition = { kcal: 0, carbs: 0, protein: 0, fat: 0 }
  const all = lines.slice(ingIdx)
  const findNum = (re) => { for (const line of all) { const m = line.match(re); if (m) return Number(m[1].replace(',', '.')) } return 0 }
  nutrition.kcal = findNum(/(\d+(?:[.,]\d+)?)\s*kcal/i) || findNum(/Energ[ií]a:?\s*(\d+(?:[.,]\d+)?)/i)
  nutrition.carbs = findNum(/(\d+(?:[.,]\d+)?)\s*g\s*(?:HCO|carbohidratos?)/i)
  nutrition.protein = findNum(/(\d+(?:[.,]\d+)?)\s*g\s*prote[ií]na/i)
  nutrition.fat = findNum(/(\d+(?:[.,]\d+)?)\s*g\s*l[ií]pidos?/i)

  const instIdx = lines.findIndex((line) => /INSTRUCCIONES/i.test(line))
  const instructions = instIdx >= 0 ? lines.slice(instIdx + 1).filter((line) => /^\d+[.)]\s/.test(line)).join(' ').replace(/\s*NOTA:.*$/i, '').trim() : ''

  // Descarta páginas-intro (guía de meal prep, portadillas de sección): no traen ingredientes.
  if (ingredientsText.length < 2) return null

  return { page: pageNumber, name, nutrition, ingredientsText, instructions }
}

const main = () => {
  const byPage = imageByPage()
  mkdirSync(outDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
  execFileSync('pdfimages', ['-j', '-p', pdfPath, path.join(tmpDir, 'all')], { stdio: 'ignore' })
  const listing = readdirSync(tmpDir)

  const recipes = []
  let mealType = 'breakfast'
  pages.forEach((raw, i) => {
    const pageNumber = i + 1
    const head = clean(raw.split('\n').find((line) => clean(line)) || '')
    for (const [re, meal] of SECTION_MEAL) if (re.test(head) && /^(Desayunos|Almuerzos|Cenas|treats|Smoothies|Ensaladas)/i.test(head)) mealType = meal
    const parsed = parseRecipe(raw, pageNumber)
    if (!parsed) return
    const images = byPage.get(pageNumber) || []
    let imageFile = null
    if (images.length) {
      const best = images.reduce((a, b) => (a.area >= b.area ? a : b))
      const prefix = `all-${String(pageNumber).padStart(3, '0')}-${String(best.imgNum).padStart(3, '0')}`
      const sourceName = listing.find((n) => n.startsWith(prefix))
      if (sourceName) {
        const target = `flex-${slugify(parsed.name)}.jpg`
        const sourcePath = path.join(tmpDir, sourceName)
        try { execFileSync('convert', [sourcePath, '-resize', '1000x1000>', '-quality', '82', path.join(outDir, target)]) } catch { }
        if (existsSync(path.join(outDir, target))) imageFile = target
      }
    }
    // Correcciones puntuales de OCR/ligaduras y de valores mal capturados por el texto del PDF.
    const NAME_FIX = {
      'Hamburguesas de atUn': 'Hamburguesas de atún',
      'Pollo con chIcharos': 'Pollo con chícharos',
      'Muffins Choco-PlAtano': 'Muffins choco-plátano',
      'CafE Frappuccino': 'Café frappuccino',
      'Ensalada PakistanI': 'Ensalada pakistaní',
      'Ensalada de Manzana y Brocoli': 'Ensalada de manzana y brócoli',
      'Crema de Espinaca': 'Crema de espinaca',
      'Sandwich Montecristo': 'Sándwich Montecristo',
      'Pancakes de avena': 'Pancakes de avena',
    }
    const NUT_FIX = {
      'Pro-oats': { fat: 3.85 },
      'Crepa de Espinaca': { fat: 11.2 },
      'Chicken Bakes': { fat: 13.3 },
      'Apple&Carrot Cream Salad': { carbs: 25.2 },
    }
    const fixed = { ...parsed, name: NAME_FIX[parsed.name] || parsed.name, nutrition: { ...parsed.nutrition, ...(NUT_FIX[parsed.name] || {}) } }
    recipes.push({ source: 'recetario-flexible', mealType, ...fixed, imageFile })
  })

  rmSync(tmpDir, { recursive: true, force: true })
  writeFileSync(outJson, JSON.stringify(recipes, null, 2))
  console.log(`Recetas: ${recipes.length} -> ${outJson}`)
  console.log(`Con imagen: ${recipes.filter((r) => r.imageFile).length}`)
}

main()
