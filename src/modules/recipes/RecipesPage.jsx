import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { recipesApi } from '../../lib/api.js'
import { scaleIngredientLine } from '../../lib/ingredientLines.js'

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

const RecipeImage = ({ recipe, colorIndex, className }) => {
  // La tarjeta usa la miniatura; el detalle, la foto completa.
  const src = recipe.imageFile ? recipesApi.imageUrl(recipe.imageFile, { thumb: className !== 'detail-image' }) : null
  if (src) return <div className={className + ' has-photo'}><img src={src} alt={recipe.name} loading="lazy" decoding="async" fetchPriority="low" /></div>
  return <div className={className + ' ' + CARD_COLORS[colorIndex % 4]}><span>✦</span></div>
}

export default function RecipesPage({ setActive, onSelectRecipe, onAssignRecipe }) {
  const [items, setItems] = useState(FALLBACK)
  const [selected, setSelected] = useState(FALLBACK[0])
  const [status, setStatus] = useState('loading')
  const [search, setSearch] = useState('')
  const [mealType, setMealType] = useState('')
  const [restriction, setRestriction] = useState('')
  const [servings, setServings] = useState(1)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [total, setTotal] = useState(FALLBACK.length)
  const [restrictionOptions, setRestrictionOptions] = useState(() => [...new Set(FALLBACK.flatMap((recipe) => recipe.restrictions || []))])

  const load = () => {
    setStatus('loading')
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (mealType) params.set('mealType', mealType)
    if (restriction) params.set('restriction', restriction)
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    // `card=1`: tarjetas sin la nutrición de cada ingrediente; el detalle ya trae la de la receta.
    params.set('card', '1')
    recipesApi.pageCached(`?${params}`)
      .then((response) => {
        const list = response.items || []
        setItems(list)
        // Acumular las restricciones (no derivarlas de `items`, que viene ya filtrado por
        // restricción): si no, al elegir una el <select> se queda solo con esa opción y no se puede
        // cambiar a otra sin recargar.
        setRestrictionOptions((prev) => [...new Set([...prev, ...list.flatMap((recipe) => recipe.restrictions || [])])])
        setTotal(response.total ?? list.length)
        setSelected((prev) => list.find((recipe) => recipe.id === prev?.id) || list[0] || null)
        setStatus('online')
      })
      .catch((error) => { if (error.code === 'DEMO_MODE') setStatus('demo'); else { setItems([]); setSelected(null); setTotal(0); setStatus('error') } })
  }

  useEffect(() => {
    const timer = setTimeout(load, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, mealType, restriction, page, pageSize])

  // Any new search or filter goes back to the first page instead of showing an empty page 4.
  useEffect(() => { setPage(1) }, [search, mealType, restriction])

  // A new recipe starts at one serving; re-selecting one shouldn't silently keep a previous scale.
  useEffect(() => { setServings(1) }, [selected?.id])

  const totalPages = Math.max(Math.ceil(total / pageSize), 1)
  const firstOnPage = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastOnPage = Math.min(page * pageSize, total)

  const changeServings = (delta) => setServings((value) => Math.max(0.5, round1(value + delta)))

  const nutrition = selected?.nutrition || {}
  const scaled = (key) => round1((Number(nutrition[key]) || 0) * servings)

  const linkedIngredients = selected?.ingredients || []
  const textIngredients = Array.isArray(selected?.ingredientsText) ? selected.ingredientsText : []
  const yieldPortions = Number(selected?.portions) || null
  // Las cantidades de los ingredientes son las de toda la receta ("rinde N porciones") y la
  // nutrición es por porción: se escalan a las porciones a servir igual que en el plan
  // (scaledRecipeLines/recipeItems). Antes se multiplicaban sólo por `servings` y una receta de 4
  // porciones mostraba, para 1 porción, los ingredientes de las 4.
  const ingredientScale = servings / (yieldPortions || 1)

  // "Contraste": the original book values (`nutrition`) against the manual SMAE calculation
  // (`calculatedNutrition`), both scaled to the servings currently selected.
  const isImported = Boolean(selected?.source)
  const calculatedNutrition = selected?.calculatedNutrition || null
  const contrastValue = (source, key) => round1((Number(source?.[key]) || 0) * servings)
  const hasApproxIngredients = linkedIngredients.some((item) => item.ingredient.group === 'Aproximados Menu 500')

  return <AppChrome active="Recetas" setActive={setActive}><div className="content recipe-workspace">
    <ModuleHeader eyebrow="BIBLIOTECA · RECETAS" title="Recetas" subtitle="Catálogo de consulta. Las cantidades y los ingredientes se personalizan por paciente en el Constructor del plan." action={<span className={'sync-label ' + (status === 'online' ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'online' ? 'Sincronizado' : status === 'loading' ? 'Cargando…' : status === 'error' ? 'Sin conexión' : 'Vista demo'}</span>} />

    <div className="recipe-toolbar panel">
      <div className="search-field">⌕ <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre..." /></div>
      <div className="meal-filters">{MEAL_TYPE_FILTERS.map(([label, value]) => <button className={mealType === value ? 'selected' : ''} onClick={() => setMealType(value)} key={label}>{label}</button>)}</div>
      <select value={restriction} onChange={(e) => setRestriction(e.target.value)}><option value="">Todas las restricciones</option>{restrictionOptions.map((r) => <option value={r} key={r}>{r}</option>)}</select>
    </div>

    <div className="recipe-layout">
      <section className="recipe-catalog">
        <div className="catalog-meta">{total === 0 ? 'Sin recetas' : `${firstOnPage}–${lastOnPage} de ${total} receta${total === 1 ? '' : 's'}`} <span>Fuente: catálogo Nutri Studio</span></div>
        {status === 'error' && <div className="form-error">⚠ No se pudieron cargar las recetas.</div>}
        {status !== 'loading' && status !== 'error' && items.length === 0 && <div className="result-empty panel"><span>◌</span><h3>No hay recetas con esos filtros</h3><p>Ajusta la búsqueda o crea una receta nueva.</p></div>}
        <div className="recipe-grid">{items.map((recipe, i) => <button className={'recipe-card panel ' + (selected?.id === recipe.id ? 'recipe-selected' : '')} onClick={() => setSelected(recipe)} key={recipe.id}><RecipeImage recipe={recipe} colorIndex={i} className="recipe-image" /><div className="recipe-body"><span className="recipe-meal">{MEAL_TYPE_LABELS[recipe.mealTypes?.[0]] || recipe.mealTypes?.[0] || 'Receta'}{recipe.timeMinutes ? ` · ${recipe.timeMinutes} min` : ''}</span><h3>{recipe.name}</h3><p>{Math.round(recipe.nutrition?.kcal || 0)} kcal {recipe.source ? '· por porción' : '· Ingredientes revisados'}</p></div></button>)}</div>
        {total > 0 && <div className="recipe-pagination panel">
          <label>Mostrar <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>{[12, 24, 48, 96].map((size) => <option value={size} key={size}>{size}</option>)}</select> por página</label>
          <div className="pagination-nav">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior">←</button>
            <span>Página {page} de {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Página siguiente">→</button>
          </div>
        </div>}
      </section>

      {selected && <aside className="recipe-detail panel">
        <RecipeImage recipe={selected} colorIndex={items.indexOf(selected)} className="detail-image" />
        <div className="detail-content">
          <div className="detail-title"><div><span className="recipe-meal">{MEAL_TYPE_LABELS[selected.mealTypes?.[0]] || selected.mealTypes?.[0]}{selected.timeMinutes ? ` · ${selected.timeMinutes} min` : ''}</span><h2>{selected.name}</h2></div></div>

          {yieldPortions && <p className="muted recipe-yield">Rinde {yieldPortions} {yieldPortions === 1 ? 'porción' : 'porciones'} · valores por porción</p>}

          <div className="servings-control">
            <span>Porciones a servir</span>
            <div className="servings-stepper"><button type="button" onClick={() => changeServings(-0.5)} aria-label="Menos porciones">−</button><input type="number" min="0.5" step="0.5" value={servings} onChange={(e) => setServings(Math.max(0.5, Number(e.target.value) || 1))} /><button type="button" onClick={() => changeServings(0.5)} aria-label="Más porciones">+</button></div>
          </div>

          <div className="nutrition-summary"><div><b>{scaled('kcal')}</b><small>kcal</small></div><div><b>{scaled('carbs')}g</b><small>Carbohidratos</small></div><div><b>{scaled('protein')}g</b><small>Proteína</small></div><div><b>{scaled('fat')}g</b><small>Grasas</small></div></div>
          {Number(nutrition.fiber) > 0 && <p className="nutrition-note">Fibra {scaled('fiber')} g · calculado para {servings} {servings === 1 ? 'porción' : 'porciones'}</p>}

          {isImported && (calculatedNutrition ? <div className="smae-summary">
            <div className="smae-summary-head"><span>Calculado según SMAE{hasApproxIngredients ? ' + aprox.' : ''}</span><small>{servings === 1 ? 'por porción' : `por ${servings} porciones`}</small></div>
            <div className="smae-summary-values"><b>{contrastValue(calculatedNutrition, 'kcal')} kcal</b><span>{contrastValue(calculatedNutrition, 'carbs')} g carb · {contrastValue(calculatedNutrition, 'protein')} g prot · {contrastValue(calculatedNutrition, 'fat')} g grasa</span></div>
            {linkedIngredients.length > 0 && <small className="smae-summary-ingredients">Con {linkedIngredients.length} ingrediente{linkedIngredients.length === 1 ? '' : 's'}{hasApproxIngredients ? ' (incluye aproximados)' : ''}: {linkedIngredients.map((item) => item.ingredient.name).join(', ')}</small>}
          </div> : <div className="smae-summary empty"><span>Sin cálculo SMAE todavía.</span><small className="muted">El cálculo con ingredientes del catálogo lo administra Milpa.</small></div>)}

          <div className={selected.instructions ? 'detail-columns' : undefined}>
          <div className="detail-section">
            <div className="detail-section-head"><h3>Ingredientes{ingredientScale !== 1 ? ' (ajustados)' : ''}</h3></div>
            {textIngredients.length > 0 && textIngredients.map((line, index) => <div className="recipe-ingredient" key={index}><span className="ingredient-icon">◉</span><div><b>{scaleIngredientLine(line, ingredientScale)}</b></div></div>)}
            {!textIngredients.length && linkedIngredients.map((item) => <div className="recipe-ingredient" key={item.id}><span className="ingredient-icon">◉</span><div><b>{item.ingredient.name}</b><small>{round1(Number(item.quantity) * ingredientScale)} {item.unit} · {item.equivalence || 0} eq.</small></div></div>)}
            {!textIngredients.length && !linkedIngredients.length && <p className="muted">Sin ingredientes registrados.</p>}
          </div>

          {selected.instructions && <div className="detail-section">
            <div className="detail-section-head"><h3>Preparación</h3></div>
            <p className="muted" style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{selected.instructions}</p>
          </div>}
          </div>

          <div className="recipe-readonly-note">ⓘ El catálogo de recetas es de solo lectura. Para ajustar cantidades o ingredientes para un paciente, usa el <b>Constructor del plan</b>.</div>
          <button className="primary detail-assign" onClick={() => onAssignRecipe ? onAssignRecipe(selected.name) : setActive('Constructor de plan')}>Asignar al plan <span>→</span></button>
        </div>
      </aside>}
    </div>
  </div></AppChrome>
}
