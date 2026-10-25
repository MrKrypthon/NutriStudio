import { useState } from 'react'
import { backdropClose, round1 } from './planAdjustments.js'

// Ejercicios frecuentes con su intensidad en METs (Compendio de Actividades Físicas), para no tener
// que recordar el número; se puede escribir cualquier otro valor.
const MET_PRESETS = [['3.5', 'Caminar a paso normal'], ['4.3', 'Caminar rápido'], ['5', 'Pesas / fuerza'], ['6.5', 'Baile aeróbico'], ['7', 'Trotar o fútbol'], ['7.5', 'Ciclismo moderado'], ['8', 'HIIT o natación continua'], ['9.8', 'Correr (10 km/h)'], ['2.5', 'Yoga']]
const emptyActivity = () => ({ id: globalThis.crypto?.randomUUID?.() || `m${Date.now().toString(36)}`, name: '', met: '5', minutes: '30', sessionsPerWeek: '3' })

// Calorías diarias de UNA actividad: MET × 3.5 × peso / 200 × minutos × días / 7 (misma fórmula
// que usa el servidor en computeEnergyRequirement).
export const metsActivityKcal = (activity, weightKg) => {
  const met = Number(activity?.met)
  const minutes = Number(activity?.minutes)
  const sessions = Number(activity?.sessionsPerWeek)
  const weight = Number(weightKg)
  if (!(weight > 0 && met > 0 && minutes > 0 && sessions > 0)) return null
  return met * 3.5 * weight / 200 * minutes * sessions / 7
}

const validActivity = (activity) => Number(activity?.met) > 0 && Number(activity?.minutes) > 0 && Number(activity?.sessionsPerWeek) > 0

// Varias actividades físicas por METs (pesas, caminata…) en lugar de una sola: el diseño del
// Constructor las muestra como tabla con los minutos y las kcal diarias de cada una. El total se
// suma al metabolismo basal en el cálculo del requerimiento.
export default function MetsActivityEditor({ value = [], weightKg = null, onChange, disabled = false }) {
  const [editing, setEditing] = useState(null) // null = cerrado; si no, índice o 'new'
  const [draft, setDraft] = useState(emptyActivity)
  const activities = Array.isArray(value) ? value : []
  const total = activities.reduce((sum, activity) => sum + (metsActivityKcal(activity, weightKg) || 0), 0)
  const openNew = () => { setDraft(emptyActivity()); setEditing('new') }
  const openEdit = (index) => { setDraft({ ...activities[index] }); setEditing(index) }
  const close = () => setEditing(null)
  const save = () => {
    if (!validActivity(draft)) return
    const next = [...activities]
    const clean = { ...draft, name: draft.name.trim() || 'Actividad física' }
    if (editing === 'new') next.push(clean)
    else next[editing] = clean
    onChange(next)
    close()
  }
  const remove = (index) => onChange(activities.filter((_, position) => position !== index))
  const draftKcal = metsActivityKcal(draft, weightKg)

  return <div className="mets-editor">
    <div className="mets-editor-head">
      <div><p className="eyebrow">ACTIVIDAD FÍSICA POR METS</p><b>Actividades de la semana</b></div>
      <button type="button" className="secondary" disabled={disabled || activities.length >= 12} onClick={openNew}>+ Agregar actividad</button>
    </div>
    {activities.length > 0
      ? <div className="mets-table" role="table">
          <div className="mets-row mets-head" role="row"><span>Actividad</span><span>Min/día</span><span>Kcal/día</span><span /></div>
          {activities.map((activity, index) => <div className="mets-row" role="row" key={activity.id || index}>
            <button type="button" className="mets-name" disabled={disabled} onClick={() => openEdit(index)}>{activity.name || 'Actividad física'}<small>{activity.met} MET · {activity.sessionsPerWeek} día(s)/sem</small></button>
            <span>{activity.minutes} min</span>
            <span>{weightKg ? `${Math.round(metsActivityKcal(activity, weightKg) || 0)} kcal` : '—'}</span>
            {disabled ? <span /> : <button type="button" className="link-button" onClick={() => remove(index)} aria-label={`Quitar ${activity.name || 'actividad'}`}>×</button>}
          </div>)}
          <div className="mets-row mets-total" role="row"><span>Total de actividad</span><span /><span>{weightKg ? `${Math.round(total)} kcal` : '—'}</span><span /></div>
        </div>
      : <p className="muted">Sin actividades: el requerimiento se calcula con el metabolismo basal y el factor o porcentaje de actividad.</p>}
    {editing !== null && <div className="modal-backdrop" {...backdropClose(close)}>
      <form className="modal mets-modal" onSubmit={(event) => { event.preventDefault(); save() }}>
        <div className="modal-head"><h2>{editing === 'new' ? 'Agregar actividad física' : 'Editar actividad física'}</h2><button type="button" onClick={close} aria-label="Cerrar">×</button></div>
        <label>Actividad<input list="mets-activity-options" value={draft.name} required onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="Ej. Pesas / fuerza" /><datalist id="mets-activity-options">{MET_PRESETS.map(([value, label]) => <option value={label} key={label}>{value} METs</option>)}</datalist></label>
        <div className="form-row">
          <label>Intensidad (METs)<input type="number" min="1" max="23" step="0.1" required value={draft.met} onChange={(event) => setDraft((prev) => ({ ...prev, met: event.target.value }))} /></label>
          <label>Minutos por sesión<input type="number" min="1" max="600" required value={draft.minutes} onChange={(event) => setDraft((prev) => ({ ...prev, minutes: event.target.value }))} /></label>
        </div>
        <div className="form-row">
          <label>Días a la semana<input type="number" min="1" max="21" required value={draft.sessionsPerWeek} onChange={(event) => setDraft((prev) => ({ ...prev, sessionsPerWeek: event.target.value }))} /></label>
          <label>Calorías estimadas<input value={weightKg && draftKcal != null ? `${Math.round(draftKcal)} kcal/día` : 'Falta el peso'} readOnly /></label>
        </div>
        <p className="muted mets-formula">{draft.met} MET × {weightKg || '—'} kg × {(Number(draft.minutes) || 0) / 60} h × {draft.sessionsPerWeek} día(s) / 7 = {draftKcal != null ? round1(draftKcal) : '—'} kcal/día</p>
        <div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="submit" className="primary" disabled={!validActivity(draft)}>Guardar</button></div>
      </form>
    </div>}
  </div>
}
