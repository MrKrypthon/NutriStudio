// Extrae las recetas de "RECETARIOFLEXIBLE_MI DIETA FLEXIBLE.pdf": una receta por página con
// INGREDIENTES / Información Nutricional (Energía + Macros) / INSTRUCCIONES.
// Salida: JSON con { source, mealType, page, name, servings, nutrition, ingredientsText, instructions, imageFile }.
//
// La página es un collage de marcos de texto independientes (ingredientes, cuadro nutricional,
// insignias "Post Workout" / "1 porcion", instrucciones, notas) cuya posición cambia de una página
// a otra. `pdftotext -layout` los aplana por renglón físico y mezcla marcos vecinos, así que aquí
// se lee `pdftotext -bbox-layout` y cada dato se toma por coordenadas.
//
// El PDF no trae fotos de comida: las únicas imágenes de cada página son el fondo de madera y la
// marca de agua del logo, por eso imageFile siempre es null.
//
// Uso: node prisma/tools/extract-flexible.js [pdfPath] [outJson]

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const pdfPath = process.argv[2] || path.join(root, 'nuevasRecetas/RECETARIOFLEXIBLE_MI DIETA FLEXIBLE.pdf')
const outJson = process.argv[3] || '/tmp/opencode/recetas/flexible.json'

const SECTION_MEAL = [
  [/^desayunos/i, 'breakfast'],
  [/^almuerzos/i, 'lunch'],
  [/^cenas/i, 'dinner'],
  [/^treats/i, 'dessert'],
  [/^smoothies/i, 'snack'],
  [/^ensaladas/i, 'base'],
]

const clean = (value) => value.replace(/[·\uFFFD]/g, '').replace(/\s+/g, ' ').trim()
const unescapeXml = (value) => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
const round2 = (value) => Math.round(value * 100) / 100
const byY = (a, b) => a.y0 - b.y0 || a.x0 - b.x0

// Une renglones de un mismo párrafo; el corte silábico de fin de renglón ("endul-" + "zar") se cierra.
const joinWrapped = (parts) => parts.reduce((text, part) => {
  if (!text) return part
  return /\p{Ll}-$/u.test(text) && /^\p{Ll}/u.test(part) ? text.slice(0, -1) + part : `${text} ${part}`
}, '')

