/**
 * Optional web-only sync overlay. The upstream app remains local-first: feed
 * and body caches never leave the browser, while small account-independent
 * reading state can be mirrored to the authenticated Horizon host.
 */

const PREFIX = 'newsnook:'
const CACHE_PREFIXES = ['cache:v3:', 'body:', 'feed-trans:']
const LOCAL_ONLY_KEYS = new Set(['appUpdate', 'splash-seen'])
const REQUEST_TIMEOUT_MS = 4000
const ENDPOINT = '/api/sync/state'

let hydrated = false
let timer: ReturnType<typeof setTimeout> | null = null
let warned = false

function enabled(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.location.hostname === 'horizon.241412.xyz' &&
    window.location.protocol === 'https:'
  )
}

function snapshot(): Record<string, string> {
  const values: Record<string, string> = {}
  for (let index = 0; index < localStorage.length; index += 1) {
    const fullKey = localStorage.key(index)
    if (!fullKey?.startsWith(PREFIX)) continue
    const key = fullKey.slice(PREFIX.length)
    if (LOCAL_ONLY_KEYS.has(key) || CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      continue
    }
    const value = localStorage.getItem(fullKey)
    if (value !== null) values[key] = value
  }
  return values
}

async function putState(values: Record<string, string>): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const response = await fetch(ENDPOINT, {
    method: 'PUT',
    credentials: 'include',
    cache: 'no-store',
    signal: controller.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), values }),
  })
  clearTimeout(timeout)
  if (!response.ok) throw new Error(`sync upload failed: ${response.status}`)
}

/** Restore the server snapshot before React mounts, or seed an empty server. */
export async function hydrateServerStorage(): Promise<void> {
  if (!enabled()) return
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const response = await fetch(ENDPOINT, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (response.status === 404) {
      await putState(snapshot())
      hydrated = true
      return
    }
    if (!response.ok) throw new Error(`sync download failed: ${response.status}`)
    const payload = (await response.json()) as { version?: number; values?: Record<string, string> }
    const values = payload.values && typeof payload.values === 'object' ? payload.values : {}
    if (Object.keys(values).length) {
      const local = snapshot()
      for (const key of Object.keys(local)) {
        if (!(key in values)) localStorage.removeItem(PREFIX + key)
      }
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === 'string') localStorage.setItem(PREFIX + key, value)
      }
    } else {
      await putState(snapshot())
    }
    hydrated = true
  } catch (error) {
    if (!warned) {
      warned = true
      console.warn('[storage] server sync unavailable; using local storage', error)
    }
    hydrated = true
  }
}

export function scheduleServerStorageSync(): void {
  if (!enabled() || !hydrated) return
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void putState(snapshot()).catch((error: unknown) => {
      if (!warned) {
        warned = true
        console.warn('[storage] server sync upload failed', error)
      }
    })
  }, 500)
}
