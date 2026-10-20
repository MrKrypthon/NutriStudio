import { describe, expect, it } from 'vitest'
import { ATTEMPT_RULES, corsOriginOption, createAttemptLimiter, jwtSecretProblems, parseTrustProxy, tooManyAttemptsMessage } from './security.js'

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
  const setup = () => {
    let clock = 0
    const limiter = createAttemptLimiter({ rules: ATTEMPT_RULES.login, now: () => clock })
    return { limiter, advance: (ms) => { clock += ms } }
  }

  it('bloquea a la sexta contraseña equivocada para la misma cuenta y la misma IP', () => {
    const { limiter } = setup()
    const subject = { ip: '1.1.1.1', account: 'milpa001' }
    for (let i = 0; i < 5; i += 1) { expect(limiter.check(subject).allowed).toBe(true); limiter.fail(subject) }
    const result = limiter.check(subject)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterSeconds).toBe(15 * 60)
    // Otra IP para esa cuenta todavía puede (hasta el tope por cuenta).
    expect(limiter.check({ ip: '2.2.2.2', account: 'milpa001' }).allowed).toBe(true)
  })

  it('la ventana vence y vuelve a dejar pasar', () => {
    const { limiter, advance } = setup()
    const subject = { ip: '1.1.1.1', account: 'milpa001' }
    for (let i = 0; i < 5; i += 1) limiter.fail(subject)
    advance(15 * 60_000 - 1000)
    expect(limiter.check(subject)).toEqual({ allowed: false, retryAfterSeconds: 1 })
    advance(1000)
    expect(limiter.check(subject).allowed).toBe(true)
  })

  it('frena a una IP que prueba muchas cuentas', () => {
    const { limiter } = setup()
    for (let i = 0; i < 20; i += 1) limiter.fail({ ip: '1.1.1.1', account: `cuenta${i}` })
    expect(limiter.check({ ip: '1.1.1.1', account: 'otra' }).allowed).toBe(false)
    expect(limiter.check({ ip: '3.3.3.3', account: 'otra' }).allowed).toBe(true)
  })

  it('frena un ataque a una cuenta repartido entre IPs', () => {
    const { limiter } = setup()
    for (let i = 0; i < 30; i += 1) limiter.fail({ ip: `10.0.0.${i}`, account: 'milpa001' })
    expect(limiter.check({ ip: '10.0.1.1', account: 'milpa001' }).allowed).toBe(false)
  })

  it('un acceso correcto limpia los fallos de esa cuenta, no los de la IP', () => {
    const { limiter } = setup()
    for (let i = 0; i < 4; i += 1) limiter.fail({ ip: '1.1.1.1', account: 'milpa001' })
    limiter.succeed({ ip: '1.1.1.1', account: 'milpa001' })
    for (let i = 0; i < 4; i += 1) limiter.fail({ ip: '1.1.1.1', account: 'milpa001' })
    expect(limiter.check({ ip: '1.1.1.1', account: 'milpa001' }).allowed).toBe(true)
    // La IP ya lleva 8 fallos de 20 aunque haya entrado bien en medio.
    for (let i = 0; i < 12; i += 1) limiter.fail({ ip: '1.1.1.1', account: `x${i}` })
    expect(limiter.check({ ip: '1.1.1.1', account: 'milpa001' }).allowed).toBe(false)
  })

  it('no crece sin límite con muchas IPs distintas', () => {
    let clock = 0
    const limiter = createAttemptLimiter({ rules: ATTEMPT_RULES.google, now: () => clock, maxKeys: 100 })
    for (let i = 0; i < 1000; i += 1) { limiter.fail({ ip: `ip-${i}` }); clock += 1 }
    expect(limiter.size()).toBeLessThanOrEqual(100)
  })

  it('el mensaje da los minutos en español', () => {
    expect(tooManyAttemptsMessage(30)).toBe('Demasiados intentos. Espera 1 minuto e intenta de nuevo.')
    expect(tooManyAttemptsMessage(900)).toBe('Demasiados intentos. Espera 15 minutos e intenta de nuevo.')
  })
})
