import { apiRequest } from './api.js'

// Alimentos del libro SMAE 5ª ed. (módulo Equivalencias).
export const smaeApi = {
  groups: () => apiRequest('/smae-foods/groups'),
  list: (params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null)).toString()
    return apiRequest(`/smae-foods${query ? `?${query}` : ''}`)
  },
  update: (id, values) => apiRequest(`/smae-foods/${id}`, { method: 'PATCH', body: JSON.stringify({ values }) }),
}
