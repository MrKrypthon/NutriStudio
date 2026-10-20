import Fastify from 'fastify'
import cors from '@fastify/cors'
import { Prisma, PrismaClient } from '@prisma/client'
import 'dotenv/config'
import PDFDocument from 'pdfkit'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { searchFoods } from './providers/food.js'
import { NutritionEngineError, computeEnergyRequirement, computeMacros } from './domain/nutrition.js'
import { adjustmentFactor, applyRecipeAdjustments, buildMenuSnapshot, normalizeRecipeAdjustments, sanitizeJpeg } from './domain/documents.js'
import { PLAN_MEAL_KEYS, normalizeActiveMeals, normalizeMealLabels, normalizeMealNotes, normalizeMealTimes } from './domain/planMeals.js'
import { drawNutritionPlan } from './domain/planPdf.js'
import { asciiFileName, normalizePdfTheme, planFileName } from './domain/pdfTheme.js'
import { hasSectionContent } from './domain/templates.js'
import { normalizeEquivalentPlan, normalizeMenus } from './domain/equivalents.js'
import { normalizeRecipeIngredientRows, perServingFromIngredients } from './domain/recipeNutrition.js'
import { computeMicronutrientAdequacy } from './domain/micronutrients.js'
import Stripe from 'stripe'
import { OAuth2Client } from 'google-auth-library'
import { ADMIN_ACCOUNT_LIMIT, defaultPracticeName, generateTempPassword, isValidLoginId, normalizeLoginId, practiceAccess, suggestLoginId } from './domain/accounts.js'
import { copyCatalog } from './domain/catalogCopy.js'
import { LIVE_SUBSCRIPTION_STATUSES, SUBSCRIPTION_INTERVALS, invoiceConcept, invoicePeriodEnd, invoiceSubscriptionId, isStaleEvent, isSupersededSubscription, practiceIdFromMetadata, practicePatchFromSubscription } from './domain/billing.js'
import { foldText, toWinAnsi } from './domain/text.js'

// Default is 1 MiB, too small for base64-encoded file uploads (logo, lab attachments) -- a
// 10 MB PDF becomes ~13.3 MB as base64 JSON text, see POST /consultations/:id/lab-attachments.
const app = Fastify({ logger: true, bodyLimit: 15 * 1024 * 1024 })
const prisma = new PrismaClient()

if (!process.env.DATABASE_URL) app.log.warn('DATABASE_URL no está configurada. Copia .env.example a .env antes de usar persistencia.')

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) app.log.warn('JWT_SECRET no está configurada. Copia .env.example a .env antes de usar autenticación.')
const SESSION_TTL = '7d'

// Public routes need no session: the login endpoint itself, and Fastify's own CORS
// preflight (@fastify/cors replies to OPTIONS before this hook runs, but excluded here too
// in case that ever changes) and health check.
// El webhook de Stripe no trae sesión: se autentica con la firma `Stripe-Signature`.
// Entrar con Google y leer su configuración (el client id) tampoco llevan sesión.
const PUBLIC_ROUTES = new Set(['/health', '/api/v1/auth/login', '/api/v1/auth/google', '/api/v1/auth/config', '/api/v1/stripe/webhook'])
// Sin suscripción pagada la cuenta sólo puede ver su sesión, cambiar su contraseña y pagar.
const SUBSCRIPTION_FREE_ROUTES = new Set(['/api/v1/auth/me', '/api/v1/auth/logout', '/api/v1/auth/google/link', '/api/v1/auth/google/unlink', '/api/v1/auth/change-password', '/api/v1/billing', '/api/v1/billing/checkout', '/api/v1/billing/portal', '/api/v1/billing/sync'])
// Practice logos and recipe photos are branding/content, not patient data, and need to load in a
// plain <img src> (which can't send an Authorization header) both in-app and inside generated
// PDFs/emails — so these routes are public by design, scoped by unguessable ids/file names.
const PUBLIC_ROUTE_PATTERNS = [/^\/api\/v1\/practice\/[^/]+\/logo$/, /^\/api\/v1\/recipes\/images\/[^/]+$/, /^\/api\/v1\/ingredients\/images\/[^/]+$/]

// Acceso de cada práctica (tenant) del SaaS: suspendida, sin pagar o con acceso (ver
// server/domain/accounts.js). Se cachea 30 s para no consultar en cada petición; quien cambia el
// estado, la cobertura o la suscripción borra la entrada.
const practiceStatusCache = new Map()
// Versión de sesión de cada usuario (cacheada 30 s, como el acceso); un token con otra versión ya
// no vale. Quien la sube borra la entrada para que el cierre sea inmediato en este servidor.
const sessionVersionCache = new Map()
async function currentSessionVersion(userId) {
  const cached = sessionVersionCache.get(userId)
  if (cached && cached.expires > Date.now()) return cached.version
  // Un error de la base no se cachea ni cuenta como «sesión cerrada»: sube y responde 500.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true, status: true } })
  const version = user && user.status === 'ACTIVE' ? user.sessionVersion : null
  sessionVersionCache.set(userId, { version, expires: Date.now() + 30000 })
  return version
}
async function practiceAccessFor(practiceId) {
  const cached = practiceStatusCache.get(practiceId)
  if (cached && cached.expires > Date.now()) return cached.access
  const practice = await prisma.practice.findUnique({ where: { id: practiceId }, select: { status: true, signupSource: true, paidUntil: true } })
  const access = practiceAccess(practice)
  practiceStatusCache.set(practiceId, { access, expires: Date.now() + 30000 })
  return access
}

// Campos públicos del usuario. Nunca exponer `passwordHash`: GET/PUT /practice devolvían el
// usuario completo (con el hash bcrypt) al cliente.
const USER_PUBLIC_SELECT = { id: true, name: true, email: true, role: true, specialty: true, phone: true, licenseNumber: true }

// Nombre de archivo para Content-Disposition: sin comillas ni saltos de línea (inyección de
// cabecera) y con tope de longitud.
// Va siempre dentro de contentDisposition(): un nombre con caracteres fuera de Latin-1 ("Guía – plato.pdf")
// puesto tal cual en el encabezado hace que Node rechace la respuesta (ERR_INVALID_CHAR → 500).
const safeFileName = (name) => String(name || 'archivo').replace(/[\r\n"]/g, '').slice(0, 180)

// @fastify/cors defaults `methods` to 'GET,HEAD,POST' only (the CORS-spec "simple methods"),
// so without this every PUT here has silently failed preflight for any cross-origin caller
// (e.g. `npm run dev:all`, or the SPA and API on separate domains in production) — it only
// ever worked same-origin through Vite's dev proxy.
await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] })

app.addHook('onRequest', async (request, reply) => {
  // La ruta que Fastify ya resolvió, no la dirección cruda: el enrutador decodifica el
  // percent-encoding, así que `/%61pi/v1/patients` llegaba a /api/v1/patients sin sesión y
  // `/api/v1/%61dmin/…` a las rutas /admin con un token de práctica.
  const pathname = request.routeOptions?.url || request.url.split('?')[0]
  if (request.method === 'OPTIONS' || PUBLIC_ROUTES.has(pathname) || PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname))) return
  if (!pathname.startsWith('/api/v1/')) return
  const header = request.headers.authorization
  // Panel de administración del SaaS: usa su propio token (payload.admin) y solo sirve rutas /admin.
  if (pathname.startsWith('/api/v1/admin/')) {
    if (pathname === '/api/v1/admin/auth/login') return
    if (!header?.startsWith('Bearer ')) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Inicia sesión como administrador.', fields: {} })
    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET)
      if (!payload.admin) throw new Error('not admin')
      request.adminId = payload.sub
    } catch {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Sesión de administrador inválida.', fields: {} })
    }
    return
  }
  if (!header?.startsWith('Bearer ')) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Inicia sesión para continuar.', fields: {} })
  const invalidSession = () => reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Tu sesión expiró o no es válida. Inicia sesión de nuevo.', fields: {} })
  let payload
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET)
  } catch {
    return invalidSession()
  }
  // Un token de admin no lleva practiceId; si llegara por aquí, Prisma ignoraría el `practiceId:
  // undefined` y las consultas devolverían datos de TODAS las prácticas. Solo usuarios de práctica.
  if (payload.admin || !payload.practiceId) return invalidSession()
  request.userId = payload.sub
  request.practiceId = payload.practiceId
  request.userRole = payload.role
  // Contraseña cambiada o restablecida (o usuario desactivado): las sesiones anteriores se cierran.
  // Fuera del try: una falla de la base es un 500, no un 401 que cierre la sesión en la app.
  if ((await currentSessionVersion(payload.sub)) !== (payload.sv || 0)) return invalidSession()
  // Una cuenta suspendida no puede operar (se cachea para no consultar en cada petición).
  const access = await practiceAccessFor(request.practiceId)
  if (access.reason === 'SUSPENDED' || access.reason === 'NOT_FOUND') return reply.code(403).send({ code: 'ACCOUNT_SUSPENDED', message: 'Tu cuenta está suspendida. Contacta al administrador.', fields: {} })
  // Sin suscripción pagada: sólo la sesión y la pantalla de pago (402 = pago requerido).
  if (!access.allowed && !SUBSCRIPTION_FREE_ROUTES.has(pathname)) return reply.code(402).send({ code: 'SUBSCRIPTION_REQUIRED', message: 'Tu suscripción no está activa. Suscríbete para seguir usando Milpa.', fields: {} })
})

// Best-effort audit trail: never let a logging failure break the write it's describing.
// `patientId` always goes in `metadata` (not just `entityId`) because not every audited
// entity IS a patient — a Diagnosis or Document's entityId is its own id — but every one of
// them belongs to exactly one patient, and that's what the patient timeline queries by.
async function logAudit(request, { action, entity, entityId, patientId, metadata }) {
  try {
    // "Desde dónde" se editó: guardamos la IP y el navegador/sistema (device) en todos los eventos
    // para poder reconstruir quién cambió qué y desde qué equipo.
    const agent = String(request?.headers?.['user-agent'] || '').slice(0, 200)
    const origin = { ip: request?.ip || null, agent }
    await prisma.auditEvent.create({ data: { practiceId: request.practiceId, userId: request.userId, action, entity, entityId, metadata: { patientId, origin, ...metadata } } })
  } catch (err) {
    app.log.warn({ err }, 'No se pudo registrar el evento de auditoría')
  }
}

// Registro de accesos al expediente (trazabilidad, NOM-024-SSA3-2012 6.6.1; confidencialidad,
// NOM-004-SSA3-2012 5.5 y 5.7): además de quién edita, queda quién abre el expediente o el
// historial y quién descarga sus documentos, con fecha, hora y equipo. Las aperturas repetidas del
// mismo usuario al mismo expediente se agrupan en ventanas de 30 minutos (cada recarga o cambio de
// pestaña vuelve a pedir los datos y llenaría la bitácora); las descargas se registran todas.
const ACCESS_ACTIONS = ['viewed', 'downloaded', 'generated']
const ACCESS_WINDOW_MS = 30 * 60 * 1000
const recentAccess = new Map()
async function logAccess(request, { patientId, scope, action = 'viewed', entity = 'Patient', entityId = null, metadata = {} }) {
  if (!patientId || !request.userId) return
  if (action === 'viewed') {
    const key = `${request.userId}:${patientId}:${scope}:${entityId || ''}`
    const now = Date.now()
    if (now - (recentAccess.get(key) || 0) < ACCESS_WINDOW_MS) return
    recentAccess.set(key, now)
    if (recentAccess.size > 5000) for (const [entryKey, at] of recentAccess) if (now - at > ACCESS_WINDOW_MS) recentAccess.delete(entryKey)
  }
  await logAudit(request, { action, entity, entityId: entityId || patientId, patientId, metadata: { scope, ...metadata } })
}

// Número de expediente (NOM-004-SSA3-2012, 5.9): consecutivo por consultorio, único y permanente.
// Se asigna al dar de alta al paciente y, para los que ya existían, la primera vez que se consultan.
// Los pacientes que aún no tienen número lo reciben por orden de alta, para que el consecutivo
// refleje la antigüedad del expediente y no el orden en que alguien los abrió.
async function ensureRecordNumber(patient) {
  if (!patient || patient.recordNumber) return patient
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        const { _max } = await tx.patient.aggregate({ where: { practiceId: patient.practiceId }, _max: { recordNumber: true } })
        const pending = await tx.patient.findMany({ where: { practiceId: patient.practiceId, recordNumber: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } })
        let next = _max.recordNumber || 0
        for (const item of pending) await tx.patient.update({ where: { id: item.id }, data: { recordNumber: ++next } })
      })
      return prisma.patient.findUnique({ where: { id: patient.id } })
    } catch (error) {
      if (error.code !== 'P2002' && error.code !== 'P2034') throw error
    }
  }
  return prisma.patient.findUnique({ where: { id: patient.id } })
}

// CURP (identificador del paciente en la NOM-024-SSA3-2012): 18 caracteres con la estructura oficial.
const CURP_PATTERN = /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/
const normalizeCurp = (value) => String(value || '').trim().toUpperCase()

// Una consulta cerrada es inalterable (NOM-004-SSA3-2012, 5.11; NOM-024-SSA3-2012, 5.9): antes el
// bloqueo existía sólo en pantalla y el servidor aceptaba cambios. Para corregirla hay que reabrirla
// con un motivo, y cada cambio posterior queda en la bitácora con su versión anterior.
const consultationClosed = (consultation, reply) => {
  if (consultation?.status !== 'COMPLETED') return false
  reply.code(409).send({ code: 'CONSULTATION_CLOSED', message: 'La consulta está cerrada. Reábrela indicando el motivo para corregirla.', fields: {} })
  return true
}

app.get('/health', async () => ({ status: 'ok', service: 'nutri-studio-api' }))

// Sesión de la nutrióloga: el token y lo que la app necesita al entrar. `access` dice si la cuenta
// puede usar el sistema o sólo ver la pantalla de pago.
// Una cuenta abierta con Google y sin identificador sólo entra con Google (su contraseña es aleatoria).
const isGoogleOnly = (user) => !user.loginId && user.practice?.signupSource === 'GOOGLE'
const sessionPayload = (user) => ({
  user: { id: user.id, name: user.name, email: user.email, role: user.role, loginId: user.loginId, google: Boolean(user.googleSub), googleOnly: isGoogleOnly(user) },
  practice: { id: user.practice.id, name: user.practice.name, timeZone: user.practice.timeZone },
  access: practiceAccess(user.practice),
})
const signToken = (user) => jwt.sign({ sub: user.id, practiceId: user.practiceId, role: user.role, sv: user.sessionVersion || 0 }, JWT_SECRET, { expiresIn: SESSION_TTL })
const signSession = (user) => ({ token: signToken(user), ...sessionPayload(user) })

// Se entra con el correo o con el identificador que dio el administrador (un identificador nunca
// lleva «@»). El correo sólo es único por práctica (y se edita sin verificar en Configuración, o lo
// trae una cuenta de Google), así que se prueba la contraseña con cada usuario activo que lo tenga:
// tomar sólo el primero dejaba fuera al dueño real si salía otro antes.
app.post('/api/v1/auth/login', async (request, reply) => {
  const { email, password } = request.body || {}
  const login = String(email || '').trim()
  if (!login || !password || typeof password !== 'string') return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Correo o identificador y contraseña son obligatorios.', fields: { email: !login, password: !password } })
  const where = login.includes('@') ? { email: { equals: login, mode: 'insensitive' } } : { loginId: normalizeLoginId(login) }
  const candidates = await prisma.user.findMany({ where: { ...where, status: 'ACTIVE' }, include: { practice: true }, orderBy: { createdAt: 'asc' }, take: 10 })
  let user = null
  for (const candidate of candidates) if (await bcrypt.compare(password, candidate.passwordHash)) { user = candidate; break }
  if (!user) return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: 'Correo, identificador o contraseña incorrectos.', fields: {} })
  if (user.practice.status === 'SUSPENDED') return reply.code(403).send({ code: 'ACCOUNT_SUSPENDED', message: 'Tu cuenta está suspendida. Contacta al administrador.', fields: {} })
  return signSession(user)
})

// ── Cuentas nuevas (fase 109) ───────────────────────────────────────────────
// Práctica de donde sale el catálogo inicial (alimentos, libro SMAE, recetas) de cada cuenta nueva.
const CATALOG_PRACTICE_ID = process.env.CATALOG_PRACTICE_ID || process.env.DEFAULT_PRACTICE_ID || '00000000-0000-0000-0000-000000000001'
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null

// Abre una cuenta: práctica + su nutriólogo (dueño) + copia del catálogo, todo o nada.
// `googleSub` y `loginId` no son únicos en la base, así que dos peticiones a la vez (doble clic en
// «Continuar con Google», el aviso de Google repetido) abrían dos cuentas para la misma persona. Un
// candado de la transacción por identidad las forma en fila; la segunda encuentra la cuenta ya creada
// y la devuelve (`existing`) en lugar de abrir otra.
async function createAccount({ signupSource, practiceName, name, email, loginId = null, googleSub = null, passwordHash, paidUntil = null }) {
  return prisma.$transaction(async (tx) => {
    const identity = googleSub ? { googleSub } : loginId ? { loginId } : null
    if (identity) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`account:${googleSub ? `google:${googleSub}` : `login:${loginId}`}`}))`
      const existing = await tx.user.findFirst({ where: identity, include: { practice: true } })
      if (existing) return Object.assign(existing, { existing: true })
    }
    const practice = await tx.practice.create({ data: { name: practiceName || defaultPracticeName(name), signupSource, paidUntil } })
    const user = await tx.user.create({ data: { practiceId: practice.id, name, email: email || '', loginId, googleSub, passwordHash, role: 'OWNER' }, include: { practice: true } })
    await copyCatalog(tx, CATALOG_PRACTICE_ID, practice.id)
    return user
  }, { maxWait: 10000, timeout: 120000 })
}

app.get('/api/v1/auth/config', async () => ({ googleClientId: GOOGLE_CLIENT_ID || null }))

// Verifica el token firmado (ID token) que el navegador obtuvo de Google: firma, que sea para
// nuestra app y que el correo esté verificado. Devuelve el perfil o responde el error.
async function verifyGoogleCredential(request, reply) {
  if (!googleClient) { reply.code(503).send({ code: 'GOOGLE_NOT_CONFIGURED', message: 'El acceso con Google todavía no está activo en este servidor.', fields: {} }); return null }
  const credential = request.body?.credential
  if (!credential || typeof credential !== 'string') { reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Falta la respuesta de Google.', fields: {} }); return null }
  let profile
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID })
    profile = ticket.getPayload()
  } catch (err) {
    request.log.warn({ err: err.message }, 'Token de Google inválido')
    reply.code(401).send({ code: 'INVALID_GOOGLE_TOKEN', message: 'Google no confirmó tu cuenta. Intenta de nuevo.', fields: {} })
    return null
  }
  if (!profile?.sub || !profile.email || !profile.email_verified) { reply.code(401).send({ code: 'INVALID_GOOGLE_TOKEN', message: 'Tu cuenta de Google no tiene un correo verificado.', fields: {} }); return null }
  return profile
}

// Entrar (o registrarse) con Google. La cuenta se busca SÓLO por la identidad de Google (`sub`),
// nunca por correo: el correo de un usuario se puede editar en Configuración sin verificarlo, y
// enlazar por correo permitiría que alguien pusiera el Gmail de otra persona y la metiera en su
// consulta (o le impidiera registrarse). La primera vez se abre una cuenta nueva, sin acceso hasta
// suscribirse. Una cuenta del panel usa Google vinculándolo desde su sesión (POST /auth/google/link).
app.post('/api/v1/auth/google', async (request, reply) => {
  const profile = await verifyGoogleCredential(request, reply)
  if (!profile) return reply
  const email = profile.email.toLowerCase()

  let user = await prisma.user.findFirst({ where: { googleSub: profile.sub }, include: { practice: true } })
  let created = false
  if (!user) {
    // Contraseña inutilizable: estas cuentas entran sólo con Google.
    const passwordHash = await bcrypt.hash(generateTempPassword(32), 10)
    user = await createAccount({ signupSource: 'GOOGLE', name: profile.name || email.split('@')[0], email, googleSub: profile.sub, passwordHash })
    created = !user.existing
    if (created) request.log.info({ practiceId: user.practiceId }, 'Cuenta nueva con Google')
  }
  if (user.status !== 'ACTIVE') return reply.code(403).send({ code: 'ACCOUNT_DISABLED', message: 'Este usuario está desactivado. Contacta al administrador.', fields: {} })
  if (user.practice.status === 'SUSPENDED') return reply.code(403).send({ code: 'ACCOUNT_SUSPENDED', message: 'Tu cuenta está suspendida. Contacta al administrador.', fields: {} })
  return { ...signSession(user), created }
})

// Stateless JWT: there is no server-side session to invalidate yet, so this only exists for
// symmetry with login and as a hook point for a future token-blacklist. Logging out is really
// the client discarding its token.
app.post('/api/v1/auth/logout', async (request, reply) => reply.code(204).send())

// Vincular Google a la cuenta con la que ya se inició sesión (por ejemplo, una creada desde /admin):
// desde ahí puede entrar también con ese Google. Una identidad de Google sirve para una sola cuenta.
app.post('/api/v1/auth/google/link', async (request, reply) => {
  const profile = await verifyGoogleCredential(request, reply)
  if (!profile) return reply
  // Mismo candado que createAccount: un registro con ese Google al mismo tiempo no la duplica.
  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`account:google:${profile.sub}`}))`
    const owner = await tx.user.findFirst({ where: { googleSub: profile.sub }, select: { id: true } })
    if (owner && owner.id !== request.userId) return null
    return tx.user.update({ where: { id: request.userId }, data: { googleSub: profile.sub }, include: { practice: true } })
  })
  if (!user) return reply.code(409).send({ code: 'GOOGLE_LINKED_ELSEWHERE', message: 'Esa cuenta de Google ya entra a otra consulta de Milpa.', fields: {} })
  await logAudit(request, { action: 'google_linked', entity: 'User', entityId: user.id, metadata: { googleEmail: profile.email.toLowerCase() } })
  return sessionPayload(user)
})

app.post('/api/v1/auth/google/unlink', async (request, reply) => {
  const user = await prisma.user.findUnique({ where: { id: request.userId }, include: { practice: true } })
  // Quien sólo entra con Google se quedaría sin forma de entrar.
  if (isGoogleOnly(user)) return reply.code(409).send({ code: 'GOOGLE_ONLY', message: 'Tu cuenta entra sólo con Google; no se puede desvincular.', fields: {} })
  // Desvincular cierra también las sesiones abiertas con ese Google; esta sigue con un token nuevo.
  const updated = await prisma.user.update({ where: { id: user.id }, data: { googleSub: null, sessionVersion: { increment: 1 } }, include: { practice: true } })
  sessionVersionCache.delete(user.id)
  await logAudit(request, { action: 'google_unlinked', entity: 'User', entityId: user.id })
  return signSession(updated)
})

app.get('/api/v1/auth/me', async (request, reply) => {
  const user = await prisma.user.findUnique({ where: { id: request.userId }, include: { practice: true } })
  if (!user) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Sesión inválida.', fields: {} })
  return sessionPayload(user)
})

app.get('/api/v1/practice', async (request, reply) => {
  const practice = await prisma.practice.findUnique({ where: { id: request.practiceId } })
  if (!practice) return reply.code(404).send({ code: 'PRACTICE_NOT_FOUND', message: 'Práctica no encontrada.', fields: {} })
  const user = await prisma.user.findUnique({ where: { id: request.userId }, select: USER_PUBLIC_SELECT })
  return { ...practice, pdfTheme: normalizePdfTheme(practice.pdfTheme), user }
})

app.put('/api/v1/practice', async (request, reply) => {
  const { name, timeZone, address, establishmentType, userName, userEmail, userSpecialty, userPhone, userLicenseNumber, businessHours, fees } = request.body || {}
  if (!name || !timeZone) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Nombre de la práctica y zona horaria son obligatorios.', fields: { name: !name, timeZone: !timeZone } })
  // La zona y el horario de atención alimentan toda la lógica de la agenda ("ahora", huecos libres):
  // una zona que Intl no reconoce o rangos mal formados (sin start/end) rompían la Agenda.
  try { new Intl.DateTimeFormat('en-US', { timeZone }) } catch { return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Zona horaria inválida.', fields: { timeZone: 'invalid' } }) }
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
  if (businessHours !== undefined && businessHours !== null && !(Array.isArray(businessHours.ranges) && businessHours.ranges.every((range) => range && HHMM.test(range.start) && HHMM.test(range.end) && range.start < range.end))) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Horario de atención inválido.', fields: { businessHours: 'invalid' } })
  const practice = await prisma.practice.update({ where: { id: request.practiceId }, data: { name, timeZone, ...(establishmentType !== undefined ? { establishmentType: String(establishmentType || '').trim().slice(0, 80) || null } : {}), ...(address !== undefined ? { address: String(address).trim().slice(0, 200) || null } : {}), ...(businessHours !== undefined ? { businessHours } : {}), ...(fees !== undefined ? { fees: normalizeFees(fees) } : {}) } })
  let user = await prisma.user.findUnique({ where: { id: request.userId }, select: USER_PUBLIC_SELECT })
  if (user) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: userName || user.name,
        email: userEmail || user.email,
        ...(userSpecialty !== undefined ? { specialty: userSpecialty } : {}),
        ...(userPhone !== undefined ? { phone: userPhone } : {}),
        ...(userLicenseNumber !== undefined ? { licenseNumber: String(userLicenseNumber).trim().slice(0, 40) || null } : {}),
      },
      select: USER_PUBLIC_SELECT,
    })
  }
  return { ...practice, user }
})

// Diseño del plan en PDF: se guarda ya normalizado (un valor raro vuelve al de por defecto).
app.put('/api/v1/practice/pdf-theme', async (request) => {
  const practice = await prisma.practice.update({ where: { id: request.practiceId }, data: { pdfTheme: normalizePdfTheme(request.body?.theme) } })
  return { pdfTheme: normalizePdfTheme(practice.pdfTheme) }
})

// Guardar sólo las tarifas (la pantalla de Finanzas no tiene por qué reenviar nombre/zona horaria).
app.put('/api/v1/practice/fees', async (request) => {
  const practice = await prisma.practice.update({ where: { id: request.practiceId }, data: { fees: normalizeFees(request.body?.fees) } })
  return { fees: practice.fees }
})

// ── Panel de administración del SaaS (/admin) ────────────────────────────────
app.post('/api/v1/admin/auth/login', async (request, reply) => {
  const { email, password } = request.body || {}
  if (!email || !password) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Email y contraseña son obligatorios.', fields: {} })
  const admin = await prisma.adminUser.findUnique({ where: { email } })
  const valid = admin ? await bcrypt.compare(password, admin.passwordHash) : false
  if (!admin || !valid) return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: 'Credenciales de administrador incorrectas.', fields: {} })
  const token = jwt.sign({ sub: admin.id, admin: true }, JWT_SECRET, { expiresIn: '12h' })
  return { token, admin: { id: admin.id, name: admin.name, email: admin.email } }
})

// Cuántas cuentas lleva creadas el administrador y qué identificador sugerir para la siguiente.
async function adminAccountQuota() {
  const used = await prisma.practice.count({ where: { signupSource: 'ADMIN' } })
  let sequence = used + 1
  while (await prisma.user.findFirst({ where: { loginId: suggestLoginId(sequence) }, select: { id: true } })) sequence += 1
  return { used, limit: ADMIN_ACCOUNT_LIMIT, suggestedLoginId: suggestLoginId(sequence) }
}

app.get('/api/v1/admin/practices', async () => {
  const practices = await prisma.practice.findMany({
    include: {
      _count: { select: { patients: true, users: true } },
      transactions: { select: { amountCents: true } },
      users: { select: { name: true, email: true, loginId: true, googleSub: true }, orderBy: { createdAt: 'asc' }, take: 1 },
    },
    orderBy: { createdAt: 'asc' },
  })
  return {
    adminAccounts: await adminAccountQuota(),
    items: practices.map((practice) => ({
      id: practice.id,
      name: practice.name,
      status: practice.status,
      signupSource: practice.signupSource,
      owner: practice.users[0] ? { name: practice.users[0].name, email: practice.users[0].email || null, loginId: practice.users[0].loginId, google: Boolean(practice.users[0].googleSub) } : null,
      paymentMethod: practice.paymentMethod,
      paidUntil: practice.paidUntil,
      createdAt: practice.createdAt,
      patients: practice._count.patients,
      users: practice._count.users,
      subscriptionStatus: practice.subscriptionStatus,
      subscriptionInterval: practice.subscriptionInterval,
      cancelAtPeriodEnd: practice.cancelAtPeriodEnd,
      collectedCents: practice.transactions.reduce((sum, item) => sum + item.amountCents, 0),
      transactionCount: practice.transactions.length,
    })),
  }
})

