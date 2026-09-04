import { useEffect, useMemo, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import FormCard from '../../components/FormCard.jsx'
import { usePatient } from '../../lib/usePatient.js'
import { appointmentsApi, clinicalApi, documentsApi, labAttachmentsApi, patientsApi } from '../../lib/api.js'

const TABS = ['Resumen', 'General', 'Antropométrico', 'Bioquímico', 'Clínico', 'Dietético', 'Estilo de vida', 'Sociocultural', 'Diagnóstico', 'Tratamiento', 'Monitoreo', 'Notas', 'Transcripción']
const SECTION_KEYS = { Resumen: 'summary', General: 'general', Antropométrico: 'anthropometric', Bioquímico: 'biochemical', Clínico: 'clinical', Dietético: 'dietary', 'Estilo de vida': 'lifestyle', Sociocultural: 'sociocultural', Diagnóstico: 'diagnosis', Tratamiento: 'treatment', Monitoreo: 'monitoring', Notas: 'notes', Transcripción: 'transcription' }
const TRANSCRIPT_FIELD = 'Transcripción de la consulta'
const SAVE_LABELS = { idle: '● Guardado', editing: '● Editando…', saving: '● Guardando…', saved: '● Guardado', error: '⚠ Error al guardar', conflict: '⚠ Se editó en otra sesión, recarga para ver el cambio' }
const CONSULTATION_STATUS_LABELS = { DRAFT: 'Borrador', IN_PROGRESS: 'En curso', COMPLETED: 'Completada' }

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

const DIAGNOSIS_DOMAINS = [
  ['INGESTIÓN', 'Problemas relacionados con ingesta, nutrientes y sustancias bioactivas.', 'mint'],
  ['CLÍNICOS', 'Hallazgos relacionados con condiciones físicas o médicas.', 'yellow'],
  ['CONDUCTUALES-AMBIENTALES', 'Conocimiento, actitudes y factores del entorno.', 'blue'],
  ['OTROS', 'Diagnósticos fuera de los dominios anteriores.', 'purple'],
]

const FAMILY_DISEASES = ['Diabetes', 'Obesidad', 'Cardiopatías', 'HTA', 'Dislipidemias', 'Nefropatías', 'Cáncer', 'Enf. cerebrovasculares', 'Otros']
const RELATIVES = ['Mamá/Papá', 'Abuelos', 'Tíos']
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

function TranscriptionTab({ values, updateField, updateFields, patientName }) {
  const consentGiven = !!values['Consentimiento confirmado']

  const appendFinalChunk = (chunk) => {
    const existing = values[TRANSCRIPT_FIELD] || ''
    const separator = existing && !existing.endsWith('\n') && !existing.endsWith(' ') ? ' ' : ''
    updateField(TRANSCRIPT_FIELD, `${existing}${separator}${chunk}`)
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
  const { patient } = usePatient(patientId)
  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Cargando…'
  const patientInitials = patient ? `${patient.firstName[0] || ''}${patient.lastName[0] || ''}` : '··'

  const [tab, setTab] = useState('Antropométrico')
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
  const [attachments, setAttachments] = useState([])
  const [uploadState, setUploadState] = useState('idle')
  const [uploadError, setUploadError] = useState('')
  const saveTimer = useRef(null)
  // Holds everything needed to replay the in-flight debounced save if the component unmounts
  // before the 800ms timer fires (see the cleanup below) — captured fresh on every call to
  // updateFields, so it never reads stale `consultation`/`sections` from an old closure.
  const pendingSaveRef = useRef(null)

  useEffect(() => {
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
          // one included) instead of the current in-progress consultation. Consuming the id after
          // the fetch means a later plain "Abrir expediente" falls back to the current session.
          full = await clinicalApi.get(consultationId)
          onConsumeConsultation?.()
        } else {
          let active = (list.items || []).find((item) => item.status === 'IN_PROGRESS')
          if (!active) {
            active = await clinicalApi.create(patientId, appointmentId ? { appointmentId } : {})
            onConsumeAppointment?.()
          } else if (appointmentId) {
            // Creating a consultation marks the appointment that started it COMPLETED as a side
            // effect (see clinicalApi.create above) -- but here we're reusing an already
            // IN_PROGRESS consultation instead, so that side effect never ran. Without this, the
            // appointment that was actually clicked stays CONFIRMED forever.
            await appointmentsApi.complete(appointmentId).catch(() => {})
            onConsumeAppointment?.()
          }
          full = await clinicalApi.get(active.id)
        }
        if (cancelled) return
        setConsultation(full)
        setAttachments(full.labAttachments || [])
        const bySectionKey = {}
        for (const section of full.sections || []) bySectionKey[section.sectionKey] = section
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
      // The debounce below trades "save on every keystroke" for "save 800ms after the user
      // stops typing" — but if they navigate away inside that window, cancelling the timer
      // alone would drop the edit on the floor with no error. Replay it as a best-effort
      // fire-and-forget request instead: the component is gone, so there's no state left to
      // update and no UI left to report a failure to.
      const pending = pendingSaveRef.current
      if (pending) clinicalApi.saveSection(pending.consultationId, pending.key, pending.payload, pending.lastSavedAt).catch(() => {})
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
    if (!consultation) return
    setSaveState('saving')
    try {
      const saved = await clinicalApi.saveSection(consultation.id, key, payload, sections[key]?.lastSavedAt)
      setSections((prev) => ({ ...prev, [key]: saved }))
      setSaveState('saved')
    } catch (error) {
      setSaveState(error.code === 'CONCURRENT_EDIT' ? 'conflict' : 'error')
    } finally {
      pendingSaveRef.current = null
    }
  }

  // Two sequential updateField calls in the same tick would each read the same stale
  // currentValues closure and the second would silently overwrite the first's change —
  // updateFields lets a caller that needs to set more than one key do it atomically.
  const updateFields = (updates) => {
    const nextValues = { ...currentValues, ...updates }
    setSections((prev) => ({ ...prev, [sectionKey]: { ...prev[sectionKey], payload: nextValues } }))
    setSaveState('editing')
    pendingSaveRef.current = { consultationId: consultation.id, key: sectionKey, payload: nextValues, lastSavedAt: sections[sectionKey]?.lastSavedAt }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveSection(sectionKey, nextValues), 800)
  }
  const updateField = (label, value) => updateFields({ [label]: value })

  const saveLabel = SAVE_LABELS[saveState]
  const anthro = sections.anthropometric?.payload || {}
  const numOrUndefined = (value) => value !== undefined && value !== '' ? Number(value) : undefined

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
      setMeasurements((prev) => [...prev, created].sort((a, b) => new Date(a.measuredAt) - new Date(b.measuredAt)))
      setMeasurementState('saved')
    } catch {
      setMeasurementState('error')
    }
  }

  const openDiagnosisForm = (domain) => { setDiagnosisSaveState('idle'); setDiagnosisForm({ domain, problem: '', etiology: '', evidence: '' }) }
  const closeDiagnosisForm = () => setDiagnosisForm(null)
  const updateDiagnosisForm = (key, value) => setDiagnosisForm((prev) => ({ ...prev, [key]: value }))

  const saveDiagnosis = async () => {
    if (!consultation || !diagnosisForm?.problem) return
    setDiagnosisSaveState('saving')
    try {
      const created = await clinicalApi.addDiagnosis(consultation.id, diagnosisForm)
      setDiagnoses((prev) => [...prev, created])
      setDiagnosisForm(null)
      setDiagnosisSaveState('idle')
    } catch {
      setDiagnosisSaveState('error')
    }
  }

  const removeDiagnosis = async (id) => {
    if (!consultation) return
    try {
      await clinicalApi.removeDiagnosis(consultation.id, id)
      setDiagnoses((prev) => prev.filter((d) => d.id !== id))
    } catch { /* leave it in the list; the professional can retry */ }
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

  const uploadLabAttachment = async (file) => {
    if (!consultation || !file) return
    if (file.type !== 'application/pdf') { setUploadState('error'); setUploadError('Solo se aceptan archivos PDF.'); return }
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

  const generateReport = async () => {
    if (!consultation) return
    if (report?.storageKey) {
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
      return
    }
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

  // RF-05: full expediente export — all sections in a single PDF, separate from the condensed
  // patient-facing report above.
  const generateExport = async () => {
    if (!consultation) return
    if (exportDoc?.storageKey) {
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
      return
    }
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

  return <AppChrome active="Pacientes" setActive={setActive}><div className="content clinical-content">
    <div className="patient-context">
      <button className="back-button" onClick={() => setActive('Pacientes')}>← Pacientes</button>
      <div className="clinical-person"><span className="person-avatar coral">{patientInitials}</span><div><h2>{patientName}</h2><span>Consulta nutricional · {CONSULTATION_STATUS_LABELS[consultation?.status] || 'en curso'}</span></div></div>
      <div className="clinical-actions"><button className="secondary" onClick={() => onScheduleAppointment?.()}>▱ Agendar</button><button className="secondary" disabled={exportState === 'working'} onClick={generateExport}>{exportState === 'working' ? 'Generando…' : 'Expediente completo'}</button><button className="primary" disabled={reportState === 'working'} onClick={generateReport}>{reportState === 'working' ? 'Generando…' : report?.storageKey ? 'Descargar informe' : 'Generar informe'}</button></div>
    </div>
    {reportState === 'error' && <div className="form-error">⚠ No se pudo generar o descargar el informe.</div>}
    {exportState === 'error' && <div className="form-error">⚠ No se pudo generar o descargar el expediente completo.</div>}
    {measurementState === 'error' && <div className="form-error">⚠ No se pudo registrar la medición.</div>}
    <div className="record-tabs">{TABS.map((x) => <button className={tab === x ? 'active' : ''} onClick={() => setTab(x)} key={x}>{x}</button>)}</div>
    <div className="record-banner"><span className="spark">✦</span><div><b>{consultation?.status === 'COMPLETED' ? 'Consulta completada' : 'Consulta en curso'}</b><small>{consultation?.status === 'COMPLETED' ? `Sesión cerrada · ${formatDate(consultation.completedAt || consultation.startedAt)}` : `Los cambios se guardan automáticamente · ${saveLabel}`}</small></div><button className="secondary" onClick={() => setTab('Transcripción')}>Grabar consulta</button></div>

    {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando expediente…</h3></div>}
    {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar ni crear la consulta de {patientName}.</div>}

    {loadState === 'ready' && <>
      {tab === 'Antropométrico' ? <div className="clinical-layout">
        <section className="record-main panel">
          <div className="section-heading"><div><p className="eyebrow">SECCIÓN 3 DE 13</p><h1>Antropométrico</h1><p className="subtitle">Registra medidas y observa la evolución de {patientName}.</p></div><span className="saved">{saveLabel}</span></div>
          <div className="progress-chart">
            <div className="chart-title"><b>Evolución de métricas</b><select value={chartMetric} onChange={(e) => setChartMetric(e.target.value)}><option>Peso</option><option>IMC</option><option>% grasa corporal</option></select></div>
            {chartPoints.length >= 2
              ? <div className="chart-lines"><svg viewBox="0 0 600 130" preserveAspectRatio="none"><polyline points={chartPointLine} fill="none" stroke="var(--green)" strokeWidth="3" />{chartPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="5" fill="var(--green)" />)}</svg><div className="chart-labels">{chartPoints.map((p, i) => <span key={i}><b>{p.value}</b><br />{`${new Date(p.date).getUTCDate()}/${String(new Date(p.date).getUTCMonth() + 1).padStart(2, '0')}`}</span>)}</div></div>
              : <p className="muted" style={{ padding: '42px 0', textAlign: 'center' }}>Registra al menos dos mediciones para ver la evolución.</p>}
          </div>
          <FormCard title="Peso y talla" fields={['Peso (kg)|', 'Talla (cm)|', 'IMC calculado|', 'Análisis de peso y talla|']} values={currentValues} onFieldChange={updateField} />
          <FormCard title="Circunferencias" fields={['Cintura (cm)|', 'Cadera (cm)|', 'Abdomen (cm)|', 'Brazo (cm)|', 'ICC calculado|']} values={currentValues} onFieldChange={updateField} />
          <FormCard title="Composición corporal" fields={['% Grasa corporal|', 'Kg de grasa|', 'Kg de músculo|', '% Músculo|']} values={currentValues} onFieldChange={updateField} />
          <FormCard title="Pliegues cutáneos" fields={['Tricipital (mm)|', 'Bicipital (mm)|', 'Subescapular (mm)|', 'Suprailiaco (mm)|']} values={currentValues} onFieldChange={updateField} />
        </section>
        <aside className="record-aside panel"><p className="eyebrow">RESUMEN DE HOY</p><div className="measure-highlight"><small>Peso actual</small><b>{currentValues['Peso (kg)'] || '—'} kg</b></div><div className="measure-highlight">{currentValues['% Grasa corporal'] ? <><small>% grasa corporal</small><b>{currentValues['% Grasa corporal']}%</b></> : <><small>% grasa corporal</small><b>—</b><span className="muted">Aún no capturado</span></>}</div><button className="link-button" disabled={measurementState === 'saving' || (!anthro['Peso (kg)'] && !anthro['Talla (cm)'])} onClick={registerMeasurement}>{measurementState === 'saving' ? 'Registrando…' : measurementState === 'saved' ? '✓ Medición registrada' : 'Registrar medición de hoy →'}</button></aside>
      </div>

      : tab === 'Bioquímico' ? <div className="clinical-layout">
        <section className="record-main panel">
          <div className="section-heading"><div><p className="eyebrow">SECCIÓN 4 DE 13</p><h1>Bioquímico</h1><p className="subtitle">Registra estudios y marca hallazgos para el abordaje.</p></div><button className="primary" onClick={openLabForm}>+ Agregar estudio</button></div>
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
          {labs.length > 0 && <div className="lab-list">{labs.map((lab) => { const color = lab.status === 'Normal' ? 'confirmed' : lab.status === 'Pendiente' ? 'pending' : 'pending'; return <div className="lab-row" key={lab.id}><div><b>{lab.name}</b><small>{lab.unit}{lab.range ? ` · ref. ${lab.range}` : ''}</small></div><input value={lab.value} readOnly /><span className={'status ' + color}>{lab.status}</span><button type="button" className="link-button" onClick={() => removeLab(lab.id)}>Quitar</button></div> })}</div>}

          <div className="section-heading"><div><p className="eyebrow">PDF DE ANÁLISIS CLÍNICOS</p><h2>Adjuntos del paciente</h2><p className="subtitle">Sube el PDF que trae {patientName} y captura sus valores arriba a mano; todavía no hay lectura automática.</p></div><label className="secondary" style={{ cursor: uploadState === 'uploading' ? 'default' : 'pointer' }}>{uploadState === 'uploading' ? 'Subiendo…' : '+ Subir PDF'}<input type="file" accept="application/pdf" style={{ display: 'none' }} disabled={uploadState === 'uploading'} onChange={(e) => { uploadLabAttachment(e.target.files[0]); e.target.value = '' }} /></label></div>
          {uploadState === 'error' && <div className="form-error">⚠ {uploadError}</div>}
          {!attachments.length && <div className="lab-empty"><span>▤</span><b>Sin PDF adjuntos</b><small>Sube el estudio en PDF que te compartió el paciente.</small></div>}
          {attachments.length > 0 && <div className="lab-list">{attachments.map((attachment) => <div className="lab-row attachment-row" key={attachment.id}><div><b>{attachment.fileName}</b><small>{(attachment.fileSize / 1024).toFixed(0)} KB · subido por {attachment.uploadedBy?.name || '—'}</small></div><button type="button" className="link-button" onClick={() => downloadLabAttachment(attachment)}>Ver</button><button type="button" className="link-button" onClick={() => removeLabAttachment(attachment.id)}>Quitar</button></div>)}</div>}
        </section>
        <aside className="record-aside panel"><p className="eyebrow">LECTURA RÁPIDA</p><div className="lab-score">{labs.filter((l) => l.status === 'Normal').length}<span>/{labs.length}</span></div><b>Resultados normales</b>{labs.some((l) => l.status === 'Elevado' || l.status === 'Bajo') ? <p className="muted">Hay hallazgos fuera de rango que requieren seguimiento en el tratamiento.</p> : <p className="muted">{labs.length ? 'Todos los estudios registrados están en rango normal.' : 'Todavía no hay estudios registrados.'}</p>}<div className="tag-row">{labs.filter((l) => l.status === 'Elevado' || l.status === 'Bajo').map((l) => <span key={l.id}>{l.name} {l.status.toLowerCase()}</span>)}</div></aside>
      </div>

      : tab === 'Diagnóstico' ? <div className="panel diagnosis-panel">
        <div className="section-heading"><div><p className="eyebrow">SECCIÓN 9 DE 13 · TND</p><h1>Diagnóstico nutricio</h1><p className="subtitle">Registra uno o más diagnósticos por dominio, en formato PES (problema, etiología, evidencia).</p></div><button className="secondary" onClick={() => openDiagnosisForm(DIAGNOSIS_DOMAINS[0][0])}>+ Nuevo diagnóstico</button></div>
        <div className="diagnosis-domains">{DIAGNOSIS_DOMAINS.map(([title, desc, color]) => <div className={'domain-card ' + color} key={title} onClick={() => openDiagnosisForm(title)} style={{ cursor: 'pointer' }}><span>◉</span><b>{title}</b><small>{desc}</small><strong>{diagnoses.filter((d) => d.domain === title).length} seleccionados</strong></div>)}</div>

        {diagnosisForm && <div className="diagnosis-form panel">
          <p className="eyebrow">NUEVO DIAGNÓSTICO · {diagnosisForm.domain}</p>
          <label>Problema<input value={diagnosisForm.problem} onChange={(e) => updateDiagnosisForm('problem', e.target.value)} placeholder="Ej. Ingesta excesiva de energía" /></label>
          <label>Etiología (relacionado con…)<textarea value={diagnosisForm.etiology} onChange={(e) => updateDiagnosisForm('etiology', e.target.value)} placeholder="Causa o factores contribuyentes..." /></label>
          <label>Evidencia (evidenciado por…)<textarea value={diagnosisForm.evidence} onChange={(e) => updateDiagnosisForm('evidence', e.target.value)} placeholder="Signos, síntomas o datos que lo sustentan..." /></label>
          {diagnosisSaveState === 'error' && <div className="form-error">⚠ No se pudo guardar el diagnóstico.</div>}
          <div className="modal-actions"><button type="button" className="secondary" onClick={closeDiagnosisForm}>Cancelar</button><button className="primary" disabled={!diagnosisForm.problem || diagnosisSaveState === 'saving'} onClick={saveDiagnosis}>{diagnosisSaveState === 'saving' ? 'Guardando…' : 'Guardar diagnóstico'}</button></div>
        </div>}

        <div className="diagnosis-selected">
          <p className="eyebrow">DIAGNÓSTICOS SELECCIONADOS</p>
          {!diagnoses.length && <p className="muted">Todavía no hay diagnósticos registrados para esta consulta.</p>}
          {diagnoses.map((d) => <div className="diagnosis-entry" key={d.id}>
            <div><b>{d.domain}</b><span>{d.problem}</span>{d.etiology && <small>Relacionado con: {d.etiology}</small>}{d.evidence && <small>Evidenciado por: {d.evidence}</small>}</div>
            <button type="button" className="link-button" onClick={() => removeDiagnosis(d.id)}>Quitar</button>
          </div>)}
        </div>
      </div>

      : tab === 'General' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>General</h1><p className="subtitle">Antecedentes heredofamiliares de {patientName}.</p>
        <div className="heredo-table">
          <div className="heredo-head"><span>Enfermedad</span>{RELATIVES.map((rel) => <b key={rel}>{rel}</b>)}</div>
          {FAMILY_DISEASES.map((disease) => <div className="heredo-row" key={disease}>
            <span>{disease}</span>
            {RELATIVES.map((rel) => { const key = `${disease}__${rel}`; const active = !!currentValues[key]; return <TogglePill key={rel} active={active} label={active ? '✓' : ''} onClick={() => updateField(key, !active)} /> })}
          </div>)}
        </div>
        <FormCard title="Notas adicionales" fields={['Notas de antecedentes|']} values={currentValues} onFieldChange={updateField} />
      </div>

      : tab === 'Clínico' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Clínico</h1><p className="subtitle">Revisión de síntomas y exploración física de {patientName}. Marca los que aplican.</p>
        <h3 className="exam-subhead">Síntomas</h3>
        <div className="symptom-grid">{SYMPTOMS.map((symptom) => { const active = !!currentValues[symptom]; return <TogglePill key={symptom} active={active} label={symptom} onClick={() => updateField(symptom, !active)} /> })}</div>
        <h3 className="exam-subhead">Exploración física</h3>
        {PHYSICAL_EXAM.map(([group, findings]) => <div key={group} className="exam-group">
          <b className="exam-group-title">{group}</b>
          <div className="symptom-grid">{findings.map((finding) => { const key = `Exploración: ${finding}`; const active = !!currentValues[key]; return <TogglePill key={finding} active={active} label={finding} onClick={() => updateField(key, !active)} /> })}</div>
        </div>)}
        <FormCard title="Notas adicionales" fields={['Notas clínicas|']} values={currentValues} onFieldChange={updateField} />
      </div>

      : tab === 'Monitoreo' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Monitoreo</h1><p className="subtitle">Seguimiento entre consultas de {patientName}: apego, síntomas y ajustes al plan.</p>
        <FormCard title="Apego a macros reportado" fields={['% Carbohidratos consumidos|', '% Proteína consumida|', '% Lípidos consumidos|']} values={currentValues} onFieldChange={updateField} />
        <FormCard title="Seguimiento subjetivo" fields={['Estado de ánimo|', 'Apego al plan|', 'Antojos|', 'Hambre|', 'Consumo de agua|', 'Ejercicio|']} values={currentValues} onFieldChange={updateField} />
        <FormCard title="Síntomas" fields={['Diarrea o estreñimiento|', 'Inflamación|', 'Cefalea|']} values={currentValues} onFieldChange={updateField} />
        <FormCard title="Evaluación de la consulta" fields={['Calidad de preparación de comidas|', 'Modificaciones al plan|', 'Tema para la próxima consulta|', 'Observaciones|']} values={currentValues} onFieldChange={updateField} />
      </div>

      : tab === 'Transcripción' ? <TranscriptionTab values={currentValues} updateField={updateField} updateFields={updateFields} patientName={patientName} />

      : tab === 'Dietético' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Dietético</h1><p className="subtitle">Hábitos alimentarios de {patientName}.</p>
        <FormCard title="Patrón de alimentación" fields={['Núm. de comidas al día|', 'Horario habitual|', 'Apetito|', 'Preferencias alimentarias|']} values={currentValues} onFieldChange={updateField} />
        <FormCard title="Alergias e intolerancias" fields={['Alergias alimentarias|', 'Intolerancias|', 'Restricciones dietéticas|']} values={currentValues} onFieldChange={updateField} />
        <FormCard title="Suplementos y consumo de agua" fields={['Suplementos que toma|', 'Consumo de agua habitual|', 'Notas dietéticas|']} values={currentValues} onFieldChange={updateField} />
      </div>

      : tab === 'Estilo de vida' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Estilo de vida</h1><p className="subtitle">Actividad física y hábitos de {patientName}.</p>
        <FormCard title="Actividad física" fields={['Tipo de ejercicio|', 'Frecuencia semanal|', 'Duración por sesión|']} values={currentValues} onFieldChange={updateField} />
        <FormCard title="Descanso" fields={['Horas de sueño|', 'Calidad del sueño|', 'Nivel de estrés percibido|']} values={currentValues} onFieldChange={updateField} />
        <FormCard title="Consumo de sustancias" fields={['Tabaquismo|', 'Consumo de alcohol|', 'Notas de estilo de vida|']} values={currentValues} onFieldChange={updateField} />
      </div>

      : tab === 'Sociocultural' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Sociocultural</h1><p className="subtitle">Contexto socioeconómico y cultural de {patientName}.</p>
        <FormCard title="Contexto socioeconómico" fields={['Ocupación|', 'Quién prepara los alimentos|', 'Acceso a alimentos|']} values={currentValues} onFieldChange={updateField} />
        <FormCard title="Cultura y creencias" fields={['Restricciones religiosas o culturales|', 'Creencias sobre alimentación|', 'Notas socioculturales|']} values={currentValues} onFieldChange={updateField} />
      </div>

      : tab === 'Resumen' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Resumen</h1><p className="subtitle">Datos generales y contexto de {patientName}.</p>
        <div className="summary-card form-card"><h3>Datos del paciente</h3><div className="form-grid three">
          <label>Nombre<input value={patient ? `${patient.firstName} ${patient.lastName}` : '—'} readOnly /></label>
          <label>Sexo<input value={patient?.sex ? (SEX_LABELS[patient.sex] || patient.sex) : '—'} readOnly /></label>
          <label>Fecha de nacimiento<input value={patient?.birthDate ? formatDate(patient.birthDate) : '—'} readOnly /></label>
          <label>Edad<input value={computeAge(patient?.birthDate) != null ? `${computeAge(patient.birthDate)} años` : '—'} readOnly /></label>
          <label>Ocupación<input value={patient?.occupation || '—'} readOnly /></label>
          <label>Contacto<input value={[patient?.phone, patient?.email].filter(Boolean).join(' · ') || '—'} readOnly /></label>
        </div></div>
        <div className="summary-card form-card"><h3>Historial de consultas</h3><div className="form-grid">
          <label>Consultas registradas<input value={`${historyCount}`} readOnly /></label>
          <label>Consulta actual<input value={consultation ? (consultation.status === 'IN_PROGRESS' ? 'En curso' : consultation.status) : '—'} readOnly /></label>
        </div></div>
      </div>

      : tab === 'Tratamiento' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Tratamiento</h1><p className="subtitle">Plan de intervención acordado con {patientName}: objetivos, educación y seguimiento.</p>
        <FormCard title="Objetivos terapéuticos" fields={['Objetivo general|', 'Objetivos a corto plazo|', 'Objetivos a largo plazo|']} values={currentValues} onFieldChange={updateField} />
        <FormCard title="Recomendaciones" fields={['Recomendaciones generales|', 'Recomendaciones de alimentación|']} values={currentValues} onFieldChange={updateField} />
        <FormCard title="Educación nutricional" fields={['Temas de educación para el paciente|', 'Material educativo entregado|']} values={currentValues} onFieldChange={updateField} />
        <FormCard title="Metas y acuerdos" fields={['Metas SMART|', 'Acuerdos con el paciente|']} values={currentValues} onFieldChange={updateField} />
        <FormCard title="Seguimiento" fields={['Próximos pasos|', 'Notas de tratamiento|']} values={currentValues} onFieldChange={updateField} />
      </div>

      : tab === 'Notas' ? <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>Notas</h1><p className="subtitle">Información adicional de {patientName} no clasificada en las demás secciones.</p>
        <FormCard title="Notas de consulta" fields={['Notas de consulta|']} values={currentValues} onFieldChange={updateField} />
      </div>

      : <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>{tab}</h1><p className="subtitle">Registra los datos de {tab.toLowerCase()} de {patientName}.</p>
        <FormCard title={tab} fields={['Registro clínico|', 'Notas adicionales|']} values={currentValues} onFieldChange={updateField} />
      </div>}

      <div className="wizard-footer"><button className="secondary" disabled={TABS.indexOf(tab) === 0} onClick={() => setTab(TABS[TABS.indexOf(tab) - 1])}>← Sección anterior</button><span>{saveLabel}</span><button className="primary" disabled={TABS.indexOf(tab) === TABS.length - 1} onClick={() => setTab(TABS[TABS.indexOf(tab) + 1])}>Siguiente sección <span>→</span></button></div>
    </>}
  </div></AppChrome>
}
