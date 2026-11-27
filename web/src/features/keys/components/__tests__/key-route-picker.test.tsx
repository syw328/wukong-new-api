// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import type { PlatformModel } from '@/features/platform-models/types'

import { newRoutingPolicy } from '../../lib/routing-policy'
import { KeyRoutePicker } from '../key-route-picker'

const mocks = vi.hoisted(() => ({ models: vi.fn(), routes: vi.fn() }))
vi.mock('@/features/platform-models/api', () => ({
  usePlatformModels: mocks.models,
  useRoutingOptions: mocks.routes,
}))

function model(
  id: string,
  type: PlatformModel['type'],
  family?: PlatformModel['family']
): PlatformModel {
  return {
    id,
    name: id.toUpperCase(),
    type,
    family,
    description: '',
    available: true,
    tags: [],
    parameters: [],
    endpoint: '',
  }
}
const gpt = { id: 'gpt', title: 'GPT 系列' }
const catalog = [
  model('gpt-a', 'chat', gpt),
  model('solo', 'chat'),
  model('gpt-b', 'chat', gpt),
  model('lone-claude', 'chat', { id: 'claude', title: 'Claude 系列' }),
  model('not-routable', 'chat', gpt),
  model('painter', 'image'),
]

const onChange = vi.fn()
function renderPicker(
  selected: string[] = [],
  active = '',
  policy = newRoutingPolicy()
) {
  mocks.models.mockReturnValue({ data: catalog, isLoading: false })
  mocks.routes.mockReturnValue({ data: undefined, isLoading: false })
  render(
    <KeyRoutePicker
      policy={policy}
      models={selected}
      eligible={['gpt-a', 'gpt-b', 'solo', 'lone-claude', 'painter']}
      activeModel={active}
      onActiveModel={() => {}}
      onChange={onChange}
    />
  )
}
// The selected-models column repeats names; these read the model list only.
const list = () => within(screen.getByLabelText('Choose models'))
const family = () => screen.getByRole('button', { name: /GPT 系列/ })

afterEach(() => vi.clearAllMocks())

test('a family folds its routable models into one row that opens in place', () => {
  renderPicker(['gpt-b'])
  // One-member families and unmatched models stay plain rows.
  expect(list().getByText('SOLO')).toBeInTheDocument()
  expect(list().getByText('LONE-CLAUDE')).toBeInTheDocument()
  expect(list().queryByText('Claude 系列')).not.toBeInTheDocument()
  expect(family()).toHaveAttribute('aria-expanded', 'false')
  // One of the two routable members is chosen.
  expect(family()).toHaveTextContent('1/2')
  expect(list().queryByText('GPT-A')).not.toBeInTheDocument()

  fireEvent.click(family())
  expect(list().getByText('GPT-A')).toBeInTheDocument()
  expect(list().getByText('GPT-B')).toBeInTheDocument()
  expect(list().queryByText('NOT-ROUTABLE')).not.toBeInTheDocument()

  fireEvent.click(family())
  expect(list().queryByText('GPT-A')).not.toBeInTheDocument()
})

test('the family of the model in view starts open, and a search opens the families it matches', () => {
  renderPicker([], 'gpt-a')
  expect(family()).toHaveAttribute('aria-expanded', 'true')
  expect(list().getByText('GPT-B')).toBeInTheDocument()

  fireEvent.click(family())
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'gpt' } })
  // A hand-folded family stays folded; clearing the choice lets the search open it.
  expect(list().queryByText('GPT-B')).not.toBeInTheDocument()
  fireEvent.click(family())
  expect(list().getByText('GPT-B')).toBeInTheDocument()
  expect(list().queryByText('SOLO')).not.toBeInTheDocument()
})

test('"All models" lists one section per category and a category tab drops the headings', () => {
  renderPicker()
  expect(
    screen.getAllByRole('heading', { level: 4 }).map((node) => node.textContent)
  ).toEqual(['Language models', 'Image models'])
  fireEvent.click(screen.getByRole('button', { name: 'Image models' }))
  expect(screen.queryByRole('heading', { level: 4 })).not.toBeInTheDocument()
  expect(list().getByText('PAINTER')).toBeInTheDocument()
  expect(list().queryByText('SOLO')).not.toBeInTheDocument()
})

test('a route card toggles as a whole and drops a SKU that only repeats the model name', () => {
  const option = (id: string, sku: string, available = true) => ({
    id,
    provider: `Route ${id}`,
    sku,
    available,
    reason: '',
    speed: null,
    startingPrice: {
      amount: 2,
      unit: 'tokens',
      input: 2,
      output: 8,
      routeId: id,
      variantIndex: 0,
      values: {},
    },
    successRate: null,
    samples: 0,
    variantIndex: 0,
    variants: [],
    rows: [],
    fields: [],
  })
  const policy = {
    ...newRoutingPolicy(),
    version: 2 as const,
    mode: 'custom' as const,
  }
  renderPicker(['solo'], 'solo', policy)
  mocks.routes.mockReturnValue({
    isLoading: false,
    data: {
      model: catalog[1],
      routes: [
        option('a', 'SOLO'),
        option('b', 'SOLO fast'),
        option('c', 'SOLO', false),
      ],
    },
  })
  fireEvent.click(family())
  const card = (name: string) => screen.getByRole('region', { name })
  expect(card('Route a SOLO')).toHaveTextContent(
    'Route aAvailableInput2· Output 8'
  )
  expect(card('Route b SOLO fast')).toHaveTextContent('SOLO fast')

  fireEvent.click(within(card('Route a SOLO')).getByText('Route a'))
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange.mock.calls[0][0].model_rules).toMatchObject([
    { model: 'solo', route_ids: ['a'] },
  ])
  // An unavailable route cannot be added, by the card or by its checkbox.
  fireEvent.click(card('Route c SOLO'))
  expect(onChange).toHaveBeenCalledTimes(1)
})
