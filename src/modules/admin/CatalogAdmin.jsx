import { useEffect, useRef, useState } from 'react'
import { adminApi } from '../../lib/adminApi.js'
import { shrinkToJpeg } from '../../lib/images.js'

const MEAL_OPTIONS = [
  ['Desayuno', 'breakfast'],
  ['Comida', 'lunch'],
  ['Cena', 'dinner'],
  ['Colación', 'snack'],
  ['Postre', 'dessert'],
  ['Salsa', 'sauce'],
  ['Básico', 'base'],
]
const MEAL_LABEL = Object.fromEntries(MEAL_OPTIONS.map(([label, key]) => [key, label]))
const MEAL_KEY = Object.fromEntries(MEAL_OPTIONS.map(([label, key]) => [label, key]))
const SKIP_REASON = { modified: 'La nutrióloga ya la había modificado', archived: 'La cuenta la archivó' }

const formFromRecipe = (recipe) => ({
  name: recipe.name || '',
  meal: MEAL_LABEL[recipe.mealTypes?.[0]] || 'Desayuno',
  portions: Number(recipe.portions) || 1,
  timeMinutes: recipe.timeMinutes ?? '',
  instructions: recipe.instructions || '',
  ingredientsText: Array.isArray(recipe.ingredientsText) ? recipe.ingredientsText.join('\n') : '',
})
const chosenFromRecipe = (recipe) => (recipe.ingredients || []).map((item) => ({
  ingredientId: item.ingredientId || item.ingredient?.id,
  name: item.ingredient?.name || '',
  group: item.ingredient?.group || '',
  quantity: Number(item.quantity) || 0,
  unit: item.unit || 'g',
  equivalence: Number(item.equivalence) || 1,
}))
const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

