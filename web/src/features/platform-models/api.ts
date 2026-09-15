// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { portalRuntime } from '@/lib/portal-runtime'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import type {
  PlatformModel,
  PriceDetails,
  PriceSelections,
  MarketSummaries,
} from './types'

export function usePlatformModels() {
  const userId = useAuthStore((state) => state.auth.user?.id ?? 'anonymous')
  return useQuery({
    queryKey: ['platform-full-catalog', portalRuntime().origin, userId],
    queryFn: async () => {
      const result = await api.get<{
        success: boolean
        data: { models: PlatformModel[] }
      }>('/api/platform-catalog')
      return requireServerSuccess(result.data).data.models
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}
export function usePlatformPrices(model: string, selections: PriceSelections) {
  const userId = useAuthStore((state) => state.auth.user?.id ?? 'anonymous')
  return useQuery({
    queryKey: [
      'platform-model-prices',
      portalRuntime().origin,
      userId,
      model,
      selections,
    ],
    queryFn: async ({ signal }) => {
      const result = await api.post<{ success: boolean; data: PriceDetails }>(
        '/api/platform-model-prices',
        { model, selections },
        { signal }
      )
      return requireServerSuccess(result.data).data
    },
    enabled: Boolean(model),
    staleTime: 20_000,
    refetchInterval: 60_000,
    retry: false,
  })
}

export function usePlatformSummaries(models: string[]) {
  const userId = useAuthStore((state) => state.auth.user?.id ?? 'anonymous')
  return useQuery({
    queryKey: [
      'platform-market-summary',
      portalRuntime().origin,
      userId,
      models,
    ],
    queryFn: async ({ signal }) => {
      const result = await api.post<{
        success: boolean
        data: MarketSummaries
      }>('/api/platform-model-prices', { models }, { signal })
      return requireServerSuccess(result.data).data
    },
    enabled: models.length > 0,
    staleTime: 20_000,
    refetchInterval: 60_000,
    retry: false,
  })
}
