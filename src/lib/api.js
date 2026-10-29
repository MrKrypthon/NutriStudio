import { getToken, notifyLegalRequired, notifySubscriptionRequired, notifyUnauthorized } from './auth.js'
import { cachedRequest, invalidateCache, setCacheScope } from './dataCache.js'

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'
// La caché persistente se separa por práctica: al cambiar de cuenta no se muestran datos de otra.
const currentCacheScope = () => {
  const token = getToken()
  if (!token) return null
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')))
    return payload?.practiceId || null
  } catch { return null }
}
// Con la sesión ya guardada, la caché persistente puede hidratarse desde la primera petición.
setCacheScope(currentCacheScope())
// Una mutación deja vieja la caché de esa familia; se invalida sólo cuando termina bien.
const invalidateAfter = (request, prefix) => request.then((value) => {
  for (const key of Array.isArray(prefix) ? prefix : [prefix]) invalidateCache(key)
  return value
})

/**
 * Small fetch boundary for all future modules. Components should not build
 * URLs or handle auth headers directly.
 */
const REQUEST_TIMEOUT_MS = 20000
// `fetch` puede quedarse colgado (red muerta, servidor que no responde): sin timeout el spinner
// queda infinito. Se aborta a los 20 s y el error se propaga al llamador.
async function fetchWithTimeout(url, options = {}, ms = REQUEST_TIMEOUT_MS) {
  if (options.signal) return fetch(url, options)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (error) {
    // Las pantallas muestran `error.message`, y el navegador lo da en inglés ("signal is aborted
    // without reason", "Failed to fetch"): se traduce el corte por tiempo y la falta de conexión.
    if (controller.signal.aborted) throw Object.assign(new Error('El servidor tardó demasiado en responder. Intenta de nuevo.'), { code: 'TIMEOUT' })
    if (error instanceof TypeError) throw Object.assign(new Error('No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.'), { code: 'NETWORK_ERROR' })
    throw error
  } finally { clearTimeout(timer) }
}

export async function apiRequest(path, options = {}) {
  // Plain `npm run dev` stays in demo mode when no API URL is set.
  if (import.meta.env.DEV && !import.meta.env.VITE_API_URL) {
    throw Object.assign(new Error('API no configurada: usando datos de demostración.'), { code: 'DEMO_MODE' })
  }
  const token = getToken()
  setCacheScope(currentCacheScope())
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
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
    // A rejected login attempt is also a 401 but isn't a session loss; any other 401 (even without
    // our JSON code) means the session is dead and should close.
    if (response.status === 401 && error.code !== 'INVALID_CREDENTIALS' && error.code !== 'INVALID_GOOGLE_TOKEN') notifyUnauthorized()
    // La suscripción venció a media sesión: la app cambia a la pantalla de pago.
    if (response.status === 402) notifySubscriptionRequired()
    // Cambiaron los términos o el aviso de privacidad: la app pide aceptarlos antes de seguir.
    if (response.status === 403 && error.code === 'LEGAL_ACCEPTANCE_REQUIRED') notifyLegalRequired()
    throw Object.assign(new Error(error.message), error)
  }

  if (response.status === 204) return null
  return response.json()
}

// Blob downloads use raw fetch (they can't go through response.json()); route them through the
// same session-loss handling so a 401 on a download also logs the professional out instead of
// failing silently.
async function downloadBlobRequest(path, fallbackMessage) {
  const token = getToken()
  setCacheScope(currentCacheScope())
  const response = await fetchWithTimeout(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!response.ok) {
    let error = null
    try { error = await response.json() } catch { /* body may not be JSON */ }
    if (error?.code === 'UNAUTHORIZED') notifyUnauthorized()
    throw Object.assign(new Error(error?.message || fallbackMessage), { code: error?.code || 'DOWNLOAD_FAILED' })
  }
  return response.blob()
}

