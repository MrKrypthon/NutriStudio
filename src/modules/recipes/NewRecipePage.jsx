import { useEffect, useRef, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { ingredientsApi, recipesApi } from '../../lib/api.js'
import { clearRecipeDraft, getRecipeDraft, recipeDraftKey, saveRecipeDraft } from './recipeDraftStore.js'

const MEAL_TYPE_KEYS = { Desayuno: 'breakfast', Comida: 'lunch', Cena: 'dinner', Colación: 'snack', Postre: 'dessert', Salsa: 'sauce', Básico: 'base' }
const MEAL_TYPE_LABELS = { breakfast: 'Desayuno', lunch: 'Comida', dinner: 'Cena', snack: 'Colación', dessert: 'Postre', sauce: 'Salsa', base: 'Básico' }
const MEAL_TYPE_OPTIONS = ['Desayuno', 'Comida', 'Cena', 'Colación', 'Postre', 'Salsa', 'Básico']

const EMPTY_DRAFT = { name: '', meal: 'Desayuno', portions: 1, instructions: '', ingredientsText: '', chosen: [], imageFile: null }

const serializeDraft = (draft) => JSON.stringify({
  name: draft.name,
  meal: draft.meal,
  portions: Number(draft.portions) || 1,
  instructions: draft.instructions,
  ingredientsText: draft.ingredientsText,
  imageFile: draft.imageFile,
  chosen: draft.chosen.map((item) => ({ id: item.id, quantity: Number(item.quantity) })),
})

const serverToDraft = (recipe) => ({
  name: recipe.name,
  meal: MEAL_TYPE_LABELS[recipe.mealTypes?.[0]] || 'Desayuno',
  portions: Number(recipe.portions) || 1,
  instructions: recipe.instructions || '',
  ingredientsText: Array.isArray(recipe.ingredientsText) ? recipe.ingredientsText.join('\n') : '',
  chosen: (recipe.ingredients || []).map((item) => ({ id: item.ingredientId, name: item.ingredient.name, group: item.ingredient.group, unit: item.unit, quantity: Number(item.quantity), equivalence: Number(item.equivalence) || 1, serving: item.ingredient?.equivalence?.serving })),
  imageFile: recipe.imageFile || null,
})

export default function NewRecipePage({ setActive, recipeId }) {
  const draftKey = recipeDraftKey(recipeId)
  const [catalog, setCatalog] = useState([])
  const [searchState, setSearchState] = useState('idle')
  const [ingredientSearch, setIngredientSearch] = useState('')
  const [chosen, setChosen] = useState([])
  const [name, setName] = useState('')
  const [meal, setMeal] = useState('Desayuno')
  const [portions, setPortions] = useState(1)
  const [instructions, setInstructions] = useState('')
  const [ingredientsText, setIngredientsText] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [loadState, setLoadState] = useState(recipeId ? 'loading' : 'ready')
  const [saved, setSaved] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState('')
  const [recalcWarning, setRecalcWarning] = useState('')
  const [restored, setRestored] = useState(false)
  const [recipeSource, setRecipeSource] = useState(null)

  // Latest form values for the unmount handler, plus the "clean" snapshot to know whether there's
  // actually something worth keeping as a draft.
  const snapshotRef = useRef(EMPTY_DRAFT)
  const baselineRef = useRef(serializeDraft(EMPTY_DRAFT))
  const savedRef = useRef(false)

  const applyDraft = (draft) => {
    setName(draft.name)
    setMeal(draft.meal)
    setPortions(draft.portions)
    setInstructions(draft.instructions)
    setIngredientsText(draft.ingredientsText)
    setChosen(draft.chosen)
    setImageFile(draft.imageFile ?? null)
  }

  useEffect(() => {
    const query = ingredientSearch.trim()
    if (query.length < 2) { setCatalog([]); setSearchState('idle'); return }
    let cancelled = false
    setSearchState('loading')
    const timer = setTimeout(() => {
      ingredientsApi.list(`?search=${encodeURIComponent(query)}`).then((response) => { if (!cancelled) { setCatalog(response.items || []); setSearchState('online') } }).catch(() => { if (!cancelled) setSearchState('error') })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [ingredientSearch])

  // Editing an existing recipe: always read the server copy first (it's the clean baseline and
  // carries the photo), then overlay any in-memory draft the professional left behind.
  useEffect(() => {
    if (!recipeId) {
      const draft = getRecipeDraft(draftKey)
      if (draft) { applyDraft(draft); setRestored(true) }
      return
    }
    let cancelled = false
    setLoadState('loading')
    recipesApi.get(recipeId)
      .then((recipe) => {
        if (cancelled) return
        const server = serverToDraft(recipe)
        baselineRef.current = serializeDraft(server)
        const draft = getRecipeDraft(draftKey)
        applyDraft(draft ? { ...server, ...draft } : server)
        setRecipeSource(recipe.source || null)
        setRestored(Boolean(draft))
        setLoadState('ready')
      })
      .catch(() => { if (!cancelled) setLoadState('error') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId, draftKey])

  // Keep the latest snapshot available to the cleanup below; React state in a cleanup closure
  // would otherwise be frozen at mount time.
  snapshotRef.current = { name, meal, portions, instructions, ingredientsText, chosen, imageFile }

  // Leaving the form stores the draft in memory (only if it differs from the server copy), so
  // navigating back to the list and reopening the recipe brings the edits back.
  useEffect(() => () => {
    if (savedRef.current) return
    const current = snapshotRef.current
    if (serializeDraft(current) !== baselineRef.current) saveRecipeDraft(draftKey, current)
    else clearRecipeDraft(draftKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])

  const add = (item) => { if (!chosen.some((x) => x.id === item.id)) setChosen([...chosen, { ...item, quantity: 100, equivalence: 1, serving: item.equivalence?.serving }]) }
  const update = (id, key, value) => setChosen(chosen.map((item) => item.id === id ? { ...item, [key]: Number(value) } : item))

  const discardDraft = () => {
    clearRecipeDraft(draftKey)
    if (!recipeId) {
      applyDraft(EMPTY_DRAFT)
      baselineRef.current = serializeDraft(EMPTY_DRAFT)
      setRestored(false)
      return
    }
    setLoadState('loading')
    recipesApi.get(recipeId)
      .then((recipe) => {
        const server = serverToDraft(recipe)
        baselineRef.current = serializeDraft(server)
        applyDraft(server)
        setRecipeSource(recipe.source || null)
        setRestored(false)
        setLoadState('ready')
      })
      .catch(() => setLoadState('error'))
  }

  const save = async () => {
    const textLines = ingredientsText.split('\n').map((line) => line.trim()).filter(Boolean)
    if (!name || (!chosen.length && !textLines.length) || chosen.some((x) => Number(x.quantity) <= 0)) return
    setSaveState('saving')
    setSaveError('')
    // The quantity editor is labeled and computed in grams (per-100g nutrition math); persist that
    // unit explicitly instead of leaking the ingredient's native unit (e.g. "100 taza").
    const ingredients = chosen.map((item) => ({ ingredientId: item.id, quantity: item.quantity, unit: 'g', equivalence: item.equivalence }))
    try {
      if (recipeId) {
        await recipesApi.update(recipeId, { name, mealTypes: [MEAL_TYPE_KEYS[meal]], portions, ingredientsText: textLines, instructions: instructions || 'Preparación pendiente de completar.' })
        // Imported recipes have free-text ingredients but no catalog rows; replacing with an empty
        // list would be rejected by the API, so only touch linked ingredients when there are some.
        // For imported recipes the linked list is the SMAE calculation, so save it even when empty
        // (the API then clears the calculated side) — that's how the linkage is removed.
        if (recipeSource) await recipesApi.replaceIngredients(recipeId, ingredients)
        else if (ingredients.length) await recipesApi.replaceIngredients(recipeId, ingredients)
      } else {
        const created = await recipesApi.create({ name, mealTypes: [MEAL_TYPE_KEYS[meal]], portions, restrictions: [], ingredientsText: textLines, instructions: instructions || 'Preparación pendiente de completar.', ingredients })
        // A failed recalc would leave the recipe with 0-kcal nutrition and the success panel
        // would still say "guardada" — surface it instead of swallowing it. Free-text-only recipes
        // have no catalog macros to compute from, so skip the recalc entirely.
        setRecalcWarning('')
        if (ingredients.length) {
          try {
            await recipesApi.recalculate(created.id)
          } catch {
            setRecalcWarning('La receta se guardó, pero no se pudieron calcular sus nutrientes. Vuelve a abrirla para reintentar.')
          }
        }
      }
      savedRef.current = true
      clearRecipeDraft(draftKey)
      setSaveState('idle')
      setSaved(true)
    } catch (error) {
      setSaveState('error')
      setSaveError(error.message || 'No se pudo guardar la receta.')
    }
  }

  const textIngredientCount = ingredientsText.split('\n').filter((line) => line.trim()).length
  const hasAnyIngredient = chosen.length > 0 || textIngredientCount > 0

  return <AppChrome active={recipeId ? 'Editar receta' : 'Nueva receta'} setActive={setActive}><div className="content new-recipe">
    <button className="back-button" onClick={() => setActive('Recetas')}>← Recetas</button>
    <ModuleHeader eyebrow="RECETAS · CATÁLOGO PROPIO" title={recipeId ? 'Editar receta' : 'Crear receta'} subtitle="Construye una preparación con ingredientes revisados de tu catálogo." action={<span className="draft-label">{restored ? 'Borrador sin guardar' : recipeId ? 'Editando' : 'Borrador'}</span>} />

    {restored && <div className="draft-banner panel"><span>✎</span><p>Estás viendo un borrador sin guardar. Se conserva aunque salgas a la lista.</p><button type="button" className="link-button" onClick={discardDraft}>Descartar borrador</button></div>}

    {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando receta…</h3></div>}
    {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar la receta.</div>}

    {loadState === 'ready' && (saved ? <div className="success-panel panel"><span>✓</span><h2>Receta {recipeId ? 'actualizada' : 'guardada'} correctamente</h2><p>La receta guardó {chosen.length + textIngredientCount} ingrediente{chosen.length + textIngredientCount === 1 ? '' : 's'}.</p>{recalcWarning && <p className="form-error" style={{ marginTop: 10 }}>⚠ {recalcWarning}</p>}<button className="primary" onClick={() => setActive('Recetas')}>Ver recetario <span>→</span></button></div> : <div className="new-recipe-layout">
      <section className="panel recipe-form">
        <div className="form-section-title"><span>01</span><div><h2>Información de la receta</h2><p>Define cómo aparecerá en el plan del paciente.</p></div></div>
        <label>Nombre de la receta *<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Bowl de pollo con verduras" /></label>
        <div className="form-grid"><label>Tiempo de comida<select value={meal} onChange={(e) => setMeal(e.target.value)}>{MEAL_TYPE_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label><label>Porciones<input type="number" value={portions} min="1" onChange={(e) => setPortions(Number(e.target.value))} /></label></div>
        <div className="form-section-title second"><span>02</span><div><h2>Ingredientes locales</h2><p>Busca en tu catálogo (Sistema Mexicano de Equivalentes) y ajusta sus cantidades.</p></div></div>
        <div className="search-field">⌕ <input value={ingredientSearch} onChange={(e) => setIngredientSearch(e.target.value)} placeholder="Buscar ingrediente (mín. 2 letras)..." /></div>
        {ingredientSearch.trim().length >= 2 && searchState === 'error' && <p className="muted" style={{ margin: '10px 0' }}>No se pudo buscar — el API no responde.</p>}
        {ingredientSearch.trim().length >= 2 && searchState === 'online' && catalog.length === 0 && <p className="muted" style={{ margin: '10px 0' }}>Sin resultados para "{ingredientSearch.trim()}".</p>}
        <div className="ingredient-suggestions">{catalog.map((item) => <button type="button" onClick={() => add(item)} className={chosen.some((x) => x.id === item.id) ? 'added' : ''} key={item.id}><span>+</span>{item.name}<small>{item.group}</small></button>)}</div>
        <div className="recipe-form-ingredients">{chosen.map((item) => <div key={item.id}><span className="ingredient-icon">◉</span><div><b>{item.name}</b><small>{item.group} · {item.serving || 'Equivalencia local'}</small></div><input type="number" value={item.quantity} onChange={(e) => update(item.id, 'quantity', e.target.value)} /><span className="unit-label">g</span><button type="button" onClick={() => setChosen(chosen.filter((x) => x.id !== item.id))}>×</button></div>)}</div>
        {recipeSource && <div className="smae-hint"><p>Vincula ingredientes del catálogo SMAE con sus gramos para <b>contrastar</b> el cálculo contra los valores originales del recetario. Si falta algún ingrediente, agrégalo en <b>Ingredientes › Aproximados Menu 500</b>.</p><button type="button" className="link-button" onClick={() => setActive('Ingredientes')}>Ir a Ingredientes →</button></div>}
        <label style={{ marginTop: 14 }}>Ingredientes en texto libre<textarea className="wide-textarea" value={ingredientsText} onChange={(e) => setIngredientsText(e.target.value)} placeholder={'Uno por línea, ej.\n2 tazas de harina de almendras\n3 huevos'} /></label>
        <p className="muted" style={{ fontSize: 9, marginTop: 4 }}>Para recetas del recetario importado sin ingredientes ligados al catálogo. Se muestran tal cual y se escalan al ajustar porciones.</p>
        <div className="form-section-title second"><span>03</span><div><h2>Preparación</h2><p>Estos pasos se mostrarán al paciente.</p></div></div>
        <textarea className="wide-textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Escribe los pasos de preparación..." />
        {saveState === 'error' && <div className="form-error">⚠ {saveError}</div>}
        <div className="form-actions"><button type="button" className="secondary" onClick={() => setActive('Recetas')}>Cancelar</button><button type="button" className="primary" disabled={!name || !hasAnyIngredient || chosen.some((x) => Number(x.quantity) <= 0) || saveState === 'saving'} onClick={save}>{saveState === 'saving' ? 'Guardando…' : recipeId ? 'Guardar cambios' : 'Guardar receta'} <span>→</span></button></div>
      </section>
      <aside className="panel recipe-preview"><p className="eyebrow">VISTA PREVIA</p><div className={imageFile ? 'recipe-preview-image has-photo' : 'recipe-preview-image coral'}>{imageFile ? <img src={recipesApi.imageUrl(imageFile)} alt={name || 'Receta'} /> : '✦'}</div><span className="recipe-meal">{meal}</span><h2>{name || 'Nombre de tu receta'}</h2><p className="muted">Receta propia · {chosen.length + textIngredientCount} ingredientes</p><div className="preview-note">{chosen.length ? 'La nutrición se calculará automáticamente a partir de las cantidades guardadas.' : 'Los ingredientes en texto libre se escalan al ajustar porciones.'}</div></aside>
    </div>)}
  </div></AppChrome>
}
