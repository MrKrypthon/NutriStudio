import { useCallback, useEffect, useMemo, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { documentsApi, patientsApi } from '../../lib/api.js'
import { planFileName } from '../../../server/domain/pdfTheme.js'
import { saveBlob } from '../../lib/download.js'
import PdfPreviewModal from '../../components/PdfPreviewModal.jsx'

// Los cuatro documentos que produce Milpa. Cada uno dice para quién es y DÓNDE se genera: la vista
// de Documentos no crea nada por sí misma, reúne lo que salió del Constructor de plan y del
// Expediente para descargarlo y registrar su entrega.
const DOC_TYPES = [
  { key: 'nutrition_plan', short: 'Planes', label: 'Plan de alimentación', icon: '▦', tone: 'plan', delivery: 'patient', audience: 'Para el paciente', purpose: 'El menú semanal con porciones y recetas que se le entrega.', origin: 'Se genera al publicar el plan en el Constructor (paso Guardar).' },
  { key: 'consultation_report', short: 'Informes', label: 'Informe de consulta', icon: '▤', tone: 'report', delivery: 'patient', audience: 'Para el paciente', purpose: 'Resumen de la consulta: mediciones, diagnóstico y recomendaciones.', origin: 'Se genera desde el expediente: «Generar expediente» → Informe para el paciente.' },
  { key: 'consultation_clinical', short: 'Informes clínicos', label: 'Informe clínico', icon: '✚', tone: 'clinical', delivery: 'professional', audience: 'Para otro profesional', purpose: 'Documento de derivación con laboratorios, recordatorio de 24 h y secciones clínicas.', origin: 'Se genera desde el expediente: «Generar expediente» → Informe clínico.' },
  { key: 'consultation_export', short: 'Expedientes', label: 'Expediente completo', icon: '❐', tone: 'export', delivery: null, audience: 'Para tu archivo', purpose: 'Todas las secciones de la consulta, conforme a la NOM-004, para archivo y auditoría.', origin: 'Se genera desde el expediente: «Generar expediente» → Expediente completo.' },
]
const TYPE_BY_KEY = Object.fromEntries(DOC_TYPES.map((type) => [type.key, type]))
const STATUS_FILTERS = [['all', 'Cualquier estado'], ['pending', 'Por entregar'], ['delivered', 'Entregados'], ['archived', 'En archivo'], ['missing', 'Sin PDF']]
const PLAN_STATUS = { DRAFT: 'borrador', READY: 'listo', PUBLISHED: 'publicado', SUPERSEDED: 'reemplazado', CANCELLED: 'cancelado' }

const FALLBACK = [
  { id: 'demo-1', type: 'consultation_report', version: 1, createdAt: '2026-08-26T16:00:00.000Z', generatedAt: '2026-08-26T16:00:00.000Z', deliveredAt: null, storageKey: 'demo', patient: { id: 'demo', firstName: 'Mariana', lastName: 'Torres' }, consultation: { startedAt: '2026-08-26T15:00:00.000Z' } },
  { id: 'demo-2', type: 'nutrition_plan', version: 1, createdAt: '2026-08-25T16:00:00.000Z', generatedAt: '2026-08-25T16:00:00.000Z', deliveredAt: '2026-08-25T18:00:00.000Z', storageKey: 'demo', patient: { id: 'demo', firstName: 'Mariana', lastName: 'Torres' }, plan: { version: 1, status: 'PUBLISHED', targetKcal: 1700 } },
]

const dateLabel = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const dateTimeLabel = (iso) => (iso ? new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const patientName = (doc) => `${doc.patient?.firstName || ''} ${doc.patient?.lastName || ''}`.trim() || 'Paciente'
const recordNumber = (patient) => (patient?.recordNumber ? `Exp. N.º ${String(patient.recordNumber).padStart(5, '0')}` : null)
// El expediente completo es para el archivo del consultorio: no se "entrega", queda archivado.
const isRealRef = (state) => state === 'online'
const statusOf = (doc) => (!doc.storageKey ? 'missing' : TYPE_BY_KEY[doc.type]?.delivery === null ? 'archived' : doc.deliveredAt ? 'delivered' : 'pending')
// El informe clínico va a otro profesional: se "envía". Los del paciente se "entregan".
const statusText = (doc, status) => {
  const toProfessional = TYPE_BY_KEY[doc.type]?.delivery === 'professional'
  return { missing: 'Sin PDF', archived: 'En archivo', pending: toProfessional ? 'Por enviar' : 'Por entregar', delivered: toProfessional ? 'Enviado' : 'Entregado' }[status]
}
const deliverText = (doc) => (TYPE_BY_KEY[doc.type]?.delivery === 'professional' ? 'Marcar enviado' : 'Marcar entregado')

// De dónde salió: "Plan v3 · 1,700 kcal/día · publicado" o "Consulta del 8 oct 2026".
function originLabel(doc) {
  if (doc.type === 'nutrition_plan') {
    const plan = doc.plan
    if (!plan) return 'El plan de origen ya no existe'
    return [`Plan v${plan.version}`, plan.targetKcal ? `${Number(plan.targetKcal).toLocaleString('es-MX')} kcal/día` : null, PLAN_STATUS[plan.status]].filter(Boolean).join(' · ')
  }
  const at = doc.consultation?.startedAt || doc.consultation?.createdAt
  return at ? `Consulta del ${dateLabel(at)}` : 'Consulta'
}

const DOWNLOAD_TITLES = { consultation_report: 'Informe de consulta', consultation_export: 'Expediente', consultation_clinical: 'Informe clínico', nutrition_plan: 'Plan de alimentación' }
// Mismo nombre legible que da el servidor ("Informe de consulta - Paciente - fecha.pdf").
const downloadName = (doc) => {
  const date = doc.type === 'nutrition_plan' ? (doc.plan?.publishedAt || doc.generatedAt || new Date()) : (doc.generatedAt || new Date())
  return planFileName(patientName(doc), date).replace('Plan de alimentación', DOWNLOAD_TITLES[doc.type] || 'Documento')
}

export default function DocumentsPage({ setActive, patientId = '', onOpenPatient, onOpenSession }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState('loading')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  // Vista por paciente: directorio a la izquierda (con su buscador) y documentos del elegido a la
  // derecha. En celular se ve una cosa a la vez.
  const [patientQuery, setPatientQuery] = useState('')
  // Al llegar desde un paciente (Pacientes → Documentos) se abre directamente su carpeta.
  const [selectedPatientId, setSelectedPatientId] = useState(patientId || null)
  const [mobileDetail, setMobileDetail] = useState(false)
  // Guía "¿Qué es cada documento?": cerrada por defecto; se recuerda si se dejó abierta.
  const [guideOpen, setGuideOpen] = useState(() => { try { return localStorage.getItem('nutri.documents.guide') === 'open' } catch { return false } })
  const toggleGuide = () => setGuideOpen((open) => { try { localStorage.setItem('nutri.documents.guide', open ? 'closed' : 'open') } catch { /* sin almacenamiento */ } return !open })
  const [grouped, setGrouped] = useState(() => { try { return localStorage.getItem('nutri.documents.view') !== 'list' } catch { return true } })
  const [detailId, setDetailId] = useState(null)
  // Visor: el PDF se ve dentro de la vista, sin descargarlo. Se recorre en el orden de la lista.
  const [previewId, setPreviewId] = useState(null)
  const [busy, setBusy] = useState(null)
  const [actionError, setActionError] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  const [genPatients, setGenPatients] = useState(null)
  const [genForm, setGenForm] = useState({ patientId: '', kind: 'plan' })

  useEffect(() => {
    documentsApi.list()
      .then((response) => { setItems(response.items || []); setTotal(response.total ?? (response.items || []).length); setState('online') })
      // Sólo sin API (modo demostración) se muestran ejemplos; un error de verdad se dice como tal.
      .catch((error) => { if (error.code === 'DEMO_MODE') { setItems(FALLBACK); setTotal(FALLBACK.length); setState('demo') } else { setItems([]); setState('error') } })
  }, [])
  useEffect(() => { try { localStorage.setItem('nutri.documents.view', grouped ? 'grouped' : 'list') } catch { /* sin almacenamiento */ } }, [grouped])

  const isReal = state === 'online'
  const counts = useMemo(() => {
    const byType = Object.fromEntries(DOC_TYPES.map((type) => [type.key, 0]))
    const byStatus = { all: items.length, pending: 0, delivered: 0, archived: 0, missing: 0 }
    for (const doc of items) { byType[doc.type] = (byType[doc.type] || 0) + 1; byStatus[statusOf(doc)] += 1 }
    return { byType, byStatus }
  }, [items])

  // En "Lista" el buscador filtra documentos; en "Por paciente" cada columna tiene el suyo.
  const query = grouped ? '' : search.trim().toLowerCase()
  const visible = items.filter((doc) => (typeFilter === 'all' || doc.type === typeFilter)
    && (statusFilter === 'all' || statusOf(doc) === statusFilter)
    && (!query || `${patientName(doc)} ${TYPE_BY_KEY[doc.type]?.label || ''} ${recordNumber(doc.patient) || ''}`.toLowerCase().includes(query)))
  const docTime = (doc) => new Date(doc.generatedAt || doc.createdAt || 0).getTime()
  const groups = useMemo(() => {
    const map = new Map()
    for (const doc of visible) {
      const key = doc.patient?.id || doc.patientId || 'sin-paciente'
      if (!map.has(key)) map.set(key, { patient: doc.patient, patientId: key, name: patientName(doc), docs: [], latest: 0 })
      const group = map.get(key)
      group.docs.push(doc)
      group.latest = Math.max(group.latest, docTime(doc))
    }
    // Primero quien tiene documentos más recientes: suele ser con quien se está trabajando.
    return [...map.values()].sort((a, b) => b.latest - a.latest)
  }, [visible])
  const patientTerm = patientQuery.trim().toLowerCase()
  const patientGroups = groups.filter((group) => !patientTerm || `${group.name} ${recordNumber(group.patient) || ''}`.toLowerCase().includes(patientTerm))
  // Si se llegó con un paciente (o se eligió uno) y no tiene documentos visibles, no se cae a la
  // carpeta de otro: antes se abría la del primero de la lista como si fuera la suya.
  const selectedGroup = selectedPatientId ? patientGroups.find((group) => group.patientId === selectedPatientId) || null : patientGroups[0] || null
  // Documentos del paciente elegido, reunidos por su origen: cada consulta con sus informes y su
  // expediente, y cada plan con su PDF. Es lo que liga Documentos con el resto de la app.
  const originGroups = useMemo(() => {
    if (!selectedGroup) return []
    const map = new Map()
    for (const doc of selectedGroup.docs) {
      const isPlan = doc.type === 'nutrition_plan'
      const key = isPlan ? `plan:${doc.planId || doc.id}` : `consulta:${doc.consultationId || doc.id}`
      if (!map.has(key)) {
        const date = isPlan ? (doc.plan?.publishedAt || doc.generatedAt || doc.createdAt) : (doc.consultation?.startedAt || doc.consultation?.createdAt || doc.createdAt)
        map.set(key, { key, isPlan, date, first: doc, docs: [] })
      }
      map.get(key).docs.push(doc)
    }
    return [...map.values()].sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [selectedGroup])
  const selectPatient = (group) => { setSelectedPatientId(group.patientId); setMobileDetail(true) }
  const detail = detailId ? items.find((doc) => doc.id === detailId) : null
  const previewable = useMemo(() => (grouped ? originGroups.flatMap((group) => group.docs) : visible).filter((doc) => doc.storageKey), [grouped, originGroups, visible])
  const preview = previewId ? items.find((doc) => doc.id === previewId) : null
  const previewIndex = preview ? previewable.findIndex((doc) => doc.id === preview.id) : -1
  // Identidad estable por documento: el visor vuelve a pedir el PDF sólo al cambiar de documento o
  // de versión (al regenerarlo), no en cada render.
  const previewVersion = preview ? `${preview.id}:${preview.version}:${preview.storageKey}` : ''
  const loadPreview = useCallback(() => (isRealRef(state) ? documentsApi.previewBlob(previewId) : Promise.reject(new Error('Vista de demostración: conecta el API para ver los PDF.'))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewVersion])
  const openDocument = (doc) => { if (doc.storageKey) { setDetailId(null); setPreviewId(doc.id) } else setDetailId(doc.id) }

  // Las respuestas de entregar/generar no siempre traen las relaciones: se conservan las cargadas.
  const replaceDoc = (updated) => setItems((prev) => prev.map((doc) => (doc.id === updated.id ? { ...doc, ...updated, patient: updated.patient || doc.patient, plan: updated.plan || doc.plan, consultation: updated.consultation || doc.consultation } : doc)))
  const run = async (doc, action) => {
    if (!isReal || busy) return
    setBusy(`${doc.id}:${action}`); setActionError('')
    try {
      if (action === 'download') saveBlob(await documentsApi.downloadBlob(doc.id), downloadName(doc))
      if (action === 'deliver') replaceDoc(await documentsApi.deliver(doc.id))
      if (action === 'undeliver') replaceDoc(await documentsApi.undeliver(doc.id))
      if (action === 'generate') replaceDoc(await documentsApi.generate(doc.id))
    } catch (error) {
      setActionError(error.message || 'No se pudo completar la acción.')
    } finally { setBusy(null) }
  }
  const isBusy = (doc, action) => busy === `${doc.id}:${action}`

  // Ir al lugar de donde salió el documento: los planes del paciente, o esa consulta del expediente.
  const openSource = (doc) => {
    const pid = doc.patient?.id || doc.patientId
    if (!pid) return
    if (doc.type === 'nutrition_plan') onOpenPatient?.(pid, 'Constructor de plan')
    else if (doc.consultationId && onOpenSession) onOpenSession(pid, doc.consultationId)
    else onOpenPatient?.(pid, 'Expediente')
  }

  // "Generar documento": los PDF salen del plan (Constructor) o de la consulta (Expediente); aquí
  // sólo se elige paciente y tipo, y se lleva a donde se generan.
  const openGenerate = () => {
    setGenForm({ patientId: '', kind: 'plan' }); setGenOpen(true)
    if (!genPatients) patientsApi.list('?status=ACTIVE&pageSize=500').then((payload) => setGenPatients(payload.items || [])).catch(() => setGenPatients([]))
  }
  const goGenerate = () => { if (genForm.patientId) onOpenPatient?.(genForm.patientId, genForm.kind === 'plan' ? 'Constructor de plan' : 'Expediente') }

  const renderRow = (doc, { withPatient, compactOrigin = false }) => {
    const type = TYPE_BY_KEY[doc.type] || { label: 'Documento', icon: '▤', tone: 'report' }
    const status = statusOf(doc)
    return <div className={'docs-row' + (detailId === doc.id ? ' selected' : '')} key={doc.id}>
      <button type="button" className="docs-row-main" onClick={() => openDocument(doc)} title={doc.storageKey ? 'Ver el PDF' : 'Ver detalles del documento'}>
        <span className={'docs-type-icon ' + type.tone} aria-hidden="true">{type.icon}</span>
        <span className="docs-row-text">
          <b>{type.label}{doc.version > 1 ? <i className="docs-version" title={`El PDF se ha generado ${doc.version} veces; ésta es la versión más reciente`}>PDF v{doc.version}</i> : null}</b>
          <small>{withPatient ? `${patientName(doc)} · ` : ''}{compactOrigin ? (TYPE_BY_KEY[doc.type]?.audience || '') : originLabel(doc)}</small>
        </span>
      </button>
      <span className="docs-row-date">{doc.generatedAt ? 'Generado' : 'Creado'}<b>{dateLabel(doc.generatedAt || doc.createdAt)}</b></span>
      <span className={'docs-pill ' + status} title={status === 'delivered' ? `${statusText(doc, status)} el ${dateTimeLabel(doc.deliveredAt)}` : undefined}>{statusText(doc, status)}{status === 'delivered' ? ` · ${dateLabel(doc.deliveredAt)}` : ''}</span>
      <span className="docs-row-actions">
        <button type="button" className="secondary docs-icon-btn" onClick={() => setDetailId(doc.id)} title="Detalles e historial" aria-label={`Detalles de ${type.label} de ${patientName(doc)}`}>ⓘ</button>
        {doc.storageKey && <button type="button" className="secondary docs-icon-btn" disabled={!isReal || isBusy(doc, 'download')} onClick={() => run(doc, 'download')} title="Descargar PDF" aria-label={`Descargar ${type.label} de ${patientName(doc)}`}>{isBusy(doc, 'download') ? '…' : '⤓'}</button>}
        {status === 'pending' && <button type="button" className="secondary docs-deliver" disabled={!isReal || isBusy(doc, 'deliver')} onClick={() => run(doc, 'deliver')}>{isBusy(doc, 'deliver') ? 'Guardando…' : deliverText(doc)}</button>}
        {status === 'missing' && <button type="button" className="secondary docs-deliver" disabled={!isReal || isBusy(doc, 'generate')} onClick={() => run(doc, 'generate')}>{isBusy(doc, 'generate') ? 'Generando…' : 'Generar PDF'}</button>}
      </span>
    </div>
  }

  const activeType = typeFilter !== 'all' ? TYPE_BY_KEY[typeFilter] : null
  const hasFilters = typeFilter !== 'all' || statusFilter !== 'all' || query

  return <AppChrome active="Documentos" setActive={setActive}><div className="content documents-content">
    <ModuleHeader
      eyebrow="DOCUMENTOS · PDF DE TUS PACIENTES"
      title="Documentos"
      subtitle="Todos los PDF que genera Milpa: planes, informes y expedientes. Aquí los descargas y registras su entrega; se crean desde el plan o el expediente de cada paciente."
      action={<div className="module-actions"><span className={'sync-label ' + (state === 'error' ? 'demo' : state)}>● {state === 'online' ? 'Sincronizados' : state === 'loading' ? 'Cargando…' : state === 'error' ? 'Sin conexión' : 'Vista demo'}</span><button className="primary" onClick={openGenerate}><span>+</span> Generar documento</button></div>}
    />

    {/* Filtros en una sola barra: tipos (con su conteo) y vista arriba; estados (y el buscador en
        «Lista») abajo. Antes los tipos eran tarjetas de ~150 px que empujaban la lista hacia abajo. */}
    <div className="docs-toolbar panel">
      <div className="docs-toolbar-row">
        <div className="docs-type-tabs" role="tablist" aria-label="Tipo de documento">
          <button type="button" role="tab" aria-selected={typeFilter === 'all'} className={'docs-type-tab' + (typeFilter === 'all' ? ' active' : '')} onClick={() => setTypeFilter('all')}><span className="docs-type-icon all" aria-hidden="true">▣</span>Todos<i className="docs-count">{counts.byStatus.all}</i></button>
          {DOC_TYPES.map((type) => <button type="button" role="tab" aria-selected={typeFilter === type.key} key={type.key} className={'docs-type-tab ' + type.tone + (typeFilter === type.key ? ' active' : '')} onClick={() => setTypeFilter(typeFilter === type.key ? 'all' : type.key)} title={`${type.label}: ${type.purpose}`}><span className={'docs-type-icon ' + type.tone} aria-hidden="true">{type.icon}</span>{type.short}<i className="docs-count">{counts.byType[type.key] || 0}</i></button>)}
        </div>
        <div className="view-switch docs-view-switch" role="group" aria-label="Vista"><button type="button" aria-pressed={grouped} className={grouped ? 'selected' : ''} onClick={() => setGrouped(true)}>Por paciente</button><button type="button" aria-pressed={!grouped} className={!grouped ? 'selected' : ''} onClick={() => setGrouped(false)}>Lista</button></div>
      </div>
      <div className="docs-toolbar-row">
        <div className="view-switch docs-status-switch" role="tablist" aria-label="Estado">{STATUS_FILTERS.map(([key, label]) => <button type="button" role="tab" aria-selected={statusFilter === key} key={key} className={statusFilter === key ? 'selected' : ''} onClick={() => setStatusFilter(key)}>{label}<i className="docs-count">{counts.byStatus[key]}</i></button>)}</div>
        {!grouped && <div className="search-field">⌕ <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por paciente, tipo o número de expediente…" aria-label="Buscar documentos" /></div>}
        <button type="button" className="link-button docs-guide-toggle" aria-expanded={guideOpen} onClick={toggleGuide}>{guideOpen ? 'Ocultar guía' : '¿Qué es cada documento?'}</button>
      </div>
      {activeType && !guideOpen && <p className="docs-type-hint"><span className={'docs-type-icon ' + activeType.tone} aria-hidden="true">{activeType.icon}</span><span><b>{activeType.label}</b> · {activeType.audience.toLowerCase()}. {activeType.purpose} <em>{activeType.origin}</em></span></p>}
      {guideOpen && <div className="docs-guide">{DOC_TYPES.map((type) => <div key={type.key} className={typeFilter === type.key ? 'active' : ''}>
        <span className={'docs-type-icon ' + type.tone} aria-hidden="true">{type.icon}</span>
        <p><b>{type.label}</b><small><em>{type.audience}.</em> {type.purpose}</small><small className="docs-guide-origin">{type.origin}</small></p>
      </div>)}</div>}
    </div>

    {actionError && !detail && <div className="form-error">⚠ {actionError}</div>}
    {state === 'demo' && <p className="muted docs-note">Vista de demostración: conecta el API para ver y entregar los documentos reales.</p>}
    {total > items.length && <p className="muted docs-note">Se muestran los {items.length} documentos más recientes de {total}.</p>}

    <div className="module-body docs-body">
      {state === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando documentos…</h3></div>}
      {state === 'error' && <div className="form-error">⚠ No se pudieron cargar los documentos. Revisa la conexión y vuelve a intentar.</div>}
      {(state === 'online' || state === 'demo') && items.length === 0 && <div className="result-empty panel docs-empty">
        <span>◌</span><h3>Todavía no hay documentos</h3>
        <p>Los PDF aparecen aquí en cuanto los generas: al <b>publicar un plan</b> en el Constructor, o desde el <b>expediente</b> con «Generar expediente».</p>
        <button type="button" className="primary" onClick={openGenerate}>Generar el primero</button>
      </div>}
      {items.length > 0 && visible.length === 0 && <div className="result-empty panel"><span>◌</span><h3>Ningún documento con esos filtros</h3><p>Prueba con otro tipo, estado o búsqueda.</p>{hasFilters && <button type="button" className="secondary" onClick={() => { setTypeFilter('all'); setStatusFilter('all'); setSearch(''); setPatientQuery('') }}>Quitar filtros</button>}</div>}

      {visible.length > 0 && (grouped
        ? <div className={'docs-split' + (mobileDetail ? ' show-detail' : '')}>
            <aside className="docs-patients panel" aria-label="Pacientes con documentos">
              <div className="docs-patients-search search-field">⌕ <input value={patientQuery} onChange={(event) => setPatientQuery(event.target.value)} placeholder="Buscar paciente o N.º de expediente…" aria-label="Buscar paciente" /></div>
              <p className="docs-patients-count">{patientGroups.length} paciente{patientGroups.length === 1 ? '' : 's'}{patientTerm ? ` de ${groups.length}` : ' con documentos'}</p>
              <div className="docs-patient-list">
                {patientGroups.length === 0 && <p className="muted docs-patients-empty">Ningún paciente coincide con «{patientQuery}».</p>}
                {patientGroups.map((group) => {
                  const pending = group.docs.filter((doc) => statusOf(doc) === 'pending').length
                  const active = selectedGroup?.patientId === group.patientId
                  return <button type="button" key={group.patientId} className={'docs-patient' + (active ? ' active' : '')} aria-current={active ? 'true' : undefined} onClick={() => selectPatient(group)}>
                    <span className="person-avatar coral">{(group.patient?.firstName?.[0] || '') + (group.patient?.lastName?.[0] || '')}</span>
                    <span className="docs-patient-text"><b>{group.name}</b><small>{[recordNumber(group.patient), `${group.docs.length} doc.`, `último ${dateLabel(new Date(group.latest).toISOString())}`].filter(Boolean).join(' · ')}</small></span>
                    {pending > 0 && <i className="docs-patient-badge" title={`${pending} por entregar o enviar`}>{pending}</i>}
                  </button>
                })}
              </div>
            </aside>

            <section className="docs-patient-detail panel" aria-label="Documentos del paciente">
              {!selectedGroup ? <div className="result-empty"><span>◌</span><h3>{selectedPatientId ? 'Este paciente no tiene documentos con estos filtros' : 'Elige un paciente'}</h3><p>{selectedPatientId ? 'Elige otro paciente de la lista o quita los filtros.' : 'Sus documentos aparecen aquí, ordenados por consulta y por plan.'}</p></div> : <>
                <header className="docs-detail-head">
                  <button type="button" className="link-button docs-back" onClick={() => setMobileDetail(false)}>← Pacientes</button>
                  <span className="person-avatar coral large-avatar">{(selectedGroup.patient?.firstName?.[0] || '') + (selectedGroup.patient?.lastName?.[0] || '')}</span>
                  <div className="docs-detail-title"><h2>{selectedGroup.name}</h2><small>{[recordNumber(selectedGroup.patient), `${selectedGroup.docs.length} documento${selectedGroup.docs.length === 1 ? '' : 's'}`, (() => { const n = selectedGroup.docs.filter((doc) => statusOf(doc) === 'pending').length; return n ? `${n} por entregar o enviar` : 'todo entregado' })()].filter(Boolean).join(' · ')}</small></div>
                  {isReal && selectedGroup.patient?.id && <div className="docs-detail-links"><button type="button" className="secondary" onClick={() => onOpenPatient?.(selectedGroup.patient.id, 'Expediente')}>Abrir expediente</button><button type="button" className="secondary" onClick={() => onOpenPatient?.(selectedGroup.patient.id, 'Constructor de plan')}>Ver planes</button></div>}
                </header>
                <div className="docs-origins">{originGroups.map((origin) => {
                  const present = new Set(origin.docs.map((doc) => doc.type))
                  const missing = !origin.isPlan && typeFilter === 'all' && statusFilter === 'all' ? ['consultation_report', 'consultation_clinical', 'consultation_export'].filter((key) => !present.has(key)) : []
                  const consultationStatus = origin.first.consultation?.status
                  return <div className={'docs-origin ' + (origin.isPlan ? 'plan' : 'consultation')} key={origin.key}>
                    <div className="docs-origin-head">
                      <span className={'docs-origin-dot ' + (origin.isPlan ? 'plan' : 'consultation')} aria-hidden="true" />
                      <div><b>{origin.isPlan ? (origin.first.plan ? originLabel(origin.first) : 'Plan eliminado') : `Consulta del ${dateLabel(origin.date)}`}</b><small>{origin.isPlan ? (origin.first.plan ? 'Plan de alimentación' : 'El plan ya no existe; el PDF se conserva') : consultationStatus === 'COMPLETED' ? 'Consulta cerrada' : consultationStatus ? 'Consulta en curso' : 'Consulta'}</small></div>
                      {isReal && (!origin.isPlan || origin.first.plan) && <button type="button" className="link-button" onClick={() => openSource(origin.first)}>{origin.isPlan ? 'Ir a sus planes →' : 'Abrir la consulta →'}</button>}
                    </div>
                    <div className="docs-rows">{origin.docs.map((doc) => renderRow(doc, { withPatient: false, compactOrigin: true }))}</div>
                    {missing.length > 0 && <p className="docs-missing">Falta: {missing.map((key) => TYPE_BY_KEY[key].label.toLowerCase()).join(missing.length === 2 ? ' y ' : ', ').replace(/, ([^,]*)$/, ' y $1')}{isReal && <> · <button type="button" className="link-button" onClick={() => openSource(origin.first)}>generarlo{missing.length > 1 ? 's' : ''} en la consulta →</button></>}</p>}
                  </div>
                })}</div>
              </>}
            </section>
          </div>
        : <div className="docs-list panel"><div className="docs-rows">{visible.map((doc) => renderRow(doc, { withPatient: true }))}</div></div>)}
    </div>
  </div>

  {detail && (() => {
    const type = TYPE_BY_KEY[detail.type] || { label: 'Documento', icon: '▤', tone: 'report', purpose: '', origin: '', audience: '' }
    const status = statusOf(detail)
    const steps = [
      ['Creado', detail.createdAt],
      [detail.version > 1 ? `PDF generado (versión ${detail.version})` : 'PDF generado', detail.generatedAt],
      ...(type.delivery ? [[type.delivery === 'professional' ? 'Enviado al profesional' : 'Entregado al paciente', detail.deliveredAt]] : []),
    ]
    const canRegenerate = detail.type !== 'nutrition_plan' || detail.plan?.status === 'PUBLISHED'
    return <div className="drawer-backdrop" onClick={() => setDetailId(null)}><aside className="patient-drawer docs-drawer" onClick={(event) => event.stopPropagation()} aria-label="Detalle del documento">
      <button type="button" className="drawer-close" onClick={() => setDetailId(null)} aria-label="Cerrar">×</button>
      <span className={'docs-type-icon large ' + type.tone} aria-hidden="true">{type.icon}</span>
      <p className="eyebrow">{(type.audience || '').toUpperCase()}</p>
      <h2>{type.label}{detail.version > 1 ? <i className="docs-version">PDF v{detail.version}</i> : null}</h2>
      <p className="muted">{patientName(detail)}{recordNumber(detail.patient) ? ` · ${recordNumber(detail.patient)}` : ''}</p>
      <span className={'docs-pill ' + status}>{statusText(detail, status)}</span>

      <div className="drawer-section"><p className="eyebrow">QUÉ ES</p><p>{type.purpose}</p><p className="muted">{type.origin}</p></div>
      <div className="drawer-section"><p className="eyebrow">DE DÓNDE SALIÓ</p><p>{originLabel(detail)}</p>{isReal && <button type="button" className="link-button" onClick={() => openSource(detail)}>{detail.type === 'nutrition_plan' ? 'Abrir los planes del paciente →' : 'Abrir esta consulta en el expediente →'}</button>}</div>
      <div className="drawer-section"><p className="eyebrow">HISTORIAL</p>
        <ol className="docs-timeline">{steps.map(([label, at]) => <li key={label} className={at ? 'done' : ''}><b>{label}</b><small>{at ? dateTimeLabel(at) : 'Pendiente'}</small></li>)}</ol>
      </div>
      {actionError && <div className="form-error">⚠ {actionError}</div>}
      <div className="docs-drawer-actions">
        {detail.storageKey && <button type="button" className="primary" onClick={() => openDocument(detail)}>Ver PDF</button>}
        {detail.storageKey && <button type="button" className="secondary" disabled={!isReal || isBusy(detail, 'download')} onClick={() => run(detail, 'download')}>{isBusy(detail, 'download') ? 'Descargando…' : 'Descargar PDF'}</button>}
        {status === 'pending' && <button type="button" className="secondary" disabled={!isReal || isBusy(detail, 'deliver')} onClick={() => run(detail, 'deliver')}>{isBusy(detail, 'deliver') ? 'Guardando…' : deliverText(detail)}</button>}
        {canRegenerate && <button type="button" className="secondary" disabled={!isReal || isBusy(detail, 'generate')} onClick={() => run(detail, 'generate')} title="Vuelve a armar el PDF con los datos actuales; queda como una versión nueva">{isBusy(detail, 'generate') ? 'Generando…' : detail.storageKey ? 'Actualizar con los datos actuales' : 'Generar PDF'}</button>}
        {status === 'delivered' && <button type="button" className="link-button" disabled={!isReal || isBusy(detail, 'undeliver')} onClick={() => { if (window.confirm('¿Quitar la marca de entregado de este documento?')) run(detail, 'undeliver') }}>Deshacer entrega</button>}
      </div>
      {type.delivery && <p className="muted docs-drawer-note">El envío por WhatsApp o correo todavía se hace fuera de la app: descarga el PDF, envíalo y márcalo aquí.</p>}
    </aside></div>
  })()}

  {preview && (() => {
    const type = TYPE_BY_KEY[preview.type] || { label: 'Documento' }
    const status = statusOf(preview)
    return <PdfPreviewModal
      title={`${type.label}${preview.version > 1 ? ` · PDF v${preview.version}` : ''}`}
      subtitle={[patientName(preview), originLabel(preview), statusText(preview, status) + (status === 'delivered' ? ` · ${dateLabel(preview.deliveredAt)}` : '')].join(' · ')}
      loadBlob={loadPreview}
      onClose={() => setPreviewId(null)}
      position={previewIndex >= 0 ? `${previewIndex + 1} de ${previewable.length}` : ''}
      onPrev={previewIndex > 0 ? () => setPreviewId(previewable[previewIndex - 1].id) : undefined}
      onNext={previewIndex >= 0 && previewIndex < previewable.length - 1 ? () => setPreviewId(previewable[previewIndex + 1].id) : undefined}
      actions={<>
        {actionError && <span className="pdf-preview-error" title={actionError}>⚠ {actionError}</span>}
        {status === 'pending' && <button type="button" className="secondary" disabled={!isReal || isBusy(preview, 'deliver')} onClick={() => run(preview, 'deliver')}>{isBusy(preview, 'deliver') ? 'Guardando…' : deliverText(preview)}</button>}
        <button type="button" className="secondary" onClick={() => { setPreviewId(null); setDetailId(preview.id) }}>ⓘ Detalles</button>
        <button type="button" className="primary" disabled={!isReal || isBusy(preview, 'download')} onClick={() => run(preview, 'download')}>{isBusy(preview, 'download') ? '…' : '⤓ Descargar'}</button>
      </>}
    />
  })()}

  {genOpen && <div className="modal-backdrop" onClick={() => setGenOpen(false)}><div className="modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">NUEVO DOCUMENTO</p><h2>Generar documento</h2><span className="modal-subtitle">Los PDF se arman con el plan o la consulta del paciente: elige a quién y qué necesitas, y te llevamos ahí.</span></div><button type="button" aria-label="Cerrar" onClick={() => setGenOpen(false)}>×</button></div>
    <label>Paciente<select value={genForm.patientId} onChange={(event) => setGenForm((prev) => ({ ...prev, patientId: event.target.value }))}><option value="">{genPatients ? 'Selecciona…' : 'Cargando pacientes…'}</option>{(genPatients || []).map((p) => <option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select></label>
    <div className="docs-gen-options">
      <label className={genForm.kind === 'plan' ? 'active' : ''}><input type="radio" name="gen-kind" checked={genForm.kind === 'plan'} onChange={() => setGenForm((prev) => ({ ...prev, kind: 'plan' }))} /><span className="docs-type-icon plan" aria-hidden="true">▦</span><span><b>Plan de alimentación</b><small>En el Constructor, el paso Guardar publica el plan y genera su PDF.</small></span></label>
      <label className={genForm.kind === 'report' ? 'active' : ''}><input type="radio" name="gen-kind" checked={genForm.kind === 'report'} onChange={() => setGenForm((prev) => ({ ...prev, kind: 'report' }))} /><span className="docs-type-icon report" aria-hidden="true">▤</span><span><b>Informe, informe clínico o expediente</b><small>En el expediente, el botón «Generar expediente» arma cualquiera de los tres.</small></span></label>
    </div>
    <div className="modal-actions"><button type="button" className="secondary" onClick={() => setGenOpen(false)}>Cancelar</button><button type="button" className="primary" disabled={!genForm.patientId} onClick={goGenerate}>Continuar <span>→</span></button></div>
  </div></div>}
  </AppChrome>
}
