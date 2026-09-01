import Fastify from 'fastify'
import cors from '@fastify/cors'
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'
import PDFDocument from 'pdfkit'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { searchFoods } from './providers/food.js'
import { NutritionEngineError, computeEnergyRequirement, computeMacros } from './domain/nutrition.js'
import { DAY_LABELS, MEAL_TYPE_LABELS, buildMenuSnapshot } from './domain/documents.js'
import { computeMicronutrientAdequacy } from './domain/micronutrients.js'

const app = Fastify({ logger: true })
const prisma = new PrismaClient()

if (!process.env.DATABASE_URL) app.log.warn('DATABASE_URL no está configurada. Copia .env.example a .env antes de usar persistencia.')

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) app.log.warn('JWT_SECRET no está configurada. Copia .env.example a .env antes de usar autenticación.')
const SESSION_TTL = '7d'

// Public routes need no session: the login endpoint itself, and Fastify's own CORS
// preflight (@fastify/cors replies to OPTIONS before this hook runs, but excluded here too
// in case that ever changes) and health check.
const PUBLIC_ROUTES = new Set(['/health', '/api/v1/auth/login'])

// @fastify/cors defaults `methods` to 'GET,HEAD,POST' only (the CORS-spec "simple methods"),
// so without this every PUT here has silently failed preflight for any cross-origin caller
// (e.g. `npm run dev:all`, or the SPA and API on separate domains in production) — it only
// ever worked same-origin through Vite's dev proxy.
await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] })

app.addHook('onRequest', async (request, reply) => {
  if (request.method === 'OPTIONS' || PUBLIC_ROUTES.has(request.url.split('?')[0])) return
  if (!request.url.startsWith('/api/v1/')) return
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Inicia sesión para continuar.', fields: {} })
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET)
    request.userId = payload.sub
    request.practiceId = payload.practiceId
    request.userRole = payload.role
  } catch {
    return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Tu sesión expiró o no es válida. Inicia sesión de nuevo.', fields: {} })
  }
})

app.get('/health', async () => ({ status: 'ok', service: 'nutri-studio-api' }))

app.post('/api/v1/auth/login', async (request, reply) => {
  const { email, password } = request.body || {}
  if (!email || !password) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Email y contraseña son obligatorios.', fields: { email: !email, password: !password } })
  // Email is only unique per practice, not globally — this picks the first active match.
  // Fine for today's single-practice, single-user reality; revisit if multi-practice logins matter later.
  const user = await prisma.user.findFirst({ where: { email, status: 'ACTIVE' }, include: { practice: true } })
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false
  if (!user || !valid) return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: 'Email o contraseña incorrectos.', fields: {} })
  const token = jwt.sign({ sub: user.id, practiceId: user.practiceId, role: user.role }, JWT_SECRET, { expiresIn: SESSION_TTL })
  return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role }, practice: { id: user.practice.id, name: user.practice.name } }
})

// Stateless JWT: there is no server-side session to invalidate yet, so this only exists for
// symmetry with login and as a hook point for a future token-blacklist. Logging out is really
// the client discarding its token.
app.post('/api/v1/auth/logout', async (request, reply) => reply.code(204).send())

app.get('/api/v1/auth/me', async (request, reply) => {
  const user = await prisma.user.findUnique({ where: { id: request.userId }, include: { practice: true } })
  if (!user) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Sesión inválida.', fields: {} })
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role }, practice: { id: user.practice.id, name: user.practice.name } }
})

app.get('/api/v1/practice', async (request, reply) => {
  const practice = await prisma.practice.findUnique({ where: { id: request.practiceId } })
  if (!practice) return reply.code(404).send({ code: 'PRACTICE_NOT_FOUND', message: 'Práctica no encontrada.', fields: {} })
  const user = await prisma.user.findUnique({ where: { id: request.userId } })
  return { ...practice, user }
})

app.put('/api/v1/practice', async (request, reply) => {
  const { name, timeZone, userName, userEmail } = request.body || {}
  if (!name || !timeZone) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Nombre de la práctica y zona horaria son obligatorios.', fields: { name: !name, timeZone: !timeZone } })
  const practice = await prisma.practice.update({ where: { id: request.practiceId }, data: { name, timeZone } })
  let user = await prisma.user.findUnique({ where: { id: request.userId } })
  if (user && (userName || userEmail)) user = await prisma.user.update({ where: { id: user.id }, data: { name: userName || user.name, email: userEmail || user.email } })
  return { ...practice, user }
})

app.get('/api/v1/patients', async (request) => {
  const { search = '', status = 'ACTIVE', page = 1, pageSize = 25 } = request.query
  const currentPage = Math.max(Number(page), 1)
  const take = Math.min(Math.max(Number(pageSize), 1), 100)
  const where = {
    practiceId: request.practiceId,
    status,
    ...(search ? { OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}),
  }
  const [items, total] = await prisma.$transaction([
    prisma.patient.findMany({ where, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], skip: (currentPage - 1) * take, take }),
    prisma.patient.count({ where }),
  ])
  return { items, page: currentPage, pageSize: take, total }
})

