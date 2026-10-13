import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import DocumentPage from '../documents/DocumentPage.jsx'
import EquivalentsStep from './EquivalentsStep.jsx'
import RecipeAdjustModal from './RecipeAdjustModal.jsx'
import RecipeSuggestModal from './RecipeSuggestModal.jsx'
import { pruneAdjustments, scaledRecipeLines } from './planAdjustments.js'
import { PLAN_MEALS, formatMealTime, suggestMealsFromConsultation } from '../../../server/domain/planMeals.js'
import { adjustmentFactor, adjustmentKey } from '../../../server/domain/documents.js'
import { equivalentTotals, macroTargets } from '../../../server/domain/equivalents.js'
import { avoidTermsFromText } from '../../../server/domain/recipeSuggestions.js'
import { clinicalApi, nutritionApi, patientsApi, plansApi, recipesApi } from '../../lib/api.js'
import { usePatient } from '../../lib/usePatient.js'
import { isMaleSex, sexLabel } from '../../lib/sex.js'

const sexToFormValue = (sex) => (isMaleSex(sex) ? 'male' : 'female')
const computeAge = (birthDate) => {
  if (!birthDate) return ''
  const dob = new Date(birthDate)
  const now = new Date()
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age -= 1
  return String(age)
}
const formatUTCDate = (iso) => { if (!iso) return null; const d = new Date(iso); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` }

// Todos los tiempos de comida posibles, en el orden del día; cada plan usa sólo algunos.
const MEAL_TYPES = PLAN_MEALS.map((meal) => ({ key: meal.key, label: meal.label, recipeType: meal.recipeType }))
const defaultMealServings = () => Object.fromEntries(MEAL_TYPES.map((meal) => [meal.key, 1]))
const DAYS = [
  { n: 1, label: 'Lunes' },
  { n: 2, label: 'Martes' },
  { n: 3, label: 'Miércoles' },
  { n: 4, label: 'Jueves' },
  { n: 5, label: 'Viernes' },
  { n: 6, label: 'Sábado' },
  { n: 7, label: 'Domingo' },
]
// Ajuste de energía por objetivo, en kcal/día sobre el gasto total (GET).
const ENERGY_ADJUST_OPTIONS = [['0', 'Mantener peso · sin ajuste'], ['-300', 'Bajar de peso · −300 kcal'], ['-500', 'Bajar de peso · −500 kcal'], ['-750', 'Bajar de peso · −750 kcal'], ['300', 'Subir de peso · +300 kcal'], ['500', 'Subir de peso · +500 kcal']]
const ENERGY_ADJUST_PRESETS = ENERGY_ADJUST_OPTIONS.map(([value]) => value)
const ACTIVITY_FACTORS = ['1.2', '1.375', '1.55', '1.725']
// Campos del formulario que cambian el requerimiento: tocarlos deja viejo el resultado calculado.
const ENERGY_FIELDS = ['sex', 'age', 'weightKg', 'heightCm', 'bodyFatPercent', 'formula', 'activityFactor', 'energyAdjustKcal', 'activityMethod', 'metsValue', 'metsMinutes', 'metsSessions']
// Ejercicios frecuentes con su intensidad en METs (Compendio de Actividades Físicas), para no tener
// que recordar el número; se puede escribir cualquier otro valor.
const MET_PRESETS = [['3.5', 'Caminar a paso normal'], ['4.3', 'Caminar rápido'], ['7', 'Trotar'], ['9.8', 'Correr (10 km/h)'], ['5', 'Pesas / fuerza'], ['8', 'HIIT o circuito'], ['7.5', 'Ciclismo moderado'], ['8', 'Natación continua'], ['7', 'Fútbol'], ['6.5', 'Baile aeróbico'], ['2.5', 'Yoga']]
// Lo que se manda al servidor para calcular: con METs va el ejercicio; con factor, no.
const energyPayload = (form) => {
  const { metsValue, metsMinutes, metsSessions, activityMethod, ...rest } = form
  const mets = activityMethod === 'mets' ? { met: Number(metsValue), minutes: Number(metsMinutes), sessionsPerWeek: Number(metsSessions) } : null
  return { ...rest, ...(mets && mets.met > 0 && mets.minutes > 0 && mets.sessionsPerWeek > 0 ? { mets } : {}) }
}
const EMPTY_FORM = { sex: 'female', age: '', weightKg: '', heightCm: '', bodyFatPercent: '', formula: 'mifflin', activityFactor: '1.375', activityMethod: 'factor', metsValue: '', metsMinutes: '', metsSessions: '', energyAdjustKcal: '0', goal: '', carbsPercent: '50', proteinPercent: '25', fatPercent: '25' }
const numberText = (value, fallback) => (value != null && value !== '' && Number.isFinite(Number(value)) ? String(Number(value)) : fallback)
// Formulario del cálculo a partir de UN plan: lo guardado en él, luego los datos de la paciente
// (sexo, edad, última medición) y, si no hay nada, los valores por defecto. Nunca lo que quedó
// escrito del plan o de la paciente anterior.
const formFromPlan = (plan, patient, measurement) => {
  const inputs = plan?.evaluation?.inputs || {}
  const activity = numberText(plan?.activityFactor, '')
  return {
    // El cálculo guardado puede traer el sexo como 'female' (lo que manda este formulario) o como
    // 'Mujer' (lo que guarda el expediente): se lleva siempre al valor del selector.
    sex: inputs.sex != null ? sexToFormValue(inputs.sex) : (patient ? sexToFormValue(patient.sex) : EMPTY_FORM.sex),
    age: inputs.age != null ? String(inputs.age) : (patient ? computeAge(patient.birthDate) : ''),
    weightKg: numberText(inputs.weightKg ?? measurement?.weightKg, ''),
    heightCm: numberText(inputs.heightCm ?? measurement?.heightCm, ''),
    bodyFatPercent: numberText(inputs.bodyFatPercent, ''),
    formula: plan?.formula || EMPTY_FORM.formula,
    activityFactor: ACTIVITY_FACTORS.includes(activity) ? activity : EMPTY_FORM.activityFactor,
    // Actividad por METs (ejercicio medido) en vez de por factor: se restaura lo guardado en el plan.
    activityMethod: plan?.activityMethod === 'mets' && plan?.metsPayload ? 'mets' : 'factor',
    metsValue: numberText(plan?.metsPayload?.met, ''),
    metsMinutes: numberText(plan?.metsPayload?.minutes, ''),
    metsSessions: numberText(plan?.metsPayload?.sessionsPerWeek, ''),
    energyAdjustKcal: numberText(plan?.evaluation?.energyAdjustKcal, '0'),
    goal: plan?.goal || '',
    carbsPercent: numberText(plan?.carbsPercent, EMPTY_FORM.carbsPercent),
    proteinPercent: numberText(plan?.proteinPercent, EMPTY_FORM.proteinPercent),
    fatPercent: numberText(plan?.fatPercent, EMPTY_FORM.fatPercent),
  }
}
const notesFromPlan = (plan) => ({ hydrationNote: plan?.hydrationNote || '', recommendations: plan?.recommendations || '', mealTimes: plan?.mealTimes || {}, equivalents: plan?.equivalents || null, activeMeals: plan?.activeMeals || [], recipeAdjustments: plan?.recipeAdjustments || {}, mealLabels: plan?.mealLabels || {}, mealNotes: plan?.mealNotes || {}, menus: Array.isArray(plan?.menus) ? plan.menus : [] })
const isEditablePlan = (plan) => plan?.status === 'DRAFT' || plan?.status === 'READY'
const latestMeasurementOf = (consultations) => (consultations || []).flatMap((c) => c.measurements || []).sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt))[0] || null
const RECIPE_COLORS = ['coral', 'blue', 'yellow', 'purple']
const NUTRIENT_CHIPS = [['kcal', 'Energía', 'kcal'], ['protein', 'Proteína', 'g'], ['carbs', 'Carbohidratos', 'g'], ['fat', 'Grasas', 'g'], ['fiber', 'Fibra', 'g']]

// Nutrición "efectiva" de una receta para los cálculos del plan: si tiene cálculo SMAE
// (`calculatedNutrition`, recetas importadas vinculadas al catálogo de ingredientes) se usa ese —
// refleja los ingredientes, incluidos los de supermercado—; si no, los valores propios de la receta.
const effectiveNutrition = (recipe) => recipe?.calculatedNutrition || recipe?.nutrition || {}
const slotKey = (day, mealType) => `${day}:${mealType}`

// Pasos del asistente, en orden. "Equivalentes" es opcional: no cuenta para el avance del plan.
const STEP = { EVALUATION: 0, CALCULATION: 1, EQUIVALENTS: 2, DISTRIBUTION: 3, WEEK: 4, DELIVERY: 5 }
const PLAN_STATUS_LABEL = { DRAFT: 'Borrador', READY: 'Listo', PUBLISHED: 'Publicado', SUPERSEDED: 'Reemplazado', CANCELLED: 'Cancelado' }
const PLAN_STEP_LABELS = ['Evaluación', 'Cálculo', 'Distribución', 'Semana', 'Entrega']
// Mismo cálculo de avance que el dashboard de Hoy: pasos Evaluación → Cálculo → Distribución →
// Semana → Entrega, 20% cada uno.
function planProgress(plan) {
  const days = new Set((plan.mealSlots || []).map((slot) => slot.dayOfWeek))
  const steps = [
    (plan.evaluation && typeof plan.evaluation === 'object' && Object.keys(plan.evaluation).length > 0) || !!plan.goal,
    plan.targetKcal != null,
    (plan.mealSlots || []).length > 0,
    days.size >= 5,
    plan.status === 'PUBLISHED' || plan.status === 'SUPERSEDED',
  ]
  return { progress: Math.round((steps.filter(Boolean).length / steps.length) * 100), nextStep: PLAN_STEP_LABELS[steps.findIndex((done) => !done)] || 'Entrega' }
}
const planUpdatedLabel = (iso) => { const d = new Date(iso); const days = Math.floor((Date.now() - d.getTime()) / 86400000); if (days <= 0) return 'hoy'; if (days === 1) return 'ayer'; return `hace ${days} días` }
const consultationReason = (plan) => plan?.consultation?.sections?.find((section) => section.sectionKey === 'summary')?.payload?.['Motivo de consulta'] || plan?.consultation?.sections?.find((section) => section.sectionKey === 'summary')?.payload?.reason || null

// Resumen del expediente para el plan: reúne diagnóstico, padecimientos, alergias, preferencias y
// hallazgos de laboratorio, y arma un objetivo/recomendaciones editables a partir de ellos.
const sectionPayload = (plan, key) => plan?.consultation?.sections?.find((section) => section.sectionKey === key)?.payload || {}
const readExpediente = (plan) => {
  const summary = sectionPayload(plan, 'summary')
  // Los antecedentes familiares vivieron en la sección 'general' antes de fusionarse en Clínico.
  const clinical = { ...sectionPayload(plan, 'general'), ...sectionPayload(plan, 'clinical') }
  const biochemical = sectionPayload(plan, 'biochemical')
  const dietary = sectionPayload(plan, 'dietary')
  const labs = Array.isArray(biochemical['Estudios']) ? biochemical['Estudios'] : []
  return {
    reason: summary['Motivo de consulta'] || summary.reason || null,
    subjectiveGoal: summary.Objetivo || summary.goal || null,
    diagnoses: plan?.consultation?.diagnoses || [],
    conditions: Object.keys(clinical).filter((key) => clinical[key] === true && !key.startsWith('Exploración:')).map((key) => key.replace(/__/g, ' · ')),
    allergies: ['Alergias alimentarias', 'Intolerancias'].map((key) => clinical[key]).filter(Boolean),
    avoid: ['Alimentos que no le agradan o le causan malestar', 'Restricciones dietéticas'].map((key) => dietary[key]).filter(Boolean),
    prefers: dietary['Comidas o bebidas preferidas'] || null,
    outOfRange: labs.filter((lab) => lab.status && lab.status !== 'Normal'),
  }
}
const buildExpedienteGoal = (plan) => {
  const ex = readExpediente(plan)
  const parts = []
  if (ex.subjectiveGoal) parts.push(ex.subjectiveGoal)
  if (ex.diagnoses.length) parts.push(`Manejo de ${ex.diagnoses.map((d) => d.problem).join(', ')}`)
  if (ex.allergies.length) parts.push(`Considerar alergias/intolerancias (${ex.allergies.join(', ')})`)
  return parts.join('. ')
}
const buildExpedienteRecommendations = (plan) => {
  const ex = readExpediente(plan)
  const lines = []
  if (ex.allergies.length) lines.push(`Evitar alérgenos/intolerancias: ${ex.allergies.join(', ')}.`)
  if (ex.avoid.length) lines.push(`Alimentos que causan malestar o restricciones: ${ex.avoid.join(', ')}.`)
  if (ex.prefers) lines.push(`Preferencias del paciente: ${ex.prefers}.`)
  if (ex.outOfRange.length) lines.push(`Vigilar hallazgos de laboratorio: ${ex.outOfRange.map((lab) => `${lab.name} (${String(lab.status).toLowerCase()})`).join(', ')}.`)
  lines.push('Individualizar la dieta según tolerancia y adherencia.')
  return lines.join(' ')
}

export default function PlanStudioPage({ setActive, patientId, onSelectPatient, pendingRecipeName, onConsumeRecipeName }) {
  // Al entrar sin paciente se muestra el hub con TODOS los planes; el paciente se elige al abrir
  // un plan o al crear uno nuevo. Si llega un patientId (desde el expediente / "Asignar al plan"),
  // se abre directo ese paciente.
  const [activePatientId, setActivePatientId] = useState(patientId || '')
  const [mode, setMode] = useState(patientId ? 'patient' : 'hub')
  const [hubPlans, setHubPlans] = useState([])
  const [hubState, setHubState] = useState('loading')
  const [hubQuery, setHubQuery] = useState('')
  const [chooserOpen, setChooserOpen] = useState(false)
  const { patient } = usePatient(activePatientId)
  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Cargando…'
  const patientInitials = patient ? `${patient.firstName[0] || ''}${patient.lastName[0] || ''}` : '··'
  const [step, setStep] = useState(0)
  const steps = ['Evaluación', 'Plan alimentario', 'Equivalentes', 'Distribución', 'Semana', 'Entrega']

  const [patients, setPatients] = useState([])
  const [loadState, setLoadState] = useState('loading')
  const [plan, setPlan] = useState(null)
  const [recipes, setRecipes] = useState([])
  const [slots, setSlots] = useState({})
  // Porciones (factor de ración) por tiempo de comida; se aplican a las 7 días y alimentan el
  // cálculo de adecuación en vivo.
  const [mealServings, setMealServings] = useState(defaultMealServings)
  const mealServingsRef = useRef(defaultMealServings())
  const [saveState, setSaveState] = useState('idle')
  const [pickerTarget, setPickerTarget] = useState(null)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerRestriction, setPickerRestriction] = useState('')
  const [pickerDetail, setPickerDetail] = useState(null)
  const [pickerNutrition, setPickerNutrition] = useState(null)
  const [adequacy, setAdequacy] = useState(null)
  const [adequacyState, setAdequacyState] = useState('idle')
  const [form, setForm] = useState(EMPTY_FORM)
  // "Otro valor…" del ajuste por objetivo: es un modo aparte, no se deduce del valor (si no, el
  // campo desaparecía al pasar por un valor de la lista).
  const [customAdjust, setCustomAdjust] = useState(false)
  const [calcResult, setCalcResult] = useState(null)
  // El resultado mostrado se calculó con datos que ya cambiaron: hay que volver a calcular.
  const [calcStale, setCalcStale] = useState(false)
  const [calcState, setCalcState] = useState('idle')
  const [calcError, setCalcError] = useState('')
  const [evalSaveState, setEvalSaveState] = useState('idle')
  const [evalSaveError, setEvalSaveError] = useState('')
  const [createPlanState, setCreatePlanState] = useState('idle')
  const [plans, setPlans] = useState([])
  const [view, setView] = useState('list')
  const [planActionState, setPlanActionState] = useState('idle')
  const [previewPlan, setPreviewPlan] = useState(null)
  // Tiempo de comida con el ajuste de porciones / las sugerencias de recetas abiertos.
  const [adjustMeal, setAdjustMeal] = useState(null)
  const [suggestMeal, setSuggestMeal] = useState(null)
  const [notesForm, setNotesForm] = useState(() => notesFromPlan(null))
  const [notesSaveState, setNotesSaveState] = useState('idle')
  const notesSaveTimer = useRef(null)
  const notesPendingRef = useRef(null)
  // Los guardados de las indicaciones van en fila: uno a la vez y siempre con lo último escrito.
  const notesChainRef = useRef(Promise.resolve())
  // Un plan publicado es de sólo lectura (el servidor responde 409 a cualquier cambio).
  const planLocked = plan?.status === 'PUBLISHED'
  // Lo "actual" para las respuestas que llegan tarde: plan abierto, paciente, recetas, medición.
  const planIdRef = useRef(null)
  planIdRef.current = plan?.id || null
  const activePatientRef = useRef(activePatientId)
  activePatientRef.current = activePatientId
  const patientRef = useRef(null)
  patientRef.current = patient
  const recipesRef = useRef(recipes)
  recipesRef.current = recipes
  const pendingRecipeNameRef = useRef(pendingRecipeName)
  pendingRecipeNameRef.current = pendingRecipeName
  const measurementRef = useRef({ patientId: null, measurement: null })
  // Abrir o crear un plan a mano mientras se cargan los datos de la paciente: la carga no debe
  // pisar ese plan con "el primer borrador". `planEpochRef` cambia cada vez que se abre/crea uno y
  // `planOpeningRef` cuenta los que están en curso.
  const planEpochRef = useRef(0)
  const planOpeningRef = useRef(0)
  // Distribution saves are full-snapshot PUTs; two rapid edits used to overlap and the older
  // snapshot could land last and silently drop the newest slot. Serialize: keep only the latest
  // snapshot queued, one request in flight at a time, and re-flush whatever arrived meanwhile.
  const slotsInFlightRef = useRef(false)
  const slotsDirtyRef = useRef(null)
  const flushPromiseRef = useRef(null)

  useEffect(() => { patientsApi.list('?status=ACTIVE').then((payload) => setPatients(payload.items || [])).catch(() => setPatients([])) }, [])

  // El hub lista todos los planes de la práctica (sin elegir paciente antes).
  const loadHub = useCallback(() => {
    setHubState('loading')
    plansApi.list().then((response) => { setHubPlans(response.items || []); setHubState('ready') }).catch(() => setHubState('error'))
  }, [])
  useEffect(() => { loadHub() }, [loadHub])

  // Si llega un patientId desde otra pantalla, abrir ese paciente.
  useEffect(() => { if (patientId) { setActivePatientId(patientId); setMode('patient') } }, [patientId])

  useEffect(() => {
    if (!patient) return
    setForm((prev) => ({ ...prev, sex: sexToFormValue(patient.sex), age: computeAge(patient.birthDate) || prev.age }))
  }, [patient])

  // La respuesta de un guardado trae sólo la fila del plan: se conserva lo ya cargado (consulta,
  // recetas asignadas). Si entre tanto se abrió OTRO plan, la respuesta se descarta.
  const mergePlan = (updated) => setPlan((prev) => (prev && updated && prev.id === updated.id ? { ...prev, ...updated } : prev))

  // Pone un plan en pantalla: recetas de la semana, porciones, formulario del cálculo e
  // indicaciones salen todos de ESE plan. `recipeIds` descarta recetas archivadas.
  const applyPlan = (nextPlan, { recipeIds = null, keepNotes = false } = {}) => {
    const samePlan = (nextPlan?.id || null) === planIdRef.current
    const nextSlots = {}
    const nextServings = defaultMealServings()
    for (const slot of nextPlan?.mealSlots || []) {
      if (slot.servings != null) nextServings[slot.mealType] = Number(slot.servings)
      if (slot.recipeId && (!recipeIds || recipeIds.has(slot.recipeId))) nextSlots[slotKey(slot.dayOfWeek, slot.mealType)] = slot.recipeId
    }
    mealServingsRef.current = nextServings
    setMealServings(nextServings)
    setPlan(nextPlan)
    setSlots(nextSlots)
    const planPatient = nextPlan?.patientId || activePatientRef.current
    const nextForm = formFromPlan(nextPlan, patientRef.current?.id === planPatient ? patientRef.current : null, measurementRef.current.patientId === planPatient ? measurementRef.current.measurement : null)
    setForm(nextForm)
    setCustomAdjust(!ENERGY_ADJUST_PRESETS.includes(nextForm.energyAdjustKcal))
    if (!(keepNotes && samePlan)) setNotesForm(notesFromPlan(nextPlan))
    if (!samePlan) { setCalcResult(null); setCalcState('idle'); setCalcStale(false); setEvalSaveState('idle'); setSaveState('idle'); setNotesSaveState('idle'); setAdjustMeal(null); setSuggestMeal(null); setPickerTarget(null) }
  }

  const loadPlanData = useCallback(async () => {
    const patientAtStart = activePatientId
    const epoch = planEpochRef.current
    if (!patientAtStart) { setLoadState('ready'); return }
    try {
      const [plansResponse, recipesResponse, consultationsResponse] = await Promise.all([patientsApi.plans(patientAtStart), recipesApi.list(), patientsApi.consultations(patientAtStart)])
      // La paciente cambió mientras cargaba: esta respuesta ya no aplica.
      if (activePatientRef.current !== patientAtStart) return
      const planItems = plansResponse.items || []
      const recipeItems = recipesResponse.items || []
      setPlans(planItems)
      setRecipes(recipeItems)
      // Peso y talla salen de fuentes reales, nunca de valores de ejemplo: gana el último cálculo
      // guardado, luego la última medición clínica, y si no hay, campos vacíos por llenar.
      const measurement = latestMeasurementOf(consultationsResponse.items)
      measurementRef.current = { patientId: patientAtStart, measurement }
      // Se abrió o creó un plan a mano mientras cargaba: ese manda. Sólo se completan peso y
      // talla si quedaron vacíos (la medición no se conocía todavía).
      if (planOpeningRef.current > 0 || planEpochRef.current !== epoch) {
        if (measurement) setForm((prev) => ({ ...prev, weightKg: prev.weightKg || numberText(measurement.weightKg, ''), heightCm: prev.heightCm || numberText(measurement.heightCm, '') }))
        setLoadState('ready')
        return
      }
      // El plan en pantalla se conserva si sigue siendo editable; si no, el borrador (o listo)
      // más reciente. Nunca un cancelado/publicado.
      const activePlan = planItems.find((item) => item.id === planIdRef.current && isEditablePlan(item)) || planItems.find((item) => item.status === 'DRAFT') || planItems.find((item) => item.status === 'READY') || null
      // El listado de planes no incluye la consulta; se trae el plan completo para tener las
      // secciones del expediente (resumen del expediente → plan).
      let fullPlan = activePlan
      if (activePlan?.id) { try { fullPlan = await plansApi.get(activePlan.id) } catch { fullPlan = activePlan } }
      if (activePatientRef.current !== patientAtStart || planOpeningRef.current > 0 || planEpochRef.current !== epoch) { setLoadState('ready'); return }
      // Drop slots that reference archived/unknown recipes so they don't linger as invisible rows.
      applyPlan(fullPlan, { recipeIds: new Set(recipeItems.map((recipe) => recipe.id)), keepNotes: true })
      // Si venimos de "Asignar al plan" (pendingRecipeName), abrir directo el paso Distribución;
      // si no, mostrar primero el listado de planes por estado.
      if (pendingRecipeNameRef.current) { setView('wizard'); setStep(STEP.DISTRIBUTION) } else { setView('list') }
      setLoadState('ready')
    } catch {
      if (activePatientRef.current === patientAtStart) setLoadState('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePatientId])
  const loadPlanDataRef = useRef(loadPlanData)
  loadPlanDataRef.current = loadPlanData

  useEffect(() => { loadPlanData() }, [loadPlanData])
  // pendingRecipeName (from "Asignar al plan") prefills the recipe picker, but only gets consumed
  // when a picker opens — leaving without opening it would leak the stale name into a later,
  // unrelated picker. Consume it on unmount if it was never used.
  const consumeRecipeNameRef = useRef(onConsumeRecipeName)
  useEffect(() => { consumeRecipeNameRef.current = onConsumeRecipeName })
  useEffect(() => () => consumeRecipeNameRef.current?.(), [])
  // Flush a pending notes edit on unmount (the 800ms debounce would otherwise drop it).
  useEffect(() => () => {
    clearTimeout(notesSaveTimer.current)
    const pending = notesPendingRef.current
    if (pending) plansApi.update(pending.planId, pending.next).catch(() => {})
  }, [])
  // Publicar (paso Entrega) deja el plan de sólo lectura: se refleja aquí sin salir del paso, para
  // que la descarga del PDF y "Marcar como entregado" sigan a la mano, y se refrescan los listados.
  const handlePublished = (published) => {
    mergePlan(published)
    const pid = activePatientRef.current
    if (pid) patientsApi.plans(pid).then((response) => { if (activePatientRef.current === pid) setPlans(response.items || []) }).catch(() => {})
    loadHub()
  }

  const recipeById = (id) => recipes.find((recipe) => recipe.id === id)

  // RF-07 macro distribution: percentages the professional can adjust; they must sum to 100 and
  // map to grams against the calculated requirement.
  const macroSum = Number(form.carbsPercent || 0) + Number(form.proteinPercent || 0) + Number(form.fatPercent || 0)
  const calcTarget = calcResult ? calcResult.targetKcal ?? calcResult.get : null
  const macroGrams = (pct, factor) => (calcTarget ? Math.round((calcTarget * (Number(pct) || 0)) / 100 / factor) : null)
  // Cunningham / Katch-McArdle compute BMR from lean mass (needs body fat); without an input they
  // silently fall back to total mass and inflate the requirement — so the field is only shown and
  // only required meaningfully for those two formulas.
  const needsBodyFat = form.formula === 'cunningham' || form.formula === 'katch-mcardle'

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    // El resultado en pantalla ya no corresponde a estos datos (y "Guardar" recalcula con ellos).
    if (ENERGY_FIELDS.includes(key) && calcResult) { setCalcStale(true); setEvalSaveState('idle') }
  }

  const calculate = async (event) => {
    event.preventDefault()
    setCalcState('loading')
    setCalcError('')
    setEvalSaveState('idle')
    try {
      const response = await nutritionApi.calculate(energyPayload(form))
      setCalcResult(response)
      setCalcStale(false)
      setCalcState('success')
    } catch (error) {
      setCalcState('error')
      setCalcError(error.message || 'No se pudo calcular. Verifica que el API esté activo.')
    }
  }

  const saveToPlan = async () => {
    if (!plan || planLocked || calcStale) return
    setEvalSaveState('saving')
    setEvalSaveError('')
    try {
      const updated = await plansApi.evaluate(plan.id, { ...energyPayload(form), energyAdjustKcal: Number(form.energyAdjustKcal) || 0, carbsPercent: Number(form.carbsPercent) || 50, proteinPercent: Number(form.proteinPercent) || 25, fatPercent: Number(form.fatPercent) || 25 })
      mergePlan(updated)
      setEvalSaveState('saved')
    } catch (error) {
      setEvalSaveState('error')
      setEvalSaveError(error.message || 'No se pudo guardar el plan.')
    }
  }

  const updateNotes = (key, value) => patchNotes({ [key]: value })
  // Envía lo pendiente de las indicaciones del plan (horas, equivalentes, tiempos, ajustes de
  // receta, notas). Los envíos van en fila y cada uno manda lo ÚLTIMO pendiente, así una respuesta
  // vieja no puede pisar ni dar por guardado un cambio más nuevo; si falla, lo pendiente se queda
  // para el siguiente intento.
  const flushNotes = () => {
    clearTimeout(notesSaveTimer.current)
    const run = notesChainRef.current.then(async () => {
      const pending = notesPendingRef.current
      if (!pending) return
      setNotesSaveState('saving')
      try {
        const updated = await plansApi.update(pending.planId, pending.next)
        mergePlan(updated)
        if (notesPendingRef.current === pending) { notesPendingRef.current = null; setNotesSaveState('saved') }
      } catch {
        if (notesPendingRef.current === pending) setNotesSaveState('error')
      }
    })
    notesChainRef.current = run
    return run
  }
  // Varios campos de las indicaciones del plan en un solo guardado (dos updateNotes seguidos se
  // pisarían: cada uno parte del notesForm de este render).
  const patchNotes = (patch) => {
    if (planLocked) return
    const next = { ...notesForm, ...patch }
    setNotesForm(next)
    if (!plan) return
    setNotesSaveState('editing')
    // Keep the latest payload for the unmount flush (a navigation within the 800ms window must
    // not drop the edit on the floor).
    notesPendingRef.current = { planId: plan.id, next }
    clearTimeout(notesSaveTimer.current)
    notesSaveTimer.current = setTimeout(flushNotes, 800)
  }

  const createPlan = async (pid) => {
    const targetId = pid || activePatientId
    if (!targetId) return
    setCreatePlanState('creating')
    planEpochRef.current += 1
    planOpeningRef.current += 1
    try {
      const consultationsResponse = await patientsApi.consultations(targetId)
      let consultation = (consultationsResponse.items || []).find((item) => item.status === 'IN_PROGRESS')
      if (!consultation) consultation = await clinicalApi.create(targetId, {})
      const created = await plansApi.create(targetId, { consultationId: consultation.id })
      // El alta devuelve sólo la fila: se trae el plan completo para tener la consulta (tiempos y
      // horas propuestos, resumen del expediente) desde el primer momento.
      let full = created
      try { full = await plansApi.get(created.id) } catch { full = created }
      measurementRef.current = { patientId: targetId, measurement: latestMeasurementOf(consultationsResponse.items) }
      planEpochRef.current += 1
      applyPlan(full)
      setMode('patient')
      setView('wizard')
      setStep(1)
      setCreatePlanState('idle')
      loadHub()
      patientsApi.plans(targetId).then((response) => { if (activePatientRef.current === targetId) setPlans(response.items || []) }).catch(() => {})
    } catch {
      setCreatePlanState('error')
      // La carga de la paciente pudo haberse saltado el plan esperando a éste: se repite.
      loadPlanDataRef.current()
    } finally {
      planOpeningRef.current -= 1
    }
  }

  // Abre un plan desde el listado: los borradores/listos continúan en el wizard; los
  // publicados/reemplazados/cancelados se ven con el menú congelado (solo lectura).
  const openPlan = async (item) => {
    if (!item) return
    setPlanActionState(item.id)
    const editable = isEditablePlan(item)
    if (editable) { planEpochRef.current += 1; planOpeningRef.current += 1 }
    try {
      // Lo que quedara por guardar del plan abierto se envía antes de leer el que se abre.
      if (notesPendingRef.current) await flushNotes()
      const full = await plansApi.get(item.id)
      if (isEditablePlan(full)) {
        planEpochRef.current += 1
        applyPlan(full, { recipeIds: recipesRef.current.length ? new Set(recipesRef.current.map((recipe) => recipe.id)) : null })
        setStep(0)
        setView('wizard')
      } else {
        setPreviewPlan(full)
      }
    } catch {
      // La lista queda como estaba; si la carga de la paciente esperaba a este plan, se repite.
      if (editable) loadPlanDataRef.current()
    } finally {
      if (editable) planOpeningRef.current -= 1
      setPlanActionState('idle')
    }
  }

  const changePlanStatus = async (item, action) => {
    setPlanActionState(item.id)
    try {
      await (action === 'cancel' ? plansApi.cancel(item.id) : plansApi.reactivate(item.id))
      await loadPlanData()
      loadHub()
    } catch { /* deja la lista */ } finally { setPlanActionState('idle') }
  }

  // Abrir un plan desde el hub: un borrador/listo pasa al wizard de ese paciente; un plan ya
  // cerrado (publicado/cancelado) se ve en el modal del menú sin salir del hub.
  const openPlanFromHub = (item) => {
    if (item.status === 'DRAFT' || item.status === 'READY') {
      // La carga de datos de la paciente corre a la par y no pisa el plan que abre openPlan.
      setActivePatientId(item.patientId)
      setMode('patient')
      openPlan(item)
      return
    }
    setPlanActionState(item.id)
    plansApi.get(item.id).then((full) => setPreviewPlan(full)).catch(() => {}).finally(() => setPlanActionState('idle'))
  }

  const startNewPlanFor = (pid) => {
    setChooserOpen(false)
    // Igual que al abrir un plan: la carga de datos de la paciente no pisa el plan recién creado.
    setActivePatientId(pid)
    setMode('patient')
    createPlan(pid)
  }

  const persistSlots = (nextSlots) => {
    if (!plan || planLocked) return
    // Cada foto del menú lleva su plan y sus porciones: si se cambia de plan con un guardado en
    // curso, lo pendiente sigue yendo al plan al que pertenece.
    slotsDirtyRef.current = { planId: plan.id, slots: nextSlots, servings: { ...mealServingsRef.current } }
    // Serialize saves (see the refs above) and share the in-flight promise so navigation to the
    // Entrega step can AWAIT the final menu instead of showing a stale snapshot.
    if (!flushPromiseRef.current) flushPromiseRef.current = flushEverything().finally(() => { flushPromiseRef.current = null })
  }

  const flushEverything = async () => {
    // Loop until both the queue and the in-flight request are empty (new edits land while one
    // save is pending are picked up on the next pass, so the LAST snapshot always wins).
    while (slotsDirtyRef.current || slotsInFlightRef.current) {
      if (slotsDirtyRef.current && !slotsInFlightRef.current) {
        const snapshot = slotsDirtyRef.current
        slotsDirtyRef.current = null
        slotsInFlightRef.current = true
        const current = () => planIdRef.current === snapshot.planId
        if (current()) setSaveState('saving')
        const activeIds = new Set(recipesRef.current.map((recipe) => recipe.id))
        const payload = Object.entries(snapshot.slots)
          .filter(([, recipeId]) => recipeId && activeIds.has(recipeId))
          .map(([key, recipeId]) => {
            const [day, mealType] = key.split(':')
            return { dayOfWeek: Number(day), mealType, recipeId, servings: snapshot.servings[mealType] ?? 1 }
          })
        try {
          const updated = await plansApi.saveDistribution(snapshot.planId, payload)
          mergePlan(updated)
          if (current()) setSaveState('saved')
        } catch {
          if (current()) setSaveState('error')
        } finally {
          slotsInFlightRef.current = false
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
    }
  }

  // Tiempos de comida de este plan. Mientras no se personalicen se proponen a partir de la consulta
  // (los que la paciente dijo hacer, con sus horas); un tiempo con recetas siempre se muestra.
  const mealSuggestion = useMemo(() => suggestMealsFromConsultation(sectionPayload(plan, 'dietary')), [plan?.consultation])
  const chosenMeals = notesForm.activeMeals?.length ? notesForm.activeMeals : mealSuggestion.meals
  const mealHasRecipes = (key) => DAYS.some((day) => slots[slotKey(day.n, key)])
  // Cada tiempo lleva el nombre propio que se le haya dado en este plan ("Pre-entreno").
  const visibleMeals = MEAL_TYPES.filter((meal) => chosenMeals.includes(meal.key) || mealHasRecipes(meal.key)).map((meal) => (notesForm.mealLabels?.[meal.key] ? { ...meal, label: notesForm.mealLabels[meal.key], baseLabel: meal.label } : meal))
  const visibleMealKeys = visibleMeals.map((meal) => meal.key)
  const hiddenMeals = MEAL_TYPES.filter((meal) => !visibleMealKeys.includes(meal.key))
  // Los equivalentes se reparten entre los tiempos que ya tienen recetas (son los que salen en el
  // plan impreso); sin recetas todavía, entre todos los del plan.
  const mealsWithRecipes = visibleMealKeys.filter(mealHasRecipes)
  const equivalentMeals = mealsWithRecipes.length ? mealsWithRecipes : visibleMealKeys

  // Cambia las recetas de la semana y, en el MISMO guardado de indicaciones, quita los ajustes de
  // las recetas que dejaron de estar asignadas a su tiempo de comida (si no, reaparecían solos al
  // volver a asignar la receta). `notesPatch` son otros campos del plan que cambian a la vez.
  const commitSlots = (nextSlots, notesPatch = {}) => {
    if (planLocked) return
    setSlots(nextSlots)
    persistSlots(nextSlots)
    const current = notesPatch.recipeAdjustments || notesForm.recipeAdjustments || {}
    const pruned = pruneAdjustments(current, nextSlots)
    const patch = { ...notesPatch }
    if (notesPatch.recipeAdjustments || pruned !== current) patch.recipeAdjustments = pruned
    if (Object.keys(patch).length) patchNotes(patch)
  }

  const addMeal = (key) => {
    if (!key || planLocked) return
    const time = notesForm.mealTimes?.[key] || mealSuggestion.times[key]
    patchNotes({ activeMeals: [...visibleMealKeys, key], mealTimes: { ...notesForm.mealTimes, [key]: time } })
  }
  const removeMeal = (meal) => {
    if (planLocked || visibleMeals.length <= 1) return
    const hadRecipes = mealHasRecipes(meal.key)
    if (hadRecipes && !window.confirm(`Quitar "${meal.label}" también quita las recetas que tiene asignadas en la semana. ¿Continuar?`)) return
    const mealTimes = { ...notesForm.mealTimes }
    delete mealTimes[meal.key]
    const patch = { activeMeals: visibleMealKeys.filter((key) => key !== meal.key), mealTimes }
    // Los equivalentes repartidos a ese tiempo se van con él: quedan otra vez "por repartir".
    if (notesForm.equivalents?.distribution?.[meal.key]) {
      const distribution = { ...notesForm.equivalents.distribution }
      delete distribution[meal.key]
      patch.equivalents = { ...notesForm.equivalents, distribution }
    }
    if (!hadRecipes) { patchNotes(patch); return }
    const nextSlots = { ...slots }
    for (const day of DAYS) delete nextSlots[slotKey(day.n, meal.key)]
    commitSlots(nextSlots, patch)
  }
  // Menús del plan (tipos de día): el base es `equivalents`; los adicionales tienen sus días, su
  // ajuste de energía y su propio cuadro de equivalentes.
  const [menuTab, setMenuTab] = useState('base')
  const extraMenus = notesForm.menus || []
  const activeMenu = extraMenus.find((menu) => menu.id === menuTab) || null
  const updateMenu = (id, patch) => updateNotes('menus', extraMenus.map((menu) => (menu.id === id ? { ...menu, ...patch } : menu)))
  const addMenu = () => {
    const answer = window.prompt('Nombre del menú nuevo (por ejemplo "Día de entrenamiento" o "Fin de semana"):')
    const name = (answer || '').trim().slice(0, 40)
    if (!name) return
    const id = `m${Date.now().toString(36)}`
    // Parte de una copia del menú base, que es lo habitual: se ajusta desde ahí.
    updateNotes('menus', [...extraMenus, { id, name, days: [], kcalDelta: 0, equivalents: JSON.parse(JSON.stringify(notesForm.equivalents || { groups: {}, distribution: {} })) }])
    setMenuTab(id)
  }
  const removeMenu = (menu) => {
    if (!window.confirm(`¿Quitar el menú "${menu.name}"? Sus días vuelven al menú base.`)) return
    updateNotes('menus', extraMenus.filter((item) => item.id !== menu.id))
    setMenuTab('base')
  }
  // Un día pertenece a un solo menú: al marcarlo aquí se quita de los demás.
  const toggleMenuDay = (menu, day) => updateNotes('menus', extraMenus.map((item) => {
    const days = (item.days || []).filter((value) => value !== day)
    return item.id === menu.id && !(menu.days || []).includes(day) ? { ...item, days: [...days, day].sort() } : { ...item, days }
  }))
  const baseMenuDays = DAYS.filter((day) => !extraMenus.some((menu) => (menu.days || []).includes(day.n)))
  const renameMeal = (meal) => {
    const answer = window.prompt(`Nombre de este tiempo de comida en el plan (vacío para volver a "${meal.baseLabel || meal.label}"):`, meal.label)
    if (answer === null) return
    const labels = { ...(notesForm.mealLabels || {}) }
    const name = answer.trim().slice(0, 28)
    if (name && name !== (meal.baseLabel || meal.label)) labels[meal.key] = name
    else delete labels[meal.key]
    updateNotes('mealLabels', labels)
  }
  // Agua sugerida a partir del peso: ml por kg → litros y vasos de 250 ml.
  const [waterMlPerKg, setWaterMlPerKg] = useState('35')
  const planWeightKg = Number(plan?.evaluation?.inputs?.weightKg) || null
  const waterLiters = planWeightKg && Number(waterMlPerKg) > 0 ? Math.round(planWeightKg * Number(waterMlPerKg) / 10) / 100 : null
  const applyWater = () => { if (waterLiters) updateNotes('hydrationNote', `Toma ${Math.round(waterLiters * 4)} vasos (${waterLiters.toFixed(1)} L) de agua natural al día.`) }
  const missingTimes = visibleMeals.filter((meal) => !notesForm.mealTimes?.[meal.key])
  const applySuggestedTimes = () => patchNotes({ mealTimes: { ...Object.fromEntries(missingTimes.map((meal) => [meal.key, mealSuggestion.times[meal.key]])), ...notesForm.mealTimes } })

  // Recetas distintas de un tiempo de comida (las "opciones" del plan impreso) y sus ajustes.
  const mealRecipes = (key) => { const seen = new Set(); return DAYS.map((day) => recipeById(slots[slotKey(day.n, key)])).filter((recipe) => recipe && !seen.has(recipe.id) && seen.add(recipe.id)) }
  const adjustedCount = (key) => mealRecipes(key).filter((recipe) => notesForm.recipeAdjustments?.[adjustmentKey(key, recipe.id)]).length
  // Factor nutrimental de una receta en un tiempo de comida (1 sin ajuste): sus kcal y macros se
  // cuentan multiplicados por él en todo lo que suma el plan.
  const factorFor = (mealKey, recipeId) => adjustmentFactor(notesForm.recipeAdjustments, mealKey, recipeId)
  // `adjustment` es { lines, factor } o null (quitar el ajuste).
  const saveAdjustment = (mealKey, recipeId, adjustment) => {
    const next = { ...(notesForm.recipeAdjustments || {}) }
    // `items` viene cuando la receta se editó por equivalentes: se guarda para poder reabrirla así.
    if (adjustment?.lines?.length) next[adjustmentKey(mealKey, recipeId)] = { lines: adjustment.lines, factor: adjustment.factor ?? 1, ...(adjustment.items?.length ? { items: adjustment.items } : {}) }
    else delete next[adjustmentKey(mealKey, recipeId)]
    updateNotes('recipeAdjustments', next)
  }

  // Lo calculado para un tiempo de comida, que es a lo que se acercan las sugerencias de recetas:
  // los equivalentes que se le repartieron; si no tiene, su parte proporcional del requerimiento
  // del día entre los tiempos del plan; sin requerimiento guardado, nada (null).
  const mealTarget = (mealKey) => {
    const prescribed = equivalentTotals(notesForm.equivalents?.distribution?.[mealKey])
    if (prescribed.kcal > 0) return { ...prescribed, source: 'equivalents' }
    if (plan?.targetKcal == null) return null
    const shareOf = (key) => PLAN_MEALS.find((item) => item.key === key)?.share || 0
    const keys = visibleMealKeys.includes(mealKey) ? visibleMealKeys : [...visibleMealKeys, mealKey]
    const total = keys.reduce((sum, key) => sum + shareOf(key), 0)
    if (!total) return null
    return { ...macroTargets({ kcal: (Number(plan.targetKcal) * shareOf(mealKey)) / total, carbsPercent: plan.carbsPercent, proteinPercent: plan.proteinPercent, fatPercent: plan.fatPercent }), source: 'share' }
  }
  const suggestTarget = useMemo(() => (suggestMeal ? mealTarget(suggestMeal.key) : null), [suggestMeal, notesForm.equivalents, plan?.targetKcal, plan?.carbsPercent, plan?.proteinPercent, plan?.fatPercent, visibleMealKeys.join('|')])
  // Recetas ya asignadas a OTROS tiempos de comida: no se sugieren de nuevo.
  const suggestExclude = useMemo(() => (suggestMeal ? [...new Set(Object.entries(slots).filter(([key, recipeId]) => recipeId && key.split(':')[1] !== suggestMeal.key).map(([, recipeId]) => recipeId))] : []), [suggestMeal, slots])
  const suggestAvoid = useMemo(() => { if (!suggestMeal || !plan?.consultation) return []; const ex = readExpediente(plan); return avoidTermsFromText(ex.allergies, ex.avoid) }, [suggestMeal, plan?.consultation])
  // Llena la semana del tiempo de comida con las recetas elegidas: la opción i va al día i+1 y,
  // si son menos de 7, los días que faltan repiten desde la primera. Cada receta con factor
  // distinto de 1 entra con sus cantidades ya ajustadas (lo mismo que "Ajustar al cálculo").
  const applySuggestions = (meal, picks) => {
    if (planLocked || !picks.length) return
    if (mealHasRecipes(meal.key) && !window.confirm(`"${meal.label}" ya tiene recetas en la semana: se reemplazan por las ${picks.length} seleccionadas y se quitan sus ajustes de cantidades. ¿Continuar?`)) return
    const used = picks.slice(0, DAYS.length)
    const nextSlots = { ...slots }
    DAYS.forEach((day, index) => { nextSlots[slotKey(day.n, meal.key)] = used[index % used.length].recipe.id })
    const servings = mealServingsFor(meal.key)
    const adjustments = { ...(notesForm.recipeAdjustments || {}) }
    for (const pick of used) {
      const key = adjustmentKey(meal.key, pick.recipe.id)
      if (pick.factor !== 1) adjustments[key] = { lines: scaledRecipeLines(pick.recipe, servings, pick.factor), factor: pick.factor }
      else delete adjustments[key]
    }
    const patch = { recipeAdjustments: adjustments }
    // Si el tiempo todavía era sólo "propuesto", queda fijo en el plan junto con los demás.
    if (!notesForm.activeMeals?.includes(meal.key)) patch.activeMeals = visibleMealKeys.includes(meal.key) ? visibleMealKeys : [...visibleMealKeys, meal.key]
    commitSlots(nextSlots, patch)
    setSuggestMeal(null)
  }

  const selectStep = async (next) => {
    // Entering Entrega must see the final menu: flush any pending distribution save first.
    // …and so must the plan's own fields (hours, equivalents, adjusted portions), which save on a
    // debounce: write them now instead of waiting for the timer.
    if (next === STEP.DELIVERY && plan && !planLocked) {
      if (notesPendingRef.current) await flushNotes()
      if (slotsDirtyRef.current || slotsInFlightRef.current) {
        if (!flushPromiseRef.current) flushPromiseRef.current = flushEverything().finally(() => { flushPromiseRef.current = null })
        await flushPromiseRef.current
      }
    }
    setStep(next)
  }
  // Reintenta lo que no se pudo guardar (indicaciones pendientes y la semana tal como está).
  const retrySave = () => { if (notesPendingRef.current) flushNotes(); if (saveState === 'error') persistSlots(slots) }
  // Un solo estado de guardado para todo el plan (semana + indicaciones): antes un fallo al
  // guardar equivalentes, horas o ajustes no se veía fuera del paso Semana.
  const combinedSave = planLocked ? 'locked' : saveState === 'error' || notesSaveState === 'error' ? 'error' : saveState === 'saving' || notesSaveState === 'saving' || notesSaveState === 'editing' ? 'saving' : 'saved'
  const syncLabel = <span className={'sync-label ' + (combinedSave === 'saving' ? 'loading' : combinedSave === 'error' ? 'demo' : 'online')}>{combinedSave === 'saving' ? '● Guardando…' : combinedSave === 'error' ? '● Error al guardar' : combinedSave === 'locked' ? '● Publicado · sólo lectura' : plan ? '● Sincronizado' : '● Sin plan en borrador'}</span>

  const openPicker = (mealType, day = null) => { if (planLocked) return; setPickerSearch(pendingRecipeName || ''); setPickerRestriction(''); setPickerDetail(null); if (pendingRecipeName) onConsumeRecipeName?.(); setPickerTarget({ mealType, day }) }
  const closePicker = () => { setPickerTarget(null); setPickerDetail(null) }

  // Al abrir el detalle de una receta se cargan sus ingredientes y la información nutrimental.
  useEffect(() => {
    if (!pickerDetail) { setPickerNutrition(null); return undefined }
    let cancelled = false
    setPickerNutrition({ state: 'loading' })
    recipesApi.nutrition(pickerDetail.id)
      .then((data) => { if (!cancelled) setPickerNutrition({ state: 'ready', ...data }) })
      .catch(() => { if (!cancelled) setPickerNutrition({ state: 'error' }) })
    return () => { cancelled = true }
  }, [pickerDetail?.id])

  const chooseRecipe = (recipe) => {
    if (!pickerTarget || planLocked) return
    if (!pickerTarget.day) {
      // "Receta base de la semana" writes to all 7 days; warn before silently clobbering any
      // per-day customizations the professional made in the Semana step.
      const differing = DAYS.filter((day) => slots[slotKey(day.n, pickerTarget.mealType)] && slots[slotKey(day.n, pickerTarget.mealType)] !== recipe.id)
      if (differing.length && !window.confirm(`Establecer "${recipe.name}" como base reemplazará las ${differing.length} receta(s) personalizada(s) de ese tiempo de comida. ¿Continuar?`)) {
        setPickerTarget(null)
        return
      }
    }
    const nextSlots = { ...slots }
    if (pickerTarget.day) nextSlots[slotKey(pickerTarget.day, pickerTarget.mealType)] = recipe.id
    else for (const day of DAYS) nextSlots[slotKey(day.n, pickerTarget.mealType)] = recipe.id
    setPickerTarget(null)
    setPickerDetail(null)
    commitSlots(nextSlots)
  }

  const clearSlot = (mealType, day) => {
    if (planLocked) return
    const nextSlots = { ...slots }
    delete nextSlots[slotKey(day, mealType)]
    commitSlots(nextSlots)
  }

  useEffect(() => {
    if (step !== STEP.WEEK || !plan) return
    let cancelled = false
    setAdequacyState('loading')
    plansApi.adequacy(plan.id)
      .then((response) => { if (!cancelled) { setAdequacy(response); setAdequacyState('ready') } })
      .catch(() => { if (!cancelled) setAdequacyState('error') })
    return () => { cancelled = true }
  }, [step, plan])

  const mealServingsFor = (mealType) => mealServingsRef.current[mealType] ?? 1
  const averageKcalForMeal = (mealType) => {
    const assigned = DAYS.map((day) => recipeById(slots[slotKey(day.n, mealType)])).filter(Boolean)
    if (!assigned.length) return null
    const total = assigned.reduce((sum, recipe) => sum + (Number(effectiveNutrition(recipe).kcal) || 0) * factorFor(mealType, recipe.id), 0) / assigned.length
    return Math.round(total * mealServingsFor(mealType))
  }

  // Totales promedio por día del plan (recetas × porciones × factor del ajuste) para el panel de
  // adecuación. Igual que el panel de micronutrientes, promedia los días que tienen al menos una
  // receta: un plan de lunes a viernes no sale "por debajo" por los dos días vacíos.
  const planDaily = () => {
    const keys = ['kcal', 'protein', 'carbs', 'fat']
    const totals = Object.fromEntries(keys.map((key) => [key, 0]))
    const daysWithRecipes = new Set()
    for (const meal of MEAL_TYPES) {
      const servings = mealServingsFor(meal.key)
      for (const day of DAYS) {
        const recipe = recipeById(slots[slotKey(day.n, meal.key)])
        if (!recipe) continue
        daysWithRecipes.add(day.n)
        const scale = servings * factorFor(meal.key, recipe.id)
        for (const key of keys) totals[key] += Number(effectiveNutrition(recipe)[key] || 0) * scale
      }
    }
    for (const key of keys) totals[key] = totals[key] / (daysWithRecipes.size || 1)
    return { ...totals, days: daysWithRecipes.size }
  }

  const changeServings = (mealType, delta) => {
    if (planLocked) return
    const current = mealServingsRef.current[mealType] ?? 1
    const next = Math.min(5, Math.max(0.5, Math.round((current + delta) * 2) / 2))
    if (next === current) return
    // Las cantidades ajustadas se escribieron para las porciones anteriores: se quitan (con aviso)
    // en vez de entregar a la paciente cantidades que ya no corresponden.
    const adjusted = Object.keys(notesForm.recipeAdjustments || {}).filter((key) => key.startsWith(`${mealType}|`))
    if (adjusted.length) {
      const label = MEAL_TYPES.find((meal) => meal.key === mealType)?.label || mealType
      if (!window.confirm(`${label} tiene ${adjusted.length === 1 ? 'una receta con cantidades ajustadas' : `${adjusted.length} recetas con cantidades ajustadas`} para ${current} ${current === 1 ? 'porción' : 'porciones'}. Al cambiar las porciones esos ajustes se quitan y habrá que volver a hacerlos. ¿Continuar?`)) return
    }
    const nextServings = { ...mealServingsRef.current, [mealType]: next }
    mealServingsRef.current = nextServings
    setMealServings(nextServings)
    persistSlots(slots)
    if (adjusted.length) patchNotes({ recipeAdjustments: Object.fromEntries(Object.entries(notesForm.recipeAdjustments).filter(([key]) => !adjusted.includes(key))) })
  }

  // Panel de adecuación en vivo: kcal y macros del plan vs el requerimiento, rojo si se pasa.
  const renderAdequacy = () => {
    const daily = planDaily()
    const targetKcal = plan?.targetKcal || null
    const pct = targetKcal ? Math.round((daily.kcal / targetKcal) * 100) : null
    const status = pct == null ? null : pct > 105 ? 'over' : pct < 95 ? 'low' : 'ok'
    const macroRows = [['Carbohidratos', daily.carbs, plan?.carbsPercent, 4], ['Proteína', daily.protein, plan?.proteinPercent, 4], ['Grasas', daily.fat, plan?.fatPercent, 9]].map(([label, grams, percent, factor]) => {
      const targetGrams = targetKcal && percent != null ? (targetKcal * Number(percent)) / 100 / factor : null
      const gramsPct = targetGrams ? Math.round((grams / targetGrams) * 100) : null
      const pctOfKcal = daily.kcal ? Math.round(((grams * factor) / daily.kcal) * 100) : null
      return { label, grams: Math.round(grams), targetGrams: targetGrams ? Math.round(targetGrams) : null, gramsPct, pctOfKcal, targetPct: percent != null ? Number(percent) : null }
    })
    const hasPlan = daily.kcal > 0
    return <section className="plan-adequacy panel">
      <div className="pa-head"><p className="eyebrow">ADECUACIÓN DEL PLAN · PROMEDIO DIARIO</p>{targetKcal ? <span className={'pa-status ' + (status || '')}>{pct}% {status === 'over' ? '· por encima' : status === 'low' ? '· por debajo' : '· adecuado'}</span> : <span className="muted">Sin cálculo guardado (paso Plan alimentario)</span>}</div>
      {!hasPlan && <p className="muted">Asigna recetas para ver el cálculo.</p>}
      {hasPlan && <div className="pa-body">
        <div className="pa-energy"><div className="pa-energy-top"><small>Energía</small><b className={status === 'over' ? 'over' : ''}>{Math.round(daily.kcal)} <em>kcal</em></b>{targetKcal && <span>/ {targetKcal} kcal</span>}</div><div className="pa-bar"><i className={status === 'over' ? 'over' : status === 'low' ? 'low' : ''} style={{ width: `${Math.min(pct || 0, 100)}%` }} /></div></div>
        <div className="pa-macros">{macroRows.map((row) => <div className={'pa-macro' + (row.gramsPct != null && row.gramsPct > 105 ? ' over' : '')} key={row.label}><small>{row.label}</small><b>{row.grams} g</b><span>{row.pctOfKcal != null ? `${row.pctOfKcal}%` : '—'}{row.targetPct != null ? ` · obj. ${row.targetPct}%` : ''}{row.gramsPct != null ? ` · ${row.gramsPct}%` : ''}</span></div>)}</div>
      </div>}
    </section>
  }

  // Imported cookbook recipes have real photos (`imageFile`); handmade ones keep the color block.
  const recipeThumb = (recipe, index, className = 'recipe-image') => {
    if (recipe?.imageFile) return <div className={className + ' has-photo'}><img src={recipesApi.imageUrl(recipe.imageFile)} alt={recipe.name} loading="lazy" /></div>
    return <div className={className + ' ' + RECIPE_COLORS[index % RECIPE_COLORS.length]}><span>✦</span></div>
  }

  const pickerRecipes = pickerTarget
    ? recipes
        .filter((recipe) => (recipe.mealTypes || []).length === 0 || recipe.mealTypes.includes(MEAL_TYPES.find((meal) => meal.key === pickerTarget.mealType)?.recipeType || pickerTarget.mealType))
        .filter((recipe) => !pickerRestriction || (recipe.restrictions || []).includes(pickerRestriction))
        .filter((recipe) => recipe.name.toLowerCase().includes(pickerSearch.toLowerCase()))
    : []
  const availableRestrictions = [...new Set(recipes.flatMap((recipe) => recipe.restrictions || []))].sort()

  // Selector de recetas con buscador, filtro por restricción y detalle (ingredientes + nutrición),
  // al estilo AVENA. Se reutiliza en Distribución y Semana.
  const renderPicker = () => pickerTarget ? <div className="recipe-overlay"><div className="recipe-modal panel">
    <div className="modal-head"><div><p className="eyebrow">RECETAS PARA {MEAL_TYPES.find((m) => m.key === pickerTarget.mealType)?.label.toUpperCase()}{pickerTarget.day ? ` · ${DAYS.find((d) => d.n === pickerTarget.day)?.label}` : ' · TODA LA SEMANA'}</p><h2>{pickerDetail ? pickerDetail.name : 'Elige una preparación'}</h2></div><button onClick={closePicker}>×</button></div>
    {pickerDetail
      ? <div className="recipe-detail">
          <button type="button" className="link-button recipe-detail-back" onClick={() => setPickerDetail(null)}>← Volver al catálogo</button>
          <div className="recipe-detail-nutrition">{NUTRIENT_CHIPS.map(([key, label, unit]) => <div key={key}><small>{label}</small><b>{effectiveNutrition(pickerDetail)[key] != null ? Math.round(Number(effectiveNutrition(pickerDetail)[key]) * 10) / 10 : '—'} <em>{unit}</em></b></div>)}</div>
          <p className="eyebrow">INGREDIENTES</p>
          {pickerNutrition?.state === 'loading' && <p className="muted">Cargando ingredientes…</p>}
          {pickerNutrition?.state === 'error' && <p className="muted">No se pudieron cargar los ingredientes.</p>}
          {pickerNutrition?.state === 'ready' && (pickerNutrition.ingredients?.length
            ? <div className="recipe-detail-ingredients">{pickerNutrition.ingredients.map((item, index) => <div key={index}><span>{item.name}</span><b>{item.quantity} {item.unit}</b></div>)}</div>
            : <p className="muted">Esta receta es del recetario importado (lleva ingredientes en texto libre).</p>)}
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setPickerDetail(null)}>Volver</button><button type="button" className="primary" disabled={planLocked} onClick={() => chooseRecipe(pickerDetail)}>Elegir esta receta</button></div>
        </div>
      : <>
          <div className="picker-filters">
            <div className="recipe-search"><input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Buscar receta..." /></div>
            <select value={pickerRestriction} onChange={(e) => setPickerRestriction(e.target.value)}><option value="">Todas las restricciones</option>{availableRestrictions.map((restriction) => <option value={restriction} key={restriction}>{restriction}</option>)}</select>
          </div>
          <div className="recipe-picker-grid">{pickerRecipes.length === 0 && <p className="muted">No hay recetas para este filtro.</p>}{pickerRecipes.map((recipe, i) => <button className="recipe-pick" onClick={() => setPickerDetail(recipe)} key={recipe.id}>{recipeThumb(recipe, i)}<b>{recipe.name}</b><small>{Math.round(effectiveNutrition(recipe).kcal || 0)} kcal · ver detalle</small></button>)}</div>
        </>}
  </div></div> : null

  const meals = MEAL_TYPES.map((m) => m.label)

  const menuEntryFor = (source, day, meal) => (source || []).find((entry) => entry.dayOfWeek === day && entry.mealType === meal)
  const renderMenuPreview = (sourcePlan) => {
    const menu = sourcePlan.menuSnapshot?.length ? sourcePlan.menuSnapshot : sourcePlan.mealSlots || []
    return <div className="menu-preview-table">
      <div className="menu-preview-head"><span>Tiempo</span>{DAYS.map((day) => <b key={day.n}>{day.label.slice(0, 3)}</b>)}</div>
      {MEAL_TYPES.filter((meal) => menu.some((entry) => entry.mealType === meal.key)).map((meal) => <div className="menu-preview-row" key={meal.key}><span>{meal.label}</span>{DAYS.map((day) => { const entry = menuEntryFor(menu, day.n, meal.key); const name = entry?.recipeName || (entry?.recipeId ? recipeById(entry.recipeId)?.name : null); return <div className="menu-preview-cell" key={day.n}>{name ? <>{name}{entry?.kcal ? <small>{Math.round(entry.kcal)} kcal</small> : null}</> : <small className="muted">—</small>}</div> })}</div>)}
    </div>
  }

  const renderHub = () => {
    const query = hubQuery.trim().toLowerCase()
    const filtered = hubPlans.filter((item) => !query || `${item.patient.firstName} ${item.patient.lastName}`.toLowerCase().includes(query))
    const groups = [
      ['Pendientes', filtered.filter((item) => item.status === 'DRAFT' || item.status === 'READY')],
      ['Realizados', filtered.filter((item) => item.status === 'PUBLISHED' || item.status === 'SUPERSEDED')],
      ['Cancelados', filtered.filter((item) => item.status === 'CANCELLED')],
    ]
    return <AppChrome active="Constructor de plan" setActive={setActive}><div className="content plan-studio">
      <ModuleHeader eyebrow="PLANIFICACIÓN · CONSTRUCTOR" title="Planes alimenticios" subtitle="Todos los planes de tu consulta: retoma un borrador donde lo dejaste o revisa los anteriores." action={<button className="primary" onClick={() => setChooserOpen(true)}><span>+</span> Nuevo plan</button>} />
      <div className="hub-toolbar panel"><div className="search-field">⌕ <input value={hubQuery} onChange={(event) => setHubQuery(event.target.value)} placeholder="Buscar por paciente..." /></div></div>
      {/* En escritorio el contenido no scrollea como página: sólo este cuerpo lo hace (ver el layout
          de altura completa en globals.css). Sin él, los grupos de planes se recortaban abajo. */}
      <div className="module-body plans-scroll">
      {hubState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando planes…</h3></div>}
      {hubState === 'error' && <div className="form-error">⚠ No se pudieron cargar los planes.</div>}
      {hubState === 'ready' && filtered.length === 0 && <div className="result-empty panel"><span>◌</span><h3>{query ? 'Sin planes de ese paciente' : 'Todavía no hay planes'}</h3><p>Crea el primero con "+ Nuevo plan".</p></div>}
      {hubState === 'ready' && groups.map(([title, items]) => items.length > 0 && <section className="plans-group" key={title}>
        <p className="eyebrow">{title.toUpperCase()} · {items.length}</p>
        <div className="plan-cards">{items.map((item) => { const { progress, nextStep } = planProgress(item); const editable = item.status === 'DRAFT' || item.status === 'READY'; return <article className={'plan-card-item' + (editable ? ' editable' : '')} key={item.id}>
          <div className="plan-card-info"><b>{item.patient.firstName} {item.patient.lastName}</b><small>{PLAN_STATUS_LABEL[item.status] || item.status} · v{item.version} · {editable ? `${nextStep} pendiente · ` : ''}actualizado {planUpdatedLabel(item.updatedAt || item.createdAt)}</small></div>
          <div className="plan-card-progress"><div className="pp-bar"><i style={{ width: `${progress}%` }} /></div><b>{progress}%</b></div>
          <div className="plan-card-actions">
            <button className="secondary" disabled={planActionState === item.id} onClick={() => openPlanFromHub(item)}>{editable ? 'Continuar' : 'Ver menú'}</button>
            {editable && <button className="link-button" disabled={planActionState === item.id} onClick={() => changePlanStatus(item, 'cancel')}>Cancelar</button>}
            {item.status === 'CANCELLED' && <button className="link-button" disabled={planActionState === item.id} onClick={() => changePlanStatus(item, 'reactivate')}>Reactivar</button>}
          </div>
        </article> })}</div>
      </section>)}
      </div>
      {chooserOpen && <div className="modal-backdrop" onClick={() => setChooserOpen(false)}><div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><p className="eyebrow">NUEVO PLAN</p><h2>¿Para quién es el plan?</h2><span className="modal-subtitle">Se crea un borrador y se guarda solo.</span></div><button onClick={() => setChooserOpen(false)}>×</button></div>
        <div className="patient-chooser">{patients.map((p) => <button type="button" className="chooser-item" key={p.id} onClick={() => startNewPlanFor(p.id)}><span className="person-avatar coral">{`${p.firstName[0] || ''}${p.lastName[0] || ''}`}</span><b>{p.firstName} {p.lastName}</b></button>)}
          {patients.length === 0 && <p className="muted">No hay pacientes activos.</p>}
        </div>
      </div></div>}
    </div>{renderPreviewModal()}</AppChrome>
  }

  const renderPreviewModal = () => previewPlan ? <div className="modal-backdrop" onClick={() => setPreviewPlan(null)}><div className="modal menu-preview-modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">{PLAN_STATUS_LABEL[previewPlan.status] || previewPlan.status} · v{previewPlan.version}</p><h2>Menú de {previewPlan.patient ? `${previewPlan.patient.firstName} ${previewPlan.patient.lastName}` : patientName}</h2><span className="modal-subtitle">{previewPlan.targetKcal ? `${previewPlan.targetKcal} kcal/día` : 'Sin cálculo guardado'}</span></div><button onClick={() => setPreviewPlan(null)}>×</button></div>
    {renderMenuPreview(previewPlan)}
    <div className="modal-actions"><button type="button" className="secondary" onClick={() => setPreviewPlan(null)}>Cerrar</button></div>
  </div></div> : null

  const showCustomAdjust = customAdjust || !ENERGY_ADJUST_PRESETS.includes(String(form.energyAdjustKcal))

  if (mode === 'hub') return renderHub()

  const renderPlansOverview = () => {
    const groups = [
      ['Pendientes', plans.filter((item) => item.status === 'DRAFT' || item.status === 'READY')],
      ['Realizados', plans.filter((item) => item.status === 'PUBLISHED' || item.status === 'SUPERSEDED')],
      ['Cancelados', plans.filter((item) => item.status === 'CANCELLED')],
    ]
    return <div className="plans-overview">
      <div className="plans-overview-head"><div><p className="eyebrow">PLANIFICACIÓN · PLANES</p><h1>Planes de {patientName}</h1><p className="subtitle">Retoma un borrador donde lo dejaste o revisa los planes anteriores.</p></div><button className="primary" onClick={() => createPlan()} disabled={createPlanState === 'creating'}><span>+</span> {createPlanState === 'creating' ? 'Creando…' : 'Nuevo plan'}</button></div>
      {plans.length === 0 && <div className="result-empty panel"><span>◌</span><h3>Sin planes todavía</h3><p>Crea el primer plan de {patientName}.</p></div>}
      {groups.map(([title, items]) => items.length > 0 && <section className="plans-group" key={title}>
        <p className="eyebrow">{title.toUpperCase()} · {items.length}</p>
        <div className="plan-cards">{items.map((item) => { const { progress, nextStep } = planProgress(item); const editable = item.status === 'DRAFT' || item.status === 'READY'; return <article className={'plan-card-item' + (editable ? ' editable' : '')} key={item.id}>
          <div className="plan-card-info"><b>{PLAN_STATUS_LABEL[item.status] || item.status} · v{item.version}</b><small>{editable ? `${nextStep} pendiente · ` : ''}actualizado {planUpdatedLabel(item.updatedAt || item.createdAt)}</small></div>
          <div className="plan-card-progress"><div className="pp-bar"><i style={{ width: `${progress}%` }} /></div><b>{progress}%</b></div>
          <div className="plan-card-actions">
            <button className="secondary" disabled={planActionState === item.id} onClick={() => openPlan(item)}>{editable ? 'Continuar' : 'Ver menú'}</button>
            {editable && <button className="link-button" disabled={planActionState === item.id} onClick={() => changePlanStatus(item, 'cancel')}>Cancelar</button>}
            {item.status === 'CANCELLED' && <button className="link-button" disabled={planActionState === item.id} onClick={() => changePlanStatus(item, 'reactivate')}>Reactivar</button>}
          </div>
        </article> })}</div>
      </section>)}
    </div>
  }

  if (!activePatientId) return <AppChrome active="Constructor de plan" setActive={setActive}><div className="content plan-studio">
    <ModuleHeader eyebrow="PLANIFICACIÓN · CONSTRUCTOR" title="Constructor de plan" subtitle="Elige un paciente para armar y guardar su plan de alimentación." />
    <div className="result-empty panel"><span>◌</span><h3>Elige un paciente</h3><p>Selecciona a quién le vas a diseñar el plan para comenzar.</p><select value="" onChange={(e) => onSelectPatient?.(e.target.value)}><option value="">Selecciona…</option>{patients.map((p) => <option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select></div>
  </div></AppChrome>

  return <AppChrome active="Constructor de plan" setActive={setActive}><div className="content plan-studio"><div className="patient-context"><button className="back-button" onClick={() => setActive('Pacientes')}>← Pacientes</button><button className="back-button" onClick={() => { setMode('hub'); loadHub() }}>← Todos los planes</button><div className="clinical-person"><span className="person-avatar coral">{patientInitials}</span><div><h2>{patientName}</h2><span>{view === 'list' ? `${plans.length} plan(es) · el borrador se guarda solo` : 'Borrador · Se guarda automáticamente'}</span></div></div><label className="patient-switch">Paciente<select value={activePatientId || ''} onChange={(e) => { const nextId = e.target.value; if (!nextId) return; setActivePatientId(nextId); setMode('patient'); onSelectPatient?.(nextId) }}>{patients.map((p) => <option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select></label></div>{view === 'list' ? renderPlansOverview() : <><div className="plan-steps">{steps.map((x, i) => <button className={step === i ? 'active' : ''} onClick={() => selectStep(i)} key={x}><span>{i + 1}</span>{x}</button>)}</div>

    <div className="plan-body">

    {planLocked && <div className="eq-notice plan-locked-notice"><b>Este plan ya está publicado: es de sólo lectura.</b> El menú quedó congelado; para cambiarlo crea un plan nuevo. <button type="button" className="link-button" onClick={() => selectStep(STEP.DELIVERY)}>Ir a Entrega</button><button type="button" className="link-button" onClick={() => setView('list')}>Ver los planes de la paciente</button></div>}

    {plan?.consultation && (() => {
      const ex = readExpediente(plan)
      const hasData = ex.reason || ex.diagnoses.length || ex.conditions.length || ex.allergies.length || ex.avoid.length || ex.prefers || ex.outOfRange.length
      if (!hasData) return null
      return <div className="form-card plan-context-card">
        <div className="plan-context-head"><div><p className="eyebrow">RESUMEN DEL EXPEDIENTE</p><b>Datos que alimentan este plan</b></div><button type="button" className="secondary" disabled={planLocked} onClick={() => { const goal = buildExpedienteGoal(plan); if (goal) updateForm('goal', goal); updateNotes('recommendations', buildExpedienteRecommendations(plan)) }}>Aplicar al objetivo y recomendaciones</button></div>
        {ex.reason && <p className="plan-context-reason"><b>Motivo:</b> {ex.reason}</p>}
        {ex.diagnoses.length > 0 && <div className="plan-context-diagnoses">{ex.diagnoses.map((diagnosis) => <span key={diagnosis.id}><b>{diagnosis.domain}</b> {diagnosis.problem}</span>)}</div>}
        <div className="plan-context-grid">
          {ex.conditions.length > 0 && <div><small>Padecimientos</small><p>{ex.conditions.join(' · ')}</p></div>}
          {ex.allergies.length > 0 && <div><small>Alergias / intolerancias</small><p>{ex.allergies.join(' · ')}</p></div>}
          {ex.avoid.length > 0 && <div><small>Alimentos a evitar</small><p>{ex.avoid.join(' · ')}</p></div>}
          {ex.prefers && <div><small>Preferencias</small><p>{ex.prefers}</p></div>}
          {ex.outOfRange.length > 0 && <div><small>Laboratorio a vigilar</small><p>{ex.outOfRange.map((lab) => `${lab.name} ${lab.value ?? ''} ${lab.unit || ''} (${String(lab.status).toLowerCase()})`).join(' · ')}</p></div>}
        </div>
      </div>
    })()}

    {step === STEP.EVALUATION && <><ModuleHeader eyebrow="EVALUACIÓN NUTRICIONAL" title="Datos y objetivos" subtitle="Resumen del expediente y del último cálculo guardado en el paso Plan alimentario." action={<button className="secondary" onClick={() => selectStep(1)}>Ir al cálculo →</button>} /><div className="plan-grid"><div className="plan-card panel"><h3>Datos antropométricos</h3><div className="form-grid three"><label>Sexo<input value={sexLabel(patient?.sex) || '—'} readOnly /></label><label>Fecha nacimiento<input value={formatUTCDate(patient?.birthDate) || '—'} readOnly /></label><label>Edad<input value={computeAge(patient?.birthDate) ? `${computeAge(patient.birthDate)} años` : '—'} readOnly /></label><label>Peso actual<input value={plan?.evaluation?.inputs?.weightKg ? `${plan.evaluation.inputs.weightKg} kg` : '—'} readOnly /></label><label>Talla<input value={plan?.evaluation?.inputs?.heightCm ? `${plan.evaluation.inputs.heightCm} cm` : '—'} readOnly /></label><label>IMC calculado<input value={plan?.evaluation?.bmi ?? '—'} readOnly /></label></div></div><div className="plan-card panel ideal-card"><h3>Rangos de peso ideal <span>ⓘ</span></h3>{plan?.evaluation?.idealWeightRange ? <div className="ideal-number">{plan.evaluation.idealWeightRange.minKg} <small>– {plan.evaluation.idealWeightRange.maxKg} kg</small></div> : <p className="muted">Calcula el requerimiento en el paso "Plan alimentario" para ver el rango.</p>}<p className="muted">Rango estimado para su estatura</p></div><div className="plan-card panel full"><h3>Objetivo terapéutico</h3>{plan?.goal ? <p>{plan.goal}</p> : <p className="muted">Sin definir todavía — se guarda junto con el cálculo en el paso "Plan alimentario".</p>}</div></div></>}

    {step === STEP.CALCULATION && <><ModuleHeader eyebrow="PLAN ALIMENTARIO · REQUERIMIENTO" title="Calcula el punto de partida" subtitle="Cada resultado queda asociado a la fórmula y a los datos utilizados." /><form className="calculator-layout" onSubmit={calculate}><section className="panel calculator-form"><div className="section-heading"><div><h2>Datos de la paciente</h2><p className="subtitle">Puedes ajustar estos valores para simular el plan.</p></div></div><div className="form-grid three"><label>Sexo<select value={form.sex} onChange={(e) => updateForm('sex', e.target.value)}><option value="male">Hombre</option><option value="female">Mujer</option></select></label><label>Edad (años)<input type="number" min="1" max="120" value={form.age} onChange={(e) => updateForm('age', e.target.value)} /></label><label>Peso (kg)<input type="number" step="0.1" min="1" value={form.weightKg} onChange={(e) => updateForm('weightKg', e.target.value)} /></label><label>Talla (cm)<input type="number" step="0.1" min="30" value={form.heightCm} onChange={(e) => updateForm('heightCm', e.target.value)} /></label><label>Fórmula energética<select value={form.formula} onChange={(e) => updateForm('formula', e.target.value)}><option value="mifflin">Mifflin-St Jeor</option><option value="harris">Harris-Benedict</option><option value="schofield">FAO/OMS/ONU (Schofield)</option><option value="valencia">Valencia (población mexicana)</option><option value="cunningham">Cunningham</option><option value="katch-mcardle">Katch-McArdle</option></select></label>{needsBodyFat && <label>% Grasa corporal<input type="number" step="0.1" min="1" max="75" value={form.bodyFatPercent} onChange={(e) => updateForm('bodyFatPercent', e.target.value)} /></label>}<label>Actividad física<select value={form.activityMethod === 'mets' ? 'mets' : form.activityFactor} onChange={(e) => { if (e.target.value === 'mets') updateForm('activityMethod', 'mets'); else { setForm((prev) => ({ ...prev, activityMethod: 'factor' })); updateForm('activityFactor', e.target.value) } }}><option value="1.2">Sedentaria · 1.2</option><option value="1.375">Ligera · 1.375</option><option value="1.55">Moderada · 1.55</option><option value="1.725">Intensa · 1.725</option><option value="mets">Por ejercicio (METs)…</option></select></label>{form.activityMethod === 'mets' && <><label>Ejercicio<select value={MET_PRESETS.some(([value]) => value === String(form.metsValue)) ? String(form.metsValue) : ''} onChange={(e) => updateForm('metsValue', e.target.value)}><option value="">Otro (escribe los METs)</option>{MET_PRESETS.map(([value, label]) => <option value={value} key={label}>{label} · {value} METs</option>)}</select></label><label>METs<input type="number" min="1" max="23" step="0.1" value={form.metsValue} onChange={(e) => updateForm('metsValue', e.target.value)} /></label><label>Minutos por sesión<input type="number" min="1" max="600" value={form.metsMinutes} onChange={(e) => updateForm('metsMinutes', e.target.value)} /></label><label>Sesiones por semana<input type="number" min="1" max="21" value={form.metsSessions} onChange={(e) => updateForm('metsSessions', e.target.value)} /></label></>}<label>Ajuste por objetivo<select value={showCustomAdjust ? 'custom' : String(form.energyAdjustKcal)} onChange={(e) => { if (e.target.value === 'custom') { setCustomAdjust(true); return } setCustomAdjust(false); updateForm('energyAdjustKcal', e.target.value) }}>{ENERGY_ADJUST_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}<option value="custom">Otro valor…</option></select></label>{showCustomAdjust && <label>Ajuste (kcal/día)<input type="number" step="50" min="-1500" max="1500" placeholder="0" value={form.energyAdjustKcal} onChange={(e) => updateForm('energyAdjustKcal', e.target.value)} /></label>}</div><div className="macro-distribution"><div className="section-heading"><div><h2>Distribución de macronutrientes</h2><p className="subtitle">Porcentaje del requerimiento energético. La suma debe dar 100%.</p></div></div><div className="form-grid three"><label>Carbohidratos (%)<input type="number" min="0" max="100" value={form.carbsPercent} onChange={(e) => updateForm('carbsPercent', e.target.value)} /></label><label>Proteína (%)<input type="number" min="0" max="100" value={form.proteinPercent} onChange={(e) => updateForm('proteinPercent', e.target.value)} /></label><label>Grasas (%)<input type="number" min="0" max="100" value={form.fatPercent} onChange={(e) => updateForm('fatPercent', e.target.value)} /></label></div><div className={'macro-sum' + (macroSum === 100 ? '' : ' invalid')}>{macroSum}% {macroSum === 100 ? '· distribución correcta' : '· debe sumar 100%'}</div>{calcResult?.get && macroSum === 100 && <div className="macro-grams">Carbohidratos {macroGrams(form.carbsPercent, 4)} g · Proteína {macroGrams(form.proteinPercent, 4)} g · Grasas {macroGrams(form.fatPercent, 9)} g</div>}</div><label>Objetivo terapéutico<textarea className="wide-textarea" placeholder="Resultado clínico y conductual esperado..." value={form.goal} onChange={(e) => updateForm('goal', e.target.value)} /></label><button className="primary calculate-button" disabled={calcState === 'loading'}>{calcState === 'loading' ? 'Calculando...' : 'Calcular requerimiento'} <span>→</span></button>{calcState === 'error' && <div className="form-error">⚠ {calcError}</div>}</section><aside className="panel calculation-result">{!calcResult && calcState !== 'loading' ? <div className="result-empty"><span>◌</span><h3>Tu resultado aparecerá aquí</h3><p>Completa o confirma los datos y calcula el requerimiento energético.</p></div> : calcState === 'loading' ? <div className="result-empty"><span className="loading-dot">●</span><h3>Calculando requerimiento...</h3><p>Estamos aplicando la fórmula seleccionada.</p></div> : <><div className="result-header"><div><p className="eyebrow">RESULTADO CALCULADO</p><h2>Requerimiento energético</h2></div><span className="result-check">✓</span></div><div className="get-number"><small>{calcResult.energyAdjustKcal ? 'Requerimiento del plan' : 'GET · Gasto energético total'}</small><b>{calcTarget.toLocaleString()} <em>kcal/día</em></b><span>{calcResult.energyAdjustKcal ? `GET ${calcResult.get.toLocaleString()} kcal ${calcResult.energyAdjustKcal > 0 ? '+' : '−'} ${Math.abs(calcResult.energyAdjustKcal)} kcal por objetivo · ` : ''}Basado en {calcResult.formulaLabel || calcResult.formula} · {calcResult.activityMethod === 'mets' ? 'metabolismo basal + ejercicio por METs' : `factor ${form.activityFactor}`}</span></div><div className="result-details"><div><small>Metabolismo basal</small><b>{calcResult.bmr.toLocaleString()} kcal</b></div><div><small>Actividad estimada</small><b>+{calcResult.activityKcal.toLocaleString()} kcal</b></div></div>{calcResult.bmi && <div className="result-details"><div><small>IMC</small><b>{calcResult.bmi}</b></div><div><small>Peso saludable estimado</small><b>{calcResult.idealWeightRange.minKg}–{calcResult.idealWeightRange.maxKg} kg</b></div></div>}{calcResult.flags?.length > 0 && <div className="form-error">⚠ {calcResult.flags.map((f) => f.message).join(' ')}</div>}{calcStale && <div className="form-error">⚠ Cambiaste los datos después de calcular: este resultado ya no corresponde. Vuelve a calcular antes de guardar.</div>}<button type="button" className="primary full-button" disabled={evalSaveState === 'saving' || !plan || planLocked || calcStale || macroSum !== 100} onClick={saveToPlan}>{evalSaveState === 'saving' ? 'Guardando...' : evalSaveState === 'saved' ? 'Guardado en el plan ✓' : 'Guardar en el plan'} <span>→</span></button>{!plan && <p className="muted">Crea una consulta y un plan en borrador para poder guardar.</p>}{evalSaveState === 'error' && <div className="form-error">⚠ {evalSaveError}</div>}</>}</aside></form></>}

    {step === STEP.EQUIVALENTS && <>
      {plan && <div className="menu-tabs panel">
        <div className="menu-tabs-row">
          <p className="eyebrow">MENÚS DEL PLAN</p>
          <button type="button" className={!activeMenu ? 'selected' : ''} onClick={() => setMenuTab('base')}>Menú base</button>
          {extraMenus.map((menu) => <button type="button" key={menu.id} className={activeMenu?.id === menu.id ? 'selected' : ''} onClick={() => setMenuTab(menu.id)}>{menu.name}</button>)}
          {!planLocked && extraMenus.length < 4 && <button type="button" className="menu-add" onClick={addMenu}>+ Agregar menú</button>}
        </div>
        {!activeMenu && <small className="muted">{extraMenus.length ? `El menú base aplica ${baseMenuDays.length ? `en ${baseMenuDays.map((day) => day.label.toLowerCase()).join(', ')}` : 'en ningún día: todos están asignados a otro menú'}.` : 'Un plan puede llevar más de un menú (por ejemplo, días de entrenamiento con más energía): cada uno con sus días y su propio cuadro de equivalentes.'}</small>}
        {activeMenu && <div className="menu-settings">
          <label>Nombre<input value={activeMenu.name} disabled={planLocked} maxLength={40} onChange={(event) => updateMenu(activeMenu.id, { name: event.target.value })} /></label>
          <div className="menu-days"><small>Días que usan este menú</small><div>{DAYS.map((day) => <label key={day.n} className={(activeMenu.days || []).includes(day.n) ? 'on' : ''}><input type="checkbox" disabled={planLocked} checked={(activeMenu.days || []).includes(day.n)} onChange={() => toggleMenuDay(activeMenu, day.n)} />{day.label.slice(0, 3)}</label>)}</div></div>
          <label>Ajuste de energía (kcal)<input type="number" step="50" min="-1500" max="1500" disabled={planLocked} value={activeMenu.kcalDelta ?? 0} onChange={(event) => updateMenu(activeMenu.id, { kcalDelta: Number(event.target.value) || 0 })} /></label>
          <span className="muted menu-target">{plan.targetKcal != null ? `Requerimiento de este menú: ${plan.targetKcal + (Number(activeMenu.kcalDelta) || 0)} kcal (el del plan: ${plan.targetKcal})` : 'Calcula el requerimiento del plan para ver el de este menú.'}</span>
          {!planLocked && <button type="button" className="link-button" onClick={() => removeMenu(activeMenu)}>Quitar este menú</button>}
        </div>}
      </div>}
      <EquivalentsStep key={activeMenu?.id || 'base'} plan={activeMenu && plan?.targetKcal != null ? { ...plan, targetKcal: plan.targetKcal + (Number(activeMenu.kcalDelta) || 0) } : plan} value={activeMenu ? activeMenu.equivalents : notesForm.equivalents} onChange={(next) => (activeMenu ? updateMenu(activeMenu.id, { equivalents: next }) : updateNotes('equivalents', next))} locked={planLocked} mealTimes={notesForm.mealTimes} expediente={plan?.consultation ? readExpediente(plan) : null} activeMeals={equivalentMeals} visibleMeals={visibleMealKeys} mealLabels={notesForm.mealLabels} onGoToCalculation={() => selectStep(STEP.CALCULATION)} />
    </>}

    {step === STEP.DISTRIBUTION && <>
      <ModuleHeader eyebrow="PLAN ALIMENTARIO · DISTRIBUCIÓN" title="Distribuye por tiempos" subtitle="Elige la receta base de cada tiempo de comida para toda la semana; luego ajusta día por día en el paso Semana." action={syncLabel} />
      {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando plan y recetas…</h3></div>}
      {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar el plan o el catálogo de recetas.</div>}
      {loadState === 'ready' && !plan && <div className="result-empty panel"><span>◌</span><h3>No hay un plan en borrador</h3><p>Crea un plan para {patientName} antes de distribuir recetas.</p><button className="primary" disabled={createPlanState === 'creating'} onClick={() => createPlan()}>{createPlanState === 'creating' ? 'Creando…' : 'Crear plan'}</button>{createPlanState === 'error' && <div className="form-error">⚠ No se pudo crear el plan.</div>}</div>}
      {loadState === 'ready' && plan && renderAdequacy()}
      {loadState === 'ready' && plan && <div className="distribution">
        <div className="meal-bar panel">
          <div className="meal-bar-info"><p className="eyebrow">TIEMPOS DE COMIDA · {visibleMeals.length}</p><small className="muted">{notesForm.activeMeals?.length ? 'Los tiempos de este plan. Agrega otro si la paciente come más veces al día.' : mealSuggestion.fromConsultation ? 'Propuestos con lo que la paciente contó en la consulta (dieta habitual y recordatorio de 24 h).' : 'Los tiempos habituales. Agrega otro si la paciente come más veces al día.'}</small></div>
          <div className="meal-chips">{visibleMeals.map((meal) => <span className="meal-chip" key={meal.key}>{planLocked ? meal.label : <button type="button" className="meal-chip-name" onClick={() => renameMeal(meal)} title="Cambiar el nombre de este tiempo de comida">{meal.label} ✎</button>}{notesForm.mealTimes?.[meal.key] ? <small>{formatMealTime(notesForm.mealTimes[meal.key])}</small> : null}{!planLocked && visibleMeals.length > 1 && <button type="button" onClick={() => removeMeal(meal)} aria-label={`Quitar ${meal.label}`} title={`Quitar ${meal.label}`}>×</button>}</span>)}</div>
          {!planLocked && <div className="meal-bar-actions">
            {hiddenMeals.length > 0 && <select value="" onChange={(event) => addMeal(event.target.value)} aria-label="Agregar tiempo de comida"><option value="">+ Agregar tiempo de comida</option>{hiddenMeals.map((meal) => <option value={meal.key} key={meal.key}>{meal.label} · {formatMealTime(mealSuggestion.times[meal.key])}</option>)}</select>}
            {missingTimes.length > 0 && <button type="button" className="secondary" onClick={applySuggestedTimes}>Usar horas sugeridas</button>}
          </div>}
        </div>
        <div className="distribution-meals">{visibleMeals.map((meal, mealIndex) => { const base = recipeById(slots[slotKey(1, meal.key)]); const kcal = averageKcalForMeal(meal.key); return <section className="distribution-meal panel" key={meal.key}>
          <div className="distribution-meal-head">
            {recipeThumb(base, mealIndex, 'distribution-meal-image')}
            <div className="distribution-meal-info"><span className="distribution-meal-label">{meal.label} · base de la semana</span><b>{base ? base.name : 'Sin receta base'}</b><small>{kcal != null ? `${kcal} kcal promedio al día` : 'Sin recetas asignadas'}</small></div>
            <label className="meal-time-field"><small>Hora</small><input type="time" disabled={planLocked} value={notesForm.mealTimes?.[meal.key] || ''} onChange={(event) => updateNotes('mealTimes', { ...notesForm.mealTimes, [meal.key]: event.target.value })} aria-label={`Hora de ${meal.label}`} />{!planLocked && !notesForm.mealTimes?.[meal.key] && <button type="button" className="time-suggestion" onClick={() => updateNotes('mealTimes', { ...notesForm.mealTimes, [meal.key]: mealSuggestion.times[meal.key] })} title={mealSuggestion.stated.includes(meal.key) ? 'Hora que mencionó la paciente en la consulta' : 'Hora habitual sugerida'}>{mealSuggestion.stated.includes(meal.key) ? 'Consulta' : 'Sugerida'}: {formatMealTime(mealSuggestion.times[meal.key])}</button>}</label>
            <div className="portion-stepper"><small>Porciones</small><div><button type="button" disabled={planLocked} onClick={() => changeServings(meal.key, -0.5)} aria-label={`Menos porciones de ${meal.label}`}>−</button><b>{mealServingsFor(meal.key)}</b><button type="button" disabled={planLocked} onClick={() => changeServings(meal.key, 0.5)} aria-label={`Más porciones de ${meal.label}`}>+</button></div></div>
            <button type="button" className="secondary" disabled={planLocked} onClick={() => openPicker(meal.key)}>{base ? 'Cambiar' : 'Elegir receta'}</button>
            <button type="button" className="secondary suggest-button" disabled={planLocked} onClick={() => setSuggestMeal(meal)} title="Propone recetas que se acercan a lo calculado para este tiempo de comida">✦ Sugerir recetas</button>
          </div>
          {mealRecipes(meal.key).length > 0 && <div className="distribution-meal-adjust"><button type="button" className="link-button" onClick={() => setAdjustMeal(meal)}>Ajustar porciones de {mealRecipes(meal.key).length === 1 ? 'la receta' : `las ${mealRecipes(meal.key).length} recetas`}</button>{adjustedCount(meal.key) > 0 && <span className="eq-chip ok">{adjustedCount(meal.key)} ajustada{adjustedCount(meal.key) === 1 ? '' : 's'}</span>}<small className="muted">Sólo para este plan; la receta original no cambia.</small></div>}
          <div className="distribution-meal-days">{DAYS.map((day) => { const recipe = recipeById(slots[slotKey(day.n, meal.key)]); return <button type="button" className={'distribution-day' + (recipe ? '' : ' empty')} key={day.n} disabled={planLocked} onClick={() => openPicker(meal.key, day.n)} title={recipe ? `${recipe.name} · ${day.label}` : `Elegir ${meal.label} del ${day.label}`}>
            <small>{day.label.slice(0, 3)}</small>
            {recipe ? <>{recipeThumb(recipe, day.n, 'distribution-day-thumb')}<span>{recipe.name}</span></> : <span className="muted">+</span>}
          </button> })}</div>
        </section> })}</div>
        <p className="distribution-note muted">El catálogo de ingredientes ya incluye el Sistema Mexicano de Equivalentes; la asignación de la semana se hace por receta. Toca un día para variarlo.</p>
      </div>}
      {adjustMeal && <RecipeAdjustModal meal={adjustMeal} recipes={mealRecipes(adjustMeal.key)} servings={mealServingsFor(adjustMeal.key)} adjustments={notesForm.recipeAdjustments} prescribed={notesForm.equivalents?.distribution?.[adjustMeal.key]} locked={planLocked} onSave={(recipeId, adjustment) => saveAdjustment(adjustMeal.key, recipeId, adjustment)} onClose={() => setAdjustMeal(null)} />}
      {suggestMeal && <RecipeSuggestModal meal={suggestMeal} recipes={recipes} target={suggestTarget} servings={mealServingsFor(suggestMeal.key)} initialAvoid={suggestAvoid} exclude={suggestExclude} renderThumb={(recipe, index) => recipeThumb(recipe, index, 'distribution-day-thumb suggest-thumb')} locked={planLocked} onApply={(picks) => applySuggestions(suggestMeal, picks)} onClose={() => setSuggestMeal(null)} onGoToCalculation={() => { setSuggestMeal(null); selectStep(STEP.CALCULATION) }} />}
      {renderPicker()}
    </>}

    {step === STEP.WEEK && <>
      <ModuleHeader eyebrow="DISTRIBUCIÓN SEMANAL" title="Así se verá tu plan" subtitle="Haz clic en cualquier celda para asignar o cambiar la receta de ese día." action={syncLabel} />
      {loadState === 'ready' && plan && renderAdequacy()}
      {loadState === 'ready' && plan && <div className="week-plan panel">
        <div className="week-head"><span>Tiempo</span>{DAYS.map((d) => <b key={d.n}>{d.label}</b>)}</div>
        {visibleMeals.map((meal) => <div className="week-row" key={meal.key}><span>{meal.label}</span>{DAYS.map((day) => { const recipe = recipeById(slots[slotKey(day.n, meal.key)]); return <div className="week-meal" key={day.n} onClick={() => openPicker(meal.key, day.n)} style={{ cursor: planLocked ? 'default' : 'pointer' }}>{recipe ? <>{recipeThumb(recipe, day.n, 'week-image')}<small>{recipe.name}</small></> : <small className="muted">{planLocked ? '—' : '+ Elegir'}</small>}{recipe && !planLocked && <button type="button" className="link-button" onClick={(e) => { e.stopPropagation(); clearSlot(meal.key, day.n) }}>Quitar</button>}</div> })}</div>)}
      </div>}
      {loadState === 'ready' && !plan && <div className="result-empty panel"><span>◌</span><h3>No hay un plan en borrador</h3><p>Crea un plan para {patientName} antes de armar la semana.</p><button className="primary" disabled={createPlanState === 'creating'} onClick={() => createPlan()}>{createPlanState === 'creating' ? 'Creando…' : 'Crear plan'}</button>{createPlanState === 'error' && <div className="form-error">⚠ No se pudo crear el plan.</div>}</div>}
      {loadState === 'ready' && plan && <div className="panel adequacy-panel">
        <h3>% Adecuación de micronutrientes</h3>
        {adequacyState === 'loading' && <p className="muted">Calculando…</p>}
        {adequacyState === 'error' && <div className="form-error">⚠ No se pudo calcular la adecuación de micronutrientes.</div>}
        {adequacyState === 'ready' && !adequacy?.bracket && <p className="muted">Calcula y guarda el requerimiento en el paso "Plan alimentario" para poder calcular la adecuación. <button type="button" className="link-button" onClick={() => selectStep(1)}>Ir al cálculo →</button></p>}
        {adequacyState === 'ready' && adequacy?.bracket && !adequacy.nutrients.length && <p className="muted">Asigna al menos una receta a la semana para calcular la adecuación.</p>}
        {adequacyState === 'ready' && adequacy?.nutrients.length > 0 && <>
          <p className="muted">Referencia: {adequacy.bracketLabel}. Promedio diario de los días con al menos una receta asignada.</p>
          <div className="adequacy-rows">{adequacy.nutrients.map((n) => n.noData
            ? <div className="adequacy-row no-data" key={n.key}>
                <span>{n.label}</span>
                <div className="adequacy-bar" />
                <b className="muted">—</b>
                <small className="muted">Sin dato</small>
              </div>
            : <div className="adequacy-row" key={n.key}>
                <span>{n.label}</span>
                <div className="adequacy-bar"><i style={{ width: `${Math.min(n.percent, 100)}%` }} className={n.percent < 70 ? 'low' : n.percent > 110 ? 'high' : ''} /></div>
                <b>{n.percent}%</b>
                <small>{n.value} / {n.target} {n.unit}</small>
              </div>)}</div>
          {adequacy.nutrients.some((n) => n.noData) && <p className="muted adequacy-note">"Sin dato": el catálogo de alimentos no trae valores de {adequacy.nutrients.filter((n) => n.noData).map((n) => n.label).join(', ')}. Es información que falta en el catálogo, no un consumo de cero.</p>}
        </>}
      </div>}
      <div className="recommendations panel"><h3>Indicaciones para {patientName}</h3><span className="saved">{planLocked ? '● Sólo lectura' : notesSaveState === 'saving' ? '● Guardando…' : notesSaveState === 'editing' ? '● Editando…' : notesSaveState === 'error' ? '⚠ Error al guardar' : '● Guardado'}</span><button type="button" className="secondary" disabled={!plan || planLocked} onClick={() => updateNotes('recommendations', buildExpedienteRecommendations(plan))}>Tomar del expediente</button><div className="form-grid"><label>Consumo de agua<textarea placeholder="Ej. 8 vasos (2 L) al día" value={notesForm.hydrationNote} onChange={(e) => updateNotes('hydrationNote', e.target.value)} disabled={!plan || planLocked} />{planWeightKg && !planLocked && <span className="water-helper"><input type="number" min="10" max="80" step="1" value={waterMlPerKg} onChange={(e) => setWaterMlPerKg(e.target.value)} aria-label="Mililitros de agua por kilogramo" /> ml/kg × {planWeightKg} kg{waterLiters ? ` = ${waterLiters.toFixed(1)} L (${Math.round(waterLiters * 4)} vasos)` : ''} <button type="button" className="link-button" disabled={!waterLiters} onClick={applyWater}>Usar</button></span>}</label><label>Recomendaciones generales<textarea placeholder="Añade recomendaciones, educación o suplementos..." value={notesForm.recommendations} onChange={(e) => updateNotes('recommendations', e.target.value)} disabled={!plan || planLocked} /></label></div><div className="meal-notes"><p className="eyebrow">INDICACIONES POR TIEMPO DE COMIDA</p><div className="form-grid">{visibleMeals.map((meal) => <label key={meal.key}>{meal.label}<textarea placeholder={`Indicación para ${meal.label.toLowerCase()} (opcional)`} value={notesForm.mealNotes?.[meal.key] || ''} onChange={(e) => updateNotes('mealNotes', { ...(notesForm.mealNotes || {}), [meal.key]: e.target.value })} disabled={!plan || planLocked} /></label>)}</div></div>{!plan && <p className="muted">Crea el plan (paso "Distribución") para poder guardar estas indicaciones.</p>}</div>
      {renderPicker()}
    </>}

    {step === STEP.DELIVERY && <DocumentPage setActive={setActive} patientId={activePatientId} planId={plan?.id || null} embedded onPublished={handlePublished} />}

    </div>

    <div className="wizard-footer"><button className="secondary" onClick={() => selectStep(Math.max(0, step - 1))}>← Anterior</button><span>{combinedSave === 'saving' ? 'Guardando…' : combinedSave === 'error' ? <>Error al guardar los últimos cambios · <button type="button" className="link-button" onClick={retrySave}>Reintentar</button></> : combinedSave === 'locked' ? 'Plan publicado · sólo lectura' : 'Guardado automáticamente'}</span><button className="primary" onClick={() => step === STEP.DELIVERY ? setActive('Documentos') : selectStep(Math.min(step + 1, STEP.DELIVERY))}>Siguiente <span>→</span></button></div>
  </>}
  </div>
  {renderPreviewModal()}
  </AppChrome>
}
