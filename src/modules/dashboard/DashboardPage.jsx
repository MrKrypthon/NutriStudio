import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import { dashboardApi } from '../../lib/api.js'
import { useAuth } from '../../lib/AuthContext.jsx'

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
const today = new Date()
const TODAY_ISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const TODAY_WEEKDAY = WEEKDAYS[today.getDay()]
const TODAY_EYEBROW = `${TODAY_WEEKDAY.toUpperCase()}, ${today.getDate()} DE ${MONTHS_LONG[today.getMonth()].toUpperCase()}`
const TODAY_LONG_LABEL = `${TODAY_WEEKDAY[0].toUpperCase()}${TODAY_WEEKDAY.slice(1)} ${today.getDate()} de ${MONTHS_LONG[today.getMonth()]}, ${today.getFullYear()}`

const greetingFor = () => {
  const hour = today.getHours()
  if (hour < 6) return 'Buenas noches'
  if (hour < 12) return 'Buenos días'
  if (hour < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

export default function DashboardPage({ setActive, onStartConsultation, onNewAppointment, onOpenAgendaFiltered }) {
  const { user } = useAuth()
  const [data, setData] = useState({ stats: DEMO_STATS, appointments: DEMO_APPOINTMENTS, tasks: DEMO_TASKS })
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    dashboardApi.today(TODAY_ISO)
      .then((response) => { if (response?.stats) setData(response); setStatus('online') })
      .catch(() => setStatus('demo'))
  }, [])

  const firstName = user?.name ? user.name.split(' ')[0] : 'Gabriela'
  const nextTask = (data.tasks || [])[0]
  const moreTasks = Math.max((data.tasks || []).length - 1, 0)
  const isReal = status === 'online'
  const footLabel = isReal ? 'Actualizado desde tu API' : 'Datos de demostración'

  return <AppChrome active="Hoy" setActive={setActive}><div className="content"><section className="welcome"><div><p className="eyebrow">{TODAY_EYEBROW}</p><h1>{greetingFor()}, {firstName} <span>✦</span></h1><p className="subtitle">Tu práctica, tus pacientes, un solo lugar.</p></div><div className="module-actions"><span className={'sync-label ' + (isReal ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'loading' ? 'Cargando…' : isReal ? 'Sincronizado' : 'Datos de demostración'}</span><button className="primary" onClick={() => onNewAppointment ? onNewAppointment() : setActive('Agenda')}><span>+</span> Nueva cita</button></div></section>
    <section className="stats-grid">{[['Citas de hoy', data.stats.appointments, '◷', true, 'Agenda', null], ['Por confirmar', data.stats.pendingConfirmations, '◌', false, 'Agenda', () => onOpenAgendaFiltered && onOpenAgendaFiltered('pending')], ['Seguimientos', data.stats.followUps, '◒', false, 'Seguimientos', null], ['Pacientes activos', data.stats.activePatients, '♧', false, 'Pacientes', null]].map(([label, value, icon, featured, target, handler]) => <button type="button" className={featured ? 'stat-card featured' : 'stat-card'} key={label} onClick={() => handler ? handler() : setActive(target)}><div className="stat-head"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{value}</div><div className="stat-foot"><span>{footLabel}</span></div></button>)}</section>
    <div className="dashboard-grid">
      <section className="panel appointments"><div className="panel-title"><div><h2>Agenda de hoy</h2><p>Tus citas programadas</p></div><button className="link-button" onClick={() => setActive('Agenda')}>Abrir agenda →</button></div><div className="day-line"><span className="today-pill">HOY</span><span>{TODAY_LONG_LABEL}</span></div><div className="appointment-list">{data.appointments.length === 0 ? <p className="muted" style={{ padding: '22px 0', textAlign: 'center' }}>{isReal ? 'No tienes citas programadas para hoy.' : 'Sin citas de demostración.'}</p> : data.appointments.map((item, index) => { const startable = item.status === 'CONFIRMED' && item.patient?.id; const durationLabel = item.durationMinutes != null ? `${item.durationMinutes} min` : item.duration || '60 min'; return <div className="appointment" key={item.id || item.name} onClick={() => startable && onStartConsultation?.(item.patient.id, item.id)} style={startable ? { cursor: 'pointer' } : undefined} title={startable ? 'Clic para iniciar la consulta' : undefined}><div className="time"><b>{item.time || formatUTCTime(item.startAt)}</b><small>{durationLabel}</small></div><div className={'person-avatar ' + (item.color || ['coral', 'blue', 'purple', 'yellow'][index % 4])}>{item.initials || item.patient?.firstName?.[0] || 'P'}</div><div className="appointment-info"><b>{item.name || `${item.patient?.firstName || ''} ${item.patient?.lastName || ''}`}</b><span>{item.type ? (APPOINTMENT_TYPE_LABELS[item.type] || item.type) : 'Consulta'}</span></div><span className={'status ' + (item.status === 'CONFIRMED' || item.status === 'Confirmada' ? 'confirmed' : 'pending')}>{item.status === 'CONFIRMED' ? 'Confirmada' : item.status === 'PENDING_CONFIRMATION' ? 'Por confirmar' : item.status}</span></div> })}</div></section>
      <section className="panel followups"><div className="panel-title"><div><h2>Próxima acción</h2><p>{nextTask ? 'Un pendiente por resolver' : 'Todo en orden'}</p></div></div>{nextTask && <div className="next-action-card"><span className="stat-icon orange">◌</span><div><b>{TASK_TYPE_LABELS[nextTask.type] || nextTask.type} de {nextTask.patient?.firstName} {nextTask.patient?.lastName}</b><small>{nextTask.dueAt && new Date(nextTask.dueAt) < new Date() ? `Vencido ${formatUTCDay(nextTask.dueAt)}` : `Vence ${formatUTCDay(nextTask.dueAt)}`}</small></div><button className="message" onClick={() => setActive('Seguimientos')}>Ver ↗</button></div>}<div className="empty-note"><span>{moreTasks ? '◷' : '✓'}</span><p>{moreTasks ? `${moreTasks} pendiente(s) más en Seguimientos` : 'El resto de tu agenda está en orden'}</p></div></section>
    </div>
  </div></AppChrome>
}