// Cliente del panel de administración del SaaS. Usa su propio token (independiente del de la
// práctica) para que la sesión de administrador y la de la nutrióloga no se mezclen.
const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
const TOKEN_KEY = 'nutri-admin-token'

export const getAdminToken = () => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } }
export const setAdminToken = (token) => { try { localStorage.setItem(TOKEN_KEY, token) } catch { /* storage disabled */ } }
export const clearAdminToken = () => { try { localStorage.removeItem(TOKEN_KEY) } catch { /* storage disabled */ } }

async function adminRequest(path, options = {}) {
  if (import.meta.env.DEV && !import.meta.env.VITE_API_URL) {
    throw Object.assign(new Error('API no configurada.'), { code: 'DEMO_MODE' })
  }
  const token = getAdminToken()
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (!response.ok) {
    let error = { code: 'REQUEST_FAILED', message: 'No fue posible completar la solicitud.' }
    try { error = await response.json() } catch { /* body may not be JSON */ }
    if (response.status === 401) clearAdminToken()
    throw Object.assign(new Error(error.message), error)
  }
  if (response.status === 204) return null
  return response.json()
}

export const adminApi = {
  login: (email, password) => adminRequest('/admin/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  practices: () => adminRequest('/admin/practices'),
  updatePractice: (id, payload) => adminRequest(`/admin/practices/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  transactions: () => adminRequest('/admin/transactions'),
  addTransaction: (payload) => adminRequest('/admin/transactions', { method: 'POST', body: JSON.stringify(payload) }),
}
