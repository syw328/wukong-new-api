/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { OverviewDashboard } from '../overview-dashboard'

const storageKey = 'dashboard_overview_setup_guide_expanded'
let client: QueryClient
let keyLookupError: Error | null
let hasConsumeLog: boolean
let walletQuota: number | null

beforeEach(() => {
  hasConsumeLog = true
  walletQuota = null
  window.localStorage.clear()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'dashboard-user',
    role: 1,
    quota: 1000000,
    used_quota: 1000,
    request_count: 1,
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  keyLookupError = null
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    switch (url) {
      case '/api/token/?p=1&size=10':
        if (keyLookupError) throw keyLookupError
        return {
          data: {
            success: true,
            data: {
              items: [{ id: 1, name: 'App key', key: 'masked', status: 1 }],
            },
          },
        }
      case '/api/status':
        return {
          data: {
            data: {
              api_info_enabled: false,
              announcements_enabled: false,
              faq_enabled: false,
              uptime_kuma_enabled: false,
            },
          },
        }
      case '/api/user/models':
        return { data: { success: true, data: ['gpt-4o-mini'] } }
      case '/api/data/self':
        return { data: { success: true, data: [] } }
      case '/api/user/self': {
        // The server re-reads the platform wallet here; tests can make it
        // differ from the login-time snapshot in the auth store.
        const user = useAuthStore.getState().auth.user
        return {
          data: {
            success: true,
            data: { ...user, quota: walletQuota ?? user?.quota ?? 0 },
          },
        }
      }
      case '/api/log/self?p=1&page_size=1&type=2':
        return {
          data: {
            success: true,
            data: {
              items: hasConsumeLog ? [{ id: 9, type: 2 }] : [],
              total: hasConsumeLog ? 1 : 0,
              page: 1,
              page_size: 1,
            },
          },
        }
      case '/api/platform-catalog':
        return {
          data: {
            success: true,
            data: {
              models: [
                {
                  id: 'image-first',
                  type: 'image',
                  available: true,
                  client_apps: [],
                },
                {
                  id: 'plain-chat',
                  type: 'chat',
                  available: true,
                  client_apps: [],
                },
                {
                  id: 'claude-chat',
                  type: 'chat',
                  available: true,
                  client_apps: ['claude'],
                },
              ],
            },
          },
        }
      default:
        throw new Error(`Unexpected dashboard request: ${url}`)
    }
  })
})

afterEach(() => {
  cleanup()
  document.querySelector('#platform-portal-runtime')?.remove()
  client.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  window.localStorage.clear()
})

