import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EQUIVALENT_GROUPS, buildMealOptions } from './documents.js'
import { EQUIVALENT_LISTS } from './equivalentLists.js'

// Plan de alimentación que se entrega a la paciente: hoja carta apaisada con una tabla de tiempos
// de comida × opciones (foto, nombre e ingredientes de cada receta), las porciones por grupo de
// equivalentes, los acuerdos y las listas de alimentos equivalentes. Todo se posiciona a mano (el
// documento se crea con margen 0) porque las filas se parten entre hojas y pdfkit no tiene tablas.
// Las medidas salen del formato en papel de la nutrióloga (misma hoja, mismas columnas y tipografía).

const PAGE_W = 792
const PAGE_H = 612
const X0 = 35
const TABLE_W = 721
const FIRST_TOP = 108
const CONTENT_TOP = 96
const CONTENT_BOTTOM = 519

const TEXT = '#1A1A1A'
const SOFT = '#555555'
const WAVE_RED = '#F0544F'
const WAVE_GREEN = '#A4CE39'
const WAVE_TINT = '#E8EFDD'
const NAVY = '#2F2A6B'
const TIME_FILL = '#B8C8EE'
const TIME_TEXT = '#46507A'

// Un color por columna de opción (encabezado fuerte, celda en su tono claro).
const OPTION_COLORS = [
  { head: '#D81B7A', cell: '#FDE3EC' },
  { head: '#7B68EE', cell: '#D5CEEB' },
  { head: '#1E88E5', cell: '#CDE1FA' },
  { head: '#F26B4E', cell: '#FDD6CE' },
  { head: '#EBA41F', cell: '#FEE2AE' },
  { head: '#2BA89A', cell: '#CDEDE8' },
  { head: '#7CB342', cell: '#E2F0CB' },
]

const GROUP_BADGES = {
  V: { color: '#6FD145', text: 'V' },
  F: { color: '#7FDD52', text: 'F' },
  C: { color: '#F8DC3E', text: 'C' },
  LEG: { color: '#F7C948', text: 'LEG' },
  AOA_MB: { color: '#F5504E', text: 'AOA', sub: 'MB' },
  AOA_B: { color: '#F5504E', text: 'AOA', sub: 'B' },
  AOA_M: { color: '#F5504E', text: 'AOA', sub: 'M' },
  AOA_A: { color: '#F5504E', text: 'AOA', sub: 'A' },
  LAC: { color: '#3AA8F5', text: 'LAC' },
  G_CP: { color: '#F78B3D', text: 'G', sub: 'C/P' },
  G_SP: { color: '#F78B3D', text: 'G', sub: 'S/P' },
  AZ: { color: '#C9A0E8', text: 'AZ' },
}

const DEFAULT_INSTRUCTIONS = [
  'Los menús son totalmente intercambiables, es decir, puedes elegir cualquier desayuno, comida o cena.',
  'Puedes escoger cualquier fruta de la lista de alimentos equivalentes. Ten en cuenta que 1 porción de fruta, es ½ plátano, cuando te indique 2 frutas puedes elegir comer un plátano entero.',
  'Las nueces son las del grupo AG c/p',
]

// Tipografías del formato en papel: Montserrat para el plan y Poppins para las listas de
// equivalentes. Si faltaran los archivos, el documento sale con las fuentes estándar de pdfkit.
const FONT_FILES = {
  regular: 'Montserrat-Regular.ttf',
  medium: 'Montserrat-Medium.ttf',
  bold: 'Montserrat-Bold.ttf',
  list: 'Poppins-Regular.ttf',
  listBold: 'Poppins-Bold.ttf',
}
const FONT_FALLBACK = { regular: 'Helvetica', medium: 'Helvetica', bold: 'Helvetica-Bold', list: 'Helvetica', listBold: 'Helvetica-Bold' }

function registerFonts(file) {
  const fonts = {}
  for (const [key, fileName] of Object.entries(FONT_FILES)) {
    const fontPath = fileURLToPath(new URL(`../assets/fonts/${fileName}`, import.meta.url))
    if (existsSync(fontPath)) {
      try { file.registerFont(`plan-${key}`, fontPath); fonts[key] = `plan-${key}`; continue } catch { /* archivo dañado: se usa la fuente estándar */ }
    }
    fonts[key] = FONT_FALLBACK[key]
  }
  return fonts
}

