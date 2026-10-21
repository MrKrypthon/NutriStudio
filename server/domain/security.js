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

// Límite de intentos fallidos, en memoria (una sola instancia de la API; con varias haría falta un
// almacén compartido). Cada regla cuenta fallos por su propia llave dentro de una ventana fija; si
// cualquiera de las llaves de un intento llegó a su tope, se rechaza sin probar la contraseña.
export function createAttemptLimiter({ rules, now = () => Date.now(), maxKeys = 50_000 }) {
  const buckets = new Map()

  const prune = (at) => {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= at) buckets.delete(key)
    // Si aun así hay demasiadas (muchas IPs distintas), se descartan las más viejas.
    if (buckets.size > maxKeys) {
      const excess = buckets.size - maxKeys
      let removed = 0
      for (const key of buckets.keys()) { buckets.delete(key); if (++removed >= excess) break }
    }
  }

  const keysFor = (subject) => rules
    .map((rule) => {
      const parts = rule.by.map((field) => subject[field])
      if (parts.some((part) => part === undefined || part === null || part === '')) return null
      return { rule, key: `${rule.name}:${parts.join('|')}` }
    })
    .filter(Boolean)

  return {
    // { allowed: true } o { allowed: false, retryAfterSeconds }
    check(subject) {
      const at = now()
      let retryAfterMs = 0
      for (const { rule, key } of keysFor(subject)) {
        const bucket = buckets.get(key)
        if (!bucket || bucket.resetAt <= at) continue
        if (bucket.count >= rule.max) retryAfterMs = Math.max(retryAfterMs, bucket.resetAt - at)
      }
      return retryAfterMs ? { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) } : { allowed: true }
    },
    fail(subject) {
      const at = now()
      for (const { rule, key } of keysFor(subject)) {
        const bucket = buckets.get(key)
        if (!bucket || bucket.resetAt <= at) buckets.set(key, { count: 1, resetAt: at + rule.windowMs })
        else bucket.count += 1
      }
      if (buckets.size > maxKeys) prune(at)
    },
    // Un acceso correcto borra los fallos de las reglas marcadas con `resetOnSuccess` (por ejemplo
    // IP + cuenta), no los de la IP sola: si no, alternar con una cuenta propia anularía el límite.
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