app.post('/api/v1/patients', async (request, reply) => {
  const { firstName, lastName, email, phone, birthDate, sex, occupation } = request.body || {}
  if (!firstName || !lastName) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Nombre y apellido son obligatorios.', fields: { firstName: !firstName, lastName: !lastName } })
  const patient = await prisma.patient.create({ data: { practiceId: request.practiceId, firstName, lastName, email, phone, sex, occupation, birthDate: birthDate ? new Date(birthDate) : undefined } })
  return reply.code(201).send(patient)
})

app.get('/api/v1/patients/:patientId', async (request, reply) => {
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, practiceId: request.practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  return patient
})

app.patch('/api/v1/patients/:patientId', async (request, reply) => {
  const practiceId = request.practiceId
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  const { firstName, lastName, email, phone, birthDate, sex, occupation } = request.body || {}
  if ((firstName !== undefined && !firstName) || (lastName !== undefined && !lastName)) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Nombre y apellido no pueden quedar vacíos.', fields: { firstName: firstName !== undefined && !firstName, lastName: lastName !== undefined && !lastName } })
  const updated = await prisma.patient.update({
    where: { id: patient.id },
    data: {
      ...(firstName !== undefined ? { firstName } : {}),
      ...(lastName !== undefined ? { lastName } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(birthDate !== undefined ? { birthDate: birthDate ? new Date(birthDate) : null } : {}),
      ...(sex !== undefined ? { sex } : {}),
      ...(occupation !== undefined ? { occupation } : {}),
    },
  })
  return updated
})

app.get('/api/v1/patients/:patientId/timeline', async (request, reply) => {
  const practiceId = request.practiceId
  const patientId = request.params.patientId
  const patient = await prisma.patient.findFirst({ where: { id: patientId, practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  const [appointments, consultations, plans, documents] = await prisma.$transaction([
    prisma.appointment.findMany({ where: { patientId }, orderBy: { startAt: 'desc' }, take: 20 }),
    prisma.consultation.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.nutritionPlan.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.document.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ])
  const events = [
    ...appointments.map((a) => ({ kind: 'appointment', date: a.startAt, status: a.status, subtype: a.type, id: a.id })),
    ...consultations.map((c) => ({ kind: 'consultation', date: c.startedAt || c.createdAt, status: c.status, id: c.id })),
    ...plans.map((p) => ({ kind: 'plan', date: p.publishedAt || p.createdAt, status: p.status, id: p.id })),
    ...documents.map((d) => ({ kind: 'document', date: d.generatedAt || d.createdAt, status: d.deliveredAt ? 'DELIVERED' : d.generatedAt ? 'GENERATED' : 'PENDING', subtype: d.type, id: d.id })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))
  return { items: events }
})

app.get('/api/v1/patients/:patientId/consultations', async (request) => {
  const consultations = await prisma.consultation.findMany({ where: { patientId: request.params.patientId }, include: { sections: true, measurements: true, diagnoses: true, plans: true }, orderBy: { createdAt: 'desc' } })
  return { items: consultations }
})

app.get('/api/v1/patients/:patientId/plans', async (request) => {
  const plans = await prisma.nutritionPlan.findMany({ where: { patientId: request.params.patientId }, include: { mealSlots: true, documents: true }, orderBy: [{ createdAt: 'desc' }, { version: 'desc' }] })
  return { items: plans }
})

app.post('/api/v1/patients/:patientId/consultations', async (request, reply) => {
  const { appointmentId, nutritionistId, templateId } = request.body || {}
  const practiceId = request.practiceId
  // nutritionistId lets one professional open a consultation on another's behalf; otherwise
  // it defaults to whoever is logged in, falling back to the oldest user in the practice.
  let userId = nutritionistId || request.userId
  if (!userId) userId = (await prisma.user.findFirst({ where: { practiceId } }))?.id
  if (!userId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'La consulta necesita un profesional responsable.', fields: { nutritionistId: 'required' } })
  const consultation = await prisma.consultation.create({ data: { patientId: request.params.patientId, appointmentId, nutritionistId: userId, templateId, status: 'IN_PROGRESS', startedAt: new Date() } })
  if (appointmentId) await prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'COMPLETED' } })
  return reply.code(201).send(consultation)
})

app.get('/api/v1/consultations/:consultationId', async (request, reply) => {
  const consultation = await prisma.consultation.findFirst({ where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } }, include: { patient: true, sections: true, measurements: true, diagnoses: true, plans: true } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  return consultation
})

