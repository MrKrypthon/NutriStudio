// Enlace a la plantilla imprimible del aviso de privacidad para pacientes (fase 117), con los datos
// de la consulta que la app ya conoce; lo demás queda entre corchetes para llenarlo a mano.
export function patientNoticeUrl({ practice, user } = {}) {
  const params = new URLSearchParams()
  if (practice?.name) params.set('consulta', practice.name)
  if (user?.name) params.set('profesional', user.name)
  const query = params.toString()
  return `/legal/aviso-pacientes${query ? `?${query}` : ''}`
}