// Crear una cuenta desde el panel (las primeras 100, ADMIN_ACCOUNT_LIMIT). La persona entra con su
// identificador (o su correo, si se dio) y una contraseña temporal que se muestra una sola vez.
app.post('/api/v1/admin/practices', async (request, reply) => {
  const { name, practiceName, email, loginId, paidUntil } = request.body || {}
  const personName = String(name || '').trim().slice(0, 120)
  const id = normalizeLoginId(loginId)
  const mail = String(email || '').trim().toLowerCase().slice(0, 160)
  const fields = { name: !personName, loginId: !isValidLoginId(id), email: Boolean(mail) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) }
  if (fields.name || fields.loginId || fields.email) {
    const message = fields.name ? 'Escribe el nombre del nutriólogo.' : fields.loginId ? 'El identificador lleva de 3 a 30 caracteres: minúsculas, números, punto o guion, sin espacios ni «@».' : 'El correo no es válido.'
    return reply.code(400).send({ code: 'VALIDATION_ERROR', message, fields })
  }
  const coverage = paidUntil ? new Date(paidUntil) : null
  if (coverage && Number.isNaN(coverage.getTime())) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fecha de cobertura inválida.', fields: { paidUntil: true } })
  const quota = await adminAccountQuota()
  if (quota.used >= ADMIN_ACCOUNT_LIMIT) return reply.code(409).send({ code: 'ADMIN_LIMIT_REACHED', message: `Ya se crearon las ${ADMIN_ACCOUNT_LIMIT} cuentas del panel. Las siguientes se registran con Google.`, fields: {} })
  if (await prisma.user.findFirst({ where: { loginId: id }, select: { id: true } })) return reply.code(409).send({ code: 'LOGIN_ID_TAKEN', message: 'Ese identificador ya lo usa otra cuenta.', fields: { loginId: true } })
  if (mail && await prisma.user.findFirst({ where: { email: { equals: mail, mode: 'insensitive' }, status: 'ACTIVE' }, select: { id: true } })) return reply.code(409).send({ code: 'EMAIL_TAKEN', message: 'Ese correo ya lo usa otra cuenta.', fields: { email: true } })
  const tempPassword = generateTempPassword()
  const user = await createAccount({ signupSource: 'ADMIN', practiceName: String(practiceName || '').trim().slice(0, 120), name: personName, email: mail, loginId: id, passwordHash: await bcrypt.hash(tempPassword, 10), paidUntil: coverage })
  if (user.existing) return reply.code(409).send({ code: 'LOGIN_ID_TAKEN', message: 'Ese identificador ya lo usa otra cuenta.', fields: { loginId: true } })
  request.log.info({ practiceId: user.practiceId, adminId: request.adminId }, 'Cuenta creada desde el panel')
  return reply.code(201).send({ practiceId: user.practiceId, practiceName: user.practice.name, name: user.name, email: user.email || null, loginId: user.loginId, tempPassword })
})

// Nueva contraseña temporal para el dueño de una cuenta (por ejemplo, si olvidó la suya).
app.post('/api/v1/admin/practices/:practiceId/reset-password', async (request, reply) => {
  const user = await prisma.user.findFirst({ where: { practiceId: request.params.practiceId }, orderBy: { createdAt: 'asc' }, include: { practice: true } })
  if (!user) return reply.code(404).send({ code: 'PRACTICE_NOT_FOUND', message: 'Cuenta no encontrada.', fields: {} })
  // Una cuenta que sólo entra con Google no tiene contraseña que restablecer: se recupera con Google.
  if (isGoogleOnly(user)) return reply.code(409).send({ code: 'GOOGLE_ONLY', message: 'Esta cuenta entra sólo con Google; no usa contraseña.', fields: {} })
  const tempPassword = generateTempPassword()
  // Restablecer es también recuperar la cuenta: se cierran todas sus sesiones y se quita el Google
  // vinculado (quien tuviera acceso no conserva otra puerta). Puede volver a vincularlo después.
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(tempPassword, 10), sessionVersion: { increment: 1 }, googleSub: null } })
  sessionVersionCache.delete(user.id)
  request.log.info({ practiceId: user.practiceId, adminId: request.adminId }, 'Contraseña restablecida desde el panel')
  return { name: user.name, email: user.email || null, loginId: user.loginId, tempPassword }
})

app.patch('/api/v1/admin/practices/:practiceId', async (request, reply) => {
  const { status, paymentMethod, paidUntil } = request.body || {}
  const practice = await prisma.practice.findUnique({ where: { id: request.params.practiceId } })
  if (!practice) return reply.code(404).send({ code: 'PRACTICE_NOT_FOUND', message: 'Cuenta no encontrada.', fields: {} })
  if (paidUntil && Number.isNaN(new Date(paidUntil).getTime())) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fecha de cobertura inválida.', fields: { paidUntil: true } })
  const updated = await prisma.practice.update({
    where: { id: practice.id },
    data: {
      ...(['ACTIVE', 'SUSPENDED'].includes(status) ? { status } : {}),
      ...(paymentMethod !== undefined ? { paymentMethod: PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : null } : {}),
      ...(paidUntil !== undefined ? { paidUntil: paidUntil ? new Date(paidUntil) : null } : {}),
    },
  })
  practiceStatusCache.delete(practice.id)
  return updated
})

app.get('/api/v1/admin/transactions', async () => {
  const [items, aggregate] = await prisma.$transaction([
    prisma.transaction.findMany({ include: { practice: { select: { id: true, name: true } } }, orderBy: { occurredAt: 'desc' }, take: 200 }),
    prisma.transaction.aggregate({ _sum: { amountCents: true }, _count: true }),
  ])
  return { items, totalCents: aggregate._sum.amountCents || 0, count: aggregate._count || 0 }
})

app.post('/api/v1/admin/transactions', async (request, reply) => {
  const { practiceId, amountCents, method, concept, occurredAt, extendMonths } = request.body || {}
  const amount = normalizeCents(amountCents)
  if (amount <= 0) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El monto debe ser mayor a cero.', fields: { amountCents: true } })
  const practice = typeof practiceId === 'string' && await prisma.practice.findUnique({ where: { id: practiceId } })
  if (!practice) return reply.code(404).send({ code: 'PRACTICE_NOT_FOUND', message: 'Cuenta no encontrada.', fields: {} })
  const when = occurredAt ? new Date(occurredAt) : new Date()
  if (Number.isNaN(when.getTime())) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fecha inválida.', fields: { occurredAt: true } })
  const validMethod = PAYMENT_METHODS.includes(method) ? method : null
  const created = await prisma.transaction.create({ data: { practiceId: practice.id, amountCents: amount, method: validMethod, concept: concept == null ? null : String(concept).trim() || null, occurredAt: when } })
  // "Registrar pago" puede extender la cobertura: suma meses a paidUntil (desde hoy o desde la
  // cobertura vigente) y guarda el método de pago usado.
  const months = Number(extendMonths) || 0
  if (months > 0) {
    const base = practice.paidUntil && practice.paidUntil > new Date() ? new Date(practice.paidUntil) : new Date()
    // Sumar meses sin desbordar el fin de mes (31 ene + 1 mes debe ser 28/29 feb, no 2/3 mar).
    const next = new Date(base)
    const day = base.getDate()
    next.setDate(1)
    next.setMonth(next.getMonth() + months)
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
    next.setDate(Math.min(day, lastDay))
    await prisma.practice.update({ where: { id: practice.id }, data: { paidUntil: next, ...(validMethod ? { paymentMethod: validMethod } : {}) } })
    practiceStatusCache.delete(practice.id)
  }
  return reply.code(201).send(created)
})

// ── Suscripción del SaaS con Stripe (fase 108) ───────────────────────────────
// Se configura con variables de entorno (ver .env.example): sin STRIPE_SECRET_KEY la sección de
// suscripción dice que los pagos en línea no están activos y nada más cambia. El cobro ocurre en la
// página de Stripe (Checkout) y la tarjeta y las facturas se administran en su portal; aquí sólo
// se guarda el estado que Stripe nos avisa por webhook.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null
const STRIPE_PRICES = { month: process.env.STRIPE_PRICE_MONTHLY || '', year: process.env.STRIPE_PRICE_YEARLY || '' }
const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '')
// Un error de Stripe (llave inválida, red caída, precio inexistente) no debe llegar crudo a la pantalla.
const stripeFailed = (request, reply, err) => {
  request.log.error({ err: err.message, type: err.type }, 'Error de Stripe')
  return reply.code(502).send({ code: 'STRIPE_ERROR', message: 'No se pudo conectar con Stripe. Intenta de nuevo en unos minutos.', fields: {} })
}
const billingUnavailable = (reply) => reply.code(503).send({ code: 'BILLING_NOT_CONFIGURED', message: 'Los pagos en línea todavía no están activos en este servidor.', fields: {} })

// Los precios cambian poco: se piden a Stripe una vez cada 10 minutos.
let priceCache = { at: 0, items: [] }
async function loadPrices() {
  if (!stripe) return []
  if (Date.now() - priceCache.at < 10 * 60 * 1000) return priceCache.items
  const items = []
  for (const interval of SUBSCRIPTION_INTERVALS) {
    if (!STRIPE_PRICES[interval]) continue
    try {
      const price = await stripe.prices.retrieve(STRIPE_PRICES[interval])
      if (price.active) items.push({ interval, amountCents: price.unit_amount, currency: price.currency })
    } catch (err) {
      app.log.warn({ err: err.message, interval }, 'No se pudo leer el precio de Stripe')
    }
  }
  priceCache = { at: Date.now(), items }
  return items
}

const billingView = async (practice) => ({
  configured: Boolean(stripe),
  testMode: Boolean(process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')),
  status: practice.subscriptionStatus,
  interval: practice.subscriptionInterval,
  cancelAtPeriodEnd: practice.cancelAtPeriodEnd,
  paidUntil: practice.paidUntil,
  hasCustomer: Boolean(practice.stripeCustomerId),
  prices: await loadPrices(),
})

// Aplica una suscripción de Stripe a su práctica. `eventCreated` (segundos) evita que un aviso
// atrasado deshaga uno más nuevo; una sincronización directa (sin evento) siempre aplica.
async function applySubscription(subscription, eventCreated = null) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id
  const byMetadata = practiceIdFromMetadata(subscription)
  const practice = (byMetadata && await prisma.practice.findUnique({ where: { id: byMetadata } }))
    || (customerId && await prisma.practice.findFirst({ where: { stripeCustomerId: customerId } }))
  if (!practice) { app.log.warn({ subscription: subscription.id }, 'Suscripción de Stripe sin práctica conocida'); return null }
  if (eventCreated && isStaleEvent(eventCreated, practice.stripeSyncedAt)) return practice
  if (isSupersededSubscription(subscription, practice)) return practice
  const syncedAt = eventCreated ? new Date(eventCreated * 1000) : new Date()
  const updated = await prisma.practice.update({ where: { id: practice.id }, data: { ...practicePatchFromSubscription(subscription, practice.paidUntil), stripeSyncedAt: syncedAt } })
  // Después de guardar: borrarla antes dejaba que una petición en medio volviera a cachear el acceso viejo.
  practiceStatusCache.delete(practice.id)
  return updated
}

// Una factura pagada extiende la cobertura hasta el fin del periodo que paga (también si salió en
// $0 por un cupón o un periodo de prueba) y, si hubo cobro, queda una sola vez en el historial de
// pagos del panel /admin.
async function recordInvoicePayment(invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
  const practice = customerId && await prisma.practice.findFirst({ where: { stripeCustomerId: customerId } })
  if (!practice) { app.log.warn({ invoice: invoice.id }, 'Factura de Stripe sin práctica conocida'); return }
  const end = invoicePeriodEnd(invoice)
  if (end && invoiceSubscriptionId(invoice) && (!practice.paidUntil || end > practice.paidUntil)) {
    await prisma.practice.update({ where: { id: practice.id }, data: { paidUntil: end } })
    practiceStatusCache.delete(practice.id)
  }
  if (!invoice.amount_paid || invoice.amount_paid <= 0) return
  const existing = await prisma.transaction.findFirst({ where: { stripeInvoiceId: invoice.id } })
  if (existing) return
  const paidAt = invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000) : new Date()
  await prisma.transaction.create({ data: { practiceId: practice.id, amountCents: invoice.amount_paid, method: 'CARD', concept: invoiceConcept(practice.subscriptionInterval), occurredAt: paidAt, stripeInvoiceId: invoice.id } })
}

app.get('/api/v1/billing', async (request) => {
  const practice = await prisma.practice.findUnique({ where: { id: request.practiceId } })
  return billingView(practice)
})

app.post('/api/v1/billing/checkout', async (request, reply) => {
  try {
    if (!stripe) return billingUnavailable(reply)
    const interval = request.body?.interval
    if (!SUBSCRIPTION_INTERVALS.includes(interval) || !STRIPE_PRICES[interval]) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Elige el plan mensual o el anual.', fields: { interval: true } })
    let practice = await prisma.practice.findUnique({ where: { id: request.practiceId } })
    if (LIVE_SUBSCRIPTION_STATUSES.includes(practice.subscriptionStatus)) return reply.code(409).send({ code: 'ALREADY_SUBSCRIBED', message: 'Ya tienes una suscripción. Cambia de plan o de tarjeta en «Administrar suscripción».', fields: {} })
    if (!practice.stripeCustomerId) {
      const user = await prisma.user.findUnique({ where: { id: request.userId }, select: { email: true, name: true } })
      const customer = await stripe.customers.create({ email: user?.email || undefined, name: practice.name, metadata: { practiceId: practice.id } })
      practice = await prisma.practice.update({ where: { id: practice.id }, data: { stripeCustomerId: customer.id } })
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: practice.stripeCustomerId,
      client_reference_id: practice.id,
      line_items: [{ price: STRIPE_PRICES[interval], quantity: 1 }],
      subscription_data: { metadata: { practiceId: practice.id } },
      metadata: { practiceId: practice.id },
      locale: 'es',
      allow_promotion_codes: true,
      success_url: `${APP_URL}/configuracion?suscripcion=ok`,
      cancel_url: `${APP_URL}/configuracion?suscripcion=cancelada`,
    })
    await logAudit(request, { action: 'subscription_checkout_started', entity: 'Practice', entityId: practice.id, metadata: { interval } })
    return { url: session.url }
  } catch (err) {
    if (err.type?.startsWith('Stripe')) return stripeFailed(request, reply, err)
    throw err
  }
})

// Portal de Stripe: cambiar tarjeta o plan, ver facturas y cancelar.
app.post('/api/v1/billing/portal', async (request, reply) => {
  try {
    if (!stripe) return billingUnavailable(reply)
    const practice = await prisma.practice.findUnique({ where: { id: request.practiceId } })
    if (!practice.stripeCustomerId) return reply.code(409).send({ code: 'NO_SUBSCRIPTION', message: 'Todavía no tienes una suscripción.', fields: {} })
    const session = await stripe.billingPortal.sessions.create({ customer: practice.stripeCustomerId, return_url: `${APP_URL}/configuracion?suscripcion=portal` })
    return { url: session.url }
  } catch (err) {
    if (err.type?.startsWith('Stripe')) return stripeFailed(request, reply, err)
    throw err
  }
})

// Al volver de Stripe se pide el estado directo, sin esperar el webhook (que en desarrollo local
// sólo llega si está corriendo `stripe listen`).
app.post('/api/v1/billing/sync', async (request, reply) => {
  try {
    if (!stripe) return billingUnavailable(reply)
    let practice = await prisma.practice.findUnique({ where: { id: request.practiceId } })
    if (practice.stripeCustomerId) {
      const { data } = await stripe.subscriptions.list({ customer: practice.stripeCustomerId, status: 'all', limit: 1, expand: ['data.latest_invoice'] })
      if (data[0]) practice = (await applySubscription(data[0])) || practice
    }
    return billingView(practice)
  } catch (err) {
    if (err.type?.startsWith('Stripe')) return stripeFailed(request, reply, err)
    throw err
  }
})

// Webhook: Stripe firma el cuerpo exacto, así que esta ruta lee el JSON crudo (un parser propio,
// encapsulado en este plugin para no afectar a las demás rutas).
await app.register(async (scope) => {
  scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => done(null, body))
  scope.post('/api/v1/stripe/webhook', async (request, reply) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return billingUnavailable(reply)
    let event
    try {
      event = stripe.webhooks.constructEvent(request.body, request.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
    } catch (err) {
      return reply.code(400).send({ code: 'INVALID_SIGNATURE', message: 'Firma de Stripe inválida.', fields: {} })
    }
    try {
      await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } })
    } catch (err) {
      if (err.code === 'P2002') return { received: true, duplicate: true }
      throw err
    }
    try {
      const object = event.data.object
      if (event.type === 'checkout.session.completed' && object.mode === 'subscription') {
        const practiceId = practiceIdFromMetadata(object)
        const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id
        if (practiceId && customerId) await prisma.practice.updateMany({ where: { id: practiceId, stripeCustomerId: null }, data: { stripeCustomerId: customerId } })
        const subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id
        if (subscriptionId) await applySubscription(await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] }))
      } else if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed'].includes(event.type)) {
        // Se lee el estado actual en Stripe en vez del que trae el aviso: Stripe no garantiza el orden
        // y «created» (incomplete) y «updated» (active) suelen salir en el mismo segundo, así que el
        // filtro por fecha no los distingue y el que llegaba al último dejaba el estado viejo.
        await applySubscription(await stripe.subscriptions.retrieve(object.id, { expand: ['latest_invoice'] }))
      } else if (event.type === 'invoice.paid') {
        await recordInvoicePayment(object)
      }
    } catch (err) {
      // Que Stripe lo reintente: se olvida el evento para que el reintento sí se procese.
      await prisma.stripeEvent.delete({ where: { id: event.id } }).catch(() => {})
      request.log.error({ err, event: event.id }, 'Error al procesar el webhook de Stripe')
      return reply.code(500).send({ code: 'WEBHOOK_FAILED', message: 'No se pudo procesar el aviso.', fields: {} })
    }
    return { received: true }
  })
})

app.post('/api/v1/auth/change-password', async (request, reply) => {
  const { currentPassword, newPassword } = request.body || {}
  if (!currentPassword || !newPassword || typeof currentPassword !== 'string' || typeof newPassword !== 'string') return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Contraseña actual y nueva son obligatorias.', fields: { currentPassword: !currentPassword, newPassword: !newPassword } })
  if (newPassword.length < 8) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'La nueva contraseña debe tener al menos 8 caracteres.', fields: { newPassword: true } })
  const user = await prisma.user.findUnique({ where: { id: request.userId } })
  if (!user) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Sesión inválida.', fields: {} })
  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) return reply.code(400).send({ code: 'INVALID_PASSWORD', message: 'La contraseña actual no es correcta.', fields: { currentPassword: true } })
  const passwordHash = await bcrypt.hash(newPassword, 10)
  // Cierra las demás sesiones; esta sigue con el token nuevo que se devuelve.
  const updated = await prisma.user.update({ where: { id: user.id }, data: { passwordHash, sessionVersion: { increment: 1 } } })
  sessionVersionCache.delete(user.id)
  await logAudit(request, { action: 'password_changed', entity: 'User', entityId: user.id })
  return { token: signToken(updated) }
})

const LOGO_MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

app.post('/api/v1/practice/logo', async (request, reply) => {
  const { dataUrl } = request.body || {}
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/)
  if (!match) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Sube una imagen PNG, JPG o WEBP.', fields: { dataUrl: true } })
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.byteLength > 2 * 1024 * 1024) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El logo no puede pesar más de 2 MB.', fields: { dataUrl: true } })
  const ext = LOGO_MIME_EXT[match[1]]
  const directory = path.resolve(process.env.LOGO_STORAGE_PATH || './storage/logos')
  await mkdir(directory, { recursive: true })
  const fileName = `${request.practiceId}.${ext}`
  const previous = await prisma.practice.findUnique({ where: { id: request.practiceId }, select: { logoUrl: true } })
  await writeFile(path.join(directory, fileName), buffer)
  const practice = await prisma.practice.update({ where: { id: request.practiceId }, data: { logoUrl: fileName } })
  // Si el logo anterior tenía otra extensión, su archivo quedaría huérfano.
  if (previous?.logoUrl && previous.logoUrl !== fileName) await unlink(path.join(directory, previous.logoUrl)).catch(() => {})
  return { ...practice, logoDownloadUrl: `/api/v1/practice/${request.practiceId}/logo` }
})

app.get('/api/v1/practice/:practiceId/logo', async (request, reply) => {
  const practice = await prisma.practice.findUnique({ where: { id: request.params.practiceId } })
  if (!practice?.logoUrl) return reply.code(404).send({ code: 'LOGO_NOT_FOUND', message: 'Esta práctica no tiene logo configurado.', fields: {} })
  const directory = path.resolve(process.env.LOGO_STORAGE_PATH || './storage/logos')
  const ext = practice.logoUrl.split('.').pop()
  const mime = Object.entries(LOGO_MIME_EXT).find(([, e]) => e === ext)?.[0] || 'application/octet-stream'
  try {
    const file = await readFile(path.join(directory, practice.logoUrl))
    return reply.type(mime).header('Cache-Control', 'public, max-age=300').send(file)
  } catch {
    // Archivo de logo ausente/inaccesible: 404 (antes un readFile fallido reventaba con 500).
    return reply.code(404).send({ code: 'LOGO_NOT_FOUND', message: 'No se encontró el logo.', fields: {} })
  }
})

// Public for the same reason as the logo route above: recipe cards use these directly as <img
// src>. The strict file-name pattern blocks path traversal. Files live in storage/recipes, which
// prisma/import-recetario.js fills from the ebook's embedded photos; the ones the nutritionist
// uploads herself (POST /recipes/:id/image) are named `u-<recipe id>-<stamp>.jpg`.
const recipeImageDir = () => path.resolve(process.env.RECIPE_IMAGE_STORAGE_PATH || './storage/recipes')
// La app reduce la foto antes de subirla (1600 px), así que estos topes sólo frenan lo que llegue
// por fuera de ella. Se limita el total de pixeles, no sólo cada lado: es lo que cuesta memoria a
// quien la descomprime.
const RECIPE_IMAGE_MAX_BYTES = 3 * 1024 * 1024
const RECIPE_IMAGE_MAX_SIDE = 2400
const RECIPE_IMAGE_MAX_PIXELS = 4_000_000

app.get('/api/v1/recipes/images/:fileName', async (request, reply) => {
  const { fileName } = request.params
  if (!/^[a-z0-9][a-z0-9-]*\.jpg$/.test(fileName)) return reply.code(404).send({ code: 'IMAGE_NOT_FOUND', message: 'Imagen no encontrada.', fields: {} })
  try {
    const file = await readFile(path.join(recipeImageDir(), fileName))
    return reply.type('image/jpeg').header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'public, max-age=86400').send(file)
  } catch {
    return reply.code(404).send({ code: 'IMAGE_NOT_FOUND', message: 'Imagen no encontrada.', fields: {} })
  }
})

// Sólo se borran del disco las fotos subidas a mano; las del recetario importado se conservan
// porque el importador las vuelve a vincular por nombre de archivo.
const removeUploadedRecipeImage = (imageFile) => (imageFile?.startsWith('u-') ? unlink(path.join(recipeImageDir(), imageFile)).catch(() => {}) : Promise.resolve())

// Foto de una receta. Sale en la tarjeta de la receta y en el plan de alimentación entregado. Sólo
// JPEG, comprobado con los bytes del archivo y no con el tipo declarado (ver sanitizeJpeg). El
// nombre lleva una marca de tiempo para que al cambiarla no se quede la anterior en la caché.
app.post('/api/v1/recipes/:recipeId/image', async (request, reply) => {
  const recipe = await prisma.recipe.findFirst({ where: { id: request.params.recipeId, practiceId: request.practiceId } })
  if (!recipe) return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', message: 'Receta no encontrada.', fields: {} })
  const { dataUrl } = request.body || {}
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/)
  if (!match) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Sube una imagen JPG.', fields: { dataUrl: true } })
  // Tope sobre el texto base64 antes de decodificarlo, para no reservar memoria de más.
  if (match[1].length > Math.ceil(RECIPE_IMAGE_MAX_BYTES / 3) * 4) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'La imagen no puede pesar más de 3 MB.', fields: { dataUrl: true } })
  // Lo que se guarda es la versión reescrita sin metadatos, no los bytes recibidos.
  const size = sanitizeJpeg(Buffer.from(match[1], 'base64'))
  if (!size) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El archivo no es una imagen JPG válida.', fields: { dataUrl: true } })
  if (size.width > RECIPE_IMAGE_MAX_SIDE || size.height > RECIPE_IMAGE_MAX_SIDE || size.width * size.height > RECIPE_IMAGE_MAX_PIXELS) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: `La imagen es demasiado grande: máximo ${RECIPE_IMAGE_MAX_SIDE} px por lado.`, fields: { dataUrl: true } })
  const storageKey = `u-${recipe.id}-${Date.now().toString(36)}.jpg`
  await mkdir(recipeImageDir(), { recursive: true })
  await writeFile(path.join(recipeImageDir(), storageKey), size.data)
  // La foto anterior se borra después de apuntar la receta a la nueva (como en ingredientes): antes
  // se borraba primero y, si el guardado fallaba, la receta quedaba apuntando a un archivo inexistente.
  const updated = await prisma.recipe.update({ where: { id: recipe.id }, data: { imageFile: storageKey } })
  await removeUploadedRecipeImage(recipe.imageFile)
  return updated
})

app.delete('/api/v1/recipes/:recipeId/image', async (request, reply) => {
  const recipe = await prisma.recipe.findFirst({ where: { id: request.params.recipeId, practiceId: request.practiceId } })
  if (!recipe) return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', message: 'Receta no encontrada.', fields: {} })
  await removeUploadedRecipeImage(recipe.imageFile)
  return prisma.recipe.update({ where: { id: recipe.id }, data: { imageFile: null } })
})

app.get('/api/v1/patients', async (request) => {
  const { search = '', status = 'ACTIVE', page = 1, pageSize = 25, noNext, sort } = request.query
  const currentPage = Math.max(Number(page) || 1, 1)
  // Los selectores de paciente (Agenda, Consultas, Seguimientos, Plantillas, Constructor) piden la
  // lista completa de activos; con el tope anterior de 25/100 los demás no se podían elegir. El de
  // 500 repetía el problema en consultorios con más pacientes activos (los que quedaban después
  // del 500 por apellido no aparecían en los selectores).
  const take = Math.min(Math.max(Number(pageSize) || 25, 1), 5000)
  // Cada palabra debe aparecer en algún campo: así "Laura Méndez" encuentra a la paciente aunque
  // nombre y apellidos vivan en columnas distintas (antes se buscaba la frase entera en cada una).
  const terms = String(search).trim().split(/\s+/).filter(Boolean).slice(0, 6)
  const termsWhere = terms.length ? { AND: terms.map((term) => ({ OR: [{ firstName: { contains: term, mode: 'insensitive' } }, { lastName: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }, { phone: { contains: term, mode: 'insensitive' } }] })) } : {}
  // "Sin cita próxima" (RF-04): ACTIVE patients with no upcoming, non-cancelled appointment.
  // startAt es hora de pared con "Z": se compara contra el "ahora" de la práctica (con new Date() en
  // UTC, en México una cita seguía como "próxima" hasta 6 h después de su hora).
  const practice = await prisma.practice.findUnique({ where: { id: request.practiceId }, select: { timeZone: true } })
  const now = practiceWallClockNow(practice?.timeZone)
  const noNextWhere = { appointments: { none: { startAt: { gte: now }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } } } }
  const where = {
    practiceId: request.practiceId,
    status: status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    ...termsWhere,
    ...(noNext === '1' ? noNextWhere : {}),
  }
  // La lista de Pacientes pide `summary=1`: además de la última consulta y la próxima cita trae el
  // plan vigente, el peso más reciente, si hay una consulta abierta, los documentos por entregar y
  // los conteos de cada pestaña. Los selectores de paciente de otros módulos no lo piden.
  const summary = request.query.summary === '1'
  const [rawItems, total, ...tabCounts] = await prisma.$transaction([
    prisma.patient.findMany({
      where,
      orderBy: sort === 'recent' ? [{ createdAt: 'desc' }] : sort === 'name' ? [{ firstName: 'asc' }, { lastName: 'asc' }] : [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip: (currentPage - 1) * take,
      take,
      include: {
        consultations: { orderBy: { startedAt: { sort: 'desc', nulls: 'last' } }, take: 1, select: { startedAt: true } },
        appointments: { where: { startAt: { gte: now }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } }, orderBy: { startAt: 'asc' }, take: 1, select: { startAt: true, type: true } },
        ...(summary ? {
          plans: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, version: true, targetKcal: true, publishedAt: true } },
          measurements: { where: { weightKg: { not: null } }, orderBy: { measuredAt: 'desc' }, take: 2, select: { weightKg: true, measuredAt: true } },
          _count: { select: { consultations: true, documents: { where: { generatedAt: { not: null }, deliveredAt: null, type: { in: ['nutrition_plan', 'consultation_report', 'consultation_clinical'] } } } } },
        } : {}),
      },
    }),
    prisma.patient.count({ where }),
    ...(summary ? [
      prisma.patient.count({ where: { practiceId: request.practiceId, status: 'ACTIVE', ...termsWhere } }),
      prisma.patient.count({ where: { practiceId: request.practiceId, status: 'ACTIVE', ...termsWhere, ...noNextWhere } }),
      prisma.patient.count({ where: { practiceId: request.practiceId, status: 'ARCHIVED', ...termsWhere } }),
    ] : []),
  ])
  const openConsultations = summary && rawItems.length
    ? await prisma.consultation.findMany({ where: { patientId: { in: rawItems.map((patient) => patient.id) }, status: { in: ['DRAFT', 'IN_PROGRESS'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, patientId: true } })
    : []
  // The list only ever needs "when did I last see this patient" and "what's their next
  // appointment" -- flatten both one-row relations into plain fields instead of shipping the
  // full arrays. Before this, "Próxima cita" was a hardcoded "Sin cita" placeholder.
  const items = rawItems.map(({ consultations, appointments, plans, measurements, _count, ...patient }) => ({
    ...patient,
    lastConsultationAt: consultations[0]?.startedAt || null,
    nextAppointmentAt: appointments[0]?.startAt || null,
    nextAppointmentType: appointments[0]?.type || null,
    ...(summary ? {
      currentPlan: plans[0] || null,
      lastWeightKg: measurements[0] ? Number(measurements[0].weightKg) : null,
      lastWeightAt: measurements[0]?.measuredAt || null,
      previousWeightKg: measurements[1] ? Number(measurements[1].weightKg) : null,
      consultationCount: _count.consultations,
      pendingDocuments: _count.documents,
      openConsultationId: openConsultations.find((consultation) => consultation.patientId === patient.id)?.id || null,
    } : {}),
  }))
  return { items, page: currentPage, pageSize: take, total, ...(summary ? { counts: { ACTIVE: tabCounts[0], NO_NEXT: tabCounts[1], ARCHIVED: tabCounts[2] } } : {}) }
})

