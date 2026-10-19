import { EQUIVALENT_MEALS, EQUIVALENT_TABLE, addTotals, equivalentTotals, extrasTotals, remainingEquivalents, toHalf } from '../../../server/domain/equivalents.js'

const formatCount = (value) => { const number = Number(value) || 0; return Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100) }
const MAX_THUMBS = 3

function Cell({ value, onChange, disabled, label }) {
  const count = Number(value) || 0
  return <input className={'dm-cell' + (count > 0 ? ' filled' : '')} type="number" min="0" max="40" step="0.5" inputMode="decimal" disabled={disabled} value={count || ''} placeholder="0" aria-label={label} onChange={(event) => onChange(toHalf(event.target.value))} />
}

// "Distribuye porciones por día y selecciona recetas", como en Avena: un renglón por grupo de
// alimentos con lo repartido contra lo calculado, una columna por tiempo de comida con sus recetas
// y el botón "Ver recetas", y al pie el aporte y el horario de cada tiempo.
//
// `value` es el cuadro de equivalentes del menú ({ groups, distribution, extras }); los cambios al
// reparto salen por `onChange`. Lo demás (recetas, horas, tiempos) lo maneja quien lo usa.
export default function DistributeMatrix({ value, onChange, meals, hiddenMeals, mealTimes, suggestedTimes, locked, recipesFor, renderThumb, adjustedCount, mealRecipeKcal, servingsFor, onServings, onViewRecipes, onAdjust, onRenameMeal, onRemoveMeal, onAddMeal, onTimeChange, onDistribute, onGoToPortions }) {
  const groups = value?.groups || {}
  const distribution = value?.distribution || {}
  const extras = value?.extras || []
  const rows = EQUIVALENT_TABLE.filter((group) => (Number(groups[group.code]) || 0) > 0 || EQUIVALENT_MEALS.some((meal) => (Number(distribution[meal.key]?.[group.code]) || 0) > 0))
  // Las columnas salen del CSS (.dm-row) con el número de tiempos; en el celular la primera es más
  // angosta y se queda fija al desplazar de lado.
  const columns = { '--dm-cols': meals.length }
  const emit = (nextDistribution, nextExtras = extras) => onChange({ groups, distribution: nextDistribution, extras: nextExtras })
  const setMealCount = (mealKey, code, count) => {
    const meal = { ...(distribution[mealKey] || {}) }
    if (count > 0) meal[code] = count
    else delete meal[code]
    emit({ ...distribution, [mealKey]: meal })
  }
  const setExtraCount = (index, mealKey, count) => emit(distribution, extras.map((extra, position) => {
    if (position !== index) return extra
    const next = { ...(extra.meals || {}) }
    if (count > 0) next[mealKey] = count
    else delete next[mealKey]
    return { ...extra, meals: next }
  }))
  const hasShare = meals.some((meal) => Object.keys(distribution[meal.key] || {}).length > 0)

  return <section className="panel dm-panel">
    <div className="dm-title">
      <div><h3>Distribuye porciones por día y selecciona recetas</h3><small className="muted">Reparte cada grupo entre los tiempos de comida y elige con “Ver recetas” las preparaciones de cada uno.</small></div>
      {!locked && rows.length > 0 && <button type="button" className="secondary" onClick={onDistribute}>✦ {hasShare ? 'Volver a repartir' : 'Repartir automáticamente'}</button>}
    </div>
    <div className="dm-scroll"><div className="dm-table" role="table">
      <div className="dm-row dm-head" role="row" style={columns}>
        <div className="dm-corner">
          <small>Grupos y porciones</small>
          {!locked && hiddenMeals.length > 0 && <select value="" onChange={(event) => onAddMeal(event.target.value)} aria-label="Agregar tiempo de comida"><option value="">+ Agregar tiempo</option>{hiddenMeals.map((meal) => <option value={meal.key} key={meal.key}>{meal.label}</option>)}</select>}
        </div>
        {meals.map((meal, mealIndex) => {
          const chosen = recipesFor(meal.key)
          const adjusted = adjustedCount(meal.key)
          return <div className="dm-meal" key={meal.key}>
            <div className="dm-meal-name">
              {locked ? <b>{meal.label}</b> : <button type="button" onClick={() => onRenameMeal(meal)} title="Cambiar el nombre de este tiempo de comida"><b>{meal.label}</b> ✎</button>}
              {!locked && meals.length > 1 && <button type="button" className="dm-meal-remove" onClick={() => onRemoveMeal(meal)} aria-label={`Quitar ${meal.label}`} title={`Quitar ${meal.label}`}>×</button>}
            </div>
            <button type="button" className={'dm-stack' + (chosen.length ? '' : ' empty')} onClick={() => onViewRecipes(meal)} title={chosen.length ? chosen.map((recipe) => recipe.name).join(' · ') : 'Todavía sin recetas'}>
              {chosen.length === 0 && <span className="dm-stack-zero">0</span>}
              {chosen.slice(0, MAX_THUMBS).map((recipe, index) => <span key={recipe.id}>{renderThumb(recipe, mealIndex + index, 'dm-thumb')}</span>)}
              {chosen.length > MAX_THUMBS && <span className="dm-stack-more">+{chosen.length - MAX_THUMBS}</span>}
            </button>
            <button type="button" className="primary dm-view suggest-button" onClick={() => onViewRecipes(meal)}>Ver recetas</button>
            {chosen.length > 0 && <button type="button" className="link-button dm-adjust" onClick={() => onAdjust(meal)}>{adjusted > 0 ? `${adjusted} con ajuste · editar` : 'Ajustar porciones'}</button>}
          </div>
        })}
      </div>

      {rows.length === 0 && extras.length === 0 && locked && <p className="muted dm-empty">Este menú se armó sin porciones por grupo: sólo con recetas.</p>}
      {rows.length === 0 && extras.length === 0 && !locked && <p className="muted dm-empty">Este menú todavía no tiene porciones calculadas. <button type="button" className="link-button" onClick={onGoToPortions}>Calcúlalas en el paso Porciones</button> para repartirlas aquí; mientras tanto puedes elegir recetas.</p>}

      {rows.map((group) => {
        const total = Number(groups[group.code]) || 0
        const remaining = remainingEquivalents(groups, distribution, group.code)
        const name = `${group.label}${group.sub ? ` ${group.sub.toLowerCase()}` : ''}`
        return <div className="dm-row" role="row" style={columns} key={group.code}>
          <div className="dm-group"><span>{name}</span><i className={'dm-badge ' + (remaining === 0 ? 'ok' : remaining > 0 ? 'low' : 'high')} title={remaining === 0 ? 'Repartido completo' : remaining > 0 ? `Faltan ${formatCount(remaining)} por repartir` : `Sobran ${formatCount(-remaining)}`}>{formatCount(total - remaining)} / {formatCount(total)}</i></div>
          {meals.map((meal) => <div className="dm-slot" key={meal.key}><Cell value={distribution[meal.key]?.[group.code]} disabled={locked} label={`${name} en ${meal.label}`} onChange={(next) => setMealCount(meal.key, group.code, next)} /></div>)}
        </div>
      })}

      {extras.map((extra, index) => {
        const assigned = meals.reduce((sum, meal) => sum + (Number(extra.meals?.[meal.key]) || 0), 0)
        return <div className="dm-row dm-extra" role="row" style={columns} key={extra.id || index}>
          <div className="dm-group"><span>{extra.name || 'Suplemento sin nombre'}</span><i className={'dm-badge ' + (assigned > 0 ? 'ok' : 'low')} title="Porciones de este suplemento o bebida repartidas en el día">{formatCount(assigned)}</i></div>
          {meals.map((meal) => <div className="dm-slot" key={meal.key}><Cell value={extra.meals?.[meal.key]} disabled={locked} label={`${extra.name || 'Suplemento'} en ${meal.label}`} onChange={(next) => setExtraCount(index, meal.key, next)} /></div>)}
        </div>
      })}

      <div className="dm-row dm-foot" role="row" style={columns}>
        <div className="dm-group"><span>Aporte del tiempo</span></div>
        {meals.map((meal) => {
          const totals = addTotals(equivalentTotals(distribution[meal.key]), extrasTotals(extras, meal.key))
          const energy = totals.carbs * 4 + totals.protein * 4 + totals.fat * 9 || 1
          const share = (grams, factor) => Math.round((grams * factor / energy) * 100)
          const actual = mealRecipeKcal(meal.key)
          return <div className="dm-totals" key={meal.key}>
            {totals.kcal > 0 ? <><b>{formatCount(totals.kcal)} kcal</b>
              <small>HCO: {formatCount(totals.carbs)} g ({share(totals.carbs, 4)}%)</small>
              <small>Proteína: {formatCount(totals.protein)} g ({share(totals.protein, 4)}%)</small>
              <small>Grasas: {formatCount(totals.fat)} g ({share(totals.fat, 9)}%)</small></> : <small className="muted">Sin porciones</small>}
            {actual != null && <small className={'dm-actual' + (totals.kcal > 0 && Math.abs(actual - totals.kcal) > Math.max(40, totals.kcal * 0.15) ? ' off' : '')} title="Promedio de las recetas elegidas para este tiempo, con sus ajustes">Recetas: {actual} kcal</small>}
          </div>
        })}
      </div>

      <div className="dm-row dm-foot" role="row" style={columns}>
        <div className="dm-group"><span>Horario sugerido</span></div>
        {meals.map((meal) => <div className="dm-time" key={meal.key}>
          <input type="time" disabled={locked} value={mealTimes?.[meal.key] || ''} onChange={(event) => onTimeChange(meal.key, event.target.value)} aria-label={`Hora de ${meal.label}`} />
          {!locked && !mealTimes?.[meal.key] && suggestedTimes?.[meal.key] && <button type="button" className="link-button" onClick={() => onTimeChange(meal.key, suggestedTimes[meal.key])}>Usar {suggestedTimes[meal.key]}</button>}
        </div>)}
      </div>

      <div className="dm-row dm-foot" role="row" style={columns}>
        <div className="dm-group"><span>Raciones de receta</span><small className="muted">Cuántas porciones de la receta se sirven</small></div>
        {meals.map((meal) => <div className="dm-servings" key={meal.key}>
          <button type="button" disabled={locked} onClick={() => onServings(meal.key, -0.5)} aria-label={`Menos raciones de ${meal.label}`}>−</button>
          <b>{servingsFor(meal.key)}</b>
          <button type="button" disabled={locked} onClick={() => onServings(meal.key, 0.5)} aria-label={`Más raciones de ${meal.label}`}>+</button>
        </div>)}
      </div>
    </div></div>
  </section>
}
