import { describe, expect, it } from 'vitest'
import { hasPatientLevelFields, isPatientLevel, mergeValues, splitUpdates } from './patientFields.js'

describe('isPatientLevel', () => {
  it('reconoce las celdas de antecedentes familiares, incluidos los padecimientos agregados a mano', () => {
    expect(isPatientLevel('clinical', 'Diabetes__Abuelos')).toBe(true)
    expect(isPatientLevel('clinical', 'Obesidad__Ninguno')).toBe(true)
    expect(isPatientLevel('clinical', 'Enfermedad cerebrovascular__Mamá/Papá')).toBe(true)
    expect(isPatientLevel('clinical', 'Padecimientos familiares agregados')).toBe(true)
  })

  it('reconoce los antecedentes personales que no cambian con la visita', () => {
    expect(isPatientLevel('clinical', 'Cirugías realizadas')).toBe(true)
    expect(isPatientLevel('clinical', 'Alergias alimentarias')).toBe(true)
    expect(isPatientLevel('clinical', 'Intolerancias')).toBe(true)
    expect(isPatientLevel('sociocultural', 'Restricciones religiosas o culturales')).toBe(true)
  })

  it('deja en la consulta lo que sí cambia de una visita a otra', () => {
    expect(isPatientLevel('clinical', 'Medicamentos que toma')).toBe(false)
    expect(isPatientLevel('clinical', 'Consumo de alcohol (frecuencia)')).toBe(false)
    expect(isPatientLevel('clinical', 'Diarrea')).toBe(false)
    expect(isPatientLevel('clinical', 'Exploración: Piel seca')).toBe(false)
    expect(isPatientLevel('sociocultural', 'Presupuesto destinado a la alimentación')).toBe(false)
  })

  it('no confunde un campo de otra sección que se llame igual', () => {
    expect(isPatientLevel('dietary', 'Intolerancias')).toBe(false)
    expect(isPatientLevel('anthropometric', 'Diabetes__Abuelos')).toBe(false)
  })

  it('un doble guion bajo que no acaba en parentesco no es antecedente familiar', () => {
    expect(isPatientLevel('clinical', 'Algo__Otra cosa')).toBe(false)
    expect(isPatientLevel('clinical', '__Abuelos')).toBe(false)
  })
})

describe('hasPatientLevelFields', () => {
  it('sólo Clínico y Sociocultural tienen datos del paciente', () => {
    expect(hasPatientLevelFields('clinical')).toBe(true)
    expect(hasPatientLevelFields('sociocultural')).toBe(true)
    expect(hasPatientLevelFields('dietary')).toBe(false)
    expect(hasPatientLevelFields('anthropometric')).toBe(false)
  })
})

describe('splitUpdates', () => {
  it('manda cada cambio a donde le toca', () => {
    const { patient, consultation } = splitUpdates('clinical', {
      'Diabetes__Abuelos': true,
      'Cirugías realizadas': 'Apendicectomía 2019',
      'Medicamentos que toma': 'Metformina 850 mg',
      'Diarrea': true,
    })
    expect(patient).toEqual({ 'Diabetes__Abuelos': true, 'Cirugías realizadas': 'Apendicectomía 2019' })
    expect(consultation).toEqual({ 'Medicamentos que toma': 'Metformina 850 mg', 'Diarrea': true })
  })

  it('en una sección sin datos del paciente todo va a la consulta', () => {
    const { patient, consultation } = splitUpdates('dietary', { 'Vasos de agua al día': '8' })
    expect(patient).toEqual({})
    expect(consultation).toEqual({ 'Vasos de agua al día': '8' })
  })
})

describe('mergeValues', () => {
  it('el dato del paciente pisa al que quedó guardado en una consulta antigua', () => {
    const merged = mergeValues('clinical',
      { 'Cirugías realizadas': 'Ninguna', 'Medicamentos que toma': 'Metformina' },
      { 'Cirugías realizadas': 'Apendicectomía 2019' })
    expect(merged['Cirugías realizadas']).toBe('Apendicectomía 2019')
    expect(merged['Medicamentos que toma']).toBe('Metformina')
  })

  it('no toca las secciones que no tienen datos del paciente', () => {
    const payload = { 'Vasos de agua al día': '8' }
    expect(mergeValues('dietary', payload, { 'Cirugías realizadas': 'x' })).toBe(payload)
  })

  it('funciona con payloads vacíos', () => {
    expect(mergeValues('clinical')).toEqual({})
  })
})