// Se descarta lo que estas fuentes no traen (emojis, símbolos raros) para que no salga como basura.
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
  file.path('M0,0 L600,0 C460,40 250,78 0,88 Z').fill(WAVE_TINT)
  file.path('M0,0 L572,0 C410,34 220,56 0,59 Z').fill(WAVE_GREEN)
  file.path('M0,0 L530,0 C380,20 180,30 0,29 Z').fill(WAVE_RED)
  // …y abajo, subiendo hacia la derecha.
  file.path('M206,612 C380,600 520,548 792,523 L792,612 Z').fill(WAVE_TINT)
  file.path('M0,578 C60,596 130,608 206,612 L0,612 Z').fill(WAVE_TINT)
  file.path('M298,612 C470,604 600,566 792,549 L792,612 Z').fill(WAVE_GREEN)
  file.path('M0,582 C35,598 70,608 100,612 L0,612 Z').fill(WAVE_GREEN)
  file.path('M365,612 C500,606 600,566 670,568 C720,569 760,574 792,578 L792,612 Z').fill(WAVE_RED)
  file.path('M0,590 C20,600 40,608 58,612 L0,612 Z').fill(WAVE_RED)
}

// Iconos del pie de contacto (teléfono, ubicación, correo): círculo rojo con el dibujo en blanco.
function drawContactIcon(file, kind, cx, cy) {
  file.circle(cx, cy, 5.6).fill(WAVE_RED)
  file.save()
  if (kind === 'phone') {
    file.lineWidth(2).lineCap('round').strokeColor('#FFFFFF')
    file.path(`M${cx - 2.2},${cy - 2.4} Q${cx - 2},${cy + 2} ${cx + 2.4},${cy + 2.2}`).stroke()
  } else if (kind === 'address') {
    file.path(`M${cx},${cy + 3.6} L${cx - 2.6},${cy - 0.4} A2.8,2.8 0 1 1 ${cx + 2.6},${cy - 0.4} Z`).fill('#FFFFFF')
    file.circle(cx, cy - 1.1, 1).fill(WAVE_RED)
  } else {
    file.roundedRect(cx - 3.2, cy - 2.2, 6.4, 4.4, 0.8).fill('#FFFFFF')
    file.lineWidth(0.7).strokeColor(WAVE_RED).path(`M${cx - 3},${cy - 1.8} L${cx},${cy + 0.5} L${cx + 3},${cy - 1.8}`).stroke()
  }
  file.restore()
}

// Encabezado y pie que se repiten en cada hoja: olas, título, nombre de la nutrióloga, logo de la
// práctica y sus datos de contacto.
function drawPageChrome(file, data) {
  const { fonts } = data
  drawWaves(file)
  file.font(fonts.bold).fontSize(12).fillColor(TEXT).text('Plan de Alimentación', 0, 45, { width: PAGE_W, align: 'center', lineBreak: false })
  if (data.nutritionistName) file.font(fonts.regular).fontSize(12).fillColor('#333333').text(cleanText(data.nutritionistName), 0, 62, { width: PAGE_W, align: 'center', lineBreak: false })
  if (data.logo) {
    try { file.image(data.logo, 676, 2, { fit: [86, 92], align: 'center', valign: 'center' }) } catch { /* logo en un formato que pdfkit no lee: la hoja sale sin él */ }
  }
  const contact = (data.contact || []).filter((item) => item?.text)
  contact.forEach((item, index) => {
    // Siempre debajo de la tabla (CONTENT_BOTTOM) y sobre las olas, con uno, dos o tres renglones.
    const y = CONTENT_BOTTOM + 9 + index * 14 + (3 - Math.min(contact.length, 3)) * 7
    drawContactIcon(file, item.kind, 74, y + 6)
    file.font(fonts.regular).fontSize(10.5).fillColor(WAVE_RED).text(cleanText(item.text), 85, y, { lineBreak: false })
  })
}

function addPage(file, data) {
  file.addPage()
  drawPageChrome(file, data)
  return CONTENT_TOP
}

