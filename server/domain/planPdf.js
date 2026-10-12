import { EQUIVALENT_GROUPS, buildMealOptions } from './documents.js'
import { EQUIVALENT_LISTS } from './equivalentLists.js'

// Plan de alimentación que se entrega a la paciente: hoja carta apaisada con una tabla de tiempos
// de comida × opciones (foto, nombre e ingredientes de cada receta), las porciones por grupo de
// equivalentes, los acuerdos y las listas de alimentos equivalentes. Todo se posiciona a mano (el
// documento se crea con margen 0) porque las filas se parten entre hojas y pdfkit no tiene tablas.

const PAGE_W = 792
const PAGE_H = 612
const X0 = 36
const TABLE_W = PAGE_W - X0 * 2
const CONTENT_TOP = 100
const CONTENT_BOTTOM = 516

const TEXT = '#1F1F1F'
const SOFT = '#4A4A4A'
const WAVE_RED = '#F0564F'
const WAVE_GREEN = '#A5CD45'
const WAVE_TINT = '#E9F0DF'
const NAVY = '#2F2A6B'
const TIME_FILL = '#B9C9F0'
const TIME_TEXT = '#3B4466'

// Un color por columna de opción (encabezado fuerte, celda en su tono claro).
const OPTION_COLORS = [
  { head: '#D81B7A', cell: '#FDE3EC' },
  { head: '#7B68EE', cell: '#D8D2EE' },
  { head: '#1E88E5', cell: '#CFE2FB' },
  { head: '#F26B4E', cell: '#FDD5CD' },
  { head: '#EBA41F', cell: '#FDE2AF' },
  { head: '#2BA89A', cell: '#CDEDE8' },
  { head: '#7CB342', cell: '#E2F0CB' },
]

const GROUP_BADGES = {
  V: { color: '#6FCF4A', text: 'V' },
  F: { color: '#8EDB55', text: 'F' },
  C: { color: '#F7DC3C', text: 'C' },
  LEG: { color: '#F7C948', text: 'LEG' },
  AOA_MB: { color: '#F4514F', text: 'AOA', sub: 'MB' },
  AOA_B: { color: '#F4514F', text: 'AOA', sub: 'B' },
  AOA_M: { color: '#F4514F', text: 'AOA', sub: 'M' },
  AOA_A: { color: '#F4514F', text: 'AOA', sub: 'A' },
  LAC: { color: '#3AA8F5', text: 'LAC' },
  G_CP: { color: '#F58A3C', text: 'G', sub: 'C/P' },
  G_SP: { color: '#F58A3C', text: 'G', sub: 'S/P' },
}

const DEFAULT_INSTRUCTIONS = [
  'Los menús son totalmente intercambiables, es decir, puedes elegir cualquier desayuno, comida o cena.',
  'Puedes escoger cualquier fruta de la lista de alimentos equivalentes. Ten en cuenta que 1 porción de fruta es ½ plátano; cuando te indique 2 frutas puedes elegir comer un plátano entero.',
  'Las nueces son las del grupo AG c/p.',
]

// Las fuentes estándar de pdfkit sólo cubren WinAnsi: cualquier otro carácter (⅓, emojis…) saldría
// como basura, así que se traduce lo común y se descarta el resto.
const cleanText = (value) => String(value ?? '')
  .replace(/⅓/g, '1/3').replace(/⅔/g, '2/3').replace(/⅛/g, '1/8').replace(/⁄/g, '/')
  .replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const formatQuantity = (value) => {
  const whole = Math.floor(value)
  const half = value - whole >= 0.5
  if (!half) return String(whole)
  return whole ? `${whole}½` : '½'
}

const formatNumber = (value, digits = 1) => String(Math.round(Number(value) * 10 ** digits) / 10 ** digits)

