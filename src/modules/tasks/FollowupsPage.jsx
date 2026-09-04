import { useCallback, useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { patientsApi, tasksApi } from '../../lib/api.js'

// Tasks only model the document-delivery queue for now (see prisma/seed.js): a plan or a
// consultation report waiting to reach the patient. Broader clinical reminders (weight
// checkins, lab confirmations…) would need a schema change and are out of scope here.
const TYPE_LABELS = { nutrition_plan: 'Plan de alimentación', consultation_report: 'Informe de consulta', consultation_export: 'Expediente completo' }
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
// "Today" is the viewer's real local calendar date, repackaged as a UTC midnight so the dueAt
// math (stored/seeded as UTC wall-clock) stays correct regardless of system timezone. This was
// previously a fixed demo date (26 ago 2026) which corrupted overdue counts against real data.
const now = new Date()
const TODAY = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
const todayISODate = () => TODAY.toISOString().slice(0, 10)

const DEMO_TASKS = [
  { id: 'demo-1', type: 'nutrition_plan', status: 'pending', dueAt: '2026-08-25T18:00:00.000Z', patient: { firstName: 'Mariana', lastName: 'Torres' } },
  { id: 'demo-2', type: 'nutrition_plan', status: 'pending', dueAt: '2026-08-26T18:00:00.000Z', patient: { firstName: 'Diego', lastName: 'Ramírez' } },
  { id: 'demo-3', type: 'consultation_report', status: 'pending', dueAt: '2026-08-27T18:00:00.000Z', patient: { firstName: 'Sofía', lastName: 'Hernández' } },
]

const formatUTCDate = (iso) => { const d = new Date(iso); return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
const daysUntil = (iso) => Math.round((new Date(iso).setUTCHours(0, 0, 0, 0) - TODAY.getTime()) / 86400000)
const emptyForm = () => ({ patientId: '', type: 'nutrition_plan', dueAt: todayISODate() })

export default function FollowupsPage({ setActive }) {
  const [filter, setFilter] = useState('Todos')
  const [search, setSearch] = useState('')
  const [tasks, setTasks] = useState([])
  const [status, setStatus] = useState('loading')
  const [patients, setPatients] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [submitState, setSubmitState] = useState('idle')
  const [submitError, setSubmitError] = useState('')

  const loadTasks = useCallback(async () => {
    setStatus('loading')
    try {
      const response = await tasksApi.list()
      setTasks(response.items || [])
      setStatus('online')
    } catch (error) {
      if (error.code === 'DEMO_MODE') { setTasks(DEMO_TASKS); setStatus('demo') }
      else { setTasks([]); setStatus('error') }
    }
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])
  useEffect(() => { patientsApi.list('?status=ACTIVE').then((payload) => setPatients(payload.items || [])).catch(() => setPatients([])) }, [])

  const pending = tasks.filter((t) => t.status === 'pending')
  const overdue = pending.filter((t) => daysUntil(t.dueAt) < 0)
  const completed = tasks.filter((t) => t.status === 'completed')
  const q = search.trim().toLowerCase()
  const visible = tasks.filter((t) => (filter === 'Todos' || (filter === 'Completados' ? t.status === 'completed' : t.status === 'pending')) && (!q || `${t.patient?.firstName || ''} ${t.patient?.lastName || ''}`.toLowerCase().includes(q)))

  const markDelivered = async (id) => {
    try {
      const updated = await tasksApi.complete(id)
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)))
    } catch { /* The row keeps its previous state; the professional can retry. */ }
  }

  const openModal = () => { setForm(emptyForm()); setSubmitError(''); setSubmitState('idle'); setOpen(true) }
  const closeModal = () => { setOpen(false); setSubmitError('') }
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    if (status !== 'online') { closeModal(); return }
    if (!form.patientId) { setSubmitError('Selecciona un paciente.'); return }
    setSubmitState('saving')
    setSubmitError('')
    try {
      await tasksApi.create({ patientId: form.patientId, type: form.type, dueAt: `${form.dueAt}T18:00:00.000Z` })
      setSubmitState('saved')
      closeModal()
      loadTasks()
    } catch (error) {
      setSubmitState('error')
      setSubmitError(error.message || 'No se pudo crear el seguimiento.')
    }
  }

  return <AppChrome active="Seguimientos" setActive={setActive}><div className="content">
    <ModuleHeader eyebrow={`SEGUIMIENTO · ${pending.length} ACTIVOS`} title="Seguimientos" subtitle="Cola de planes e informes pendientes de entrega." action={<div className="module-actions"><span className={'sync-label ' + (status === 'online' ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'online' ? 'Sincronizado' : status === 'loading' ? 'Cargando…' : status === 'error' ? 'Sin conexión' : 'Datos de demostración'}</span><button className="primary" onClick={openModal}><span>+</span> Nuevo seguimiento</button></div>} />

    <div className="followup-summary">
      <div className="followup-stat panel"><span className="stat-icon mint">◷</span><div><b>{pending.length}</b><small>Pendientes de envío</small></div></div>
      <div className="followup-stat panel"><span className="stat-icon orange">⚠</span><div><b>{overdue.length}</b><small>Vencidos</small></div></div>
      <div className="followup-stat panel"><span className="stat-icon purple">✓</span><div><b>{completed.length}</b><small>Entregados</small></div></div>
    </div>

    <div className="followup-toolbar panel">
      <div className="search-field">⌕ <input placeholder="Buscar paciente..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <div className="view-switch">{['Todos', 'Pendientes', 'Completados'].map((x) => <button className={filter === x ? 'selected' : ''} onClick={() => setFilter(x)} key={x}>{x}</button>)}</div>
    </div>

    <div className="followup-table panel">
      <div className="followup-head"><span>Paciente</span><span>Documento pendiente</span><span>Fecha límite</span><span>Vencimiento</span><span>Estado</span><span /></div>

      {status === 'loading' && <div className="result-empty"><span className="loading-dot">●</span><h3>Cargando seguimientos…</h3></div>}
      {status !== 'loading' && visible.length === 0 && <div className="result-empty"><span>◌</span><h3>No hay seguimientos aquí</h3><p>No hay documentos en esta vista por ahora.</p></div>}

      {visible.map((task) => {
        const delta = daysUntil(task.dueAt)
        const dueLabel = task.status === 'completed' ? 'Entregado' : delta < 0 ? `Vencido hace ${Math.abs(delta)} día(s)` : delta === 0 ? 'Vence hoy' : `Vence en ${delta} día(s)`
        const initials = `${task.patient?.firstName?.[0] || ''}${task.patient?.lastName?.[0] || ''}`
        const name = task.patient ? `${task.patient.firstName} ${task.patient.lastName}` : 'Paciente'
        return <div className="followup-row" key={task.id}>
          <div className="patient-name"><span className="person-avatar coral">{initials}</span><b>{name}</b></div>
          <span className="muted">{TYPE_LABELS[task.type] || task.type}</span>
          <b className="appointment-date">{formatUTCDate(task.dueAt)}</b>
          <span className="muted">{dueLabel}</span>
          <span className={'status ' + (task.status === 'completed' ? 'confirmed' : 'pending')}>{task.status === 'completed' ? 'Entregado' : 'Pendiente'}</span>
          {task.status === 'pending' ? <button className="row-arrow" title="Marcar como entregado" onClick={() => markDelivered(task.id)} disabled={status !== 'online'}>✓</button> : <span className="row-arrow">✓</span>}
        </div>
      })}
    </div>
  </div>

  {open && <div className="modal-backdrop" onClick={closeModal}><div className="modal" onClick={(e) => e.stopPropagation()}>
    <div className="modal-head"><h2>Nuevo seguimiento</h2><button onClick={closeModal}>×</button></div>
    <form onSubmit={submit}>
      <label>Paciente<select value={form.patientId} onChange={(e) => update('patientId', e.target.value)} required><option value="">Selecciona…</option>{patients.map((p) => <option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select></label>
      <label>Documento<select value={form.type} onChange={(e) => update('type', e.target.value)}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Fecha límite<input type="date" value={form.dueAt} onChange={(e) => update('dueAt', e.target.value)} required /></label>
      {submitError && <div className="form-error">⚠ {submitError}</div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={closeModal}>Cancelar</button><button className="primary" disabled={submitState === 'saving'}>{submitState === 'saving' ? 'Guardando…' : 'Crear seguimiento'}</button></div>
    </form>
  </div></div>}
  </AppChrome>
}
