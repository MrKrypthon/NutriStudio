import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { patientsApi, templatesApi } from '../../lib/api.js'

const TYPE_LABELS = { clinical: 'Expediente', plan: 'Plan nutricional' }
const TAB_TYPES = { Todas: null, Expedientes: 'clinical', 'Planes nutricionales': 'plan' }
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const formatUTCDate = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
const detailFor = (template) => template.type === 'clinical' ? `${Object.keys(template.sections || {}).length} sección(es)` : `${(template.mealSlots || []).length} comida(s) asignadas`
const emptyForm = () => ({ name: '', type: 'clinical', description: '', patientId: '' })

export default function TemplatesPage({ setActive, onSelectPatient }) {
  const [tab, setTab] = useState('Todas')
  const [templates, setTemplates] = useState([])
  const [status, setStatus] = useState('loading')
  const [patients, setPatients] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState('')
  const [applyTarget, setApplyTarget] = useState(null)
  const [applyPatientId, setApplyPatientId] = useState('')
  const [applyState, setApplyState] = useState('idle')

  const loadTemplates = () => {
    setStatus('loading')
    templatesApi.list()
      .then((response) => { setTemplates(response.items || []); setStatus('online') })
      .catch(() => setStatus('demo'))
  }

  useEffect(loadTemplates, [])
  useEffect(() => { patientsApi.list('?status=ACTIVE').then((payload) => setPatients(payload.items || [])).catch(() => setPatients([])) }, [])

  const visible = templates.filter((t) => !TAB_TYPES[tab] || t.type === TAB_TYPES[tab])

  const openModal = () => { setForm(emptyForm()); setSaveState('idle'); setSaveError(''); setOpen(true) }
  const closeModal = () => setOpen(false)
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const createTemplate = async (event) => {
    event.preventDefault()
    if (!form.patientId) { setSaveError('Selecciona un paciente cuyo trabajo más reciente se usará como base.'); return }
    setSaveState('saving')
    setSaveError('')
    try {
      const payload = { name: form.name, type: form.type, description: form.description }
      if (form.type === 'clinical') {
        const consultations = await patientsApi.consultations(form.patientId)
        const source = (consultations.items || [])[0]
        if (!source) throw new Error('Ese paciente todavía no tiene ninguna consulta que usar como base.')
        payload.sourceConsultationId = source.id
      } else {
        const plans = await patientsApi.plans(form.patientId)
        const source = (plans.items || [])[0]
        if (!source) throw new Error('Ese paciente todavía no tiene ningún plan que usar como base.')
        payload.sourcePlanId = source.id
      }
      await templatesApi.create(payload)
      setSaveState('idle')
      closeModal()
      loadTemplates()
    } catch (error) {
      setSaveState('error')
      setSaveError(error.message || 'No se pudo crear la plantilla.')
    }
  }

  const openApply = (template) => { setApplyTarget(template); setApplyPatientId(''); setApplyState('idle') }
  const closeApply = () => setApplyTarget(null)

  const applyTemplate = async () => {
    if (!applyPatientId) return
    setApplyState('applying')
    try {
      await templatesApi.apply(applyTarget.id, applyPatientId)
      onSelectPatient?.(applyPatientId)
      closeApply()
      loadTemplates()
      setActive(applyTarget.type === 'clinical' ? 'Expediente' : 'Constructor de plan')
    } catch {
      setApplyState('error')
    }
  }

  return <AppChrome active="Plantillas" setActive={setActive}><div className="content">
    <ModuleHeader eyebrow="BIBLIOTECA · PLANTILLAS" title="Plantillas" subtitle="Empieza cada consulta con una estructura que ya conoces." action={<div className="module-actions"><span className={'sync-label ' + (status === 'online' ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'online' ? 'Sincronizadas' : status === 'loading' ? 'Cargando…' : 'Datos de demostración'}</span><button className="primary" onClick={openModal}><span>+</span> Nueva plantilla</button></div>} />
    <div className="template-tabs">{Object.keys(TAB_TYPES).map((t) => <button className={tab === t ? 'selected' : ''} onClick={() => setTab(t)} key={t}>{t}</button>)}</div>

    {status === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando plantillas…</h3></div>}
    {status !== 'loading' && visible.length === 0 && <div className="result-empty panel"><span>◌</span><h3>No hay plantillas aquí todavía</h3><p>Crea una a partir del expediente o plan de un paciente.</p></div>}

    <div className="template-grid">
      {visible.map((template) => <div className="template-card panel" key={template.id}>
        <div className={'template-icon ' + (template.type === 'clinical' ? 'mint' : 'coral')}>✦</div>
        <div className="template-type">{TYPE_LABELS[template.type] || template.type}</div>
        <h3>{template.name}</h3>
        <p>{detailFor(template)}</p>
        <div className="template-footer"><span>Usada {template.usageCount} vez(es) · {formatUTCDate(template.updatedAt)}</span><button onClick={() => openApply(template)}>Usar plantilla →</button></div>
      </div>)}
    </div>
  </div>

  {open && <div className="modal-backdrop" onClick={closeModal}><div className="modal" onClick={(e) => e.stopPropagation()}>
    <div className="modal-head"><h2>Nueva plantilla</h2><button onClick={closeModal}>×</button></div>
    <form onSubmit={createTemplate}>
      <label>Nombre<input value={form.name} onChange={(e) => update('name', e.target.value)} required /></label>
      <label>Tipo<select value={form.type} onChange={(e) => update('type', e.target.value)}><option value="clinical">Expediente</option><option value="plan">Plan nutricional</option></select></label>
      <label>Descripción<textarea value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Para qué tipo de consulta sirve..." /></label>
      <label>Paciente base<select value={form.patientId} onChange={(e) => update('patientId', e.target.value)} required><option value="">Selecciona…</option>{patients.map((p) => <option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select></label>
      <p className="muted">Se copiará {form.type === 'clinical' ? 'la consulta más reciente de este paciente' : 'el plan más reciente de este paciente'} como punto de partida. Cambiar la plantilla después no afecta lo ya creado a partir de ella.</p>
      {saveState === 'error' && <div className="form-error">⚠ {saveError}</div>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={closeModal}>Cancelar</button><button className="primary" disabled={saveState === 'saving'}>{saveState === 'saving' ? 'Creando…' : 'Crear plantilla'}</button></div>
    </form>
  </div></div>}

  {applyTarget && <div className="modal-backdrop" onClick={closeApply}><div className="modal" onClick={(e) => e.stopPropagation()}>
    <div className="modal-head"><h2>Usar "{applyTarget.name}"</h2><button onClick={closeApply}>×</button></div>
    <label>Paciente<select value={applyPatientId} onChange={(e) => setApplyPatientId(e.target.value)}><option value="">Selecciona…</option>{patients.map((p) => <option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select></label>
    <p className="muted">{applyTarget.type === 'clinical' ? 'Se precargará la consulta en curso de este paciente (o se creará una) con estas secciones.' : 'Se reemplazará la distribución del plan en borrador de este paciente (o se creará uno) con estos tiempos de comida.'}</p>
    {applyState === 'error' && <div className="form-error">⚠ No se pudo aplicar la plantilla.</div>}
    <div className="modal-actions"><button type="button" className="secondary" onClick={closeApply}>Cancelar</button><button className="primary" disabled={!applyPatientId || applyState === 'applying'} onClick={applyTemplate}>{applyState === 'applying' ? 'Aplicando…' : 'Usar plantilla'}</button></div>
  </div></div>}
  </AppChrome>
}
