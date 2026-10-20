import { describe, expect, it } from 'vitest'
import { clearRecipeDraft, getRecipeDraft, recipeDraftKey, saveRecipeDraft } from './recipeDraftStore.js'

describe('recipeDraftKey', () => {
  it('separa los borradores de cada usuario', () => {
    saveRecipeDraft(recipeDraftKey(undefined, 'usuario-a'), { name: 'Receta de A' })
    expect(getRecipeDraft(recipeDraftKey(undefined, 'usuario-b'))).toBeNull()
    expect(getRecipeDraft(recipeDraftKey(undefined, 'usuario-a')).name).toBe('Receta de A')
    clearRecipeDraft(recipeDraftKey(undefined, 'usuario-a'))
  })

  it('distingue la receta nueva de una existente', () => {
    expect(recipeDraftKey(undefined, 'u')).not.toBe(recipeDraftKey('receta-1', 'u'))
  })
})
