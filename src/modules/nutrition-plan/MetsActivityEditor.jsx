import { useState } from 'react'
import { backdropClose, round1 } from './planAdjustments.js'

// Actividades frecuentes con su intensidad en METs (Compendio de Actividades Físicas), para no tener
// que recordar el número; la actividad se elige de la lista y el MET se puede ajustar a mano.
const ACTIVITY_PRESETS = [
  ['Pesas (Fuerza)', '5'],
  ['Caminar a paso normal', '3.5'],
  ['Caminar rápido', '4.3'],
  ['Baile aeróbico', '6.5'],
  ['Trotar o fútbol', '7'],
  ['Ciclismo moderado', '7.5'],
  ['HIIT o natación continua', '8'],
  ['Correr (10 km/h)', '9.8'],
  ['Yoga', '2.5'],
]
// Niveles de intensidad que propone el diseño; al elegir uno se carga su MET sugerido.
const MET_INTENSITIES = [
  ['Muy ligera / rehabilitación', '2.5'],
  ['Ligera', '3.5'],
  ['Moderada', '5'],
  ['Intensa', '7'],
  ['Muy intensa', '9'],
]
const OTHER_ACTIVITY = '__other'
const emptyActivity = () => ({ id: globalThis.crypto?.randomUUID?.() || `m${Date.now().toString(36)}`, name: '', met: '5', minutes: '30', sessionsPerWeek: '3' })

// Calorías de UNA sesión: MET × 3.5 × peso / 200 × minutos.
const metsSessionKcal = (activity, weightKg) => {
  const met = Number(activity?.met)
  const minutes = Number(activity?.minutes)
  const weight = Number(weightKg)
  if (!(weight > 0 && met > 0 && minutes > 0)) return null
  return met * 3.5 * weight / 200 * minutes
}

// Promedio diario de UNA actividad: lo de una sesión por los días de la semana entre 7 (la misma
// fórmula que usa el servidor en computeEnergyRequirement).
export const metsActivityKcal = (activity, weightKg) => {
  const session = metsSessionKcal(activity, weightKg)
  const sessions = Number(activity?.sessionsPerWeek)
  if (session == null || !(sessions > 0)) return null
  return session * sessions / 7
}

const validActivity = (activity) => Boolean(activity?.name?.trim()) && Number(activity?.met) > 0 && Number(activity?.minutes) > 0 && Number(activity?.sessionsPerWeek) > 0
const intensityOf = (met) => MET_INTENSITIES.find(([, value]) => Number(value) === Number(met))?.[0] || null

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
    const clean = { ...draft, name: draft.name.trim() }
    if (editing === 'new') next.push(clean)
    else next[editing] = clean
    onChange(next)
    close()
  }
  const remove = (index) => onChange(activities.filter((_, position) => position !== index))
  const draftSessionKcal = metsSessionKcal(draft, weightKg)
  const draftDailyKcal = metsActivityKcal(draft, weightKg)
  const presetName = ACTIVITY_PRESETS.some(([name]) => name === draft.name)
  const activitySelectValue = presetName ? draft.name : draft.name ? OTHER_ACTIVITY : ''
  const draftIntensity = intensityOf(draft.met)
  const weightText = Number(weightKg) > 0 ? `${round1(Number(weightKg))} kg` : '— kg'

  return <div className="mets-editor">
    <div className="mets-editor-head">
      <div><p className="eyebrow">ACTIVIDAD FÍSICA POR METS</p><b>Actividades de la semana</b></div>
      <button type="button" className="secondary" disabled={disabled || activities.length >= 12} onClick={openNew}>+ Agregar Actividad</button>
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
      : <p className="muted">Sin actividades: agrega el ejercicio de la semana o usa el factor / porcentaje de actividad.</p>}
    {editing !== null && <div className="modal-backdrop" {...backdropClose(close)}>
      {/* div, no form: este componente vive dentro del formulario del Dietocálculo y un <form>
          anidado haría que "Guardar" disparara el cálculo del requerimiento. */}
      <div className="modal mets-modal" role="dialog" aria-modal="true" aria-label={editing === 'new' ? 'Agregar Actividad Física' : 'Editar Actividad Física'} onKeyDown={(event) => { if (event.key === 'Escape') close(); if (event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); save() } }}>
        <div className="modal-head"><h2>{editing === 'new' ? 'Agregar Actividad Física' : 'Editar Actividad Física'}</h2><button type="button" onClick={close} aria-label="Cerrar">×</button></div>
        <label>Actividad *<select required value={activitySelectValue} onChange={(event) => {
          const name = event.target.value
          if (name === OTHER_ACTIVITY) { setDraft((prev) => ({ ...prev, name: '' })); return }
          const preset = ACTIVITY_PRESETS.find(([label]) => label === name)
          setDraft((prev) => ({ ...prev, name, ...(preset ? { met: preset[1] } : {}) }))
        }}><option value="">Elige una actividad…</option>{ACTIVITY_PRESETS.map(([name, met]) => <option value={name} key={name}>{name}</option>)}<option value={OTHER_ACTIVITY}>Otra actividad…</option></select></label>
        {activitySelectValue === OTHER_ACTIVITY && <label>Nombre de la actividad *<input value={draft.name} required onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="Ej. Natación recreativa" /></label>}
        <label>Intensidad *<select value={draftIntensity || 'custom'} onChange={(event) => {
          if (event.target.value === 'custom') return
          const preset = MET_INTENSITIES.find(([label]) => label === event.target.value)
          if (preset) setDraft((prev) => ({ ...prev, met: preset[1] }))
        }}>{MET_INTENSITIES.map(([label, met]) => <option value={label} key={label}>{label} · {met} MET</option>)}<option value="custom">Personalizada (MET escrito)</option></select></label>
        <label>MET (Equivalente Metabólico)<span className="mets-met-box">⚡ MET: <input type="number" min="1" max="23" step="0.1" required value={draft.met} onChange={(event) => setDraft((prev) => ({ ...prev, met: event.target.value }))} aria-label="MET" /></span></label>
        <label>Minutos por día *<input type="number" min="1" max="600" required value={draft.minutes} onChange={(event) => setDraft((prev) => ({ ...prev, minutes: event.target.value }))} /><small className="mets-hint">Duración diaria de la actividad en minutos</small></label>
        <div className="mets-estimate is-warm" aria-live="polite">
          <b>Calorías estimadas por día: {draftSessionKcal != null ? `${Math.round(draftSessionKcal)} kcal` : 'falta el peso'}</b>
          <small>({draft.met || '—'} MET × {weightText} × {((Number(draft.minutes) || 0) / 60).toFixed(2)} h)</small>
        </div>
        <label>Días a la semana *<input type="number" min="1" max="7" required value={draft.sessionsPerWeek} onChange={(event) => setDraft((prev) => ({ ...prev, sessionsPerWeek: event.target.value }))} /><small className="mets-hint">Frecuencia semanal (1-7 días)</small></label>
        <div className="mets-estimate is-green" aria-live="polite">
          <b>Promedio de kcal por día: {draftDailyKcal != null ? `${Math.round(draftDailyKcal)} kcal` : 'falta el peso'}</b>
          <small>({draftSessionKcal != null ? Math.round(draftSessionKcal) : '—'} kcal × {draft.sessionsPerWeek || '—'} días ÷ 7)</small>
        </div>
        <div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="button" className="primary" disabled={!validActivity(draft)} onClick={save}>Guardar</button></div>
      </div>
    </div>}
  </div>
}
