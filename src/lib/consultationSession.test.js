import { describe, expect, it } from 'vitest'
import { isToday, localDay, shouldAutoClose } from './consultationSession.js'

describe('localDay', () => {
  it('toma el día del calendario local, no el de UTC', () => {
    // 19:00 del 28 en México (UTC-6) es el 29 en UTC: el día de trabajo sigue siendo el 28.
    const tarde = new Date(2026, 8, 28, 19, 0, 0)
    expect(localDay(tarde)).toBe('2026-09-28')
  })

  it('devuelve null si la fecha no es válida', () => {
    expect(localDay(undefined)).toBe(null)
    expect(localDay('no es una fecha')).toBe(null)
  })
})

describe('isToday', () => {
  const ahora = new Date(2026, 8, 28, 9, 30, 0)

  it('reconoce una sesión iniciada esta misma mañana', () => {
    expect(isToday(new Date(2026, 8, 28, 8, 0, 0), ahora)).toBe(true)
  })

  it('reconoce una sesión iniciada anoche como de otro día', () => {
    expect(isToday(new Date(2026, 8, 27, 23, 30, 0), ahora)).toBe(false)
  })

  it('una sesión de anoche a las 19:00 sigue siendo de ayer aunque en UTC ya fuera hoy', () => {
    // Éste es el caso que rompía al comparar en UTC: se daba por "de hoy" y no se cerraba.
    expect(isToday(new Date(2026, 8, 27, 19, 0, 0), ahora)).toBe(false)
  })
})

describe('shouldAutoClose', () => {
  const ahora = new Date(2026, 8, 28, 9, 30, 0)
  const enCurso = (fecha) => ({ status: 'IN_PROGRESS', startedAt: fecha })

  it('cierra la sesión que quedó abierta de un día anterior', () => {
    expect(shouldAutoClose(enCurso(new Date(2026, 8, 1, 10, 0, 0)), ahora)).toBe(true)
  })

  it('no toca la sesión de hoy, que es la que se está trabajando', () => {
    expect(shouldAutoClose(enCurso(new Date(2026, 8, 28, 8, 0, 0)), ahora)).toBe(false)
  })

  it('no toca una consulta ya cerrada', () => {
    expect(shouldAutoClose({ status: 'COMPLETED', startedAt: new Date(2026, 8, 1) }, ahora)).toBe(false)
  })

  it('usa createdAt cuando la consulta nunca llegó a tener startedAt', () => {
    expect(shouldAutoClose({ status: 'IN_PROGRESS', createdAt: new Date(2026, 8, 20) }, ahora)).toBe(true)
  })

  it('no falla si no hay consulta', () => {
    expect(shouldAutoClose(null, ahora)).toBe(false)
  })
})
