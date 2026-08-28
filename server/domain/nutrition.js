const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  intense: 1.725,
}

function round1(value) {
  return Math.round(value * 10) / 10
}

function leanMassKg(weightKg, bodyFatPercent) {
  return weightKg * (1 - (Number(bodyFatPercent) || 0) / 100)
}

function calculateBmi(weightKg, heightCm) {
  const heightM = heightCm / 100
  return weightKg / (heightM * heightM)
}

function classifyBmi(bmi) {
  if (bmi < 18.5) return 'bajo_peso'
  if (bmi < 25) return 'normal'
  if (bmi < 30) return 'sobrepeso'
  if (bmi < 35) return 'obesidad_i'
  if (bmi < 40) return 'obesidad_ii'
  return 'obesidad_iii'
}

// Rango de peso saludable según IMC de referencia OMS (18.5-24.9), no un objetivo clínico individual.
function idealWeightRange(heightCm) {
  const heightM = heightCm / 100
  return {
    minKg: round1(18.5 * heightM * heightM),
    maxKg: round1(24.9 * heightM * heightM),
  }
}

// Coeficientes FAO/OMS/ONU 1985 (ecuación de Schofield por peso), la misma familia de datos
// que ya usaba este proyecto para el bracket 18-30; se completan el resto de los brackets de
// edad porque aplicar solo el coeficiente 18-30 a cualquier edad subestima/sobreestima el GEB.
const SCHOFIELD_BRACKETS = [
  { maxAge: 18, male: (w) => 17.5 * w + 651, female: (w) => 12.2 * w + 746 },
  { maxAge: 30, male: (w) => 15.3 * w + 679, female: (w) => 14.7 * w + 496 },
  { maxAge: 60, male: (w) => 11.6 * w + 879, female: (w) => 8.7 * w + 829 },
  { maxAge: Infinity, male: (w) => 13.5 * w + 487, female: (w) => 10.5 * w + 596 },
]

function schofieldBmr({ age, weightKg, male }) {
  const bracket = SCHOFIELD_BRACKETS.find((row) => age < row.maxAge) || SCHOFIELD_BRACKETS[SCHOFIELD_BRACKETS.length - 1]
  return male ? bracket.male(weightKg) : bracket.female(weightKg)
}

// Ecuación de Valencia (1994), derivada de calorimetría indirecta en población mexicana
// adulta y validada posteriormente en más sujetos (mestizos e indígenas, zonas urbanas y
// rurales). Coeficientes tomados de una única fuente secundaria (Lobatón, "Ecuaciones
// predictivas del gasto energético") sin poder cotejar la tabla original publicada: revisar
// con una fuente primaria antes de tratarla como definitiva en un entorno clínico real.
const VALENCIA_BRACKETS = [
  { maxAge: 30, male: (w) => 13.37 * w + 747, female: (w) => 11.02 * w + 679 },
  { maxAge: 60, male: (w) => 13.08 * w + 693, female: (w) => 10.92 * w + 677 },
  { maxAge: Infinity, male: (w) => 14.21 * w + 429, female: (w) => 10.98 * w + 520 },
]

function valenciaBmr({ age, weightKg, male }) {
  const bracket = VALENCIA_BRACKETS.find((row) => age < row.maxAge) || VALENCIA_BRACKETS[VALENCIA_BRACKETS.length - 1]
  return male ? bracket.male(weightKg) : bracket.female(weightKg)
}

const BMR_FORMULAS = {
  mifflin: {
    version: 'mifflin_v1',
    label: 'Mifflin-St Jeor',
    compute: ({ age, weightKg, heightCm, male }) => (10 * weightKg) + (6.25 * heightCm) - (5 * age) + (male ? 5 : -161),
  },
  harris: {
    version: 'harris_v1',
    label: 'Harris-Benedict (revisión 1984)',
    compute: ({ age, weightKg, heightCm, male }) => male
      ? (13.397 * weightKg) + (4.799 * heightCm) - (5.677 * age) + 88.362
      : (9.247 * weightKg) + (3.098 * heightCm) - (4.330 * age) + 447.593,
  },
  fao: {
    version: 'schofield_v1',
    label: 'FAO/OMS/ONU (Schofield 1985)',
    compute: schofieldBmr,
  },
  schofield: {
    version: 'schofield_v1',
    label: 'FAO/OMS/ONU (Schofield 1985)',
    compute: schofieldBmr,
  },
  valencia: {
    version: 'valencia_v1',
    label: 'Valencia (población mexicana, 1994)',
    compute: valenciaBmr,
  },
  cunningham: {
    version: 'cunningham_v1',
    label: 'Cunningham',
    compute: ({ weightKg, bodyFatPercent }) => 500 + (22 * leanMassKg(weightKg, bodyFatPercent)),
  },
  'katch-mcardle': {
    version: 'katch-mcardle_v1',
    label: 'Katch-McArdle',
    compute: ({ weightKg, bodyFatPercent }) => 370 + (21.6 * leanMassKg(weightKg, bodyFatPercent)),
  },
}