const emptyToNull = (value) => (value === undefined ? undefined : value === '' ? null : value)

app.post('/api/v1/patients', async (request, reply) => {
  const { firstName, lastName, email, phone, birthDate, sex, occupation, consentDataAt, address, curp } = request.body || {}
  if (!firstName || !lastName) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Nombre y apellido son obligatorios.', fields: { firstName: !firstName, lastName: !lastName } })
  if (curp && !CURP_PATTERN.test(normalizeCurp(curp))) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'La CURP no tiene un formato válido (18 caracteres).', fields: { curp: true } })
  if (birthDate && Number.isNaN(new Date(birthDate).getTime())) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fecha de nacimiento inválida.', fields: { birthDate: true } })
  const created = await prisma.patient.create({ data: { practiceId: request.practiceId, address: emptyToNull(address ? String(address).trim().slice(0, 240) : null), curp: curp ? normalizeCurp(curp) : null, firstName, lastName, email: emptyToNull(email), phone: emptyToNull(phone), sex: sex === undefined || sex === null || sex === '' ? null : String(sex), occupation: emptyToNull(occupation), birthDate: birthDate ? new Date(birthDate) : undefined, consentDataAt: consentDataAt ? new Date(consentDataAt) : undefined } })
  const patient = await ensureRecordNumber(created)
  return reply.code(201).send(patient)
})

app.get('/api/v1/patients/:patientId', async (request, reply) => {
  const practice = await prisma.practice.findUnique({ where: { id: request.practiceId }, select: { timeZone: true } })
  const patient = await prisma.patient.findFirst({
    where: { id: request.params.patientId, practiceId: request.practiceId },
    include: { appointments: { where: { startAt: { gte: practiceWallClockNow(practice?.timeZone) }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } }, orderBy: { startAt: 'asc' }, take: 1, select: { startAt: true, type: true } } },
  })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  const { appointments, ...rest } = patient
  if (!rest.recordNumber) rest.recordNumber = (await ensureRecordNumber(rest))?.recordNumber ?? null
  return { ...rest, nextAppointmentAt: appointments[0]?.startAt || null, nextAppointmentType: appointments[0]?.type || null }
})

app.patch('/api/v1/patients/:patientId', async (request, reply) => {
  const practiceId = request.practiceId
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  const { firstName, lastName, email, phone, birthDate, sex, occupation, status, address, curp } = request.body || {}
  if (curp && !CURP_PATTERN.test(normalizeCurp(curp))) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'La CURP no tiene un formato válido (18 caracteres).', fields: { curp: true } })
  if ((firstName !== undefined && !firstName) || (lastName !== undefined && !lastName)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Nombre y apellido no pueden quedar vacíos.', fields: { firstName: firstName !== undefined && !firstName, lastName: lastName !== undefined && !lastName } })
  if (status !== undefined && !['ACTIVE', 'ARCHIVED'].includes(status)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Estado inválido.', fields: { status: true } })
  // Igual que al crear: una fecha ilegible llegaba a Prisma como Invalid Date y respondía 500.
  if (birthDate && Number.isNaN(new Date(birthDate).getTime())) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fecha de nacimiento inválida.', fields: { birthDate: true } })
  const updated = await prisma.patient.update({
    where: { id: patient.id },
    data: {
      ...(firstName !== undefined ? { firstName } : {}),
      ...(lastName !== undefined ? { lastName } : {}),
      ...(email !== undefined ? { email: emptyToNull(email) } : {}),
      ...(phone !== undefined ? { phone: emptyToNull(phone) } : {}),
      ...(birthDate !== undefined ? { birthDate: birthDate ? new Date(birthDate) : null } : {}),
      // Vacío = sin especificar (null), como al crear; antes se guardaba la cadena vacía.
      ...(sex !== undefined ? { sex: sex === null || sex === '' ? null : String(sex) } : {}),
      ...(occupation !== undefined ? { occupation: emptyToNull(occupation) } : {}),
      ...(address !== undefined ? { address: emptyToNull(address ? String(address).trim().slice(0, 240) : null) } : {}),
      ...(curp !== undefined ? { curp: curp ? normalizeCurp(curp) : null } : {}),
      ...(status !== undefined ? { status, archivedAt: status === 'ARCHIVED' ? new Date() : null } : {}),
    },
  })
  if (status !== undefined && status !== patient.status) {
    await logAudit(request, { action: status === 'ARCHIVED' ? 'archived' : 'reactivated', entity: 'Patient', entityId: patient.id, patientId: patient.id })
  } else {
    // Qué datos de identificación cambiaron (sin copiar los valores: son datos personales).
    const changedFields = ['firstName', 'lastName', 'email', 'phone', 'birthDate', 'sex', 'occupation', 'address', 'curp'].filter((key) => request.body?.[key] !== undefined && String(request.body[key] ?? '') !== String(patient[key] instanceof Date ? patient[key].toISOString().slice(0, 10) : patient[key] ?? ''))
    await logAudit(request, { action: 'updated', entity: 'Patient', entityId: patient.id, patientId: patient.id, metadata: { fields: changedFields } })
  }
  return updated
})

app.get('/api/v1/patients/:patientId/timeline', async (request, reply) => {
  const practiceId = request.practiceId
  const patientId = request.params.patientId
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  const practice = await prisma.practice.findUnique({ where: { id: practiceId }, select: { timeZone: true } })
  const [appointments, consultations, plans, documents, auditEvents] = await prisma.$transaction([
    // The timeline is activity HISTORY — exclude upcoming (not yet started) appointments so a
    // future confirmed visit doesn't render as already-done activity at the top of the drawer.
    // startAt es hora de pared: se compara contra el "ahora" de la práctica, no contra UTC.
    prisma.appointment.findMany({ where: { patientId, startAt: { lte: practiceWallClockNow(practice?.timeZone) } }, orderBy: { startAt: 'desc' }, take: 20 }),
    prisma.consultation.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.nutritionPlan.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.document.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.auditEvent.findMany({ where: { practiceId, metadata: { path: ['patientId'], equals: patientId }, action: { notIn: ACCESS_ACTIONS } }, include: { user: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ])
  const events = [
    ...appointments.map((a) => ({ kind: 'appointment', date: a.startAt, status: a.status, subtype: a.type, id: a.id })),
    ...consultations.map((c) => ({ kind: 'consultation', date: c.startedAt || c.createdAt, status: c.status, id: c.id })),
    ...plans.map((p) => ({ kind: 'plan', date: p.publishedAt || p.createdAt, status: p.status, id: p.id })),
    ...documents.map((d) => ({ kind: 'document', date: d.generatedAt || d.createdAt, status: d.deliveredAt ? 'DELIVERED' : d.generatedAt ? 'GENERATED' : 'PENDING', subtype: d.type, id: d.id })),
    ...auditEvents.map((e) => ({ kind: 'audit', date: e.createdAt, status: 'DONE', action: e.action, entity: e.entity, id: e.id, userName: e.user?.name, metadata: e.metadata })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))
  return { items: events }
})

// Registro de accesos de un paciente: quién abrió su expediente o descargó sus documentos.
app.get('/api/v1/patients/:patientId/access-log', async (request, reply) => {
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, practiceId: request.practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  const take = Math.min(Math.max(Number(request.query.pageSize) || 100, 1), 300)
  const events = await prisma.auditEvent.findMany({
    where: { practiceId: request.practiceId, action: { in: ACCESS_ACTIONS }, metadata: { path: ['patientId'], equals: patient.id } },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take,
  })
  return { items: events.map((event) => ({ id: event.id, at: event.createdAt, action: event.action, entity: event.entity, userName: event.user?.name || 'Usuario eliminado', scope: event.metadata?.scope || null, type: event.metadata?.type || null, version: event.metadata?.version ?? null, fileName: event.metadata?.fileName || null, consultationId: event.metadata?.consultationId || null, agent: event.metadata?.origin?.agent || '', ip: event.metadata?.origin?.ip || null })) }
})

app.get('/api/v1/patients/:patientId/consultations', async (request, reply) => {
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, practiceId: request.practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  const consultations = await prisma.consultation.findMany({ where: { patientId: request.params.patientId }, include: { sections: true, measurements: true, diagnoses: true, plans: true }, orderBy: { createdAt: 'desc' } })
  await logAccess(request, { patientId: patient.id, scope: 'history' })
  return { items: consultations }
})

// Datos permanentes del paciente (antecedentes familiares, cirugías, alergias…): viven fuera de
// la consulta para no tener que recapturarlos en cada visita. Ver src/lib/patientFields.js, que es
// quien decide qué campo va aquí y cuál se queda en la consulta.
app.get('/api/v1/patients/:patientId/sections', async (request, reply) => {
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, practiceId: request.practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  const sections = await prisma.patientSection.findMany({ where: { patientId: patient.id } })
  return { items: sections }
})

app.put('/api/v1/patients/:patientId/sections/:sectionKey', async (request, reply) => {
  const { payload = {}, updatedAt } = request.body || {}
  // El payload es un objeto de campos; null o una lista llegaban a Prisma (Json requerido) → 500.
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Los datos de la sección no son válidos.', fields: { payload: true } })
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, practiceId: request.practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  const where = { patientId_sectionKey: { patientId: patient.id, sectionKey: request.params.sectionKey } }
  const existing = await prisma.patientSection.findUnique({ where })
  // Mismo control optimista que en las secciones de la consulta: si otra sesión guardó por encima,
  // se avisa en vez de pisar su trabajo en silencio.
  if (existing && updatedAt && new Date(updatedAt).getTime() !== new Date(existing.lastSavedAt).getTime()) {
    return reply.code(409).send({ code: 'CONCURRENT_EDIT', message: 'Los datos del paciente cambiaron en otra sesión. Recarga antes de guardar.', fields: {} })
  }
  const section = await prisma.patientSection.upsert({
    where,
    create: { patientId: patient.id, sectionKey: request.params.sectionKey, payload, lastSavedBy: request.userId || 'system' },
    update: { payload, lastSavedBy: request.userId || 'system' },
  })
  return section
})

app.get('/api/v1/patients/:patientId/plans', async (request, reply) => {
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, practiceId: request.practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  const plans = await prisma.nutritionPlan.findMany({ where: { patientId: request.params.patientId }, include: { mealSlots: { include: { recipe: true } }, documents: true }, orderBy: [{ createdAt: 'desc' }, { version: 'desc' }] })
  return { items: plans }
})

app.post('/api/v1/patients/:patientId/consultations', async (request, reply) => {
  const { appointmentId, nutritionistId, templateId } = request.body || {}
  const practiceId = request.practiceId
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  let appointment = null
  if (appointmentId) {
    // La cita tiene que ser de ESTE paciente: antes bastaba con que fuera de la práctica, y la cita de
    // otra persona (o un bloqueo) quedaba ligada a esta consulta y marcada como atendida.
    appointment = await prisma.appointment.findFirst({ where: { id: appointmentId, practiceId, patientId: patient.id } })
    if (!appointment) return reply.code(404).send({ code: 'APPOINTMENT_NOT_FOUND', message: 'Cita no encontrada.', fields: {} })
    // appointmentId es único en Consultation: una cita que ya abrió consulta respondía con un 500.
    const linked = await prisma.consultation.findFirst({ where: { appointmentId: appointment.id }, select: { id: true } })
    if (linked) return reply.code(409).send({ code: 'APPOINTMENT_ALREADY_USED', message: 'Esta cita ya tiene una consulta registrada.', fields: {}, consultationId: linked.id })
  }
  // El profesional responsable debe ser del mismo consultorio (sin esto se podía firmar una consulta
  // a nombre de un usuario de otra práctica).
  if (nutritionistId && !(await prisma.user.findFirst({ where: { id: nutritionistId, practiceId }, select: { id: true } }))) {
    return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El profesional responsable no pertenece a este consultorio.', fields: { nutritionistId: 'invalid' } })
  }
  // nutritionistId lets one professional open a consultation on another's behalf; otherwise
  // it defaults to whoever is logged in, falling back to the oldest user in the practice.
  let userId = nutritionistId || request.userId
  if (!userId) userId = (await prisma.user.findFirst({ where: { practiceId } }))?.id
  if (!userId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'La consulta necesita un profesional responsable.', fields: { nutritionistId: 'required' } })
  // Un paciente no puede tener dos consultas en curso a la vez: si las hubiera, cada pantalla
  // elegiría una distinta y la visita quedaría partida en dos expedientes paralelos.
  const alreadyOpen = await prisma.consultation.findFirst({ where: { patientId: request.params.patientId, status: 'IN_PROGRESS' } })
  if (alreadyOpen) return reply.code(409).send({ code: 'CONSULTATION_ALREADY_OPEN', message: 'Este paciente ya tiene una consulta en curso.', fields: {}, consultationId: alreadyOpen.id })
  // Consulta y cita atendida van juntas: si la cita no se podía marcar, quedaba la consulta abierta
  // con su cita todavía vigente en la agenda.
  const [consultation] = await prisma.$transaction([
    prisma.consultation.create({ data: { patientId: request.params.patientId, appointmentId, nutritionistId: userId, templateId, status: 'IN_PROGRESS', startedAt: new Date() } }),
    ...(appointment ? [prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'COMPLETED' } })] : []),
  ])
  return reply.code(201).send(consultation)
})

app.get('/api/v1/consultations/:consultationId', async (request, reply) => {
  const consultation = await prisma.consultation.findFirst({ where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } }, include: { patient: true, appointment: true, sections: true, measurements: true, diagnoses: true, plans: true, financeEntry: { select: { amountCents: true, method: true } }, labAttachments: { orderBy: { createdAt: 'desc' }, include: { uploadedBy: { select: { name: true } } } } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  await logAccess(request, { patientId: consultation.patientId, scope: 'consultation', entity: 'Consultation', entityId: consultation.id, metadata: { consultationId: consultation.id } })
  return consultation
})

const LAB_ATTACHMENT_MIME_EXT = { 'application/pdf': 'pdf' }
const labAttachmentDir = () => path.resolve(process.env.LAB_ATTACHMENT_STORAGE_PATH || './storage/lab-attachments')

// Deliberately no automated extraction here -- reading an arbitrary lab PDF (any lab's format,
// possibly scanned) reliably needs a model that can see the document, which needs an
// ANTHROPIC_API_KEY the practice doesn't have yet. This is storage + manual transcription into
// "Estudios" (Bioquímico), not analysis -- see the note on the LabAttachment model.
app.post('/api/v1/consultations/:consultationId/lab-attachments', async (request, reply) => {
  const consultation = await prisma.consultation.findFirst({ where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  if (consultationClosed(consultation, reply)) return
  const { fileName, dataUrl } = request.body || {}
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:(application\/pdf);base64,(.+)$/)
  if (!match || !fileName) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Sube un archivo PDF.', fields: { dataUrl: true } })
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.byteLength > 10 * 1024 * 1024) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El PDF no puede pesar más de 10 MB.', fields: { dataUrl: true } })
  const attachment = await prisma.labAttachment.create({ data: { consultationId: consultation.id, fileName: String(fileName).slice(0, 240), storageKey: '', fileSize: buffer.byteLength, uploadedById: request.userId } })
  const ext = LAB_ATTACHMENT_MIME_EXT[match[1]]
  const storageKey = `${attachment.id}.${ext}`
  try {
    await mkdir(labAttachmentDir(), { recursive: true })
    await writeFile(path.join(labAttachmentDir(), storageKey), buffer)
  } catch (error) {
    // Si el archivo no se pudo escribir, el registro (sin storageKey) quedaba en la lista de adjuntos
    // como un PDF que nunca se puede abrir. Se borra y se avisa del error.
    await prisma.labAttachment.delete({ where: { id: attachment.id } }).catch(() => {})
    throw error
  }
  const updated = await prisma.labAttachment.update({ where: { id: attachment.id }, data: { storageKey }, include: { uploadedBy: { select: { name: true } } } })
  await logAudit(request, { action: 'uploaded', entity: 'LabAttachment', entityId: attachment.id, patientId: consultation.patientId, metadata: { fileName } })
  return reply.code(201).send(updated)
})

app.get('/api/v1/lab-attachments/:attachmentId/download', async (request, reply) => {
  const attachment = await prisma.labAttachment.findFirst({ where: { id: request.params.attachmentId, consultation: { patient: { practiceId: request.practiceId } } }, include: { consultation: { select: { patientId: true } } } })
  if (!attachment) return reply.code(404).send({ code: 'ATTACHMENT_NOT_FOUND', message: 'Adjunto no encontrado.', fields: {} })
  try {
    const file = await readFile(path.join(labAttachmentDir(), attachment.storageKey))
    await logAccess(request, { patientId: attachment.consultation.patientId, scope: 'lab', action: 'downloaded', entity: 'LabAttachment', entityId: attachment.id, metadata: { fileName: attachment.fileName, consultationId: attachment.consultationId } })
    return reply.type('application/pdf').header('Content-Disposition', contentDisposition('inline', safeFileName(attachment.fileName))).send(file)
  } catch {
    return reply.code(404).send({ code: 'ATTACHMENT_NOT_FOUND', message: 'El archivo del adjunto no está disponible.', fields: {} })
  }
})

app.delete('/api/v1/lab-attachments/:attachmentId', async (request, reply) => {
  const attachment = await prisma.labAttachment.findFirst({ where: { id: request.params.attachmentId, consultation: { patient: { practiceId: request.practiceId } } }, include: { consultation: true } })
  if (!attachment) return reply.code(404).send({ code: 'ATTACHMENT_NOT_FOUND', message: 'Adjunto no encontrado.', fields: {} })
  if (consultationClosed(attachment.consultation, reply)) return
  await prisma.labAttachment.delete({ where: { id: attachment.id } })
  await logAudit(request, { action: 'deleted', entity: 'LabAttachment', entityId: attachment.id, patientId: attachment.consultation.patientId, metadata: { fileName: attachment.fileName, consultationId: attachment.consultationId } })
  await unlink(path.join(labAttachmentDir(), attachment.storageKey)).catch(() => {})
  return reply.code(204).send()
})

app.post('/api/v1/consultations/:consultationId/complete', async (request, reply) => {
  const { paymentMethod, amountCents, autoClosed } = request.body || {}
  const consultation = await prisma.consultation.findFirst({
    where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } },
    include: { patient: true, appointment: true },
  })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  // Se valida antes de cerrar: el registro del ingreso es best-effort y un monto fuera de rango
  // se perdía en silencio dejando la consulta cerrada sin cobro.
  if (!autoClosed && amountCents != null && amountCents !== '' && normalizeCents(amountCents) > MAX_AMOUNT_CENTS) {
    return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El monto de la consulta es demasiado grande.', fields: { amountCents: true } })
  }
  const updated = await prisma.consultation.update({ where: { id: consultation.id }, data: { status: 'COMPLETED', completedAt: consultation.completedAt || new Date() } })
  // `autoClosed` es el cierre que hace el sistema al encontrar una sesión abierta de un día
  // anterior. No genera ingreso: nadie cobró esa consulta, y apuntarla en Finanzas inventaría
  // dinero que no entró. Queda en la auditoría para poder distinguirla de un cierre real.
  if (autoClosed) {
    await logAudit(request, { action: 'auto_closed', entity: 'Consultation', entityId: consultation.id, patientId: consultation.patientId, metadata: { startedAt: consultation.startedAt } })
    return updated
  }
  // Al cerrar la consulta queda registrado su ingreso (tarifa del tipo de cita + método de pago).
  // Best-effort: un fallo aquí no debe impedir cerrar la sesión clínica.
  await recordConsultationIncome(consultation, { paymentMethod, amountCents }).catch((error) => app.log.warn({ err: error }, 'No se pudo registrar el ingreso de la consulta'))
  return updated
})

