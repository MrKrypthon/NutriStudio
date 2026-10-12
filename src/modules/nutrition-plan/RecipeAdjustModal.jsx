import { useMemo, useState } from 'react'
import { scaleIngredientLine } from '../../lib/ingredientLines.js'
import { adjustmentKey, recipeIngredientLines } from '../../../server/domain/documents.js'
import { EQUIVALENT_TABLE, equivalentTotals } from '../../../server/domain/equivalents.js'

const formatCount = (value) => { const number = Number(value) || 0; return Number.isInteger(number) ? String(number) : number.toFixed(1) }
const roundQuarter = (value) => Math.round(value * 4) / 4
const formatFactor = (value) => String(Math.round(value * 100) / 100)
const toLines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean)

// Ajuste de porciones de las recetas de un tiempo de comida, sólo para este plan: la nutrióloga
// reescribe las cantidades (a mano o escalándolas hacia lo que marca el cálculo de equivalentes) y
// así salen en el plan de la paciente. La receta del catálogo no se modifica.
export default function RecipeAdjustModal({ meal, recipes, servings, adjustments, prescribed, locked, onSave, onClose }) {
  const [recipeId, setRecipeId] = useState(recipes[0]?.id || null)
  const recipe = recipes.find((item) => item.id === recipeId) || recipes[0]
  // Lo que le toca a la paciente según la receta original: sus renglones, llevados de "rinde N
  // porciones" a las porciones que se sirven en este tiempo de comida.
  const originalLines = useMemo(() => {
    if (!recipe) return []
    const factor = (Number(servings) || 1) / (Number(recipe.portions) || 1)
    return recipeIngredientLines(recipe).map((line) => scaleIngredientLine(line, factor))
  }, [recipe, servings])
  const saved = recipe ? adjustments?.[adjustmentKey(meal.key, recipe.id)]?.lines : null
  const [drafts, setDrafts] = useState({})
  const text = drafts[recipe?.id] ?? (saved || originalLines).join('\n')
  const setText = (next) => setDrafts((prev) => ({ ...prev, [recipe.id]: next }))
  const [factor, setFactor] = useState('1')

  const prescribedGroups = EQUIVALENT_TABLE.filter((group) => (Number(prescribed?.[group.code]) || 0) > 0)
  const prescribedKcal = equivalentTotals(prescribed).kcal
  const recipeKcal = recipe ? Math.round((Number((recipe.calculatedNutrition || recipe.nutrition || {}).kcal) || 0) * (Number(servings) || 1)) : 0
  const suggestedFactor = prescribedKcal > 0 && recipeKcal > 0 ? Math.max(0.25, roundQuarter(prescribedKcal / recipeKcal)) : null

  if (!recipe) return null
  const scaleBy = (value) => { const number = Number(String(value).replace(',', '.')); if (!Number.isFinite(number) || number <= 0) return; setText(toLines(text).map((line) => scaleIngredientLine(line, number)).join('\n')) }
  const isAdjusted = Boolean(saved)
  const dirty = drafts[recipe.id] !== undefined && toLines(drafts[recipe.id]).join('\n') !== (saved || originalLines).join('\n')
  const save = () => {
    const lines = toLines(text)
    // Dejarlo igual que el original equivale a no tener ajuste.
    onSave(recipe.id, lines.length && lines.join('\n') !== originalLines.join('\n') ? lines : null)
    setDrafts((prev) => { const next = { ...prev }; delete next[recipe.id]; return next })
  }
  const restore = () => { onSave(recipe.id, null); setDrafts((prev) => ({ ...prev, [recipe.id]: originalLines.join('\n') })) }

  return <div className="modal-backdrop" onClick={onClose}><div className="modal recipe-adjust-modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-head"><div><p className="eyebrow">AJUSTAR PORCIONES · {meal.label.toUpperCase()}</p><h2>{recipe.name}</h2><span className="modal-subtitle">Sólo cambia en este plan. La receta original del catálogo no se modifica.</span></div><button onClick={onClose} aria-label="Cerrar">×</button></div>
    {recipes.length > 1 && <div className="adjust-recipes">{recipes.map((item) => <button type="button" key={item.id} className={item.id === recipe.id ? 'selected' : ''} onClick={() => setRecipeId(item.id)}>{item.name}{adjustments?.[adjustmentKey(meal.key, item.id)] ? ' ✓' : ''}</button>)}</div>}

    <div className="adjust-guide">
      {prescribedGroups.length > 0
        ? <p><b>Calculado para {meal.label}:</b> {prescribedGroups.map((group) => `${formatCount(prescribed[group.code])} ${group.label}${group.sub ? ` (${group.sub.toLowerCase()})` : ''}`).join(' · ')} — {Math.round(prescribedKcal)} kcal.</p>
        : <p className="muted">Este tiempo de comida todavía no tiene equivalentes repartidos (paso Equivalentes): puedes ajustar las cantidades a mano.</p>}
      {recipeKcal > 0 && <p className="muted">La receta aporta {recipeKcal} kcal en {formatCount(servings)} {Number(servings) === 1 ? 'porción' : 'porciones'}.{suggestedFactor && suggestedFactor !== 1 ? ` Para acercarla al cálculo habría que multiplicar las cantidades por ${formatFactor(suggestedFactor)}.` : suggestedFactor === 1 ? ' Coincide con lo calculado.' : ''}</p>}
    </div>

    <label className="adjust-lines">Cantidades para la paciente <small>(un renglón por ingrediente)</small>
      <textarea rows={Math.min(16, Math.max(7, toLines(text).length + 1))} value={text} disabled={locked} onChange={(event) => setText(event.target.value)} />
    </label>

    {!locked && <div className="adjust-tools">
      {suggestedFactor && suggestedFactor !== 1 && <button type="button" className="secondary" onClick={() => scaleBy(suggestedFactor)}>Ajustar al cálculo (×{formatFactor(suggestedFactor)})</button>}
      <span className="adjust-scale">Multiplicar por <input type="number" min="0.1" max="10" step="0.25" value={factor} onChange={(event) => setFactor(event.target.value)} aria-label="Factor para multiplicar las cantidades" /><button type="button" className="secondary" onClick={() => scaleBy(factor)}>Aplicar</button></span>
      <button type="button" className="link-button" onClick={restore}>Restaurar original</button>
    </div>}
    <p className="muted adjust-status">{isAdjusted ? '✓ Esta receta tiene cantidades ajustadas en este plan.' : 'Sin ajustes: se muestran las cantidades de la receta original.'}</p>

    <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cerrar</button>{!locked && <button type="button" className="primary" disabled={!dirty} onClick={save}>Guardar ajuste</button>}</div>
  </div></div>
}
