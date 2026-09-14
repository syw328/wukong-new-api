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
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export type PlatformModelInsights = {
  source: 'platform'
  generated_at: string
  price_updated_at: string
  automatic_routing: boolean
  routes: Array<{
    id: string
    name: string
    state: string
    samples: number
    success_rate: number | null
    p50_duration_ms: number | null
    p50_ttft_ms: number | null
    speed_samples: number
    observed_at: string
    prices: Array<{
      name: string
      samples: number
      success_rate: number | null
      pending_count: number
      p50_duration_ms: number | null
      speed_samples: number
      input_per_million: number | null
      output_per_million: number | null
      base_price: number | null
      billing_type: string
      unit: string
    }>
  }>
  parameters: Array<{
    name: string
    type: string
    required?: boolean
    min?: number
    max?: number
    default?: string | number
    description?: string
  }>
  rate_limits: { createPerMinute: number; readPerMinute: number }
}

export function usePlatformInsights(model: string) {
  return useQuery({
    queryKey: ['platform-model-insights', model],
    queryFn: async () => {
      const result = await api.get<{
        success: boolean
        data: PlatformModelInsights | null
      }>('/api/platform-model-insights', { params: { model } })
      return requireServerSuccess(result.data).data
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}
