import { useEffect, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { educationApi } from '../../lib/api.js'
import { saveBlob } from '../../lib/download.js'

const CATEGORY_COLORS = { 'Guías prácticas': 'mint', 'Material para paciente': 'yellow', 'Hábitos saludables': 'blue', 'Infografía': 'coral', 'Guía de consulta': 'purple' }

const FALLBACK = [
  { id: 'demo-1', title: 'Método visual de porciones', category: 'Guías prácticas', description: 'Aprende a estimar porciones sin báscula usando tus manos y utensilios.', body: 'Una palma abierta equivale aproximadamente a una porción de proteína; un puño, a una porción de verdura o fruta; una mano ahuecada, a una porción de cereal.', color: 'mint', readMinutes: 8 },
  { id: 'demo-2', title: 'Leer etiquetas nutricionales', category: 'Material para paciente', description: 'Identifica azúcares añadidos, fibra y tamaños de porción.', body: 'Revisa siempre el tamaño de porción antes que cualquier otro dato, y busca "azúcares añadidos" en la tabla de nutrientes.', color: 'yellow', readMinutes: 5 },
  { id: 'demo-3', title: 'Ideas para aumentar el agua', category: 'Hábitos saludables', description: 'Estrategias simples para mantener una hidratación constante.', body: 'Ten siempre una botella visible, asocia un vaso de agua a cada comida y usa una app o recordatorio si te cuesta recordarlo.', color: 'blue', readMinutes: 4 },
  { id: 'demo-4', title: 'Plato balanceado', category: 'Infografía', description: 'Una guía visual para construir comidas completas.', body: 'La mitad del plato con verduras, un cuarto con proteína y un cuarto con cereal integral o tubérculo.', color: 'coral', readMinutes: 3 },
]

export default function EducationPage({ setActive, onSelectMaterial }) {
  const [items, setItems] = useState(FALLBACK)
  const [status, setStatus] = useState('loading')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  // Categorías para el filtro: se acumulan de todos los listados (el backend filtra por categoría,
  // así que derivarlas de `items` dejaba el <select> atrapado en la categoría elegida).
  const [categoryOptions, setCategoryOptions] = useState(() => [...new Set(FALLBACK.map((item) => item.category))])
  const [detail, setDetail] = useState(null)
  const [archiveState, setArchiveState] = useState('idle')
  const [archiveError, setArchiveError] = useState('')
  const [shareState, setShareState] = useState('idle')
  const [sharedId, setSharedId] = useState(null)
  const [attachState, setAttachState] = useState('idle')
  const [removeState, setRemoveState] = useState('idle')
  const [attachError, setAttachError] = useState('')
  const fileInputRef = useRef(null)

  const load = () => {
    setStatus('loading')
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (category) params.set('category', category)
    const query = params.toString() ? `?${params}` : ''
    educationApi.list(query)
      .then((response) => { const list = response.items || []; setItems(list); setStatus('online'); setCategoryOptions((prev) => [...new Set([...prev, ...list.map((item) => item.category).filter(Boolean)])]) })
      .catch((error) => { if (error.code === 'DEMO_MODE') setStatus('demo'); else { setItems([]); setStatus('error') } })
  }

  useEffect(() => {
    const timer = setTimeout(load, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category])

  const isReal = status === 'online'

  const startCreate = () => { onSelectMaterial?.(null); setActive('Nuevo material') }
  const startEdit = (material) => { if (!isReal) return; onSelectMaterial?.(material.id); setActive('Editar material') }

  // Copia el material para pegarlo en WhatsApp o un correo. El aviso aparece en el botón que se usó
  // (tarjeta o detalle): antes, desde la tarjeta, no había ninguna señal de que se hubiera copiado.
  const share = async (material) => {
    setShareState('copying'); setSharedId(material.id)
    try {
      await navigator.clipboard.writeText(`${material.title}\n\n${material.body}`)
      setShareState('copied')
    } catch { setShareState('error') }
    setTimeout(() => { setShareState('idle'); setSharedId(null) }, 2200)
  }
  const shareLabel = (material, idle) => (sharedId !== material.id ? idle : shareState === 'copied' ? '✓ Copiado' : shareState === 'error' ? 'No se pudo copiar' : idle)
  const openDetail = (material) => { setDetail(material); setArchiveError(''); setAttachError(''); setArchiveState('idle') }

  const archive = async (material) => {
    if (!isReal) return
    if (!window.confirm(`¿Archivar "${material.title}"? Dejará de aparecer en la biblioteca.`)) return
    setArchiveState('archiving')
    setArchiveError('')
    try { await educationApi.archive(material.id); setArchiveState('idle'); setDetail(null); load() }
    catch { setArchiveState('error'); setArchiveError('No se pudo archivar el material. Intenta de nuevo.') }
  }

  const onPickFile = (e) => {
    const file = e.target.files && e.target.files[0]
    // Limpiar siempre (antes del `return`): reintentar con el MISMO archivo debe volver a disparar change.
    e.target.value = ''
    if (!file) return
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
    if (!allowed.includes(file.type)) { setAttachError('Solo se admiten archivos PDF, PNG, JPG y WebP.'); return }
    if (file.size > 10 * 1024 * 1024) { setAttachError('El archivo no puede pesar más de 10 MB.'); return }
    const reader = new FileReader()
    reader.onload = async () => {
      setAttachState('uploading')
      setAttachError('')
      try {
        const updated = await educationApi.attach(detail.id, file.name, reader.result)
        setDetail(updated)
        setAttachState('idle')
        load()
      } catch (error) { setAttachState('idle'); setAttachError(error.message || 'No se pudo subir el archivo.') }
    }
    reader.readAsDataURL(file)
  }

  const downloadAttachment = async () => {
    if (!detail?.attachmentStorageKey) return
    setAttachState('downloading')
    try {
      const blob = await educationApi.downloadAttachmentBlob(detail.id)
      saveBlob(blob, detail.attachmentFileName || 'material')
      setAttachState('idle')
    } catch (error) { setAttachState('idle'); setAttachError(error.message || 'No se pudo descargar el archivo.') }
  }

  const removeAttachment = async () => {
    if (!detail?.attachmentStorageKey) return
    if (!window.confirm(`¿Quitar el archivo "${detail.attachmentFileName}" de este material?`)) return
    setRemoveState('removing'); setAttachError('')
    try {
      const updated = await educationApi.removeAttachment(detail.id)
      setDetail(updated)
      setRemoveState('idle')
      load()
    } catch (error) { setRemoveState('idle'); setAttachError(error.message || 'No se pudo quitar el archivo.') }
  }

  return <AppChrome active="Educación" setActive={setActive}><div className="content education-content">
    <ModuleHeader eyebrow={`BIBLIOTECA · ${items.length} MATERIALES`} title="Educación nutricional" subtitle="Materiales que puedes compartir para acompañar el cambio de hábitos." action={<div className="module-actions"><span className={'sync-label ' + (status === 'online' ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'online' ? 'Sincronizado' : status === 'loading' ? 'Cargando…' : status === 'error' ? 'Sin conexión' : 'Vista demo'}</span><button className="primary" onClick={startCreate}><span>+</span> Nuevo material</button></div>} />

    <div className="education-toolbar panel">
      <div className="search-field">⌕ <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar material..." /></div>
      <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Todas las categorías</option>{categoryOptions.map((c) => <option value={c} key={c}>{c}</option>)}</select>
    </div>

    {status === 'error' && <div className="form-error">⚠ No se pudieron cargar los materiales. Revisa la conexión y vuelve a intentar.</div>}
    {status !== 'loading' && status !== 'error' && items.length === 0 && <div className="result-empty panel"><span>◌</span><h3>No hay materiales con esos filtros</h3><p>Ajusta la búsqueda o crea un material nuevo.</p></div>}

    <div className="education-grid">{items.map((material) => <article className="education-card panel" key={material.id}>
      <button type="button" className="education-cover-button" onClick={() => openDetail(material)} aria-label={`Ver ${material.title}`}>
        <div className={'education-cover ' + (material.color || CATEGORY_COLORS[material.category] || 'mint')}><span>✦</span><small>{material.attachmentStorageKey ? (material.attachmentMime === 'application/pdf' ? 'PDF' : 'IMG') : 'TEXTO'}</small></div>
      </button>
      <div className="education-body">
        <span className="recipe-meal">{material.category}</span>
        <h3>{material.title}</h3>
        <p>{material.description}</p>
        <div><small>Lectura · {material.readMinutes} min{material.attachmentStorageKey ? ' · 📎 con adjunto' : ''}</small><button onClick={() => share(material)}>{shareLabel(material, 'Compartir ↗')}</button></div>
      </div>
    </article>)}</div>

    {detail && <div className="modal-backdrop" onClick={() => setDetail(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{detail.title}</h2><button onClick={() => setDetail(null)}>×</button></div>
        <span className="recipe-meal">{detail.category} · {detail.readMinutes} min</span>
        <p className="muted" style={{ margin: '14px 0' }}>{detail.description}</p>
        <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{detail.body}</p>
        {isReal && <div className="material-attachment">
          <b>Archivo adjunto</b>
          {detail.attachmentStorageKey
            ? <div className="attachment-control">
                <span>{detail.attachmentFileName} · {(detail.attachmentFileSize / 1024).toFixed(0)} KB</span>
                <button className="link-button" onClick={downloadAttachment} disabled={attachState === 'downloading'}>{attachState === 'downloading' ? '…' : 'Descargar'}</button>
                <button className="link-button" onClick={removeAttachment} disabled={removeState === 'removing'}>{removeState === 'removing' ? '…' : 'Quitar'}</button>
              </div>
            : <button className="secondary" onClick={() => fileInputRef.current?.click()} disabled={attachState === 'uploading'}>{attachState === 'uploading' ? 'Subiendo…' : 'Adjuntar archivo'}</button>}
          <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" hidden onChange={onPickFile} />
          {attachError && <span className="form-error" style={{ display: 'block' }}>⚠ {attachError}</span>}
        </div>}
        <div className="modal-actions">
          {archiveError && <span className="form-error" style={{ display: 'block', width: '100%' }}>⚠ {archiveError}</span>}
          {isReal && <button className="secondary" disabled={archiveState === 'archiving'} onClick={() => archive(detail)}>{archiveState === 'archiving' ? 'Archivando…' : 'Archivar'}</button>}
          {isReal && <button className="secondary" onClick={() => startEdit(detail)}>Editar</button>}
          <button className="primary" onClick={() => share(detail)}>{shareLabel(detail, 'Copiar contenido')}</button>
        </div>
      </div>
    </div>}
  </div></AppChrome>
}
