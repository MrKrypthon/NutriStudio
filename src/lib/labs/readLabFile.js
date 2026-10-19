// Lee un PDF (o una foto) de resultados de laboratorio y devuelve sus renglones de texto, todo en el
// navegador y sin servicios externos:
//  - PDF digital (el caso habitual: los laboratorios generan el PDF desde su sistema): se extrae el
//    texto que el PDF ya trae, con pdf.js, y se rearman los renglones por su posición en la hoja.
//  - Página escaneada o foto: se reconoce con OCR (Tesseract, modelos de español e inglés) servido
//    desde /ocr de la propia app (ver tools/copy-ocr-assets.mjs). Nada sale del equipo.
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { parseLabReport } from './parser.js'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const OCR_BASE = `${import.meta.env.BASE_URL || '/'}ocr`
// Una página con menos texto que esto se considera escaneada (sólo trae una imagen).
const MIN_TEXT_CHARS = 40
const MAX_PAGES = 15

// Rearma renglones a partir de los fragmentos de texto de una página de pdf.js: agrupa por la
// altura (y) y ordena por x. Un hueco grande entre fragmentos (columnas) se marca con varios
// espacios; el analizador los trata como un separador más.
function linesFromTextContent(content) {
  const items = content.items.filter((item) => item.str && item.str.trim()).map((item) => ({ text: item.str, x: item.transform[4], y: item.transform[5], h: Math.abs(item.transform[3]) || item.height || 10, w: item.width || 0 }))
  items.sort((a, b) => b.y - a.y || a.x - b.x)
  const rows = []
  for (const item of items) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(2, Math.min(candidate.h, item.h) * 0.45))
    if (row) row.items.push(item)
    else rows.push({ y: item.y, h: item.h, items: [item] })
  }
  return rows.sort((a, b) => b.y - a.y).map((row) => {
    const parts = row.items.sort((a, b) => a.x - b.x)
    let line = ''
    let lastEnd = null
    for (const part of parts) {
      if (lastEnd != null) {
        const gap = part.x - lastEnd
        line += gap > part.h * 1.2 ? '   ' : gap > part.h * 0.15 ? ' ' : ''
      }
      line += part.text
      lastEnd = part.x + part.w
    }
    return line.trim()
  }).filter(Boolean)
}

let ocrWorkerPromise = null
let ocrProgress = () => {}
async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import('tesseract.js').then(({ createWorker }) => createWorker(['spa', 'eng'], 1, {
      workerPath: `${OCR_BASE}/worker.min.js`,
      corePath: `${OCR_BASE}/core`,
      langPath: `${OCR_BASE}/lang`,
      gzip: true,
      logger: (message) => { if (message.status === 'recognizing text') ocrProgress(message.progress || 0) },
    })).catch((error) => { ocrWorkerPromise = null; throw error })
  }
  return ocrWorkerPromise
}

// Limpia la imagen antes del OCR: la agranda (los escaneos a 100-150 ppp pierden puntos decimales
// y letras), la pasa a grises y estira el contraste (papel gris, tinta tenue). En pruebas con un
// escaneo malo esto pasó de nombres ilegibles a casi todos correctos.
async function prepareForOcr(source) {
  const bitmap = source instanceof HTMLCanvasElement ? source : await createImageBitmap(source)
  const width = bitmap.width
  const height = bitmap.height
  const scale = Math.min(4, Math.max(1, 2600 / width))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  if (bitmap.close) bitmap.close()
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = image.data
  // Histograma de luminosidad para estirar entre los percentiles 1 y 99.
  const histogram = new Uint32Array(256)
  for (let i = 0; i < pixels.length; i += 4) histogram[(pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000 | 0] += 1
  const total = pixels.length / 4
  let low = 0; let high = 255; let count = 0
  for (let v = 0; v < 256; v++) { count += histogram[v]; if (count >= total * 0.01) { low = v; break } }
  count = 0
  for (let v = 255; v >= 0; v--) { count += histogram[v]; if (count >= total * 0.01) { high = v; break } }
  const span = Math.max(1, high - low)
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000
    const value = Math.max(0, Math.min(255, ((gray - low) * 255) / span))
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value
  }
  context.putImageData(image, 0, 0)
  return canvas
}

