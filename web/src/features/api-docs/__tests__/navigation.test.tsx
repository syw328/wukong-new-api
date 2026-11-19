// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { useTopNavLinks } from '@/hooks/use-top-nav-links'

afterEach(() => document.querySelector('#platform-portal-runtime')?.remove())

function readNavLinks(status: Record<string, unknown>) {
  const client = new QueryClient()
  client.setQueryData(['status'], status)
  const { result, unmount } = renderHook(() => useTopNavLinks(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  unmount()
  client.clear()
  return result.current
}

function mountPortalRuntime() {
  const runtime = document.createElement('script')
  runtime.type = 'application/json'
  runtime.id = 'platform-portal-runtime'
  runtime.textContent = JSON.stringify({
    origin: window.location.origin,
    basePath: '/api',
    transportPath: '/api/open-platform',
  })
  document.body.append(runtime)
}

it('mounted portal docs stay on this site even when status has the upstream default', () => {
  mountPortalRuntime()
  const links = readNavLinks({ docs_link: 'https://docs.newapi.pro' })
  const docs = links.find((link) => link.title === 'Docs')
  expect(docs).toMatchObject({ href: '/docs' })
  expect(docs?.external).not.toBe(true)
})

it.each([
  { site: 'mounted portal', showsAbout: false },
  { site: 'standalone New API', showsAbout: true },
])(
  '$site shows the configured About link: $showsAbout',
  ({ site, showsAbout }) => {
    if (site === 'mounted portal') mountPortalRuntime()
    const links = readNavLinks({ HeaderNavModules: { about: true } })
    expect(links.some((link) => link.href === '/about')).toBe(showsAbout)
  }
)