// Reabrir una consulta cerrada para corregirla. Es deliberado y queda auditado: el expediente se
// abre en sólo lectura precisamente para que editar una visita pasada sea una decisión, no un
// descuido. No se toca el ingreso ya registrado — corregir la nota clínica no deshace el cobro.
app.post('/api/v1/consultations/:consultationId/reopen', async (request, reply) => {
  const consultation = await prisma.consultation.findFirst({ where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  const open = await prisma.consultation.findFirst({ where: { patientId: consultation.patientId, status: 'IN_PROGRESS' } })
  if (open && open.id !== consultation.id) return reply.code(409).send({ code: 'CONSULTATION_ALREADY_OPEN', message: 'Este paciente ya tiene una consulta en curso. Ciérrala antes de reabrir otra.', fields: {} })
  // El motivo es obligatorio: queda en la bitácora y en el PDF del expediente como nota aclaratoria.
  const reason = String(request.body?.reason || '').trim().slice(0, 500)
  if (consultation.status === 'COMPLETED' && reason.length < 5) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Escribe el motivo de la corrección (al menos 5 caracteres).', fields: { reason: true } })
  const updated = await prisma.consultation.update({ where: { id: consultation.id }, data: { status: 'IN_PROGRESS' } })
  await logAudit(request, { action: 'reopened', entity: 'Consultation', entityId: consultation.id, patientId: consultation.patientId, metadata: { reason, consultationId: consultation.id } })
  return updated
})

app.put('/api/v1/consultations/:consultationId/sections/:sectionKey', async (request, reply) => {
  const { payload = {}, completionState = 'in_progress', updatedAt } = request.body || {}
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Los datos de la sección no son válidos.', fields: { payload: true } })
  const consultation = await prisma.consultation.findFirst({ where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  if (consultationClosed(consultation, reply)) return
  const existing = await prisma.clinicalSection.findUnique({ where: { consultationId_sectionKey: { consultationId: consultation.id, sectionKey: request.params.sectionKey } } })
  if (existing && updatedAt && new Date(updatedAt).getTime() !== new Date(existing.lastSavedAt).getTime()) return reply.code(409).send({ code: 'CONCURRENT_EDIT', message: 'La sección cambió en otra sesión. Recarga antes de guardar.', fields: {} })
  const section = await prisma.clinicalSection.upsert({ where: { consultationId_sectionKey: { consultationId: consultation.id, sectionKey: request.params.sectionKey } }, create: { consultationId: consultation.id, sectionKey: request.params.sectionKey, payload, completionState, lastSavedBy: request.userId || 'system' }, update: { payload, completionState, lastSavedBy: request.userId || 'system' } })
  // Registro de ediciones del expediente: sólo cuando el contenido cambió de verdad (el autosave
  // dispara cada 800 ms; sin esta comparación el historial se llenaría de eventos idénticos).
  const changed = !existing || JSON.stringify(existing.payload || {}) !== JSON.stringify(payload || {})
  // Una consulta que ya se había cerrado (completedAt) y se reabrió: se guarda lo que decía antes del
  // cambio, para poder reconstruir la versión original (registro de auditoría, NOM-024-SSA3-2012 3.42).
  const afterClose = Boolean(consultation.completedAt)
  if (changed) await logAudit(request, { action: existing ? 'updated' : 'created', entity: 'ClinicalSection', entityId: section.id, patientId: consultation.patientId, metadata: { consultationId: consultation.id, ...(afterClose ? { afterClose: true, previous: existing?.payload ?? null } : {}), sectionKey: request.params.sectionKey, fields: Object.keys(payload || {}).length } })
  return section
})

// The anthropometric ClinicalSection payload is free-form (whatever labels the form on
// screen happens to use) so the record report and the PDF instead read structured
// Measurement rows — this is the only way to create one; nothing wrote it before.
// Registering twice on the same day is a CORRECTION, not a new data point (it would show as two
// stacked points on the evolution chart), so a second register for the same consultation within
// the same day (practice calendar) updates the existing row instead of inserting a duplicate.
app.post('/api/v1/consultations/:consultationId/measurements', async (request, reply) => {
  const consultation = await prisma.consultation.findFirst({ where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  if (consultationClosed(consultation, reply)) return
  const { measuredAt, method, notes } = request.body || {}
  const at = measuredAt ? new Date(measuredAt) : new Date()
  if (Number.isNaN(at.getTime())) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fecha de medición inválida.', fields: { measuredAt: true } })
  // Cada medida: vacía = null (así una corrección que borra la cintura la borra de verdad; antes el
  // undefined dejaba el valor viejo), y si viene debe ser un número positivo dentro de la columna
  // (Decimal(6,2) / Decimal(5,2) para el %): texto, negativos o desbordes llegaban a Prisma → 500.
  const MEASURE_LIMITS = { weightKg: 9999, heightCm: 9999, waistCm: 9999, hipCm: 9999, abdomenCm: 9999, bodyFatPercent: 100, muscleMassKg: 9999 }
  const measures = {}
  for (const [key, max] of Object.entries(MEASURE_LIMITS)) {
    const raw = request.body?.[key]
    if (raw === undefined || raw === null || raw === '') { measures[key] = null; continue }
    const number = Number(raw)
    if (!Number.isFinite(number) || number <= 0 || number > max) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Revisa las medidas: deben ser números positivos dentro de un rango posible.', fields: { [key]: true } })
    measures[key] = number
  }
  const values = { patientId: consultation.patientId, consultationId: consultation.id, measuredAt: at, ...measures, method, notes }
  const [latest] = await prisma.measurement.findMany({ where: { consultationId: consultation.id }, orderBy: { measuredAt: 'desc' }, take: 1 })
  // "Mismo día" en el calendario del consultorio, no en UTC: en México (UTC-6) una medición de las
  // 17:45 y su corrección de las 18:15 caían en días UTC distintos y quedaban dos puntos en la gráfica.
  const practice = await prisma.practice.findUnique({ where: { id: request.practiceId }, select: { timeZone: true } })
  const practiceDay = (date) => { try { return new Date(date).toLocaleDateString('en-CA', { timeZone: practice?.timeZone || 'America/Mexico_City' }) } catch { return new Date(date).toISOString().slice(0, 10) } }
  if (latest && practiceDay(latest.measuredAt) === practiceDay(at)) {
    const measurement = await prisma.measurement.update({ where: { id: latest.id }, data: values })
    await logAudit(request, { action: 'updated', entity: 'Measurement', entityId: measurement.id, patientId: consultation.patientId, metadata: { corrected: true } })
    return measurement
  }
  const measurement = await prisma.measurement.create({ data: values })
  await logAudit(request, { action: 'created', entity: 'Measurement', entityId: measurement.id, patientId: consultation.patientId })
  return reply.code(201).send(measurement)
})

app.post('/api/v1/consultations/:consultationId/diagnoses', async (request, reply) => {
  const consultation = await prisma.consultation.findFirst({ where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  if (consultationClosed(consultation, reply)) return
  const { domain, code, problem, etiology, evidence } = request.body || {}
  if (!domain || !problem) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Dominio y problema son obligatorios.', fields: { domain: !domain, problem: !problem } })
  const diagnosis = await prisma.diagnosis.create({ data: { consultationId: consultation.id, domain, code: code || null, problem, etiology: etiology || null, evidence: evidence || null } })
  await logAudit(request, { action: 'created', entity: 'Diagnosis', entityId: diagnosis.id, patientId: consultation.patientId, metadata: { domain, problem } })
  return reply.code(201).send(diagnosis)
})

app.patch('/api/v1/consultations/:consultationId/diagnoses/:diagnosisId', async (request, reply) => {
  const consultation = await prisma.consultation.findFirst({ where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  if (consultationClosed(consultation, reply)) return
  const diagnosis = await prisma.diagnosis.findFirst({ where: { id: request.params.diagnosisId, consultationId: consultation.id } })
  if (!diagnosis) return reply.code(404).send({ code: 'DIAGNOSIS_NOT_FOUND', message: 'Diagnóstico no encontrado.', fields: {} })
  const { domain, code, problem, etiology, evidence } = request.body || {}
  if (problem !== undefined && !problem) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El problema no puede quedar vacío.', fields: { problem: true } })
  const updated = await prisma.diagnosis.update({
    where: { id: diagnosis.id },
    data: {
      ...(domain !== undefined ? { domain } : {}),
      ...(code !== undefined ? { code: code || null } : {}),
      ...(problem !== undefined ? { problem } : {}),
      ...(etiology !== undefined ? { etiology } : {}),
      ...(evidence !== undefined ? { evidence } : {}),
    },
  })
  await logAudit(request, { action: 'updated', entity: 'Diagnosis', entityId: diagnosis.id, patientId: consultation.patientId, metadata: { domain: diagnosis.domain, problem: updated.problem } })
  return updated
})

app.delete('/api/v1/consultations/:consultationId/diagnoses/:diagnosisId', async (request, reply) => {
  const consultation = await prisma.consultation.findFirst({ where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  if (consultationClosed(consultation, reply)) return
  const diagnosis = await prisma.diagnosis.findFirst({ where: { id: request.params.diagnosisId, consultationId: consultation.id } })
  if (!diagnosis) return reply.code(404).send({ code: 'DIAGNOSIS_NOT_FOUND', message: 'Diagnóstico no encontrado.', fields: {} })
  await prisma.diagnosis.delete({ where: { id: diagnosis.id } })
  await logAudit(request, { action: 'deleted', entity: 'Diagnosis', entityId: diagnosis.id, patientId: consultation.patientId, metadata: { domain: diagnosis.domain, problem: diagnosis.problem } })
  return reply.code(204).send()
})

app.get('/api/v1/appointments', async (request, reply) => {
  const { from, to } = request.query
  // Sin rango válido, `new Date(undefined)` llegaba a Prisma como Invalid Date → 500.
  if (Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Rango de fechas inválido.', fields: { from: 'invalid', to: 'invalid' } })
  const appointments = await prisma.appointment.findMany({ where: { practiceId: request.practiceId, startAt: { gte: new Date(from), lte: new Date(to) }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } }, include: { patient: true }, orderBy: { startAt: 'asc' } })
  return { items: appointments }
})

app.post('/api/v1/appointments', async (request, reply) => {
  const { patientId, startAt, endAt, type = 'FOLLOW_UP', durationMinutes, notifyVia = [], internalNote, patientNote, timeZone = 'America/Mexico_City', recurrence } = request.body || {}
  const start = new Date(startAt)
  const baseEnd = endAt ? new Date(endAt) : new Date(start.getTime() + Number(durationMinutes || 60) * 60000)
  const isBlock = type === 'BLOCK'
  // A BLOCK (availability event) needs no patient; every other appointment type does.
  if ((!isBlock && !patientId) || Number.isNaN(start.getTime()) || Number.isNaN(baseEnd.getTime()) || baseEnd <= start) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: isBlock ? 'Fecha y duración válida son obligatorias.' : 'Paciente, fecha y duración válida son obligatorios.', fields: {} })
  // Un tipo fuera del enum llegaba a Prisma y respondía 500.
  if (!isBlock && !APPOINTMENT_TYPES.includes(type)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Tipo de cita inválido.', fields: { type: 'invalid' } })
  if (!Array.isArray(notifyVia)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Canales de notificación inválidos.', fields: { notifyVia: 'invalid' } })
  const practiceId = request.practiceId
  // El paciente tiene que ser de esta práctica: antes se aceptaba cualquier id y la respuesta
  // (include: patient) devolvía los datos de un paciente de otro consultorio.
  if (!isBlock) {
    const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId }, select: { id: true } })
    if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: { patientId: 'not_found' } })
  }

  // Optional recurrence (RF-03: "Permitir repetir una cita"): the whole series is created up
  // front, one appointment per occurrence, each carrying a readable recurrenceRule that
  // describes the series it belongs to. Without a recurrence, behaves exactly as before.
  let occurrences = [{ start, end: baseEnd }]
  let ruleString = null
  if (recurrence && recurrence.frequency) {
    const freq = recurrence.frequency
    if (!['DAILY', 'WEEKLY'].includes(freq)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Frecuencia no soportada.', fields: { recurrence: 'invalid' } })
    const every = Math.max(1, Number(recurrence.every) || 1)
    const stepMs = (freq === 'DAILY' ? 1 : 7) * every * 86400000
    const until = recurrence.until ? new Date(`${recurrence.until}T23:59:59.999Z`) : null
    if (until && Number.isNaN(until.getTime())) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fecha de fin inválida.', fields: { recurrence: 'invalid' } })
    const count = until ? null : Math.min(30, Math.max(1, Number(recurrence.count) || 10))
    const durationMs = baseEnd.getTime() - start.getTime()
    occurrences = []
    for (let i = 0; ; i++) {
      if (i > 100) break // hard safety cap on a runaway series
      const s = new Date(start.getTime() + i * stepMs)
      if (until ? s > until : i >= (count || 0)) break
      occurrences.push({ start: s, end: new Date(s.getTime() + durationMs) })
    }
    const ruleParts = [`FREQ=${freq}`, `INTERVAL=${every}`]
    ruleParts.push(until ? `UNTIL=${recurrence.until}` : `COUNT=${occurrences.length}`)
    ruleString = ruleParts.join(';')
  }

  // Overlap check across the whole series first, all-or-nothing: if any repeated slot collides
  // with an existing appointment, the entire creation is rejected instead of leaving a partial
  // series the professional has to hunt down slot by slot.
  const overlaps = await prisma.appointment.findMany({ where: { practiceId, status: { notIn: ['CANCELLED', 'NO_SHOW'] }, OR: occurrences.map((o) => ({ startAt: { lt: o.end }, endAt: { gt: o.start } })) } })
  if (overlaps.length) return reply.code(409).send({ code: 'APPOINTMENT_OVERLAP', message: 'Alguno de los horarios ya está ocupado.', fields: {} })

  const created = []
  // A BLOCK never carries a patient; the frontend sends an empty string for the hidden patient
  // field, which Prisma would try to insert as a UUID and blow up the FK constraint.
  const blockPatientId = isBlock ? null : (patientId || null)
  for (const o of occurrences) {
    const appointment = await prisma.appointment.create({ data: { practiceId, patientId: blockPatientId, startAt: o.start, endAt: o.end, type, status: notifyVia.length ? 'PENDING_CONFIRMATION' : 'SCHEDULED', notifyVia, internalNote, patientNote, timeZone, recurrenceRule: ruleString }, include: { patient: true } })
    created.push(appointment)
  }
  return reply.code(201).send(occurrences.length === 1 ? created[0] : { items: created, recurrence: ruleString })
})

app.post('/api/v1/appointments/:appointmentId/confirm', async (request, reply) => {
  const appointment = await prisma.appointment.findFirst({ where: { id: request.params.appointmentId, practiceId: request.practiceId } })
  if (!appointment) return reply.code(404).send({ code: 'APPOINTMENT_NOT_FOUND', message: 'Cita no encontrada.', fields: {} })
  // Sólo se confirma una cita vigente: confirmar una cancelada o con inasistencia (p. ej. desde otra
  // pestaña con la agenda vieja) la revivía sin revisar empalmes, y una atendida perdía su estado.
  if (appointment.type === 'BLOCK' || !['PENDING_CONFIRMATION', 'SCHEDULED', 'CONFIRMED'].includes(appointment.status)) return reply.code(409).send({ code: 'APPOINTMENT_NOT_CONFIRMABLE', message: 'Esta cita ya no se puede confirmar.', fields: {} })
  return prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'CONFIRMED' }, include: { patient: true } })
})

// Normally an appointment is marked completed as a side effect of creating the consultation
// it started (see POST /patients/:patientId/consultations) -- but if the patient already had
// an IN_PROGRESS consultation open (e.g. two same-day appointments), ClinicalRecordPage reuses
// it instead of creating a new one, and the appointmentId never reaches that route. This gives
// it a way to mark the originating appointment completed on its own in that case.
app.post('/api/v1/appointments/:appointmentId/complete', async (request, reply) => {
  const appointment = await prisma.appointment.findFirst({ where: { id: request.params.appointmentId, practiceId: request.practiceId } })
  if (!appointment) return reply.code(404).send({ code: 'APPOINTMENT_NOT_FOUND', message: 'Cita no encontrada.', fields: {} })
  return prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'COMPLETED' }, include: { patient: true } })
})

// Cancelar una cita (o quitar un bloqueo) y marcar que el paciente no asistió. Las dos liberan el
// horario: el listado y la revisión de empalmes ya excluyen CANCELLED y NO_SHOW. Una cita atendida
// no se cancela (su consulta e ingreso ya existen).
for (const [route, status, action] of [['cancel', 'CANCELLED', 'cancelled'], ['no-show', 'NO_SHOW', 'no_show']]) {
  app.post(`/api/v1/appointments/:appointmentId/${route}`, async (request, reply) => {
    const appointment = await prisma.appointment.findFirst({ where: { id: request.params.appointmentId, practiceId: request.practiceId } })
    if (!appointment) return reply.code(404).send({ code: 'APPOINTMENT_NOT_FOUND', message: 'Cita no encontrada.', fields: {} })
    if (appointment.status === 'COMPLETED') return reply.code(409).send({ code: 'APPOINTMENT_COMPLETED', message: 'La cita ya se atendió; no se puede cambiar.', fields: {} })
    // startAt es la hora de pared de la práctica etiquetada con "Z": se compara contra "ahora" en esa
    // misma convención (con new Date() en UTC, en México se podía marcar la inasistencia horas antes).
    const practice = status === 'NO_SHOW' ? await prisma.practice.findUnique({ where: { id: request.practiceId }, select: { timeZone: true } }) : null
    if (status === 'NO_SHOW' && (appointment.type === 'BLOCK' || appointment.startAt > practiceWallClockNow(practice?.timeZone))) return reply.code(409).send({ code: 'APPOINTMENT_NOT_STARTED', message: 'Sólo se marca inasistencia en una cita cuya hora ya pasó.', fields: {} })
    const updated = await prisma.appointment.update({ where: { id: appointment.id }, data: { status }, include: { patient: true } })
    await logAudit(request, { action, entity: 'Appointment', entityId: appointment.id, patientId: appointment.patientId })
    return updated
  })
}

// Move a cita (drag & drop in Agenda): change its startAt/endAt keeping the existing duration
// unless one is provided. Validates the target slot against overlaps like creation does.
app.patch('/api/v1/appointments/:appointmentId', async (request, reply) => {
  const { startAt, endAt, durationMinutes } = request.body || {}
  if (!startAt) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'startAt es obligatorio.', fields: { startAt: 'required' } })
  const practiceId = request.practiceId
  const appointment = await prisma.appointment.findFirst({ where: { id: request.params.appointmentId, practiceId } })
  if (!appointment) return reply.code(404).send({ code: 'APPOINTMENT_NOT_FOUND', message: 'Cita no encontrada.', fields: {} })
  // Una cita atendida, cancelada o con inasistencia ya es historia: moverla cambiaba la fecha de una
  // consulta que ya ocurrió (o reubicaba una cita que ya no ocupa la agenda).
  if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(appointment.status)) return reply.code(409).send({ code: 'APPOINTMENT_NOT_MOVABLE', message: appointment.status === 'COMPLETED' ? 'La cita ya se atendió; no se puede mover.' : 'Esta cita ya no está vigente; no se puede mover.', fields: {} })
  const start = new Date(startAt)
  const duration = durationMinutes != null ? Number(durationMinutes) : Math.max(15, Math.round((appointment.endAt - appointment.startAt) / 60000))
  const end = endAt ? new Date(endAt) : new Date(start.getTime() + duration * 60000)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fecha y duración válidas son obligatorias.', fields: {} })
  const overlap = await prisma.appointment.findFirst({ where: { practiceId, id: { not: appointment.id }, status: { notIn: ['CANCELLED', 'NO_SHOW'] }, startAt: { lt: end }, endAt: { gt: start } } })
  if (overlap) return reply.code(409).send({ code: 'APPOINTMENT_OVERLAP', message: 'Ese horario ya está ocupado.', fields: {} })
  return prisma.appointment.update({ where: { id: appointment.id }, data: { startAt: start, endAt: end }, include: { patient: true } })
})

app.get('/api/v1/tasks', async (request) => {
  const { status, type } = request.query
  const tasks = await prisma.task.findMany({
    where: {
      practiceId: request.practiceId,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    },
    include: { patient: true },
    orderBy: { dueAt: 'asc' },
  })
  return { items: tasks }
})

app.post('/api/v1/tasks', async (request, reply) => {
  const { patientId, type, dueAt, referenceId } = request.body || {}
  if (!patientId || !type || !dueAt) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Paciente, tipo y fecha límite son obligatorios.', fields: { patientId: !patientId, type: !type, dueAt: !dueAt } })
  const practiceId = request.practiceId
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: { patientId: 'not_found' } })
  // Una fecha límite mal formada llegaba a Prisma como Invalid Date → 500.
  if (Number.isNaN(new Date(dueAt).getTime())) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fecha límite inválida.', fields: { dueAt: 'invalid' } })
  const task = await prisma.task.create({ data: { practiceId, patientId, type, dueAt: new Date(dueAt), referenceId }, include: { patient: true } })
  return reply.code(201).send(task)
})

app.post('/api/v1/tasks/:taskId/complete', async (request, reply) => {
  const practiceId = request.practiceId
  const task = await prisma.task.findFirst({ where: { id: request.params.taskId, practiceId } })
  if (!task) return reply.code(404).send({ code: 'TASK_NOT_FOUND', message: 'Seguimiento no encontrado.', fields: {} })
  if (task.status === 'completed') return reply.code(409).send({ code: 'TASK_ALREADY_COMPLETED', message: 'Este seguimiento ya se marcó como entregado.', fields: {} })
  return prisma.task.update({ where: { id: task.id }, data: { status: 'completed', completedAt: new Date() }, include: { patient: true } })
})

// Sugerencias de redacción de los campos con chips (SuggestionChips). Son de la práctica, no del
// paciente: se comparten entre todas sus consultas y dispositivos, por eso viven en el servidor.
app.get('/api/v1/suggestions', async (request) => {
  const { fieldKey } = request.query
  const items = await prisma.suggestionChip.findMany({
    where: { practiceId: request.practiceId, ...(fieldKey ? { fieldKey } : {}) },
    orderBy: { createdAt: 'asc' },
  })
  return { items }
})

app.post('/api/v1/suggestions', async (request, reply) => {
  const { fieldKey, label, text } = request.body || {}
  if (!fieldKey || !label || !text) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Campo, etiqueta y descripción son obligatorios.', fields: { fieldKey: !fieldKey, label: !label, text: !text } })
  const chip = await prisma.suggestionChip.upsert({
    where: { practiceId_fieldKey_label: { practiceId: request.practiceId, fieldKey, label } },
    create: { practiceId: request.practiceId, fieldKey, label, text },
    update: { text },
  })
  return reply.code(201).send(chip)
})

app.delete('/api/v1/suggestions/:suggestionId', async (request, reply) => {
  const chip = await prisma.suggestionChip.findFirst({ where: { id: request.params.suggestionId, practiceId: request.practiceId } })
  if (!chip) return reply.code(404).send({ code: 'SUGGESTION_NOT_FOUND', message: 'Sugerencia no encontrada.', fields: {} })
  await prisma.suggestionChip.delete({ where: { id: chip.id } })
  return reply.code(204).send()
})

app.get('/api/v1/templates', async (request) => {
  const { type } = request.query
  const templates = await prisma.template.findMany({
    where: { practiceId: request.practiceId, status: 'ACTIVE', ...(type ? { type } : {}) },
    orderBy: { updatedAt: 'desc' },
  })
  return { items: templates }
})

// Campos del plan que viajan en una plantilla de plan (ver POST /templates).
const PLAN_TEMPLATE_FIELDS = ['equivalents', 'menus', 'activeMeals', 'mealTimes', 'mealLabels', 'mealNotes', 'recipeAdjustments', 'hydrationNote', 'recommendations']

app.post('/api/v1/templates', async (request, reply) => {
  const { type, description, sourceConsultationId, sourcePlanId } = request.body || {}
  // Mismo criterio que al editar (PATCH): un nombre sólo de espacios no es un nombre.
  const name = String(request.body?.name ?? '').trim()
  if (!name || !type) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Nombre y tipo son obligatorios.', fields: { name: !name, type: !type } })
  if (!['clinical', 'plan'].includes(type)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Tipo de plantilla no soportado.', fields: { type: 'invalid' } })

  let sections = null
  let mealSlots = null
  if (type === 'clinical') {
    if (!sourceConsultationId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Selecciona una consulta de origen.', fields: { sourceConsultationId: 'required' } })
    const consultation = await prisma.consultation.findFirst({ where: { id: sourceConsultationId, patient: { practiceId: request.practiceId } }, include: { sections: true } })
    if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta de origen no encontrada.', fields: {} })
    sections = Object.fromEntries(consultation.sections.map((section) => [section.sectionKey, section.payload]))
  } else {
    if (!sourcePlanId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Selecciona un plan de origen.', fields: { sourcePlanId: 'required' } })
    const plan = await prisma.nutritionPlan.findFirst({ where: { id: sourcePlanId, patient: { practiceId: request.practiceId } }, include: { mealSlots: true } })
    if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan de origen no encontrado.', fields: {} })
    mealSlots = plan.mealSlots.map((slot) => ({ dayOfWeek: slot.dayOfWeek, mealType: slot.mealType, recipeId: slot.recipeId, servings: slot.servings }))
    // Además de la semana, la plantilla de plan guarda cómo se armó: porciones, menús, tiempos,
    // horas, ajustes de receta e indicaciones. No guarda nada de la paciente (peso, requerimiento).
    sections = { planSettings: Object.fromEntries(PLAN_TEMPLATE_FIELDS.map((field) => [field, plan[field] ?? null])) }
  }

  const template = await prisma.template.create({ data: { practiceId: request.practiceId, type, name, description: description ? String(description).trim() || null : null, sections, mealSlots } })
  return reply.code(201).send(template)
})

// Editing a template only touches its name/description metadata. The sections/mealSlots it holds
// are snapshots taken at creation time (see POST above) -- they're intentionally not editable
// in place; a professional who wants a different clinical/plan shape creates a new template.
app.patch('/api/v1/templates/:templateId', async (request, reply) => {
  const { name, description } = request.body || {}
  const template = await prisma.template.findFirst({ where: { id: request.params.templateId, practiceId: request.practiceId } })
  if (!template) return reply.code(404).send({ code: 'TEMPLATE_NOT_FOUND', message: 'Plantilla no encontrada.', fields: {} })
  if (name !== undefined && !String(name).trim()) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El nombre no puede quedar vacío.', fields: { name: 'invalid' } })
  const updated = await prisma.template.update({
    where: { id: template.id },
    data: { ...(name !== undefined ? { name: String(name).trim() } : {}), ...(description !== undefined ? { description: String(description).trim() || null } : {}) },
  })
  return updated
})

app.delete('/api/v1/templates/:templateId', async (request, reply) => {
  const template = await prisma.template.findFirst({ where: { id: request.params.templateId, practiceId: request.practiceId } })
  if (!template) return reply.code(404).send({ code: 'TEMPLATE_NOT_FOUND', message: 'Plantilla no encontrada.', fields: {} })
  await prisma.template.delete({ where: { id: template.id } })
  return reply.code(204).send()
})

// Applying a template is a one-time copy, not a live link: a 'clinical' template seeds a new
// (or the patient's in-progress) consultation's sections, a 'plan' template seeds a draft
// plan's mealSlots. Editing the template afterward never reaches back into what was created.
app.post('/api/v1/templates/:templateId/apply', async (request, reply) => {
  const { patientId } = request.body || {}
  if (!patientId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'patientId es obligatorio.', fields: { patientId: 'required' } })
  const template = await prisma.template.findFirst({ where: { id: request.params.templateId, practiceId: request.practiceId } })
  if (!template) return reply.code(404).send({ code: 'TEMPLATE_NOT_FOUND', message: 'Plantilla no encontrada.', fields: {} })
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId: request.practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })

  // El contador sube sólo cuando la plantilla se aplicó de verdad (antes se incrementaba antes de
  // copiar nada, y un fallo a medio camino la dejaba contada como usada).
  const countUse = () => prisma.template.update({ where: { id: template.id }, data: { usageCount: { increment: 1 } } })

  if (template.type === 'clinical') {
    let consultation = await prisma.consultation.findFirst({ where: { patientId, status: 'IN_PROGRESS' }, include: { sections: true } })
    if (!consultation) consultation = await prisma.consultation.create({ data: { patientId, nutritionistId: request.userId, templateId: template.id, status: 'IN_PROGRESS', startedAt: new Date() }, include: { sections: true } })
    // Sólo se precargan las secciones vacías: antes el upsert pisaba lo ya capturado en la consulta en
    // curso (también en una consulta cerrada y reabierta, sin dejar la versión anterior en la bitácora).
    const filled = new Set(consultation.sections.filter((section) => hasSectionContent(section.payload)).map((section) => section.sectionKey))
    const sections = Object.entries(template.sections || {}).filter(([sectionKey]) => !filled.has(sectionKey))
    await prisma.$transaction([
      ...sections.map(([sectionKey, payload]) =>
        prisma.clinicalSection.upsert({ where: { consultationId_sectionKey: { consultationId: consultation.id, sectionKey } }, create: { consultationId: consultation.id, sectionKey, payload, lastSavedBy: request.userId }, update: { payload, lastSavedBy: request.userId } })
      ),
      countUse(),
    ])
    return { type: 'clinical', consultationId: consultation.id, patientId, skippedSections: [...filled].filter((key) => key in (template.sections || {})) }
  }

  let consultation = await prisma.consultation.findFirst({ where: { patientId }, orderBy: { createdAt: 'desc' } })
  if (!consultation) consultation = await prisma.consultation.create({ data: { patientId, nutritionistId: request.userId, status: 'IN_PROGRESS', startedAt: new Date() } })
  // Sólo un plan que se puede seguir editando: antes "no publicado" incluía cancelados y reemplazados.
  let plan = await prisma.nutritionPlan.findFirst({ where: { patientId, status: { in: ['DRAFT', 'READY'] } }, orderBy: { createdAt: 'desc' } })
  if (!plan) {
    const latest = await prisma.nutritionPlan.aggregate({ where: { patientId }, _max: { version: true } })
    plan = await prisma.nutritionPlan.create({ data: { patientId, consultationId: consultation.id, version: (latest._max.version || 0) + 1 } })
  }
  const settings = template.sections?.planSettings
  const data = {}
  if (settings && typeof settings === 'object') {
    for (const field of PLAN_TEMPLATE_FIELDS) if (settings[field] != null) data[field] = settings[field]
  }
  // Normaliza igual que la distribución (valida día/tiempo y deduplica por día+tiempo): una
  // plantilla con slots crudos duplicados violaría @@unique([planId, dayOfWeek, mealType]) → 500.
  const slots = normalizeMealSlots(template.mealSlots)
  // The template's mealSlots are a snapshot of recipeId taken at creation time (see POST above) --
  // if any of those recipes no longer exist in this practice (same defensive check as
  // PUT /plans/:planId/distribution), inserting them as-is would violate the FK and 500. Drop the
  // dangling ones instead of failing the whole apply.
  const recipeIds = [...new Set(slots.map((slot) => slot.recipeId).filter(Boolean))]
  const validRecipes = recipeIds.length ? await prisma.recipe.findMany({ where: { id: { in: recipeIds }, practiceId: request.practiceId }, select: { id: true } }) : []
  const validRecipeIds = new Set(validRecipes.map((item) => item.id))
  // Ajustes, semana y contador en una sola transacción: antes un fallo al copiar la semana dejaba el
  // plan con los ajustes de la plantilla pero con su semana anterior.
  await prisma.$transaction([
    ...(Object.keys(data).length ? [prisma.nutritionPlan.update({ where: { id: plan.id }, data })] : []),
    prisma.mealSlot.deleteMany({ where: { planId: plan.id } }),
    prisma.mealSlot.createMany({ data: slots.map((slot) => ({ planId: plan.id, dayOfWeek: slot.dayOfWeek, mealType: slot.mealType, recipeId: validRecipeIds.has(slot.recipeId) ? slot.recipeId : null, servings: slot.servings })) }),
    countUse(),
  ])
  return { type: 'plan', planId: plan.id, patientId }
})

// Búsqueda por nombre sin distinguir acentos: `mode: 'insensitive'` de Postgres sólo ignora
// mayúsculas, así que "platano" no encontraba "Plátano". Sin la extensión unaccent, se pliegan los
// nombres aquí (catálogos de unos pocos miles de filas) y se filtra por los ids que coinciden.
async function nameSearchWhere(delegate, where, search) {
  const term = foldText(String(search).slice(0, 80)).trim()
  if (!term) return where
  const rows = await delegate.findMany({ where, select: { id: true, name: true } })
  return { ...where, id: { in: rows.filter((row) => foldText(row.name).includes(term)).map((row) => row.id) } }
}

// Campos de receta que llegan del cliente y que, con un tipo equivocado, reventaban en Prisma con
// 500 (porciones "abc", minutos con decimales, un estado inexistente) o guardaban basura (porciones
// en 0 o negativas). Devuelve los campos inválidos; vacío si todo sirve.
const RECIPE_STATUSES = ['ACTIVE', 'ARCHIVED']
const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')
function invalidRecipeFields({ name, mealTypes, portions, restrictions, timeMinutes, status }) {
  const fields = {}
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) fields.name = true
  if (mealTypes !== undefined && (!isStringList(mealTypes) || !mealTypes.length)) fields.mealTypes = true
  if (restrictions !== undefined && !isStringList(restrictions)) fields.restrictions = true
  if (portions !== undefined && portions !== null && !(Number(portions) > 0 && Number(portions) < 1000)) fields.portions = true
  if (timeMinutes !== undefined && timeMinutes !== null && !(Number.isInteger(Number(timeMinutes)) && Number(timeMinutes) >= 0 && Number(timeMinutes) <= 10000)) fields.timeMinutes = true
  if (status !== undefined && !RECIPE_STATUSES.includes(status)) fields.status = true
  return fields
}

app.get('/api/v1/recipes', async (request) => {
  const { search = '', mealType, restriction, status = 'ACTIVE', page, pageSize } = request.query
  const where = await nameSearchWhere(prisma.recipe, {
    practiceId: request.practiceId,
    status: status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    ...(mealType ? { mealTypes: { has: String(mealType) } } : {}),
    ...(restriction ? { restrictions: { has: String(restriction) } } : {}),
  }, search)
  // Pagination is opt-in: the plan builder fetches the whole catalog (no params), while the
  // recipes library passes page/pageSize and gets a `total` back for the pager.
  if (page !== undefined || pageSize !== undefined) {
    const currentPage = Math.max(Number(page) || 1, 1)
    const take = Math.min(Math.max(Number(pageSize) || 24, 1), 200)
    const [items, total] = await prisma.$transaction([
      prisma.recipe.findMany({ where, include: { ingredients: { include: { ingredient: true } } }, orderBy: { name: 'asc' }, skip: (currentPage - 1) * take, take }),
      prisma.recipe.count({ where }),
    ])
    return { items, total, page: currentPage, pageSize: take }
  }
  // Sin tope: el Constructor descarta de la semana las recetas que no vienen aquí (las toma por
  // archivadas), así que el `take: 1000` de antes borraba al guardar las asignaciones de las recetas
  // que quedaban después de la 1000 en orden alfabético (el catálogo base ya trae ~760).
  const recipes = await prisma.recipe.findMany({ where, include: { ingredients: { include: { ingredient: true } } }, orderBy: { name: 'asc' } })
  return { items: recipes }
})

app.post('/api/v1/recipes', async (request, reply) => {
  const { name, mealTypes = [], portions, instructions, nutrition = {}, restrictions = [], imageUrl, ingredientsText, timeMinutes, ingredients = [] } = request.body || {}
  if (!name || !isStringList(mealTypes) || !mealTypes.length) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Nombre y al menos un tiempo de comida son obligatorios.', fields: { name: !name, mealTypes: true } })
  const invalid = invalidRecipeFields({ name, portions, restrictions, timeMinutes })
  if (Object.keys(invalid).length) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Revisa los datos de la receta.', fields: invalid })
  const rows = normalizeRecipeIngredientRows(ingredients)
  if (!rows) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Cada ingrediente necesita una cantidad mayor a 0 y no puede repetirse.', fields: { ingredients: true } })
  const validIngredients = rows.length ? await prisma.ingredient.findMany({ where: { id: { in: rows.map((item) => item.ingredientId) }, practiceId: request.practiceId }, select: { id: true } }) : []
  const validIds = new Set(validIngredients.map((item) => item.id))
  const recipe = await prisma.recipe.create({ data: { practiceId: request.practiceId, name, mealTypes, portions, instructions, nutrition, restrictions, imageUrl, ...(ingredientsText !== undefined ? { ingredientsText } : {}), ...(timeMinutes !== undefined ? { timeMinutes } : {}), ingredients: { create: rows.filter((item) => validIds.has(item.ingredientId)) } }, include: { ingredients: { include: { ingredient: true } } } })
  return reply.code(201).send(recipe)
})

app.get('/api/v1/recipes/:recipeId', async (request, reply) => {
  const recipe = await prisma.recipe.findFirst({ where: { id: request.params.recipeId, practiceId: request.practiceId }, include: { ingredients: { include: { ingredient: true } } } })
  if (!recipe) return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', message: 'Receta no encontrada.', fields: {} })
  return recipe
})