// Reconoce el texto de una imagen o un canvas. Tesseract conserva los renglones del original.
const toLines = (text) => String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
// ¿Algún estudio quedó con un valor imposible? Señal de que el OCR se comió un dígito.
const hasImpossible = (lines) => parseLabReport(lines).items.some((item) => item.warnings.some((warning) => warning.includes('físicamente posible')))

async function ocrImage(source, onProgress) {
  ocrProgress = onProgress || (() => {})
  const worker = await getOcrWorker()
  const { data } = await worker.recognize(await prepareForOcr(source))
  const lines = toLines(data.text)
  // Segunda lectura sin la limpieza de imagen, sólo si la primera dejó valores imposibles: cada
  // preparación falla en dígitos distintos, y el analizador toma de ésta lo que la otra perdió.
  let altLines = []
  if (hasImpossible(lines)) altLines = toLines((await worker.recognize(source instanceof HTMLCanvasElement ? source : await createImageBitmap(source).then((bitmap) => { const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height; canvas.getContext('2d').drawImage(bitmap, 0, 0); return canvas }))).data.text)
  ocrProgress = () => {}
  return { lines, altLines, confidence: data.confidence ?? null }
}

// Dibuja una página del PDF a buena resolución para el OCR (~2400 px de ancho).
async function renderPage(page) {
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: Math.min(4, Math.max(1.5, 2400 / base.width)) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, viewport, canvas }).promise
  return canvas
}

/**
 * Lee un archivo de laboratorio. `onProgress({ stage, page, pages, progress })` informa el avance.
 * Devuelve { lines, pages, method: 'text' | 'ocr' | 'mixed', ocrPages, confidence }.
 */
export async function readLabFile(file, onProgress = () => {}) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
  if (!isPdf) {
    if (!/^image\/(png|jpe?g|webp|bmp)$/.test(file.type)) throw new Error('Sube un PDF o una foto (JPG, PNG o WebP) de los resultados.')
    onProgress({ stage: 'ocr', page: 1, pages: 1, progress: 0 })
    const result = await ocrImage(file, (progress) => onProgress({ stage: 'ocr', page: 1, pages: 1, progress }))
    return { lines: result.lines, altLines: result.altLines, pages: 1, method: 'ocr', ocrPages: 1, confidence: result.confidence }
  }
  onProgress({ stage: 'reading', page: 0, pages: 0, progress: 0 })
  const data = new Uint8Array(await file.arrayBuffer())
  let pdf
  const loadingTask = pdfjs.getDocument({ data, isEvalSupported: false })
  try {
    pdf = await loadingTask.promise
  } catch (error) {
    if (error?.name === 'PasswordException') throw new Error('El PDF está protegido con contraseña. Ábrelo, guárdalo sin contraseña y vuelve a intentarlo.')
    throw new Error('No se pudo abrir el PDF. Revisa que el archivo no esté dañado.')
  }
  const totalPages = pdf.numPages
  const pages = Math.min(totalPages, MAX_PAGES)
  const lines = []
  const altLines = []
  let ocrPages = 0
  const confidences = []
  for (let number = 1; number <= pages; number++) {
    const page = await pdf.getPage(number)
    onProgress({ stage: 'reading', page: number, pages, progress: (number - 1) / pages })
    const pageLines = linesFromTextContent(await page.getTextContent())
    if (pageLines.join('').replace(/\s/g, '').length >= MIN_TEXT_CHARS) {
      lines.push(...pageLines)
    } else {
      // Página escaneada: se reconoce con OCR.
      onProgress({ stage: 'ocr', page: number, pages, progress: 0 })
      const canvas = await renderPage(page)
      const result = await ocrImage(canvas, (progress) => onProgress({ stage: 'ocr', page: number, pages, progress }))
      lines.push(...result.lines)
      altLines.push(...result.altLines)
      if (result.confidence != null) confidences.push(result.confidence)
      ocrPages += 1
    }
    page.cleanup()
  }
  await loadingTask.destroy()
  return {
    lines,
    altLines,
    pages: totalPages,
    truncated: totalPages > MAX_PAGES,
    method: ocrPages === 0 ? 'text' : ocrPages === pages ? 'ocr' : 'mixed',
    ocrPages,
    confidence: confidences.length ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length) : null,
  }
}
