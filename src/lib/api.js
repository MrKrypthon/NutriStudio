import { getToken, notifyUnauthorized } from './auth.js'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

/**
 * Small fetch boundary for all future modules. Components should not build
 * URLs or handle auth headers directly.
 */
export async function apiRequest(path, options = {}) {
  // Plain `npm run dev` stays in demo mode when no API URL is set.
  if (import.meta.env.DEV && !import.meta.env.VITE_API_URL) {
    throw Object.assign(new Error('API no configurada: usando datos de demostración.'), { code: 'DEMO_MODE' })
  }
  const token = getToken()
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (!response.ok) {
    let error = { code: 'REQUEST_FAILED', message: 'No fue posible completar la solicitud.', fields: {} }
    try { error = await response.json() } catch { /* Response may not contain JSON. */ }
    // Only a dead/invalid session (our own UNAUTHORIZED code) should force a logout — a
    // rejected login attempt (INVALID_CREDENTIALS) is also a 401 but isn't a session loss.
    if (error.code === 'UNAUTHORIZED') notifyUnauthorized()
    throw Object.assign(new Error(error.message), error)
  }

  if (response.status === 204) return null
  return response.json()
}

export const authApi = {
  login: (email, password) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
  me: () => apiRequest('/auth/me'),
}

export const dashboardApi = {
  today: (date) => apiRequest(`/dashboard/today?date=${date}`),
}

export const practiceApi = {
  get: () => apiRequest('/practice'),
  update: (payload) => apiRequest('/practice', { method: 'PUT', body: JSON.stringify(payload) }),
}