// Parte un texto en renglones que caben en `width` con la fuente/tamaño activos en `file`.
function wrapText(file, text, width) {
  const lines = []
  let current = ''
  for (const word of cleanText(text).split(' ')) {
    if (!word) continue
    const candidate = current ? `${current} ${word}` : word
    if (!current || file.widthOfString(candidate) <= width) current = candidate
    else { lines.push(current); current = word }
  }
  if (current) lines.push(current)
  return lines
}

function drawWaves(file) {
  // Arriba a la izquierda…
  file.path(`M0,0 L640,0 C480,38 290,74 0,94 Z`).fill(WAVE_TINT)
  file.path(`M0,0 L570,0 C420,30 250,58 0,74 Z`).fill(WAVE_GREEN)
  file.path(`M0,0 L480,0 C350,22 200,40 0,52 Z`).fill(WAVE_RED)
  // …y abajo, subiendo hacia la derecha.
  file.path(`M170,${PAGE_H} C420,${PAGE_H - 12} 570,${PAGE_H - 78} ${PAGE_W},${PAGE_H - 92} L${PAGE_W},${PAGE_H} Z`).fill(WAVE_TINT)
  file.path(`M0,${PAGE_H - 46} C60,${PAGE_H - 22} 130,${PAGE_H - 6} 215,${PAGE_H} L0,${PAGE_H} Z`).fill(WAVE_TINT)
  file.path(`M290,${PAGE_H} C480,${PAGE_H - 8} 610,${PAGE_H - 60} ${PAGE_W},${PAGE_H - 74} L${PAGE_W},${PAGE_H} Z`).fill(WAVE_GREEN)
  file.path(`M0,${PAGE_H - 32} C45,${PAGE_H - 14} 100,${PAGE_H - 4} 160,${PAGE_H} L0,${PAGE_H} Z`).fill(WAVE_GREEN)
  file.path(`M400,${PAGE_H} C540,${PAGE_H - 6} 650,${PAGE_H - 42} ${PAGE_W},${PAGE_H - 54} L${PAGE_W},${PAGE_H} Z`).fill(WAVE_RED)
  file.path(`M0,${PAGE_H - 18} C30,${PAGE_H - 8} 65,${PAGE_H - 2} 105,${PAGE_H} L0,${PAGE_H} Z`).fill(WAVE_RED)
}

// Encabezado y pie que se repiten en cada hoja: olas, título, nombre de la nutrióloga, logo de la
// práctica y sus datos de contacto.
function drawPageChrome(file, data) {
  drawWaves(file)
  file.font('Helvetica-Bold').fontSize(12).fillColor(TEXT).text('Plan de Alimentación', 0, 44, { width: PAGE_W, align: 'center', lineBreak: false })
  if (data.nutritionistName) file.font('Helvetica').fontSize(11).fillColor(SOFT).text(cleanText(data.nutritionistName), 0, 61, { width: PAGE_W, align: 'center', lineBreak: false })
  if (data.logo) {
    try { file.image(data.logo, PAGE_W - 116, 8, { fit: [84, 84], align: 'center', valign: 'center' }) } catch { /* logo en un formato que pdfkit no lee: la hoja sale sin él */ }
  }
  const contact = (data.contact || []).map(cleanText).filter(Boolean)
  contact.forEach((line, index) => {
    // Siempre debajo de la tabla (CONTENT_BOTTOM) y sobre las olas, con uno, dos o tres renglones.
    const y = CONTENT_BOTTOM + 8 + index * 13 + (3 - Math.min(contact.length, 3)) * 6
    file.circle(64, y + 4, 3.2).fill(WAVE_RED)
    file.font('Helvetica').fontSize(9).fillColor(WAVE_RED).text(line, 73, y, { lineBreak: false })
  })
}

function addPage(file, data) {
  file.addPage()
  drawPageChrome(file, data)
  return CONTENT_TOP
}

