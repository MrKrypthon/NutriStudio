import { useEffect, useState } from 'react'
import AppChrome from '../../components/AppChrome.jsx'
import ModuleHeader from '../../components/ModuleHeader.jsx'
import { ingredientsApi, recipesApi } from '../../lib/api.js'

const MEAL_TYPE_KEYS = { Desayuno: 'breakfast', Comida: 'lunch', Colación: 'snack', Cena: 'dinner' }
const MEAL_TYPE_LABELS = { breakfast: 'Desayuno', lunch: 'Comida', snack: 'Colación', dinner: 'Cena' }

export default function NewRecipePage({ setActive, recipeId }) {
  const [catalog, setCatalog] = useState([])
  const [searchState, setSearchState] = useState('idle')
  const [ingredientSearch, setIngredientSearch] = useState('')
  const [chosen, setChosen] = useState([])
  const [name, setName] = useState('')
  const [meal, setMeal] = useState('Desayuno')
  const [portions, setPortions] = useState(1)
  const [instructions, setInstructions] = useState('')
  const [loadState, setLoadState] = useState(recipeId ? 'loading' : 'ready')
  const [saved, setSaved] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState('')

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

  useEffect(() => {
    if (!recipeId) return
    let cancelled = false
    recipesApi.get(recipeId)
      .then((recipe) => {
        if (cancelled) return
        setName(recipe.name)
        setMeal(MEAL_TYPE_LABELS[recipe.mealTypes?.[0]] || 'Desayuno')
        setPortions(Number(recipe.portions) || 1)
        setInstructions(recipe.instructions || '')
        setChosen((recipe.ingredients || []).map((item) => ({ id: item.ingredientId, name: item.ingredient.name, group: item.ingredient.group, unit: item.unit, quantity: Number(item.quantity), equivalence: Number(item.equivalence) || 1, serving: item.ingredient?.equivalence?.serving })))
        setLoadState('ready')
      })
      .catch(() => setLoadState('error'))
    return () => { cancelled = true }
  }, [recipeId])

  const add = (item) => { if (!chosen.some((x) => x.id === item.id)) setChosen([...chosen, { ...item, quantity: 100, equivalence: 1, serving: item.equivalence?.serving }]) }
  const update = (id, key, value) => setChosen(chosen.map((item) => item.id === id ? { ...item, [key]: Number(value) } : item))

  const save = async () => {
    if (!name || !chosen.length) return
    setSaveState('saving')
    setSaveError('')
    const ingredients = chosen.map((item) => ({ ingredientId: item.id, quantity: item.quantity, unit: item.unit || 'g', equivalence: item.equivalence }))
    try {
      if (recipeId) {
        await recipesApi.update(recipeId, { name, mealTypes: [MEAL_TYPE_KEYS[meal]], portions, instructions: instructions || 'Preparación pendiente de completar.' })
        await recipesApi.replaceIngredients(recipeId, ingredients)
      } else {
        const created = await recipesApi.create({ name, mealTypes: [MEAL_TYPE_KEYS[meal]], portions, restrictions: [], instructions: instructions || 'Preparación pendiente de completar.', ingredients })
        await recipesApi.recalculate(created.id).catch(() => {})
      }
      setSaveState('idle')
      setSaved(true)
    } catch (error) {
      setSaveState('error')
      setSaveError(error.message || 'No se pudo guardar la receta.')
    }
  }

  return <AppChrome active={recipeId ? 'Editar receta' : 'Nueva receta'} setActive={setActive}><div className="content new-recipe">
    <button className="back-button" onClick={() => setActive('Recetas')}>← Recetas</button>
    <ModuleHeader eyebrow="RECETAS · CATÁLOGO PROPIO" title={recipeId ? 'Editar receta' : 'Crear receta'} subtitle="Construye una preparación con ingredientes revisados de tu catálogo." action={<span className="draft-label">{recipeId ? 'Editando' : 'Borrador'}</span>} />

    {loadState === 'loading' && <div className="result-empty panel"><span className="loading-dot">●</span><h3>Cargando receta…</h3></div>}
    {loadState === 'error' && <div className="form-error">⚠ No se pudo cargar la receta.</div>}

    {loadState === 'ready' && (saved ? <div className="success-panel panel"><span>✓</span><h2>Receta {recipeId ? 'actualizada' : 'guardada'} correctamente</h2><p>La receta ya está relacionada con {chosen.length} ingrediente{chosen.length === 1 ? '' : 's'} locales.</p><button className="primary" onClick={() => setActive('Recetas')}>Ver recetario <span>→</span></button></div> : <div className="new-recipe-layout">
      <section className="panel recipe-form">
        <div className="form-section-title"><span>01</span><div><h2>Información de la receta</h2><p>Define cómo aparecerá en el plan del paciente.</p></div></div>
        <label>Nombre de la receta *<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Bowl de pollo con verduras" /></label>
        <div className="form-grid"><label>Tiempo de comida<select value={meal} onChange={(e) => setMeal(e.target.value)}><option>Desayuno</option><option>Comida</option><option>Colación</option><option>Cena</option></select></label><label>Porciones<input type="number" value={portions} min="1" onChange={(e) => setPortions(Number(e.target.value))} /></label></div>
        <div className="form-section-title second"><span>02</span><div><h2>Ingredientes locales</h2><p>Busca en tu catálogo (Sistema Mexicano de Equivalentes) y ajusta sus cantidades.</p></div></div>
        <div className="search-field">⌕ <input value={ingredientSearch} onChange={(e) => setIngredientSearch(e.target.value)} placeholder="Buscar ingrediente (mín. 2 letras)..." /></div>
        {ingredientSearch.trim().length >= 2 && searchState === 'error' && <p className="muted" style={{ margin: '10px 0' }}>No se pudo buscar — el API no responde.</p>}
        {ingredientSearch.trim().length >= 2 && searchState === 'online' && catalog.length === 0 && <p className="muted" style={{ margin: '10px 0' }}>Sin resultados para "{ingredientSearch.trim()}".</p>}
        <div className="ingredient-suggestions">{catalog.map((item) => <button type="button" onClick={() => add(item)} className={chosen.some((x) => x.id === item.id) ? 'added' : ''} key={item.id}><span>+</span>{item.name}<small>{item.group}</small></button>)}</div>
        <div className="recipe-form-ingredients">{chosen.map((item) => <div key={item.id}><span className="ingredient-icon">◉</span><div><b>{item.name}</b><small>{item.group} · {item.serving || 'Equivalencia local'}</small></div><input type="number" value={item.quantity} onChange={(e) => update(item.id, 'quantity', e.target.value)} /><span className="unit-label">g</span><button type="button" onClick={() => setChosen(chosen.filter((x) => x.id !== item.id))}>×</button></div>)}</div>
        <div className="form-section-title second"><span>03</span><div><h2>Preparación</h2><p>Estos pasos se mostrarán al paciente.</p></div></div>
        <textarea className="wide-textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Escribe los pasos de preparación..." />
        {saveState === 'error' && <div className="form-error">⚠ {saveError}</div>}
        <div className="form-actions"><button type="button" className="secondary" onClick={() => setActive('Recetas')}>Cancelar</button><button type="button" className="primary" disabled={!name || !chosen.length || saveState === 'saving'} onClick={save}>{saveState === 'saving' ? 'Guardando…' : recipeId ? 'Guardar cambios' : 'Guardar receta'} <span>→</span></button></div>
      </section>
      <aside className="panel recipe-preview"><p className="eyebrow">VISTA PREVIA</p><div className="recipe-preview-image coral">✦</div><span className="recipe-meal">{meal}</span><h2>{name || 'Nombre de tu receta'}</h2><p className="muted">Receta propia · {chosen.length} ingredientes</p><div className="preview-note">La nutrición se calculará automáticamente a partir de las cantidades guardadas.</div></aside>
    </div>)}
  </div></AppChrome>
}
