// Copia a public/ocr/ lo que Tesseract (OCR) y pdf.js necesitan en el navegador: el worker, el
// motor WebAssembly y los modelos de español e inglés. Por defecto tesseract.js los descarga de un
// CDN; servirlos desde la propia app hace que el análisis de PDFs de laboratorio funcione sin
// internet y que ningún dato del paciente salga del equipo. Corre en postinstall, predev y prebuild.
import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'public', 'ocr')
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz', 'lang/spa.traineddata.gz'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
]

let copied = 0
for (const [from, to] of files) {
  const source = path.join(root, from)
  const target = path.join(out, to)
  try {
    const [a, b] = await Promise.all([stat(source), stat(target).catch(() => null)])
    if (b && b.size === a.size) continue
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(source, target)
    copied += 1
  } catch (error) {
    console.warn(`[ocr] No se pudo copiar ${from}: ${error.message}`)
  }
}
if (copied) console.log(`[ocr] ${copied} archivo(s) copiados a public/ocr`)