// Renglón "Nombre · Peso · % Grasa · M.M (kg) · Céd. Prof" sobre la tabla; sólo lo que hay. El
// primero va pegado a la izquierda, el último a la derecha y los demás repartidos entre ambos.
function drawPatientLine(file, data, y) {
  const fields = [
    ['Nombre', data.patientName],
    ['Peso', data.weightKg != null ? `${formatNumber(data.weightKg)} Kg` : null],
    ['% Grasa', data.bodyFatPercent != null ? `${formatNumber(data.bodyFatPercent)}%` : null],
    ['M.M (kg)', data.muscleMassKg != null ? formatNumber(data.muscleMassKg) : null],
    ['Céd. Prof', data.licenseNumber],
  ].filter(([, value]) => value).map(([label, value]) => `${label}: ${cleanText(value)}`)
  if (!fields.length) return y
  const left = X0 + 6
  const right = X0 + TABLE_W - 12
  const gap = 18
  // Un nombre largo empuja a los demás datos en vez de encimarse; si aun así no caben, baja la letra.
  let size = 10.5
  file.font(data.fonts.regular).fontSize(size).fillColor(TEXT)
  const totalWidth = () => fields.reduce((sum, text) => sum + file.widthOfString(text), 0) + gap * (fields.length - 1)
  while (size > 7 && totalWidth() > right - left) { size -= 0.5; file.fontSize(size) }
  const rest = fields.slice(1)
  const start = left + file.widthOfString(fields[0]) + gap
  file.text(fields[0], left, y, { lineBreak: false })
  // Los demás se reparten entre el final del nombre y el borde derecho; el último queda a la derecha.
  const restWidth = rest.reduce((sum, text) => sum + file.widthOfString(text), 0)
  const spacing = rest.length > 1 ? Math.max(gap, (right - start - restWidth) / (rest.length - 1)) : 0
  let x = rest.length === 1 ? right - restWidth : start
  for (const text of rest) {
    file.text(text, x, y, { lineBreak: false })
    x += file.widthOfString(text) + spacing
  }
  return y + 16
}

function drawBadge(file, fonts, code, cx, cy, radius) {
  const badge = GROUP_BADGES[code]
  if (!badge) return
  file.circle(cx, cy, radius).fill(badge.color)
  const mainSize = badge.text.length > 1 ? radius * 0.56 : radius * 0.74
  file.font(fonts.bold).fontSize(mainSize).fillColor(TEXT)
  const mainH = file.currentLineHeight()
  const subSize = radius * 0.36
  file.text(badge.text, cx - radius, cy - mainH / 2 - (badge.sub ? subSize * 0.55 : 0), { width: radius * 2, align: 'center', lineBreak: false })
  if (badge.sub) file.font(fonts.bold).fontSize(subSize).text(badge.sub, cx - radius, cy + mainH / 2 - subSize * 0.75, { width: radius * 2, align: 'center', lineBreak: false })
}

const TIME_W = 53
const PORTION_W = 54
const HEADER_H = 13
const CELL_PAD = 6
const ROW_GAP = 3
const BADGE_RADIUS = 10.5
const BADGE_STEP = 27
const MIN_CARRIED_LINES = 3

function drawTableHeader(file, data, layout, y) {
  const { fonts } = data
  file.rect(X0, y, TIME_W - 1, HEADER_H).fill(NAVY)
  file.rect(X0 + TIME_W, y, PORTION_W - 1, HEADER_H).fill(NAVY)
  file.font(fonts.bold).fontSize(10).fillColor('#FFFFFF').text('Porción', X0 + TIME_W, y + 0.5, { width: PORTION_W - 1, align: 'center', lineBreak: false })
  for (let index = 0; index < layout.columns; index++) {
    const x = layout.optionX(index)
    file.rect(x, y, layout.colW - 1, HEADER_H).fill(OPTION_COLORS[index % OPTION_COLORS.length].head)
    file.font(fonts.bold).fontSize(10).fillColor('#FFFFFF').text(`Opción ${index + 1}`, x, y + 0.5, { width: layout.colW - 1, align: 'center', lineBreak: false })
  }
  return y + HEADER_H + 1
}

