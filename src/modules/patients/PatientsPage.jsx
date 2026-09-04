import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { patientsApi } from '../../lib/api.js'

const patients = [
  ['MT', 'Mariana Torres', '28 años · Femenino', 'Hoy, 09:00', 'Primera consulta', 'coral', null],
  ['DR', 'Diego Ramírez', '34 años · Masculino', 'Hoy, 10:30', 'Seguimiento', 'blue', null],
  ['SH', 'Sofía Hernández', '31 años · Femenino', 'Hoy, 12:00', 'Por confirmar', 'purple', null],
  ['JC', 'Jorge Castillo', '42 años · Masculino', '28 ago, 16:30', 'Control rápido', 'yellow', null],
  ['AR', 'Ana Rodríguez', '26 años · Femenino', 'Sin cita', 'Plan pendiente', 'coral', null],
]

const APPOINTMENT_TYPE_LABELS = { INITIAL: 'Primera consulta', FOLLOW_UP: 'Seguimiento', QUICK_CONTROL: 'Control rápido', EMERGENCY: 'Emergencia', BLOCK: 'Bloqueo' }
const CONSULTATION_STATUS_LABELS = { DRAFT: 'Borrador', IN_PROGRESS: 'En progreso', COMPLETED: 'Completada' }
const PLAN_STATUS_LABELS = { DRAFT: 'Borrador', READY: 'Lista', PUBLISHED: 'Publicado', SUPERSEDED: 'Reemplazado' }
const DOCUMENT_TYPE_LABELS = { nutrition_plan: 'Plan de alimentación', consultation_report: 'Informe de consulta', consultation_export: 'Expediente completo' }
const DOCUMENT_STATUS_LABELS = { DELIVERED: 'Entregado', GENERATED: 'Generado', PENDING: 'Pendiente' }
const AUDIT_LABELS = {
  'Patient:archived': 'Paciente archivado',
  'Patient:reactivated': 'Paciente reactivado',
  'Patient:updated': 'Datos del paciente editados',
  'Diagnosis:created': 'Diagnóstico agregado',
  'Diagnosis:updated': 'Diagnóstico editado',
  'Diagnosis:deleted': 'Diagnóstico eliminado',
  'NutritionPlan:published': 'Plan publicado',
  'Document:delivered': 'Documento entregado',
  'LabAttachment:uploaded': 'PDF de análisis clínicos adjuntado',
}
const DONE_STATUSES = new Set(['CONFIRMED', 'COMPLETED', 'PUBLISHED', 'DELIVERED', 'DONE'])
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const formatUTCDate = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
// "Próxima cita" shows the upcoming appointment's date + time (UTC wall-clock convention, same
// as Agenda) -- before fase 50 this cell was a hardcoded "Sin cita" for every patient.
const formatNextAppointment = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }

function describeEvent(event) {
  if (event.kind === 'appointment') return { icon: '◷', label: `Cita · ${APPOINTMENT_TYPE_LABELS[event.subtype] || event.subtype}` }
  if (event.kind === 'consultation') return { icon: '▤', label: `Consulta · ${CONSULTATION_STATUS_LABELS[event.status] || event.status}` }
  if (event.kind === 'plan') return { icon: '▦', label: `Plan · ${PLAN_STATUS_LABELS[event.status] || event.status}` }
  if (event.kind === 'audit') { const base = AUDIT_LABELS[`${event.entity}:${event.action}`] || `${event.entity} · ${event.action}`; return { icon: '◈', label: event.userName ? `${base} · ${event.userName}` : base } }
  return { icon: '▧', label: `${DOCUMENT_TYPE_LABELS[event.subtype] || 'Documento'} · ${DOCUMENT_STATUS_LABELS[event.status] || event.status}` }
}

const emptyEditForm = (patient) => ({ firstName: patient?.firstName || '', lastName: patient?.lastName || '', email: patient?.email || '', phone: patient?.phone || '', birthDate: patient?.birthDate ? patient.birthDate.slice(0, 10) : '', sex: patient?.sex || 'Femenino', occupation: patient?.occupation || '' })

