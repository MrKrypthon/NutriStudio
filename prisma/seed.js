import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const practiceId = '00000000-0000-0000-0000-000000000001'

async function main() {
  const practice = await prisma.practice.upsert({
    where: { id: practiceId },
    update: {},
    create: { id: practiceId, name: 'Consulta privada Gabriela Alonso', defaultPalette: 'minimal' },
  })

  const nutritionist = await prisma.user.upsert({
    where: { practiceId_email: { practiceId: practice.id, email: 'gabriela@nutristudio.local' } },
    update: {},
    create: { practiceId: practice.id, name: 'Gabriela Alonso', email: 'gabriela@nutristudio.local', role: 'OWNER' },
  })

  const people = [
    { firstName: 'Mariana', lastName: 'Torres', email: 'mariana.torres@email.com', phone: '+52 55 1234 5678', sex: 'Femenino', birthDate: new Date('1998-02-14') },
    { firstName: 'Diego', lastName: 'Ramírez', email: 'diego.ramirez@email.com', phone: '+52 55 1234 5680', sex: 'Masculino', birthDate: new Date('1992-08-20') },
    { firstName: 'Sofía', lastName: 'Hernández', email: 'sofia.hernandez@email.com', phone: '+52 55 1234 5681', sex: 'Femenino', birthDate: new Date('1995-01-09') },
    { firstName: 'Jorge', lastName: 'Castillo', email: 'jorge.castillo@email.com', phone: '+52 55 1234 5682', sex: 'Masculino', birthDate: new Date('1984-11-03') },
  ]
  const patientIds = ['00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0001-000000000004']

  const patients = []
  for (const [index, person] of people.entries()) {
    patients.push(await prisma.patient.upsert({
      where: { id: patientIds[index] },
      update: person,
      create: { ...person, id: patientIds[index], practiceId: practice.id },
    }))
  }

  const day = '2026-08-26'
  const appointments = [
    ['09:00', 60, 0, 'INITIAL', 'CONFIRMED'],
    ['10:30', 45, 1, 'FOLLOW_UP', 'CONFIRMED'],
    ['12:00', 60, 2, 'FOLLOW_UP', 'PENDING_CONFIRMATION'],
    ['16:30', 45, 3, 'QUICK_CONTROL', 'CONFIRMED'],
  ]
  const appointmentIds = ['00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0002-000000000004']
  for (const [index, [time, duration, personIndex, type, status]] of appointments.entries()) {
    const startAt = new Date(`${day}T${time}:00.000Z`)
    const endAt = new Date(startAt.getTime() + duration * 60 * 1000)
    await prisma.appointment.upsert({
      where: { id: appointmentIds[index] },
      update: { startAt, endAt, status },
      create: { id: appointmentIds[index], practiceId: practice.id, patientId: patients[personIndex].id, startAt, endAt, type, status, notifyVia: ['whatsapp'], timeZone: practice.timeZone },
    })
  }

  await prisma.consultation.deleteMany({ where: { patientId: patients[0].id } })
  const consultation = await prisma.consultation.create({ data: { patientId: patients[0].id, appointmentId: appointmentIds[0], nutritionistId: nutritionist.id, status: 'IN_PROGRESS', startedAt: new Date(`${day}T09:00:00.000Z`) } })
  await prisma.clinicalSection.createMany({ data: [
    { consultationId: consultation.id, sectionKey: 'summary', lastSavedBy: nutritionist.id, completionState: 'complete', payload: { reason: 'Mejorar composición corporal y energía', goal: 'Reducir 4 kg en 12 semanas' } },
    { consultationId: consultation.id, sectionKey: 'general', lastSavedBy: nutritionist.id, completionState: 'complete', payload: { referral: 'Recomendación médica', priority: 'Composición corporal' } },
    { consultationId: consultation.id, sectionKey: 'anthropometric', lastSavedBy: nutritionist.id, completionState: 'complete', payload: { 'Peso (kg)': '72.4', 'Talla (cm)': '165', 'IMC calculado': '26.6', 'Análisis de peso y talla': 'Sobrepeso, con tendencia favorable', 'Cintura (cm)': '84' } },
    { consultationId: consultation.id, sectionKey: 'dietary', lastSavedBy: nutritionist.id, completionState: 'in_progress', payload: { mealsPerDay: 3, waterLiters: 1.2, preferences: ['Avena', 'Pollo', 'Fruta'] } },
    { consultationId: consultation.id, sectionKey: 'treatment', lastSavedBy: nutritionist.id, completionState: 'in_progress', payload: { recommendations: ['Aumentar agua', 'Incluir fibra', 'Caminar 30 minutos'] } },
  ] })
  await prisma.measurement.create({ data: { patientId: patients[0].id, consultationId: consultation.id, measuredAt: new Date(`${day}T09:15:00.000Z`), weightKg: 72.4, heightCm: 165, waistCm: 84, hipCm: 103, bodyFatPercent: 31.2, method: 'Bioimpedancia' } })
  await prisma.diagnosis.create({ data: { consultationId: consultation.id, domain: 'INGESTION', code: 'NI-1.5', problem: 'Ingesta energética excesiva', etiology: 'Patrón de comidas irregular', evidence: 'IMC 26.6 y recordatorio de 24 horas' } })
  await prisma.recipe.deleteMany({ where: { practiceId: practice.id } })
  await prisma.recipe.createMany({ data: [
    { practiceId: practice.id, name: 'Avena cocida con manzana', mealTypes: ['breakfast'], portions: 1, nutrition: { kcal: 204, carbs: 29.1, protein: 7.4, fat: 7.2, fiber: 6.3 }, restrictions: [], instructions: 'Cocinar la avena y servir con manzana.' },
    { practiceId: practice.id, name: 'Bowl de bistec con champiñones', mealTypes: ['lunch'], portions: 1, nutrition: { kcal: 520, carbs: 42, protein: 38, fat: 20 }, restrictions: [], instructions: 'Saltear el bistec y acompañar con vegetales.' },
    { practiceId: practice.id, name: 'Yogur griego con fruta', mealTypes: ['snack'], portions: 1, nutrition: { kcal: 180, carbs: 22, protein: 14, fat: 4 }, restrictions: [], instructions: 'Servir el yogur y agregar fruta picada.' },
    { practiceId: practice.id, name: 'Ensalada tibia de espinacas', mealTypes: ['dinner'], portions: 1, nutrition: { kcal: 285, carbs: 24, protein: 19, fat: 12 }, restrictions: ['sin gluten'], instructions: 'Cocinar los vegetales y servir sobre espinacas.' },
  ] })
  await prisma.ingredient.deleteMany({ where: { practiceId: practice.id } })
  await prisma.ingredient.createMany({ data: [
    { practiceId: practice.id, name: 'Aguacate Hass', group: 'Grasas', unit: 'taza', nutrition: { kcal: 160, carbs: 8.5, protein: 2, fat: 14.7, fiber: 6.7 }, equivalence: { group: 'Grasas', serving: '1/3 pieza', grams: 50 } },
    { practiceId: practice.id, name: 'Avena en hojuelas', group: 'Cereales', unit: 'taza', nutrition: { kcal: 389, carbs: 66.3, protein: 16.9, fat: 6.9, fiber: 10.6 }, equivalence: { group: 'Cereales sin grasa', serving: '1/2 taza', grams: 40 } },
    { practiceId: practice.id, name: 'Pechuga de pollo', group: 'Proteínas', unit: 'gramos', nutrition: { kcal: 165, carbs: 0, protein: 31, fat: 3.6 }, equivalence: { group: 'AOA bajo en grasa', serving: '30 g', grams: 30 } },
    { practiceId: practice.id, name: 'Queso panela', group: 'Lácteos', unit: 'gramos', nutrition: { kcal: 220, carbs: 3.5, protein: 22, fat: 13.5 }, equivalence: { group: 'Leche con grasa', serving: '40 g', grams: 40 } },
  ] })
  const oatmeal = await prisma.ingredient.findFirst({ where: { practiceId: practice.id, name: 'Avena en hojuelas' } })
  const avocado = await prisma.ingredient.findFirst({ where: { practiceId: practice.id, name: 'Aguacate Hass' } })
  const oatmealRecipe = await prisma.recipe.findFirst({ where: { practiceId: practice.id, name: 'Avena cocida con manzana' } })
  const steakBowlRecipe = await prisma.recipe.findFirst({ where: { practiceId: practice.id, name: 'Bowl de bistec con champiñones' } })
  const yogurtRecipe = await prisma.recipe.findFirst({ where: { practiceId: practice.id, name: 'Yogur griego con fruta' } })
  const saladRecipe = await prisma.recipe.findFirst({ where: { practiceId: practice.id, name: 'Ensalada tibia de espinacas' } })
  if (oatmealRecipe && oatmeal && avocado) await prisma.recipe.update({ where: { id: oatmealRecipe.id }, data: { ingredients: { create: [{ ingredientId: oatmeal.id, quantity: 40, unit: 'g', equivalence: 1 }, { ingredientId: avocado.id, quantity: 30, unit: 'g', equivalence: 0.5 }] } } })

  const plan = await prisma.nutritionPlan.create({ data: { patientId: patients[0].id, consultationId: consultation.id, status: 'DRAFT', goal: 'Reducir peso y mejorar energía', formula: 'mifflin', activityMethod: 'factor', activityFactor: 1.375, targetKcal: 1700, carbsPercent: 50, proteinPercent: 25, fatPercent: 25, evaluation: { formulaVersion: 'mifflin_v1', formulaLabel: 'Mifflin-St Jeor', bmr: 1454, bmi: 26.6, bmiCategory: 'sobrepeso', idealWeightRange: { minKg: 50.4, maxKg: 67.8 }, flags: [], inputs: { age: 28, weightKg: 72.4, heightCm: 165, sex: 'female', bodyFatPercent: 31.2 } } } })
  await prisma.mealSlot.createMany({ data: [
    { planId: plan.id, dayOfWeek: 1, mealType: 'breakfast', recipeId: oatmealRecipe?.id, servings: 1 },
    { planId: plan.id, dayOfWeek: 1, mealType: 'lunch', recipeId: steakBowlRecipe?.id, servings: 1 },
    { planId: plan.id, dayOfWeek: 1, mealType: 'snack', recipeId: yogurtRecipe?.id, servings: 1 },
    { planId: plan.id, dayOfWeek: 1, mealType: 'dinner', recipeId: saladRecipe?.id, servings: 1 },
  ] })
  await prisma.document.create({ data: { patientId: patients[0].id, consultationId: consultation.id, planId: plan.id, type: 'consultation_report', sections: { summary: true, anthropometric: true, diagnosis: true, treatment: true }, version: 1 } })

  await prisma.task.deleteMany({ where: { practiceId: practice.id } })
  await prisma.task.createMany({ data: [
    { practiceId: practice.id, patientId: patients[0].id, type: 'nutrition_plan', dueAt: new Date('2026-08-25T18:00:00.000Z') },
    { practiceId: practice.id, patientId: patients[1].id, type: 'nutrition_plan', dueAt: new Date('2026-08-26T18:00:00.000Z') },
    { practiceId: practice.id, patientId: patients[2].id, type: 'consultation_report', dueAt: new Date('2026-08-27T18:00:00.000Z') },
  ] })
  console.log(`Seed listo: ${practice.name}, ${nutritionist.name}, ${patients.length} pacientes`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
