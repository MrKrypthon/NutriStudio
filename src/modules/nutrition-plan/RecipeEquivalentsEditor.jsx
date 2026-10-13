import { useEffect, useMemo, useState } from 'react'
import { ingredientsApi } from '../../lib/api.js'
import { EQUIVALENT_BY_CODE } from '../../../server/domain/equivalents.js'
import { compareWithMeal, fitItemsToMeal, itemFromIngredient, itemLine, itemPortions, itemsMacros, recipeItems, setItemPortions, swapItem } from '../../../server/domain/recipeEquivalents.js'
import { clampFactor } from './planAdjustments.js'

const formatCount = (value) => { const number = Math.round((Number(value) || 0) * 100) / 100; return Number.isInteger(number) ? String(number) : String(number) }
const STATUS_TEXT = { ok: 'cumple', low: 'falta', high: 'excede', extra: 'no asignado' }
const groupLabel = (code) => { const group = EQUIVALENT_BY_CODE[code]; return group ? `${group.label}${group.sub ? ` · ${group.sub.toLowerCase()}` : ''}` : 'Sin grupo' }
const sameItems = (a, b) => JSON.stringify(a.map((item) => [item.ingredientId, item.name, item.grams])) === JSON.stringify(b.map((item) => [item.ingredientId, item.name, item.grams]))

