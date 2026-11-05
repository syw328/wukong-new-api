// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import type { KeyRoutingPolicy, RoutingStrategy } from '../types'

export const routingStrategies: RoutingStrategy[] = [
  'balanced',
  'cheapest',
  'fastest',
  'most_reliable',
]
export const routingDescriptions: Record<RoutingStrategy | 'custom', string> = {
  balanced: 'Balance success rate, price and speed across available routes.',
  cheapest: 'Prefer the lowest account price for the requested specification.',
  fastest: 'Prefer faster recent responses and generation times.',
  most_reliable: 'Prefer reliable routes with enough recent samples.',
  custom: 'Choose the models, exact routes and their order yourself.',
}
export function newRoutingPolicy(): KeyRoutingPolicy {
  return {
    version: 2,
    mode: 'automatic',
    default_strategy: 'balanced',
    allowed_strategies: ['balanced'],
    allow_fixed_routes: false,
    model_rules: [],
  }
}
export function changeRoutingStrategy(
  policy: KeyRoutingPolicy,
  strategy: RoutingStrategy
): KeyRoutingPolicy {
  return {
    ...policy,
    version: 2,
    mode: policy.mode || 'automatic',
    default_strategy: strategy,
    allowed_strategies: [strategy],
  }
}
export function selectModelRoutes(
  policy: KeyRoutingPolicy,
  model: string,
  ids: string[]
): KeyRoutingPolicy {
  const existing = policy.model_rules.find((rule) => rule.model === model)
  const rule = {
    model,
    default_strategy: policy.default_strategy,
    allowed_strategies: [...policy.allowed_strategies],
    ...existing,
    route_ids: ids,
    route_order: existing?.route_order || ('strategy' as const),
  }
  return {
    ...policy,
    version: 2,
    mode: 'custom',
    model_rules: [
      ...policy.model_rules.filter((item) => item.model !== model),
      ...(ids.length ? [rule] : []),
    ],
  }
}
export function routingDraftValid(
  policy: KeyRoutingPolicy,
  restricted: boolean,
  models: string[]
): boolean {
  if (restricted && !models.length) return false
  return (
    policy.mode !== 'custom' ||
    (restricted &&
      models.every((model) =>
        policy.model_rules.some(
          (rule) => rule.model === model && !!rule.route_ids?.length
        )
      ))
  )
}
