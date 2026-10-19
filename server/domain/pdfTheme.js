// Diseño del plan de alimentación en PDF, por consultorio: colores, tipografía y adornos. Por
// defecto sale en blanco y negro (se imprime bien en cualquier impresora); la nutrióloga lo cambia
// en Configuración → Diseño del PDF. Lo usan el servidor (server/domain/planPdf.js) y la pantalla
// que lo edita, así que aquí no hay nada de Node.

// Tipografías que trae el servidor (server/assets/fonts) más dos estándar de PDF que no necesitan
// archivo. `list` es la de las listas de equivalentes.
export const PDF_FONTS = {
  montserrat: { label: 'Montserrat', css: "'Montserrat', sans-serif", files: { regular: 'Montserrat-Regular.ttf', medium: 'Montserrat-Medium.ttf', bold: 'Montserrat-Bold.ttf', list: 'Poppins-Regular.ttf', listBold: 'Poppins-Bold.ttf' } },
  poppins: { label: 'Poppins', css: "'Poppins', sans-serif", files: { regular: 'Poppins-Regular.ttf', medium: 'Poppins-Regular.ttf', bold: 'Poppins-Bold.ttf', list: 'Poppins-Regular.ttf', listBold: 'Poppins-Bold.ttf' } },
  'dm-sans': { label: 'DM Sans', css: "'DM Sans', sans-serif", files: { regular: 'DMSans-Regular.ttf', medium: 'DMSans-Regular.ttf', bold: 'DMSans-Bold.ttf', list: 'DMSans-Regular.ttf', listBold: 'DMSans-Bold.ttf' } },
  nunito: { label: 'Nunito (redondeada)', css: "'Nunito', sans-serif", files: { regular: 'Nunito-Regular.ttf', medium: 'Nunito-Regular.ttf', bold: 'Nunito-Bold.ttf', list: 'Nunito-Regular.ttf', listBold: 'Nunito-Bold.ttf' } },
  lora: { label: 'Lora (con serifa)', css: "'Lora', serif", files: { regular: 'Lora-Regular.ttf', medium: 'Lora-Regular.ttf', bold: 'Lora-Bold.ttf', list: 'Lora-Regular.ttf', listBold: 'Lora-Bold.ttf' } },
  helvetica: { label: 'Helvetica (clásica)', css: 'Helvetica, Arial, sans-serif', standard: { regular: 'Helvetica', medium: 'Helvetica', bold: 'Helvetica-Bold', list: 'Helvetica', listBold: 'Helvetica-Bold' } },
  times: { label: 'Times (clásica con serifa)', css: "'Times New Roman', Times, serif", standard: { regular: 'Times-Roman', medium: 'Times-Roman', bold: 'Times-Bold', list: 'Times-Roman', listBold: 'Times-Bold' } },
}

// `primary`: títulos, encabezado de la tabla y bandas de las listas. `accent`: ondas, iconos y
// datos de contacto. `fill`: fondo de las celdas. Los interruptores devuelven los colores por
// opción y por grupo de alimentos del formato original.
export const DEFAULT_PDF_THEME = {
  primary: '#1A1A1A',
  accent: '#555555',
  fill: '#F4F4F4',
  font: 'montserrat',
  waves: false,
  colorfulOptions: false,
  colorfulGroups: false,
  showLogo: true,
}

export const PDF_THEME_PRESETS = [
  { key: 'mono', label: 'Blanco y negro', theme: { ...DEFAULT_PDF_THEME } },
  { key: 'milpa', label: 'Verde Milpa', theme: { ...DEFAULT_PDF_THEME, primary: '#1F5A3A', accent: '#7FA83A', fill: '#EEF4E8', waves: true } },
  { key: 'mar', label: 'Azul sereno', theme: { ...DEFAULT_PDF_THEME, primary: '#24476B', accent: '#5B9BC8', fill: '#EAF2F8', waves: true } },
  { key: 'terracota', label: 'Terracota', theme: { ...DEFAULT_PDF_THEME, primary: '#8A3B22', accent: '#D9825B', fill: '#FBEFE8', waves: true, font: 'lora' } },
  { key: 'original', label: 'Original a color', theme: { ...DEFAULT_PDF_THEME, primary: '#2F2A6B', accent: '#F0544F', fill: '#E8EFDD', waves: true, colorfulOptions: true, colorfulGroups: true } },
]

const HEX = /^#[0-9a-f]{6}$/i

// Lo guardado (o lo que llega de la pantalla) siempre se lee con esto: un valor raro vuelve al de
// por defecto en vez de romper el PDF.
export function normalizePdfTheme(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const color = (key) => (typeof value[key] === 'string' && HEX.test(value[key]) ? value[key].toUpperCase() : DEFAULT_PDF_THEME[key])
  const flag = (key) => (typeof value[key] === 'boolean' ? value[key] : DEFAULT_PDF_THEME[key])
  return {
    primary: color('primary'),
    accent: color('accent'),
    fill: color('fill'),
    font: Object.hasOwn(PDF_FONTS, value.font) ? value.font : DEFAULT_PDF_THEME.font,
    waves: flag('waves'),
    colorfulOptions: flag('colorfulOptions'),
    colorfulGroups: flag('colorfulGroups'),
    showLogo: flag('showLogo'),
  }
}

const channels = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))
const toHex = (values) => `#${values.map((value) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('')}`.toUpperCase()

// Mezcla `hex` con `other` (blanco por defecto): 0 deja el color, 1 lo vuelve `other`.
export function mixColor(hex, amount, other = '#FFFFFF') {
  const [a, b] = [channels(hex), channels(other)]
  return toHex(a.map((value, index) => value + (b[index] - value) * amount))
}

// Texto que se lee sobre un fondo: blanco sobre colores oscuros, casi negro sobre los claros.
export function textOn(hex) {
  const [r, g, b] = channels(hex).map((value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#1A1A1A' : '#FFFFFF'
}

// Nombre con que se descarga el plan: "Plan de alimentación - Laura Méndez - 15 oct 2026.pdf".
// `asciiFileName` es el respaldo para el encabezado HTTP (sin acentos ni caracteres raros).
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export function planFileName(patientName, date = new Date()) {
  const when = new Date(date)
  const day = Number.isNaN(when.getTime()) ? '' : ` - ${when.getDate()} ${MONTHS[when.getMonth()]} ${when.getFullYear()}`
  const name = String(patientName || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return `Plan de alimentación${name ? ` - ${name}` : ''}${day}.pdf`
}
export const asciiFileName = (fileName) => String(fileName).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '')
