import { describe, expect, it } from 'vitest'
import { formatQuantity, scaleIngredientLine } from './ingredientLines.js'

describe('formatQuantity', () => {
  it('snaps to fractions you can measure in a kitchen', () => {
    expect(formatQuantity(0.4)).toBe('1/3')
    expect(formatQuantity(1.9)).toBe('2')
    expect(formatQuantity(1.5)).toBe('1 1/2')
    expect(formatQuantity(0.9)).toBe('1')
    expect(formatQuantity(2.2)).toBe('2 1/4')
  })

  it('never rounds a real amount down to zero', () => {
    expect(formatQuantity(0.04)).toBe('1/4')
    expect(formatQuantity(0)).toBe('')
  })

  it('keeps weights as whole numbers', () => {
    expect(formatQuantity(56.25)).toBe('56')
    expect(formatQuantity(187.5)).toBe('190')
    expect(formatQuantity(12.4)).toBe('12')
  })
})

describe('scaleIngredientLine', () => {
  it('scales the leading amount and leaves the rest alone', () => {
    expect(scaleIngredientLine('2 tazas de avena', 1.5)).toBe('3 tazas de avena')
    expect(scaleIngredientLine('1/2 taza de leche', 0.5)).toBe('1/4 taza de leche')
    expect(scaleIngredientLine('1 1/2 tazas de arroz', 2)).toBe('3 tazas de arroz')
    expect(scaleIngredientLine('220g de pechuga de pollo', 0.5)).toBe('110g de pechuga de pollo')
    expect(scaleIngredientLine('2-3 cucharadas de aceite', 2)).toBe('4-6 cucharadas de aceite')
  })

  it('understands typographic fractions', () => {
    expect(scaleIngredientLine('½ taza de frijol', 2)).toBe('1 taza de frijol')
    expect(scaleIngredientLine('1½ pieza de pan', 2)).toBe('3 piezas de pan')
    expect(scaleIngredientLine('¼ de cebolla', 0.25)).toBe('1/4 de cebolla')
  })

  it('passes through lines without an amount and unchanged factors', () => {
    expect(scaleIngredientLine('Sal al gusto', 3)).toBe('Sal al gusto')
    expect(scaleIngredientLine('2 huevos', 1)).toBe('2 huevos')
  })

  it('keeps the unit in agreement with the scaled amount', () => {
    expect(scaleIngredientLine('2 huevos', 0.5)).toBe('1 huevo')
    expect(scaleIngredientLine('2 tazas de arroz cocido', 0.5)).toBe('1 taza de arroz cocido')
    expect(scaleIngredientLine('1 taza de leche', 1.5)).toBe('1 1/2 tazas de leche')
    expect(scaleIngredientLine('1 cucharadita de aceite', 0.5)).toBe('1/2 cucharadita de aceite')
    expect(scaleIngredientLine('1/4 de cebolla', 4)).toBe('1 de cebolla')
    expect(scaleIngredientLine('3 Tortillas de maíz', 1 / 3)).toBe('1 Tortilla de maíz')
    // Palabras fuera de la lista no se tocan.
    expect(scaleIngredientLine('2 calabazas tiernas', 0.5)).toBe('1 calabazas tiernas')
  })
})
