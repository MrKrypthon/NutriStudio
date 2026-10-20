import { describe, expect, it } from 'vitest'
import { normalizeAdminEmail, readAdminInput } from './adminAccount.js'

const PASSWORD = 'caballo-bateria-grapa-73'

describe('datos del primer administrador', () => {
  it('normaliza el correo y pone un nombre por defecto', () => {
    expect(normalizeAdminEmail('  Admin@Milpa.MX ')).toBe('admin@milpa.mx')
    const input = readAdminInput({ ADMIN_EMAIL: ' Admin@Milpa.MX', ADMIN_PASSWORD: PASSWORD })
    expect(input).toMatchObject({ email: 'admin@milpa.mx', name: 'Administrador', password: PASSWORD, errors: [] })
  })

  it('pide correo y contraseña', () => {
    expect(readAdminInput({}).errors).toEqual(['Falta ADMIN_EMAIL.', 'Falta ADMIN_PASSWORD.'])
    expect(readAdminInput({ ADMIN_EMAIL: 'no-es-correo', ADMIN_PASSWORD: PASSWORD }).errors).toEqual(['ADMIN_EMAIL no es un correo válido.'])
  })

  it('rechaza contraseñas débiles o que bcrypt recortaría', () => {
    const errorsFor = (password) => readAdminInput({ ADMIN_EMAIL: 'admin@milpa.mx', ADMIN_PASSWORD: password }).errors
    expect(errorsFor('corta123')).toHaveLength(1)
    expect(errorsFor('x'.repeat(73))).toHaveLength(1)
    expect(errorsFor(` ${PASSWORD}`)).toHaveLength(1)
    expect(errorsFor('mi-correo-es-admin-2026')).toHaveLength(1)
  })

  it('ningún mensaje de error repite la contraseña', () => {
    for (const password of ['corta-1', 'x'.repeat(80), ` ${PASSWORD} `, 'admin-admin-admin']) {
      const { errors } = readAdminInput({ ADMIN_EMAIL: 'admin@milpa.mx', ADMIN_PASSWORD: password })
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.join(' ')).not.toContain(password.trim())
    }
  })
})
