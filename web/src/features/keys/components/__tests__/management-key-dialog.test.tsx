// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
// New file: the API management key dialog on the keys page.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { ManagementKeyDialog } from '../dialogs/management-key-dialog'

const FULL_KEY = `sk-mgmt-${'a'.repeat(44)}wxyz`
let enabled: boolean
let calls: string[]
let client: QueryClient

function statusData() {
  return enabled
    ? {
        enabled: true,
        masked_key: 'sk-mgmt-****wxyz',
        created_at: '2026-11-25T08:00:00Z',
        last_used_at: null,
      }
    : { enabled: false, created_at: null, last_used_at: null }
}

beforeEach(() => {
  enabled = false
  calls = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    expect(url).toBe('/api/token/management-key')
    return { data: { success: true, data: statusData() } }
  })
  vi.spyOn(api, 'post').mockImplementation(async (url) => {
    calls.push(`POST ${url}`)
    enabled = true
    return {
      data: { success: true, data: { key: FULL_KEY, status: statusData() } },
    }
  })
  vi.spyOn(api, 'delete').mockImplementation(async (url) => {
    calls.push(`DELETE ${url}`)
    enabled = false
    return { data: { success: true, data: statusData() } }
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
})

function renderDialog(open = true, onOpenChange = () => undefined) {
  return render(
    <QueryClientProvider client={client}>
      <ManagementKeyDialog open={open} onOpenChange={onOpenChange} />
    </QueryClientProvider>
  )
}

test('turning the key on shows the full key once with a copy button, then only its mask', async () => {
  const user = userEvent.setup()
  const view = renderDialog()
  const toggle = await screen.findByRole('switch', {
    name: 'API management key',
  })
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(screen.getByText(/GET \/v1\/keys\/available-routes/)).toBeVisible()
  expect(screen.getByText(/\/v1\/keys" \\/)).toBeVisible()

  await user.click(toggle)
  const shown = await screen.findByRole('textbox', {
    name: 'Copy it now; this key is shown only once',
  })
  expect(shown).toHaveValue(FULL_KEY)
  expect(
    screen.getByRole('button', { name: 'Copy management key' })
  ).toBeVisible()
  await waitFor(() =>
    expect(screen.getByText(/sk-mgmt-\*\*\*\*wxyz/)).toBeVisible()
  )
  expect(calls).toEqual(['POST /api/token/management-key'])

  view.rerender(
    <QueryClientProvider client={client}>
      <ManagementKeyDialog open={false} onOpenChange={() => undefined} />
    </QueryClientProvider>
  )
  view.rerender(
    <QueryClientProvider client={client}>
      <ManagementKeyDialog open onOpenChange={() => undefined} />
    </QueryClientProvider>
  )
  await screen.findByText(/sk-mgmt-\*\*\*\*wxyz/)
  expect(screen.queryByDisplayValue(FULL_KEY)).not.toBeInTheDocument()
})

test('turning the key off asks first and then closes it', async () => {
  enabled = true
  const user = userEvent.setup()
  renderDialog()
  const toggle = await screen.findByRole('switch', {
    name: 'API management key',
  })
  await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))

  await user.click(toggle)
  expect(await screen.findByText('Turn off the management key?')).toBeVisible()
  expect(calls).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Turn off' }))
  await waitFor(() =>
    expect(calls).toEqual(['DELETE /api/token/management-key'])
  )
  await waitFor(() =>
    expect(
      screen.getByRole('switch', { name: 'API management key' })
    ).toHaveAttribute('aria-checked', 'false')
  )
})

test('resetting asks first and shows the replacement key', async () => {
  enabled = true
  const user = userEvent.setup()
  renderDialog()
  await user.click(await screen.findByRole('button', { name: 'Reset key' }))
  expect(await screen.findByText('Reset the management key?')).toBeVisible()
  const confirm = screen
    .getAllByRole('button', { name: 'Reset key' })
    .find((button) => button.closest('[role="alertdialog"]'))
  if (!confirm) throw new Error('Expected the confirmation button')
  await user.click(confirm)
  expect(
    await screen.findByRole('textbox', {
      name: 'Copy it now; this key is shown only once',
    })
  ).toHaveValue(FULL_KEY)
  expect(calls).toEqual(['POST /api/token/management-key'])
})
