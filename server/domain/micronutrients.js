// Ingesta Diaria Recomendada (IDR) por grupo demográfico, transcrita de la hoja BASE_IDR del
// Excel de trabajo de la usuaria (DIETOCALCULO.xlsx). Solo se incluyen los micronutrientes con
// valor de referencia real en esa hoja Y presentes en el catálogo de Ingredientes (SMAE, fase 14,
// más BASE_ALIMENTOS, fase 17) — otros micronutrientes de la hoja (B1, B2, B3, B6, Mg, K, Na) no
// tienen dato de referencia, dato por alimento, o ninguno de los dos, así que no se reportan para
// evitar mostrar una "adecuación" calculada sobre datos que no existen.
//
// Nota sobre el valor de calcio en adolescentes: la celda original decía "1.2" (g) mientras el
// resto de la fila usa mg — se normalizó a 1200 mg, consistente con la IDR oficial de calcio
// en adolescentes. Si esto no refleja la intención original, corrígelo aquí.
const IDR_TABLE = {
  children: { label: 'Niños (1-3 años)', fiber: 20, vitaminA: 300, vitaminC: 15, vitaminD: 400, vitaminE: 6, vitaminK: 30, vitaminB12: 0.9, folicAcid: 150, calcium: 800, iron: 10, zinc: 10, iodine: 70, selenium: 20 },
  male_teen: { label: 'Hombre adolescente (14-18 años)', fiber: null, vitaminA: 900, vitaminC: 90, vitaminD: 400, vitaminE: 15, vitaminK: 75, vitaminB12: 2.4, folicAcid: 400, calcium: 1200, iron: 12, zinc: 12, iodine: 150, selenium: 40 },
  female_teen: { label: 'Mujer adolescente (14-18 años)', fiber: null, vitaminA: 700, vitaminC: 75, vitaminD: 400, vitaminE: 15, vitaminK: 60, vitaminB12: 2.4, folicAcid: 400, calcium: 1200, iron: 15, zinc: 15, iodine: 150, selenium: 50 },
  male_adult: { label: 'Hombre adulto (19-70 años)', fiber: null, vitaminA: 900, vitaminC: 90, vitaminD: 400, vitaminE: 15, vitaminK: 80, vitaminB12: 2.4, folicAcid: 400, calcium: 800, iron: 10, zinc: 11, iodine: 150, selenium: 70 },
  female_adult: { label: 'Mujer adulta (19-70 años)', fiber: 30, vitaminA: 700, vitaminC: 75, vitaminD: 400, vitaminE: 15, vitaminK: 65, vitaminB12: 2.4, folicAcid: 400, calcium: 800, iron: 15, zinc: 15, iodine: 150, selenium: 55 },
  male_senior: { label: 'Hombre adulto mayor (>70 años)', fiber: null, vitaminA: 900, vitaminC: 90, vitaminD: 800, vitaminE: 15, vitaminK: 80, vitaminB12: 2.4, folicAcid: 400, calcium: 800, iron: 10, zinc: 11, iodine: 150, selenium: 70 },
  female_senior: { label: 'Mujer adulta mayor (>70 años)', fiber: null, vitaminA: 700, vitaminC: 75, vitaminD: 800, vitaminE: 15, vitaminK: 65, vitaminB12: 2.4, folicAcid: 400, calcium: 800, iron: 10, zinc: 12, iodine: 150, selenium: 55 },
}

const NUTRIENT_LABELS = {
  fiber: { label: 'Fibra', unit: 'g' },
  vitaminA: { label: 'Vitamina A', unit: 'mg RE' },
  vitaminC: { label: 'Vitamina C', unit: 'mg' },
  vitaminD: { label: 'Vitamina D', unit: 'µg' },
  vitaminE: { label: 'Vitamina E', unit: 'mg' },
  vitaminK: { label: 'Vitamina K', unit: 'µg' },
  vitaminB12: { label: 'Vitamina B12', unit: 'µg' },
  folicAcid: { label: 'Ácido fólico', unit: 'µg' },
  calcium: { label: 'Calcio', unit: 'mg' },
  iron: { label: 'Hierro', unit: 'mg' },
  zinc: { label: 'Zinc', unit: 'mg' },
  iodine: { label: 'Yodo', unit: 'µg' },
  selenium: { label: 'Selenio', unit: 'µg' },
}
const NUTRIENT_KEYS = Object.keys(NUTRIENT_LABELS)

// Los brackets de edad de la hoja original dejan huecos (4-13 años, y no hay traslape entre
// "adolescente" y "adulto" fuera de 14-18/19-70) — una edad que no cae en ningún rango no tiene
// bracket, y se reporta como tal en vez de adivinar uno.
function resolveIdrBracket(age, sex) {
  const male = String(sex || '').toLowerCase().startsWith('m')
  if (age == null || !Number.isFinite(Number(age))) return null
  const a = Number(age)
  if (a >= 1 && a <= 3) return 'children'
  if (a >= 14 && a <= 18) return male ? 'male_teen' : 'female_teen'
  if (a >= 19 && a <= 70) return male ? 'male_adult' : 'female_adult'
  if (a > 70) return male ? 'male_senior' : 'female_senior'
  return null
}

// mealSlots: [{ dayOfWeek, servings, recipe: { nutrition: {...} } | null }]
// Promedia por día (solo los días con al menos una receta asignada), igual que el resto del
// plan promedia kcal por tiempo de comida — no asume una semana completa de 7 días.
function averageDailyMicronutrients(mealSlots) {
  const emptyTotals = () => Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, 0]))
  const byDay = new Map()
  for (const slot of mealSlots) {
    if (!slot.recipe) continue
    if (!byDay.has(slot.dayOfWeek)) byDay.set(slot.dayOfWeek, emptyTotals())
    const totals = byDay.get(slot.dayOfWeek)
    const servings = Number(slot.servings) || 1
    const nutrition = slot.recipe.nutrition || {}
    for (const key of NUTRIENT_KEYS) totals[key] += Number(nutrition[key] || 0) * servings
  }
  const days = [...byDay.values()]
  if (!days.length) return null
  const averages = emptyTotals()
  for (const key of NUTRIENT_KEYS) averages[key] = Math.round((days.reduce((sum, day) => sum + day[key], 0) / days.length) * 10) / 10
  return averages
}

function computeMicronutrientAdequacy(mealSlots, age, sex) {
  const bracketKey = resolveIdrBracket(age, sex)
  if (!bracketKey) return { bracket: null, bracketLabel: null, nutrients: [] }
  const bracket = IDR_TABLE[bracketKey]
  const dailyTotals = averageDailyMicronutrients(mealSlots)
  if (!dailyTotals) return { bracket: bracketKey, bracketLabel: bracket.label, nutrients: [] }
  const nutrients = NUTRIENT_KEYS
    .filter((key) => bracket[key] != null)
    .map((key) => {
      const target = bracket[key]
      const value = dailyTotals[key]
      return { key, label: NUTRIENT_LABELS[key].label, unit: NUTRIENT_LABELS[key].unit, value, target, percent: Math.round((value / target) * 1000) / 10 }
    })
  return { bracket: bracketKey, bracketLabel: bracket.label, nutrients }
}

export { IDR_TABLE, NUTRIENT_KEYS, resolveIdrBracket, averageDailyMicronutrients, computeMicronutrientAdequacy }
