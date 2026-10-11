import { describe, expect, it } from 'vitest'
import { SEX_OPTIONS, isFemaleSex, isMaleSex, normalizeSex, sexLabel } from './sex.js'

describe('SEX_OPTIONS', () => {
  it('son Hombre y Mujer', () => {
    expect(SEX_OPTIONS).toEqual(['Hombre', 'Mujer'])
  })
})

describe('normalizeSex', () => {
  it('reconoce los valores nuevos', () => {
    expect(normalizeSex('Hombre')).toBe('Hombre')
    expect(normalizeSex('Mujer')).toBe('Mujer')
  })

  it('reconoce los valores viejos de la app', () => {
    expect(normalizeSex('Masculino')).toBe('Hombre')
    expect(normalizeSex('Femenino')).toBe('Mujer')
  })

  it('reconoce las variantes en inglés y de una letra', () => {
    expect(normalizeSex('male')).toBe('Hombre')
    expect(normalizeSex('female')).toBe('Mujer')
    expect(normalizeSex('M')).toBe('Hombre')
    expect(normalizeSex('F')).toBe('Mujer')
  })

  it('no se deja engañar por la primera letra (Mujer ≠ masculino)', () => {
    // La vieja heurística startsWith('m') clasificaba a "Mujer" como hombre.
    expect(isMaleSex('Mujer')).toBe(false)
    expect(isMaleSex('Femenino')).toBe(false)
    expect(isFemaleSex('Hombre')).toBe(false)
    expect(isFemaleSex('Masculino')).toBe(false)
  })

  it('ignora mayúsculas y espacios', () => {
    expect(normalizeSex('  mujer ')).toBe('Mujer')
    expect(normalizeSex('HOMBRE')).toBe('Hombre')
  })

  it('devuelve null para lo que no reconoce', () => {
    expect(normalizeSex('')).toBe(null)
    expect(normalizeSex(null)).toBe(null)
    expect(normalizeSex(undefined)).toBe(null)
    expect(normalizeSex('Prefiero no decirlo')).toBe(null)
  })
})

describe('sexLabel', () => {
  it('traduce los valores viejos a Hombre/Mujer', () => {
    expect(sexLabel('Masculino')).toBe('Hombre')
    expect(sexLabel('Femenino')).toBe('Mujer')
    expect(sexLabel('male')).toBe('Hombre')
  })

  it('deja pasar el valor tal cual si no lo reconoce', () => {
    expect(sexLabel('Prefiero no decirlo')).toBe('Prefiero no decirlo')
    expect(sexLabel(null)).toBe('')
  })
})
