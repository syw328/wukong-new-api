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
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RechargeFormCard } from '../components/recharge-form-card'

const disabledTopupProps = {
  topupInfo: {
    enable_online_topup: false,
    enable_stripe_topup: false,
    enable_redemption: false,
    payment_compliance_confirmed: false,
    pay_methods: [],
    min_topup: 0,
    stripe_min_topup: 0,
    amount_options: [],
    discount: {},
  },
  presetAmounts: [],
  selectedPreset: null,
  onSelectPreset: vi.fn(),
  topupAmount: 0,
  onTopupAmountChange: vi.fn(),
  paymentAmount: 0,
  calculating: false,
  onPaymentMethodSelect: vi.fn(),
  paymentLoading: null,
  redemptionCode: '',
  onRedemptionCodeChange: vi.fn(),
  onRedeem: vi.fn(),
  redeeming: false,
}

function mountPortal(origin = window.location.origin): void {
  const runtime = document.createElement('script')
  runtime.id = 'platform-portal-runtime'
  runtime.type = 'application/json'
  runtime.textContent = JSON.stringify({
    origin,
    basePath: '/api',
    transportPath: '/api/open-platform',
  })
  document.head.appendChild(runtime)
}

afterEach(() => {
  document.querySelector('#platform-portal-runtime')?.remove()
})

describe('main site recharge entry', () => {
  it('opens the current tenant home in a new tab when portal payments are disabled', () => {
    mountPortal()
    render(<RechargeFormCard {...disabledTopupProps} />)

    const link = screen.getByRole('link', {
      name: 'Go to main site to recharge',
    })
    expect(link).toHaveAttribute('href', `${window.location.origin}/`)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(
      screen.getByText(
        'Opens the main site in a new tab. You can return to this API page after recharging.'
      )
    ).toBeVisible()
    expect(screen.queryByText(/Online topup is not enabled/)).toBeNull()
    expect(screen.queryByText(/Redemption codes are disabled/)).toBeNull()
  })

  it('preserves the original payment guidance for a standalone API deployment', () => {
    render(<RechargeFormCard {...disabledTopupProps} />)

    expect(screen.queryByRole('link', { name: /main site/ })).toBeNull()
    expect(screen.getByText(/Online topup is not enabled/)).toBeVisible()
    expect(screen.getByText(/Redemption codes are disabled/)).toBeVisible()
  })

  it('does not offer a recharge link from a runtime pointing at a different tenant', () => {
    mountPortal('https://other-tenant.test')
    render(<RechargeFormCard {...disabledTopupProps} />)

    expect(screen.queryByRole('link', { name: /main site/ })).toBeNull()
  })
})
