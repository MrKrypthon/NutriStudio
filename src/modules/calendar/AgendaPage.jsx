import { useCallback, useEffect, useMemo, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { appointmentsApi, patientsApi } from '../../lib/api.js'

// All date math here runs in UTC: appointment.startAt is stored and seeded as the practice's
// wall-clock time tagged with a "Z" suffix (see prisma/seed.js), so reading it back with the
// UTC getters is what keeps "09:00" meaning 09:00 regardless of the viewer's system timezone.
// "Today" follows that same convention: the viewer's local calendar date, repackaged as a UTC
// midnight — a fixed demo date used to highlight and jump to "today" for a stale one instead.
const now = new Date()
const TODAY = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
const DEFAULT_HOURS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']
const DAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const TYPE_LABELS = { INITIAL: 'Primera consulta', FOLLOW_UP: 'Seguimiento', QUICK_CONTROL: 'Control rápido', EMERGENCY: 'Emergencia', BLOCK: 'Bloqueo' }
const TYPE_COLORS = { INITIAL: 'coral', FOLLOW_UP: 'blue', QUICK_CONTROL: 'yellow', EMERGENCY: 'purple', BLOCK: 'purple' }
const TYPE_OPTIONS = [['FOLLOW_UP', 'Seguimiento'], ['INITIAL', 'Primera consulta'], ['QUICK_CONTROL', 'Control rápido'], ['EMERGENCY', 'Emergencia']]
const DURATION_OPTIONS = [60, 45, 30, 15]
const TIME_OPTIONS = Array.from({ length: 23 }, (_, i) => { const h = 8 + Math.floor(i / 2); const m = i % 2 === 0 ? '00' : '30'; return `${String(h).padStart(2, '0')}:${m}` })

const DEMO_APPOINTMENTS = [
  { id: 'demo-1', startAt: '2026-08-26T09:00:00.000Z', endAt: '2026-08-26T10:00:00.000Z', type: 'INITIAL', status: 'CONFIRMED', patient: { firstName: 'Mariana', lastName: 'Torres' } },
  { id: 'demo-2', startAt: '2026-08-26T10:00:00.000Z', endAt: '2026-08-26T10:45:00.000Z', type: 'FOLLOW_UP', status: 'CONFIRMED', patient: { firstName: 'Diego', lastName: 'Ramírez' } },
  { id: 'demo-3', startAt: '2026-08-26T12:00:00.000Z', endAt: '2026-08-26T13:00:00.000Z', type: 'FOLLOW_UP', status: 'PENDING_CONFIRMATION', patient: { firstName: 'Sofía', lastName: 'Hernández' } },
  { id: 'demo-4', startAt: '2026-08-28T16:00:00.000Z', endAt: '2026-08-28T16:45:00.000Z', type: 'QUICK_CONTROL', status: 'CONFIRMED', patient: { firstName: 'Jorge', lastName: 'Castillo' } },
]

const startOfWeek = (date) => { const d = new Date(date); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d }
const addDays = (date, amount) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + amount); return d }
const toISODate = (date) => date.toISOString().slice(0, 10)
const emptyForm = (defaultDate) => ({ patientId: '', date: toISODate(defaultDate), time: '09:00', type: 'FOLLOW_UP', duration: 60, notify: 'whatsapp', internalNote: '', patientNote: '' })

function formatRangeLabel(days) {
  const first = days[0], last = days[days.length - 1]
  if (days.length === 1) return `${first.getUTCDate()} de ${MONTHS[first.getUTCMonth()]} de ${first.getUTCFullYear()}`
  const sameMonth = first.getUTCMonth() === last.getUTCMonth()
  return sameMonth ? `${first.getUTCDate()} – ${last.getUTCDate()} ${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}` : `${first.getUTCDate()} ${MONTHS[first.getUTCMonth()]} – ${last.getUTCDate()} ${MONTHS[last.getUTCMonth()]} ${first.getUTCFullYear()}`
}

