import { describe, expect, it } from 'vitest'
import { LEGAL_DOCUMENTS, pendingAcceptances, validateAcceptance } from './legal.js'

const current = (document) => ({ document, version: LEGAL_DOCUMENTS[document].version })

describe('documentos legales', () => {
  it('a quien no ha aceptado nada le faltan términos y aviso de privacidad', () => {
    expect(pendingAcceptances([]).map((item) => item.document)).toEqual(['terms', 'privacy'])
  })

  it('aceptar una versión anterior no cuenta: hay que aceptar la vigente', () => {
    const pending = pendingAcceptances([{ document: 'terms', version: '2000-01-01' }, current('privacy')])
    expect(pending.map((item) => item.document)).toEqual(['terms'])
    expect(pendingAcceptances([current('terms'), current('privacy')])).toEqual([])
  })

  it('sólo se aceptan documentos requeridos y en su versión vigente', () => {
    expect(validateAcceptance([current('terms'), current('privacy')])).toEqual({ ok: true, documents: ['terms', 'privacy'] })
    expect(validateAcceptance([]).ok).toBe(false)
    expect(validateAcceptance([{ document: 'otro', version: 'x' }]).ok).toBe(false)
    expect(validateAcceptance([current('patientNotice')]).ok).toBe(false)
    expect(validateAcceptance([{ document: 'terms', version: '2000-01-01' }])).toMatchObject({ ok: false, stale: true })
  })
})