// Nombre de la receta en negritas + un renglón por ingrediente, ya partidos al ancho de la celda.
function buildCellLines(file, data, layout, option, width) {
  const { fonts } = data
  const lines = []
  file.font(fonts.bold).fontSize(layout.titleSize)
  for (const line of wrapText(file, option.recipeName, width)) lines.push({ text: line, font: fonts.bold, size: layout.titleSize, color: TEXT })
  file.font(fonts.regular).fontSize(layout.textSize)
  for (const ingredient of option.ingredients || []) {
    const clean = cleanText(ingredient).replace(/^[-•·]\s*/, '')
    if (!clean) continue
    for (const line of wrapText(file, `-${clean}`, width)) lines.push({ text: line, font: fonts.regular, size: layout.textSize, color: TEXT })
  }
  // Una receta con cantidades ajustadas para esta paciente ya dice lo que le toca.
  const notes = []
  if (option.adjusted) return lines
  if ((option.portions || 1) > 1) notes.push(`Rinde ${formatNumber(option.portions)} porciones`)
  if ((option.servings || 1) !== 1 || (option.portions || 1) > 1) notes.push(`te toca${option.servings === 1 ? '' : 'n'} ${formatNumber(option.servings || 1)}`)
  if (notes.length) for (const line of wrapText(file, `(${notes.join(' · ')})`, width)) lines.push({ text: line, font: fonts.regular, size: layout.textSize, color: SOFT })
  return lines
}

// Nombre del tiempo de comida girado y, si el plan la tiene, su hora en un segundo renglón (a la
// derecha del nombre, como en el formato en papel).
function drawTimeLabel(file, fonts, label, time, x, y, height) {
  file.rect(x, y, TIME_W - 1, height).fill(TIME_FILL)
  let size = 14
  const text = cleanText(label)
  file.font(fonts.regular).fontSize(size)
  while (size > 7 && file.widthOfString(text) > height - 10) { size -= 0.5; file.fontSize(size) }
  if (file.widthOfString(text) > height - 4) return
  const cx = x + (TIME_W - 1) / 2
  const cy = y + height / 2
  const hour = cleanText(time)
  file.save()
  file.rotate(-90, { origin: [cx, cy] })
  file.fillColor(TIME_TEXT)
  const lineH = file.currentLineHeight()
  // Girado -90°, "abajo" en el texto es la derecha de la columna.
  file.text(text, cx - file.widthOfString(text) / 2, cy - lineH / 2 - (hour ? 9 : 0), { lineBreak: false })
  if (hour) {
    file.fontSize(Math.min(size, 11.5))
    file.text(hour, cx - file.widthOfString(hour) / 2, cy + 3, { lineBreak: false })
  }
  file.restore()
}

// Receta sin foto (o con una que pdfkit no puede leer): un plato dibujado en el color de la columna,
// para que la celda conserve la misma forma que las demás.
function drawPhotoPlaceholder(file, x, y, width, height, color) {
  const cx = x + width / 2
  const cy = y + height / 2
  const r = Math.min(width, height) * 0.3
  file.save()
  file.rect(x, y, width, height).fillOpacity(0.55).fill('#FFFFFF')
  file.fillOpacity(1).strokeOpacity(0.75).strokeColor(color).lineCap('round')
  file.lineWidth(1.6).circle(cx, cy, r).stroke()
  file.lineWidth(1).circle(cx, cy, r * 0.62).stroke()
  // Tenedor a la izquierda y cuchillo a la derecha.
  const forkX = cx - r * 1.55
  file.lineWidth(1.4)
  for (const dx of [-2.4, 0, 2.4]) file.moveTo(forkX + dx, cy - r * 0.9).lineTo(forkX + dx, cy - r * 0.35).stroke()
  file.path(`M${forkX - 2.4},${cy - r * 0.35} Q${forkX},${cy - r * 0.05} ${forkX + 2.4},${cy - r * 0.35}`).stroke()
  file.moveTo(forkX, cy - r * 0.2).lineTo(forkX, cy + r * 0.9).stroke()
  const knifeX = cx + r * 1.55
  file.path(`M${knifeX},${cy - r * 0.9} Q${knifeX + 4},${cy - r * 0.3} ${knifeX},${cy + r * 0.1}`).stroke()
  file.moveTo(knifeX, cy - r * 0.9).lineTo(knifeX, cy + r * 0.9).stroke()
  file.restore()
}

function drawPhoto(file, image, x, y, width, height, color) {
  if (image) {
    file.save()
    try {
      file.rect(x, y, width, height).clip()
      file.image(image, x, y, { cover: [width, height], align: 'center', valign: 'center' })
      file.restore()
      return
    } catch { /* foto ilegible para pdfkit: se dibuja el plato */ }
    file.restore()
  }
  drawPhotoPlaceholder(file, x, y, width, height, color)
}

