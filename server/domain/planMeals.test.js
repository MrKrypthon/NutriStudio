import { describe, expect, it } from 'vitest'
import { normalizeActiveMeals, parseTimeFromText, suggestMealsFromConsultation } from './planMeals.js'

describe('normalizeActiveMeals', () => {
  it('keeps known meals once, in day order', () => {
    expect(normalizeActiveMeals(['dinner', 'breakfast', 'brunch', 'dinner', 'morningSnack'])).toEqual(['breakfast', 'morningSnack', 'dinner'])
    expect(normalizeActiveMeals('breakfast')).toEqual([])
  })
})

describe('parseTimeFromText', () => {
  it('reads a time written inside free text', () => {
    expect(parseTimeFromText('A las 7:30, 2 huevos con jamón')).toBe('07:30')
    expect(parseTimeFromText('10 am café con pan')).toBe('10:00')
    expect(parseTimeFromText('Come como a las 3 p.m. en el trabajo')).toBe('15:00')
    expect(parseTimeFromText('14 hrs, guisado con arroz')).toBe('14:00')
    expect(parseTimeFromText('12 am')).toBe('00:00')
  })

  it('does not mistake quantities for a time', () => {
    expect(parseTimeFromText('2 huevos y 3 tortillas')).toBeNull()
    expect(parseTimeFromText('1.5 tazas de arroz')).toBeNull()
    expect(parseTimeFromText('')).toBeNull()
  })
})

describe('suggestMealsFromConsultation', () => {
  it('proposes the usual four meals when the consultation says nothing', () => {
    const suggestion = suggestMealsFromConsultation({})
    expect(suggestion.meals).toEqual(['breakfast', 'lunch', 'snack', 'dinner'])
    expect(suggestion.fromConsultation).toBe(false)
    expect(suggestion.times.breakfast).toBe('08:00')
  })

  it('adds the snacks the patient reported, with the times she mentioned', () => {
    const suggestion = suggestMealsFromConsultation({ Desayuno: '9:30 am licuado', 'Colación matutina': 'fruta a las 12:00', 'Almuerzo o comida': 'guisado', 'Colación vespertina': 'No', Cena: 'cereal 9 pm' })
    expect(suggestion.meals).toEqual(['breakfast', 'morningSnack', 'lunch', 'dinner'])
    expect(suggestion.times).toMatchObject({ breakfast: '09:30', morningSnack: '12:00', lunch: '14:00', dinner: '21:00' })
    expect(suggestion.fromConsultation).toBe(true)
    expect(suggestion.stated).toEqual(['breakfast', 'morningSnack', 'dinner'])
  })

  it('also counts what was captured in the 24 h recall', () => {
    const suggestion = suggestMealsFromConsultation({ 'Recordatorio 24 h': { meals: [{ key: 'afternoonSnack', time: '17:30', items: [{ name: 'Yogur' }] }, { key: 'morningSnack', time: '11:00', items: [], note: '' }] } })
    expect(suggestion.meals).toEqual(['breakfast', 'lunch', 'snack', 'dinner'])
    expect(suggestion.times.snack).toBe('17:30')
  })
})