export default function CatalogAdmin() {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState([])
  const [listState, setListState] = useState('loading')
  const [listError, setListError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [recipe, setRecipe] = useState(null)
  const [form, setForm] = useState(null)
  const [chosen, setChosen] = useState([])
  const [loadState, setLoadState] = useState('idle')
  const [saveState, setSaveState] = useState('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [imageState, setImageState] = useState('idle')
  const [publishState, setPublishState] = useState('idle')
  const [publishResult, setPublishResult] = useState(null)
  const [ingredientQuery, setIngredientQuery] = useState('')
  const [ingredientResults, setIngredientResults] = useState([])
  const [ingredientState, setIngredientState] = useState('idle')
  const searchTimer = useRef(null)

  const loadList = async (term = search) => {
    setListState('loading'); setListError('')
    try {
      const response = await adminApi.catalogRecipes(term.trim())
      setItems(response.items || [])
      setListState('ready')
    } catch (error) {
      setListError(error.message || 'No se pudo cargar el catálogo.')
      setListState('error')
    }
  }
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => loadList(search), 300)
    return () => clearTimeout(searchTimer.current)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const openRecipe = async (id) => {
    setSelectedId(id); setLoadState('loading'); setRecipe(null); setForm(null); setChosen([]); setPublishResult(null); setSaveMessage('')
    try {
      const detail = await adminApi.catalogRecipe(id)
      setRecipe(detail)
      setForm(formFromRecipe(detail))
      setChosen(chosenFromRecipe(detail))
      setLoadState('ready')
    } catch (error) {
      setLoadState('error')
    }
  }

  useEffect(() => {
    const query = ingredientQuery.trim()
    if (query.length < 2) { setIngredientResults([]); setIngredientState('idle'); return undefined }
    let cancelled = false
    setIngredientState('loading')
    const timer = setTimeout(() => {
      adminApi.catalogIngredients(query)
        .then((response) => { if (!cancelled) { setIngredientResults(response.items || []); setIngredientState('ready') } })
        .catch(() => { if (!cancelled) { setIngredientResults([]); setIngredientState('error') } })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [ingredientQuery])

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))
  const addIngredient = (item) => {
    if (chosen.some((row) => row.ingredientId === item.id)) return
    setChosen((prev) => [...prev, { ingredientId: item.id, name: item.name, group: item.group, quantity: 100, unit: 'g', equivalence: 1 }])
    setIngredientQuery('')
    setIngredientResults([])
  }
  const updateQuantity = (id, value) => setChosen((prev) => prev.map((row) => (row.ingredientId === id ? { ...row, quantity: value } : row)))
  const removeIngredient = (id) => setChosen((prev) => prev.filter((row) => row.ingredientId !== id))

  const uploadImage = async (file) => {
    if (!file || !recipe) return
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { setSaveMessage('Sube una imagen JPG, PNG o WebP.'); return }
    setImageState('saving'); setSaveMessage('')
    try {
      const dataUrl = await shrinkToJpeg(file)
      const updated = await adminApi.uploadCatalogImage(recipe.id, dataUrl)
      setRecipe((prev) => ({ ...prev, imageFile: updated.imageFile }))
      setItems((prev) => prev.map((item) => (item.id === updated.id ? { ...item, imageFile: updated.imageFile } : item)))
    } catch (error) {
      setSaveMessage(error.message || 'No se pudo subir la foto.')
    } finally { setImageState('idle') }
  }

  const save = async () => {
    if (!recipe || !form) return
    setSaveState('saving'); setSaveMessage('')
    try {
      const ingredients = chosen.filter((row) => Number(row.quantity) > 0).map((row) => ({ ingredientId: row.ingredientId, quantity: Number(row.quantity), unit: 'g', equivalence: Number(row.equivalence) || 1 }))
      const updated = await adminApi.updateCatalogRecipe(recipe.id, {
        name: form.name.trim(),
        mealTypes: [MEAL_KEY[form.meal]],
        portions: Math.max(1, Math.round(Number(form.portions) || 1)),
        instructions: form.instructions,
        ingredientsText: form.ingredientsText.split('\n').map((line) => line.trim()).filter(Boolean),
        timeMinutes: form.timeMinutes === '' ? null : Number(form.timeMinutes),
      })
      const withIngredients = await adminApi.replaceCatalogIngredients(recipe.id, ingredients)
      setRecipe(withIngredients)
      setForm(formFromRecipe(withIngredients))
      setChosen(chosenFromRecipe(withIngredients))
      setItems((prev) => prev.map((item) => (item.id === updated.id ? { ...item, name: updated.name, updatedAt: updated.updatedAt, catalogSyncedAt: null } : item)))
      setSaveMessage('Cambios guardados en el catálogo base. Ahora publícalos para llevarlos a las cuentas.')
      setSaveState('saved')
    } catch (error) {
      setSaveState('error')
      setSaveMessage(error.message || 'No se pudo guardar la receta del catálogo.')
    }
  }

  const publish = async () => {
    if (!recipe) return
    if (!window.confirm('Se actualizarán las copias de todas las cuentas que no hayan sido modificadas por su nutrióloga. Las modificadas se respetarán y se te avisará. ¿Publicar?')) return
    setPublishState('publishing'); setPublishResult(null); setSaveMessage('')
    try {
      const result = await adminApi.publishCatalogRecipe(recipe.id)
      setPublishResult(result)
      setPublishState('idle')
      setItems((prev) => prev.map((item) => (item.id === recipe.id ? { ...item, catalogId: result.catalogId, catalogSyncedAt: new Date().toISOString() } : item)))
    } catch (error) {
      setPublishState('error')
      setSaveMessage(error.message || 'No se pudo publicar el catálogo.')
    }
  }

  const nutrition = recipe?.calculatedNutrition || recipe?.nutrition || {}
  const dirty = Boolean(recipe && form && (form.name !== recipe.name || form.instructions !== (recipe.instructions || '') || chosen.length !== (recipe.ingredients || []).length))

  return <main className="admin-content catalog-admin">
    <section className="admin-section">
      <div className="admin-section-head"><div><h2>Catálogo global de recetas</h2><p>Edita la receta de la práctica base y publica los cambios a todas las cuentas. Las copias que una nutrióloga ya modificó se respetan y se te informan.</p></div></div>
      <div className="catalog-layout">
        <aside className="panel catalog-list-panel">
          <div className="search-field">⌕ <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar receta…" /></div>
          {listState === 'loading' && <p className="muted">Cargando catálogo…</p>}
          {listState === 'error' && <div className="form-error">⚠ {listError}</div>}
          <div className="catalog-list">{items.map((item) => {
            const pending = !item.catalogSyncedAt
            return <button type="button" className={'catalog-list-item' + (item.id === selectedId ? ' selected' : '')} key={item.id} onClick={() => openRecipe(item.id)}>
              <span className="catalog-list-thumb">{item.imageFile ? <img src={adminApi.catalogImageUrl(item.imageFile)} alt="" loading="lazy" decoding="async" /> : <span>✦</span>}</span>
              <span className="catalog-list-info"><b>{item.name}</b><small>{MEAL_LABEL[item.mealTypes?.[0]] || 'Receta'} · {item._count?.ingredients ?? 0} ingredientes</small></span>
              {pending && <i className="catalog-pending" title="Hay cambios sin publicar">Sin publicar</i>}
            </button>
          })}</div>
          {listState === 'ready' && items.length === 0 && <p className="muted">No hay recetas con ese nombre.</p>}
        </aside>

        <section className="panel catalog-editor">
          {!selectedId && <div className="result-empty"><span>✦</span><h3>Elige una receta</h3><p>Edita su foto, nombre, ingredientes y preparación; luego publica los cambios.</p></div>}
          {selectedId && loadState === 'loading' && <div className="result-empty"><span className="loading-dot">●</span><h3>Cargando receta…</h3></div>}
          {selectedId && loadState === 'error' && <div className="form-error">⚠ No se pudo cargar la receta.</div>}
          {form && loadState === 'ready' && <>
            <div className="catalog-editor-head">
              <div><p className="eyebrow">RECETA DEL CATÁLOGO</p><h3>{recipe.name}</h3><small className="muted">{recipe.source ? `Origen: ${recipe.source}` : 'Receta del catálogo'} · {recipe.catalogSyncedAt ? `Publicada ${formatDate(recipe.catalogSyncedAt)}` : 'Nunca publicada'}</small></div>
              <button type="button" className="secondary" disabled={publishState === 'publishing'} onClick={publish}>{publishState === 'publishing' ? 'Publicando…' : 'Publicar cambios'}</button>
            </div>

            <div className="catalog-editor-grid">
              <div className="catalog-form">
                <label>Nombre de la receta *<input value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
                <div className="form-row">
                  <label>Tiempo de comida<select value={form.meal} onChange={(event) => update('meal', event.target.value)}>{MEAL_OPTIONS.map(([label]) => <option key={label}>{label}</option>)}</select></label>
                  <label>Porciones<input type="number" min="1" value={form.portions} onChange={(event) => update('portions', event.target.value)} /></label>
                </div>
                <div className="form-row">
                  <label>Minutos de preparación<input type="number" min="0" value={form.timeMinutes} onChange={(event) => update('timeMinutes', event.target.value)} placeholder="Opcional" /></label>
                  <label>Calorías calculadas<input value={`${Math.round(Number(nutrition.kcal) || 0)} kcal`} readOnly /></label>
                </div>

                <div className="form-section-title second"><span>02</span><div><h2>Ingredientes ligados al catálogo</h2><p>Se usan para recalcular la nutrición y se reenlazan en cada cuenta al publicar.</p></div></div>
                <div className="search-field">⌕ <input value={ingredientQuery} onChange={(event) => setIngredientQuery(event.target.value)} placeholder="Buscar ingrediente (mín. 2 letras)…" /></div>
                {ingredientState === 'loading' && <p className="muted">Buscando…</p>}
                {ingredientState === 'error' && <p className="muted">No se pudo buscar en el catálogo.</p>}
                <div className="ingredient-suggestions">{ingredientResults.map((item) => <button type="button" onClick={() => addIngredient(item)} className={chosen.some((row) => row.ingredientId === item.id) ? 'added' : ''} key={item.id}><span>+</span>{item.name}<small>{item.group}</small></button>)}</div>
                <div className="catalog-ingredients">{chosen.map((row) => <div key={row.ingredientId}>
                  <span className="ingredient-icon">◉</span>
                  <div><b>{row.name}</b><small>{row.group}</small></div>
                  <input type="number" min="0" step="1" value={row.quantity} onChange={(event) => updateQuantity(row.ingredientId, event.target.value)} aria-label={`Gramos de ${row.name}`} />
                  <span className="unit-label">g</span>
                  <button type="button" aria-label={`Quitar ${row.name}`} onClick={() => removeIngredient(row.ingredientId)}>×</button>
                </div>)}</div>

                <label>Ingredientes en texto libre<textarea className="wide-textarea" value={form.ingredientsText} onChange={(event) => update('ingredientsText', event.target.value)} placeholder="Uno por línea" /></label>
                <label>Preparación<textarea className="wide-textarea" value={form.instructions} onChange={(event) => update('instructions', event.target.value)} /></label>
                {saveMessage && <div className={saveState === 'error' ? 'form-error' : 'catalog-save-note'}>{saveMessage}</div>}
                <div className="form-actions">
                  <button type="button" className="secondary" onClick={() => openRecipe(recipe.id)} disabled={saveState === 'saving'}>Descartar</button>
                  <button type="button" className="primary" onClick={save} disabled={saveState === 'saving' || !form.name.trim()}>{saveState === 'saving' ? 'Guardando…' : 'Guardar cambios'}</button>
                </div>
              </div>

              <aside className="catalog-preview">
                <div className="catalog-photo">{recipe.imageFile ? <img src={adminApi.catalogImageUrl(recipe.imageFile)} alt={recipe.name} /> : <span>✦</span>}</div>
                <label className="secondary ingredient-upload">{imageState === 'saving' ? 'Subiendo…' : recipe.imageFile ? 'Cambiar foto' : 'Subir foto'}<input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} disabled={imageState === 'saving'} onChange={(event) => { uploadImage(event.target.files?.[0]); event.target.value = '' }} /></label>
                <div className="catalog-macros"><div><small>kcal</small><b>{Math.round(Number(nutrition.kcal) || 0)}</b></div><div><small>Proteína</small><b>{Math.round(Number(nutrition.protein) || 0)} g</b></div><div><small>HdC</small><b>{Math.round(Number(nutrition.carbs) || 0)} g</b></div><div><small>Grasas</small><b>{Math.round(Number(nutrition.fat) || 0)} g</b></div></div>
                {dirty && <p className="catalog-dirty">Hay cambios sin guardar en el formulario.</p>}
              </aside>
            </div>

            {publishResult && <div className="catalog-publish-result">
              <b>Publicación terminada</b>
              <p>{publishResult.updated.length} cuenta(s) actualizada(s), {publishResult.created.length} agregada(s), {publishResult.skipped.length} respetada(s).</p>
              {publishResult.skipped.length > 0 && <div className="catalog-skipped"><b>No se tocaron:</b><ul>{publishResult.skipped.map((item) => <li key={item.practiceId}>{item.practiceName} · {SKIP_REASON[item.reason] || item.reason}</li>)}</ul></div>}
              {publishResult.errors.length > 0 && <div className="form-error">⚠ {publishResult.errors.map((item) => `${item.practiceName}: ${item.message}`).join(' · ')}</div>}
            </div>}
          </>}
        </section>
      </div>
    </section>
  </main>
}