class NutritionEngineError extends Error {
  constructor(code, message, fields = {}) {
    super(message)
    this.code = code
    this.fields = fields
  }
}

function resolveFormula(formula) {
  const entry = BMR_FORMULAS[formula]
  if (!entry) throw new NutritionEngineError('UNKNOWN_FORMULA', 'La fórmula solicitada no está disponible.', { formula: 'invalid' })
  return entry
}

// GET plausible aproximado para un adulto: fuera de este rango se marca para revisión,
// nunca se corrige ni se rechaza silenciosamente (regla de negocio documentada en el proyecto).
const PLAUSIBLE_GET_RANGE = { min: 800, max: 6000 }

function computeEnergyRequirement({ sex, age, weightKg, heightCm, bodyFatPercent, formula, activityFactor, mets }) {
  const male = String(sex).toLowerCase().startsWith('m')
  const formulaEntry = resolveFormula(formula)
  const bmr = formulaEntry.compute({ age, weightKg, heightCm, bodyFatPercent, male })

  const metsKcal = mets?.met && mets?.minutes && mets?.sessionsPerWeek
    ? (Number(mets.met) * 3.5 * weightKg / 200 * Number(mets.minutes) * Number(mets.sessionsPerWeek)) / 7
    : null
  const get = metsKcal || bmr * Number(activityFactor || ACTIVITY_FACTORS.sedentary)

  const bmi = calculateBmi(weightKg, heightCm)
  const flags = []
  if (get < PLAUSIBLE_GET_RANGE.min || get > PLAUSIBLE_GET_RANGE.max) {
    flags.push({ code: 'GET_OUT_OF_RANGE', message: 'El gasto energético calculado está fuera del rango plausible para un adulto y requiere revisión profesional.' })
  }

  return {
    formula,
    formulaVersion: formulaEntry.version,
    formulaLabel: formulaEntry.label,
    bmr: Math.round(bmr),
    activityKcal: Math.round(get - bmr),
    get: Math.round(get),
    activityMethod: metsKcal ? 'mets' : 'factor',
    bmi: round1(bmi),
    bmiCategory: classifyBmi(bmi),
    idealWeightRange: idealWeightRange(heightCm),
    inputs: { age, weightKg, heightCm, sex, bodyFatPercent: bodyFatPercent || null },
    flags,
    reviewed: false,
  }
}

const MACROS_TOLERANCE = 0.1

function computeMacros({ kcal, carbsPercent, proteinPercent, fatPercent }) {
  const values = [Number(kcal), Number(carbsPercent), Number(proteinPercent), Number(fatPercent)]
  if (values.some((value) => !Number.isFinite(value) || value < 0) || Number(kcal) <= 0) {
    throw new NutritionEngineError('INVALID_MACROS', 'Calorías y porcentajes deben ser valores válidos.')
  }
  const total = Number(carbsPercent) + Number(proteinPercent) + Number(fatPercent)
  if (Math.abs(total - 100) > MACROS_TOLERANCE) {
    throw new NutritionEngineError('MACROS_NOT_100', 'La distribución debe sumar exactamente 100%.', { total })
  }
  const gramsPerKcal = { carbs: 4, protein: 4, fat: 9 }
  const macro = (percent, key) => ({
    percent: Number(percent),
    kcal: Math.round(Number(kcal) * Number(percent) / 100),
    grams: round1(Number(kcal) * Number(percent) / 100 / gramsPerKcal[key]),
  })
  return {
    kcal: Number(kcal),
    totalPercent: total,
    macros: {
      carbs: macro(carbsPercent, 'carbs'),
      protein: macro(proteinPercent, 'protein'),
      fat: macro(fatPercent, 'fat'),
    },
  }
}

export {
  ACTIVITY_FACTORS,
  BMR_FORMULAS,
  NutritionEngineError,
  calculateBmi,
  classifyBmi,
  idealWeightRange,
  computeEnergyRequirement,
  computeMacros,
}