// Renglón "Nombre · Peso · % Grasa · M.M (kg)" sobre la tabla; sólo lo que el expediente tiene.
function drawPatientLine(file, data, y) {
  const fields = [
    ['Nombre', data.patientName],
    ['Peso', data.weightKg != null ? `${formatNumber(data.weightKg)} Kg` : null],
    ['% Grasa', data.bodyFatPercent != null ? `${formatNumber(data.bodyFatPercent)}%` : null],
    ['M.M (kg)', data.muscleMassKg != null ? formatNumber(data.muscleMassKg) : null],
    ['Céd. Prof', data.licenseNumber],
  ].filter(([, value]) => value)
  if (!fields.length) return y
  file.font('Helvetica').fontSize(9.5).fillColor(TEXT)
  const step = fields.length > 1 ? (TABLE_W - 120) / (fields.length - 1) : 0
  fields.forEach(([label, value], index) => {
    const text = `${label}: ${cleanText(value)}`
    const x = index === 0 ? X0 + 6 : X0 + 6 + step * index
    file.text(text, x, y, { lineBreak: false })
  })
  return y + 14
}

function drawBadge(file, code, cx, cy, radius) {
  const badge = GROUP_BADGES[code]
  if (!badge) return
  file.circle(cx, cy, radius).fill(badge.color)
  const mainSize = badge.text.length > 1 ? radius * 0.58 : radius * 0.8
  file.font('Helvetica-Bold').fontSize(mainSize).fillColor(TEXT)
  file.text(badge.text, cx - radius, cy - mainSize * (badge.sub ? 0.85 : 0.36), { width: radius * 2, align: 'center', lineBreak: false })
  if (badge.sub) {
    const subSize = radius * 0.4
    file.font('Helvetica-Bold').fontSize(subSize).text(badge.sub, cx - radius, cy + subSize * 0.35, { width: radius * 2, align: 'center', lineBreak: false })
  }
}

const TIME_W = 46
const PORTION_W = 52
const HEADER_H = 14
const LINE_H = 8.7
const CELL_PAD = 5
const ROW_GAP = 3
const BADGE_STEP = 21

function drawTableHeader(file, layout, y) {
  file.rect(X0, y, TIME_W - 1, HEADER_H).fill(NAVY)
  file.rect(X0 + TIME_W, y, PORTION_W - 1, HEADER_H).fill(NAVY)
  file.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF').text('Porción', X0 + TIME_W, y + 3.5, { width: PORTION_W - 1, align: 'center', lineBreak: false })
  for (let index = 0; index < layout.columns; index++) {
    const x = layout.optionX(index)
    file.rect(x, y, layout.colW - 1, HEADER_H).fill(OPTION_COLORS[index % OPTION_COLORS.length].head)
    file.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF').text(`Opción ${index + 1}`, x, y + 3.5, { width: layout.colW - 1, align: 'center', lineBreak: false })
  }
  return y + HEADER_H + 1
}

// Nombre de la receta en negritas + un renglón por ingrediente, ya partidos al ancho de la celda.
function buildCellLines(file, option, width) {
  const lines = []
  file.font('Helvetica-Bold').fontSize(7.6)
  for (const line of wrapText(file, option.recipeName, width)) lines.push({ text: line, bold: true })
  file.font('Helvetica').fontSize(7.2)
  for (const ingredient of option.ingredients || []) {
    const clean = cleanText(ingredient).replace(/^[-•·]\s*/, '')
    if (!clean) continue
    for (const line of wrapText(file, `-${clean}`, width)) lines.push({ text: line, bold: false })
  }
  const notes = []
  if ((option.portions || 1) > 1) notes.push(`Rinde ${formatNumber(option.portions)} porciones`)
  if ((option.servings || 1) !== 1 || (option.portions || 1) > 1) notes.push(`te toca${option.servings === 1 ? '' : 'n'} ${formatNumber(option.servings || 1)}`)
  if (notes.length) for (const line of wrapText(file, `(${notes.join(' · ')})`, width)) lines.push({ text: line, bold: false, soft: true })
  return lines
}

