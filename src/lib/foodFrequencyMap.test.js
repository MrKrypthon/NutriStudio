import { describe, expect, it } from 'vitest'
import { assignItem, itemsInBucket, unassignItem, unassignedItems } from './foodFrequencyMap.js'

describe('assignItem', () => {
  it('agrega el ítem al bucket sin mutar el mapa original', () => {
    const map = {}
    const next = assignItem(map, 'fruta', 'Diario')
    expect(next).toEqual({ fruta: 'Diario' })
    expect(map).toEqual({})
  })

  it('reclasificar un ítem reemplaza su bucket anterior, no lo duplica', () => {
    const map = { fruta: 'Semanalmente' }
    const next = assignItem(map, 'fruta', 'Diario')
    expect(next).toEqual({ fruta: 'Diario' })
  })
})

describe('unassignItem', () => {
  it('quita el ítem del mapa', () => {
    const map = { fruta: 'Diario', verdura: 'Diario' }
    expect(unassignItem(map, 'fruta')).toEqual({ verdura: 'Diario' })
  })

  it('no falla ni crea una clave nueva si el ítem no estaba clasificado', () => {
    const map = { fruta: 'Diario' }
    const next = unassignItem(map, 'verdura')
    expect(next).toEqual(map)
  })
})

describe('itemsInBucket', () => {
  it('devuelve sólo las claves de ese bucket, en el orden del catálogo', () => {
    const map = { pizza: 'Mensualmente', fruta: 'Diario', verdura: 'Diario' }
    expect(itemsInBucket(map, 'Diario', ['fruta', 'verdura', 'pizza'])).toEqual(['fruta', 'verdura'])
  })

  it('devuelve una lista vacía si nada está clasificado ahí', () => {
    expect(itemsInBucket({}, 'Diario', ['fruta'])).toEqual([])
  })
})

describe('unassignedItems', () => {
  const buckets = ['Diario', 'Semanalmente']

  it('deja fuera lo ya clasificado en un bucket válido', () => {
    const map = { fruta: 'Diario' }
    expect(unassignedItems(map, ['fruta', 'verdura'], buckets)).toEqual(['verdura'])
  })

  it('un ítem clasificado en un bucket que ya no existe en el catálogo vuelve a aparecer como sin clasificar', () => {
    // Pasa si se quita una frecuencia del catálogo más adelante: el dato viejo no debe desaparecer
    // en silencio, sino volver a la paleta para que se reclasifique.
    const map = { fruta: 'Bucket que ya no existe' }
    expect(unassignedItems(map, ['fruta'], buckets)).toEqual(['fruta'])
  })
})
