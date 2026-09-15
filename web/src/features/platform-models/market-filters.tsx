// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { FilterSection } from '@/features/pricing/components/pricing-sidebar'

import { BILLING_LABELS } from './constants'
import { filterPlatformModels } from './helpers'
import {
  TYPE_LABELS,
  type MarketFiltersValue,
  type ModelSummary,
  type PlatformModel,
} from './types'

export function MarketFilters(props: {
  models: PlatformModel[]
  summaries: Record<string, ModelSummary>
  value: MarketFiltersValue
  search: string
  onChange: (value: MarketFiltersValue) => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const vendors = [
    ...new Set(props.models.map((model) => model.vendor || 'Other')),
  ]
  const tags = [...new Set(props.models.flatMap((model) => model.tags))]
  const count = (key: keyof MarketFiltersValue, value: string): number => {
    const filters = { ...props.value, [key]: value }
    return filterPlatformModels(
      props.models,
      filters.category,
      props.search,
      filters,
      props.summaries
    ).length
  }
  const sections: Array<{
    key: keyof MarketFiltersValue
    title: string
    options: Array<{ value: string; label: string; count: number }>
  }> = [
    {
      key: 'category',
      title: 'Model category',
      options: Object.entries(TYPE_LABELS).map(([value, label]) => ({
        value,
        label: t(label),
        count: count('category', value),
      })),
    },
    {
      key: 'vendor',
      title: 'Manufacturers',
      options: ['all', ...vendors].map((value) => ({
        value,
        label: t(value === 'all' ? 'All Vendors' : value),
        count: count('vendor', value),
      })),
    },
    {
      key: 'billing',
      title: 'Billing method',
      options: Object.entries(BILLING_LABELS).map(([value, label]) => ({
        value,
        label: t(label),
        count: count('billing', value),
      })),
    },
    {
      key: 'tag',
      title: 'Model tags',
      options: ['all', ...tags].map((value) => ({
        value,
        label: t(value === 'all' ? 'All tags' : value),
        count: count('tag', value),
      })),
    },
  ]
  return (
    <div className='market-filter-panel'>
      <div className='mb-3 flex items-center justify-between gap-2'>
        <h2 className='flex items-center gap-2 text-sm font-semibold'>
          <SlidersHorizontal className='size-4' aria-hidden />
          {t('Filters')}
        </h2>
        <Button
          variant='ghost'
          size='sm'
          className='text-muted-foreground text-xs'
          onClick={props.onReset}
          aria-label={t('Reset filters')}
        >
          <RotateCcw className='size-3.5' aria-hidden />
          {t('Reset')}
        </Button>
      </div>
      {sections.map((section) => (
        <div key={section.key} role='group' aria-label={t(section.title)}>
          <FilterSection
            title={t(section.title)}
            value={props.value[section.key]}
            options={section.options}
            onChange={(value) =>
              props.onChange({ ...props.value, [section.key]: value })
            }
          />
        </div>
      ))}
    </div>
  )
}
