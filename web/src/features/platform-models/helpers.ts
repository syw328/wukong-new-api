// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import type { PlatformModel, ModelType } from './types'

export function filterPlatformModels(
  models: PlatformModel[],
  type: ModelType | 'all',
  search: string
): PlatformModel[] {
  const text = search.trim().toLowerCase()
  return models.filter(
    (model) =>
      (type === 'all' || model.type === type) &&
      `${model.name} ${model.id} ${model.tags.join(' ')}`
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
