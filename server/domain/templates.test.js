import { describe, expect, it } from 'vitest'
import { hasSectionContent } from './templates.js'

describe('hasSectionContent', () => {
  it('treats missing and blank payloads as empty', () => {
    expect(hasSectionContent(null)).toBe(false)
    expect(hasSectionContent(undefined)).toBe(false)
    expect(hasSectionContent({})).toBe(false)
    expect(hasSectionContent({ peso: '', talla: '   ', notas: [], extra: { a: null } })).toBe(false)
    expect(hasSectionContent({ alergia: false })).toBe(false)
  })

  it('detects captured text, numbers and checked boxes, also nested', () => {
    expect(hasSectionContent({ motivo: 'Control de peso' })).toBe(true)
    expect(hasSectionContent({ peso: 0 })).toBe(true)
    expect(hasSectionContent({ diabetes: true })).toBe(true)
    expect(hasSectionContent({ recordatorio: [{ hora: '', comida: 'Avena' }] })).toBe(true)
  })
})
