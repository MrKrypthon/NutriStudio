import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { documentsApi, patientsApi } from '../../lib/api.js'
import { planFileName } from '../../../server/domain/pdfTheme.js'
import { saveBlob } from '../../lib/download.js'

const TYPE_FILTERS = [['all', 'Todos'], ['consultation_report', 'Informes'], ['consultation_export', 'Expedientes'], ['nutrition_plan', 'Planes']]
const DOC_TYPE_LABELS = { consultation_report: 'Informe de consulta', consultation_export: 'Expediente completo', nutrition_plan: 'Plan de alimentación' }
const DOC_SUBTYPE_LABELS = { consultation_report: 'Informe clínico', consultation_export: 'Expediente clínico', nutrition_plan: 'Menú semanal' }

const FALLBACK = [
  ['Informe de consulta', 'Mariana Torres', '26 ago 2026', 'Informe clínico', 'Generado', 'confirmed'],
  ['Plan de alimentación', 'Ana Rodríguez', '25 ago 2026', 'Menú semanal', 'Enviado por WhatsApp', 'confirmed'],
  ['Informe de consulta', 'Diego Ramírez', '18 ago 2026', 'Informe clínico', 'Pendiente de envío', 'pending'],
]

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX') : 'Sin generar')
const DOWNLOAD_TITLES = { consultation_report: 'Informe de consulta', consultation_export: 'Expediente', nutrition_plan: 'Plan de alimentación' }
// Mismo nombre legible que da el servidor ("Informe de consulta - Paciente - fecha.pdf"), en vez del
// nombre interno del archivo (<id>-v<n>.pdf).
const downloadName = (doc) => {
  const name = doc.patient ? `${doc.patient.firstName} ${doc.patient.lastName}` : ''
  const date = doc.type === 'nutrition_plan' ? (doc.plan?.publishedAt || doc.generatedAt || new Date()) : (doc.generatedAt || new Date())
  return planFileName(name, date).replace('Plan de alimentación', DOWNLOAD_TITLES[doc.type] || 'Documento')
}

const rowFor = (item) => [
  DOC_TYPE_LABELS[item.type] || 'Documento',
  `${item.patient?.firstName || ''} ${item.patient?.lastName || ''}`.trim() || 'Paciente',
  formatDate(item.generatedAt),
  DOC_SUBTYPE_LABELS[item.type] || item.type,
  item.deliveredAt ? 'Entregado' : item.generatedAt ? 'Generado' : 'Pendiente',
  item.deliveredAt || item.generatedAt ? 'confirmed' : 'pending',
]