export const authApi = {
  login: (email, password) => apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  config: () => apiRequest('/auth/config'),
  google: (credential) => apiRequest('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  linkGoogle: (credential) => apiRequest('/auth/google/link', { method: 'POST', body: JSON.stringify({ credential }) }),
  unlinkGoogle: () => apiRequest('/auth/google/unlink', { method: 'POST' }),
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
  me: () => apiRequest('/auth/me'),
  changePassword: (currentPassword, newPassword) => apiRequest('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
}

// Términos y aviso de privacidad (fase 117).
export const legalApi = {
  status: () => apiRequest('/legal/status'),
  accept: (documents) => apiRequest('/legal/accept', { method: 'POST', body: JSON.stringify({ documents }) }),
}

// Clave compartida por "Hoy" y el chrome para no pedir dos veces la misma agenda.
export const dashboardCacheKey = (date) => `dashboard:today:${date || 'practice'}`

export const dashboardApi = {
  today: (date) => apiRequest(`/dashboard/today?date=${date}`),
  // `ttl: 0` obliga a refrescar (Hoy siempre se actualiza al entrar); la caché sólo sirve para
  // pintar de inmediato los últimos datos buenos mientras llega la respuesta fresca.
  todayCached: (date, ttl = 15_000) => cachedRequest(dashboardCacheKey(date), () => apiRequest(`/dashboard/today?date=${date}`), { ttl }),
}

export const practiceApi = {
  get: () => apiRequest('/practice'),
  update: (payload) => apiRequest('/practice', { method: 'PUT', body: JSON.stringify(payload) }),
  uploadLogo: (dataUrl) => apiRequest('/practice/logo', { method: 'POST', body: JSON.stringify({ dataUrl }) }),
  updateFees: (fees) => apiRequest('/practice/fees', { method: 'PUT', body: JSON.stringify({ fees }) }),
  updatePdfTheme: (theme) => apiRequest('/practice/pdf-theme', { method: 'PUT', body: JSON.stringify({ theme }) }),
  // Public route (no Authorization header needed) so it can be used directly as an <img src> —
  // in the app, inside generated PDFs would need the file on disk instead, see server/index.js.
  logoUrl: (practiceId) => `${API_BASE}/practice/${practiceId}/logo`,
}

// Suscripción del SaaS (Stripe): checkout y portal devuelven la URL de Stripe a la que se redirige.
export const billingApi = {
  get: () => apiRequest('/billing'),
  checkout: (interval) => apiRequest('/billing/checkout', { method: 'POST', body: JSON.stringify({ interval }) }),
  portal: () => apiRequest('/billing/portal', { method: 'POST' }),
  sync: () => apiRequest('/billing/sync', { method: 'POST' }),
}

export const financeApi = {
  overview: (from, to) => apiRequest(`/finance?from=${from}&to=${to}`),
  addExpense: (payload) => apiRequest('/finance/expenses', { method: 'POST', body: JSON.stringify(payload) }),
  updateEntry: (id, payload) => apiRequest(`/finance/entries/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  removeEntry: (id) => apiRequest(`/finance/entries/${id}`, { method: 'DELETE' }),
}

export const patientsApi = {
  // Quién abrió el expediente, generó o descargó sus documentos (registro de accesos).
  accessLog: (id) => apiRequest(`/patients/${id}/access-log`),
  list: (query = '') => apiRequest(`/patients${query}`),
  // Lista de los selectores de paciente: sólo los datos que muestran, cacheada para no repetir la
  // descarga en cada pantalla. Las mutaciones de paciente la invalidan.
  active: () => cachedRequest('patients:active', () => apiRequest('/patients?status=ACTIVE&pageSize=5000&lite=1'), { ttl: 2 * 60_000 }),
  get: (id) => apiRequest(`/patients/${id}`),
  create: (payload) => invalidateAfter(apiRequest('/patients', { method: 'POST', body: JSON.stringify(payload) }), ['patients:', 'dashboard:']),
  update: (id, payload) => invalidateAfter(apiRequest(`/patients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }), ['patients:', 'dashboard:']),
  consultations: (id) => apiRequest(`/patients/${id}/consultations`),
  // Sólo mediciones y estado de las consultas, para el Constructor de plan (no el expediente).
  consultationsLite: (id) => apiRequest(`/patients/${id}/consultations?lite=1`),
  plans: (id) => apiRequest(`/patients/${id}/plans`),
  timeline: (id) => apiRequest(`/patients/${id}/timeline`),
  // Datos permanentes del paciente, los que no pertenecen a una visita concreta.
  sections: (id) => apiRequest(`/patients/${id}/sections`),
  saveSection: (id, sectionKey, payload, updatedAt, options = {}) => apiRequest(`/patients/${id}/sections/${sectionKey}`, { method: 'PUT', body: JSON.stringify({ payload, updatedAt }), ...options }),
}