app.patch('/api/v1/recipes/:recipeId', async (request, reply) => {
  const recipe = await prisma.recipe.findFirst({ where: { id: request.params.recipeId, practiceId: request.practiceId } })
  if (!recipe) return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', message: 'Receta no encontrada.', fields: {} })
  const { name, mealTypes, portions, instructions, restrictions, imageUrl, ingredientsText, timeMinutes, status } = request.body || {}
  if (name !== undefined && !name) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El nombre no puede quedar vacío.', fields: { name: true } })
  if (mealTypes !== undefined && (!isStringList(mealTypes) || !mealTypes.length)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Selecciona al menos un tiempo de comida.', fields: { mealTypes: true } })
  const invalid = invalidRecipeFields({ name, portions, restrictions, timeMinutes, status })
  if (Object.keys(invalid).length) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Revisa los datos de la receta.', fields: invalid })
  const updated = await prisma.recipe.update({
    where: { id: recipe.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(mealTypes !== undefined ? { mealTypes } : {}),
      ...(portions !== undefined ? { portions } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      ...(restrictions !== undefined ? { restrictions } : {}),
      ...(imageUrl !== undefined ? { imageUrl } : {}),
      ...(ingredientsText !== undefined ? { ingredientsText } : {}),
      ...(timeMinutes !== undefined ? { timeMinutes } : {}),
      ...(status !== undefined ? { status } : {}),
    },
    include: { ingredients: { include: { ingredient: true } } },
  })
  return updated
})

app.put('/api/v1/recipes/:recipeId/ingredients', async (request, reply) => {
  const { ingredients = [] } = request.body || {}
  const recipe = await prisma.recipe.findFirst({ where: { id: request.params.recipeId, practiceId: request.practiceId } })
  if (!recipe) return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', message: 'Receta no encontrada.', fields: {} })
  const rows = normalizeRecipeIngredientRows(ingredients)
  if (!rows) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Cada ingrediente necesita una cantidad mayor a 0 y no puede repetirse.', fields: { ingredients: true } })
  const validIngredients = rows.length ? await prisma.ingredient.findMany({ where: { id: { in: rows.map((item) => item.ingredientId) }, practiceId: request.practiceId }, select: { id: true } }) : []
  const validIds = new Set(validIngredients.map((item) => item.id))
  const filteredIngredients = rows.filter((item) => validIds.has(item.ingredientId))
  // An imported recipe may legitimately have no SMAE linkage (that just clears the calculated
  // side); a handmade recipe still needs at least one ingredient or its nutrition would be 0.
  if (!filteredIngredients.length && !recipe.source) return reply.code(400).send({ code: 'EMPTY_RECIPE', message: 'La receta debe conservar al menos un ingrediente.', fields: {} })
  // El recálculo va dentro de la misma transacción: si fallaba después de cambiar los ingredientes,
  // la receta quedaba con los nuevos ingredientes y los nutrimentos de los anteriores.
  return prisma.$transaction(async (transaction) => {
    await transaction.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } })
    if (filteredIngredients.length) await transaction.recipeIngredient.createMany({ data: filteredIngredients.map((item) => ({ recipeId: recipe.id, ...item })) })
    const updated = await transaction.recipe.findUnique({ where: { id: recipe.id }, include: { ingredients: { include: { ingredient: true } } } })
    const computed = perServingFromIngredients(updated.ingredients, updated.portions)
    // Imported recipes keep their original per-serving values in `nutrition` and store the SMAE
    // result in `calculatedNutrition`; handmade recipes keep the old behavior (nutrition = computed).
    const data = updated.source
      ? { calculatedNutrition: filteredIngredients.length ? computed : null, calculationUpdatedAt: new Date(), version: { increment: 1 } }
      : { nutrition: computed, version: { increment: 1 } }
    return transaction.recipe.update({ where: { id: updated.id }, data, include: { ingredients: { include: { ingredient: true } } } })
  })
})

app.get('/api/v1/recipes/:recipeId/nutrition', async (request, reply) => {
  const recipe = await prisma.recipe.findFirst({ where: { id: request.params.recipeId, practiceId: request.practiceId }, include: { ingredients: { include: { ingredient: true } } } })
  if (!recipe) return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', message: 'Receta no encontrada.', fields: {} })
  // Mismo cálculo que al guardar (perServingFromIngredients): la copia que vivía aquí dividía entre
  // `portions` sin protegerse de 0 (un Decimal 0 es "truthy") y devolvía Infinity/NaN.
  return { recipeId: recipe.id, servings: Math.max(1, Number(recipe.portions) || 1), perServing: perServingFromIngredients(recipe.ingredients, recipe.portions), ingredients: recipe.ingredients.map((item) => ({ name: item.ingredient.name, quantity: Number(item.quantity), unit: item.unit, equivalence: item.equivalence ? Number(item.equivalence) : null })) }
})

app.post('/api/v1/recipes/:recipeId/recalculate', async (request, reply) => {
  const recipe = await prisma.recipe.findFirst({ where: { id: request.params.recipeId, practiceId: request.practiceId }, include: { ingredients: { include: { ingredient: true } } } })
  if (!recipe) return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', message: 'Receta no encontrada.', fields: {} })
  const computed = perServingFromIngredients(recipe.ingredients, recipe.portions)
  const data = recipe.source
    ? { calculatedNutrition: recipe.ingredients.length ? computed : null, calculationUpdatedAt: new Date(), version: { increment: 1 } }
    : { nutrition: computed, version: { increment: 1 } }
  const updated = await prisma.recipe.update({ where: { id: recipe.id }, data })
  return { recipe: updated, nutrition: recipe.source ? recipe.nutrition : computed, calculatedNutrition: recipe.source ? updated.calculatedNutrition : null, version: updated.version }
})

app.get('/api/v1/education-materials', async (request, reply) => {
  const { search = '', category, status = 'ACTIVE' } = request.query
  // Un status arbitrario iba directo al enum de Prisma → error de validación → 500.
  if (!['ACTIVE', 'ARCHIVED'].includes(status)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Estado inválido.', fields: { status: true } })
  const where = {
    practiceId: request.practiceId,
    status,
    ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
    ...(category ? { category } : {}),
  }
  const materials = await prisma.educationMaterial.findMany({ where, orderBy: { title: 'asc' }, take: 100 })
  return { items: materials }
})

app.post('/api/v1/education-materials', async (request, reply) => {
  const { title, category, description, body, color = 'mint', readMinutes } = request.body || {}
  if (!title || !category) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Título y categoría son obligatorios.', fields: { title: !title, category: !category } })
  const material = await prisma.educationMaterial.create({ data: { practiceId: request.practiceId, title, category, description: description || '', body: body || '', color, readMinutes: readMinutes ? Number(readMinutes) : 5 } })
  return reply.code(201).send(material)
})

app.get('/api/v1/education-materials/:materialId', async (request, reply) => {
  const material = await prisma.educationMaterial.findFirst({ where: { id: request.params.materialId, practiceId: request.practiceId } })
  if (!material) return reply.code(404).send({ code: 'MATERIAL_NOT_FOUND', message: 'Material no encontrado.', fields: {} })
  return material
})

app.patch('/api/v1/education-materials/:materialId', async (request, reply) => {
  const material = await prisma.educationMaterial.findFirst({ where: { id: request.params.materialId, practiceId: request.practiceId } })
  if (!material) return reply.code(404).send({ code: 'MATERIAL_NOT_FOUND', message: 'Material no encontrado.', fields: {} })
  const { title, category, description, body, color, readMinutes, status } = request.body || {}
  if (title !== undefined && !title) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El título no puede quedar vacío.', fields: { title: true } })
  if (category !== undefined && !category) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'La categoría no puede quedar vacía.', fields: { category: true } })
  if (status !== undefined && !['ACTIVE', 'ARCHIVED'].includes(status)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Estado inválido.', fields: { status: true } })
  const updated = await prisma.educationMaterial.update({
    where: { id: material.id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(color !== undefined ? { color } : {}),
      ...(readMinutes !== undefined ? { readMinutes: Number(readMinutes) } : {}),
      ...(status !== undefined ? { status } : {}),
    },
  })
  return updated
})

const EDUCATION_MIME_EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const EDUCATION_MAGIC = {
  pdf: (buffer) => buffer.subarray(0, 5).toString('latin1') === '%PDF-',
  png: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  webp: (buffer) => buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP',
}
const educationAttachmentDir = () => path.resolve(process.env.EDUCATION_ATTACHMENT_STORAGE_PATH || './storage/education-materials')

// A shareable file (PDF guide, infographic image...) attached to an education material. Same
// data-URL pattern used for practice logos (fase 42) and lab PDFs (fase 46) -- no multipart.
app.post('/api/v1/education-materials/:materialId/attachment', async (request, reply) => {
  const material = await prisma.educationMaterial.findFirst({ where: { id: request.params.materialId, practiceId: request.practiceId } })
  if (!material) return reply.code(404).send({ code: 'MATERIAL_NOT_FOUND', message: 'Material no encontrado.', fields: {} })
  const { fileName, dataUrl } = request.body || {}
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:([a-z/]+);base64,(.+)$/)
  const ext = match && EDUCATION_MIME_EXT[match[1]]
  if (!match || !ext || !fileName) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Sube un archivo PDF o imagen (PNG/JPG/WebP).', fields: { dataUrl: true } })
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.byteLength > 10 * 1024 * 1024) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El archivo no puede pesar más de 10 MB.', fields: { dataUrl: true } })
  // El tipo del data URL lo declara el cliente: se comprueba la firma del contenido para no guardar
  // (y luego servir con ese tipo) un archivo que no es lo que dice ser.
  if (!EDUCATION_MAGIC[ext](buffer)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El archivo no es un PDF o imagen válido.', fields: { dataUrl: true } })
  const storageKey = `${material.id}.${ext}`
  await mkdir(educationAttachmentDir(), { recursive: true })
  await writeFile(path.join(educationAttachmentDir(), storageKey), buffer)
  const updated = await prisma.educationMaterial.update({
    where: { id: material.id },
    data: { attachmentFileName: String(fileName).slice(0, 180), attachmentStorageKey: storageKey, attachmentFileSize: buffer.byteLength, attachmentMime: match[1] },
  })
  // Reemplazar con otra extensión dejaba el archivo anterior huérfano.
  if (material.attachmentStorageKey && material.attachmentStorageKey !== storageKey) await unlink(path.join(educationAttachmentDir(), material.attachmentStorageKey)).catch(() => {})
  return updated
})

app.get('/api/v1/education-materials/:materialId/attachment', async (request, reply) => {
  const material = await prisma.educationMaterial.findFirst({ where: { id: request.params.materialId, practiceId: request.practiceId } })
  if (!material?.attachmentStorageKey) return reply.code(404).send({ code: 'MATERIAL_ATTACHMENT_NOT_FOUND', message: 'Este material no tiene archivo adjunto.', fields: {} })
  try {
    const file = await readFile(path.join(educationAttachmentDir(), material.attachmentStorageKey))
    const disposition = material.attachmentMime?.startsWith('image/') ? 'inline' : 'attachment'
    return reply.type(material.attachmentMime || 'application/octet-stream').header('Content-Disposition', contentDisposition(disposition, safeFileName(material.attachmentFileName || material.attachmentStorageKey))).header('X-Content-Type-Options', 'nosniff').send(file)
  } catch {
    return reply.code(404).send({ code: 'MATERIAL_ATTACHMENT_NOT_FOUND', message: 'El archivo adjunto no está disponible.', fields: {} })
  }
})

app.delete('/api/v1/education-materials/:materialId/attachment', async (request, reply) => {
  const material = await prisma.educationMaterial.findFirst({ where: { id: request.params.materialId, practiceId: request.practiceId } })
  if (!material) return reply.code(404).send({ code: 'MATERIAL_NOT_FOUND', message: 'Material no encontrado.', fields: {} })
  if (material.attachmentStorageKey) await unlink(path.join(educationAttachmentDir(), material.attachmentStorageKey)).catch(() => {})
  const updated = await prisma.educationMaterial.update({
    where: { id: material.id },
    data: { attachmentFileName: null, attachmentStorageKey: null, attachmentFileSize: null, attachmentMime: null },
  })
  return updated
})

const ingredientImageDir = () => path.resolve(process.env.INGREDIENT_IMAGE_STORAGE_PATH || './storage/ingredients')

// Foto opcional de un ingrediente (útil para los de supermercado). Mismo patrón de data URL que
// logos/adjuntos. Se sirve pública porque se usa como <img src>, igual que las imágenes de recetas.
app.post('/api/v1/ingredients/:ingredientId/image', async (request, reply) => {
  const ingredient = await prisma.ingredient.findFirst({ where: { id: request.params.ingredientId, practiceId: request.practiceId } })
  if (!ingredient) return reply.code(404).send({ code: 'INGREDIENT_NOT_FOUND', message: 'Ingrediente no encontrado.', fields: {} })
  const { dataUrl } = request.body || {}
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:([a-z/]+);base64,(.+)$/)
  const ext = match && LOGO_MIME_EXT[match[1]]
  if (!match || !ext) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Sube una imagen PNG, JPG o WebP.', fields: { dataUrl: true } })
  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.byteLength > 3 * 1024 * 1024) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'La imagen no puede pesar más de 3 MB.', fields: { dataUrl: true } })
  // Con marca de tiempo, como las fotos de receta: con el nombre fijo `<id>.<ext>`, al cambiar la
  // imagen por otra del mismo tipo la URL no cambiaba y el navegador seguía mostrando la anterior
  // (se sirve con caché de un día).
  const storageKey = `${ingredient.id}-${Date.now().toString(36)}.${ext}`
  await mkdir(ingredientImageDir(), { recursive: true })
  await writeFile(path.join(ingredientImageDir(), storageKey), buffer)
  const updated = await prisma.ingredient.update({ where: { id: ingredient.id }, data: { imageFile: storageKey } })
  // La imagen anterior se borra del disco para no dejarla huérfana.
  if (ingredient.imageFile && ingredient.imageFile !== storageKey) await unlink(path.join(ingredientImageDir(), ingredient.imageFile)).catch(() => {})
  return updated
})

app.get('/api/v1/ingredients/images/:fileName', async (request, reply) => {
  const { fileName } = request.params
  if (!/^[a-z0-9][a-z0-9-]*\.(png|jpg|webp)$/.test(fileName)) return reply.code(404).send({ code: 'IMAGE_NOT_FOUND', message: 'Imagen no encontrada.', fields: {} })
  const ext = fileName.split('.').pop()
  const mime = Object.entries(LOGO_MIME_EXT).find(([, value]) => value === ext)?.[0] || 'application/octet-stream'
  try {
    const file = await readFile(path.join(ingredientImageDir(), fileName))
    return reply.type(mime).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'public, max-age=86400').send(file)
  } catch {
    return reply.code(404).send({ code: 'IMAGE_NOT_FOUND', message: 'Imagen no encontrada.', fields: {} })
  }
})

app.delete('/api/v1/ingredients/:ingredientId/image', async (request, reply) => {
  const ingredient = await prisma.ingredient.findFirst({ where: { id: request.params.ingredientId, practiceId: request.practiceId } })
  if (!ingredient) return reply.code(404).send({ code: 'INGREDIENT_NOT_FOUND', message: 'Ingrediente no encontrado.', fields: {} })
  if (ingredient.imageFile) await unlink(path.join(ingredientImageDir(), ingredient.imageFile)).catch(() => {})
  return prisma.ingredient.update({ where: { id: ingredient.id }, data: { imageFile: null } })
})

app.get('/api/v1/ingredients', async (request) => {
  const { search = '', group } = request.query
  const where = await nameSearchWhere(prisma.ingredient, { practiceId: request.practiceId, status: 'ACTIVE', ...(group ? { group: String(group) } : {}) }, search)
  // Tope de 200 (el catálogo base trae ~3,000 y varios grupos pasan de 200): se pide uno de más
  // para saber si hubo recorte (`hasMore`) y que las pantallas pidan buscar, en vez de cortar en
  // silencio. Un count aparte costaba otro recorrido de la tabla en cada tecla.
  const ingredients = await prisma.ingredient.findMany({ where, orderBy: { name: 'asc' }, take: 201 })
  return { items: ingredients.slice(0, 200), hasMore: ingredients.length > 200 }
})

app.post('/api/v1/ingredients/import', async (request, reply) => {
  const { externalId, source, name, group, unit = 'g', nutrition = {}, equivalence = {}, imageUrl } = request.body || {}
  if (!externalId || !source || !name || !group) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fuente, identificador, nombre y grupo son obligatorios.', fields: {} })
  const practiceId = request.practiceId
  // Misma regla que el alta manual: volver a elegir el resultado ya importado creaba un duplicado.
  const duplicate = await prisma.ingredient.findFirst({ where: { practiceId, name: { equals: String(name), mode: 'insensitive' } } })
  if (duplicate) return reply.code(409).send({ code: 'INGREDIENT_EXISTS', message: 'Ya existe un ingrediente con ese nombre en tu catálogo.', fields: { name: true } })
  const ingredient = await prisma.ingredient.create({ data: { practiceId, name, group, unit, nutrition, equivalence: { ...equivalence, source: { provider: source, externalId, importedAt: new Date().toISOString() } } } })
  return reply.code(201).send({ ...ingredient, imageUrl: imageUrl || null })
})

// Manual ingredient (e.g. the "Aproximados Menu 500" group) so a missing catalog item can be
// approximated and then linked into a recipe to contrast the SMAE calculation against the book.
app.post('/api/v1/ingredients', async (request, reply) => {
  const { name, group, unit = 'g', nutrition = {}, equivalence } = request.body || {}
  if (!name || !group) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Nombre y grupo son obligatorios.', fields: { name: !name, group: !group } })
  const duplicate = await prisma.ingredient.findFirst({ where: { practiceId: request.practiceId, name: { equals: name, mode: 'insensitive' } } })
  if (duplicate) return reply.code(409).send({ code: 'INGREDIENT_EXISTS', message: 'Ya existe un ingrediente con ese nombre.', fields: { name: true } })
  const ingredient = await prisma.ingredient.create({ data: { practiceId: request.practiceId, name, group, unit, nutrition, equivalence: equivalence || null } })
  return reply.code(201).send(ingredient)
})

app.get('/api/v1/food/search', async (request, reply) => {
  try {
    const source = request.query.source || 'all'
    const result = await searchFoods(source, request.query.q || '', Number(request.query.pageSize) || 20)
    return reply.send(result)
  } catch (error) {
    return reply.code(error.statusCode || 502).send({ code: error.code || 'FOOD_PROVIDER_ERROR', message: error.message || 'No fue posible consultar el proveedor de alimentos.', fields: {} })
  }
})

app.get('/api/v1/dashboard/today', async (request, reply) => {
  // Sin `date`, "hoy" es el día de la práctica (con el día UTC, en México después de las 18:00 ya
  // devolvía la agenda de mañana).
  const practiceTz = request.query.date ? null : (await prisma.practice.findUnique({ where: { id: request.practiceId }, select: { timeZone: true } }))?.timeZone
  const date = request.query.date || practiceWallClockNow(practiceTz).toISOString().slice(0, 10)
  const start = new Date(`${date}T00:00:00.000Z`)
  const end = new Date(`${date}T23:59:59.999Z`)
  // Una fecha mal formada llegaba a Prisma como Invalid Date → 500.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(start.getTime())) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fecha inválida.', fields: { date: 'invalid' } })
  const practiceId = request.practiceId
  const [appointments, pendingConfirmations, followUps, activePatients, tasks] = await prisma.$transaction([
    prisma.appointment.findMany({ where: { practiceId, startAt: { gte: start, lte: end }, status: { notIn: ['CANCELLED', 'NO_SHOW'] }, type: { not: 'BLOCK' } }, include: { patient: true }, orderBy: { startAt: 'asc' } }),
    prisma.appointment.count({ where: { practiceId, startAt: { gte: start, lte: end }, status: 'PENDING_CONFIRMATION' } }),
    // FollowupsPage counts ALL pending tasks regardless of type; the card must match the page it
    // links to (previously it only counted nutrition_plan + consultation_report and undercounted).
    prisma.task.count({ where: { practiceId, status: 'pending' } }),
    prisma.patient.count({ where: { practiceId, status: 'ACTIVE' } }),
    prisma.task.findMany({ where: { practiceId, status: 'pending' }, include: { patient: true }, orderBy: { dueAt: 'asc' }, take: 3 }),
  ])
  // Resumen financiero para el dashboard de "Hoy": el día, el saldo acumulado y la serie de 7 días
  // para la gráfica rápida.
  const finance = await buildFinanceSnapshot(practiceId, date)
  // Planes en borrador (no publicados) para retomarlos desde "Hoy", con su avance y el de la
  // consulta asociada. El borrador ya se autoguarda (partial con cada edición), así que aquí solo
  // se reporta hasta dónde quedó.
  const plans = await prisma.nutritionPlan.findMany({
    where: { patient: { practiceId }, status: { in: ['DRAFT', 'READY'] } },
    include: { patient: true, mealSlots: { select: { dayOfWeek: true } }, consultation: { include: { sections: { select: { payload: true } } } } },
    orderBy: { updatedAt: 'desc' },
    take: 8,
  })
  const PLAN_STEPS = ['Evaluación', 'Cálculo', 'Distribución', 'Semana', 'Entrega']
  const pendingPlans = plans.map((plan) => {
    const days = new Set((plan.mealSlots || []).map((slot) => slot.dayOfWeek))
    const steps = [
      (plan.evaluation && typeof plan.evaluation === 'object' && Object.keys(plan.evaluation).length > 0) || !!plan.goal,
      plan.targetKcal != null,
      (plan.mealSlots || []).length > 0,
      days.size >= 5,
      plan.status === 'PUBLISHED',
    ]
    const sections = plan.consultation?.sections || []
    const filled = sections.filter((section) => section.payload && Object.values(section.payload).some((value) => (Array.isArray(value) ? value.length > 0 : value !== '' && value != null))).length
    return {
      id: plan.id,
      patientId: plan.patientId,
      patientName: `${plan.patient.firstName} ${plan.patient.lastName}`.trim(),
      updatedAt: plan.updatedAt,
      progress: Math.round((steps.filter(Boolean).length / steps.length) * 100),
      nextStep: PLAN_STEPS[steps.findIndex((done) => !done)] || 'Entrega',
      consultationProgress: Math.min(100, Math.round((filled / 13) * 100)),
    }
  })
  return { date, stats: { appointments: appointments.length, pendingConfirmations, followUps, activePatients }, appointments, tasks, finance, pendingPlans }
})

// Tarifas por tipo de cita (centavos). Cualquier valor ausente/negativo se normaliza a 0 para que
// el JSON guardado en Practice.fees siempre tenga la misma forma.
const APPOINTMENT_TYPES = ['INITIAL', 'FOLLOW_UP', 'QUICK_CONTROL', 'EMERGENCY']
const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER']
// Tope de un monto en centavos: FinanceEntry.amountCents es Int (32 bits) en Postgres. Un valor
// mayor reventaba el insert con un 500 genérico (o, en el cierre de consulta, perdía el ingreso).
const MAX_AMOUNT_CENTS = 2147483647
const normalizeFees = (fees) => {
  const source = fees && typeof fees === 'object' ? fees : {}
  return Object.fromEntries(APPOINTMENT_TYPES.map((type) => [type, Math.min(MAX_AMOUNT_CENTS, Math.max(0, Math.round(Number(source[type]) || 0)))]))
}
// Normaliza un monto en centavos: entero positivo o 0. La UI ya convierte pesos → centavos.
const normalizeCents = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

// "Ahora" en el reloj de pared de la práctica, etiquetado con "Z" (misma convención que las citas):
// así el movimiento cae en el día correcto al filtrar por fecha local, sin importar la zona del viewer.
const practiceWallClockAt = (instant, timeZone) => {
  if (timeZone) {
    try {
      const date = instant.toLocaleDateString('en-CA', { timeZone })
      const time = instant.toLocaleTimeString('en-US', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      return new Date(`${date}T${time}.000Z`)
    } catch { /* cae al reloj del sistema */ }
  }
  return instant
}
const practiceWallClockNow = (timeZone) => practiceWallClockAt(new Date(), timeZone)

// Registra el ingreso de una consulta recién cerrada. Toma el monto enviado (editable en el modal de
// cierre) o, si no viene, la tarifa configurada para el tipo de cita. Si ya existe el ingreso de esa
// consulta (p. ej. se cerró dos veces), lo actualiza en vez de duplicarlo.
async function recordConsultationIncome(consultation, { paymentMethod, amountCents } = {}) {
  const practice = await prisma.practice.findUnique({ where: { id: consultation.patient.practiceId } })
  const type = consultation.appointment?.type && APPOINTMENT_TYPES.includes(consultation.appointment.type) ? consultation.appointment.type : 'FOLLOW_UP'
  const fees = normalizeFees(practice?.fees)
  const hasExplicit = amountCents !== undefined && amountCents !== null && amountCents !== ''
  // Un monto explícito pero no numérico no debe anular el cobro: se cae a la tarifa configurada.
  const explicitInvalid = hasExplicit && !Number.isFinite(Number(amountCents))
  const amount = hasExplicit && !explicitInvalid ? normalizeCents(amountCents) : fees[type]
  // Un 0 explícito al recerrar (consulta reabierta que al final no se cobra) debe quitar el ingreso
  // anterior; antes se ignoraba y Finanzas seguía mostrando el cobro original.
  if (amount <= 0 && hasExplicit && !explicitInvalid) await prisma.financeEntry.deleteMany({ where: { consultationId: consultation.id, practiceId: consultation.patient.practiceId } })
  if (amount <= 0) return null
  const method = PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : 'CASH'
  const occurredAt = practiceWallClockNow(practice?.timeZone)
  return prisma.financeEntry.upsert({
    where: { consultationId: consultation.id },
    // Al recerrar una consulta se conserva la fecha original del ingreso; sólo cambia monto/método.
    update: { amountCents: amount, method },
    create: { practiceId: consultation.patient.practiceId, type: 'INCOME', amountCents: amount, method, occurredAt, consultationId: consultation.id },
  })
}

// Totales de ingreso/egreso en un rango (fechas UTC), a partir de los movimientos del consultorio.
// Sin rango (from/to nulos) es el histórico completo, sin filtrar por fecha.
// La suma la hace Postgres (groupBy por tipo): antes se traían todos los movimientos del histórico a
// memoria en cada carga de Finanzas y de Hoy, y el tiempo crecía con los años de uso.
const financeSumQuery = (where) => prisma.financeEntry.groupBy({ by: ['type'], where, _sum: { amountCents: true } })
function totalsFromGroups(groups) {
  let incomeCents = 0
  let expenseCents = 0
  for (const group of groups) { const cents = group._sum.amountCents || 0; if (group.type === 'INCOME') incomeCents += cents; else expenseCents += cents }
  return { incomeCents, expenseCents, balanceCents: incomeCents - expenseCents }
}
async function financeTotals(practiceId, from, to) {
  return totalsFromGroups(await financeSumQuery({ practiceId, ...(from && to ? { occurredAt: { gte: from, lte: to } } : {}) }))
}

// Serie diaria (para la gráfica) recortada a 92 días como máximo para no devolver rangos absurdos.
function dailyFinanceSeries(entries, from, to) {
  const byDate = new Map()
  for (const entry of entries) {
    const key = new Date(entry.occurredAt).toISOString().slice(0, 10)
    const current = byDate.get(key) || { date: key, incomeCents: 0, expenseCents: 0 }
    if (entry.type === 'INCOME') current.incomeCents += entry.amountCents; else current.expenseCents += entry.amountCents
    byDate.set(key, current)
  }
  const series = []
  const startDate = new Date(from)
  const endDate = new Date(to)
  const startDay = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
  const endDay = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate())
  const days = Math.min(92, Math.max(1, Math.round((endDay - startDay) / 86400000) + 1))
  for (let i = 0; i < days; i += 1) {
    const key = new Date(startDay + i * 86400000).toISOString().slice(0, 10)
    series.push(byDate.get(key) || { date: key, incomeCents: 0, expenseCents: 0 })
  }
  return series
}

// Snapshot financiero corto para "Hoy": hoy, saldo acumulado y últimos 7 días (hoy incluido).
async function buildFinanceSnapshot(practiceId, date) {
  const dayStart = new Date(`${date}T00:00:00.000Z`)
  const dayEnd = new Date(`${date}T23:59:59.999Z`)
  const weekStart = new Date(dayStart.getTime() - 6 * 86400000)
  const [today, allTimeGroups, weekEntries] = await prisma.$transaction([
    prisma.financeEntry.findMany({ where: { practiceId, occurredAt: { gte: dayStart, lte: dayEnd } }, select: { type: true, amountCents: true } }),
    financeSumQuery({ practiceId }),
    prisma.financeEntry.findMany({ where: { practiceId, occurredAt: { gte: weekStart, lte: dayEnd } }, select: { type: true, amountCents: true, occurredAt: true } }),
  ])
  const sum = (entries) => entries.reduce((acc, entry) => { if (entry.type === 'INCOME') acc.incomeCents += entry.amountCents; else acc.expenseCents += entry.amountCents; return { ...acc, balanceCents: acc.incomeCents - acc.expenseCents } }, { incomeCents: 0, expenseCents: 0, balanceCents: 0 })
  return { today: sum(today), allTime: totalsFromGroups(allTimeGroups), last7: dailyFinanceSeries(weekEntries, weekStart, dayEnd) }
}

app.get('/api/v1/finance', async (request, reply) => {
  const practiceId = request.practiceId
  // El mes por omisión es el de la práctica (los movimientos se guardan en su hora de pared).
  const practice = request.query.from && request.query.to ? null : await prisma.practice.findUnique({ where: { id: practiceId }, select: { timeZone: true } })
  const now = practiceWallClockNow(practice?.timeZone)
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10)
  const from = request.query.from || defaultFrom
  const to = request.query.to || defaultTo
  const fromDate = new Date(`${from}T00:00:00.000Z`)
  const toDate = new Date(`${to}T23:59:59.999Z`)
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Rango de fechas inválido.', fields: { from: true, to: true } })
  }
  const [entries, allTime, rangeTotals, practiceFees] = await Promise.all([
    prisma.financeEntry.findMany({ where: { practiceId, occurredAt: { gte: fromDate, lte: toDate } }, include: { consultation: { include: { patient: true, appointment: true } } }, orderBy: { occurredAt: 'desc' } }),
    // Histórico sin límite de fechas: con new Date(0) quedaban fuera los movimientos con un año mal
    // capturado (p. ej. 0202) y el "Disponible" no cuadraba con el del dashboard de Hoy.
    financeTotals(practiceId, null, null),
    financeTotals(practiceId, fromDate, toDate),
    prisma.practice.findUnique({ where: { id: practiceId }, select: { fees: true, businessHours: true } }),
  ])
  const byMethod = PAYMENT_METHODS.map((method) => {
    const income = entries.filter((entry) => entry.type === 'INCOME' && entry.method === method)
    return { method, incomeCents: income.reduce((acc, entry) => acc + entry.amountCents, 0), count: income.length }
  })
  return {
    from,
    to,
    allTime,
    range: rangeTotals,
    byMethod,
    daily: dailyFinanceSeries(entries, fromDate, toDate),
    fees: normalizeFees(practiceFees?.fees),
    entries: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      amountCents: entry.amountCents,
      method: entry.method,
      category: entry.category,
      description: entry.description,
      occurredAt: entry.occurredAt,
      appointmentType: entry.consultation?.appointment?.type || null,
      // El nombre sale de la consulta vinculada; si el ingreso no tiene consulta (p. ej. capturado
      // a mano) se usa su descripción para que la fila no quede como un genérico "Consulta".
      patientName: entry.consultation?.patient ? `${entry.consultation.patient.firstName} ${entry.consultation.patient.lastName}`.trim() : (entry.type === 'INCOME' ? entry.description : null),
    })),
  }
})

