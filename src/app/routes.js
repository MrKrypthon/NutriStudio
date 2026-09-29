/**
 * Enrutado de la aplicación: traduce entre la barra de direcciones y el módulo en pantalla.
 *
 * Antes el módulo vivía sólo en memoria y la mitad de las pantallas no tocaba la URL, así que una
 * recarga —o volver desde otra pestaña— te devolvía al inicio y perdías el paciente que estabas
 * atendiendo. El expediente era el caso peor: su URL decía `/pacientes`, de modo que ni la barra de
 * direcciones ni la migaja de pan coincidían con lo que estabas viendo, y recargar te sacaba.
 *
 * El paciente y la consulta forman parte de la dirección porque son parte de dónde estás, no de un
 * estado transitorio: `/pacientes/<id>/expediente/<consulta>` se puede recargar, compartir y volver
 * atrás con el botón del navegador.
 */

// Módulos con una dirección simple, sin parámetros.
export const MODULE_SLUGS = {
  'Hoy': 'hoy',
  'Agenda': 'agenda',
  'Pacientes': 'pacientes',
  'Consultas': 'consultas',
  'Seguimientos': 'seguimientos',
  'Finanzas': 'finanzas',
  'Constructor de plan': 'constructor-plan',
  'Recetas': 'recetas',
  'Ingredientes': 'ingredientes',
  'Plantillas': 'plantillas',
  'Documentos': 'documentos',
  'Educación': 'educacion',
  'Nuevo paciente': 'nuevo-paciente',
  'Configuración': 'configuracion',
  'Importar alimentos': 'importar-alimentos',
}

const SLUG_TO_MODULE = Object.fromEntries(Object.entries(MODULE_SLUGS).map(([module, slug]) => [slug, module]))

// Pantallas que son una sub-acción de otra y comparten su dirección: al volver atrás se sale del
// formulario y se vuelve a la lista, que es donde el usuario espera aterrizar.
const NESTED_SLUGS = {
  'Nueva receta': 'recetas',
  'Editar receta': 'recetas',
  'Nuevo material': 'educacion',
  'Editar material': 'educacion',
  'Documento': 'documentos',
}

export const DEFAULT_ROUTE = { module: 'Hoy', patientId: '', consultationId: null }

/** Lee la dirección actual y devuelve el módulo y, si lo lleva, el paciente y la consulta. */
export function parseLocation(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean)
  if (!parts.length) return { ...DEFAULT_ROUTE }

  // /pacientes/<id>/expediente[/<consulta>]
  if (parts[0] === 'pacientes' && parts[1] && parts[2] === 'expediente') {
    return { module: 'Expediente', patientId: parts[1], consultationId: parts[3] || null }
  }
  // /pacientes/<id>/plan
  if (parts[0] === 'pacientes' && parts[1] && parts[2] === 'plan') {
    return { module: 'Constructor de plan', patientId: parts[1], consultationId: null }
  }

  const module = SLUG_TO_MODULE[parts[0]]
  if (!module) return { ...DEFAULT_ROUTE }
  return { module, patientId: '', consultationId: null }
}

/**
 * Dirección que corresponde a un módulo. Devuelve null cuando no hay ninguna que pueda representar
 * ese estado (por ejemplo, el expediente sin paciente elegido): quien llama deja la URL como está.
 */
export function pathFor(module, patientId = '', consultationId = null) {
  if (module === 'Expediente') {
    if (!patientId) return null
    return consultationId ? `/pacientes/${patientId}/expediente/${consultationId}` : `/pacientes/${patientId}/expediente`
  }
  if (module === 'Constructor de plan' && patientId) return `/pacientes/${patientId}/plan`
  const slug = MODULE_SLUGS[module] || NESTED_SLUGS[module]
  return slug ? `/${slug}` : null
}
