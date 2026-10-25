import { describe, expect, it } from 'vitest'
import { activityFactorPresets, activityPercentPresets, calculateBmi, classifyBmi, computeEnergyRequirement, computeMacros, idealWeightRange, NutritionEngineError } from './nutrition.js'

describe('activityFactorPresets', () => {
  it('offers Harris-Benedict five levels including "Muy activa" 1.9', () => {
    expect(activityFactorPresets({ formula: 'harris', sex: 'female' }).map((preset) => preset.value)).toEqual([1.2, 1.375, 1.55, 1.725, 1.9])
    expect(activityFactorPresets({ formula: 'harris', sex: 'male' }).map((preset) => preset.value)).toEqual([1.2, 1.375, 1.55, 1.725, 1.9])
  })
  it('uses the sex-specific set for Valencia, FAO/OMS and Mifflin', () => {
    for (const formula of ['valencia', 'fao', 'schofield', 'mifflin']) {
      expect(activityFactorPresets({ formula, sex: 'female' }).map((preset) => preset.value)).toEqual([1.2, 1.56, 1.64, 1.82])
      expect(activityFactorPresets({ formula, sex: 'male' }).map((preset) => preset.value)).toEqual([1.2, 1.55, 1.78, 2.1])
    }
    expect(activityFactorPresets({ formula: 'mifflin', sex: 'Mujer' }).map((preset) => preset.value)).toEqual([1.2, 1.56, 1.64, 1.82])
    expect(activityFactorPresets({ formula: 'mifflin', sex: 'Hombre' }).map((preset) => preset.value)).toEqual([1.2, 1.55, 1.78, 2.1])
  })
})

describe('activityPercentPresets', () => {
  it('offers 30/40/50 for Mifflin and 10/20/30/40 for the other formulas', () => {
    expect(activityPercentPresets({ formula: 'mifflin' }).map((preset) => preset.value)).toEqual([30, 40, 50])
    for (const formula of ['harris', 'fao', 'valencia', 'cunningham']) {
      expect(activityPercentPresets({ formula }).map((preset) => preset.value)).toEqual([10, 20, 30, 40])
    }
  })
})

describe('computeEnergyRequirement activity by percentage', () => {
  const base = { sex: 'female', age: 28, weightKg: 72.4, heightCm: 165, activityFactor: 1.375 }
  it('adds the percentage of the BMR to the total expenditure', () => {
    const result = computeEnergyRequirement({ ...base, formula: 'mifflin', activityPercent: 40 })
    expect(result.activityMethod).toBe('percent')
    expect(result.activityPercent).toBe(40)
    expect(result.bmr).toBe(1454)
    expect(result.get).toBe(Math.round(1454 * 1.4))
    expect(result.activityKcal).toBe(result.get - result.bmr)
    expect(result.inputs.activityPercent).toBe(40)
  })
  it('ignores an invalid percentage and falls back to the factor', () => {
    for (const activityPercent of [0, -10, 101, 'abc']) {
      const result = computeEnergyRequirement({ ...base, formula: 'mifflin', activityPercent })
      expect(result.activityMethod).toBe('factor')
      expect(result.get).toBe(2000)
      expect(result.inputs.activityPercent).toBeNull()
    }
  })
})

describe('calculateBmi', () => {
  it('computes weight over height squared in meters', () => {
    expect(calculateBmi(72.4, 165)).toBeCloseTo(26.59, 1)
  })
})

describe('classifyBmi', () => {
  it.each([
    [17, 'bajo_peso'],
    [18.5, 'normal'],
    [24.9, 'normal'],
    [25, 'sobrepeso'],
    [29.9, 'sobrepeso'],
    [30, 'obesidad_i'],
    [34.9, 'obesidad_i'],
    [35, 'obesidad_ii'],
    [39.9, 'obesidad_ii'],
    [40, 'obesidad_iii'],
  ])('classifies bmi %s as %s', (bmi, expected) => {
    expect(classifyBmi(bmi)).toBe(expected)
  })
})

