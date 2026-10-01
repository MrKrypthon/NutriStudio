// Materializa el historial clínico real (16 pacientes con citas, consultas, mediciones,
// diagnósticos y planes) capturado en prisma/data/demo-practice.json, más movimientos de
// finanzas, para que cualquiera que clone el repo y corra `npm run dev:all` sobre una base vacía
// vea de inmediato una práctica con contenido real en Hoy, Agenda, Pacientes, Finanzas y
// Constructor de plan -- no sólo los 4 pacientes mínimos de prisma/seed.js.
//
// Las fechas del JSON se guardaron como "offset en días respecto al momento del export", no como
// fechas absolutas: este script las vuelve a anclar a HOY cada vez que corre, así que el resultado
// se ve igual de vigente sin importar cuándo se clone el repo. Es idempotente por paciente: antes
// de recrear las citas/consultas de un paciente del catálogo, borra las que ya tuviera.
//
// Uso: node prisma/import-demo-practice.js [practiceId]

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const prisma = new PrismaClient()
const here = path.dirname(fileURLToPath(import.meta.url))
const practiceId = process.argv[2] || '00000000-0000-0000-0000-000000000001'

const BASE_PATIENT_IDS = [
  '00000000-0000-0000-0001-000000000001',
  '00000000-0000-0000-0001-000000000002',
  '00000000-0000-0000-0001-000000000003',
  '00000000-0000-0000-0001-000000000004',
]
const patientIdFor = (index) => BASE_PATIENT_IDS[index] || `00000000-0000-0000-0001-${String(index + 1).padStart(12, '0')}`

const now = Date.now()
const fromOffset = (offsetDays) => (offsetDays == null ? null : new Date(now + offsetDays * 86400000))

// Un puñado de citas vivas ancladas a hoy y a los próximos días, encima del historial importado,
// para que Hoy y Agenda no dependan sólo de offsets negativos (historial) -- también hay algo que
// confirmar o atender ahora mismo, como en una práctica real.
const UPCOMING = [
  { patientIndex: 0, dayOffset: 0, time: '09:00', durationMin: 60, type: 'FOLLOW_UP', status: 'CONFIRMED' },
  { patientIndex: 1, dayOffset: 0, time: '11:00', durationMin: 45, type: 'QUICK_CONTROL', status: 'CONFIRMED' },
  { patientIndex: 2, dayOffset: 0, time: '15:30', durationMin: 45, type: 'FOLLOW_UP', status: 'PENDING_CONFIRMATION' },
  { patientIndex: 3, dayOffset: 2, time: '10:00', durationMin: 60, type: 'FOLLOW_UP', status: 'CONFIRMED' },
  { patientIndex: 6, dayOffset: 4, time: '12:30', durationMin: 45, type: 'FOLLOW_UP', status: 'PENDING_CONFIRMATION' },
]
// Mariana (índice 0) demuestra el flujo de edición en vivo: consulta de hoy ya empezada, sin
// terminar, con algo de contenido real para no abrir una sección en blanco.
const TODAY_CONSULTATION_SECTIONS = [
  { sectionKey: 'summary', payload: { 'Motivo de consulta': 'Seguimiento mensual de su plan de reducción de grasa', 'Objetivo': 'Evaluar adherencia y ajustar el plan si hace falta' } },
  { sectionKey: 'anthropometric', payload: { 'Peso (kg)': '70.8', 'Talla (cm)': '165', 'IMC calculado': '26', 'Análisis de peso y talla': 'Baja de peso sostenida, buena adherencia' } },
]

// Consultas casi vacías (0-1 secciones, sin mediciones/diagnósticos/planes): quedaron así de
// pruebas sueltas contra la base real, no son contenido de demo -- se descartan al importar.
const isSubstantial = (c) => c.sections.length > 1 || c.measurements.length > 0 || c.diagnoses.length > 0 || c.plans.length > 0

