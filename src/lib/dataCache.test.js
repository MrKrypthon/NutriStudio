import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedRequest, invalidateCache, peekCache } from './dataCache.js'

beforeEach(() => {
  invalidateCache()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('cachedRequest', () => {
  it('serves the cached value while it is fresh and refetches after the ttl', async () => {
    const load = vi.fn().mockResolvedValueOnce(['a']).mockResolvedValueOnce(['b'])
    expect(await cachedRequest('test:list', load, { ttl: 1000 })).toEqual(['a'])
    expect(await cachedRequest('test:list', load, { ttl: 1000 })).toEqual(['a'])
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1001)
    expect(await cachedRequest('test:list', load, { ttl: 1000 })).toEqual(['b'])
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('returns the previous value immediately and refreshes in the background', async () => {
    let resolveRefresh
    const load = vi.fn()
      .mockResolvedValueOnce(['viejo'])
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve }))
    expect(await cachedRequest('test:swr', load, { ttl: 0, staleWhileRevalidate: true })).toEqual(['viejo'])
    // Aunque el TTL ya venció, no se espera la red: se devuelve lo anterior.
    expect(await cachedRequest('test:swr', load, { ttl: 0, staleWhileRevalidate: true })).toEqual(['viejo'])
    resolveRefresh(['nuevo'])
    await Promise.resolve()
    await Promise.resolve()
    expect(await cachedRequest('test:swr', load, { ttl: 0, staleWhileRevalidate: true })).toEqual(['nuevo'])
  })

  it('deduplicates concurrent requests for the same key', async () => {
    const load = vi.fn(() => Promise.resolve({ ok: true }))
    const [first, second] = await Promise.all([
      cachedRequest('test:dedupe', load),
      cachedRequest('test:dedupe', load),
    ])
    expect(first).toBe(second)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps the last good value when a refresh fails, and invalidates by prefix', async () => {
    const load = vi.fn().mockResolvedValueOnce({ total: 1 }).mockRejectedValueOnce(new Error('sin red'))
    await cachedRequest('patients:active', load, { ttl: 0 })
    await expect(cachedRequest('patients:active', load, { ttl: 0 })).rejects.toThrow('sin red')
    expect(peekCache('patients:active')).toEqual({ total: 1 })
    invalidateCache('patients:')
    expect(peekCache('patients:active')).toBeUndefined()
  })
})