app.post('/api/v1/finance/expenses', async (request, reply) => {
  const { amountCents, method, category, description, occurredAt } = request.body || {}
  const amount = normalizeCents(amountCents)
  if (amount <= 0) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El monto del egreso debe ser mayor a cero.', fields: { amountCents: true } })
  if (amount > MAX_AMOUNT_CENTS) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El monto es demasiado grande.', fields: { amountCents: true } })
  // Sin fecha se usa "ahora" en el reloj de pared de la práctica (misma convención que el ingreso de
  // consulta); con new Date() un egreso capturado en la noche caía en el día UTC siguiente.
  const practice = occurredAt ? null : await prisma.practice.findUnique({ where: { id: request.practiceId }, select: { timeZone: true } })
  const when = occurredAt ? new Date(occurredAt) : practiceWallClockNow(practice?.timeZone)
  if (Number.isNaN(when.getTime())) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fecha inválida.', fields: { occurredAt: true } })
  const entry = await prisma.financeEntry.create({
    data: {
      practiceId: request.practiceId,
      type: 'EXPENSE',
      amountCents: amount,
      method: PAYMENT_METHODS.includes(method) ? method : null,
      category: category == null ? null : String(category).trim() || null,
      description: description == null ? null : String(description).trim() || null,
      occurredAt: when,
    },
  })
  return reply.code(201).send(entry)
})

app.patch('/api/v1/finance/entries/:entryId', async (request, reply) => {
  const entry = await prisma.financeEntry.findFirst({ where: { id: request.params.entryId, practiceId: request.practiceId } })
  if (!entry) return reply.code(404).send({ code: 'FINANCE_ENTRY_NOT_FOUND', message: 'Movimiento no encontrado.', fields: {} })
  const { amountCents, method, category, description, occurredAt } = request.body || {}
  const data = {}
  if (amountCents !== undefined) {
    const amount = normalizeCents(amountCents)
    if (amount <= 0) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El monto debe ser mayor a cero.', fields: { amountCents: true } })
    if (amount > MAX_AMOUNT_CENTS) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El monto es demasiado grande.', fields: { amountCents: true } })
    data.amountCents = amount
  }
  if (method !== undefined) data.method = PAYMENT_METHODS.includes(method) ? method : null
  if (category !== undefined) data.category = category == null ? null : String(category).trim() || null
  if (description !== undefined) data.description = description == null ? null : String(description).trim() || null
  if (occurredAt !== undefined) {
    // `null` no es "sin fecha": new Date(null) es 1970-01-01 y el movimiento desaparecía del periodo.
    const when = new Date(occurredAt)
    if (occurredAt === null || Number.isNaN(when.getTime())) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fecha inválida.', fields: { occurredAt: true } })
    data.occurredAt = when
  }
  return prisma.financeEntry.update({ where: { id: entry.id }, data })
})

app.delete('/api/v1/finance/entries/:entryId', async (request, reply) => {
  const entry = await prisma.financeEntry.findFirst({ where: { id: request.params.entryId, practiceId: request.practiceId } })
  if (!entry) return reply.code(404).send({ code: 'FINANCE_ENTRY_NOT_FOUND', message: 'Movimiento no encontrado.', fields: {} })
  await prisma.financeEntry.delete({ where: { id: entry.id } })
  return reply.code(204).send()
})

app.post('/api/v1/nutrition-plans/calculate', async (request, reply) => {
  const { sex, age, weightKg, heightCm, bodyFatPercent, formula = 'mifflin', activityFactor = 1.375, mets, energyAdjustKcal } = request.body || {}
  const values = { age: Number(age), weightKg: Number(weightKg), heightCm: Number(heightCm) }
  const invalid = Object.entries(values).filter(([, value]) => !Number.isFinite(value) || value <= 0).map(([key]) => key)
  if (invalid.length) return reply.code(400).send({ code: 'INVALID_MEASUREMENTS', message: 'Edad, peso y talla deben ser valores positivos.', fields: Object.fromEntries(invalid.map((key) => [key, 'invalid'])) })
  if (values.age < 1 || values.age > 120 || values.weightKg > 500 || values.heightCm > 250 || values.weightKg < 5 || values.heightCm < 40) return reply.code(400).send({ code: 'OUT_OF_RANGE', message: 'Revisa que las medidas estén dentro de un rango plausible.', fields: {} })
  try {
    return computeEnergyRequirement({ sex, age: values.age, weightKg: values.weightKg, heightCm: values.heightCm, bodyFatPercent, formula, activityFactor: normalizeActivityFactor(activityFactor), mets, energyAdjustKcal })
  } catch (error) {
    if (error instanceof NutritionEngineError) return reply.code(400).send({ code: error.code, message: error.message, fields: error.fields })
    throw error
  }
})

app.post('/api/v1/nutrition-plans/macros', async (request, reply) => {
  const { kcal, carbsPercent, proteinPercent, fatPercent } = request.body || {}
  try {
    return computeMacros({ kcal, carbsPercent, proteinPercent, fatPercent })
  } catch (error) {
    if (error instanceof NutritionEngineError) return reply.code(400).send({ code: error.code, message: error.message, fields: error.fields })
    throw error
  }
})

// Factor de actividad física: entre 1 (reposo) y 2.5; sin valor válido, sedentario.
const normalizeActivityFactor = (value) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.min(2.5, Math.max(1, number)) : 1.2 }

// Texto libre del plan (objetivo, recomendaciones…): sólo cadenas y con tope de largo. Sin tope, un
// texto de megabytes bloquea el servidor al dibujar el PDF, que es síncrono.
const cleanPlanText = (value, max) => (value === null ? null : typeof value === 'string' ? value.slice(0, max) : undefined)

// Espacios de la semana tal como se guardan: día 1–7, tiempo de comida conocido, porciones entre
// 0 y 20 (1 si no vienen bien), y uno solo por día y tiempo (gana el último).
function normalizeMealSlots(value) {
  const slots = new Map()
  for (const slot of Array.isArray(value) ? value.slice(0, 200) : []) {
    const dayOfWeek = Number(slot?.dayOfWeek)
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7 || !PLAN_MEAL_KEYS.includes(slot?.mealType)) continue
    const servings = Number(slot.servings)
    slots.set(`${dayOfWeek}|${slot.mealType}`, { dayOfWeek, mealType: slot.mealType, recipeId: typeof slot.recipeId === 'string' ? slot.recipeId : null, servings: Number.isFinite(servings) && servings > 0 && servings <= 20 ? servings : 1 })
  }
  return [...slots.values()]
}

app.post('/api/v1/patients/:patientId/plans', async (request, reply) => {
  const { consultationId, goal } = request.body || {}
  if (!consultationId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'La consulta asociada es obligatoria.', fields: { consultationId: 'required' } })
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, practiceId: request.practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  // La consulta debe ser de esta misma paciente: el plan después expone sus secciones y diagnósticos.
  const consultation = await prisma.consultation.findFirst({ where: { id: String(consultationId), patientId: patient.id }, select: { id: true } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  // Versión siguiente a la más alta de la paciente (como al duplicar): sin esto todo plan nuevo
  // nacía como v1 y la lista mostraba varios "Plan v1" de la misma paciente.
  const latest = await prisma.nutritionPlan.aggregate({ where: { patientId: patient.id }, _max: { version: true } })
  const plan = await prisma.nutritionPlan.create({ data: { patientId: patient.id, consultationId: consultation.id, version: (latest._max.version || 0) + 1, goal: cleanPlanText(goal, 1000) ?? undefined } })
  return reply.code(201).send(plan)
})

// Todos los planes de la práctica (para el hub del Constructor, sin tener que elegir paciente).
const PLAN_STATUSES = ['DRAFT', 'READY', 'PUBLISHED', 'SUPERSEDED', 'CANCELLED']
app.get('/api/v1/plans', async (request, reply) => {
  const { status } = request.query
  // Un status arbitrario iba directo al enum de Prisma → error de validación → 500.
  if (status && !PLAN_STATUSES.includes(status)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Estado de plan no válido.', fields: { status: 'invalid' } })
  const plans = await prisma.nutritionPlan.findMany({
    where: { patient: { practiceId: request.practiceId }, ...(status ? { status } : {}) },
    // El hub solo necesita el nombre de la paciente, no todos sus datos sensibles; las recetas (nombre
    // y foto) dan la tira de fotos de cada tarjeta del listado.
    include: { patient: { select: { id: true, firstName: true, lastName: true } }, mealSlots: { select: { dayOfWeek: true, recipeId: true, recipe: { select: { id: true, name: true, imageFile: true } } } } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  return { items: plans }
})

app.get('/api/v1/plans/:planId', async (request, reply) => {
  const plan = await prisma.nutritionPlan.findFirst({
    where: { id: request.params.planId, patient: { practiceId: request.practiceId } },
    // El plan arrastra contexto de la consulta que lo originó: motivo, diagnósticos y todas las
    // secciones del expediente (antropometría, clínico, dietético…) para alimentar el plan.
    include: { patient: true, mealSlots: true, documents: true, consultation: { include: { diagnoses: true, sections: { select: { sectionKey: true, payload: true } } } } },
  })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  return plan
})

// Cancelar / reactivar un plan (para la vista por estado del Constructor). Publicados también se
// pueden cancelar; al reactivar vuelve a borrador.
app.post('/api/v1/plans/:planId/cancel', async (request, reply) => {
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId: request.practiceId } } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  if (plan.status === 'CANCELLED') return plan
  const updated = await prisma.nutritionPlan.update({ where: { id: plan.id }, data: { status: 'CANCELLED' } })
  await logAudit(request, { action: 'cancelled', entity: 'NutritionPlan', entityId: updated.id, patientId: plan.patientId })
  return updated
})

app.post('/api/v1/plans/:planId/reactivate', async (request, reply) => {
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId: request.practiceId } } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  if (plan.status !== 'CANCELLED') return plan
  // Un plan que ya se había publicado vuelve a publicado, con su menú congelado intacto: reactivarlo
  // no debe reabrir a edición un plan entregado.
  const updated = await prisma.nutritionPlan.update({ where: { id: plan.id }, data: { status: plan.publishedAt ? 'PUBLISHED' : 'DRAFT' } })
  await logAudit(request, { action: 'reactivated', entity: 'NutritionPlan', entityId: updated.id, patientId: plan.patientId })
  return updated
})

// "Editar como nueva versión": un plan publicado (o cancelado) no se reabre; se copia a un borrador
// nuevo con el cálculo, las porciones, los menús, las indicaciones y las recetas de la semana. El
// original queda como estaba. Va a la consulta en curso de la paciente si hay una.
app.post('/api/v1/plans/:planId/duplicate', async (request, reply) => {
  const source = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId: request.practiceId } }, include: { mealSlots: true } })
  if (!source) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  const [openConsultation, latest] = await Promise.all([
    prisma.consultation.findFirst({ where: { patientId: source.patientId, status: 'IN_PROGRESS' }, orderBy: { createdAt: 'desc' }, select: { id: true } }),
    prisma.nutritionPlan.aggregate({ where: { patientId: source.patientId }, _max: { version: true } }),
  ])
  const copyJson = (value) => (value == null ? undefined : value)
  const plan = await prisma.nutritionPlan.create({
    data: {
      patientId: source.patientId,
      consultationId: openConsultation?.id || source.consultationId,
      version: (latest._max.version || source.version || 1) + 1,
      goal: source.goal, formula: source.formula, activityMethod: source.activityMethod, activityFactor: source.activityFactor, metsPayload: copyJson(source.metsPayload),
      targetKcal: source.targetKcal, carbsPercent: source.carbsPercent, proteinPercent: source.proteinPercent, fatPercent: source.fatPercent, evaluation: copyJson(source.evaluation),
      mealTimes: copyJson(source.mealTimes), equivalents: copyJson(source.equivalents), menus: copyJson(source.menus), mealLabels: copyJson(source.mealLabels), mealNotes: copyJson(source.mealNotes),
      activeMeals: source.activeMeals, recipeAdjustments: copyJson(source.recipeAdjustments), hydrationNote: source.hydrationNote, recommendations: source.recommendations,
      mealSlots: { create: source.mealSlots.map((slot) => ({ dayOfWeek: slot.dayOfWeek, mealType: slot.mealType, recipeId: slot.recipeId, servings: slot.servings, notes: slot.notes })) },
    },
  })
  await logAudit(request, { action: 'created', entity: 'NutritionPlan', entityId: plan.id, patientId: plan.patientId, metadata: { duplicatedFrom: source.id } })
  return reply.code(201).send(plan)
})

app.patch('/api/v1/plans/:planId', async (request, reply) => {
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId: request.practiceId } } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  if (plan.status === 'PUBLISHED' || plan.status === 'CANCELLED') return reply.code(409).send({ code: 'PLAN_LOCKED', message: 'Los planes publicados o cancelados no pueden modificarse.', fields: {} })
  const { hydrationNote, recommendations, mealTimes, equivalents, activeMeals, recipeAdjustments, mealLabels, mealNotes, menus } = request.body || {}
  const updated = await prisma.nutritionPlan.update({
    where: { id: plan.id },
    data: {
      ...(hydrationNote !== undefined ? { hydrationNote: cleanPlanText(hydrationNote, 2000) } : {}),
      ...(recommendations !== undefined ? { recommendations: cleanPlanText(recommendations, 6000) } : {}),
      ...(mealTimes !== undefined ? { mealTimes: normalizeMealTimes(mealTimes) } : {}),
      // Prisma distingue "no tocar" de "guardar nulo" en columnas Json: sin cálculo se guarda {}.
      ...(equivalents !== undefined ? { equivalents: normalizeEquivalentPlan(equivalents) || {} } : {}),
      ...(activeMeals !== undefined ? { activeMeals: normalizeActiveMeals(activeMeals) } : {}),
      ...(mealLabels !== undefined ? { mealLabels: normalizeMealLabels(mealLabels) } : {}),
      ...(menus !== undefined ? { menus: normalizeMenus(menus) } : {}),
      ...(mealNotes !== undefined ? { mealNotes: normalizeMealNotes(mealNotes) } : {}),
      ...(recipeAdjustments !== undefined ? { recipeAdjustments: normalizeRecipeAdjustments(recipeAdjustments) } : {}),
    },
  })
  await logAudit(request, { action: 'updated', entity: 'NutritionPlan', entityId: updated.id, patientId: plan.patientId, metadata: { section: 'indicaciones' } })
  return updated
})

app.get('/api/v1/plans/:planId/adequacy', async (request, reply) => {
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId: request.practiceId } }, include: { mealSlots: { include: { recipe: true } } } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  const inputs = plan.evaluation?.inputs
  if (!inputs?.age || !inputs?.sex) return { bracket: null, bracketLabel: null, nutrients: [], reason: 'MISSING_EVALUATION' }
  // Las recetas con cantidades ajustadas para este plan cuentan con su factor.
  const adjustments = normalizeRecipeAdjustments(plan.recipeAdjustments)
  const slots = plan.mealSlots.map((slot) => ({ ...slot, servings: (Number(slot.servings) || 1) * adjustmentFactor(adjustments, slot.mealType, slot.recipeId) }))
  try {
    return computeMicronutrientAdequacy(slots, inputs.age, inputs.sex)
  } catch (error) {
    request.log.error(error)
    return reply.code(500).send({ code: 'ADEQUACY_FAILED', message: 'No se pudo calcular la adecuación de micronutrientes.', fields: {} })
  }
})

app.put('/api/v1/plans/:planId/evaluation', async (request, reply) => {
  const { sex, age, weightKg, heightCm, bodyFatPercent, formula = 'mifflin', activityFactor, mets, energyAdjustKcal, carbsPercent, proteinPercent, fatPercent, goal } = request.body || {}
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId: request.practiceId } } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  if (plan.status === 'PUBLISHED' || plan.status === 'CANCELLED') return reply.code(409).send({ code: 'PLAN_LOCKED', message: 'Los planes publicados o cancelados no pueden modificarse.', fields: {} })

  const values = { age: Number(age), weightKg: Number(weightKg), heightCm: Number(heightCm) }
  const invalid = Object.entries(values).filter(([, value]) => !Number.isFinite(value) || value <= 0).map(([key]) => key)
  if (invalid.length) return reply.code(400).send({ code: 'INVALID_MEASUREMENTS', message: 'Edad, peso y talla deben ser valores positivos.', fields: Object.fromEntries(invalid.map((key) => [key, 'invalid'])) })
  if (values.age < 1 || values.age > 120 || values.weightKg > 500 || values.heightCm > 250 || values.weightKg < 5 || values.heightCm < 40) return reply.code(400).send({ code: 'OUT_OF_RANGE', message: 'Revisa que las medidas estén dentro de un rango plausible.', fields: {} })

  try {
    const factor = normalizeActivityFactor(activityFactor)
    const energy = computeEnergyRequirement({ sex, age: values.age, weightKg: values.weightKg, heightCm: values.heightCm, bodyFatPercent, formula, activityFactor: factor, mets, energyAdjustKcal })
    // El requerimiento del plan (y sus macros) ya incluye el ajuste por objetivo: déficit o superávit.
    const macros = computeMacros({ kcal: energy.targetKcal, carbsPercent, proteinPercent, fatPercent })
    const updated = await prisma.nutritionPlan.update({
      where: { id: plan.id },
      data: {
        goal: cleanPlanText(goal, 1000) ?? plan.goal,
        formula,
        activityMethod: energy.activityMethod,
        activityFactor: energy.activityMethod === 'factor' ? factor : null,
        metsPayload: energy.activityMethod === 'mets' ? { met: Number(mets?.met) || 0, minutes: Number(mets?.minutes) || 0, sessionsPerWeek: Number(mets?.sessionsPerWeek) || 0 } : Prisma.DbNull,
        targetKcal: energy.targetKcal,
        carbsPercent: macros.macros.carbs.percent,
        proteinPercent: macros.macros.protein.percent,
        fatPercent: macros.macros.fat.percent,
        evaluation: { formulaVersion: energy.formulaVersion, formulaLabel: energy.formulaLabel, get: energy.get, energyAdjustKcal: energy.energyAdjustKcal, bmr: energy.bmr, bmi: energy.bmi, bmiCategory: energy.bmiCategory, idealWeightRange: energy.idealWeightRange, flags: energy.flags, inputs: energy.inputs },
      },
    })
    await logAudit(request, { action: 'updated', entity: 'NutritionPlan', entityId: updated.id, patientId: plan.patientId, metadata: { section: 'evaluación', kcal: energy.targetKcal } })
    return { ...updated, macros: macros.macros }
  } catch (error) {
    if (error instanceof NutritionEngineError) return reply.code(400).send({ code: error.code, message: error.message, fields: error.fields })
    throw error
  }
})

app.put('/api/v1/plans/:planId/distribution', async (request, reply) => {
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId: request.practiceId } } })
  if (!plan || plan.status === 'PUBLISHED' || plan.status === 'CANCELLED') return reply.code(plan ? 409 : 404).send({ code: plan ? 'PLAN_LOCKED' : 'PLAN_NOT_FOUND', message: plan ? (plan.status === 'CANCELLED' ? 'Reactiva el plan antes de editarlo.' : 'Los planes publicados no pueden modificarse.') : 'Plan no encontrado.', fields: {} })
  // Un body sin `mealSlots` (o con otra forma) no debe borrar la semana entera en silencio.
  if (!Array.isArray(request.body?.mealSlots)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'mealSlots debe ser una lista.', fields: { mealSlots: 'invalid' } })
  const mealSlots = normalizeMealSlots(request.body.mealSlots)
  const recipeIds = [...new Set(mealSlots.map((slot) => slot.recipeId).filter(Boolean))]
  const validRecipes = recipeIds.length ? await prisma.recipe.findMany({ where: { id: { in: recipeIds }, practiceId: request.practiceId }, select: { id: true } }) : []
  const validRecipeIds = new Set(validRecipes.map((item) => item.id))
  await prisma.$transaction([prisma.mealSlot.deleteMany({ where: { planId: plan.id } }), prisma.mealSlot.createMany({ data: mealSlots.map((slot) => ({ planId: plan.id, dayOfWeek: slot.dayOfWeek, mealType: slot.mealType, recipeId: validRecipeIds.has(slot.recipeId) ? slot.recipeId : null, servings: slot.servings })) })])
  await logAudit(request, { action: 'updated', entity: 'NutritionPlan', entityId: plan.id, patientId: plan.patientId, metadata: { section: 'distribución', slots: mealSlots.length } })
  return prisma.nutritionPlan.findUnique({ where: { id: plan.id }, include: { mealSlots: true } })
})

app.post('/api/v1/plans/:planId/publish', async (request, reply) => {
  const practiceId = request.practiceId
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId } }, include: { patient: true, documents: { where: { type: 'nutrition_plan' }, orderBy: { createdAt: 'desc' } }, mealSlots: { include: { recipe: { include: { ingredients: { include: { ingredient: true } } } } } } } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  if (plan.status === 'PUBLISHED') return reply.code(409).send({ code: 'PLAN_ALREADY_PUBLISHED', message: 'Este plan ya fue publicado.', fields: {} })
  if (plan.status === 'CANCELLED') return reply.code(409).send({ code: 'PLAN_CANCELLED', message: 'Reactiva el plan antes de publicarlo.', fields: {} })
  // A plan can be half-created (recipes assigned) without ever saving the requirement — the
  // Entrega preview and the PDF would then lack the kcal/macro box. Require the calculation.
  if (plan.targetKcal == null || plan.carbsPercent == null) return reply.code(400).send({ code: 'PLAN_WITHOUT_CALCULATION', message: 'Guarda el cálculo de requerimientos en el paso "Plan alimentario" antes de publicar.', fields: {} })
  // El snapshot congela también las cantidades ajustadas para esta paciente. Las recetas archivadas
  // no entran: el Constructor ya las quita de la semana, pero el espacio seguía en la base y el PDF
  // publicado las imprimía.
  const menuSnapshot = applyRecipeAdjustments(buildMenuSnapshot(plan.mealSlots.filter((slot) => slot.recipe?.status !== 'ARCHIVED')), plan.recipeAdjustments)
  // Espacios sin receta no cuentan: un plan sin ninguna receta no se publica.
  if (!menuSnapshot.length) return reply.code(400).send({ code: 'EMPTY_PLAN', message: 'Asigna al menos una receta antes de publicar.', fields: {} })
  const { practice, user } = await loadPracticeBranding(practiceId, request.userId)
  const headerSnapshot = await buildPlanHeader(plan.patient, practice, user)
  // Update condicional: dos publicaciones concurrentes pasarían ambas la comprobación de estado y
  // crearían dos documentos. Con `updateMany` solo una gana la carrera.
  const published = await prisma.nutritionPlan.updateMany({ where: { id: plan.id, status: { notIn: ['PUBLISHED', 'CANCELLED'] } }, data: { status: 'PUBLISHED', publishedAt: new Date(), menuSnapshot, headerSnapshot } })
  if (!published.count) return reply.code(409).send({ code: 'PLAN_ALREADY_PUBLISHED', message: 'Este plan ya fue publicado.', fields: {} })
  await logAudit(request, { action: 'published', entity: 'NutritionPlan', entityId: plan.id, patientId: plan.patientId })
  // Publicar deja el PDF listo para entregar. Si la generación falla, el plan ya quedó publicado y
  // la pantalla de Entrega ofrece "Generar PDF" para reintentarlo.
  try {
    // Un plan tiene un solo documento de entrega: si ya existía (plan vuelto a publicar), se
    // regenera ese en vez de dejar uno viejo colgando con el PDF anterior.
    const document = plan.documents[0] || await prisma.document.create({ data: { patientId: plan.patientId, consultationId: plan.consultationId, planId: plan.id, type: 'nutrition_plan', sections: { menu: true, macros: true, recommendations: true }, version: 0 } })
    await generateDocumentFile(document.id, practiceId, request.userId)
  } catch (error) { request.log.error(error) }
  return prisma.nutritionPlan.findUnique({ where: { id: plan.id }, include: { documents: { orderBy: { createdAt: 'desc' } } } })
})

app.post('/api/v1/documents/nutrition-plan', async (request, reply) => {
  const { planId } = request.body || {}
  if (!planId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'planId es obligatorio.', fields: { planId: 'required' } })
  const practiceId = request.practiceId
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: planId, patient: { practiceId } } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  if (plan.status !== 'PUBLISHED') return reply.code(409).send({ code: 'PLAN_NOT_PUBLISHED', message: 'Publica el plan antes de generar su documento.', fields: {} })
  // Un plan tiene un solo documento de entrega: reutilizarlo en vez de crear uno nuevo en cada llamada.
  const existing = await prisma.document.findFirst({ where: { planId: plan.id, type: 'nutrition_plan' }, orderBy: { createdAt: 'desc' } })
  if (existing) return existing
  const document = await prisma.document.create({ data: { patientId: plan.patientId, consultationId: plan.consultationId, planId: plan.id, type: 'nutrition_plan', sections: { menu: true, macros: true, recommendations: true }, version: 0 } })
  await logAudit(request, { action: 'created', entity: 'Document', entityId: document.id, patientId: plan.patientId, metadata: { type: 'nutrition_plan', planId: plan.id } })
  return reply.code(201).send(document)
})

