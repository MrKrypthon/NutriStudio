import { useEffect, useMemo, useState } from 'react'
import { normalizeText, suggestRecipes, suggestRecipesByGroups } from '../../../server/domain/recipeSuggestions.js'
import { compareWithMeal, FAMILY_LABELS, itemsMacros, recipeItems } from '../../../server/domain/recipeEquivalents.js'
import { EQUIVALENT_BY_CODE } from '../../../server/domain/equivalents.js'
import RecipeEquivalentsEditor from './RecipeEquivalentsEditor.jsx'
import { clampFactor, scaledRecipeLines } from './planAdjustments.js'

const DAYS_IN_WEEK = 7
const BEST_PICKS = 5
const PAGE = 60
const MEAL_TYPE_LABELS = { breakfast: 'Desayuno', snack: 'Colaciones', lunch: 'Comida', dinner: 'Cena' }
const MICROS = [['fiber', 'Fibra', 'g'], ['sugar', 'Azúcar', 'g'], ['sodium', 'Sodio', 'mg'], ['calcium', 'Calcio', 'mg'], ['iron', 'Hierro', 'mg'], ['zinc', 'Zinc', 'mg'], ['selenium', 'Selenio', 'mcg'], ['folicAcid', 'Ácido fólico', 'mcg'], ['vitaminA', 'Vitamina A', 'mcg'], ['vitaminC', 'Vitamina C', 'mg'], ['vitaminD', 'Vitamina D', 'mcg'], ['vitaminE', 'Vitamina E', 'mg'], ['vitaminB12', 'Vitamina B12', 'mcg']]
const round1 = (value) => Math.round((Number(value) || 0) * 10) / 10
const formatCount = (value) => String(Math.round((Number(value) || 0) * 100) / 100)
const sameItems = (a, b) => JSON.stringify(a.map((item) => [item.ingredientId, item.name, item.grams])) === JSON.stringify(b.map((item) => [item.ingredientId, item.name, item.grams]))
const coverageTone = (coverage) => (coverage >= 90 ? 'ok' : coverage >= 60 ? 'low' : 'high')

// Dona de dónde viene la energía (hidratos, proteína, grasa), con las kcal al centro.
function MacroDonut({ macros }) {
  const parts = [['C', macros.carbs * 4, '#3f7d4f'], ['P', macros.protein * 4, '#e9a26b'], ['G', macros.fat * 9, '#5b8fd6']]
  const total = parts.reduce((sum, [, value]) => sum + value, 0) || 1
  let from = 0
  const stops = parts.map(([, value, color]) => { const to = from + (value / total) * 100; const stop = `${color} ${from}% ${to}%`; from = to; return stop })
  return <div className="gallery-donut-block">
    <div className="gallery-donut" style={{ background: `conic-gradient(${stops.join(',')})` }}><div><b>{Math.round(macros.kcal)}</b><small>KCAL</small></div></div>
    <ul>{parts.map(([label, value, color]) => <li key={label}><i style={{ color, borderColor: color }}>{label}</i>{round1((value / total) * 100)}%</li>)}</ul>
  </div>
}

