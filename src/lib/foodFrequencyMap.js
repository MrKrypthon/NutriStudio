/**
 * Lógica pura de la clasificación de "Frecuencia de consumo de alimentos": un mapa plano
 * `{ [itemKey]: bucketKey }`. Un alimento tiene una sola frecuencia a la vez —es una pregunta de
 * "¿con qué frecuencia lo comes?", no "en qué frecuencias lo comes"—, así que asignarlo a un bucket
 * nuevo reemplaza al anterior en vez de sumarse.
 *
 * Separado de la UI para poder probarlo sin montar el componente, y porque el mismo mapa se guarda
 * tal cual en el payload de la sección (una sola clave, JSON), sin más forma que ésta.
 */

/** Asigna `itemKey` a `bucketKey`, sin mutar el mapa recibido. */
export function assignItem(map, itemKey, bucketKey) {
  return { ...map, [itemKey]: bucketKey }
}

/** Quita a `itemKey` de donde esté clasificado (vuelve a la paleta de "sin clasificar"). */
export function unassignItem(map, itemKey) {
  if (!(itemKey in map)) return map
  const next = { ...map }
  delete next[itemKey]
  return next
}

/** Claves de los ítems clasificados en ese bucket, en el orden en que aparecen en `itemKeys`. */
export function itemsInBucket(map, bucketKey, itemKeys) {
  return itemKeys.filter((key) => map[key] === bucketKey)
}

/** Claves sin clasificar todavía (no están en el mapa, o apuntan a un bucket que ya no existe). */
export function unassignedItems(map, itemKeys, validBucketKeys) {
  const valid = new Set(validBucketKeys)
  return itemKeys.filter((key) => !map[key] || !valid.has(map[key]))
}
