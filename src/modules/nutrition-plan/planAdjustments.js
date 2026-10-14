// Utilidades de los ajustes de receta por plan que comparten el Constructor, el ajuste manual de
// porciones y las sugerencias de recetas. No tocan la red ni el estado.
import { scaleIngredientLine } from '../../lib/ingredientLines.js'
import { recipeIngredientLines } from '../../../server/domain/documents.js'

// El factor se guarda con dos decimales y entre 0.1 y 10, igual que lo normaliza el servidor.
export const clampFactor = (value) => { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.min(10, Math.max(0.1, Math.round(number * 100) / 100)) : 1 }
export const formatFactor = (value) => String(Math.round(Number(value) * 100) / 100)

// Renglones de una receta como le tocan a la paciente: de "rinde N porciones" a las porciones que
// se sirven en el tiempo de comida, multiplicadas además por el factor del ajuste.
export const scaledRecipeLines = (recipe, servings, factor = 1) => {
  const scale = ((Number(servings) || 1) / (Number(recipe?.portions) || 1)) * (Number(factor) || 1)
  return recipeIngredientLines(recipe).map((line) => scaleIngredientLine(line, scale))
}

// Deja sólo los ajustes cuya receta sigue asignada a ese tiempo de comida en la semana. `slots` es
// { "<día>:<tiempo>": recipeId }. Devuelve el mismo objeto si no hay nada que quitar.
export const pruneAdjustments = (adjustments, slots) => {
  const source = adjustments || {}
  const assigned = new Set(Object.entries(slots || {}).filter(([, recipeId]) => recipeId).map(([key, recipeId]) => `${key.split(':')[1]}|${recipeId}`))
  const kept = Object.entries(source).filter(([key]) => assigned.has(key))
  return kept.length === Object.keys(source).length ? source : Object.fromEntries(kept)
}

// Cierre de un modal al hacer clic en el fondo: sólo si el clic EMPIEZA en el fondo. Con `onClick`
// se cerraba al seleccionar texto arrastrando y soltar fuera del cuadro, perdiendo lo escrito.
export const backdropClose = (onClose) => ({ onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } })

// Micronutrimentos que se muestran de una receta o de un día del plan: [clave, nombre, unidad].
export const MICROS = [['fiber', 'Fibra', 'g'], ['sugar', 'Azúcar', 'g'], ['sodium', 'Sodio', 'mg'], ['calcium', 'Calcio', 'mg'], ['iron', 'Hierro', 'mg'], ['zinc', 'Zinc', 'mg'], ['selenium', 'Selenio', 'mcg'], ['folicAcid', 'Ácido fólico', 'mcg'], ['vitaminA', 'Vitamina A', 'mcg'], ['vitaminC', 'Vitamina C', 'mg'], ['vitaminD', 'Vitamina D', 'mcg'], ['vitaminE', 'Vitamina E', 'mg'], ['vitaminB12', 'Vitamina B12', 'mcg']]
