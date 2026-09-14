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
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  PlatformRoutes,
  PlatformApiContract,
} from '../components/platform-model-insights'
import type { PlatformModelInsights } from '../hooks/use-platform-insights'

afterEach(cleanup)
const data: PlatformModelInsights = {
  source: 'platform',
  generated_at: '',
  price_updated_at: '',
  automatic_routing: true,
  rate_limits: { createPerMinute: 60, readPerMinute: 600 },
  parameters: [],
  routes: [
    {
      id: 'one',
      name: 'Route 1',
      state: 'unobserved',
      samples: 0,
      success_rate: null,
      p50_duration_ms: null,
      p50_ttft_ms: null,
      speed_samples: 0,
      observed_at: '',
      prices: [
        {
          name: 'group-one',
          input_per_million: 2,
          output_per_million: 4,
          unit: '算力',
          base_price: null,
          billing_type: 'token',
          samples: 0,
          success_rate: null,
          pending_count: 0,
          p50_duration_ms: null,
          speed_samples: 0,
        },
      ],
    },
  ],
}

describe('published platform data', () => {
  it('does not display a made-up success percentage when no samples exist', () => {
    render(<PlatformRoutes data={data} />)
    expect(screen.queryByText(/100.*%/)).not.toBeInTheDocument()
    expect(screen.getByText('group-one')).toBeInTheDocument()
    expect(screen.getByText('2 算力')).toBeInTheDocument()
  })
  it('shows zero percent for failed observed requests instead of hiding them', () => {
    render(
      <PlatformRoutes
        data={{
          ...data,
          routes: [{ ...data.routes[0], samples: 2, success_rate: 0 }],
        }}
      />
    )
    expect(screen.getByText('0.0%')).toBeInTheDocument()
  })
  it('never invents model-specific rate limits without a platform contract', () => {
    render(<PlatformApiContract data={null} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('690')).not.toBeInTheDocument()
    expect(screen.queryByText('275K')).not.toBeInTheDocument()
  })
  it('only displays parameters returned by the platform', () => {
    render(
      <PlatformApiContract
        data={{
          ...data,
          parameters: [
            { name: 'max_tokens', type: 'integer', min: 1, max: 32000 },
          ],
        }}
      />
    )
    expect(screen.getByText('max_tokens')).toBeInTheDocument()
    expect(screen.queryByText('logprobs')).not.toBeInTheDocument()
    expect(screen.queryByText('seed')).not.toBeInTheDocument()
  })
})