app.post('/api/v1/documents/consultation-report', async (request, reply) => {
  const { consultationId } = request.body || {}
  if (!consultationId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'consultationId es obligatorio.', fields: { consultationId: 'required' } })
  const consultation = await prisma.consultation.findFirst({ where: { id: consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  // Un documento de cada tipo por consulta (como el del plan): la pantalla lo regenera en vez de
  // crear otro, pero si la generación fallaba, cada reintento dejaba un documento vacío "pendiente".
  const existing = await prisma.document.findFirst({ where: { consultationId: consultation.id, type: 'consultation_report' }, orderBy: { createdAt: 'desc' } })
  if (existing) return existing
  const document = await prisma.document.create({ data: { patientId: consultation.patientId, consultationId: consultation.id, type: 'consultation_report', sections: { summary: true, anthropometric: true, diagnosis: true, treatment: true }, version: 0 } })
  return reply.code(201).send(document)
})

// RF-05: "Permitir descargar el expediente completo o una selección de secciones." The clinical
// report above is a condensed patient-facing summary; this one is the full record — every section
// of the expediente (minus Transcripción, which is an internal review draft, not clinical data).
app.post('/api/v1/documents/consultation-export', async (request, reply) => {
  const { consultationId } = request.body || {}
  if (!consultationId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'consultationId es obligatorio.', fields: { consultationId: 'required' } })
  const consultation = await prisma.consultation.findFirst({ where: { id: consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  const existing = await prisma.document.findFirst({ where: { consultationId: consultation.id, type: 'consultation_export' }, orderBy: { createdAt: 'desc' } })
  if (existing) return existing
  const document = await prisma.document.create({ data: { patientId: consultation.patientId, consultationId: consultation.id, type: 'consultation_export', sections: { full: true }, version: 0 } })
  return reply.code(201).send(document)
})

// Informe clínico para derivación: mismos datos del expediente, con tablas interpretables por
// otros profesionales (laboratorio con resultado/referencia/interpretación, recordatorio 24 h).
app.post('/api/v1/documents/consultation-clinical', async (request, reply) => {
  const { consultationId } = request.body || {}
  if (!consultationId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'consultationId es obligatorio.', fields: { consultationId: 'required' } })
  const consultation = await prisma.consultation.findFirst({ where: { id: consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  const existing = await prisma.document.findFirst({ where: { consultationId: consultation.id, type: 'consultation_clinical' }, orderBy: { createdAt: 'desc' } })
  if (existing) return existing
  const document = await prisma.document.create({ data: { patientId: consultation.patientId, consultationId: consultation.id, type: 'consultation_clinical', sections: { clinicalReport: true }, version: 0 } })
  return reply.code(201).send(document)
})

// Lista de documentos: sólo lo que la pantalla muestra (nombre y número de expediente del paciente,
// versión y estado del plan, fecha de la consulta), no el registro completo del paciente ni el
// plan entero. Antes se cortaba en 100 sin avisar; ahora el tope es 500 y se informa el total.
const DOCUMENT_LIST_INCLUDE = {
  patient: { select: { id: true, firstName: true, lastName: true, recordNumber: true, status: true } },
  plan: { select: { id: true, version: true, status: true, publishedAt: true, targetKcal: true } },
  consultation: { select: { id: true, startedAt: true, createdAt: true, status: true } },
}
app.get('/api/v1/documents', async (request) => {
  const { patientId, type } = request.query
  const where = { patientId: patientId || undefined, type: type || undefined, patient: { practiceId: request.practiceId } }
  const [documents, total] = await prisma.$transaction([
    prisma.document.findMany({ where, include: DOCUMENT_LIST_INCLUDE, orderBy: [{ generatedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], take: 500 }),
    prisma.document.count({ where }),
  ])
  return { items: documents, total }
})

// Paleta de marca para los PDFs clínicos — espejo de los tokens de src/styles/globals.css
// (Monte/Milpa/Hoja/Maíz) para que los documentos se vean consistentes con la app.
const INK = '#10231A'
const MUTED = '#4B5F52'
const FAINT = '#5F7164'
const PRIMARY = '#1F5A3A'
const ACCENT = '#F2B705'
const TINT = '#E4F0DD'
const TINT_LINE = '#cfe3d4'
const SUCCESS = '#5FA052'
const DANGER = '#B4442C'

// Ícono de marca (cuadrícula 3×3) para cuando la práctica no subió su propio logo — mismo patrón
// que src/components/BrandMark.jsx, dibujado a mano con las primitivas de pdfkit.
function drawBrandMark(file, x, y, size = 24) {
  const corners = new Set(['0-0', '0-2', '2-0', '2-2'])
  const gap = size * 0.08
  const cell = (size - gap * 2) / 3
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      file.roundedRect(x + col * (cell + gap), y + row * (cell + gap), cell, cell, cell * 0.3).fill(corners.has(`${row}-${col}`) ? PRIMARY : ACCENT)
    }
  }
}

function drawDocumentBrand(file, subtitle, practice, logoBuffer) {
  const startY = file.y
  if (logoBuffer) {
    file.image(logoBuffer, 48, startY, { height: 30 })
    file.font('Helvetica').fontSize(9).fillColor(FAINT).text(subtitle, 48, startY + 34, { width: 516 })
  } else {
    drawBrandMark(file, 48, startY + 3, 26)
    file.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(practice?.name || 'Milpa', 84, startY, { width: 480 })
    file.font('Helvetica').fontSize(9).fillColor(FAINT).text(subtitle, 84, startY + 19, { width: 480 })
  }
  file.y = startY + 44
  file.moveDown(0.8)
}

// Values in section payloads can be nested (e.g. Bioquímico "Estudios" is an array of objects);
// a bare join would print "[object Object]". Flatten objects to "clave: valor" pairs recursively.
const stringifyEntry = (value) => {
  if (Array.isArray(value)) return value.map(stringifyEntry).filter(Boolean).join(', ')
  if (value && typeof value === 'object') {
    const parts = Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== '')
    return parts.length ? parts.map(([k, v]) => `${k}: ${stringifyEntry(v)}`).join(' · ') : ''
  }
  return value
}
const diagnosisLine = (d) => [`${d.code || ''}`, `(${d.domain}) — ${d.problem}`, d.etiology ? `Causa: ${d.etiology}` : null, d.evidence ? `Evidencia: ${d.evidence}` : null].filter(Boolean).join(' ').trim()
const signatureFor = (user, practice) => [user?.name || practice?.name || 'Milpa', user?.specialty || null].filter(Boolean).join(' · ')

// Una línea de texto corrida (para hechos sueltos como "Nombre: ..." o mensajes "Sin datos…").
const drawLineText = (file, text, color = MUTED) => { file.font('Helvetica').fontSize(9).fillColor(color).text(text, 48, file.y, { width: 516 }); file.moveDown(0.12) }

// "Etiqueta: valor" en una sola línea, etiqueta en negritas. pdfkit's `continued: true` deja que la
// segunda llamada a .text() siga exactamente donde terminó la primera (con su propio color/fuente),
// así que no hay que medir el ancho de la etiqueta a mano.
function drawFieldRow(file, label, value) {
  file.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(`${label}: `, 48, file.y, { width: 516, continued: true })
  file.font('Helvetica').fontSize(9).fillColor(MUTED).text(String(value))
  file.moveDown(0.12)
}

// Fila de "chips" (píldoras) para los campos booleanos en true (condiciones, alergias…), con wrap
// manual cuando no caben en el ancho de la página — pdfkit no tiene flex-wrap.
function drawChips(file, labels) {
  const x0 = 48; const maxX = 564; const rowH = 16; const gapX = 6; const gapY = 5; const padX = 8
  let x = x0; let y = file.y
  file.font('Helvetica').fontSize(8)
  for (const label of labels) {
    const w = file.widthOfString(label) + padX * 2
    if (x + w > maxX && x !== x0) { x = x0; y += rowH + gapY }
    file.roundedRect(x, y, w, rowH, 8).fill(TINT)
    // A width tight to the label (even with lineBreak:false) still made pdfkit wrap some labels
    // onto a second line — passing a generous width that the short chip text never reaches avoids
    // the wrap; the pill itself is still sized from the real measured `w` above.
    file.fillColor(PRIMARY).text(label, x + padX, y + 4.5, { width: 500, lineBreak: false })
    x += w + gapX
  }
  file.y = y + rowH + 8
}

// Reemplaza a la antigua compactPayload(): en vez de unir TODOS los campos de una sección en un
// solo párrafo (lo que hacía que el informe se viera saturado y sin formato), separa los toggles en
// true como chips y dibuja cada campo restante en su propia línea. Devuelve true si dibujó algo, para
// que el llamador pueda decidir si mostrar un mensaje de "sin datos" quien además depende de otra
// fuente (p. ej. el recordatorio de 24 h del informe clínico).
function drawFieldList(file, payload, { skip = [], empty = 'Sin datos registrados.' } = {}) {
  // Las fotos (imágenes codificadas "data:…") no son texto: impresas salían como páginas de caracteres.
  const isImageData = (value) => (typeof value === 'string' && value.startsWith('data:')) || (Array.isArray(value) && value.some((item) => typeof item === 'string' && item.startsWith('data:')))
  const entries = Object.entries(payload || {}).filter(([key, value]) => value !== undefined && value !== null && value !== '' && !skip.includes(key) && !isImageData(value))
  const chips = entries.filter(([, value]) => value === true).map(([key]) => key.replace(/__/g, ' · '))
  const rows = entries.filter(([, value]) => value !== true && value !== false)
  if (!chips.length && !rows.length) { if (empty) drawLineText(file, empty, FAINT); return false }
  if (chips.length) drawChips(file, chips)
  for (const [key, value] of rows) drawFieldRow(file, key, stringifyEntry(value))
  return true
}

// Título de sección numerado (círculo relleno + número en blanco), igual que los pasos del
// constructor de plan en la app (.plan-steps button span). Salta de página si no queda espacio para
// el título y al menos una línea debajo, para no huerfanarlo al fondo de la hoja.
function drawSectionTitle(file, index, titleText) {
  if (file.y > file.page.height - file.page.margins.bottom - 90) file.addPage()
  file.moveDown(0.5)
  const y = file.y; const r = 9
  file.circle(48 + r, y + r, r).fill(PRIMARY)
  file.font('Helvetica-Bold').fontSize(9).fillColor('#fff').text(String(index), 48, y + r - 4.5, { width: r * 2, align: 'center' })
  file.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(titleText, 48 + r * 2 + 8, y + r - 7, { width: 490 })
  file.moveTo(48, y + r * 2 + 6).lineTo(564, y + r * 2 + 6).strokeColor(TINT_LINE).stroke()
  file.y = y + r * 2 + 14
}

// Caja de resumen (motivo/objetivo) con alto dinámico: mide el texto antes de fijar la altura de la
// caja, porque un "Motivo de consulta" largo se desbordaba de un alto fijo y el título de la
// siguiente sección se dibujaba encimado sobre el texto.
function drawSummaryBox(file, title, text) {
  file.font('Helvetica').fontSize(9)
  const textHeight = file.heightOfString(text, { width: 480 })
  const boxHeight = Math.max(58, textHeight + 43)
  // La caja no cabe en lo que queda de la hoja: si cabe en una hoja nueva, empieza ahí; si ni así
  // cabe (motivo larguísimo), la caja llega al fondo y el texto sigue en la hoja siguiente. Antes el
  // fondo se dibujaba fuera de la hoja y `file.y` quedaba más allá del pie, dejando media hoja en blanco.
  const bottom = file.page.height - file.page.margins.bottom
  if (file.y + boxHeight > bottom && boxHeight <= bottom - file.page.margins.top) file.addPage()
  const boxTop = file.y
  const fits = boxTop + boxHeight <= bottom
  file.roundedRect(48, boxTop, 516, fits ? boxHeight : bottom - boxTop, 6).fill(TINT)
  file.font('Helvetica-Bold').fontSize(11).fillColor(PRIMARY).text(title, 62, boxTop + 12)
  file.font('Helvetica').fontSize(9).fillColor(MUTED).text(text, 62, boxTop + 31, { width: 480 })
  file.y = fits ? boxTop + boxHeight + 14 : file.y + 14
}

// Aviso de confidencialidad al pie del informe, el informe clínico y el expediente completo: son
// los tres documentos del historial clínico nutricio, por eso citan la NOM-004-SSA3-2012 (expediente
// clínico) y la Ley Federal de Protección de Datos Personales en Posesión de los Particulares. El
// PDF de alimentación (menú semanal) no lleva este aviso porque no es el expediente clínico.
const CONFIDENTIALITY_NOTICE = 'Documento del expediente clínico (NOM-004-SSA3-2012). Contiene datos personales sensibles protegidos por la Ley Federal de Protección de Datos Personales en Posesión de los Particulares: uso exclusivo del paciente y del personal de salud autorizado.'
const drawConfidentialityNotice = (file) => { file.moveDown(0.3); file.font('Helvetica').fillColor(FAINT).fontSize(7).text(CONFIDENTIALITY_NOTICE, 48, file.y, { width: 516, align: 'center' }) }

function drawConsultationReport(file, document, practice, user, logoBuffer) {
  drawDocumentBrand(file, 'RESUMEN DE CONSULTA NUTRICIONAL', practice, logoBuffer)
  file.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('Informe de consulta')
  file.font('Helvetica').fontSize(10).fillColor(MUTED).text(`Paciente: ${document.patient.firstName} ${document.patient.lastName}`)
  file.text(`Generado: ${formatDateOnly(new Date(), practice?.timeZone || 'America/Mexico_City')}`)
  file.moveDown()

  const consultation = document.consultation
  const sections = consultation?.sections || []
  const payloadOf = (key) => sections.find((section) => section.sectionKey === key)?.payload || {}
  // Queries return measurements oldest-first; the PDF must show the LATEST one captured for the
  // consultation, not the first (stale) row.
  const measurement = [...(consultation?.measurements || [])].sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt))[0]
  const diagnoses = consultation?.diagnoses || []

  // Summary box showing the real reason/objective when the expediente has them, not generic text.
  const summary = payloadOf('summary')
  const reason = summary?.reason || summary?.['Motivo de consulta']
  const goal = summary?.goal || summary?.Objetivo
  const summaryLine = reason || goal
    ? [reason && `Motivo: ${reason}`, goal && `Objetivo: ${goal}`].filter(Boolean).join('   ·   ')
    : 'Documento generado desde la valoración clínica de Milpa · Atención Integral.'
  drawSummaryBox(file, 'Resumen de la consulta', summaryLine)

  let sectionIndex = 0
  const title = (text) => { sectionIndex += 1; drawSectionTitle(file, sectionIndex, text) }

  title('Antecedentes y clínico')
  drawFieldList(file, { ...payloadOf('general'), ...payloadOf('clinical') }, { skip: ['Notas clínicas', 'Notas de antecedentes'], empty: 'Sin antecedentes registrados.' })

  title('Antropometría')
  // Sólo las medidas capturadas: las vacías salían como "Talla — cm · % grasa —%".
  const measured = measurement ? [measurement.weightKg != null && `Peso ${measurement.weightKg} kg`, measurement.heightCm != null && `Talla ${measurement.heightCm} cm`, measurement.waistCm != null && `Cintura ${measurement.waistCm} cm`, measurement.hipCm != null && `Cadera ${measurement.hipCm} cm`, measurement.bodyFatPercent != null && `% grasa ${measurement.bodyFatPercent}%`].filter(Boolean) : []
  if (measured.length) drawFieldRow(file, 'Medición más reciente', measured.join(' · '))
  drawFieldList(file, payloadOf('anthropometric'), { skip: ['Peso (kg)', 'Talla (cm)', 'IMC calculado'], empty: measured.length ? null : 'Sin mediciones registradas.' })

  title('Diagnóstico nutricio')
  if (diagnoses.length) for (const d of diagnoses) drawLineText(file, diagnosisLine(d))
  else drawLineText(file, 'Sin diagnóstico registrado.', FAINT)

  title('Tratamiento')
  drawFieldList(file, payloadOf('treatment'), { empty: 'Sin recomendaciones registradas.' })
  file.moveDown(0.6)

  // Explicit width: pdfkit persists the last text() box, so a bare { align: 'center' } would pin
  // the footer to whatever width/x the previous line used (see the menu footer fix).
  file.font('Helvetica').fontSize(9).fillColor(FAINT).text(signatureFor(user, practice), 48, file.y, { width: 516, align: 'center' })
  drawConfidentialityNotice(file)
}

const EXPORT_SECTION_KEYS = [
  ['summary', 'Resumen'],
  ['anthropometric', 'Antropometría'],
  ['biochemical', 'Bioquímico'],
  ['clinical', 'Clínico'],
  ['dietary', 'Dietético'],
  ['lifestyle', 'Estilo de vida'],
  ['sociocultural', 'Sociocultural'],
  ['diagnosis', 'Diagnóstico nutricio'],
  ['treatment', 'Tratamiento'],
  ['monitoring', 'Monitoreo'],
  ['notes', 'Notas'],
]

function drawConsultationExport(file, document, practice, user, logoBuffer) {
  const tz = practice?.timeZone
  const patient = document.patient
  const consultation = document.consultation
  const professional = consultation?.nutritionist || user
  drawDocumentBrand(file, 'EXPEDIENTE CLÍNICO NUTRICIO', practice, logoBuffer)
  // Datos del establecimiento (NOM-004-SSA3-2012, 5.2.1): tipo, nombre y domicilio.
  file.font('Helvetica').fontSize(8).fillColor(MUTED).text([practice?.establishmentType || 'Consultorio de nutrición', practice?.name, practice?.address || 'Domicilio no registrado'].filter(Boolean).join(' · '), 48, file.y, { width: 516 })
  file.moveDown(0.6)
  file.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('Expediente clínico nutricio', 48, file.y)
  file.moveDown(0.5)

  const at = consultation?.startedAt || consultation?.createdAt
  const age = ageAt(patient.birthDate, at, tz)
  // Ficha de identificación (5.2.3 y 5.9): nombre, sexo, edad, domicilio y número de expediente.
  drawInfoGrid(file, 'Ficha de identificación', [
    ['Nombre completo', `${patient.firstName} ${patient.lastName}`],
    ['Número de expediente', formatRecordNumber(patient.recordNumber)],
    ['Sexo', patient.sex || 'No registrado'],
    ['Edad', age != null ? `${age} años (nacimiento: ${formatDateOnly(patient.birthDate)})` : 'No registrada'],
    ['Domicilio', patient.address || 'No registrado'],
    ['CURP', patient.curp || 'No registrada'],
    ['Ocupación', patient.occupation || 'No registrada'],
    ['Consentimiento de datos sensibles', patient.consentDataAt ? `Otorgado el ${formatDateOnly(patient.consentDataAt, tz)}` : 'No registrado'],
  ])
  // Datos de la atención (5.10): fecha y hora, y nombre completo y cédula de quien la elabora.
  const closed = consultation?.status === 'COMPLETED'
  drawInfoGrid(file, 'Datos de la consulta', [
    ['Inicio', formatDateTime(at, tz)],
    ['Cierre', closed ? formatDateTime(consultation.completedAt, tz) : 'Consulta en curso (documento preliminar)'],
    ['Profesional responsable', [professional?.name, professional?.specialty].filter(Boolean).join(' · ') || '—'],
    ['Cédula profesional', professional?.licenseNumber || 'No registrada'],
  ])

  const sections = consultation?.sections || []
  const payloadOf = (key) => sections.find((section) => section.sectionKey === key)?.payload || {}
  const expand = (payload) => Object.fromEntries(Object.entries(payload || {}).map(([key, value]) => [expandLabel(key), value]))
  const measurement = [...(consultation?.measurements || [])].sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt))[0]
  const diagnoses = consultation?.diagnoses || []

  const summary = payloadOf('summary')
  const reason = summary?.reason || summary?.['Motivo de consulta']
  const goal = summary?.goal || summary?.Objetivo
  if (reason || goal) drawSummaryBox(file, 'Motivo de la consulta', [reason && `Motivo: ${reason}`, goal && `Objetivo: ${goal}`].filter(Boolean).join('   ·   '))

  let sectionIndex = 0
  for (const [key, label] of EXPORT_SECTION_KEYS) {
    sectionIndex += 1
    drawSectionTitle(file, sectionIndex, label)
    if (key === 'anthropometric') {
      const parts = [
        measurement?.weightKg != null && `Peso: ${measurement.weightKg} kilogramos`,
        measurement?.heightCm != null && `Talla: ${measurement.heightCm} centímetros`,
        measurement?.waistCm != null && `Cintura: ${measurement.waistCm} centímetros`,
        measurement?.hipCm != null && `Cadera: ${measurement.hipCm} centímetros`,
        measurement?.abdomenCm != null && `Abdomen: ${measurement.abdomenCm} centímetros`,
        measurement?.bodyFatPercent != null && `Grasa corporal: ${measurement.bodyFatPercent} %`,
        measurement?.muscleMassKg != null && `Masa muscular: ${measurement.muscleMassKg} kilogramos`,
        measurement?.method && `Método: ${measurement.method}`,
      ].filter(Boolean)
      if (parts.length) drawFieldRow(file, `Medición registrada el ${formatDateTime(measurement.measuredAt, tz)}`, parts.join(' · '))
      drawFieldList(file, expand(payloadOf('anthropometric')), { skip: ['Peso (kg)', 'Talla (cm)', 'Índice de masa corporal (IMC) calculado', 'Fotos antropométricas'], empty: parts.length ? null : 'Sin mediciones registradas.' })
    } else if (key === 'biochemical') {
      const labs = Array.isArray(payloadOf('biochemical')['Estudios']) ? payloadOf('biochemical')['Estudios'] : []
      for (const lab of labs) drawLineText(file, `${lab.name}: ${lab.value ?? '—'} ${lab.unit || ''}${lab.range ? ` (referencia ${lab.range})` : ''}${lab.status ? ` · ${lab.status}` : ''}`)
      drawFieldList(file, expand(payloadOf('biochemical')), { skip: ['Estudios'], empty: labs.length ? null : 'Sin estudios registrados.' })
    } else if (key === 'diagnosis') {
      if (diagnoses.length) for (const d of diagnoses) drawLineText(file, diagnosisLine(d))
      else drawLineText(file, 'Sin diagnóstico registrado.', FAINT)
      drawFieldList(file, expand(payloadOf(key)), { empty: null })
    } else if (key === 'dietary') {
      // El recordatorio de 24 h es un objeto anidado: como campo suelto se imprimía crudo
      // ("meals: key: breakfast · time: 08:00 · items: uid: … nutrition: kcal: 160…"). Va como tabla.
      const recall = payloadOf(key)['Recordatorio 24 h']
      const hasRecall = recallHasData(recall)
      drawFieldList(file, expand(payloadOf(key)), { skip: ['Recordatorio 24 h'], empty: hasRecall ? null : 'Sin datos registrados.' })
      if (hasRecall) { file.moveDown(0.3); file.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Recordatorio de 24 horas', 48, file.y, { width: 516 }); drawRecallTable(file, recall) }
    } else {
      // El motivo y el objetivo ya van en el recuadro de arriba: no se repiten en "Resumen".
      drawFieldList(file, expand(payloadOf(key)), { skip: key === 'summary' && (reason || goal) ? ['Motivo de consulta', 'Objetivo', 'reason', 'goal'] : [], empty: key === 'summary' && (reason || goal) ? 'Motivo y objetivo en el recuadro de arriba.' : 'Sin datos registrados.' })
    }
    file.moveDown(0.4)
  }

  // Notas aclaratorias: el expediente no se enmienda en silencio (5.11). Cada reapertura con su
  // motivo y cada sección corregida después del cierre, con fecha, hora y quién lo hizo.
  sectionIndex += 1
  drawSectionTitle(file, sectionIndex, 'Registro de correcciones')
  const trail = (document.auditTrail || []).filter((event) => event.action === 'reopened' || event.metadata?.afterClose || ((event.entity === 'Diagnosis' || event.entity === 'Measurement' || event.entity === 'LabAttachment') && consultation?.completedAt && new Date(event.createdAt) > new Date(consultation.completedAt)))
  const sectionNames = Object.fromEntries(EXPORT_SECTION_KEYS)
  const describe = (event) => {
    if (event.action === 'reopened') return `Consulta reabierta para corrección. Motivo: ${event.metadata?.reason || 'no indicado'}`
    if (event.entity === 'ClinicalSection') return `Se corrigió la sección «${sectionNames[event.metadata?.sectionKey] || event.metadata?.sectionKey}» (la versión anterior se conserva en la bitácora).`
    if (event.entity === 'Diagnosis') return `Diagnóstico ${event.action === 'deleted' ? 'eliminado' : event.action === 'created' ? 'agregado' : 'modificado'}: ${event.metadata?.problem || ''}`
    if (event.entity === 'Measurement') return 'Medición antropométrica corregida.'
    return `PDF de laboratorio ${event.action === 'deleted' ? 'retirado' : 'agregado'}: ${event.metadata?.fileName || ''}`
  }
  if (!trail.length) drawLineText(file, closed ? 'Sin correcciones posteriores al cierre de la consulta.' : 'La consulta sigue en curso: aún no hay cierre que corregir.', FAINT)
  for (const event of trail) drawFieldRow(file, `${formatDateTime(event.createdAt, tz)} · ${event.user?.name || 'Usuario'}`, describe(event))

  // Firma de quien elabora (5.10): nombre completo, cédula y espacio para la firma autógrafa.
  if (file.y > file.page.height - file.page.margins.bottom - 110) file.addPage()
  file.moveDown(2.2)
  const lineY = file.y + 24
  file.moveTo(182, lineY).lineTo(430, lineY).strokeColor(INK).lineWidth(0.7).stroke()
  file.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(professional?.name || practice?.name || '', 48, lineY + 6, { width: 516, align: 'center' })
  file.font('Helvetica').fontSize(8).fillColor(MUTED).text([professional?.specialty, professional?.licenseNumber ? `Cédula profesional ${professional.licenseNumber}` : 'Cédula profesional no registrada'].filter(Boolean).join(' · '), 48, file.y, { width: 516, align: 'center' })
  file.text('Nombre y firma de quien elabora', 48, file.y, { width: 516, align: 'center' })
  drawConfidentialityNotice(file)
}

// ── Informe clínico (profesional) ────────────────────────────────────────────────────────────
// Presenta los datos del expediente con formato interpretable por otros profesionales: tablas de
// laboratorio (resultado/unidad/referencia/interpretación), recordatorio 24 h con totales y las
// secciones clínicas. No sustituye al informe del paciente; es el documento de derivación.
const SEX_TEXT = { Hombre: 'Hombre', Mujer: 'Mujer', female: 'Mujer', male: 'Hombre', F: 'Mujer', M: 'Hombre' }
const truthyEntry = ([, value]) => value !== undefined && value !== null && value !== '' && value !== false

function collectRecall(recall) {
  const totals = {}
  const meals = []
  for (const meal of recall?.meals || []) {
    let kcal = 0
    for (const item of meal.items || []) {
      const factor = (Number(item.grams) || 0) / 100
      for (const [key, value] of Object.entries(item.nutrition || {})) {
        if (typeof value !== 'number') continue
        totals[key] = (totals[key] || 0) + value * factor
        if (key === 'kcal') kcal += value * factor
      }
    }
    meals.push({ label: meal.label, note: meal.note, kcal: Math.round(kcal), items: (meal.items || []).map((item) => ({ name: item.name, grams: item.grams })) })
  }
  for (const key of Object.keys(totals)) totals[key] = Math.round(totals[key] * 10) / 10
  return { meals, totals }
}

function drawClinicalReport(file, document, practice, user, logoBuffer) {
  drawDocumentBrand(file, 'INFORME CLÍNICO NUTRICIO', practice, logoBuffer)
  const patient = document.patient
  const consultation = document.consultation
  const sections = consultation?.sections || []
  const payloadOf = (key) => sections.find((section) => section.sectionKey === key)?.payload || {}
  const measurement = [...(consultation?.measurements || [])].sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt))[0]
  const diagnoses = consultation?.diagnoses || []

  file.font('Helvetica-Bold').fontSize(18).fillColor(INK).text('Informe clínico nutricio', 48, file.y, { width: 516 })
  const age = ageAt(patient.birthDate, null, practice?.timeZone)
  file.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Paciente: ${patient.firstName} ${patient.lastName}${age != null ? ` · ${age} años` : ''}${patient.sex ? ` · ${SEX_TEXT[patient.sex] || patient.sex}` : ''}`, 48, file.y, { width: 516 })
  file.text(`Generado: ${formatDateOnly(new Date(), practice?.timeZone || 'America/Mexico_City')}`, 48, file.y, { width: 516 })

  let index = 0
  const title = (text) => { index += 1; drawSectionTitle(file, index, text) }
  const line = (text) => drawLineText(file, text)

  title('Identificación del paciente')
  line(`Nombre: ${patient.firstName} ${patient.lastName}`)
  if (patient.birthDate) line(`Fecha de nacimiento: ${new Date(patient.birthDate).toLocaleDateString('es-MX', { timeZone: 'UTC' })}`)
  if (age != null) line(`Edad: ${age} años`)
  if (patient.sex) line(`Sexo: ${SEX_TEXT[patient.sex] || patient.sex}`)
  if (patient.occupation) line(`Ocupación: ${patient.occupation}`)
  if (patient.phone || patient.email) line(`Contacto: ${[patient.phone, patient.email].filter(Boolean).join(' · ')}`)

  const summary = payloadOf('summary')
  title('Motivo y objetivo')
  line(`Motivo de consulta: ${summary['Motivo de consulta'] || '—'}`)
  line(`Objetivo: ${summary.Objetivo || '—'}`)

  title('Antropometría')
  if (measurement) {
    const bmi = measurement.weightKg && measurement.heightCm ? measurement.weightKg / ((measurement.heightCm / 100) ** 2) : null
    // Sólo las medidas capturadas: las vacías salían como "Talla: — cm".
    const basic = [measurement.weightKg != null && `Peso: ${measurement.weightKg} kg`, measurement.heightCm != null && `Talla: ${measurement.heightCm} cm`, bmi && `IMC: ${bmi.toFixed(1)}`].filter(Boolean)
    if (basic.length) line(basic.join(' · '))
    const extra = [measurement.waistCm != null && `Cintura: ${measurement.waistCm} cm`, measurement.hipCm != null && `Cadera: ${measurement.hipCm} cm`, measurement.abdomenCm != null && `Abdomen: ${measurement.abdomenCm} cm`, measurement.bodyFatPercent != null && `% grasa: ${measurement.bodyFatPercent}%`, measurement.muscleMassKg != null && `Masa muscular: ${measurement.muscleMassKg} kg`].filter(Boolean)
    if (extra.length) line(extra.join(' · '))
  } else line('Sin mediciones registradas.')
  drawFieldList(file, payloadOf('anthropometric'), { skip: ['Peso (kg)', 'Talla (cm)', 'IMC calculado'], empty: null })

  const labs = Array.isArray(payloadOf('biochemical')['Estudios']) ? payloadOf('biochemical')['Estudios'] : []
  title('Bioquímico')
  if (labs.length) {
    drawLabTable(file, labs)
  } else line('Sin estudios de laboratorio registrados.')
  drawFieldList(file, payloadOf('biochemical'), { skip: ['Estudios'], empty: null })

  title('Clínico')
  drawFieldList(file, payloadOf('clinical'), { empty: 'Sin datos clínicos registrados.' })

  title('Dietético')
  const hadDietaryNotes = drawFieldList(file, payloadOf('dietary'), { skip: ['Recordatorio 24 h'], empty: null })
  const recall = payloadOf('dietary')['Recordatorio 24 h']
  if (recallHasData(recall)) { file.moveDown(0.3); file.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Recordatorio de 24 horas', 48, file.y, { width: 516 }); drawRecallTable(file, recall) }
  else if (!hadDietaryNotes) line('Sin datos dietéticos registrados.')

  title('Estilo de vida')
  drawFieldList(file, payloadOf('lifestyle'), { empty: 'Sin datos registrados.' })

  title('Sociocultural')
  drawFieldList(file, payloadOf('sociocultural'), { empty: 'Sin datos registrados.' })

  title('Diagnóstico nutricio')
  if (diagnoses.length) for (const d of diagnoses) line(diagnosisLine(d))
  else line('Sin diagnóstico registrado.')

  title('Tratamiento e intervención')
  drawFieldList(file, payloadOf('treatment'), { empty: 'Sin recomendaciones registradas.' })

  title('Monitoreo y notas')
  drawFieldList(file, { ...payloadOf('monitoring'), ...payloadOf('notes') }, { empty: 'Sin datos registrados.' })

  file.moveDown(0.8)
  file.font('Helvetica').fontSize(9).fillColor(FAINT).text(`Elaboró: ${signatureFor(user, practice)}`, 48, file.y, { width: 516, align: 'center' })
  file.font('Helvetica').fontSize(7).fillColor(FAINT).text('Documento clínico de apoyo. Las estimaciones antropométricas son orientativas y no sustituyen al juicio profesional.', 48, file.y, { width: 516, align: 'center' })
  drawConfidentialityNotice(file)
}

function drawLabTable(file, labs) {
  const x = { name: 48, value: 220, unit: 305, range: 370, status: 460 }
  // Todas las columnas en la misma `y` fija: con `file.y` cada encabezado bajaba un renglón tras el
  // anterior (escalera) y, en las filas, un nombre de 3 renglones se encimaba con la fila siguiente.
  // La fila salta de hoja completa: antes cada columna caía en una página distinta.
  const limit = () => file.page.height - file.page.margins.bottom
  const header = () => {
    const y = file.y
    file.font('Helvetica-Bold').fontSize(8).fillColor(FAINT)
    file.text('Estudio', x.name, y, { width: 165 })
    file.text('Resultado', x.value, y, { width: 80 })
    file.text('Unidad', x.unit, y, { width: 60 })
    file.text('Referencia', x.range, y, { width: 85 })
    file.text('Interpretación', x.status, y, { width: 100 })
    file.y = y + 14
  }
  header()
  for (const lab of labs) {
    const cells = [[String(lab.name || '—'), x.name, 165], [String(lab.value ?? '—'), x.value, 80], [String(lab.unit || ''), x.unit, 60], [String(lab.range || '—'), x.range, 85]]
    file.font('Helvetica').fontSize(9)
    const rowH = Math.max(...cells.map(([text, , width]) => file.heightOfString(text, { width })), file.font('Helvetica-Bold').heightOfString(String(lab.status || '—'), { width: 100 }))
    if (file.y + rowH > limit()) { file.addPage(); header() }
    const y = file.y
    const tone = lab.status === 'Normal' ? SUCCESS : lab.status === 'Elevado' || lab.status === 'Bajo' ? DANGER : FAINT
    file.font('Helvetica').fontSize(9).fillColor(MUTED)
    for (const [text, left, width] of cells) file.text(text, left, y, { width })
    file.font('Helvetica-Bold').fillColor(tone).text(String(lab.status || '—'), x.status, y, { width: 100 })
    file.y = y + rowH + 6
    file.moveTo(48, file.y - 3).lineTo(564, file.y - 3).strokeColor('#eeeeee').stroke()
  }
}

// El recordatorio se guarda con sus cinco tiempos de comida aunque estén vacíos: sólo cuenta si
// alguno tiene alimentos o descripción (si no, el PDF listaba "Desayuno", "Comida"… sin nada).
const recallHasData = (recall) => (recall?.meals || []).some((meal) => meal.items?.length || meal.note)

function drawRecallTable(file, recall) {
  const { meals, totals } = collectRecall(recall)
  for (const meal of meals) {
    if (!meal.items.length && !meal.note) continue
    file.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(`${meal.label}${meal.items.length ? ` · ${meal.kcal} kcal` : ''}`, 48, file.y, { width: 516 })
    if (meal.note) file.font('Helvetica').fontSize(8).fillColor(FAINT).text(meal.note, 56, file.y, { width: 508 })
    for (const item of meal.items) file.font('Helvetica').fontSize(8).fillColor(MUTED).text(`• ${item.name}: ${item.grams} g`, 56, file.y, { width: 508 })
    file.moveDown(0.3)
  }
  if (totals.kcal != null) file.font('Helvetica-Bold').fontSize(9).fillColor(PRIMARY).text(`Totales del día: ${totals.kcal} kcal · Proteína ${totals.protein ?? 0} g · Carbohidratos ${totals.carbs ?? 0} g · Grasas ${totals.fat ?? 0} g`, 48, file.y, { width: 516 })
}

// Menú del plan con todo lo que el PDF dibuja de cada receta (foto, ingredientes, equivalentes).
// Publicado: se lee el snapshot congelado; los planes publicados antes de que el snapshot guardara
// esos campos, y los borradores (vista previa), se completan con la receta viva.
async function loadPlanMenu(plan) {
  const snapshot = Array.isArray(plan.menuSnapshot) ? plan.menuSnapshot : []
  // Un plan que se publicó conserva su menú congelado aunque después se cancele.
  const published = Boolean(plan.publishedAt) || plan.status === 'PUBLISHED'
  if (published && snapshot.length && snapshot.every((entry) => Array.isArray(entry.ingredients))) {
    // La foto es lo único que no se congela: si la receta recibe (o cambia) su foto después de
    // publicar, el plan la muestra al regenerarse.
    const photos = await prisma.recipe.findMany({ where: { id: { in: snapshot.map((entry) => entry.recipeId).filter(Boolean) } }, select: { id: true, imageFile: true } })
    return snapshot.map((entry) => ({ ...entry, imageFile: photos.find((recipe) => recipe.id === entry.recipeId)?.imageFile || entry.imageFile || null }))
  }
  const recipeInclude = { ingredients: { include: { ingredient: true } } }
  if (published && snapshot.length) {
    const recipes = await prisma.recipe.findMany({ where: { id: { in: snapshot.map((entry) => entry.recipeId).filter(Boolean) } }, include: recipeInclude })
    const live = buildMenuSnapshot(snapshot.map((entry) => ({ ...entry, recipe: recipes.find((recipe) => recipe.id === entry.recipeId) || null })))
    // El nombre y las kcal congelados mandan sobre los de la receta viva.
    return applyRecipeAdjustments(live.map((entry) => { const frozen = snapshot.find((item) => item.dayOfWeek === entry.dayOfWeek && item.mealType === entry.mealType); return { ...entry, recipeName: frozen?.recipeName || entry.recipeName, kcal: frozen?.kcal ?? entry.kcal } }), plan.recipeAdjustments)
  }
  // Borrador: igual que al publicar, sin las recetas archivadas (el Constructor no las muestra).
  const mealSlots = await prisma.mealSlot.findMany({ where: { planId: plan.id }, include: { recipe: { include: recipeInclude } } })
  return applyRecipeAdjustments(buildMenuSnapshot(mealSlots.filter((slot) => slot.recipe?.status !== 'ARCHIVED')), plan.recipeAdjustments)
}

// Encabezado y pie del plan: quién es la paciente, su medición más reciente y los datos de la
// nutrióloga que lo firma.
async function buildPlanHeader(patient, practice, user) {
  const measurement = await prisma.measurement.findFirst({ where: { patientId: patient.id, weightKg: { not: null } }, orderBy: { measuredAt: 'desc' } })
  return {
    patientName: `${patient.firstName} ${patient.lastName}`.trim(),
    nutritionistName: user?.name || practice?.name || '',
    licenseNumber: user?.licenseNumber || null,
    weightKg: measurement?.weightKg != null ? Number(measurement.weightKg) : null,
    bodyFatPercent: measurement?.bodyFatPercent != null ? Number(measurement.bodyFatPercent) : null,
    muscleMassKg: measurement?.muscleMassKg != null ? Number(measurement.muscleMassKg) : null,
    contact: [{ kind: 'phone', text: user?.phone }, { kind: 'address', text: practice?.address }, { kind: 'email', text: user?.email }].filter((item) => item.text),
  }
}

// Reúne lo que necesita drawNutritionPlan: lo asíncrono (archivos de fotos, medición más reciente)
// se resuelve aquí porque el dibujo con pdfkit es síncrono.
async function loadNutritionPlanData(plan, patient, practice, user, logoBuffer, themeOverride = null) {
  const menu = await loadPlanMenu(plan)
  const imageDirectory = recipeImageDir()
  const images = new Map()
  for (const imageFile of new Set(menu.map((entry) => entry.imageFile).filter(Boolean))) {
    // Mismo patrón estricto que la ruta pública de fotos: el nombre viene de la base, pero no debe
    // poder salir de la carpeta.
    if (!/^[a-z0-9][a-z0-9-]*\.jpg$/.test(imageFile)) continue
    try { images.set(imageFile, await readFile(path.join(imageDirectory, imageFile))) } catch { /* foto faltante: la celda sale sin ella */ }
  }
  // Publicado: el encabezado es el que se congeló al publicar (los planes publicados antes de que
  // existiera ese snapshot, y los borradores, lo arman con los datos de hoy).
  const frozenHeader = plan.publishedAt && plan.headerSnapshot && typeof plan.headerSnapshot === 'object' ? plan.headerSnapshot : null
  const header = frozenHeader || await buildPlanHeader(patient, practice, user)
  return {
    ...header,
    menu,
    mealTimes: plan.mealTimes,
    equivalents: plan.equivalents,
    mealLabels: plan.mealLabels,
    menus: plan.menus,
    mealNotes: plan.mealNotes,
    recommendations: plan.recommendations,
    hydrationNote: plan.hydrationNote,
    logo: logoBuffer,
    images,
    theme: normalizePdfTheme(themeOverride || practice?.pdfTheme),
  }
}

async function loadPracticeBranding(practiceId, userId) {
  const [practice, user] = await Promise.all([
    prisma.practice.findUnique({ where: { id: practiceId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ])
  let logoBuffer = null
  if (practice?.logoUrl) {
    try { logoBuffer = await readFile(path.join(path.resolve(process.env.LOGO_STORAGE_PATH || './storage/logos'), practice.logoUrl)) }
    catch { logoBuffer = null }
  }
  return { practice, user, logoBuffer }
}

// El plan de alimentación va en carta apaisada y con margen 0: su tabla se posiciona a mano y parte
// las filas entre hojas (ver server/domain/planPdf.js).
function renderNutritionPlanPdf(planData) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const file = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 0 })
    file.on('data', (chunk) => chunks.push(chunk))
    file.on('end', () => resolve(Buffer.concat(chunks)))
    file.on('error', reject)
    drawNutritionPlan(file, planData)
    file.end()
  })
}

// Genera (o regenera) el archivo PDF de un documento y lo deja guardado con una versión nueva.
// Datos que los documentos clínicos necesitan además de la consulta:
//  - Los antecedentes permanentes del paciente (heredofamiliares, alergias, cirugías…) viven fuera de
//    la consulta (PatientSection, ver src/lib/patientFields.js) y ningún PDF los incluía; la
//    NOM-004-SSA3-2012 (6.1.1) los pide en la historia clínica. Se integran a su sección.
//  - El número de expediente y la bitácora de reaperturas y correcciones de esa consulta.
async function prepareClinicalDocument(document, practiceId) {
  document.patient = await ensureRecordNumber(document.patient)
  const consultation = document.consultation
  if (!consultation) return
  const patientSections = await prisma.patientSection.findMany({ where: { patientId: document.patientId } })
  const sections = [...(consultation.sections || [])]
  for (const patientSection of patientSections) {
    const index = sections.findIndex((section) => section.sectionKey === patientSection.sectionKey)
    const merged = { ...(index >= 0 ? sections[index].payload : {}), ...(patientSection.payload || {}) }
    if (index >= 0) sections[index] = { ...sections[index], payload: merged }
    else sections.push({ sectionKey: patientSection.sectionKey, payload: merged })
  }
  consultation.sections = sections
  document.auditTrail = await prisma.auditEvent.findMany({
    where: { practiceId, OR: [{ entity: 'Consultation', entityId: consultation.id }, { metadata: { path: ['consultationId'], equals: consultation.id } }] },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

// Pie de cada hoja de los documentos clínicos: identifica al paciente (NOM-004-SSA3-2012, 5.9), la
// hoja ("Página X de Y": un expediente impreso al que le falte una hoja se nota) y el documento
// (folio y versión, con la fecha y hora de emisión) para poder rastrearlo en una auditoría.
function drawClinicalFooters(file, document, practice, user) {
  const range = file.bufferedPageRange()
  const issued = formatDateTime(new Date(), practice?.timeZone)
  const folio = `${String(document.id).slice(0, 8).toUpperCase()}-v${(document.version || 0) + 1}`
  const left = `Expediente ${formatRecordNumber(document.patient?.recordNumber)} · ${document.patient?.firstName || ''} ${document.patient?.lastName || ''}`.trim()
  for (let i = range.start; i < range.start + range.count; i++) {
    file.switchToPage(i)
    const bottom = file.page.margins.bottom
    file.page.margins.bottom = 0
    const y = file.page.height - 30
    file.moveTo(48, y - 6).lineTo(564, y - 6).strokeColor(TINT_LINE).lineWidth(0.5).stroke()
    file.font('Helvetica').fontSize(7).fillColor(FAINT)
    file.text(left, 48, y, { width: 200, height: 9, ellipsis: true })
    file.text(`Página ${i - range.start + 1} de ${range.count}`, 248, y, { width: 82, align: 'center', lineBreak: false })
    file.text(`Emitido ${issued}${user?.name ? ` por ${user.name}` : ''} · Folio ${folio}`, 330, y, { width: 234, height: 9, align: 'right', ellipsis: true })
    file.page.margins.bottom = bottom
  }
}

const formatRecordNumber = (value) => (value ? `N.º ${String(value).padStart(5, '0')}` : 'sin número')
// Fecha y hora en la zona del consultorio: son marcas de tiempo reales (no horas "de pared").
const formatDateTime = (value, timeZone) => (value ? new Date(value).toLocaleString('es-MX', { timeZone: timeZone || 'America/Mexico_City', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '—')
const formatDateOnly = (value, timeZone) => (value ? new Date(value).toLocaleDateString('es-MX', { timeZone: timeZone || 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
// `at` es una marca de tiempo real: se toma su día en la zona del consultorio (en UTC, una consulta
// por la tarde en México ya caía en el día siguiente y la edad subía un año antes del cumpleaños).
// La fecha de nacimiento es DATE (medianoche UTC), por eso se lee con getters UTC.
const ageAt = (birthDate, at, timeZone) => {
  if (!birthDate) return null
  const birth = new Date(birthDate); const when = practiceWallClockAt(at ? new Date(at) : new Date(), timeZone)
  let age = when.getUTCFullYear() - birth.getUTCFullYear()
  const beforeBirthday = when.getUTCMonth() < birth.getUTCMonth() || (when.getUTCMonth() === birth.getUTCMonth() && when.getUTCDate() < birth.getUTCDate())
  if (beforeBirthday) age -= 1
  return age >= 0 ? age : null
}

// Sin abreviaturas en el expediente (NOM-004-SSA3-2012, 5.11): las siglas de los campos se escriben
// completas la primera vez, con la sigla entre paréntesis.
const LABEL_EXPANSIONS = [
  [/\bIMC\b/g, 'Índice de masa corporal (IMC)'], [/\bICC\b/g, 'Índice cintura-cadera (ICC)'], [/\bICT\b/g, 'Índice cintura-talla (ICT)'],
  [/\bTMB\b/g, 'Tasa metabólica basal (TMB)'], [/\bGET\b/g, 'Gasto energético total (GET)'], [/\bGEB\b/g, 'Gasto energético basal (GEB)'],
  [/\bPES\b/g, 'Problema, etiología y signos (PES)'], [/\bR24H?\b/g, 'Recordatorio de 24 horas'], [/\bKg\b/g, 'Kilogramos'],
]
const expandLabel = (label) => LABEL_EXPANSIONS.reduce((text, [pattern, full]) => text.replace(pattern, full), String(label))

// Cajas de dos columnas "etiqueta / valor" (ficha de identificación, datos de la consulta).
function drawInfoGrid(file, title, rows) {
  if (file.y > file.page.height - file.page.margins.bottom - 120) file.addPage()
  const top = file.y; const colW = 258; const pad = 10
  file.font('Helvetica-Bold').fontSize(8).fillColor(PRIMARY).text(title.toUpperCase(), 48, top, { width: 516, characterSpacing: 0.6 })
  let y = top + 14
  for (let i = 0; i < rows.length; i += 2) {
    const pair = rows.slice(i, i + 2)
    // Se mide con la misma fuente con que se dibuja el valor (negritas, más ancha): medido en
    // regular, un domicilio largo ocupaba más renglones que la caja y se encimaba con la fila siguiente.
    file.font('Helvetica-Bold').fontSize(9)
    const heights = pair.map(([label, value]) => file.heightOfString(String(value ?? '—'), { width: colW - pad * 2 }) + 16)
    const h = Math.max(...heights, 24)
    if (y + h > file.page.height - file.page.margins.bottom) { file.addPage(); y = file.y }
    pair.forEach(([label, value], j) => {
      const x = 48 + j * colW
      file.rect(x, y, colW - (j === 0 ? 4 : 0), h).fill(j === 0 && i % 4 === 0 ? TINT : '#F4F8F2')
      file.font('Helvetica').fontSize(7).fillColor(FAINT).text(label, x + pad, y + 4, { width: colW - pad * 2 })
      file.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(String(value ?? '—'), x + pad, y + 13, { width: colW - pad * 2 })
    })
    y += h + 4
  }
  file.y = y + 6
}

async function generateDocumentFile(documentId, practiceId, userId) {
  const document = await prisma.document.findFirst({ where: { id: documentId, patient: { practiceId } }, include: { patient: true, consultation: { include: { measurements: true, diagnoses: true, sections: true, nutritionist: { select: { name: true, specialty: true, licenseNumber: true } } } }, plan: true } })
  if (!document) return null
  const { practice, user, logoBuffer } = await loadPracticeBranding(practiceId, userId)
  let pdf
  if (document.type === 'nutrition_plan') {
    pdf = await renderNutritionPlanPdf(await loadNutritionPlanData(document.plan, document.patient, practice, user, logoBuffer))
  } else {
    await prepareClinicalDocument(document, practiceId)
    pdf = await new Promise((resolve, reject) => {
      const chunks = []
      // bufferPages: el pie con "Página X de Y" se escribe al final, cuando ya se sabe cuántas hay.
      const file = new PDFDocument({ size: 'LETTER', margin: 48, bufferPages: true })
      // Estos documentos usan Helvetica (sólo WinAnsi): "≥", "→" o un emoji capturados en el
      // expediente salían como basura. Se convierten al dibujar y al medir, para que las cajas midan
      // lo mismo que se imprime.
      for (const method of ['text', 'widthOfString', 'heightOfString']) {
        const original = file[method].bind(file)
        file[method] = (text, ...args) => original(typeof text === 'string' ? toWinAnsi(text) : text, ...args)
      }
      file.on('data', (chunk) => chunks.push(chunk))
      file.on('end', () => resolve(Buffer.concat(chunks)))
      file.on('error', reject)
      if (document.type === 'consultation_export') drawConsultationExport(file, document, practice, user, logoBuffer)
      else if (document.type === 'consultation_clinical') drawClinicalReport(file, document, practice, user, logoBuffer)
      else drawConsultationReport(file, document, practice, user, logoBuffer)
      drawClinicalFooters(file, document, practice, user)
      file.end()
    })
  }
  const directory = path.resolve(process.env.DOCUMENT_STORAGE_PATH || './storage/documents')
  await mkdir(directory, { recursive: true })
  // Sufijo único: dos generaciones concurrentes del mismo documento calculaban el mismo nombre y
  // se sobreescribían el archivo.
  const fileName = `${document.id}-v${document.version + 1}-${randomUUID().slice(0, 8)}.pdf`
  await writeFile(path.join(directory, fileName), pdf)
  const checksum = createHash('sha256').update(pdf).digest('hex')
  let generated
  try {
    generated = await prisma.document.update({ where: { id: document.id }, data: { generatedAt: new Date(), version: { increment: 1 }, checksum, storageKey: fileName } })
  } catch (error) {
    // No dejar el PDF recién escrito si el update falla.
    await unlink(path.join(directory, fileName)).catch(() => {})
    throw error
  }
  // Borra el PDF anterior (si lo había) para no acumular huérfanos al regenerar.
  if (document.storageKey && document.storageKey !== fileName) await unlink(path.join(directory, document.storageKey)).catch(() => {})
  return { ...generated, downloadUrl: `/api/v1/documents/${document.id}/download` }
}

// Vista previa del plan: el mismo PDF que se entrega, generado al vuelo y sin guardarse, para que
// la pantalla de Entrega muestre exactamente lo que recibirá la paciente — también en borrador.
app.get('/api/v1/plans/:planId/preview-pdf', async (request, reply) => {
  const practiceId = request.practiceId
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId } }, include: { patient: true } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  const { practice, user, logoBuffer } = await loadPracticeBranding(practiceId, request.userId)
  // `?theme=` (JSON) dibuja con un diseño que todavía no se guarda: la vista previa del editor.
  let themeOverride = null
  if (typeof request.query?.theme === 'string' && request.query.theme.length < 2000) { try { themeOverride = JSON.parse(request.query.theme) } catch { themeOverride = null } }
  let pdf
  try {
    pdf = await renderNutritionPlanPdf(await loadNutritionPlanData(plan, plan.patient, practice, user, logoBuffer, themeOverride))
  } catch (error) {
    request.log.error(error)
    return reply.code(500).send({ code: 'PDF_GENERATION_FAILED', message: 'No se pudo generar la vista previa del PDF.', fields: {} })
  }
  return reply.type('application/pdf').header('Content-Disposition', contentDisposition('inline', planFileName(`${plan.patient.firstName} ${plan.patient.lastName}`, plan.publishedAt || new Date()))).header('Cache-Control', 'no-store').send(pdf)
})

app.post('/api/v1/documents/:documentId/generate', async (request, reply) => {
  const generated = await generateDocumentFile(request.params.documentId, request.practiceId, request.userId)
  if (!generated) return reply.code(404).send({ code: 'DOCUMENT_NOT_FOUND', message: 'Documento no encontrado.', fields: {} })
  // Generar el PDF también es acceder a la información (lo arma completo con los datos del expediente).
  await logAccess(request, { patientId: generated.patientId, scope: 'document', action: 'generated', entity: 'Document', entityId: generated.id, metadata: { type: generated.type, version: generated.version, consultationId: generated.consultationId } })
  return generated
})

app.get('/api/v1/documents/:documentId/download', async (request, reply) => {
  const practiceId = request.practiceId
  const document = await prisma.document.findFirst({ where: { id: request.params.documentId, patient: { practiceId } }, include: { patient: true, plan: { select: { publishedAt: true } } } })
  if (!document?.storageKey) return reply.code(404).send({ code: 'DOCUMENT_FILE_NOT_FOUND', message: 'Genera el documento antes de descargarlo.', fields: {} })
  const filePath = path.resolve(process.env.DOCUMENT_STORAGE_PATH || './storage/documents', document.storageKey)
  try {
    const file = await readFile(filePath)
    // ?inline=1: el visor de la app (se abre en pantalla, no se guarda) y queda como "vio" en la bitácora.
    const inline = request.query?.inline === '1'
    await logAccess(request, { patientId: document.patientId, scope: 'document', action: inline ? 'viewed' : 'downloaded', entity: 'Document', entityId: document.id, metadata: { type: document.type, version: document.version, consultationId: document.consultationId } })
    return reply.type('application/pdf').header('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', documentFileName(document))).header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').send(file)
  } catch {
    return reply.code(404).send({ code: 'DOCUMENT_FILE_NOT_FOUND', message: 'El archivo del documento no está disponible.', fields: {} })
  }
})

// Nombre legible del archivo descargado (el guardado en disco sigue siendo <id>-v<n>.pdf).
const DOCUMENT_FILE_TITLES = { consultation_report: 'Informe de consulta', consultation_export: 'Expediente', consultation_clinical: 'Informe clínico' }
function documentFileName(document) {
  const patientName = document.patient ? `${document.patient.firstName} ${document.patient.lastName}` : ''
  if (document.type === 'nutrition_plan') return planFileName(patientName, document.plan?.publishedAt || document.generatedAt || new Date())
  return planFileName(patientName, document.generatedAt || new Date()).replace('Plan de alimentación', DOCUMENT_FILE_TITLES[document.type] || 'Documento')
}
// filename= lleva un respaldo sin acentos; filename*= el nombre completo en UTF-8 (RFC 6266).
const contentDisposition = (kind, fileName) => `${kind}; filename="${asciiFileName(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`