app.post('/api/v1/consultations/:consultationId/complete', async (request, reply) => {
  const consultation = await prisma.consultation.findFirst({ where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  return prisma.consultation.update({ where: { id: consultation.id }, data: { status: 'COMPLETED', completedAt: new Date() } })
})

app.put('/api/v1/consultations/:consultationId/sections/:sectionKey', async (request, reply) => {
  const { payload = {}, completionState = 'in_progress', updatedAt } = request.body || {}
  const consultation = await prisma.consultation.findFirst({ where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  const existing = await prisma.clinicalSection.findUnique({ where: { consultationId_sectionKey: { consultationId: consultation.id, sectionKey: request.params.sectionKey } } })
  if (existing && updatedAt && new Date(updatedAt).getTime() !== new Date(existing.lastSavedAt).getTime()) return reply.code(409).send({ code: 'CONCURRENT_EDIT', message: 'La sección cambió en otra sesión. Recarga antes de guardar.', fields: {} })
  const section = await prisma.clinicalSection.upsert({ where: { consultationId_sectionKey: { consultationId: consultation.id, sectionKey: request.params.sectionKey } }, create: { consultationId: consultation.id, sectionKey: request.params.sectionKey, payload, completionState, lastSavedBy: request.userId || 'system' }, update: { payload, completionState, lastSavedBy: request.userId || 'system' } })
  return section
})

// The anthropometric ClinicalSection payload is free-form (whatever labels the form on
// screen happens to use) so the record report and the PDF instead read structured
// Measurement rows — this is the only way to create one; nothing wrote it before.
app.post('/api/v1/consultations/:consultationId/measurements', async (request, reply) => {
  const consultation = await prisma.consultation.findFirst({ where: { id: request.params.consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  const { measuredAt, weightKg, heightCm, waistCm, hipCm, abdomenCm, bodyFatPercent, muscleMassKg, method, notes } = request.body || {}
  const measurement = await prisma.measurement.create({
    data: { patientId: consultation.patientId, consultationId: consultation.id, measuredAt: measuredAt ? new Date(measuredAt) : new Date(), weightKg, heightCm, waistCm, hipCm, abdomenCm, bodyFatPercent, muscleMassKg, method, notes },
  })
  return reply.code(201).send(measurement)
})

app.get('/api/v1/appointments', async (request) => {
  const { from, to } = request.query
  const appointments = await prisma.appointment.findMany({ where: { practiceId: request.practiceId, startAt: { gte: new Date(from), lte: new Date(to) } }, include: { patient: true }, orderBy: { startAt: 'asc' } })
  return { items: appointments }
})

app.post('/api/v1/appointments', async (request, reply) => {
  const { patientId, startAt, endAt, type = 'FOLLOW_UP', durationMinutes, notifyVia = [], internalNote, patientNote, timeZone = 'America/Mexico_City' } = request.body || {}
  const start = new Date(startAt)
  const end = endAt ? new Date(endAt) : new Date(start.getTime() + Number(durationMinutes || 60) * 60000)
  if (!patientId || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Paciente, fecha y duración válida son obligatorios.', fields: {} })
  const practiceId = request.practiceId
  const overlap = await prisma.appointment.findFirst({ where: { practiceId, status: { notIn: ['CANCELLED', 'NO_SHOW'] }, startAt: { lt: end }, endAt: { gt: start } } })
  if (overlap) return reply.code(409).send({ code: 'APPOINTMENT_OVERLAP', message: 'Ese horario ya está ocupado.', fields: { startAt: 'overlap', endAt: 'overlap' } })
  const appointment = await prisma.appointment.create({ data: { practiceId, patientId, startAt: start, endAt: end, type, status: notifyVia.length ? 'PENDING_CONFIRMATION' : 'SCHEDULED', notifyVia, internalNote, patientNote, timeZone }, include: { patient: true } })
  return reply.code(201).send(appointment)
})

app.post('/api/v1/appointments/:appointmentId/confirm', async (request, reply) => {
  const appointment = await prisma.appointment.findFirst({ where: { id: request.params.appointmentId, practiceId: request.practiceId } })
  if (!appointment) return reply.code(404).send({ code: 'APPOINTMENT_NOT_FOUND', message: 'Cita no encontrada.', fields: {} })
  return prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'CONFIRMED' }, include: { patient: true } })
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

app.get('/api/v1/templates', async (request) => {
  const { type } = request.query
  const templates = await prisma.template.findMany({
    where: { practiceId: request.practiceId, status: 'ACTIVE', ...(type ? { type } : {}) },
    orderBy: { updatedAt: 'desc' },
  })
  return { items: templates }
})

app.post('/api/v1/templates', async (request, reply) => {
  const { name, type, description, sourceConsultationId, sourcePlanId } = request.body || {}
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
  }

  const template = await prisma.template.create({ data: { practiceId: request.practiceId, type, name, description, sections, mealSlots } })
  return reply.code(201).send(template)
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

  await prisma.template.update({ where: { id: template.id }, data: { usageCount: { increment: 1 } } })

  if (template.type === 'clinical') {
    let consultation = await prisma.consultation.findFirst({ where: { patientId, status: 'IN_PROGRESS' } })
    if (!consultation) consultation = await prisma.consultation.create({ data: { patientId, nutritionistId: request.userId, templateId: template.id, status: 'IN_PROGRESS', startedAt: new Date() } })
    const sections = template.sections || {}
    await prisma.$transaction(Object.entries(sections).map(([sectionKey, payload]) =>
      prisma.clinicalSection.upsert({ where: { consultationId_sectionKey: { consultationId: consultation.id, sectionKey } }, create: { consultationId: consultation.id, sectionKey, payload, lastSavedBy: request.userId }, update: { payload, lastSavedBy: request.userId } })
    ))
    return { type: 'clinical', consultationId: consultation.id, patientId }
  }

  let consultation = await prisma.consultation.findFirst({ where: { patientId }, orderBy: { createdAt: 'desc' } })
  if (!consultation) consultation = await prisma.consultation.create({ data: { patientId, nutritionistId: request.userId, status: 'IN_PROGRESS', startedAt: new Date() } })
  let plan = await prisma.nutritionPlan.findFirst({ where: { patientId, status: { not: 'PUBLISHED' } }, orderBy: { createdAt: 'desc' } })
  if (!plan) plan = await prisma.nutritionPlan.create({ data: { patientId, consultationId: consultation.id } })
  const slots = template.mealSlots || []
  await prisma.$transaction([
    prisma.mealSlot.deleteMany({ where: { planId: plan.id } }),
    prisma.mealSlot.createMany({ data: slots.map((slot) => ({ planId: plan.id, dayOfWeek: slot.dayOfWeek, mealType: slot.mealType, recipeId: slot.recipeId, servings: slot.servings })) }),
  ])
  return { type: 'plan', planId: plan.id, patientId }
})

// kcal/protein/carbs/fat/fiber/sugar/sodium feed the macro summary shown everywhere; the
// micronutrients feed the % de adecuación (fase 15) — both come from the same ingredient
// nutrition JSON, per 100 g, scaled by ingredient quantity.
const RECIPE_NUTRITION_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'vitaminA', 'vitaminC', 'folicAcid', 'calcium', 'iron', 'vitaminD', 'vitaminE', 'vitaminK', 'vitaminB12', 'zinc', 'iodine', 'selenium']
const emptyNutritionTotals = () => Object.fromEntries(RECIPE_NUTRITION_KEYS.map((key) => [key, 0]))

app.get('/api/v1/recipes', async (request) => {
  const { search = '', mealType, restriction, status = 'ACTIVE' } = request.query
  const where = {
    practiceId: request.practiceId,
    status,
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    ...(mealType ? { mealTypes: { has: mealType } } : {}),
    ...(restriction ? { restrictions: { has: restriction } } : {}),
  }
  const recipes = await prisma.recipe.findMany({ where, include: { ingredients: { include: { ingredient: true } } }, orderBy: { name: 'asc' }, take: 100 })
  return { items: recipes }
})

app.post('/api/v1/recipes', async (request, reply) => {
  const { name, mealTypes = [], portions, instructions, nutrition = {}, restrictions = [], imageUrl, ingredients = [] } = request.body || {}
  if (!name || !mealTypes.length) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Nombre y al menos un tiempo de comida son obligatorios.', fields: { name: !name, mealTypes: !mealTypes.length } })
  const validIngredients = ingredients.length ? await prisma.ingredient.findMany({ where: { id: { in: ingredients.map((item) => item.ingredientId).filter(Boolean) }, practiceId: request.practiceId }, select: { id: true } }) : []
  const validIds = new Set(validIngredients.map((item) => item.id))
  const recipe = await prisma.recipe.create({ data: { practiceId: request.practiceId, name, mealTypes, portions, instructions, nutrition, restrictions, imageUrl, ingredients: { create: ingredients.filter((item) => validIds.has(item.ingredientId)).map((item) => ({ ingredientId: item.ingredientId, quantity: item.quantity, unit: item.unit || 'g', equivalence: item.equivalence })) } }, include: { ingredients: { include: { ingredient: true } } } })
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
  const { name, mealTypes, portions, instructions, restrictions, imageUrl, status } = request.body || {}
  if (name !== undefined && !name) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'El nombre no puede quedar vacío.', fields: { name: true } })
  if (mealTypes !== undefined && !mealTypes.length) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Selecciona al menos un tiempo de comida.', fields: { mealTypes: true } })
  const updated = await prisma.recipe.update({
    where: { id: recipe.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(mealTypes !== undefined ? { mealTypes } : {}),
      ...(portions !== undefined ? { portions } : {}),
      ...(instructions !== undefined ? { instructions } : {}),
      ...(restrictions !== undefined ? { restrictions } : {}),
      ...(imageUrl !== undefined ? { imageUrl } : {}),
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
  if (!ingredients.length) return reply.code(400).send({ code: 'EMPTY_RECIPE', message: 'La receta debe conservar al menos un ingrediente.', fields: {} })
  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } })
    await transaction.recipeIngredient.createMany({ data: ingredients.map((item) => ({ recipeId: recipe.id, ingredientId: item.ingredientId, quantity: item.quantity, unit: item.unit || 'g', equivalence: item.equivalence })) })
    return transaction.recipe.findUnique({ where: { id: recipe.id }, include: { ingredients: { include: { ingredient: true } } } })
  })
  const totals = emptyNutritionTotals()
  for (const item of updated.ingredients) { const nutrition = item.ingredient.nutrition || {}; const factor = Number(item.quantity) / 100; for (const key of Object.keys(totals)) totals[key] += Number(nutrition[key] || 0) * factor }
  const servings = Number(updated.portions || 1)
  const nutrition = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round((value / servings) * 10) / 10]))
  return prisma.recipe.update({ where: { id: updated.id }, data: { nutrition, version: { increment: 1 } }, include: { ingredients: { include: { ingredient: true } } } })
})

