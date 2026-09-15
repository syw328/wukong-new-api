// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  filterPlatformModels,
  platformRequestExample,
  formatPriceBookDate,
} from '../helpers'
import { ModelPrices } from '../model-prices'
import type { PlatformModel, PriceDetails } from '../types'

const mocks = vi.hoisted(() => ({ prices: vi.fn() }))
vi.mock('../api', () => ({ usePlatformPrices: mocks.prices }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
const models = ['chat', 'image', 'video', 'audio'].map((type) => ({
  id: `test-${type}`,
  name: `Test ${type}`,
  type,
  tags: [type],
  parameters: [],
  description: '',
  available: true,
  endpoint: type === 'chat' ? '/v1/chat/completions' : '/v1/media/generations',
})) as PlatformModel[]
function data(rate: number | null): PriceDetails {
  return {
    model: models[1],
    currency: 'CREDITS',
    audience: 'account',
    statisticsAvailable: true,
    successRate: rate,
    samples: rate == null ? 0 : 2,
    priceBookId: 'book',
    lockedAt: '2026-09-15T00:00:00Z',
    validUntil: '2030-01-01T00:00:00Z',
    unavailable: [],
    routes: [
      {
        id: 'route1',
        provider: 'Route A',
        sku: 'image-test',
        variantIndex: 0,
        variants: [{ index: 0, label: 'default' }],
        fields: [],
        successRate: rate,
        samples: rate == null ? 0 : 2,
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
      },
    ],
  }
}
describe('complete platform model catalog', () => {
  it('keeps every modality searchable by model ID and applies independent categories', () => {
    expect(filterPlatformModels(models, 'all', '')).toHaveLength(4)
    expect(filterPlatformModels(models, 'audio', '')[0].id).toBe('test-audio')
    expect(filterPlatformModels(models, 'all', 'TEST-VIDEO')[0].id).toBe(
      'test-video'
    )
    expect(filterPlatformModels(models, 'image', 'video')).toHaveLength(0)
  })
  it('keeps media parameters in params without changing published field names', () => {
    const model = {
      ...models[2],
      parameters: [
        { name: 'duration', label: 'Duration', type: 'number', default: 5 },
        { name: 'audio_url', label: 'Audio', type: 'string', required: true },
      ],
    }
    const request = platformRequestExample(model)
    expect(request).toMatchObject({
      model: 'test-video',
      params: { duration: 5, audio_url: '<audio_url>' },
    })
    expect(request).not.toHaveProperty('provider')
  })
})
describe('account model price details', () => {
  it('shows zero success as zero, actual price and price-book validity', () => {
    mocks.prices.mockReturnValue({
      data: data(0),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    render(<ModelPrices model='test-image' />)
    expect(screen.getAllByText('0%')).toHaveLength(2)
    expect(screen.getByText('0.06')).toBeTruthy()
    expect(screen.getByText(/Valid until/)).toBeTruthy()
    expect(screen.getByText(/Your account prices/)).toBeTruthy()
    expect(screen.queryByText('100%')).toBeNull()
  })
  it('does not represent missing statistics as healthy', () => {
    mocks.prices.mockReturnValue({
      data: data(null),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    render(<ModelPrices model='test-image' />)
    expect(screen.getByText('No recent samples')).toBeTruthy()
    expect(screen.queryByText('100%')).toBeNull()
  })
  it('hides stale prices on failed refresh and lets the user retry', () => {
    const retry = vi.fn()
    mocks.prices.mockReturnValue({
      data: data(100),
      isLoading: false,
      isError: true,
      refetch: retry,
    })
    render(<ModelPrices model='test-image' />)
    expect(screen.queryByText('0.06')).toBeNull()
    expect(screen.getByText('Unable to load model prices')).toBeTruthy()
    fireEvent.click(screen.getByRole('button'))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})

it('formats project Chinese locale IDs without crashing the actual price page', () => {
  expect(formatPriceBookDate('2026-09-15T00:00:00Z', 'zhCN')).toContain('08:00')
  expect(formatPriceBookDate('2026-09-15T00:00:00Z', 'zhTW')).toContain('08:00')
  expect(formatPriceBookDate('bad-date', 'zhCN')).toBe('—')
})
