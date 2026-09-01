import { describe, expect, it } from 'vitest'
import { translateFoodQuery } from './foodDictionary.js'

describe('translateFoodQuery', () => {
  it('translates an exact known Spanish food name to English', () => {
    expect(translateFoodQuery('Calabaza italiana cruda')).toBe('Zucchini, raw')
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(translateFoodQuery('  CALABAZA ITALIANA CRUDA  ')).toBe('Zucchini, raw')
  })

  it('matches a shorter query against a longer known phrase', () => {
    expect(translateFoodQuery('chayote')).toBe('Chayote, fruit, raw')
  })

  it('returns null when there is no known translation', () => {
    expect(translateFoodQuery('un alimento que no está en el diccionario')).toBeNull()
  })
})
