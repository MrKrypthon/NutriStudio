import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import FinanceBars from '../../components/FinanceBars.jsx'
import { appointmentsApi, dashboardApi, dashboardCacheKey } from '../../lib/api.js'
import { peekCache, rememberCache } from '../../lib/dataCache.js'
import { useAuth } from '../../lib/AuthContext.jsx'
import { formatMoney } from '../../lib/finance.js'

const DEMO_APPOINTMENTS = [
  { time: '09:00', duration: '60 min', name: 'Mariana Torres', type: 'Primera consulta', initials: 'MT', color: 'coral', status: 'Confirmada' },
  { time: '10:30', duration: '45 min', name: 'Diego Ramírez', type: 'Seguimiento', initials: 'DR', color: 'blue', status: 'Confirmada' },
  { time: '12:00', duration: '60 min', name: 'Sofía Hernández', type: 'Seguimiento', initials: 'SH', color: 'purple', status: 'Por confirmar' },
  { time: '16:30', duration: '45 min', name: 'Jorge Castillo', type: 'Control rápido', initials: 'JC', color: 'yellow', status: 'Confirmada' },
]

const DEMO_TASKS = [{ id: 'demo-t1', type: 'nutrition_plan', dueAt: '2026-08-25T18:00:00.000Z', patient: { firstName: 'Mariana', lastName: 'Torres' } }]
const DEMO_STATS = { appointments: 4, pendingConfirmations: 1, followUps: 3, activePatients: 5 }
const DEMO_FINANCE = { today: { incomeCents: 0, expenseCents: 0, balanceCents: 0 }, allTime: { incomeCents: 0, expenseCents: 0, balanceCents: 0 }, last7: [] }
// Estado inicial sin datos inventados: hasta que llega la API (o la caché de la visita anterior) se
// muestra "Cargando…", no la agenda de demostración.
const EMPTY_STATS = { appointments: 0, pendingConfirmations: 0, followUps: 0, activePatients: 0 }
const emptyDashboard = () => ({ stats: { ...EMPTY_STATS }, appointments: [], tasks: [], finance: null, pendingPlans: [] })

