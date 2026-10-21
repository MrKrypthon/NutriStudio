// Configuración de seguridad de la API (fase 111): proxy de confianza, orígenes de CORS, secretos
// de los tokens y límite de intentos de acceso. Lógica pura, sin Fastify ni base de datos, para
// probarla aparte.

const isProduction = (nodeEnv) => String(nodeEnv || '').trim().toLowerCase() === 'production'

// TRUST_PROXY: vacío/false = nadie (la IP es la de la conexión); true = cualquiera (sólo si la API
// no es alcanzable más que a través del proxy); un número = cuántos saltos de proxy creer; o una
// lista de IPs/CIDR separadas por comas. Detrás de Nginx en el mismo equipo basta «loopback» o 1.
// Creerle de más a X-Forwarded-For deja que cualquiera elija su IP (y esquive el límite de intentos).
export function parseTrustProxy(value) {
  const raw = String(value ?? '').trim()
  if (!raw || raw.toLowerCase() === 'false' || raw === '0') return false
  if (raw.toLowerCase() === 'true') return true
  if (/^\d+$/.test(raw)) return Number(raw)
  const list = raw.split(',').map((item) => item.trim()).filter(Boolean)
  return list.length === 1 ? list[0] : list
}

const normalizeOrigin = (value) => {
  try {
    const url = new URL(String(value).trim())
    return url.origin
  } catch {
    return null
  }
}

// En desarrollo se acepta cualquier origen (Vite en :5173 contra la API en :3001, IPs de la red
// local). En producción sólo los de CORS_ORIGINS (separados por comas) o, si no hay, el de APP_URL.
// Las peticiones sin Origin (el webhook de Stripe, curl) no pasan por CORS.
export function corsOriginOption({ nodeEnv, corsOrigins, appUrl } = {}) {
  const listed = String(corsOrigins || '').split(',').map(normalizeOrigin).filter(Boolean)
  if (listed.length) return [...new Set(listed)]
  if (!isProduction(nodeEnv)) return true
  const fromAppUrl = normalizeOrigin(appUrl)
  return fromAppUrl ? [fromAppUrl] : false
}

export const JWT_SECRET_MIN_LENGTH = 32

// Problemas de los secretos de los tokens. `fatal` detiene el arranque (sólo en producción); en
// desarrollo se avisa y se sigue, como antes.
export function jwtSecretProblems({ nodeEnv, jwtSecret, adminJwtSecret, exampleSecrets = [] } = {}) {
  const production = isProduction(nodeEnv)
  const problems = []
  const placeholders = new Set(exampleSecrets.filter(Boolean))
  const check = (name, value, required) => {
    if (!value) {
      if (required) problems.push({ fatal: production, message: `${name} no está configurada.` })
      return
    }
    if (!production) return
    if (value.length < JWT_SECRET_MIN_LENGTH) problems.push({ fatal: true, message: `${name} debe tener al menos ${JWT_SECRET_MIN_LENGTH} caracteres.` })
    if (placeholders.has(value)) problems.push({ fatal: true, message: `${name} es el valor de ejemplo de .env.example.` })
  }
  check('JWT_SECRET', jwtSecret, true)
  // Fuera de producción el panel puede seguir usando JWT_SECRET; en producción tiene el suyo.
  check('ADMIN_JWT_SECRET', adminJwtSecret, production)
  if (production && jwtSecret && adminJwtSecret && jwtSecret === adminJwtSecret) problems.push({ fatal: true, message: 'ADMIN_JWT_SECRET debe ser distinto de JWT_SECRET.' })
  return problems
}

// Llave de cliente para el límite: una IPv4 tal cual (también la «::ffff:a.b.c.d» que da Node en
// sockets duales) y una IPv6 por su prefijo /64, porque a una sola conexión le asignan el /64 entero
// y podría estrenar dirección en cada intento.
export function clientKey(ip) {
  const raw = String(ip || '').trim().toLowerCase()
  if (!raw) return ''
  const mapped = raw.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return mapped[1]
  if (!raw.includes(':')) return raw
  const [head, tail = ''] = raw.split('%')[0].split('::')
  const left = head ? head.split(':') : []
  const right = raw.includes('::') && tail ? tail.split(':') : []
  const groups = raw.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  return `${groups.slice(0, 4).map((group) => (group || '0').replace(/^0+(?=.)/, '')).join(':')}::/64`
}

