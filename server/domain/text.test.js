import { describe, expect, it } from 'vitest'
import { toWinAnsi } from './text.js'

describe('texto para las fuentes estándar del PDF (WinAnsi)', () => {
  it('conserva acentos, ñ, símbolos de Latin-1 y la tipografía de WinAnsi', () => {
    expect(toWinAnsi('Ñandú · µg ± 2 °C ½ — “cita” • 5 €')).toBe('Ñandú · µg ± 2 °C ½ — “cita” • 5 €')
    expect(toWinAnsi('línea 1\nlínea 2')).toBe('línea 1\nlínea 2')
  })
  it('cambia los símbolos que Helvetica no dibuja por su equivalente legible', () => {
    expect(toWinAnsi('glucosa ≥ 126 mg/dL, LDL ≤ 100 − 5 → meta')).toBe('glucosa >= 126 mg/dL, LDL <= 100 - 5 -> meta')
    expect(toWinAnsi('CO₂ ﬁbra Lőrinc')).toBe('CO2 fibra Lorinc')
  })
  it('quita emojis y caracteres sin equivalente en vez de imprimir basura', () => {
    expect(toWinAnsi('Bajar 5 kg 😀👍🏽')).toBe('Bajar 5 kg ')
    expect(toWinAnsi(null)).toBe('')
  })
})
