import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import FinanceBars from '../../components/FinanceBars.jsx'
import { appointmentsApi, dashboardApi } from '../../lib/api.js'
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

const TASK_TYPE_LABELS = { nutrition_plan: 'Plan de alimentación', consultation_report: 'Informe de consulta', consultation_export: 'Expediente completo' }
const APPOINTMENT_TYPE_LABELS = { INITIAL: 'Primera consulta', FOLLOW_UP: 'Seguimiento', QUICK_CONTROL: 'Control rápido', EMERGENCY: 'Emergencia', BLOCK: 'Bloqueo' }
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
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
  const [data, setData] = useState({ stats: DEMO_STATS, appointments: DEMO_APPOINTMENTS, tasks: DEMO_TASKS })
  const [status, setStatus] = useState('loading')
  // Live clock: rolls the date/greeting over at midnight and re-fetches the new day's data.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t) }, [])

  const TODAY_ISO = todayISO(now)
  const TODAY_EYEBROW = todayEyebrow(now)
  const TODAY_LONG_LABEL = todayLongLabel(now)

  useEffect(() => {
    dashboardApi.today(TODAY_ISO)
      .then((response) => { if (response?.stats) setData(response); setStatus('online') })
      .catch(() => setStatus('demo'))
  }, [TODAY_ISO])

  const firstName = user?.name ? user.name.split(' ')[0] : 'Gabriela'
  const nextTask = (data.tasks || [])[0]
  const moreTasks = Math.max((data.tasks || []).length - 1, 0)
  const isReal = status === 'online'
  const footLabel = isReal ? 'Actualizado desde tu API' : 'Datos de demostración'
  const emptyTotals = { incomeCents: 0, expenseCents: 0, balanceCents: 0 }
  const finance = data.finance || { today: emptyTotals, allTime: emptyTotals, last7: [] }
  const pendingPlans = isReal ? (data.pendingPlans || []) : []
  const updatedLabel = (iso) => { const d = new Date(iso); const days = Math.floor((Date.now() - d.getTime()) / 86400000); if (days <= 0) return `hoy · ${formatUTCTime(iso)}`; if (days === 1) return 'ayer'; return `hace ${days} días` }

  // Consistency with Agenda: a pending appointment can be confirmed with one click from Hoy too.
  const confirmAppointment = async (id) => {
    try {
      const updated = await appointmentsApi.confirm(id)
      setData((prev) => ({
        ...prev,
        stats: { ...prev.stats, pendingConfirmations: Math.max(0, (prev.stats?.pendingConfirmations || 0) - 1) },
        appointments: (prev.appointments || []).map((a) => (a.id === id ? updated : a)),
      }))
    } catch { /* keep the list as-is; retry in Agenda */ }
  }

  return <AppChrome active="Hoy" setActive={setActive}><div className="content"><section className="welcome"><div><p className="eyebrow">{TODAY_EYEBROW}</p><h1>{greetingFor(now)}, {firstName} <span>✦</span></h1><p className="subtitle">Tu práctica, tus pacientes, un solo lugar.</p></div><div className="module-actions"><span className={'sync-label ' + (isReal ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'loading' ? 'Cargando…' : isReal ? 'Sincronizado' : 'Datos de demostración'}</span><button className="primary" onClick={() => onNewAppointment ? onNewAppointment() : setActive('Agenda')}><span>+</span> Nueva cita</button></div></section>
    <section className="stats-grid">{[['Citas de hoy', data.stats.appointments, '◷', true, 'Agenda', null], ['Por confirmar', data.stats.pendingConfirmations, '◌', false, 'Agenda', () => onOpenAgendaFiltered && onOpenAgendaFiltered('pending')], ['Seguimientos', data.stats.followUps, '◒', false, 'Seguimientos', null], ['Pacientes activos', data.stats.activePatients, '♧', false, 'Pacientes', null]].map(([label, value, icon, featured, target, handler]) => <button type="button" className={featured ? 'stat-card featured' : 'stat-card'} key={label} onClick={() => handler ? handler() : setActive(target)}><div className="stat-head"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{value}</div><div className="stat-foot"><span>{footLabel}</span></div></button>)}</section>
    <div className="dashboard-grid">
      <section className="panel appointments"><div className="panel-title"><div><h2>Agenda de hoy</h2><p>Tus citas programadas</p></div><button className="link-button" onClick={() => setActive('Agenda')}>Abrir agenda →</button></div><div className="day-line"><span className="today-pill">HOY</span><span>{TODAY_LONG_LABEL}</span></div><div className="appointment-list">{data.appointments.length === 0 ? <p className="muted" style={{ padding: '22px 0', textAlign: 'center' }}>{isReal ? 'No tienes citas programadas para hoy.' : 'Sin citas de demostración.'}</p> : data.appointments.map((item, index) => { const isPending = item.status === 'PENDING_CONFIRMATION'; const isConfirmedLike = item.status === 'CONFIRMED' || item.status === 'SCHEDULED'; const startable = isConfirmedLike && item.patient?.id; const durationLabel = item.durationMinutes != null ? `${item.durationMinutes} min` : (() => { const ms = item.endAt && item.startAt ? new Date(item.endAt) - new Date(item.startAt) : NaN; return Number.isFinite(ms) && ms > 0 ? `${Math.round(ms / 60000)} min` : (item.duration || '60 min') })(); return <div className="appointment" key={item.id || item.name} onClick={() => { if (isPending) confirmAppointment(item.id); else if (startable) onStartConsultation?.(item.patient.id, item.id) }} style={(isPending || startable) ? { cursor: 'pointer' } : undefined} title={isPending ? 'Clic para confirmar la cita' : startable ? 'Clic para iniciar la consulta' : undefined}><div className="time"><b>{item.time || formatUTCTime(item.startAt)}</b><small>{durationLabel}</small></div><div className={'person-avatar ' + (item.color || ['coral', 'blue', 'purple', 'yellow'][index % 4])}>{item.initials || item.patient?.firstName?.[0] || 'P'}</div><div className="appointment-info"><b>{item.name || `${item.patient?.firstName || ''} ${item.patient?.lastName || ''}`}</b><span>{item.type ? (APPOINTMENT_TYPE_LABELS[item.type] || item.type) : 'Consulta'}</span></div><span className={'status ' + (isConfirmedLike || item.status === 'Confirmada' ? 'confirmed' : 'pending')}>{isConfirmedLike ? 'Confirmada' : item.status === 'PENDING_CONFIRMATION' ? 'Por confirmar' : item.status}</span></div> })}</div></section>
      <section className="panel followups"><div className="panel-title"><div><h2>Próxima acción</h2><p>{nextTask ? 'Un pendiente por resolver' : 'Todo en orden'}</p></div></div>{nextTask && <div className="next-action-card"><span className="stat-icon orange">◌</span><div><b>{TASK_TYPE_LABELS[nextTask.type] || nextTask.type} de {nextTask.patient?.firstName} {nextTask.patient?.lastName}</b><small>{nextTask.dueAt && new Date(nextTask.dueAt) < new Date() ? `Vencido ${formatUTCDay(nextTask.dueAt)}` : `Vence ${formatUTCDay(nextTask.dueAt)}`}</small></div><button className="message" onClick={() => setActive('Seguimientos')}>Ver ↗</button></div>}<div className="empty-note"><span>{moreTasks ? '◷' : '✓'}</span><p>{moreTasks ? `${moreTasks} pendiente(s) más en Seguimientos` : 'El resto de tu agenda está en orden'}</p></div></section>
      <section className="panel finance-today">
        <div className="panel-title"><div><h2>Finanzas de hoy</h2><p>Ingresos, egresos y saldo disponible</p></div><button className="link-button" onClick={() => setActive('Finanzas')}>Ver finanzas →</button></div>
        <div className="finance-today-stats">
          <div className="income"><small>Ingresos hoy</small><b>{formatMoney(finance.today.incomeCents)}</b></div>
          <div className="expense"><small>Egresos hoy</small><b>{formatMoney(finance.today.expenseCents)}</b></div>
          <div className="balance"><small>Disponible</small><b>{formatMoney(finance.allTime.balanceCents)}</b></div>
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
  </div></AppChrome>
}