// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import type { MarketFiltersValue } from './types'

export const BILLING_LABELS: Record<string, string> = {
  all: 'All billing methods',
  call: 'Billed per request',
  tokens: 'Billed per token',
  second: 'Per second',
  characters: 'Per character',
}
export const DEFAULT_FILTERS: MarketFiltersValue = {
  category: 'all',
  vendor: 'all',
  tag: 'all',
  billing: 'all',
}
