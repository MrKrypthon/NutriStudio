import { describe, expect, it } from 'vitest'
import { ALL_FREQUENCY_ITEMS, FOOD_GROUPS, FOODS, FREQUENCY_BUCKETS, FREQUENCY_ITEM_BY_KEY } from './foodFrequencyItems.js'

describe('catálogo de frecuencia de consumo', () => {
  it('no repite ninguna clave entre grupos y alimentos (comparten el mismo mapa de clasificación)', () => {
    const keys = ALL_FREQUENCY_ITEMS.map((item) => item.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('toda clave resuelve de vuelta a su ítem', () => {
    for (const item of ALL_FREQUENCY_ITEMS) expect(FREQUENCY_ITEM_BY_KEY[item.key]).toBe(item)
  })

  it('las 6 frecuencias de la referencia están, en orden de menos a más espaciadas', () => {
    expect(FREQUENCY_BUCKETS.map((b) => b.key)).toEqual(['Diario', '4-6 veces por semana', '2-3 veces por semana', 'Semanalmente', '2-3 veces por mes', 'Mensualmente o menos'])
  })

  it('cada ítem tiene las claves mínimas (clave, etiqueta, color) para renderizarse', () => {
    for (const item of [...FOOD_GROUPS, ...FOODS]) {
      expect(item.key).toBeTruthy()
      expect(item.label).toBeTruthy()
      expect(item.color).toBeTruthy()
    }
  })
})

// La cobertura de iconos (que cada clave del catálogo tenga su dibujo en FoodIcon.jsx y viceversa)
// no se prueba aquí: este proyecto no importa archivos .jsx desde las pruebas de lógica — se
// verifica en el navegador, igual que el resto de la interfaz (ver el pase de Puppeteer de esta
// fase, que recorre el tablero y confirma que cada chip trae su icono).
