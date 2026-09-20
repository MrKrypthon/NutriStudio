// Recordatorio de 24 horas: captura por tiempo de comida, suma de energía/macros/micros y
// adecuación contra referencias por sexo y grupo de edad.
//
// Las referencias de micronutrientes vienen del mismo IDR transcrito del Excel de la usuaria
// (server/domain/micronutrients.js). Los valores de energía/macros/grasas/colesterol/azúcar/
// potasio/sodio/fósforo NO venían en esa hoja: se agregaron como referencias estándar
// (DRI/AMDR del IOM y valores de referencia de la FDA) a pedido de la usuaria, y quedan aquí
// marcados para que la nutrióloga los revise o los ajuste.
import { IDR_TABLE, resolveIdrBracket } from '../../server/domain/micronutrients.js'

export const RECALL_MEALS = [
  { key: 'breakfast', label: 'Desayuno', time: '08:00' },
  { key: 'morningSnack', label: 'Colación matutina', time: '11:00' },
  { key: 'lunch', label: 'Comida', time: '14:00' },
  { key: 'afternoonSnack', label: 'Colación vespertina', time: '17:00' },
  { key: 'dinner', label: 'Cena', time: '20:00' },
]

export const emptyRecall = () => ({ meals: RECALL_MEALS.map((meal) => ({ ...meal, note: '', items: [] })) })

// Referencias estándar por bracket (mismos grupos de edad que la IDR de micronutrientes).
// AMDR: grasa 30% de la energía; saturadas 10%; monoinsaturadas 15%; poliinsaturadas 10%;
// azúcar 10%; carbohidratos 55%. Proteína y fibra: RDA/AI. Potasio/fósforo: AI/RDA.
export const MACRO_REFERENCE = {
  children: { kcal: 1300, protein: 13, carbs: 180, fat: 43, saturatedFat: 14, monounsaturatedFat: 22, polyunsaturatedFat: 14, cholesterol: 300, sugar: 32, fiber: 19, potassium: 3000, sodium: 1500, phosphorus: 460 },
  male_teen: { kcal: 3000, protein: 52, carbs: 410, fat: 100, saturatedFat: 33, monounsaturatedFat: 50, polyunsaturatedFat: 33, cholesterol: 300, sugar: 75, fiber: 38, potassium: 3000, sodium: 2300, phosphorus: 1250 },
  female_teen: { kcal: 2200, protein: 46, carbs: 300, fat: 73, saturatedFat: 24, monounsaturatedFat: 37, polyunsaturatedFat: 24, cholesterol: 300, sugar: 55, fiber: 26, potassium: 2300, sodium: 2300, phosphorus: 1250 },
  male_adult: { kcal: 2600, protein: 56, carbs: 355, fat: 87, saturatedFat: 29, monounsaturatedFat: 43, polyunsaturatedFat: 29, cholesterol: 300, sugar: 65, fiber: 38, potassium: 3400, sodium: 2300, phosphorus: 700 },
  female_adult: { kcal: 2000, protein: 46, carbs: 275, fat: 67, saturatedFat: 22, monounsaturatedFat: 33, polyunsaturatedFat: 22, cholesterol: 300, sugar: 50, fiber: 25, potassium: 2600, sodium: 2300, phosphorus: 700 },
  male_senior: { kcal: 2200, protein: 56, carbs: 300, fat: 73, saturatedFat: 24, monounsaturatedFat: 37, polyunsaturatedFat: 24, cholesterol: 300, sugar: 55, fiber: 30, potassium: 3400, sodium: 2300, phosphorus: 700 },
  female_senior: { kcal: 1800, protein: 46, carbs: 245, fat: 60, saturatedFat: 20, monounsaturatedFat: 30, polyunsaturatedFat: 20, cholesterol: 300, sugar: 45, fiber: 21, potassium: 2600, sodium: 2300, phosphorus: 700 },
}

