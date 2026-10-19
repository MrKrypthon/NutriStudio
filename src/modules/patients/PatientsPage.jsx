import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { patientsApi } from '../../lib/api.js'
import { normalizeSex, sexLabel } from '../../lib/sex.js'
import { deviceLabel } from '../../lib/device.js'

const patients = [
  ['MT', 'Mariana Torres', '28 años · Mujer', 'Hoy, 09:00', 'Primera consulta', 'coral', null],
  ['DR', 'Diego Ramírez', '34 años · Hombre', 'Hoy, 10:30', 'Seguimiento', 'blue', null],
  ['SH', 'Sofía Hernández', '31 años · Mujer', 'Hoy, 12:00', 'Por confirmar', 'purple', null],
  ['JC', 'Jorge Castillo', '42 años · Hombre', '28 ago, 16:30', 'Control rápido', 'yellow', null],
  ['AR', 'Ana Rodríguez', '26 años · Mujer', 'Sin cita', 'Plan pendiente', 'coral', null],
]

const APPOINTMENT_TYPE_LABELS = { INITIAL: 'Primera consulta', FOLLOW_UP: 'Seguimiento', QUICK_CONTROL: 'Control rápido', EMERGENCY: 'Emergencia', BLOCK: 'Bloqueo' }
const CONSULTATION_STATUS_LABELS = { DRAFT: 'Borrador', IN_PROGRESS: 'En progreso', COMPLETED: 'Completada' }
const PLAN_STATUS_LABELS = { DRAFT: 'Borrador', READY: 'Lista', PUBLISHED: 'Publicado', SUPERSEDED: 'Reemplazado', CANCELLED: 'Cancelado' }
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
  'NutritionPlan:created': 'Plan creado',
  'NutritionPlan:cancelled': 'Plan cancelado',
  'NutritionPlan:reactivated': 'Plan reactivado',
  'Document:created': 'Documento creado',
  'Appointment:cancelled': 'Cita cancelada',
  'Appointment:no_show': 'No asistió a la cita',
  'NutritionPlan:updated': 'Plan editado',
  'ClinicalSection:created': 'Expediente capturado',
  'ClinicalSection:updated': 'Expediente editado',
  'Measurement:created': 'Medición registrada',
  'Measurement:updated': 'Medición corregida',
  'Consultation:reopened': 'Consulta reabierta',
  'Consultation:auto_closed': 'Consulta cerrada automáticamente',
  'Document:delivered': 'Documento entregado',
  'LabAttachment:uploaded': 'PDF de análisis clínicos adjuntado',
}

