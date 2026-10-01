import { useEffect, useMemo, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import Anthropometry from '../../components/Anthropometry.jsx'
import ExamArt from '../../components/ExamArt.jsx'
import FormCard from '../../components/FormCard.jsx'
import Icon from '../../components/Icon.jsx'
import RecallBuilder from '../../components/RecallBuilder.jsx'
import SuggestionChips from '../../components/SuggestionChips.jsx'
import { usePatient } from '../../lib/usePatient.js'
import { appointmentsApi, clinicalApi, documentsApi, labAttachmentsApi, patientsApi, practiceApi } from '../../lib/api.js'
import { centsToPesos, normalizeFees, PAYMENT_METHODS, pesosToCents } from '../../lib/finance.js'
import { shouldAutoClose } from '../../lib/consultationSession.js'
import { mergeValues, splitUpdates } from '../../lib/patientFields.js'

const TABS = ['Resumen', 'Antropométrico', 'Bioquímico', 'Clínico', 'Dietético', 'Estilo de vida', 'Sociocultural', 'Diagnóstico', 'Tratamiento', 'Monitoreo', 'Notas', 'Transcripción']
// Los antecedentes familiares viven ahora en Clínico (ver flujo-consulta-nutricional.md), así que
// el payload histórico de la antigua sección "general" se fusiona en "clinical" al cargar.
const SECTION_KEYS = { Resumen: 'summary', Antropométrico: 'anthropometric', Bioquímico: 'biochemical', Clínico: 'clinical', Dietético: 'dietary', 'Estilo de vida': 'lifestyle', Sociocultural: 'sociocultural', Diagnóstico: 'diagnosis', Tratamiento: 'treatment', Monitoreo: 'monitoring', Notas: 'notes', Transcripción: 'transcription' }
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
// Sugerencias para "agregar padecimiento" en antecedentes familiares.
const SUGGESTED_DISEASES = ['Diabetes', 'Obesidad', 'Cardiopatías', 'Hipertensión arterial', 'Dislipidemias', 'Nefropatías', 'Cáncer', 'Enfermedad cerebrovascular', 'Hipotiroidismo', 'Hipertiroidismo', 'Asma', 'Alergias', 'Anemia', 'Artritis', 'Osteoporosis', 'Depresión', 'Ansiedad', 'Alzheimer', 'Celiaquía', 'Colitis', 'Gastritis', 'Cálculos renales', 'Trombosis', 'Epilepsia']

// Sugerencias de arranque para los campos con chips (SuggestionChips). Las que agregue la
// nutrióloga con "+ Rápido" se suman a éstas desde localStorage; ver el componente para el porqué.
const MOTIVO_CONSULTA_SUGGESTIONS = [
  { label: 'Pérdida de peso', text: 'Acude para perder peso.' },
  { label: 'Ganancia muscular', text: 'Busca ganar masa muscular.' },
  { label: 'Patología', text: 'Diagnóstico o seguimiento nutricional de una patología.' },
  { label: 'Prevención', text: 'Acude por prevención y hábitos saludables.' },
  { label: 'Deportivo', text: 'Busca mejorar su rendimiento deportivo.' },
  { label: 'Embarazo', text: 'Control nutricional del embarazo.' },
  { label: 'Suplementos', text: 'Solicita asesoría sobre suplementos.' },
]
const REFERENCIA_CITA_SUGGESTIONS = [
  { label: 'Recomendación', text: 'Recomendación de un paciente.' },
  { label: 'Médico', text: 'Referido por un médico.' },
  { label: 'Redes', text: 'Redes sociales.' },
  { label: 'Prensa', text: 'Prensa o medios.' },
]
const ANTECEDENTES_SUGGESTIONS = [
  { label: 'Diabetes', text: 'Diabetes mellitus tipo 2.' },
  { label: 'Prediabetes', text: 'Prediabetes.' },
  { label: 'Resistencia a la insulina', text: 'Resistencia a la insulina.' },
  { label: 'HTA', text: 'Hipertensión arterial.' },
  { label: 'Hipotiroidismo', text: 'Hipotiroidismo.' },
  { label: 'Hipertiroidismo', text: 'Hipertiroidismo.' },
  { label: 'Dislipidemia', text: 'Dislipidemia.' },
  { label: 'Gastritis', text: 'Gastritis.' },
  { label: 'Reflujo', text: 'Reflujo gastroesofágico.' },
  { label: 'Ninguno', text: 'Ninguno referido.' },
]
const CIRUGIAS_SUGGESTIONS = [
  { label: 'Apendicectomía', text: 'Apendicectomía.' },
  { label: 'Colecistectomía', text: 'Colecistectomía.' },
  { label: 'Cesárea', text: 'Cesárea.' },
  { label: 'Bariátrica', text: 'Cirugía bariátrica.' },
  { label: 'Ninguna', text: 'Ninguna.' },
]
const MEDICAMENTOS_SUGGESTIONS = [
  { label: 'Metformina', text: 'Metformina.' },
  { label: 'Levotiroxina', text: 'Levotiroxina.' },
  { label: 'Anticonceptivos', text: 'Anticonceptivos orales.' },
  { label: 'AINEs', text: 'Antiinflamatorios no esteroideos (AINEs).' },
  { label: 'Ninguno', text: 'Ninguno.' },
]
const SUPLEMENTOS_SUGGESTIONS = [
  { label: 'Multivitamínico', text: 'Multivitamínico.' },
  { label: 'Vitamina D', text: 'Vitamina D.' },
  { label: 'Hierro', text: 'Hierro.' },
  { label: 'Omega 3', text: 'Omega 3.' },
  { label: 'Ninguno', text: 'Ninguno.' },
]
const INTERACCIONES_SUGGESTIONS = [
  { label: 'Levotiroxina en ayuno', text: 'Levotiroxina: tomar en ayuno, separada de alimentos con calcio o hierro.' },
  { label: 'Metformina con alimento', text: 'Metformina: tomar con alimentos para reducir molestias gastrointestinales.' },
  { label: 'AINEs con alimento', text: 'AINEs: tomar con alimentos para proteger la mucosa gástrica.' },
]
const ALERGIAS_SUGGESTIONS = [
  { label: 'Lácteos', text: 'Lácteos.' },
  { label: 'Mariscos', text: 'Mariscos.' },
  { label: 'Frutos secos', text: 'Frutos secos.' },
  { label: 'Gluten', text: 'Gluten.' },
  { label: 'Ninguna', text: 'Ninguna.' },
]
const INTOLERANCIAS_SUGGESTIONS = [
  { label: 'Lactosa', text: 'Intolerancia a la lactosa.' },
  { label: 'Fructosa', text: 'Intolerancia a la fructosa.' },
  { label: 'Gluten', text: 'Sensibilidad al gluten no celíaca.' },
  { label: 'Ninguna', text: 'Ninguna.' },
]
// Evaluación cualitativa del diagnóstico alimentario (CESIVA) y frecuencia de consumo por alimento.
const CESIVA = [['Completa', 'Incluye todos los grupos de alimentos'], ['Equilibrada', 'Proporción adecuada entre grupos'], ['Suficiente', 'Cubre los requerimientos'], ['Inocua', 'Sin riesgo para la salud'], ['Variada', 'Alterna distintos alimentos'], ['Adecuada', 'Apta para el paciente']]
const FOOD_FREQUENCY = ['Leche', 'Queso', 'Yogur', 'Avena', 'Carne de res', 'Carne de pollo', 'Pescado', 'Huevo', 'Tortilla', 'Pan', 'Arroz', 'Frijol', 'Verduras', 'Frutas', 'Refresco', 'Jugo', 'Café', 'Dulces o postres', 'Frituras']
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
// Navegación, no un control de formulario: usa <div role="button"> en vez de <button> a propósito.
// Esta barra vive dentro del <fieldset disabled> que bloquea una consulta cerrada (ver `locked`), y
// un <fieldset disabled> apaga TODOS los elementos asociados a formulario que contiene — <button>
// incluido — así que con <button> no se podía ni cambiar de subsección para revisar una visita
// pasada. Un <div> no es un elemento de formulario: el fieldset no lo toca y la navegación entre
// subsecciones sigue funcionando en sólo lectura; sólo los campos de verdad quedan bloqueados.
function SubTabs({ tabs, value, onChange }) {
  return <div className="sub-tabs">{tabs.map(([key, label]) => <div role="button" tabIndex={0} key={key} className={'sub-tab' + (value === key ? ' active' : '')} onClick={() => onChange(key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(key) } }}>{label}</div>)}</div>
}

function Subsection({ groups, value, onChange }) {
  const active = groups.some((g) => g[0] === value) ? value : groups[0][0]
  return <><SubTabs tabs={groups.map((g) => [g[0], g[1]])} value={active} onChange={onChange} /><div className="sub-body">{groups.find((g) => g[0] === active)?.[2]}</div></>
}