// Recetas para un tiempo de comida, al estilo del constructor de Avena: una galería de fotos de la
// que se marcan las recetas de la semana. Con equivalentes repartidos al tiempo, "Para mi
// distribución" deja sólo las que están hechas de esos grupos, ordenadas por cuánto cubren, y cada
// una entra ya ajustada a esas porciones. Al abrir una receta se ven sus ingredientes por
// porciones (con intercambio por el sistema de equivalentes) y su información nutricional.
//
// `target` es lo calculado para el tiempo completo ({ kcal, protein, carbs, fat, source }) o null
// si el plan todavía no tiene requerimiento; `prescribed`, los equivalentes repartidos al tiempo;
// `current`, las recetas que el tiempo ya tiene en la semana y `adjustments` sus ajustes guardados.
export default function RecipeSuggestModal({ meal, recipes, target, prescribed, servings = 1, initialAvoid = [], exclude = [], current = [], adjustments = {}, renderThumb, locked, onApply, onClose, onGoToCalculation }) {
  const portions = Number(servings) || 1
  const byGroups = Boolean(prescribed && Object.values(prescribed).some((value) => Number(value) > 0))
  const canRank = Boolean(target && target.kcal > 0)
  const savedFor = (id) => adjustments?.[`${meal.key}|${id}`] || null
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState(canRank ? 'fit' : 'all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [avoidText, setAvoidText] = useState(initialAvoid.join(', '))
  const [selected, setSelected] = useState(current)
  // Cantidades editadas en esta ventana, por receta. Las que ya estaban en la semana y no se
  // tocan conservan el ajuste que tenían guardado.
  const [edits, setEdits] = useState({})
  const [openId, setOpenId] = useState(null)
  const [shown, setShown] = useState(PAGE)
  const avoid = useMemo(() => avoidText.split(',').map((term) => term.trim()).filter(Boolean), [avoidText])
  const recipeById = useMemo(() => new Map((recipes || []).map((recipe) => [recipe.id, recipe])), [recipes])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') { if (openId) setOpenId(null); else onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId, onClose])

  // Todas las recetas del tiempo calificadas contra lo calculado: por grupos si hay equivalentes
  // repartidos, por energía y macros si no.
  const ranked = useMemo(() => {
    if (!canRank) return []
    if (byGroups) return suggestRecipesByGroups(recipes, { recipeType: meal.recipeType, prescribed, servings: portions, avoid, exclude, count: 1000 })
    const perPortion = { kcal: target.kcal / portions, protein: target.protein / portions, carbs: target.carbs / portions, fat: target.fat / portions }
    return suggestRecipes(recipes, { recipeType: meal.recipeType, target: perPortion, avoid, exclude, count: 1000 })
      .map((item) => ({ ...item, kcal: Math.round(item.kcal * portions), protein: Math.round(item.protein * portions), carbs: Math.round(item.carbs * portions), fat: Math.round(item.fat * portions) }))
  }, [recipes, meal.recipeType, target, prescribed, byGroups, canRank, portions, avoid, exclude])
  const rankById = useMemo(() => new Map(ranked.map((item) => [item.recipe.id, item])), [ranked])

  const visible = useMemo(() => {
    const term = normalizeText(search).trim()
    const terms = avoid.map(normalizeText).map((value) => value.trim()).filter((value) => value.length >= 3)
    const pool = mode === 'fit'
      ? ranked.map((item) => item.recipe)
      : (recipes || [])
          .filter((recipe) => (!recipe.status || recipe.status === 'ACTIVE') && (recipe.mealTypes || []).includes(meal.recipeType))
          .filter((recipe) => { if (!terms.length) return true; const haystack = normalizeText(`${recipe.name} ${(recipe.ingredients || []).map((link) => link.ingredient?.name || '').join(' ')} ${recipe.ingredientsText || ''}`); return !terms.some((value) => haystack.includes(value)) })
          .sort((a, b) => a.name.localeCompare(b.name))
    return term ? pool.filter((recipe) => normalizeText(recipe.name).includes(term)) : pool
  }, [mode, ranked, recipes, meal.recipeType, search, avoid])
  useEffect(() => { setShown(PAGE) }, [mode, search, avoidText])

  const originalItems = (recipe) => recipeItems(recipe, portions)
  // Ingredientes con que la receta entra al plan: lo editado aquí, lo que ya tenía guardado o, si
  // se sugiere por grupos, ya ajustada a las porciones del tiempo.
  const itemsFor = (recipe) => edits[recipe.id] || savedFor(recipe.id)?.items || (byGroups ? rankById.get(recipe.id)?.items : null) || null
  const kept = (id) => current.includes(id) && !edits[id] && Boolean(savedFor(id))
  const isAdjusted = (recipe) => {
    if (kept(recipe.id)) return true
    const items = itemsFor(recipe)
    if (items) return !sameItems(items, originalItems(recipe))
    const rank = rankById.get(recipe.id)
    return Boolean(rank && !byGroups && rank.factor !== 1)
  }
  const toggle = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]))
  const selectedRecipes = selected.map((id) => recipeById.get(id)).filter(Boolean)
  const used = selectedRecipes.slice(0, DAYS_IN_WEEK)
  const adjustedCount = used.filter(isAdjusted).length
  const pickBest = () => setSelected(ranked.slice(0, BEST_PICKS).map((item) => item.recipe.id))

  const apply = () => onApply(used.map((recipe) => {
    if (kept(recipe.id)) return { recipe, keep: true }
    const items = itemsFor(recipe)
    if (items) {
      const original = originalItems(recipe)
      if (sameItems(items, original)) return { recipe, factor: 1, items: null }
      const base = itemsMacros(original).kcal
      return { recipe, factor: base > 0 ? clampFactor(itemsMacros(items).kcal / base) : 1, items }
    }
    return { recipe, factor: (!byGroups && rankById.get(recipe.id)?.factor) || 1, items: null }
  }))

  const open = openId ? recipeById.get(openId) : null
  const openItems = open ? (itemsFor(open) || originalItems(open)) : []
  const openOriginal = open ? originalItems(open) : []
  const openRank = open ? rankById.get(open.id) : null
  const openFactor = open && !openItems.length && !byGroups && openRank ? openRank.factor : 1
  const baseNutrition = open ? (open.calculatedNutrition || open.nutrition || {}) : {}
  const openMacros = open ? (openItems.length ? itemsMacros(openItems) : { kcal: (Number(baseNutrition.kcal) || 0) * portions * openFactor, protein: (Number(baseNutrition.protein) || 0) * portions * openFactor, carbs: (Number(baseNutrition.carbs) || 0) * portions * openFactor, fat: (Number(baseNutrition.fat) || 0) * portions * openFactor }) : null
  // Los micronutrientes siguen a la energía: se escalan con lo que cambió la receta.
  const microScale = open ? (openItems.length && itemsMacros(openOriginal).kcal > 0 ? itemsMacros(openItems).kcal / itemsMacros(openOriginal).kcal : openFactor) * portions : 1
  const openCompare = open && byGroups && openItems.length ? compareWithMeal(openItems, prescribed) : null
  const prescribedChips = byGroups ? Object.entries(prescribed).filter(([code, value]) => Number(value) > 0 && EQUIVALENT_BY_CODE[code]) : []

  const card = (recipe, index) => {
    const isOn = selected.includes(recipe.id)
    const rank = rankById.get(recipe.id)
    return <li key={recipe.id} className={'gallery-card' + (isOn ? ' selected' : '') + (openId === recipe.id ? ' open' : '')}>
      {isOn && <div className="gallery-card-flag"><span>Seleccionada</span><button type="button" disabled={locked} onClick={() => toggle(recipe.id)} aria-label={`Quitar ${recipe.name}`}>×</button></div>}
      <button type="button" className="gallery-card-photo" onClick={() => setOpenId(recipe.id)} title="Ver ingredientes e información nutricional">
        {renderThumb ? renderThumb(recipe, index, 'gallery-photo') : null}
        <span className="gallery-card-badges">
          {isOn && <i className="gallery-day">{(() => { const position = selected.indexOf(recipe.id) + 1; return position <= DAYS_IN_WEEK ? position : '★' })()}</i>}
          {byGroups && rank && <i className={'eq-chip ' + coverageTone(rank.coverage)} title="Cuánto de lo repartido a este tiempo cubre la receta">Cubre {rank.coverage}%</i>}
          {isOn && isAdjusted(recipe) && <i className="gallery-fit">Con ajuste</i>}
        </span>
      </button>
      {!isOn && !locked && <button type="button" className="gallery-card-pick" onClick={() => toggle(recipe.id)}>Seleccionar</button>}
      <button type="button" className="gallery-card-name" onClick={() => setOpenId(recipe.id)}>{recipe.name}</button>
      {rank && <small className="gallery-card-kcal">{rank.kcal} kcal{byGroups && rank.missing.length > 0 ? ` · falta ${rank.missing.map((family) => FAMILY_LABELS[family].toLowerCase()).join(', ')}` : ''}</small>}
    </li>
  }

  return <div className={'gallery-screen' + (open ? ' with-detail' : '')} role="dialog" aria-modal="true" aria-label={`Recetas para ${meal.label}`}>
    <section className="gallery-list">
      <header className="gallery-top">
        <button type="button" className="link-button gallery-back" onClick={onClose}>← Regresar al plan</button>
        <h2>Recetas para {meal.label}</h2>
        {!open && <button type="button" className="gallery-close" onClick={onClose} aria-label="Cerrar">×</button>}
      </header>

      <div className="gallery-toolbar">
        <div className="search-field">⌕ <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar receta" /></div>
        <div className="gallery-filter">
          <button type="button" className="secondary" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}>⚲ Ver filtros{avoid.length ? ` (${avoid.length})` : ''}</button>
          {filtersOpen && <div className="gallery-filter-panel">
            <b>Filtros</b>
            <label>Recetas
              <select value={mode} onChange={(event) => setMode(event.target.value)}>
                <option value="fit" disabled={!canRank}>Para mi distribución</option>
                <option value="all">Todas las recetas de {meal.label.toLowerCase()}</option>
              </select>
            </label>
            <label>Evitar <small>(separado por comas)</small>
              <input value={avoidText} onChange={(event) => setAvoidText(event.target.value)} placeholder="Ej. cacahuate, lactosa, hígado" />
              <small className="muted">{initialAvoid.length ? 'Tomado de las alergias, intolerancias y alimentos a evitar del expediente.' : 'El expediente no registra alimentos a evitar.'} Se descartan las recetas cuyo nombre o ingredientes contengan esas palabras.</small>
            </label>
            <div className="gallery-filter-actions"><button type="button" className="primary" onClick={() => setFiltersOpen(false)}>Aplicar</button></div>
          </div>}
        </div>
        <div className="view-switch gallery-mode">
          <button type="button" className={mode === 'fit' ? 'selected' : ''} disabled={!canRank} onClick={() => setMode('fit')}>Para mi distribución</button>
          <button type="button" className={mode === 'all' ? 'selected' : ''} onClick={() => setMode('all')}>Todas</button>
        </div>
        {canRank && !locked && <button type="button" className="secondary gallery-best" onClick={pickBest} title={`Marca las ${BEST_PICKS} que mejor se acercan a lo calculado`}>✦ Elegir las {BEST_PICKS} mejores</button>}
        {selected.length > 0 && !locked && <button type="button" className="gallery-count" onClick={() => setSelected([])} title="Quitar todas las seleccionadas">{selected.length} ×</button>}
      </div>

      {!target
        ? <p className="gallery-target">Este plan todavía no tiene requerimiento guardado: se muestra todo el catálogo de {meal.label.toLowerCase()}, sin ordenar. {onGoToCalculation && <button type="button" className="link-button" onClick={onGoToCalculation}>Ir al cálculo →</button>}</p>
        : <p className="gallery-target"><b>Calculado para {meal.label}:</b> {Math.round(target.kcal)} kcal · P {Math.round(target.protein)} g · HC {Math.round(target.carbs)} g · L {Math.round(target.fat)} g
          {prescribedChips.length > 0
            ? <span className="gallery-target-groups">{prescribedChips.map(([code, value]) => <i className="eq-chip" key={code}>{formatCount(value)} {EQUIVALENT_BY_CODE[code].label}{EQUIVALENT_BY_CODE[code].sub ? ` ${EQUIVALENT_BY_CODE[code].sub.toLowerCase()}` : ''}</i>)}</span>
            : <span className="muted"> · Este tiempo no tiene equivalentes repartidos: se ordena por energía y macros.</span>}</p>}

      <div className="gallery-scroll">
        {visible.length === 0
          ? <p className="muted gallery-empty">{mode === 'fit' ? `Ninguna receta de ${meal.label.toLowerCase()} con ingredientes del catálogo se acerca a lo repartido a este tiempo con esos filtros.` : `No hay recetas de ${meal.label.toLowerCase()} con ese nombre.`} {mode === 'fit' && <button type="button" className="link-button" onClick={() => setMode('all')}>Ver todas las recetas →</button>}</p>
          : <ul className="gallery-grid">{visible.slice(0, shown).map(card)}</ul>}
        {visible.length > shown && <button type="button" className="secondary gallery-more" onClick={() => setShown((value) => value + PAGE)}>Mostrar más ({visible.length - shown})</button>}
      </div>

      <footer className="gallery-bottom">
        <div className="gallery-stack">{selectedRecipes.slice(0, 4).map((recipe, index) => <span key={recipe.id}>{renderThumb ? renderThumb(recipe, index, 'gallery-stack-photo') : null}</span>)}{selectedRecipes.length > 4 && <span className="gallery-stack-more">+{selectedRecipes.length - 4}</span>}</div>
        <div className="gallery-bottom-text">
          <b>{selectedRecipes.length} {selectedRecipes.length === 1 ? 'receta seleccionada' : 'recetas seleccionadas'}</b>
          {adjustedCount > 0 && <small className="gallery-adjusted">{adjustedCount} con ajuste</small>}
          {selectedRecipes.length > DAYS_IN_WEEK ? <small className="muted">La semana tiene 7 días: se usan las primeras {DAYS_IN_WEEK}.</small>
            : selectedRecipes.length > 0 && selectedRecipes.length < DAYS_IN_WEEK ? <small className="muted">Los días restantes repiten desde la primera.</small> : null}
        </div>
        <button type="button" className="primary" disabled={locked || used.length === 0} onClick={apply}>Continuar</button>
      </footer>
    </section>

    {open && <section className="gallery-detail">
      <header className="gallery-top">
        <h2>{open.name}</h2>
        {!locked && <button type="button" className={selected.includes(open.id) ? 'primary' : 'secondary'} onClick={() => toggle(open.id)}>{selected.includes(open.id) ? 'Deseleccionar' : 'Seleccionar'}</button>}
        <button type="button" className="gallery-close" onClick={() => setOpenId(null)} aria-label="Cerrar la receta">×</button>
      </header>
      <div className="gallery-detail-body">
        <div className="gallery-detail-main">
          <div className="gallery-hero">
            {renderThumb ? renderThumb(open, 0, 'gallery-hero-photo') : null}
            <div><small className="gallery-label">Información nutricional</small><MacroDonut macros={openMacros} /></div>
          </div>

          {(open.mealTypes || []).length > 0 && <div className="gallery-block"><small className="gallery-label">Tiempos de comida</small><div className="gallery-mealtypes">{Object.entries(MEAL_TYPE_LABELS).map(([type, label]) => <span key={type} className={open.mealTypes.includes(type) ? 'on' : ''}>{open.mealTypes.includes(type) ? '☑' : '☐'} {label}</span>)}</div></div>}

          {openOriginal.length > 0
            ? <RecipeEquivalentsEditor key={open.id} live recipe={open} servings={portions} saved={{ items: openItems }} prescribed={prescribed} mealLabel={meal.label} locked={locked} onChange={(items) => setEdits((prev) => ({ ...prev, [open.id]: items }))} />
            : <div className="gallery-block">
              <div className="adjust-guide"><p>Esta receta no tiene sus ingredientes ligados al catálogo: no se puede comparar con los grupos ni intercambiar. {openFactor !== 1 ? 'Se propone con sus cantidades multiplicadas para acercarla al cálculo.' : 'Entra con sus cantidades originales.'}</p></div>
              <small className="gallery-label">Ingredientes</small>
              <ul className="gallery-lines">{scaledRecipeLines(open, portions, openFactor).map((line, index) => <li key={index}>{line}</li>)}</ul>
            </div>}

          {open.instructions && <div className="gallery-block"><small className="gallery-label">Preparación</small><ol className="gallery-steps">{String(open.instructions).split(/\n+/).map((step) => step.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean).map((step, index) => <li key={index}>{step}</li>)}</ol></div>}
        </div>

        <aside className="gallery-nutrition">
          <h3>Información nutricional</h3>
          <dl><div><dt>Kilocalorías</dt><dd>{Math.round(openMacros.kcal)} kcal</dd></div></dl>
          <h4>Macros</h4>
          <dl>
            <div><dt>Carbohidratos</dt><dd>{round1(openMacros.carbs)} g</dd></div>
            <div><dt>Proteína</dt><dd>{round1(openMacros.protein)} g</dd></div>
            <div><dt>Grasas</dt><dd>{round1(openMacros.fat)} g</dd></div>
          </dl>
          {openCompare && <><h4>Porciones por grupo</h4>
            <dl>{openCompare.rows.map((row) => <div key={row.code}><dt>{row.label}</dt><dd className={'gallery-status ' + row.status}>{formatCount(row.actual)}{row.target ? ` / ${formatCount(row.target)}` : ''}</dd></div>)}</dl></>}
          {MICROS.some(([key]) => Number(baseNutrition[key]) > 0) && <><h4>Micros</h4>
            <dl>{MICROS.filter(([key]) => Number(baseNutrition[key]) > 0).map(([key, label, unit]) => <div key={key}><dt>{label}</dt><dd>{round1(Number(baseNutrition[key]) * microScale)} {unit}</dd></div>)}</dl></>}
        </aside>
      </div>
    </section>}
  </div>
}
