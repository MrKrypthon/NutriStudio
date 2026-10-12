// Tiempos de comida que puede tener un plan de alimentación, en el orden del día. Un plan usa sólo
// algunos (ver `activeMeals`): por defecto los cuatro de siempre, o los que la paciente dijo hacer
// en la consulta. Este módulo no toca la base ni la red: lo usan el servidor y la pantalla.
//
// `label` es el nombre en la app; `printLabel` el del plan impreso, donde todas las colaciones se
// llaman "Colación" y se distinguen por su hora. `recipeType` es el tipo con que están catalogadas
// las recetas, `suggestedTime` la hora que se propone y `share` el peso del tiempo al repartir
// equivalentes (relativo: se normaliza entre los tiempos activos).
const PLAN_MEALS = [
  { key: 'breakfast', label: 'Desayuno', printLabel: 'Desayuno', recipeType: 'breakfast', suggestedTime: '08:00', share: 25 },
  { key: 'morningSnack', label: 'Colación matutina', printLabel: 'Colación', recipeType: 'snack', suggestedTime: '11:00', share: 10 },
  { key: 'lunch', label: 'Comida', printLabel: 'Comida', recipeType: 'lunch', suggestedTime: '14:00', share: 35 },
  { key: 'snack', label: 'Colación', printLabel: 'Colación', recipeType: 'snack', suggestedTime: '17:00', share: 10 },
  { key: 'snack2', label: 'Colación 2', printLabel: 'Colación', recipeType: 'snack', suggestedTime: '18:30', share: 10 },
  { key: 'dinner', label: 'Cena', printLabel: 'Cena', recipeType: 'dinner', suggestedTime: '20:00', share: 20 },
  { key: 'nightSnack', label: 'Colación nocturna', printLabel: 'Colación', recipeType: 'snack', suggestedTime: '22:00', share: 5 },
]
const PLAN_MEAL_KEYS = PLAN_MEALS.map((meal) => meal.key)
const DEFAULT_ACTIVE_MEALS = ['breakfast', 'lunch', 'snack', 'dinner']
const MAIN_MEALS = ['breakfast', 'lunch', 'dinner']

// Tiempos activos tal como se guardan: sólo claves conocidas, sin repetir y en el orden del día.
function normalizeActiveMeals(value) {
  if (!Array.isArray(value)) return []
  return PLAN_MEAL_KEYS.filter((key) => value.includes(key))
}

// Horas de los tiempos de comida tal como se guardan en el plan: sólo las claves conocidas y sólo
// valores "HH:MM" de 24 h; lo demás se descarta.
function normalizeMealTimes(value) {
  const times = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return times
  for (const key of PLAN_MEAL_KEYS) {
    const time = typeof value[key] === 'string' ? value[key].trim() : ''
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) times[key] = time
  }
  return times
}

// "10:00" → "10 am", "14:30" → "2:30 pm", como se escribe en el plan en papel.
function formatMealTime(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time || ''))
  if (!match) return ''
  const hours = Number(match[1])
  const hour12 = hours % 12 || 12
  return `${hour12}${match[2] === '00' ? '' : `:${match[2]}`} ${hours < 12 ? 'am' : 'pm'}`
}

// Hora escrita dentro de un texto libre ("a las 7:30", "10 am", "14 hrs") → "HH:MM". Un número
// suelto no cuenta ("2 huevos"): hace falta minutos o un sufijo de hora.
function parseTimeFromText(text) {
  const source = String(text || '').toLowerCase()
  const pattern = /(?:^|[^\d.,])(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?|hrs?\b|horas?\b|h\b)?/g
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const suffix = (match[3] || '').replace(/[.\s]/g, '')
    if (match[2] === undefined && !suffix) continue
    let hours = Number(match[1])
    const minutes = Number(match[2] || 0)
    if (suffix === 'pm' && hours < 12) hours += 12
    if (suffix === 'am' && hours === 12) hours = 0
    if (hours > 23 || minutes > 59) continue
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }
  return null
}

// Campo de "Dieta habitual" y tiempo del Recordatorio de 24 h (sección Dietético del expediente)
// que corresponden a cada tiempo del plan.
const CONSULTATION_SOURCES = {
  breakfast: { field: 'Desayuno', recall: 'breakfast' },
  morningSnack: { field: 'Colación matutina', recall: 'morningSnack' },
  lunch: { field: 'Almuerzo o comida', recall: 'lunch' },
  snack: { field: 'Colación vespertina', recall: 'afternoonSnack' },
  dinner: { field: 'Cena', recall: 'dinner' },
}
const NOTHING = /^(no|no hace|no realiza|ningun[oa]?|nada|n\/?a|omite|se la salta|-+)\.?$/i

// Tiempos de comida y horas que se proponen para un plan nuevo a partir de lo capturado en la
// consulta: las tres comidas principales más las colaciones que la paciente dijo hacer, cada una
// con la hora que mencionó (o la habitual si no dijo ninguna). Sin datos de la consulta, los
// tiempos de siempre.
function suggestMealsFromConsultation(dietary) {
  const payload = dietary && typeof dietary === 'object' ? dietary : {}
  const recallMeals = Array.isArray(payload['Recordatorio 24 h']?.meals) ? payload['Recordatorio 24 h'].meals : []
  const eaten = new Set()
  const stated = {}
  let hasInfo = false
  for (const [key, source] of Object.entries(CONSULTATION_SOURCES)) {
    const text = typeof payload[source.field] === 'string' ? payload[source.field].trim() : ''
    const recall = recallMeals.find((meal) => meal?.key === source.recall)
    const recalled = Boolean(recall && ((Array.isArray(recall.items) && recall.items.length) || String(recall.note || '').trim()))
    if (text || recalled) hasInfo = true
    if ((text && !NOTHING.test(text)) || recalled) eaten.add(key)
    const time = parseTimeFromText(text) || (recalled && /^([01]\d|2[0-3]):[0-5]\d$/.test(recall.time || '') ? recall.time : null)
    if (time) stated[key] = time
  }
  const meals = hasInfo ? PLAN_MEAL_KEYS.filter((key) => MAIN_MEALS.includes(key) || eaten.has(key)) : [...DEFAULT_ACTIVE_MEALS]
  const times = Object.fromEntries(PLAN_MEALS.map((meal) => [meal.key, stated[meal.key] || meal.suggestedTime]))
  return { meals, times, fromConsultation: hasInfo, stated: Object.keys(stated) }
}

export { PLAN_MEALS, PLAN_MEAL_KEYS, DEFAULT_ACTIVE_MEALS, normalizeActiveMeals, normalizeMealTimes, formatMealTime, parseTimeFromText, suggestMealsFromConsultation }
