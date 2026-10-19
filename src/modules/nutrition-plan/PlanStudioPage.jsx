import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import DocumentPage from '../documents/DocumentPage.jsx'
import DistributeMatrix from './DistributeMatrix.jsx'
import EquivalentsStep from './EquivalentsStep.jsx'
import RecipeAdjustModal from './RecipeAdjustModal.jsx'
import { itemLine } from '../../../server/domain/recipeEquivalents.js'
import RecipeSuggestModal from './RecipeSuggestModal.jsx'
import { backdropClose, pruneAdjustments, scaledRecipeLines, clampFactor, MICROS } from './planAdjustments.js'
import { PLAN_MEALS, formatMealTime, suggestMealsFromConsultation } from '../../../server/domain/planMeals.js'
import { adjustmentFactor, adjustmentKey } from '../../../server/domain/documents.js'
import { equivalentTotals, macroTargets, suggestDistribution } from '../../../server/domain/equivalents.js'
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
// Porcentajes de macros: van en el mismo guardado que el requerimiento, pero no lo vuelven viejo.
const MACRO_FIELDS = ['carbsPercent', 'proteinPercent', 'fatPercent']
// Un 0 % es válido; sólo un campo vacío cae al valor por defecto (antes `Number(x) || 50` convertía
// un 0 legítimo en 50).
const percentValue = (value, fallback) => (value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : fallback)
// Ejercicios frecuentes con su intensidad en METs (Compendio de Actividades Físicas), para no tener
// que recordar el número; se puede escribir cualquier otro valor.
const MET_PRESETS = [['3.5', 'Caminar a paso normal'], ['4.3', 'Caminar rápido'], ['5', 'Pesas / fuerza'], ['6.5', 'Baile aeróbico'], ['7', 'Trotar o fútbol'], ['7.5', 'Ciclismo moderado'], ['8', 'HIIT o natación continua'], ['9.8', 'Correr (10 km/h)'], ['2.5', 'Yoga']]
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

