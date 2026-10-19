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

// Las fotos de receta se guardan siempre como JPEG de a lo más 1600 px: es de sobra para la tarjeta
// y para el plan impreso, y el servidor sólo acepta JPEG. Así una foto del celular (varios MB) se
// puede subir tal cual.
const RECIPE_PHOTO_MAX_SIDE = 1600
async function shrinkToJpeg(file) {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('No se pudo leer la imagen.')); img.src = url })
    const scale = Math.min(1, RECIPE_PHOTO_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    // Fondo blanco: el JPEG no tiene transparencia y un PNG recortado saldría con fondo negro.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.86)
  } finally {
    URL.revokeObjectURL(url)
  }
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
  const [archiveError, setArchiveError] = useState('')
  const [imageState, setImageState] = useState('idle')
  const [imageError, setImageError] = useState('')
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
    recipesApi.list(`?${params}`)
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

  const isReal = status === 'online' && selected && !String(selected.id).startsWith('demo-')
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)
  const firstOnPage = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastOnPage = Math.min(page * pageSize, total)

  const startCreate = () => { onSelectRecipe?.(null); setActive('Nueva receta') }
  const startEdit = () => { if (!isReal) return; onSelectRecipe?.(selected.id); setActive('Editar receta') }

  const applyImage = (id, imageFile) => {
    setSelected((prev) => (prev && prev.id === id ? { ...prev, imageFile } : prev))
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, imageFile } : item)))
  }
  const uploadRecipeImage = async (file) => {
    if (!file || !isReal) return
    setImageError('')
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { setImageError('Sube una imagen JPG, PNG o WebP.'); return }
    if (file.size > 20 * 1024 * 1024) { setImageError('La imagen no puede pesar más de 20 MB.'); return }
    setImageState('saving')
    try {
      const dataUrl = await shrinkToJpeg(file)
      const updated = await recipesApi.uploadImage(selected.id, dataUrl)
      applyImage(selected.id, updated.imageFile)
    } catch (error) {
      setImageError(error.message || 'No se pudo subir la foto.')
    } finally {
      setImageState('idle')
    }
  }
  const removeRecipeImage = async () => {
    if (!isReal) return
    if (!window.confirm(`¿Quitar la foto de "${selected.name}"? También dejará de salir en los planes.`)) return
    setImageError('')
    setImageState('saving')
    try {
      await recipesApi.removeImage(selected.id)
      applyImage(selected.id, null)
    } catch (error) {
      setImageError(error.message || 'No se pudo quitar la foto.')
    } finally {
      setImageState('idle')
    }
  }

  const archive = async () => {
    if (!isReal) return
    if (!window.confirm(`¿Archivar "${selected.name}"? Ya no aparecerá en el catálogo ni en las sugerencias; los planes que la usan no cambian.`)) return
    setArchiveState('archiving')
    setArchiveError('')
    try { await recipesApi.archive(selected.id); setArchiveState('idle'); load() }
    catch (error) { setArchiveState('idle'); setArchiveError(error.code === 'DEMO_MODE' ? 'Modo demostración: no se guardará.' : (error.message || 'No se pudo archivar la receta.')) }
  }

  const changeServings = (delta) => setServings((value) => Math.max(0.5, round1(value + delta)))

  const nutrition = selected?.nutrition || {}
  const scaled = (key) => round1((Number(nutrition[key]) || 0) * servings)

  const linkedIngredients = selected?.ingredients || []
  const textIngredients = Array.isArray(selected?.ingredientsText) ? selected.ingredientsText : []
  const yieldPortions = Number(selected?.portions) || null

  // "Contraste": the original book values (`nutrition`) against the manual SMAE calculation
  // (`calculatedNutrition`), both scaled to the servings currently selected.
  const isImported = Boolean(selected?.source)
  const calculatedNutrition = selected?.calculatedNutrition || null
  const contrastValue = (source, key) => round1((Number(source?.[key]) || 0) * servings)
  const hasApproxIngredients = linkedIngredients.some((item) => item.ingredient.group === 'Aproximados Menu 500')

  return <AppChrome active="Recetas" setActive={setActive}><div className="content recipe-workspace">
    <ModuleHeader eyebrow="BIBLIOTECA · RECETAS LOCALES" title="Recetas" subtitle="Tu catálogo propio, listo para personalizar en cada plan." action={<div className="module-actions"><span className={'sync-label ' + (status === 'online' ? 'online' : status === 'loading' ? '' : 'demo')}>● {status === 'online' ? 'Sincronizado' : status === 'loading' ? 'Cargando…' : status === 'error' ? 'Sin conexión' : 'Vista demo'}</span><button className="primary" onClick={startCreate}><span>+</span> Nueva receta</button></div>} />

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
          {isReal && <div className="recipe-photo-actions">
            <label className="secondary ingredient-upload">{imageState === 'saving' ? 'Subiendo…' : selected.imageFile ? 'Cambiar foto' : 'Subir foto'}<input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} disabled={imageState === 'saving'} onChange={(event) => { uploadRecipeImage(event.target.files?.[0]); event.target.value = '' }} /></label>
            {selected.imageFile && <button type="button" className="link-button" disabled={imageState === 'saving'} onClick={removeRecipeImage}>Quitar</button>}
            {!selected.imageFile && <small className="muted">La foto sale en el plan de alimentación de la paciente.</small>}
          </div>}
          {imageError && <div className="form-error">⚠ {imageError}</div>}
          <div className="detail-title"><div><span className="recipe-meal">{MEAL_TYPE_LABELS[selected.mealTypes?.[0]] || selected.mealTypes?.[0]}{selected.timeMinutes ? ` · ${selected.timeMinutes} min` : ''}</span><h2>{selected.name}</h2></div><button className="secondary" disabled={!isReal} onClick={startEdit}>Editar</button></div>

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
          </div> : <div className="smae-summary empty"><span>Sin cálculo SMAE todavía.</span><button type="button" className="link-button" onClick={startEdit}>Vincular ingredientes →</button></div>)}

          <div className={selected.instructions ? 'detail-columns' : undefined}>
          <div className="detail-section">
            <div className="detail-section-head"><h3>Ingredientes{servings !== 1 ? ' (ajustados)' : ''}</h3></div>
            {textIngredients.length > 0 && textIngredients.map((line, index) => <div className="recipe-ingredient" key={index}><span className="ingredient-icon">◉</span><div><b>{scaleIngredientLine(line, servings)}</b></div></div>)}
            {!textIngredients.length && linkedIngredients.map((item) => <div className="recipe-ingredient" key={item.id}><span className="ingredient-icon">◉</span><div><b>{item.ingredient.name}</b><small>{round1(Number(item.quantity) * servings)} {item.unit} · {item.equivalence || 0} eq.</small></div></div>)}
            {!textIngredients.length && !linkedIngredients.length && <p className="muted">Sin ingredientes registrados.</p>}
          </div>

          {selected.instructions && <div className="detail-section">
            <div className="detail-section-head"><h3>Preparación</h3></div>
            <p className="muted" style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{selected.instructions}</p>
          </div>}
          </div>

          <button className="primary detail-assign" onClick={() => onAssignRecipe ? onAssignRecipe(selected.name) : setActive('Constructor de plan')}>Asignar al plan <span>→</span></button>
          {isReal && <button className="link-button" disabled={archiveState === 'archiving'} onClick={archive}>{archiveState === 'archiving' ? 'Archivando…' : 'Archivar receta'}</button>}
          {archiveError && <div className="form-error">⚠ {archiveError}</div>}
        </div>
      </aside>}
    </div>
  </div></AppChrome>
}
