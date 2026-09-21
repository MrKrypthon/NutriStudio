import { useCallback, useEffect, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import DocumentPage from '../documents/DocumentPage.jsx'
import { clinicalApi, nutritionApi, patientsApi, plansApi, recipesApi } from '../../lib/api.js'
import { usePatient } from '../../lib/usePatient.js'

const sexToFormValue = (sex) => (sex && sex.toLowerCase().startsWith('m') ? 'male' : 'female')
const computeAge = (birthDate) => {
  if (!birthDate) return ''
  const dob = new Date(birthDate)
  const now = new Date()
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age -= 1
  return String(age)
}
const formatUTCDate = (iso) => { if (!iso) return null; const d = new Date(iso); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}` }

const MEAL_TYPES = [
  { key: 'breakfast', label: 'Desayuno' },
  { key: 'lunch', label: 'Comida' },
  { key: 'snack', label: 'Colación' },
  { key: 'dinner', label: 'Cena' },
]
const DAYS = [
  { n: 1, label: 'Lunes' },
  { n: 2, label: 'Martes' },
  { n: 3, label: 'Miércoles' },
  { n: 4, label: 'Jueves' },
  { n: 5, label: 'Viernes' },
  { n: 6, label: 'Sábado' },
  { n: 7, label: 'Domingo' },
]
const RECIPE_COLORS = ['coral', 'blue', 'yellow', 'purple']
const NUTRIENT_CHIPS = [['kcal', 'Energía', 'kcal'], ['protein', 'Proteína', 'g'], ['carbs', 'Carbohidratos', 'g'], ['fat', 'Grasas', 'g'], ['fiber', 'Fibra', 'g']]
const slotKey = (day, mealType) => `${day}:${mealType}`

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
  const steps = ['Evaluación', 'Plan alimentario', 'Distribución', 'Semana', 'Entrega']

  const [patients, setPatients] = useState([])
  const [loadState, setLoadState] = useState('loading')
  const [plan, setPlan] = useState(null)
  const [recipes, setRecipes] = useState([])
  const [slots, setSlots] = useState({})
  const [saveState, setSaveState] = useState('idle')
  const [pickerTarget, setPickerTarget] = useState(null)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerRestriction, setPickerRestriction] = useState('')
  const [pickerDetail, setPickerDetail] = useState(null)
  const [pickerNutrition, setPickerNutrition] = useState(null)
  const [adequacy, setAdequacy] = useState(null)
  const [adequacyState, setAdequacyState] = useState('idle')
  const [form, setForm] = useState({ sex: 'female', age: '', weightKg: '', heightCm: '', bodyFatPercent: '', formula: 'mifflin', activityFactor: '1.375', goal: '', carbsPercent: '50', proteinPercent: '25', fatPercent: '25' })
  const [calcResult, setCalcResult] = useState(null)
  const [calcState, setCalcState] = useState('idle')
  const [calcError, setCalcError] = useState('')
  const [evalSaveState, setEvalSaveState] = useState('idle')
  const [evalSaveError, setEvalSaveError] = useState('')
  const [createPlanState, setCreatePlanState] = useState('idle')
  const [plans, setPlans] = useState([])
  const [view, setView] = useState('list')
  const [planActionState, setPlanActionState] = useState('idle')
  const [previewPlan, setPreviewPlan] = useState(null)
  const [notesForm, setNotesForm] = useState({ hydrationNote: '', recommendations: '' })
  const [notesSaveState, setNotesSaveState] = useState('idle')
  const notesSaveTimer = useRef(null)
  const notesPendingRef = useRef(null)
  // Distribution saves are full-snapshot PUTs; two rapid edits used to overlap and the older
  // snapshot could land last and silently drop the newest slot. Serialize: keep only the latest
  // snapshot queued, one request in flight at a time, and re-flush whatever arrived meanwhile.
  const slotsInFlightRef = useRef(false)
  const slotsDirtyRef = useRef(null)
  const flushPromiseRef = useRef(null)
  // Al abrir un plan desde el hub, la recarga de datos del paciente no debe reiniciar la vista a
  // la lista (eso pisaba al wizard que abre openPlan). El ref lo evita mientras se abre.
  const skipViewResetRef = useRef(false)

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

  useEffect(() => {
    if (!plan) return
    setForm((prev) => ({
      ...prev,
      goal: plan.goal || prev.goal,
      carbsPercent: plan.carbsPercent != null ? String(plan.carbsPercent) : prev.carbsPercent,
      proteinPercent: plan.proteinPercent != null ? String(plan.proteinPercent) : prev.proteinPercent,
      fatPercent: plan.fatPercent != null ? String(plan.fatPercent) : prev.fatPercent,
    }))
    setNotesForm({ hydrationNote: plan.hydrationNote || '', recommendations: plan.recommendations || '' })
  }, [plan?.id])

  const loadPlanData = useCallback(async () => {
    try {
      const [plansResponse, recipesResponse, consultationsResponse] = await Promise.all([patientsApi.plans(activePatientId), recipesApi.list(), patientsApi.consultations(activePatientId)])
      const planItems = plansResponse.items || []
      // El plan "activo" editable es el borrador (o listo); nunca un cancelado/publicado.
      const activePlan = planItems.find((item) => item.status === 'DRAFT') || planItems.find((item) => item.status === 'READY') || null
      setPlans(planItems)
      const initialSlots = {}
      const activeRecipeIds = new Set((recipesResponse.items || []).map((r) => r.id))
      // Drop slots that reference archived/unknown recipes so they don't linger as invisible rows.
      for (const slot of activePlan?.mealSlots || []) if (activeRecipeIds.has(slot.recipeId)) initialSlots[slotKey(slot.dayOfWeek, slot.mealType)] = slot.recipeId
      // Preload weight/height from real sources, never from arbitrary demo values: the last
      // saved calculation wins, then the patient's latest clinical measurement, then empty
      // fields the professional must fill. Before this fix, 72.4 kg / 165 cm were hardcoded
      // defaults that got persisted as if they were the patient's real anthropometry.
      const latestMeasurement = (consultationsResponse.items || [])
        .flatMap((c) => c.measurements || [])
        .sort((a, b) => new Date(b.measuredAt) - new Date(a.measuredAt))[0]
      const savedInputs = activePlan?.evaluation?.inputs || {}
      const weightKg = savedInputs.weightKg ?? latestMeasurement?.weightKg ?? ''
      const heightCm = savedInputs.heightCm ?? latestMeasurement?.heightCm ?? ''
      setForm((prev) => ({
        ...prev,
        sex: savedInputs.sex ?? prev.sex,
        age: savedInputs.age != null ? String(savedInputs.age) : prev.age,
        bodyFatPercent: savedInputs.bodyFatPercent != null ? String(savedInputs.bodyFatPercent) : prev.bodyFatPercent,
        formula: activePlan?.formula ?? prev.formula,
        weightKg: weightKg !== '' && weightKg != null ? String(weightKg) : '',
        heightCm: heightCm !== '' && heightCm != null ? String(heightCm) : '',
      }))
      setPlan(activePlan)
      setRecipes(recipesResponse.items || [])
      setSlots(initialSlots)
      // Si venimos de "Asignar al plan" (pendingRecipeName), abrir directo el paso Distribución;
      // si no, mostrar primero el listado de planes por estado.
      if (pendingRecipeName) { setView('wizard'); setStep(2) } else if (!skipViewResetRef.current) { setView('list') }
      skipViewResetRef.current = false
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePatientId])

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
  // After publishing in step 4 (Entrega), the local `plan` is stale (still DRAFT); re-fetch so the
  // wizard reflects that there's no draft anymore instead of failing edits with PLAN_LOCKED.
  const prevStepRef = useRef(step)
  useEffect(() => {
    if (prevStepRef.current === 4 && step < 4) loadPlanData()
    prevStepRef.current = step
  }, [step, loadPlanData])

  const recipeById = (id) => recipes.find((recipe) => recipe.id === id)

  // RF-07 macro distribution: percentages the professional can adjust; they must sum to 100 and
  // map to grams against the calculated requirement.
  const macroSum = Number(form.carbsPercent || 0) + Number(form.proteinPercent || 0) + Number(form.fatPercent || 0)
  const macroGrams = (pct, factor) => (calcResult?.get ? Math.round((calcResult.get * (Number(pct) || 0)) / 100 / factor) : null)
  // Cunningham / Katch-McArdle compute BMR from lean mass (needs body fat); without an input they
  // silently fall back to total mass and inflate the requirement — so the field is only shown and
  // only required meaningfully for those two formulas.
  const needsBodyFat = form.formula === 'cunningham' || form.formula === 'katch-mcardle'

  const updateForm = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const calculate = async (event) => {
    event.preventDefault()
    setCalcState('loading')
    setCalcError('')
    setEvalSaveState('idle')
    try {
      const response = await nutritionApi.calculate(form)
      setCalcResult(response)
      setCalcState('success')
    } catch (error) {
      setCalcState('error')
      setCalcError(error.message || 'No se pudo calcular. Verifica que el API esté activo.')
    }
  }

  const saveToPlan = async () => {
    if (!plan) return
    setEvalSaveState('saving')
    setEvalSaveError('')
    try {
      const updated = await plansApi.evaluate(plan.id, { ...form, carbsPercent: Number(form.carbsPercent) || 50, proteinPercent: Number(form.proteinPercent) || 25, fatPercent: Number(form.fatPercent) || 25 })
      setPlan(updated)
      setEvalSaveState('saved')
    } catch (error) {
      setEvalSaveState('error')
      setEvalSaveError(error.message || 'No se pudo guardar el plan.')
    }
  }

  const updateNotes = (key, value) => {
    const next = { ...notesForm, [key]: value }
    setNotesForm(next)
    if (!plan) return
    setNotesSaveState('editing')
    // Keep the latest payload for the unmount flush (a navigation within the 800ms window must
    // not drop the edit on the floor).
    notesPendingRef.current = { planId: plan.id, next }
    clearTimeout(notesSaveTimer.current)
    notesSaveTimer.current = setTimeout(async () => {
      setNotesSaveState('saving')
      try {
        const updated = await plansApi.update(plan.id, next)
        setPlan(updated)
        setNotesSaveState('saved')
        notesPendingRef.current = null
      } catch {
        setNotesSaveState('error')
      }
    }, 800)
  }

  const createPlan = async (pid) => {
    const targetId = pid || activePatientId
    if (!targetId) return
    setCreatePlanState('creating')
    try {
      const consultationsResponse = await patientsApi.consultations(targetId)
      let consultation = (consultationsResponse.items || []).find((item) => item.status === 'IN_PROGRESS')
      if (!consultation) consultation = await clinicalApi.create(targetId, {})
      const created = await plansApi.create(targetId, { consultationId: consultation.id })
      setPlan(created)
      setSlots({})
      setMode('patient')
      setView('wizard')
      setStep(1)
      setCreatePlanState('idle')
      loadHub()
    } catch {
      setCreatePlanState('error')
    }
  }

  // Abre un plan desde el listado: los borradores/listos continúan en el wizard; los
  // publicados/reemplazados/cancelados se ven con el menú congelado (solo lectura).
  const openPlan = async (item) => {
    if (!item) return
    setPlanActionState(item.id)
    try {
      const full = await plansApi.get(item.id)
      if (full.status === 'DRAFT' || full.status === 'READY') {
        const nextSlots = {}
        for (const slot of full.mealSlots || []) nextSlots[slotKey(slot.dayOfWeek, slot.mealType)] = slot.recipeId
        const savedInputs = full.evaluation?.inputs || {}
        setPlan(full)
        setSlots(nextSlots)
        setForm((prev) => ({
          ...prev,
          sex: savedInputs.sex ?? prev.sex,
          age: savedInputs.age != null ? String(savedInputs.age) : prev.age,
          bodyFatPercent: savedInputs.bodyFatPercent != null ? String(savedInputs.bodyFatPercent) : prev.bodyFatPercent,
          formula: full.formula ?? prev.formula,
          goal: full.goal || prev.goal,
          carbsPercent: full.carbsPercent != null ? String(full.carbsPercent) : prev.carbsPercent,
          proteinPercent: full.proteinPercent != null ? String(full.proteinPercent) : prev.proteinPercent,
          fatPercent: full.fatPercent != null ? String(full.fatPercent) : prev.fatPercent,
          weightKg: savedInputs.weightKg != null ? String(savedInputs.weightKg) : prev.weightKg,
          heightCm: savedInputs.heightCm != null ? String(savedInputs.heightCm) : prev.heightCm,
        }))
        setNotesForm({ hydrationNote: full.hydrationNote || '', recommendations: full.recommendations || '' })
        setStep(0)
        setView('wizard')
      } else {
        setPreviewPlan(full)
      }
    } catch { /* la lista queda como estaba */ } finally { setPlanActionState('idle') }
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
      skipViewResetRef.current = true
      // Seguridad por si el paciente ya era el activo (loadPlanData no se re-ejecutaría y el ref
      // quedaría pegado). loadPlanData lo consume al terminar.
      setTimeout(() => { skipViewResetRef.current = false }, 2500)
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
    setActivePatientId(pid)
    setMode('patient')
    createPlan(pid)
  }

  const persistSlots = (nextSlots) => {
    slotsDirtyRef.current = nextSlots
    if (!plan) return
    // Serialize saves (see the refs above) and share the in-flight promise so navigation to the
    // Entrega step can AWAIT the final menu instead of showing a stale snapshot.
    if (!flushPromiseRef.current) flushPromiseRef.current = flushEverything().finally(() => { flushPromiseRef.current = null })
  }

  const flushEverything = async () => {
    const activeIds = new Set(recipes.map((recipe) => recipe.id))
    // Loop until both the queue and the in-flight request are empty (new edits land while one
    // save is pending are picked up on the next pass, so the LAST snapshot always wins).
    while (slotsDirtyRef.current || slotsInFlightRef.current) {
      if (slotsDirtyRef.current && !slotsInFlightRef.current) {
        const snapshot = slotsDirtyRef.current
        slotsDirtyRef.current = null
        slotsInFlightRef.current = true
        setSaveState('saving')
        const payload = Object.entries(snapshot)
          .filter(([, recipeId]) => recipeId && activeIds.has(recipeId))
          .map(([key, recipeId]) => {
            const [day, mealType] = key.split(':')
            return { dayOfWeek: Number(day), mealType, recipeId, servings: 1 }
          })
        try {
          const updated = await plansApi.saveDistribution(plan.id, payload)
          setPlan(updated)
          setSaveState('saved')
        } catch {
          setSaveState('error')
        } finally {
          slotsInFlightRef.current = false
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
    }
  }

  const selectStep = async (next) => {
    // Entering Entrega must see the final menu: flush any pending distribution save first.
    if (next === 4 && plan && (slotsDirtyRef.current || slotsInFlightRef.current)) {
      if (!flushPromiseRef.current) flushPromiseRef.current = flushEverything().finally(() => { flushPromiseRef.current = null })
      await flushPromiseRef.current
    }
    setStep(next)
  }

  const openPicker = (mealType, day = null) => { setPickerSearch(pendingRecipeName || ''); setPickerRestriction(''); setPickerDetail(null); if (pendingRecipeName) onConsumeRecipeName?.(); setPickerTarget({ mealType, day }) }
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
    if (!pickerTarget) return
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
    setSlots(nextSlots)
    setPickerTarget(null)
    setPickerDetail(null)
    persistSlots(nextSlots)
  }

  const clearSlot = (mealType, day) => {
    const nextSlots = { ...slots }
    delete nextSlots[slotKey(day, mealType)]
    setSlots(nextSlots)
    persistSlots(nextSlots)
  }

  useEffect(() => {
    if (step !== 3 || !plan) return
    let cancelled = false
    setAdequacyState('loading')
    plansApi.adequacy(plan.id)
      .then((response) => { if (!cancelled) { setAdequacy(response); setAdequacyState('ready') } })
      .catch(() => { if (!cancelled) setAdequacyState('error') })
    return () => { cancelled = true }
  }, [step, plan])

  const averageKcalForMeal = (mealType) => {
    const assigned = DAYS.map((day) => recipeById(slots[slotKey(day.n, mealType)])).filter(Boolean)
    if (!assigned.length) return null
    const total = assigned.reduce((sum, recipe) => sum + (recipe.nutrition?.kcal || 0), 0)
    return Math.round(total / assigned.length)
  }

  // Imported cookbook recipes have real photos (`imageFile`); handmade ones keep the color block.
  const recipeThumb = (recipe, index, className = 'recipe-image') => {
    if (recipe?.imageFile) return <div className={className + ' has-photo'}><img src={recipesApi.imageUrl(recipe.imageFile)} alt={recipe.name} loading="lazy" /></div>
    return <div className={className + ' ' + RECIPE_COLORS[index % RECIPE_COLORS.length]}><span>✦</span></div>
  }

  const pickerRecipes = pickerTarget
    ? recipes
        .filter((recipe) => (recipe.mealTypes || []).length === 0 || recipe.mealTypes.includes(pickerTarget.mealType))
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
          <div className="recipe-detail-nutrition">{NUTRIENT_CHIPS.map(([key, label, unit]) => <div key={key}><small>{label}</small><b>{pickerDetail.nutrition?.[key] != null ? Math.round(Number(pickerDetail.nutrition[key]) * 10) / 10 : '—'} <em>{unit}</em></b></div>)}</div>
          <p className="eyebrow">INGREDIENTES</p>
          {pickerNutrition?.state === 'loading' && <p className="muted">Cargando ingredientes…</p>}
          {pickerNutrition?.state === 'error' && <p className="muted">No se pudieron cargar los ingredientes.</p>}
          {pickerNutrition?.state === 'ready' && (pickerNutrition.ingredients?.length
            ? <div className="recipe-detail-ingredients">{pickerNutrition.ingredients.map((item, index) => <div key={index}><span>{item.name}</span><b>{item.quantity} {item.unit}</b></div>)}</div>
            : <p className="muted">Esta receta es del recetario importado (lleva ingredientes en texto libre).</p>)}
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setPickerDetail(null)}>Volver</button><button type="button" className="primary" onClick={() => chooseRecipe(pickerDetail)}>Elegir esta receta</button></div>
        </div>
      : <>
          <div className="picker-filters">
            <div className="recipe-search"><input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Buscar receta..." /></div>
            <select value={pickerRestriction} onChange={(e) => setPickerRestriction(e.target.value)}><option value="">Todas las restricciones</option>{availableRestrictions.map((restriction) => <option value={restriction} key={restriction}>{restriction}</option>)}</select>
          </div>
          <div className="recipe-picker-grid">{pickerRecipes.length === 0 && <p className="muted">No hay recetas para este filtro.</p>}{pickerRecipes.map((recipe, i) => <button className="recipe-pick" onClick={() => setPickerDetail(recipe)} key={recipe.id}>{recipeThumb(recipe, i)}<b>{recipe.name}</b><small>{Math.round(recipe.nutrition?.kcal || 0)} kcal · ver detalle</small></button>)}</div>
        </>}
  </div></div> : null

  const meals = MEAL_TYPES.map((m) => m.label)

  const menuEntryFor = (source, day, meal) => (source || []).find((entry) => entry.dayOfWeek === day && entry.mealType === meal)
  const renderMenuPreview = (sourcePlan) => {
    const menu = sourcePlan.menuSnapshot?.length ? sourcePlan.menuSnapshot : sourcePlan.mealSlots || []
    return <div className="menu-preview-table">
      <div className="menu-preview-head"><span>Tiempo</span>{DAYS.map((day) => <b key={day.n}>{day.label.slice(0, 3)}</b>)}</div>
      {MEAL_TYPES.map((meal) => <div className="menu-preview-row" key={meal.key}><span>{meal.label}</span>{DAYS.map((day) => { const entry = menuEntryFor(menu, day.n, meal.key); const name = entry?.recipeName || (entry?.recipeId ? recipeById(entry.recipeId)?.name : null); return <div className="menu-preview-cell" key={day.n}>{name ? <>{name}{entry?.kcal ? <small>{Math.round(entry.kcal)} kcal</small> : null}</> : <small className="muted">—</small>}</div> })}</div>)}
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

  if (mode === 'hub') return renderHub()

  const renderPlansOverview = () => {
    const groups = [
      ['Pendientes', plans.filter((item) => item.status === 'DRAFT' || item.status === 'READY')],
      ['Realizados', plans.filter((item) => item.status === 'PUBLISHED' || item.status === 'SUPERSEDED')],
      ['Cancelados', plans.filter((item) => item.status === 'CANCELLED')],
    ]
    return <div className="plans-overview">
      <div className="plans-overview-head"><div><p className="eyebrow">PLANIFICACIÓN · PLANES</p><h1>Planes de {patientName}</h1><p className="subtitle">Retoma un borrador donde lo dejaste o revisa los planes anteriores.</p></div><button className="primary" onClick={createPlan} disabled={createPlanState === 'creating'}><span>+</span> {createPlanState === 'creating' ? 'Creando…' : 'Nuevo plan'}</button></div>
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

    {plan?.consultation && (consultationReason(plan) || plan.consultation.diagnoses?.length > 0) && <div className="form-card plan-context-card">
      <p className="eyebrow">DE LA CONSULTA · {plan.consultation.diagnoses?.length || 0} diagnóstico(s)</p>
      {consultationReason(plan) && <p className="plan-context-reason"><b>Motivo:</b> {consultationReason(plan)}</p>}
      {plan.consultation.diagnoses?.length > 0 && <div className="plan-context-diagnoses">{plan.consultation.diagnoses.map((diagnosis) => <span key={diagnosis.id}><b>{diagnosis.domain}</b> {diagnosis.problem}</span>)}</div>}
    </div>}

    {step === 0 && <><ModuleHeader eyebrow="EVALUACIÓN NUTRICIONAL" title="Datos y objetivos" subtitle="Resumen del expediente y del último cálculo guardado en el paso Plan alimentario." action={<button className="secondary" onClick={() => selectStep(1)}>Ir al cálculo →</button>} /><div className="plan-grid"><div className="plan-card panel"><h3>Datos antropométricos</h3><div className="form-grid three"><label>Sexo<input value={patient?.sex || '—'} readOnly /></label><label>Fecha nacimiento<input value={formatUTCDate(patient?.birthDate) || '—'} readOnly /></label><label>Edad<input value={computeAge(patient?.birthDate) ? `${computeAge(patient.birthDate)} años` : '—'} readOnly /></label><label>Peso actual<input value={plan?.evaluation?.inputs?.weightKg ? `${plan.evaluation.inputs.weightKg} kg` : '—'} readOnly /></label><label>Talla<input value={plan?.evaluation?.inputs?.heightCm ? `${plan.evaluation.inputs.heightCm} cm` : '—'} readOnly /></label><label>IMC calculado<input value={plan?.evaluation?.bmi ?? '—'} readOnly /></label></div></div><div className="plan-card panel ideal-card"><h3>Rangos de peso ideal <span>ⓘ</span></h3>{plan?.evaluation?.idealWeightRange ? <div className="ideal-number">{plan.evaluation.idealWeightRange.minKg} <small>– {plan.evaluation.idealWeightRange.maxKg} kg</small></div> : <p className="muted">Calcula el requerimiento en el paso "Plan alimentario" para ver el rango.</p>}<p className="muted">Rango estimado para su estatura</p></div><div className="plan-card panel full"><h3>Objetivo terapéutico</h3>{plan?.goal ? <p>{plan.goal}</p> : <p className="muted">Sin definir todavía — se guarda junto con el cálculo en el paso "Plan alimentario".</p>}</div></div></>}

    {step === 1 && <><ModuleHeader eyebrow="PLAN ALIMENTARIO · REQUERIMIENTO" title="Calcula el punto de partida" subtitle="Cada resultado queda asociado a la fórmula y a los datos utilizados." /><form className="calculator-layout" onSubmit={calculate}><section className="panel calculator-form"><div className="section-heading"><div><h2>Datos de la paciente</h2><p className="subtitle">Puedes ajustar estos valores para simular el plan.</p></div></div><div className="form-grid three"><label>Sexo<select value={form.sex} onChange={(e) => updateForm('sex', e.target.value)}><option value="female">Femenino</option><option value="male">Masculino</option></select></label><label>Edad (años)<input type="number" min="1" max="120" value={form.age} onChange={(e) => updateForm('age', e.target.value)} /></label><label>Peso (kg)<input type="number" step="0.1" min="1" value={form.weightKg} onChange={(e) => updateForm('weightKg', e.target.value)} /></label><label>Talla (cm)<input type="number" step="0.1" min="30" value={form.heightCm} onChange={(e) => updateForm('heightCm', e.target.value)} /></label><label>Fórmula energética<select value={form.formula} onChange={(e) => updateForm('formula', e.target.value)}><option value="mifflin">Mifflin-St Jeor</option><option value="harris">Harris-Benedict</option><option value="schofield">FAO/OMS/ONU (Schofield)</option><option value="valencia">Valencia (población mexicana)</option><option value="cunningham">Cunningham</option><option value="katch-mcardle">Katch-McArdle</option></select></label>{needsBodyFat && <label>% Grasa corporal<input type="number" step="0.1" min="1" max="75" value={form.bodyFatPercent} onChange={(e) => updateForm('bodyFatPercent', e.target.value)} /></label>}<label>Actividad física<select value={form.activityFactor} onChange={(e) => updateForm('activityFactor', e.target.value)}><option value="1.2">Sedentaria · 1.2</option><option value="1.375">Ligera · 1.375</option><option value="1.55">Moderada · 1.55</option><option value="1.725">Intensa · 1.725</option></select></label></div><div className="macro-distribution"><div className="section-heading"><div><h2>Distribución de macronutrientes</h2><p className="subtitle">Porcentaje del requerimiento energético. La suma debe dar 100%.</p></div></div><div className="form-grid three"><label>Carbohidratos (%)<input type="number" min="0" max="100" value={form.carbsPercent} onChange={(e) => updateForm('carbsPercent', e.target.value)} /></label><label>Proteína (%)<input type="number" min="0" max="100" value={form.proteinPercent} onChange={(e) => updateForm('proteinPercent', e.target.value)} /></label><label>Grasas (%)<input type="number" min="0" max="100" value={form.fatPercent} onChange={(e) => updateForm('fatPercent', e.target.value)} /></label></div><div className={'macro-sum' + (macroSum === 100 ? '' : ' invalid')}>{macroSum}% {macroSum === 100 ? '· distribución correcta' : '· debe sumar 100%'}</div>{calcResult?.get && macroSum === 100 && <div className="macro-grams">Carbohidratos {macroGrams(form.carbsPercent, 4)} g · Proteína {macroGrams(form.proteinPercent, 4)} g · Grasas {macroGrams(form.fatPercent, 9)} g</div>}</div><label>Objetivo terapéutico<textarea className="wide-textarea" placeholder="Resultado clínico y conductual esperado..." value={form.goal} onChange={(e) => updateForm('goal', e.target.value)} /></label><button className="primary calculate-button" disabled={calcState === 'loading'}>{calcState === 'loading' ? 'Calculando...' : 'Calcular requerimiento'} <span>→</span></button>{calcState === 'error' && <div className="form-error">⚠ {calcError}</div>}</section><aside className="panel calculation-result">{!calcResult && calcState !== 'loading' ? <div className="result-empty"><span>◌</span><h3>Tu resultado aparecerá aquí</h3><p>Completa o confirma los datos y calcula el requerimiento energético.</p></div> : calcState === 'loading' ? <div className="result-empty"><span className="loading-dot">●</span><h3>Calculando requerimiento...</h3><p>Estamos aplicando la fórmula seleccionada.</p></div> : <><div className="result-header"><div><p className="eyebrow">RESULTADO CALCULADO</p><h2>Requerimiento energético</h2></div><span className="result-check">✓</span></div><div className="get-number"><small>GET · Gasto energético total</small><b>{calcResult.get.toLocaleString()} <em>kcal/día</em></b><span>Basado en {calcResult.formulaLabel || calcResult.formula} · factor {form.activityFactor}</span></div><div className="result-details"><div><small>Metabolismo basal</small><b>{calcResult.bmr.toLocaleString()} kcal</b></div><div><small>Actividad estimada</small><b>+{calcResult.activityKcal.toLocaleString()} kcal</b></div></div>{calcResult.bmi && <div className="result-details"><div><small>IMC</small><b>{calcResult.bmi}</b></div><div><small>Peso saludable estimado</small><b>{calcResult.idealWeightRange.minKg}–{calcResult.idealWeightRange.maxKg} kg</b></div></div>}{calcResult.flags?.length > 0 && <div className="form-error">⚠ {calcResult.flags.map((f) => f.message).join(' ')}</div>}<button type="button" className="primary full-button" disabled={evalSaveState === 'saving' || !plan || macroSum !== 100} onClick={saveToPlan}>{evalSaveState === 'saving' ? 'Guardando...' : evalSaveState === 'saved' ? 'Guardado en el plan ✓' : 'Guardar en el plan'} <span>→</span></button>{!plan && <p className="muted">Crea una consulta y un plan en borrador para poder guardar.</p>}{evalSaveState === 'error' && <div className="form-error">⚠ {evalSaveError}</div>}</>}</aside></form></>}

    {step === 2 && <>
      <ModuleHeader eyebrow="PLAN ALIMENTARIO · DISTRIBUCIÓN" title="Distribuye por tiempos" subtitle="Elige la receta base de cada tiempo de comida para toda la semana; luego ajusta día por día en el paso Semana." action={<span className={'sync-label ' + (saveState === 'saving' ? 'loading' : saveState === 'error' ? 'demo' : 'online')}>{saveState === 'saving' ? '● Guardando…' : saveState === 'error' ? '● Error al guardar' : plan ? '● Sincronizado' : '● Sin plan en borrador'}</span>} />
      {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando plan y recetas…</h3></div>}
      {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar el plan o el catálogo de recetas.</div>}
      {loadState === 'ready' && !plan && <div className="result-empty panel"><span>◌</span><h3>No hay un plan en borrador</h3><p>Crea un plan para {patientName} antes de distribuir recetas.</p><button className="primary" disabled={createPlanState === 'creating'} onClick={createPlan}>{createPlanState === 'creating' ? 'Creando…' : 'Crear plan'}</button>{createPlanState === 'error' && <div className="form-error">⚠ No se pudo crear el plan.</div>}</div>}
      {loadState === 'ready' && plan && <div className="distribution panel">
        <div className="distribution-head"><span>Tiempo de comida</span>{meals.map((x) => <b key={x}>{x}</b>)}</div>
        <div className="distribution-row"><span>Receta base de la semana</span>{MEAL_TYPES.map((meal, mealIndex) => { const sample = recipeById(slots[slotKey(1, meal.key)]); return <button key={meal.key} type="button" className="distribution-pick" onClick={() => openPicker(meal.key)}>{sample ? <>{recipeThumb(sample, mealIndex, 'dist-thumb')}<span>{sample.name}</span></> : <span className="muted">+ Elegir receta</span>}</button> })}</div>
        <div className="distribution-total"><span>Promedio por tiempo de comida (kcal)</span>{MEAL_TYPES.map((meal) => { const kcal = averageKcalForMeal(meal.key); return <b key={meal.key}>{kcal != null ? `${kcal} kcal` : '—'}</b> })}</div>
        <div className="distribution-days"><p className="eyebrow">VARIAR POR DÍA</p>
          <div className="distribution-days-head"><span>Día</span>{MEAL_TYPES.map((meal) => <b key={meal.key}>{meal.label}</b>)}</div>
          {DAYS.map((day) => <div className="distribution-days-row" key={day.n}><span>{day.label.slice(0, 3)}</span>{MEAL_TYPES.map((meal) => { const recipe = recipeById(slots[slotKey(day.n, meal.key)]); return <button type="button" className="dist-day-cell" key={meal.key} onClick={() => openPicker(meal.key, day.n)}>{recipe ? <>{recipeThumb(recipe, day.n, 'dist-thumb-sm')}<span className="dist-day-name">{recipe.name}</span></> : <span className="muted">+ Elegir</span>}</button> })}</div>)}
        </div>
        <p className="muted">El catálogo de ingredientes ya incluye el Sistema Mexicano de Equivalentes; la asignación de esta semana se sigue haciendo por receta, no por grupo de equivalentes directamente.</p>
      </div>}
      {renderPicker()}
    </>}

    {step === 3 && <>
      <ModuleHeader eyebrow="DISTRIBUCIÓN SEMANAL" title="Así se verá tu plan" subtitle="Haz clic en cualquier celda para asignar o cambiar la receta de ese día." action={<span className={'sync-label ' + (saveState === 'saving' ? 'loading' : saveState === 'error' ? 'demo' : 'online')}>{saveState === 'saving' ? '● Guardando…' : saveState === 'error' ? '● Error al guardar' : '● Sincronizado'}</span>} />
      {loadState === 'ready' && plan && <div className="week-plan panel">
        <div className="week-head"><span>Tiempo</span>{DAYS.map((d) => <b key={d.n}>{d.label}</b>)}</div>
        {MEAL_TYPES.map((meal) => <div className="week-row" key={meal.key}><span>{meal.label}</span>{DAYS.map((day) => { const recipe = recipeById(slots[slotKey(day.n, meal.key)]); return <div className="week-meal" key={day.n} onClick={() => openPicker(meal.key, day.n)} style={{ cursor: 'pointer' }}>{recipe ? <>{recipeThumb(recipe, day.n, 'week-image')}<small>{recipe.name}</small></> : <small className="muted">+ Elegir</small>}{recipe && <button type="button" className="link-button" onClick={(e) => { e.stopPropagation(); clearSlot(meal.key, day.n) }}>Quitar</button>}</div> })}</div>)}
      </div>}
      {loadState === 'ready' && !plan && <div className="result-empty panel"><span>◌</span><h3>No hay un plan en borrador</h3><p>Crea un plan para {patientName} antes de armar la semana.</p><button className="primary" disabled={createPlanState === 'creating'} onClick={createPlan}>{createPlanState === 'creating' ? 'Creando…' : 'Crear plan'}</button>{createPlanState === 'error' && <div className="form-error">⚠ No se pudo crear el plan.</div>}</div>}
      {loadState === 'ready' && plan && <div className="panel adequacy-panel">
        <h3>% Adecuación de micronutrientes</h3>
        {adequacyState === 'loading' && <p className="muted">Calculando…</p>}
        {adequacyState === 'error' && <div className="form-error">⚠ No se pudo calcular la adecuación de micronutrientes.</div>}
        {adequacyState === 'ready' && !adequacy?.bracket && <p className="muted">Calcula y guarda el requerimiento en el paso "Plan alimentario" para poder calcular la adecuación. <button type="button" className="link-button" onClick={() => selectStep(1)}>Ir al cálculo →</button></p>}
        {adequacyState === 'ready' && adequacy?.bracket && !adequacy.nutrients.length && <p className="muted">Asigna al menos una receta a la semana para calcular la adecuación.</p>}
        {adequacyState === 'ready' && adequacy?.nutrients.length > 0 && <>
          <p className="muted">Referencia: {adequacy.bracketLabel}. Promedio diario de los días con al menos una receta asignada.</p>
          <div className="adequacy-rows">{adequacy.nutrients.map((n) => <div className="adequacy-row" key={n.key}>
            <span>{n.label}</span>
            <div className="adequacy-bar"><i style={{ width: `${Math.min(n.percent, 100)}%` }} className={n.percent < 70 ? 'low' : n.percent > 110 ? 'high' : ''} /></div>
            <b>{n.percent}%</b>
            <small>{n.value} / {n.target} {n.unit}</small>
          </div>)}</div>
        </>}
      </div>}
      <div className="recommendations panel"><h3>Indicaciones para {patientName}</h3><span className="saved">{notesSaveState === 'saving' ? '● Guardando…' : notesSaveState === 'editing' ? '● Editando…' : notesSaveState === 'error' ? '⚠ Error al guardar' : '● Guardado'}</span><div className="form-grid"><label>Consumo de agua<textarea placeholder="Ej. 8 vasos (2 L) al día" value={notesForm.hydrationNote} onChange={(e) => updateNotes('hydrationNote', e.target.value)} disabled={!plan} /></label><label>Recomendaciones generales<textarea placeholder="Añade recomendaciones, educación o suplementos..." value={notesForm.recommendations} onChange={(e) => updateNotes('recommendations', e.target.value)} disabled={!plan} /></label></div>{!plan && <p className="muted">Crea el plan (paso "Distribución") para poder guardar estas indicaciones.</p>}</div>
      {renderPicker()}
    </>}

    {step === 4 && <DocumentPage setActive={setActive} patientId={activePatientId} embedded onPublished={loadPlanData} />}

    </div>

    <div className="wizard-footer"><button className="secondary" onClick={() => selectStep(Math.max(0, step - 1))}>← Anterior</button><span>{saveState === 'saving' ? 'Guardando…' : saveState === 'saved' ? 'Guardado automáticamente' : saveState === 'error' ? 'Error al guardar los últimos cambios' : 'Guardado automáticamente'}</span><button className="primary" onClick={() => step === 4 ? setActive('Documentos') : selectStep(Math.min(step + 1, 4))}>Siguiente <span>→</span></button></div>
  </>}
  </div>
  {renderPreviewModal()}
  </AppChrome>
}
