import { afterEach, describe, expect, it } from 'vitest'

import { initializeFrontendCache } from '@/lib/frontend-cache'
import { buildOAuthAuthorizationUrl } from '@/lib/oauth'
import {
  portalApiOrigin,
  portalLocalStorage,
  portalPagePath,
  portalRequestPath,
  portalInternalPath,
} from '@/lib/portal-runtime'

afterEach(() => {
  document.head.innerHTML = ''
  window.localStorage.clear()
})

function mountedPortal(): void {
  const runtime = document.createElement('script')
  runtime.id = 'platform-portal-runtime'
  runtime.type = 'application/json'
  runtime.textContent = JSON.stringify({
    origin: window.location.origin,
    basePath: '/api',
    transportPath: '/api/open-platform',
  })
  document.head.appendChild(runtime)
}

describe('mounted portal paths and storage', () => {
  it.each([false, true])(
    'uses the correct linked-account callback for mounted portal: %s',
    (mounted) => {
      if (mounted) mountedPortal()
      const url = new URL(
        buildOAuthAuthorizationUrl('platform', 'verification-state', {
          custom_oauth_providers: [
            {
              id: 1,
              slug: 'platform',
              name: 'Platform',
              icon: '',
              client_id: 'test-client',
              authorization_endpoint:
                'https://configured.example/api/oauth/authorize',
              scopes: 'profile',
            },
          ],
        })
      )
      expect(url.searchParams.get('redirect_uri')).toBe(
        `${window.location.origin}${mounted ? '/api' : ''}/oauth/platform`
      )
      expect(url.origin).toBe(
        mounted ? window.location.origin : 'https://configured.example'
      )
      expect(url.pathname).toBe('/api/oauth/authorize')
      expect(url.searchParams.get('state')).toBe('verification-state')
      expect(url.searchParams.get('client_id')).toBe('test-client')
    }
  )

  it('keeps root deployments compatible and mounts pages and APIs independently', () => {
    expect(portalPagePath('/pricing')).toBe('/pricing')
    expect(portalRequestPath('/api/user/self')).toBe('/api/user/self')
    mountedPortal()
    expect(portalPagePath('/pricing')).toBe('/api/pricing')
    expect(portalPagePath('/api/pricing')).toBe('/api/pricing')
    expect(portalPagePath('/keys')).toBe('/api/console/keys')
    expect(portalInternalPath('/api/console/keys')).toBe('/keys')
    expect(portalRequestPath('/api/user/self')).toBe(
      '/api/open-platform/api/user/self'
    )
    expect(portalApiOrigin()).toBe(
      `${window.location.origin}/api/open-platform`
    )
    expect(portalPagePath('https://other.test')).toBe('https://other.test')
  })

  it('cache upgrades preserve the original site settings and credentials', () => {
    mountedPortal()
    window.localStorage.setItem('platform-login', 'existing-session')
    window.localStorage.setItem('user', 'original-user')
    portalLocalStorage.setItem('old-ui-setting', 'portal-value')
    initializeFrontendCache()
    expect(window.localStorage.getItem('platform-login')).toBe(
      'existing-session'
    )
    expect(window.localStorage.getItem('user')).toBe('original-user')
    expect(portalLocalStorage.getItem('old-ui-setting')).toBeNull()
    portalLocalStorage.setItem('user', 'portal-user')
    expect(portalLocalStorage.getItem('user')).toBe('portal-user')
    expect(window.localStorage.getItem('user')).toBe('original-user')
  })
})
