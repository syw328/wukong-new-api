// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { expect, test } from 'vitest'

import { formatMarketAmount, filterPlatformModels } from '../helpers'
import type { PlatformModel } from '../types'

test('card amounts trim zeros without hiding a positive tiny price', () => {
  expect(formatMarketAmount(0.000001)).toBe('＜0.0001')
  expect(formatMarketAmount(1.234567)).toBe('1.2346')
  expect(formatMarketAmount(1.32)).toBe('1.32')
  expect(formatMarketAmount(0)).toBe('0')
})
test('case-normalized capability filters match each spelling', () => {
  const models = ['4k', '4K'].map((tag, index) => ({
    id: `image-${index}`,
    name: 'Image',
    type: 'image',
    tags: [tag],
  })) as PlatformModel[]
  expect(filterPlatformModels(models, 'image', '', { tag: '4K' })).toEqual(
    models
  )
})
