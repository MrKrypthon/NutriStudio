/**
 * Consolida en el paciente los datos permanentes que hoy están repartidos por sus consultas.
 *
 * Hasta la fase 83 los antecedentes familiares, las cirugías y las alergias se guardaban dentro de
 * la consulta en que se capturaron, así que el mismo dato podía estar en una visita y faltar en la
 * siguiente. Este script recorre las consultas de cada paciente de la más reciente a la más antigua
 * y se queda con el **primer valor no vacío** de cada campo permanente: el más reciente gana, que es
 * el criterio que usaría cualquiera al mirar el expediente a mano.
 *
 * No borra nada de las consultas. El dato original se queda donde está —es parte del registro de esa
 * visita— y a partir de ahora la pantalla muestra el del paciente por encima.
 *
 * Uso:
 *   node prisma/tools/migrate-patient-sections.js            # sólo informa, no escribe
 *   node prisma/tools/migrate-patient-sections.js --write    # aplica
 */
import { PrismaClient } from '@prisma/client'
import { isFamilyHistoryField, isPatientLevel } from '../../src/lib/patientFields.js'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')
const SECTIONS = ['clinical', 'sociocultural']

// Un campo "vacío" no pisa a uno con contenido: false y '' son la ausencia de dato en esta pantalla
// (una casilla sin marcar, un texto sin escribir), así que no deben tapar lo que sí se capturó.
const hasValue = (value) => {
  if (value === null || value === undefined || value === false) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

async function main() {
  const patients = await prisma.patient.findMany({ select: { id: true, firstName: true, lastName: true } })
  let conDatos = 0
  let camposTotales = 0

  for (const patient of patients) {
    // De la más reciente a la más antigua: el primer valor que aparece es el que vale.
    const consultations = await prisma.consultation.findMany({
      where: { patientId: patient.id },
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
      include: { sections: true },
    })

    const consolidado = {}
    let tablaFamiliarTomada = false
    for (const consultation of consultations) {
      for (const section of consultation.sections) {
        // La sección histórica "general" se fusionó en "clinical"; sus campos siguen el mismo criterio.
        const key = section.sectionKey === 'general' ? 'clinical' : section.sectionKey
        if (!SECTIONS.includes(key)) continue
        const payload = section.payload || {}

        // La tabla de antecedentes familiares se toma entera, de la consulta más reciente que tenga
        // alguna casilla marcada: campo a campo, un "no" reciente perdería frente a un "sí" viejo,
        // porque una casilla desmarcada y una nunca tocada valen las dos `false`.
        const familiares = Object.entries(payload).filter(([field]) => isFamilyHistoryField(key, field))
        if (!tablaFamiliarTomada && familiares.some(([, value]) => hasValue(value))) {
          consolidado[key] ??= {}
          for (const [field, value] of familiares) consolidado[key][field] = value
          tablaFamiliarTomada = true
        }

        for (const [field, value] of Object.entries(payload)) {
          if (isFamilyHistoryField(key, field)) continue
          if (!isPatientLevel(key, field)) continue
          if (!hasValue(value)) continue
          consolidado[key] ??= {}
          if (!(field in consolidado[key])) consolidado[key][field] = value
        }
      }
    }

    const claves = Object.values(consolidado).reduce((total, payload) => total + Object.keys(payload).length, 0)
    if (!claves) continue
    conDatos += 1
    camposTotales += claves
    console.log(`${patient.firstName} ${patient.lastName}: ${claves} campo(s) en ${Object.keys(consolidado).join(', ')}`)

    if (!WRITE) continue
    for (const [sectionKey, payload] of Object.entries(consolidado)) {
      await prisma.patientSection.upsert({
        where: { patientId_sectionKey: { patientId: patient.id, sectionKey } },
        // Si ya existe la sección del paciente es que alguien la editó desde la aplicación: eso es
        // más reciente que cualquier consulta vieja, así que la migración no la toca.
        create: { patientId: patient.id, sectionKey, payload, lastSavedBy: 'migracion-fase-83' },
        update: {},
      })
    }
  }

  console.log(`\n${patients.length} paciente(s) revisados · ${conDatos} con datos permanentes · ${camposTotales} campo(s)`)
  console.log(WRITE ? 'Escrito.' : 'Simulación: vuelve a ejecutar con --write para aplicar.')
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
