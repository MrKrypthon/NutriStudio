import { useMemo, useState } from 'react'
import { suggestRecipes } from '../../../server/domain/recipeSuggestions.js'
import { backdropClose, formatFactor } from './planAdjustments.js'

const MAX_SUGGESTIONS = 8
const PRESELECTED = 5
const DAYS_IN_WEEK = 7
const MACROS = [['protein', 'P'], ['carbs', 'HC'], ['fat', 'L']]
const formatServings = (value) => { const number = Number(value) || 1; return Number.isInteger(number) ? String(number) : number.toFixed(1) }

// Sugerencia de recetas para un tiempo de comida: las del catálogo que mejor se acercan a lo
// calculado para ese tiempo, sin los alimentos que la paciente evita. La nutrióloga marca las que
// quiere y con ellas se llena la semana de ese tiempo; cada una entra con sus cantidades ya
// multiplicadas por el factor que la acerca al cálculo.
//
// `target` es lo calculado para el tiempo completo ({ kcal, protein, carbs, fat, source }) o null
// si el plan todavía no tiene requerimiento. `servings` son las porciones del tiempo de comida:
// la receta se busca para una porción (target ÷ porciones) y los valores se muestran ya servidos.
export default function RecipeSuggestModal({ meal, recipes, target, servings = 1, initialAvoid = [], exclude = [], renderThumb, locked, onApply, onClose, onGoToCalculation }) {
  const portions = Number(servings) || 1
  const [avoidText, setAvoidText] = useState(initialAvoid.join(', '))
  // null = todavía no se toca la selección: van marcadas las primeras de la lista.
  const [picked, setPicked] = useState(null)
  const avoid = useMemo(() => avoidText.split(',').map((term) => term.trim()).filter(Boolean), [avoidText])
  const suggestions = useMemo(() => {
    if (!target || !(target.kcal > 0)) return []
    const perPortion = { kcal: target.kcal / portions, protein: target.protein / portions, carbs: target.carbs / portions, fat: target.fat / portions }
    return suggestRecipes(recipes, { recipeType: meal.recipeType, target: perPortion, avoid, exclude, count: MAX_SUGGESTIONS })
      .map((item) => ({ ...item, baseKcal: Math.round((Number((item.recipe.calculatedNutrition || item.recipe.nutrition || {}).kcal) || 0) * portions), kcal: Math.round(item.kcal * portions), protein: Math.round(item.protein * portions), carbs: Math.round(item.carbs * portions), fat: Math.round(item.fat * portions) }))
  }, [recipes, meal.recipeType, target, portions, avoid, exclude])
  const isSelected = (item, index) => (picked ? picked.has(item.recipe.id) : index < PRESELECTED)
  const selected = suggestions.filter(isSelected)
  const toggle = (id) => {
    const next = new Set(selected.map((item) => item.recipe.id))
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }
  const average = (key) => (selected.length ? Math.round(selected.reduce((sum, item) => sum + item[key], 0) / selected.length) : 0)
  const used = selected.slice(0, DAYS_IN_WEEK)

  return <div className="modal-backdrop" {...backdropClose(onClose)}><div className="modal recipe-suggest-modal">
    <div className="modal-head"><div><p className="eyebrow">SUGERIR RECETAS · {meal.label.toUpperCase()}</p><h2>Recetas que se acercan al cálculo</h2><span className="modal-subtitle">Es una propuesta: marca las que quieras y se reparten en la semana de este tiempo de comida.</span></div><button type="button" onClick={onClose} aria-label="Cerrar">×</button></div>

    {!target ? <div className="adjust-guide"><p>Todavía no hay requerimiento guardado para este plan: calcula y guarda el requerimiento en el paso "Plan alimentario" para poder sugerir recetas. {onGoToCalculation && <button type="button" className="link-button" onClick={onGoToCalculation}>Ir al cálculo →</button>}</p></div> : <>
      <div className="adjust-guide">
        <p><b>Calculado para {meal.label}:</b> {Math.round(target.kcal)} kcal · P {Math.round(target.protein)} g · HC {Math.round(target.carbs)} g · L {Math.round(target.fat)} g{portions !== 1 ? ` (en ${formatServings(portions)} porciones)` : ''}</p>
        <p className="muted">{target.source === 'equivalents' ? 'Según los equivalentes repartidos a este tiempo de comida.' : 'Este tiempo todavía no tiene equivalentes repartidos: se usa su parte proporcional del requerimiento del día.'}</p>
        {selected.length > 0 && <p><b>Promedio de las {selected.length} marcadas:</b> {average('kcal')} kcal ({Math.round((average('kcal') / target.kcal) * 100)}%) · P {average('protein')} g · HC {average('carbs')} g · L {average('fat')} g</p>}
      </div>

      <label className="suggest-avoid">Evitar <small>(separado por comas)</small>
        <input value={avoidText} onChange={(event) => setAvoidText(event.target.value)} placeholder="Ej. cacahuate, lactosa, hígado" />
        <small className="muted">{initialAvoid.length ? 'Tomado de las alergias, intolerancias y alimentos a evitar del expediente; puedes quitar o agregar.' : 'El expediente no registra alimentos a evitar; puedes escribir los que quieras excluir.'} Se descartan las recetas cuyo nombre o ingredientes contengan esas palabras.</small>
      </label>

      {suggestions.length === 0
        ? <p className="muted suggest-empty">No hay recetas de {meal.label.toLowerCase()} que se acerquen a este cálculo con esos filtros. Prueba quitando términos de "Evitar" o elige la receta a mano.</p>
        : <ul className="suggest-list">{suggestions.map((item, index) => <li key={item.recipe.id}><label className={'suggest-row' + (isSelected(item, index) ? ' selected' : '')}>
            <input type="checkbox" checked={isSelected(item, index)} disabled={locked} onChange={() => toggle(item.recipe.id)} />
            {renderThumb ? renderThumb(item.recipe, index) : null}
            <span className="suggest-info"><b>{item.recipe.name}</b><small>{item.baseKcal} kcal · ×{formatFactor(item.factor)} → {item.kcal} kcal</small><small className="muted">{MACROS.map(([key, label]) => `${label} ${item[key]} g`).join(' · ')}</small></span>
          </label></li>)}</ul>}
      {selected.length > DAYS_IN_WEEK && <p className="muted">La semana tiene 7 días: se usan las primeras {DAYS_IN_WEEK} marcadas.</p>}
      {selected.length > 0 && selected.length < DAYS_IN_WEEK && <p className="muted">Con {selected.length} {selected.length === 1 ? 'receta' : 'recetas'}, los días restantes repiten desde la primera.</p>}
    </>}

    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cerrar</button>{target && <button type="button" className="primary" disabled={locked || used.length === 0} onClick={() => onApply(used.map((item) => ({ recipe: item.recipe, factor: item.factor })))}>Usar las seleccionadas ({used.length})</button>}</div>
  </div></div>
}
