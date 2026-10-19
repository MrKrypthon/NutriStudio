import { describe, expect, it } from 'vitest'
import { ACCESS_GRACE_DAYS, defaultPracticeName, generateTempPassword, isValidLoginId, normalizeLoginId, practiceAccess, suggestLoginId } from './accounts.js'

const now = new Date('2026-10-19T12:00:00Z')
const days = (n) => new Date(now.getTime() + n * 86400000)

describe('identificador de acceso', () => {
  it('acepta minúsculas, números, punto y guiones; normaliza mayúsculas y espacios', () => {
    expect(isValidLoginId('milpa001')).toBe(true)
    expect(isValidLoginId('  Ana.Lopez-2 ')).toBe(true)
    expect(normalizeLoginId('  Ana.Lopez-2 ')).toBe('ana.lopez-2')
  })

  it('rechaza correos, espacios internos y longitudes fuera de rango', () => {
    expect(isValidLoginId('ana@gmail.com')).toBe(false)
    expect(isValidLoginId('ana lopez')).toBe(false)
    expect(isValidLoginId('ab')).toBe(false)
    expect(isValidLoginId('a'.repeat(31))).toBe(false)
    expect(isValidLoginId('-ana')).toBe(false)
  })

  it('sugiere identificadores consecutivos', () => {
    expect(suggestLoginId(1)).toBe('milpa001')
    expect(suggestLoginId(42)).toBe('milpa042')
  })
})

describe('contraseña temporal', () => {
  it('tiene la longitud pedida y no usa caracteres confundibles', () => {
    const password = generateTempPassword()
    expect(password).toHaveLength(10)
    expect(password).not.toMatch(/[0O1lI]/)
  })
})

describe('acceso según la suscripción', () => {
  it('las prácticas anteriores a las cuentas de pago no se bloquean', () => {
    expect(practiceAccess({ status: 'ACTIVE', signupSource: null, paidUntil: null }, now).allowed).toBe(true)
  })

  it('una suspendida nunca entra', () => {
    expect(practiceAccess({ status: 'SUSPENDED', signupSource: null }, now)).toMatchObject({ allowed: false, reason: 'SUSPENDED' })
    expect(practiceAccess({ status: 'SUSPENDED', signupSource: 'ADMIN', paidUntil: days(30) }, now).allowed).toBe(false)
  })

  it('una cuenta nueva sin pagar pide la suscripción', () => {
    expect(practiceAccess({ status: 'ACTIVE', signupSource: 'GOOGLE', paidUntil: null }, now)).toMatchObject({ allowed: false, reason: 'SUBSCRIPTION_REQUIRED' })
  })

  it('con cobertura vigente entra; vencida entra durante la gracia y luego no', () => {
    expect(practiceAccess({ status: 'ACTIVE', signupSource: 'ADMIN', paidUntil: days(10) }, now)).toEqual({ allowed: true, inGrace: false })
    expect(practiceAccess({ status: 'ACTIVE', signupSource: 'GOOGLE', paidUntil: days(-3) }, now)).toEqual({ allowed: true, inGrace: true })
    expect(practiceAccess({ status: 'ACTIVE', signupSource: 'GOOGLE', paidUntil: days(-ACCESS_GRACE_DAYS - 1) }, now).allowed).toBe(false)
  })
})

it('nombra la consulta con el nombre de la persona', () => {
  expect(defaultPracticeName('Ana López')).toBe('Consulta de Ana López')
  expect(defaultPracticeName('')).toBe('Mi consulta')
})