const TASK_TYPE_LABELS = { nutrition_plan: 'Plan de alimentación', consultation_report: 'Informe de consulta', consultation_export: 'Expediente completo' }
const APPOINTMENT_TYPE_LABELS = { INITIAL: 'Primera consulta', FOLLOW_UP: 'Seguimiento', QUICK_CONTROL: 'Control rápido', EMERGENCY: 'Emergencia', BLOCK: 'Bloqueo' }
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
// dueAt sigue la misma convención (fecha límite a las 18:00 "Z"), así que vence por día de calendario,
// igual que en Seguimientos: comparar contra new Date() la daba por vencida desde el mediodía.
const formatUTCDay = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}` }
// startAt is stored/seeded as the practice's wall-clock time tagged with a "Z" suffix (see
// prisma/seed.js and AgendaPage), so UTC getters are what keep "09:00" meaning 09:00 for any viewer.
const formatUTCTime = (iso) => { const d = new Date(iso); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }

// "Today" is the viewer's real local date (not a fixed demo day — see AgendaPage for the same fix).
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
// Derived from a live `now` state (not module-import time) so "Hoy" rolls over at midnight without
// a full page reload — a stale date would keep showing yesterday and re-fetching yesterday's data.
const todayISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayEyebrow = (d) => `${WEEKDAYS[d.getDay()].toUpperCase()}, ${d.getDate()} DE ${MONTHS_LONG[d.getMonth()].toUpperCase()}`
const todayLongLabel = (d) => `${WEEKDAYS[d.getDay()][0].toUpperCase()}${WEEKDAYS[d.getDay()].slice(1)} ${d.getDate()} de ${MONTHS_LONG[d.getMonth()]}, ${d.getFullYear()}`
const greetingFor = (d) => {
  const hour = d.getHours()
  if (hour < 6) return 'Buenas noches'
  if (hour < 12) return 'Buenos días'
  if (hour < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

export default function DashboardPage({ setActive, onStartConsultation, onNewAppointment, onOpenAgendaFiltered, onOpenPlan }) {
  const { user } = useAuth()
  // Al volver a "Hoy" se pinta de inmediato la última respuesta buena de esa fecha (si existe) y
  // se refresca en segundo plano; nunca los datos de demostración mientras hay una sesión real.
  const [cachedAtMount] = useState(() => peekCache(dashboardCacheKey(todayISO(new Date()))))
  const [data, setData] = useState(() => cachedAtMount || emptyDashboard())
  const [status, setStatus] = useState(cachedAtMount ? 'online' : 'loading')
  // Live clock: rolls the date/greeting over at midnight and re-fetches the new day's data.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t) }, [])

  const TODAY_ISO = todayISO(now)
  const TODAY_EYEBROW = todayEyebrow(now)
  const TODAY_LONG_LABEL = todayLongLabel(now)

  useEffect(() => {
    let cancelled = false
    // Si no hay caché para este día, se ve "Cargando…" hasta la respuesta. Si sí hay, se conserva
    // el dato bueno mientras `todayCached(..., 0)` trae el fresco (siempre se refresca al entrar).
    if (!peekCache(dashboardCacheKey(TODAY_ISO))) setStatus((prev) => (prev === 'demo' ? prev : 'loading'))
    dashboardApi.todayCached(TODAY_ISO, 0)
      .then((response) => {
        if (cancelled) return
        if (response?.stats) { setData(response); setStatus('online') }
        else setStatus('error')
      })
      .catch((error) => {
        if (cancelled) return
        if (error.code === 'DEMO_MODE') {
          setData({ stats: DEMO_STATS, appointments: DEMO_APPOINTMENTS, tasks: DEMO_TASKS, finance: DEMO_FINANCE, pendingPlans: [] })
          setStatus('demo')
        } else setStatus('error')
      })
    return () => { cancelled = true }
  }, [TODAY_ISO])

  const firstName = user?.name ? user.name.split(' ')[0] : 'Gabriela'
  const stats = data.stats || EMPTY_STATS
  const appointments = data.appointments || []
  const loading = status === 'loading'
  const nextTask = (data.tasks || [])[0]
  const moreTasks = Math.max((data.tasks || []).length - 1, 0)
  const isReal = status === 'online'
  const usingDemo = status === 'demo'
  const footLabel = loading ? 'Cargando…' : usingDemo ? 'Datos de demostración' : status === 'error' ? 'Sin conexión · últimos datos' : 'Actualizado desde tu API'
  const emptyTotals = { incomeCents: 0, expenseCents: 0, balanceCents: 0 }
  const finance = data.finance || { today: emptyTotals, allTime: emptyTotals, last7: [] }
  const financeReady = Boolean(data.finance)
  const pendingPlans = data.pendingPlans || []
  // `updatedAt` es una marca de tiempo real (no la hora "de pared" de una cita), así que va en la hora
  // local del equipo y por día de calendario: antes salía en UTC ("hoy · 01:32" a las 19:32).
  const updatedLabel = (iso) => {
    const d = new Date(iso)
    const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000)
    if (days <= 0) return `hoy · ${d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`
    if (days === 1) return 'ayer'
    return `hace ${days} días`
  }

  // Consistency with Agenda: a pending appointment can be confirmed from Hoy too, with the same
  // "¿Deseas confirmar la cita?" stop before it actually confirms.
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [confirmSaving, setConfirmSaving] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const openConfirm = (item) => { setConfirmError(''); setConfirmTarget(item) }
  // Si falla, el modal sigue abierto con el motivo: antes se cerraba igual y la cita seguía "por
  // confirmar" sin ningún aviso.
  const resolveConfirm = async () => {
    if (!confirmTarget) return
    setConfirmSaving(true); setConfirmError('')
    try {
      const updated = await appointmentsApi.confirm(confirmTarget.id)
      setData((prev) => {
        const next = {
          ...prev,
          stats: { ...prev.stats, pendingConfirmations: Math.max(0, (prev.stats?.pendingConfirmations || 0) - 1) },
          appointments: (prev.appointments || []).map((a) => (a.id === confirmTarget.id ? updated : a)),
        }
        // Se guarda el estado ya confirmado para que al volver a "Hoy" no reaparezca como pendiente.
        rememberCache(dashboardCacheKey(TODAY_ISO), next)
        return next
      })
      setConfirmTarget(null)
    } catch (error) {
      setConfirmError(error.code === 'DEMO_MODE' ? 'Modo demostración: conecta el API para confirmar citas.' : (error.message || 'No se pudo confirmar la cita.'))
    } finally { setConfirmSaving(false) }
  }

  return <AppChrome active="Hoy" setActive={setActive}><div className="content dashboard-content"><section className="welcome"><div><p className="eyebrow">{TODAY_EYEBROW}</p><h1>{greetingFor(now)}, {firstName} <span>✦</span></h1><p className="subtitle">Tu práctica, tus pacientes, un solo lugar.</p></div><div className="module-actions"><span className={'sync-label ' + (isReal ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'loading' ? 'Cargando…' : isReal ? 'Sincronizado' : status === 'error' ? 'Sin conexión' : 'Datos de demostración'}</span><button className="primary" onClick={() => onNewAppointment ? onNewAppointment() : setActive('Agenda')}><span>+</span> Nueva cita</button></div></section>
    <section className="stats-grid">{[['Citas de hoy', stats.appointments, '◷', true, 'Agenda', null], ['Por confirmar', stats.pendingConfirmations, '◌', false, 'Agenda', () => onOpenAgendaFiltered && onOpenAgendaFiltered('pending')], ['Seguimientos', stats.followUps, '◒', false, 'Seguimientos', null], ['Pacientes activos', stats.activePatients, '♧', false, 'Pacientes', null]].map(([label, value, icon, featured, target, handler]) => <button type="button" className={featured ? 'stat-card featured' : 'stat-card'} key={label} onClick={() => handler ? handler() : setActive(target)}><div className="stat-head"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{loading ? '—' : value}</div><div className="stat-foot"><span>{footLabel}</span></div></button>)}</section>
    <div className="dashboard-grid">
      <section className="panel appointments"><div className="panel-title"><div><h2>Agenda de hoy</h2><p>Tus citas programadas</p></div><button className="link-button" onClick={() => setActive('Agenda')}>Abrir agenda →</button></div><div className="day-line"><span className="today-pill">HOY</span><span>{TODAY_LONG_LABEL}</span></div><div className="appointment-list">{appointments.length === 0 ? <p className="muted" style={{ padding: '22px 0', textAlign: 'center' }}>{loading ? 'Cargando agenda…' : usingDemo ? 'Sin citas de demostración.' : 'No tienes citas programadas para hoy.'}</p> : appointments.map((item, index) => { const isPending = item.status === 'PENDING_CONFIRMATION'; const isConfirmedLike = item.status === 'CONFIRMED' || item.status === 'SCHEDULED'; const startable = isConfirmedLike && item.patient?.id; const durationLabel = item.durationMinutes != null ? `${item.durationMinutes} min` : (() => { const ms = item.endAt && item.startAt ? new Date(item.endAt) - new Date(item.startAt) : NaN; return Number.isFinite(ms) && ms > 0 ? `${Math.round(ms / 60000)} min` : (item.duration || '60 min') })(); const activate = isPending ? () => openConfirm(item) : startable ? () => onStartConsultation?.(item.patient.id, item.id) : null; return <div className="appointment" key={item.id || item.name} onClick={activate || undefined} role={activate ? 'button' : undefined} tabIndex={activate ? 0 : undefined} onKeyDown={activate ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } } : undefined} style={activate ? { cursor: 'pointer' } : undefined} title={isPending ? 'Clic para confirmar la cita' : startable ? 'Clic para iniciar la consulta' : undefined}><div className="time"><b>{item.time || formatUTCTime(item.startAt)}</b><small>{durationLabel}</small></div><div className={'person-avatar ' + (item.color || ['coral', 'blue', 'purple', 'yellow'][index % 4])}>{item.initials || item.patient?.firstName?.[0] || 'P'}</div><div className="appointment-info"><b>{item.name || `${item.patient?.firstName || ''} ${item.patient?.lastName || ''}`}</b><span>{item.type ? (APPOINTMENT_TYPE_LABELS[item.type] || item.type) : 'Consulta'}</span></div><span className={'status ' + (isConfirmedLike || item.status === 'COMPLETED' || item.status === 'Confirmada' ? 'confirmed' : 'pending')}>{isConfirmedLike ? 'Confirmada' : item.status === 'PENDING_CONFIRMATION' ? 'Por confirmar' : item.status === 'COMPLETED' ? 'Atendida' : item.status}</span></div> })}</div></section>
      <section className="panel followups"><div className="panel-title"><div><h2>Próxima acción</h2><p>{loading ? 'Cargando pendientes…' : nextTask ? 'Un pendiente por resolver' : 'Todo en orden'}</p></div></div>{loading ? <p className="muted" style={{ padding: '18px 0' }}>Espera un momento…</p> : nextTask && <div className="next-action-card"><span className="stat-icon orange">◌</span><div><b>{TASK_TYPE_LABELS[nextTask.type] || nextTask.type} de {nextTask.patient?.firstName} {nextTask.patient?.lastName}</b><small>{!nextTask.dueAt ? 'Sin fecha límite' : new Date(nextTask.dueAt).toISOString().slice(0, 10) < TODAY_ISO ? `Vencido ${formatUTCDay(nextTask.dueAt)}` : `Vence ${formatUTCDay(nextTask.dueAt)}`}</small></div><button className="message" onClick={() => setActive('Seguimientos')}>Ver ↗</button></div>}{!loading && <div className="empty-note"><span>{moreTasks ? '◷' : '✓'}</span><p>{moreTasks ? `${moreTasks} pendiente(s) más en Seguimientos` : 'El resto de tu agenda está en orden'}</p></div>}</section>
      <section className="panel finance-today">
        <div className="panel-title"><div><h2>Finanzas de hoy</h2><p>Ingresos, egresos y saldo disponible</p></div><button className="link-button" onClick={() => setActive('Finanzas')}>Ver finanzas →</button></div>
        <div className="finance-today-stats">
          <div className="income"><small>Ingresos hoy</small><b>{financeReady ? formatMoney(finance.today.incomeCents) : '—'}</b></div>
          <div className="expense"><small>Egresos hoy</small><b>{financeReady ? formatMoney(finance.today.expenseCents) : '—'}</b></div>
          <div className="balance"><small>Disponible</small><b>{financeReady ? formatMoney(finance.allTime.balanceCents) : '—'}</b></div>
        </div>
        <FinanceBars series={finance.last7} compact />
        <p className="finance-today-note">Últimos 7 días · los ingresos se registran solos al terminar cada consulta.</p>
      </section>
    </div>
    {pendingPlans.length > 0 && <section className="panel pending-plans">
      <div className="panel-title"><div><h2>Planes pendientes</h2><p>Borradores que se guardan solos: retómalos donde los dejaste</p></div><button className="link-button" onClick={() => setActive('Constructor de plan')}>Ir al constructor →</button></div>
      <div className="pending-plan-list">{pendingPlans.map((plan) => <button type="button" className="pending-plan" key={plan.id} onClick={() => onOpenPlan ? onOpenPlan(plan.patientId) : setActive('Constructor de plan')}>
        <div className="pending-plan-info"><b>{plan.patientName}</b><small>{plan.nextStep} pendiente · {updatedLabel(plan.updatedAt)}</small></div>
        <div className="pending-plan-bars">
          <div className="pp-row"><span>Plan</span><div className="pp-bar"><i style={{ width: `${plan.progress}%` }} /></div><b>{plan.progress}%</b></div>
          <div className="pp-row"><span>Consulta</span><div className="pp-bar consult"><i style={{ width: `${plan.consultationProgress}%` }} /></div><b>{plan.consultationProgress}%</b></div>
        </div>
        <span className="row-arrow">→</span>
      </button>)}</div>
    </section>}
    {confirmTarget && <div className="modal-backdrop" onClick={() => !confirmSaving && setConfirmTarget(null)}><div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">POR CONFIRMAR</p><h2>¿Deseas confirmar la cita?</h2><span className="modal-subtitle">{confirmTarget.name || `${confirmTarget.patient?.firstName || ''} ${confirmTarget.patient?.lastName || ''}`} · {confirmTarget.time || formatUTCTime(confirmTarget.startAt)}</span></div><button onClick={() => !confirmSaving && setConfirmTarget(null)}>×</button></div>
      {confirmError && <div className="form-error">⚠ {confirmError}</div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={() => setConfirmTarget(null)} disabled={confirmSaving}>Cancelar</button><button type="button" className="primary" onClick={resolveConfirm} disabled={confirmSaving}>{confirmSaving ? 'Confirmando…' : 'Confirmar cita'} <span>→</span></button></div>
    </div></div>}
  </div></AppChrome>
}