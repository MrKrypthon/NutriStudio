import { useEffect, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import { documentsApi, patientsApi, plansApi } from '../../lib/api.js'
import { usePatient } from '../../lib/usePatient.js'

export default function DocumentPage({ setActive, patientId, embedded = false, onPublished }) {
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
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewState, setPreviewState] = useState('idle')
  const previewFrame = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const plansResponse = await patientsApi.plans(patientId)
        const items = plansResponse.items || []
        // Embedded (plan wizard step 4) must work on the SAME plan PlanStudio is editing — the
        // draft that's not yet published — not a previously published one. Standalone (/Documento)
        // shows the published plan to download/deliver.
        const activePlan = embedded
          ? items.find((item) => item.status !== 'PUBLISHED') || items[0] || null
          : items.find((item) => item.status === 'PUBLISHED') || items[0] || null
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
  }, [patientId, embedded])

  // La vista previa es el PDF real (el mismo que se entrega), pedido al servidor: así lo que se ve
  // aquí y lo que se descarga no pueden diferir. Se vuelve a pedir al publicar o regenerar.
  useEffect(() => {
    if (!plan?.id) return undefined
    let cancelled = false
    let url = ''
    setPreviewState('loading')
    plansApi.previewPdfBlob(plan.id)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setPreviewUrl(url)
        setPreviewState('ready')
      })
      .catch(() => { if (!cancelled) setPreviewState('error') })
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [plan?.id, plan?.status, document?.version])

  const publishPlan = async () => {
    if (!plan) return
    setPublishState('publishing')
    setError('')
    try {
      // Publicar también genera el PDF en el servidor; el plan regresa con su documento.
      const published = await plansApi.publish(plan.id)
      setPlan(published)
      const generated = (published.documents || []).find((doc) => doc.type === 'nutrition_plan' && doc.storageKey)
      if (generated) setDocument(generated)
      setPublishState('published')
      onPublished?.()
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

  const downloadPdf = async () => {
    if (!document?.storageKey) return
    try {
      const blob = await documentsApi.downloadBlob(document.id)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = document.storageKey
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message || 'No se pudo descargar el PDF.')
    }
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

  // El PDF se imprime desde su propio visor; si el navegador no lo permite, se abre aparte.
  const printPdf = () => {
    try { previewFrame.current.contentWindow.print() } catch { if (previewUrl) window.open(previewUrl, '_blank', 'noopener') }
  }

  // A DRAFT plan has no menuSnapshot yet (that only gets frozen at publish time) — count the live
  // mealSlots instead.
  const mealCount = plan?.menuSnapshot?.length || (plan?.mealSlots || []).filter((slot) => slot.recipeId).length

  const body = <div className={embedded ? 'document-content' : 'content document-content'}>
    <div className="document-top">
      <div>
        {!embedded && <button className="back-button" onClick={() => setActive('Constructor de plan')}>← Regresar al plan</button>}
        <p className="eyebrow">ENTREGA · PLAN DE ALIMENTACIÓN</p>
        <h1>Publicar y entregar</h1>
        <p className="subtitle">{plan ? `Paciente: ${patientName}` : 'No hay un plan para esta paciente todavía.'}</p>
      </div>
      <div>
        <button className="secondary" onClick={() => setPreview(!preview)}>{preview ? 'Editar' : 'Vista previa'}</button>
        <button className="secondary" disabled={previewState !== 'ready'} onClick={printPdf}>⎙ Imprimir</button>
        {document?.storageKey
          ? <>
              <button className="secondary" disabled={genState === 'generating'} onClick={generatePdf}>{genState === 'generating' ? 'Regenerando…' : 'Regenerar'}</button>
              <button className="primary" onClick={downloadPdf}>⇩ Descargar PDF</button>
            </>
          : plan?.status === 'PUBLISHED'
            ? <button className="primary" disabled={genState === 'generating'} onClick={generatePdf}>{genState === 'generating' ? 'Generando…' : 'Generar PDF'}</button>
            : <button className="primary" disabled={!plan || publishState === 'publishing' || !mealCount || !plan.targetKcal} onClick={publishPlan}>{publishState === 'publishing' ? 'Publicando…' : 'Publicar plan'}</button>}
      </div>
    </div>

    {error && <div className="form-error">⚠ {error}</div>}
    {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando plan…</h3></div>}
    {loadState === 'ready' && !plan && <div className="result-empty panel"><span>◌</span><h3>No hay un plan para esta paciente</h3><p>Crea una evaluación y una distribución semanal antes de publicar.</p></div>}

    {loadState === 'ready' && plan && <div className="document-workspace">
      <section className={'document-preview ' + (preview ? 'preview-focus' : '')}>
        <div className="paper-toolbar"><span>Vista previa del plan</span><small>{plan.status === 'PUBLISHED' ? 'Publicado · no se modificará' : 'Borrador · aún puede cambiar'}</small></div>
        {previewState === 'loading' && !previewUrl && <div className="result-empty"><span className="loading-dot">●</span><h3>Preparando la vista previa…</h3></div>}
        {previewState === 'error' && <div className="result-empty"><span>◌</span><h3>No se pudo cargar la vista previa</h3><p>Revisa la conexión con el servidor e inténtalo de nuevo.</p></div>}
        {previewUrl && previewState !== 'error' && <iframe ref={previewFrame} className="plan-pdf-frame" title="Vista previa del plan de alimentación" src={`${previewUrl}#toolbar=0&navpanes=0&view=FitH`} />}
      </section>
      <aside className="document-options panel">
        <p className="eyebrow">ESTADO DE LA ENTREGA</p>
        <h2>{plan.status === 'PUBLISHED' ? 'Plan publicado' : 'Plan en borrador'}</h2>
        <p className="muted">{plan.status === 'PUBLISHED' ? 'El menú quedó congelado: aunque edites una receta después, este documento no cambiará.' : 'Así se verá el PDF de la paciente. Al publicar, el menú queda congelado y el PDF se genera listo para entregar.'}</p>
        <div className="document-summary"><span>{mealCount} comidas asignadas</span><b>{plan.status === 'PUBLISHED' ? (document?.storageKey ? (document.deliveredAt ? 'Entregado' : 'PDF listo') : 'Falta generar el PDF') : 'Falta publicar'}</b></div>
        {!plan.targetKcal && <p className="muted">Falta guardar el cálculo de requerimientos: vuelve al paso "Plan alimentario" para poder publicar el plan.</p>}
        {plan.status !== 'PUBLISHED' && <button className="primary full-button" disabled={publishState === 'publishing' || !mealCount} onClick={publishPlan}>{publishState === 'publishing' ? 'Publicando…' : 'Publicar plan'} <span>→</span></button>}
        {plan.status === 'PUBLISHED' && !document?.storageKey && <button className="primary full-button" disabled={genState === 'generating'} onClick={generatePdf}>{genState === 'generating' ? 'Generando…' : 'Generar PDF'} <span>→</span></button>}
        {plan.status === 'PUBLISHED' && document?.storageKey && <button className="primary full-button" onClick={downloadPdf}>Descargar PDF <span>→</span></button>}
        {plan.status === 'PUBLISHED' && document?.storageKey && <button className="secondary full-button" disabled={genState === 'generating'} onClick={generatePdf}>{genState === 'generating' ? 'Regenerando…' : 'Regenerar PDF (actualizar formato)'}</button>}
        {plan.status === 'PUBLISHED' && document?.storageKey && (document.deliveredAt
          ? <p className="muted">✓ Marcado como entregado el {new Date(document.deliveredAt).toLocaleDateString('es-MX')}. El envío por WhatsApp/email todavía se hace fuera de la app.</p>
          : <button className="secondary full-button" disabled={deliverState === 'delivering'} onClick={markDelivered}>{deliverState === 'delivering' ? 'Registrando…' : 'Marcar como entregado'}</button>)}
      </aside>
    </div>}
  </div>

  return embedded ? body : <AppChrome active="Documentos" setActive={setActive}>{body}</AppChrome>
}
