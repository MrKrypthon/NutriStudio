import { useEffect, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import FormCard from '../../components/FormCard.jsx'
import { usePatient } from '../../lib/usePatient.js'
import { clinicalApi, documentsApi, patientsApi } from '../../lib/api.js'

const TABS = ['Resumen', 'General', 'Antropométrico', 'Bioquímico', 'Clínico', 'Dietético', 'Estilo de vida', 'Sociocultural', 'Diagnóstico', 'Tratamiento', 'Monitoreo', 'Notas', 'Transcripción']
const SECTION_KEYS = { Resumen: 'summary', General: 'general', Antropométrico: 'anthropometric', Bioquímico: 'biochemical', Clínico: 'clinical', Dietético: 'dietary', 'Estilo de vida': 'lifestyle', Sociocultural: 'sociocultural', Diagnóstico: 'diagnosis', Tratamiento: 'treatment', Monitoreo: 'monitoring', Notas: 'notes', Transcripción: 'transcription' }
const TRANSCRIPT_FIELD = 'Transcripción de la consulta'
const SAVE_LABELS = { idle: '● Guardado', editing: '● Editando…', saving: '● Guardando…', saved: '● Guardado', error: '⚠ Error al guardar', conflict: '⚠ Se editó en otra sesión, recarga para ver el cambio' }

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

export default function ClinicalRecordPage({ setActive, patientId, appointmentId, onConsumeAppointment }) {
  const { patient } = usePatient(patientId)
  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Cargando…'
  const patientInitials = patient ? `${patient.firstName[0] || ''}${patient.lastName[0] || ''}` : '··'

  const [tab, setTab] = useState('Antropométrico')
  const [loadState, setLoadState] = useState('loading')
  const [consultation, setConsultation] = useState(null)
  const [sections, setSections] = useState({})
  const [saveState, setSaveState] = useState('idle')
  const [measurementState, setMeasurementState] = useState('idle')
  const [diagnoses, setDiagnoses] = useState([])
  const [diagnosisForm, setDiagnosisForm] = useState(null)
  const [diagnosisSaveState, setDiagnosisSaveState] = useState('idle')
  const [report, setReport] = useState(null)
  const [reportState, setReportState] = useState('idle')
  const saveTimer = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadState('loading')
      try {
        const list = await patientsApi.consultations(patientId)
        let active = (list.items || []).find((item) => item.status === 'IN_PROGRESS')
        if (!active) {
          active = await clinicalApi.create(patientId, appointmentId ? { appointmentId } : {})
          onConsumeAppointment?.()
        }
        const full = await clinicalApi.get(active.id)
        if (cancelled) return
        setConsultation(full)
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
    return () => { cancelled = true; clearTimeout(saveTimer.current) }
  }, [patientId])

  useEffect(() => {
    if (!consultation) return
    let cancelled = false
    documentsApi.list(`?patientId=${patientId}&type=consultation_report`)
      .then((response) => { if (!cancelled) { const existing = (response.items || []).find((doc) => doc.consultationId === consultation.id); if (existing) setReport(existing) } })
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
    }
  }

  // Two sequential updateField calls in the same tick would each read the same stale
  // currentValues closure and the second would silently overwrite the first's change —
  // updateFields lets a caller that needs to set more than one key do it atomically.
  const updateFields = (updates) => {
    const nextValues = { ...currentValues, ...updates }
    setSections((prev) => ({ ...prev, [sectionKey]: { ...prev[sectionKey], payload: nextValues } }))
    setSaveState('editing')
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
      await clinicalApi.registerMeasurement(consultation.id, {
        weightKg: numOrUndefined(anthro['Peso (kg)']),
        heightCm: numOrUndefined(anthro['Talla (cm)']),
        waistCm: numOrUndefined(anthro['Cintura (cm)']),
        hipCm: numOrUndefined(anthro['Cadera (cm)']),
        abdomenCm: numOrUndefined(anthro['Abdomen (cm)']),
        bodyFatPercent: numOrUndefined(anthro['% Grasa corporal']),
        muscleMassKg: numOrUndefined(anthro['Kg de músculo']),
      })
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

  return <AppChrome active="Pacientes" setActive={setActive}><div className="content clinical-content">
    <div className="patient-context">
      <button className="back-button" onClick={() => setActive('Pacientes')}>← Pacientes</button>
      <div className="clinical-person"><span className="person-avatar coral">{patientInitials}</span><div><h2>{patientName}</h2><span>Consulta nutricional · en curso</span></div></div>
      <div className="clinical-actions"><button className="secondary">▱ Agendar</button><button className="primary" disabled={reportState === 'working'} onClick={generateReport}>{reportState === 'working' ? 'Generando…' : report?.storageKey ? 'Descargar informe' : 'Generar informe'}</button></div>
    </div>
    {reportState === 'error' && <div className="form-error">⚠ No se pudo generar o descargar el informe.</div>}
    {measurementState === 'error' && <div className="form-error">⚠ No se pudo registrar la medición.</div>}
    <div className="record-tabs">{TABS.map((x) => <button className={tab === x ? 'active' : ''} onClick={() => setTab(x)} key={x}>{x}</button>)}</div>
    <div className="record-banner"><span className="spark">✦</span><div><b>Consulta en curso</b><small>Los cambios se guardan automáticamente · {saveLabel}</small></div><button className="secondary" onClick={() => setTab('Transcripción')}>Grabar consulta</button></div>

    {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando expediente…</h3></div>}
    {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar ni crear la consulta de {patientName}.</div>}

    {loadState === 'ready' && <>
      {tab === 'Antropométrico' ? <div className="clinical-layout">
        <section className="record-main panel">
          <div className="section-heading"><div><p className="eyebrow">SECCIÓN 3 DE 13</p><h1>Antropométrico</h1><p className="subtitle">Registra medidas y observa la evolución de {patientName}.</p></div><span className="saved">{saveLabel}</span></div>
          <div className="progress-chart">
            <div className="chart-title"><b>Evolución de métricas</b><select><option>Peso</option><option>IMC</option><option>% grasa corporal</option></select></div>
            <div className="chart-lines"><i /><i /><i /><svg viewBox="0 0 600 130" preserveAspectRatio="none"><polyline points="10,25 190,65 380,48 590,85" fill="none" stroke="var(--green)" strokeWidth="3" /><circle cx="10" cy="25" r="5" fill="var(--green)" /><circle cx="190" cy="65" r="5" fill="var(--green)" /><circle cx="380" cy="48" r="5" fill="var(--green)" /><circle cx="590" cy="85" r="5" fill="var(--green)" /></svg><div className="chart-labels"><span>18 jun<br />pendiente</span><span>18 jul<br />pendiente</span><span>18 ago<br />pendiente</span></div></div>
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
          <div className="section-heading"><div><p className="eyebrow">SECCIÓN 4 DE 13</p><h1>Bioquímico</h1><p className="subtitle">Registra estudios y marca hallazgos para el abordaje.</p></div><button className="primary">+ Agregar estudio</button></div>
          <div className="lab-empty"><span>▧</span><b>Sin estudios adjuntos</b><small>Sube un archivo o registra los resultados manualmente.</small><button className="secondary">Subir laboratorio</button></div>
          <div className="lab-list">{[['Glucosa', 'mg/dL', '92', 'Normal', 'confirmed'], ['HbA1c', '%', '5.4', 'Normal', 'confirmed'], ['Colesterol total', 'mg/dL', '218', 'Elevado', 'pending'], ['Triglicéridos', 'mg/dL', '148', 'Normal', 'confirmed'], ['TSH', 'µUI/mL', '—', 'Pendiente', 'pending']].map(([name, unit, value, state, color]) => <div className="lab-row" key={name}><div><b>{name}</b><small>{unit}</small></div><input value={value} readOnly /><span className={'status ' + color}>{state}</span><button>•••</button></div>)}</div>
        </section>
        <aside className="record-aside panel"><p className="eyebrow">LECTURA RÁPIDA</p><div className="lab-score">4<span>/5</span></div><b>Resultados registrados</b><p className="muted">Un hallazgo requiere seguimiento en el tratamiento.</p><div className="tag-row"><span>Colesterol elevado</span></div></aside>
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

      : <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 13</p><h1>{tab}</h1><p className="subtitle">Registra los datos de {tab.toLowerCase()} de {patientName}.</p>
        <FormCard title={tab} fields={['Registro clínico|', 'Notas adicionales|']} values={currentValues} onFieldChange={updateField} />
      </div>}

      <div className="wizard-footer"><button className="secondary">← Sección anterior</button><span>{saveLabel}</span><button className="primary">Siguiente sección <span>→</span></button></div>
    </>}
  </div></AppChrome>
}
