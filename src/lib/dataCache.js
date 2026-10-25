// Caché en memoria para los datos que casi no cambian entre pantallas (el catálogo de recetas y
// la lista de pacientes de los selectores). Evita que cada visita vuelva a pedir y a procesar el
// mismo JSON: si la entrada está fresca se responde al instante, y si hay una petición en curso se
// comparte en vez de lanzar otra (deduplicación). Las mutaciones invalidan por prefijo.
const entries = new Map()
const hasValue = (entry) => Boolean(entry) && Object.hasOwn(entry, 'value')

export function peekCache(key) {
  const entry = entries.get(key)
  return hasValue(entry) ? entry.value : undefined
}

export function invalidateCache(prefix = '') {
  for (const key of [...entries.keys()]) {
    if (!prefix || key.startsWith(prefix)) entries.delete(key)
  }
}

// `ttl` es el tiempo en ms durante el cual la respuesta se considera fresca. Al vencer se vuelve a
// pedir; si la petición falla, se conserva el último valor bueno para no dejar la pantalla vacía.
export function cachedRequest(key, load, { ttl = 60_000 } = {}) {
  const now = Date.now()
  const entry = entries.get(key)
  if (hasValue(entry) && now - entry.at < ttl) return Promise.resolve(entry.value)
  if (entry?.promise) return entry.promise
  const promise = Promise.resolve()
    .then(load)
    .then((value) => {
      entries.set(key, { value, at: Date.now() })
      return value
    })
    .catch((error) => {
      if (hasValue(entry)) entries.set(key, { value: entry.value, at: entry.at })
      else entries.delete(key)
      throw error
    })
  entries.set(key, { ...(entry || {}), promise })
  return promise
}
