import { useEffect, useMemo, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { recipesApi } from '../../lib/api.js'

const MEAL_TYPE_LABELS = { breakfast: 'Desayuno', lunch: 'Comida', snack: 'Colación', dinner: 'Cena', dessert: 'Postre', sauce: 'Salsa / Paté', base: 'Básico' }
const MEAL_TYPE_FILTERS = [
  ['Todos', ''],
  ['Desayuno', 'breakfast'],
  ['Comida', 'lunch'],
  ['Cena', 'dinner'],
  ['Colación', 'snack'],
  ['Postre', 'dessert'],
  ['Salsa', 'sauce'],
  ['Básico', 'base'],
]
const CARD_COLORS = ['coral', 'blue', 'purple', 'yellow']

const FALLBACK = [
  { id: 'demo-1', name: 'Avena cocida con manzana', mealTypes: ['breakfast'], restrictions: [], nutrition: { kcal: 204, carbs: 29.1, protein: 7.4, fat: 7.2 }, ingredients: [] },
  { id: 'demo-2', name: 'Bowl de bistec con champiñones', mealTypes: ['lunch'], restrictions: [], nutrition: { kcal: 520, carbs: 42, protein: 38, fat: 20 }, ingredients: [] },
  { id: 'demo-3', name: 'Ensalada tibia de espinacas', mealTypes: ['dinner'], restrictions: ['sin gluten'], nutrition: { kcal: 285, carbs: 24, protein: 19, fat: 12 }, ingredients: [] },
]

const round1 = (value) => Math.round(value * 10) / 10

// Best-effort fraction formatting so scaling "1/2 taza" by 3 reads "1 1/2 taza", not "1.5 taza".
const formatQuantity = (value) => {
  if (!Number.isFinite(value) || value <= 0) return ''
  const whole = Math.floor(value)
  const remainder = value - whole
  const fraction = [[1 / 2, '1/2'], [1 / 3, '1/3'], [2 / 3, '2/3'], [1 / 4, '1/4'], [3 / 4, '3/4']]
    .find(([candidate]) => Math.abs(remainder - candidate) < 0.04)
  if (fraction) return [whole > 0 ? whole : '', fraction[1]].filter(Boolean).join(' ')
  return String(round1(value)).replace(/\.0$/, '')
}

// Scales the leading amount of a free-text ingredient line ("2 tazas de avena" -> "3 tazas de
// avena") without touching the rest. Unparseable lines ("al gusto") pass through unchanged.
const scaleIngredientLine = (line, factor) => {
  if (factor === 1) return line
  // Ranges like "2-3 cucharadas" are common and must scale on both ends.
  const range = line.match(/^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)\b/)
  if (range) {
    const low = Number(range[1].replace(',', '.')) * factor
    const high = Number(range[2].replace(',', '.')) * factor
    return `${formatQuantity(low)}-${formatQuantity(high)}${line.slice(range[0].length)}`
  }
  const match = line.match(/^(\d+)\s+(\d+)\/(\d+)\b|^(\d+)\/(\d+)\b|^(\d+(?:[.,]\d+)?)\b/)
  if (!match) return line
  let amount
  let consumed
  if (match[1]) { amount = Number(match[1]) + Number(match[2]) / Number(match[3]); consumed = match[0].length }
  else if (match[4]) { amount = Number(match[4]) / Number(match[5]); consumed = match[0].length }
  else { amount = Number(match[6].replace(',', '.')); consumed = match[6].length }
  const scaled = formatQuantity(amount * factor)
  if (!scaled) return line
  return `${scaled}${line.slice(consumed)}`
}

const RecipeImage = ({ recipe, colorIndex, className }) => {
  const src = recipe.imageFile ? recipesApi.imageUrl(recipe.imageFile) : null
  if (src) return <div className={className + ' has-photo'}><img src={src} alt={recipe.name} loading="lazy" /></div>
  return <div className={className + ' ' + CARD_COLORS[colorIndex % 4]}><span>✦</span></div>
}