// Nutrientes que la hoja de requerimientos pide sumar y comparar, en orden de presentación.
export const RECALL_NUTRIENTS = [
  { key: 'kcal', label: 'Energía', unit: 'kcal', group: 'Energía y macronutrientes' },
  { key: 'protein', label: 'Proteína', unit: 'g', group: 'Energía y macronutrientes' },
  { key: 'carbs', label: 'Carbohidratos', unit: 'g', group: 'Energía y macronutrientes' },
  { key: 'fat', label: 'Grasas totales', unit: 'g', group: 'Energía y macronutrientes' },
  { key: 'saturatedFat', label: 'Grasas saturadas', unit: 'g', group: 'Grasas y otros' },
  { key: 'monounsaturatedFat', label: 'Grasas monoinsaturadas', unit: 'g', group: 'Grasas y otros' },
  { key: 'polyunsaturatedFat', label: 'Grasas poliinsaturadas', unit: 'g', group: 'Grasas y otros' },
  { key: 'cholesterol', label: 'Colesterol', unit: 'mg', group: 'Grasas y otros' },
  { key: 'sugar', label: 'Azúcar', unit: 'g', group: 'Grasas y otros' },
  { key: 'fiber', label: 'Fibra', unit: 'g', group: 'Grasas y otros' },
  { key: 'vitaminA', label: 'Vitamina A', unit: 'µg RE', group: 'Vitaminas y minerales' },
  { key: 'vitaminC', label: 'Vitamina C', unit: 'mg', group: 'Vitaminas y minerales' },
  { key: 'folicAcid', label: 'Ácido fólico (B9)', unit: 'µg', group: 'Vitaminas y minerales' },
  { key: 'calcium', label: 'Calcio', unit: 'mg', group: 'Vitaminas y minerales' },
  { key: 'iron', label: 'Hierro', unit: 'mg', group: 'Vitaminas y minerales' },
  { key: 'potassium', label: 'Potasio', unit: 'mg', group: 'Vitaminas y minerales' },
  { key: 'sodium', label: 'Sodio', unit: 'mg', group: 'Vitaminas y minerales' },
  { key: 'phosphorus', label: 'Fósforo', unit: 'mg', group: 'Vitaminas y minerales' },
]

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)

// Suma los nutrientes de todos los alimentos capturados (la nutrición del catálogo es por 100 g).
export function sumRecall(recall) {
  const totals = Object.fromEntries(RECALL_NUTRIENTS.map((nutrient) => [nutrient.key, 0]))
  for (const meal of recall?.meals || []) {
    for (const item of meal.items || []) {
      const factor = number(item.grams) / 100
      for (const nutrient of RECALL_NUTRIENTS) totals[nutrient.key] += number(item.nutrition?.[nutrient.key]) * factor
    }
  }
  for (const key of Object.keys(totals)) totals[key] = Math.round(totals[key] * 10) / 10
  return totals
}

export const adequacyStatus = (percent) => (percent == null ? null : percent < 95 ? 'Bajo' : percent > 105 ? 'Alto' : 'Normal')

// Adecuación = (consumo ÷ ideal) × 100; <95% Bajo, 95–105% Normal, >105% Alto.
export function recallAdequacy(totals, age, sex) {
  const bracketKey = resolveIdrBracket(age, sex)
  const idr = bracketKey ? IDR_TABLE[bracketKey] : null
  const macros = bracketKey ? MACRO_REFERENCE[bracketKey] : null
  return RECALL_NUTRIENTS.map((nutrient) => {
    const target = (macros?.[nutrient.key] ?? idr?.[nutrient.key]) ?? null
    const value = totals?.[nutrient.key] ?? 0
    const percent = target != null && target > 0 ? Math.round((value / target) * 1000) / 10 : null
    return { ...nutrient, value, target, percent, status: adequacyStatus(percent) }
  })
}

export const recallBracketLabel = (age, sex) => {
  const bracketKey = resolveIdrBracket(age, sex)
  return bracketKey ? IDR_TABLE[bracketKey].label : null
}
