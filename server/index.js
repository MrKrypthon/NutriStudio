import Fastify from 'fastify'
import cors from '@fastify/cors'
import { PrismaClient } from '@prisma/client'
import 'dotenv/config'
import PDFDocument from 'pdfkit'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { searchFoods } from './providers/food.js'
import { NutritionEngineError, computeEnergyRequirement, computeMacros } from './domain/nutrition.js'
import { DAY_LABELS, MEAL_TYPE_LABELS, buildMenuSnapshot } from './domain/documents.js'

const app = Fastify({ logger: true })
const prisma = new PrismaClient()

if (!process.env.DATABASE_URL) app.log.warn('DATABASE_URL no está configurada. Copia .env.example a .env antes de usar persistencia.')

await app.register(cors, { origin: true })

app.get('/health', async () => ({ status: 'ok', service: 'nutri-studio-api' }))

app.get('/api/v1/patients', async (request) => {
  const { search = '', status = 'ACTIVE', page = 1, pageSize = 25 } = request.query
  const currentPage = Math.max(Number(page), 1)
  const take = Math.min(Math.max(Number(pageSize), 1), 100)
  const where = {
    practiceId: request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID,
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
  const patient = await prisma.patient.create({ data: { practiceId: request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID, firstName, lastName, email, phone, sex, occupation, birthDate: birthDate ? new Date(birthDate) : undefined } })
  return reply.code(201).send(patient)
})

app.get('/api/v1/patients/:patientId', async (request, reply) => {
  const patient = await prisma.patient.findFirst({ where: { id: request.params.patientId, practiceId: request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID } })
  if (!patient) return reply.code(404).send({ code: 'PATIENT_NOT_FOUND', message: 'Paciente no encontrado.', fields: {} })
  return patient
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
  // Sin sesión real todavía (ver auditoría de seguridad pendiente), no hay forma de saber
  // qué profesional está trabajando; se usa el primero de la práctica como responsable.
  const practiceId = request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID
  let userId = nutritionistId || request.headers['x-user-id']
  if (!userId) userId = (await prisma.user.findFirst({ where: { practiceId } }))?.id
  if (!userId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'La consulta necesita un profesional responsable.', fields: { nutritionistId: 'required' } })
  const consultation = await prisma.consultation.create({ data: { patientId: request.params.patientId, appointmentId, nutritionistId: userId, templateId, status: 'IN_PROGRESS', startedAt: new Date() } })
  if (appointmentId) await prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'COMPLETED' } })
  return reply.code(201).send(consultation)
})

