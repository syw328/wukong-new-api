type PortalRuntime = {
  origin: string
  basePath: string
  transportPath: string
  brandName?: string
  logo?: string
}

export function portalRuntime(): PortalRuntime {
  const fallback = {
    origin: typeof window === 'undefined' ? '' : window.location.origin,
    basePath: '',
    transportPath: '',
  }
  if (typeof document === 'undefined') return fallback
  try {
    const value = JSON.parse(
      document.querySelector('#platform-portal-runtime')?.textContent || 'null'
    ) as PortalRuntime | null
    if (
      value?.origin === fallback.origin &&
      value.basePath === '/api' &&
      value.transportPath === '/api/open-platform'
    ) {
      return value
    }
  } catch {
    /* An invalid configuration never chooses another origin. */
  }
  return fallback
}

const consoleRoots = new Set([
  'channels',
  'chat',
  'chat2link',
  'dashboard',
  'errors',
  'keys',
  'models',
  'playground',
  'profile',
  'redemption-codes',
  'security',
  'subscriptions',
  'system-info',
  'system-settings',
  'task-plugins',
  'usage-logs',
  'users',
  'wallet',
])

export function portalRoutePath(path: string): string {
  if (
    portalRuntime().basePath &&
    consoleRoots.has(path.split('/')[1]?.split('?')[0] || '')
  ) {
    return `/console${path}`
  }
  return path
}

export function portalInternalPath(path: string): string {
  const base = portalRuntime().basePath
  if (!base) return path
  let result = path === base ? '/' : path
  if (result.startsWith(`${base}/`)) result = result.slice(base.length)
  if (
    result.startsWith('/console/') &&
    consoleRoots.has(result.split('/')[2]?.split('?')[0] || '')
  ) {
    result = result.slice('/console'.length)
  }
  return result
}

export function portalPagePath(path: string): string {
  const base = portalRuntime().basePath
  if (
    !base ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path === base ||
    path.startsWith(`${base}/`)
  ) {
    return path
  }
  return `${base}${portalRoutePath(path)}`
}

export function portalRequestPath(path: string): string {
  const base = portalRuntime().transportPath
  if (
    !base ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.startsWith(`${base}/`)
  ) {
    return path
  }
  return `${base}${path}`
}

export function portalApiOrigin(): string {
  const runtime = portalRuntime()
  return `${runtime.origin}${runtime.transportPath}`
}

export function portalStorageKey(key: string): string {
  return portalRuntime().basePath ? `newapi:portal:${key}` : key
}

function scopedStorage(type: 'localStorage' | 'sessionStorage'): Storage {
  const keys = () => {
    const storage = window[type]
    const prefix = portalStorageKey('')
    return Array.from({ length: storage.length }, (_, index) =>
      storage.key(index)
    )
      .filter((key): key is string => key != null && key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
  }
  return {
    get length() {
      return keys().length
    },
    key: (index) => keys()[index] ?? null,
    getItem: (key) => window[type].getItem(portalStorageKey(key)),
    setItem: (key, value) => window[type].setItem(portalStorageKey(key), value),
    removeItem: (key) => window[type].removeItem(portalStorageKey(key)),
    clear: () =>
      keys().forEach((key) => window[type].removeItem(portalStorageKey(key))),
  }
}

export const portalLocalStorage = scopedStorage('localStorage')
export const portalSessionStorage = scopedStorage('sessionStorage')