app.get('/api/v1/recipes/:recipeId/nutrition', async (request, reply) => {
  const recipe = await prisma.recipe.findFirst({ where: { id: request.params.recipeId, practiceId: request.practiceId }, include: { ingredients: { include: { ingredient: true } } } })
  if (!recipe) return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', message: 'Receta no encontrada.', fields: {} })
  const totals = emptyNutritionTotals()
  for (const item of recipe.ingredients) {
    const nutrition = item.ingredient.nutrition || {}
    const factor = Number(item.quantity) / 100
    for (const key of Object.keys(totals)) totals[key] += Number(nutrition[key] || 0) * factor
  }
  return { recipeId: recipe.id, servings: Number(recipe.portions || 1), perServing: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round((value / Number(recipe.portions || 1)) * 10) / 10])), ingredients: recipe.ingredients.map((item) => ({ name: item.ingredient.name, quantity: Number(item.quantity), unit: item.unit, equivalence: item.equivalence ? Number(item.equivalence) : null })) }
})

app.post('/api/v1/recipes/:recipeId/recalculate', async (request, reply) => {
  const recipe = await prisma.recipe.findFirst({ where: { id: request.params.recipeId, practiceId: request.practiceId }, include: { ingredients: { include: { ingredient: true } } } })
  if (!recipe) return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', message: 'Receta no encontrada.', fields: {} })
  const totals = emptyNutritionTotals()
  for (const item of recipe.ingredients) { const nutrition = item.ingredient.nutrition || {}; const factor = Number(item.quantity) / 100; for (const key of Object.keys(totals)) totals[key] += Number(nutrition[key] || 0) * factor }
  const servings = Number(recipe.portions || 1)
  const nutrition = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round((value / servings) * 10) / 10]))
  const updated = await prisma.recipe.update({ where: { id: recipe.id }, data: { nutrition, version: { increment: 1 } } })
  return { recipe: updated, nutrition, version: updated.version }
})

