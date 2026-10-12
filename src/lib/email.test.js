import { describe, expect, it } from 'vitest'
import { EMAIL_MAX_LENGTH, isValidEmail, normalizeEmail } from './email.js'

describe('normalizeEmail', () => {
  it('quita espacios al inicio, al final y en medio', () => {
    expect(normalizeEmail('  correo@email.com ')).toBe('correo@email.com')
    expect(normalizeEmail('a b@c.com')).toBe('ab@c.com')
  })

  it('recorta a 254 caracteres', () => {
    const largo = 'a'.repeat(300) + '@x.com'
    expect(normalizeEmail(largo)).toHaveLength(EMAIL_MAX_LENGTH)
  })

  it('trata vacío/null/undefined como cadena vacía', () => {
    expect(normalizeEmail('')).toBe('')
    expect(normalizeEmail(null)).toBe('')
    expect(normalizeEmail(undefined)).toBe('')
  })
})

describe('isValidEmail', () => {
  it('acepta correos de forma normal', () => {
    expect(isValidEmail('correo@email.com')).toBe(true)
    expect(isValidEmail('nombre.apellido+dato@sub.dominio.mx')).toBe(true)
  })

  it('normaliza antes de validar (un espacio no lo invalida)', () => {
    expect(isValidEmail(' correo @email.com ')).toBe(true)
  })

  it('rechaza lo que le falta arroba, dominio o punto', () => {
    expect(isValidEmail('sin-arroba.com')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail('a@b.c')).toBe(false)
    expect(isValidEmail('@email.com')).toBe(false)
    expect(isValidEmail('correo@')).toBe(false)
  })

  it('rechaza vacío/null/undefined', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('   ')).toBe(false)
    expect(isValidEmail(null)).toBe(false)
    expect(isValidEmail(undefined)).toBe(false)
  })
})
