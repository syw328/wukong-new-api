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
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { GrowthText } from '../components/growth-text'
import { RankingsHero } from '../components/rankings-hero'

afterEach(cleanup)
it('period tabs expose selection and request the selected period', async () => {
  const change = vi.fn()
  render(<RankingsHero period='week' onPeriodChange={change} />)
  const tabs = screen.getAllByRole('tab')
  expect(tabs).toHaveLength(5)
  expect(tabs[2]).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(tabs[0])
  expect(change).toHaveBeenCalledWith('yesterday')
})
it('no previous traffic is not displayed as an invented 100 percent increase', () => {
  render(<GrowthText value={null} />)
  expect(screen.queryByText(/100%|0%/)).not.toBeInTheDocument()
})