app.get('/api/v1/education-materials', async (request) => {
  const { search = '', category, status = 'ACTIVE' } = request.query
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

app.get('/api/v1/ingredients', async (request) => {
  const { search = '', group } = request.query
  const ingredients = await prisma.ingredient.findMany({ where: { practiceId: request.practiceId, status: 'ACTIVE', ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}), ...(group ? { group } : {}) }, orderBy: { name: 'asc' }, take: 200 })
  return { items: ingredients }
})

app.post('/api/v1/ingredients/import', async (request, reply) => {
  const { externalId, source, name, group, unit = 'g', nutrition = {}, equivalence = {}, imageUrl } = request.body || {}
  if (!externalId || !source || !name || !group) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fuente, identificador, nombre y grupo son obligatorios.', fields: {} })
  const practiceId = request.practiceId
  const ingredient = await prisma.ingredient.create({ data: { practiceId, name, group, unit, nutrition, equivalence: { ...equivalence, source: { provider: source, externalId, importedAt: new Date().toISOString() } } } })
  return reply.code(201).send({ ...ingredient, imageUrl: imageUrl || null })
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

app.get('/api/v1/dashboard/today', async (request) => {
  const date = request.query.date || new Date().toISOString().slice(0, 10)
  const start = new Date(`${date}T00:00:00.000Z`)
  const end = new Date(`${date}T23:59:59.999Z`)
  const practiceId = request.practiceId
  const [appointments, pendingConfirmations, followUps, activePatients, tasks] = await prisma.$transaction([
    prisma.appointment.findMany({ where: { practiceId, startAt: { gte: start, lte: end } }, include: { patient: true }, orderBy: { startAt: 'asc' } }),
    prisma.appointment.count({ where: { practiceId, startAt: { gte: start, lte: end }, status: 'PENDING_CONFIRMATION' } }),
    prisma.task.count({ where: { practiceId, status: 'pending', type: { in: ['nutrition_plan', 'consultation_report'] } } }),
    prisma.patient.count({ where: { practiceId, status: 'ACTIVE' } }),
    prisma.task.findMany({ where: { practiceId, status: 'pending' }, include: { patient: true }, orderBy: { dueAt: 'asc' }, take: 3 }),
  ])
  return { date, stats: { appointments: appointments.length, pendingConfirmations, followUps, activePatients }, appointments, tasks }
})

app.post('/api/v1/nutrition-plans/calculate', async (request, reply) => {
  const { sex, age, weightKg, heightCm, bodyFatPercent, formula = 'mifflin', activityFactor = 1.375, mets } = request.body || {}
  const values = { age: Number(age), weightKg: Number(weightKg), heightCm: Number(heightCm) }
  const invalid = Object.entries(values).filter(([, value]) => !Number.isFinite(value) || value <= 0).map(([key]) => key)
  if (invalid.length) return reply.code(400).send({ code: 'INVALID_MEASUREMENTS', message: 'Edad, peso y talla deben ser valores positivos.', fields: Object.fromEntries(invalid.map((key) => [key, 'invalid'])) })
  if (values.age < 1 || values.age > 120 || values.weightKg > 500 || values.heightCm > 250) return reply.code(400).send({ code: 'OUT_OF_RANGE', message: 'Revisa que las medidas estén dentro de un rango plausible.', fields: {} })
  try {
    return computeEnergyRequirement({ sex, age: values.age, weightKg: values.weightKg, heightCm: values.heightCm, bodyFatPercent, formula, activityFactor, mets })
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

app.post('/api/v1/patients/:patientId/plans', async (request, reply) => {
  const { consultationId, goal } = request.body || {}
  if (!consultationId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'La consulta asociada es obligatoria.', fields: { consultationId: 'required' } })
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, practiceId: request.practiceId } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  const plan = await prisma.nutritionPlan.create({ data: { patientId: patient.id, consultationId, goal } })
  return reply.code(201).send(plan)
})

app.get('/api/v1/plans/:planId', async (request, reply) => {
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId: request.practiceId } }, include: { patient: true, mealSlots: true, documents: true } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  return plan
})

app.get('/api/v1/plans/:planId/adequacy', async (request, reply) => {
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId: request.practiceId } }, include: { mealSlots: { include: { recipe: true } } } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  const inputs = plan.evaluation?.inputs
  if (!inputs?.age || !inputs?.sex) return { bracket: null, bracketLabel: null, nutrients: [], reason: 'MISSING_EVALUATION' }
  return computeMicronutrientAdequacy(plan.mealSlots, inputs.age, inputs.sex)
})

