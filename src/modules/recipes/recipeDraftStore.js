// In-memory recipe drafts. The edit/create form lives in NewRecipePage, which unmounts when the
// professional navigates back to the list — without this, leaving with unsaved edits silently
// discarded them. Drafts live in a module-level Map so they survive component unmounts within the
// SPA session (but not a full page reload, by design: nothing is written to the database until
// the user actually saves).
//
// Keyed by recipe id, or NEW_KEY for the "Nueva receta" form, and by the signed-in user: cerrar
// sesión no recarga la página, así que sin el usuario en la llave quien entraba después en el mismo
// navegador (otra cuenta) encontraba en "Nueva receta" el borrador de la cuenta anterior.

export const NEW_RECIPE_KEY = '__new__'
export const recipeDraftKey = (recipeId, userId) => `${userId || ''}:${recipeId || NEW_RECIPE_KEY}`

const drafts = new Map()

export const getRecipeDraft = (key) => drafts.get(key) || null

export const saveRecipeDraft = (key, draft) => {
  drafts.set(key, { ...draft, savedAt: Date.now() })
}

export const clearRecipeDraft = (key) => {
  drafts.delete(key)
}