// Las filas corren de una hoja a la siguiente sin repetir el encabezado, como en el formato en papel.
function drawMealRow(file, data, layout, row, startY) {
  const { fonts } = data
  let y = startY
  const textW = layout.colW - 1 - CELL_PAD * 2
  const lineH = layout.lineH
  const cells = row.options.slice(0, layout.columns).map((option) => ({ image: option.imageFile ? data.images?.get(option.imageFile) : null, lines: buildCellLines(file, data, layout, option, textW) }))
  const photoH = Math.round(textW * 0.68)
  const headH = photoH + 5
  const maxLines = Math.max(0, ...cells.map((cell) => cell.lines.length))
  let offset = 0
  let badgeIndex = 0
  let first = true
  // La fila sigue mientras queden renglones o círculos de porciones por dibujar: si se parte entre
  // hojas, los círculos que no cupieron en la primera parte continúan en la siguiente.
  while (first || offset < maxLines || badgeIndex < row.portions.length) {
    const pendingBadges = row.portions.length - badgeIndex
    // Una fila nueva necesita lugar para la foto y unos renglones; una continuación, para tres
    // renglones o para un círculo.
    const needed = first
      ? CELL_PAD + headH + Math.min(maxLines, 3) * lineH + CELL_PAD
      : Math.max(offset < maxLines ? CELL_PAD * 2 + Math.min(maxLines - offset, 3) * lineH : 0, pendingBadges ? BADGE_STEP + 8 : 0)
    if (CONTENT_BOTTOM - y < needed) y = addPage(file, data)
    const available = CONTENT_BOTTOM - y
    const fits = Math.max(0, Math.floor((available - CELL_PAD * 2 - (first ? headH : 0)) / lineH))
    let count = Math.min(maxLines - offset, fits)
    // Al partir la fila no se dejan uno o dos renglones sueltos para la hoja siguiente: se pasan
    // al menos tres.
    const left = maxLines - offset - count
    if (left > 0 && left < MIN_CARRIED_LINES && count > MIN_CARRIED_LINES - left) count -= MIN_CARRIED_LINES - left
    let height = CELL_PAD + (first ? headH : 0) + count * lineH + CELL_PAD
    // La fila crece para que quepan sus porciones; si se parte, esta parte llena la hoja.
    height = Math.max(height, Math.min(pendingBadges * BADGE_STEP + 8, available))
    if (offset + count < maxLines) height = available
    drawTimeLabel(file, fonts, row.label, row.time, X0, y, height)
    for (let slot = 0; badgeIndex < row.portions.length; slot++) {
      const cy = y + 8 + BADGE_STEP * slot + BADGE_RADIUS
      if (cy + BADGE_RADIUS > y + height) break
      const portion = row.portions[badgeIndex++]
      file.font(fonts.regular).fontSize(10.5).fillColor(TEXT)
      file.text(formatQuantity(portion.quantity), X0 + TIME_W + 2, cy - file.currentLineHeight() / 2, { width: 22, align: 'center', lineBreak: false })
      drawBadge(file, fonts, portion.code, X0 + TIME_W + 38, cy, BADGE_RADIUS)
    }
    cells.forEach((cell, index) => {
      const x = layout.optionX(index)
      file.rect(x, y, layout.colW - 1, height).fill(OPTION_COLORS[index % OPTION_COLORS.length].cell)
      if (first) drawPhoto(file, cell.image, x + CELL_PAD, y + CELL_PAD, textW, photoH, OPTION_COLORS[index % OPTION_COLORS.length].head)
      const textY = y + CELL_PAD + (first ? headH : 0)
      cell.lines.slice(offset, offset + count).forEach((line, lineIndex) => {
        file.font(line.font).fontSize(line.size).fillColor(line.color).text(line.text, x + CELL_PAD, textY + lineIndex * lineH, { lineBreak: false })
      })
    })
    y += height
    offset += count
    first = false
  }
  return y + ROW_GAP
}