app.put('/api/v1/plans/:planId/evaluation', async (request, reply) => {
  const { sex, age, weightKg, heightCm, bodyFatPercent, formula = 'mifflin', activityFactor, mets, carbsPercent, proteinPercent, fatPercent, goal } = request.body || {}
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId: request.practiceId } } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  if (plan.status === 'PUBLISHED') return reply.code(409).send({ code: 'PLAN_LOCKED', message: 'Los planes publicados no pueden modificarse.', fields: {} })

  const values = { age: Number(age), weightKg: Number(weightKg), heightCm: Number(heightCm) }
  const invalid = Object.entries(values).filter(([, value]) => !Number.isFinite(value) || value <= 0).map(([key]) => key)
  if (invalid.length) return reply.code(400).send({ code: 'INVALID_MEASUREMENTS', message: 'Edad, peso y talla deben ser valores positivos.', fields: Object.fromEntries(invalid.map((key) => [key, 'invalid'])) })
  if (values.age < 1 || values.age > 120 || values.weightKg > 500 || values.heightCm > 250) return reply.code(400).send({ code: 'OUT_OF_RANGE', message: 'Revisa que las medidas estén dentro de un rango plausible.', fields: {} })

  try {
    const energy = computeEnergyRequirement({ sex, age: values.age, weightKg: values.weightKg, heightCm: values.heightCm, bodyFatPercent, formula, activityFactor, mets })
    const macros = computeMacros({ kcal: energy.get, carbsPercent, proteinPercent, fatPercent })
    const updated = await prisma.nutritionPlan.update({
      where: { id: plan.id },
      data: {
        goal: goal ?? plan.goal,
        formula,
        activityMethod: energy.activityMethod,
        activityFactor: energy.activityMethod === 'factor' ? Number(activityFactor) : null,
        metsPayload: energy.activityMethod === 'mets' ? mets : null,
        targetKcal: energy.get,
        carbsPercent: macros.macros.carbs.percent,
        proteinPercent: macros.macros.protein.percent,
        fatPercent: macros.macros.fat.percent,
        evaluation: { formulaVersion: energy.formulaVersion, formulaLabel: energy.formulaLabel, bmr: energy.bmr, bmi: energy.bmi, bmiCategory: energy.bmiCategory, idealWeightRange: energy.idealWeightRange, flags: energy.flags, inputs: energy.inputs },
      },
    })
    return { ...updated, macros: macros.macros }
  } catch (error) {
    if (error instanceof NutritionEngineError) return reply.code(400).send({ code: error.code, message: error.message, fields: error.fields })
    throw error
  }
})

app.put('/api/v1/plans/:planId/distribution', async (request, reply) => {
  const { mealSlots = [] } = request.body || {}
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId: request.practiceId } } })
  if (!plan || plan.status === 'PUBLISHED') return reply.code(plan ? 409 : 404).send({ code: plan ? 'PLAN_LOCKED' : 'PLAN_NOT_FOUND', message: plan ? 'Los planes publicados no pueden modificarse.' : 'Plan no encontrado.', fields: {} })
  await prisma.$transaction([prisma.mealSlot.deleteMany({ where: { planId: plan.id } }), prisma.mealSlot.createMany({ data: mealSlots.map((slot) => ({ planId: plan.id, dayOfWeek: slot.dayOfWeek, mealType: slot.mealType, recipeId: slot.recipeId, servings: slot.servings, notes: slot.notes })) })])
  return prisma.nutritionPlan.findUnique({ where: { id: plan.id }, include: { mealSlots: true } })
})

app.post('/api/v1/plans/:planId/publish', async (request, reply) => {
  const practiceId = request.practiceId
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: request.params.planId, patient: { practiceId } }, include: { mealSlots: { include: { recipe: true } } } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  if (plan.status === 'PUBLISHED') return reply.code(409).send({ code: 'PLAN_ALREADY_PUBLISHED', message: 'Este plan ya fue publicado.', fields: {} })
  if (!plan.mealSlots.length) return reply.code(400).send({ code: 'EMPTY_PLAN', message: 'Agrega al menos un tiempo de comida antes de publicar.', fields: {} })
  const menuSnapshot = buildMenuSnapshot(plan.mealSlots)
  const published = await prisma.nutritionPlan.update({ where: { id: plan.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), menuSnapshot } })
  return published
})

