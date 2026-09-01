import { useEffect, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import FormCard from '../../components/FormCard.jsx'
import { usePatient } from '../../lib/usePatient.js'
import { clinicalApi, documentsApi, patientsApi } from '../../lib/api.js'

const TABS = ['Resumen', 'General', 'Antropométrico', 'Bioquímico', 'Clínico', 'Dietético', 'Estilo de vida', 'Sociocultural', 'Diagnóstico', 'Tratamiento', 'Monitoreo', 'Notas']
const SECTION_KEYS = { Resumen: 'summary', General: 'general', Antropométrico: 'anthropometric', Bioquímico: 'biochemical', Clínico: 'clinical', Dietético: 'dietary', 'Estilo de vida': 'lifestyle', Sociocultural: 'sociocultural', Diagnóstico: 'diagnosis', Tratamiento: 'treatment', Monitoreo: 'monitoring', Notas: 'notes' }
const SAVE_LABELS = { idle: '● Guardado', editing: '● Editando…', saving: '● Guardando…', saved: '● Guardado', error: '⚠ Error al guardar', conflict: '⚠ Se editó en otra sesión, recarga para ver el cambio' }

export default function ClinicalRecordPage({ setActive, patientId }) {
  const { patient } = usePatient(patientId)
  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Cargando…'
  const patientInitials = patient ? `${patient.firstName[0] || ''}${patient.lastName[0] || ''}` : '··'

  const [tab, setTab] = useState('Antropométrico')
  const [loadState, setLoadState] = useState('loading')
  const [consultation, setConsultation] = useState(null)
  const [sections, setSections] = useState({})
  const [saveState, setSaveState] = useState('idle')
  const [measurementState, setMeasurementState] = useState('idle')
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
        if (!active) active = await clinicalApi.create(patientId, {})
        const full = await clinicalApi.get(active.id)
        if (cancelled) return
        setConsultation(full)
        const bySectionKey = {}
        for (const section of full.sections || []) bySectionKey[section.sectionKey] = section
        setSections(bySectionKey)
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

  const updateField = (label, value) => {
    const nextValues = { ...currentValues, [label]: value }
    setSections((prev) => ({ ...prev, [sectionKey]: { ...prev[sectionKey], payload: nextValues } }))
    setSaveState('editing')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveSection(sectionKey, nextValues), 800)
  }

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
      })
      setMeasurementState('saved')
    } catch {
      setMeasurementState('error')
    }
  }

  const generateReport = async () => {
    if (!consultation) return
    if (report?.storageKey) {
      const link = window.document.createElement('a')
      link.href = documentsApi.downloadUrl(report.id)
      link.download = report.storageKey
      link.click()
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
    {reportState === 'error' && <div className="form-error">⚠ No se pudo generar el informe.</div>}
    {measurementState === 'error' && <div className="form-error">⚠ No se pudo registrar la medición.</div>}
    <div className="record-tabs">{TABS.map((x) => <button className={tab === x ? 'active' : ''} onClick={() => setTab(x)} key={x}>{x}</button>)}</div>
    <div className="record-banner"><span className="spark">✦</span><div><b>Consulta en curso</b><small>Los cambios se guardan automáticamente · {saveLabel}</small></div><button className="secondary">Grabar consulta</button></div>

    {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando expediente…</h3></div>}
    {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar ni crear la consulta de {patientName}.</div>}

    {loadState === 'ready' && <>
      {tab === 'Antropométrico' ? <div className="clinical-layout">
        <section className="record-main panel">
          <div className="section-heading"><div><p className="eyebrow">SECCIÓN 3 DE 12</p><h1>Antropométrico</h1><p className="subtitle">Registra medidas y observa la evolución de {patientName}.</p></div><span className="saved">{saveLabel}</span></div>
          <div className="progress-chart">
            <div className="chart-title"><b>Evolución de métricas</b><select><option>Peso</option><option>IMC</option><option>% grasa corporal</option></select></div>
            <div className="chart-lines"><i /><i /><i /><svg viewBox="0 0 600 130" preserveAspectRatio="none"><polyline points="10,25 190,65 380,48 590,85" fill="none" stroke="var(--green)" strokeWidth="3" /><circle cx="10" cy="25" r="5" fill="var(--green)" /><circle cx="190" cy="65" r="5" fill="var(--green)" /><circle cx="380" cy="48" r="5" fill="var(--green)" /><circle cx="590" cy="85" r="5" fill="var(--green)" /></svg><div className="chart-labels"><span>18 jun<br />pendiente</span><span>18 jul<br />pendiente</span><span>18 ago<br />pendiente</span></div></div>
          </div>
          <FormCard title="Peso y talla" fields={['Peso (kg)|', 'Talla (cm)|', 'IMC calculado|', 'Análisis de peso y talla|']} values={currentValues} onFieldChange={updateField} />
          <FormCard title="Circunferencias" fields={['Cintura (cm)|', 'Cadera (cm)|', 'Brazo (cm)|', 'ICC calculado|']} values={currentValues} onFieldChange={updateField} />
          <FormCard title="Pliegues cutáneos" fields={['Tricipital (mm)|', 'Bicipital (mm)|', 'Subescapular (mm)|', 'Suprailiaco (mm)|']} values={currentValues} onFieldChange={updateField} />
        </section>
        <aside className="record-aside panel"><p className="eyebrow">RESUMEN DE HOY</p><div className="measure-highlight"><small>Peso actual</small><b>{currentValues['Peso (kg)'] || '—'} kg</b></div><div className="measure-highlight"><small>% grasa corporal</small><b>—</b><span className="muted">Aún no capturado</span></div><button className="link-button" disabled={measurementState === 'saving' || (!anthro['Peso (kg)'] && !anthro['Talla (cm)'])} onClick={registerMeasurement}>{measurementState === 'saving' ? 'Registrando…' : measurementState === 'saved' ? '✓ Medición registrada' : 'Registrar medición de hoy →'}</button></aside>
      </div>

      : tab === 'Bioquímico' ? <div className="clinical-layout">
        <section className="record-main panel">
          <div className="section-heading"><div><p className="eyebrow">SECCIÓN 4 DE 12</p><h1>Bioquímico</h1><p className="subtitle">Registra estudios y marca hallazgos para el abordaje.</p></div><button className="primary">+ Agregar estudio</button></div>
          <div className="lab-empty"><span>▧</span><b>Sin estudios adjuntos</b><small>Sube un archivo o registra los resultados manualmente.</small><button className="secondary">Subir laboratorio</button></div>
          <div className="lab-list">{[['Glucosa', 'mg/dL', '92', 'Normal', 'confirmed'], ['HbA1c', '%', '5.4', 'Normal', 'confirmed'], ['Colesterol total', 'mg/dL', '218', 'Elevado', 'pending'], ['Triglicéridos', 'mg/dL', '148', 'Normal', 'confirmed'], ['TSH', 'µUI/mL', '—', 'Pendiente', 'pending']].map(([name, unit, value, state, color]) => <div className="lab-row" key={name}><div><b>{name}</b><small>{unit}</small></div><input value={value} readOnly /><span className={'status ' + color}>{state}</span><button>•••</button></div>)}</div>
        </section>
        <aside className="record-aside panel"><p className="eyebrow">LECTURA RÁPIDA</p><div className="lab-score">4<span>/5</span></div><b>Resultados registrados</b><p className="muted">Un hallazgo requiere seguimiento en el tratamiento.</p><div className="tag-row"><span>Colesterol elevado</span></div></aside>
      </div>

      : tab === 'Diagnóstico' ? <div className="panel diagnosis-panel">
        <div className="section-heading"><div><p className="eyebrow">SECCIÓN 9 DE 12 · TND</p><h1>Diagnóstico nutricio</h1><p className="subtitle">Selecciona uno o más diagnósticos por dominio.</p></div><button className="secondary">Buscar diagnóstico</button></div>
        <div className="diagnosis-domains">{[['INGESTIÓN', 'Problemas relacionados con ingesta, nutrientes y sustancias bioactivas.', 'mint'], ['CLÍNICOS', 'Hallazgos relacionados con condiciones físicas o médicas.', 'yellow'], ['CONDUCTUALES-AMBIENTALES', 'Conocimiento, actitudes y factores del entorno.', 'blue'], ['OTROS', 'Diagnósticos fuera de los dominios anteriores.', 'purple']].map(([title, desc, color]) => <div className={'domain-card ' + color} key={title}><span>◉</span><b>{title}</b><small>{desc}</small><strong>0 seleccionados</strong></div>)}</div>
        <div className="diagnosis-selected"><p className="eyebrow">DIAGNÓSTICOS SELECCIONADOS</p><p className="muted">Todavía no hay diagnósticos registrados para esta consulta.</p><label>Notas y evidencia<textarea placeholder="Añade la evidencia que sustenta el diagnóstico..." /></label></div>
      </div>

      : <div className="panel generic-section">
        <p className="eyebrow">SECCIÓN {TABS.indexOf(tab) + 1} DE 12</p><h1>{tab}</h1><p className="subtitle">Registra los datos de {tab.toLowerCase()} de {patientName}.</p>
        <FormCard title={tab} fields={['Registro clínico|', 'Notas adicionales|']} values={currentValues} onFieldChange={updateField} />
      </div>}

      <div className="wizard-footer"><button className="secondary">← Sección anterior</button><span>{saveLabel}</span><button className="primary">Siguiente sección <span>→</span></button></div>
    </>}
  </div></AppChrome>
}