describe('idealWeightRange', () => {
  it('returns the WHO-normal-BMI weight window for a given height', () => {
    const range = idealWeightRange(165)
    expect(range.minKg).toBeCloseTo(50.4, 1)
    expect(range.maxKg).toBeCloseTo(67.8, 1)
  })
})

describe('computeEnergyRequirement formulas', () => {
  const base = { sex: 'female', age: 28, weightKg: 72.4, heightCm: 165, activityFactor: 1.375 }

  it('mifflin: matches the Mifflin-St Jeor equation', () => {
    const result = computeEnergyRequirement({ ...base, formula: 'mifflin' })
    // 10*72.4 + 6.25*165 - 5*28 - 161 = 724 + 1031.25 - 140 - 161 = 1454.25
    expect(result.bmr).toBe(1454)
    expect(result.formulaVersion).toBe('mifflin_v1')
    expect(result.get).toBe(Math.round(1454.25 * 1.375))
  })

  it('harris: matches the Harris-Benedict (1984) equation for men', () => {
    const result = computeEnergyRequirement({ ...base, sex: 'male', formula: 'harris' })
    // 13.397*72.4 + 4.799*165 - 5.677*28 + 88.362
    const expected = (13.397 * 72.4) + (4.799 * 165) - (5.677 * 28) + 88.362
    expect(result.bmr).toBe(Math.round(expected))
  })

  it('fao/schofield: uses the age-appropriate bracket instead of always applying 18-30', () => {
    const young = computeEnergyRequirement({ ...base, age: 25, formula: 'fao' })
    const older = computeEnergyRequirement({ ...base, age: 45, formula: 'fao' })
    // 25y female: 14.7*72.4 + 496 ; 45y female: 8.7*72.4 + 829
    expect(young.bmr).toBe(Math.round(14.7 * 72.4 + 496))
    expect(older.bmr).toBe(Math.round(8.7 * 72.4 + 829))
    expect(young.bmr).not.toBe(older.bmr)
    expect(older.formulaVersion).toBe('schofield_v1')
  })

  it('valencia: uses the age-appropriate bracket for the Mexican-population equation', () => {
    const young = computeEnergyRequirement({ ...base, sex: 'male', age: 25, formula: 'valencia' })
    const older = computeEnergyRequirement({ ...base, sex: 'male', age: 45, formula: 'valencia' })
    // 25y male: 13.37*72.4 + 747 ; 45y male: 13.08*72.4 + 693
    expect(young.bmr).toBe(Math.round(13.37 * 72.4 + 747))
    expect(older.bmr).toBe(Math.round(13.08 * 72.4 + 693))
    expect(young.bmr).not.toBe(older.bmr)
    expect(older.formulaVersion).toBe('valencia_v1')
  })

  it('cunningham and katch-mcardle require body fat percent to compute lean mass', () => {
    const cunningham = computeEnergyRequirement({ ...base, formula: 'cunningham', bodyFatPercent: 30 })
    const leanMass = 72.4 * (1 - 30 / 100)
    expect(cunningham.bmr).toBe(Math.round(500 + 22 * leanMass))

    const katch = computeEnergyRequirement({ ...base, formula: 'katch-mcardle', bodyFatPercent: 30 })
    expect(katch.bmr).toBe(Math.round(370 + 21.6 * leanMass))
  })

  it('rejects an unknown formula', () => {
    expect(() => computeEnergyRequirement({ ...base, formula: 'invented' })).toThrow(NutritionEngineError)
    expect(() => computeEnergyRequirement({ ...base, formula: 'toString' })).toThrow(NutritionEngineError)
    expect(() => computeEnergyRequirement({ ...base, formula: '__proto__' })).toThrow(NutritionEngineError)
  })

  it('uses METS instead of the activity factor when a full METS payload is provided', () => {
    const result = computeEnergyRequirement({ ...base, formula: 'mifflin', mets: { met: 6, minutes: 45, sessionsPerWeek: 3 } })
    expect(result.activityMethod).toBe('mets')
  })

  it('ignores non-numeric or negative METS and falls back to the activity factor', () => {
    const plain = computeEnergyRequirement({ ...base, formula: 'mifflin', activityFactor: 1.2 })
    for (const mets of [{ met: 'abc', minutes: 45, sessionsPerWeek: 3 }, { met: -6, minutes: 45, sessionsPerWeek: 3 }]) {
      const result = computeEnergyRequirement({ ...base, formula: 'mifflin', activityFactor: 1.2, mets })
      expect(result.activityMethod).toBe('factor')
      expect(result.get).toBe(plain.get)
      expect(Number.isFinite(result.targetKcal)).toBe(true)
    }
  })

  it('flags implausible energy estimates for professional review instead of silently accepting them', () => {
    const result = computeEnergyRequirement({ sex: 'female', age: 80, weightKg: 20, heightCm: 100, formula: 'mifflin', activityFactor: 1.0 })
    expect(result.flags.some((flag) => flag.code === 'GET_OUT_OF_RANGE')).toBe(true)
  })

  it('includes bmi and ideal weight range alongside the energy result', () => {
    const result = computeEnergyRequirement({ ...base, formula: 'mifflin' })
    expect(result.bmi).toBeCloseTo(26.6, 1)
    expect(result.bmiCategory).toBe('sobrepeso')
    expect(result.idealWeightRange.minKg).toBeGreaterThan(0)
  })
})