async function renderOverview() {
  const router = createRouter({
    routeTree: createRootRoute({ component: OverviewDashboard }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('overview setup guide', () => {
  it('shows usage first and only a header entry when setup is complete', async () => {
    await renderOverview()

    const toggle = await screen.findByRole('button', { name: 'Setup guide' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await screen.findByRole('heading', { name: 'Connection details' })
    expect(
      screen.getAllByRole('heading').map((heading) => heading.textContent)
    ).toEqual(['Overview', 'Usage at a glance', 'Connection details'])
    expect(screen.queryByText('Setup guide complete')).not.toBeInTheDocument()
    expect(screen.queryByText('Setup progress: 3/3')).not.toBeInTheDocument()
    for (const name of ['API Keys', 'Channels', 'Usage Logs', 'Pricing']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    const panel = document.getElementById(
      toggle.getAttribute('aria-controls') ?? ''
    )
    expect(panel).toBeInTheDocument()
    expect(panel).not.toBeVisible()
  })

  it('toggles the completed guide with the keyboard and restores focus after hiding it', async () => {
    const user = userEvent.setup()
    await renderOverview()
    const toggle = await screen.findByRole('button', { name: 'Setup guide' })

    await user.tab()
    expect(toggle).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(
      document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    ).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: 'Build on your API gateway in minutes',
      })
    ).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^API Keys/ })).toBeVisible()
    )

    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Hide setup guide' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })

  it('restores the completed guide preference after remounting', async () => {
    const user = userEvent.setup()
    const first = await renderOverview()
    await user.click(await screen.findByRole('button', { name: 'Setup guide' }))
    first.unmount()

    const second = await renderOverview()
    expect(
      await screen.findByRole('button', { name: 'Setup guide' })
    ).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Hide setup guide' }))
    second.unmount()

    await renderOverview()
    expect(
      await screen.findByRole('button', { name: 'Setup guide' })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Setup guide complete')).not.toBeInTheDocument()
  })

  it('keeps the existing progress banner when an incomplete guide is manually collapsed', async () => {
    const user = userEvent.setup()
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'new-user', role: 1 })
    hasConsumeLog = false
    await renderOverview()

    await user.click(
      await screen.findByRole('button', { name: 'Hide setup guide' })
    )
    expect(screen.getByText('Setup progress: 1/3')).toBeVisible()
    expect(
      screen.getByText('Setup guide is collapsed. Expand it anytime.')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'API Keys' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Setup guide' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show setup guide' }))
    expect(
      screen.getByRole('button', { name: 'Hide setup guide' })
    ).toBeVisible()
  })

  it('removes the collapsed progress banner when the remaining setup step completes', async () => {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'dashboard-user',
      role: 1,
      quota: 1000000,
    })
    window.localStorage.setItem(storageKey, 'collapsed')
    hasConsumeLog = false
    await renderOverview()
    expect(await screen.findByText('Setup progress: 2/3')).toBeVisible()

    hasConsumeLog = true
    await act(() =>
      client.refetchQueries({
        queryKey: ['dashboard', 'overview', 'successful-call'],
      })
    )
    expect(
      await screen.findByRole('button', { name: 'Setup guide' })
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/Setup progress:/)).not.toBeInTheDocument()
  })

  it('does not show a completed setup entry when the key lookup fails', async () => {
    keyLookupError = new Error('Key lookup unavailable')
    await renderOverview()

    expect(
      await screen.findByRole('button', { name: 'Hide setup guide' })
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Setup guide' })
    ).not.toBeInTheDocument()
  })

  it('orders the steps top-up, key, tool and ticks them from the live wallet, keys and successful calls', async () => {
    walletQuota = 0
    hasConsumeLog = false
    await renderOverview()

    const steps = within(
      await screen.findByRole('list', { name: 'Setup steps' })
    ).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual([
      expect.stringContaining('Recharge'),
      expect.stringContaining('Create API Key'),
      expect.stringContaining('Connect a tool'),
    ])
    // The login snapshot still has quota; the re-read wallet is empty.
    expect(within(steps[0]).queryByText('Completed')).not.toBeInTheDocument()
    expect(within(steps[1]).getByText('Completed')).toBeInTheDocument()
    expect(within(steps[2]).queryByText('Completed')).not.toBeInTheDocument()
  })

  it('imports the preferred key into the existing CC Switch dialog from the tool step', async () => {
    const user = userEvent.setup()
    hasConsumeLog = false
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: { key: 'real-key-for-import' } },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 401 })
    )
    await renderOverview()

    const ccSwitch = await screen.findByRole('button', { name: 'CC Switch' })
    await waitFor(() => expect(ccSwitch).toBeEnabled())
    await user.click(ccSwitch)
    expect(post).toHaveBeenCalledWith('/api/token/1/key')
    const dialog = await screen.findByRole('dialog', {
      name: 'Import to CC Switch',
    })
    expect(within(dialog).getByRole('radio', { name: 'Claude' })).toBeChecked()
  })

  it('shows the portal Base URL and endpoints, masks the key and copies the first request with the real key', async () => {
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
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: { key: 'real-secret-key' } },
    })
    await renderOverview()

    const card = await screen.findByRole('region', {
      name: 'Connection details',
    })
    // Customers get the unified site address, not the portal transport path.
    const base = window.location.origin
    expect(within(card).getByText(`${base}/v1`)).toBeVisible()
    expect(card).not.toHaveTextContent('/api/open-platform')
    expect(card).toHaveTextContent(`ANTHROPIC_BASE_URL="${base}"`)
    expect(within(card).getByText(`${base}/v1/messages`)).toBeVisible()
    expect(
      within(card).getByText(`${base}/v1beta/models/{model}:generateContent`)
    ).toBeVisible()
    await waitFor(() => expect(card).toHaveTextContent('"model":"plain-chat"'))
    expect(card).toHaveTextContent('ANTHROPIC_MODEL="claude-chat"')
    expect(card).toHaveTextContent('sk-masked')
    expect(card).not.toHaveTextContent('real-secret-key')

    await user.click(
      within(card).getByRole('button', {
        name: 'Copy First request (cURL) with your API key',
      })
    )
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toContain(
        'Authorization: Bearer sk-real-secret-key'
      )
    )
    expect(await navigator.clipboard.readText()).toContain(
      `curl ${base}/v1/chat/completions`
    )
  })
})
