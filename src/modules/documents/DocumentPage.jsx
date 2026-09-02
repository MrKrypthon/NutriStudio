import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import { documentsApi, patientsApi, plansApi } from '../../lib/api.js'
import { usePatient } from '../../lib/usePatient.js'

const MEAL_TYPE_LABELS = { breakfast: 'Desayuno', lunch: 'Comida', snack: 'Colación', dinner: 'Cena' }
const DAY_LABELS = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' }

export default function DocumentPage({ setActive, patientId }) {
  const { patient } = usePatient(patientId)
  const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Cargando…'
  const [preview, setPreview] = useState(false)
  const [loadState, setLoadState] = useState('loading')
  const [plan, setPlan] = useState(null)
  const [document, setDocument] = useState(null)
  const [publishState, setPublishState] = useState('idle')
  const [genState, setGenState] = useState('idle')
  const [deliverState, setDeliverState] = useState('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const plansResponse = await patientsApi.plans(patientId)
        const items = plansResponse.items || []
        const activePlan = items.find((item) => item.status === 'PUBLISHED') || items[0] || null
        if (cancelled) return
        setPlan(activePlan)
        if (activePlan?.status === 'PUBLISHED') {
          const documentsResponse = await documentsApi.list(`?patientId=${patientId}&type=nutrition_plan`)
          if (cancelled) return
          const existing = (documentsResponse.items || []).find((doc) => doc.planId === activePlan.id)
          if (existing) setDocument(existing)
        }
        setLoadState('ready')
      } catch {
        if (!cancelled) setLoadState('error')
      }
    }
    load()
    return () => { cancelled = true }
  }, [patientId])

  const publishPlan = async () => {
    if (!plan) return
    setPublishState('publishing')
    setError('')
    try {
      const published = await plansApi.publish(plan.id)
      setPlan(published)
      setPublishState('published')
    } catch (err) {
      setPublishState('error')
      setError(err.message || 'No se pudo publicar el plan.')
    }
  }

  const generatePdf = async () => {
    if (!plan) return
    setGenState('generating')
    setError('')
    try {
      let doc = document
      if (!doc) doc = await documentsApi.createForPlan(plan.id)
      const generated = await documentsApi.generate(doc.id)
      setDocument(generated)
      setGenState('generated')
    } catch (err) {
      setGenState('error')
      setError(err.message || 'No se pudo generar el PDF.')
    }
  }

  const downloadPdf = () => {
    if (!document?.storageKey) return
    const link = window.document.createElement('a')
    link.href = documentsApi.downloadUrl(document.id)
    link.download = document.storageKey
    link.click()
  }

  const markDelivered = async () => {
    if (!document) return
    setDeliverState('delivering')
    setError('')
    try {
      const delivered = await documentsApi.deliver(document.id)
      setDocument(delivered)
      setDeliverState('delivered')
    } catch (err) {
      setDeliverState('error')
      setError(err.message || 'No se pudo registrar la entrega.')
    }
  }

  const menu = plan?.menuSnapshot || []
  const byDay = new Map()
  for (const entry of menu) { if (!byDay.has(entry.dayOfWeek)) byDay.set(entry.dayOfWeek, []); byDay.get(entry.dayOfWeek).push(entry) }

  return <AppChrome active="Pacientes" setActive={setActive}><div className="content document-content">
    <div className="document-top">
      <div>
        <button className="back-button" onClick={() => setActive('Constructor de plan')}>← Regresar al plan</button>
        <p className="eyebrow">ENTREGA · PLAN DE ALIMENTACIÓN</p>
        <h1>Publicar y entregar</h1>
        <p className="subtitle">{plan ? `Paciente: ${patientName}` : 'No hay un plan para esta paciente todavía.'}</p>
      </div>
      <div>
        <button className="secondary" onClick={() => setPreview(!preview)}>{preview ? 'Editar' : 'Vista previa'}</button>
        {document?.storageKey
          ? <button className="primary" onClick={downloadPdf}>⇩ Descargar PDF</button>
          : plan?.status === 'PUBLISHED'
            ? <button className="primary" disabled={genState === 'generating'} onClick={generatePdf}>{genState === 'generating' ? 'Generando…' : 'Generar PDF'}</button>
            : <button className="primary" disabled={!plan || publishState === 'publishing'} onClick={publishPlan}>{publishState === 'publishing' ? 'Publicando…' : 'Publicar plan'}</button>}
      </div>
    </div>

    {error && <div className="form-error">⚠ {error}</div>}
    {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando plan…</h3></div>}
    {loadState === 'ready' && !plan && <div className="result-empty panel"><span>◌</span><h3>No hay un plan para esta paciente</h3><p>Crea una evaluación y una distribución semanal antes de publicar.</p></div>}

    {loadState === 'ready' && plan && <div className="document-workspace">
      <section className={'document-preview ' + (preview ? 'preview-focus' : '')}>
        <div className="paper-toolbar"><span>Vista previa del plan</span><small>{plan.status === 'PUBLISHED' ? 'Publicado · no se modificará' : 'Borrador · aún puede cambiar'}</small></div>
        <div className="paper">
          <div className="paper-brand"><div className="brand-mark">N</div><div><b>nutri·studio</b><small>PLAN DE ALIMENTACIÓN</small></div></div>
          <div className="paper-meta"><b>Menú semanal</b><span>Paciente: {patientName}</span><span>Nutrióloga: Gabriela Alonso</span></div>
          {plan.targetKcal && <div className="paper-highlight"><b>Objetivo: {plan.goal || 'Sin objetivo registrado'}</b><p>{plan.targetKcal} kcal/día · {plan.carbsPercent}% carbohidratos · {plan.proteinPercent}% proteína · {plan.fatPercent}% grasas</p></div>}
          {byDay.size === 0 && <p className="muted">Este plan todavía no tiene recetas asignadas en la distribución semanal.</p>}
          {[...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([dayOfWeek, entries]) => <div className="paper-section" key={dayOfWeek}><b>{DAY_LABELS[dayOfWeek] || `Día ${dayOfWeek}`}</b><p>{entries.map((entry) => `${MEAL_TYPE_LABELS[entry.mealType] || entry.mealType}: ${entry.recipeName} (${entry.kcal} kcal)`).join(' · ')}</p></div>)}
          <div className="paper-signature">Gabriela Alonso · Nutrióloga</div>
        </div>
      </section>
      <aside className="document-options panel">
        <p className="eyebrow">ESTADO DE LA ENTREGA</p>
        <h2>{plan.status === 'PUBLISHED' ? 'Plan publicado' : 'Plan en borrador'}</h2>
        <p className="muted">{plan.status === 'PUBLISHED' ? 'El menú quedó congelado: aunque edites una receta después, este documento no cambiará.' : 'Publica el plan para congelar el menú y poder generar su PDF.'}</p>
        <div className="document-summary"><span>{menu.length} comidas asignadas</span><b>{plan.status === 'PUBLISHED' ? (document?.storageKey ? (document.deliveredAt ? 'Entregado' : 'PDF listo') : 'Falta generar el PDF') : 'Falta publicar'}</b></div>
        {plan.status !== 'PUBLISHED' && <button className="primary full-button" disabled={publishState === 'publishing' || !menu.length} onClick={publishPlan}>{publishState === 'publishing' ? 'Publicando…' : 'Publicar plan'} <span>→</span></button>}
        {plan.status === 'PUBLISHED' && !document?.storageKey && <button className="primary full-button" disabled={genState === 'generating'} onClick={generatePdf}>{genState === 'generating' ? 'Generando…' : 'Generar PDF'} <span>→</span></button>}
        {plan.status === 'PUBLISHED' && document?.storageKey && <button className="primary full-button" onClick={downloadPdf}>Descargar PDF <span>→</span></button>}
        {plan.status === 'PUBLISHED' && document?.storageKey && (document.deliveredAt
          ? <p className="muted">✓ Marcado como entregado el {new Date(document.deliveredAt).toLocaleDateString('es-MX')}. El envío por WhatsApp/email todavía se hace fuera de la app.</p>
          : <button className="secondary full-button" disabled={deliverState === 'delivering'} onClick={markDelivered}>{deliverState === 'delivering' ? 'Registrando…' : 'Marcar como entregado'}</button>)}
      </aside>
    </div>}
  </div></AppChrome>
}
