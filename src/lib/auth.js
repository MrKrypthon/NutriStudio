const TOKEN_KEY = 'nutri-auth-token'

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function setToken(token) {
  try { localStorage.setItem(TOKEN_KEY, token) } catch { /* Private mode / storage disabled: the session just won't survive a reload. */ }
}

export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY) } catch { /* Nothing to clear if storage isn't available. */ }
}

// apiRequest (a plain module, not a component) reports 401s here so AuthProvider — which
// owns React state — can react without every call site threading a callback through.
let unauthorizedHandler = null
export function onUnauthorized(handler) { unauthorizedHandler = handler }
export function notifyUnauthorized() { unauthorizedHandler?.() }

// Igual para un 402 (suscripción vencida a media sesión): AuthProvider muestra la pantalla de pago.
let subscriptionRequiredHandler = null
export function onSubscriptionRequired(handler) { subscriptionRequiredHandler = handler }
export function notifySubscriptionRequired() { subscriptionRequiredHandler?.() }

// Y para un 403 LEGAL_ACCEPTANCE_REQUIRED (fase 117): faltan por aceptar los términos o el aviso de
// privacidad vigentes; AuthProvider vuelve a pedir el estado y muestra la pantalla para aceptarlos.
let legalRequiredHandler = null
export function onLegalRequired(handler) { legalRequiredHandler = handler }
export function notifyLegalRequired() { legalRequiredHandler?.() }
