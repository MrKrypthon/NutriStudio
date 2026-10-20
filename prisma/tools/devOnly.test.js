import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertDemoDataAllowed, demoDataBlockedReason } from './devOnly.js'

describe('guarda de los datos de demostración', () => {
  afterEach(() => vi.restoreAllMocks())

  it('bloquea en producción, sin importar mayúsculas ni espacios', () => {
    expect(demoDataBlockedReason({ NODE_ENV: 'production' })).toBe('NODE_ENV=production')
    expect(demoDataBlockedReason({ NODE_ENV: ' Production ' })).toBe('NODE_ENV=production')
  })

  it('deja correr en desarrollo, pruebas o sin NODE_ENV', () => {
    expect(demoDataBlockedReason({})).toBeNull()
    expect(demoDataBlockedReason({ NODE_ENV: 'development' })).toBeNull()
    expect(demoDataBlockedReason({ NODE_ENV: 'test' })).toBeNull()
  })

  it('termina el proceso con error antes de seguir', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => assertDemoDataAllowed('seed', { NODE_ENV: 'production' })).toThrow('exit')
    expect(exit).toHaveBeenCalledWith(1)
    exit.mockClear()
    assertDemoDataAllowed('seed', { NODE_ENV: 'development' })
    expect(exit).not.toHaveBeenCalled()
  })
})
