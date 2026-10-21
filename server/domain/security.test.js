import { describe, expect, it } from 'vitest'
import { ATTEMPT_RULES, clientKey, corsOriginOption, createAttemptLimiter, jwtSecretProblems, parseTrustProxy, tooManyAttemptsMessage } from './security.js'

const LONG = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

describe('TRUST_PROXY', () => {
  it('por defecto no confía en nadie', () => {
    for (const value of [undefined, '', 'false', '0', '  ']) expect(parseTrustProxy(value)).toBe(false)
  })
  it('acepta true, saltos y listas de IPs', () => {
    expect(parseTrustProxy('true')).toBe(true)
    expect(parseTrustProxy('1')).toBe(1)
    expect(parseTrustProxy('loopback')).toBe('loopback')
    expect(parseTrustProxy('127.0.0.1, 10.0.0.0/8')).toEqual(['127.0.0.1', '10.0.0.0/8'])
  })
})

describe('orígenes de CORS', () => {
  it('en desarrollo acepta cualquiera', () => {
    expect(corsOriginOption({ nodeEnv: 'development', appUrl: 'http://localhost:5173' })).toBe(true)
    expect(corsOriginOption({})).toBe(true)
  })
  it('en producción sólo el de APP_URL, sin ruta ni diagonal final', () => {
    expect(corsOriginOption({ nodeEnv: 'production', appUrl: 'https://app.milpa.mx/' })).toEqual(['https://app.milpa.mx'])
  })
  it('CORS_ORIGINS manda sobre APP_URL, en cualquier entorno', () => {
    expect(corsOriginOption({ nodeEnv: 'production', appUrl: 'https://a.mx', corsOrigins: 'https://b.mx, https://c.mx/x, no-es-url' })).toEqual(['https://b.mx', 'https://c.mx'])
    expect(corsOriginOption({ nodeEnv: 'development', corsOrigins: 'https://b.mx' })).toEqual(['https://b.mx'])
  })
  it('en producción sin ninguno válido no acepta orígenes cruzados', () => {
    expect(corsOriginOption({ nodeEnv: 'production', appUrl: '' })).toBe(false)
  })
})

describe('secretos de los tokens', () => {
  const fatal = (input) => jwtSecretProblems(input).filter((problem) => problem.fatal).map((problem) => problem.message)

  it('en desarrollo sólo avisa si falta JWT_SECRET', () => {
    expect(jwtSecretProblems({ nodeEnv: 'development' })).toEqual([{ fatal: false, message: 'JWT_SECRET no está configurada.' }])
    expect(jwtSecretProblems({ nodeEnv: 'development', jwtSecret: 'corto' })).toEqual([])
  })

  it('en producción exige los dos secretos, largos, distintos y que no sean los de ejemplo', () => {
    expect(fatal({ nodeEnv: 'production' })).toEqual(['JWT_SECRET no está configurada.', 'ADMIN_JWT_SECRET no está configurada.'])
    expect(fatal({ nodeEnv: 'production', jwtSecret: 'corto', adminJwtSecret: OTHER })).toEqual(['JWT_SECRET debe tener al menos 32 caracteres.'])
    expect(fatal({ nodeEnv: 'production', jwtSecret: LONG, adminJwtSecret: LONG })).toEqual(['ADMIN_JWT_SECRET debe ser distinto de JWT_SECRET.'])
    expect(fatal({ nodeEnv: 'production', jwtSecret: LONG, adminJwtSecret: OTHER, exampleSecrets: [LONG] })).toEqual(['JWT_SECRET es el valor de ejemplo de .env.example.'])
    expect(fatal({ nodeEnv: 'production', jwtSecret: LONG, adminJwtSecret: OTHER, exampleSecrets: ['otro'] })).toEqual([])
  })
})

