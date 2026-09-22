// Cálculos antropométricos derivados de las mediciones capturadas.
// Fórmulas publicadas (Durnin-Womersley/Siri/Brozek, Faulkner, Yuhasz, Slaughter, RFM, Rocha,
// Matiegka/Wurch, Heath-Carter). Se usan como estimaciones de apoyo, no como diagnóstico.

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

const pick = (values, key) => num(values?.[key])

export const isFemale = (sex) => String(sex || '').toLowerCase().startsWith('fem')

// Suma de pliegues (mm). Devuelve null si falta cualquiera de los requeridos.
const sumFolds = (values, keys) => {
  const parts = keys.map((k) => pick(values, k))
  if (parts.some((p) => p == null)) return null
  return parts.reduce((a, b) => a + b, 0)
}

const FOLDS = {
  triceps: 'Tricipital (mm)',
  subscap: 'Subescapular (mm)',
  supra: 'Supraespinal (mm)',
  biceps: 'Bicipital (mm)',
  iliac: 'Cresta ilíaca (mm)',
  abdomen: 'Abdominal (mm)',
  thigh: 'Muslo frontal (mm)',
  calf: 'Pantorrilla medial (mm)',
}

export function bodyFatEstimates(values, { sex } = {}) {
  const female = isFemale(sex)
  const rows = []
  const push = (label, value, detail) => rows.push({ label, value: value != null && Number.isFinite(value) ? Math.round(value * 10) / 10 : null, detail })

  const bio = pick(values, '% Grasa corporal')
  push('Bioimpedancia', bio, 'Medición directa')

  // Durnin-Womersley (4 pliegues) → densidad → Siri y Brozek
  const s4 = sumFolds(values, [FOLDS.biceps, FOLDS.triceps, FOLDS.subscap, FOLDS.supra])
  const density = s4 ? (female ? 1.1599 - 0.0717 * Math.log10(s4) : 1.1631 - 0.0632 * Math.log10(s4)) : null
  push('Siri', density ? 495 / density - 450 : null, 'Durnin-Womersley')
  push('Brozek', density ? 457 / density - 414 : null, 'Durnin-Womersley')

  // Faulkner (4 pliegues)
  const faulkner = sumFolds(values, [FOLDS.triceps, FOLDS.subscap, FOLDS.supra, FOLDS.iliac])
  push('Faulkner', faulkner ? 0.153 * faulkner + 5.783 : null, 'Tríceps + subescapular + suprailíaco + abdominal')

  // Yuhasz (6 pliegues)
  const yuhasz = sumFolds(values, [FOLDS.triceps, FOLDS.subscap, FOLDS.supra, FOLDS.abdomen, FOLDS.thigh, FOLDS.calf])
  push('Yuhasz', yuhasz ? (female ? 0.1548 * yuhasz + 3.58 : 0.1051 * yuhasz + 2.585) : null, '6 pliegues')

  // Slaughter (tríceps + subescapular)
  const sl = sumFolds(values, [FOLDS.triceps, FOLDS.subscap])
  push('Slaughter', sl ? (female ? 0.61 * sl + 5.1 : 0.735 * sl + 1.0) : null, 'Tríceps + subescapular')

  // RFM (índice de masa grasa relativa)
  const heightCm = pick(values, 'Talla (cm)')
  const waist = pick(values, 'Cintura (cm)')
  const rfm = heightCm && waist ? 64 - 20 * (heightCm / waist) + (female ? 12 : 0) : null
  push('Índice de masa grasa relativa (RFM)', rfm, 'Talla / cintura')

  push('Ledesma', null, 'Requiere pliegues del protocolo')
  push('Parizkova', null, 'Requiere pliegues del protocolo')

  const numeric = rows.filter((r) => r.value != null)
  const average = numeric.length ? Math.round((numeric.reduce((a, r) => a + r.value, 0) / numeric.length) * 100) / 100 : null
  return { rows, average }
}

