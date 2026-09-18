// Datos de ejemplo (temporales) para previsualizar el módulo de Finanzas con información creíble.
// Se borran con: DELETE FROM "FinanceEntry"; (todos los movimientos actuales son de ejemplo).
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const practiceId = '00000000-0000-0000-0000-000000000001'

const NAMES = ['Mariana Torres', 'Diego Ramírez', 'Sofía Hernández', 'Jorge Castillo', 'Valeria Mendoza', 'Renata Fuentes', 'Alejandro Paredes', 'Camila Rosales', 'Yolanda Cimé', 'Miguel Osorio', 'Fernanda Nájera', 'Emilio Duarte', 'Valentina Cruz', 'Alberto Rdz', 'Itzel Marroquín', 'Tomás Villarreal']
const TYPES = [['INITIAL', 80000], ['FOLLOW_UP', 60000], ['QUICK_CONTROL', 40000], ['EMERGENCY', 90000]]
const METHODS = ['TRANSFER', 'CARD', 'CASH', 'TRANSFER', 'CARD', 'TRANSFER'] // sesgo a transferencia/tarjeta
const round = (n, m) => ((n % m) + m) % m

async function main() {
  // Salvaguarda: no duplica ni pisa movimientos reales; sólo siembra una base vacía.
  const existing = await prisma.financeEntry.count()
  if (existing > 0) {
    console.log(`Ya hay ${existing} movimientos en la base; no se siembra nada.`)
    await prisma.$disconnect()
    return
  }
  const entries = []
  // Ingresos: de lunes a sábado, 1–2 consultas por día, de julio a hoy (17 sep 2026).
  for (let offset = 0; offset < 79; offset += 1) {
    const day = new Date(Date.UTC(2026, 6, 1 + offset))
    if (day.getUTCMonth() > 8 || (day.getUTCMonth() === 8 && day.getUTCDate() > 17)) break
    const dow = day.getUTCDay()
    if (dow === 0) continue // sin domingos
    const date = day.toISOString().slice(0, 10)
    const count = dow === 6 ? 1 : 1 + round(offset, 2)
    for (let i = 0; i < count; i += 1) {
      const [type, fee] = TYPES[round(offset + i * 3, TYPES.length)]
      const method = METHODS[round(offset * 2 + i, METHODS.length)]
      const hour = 9 + i * 2 + round(offset, 2)
      entries.push({ practiceId, type: 'INCOME', amountCents: fee, method, category: null, description: NAMES[round(offset * 3 + i, NAMES.length)], occurredAt: new Date(`${date}T${String(hour).padStart(2, '0')}:00:00.000Z`) })
    }
  }
  // Egresos del consultorio, recurrentes por mes.
  const expenses = [
    ['2026-07-01', 600000, 'Renta', 'Renta del consultorio', 'TRANSFER'],
    ['2026-07-06', 145000, 'Insumos', 'Báscula y cinta métrica', 'CASH'],
    ['2026-07-15', 98000, 'Servicios', 'Luz y agua', 'CARD'],
    ['2026-07-22', 120000, 'Publicidad', 'Campaña en redes', 'TRANSFER'],
    ['2026-08-01', 600000, 'Renta', 'Renta del consultorio', 'TRANSFER'],
    ['2026-08-07', 132000, 'Insumos', 'Papelería y material de entrega', 'CASH'],
    ['2026-08-14', 105000, 'Servicios', 'Internet y teléfono', 'CARD'],
    ['2026-08-25', 215000, 'Equipo', 'Báscula de bioimpedancia', 'CARD'],
    ['2026-09-01', 600000, 'Renta', 'Renta del consultorio', 'TRANSFER'],
    ['2026-09-08', 87000, 'Servicios', 'Luz y agua', 'CARD'],
    ['2026-09-11', 118000, 'Insumos', 'Alimentos para pruebas de menú', 'CASH'],
    ['2026-09-16', 95000, 'Servicios', 'Limpieza del consultorio', 'CASH'],
  ]
  for (const [date, amountCents, category, description, method] of expenses) {
    entries.push({ practiceId, type: 'EXPENSE', amountCents, method, category, description, occurredAt: new Date(`${date}T13:00:00.000Z`) })
  }
  await prisma.financeEntry.createMany({ data: entries })
  const incomes = entries.filter((e) => e.type === 'INCOME').length
  console.log(`insertados ${incomes} ingresos y ${entries.length - incomes} egresos`)
  await prisma.$disconnect()
}
main().catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1) })