export const patientsApi = {
  list: (query = '') => apiRequest(`/patients${query}`),
  get: (id) => apiRequest(`/patients/${id}`),
  create: (payload) => apiRequest('/patients', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, payload) => apiRequest(`/patients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  consultations: (id) => apiRequest(`/patients/${id}/consultations`),
  plans: (id) => apiRequest(`/patients/${id}/plans`),
  timeline: (id) => apiRequest(`/patients/${id}/timeline`),
}

export const appointmentsApi = {
  list: (from, to) => apiRequest(`/appointments?from=${from}&to=${to}`),
  create: (payload) => apiRequest('/appointments', { method: 'POST', body: JSON.stringify(payload) }),
  confirm: (id) => apiRequest(`/appointments/${id}/confirm`, { method: 'POST' }),
}

export const nutritionApi = {
  calculate: async (payload) => {
    try {
      const result = await apiRequest('/nutrition-plans/calculate', { method: 'POST', body: JSON.stringify(payload) })
      const macros = await apiRequest('/nutrition-plans/macros', { method: 'POST', body: JSON.stringify({ kcal: result.get, carbsPercent: 50, proteinPercent: 25, fatPercent: 25 }) })
      return { ...result, macros: macros.macros }
    } catch (error) {
      if (error.code !== 'DEMO_MODE') throw error
      const weight = Number(payload.weightKg)
      const height = Number(payload.heightCm)
      const age = Number(payload.age)
      const female = payload.sex !== 'male'
      const bmr = (10 * weight) + (6.25 * height) - (5 * age) + (female ? -161 : 5)
      const factor = Number(payload.activityFactor || 1.2)
      const kcal = Math.round(bmr * factor)
      const heightM = height / 100
      const bmi = weight / (heightM * heightM)
      return { formula: payload.formula || 'mifflin', formulaLabel: 'Mifflin-St Jeor', bmr: Math.round(bmr), activityKcal: Math.round(bmr * (factor - 1)), get: kcal, activityMethod: 'factor', bmi: Math.round(bmi * 10) / 10, idealWeightRange: { minKg: Math.round(18.5 * heightM * heightM * 10) / 10, maxKg: Math.round(24.9 * heightM * heightM * 10) / 10 }, flags: [], inputs: payload, reviewed: false, demo: true, macros: { carbs: { percent: 50, kcal: Math.round(kcal * .5), grams: Math.round(kcal * .5 / 4 * 10) / 10 }, protein: { percent: 25, kcal: Math.round(kcal * .25), grams: Math.round(kcal * .25 / 4 * 10) / 10 }, fat: { percent: 25, kcal: Math.round(kcal * .25), grams: Math.round(kcal * .25 / 9 * 10) / 10 } } }
    }
  },
  macros: (payload) => apiRequest('/nutrition-plans/macros', { method: 'POST', body: JSON.stringify(payload) }),
}

export const plansApi = {
  create: (patientId, payload) => apiRequest(`/patients/${patientId}/plans`, { method: 'POST', body: JSON.stringify(payload) }),
  get: (id) => apiRequest(`/plans/${id}`),
  evaluate: (id, payload) => apiRequest(`/plans/${id}/evaluation`, { method: 'PUT', body: JSON.stringify(payload) }),
  saveDistribution: (id, mealSlots) => apiRequest(`/plans/${id}/distribution`, { method: 'PUT', body: JSON.stringify({ mealSlots }) }),
  publish: (id) => apiRequest(`/plans/${id}/publish`, { method: 'POST' }),
}

export const clinicalApi = {
  get: (id) => apiRequest(`/consultations/${id}`),
  create: (patientId, payload) => apiRequest(`/patients/${patientId}/consultations`, { method: 'POST', body: JSON.stringify(payload) }),
  saveSection: (consultationId, sectionKey, payload, updatedAt) => apiRequest(`/consultations/${consultationId}/sections/${sectionKey}`, { method: 'PUT', body: JSON.stringify({ payload, updatedAt }) }),
  complete: (id) => apiRequest(`/consultations/${id}/complete`, { method: 'POST' }),
  registerMeasurement: (consultationId, payload) => apiRequest(`/consultations/${consultationId}/measurements`, { method: 'POST', body: JSON.stringify(payload) }),
}

export const templatesApi = {
  list: (query = '') => apiRequest(`/templates${query}`),
  create: (payload) => apiRequest('/templates', { method: 'POST', body: JSON.stringify(payload) }),
  apply: (id, patientId) => apiRequest(`/templates/${id}/apply`, { method: 'POST', body: JSON.stringify({ patientId }) }),
}

export const documentsApi = {
  list: (query = '') => apiRequest(`/documents${query}`),
  createForPlan: (planId) => apiRequest('/documents/nutrition-plan', { method: 'POST', body: JSON.stringify({ planId }) }),
  createForReport: (consultationId) => apiRequest('/documents/consultation-report', { method: 'POST', body: JSON.stringify({ consultationId }) }),
  generate: (id) => apiRequest(`/documents/${id}/generate`, { method: 'POST' }),
  deliver: (id) => apiRequest(`/documents/${id}/deliver`, { method: 'POST' }),
  downloadUrl: (id) => `${import.meta.env.VITE_API_URL || ''}/documents/${id}/download`,
}

export const tasksApi = {
  list: (query = '') => apiRequest(`/tasks${query}`),
  create: (payload) => apiRequest('/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  complete: (id) => apiRequest(`/tasks/${id}/complete`, { method: 'POST' }),
}

export const recipesApi = {
  list: (query = '') => apiRequest(`/recipes${query}`),
  create: (payload) => apiRequest('/recipes', { method: 'POST', body: JSON.stringify(payload) }),
  nutrition: (id) => apiRequest(`/recipes/${id}/nutrition`),
  recalculate: (id) => apiRequest(`/recipes/${id}/recalculate`, { method: 'POST' }),
  replaceIngredients: (id, ingredients) => apiRequest(`/recipes/${id}/ingredients`, { method: 'PUT', body: JSON.stringify({ ingredients }) }),
}

export const ingredientsApi = {
  list: (query = '') => apiRequest(`/ingredients${query}`),
  import: (payload) => apiRequest('/ingredients/import', { method: 'POST', body: JSON.stringify(payload) }),
}

export const foodApi = {
  search: async (query, source = 'all') => {
    const path = `/food/search?q=${encodeURIComponent(query)}&source=${source}`
    try {
      return await apiRequest(path)
    } catch (error) {
      if (!import.meta.env.DEV || error.code === 'DEMO_MODE') throw error
      const response = await fetch(`http://localhost:3001/api/v1${path}`)
      if (!response.ok) throw error
      return response.json()
    }
  },
}
