import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { recipesApi } from '../../lib/api.js'

const MEAL_TYPE_LABELS = { breakfast: 'Desayuno', lunch: 'Comida', snack: 'Colación', dinner: 'Cena' }
const MEAL_TYPE_FILTERS = [['Todos', ''], ['Desayuno', 'breakfast'], ['Comida', 'lunch'], ['Colación', 'snack'], ['Cena', 'dinner']]
const CARD_COLORS = ['coral', 'blue', 'purple', 'yellow']

const FALLBACK = [
  { id: 'demo-1', name: 'Avena cocida con manzana', mealTypes: ['breakfast'], restrictions: [], nutrition: { kcal: 204, carbs: 29.1, protein: 7.4, fat: 7.2 }, ingredients: [] },
  { id: 'demo-2', name: 'Bowl de bistec con champiñones', mealTypes: ['lunch'], restrictions: [], nutrition: { kcal: 520, carbs: 42, protein: 38, fat: 20 }, ingredients: [] },
  { id: 'demo-3', name: 'Ensalada tibia de espinacas', mealTypes: ['dinner'], restrictions: ['sin gluten'], nutrition: { kcal: 285, carbs: 24, protein: 19, fat: 12 }, ingredients: [] },
]

export default function RecipesPage({ setActive, onSelectRecipe }) {
  const [items, setItems] = useState(FALLBACK)
  const [selected, setSelected] = useState(FALLBACK[0])
  const [status, setStatus] = useState('loading')
  const [search, setSearch] = useState('')
  const [mealType, setMealType] = useState('')
  const [restriction, setRestriction] = useState('')
  const [archiveState, setArchiveState] = useState('idle')

  const load = () => {
    setStatus('loading')
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (mealType) params.set('mealType', mealType)
    if (restriction) params.set('restriction', restriction)
    const query = params.toString() ? `?${params}` : ''
    recipesApi.list(query)
      .then((response) => {
        const list = response.items || []
        setItems(list)
        setSelected((prev) => list.find((recipe) => recipe.id === prev?.id) || list[0] || null)
        setStatus('online')
      })
      .catch(() => setStatus('demo'))
  }

  useEffect(() => {
    const timer = setTimeout(load, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, mealType, restriction])

  const restrictionOptions = [...new Set(items.flatMap((recipe) => recipe.restrictions || []))]
  const isReal = status === 'online' && selected && !String(selected.id).startsWith('demo-')

  const startCreate = () => { onSelectRecipe?.(null); setActive('Nueva receta') }
  const startEdit = () => { if (!isReal) return; onSelectRecipe?.(selected.id); setActive('Editar receta') }

  const archive = async () => {
    if (!isReal) return
    setArchiveState('archiving')
    try { await recipesApi.archive(selected.id); setArchiveState('idle'); load() }
    catch { setArchiveState('error') }
  }

  return <AppChrome active="Recetas" setActive={setActive}><div className="content recipe-workspace">
    <ModuleHeader eyebrow="BIBLIOTECA · RECETAS LOCALES" title="Recetas" subtitle="Tu catálogo propio, listo para personalizar en cada plan." action={<div className="module-actions"><span className={'sync-label ' + (status === 'online' ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'online' ? 'Sincronizado' : status === 'loading' ? 'Cargando…' : 'Vista demo'}</span><button className="primary" onClick={startCreate}><span>+</span> Nueva receta</button></div>} />

    <div className="recipe-toolbar panel">
      <div className="search-field">⌕ <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre..." /></div>
      <div className="meal-filters">{MEAL_TYPE_FILTERS.map(([label, value]) => <button className={mealType === value ? 'selected' : ''} onClick={() => setMealType(value)} key={label}>{label}</button>)}</div>
      <select value={restriction} onChange={(e) => setRestriction(e.target.value)}><option value="">Todas las restricciones</option>{restrictionOptions.map((r) => <option value={r} key={r}>{r}</option>)}</select>
    </div>

    <div className="recipe-layout">
      <section className="recipe-catalog">
        <div className="catalog-meta">{items.length} receta{items.length === 1 ? '' : 's'} <span>Fuente: catálogo Nutri Studio</span></div>
        {status !== 'loading' && items.length === 0 && <div className="result-empty panel"><span>◌</span><h3>No hay recetas con esos filtros</h3><p>Ajusta la búsqueda o crea una receta nueva.</p></div>}
        <div className="recipe-grid">{items.map((recipe, i) => <button className={'recipe-card panel ' + (selected?.id === recipe.id ? 'recipe-selected' : '')} onClick={() => setSelected(recipe)} key={recipe.id}><div className={'recipe-image ' + CARD_COLORS[i % 4]}><span>✦</span><small>♡</small></div><div className="recipe-body"><span className="recipe-meal">{MEAL_TYPE_LABELS[recipe.mealTypes?.[0]] || recipe.mealTypes?.[0] || 'Receta'}</span><h3>{recipe.name}</h3><p>{Math.round(recipe.nutrition?.kcal || 0)} kcal · Ingredientes revisados</p></div></button>)}</div>
      </section>

      {selected && <aside className="recipe-detail panel">
        <div className={'detail-image ' + CARD_COLORS[items.indexOf(selected) % 4]}><span>✦</span></div>
        <div className="detail-content">
          <div className="detail-title"><div><span className="recipe-meal">{MEAL_TYPE_LABELS[selected.mealTypes?.[0]] || selected.mealTypes?.[0]}</span><h2>{selected.name}</h2></div><button className="secondary" disabled={!isReal} onClick={startEdit}>Editar</button></div>
          <div className="nutrition-summary"><div><b>{Math.round(selected.nutrition?.kcal || 0)} kcal</b><small>Energía</small></div><div><b>{selected.nutrition?.carbs ?? 0}g</b><small>Carbohidratos</small></div><div><b>{selected.nutrition?.protein ?? 0}g</b><small>Proteína</small></div><div><b>{selected.nutrition?.fat ?? 0}g</b><small>Grasas</small></div></div>
          <div className="detail-section">
            <div className="detail-section-head"><h3>Ingredientes locales</h3></div>
            {(selected.ingredients || []).map((item) => <div className="recipe-ingredient" key={item.id}><span className="ingredient-icon">◉</span><div><b>{item.ingredient.name}</b><small>{item.quantity} {item.unit} · {item.equivalence || 0} eq.</small></div></div>)}
            {!selected.ingredients?.length && <p className="muted">Sin ingredientes registrados.</p>}
          </div>
          {selected.instructions && <div className="detail-section">
            <div className="detail-section-head"><h3>Preparación</h3></div>
            <p className="muted" style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{selected.instructions}</p>
          </div>}
          <button className="primary detail-assign" onClick={() => setActive('Constructor de plan')}>Asignar al plan <span>→</span></button>
          {isReal && <button className="link-button" disabled={archiveState === 'archiving'} onClick={archive}>{archiveState === 'archiving' ? 'Archivando…' : 'Archivar receta'}</button>}
        </div>
      </aside>}
    </div>
  </div></AppChrome>
}
