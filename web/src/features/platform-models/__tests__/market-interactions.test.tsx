// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { PlatformModelsPage } from '../index'

const fixtures = vi.hoisted(() => ({
  models: [
    {
      id: 'fixture-chat',
      name: 'Atlas Chat',
      vendor: 'OpenAI',
      type: 'chat',
      tags: ['Vision'],
      parameters: [],
      description: 'Language model',
      available: true,
      endpoint: '/v1/chat/completions',
    },
    {
      id: 'fixture-image',
      name: 'Canvas Image',
      vendor: 'Google',
      type: 'image',
      tags: ['4K'],
      parameters: [],
      description: 'Image model',
      available: true,
      endpoint: '/v1/media/generations',
    },
  ],
  summary: {
    startingPrice: {
      amount: 0.12,
      unit: 'call',
      values: {},
      variantIndex: 0,
      routeId: 'route',
    },
    billingUnits: ['call'],
    minimumComplete: true,
    routeCount: 2,
    pricedRouteCount: 2,
    unavailableRouteCount: 0,
    statisticsAvailable: true,
    successRate: 0,
    samples: 2,
  },
}))
vi.mock('../api', () => ({
  usePlatformModels: () => ({
    data: fixtures.models,
    isLoading: false,
    isError: false,
  }),
  usePlatformSummaries: () => ({
    data: {
      summaries: {
        'fixture-chat': fixtures.summary,
        'fixture-image': fixtures.summary,
      },
      pricesAvailable: true,
      audience: 'site',
      validUntil: '2030-01-01',
    },
    isLoading: false,
    isError: false,
  }),
  usePlatformPrices: () => ({
    data: {
      model: fixtures.models[1],
      routes: [],
      unavailable: [],
      statisticsAvailable: true,
      successRate: 0,
      samples: 2,
      audience: 'site',
      lockedAt: '2026-09-15T00:00:00Z',
      validUntil: '2030-01-01',
    },
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('@/components/layout', () => ({
  PublicLayout: (props: { children: ReactNode }) => (
    <main>{props.children}</main>
  ),
}))
vi.mock('@/components/layout/components/footer', () => ({ Footer: () => null }))

describe('marketplace browsing', () => {
  it('combines manufacturer and model-type filters and resets the result set', async () => {
    render(<PlatformModelsPage />)
    const vendors = screen.getByRole('group', { name: 'Manufacturers' })
    fireEvent.click(within(vendors).getByRole('button', { name: /Google/ }))
    expect(
      screen.queryByRole('button', { name: 'View model Atlas Chat' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'View model Canvas Image' })
    ).toBeInTheDocument()
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Model category' })).getByRole(
        'button',
        { name: /Language models/ }
      )
    )
    expect(screen.getByText('No matching models')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset filters' })[0])
    expect(
      screen.getByRole('button', { name: 'View model Atlas Chat' })
    ).toBeInTheDocument()
  })
  it('price view opens an accessible dialog without replacing the results and Escape restores focus', async () => {
    const user = userEvent.setup()
    render(<PlatformModelsPage mode='prices' />)
    const opener = screen.getByRole('button', {
      name: 'View model Canvas Image',
    })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('tab', { name: 'Price details' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('[data-market-results]')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    await waitFor(() => expect(opener).toHaveFocus())
  })
  it('cards expose actual minimum price and zero success instead of fabricating 100 percent', () => {
    render(<PlatformModelsPage />)
    expect(screen.getAllByText('0.12').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0.0%').length).toBeGreaterThan(0)
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
  })
})