describe('límite de intentos', () => {
  const setup = (rules = ATTEMPT_RULES.login, maxKeys) => {
    let clock = 0
    const limiter = createAttemptLimiter({ rules, now: () => clock, ...(maxKeys ? { maxKeys } : {}) })
    return { limiter, advance: (ms) => { clock += ms } }
  }
  // Un intento fallido: se consume y no se devuelve.
  const failN = (limiter, subject, times) => { for (let i = 0; i < times; i += 1) limiter.consume(subject) }

  it('bloquea al sexto intento fallido para la misma cuenta y la misma IP', () => {
    const { limiter } = setup()
    const subject = { ip: '1.1.1.1', account: 'milpa001' }
    for (let i = 0; i < 5; i += 1) expect(limiter.consume(subject).allowed).toBe(true)
    const result = limiter.consume(subject)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSeconds).toBe(15 * 60)
    // Otra IP para esa cuenta todavía puede (hasta el tope por cuenta).
    expect(limiter.consume({ ip: '2.2.2.2', account: 'milpa001' }).allowed).toBe(true)
  })

  it('cuenta el intento al revisarlo: peticiones simultáneas no pasan todas', () => {
    const { limiter } = setup()
    const subject = { ip: '1.1.1.1', account: 'milpa001' }
    // Cien intentos «a la vez» (antes de que termine cualquier bcrypt): sólo 5 pasan.
    const allowed = Array.from({ length: 100 }, () => limiter.consume(subject)).filter((r) => r.allowed)
    expect(allowed).toHaveLength(5)
  })

  it('la ventana vence y vuelve a dejar pasar', () => {
    const { limiter, advance } = setup()
    const subject = { ip: '1.1.1.1', account: 'milpa001' }
    failN(limiter, subject, 5)
    advance(15 * 60_000 - 1000)
    expect(limiter.consume(subject)).toEqual({ allowed: false, retryAfterSeconds: 1 })
    advance(1000)
    expect(limiter.consume(subject).allowed).toBe(true)
  })

  it('frena a una IP que prueba muchas cuentas', () => {
    const { limiter } = setup()
    for (let i = 0; i < 20; i += 1) limiter.consume({ ip: '1.1.1.1', account: `cuenta${i}` })
    expect(limiter.consume({ ip: '1.1.1.1', account: 'otra' }).allowed).toBe(false)
    expect(limiter.consume({ ip: '3.3.3.3', account: 'otra' }).allowed).toBe(true)
  })

  it('frena un ataque a una cuenta repartido entre IPs', () => {
    const { limiter } = setup()
    for (let i = 0; i < 30; i += 1) limiter.consume({ ip: `10.0.0.${i}`, account: 'milpa001' })
    expect(limiter.consume({ ip: '10.0.1.1', account: 'milpa001' }).allowed).toBe(false)
  })

  it('un acceso correcto se devuelve y limpia los fallos de esa cuenta, no los de la IP', () => {
    const { limiter } = setup()
    const subject = { ip: '1.1.1.1', account: 'milpa001' }
    const ok = () => { limiter.consume(subject); limiter.refund(subject); limiter.succeed(subject) }
    failN(limiter, subject, 4); ok()
    failN(limiter, subject, 4); ok()
    expect(limiter.consume(subject).allowed).toBe(true)
    // La IP lleva 9 fallos de 20 (los accesos buenos no cuentan) aunque haya entrado bien en medio.
    for (let i = 0; i < 11; i += 1) limiter.consume({ ip: '1.1.1.1', account: `x${i}` })
    expect(limiter.consume({ ip: '1.1.1.1', account: 'milpa001' }).allowed).toBe(false)
  })

  it('muchos accesos correctos desde la misma IP (una oficina) no la bloquean', () => {
    const { limiter } = setup()
    for (let i = 0; i < 50; i += 1) {
      const subject = { ip: '1.1.1.1', account: `persona${i}` }
      expect(limiter.consume(subject).allowed).toBe(true)
      limiter.refund(subject); limiter.succeed(subject)
    }
  })

  it('inundar de llaves nuevas no suelta un bloqueo vigente', () => {
    const { limiter, advance } = setup(ATTEMPT_RULES.google, 100)
    failN(limiter, { ip: 'atacante' }, 20)
    expect(limiter.consume({ ip: 'atacante' }).allowed).toBe(false)
    for (let i = 0; i < 1000; i += 1) { limiter.consume({ ip: `relleno-${i}` }); advance(1) }
    expect(limiter.size()).toBeLessThanOrEqual(100)
    expect(limiter.consume({ ip: 'atacante' }).allowed).toBe(false)
  })

  it('con la memoria llena sólo de bloqueos, rechaza llaves nuevas (falla cerrado)', () => {
    const { limiter } = setup(ATTEMPT_RULES.changePassword, 3)
    for (const account of ['a', 'b', 'c']) failN(limiter, { account }, 5)
    expect(limiter.consume({ account: 'd' })).toEqual({ allowed: false, retryAfterSeconds: 60 })
  })

  it('el mensaje da los minutos en español', () => {
    expect(tooManyAttemptsMessage(30)).toBe('Demasiados intentos. Espera 1 minuto e intenta de nuevo.')
    expect(tooManyAttemptsMessage(900)).toBe('Demasiados intentos. Espera 15 minutos e intenta de nuevo.')
  })
})

describe('llave de cliente', () => {
  it('IPv4 tal cual, también la mapeada de un socket dual', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7')
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7')
  })
  it('IPv6 por su /64, para que no estrene dirección en cada intento', () => {
    expect(clientKey('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12::/64')
    expect(clientKey('2001:DB8:ABCD:0012:ffff::1')).toBe('2001:db8:abcd:12::/64')
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(clientKey('::1')).toBe('0:0:0:0::/64')
    expect(clientKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
  })
  it('sin IP no hay llave', () => {
    expect(clientKey('')).toBe('')
    expect(clientKey(undefined)).toBe('')
  })
})
