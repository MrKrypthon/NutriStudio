import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import DocumentPage from '../documents/DocumentPage.jsx'
import { patientsApi, plansApi, recipesApi } from '../../lib/api.js'
import { usePatient } from '../../lib/usePatient.js'

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

export default function PlanStudioPage({ setActive, patientId }) {
  const { patient } = usePatient(patientId)
  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Cargando…'
  const patientInitials = patient ? `${patient.firstName[0] || ''}${patient.lastName[0] || ''}` : '··'
  const [step, setStep] = useState(0)
  const steps = ['Evaluación', 'Plan alimentario', 'Distribución', 'Semana', 'Entrega']

  const [loadState, setLoadState] = useState('loading')
  const [plan, setPlan] = useState(null)
  const [recipes, setRecipes] = useState([])
  const [slots, setSlots] = useState({})
  const [saveState, setSaveState] = useState('idle')
  const [pickerTarget, setPickerTarget] = useState(null)
  const [pickerSearch, setPickerSearch] = useState('')

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

  return <AppChrome active="Plan nutricional" setActive={setActive}><div className="content plan-studio"><div className="patient-context"><button className="back-button" onClick={() => setActive('Pacientes')}>← {patientName}</button><div className="clinical-person"><span className="person-avatar coral">{patientInitials}</span><div><h2>Plan nutricional</h2><span>Borrador · Se guarda automáticamente</span></div></div><button className="primary">Guardar borrador</button></div><div className="plan-steps">{steps.map((x, i) => <button className={step === i ? 'active' : ''} onClick={() => setStep(i)} key={x}><span>{i + 1}</span>{x}</button>)}</div>

    {step === 0 && <><ModuleHeader eyebrow="EVALUACIÓN NUTRICIONAL" title="Datos y objetivos" subtitle="La información del expediente se utiliza para iniciar este plan." action={<button className="secondary">Usar plantilla</button>} /><div className="plan-grid"><div className="plan-card panel"><h3>Datos antropométricos</h3><div className="form-grid three"><label>Sexo<input value="Femenino" readOnly /></label><label>Fecha nacimiento<input value="14/02/1998" readOnly /></label><label>Edad<input value="28 años" readOnly /></label><label>Peso actual<input value="72.4 kg" readOnly /></label><label>Talla<input value="165 cm" readOnly /></label><label>IMC calculado<input value="26.6" readOnly /></label></div></div><div className="plan-card panel ideal-card"><h3>Rangos de peso ideal <span>ⓘ</span></h3><div className="ideal-number">62.5 <small>– 67.8 kg</small></div><p className="muted">Rango estimado para su estatura</p><div className="range"><i /></div><div className="range-labels"><span>Mínimo</span><span>Ideal</span><span>Máximo</span></div></div><div className="plan-card panel full"><h3>Objetivo terapéutico</h3><div className="tag-row"><span>Reducir peso</span><span>Mejorar energía</span><span>Cambio de hábitos</span></div><textarea className="wide-textarea" placeholder="Resultado clínico y conductual esperado..." defaultValue="Reducir 4 kg en 12 semanas, priorizando energía y adherencia sostenible." /></div></div></>}

    {step === 1 && <><ModuleHeader eyebrow="PLAN ALIMENTARIO" title="Define los requerimientos" subtitle="Compara fórmulas y ajusta el objetivo antes de distribuir alimentos." action={<button className="secondary">Copiar plan anterior</button>} /><div className="requirement-grid"><div className="panel requirement-card"><h3>Requerimiento energético</h3><label>Fórmula<select><option>Mifflin-St Jeor</option><option>Harris-Benedict</option><option>FAO/OMS</option><option>Cunningham</option><option>Katch-McArdle</option></select></label><div className="energy-result"><small>GET · Gasto energético total</small><strong>1,842 <em>kcal</em></strong><span>✓ Calculado automáticamente</span></div><label>Actividad física<select><option>Ligera · 1.375</option><option>Moderada · 1.55</option><option>Intensa · 1.725</option></select></label><button className="text-button">+ Calcular actividad por METS</button></div><div className="panel macro-card"><h3>Distribución de macronutrientes</h3><div className="macro-bars"><div><span className="carb" style={{ width: '50%' }} /><b>50%</b><small>Carbohidratos · 230 g</small></div><div><span className="protein" style={{ width: '25%' }} /><b>25%</b><small>Proteína · 115 g</small></div><div><span className="fat" style={{ width: '25%' }} /><b>25%</b><small>Grasas · 51 g</small></div></div><div className="macro-total">Total <b>100%</b><span>1,842 kcal</span></div></div></div></>}

    {step === 2 && <>
      <ModuleHeader eyebrow="PLAN ALIMENTARIO · DISTRIBUCIÓN" title="Distribuye por tiempos" subtitle="Elige la receta base de cada tiempo de comida para toda la semana; luego ajusta día por día en el paso Semana." action={<span className={'sync-label ' + (saveState === 'saving' ? 'loading' : saveState === 'error' ? 'demo' : 'online')}>{saveState === 'saving' ? '● Guardando…' : saveState === 'error' ? '● Error al guardar' : plan ? '● Sincronizado' : '● Sin plan en borrador'}</span>} />
      {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando plan y recetas…</h3></div>}
      {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar el plan o el catálogo de recetas.</div>}
      {loadState === 'ready' && !plan && <div className="result-empty panel"><span>◌</span><h3>No hay un plan en borrador</h3><p>Crea una consulta y un plan para esta paciente antes de distribuir recetas.</p></div>}
      {loadState === 'ready' && plan && <div className="distribution panel">
        <div className="distribution-head"><span>Tiempo de comida</span>{meals.map((x) => <b key={x}>{x}</b>)}</div>
        <div className="distribution-row"><span>Receta base de la semana</span>{MEAL_TYPES.map((meal) => { const sample = recipeById(slots[slotKey(1, meal.key)]); return <button key={meal.key} type="button" className="text-button" onClick={() => openPicker(meal.key)}>{sample ? sample.name : '+ Elegir receta'}</button> })}</div>
        <div className="distribution-total"><span>Calorías estimadas</span>{MEAL_TYPES.map((meal) => { const kcal = averageKcalForMeal(meal.key); return <b key={meal.key}>{kcal != null ? `${kcal} kcal` : '—'}</b> })}</div>
        <p className="muted">La distribución por grupos de equivalentes (SMAE) requiere licenciar la tabla oficial; por ahora la asignación se hace por receta.</p>
      </div>}
      {pickerTarget && <div className="recipe-overlay"><div className="recipe-modal panel"><div className="modal-head"><div><p className="eyebrow">RECETAS PARA {MEAL_TYPES.find((m) => m.key === pickerTarget.mealType)?.label.toUpperCase()}{pickerTarget.day ? ` · ${DAYS.find((d) => d.n === pickerTarget.day)?.label}` : ' · TODA LA SEMANA'}</p><h2>Elige una preparación</h2></div><button onClick={() => setPickerTarget(null)}>×</button></div><div className="recipe-search"><input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Buscar receta..." /></div><div className="recipe-picker-grid">{pickerRecipes.length === 0 && <p className="muted">No hay recetas del catálogo para este tiempo de comida.</p>}{pickerRecipes.map((recipe, i) => <button className="recipe-pick" onClick={() => chooseRecipe(recipe)} key={recipe.id}><div className={'recipe-image ' + RECIPE_COLORS[i % RECIPE_COLORS.length]}><span>✦</span></div><b>{recipe.name}</b><small>{Math.round(recipe.nutrition?.kcal || 0)} kcal</small></button>)}</div></div></div>}
    </>}

    {step === 3 && <>
      <ModuleHeader eyebrow="DISTRIBUCIÓN SEMANAL" title="Así se verá tu plan" subtitle="Haz clic en cualquier celda para asignar o cambiar la receta de ese día." action={<span className={'sync-label ' + (saveState === 'saving' ? 'loading' : saveState === 'error' ? 'demo' : 'online')}>{saveState === 'saving' ? '● Guardando…' : saveState === 'error' ? '● Error al guardar' : '● Sincronizado'}</span>} />
      {loadState === 'ready' && plan && <div className="week-plan panel">
        <div className="week-head"><span>Tiempo</span>{DAYS.map((d) => <b key={d.n}>{d.label}</b>)}</div>
        {MEAL_TYPES.map((meal) => <div className="week-row" key={meal.key}><span>{meal.label}</span>{DAYS.map((day) => { const recipe = recipeById(slots[slotKey(day.n, meal.key)]); return <div className="week-meal" key={day.n} onClick={() => openPicker(meal.key, day.n)} style={{ cursor: 'pointer' }}>{recipe ? <><div className="week-image coral">✦</div><small>{recipe.name}</small></> : <small className="muted">+ Elegir</small>}{recipe && <button type="button" className="link-button" onClick={(e) => { e.stopPropagation(); clearSlot(meal.key, day.n) }}>Quitar</button>}</div> })}</div>)}
      </div>}
      {loadState === 'ready' && !plan && <div className="result-empty panel"><span>◌</span><h3>No hay un plan en borrador</h3><p>Crea una consulta y un plan para esta paciente antes de armar la semana.</p></div>}
      <div className="recommendations panel"><h3>Indicaciones para {patientName}</h3><div className="form-grid"><label>Consumo de agua<textarea defaultValue="8 vasos (2 L) al día" /></label><label>Recomendaciones generales<textarea placeholder="Añade recomendaciones, educación o suplementos..." /></label></div></div>
      {pickerTarget && <div className="recipe-overlay"><div className="recipe-modal panel"><div className="modal-head"><div><p className="eyebrow">RECETAS PARA {MEAL_TYPES.find((m) => m.key === pickerTarget.mealType)?.label.toUpperCase()}{pickerTarget.day ? ` · ${DAYS.find((d) => d.n === pickerTarget.day)?.label}` : ''}</p><h2>Elige una preparación</h2></div><button onClick={() => setPickerTarget(null)}>×</button></div><div className="recipe-search"><input value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Buscar receta..." /></div><div className="recipe-picker-grid">{pickerRecipes.length === 0 && <p className="muted">No hay recetas del catálogo para este tiempo de comida.</p>}{pickerRecipes.map((recipe, i) => <button className="recipe-pick" onClick={() => chooseRecipe(recipe)} key={recipe.id}><div className={'recipe-image ' + RECIPE_COLORS[i % RECIPE_COLORS.length]}><span>✦</span></div><b>{recipe.name}</b><small>{Math.round(recipe.nutrition?.kcal || 0)} kcal</small></button>)}</div></div></div>}
    </>}

    {step === 4 && <DocumentPage setActive={setActive} patientId={patientId} />}

    <div className="wizard-footer"><button className="secondary" onClick={() => setStep(Math.max(0, step - 1))}>← Anterior</button><span>{saveState === 'saving' ? 'Guardando…' : saveState === 'saved' ? 'Guardado automáticamente' : saveState === 'error' ? 'Error al guardar los últimos cambios' : 'Guardado automáticamente'}</span><button className="primary" onClick={() => step === 4 ? setActive('Documentos') : setStep(Math.min(step + 1, 4))}>Siguiente paso <span>→</span></button></div>
  </div></AppChrome>
}