app.get('/api/v1/consultations/:consultationId', async (request, reply) => {
  const consultation = await prisma.consultation.findUnique({ where: { id: request.params.consultationId }, include: { patient: true, sections: true, measurements: true, diagnoses: true, plans: true } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  return consultation
})

app.post('/api/v1/consultations/:consultationId/complete', async (request, reply) => {
  const consultation = await prisma.consultation.findUnique({ where: { id: request.params.consultationId } })
  if (!consultation) return reply.code(404).send({ code: 'CONSULTATION_NOT_FOUND', message: 'Consulta no encontrada.', fields: {} })
  return prisma.consultation.update({ where: { id: consultation.id }, data: { status: 'COMPLETED', completedAt: new Date() } })
})

app.put('/api/v1/consultations/:consultationId/sections/:sectionKey', async (request, reply) => {
  const { payload = {}, completionState = 'in_progress', updatedAt } = request.body || {}
  const existing = await prisma.clinicalSection.findUnique({ where: { consultationId_sectionKey: { consultationId: request.params.consultationId, sectionKey: request.params.sectionKey } } })
  if (existing && updatedAt && new Date(updatedAt).getTime() !== new Date(existing.lastSavedAt).getTime()) return reply.code(409).send({ code: 'CONCURRENT_EDIT', message: 'La sección cambió en otra sesión. Recarga antes de guardar.', fields: {} })
  const section = await prisma.clinicalSection.upsert({ where: { consultationId_sectionKey: { consultationId: request.params.consultationId, sectionKey: request.params.sectionKey } }, create: { consultationId: request.params.consultationId, sectionKey: request.params.sectionKey, payload, completionState, lastSavedBy: request.headers['x-user-id'] || 'system' }, update: { payload, completionState, lastSavedBy: request.headers['x-user-id'] || 'system' } })
  return section
})

app.get('/api/v1/appointments', async (request) => {
  const { from, to } = request.query
  const appointments = await prisma.appointment.findMany({ where: { practiceId: request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID, startAt: { gte: new Date(from), lte: new Date(to) } }, include: { patient: true }, orderBy: { startAt: 'asc' } })
  return { items: appointments }
})

app.post('/api/v1/appointments', async (request, reply) => {
  const { patientId, startAt, endAt, type = 'FOLLOW_UP', durationMinutes, notifyVia = [], internalNote, patientNote, timeZone = 'America/Mexico_City' } = request.body || {}
  const start = new Date(startAt)
  const end = endAt ? new Date(endAt) : new Date(start.getTime() + Number(durationMinutes || 60) * 60000)
  if (!patientId || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Paciente, fecha y duración válida son obligatorios.', fields: {} })
  const practiceId = request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID
  const overlap = await prisma.appointment.findFirst({ where: { practiceId, status: { notIn: ['CANCELLED', 'NO_SHOW'] }, startAt: { lt: end }, endAt: { gt: start } } })
  if (overlap) return reply.code(409).send({ code: 'APPOINTMENT_OVERLAP', message: 'Ese horario ya está ocupado.', fields: { startAt: 'overlap', endAt: 'overlap' } })
  const appointment = await prisma.appointment.create({ data: { practiceId, patientId, startAt: start, endAt: end, type, status: notifyVia.length ? 'PENDING_CONFIRMATION' : 'SCHEDULED', notifyVia, internalNote, patientNote, timeZone }, include: { patient: true } })
  return reply.code(201).send(appointment)
})

app.post('/api/v1/appointments/:appointmentId/confirm', async (request, reply) => {
  const appointment = await prisma.appointment.findUnique({ where: { id: request.params.appointmentId } })
  if (!appointment) return reply.code(404).send({ code: 'APPOINTMENT_NOT_FOUND', message: 'Cita no encontrada.', fields: {} })
  return prisma.appointment.update({ where: { id: appointment.id }, data: { status: 'CONFIRMED' }, include: { patient: true } })
})

app.get('/api/v1/tasks', async (request) => {
  const { status, type } = request.query
  const tasks = await prisma.task.findMany({
    where: {
      practiceId: request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID,
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
  const practiceId = request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID
  const task = await prisma.task.create({ data: { practiceId, patientId, type, dueAt: new Date(dueAt), referenceId }, include: { patient: true } })
  return reply.code(201).send(task)
})

app.post('/api/v1/tasks/:taskId/complete', async (request, reply) => {
  const task = await prisma.task.findUnique({ where: { id: request.params.taskId } })
  if (!task) return reply.code(404).send({ code: 'TASK_NOT_FOUND', message: 'Seguimiento no encontrado.', fields: {} })
  if (task.status === 'completed') return reply.code(409).send({ code: 'TASK_ALREADY_COMPLETED', message: 'Este seguimiento ya se marcó como entregado.', fields: {} })
  return prisma.task.update({ where: { id: task.id }, data: { status: 'completed', completedAt: new Date() }, include: { patient: true } })
})

app.get('/api/v1/recipes', async (request) => {
  const { search = '', mealType, status = 'ACTIVE' } = request.query
  const where = {
    practiceId: request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID,
    status,
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    ...(mealType ? { mealTypes: { has: mealType } } : {}),
  }
  const recipes = await prisma.recipe.findMany({ where, include: { ingredients: { include: { ingredient: true } } }, orderBy: { name: 'asc' }, take: 100 })
  return { items: recipes }
})

app.post('/api/v1/recipes', async (request, reply) => {
  const { name, mealTypes = [], portions, instructions, nutrition = {}, restrictions = [], imageUrl, ingredients = [] } = request.body || {}
  if (!name || !mealTypes.length) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Nombre y al menos un tiempo de comida son obligatorios.', fields: { name: !name, mealTypes: !mealTypes.length } })
  const validIngredients = ingredients.length ? await prisma.ingredient.findMany({ where: { id: { in: ingredients.map((item) => item.ingredientId).filter(Boolean) }, practiceId: request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID }, select: { id: true } }) : []
  const validIds = new Set(validIngredients.map((item) => item.id))
  const recipe = await prisma.recipe.create({ data: { practiceId: request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID, name, mealTypes, portions, instructions, nutrition, restrictions, imageUrl, ingredients: { create: ingredients.filter((item) => validIds.has(item.ingredientId)).map((item) => ({ ingredientId: item.ingredientId, quantity: item.quantity, unit: item.unit || 'g', equivalence: item.equivalence })) } }, include: { ingredients: { include: { ingredient: true } } } })
  return reply.code(201).send(recipe)
})

app.get('/api/v1/recipes/:recipeId', async (request) => prisma.recipe.findUnique({ where: { id: request.params.recipeId }, include: { ingredients: { include: { ingredient: true } } } }))

app.put('/api/v1/recipes/:recipeId/ingredients', async (request, reply) => {
  const { ingredients = [] } = request.body || {}
  const recipe = await prisma.recipe.findUnique({ where: { id: request.params.recipeId } })
  if (!recipe) return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', message: 'Receta no encontrada.', fields: {} })
  if (!ingredients.length) return reply.code(400).send({ code: 'EMPTY_RECIPE', message: 'La receta debe conservar al menos un ingrediente.', fields: {} })
  const updated = await prisma.$transaction(async (transaction) => {
    await transaction.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } })
    await transaction.recipeIngredient.createMany({ data: ingredients.map((item) => ({ recipeId: recipe.id, ingredientId: item.ingredientId, quantity: item.quantity, unit: item.unit || 'g', equivalence: item.equivalence })) })
    return transaction.recipe.findUnique({ where: { id: recipe.id }, include: { ingredients: { include: { ingredient: true } } } })
  })
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 }
  for (const item of updated.ingredients) { const nutrition = item.ingredient.nutrition || {}; const factor = Number(item.quantity) / 100; for (const key of Object.keys(totals)) totals[key] += Number(nutrition[key] || 0) * factor }
  const servings = Number(updated.portions || 1)
  const nutrition = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round((value / servings) * 10) / 10]))
  return prisma.recipe.update({ where: { id: updated.id }, data: { nutrition, version: { increment: 1 } }, include: { ingredients: { include: { ingredient: true } } } })
})

