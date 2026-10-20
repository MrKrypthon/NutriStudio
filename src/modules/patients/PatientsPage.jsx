import { useEffect, useMemo, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { patientsApi } from '../../lib/api.js'
import { normalizeSex, sexLabel } from '../../lib/sex.js'
import { deviceLabel } from '../../lib/device.js'

// Registros de demostración (sin API): mismos campos que devuelve `GET /patients?summary=1`.
const DEMO_PATIENTS = [
  { firstName: 'Mariana', lastName: 'Torres', sex: 'Mujer', birthDate: '1998-03-02', status: 'ACTIVE', lastConsultationAt: null, nextAppointmentAt: null, consultationCount: 0, pendingDocuments: 0 },
  { firstName: 'Diego', lastName: 'Ramírez', sex: 'Hombre', birthDate: '1992-07-14', status: 'ACTIVE', lastConsultationAt: null, nextAppointmentAt: null, consultationCount: 0, pendingDocuments: 0 },
  { firstName: 'Sofía', lastName: 'Hernández', sex: 'Mujer', birthDate: '1995-11-20', status: 'ACTIVE', lastConsultationAt: null, nextAppointmentAt: null, consultationCount: 0, pendingDocuments: 0 },
]

const APPOINTMENT_TYPE_LABELS = { INITIAL: 'Primera consulta', FOLLOW_UP: 'Seguimiento', QUICK_CONTROL: 'Control rápido', EMERGENCY: 'Emergencia', BLOCK: 'Bloqueo' }
const CONSULTATION_STATUS_LABELS = { DRAFT: 'Borrador', IN_PROGRESS: 'En progreso', COMPLETED: 'Completada' }
const PLAN_STATUS_LABELS = { DRAFT: 'Borrador', READY: 'Listo', PUBLISHED: 'Publicado', SUPERSEDED: 'Reemplazado', CANCELLED: 'Cancelado' }
const DOCUMENT_TYPE_LABELS = { nutrition_plan: 'Plan de alimentación', consultation_report: 'Informe de consulta', consultation_clinical: 'Informe clínico', consultation_export: 'Expediente completo' }
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
  'Document:undelivered': 'Entrega de documento deshecha',
  'LabAttachment:uploaded': 'PDF de análisis clínicos adjuntado',
}

const TABS = [['ACTIVE', 'Activos'], ['NO_NEXT', 'Sin cita próxima'], ['ARCHIVED', 'Archivados']]
const SORTS = [['recent', 'Agregados recientemente'], ['name', 'Nombre (A-Z)'], ['lastName', 'Apellido (A-Z)']]
const PAGE_SIZE = 25
// Un paciente activo sin cita y sin consulta en este tiempo se marca como «seguimiento atrasado».
const OVERDUE_DAYS = 45
const AVATAR_TONES = ['coral', 'blue', 'purple', 'yellow']
const DONE_STATUSES = new Set(['COMPLETED', 'PUBLISHED', 'DELIVERED', 'DONE'])
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DAY_MS = 86400000

