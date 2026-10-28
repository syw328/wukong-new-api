// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { describe, expect, test } from 'vitest'

import {
  newRoutingPolicy,
  selectModelRoutes,
  changeRoutingStrategy,
  routingDraftValid,
} from '../routing-policy'

describe('key route draft', () => {
  test('new keys lock the default strategy', () => {
    expect(newRoutingPolicy().allowed_strategies).toEqual(['balanced'])
  })
  test('selecting and removing models keeps exact route order without adding other models', () => {
    let value = selectModelRoutes(newRoutingPolicy(), 'image-a', ['b', 'a'])
    value = selectModelRoutes(value, 'image-b', ['c'])
    expect(value.model_rules[0].route_ids).toEqual(['b', 'a'])
    expect(routingDraftValid(value, true, ['image-a', 'image-b'])).toBe(true)
    expect(routingDraftValid(value, true, ['image-a', 'missing'])).toBe(false)
    value = selectModelRoutes(value, 'image-a', [])
    expect(value.model_rules.map((rule) => rule.model)).toEqual(['image-b'])
  })
  test('changing a locked strategy replaces its permission without mutating the source', () => {
    const value = newRoutingPolicy()
    const next = changeRoutingStrategy(value, 'cheapest')
    expect(next.allowed_strategies).toEqual(['cheapest'])
    expect(value.default_strategy).toBe('balanced')
  })
})