function drawTimeLabel(file, label, x, y, height) {
  file.rect(x, y, TIME_W - 1, height).fill(TIME_FILL)
  let size = 11
  file.font('Helvetica').fontSize(size)
  const text = cleanText(label)
  while (size > 6 && file.widthOfString(text) > height - 8) { size -= 0.5; file.fontSize(size) }
  if (file.widthOfString(text) > height - 4) return
  const cx = x + (TIME_W - 1) / 2
  const cy = y + height / 2
  file.save()
  file.rotate(-90, { origin: [cx, cy] })
  file.fillColor(TIME_TEXT).text(text, cx - file.widthOfString(text) / 2, cy - size * 0.36, { lineBreak: false })
  file.restore()
}

function drawPhoto(file, image, x, y, width, height) {
  if (!image) return
  file.save()
  try {
    file.rect(x, y, width, height).clip()
    file.image(image, x, y, { cover: [width, height], align: 'center', valign: 'center' })
  } catch { /* foto ilegible para pdfkit: la celda queda sólo con el texto */ }
  file.restore()
}

function drawMealRow(file, data, layout, row, startY) {
  let y = startY
  const textW = layout.colW - 1 - CELL_PAD * 2
  const cells = row.options.slice(0, layout.columns).map((option) => ({ image: option.imageFile ? data.images?.get(option.imageFile) : null, lines: buildCellLines(file, option, textW) }))
  const photoH = cells.some((cell) => cell.image) ? Math.min(Math.round(textW * 0.66), 82) : 0
  const headH = photoH ? photoH + 4 : 0
  const maxLines = Math.max(0, ...cells.map((cell) => cell.lines.length))
  const badgesH = row.portions.length ? row.portions.length * BADGE_STEP + 6 : 0
  let offset = 0
  let first = true
  while (first || offset < maxLines) {
    // Una fila nueva necesita lugar para la foto y unos renglones; una continuación, para tres.
    const needed = first ? CELL_PAD + headH + Math.min(maxLines, 4) * LINE_H + CELL_PAD : CELL_PAD * 2 + Math.min(maxLines - offset, 3) * LINE_H
    if (CONTENT_BOTTOM - y < needed) y = drawTableHeader(file, layout, addPage(file, data))
    const available = CONTENT_BOTTOM - y
    const fits = Math.max(0, Math.floor((available - CELL_PAD * 2 - (first ? headH : 0)) / LINE_H))
    const count = Math.min(maxLines - offset, fits)
    let height = CELL_PAD + (first ? headH : 0) + count * LINE_H + CELL_PAD
    if (first) height = Math.max(height, Math.min(badgesH, available))
    drawTimeLabel(file, row.label, X0, y, height)
    if (first) {
      row.portions.forEach((portion, index) => {
        const cy = y + 6 + BADGE_STEP * index + 8.5
        if (cy + 9 > y + height) return
        file.font('Helvetica').fontSize(9).fillColor(TEXT).text(formatQuantity(portion.quantity), X0 + TIME_W + 3, cy - 3.4, { width: 18, align: 'center', lineBreak: false })
        drawBadge(file, portion.code, X0 + TIME_W + 35, cy, 8.5)
      })
    }
    cells.forEach((cell, index) => {
      const x = layout.optionX(index)
      file.rect(x, y, layout.colW - 1, height).fill(OPTION_COLORS[index % OPTION_COLORS.length].cell)
      if (first && cell.image) drawPhoto(file, cell.image, x + CELL_PAD, y + CELL_PAD, textW, photoH)
      const textY = y + CELL_PAD + (first ? headH : 0)
      cell.lines.slice(offset, offset + count).forEach((line, lineIndex) => {
        file.font(line.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(line.bold ? 7.6 : 7.2).fillColor(line.soft ? SOFT : TEXT)
        file.text(line.text, x + CELL_PAD, textY + lineIndex * LINE_H, { lineBreak: false })
      })
    })
    y += height
    offset += count
    first = false
    // Hoja llena sin haber podido escribir ni un renglón: se sigue en la siguiente.
    if (offset < maxLines && count === 0) y = CONTENT_BOTTOM
  }
  return y + ROW_GAP
}

function drawLegend(file, data, startY) {
  let y = startY + 12
  if (CONTENT_BOTTOM - y < 44) y = addPage(file, data) + 8
  const step = 50
  EQUIVALENT_GROUPS.forEach((group, index) => {
    const cx = X0 + 20 + index * step
    drawBadge(file, group.code, cx, y + 12, 11)
    const words = group.label.replace(/^(AOA|Grasa) /, '$1\n').split('\n')
    file.font('Helvetica').fontSize(5.2).fillColor(TEXT)
    words.forEach((word, wordIndex) => file.text(word, cx - step / 2, y + 28 + wordIndex * 6.2, { width: step, align: 'center', lineBreak: false }))
  })
  return y + 46
}

function drawParagraphList(file, data, title, items, startY) {
  let y = startY
  if (CONTENT_BOTTOM - y < 40) y = addPage(file, data) + 14
  file.font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(title, X0 + 30, y, { lineBreak: false })
  y += 22
  for (const item of items) {
    file.font('Helvetica').fontSize(9.5)
    const lines = wrapText(file, `-${cleanText(item).replace(/^[-•·]\s*/, '')}`, TABLE_W - 80)
    if (CONTENT_BOTTOM - y < lines.length * 13) y = addPage(file, data) + 14
    for (const line of lines) {
      file.font('Helvetica').fontSize(9.5).fillColor(TEXT).text(line, X0 + 30, y, { lineBreak: false })
      y += 13
    }
  }
  return y + 22
}

const splitNotes = (text) => String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

// Caja de una lista de equivalentes: banda de color con el nombre del grupo y los renglones debajo.
function drawEquivalentBox(file, { x, y, width, title, color, tint, items, footnote }) {
  const bandH = 22
  const lineH = 9.4
  file.font('Helvetica').fontSize(7.4)
  const lines = items.flatMap((item) => wrapText(file, item, width - 16))
  const height = bandH + 8 + lines.length * lineH + 6
  file.rect(x, y, width, height).fill(tint)
  file.rect(x + 4, y, width - 8, bandH).fill(color)
  file.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF').text(title, x, y + 5.5, { width, align: 'center', lineBreak: false })
  lines.forEach((line, index) => {
    file.font('Helvetica').fontSize(7.4).fillColor(TEXT).text(line, x + 8, y + bandH + 8 + index * lineH, { lineBreak: false })
  })
  let bottom = y + height
  if (footnote) {
    file.font('Helvetica').fontSize(7)
    const noteLines = wrapText(file, footnote.text, width - 16 - file.widthOfString(`${footnote.label} `))
    const noteH = noteLines.length * 9 + 8
    file.rect(x + 6, bottom + 6, width - 12, noteH).fill('#DCEFEA')
    file.font('Helvetica-Bold').fontSize(7).fillColor(TEXT).text(footnote.label, x + 10, bottom + 10, { lineBreak: false })
    const indent = file.widthOfString(`${footnote.label} `)
    noteLines.forEach((line, index) => file.font('Helvetica').fontSize(7).fillColor(TEXT).text(line, x + 10 + indent, bottom + 10 + index * 9, { lineBreak: false }))
    bottom += 6 + noteH
  }
  return bottom
}

function drawEquivalentPages(file, data) {
  const GREEN = { color: '#7EDB43', tint: '#E9F6DC' }
  const YELLOW = { color: '#ECE445', tint: '#FAF9DD' }
  const ORANGE = { color: '#FFA92E', tint: '#FDEEDD' }
  const BLUE = { color: '#35B3FF', tint: '#DDF0FE' }

  let y = addPage(file, data)
  file.font('Helvetica').fontSize(11).fillColor(TEXT).text('Alimentos equivalentes:', X0 + 30, y, { lineBreak: false })
  y += 18
  const gap = 28
  const colW = (TABLE_W - 120 - gap * 2) / 3
  const colX = (index) => X0 + 60 + index * (colW + gap)
  drawEquivalentBox(file, { x: colX(0), y, width: colW, title: 'Vegetales', ...GREEN, items: EQUIVALENT_LISTS.VEGETABLES, footnote: { label: 'LIBRES:', text: EQUIVALENT_LISTS.FREE_VEGETABLES } })
  drawEquivalentBox(file, { x: colX(1), y, width: colW, title: 'Frutas', ...GREEN, items: EQUIVALENT_LISTS.FRUITS })
  drawEquivalentBox(file, { x: colX(2), y, width: colW, title: 'Cereales', ...YELLOW, items: EQUIVALENT_LISTS.CEREALS })

  y = addPage(file, data) + 14
  const leftW = 400
  const rightX = X0 + 20 + leftW + 30
  const rightW = TABLE_W - 40 - leftW - 30
  file.rect(X0 + 20, y, leftW, 30).fill('#EFEAE4')
  file.font('Helvetica-Bold').fontSize(15).fillColor(TEXT).text('Aceites y Grasas', X0 + 20, y + 8, { width: leftW, align: 'center', lineBreak: false })
  const halfW = (leftW - 16) / 2
  drawEquivalentBox(file, { x: X0 + 20, y: y + 42, width: halfW, title: 'AG s/p', ...ORANGE, items: EQUIVALENT_LISTS.FATS_WITHOUT_PROTEIN })
  drawEquivalentBox(file, { x: X0 + 20 + halfW + 16, y: y + 42, width: halfW, title: 'AG c/p', ...ORANGE, items: EQUIVALENT_LISTS.FATS_WITH_PROTEIN })
  const legumesBottom = drawEquivalentBox(file, { x: rightX, y, width: rightW, title: 'Leguminosas', ...YELLOW, items: EQUIVALENT_LISTS.LEGUMES })
  drawEquivalentBox(file, { x: rightX, y: legumesBottom + 14, width: rightW, title: 'Lácteos', ...BLUE, items: EQUIVALENT_LISTS.DAIRY })
}

// `data`: { patientName, nutritionistName, licenseNumber, weightKg, bodyFatPercent, muscleMassKg, menu,
// recommendations, hydrationNote, contact: string[], logo, images: Map<imageFile, Buffer> }.
// `file` debe ser un PDFDocument carta apaisado con margen 0 y su primera hoja ya creada.
function drawNutritionPlan(file, input) {
  // El logo va en todas las hojas: se abre una sola vez para no incrustarlo una vez por hoja.
  let logo = null
  if (input.logo) { try { logo = file.openImage(input.logo) } catch { logo = null } }
  const data = { ...input, logo }
  drawPageChrome(file, data)
  let y = drawPatientLine(file, data, CONTENT_TOP + 2)
  const rows = buildMealOptions(data.menu)
  if (!rows.length) {
    file.font('Helvetica').fontSize(10).fillColor(SOFT).text('Este plan todavía no tiene recetas asignadas.', X0 + 6, y + 10, { lineBreak: false })
  } else {
    // Hasta 7 opciones (una por día); con pocas, la columna no crece más que con 4 para que las
    // fotos no se vuelvan enormes.
    const columns = Math.min(7, Math.max(...rows.map((row) => row.options.length)))
    const colW = (TABLE_W - TIME_W - PORTION_W) / Math.max(columns, 4)
    const layout = { columns, colW, optionX: (index) => X0 + TIME_W + PORTION_W + index * colW }
    y = drawTableHeader(file, layout, y)
    for (const row of rows) y = drawMealRow(file, data, layout, row, y)
    y = drawLegend(file, data, y)
  }

  const agreements = [...splitNotes(data.recommendations), ...splitNotes(data.hydrationNote)]
  y = addPage(file, data) + 14
  if (agreements.length) y = drawParagraphList(file, data, 'Acuerdos y recomendaciones:', agreements, y)
  drawParagraphList(file, data, 'Instrucciones:', DEFAULT_INSTRUCTIONS, y)

  drawEquivalentPages(file, data)
}

export { drawNutritionPlan }
