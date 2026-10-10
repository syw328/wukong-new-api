// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { ModelApi } from '../model-api'
import type { PlatformModel, PriceRoute } from '../types'

const mocks = vi.hoisted(() => ({ prices: vi.fn() }))
vi.mock('../api', () => ({ usePlatformPrices: mocks.prices }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const model: PlatformModel = {
  id: 'seedance-2.0-limited-low-price',
  name: 'SD2.0',
  type: 'video',
  description: '',
  available: true,
  tags: [],
  parameters: [
    { name: 'duration', label: 'Duration', type: 'number', default: 4 },
  ],
  endpoint: '/v1/media/generations',
}
const routes: PriceRoute[] = [
  {
    id: 'f643e0a8ad1bd2af10d2c94b',
    provider: 'LD-3',
    sku: 'Special',
    variantIndex: 0,
    variants: [],
    fields: [],
    rows: [],
    samples: 0,
    successRate: null,
    parameters: [
      { name: 'duration', label: 'Duration', type: 'number', default: 5 },
      {
        name: 'resolution',
        label: 'Resolution',
        type: 'select',
        default: '720p',
        options: [{ value: '720p', label: '720P' }],
      },
    ],
  },
  {
    id: '94ab67158fe5abd515c6b792',
    provider: 'XN-15',
    sku: 'A',
    variantIndex: 0,
    variants: [],
    fields: [],
    rows: [],
    samples: 0,
    successRate: null,
    parameters: [
      { name: 'duration', label: 'Duration', type: 'number', default: 4 },
      {
        name: 'resolution',
        label: 'Resolution',
        type: 'select',
        default: '480p',
        options: ['480p', '720p', '1080p'].map((value) => ({
          value,
          label: value,
        })),
      },
    ],
  },
]

it('selecting a named route changes both complete request examples and the published parameters', async () => {
  const user = userEvent.setup()
  mocks.prices.mockReturnValue({
    data: { routes },
    isLoading: false,
    isError: false,
  })
  render(<ModelApi model={model} />)
  expect(screen.getAllByRole('button', { name: 'Copy route ID' })).toHaveLength(
    2
  )
  await user.click(screen.getByRole('combobox', { name: 'Generation route' }))
  await user.click(await screen.findByRole('option', { name: 'XN-15 · A' }))
  const python = screen.getByRole('tabpanel', { name: 'Python' })
  expect(python.textContent).toContain('"route_id": "94ab67158fe5abd515c6b792"')
  expect(python.textContent).toContain('"resolution": "480p"')
  expect(python.textContent).toContain('/v1/media/quotes')
  expect(python.textContent).toContain('/v1/media/generations')
  const row = screen.getByText('params.resolution').closest('tr')
  if (!row) throw new Error('Missing resolution row')
  expect(within(row).getByText('480p / 720p / 1080p')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'cURL' }))
  const curl = screen.getByRole('tabpanel', { name: 'cURL' })
  expect(curl.textContent).toContain('"route_id": "94ab67158fe5abd515c6b792"')
  expect(curl.textContent).toContain(
    'authorization_token, authorization_max, confirmed_price_book_id'
  )
  expect(curl.textContent).toContain('Idempotency-Key:')
  expect(curl.textContent).not.toContain('_provider_model')
})

it('removing the selected route hides its request example until the caller selects a current route', async () => {
  const user = userEvent.setup()
  mocks.prices.mockReturnValue({
    data: { routes },
    isLoading: false,
    isError: false,
  })
  const view = render(<ModelApi model={model} />)
  await user.click(screen.getByRole('combobox', { name: 'Generation route' }))
  await user.keyboard('{End}{Enter}')
  expect(
    screen.getByRole('tabpanel', { name: 'Python' }).textContent
  ).toContain('"route_id": "94ab67158fe5abd515c6b792"')
  mocks.prices.mockReturnValue({
    data: { routes: [routes[0]] },
    isLoading: false,
    isError: false,
  })
  view.rerender(<ModelApi model={model} />)
  expect(screen.getByRole('alert').textContent).toContain('no longer available')
  expect(
    screen.queryByRole('button', { name: 'Copy request example' })
  ).toBeNull()
})

it('a failed route lookup offers refresh without inventing IDs', () => {
  const retry = vi.fn()
  mocks.prices.mockReturnValue({
    isLoading: false,
    isError: true,
    refetch: retry,
  })
  render(<ModelApi model={model} />)
  expect(screen.getByRole('alert').textContent).toContain(
    'Unable to load routes'
  )
  expect(screen.queryByRole('button', { name: 'Copy route ID' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(retry).toHaveBeenCalledOnce()
})
