import { useEffect, useMemo, useState } from 'react'
import { ingredientsApi } from '../lib/api.js'
import { emptyRecall, recallAdequacy, recallBracketLabel, sumRecall } from '../lib/recall.js'

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const formatValue = (value) => (Math.round((Number(value) || 0) * 10) / 10).toLocaleString('es-MX')

// Recordatorio de 24 horas: por cada tiempo de comida se describe lo consumido y se agregan los
// alimentos del catálogo (con gramos) para que el sistema sume energía, macros y micros y calcule
// la adecuación contra las referencias por sexo y edad.
export default function RecallBuilder({ value, onChange, age, sex }) {
  const recall = value && Array.isArray(value.meals) ? value.meals.length ? value : emptyRecall() : emptyRecall()
  const [picker, setPicker] = useState(null) // { mealKey, query, results, loading }

  useEffect(() => {
    if (!picker || picker.query.trim().length < 2) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      ingredientsApi.list(`?search=${encodeURIComponent(picker.query.trim())}`)
        .then((response) => { if (!cancelled) setPicker((prev) => (prev ? { ...prev, results: (response.items || []).slice(0, 8), loading: false } : prev)) })
        .catch(() => { if (!cancelled) setPicker((prev) => (prev ? { ...prev, results: [], loading: false } : prev)) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [picker?.query])

  const updateMeal = (mealKey, patch) => onChange({ ...recall, meals: recall.meals.map((meal) => (meal.key === mealKey ? { ...meal, ...patch } : meal)) })
  const openPicker = (mealKey) => setPicker({ mealKey, query: '', results: [], loading: false })
  const addFood = (mealKey, ingredient) => {
    const meal = recall.meals.find((item) => item.key === mealKey)
    updateMeal(mealKey, { items: [...(meal?.items || []), { uid: uid(), ingredientId: ingredient.id, name: ingredient.name, grams: 100, nutrition: ingredient.nutrition || {} }] })
    setPicker(null)
  }
  const updateItem = (mealKey, itemUid, patch) => {
    const meal = recall.meals.find((item) => item.key === mealKey)
    updateMeal(mealKey, { items: meal.items.map((item) => (item.uid === itemUid ? { ...item, ...patch } : item)) })
  }
  const removeItem = (mealKey, itemUid) => {
    const meal = recall.meals.find((item) => item.key === mealKey)
    updateMeal(mealKey, { items: meal.items.filter((item) => item.uid !== itemUid) })
  }

  const totals = useMemo(() => sumRecall(recall), [value])
  const adequacy = useMemo(() => recallAdequacy(totals, age, sex), [totals, age, sex])
  const bracketLabel = recallBracketLabel(age, sex)
  const hasItems = recall.meals.some((meal) => meal.items.length)
  const groups = [...new Set(adequacy.map((row) => row.group))]

  return <div className="recall-builder">
    <div className="form-card recall-head-card">
      <h3>Recordatorio de 24 horas</h3>
      <p className="muted">Describe lo que {recall.meals.length ? 'el paciente' : 'la persona'} comió el día anterior en cada tiempo de comida y agrega los alimentos con su cantidad: el sistema suma energía, macros y micros y calcula la adecuación.</p>
    </div>

    {recall.meals.map((meal) => <div className="form-card recall-meal" key={meal.key}>
      <div className="recall-meal-head"><h3>{meal.label}</h3><label className="recall-time">Hora<input type="time" value={meal.time || ''} onChange={(event) => updateMeal(meal.key, { time: event.target.value })} /></label></div>
      <textarea placeholder="Describe lo que comió (alimentos, cantidades y horario)…" value={meal.note || ''} onChange={(event) => updateMeal(meal.key, { note: event.target.value })} />
      {meal.items.length > 0 && <div className="recall-items">{meal.items.map((item) => <div className="recall-item" key={item.uid}>
        <span className="recall-item-name">{item.name}</span>
        <input type="number" min="0" step="1" value={item.grams} onChange={(event) => updateItem(meal.key, item.uid, { grams: event.target.value })} />
        <small>g</small>
        <button type="button" className="recall-item-remove" aria-label="Quitar alimento" onClick={() => removeItem(meal.key, item.uid)}>×</button>
      </div>)}</div>}
      {picker?.mealKey === meal.key
        ? <div className="recall-picker">
            <input autoFocus placeholder="Buscar alimento del catálogo…" value={picker.query} onChange={(event) => setPicker((prev) => ({ ...prev, query: event.target.value }))} />
            {picker.query.trim().length >= 2 && picker.results.length === 0 && <p className="muted recall-picker-empty">{picker.loading === false ? 'Sin resultados' : 'Buscando…'}</p>}
            {picker.results.map((ingredient) => <div className="recall-pick" key={ingredient.id} onClick={() => addFood(meal.key, ingredient)}><b>{ingredient.name}</b><small>{ingredient.group}</small></div>)}
            <button type="button" className="link-button" onClick={() => setPicker(null)}>Cerrar</button>
          </div>
        : <button type="button" className="secondary recall-add" onClick={() => openPicker(meal.key)}>+ Agregar alimento del catálogo</button>}
    </div>)}

    <div className="form-card recall-summary">
      <div className="recall-summary-head"><h3>Totales del día</h3>{bracketLabel ? <small className="muted">Referencia: {bracketLabel}</small> : <small className="muted">Sin referencia: falta fecha de nacimiento o edad en el rango soportado</small>}</div>
      {!hasItems && <p className="muted">Agrega alimentos para ver el cálculo automático.</p>}
      {hasItems && groups.map((group) => <div className="recall-group" key={group}>
        <p className="eyebrow">{group}</p>
        <div className="recall-adequacy">
          <div className="recall-adequacy-head"><span>Nutriente</span><b>Consumo</b><b>Ideal</b><b>Adecuación</b></div>
          {adequacy.filter((row) => row.group === group).map((row) => <div className="recall-adequacy-row" key={row.key}>
            <span>{row.label} <small>{row.unit}</small></span>
            <b>{formatValue(row.value)}</b>
            <b>{row.target != null ? formatValue(row.target) : '—'}</b>
            {row.percent != null
              ? <span className={'recall-status ' + (row.status === 'Normal' ? 'normal' : row.status === 'Alto' ? 'high' : 'low')}>{row.percent}% · {row.status}</span>
              : <span className="recall-status none">sin referencia</span>}
          </div>)}
        </div>
      </div>)}
    </div>
  </div>
}
