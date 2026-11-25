// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it } from 'vitest'

import type { PlatformModel } from '@/features/platform-models/types'

import { ProtocolGuides } from '../protocol-guides'

const chat = (id: string, apps: string[]): PlatformModel => ({
  id,
  name: id,
  description: '',
  type: 'chat',
  available: true,
  tags: [],
  parameters: [],
  endpoint: '/v1/chat/completions',
  client_apps: apps,
})
const models: PlatformModel[] = [
  chat('plain-chat', []),
  chat('claude-capable', ['claude', 'gemini']),
  chat('native-responses', ['claude', 'gemini', 'codex']),
  {
    id: 'image-one',
    name: 'Image One',
    description: '',
    type: 'image',
    available: true,
    tags: [],
    parameters: [],
    endpoint: '/v1/media/generations',
  },
]
const origin = `${window.location.origin}/api/open-platform`

beforeEach(() => {
  const runtime = document.createElement('script')
  runtime.id = 'platform-portal-runtime'
  runtime.type = 'application/json'
  runtime.textContent = JSON.stringify({
    origin: window.location.origin,
    basePath: '/api',
    transportPath: '/api/open-platform',
  })
  document.body.append(runtime)
})
afterEach(() => document.querySelector('#platform-portal-runtime')?.remove())

it('the Anthropic guide uses the portal Base URL without /v1 for Claude Code and copies both complete examples', async () => {
  const user = userEvent.setup()
  render(<ProtocolGuides models={models} />)
  await user.click(screen.getByRole('tab', { name: 'Anthropic Messages' }))
  const panel = screen.getByRole('tabpanel', { name: 'Anthropic Messages' })
  expect(within(panel).getByText(`${origin}/v1/messages`)).toBeVisible()
  expect(within(panel).getByText('x-api-key: $PLATFORM_API_KEY')).toBeVisible()
  await user.click(
    within(panel).getByRole('button', { name: 'Copy Claude Code setup' })
  )
  const setup = await navigator.clipboard.readText()
  expect(setup).toContain(`ANTHROPIC_BASE_URL="${origin}"`)
  expect(setup).toContain('ANTHROPIC_MODEL="claude-capable"')
  await user.click(
    within(panel).getByRole('button', {
      name: 'Copy all for Anthropic Messages',
    })
  )
  const all = await navigator.clipboard.readText()
  expect(all).toContain(`curl --fail-with-body "${origin}/v1/messages"`)
  expect(all).toContain('anthropic-version: 2023-06-01')
  expect(all).toContain(`base_url="${origin}"`)
  expect(all).toContain('```python')
})

it('the Gemini guide sends the key in a header for normal and streaming calls', async () => {
  const user = userEvent.setup()
  render(<ProtocolGuides models={models} />)
  await user.click(screen.getByRole('tab', { name: 'Gemini' }))
  const panel = screen.getByRole('tabpanel', { name: 'Gemini' })
  await user.click(
    within(panel).getByRole('button', { name: 'Copy cURL example for Gemini' })
  )
  const curl = await navigator.clipboard.readText()
  expect(curl).toContain(
    `${origin}/v1beta/models/claude-capable:generateContent"`
  )
  expect(curl).toContain(
    `${origin}/v1beta/models/claude-capable:streamGenerateContent?alt=sse"`
  )
  expect(curl).toContain('-H "x-goog-api-key: $PLATFORM_API_KEY"')
  expect(curl).not.toContain('?key=')
})

it('the Responses guide prefers a model with a native Responses route', async () => {
  const user = userEvent.setup()
  render(<ProtocolGuides models={models} />)
  await user.click(screen.getByRole('tab', { name: 'OpenAI Responses' }))
  const panel = screen.getByRole('tabpanel', { name: 'OpenAI Responses' })
  await user.click(
    within(panel).getByRole('button', {
      name: 'Copy Python example for OpenAI Responses',
    })
  )
  const python = await navigator.clipboard.readText()
  expect(python).toContain(`base_url="${origin}/v1"`)
  expect(python).toContain(
    'client.responses.create(model="native-responses", input="Hello")'
  )
})

it('the media guide follows quote, creation, polling and download, and marks the OpenAI image endpoints as legacy', async () => {
  const user = userEvent.setup()
  render(<ProtocolGuides models={models} />)
  await user.click(
    screen.getByRole('tab', { name: 'Images, video, audio and tools' })
  )
  const panel = screen.getByRole('tabpanel', {
    name: 'Images, video, audio and tools',
  })
  for (const path of [
    '/v1/media/quotes',
    '/v1/media/generations',
    '/v1/media/generations/{task_id}',
    '/v1/tasks/{task_id}/artifacts',
  ]) {
    expect(within(panel).getByText(`${origin}${path}`)).toBeVisible()
  }
  expect(within(panel).getByText('Legacy, still available')).toBeVisible()
  expect(
    within(panel).getByText(`${origin}/v1/images/generations`)
  ).toBeVisible()
  await user.click(
    within(panel).getByRole('button', {
      name: 'Copy cURL example for Images, video, audio and tools',
    })
  )
  const curl = await navigator.clipboard.readText()
  expect(curl).toContain('"model": "image-one"')
  expect(curl.indexOf('/v1/media/quotes')).toBeLessThan(
    curl.indexOf('/v1/media/generations')
  )
})

it('an empty catalog still documents every protocol with a model placeholder', () => {
  render(<ProtocolGuides models={[]} />)
  expect(screen.getAllByRole('tab')).toHaveLength(5)
  expect(
    screen.getByRole('tabpanel', { name: 'OpenAI Chat Completions' })
  ).toHaveTextContent('"model":"MODEL_ID"')
})