// Masa ósea (Rocha), grasa, residual (Matiegka/Wurch) y muscular por diferencia.
export function bodyComposition(values, { sex, fatPercent } = {}) {
  const female = isFemale(sex)
  const weight = pick(values, 'Peso (kg)')
  const heightM = pick(values, 'Talla (cm)') ? pick(values, 'Talla (cm)') / 100 : null
  const wrist = pick(values, 'Biestiloideo (cm)')
  const ankle = pick(values, 'Bimaleolar (cm)')
  if (!weight) return { weight: null, parts: [] }

  const bone = heightM && wrist && ankle
    ? 3.02 * Math.pow((heightM ** 2) * (wrist / 100) * (ankle / 100) * 400, 0.712)
    : null
  const fatPct = num(fatPercent) ?? pick(values, '% Grasa corporal')
  const fat = fatPct ? weight * fatPct / 100 : null
  const residual = weight * (female ? 0.209 : 0.2415)
  const muscle = weight - (fat || 0) - (bone || 0) - residual

  const part = (label, kg, color) => ({ label, kg: kg != null && kg > 0 ? Math.round(kg * 10) / 10 : null, pct: kg != null && kg > 0 ? Math.round((kg / weight) * 1000) / 10 : null, color })
  const parts = [
    part('Masa grasa', fat, '#e0a13c'),
    part('Masa muscular', muscle, '#2b9674'),
    part('Masa ósea', bone, '#3f6fa8'),
    part('Masa residual', residual, '#9d8abb'),
  ]
  return { weight: Math.round(weight * 10) / 10, parts }
}

// Peso teórico / ideal según estatura (fórmulas de uso clínico frecuente).
export function theoreticalWeights(heightCm, sex) {
  const h = num(heightCm)
  if (!h) return []
  const inches = h / 2.54
  const over5ft = Math.max(0, inches - 60)
  const female = isFemale(sex)
  return [
    { label: 'Lorentz', value: Math.round((h - 100 - (h - 150) / (female ? 2.5 : 4)) * 10) / 10 },
    { label: 'Devine', value: Math.round(((female ? 45.5 : 50) + 2.3 * over5ft) * 10) / 10 },
    { label: 'Robinson', value: Math.round(((female ? 49 : 52) + (female ? 1.7 : 1.9) * over5ft) * 10) / 10 },
    { label: 'Miller', value: Math.round(((female ? 53.1 : 56.2) + (female ? 1.36 : 1.41) * over5ft) * 10) / 10 },
    { label: 'Hamwi', value: Math.round(((female ? 45.5 : 48) + (female ? 2.2 : 2.7) * over5ft) * 10) / 10 },
  ]
}

// Somatotipo Heath-Carter: endomorfia, mesomorfia y ectomorfia.
export function somatotype(values) {
  const height = pick(values, 'Talla (cm)')
  const weight = pick(values, 'Peso (kg)')
  const triceps = pick(values, FOLDS.triceps)
  const subscap = pick(values, FOLDS.subscap)
  const supra = pick(values, FOLDS.supra)
  const humerus = pick(values, 'Húmero (cm)')
  const femur = pick(values, 'Fémur (cm)')
  const arm = pick(values, 'Brazo contraído (cm)')
  const calf = pick(values, 'Pantorrilla (cm)')

  const sum3 = triceps != null && subscap != null && supra != null ? triceps + subscap + supra : null
  const endo = sum3 != null ? -0.7182 + 0.1451 * sum3 - 0.00068 * sum3 ** 2 + 0.0000014 * sum3 ** 3 : null

  const armCorr = arm != null && triceps != null ? arm - triceps / 10 : null
  const calfCorr = calf != null ? calf : null
  const meso = humerus != null && femur != null && armCorr != null && calfCorr != null && height != null
    ? 0.858 * humerus + 0.601 * femur + 0.188 * armCorr + 0.161 * calfCorr - 0.131 * height + 4.5
    : null

  let ecto = null
  if (height != null && weight != null) {
    const hwr = height / Math.cbrt(weight)
    ecto = hwr >= 40.75 ? 0.732 * hwr - 28.58 : hwr >= 38.25 ? 0.463 * hwr - 17.63 : 0.1
  }

  const round = (v) => (v != null ? Math.round(v * 100) / 100 : null)
  const endoR = round(endo); const mesoR = round(meso); const ectoR = round(ecto)
  const x = endoR != null && ectoR != null ? round(ectoR - endoR) : null
  const y = endoR != null && mesoR != null && ectoR != null ? round(2 * mesoR - (endoR + ectoR)) : null
  return { endo: endoR, meso: mesoR, ecto: ectoR, x, y }
}

// Calorías objetivo a partir de gramos por kilo de peso (o gramos absolutos).
export function energyFromMacros(weightKg, macros, perKg) {
  const w = num(weightKg) || 0
  const gramsOf = (v) => (perKg ? (Number(v) || 0) * w : Number(v) || 0)
  const protein = gramsOf(macros.protein)
  const fat = gramsOf(macros.fat)
  const carbs = gramsOf(macros.carbs)
  return {
    protein: Math.round(protein), fat: Math.round(fat), carbs: Math.round(carbs),
    kcal: Math.round(protein * 4 + fat * 9 + carbs * 4),
  }
}