const formatUTCDate = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
// Las citas guardan la hora "de pared" con sufijo Z (se leen en UTC); lo demás (consultas, auditoría,
// documentos) son marcas de tiempo reales y van en el día local.
const formatLocalDate = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}` }
const formatEventDate = (event) => (event.kind === 'appointment' ? formatUTCDate(event.date) : formatLocalDate(event.date))
// Próxima cita: fecha y hora con la convención UTC de pared de la Agenda.
const formatNextAppointment = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }
const daysSince = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS)
function relativePast(iso) {
  const days = daysSince(iso)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  if (days < 30) return `hace ${days} días`
  const months = Math.round(days / 30)
  if (months < 12) return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`
  const years = Math.round(days / 365)
  return `hace ${years} ${years === 1 ? 'año' : 'años'}`
}
function relativeFuture(iso) {
  // La cita está en hora de pared (UTC); se compara contra el día de hoy en esa misma convención.
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const d = new Date(iso)
  const days = Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - today) / DAY_MS)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'mañana'
  return `en ${days} días`
}
function ageOf(birthDate) {
  if (!birthDate) return null
  const birth = new Date(birthDate)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getUTCFullYear() - birth.getUTCFullYear()
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1
  return age >= 0 && age < 130 ? age : null
}
const fullName = (p) => `${p.firstName} ${p.lastName}`.trim()
const initialsOf = (p) => `${p.firstName?.[0] || ''}${p.lastName?.[0] || ''}`.toUpperCase()
const toneOf = (p) => AVATAR_TONES[[...String(p.id || fullName(p))].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_TONES.length]
const recordLabel = (p) => (p.recordNumber ? `Exp. ${String(p.recordNumber).padStart(5, '0')}` : null)
const personLine = (p) => [ageOf(p.birthDate) != null && `${ageOf(p.birthDate)} años`, sexLabel(p.sex), recordLabel(p)].filter(Boolean).join(' · ') || 'Sin datos de identificación'
// WhatsApp necesita el número con lada de país; los de 10 dígitos se toman como de México.
const whatsappUrl = (phone) => { const digits = String(phone || '').replace(/\D/g, ''); if (digits.length < 10) return null; return `https://wa.me/${digits.length === 10 ? `52${digits}` : digits}` }

function planChip(plan) {
  if (!plan) return { tone: 'none', text: 'Sin plan' }
  const kcal = plan.targetKcal ? ` · ${plan.targetKcal} kcal` : ''
  if (plan.status === 'PUBLISHED') return { tone: 'ok', text: `Vigente v${plan.version}${kcal}` }
  if (plan.status === 'SUPERSEDED') return { tone: 'none', text: `v${plan.version} reemplazado` }
  return { tone: 'draft', text: `${PLAN_STATUS_LABELS[plan.status] || plan.status} v${plan.version}` }
}

// Lo que pide atención de cada paciente, en orden de urgencia.
function attentionOf(p) {
  const flags = []
  if (p.openConsultationId) flags.push({ key: 'open', tone: 'info', text: 'Consulta abierta' })
  if (p.pendingDocuments) flags.push({ key: 'docs', tone: 'warn', text: `${p.pendingDocuments} por entregar` })
  if (p.status !== 'ARCHIVED' && !p.nextAppointmentAt) {
    if (p.lastConsultationAt && daysSince(p.lastConsultationAt) > OVERDUE_DAYS) flags.push({ key: 'overdue', tone: 'warn', text: 'Seguimiento atrasado' })
    else if (!p.lastConsultationAt && !p.consultationCount) flags.push({ key: 'new', tone: 'info', text: 'Sin primera consulta' })
  }
  return flags
}

function describeEvent(event) {
  if (event.kind === 'appointment') return { icon: '◷', label: `Cita · ${APPOINTMENT_TYPE_LABELS[event.subtype] || event.subtype}` }
  if (event.kind === 'consultation') return { icon: '▤', label: `Consulta · ${CONSULTATION_STATUS_LABELS[event.status] || event.status}` }
  if (event.kind === 'plan') return { icon: '▦', label: `Plan · ${PLAN_STATUS_LABELS[event.status] || event.status}` }
  if (event.kind === 'audit') { const base = AUDIT_LABELS[`${event.entity}:${event.action}`] || `${event.entity} · ${event.action}`; const device = deviceLabel(event.metadata?.origin?.agent); return { icon: '◈', label: [base, event.userName, device && `desde ${device}`].filter(Boolean).join(' · ') } }
  return { icon: '▧', label: `${DOCUMENT_TYPE_LABELS[event.subtype] || 'Documento'} · ${DOCUMENT_STATUS_LABELS[event.status] || event.status}` }
}

