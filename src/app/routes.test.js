import { describe, expect, it } from 'vitest'
import { parseLocation, pathFor } from './routes.js'

describe('parseLocation', () => {
  it('reconoce los módulos simples', () => {
    expect(parseLocation('/agenda')).toEqual({ module: 'Agenda', patientId: '', consultationId: null })
    expect(parseLocation('/consultas').module).toBe('Consultas')
    expect(parseLocation('/seguimientos').module).toBe('Seguimientos')
    expect(parseLocation('/educacion').module).toBe('Educación')
  })

  it('cae en Hoy con la raíz o con una dirección desconocida', () => {
    expect(parseLocation('/').module).toBe('Hoy')
    expect(parseLocation('').module).toBe('Hoy')
    expect(parseLocation('/lo-que-sea').module).toBe('Hoy')
  })

  it('saca el paciente del expediente', () => {
    expect(parseLocation('/pacientes/abc-123/expediente')).toEqual({ module: 'Expediente', patientId: 'abc-123', consultationId: null })
  })

  it('saca también la consulta cuando la dirección apunta a una sesión concreta', () => {
    expect(parseLocation('/pacientes/abc-123/expediente/ses-9')).toEqual({ module: 'Expediente', patientId: 'abc-123', consultationId: 'ses-9' })
  })

  it('no confunde la lista de pacientes con un expediente', () => {
    expect(parseLocation('/pacientes')).toEqual({ module: 'Pacientes', patientId: '', consultationId: null })
  })

  it('lleva el paciente al constructor de plan', () => {
    expect(parseLocation('/pacientes/abc-123/plan')).toEqual({ module: 'Constructor de plan', patientId: 'abc-123', consultationId: null })
  })
})

describe('pathFor', () => {
  it('construye la dirección del expediente con y sin sesión', () => {
    expect(pathFor('Expediente', 'abc-123')).toBe('/pacientes/abc-123/expediente')
    expect(pathFor('Expediente', 'abc-123', 'ses-9')).toBe('/pacientes/abc-123/expediente/ses-9')
  })

  it('devuelve null para el expediente sin paciente, para no escribir una URL que no lleva a nada', () => {
    expect(pathFor('Expediente', '')).toBe(null)
  })

  it('el constructor sin paciente conserva su dirección simple', () => {
    expect(pathFor('Constructor de plan', '')).toBe('/constructor-plan')
    expect(pathFor('Constructor de plan', 'abc-123')).toBe('/pacientes/abc-123/plan')
  })

  it('las sub-pantallas comparten la dirección de su lista, para que "atrás" vuelva a ella', () => {
    expect(pathFor('Nueva receta')).toBe('/recetas')
    expect(pathFor('Editar receta')).toBe('/recetas')
    expect(pathFor('Documento')).toBe('/documentos')
  })

  it('devuelve null si el módulo no tiene dirección', () => {
    expect(pathFor('Inventado')).toBe(null)
  })
})

describe('ida y vuelta', () => {
  it('toda dirección generada se vuelve a leer como el mismo sitio', () => {
    const casos = [
      ['Agenda', '', null],
      ['Pacientes', '', null],
      ['Consultas', '', null],
      ['Expediente', 'p1', null],
      ['Expediente', 'p1', 'c1'],
      ['Constructor de plan', 'p1', null],
    ]
    for (const [module, patientId, consultationId] of casos) {
      const path = pathFor(module, patientId, consultationId)
      expect(parseLocation(path)).toEqual({ module, patientId, consultationId })
    }
  })
})