// Renglones de cada página con su caja: { x0, y0, x1, y1, text }.
const readPages = () => {
  const xml = execFileSync('pdftotext', ['-bbox-layout', pdfPath, '-'], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8')
  return xml.split(/<page /).slice(1).map((pageXml) => {
    const lines = []
    for (const m of pageXml.matchAll(/<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g)) {
      const words = [...m[5].matchAll(/<word[^>]*>([\s\S]*?)<\/word>/g)].map((w) => unescapeXml(w[1]))
      const text = clean(words.join(' '))
      if (text) lines.push({ x0: Number(m[1]), y0: Number(m[2]), x1: Number(m[3]), y1: Number(m[4]), text })
    }
    return lines
  })
}

const isMark = (line) => /^[⁞•\s]+$/.test(line.text)
const isStepNumber = (line) => /^\d+\.$/.test(line.text)

const parseRecipe = (lines, pageNumber) => {
  const header = (re) => lines.find((line) => re.test(line.text))
  const ingHeader = header(/^INGREDIENTES$/i)
  const instHeader = header(/^INSTRUCCIONES$/i)
  const nutHeader = header(/^Informaci[oó]n Nutricional:?$/i)
  const marks = lines.filter(isMark).sort(byY)
  // Descarta portadillas, la guía de meal prep y la página de toppings: no son recetas completas.
  if (!ingHeader || !instHeader || marks.length < 2) return null

  // Título: los renglones en tipografía grande sobre el encabezado INGREDIENTES.
  const name = lines.filter((line) => line.y0 < ingHeader.y0 && line.y1 - line.y0 > 25).sort(byY).map((line) => line.text).join(' ').trim()
  if (name.length < 3) return null

  // Ingredientes: una viñeta "⁞⁞" por ingrediente. El texto vive en la columna pegada a la derecha
  // de las viñetas; un renglón alineado con una viñeta abre ingrediente y los siguientes sin viñeta
  // son su continuación. La columna termina en el encabezado INSTRUCCIONES cuando éste queda debajo.
  const markX = Math.max(...marks.map((mark) => mark.x1))
  const columnBottom = instHeader.y0 > marks[0].y0 ? instHeader.y0 : Infinity
  const column = lines
    .filter((line) => !isMark(line) && !isStepNumber(line) && line.x0 > markX && line.x0 < markX + 45 && line.y0 >= marks[0].y0 - 6 && line.y0 < columnBottom)
    .sort(byY)
  const items = []
  let previous = null
  for (const line of column) {
    if (marks.some((mark) => Math.abs(mark.y0 - line.y0) < 6)) items.push([line.text])
    else if (items.length && previous && line.y0 - previous.y0 < 22) items[items.length - 1].push(line.text)
    else if (items.length) break
    else continue
    previous = line
  }
  const ingredientsText = items.map(joinWrapped)
  if (ingredientsText.length !== marks.length) throw new Error(`Página ${pageNumber} (${name}): ${marks.length} viñetas pero ${ingredientsText.length} ingredientes.`)

  // Instrucciones: los números "1." "2." van en su propio marco; el texto de cada paso es la columna
  // a su derecha, desde la altura del número hasta el siguiente número. Tras el último número el
  // paso termina en el primer salto de renglón mayor al interlineado (ahí empiezan notas y pie).
  const numbers = lines.filter((line) => isStepNumber(line) && line.y0 > instHeader.y0 - 6).sort(byY)
  const numberX = Math.min(...numbers.map((line) => line.x0))
  const body = lines
    .filter((line) => !isStepNumber(line) && !isMark(line) && line.x0 > numberX + 18 && line.x0 < numberX + 42 && line.y0 > instHeader.y0)
    .sort(byY)
  const steps = numbers.map((number, index) => {
    const end = index + 1 < numbers.length ? numbers[index + 1].y0 - 4 : Infinity
    const parts = []
    let last = null
    for (const line of body) {
      if (line.y0 < number.y0 - 4 || line.y0 >= end) continue
      if (last && line.y0 - last.y0 > 24) break
      parts.push(line.text)
      last = line
    }
    return `${number.text} ${joinWrapped(parts)}`.trim()
  })
  const instructions = steps.join(' ')

  // Nutrición: sólo los renglones centrados bajo "Informacion Nutricional" (el cuadro), para no
  // tomar cifras de las notas ("+45g HCO"). Algunas cifras vienen sin la "g".
  const centre = (line) => (line.x0 + line.x1) / 2
  const boxBottom = instHeader.y0 > nutHeader?.y0 && Math.abs(centre(instHeader) - centre(nutHeader)) < 90 ? instHeader.y0 : Infinity
  const box = nutHeader
    ? lines.filter((line) => line !== nutHeader && Math.abs(centre(line) - centre(nutHeader)) < 70 && line.y0 > nutHeader.y0 && line.y0 < Math.min(nutHeader.y0 + 280, boxBottom)).sort(byY).map((line) => line.text)
    : []
  const findNum = (re) => { for (const text of box) { const m = text.match(re); if (m) return Number(m[1].replace(',', '.')) } return 0 }
  const nutrition = {
    kcal: findNum(/(\d+(?:[.,]\d+)?)\s*kcal/i),
    carbs: findNum(/(\d+(?:[.,]\d+)?)\s*g?\s*HCO/i),
    protein: findNum(/(\d+(?:[.,]\d+)?)\s*g?\s*prote[ií]na/i),
    fat: findNum(/(\d+(?:[.,]\d+)?)\s*g?\s*l[ií]pidos?/i),
  }
  const fiber = findNum(/(\d+(?:[.,]\d+)?)\s*g?\s*fibra/i)
  if (fiber) nutrition.fiber = fiber

  // Porciones: la insignia "N porcion(es)". wholePreparation indica que el cuadro nutricional es
  // de toda la preparación y no de una porción.
  const badge = lines.map((line) => line.text.match(/^(\d+)\s*porci[oó]n(?:es)?$/i)).find(Boolean)
  const servings = badge ? Number(badge[1]) : 1
  const wholePreparation = box.some((text) => /por toda la preparaci[oó]n/i.test(text))

  return { page: pageNumber, name, servings, wholePreparation, nutrition, ingredientsText, instructions }
}

// Correcciones puntuales de ligaduras en títulos y de erratas del cuadro nutricional del PDF.
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
  'Pro-oats': { fat: 3.85 }, // impreso "3-85g"
  'Apple&Carrot Cream Salad': { carbs: 25.2 }, // impreso "252g"
}
// Páginas cuyo contenido impreso es de otra receta: no se importan hasta que alguien las revise.
const SKIP = {
  'Greek Salad': 'la página repite los ingredientes e instrucciones de "Apple&Carrot Cream Salad"',
}

const main = () => {
  const recipes = []
  let mealType = 'breakfast'
  readPages().forEach((lines, i) => {
    const pageNumber = i + 1
    // Las portadillas de sección llevan su título en una tipografía mayor que la de las recetas.
    const cover = lines.find((line) => line.y1 - line.y0 > 45)
    if (cover) for (const [re, meal] of SECTION_MEAL) if (re.test(cover.text)) mealType = meal
    const parsed = parseRecipe(lines, pageNumber)
    if (!parsed) return
    if (SKIP[parsed.name]) { console.warn(`Omitida p.${pageNumber} "${parsed.name}": ${SKIP[parsed.name]}.`); return }

    const { wholePreparation, ...recipe } = parsed
    let nutrition = { ...recipe.nutrition, ...(NUT_FIX[recipe.name] || {}) }
    // En la app `nutrition` es de UNA porción y los ingredientes son de toda la receta: si el cuadro
    // del libro es "por toda la preparación" y rinde N porciones, se divide entre N.
    if (wholePreparation && recipe.servings > 1) {
      nutrition = Object.fromEntries(Object.entries(nutrition).map(([key, value]) => [key, round2(value / recipe.servings)]))
      console.log(`p.${pageNumber} "${recipe.name}": nutrición de toda la preparación dividida entre ${recipe.servings}.`)
    }
    recipes.push({ source: 'recetario-flexible', mealType, ...recipe, name: NAME_FIX[recipe.name] || recipe.name, nutrition, imageFile: null })
  })

  mkdirSync(path.dirname(outJson), { recursive: true })
  writeFileSync(outJson, JSON.stringify(recipes, null, 2))
  console.log(`Recetas: ${recipes.length} -> ${outJson}`)
}

main()