// Límite de intentos, en memoria (una sola instancia de la API; con varias haría falta un almacén
// compartido). Cada regla cuenta intentos por su propia llave dentro de una ventana fija.
//
// `consume` cuenta el intento ANTES de probar la contraseña, en la misma vuelta síncrona en que lo
// revisa: si se contara después del bcrypt, cien peticiones simultáneas pasarían todas la revisión
// antes de que se registrara la primera. Si el acceso resulta correcto, `refund` devuelve el intento
// y `succeed` limpia las reglas marcadas.
export function createAttemptLimiter({ rules, now = () => Date.now(), maxKeys = 50_000 }) {
  const buckets = new Map()

  const blocking = (bucket, at) => bucket.resetAt > at && bucket.count >= bucket.max

  // Con la memoria llena se descartan primero las vencidas y después las que todavía no bloquean,
  // nunca un bloqueo vigente: si se borraran las más viejas, inundar de llaves nuevas soltaría a
  // quien ya está bloqueado. Si sólo quedan bloqueos, `consume` rechaza llaves nuevas (falla cerrado).
  const makeRoom = (at, needed) => {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= at) buckets.delete(key)
    if (buckets.size + needed <= maxKeys) return true
    for (const [key, bucket] of buckets) {
      if (!blocking(bucket, at)) buckets.delete(key)
      if (buckets.size + needed <= maxKeys) return true
    }
    return false
  }

  const keysFor = (subject) => rules
    .map((rule) => {
      const parts = rule.by.map((field) => subject[field])
      if (parts.some((part) => part === undefined || part === null || part === '')) return null
      return { rule, key: `${rule.name}:${parts.join('|')}` }
    })
    .filter(Boolean)

  const live = (key, at) => {
    const bucket = buckets.get(key)
    return bucket && bucket.resetAt > at ? bucket : null
  }

  return {
    // Revisa y cuenta en un solo paso. { allowed: true } o { allowed: false, retryAfterSeconds }.
    consume(subject) {
      const at = now()
      const entries = keysFor(subject)
      let retryAfterMs = 0
      for (const { key } of entries) {
        const bucket = live(key, at)
        if (bucket && bucket.count >= bucket.max) retryAfterMs = Math.max(retryAfterMs, bucket.resetAt - at)
      }
      if (retryAfterMs) return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }
      const missing = entries.filter(({ key }) => !live(key, at)).length
      if (buckets.size + missing > maxKeys && !makeRoom(at, missing)) return { allowed: false, retryAfterSeconds: 60 }
      for (const { rule, key } of entries) {
        const bucket = live(key, at)
        if (bucket) bucket.count += 1
        else buckets.set(key, { count: 1, max: rule.max, resetAt: at + rule.windowMs })
      }
      return { allowed: true }
    },
    // El intento resultó válido (contraseña correcta, token de Google bueno): no cuenta como fallo.
    refund(subject) {
      const at = now()
      for (const { key } of keysFor(subject)) {
        const bucket = live(key, at)
        if (bucket && bucket.count > 0) bucket.count -= 1
      }
    },
    // Un acceso correcto borra además los intentos de las reglas marcadas con `resetOnSuccess`
    // (IP + cuenta, cuenta), no los de la IP sola: si no, alternar con una cuenta propia anularía el
    // límite por IP.
    succeed(subject) {
      for (const { rule, key } of keysFor(subject)) if (rule.resetOnSuccess) buckets.delete(key)
    },
    size: () => buckets.size,
  }
}

const MINUTE = 60_000

// Topes de cada punto de acceso. Por IP + cuenta es lo estricto; por IP sola frena a quien prueba
// muchas cuentas; por cuenta sola frena un ataque repartido entre IPs (a costa de que el dueño espere
// hasta 15 minutos si alguien la ataca).
export const ATTEMPT_RULES = {
  login: [
    { name: 'login-ip-account', by: ['ip', 'account'], max: 5, windowMs: 15 * MINUTE, resetOnSuccess: true },
    { name: 'login-ip', by: ['ip'], max: 20, windowMs: 15 * MINUTE },
    { name: 'login-account', by: ['account'], max: 30, windowMs: 15 * MINUTE, resetOnSuccess: true },
  ],
  adminLogin: [
    { name: 'admin-ip-account', by: ['ip', 'account'], max: 5, windowMs: 15 * MINUTE, resetOnSuccess: true },
    { name: 'admin-ip', by: ['ip'], max: 10, windowMs: 15 * MINUTE },
    { name: 'admin-account', by: ['account'], max: 20, windowMs: 15 * MINUTE, resetOnSuccess: true },
  ],
  google: [
    { name: 'google-ip', by: ['ip'], max: 20, windowMs: 15 * MINUTE },
  ],
  changePassword: [
    { name: 'password-user', by: ['account'], max: 5, windowMs: 15 * MINUTE, resetOnSuccess: true },
  ],
}

export function tooManyAttemptsMessage(retryAfterSeconds) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  return `Demasiados intentos. Espera ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} e intenta de nuevo.`
}
