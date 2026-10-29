// Caché de datos de catálogo (recetas e ingredientes) en memoria y en IndexedDB. La primera vez
// que se piden se descargan; después se guardan en el navegador y al recargar la página se
// reutilizan al instante, sin volver a pedirlas. Las mutaciones invalidan por prefijo.
//
// Sólo se persisten las claves que lo piden (`{ persist: true }`): son datos de catálogo, no
// información clínica. La caché se separa por práctica (`practiceId` del token) para que dos
// cuentas en el mismo navegador nunca lean datos de la otra.
const entries = new Map()
const DB_NAME = 'nutri-catalog-cache-v1'
const STORE = 'responses'
const CACHE_VERSION = 1
const hasValue = (entry) => Boolean(entry) && Object.hasOwn(entry, 'value')

let scope = null
let dbPromise = null
const hydratedScopes = new Set()
const hydrating = new Map()

const idbAvailable = () => typeof indexedDB !== 'undefined'

function openDb() {
  if (!idbAvailable()) return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  return dbPromise
}

const storageKey = (key) => `${CACHE_VERSION}|${scope}|${key}`

async function persistEntry(key, value, at) {
  if (!scope || !idbAvailable()) return
  const db = await openDb()
  if (!db) return
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ key: storageKey(key), value, at })
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  } catch { /* almacenamiento lleno o bloqueado: se sigue usando la caché en memoria */ }
}

async function hydrateScope() {
  if (!scope || !idbAvailable()) return
  if (hydratedScopes.has(scope)) return
  if (hydrating.has(scope)) return hydrating.get(scope)
  const task = (async () => {
    const db = await openDb()
    if (!db) return
    try {
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const request = tx.objectStore(STORE).getAll()
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
      })
      const prefix = `${CACHE_VERSION}|${scope}|`
      for (const row of rows) {
        if (typeof row?.key !== 'string' || !row.key.startsWith(prefix)) continue
        const key = row.key.slice(prefix.length)
        const current = entries.get(key)
        // No pisar una respuesta más nueva que ya esté en memoria.
        if (hasValue(current) && current.at >= row.at) continue
        entries.set(key, { value: row.value, at: row.at })
      }
    } catch { /* sin IndexedDB se sigue con la caché en memoria */ }
    hydratedScopes.add(scope)
  })()
  hydrating.set(scope, task)
  try { await task } finally { hydrating.delete(scope) }
}

// Al iniciar sesión cambia la práctica: la caché en memoria de la anterior no se debe mostrar.
export function setCacheScope(nextScope) {
  const next = nextScope || null
  if (next === scope) return
  scope = next
  entries.clear()
  hydratedScopes.clear()
  hydrating.clear()
}

export function peekCache(key) {
  const entry = entries.get(key)
  return hasValue(entry) ? entry.value : undefined
}

// Guarda un valor ya conocido (p. ej. tras confirmar una cita) para la próxima pantalla.
export function rememberCache(key, value) {
  entries.set(key, { value, at: Date.now() })
}

export function invalidateCache(prefix = '') {
  for (const key of [...entries.keys()]) {
    if (!prefix || key.startsWith(prefix)) entries.delete(key)
  }
  if (!scope || !idbAvailable()) return
  // Borra también lo persistido para que una recarga no reviva datos viejos.
  ;(async () => {
    const db = await openDb()
    if (!db) return
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const request = store.getAllKeys()
      request.onsuccess = () => {
        for (const key of request.result || []) {
          if (typeof key !== 'string') continue
          const scopedPrefix = storageKey(prefix || '')
          if (key.startsWith(scopedPrefix)) store.delete(key)
        }
      }
    } catch { /* nada que borrar */ }
  })()
}

// `ttl` es el tiempo en ms durante el cual la respuesta se considera fresca. `persist` guarda la
// respuesta en IndexedDB para reutilizarla después de recargar la página.
//
// Con `staleWhileRevalidate`, si ya hay una respuesta (aunque haya vencido) se devuelve al instante
// y se refresca en segundo plano: al volver a una vista no se espera la red ni se muestra vacío.
// Si no hay nada guardado, se espera la primera carga normal.
export async function cachedRequest(key, load, { ttl = 60_000, persist = false, staleWhileRevalidate = false } = {}) {
  await hydrateScope()
  const now = Date.now()
  const entry = entries.get(key)
  if (hasValue(entry)) {
    if (now - entry.at < ttl) return entry.value
    if (staleWhileRevalidate) {
      if (!entry.promise) {
        const refresh = Promise.resolve()
          .then(load)
          .then((value) => {
            const at = Date.now()
            entries.set(key, { value, at })
            if (persist) persistEntry(key, value, at)
            return value
          })
          .catch(() => {
            // Si falla el refresco se conserva lo que ya había.
            entries.set(key, { value: entry.value, at: entry.at })
          })
        entries.set(key, { ...entry, promise: refresh })
      }
      return entry.value
    }
  }
  if (entry?.promise) return entry.promise
  const promise = Promise.resolve()
    .then(load)
    .then((value) => {
      const at = Date.now()
      entries.set(key, { value, at })
      if (persist) persistEntry(key, value, at)
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