// Interpretación de un estudio frente a su rango de referencia: admite "70-100", "<200" o ">40".
function interpretLab(value, range) {
  const v = Number(String(value ?? '').replace(',', '.'))
  if (!Number.isFinite(v) || v === 0 && String(value).trim() === '') return null
  const r = String(range || '').trim()
  let m = r.match(/^([<>])\s*(-?\d+(?:[.,]\d+)?)/)
  if (m) {
    const bound = Number(m[2].replace(',', '.'))
    return m[1] === '<' ? (v < bound ? 'Normal' : 'Elevado') : (v > bound ? 'Normal' : 'Bajo')
  }
  m = r.match(/(-?\d+(?:[.,]\d+)?)\s*(?:-|–|a )\s*(-?\d+(?:[.,]\d+)?)/i)
  if (m) {
    const min = Number(m[1].replace(',', '.'))
    const max = Number(m[2].replace(',', '.'))
    if (v < min) return 'Bajo'
    if (v > max) return 'Elevado'
    return 'Normal'
  }
  return null
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
    <p className="eyebrow">SECCIÓN {TABS.indexOf('Transcripción') + 1} DE 12</p>
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

export default function ClinicalRecordPage({ setActive, patientId, consultationId, onOpenSession, appointmentId, onConsumeAppointment, onScheduleAppointment }) {
  const { patient, reload: reloadPatient } = usePatient(patientId)
  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Cargando…'
  const patientInitials = patient ? `${patient.firstName[0] || ''}${patient.lastName[0] || ''}` : '··'

  const [tab, setTab] = useState('Antropométrico')
  const [sub, setSub] = useState('')
  const [newDisease, setNewDisease] = useState('')
  const [loadState, setLoadState] = useState('loading')
  const [consultation, setConsultation] = useState(null)
  const [historyCount, setHistoryCount] = useState(0)
  // Sesión que se cerró sola por ser de un día anterior: se avisa en pantalla para que quede claro
  // que lo que se escriba ahora ya no va a esa consulta.
  const [autoClosed, setAutoClosed] = useState(null)
  const [startState, setStartState] = useState('idle')
  const [sessionIndex, setSessionIndex] = useState(null)
  const [sessions, setSessions] = useState([])
  const [sections, setSections] = useState({})
  // Datos permanentes del paciente, en paralelo a las secciones de la consulta.
  const [patientSections, setPatientSections] = useState({})
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
  const [clinicalReport, setClinicalReport] = useState(null)
  const [clinicalReportState, setClinicalReportState] = useState('idle')
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
  const patientMirrorRef = useRef({})
  // Espejo de la consulta cargada. El efecto de carga depende de [patientId], así que su función de
  // limpieza se creó en el primer render, cuando `consultation` todavía era null: leer el estado
  // desde ahí daba siempre undefined y el guardado de salida no se disparaba nunca.
  const consultationRef = useRef(null)
  const patientIdRef = useRef(patientId)

  // Vacía a la fuerza lo que quede pendiente, sin esperar al debounce ni a que React vuelva a
  // renderizar. Se usa al salir del expediente y al cerrar la pestaña, donde no hay ocasión de
  // reintentar: es "dispara y olvida" con keepalive para que la petición sobreviva al desmontaje.
  const flushPendingNow = () => {
    const openConsultationId = consultationRef.current?.id
    const batch = pendingRef.current
    pendingRef.current = {}
    for (const [scoped, pending] of Object.entries(batch)) {
      const scope = scoped.slice(0, 1)
      const key = scoped.slice(2)
      if (scope === 'p') {
        if (patientIdRef.current) patientsApi.saveSection(patientIdRef.current, key, pending.payload, lastSavedAtRef.current[scoped], { keepalive: true }).catch(() => {})
      } else if (openConsultationId) {
        clinicalApi.saveSection(openConsultationId, key, pending.payload, lastSavedAtRef.current[scoped], { keepalive: true }).catch(() => {})
      }
    }
  }

  useEffect(() => { consultationRef.current = consultation }, [consultation])
  useEffect(() => { patientIdRef.current = patientId }, [patientId])

  // Cerrar la pestaña con algo a medio escribir también tiene que guardar.
  useEffect(() => {
    const onLeave = () => flushPendingNow()
    window.addEventListener('beforeunload', onLeave)
    window.addEventListener('pagehide', onLeave)
    return () => {
      window.removeEventListener('beforeunload', onLeave)
      window.removeEventListener('pagehide', onLeave)
    }
  }, [])

  // Vuelca una consulta recién traída del servidor al estado de la pantalla. Lo usan tanto la carga
  // inicial como "Iniciar consulta" y "Reabrir", para que las tres dejen la pantalla igual.
  const applyConsultation = (full) => {
    setConsultation(full)
    setAttachments(full.labAttachments || [])
    const bySectionKey = {}
    payloadMirrorRef.current = {}
    // Sólo se limpian las marcas de la consulta: las del paciente (`p:`) valen para todas sus
    // visitas y no deben perderse al cambiar de sesión.
    for (const scoped of Object.keys(lastSavedAtRef.current)) if (scoped.startsWith('c:')) delete lastSavedAtRef.current[scoped]
    for (const section of full.sections || []) {
      bySectionKey[section.sectionKey] = section
      payloadMirrorRef.current[section.sectionKey] = section.payload || {}
      lastSavedAtRef.current[`c:${section.sectionKey}`] = section.lastSavedAt
    }
    if (bySectionKey.general) {
      const clinical = bySectionKey.clinical || { sectionKey: 'clinical', payload: {} }
      clinical.payload = { ...bySectionKey.general.payload, ...(clinical.payload || {}) }
      bySectionKey.clinical = clinical
      payloadMirrorRef.current.clinical = clinical.payload
      delete bySectionKey.general
      delete payloadMirrorRef.current.general
    }
    setSections(bySectionKey)
    setDiagnoses(full.diagnoses || [])
  }

  useEffect(() => {
    if (!patientId) { setLoadState('ready'); return undefined }
    let cancelled = false
    async function load() {
      setLoadState('loading')
      try {
        // Las secciones del paciente se piden a la vez que su historial: son independientes de qué
        // consulta se acabe abriendo, así que no hay razón para encadenar las dos peticiones.
        const [list, patientPayload] = await Promise.all([
          patientsApi.consultations(patientId),
          patientsApi.sections(patientId).catch(() => ({ items: [] })),
        ])
        if (cancelled) return
        const byPatientKey = {}
        patientMirrorRef.current = {}
        for (const section of patientPayload.items || []) {
          byPatientKey[section.sectionKey] = section
          patientMirrorRef.current[section.sectionKey] = section.payload || {}
          lastSavedAtRef.current[`p:${section.sectionKey}`] = section.lastSavedAt
        }
        setPatientSections(byPatientKey)
        setHistoryCount((list.items || []).length)
        setSessions(list.items || [])
        // Real evolution data for the Antropométrico chart: every measurement across the
        // patient's consultations, oldest first.
        setMeasurements((list.items || []).flatMap((c) => c.measurements || []).sort((a, b) => new Date(a.measuredAt) - new Date(b.measuredAt)))
        let full
        if (consultationId) {
          // La sesión concreta que pide la dirección (`/expediente/<consulta>`), aunque esté
          // cerrada. Ya no hace falta "consumir" el id: al navegar a otro sitio la dirección lo
          // suelta sola, y mantenerlo es lo que permite recargar sin perder la sesión abierta.
          full = await clinicalApi.get(consultationId)
        } else {
          let active
          try {
            active = (list.items || []).find((item) => item.status === 'IN_PROGRESS')
            // Una sesión abierta de un día anterior se cierra sola, venga de donde venga la
            // entrada. Antes esta comprobación sólo corría al entrar desde una cita, así que al
            // abrir desde Pacientes o Consultas se reutilizaba la sesión vieja y las visitas de
            // semanas distintas se iban acumulando todas en la misma consulta.
            if (shouldAutoClose(active)) {
              await clinicalApi.complete(active.id, { autoClosed: true }).catch(() => {})
              if (!cancelled) setAutoClosed(active)
              active = null
            }
            if (appointmentId) {
              // Entrar desde una cita sí es un acto explícito de iniciar la consulta: si no hay
              // sesión de hoy se crea, y si ya la hay la segunda cita del día se suma a ella.
              if (active) await appointmentsApi.complete(appointmentId).catch(() => {})
              else active = await clinicalApi.create(patientId, { appointmentId })
            }
          } finally {
            // Consume the appointment id whether or not the calls above succeeded — a stuck id
            // would re-run complete/create side effects on the same appointment next open.
            if (appointmentId) onConsumeAppointment?.()
          }
          // Sin cita y sin sesión de hoy no se crea nada: abrir el expediente para consultar un
          // dato no puede inaugurar una consulta. Se muestra la última visita en sólo lectura y el
          // profesional decide si inicia una nueva.
          full = active ? await clinicalApi.get(active.id) : ((list.items || [])[0] ? await clinicalApi.get(list.items[0].id) : null)
        }
        if (cancelled) return
        if (!full) {
          setConsultation(null)
          setSections({})
          setDiagnoses([])
          setAttachments([])
          setLoadState('ready')
          return
        }
        applyConsultation(full)
        // Posición contando desde la primera visita: la lista viene de la más reciente a la más
        // antigua, así que "sesión 4 de 7" es el total menos el índice.
        const position = (list.items || []).findIndex((item) => item.id === full.id)
        setSessionIndex(position >= 0 ? (list.items || []).length - position : null)
        setLoadState('ready')
      } catch {
        if (!cancelled) setLoadState('error')
      }
    }
    load()
    return () => {
      cancelled = true
      clearTimeout(saveTimer.current)
      // El debounce cambia "guardar en cada tecla" por "guardar 800 ms después de dejar de
      // escribir", pero salir dentro de esa ventana no puede tirar lo escrito: se vacía a la
      // fuerza (las peticiones en vuelo terminan solas; el componente ya no está, así que un
      // fallo no tendría dónde mostrarse).
      flushPendingNow()
    }
  }, [patientId, consultationId])

  useEffect(() => {
    if (!consultation) return
    let cancelled = false
    documentsApi.list(`?patientId=${patientId}&type=consultation_report`)
      .then((response) => { if (!cancelled) { const existing = (response.items || []).find((doc) => doc.consultationId === consultation.id); if (existing) setReport(existing) } })
      .catch(() => {})
    documentsApi.list(`?patientId=${patientId}&type=consultation_export`)
      .then((response) => { if (!cancelled) { const existing = (response.items || []).find((doc) => doc.consultationId === consultation.id); if (existing) setExportDoc(existing) } })
      .catch(() => {})
    documentsApi.list(`?patientId=${patientId}&type=consultation_clinical`)
      .then((response) => { if (!cancelled) { const existing = (response.items || []).find((doc) => doc.consultationId === consultation.id); if (existing) setClinicalReport(existing) } })
      .catch(() => {})
    return () => { cancelled = true }
  }, [consultation, patientId])

  const sectionKey = SECTION_KEYS[tab]
  // Lo que se ve en la sección es lo de la consulta con los datos permanentes del paciente encima:
  // antecedentes familiares, cirugías y alergias son del paciente y se muestran en todas sus visitas.
  const currentValues = mergeValues(sectionKey, sections[sectionKey]?.payload, patientSections[sectionKey]?.payload)

  // Las secciones se guardan en dos sitios —la consulta y el paciente— con la misma maquinaria de
  // autoguardado. Para no duplicarla, la cola trabaja con claves con ámbito: `c:clinical` es la
  // sección de esta consulta y `p:clinical` los datos permanentes del paciente.
  const scopedKey = (scope, key) => `${scope}:${key}`
  const unscope = (scoped) => [scoped.slice(0, 1), scoped.slice(2)]

  const saveSection = async (scoped, payload) => {
    const [scope, key] = unscope(scoped)
    if (inFlightRef.current.has(scoped)) return
    if (scope === 'c' && !consultation) return
    if (scope === 'p' && !patientId) return
    inFlightRef.current.add(scoped)
    setSaveState('saving')
    try {
      const saved = scope === 'c'
        ? await clinicalApi.saveSection(consultation.id, key, payload, lastSavedAtRef.current[scoped])
        : await patientsApi.saveSection(patientId, key, payload, lastSavedAtRef.current[scoped])
      lastSavedAtRef.current[scoped] = saved.lastSavedAt
      if (scope === 'c') {
        payloadMirrorRef.current[key] = saved.payload || {}
        setSections((prev) => ({ ...prev, [key]: saved }))
      } else {
        patientMirrorRef.current[key] = saved.payload || {}
        setPatientSections((prev) => ({ ...prev, [key]: saved }))
      }
      setSaveState('saved')
    } catch (error) {
      if (error.code === 'CONCURRENT_EDIT') {
        setSaveState('conflict')
        // The optimistic token was stale (e.g. a prior save for this section resolved mid-typing).
        // Resync lastSavedAt from the server and re-queue the local version so it actually lands
        // instead of 409-ing forever.
        try {
          if (scope === 'c') {
            const fresh = await clinicalApi.get(consultation.id)
            for (const s of fresh.sections || []) {
              lastSavedAtRef.current[scopedKey('c', s.sectionKey)] = s.lastSavedAt
              payloadMirrorRef.current[s.sectionKey] = s.payload || {}
            }
          } else {
            const fresh = await patientsApi.sections(patientId)
            for (const s of fresh.items || []) {
              lastSavedAtRef.current[scopedKey('p', s.sectionKey)] = s.lastSavedAt
              patientMirrorRef.current[s.sectionKey] = s.payload || {}
            }
          }
          pendingRef.current[scoped] = { payload }
          scheduleFlush()
        } catch { /* leave the conflict banner visible */ }
      } else {
        setSaveState('error')
      }
    } finally {
      inFlightRef.current.delete(scoped)
      if (pendingRef.current[scoped]) scheduleFlush()
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
    for (const [scoped, pending] of Object.entries(batch)) {
      if (inFlightRef.current.has(scoped)) { pendingRef.current[scoped] = pending; continue }
      saveSection(scoped, pending.payload)
    }
  }

  // updateFields merges against the synchronous mirrors instead of the render-time currentValues
  // closure, so two edits landing in the same tick (e.g. two transcription chunks) accumulate
  // instead of the second silently overwriting the first. Cada cambio va al almacén que le toca.
  const updateFields = (updates) => {
    if (locked) return
    const { patient: patientUpdates, consultation: consultationUpdates } = splitUpdates(sectionKey, updates)
    if (Object.keys(consultationUpdates).length) {
      const base = payloadMirrorRef.current[sectionKey] || {}
      const nextValues = { ...base, ...consultationUpdates }
      payloadMirrorRef.current[sectionKey] = nextValues
      setSections((prev) => ({ ...prev, [sectionKey]: { ...prev[sectionKey], payload: nextValues } }))
      pendingRef.current[scopedKey('c', sectionKey)] = { payload: nextValues }
    }
    if (Object.keys(patientUpdates).length) {
      const base = patientMirrorRef.current[sectionKey] || {}
      const nextValues = { ...base, ...patientUpdates }
      patientMirrorRef.current[sectionKey] = nextValues
      setPatientSections((prev) => ({ ...prev, [sectionKey]: { ...prev[sectionKey], payload: nextValues } }))
      pendingRef.current[scopedKey('p', sectionKey)] = { payload: nextValues }
    }
    setSaveState('editing')
    scheduleFlush()
  }
  const updateField = (label, value) => updateFields({ [label]: value })

  // Una consulta existe porque alguien la inició, nunca porque alguien miró: mientras no haya
  // sesión de hoy el expediente se abre en sólo lectura y este botón es el único que la crea.
  const startConsultation = async () => {
    if (!patientId || startState === 'saving') return
    setStartState('saving')
    try {
      const created = await clinicalApi.create(patientId, {})
      const full = await clinicalApi.get(created.id)
      applyConsultation(full)
      setAutoClosed(null)
      // La recién creada es la última visita: pasa a ser la número historyCount + 1 de ese total.
      setHistoryCount(historyCount + 1)
      setSessionIndex(historyCount + 1)
      setSessions((prev) => [full, ...prev])
      // Si se estaba mirando una visita pasada, la dirección todavía apunta a ella: hay que
      // soltarla o al recargar volveríamos a la sesión vieja en vez de a la que acabamos de abrir.
      if (consultationId) onOpenSession?.(null)
      setStartState('idle')
    } catch {
      setStartState('error')
    }
  }

  // Corregir una consulta ya cerrada tiene que ser deliberado: se reabre a propósito, no por el
  // hecho de estar mirándola.
  const reopenConsultation = async () => {
    if (!consultation || startState === 'saving') return
    setStartState('saving')
    try {
      await clinicalApi.reopen(consultation.id)
      const full = await clinicalApi.get(consultation.id)
      applyConsultation(full)
      setStartState('idle')
    } catch {
      setStartState('error')
    }
  }

  // Lo que está cerrado (o el expediente sin sesión de hoy) no se edita: se mira. Así abrir el
  // expediente para consultar un dato no puede escribir por accidente en una visita pasada.
  const locked = !consultation || consultation.status === 'COMPLETED'

  // La cabecera decía sólo "Consulta nutricional · En curso", así que una sesión de hoy y una del
  // mes pasado se veían idénticas. Ahora dice de qué día es y qué número de visita ocupa.
  const sessionLabel = consultation
    ? [`Consulta del ${formatDate(consultation.startedAt || consultation.createdAt)}`,
       sessionIndex && historyCount ? `sesión ${sessionIndex} de ${historyCount}` : null,
       CONSULTATION_STATUS_LABELS[consultation.status] || consultation.status].filter(Boolean).join(' · ')
    : 'Sin consultas registradas'

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

  // En sólo lectura no hay nada que guardar: decir "Guardado" ahí daría a entender que lo que se
  // escriba se está persistiendo, que es justo lo que no pasa.
  const saveLabel = locked ? '▤ Sólo lectura' : SAVE_LABELS[saveState]
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
  // El estado se interpreta automáticamente del rango de referencia cuando es posible; si no,
  // se respeta el que se haya elegido a mano.
  const labStatus = (lab) => (lab.range ? interpretLab(lab.value, lab.range) : null) || lab.status
  const labsEvaluated = labs.map((lab) => ({ ...lab, status: labStatus(lab) }))
  const openLabForm = () => setLabForm({ name: '', value: '', unit: '', range: '', status: 'Normal' })
  const closeLabForm = () => setLabForm(null)
  const updateLabForm = (key, value) => setLabForm((prev) => ({ ...prev, [key]: value }))
  const saveLab = () => {
    if (!labForm?.name || !labForm?.value) return
    updateField('Estudios', [...labs, { ...labForm, status: interpretLab(labForm.value, labForm.range) || labForm.status, id: `${Date.now()}` }])
    setLabForm(null)
  }
  const removeLab = (id) => updateField('Estudios', labs.filter((lab) => lab.id !== id))
  const updateLabValue = (id, value) => updateField('Estudios', labs.map((lab) => (lab.id === id ? { ...lab, value, status: (lab.range ? interpretLab(value, lab.range) : null) || lab.status } : lab)))

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

  // Informe clínico profesional (derivación): tablas de laboratorio, recordatorio y secciones.
  const generateClinicalReport = async () => {
    if (!consultation) return
    setClinicalReportState('working')
    try {
      const doc = clinicalReport || await documentsApi.createForClinicalReport(consultation.id)
      const generated = await documentsApi.generate(doc.id)
      setClinicalReport(generated)
      setClinicalReportState('idle')
    } catch {
      setClinicalReportState('error')
    }
  }

  const downloadClinicalReport = async () => {
    if (!clinicalReport?.storageKey) return
    setClinicalReportState('working')
    try {
      const blob = await documentsApi.downloadBlob(clinicalReport.id)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = clinicalReport.storageKey
      link.click()
      URL.revokeObjectURL(url)
      setClinicalReportState('idle')
    } catch {
      setClinicalReportState('error')
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

  // Tres gráficas pequeñas para el Resumen (peso, % grasa, masa muscular): mismo cálculo que
  // chartPoints pero las tres a la vez y en un lienzo más chico, para verlas de un vistazo sin
  // tener que entrar a Antropométrico ni cambiar el selector de métrica.
  const summaryTrends = useMemo(() => {
    const series = [
      ['Peso', (m) => (m.weightKg != null ? Number(m.weightKg) : null), 'kg'],
      ['% grasa corporal', (m) => (m.bodyFatPercent != null ? Number(m.bodyFatPercent) : null), '%'],
      ['Masa muscular', (m) => (m.muscleMassKg != null ? Number(m.muscleMassKg) : null), 'kg'],
    ]
    return series.map(([label, extract, unit]) => {
      const pts = measurements.map((m) => ({ date: m.measuredAt, value: extract(m) })).filter((p) => p.value != null).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-8)
      if (pts.length < 2) return { label, unit, points: [], line: '' }
      const min = Math.min(...pts.map((p) => p.value))
      const max = Math.max(...pts.map((p) => p.value))
      const range = max - min || 1
      const plotted = pts.map((p, i) => ({ ...p, x: 6 + (i / (pts.length - 1)) * 168, y: 52 - ((p.value - min) / range) * 42, value: Math.round(p.value * 10) / 10 }))
      return { label, unit, points: plotted, line: plotted.map((p) => `${p.x},${p.y}`).join(' '), last: plotted[plotted.length - 1].value, first: plotted[0].value }
    })
  }, [measurements])

  // Antecedentes familiares: "Ninguno/No" por padecimiento y padecimientos agregados por el usuario.
  const customFamilyDiseases = Array.isArray(currentValues['Padecimientos familiares agregados']) ? currentValues['Padecimientos familiares agregados'] : []
  const familyDiseases = [...FAMILY_DISEASES, ...customFamilyDiseases]
  const setFamilyNone = (disease) => {
    const none = !currentValues[`${disease}__Ninguno`]
    const patch = { [`${disease}__Ninguno`]: none }
    RELATIVES.forEach((rel) => { patch[`${disease}__${rel}`] = false })
    updateFields(patch)
  }
  const toggleFamilyRelative = (disease, rel, active) => updateFields({ [`${disease}__${rel}`]: !active, [`${disease}__Ninguno`]: false })
  const addFamilyDisease = () => {
    const name = newDisease.trim()
    if (!name) return
    if (!FAMILY_DISEASES.includes(name) && !customFamilyDiseases.includes(name)) updateField('Padecimientos familiares agregados', [...customFamilyDiseases, name])
    setNewDisease('')
  }
  const removeFamilyDisease = (name) => {
    updateField('Padecimientos familiares agregados', customFamilyDiseases.filter((disease) => disease !== name))
    const patch = { [`${name}__Ninguno`]: '' }
    RELATIVES.forEach((rel) => { patch[`${name}__${rel}`] = '' })
    updateFields(patch)
  }

  // Hallazgos de exploración seleccionados, para mostrar su imagen de referencia.
  const examSelected = PHYSICAL_EXAM.flatMap(([, findings]) => findings).filter((finding) => !!currentValues[`Exploración: ${finding}`])

  if (!patientId) return <AppChrome active="Pacientes" crumb="Expediente" setActive={setActive}><div className="content clinical-content">
    <div className="result-empty panel"><span>◌</span><h3>Elige un paciente</h3><p>Abre el expediente desde la lista de pacientes para registrar una consulta.</p><button className="primary" onClick={() => setActive('Pacientes')}>Ir a Pacientes</button></div>
  </div></AppChrome>

  return <AppChrome active="Pacientes" crumb="Expediente" setActive={setActive}><div className="content clinical-content">
    <div className="patient-context">
      <button className="back-button" onClick={() => setActive('Pacientes')}>← Pacientes</button>
      <div className="clinical-person"><span className="person-avatar coral">{patientInitials}</span><div><div className="clinical-person-head"><h2>{patientName}</h2><button type="button" className="record-button" title="Grabar consulta" aria-label="Grabar consulta" onClick={() => setTab('Transcripción')}><Icon>record</Icon></button></div><span>{sessionLabel}</span></div></div>
      {/* Moverse entre visitas sin salir a Consultas: cada una tiene su propia dirección, así que
          elegir aquí es lo mismo que abrirla por enlace, y se puede recargar o compartir. */}
      {sessions.length > 1 && <label className="session-picker">Sesión
        <select value={consultation?.id || ''} onChange={(event) => onOpenSession?.(event.target.value)}>
          {sessions.map((item, index) => <option value={item.id} key={item.id}>
            {`${sessions.length - index}. ${formatDate(item.startedAt || item.createdAt)} · ${CONSULTATION_STATUS_LABELS[item.status] || item.status}`}
          </option>)}
        </select>
      </label>}
      <div className="clinical-actions">{consultation && consultation.status !== 'COMPLETED' && <button className="secondary" disabled={completionState === 'saving'} onClick={openCompletion}>{completionState === 'saving' ? 'Cerrando…' : 'Terminar consulta'}</button>}<button className="secondary" onClick={() => onScheduleAppointment?.()}>▱ Agendar</button>{exportDoc?.storageKey && <button className="secondary" disabled={exportState === 'working'} onClick={downloadExport}>{exportState === 'working' ? '…' : 'Descargar expediente'}</button>}<button className="secondary" disabled={exportState === 'working'} onClick={generateExport}>{exportState === 'working' ? 'Generando…' : exportDoc?.storageKey ? 'Actualizar expediente' : 'Expediente completo'}</button>{report?.storageKey && <button className="secondary" disabled={reportState === 'working'} onClick={downloadReport}>{reportState === 'working' ? '…' : 'Descargar informe'}</button>}{clinicalReport?.storageKey && <button className="secondary" disabled={clinicalReportState === 'working'} onClick={downloadClinicalReport}>{clinicalReportState === 'working' ? '…' : 'Descargar informe clínico'}</button>}<button className="secondary" disabled={clinicalReportState === 'working'} onClick={generateClinicalReport}>{clinicalReportState === 'working' ? 'Generando…' : clinicalReport?.storageKey ? 'Actualizar informe clínico' : 'Informe clínico'}</button><button className="primary" disabled={reportState === 'working'} onClick={generateReport}>{reportState === 'working' ? 'Generando…' : report?.storageKey ? 'Actualizar informe' : 'Generar informe'}</button></div>
    </div>
    {/* El aviso lleva su propia acción: explicar la situación y ofrecer la salida en el mismo sitio
        evita que "Iniciar consulta" se pierda entre los ocho botones de informes de la cabecera. */}
    {locked && loadState === 'ready' && <div className="record-notice">
      <p>{!consultation
        ? <>▤ {patientName} todavía no tiene consultas registradas.</>
        : autoClosed
          ? <>◷ La consulta del {formatDate(autoClosed.startedAt || autoClosed.createdAt)} había quedado abierta de un día anterior y se cerró sola. Se muestra en <b>sólo lectura</b>: lo que escribas aquí no se guardaría en la visita de hoy.</>
          : <>▤ Estás viendo la consulta del {formatDate(consultation.startedAt || consultation.createdAt)} en <b>sólo lectura</b>.</>}</p>
      <div className="record-notice-actions">
        <button type="button" className="primary" disabled={startState === 'saving'} onClick={startConsultation}>{startState === 'saving' ? 'Iniciando…' : '+ Iniciar consulta de hoy'}</button>
        {consultation?.status === 'COMPLETED' && <button type="button" className="secondary" disabled={startState === 'saving'} onClick={reopenConsultation}>Reabrir para corregir</button>}
      </div>
    </div>}
    {startState === 'error' && <div className="form-error">⚠ No se pudo iniciar o reabrir la consulta. Revisa si el paciente ya tiene una en curso.</div>}
    {reportState === 'error' && <div className="form-error">⚠ No se pudo generar o descargar el informe.</div>}
    {exportState === 'error' && <div className="form-error">⚠ No se pudo generar o descargar el expediente completo.</div>}
    {measurementState === 'error' && <div className="form-error">⚠ No se pudo registrar la medición.</div>}
    <div className="record-tabs">{TABS.map((x) => <button className={tab === x ? 'active' : ''} onClick={() => { setTab(x); setSub('') }} key={x}>{x}</button>)}</div>

    {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando expediente…</h3></div>}
    {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar ni crear la consulta de {patientName}.</div>}

    {/* Un `fieldset` deshabilitado apaga de golpe todos los controles que contiene: es la forma
        de que una consulta cerrada se pueda leer y no escribir sin tener que ir campo por campo
        (y sin que un campo nuevo se escape del bloqueo por olvido). */}
    {loadState === 'ready' && <fieldset className="record-lock" disabled={locked}>
      {tab === 'Antropométrico' ? <div className="anthro-tab-wrap">
        <Anthropometry values={currentValues} onFieldChange={updateAnthropometric} registerMeasurement={registerMeasurement} measurementState={measurementState} todayMeasured={todayMeasured} patientSex={patient?.sex} patientAge={computeAge(patient?.birthDate)} />
        {chartPoints.length >= 2 && <div className="panel progress-chart">
          <div className="chart-title"><b>Evolución de métricas</b><select value={chartMetric} onChange={(e) => setChartMetric(e.target.value)}><option>Peso</option><option>IMC</option><option>% grasa corporal</option></select></div>
          <div className="chart-lines"><svg viewBox="0 0 600 130" preserveAspectRatio="none"><polyline points={chartPointLine} fill="none" stroke="var(--green)" strokeWidth="3" />{chartPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="5" fill="var(--green)" />)}</svg><div className="chart-labels">{chartPoints.map((p, i) => <span key={i}><b>{p.value}</b><br />{`${new Date(p.date).getUTCDate()}/${String(new Date(p.date).getUTCMonth() + 1).padStart(2, '0')}`}</span>)}</div></div>
        </div>}
      </div>

      : tab === 'Bioquímico' ? <div className="clinical-layout">
        <section className="record-main panel">
          <div className="section-heading"><div><p className="eyebrow">SECCIÓN 3 DE 12</p><h1>Bioquímico</h1><p className="subtitle">Los estudios son opcionales en la primera consulta: se sugieren y suelen traerse en la segunda. Registra los valores que traiga el paciente.</p></div><button className="primary" onClick={() => { setSub('estudios'); openLabForm() }}>+ Agregar estudio</button></div>
          <Subsection value={sub} onChange={setSub} groups={[
            ['estudios', 'Solicitud y estudios', <div className="sub-stack" key="est">
              <FormCard title="Solicitud de estudios" fields={['Estudios solicitados|*', 'Notas de bioquímico|*']} values={currentValues} onFieldChange={updateField} />
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
                {interpretLab(labForm.value, labForm.range) && <p className="lab-hint">Interpretación automática según el rango: <b>{interpretLab(labForm.value, labForm.range)}</b>. Puedes cambiarla en “Estado”.</p>}
                <div className="modal-actions"><button type="button" className="secondary" onClick={closeLabForm}>Cancelar</button><button className="primary" disabled={!labForm.name || !labForm.value} onClick={saveLab}>Guardar estudio</button></div>
              </div>}
              {labsEvaluated.length > 0 && <div className="lab-list">{labsEvaluated.map((lab) => { const color = lab.status === 'Normal' ? 'confirmed' : 'pending'; return <div className="lab-row" key={lab.id}><div><b>{lab.name}</b><small>{lab.unit}{lab.range ? ` · ref. ${lab.range}` : ''}</small></div><input value={lab.value} onChange={(e) => updateLabValue(lab.id, e.target.value)} /><span className={'status ' + color}>{lab.status}</span><button type="button" className="link-button" onClick={() => removeLab(lab.id)}>Quitar</button></div> })}</div>}
            </div>],
            ['adjuntos', 'Adjuntos PDF', <div className="sub-stack" key="adj">
              <div className="section-heading"><div><p className="eyebrow">PDF DE ANÁLISIS CLÍNICOS</p><h2>Adjuntos del paciente</h2><p className="subtitle">Sube el PDF que trae {patientName} y captura sus valores arriba a mano; todavía no hay lectura automática.</p></div><label className="secondary" style={{ cursor: uploadState === 'uploading' ? 'default' : 'pointer' }}>{uploadState === 'uploading' ? 'Subiendo…' : '+ Subir PDF'}<input type="file" accept="application/pdf" style={{ display: 'none' }} disabled={uploadState === 'uploading'} onChange={(e) => { uploadLabAttachment(e.target.files[0]); e.target.value = '' }} /></label></div>
              {uploadState === 'error' && <div className="form-error">⚠ {uploadError}</div>}
              {!attachments.length && <div className="lab-empty"><span>▤</span><b>Sin PDF adjuntos</b><small>Sube el estudio en PDF que te compartió el paciente.</small></div>}
              {attachments.length > 0 && <div className="lab-list">{attachments.map((attachment) => <div className="lab-row attachment-row" key={attachment.id}><div><b>{attachment.fileName}</b><small>{(attachment.fileSize / 1024).toFixed(0)} KB · subido por {attachment.uploadedBy?.name || '—'}</small></div><button type="button" className="link-button" onClick={() => downloadLabAttachment(attachment)}>Ver</button><button type="button" className="link-button" onClick={() => removeLabAttachment(attachment.id)}>Quitar</button></div>)}</div>}
            </div>],
          ]} />
        </section>
        <aside className="record-aside panel"><p className="eyebrow">LECTURA RÁPIDA</p><div className="lab-score">{labsEvaluated.filter((l) => l.status === 'Normal').length}<span>/{labsEvaluated.length}</span></div><b>Resultados normales</b>{labsEvaluated.some((l) => l.status === 'Elevado' || l.status === 'Bajo') ? <p className="muted">Hay hallazgos fuera de rango que requieren seguimiento en el tratamiento.</p> : <p className="muted">{labsEvaluated.length ? 'Todos los estudios registrados están en rango normal.' : 'Todavía no hay estudios registrados.'}</p>}<div className="tag-row">{labsEvaluated.filter((l) => l.status === 'Elevado' || l.status === 'Bajo').map((l) => <span key={l.id}>{l.name} {l.status.toLowerCase()}</span>)}</div></aside>
      </div>

      : tab === 'Diagnóstico' ? <div className="panel diagnosis-panel">
        <div className="section-heading"><div><p className="eyebrow">SECCIÓN 8 DE 12 · TND</p><h1>Diagnóstico nutricio</h1><p className="subtitle">Evalúa la alimentación (CESIVA), define el tipo de dieta y registra los diagnósticos PES por dominio.</p></div><button className="secondary" onClick={() => { setSub('registrados'); openDiagnosisForm(DIAGNOSIS_DOMAINS[0][0]) }}>+ Nuevo diagnóstico</button></div>
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

      : tab === 'Clínico' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 12</p><h1>Clínico</h1><p className="subtitle">Antecedentes familiares y personales, medicamentos, síntomas y exploración física de {patientName}.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['familiares', 'Familiares', <div key="fam">
            <div className="heredo-table">
              <div className="heredo-head"><span>Enfermedad</span>{RELATIVES.map((rel) => <b key={rel}>{rel}</b>)}<b>Ninguno</b></div>
              {familyDiseases.map((disease) => {
                const none = !!currentValues[`${disease}__Ninguno`]
                return <div className="heredo-row" key={disease}>
                  <span>{disease}{customFamilyDiseases.includes(disease) && <button type="button" className="heredo-remove" title="Quitar padecimiento" onClick={() => removeFamilyDisease(disease)}>×</button>}</span>
                  {RELATIVES.map((rel) => { const active = !!currentValues[`${disease}__${rel}`]; return <TogglePill key={rel} active={active} label={active ? '✓' : ''} onClick={() => toggleFamilyRelative(disease, rel, active)} /> })}
                  <TogglePill active={none} label="No" onClick={() => setFamilyNone(disease)} />
                </div>
              })}
            </div>
            <div className="heredo-add">
              <input list="family-disease-suggestions" value={newDisease} onChange={(event) => setNewDisease(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addFamilyDisease() } }} placeholder="Agregar padecimiento…" />
              <datalist id="family-disease-suggestions">{SUGGESTED_DISEASES.map((disease) => <option key={disease} value={disease} />)}</datalist>
              <button type="button" className="secondary" disabled={!newDisease.trim()} onClick={addFamilyDisease}>+ Agregar</button>
            </div>
          </div>],
          ['antecedentes', 'Antecedentes', <div key="a" className="sub-stack">
            <div className="form-card">
              <h3>Antecedentes personales</h3>
              <div className="form-grid">
                <label>Enfermedades actuales o previas<textarea value={currentValues['Enfermedades actuales o previas'] ?? ''} onChange={(e) => updateField('Enfermedades actuales o previas', e.target.value)} /></label>
              </div>
              <SuggestionChips storageKey="chips:antecedentes-personales" seed={ANTECEDENTES_SUGGESTIONS} value={currentValues['Enfermedades actuales o previas']} onPick={(next) => updateField('Enfermedades actuales o previas', next)} />
              <div className="form-grid">
                <label>Cirugías realizadas<textarea value={currentValues['Cirugías realizadas'] ?? ''} onChange={(e) => updateField('Cirugías realizadas', e.target.value)} /></label>
              </div>
              <SuggestionChips storageKey="chips:cirugias" seed={CIRUGIAS_SUGGESTIONS} value={currentValues['Cirugías realizadas']} onPick={(next) => updateField('Cirugías realizadas', next)} />
            </div>
            <div className="form-card">
              <h3>Antecedentes ginecobstétricos</h3>
              <p className="eyebrow">CICLO Y MENSTRUACIÓN</p>
              <div className="form-grid three">
                <label>Menarca (edad)<input value={currentValues['Menarca'] ?? ''} onChange={(e) => updateField('Menarca', e.target.value)} placeholder="Años" /></label>
                <label>Última menstruación<input type="date" value={currentValues['Última menstruación'] ?? ''} onChange={(e) => updateField('Última menstruación', e.target.value)} /></label>
                <label>Duración del ciclo<input value={currentValues['Duración del ciclo'] ?? ''} onChange={(e) => updateField('Duración del ciclo', e.target.value)} placeholder="Días" /></label>
                <label>Eumenorrea<input value={currentValues['Eumenorrea'] ?? ''} onChange={(e) => updateField('Eumenorrea', e.target.value)} /></label>
                <label>Dismenorrea<input value={currentValues['Dismenorrea'] ?? ''} onChange={(e) => updateField('Dismenorrea', e.target.value)} /></label>
                <label>Anticonceptivos orales/hormonales<input value={currentValues['Anticonceptivos orales u hormonales'] ?? ''} onChange={(e) => updateField('Anticonceptivos orales u hormonales', e.target.value)} /></label>
              </div>
              <p className="eyebrow">HISTORIA OBSTÉTRICA</p>
              <div className="form-grid three">
                <label>Gestaciones<input value={currentValues['Gestaciones'] ?? ''} onChange={(e) => updateField('Gestaciones', e.target.value)} /></label>
                <label>Partos<input value={currentValues['Partos'] ?? ''} onChange={(e) => updateField('Partos', e.target.value)} /></label>
                <label>Abortos<input value={currentValues['Abortos'] ?? ''} onChange={(e) => updateField('Abortos', e.target.value)} /></label>
                <label>Cesáreas<input value={currentValues['Cesáreas'] ?? ''} onChange={(e) => updateField('Cesáreas', e.target.value)} /></label>
                <label>¿Está embarazada?<div className="toggle-pair"><TogglePill active={currentValues['Está embarazada'] === 'Sí'} label="Sí" onClick={() => updateField('Está embarazada', currentValues['Está embarazada'] === 'Sí' ? '' : 'Sí')} /><TogglePill active={currentValues['Está embarazada'] === 'No'} label="No" onClick={() => updateField('Está embarazada', currentValues['Está embarazada'] === 'No' ? '' : 'No')} /></div></label>
                <label>Semanas de gestación<input value={currentValues['Semanas de gestación'] ?? ''} onChange={(e) => updateField('Semanas de gestación', e.target.value)} /></label>
              </div>
              <p className="eyebrow">CLIMATERIO Y TERAPIA HORMONAL</p>
              <div className="form-grid three">
                <label>¿Climaterio o menopausia?<div className="toggle-pair"><TogglePill active={currentValues['Climaterio o menopausia'] === 'Sí'} label="Sí" onClick={() => updateField('Climaterio o menopausia', currentValues['Climaterio o menopausia'] === 'Sí' ? '' : 'Sí')} /><TogglePill active={currentValues['Climaterio o menopausia'] === 'No'} label="No" onClick={() => updateField('Climaterio o menopausia', currentValues['Climaterio o menopausia'] === 'No' ? '' : 'No')} /></div></label>
                <label>Fecha de inicio<input type="date" value={currentValues['Climaterio: fecha de inicio'] ?? ''} onChange={(e) => updateField('Climaterio: fecha de inicio', e.target.value)} /></label>
                <label>¿Terapia de reemplazo hormonal?<div className="toggle-pair"><TogglePill active={currentValues['Terapia de reemplazo hormonal'] === 'Sí'} label="Sí" onClick={() => updateField('Terapia de reemplazo hormonal', currentValues['Terapia de reemplazo hormonal'] === 'Sí' ? '' : 'Sí')} /><TogglePill active={currentValues['Terapia de reemplazo hormonal'] === 'No'} label="No" onClick={() => updateField('Terapia de reemplazo hormonal', currentValues['Terapia de reemplazo hormonal'] === 'No' ? '' : 'No')} /></div></label>
                <label>Cuál<input value={currentValues['TRH: cuál'] ?? ''} onChange={(e) => updateField('TRH: cuál', e.target.value)} /></label>
                <label>Dosis<input value={currentValues['TRH: dosis'] ?? ''} onChange={(e) => updateField('TRH: dosis', e.target.value)} /></label>
              </div>
              <div className="form-grid">
                <label>Observaciones ginecobstétricas<textarea value={currentValues['Observaciones ginecobstétricas'] ?? ''} onChange={(e) => updateField('Observaciones ginecobstétricas', e.target.value)} /></label>
              </div>
            </div>
          </div>],
          ['medicamentos', 'Medicamentos', <div key="m" className="form-card">
            <h3>Medicamentos y suplementos</h3>
            <div className="form-grid">
              <label>Medicamentos que toma<textarea value={currentValues['Medicamentos que toma'] ?? ''} onChange={(e) => updateField('Medicamentos que toma', e.target.value)} /></label>
            </div>
            <SuggestionChips storageKey="chips:medicamentos" seed={MEDICAMENTOS_SUGGESTIONS} value={currentValues['Medicamentos que toma']} onPick={(next) => updateField('Medicamentos que toma', next)} />
            <div className="form-grid">
              <label>Suplementos que toma<textarea value={currentValues['Suplementos que toma'] ?? ''} onChange={(e) => updateField('Suplementos que toma', e.target.value)} /></label>
            </div>
            <SuggestionChips storageKey="chips:suplementos" seed={SUPLEMENTOS_SUGGESTIONS} value={currentValues['Suplementos que toma']} onPick={(next) => updateField('Suplementos que toma', next)} />
            <div className="form-grid">
              <label>Interacciones con nutrientes<textarea value={currentValues['Interacciones con nutrientes'] ?? ''} onChange={(e) => updateField('Interacciones con nutrientes', e.target.value)} /></label>
            </div>
            <SuggestionChips storageKey="chips:interacciones" seed={INTERACCIONES_SUGGESTIONS} value={currentValues['Interacciones con nutrientes']} onPick={(next) => updateField('Interacciones con nutrientes', next)} joiner=" " />
          </div>],
          ['alergias', 'Alergias y sustancias', <div key="al" className="sub-stack">
            <div className="form-card">
              <h3>Alergias e intolerancias</h3>
              <div className="form-grid">
                <label>Alergias alimentarias<textarea value={currentValues['Alergias alimentarias'] ?? ''} onChange={(e) => updateField('Alergias alimentarias', e.target.value)} /></label>
              </div>
              <SuggestionChips storageKey="chips:alergias" seed={ALERGIAS_SUGGESTIONS} value={currentValues['Alergias alimentarias']} onPick={(next) => updateField('Alergias alimentarias', next)} />
              <div className="form-grid">
                <label>Intolerancias<textarea value={currentValues['Intolerancias'] ?? ''} onChange={(e) => updateField('Intolerancias', e.target.value)} /></label>
              </div>
              <SuggestionChips storageKey="chips:intolerancias" seed={INTOLERANCIAS_SUGGESTIONS} value={currentValues['Intolerancias']} onPick={(next) => updateField('Intolerancias', next)} />
            </div>
            <FormCard title="Consumo de sustancias" fields={['Tabaquismo (frecuencia)|', 'Consumo de alcohol (frecuencia)|']} values={currentValues} onFieldChange={updateField} />
          </div>],
          ['sintomas', 'Síntomas', <div key="s" className="symptom-grid">{SYMPTOMS.map((symptom) => { const active = !!currentValues[symptom]; return <TogglePill key={symptom} active={active} label={symptom} onClick={() => updateField(symptom, !active)} /> })}</div>],
          ['exploracion', 'Exploración física', <div key="e">{PHYSICAL_EXAM.map(([group, findings]) => <div key={group} className="exam-group">
            <b className="exam-group-title">{group}</b>
            <div className="symptom-grid">{findings.map((finding) => { const key = `Exploración: ${finding}`; const active = !!currentValues[key]; return <TogglePill key={finding} active={active} label={finding} onClick={() => updateField(key, !active)} /> })}</div>
          </div>)}
            {examSelected.length > 0
              ? <div className="exam-reference"><p className="eyebrow">REFERENCIA VISUAL DE LOS HALLAZGOS</p><div className="exam-ref-grid">{examSelected.map((finding) => <figure className="exam-ref" key={finding}><ExamArt finding={finding} /><figcaption>{finding}</figcaption></figure>)}</div></div>
              : <p className="anthro-hint">Selecciona un hallazgo y aquí aparecerá una imagen de referencia.</p>}
          </div>],
          ['monitoreo-clinico', 'Monitoreo Clínico', <div key="mc" className="sub-stack">
            {/* Campos de una sola línea escritos a mano en vez de con FormCard: su convención
                convierte en textarea automáticamente al último campo de la lista cuando no lleva
                "|*", y aquí los cuatro (lpm, rpm, %, °C) deben quedar como número de una línea. */}
            <div className="form-card"><h3>Signos vitales</h3><div className="form-grid">
              <label>Frecuencia cardiaca (lpm)<input value={currentValues['Frecuencia cardiaca (lpm)'] ?? ''} onChange={(e) => updateField('Frecuencia cardiaca (lpm)', e.target.value)} /></label>
              <label>Frecuencia respiratoria (rpm)<input value={currentValues['Frecuencia respiratoria (rpm)'] ?? ''} onChange={(e) => updateField('Frecuencia respiratoria (rpm)', e.target.value)} /></label>
              <label>Oxigenación (%)<input value={currentValues['Oxigenación (%)'] ?? ''} onChange={(e) => updateField('Oxigenación (%)', e.target.value)} /></label>
              <label>Temperatura (°C)<input value={currentValues['Temperatura (°C)'] ?? ''} onChange={(e) => updateField('Temperatura (°C)', e.target.value)} /></label>
            </div></div>
            <FormCard title="Pruebas capilares" fields={['Pruebas capilares (glucosa, hemoglobina…)|*']} values={currentValues} onFieldChange={updateField} />
            <div className="form-card"><h3>Fuerza / función</h3><div className="form-grid">
              <label>Dinamometría (kg)<input value={currentValues['Dinamometría (kg)'] ?? ''} onChange={(e) => updateField('Dinamometría (kg)', e.target.value)} /></label>
              <label>Velocidad de la marcha (m/s)<input value={currentValues['Velocidad de la marcha (m/s)'] ?? ''} onChange={(e) => updateField('Velocidad de la marcha (m/s)', e.target.value)} /></label>
              <label>Time Up and Go (s)<input value={currentValues['Time Up and Go (s)'] ?? ''} onChange={(e) => updateField('Time Up and Go (s)', e.target.value)} /></label>
              <label>Sentarse y pararse 30 s (repeticiones)<input value={currentValues['Sentarse y pararse 30 s (repeticiones)'] ?? ''} onChange={(e) => updateField('Sentarse y pararse 30 s (repeticiones)', e.target.value)} /></label>
            </div></div>
          </div>],
          ['notas', 'Notas', <div key="n" className="sub-stack"><FormCard title="Notas clínicas" fields={['Notas clínicas|']} values={currentValues} onFieldChange={updateField} /><FormCard title="Notas de antecedentes" fields={['Notas de antecedentes|']} values={currentValues} onFieldChange={updateField} /></div>],
        ]} />
      </div>

      : tab === 'Monitoreo' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 12</p><h1>Monitoreo</h1><p className="subtitle">Seguimiento entre consultas de {patientName}: apego, síntomas y ajustes al plan.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['apego', 'Apego a macros', <FormCard key="ap" title="Apego a macros reportado" fields={['% Carbohidratos consumidos|', '% Proteína consumida|', '% Lípidos consumidos|']} values={currentValues} onFieldChange={updateField} />],
          ['subjetivo', 'Seguimiento', <FormCard key="sb" title="Seguimiento subjetivo" fields={['Estado de ánimo|', 'Apego al plan|', 'Antojos|', 'Hambre|', 'Consumo de agua|', 'Ejercicio|']} values={currentValues} onFieldChange={updateField} />],
          ['sintomas', 'Síntomas', <FormCard key="sn" title="Síntomas" fields={['Diarrea o estreñimiento|', 'Inflamación|', 'Cefalea|']} values={currentValues} onFieldChange={updateField} />],
          ['evaluacion', 'Evaluación', <FormCard key="ev" title="Evaluación de la consulta" fields={['Calidad de preparación de comidas|', 'Modificaciones al plan|', 'Tema para la próxima consulta|', 'Observaciones|']} values={currentValues} onFieldChange={updateField} />],
        ]} />
      </div>

      : tab === 'Transcripción' ? <TranscriptionTab values={currentValues} updateField={updateField} updateFields={updateFields} appendField={appendField} patientName={patientName} />

      : tab === 'Dietético' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 12</p><h1>Dietético</h1><p className="subtitle">Hábitos alimentarios de {patientName}.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['patron', 'Patrón de alimentación', <div key="pt" className="sub-stack">
            <FormCard title="Patrón de alimentación" fields={['Núm. de comidas al día|', 'Horario habitual de comidas|', 'Apetito|', 'Hora a la que tiene más hambre|', 'Comidas o bebidas preferidas|', 'Alimentos que no le agradan o le causan malestar|', 'Restricciones dietéticas|', 'Notas dietéticas|*']} values={currentValues} onFieldChange={updateField} />
            {/* El consumo de agua dejó de ser su propia subpestaña: va aquí, junto con el resto de
                lo que se bebe en el día, porque es parte del mismo patrón y no un tema aparte. */}
            <div className="form-card"><h3>Hidratación y bebidas</h3><div className="form-grid">
              <label>Vasos o litros de agua al día<input value={currentValues['Vasos de agua al día'] ?? ''} onChange={(e) => updateField('Vasos de agua al día', e.target.value)} /></label>
              <label>Refrescos, jugos o bebidas azucaradas (frecuencia y tipo)<input value={currentValues['Refrescos, jugos o bebidas azucaradas'] ?? ''} onChange={(e) => updateField('Refrescos, jugos o bebidas azucaradas', e.target.value)} /></label>
              <label>Bebidas energéticas<input value={currentValues['Consumo de bebidas energéticas'] ?? ''} onChange={(e) => updateField('Consumo de bebidas energéticas', e.target.value)} /></label>
              <label>Café o té (tazas/día y endulzante)<input value={currentValues['Café o té (tazas/día y endulzante)'] ?? ''} onChange={(e) => updateField('Café o té (tazas/día y endulzante)', e.target.value)} /></label>
            </div></div>
          </div>],
          ['historial', 'Historial', <div key="hi" className="sub-stack">
            <FormCard title="Historial de consultas nutricionales" fields={['¿Ha asistido antes a consulta nutricional?|', 'Tipo de consulta previa|', 'Tiempo que llevó la dieta|', 'Motivo por el que la llevó|', 'Resultados obtenidos|', 'Qué tanto se apegó a la dieta|*']} values={currentValues} onFieldChange={updateField} />
            <div className="form-card"><div className="form-grid">
              <label>¿Ha utilizado medicamentos para bajar de peso?<div className="toggle-pair"><TogglePill active={currentValues['Medicamentos para bajar de peso'] === 'Sí'} label="Sí" onClick={() => updateField('Medicamentos para bajar de peso', currentValues['Medicamentos para bajar de peso'] === 'Sí' ? '' : 'Sí')} /><TogglePill active={currentValues['Medicamentos para bajar de peso'] === 'No'} label="No" onClick={() => updateField('Medicamentos para bajar de peso', currentValues['Medicamentos para bajar de peso'] === 'No' ? '' : 'No')} /></div></label>
              <label>¿Cuáles?<input value={currentValues['Medicamentos para bajar de peso: cuáles'] ?? ''} onChange={(e) => updateField('Medicamentos para bajar de peso: cuáles', e.target.value)} /></label>
            </div></div>
            <div className="form-card"><h3>Historia dietética</h3><div className="form-grid">
              <label>¿Sabe cocinar?<div className="toggle-pair"><TogglePill active={currentValues['Sabe cocinar'] === 'Sí'} label="Sí" onClick={() => updateField('Sabe cocinar', currentValues['Sabe cocinar'] === 'Sí' ? '' : 'Sí')} /><TogglePill active={currentValues['Sabe cocinar'] === 'No'} label="No" onClick={() => updateField('Sabe cocinar', currentValues['Sabe cocinar'] === 'No' ? '' : 'No')} /></div></label>
              <label>¿Quién prepara sus alimentos?<input value={currentValues['Quién prepara sus alimentos'] ?? ''} onChange={(e) => updateField('Quién prepara sus alimentos', e.target.value)} /></label>
              <label>¿Come entre comidas?<div className="toggle-pair"><TogglePill active={currentValues['Come entre comidas'] === 'Sí'} label="Sí" onClick={() => updateField('Come entre comidas', currentValues['Come entre comidas'] === 'Sí' ? '' : 'Sí')} /><TogglePill active={currentValues['Come entre comidas'] === 'No'} label="No" onClick={() => updateField('Come entre comidas', currentValues['Come entre comidas'] === 'No' ? '' : 'No')} /></div></label>
              <label>¿Con qué electrodomésticos cuenta?<input value={currentValues['Electrodomésticos con los que cuenta'] ?? ''} onChange={(e) => updateField('Electrodomésticos con los que cuenta', e.target.value)} /></label>
              <label>¿Ha modificado su alimentación en los últimos 6 meses? (trabajo, estudio, actividad)<input value={currentValues['Cambios en la alimentación últimos 6 meses'] ?? ''} onChange={(e) => updateField('Cambios en la alimentación últimos 6 meses', e.target.value)} /></label>
              <label>¿Su consumo varía cuando está triste, nervioso o ansioso?<input value={currentValues['Variación del consumo con el ánimo'] ?? ''} onChange={(e) => updateField('Variación del consumo con el ánimo', e.target.value)} /></label>
              <label>¿Agrega sal a la comida ya preparada?<div className="toggle-pair"><TogglePill active={currentValues['Agrega sal a la comida ya preparada'] === 'Sí'} label="Sí" onClick={() => updateField('Agrega sal a la comida ya preparada', currentValues['Agrega sal a la comida ya preparada'] === 'Sí' ? '' : 'Sí')} /><TogglePill active={currentValues['Agrega sal a la comida ya preparada'] === 'No'} label="No" onClick={() => updateField('Agrega sal a la comida ya preparada', currentValues['Agrega sal a la comida ya preparada'] === 'No' ? '' : 'No')} /></div></label>
            </div></div>
          </div>],
          ['frecuencia', 'Frecuencia de alimentos', <div className="form-card" key="fr"><h3>Frecuencia de alimentos <small className="freq-hint">días por semana</small></h3><div className="frequency-chips">
            {FOOD_FREQUENCY.map((food) => <label className="frequency-chip" key={food}><span>{food}</span><input type="number" min="0" max="7" value={currentValues[`Frecuencia: ${food}`] ?? ''} onChange={(e) => updateField(`Frecuencia: ${food}`, e.target.value)} /></label>)}
          </div></div>],
          ['dieta', 'Dieta habitual', <FormCard key="dh" title="Dieta habitual (alimentos, cantidades y horarios)" fields={['Desayuno|*', 'Colación matutina|*', 'Almuerzo o comida|*', 'Colación vespertina|*', 'Cena|*']} values={currentValues} onFieldChange={updateField} />],
          ['recordatorio', 'Recordatorio 24 h', <RecallBuilder key="r24" value={currentValues['Recordatorio 24 h']} onChange={(next) => updateField('Recordatorio 24 h', next)} age={computeAge(patient?.birthDate)} sex={patient?.sex} />],
        ]} />
      </div>

      : tab === 'Estilo de vida' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 12</p><h1>Estilo de vida</h1><p className="subtitle">Actividad física y hábitos de {patientName}.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['actividad', 'Actividad física', <FormCard key="af" title="Actividad física" fields={['Tipo de ejercicio|', 'Frecuencia semanal|', 'Duración por sesión|']} values={currentValues} onFieldChange={updateField} />],
          ['descanso', 'Descanso y ánimo', <FormCard key="da" title="Descanso y ánimo" fields={['Horas de sueño|', 'Calidad del sueño|', 'Nivel de estrés percibido|', 'Estado de ánimo|', 'Jornada laboral|', 'Otros|*']} values={currentValues} onFieldChange={updateField} />],
        ]} />
      </div>

      : tab === 'Sociocultural' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 12</p><h1>Sociocultural</h1><p className="subtitle">Contexto socioeconómico y cultural de {patientName}.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['contexto', 'Contexto', <FormCard key="cx" title="Contexto socioeconómico" fields={['Ocupación|', 'Entorno familiar|', 'Entorno laboral|', 'Presupuesto destinado a la alimentación|', 'Barreras económicas para el plan (presupuesto)|*', 'Acceso a alimentos|*']} values={currentValues} onFieldChange={updateField} />],
          ['cultura', 'Cultura y creencias', <FormCard key="cu" title="Cultura y creencias" fields={['Restricciones religiosas o culturales|', 'Creencias sobre alimentación|', 'Notas socioculturales|*']} values={currentValues} onFieldChange={updateField} />],
        ]} />
      </div>

      : tab === 'Resumen' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 12</p><h1>Resumen</h1><p className="subtitle">Motivo de consulta, datos generales y contexto de {patientName}.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['datos', 'Datos del paciente', <div className="sub-stack" key="dp-stack">
            <div className="summary-card form-card"><div className="summary-card-head"><h3>Datos del paciente</h3>{!patientEdit
              ? <button type="button" className="link-button" onClick={startPatientEdit}>Editar fecha de nacimiento y ocupación</button>
              : <div className="summary-card-actions"><button type="button" className="link-button" onClick={() => setPatientEdit(false)}>Cancelar</button><button type="button" className="link-button" disabled={patientSaveState === 'saving'} onClick={savePatientEdit}>{patientSaveState === 'saving' ? 'Guardando…' : 'Guardar'}</button></div>}</div><div className="form-grid three">
              <label>Nombre<input value={patient ? `${patient.firstName} ${patient.lastName}` : '—'} readOnly /></label>
              <label>Sexo<input value={patient?.sex ? (SEX_LABELS[patient.sex] || patient.sex) : '—'} readOnly /></label>
              <label>Fecha de nacimiento{patientEdit ? <input type="date" value={patientForm.birthDate} onChange={(e) => setPatientForm((prev) => ({ ...prev, birthDate: e.target.value }))} /> : <input value={patient?.birthDate ? formatDateUTC(patient.birthDate) : '—'} readOnly />}</label>
              <label>Edad<input value={computeAge(patient?.birthDate) != null ? `${computeAge(patient.birthDate)} años` : '—'} readOnly /></label>
              <label>Ocupación{patientEdit ? <input value={patientForm.occupation} onChange={(e) => setPatientForm((prev) => ({ ...prev, occupation: e.target.value }))} placeholder="Ej. Diseñadora" /> : <input value={patient?.occupation || '—'} readOnly />}</label>
              <label>Contacto<input value={[patient?.phone, patient?.email].filter(Boolean).join(' · ') || '—'} readOnly /></label>
            </div>{patientSaveState === 'error' && <div className="form-error">⚠ No se pudieron guardar los datos.</div>}</div>
            {summaryTrends.some((t) => t.points.length) && <div className="summary-trends">
              {summaryTrends.map((trend) => <div className="summary-trend-card" key={trend.label}>
                {/* Sin color de "bien/mal": subir es la meta en masa muscular y lo contrario en
                    grasa, y en peso depende del objetivo de cada paciente — el signo lo juzga la
                    nutrióloga, no el color del número. */}
                <div className="summary-trend-head"><b>{trend.label}</b>{trend.points.length >= 2 && <span className="trend-delta">{trend.last >= trend.first ? '↑' : '↓'} {Math.abs(Math.round((trend.last - trend.first) * 10) / 10)} {trend.unit}</span>}</div>
                {trend.points.length >= 2
                  ? <svg viewBox="0 0 180 58" preserveAspectRatio="none" className="summary-trend-svg"><polyline points={trend.line} fill="none" stroke="var(--green)" strokeWidth="2.5" />{trend.points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--green)" />)}</svg>
                  : <p className="muted summary-trend-empty">Aún no hay suficientes mediciones.</p>}
              </div>)}
            </div>}
          </div>],
          ['motivo', 'Motivo de consulta', <div className="form-card" key="mo">
            <h3>Motivo de consulta y objetivo</h3>
            <div className="form-grid">
              <label>Motivo de consulta<textarea value={currentValues['Motivo de consulta'] ?? ''} onChange={(e) => updateField('Motivo de consulta', e.target.value)} /></label>
            </div>
            <SuggestionChips storageKey="chips:motivo-consulta" seed={MOTIVO_CONSULTA_SUGGESTIONS} value={currentValues['Motivo de consulta']} onPick={(next) => updateField('Motivo de consulta', next)} joiner=". " />
            <div className="form-grid">
              <label>Objetivo<textarea value={currentValues['Objetivo'] ?? ''} onChange={(e) => updateField('Objetivo', e.target.value)} /></label>
              <label>Referencia de la cita<input value={currentValues['Referencia de la cita'] ?? ''} onChange={(e) => updateField('Referencia de la cita', e.target.value)} placeholder="¿Cómo llegó el paciente?" /></label>
            </div>
            <SuggestionChips storageKey="chips:referencia-cita" seed={REFERENCIA_CITA_SUGGESTIONS} value={currentValues['Referencia de la cita']} onPick={(next) => updateField('Referencia de la cita', next)} joiner=", " />
          </div>],
          ['historial', 'Historial y agenda', <div className="summary-card form-card" key="ha"><h3>Historial y agenda</h3><div className="form-grid">
            <label>Consultas registradas<input value={`${historyCount}`} readOnly /></label>
            <label>Consulta actual<input value={consultation ? (consultation.status === 'IN_PROGRESS' ? 'En curso' : consultation.status) : '—'} readOnly /></label>
            <label>Próxima cita<input value={patient?.nextAppointmentAt ? `${formatDate(patient.nextAppointmentAt)} · ${formatAppointmentTime(patient.nextAppointmentAt)} · ${APPOINTMENT_TYPE_LABELS[patient.nextAppointmentType] || 'Cita'}` : 'Sin cita próxima'} readOnly /></label>
          </div></div>],
        ]} />
      </div>

      : tab === 'Tratamiento' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 12</p><h1>Tratamiento</h1><p className="subtitle">Plan de intervención acordado con {patientName}: objetivos, educación y seguimiento.</p>
        <Subsection value={sub} onChange={setSub} groups={[
          ['objetivos', 'Objetivos', <div key="ob" className="sub-stack">
            <div className="form-card reference-card"><h3>Base del diagnóstico</h3>
              {currentValues['Objetivo'] && <p className="reference-line"><b>Objetivo general (Resumen):</b> {currentValues['Objetivo']}</p>}
              {diagnoses.length ? <div className="reference-list">{diagnoses.map((d) => <div className="reference-row" key={d.id}><b>{d.domain}</b><span>{d.problem}</span></div>)}</div> : <p className="muted">Aún no hay diagnósticos; regístralos en la sección Diagnóstico para basar aquí los objetivos.</p>}
            </div>
            <FormCard title="Objetivos terapéuticos" fields={['Objetivo general|', 'Objetivos a corto plazo|', 'Objetivos a largo plazo|']} values={currentValues} onFieldChange={updateField} />
          </div>],
          ['recomendaciones', 'Recomendaciones', <FormCard key="rc" title="Recomendaciones" fields={['Recomendaciones generales|', 'Recomendaciones de alimentación|']} values={currentValues} onFieldChange={updateField} />],
          ['educacion', 'Educación', <FormCard key="ed" title="Educación nutricional" fields={['Temas de educación para el paciente|', 'Material educativo entregado|']} values={currentValues} onFieldChange={updateField} />],
          ['metas', 'Metas y acuerdos', <FormCard key="mt" title="Metas y acuerdos" fields={['Metas SMART|', 'Barreras y soluciones|*', 'Acuerdos con el paciente|']} values={currentValues} onFieldChange={updateField} />],
          ['suplementos', 'Suplementos', <FormCard key="sp" title="Suplementos" fields={['Suplementos recomendados|*', 'Dosis e indicaciones|*']} values={currentValues} onFieldChange={updateField} />],
          ['seguimiento', 'Seguimiento', <FormCard key="sg" title="Seguimiento" fields={['Próximos pasos|', 'Notas de tratamiento|']} values={currentValues} onFieldChange={updateField} />],
        ]} />
      </div>

      : tab === 'Notas' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 12</p><h1>Notas</h1><p className="subtitle">Información adicional de {patientName} no clasificada en las demás secciones.</p>
        <FormCard title="Notas de consulta" fields={['Notas de consulta|']} values={currentValues} onFieldChange={updateField} />
      </div>

      : <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 12</p><h1>{tab}</h1><p className="subtitle">Registra los datos de {tab.toLowerCase()} de {patientName}.</p>
        <FormCard title={tab} fields={['Registro clínico|', 'Notas adicionales|']} values={currentValues} onFieldChange={updateField} />
      </div>}

      <div className="wizard-footer"><button className="secondary" disabled={TABS.indexOf(tab) === 0} onClick={() => setTab(TABS[TABS.indexOf(tab) - 1])}>← Anterior</button><span>{saveLabel}</span><button className="primary" disabled={TABS.indexOf(tab) === TABS.length - 1} onClick={() => setTab(TABS[TABS.indexOf(tab) + 1])}>Siguiente <span>→</span></button></div>
    </fieldset>}
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
