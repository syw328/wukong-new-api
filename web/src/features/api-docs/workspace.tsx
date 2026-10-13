// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { BookOpen, KeyRound, List, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePlatformModels } from '@/features/platform-models/api'
import {
  filterPlatformModels,
  modelCategory,
} from '@/features/platform-models/helpers'
import { ModelApi } from '@/features/platform-models/model-api'
import {
  TYPE_LABELS,
  type ModelCategory,
} from '@/features/platform-models/types'
import { portalApiOrigin, portalPagePath } from '@/lib/portal-runtime'

import { ProtocolReference } from './protocol-reference'

export function DocsWorkspace(props: {
  modelId: string
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const query = usePlatformModels()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<ModelCategory | 'all'>('all')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const models = query.data || []
  const model = models.find((item) => item.id === props.modelId)
  const visible = filterPlatformModels(models, category, search)
  const base = `${portalApiOrigin()}/v1`
  const select = (id: string) => {
    props.onSelect(id)
    setCatalogOpen(false)
  }
  return (
    <main className='api-docs-page'>
      <header className='api-docs-topbar'>
        <div className='flex items-center gap-3'>
          <BookOpen className='size-5' aria-hidden />
          <strong>{t('API documentation')}</strong>
          <Badge variant='outline'>v1</Badge>
        </div>
        <div className='api-docs-base'>
          <span>BASE URL</span>
          <code>{base}</code>
          <CopyButton value={base} aria-label={t('Copy Base URL')} size='sm' />
        </div>
        <Button
          variant='outline'
          nativeButton={false}
          render={<a role='link' href={portalPagePath('/keys')} />}
        >
          <KeyRound className='size-4' aria-hidden />
          {t('Manage API keys')}
        </Button>
      </header>
      <Button
        variant='outline'
        className='api-docs-catalog-toggle'
        aria-expanded={catalogOpen}
        aria-controls='api-docs-catalog'
        onClick={() => setCatalogOpen(!catalogOpen)}
      >
        <List className='size-4' />
        {t('Model directory')}
      </Button>
      <div className='api-docs-layout'>
        <aside
          id='api-docs-catalog'
          className={`api-docs-sidebar ${catalogOpen ? 'is-open' : ''}`}
          aria-label={t('Model directory')}
        >
          <Button
            variant={!props.modelId ? 'secondary' : 'ghost'}
            className='w-full justify-start'
            onClick={() => select('')}
          >
            {t('Quick start')}
          </Button>
          <div className='relative mt-4'>
            <Search
              className='text-muted-foreground absolute top-2.5 left-3 size-4'
              aria-hidden
            />
            <Input
              className='pl-9'
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t('Search models')}
              placeholder={t('Search models')}
            />
          </div>
          <div className='api-docs-categories' aria-label={t('Model filters')}>
            {(Object.keys(TYPE_LABELS) as Array<ModelCategory | 'all'>).map(
              (value) => (
                <Button
                  key={value}
                  size='sm'
                  variant={category === value ? 'secondary' : 'ghost'}
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                >
                  {t(TYPE_LABELS[value])}
                </Button>
              )
            )}
          </div>
          <p className='text-muted-foreground mb-3 text-xs' role='status'>
            {t('Model directory')} · {visible.length}
          </p>
          <nav
            className='api-docs-model-list'
            aria-label={t('Model documents')}
          >
            {visible.map((item) => (
              <Button
                key={item.id}
                variant={props.modelId === item.id ? 'secondary' : 'ghost'}
                className='api-docs-model'
                aria-current={props.modelId === item.id ? 'page' : undefined}
                onClick={() => select(item.id)}
              >
                <span>{item.name}</span>
                <code>{item.id}</code>
              </Button>
            ))}
          </nav>
          {!query.isLoading && !query.isError && !visible.length && (
            <p className='text-muted-foreground py-6 text-sm'>
              {t('No matching models. Try another search or category.')}
            </p>
          )}
        </aside>
        <article className='api-docs-content' key={props.modelId}>
          {query.isLoading && <LoadingState />}
          {!query.isLoading && query.isError && (
            <ErrorState
              title={t('Unable to load API documentation')}
              onRetry={() => {
                void query.refetch()
              }}
            />
          )}
          {!query.isLoading && !query.isError && props.modelId && !model && (
            <EmptyState
              title={t('Model not found')}
              description={t(
                'This model is not in the current site catalog. Choose a model from the directory.'
              )}
            />
          )}
          {!query.isLoading && !query.isError && (!props.modelId || model) && (
            <>
              <div className='text-muted-foreground mb-4 text-xs'>
                {t('API documentation')} /{' '}
                {model
                  ? t(TYPE_LABELS[modelCategory(model)])
                  : t('Quick start')}
              </div>
              <h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>
                {model?.name || t('Connect your first model')}
              </h1>
              <p className='text-muted-foreground mt-4 leading-7'>
                {model?.description ||
                  t(
                    'Create a key on this site, choose a model, and copy a complete request example. The model directory and parameters follow this site catalog.'
                  )}
              </p>
              {model && (
                <div className='my-4 flex flex-wrap items-center gap-2'>
                  <code className='rounded-md border px-3 py-1 text-sm break-all'>
                    {model.id}
                  </code>
                  <CopyButton
                    value={model.id}
                    aria-label={t('Copy model ID')}
                    size='sm'
                  />
                  <Badge variant='outline'>
                    {model.type === 'chat'
                      ? 'OpenAI Chat Completions'
                      : t('Asynchronous media API')}
                  </Badge>
                </div>
              )}
              {model && !model.available && (
                <p
                  role='status'
                  className='my-4 rounded-xl border border-amber-500/30 p-4'
                >
                  {t(
                    'This model is currently unavailable on this site. It cannot be submitted until a route is available.'
                  )}
                </p>
              )}
              {!model && <ProtocolReference />}
              {model && (
                <section
                  className='mt-8'
                  aria-label={t('Model request examples')}
                >
                  <ModelApi model={model} documentMode />
                </section>
              )}
              {!model && !models.length && (
                <EmptyState
                  title={t('No models available')}
                  description={t(
                    'The current site has not published any models yet.'
                  )}
                />
              )}
            </>
          )}
        </article>
      </div>
    </main>
  )
}