app.post('/api/v1/documents/:documentId/deliver', async (request, reply) => {
  const practiceId = request.practiceId
  const document = await prisma.document.findFirst({ where: { id: request.params.documentId, patient: { practiceId } } })
  if (!document) return reply.code(404).send({ code: 'DOCUMENT_NOT_FOUND', message: 'Documento no encontrado.', fields: {} })
  if (!document.generatedAt) return reply.code(409).send({ code: 'DOCUMENT_NOT_GENERATED', message: 'Genera el documento antes de entregarlo.', fields: {} })
  const delivered = await prisma.document.update({ where: { id: document.id }, data: { deliveredAt: new Date() }, include: DOCUMENT_LIST_INCLUDE })
  await logAudit(request, { action: 'delivered', entity: 'Document', entityId: document.id, patientId: document.patientId, metadata: { type: document.type } })
  return delivered
})

// Deshacer una entrega marcada por error (queda en la bitácora).
app.post('/api/v1/documents/:documentId/undeliver', async (request, reply) => {
  const document = await prisma.document.findFirst({ where: { id: request.params.documentId, patient: { practiceId: request.practiceId } } })
  if (!document) return reply.code(404).send({ code: 'DOCUMENT_NOT_FOUND', message: 'Documento no encontrado.', fields: {} })
  const updated = await prisma.document.update({ where: { id: document.id }, data: { deliveredAt: null }, include: DOCUMENT_LIST_INCLUDE })
  await logAudit(request, { action: 'undelivered', entity: 'Document', entityId: document.id, patientId: document.patientId, metadata: { type: document.type } })
  return updated
})

// ── Equivalencias: alimentos del libro SMAE 5ª ed. (tabla SmaeFood) ─────────────────────────────
const SMAE_NUTRIENT_KEYS = ['grossWeight', 'netWeight', 'kcal', 'protein', 'fat', 'carbs', 'satFat', 'monoFat', 'polyFat', 'cholesterol', 'sugar', 'fiber', 'vitA', 'vitC', 'folicAcid', 'calcium', 'iron', 'potassium', 'sodium', 'phosphorus', 'ethanol', 'gi', 'gl']

app.get('/api/v1/smae-foods/groups', async (request) => {
  const practiceId = request.practiceId
  const [groups, pending] = await Promise.all([
    prisma.smaeFood.groupBy({ by: ['group'], where: { practiceId }, _count: true }),
    prisma.smaeFood.groupBy({ by: ['group'], where: { practiceId, review: { not: Prisma.AnyNull } }, _count: true }),
  ])
  const pendingByGroup = new Map(pending.map((item) => [item.group, item._count]))
  return { items: groups.map((item) => ({ group: item.group, count: item._count, pending: pendingByGroup.get(item.group) || 0 })) }
})

app.get('/api/v1/smae-foods', async (request) => {
  const { search = '', group, review, page, pageSize } = request.query
  const where = await nameSearchWhere(prisma.smaeFood, {
    practiceId: request.practiceId,
    ...(group ? { group: String(group) } : {}),
    ...(review === '1' ? { review: { not: Prisma.AnyNull } } : {}),
  }, search)
  const currentPage = Math.max(Number(page) || 1, 1)
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 200)
  const [items, total] = await prisma.$transaction([
    prisma.smaeFood.findMany({ where, orderBy: [{ page: 'asc' }, { row: 'asc' }], skip: (currentPage - 1) * take, take }),
    prisma.smaeFood.count({ where }),
  ])
  return { items, total, page: currentPage, pageSize: take }
})

// Corrige o confirma celdas de un alimento. `values` trae sólo los campos tocados; un valor null
// en un nutrimento significa "ND". Cada campo enviado deja de estar marcado para revisión y queda
// anotado en `corrections`, que el importador respeta.
app.patch('/api/v1/smae-foods/:foodId', async (request, reply) => {
  const food = await prisma.smaeFood.findFirst({ where: { id: request.params.foodId, practiceId: request.practiceId } })
  if (!food) return reply.code(404).send({ code: 'SMAE_FOOD_NOT_FOUND', message: 'Alimento no encontrado.', fields: {} })
  const values = request.body?.values
  if (!values || typeof values !== 'object' || Array.isArray(values)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Indica los valores a guardar.', fields: { values: true } })
  const nutrients = { ...(food.nutrients || {}) }
  const review = { ...(food.review || {}) }
  const corrections = { ...(food.corrections || {}) }
  const data = {}
  for (const [field, raw] of Object.entries(values).slice(0, 40)) {
    if (SMAE_NUTRIENT_KEYS.includes(field)) {
      const number = raw === null || raw === '' ? null : Number(raw)
      if (number !== null && (!Number.isFinite(number) || number < 0 || number > 100000)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Los valores deben ser números positivos (o vacío para ND).', fields: { [field]: true } })
      nutrients[field] = number === null ? null : Math.round(number * 100) / 100
      corrections[field] = nutrients[field]
    } else if (field === 'name' || field === 'unit') {
      const text = typeof raw === 'string' ? raw.trim().slice(0, 160) : ''
      if (!text) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El texto no puede quedar vacío.', fields: { [field]: true } })
      data[field] = text
      corrections[field] = text
    } else if (field === 'qty') {
      const number = Number(raw)
      if (!Number.isFinite(number) || number <= 0 || number > 10000) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'La cantidad debe ser un número positivo.', fields: { qty: true } })
      data.qty = Math.round(number * 1000) / 1000
      corrections.qty = data.qty
    } else continue
    delete review[field]
  }
  const updated = await prisma.smaeFood.update({ where: { id: food.id }, data: { ...data, nutrients, corrections, review: Object.keys(review).length ? review : Prisma.DbNull } })
  await logAudit(request, { action: 'updated', entity: 'SmaeFood', entityId: food.id, metadata: { fields: Object.keys(values).slice(0, 40) } })
  return updated
})

app.setErrorHandler((error, request, reply) => {
  request.log.error(error)
  reply.code(error.statusCode || 500).send({ code: 'INTERNAL_ERROR', message: 'No fue posible completar la solicitud.', fields: {} })
})

const port = Number(process.env.PORT || 3001)
app.listen({ port, host: '0.0.0.0' }).catch(async (error) => { app.log.error(error); await prisma.$disconnect(); process.exit(1) })
