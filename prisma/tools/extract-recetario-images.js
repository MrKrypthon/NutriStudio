// Extracts the recipe photo embedded in each page of the ebook and writes
// storage/recipes/<slug>.jpg, then records the file name on prisma/data/recetario.json.
//
// Each recipe page in the PDF has one large JPEG photo plus a small repeated logo (object 627)
// and its soft mask. We pick the largest non-smask image on the recipe's own page, ignoring the
// logo, and normalize everything to JPEG. Requires poppler (`pdfimages`) and ImageMagick
// (`convert`), both used only at extraction time and never at runtime.
//
// Usage: node prisma/tools/extract-recetario-images.js

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const jsonPath = path.join(root, 'prisma/data/recetario.json')
const outDir = path.join(root, 'storage/recipes')
const tmpDir = path.join(root, '.tmp-recetario-images')

const LOGO_OBJECT_ID = '627'

const resolvePdf = () => {
  const literal = path.join(root, '500 Recetas Cero - México.pdf')
  if (existsSync(literal)) return literal
  const match = readdirSync(root).find((entry) => /^500 Recetas.*\.pdf$/i.test(entry))
  if (!match) throw new Error('No se encontró el PDF del recetario.')
  return path.join(root, match)
}

const slugify = (value) => value
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 70)

const parseImageList = (pdfPath) => {
  const output = execFileSync('pdfimages', ['-list', pdfPath], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
  const byPage = new Map()
  for (const line of output.split('\n')) {
    const cells = line.trim().split(/\s+/)
    if (cells.length < 12 || !/^\d+$/.test(cells[0])) continue
    const [page, num, type, width, height, , , , , , objectId] = cells
    if (!byPage.has(page)) byPage.set(page, [])
    // `num` is the global image index and is exactly the suffix pdfimages uses in file names,
    // so keep every row (including smask/logo); filtering happens at selection time.
    byPage.get(page).push({ num, width: Number(width), height: Number(height), type, objectId })
  }
  return byPage
}

const convertToJpg = (sourcePath, targetPath) => {
  execFileSync('convert', [sourcePath, '-resize', '1200x1200>', '-quality', '82', targetPath])
}

const main = () => {
  const pdfPath = resolvePdf()
  const recipes = JSON.parse(readFileSync(jsonPath, 'utf8'))
  const byPage = parseImageList(pdfPath)

  mkdirSync(outDir, { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
  execFileSync('pdfimages', ['-j', '-p', pdfPath, path.join(tmpDir, 'all')], { stdio: 'ignore' })

  const listing = new Set(readdirSync(tmpDir))
  let assigned = 0
  const missing = []

  recipes.forEach((recipe, index) => {
    const rows = byPage.get(String(recipe.page)) || []
    const candidates = rows.filter((row) => row.type !== 'smask' && row.objectId !== LOGO_OBJECT_ID)
    if (!candidates.length) { missing.push(`${recipe.name} (pág ${recipe.page})`); recipe.imageFile = null; return }
    const best = candidates.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b))
    // pdfimages names files with a 3-digit zero-padded page and its global image index (`num`).
    const pageKey = String(recipe.page).padStart(3, '0')
    const prefix = `all-${pageKey}-${String(best.num).padStart(3, '0')}`
    const sourceName = [...listing].find((name) => name.startsWith(prefix))
    if (!sourceName) { missing.push(`${recipe.name} (pág ${recipe.page}, img ${best.num})`); recipe.imageFile = null; return }

    const base = `${String(index + 1).padStart(4, '0')}-${slugify(recipe.name)}`
    const targetName = `${base}.jpg`
    const sourcePath = path.join(tmpDir, sourceName)
    const targetPath = path.join(outDir, targetName)
    if (sourceName.endsWith('.jpg')) copyFileSync(sourcePath, targetPath)
    else convertToJpg(sourcePath, targetPath)
    recipe.imageFile = targetName
    assigned += 1
  })

  writeFileSync(jsonPath, JSON.stringify(recipes, null, 2))
  rmSync(tmpDir, { recursive: true, force: true })

  console.log(`Imágenes asignadas: ${assigned}/${recipes.length} -> storage/recipes/`)
  if (missing.length) {
    console.log(`Sin imagen (${missing.length}):`)
    for (const item of missing) console.log(' -', item)
  }
}

main()
