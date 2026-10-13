import { useMemo, useState } from 'react'
import { scaleIngredientLine } from '../../lib/ingredientLines.js'
import { adjustmentFactor, adjustmentKey } from '../../../server/domain/documents.js'
import { EQUIVALENT_TABLE, equivalentTotals } from '../../../server/domain/equivalents.js'
import { backdropClose, clampFactor, formatFactor, scaledRecipeLines } from './planAdjustments.js'
import RecipeEquivalentsEditor from './RecipeEquivalentsEditor.jsx'

const formatCount = (value) => { const number = Number(value) || 0; return Number.isInteger(number) ? String(number) : number.toFixed(1) }
const roundQuarter = (value) => Math.round(value * 4) / 4
const toLines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean)

// Ajuste de porciones de las recetas de un tiempo de comida, sólo para este plan: la nutrióloga
// reescribe las cantidades (a mano o escalándolas hacia lo que marca el cálculo de equivalentes) y
// así salen en el plan de la paciente. La receta del catálogo no se modifica. Junto con los
// renglones se guarda el `factor` por el que se multiplicaron las cantidades: con él se escalan las
// kcal y los macros de la receta en la adecuación del plan.
export default function RecipeAdjustModal({ meal, recipes, servings, adjustments, prescribed, locked, onSave, onClose }) {
  const [recipeId, setRecipeId] = useState(recipes[0]?.id || null)
  const recipe = recipes.find((item) => item.id === recipeId) || recipes[0]
  // Lo que le toca a la paciente según la receta original: sus renglones, llevados de "rinde N
  // porciones" a las porciones que se sirven en este tiempo de comida.
  const originalLines = useMemo(() => (recipe ? scaledRecipeLines(recipe, servings) : []), [recipe, servings])
  const saved = recipe ? adjustments?.[adjustmentKey(meal.key, recipe.id)] : null
  const savedFactor = recipe ? adjustmentFactor(adjustments, meal.key, recipe.id) : 1
  // Borrador por receta: { text, factor }. Sin borrador se muestra lo guardado (o el original).
  const [drafts, setDrafts] = useState({})
  const [multiplier, setMultiplier] = useState('1')
  const draft = recipe ? drafts[recipe.id] : null
  const baseText = (saved?.lines || originalLines).join('\n')
  const text = draft?.text ?? baseText
  const factor = draft?.factor ?? savedFactor
  const setDraft = (next) => setDrafts((prev) => ({ ...prev, [recipe.id]: { text, factor, ...next } }))
  const clearDraft = () => setDrafts((prev) => { const next = { ...prev }; delete next[recipe.id]; return next })

  const prescribedGroups = EQUIVALENT_TABLE.filter((group) => (Number(prescribed?.[group.code]) || 0) > 0)
  const prescribedKcal = equivalentTotals(prescribed).kcal
  const recipeKcal = recipe ? Math.round((Number((recipe.calculatedNutrition || recipe.nutrition || {}).kcal) || 0) * (Number(servings) || 1)) : 0
  const adjustedKcal = Math.round(recipeKcal * factor)
  // Siempre respecto a la receta ORIGINAL: aplicarlo dos veces da el mismo resultado.
  const suggestedFactor = prescribedKcal > 0 && recipeKcal > 0 ? Math.max(0.25, roundQuarter(prescribedKcal / recipeKcal)) : null

  // Una receta con ingredientes del catálogo se edita por equivalentes (porciones por grupo, con
  // intercambio); las que sólo tienen su texto de ingredientes, renglón por renglón.
  const canUseEquivalents = Boolean(recipe?.ingredients?.some((link) => link.ingredient))
  const [modes, setModes] = useState({})
  const [editorDirty, setEditorDirty] = useState(false)
  const mode = recipe ? modes[recipe.id] || (canUseEquivalents && (!saved || saved.items?.length) ? 'equivalents' : 'text') : 'text'
  if (!recipe) return null
  const applySuggested = () => setDraft({ text: scaledRecipeLines(recipe, servings, suggestedFactor).join('\n'), factor: clampFactor(suggestedFactor) })
  const multiplyBy = (value) => {
    const number = Number(String(value).replace(',', '.'))
    if (!Number.isFinite(number) || number <= 0) return
    setDraft({ text: toLines(text).map((line) => scaleIngredientLine(line, number)).join('\n'), factor: clampFactor(factor * number) })
  }
  const isAdjusted = Boolean(saved)
  const dirty = Boolean(draft) && (toLines(draft.text).join('\n') !== baseText || draft.factor !== savedFactor)
  const save = () => {
    const lines = toLines(text)
    // Dejarlo igual que el original (y sin factor) equivale a no tener ajuste.
    const unchanged = !lines.length || (lines.join('\n') === originalLines.join('\n') && factor === 1)
    onSave(recipe.id, unchanged ? null : { lines, factor })
    clearDraft()
  }
  const restore = () => { onSave(recipe.id, null); clearDraft() }
  // Cerrar con cantidades escritas y sin guardar (de cualquiera de las recetas) pide confirmación.
  const hasUnsaved = recipes.some((item) => {
    const itemDraft = drafts[item.id]
    if (!itemDraft) return false
    const itemSaved = adjustments?.[adjustmentKey(meal.key, item.id)]
    const itemBase = (itemSaved?.lines || scaledRecipeLines(item, servings)).join('\n')
    return toLines(itemDraft.text).join('\n') !== itemBase || itemDraft.factor !== adjustmentFactor(adjustments, meal.key, item.id)
  })
  const close = () => { if (!locked && (hasUnsaved || editorDirty) && !window.confirm('Hay cantidades sin guardar. ¿Cerrar sin guardarlas?')) return; onClose() }

  return <div className="modal-backdrop" {...backdropClose(close)}><div className="modal recipe-adjust-modal">
    <div className="modal-head"><div><p className="eyebrow">AJUSTAR PORCIONES · {meal.label.toUpperCase()}</p><h2>{recipe.name}</h2><span className="modal-subtitle">Sólo cambia en este plan. La receta original del catálogo no se modifica.</span></div><button type="button" onClick={close} aria-label="Cerrar">×</button></div>
    {recipes.length > 1 && <div className="adjust-recipes">{recipes.map((item) => <button type="button" key={item.id} className={item.id === recipe.id ? 'selected' : ''} onClick={() => setRecipeId(item.id)}>{item.name}{adjustments?.[adjustmentKey(meal.key, item.id)] ? ' ✓' : ''}</button>)}</div>}

    {canUseEquivalents && <div className="adjust-modes"><button type="button" className={mode === 'equivalents' ? 'selected' : ''} onClick={() => setModes((prev) => ({ ...prev, [recipe.id]: 'equivalents' }))}>Por equivalentes</button><button type="button" className={mode === 'text' ? 'selected' : ''} onClick={() => { setEditorDirty(false); setModes((prev) => ({ ...prev, [recipe.id]: 'text' })) }}>Texto libre</button></div>}
    {mode === 'equivalents' && <RecipeEquivalentsEditor key={`${recipe.id}-${saved?.items?.length || 0}`} recipe={recipe} servings={servings} saved={saved} prescribed={prescribed} mealLabel={meal.label} locked={locked} onDirtyChange={setEditorDirty} onSave={(adjustment) => { onSave(recipe.id, adjustment); setEditorDirty(false) }} />}
    {mode === 'text' && <>
    <div className="adjust-guide">
      {prescribedGroups.length > 0
        ? <p><b>Calculado para {meal.label}:</b> {prescribedGroups.map((group) => `${formatCount(prescribed[group.code])} ${group.label}${group.sub ? ` (${group.sub.toLowerCase()})` : ''}`).join(' · ')} — {Math.round(prescribedKcal)} kcal.</p>
        : <p className="muted">Este tiempo de comida todavía no tiene equivalentes repartidos (paso Equivalentes): puedes ajustar las cantidades a mano.</p>}
      {recipeKcal > 0 && <p className="muted">La receta original aporta {recipeKcal} kcal en {formatCount(servings)} {Number(servings) === 1 ? 'porción' : 'porciones'}{factor !== 1 ? `; con el ajuste (×${formatFactor(factor)}), ${adjustedKcal} kcal` : ''}.{suggestedFactor && suggestedFactor !== factor ? ` Para acercarla al cálculo, las cantidades originales se multiplican por ${formatFactor(suggestedFactor)}.` : suggestedFactor ? ' Coincide con lo calculado.' : ''}</p>}
    </div>

    <label className="adjust-lines">Cantidades para la paciente <small>(un renglón por ingrediente)</small>
      <textarea rows={Math.min(16, Math.max(7, toLines(text).length + 1))} value={text} disabled={locked} onChange={(event) => setDraft({ text: event.target.value })} />
    </label>

    {!locked && <div className="adjust-tools">
      {suggestedFactor && suggestedFactor !== factor && <button type="button" className="secondary" onClick={applySuggested}>Ajustar al cálculo (×{formatFactor(suggestedFactor)})</button>}
      <span className="adjust-scale">Multiplicar por <input type="number" min="0.1" max="10" step="0.25" value={multiplier} onChange={(event) => setMultiplier(event.target.value)} aria-label="Factor para multiplicar las cantidades" /><button type="button" className="secondary" onClick={() => multiplyBy(multiplier)}>Aplicar</button></span>
      <button type="button" className="link-button" onClick={restore}>Restaurar original</button>
    </div>}
    <p className="muted adjust-status">{isAdjusted ? '✓ Esta receta tiene cantidades ajustadas en este plan.' : 'Sin ajustes: se muestran las cantidades de la receta original.'} <b>Factor aplicado: ×{formatFactor(factor)}</b>{factor !== 1 ? ' — las kcal y macros de la receta se cuentan con ese factor en la adecuación del plan.' : ''}</p>

    </>}

    <div className="modal-actions"><button type="button" className="secondary" onClick={close}>Cerrar</button>{!locked && mode === 'text' && <button type="button" className="primary" disabled={!dirty} onClick={save}>Guardar ajuste</button>}</div>
  </div></div>
}