export default function PatientsPage({ setActive, onSelectPatient }) {
  const [rows, setRows] = useState(patients)
  const [status, setStatus] = useState('loading')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [editState, setEditState] = useState('idle')
  const [editError, setEditError] = useState('')
  const [timeline, setTimeline] = useState([])
  const [timelineState, setTimelineState] = useState('idle')
  const [statusFilter, setStatusFilter] = useState('ACTIVE')
  const [sortBy, setSortBy] = useState('recent')
  const [archiveState, setArchiveState] = useState('idle')

  useEffect(() => {
    setStatus('loading')
    const isNoNext = statusFilter === 'NO_NEXT'
    patientsApi.list(`?status=${isNoNext ? 'ACTIVE' : statusFilter}${isNoNext ? '&noNext=1' : ''}`)
      .then((payload) => {
        setRows(payload?.items?.length ? payload.items.map((p, i) => [p.firstName.slice(0, 1) + p.lastName.slice(0, 1), `${p.firstName} ${p.lastName}`, `${p.sex || 'Paciente'}`, p.nextAppointmentAt ? formatNextAppointment(p.nextAppointmentAt) : '—', p.nextAppointmentAt ? (APPOINTMENT_TYPE_LABELS[p.nextAppointmentType] || p.nextAppointmentType) : 'Sin cita próxima', ['coral', 'blue', 'purple', 'yellow'][i % 4], p.id, p]) : [])
        setStatus('online')
      })
      .catch(() => setStatus('demo'))
  }, [statusFilter])

  useEffect(() => {
    if (!selected?.[6]) { setTimeline([]); setTimelineState('idle'); return }
    setTimelineState('loading')
    patientsApi.timeline(selected[6])
      .then((response) => { setTimeline(response.items || []); setTimelineState('ready') })
      .catch(() => setTimelineState('error'))
  }, [selected?.[6]])

  const visible = rows
    .filter((p) => p[1].toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (sortBy === 'name' ? a[1].localeCompare(b[1]) : new Date(b[7]?.createdAt || 0) - new Date(a[7]?.createdAt || 0)))
  const goTo = (module) => { if (selected?.[6]) onSelectPatient?.(selected[6]); setActive(module) }

  const openPatient = (row) => { setSelected(row); setEditing(false); setEditState('idle'); setEditError('') }
  const closeDrawer = () => { setSelected(null); setEditing(false) }
  const startEdit = () => { setEditForm(emptyEditForm(selected[7])); setEditState('idle'); setEditError(''); setEditing(true) }
  const updateField = (key, value) => setEditForm((prev) => ({ ...prev, [key]: value }))

  const toggleArchive = async () => {
    if (!selected?.[6]) return
    const nextStatus = selected[7]?.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED'
    setArchiveState('saving')
    try {
      await patientsApi.update(selected[6], { status: nextStatus })
      setRows((prev) => prev.filter((row) => row[6] !== selected[6]))
      setSelected(null)
      setArchiveState('idle')
    } catch {
      setArchiveState('error')
    }
  }

  const saveEdit = async (event) => {
    event.preventDefault()
    setEditState('saving')
    setEditError('')
    try {
      const updated = await patientsApi.update(selected[6], editForm)
      const nextRow = [updated.firstName.slice(0, 1) + updated.lastName.slice(0, 1), `${updated.firstName} ${updated.lastName}`, `${updated.sex || 'Paciente'}`, selected[3], selected[4], selected[5], selected[6], updated]
      setRows((prev) => prev.map((row) => (row[6] === selected[6] ? nextRow : row)))
      setSelected(nextRow)
      setEditing(false)
    } catch (error) {
      setEditState('error')
      setEditError(error.message || 'No se pudo guardar los cambios.')
    }
  }

  return <AppChrome active="Pacientes" setActive={setActive}><div className="content">
    <ModuleHeader eyebrow={`TU ESPACIO · ${rows.length} ${statusFilter === 'ACTIVE' ? 'ACTIVOS' : statusFilter === 'ARCHIVED' ? 'ARCHIVADOS' : 'SIN CITA PRÓXIMA'}`} title="Pacientes" subtitle="Conoce el progreso y el contexto de cada persona." action={<div className="module-actions"><span className={'sync-label ' + status}>● {status === 'online' ? 'Sincronizados' : 'Datos de demostración'}</span><button className="primary" onClick={() => setActive('Nuevo paciente')}><span>+</span> Nuevo paciente</button></div>} />
    <div className="filter-bar panel"><div className="search-field">⌕ <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, teléfono o email..." /></div><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="ACTIVE">Activos</option><option value="ARCHIVED">Archivados</option><option value="NO_NEXT">Sin cita próxima</option></select></div>
    <div className="table-panel panel">
      <div className="table-meta">Mostrando <b>{visible.length} pacientes</b><label className="sort-select">Ordenar por: <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="recent">Más recientes</option><option value="name">Nombre A-Z</option></select></label></div>
      <div className="patient-table">
        <div className="table-head"><span>Paciente</span><span>Última consulta</span><span>Próxima cita</span><span>Estado</span><span /></div>
        {visible.map((p, i) => <div className="patient-row" key={p[1]} onClick={() => openPatient(p)}><div className="patient-name"><span className={'person-avatar ' + p[5]}>{p[0]}</span><div><b>{p[1]}</b><small>{p[2]}</small></div></div><span className="muted">{p[7]?.lastConsultationAt ? formatUTCDate(p[7].lastConsultationAt) : '—'}</span><span><b className="appointment-date">{p[3]}</b><small className="muted">{p[4]}</small></span><span className={p[7]?.status === 'ARCHIVED' ? 'status pending' : 'status confirmed'}>{p[7]?.status === 'ARCHIVED' ? 'Archivado' : 'Activo'}</span><span className="row-arrow">→</span></div>)}
      </div>
    </div>
  </div>

  {selected && <div className="drawer-backdrop" onClick={closeDrawer}><aside className="patient-drawer" onClick={(e) => e.stopPropagation()}>
    <button className="drawer-close" onClick={closeDrawer}>×</button>
    <span className={'person-avatar ' + selected[5] + ' large-avatar'}>{selected[0]}</span>

    {!editing ? <>
      <h2>{selected[1]}</h2>
      <p className="muted">{selected[2]}</p>
      {!selected[6] && <p className="muted">Este es un registro de demostración, no tiene expediente ni plan reales.</p>}
      <div className="drawer-actions">
        <button className="primary" disabled={!selected[6]} onClick={() => goTo('Expediente')}>Abrir expediente</button>
        <button className="secondary" disabled={!selected[6]} onClick={() => goTo('Constructor de plan')}>Ir al plan</button>
      </div>
      {selected[6] && <div className="drawer-section">
        <p className="eyebrow">CONTACTO Y PRÓXIMA CITA</p>
        {selected[7]?.phone || selected[7]?.email
          ? <p className="muted">{[selected[7].phone, selected[7].email].filter(Boolean).join(' · ')}</p>
          : <p className="muted">Sin contacto registrado.</p>}
        {selected[7]?.nextAppointmentAt
          ? <p className="muted">Próxima cita: <b>{formatNextAppointment(selected[7].nextAppointmentAt)}</b> · {APPOINTMENT_TYPE_LABELS[selected[7].nextAppointmentType] || selected[7].nextAppointmentType}</p>
          : <p className="muted">Sin cita próxima programada.</p>}
      </div>}
      {selected[6] && <button className="link-button" onClick={startEdit}>Editar datos del paciente →</button>}
      {selected[6] && <button className="link-button" disabled={archiveState === 'saving'} onClick={toggleArchive}>{archiveState === 'saving' ? 'Guardando…' : selected[7]?.status === 'ARCHIVED' ? 'Reactivar paciente →' : 'Archivar paciente →'}</button>}
      {archiveState === 'error' && <div className="form-error">⚠ No se pudo actualizar el estado del paciente.</div>}
    </> : <form onSubmit={saveEdit}>
      <h2>Editar paciente</h2>
      <div className="form-grid">
        <label>Nombre(s)<input value={editForm.firstName} onChange={(e) => updateField('firstName', e.target.value)} required /></label>
        <label>Apellidos<input value={editForm.lastName} onChange={(e) => updateField('lastName', e.target.value)} required /></label>
        <label>Fecha de nacimiento<input type="date" value={editForm.birthDate} onChange={(e) => updateField('birthDate', e.target.value)} /></label>
        <label>Sexo<select value={editForm.sex} onChange={(e) => updateField('sex', e.target.value)}><option>Femenino</option><option>Masculino</option><option>Prefiero no decirlo</option></select></label>
        <label>Email<input type="email" value={editForm.email} onChange={(e) => updateField('email', e.target.value)} /></label>
        <label>Teléfono<input value={editForm.phone} onChange={(e) => updateField('phone', e.target.value)} /></label>
        <label>Ocupación<input value={editForm.occupation} onChange={(e) => updateField('occupation', e.target.value)} /></label>
      </div>
      {editState === 'error' && <div className="form-error">⚠ {editError}</div>}
      <div className="form-actions"><button type="button" className="secondary" onClick={() => setEditing(false)}>Cancelar</button><button className="primary" disabled={editState === 'saving'}>{editState === 'saving' ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </form>}

    {!editing && selected[6] && <div className="drawer-section">
      <p className="eyebrow">LÍNEA DE TIEMPO</p>
      {timelineState === 'loading' && <p className="muted">Cargando…</p>}
      {timelineState === 'error' && <p className="muted">No se pudo cargar el historial.</p>}
      {timelineState === 'ready' && timeline.length === 0 && <p className="muted">Sin actividad registrada todavía.</p>}
      {timeline.length > 0 && <div className="check-list">{timeline.map((event) => { const { icon, label } = describeEvent(event); return <div key={`${event.kind}-${event.id}`}><span className={'check-dot ' + (DONE_STATUSES.has(event.status) ? 'done-dot' : '')}>{icon}</span><span>{label}</span><small>{formatUTCDate(event.date)}</small></div> })}</div>}
    </div>}

    <div className="drawer-section"><p className="eyebrow">ESTADO DE CONEXIÓN</p><b>{status === 'online' ? 'Registro persistente' : 'Registro de demostración'}</b></div>
  </aside></div>}
  </AppChrome>
}
