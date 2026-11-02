// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import type { PlatformModel } from '@/features/platform-models/types'
import { api } from '@/lib/api'

import { DocsWorkspace } from '../workspace'

const models: PlatformModel[] = [
  {
    id: 'chat-one',
    name: 'Chat One',
    description: 'Conversation model',
    type: 'chat',
    available: true,
    tags: [],
    parameters: [],
    endpoint: '/v1/chat/completions',
  },
  {
    id: 'video/one',
    name: 'Video One',
    description: 'Video model',
    type: 'video',
    available: true,
    tags: [],
    parameters: [
      { name: 'duration', label: 'Duration', type: 'number', default: 4 },
    ],
    endpoint: '/v1/media/generations',
  },
]
let client: QueryClient
function setup(initial = '', data: PlatformModel[] | undefined = models) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (data !== undefined) {
    client.setQueryData(
      ['platform-full-catalog', window.location.origin, 'anonymous'],
      data
    )
  }
  client.setQueryData(
    [
      'platform-model-prices',
      window.location.origin,
      'anonymous',
      'video/one',
      {},
    ],
    { routes: [] }
  )
  function Harness() {
    const [id, setId] = useState(initial)
    return (
      <QueryClientProvider client={client}>
        <DocsWorkspace modelId={id} onSelect={setId} />
      </QueryClientProvider>
    )
  }
  render(<Harness />)
}
afterEach(() => {
  client?.clear()
  vi.restoreAllMocks()
  document.querySelector('#platform-portal-runtime')?.remove()
})

it('search and category filters narrow the directory, and choosing a model opens its actual request examples', async () => {
  const user = userEvent.setup()
  setup()
  const directory = screen.getByRole('navigation', { name: 'Model documents' })
  expect(within(directory).getAllByRole('button')).toHaveLength(2)
  await user.type(
    screen.getByRole('textbox', { name: 'Search models' }),
    'video/one'
  )
  expect(within(directory).getAllByRole('button')).toHaveLength(1)
  await user.click(within(directory).getByRole('button', { name: /Video One/ }))
  expect(
    screen.getByRole('heading', { name: 'Video One', level: 1 })
  ).toBeVisible()
  expect(screen.getByRole('tabpanel', { name: 'Python' })).toHaveTextContent(
    '/v1/media/quotes'
  )
  expect(screen.getByText('params.duration')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Language models' }))
  expect(within(directory).queryAllByRole('button')).toHaveLength(0)
  expect(
    screen.getByText('No matching models. Try another search or category.')
  ).toBeVisible()
})

it('full document copy contains the current model, request parameters and both complete code examples', async () => {
  const user = userEvent.setup()
  setup('video/one')
  await user.click(
    screen.getByRole('button', { name: 'Copy full model documentation' })
  )
  const text = await navigator.clipboard.readText()
  expect(text).toContain('# Video One')
  expect(text).toContain('params.duration')
  expect(text).toContain('authorization_token')
  expect(text).toContain('Idempotency-Key')
  expect(text).toContain('/v1/media/generations/{task_id}')
  expect(text).toContain('```python')
  expect(text).toContain('```sh')
  expect(text).toContain('/v1/balance')
  expect(text).toContain('/v1/recharge/orders')
  expect(text).toContain('qr_code_image')
  expect(text).not.toContain('chat-one')
})

it('the shared balance guide copies the current site request and explains credits', async () => {
  const user = userEvent.setup()
  const runtime = document.createElement('script')
  runtime.id = 'platform-portal-runtime'
  runtime.type = 'application/json'
  runtime.textContent = JSON.stringify({
    origin: window.location.origin,
    basePath: '/api',
    transportPath: '/api/open-platform',
  })
  document.body.append(runtime)
  setup()
  expect(
    screen.getByRole('heading', { name: 'Query credit balance' })
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Copy balance request' }))
  expect(await navigator.clipboard.readText()).toContain(
    `${window.location.origin}/api/open-platform/v1/balance`
  )
  expect(await navigator.clipboard.readText()).toContain(
    'Authorization: Bearer $PLATFORM_API_KEY'
  )
  expect(screen.getByText(/"unit": "credits"/)).toBeVisible()
})

it('an unknown deep link shows an unavailable document instead of silently selecting another model', () => {
  setup('removed-model')
  expect(screen.getByText('Model not found')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Copy full model documentation' })
  ).not.toBeInTheDocument()
})

it('an empty site keeps the connection guide and explicitly explains the missing catalog', () => {
  setup('', [])
  expect(
    screen.getByRole('heading', { name: 'Connect your first model' })
  ).toBeVisible()
  expect(
    screen.getByText('The current site has not published any models yet.')
  ).toBeVisible()
})

it('a catalog request failure provides a retry which restores the model directory', async () => {
  const user = userEvent.setup()
  vi.spyOn(api, 'get')
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({ data: { success: true, data: { models } } })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DocsWorkspace modelId='' onSelect={() => {}} />
    </QueryClientProvider>
  )
  expect(
    await screen.findByText('Unable to load API documentation')
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('button', { name: /Chat One/ })).toBeVisible()
})

it('the narrow-screen directory toggle exposes its expanded state and closes after a selection', async () => {
  const user = userEvent.setup()
  setup()
  const toggle = screen.getByRole('button', {
    name: 'Model directory',
  })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  toggle.focus()
  await user.keyboard('{Enter}')
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await user.click(screen.getByRole('button', { name: /Chat One/ }))
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

it('recharge documentation copies create and query examples for the current gateway', async () => {
  const user = userEvent.setup()
  setup()
  expect(screen.getByRole('heading', { name: 'Recharge by API' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Copy recharge request' }))
  const create = await navigator.clipboard.readText()
  expect(create).toContain('/v1/recharge/orders')
  expect(create).toContain('Idempotency-Key: recharge-order-001')
  expect(create).toContain('"amount":"12.34"')
  await user.click(screen.getByRole('button', { name: 'Copy recharge query' }))
  expect(await navigator.clipboard.readText()).toContain('/v1/recharge/orders/$ORDER_ID')
  expect(screen.getByText(/"qr_code_image":/)).toBeVisible()
})