// Sugerencias de redacción de los campos con chips (SuggestionChips), compartidas por la práctica.
export const suggestionsApi = {
  list: (fieldKey) => apiRequest(`/suggestions?fieldKey=${encodeURIComponent(fieldKey)}`),
  create: (payload) => apiRequest('/suggestions', { method: 'POST', body: JSON.stringify(payload) }),
  remove: (id) => apiRequest(`/suggestions/${id}`, { method: 'DELETE' }),
}

export const appointmentsApi = {
  list: (from, to) => apiRequest(`/appointments?from=${from}&to=${to}`),
  create: (payload) => invalidateAfter(apiRequest('/appointments', { method: 'POST', body: JSON.stringify(payload) }), 'dashboard:'),
  confirm: (id) => invalidateAfter(apiRequest(`/appointments/${id}/confirm`, { method: 'POST' }), 'dashboard:'),
  complete: (id) => invalidateAfter(apiRequest(`/appointments/${id}/complete`, { method: 'POST' }), 'dashboard:'),
  cancel: (id) => invalidateAfter(apiRequest(`/appointments/${id}/cancel`, { method: 'POST' }), 'dashboard:'),
  noShow: (id) => invalidateAfter(apiRequest(`/appointments/${id}/no-show`, { method: 'POST' }), 'dashboard:'),
  move: (id, startAt, durationMinutes) => invalidateAfter(apiRequest(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify({ startAt, durationMinutes }) }), 'dashboard:'),
}

export const nutritionApi = {
  calculate: async (payload) => {
    const carbsPercent = Number(payload.carbsPercent) || 50
    const proteinPercent = Number(payload.proteinPercent) || 25
    const fatPercent = Number(payload.fatPercent) || 25
    try {
      const result = await apiRequest('/nutrition-plans/calculate', { method: 'POST', body: JSON.stringify(payload) })
      const macros = await apiRequest('/nutrition-plans/macros', { method: 'POST', body: JSON.stringify({ kcal: result.targetKcal ?? result.get, carbsPercent, proteinPercent, fatPercent }) })
      return { ...result, macros: macros.macros }
    } catch (error) {
      if (error.code !== 'DEMO_MODE') throw error
      const weight = Number(payload.weightKg)
      const height = Number(payload.heightCm)
      const age = Number(payload.age)
      const female = payload.sex !== 'male'
      const bmr = (10 * weight) + (6.25 * height) - (5 * age) + (female ? -161 : 5)
      const percent = Number(payload.activityPercent)
      const percentValid = Number.isFinite(percent) && percent > 0 && percent <= 100
      const factor = percentValid ? 1 + (percent / 100) : Number(payload.activityFactor || 1.2)
      const kcal = Math.round(bmr * factor)
      const heightM = height / 100
      const bmi = weight / (heightM * heightM)
      return { formula: payload.formula || 'mifflin', formulaLabel: 'Mifflin-St Jeor', bmr: Math.round(bmr), activityKcal: Math.round(bmr * (factor - 1)), get: kcal, activityMethod: percentValid ? 'percent' : 'factor', bmi: Math.round(bmi * 10) / 10, idealWeightRange: { minKg: Math.round(18.5 * heightM * heightM * 10) / 10, maxKg: Math.round(24.9 * heightM * heightM * 10) / 10 }, flags: [], inputs: payload, reviewed: false, demo: true, macros: { carbs: { percent: carbsPercent, kcal: Math.round(kcal * carbsPercent / 100), grams: Math.round(kcal * carbsPercent / 100 / 4 * 10) / 10 }, protein: { percent: proteinPercent, kcal: Math.round(kcal * proteinPercent / 100), grams: Math.round(kcal * proteinPercent / 100 / 4 * 10) / 10 }, fat: { percent: fatPercent, kcal: Math.round(kcal * fatPercent / 100), grams: Math.round(kcal * fatPercent / 100 / 9 * 10) / 10 } } }
    }
  },
  macros: (payload) => apiRequest('/nutrition-plans/macros', { method: 'POST', body: JSON.stringify(payload) }),
}

