import { ChevronRight } from 'lucide-react'
// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  usePlatformModels,
  useRoutingOptions,
} from '@/features/platform-models/api'
import {
  filterPlatformModels,
  foldPlatformModelFamilies,
  modelCategory,
} from '@/features/platform-models/helpers'
import { MarketModelIcon } from '@/features/platform-models/market-card'
import { ModelDetailsDialog } from '@/features/platform-models/model-details-dialog'
import { RouteOptionCard } from '@/features/platform-models/route-option-card'
import {
  TYPE_LABELS,
  type ModelCategory,
  type PlatformModel,
} from '@/features/platform-models/types'

import { selectModelRoutes } from '../lib/routing-policy'
import type { KeyRoutingPolicy } from '../types'

export function KeyRoutePicker(props: {
  policy: KeyRoutingPolicy
  models: string[]
  eligible: string[]
  onChange: (policy: KeyRoutingPolicy, models: string[]) => void
  activeModel: string
  onActiveModel: (id: string) => void
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<ModelCategory | 'all'>('all')
  const [detail, setDetail] = useState('')
  // Families the user opened or folded by hand; the rest follow the search and the model in view.
  const [folds, setFolds] = useState<Record<string, boolean>>({})
  const catalog = usePlatformModels()
  const models = (catalog.data || []).filter(
    (model) =>
      props.eligible.includes(model.id) || props.models.includes(model.id)
  )
  const filtered = filterPlatformModels(models, category, search)
  // "All models" reads as one short section per category, in the tabs' order; a category tab is one unnamed section.
  const sections = (
    category === 'all'
      ? Object.keys(TYPE_LABELS).filter((value) => value !== 'all')
      : [category]
  )
    .map((value) => ({
      value: value as ModelCategory,
      entries: foldPlatformModelFamilies(
        filtered.filter((model) => modelCategory(model) === value)
      ),
    }))
    .filter((section) => section.entries.length)
  const activeName =
    models.find((model) => model.id === props.activeModel)?.name ||
    props.activeModel
  const custom = props.policy.mode === 'custom'
  const routes = useRoutingOptions(custom ? props.activeModel : '')
  const selected =
    props.policy.model_rules.find((rule) => rule.model === props.activeModel)
      ?.route_ids || []
  function routeCount(id: string) {
    return (
      props.policy.model_rules.find((rule) => rule.model === id)?.route_ids
        ?.length || 0
    )
  }
  function toggleModel(id: string, checked: boolean) {
    const next = checked
      ? [...new Set([...props.models, id])]
      : props.models.filter((model) => model !== id)
    props.onChange(
      {
        ...props.policy,
        model_rules: props.policy.model_rules.filter((rule) =>
          next.includes(rule.model)
        ),
      },
      next
    )
    if (checked) props.onActiveModel(id)
  }
  function setRoutes(ids: string[]) {
    props.onChange(selectModelRoutes(props.policy, props.activeModel, ids), [
      ...new Set([...props.models, props.activeModel]),
    ])
  }
  function modelRow(model: PlatformModel, child = false) {
    return (
      <div
        key={model.id}
        className='key-model-row'
        data-active={props.activeModel === model.id || undefined}
        data-child={child || undefined}
      >
        <Checkbox
          aria-label={t('Allow model {{name}}', { name: model.name })}
          checked={props.models.includes(model.id)}
          onCheckedChange={(checked) => toggleModel(model.id, checked)}
        />
        <Button
          type='button'
          variant='ghost'
          className='h-auto min-w-0 flex-1 justify-start px-1 py-2 text-left'
          onClick={() =>
            custom ? props.onActiveModel(model.id) : setDetail(model.id)
          }
        >
          <MarketModelIcon model={model} />
          <span className='min-w-0'>
            <strong className='block text-sm break-words'>{model.name}</strong>
            <small className='text-muted-foreground block break-all'>
              {model.id}
            </small>
          </span>
        </Button>
      </div>
    )
  }
  return (
    <>
      <div className='key-route-picker'>
        <section className='key-model-list' aria-label={t('Choose models')}>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Search models, manufacturers or tags…')}
            aria-label={t('Search models')}
          />
          <div
            className='flex flex-wrap gap-1'
            role='group'
            aria-label={t('Model category')}
          >
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <Button
                key={value}
                type='button'
                size='sm'
                variant={category === value ? 'secondary' : 'ghost'}
                aria-pressed={category === value}
                onClick={() => setCategory(value as ModelCategory | 'all')}
              >
                {t(label)}
              </Button>
            ))}
          </div>
          {catalog.isLoading && <LoadingState />}
          {catalog.isError && (
            <ErrorState
              title={t('Unable to load the site model catalog')}
              onRetry={() => void catalog.refetch()}
            />
          )}
          <div className='key-model-scroll'>
            {sections.map((section) => (
              <div key={section.value}>
                {category === 'all' && (
                  <h4 className='key-model-section'>
                    {t(TYPE_LABELS[section.value])}
                  </h4>
                )}
                {section.entries.map((entry) => {
                  if (entry.kind === 'model') return modelRow(entry.model)
                  const chosen = entry.models.filter((model) =>
                    props.models.includes(model.id)
                  ).length
                  const open =
                    folds[entry.id] ??
                    (Boolean(search.trim()) ||
                      entry.models.some(
                        (model) => model.id === props.activeModel
                      ))
                  return (
                    <div
                      key={`family:${entry.id}`}
                      className='key-model-family'
                    >
                      <Button
                        type='button'
                        variant='ghost'
                        className='key-model-family-head'
                        aria-expanded={open}
                        onClick={() =>
                          setFolds((value) => ({ ...value, [entry.id]: !open }))
                        }
                      >
                        <ChevronRight className='key-model-family-arrow' />
                        <MarketModelIcon model={entry.models[0]} />
                        <strong className='min-w-0 flex-1 truncate text-sm'>
                          {entry.title}
                        </strong>
                        <small
                          className='text-muted-foreground'
                          data-chosen={chosen || undefined}
                          title={
                            chosen
                              ? t('{{count}} models selected', {
                                  count: chosen,
                                })
                              : undefined
                          }
                        >
                          {chosen
                            ? `${chosen}/${entry.models.length}`
                            : entry.models.length}
                        </small>
                      </Button>
                      {open &&
                        entry.models.map((model) => modelRow(model, true))}
                    </div>
                  )
                })}
              </div>
            ))}
            {!catalog.isLoading && !catalog.isError && !filtered.length && (
              <EmptyState title={t('No matching models')} />
            )}
          </div>
        </section>
        {custom && (
          <section className='key-route-list' aria-label={t('Choose routes')}>
            {!props.activeModel ? (
              <EmptyState title={t('Choose a model to see its routes')} />
            ) : (
              <>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div>
                    <h3 className='font-semibold'>{activeName}</h3>
                    <Button
                      size='sm'
                      variant='link'
                      type='button'
                      onClick={() => setDetail(props.activeModel)}
                    >
                      {t('Model details')}
                    </Button>
                  </div>
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      type='button'
                      variant='outline'
                      disabled={!routes.data}
                      onClick={() =>
                        setRoutes(
                          (routes.data?.routes || [])
                            .filter((route) => route.available)
                            .slice(0, 32)
                            .map((route) => route.id)
                        )
                      }
                    >
                      {t('Select available routes')}
                    </Button>
                    <Button
                      size='sm'
                      type='button'
                      variant='ghost'
                      disabled={!selected.length}
                      onClick={() => setRoutes([])}
                    >
                      {t('Clear')}
                    </Button>
                  </div>
                </div>
                {routes.isLoading && <LoadingState />}
                {routes.isError && (
                  <ErrorState
                    title={t('Unable to load routes')}
                    onRetry={() => void routes.refetch()}
                  />
                )}
                {(routes.data?.routes || []).map((route) => (
                  <RouteOptionCard
                    key={route.id}
                    route={route}
                    modelName={activeName}
                    chat={routes.data?.model.type === 'chat'}
                    selected={selected.includes(route.id)}
                    onSelect={(checked) =>
                      setRoutes(
                        checked
                          ? [...selected, route.id].slice(0, 32)
                          : selected.filter((id) => id !== route.id)
                      )
                    }
                  />
                ))}
                {!routes.isLoading &&
                  !routes.isError &&
                  !routes.data?.routes.length && (
                    <EmptyState title={t('No available routes')} />
                  )}
                {selected
                  .filter(
                    (id) =>
                      !routes.data?.routes.some((route) => route.id === id)
                  )
                  .map((id) => (
                    <div key={id} className='rounded-lg border p-3 text-sm'>
                      <span>
                        {t('Saved route unavailable')} · {id}
                      </span>
                      <Button
                        type='button'
                        size='sm'
                        variant='ghost'
                        onClick={() =>
                          setRoutes(selected.filter((route) => route !== id))
                        }
                      >
                        {t('Remove')}
                      </Button>
                    </div>
                  ))}
              </>
            )}
          </section>
        )}
        <aside className='key-selected-list' aria-label={t('Selected models')}>
          <h3 className='font-semibold'>
            {t('Selected models')}{' '}
            <span className='text-muted-foreground'>{props.models.length}</span>
          </h3>
          {!props.models.length && (
            <p className='text-muted-foreground text-sm'>
              {t('Select at least one model')}
            </p>
          )}
          {props.models.map((id) => (
            <div key={id} className='key-selected-row'>
              <Button
                type='button'
                variant='ghost'
                className='h-auto min-w-0 flex-1 items-start px-0 text-left whitespace-normal'
                onClick={() => props.onActiveModel(id)}
              >
                <span>
                  <strong className='block text-sm'>
                    {models.find((model) => model.id === id)?.name || id}
                  </strong>
                  {custom && (
                    <small data-missing={!routeCount(id) || undefined}>
                      {t('{{count}} routes selected', {
                        count: routeCount(id),
                      })}
                    </small>
                  )}
                </span>
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                aria-label={t('Remove model {{name}}', { name: id })}
                onClick={() => toggleModel(id, false)}
              >
                ×
              </Button>
            </div>
          ))}
        </aside>
      </div>
      {detail && (
        <ModelDetailsDialog
          model={models.find((model) => model.id === detail)}
          onClose={() => setDetail('')}
        />
      )}
    </>
  )
}