describe('computeMacros', () => {
  it('splits kcal into grams using 4/4/9 kcal-per-gram factors', () => {
    const result = computeMacros({ kcal: 2000, carbsPercent: 50, proteinPercent: 25, fatPercent: 25 })
    expect(result.macros.carbs.grams).toBeCloseTo(250, 0)
    expect(result.macros.protein.grams).toBeCloseTo(125, 0)
    expect(result.macros.fat.grams).toBeCloseTo(55.6, 0)
  })

  it('accepts a distribution within the 0.1 tolerance', () => {
    expect(() => computeMacros({ kcal: 2000, carbsPercent: 50, proteinPercent: 25, fatPercent: 25.05 })).not.toThrow()
  })

  it('rejects a distribution that does not sum to 100%', () => {
    expect(() => computeMacros({ kcal: 2000, carbsPercent: 50, proteinPercent: 25, fatPercent: 20 })).toThrow(NutritionEngineError)
  })

  it('rejects negative percentages', () => {
    expect(() => computeMacros({ kcal: 2000, carbsPercent: 110, proteinPercent: 25, fatPercent: -35 })).toThrow(NutritionEngineError)
  })

  it('rejects a non-positive kcal target', () => {
    expect(() => computeMacros({ kcal: 0, carbsPercent: 50, proteinPercent: 25, fatPercent: 25 })).toThrow(NutritionEngineError)
  })
})

describe('energy adjustment by goal', () => {
  const base = { sex: 'female', age: 38, weightKg: 78, heightCm: 160, formula: 'mifflin', activityFactor: 1.375 }

  it('keeps the total expenditure and subtracts the deficit for the plan requirement', () => {
    const result = computeEnergyRequirement({ ...base, energyAdjustKcal: -500 })
    expect(result.get).toBe(1965)
    expect(result.energyAdjustKcal).toBe(-500)
    expect(result.targetKcal).toBe(1465)
    expect(result.flags).toEqual([])
  })

  it('uses the expenditure as the requirement when there is no adjustment', () => {
    const result = computeEnergyRequirement(base)
    expect(result.targetKcal).toBe(result.get)
    expect(result.energyAdjustKcal).toBe(0)
  })

  it('flags a requirement that falls below the basal metabolism and clamps absurd values', () => {
    expect(computeEnergyRequirement({ ...base, energyAdjustKcal: -700 }).flags.map((flag) => flag.code)).toEqual(['TARGET_BELOW_BMR'])
    expect(computeEnergyRequirement({ ...base, energyAdjustKcal: -99999 }).energyAdjustKcal).toBe(-1500)
    expect(computeEnergyRequirement({ ...base, energyAdjustKcal: 'abc' }).energyAdjustKcal).toBe(0)
  })
})