export default function RecipesPage({ setActive, onSelectRecipe, onAssignRecipe }) {
  const [items, setItems] = useState(FALLBACK)
  const [selected, setSelected] = useState(FALLBACK[0])
  const [status, setStatus] = useState('loading')
  const [search, setSearch] = useState('')
  const [mealType, setMealType] = useState('')
  const [restriction, setRestriction] = useState('')
  const [archiveState, setArchiveState] = useState('idle')
  const [servings, setServings] = useState(1)

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

  // A new recipe starts at one serving; re-selecting one shouldn't silently keep a previous scale.
  useEffect(() => { setServings(1) }, [selected?.id])

  const restrictionOptions = useMemo(() => [...new Set(items.flatMap((recipe) => recipe.restrictions || []))], [items])
  const isReal = status === 'online' && selected && !String(selected.id).startsWith('demo-')

  const startCreate = () => { onSelectRecipe?.(null); setActive('Nueva receta') }
  const startEdit = () => { if (!isReal) return; onSelectRecipe?.(selected.id); setActive('Editar receta') }

  const archive = async () => {
    if (!isReal) return
    setArchiveState('archiving')
    try { await recipesApi.archive(selected.id); setArchiveState('idle'); load() }
    catch { setArchiveState('error') }
  }

  const changeServings = (delta) => setServings((value) => Math.max(0.5, round1(value + delta)))

  const nutrition = selected?.nutrition || {}
  const scaled = (key) => round1((Number(nutrition[key]) || 0) * servings)

  const linkedIngredients = selected?.ingredients || []
  const textIngredients = Array.isArray(selected?.ingredientsText) ? selected.ingredientsText : []
  const yieldPortions = Number(selected?.portions) || null

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
        <div className="recipe-grid">{items.map((recipe, i) => <button className={'recipe-card panel ' + (selected?.id === recipe.id ? 'recipe-selected' : '')} onClick={() => setSelected(recipe)} key={recipe.id}><RecipeImage recipe={recipe} colorIndex={i} className="recipe-image" /><div className="recipe-body"><span className="recipe-meal">{MEAL_TYPE_LABELS[recipe.mealTypes?.[0]] || recipe.mealTypes?.[0] || 'Receta'}{recipe.timeMinutes ? ` · ${recipe.timeMinutes} min` : ''}</span><h3>{recipe.name}</h3><p>{Math.round(recipe.nutrition?.kcal || 0)} kcal {recipe.source ? '· por porción' : '· Ingredientes revisados'}</p></div></button>)}</div>
      </section>

      {selected && <aside className="recipe-detail panel">
        <RecipeImage recipe={selected} colorIndex={items.indexOf(selected)} className="detail-image" />
        <div className="detail-content">
          <div className="detail-title"><div><span className="recipe-meal">{MEAL_TYPE_LABELS[selected.mealTypes?.[0]] || selected.mealTypes?.[0]}{selected.timeMinutes ? ` · ${selected.timeMinutes} min` : ''}</span><h2>{selected.name}</h2></div><button className="secondary" disabled={!isReal} onClick={startEdit}>Editar</button></div>

          {yieldPortions && <p className="muted recipe-yield">Rinde {yieldPortions} {yieldPortions === 1 ? 'porción' : 'porciones'} · valores por porción</p>}

          <div className="servings-control">
            <span>Porciones a servir</span>
            <div className="servings-stepper"><button type="button" onClick={() => changeServings(-0.5)} aria-label="Menos porciones">−</button><input type="number" min="0.5" step="0.5" value={servings} onChange={(e) => setServings(Math.max(0.5, Number(e.target.value) || 1))} /><button type="button" onClick={() => changeServings(0.5)} aria-label="Más porciones">+</button></div>
          </div>

          <div className="nutrition-summary"><div><b>{scaled('kcal')}</b><small>kcal</small></div><div><b>{scaled('carbs')}g</b><small>Carbohidratos</small></div><div><b>{scaled('protein')}g</b><small>Proteína</small></div><div><b>{scaled('fat')}g</b><small>Grasas</small></div></div>
          {Number(nutrition.fiber) > 0 && <p className="nutrition-note">Fibra {scaled('fiber')} g · calculado para {servings} {servings === 1 ? 'porción' : 'porciones'}</p>}

          <div className="detail-section">
            <div className="detail-section-head"><h3>Ingredientes{servings !== 1 ? ' (ajustados)' : ''}</h3></div>
            {linkedIngredients.map((item) => <div className="recipe-ingredient" key={item.id}><span className="ingredient-icon">◉</span><div><b>{item.ingredient.name}</b><small>{round1(Number(item.quantity) * servings)} {item.unit} · {item.equivalence || 0} eq.</small></div></div>)}
            {!linkedIngredients.length && textIngredients.map((line, index) => <div className="recipe-ingredient" key={index}><span className="ingredient-icon">◉</span><div><b>{scaleIngredientLine(line, servings)}</b></div></div>)}
            {!linkedIngredients.length && !textIngredients.length && <p className="muted">Sin ingredientes registrados.</p>}
          </div>

          {selected.instructions && <div className="detail-section">
            <div className="detail-section-head"><h3>Preparación</h3></div>
            <p className="muted" style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{selected.instructions}</p>
          </div>}
          <button className="primary detail-assign" onClick={() => onAssignRecipe ? onAssignRecipe(selected.name) : setActive('Constructor de plan')}>Asignar al plan <span>→</span></button>
          {isReal && <button className="link-button" disabled={archiveState === 'archiving'} onClick={archive}>{archiveState === 'archiving' ? 'Archivando…' : 'Archivar receta'}</button>}
        </div>
      </aside>}
    </div>
  </div></AppChrome>
}
