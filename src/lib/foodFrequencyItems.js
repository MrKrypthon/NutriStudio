/**
 * Catálogo de "Frecuencia de consumo de alimentos": los grupos de alimentos (sistema mexicano de
 * equivalentes) y los alimentos de consumo ocasional que se clasifican arrastrándolos —o
 * seleccionándolos— a una frecuencia. Los 15 grupos y los primeros 12 alimentos vienen de la
 * referencia que compartió la nutrióloga; el resto se agregó para cubrir ítems comunes en un
 * interrogatorio de frecuencia que no estaban: huevo, yogur y embutidos son de los más preguntados
 * en consulta, y faltaban por completo.
 *
 * `key` es estable y es lo que se guarda en el mapa de clasificación — no debe cambiar una vez que
 * haya pacientes con datos reales, o esos ítems "desaparecerían" (quedarían sin icono ni bucket).
 */

export const FREQUENCY_BUCKETS = [
  { key: 'Diario', label: 'Diario' },
  { key: '4-6 veces por semana', label: '4–6 veces por semana' },
  { key: '2-3 veces por semana', label: '2–3 veces por semana' },
  { key: 'Semanalmente', label: 'Semanalmente' },
  { key: '2-3 veces por mes', label: '2–3 veces por mes' },
  { key: 'Mensualmente o menos', label: 'Mensualmente o menos' },
]

export const FOOD_GROUPS = [
  { key: 'fruta', label: 'Fruta', color: 'rose' },
  { key: 'verdura', label: 'Verdura', color: 'green' },
  { key: 'cereales-grasa', label: 'Cereales con grasa', color: 'rose' },
  { key: 'leguminosas', label: 'Leguminosas', color: 'olive' },
  { key: 'oa-muy-bajo-grasa', label: 'OA muy bajo en grasa', color: 'blue' },
  { key: 'oa-moderado-grasa', label: 'OA moderado en grasa', color: 'rose' },
  { key: 'oa-alto-grasa', label: 'OA alto en grasa', color: 'orange' },
  { key: 'lacteos-descremados', label: 'Lácteos descremados', color: 'blue' },
  { key: 'lacteos-semidescremados', label: 'Lácteos semidescremados', color: 'blue' },
  { key: 'azucar-grasa', label: 'Azúcar con grasa', color: 'rose' },
  { key: 'cereales-tuberculos', label: 'Cereales y tubérculos', color: 'brown' },
  { key: 'grasa', label: 'Grasa', color: 'yellow' },
  { key: 'azucar', label: 'Azúcar', color: 'teal' },
  { key: 'lacteos-enteros', label: 'Lácteos enteros', color: 'blue' },
  { key: 'oa-bajo-grasa', label: 'OA bajo en grasa', color: 'green' },
]

export const FOODS = [
  { key: 'cafe', label: 'Café', color: 'brown' },
  { key: 'refresco', label: 'Refresco', color: 'blue' },
  { key: 'taco', label: 'Taco', color: 'rose' },
  { key: 'pan-dulce', label: 'Pan dulce', color: 'rose' },
  { key: 'cerveza', label: 'Cerveza', color: 'yellow' },
  { key: 'nieve', label: 'Nieve', color: 'green' },
  { key: 'galletas', label: 'Galletas', color: 'rose' },
  { key: 'chocolate', label: 'Chocolate', color: 'brown' },
  { key: 'pan-de-caja', label: 'Pan de caja', color: 'brown' },
  { key: 'restaurante', label: 'Restaurante', color: 'purple' },
  { key: 'pizza', label: 'Pizza', color: 'orange' },
  { key: 'comida-rapida', label: 'Comida rápida', color: 'purple' },
  // Agregados: ítems habituales de un interrogatorio de frecuencia que no estaban en la referencia.
  { key: 'huevo', label: 'Huevo', color: 'yellow' },
  { key: 'yogur', label: 'Yogur', color: 'blue' },
  { key: 'jugo', label: 'Jugo', color: 'orange' },
  { key: 'agua-de-sabor', label: 'Agua de sabor', color: 'teal' },
  { key: 'frituras', label: 'Frituras', color: 'yellow' },
  { key: 'dulces', label: 'Dulces', color: 'rose' },
  { key: 'embutidos', label: 'Embutidos', color: 'rose' },
]

export const ALL_FREQUENCY_ITEMS = [...FOOD_GROUPS, ...FOODS]
export const FREQUENCY_ITEM_BY_KEY = Object.fromEntries(ALL_FREQUENCY_ITEMS.map((item) => [item.key, item]))
