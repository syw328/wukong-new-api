// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import type { PlatformModel } from '@/features/platform-models/types'

import { newRoutingPolicy } from '../../lib/routing-policy'
import { KeyRoutePicker } from '../key-route-picker'

const mocks = vi.hoisted(() => ({ models: vi.fn() }))
vi.mock('@/features/platform-models/api', () => ({
  usePlatformModels: mocks.models,
  useRoutingOptions: () => ({ data: undefined, isLoading: false }),
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
]

function renderPicker(selected: string[] = [], active = '') {
  mocks.models.mockReturnValue({ data: catalog, isLoading: false })
  render(
    <KeyRoutePicker
      policy={newRoutingPolicy()}
      models={selected}
      eligible={['gpt-a', 'gpt-b', 'solo', 'lone-claude']}
      activeModel={active}
      onActiveModel={() => {}}
      onChange={() => {}}
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
  expect(family()).toHaveTextContent('1 models selected')
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
