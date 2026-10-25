import { useEffect, useRef, useState } from 'react'
import { plansApi } from '../../lib/api.js'

const formatDate = (iso) => {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Botón ⓘ junto al peso: abre los pesos registrados en las consultas anteriores (el mismo
// historial del Expediente) sin salir del Constructor. El peso del plan no se edita aquí: se
// confirma en Dietocálculo, que es donde se calcula el requerimiento.
export function WeightHistory({ items = [], currentKg = null }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  const rows = items.filter((item) => Number(item.weightKg) > 0)
  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (!boxRef.current?.contains(event.target)) setOpen(false) }
    const escape = (event) => { if (event.key === 'Escape') setOpen(false) }
    window.document.addEventListener('mousedown', close)
    window.document.addEventListener('keydown', escape)
    return () => { window.document.removeEventListener('mousedown', close); window.document.removeEventListener('keydown', escape) }
  }, [open])
  return <div className="weight-history" ref={boxRef}>
    <button type="button" className="weight-history-trigger" aria-label="Ver los pesos anteriores" aria-expanded={open} onClick={() => setOpen((value) => !value)}>ⓘ</button>
    {open && <div className="weight-history-pop" role="dialog" aria-label="Pesos anteriores">
      <b>Pesos anteriores</b>
      {rows.length > 0
        ? <ul>{rows.slice(0, 8).map((item, index) => <li key={item.id || `${item.measuredAt}-${index}`} className={Number(item.weightKg) === Number(currentKg) ? 'current' : ''}><span>{formatDate(item.measuredAt)}</span><strong>{Number(item.weightKg)} kg</strong></li>)}</ul>
        : <p>Aún no hay otros pesos registrados en el expediente.</p>}
      <small>Se toman de las mediciones de las consultas. El peso del plan se confirma en Dietocálculo.</small>
    </div>}
  </div>
}

// Objetivo terapéutico editable desde Evaluación, como en el diseño: se guarda solo al salir del
// campo (y con Ctrl/⌘+Enter). Va por PATCH del plan para no recalcular el requerimiento.
export function GoalEditor({ plan, locked, onSaved }) {
  const [draft, setDraft] = useState(plan?.goal || '')
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  const savedRef = useRef(plan?.goal || '')
  // El texto y el plan actuales, para guardar desde el temporizador o al desmontar sin depender
  // del render en que se programó.
  const draftRef = useRef(plan?.goal || '')
  const planIdRef = useRef(plan?.id || null)
  const onSavedRef = useRef(onSaved)
  const lockedRef = useRef(locked)
  const timerRef = useRef(null)
  planIdRef.current = plan?.id || null
  onSavedRef.current = onSaved
  lockedRef.current = locked

  const save = async () => {
    clearTimeout(timerRef.current)
    const planId = planIdRef.current
    if (!planId || lockedRef.current) return
    const next = draftRef.current.trim()
    if (next === savedRef.current) return
    setState('saving')
    setError('')
    try {
      const updated = await plansApi.update(planId, { goal: next })
      savedRef.current = updated?.goal ?? next
      setState('saved')
      onSavedRef.current?.(updated)
    } catch (saveError) {
      setState('error')
      setError(saveError?.message || 'No se pudo guardar el objetivo.')
    }
  }
  // Se guarda solo, con una pausa corta, para que el cambio no se pierda si se cambia de paso.
  const schedule = () => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(save, 700)
  }
  useEffect(() => {
    draftRef.current = plan?.goal || ''
    savedRef.current = plan?.goal || ''
    setDraft(plan?.goal || '')
    setState('idle')
    setError('')
  }, [plan?.id])
  // Al salir de la pantalla, lo escrito y no guardado se manda igual (como las indicaciones).
  useEffect(() => () => {
    clearTimeout(timerRef.current)
    const planId = planIdRef.current
    const next = draftRef.current.trim()
    if (planId && !lockedRef.current && next !== savedRef.current) plansApi.update(planId, { goal: next }).catch(() => {})
  }, [])
  return <div className="goal-editor">
    <textarea
      className="wide-textarea"
      placeholder="Resultado clínico y conductual esperado..."
      value={draft}
      disabled={locked}
      onChange={(event) => { draftRef.current = event.target.value; setDraft(event.target.value); setState('dirty'); setError(''); schedule() }}
      onBlur={save}
      onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save() } }}
    />
    <div className="goal-editor-foot">
      <small className="muted">Se guarda solo.</small>
      {state === 'saving' && <small className="muted">Guardando…</small>}
      {state === 'saved' && <small className="saved">Guardado ✓</small>}
      {state === 'dirty' && <small className="muted">Cambios sin guardar</small>}
      {state === 'error' && <small className="form-error">⚠ {error}</small>}
    </div>
  </div>
}
