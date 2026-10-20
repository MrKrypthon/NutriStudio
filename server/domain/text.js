// Plegado de texto para comparar sin distinguir mayúsculas ni acentos ("Pérdida" ≈ "perdida").
// Único punto de verdad: lo comparten la búsqueda de recetas, el emparejado de ingredientes y el
// agrupado de equivalentes (antes había una copia en cada módulo).
export const foldText = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Las fuentes est\u00e1ndar de pdfkit (Helvetica) s\u00f3lo codifican WinAnsi (Latin-1 m\u00e1s comillas, guiones
// largos, vi\u00f1eta, \u20ac\u2026): cualquier otro car\u00e1cter sal\u00eda como basura ("\u2265" \u2192 '"e', un emoji \u2192 "\u00d8=\u00de").
// Se cambia por su equivalente legible o, si no tiene, se quita.
const WIN_ANSI_EXTRA = '\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178'
const WIN_ANSI_REPLACEMENTS = { '\u2265': '>=', '\u2264': '<=', '\u2260': '!=', '\u2248': '~', '\u2212': '-', '\u2192': '->', '\u2190': '<-', '\u2191': '^', '\u2193': 'v', '\u2713': 'S\u00ed', '\u2714': 'S\u00ed', '\u2717': 'No', '\u2718': 'No', '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2015': '\u2014', '\u2032': "'", '\u2033': '"', '\u2219': '\u00b7', '\u22c5': '\u00b7' }
export const toWinAnsi = (value) => String(value ?? '').replace(/[^\t\n\r\x20-\x7E\xA0-\xFF]/gu, (char) => {
  if (WIN_ANSI_EXTRA.includes(char)) return char
  if (WIN_ANSI_REPLACEMENTS[char] !== undefined) return WIN_ANSI_REPLACEMENTS[char]
  // Sub\u00edndices, ligaduras, letras con acentos fuera de Latin-1 ("\u2082" \u2192 "2", "\u0151" \u2192 "o").
  return char.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
})