app.post('/api/v1/documents/nutrition-plan', async (request, reply) => {
  const { planId } = request.body || {}
  if (!planId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'planId es obligatorio.', fields: { planId: 'required' } })
  const practiceId = request.practiceId
  const plan = await prisma.nutritionPlan.findFirst({ where: { id: planId, patient: { practiceId } } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  if (plan.status !== 'PUBLISHED') return reply.code(409).send({ code: 'PLAN_NOT_PUBLISHED', message: 'Publica el plan antes de generar su documento.', fields: {} })
  const document = await prisma.document.create({ data: { patientId: plan.patientId, consultationId: plan.consultationId, planId: plan.id, type: 'nutrition_plan', sections: { menu: true, macros: true, recommendations: true }, version: 0 } })
  return reply.code(201).send(document)
})

app.post('/api/v1/documents/consultation-report', async (request, reply) => {
  const { consultationId } = request.body || {}
  if (!consultationId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'consultationId es obligatorio.', fields: { consultationId: 'required' } })
  const consultation = await prisma.consultation.findFirst({ where: { id: consultationId, patient: { practiceId: request.practiceId } } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  const document = await prisma.document.create({ data: { patientId: consultation.patientId, consultationId: consultation.id, type: 'consultation_report', sections: { summary: true, anthropometric: true, diagnosis: true, treatment: true }, version: 0 } })
  return reply.code(201).send(document)
})

app.get('/api/v1/documents', async (request) => {
  const { patientId, type } = request.query
  const documents = await prisma.document.findMany({ where: { patientId: patientId || undefined, type: type || undefined, patient: { practiceId: request.practiceId } }, include: { patient: true, plan: true }, orderBy: { createdAt: 'desc' }, take: 100 })
  return { items: documents }
})

function drawDocumentBrand(file, subtitle) {
  file.fontSize(20).fillColor('#34745f').text('nutri·studio')
  file.fontSize(9).fillColor('#7b8780').text(subtitle)
  file.moveDown(2)
}

function drawConsultationReport(file, document) {
  drawDocumentBrand(file, 'EXPEDIENTE DE CONSULTA NUTRICIONAL')
  file.fontSize(18).fillColor('#202124').text('Informe de consulta')
  file.fontSize(10).fillColor('#6e6e73').text(`Paciente: ${document.patient.firstName} ${document.patient.lastName}`)
  file.text(`Generado: ${new Date().toLocaleDateString('es-MX')}`)
  file.moveDown()
  file.roundedRect(48, file.y, 516, 70, 6).fill('#eef8f2')
  file.fillColor('#34745f').fontSize(11).text('Resumen de la consulta', 62, file.y + 14)
  file.fillColor('#4c5b53').fontSize(9).text('Documento generado desde la valoración clínica de Nutri Studio.', 62, file.y + 33, { width: 480 })
  file.y += 95

  const consultation = document.consultation
  const sections = consultation?.sections || []
  const payloadOf = (key) => sections.find((section) => section.sectionKey === key)?.payload || {}
  const measurement = (consultation?.measurements || [])[0]
  const diagnoses = consultation?.diagnoses || []

  const drawTitle = (title) => { file.fillColor('#34745f').fontSize(13).text(title); file.moveTo(48, file.y + 4).lineTo(564, file.y + 4).strokeColor('#dce8df').stroke(); file.moveDown() }
  const drawLine = (text) => file.fillColor('#4c5b53').fontSize(9).text(text, { width: 480 })
  const drawEntries = (payload) => { const entries = Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== '') ; if (!entries.length) return false; for (const [key, value] of entries) drawLine(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`); return true }

  drawTitle('Datos generales')
  if (!drawEntries(payloadOf('general'))) drawLine('Sin datos generales registrados.')
  file.moveDown(1.5)

  drawTitle('Antropometría')
  if (measurement) {
    drawLine(`Peso: ${measurement.weightKg ?? '—'} kg · Talla: ${measurement.heightCm ?? '—'} cm`)
    if (measurement.waistCm) drawLine(`Cintura: ${measurement.waistCm} cm`)
    if (measurement.hipCm) drawLine(`Cadera: ${measurement.hipCm} cm`)
    if (measurement.bodyFatPercent) drawLine(`% grasa corporal: ${measurement.bodyFatPercent}%`)
    if (measurement.method) drawLine(`Método: ${measurement.method}`)
  } else drawLine('Sin mediciones registradas.')
  file.moveDown(1.5)

  drawTitle('Diagnóstico nutricio')
  if (diagnoses.length) for (const d of diagnoses) drawLine(`${d.code} (${d.domain}) — ${d.problem}. Causa: ${d.etiology}. Evidencia: ${d.evidence}`)
  else drawLine('Sin diagnóstico registrado.')
  file.moveDown(1.5)

  drawTitle('Tratamiento')
  if (!drawEntries(payloadOf('treatment'))) drawLine('Sin recomendaciones registradas.')
  file.moveDown(1.5)

  file.fillColor('#8e9a94').fontSize(9).text('Gabriela Alonso · Nutrióloga', { align: 'center' })
}

function drawNutritionPlanMenu(file, document) {
  const plan = document.plan
  drawDocumentBrand(file, 'PLAN DE ALIMENTACIÓN')
  file.fontSize(18).fillColor('#202124').text('Menú semanal')
  file.fontSize(10).fillColor('#6e6e73').text(`Paciente: ${document.patient.firstName} ${document.patient.lastName}`)
  file.text(`Generado: ${new Date().toLocaleDateString('es-MX')}`)
  if (plan?.goal) file.text(`Objetivo: ${plan.goal}`)
  file.moveDown()

  if (plan?.targetKcal) {
    const macros = computeMacros({ kcal: plan.targetKcal, carbsPercent: plan.carbsPercent, proteinPercent: plan.proteinPercent, fatPercent: plan.fatPercent })
    file.roundedRect(48, file.y, 516, 70, 6).fill('#eef8f2')
    file.fillColor('#34745f').fontSize(11).text(`Requerimiento: ${plan.targetKcal} kcal/día`, 62, file.y + 14)
    file.fillColor('#4c5b53').fontSize(9).text(`Carbohidratos ${macros.macros.carbs.grams} g · Proteína ${macros.macros.protein.grams} g · Grasas ${macros.macros.fat.grams} g`, 62, file.y + 33, { width: 480 })
    file.y += 95
  }

  const menu = plan?.menuSnapshot || []
  const byDay = new Map()
  for (const entry of menu) { if (!byDay.has(entry.dayOfWeek)) byDay.set(entry.dayOfWeek, []); byDay.get(entry.dayOfWeek).push(entry) }
  if (!menu.length) { file.fillColor('#6e6e73').fontSize(10).text('Este plan no tiene recetas asignadas.'); return }
  for (const [dayOfWeek, entries] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    file.fillColor('#34745f').fontSize(13).text(DAY_LABELS[dayOfWeek] || `Día ${dayOfWeek}`)
    file.moveTo(48, file.y + 4).lineTo(564, file.y + 4).strokeColor('#dce8df').stroke()
    file.moveDown(0.5)
    for (const entry of entries) file.fillColor('#4c5b53').fontSize(9).text(`${MEAL_TYPE_LABELS[entry.mealType] || entry.mealType}: ${entry.recipeName} (${entry.kcal} kcal)`)
    file.moveDown()
  }
  file.fillColor('#8e9a94').fontSize(9).text('Gabriela Alonso · Nutrióloga', { align: 'center' })
}

app.post('/api/v1/documents/:documentId/generate', async (request, reply) => {
  const practiceId = request.practiceId
  const document = await prisma.document.findFirst({ where: { id: request.params.documentId, patient: { practiceId } }, include: { patient: true, consultation: { include: { measurements: true, diagnoses: true, sections: true } }, plan: true } })
  if (!document) return reply.code(404).send({ code: 'DOCUMENT_NOT_FOUND', message: 'Documento no encontrado.', fields: {} })
  const pdf = await new Promise((resolve, reject) => {
    const chunks = []
    const file = new PDFDocument({ size: 'LETTER', margin: 48 })
    file.on('data', (chunk) => chunks.push(chunk))
    file.on('end', () => resolve(Buffer.concat(chunks)))
    file.on('error', reject)
    if (document.type === 'nutrition_plan') drawNutritionPlanMenu(file, document)
    else drawConsultationReport(file, document)
    file.end()
  })
  const directory = path.resolve(process.env.DOCUMENT_STORAGE_PATH || './storage/documents'); await mkdir(directory, { recursive: true }); const fileName = `${document.id}-v${document.version + 1}.pdf`; const filePath = path.join(directory, fileName); await writeFile(filePath, pdf); const checksum = createHash('sha256').update(pdf).digest('hex'); const generated = await prisma.document.update({ where: { id: document.id }, data: { generatedAt: new Date(), version: { increment: 1 }, checksum, storageKey: fileName } }); return { ...generated, downloadUrl: `/api/v1/documents/${document.id}/download` }
})

app.get('/api/v1/documents/:documentId/download', async (request, reply) => { const practiceId = request.practiceId; const document = await prisma.document.findFirst({ where: { id: request.params.documentId, patient: { practiceId } } }); if (!document?.storageKey) return reply.code(404).send({ code: 'DOCUMENT_FILE_NOT_FOUND', message: 'Genera el documento antes de descargarlo.', fields: {} }); const filePath = path.resolve(process.env.DOCUMENT_STORAGE_PATH || './storage/documents', document.storageKey); const file = await readFile(filePath); return reply.type('application/pdf').header('Content-Disposition', `attachment; filename="${document.storageKey}"`).send(file) })

app.post('/api/v1/documents/:documentId/deliver', async (request, reply) => {
  const practiceId = request.practiceId
  const document = await prisma.document.findFirst({ where: { id: request.params.documentId, patient: { practiceId } } })
  if (!document) return reply.code(404).send({ code: 'DOCUMENT_NOT_FOUND', message: 'Documento no encontrado.', fields: {} })
  if (!document.generatedAt) return reply.code(409).send({ code: 'DOCUMENT_NOT_GENERATED', message: 'Genera el documento antes de entregarlo.', fields: {} })
  return prisma.document.update({ where: { id: document.id }, data: { deliveredAt: new Date() } })
})

app.setErrorHandler((error, request, reply) => {
  request.log.error(error)
  reply.code(error.statusCode || 500).send({ code: 'INTERNAL_ERROR', message: 'No fue posible completar la solicitud.', fields: {} })
})

const port = Number(process.env.PORT || 3001)
app.listen({ port, host: '0.0.0.0' }).catch(async (error) => { app.log.error(error); await prisma.$disconnect(); process.exit(1) })