export default function AgendaPage({ setActive }) {
  const [view, setView] = useState('Semana')
  const [anchor, setAnchor] = useState(TODAY)
  const [appointments, setAppointments] = useState([])
  const [status, setStatus] = useState('loading')
  const [patients, setPatients] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => emptyForm(TODAY))
  const [submitState, setSubmitState] = useState('idle')
  const [submitError, setSubmitError] = useState('')

  const days = useMemo(() => { const start = startOfWeek(anchor); return view === 'Día' ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(start, i)) }, [anchor, view])

  const loadAppointments = useCallback(async () => {
    setStatus('loading')
    try {
      const from = days[0].toISOString()
      const lastDay = new Date(days[days.length - 1]); lastDay.setUTCHours(23, 59, 59, 999)
      const response = await appointmentsApi.list(from, lastDay.toISOString())
      setAppointments(response.items || [])
      setStatus('online')
    } catch (error) {
      if (error.code === 'DEMO_MODE') {
        const from = days[0].getTime(); const to = addDays(days[days.length - 1], 1).getTime()
        setAppointments(DEMO_APPOINTMENTS.filter((a) => { const t = new Date(a.startAt).getTime(); return t >= from && t < to }))
        setStatus('demo')
      } else {
        setAppointments([])
        setStatus('error')
      }
    }
  }, [days])

  useEffect(() => { loadAppointments() }, [loadAppointments])
  useEffect(() => { patientsApi.list('?status=ACTIVE').then((payload) => setPatients(payload.items || [])).catch(() => setPatients([])) }, [])

  const hours = useMemo(() => {
    const set = new Set(DEFAULT_HOURS)
    for (const appointment of appointments) set.add(`${String(new Date(appointment.startAt).getUTCHours()).padStart(2, '0')}:00`)
    return Array.from(set).sort()
  }, [appointments])

  const step = view === 'Semana' ? 7 : 1
  const goToday = () => setAnchor(TODAY)
  const goPrev = () => setAnchor((prev) => addDays(prev, -step))
  const goNext = () => setAnchor((prev) => addDays(prev, step))

  const confirmAppointment = async (id) => {
    try {
      const updated = await appointmentsApi.confirm(id)
      setAppointments((prev) => prev.map((a) => (a.id === id ? updated : a)))
    } catch { /* The list keeps its previous state; the professional can retry. */ }
  }

  const openModal = () => { setForm(emptyForm(anchor)); setSubmitError(''); setSubmitState('idle'); setOpen(true) }
  const closeModal = () => { setOpen(false); setSubmitError('') }
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    if (status !== 'online') { closeModal(); return }
    if (!form.patientId) { setSubmitError('Selecciona un paciente.'); return }
    setSubmitState('saving')
    setSubmitError('')
    const notifyVia = form.notify === 'both' ? ['whatsapp', 'email'] : form.notify === 'none' ? [] : [form.notify]
    try {
      await appointmentsApi.create({ patientId: form.patientId, startAt: `${form.date}T${form.time}:00.000Z`, durationMinutes: form.duration, type: form.type, notifyVia, internalNote: form.internalNote, patientNote: form.patientNote })
      setSubmitState('saved')
      closeModal()
      loadAppointments()
    } catch (error) {
      setSubmitState('error')
      setSubmitError(error.message || 'No se pudo crear la cita.')
    }
  }

  return <AppChrome active="Agenda" setActive={setActive}><div className="content">
    <ModuleHeader eyebrow={`AGENDA · ${MONTHS[anchor.getUTCMonth()].toUpperCase()} ${anchor.getUTCFullYear()}`} title="Tu agenda" subtitle="Organiza tu tiempo y llega preparado a cada consulta." action={<div className="module-actions"><span className={'sync-label ' + (status === 'online' ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'online' ? 'Sincronizada' : status === 'loading' ? 'Cargando…' : status === 'error' ? 'Sin conexión' : 'Datos de demostración'}</span><button className="primary" onClick={openModal}><span>+</span> Nueva cita</button></div>} />

    <div className="toolbar">
      <div className="date-nav"><button onClick={goPrev}>‹</button><b>{formatRangeLabel(days)}</b><button onClick={goNext}>›</button></div>
      <div className="view-switch">{['Día', 'Semana'].map((x) => <button className={view === x ? 'selected' : ''} onClick={() => setView(x)} key={x}>{x}</button>)}</div>
      <button className="secondary" onClick={goToday}>Hoy</button>
    </div>

    <div className="calendar panel">
      <div className="calendar-head" style={{ gridTemplateColumns: `68px repeat(${days.length},1fr)` }}>
        <span>GMT-6</span>
        {days.map((day) => <div className={toISODate(day) === toISODate(TODAY) ? 'calendar-day current' : 'calendar-day'} key={day.toISOString()}><small>{DAY_SHORT[(day.getUTCDay() + 6) % 7]}</small><b>{day.getUTCDate()}</b></div>)}
      </div>
      <div className="calendar-body">
        {hours.map((time) => <div className="calendar-row" style={{ gridTemplateColumns: `68px repeat(${days.length},1fr)` }} key={time}>
          <span className="hour">{time}</span>
          {days.map((day) => {
            const dayEvents = appointments.filter((a) => { const start = new Date(a.startAt); return toISODate(start) === toISODate(day) && `${String(start.getUTCHours()).padStart(2, '0')}:00` === time })
            return <div className="slot" key={day.toISOString()}>
              {dayEvents.map((appointment) => {
                const start = new Date(appointment.startAt)
                const durationMinutes = appointment.endAt ? Math.round((new Date(appointment.endAt) - start) / 60000) : 60
                const top = 4 + (start.getUTCMinutes() / 60) * 63
                const height = Math.max(30, (durationMinutes / 60) * 63 - 8)
                const color = TYPE_COLORS[appointment.type] || 'coral'
                const pending = appointment.status === 'PENDING_CONFIRMATION'
                const name = appointment.patient ? `${appointment.patient.firstName} ${appointment.patient.lastName}` : 'Paciente'
                return <div className={`event ${color}-event`} style={{ top, height, cursor: pending ? 'pointer' : 'default' }} onClick={() => pending && confirmAppointment(appointment.id)} key={appointment.id} title={pending ? 'Clic para confirmar la cita' : undefined}>
                  <b>{name}</b>
                  <small>{TYPE_LABELS[appointment.type] || appointment.type}{pending ? ' · Por confirmar' : ` · ${durationMinutes} min`}</small>
                </div>
              })}
            </div>
          })}
        </div>)}
      </div>
    </div>
  </div>

  {open && <div className="modal-backdrop" onClick={closeModal}><div className="modal appointment-modal" onClick={(e) => e.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">NUEVA CITA</p><h2>Programa una consulta</h2><span className="modal-subtitle">La cita quedará visible en tu agenda.</span></div><button onClick={closeModal}>×</button></div>
    <form onSubmit={submit}>
      <div className="form-step active-step"><span>1</span><b>Selecciona el paciente</b></div>
      <label>Paciente<select value={form.patientId} onChange={(e) => update('patientId', e.target.value)} required><option value="">Selecciona…</option>{patients.map((p) => <option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select></label>
      <div className="notify-box"><b>Notificar al paciente</b><div className="notify-options">{[['whatsapp', 'WhatsApp'], ['email', 'Email'], ['both', 'Ambos'], ['none', 'No notificar']].map(([value, label]) => <label key={value}><input type="radio" name="notify" checked={form.notify === value} onChange={() => update('notify', value)} /> {label}</label>)}</div></div>
      <div className="form-step"><span>2</span><b>Confirma los datos de la consulta</b></div>
      <div className="form-row"><label>Fecha<input type="date" value={form.date} onChange={(e) => update('date', e.target.value)} required /></label><label>Hora<select value={form.time} onChange={(e) => update('time', e.target.value)}>{TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}</select></label></div>
      <div className="form-row"><label>Tipo de cita<select value={form.type} onChange={(e) => update('type', e.target.value)}>{TYPE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Duración<select value={form.duration} onChange={(e) => update('duration', Number(e.target.value))}>{DURATION_OPTIONS.map((d) => <option value={d} key={d}>{d} minutos</option>)}</select></label></div>
      <label>Notas internas<textarea placeholder="Notas que sólo verá tu equipo..." value={form.internalNote} onChange={(e) => update('internalNote', e.target.value)} /></label>
      <label>Nota para el paciente<textarea placeholder="Ej. Recuerda traer tus análisis recientes" value={form.patientNote} onChange={(e) => update('patientNote', e.target.value)} /></label>
      {submitError && <div className="form-error">⚠ {submitError}</div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={closeModal}>Cancelar</button><button className="primary" disabled={submitState === 'saving'}>{submitState === 'saving' ? 'Guardando…' : 'Crear cita'} <span>→</span></button></div>
    </form>
  </div></div>}
  </AppChrome>
}
