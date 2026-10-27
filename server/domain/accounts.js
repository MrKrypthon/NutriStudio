// Cuentas del SaaS (fase 109): un nutriólogo por cuenta, con acceso a todo mientras su
// suscripción esté pagada. Hay dos maneras de abrir una:
//   - ADMIN: el administrador la crea desde /admin (las primeras 100) y la persona entra con un
//     identificador y una contraseña temporal.
//   - GOOGLE: la persona se registra sola con su cuenta de Google.
// Las prácticas que existían antes (signupSource vacío, como la de desarrollo) no se bloquean.
import { randomInt } from 'node:crypto'

export const SIGNUP_SOURCES = ['ADMIN', 'GOOGLE']
export const ADMIN_ACCOUNT_LIMIT = 100
// Días de gracia después de «cubierto hasta» antes de bloquear: da tiempo a que Stripe reintente
// un cobro fallido o a que el administrador registre un pago por transferencia.
export const ACCESS_GRACE_DAYS = 7
// Prueba gratis al registrarse con Google: días de acceso completo antes de pedir la suscripción.
export const TRIAL_DAYS = 7
export const trialEndFrom = (now = new Date()) => new Date(new Date(now).getTime() + TRIAL_DAYS * 86400000)

// Identificador para entrar sin correo: minúsculas, números, punto, guion y guion bajo. Nunca lleva
// «@», así el inicio de sesión distingue un identificador de un correo.
const LOGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,29}$/
export const normalizeLoginId = (value) => String(value || '').trim().toLowerCase()
export const isValidLoginId = (value) => LOGIN_ID_PATTERN.test(normalizeLoginId(value))
export const suggestLoginId = (sequence) => `milpa${String(Math.max(1, sequence)).padStart(3, '0')}`

// Contraseña temporal legible para dictarla o enviarla: sin 0/O, 1/l/I.
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function generateTempPassword(length = 10) {
  let out = ''
  for (let i = 0; i < length; i += 1) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
  return out
}

/**
 * ¿Puede la práctica usar el sistema? Una suspendida nunca; una anterior a las cuentas de pago
 * siempre; las demás mientras `paidUntil` + días de gracia no haya pasado, o mientras dure su
 * prueba gratis (`trialEndsAt`). Devuelve también si ya está en gracia (cobertura vencida, todavía
 * con acceso) o en prueba, para avisarle.
 */
export function practiceAccess(practice, now = new Date()) {
  if (!practice) return { allowed: false, reason: 'NOT_FOUND' }
  if (practice.status === 'SUSPENDED') return { allowed: false, reason: 'SUSPENDED' }
  if (!SIGNUP_SOURCES.includes(practice.signupSource)) return { allowed: true, inGrace: false }
  const paidUntil = practice.paidUntil ? new Date(practice.paidUntil).getTime() : null
  const nowMs = new Date(now).getTime()
  if (paidUntil && paidUntil + ACCESS_GRACE_DAYS * 86400000 > nowMs) return { allowed: true, inGrace: paidUntil < nowMs }
  const trialEndsAt = practice.trialEndsAt ? new Date(practice.trialEndsAt) : null
  if (trialEndsAt && trialEndsAt.getTime() > nowMs) return { allowed: true, inGrace: false, trialEndsAt: trialEndsAt.toISOString() }
  return { allowed: false, reason: 'SUBSCRIPTION_REQUIRED', ...(trialEndsAt ? { trialEnded: true } : {}) }
}

// Nombre de la consulta para una cuenta nueva cuando no se indica otro.
export const defaultPracticeName = (personName) => (String(personName || '').trim() ? `Consulta de ${String(personName).trim()}` : 'Mi consulta')
