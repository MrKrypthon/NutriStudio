import { describe, expect, it } from 'vitest'
import { formatPhone } from './phone.js'

describe('formatPhone', () => {
  it('agrupa 10 dígitos como 3-3-4', () => {
    expect(formatPhone('9992244494')).toBe('999 224 4494')
  })

  it('es idempotente sobre un valor ya formateado', () => {
    expect(formatPhone('999 224 4494')).toBe('999 224 4494')
  })

  it('va formateando mientras se teclea', () => {
    expect(formatPhone('9')).toBe('9')
    expect(formatPhone('999')).toBe('999')
    expect(formatPhone('9992')).toBe('999 2')
    expect(formatPhone('999224')).toBe('999 224')
    expect(formatPhone('9992244')).toBe('999 224 4')
  })

  it('descarta todo lo que no sea dígito', () => {
    expect(formatPhone('(999) 224-4494')).toBe('999 224 4494')
    expect(formatPhone('abc')).toBe('')
  })

  it('recorta a 10 dígitos', () => {
    expect(formatPhone('12345678901234')).toBe('123 456 7890')
  })

  it('trata vacío/null/undefined como cadena vacía', () => {
    expect(formatPhone('')).toBe('')
    expect(formatPhone(null)).toBe('')
    expect(formatPhone(undefined)).toBe('')
  })
})
