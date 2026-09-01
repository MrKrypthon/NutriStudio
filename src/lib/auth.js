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