// Leyenda de los círculos. "Azúcares" sólo aparece si el plan los prescribe: el formato en papel
// no lo trae.
function drawLegend(file, data, startY, rows) {
  const { fonts } = data
  let y = startY + 22
  if (CONTENT_BOTTOM - y < 52) y = addPage(file, data) + 18
  const step = 54
  const used = new Set(rows.flatMap((row) => row.portions.map((portion) => portion.code)))
  EQUIVALENT_GROUPS.filter((group) => group.code !== 'AZ' || used.has('AZ')).forEach((group, index) => {
    const cx = X0 + 20 + index * step
    drawBadge(file, fonts, group.code, cx, y + 13, 13)
    const words = group.label.replace(/^(AOA|Grasa) /, '$1\n').split('\n')
    file.font(fonts.regular).fontSize(5.6).fillColor(TEXT)
    words.forEach((word, wordIndex) => file.text(word, cx - step / 2, y + 33 + wordIndex * 7, { width: step, align: 'center', lineBreak: false }))
  })
  return y + 52
}

function drawParagraphList(file, data, title, items, startY) {
  const { fonts } = data
  let y = startY
  if (CONTENT_BOTTOM - y < 44) y = addPage(file, data) + 16
  file.font(fonts.bold).fontSize(10.5).fillColor(TEXT).text(title, 72, y, { lineBreak: false })
  y += 27
  for (const item of items) {
    file.font(fonts.regular).fontSize(10)
    const lines = wrapText(file, `-${cleanText(item).replace(/^[-•·]\s*/, '')}`, 640)
    if (CONTENT_BOTTOM - y < lines.length * 13.5) y = addPage(file, data) + 16
    for (const line of lines) {
      file.font(fonts.regular).fontSize(10).fillColor(TEXT).text(line, 72, y, { lineBreak: false })
      y += 13.5
    }
  }
  return y + 34
}

const splitNotes = (text) => String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

// Caja de una lista de equivalentes: banda de color con el nombre del grupo y los renglones debajo,
// sobre un fondo que se aclara hacia la izquierda.
function drawEquivalentBox(file, fonts, { x, y, width, title, color, tint, items, footnote }) {
  const bandH = 25
  const lineH = 9
  const size = 7.1
  file.font(fonts.list).fontSize(size)
  const lines = items.flatMap((item) => wrapText(file, item, width - 14))
  const height = bandH + 8 + lines.length * lineH + 8
  file.rect(x, y, width, height).fill(file.linearGradient(x, y, x + width, y).stop(0, '#FFFFFF').stop(1, tint))
  file.rect(x + 6, y, width - 12, bandH).fill(color)
  file.font(fonts.listBold).fontSize(15).fillColor('#FFFFFF')
  file.text(title, x, y + (bandH - file.currentLineHeight()) / 2, { width, align: 'center', lineBreak: false, characterSpacing: 0.6 })
  lines.forEach((line, index) => {
    file.font(fonts.list).fontSize(size).fillColor(TEXT).text(line, x + 7, y + bandH + 8 + index * lineH, { lineBreak: false })
  })
  let bottom = y + height
  if (footnote) {
    file.font(fonts.listBold).fontSize(6.6)
    const text = `${footnote.label} ${footnote.text}`
    file.font(fonts.list).fontSize(6.6)
    const noteLines = wrapText(file, text, width - 26)
    const noteH = noteLines.length * 8.6 + 8
    file.rect(x + 8, bottom + 7, width - 16, noteH).fill(file.linearGradient(x + 8, 0, x + width - 8, 0).stop(0, '#CFEAE4').stop(1, '#FFFFFF'))
    noteLines.forEach((line, index) => {
      const lineY = bottom + 11 + index * 8.6
      if (index === 0 && line.startsWith(footnote.label)) {
        file.font(fonts.listBold).fontSize(6.6).fillColor(TEXT).text(footnote.label, x + 13, lineY, { lineBreak: false, continued: true })
        file.font(fonts.list).text(line.slice(footnote.label.length), { lineBreak: false })
      } else file.font(fonts.list).fontSize(6.6).fillColor(TEXT).text(line, x + 13, lineY, { lineBreak: false })
    })
    bottom += 7 + noteH
  }
  return bottom
}

