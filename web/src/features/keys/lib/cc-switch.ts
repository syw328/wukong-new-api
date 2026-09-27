// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import type { PlatformModel } from '@/features/platform-models/types'
import { getPricing } from '@/features/pricing/api'
import { api } from '@/lib/api'
import {
  portalApiOrigin,
  portalRequestPath,
  portalRuntime,
} from '@/lib/portal-runtime'
import { requireServerSuccess } from '@/lib/server-error-message'
import { readCachedStatus } from '@/lib/status-query'

export type CCSwitchApp = 'claude' | 'codex' | 'gemini'
export type CCSwitchModel = { id: string; apps: string[] }

export function ccSwitchServerAddress(): string {
  if (portalRuntime().basePath) return portalApiOrigin()
  const configured = readCachedStatus()?.server_address
  const address =
    typeof configured === 'string' && configured.trim()
      ? configured.trim()
      : window.location.origin
  return address.replace(/\/+$/, '').replace(/\/v1$/, '')
}

export function ccSwitchApiKey(key: string): string {
  const value = key.trim()
  if (!value || value.includes('*')) {
    throw new Error('Please select an active API key')
  }
  return value.startsWith('sk-') ? value : `sk-${value}`
}

// Validate the exported token itself, not the browser's management session.
// Keep it out of URLs, query-cache keys, persisted storage and error objects.
export async function loadCCSwitchModels(
  key: string,
  signal?: AbortSignal
): Promise<CCSwitchModel[]> {
  const response = await fetch(portalRequestPath('/v1/models'), {
    headers: { Authorization: `Bearer ${ccSwitchApiKey(key)}` },
    credentials: 'omit',
    cache: 'no-store',
    signal,
  })
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      'This API key is invalid, disabled or expired. Select an active key and import again.'
    )
  }
  if (!response.ok) {
    throw new Error('Unable to verify this API key. Please retry.')
  }
  const body = await response.json()
  if (body.success === false || !Array.isArray(body.data)) {
    throw new Error('Unable to verify this API key. Please retry.')
  }
  const allowed = new Set(body.data.map((item: { id: string }) => item.id))
  if (portalRuntime().basePath) {
    const result = await api.get<{
      success: boolean
      data: { models: PlatformModel[] }
    }>('/api/platform-catalog', { signal })
    return requireServerSuccess(result.data)
      .data.models.filter(
        (model) =>
          allowed.has(model.id) && model.available && model.type === 'chat'
      )
      .map((model) => ({ id: model.id, apps: model.client_apps ?? [] }))
  }
  const pricing = requireServerSuccess(await getPricing())
  return pricing.data
    .filter((model) => allowed.has(model.model_name))
    .map((model) => {
      const endpoints = model.supported_endpoint_types ?? []
      const apps: string[] = []
      if (endpoints.includes('anthropic')) apps.push('claude')
      if (endpoints.includes('openai-response')) apps.push('codex')
      if (endpoints.includes('gemini')) apps.push('gemini')
      return { id: model.model_name, apps }
    })
}

export function buildCCSwitchURL(
  app: CCSwitchApp,
  name: string,
  models: Record<string, string>,
  apiKey: string
): string {
  const serverAddress = ccSwitchServerAddress()
  const endpoint = app === 'codex' ? `${serverAddress}/v1` : serverAddress
  const params = new URLSearchParams({
    resource: 'provider',
    app,
    name,
    endpoint,
    apiKey: ccSwitchApiKey(apiKey),
    homepage: window.location.origin,
    enabled: 'true',
  })
  for (const [key, value] of Object.entries(models)) {
    if (value) params.set(key, value)
  }
  return `ccswitch://v1/import?${params.toString()}`
}