app.get('/api/v1/recipes/:recipeId/nutrition', async (request, reply) => {
  const recipe = await prisma.recipe.findUnique({ where: { id: request.params.recipeId }, include: { ingredients: { include: { ingredient: true } } } })
  if (!recipe) return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', message: 'Receta no encontrada.', fields: {} })
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 }
  for (const item of recipe.ingredients) {
    const nutrition = item.ingredient.nutrition || {}
    const factor = Number(item.quantity) / 100
    for (const key of Object.keys(totals)) totals[key] += Number(nutrition[key] || 0) * factor
  }
  return { recipeId: recipe.id, servings: Number(recipe.portions || 1), perServing: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round((value / Number(recipe.portions || 1)) * 10) / 10])), ingredients: recipe.ingredients.map((item) => ({ name: item.ingredient.name, quantity: Number(item.quantity), unit: item.unit, equivalence: item.equivalence ? Number(item.equivalence) : null })) }
})

app.post('/api/v1/recipes/:recipeId/recalculate', async (request, reply) => {
  const recipe = await prisma.recipe.findUnique({ where: { id: request.params.recipeId }, include: { ingredients: { include: { ingredient: true } } } })
  if (!recipe) return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', message: 'Receta no encontrada.', fields: {} })
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 }
  for (const item of recipe.ingredients) { const nutrition = item.ingredient.nutrition || {}; const factor = Number(item.quantity) / 100; for (const key of Object.keys(totals)) totals[key] += Number(nutrition[key] || 0) * factor }
  const servings = Number(recipe.portions || 1)
  const nutrition = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round((value / servings) * 10) / 10]))
  const updated = await prisma.recipe.update({ where: { id: recipe.id }, data: { nutrition, version: { increment: 1 } } })
  return { recipe: updated, nutrition, version: updated.version }
})

app.get('/api/v1/ingredients', async (request) => {
  const { search = '', group } = request.query
  const ingredients = await prisma.ingredient.findMany({ where: { practiceId: request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID, status: 'ACTIVE', ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}), ...(group ? { group } : {}) }, orderBy: { name: 'asc' }, take: 200 })
  return { items: ingredients }
})

app.post('/api/v1/ingredients/import', async (request, reply) => {
  const { externalId, source, name, group, unit = 'g', nutrition = {}, equivalence = {}, imageUrl } = request.body || {}
  if (!externalId || !source || !name || !group) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Fuente, identificador, nombre y grupo son obligatorios.', fields: {} })
  const practiceId = request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID
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
  const practiceId = request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID
  const [appointments, pendingConfirmations, followUps, activePatients] = await prisma.$transaction([
    prisma.appointment.findMany({ where: { practiceId, startAt: { gte: start, lte: end } }, include: { patient: true }, orderBy: { startAt: 'asc' } }),
    prisma.appointment.count({ where: { practiceId, startAt: { gte: start, lte: end }, status: 'PENDING_CONFIRMATION' } }),
    prisma.task.count({ where: { practiceId, status: 'pending', type: { in: ['nutrition_plan', 'consultation_report'] } } }),
    prisma.patient.count({ where: { practiceId, status: 'ACTIVE' } }),
  ])
  return { date, stats: { appointments: appointments.length, pendingConfirmations, followUps, activePatients }, appointments, tasks: [] }
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
  const plan = await prisma.nutritionPlan.create({ data: { patientId: request.params.patientId, consultationId, goal } })
  return reply.code(201).send(plan)
})