// Pasos del asistente, en orden, como en Avena: dietocálculo, porciones (equivalentes por grupo),
// distribuye (reparto por tiempo, recetas, semana e indicaciones) y guardar.
const STEP = { EVALUATION: 0, CALCULATION: 1, EQUIVALENTS: 2, DISTRIBUTION: 3, DELIVERY: 4 }
const DIST_SECTIONS = [['dist-portions', 'Porciones y recetas'], ['dist-adequacy', 'Adecuación'], ['dist-week', 'Semana'], ['dist-micros', 'Micronutrientes'], ['dist-optionals', 'Indicaciones']]
const PLAN_STATUS_LABEL = { DRAFT: 'Borrador', READY: 'Listo', PUBLISHED: 'Publicado', SUPERSEDED: 'Reemplazado', CANCELLED: 'Cancelado' }
const PLAN_STEP_LABELS = ['Evaluación', 'Dietocálculo', 'Distribuye', 'Semana', 'Guardar']
// Mismo cálculo de avance que el dashboard de Hoy: pasos Evaluación → Dietocálculo → recetas →
// semana completa → Guardar, 20% cada uno.
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
// Paso en el que se retoma un plan: el primero que falta. Un plan cerrado (publicado/cancelado) se
// abre en Guardar, donde están el PDF y el envío, o en Distribuye si nunca se publicó.
function resumeStep(plan) {
  if (!isEditablePlan(plan)) return plan?.publishedAt ? STEP.DELIVERY : STEP.DISTRIBUTION
  if (plan.targetKcal == null) return plan.goal || (plan.evaluation && Object.keys(plan.evaluation).length) ? STEP.CALCULATION : STEP.EVALUATION
  if (!Object.keys(plan.equivalents?.groups || {}).length) return STEP.EQUIVALENTS
  const days = new Set((plan.mealSlots || []).filter((slot) => slot.recipeId).map((slot) => slot.dayOfWeek))
  return days.size >= 5 ? STEP.DELIVERY : STEP.DISTRIBUTION
}
const STATUS_TONE = { DRAFT: 'draft', READY: 'ready', PUBLISHED: 'published', SUPERSEDED: 'muted', CANCELLED: 'cancelled' }
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
  const [hubFilter, setHubFilter] = useState('all')
  const [chooserOpen, setChooserOpen] = useState(false)
  const { patient } = usePatient(activePatientId)
  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Cargando…'
  const patientInitials = patient ? `${patient.firstName[0] || ''}${patient.lastName[0] || ''}` : '··'
  const [step, setStep] = useState(0)
  const stepsNavRef = useRef(null)
  // Secciones del paso Distribuye, con su barra fija para saltar entre ellas (la pantalla es larga).
  const [distSection, setDistSection] = useState(DIST_SECTIONS[0][0])
  const goToSection = (id) => window.document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  useEffect(() => {
    if (step !== STEP.DISTRIBUTION) return undefined
    // Se escucha en captura: en escritorio desplaza el cuerpo del paso; en el celular, la página.
    const onScroll = () => {
      const line = (window.document.querySelector('.dist-nav')?.getBoundingClientRect().bottom || 0) + 24
      let current = DIST_SECTIONS[0][0]
      for (const [id] of DIST_SECTIONS) { const element = window.document.getElementById(id); if (element && element.getBoundingClientRect().top <= line) current = id }
      setDistSection(current)
    }
    window.document.addEventListener('scroll', onScroll, true)
    onScroll()
    return () => window.document.removeEventListener('scroll', onScroll, true)
  }, [step])
  // En el celular los pasos se desplazan de lado: el actual siempre a la vista.
  useEffect(() => { stepsNavRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center' }) }, [step])
  const steps = ['Evaluación', 'Dietocálculo', 'Porciones', 'Distribuye', 'Guardar']

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
  // Espejo de notesForm para que dos ediciones en el mismo tick no se pisen (cada una parte del
  // valor más reciente, no del de este render).
  const notesFormRef = useRef(notesForm)
  notesFormRef.current = notesForm
  const [notesSaveState, setNotesSaveState] = useState('idle')
  const notesSaveTimer = useRef(null)
  const notesPendingRef = useRef(null)
  // Los guardados de las indicaciones van en fila: uno a la vez y siempre con lo último escrito.
  const notesChainRef = useRef(Promise.resolve())
  // Un plan publicado es de sólo lectura (el servidor responde 409 a cualquier cambio); uno
  // cancelado también, hasta que se reactive.
  const planLocked = !!plan && !isEditablePlan(plan)
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
    // Rellena sexo/edad desde la paciente SÓLO si el plan no los trae guardados; antes este efecto
    // pisaba los del plan y, sin fecha de nacimiento, arrastraba la edad de la paciente anterior.
    const inputs = plan?.evaluation?.inputs || {}
    setForm((prev) => {
      const next = { ...prev }
      if (inputs.sex == null) next.sex = sexToFormValue(patient.sex)
      if (inputs.age == null) next.age = computeAge(patient.birthDate) || ''
      return next
    })
  }, [patient, plan?.evaluation])

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
    if (!samePlan) {
      setCalcResult(null); setCalcState('idle'); setCalcStale(false); setCalcError('')
      setEvalSaveState('idle'); setEvalSaveError(''); setSaveState('idle'); setNotesSaveState('idle')
      setAdjustMeal(null); setSuggestMeal(null); setPickerTarget(null)
      setAdequacy(null); setAdequacyState('idle'); setCreatePlanState('idle'); setPlanActionState('idle')
    }
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
    // También mientras el cálculo está en vuelo: si no, la respuesta tardía lo daba por vigente.
    if (ENERGY_FIELDS.includes(key) && (calcResult || calcState === 'loading')) { setCalcStale(true); setEvalSaveState('idle') }
    // Un cambio de macros no invalida el cálculo, pero sí el "Guardado ✓" (van en el mismo guardado).
    else if (MACRO_FIELDS.includes(key)) setEvalSaveState('idle')
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
      const updated = await plansApi.evaluate(plan.id, { ...energyPayload(form), energyAdjustKcal: Number(form.energyAdjustKcal) || 0, carbsPercent: percentValue(form.carbsPercent, 50), proteinPercent: percentValue(form.proteinPercent, 25), fatPercent: percentValue(form.fatPercent, 25) })
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
    const next = { ...notesFormRef.current, ...patch }
    notesFormRef.current = next
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

  // Abre un plan desde el listado, siempre en el constructor: los borradores/listos se retoman en
  // el paso que falta; los publicados/cancelados se ven completos en sólo lectura (pasos, semana,
  // PDF y envío), no sólo su menú.
  const openPlan = async (item, { step: startStep = null } = {}) => {
    if (!item) return
    setPlanActionState(item.id)
    planEpochRef.current += 1
    planOpeningRef.current += 1
    try {
      // Lo que quedara por guardar del plan abierto se envía antes de leer el que se abre.
      if (notesPendingRef.current) await flushNotes()
      const full = await plansApi.get(item.id)
      planEpochRef.current += 1
      // En un plan cerrado no se descartan recetas archivadas: es lo que se le entregó.
      applyPlan(full, { recipeIds: isEditablePlan(full) && recipesRef.current.length ? new Set(recipesRef.current.map((recipe) => recipe.id)) : null })
      setStep(startStep ?? resumeStep(full))
      setView('wizard')
      requestAnimationFrame(() => { const body = window.document.querySelector('.plan-body'); if (body) body.scrollTop = 0 })
    } catch {
      // La lista queda como estaba; si la carga de la paciente esperaba a este plan, se repite.
      loadPlanDataRef.current()
    } finally {
      planOpeningRef.current -= 1
      setPlanActionState('idle')
    }
  }

  // "Editar como nueva versión": copia el plan a un borrador nuevo y lo abre en Distribuye.
  const duplicatePlan = async (item) => {
    if (!item) return
    setPlanActionState(item.id)
    try {
      if (notesPendingRef.current) await flushNotes()
      const created = await plansApi.duplicate(item.id)
      if (item.patientId && item.patientId !== activePatientRef.current) setActivePatientId(item.patientId)
      setMode('patient')
      await openPlan(created, { step: STEP.DISTRIBUTION })
      const pid = created.patientId
      patientsApi.plans(pid).then((response) => { if (activePatientRef.current === pid) setPlans(response.items || []) }).catch(() => {})
      loadHub()
    } catch { setPlanActionState('idle') }
  }

  // Reactivar desde el constructor deja el plan como estaba antes de cancelarlo.
  const reactivateOpenPlan = async () => {
    if (!plan) return
    try {
      const updated = await plansApi.reactivate(plan.id)
      mergePlan(updated)
      const pid = activePatientRef.current
      if (pid) patientsApi.plans(pid).then((response) => { if (activePatientRef.current === pid) setPlans(response.items || []) }).catch(() => {})
      loadHub()
    } catch { /* el aviso sigue a la vista */ }
  }

  const changePlanStatus = async (item, action) => {
    setPlanActionState(item.id)
    try {
      await (action === 'cancel' ? plansApi.cancel(item.id) : plansApi.reactivate(item.id))
      await loadPlanData()
      loadHub()
    } catch { /* deja la lista */ } finally { setPlanActionState('idle') }
  }

  // Abrir un plan desde el hub: pasa al constructor de esa paciente con el plan abierto.
  const openPlanFromHub = (item) => {
    // La carga de datos de la paciente corre a la par y no pisa el plan que abre openPlan.
    setActivePatientId(item.patientId)
    setMode('patient')
    openPlan(item)
  }
  // Vista rápida del menú de un plan, sin salir del listado.
  const quickLook = (item) => {
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
        // Con espacios asignados pero sin catálogo cargado, un payload vacío borraría la semana:
        // se deja pendiente y se reintenta en el próximo guardado.
        if (Object.values(snapshot.slots).some(Boolean) && !activeIds.size) {
          slotsDirtyRef.current = snapshot
          if (current()) setSaveState('error')
          slotsInFlightRef.current = false
          return
        }
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
  // Lo que se reparte y se llena en el paso Distribuye es el menú de la pestaña activa: su cuadro
  // de equivalentes y sus días de la semana.
  const currentEquivalents = activeMenu ? activeMenu.equivalents : notesForm.equivalents
  const setCurrentEquivalents = (next) => (activeMenu ? updateMenu(activeMenu.id, { equivalents: next }) : updateNotes('equivalents', next))
  const currentMenuDays = activeMenu ? DAYS.filter((day) => (activeMenu.days || []).includes(day.n)) : baseMenuDays
  const currentMenuName = activeMenu ? activeMenu.name : 'Menú base'
  const menuOfDay = (dayNumber) => extraMenus.find((menu) => (menu.days || []).includes(dayNumber)) || null
  const sameMenuDays = (dayNumber) => { const id = menuOfDay(dayNumber)?.id || 'base'; return DAYS.filter((day) => (menuOfDay(day.n)?.id || 'base') === id) }
  const setDayMenu = (dayNumber, menuId) => updateNotes('menus', extraMenus.map((menu) => {
    const days = (menu.days || []).filter((value) => value !== dayNumber)
    return menu.id === menuId ? { ...menu, days: [...days, dayNumber].sort() } : { ...menu, days }
  }))
  // Reparto automático de las porciones del menú entre TODOS los tiempos del plan (las recetas se
  // eligen después, con ese reparto a la vista).
  const distributeCurrent = () => {
    const groups = currentEquivalents?.groups || {}
    if (planLocked || !Object.keys(groups).length) return
    const hasShare = Object.values(currentEquivalents?.distribution || {}).some((meal) => Object.keys(meal || {}).length > 0)
    if (hasShare && !window.confirm('Esto reemplaza el reparto que ya hiciste por tiempo de comida. ¿Continuar?')) return
    setCurrentEquivalents({ ...currentEquivalents, groups, distribution: suggestDistribution(groups, visibleMealKeys) })
  }
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

  // Recetas distintas de un tiempo de comida (las "opciones" del plan impreso) y sus ajustes.
  // Con `days` sólo cuentan esos días (los de un menú).
  const mealRecipes = (key, days = DAYS) => { const seen = new Set(); return days.map((day) => recipeById(slots[slotKey(day.n, key)])).filter((recipe) => recipe && !seen.has(recipe.id) && seen.add(recipe.id)) }
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
    const prescribed = equivalentTotals(currentEquivalents?.distribution?.[mealKey])
    if (prescribed.kcal > 0) return { ...prescribed, source: 'equivalents' }
    if (plan?.targetKcal == null) return null
    const dayKcal = Number(plan.targetKcal) + (Number(activeMenu?.kcalDelta) || 0)
    const shareOf = (key) => PLAN_MEALS.find((item) => item.key === key)?.share || 0
    const keys = visibleMealKeys.includes(mealKey) ? visibleMealKeys : [...visibleMealKeys, mealKey]
    const total = keys.reduce((sum, key) => sum + shareOf(key), 0)
    if (!total) return null
    return { ...macroTargets({ kcal: (dayKcal * shareOf(mealKey)) / total, carbsPercent: plan.carbsPercent, proteinPercent: plan.proteinPercent, fatPercent: plan.fatPercent }), source: 'share' }
  }
  const suggestTarget = useMemo(() => (suggestMeal ? mealTarget(suggestMeal.key) : null), [suggestMeal, notesForm.equivalents, notesForm.menus, menuTab, plan?.targetKcal, plan?.carbsPercent, plan?.proteinPercent, plan?.fatPercent, visibleMealKeys.join('|')])
  // Recetas ya asignadas a OTROS tiempos de comida: no se sugieren de nuevo.
  const suggestExclude = useMemo(() => (suggestMeal ? [...new Set(Object.entries(slots).filter(([key, recipeId]) => recipeId && key.split(':')[1] !== suggestMeal.key).map(([, recipeId]) => recipeId))] : []), [suggestMeal, slots])
  const suggestAvoid = useMemo(() => { if (!suggestMeal || !plan?.consultation) return []; const ex = readExpediente(plan); return avoidTermsFromText(ex.allergies, ex.avoid) }, [suggestMeal, plan?.consultation])
  // Llena los días del menú activo, en ese tiempo de comida, con las recetas elegidas: la opción i
  // va al día i+1 del menú y, si son menos, los días que faltan repiten desde la primera. Cada receta con factor
  // distinto de 1 entra con sus cantidades ya ajustadas (lo mismo que "Ajustar al cálculo").
  const applySuggestions = (meal, picks) => {
    const days = currentMenuDays
    if (planLocked || !picks.length || !days.length) return
    const used = picks.slice(0, days.length)
    const nextSlots = { ...slots }
    days.forEach((day, index) => { nextSlots[slotKey(day.n, meal.key)] = used[index % used.length].recipe.id })
    const servings = mealServingsFor(meal.key)
    const adjustments = { ...(notesForm.recipeAdjustments || {}) }
    for (const pick of used) {
      // Ya estaba en la semana y no se tocó en la galería: conserva el ajuste que tenía.
      if (pick.keep) continue
      const key = adjustmentKey(meal.key, pick.recipe.id)
      // Sugerida por grupos: entra ya ajustada a las porciones del tiempo, ingrediente por ingrediente.
      if (pick.items?.length) adjustments[key] = { lines: pick.items.map(itemLine), factor: clampFactor(pick.factor), items: pick.items }
      else if (pick.factor !== 1) adjustments[key] = { lines: scaledRecipeLines(pick.recipe, servings, pick.factor), factor: pick.factor }
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
    // Cada paso empieza arriba (antes heredaba el scroll del anterior y se abría a media página).
    requestAnimationFrame(() => { const body = window.document.querySelector('.plan-body'); if (body) body.scrollTop = 0 })
  }
  // Pasos ya resueltos (✓ en la barra), con lo que hay en pantalla.
  const filledDays = new Set(Object.entries(slots).filter(([, recipeId]) => recipeId).map(([key]) => key.split(':')[0])).size
  const stepDone = [
    !!(plan?.goal || (plan?.evaluation && Object.keys(plan.evaluation).length)),
    plan?.targetKcal != null,
    Object.keys(notesForm.equivalents?.groups || {}).length > 0,
    filledDays >= 5,
    plan?.status === 'PUBLISHED' || plan?.status === 'SUPERSEDED',
  ]
  // Reintenta lo que no se pudo guardar (indicaciones pendientes y la semana tal como está).
  const retrySave = () => { if (notesPendingRef.current) flushNotes(); if (saveState === 'error') persistSlots(slots) }
  // Un solo estado de guardado para todo el plan (semana + indicaciones): antes un fallo al
  // guardar equivalentes, horas o ajustes no se veía fuera del paso de la semana.
  const combinedSave = planLocked ? 'locked' : saveState === 'error' || notesSaveState === 'error' ? 'error' : saveState === 'saving' || notesSaveState === 'saving' || notesSaveState === 'editing' ? 'saving' : 'saved'
  const syncLabel = <span className={'sync-label ' + (combinedSave === 'saving' ? 'loading' : combinedSave === 'error' ? 'demo' : 'online')}>{combinedSave === 'saving' ? '● Guardando…' : combinedSave === 'error' ? '● Error al guardar' : combinedSave === 'locked' ? (plan?.status === 'CANCELLED' ? '● Cancelado · sólo lectura' : '● Publicado · sólo lectura') : plan ? '● Sincronizado' : '● Sin plan en borrador'}</span>

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

  // Receta de un día concreto (cuadrícula "Tiempo"): se cambia por otra de las ya elegidas.
  const [dayPick, setDayPick] = useState(null)
  const [dayInfo, setDayInfo] = useState(null)
  const setDaySlot = (mealType, day, recipeId) => {
    if (planLocked) return
    commitSlots({ ...slots, [slotKey(day, mealType)]: recipeId })
    setDayPick(null)
  }

  const clearSlot = (mealType, day) => {
    if (planLocked) return
    const nextSlots = { ...slots }
    delete nextSlots[slotKey(day, mealType)]
    commitSlots(nextSlots)
  }

  // Firma de la distribución: el efecto de adecuación debe repetirse cuando cambia el MENÚ, no en
  // cada guardado de indicaciones (que también reemplaza la identidad de `plan` y disparaba
  // peticiones en cadena).
  const distributionSignature = (plan?.mealSlots || []).map((slot) => `${slot.dayOfWeek}:${slot.mealType}:${slot.recipeId || ''}:${slot.servings}`).sort().join(',')
  useEffect(() => {
    if (step !== STEP.DISTRIBUTION || !plan) return
    let cancelled = false
    setAdequacyState('loading')
    plansApi.adequacy(plan.id)
      .then((response) => { if (!cancelled) { setAdequacy(response); setAdequacyState('ready') } })
      .catch(() => { if (!cancelled) setAdequacyState('error') })
    return () => { cancelled = true }
  }, [step, plan?.id, distributionSignature])

  const mealServingsFor = (mealType) => mealServingsRef.current[mealType] ?? 1
  const averageKcalForMeal = (mealType, days = DAYS) => {
    const assigned = days.map((day) => recipeById(slots[slotKey(day.n, mealType)])).filter(Boolean)
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

  // Lo que suma un día de la semana con sus recetas (× raciones × ajuste): energía, macros y los
  // micronutrimentos que traen las recetas.
  const dayNutrition = (dayNumber) => {
    const keys = ['kcal', 'protein', 'carbs', 'fat', ...MICROS.map(([key]) => key)]
    const totals = Object.fromEntries(keys.map((key) => [key, 0]))
    const rows = []
    for (const meal of visibleMeals) {
      const recipe = recipeById(slots[slotKey(dayNumber, meal.key)])
      if (!recipe) continue
      const scale = mealServingsFor(meal.key) * factorFor(meal.key, recipe.id)
      const nutrition = effectiveNutrition(recipe)
      for (const key of keys) totals[key] += (Number(nutrition[key]) || 0) * scale
      rows.push({ meal, recipe, kcal: Math.round((Number(nutrition.kcal) || 0) * scale) })
    }
    return { totals, rows }
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
      <div className="pa-head"><p className="eyebrow">ADECUACIÓN DEL PLAN · PROMEDIO DIARIO</p>{!targetKcal ? <span className="muted">Sin cálculo guardado (paso Dietocálculo)</span> : hasPlan ? <span className={'pa-status ' + (status || '')}>{pct}% {status === 'over' ? '· por encima' : status === 'low' ? '· por debajo' : '· adecuado'}</span> : null}</div>
      {!hasPlan && <p className="muted">Elige recetas con “Ver recetas” para ver aquí cuánto cubre el plan.</p>}
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

  // Pestañas de los menús del plan (tipos de día), en Porciones y en Distribuye: cada menú tiene
  // su cuadro de porciones y sus días.
  const renderMenuTabs = () => {
    if (!plan) return null
    return <div className="menu-tabs panel">
      <div className="menu-tabs-row">
        <p className="eyebrow">MENÚS DEL PLAN</p>
        <button type="button" className={!activeMenu ? 'selected' : ''} onClick={() => setMenuTab('base')}>Menú base</button>
        {extraMenus.map((menu) => <button type="button" key={menu.id} className={activeMenu?.id === menu.id ? 'selected' : ''} onClick={() => setMenuTab(menu.id)}>{menu.name}</button>)}
        {!planLocked && extraMenus.length < 4 && <><button type="button" className="menu-add" onClick={addMenu} title={'Un plan puede llevar más de un menú (por ejemplo, días de entrenamiento con más energía): cada uno con sus días y su propio cuadro de equivalentes.'}>+ Agregar menú</button>{extraMenus.length === 0 && <small className="muted menu-hint">Para días con otra energía (entrenamiento, fin de semana).</small>}</>}
      </div>
      {!activeMenu && extraMenus.length > 0 && <small className="muted">{`El menú base aplica ${baseMenuDays.length ? `en ${baseMenuDays.map((day) => day.label.toLowerCase()).join(', ')}` : 'en ningún día: todos están asignados a otro menú'}.`}</small>}
      {activeMenu && <div className="menu-settings">
        <label>Nombre<input value={activeMenu.name} disabled={planLocked} maxLength={40} onChange={(event) => updateMenu(activeMenu.id, { name: event.target.value })} /></label>
        <div className="menu-days"><small>Días que usan este menú</small><div>{DAYS.map((day) => <label key={day.n} className={(activeMenu.days || []).includes(day.n) ? 'on' : ''}><input type="checkbox" disabled={planLocked} checked={(activeMenu.days || []).includes(day.n)} onChange={() => toggleMenuDay(activeMenu, day.n)} />{day.label.slice(0, 3)}</label>)}</div></div>
        <label>Ajuste de energía (kcal)<input type="number" step="50" min="-1500" max="1500" disabled={planLocked} value={activeMenu.kcalDelta ?? 0} onChange={(event) => updateMenu(activeMenu.id, { kcalDelta: Number(event.target.value) || 0 })} /></label>
        <span className="muted menu-target">{plan.targetKcal != null ? `Requerimiento de este menú: ${plan.targetKcal + (Number(activeMenu.kcalDelta) || 0)} kcal (el del plan: ${plan.targetKcal})` : 'Calcula el requerimiento del plan para ver el de este menú.'}</span>
        {!planLocked && <button type="button" className="link-button" onClick={() => removeMenu(activeMenu)}>Quitar este menú</button>}
      </div>}
    </div>
  }

  const menuEntryFor = (source, day, meal) => (source || []).find((entry) => entry.dayOfWeek === day && entry.mealType === meal)
  const renderMenuPreview = (sourcePlan) => {
    const menu = sourcePlan.menuSnapshot?.length ? sourcePlan.menuSnapshot : sourcePlan.mealSlots || []
    return <div className="menu-preview-table">
      <div className="menu-preview-head"><span>Tiempo</span>{DAYS.map((day) => <b key={day.n}>{day.label.slice(0, 3)}</b>)}</div>
      {MEAL_TYPES.filter((meal) => menu.some((entry) => entry.mealType === meal.key)).map((meal) => <div className="menu-preview-row" key={meal.key}><span>{meal.label}</span>{DAYS.map((day) => { const entry = menuEntryFor(menu, day.n, meal.key); const name = entry?.recipeName || (entry?.recipeId ? recipeById(entry.recipeId)?.name : null); return <div className="menu-preview-cell" key={day.n}>{name ? <>{name}{entry?.kcal ? <small>{Math.round(entry.kcal)} kcal</small> : null}</> : <small className="muted">—</small>}</div> })}</div>)}
    </div>
  }

  // Tarjeta de un plan en los listados: fotos de sus recetas, estado, energía y avance. Todo plan se
  // abre en el constructor (los cerrados en sólo lectura); de uno cerrado sale una versión nueva.
  const renderPlanCard = (item, { withPatient = false } = {}) => {
    const { progress } = planProgress(item)
    const editable = isEditablePlan(item)
    const busy = planActionState === item.id
    const slotsOfPlan = item.mealSlots || []
    const planRecipes = [...new Map(slotsOfPlan.filter((slot) => slot.recipe).map((slot) => [slot.recipe.id, slot.recipe])).values()]
    const days = new Set(slotsOfPlan.filter((slot) => slot.recipeId).map((slot) => slot.dayOfWeek)).size
    const open = () => (withPatient ? openPlanFromHub(item) : openPlan(item))
    const cancel = () => { if (window.confirm('¿Cancelar este plan? Podrás reactivarlo después.')) changePlanStatus(item, 'cancel') }
    const meta = [withPatient && `v${item.version}`, item.targetKcal ? `${item.targetKcal.toLocaleString('es-MX')} kcal/día` : 'Sin dietocálculo', `${days}/7 días con recetas`, item.publishedAt ? `publicado ${planUpdatedLabel(item.publishedAt)}` : `actualizado ${planUpdatedLabel(item.updatedAt || item.createdAt)}`].filter(Boolean)
    return <article className={'plan-card-item pc-' + (STATUS_TONE[item.status] || 'muted')} key={item.id}>
      <button type="button" className="pc-main" disabled={busy} onClick={open} title={editable ? 'Continuar este plan' : 'Abrir el plan completo (sólo lectura)'}>
        <span className="pc-photos" aria-hidden="true">
          {planRecipes.slice(0, 4).map((recipe, index) => <span key={recipe.id}>{recipeThumb(recipe, index, 'pc-thumb')}</span>)}
          {planRecipes.length > 4 && <span className="pc-more">+{planRecipes.length - 4}</span>}
          {planRecipes.length === 0 && <span className="pc-empty">🥗</span>}
        </span>
        <span className="pc-info">
          <span className="pc-title"><b>{withPatient ? `${item.patient?.firstName || ''} ${item.patient?.lastName || ''}` : `Plan v${item.version}`}</b><i className={'pc-status ' + (STATUS_TONE[item.status] || 'muted')}>{PLAN_STATUS_LABEL[item.status] || item.status}</i></span>
          <small>{meta.join(' · ')}</small>
          {item.goal && <small className="pc-goal">{item.goal}</small>}
        </span>
      </button>
      {editable && <div className="plan-card-progress"><div className="pp-bar"><i style={{ width: `${progress}%` }} /></div><b>{progress}%</b></div>}
      <div className="plan-card-actions">
        <button type="button" className={editable ? 'primary' : 'secondary'} disabled={busy} onClick={open}>{busy ? 'Abriendo…' : editable ? `Continuar en ${steps[resumeStep(item)]}` : 'Abrir plan'}</button>
        {!editable && <button type="button" className="secondary" disabled={busy} onClick={() => duplicatePlan(item)} title="Copia este plan a un borrador nuevo para cambiarlo; el original no se toca">Editar como nueva versión</button>}
        {item.status === 'PUBLISHED' && <button type="button" className="link-button" disabled={busy} onClick={() => quickLook(item)}>Vista rápida</button>}
        {editable && <button type="button" className="link-button pc-cancel" disabled={busy} onClick={cancel}>Cancelar</button>}
        {item.status === 'CANCELLED' && <button type="button" className="link-button" disabled={busy} onClick={() => changePlanStatus(item, 'reactivate')}>Reactivar</button>}
      </div>
    </article>
  }
  const planGroups = (items) => [
    ['pending', 'En curso', items.filter((item) => isEditablePlan(item))],
    ['done', 'Guardados y asignados', items.filter((item) => item.status === 'PUBLISHED' || item.status === 'SUPERSEDED')],
    ['cancelled', 'Cancelados', items.filter((item) => item.status === 'CANCELLED')],
  ]

  const renderHub = () => {
    const query = hubQuery.trim().toLowerCase()
    const filtered = hubPlans.filter((item) => !query || `${item.patient?.firstName || ''} ${item.patient?.lastName || ''}`.toLowerCase().includes(query))
    const allGroups = planGroups(filtered)
    const groups = hubFilter === 'all' ? allGroups : allGroups.filter(([key]) => key === hubFilter)
    return <AppChrome active="Constructor de plan" setActive={setActive}><div className="content plan-studio">
      <ModuleHeader eyebrow="PLANIFICACIÓN · CONSTRUCTOR" title="Planes alimenticios" subtitle="Todos los planes de tu consulta: retoma un borrador donde lo dejaste o revisa los anteriores." action={<button className="primary" onClick={() => setChooserOpen(true)}><span>+</span> Nuevo plan</button>} />
      <div className="hub-toolbar panel"><div className="search-field">⌕ <input value={hubQuery} onChange={(event) => setHubQuery(event.target.value)} placeholder="Buscar por paciente..." /></div>
        <div className="hub-filters" role="tablist" aria-label="Filtrar planes">{[['all', 'Todos', filtered.length], ...allGroups.map(([key, label, items]) => [key, label, items.length])].map(([key, label, count]) => <button type="button" role="tab" aria-selected={hubFilter === key} className={hubFilter === key ? 'active' : ''} key={key} onClick={() => setHubFilter(key)}>{label}<i>{count}</i></button>)}</div>
      </div>
      {/* En escritorio el contenido no scrollea como página: sólo este cuerpo lo hace (ver el layout
          de altura completa en globals.css). Sin él, los grupos de planes se recortaban abajo. */}
      <div className="module-body plans-scroll">
      {hubState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando planes…</h3></div>}
      {hubState === 'error' && <div className="form-error">⚠ No se pudieron cargar los planes.</div>}
      {hubState === 'ready' && filtered.length === 0 && <div className="result-empty panel"><span>◌</span><h3>{query ? 'Sin planes de ese paciente' : 'Todavía no hay planes'}</h3><p>Crea el primero con "+ Nuevo plan".</p></div>}
      {hubState === 'ready' && filtered.length > 0 && groups.every(([, , items]) => items.length === 0) && <div className="result-empty panel"><span>◌</span><h3>Nada en esta pestaña</h3><p>Prueba con “Todos”.</p></div>}
      {hubState === 'ready' && groups.map(([key, title, items]) => items.length > 0 && <section className="plans-group" key={key}>
        <p className="eyebrow">{title.toUpperCase()} · {items.length}</p>
        <div className="plan-cards">{items.map((item) => renderPlanCard(item, { withPatient: true }))}</div>
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
    const groups = planGroups(plans)
    return <div className="plans-overview">
      <div className="plans-overview-head"><div><p className="eyebrow">PLANIFICACIÓN · PLANES</p><h1>Planes alimenticios</h1><p className="subtitle">Retoma un borrador donde lo dejaste, abre uno entregado o haz una versión nueva a partir de él.</p></div><button className="primary" onClick={() => createPlan()} disabled={createPlanState === 'creating'}><span>+</span> {createPlanState === 'creating' ? 'Creando…' : 'Nuevo plan'}</button></div>
      {plans.length === 0 && <div className="result-empty panel"><span>◌</span><h3>Sin planes todavía</h3><p>Crea el primer plan de {patientName}.</p></div>}
      {groups.map(([key, title, items]) => items.length > 0 && <section className="plans-group" key={key}>
        <p className="eyebrow">{title.toUpperCase()} · {items.length}</p>
        <div className="plan-cards">{items.map((item) => renderPlanCard(item))}</div>
      </section>)}
    </div>
  }

  if (!activePatientId) return <AppChrome active="Constructor de plan" setActive={setActive}><div className="content plan-studio">
    <ModuleHeader eyebrow="PLANIFICACIÓN · CONSTRUCTOR" title="Constructor de plan" subtitle="Elige un paciente para armar y guardar su plan de alimentación." />
    <div className="result-empty panel"><span>◌</span><h3>Elige un paciente</h3><p>Selecciona a quién le vas a diseñar el plan para comenzar.</p><select value="" onChange={(e) => onSelectPatient?.(e.target.value)}><option value="">Selecciona…</option>{patients.map((p) => <option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select></div>
  </div></AppChrome>

  return <AppChrome active="Constructor de plan" setActive={setActive}><div className={'content plan-studio' + (view === 'list' ? '' : ' plan-wizard')}>{view === 'list' ? <><div className="plan-header plan-list-header">
      <div className="plan-header-who">
        <button type="button" className="plan-header-back" onClick={() => { setMode('hub'); loadHub() }} title="Todos los planes" aria-label="Volver a todos los planes">←</button>
        <span className="person-avatar coral">{patientInitials}</span>
        <div><b>{patientName}</b><small>{plans.length === 1 ? '1 plan' : `${plans.length} planes`} · el borrador se guarda solo</small></div>
      </div>
      <div className="plan-header-tools"><button type="button" className="link-button" onClick={() => setActive('Pacientes')}>Pacientes</button><label className="patient-switch">Paciente<select value={activePatientId || ''} onChange={(e) => { const nextId = e.target.value; if (!nextId) return; setActivePatientId(nextId); setMode('patient'); onSelectPatient?.(nextId) }}>{patients.map((p) => <option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select></label></div>
    </div>{renderPlansOverview()}</> : <>
    {/* Una sola barra: quién es la paciente, los pasos y el estado. Antes eran dos tarjetas que
        se comían ~220 px de alto y dejaban poco espacio al paso. */}
    <div className="plan-header">
      <div className="plan-header-who">
        <button type="button" className="plan-header-back" onClick={() => setView('list')} title={`Planes de ${patientName}`} aria-label={`Volver a los planes de ${patientName}`}>←</button>
        <span className="person-avatar coral">{patientInitials}</span>
        <div><b>{patientName}</b><small>{plan ? `Plan v${plan.version} · ` : ''}{plan?.status === 'CANCELLED' ? 'Cancelado' : planLocked ? 'Publicado' : 'Borrador · se guarda solo'}</small></div>
      </div>
      <nav className="plan-steps" ref={stepsNavRef}>{steps.map((x, i) => <button className={(step === i ? 'active' : '') + (stepDone[i] ? ' done' : '')} aria-current={step === i ? 'step' : undefined} onClick={() => selectStep(i)} key={x} title={stepDone[i] ? `${x} · listo` : x}><span>{stepDone[i] && step !== i ? '✓' : i + 1}</span>{x}</button>)}</nav>
      <div className="plan-header-tools">{syncLabel}</div>
    </div>

    <div className="plan-body">

    {planLocked && <div className="eq-notice plan-locked-notice">
      <span className="plan-locked-icon" aria-hidden="true">{plan.status === 'CANCELLED' ? '⏸' : '🔒'}</span>
      <div><b>{plan.status === 'CANCELLED' ? 'Este plan está cancelado.' : `Plan guardado y asignado${plan.publishedAt ? ` el ${new Date(plan.publishedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}` : ''}.`}</b> <span>{plan.status === 'CANCELLED' ? 'Puedes revisarlo; reactívalo para seguir con él o haz una versión nueva.' : 'Puedes revisar todos los pasos; para cambiar algo, haz una versión nueva (el original se conserva tal cual se entregó).'}</span></div>
      <div className="plan-locked-actions">
        <button type="button" className="primary" disabled={planActionState === plan.id} onClick={() => duplicatePlan(plan)}>{planActionState === plan.id ? 'Creando…' : 'Editar como nueva versión'}</button>
        {plan.status === 'CANCELLED' && <button type="button" className="secondary" onClick={reactivateOpenPlan}>Reactivar</button>}
        {plan.publishedAt && plan.status !== 'CANCELLED' && step !== STEP.DELIVERY && <button type="button" className="link-button" onClick={() => selectStep(STEP.DELIVERY)}>PDF y envío</button>}
      </div>
    </div>}

    {plan?.consultation && (() => {
      const ex = readExpediente(plan)
      const hasData = ex.reason || ex.diagnoses.length || ex.conditions.length || ex.allergies.length || ex.avoid.length || ex.prefers || ex.outOfRange.length
      if (!hasData) return null
      // Después del dietocálculo sólo queda a la vista lo que cambia la elección de alimentos.
      if (step === STEP.DELIVERY) return null
      if (step > STEP.CALCULATION) {
        const brief = [ex.allergies.length && `Alergias / intolerancias: ${ex.allergies.join(' · ')}`, ex.avoid.length && `Evitar: ${ex.avoid.join(' · ')}`, ex.prefers && `Prefiere: ${ex.prefers}`].filter(Boolean)
        return brief.length ? <div className="plan-context-brief"><b>Del expediente</b>{brief.map((text) => <span key={text}>{text}</span>)}</div> : null
      }
      // Abierto en Evaluación; en Dietocálculo empieza plegado para dejar espacio al cálculo.
      return <details className="form-card plan-context-card" key={step} open={step === STEP.EVALUATION}>
        <summary className="plan-context-head"><div><p className="eyebrow">RESUMEN DEL EXPEDIENTE</p><b>Datos que alimentan este plan</b>{step !== STEP.EVALUATION && <small className="muted">Toca para ver motivo, diagnósticos y laboratorio</small>}</div><button type="button" className="secondary" disabled={planLocked} onClick={(event) => { event.preventDefault(); const goal = buildExpedienteGoal(plan); if (goal) updateForm('goal', goal); updateNotes('recommendations', buildExpedienteRecommendations(plan)) }}>Aplicar al objetivo y recomendaciones</button></summary>
        {ex.reason && <p className="plan-context-reason"><b>Motivo:</b> {ex.reason}</p>}
        {ex.diagnoses.length > 0 && <div className="plan-context-diagnoses">{ex.diagnoses.map((diagnosis) => <span key={diagnosis.id}><b>{diagnosis.domain}</b> {diagnosis.problem}</span>)}</div>}
        <div className="plan-context-grid">
          {ex.conditions.length > 0 && <div><small>Padecimientos</small><p>{ex.conditions.join(' · ')}</p></div>}
          {ex.allergies.length > 0 && <div><small>Alergias / intolerancias</small><p>{ex.allergies.join(' · ')}</p></div>}
          {ex.avoid.length > 0 && <div><small>Alimentos a evitar</small><p>{ex.avoid.join(' · ')}</p></div>}
          {ex.prefers && <div><small>Preferencias</small><p>{ex.prefers}</p></div>}
          {ex.outOfRange.length > 0 && <div><small>Laboratorio a vigilar</small><p>{ex.outOfRange.map((lab) => `${lab.name} ${lab.value ?? ''} ${lab.unit || ''} (${String(lab.status).toLowerCase()})`).join(' · ')}</p></div>}
        </div>
      </details>
    })()}

    {step === STEP.EVALUATION && <><ModuleHeader eyebrow="EVALUACIÓN NUTRICIONAL" title="Datos y objetivos" subtitle="Resumen del expediente y del último cálculo guardado en el paso Dietocálculo." action={<button className="secondary" onClick={() => selectStep(1)}>Ir al cálculo →</button>} /><div className="plan-grid"><div className="plan-card panel"><h3>Datos antropométricos</h3><div className="form-grid three"><label>Sexo<input value={sexLabel(patient?.sex) || '—'} readOnly /></label><label>Fecha nacimiento<input value={formatUTCDate(patient?.birthDate) || '—'} readOnly /></label><label>Edad<input value={computeAge(patient?.birthDate) ? `${computeAge(patient.birthDate)} años` : '—'} readOnly /></label><label>Peso actual<input value={plan?.evaluation?.inputs?.weightKg ? `${plan.evaluation.inputs.weightKg} kg` : '—'} readOnly /></label><label>Talla<input value={plan?.evaluation?.inputs?.heightCm ? `${plan.evaluation.inputs.heightCm} cm` : '—'} readOnly /></label><label>IMC calculado<input value={plan?.evaluation?.bmi ?? '—'} readOnly /></label></div></div><div className="plan-card panel ideal-card"><h3>Rangos de peso ideal <span>ⓘ</span></h3>{plan?.evaluation?.idealWeightRange ? <div className="ideal-number">{plan.evaluation.idealWeightRange.minKg} <small>– {plan.evaluation.idealWeightRange.maxKg} kg</small></div> : <p className="muted">Calcula el requerimiento en el paso "Dietocálculo" para ver el rango.</p>}<p className="muted">Rango estimado para su estatura</p></div><div className="plan-card panel full"><h3>Objetivo terapéutico</h3>{plan?.goal ? <p>{plan.goal}</p> : <p className="muted">Sin definir todavía — se guarda junto con el cálculo en el paso "Dietocálculo".</p>}</div></div></>}

    {step === STEP.CALCULATION && <><ModuleHeader eyebrow="DIETOCÁLCULO · REQUERIMIENTO" title="Calcula el punto de partida" subtitle="Cada resultado queda asociado a la fórmula y a los datos utilizados." /><form className="calculator-layout" onSubmit={calculate}><section className="panel calculator-form"><div className="section-heading"><div><h2>Datos de la paciente</h2><p className="subtitle">Puedes ajustar estos valores para simular el plan.</p></div></div><div className="form-grid three"><label>Sexo<select value={form.sex} onChange={(e) => updateForm('sex', e.target.value)}><option value="male">Hombre</option><option value="female">Mujer</option></select></label><label>Edad (años)<input type="number" min="1" max="120" value={form.age} onChange={(e) => updateForm('age', e.target.value)} /></label><label>Peso (kg)<input type="number" step="0.1" min="1" value={form.weightKg} onChange={(e) => updateForm('weightKg', e.target.value)} /></label><label>Talla (cm)<input type="number" step="0.1" min="30" value={form.heightCm} onChange={(e) => updateForm('heightCm', e.target.value)} /></label><label>Fórmula energética<select value={form.formula} onChange={(e) => updateForm('formula', e.target.value)}><option value="mifflin">Mifflin-St Jeor</option><option value="harris">Harris-Benedict</option><option value="schofield">FAO/OMS/ONU (Schofield)</option><option value="valencia">Valencia (población mexicana)</option><option value="cunningham">Cunningham</option><option value="katch-mcardle">Katch-McArdle</option></select></label>{needsBodyFat && <label>% Grasa corporal<input type="number" step="0.1" min="1" max="75" value={form.bodyFatPercent} onChange={(e) => updateForm('bodyFatPercent', e.target.value)} /></label>}<label>Actividad física<select value={form.activityMethod === 'mets' ? 'mets' : form.activityFactor} onChange={(e) => { if (e.target.value === 'mets') updateForm('activityMethod', 'mets'); else { setForm((prev) => ({ ...prev, activityMethod: 'factor' })); updateForm('activityFactor', e.target.value) } }}><option value="1.2">Sedentaria · 1.2</option><option value="1.375">Ligera · 1.375</option><option value="1.55">Moderada · 1.55</option><option value="1.725">Intensa · 1.725</option><option value="mets">Por ejercicio (METs)…</option></select></label>{form.activityMethod === 'mets' && <><label>Ejercicio<select value={MET_PRESETS.some(([value]) => value === String(form.metsValue)) ? String(form.metsValue) : ''} onChange={(e) => updateForm('metsValue', e.target.value)}><option value="">Otro (escribe los METs)</option>{MET_PRESETS.map(([value, label]) => <option value={value} key={label}>{label} · {value} METs</option>)}</select></label><label>METs<input type="number" min="1" max="23" step="0.1" value={form.metsValue} onChange={(e) => updateForm('metsValue', e.target.value)} /></label><label>Minutos por sesión<input type="number" min="1" max="600" value={form.metsMinutes} onChange={(e) => updateForm('metsMinutes', e.target.value)} /></label><label>Sesiones por semana<input type="number" min="1" max="21" value={form.metsSessions} onChange={(e) => updateForm('metsSessions', e.target.value)} /></label></>}<label>Ajuste por objetivo<select value={showCustomAdjust ? 'custom' : String(form.energyAdjustKcal)} onChange={(e) => { if (e.target.value === 'custom') { setCustomAdjust(true); return } setCustomAdjust(false); updateForm('energyAdjustKcal', e.target.value) }}>{ENERGY_ADJUST_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}<option value="custom">Otro valor…</option></select></label>{showCustomAdjust && <label>Ajuste (kcal/día)<input type="number" step="50" min="-1500" max="1500" placeholder="0" value={form.energyAdjustKcal} onChange={(e) => updateForm('energyAdjustKcal', e.target.value)} /></label>}</div><div className="macro-distribution"><div className="section-heading"><div><h2>Distribución de macronutrientes</h2><p className="subtitle">Porcentaje del requerimiento energético. La suma debe dar 100%.</p></div></div><div className="form-grid three"><label>Carbohidratos (%)<input type="number" min="0" max="100" value={form.carbsPercent} onChange={(e) => updateForm('carbsPercent', e.target.value)} /></label><label>Proteína (%)<input type="number" min="0" max="100" value={form.proteinPercent} onChange={(e) => updateForm('proteinPercent', e.target.value)} /></label><label>Grasas (%)<input type="number" min="0" max="100" value={form.fatPercent} onChange={(e) => updateForm('fatPercent', e.target.value)} /></label></div><div className={'macro-sum' + (macroSum === 100 ? '' : ' invalid')}>{macroSum}% {macroSum === 100 ? '· distribución correcta' : '· debe sumar 100%'}</div>{calcResult?.get && macroSum === 100 && <div className="macro-grams">Carbohidratos {macroGrams(form.carbsPercent, 4)} g · Proteína {macroGrams(form.proteinPercent, 4)} g · Grasas {macroGrams(form.fatPercent, 9)} g</div>}</div><label>Objetivo terapéutico<textarea className="wide-textarea" placeholder="Resultado clínico y conductual esperado..." value={form.goal} onChange={(e) => updateForm('goal', e.target.value)} /></label><button className="primary calculate-button" disabled={calcState === 'loading'}>{calcState === 'loading' ? 'Calculando...' : 'Calcular requerimiento'} <span>→</span></button>{calcState === 'error' && <div className="form-error">⚠ {calcError}</div>}</section><aside className="panel calculation-result">{!calcResult && calcState !== 'loading' ? <div className="result-empty"><span>◌</span><h3>Tu resultado aparecerá aquí</h3><p>Completa o confirma los datos y calcula el requerimiento energético.</p></div> : calcState === 'loading' ? <div className="result-empty"><span className="loading-dot">●</span><h3>Calculando requerimiento...</h3><p>Estamos aplicando la fórmula seleccionada.</p></div> : <><div className="result-header"><div><p className="eyebrow">RESULTADO CALCULADO</p><h2>Requerimiento energético</h2></div><span className="result-check">✓</span></div><div className="get-number"><small>{calcResult.energyAdjustKcal ? 'Requerimiento del plan' : 'GET · Gasto energético total'}</small><b>{calcTarget.toLocaleString()} <em>kcal/día</em></b><span>{calcResult.energyAdjustKcal ? `GET ${calcResult.get.toLocaleString()} kcal ${calcResult.energyAdjustKcal > 0 ? '+' : '−'} ${Math.abs(calcResult.energyAdjustKcal)} kcal por objetivo · ` : ''}Basado en {calcResult.formulaLabel || calcResult.formula} · {calcResult.activityMethod === 'mets' ? 'metabolismo basal + ejercicio por METs' : `factor ${form.activityFactor}`}</span></div><div className="result-details"><div><small>Metabolismo basal</small><b>{calcResult.bmr.toLocaleString()} kcal</b></div><div><small>Actividad estimada</small><b>+{calcResult.activityKcal.toLocaleString()} kcal</b></div></div>{calcResult.bmi && <div className="result-details"><div><small>IMC</small><b>{calcResult.bmi}</b></div><div><small>Peso saludable estimado</small><b>{calcResult.idealWeightRange.minKg}–{calcResult.idealWeightRange.maxKg} kg</b></div></div>}{calcResult.flags?.length > 0 && <div className="form-error">⚠ {calcResult.flags.map((f) => f.message).join(' ')}</div>}{calcStale && <div className="form-error">⚠ Cambiaste los datos después de calcular: este resultado ya no corresponde. Vuelve a calcular antes de guardar.</div>}<button type="button" className="primary full-button" disabled={evalSaveState === 'saving' || !plan || planLocked || calcStale || macroSum !== 100} onClick={saveToPlan}>{evalSaveState === 'saving' ? 'Guardando...' : evalSaveState === 'saved' ? 'Guardado en el plan ✓' : 'Guardar en el plan'} <span>→</span></button>{!plan && <p className="muted">Crea una consulta y un plan en borrador para poder guardar.</p>}{evalSaveState === 'error' && <div className="form-error">⚠ {evalSaveError}</div>}</>}</aside></form></>}

    {step === STEP.EQUIVALENTS && <>
      {renderMenuTabs()}
      <EquivalentsStep key={activeMenu?.id || 'base'} plan={activeMenu && plan?.targetKcal != null ? { ...plan, targetKcal: plan.targetKcal + (Number(activeMenu.kcalDelta) || 0) } : plan} value={activeMenu ? activeMenu.equivalents : notesForm.equivalents} onChange={(next) => (activeMenu ? updateMenu(activeMenu.id, { equivalents: next }) : updateNotes('equivalents', next))} locked={planLocked} expediente={plan?.consultation ? readExpediente(plan) : null} activeMeals={visibleMealKeys} onGoToCalculation={() => selectStep(STEP.CALCULATION)} />
    </>}

    {step === STEP.DISTRIBUTION && <>
      <ModuleHeader eyebrow="PLAN ALIMENTARIO · DISTRIBUYE" title="Distribuye y elige recetas" subtitle="Reparte las porciones entre los tiempos de comida, elige las recetas de cada uno y acomódalas en los días de la semana." />
      {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando plan y recetas…</h3></div>}
      {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar el plan o el catálogo de recetas.</div>}
      {loadState === 'ready' && !plan && <div className="result-empty panel"><span>◌</span><h3>No hay un plan en borrador</h3><p>Crea un plan para {patientName} antes de distribuir recetas.</p><button className="primary" disabled={createPlanState === 'creating'} onClick={() => createPlan()}>{createPlanState === 'creating' ? 'Creando…' : 'Crear plan'}</button>{createPlanState === 'error' && <div className="form-error">⚠ No se pudo crear el plan.</div>}</div>}
      {loadState === 'ready' && plan && <>
        <nav className="dist-nav" aria-label="Secciones de Distribuye">{DIST_SECTIONS.map(([id, label]) => <button type="button" key={id} className={distSection === id ? 'active' : ''} onClick={() => goToSection(id)}>{label}{id === 'dist-week' && <small>{DAYS.reduce((sum, day) => sum + visibleMeals.filter((meal) => slots[slotKey(day.n, meal.key)]).length, 0)}/{visibleMeals.length * DAYS.length}</small>}</button>)}</nav>
        {renderMenuTabs()}
        {activeMenu && currentMenuDays.length === 0 && <div className="eq-notice">“{activeMenu.name}” todavía no tiene días: márcalos arriba (o en la fila de días de la sección Tiempo) para poder llenarlo con recetas.</div>}
        <div id="dist-portions" className="dist-anchor" />
        <DistributeMatrix value={currentEquivalents} onChange={setCurrentEquivalents} meals={visibleMeals} hiddenMeals={hiddenMeals} mealTimes={notesForm.mealTimes} suggestedTimes={Object.fromEntries(visibleMeals.map((meal) => [meal.key, notesForm.mealTimes?.[meal.key] ? null : mealSuggestion.times[meal.key]]))} locked={planLocked} recipesFor={(key) => mealRecipes(key, currentMenuDays)} renderThumb={recipeThumb} adjustedCount={(key) => mealRecipes(key, currentMenuDays).filter((recipe) => notesForm.recipeAdjustments?.[adjustmentKey(key, recipe.id)]).length} mealRecipeKcal={(key) => averageKcalForMeal(key, currentMenuDays)} servingsFor={mealServingsFor} onServings={changeServings} onViewRecipes={(meal) => setSuggestMeal(meal)} onAdjust={(meal) => setAdjustMeal(meal)} onRenameMeal={renameMeal} onRemoveMeal={removeMeal} onAddMeal={addMeal} onTimeChange={(key, time) => updateNotes('mealTimes', { ...notesForm.mealTimes, [key]: time })} onDistribute={distributeCurrent} onGoToPortions={() => selectStep(STEP.EQUIVALENTS)} />
        <div id="dist-adequacy" className="dist-anchor" />
        {renderAdequacy()}
        <section className="panel tg-panel" id="dist-week">
          <div className="dm-title"><div><h3>Tiempo</h3><small className="muted">Las preparaciones de cada día. Toca una celda para cambiarla por otra de las recetas elegidas{extraMenus.length ? '; con el menú de cada día eliges qué cuadro de porciones le toca' : ''}.</small></div></div>
          <div className="dm-scroll"><div className="tg-table">
            <div className="tg-row tg-head"><span>Tiempo</span>{DAYS.map((day) => <div key={day.n}><b>{day.label}</b>{extraMenus.length > 0 && <select value={menuOfDay(day.n)?.id || 'base'} disabled={planLocked} onChange={(event) => (event.target.value === 'base' ? setDayMenu(day.n, null) : setDayMenu(day.n, event.target.value))} aria-label={`Menú del ${day.label}`}><option value="base">Menú base</option>{extraMenus.map((menu) => <option value={menu.id} key={menu.id}>{menu.name}</option>)}</select>}</div>)}</div>
            {visibleMeals.map((meal) => <div className="tg-row" key={meal.key}><span>{meal.label}</span>{DAYS.map((day) => { const recipe = recipeById(slots[slotKey(day.n, meal.key)]); return <button type="button" className={'tg-cell' + (recipe ? '' : ' empty')} key={day.n} disabled={planLocked && !recipe} onClick={() => setDayPick({ meal, day: day.n })} title={recipe ? `${recipe.name} · ${day.label}` : `Elegir ${meal.label} del ${day.label}`}>
              {recipe ? <>{recipeThumb(recipe, day.n, 'tg-photo')}<small>{recipe.name}</small>{notesForm.recipeAdjustments?.[adjustmentKey(meal.key, recipe.id)] && <i className="tg-adjusted" title="Con cantidades ajustadas para este plan">ajustada</i>}</> : <><span className="tg-plus" aria-hidden="true">+</span><small>{planLocked ? 'Sin receta' : 'Elegir receta'}</small></>}
            </button> })}</div>)}
            <div className="tg-row tg-foot"><span>Macros y micros</span>{DAYS.map((day) => <button type="button" className="secondary" key={day.n} onClick={() => setDayInfo(day.n)}>Ver para {day.label}</button>)}</div>
          </div></div>
        </section>
    {<div className="panel adequacy-panel" id="dist-micros">
      <h3>% Adecuación de micronutrientes</h3>
      {adequacyState === 'loading' && <p className="muted">Calculando…</p>}
      {adequacyState === 'error' && <div className="form-error">⚠ No se pudo calcular la adecuación de micronutrientes.</div>}
      {adequacyState === 'ready' && !adequacy?.bracket && <p className="muted">Calcula y guarda el requerimiento en el paso "Dietocálculo" para poder calcular la adecuación. <button type="button" className="link-button" onClick={() => selectStep(1)}>Ir al cálculo →</button></p>}
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
        <div className="optionals" id="dist-optionals">
          <p className="eyebrow">OPCIONALES · LOS VE LA PACIENTE EN SU PLAN</p>
          <span className="saved">{planLocked ? '● Sólo lectura' : notesSaveState === 'saving' ? '● Guardando…' : notesSaveState === 'editing' ? '● Editando…' : notesSaveState === 'error' ? '⚠ Error al guardar' : '● Guardado'}</span>
          <details className="panel optional-block" open>
            <summary>Consumo de agua</summary>
            {planWeightKg && !planLocked && <div className="water-helper"><b>{waterLiters ? `${Math.round(waterLiters * 4)} vasos (${waterLiters.toFixed(2)} L) al día` : 'Escribe los ml por kg'}</b><span><input type="number" min="10" max="80" step="1" value={waterMlPerKg} onChange={(e) => setWaterMlPerKg(e.target.value)} aria-label="Mililitros de agua por kilogramo" /> ml/kg</span><small className="muted">Se calcula con el peso de la paciente ({planWeightKg} kg).</small><button type="button" className="secondary" disabled={!waterLiters} onClick={applyWater}>Usar en el plan</button></div>}
            <textarea placeholder="Ej. 8 vasos (2 L) de agua natural al día" value={notesForm.hydrationNote} onChange={(e) => updateNotes('hydrationNote', e.target.value)} disabled={planLocked} aria-label="Consumo de agua" />
          </details>
          <details className="panel optional-block" open>
            <summary>Recomendaciones</summary>
            <label>Recomendaciones generales<textarea className="wide-textarea" placeholder="Añade recomendaciones, educación o suplementos..." value={notesForm.recommendations} onChange={(e) => updateNotes('recommendations', e.target.value)} disabled={planLocked} /></label>
            {!planLocked && <button type="button" className="link-button" onClick={() => updateNotes('recommendations', buildExpedienteRecommendations(plan))}>Tomar del expediente</button>}
            <div className="optional-meals">{visibleMeals.map((meal) => <label key={meal.key}>Recomendaciones para {meal.label.toLowerCase()}<textarea placeholder="Ingresa aquí tu recomendación" value={notesForm.mealNotes?.[meal.key] || ''} onChange={(e) => updateNotes('mealNotes', { ...(notesForm.mealNotes || {}), [meal.key]: e.target.value })} disabled={planLocked} /></label>)}</div>
          </details>
        </div>
      </>}
      {adjustMeal && <RecipeAdjustModal meal={adjustMeal} recipes={mealRecipes(adjustMeal.key, currentMenuDays)} servings={mealServingsFor(adjustMeal.key)} adjustments={notesForm.recipeAdjustments} prescribed={currentEquivalents?.distribution?.[adjustMeal.key]} locked={planLocked} onSave={(recipeId, adjustment) => saveAdjustment(adjustMeal.key, recipeId, adjustment)} onClose={() => setAdjustMeal(null)} />}
      {suggestMeal && <RecipeSuggestModal meal={suggestMeal} recipes={recipes} target={suggestTarget} prescribed={currentEquivalents?.distribution?.[suggestMeal.key]} servings={mealServingsFor(suggestMeal.key)} initialAvoid={suggestAvoid} exclude={suggestExclude} current={mealRecipes(suggestMeal.key, currentMenuDays).map((recipe) => recipe.id)} adjustments={notesForm.recipeAdjustments} days={currentMenuDays.length || 7} menuName={extraMenus.length ? currentMenuName : null} renderThumb={recipeThumb} locked={planLocked || !currentMenuDays.length} onApply={(picks) => applySuggestions(suggestMeal, picks)} onClose={() => setSuggestMeal(null)} onGoToCalculation={() => { setSuggestMeal(null); selectStep(STEP.CALCULATION) }} />}
      {dayPick && (() => {
        const options = mealRecipes(dayPick.meal.key, sameMenuDays(dayPick.day))
        const others = mealRecipes(dayPick.meal.key).filter((recipe) => !options.some((option) => option.id === recipe.id))
        const current = slots[slotKey(dayPick.day, dayPick.meal.key)]
        const dayLabel = DAYS.find((day) => day.n === dayPick.day)?.label
        const pick = (recipe, i) => <button type="button" className={'recipe-pick' + (recipe.id === current ? ' selected' : '')} key={recipe.id} disabled={planLocked} onClick={() => setDaySlot(dayPick.meal.key, dayPick.day, recipe.id)}>{recipeThumb(recipe, i)}<b>{recipe.name}</b><small>{Math.round((Number(effectiveNutrition(recipe).kcal) || 0) * mealServingsFor(dayPick.meal.key) * factorFor(dayPick.meal.key, recipe.id))} kcal{recipe.id === current ? ' · actual' : ''}</small></button>
        return <div className="recipe-overlay" {...backdropClose(() => setDayPick(null))}><div className="recipe-modal panel day-pick-modal">
          <div className="modal-head"><div><p className="eyebrow">{dayPick.meal.label.toUpperCase()} · {dayLabel?.toUpperCase()}{extraMenus.length ? ` · ${(menuOfDay(dayPick.day)?.name || 'Menú base').toUpperCase()}` : ''}</p><h2>Elige la preparación del día</h2></div><button onClick={() => setDayPick(null)}>×</button></div>
          {options.length === 0 && others.length === 0 && <p className="muted">Todavía no hay recetas elegidas para {dayPick.meal.label.toLowerCase()}. Elígelas con “Ver recetas” en la tabla de arriba, o busca una en el catálogo.</p>}
          {options.length > 0 && <div className="recipe-picker-grid">{options.map(pick)}</div>}
          {others.length > 0 && <><p className="eyebrow">DE OTROS MENÚS</p><div className="recipe-picker-grid">{others.map(pick)}</div></>}
          {!planLocked && <div className="modal-actions">{current && <button type="button" className="link-button" onClick={() => { clearSlot(dayPick.meal.key, dayPick.day); setDayPick(null) }}>Dejar el día sin receta</button>}<button type="button" className="secondary" onClick={() => { const target = dayPick; setDayPick(null); openPicker(target.meal.key, target.day) }}>Buscar en todo el catálogo</button></div>}
        </div></div>
      })()}
      {dayInfo && (() => {
        const { totals, rows } = dayNutrition(dayInfo)
        const menu = menuOfDay(dayInfo)
        const targetKcal = plan?.targetKcal != null ? Number(plan.targetKcal) + (Number(menu?.kcalDelta) || 0) : null
        const target = targetKcal ? macroTargets({ kcal: targetKcal, carbsPercent: plan.carbsPercent, proteinPercent: plan.proteinPercent, fatPercent: plan.fatPercent }) : null
        const micros = MICROS.filter(([key]) => totals[key] > 0)
        const percent = (value, goal) => (goal ? `${Math.round((value / goal) * 100)}%` : '')
        return <div className="modal-backdrop" {...backdropClose(() => setDayInfo(null))}><div className="modal day-info-modal">
          <div className="modal-head"><div><p className="eyebrow">MACROS Y MICROS{extraMenus.length ? ` · ${(menu?.name || 'Menú base').toUpperCase()}` : ''}</p><h2>{DAYS.find((day) => day.n === dayInfo)?.label}</h2><span className="modal-subtitle">{rows.length ? `${rows.length} tiempo${rows.length === 1 ? '' : 's'} con receta` : 'Este día no tiene recetas.'}</span></div><button onClick={() => setDayInfo(null)}>×</button></div>
          {rows.length > 0 && <>
            <div className="day-info-macros">{[['kcal', 'Energía', 'kcal'], ['carbs', 'HCO', 'g'], ['protein', 'Proteína', 'g'], ['fat', 'Grasas', 'g']].map(([key, label, unit]) => <div key={key}><small>{label}</small><b>{Math.round(totals[key])} {unit}</b>{target && <span className={Math.abs(totals[key] / target[key] - 1) <= 0.1 ? 'ok' : 'off'}>{percent(totals[key], target[key])} de {Math.round(target[key])}</span>}</div>)}</div>
            <ul className="day-info-meals">{rows.map((row) => <li key={row.meal.key}><small>{row.meal.label}</small><b>{row.recipe.name}</b><span>{row.kcal} kcal</span></li>)}</ul>
            {micros.length > 0 ? <><p className="eyebrow">MICRONUTRIMENTOS</p><dl className="day-info-micros">{micros.map(([key, label, unit]) => <div key={key}><dt>{label}</dt><dd>{Math.round(totals[key] * 10) / 10} {unit}</dd></div>)}</dl></> : <p className="muted">Las recetas de este día no traen micronutrimentos en el catálogo.</p>}
          </>}
        </div></div>
      })()}
      {renderPicker()}
    </>}

    {step === STEP.DELIVERY && <DocumentPage key={`${plan?.id}-${plan?.status === 'CANCELLED'}`} setActive={setActive} patientId={activePatientId} planId={plan?.id || null} embedded onPublished={handlePublished} />}

    </div>

    <div className="wizard-footer"><button className="secondary" onClick={() => selectStep(Math.max(0, step - 1))}>← Anterior</button><span>{combinedSave === 'saving' ? 'Guardando…' : combinedSave === 'error' ? <>Error al guardar los últimos cambios · <button type="button" className="link-button" onClick={retrySave}>Reintentar</button></> : combinedSave === 'locked' ? (plan?.status === 'CANCELLED' ? 'Plan cancelado · sólo lectura' : 'Plan publicado · sólo lectura') : 'Guardado automáticamente'}</span><button className="primary" style={step === STEP.DELIVERY ? { visibility: 'hidden' } : undefined} disabled={step === STEP.DELIVERY} onClick={() => selectStep(Math.min(step + 1, STEP.DELIVERY))}>Siguiente <span>→</span></button></div>
  </>}
  </div>
  {renderPreviewModal()}
  </AppChrome>
}
