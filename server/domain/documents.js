const MEAL_TYPE_LABELS = {
  breakfast: 'Desayuno',
  lunch: 'Comida',
  snack: 'Colación',
  dinner: 'Cena',
}

const DAY_LABELS = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
}

const MEAL_TYPE_ORDER = ['breakfast', 'lunch', 'snack', 'dinner']

// Congela la semana asignada al momento de publicar: los MealSlot solo guardan un recipeId
// (referencia viva), así que si la receta se edita después, el PDF de un plan ya publicado no
// debe cambiar. Este snapshot es lo único que la generación de PDF debe leer para ese plan.
function buildMenuSnapshot(mealSlots) {
  return mealSlots
    .filter((slot) => slot.recipeId)
    .map((slot) => ({
      dayOfWeek: slot.dayOfWeek,
      mealType: slot.mealType,
      recipeId: slot.recipeId,
      recipeName: slot.recipe?.name || 'Receta',
      servings: slot.servings ? Number(slot.servings) : 1,
      kcal: Math.round((slot.recipe?.nutrition?.kcal || 0) * (slot.servings ? Number(slot.servings) : 1)),
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || MEAL_TYPE_ORDER.indexOf(a.mealType) - MEAL_TYPE_ORDER.indexOf(b.mealType))
}

export { MEAL_TYPE_LABELS, DAY_LABELS, MEAL_TYPE_ORDER, buildMenuSnapshot }
