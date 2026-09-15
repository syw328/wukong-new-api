// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import type {
  PlatformModel,
  ModelType,
  ModelSummary,
  MarketFiltersValue,
  MarketSort,
  PriceRoute,
} from './types'

export function filterPlatformModels(
  models: PlatformModel[],
  type: ModelType | 'all',
  search: string,
  filters: Partial<MarketFiltersValue> = {},
  summaries: Record<string, ModelSummary> = {}
): PlatformModel[] {
  const text = search.trim().toLowerCase()
  return models.filter(
    (model) =>
      (type === 'all' || model.type === type) &&
      (!filters.vendor ||
        filters.vendor === 'all' ||
        (model.vendor || 'Other') === filters.vendor) &&
      (!filters.tag ||
        filters.tag === 'all' ||
        model.tags.includes(filters.tag)) &&
      (!filters.billing ||
        filters.billing === 'all' ||
        summaries[model.id]?.billingUnits.includes(
          filters.billing as ModelSummary['billingUnits'][number]
        )) &&
      `${model.name} ${model.id} ${model.vendor || ''} ${model.tags.join(' ')}`
        .toLowerCase()
        .includes(text)
  )
}

export function platformRequestExample(
  model: PlatformModel
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const field of model.parameters) {
    if (field.default != null) params[field.name] = field.default
    else if (field.required) {
      params[field.name] = field.type.includes('multi')
        ? ['https://example.com/reference.png']
        : `<${field.name}>`
    }
  }
  return {
    model: model.id,
    prompt: 'A clean, softly lit product scene',
    params,
  }
}

export function formatPriceBookDate(value: string, language: string): string {
  const time = new Date(value)
  if (!Number.isFinite(time.getTime())) return '—'
  const locale =
    ({ zhCN: 'zh-CN', zhTW: 'zh-TW' } as Record<string, string>)[language] ||
    language ||
    'en'
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }
  try {
    return new Intl.DateTimeFormat(locale, options).format(time)
  } catch {
    return new Intl.DateTimeFormat('en', options).format(time)
  }
}

export function formatMarketAmount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(
    value
  )
}
export function sortMarketModels(
  models: PlatformModel[],
  sort: MarketSort,
  summaries: Record<string, ModelSummary>
): PlatformModel[] {
  if (sort === 'default') return models
  return [...models].sort((a, b) => {
    const left = summaries[a.id],
      right = summaries[b.id]
    if (sort === 'price') {
      const ap = left?.startingPrice,
        bp = right?.startingPrice
      if (!ap || !bp) return Number(!ap) - Number(!bp)
      return ap.unit.localeCompare(bp.unit) || ap.amount - bp.amount
    }
    if (sort === 'success') {
      return (right?.successRate ?? -1) - (left?.successRate ?? -1)
    }
    if (sort === 'routes') {
      return (right?.routeCount ?? -1) - (left?.routeCount ?? -1)
    }
    return a.name.localeCompare(b.name)
  })
}
export function routePriceOrder(route: PriceRoute): {
  unit: string
  amount: number
} {
  const row = route.rows[0]
  if (!row) return { unit: 'unknown', amount: Infinity }
  if (
    row.tokenRates.length &&
    (!row.estimate || row.estimate.nativeUnit === 'tokens')
  ) {
    return {
      unit: 'tokens',
      amount:
        row.tokenRates.find((rate) => rate.label === 'input')?.amount ??
        row.tokenRates[0].amount,
    }
  }
  let amount = row.estimate?.unitPrice ?? Infinity
  if (row.estimate?.nativeUnit === 'call') amount = row.estimate.amount
  if (row.estimate?.nativeUnit === 'characters') {
    amount = row.characterUnit ?? Infinity
  }
  return { unit: row.estimate?.nativeUnit || 'unknown', amount }
}
