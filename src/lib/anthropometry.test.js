import { describe, expect, it } from 'vitest'
import { bodyFatEstimates, somatotype } from './anthropometry.js'

const valueOf = (rows, label) => rows.find((row) => row.label === label)?.value

describe('bodyFatEstimates', () => {
  it('Faulkner suma tríceps, subescapular, supraespinal y abdominal (no la cresta ilíaca)', () => {
    const { rows } = bodyFatEstimates({ 'Tricipital (mm)': 10, 'Subescapular (mm)': 12, 'Supraespinal (mm)': 8, 'Abdominal (mm)': 20, 'Cresta ilíaca (mm)': 50 }, { sex: 'Mujer' })
    // 0.153 × 50 + 5.783
    expect(valueOf(rows, 'Faulkner')).toBe(13.4)
  })
})

describe('somatotype (Heath-Carter)', () => {
  const base = { 'Talla (cm)': 170.18, 'Peso (kg)': 65, 'Tricipital (mm)': 10, 'Subescapular (mm)': 12, 'Supraespinal (mm)': 8, 'Húmero (cm)': 7, 'Fémur (cm)': 9.5, 'Brazo contraído (cm)': 32, 'Pantorrilla (cm)': 37, 'Pantorrilla medial (mm)': 10 }

  it('corrige el perímetro de pantorrilla con su pliegue', () => {
    // 0.858·7 + 0.601·9.5 + 0.188·(32 − 1) + 0.161·(37 − 1) − 0.131·170.18 + 4.5
    expect(somatotype(base).meso).toBe(5.55)
  })

  it('sin el pliegue de pantorrilla no inventa la mesomorfia', () => {
    const { 'Pantorrilla medial (mm)': _omit, ...rest } = base
    expect(somatotype(rest).meso).toBeNull()
  })

  it('escala la endomorfia por estatura (a 170.18 cm queda igual)', () => {
    expect(somatotype(base).endo).toBe(3.06)
    expect(somatotype({ ...base, 'Talla (cm)': 185 }).endo).toBeLessThan(3.06)
  })
})
