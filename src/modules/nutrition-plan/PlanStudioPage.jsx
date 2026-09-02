import { useEffect, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import DocumentPage from '../documents/DocumentPage.jsx'
import { clinicalApi, nutritionApi, patientsApi, plansApi, recipesApi } from '../../lib/api.js'
import { usePatient } from '../../lib/usePatient.js'

const DEFAULT_MACROS = { carbsPercent: 50, proteinPercent: 25, fatPercent: 25 }
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
const slotKey = (day, mealType) => `${day}:${mealType}`

export default function PlanStudioPage({ setActive, patientId, onSelectPatient }) {
  const { patient } = usePatient(patientId)
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
  const [adequacy, setAdequacy] = useState(null)
  const [adequacyState, setAdequacyState] = useState('idle')
  const [form, setForm] = useState({ sex: 'female', age: '28', weightKg: '72.4', heightCm: '165', formula: 'mifflin', activityFactor: '1.375', goal: '' })
  const [calcResult, setCalcResult] = useState(null)
  const [calcState, setCalcState] = useState('idle')
  const [calcError, setCalcError] = useState('')
  const [evalSaveState, setEvalSaveState] = useState('idle')
  const [evalSaveError, setEvalSaveError] = useState('')
  const [createPlanState, setCreatePlanState] = useState('idle')
  const [notesForm, setNotesForm] = useState({ hydrationNote: '', recommendations: '' })
  const [notesSaveState, setNotesSaveState] = useState('idle')
  const notesSaveTimer = useRef(null)

  useEffect(() => { patientsApi.list('?status=ACTIVE').then((payload) => setPatients(payload.items || [])).catch(() => setPatients([])) }, [])

  useEffect(() => {
    if (!patient) return
    setForm((prev) => ({ ...prev, sex: sexToFormValue(patient.sex), age: computeAge(patient.birthDate) || prev.age }))
  }, [patient])

  useEffect(() => {
    if (!plan) return
    setForm((prev) => ({ ...prev, goal: plan.goal || prev.goal }))
    setNotesForm({ hydrationNote: plan.hydrationNote || '', recommendations: plan.recommendations || '' })
  }, [plan?.id])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [plansResponse, recipesResponse] = await Promise.all([patientsApi.plans(patientId), recipesApi.list()])
        if (cancelled) return
        const activePlan = (plansResponse.items || []).find((item) => item.status !== 'PUBLISHED') || null
        const initialSlots = {}
        for (const slot of activePlan?.mealSlots || []) initialSlots[slotKey(slot.dayOfWeek, slot.mealType)] = slot.recipeId
        setPlan(activePlan)
        setRecipes(recipesResponse.items || [])
        setSlots(initialSlots)
        setLoadState('ready')
      } catch {
        if (!cancelled) setLoadState('error')
      }
    }
    load()
    return () => { cancelled = true }
  }, [patientId])

  const recipeById = (id) => recipes.find((recipe) => recipe.id === id)

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
      const updated = await plansApi.evaluate(plan.id, { ...form, ...DEFAULT_MACROS })
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
    clearTimeout(notesSaveTimer.current)
    notesSaveTimer.current = setTimeout(async () => {
      setNotesSaveState('saving')
      try {
        const updated = await plansApi.update(plan.id, next)
        setPlan(updated)
        setNotesSaveState('saved')
      } catch {
        setNotesSaveState('error')
      }
    }, 800)
  }

  const createPlan = async () => {
    if (!patientId) return
    setCreatePlanState('creating')
    try {
      const consultationsResponse = await patientsApi.consultations(patientId)
      let consultation = (consultationsResponse.items || []).find((item) => item.status === 'IN_PROGRESS')
      if (!consultation) consultation = await clinicalApi.create(patientId, {})
      const created = await plansApi.create(patientId, { consultationId: consultation.id })
      setPlan(created)
      setSlots({})
      setCreatePlanState('idle')
    } catch {
      setCreatePlanState('error')
    }
  }

  const persistSlots = async (nextSlots) => {
    if (!plan) return
    setSaveState('saving')
    const payload = Object.entries(nextSlots).filter(([, recipeId]) => recipeId).map(([key, recipeId]) => {
      const [day, mealType] = key.split(':')
      return { dayOfWeek: Number(day), mealType, recipeId, servings: 1 }
    })
    try {
      const updated = await plansApi.saveDistribution(plan.id, payload)
      setPlan(updated)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }

  const openPicker = (mealType, day = null) => { setPickerSearch(''); setPickerTarget({ mealType, day }) }

  const chooseRecipe = (recipe) => {
    if (!pickerTarget) return
    const nextSlots = { ...slots }
    if (pickerTarget.day) nextSlots[slotKey(pickerTarget.day, pickerTarget.mealType)] = recipe.id
    else for (const day of DAYS) nextSlots[slotKey(day.n, pickerTarget.mealType)] = recipe.id
    setSlots(nextSlots)
    setPickerTarget(null)
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

  const pickerRecipes = pickerTarget
    ? recipes
        .filter((recipe) => (recipe.mealTypes || []).length === 0 || recipe.mealTypes.includes(pickerTarget.mealType))
        .filter((recipe) => recipe.name.toLowerCase().includes(pickerSearch.toLowerCase()))
    : []

  const meals = MEAL_TYPES.map((m) => m.label)

  return <AppChrome active="Constructor de plan" setActive={setActive}><div className="content plan-studio"><div className="patient-context"><button className="back-button" onClick={() => setActive('Pacientes')}>← Pacientes</button><div className="clinical-person"><span className="person-avatar coral">{patientInitials}</span><div><h2>{patientName}</h2><span>Borrador · Se guarda automáticamente</span></div></div><label className="patient-switch">Paciente<select value={patientId || ''} onChange={(e) => onSelectPatient?.(e.target.value)}>{patients.map((p) => <option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select></label></div><div className="plan-steps">{steps.map((x, i) => <button className={step === i ? 'active' : ''} onClick={() => setStep(i)} key={x}><span>{i + 1}</span>{x}</button>)}</div>

    {step === 0 && <><ModuleHeader eyebrow="EVALUACIÓN NUTRICIONAL" title="Datos y objetivos" subtitle="Resumen del expediente y del último cálculo guardado en el paso Plan alimentario." action={<button className="secondary" onClick={() => setStep(1)}>Ir al cálculo →</button>} /><div className="plan-grid"><div className="plan-card panel"><h3>Datos antropométricos</h3><div className="form-grid three"><label>Sexo<input value={patient?.sex || '—'} readOnly /></label><label>Fecha nacimiento<input value={formatUTCDate(patient?.birthDate) || '—'} readOnly /></label><label>Edad<input value={computeAge(patient?.birthDate) ? `${computeAge(patient.birthDate)} años` : '—'} readOnly /></label><label>Peso actual<input value={plan?.evaluation?.inputs?.weightKg ? `${plan.evaluation.inputs.weightKg} kg` : '—'} readOnly /></label><label>Talla<input value={plan?.evaluation?.inputs?.heightCm ? `${plan.evaluation.inputs.heightCm} cm` : '—'} readOnly /></label><label>IMC calculado<input value={plan?.evaluation?.bmi ?? '—'} readOnly /></label></div></div><div className="plan-card panel ideal-card"><h3>Rangos de peso ideal <span>ⓘ</span></h3>{plan?.evaluation?.idealWeightRange ? <div className="ideal-number">{plan.evaluation.idealWeightRange.minKg} <small>– {plan.evaluation.idealWeightRange.maxKg} kg</small></div> : <p className="muted">Calcula el requerimiento en el paso "Plan alimentario" para ver el rango.</p>}<p className="muted">Rango estimado para su estatura</p></div><div className="plan-card panel full"><h3>Objetivo terapéutico</h3>{plan?.goal ? <p>{plan.goal}</p> : <p className="muted">Sin definir todavía — se guarda junto con el cálculo en el paso "Plan alimentario".</p>}</div></div></>}

    {step === 1 && <><ModuleHeader eyebrow="PLAN ALIMENTARIO · REQUERIMIENTO" title="Calcula el punto de partida" subtitle="Cada resultado queda asociado a la fórmula y a los datos utilizados." /><form className="calculator-layout" onSubmit={calculate}><section className="panel calculator-form"><div className="section-heading"><div><h2>Datos de la paciente</h2><p className="subtitle">Puedes ajustar estos valores para simular el plan.</p></div></div><div className="form-grid three"><label>Sexo<select value={form.sex} onChange={(e) => updateForm('sex', e.target.value)}><option value="female">Femenino</option><option value="male">Masculino</option></select></label><label>Edad (años)<input type="number" min="1" max="120" value={form.age} onChange={(e) => updateForm('age', e.target.value)} /></label><label>Peso (kg)<input type="number" step="0.1" min="1" value={form.weightKg} onChange={(e) => updateForm('weightKg', e.target.value)} /></label><label>Talla (cm)<input type="number" step="0.1" min="30" value={form.heightCm} onChange={(e) => updateForm('heightCm', e.target.value)} /></label><label>Fórmula energética<select value={form.formula} onChange={(e) => updateForm('formula', e.target.value)}><option value="mifflin">Mifflin-St Jeor</option><option value="harris">Harris-Benedict</option><option value="schofield">FAO/OMS/ONU (Schofield)</option><option value="valencia">Valencia (población mexicana)</option><option value="cunningham">Cunningham</option><option value="katch-mcardle">Katch-McArdle</option></select></label><label>Actividad física<select value={form.activityFactor} onChange={(e) => updateForm('activityFactor', e.target.value)}><option value="1.2">Sedentaria · 1.2</option><option value="1.375">Ligera · 1.375</option><option value="1.55">Moderada · 1.55</option><option value="1.725">Intensa · 1.725</option></select></label></div><label>Objetivo terapéutico<textarea className="wide-textarea" placeholder="Resultado clínico y conductual esperado..." value={form.goal} onChange={(e) => updateForm('goal', e.target.value)} /></label><button className="primary calculate-button" disabled={calcState === 'loading'}>{calcState === 'loading' ? 'Calculando...' : 'Calcular requerimiento'} <span>→</span></button>{calcState === 'error' && <div className="form-error">⚠ {calcError}</div>}</section><aside className="panel calculation-result">{!calcResult && calcState !== 'loading' ? <div className="result-empty"><span>◌</span><h3>Tu resultado aparecerá aquí</h3><p>Completa o confirma los datos y calcula el requerimiento energético.</p></div> : calcState === 'loading' ? <div className="result-empty"><span className="loading-dot">●</span><h3>Calculando requerimiento...</h3><p>Estamos aplicando la fórmula seleccionada.</p></div> : <><div className="result-header"><div><p className="eyebrow">RESULTADO CALCULADO</p><h2>Requerimiento energético</h2></div><span className="result-check">✓</span></div><div className="get-number"><small>GET · Gasto energético total</small><b>{calcResult.get.toLocaleString()} <em>kcal/día</em></b><span>Basado en {calcResult.formulaLabel || calcResult.formula} · factor {form.activityFactor}</span></div><div className="result-details"><div><small>Metabolismo basal</small><b>{calcResult.bmr.toLocaleString()} kcal</b></div><div><small>Actividad estimada</small><b>+{calcResult.activityKcal.toLocaleString()} kcal</b></div></div>{calcResult.bmi && <div className="result-details"><div><small>IMC</small><b>{calcResult.bmi}</b></div><div><small>Peso saludable estimado</small><b>{calcResult.idealWeightRange.minKg}–{calcResult.idealWeightRange.maxKg} kg</b></div></div>}{calcResult.flags?.length > 0 && <div className="form-error">⚠ {calcResult.flags.map((f) => f.message).join(' ')}</div>}<button type="button" className="primary full-button" disabled={evalSaveState === 'saving' || !plan} onClick={saveToPlan}>{evalSaveState === 'saving' ? 'Guardando...' : evalSaveState === 'saved' ? 'Guardado en el plan ✓' : 'Guardar en el plan'} <span>→</span></button>{!plan && <p className="muted">Crea una consulta y un plan en borrador para poder guardar.</p>}{evalSaveState === 'error' && <div className="form-error">⚠ {evalSaveError}</div>}</>}</aside></form></>}

    {step === 2 && <>
      <ModuleHeader eyebrow="PLAN ALIMENTARIO · DISTRIBUCIÓN" title="Distribuye por tiempos" subtitle="Elige la receta base de cada tiempo de comida para toda la semana; luego ajusta día por día en el paso Semana." action={<span className={'sync-label ' + (saveState === 'saving' ? 'loading' : saveState === 'error' ? 'demo' : 'online')}>{saveState === 'saving' ? '● Guardando…' : saveState === 'error' ? '● Error al guardar' : plan ? '● Sincronizado' : '● Sin plan en borrador'}</span>} />
      {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando plan y recetas…</h3></div>}
      {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar el plan o el catálogo de recetas.</div>}
      {loadState === 'ready' && !plan && <div className="result-empty panel"><span>◌</span><h3>No hay un plan en borrador</h3><p>Crea un plan para {patientName} antes de distribuir recetas.</p><button className="primary" disabled={createPlanState === 'creating'} onClick={createPlan}>{createPlanState === 'creating' ? 'Creando…' : 'Crear plan'}</button>{createPlanState === 'error' && <div className="form-error">⚠ No se pudo crear el plan.</div>}</div>}
      {loadState === 'ready' && plan && <div className="distribution panel">
        <div className="distribution-head"><span>Tiempo de comida</span>{meals.map((x) => <b key={x}>{x}</b>)}</div>
        <div className="distribution-row"><span>Receta base de la semana</span>{MEAL_TYPES.map((meal) => { const sample = recipeById(slots[slotKey(1, meal.key)]); return <button key={meal.key} type="button" className="text-button" onClick={() => openPicker(meal.key)}>{sample ? sample.name : '+ Elegir receta'}</button> })}</div>
        <div className="distribution-total"><span>Calorías estimadas</span>{MEAL_TYPES.map((meal) => { const kcal = averageKcalForMeal(meal.key); return <b key={meal.key}>{kcal != null ? `${kcal} kcal` : '—'}</b> })}</div>
        <p className="muted">El catálogo de ingredientes ya incluye el Sistema Mexicano de Equivalentes; la asignación de esta semana se sigue haciendo por receta, no por grupo de equivalentes directamente.</p>
      </div>}
      {pickerTarget && <div className="recipe-overlay"><div className="recipe-modal panel"><div className="modal-head"><div><p className="eyebrow">RECETAS PARA {MEAL_TYPES.find((m) => m.key === pickerTarget.mealType)?.label.toUpperCase()}{pickerTarget.day ? ` · ${DAYS.find((d) => d.n === pickerTarget.day)?.label}` : ' · TODA LA SEMANA'}</p><h2>Elige una preparación</h2></div><button onClick={() => setPickerTarget(null)}>×</button></div><div className="recipe-search"><input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Buscar receta..." /></div><div className="recipe-picker-grid">{pickerRecipes.length === 0 && <p className="muted">No hay recetas del catálogo para este tiempo de comida.</p>}{pickerRecipes.map((recipe, i) => <button className="recipe-pick" onClick={() => chooseRecipe(recipe)} key={recipe.id}><div className={'recipe-image ' + RECIPE_COLORS[i % RECIPE_COLORS.length]}><span>✦</span></div><b>{recipe.name}</b><small>{Math.round(recipe.nutrition?.kcal || 0)} kcal</small></button>)}</div></div></div>}
    </>}

    {step === 3 && <>
      <ModuleHeader eyebrow="DISTRIBUCIÓN SEMANAL" title="Así se verá tu plan" subtitle="Haz clic en cualquier celda para asignar o cambiar la receta de ese día." action={<span className={'sync-label ' + (saveState === 'saving' ? 'loading' : saveState === 'error' ? 'demo' : 'online')}>{saveState === 'saving' ? '● Guardando…' : saveState === 'error' ? '● Error al guardar' : '● Sincronizado'}</span>} />
      {loadState === 'ready' && plan && <div className="week-plan panel">
        <div className="week-head"><span>Tiempo</span>{DAYS.map((d) => <b key={d.n}>{d.label}</b>)}</div>
        {MEAL_TYPES.map((meal) => <div className="week-row" key={meal.key}><span>{meal.label}</span>{DAYS.map((day) => { const recipe = recipeById(slots[slotKey(day.n, meal.key)]); return <div className="week-meal" key={day.n} onClick={() => openPicker(meal.key, day.n)} style={{ cursor: 'pointer' }}>{recipe ? <><div className="week-image coral">✦</div><small>{recipe.name}</small></> : <small className="muted">+ Elegir</small>}{recipe && <button type="button" className="link-button" onClick={(e) => { e.stopPropagation(); clearSlot(meal.key, day.n) }}>Quitar</button>}</div> })}</div>)}
      </div>}
      {loadState === 'ready' && !plan && <div className="result-empty panel"><span>◌</span><h3>No hay un plan en borrador</h3><p>Crea un plan para {patientName} antes de armar la semana.</p><button className="primary" disabled={createPlanState === 'creating'} onClick={createPlan}>{createPlanState === 'creating' ? 'Creando…' : 'Crear plan'}</button>{createPlanState === 'error' && <div className="form-error">⚠ No se pudo crear el plan.</div>}</div>}
      {loadState === 'ready' && plan && <div className="panel adequacy-panel">
        <h3>% Adecuación de micronutrientes</h3>
        {adequacyState === 'loading' && <p className="muted">Calculando…</p>}
        {adequacyState === 'error' && <div className="form-error">⚠ No se pudo calcular la adecuación de micronutrientes.</div>}
        {adequacyState === 'ready' && !adequacy?.bracket && <p className="muted">Calcula y guarda el requerimiento en el paso "Plan alimentario" para poder calcular la adecuación.</p>}
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
      {pickerTarget && <div className="recipe-overlay"><div className="recipe-modal panel"><div className="modal-head"><div><p className="eyebrow">RECETAS PARA {MEAL_TYPES.find((m) => m.key === pickerTarget.mealType)?.label.toUpperCase()}{pickerTarget.day ? ` · ${DAYS.find((d) => d.n === pickerTarget.day)?.label}` : ''}</p><h2>Elige una preparación</h2></div><button onClick={() => setPickerTarget(null)}>×</button></div><div className="recipe-search"><input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Buscar receta..." /></div><div className="recipe-picker-grid">{pickerRecipes.length === 0 && <p className="muted">No hay recetas del catálogo para este tiempo de comida.</p>}{pickerRecipes.map((recipe, i) => <button className="recipe-pick" onClick={() => chooseRecipe(recipe)} key={recipe.id}><div className={'recipe-image ' + RECIPE_COLORS[i % RECIPE_COLORS.length]}><span>✦</span></div><b>{recipe.name}</b><small>{Math.round(recipe.nutrition?.kcal || 0)} kcal</small></button>)}</div></div></div>}
    </>}

    {step === 4 && <DocumentPage setActive={setActive} patientId={patientId} />}

    <div className="wizard-footer"><button className="secondary" onClick={() => setStep(Math.max(0, step - 1))}>← Anterior</button><span>{saveState === 'saving' ? 'Guardando…' : saveState === 'saved' ? 'Guardado automáticamente' : saveState === 'error' ? 'Error al guardar los últimos cambios' : 'Guardado automáticamente'}</span><button className="primary" onClick={() => step === 4 ? setActive('Documentos') : setStep(Math.min(step + 1, 4))}>Siguiente paso <span>→</span></button></div>
  </div></AppChrome>
}
