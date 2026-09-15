// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import {
  ArrowDownWideNarrow,
  Boxes,
  Code2,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { usePlatformModels, usePlatformSummaries } from './api'
import { BILLING_LABELS, DEFAULT_FILTERS } from './constants'
import { filterPlatformModels, sortMarketModels } from './helpers'
import { MarketCard } from './market-card'
import { MarketFilters } from './market-filters'
import { ModelDetailsDialog } from './model-details-dialog'
import {
  TYPE_LABELS,
  type MarketFiltersValue,
  type MarketSort,
  type ModelSummary,
  type PlatformModel,
} from './types'

import '@/styles/platform-market.css'

const EMPTY_MODELS: PlatformModel[] = []
const EMPTY_SUMMARIES: Record<string, ModelSummary> = {}
const SORT_LABELS: Record<MarketSort, string> = {
  default: 'Recommended order',
  name: 'Model name',
  price: 'Price: low to high (same unit)',
  success: 'Success rate: high to low',
  routes: 'Route count: high to low',
}

export function PlatformModelsPage(props: {
  mode?: 'catalog' | 'prices'
  initialModel?: string
}) {
  const { t } = useTranslation()
  const prices = props.mode === 'prices'
  const query = usePlatformModels()
  const models = query.data || EMPTY_MODELS
  const modelIds = useMemo(() => models.map((model) => model.id), [models])
  const summaryQuery = usePlatformSummaries(modelIds)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [filters, setFilters] = useState<MarketFiltersValue>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<MarketSort>('default')
  const [view, setView] = useState<'grid' | 'list'>(prices ? 'list' : 'grid')
  const [mobileFilters, setMobileFilters] = useState(false)
  const [selectedId, setSelectedId] = useState(props.initialModel || '')
  const [limit, setLimit] = useState(24)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const summaries = useMemo(() => {
    if (summaryQuery.isError || !summaryQuery.data) return EMPTY_SUMMARIES
    const data = summaryQuery.data
    if (data.pricesAvailable && Date.parse(data.validUntil) > now) {
      return data.summaries
    }
    return Object.fromEntries(
      Object.entries(data.summaries).map(([id, summary]) => [
        id,
        { ...summary, startingPrice: null },
      ])
    )
  }, [summaryQuery.data, summaryQuery.isError, now])
  const filtered = useMemo(
    () =>
      sortMarketModels(
        filterPlatformModels(
          models,
          filters.category,
          deferredSearch,
          filters,
          summaries
        ),
        sort,
        summaries
      ),
    [models, filters, deferredSearch, sort, summaries]
  )
  const selected = models.find((model) => model.id === selectedId)
  const vendorCount = new Set(models.map((model) => model.vendor || 'Other'))
    .size
  const activeFilters = Object.entries(filters).filter(
    ([, value]) => value !== 'all'
  ) as Array<[keyof MarketFiltersValue, string]>
  function resetFilters() {
    setFilters(DEFAULT_FILTERS)
    setSearch('')
    setLimit(24)
  }
  function updateFilters(value: MarketFiltersValue) {
    setFilters(value)
    setLimit(24)
  }
  return (
    <PublicLayout showMainContainer={false}>
      <main
        className={`market-page ${prices ? 'market-prices-page' : 'market-catalog-page'}`}
      >
        <header className='market-hero'>
          <div className='market-hero-content'>
            <div className='market-eyebrow'>
              <span className='market-status-dot' />
              <span>{t('A universe of models. One API.')}</span>
            </div>
            <h1>
              {t(prices ? 'Model Prices' : 'Model Square')}
              <span className='market-title-dot'>.</span>
            </h1>
            <p className='market-hero-description'>
              {t(
                prices
                  ? 'Every route, clearly priced. Compare starting prices, billing methods and reliability before you connect.'
                  : 'Find your next creative engine. Explore language, images, video and audio in one place.'
              )}
            </p>
            <div className='market-hero-stats'>
              <span>
                <b>{models.length}</b> {t('Models available')}
              </span>
              <span className='market-stat-divider' />
              <span>
                <b>{vendorCount}</b> {t('Manufacturers')}
              </span>
              <span className='market-stat-divider' />
              <span>
                <Code2 className='size-4' aria-hidden />
                {t('Unified API access')}
              </span>
            </div>
          </div>
          <div className='market-hero-art' aria-hidden='true'>
            <div className='market-orbit' />
            <div className='market-art-layer layer-back' />
            <div className='market-art-layer layer-middle' />
            <div className='market-art-layer layer-front'>
              <div className='market-art-top'>
                <Boxes size={26} />
                <span>API / 01</span>
              </div>
              <div className='market-art-symbol'>
                <Code2 size={72} strokeWidth={1.3} />
              </div>
              <div className='market-art-bottom'>
                <span className='market-art-bar' />
                <span>CONNECTED</span>
                <Sparkles size={14} />
              </div>
            </div>
            <div className='market-art-chip chip-top'>
              <span />
              AI
            </div>
            <div className='market-art-chip chip-bottom'>∞</div>
          </div>
        </header>
        <div className='market-search-row'>
          <div className='market-search'>
            <Search className='text-muted-foreground size-5' aria-hidden />
            <Input
              value={search}
              aria-label={t('Search models')}
              placeholder={t('Search models, manufacturers or tags…')}
              onChange={(event) => {
                setSearch(event.target.value)
                setLimit(24)
              }}
            />
            {search && (
              <Button
                variant='ghost'
                size='icon'
                onClick={() => {
                  setSearch('')
                  setLimit(24)
                }}
                aria-label={t('Clear search')}
              >
                <X className='size-4' />
              </Button>
            )}
          </div>
          <Button
            variant='outline'
            className='market-mobile-filter-toggle'
            aria-expanded={mobileFilters}
            aria-controls='market-filters'
            onClick={() => setMobileFilters((value) => !value)}
          >
            <SlidersHorizontal className='size-4' />
            {t('Filters')}
            {activeFilters.length > 0 && <Badge>{activeFilters.length}</Badge>}
          </Button>
        </div>
        <div className='market-workspace'>
          <aside
            id='market-filters'
            className={`market-sidebar ${mobileFilters ? 'is-expanded' : ''}`}
            aria-label={t('Model filters')}
          >
            <MarketFilters
              models={models}
              summaries={summaries}
              value={filters}
              search={deferredSearch}
              onChange={updateFilters}
              onReset={resetFilters}
            />
          </aside>
          <section
            className='market-results-section'
            aria-label={t('Model results')}
          >
            <div className='market-toolbar'>
              <span
                className='market-result-count'
                role='status'
                aria-live='polite'
              >
                <b>{filtered.length}</b> {t('Models available')}
                {activeFilters.length > 0 && (
                  <span className='text-muted-foreground'>
                    {' '}
                    / {models.length}
                  </span>
                )}
              </span>
              <div className='flex min-w-0 items-center gap-2'>
                <Select
                  value={sort}
                  onValueChange={(value) => {
                    if (value && value in SORT_LABELS) {
                      setSort(value as MarketSort)
                      setLimit(24)
                    }
                  }}
                >
                  <SelectTrigger
                    className='market-sort-select'
                    aria-label={t('Sort models')}
                  >
                    <ArrowDownWideNarrow className='size-4' aria-hidden />
                    <SelectValue>{t(SORT_LABELS[sort])}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SORT_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {t(label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div
                  className='market-view-switch'
                  role='group'
                  aria-label={t('Display mode')}
                >
                  <Button
                    variant={view === 'grid' ? 'secondary' : 'ghost'}
                    size='icon'
                    aria-label={t('Grid view')}
                    aria-pressed={view === 'grid'}
                    onClick={() => setView('grid')}
                  >
                    <LayoutGrid className='size-4' />
                  </Button>
                  <Button
                    variant={view === 'list' ? 'secondary' : 'ghost'}
                    size='icon'
                    aria-label={t('List view')}
                    aria-pressed={view === 'list'}
                    onClick={() => setView('list')}
                  >
                    <List className='size-4' />
                  </Button>
                </div>
              </div>
            </div>
            {activeFilters.length > 0 && (
              <div className='market-active-filters'>
                {activeFilters.map(([key, value]) => {
                  let label = value
                  if (key === 'category') {
                    label = TYPE_LABELS[value as keyof typeof TYPE_LABELS]
                  }
                  if (key === 'billing') label = BILLING_LABELS[value]
                  return (
                    <Button
                      key={key}
                      variant='secondary'
                      size='sm'
                      onClick={() =>
                        updateFilters({ ...filters, [key]: 'all' })
                      }
                      aria-label={t('Remove filter {{name}}', {
                        name: t(label),
                      })}
                    >
                      {t(label)}
                      <X className='size-3' aria-hidden />
                    </Button>
                  )
                })}
              </div>
            )}
            {query.isLoading && (
              <LoadingState message={t('Loading all site models...')} />
            )}
            {query.isError && (
              <ErrorState
                title={t('Unable to load the site model catalog')}
                onRetry={() => void query.refetch()}
              />
            )}
            {!query.isError && summaryQuery.isError && (
              <div role='status' className='market-price-error'>
                <span>
                  {t(
                    'Live prices are temporarily unavailable. You can still browse models.'
                  )}
                </span>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => void summaryQuery.refetch()}
                >
                  {t('Retry')}
                </Button>
              </div>
            )}
            {!query.isLoading && !query.isError && (
              <>
                <div
                  data-market-results
                  className={`market-results market-view-${view}`}
                >
                  {filtered.slice(0, limit).map((model) => (
                    <MarketCard
                      key={model.id}
                      model={model}
                      summary={summaries[model.id]}
                      loading={summaryQuery.isLoading}
                      onOpen={() => setSelectedId(model.id)}
                    />
                  ))}
                </div>
                {!filtered.length && (
                  <EmptyState
                    icon={Search}
                    title={t('No matching models')}
                    description={t(
                      'Try another keyword or clear your filters.'
                    )}
                    action={
                      <Button variant='outline' onClick={resetFilters}>
                        {t('Reset filters')}
                      </Button>
                    }
                  />
                )}
                {filtered.length > limit && (
                  <div className='py-8 text-center'>
                    <Button
                      variant='outline'
                      onClick={() => setLimit((value) => value + 24)}
                    >
                      {t('Show more models')} · {filtered.length - limit}
                    </Button>
                  </div>
                )}
              </>
            )}
            <p className='market-price-note'>
              {t(
                summaryQuery.data?.audience === 'account'
                  ? 'Your account prices. Final server-authorized settlement is authoritative.'
                  : 'Current site public prices. Sign in to see the prices applicable to your account.'
              )}
            </p>
          </section>
        </div>
        <ModelDetailsDialog
          model={selected}
          summary={selected ? summaries[selected.id] : undefined}
          onClose={() => setSelectedId('')}
        />
        <Footer />
      </main>
    </PublicLayout>
  )
}
