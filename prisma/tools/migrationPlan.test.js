import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BASELINE_MIGRATION, migrationPlan } from './migrationPlan.js'

describe('plan de migración', () => {
  it('una base vacía o con historial sólo aplica lo pendiente', () => {
    expect(migrationPlan({ hasTables: false, hasHistory: false })).toBe('deploy')
    expect(migrationPlan({ hasTables: true, hasHistory: true })).toBe('deploy')
  })

  it('una base de `db push` (tablas sin historial) adopta primero la línea base', () => {
    expect(migrationPlan({ hasTables: true, hasHistory: false })).toBe('baseline-then-deploy')
  })

  it('la línea base es la primera migración en orden', () => {
    const migrations = readdirSync(new URL('../migrations', import.meta.url), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    expect(migrations[0]).toBe(BASELINE_MIGRATION)
  })
})