app.get('/api/v1/plans/:planId', async (request, reply) => {
  const plan = await prisma.nutritionPlan.findUnique({ where: { id: request.params.planId }, include: { patient: true, mealSlots: true, documents: true } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  return plan
})

app.put('/api/v1/plans/:planId/evaluation', async (request, reply) => {
  const { sex, age, weightKg, heightCm, bodyFatPercent, formula = 'mifflin', activityFactor, mets, carbsPercent, proteinPercent, fatPercent, goal } = request.body || {}
  const plan = await prisma.nutritionPlan.findUnique({ where: { id: request.params.planId } })
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
  const plan = await prisma.nutritionPlan.findUnique({ where: { id: request.params.planId } })
  if (!plan || plan.status === 'PUBLISHED') return reply.code(plan ? 409 : 404).send({ code: plan ? 'PLAN_LOCKED' : 'PLAN_NOT_FOUND', message: plan ? 'Los planes publicados no pueden modificarse.' : 'Plan no encontrado.', fields: {} })
  await prisma.$transaction([prisma.mealSlot.deleteMany({ where: { planId: plan.id } }), prisma.mealSlot.createMany({ data: mealSlots.map((slot) => ({ planId: plan.id, dayOfWeek: slot.dayOfWeek, mealType: slot.mealType, recipeId: slot.recipeId, servings: slot.servings, notes: slot.notes })) })])
  return prisma.nutritionPlan.findUnique({ where: { id: plan.id }, include: { mealSlots: true } })
})

app.post('/api/v1/plans/:planId/publish', async (request, reply) => {
  const plan = await prisma.nutritionPlan.findUnique({ where: { id: request.params.planId }, include: { mealSlots: { include: { recipe: true } } } })
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
  const plan = await prisma.nutritionPlan.findUnique({ where: { id: planId } })
  if (!plan) return reply.code(404).send({ code: 'PLAN_NOT_FOUND', message: 'Plan no encontrado.', fields: {} })
  if (plan.status !== 'PUBLISHED') return reply.code(409).send({ code: 'PLAN_NOT_PUBLISHED', message: 'Publica el plan antes de generar su documento.', fields: {} })
  const document = await prisma.document.create({ data: { patientId: plan.patientId, consultationId: plan.consultationId, planId: plan.id, type: 'nutrition_plan', sections: { menu: true, macros: true, recommendations: true }, version: 0 } })
  return reply.code(201).send(document)
})

app.get('/api/v1/documents', async (request) => {
  const { patientId, type } = request.query
  const documents = await prisma.document.findMany({ where: { patientId: patientId || undefined, type: type || undefined, patient: { practiceId: request.headers['x-practice-id'] || process.env.DEFAULT_PRACTICE_ID } }, include: { patient: true, plan: true }, orderBy: { createdAt: 'desc' }, take: 100 })
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
  for (const section of ['Datos generales', 'Antropometría', 'Diagnóstico nutricio', 'Tratamiento']) {
    file.fillColor('#34745f').fontSize(13).text(section)
    file.moveTo(48, file.y + 4).lineTo(564, file.y + 4).strokeColor('#dce8df').stroke()
    file.moveDown()
    file.fillColor('#6e6e73').fontSize(9).text('Información registrada y validada por la profesional responsable.')
    file.moveDown(1.5)
  }
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
  const document = await prisma.document.findUnique({ where: { id: request.params.documentId }, include: { patient: true, consultation: { include: { measurements: true, diagnoses: true } }, plan: true } })
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

app.get('/api/v1/documents/:documentId/download', async (request, reply) => { const document = await prisma.document.findUnique({ where: { id: request.params.documentId } }); if (!document?.storageKey) return reply.code(404).send({ code: 'DOCUMENT_FILE_NOT_FOUND', message: 'Genera el documento antes de descargarlo.', fields: {} }); const filePath = path.resolve(process.env.DOCUMENT_STORAGE_PATH || './storage/documents', document.storageKey); const file = await readFile(filePath); return reply.type('application/pdf').header('Content-Disposition', `attachment; filename="${document.storageKey}"`).send(file) })

app.post('/api/v1/documents/:documentId/deliver', async (request, reply) => {
  const document = await prisma.document.findUnique({ where: { id: request.params.documentId } })
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
