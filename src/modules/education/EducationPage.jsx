import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { educationApi } from '../../lib/api.js'

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
  const [detail, setDetail] = useState(null)
  const [archiveState, setArchiveState] = useState('idle')
  const [shareState, setShareState] = useState('idle')

  const load = () => {
    setStatus('loading')
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (category) params.set('category', category)
    const query = params.toString() ? `?${params}` : ''
    educationApi.list(query)
      .then((response) => { setItems(response.items || []); setStatus('online') })
      .catch(() => setStatus('demo'))
  }

  useEffect(() => {
    const timer = setTimeout(load, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category])

  const categoryOptions = [...new Set(items.map((item) => item.category))]
  const isReal = status === 'online'

  const startCreate = () => { onSelectMaterial?.(null); setActive('Nuevo material') }
  const startEdit = (material) => { if (!isReal) return; onSelectMaterial?.(material.id); setActive('Editar material') }

  const share = async (material) => {
    setShareState('copying')
    try {
      await navigator.clipboard.writeText(`${material.title}\n\n${material.body}`)
      setShareState('copied')
      setTimeout(() => setShareState('idle'), 1800)
    } catch { setShareState('error') }
  }

  const archive = async (material) => {
    if (!isReal) return
    setArchiveState('archiving')
    try { await educationApi.archive(material.id); setArchiveState('idle'); setDetail(null); load() }
    catch { setArchiveState('error') }
  }

  return <AppChrome active="Educación" setActive={setActive}><div className="content education-content">
    <ModuleHeader eyebrow={`BIBLIOTECA · ${items.length} MATERIALES`} title="Educación nutricional" subtitle="Materiales que puedes compartir para acompañar el cambio de hábitos." action={<div className="module-actions"><span className={'sync-label ' + (status === 'online' ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'online' ? 'Sincronizado' : status === 'loading' ? 'Cargando…' : 'Vista demo'}</span><button className="primary" onClick={startCreate}><span>+</span> Nuevo material</button></div>} />

    <div className="education-toolbar panel">
      <div className="search-field">⌕ <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar material..." /></div>
      <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Todas las categorías</option>{categoryOptions.map((c) => <option value={c} key={c}>{c}</option>)}</select>
    </div>

    {status !== 'loading' && items.length === 0 && <div className="result-empty panel"><span>◌</span><h3>No hay materiales con esos filtros</h3><p>Ajusta la búsqueda o crea un material nuevo.</p></div>}

    <div className="education-grid">{items.map((material) => <article className="education-card panel" key={material.id}>
      <button type="button" className="education-cover-button" onClick={() => setDetail(material)}>
        <div className={'education-cover ' + (material.color || CATEGORY_COLORS[material.category] || 'mint')}><span>✦</span><small>PDF</small></div>
      </button>
      <div className="education-body">
        <span className="recipe-meal">{material.category}</span>
        <h3>{material.title}</h3>
        <p>{material.description}</p>
        <div><small>Lectura · {material.readMinutes} min</small><button onClick={() => share(material)}>Compartir ↗</button></div>
      </div>
    </article>)}</div>

    {detail && <div className="modal-backdrop" onClick={() => setDetail(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{detail.title}</h2><button onClick={() => setDetail(null)}>×</button></div>
        <span className="recipe-meal">{detail.category} · {detail.readMinutes} min</span>
        <p className="muted" style={{ margin: '14px 0' }}>{detail.description}</p>
        <p style={{ fontSize: 12, lineHeight: 1.6, color: '#45564d', whiteSpace: 'pre-wrap' }}>{detail.body}</p>
        <div className="modal-actions">
          {isReal && <button className="secondary" disabled={archiveState === 'archiving'} onClick={() => archive(detail)}>{archiveState === 'archiving' ? 'Archivando…' : 'Archivar'}</button>}
          {isReal && <button className="secondary" onClick={() => startEdit(detail)}>Editar</button>}
          <button className="primary" onClick={() => share(detail)}>{shareState === 'copied' ? '✓ Copiado' : 'Copiar contenido'}</button>
        </div>
      </div>
    </div>}
  </div></AppChrome>
}