async function main() {
  const practice = await prisma.practice.findUniqueOrThrow({ where: { id: practiceId } })
  const nutritionist = await prisma.user.findFirstOrThrow({ where: { practiceId, role: 'OWNER' } })
  const data = JSON.parse(readFileSync(path.join(here, 'data/demo-practice.json'), 'utf8'))

  const recipeIdByName = new Map()
  const resolveRecipeId = async (name) => {
    if (!name) return null
    if (recipeIdByName.has(name)) return recipeIdByName.get(name)
    const recipe = await prisma.recipe.findFirst({ where: { practiceId, name } })
    recipeIdByName.set(name, recipe?.id || null)
    return recipe?.id || null
  }

  for (const [index, person] of data.entries()) {
    const patientId = patientIdFor(index)
    await prisma.patient.upsert({
      where: { id: patientId },
      update: { firstName: person.firstName, lastName: person.lastName, email: person.email, phone: person.phone, sex: person.sex, birthDate: person.birthDateISO ? new Date(person.birthDateISO) : null },
      create: { id: patientId, practiceId, firstName: person.firstName, lastName: person.lastName, email: person.email, phone: person.phone, sex: person.sex, birthDate: person.birthDateISO ? new Date(person.birthDateISO) : null },
    })
    // Idempotente: limpia lo que este paciente ya tuviera importado antes de recrearlo con fechas
    // frescas (las consultas se llevan en cascada sus secciones/mediciones/diagnósticos/planes).
    await prisma.consultation.deleteMany({ where: { patientId } })
    await prisma.appointment.deleteMany({ where: { patientId } })

    const createdAppointmentIds = []
    for (const appt of person.appointments) {
      const startAt = fromOffset(appt.startOffsetDays)
      const endAt = new Date(startAt.getTime() + appt.durationMin * 60000)
      const created = await prisma.appointment.create({ data: { practiceId, patientId, startAt, endAt, type: appt.type, status: appt.status, notifyVia: ['whatsapp'], timeZone: practice.timeZone } })
      createdAppointmentIds.push(created.id)
    }

    for (const c of person.consultations) {
      if (!isSubstantial(c)) continue
      const consultation = await prisma.consultation.create({ data: {
        patientId, nutritionistId: nutritionist.id, status: c.status,
        appointmentId: c.appointmentIndex >= 0 ? createdAppointmentIds[c.appointmentIndex] : null,
        startedAt: fromOffset(c.startedOffsetDays), completedAt: fromOffset(c.completedOffsetDays),
      } })
      if (c.sections.length) await prisma.clinicalSection.createMany({ data: c.sections.map((s) => ({ consultationId: consultation.id, sectionKey: s.sectionKey, payload: s.payload, completionState: s.completionState, lastSavedBy: nutritionist.id })) })
      if (c.measurements.length) await prisma.measurement.createMany({ data: c.measurements.map((m) => ({ patientId, consultationId: consultation.id, measuredAt: fromOffset(m.measuredOffsetDays), weightKg: m.weightKg, heightCm: m.heightCm, waistCm: m.waistCm, hipCm: m.hipCm, abdomenCm: m.abdomenCm, bodyFatPercent: m.bodyFatPercent, muscleMassKg: m.muscleMassKg, method: m.method, notes: m.notes })) })
      if (c.diagnoses.length) await prisma.diagnosis.createMany({ data: c.diagnoses.map((d) => ({ consultationId: consultation.id, domain: d.domain, code: d.code, problem: d.problem, etiology: d.etiology, evidence: d.evidence })) })
      for (const plan of c.plans) {
        const createdPlan = await prisma.nutritionPlan.create({ data: {
          patientId, consultationId: consultation.id, status: plan.status, goal: plan.goal, formula: plan.formula,
          activityMethod: plan.activityMethod, activityFactor: plan.activityFactor, targetKcal: plan.targetKcal,
          carbsPercent: plan.carbsPercent, proteinPercent: plan.proteinPercent, fatPercent: plan.fatPercent,
          evaluation: plan.evaluation, hydrationNote: plan.hydrationNote, recommendations: plan.recommendations,
        } })
        for (const ms of plan.mealSlots) {
          const recipeId = await resolveRecipeId(ms.recipeName)
          await prisma.mealSlot.create({ data: { planId: createdPlan.id, dayOfWeek: ms.dayOfWeek, mealType: ms.mealType, recipeId, servings: ms.servings } }).catch(() => {})
        }
      }
    }
  }

  for (const upcoming of UPCOMING) {
    const patientId = patientIdFor(upcoming.patientIndex)
    const [h, m] = upcoming.time.split(':').map(Number)
    const startAt = new Date(now + upcoming.dayOffset * 86400000)
    startAt.setUTCHours(h, m, 0, 0)
    const endAt = new Date(startAt.getTime() + upcoming.durationMin * 60000)
    const appointment = await prisma.appointment.create({ data: { practiceId, patientId, startAt, endAt, type: upcoming.type, status: upcoming.status, notifyVia: ['whatsapp'], timeZone: practice.timeZone } })
    if (upcoming.dayOffset === 0 && upcoming.patientIndex === 0) {
      const consultation = await prisma.consultation.create({ data: { patientId, appointmentId: appointment.id, nutritionistId: nutritionist.id, status: 'IN_PROGRESS', startedAt: new Date() } })
      await prisma.clinicalSection.createMany({ data: TODAY_CONSULTATION_SECTIONS.map((s) => ({ consultationId: consultation.id, sectionKey: s.sectionKey, payload: s.payload, completionState: 'complete', lastSavedBy: nutritionist.id })) })
    }
  }

  // Finanzas: ingresos de lunes a sábado en las últimas ~11 semanas hasta hoy (1-2 consultas por
  // día), más los egresos recurrentes del consultorio (renta, servicios, insumos) mes a mes --
  // mismo patrón que antes vivía, sin usarse, en prisma/tools/seed-finance-demo.cjs, ahora anclado
  // a hoy para no quedar obsoleto.
  const existingFinance = await prisma.financeEntry.count({ where: { practiceId } })
  if (existingFinance === 0) {
    const NAMES = data.map((p) => `${p.firstName} ${p.lastName}`)
    const TYPES = [['INITIAL', 80000], ['FOLLOW_UP', 60000], ['QUICK_CONTROL', 40000], ['EMERGENCY', 90000]]
    const METHODS = ['TRANSFER', 'CARD', 'CASH', 'TRANSFER', 'CARD', 'TRANSFER']
    const mod = (n, m) => ((n % m) + m) % m
    const entries = []
    for (let dayOffset = -76; dayOffset <= 0; dayOffset += 1) {
      const day = new Date(now + dayOffset * 86400000)
      if (day.getUTCDay() === 0) continue // sin domingos
      const count = day.getUTCDay() === 6 ? 1 : 1 + mod(dayOffset, 2)
      for (let i = 0; i < count; i += 1) {
        const [type, fee] = TYPES[mod(dayOffset + i * 3, TYPES.length)]
        const method = METHODS[mod(dayOffset * 2 + i, METHODS.length)]
        const occurredAt = new Date(day); occurredAt.setUTCHours(9 + i * 2 + mod(dayOffset, 2), 0, 0, 0)
        entries.push({ practiceId, type: 'INCOME', amountCents: fee, method, description: NAMES[mod(dayOffset * 3 + i, NAMES.length)], occurredAt })
      }
    }
    const expenseTemplate = [
      [-75, 600000, 'Renta', 'Renta del consultorio', 'TRANSFER'], [-70, 145000, 'Insumos', 'Báscula y cinta métrica', 'CASH'],
      [-61, 98000, 'Servicios', 'Luz y agua', 'CARD'], [-54, 120000, 'Publicidad', 'Campaña en redes', 'TRANSFER'],
      [-45, 600000, 'Renta', 'Renta del consultorio', 'TRANSFER'], [-39, 132000, 'Insumos', 'Papelería y material de entrega', 'CASH'],
      [-32, 105000, 'Servicios', 'Internet y teléfono', 'CARD'], [-21, 215000, 'Equipo', 'Báscula de bioimpedancia', 'CARD'],
      [-15, 600000, 'Renta', 'Renta del consultorio', 'TRANSFER'], [-8, 87000, 'Servicios', 'Luz y agua', 'CARD'],
      [-5, 118000, 'Insumos', 'Alimentos para pruebas de menú', 'CASH'], [-2, 95000, 'Servicios', 'Limpieza del consultorio', 'CASH'],
    ]
    for (const [dayOffset, amountCents, category, description, method] of expenseTemplate) {
      const occurredAt = new Date(now + dayOffset * 86400000); occurredAt.setUTCHours(13, 0, 0, 0)
      entries.push({ practiceId, type: 'EXPENSE', amountCents, method, category, description, occurredAt })
    }
    await prisma.financeEntry.createMany({ data: entries })
    const incomes = entries.filter((e) => e.type === 'INCOME').length
    console.log(`Finanzas: ${incomes} ingresos, ${entries.length - incomes} egresos`)
  } else {
    console.log(`Finanzas: ya hay ${existingFinance} movimientos, no se siembra de nuevo`)
  }

  console.log(`Práctica demo lista: ${data.length} pacientes con historial real, agenda viva y finanzas a favor.`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
