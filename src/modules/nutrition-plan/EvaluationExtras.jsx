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
  useEffect(() => {
    setDraft(plan?.goal || '')
    savedRef.current = plan?.goal || ''
    setState('idle')
    setError('')
  }, [plan?.id])
  const save = async () => {
    if (!plan || locked) return
    const next = draft.trim()
    if (next === savedRef.current) return
    setState('saving')
    setError('')
    try {
      const updated = await plansApi.update(plan.id, { goal: next })
      savedRef.current = updated?.goal ?? next
      setState('saved')
      onSaved?.(updated)
    } catch (saveError) {
      setState('error')
      setError(saveError?.message || 'No se pudo guardar el objetivo.')
    }
  }
  return <div className="goal-editor">
    <textarea
      className="wide-textarea"
      placeholder="Resultado clínico y conductual esperado..."
      value={draft}
      disabled={locked}
      onChange={(event) => { setDraft(event.target.value); setState('dirty'); setError('') }}
      onBlur={save}
      onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.blur() } }}
    />
    <div className="goal-editor-foot">
      <small className="muted">Se guarda al salir del campo.</small>
      {state === 'saving' && <small className="muted">Guardando…</small>}
      {state === 'saved' && <small className="saved">Guardado ✓</small>}
      {state === 'dirty' && <small className="muted">Cambios sin guardar</small>}
      {state === 'error' && <small className="form-error">⚠ {error}</small>}
    </div>
  </div>
}
