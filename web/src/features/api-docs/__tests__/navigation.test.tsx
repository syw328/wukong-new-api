// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { useTopNavLinks } from '@/hooks/use-top-nav-links'

afterEach(() => document.querySelector('#platform-portal-runtime')?.remove())
it('mounted portal docs stay on this site even when status has the upstream default', () => {
  const runtime = document.createElement('script')
  runtime.type = 'application/json'
  runtime.id = 'platform-portal-runtime'
  runtime.textContent = JSON.stringify({
    origin: window.location.origin,
    basePath: '/api',
    transportPath: '/api/open-platform',
  })
  document.body.append(runtime)
  const client = new QueryClient()
  client.setQueryData(['status'], { docs_link: 'https://docs.newapi.pro' })
  const { result } = renderHook(() => useTopNavLinks(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  expect(result.current.find((link) => link.title === 'Docs')).toMatchObject({
    href: '/docs',
  })
  expect(
    result.current.find((link) => link.title === 'Docs')?.external
  ).not.toBe(true)
  client.clear()
})
