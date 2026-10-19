import { describe, expect, it } from 'vitest'
import { DEFAULT_PDF_THEME, PDF_THEME_PRESETS, asciiFileName, mixColor, normalizePdfTheme, planFileName, textOn } from './pdfTheme.js'

describe('normalizePdfTheme', () => {
  it('defaults to black and white with the logo', () => {
    expect(normalizePdfTheme(null)).toEqual(DEFAULT_PDF_THEME)
    expect(DEFAULT_PDF_THEME).toMatchObject({ colorfulOptions: false, colorfulGroups: false, waves: false, showLogo: true })
  })

  it('keeps valid values and drops the rest', () => {
    expect(normalizePdfTheme({ primary: '#1f5a3a', font: 'lora', waves: true, showLogo: false })).toMatchObject({ primary: '#1F5A3A', font: 'lora', waves: true, showLogo: false })
    expect(normalizePdfTheme({ primary: 'red', accent: '#12', font: 'comic', waves: 'sí' })).toMatchObject({ primary: DEFAULT_PDF_THEME.primary, accent: DEFAULT_PDF_THEME.accent, font: 'montserrat', waves: false })
  })

  it('presets are valid themes', () => {
    for (const preset of PDF_THEME_PRESETS) expect(normalizePdfTheme(preset.theme)).toEqual(preset.theme)
  })
})

describe('colors', () => {
  it('mixes towards white and picks readable text', () => {
    expect(mixColor('#000000', 0.5)).toBe('#808080')
    expect(mixColor('#1F5A3A', 0)).toBe('#1F5A3A')
    expect(textOn('#1A1A1A')).toBe('#FFFFFF')
    expect(textOn('#F4F4F4')).toBe('#1A1A1A')
  })
})

describe('planFileName', () => {
  it('names the file after the patient and the date', () => {
    expect(planFileName('Laura Méndez Ortiz', new Date(2026, 9, 15))).toBe('Plan de alimentación - Laura Méndez Ortiz - 15 oct 2026.pdf')
    expect(planFileName('  Ana / "La" Pérez ', new Date(2026, 0, 2))).toBe('Plan de alimentación - Ana La Pérez - 2 ene 2026.pdf')
    expect(planFileName('', 'nunca')).toBe('Plan de alimentación.pdf')
  })

  it('has an ASCII fallback for the HTTP header', () => {
    expect(asciiFileName('Plan de alimentación - Laura Méndez - 15 oct 2026.pdf')).toBe('Plan de alimentacion - Laura Mendez - 15 oct 2026.pdf')
  })
})
