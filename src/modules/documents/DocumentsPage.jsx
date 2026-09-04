import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { documentsApi } from '../../lib/api.js'

const TYPE_FILTERS = [['all', 'Todos'], ['consultation_report', 'Informes'], ['consultation_export', 'Expedientes'], ['nutrition_plan', 'Planes']]
const DOC_TYPE_LABELS = { consultation_report: 'Informe de consulta', consultation_export: 'Expediente completo', nutrition_plan: 'Plan de alimentación' }
const DOC_SUBTYPE_LABELS = { consultation_report: 'Informe clínico', consultation_export: 'Expediente clínico', nutrition_plan: 'Menú semanal' }

const FALLBACK = [
  ['Informe de consulta', 'Mariana Torres', '26 ago 2026', 'Informe clínico', 'Generado', 'confirmed'],
  ['Plan de alimentación', 'Ana Rodríguez', '25 ago 2026', 'Menú semanal', 'Enviado por WhatsApp', 'confirmed'],
  ['Informe de consulta', 'Diego Ramírez', '18 ago 2026', 'Informe clínico', 'Pendiente de envío', 'pending'],
]

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX') : 'Sin generar')

const rowFor = (item) => [
  DOC_TYPE_LABELS[item.type] || 'Documento',
  `${item.patient?.firstName || ''} ${item.patient?.lastName || ''}`.trim() || 'Paciente',
  formatDate(item.generatedAt),
  DOC_SUBTYPE_LABELS[item.type] || item.type,
  item.deliveredAt ? 'Entregado' : item.generatedAt ? 'Generado' : 'Pendiente',
  item.deliveredAt || item.generatedAt ? 'confirmed' : 'pending',
]

export default function DocumentsPage({ setActive }) {
  const [items, setItems] = useState([])
  const [state, setState] = useState('loading')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState(null)
  const [detailState, setDetailState] = useState('idle')
  const [detailError, setDetailError] = useState('')

  useEffect(() => {
    documentsApi.list()
      .then((response) => { setItems(response.items || []); setState('online') })
      .catch(() => { setItems([]); setState('demo') })
  }, [])

  const filteredItems = items.filter((item) => typeFilter === 'all' || item.type === typeFilter)
  const rows = state === 'demo' ? FALLBACK : filteredItems.map(rowFor)
  const allRows = state === 'demo' ? FALLBACK : items.map(rowFor)
  const visibleRows = rows.filter((row) => row[0].toLowerCase().includes(search.toLowerCase()) || row[1].toLowerCase().includes(search.toLowerCase()))

  const openDetail = (item) => { setDetail(item); setDetailState('idle'); setDetailError('') }

  const downloadPdf = async () => {
    if (!detail?.storageKey) return
    setDetailState('working')
    setDetailError('')
    try {
      const blob = await documentsApi.downloadBlob(detail.id)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = detail.storageKey
      link.click()
      URL.revokeObjectURL(url)
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
    <ModuleHeader eyebrow="DOCUMENTOS · ARCHIVOS CLÍNICOS" title="Documentos" subtitle="Informes y planes vinculados a tus pacientes." action={<div className="module-actions"><span className={'sync-label ' + state}>● {state === 'online' ? 'Sincronizados' : 'Vista demo'}</span><button className="primary" onClick={() => setActive('Documento')}><span>+</span> Generar documento</button></div>} />

    <div className="document-stats">
      <div className="panel"><span className="stat-icon mint">▣</span><div><b>{allRows.length}</b><small>Documentos disponibles</small></div></div>
      <div className="panel"><span className="stat-icon orange">↗</span><div><b>{allRows.filter((x) => x[4].includes('Pendiente')).length}</b><small>Pendientes de envío</small></div></div>
      <div className="panel"><span className="stat-icon purple">✓</span><div><b>{allRows.filter((x) => x[4].includes('Generado') || x[4].includes('Entregado')).length}</b><small>Generados</small></div></div>
    </div>

    <div className="documents-toolbar panel">
      <div className="search-field">⌕ <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por paciente o documento..." /></div>
      <div className="view-switch">{TYPE_FILTERS.map(([key, label]) => <button key={key} className={typeFilter === key ? 'selected' : ''} onClick={() => setTypeFilter(key)}>{label}</button>)}</div>
    </div>

    <div className="documents-table panel">
      <div className="documents-head"><span>Documento</span><span>Paciente</span><span>Fecha</span><span>Estado</span><span /></div>
      {visibleRows.map((row, i) => {
        const item = state === 'demo' ? null : filteredItems[i]
        return <div className="documents-row" key={row[0] + row[1] + i} onClick={() => item && openDetail(item)} style={{ cursor: item ? 'pointer' : 'default' }}>
          <span className="document-name"><i>▤</i><span><b>{row[0]}</b><small>{row[3]}</small></span></span>
          <span className="muted">{row[1]}</span>
          <span className="muted">{row[2]}</span>
          <span className={'status ' + (row[5] === 'confirmed' ? 'confirmed' : 'pending')}>{row[4]}</span>
          <button className="row-arrow" onClick={(e) => { e.stopPropagation(); item && openDetail(item) }}>→</button>
        </div>
      })}
      {visibleRows.length === 0 && <div className="result-empty"><span>◌</span><h3>Sin documentos con esos filtros</h3><p>Ajusta la búsqueda o el filtro de tipo.</p></div>}
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
  </AppChrome>
}