const DONE_STATUSES = new Set(['COMPLETED', 'PUBLISHED', 'DELIVERED', 'DONE'])
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const formatUTCDate = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
// Las citas guardan la hora "de pared" con sufijo Z (se leen en UTC); lo demás (consultas, auditoría,
// documentos) son marcas de tiempo reales y van en el día local.
const formatLocalDate = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` }
const formatEventDate = (event) => (event.kind === 'appointment' ? formatUTCDate(event.date) : formatLocalDate(event.date))
// "Próxima cita" shows the upcoming appointment's date + time (UTC wall-clock convention, same
// as Agenda) -- before fase 50 this cell was a hardcoded "Sin cita" for every patient.
const formatNextAppointment = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }

function describeEvent(event) {
  if (event.kind === 'appointment') return { icon: '◷', label: `Cita · ${APPOINTMENT_TYPE_LABELS[event.subtype] || event.subtype}` }
  if (event.kind === 'consultation') return { icon: '▤', label: `Consulta · ${CONSULTATION_STATUS_LABELS[event.status] || event.status}` }
  if (event.kind === 'plan') return { icon: '▦', label: `Plan · ${PLAN_STATUS_LABELS[event.status] || event.status}` }
  if (event.kind === 'audit') { const base = AUDIT_LABELS[`${event.entity}:${event.action}`] || `${event.entity} · ${event.action}`; const device = deviceLabel(event.metadata?.origin?.agent); return { icon: '◈', label: [base, event.userName, device && `desde ${device}`].filter(Boolean).join(' · ') } }
  return { icon: '▧', label: `${DOCUMENT_TYPE_LABELS[event.subtype] || 'Documento'} · ${DOCUMENT_STATUS_LABELS[event.status] || event.status}` }
}

const emptyEditForm = (patient) => ({ firstName: patient?.firstName || '', lastName: patient?.lastName || '', email: patient?.email || '', phone: patient?.phone || '', birthDate: patient?.birthDate ? patient.birthDate.slice(0, 10) : '', sex: normalizeSex(patient?.sex) || 'Mujer', occupation: patient?.occupation || '', address: patient?.address || '', curp: patient?.curp || '' })

export default function PatientsPage({ setActive, onSelectPatient, onOpenPatient, onNewAppointment }) {
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
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [sortBy, setSortBy] = useState('recent')
  const [archiveState, setArchiveState] = useState('idle')
  // La búsqueda y el orden van al servidor: filtrar sólo la página cargada (25) escondía a los
  // pacientes de las demás páginas. Se espera a que dejes de teclear para no pedir en cada letra.
  const [query, setQuery] = useState('')
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1) }, 300); return () => clearTimeout(timer) }, [search])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    const isNoNext = statusFilter === 'NO_NEXT'
    patientsApi.list(`?status=${isNoNext ? 'ACTIVE' : statusFilter}${isNoNext ? '&noNext=1' : ''}&page=${page}&pageSize=25&sort=${sortBy}${query ? `&search=${encodeURIComponent(query)}` : ''}`)
      .then((payload) => {
        if (cancelled) return
        setRows(payload?.items?.length ? payload.items.map((p, i) => [p.firstName.slice(0, 1) + p.lastName.slice(0, 1), `${p.firstName} ${p.lastName}`, `${sexLabel(p.sex) || 'Paciente'}`, p.nextAppointmentAt ? formatNextAppointment(p.nextAppointmentAt) : '—', p.nextAppointmentAt ? (APPOINTMENT_TYPE_LABELS[p.nextAppointmentType] || p.nextAppointmentType) : 'Sin cita próxima', ['coral', 'blue', 'purple', 'yellow'][i % 4], p.id, p]) : [])
        setTotal(payload?.total ?? (payload?.items?.length || 0))
        setStatus('online')
      })
      .catch(() => { if (!cancelled) setStatus('demo') })
    return () => { cancelled = true }
  }, [statusFilter, page, sortBy, query])

  const loadTimeline = (patientId) => {
    setTimelineState('loading')
    patientsApi.timeline(patientId)
      .then((response) => { setTimeline(response.items || []); setTimelineState('ready') })
      .catch(() => setTimelineState('error'))
  }

  useEffect(() => {
    if (!selected?.[6]) { setTimeline([]); setTimelineState('idle'); return }
    loadTimeline(selected[6])
  }, [selected?.[6]])

  // Con datos reales el servidor ya filtró y ordenó; el filtro local queda para la demostración.
  const visible = status === 'online' ? rows : rows.filter((p) => [p[1], p[7]?.email, p[7]?.phone].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()))
  const pages = Math.max(1, Math.ceil((total || 0) / 25))
  // Se navega con el paciente en el mismo salto para que quede en la dirección: hacerlo en dos
  // pasos (elegir paciente y luego cambiar de módulo) dejaba la URL sin el id y recargar sacaba de
  // la pantalla.
  const goTo = (module) => {
    if (selected?.[6] && onOpenPatient) { onOpenPatient(selected[6], module); return }
    if (selected?.[6]) onSelectPatient?.(selected[6])
    setActive(module)
  }

  const openPatient = (row) => { setSelected(row); setEditing(false); setEditState('idle'); setEditError(''); setArchiveState('idle') }
  const closeDrawer = () => { setSelected(null); setEditing(false) }
  const startEdit = () => { setEditForm(emptyEditForm(selected[7])); setEditState('idle'); setEditError(''); setEditing(true) }
  const updateField = (key, value) => setEditForm((prev) => ({ ...prev, [key]: value }))

  const toggleArchive = async () => {
    if (!selected?.[6]) return
    const nextStatus = selected[7]?.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED'
    if (nextStatus === 'ARCHIVED' && !window.confirm(`¿Archivar a ${selected[1]}? Saldrá de la lista de activos; podrás reactivarlo desde "Archivados".`)) return
    setArchiveState('saving')
    try {
      await patientsApi.update(selected[6], { status: nextStatus })
      setRows((prev) => prev.filter((row) => row[6] !== selected[6]))
      setTotal((prev) => Math.max(0, prev - 1))
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
      const nextRow = [updated.firstName.slice(0, 1) + updated.lastName.slice(0, 1), `${updated.firstName} ${updated.lastName}`, `${sexLabel(updated.sex) || 'Paciente'}`, selected[3], selected[4], selected[5], selected[6], updated]
      setRows((prev) => prev.map((row) => (row[6] === selected[6] ? nextRow : row)))
      setSelected(nextRow)
      setEditing(false)
      // The edit just logged a Patient:updated audit event; refresh the open drawer's timeline.
      loadTimeline(updated.id)
    } catch (error) {
      setEditState('error')
      setEditError(error.message || 'No se pudo guardar los cambios.')
    }
  }

  return <AppChrome active="Pacientes" setActive={setActive}><div className="content">
    <ModuleHeader eyebrow={`TU ESPACIO · ${status === 'online' ? total : rows.length} ${statusFilter === 'ACTIVE' ? 'ACTIVOS' : statusFilter === 'ARCHIVED' ? 'ARCHIVADOS' : 'SIN CITA PRÓXIMA'}`} title="Pacientes" subtitle="Conoce el progreso y el contexto de cada persona." action={<div className="module-actions"><span className={'sync-label ' + status}>● {status === 'online' ? 'Sincronizados' : 'Datos de demostración'}</span><button className="primary" onClick={() => setActive('Nuevo paciente')}><span>+</span> Nuevo paciente</button></div>} />
    <div className="filter-bar panel"><div className="search-field">⌕ <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, teléfono o email..." /></div><select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}><option value="ACTIVE">Activos</option><option value="ARCHIVED">Archivados</option><option value="NO_NEXT">Sin cita próxima</option></select></div>
    <div className="table-panel panel">
      <div className="table-meta">Mostrando <b>{visible.length} {visible.length === 1 ? 'paciente' : 'pacientes'}</b>{status === 'online' && total > visible.length ? ` de ${total}` : ''}<label className="sort-select">Ordenar por: <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(1) }}><option value="recent">Más recientes</option><option value="name">Nombre A-Z</option></select></label></div>
      <div className="patient-table">
        <div className="table-head"><span>Paciente</span><span>Última consulta</span><span>Próxima cita</span><span>Estado</span><span /></div>
        {visible.map((p, i) => <div className={'patient-row' + (selected?.[6] === p[6] ? ' selected' : '')} key={p[6] || p[1]} onClick={() => openPatient(p)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPatient(p) } }}><div className="patient-name"><span className={'person-avatar ' + p[5]}>{p[0]}</span><div><b>{p[1]}</b><small>{p[2]}</small></div></div><span className="muted">{p[7]?.lastConsultationAt ? formatLocalDate(p[7].lastConsultationAt) : '—'}</span><span><b className="appointment-date">{p[3]}</b><small className="muted">{p[4]}</small></span><span className={p[7]?.status === 'ARCHIVED' ? 'status pending' : 'status confirmed'}>{p[7]?.status === 'ARCHIVED' ? 'Archivado' : 'Activo'}</span><span className="row-arrow">→</span></div>)}
        {status !== 'loading' && visible.length === 0 && <div className="result-empty"><span>◌</span><h3>{query ? 'Sin pacientes con esa búsqueda' : statusFilter === 'NO_NEXT' ? 'No hay pacientes sin cita próxima' : statusFilter === 'ARCHIVED' ? 'No hay pacientes archivados' : 'No hay pacientes aún'}</h3><p>Ajusta la búsqueda o crea un paciente nuevo.</p></div>}
      </div>
      {status === 'online' && pages > 1 && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '12px 0' }}><button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Anterior</button><span className="muted">Página {page} de {pages}</span><button type="button" className="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente →</button></div>}
    </div>
  </div>

  {selected && <div className="drawer-backdrop" onClick={closeDrawer}><aside className="patient-drawer" onClick={(e) => e.stopPropagation()}>
    <button className="drawer-close" onClick={closeDrawer}>×</button>
    <span className={'person-avatar ' + selected[5] + ' large-avatar'}>{selected[0]}</span>

    {!editing ? <>
      <h2>{selected[1]}</h2>
      <p className="muted">{selected[2]}{selected[7]?.recordNumber ? ` · Expediente N.º ${String(selected[7].recordNumber).padStart(5, '0')}` : ''}</p>
      {!selected[6] && <p className="muted">Este es un registro de demostración, no tiene expediente ni plan reales.</p>}
      <div className="drawer-actions">
        <button className="primary" disabled={!selected[6]} onClick={() => goTo('Expediente')}>Abrir expediente</button>
        <button className="secondary" disabled={!selected[6]} onClick={() => goTo('Constructor de plan')}>Ir al plan</button>
        <button className="secondary" disabled={!selected[6]} onClick={() => onNewAppointment?.(selected[6])}>▱ Agendar cita</button>
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
        <label>Sexo<select value={editForm.sex} onChange={(e) => updateField('sex', e.target.value)}><option>Hombre</option><option>Mujer</option></select></label>
        <label>Email<input type="email" value={editForm.email} onChange={(e) => updateField('email', e.target.value)} /></label>
        <label>Teléfono<input value={editForm.phone} onChange={(e) => updateField('phone', e.target.value)} /></label>
        <label>Ocupación<input value={editForm.occupation} onChange={(e) => updateField('occupation', e.target.value)} /></label>
        <label>Domicilio<input value={editForm.address} maxLength={240} onChange={(e) => updateField('address', e.target.value)} placeholder="Calle, número, colonia, municipio" /></label>
        <label>CURP<input value={editForm.curp} maxLength={18} onChange={(e) => updateField('curp', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="18 caracteres" /></label>
      </div>
      {editState === 'error' && <div className="form-error">⚠ {editError}</div>}
      <div className="form-actions"><button type="button" className="secondary" onClick={() => setEditing(false)}>Cancelar</button><button className="primary" disabled={editState === 'saving'}>{editState === 'saving' ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </form>}

    {!editing && selected[6] && <div className="drawer-section">
      <p className="eyebrow">LÍNEA DE TIEMPO</p>
      {timelineState === 'loading' && <p className="muted">Cargando…</p>}
      {timelineState === 'error' && <p className="muted">No se pudo cargar el historial.</p>}
      {timelineState === 'ready' && timeline.length === 0 && <p className="muted">Sin actividad registrada todavía.</p>}
      {timeline.length > 0 && <div className="check-list">{timeline.map((event) => { const { icon, label } = describeEvent(event); return <div key={`${event.kind}-${event.id}`}><span className={'check-dot ' + (DONE_STATUSES.has(event.status) ? 'done-dot' : '')}>{icon}</span><span>{label}</span><small>{formatEventDate(event)}</small></div> })}</div>}
    </div>}

    <div className="drawer-section"><p className="eyebrow">ESTADO DE CONEXIÓN</p><b>{status === 'online' ? 'Registro persistente' : 'Registro de demostración'}</b></div>
  </aside></div>}
  </AppChrome>
}