// Sin sexo registrado (p. ej. pacientes dados de alta desde la Agenda) el formulario queda vacío:
// antes caía en 'Mujer' y guardar cualquier otro dato le asignaba ese sexo sin que nadie lo eligiera.
const emptyEditForm = (patient) => ({ firstName: patient?.firstName || '', lastName: patient?.lastName || '', email: patient?.email || '', phone: patient?.phone || '', birthDate: patient?.birthDate ? patient.birthDate.slice(0, 10) : '', sex: normalizeSex(patient?.sex) || '', occupation: patient?.occupation || '', address: patient?.address || '', curp: patient?.curp || '' })
const readStored = (key, fallback) => { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
const store = (key, value) => { try { localStorage.setItem(key, value) } catch { /* sin almacenamiento */ } }

export default function PatientsPage({ setActive, onSelectPatient, onOpenPatient, onOpenSession, onNewAppointment }) {
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [editState, setEditState] = useState('idle')
  const [editError, setEditError] = useState('')
  const [timeline, setTimeline] = useState([])
  const [timelineState, setTimelineState] = useState('idle')
  const [showAudit, setShowAudit] = useState(false)
  const [timelineAll, setTimelineAll] = useState(false)
  const [statusFilter, setStatusFilter] = useState(() => readStored('nutri.patients.tab', 'ACTIVE'))
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState(null)
  const [sortBy, setSortBy] = useState(() => readStored('nutri.patients.sort', 'recent'))
  const [archiveState, setArchiveState] = useState('idle')
  const [reloadKey, setReloadKey] = useState(0)
  // La búsqueda y el orden van al servidor: filtrar sólo la página cargada (25) escondía a los
  // pacientes de las demás páginas. Se espera a que dejes de teclear para no pedir en cada letra.
  const [query, setQuery] = useState('')
  useEffect(() => { const timer = setTimeout(() => { setQuery(search.trim()); setPage(1) }, 300); return () => clearTimeout(timer) }, [search])

  useEffect(() => {
    let cancelled = false
    setStatus((prev) => (prev === 'online' ? 'refreshing' : 'loading'))
    const isNoNext = statusFilter === 'NO_NEXT'
    patientsApi.list(`?summary=1&status=${isNoNext ? 'ACTIVE' : statusFilter}${isNoNext ? '&noNext=1' : ''}&page=${page}&pageSize=${PAGE_SIZE}&sort=${sortBy}${query ? `&search=${encodeURIComponent(query)}` : ''}`)
      .then((payload) => {
        if (cancelled) return
        setRows(payload?.items || [])
        setTotal(payload?.total ?? (payload?.items?.length || 0))
        setCounts(payload?.counts || null)
        setStatus('online')
      })
      .catch(() => { if (!cancelled) { setRows(DEMO_PATIENTS); setStatus('demo') } })
    return () => { cancelled = true }
  }, [statusFilter, page, sortBy, query, reloadKey])

  const selected = rows.find((row) => (row.id || fullName(row)) === selectedId) || null

  const loadTimeline = (patientId) => {
    setTimelineState('loading')
    patientsApi.timeline(patientId)
      .then((response) => { setTimeline(response.items || []); setTimelineState('ready') })
      .catch(() => setTimelineState('error'))
  }

  useEffect(() => {
    setTimelineAll(false)
    if (!selected?.id) { setTimeline([]); setTimelineState('idle'); return }
    loadTimeline(selected.id)
  }, [selected?.id])

  // Con datos reales el servidor ya filtró y ordenó; el filtro local queda para la demostración.
  const visible = status === 'demo' ? rows.filter((p) => [fullName(p), p.email, p.phone].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())) : rows
  const pages = Math.max(1, Math.ceil((total || 0) / PAGE_SIZE))
  const shownTimeline = useMemo(() => timeline.filter((event) => showAudit || event.kind !== 'audit'), [timeline, showAudit])

  // Se navega con el paciente en el mismo salto para que quede en la dirección: hacerlo en dos
  // pasos (elegir paciente y luego cambiar de módulo) dejaba la URL sin el id y recargar sacaba de
  // la pantalla.
  const goTo = (patient, module) => {
    if (patient?.id && onOpenPatient) { onOpenPatient(patient.id, module); return }
    if (patient?.id) onSelectPatient?.(patient.id)
    setActive(module)
  }
  const continueConsultation = (patient) => {
    if (patient.openConsultationId && onOpenSession) onOpenSession(patient.id, patient.openConsultationId)
    else goTo(patient, 'Expediente')
  }

  const changeTab = (key) => { setStatusFilter(key); setPage(1); store('nutri.patients.tab', key) }
  const changeSort = (key) => { setSortBy(key); setPage(1); store('nutri.patients.sort', key) }
  const openPatient = (row) => { setSelectedId(row.id || fullName(row)); setEditing(false); setEditState('idle'); setEditError(''); setArchiveState('idle') }
  const closeDrawer = () => { setSelectedId(null); setEditing(false) }
  const startEdit = () => { setEditForm(emptyEditForm(selected)); setEditState('idle'); setEditError(''); setEditing(true) }
  const updateField = (key, value) => setEditForm((prev) => ({ ...prev, [key]: value }))

  useEffect(() => {
    if (!selectedId) return undefined
    const onKey = (event) => { if (event.key === 'Escape') closeDrawer() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId])

  const toggleArchive = async () => {
    if (!selected?.id) return
    const nextStatus = selected.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED'
    if (nextStatus === 'ARCHIVED' && !window.confirm(`¿Archivar a ${fullName(selected)}? Saldrá de la lista de activos; podrás reactivarlo desde "Archivados".`)) return
    setArchiveState('saving')
    try {
      await patientsApi.update(selected.id, { status: nextStatus })
      setSelectedId(null)
      setArchiveState('idle')
      setReloadKey((key) => key + 1)
    } catch {
      setArchiveState('error')
    }
  }

  const saveEdit = async (event) => {
    event.preventDefault()
    setEditState('saving')
    setEditError('')
    try {
      const updated = await patientsApi.update(selected.id, editForm)
      setRows((prev) => prev.map((row) => (row.id === selected.id ? { ...row, ...updated } : row)))
      setEditing(false)
      // The edit just logged a Patient:updated audit event; refresh the open drawer's timeline.
      loadTimeline(updated.id)
    } catch (error) {
      setEditState('error')
      setEditError(error.message || 'No se pudo guardar los cambios.')
    }
  }

  const tabCount = (key) => (counts ? counts[key] : key === statusFilter ? total : null)
  const emptyTitle = query ? `Nadie coincide con «${query}»` : statusFilter === 'NO_NEXT' ? 'Todos tus pacientes activos tienen cita' : statusFilter === 'ARCHIVED' ? 'No hay pacientes archivados' : 'Aún no tienes pacientes'
  const emptyText = query ? 'Busca por nombre, apellido, teléfono o email. Prueba con menos letras o en otra pestaña.' : statusFilter === 'NO_NEXT' ? 'Aquí aparecen los activos sin una cita futura, para no perderles el seguimiento.' : statusFilter === 'ARCHIVED' ? 'Al archivar un paciente sale de la lista de activos; su expediente se conserva.' : 'Registra a tu primer paciente para abrir su expediente y agendar su consulta.'

  return <AppChrome active="Pacientes" setActive={setActive}><div className="content">
    <ModuleHeader eyebrow={`TU ESPACIO · ${counts ? counts.ACTIVE : total} ACTIVOS`} title="Pacientes" subtitle="Busca a una persona, revisa en qué va su atención y entra a su expediente." action={<div className="module-actions">{status === 'demo' && <span className="sync-label demo">● Datos de demostración</span>}<button className="primary" onClick={() => setActive('Nuevo paciente')}><span>+</span> Nuevo paciente</button></div>} />

    <div className="pt-toolbar panel">
      <div className="pt-tabs" role="tablist" aria-label="Qué pacientes ver">
        {TABS.map(([key, label]) => { const count = tabCount(key); return <button key={key} type="button" role="tab" aria-selected={statusFilter === key} className={'pt-tab' + (statusFilter === key ? ' active' : '')} onClick={() => changeTab(key)}>{label}{count != null && <span className="pt-tab-count">{count}</span>}</button> })}
      </div>
      <div className="pt-toolbar-row">
        <div className="search-field">⌕ <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, teléfono o email…" aria-label="Buscar paciente" />{search && <button type="button" className="pt-clear" onClick={() => setSearch('')} aria-label="Limpiar búsqueda">×</button>}</div>
        <label className="pt-sort">Ordenar<select value={sortBy} onChange={(e) => changeSort(e.target.value)}>{SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
    </div>

    <div className="pt-list panel" aria-busy={status === 'loading' || status === 'refreshing'}>
      <div className="pt-head"><span>Paciente</span><span>Última consulta</span><span>Próxima cita</span><span>Plan</span><span>Pendientes</span><span /></div>
      {status === 'loading' && <div className="pt-loading">Cargando pacientes…</div>}
      {status !== 'loading' && visible.map((p) => {
        const key = p.id || fullName(p)
        const plan = planChip(p.currentPlan)
        const flags = attentionOf(p)
        return <div className={'pt-row' + (selectedId === key ? ' selected' : '') + (p.status === 'ARCHIVED' ? ' archived' : '')} key={key} onClick={() => openPatient(p)} role="button" tabIndex={0} aria-label={`Ver resumen de ${fullName(p)}`} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openPatient(p) } }}>
          <div className="pt-person"><span className={'person-avatar ' + toneOf(p)}>{initialsOf(p)}</span><div><b>{fullName(p)}</b><small>{personLine(p)}</small></div></div>
          <div className="pt-cell" data-label="Última consulta">{p.lastConsultationAt ? <><b>{formatLocalDate(p.lastConsultationAt)}</b><small>{relativePast(p.lastConsultationAt)}</small></> : <small>Sin consultas</small>}</div>
          <div className="pt-cell" data-label="Próxima cita">{p.nextAppointmentAt
            ? <><b>{formatNextAppointment(p.nextAppointmentAt)}</b><small>{relativeFuture(p.nextAppointmentAt)} · {APPOINTMENT_TYPE_LABELS[p.nextAppointmentType] || p.nextAppointmentType}</small></>
            : <><small>Sin cita</small>{p.status !== 'ARCHIVED' && p.id && <button type="button" className="pt-inline-action" onClick={(event) => { event.stopPropagation(); onNewAppointment?.(p.id) }}>+ Agendar</button>}</>}</div>
          <div className="pt-cell" data-label="Plan"><span className={'pt-chip plan-' + plan.tone}>{plan.text}</span></div>
          <div className="pt-cell pt-flags" data-label="Pendientes">{flags.length ? flags.map((flag) => <span key={flag.key} className={'pt-chip flag-' + flag.tone}>{flag.text}</span>) : <small className="pt-ok">✓ Al día</small>}</div>
          <div className="pt-row-actions">{p.id && <button type="button" className="secondary pt-open" onClick={(event) => { event.stopPropagation(); p.openConsultationId ? continueConsultation(p) : goTo(p, 'Expediente') }}>{p.openConsultationId ? 'Continuar' : 'Expediente'} →</button>}</div>
        </div>
      })}
      {status !== 'loading' && visible.length === 0 && <div className="result-empty"><span>◌</span><h3>{emptyTitle}</h3><p>{emptyText}</p>{!query && statusFilter === 'ACTIVE' && <button type="button" className="primary" onClick={() => setActive('Nuevo paciente')}><span>+</span> Nuevo paciente</button>}{query && <button type="button" className="secondary" onClick={() => setSearch('')}>Limpiar búsqueda</button>}</div>}
      {status !== 'loading' && visible.length > 0 && <div className="pt-foot">
        <span className="muted">{total > visible.length ? `${(page - 1) * PAGE_SIZE + 1}–${(page - 1) * PAGE_SIZE + visible.length} de ${total}` : `${visible.length} ${visible.length === 1 ? 'paciente' : 'pacientes'}`}</span>
        {status === 'online' && pages > 1 && <div className="pt-pager"><button type="button" className="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Anterior</button><span className="muted">Página {page} de {pages}</span><button type="button" className="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Siguiente →</button></div>}
      </div>}
    </div>
  </div>

  {selected && <div className="drawer-backdrop" onClick={closeDrawer}><aside className="patient-drawer pt-drawer" role="dialog" aria-modal="true" aria-label={`Resumen de ${fullName(selected)}`} onClick={(e) => e.stopPropagation()}>
    <button className="drawer-close" onClick={closeDrawer} aria-label="Cerrar">×</button>

    {!editing ? <>
      <div className="pt-drawer-head">
        <span className={'person-avatar large-avatar ' + toneOf(selected)}>{initialsOf(selected)}</span>
        <div>
          <h2>{fullName(selected)}</h2>
          <p className="muted">{personLine(selected)}</p>
          {selected.status === 'ARCHIVED' && <span className="pt-chip flag-warn">Archivado</span>}
        </div>
      </div>
      {!selected.id && <p className="muted">Este es un registro de demostración, no tiene expediente ni plan reales.</p>}

      {selected.openConsultationId && <button type="button" className="pt-banner" onClick={() => continueConsultation(selected)}><span>▤</span><div><b>Tiene una consulta abierta</b><small>Retómala donde la dejaste</small></div><em>Continuar →</em></button>}

      <div className="pt-drawer-actions">
        <button className="primary" disabled={!selected.id} onClick={() => goTo(selected, 'Expediente')}>Abrir expediente</button>
        <div className="pt-drawer-shortcuts">
          <button className="secondary" disabled={!selected.id} onClick={() => goTo(selected, 'Constructor de plan')}>▦ Plan</button>
          <button className="secondary" disabled={!selected.id || selected.status === 'ARCHIVED'} onClick={() => onNewAppointment?.(selected.id)}>◷ Agendar</button>
          <button className="secondary" disabled={!selected.id} onClick={() => goTo(selected, 'Documentos')}>▧ Documentos{selected.pendingDocuments ? <i className="pt-dot">{selected.pendingDocuments}</i> : null}</button>
        </div>
      </div>

      {selected.id && <div className="pt-stats">
        <div><small>Consultas</small><b>{selected.consultationCount ?? '—'}</b><span>{selected.lastConsultationAt ? `Última ${relativePast(selected.lastConsultationAt)}` : 'Ninguna aún'}</span></div>
        <div><small>Peso</small><b>{selected.lastWeightKg != null ? `${selected.lastWeightKg.toFixed(1)} kg` : '—'}</b><span>{selected.lastWeightKg != null && selected.previousWeightKg != null ? (() => { const delta = selected.lastWeightKg - selected.previousWeightKg; return Math.abs(delta) < 0.05 ? 'Sin cambio' : `${delta < 0 ? '↓' : '↑'} ${Math.abs(delta).toFixed(1)} kg vs. anterior` })() : selected.lastWeightAt ? formatLocalDate(selected.lastWeightAt) : 'Sin mediciones'}</span></div>
        <div><small>Plan</small><b className={'plan-' + planChip(selected.currentPlan).tone}>{selected.currentPlan ? (PLAN_STATUS_LABELS[selected.currentPlan.status] || selected.currentPlan.status) : '—'}</b><span>{selected.currentPlan ? [`v${selected.currentPlan.version}`, selected.currentPlan.targetKcal && `${selected.currentPlan.targetKcal} kcal`].filter(Boolean).join(' · ') : 'Sin plan todavía'}</span></div>
      </div>}

      {selected.id && <div className="drawer-section pt-section">
        <p className="eyebrow">PRÓXIMA CITA</p>
        {selected.nextAppointmentAt
          ? <p className="pt-line"><b>{formatNextAppointment(selected.nextAppointmentAt)}</b> · {relativeFuture(selected.nextAppointmentAt)} · {APPOINTMENT_TYPE_LABELS[selected.nextAppointmentType] || selected.nextAppointmentType}</p>
          : <p className="pt-line muted">Sin cita programada.{selected.status !== 'ARCHIVED' && <> <button type="button" className="link-button" onClick={() => onNewAppointment?.(selected.id)}>Agendar ahora →</button></>}</p>}
      </div>}

      {selected.id && <div className="drawer-section pt-section">
        <p className="eyebrow">CONTACTO</p>
        {selected.phone || selected.email ? <div className="pt-contact">
          {selected.phone && <><a href={`tel:${selected.phone}`}>☏ {selected.phone}</a>{whatsappUrl(selected.phone) && <a href={whatsappUrl(selected.phone)} target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>}</>}
          {selected.email && <a href={`mailto:${selected.email}`}>✉ {selected.email}</a>}
        </div> : <p className="pt-line muted">Sin teléfono ni email. <button type="button" className="link-button" onClick={startEdit}>Agregar →</button></p>}
        {(() => { const missing = [!selected.birthDate && 'fecha de nacimiento', !selected.curp && 'CURP', !selected.address && 'domicilio'].filter(Boolean); return missing.length ? <p className="pt-missing">Ficha incompleta: falta {missing.join(', ')} (NOM-004). <button type="button" className="link-button" onClick={startEdit}>Completar →</button></p> : null })()}
      </div>}

      {selected.id && <div className="drawer-section pt-section">
        <div className="pt-section-head"><p className="eyebrow">ACTIVIDAD</p><label className="pt-toggle"><input type="checkbox" checked={showAudit} onChange={(e) => setShowAudit(e.target.checked)} /> Incluir cambios</label></div>
        {timelineState === 'loading' && <p className="muted">Cargando…</p>}
        {timelineState === 'error' && <p className="muted">No se pudo cargar el historial.</p>}
        {timelineState === 'ready' && shownTimeline.length === 0 && <p className="muted">Sin actividad registrada todavía.</p>}
        {shownTimeline.length > 0 && <div className="check-list pt-timeline">{(timelineAll ? shownTimeline : shownTimeline.slice(0, 6)).map((event) => { const { icon, label } = describeEvent(event); return <div key={`${event.kind}-${event.id}`}><span className={'check-dot ' + (DONE_STATUSES.has(event.status) ? 'done-dot' : '')}>{icon}</span><span>{label}</span><small>{formatEventDate(event)}</small></div> })}</div>}
        {shownTimeline.length > 6 && <button type="button" className="link-button" onClick={() => setTimelineAll((value) => !value)}>{timelineAll ? 'Ver menos' : `Ver toda la actividad (${shownTimeline.length})`}</button>}
      </div>}

      {selected.id && <div className="pt-drawer-foot">
        <button type="button" className="link-button" onClick={startEdit}>✎ Editar datos</button>
        <button type="button" className="link-button" disabled={archiveState === 'saving'} onClick={toggleArchive}>{archiveState === 'saving' ? 'Guardando…' : selected.status === 'ARCHIVED' ? '↺ Reactivar paciente' : 'Archivar paciente'}</button>
      </div>}
      {archiveState === 'error' && <div className="form-error">⚠ No se pudo actualizar el estado del paciente.</div>}
    </> : <form onSubmit={saveEdit}>
      <h2>Editar paciente</h2>
      <div className="form-grid">
        <label>Nombre(s)<input value={editForm.firstName} onChange={(e) => updateField('firstName', e.target.value)} required /></label>
        <label>Apellidos<input value={editForm.lastName} onChange={(e) => updateField('lastName', e.target.value)} required /></label>
        <label>Fecha de nacimiento<input type="date" value={editForm.birthDate} onChange={(e) => updateField('birthDate', e.target.value)} /></label>
        <label>Sexo<select value={editForm.sex} onChange={(e) => updateField('sex', e.target.value)}><option value="">Selecciona…</option><option>Hombre</option><option>Mujer</option></select></label>
        <label>Email<input type="email" value={editForm.email} onChange={(e) => updateField('email', e.target.value)} /></label>
        <label>Teléfono<input value={editForm.phone} onChange={(e) => updateField('phone', e.target.value)} /></label>
        <label>Ocupación<input value={editForm.occupation} onChange={(e) => updateField('occupation', e.target.value)} /></label>
        <label>Domicilio<input value={editForm.address} maxLength={240} onChange={(e) => updateField('address', e.target.value)} placeholder="Calle, número, colonia, municipio" /></label>
        <label>CURP<input value={editForm.curp} maxLength={18} onChange={(e) => updateField('curp', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="18 caracteres" /></label>
      </div>
      {editState === 'error' && <div className="form-error">⚠ {editError}</div>}
      <div className="form-actions"><button type="button" className="secondary" onClick={() => setEditing(false)}>Cancelar</button><button className="primary" disabled={editState === 'saving'}>{editState === 'saving' ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </form>}
  </aside></div>}
  </AppChrome>
}