// Buscador del catálogo de Ingredientes para intercambiar o agregar un alimento. Con `group` sólo
// ofrece alimentos de ese grupo (un intercambio conserva las porciones porque es el mismo grupo).
function IngredientPicker({ group, title, onPick, onCancel }) {
  const [search, setSearch] = useState('')
  const [result, setResult] = useState({ state: 'loading', items: [] })
  useEffect(() => {
    let cancelled = false
    setResult((prev) => ({ ...prev, state: 'loading' }))
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ ...(group ? { group } : {}), ...(search.trim() ? { search: search.trim() } : {}) }).toString()
      ingredientsApi.list(query ? `?${query}` : '')
        .then((response) => { if (!cancelled) setResult({ state: 'ready', items: response.items || [] }) })
        .catch(() => { if (!cancelled) setResult({ state: 'error', items: [] }) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [group, search])
  return <div className="req-picker">
    <div className="req-picker-head"><b>{title}</b><button type="button" className="link-button" onClick={onCancel}>Cancelar</button></div>
    <div className="search-field">⌕ <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={group ? `Buscar en ${group}…` : 'Buscar en todo el catálogo…'} /></div>
    {result.state === 'loading' && <p className="muted">Buscando…</p>}
    {result.state === 'error' && <p className="form-error">⚠ No se pudo consultar el catálogo.</p>}
    {result.state === 'ready' && result.items.length === 0 && <p className="muted">Sin alimentos con ese nombre.</p>}
    {result.items.length > 0 && <ul className="req-picker-list">{result.items.slice(0, 60).map((ingredient) => <li key={ingredient.id}><button type="button" onClick={() => onPick(ingredient)}><b>{ingredient.name}</b><span>{ingredient.equivalence?.serving ? `${ingredient.equivalence.serving}${ingredient.equivalence.grams ? ` · ${ingredient.equivalence.grams} g` : ''}` : ingredient.group}</span></button></li>)}</ul>}
  </div>
}

// La receta por equivalentes: cada ingrediente del catálogo con sus porciones de grupo, editable,
// con "Intercambiar" (otro alimento del mismo grupo) y "Ajustar a las porciones" (lleva cada grupo
// de la receta a lo calculado para el tiempo de comida). Sólo cambia en este plan.
export default function RecipeEquivalentsEditor({ recipe, servings, saved, prescribed, mealLabel, locked, onSave, onDirtyChange }) {
  const original = useMemo(() => recipeItems(recipe, servings), [recipe, servings])
  const [items, setItems] = useState(() => (saved?.items?.length ? saved.items : original))
  const [picker, setPicker] = useState(null)
  const baseline = saved?.items?.length ? saved.items : original
  const dirty = !sameItems(items, baseline)
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty])

  const comparison = compareWithMeal(items, prescribed)
  const macros = itemsMacros(items)
  const originalMacros = useMemo(() => itemsMacros(original), [original])
  const hasPrescription = comparison.rows.some((row) => row.target > 0)
  const update = (index, next) => setItems((prev) => prev.map((item, position) => (position === index ? next : item)))
  const remove = (index) => setItems((prev) => prev.filter((_, position) => position !== index))
  const pick = (ingredient) => {
    if (picker.index === 'new') {
      const fresh = itemFromIngredient(ingredient, Number(ingredient.equivalence?.grams) || 100)
      setItems((prev) => [...prev, fresh])
    } else update(picker.index, swapItem(items[picker.index], ingredient))
    setPicker(null)
  }
  const save = () => {
    if (sameItems(items, original)) { onSave(null); return }
    // El factor resume cuánto cambió la energía respecto a la receta original: con él siguen al
    // ajuste la adecuación del plan y los micronutrientes.
    const factor = originalMacros.kcal > 0 ? clampFactor(macros.kcal / originalMacros.kcal) : 1
    onSave({ lines: items.map(itemLine), factor, items })
  }

  return <div className="req-editor">
    <div className="adjust-guide">
      {hasPrescription
        ? <><p><b>{comparison.fits ? `✓ La receta cumple con las porciones de ${mealLabel}.` : `La receta no coincide con las porciones de ${mealLabel}:`}</b></p>
          <div className="req-compare">{comparison.rows.map((row) => <span key={row.code} className={'eq-chip ' + (row.status === 'ok' ? 'ok' : row.status === 'low' ? 'low' : 'high')} title={row.label}>{row.label}: {formatCount(row.actual)}{row.target ? ` de ${formatCount(row.target)}` : ''} · {STATUS_TEXT[row.status]}</span>)}</div></>
        : <p className="muted">Este tiempo de comida no tiene equivalentes repartidos (paso Equivalentes): puedes editar las porciones a mano.</p>}
      <p className="muted">Aporte con estas cantidades: <b>{Math.round(macros.kcal)} kcal</b> · P {formatCount(macros.protein)} g · HC {formatCount(macros.carbs)} g · L {formatCount(macros.fat)} g{Math.round(originalMacros.kcal) !== Math.round(macros.kcal) ? ` (la receta original: ${Math.round(originalMacros.kcal)} kcal)` : ''}.</p>
    </div>

    <div className="req-table">
      <div className="req-row req-head"><span>Porciones</span><span>Grupo</span><span>Alimento</span><span>Cantidad</span><span /></div>
      {items.map((item, index) => {
        const portions = itemPortions(item)
        return <div className="req-row" key={`${item.ingredientId || item.name}-${index}`}>
          {item.gramsPerEq
            ? <input type="number" min="0.25" max="40" step="0.25" disabled={locked} value={portions ?? ''} aria-label={`Porciones de ${item.name}`} onChange={(event) => update(index, setItemPortions(item, event.target.value))} />
            : <input type="number" min="1" max="5000" step="1" disabled={locked} value={item.grams} aria-label={`Gramos de ${item.name}`} title="Este alimento no tiene medida de equivalente: se edita en gramos" onChange={(event) => update(index, { ...item, grams: Math.max(0, Number(event.target.value) || 0) })} />}
          <span className="req-group">{item.code ? groupLabel(item.code) : <i className="muted">{item.catalogGroup || 'Sin grupo'}</i>}{item.code && item.basis && item.basis !== 'smae' && <small className="req-basis" title={item.basis === 'calculada' ? 'Este alimento no viene del SMAE: su equivalente se calculó con su composición (lo que aporta por 100 g).' : 'Este alimento no trae grupo: el grupo y su equivalente se estimaron con su composición. Conviene revisarlo.'}>{item.basis === 'calculada' ? 'calculado' : 'estimado'}</small>}</span>
          <b>{item.name}</b>
          <span className="muted">{itemLine(item).replace(` de ${item.name}`, '')}</span>
          {!locked && <span className="req-actions"><button type="button" className="secondary" onClick={() => setPicker({ index, group: item.catalogGroup || null })}>⇄ Intercambiar</button><button type="button" className="link-button" onClick={() => remove(index)} aria-label={`Quitar ${item.name}`} title="Quitar">×</button></span>}
        </div>
      })}
      {items.length === 0 && <p className="muted req-empty">La receta quedó sin ingredientes.</p>}
    </div>

    {picker && <IngredientPicker group={picker.index === 'new' ? null : picker.group} title={picker.index === 'new' ? 'Agregar un alimento del catálogo' : `Intercambiar ${items[picker.index]?.name} por otro de su grupo`} onPick={pick} onCancel={() => setPicker(null)} />}

    {!locked && <div className="adjust-tools">
      {hasPrescription && !comparison.fits && <button type="button" className="secondary" onClick={() => setItems(fitItemsToMeal(items, prescribed))}>✦ Ajustar a las porciones de {mealLabel}</button>}
      <button type="button" className="secondary" onClick={() => setPicker({ index: 'new', group: null })}>+ Agregar alimento</button>
      <button type="button" className="link-button" onClick={() => setItems(original)}>Volver a la receta original</button>
      <button type="button" className="primary req-save" disabled={!dirty} onClick={save}>Guardar para este plan</button>
    </div>}
  </div>
}
