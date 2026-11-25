// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ModelPrices } from '../model-prices'
import type { PriceDetails, PriceRoute } from '../types'

const mocks = vi.hoisted(() => ({ prices: vi.fn() }))
vi.mock('../api', () => ({ usePlatformPrices: mocks.prices }))

function route(id: string, provider: string, available: boolean): PriceRoute {
  return {
    id,
    provider,
    sku: 'image-sku',
    available,
    reason: available ? '' : 'paused',
    variantIndex: 0,
    variants: [{ index: 0, label: 'default' }],
    fields: [],
    successRate: 98,
    samples: 50,
    speed: { p50Ms: 4200, metric: 'completion', samples: 40, window: '7d' },
    rows: [
      {
        key: 0,
        name: 'Default',
        contextThreshold: null,
        characterUnit: null,
        tokenRates: [],
        longContextRates: [],
        estimate: { nativeUnit: 'call', amount: 0.06, unitPrice: 0.06 },
      },
    ],
  }
}
const details: PriceDetails = {
  model: {
    id: 'image/one',
    name: 'Image One',
    type: 'image',
    description: '',
    available: true,
    tags: [],
    parameters: [],
    endpoint: '/v1/media/generations',
  },
  routes: [
    route('route-a', 'Route A', true),
    route('route-b', 'Route B', false),
  ],
  statisticsAvailable: true,
  successRate: 98,
  samples: 50,
  priceBookId: 'book',
  lockedAt: '2026-11-25T00:00:00Z',
  validUntil: '2030-01-01T00:00:00Z',
  audience: 'account',
  currency: 'CREDITS',
  unavailable: [],
}
let client: QueryClient

async function renderPrices(routeKeys: boolean, platformRouting = true) {
  mocks.prices.mockReturnValue({
    data: details,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(
    ['status'],
    { platform_key_routing: platformRouting },
    { updatedAt: Date.now() + 60_000 }
  )
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <ModelPrices model='image/one' routeKeys={routeKeys} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  client?.clear()
  vi.clearAllMocks()
})

it('an available route links to a new key preset with this model and route, alongside its real success rate and latency', async () => {
  await renderPrices(true)
  const card = (
    await screen.findByRole('region', { name: 'Route A image-sku' })
  ).closest('.market-route-card') as HTMLElement
  expect(within(card).getByText('98.0%')).toBeVisible()
  expect(within(card).getByText('4.2s')).toBeVisible()
  const link = within(card).getByRole('link', {
    name: 'Create a key with this route',
  })
  const href = new URL(link.getAttribute('href') || '', window.location.origin)
  expect(href.pathname).toBe('/keys')
  expect(href.searchParams.get('route_model')).toBe('image/one')
  expect(href.searchParams.get('route_id')).toBe('route-a')
})

it('an unavailable route offers no key preset', async () => {
  await renderPrices(true)
  const card = (
    await screen.findByRole('region', { name: 'Route B image-sku' })
  ).closest('.market-route-card') as HTMLElement
  expect(
    within(card).queryByRole('link', { name: 'Create a key with this route' })
  ).not.toBeInTheDocument()
})

it.each([
  { where: 'the key editor route preview', routeKeys: false, routing: true },
  { where: 'a site without key routing', routeKeys: true, routing: false },
])('$where shows no key preset links', async ({ routeKeys, routing }) => {
  await renderPrices(routeKeys, routing)
  await screen.findByRole('region', { name: 'Route A image-sku' })
  expect(
    screen.queryByRole('link', { name: 'Create a key with this route' })
  ).not.toBeInTheDocument()
})
