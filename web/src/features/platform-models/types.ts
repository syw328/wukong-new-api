// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
export type ModelType = 'chat' | 'image' | 'video' | 'audio'
export type Scalar = string | number | boolean | null
export type ModelParameter = {
  name: string
  label: string
  type: string
  description?: string
  required?: boolean
  min?: number
  max?: number
  step?: number
  default?: Scalar
  options?: Array<{ value: Scalar; label: string }>
}
export type PlatformModel = {
  id: string
  name: string
  type: ModelType
  description: string
  available: boolean
  tags: string[]
  parameters: ModelParameter[]
  endpoint: string
  quote_endpoint?: string
  icon?: string
}
export type PriceField = ModelParameter & { value: Scalar }
export type PriceRow = {
  key: number
  name: string
  characterUnit: number | null
  contextThreshold: number | null
  tokenRates: Array<{ label: string; amount: number }>
  longContextRates: Array<{ label: string; amount: number }>
  estimate: { nativeUnit: string; amount: number; unitPrice: number } | null
}
export type PriceRoute = {
  id: string
  provider: string
  sku: string
  variantIndex: number
  variants: Array<{ index: number; label: string }>
  fields: PriceField[]
  rows: PriceRow[]
  successRate: number | null
  samples: number
}
export type PriceDetails = {
  model: PlatformModel
  routes: PriceRoute[]
  statisticsAvailable: boolean
  successRate: number | null
  samples: number
  priceBookId: string
  lockedAt: string
  validUntil: string
  audience: 'account' | 'site'
  currency: string
  unavailable: Array<{ id: string; provider: string; sku: string }>
}
export type PriceSelections = Record<
  string,
  { variantIndex: number; values: Record<string, Scalar> }
>
export const TYPE_LABELS: Record<ModelType | 'all', string> = {
  all: 'All models',
  chat: 'Language models',
  image: 'Image models',
  video: 'Video models',
  audio: 'Audio models',
}
