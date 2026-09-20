import { useCallback, useEffect, useMemo, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { appointmentsApi, patientsApi, practiceApi } from '../../lib/api.js'

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
// Granularidad al agendar: 15 min, en vez de sólo :00/:30. Así se puede ocupar un hueco que no cae
// en una hora exacta (p. ej. justo donde terminó la cita anterior).
const SLOT_STEP_MINUTES = 15
const minutesToLabel = (total) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`

const DEMO_APPOINTMENTS = [
  { id: 'demo-1', startAt: '2026-08-26T09:00:00.000Z', endAt: '2026-08-26T10:00:00.000Z', type: 'INITIAL', status: 'CONFIRMED', patient: { firstName: 'Mariana', lastName: 'Torres' } },
  { id: 'demo-2', startAt: '2026-08-26T10:00:00.000Z', endAt: '2026-08-26T10:45:00.000Z', type: 'FOLLOW_UP', status: 'CONFIRMED', patient: { firstName: 'Diego', lastName: 'Ramírez' } },
  { id: 'demo-3', startAt: '2026-08-26T12:00:00.000Z', endAt: '2026-08-26T13:00:00.000Z', type: 'FOLLOW_UP', status: 'PENDING_CONFIRMATION', patient: { firstName: 'Sofía', lastName: 'Hernández' } },
  { id: 'demo-4', startAt: '2026-08-28T16:00:00.000Z', endAt: '2026-08-28T16:45:00.000Z', type: 'QUICK_CONTROL', status: 'CONFIRMED', patient: { firstName: 'Jorge', lastName: 'Castillo' } },
]

const startOfWeek = (date) => { const d = new Date(date); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d }
const addDays = (date, amount) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + amount); return d }
const toISODate = (date) => date.toISOString().slice(0, 10)
const emptyForm = (defaultDate, defaultPatientId = '') => ({ patientId: defaultPatientId, date: toISODate(defaultDate), time: '09:00', type: 'FOLLOW_UP', duration: 60, notify: 'whatsapp', internalNote: '', patientNote: '', requestStudies: false, recurrence: 'none', recurCount: 10 })
const STUDIES_NOTE = 'Recuerda traer tus análisis o estudios recientes si los tienes.'
const EMPTY_NEW_PATIENT = { firstName: '', lastName: '', phone: '', email: '' }

// Fallback when the practice hasn't configured "Horarios y disponibilidad" (see SettingsPage).
const DEFAULT_BUSINESS_HOURS = { label: 'Lunes a viernes', ranges: [{ start: '09:00', end: '13:00' }, { start: '15:00', end: '19:00' }] }
const toMinutes = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m }
// Business days are Monday–Friday (the settings screen only edits label + hours, not weekdays).
const isBusinessDay = (day) => { const dow = day.getUTCDay(); return dow >= 1 && dow <= 5 }

const STATUS_FILTERS = [['all', 'Todas'], ['pending', 'Por confirmar'], ['confirmed', 'Confirmadas'], ['blocks', 'Bloqueos']]
// An appointment created with "No notificar" arrives with status SCHEDULED: nothing to confirm, so
// it is already a firm booking and must behave like CONFIRMED (startable, counted as confirmed).
const isConfirmedLike = (status) => status === 'CONFIRMED' || status === 'SCHEDULED'
const matchesStatusFilter = (appointment, filter) => {
  if (filter === 'all') return true
  if (filter === 'blocks') return appointment.type === 'BLOCK'
  if (filter === 'pending') return appointment.status === 'PENDING_CONFIRMATION'
  return isConfirmedLike(appointment.status) && appointment.type !== 'BLOCK'
}

function formatRangeLabel(days) {
  const first = days[0], last = days[days.length - 1]
  if (days.length === 1) return `${first.getUTCDate()} de ${MONTHS[first.getUTCMonth()]} de ${first.getUTCFullYear()}`
  const sameMonth = first.getUTCMonth() === last.getUTCMonth()
  return sameMonth ? `${first.getUTCDate()} – ${last.getUTCDate()} ${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}` : `${first.getUTCDate()} ${MONTHS[first.getUTCMonth()]} – ${last.getUTCDate()} ${MONTHS[last.getUTCMonth()]} ${first.getUTCFullYear()}`
}

export default function AgendaPage({ setActive, onStartConsultation, autoOpenNew, autoOpenPatientId, onConsumeAutoOpen, autoFilter, onConsumeAutoFilter }) {
  const [view, setView] = useState('Semana')
  const [anchor, setAnchor] = useState(TODAY)
  const [appointments, setAppointments] = useState([])
  const [status, setStatus] = useState('loading')
  const [patients, setPatients] = useState([])
  const [open, setOpen] = useState(false)
  const [isBlock, setIsBlock] = useState(false)
  const [form, setForm] = useState(() => emptyForm(TODAY))
  const [submitState, setSubmitState] = useState('idle')
  const [submitError, setSubmitError] = useState('')
  const [newPatient, setNewPatient] = useState(EMPTY_NEW_PATIENT)
  const [newPatientState, setNewPatientState] = useState('idle')
  const [newPatientError, setNewPatientError] = useState('')
  const [showNewPatient, setShowNewPatient] = useState(false)
  const [businessHours, setBusinessHours] = useState(DEFAULT_BUSINESS_HOURS)
  const [statusFilter, setStatusFilter] = useState(() => (autoFilter && ['pending', 'confirmed', 'blocks'].includes(autoFilter) ? autoFilter : 'all'))
  // Drag & drop: which appointment is being dragged, its duration (to keep it on the move), and
  // the slot currently under the pointer (for the drop highlight).
  const [dragId, setDragId] = useState(null)
  const [dragDuration, setDragDuration] = useState(null)
  const [dropKey, setDropKey] = useState(null)
  const [moveError, setMoveError] = useState('')
  // Ticks every minute so the "now" line moves and past appointments fade out as time passes.
  const [nowTick, setNowTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setNowTick((n) => n + 1), 60000); return () => clearInterval(t) }, [])

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

  // The grid header used to say a hardcoded "GMT-6" — the practice's real time zone is what the
  // appointments are stored against, so show its actual UTC offset instead.
  const [tzLabel, setTzLabel] = useState('GMT-6')
  const [practiceTz, setPracticeTz] = useState(null)
  useEffect(() => {
    practiceApi.get().then((practice) => {
      const tz = practice?.timeZone
      if (practice?.businessHours?.ranges?.length) setBusinessHours(practice.businessHours)
      if (!tz) return
      setPracticeTz(tz)
      try {
        const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')
        setTzLabel(part?.value || tz)
      } catch { setTzLabel(tz) }
    }).catch(() => {})
  }, [])

  // "Now" in the practice's own timezone, expressed in the same UTC-wall-clock convention the
  // grid uses (09:00 means 09:00 regardless of the viewer's system time). Drives the current-time
  // line and the "fade past appointments" state; refreshed every minute via nowTick.
  const hours = useMemo(() => {
    const set = new Set(DEFAULT_HOURS)
    // Include the configured business hours so late slots (e.g. 18:00) are visible and bookable.
    for (const range of businessHours.ranges) {
      const start = Number(range.start.slice(0, 2))
      const end = Number(range.end.slice(0, 2))
      for (let h = start; h < end; h += 1) set.add(`${String(h).padStart(2, '0')}:00`)
    }
    for (const appointment of appointments) set.add(`${String(new Date(appointment.startAt).getUTCHours()).padStart(2, '0')}:00`)
    return Array.from(set).sort()
  }, [appointments, businessHours])
  const practiceNow = useMemo(() => {
    if (!practiceTz) {
      // Fallback if the practice timezone hasn't loaded: use the viewer's local wall-clock time,
      // still expressed in the same YYYY-MM-DD + HH:MM convention.
      const now = new Date()
      return { date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, hour: now.getHours(), minute: now.getMinutes() }
    }
    try {
      const date = new Date().toLocaleDateString('en-CA', { timeZone: practiceTz })
      const time = new Date().toLocaleTimeString('en-US', { timeZone: practiceTz, hour: '2-digit', minute: '2-digit', hour12: false })
      const [hour, minute] = time.split(':').map(Number)
      return { date, hour, minute }
    } catch { return null }
  }, [practiceTz, nowTick])
  const nowMs = practiceNow ? new Date(`${practiceNow.date}T${String(practiceNow.hour).padStart(2, '0')}:${String(practiceNow.minute).padStart(2, '0')}:00.000Z`).getTime() : Date.now()
  const nowLine = useMemo(() => {
    if (!practiceNow) return null
    const todayVisible = days.some((d) => toISODate(d) === practiceNow.date)
    if (!todayVisible) return null
    // Clamp "now" to the visible hours range so the line always renders when today is on screen,
    // even if the current time falls before the first or after the last grid hour.
    const firstMinutes = hours.length ? Number(hours[0].slice(0, 2)) * 60 : 0
    const lastMinutes = hours.length ? Number(hours[hours.length - 1].slice(0, 2)) * 60 + 59 : 23 * 60 + 59
    const minutes = Math.max(firstMinutes, Math.min(practiceNow.hour * 60 + practiceNow.minute, lastMinutes))
    const hourIndex = hours.indexOf(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:00`)
    if (hourIndex < 0) return null
    return { top: hourIndex * 63 + ((minutes % 60) / 60) * 63 }
  }, [practiceNow, hours, days])

  // "Today" for the grid (highlight + quick booking) follows the practice's timezone, matching
  // the now-line, instead of the viewer's system date.
  const todayISO = practiceNow?.date || toISODate(TODAY)

  const isWithinBusinessHours = (time) => businessHours.ranges.some((range) => toMinutes(time) >= toMinutes(range.start) && toMinutes(time) < toMinutes(range.end))

  // A slot is free when no appointment overlaps [time, time + duration). Checked against ALL
  // appointments (including blocks and filtered-out ones) so a hidden block still occupies its time.
  const slotIsFree = (day, time, durationMinutes = SLOT_STEP_MINUTES) => {
    const slotMs = Date.parse(`${toISODate(day)}T${time}:00.000Z`)
    const slotEnd = slotMs + durationMinutes * 60000
    return !appointments.some((appointment) => {
      const start = new Date(appointment.startAt).getTime()
      const end = appointment.endAt ? new Date(appointment.endAt).getTime() : start + 60 * 60000
      return start < slotEnd && end > slotMs
    })
  }
  // Bookable: business day, inside the configured hours, in the future, and free of overlaps.
  const canBookSlot = (day, time, durationMinutes = SLOT_STEP_MINUTES) => {
    if (!isBusinessDay(day)) return false
    if (!isWithinBusinessHours(time)) return false
    if (!(Date.parse(`${toISODate(day)}T${time}:00.000Z`) > nowMs)) return false
    return slotIsFree(day, time, durationMinutes)
  }
  // Primer inicio libre a partir de un minuto concreto, en pasos de SLOT_STEP_MINUTES. Es lo que
  // permite agendar en huecos que no caen en :00/:30 (p. ej. justo al terminar la cita anterior).
  const firstFreeFrom = (day, fromMinutes) => {
    for (let minutes = Math.max(0, fromMinutes); minutes < 24 * 60; minutes += SLOT_STEP_MINUTES) {
      const candidate = minutesToLabel(minutes)
      if (canBookSlot(day, candidate)) return candidate
    }
    return null
  }
  // Duración más larga (de las ofrecidas) que cabe antes de la siguiente cita o del cierre.
  const fitDuration = (day, time) => {
    const slotMs = Date.parse(`${toISODate(day)}T${time}:00.000Z`)
    let limit = Infinity
    for (const appointment of appointments) {
      const start = new Date(appointment.startAt).getTime()
      if (start > slotMs && toISODate(new Date(appointment.startAt)) === toISODate(day)) limit = Math.min(limit, start)
    }
    businessHours.ranges.forEach((range) => {
      const end = toMinutes(range.end)
      if (end > toMinutes(time)) limit = Math.min(limit, Date.parse(`${toISODate(day)}T${minutesToLabel(end)}:00.000Z`))
    })
    const available = Number.isFinite(limit) ? Math.round((limit - slotMs) / 60000) : 60
    return DURATION_OPTIONS.find((duration) => duration <= available) || DURATION_OPTIONS[DURATION_OPTIONS.length - 1]
  }
  // Toda la celda es clicable: el minuto sale de dónde se hace clic dentro de la fila, redondeado a
  // SLOT_STEP_MINUTES, en vez de forzar :00/:30.
  const snappedMinutesFromClick = (event, time) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const offset = Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top))
    const minute = Math.min(60 - SLOT_STEP_MINUTES, Math.round(((offset / rect.height) * 60) / SLOT_STEP_MINUTES) * SLOT_STEP_MINUTES)
    return Number(time.slice(0, 2)) * 60 + minute
  }
  const handleSlotClick = (event, day, time) => {
    const target = firstFreeFrom(day, snappedMinutesFromClick(event, time))
    if (target) openSlotModal(day, target)
  }

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

  const openModal = (defaultPatientId) => { setIsBlock(false); setForm(emptyForm(anchor, defaultPatientId)); setResetNewPatient(); setSubmitError(''); setSubmitState('idle'); setOpen(true) }
  const openBlockModal = () => { setIsBlock(true); setForm({ ...emptyForm(anchor), type: 'BLOCK', notify: 'none' }); setResetNewPatient(); setSubmitError(''); setSubmitState('idle'); setOpen(true) }
  const openSlotModal = (day, time) => { setIsBlock(false); setForm({ ...emptyForm(day), date: toISODate(day), time, duration: fitDuration(day, time) }); setResetNewPatient(); setSubmitError(''); setSubmitState('idle'); setOpen(true) }
  const setResetNewPatient = () => { setNewPatient(EMPTY_NEW_PATIENT); setNewPatientState('idle'); setNewPatientError(''); setShowNewPatient(false) }

  // Quick "add patient" inside the appointment modal: keeps the in-progress booking (date, time,
  // notes) instead of navigating away to the full patient form.
  const persistNewPatient = async () => {
    const created = await patientsApi.create({ firstName: newPatient.firstName.trim(), lastName: newPatient.lastName.trim(), phone: newPatient.phone, email: newPatient.email, consentDataAt: new Date().toISOString() })
    setPatients((prev) => [created, ...prev])
    setNewPatient(EMPTY_NEW_PATIENT)
    setNewPatientState('idle')
    setShowNewPatient(false)
    return created
  }

  // "Crear y seleccionar" del formulario inline.
  const createPatient = async () => {
    if (!newPatient.firstName.trim() || !newPatient.lastName.trim()) { setNewPatientState('error'); setNewPatientError('Nombre y apellido son obligatorios.'); return }
    setNewPatientState('saving')
    setNewPatientError('')
    try {
      const created = await persistNewPatient()
      setForm((prev) => ({ ...prev, patientId: created.id }))
    } catch (error) {
      setNewPatientState('error')
      setNewPatientError(error.code === 'DEMO_MODE' ? 'Modo demostración: no se guardará. Conecta el API para crear pacientes.' : (error.message || 'No se pudo crear el paciente.'))
    }
  }

  // "Nueva cita" from Hoy (or "Agendar" from a patient's expediente, which also passes a
  // patientId to preselect) sets this before navigating here instead of just landing on the
  // page and making the professional click "Nueva cita" a second time.
  useEffect(() => {
    if (autoOpenNew) { openModal(autoOpenPatientId); onConsumeAutoOpen?.() }
  }, [autoOpenNew])
  // Same one-shot pattern for the status filter: "Por confirmar" on Hoy lands here already
  // filtered instead of landing on the unfiltered week.
  useEffect(() => {
    if (autoFilter && ['pending', 'confirmed', 'blocks'].includes(autoFilter)) onConsumeAutoFilter?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFilter])
  const closeModal = () => { setOpen(false); setSubmitError('') }
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    if (status !== 'online') { setSubmitError('Modo demostración: no se guardará. Conecta el API para poder agendar.'); return }
    setSubmitState('saving')
    setSubmitError('')
    // If the professional filled the quick "new patient" form and hit "Crear cita" directly,
    // create the patient first instead of blocking with "select a patient".
    let patientId = form.patientId
    if (!isBlock && !patientId && showNewPatient) {
      if (!newPatient.firstName.trim() || !newPatient.lastName.trim()) {
        setSubmitState('error')
        setSubmitError('Escribe el nombre y apellido del nuevo paciente, o selecciona uno existente.')
        return
      }
      try {
        const created = await persistNewPatient()
        patientId = created.id
      } catch (error) {
        setSubmitState('error')
        setSubmitError(error.code === 'DEMO_MODE' ? 'Modo demostración: no se guardará.' : (error.message || 'No se pudo crear el paciente.'))
        return
      }
    }
    if (!isBlock && !patientId) { setSubmitState('error'); setSubmitError('Selecciona un paciente o créalo con "Nuevo paciente".'); return }
    const notifyVia = form.notify === 'both' ? ['whatsapp', 'email'] : form.notify === 'none' ? [] : [form.notify]
    const recurrence = form.recurrence === 'none' ? undefined : { frequency: form.recurrence === 'daily' ? 'DAILY' : 'WEEKLY', count: Number(form.recurCount) || 10 }
    try {
      await appointmentsApi.create({ patientId, startAt: `${form.date}T${form.time}:00.000Z`, durationMinutes: form.duration, type: form.type, notifyVia, internalNote: form.internalNote, patientNote: form.patientNote, recurrence })
      setSubmitState('saved')
      closeModal()
      loadAppointments()
    } catch (error) {
      setSubmitState('error')
      setSubmitError(error.message || 'No se pudo crear la cita.')
    }
  }

  const visibleAppointments = appointments.filter((a) => matchesStatusFilter(a, statusFilter))

  // Sugerencia de horarios: los próximos espacios libres para la fecha y duración elegidas dentro
  // del horario de atención (requisito "sugerencia horario" de la hoja de Agenda).
  const suggestedSlots = useMemo(() => {
    if (!open || isBlock || !form.date) return []
    const day = new Date(`${form.date}T00:00:00.000Z`)
    if (Number.isNaN(day.getTime()) || !isBusinessDay(day)) return []
    const duration = Number(form.duration) || 60
    const slots = []
    for (const range of businessHours.ranges) {
      const start = toMinutes(range.start)
      const end = toMinutes(range.end)
      for (let minutes = start; minutes + duration <= end && slots.length < 6; minutes += SLOT_STEP_MINUTES) {
        const time = minutesToLabel(minutes)
        if (canBookSlot(day, time, duration)) slots.push(time)
      }
    }
    return slots
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isBlock, form.date, form.duration, appointments, businessHours, nowMs])

  // Drag & drop: drop on a day+hour slot moves the appointment to that date/time, keeping its
  // duration. The source "vibrates" while dragged (see .event.dragging CSS).
  const startDrag = (appointment) => {
    setDragId(appointment.id)
    setDragDuration(appointment.endAt ? Math.round((new Date(appointment.endAt) - new Date(appointment.startAt)) / 60000) : 60)
  }
  const handleMove = async (day, time) => {
    if (!dragId) return
    const startAt = `${toISODate(day)}T${time}:00.000Z`
    setMoveError('')
    try {
      const updated = await appointmentsApi.move(dragId, startAt, dragDuration)
      setAppointments((prev) => prev.map((a) => (a.id === dragId ? updated : a)))
    } catch (error) {
      // The server rejects overlapping moves; snap back and tell the professional why.
      setMoveError(error.code === 'APPOINTMENT_OVERLAP' ? 'Ese horario ya está ocupado.' : (error.message || 'No se pudo mover la cita.'))
    }
    setDragId(null)
    setDragDuration(null)
    setDropKey(null)
  }

  return <AppChrome active="Agenda" setActive={setActive}><div className="content">
    <ModuleHeader eyebrow={`AGENDA · ${MONTHS[anchor.getUTCMonth()].toUpperCase()} ${anchor.getUTCFullYear()}`} title="Tu agenda" subtitle="Organiza tu tiempo y llega preparado a cada consulta." action={<div className="module-actions"><span className={'sync-label ' + (status === 'online' ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'online' ? 'Sincronizada' : status === 'loading' ? 'Cargando…' : status === 'error' ? 'Sin conexión' : 'Datos de demostración'}</span><button className="primary" onClick={() => openModal()}><span>+</span> Nueva cita</button><button className="secondary" onClick={openBlockModal}><span>+</span> Bloqueo</button></div>} />

    <div className="toolbar">
      <div className="date-nav"><button onClick={goPrev}>‹</button><b>{formatRangeLabel(days)}</b><button onClick={goNext}>›</button></div>
      <div className="view-switch">{['Día', 'Semana'].map((x) => <button className={view === x ? 'selected' : ''} onClick={() => setView(x)} key={x}>{x}</button>)}</div>
      <div className="view-switch agenda-status-filter">{STATUS_FILTERS.map(([key, label]) => <button className={statusFilter === key ? 'selected' : ''} onClick={() => setStatusFilter(key)} key={key}>{label}</button>)}</div>
      <button className="secondary" onClick={goToday}>Hoy</button>
    </div>
    {moveError && <div className="form-error">⚠ {moveError}</div>}

    <div className="calendar panel">
      <div className="calendar-head" style={{ gridTemplateColumns: `68px repeat(${days.length},1fr)` }}>
        <span>{tzLabel}</span>
        {days.map((day) => <div className={toISODate(day) === todayISO ? 'calendar-day current' : 'calendar-day'} key={day.toISOString()}><small>{DAY_SHORT[(day.getUTCDay() + 6) % 7]}</small><b>{day.getUTCDate()}</b></div>)}
      </div>
      <div className="calendar-body">
        {nowLine && <div className="now-line" style={{ top: nowLine.top }}><span /></div>}
        {hours.map((time) => <div className="calendar-row" style={{ gridTemplateColumns: `68px repeat(${days.length},1fr)` }} key={time}>
          <span className="hour">{time}</span>
          {days.map((day) => {
            const dayEvents = visibleAppointments.filter((a) => { const start = new Date(a.startAt); return toISODate(start) === toISODate(day) && `${String(start.getUTCHours()).padStart(2, '0')}:00` === time })
            const slotKey = `${toISODate(day)}|${time}`
            // Clicable si queda algún inicio libre dentro de la hora, aunque no sea :00/:30 (p. ej.
            // una cita de 09:00 a 09:45 deja libre 09:45, que antes no se podía agendar).
            const rowStart = Number(time.slice(0, 2)) * 60
            const bookable = isBusinessDay(day) && [0, 15, 30, 45].some((offset) => canBookSlot(day, minutesToLabel(rowStart + offset)))
            return <div
              className={'slot' + (dragId && dropKey === slotKey ? ' drop-target' : '') + (bookable ? ' slot-bookable' : '')}
              key={day.toISOString()}
              onClick={bookable ? (e) => handleSlotClick(e, day, time) : undefined}
              title={bookable ? 'Agendar una cita a esta hora' : undefined}
              onDragOver={(e) => { e.preventDefault(); if (dragId) setDropKey(slotKey) }}
              onDragLeave={() => setDropKey((prev) => (prev === slotKey ? null : prev))}
              onDrop={(e) => { e.preventDefault(); handleMove(day, minutesToLabel(snappedMinutesFromClick(e, time))) }}
            >
              {dayEvents.map((appointment) => {
                const start = new Date(appointment.startAt)
                const durationMinutes = appointment.endAt ? Math.round((new Date(appointment.endAt) - start) / 60000) : 60
                const top = 4 + (start.getUTCMinutes() / 60) * 63
                const height = Math.max(34, (durationMinutes / 60) * 63 - 8)
                const color = TYPE_COLORS[appointment.type] || 'coral'
                const pending = appointment.status === 'PENDING_CONFIRMATION'
                const isBlockEvent = appointment.type === 'BLOCK'
                // Blocks are SCHEDULED but must never be startable (they carry no patient).
                const confirmed = isConfirmedLike(appointment.status) && !isBlockEvent
                const isPast = appointment.endAt ? new Date(appointment.endAt).getTime() < nowMs : false
                const name = isBlockEvent ? 'Bloqueo' : appointment.patient ? `${appointment.patient.firstName} ${appointment.patient.lastName}` : 'Paciente'
                const onClick = (e) => { e.stopPropagation(); if (pending) confirmAppointment(appointment.id); else if (confirmed) onStartConsultation?.(appointment.patientId, appointment.id) }
                return <div
                  className={`event ${color}-event${isPast ? ' past' : ''}${dragId === appointment.id ? ' dragging' : ''}`}
                  style={{ top, height, cursor: pending || confirmed ? 'pointer' : 'default' }}
                  onClick={onClick}
                  key={appointment.id}
                  title={pending ? 'Clic para confirmar la cita' : confirmed ? 'Clic para iniciar la consulta' : 'Arrastra para mover de fecha u hora'}
                  draggable
                  onDragStart={() => startDrag(appointment)}
                  onDragEnd={() => { setDragId(null); setDragDuration(null); setDropKey(null) }}
                >
                  <b>{name}</b>
                  <small>{TYPE_LABELS[appointment.type] || appointment.type}{isBlockEvent ? '' : pending ? ' · Por confirmar' : ` · ${durationMinutes} min`}</small>
                </div>
              })}
            </div>
          })}
        </div>)}
      </div>
    </div>
  </div>

  {open && <div className="modal-backdrop" onClick={closeModal}><div className="modal appointment-modal" onClick={(e) => e.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">{isBlock ? 'NUEVO BLOQUEO' : 'NUEVA CITA'}</p><h2>{isBlock ? 'Bloquea tu disponibilidad' : 'Programa una consulta'}</h2><span className="modal-subtitle">{isBlock ? 'Ocupa un horario en tu agenda sin asignarlo a un paciente.' : 'La cita quedará visible en tu agenda.'}</span></div><button onClick={closeModal}>×</button></div>
    <form onSubmit={submit}>
      {!isBlock && <div className="form-step active-step"><span>1</span><b>Selecciona el paciente</b></div>}
      {!isBlock && <div className="patient-field"><span className="field-label">Paciente</span><div className="patient-select-row"><select value={form.patientId} onChange={(e) => { update('patientId', e.target.value); setShowNewPatient(false) }}><option value="">Selecciona…</option>{patients.map((p) => <option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select><button type="button" className={showNewPatient ? 'primary' : 'secondary'} onClick={() => setShowNewPatient((value) => !value)}>{showNewPatient ? 'Cancelar' : '＋ Nuevo paciente'}</button></div></div>}
      {!isBlock && showNewPatient && <div className="new-patient-inline">
        <div className="form-row"><label>Nombre(s) *<input value={newPatient.firstName} onChange={(e) => setNewPatient((prev) => ({ ...prev, firstName: e.target.value }))} placeholder="Ej. Mariana" /></label><label>Apellido(s) *<input value={newPatient.lastName} onChange={(e) => setNewPatient((prev) => ({ ...prev, lastName: e.target.value }))} placeholder="Ej. Torres" /></label></div>
        <div className="form-row"><label>Teléfono<input value={newPatient.phone} onChange={(e) => setNewPatient((prev) => ({ ...prev, phone: e.target.value }))} placeholder="+52 55 1234 5678" /></label><label>Email<input type="email" value={newPatient.email} onChange={(e) => setNewPatient((prev) => ({ ...prev, email: e.target.value }))} placeholder="correo@email.com" /></label></div>
        {newPatientError && <div className="form-error">⚠ {newPatientError}</div>}
        <button type="button" className="secondary" disabled={newPatientState === 'saving'} onClick={createPatient}>{newPatientState === 'saving' ? 'Creando…' : 'Crear y seleccionar'} <span>→</span></button>
      </div>}
      {!isBlock && <div className="notify-box"><b>Notificar al paciente</b><div className="notify-options">{[['whatsapp', 'WhatsApp'], ['email', 'Email'], ['both', 'Ambos'], ['none', 'No notificar']].map(([value, label]) => <label key={value}><input type="radio" name="notify" checked={form.notify === value} onChange={() => update('notify', value)} /> {label}</label>)}</div></div>}
      <div className="form-step"><span>{isBlock ? '1' : '2'}</span><b>Confirma los datos{isBlock ? ' del bloqueo' : ' de la consulta'}</b></div>
      <div className="form-row"><label>Fecha<input type="date" value={form.date} onChange={(e) => update('date', e.target.value)} required /></label><label>Hora<input type="time" value={form.time} onChange={(e) => update('time', e.target.value)} step={300} required /></label></div>
      {!isBlock && suggestedSlots.length > 0 && <div className="suggested-slots"><span>Horarios sugeridos</span><div className="suggested-slot-list">{suggestedSlots.map((slot) => <button type="button" key={slot} className={form.time === slot ? 'selected' : ''} onClick={() => update('time', slot)}>{slot}</button>)}</div></div>}
      {!isBlock && <div className="form-row"><label>Tipo de cita<select value={form.type} onChange={(e) => update('type', e.target.value)}>{TYPE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Duración<select value={form.duration} onChange={(e) => update('duration', Number(e.target.value))}>{DURATION_OPTIONS.map((d) => <option value={d} key={d}>{d} minutos</option>)}</select></label></div>}
      {isBlock && <div className="form-row"><label>Duración<select value={form.duration} onChange={(e) => update('duration', Number(e.target.value))}>{DURATION_OPTIONS.map((d) => <option value={d} key={d}>{d} minutos</option>)}</select></label></div>}
      <div className="form-row"><label>Repetir<select value={form.recurrence} onChange={(e) => update('recurrence', e.target.value)}><option value="none">No repetir</option><option value="daily">Diaria</option><option value="weekly">Semanal</option></select></label>{form.recurrence !== 'none' && <label>Número de veces<input type="number" min="2" max="30" value={form.recurCount} onChange={(e) => update('recurCount', Number(e.target.value))} /></label>}</div>
      <label>Notas internas<textarea placeholder={isBlock ? 'Ej. Bloqueado para junta de equipo' : "Notas que sólo verá tu equipo..."} value={form.internalNote} onChange={(e) => update('internalNote', e.target.value)} /></label>
      {!isBlock && <label>Nota para el paciente<textarea placeholder="Ej. Recuerda traer tus análisis recientes" value={form.patientNote} onChange={(e) => update('patientNote', e.target.value)} /></label>}
      {!isBlock && <label className="consent-check studies-check"><input type="checkbox" checked={form.requestStudies} onChange={(e) => setForm((prev) => ({ ...prev, requestStudies: e.target.checked, patientNote: e.target.checked ? (prev.patientNote || STUDIES_NOTE) : (prev.patientNote === STUDIES_NOTE ? '' : prev.patientNote) }))} /> Pedir que traiga sus estudios (análisis) si tiene</label>}
      {submitError && <div className="form-error">⚠ {submitError}</div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={closeModal}>Cancelar</button><button className="primary" disabled={submitState === 'saving'}>{submitState === 'saving' ? 'Guardando…' : isBlock ? 'Crear bloqueo' : 'Crear cita'} <span>→</span></button></div>
    </form>
  </div></div>}
  </AppChrome>
}
