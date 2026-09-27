// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { portalLocalStorage } from '@/lib/portal-runtime'

import { CCSwitchDialog } from '../dialogs/cc-switch-dialog'

const key = 'sk-test-import-key'
let client: QueryClient

beforeEach(() => {
  const runtime = document.createElement('script')
  runtime.id = 'platform-portal-runtime'
  runtime.type = 'application/json'
  runtime.textContent = JSON.stringify({
    origin: window.location.origin,
    basePath: '/api',
    transportPath: '/api/open-platform',
  })
  document.head.appendChild(runtime)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/platform-catalog') {
      return {
        data: {
          success: true,
          data: {
            models: [
              {
                id: 'gpt-6-astra',
                type: 'chat',
                available: true,
                client_apps: ['claude', 'codex', 'gemini'],
              },
              {
                id: 'gpt-5.6-sol',
                type: 'chat',
                available: true,
                client_apps: ['claude', 'codex', 'gemini'],
              },
              {
                id: 'claude-opus-4-6',
                type: 'chat',
                available: true,
                client_apps: ['claude', 'gemini'],
              },
              {
                id: 'gpt-image-2',
                type: 'image',
                available: true,
                client_apps: [],
              },
            ],
          },
        },
      }
    }
    return {
      data: {
        success: true,
        data: ['gpt-image-2', 'gpt-6-astra', 'gpt-5.6-sol', 'claude-opus-4-6'],
      },
    }
  })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-image-2' },
            { id: 'gpt-6-astra' },
            { id: 'claude-opus-4-6' },
          ],
        }),
        { status: 200 }
      )
    )
  )
  vi.spyOn(window, 'open').mockReturnValue(null)
})

afterEach(() => {
  client.clear()
  document.querySelector('#platform-portal-runtime')?.remove()
  localStorage.clear()
  vi.unstubAllGlobals()
})

function show() {
  render(
    <QueryClientProvider client={client}>
      <CCSwitchDialog open onOpenChange={() => {}} tokenKey={key} tokenId={7} />
    </QueryClientProvider>
  )
  return userEvent.setup()
}

it('Codex only offers native Responses models allowed by this API key', async () => {
  const user = show()
  await user.click(screen.getByRole('radio', { name: 'Codex' }))
  await user.click(screen.getByPlaceholderText('Select or enter model name'))
  expect(
    await screen.findByRole('option', { name: 'gpt-6-astra' })
  ).toBeVisible()
  expect(screen.queryByRole('option', { name: 'gpt-image-2' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'claude-opus-4-6' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'gpt-5.6-sol' })).toBeNull()
})

it('mounted import ignores stale server addresses and preserves the full key', async () => {
  portalLocalStorage.setItem(
    'status',
    JSON.stringify({ server_address: 'https://old.example/api/' })
  )
  const user = show()
  await user.click(screen.getByRole('radio', { name: 'Codex' }))
  await user.click(screen.getByPlaceholderText('Select or enter model name'))
  await user.click(await screen.findByRole('option', { name: 'gpt-6-astra' }))
  await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))
  const url = new URL(vi.mocked(window.open).mock.calls[0][0] as string)
  expect(url.searchParams.get('endpoint')).toBe(
    `${window.location.origin}/api/open-platform/v1`
  )
  expect(url.searchParams.get('apiKey')).toBe(key)
  expect(url.searchParams.get('model')).toBe('gpt-6-astra')
})

it('invalid API key blocks import and offers retry without logging out the web session', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }))
  show()
  expect(
    await screen.findByText(
      'This API key is invalid, disabled or expired. Select an active key and import again.'
    )
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Open CC Switch' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  expect(window.open).not.toHaveBeenCalled()
})

it('loading the key model list cannot export an unchecked configuration', async () => {
  vi.mocked(fetch).mockReturnValue(new Promise(() => {}))
  show()
  expect(screen.getByRole('button', { name: 'Open CC Switch' })).toBeDisabled()
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  const [url, init] = vi.mocked(fetch).mock.calls[0]
  expect(url).toBe('/api/open-platform/v1/models')
  expect(init?.headers).toEqual({ Authorization: `Bearer ${key}` })
  expect(init?.credentials).toBe('omit')
})

it.each(['Claude', 'Gemini'])(
  '%s import preserves the portal prefix without an extra /v1',
  async (app) => {
    const user = show()
    await user.click(screen.getByRole('radio', { name: app }))
    const input = screen.getAllByPlaceholderText(
      'Select or enter model name'
    )[0]
    await user.click(input)
    await user.click(
      await screen.findByRole('option', { name: 'claude-opus-4-6' })
    )
    await user.click(screen.getByRole('button', { name: 'Open CC Switch' }))
    const url = new URL(vi.mocked(window.open).mock.calls[0][0] as string)
    expect(url.searchParams.get('endpoint')).toBe(
      `${window.location.origin}/api/open-platform`
    )
    expect(url.searchParams.get('app')).toBe(app.toLowerCase())
  }
)

it('an API key with no compatible models cannot be exported', async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ data: [] }), { status: 200 })
  )
  show()
  expect(
    await screen.findByText(
      'No compatible models are available for this application and API key.'
    )
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Open CC Switch' })).toBeDisabled()
})