export const plansApi = {
  list: () => apiRequest('/plans'),
  create: (patientId, payload) => apiRequest(`/patients/${patientId}/plans`, { method: 'POST', body: JSON.stringify(payload) }),
  get: (id) => apiRequest(`/plans/${id}`),
  update: (id, payload) => apiRequest(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  evaluate: (id, payload) => apiRequest(`/plans/${id}/evaluation`, { method: 'PUT', body: JSON.stringify(payload) }),
  saveDistribution: (id, mealSlots) => apiRequest(`/plans/${id}/distribution`, { method: 'PUT', body: JSON.stringify({ mealSlots }) }),
  publish: (id) => apiRequest(`/plans/${id}/publish`, { method: 'POST' }),
  // El PDF del plan tal como se entregará (también en borrador); requiere sesión, por eso es Blob.
  // Con `theme`, dibuja con ese diseño sin guardarlo (vista previa del editor de diseño).
  previewPdfBlob: (id, theme = null) => downloadBlobRequest(`/plans/${id}/preview-pdf${theme ? `?theme=${encodeURIComponent(JSON.stringify(theme))}` : ''}`, 'No se pudo cargar la vista previa.'),
  adequacy: (id) => apiRequest(`/plans/${id}/adequacy`),
  cancel: (id) => apiRequest(`/plans/${id}/cancel`, { method: 'POST' }),
  reactivate: (id) => apiRequest(`/plans/${id}/reactivate`, { method: 'POST' }),
  duplicate: (id) => apiRequest(`/plans/${id}/duplicate`, { method: 'POST' }),
}

export const clinicalApi = {
  get: (id) => apiRequest(`/consultations/${id}`),
  create: (patientId, payload) => apiRequest(`/patients/${patientId}/consultations`, { method: 'POST', body: JSON.stringify(payload) }),
  // `options` admite `keepalive: true` para el guardado de salida: sin él, el navegador puede
  // cancelar la petición al desmontar la pantalla o al cerrar la pestaña y se perdería lo escrito.
  saveSection: (consultationId, sectionKey, payload, updatedAt, options = {}) => apiRequest(`/consultations/${consultationId}/sections/${sectionKey}`, { method: 'PUT', body: JSON.stringify({ payload, updatedAt }), ...options }),
  complete: (id, payload = {}) => apiRequest(`/consultations/${id}/complete`, { method: 'POST', body: JSON.stringify(payload) }),
  // El motivo es obligatorio: queda como nota aclaratoria en la bitácora y en el PDF del expediente.
  reopen: (id, reason) => apiRequest(`/consultations/${id}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) }),
  registerMeasurement: (consultationId, payload) => apiRequest(`/consultations/${consultationId}/measurements`, { method: 'POST', body: JSON.stringify(payload) }),
  addDiagnosis: (consultationId, payload) => apiRequest(`/consultations/${consultationId}/diagnoses`, { method: 'POST', body: JSON.stringify(payload) }),
  updateDiagnosis: (consultationId, diagnosisId, payload) => apiRequest(`/consultations/${consultationId}/diagnoses/${diagnosisId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  removeDiagnosis: (consultationId, diagnosisId) => apiRequest(`/consultations/${consultationId}/diagnoses/${diagnosisId}`, { method: 'DELETE' }),
}

export const templatesApi = {
  list: (query = '') => apiRequest(`/templates${query}`),
  create: (payload) => apiRequest('/templates', { method: 'POST', body: JSON.stringify(payload) }),
  apply: (id, patientId) => apiRequest(`/templates/${id}/apply`, { method: 'POST', body: JSON.stringify({ patientId }) }),
  update: (id, payload) => apiRequest(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  remove: (id) => apiRequest(`/templates/${id}`, { method: 'DELETE' }),
}

export const documentsApi = {
  list: (query = '') => apiRequest(`/documents${query}`),
  createForPlan: (planId) => apiRequest('/documents/nutrition-plan', { method: 'POST', body: JSON.stringify({ planId }) }),
  createForReport: (consultationId) => apiRequest('/documents/consultation-report', { method: 'POST', body: JSON.stringify({ consultationId }) }),
  createForExport: (consultationId) => apiRequest('/documents/consultation-export', { method: 'POST', body: JSON.stringify({ consultationId }) }),
  createForClinicalReport: (consultationId) => apiRequest('/documents/consultation-clinical', { method: 'POST', body: JSON.stringify({ consultationId }) }),
  generate: (id) => apiRequest(`/documents/${id}/generate`, { method: 'POST' }),
  deliver: (id) => apiRequest(`/documents/${id}/deliver`, { method: 'POST' }),
  undeliver: (id) => apiRequest(`/documents/${id}/undeliver`, { method: 'POST' }),
  // A plain <a href> click can't carry the Authorization header the download route requires
  // (every /api/v1/* route needs a session) — fetch it as an authenticated request instead and
  // hand back a Blob the caller can wrap in an object URL to trigger the actual download.
  downloadBlob: (id) => downloadBlobRequest(`/documents/${id}/download`, 'No se pudo descargar el documento.'),
  // Para el visor de la app: el mismo PDF, registrado como consulta ("vio") y no como descarga.
  previewBlob: (id) => downloadBlobRequest(`/documents/${id}/download?inline=1`, 'No se pudo abrir el documento.'),
}

export const labAttachmentsApi = {
  upload: (consultationId, fileName, dataUrl) => apiRequest(`/consultations/${consultationId}/lab-attachments`, { method: 'POST', body: JSON.stringify({ fileName, dataUrl }) }),
  remove: (id) => apiRequest(`/lab-attachments/${id}`, { method: 'DELETE' }),
  downloadBlob: (id) => downloadBlobRequest(`/lab-attachments/${id}/download`, 'No se pudo descargar el archivo.'),
}

export const tasksApi = {
  list: (query = '') => apiRequest(`/tasks${query}`),
  create: (payload) => invalidateAfter(apiRequest('/tasks', { method: 'POST', body: JSON.stringify(payload) }), 'dashboard:'),
  complete: (id) => invalidateAfter(apiRequest(`/tasks/${id}/complete`, { method: 'POST' }), 'dashboard:'),
}

export const recipesApi = {
  list: (query = '') => apiRequest(`/recipes${query}`),
  // Catálogo completo que usa el Constructor de plan. Se pide en versión ligera y se guarda en
  // memoria: al volver a un plan no se vuelve a bajar ni a procesar todo el recetario.
  catalog: () => cachedRequest('recipes:catalog', () => apiRequest('/recipes?lite=1'), { ttl: 5 * 60_000, persist: true, staleWhileRevalidate: true }),
  // Listado paginado de la biblioteca (tarjetas): se cachea por búsqueda/filtro/página para que
  // volver a Recetas no repita la descarga.
  pageCached: (query = '') => cachedRequest(`recipes:page:${query}`, () => apiRequest(`/recipes${query}`), { ttl: 60_000, persist: true, staleWhileRevalidate: true }),
  get: (id) => apiRequest(`/recipes/${id}`),
  create: (payload) => invalidateAfter(apiRequest('/recipes', { method: 'POST', body: JSON.stringify(payload) }), 'recipes:'),
  update: (id, payload) => invalidateAfter(apiRequest(`/recipes/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }), 'recipes:'),
  archive: (id) => invalidateAfter(apiRequest(`/recipes/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ARCHIVED' }) }), 'recipes:'),
  nutrition: (id) => apiRequest(`/recipes/${id}/nutrition`),
  recalculate: (id) => invalidateAfter(apiRequest(`/recipes/${id}/recalculate`, { method: 'POST' }), 'recipes:'),
  replaceIngredients: (id, ingredients) => invalidateAfter(apiRequest(`/recipes/${id}/ingredients`, { method: 'PUT', body: JSON.stringify({ ingredients }) }), 'recipes:'),
  // Imported cookbook recipes store only the file name (see prisma/import-recetario.js); build
  // the public URL here so the same relative API base works in dev and production.
  // `thumb` pide la miniatura de 480 px para tarjetas; el detalle/PDF usan la original.
  imageUrl: (file, { thumb = false } = {}) => (file ? `${API_BASE}/recipes/images/${file}${thumb ? '?thumb=1' : ''}` : null),
  uploadImage: (id, dataUrl) => invalidateAfter(apiRequest(`/recipes/${id}/image`, { method: 'POST', body: JSON.stringify({ dataUrl }) }), 'recipes:'),
  removeImage: (id) => invalidateAfter(apiRequest(`/recipes/${id}/image`, { method: 'DELETE' }), 'recipes:'),
}

export const educationApi = {
  list: (query = '') => apiRequest(`/education-materials${query}`),
  get: (id) => apiRequest(`/education-materials/${id}`),
  create: (payload) => apiRequest('/education-materials', { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, payload) => apiRequest(`/education-materials/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  archive: (id) => apiRequest(`/education-materials/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ARCHIVED' }) }),
  attach: (id, fileName, dataUrl) => apiRequest(`/education-materials/${id}/attachment`, { method: 'POST', body: JSON.stringify({ fileName, dataUrl }) }),
  removeAttachment: (id) => apiRequest(`/education-materials/${id}/attachment`, { method: 'DELETE' }),
  downloadAttachmentBlob: (id) => downloadBlobRequest(`/education-materials/${id}/attachment`, 'No se pudo descargar el archivo.'),
}

export const ingredientsApi = {
  list: (query = '') => apiRequest(`/ingredients${query}`),
  // Lista ligera para la biblioteca y detalle bajo demanda (los 26 nutrimentos no viajan en cada fila).
  listCached: (query = '') => cachedRequest(`ingredients:page:${query}`, () => apiRequest(`/ingredients${query}`), { ttl: 60_000, persist: true, staleWhileRevalidate: true }),
  get: (id) => cachedRequest(`ingredients:item:${id}`, () => apiRequest(`/ingredients/${id}`), { ttl: 5 * 60_000, persist: true, staleWhileRevalidate: true }),
  import: (payload) => invalidateAfter(apiRequest('/ingredients/import', { method: 'POST', body: JSON.stringify(payload) }), 'ingredients:'),
  create: (payload) => invalidateAfter(apiRequest('/ingredients', { method: 'POST', body: JSON.stringify(payload) }), 'ingredients:'),
  imageUrl: (file) => (file ? `${API_BASE}/ingredients/images/${file}` : null),
  uploadImage: (id, dataUrl) => invalidateAfter(apiRequest(`/ingredients/${id}/image`, { method: 'POST', body: JSON.stringify({ dataUrl }) }), 'ingredients:'),
  removeImage: (id) => invalidateAfter(apiRequest(`/ingredients/${id}/image`, { method: 'DELETE' }), 'ingredients:'),
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
