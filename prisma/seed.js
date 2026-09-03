import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const practiceId = '00000000-0000-0000-0000-000000000001'

// Dev-only seeded credential — log in with gabriela@nutristudio.local / nutristudio2026.
const DEV_PASSWORD_HASH = bcrypt.hashSync('nutristudio2026', 10)

async function main() {
  const practice = await prisma.practice.upsert({
    where: { id: practiceId },
    update: {},
    create: { id: practiceId, name: 'Consulta privada Gabriela Alonso', defaultPalette: 'minimal' },
  })

  const nutritionist = await prisma.user.upsert({
    where: { practiceId_email: { practiceId: practice.id, email: 'gabriela@nutristudio.local' } },
    update: { passwordHash: DEV_PASSWORD_HASH },
    create: { practiceId: practice.id, name: 'Gabriela Alonso', email: 'gabriela@nutristudio.local', role: 'OWNER', passwordHash: DEV_PASSWORD_HASH },
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
  await prisma.diagnosis.create({ data: { consultationId: consultation.id, domain: 'INGESTIÓN', code: 'NI-1.5', problem: 'Ingesta energética excesiva', etiology: 'Patrón de comidas irregular', evidence: 'IMC 26.6 y recordatorio de 24 horas' } })
  await prisma.recipe.deleteMany({ where: { practiceId: practice.id } })
  await prisma.recipe.createMany({ data: [
    { practiceId: practice.id, name: 'Avena cocida con manzana', mealTypes: ['breakfast'], portions: 1, nutrition: { kcal: 204, carbs: 29.1, protein: 7.4, fat: 7.2, fiber: 6.3 }, restrictions: [], instructions: 'Cocinar la avena y servir con manzana.' },
    { practiceId: practice.id, name: 'Bowl de bistec con champiñones', mealTypes: ['lunch'], portions: 1, nutrition: { kcal: 464.1, carbs: 33.5, protein: 42, fat: 19.6, fiber: 3.6 }, restrictions: [], instructions: 'Saltear el bistec y acompañar con vegetales.' },
    { practiceId: practice.id, name: 'Yogur griego con fruta', mealTypes: ['snack'], portions: 1, nutrition: { kcal: 200.2, carbs: 21.9, protein: 21.7, fat: 2.9, fiber: 2.3 }, restrictions: [], instructions: 'Servir el yogur y agregar fruta picada.' },
    { practiceId: practice.id, name: 'Ensalada tibia de espinacas', mealTypes: ['dinner'], portions: 1, nutrition: { kcal: 307.3, carbs: 20.3, protein: 23.5, fat: 16.5, fiber: 5.2 }, restrictions: ['sin gluten'], instructions: 'Cocinar los vegetales y servir sobre espinacas.' },
  ] })
  await prisma.ingredient.deleteMany({ where: { practiceId: practice.id } })
  await prisma.ingredient.createMany({ data: [
    { practiceId: practice.id, name: 'Aguacate Hass', group: 'Grasas', unit: 'taza', nutrition: { kcal: 160, carbs: 8.5, protein: 2, fat: 14.7, fiber: 6.7 }, equivalence: { group: 'Grasas', serving: '1/3 pieza', grams: 50 } },
    { practiceId: practice.id, name: 'Avena en hojuelas', group: 'Cereales', unit: 'taza', nutrition: { kcal: 389, carbs: 66.3, protein: 16.9, fat: 6.9, fiber: 10.6 }, equivalence: { group: 'Cereales sin grasa', serving: '1/2 taza', grams: 40 } },
    { practiceId: practice.id, name: 'Pechuga de pollo', group: 'Proteínas', unit: 'gramos', nutrition: { kcal: 165, carbs: 0, protein: 31, fat: 3.6 }, equivalence: { group: 'AOA bajo en grasa', serving: '30 g', grams: 30 } },
    { practiceId: practice.id, name: 'Queso panela', group: 'Lácteos', unit: 'gramos', nutrition: { kcal: 220, carbs: 3.5, protein: 22, fat: 13.5 }, equivalence: { group: 'Leche con grasa', serving: '40 g', grams: 40 } },
    // El resto de estos ocho existen ya en el catálogo SMAE real (prisma/import-smae.js), pero
    // ese import es un script aparte que no corre como parte de este seed -- se repiten aquí a
    // mano (mismos valores nutrimentales, tomados del catálogo real) para que
    // "Bowl de bistec con champiñones"/"Yogur griego con fruta"/"Ensalada tibia de espinacas"
    // tengan ingredientes reales incluso en una base recién sembrada sin el import de SMAE.
    { practiceId: practice.id, name: 'Bistec de res', group: 'AOA MBAG', unit: 'gramos', nutrition: { kcal: 120, carbs: 0, protein: 24, fat: 2.67 }, equivalence: { group: 'AOA muy bajo en grasa', serving: '30 g', grams: 30 } },
    { practiceId: practice.id, name: 'Papa cocida', group: 'Cereales S/G', unit: 'gramos', nutrition: { kcal: 86.76, carbs: 20.15, protein: 1.91, fat: 0.15 }, equivalence: { group: 'Cereales sin grasa', serving: '1 pieza chica', grams: 90 } },
    { practiceId: practice.id, name: 'Champiñón blanco crudo', group: 'Verduras', unit: 'gramos', nutrition: { kcal: 22, carbs: 3.26, protein: 3.09, fat: 0.34 }, equivalence: { group: 'Verdura', serving: '1 taza', grams: 100 } },
    { practiceId: practice.id, name: 'Aceite de oliva', group: 'Grasas sin proteínas', unit: 'gramos', nutrition: { kcal: 880, carbs: 0, protein: 0, fat: 100 }, equivalence: { group: 'Grasa', serving: '1 cdita', grams: 5 } },
    { practiceId: practice.id, name: 'Yogur griego sin azúcar', group: 'Leche descremada', unit: 'gramos', nutrition: { kcal: 59, carbs: 3.6, protein: 10, fat: 0.4 }, equivalence: { group: 'Leche descremada', serving: '1 taza', grams: 200 } },
    { practiceId: practice.id, name: 'Fresa cruda', group: 'Frutas', unit: 'gramos', nutrition: { kcal: 36, carbs: 7.96, protein: 0.64, fat: 0.22 }, equivalence: { group: 'Fruta', serving: '1 taza', grams: 150 } },
    { practiceId: practice.id, name: 'Granola estándar', group: 'Cereales C/G', unit: 'gramos', nutrition: { kcal: 461.9, carbs: 67.14, protein: 10.95, fat: 19.05 }, equivalence: { group: 'Cereal con grasa', serving: '1 cda', grams: 15 } },
    { practiceId: practice.id, name: 'Espinaca cruda', group: 'Verduras', unit: 'gramos', nutrition: { kcal: 23.33, carbs: 3.67, protein: 2.83, fat: 0.33 }, equivalence: { group: 'Verdura', serving: '1 taza', grams: 100 } },
    { practiceId: practice.id, name: 'Jitomate bola', group: 'Verduras', unit: 'gramos', nutrition: { kcal: 17.59, carbs: 3.89, protein: 0.93, fat: 0.19 }, equivalence: { group: 'Verdura', serving: '1 pieza', grams: 120 } },
  ] })
  const oatmeal = await prisma.ingredient.findFirst({ where: { practiceId: practice.id, name: 'Avena en hojuelas' } })
  const avocado = await prisma.ingredient.findFirst({ where: { practiceId: practice.id, name: 'Aguacate Hass' } })
  const oatmealRecipe = await prisma.recipe.findFirst({ where: { practiceId: practice.id, name: 'Avena cocida con manzana' } })
  const steakBowlRecipe = await prisma.recipe.findFirst({ where: { practiceId: practice.id, name: 'Bowl de bistec con champiñones' } })
  const yogurtRecipe = await prisma.recipe.findFirst({ where: { practiceId: practice.id, name: 'Yogur griego con fruta' } })
  const saladRecipe = await prisma.recipe.findFirst({ where: { practiceId: practice.id, name: 'Ensalada tibia de espinacas' } })
  if (oatmealRecipe && oatmeal && avocado) await prisma.recipe.update({ where: { id: oatmealRecipe.id }, data: { ingredients: { create: [{ ingredientId: oatmeal.id, quantity: 40, unit: 'g', equivalence: 1 }, { ingredientId: avocado.id, quantity: 30, unit: 'g', equivalence: 0.5 }] } } })

  // Estas tres, a diferencia de la avena, se habían creado solo con nutrition fija a mano, sin
  // ingredientes -- cualquier recalculo futuro (ej. al editarlas y guardarlas desde
  // NewRecipePage, que recalcula automáticamente) las dejaba en 0 kcal porque no tenían nada
  // que sumar. Ver ESTADO_Y_PENDIENTES.md, deuda técnica de fase 30.
  const findIngredient = (name) => prisma.ingredient.findFirst({ where: { practiceId: practice.id, name } })
  const [steak, potato, mushroom, oliveOil, greekYogurt, strawberry, granola, spinach, tomato] = await Promise.all([
    findIngredient('Bistec de res'), findIngredient('Papa cocida'), findIngredient('Champiñón blanco crudo'), findIngredient('Aceite de oliva'),
    findIngredient('Yogur griego sin azúcar'), findIngredient('Fresa cruda'), findIngredient('Granola estándar'),
    findIngredient('Espinaca cruda'), findIngredient('Jitomate bola'),
  ])
  const queso = await prisma.ingredient.findFirst({ where: { practiceId: practice.id, name: 'Queso panela' } })
  if (steakBowlRecipe && steak && potato && mushroom && oliveOil) await prisma.recipe.update({ where: { id: steakBowlRecipe.id }, data: { ingredients: { create: [{ ingredientId: steak.id, quantity: 150, unit: 'g', equivalence: 5 }, { ingredientId: potato.id, quantity: 150, unit: 'g', equivalence: 1 }, { ingredientId: mushroom.id, quantity: 100, unit: 'g', equivalence: 1 }, { ingredientId: oliveOil.id, quantity: 15, unit: 'g', equivalence: 3 }] } } })
  if (yogurtRecipe && greekYogurt && strawberry && granola) await prisma.recipe.update({ where: { id: yogurtRecipe.id }, data: { ingredients: { create: [{ ingredientId: greekYogurt.id, quantity: 200, unit: 'g', equivalence: 2 }, { ingredientId: strawberry.id, quantity: 100, unit: 'g', equivalence: 1 }, { ingredientId: granola.id, quantity: 10, unit: 'g', equivalence: 0.5 }] } } })
  if (saladRecipe && spinach && queso && tomato && potato && oliveOil) await prisma.recipe.update({ where: { id: saladRecipe.id }, data: { ingredients: { create: [{ ingredientId: spinach.id, quantity: 150, unit: 'g', equivalence: 1.5 }, { ingredientId: queso.id, quantity: 80, unit: 'g', equivalence: 1 }, { ingredientId: tomato.id, quantity: 100, unit: 'g', equivalence: 1 }, { ingredientId: potato.id, quantity: 40, unit: 'g', equivalence: 0.5 }, { ingredientId: oliveOil.id, quantity: 5, unit: 'g', equivalence: 1 }] } } })

  const plan = await prisma.nutritionPlan.create({ data: { patientId: patients[0].id, consultationId: consultation.id, status: 'DRAFT', goal: 'Reducir peso y mejorar energía', formula: 'mifflin', activityMethod: 'factor', activityFactor: 1.375, targetKcal: 1700, carbsPercent: 50, proteinPercent: 25, fatPercent: 25, evaluation: { formulaVersion: 'mifflin_v1', formulaLabel: 'Mifflin-St Jeor', bmr: 1454, bmi: 26.6, bmiCategory: 'sobrepeso', idealWeightRange: { minKg: 50.4, maxKg: 67.8 }, flags: [], inputs: { age: 28, weightKg: 72.4, heightCm: 165, sex: 'female', bodyFatPercent: 31.2 } } } })
  await prisma.mealSlot.createMany({ data: [
    { planId: plan.id, dayOfWeek: 1, mealType: 'breakfast', recipeId: oatmealRecipe?.id, servings: 1 },
    { planId: plan.id, dayOfWeek: 1, mealType: 'lunch', recipeId: steakBowlRecipe?.id, servings: 1 },
    { planId: plan.id, dayOfWeek: 1, mealType: 'snack', recipeId: yogurtRecipe?.id, servings: 1 },
    { planId: plan.id, dayOfWeek: 1, mealType: 'dinner', recipeId: saladRecipe?.id, servings: 1 },
  ] })
  await prisma.document.create({ data: { patientId: patients[0].id, consultationId: consultation.id, planId: plan.id, type: 'consultation_report', sections: { summary: true, anthropometric: true, diagnosis: true, treatment: true }, version: 1 } })

  await prisma.educationMaterial.deleteMany({ where: { practiceId: practice.id } })
  await prisma.educationMaterial.createMany({ data: [
    { practiceId: practice.id, title: 'Método visual de porciones', category: 'Guías prácticas', description: 'Aprende a estimar porciones sin báscula usando tus manos y utensilios.', body: 'Una palma abierta equivale aproximadamente a una porción de proteína; un puño, a una porción de verdura o fruta; una mano ahuecada, a una porción de cereal o tubérculo; y el pulgar completo, a una porción de grasa.', color: 'mint', readMinutes: 8 },
    { practiceId: practice.id, title: 'Leer etiquetas nutricionales', category: 'Material para paciente', description: 'Identifica azúcares añadidos, fibra y tamaños de porción.', body: 'Revisa siempre el tamaño de porción antes que cualquier otro dato: los demás valores de la tabla están calculados sobre esa cantidad, no sobre el envase completo. Busca "azúcares añadidos" por separado de los azúcares naturales.', color: 'yellow', readMinutes: 5 },
    { practiceId: practice.id, title: 'Ideas para aumentar el agua', category: 'Hábitos saludables', description: 'Estrategias simples para mantener una hidratación constante.', body: 'Ten siempre una botella visible en tu espacio de trabajo, asocia un vaso de agua a cada comida y usa una alarma o app si te cuesta recordarlo durante el día.', color: 'blue', readMinutes: 4 },
    { practiceId: practice.id, title: 'Plato balanceado', category: 'Infografía', description: 'Una guía visual para construir comidas completas.', body: 'La mitad del plato con verduras de todos los colores, un cuarto con una fuente de proteína magra y un cuarto con cereal integral o tubérculo.', color: 'coral', readMinutes: 3 },
    { practiceId: practice.id, title: 'Proteínas y equivalentes', category: 'Guía de consulta', description: 'Tabla rápida para elegir y sustituir fuentes de proteína.', body: '30 g de pollo o pescado, 1 huevo, 1/2 taza de leguminosas cocidas o 40 g de queso panela aportan una porción de proteína equivalente entre sí.', color: 'purple', readMinutes: 10 },
    { practiceId: practice.id, title: 'Preparación semanal', category: 'Hábitos saludables', description: 'Planifica tus comidas para reducir decisiones durante la semana.', body: 'Elige un día fijo para planear el menú, cocina bases (granos, proteínas, vegetales asados) por adelantado y arma tus platos combinándolas durante la semana.', color: 'mint', readMinutes: 6 },
  ] })

  await prisma.task.deleteMany({ where: { practiceId: practice.id } })
  await prisma.task.createMany({ data: [
    { practiceId: practice.id, patientId: patients[0].id, type: 'nutrition_plan', dueAt: new Date('2026-08-25T18:00:00.000Z') },
    { practiceId: practice.id, patientId: patients[1].id, type: 'nutrition_plan', dueAt: new Date('2026-08-26T18:00:00.000Z') },
    { practiceId: practice.id, patientId: patients[2].id, type: 'consultation_report', dueAt: new Date('2026-08-27T18:00:00.000Z') },
  ] })
  console.log(`Seed listo: ${practice.name}, ${nutritionist.name}, ${patients.length} pacientes`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