function drawEquivalentPages(file, data) {
  const { fonts } = data
  const GREEN = { color: '#7EDB43', tint: '#E3F4D5' }
  const YELLOW = { color: '#ECE445', tint: '#F8F6CF' }
  const ORANGE = { color: '#FFA92E', tint: '#FDE7CF' }
  const BLUE = { color: '#35B3FF', tint: '#D2EBFE' }

  let y = addPage(file, data) + 14
  file.font(fonts.regular).fontSize(12).fillColor(TEXT).text('Alimentos equivalentes:', 72, y, { lineBreak: false })
  y += 20
  drawEquivalentBox(file, fonts, { x: 140, y, width: 150, title: 'Vegetales', ...GREEN, items: EQUIVALENT_LISTS.VEGETABLES, footnote: { label: 'LIBRES:', text: EQUIVALENT_LISTS.FREE_VEGETABLES } })
  drawEquivalentBox(file, fonts, { x: 312, y, width: 152, title: 'Frutas', ...GREEN, items: EQUIVALENT_LISTS.FRUITS })
  drawEquivalentBox(file, fonts, { x: 480, y, width: 176, title: 'Cereales', ...YELLOW, items: EQUIVALENT_LISTS.CEREALS })

  y = addPage(file, data) + 36
  const leftX = 50
  const leftW = 408
  file.rect(leftX, y, leftW, 34).fill('#EFEAE4')
  file.font(fonts.listBold).fontSize(17).fillColor(TEXT)
  file.text('Aceites y Grasas', leftX, y + (34 - file.currentLineHeight()) / 2, { width: leftW, align: 'center', lineBreak: false, characterSpacing: 0.4 })
  const halfW = (leftW - 14) / 2
  drawEquivalentBox(file, fonts, { x: leftX, y: y + 48, width: halfW, title: 'AG S/p', ...ORANGE, items: EQUIVALENT_LISTS.FATS_WITHOUT_PROTEIN })
  drawEquivalentBox(file, fonts, { x: leftX + halfW + 14, y: y + 48, width: halfW, title: 'AG c/p', ...ORANGE, items: EQUIVALENT_LISTS.FATS_WITH_PROTEIN })
  const legumesBottom = drawEquivalentBox(file, fonts, { x: 484, y, width: 252, title: 'Leguminosas', ...YELLOW, items: EQUIVALENT_LISTS.LEGUMES })
  drawEquivalentBox(file, fonts, { x: 484, y: legumesBottom + 10, width: 252, title: 'Lácteos', ...BLUE, items: EQUIVALENT_LISTS.DAIRY })
}

// `input`: { patientName, nutritionistName, licenseNumber, weightKg, bodyFatPercent, muscleMassKg,
// menu, mealTimes, equivalents, recommendations, hydrationNote, contact: [{ kind: 'phone'|'address'|'email', text }], logo,
// images: Map<imageFile, Buffer> }.
// `file` debe ser un PDFDocument carta apaisado con margen 0 y su primera hoja ya creada.
function drawNutritionPlan(file, input) {
  // El logo va en todas las hojas: se abre una sola vez para no incrustarlo una vez por hoja.
  let logo = null
  if (input.logo) { try { logo = file.openImage(input.logo) } catch { logo = null } }
  const data = { ...input, logo, fonts: registerFonts(file) }
  drawPageChrome(file, data)
  let y = drawPatientLine(file, data, FIRST_TOP)
  const rows = buildMealOptions(data.menu, data.mealTimes, data.equivalents)
  if (!rows.length) {
    file.font(data.fonts.regular).fontSize(10.5).fillColor(SOFT).text('Este plan todavía no tiene recetas asignadas.', X0 + 6, y + 10, { lineBreak: false })
  } else {
    // Cinco columnas de opción, como el formato en papel; con 6 o 7 opciones (una por día) las
    // columnas se angostan y la letra baja para que quepan.
    const columns = Math.min(7, Math.max(...rows.map((row) => row.options.length)))
    const colW = (TABLE_W - TIME_W - PORTION_W) / Math.max(columns, 5)
    const scale = columns <= 5 ? 1 : columns === 6 ? 0.88 : 0.8
    const layout = { columns, colW, optionX: (index) => X0 + TIME_W + PORTION_W + index * colW, titleSize: 9 * scale, textSize: 8.8 * scale, lineH: 11 * scale }
    y = drawTableHeader(file, data, layout, y)
    for (const row of rows) y = drawMealRow(file, data, layout, row, y)
    y = drawLegend(file, data, y, rows)
  }

  const agreements = [...splitNotes(data.recommendations), ...splitNotes(data.hydrationNote)]
  y = addPage(file, data) + 16
  if (agreements.length) y = drawParagraphList(file, data, 'Acuerdos y recomendaciones:', agreements, y)
  drawParagraphList(file, data, 'Instrucciones:', DEFAULT_INSTRUCTIONS, y)

  drawEquivalentPages(file, data)
}

export { drawNutritionPlan }
