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
import { afterEach, expect, it } from 'vitest'

import { UptimeSparkline } from '../components/model-details-uptime-sparkline'

afterEach(cleanup)
it('uses request-weighted success instead of averaging sparse and busy hourly rates', () => {
  render(
    <UptimeSparkline
      successRate={90}
      series={[
        {
          date: '2026-09-14T01:00:00Z',
          uptime_pct: 100,
          incidents: 0,
          outage_minutes: 0,
        },
        {
          date: '2026-09-14T02:00:00Z',
          uptime_pct: 0,
          incidents: 1,
          outage_minutes: 0,
        },
      ]}
    />
  )
  expect(screen.getByText('90.0%')).toBeInTheDocument()
  expect(screen.queryByText('50.0%')).not.toBeInTheDocument()
  expect(screen.getByRole('img')).not.toHaveAccessibleName(/30 day/i)
})
