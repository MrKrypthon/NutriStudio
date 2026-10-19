import { useEffect, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import { documentsApi, patientsApi, plansApi, templatesApi } from '../../lib/api.js'
import { usePatient } from '../../lib/usePatient.js'
import { planFileName } from '../../../server/domain/pdfTheme.js'
import PdfDesignEditor from './PdfDesignEditor.jsx'

// `planId` (sólo embebido en el Constructor): el plan que se está editando. Sin él, la pantalla
// elegía "el primer plan no publicado" de la paciente, que podía ser otro borrador o uno cancelado.
export default function DocumentPage({ setActive, patientId, planId = null, embedded = false, onPublished }) {
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
  const [templateState, setTemplateState] = useState('idle')
  // Editor del diseño del PDF (colores, tipografía); al guardarlo se rehace la vista previa.
  const [designOpen, setDesignOpen] = useState(false)
  const [designVersion, setDesignVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        // Embedded (plan wizard, step Entrega) must work on exactly the plan PlanStudio is editing,
        // so it is loaded by id. Standalone (/Documento) shows the published plan to
        // download/deliver.
        let activePlan = null
        if (embedded) {
          activePlan = planId ? await plansApi.get(planId) : null
        } else {
          const items = (await patientsApi.plans(patientId)).items || []
          activePlan = items.find((item) => item.status === 'PUBLISHED') || items[0] || null
        }
        if (cancelled) return
        setPlan(activePlan)
        setDocument(null)
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
  }, [patientId, embedded, planId])

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
  }, [plan?.id, plan?.status, document?.version, designVersion])

  const publishPlan = async () => {
    if (!plan) return
    setPublishState('publishing')
    setError('')
    try {
      // Publicar también genera el PDF en el servidor; el plan regresa con su documento.
      const published = await plansApi.publish(plan.id)
      // La respuesta no trae las comidas asignadas: se conservan las ya cargadas.
      setPlan((prev) => ({ ...prev, ...published }))
      const generated = (published.documents || []).find((doc) => doc.type === 'nutrition_plan' && doc.storageKey)
      if (generated) setDocument(generated)
      setPublishState('published')
      onPublished?.(published)
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

  // Un plan ya publicado tiene su PDF guardado: se regenera con el diseño nuevo para que lo que se
  // descarga coincida con lo que se ve.
  const onDesignSaved = () => {
    setDesignVersion((value) => value + 1)
    if (plan?.status === 'PUBLISHED' && document?.storageKey) generatePdf()
  }

  const downloadPdf = async () => {
    if (!document?.storageKey) return
    try {
      const blob = await documentsApi.downloadBlob(document.id)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = planFileName(patientName, plan?.publishedAt || document.generatedAt || new Date())
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

  // Guarda el plan como plantilla (recetas de la semana, porciones, tiempos e indicaciones) para
  // usarlo con otras pacientes desde Plantillas.
  const saveTemplate = async () => {
    if (!plan) return
    const name = window.prompt('Nombre de la plantilla:', `Plan ${plan.targetKcal ? `${plan.targetKcal} kcal` : 'de alimentación'}${plan.goal ? ` · ${plan.goal.slice(0, 40)}` : ''}`)
    if (!name || !name.trim()) return
    setTemplateState('saving')
    setError('')
    try {
      await templatesApi.create({ name: name.trim().slice(0, 120), type: 'plan', sourcePlanId: plan.id, description: plan.targetKcal ? `${plan.targetKcal} kcal/día` : null })
      setTemplateState('saved')
    } catch (err) {
      setTemplateState('error')
      setError(err.message || 'No se pudo guardar la plantilla.')
    }
  }
  // WhatsApp no deja adjuntar archivos desde un enlace: abre el chat con un mensaje listo y el PDF
  // se adjunta a mano después de descargarlo.
  const phoneDigits = String(patient?.phone || '').replace(/\D/g, '')
  const whatsappNumber = phoneDigits.length === 10 ? `52${phoneDigits}` : phoneDigits
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`¡Hola${patient?.firstName ? ` ${patient.firstName}` : ''}! Te comparto tu plan de alimentación. Cualquier duda, aquí estoy.`)}`

  // A DRAFT plan has no menuSnapshot yet (that only gets frozen at publish time) — count the live
  // mealSlots instead.
  const mealCount = plan?.menuSnapshot?.length || (plan?.mealSlots || []).filter((slot) => slot.recipeId).length

  const published = plan?.status === 'PUBLISHED'
  const lastChange = plan?.publishedAt || plan?.updatedAt
  const previewPanel = <section className="document-preview save-preview">
    <div className="paper-toolbar"><span>Vista previa del plan</span><small>{published ? 'Publicado · no se modificará' : 'Borrador · aún puede cambiar'}</small><button type="button" className="secondary" disabled={previewState !== 'ready'} onClick={printPdf}>⎙ Imprimir</button></div>
    {previewState === 'loading' && !previewUrl && <div className="result-empty"><span className="loading-dot">●</span><h3>Preparando la vista previa…</h3></div>}
    {previewState === 'error' && <div className="result-empty"><span>◌</span><h3>No se pudo cargar la vista previa</h3><p>Revisa la conexión con el servidor e inténtalo de nuevo.</p></div>}
    {previewUrl && previewState !== 'error' && <iframe ref={previewFrame} className="plan-pdf-frame" title="Vista previa del plan de alimentación" src={`${previewUrl}#toolbar=0&navpanes=0&view=FitH`} />}
  </section>
  // Paso "Guardar" del Constructor, como en Avena: antes de publicar, "Guarda tu plan"; después,
  // las tarjetas de lo que sigue (plantilla, PDF y envío).
  const saveStep = <div className="document-content save-step">
    {error && <div className="form-error">⚠ {error}</div>}
    {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando plan…</h3></div>}
    {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar el plan. Intenta de nuevo más tarde.</div>}
    {loadState === 'ready' && !plan && <div className="result-empty panel"><span>◌</span><h3>No hay un plan para guardar</h3><p>Crea el plan y elige sus recetas antes de guardarlo.</p></div>}
    {loadState === 'ready' && plan?.status === 'CANCELLED' && <div className="result-empty panel"><span>⏸</span><h3>Plan cancelado</h3><p>Reactívalo o haz una versión nueva para guardarlo y asignarlo. Mientras tanto puedes previsualizarlo.</p><button type="button" className="link-button" onClick={() => setPreview(!preview)}>{preview ? 'Ocultar vista previa' : 'Previsualizar'}</button></div>}
    {loadState === 'ready' && plan && !published && plan.status !== 'CANCELLED' && <section className="save-hero">
      <div className="save-hero-art" aria-hidden="true"><span>🥗</span><span>🍳</span><span>🥑</span><span>🍓</span></div>
      <div>
        <h2>Guarda tu plan</h2>
        <p className="save-assign">Se asignará automáticamente a:<b>{patientName}.</b></p>
        <p className="muted">Después podrás descargarlo en PDF y enviárselo por WhatsApp. También puedes guardarlo como plantilla y usarlo en planes futuros.</p>
        {!plan.targetKcal && <p className="form-error">⚠ Falta guardar el cálculo de requerimientos (paso Dietocálculo).</p>}
        {!mealCount && <p className="form-error">⚠ El plan todavía no tiene recetas (paso Distribuye).</p>}
        <div className="save-actions">
          <button type="button" className="primary" disabled={publishState === 'publishing' || !mealCount || !plan.targetKcal} onClick={publishPlan}>{publishState === 'publishing' ? 'Guardando…' : 'Guardar y asignar plan'}</button>
          <button type="button" className="link-button" disabled={templateState === 'saving'} onClick={saveTemplate}>{templateState === 'saving' ? 'Guardando plantilla…' : templateState === 'saved' ? 'Plantilla guardada ✓' : 'Guardar plantilla'}</button>
          <button type="button" className="link-button" onClick={() => setPreview(!preview)}>{preview ? 'Ocultar vista previa' : 'Previsualizar'}</button>
          <button type="button" className="link-button" onClick={() => setDesignOpen(true)}>Diseño del PDF</button>
        </div>
        <small className="muted">Al guardar, el menú queda congelado: si después cambias una receta, este plan no cambia.</small>
      </div>
    </section>}
    {loadState === 'ready' && plan && published && <div className="save-cards">
      <article className="panel save-card">
        <div className="save-hero-art small" aria-hidden="true"><span>🥗</span><span>🍳</span><span>🥑</span><span>🍓</span></div>
        <h3>Listo, plan guardado y asignado</h3>
        {lastChange && <p><small>Última modificación:</small><b className="save-date">{new Date(lastChange).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })}</b></p>}
        <p className="muted">Ahora puedes compartirlo con {patient?.firstName || 'tu paciente'} en PDF.</p>
        <button type="button" className="secondary" disabled={templateState === 'saving'} onClick={saveTemplate}>{templateState === 'saving' ? 'Guardando…' : templateState === 'saved' ? 'Plantilla guardada ✓' : 'Guardar como plantilla'}</button>
      </article>
      <article className="panel save-card">
        <span className="save-card-icon" aria-hidden="true">📄</span>
        <h3>Descarga plan en PDF</h3>
        <p className="muted">Revisa tu plan y compártelo con tu paciente.</p>
        {document?.storageKey
          ? <><button type="button" className="primary" onClick={downloadPdf}>⇩ Descargar PDF</button><button type="button" className="link-button" disabled={genState === 'generating'} onClick={generatePdf}>{genState === 'generating' ? 'Regenerando…' : 'Regenerar PDF'}</button></>
          : <button type="button" className="primary" disabled={genState === 'generating'} onClick={generatePdf}>{genState === 'generating' ? 'Generando…' : 'Generar PDF'}</button>}
        <button type="button" className="link-button" onClick={() => setPreview(!preview)}>{preview ? 'Ocultar vista previa' : 'Previsualizar'}</button>
        <button type="button" className="link-button" onClick={() => setDesignOpen(true)}>Colores y tipografía</button>
      </article>
      <article className="panel save-card">
        <span className="save-card-icon" aria-hidden="true">💬</span>
        <h3>Envíalo por WhatsApp</h3>
        <p className="muted">{whatsappNumber ? 'Abre el chat con un mensaje listo; adjunta ahí el PDF que descargaste.' : 'La paciente no tiene teléfono en su ficha: agrégalo en Pacientes para abrir el chat desde aquí.'}</p>
        {whatsappNumber && <a className="secondary button-link" href={whatsappUrl} target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>}
        {document?.storageKey && (document.deliveredAt
          ? <p className="muted">✓ Entregado el {new Date(document.deliveredAt).toLocaleDateString('es-MX')}.</p>
          : <button type="button" className="secondary" disabled={deliverState === 'delivering'} onClick={markDelivered}>{deliverState === 'delivering' ? 'Registrando…' : 'Marcar como entregado'}</button>)}
      </article>
    </div>}
    {loadState === 'ready' && plan && preview && previewPanel}
    {designOpen && plan && <div className="modal-backdrop" onClick={() => setDesignOpen(false)}><div className="modal pdfd-modal" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head"><div><p className="eyebrow">PLAN EN PDF · DISEÑO</p><h2>Colores y tipografía</h2><span className="modal-subtitle">Se guarda para todos tus planes. La vista previa usa este plan.</span></div><button type="button" onClick={() => setDesignOpen(false)} aria-label="Cerrar">×</button></div>
      <PdfDesignEditor planId={plan.id} onSaved={onDesignSaved} />
    </div></div>}
  </div>

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
    {loadState === 'error' && <div className="form-error" style={{ margin: '0 0 16px' }}>⚠ No se pudo cargar el plan. Intenta de nuevo más tarde.</div>}

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

  return embedded ? saveStep : <AppChrome active="Documentos" setActive={setActive}>{body}</AppChrome>
}
