// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import {
  ArrowLeft,
  ChevronRight,
  Coins,
  Image,
  MessageSquare,
  Music,
  Search,
  Video,
} from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { getLobeIcon } from '@/lib/lobe-icon'
import { useAuthStore } from '@/stores/auth-store'

import { usePlatformModels } from './api'
import { filterPlatformModels } from './helpers'
import { ModelApi } from './model-api'
import { ModelPrices } from './model-prices'
import { TYPE_LABELS, type ModelType, type PlatformModel } from './types'

const EMPTY_MODELS: PlatformModel[] = []
const ICONS = { chat: MessageSquare, image: Image, video: Video, audio: Music }

function ModelHeading(props: { model: PlatformModel }) {
  const { t } = useTranslation()
  const Icon = ICONS[props.model.type]
  return (
    <div className='flex min-w-0 items-center gap-4'>
      <div className='bg-muted grid size-14 shrink-0 place-items-center rounded-2xl'>
        {props.model.icon ? (
          getLobeIcon(props.model.icon, 32)
        ) : (
          <Icon className='size-7' />
        )}
      </div>
      <div className='min-w-0 space-y-1'>
        <span className='text-muted-foreground text-xs'>
          {t(TYPE_LABELS[props.model.type])}
        </span>
        <h2 className='text-2xl font-semibold tracking-tight break-words'>
          {props.model.name}
        </h2>
        <div className='flex items-center gap-1'>
          <code className='text-muted-foreground text-xs break-all'>
            {props.model.id}
          </code>
          <CopyButton value={props.model.id} size='sm' />
        </div>
      </div>
    </div>
  )
}
function ModelDetailsBody(props: {
  model: PlatformModel
  pricesOnly?: boolean
}) {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id ?? 'anonymous')
  return (
    <div className='space-y-6'>
      <ModelHeading model={props.model} />
      <p className='text-muted-foreground text-sm leading-relaxed'>
        {props.model.description}
      </p>
      {!props.model.available && (
        <p
          role='status'
          className='text-muted-foreground rounded-xl border p-4 text-sm'
        >
          {t(
            'This model is currently unavailable on this site. It cannot be submitted until a route is available.'
          )}
        </p>
      )}
      <Tabs defaultValue={props.pricesOnly ? 'prices' : 'api'}>
        <TabsList>
          <TabsTrigger value='prices'>{t('Price details')}</TabsTrigger>
          <TabsTrigger value='api'>{t('API connection')}</TabsTrigger>
        </TabsList>
        <TabsContent value='prices' className='pt-4'>
          <ModelPrices
            key={`${props.model.id}:${userId}`}
            model={props.model.id}
          />
        </TabsContent>
        <TabsContent value='api' className='pt-4'>
          <ModelApi model={props.model} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
export function PlatformModelsPage(props: {
  mode?: 'catalog' | 'prices'
  initialModel?: string
}) {
  const { t } = useTranslation()
  const query = usePlatformModels()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<ModelType | 'all'>('all')
  const [selectedId, setSelectedId] = useState(props.initialModel || '')
  const [limit, setLimit] = useState(24)
  const deferredSearch = useDeferredValue(search)
  const models = query.data || EMPTY_MODELS
  const filtered = useMemo(
    () => filterPlatformModels(models, category, deferredSearch),
    [models, category, deferredSearch]
  )
  const selected = models.find((model) => model.id === selectedId)
  const prices = props.mode === 'prices'
  return (
    <PublicLayout>
      <div className='mx-auto max-w-7xl space-y-8 pt-6 pb-12 md:pt-10'>
        <header className='flex flex-wrap items-end justify-between gap-5'>
          <div className='max-w-2xl space-y-3'>
            <div className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-widest uppercase'>
              <Coins className='size-4' />
              {t('Platform model catalog')}
            </div>
            <h1 className='text-3xl font-semibold tracking-tight md:text-4xl'>
              {t(prices ? 'Model Prices' : 'Model Square')}
            </h1>
            <p className='text-muted-foreground text-sm leading-6'>
              {t(
                prices
                  ? 'Compare current prices by model, route and specification. Your account and this site determine the applicable price.'
                  : 'Every language, image, video and audio model published on this site, with its actual API protocol and parameters.'
              )}
            </p>
          </div>
          <Badge variant='secondary' className='px-3 py-2'>
            {t('{{count}} models', { count: models.length })}
          </Badge>
        </header>
        {prices && selected ? (
          <section className='space-y-6'>
            <Button variant='ghost' onClick={() => setSelectedId('')}>
              <ArrowLeft className='size-4' />
              {t('Back to models')}
            </Button>
            <ModelDetailsBody key={selected.id} model={selected} pricesOnly />
          </section>
        ) : (
          <>
            <div className='bg-card flex flex-col gap-4 rounded-2xl border p-4 md:p-5'>
              <div className='relative'>
                <Search className='text-muted-foreground absolute top-3 left-3 size-4' />
                <Input
                  className='h-10 pl-10'
                  placeholder={t('Search model name or model ID')}
                  aria-label={t('Search models')}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setLimit(24)
                  }}
                />
              </div>
              <div
                role='group'
                aria-label={t('Model category')}
                className='flex flex-wrap gap-2'
              >
                {(['all', 'chat', 'image', 'video', 'audio'] as const).map(
                  (type) => (
                    <Button
                      key={type}
                      variant={category === type ? 'default' : 'outline'}
                      size='sm'
                      className='rounded-full'
                      aria-pressed={category === type}
                      onClick={() => {
                        setCategory(type)
                        setLimit(24)
                      }}
                    >
                      {t(TYPE_LABELS[type])}
                      <span className='opacity-60'>
                        {type === 'all'
                          ? models.length
                          : models.filter((model) => model.type === type)
                              .length}
                      </span>
                    </Button>
                  )
                )}
              </div>
            </div>
            {query.isLoading && (
              <LoadingState message={t('Loading all site models...')} />
            )}
            {query.isError && (
              <ErrorState
                title={t('Unable to load the site model catalog')}
                onRetry={() => void query.refetch()}
              />
            )}
            {!query.isLoading && !query.isError && (
              <>
                <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
                  {filtered.slice(0, limit).map((model) => {
                    const Icon = ICONS[model.type]
                    return (
                      <Card
                        key={model.id}
                        className='gap-4 transition-shadow hover:shadow-md'
                      >
                        <CardHeader>
                          <div className='flex items-start justify-between gap-3'>
                            <div className='bg-muted grid size-11 place-items-center rounded-xl'>
                              {model.icon ? (
                                getLobeIcon(model.icon, 24)
                              ) : (
                                <Icon className='size-5' />
                              )}
                            </div>
                            <Badge variant='outline'>
                              {t(TYPE_LABELS[model.type])}
                            </Badge>
                          </div>
                          <h2 className='mt-3 text-lg font-semibold break-words'>
                            {model.name}
                          </h2>
                          <div className='flex min-w-0 items-center'>
                            <code className='text-muted-foreground min-w-0 flex-1 text-xs break-all'>
                              {model.id}
                            </code>
                            <CopyButton value={model.id} size='sm' />
                          </div>
                        </CardHeader>
                        <CardContent className='flex-1'>
                          <p className='text-muted-foreground line-clamp-2 min-h-10 text-xs leading-5'>
                            {model.description}
                          </p>
                        </CardContent>
                        <CardFooter className='flex items-center justify-between border-t pt-3'>
                          <span className='text-muted-foreground text-xs'>
                            {t(
                              model.available
                                ? 'API enabled'
                                : 'Temporarily unavailable'
                            )}
                          </span>
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => setSelectedId(model.id)}
                            aria-label={`${t(prices ? 'View prices' : 'API details')} ${model.name}`}
                          >
                            {t(prices ? 'View prices' : 'API details')}
                            <ChevronRight className='size-4' />
                          </Button>
                        </CardFooter>
                      </Card>
                    )
                  })}
                </div>
                {!filtered.length && (
                  <p className='text-muted-foreground py-12 text-center'>
                    {t('No matching models')}
                  </p>
                )}
                {filtered.length > limit && (
                  <div className='text-center'>
                    <Button
                      variant='outline'
                      onClick={() => setLimit((previous) => previous + 24)}
                    >
                      {t('Show more models')} ({filtered.length - limit})
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {!prices && (
          <Dialog
            open={Boolean(selected)}
            onOpenChange={(open) => {
              if (!open) setSelectedId('')
            }}
            title={t('Model details')}
            description={t(
              'Published model parameters, connection examples and current prices'
            )}
            contentClassName='sm:max-w-5xl'
            bodyClassName='pb-2'
          >
            {selected && (
              <ModelDetailsBody key={selected.id} model={selected} />
            )}
          </Dialog>
        )}
        <Footer />
      </div>
    </PublicLayout>
  )
}
