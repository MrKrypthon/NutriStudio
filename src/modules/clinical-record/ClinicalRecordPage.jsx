import { useEffect, useMemo, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import Anthropometry from '../../components/Anthropometry.jsx'
import FormCard from '../../components/FormCard.jsx'
import Icon from '../../components/Icon.jsx'
import RecallBuilder from '../../components/RecallBuilder.jsx'
import { usePatient } from '../../lib/usePatient.js'
import { appointmentsApi, clinicalApi, documentsApi, labAttachmentsApi, patientsApi, practiceApi } from '../../lib/api.js'
import { centsToPesos, normalizeFees, PAYMENT_METHODS, pesosToCents } from '../../lib/finance.js'

const TABS = ['Resumen', 'General', 'Antropométrico', 'Bioquímico', 'Clínico', 'Dietético', 'Estilo de vida', 'Sociocultural', 'Diagnóstico', 'Tratamiento', 'Monitoreo', 'Notas', 'Transcripción']
const SECTION_KEYS = { Resumen: 'summary', General: 'general', Antropométrico: 'anthropometric', Bioquímico: 'biochemical', Clínico: 'clinical', Dietético: 'dietary', 'Estilo de vida': 'lifestyle', Sociocultural: 'sociocultural', Diagnóstico: 'diagnosis', Tratamiento: 'treatment', Monitoreo: 'monitoring', Notas: 'notes', Transcripción: 'transcription' }
const TRANSCRIPT_FIELD = 'Transcripción de la consulta'
const SAVE_LABELS = { idle: '● Guardado', editing: '● Editando…', saving: '● Guardando…', saved: '● Guardado', error: '⚠ Error al guardar', conflict: '⚠ Se editó en otra sesión, recarga para ver el cambio' }
const CONSULTATION_STATUS_LABELS = { DRAFT: 'Borrador', IN_PROGRESS: 'En curso', COMPLETED: 'Completada' }
const APPOINTMENT_TYPE_LABELS = { INITIAL: 'Primera consulta', FOLLOW_UP: 'Seguimiento', QUICK_CONTROL: 'Control rápido', EMERGENCY: 'Emergencia', BLOCK: 'Bloqueo' }
const FOLLOW_UP_TYPE_OPTIONS = [['FOLLOW_UP', 'Seguimiento'], ['INITIAL', 'Primera consulta'], ['QUICK_CONTROL', 'Control rápido'], ['EMERGENCY', 'Emergencia']]
const FOLLOW_UP_DURATIONS = [60, 45, 30, 15]
const defaultFollowUpDate = () => { const d = new Date(); const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 28); return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}` }

const SEX_LABELS = { female: 'Femenino', male: 'Masculino', F: 'Femenino', M: 'Masculino' }
function computeAge(birthDate) {
  if (!birthDate) return null
  const dob = new Date(birthDate)
  const now = new Date()
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  if (now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())) age -= 1
  return age
}
const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
// Fechas de calendario (fecha de nacimiento) guardadas a medianoche UTC: se muestran con getters UTC
// para que no se corran un día en husos negativos como el de México.
const formatDateUTC = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const formatAppointmentTime = (iso) => { const d = new Date(iso); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }

const DIAGNOSIS_DOMAINS = [
  ['INGESTIÓN', 'Problemas relacionados con ingesta, nutrientes y sustancias bioactivas.', 'mint'],
  ['CLÍNICOS', 'Hallazgos relacionados con condiciones físicas o médicas.', 'yellow'],
  ['CONDUCTUALES-AMBIENTALES', 'Conocimiento, actitudes y factores del entorno.', 'blue'],
  ['OTROS', 'Diagnósticos fuera de los dominios anteriores.', 'purple'],
]

const FAMILY_DISEASES = ['Diabetes', 'Obesidad', 'Cardiopatías', 'HTA', 'Dislipidemias', 'Nefropatías', 'Cáncer', 'Enf. cerebrovasculares', 'Otros']
const RELATIVES = ['Mamá/Papá', 'Abuelos', 'Tíos']
// Evaluación cualitativa del diagnóstico alimentario (CESIVA) y frecuencia de consumo por alimento.
const CESIVA = [['Completa', 'Incluye todos los grupos de alimentos'], ['Equilibrada', 'Proporción adecuada entre grupos'], ['Suficiente', 'Cubre los requerimientos'], ['Inocua', 'Sin riesgo para la salud'], ['Variada', 'Alterna distintos alimentos'], ['Adecuada', 'Apta para el paciente']]
const FOOD_FREQUENCY = ['Leche', 'Queso', 'Yogur', 'Carne de res', 'Carne de pollo', 'Pescado', 'Huevo', 'Tortilla', 'Pan', 'Arroz', 'Frijol', 'Verduras', 'Frutas', 'Refresco', 'Jugo', 'Café', 'Dulces o postres', 'Frituras']
const SYMPTOMS = ['Diarrea', 'Estreñimiento', 'Náusea', 'Úlcera', 'Pirosis', 'Ceguera nocturna', 'Vómito', 'Gastritis', 'Poliuria', 'Polidipsia', 'Polifagia']
const PHYSICAL_EXAM = [
  ['Piel y ojos', ['Petequias', 'Xerosis conjuntival', 'Piel seca', 'Dermatitis pelagrosa', 'Manchas de Bitot', 'Hiperqueratosis folicular', 'Edema', 'Queratomalacia', 'Conjuntivas pálidas', 'Cianosis', 'Xantelasma', 'Piel quebradiza y escamosa']],
  ['Cabello', ['Caídas', 'Frágil y delgado']],
  ['Boca', ['Sialorrea', 'Halitosis', 'Queilosis', 'Glositis', 'Sangrado de encías', 'Xerostomía', 'Atrofia papilar']],
  ['Dentadura', ['Sarro', 'Movilización de piezas dentales', 'Deterioro del esmalte']],
  ['Uñas', ['Fragilidad', 'Reblandecimiento', 'Onicolisis', 'Hiperqueratosis subungueal', 'Coiloniquia']],
]

function TogglePill({ active, label, onClick }) {
  return <button type="button" className={active ? 'toggle-pill active' : 'toggle-pill'} onClick={onClick}>{label}</button>
}

// Subsecciones internas: cada bloque de una sección larga se muestra por separado para no tener
// que hacer scroll dentro del expediente.
function SubTabs({ tabs, value, onChange }) {
  return <div className="sub-tabs">{tabs.map(([key, label]) => <button type="button" key={key} className={'sub-tab' + (value === key ? ' active' : '')} onClick={() => onChange(key)}>{label}</button>)}</div>
}

function Subsection({ groups, value, onChange }) {
  const active = groups.some((g) => g[0] === value) ? value : groups[0][0]
  return <><SubTabs tabs={groups.map((g) => [g[0], g[1]])} value={active} onChange={onChange} /><div className="sub-body">{groups.find((g) => g[0] === active)?.[2]}</div></>
}

// Transcribes live via the browser's own Web Speech API (Chrome/Edge only) — no audio file is
// ever recorded or uploaded, so this doesn't depend on the file-storage decision the project
// still has pending. The transcript is plain text the nutritionist reviews and edits herself;
// nothing here writes to any other section automatically.
function useSpeechRecognition(onFinalChunk) {
  const recognitionRef = useRef(null)
  const [isRecording, setIsRecording] = useState(false)
  const [interimText, setInterimText] = useState('')
  const [error, setError] = useState(null)
  const supported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  const start = () => {
    const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognitionImpl) { setError('unsupported'); return }
    const recognition = new SpeechRecognitionImpl()
    recognition.lang = 'es-MX'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event) => {
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0].transcript
        if (event.results[i].isFinal) final += chunk
        else interim += chunk
      }
      if (final) onFinalChunk(final)
      setInterimText(interim)
    }
    recognition.onerror = (event) => { if (event.error !== 'no-speech') setError(event.error) }
    recognition.onend = () => { setIsRecording(false); setInterimText('') }
    recognition.start()
    recognitionRef.current = recognition
    setError(null)
    setIsRecording(true)
  }

  const stop = () => recognitionRef.current?.stop()

  useEffect(() => () => recognitionRef.current?.stop(), [])

  return { supported, isRecording, interimText, error, start, stop }
}

function TranscriptionTab({ values, updateField, updateFields, appendField, patientName }) {
  const consentGiven = !!values['Consentimiento confirmado']

  const appendFinalChunk = (chunk) => {
    appendField(TRANSCRIPT_FIELD, chunk)
  }

  const { supported, isRecording, interimText, error, start, stop } = useSpeechRecognition(appendFinalChunk)

  const toggleConsent = () => {
    const next = !consentGiven
    updateFields(next
      ? { 'Consentimiento confirmado': next, 'Consentimiento registrado el': new Date().toISOString() }
      : { 'Consentimiento confirmado': next })
  }

  return <div className="panel generic-section">
    <p className="eyebrow">SECCIÓN {TABS.indexOf('Transcripción') + 1} DE 13</p>
    <h1>Transcripción</h1>
    <p className="subtitle">Graba la consulta de {patientName} y transcribe en vivo. El texto queda como borrador para que lo revises y copies a mano a las demás secciones — no se guarda como dato clínico oficial por sí solo.</p>

    <div className="consent-box">
      <label className="consent-check"><input type="checkbox" checked={consentGiven} onChange={toggleConsent} /> Confirmo que {patientName} dio su consentimiento para grabar y transcribir esta consulta.</label>
      {values['Consentimiento registrado el'] && <small className="muted">Registrado el {new Date(values['Consentimiento registrado el']).toLocaleString('es-MX')}</small>}
    </div>

    {!supported && <div className="form-error">⚠ Este navegador no soporta transcripción de voz. Usa Chrome o Edge para grabar.</div>}
    {error && error !== 'unsupported' && <div className="form-error">⚠ Error de grabación ({error}). Intenta de nuevo.</div>}

    <div className="recording-controls">
      {isRecording
        ? <button className="secondary recording-active" onClick={stop}><span className="recording-dot" />Detener grabación</button>
        : <button className="primary" disabled={!consentGiven || !supported} onClick={start}>● Grabar consulta</button>}
      {isRecording && <span className="recording-live-label">Escuchando…</span>}
      {!consentGiven && supported && <small className="muted">Confirma el consentimiento antes de grabar.</small>}
    </div>

    {isRecording && interimText && <div className="transcript-interim"><small className="muted">Transcribiendo…</small><p>{interimText}</p></div>}

    <FormCard title="Transcripción" fields={[`${TRANSCRIPT_FIELD}|`]} values={values} onFieldChange={updateField} />
  </div>
}

export default function ClinicalRecordPage({ setActive, patientId, consultationId, onConsumeConsultation, appointmentId, onConsumeAppointment, onScheduleAppointment }) {
  const { patient, reload: reloadPatient } = usePatient(patientId)
  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Cargando…'
  const patientInitials = patient ? `${patient.firstName[0] || ''}${patient.lastName[0] || ''}` : '··'

  const [tab, setTab] = useState('Antropométrico')
  const [sub, setSub] = useState('')
  const [loadState, setLoadState] = useState('loading')
  const [consultation, setConsultation] = useState(null)
  const [historyCount, setHistoryCount] = useState(0)
  const [sections, setSections] = useState({})
  const [saveState, setSaveState] = useState('idle')
  const [measurementState, setMeasurementState] = useState('idle')
  const [measurements, setMeasurements] = useState([])
  const [chartMetric, setChartMetric] = useState('Peso')
  const [diagnoses, setDiagnoses] = useState([])
  const [diagnosisForm, setDiagnosisForm] = useState(null)
  const [diagnosisSaveState, setDiagnosisSaveState] = useState('idle')
  const [labForm, setLabForm] = useState(null)
  const [report, setReport] = useState(null)
  const [reportState, setReportState] = useState('idle')
  const [exportDoc, setExportDoc] = useState(null)
  const [exportState, setExportState] = useState('idle')
  const [completionState, setCompletionState] = useState('idle')
  const [completeOpen, setCompleteOpen] = useState(false)
  const [completeForm, setCompleteForm] = useState({ method: 'CASH', amount: '' })
  const [completeError, setCompleteError] = useState('')
  // Flujo de cierre: tras registrar el pago se ofrece agendar seguimiento y descargar el expediente.
  const [postComplete, setPostComplete] = useState(false)
  const [followUp, setFollowUp] = useState({ date: '', time: '09:00', type: 'FOLLOW_UP', duration: 60 })
  const [followUpState, setFollowUpState] = useState('idle')
  const [followUpError, setFollowUpError] = useState('')
  // Edición de datos del paciente desde el Resumen (fecha de nacimiento y ocupación) en la consulta.
  const [patientEdit, setPatientEdit] = useState(false)
  const [patientForm, setPatientForm] = useState({ birthDate: '', occupation: '' })
  const [patientSaveState, setPatientSaveState] = useState('idle')
  const [attachments, setAttachments] = useState([])
  const [uploadState, setUploadState] = useState('idle')
  const [uploadError, setUploadError] = useState('')
  const saveTimer = useRef(null)
  // Per-section autosave state (a single pendingSaveRef + single timer LOST edits: switching
  // sections within the 800ms window cancelled the previous section's save, and the finally in
  // the resolved request wiped a newer pending edit). Now:
  //  - pendingRef: sectionKey -> latest payload awaiting a flush (every edited section persists)
  //  - lastSavedAtRef: the latest server-confirmed lastSavedAt per section, read at FLUSH time so
  //    a save that lands while the user keeps typing never sends a stale optimistic token (self-409)
  //  - payloadMirrorRef: synchronous mirror of each section payload so two edits in the same tick
  //    merge instead of the second overwriting the first from a stale render closure
  const pendingRef = useRef({})
  const inFlightRef = useRef(new Set())
  const lastSavedAtRef = useRef({})
  const payloadMirrorRef = useRef({})

  useEffect(() => {
    if (!patientId) { setLoadState('ready'); return undefined }
    let cancelled = false
    async function load() {
      setLoadState('loading')
      try {
        const list = await patientsApi.consultations(patientId)
        setHistoryCount((list.items || []).length)
        // Real evolution data for the Antropométrico chart: every measurement across the
        // patient's consultations, oldest first.
        setMeasurements((list.items || []).flatMap((c) => c.measurements || []).sort((a, b) => new Date(a.measuredAt) - new Date(b.measuredAt)))
        let full
        if (consultationId) {
          // A specific historical session requested from Consultas → load it as-is (a completed
          // one included) instead of the current in-progress consultation. Consume the id even if
          // the fetch fails — otherwise it stays set and the next "Abrir expediente" reopens the
          // wrong (stale or other-patient) session.
          full = await clinicalApi.get(consultationId).catch((err) => { onConsumeConsultation?.(); throw err })
          onConsumeConsultation?.()
        } else {
          let active
          try {
            active = (list.items || []).find((item) => item.status === 'IN_PROGRESS')
            if (!active) {
              active = await clinicalApi.create(patientId, appointmentId ? { appointmentId } : {})
            } else if (appointmentId) {
              // Same-day second appointment joins the open session (documented intent). But a session
              // left open from a PREVIOUS day must be closed before starting a new one, otherwise
              // different visits keep merging into a single ever-growing consultation.
              const stale = new Date(active.startedAt).toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)
              if (stale) {
                await clinicalApi.complete(active.id).catch(() => {})
                active = await clinicalApi.create(patientId, { appointmentId })
              } else {
                await appointmentsApi.complete(appointmentId).catch(() => {})
              }
            }
          } finally {
            // Consume the appointment id whether or not the calls above succeeded — a stuck id
            // would re-run complete/create side effects on the same appointment next open.
            if (appointmentId) onConsumeAppointment?.()
          }
          full = await clinicalApi.get(active.id)
        }
        if (cancelled) return
        setConsultation(full)
        setAttachments(full.labAttachments || [])
        const bySectionKey = {}
        payloadMirrorRef.current = {}
        lastSavedAtRef.current = {}
        for (const section of full.sections || []) {
          bySectionKey[section.sectionKey] = section
          payloadMirrorRef.current[section.sectionKey] = section.payload || {}
          lastSavedAtRef.current[section.sectionKey] = section.lastSavedAt
        }
        setSections(bySectionKey)
        setDiagnoses(full.diagnoses || [])
        setLoadState('ready')
      } catch {
        if (!cancelled) setLoadState('error')
      }
    }
    load()
    return () => {
      cancelled = true
      clearTimeout(saveTimer.current)
      // The debounce trades "save on every keystroke" for "save 800ms after the user stops
      // typing" — but navigating away inside that window must not drop edits. Replay every
      // pending section as a best-effort fire-and-forget request (in-flight ones finish on
      // their own; the component is gone so failures have nowhere to surface anyway).
      for (const [key, payload] of Object.entries(pendingRef.current)) {
        if (consultation?.id) clinicalApi.saveSection(consultation.id, key, payload, lastSavedAtRef.current[key]).catch(() => {})
      }
    }
  }, [patientId])

  useEffect(() => {
    if (!consultation) return
    let cancelled = false
    documentsApi.list(`?patientId=${patientId}&type=consultation_report`)
      .then((response) => { if (!cancelled) { const existing = (response.items || []).find((doc) => doc.consultationId === consultation.id); if (existing) setReport(existing) } })
      .catch(() => {})
    documentsApi.list(`?patientId=${patientId}&type=consultation_export`)
      .then((response) => { if (!cancelled) { const existing = (response.items || []).find((doc) => doc.consultationId === consultation.id); if (existing) setExportDoc(existing) } })
      .catch(() => {})
    return () => { cancelled = true }
  }, [consultation, patientId])

  const sectionKey = SECTION_KEYS[tab]
  const currentValues = sections[sectionKey]?.payload || {}

  const saveSection = async (key, payload) => {
    if (!consultation || inFlightRef.current.has(key)) return
    inFlightRef.current.add(key)
    setSaveState('saving')
    try {
      const saved = await clinicalApi.saveSection(consultation.id, key, payload, lastSavedAtRef.current[key])
      lastSavedAtRef.current[key] = saved.lastSavedAt
      payloadMirrorRef.current[key] = saved.payload || {}
      setSections((prev) => ({ ...prev, [key]: saved }))
      setSaveState('saved')
    } catch (error) {
      if (error.code === 'CONCURRENT_EDIT') {
        setSaveState('conflict')
        // The optimistic token was stale (e.g. a prior save for this section resolved mid-typing).
        // Resync lastSavedAt from the server and re-queue the local version so it actually lands
        // instead of 409-ing forever.
        try {
          const fresh = await clinicalApi.get(consultation.id)
          for (const s of fresh.sections || []) {
            lastSavedAtRef.current[s.sectionKey] = s.lastSavedAt
            payloadMirrorRef.current[s.sectionKey] = s.payload || {}
          }
          pendingRef.current[key] = payload
          scheduleFlush()
        } catch { /* leave the conflict banner visible */ }
      } else {
        setSaveState('error')
      }
    } finally {
      inFlightRef.current.delete(key)
      if (pendingRef.current[key]) scheduleFlush()
    }
  }

  const scheduleFlush = () => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushPending, 800)
  }

  // Every section with pending edits gets saved — switching tabs mid-debounce must not discard
  // the previous section's work. Sections with an in-flight request are re-queued and flushed
  // once their save resolves (serialized per section, so no overlapping writes).
  const flushPending = () => {
    const batch = pendingRef.current
    pendingRef.current = {}
    for (const [key, pending] of Object.entries(batch)) {
      if (inFlightRef.current.has(key)) { pendingRef.current[key] = pending; continue }
      saveSection(key, pending.payload)
    }
  }

  // updateFields merges against the synchronous payloadMirrorRef instead of the render-time
  // currentValues closure, so two edits landing in the same tick (e.g. two transcription chunks)
  // accumulate instead of the second silently overwriting the first.
  const updateFields = (updates) => {
    const base = payloadMirrorRef.current[sectionKey] || {}
    const nextValues = { ...base, ...updates }
    payloadMirrorRef.current[sectionKey] = nextValues
    setSections((prev) => ({ ...prev, [sectionKey]: { ...prev[sectionKey], payload: nextValues } }))
    setSaveState('editing')
    pendingRef.current[sectionKey] = { payload: nextValues }
    scheduleFlush()
  }
  const updateField = (label, value) => updateFields({ [label]: value })

  // Appends against the synchronous payloadMirrorRef, so consecutive speech chunks landing in the
  // same tick accumulate instead of the second overwriting the first from a stale render closure.
  const appendField = (label, text) => {
    const base = payloadMirrorRef.current[sectionKey] || {}
    const existing = base[label] || ''
    const separator = existing && !existing.endsWith('\n') && !existing.endsWith(' ') ? ' ' : ''
    updateFields({ [label]: `${existing}${separator}${text}` })
  }

  // For Antropométrico: as soon as weight and height are both present, derive the IMC instead of
  // making the nutritionist type it by hand.
  const updateAnthropometric = (label, value) => {
    const next = { ...(payloadMirrorRef.current[sectionKey] || {}), [label]: value }
    const weight = Number(next['Peso (kg)'])
    const height = Number(next['Talla (cm)'])
    if (weight > 0 && height > 0) next['IMC calculado'] = (weight / ((height / 100) ** 2)).toFixed(1)
    // Clearing weight/height must drop the previously derived IMC instead of showing a stale value.
    else delete next['IMC calculado']
    updateFields(next)
  }

  const saveLabel = SAVE_LABELS[saveState]
  const anthro = sections.anthropometric?.payload || {}
  const numOrUndefined = (value) => value !== undefined && value !== '' ? Number(value) : undefined
  // The server upserts today's measurement, so re-registering corrects it instead of stacking a
  // duplicate point; the button just reflects whether a value was already captured today.
  const todayMeasured = consultation
    ? measurements.some((m) => m.consultationId === consultation.id && new Date(m.measuredAt).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10))
    : false

  const registerMeasurement = async () => {
    if (!consultation) return
    setMeasurementState('saving')
    try {
      const created = await clinicalApi.registerMeasurement(consultation.id, {
        weightKg: numOrUndefined(anthro['Peso (kg)']),
        heightCm: numOrUndefined(anthro['Talla (cm)']),
        waistCm: numOrUndefined(anthro['Cintura (cm)']),
        hipCm: numOrUndefined(anthro['Cadera (cm)']),
        abdomenCm: numOrUndefined(anthro['Abdomen (cm)']),
        bodyFatPercent: numOrUndefined(anthro['% Grasa corporal']),
        muscleMassKg: numOrUndefined(anthro['Kg de músculo']),
      })
      // The server upserts a same-day correction (same id); replace any existing row with that id
      // instead of appending, so the chart never shows two stacked points for one measurement.
      setMeasurements((prev) => [...prev.filter((m) => m.id !== created.id), created].sort((a, b) => new Date(a.measuredAt) - new Date(b.measuredAt)))
      setMeasurementState('saved')
    } catch {
      setMeasurementState('error')
    }
  }

  const openDiagnosisForm = (domain) => { setDiagnosisSaveState('idle'); setDiagnosisForm({ domain, problem: '', etiology: '', evidence: '' }) }
  const closeDiagnosisForm = () => setDiagnosisForm(null)
  const updateDiagnosisForm = (key, value) => setDiagnosisForm((prev) => ({ ...prev, [key]: value }))

  const removeDiagnosis = async (id) => {
    if (!consultation) return
    try {
      await clinicalApi.removeDiagnosis(consultation.id, id)
      setDiagnoses((prev) => prev.filter((d) => d.id !== id))
    } catch { /* leave it in the list; the professional can retry */ }
  }

  // Sessions were never closable from the UI (the server route existed but nothing called it), so
  // consultations stayed IN_PROGRESS forever and every later visit merged into the same session.
  // Al cerrar se registra el pago (método + monto) para que el ingreso aparezca solo en Finanzas.
  const openCompletion = async () => {
    if (!consultation || consultation.status === 'COMPLETED') return
    setCompleteError('')
    const type = consultation.appointment?.type || 'FOLLOW_UP'
    let feeCents = 0
    try { feeCents = normalizeFees((await practiceApi.get())?.fees)[type] || 0 } catch { feeCents = 0 }
    setCompleteForm({ method: 'CASH', amount: feeCents ? String(centsToPesos(feeCents)) : '' })
    setCompleteOpen(true)
  }
  const submitCompletion = async () => {
    if (!consultation) return
    setCompletionState('saving')
    setCompleteError('')
    const payload = { paymentMethod: completeForm.method }
    if (completeForm.amount.trim() !== '') payload.amountCents = pesosToCents(completeForm.amount)
    try {
      await clinicalApi.complete(consultation.id, payload)
      setConsultation((prev) => (prev ? { ...prev, status: 'COMPLETED', completedAt: new Date().toISOString() } : prev))
      setCompletionState('idle')
      setCompleteOpen(false)
      // Continúa el flujo: agendar la siguiente cita y descargar el expediente.
      setFollowUp({ date: defaultFollowUpDate(), time: '09:00', type: 'FOLLOW_UP', duration: 60 })
      setFollowUpState('idle')
      setFollowUpError('')
      setPostComplete(true)
    } catch (error) {
      setCompletionState('error')
      setCompleteError(error.message || 'No se pudo cerrar la consulta.')
    }
  }
  const closePostComplete = () => { setPostComplete(false); setFollowUpState('idle'); setFollowUpError('') }
  const createFollowUpAppointment = async () => {
    if (!followUp.date || !followUp.time) { setFollowUpError('Elige fecha y hora de la cita.'); return }
    setFollowUpState('saving')
    setFollowUpError('')
    try {
      await appointmentsApi.create({ patientId, startAt: `${followUp.date}T${followUp.time}:00.000Z`, durationMinutes: followUp.duration, type: followUp.type, notifyVia: [], internalNote: 'Seguimiento agendado al terminar la consulta.' })
      setFollowUpState('done')
    } catch (error) {
      setFollowUpState('idle')
      setFollowUpError(error.message || 'No se pudo crear la cita.')
    }
  }
  // Genera (si hace falta) y descarga el expediente completo en un solo paso para el cierre.
  const downloadFullRecord = async () => {
    if (!consultation) return
    setExportState('working')
    try {
      const doc = exportDoc || await documentsApi.createForExport(consultation.id)
      const generated = await documentsApi.generate(doc.id)
      setExportDoc(generated)
      const blob = await documentsApi.downloadBlob(generated.id)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = generated.storageKey
      link.click()
      URL.revokeObjectURL(url)
      setExportState('idle')
    } catch {
      setExportState('error')
    }
  }

  // Datos del paciente capturables durante la consulta (fecha de nacimiento y ocupación).
  const startPatientEdit = () => {
    setPatientForm({ birthDate: patient?.birthDate ? new Date(patient.birthDate).toISOString().slice(0, 10) : '', occupation: patient?.occupation || '' })
    setPatientSaveState('idle')
    setPatientEdit(true)
  }
  const savePatientEdit = async () => {
    setPatientSaveState('saving')
    try {
      await patientsApi.update(patientId, { birthDate: patientForm.birthDate || null, occupation: patientForm.occupation })
      setPatientEdit(false)
      setPatientSaveState('idle')
      reloadPatient()
    } catch {
      setPatientSaveState('error')
    }
  }

  // Diagnoses were create/delete only; the PATCH endpoint existed but was never wired.
  const editDiagnosis = (d) => setDiagnosisForm({ ...d, _editingId: d.id })
  const saveDiagnosis = async () => {
    if (!consultation || !diagnosisForm?.problem) return
    setDiagnosisSaveState('saving')
    try {
      const { _editingId, id: _diagnosisId, ...payload } = diagnosisForm
      if (_editingId) {
        const updated = await clinicalApi.updateDiagnosis(consultation.id, _editingId, payload)
        setDiagnoses((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
      } else {
        const created = await clinicalApi.addDiagnosis(consultation.id, payload)
        setDiagnoses((prev) => [...prev, created])
      }
      setDiagnosisForm(null)
      setDiagnosisSaveState('idle')
    } catch {
      setDiagnosisSaveState('error')
    }
  }

  const labs = currentValues['Estudios'] || []
  const openLabForm = () => setLabForm({ name: '', value: '', unit: '', range: '', status: 'Normal' })
  const closeLabForm = () => setLabForm(null)
  const updateLabForm = (key, value) => setLabForm((prev) => ({ ...prev, [key]: value }))
  const saveLab = () => {
    if (!labForm?.name || !labForm?.value) return
    updateField('Estudios', [...labs, { ...labForm, id: `${Date.now()}` }])
    setLabForm(null)
  }
  const removeLab = (id) => updateField('Estudios', labs.filter((lab) => lab.id !== id))
  const updateLabValue = (id, value) => updateField('Estudios', labs.map((lab) => (lab.id === id ? { ...lab, value } : lab)))

  const uploadLabAttachment = async (file) => {
    if (!consultation || !file) return
    // Some OSes/browsers report an empty file.type for a valid .pdf; fall back to the extension
    // so the server-side check (the source of truth) actually gets the chance to accept it.
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    if (!isPdf) { setUploadState('error'); setUploadError('Solo se aceptan archivos PDF.'); return }
    setUploadState('uploading')
    setUploadError('')
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
        reader.readAsDataURL(file)
      })
      const created = await labAttachmentsApi.upload(consultation.id, file.name, dataUrl)
      setAttachments((prev) => [created, ...prev])
      setUploadState('idle')
    } catch (error) {
      setUploadState('error')
      setUploadError(error.message || 'No se pudo subir el archivo.')
    }
  }

  const downloadLabAttachment = async (attachment) => {
    try {
      const blob = await labAttachmentsApi.downloadBlob(attachment.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch { /* the button stays clickable so the professional can retry */ }
  }

  const removeLabAttachment = async (id) => {
    try {
      await labAttachmentsApi.remove(id)
      setAttachments((prev) => prev.filter((a) => a.id !== id))
    } catch { /* leave it in the list; the professional can retry */ }
  }

  // Generate always re-renders the PDF from CURRENT data (bumping the version) instead of turning
  // into a permanent download of stale content once a storageKey exists — that left edited
  // sections/measurements out of the report forever.
  const generateReport = async () => {
    if (!consultation) return
    setReportState('working')
    try {
      const doc = report || await documentsApi.createForReport(consultation.id)
      const generated = await documentsApi.generate(doc.id)
      setReport(generated)
      setReportState('idle')
    } catch {
      setReportState('error')
    }
  }

  const downloadReport = async () => {
    if (!report?.storageKey) return
    setReportState('working')
    try {
      const blob = await documentsApi.downloadBlob(report.id)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = report.storageKey
      link.click()
      URL.revokeObjectURL(url)
      setReportState('idle')
    } catch {
      setReportState('error')
    }
  }

  // RF-05: full expediente export — all sections in a single PDF, separate from the condensed
  // patient-facing report above.
  const generateExport = async () => {
    if (!consultation) return
    setExportState('working')
    try {
      const doc = exportDoc || await documentsApi.createForExport(consultation.id)
      const generated = await documentsApi.generate(doc.id)
      setExportDoc(generated)
      setExportState('idle')
    } catch {
      setExportState('error')
    }
  }

  const downloadExport = async () => {
    if (!exportDoc?.storageKey) return
    setExportState('working')
    try {
      const blob = await documentsApi.downloadBlob(exportDoc.id)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = exportDoc.storageKey
      link.click()
      URL.revokeObjectURL(url)
      setExportState('idle')
    } catch {
      setExportState('error')
    }
  }

  // Real evolution chart for Antropométrico: plots the patient's actual measurements (last 8),
  // for the selected metric. Before this, the chart was a hardcoded SVG line with fake dates.
  const chartPoints = useMemo(() => {
    const pts = measurements
      .map((m) => {
        let value = null
        if (chartMetric === 'Peso') value = m.weightKg != null ? Number(m.weightKg) : null
        else if (chartMetric === 'IMC') value = m.weightKg != null && m.heightCm != null ? Number(m.weightKg) / ((Number(m.heightCm) / 100) ** 2) : null
        else value = m.bodyFatPercent != null ? Number(m.bodyFatPercent) : null
        return { date: m.measuredAt, value }
      })
      .filter((p) => p.value != null)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(-8)
    if (pts.length < 2) return []
    const min = Math.min(...pts.map((p) => p.value))
    const max = Math.max(...pts.map((p) => p.value))
    const range = max - min || 1
    return pts.map((p, i) => ({ ...p, x: 10 + (i / (pts.length - 1)) * 580, y: 118 - ((p.value - min) / range) * 96, value: Math.round(p.value * 10) / 10 }))
  }, [measurements, chartMetric])
  const chartPointLine = chartPoints.map((p) => `${p.x},${p.y}`).join(' ')

  if (!patientId) return <AppChrome active="Pacientes" setActive={setActive}><div className="content clinical-content">
    <div className="result-empty panel"><span>◌</span><h3>Elige un paciente</h3><p>Abre el expediente desde la lista de pacientes para registrar una consulta.</p><button className="primary" onClick={() => setActive('Pacientes')}>Ir a Pacientes</button></div>
  </div></AppChrome>

  return <AppChrome active="Pacientes" setActive={setActive}><div className="content clinical-content">
    <div className="patient-context">
      <button className="back-button" onClick={() => setActive('Pacientes')}>← Pacientes</button>
      <div className="clinical-person"><span className="person-avatar coral">{patientInitials}</span><div><div className="clinical-person-head"><h2>{patientName}</h2><button type="button" className="record-button" title="Grabar consulta" aria-label="Grabar consulta" onClick={() => setTab('Transcripción')}><Icon>record</Icon></button></div><span>Consulta nutricional · {CONSULTATION_STATUS_LABELS[consultation?.status] || 'en curso'}</span></div></div>
      <div className="clinical-actions">{consultation?.status !== 'COMPLETED' && <button className="secondary" disabled={completionState === 'saving'} onClick={openCompletion}>{completionState === 'saving' ? 'Cerrando…' : 'Terminar consulta'}</button>}<button className="secondary" onClick={() => onScheduleAppointment?.()}>▱ Agendar</button>{exportDoc?.storageKey && <button className="secondary" disabled={exportState === 'working'} onClick={downloadExport}>{exportState === 'working' ? '…' : 'Descargar expediente'}</button>}<button className="secondary" disabled={exportState === 'working'} onClick={generateExport}>{exportState === 'working' ? 'Generando…' : exportDoc?.storageKey ? 'Actualizar expediente' : 'Expediente completo'}</button>{report?.storageKey && <button className="secondary" disabled={reportState === 'working'} onClick={downloadReport}>{reportState === 'working' ? '…' : 'Descargar informe'}</button>}<button className="primary" disabled={reportState === 'working'} onClick={generateReport}>{reportState === 'working' ? 'Generando…' : report?.storageKey ? 'Actualizar informe' : 'Generar informe'}</button></div>
    </div>
    {reportState === 'error' && <div className="form-error">⚠ No se pudo generar o descargar el informe.</div>}
    {exportState === 'error' && <div className="form-error">⚠ No se pudo generar o descargar el expediente completo.</div>}
    {measurementState === 'error' && <div className="form-error">⚠ No se pudo registrar la medición.</div>}
    <div className="record-tabs">{TABS.map((x) => <button className={tab === x ? 'active' : ''} onClick={() => { setTab(x); setSub('') }} key={x}>{x}</button>)}</div>

    {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando expediente…</h3></div>}
    {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar ni crear la consulta de {patientName}.</div>}

    {loadState === 'ready' && <>
      {tab === 'Antropométrico' ? <div className="anthro-tab-wrap">
        <Anthropometry values={currentValues} onFieldChange={updateAnthropometric} registerMeasurement={registerMeasurement} measurementState={measurementState} todayMeasured={todayMeasured} patientSex={patient?.sex} patientAge={computeAge(patient?.birthDate)} />
        {chartPoints.length >= 2 && <div className="panel progress-chart">
          <div className="chart-title"><b>Evolución de métricas</b><select value={chartMetric} onChange={(e) => setChartMetric(e.target.value)}><option>Peso</option><option>IMC</option><option>% grasa corporal</option></select></div>
          <div className="chart-lines"><svg viewBox="0 0 600 130" preserveAspectRatio="none"><polyline points={chartPointLine} fill="none" stroke="var(--green)" strokeWidth="3" />{chartPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="5" fill="var(--green)" />)}</svg><div className="chart-labels">{chartPoints.map((p, i) => <span key={i}><b>{p.value}</b><br />{`${new Date(p.date).getUTCDate()}/${String(new Date(p.date).getUTCMonth() + 1).padStart(2, '0')}`}</span>)}</div></div>
        </div>}
      </div>

      : tab === 'Bioquímico' ? <div className="clinical-layout">
        <section className="record-main panel">
          <div className="section-heading"><div><p className="eyebrow">SECCIÓN 4 DE 13</p><h1>Bioquímico</h1><p className="subtitle">Los estudios son opcionales en la primera consulta: se sugieren y suelen traerse en la segunda. Registra los valores que traiga el paciente.</p></div><button className="primary" onClick={() => { setSub('estudios'); openLabForm() }}>+ Agregar estudio</button></div>
          <Subsection value={sub} onChange={setSub} groups={[
            ['estudios', 'Solicitud y estudios', <div className="sub-stack" key="est">
              <FormCard title="Solicitud de estudios" fields={['Estudios solicitados (se traen en la 2ª consulta)|*', 'Notas de bioquímico|*']} values={currentValues} onFieldChange={updateField} />
              {!labs.length && <div className="lab-empty"><span>▧</span><b>Sin estudios adjuntos</b><small>Registra los resultados manualmente con "+ Agregar estudio".</small></div>}
              {labForm && <div className="diagnosis-form panel">
                <p className="eyebrow">NUEVO ESTUDIO</p>
                <div className="form-grid three">
                  <label>Estudio<input value={labForm.name} onChange={(e) => updateLabForm('name', e.target.value)} placeholder="Ej. Glucosa" /></label>
                  <label>Valor<input value={labForm.value} onChange={(e) => updateLabForm('value', e.target.value)} placeholder="Ej. 92" /></label>
                  <label>Unidad<input value={labForm.unit} onChange={(e) => updateLabForm('unit', e.target.value)} placeholder="Ej. mg/dL" /></label>
                  <label>Rango de referencia<input value={labForm.range} onChange={(e) => updateLabForm('range', e.target.value)} placeholder="Ej. 70-100" /></label>
                  <label>Estado<select value={labForm.status} onChange={(e) => updateLabForm('status', e.target.value)}><option>Normal</option><option>Elevado</option><option>Bajo</option><option>Pendiente</option></select></label>
                </div>
                <div className="modal-actions"><button type="button" className="secondary" onClick={closeLabForm}>Cancelar</button><button className="primary" disabled={!labForm.name || !labForm.value} onClick={saveLab}>Guardar estudio</button></div>
              </div>}
              {labs.length > 0 && <div className="lab-list">{labs.map((lab) => { const color = lab.status === 'Normal' ? 'confirmed' : 'pending'; return <div className="lab-row" key={lab.id}><div><b>{lab.name}</b><small>{lab.unit}{lab.range ? ` · ref. ${lab.range}` : ''}</small></div><input value={lab.value} onChange={(e) => updateLabValue(lab.id, e.target.value)} /><span className={'status ' + color}>{lab.status}</span><button type="button" className="link-button" onClick={() => removeLab(lab.id)}>Quitar</button></div> })}</div>}
            </div>],
            ['adjuntos', 'Adjuntos PDF', <div className="sub-stack" key="adj">
              <div className="section-heading"><div><p className="eyebrow">PDF DE ANÁLISIS CLÍNICOS</p><h2>Adjuntos del paciente</h2><p className="subtitle">Sube el PDF que trae {patientName} y captura sus valores arriba a mano; todavía no hay lectura automática.</p></div><label className="secondary" style={{ cursor: uploadState === 'uploading' ? 'default' : 'pointer' }}>{uploadState === 'uploading' ? 'Subiendo…' : '+ Subir PDF'}<input type="file" accept="application/pdf" style={{ display: 'none' }} disabled={uploadState === 'uploading'} onChange={(e) => { uploadLabAttachment(e.target.files[0]); e.target.value = '' }} /></label></div>
              {uploadState === 'error' && <div className="form-error">⚠ {uploadError}</div>}
              {!attachments.length && <div className="lab-empty"><span>▤</span><b>Sin PDF adjuntos</b><small>Sube el estudio en PDF que te compartió el paciente.</small></div>}
              {attachments.length > 0 && <div className="lab-list">{attachments.map((attachment) => <div className="lab-row attachment-row" key={attachment.id}><div><b>{attachment.fileName}</b><small>{(attachment.fileSize / 1024).toFixed(0)} KB · subido por {attachment.uploadedBy?.name || '—'}</small></div><button type="button" className="link-button" onClick={() => downloadLabAttachment(attachment)}>Ver</button><button type="button" className="link-button" onClick={() => removeLabAttachment(attachment.id)}>Quitar</button></div>)}</div>}
            </div>],
          ]} />
        </section>
        <aside className="record-aside panel"><p className="eyebrow">LECTURA RÁPIDA</p><div className="lab-score">{labs.filter((l) => l.status === 'Normal').length}<span>/{labs.length}</span></div><b>Resultados normales</b>{labs.some((l) => l.status === 'Elevado' || l.status === 'Bajo') ? <p className="muted">Hay hallazgos fuera de rango que requieren seguimiento en el tratamiento.</p> : <p className="muted">{labs.length ? 'Todos los estudios registrados están en rango normal.' : 'Todavía no hay estudios registrados.'}</p>}<div className="tag-row">{labs.filter((l) => l.status === 'Elevado' || l.status === 'Bajo').map((l) => <span key={l.id}>{l.name} {l.status.toLowerCase()}</span>)}</div></aside>
      </div>

      : tab === 'Diagnóstico' ? <div className="panel diagnosis-panel">
        <div className="section-heading"><div><p className="eyebrow">SECCIÓN 9 DE 13 · TND</p><h1>Diagnóstico nutricio</h1><p className="subtitle">Evalúa la alimentación (CESIVA), define el tipo de dieta y registra los diagnósticos PES por dominio.</p></div><button className="secondary" onClick={() => { setSub('registrados'); openDiagnosisForm(DIAGNOSIS_DOMAINS[0][0]) }}>+ Nuevo diagnóstico</button></div>
        <Subsection value={sub} onChange={setSub} groups={[
          ['cesiva', 'CESIVA', <div className="form-card cesiva-card" key="ce"><div className="cesiva-card-head"><div><h3>Evaluación CESIVA</h3><p className="muted cesiva-hint">Evalúa cada criterio de la alimentación actual de {patientName}.</p></div><span className="cesiva-score">{CESIVA.filter(([c]) => { const v = currentValues[`CESIVA: ${c}`]; return v === true || v === 'Cumple' }).length} de {CESIVA.length} cumplen</span></div>
            <div className="cesiva-table">
              <div className="cesiva-row cesiva-head"><span>Criterio</span><b>Evaluación</b><b>Comentario</b></div>
              {CESIVA.map(([criterion, description]) => { const key = `CESIVA: ${criterion}`; const raw = currentValues[key]; const value = raw === true ? 'Cumple' : (typeof raw === 'string' ? raw : ''); const noteKey = `CESIVA: ${criterion} (comentario)`; return <div className={'cesiva-row' + (value ? ' rated' : '')} key={criterion}><span className="cesiva-criterion"><b>{criterion}</b><small>{description}</small></span><div className="cesiva-eval">{[['Cumple', 'cumple'], ['Parcial', 'parcial'], ['No cumple', 'nocumple']].map(([label, tone]) => <button type="button" key={label} className={'cesiva-opt ' + tone + (value === label ? ' selected' : '')} onClick={() => updateField(key, value === label ? '' : label)}>{label}</button>)}</div><input className="cesiva-note" value={currentValues[noteKey] ?? ''} onChange={(e) => updateField(noteKey, e.target.value)} placeholder="Comentario" /></div> })}
            </div>
          </div>],
          ['dieta', 'Tipo de dieta', <FormCard key="td" title="Tipo de dieta y evaluación" fields={['Tipo de dieta|', 'Evaluación de la alimentación actual|*']} values={currentValues} onFieldChange={updateField} />],
          ['dominios', 'Dominios PES', <div className="diagnosis-domains" key="dm">{DIAGNOSIS_DOMAINS.map(([title, desc, color]) => <div className={'domain-card ' + color} key={title} onClick={() => { setSub('registrados'); openDiagnosisForm(title) }} style={{ cursor: 'pointer' }}><span>◉</span><b>{title}</b><small>{desc}</small><strong>{diagnoses.filter((d) => d.domain === title).length} seleccionados</strong></div>)}</div>],
          ['registrados', 'Diagnósticos', <div className="sub-stack" key="rg">
            {diagnosisForm && <div className="diagnosis-form panel">
              <p className="eyebrow">{diagnosisForm._editingId ? 'EDITAR DIAGNÓSTICO' : 'NUEVO DIAGNÓSTICO'} · {diagnosisForm.domain}</p>
              <label>Problema<input value={diagnosisForm.problem} onChange={(e) => updateDiagnosisForm('problem', e.target.value)} placeholder="Ej. Ingesta excesiva de energía" /></label>
              <label>Etiología (relacionado con…)<textarea value={diagnosisForm.etiology} onChange={(e) => updateDiagnosisForm('etiology', e.target.value)} placeholder="Causa o factores contribuyentes..." /></label>
              <label>Evidencia (evidenciado por…)<textarea value={diagnosisForm.evidence} onChange={(e) => updateDiagnosisForm('evidence', e.target.value)} placeholder="Signos, síntomas o datos que lo sustentan..." /></label>
              {diagnosisSaveState === 'error' && <div className="form-error">⚠ No se pudo guardar el diagnóstico.</div>}
              <div className="modal-actions"><button type="button" className="secondary" onClick={closeDiagnosisForm}>Cancelar</button><button className="primary" disabled={!diagnosisForm.problem || diagnosisSaveState === 'saving'} onClick={saveDiagnosis}>{diagnosisSaveState === 'saving' ? 'Guardando…' : diagnosisForm._editingId ? 'Guardar cambios' : 'Guardar diagnóstico'}</button></div>
            </div>}
            <div className="diagnosis-selected">
              <p className="eyebrow">DIAGNÓSTICOS SELECCIONADOS</p>
              {!diagnoses.length && <p className="muted">Todavía no hay diagnósticos registrados para esta consulta.</p>}
              {diagnoses.map((d) => <div className="diagnosis-entry" key={d.id}>
                <div><b>{d.domain}</b><span>{d.problem}</span>{d.etiology && <small>Relacionado con: {d.etiology}</small>}{d.evidence && <small>Evidenciado por: {d.evidence}</small>}</div>
                <div className="diagnosis-actions"><button type="button" className="link-button" onClick={() => editDiagnosis(d)}>Editar</button><button type="button" className="link-button" onClick={() => removeDiagnosis(d.id)}>Quitar</button></div>
              </div>)}
            </div>
          </div>],
        ]} />
      </div>

      : tab === 'General' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>General</h1><p className="subtitle">Antecedentes heredofamiliares de {patientName}.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['heredo', 'Heredofamiliares', <div className="heredo-table" key="heredo">
            <div className="heredo-head"><span>Enfermedad</span>{RELATIVES.map((rel) => <b key={rel}>{rel}</b>)}</div>
            {FAMILY_DISEASES.map((disease) => <div className="heredo-row" key={disease}>
              <span>{disease}</span>
              {RELATIVES.map((rel) => { const key = `${disease}__${rel}`; const active = !!currentValues[key]; return <TogglePill key={rel} active={active} label={active ? '✓' : ''} onClick={() => updateField(key, !active)} /> })}
            </div>)}
          </div>],
          ['notas', 'Notas', <FormCard key="notas" title="Notas adicionales" fields={['Notas de antecedentes|']} values={currentValues} onFieldChange={updateField} />],
        ]} />
      </div>

      : tab === 'Clínico' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Clínico</h1><p className="subtitle">Antecedentes, medicamentos, síntomas y exploración física de {patientName}. Marca los que aplican.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['antecedentes', 'Antecedentes', <FormCard key="a" title="Antecedentes personales" fields={['Enfermedades actuales o previas|*', 'Cirugías realizadas|*']} values={currentValues} onFieldChange={updateField} />],
          ['medicamentos', 'Medicamentos', <FormCard key="m" title="Medicamentos y suplementos" fields={['Medicamentos que toma|*', 'Suplementos que toma|*', 'Interacciones con nutrientes|*']} values={currentValues} onFieldChange={updateField} />],
          ['alergias', 'Alergias y sustancias', <div key="al" className="sub-stack"><FormCard title="Alergias e intolerancias" fields={['Alergias alimentarias|*', 'Intolerancias|*']} values={currentValues} onFieldChange={updateField} /><FormCard title="Consumo de sustancias" fields={['Tabaquismo (frecuencia)|', 'Consumo de alcohol (frecuencia)|']} values={currentValues} onFieldChange={updateField} /></div>],
          ['sintomas', 'Síntomas', <div key="s" className="symptom-grid">{SYMPTOMS.map((symptom) => { const active = !!currentValues[symptom]; return <TogglePill key={symptom} active={active} label={symptom} onClick={() => updateField(symptom, !active)} /> })}</div>],
          ['exploracion', 'Exploración física', <div key="e">{PHYSICAL_EXAM.map(([group, findings]) => <div key={group} className="exam-group">
            <b className="exam-group-title">{group}</b>
            <div className="symptom-grid">{findings.map((finding) => { const key = `Exploración: ${finding}`; const active = !!currentValues[key]; return <TogglePill key={finding} active={active} label={finding} onClick={() => updateField(key, !active)} /> })}</div>
          </div>)}</div>],
          ['notas', 'Notas', <FormCard key="n" title="Notas adicionales" fields={['Notas clínicas|']} values={currentValues} onFieldChange={updateField} />],
        ]} />
      </div>

      : tab === 'Monitoreo' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Monitoreo</h1><p className="subtitle">Seguimiento entre consultas de {patientName}: apego, síntomas y ajustes al plan.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['apego', 'Apego a macros', <FormCard key="ap" title="Apego a macros reportado" fields={['% Carbohidratos consumidos|', '% Proteína consumida|', '% Lípidos consumidos|']} values={currentValues} onFieldChange={updateField} />],
          ['subjetivo', 'Seguimiento', <FormCard key="sb" title="Seguimiento subjetivo" fields={['Estado de ánimo|', 'Apego al plan|', 'Antojos|', 'Hambre|', 'Consumo de agua|', 'Ejercicio|']} values={currentValues} onFieldChange={updateField} />],
          ['sintomas', 'Síntomas', <FormCard key="sn" title="Síntomas" fields={['Diarrea o estreñimiento|', 'Inflamación|', 'Cefalea|']} values={currentValues} onFieldChange={updateField} />],
          ['evaluacion', 'Evaluación', <FormCard key="ev" title="Evaluación de la consulta" fields={['Calidad de preparación de comidas|', 'Modificaciones al plan|', 'Tema para la próxima consulta|', 'Observaciones|']} values={currentValues} onFieldChange={updateField} />],
        ]} />
      </div>

      : tab === 'Transcripción' ? <TranscriptionTab values={currentValues} updateField={updateField} updateFields={updateFields} appendField={appendField} patientName={patientName} />

      : tab === 'Dietético' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Dietético</h1><p className="subtitle">Hábitos alimentarios de {patientName}.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['patron', 'Patrón de alimentación', <FormCard key="pt" title="Patrón de alimentación" fields={['Núm. de comidas al día|', 'Horario habitual de comidas|', 'Apetito|', 'Hora a la que tiene más hambre|', 'Comidas o bebidas preferidas|', 'Alimentos que no le agradan o le causan malestar|*']} values={currentValues} onFieldChange={updateField} />],
          ['agua', 'Consumo de agua', <FormCard key="ag" title="Consumo de agua" fields={['Vasos de agua al día|', 'Restricciones dietéticas|', 'Notas dietéticas|*']} values={currentValues} onFieldChange={updateField} />],
          ['historial', 'Historial', <FormCard key="hi" title="Historial de consultas nutricionales" fields={['¿Ha asistido antes a consulta nutricional?|', 'Tipo de consulta previa|', 'Tiempo que llevó la dieta|', 'Motivo por el que la llevó|', 'Resultados obtenidos|', 'Qué tanto se apegó a la dieta|*']} values={currentValues} onFieldChange={updateField} />],
          ['frecuencia', 'Frecuencia de alimentos', <div className="form-card" key="fr"><h3>Frecuencia de alimentos <small className="freq-hint">días por semana</small></h3><div className="frequency-chips">
            {FOOD_FREQUENCY.map((food) => <label className="frequency-chip" key={food}><span>{food}</span><input type="number" min="0" max="7" value={currentValues[`Frecuencia: ${food}`] ?? ''} onChange={(e) => updateField(`Frecuencia: ${food}`, e.target.value)} /></label>)}
          </div></div>],
          ['dieta', 'Dieta habitual', <FormCard key="dh" title="Dieta habitual (alimentos, cantidades y horarios)" fields={['Desayuno|*', 'Colación matutina|*', 'Almuerzo o comida|*', 'Colación vespertina|*', 'Cena|*']} values={currentValues} onFieldChange={updateField} />],
          ['recordatorio', 'Recordatorio 24 h', <RecallBuilder key="r24" value={currentValues['Recordatorio 24 h']} onChange={(next) => updateField('Recordatorio 24 h', next)} age={computeAge(patient?.birthDate)} sex={patient?.sex} />],
        ]} />
      </div>

      : tab === 'Estilo de vida' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Estilo de vida</h1><p className="subtitle">Actividad física y hábitos de {patientName}.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['actividad', 'Actividad física', <FormCard key="af" title="Actividad física" fields={['Tipo de ejercicio|', 'Frecuencia semanal|', 'Duración por sesión|']} values={currentValues} onFieldChange={updateField} />],
          ['descanso', 'Descanso y ánimo', <FormCard key="da" title="Descanso y ánimo" fields={['Horas de sueño|', 'Calidad del sueño|', 'Nivel de estrés percibido|', 'Estado de ánimo|', 'Jornada laboral|', 'Otros|*']} values={currentValues} onFieldChange={updateField} />],
        ]} />
      </div>

      : tab === 'Sociocultural' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Sociocultural</h1><p className="subtitle">Contexto socioeconómico y cultural de {patientName}.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['contexto', 'Contexto', <FormCard key="cx" title="Contexto socioeconómico" fields={['Ocupación|', 'Barreras económicas para el plan (presupuesto)|*', 'Acceso a alimentos|', 'Entorno familiar|*']} values={currentValues} onFieldChange={updateField} />],
          ['cultura', 'Cultura y creencias', <FormCard key="cu" title="Cultura y creencias" fields={['Restricciones religiosas o culturales|', 'Creencias sobre alimentación|', 'Notas socioculturales|*']} values={currentValues} onFieldChange={updateField} />],
        ]} />
      </div>

      : tab === 'Resumen' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Resumen</h1><p className="subtitle">Motivo de consulta, datos generales y contexto de {patientName}.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['motivo', 'Motivo de consulta', <FormCard key="mo" title="Motivo de consulta y objetivo" fields={['Motivo de consulta|*', 'Objetivo|*']} values={currentValues} onFieldChange={updateField} />],
          ['datos', 'Datos del paciente', <div className="summary-card form-card" key="dp"><div className="summary-card-head"><h3>Datos del paciente</h3>{!patientEdit
            ? <button type="button" className="link-button" onClick={startPatientEdit}>Editar fecha de nacimiento y ocupación</button>
            : <div className="summary-card-actions"><button type="button" className="link-button" onClick={() => setPatientEdit(false)}>Cancelar</button><button type="button" className="link-button" disabled={patientSaveState === 'saving'} onClick={savePatientEdit}>{patientSaveState === 'saving' ? 'Guardando…' : 'Guardar'}</button></div>}</div><div className="form-grid three">
            <label>Nombre<input value={patient ? `${patient.firstName} ${patient.lastName}` : '—'} readOnly /></label>
            <label>Sexo<input value={patient?.sex ? (SEX_LABELS[patient.sex] || patient.sex) : '—'} readOnly /></label>
            <label>Fecha de nacimiento{patientEdit ? <input type="date" value={patientForm.birthDate} onChange={(e) => setPatientForm((prev) => ({ ...prev, birthDate: e.target.value }))} /> : <input value={patient?.birthDate ? formatDateUTC(patient.birthDate) : '—'} readOnly />}</label>
            <label>Edad<input value={computeAge(patient?.birthDate) != null ? `${computeAge(patient.birthDate)} años` : '—'} readOnly /></label>
            <label>Ocupación{patientEdit ? <input value={patientForm.occupation} onChange={(e) => setPatientForm((prev) => ({ ...prev, occupation: e.target.value }))} placeholder="Ej. Diseñadora" /> : <input value={patient?.occupation || '—'} readOnly />}</label>
            <label>Contacto<input value={[patient?.phone, patient?.email].filter(Boolean).join(' · ') || '—'} readOnly /></label>
          </div>{patientSaveState === 'error' && <div className="form-error">⚠ No se pudieron guardar los datos.</div>}</div>],
          ['historial', 'Historial y agenda', <div className="summary-card form-card" key="ha"><h3>Historial y agenda</h3><div className="form-grid">
            <label>Consultas registradas<input value={`${historyCount}`} readOnly /></label>
            <label>Consulta actual<input value={consultation ? (consultation.status === 'IN_PROGRESS' ? 'En curso' : consultation.status) : '—'} readOnly /></label>
            <label>Próxima cita<input value={patient?.nextAppointmentAt ? `${formatDate(patient.nextAppointmentAt)} · ${formatAppointmentTime(patient.nextAppointmentAt)} · ${APPOINTMENT_TYPE_LABELS[patient.nextAppointmentType] || 'Cita'}` : 'Sin cita próxima'} readOnly /></label>
          </div></div>],
        ]} />
      </div>

      : tab === 'Tratamiento' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Tratamiento</h1><p className="subtitle">Plan de intervención acordado con {patientName}: objetivos, educación y seguimiento.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['objetivos', 'Objetivos', <FormCard key="ob" title="Objetivos terapéuticos" fields={['Objetivo general|', 'Objetivos a corto plazo|', 'Objetivos a largo plazo|']} values={currentValues} onFieldChange={updateField} />],
          ['recomendaciones', 'Recomendaciones', <FormCard key="rc" title="Recomendaciones" fields={['Recomendaciones generales|', 'Recomendaciones de alimentación|']} values={currentValues} onFieldChange={updateField} />],
          ['educacion', 'Educación', <FormCard key="ed" title="Educación nutricional" fields={['Temas de educación para el paciente|', 'Material educativo entregado|']} values={currentValues} onFieldChange={updateField} />],
          ['metas', 'Metas y acuerdos', <FormCard key="mt" title="Metas y acuerdos" fields={['Metas SMART|', 'Barreras y soluciones|*', 'Acuerdos con el paciente|']} values={currentValues} onFieldChange={updateField} />],
          ['suplementos', 'Suplementos', <FormCard key="sp" title="Suplementos" fields={['Suplementos recomendados|*', 'Dosis e indicaciones|*']} values={currentValues} onFieldChange={updateField} />],
          ['seguimiento', 'Seguimiento', <FormCard key="sg" title="Seguimiento" fields={['Próximos pasos|', 'Notas de tratamiento|']} values={currentValues} onFieldChange={updateField} />],
        ]} />
      </div>

      : tab === 'Notas' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Notas</h1><p className="subtitle">Información adicional de {patientName} no clasificada en las demás secciones.</p>
        <FormCard title="Notas de consulta" fields={['Notas de consulta|']} values={currentValues} onFieldChange={updateField} />
      </div>

      : <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>{tab}</h1><p className="subtitle">Registra los datos de {tab.toLowerCase()} de {patientName}.</p>
        <FormCard title={tab} fields={['Registro clínico|', 'Notas adicionales|']} values={currentValues} onFieldChange={updateField} />
      </div>}

      <div className="wizard-footer"><button className="secondary" disabled={TABS.indexOf(tab) === 0} onClick={() => setTab(TABS[TABS.indexOf(tab) - 1])}>← Anterior</button><span>{saveLabel}</span><button className="primary" disabled={TABS.indexOf(tab) === TABS.length - 1} onClick={() => setTab(TABS[TABS.indexOf(tab) + 1])}>Siguiente <span>→</span></button></div>
    </>}
  </div>
  {completeOpen && <div className="modal-backdrop" onClick={() => setCompleteOpen(false)}><div className="modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">TERMINAR CONSULTA</p><h2>Registra el pago</h2><span className="modal-subtitle">El ingreso se guarda solo en Finanzas con el método que elijas.</span></div><button onClick={() => setCompleteOpen(false)}>×</button></div>
    <label>Monto de la consulta (MXN)<input type="number" min="0" step="0.01" value={completeForm.amount} onChange={(event) => setCompleteForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="Monto" autoFocus /></label>
    <label>Método de pago<div className="complete-methods">{PAYMENT_METHODS.map(([value, label]) => <button type="button" key={value} className={completeForm.method === value ? 'selected' : ''} onClick={() => setCompleteForm((prev) => ({ ...prev, method: value }))}>{label}</button>)}</div></label>
    {completeError && <div className="form-error">⚠ {completeError}</div>}
    <div className="modal-actions"><button type="button" className="secondary" onClick={() => setCompleteOpen(false)}>Cancelar</button><button type="button" className="primary" disabled={completionState === 'saving'} onClick={submitCompletion}>{completionState === 'saving' ? 'Cerrando…' : 'Terminar y registrar'} <span>→</span></button></div>
  </div></div>}

  {postComplete && <div className="modal-backdrop" onClick={closePostComplete}><div className="modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">CONSULTA TERMINADA</p><h2>{followUpState === 'done' ? 'Siguiente cita agendada' : 'Pago registrado'}</h2><span className="modal-subtitle">{followUpState === 'done' ? 'La cita ya aparece en tu agenda.' : 'El ingreso quedó guardado en Finanzas.'}</span></div><button onClick={closePostComplete}>×</button></div>
    {(followUpState === 'done' || followUpState === 'skipped')
      ? <div className="post-complete">
          <p>Último paso: descarga el expediente completo de {patientName} para tu archivo.</p>
          {exportState === 'error' && <div className="form-error">⚠ No se pudo generar el expediente.</div>}
          <div className="modal-actions"><button type="button" className="secondary" onClick={closePostComplete}>Cerrar</button><button type="button" className="primary" disabled={exportState === 'working'} onClick={downloadFullRecord}>{exportState === 'working' ? 'Generando…' : 'Descargar expediente'} <span>→</span></button></div>
        </div>
      : <div className="post-complete">
          <p>¿Quieres agendar la siguiente cita de {patientName}?</p>
          <div className="form-row"><label>Fecha<input type="date" value={followUp.date} onChange={(event) => setFollowUp((prev) => ({ ...prev, date: event.target.value }))} /></label><label>Hora<input type="time" value={followUp.time} onChange={(event) => setFollowUp((prev) => ({ ...prev, time: event.target.value }))} /></label></div>
          <div className="form-row"><label>Tipo de cita<select value={followUp.type} onChange={(event) => setFollowUp((prev) => ({ ...prev, type: event.target.value }))}>{FOLLOW_UP_TYPE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Duración<select value={followUp.duration} onChange={(event) => setFollowUp((prev) => ({ ...prev, duration: Number(event.target.value) }))}>{FOLLOW_UP_DURATIONS.map((duration) => <option value={duration} key={duration}>{duration} minutos</option>)}</select></label></div>
          {followUpError && <div className="form-error">⚠ {followUpError}</div>}
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setFollowUpState('skipped')}>Ahora no</button><button type="button" className="primary" disabled={followUpState === 'saving'} onClick={createFollowUpAppointment}>{followUpState === 'saving' ? 'Creando…' : 'Crear cita'} <span>→</span></button></div>
        </div>}
  </div></div>}
  </AppChrome>
}
