// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { Code2, Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuthStore } from '@/stores/auth-store'

import { MarketMetrics, MarketModelIcon, MarketPrice } from './market-card'
import { ModelApi } from './model-api'
import { ModelPrices } from './model-prices'
import { TYPE_LABELS, type ModelSummary, type PlatformModel } from './types'

export function ModelDetailsDialog(props: {
  model?: PlatformModel
  summary?: ModelSummary
  onClose: () => void
}) {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id ?? 'anonymous')
  const model = props.model
  return (
    <Dialog
      open={Boolean(model)}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={
        model ? (
          <span className='flex min-w-0 items-center gap-3 pr-8'>
            <MarketModelIcon model={model} />
            <span className='min-w-0 text-xl font-semibold break-words sm:text-2xl'>
              {model.name}
            </span>
          </span>
        ) : (
          t('Model details')
        )
      }
      description={
        model
          ? `${model.id} · ${t(model.vendor || 'Other')}`
          : t('Model details')
      }
      contentClassName='market-dialog sm:max-w-[1100px]'
      headerClassName='market-dialog-header'
      descriptionClassName='break-all font-mono text-xs'
      bodyClassName='market-dialog-body'
    >
      {model && (
        <div key={`${model.id}:${userId}`}>
          <div className='market-detail-intro'>
            <div className='min-w-0 space-y-3'>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant='outline'>{t(TYPE_LABELS[model.type])}</Badge>
                {model.tags.slice(0, 8).map((tag) => (
                  <Badge key={tag} variant='secondary'>
                    {t(tag)}
                  </Badge>
                ))}
                <CopyButton
                  value={model.id}
                  size='sm'
                  aria-label={t('Copy model ID')}
                >
                  {t('Copy model ID')}
                </CopyButton>
              </div>
              <p className='text-muted-foreground text-sm leading-6'>
                {model.description}
              </p>
              {!model.available && (
                <p
                  role='status'
                  className='rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm'
                >
                  {t(
                    'This model is currently unavailable on this site. It cannot be submitted until a route is available.'
                  )}
                </p>
              )}
            </div>
            <div className='market-detail-summary'>
              <MarketPrice summary={props.summary} />
              <MarketMetrics summary={props.summary} />
            </div>
          </div>
          <Tabs defaultValue='prices' className='market-detail-tabs'>
            <TabsList className='w-full'>
              <TabsTrigger value='prices' className='flex-1'>
                <Network className='size-4' aria-hidden />
                {t('Price details')}
              </TabsTrigger>
              <TabsTrigger value='api' className='flex-1'>
                <Code2 className='size-4' aria-hidden />
                {t('API connection')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value='prices' className='pt-5'>
              <ModelPrices model={model.id} />
            </TabsContent>
            <TabsContent value='api' className='pt-5'>
              <ModelApi model={model} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Dialog>
  )
}