export default function DocumentsPage({ setActive, onOpenPatient }) {
  const [items, setItems] = useState([])
  const [state, setState] = useState('loading')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailState, setDetailState] = useState('idle')
  const [detailError, setDetailError] = useState('')
  // "Generar documento": los PDF salen de un plan (Constructor, paso Guardar) o de una consulta
  // (Expediente), así que primero se elige paciente y tipo. Antes abría el generador sin paciente y
  // sólo podía mostrar "no se pudo cargar".
  const [genOpen, setGenOpen] = useState(false)
  const [genPatients, setGenPatients] = useState(null)
  const [genForm, setGenForm] = useState({ patientId: '', kind: 'plan' })
  const openGenerate = () => {
    setGenForm({ patientId: '', kind: 'plan' }); setGenOpen(true)
    if (!genPatients) patientsApi.list('?status=ACTIVE&pageSize=500').then((payload) => setGenPatients(payload.items || [])).catch(() => setGenPatients([]))
  }
  const goGenerate = () => { if (genForm.patientId) onOpenPatient?.(genForm.patientId, genForm.kind === 'plan' ? 'Constructor de plan' : 'Expediente') }

  useEffect(() => {
    documentsApi.list()
      .then((response) => { setItems(response.items || []); setState('online') })
      // Sólo sin API (modo demostración) se muestran los ejemplos; si el API falla, se dice: antes
      // un error mostraba documentos inventados como si fueran reales.
      .catch((error) => { setItems([]); setState(error.code === 'DEMO_MODE' ? 'demo' : 'error') })
  }, [])

  const filteredItems = items.filter((item) => typeFilter === 'all' || item.type === typeFilter)
  const query = search.trim().toLowerCase()
  // Search applies to the real items (not to rendered rows) so each visible row keeps a correct
  // reference to its source document. Before, rows were filtered by index and clicking after a
  // search opened the WRONG document.
  const visibleItems = state === 'demo' ? [] : filteredItems.filter((item) => {
    const docLabel = (DOC_TYPE_LABELS[item.type] || '').toLowerCase()
    const patientLabel = `${item.patient?.firstName || ''} ${item.patient?.lastName || ''}`.toLowerCase()
    return !query || docLabel.includes(query) || patientLabel.includes(query)
  })
  const visibleRows = state === 'demo' ? FALLBACK.filter((row) => row[0].toLowerCase().includes(query) || row[1].toLowerCase().includes(query)) : visibleItems.map(rowFor)
  const allRows = state === 'demo' ? FALLBACK : items.map(rowFor)

  const openDetail = (item) => { setDetail(item); setDetailState('idle'); setDetailError('') }

  const downloadPdf = async () => {
    if (!detail?.storageKey) return
    setDetailState('working')
    setDetailError('')
    try {
      const blob = await documentsApi.downloadBlob(detail.id)
      saveBlob(blob, downloadName(detail))
      setDetailState('idle')
    } catch (error) {
      setDetailState('error')
      setDetailError(error.message || 'No se pudo descargar el documento.')
    }
  }

  const markDelivered = async () => {
    if (!detail) return
    setDetailState('working')
    setDetailError('')
    try {
      const updated = await documentsApi.deliver(detail.id)
      setDetail(updated)
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setDetailState('idle')
    } catch (error) {
      setDetailState('error')
      setDetailError(error.message || 'No se pudo registrar la entrega.')
    }
  }

  const detailRow = detail ? rowFor(detail) : null

  return <AppChrome active="Documentos" setActive={setActive}><div className="content documents-content">
    <ModuleHeader eyebrow="DOCUMENTOS · ARCHIVOS CLÍNICOS" title="Documentos" subtitle="Informes y planes vinculados a tus pacientes." action={<div className="module-actions"><span className={'sync-label ' + (state === 'error' ? 'demo' : state)}>● {state === 'online' ? 'Sincronizados' : state === 'loading' ? 'Cargando…' : state === 'error' ? 'Sin conexión' : 'Vista demo'}</span><button className="primary" onClick={openGenerate}><span>+</span> Generar documento</button></div>} />

    <div className="document-stats">
      <div className="panel"><span className="stat-icon mint">▣</span><div><b>{allRows.length}</b><small>Documentos disponibles</small></div></div>
      <div className="panel"><span className="stat-icon orange">↗</span><div><b>{allRows.filter((x) => x[4] !== 'Entregado').length}</b><small>Pendientes de envío</small></div></div>
      <div className="panel"><span className="stat-icon purple">✓</span><div><b>{allRows.filter((x) => x[4] === 'Entregado').length}</b><small>Entregados</small></div></div>
    </div>

    <div className="documents-toolbar panel">
      <div className="search-field">⌕ <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por paciente o documento..." /></div>
      <div className="view-switch">{TYPE_FILTERS.map(([key, label]) => <button key={key} className={typeFilter === key ? 'selected' : ''} onClick={() => setTypeFilter(key)}>{label}</button>)}</div>
    </div>

    <div className="documents-table panel">
      <div className="documents-head"><span>Documento</span><span>Paciente</span><span>Fecha</span><span>Estado</span><span /></div>
      {state === 'demo'
        ? visibleRows.map((row, i) => <div className="documents-row" key={i} style={{ cursor: 'default' }}>
            <span className="document-name"><i>▤</i><span><b>{row[0]}</b><small>{row[3]}</small></span></span>
            <span className="muted">{row[1]}</span>
            <span className="muted">{row[2]}</span>
            <span className={'status ' + (row[5] === 'confirmed' ? 'confirmed' : 'pending')}>{row[4]}</span>
            <span className="row-arrow">→</span>
          </div>)
        : visibleItems.map((item) => {
            const row = rowFor(item)
            return <div className="documents-row" key={item.id} onClick={() => openDetail(item)} style={{ cursor: 'pointer' }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(item) } }}>
              <span className="document-name"><i>▤</i><span><b>{row[0]}</b><small>{row[3]}</small></span></span>
              <span className="muted">{row[1]}</span>
              <span className="muted">{row[2]}</span>
              <span className={'status ' + (row[5] === 'confirmed' ? 'confirmed' : 'pending')}>{row[4]}</span>
              <button className="row-arrow" aria-label={`Ver ${row[0]} de ${row[1]}`} onClick={(e) => { e.stopPropagation(); openDetail(item) }}>→</button>
            </div>
          })}
      {state === 'loading' && <div className="result-empty"><span className="loading-dot">●</span><h3>Cargando documentos…</h3></div>}
      {state === 'error' && <div className="form-error">⚠ No se pudieron cargar los documentos. Revisa la conexión y vuelve a intentar.</div>}
      {(state === 'online' || state === 'demo') && visibleRows.length === 0 && <div className="result-empty"><span>◌</span><h3>Sin documentos con esos filtros</h3><p>Ajusta la búsqueda o el filtro de tipo.</p></div>}
    </div>
  </div>

  {detail && detailRow && <div className="modal-backdrop" onClick={() => setDetail(null)}><div className="modal" onClick={(e) => e.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">DOCUMENTO · {detail.type === 'nutrition_plan' ? 'PLAN' : detail.type === 'consultation_export' ? 'EXPEDIENTE' : 'INFORME'}</p><h2>{detailRow[0]}</h2><span className="modal-subtitle">{detail.patient ? `Paciente: ${detail.patient.firstName} ${detail.patient.lastName}` : 'Documento'}</span></div><button onClick={() => setDetail(null)}>×</button></div>
    <div className="document-detail">
      <div><span>Tipo</span><b>{detailRow[3]}</b></div>
      <div><span>Generado</span><b>{detailRow[2]}</b></div>
      <div><span>Versión</span><b>v{detail.version ?? '—'}</b></div>
      <div><span>Estado</span><b className={'status ' + (detailRow[5] === 'confirmed' ? 'confirmed' : 'pending')}>{detailRow[4]}</b></div>
      {detail.deliveredAt && <div><span>Entregado</span><b>{formatDate(detail.deliveredAt)}</b></div>}
    </div>
    {detailError && <div className="form-error">⚠ {detailError}</div>}
    <div className="modal-actions">
      <button type="button" className="secondary" onClick={() => setDetail(null)}>Cerrar</button>
      {detail.deliveredAt
        ? <p className="muted">✓ Entregado. El envío por WhatsApp/email todavía se hace fuera de la app.</p>
        : <button className="secondary" disabled={detailState === 'working'} onClick={markDelivered}>{detailState === 'working' ? 'Registrando…' : 'Marcar como entregado'}</button>}
      {detail.storageKey
        ? <button className="primary" disabled={detailState === 'working'} onClick={downloadPdf}>{detailState === 'working' ? '…' : 'Descargar PDF'} <span>→</span></button>
        : <p className="muted">Todavía no se genera el PDF.</p>}
    </div>
  </div></div>}

  {genOpen && <div className="modal-backdrop" onClick={() => setGenOpen(false)}><div className="modal" onClick={(e) => e.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">NUEVO DOCUMENTO</p><h2>Generar documento</h2><span className="modal-subtitle">El PDF se arma con el plan o la consulta del paciente.</span></div><button type="button" aria-label="Cerrar" onClick={() => setGenOpen(false)}>×</button></div>
    <label>Paciente<select value={genForm.patientId} onChange={(e) => setGenForm((prev) => ({ ...prev, patientId: e.target.value }))}><option value="">{genPatients ? 'Selecciona…' : 'Cargando pacientes…'}</option>{(genPatients || []).map((p) => <option value={p.id} key={p.id}>{p.firstName} {p.lastName}</option>)}</select></label>
    <div className="notify-options" style={{ margin: '12px 0' }}>
      <label><input type="radio" name="gen-kind" checked={genForm.kind === 'plan'} onChange={() => setGenForm((prev) => ({ ...prev, kind: 'plan' }))} /> Plan de alimentación</label>
      <label><input type="radio" name="gen-kind" checked={genForm.kind === 'report'} onChange={() => setGenForm((prev) => ({ ...prev, kind: 'report' }))} /> Informe o expediente de consulta</label>
    </div>
    <p className="muted">{genForm.kind === 'plan' ? 'Te llevamos al constructor del plan: en el paso Guardar se publica y se genera el PDF.' : 'Te llevamos al expediente: el botón «Generar expediente» arma el informe para el paciente, el informe clínico o el expediente completo.'}</p>
    <div className="modal-actions"><button type="button" className="secondary" onClick={() => setGenOpen(false)}>Cancelar</button><button type="button" className="primary" disabled={!genForm.patientId} onClick={goGenerate}>Continuar <span>→</span></button></div>
  </div></div>}
  </AppChrome>
}