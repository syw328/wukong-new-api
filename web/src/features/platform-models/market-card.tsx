// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import {
  Activity,
  ArrowUpRight,
  Image,
  MessageSquare,
  Music,
  Network,
  Video,
  Zap,
} from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import { BILLING_LABELS } from './constants'
import { formatMarketAmount } from './helpers'
import { TYPE_LABELS, type ModelSummary, type PlatformModel } from './types'

const ICONS = { chat: MessageSquare, image: Image, video: Video, audio: Music }
export function MarketModelIcon(props: { model: PlatformModel }) {
  const Icon = ICONS[props.model.type]
  return (
    <span
      className='market-model-icon'
      data-kind={props.model.type}
      aria-hidden
    >
      {props.model.icon ? (
        getLobeIcon(props.model.icon, 26)
      ) : (
        <Icon className='size-6' />
      )}
    </span>
  )
}
export function MarketPrice(props: {
  summary?: ModelSummary
  loading?: boolean
}) {
  const { t } = useTranslation()
  if (props.loading) {
    return (
      <div
        className='market-price-skeleton motion-safe:animate-pulse'
        aria-label={t('Loading current prices...')}
      />
    )
  }
  const price = props.summary?.startingPrice
  if (!price) {
    return (
      <div className='market-price-box'>
        <span className='text-muted-foreground text-sm'>
          {t('Price temporarily unavailable')}
        </span>
      </div>
    )
  }
  const units = {
    call: 'request',
    tokens: '1M tokens',
    second: 'second',
    characters: '1M characters',
  }
  return (
    <div className='market-price-box'>
      <div className='text-muted-foreground mb-2 flex items-center justify-between gap-2 text-xs'>
        <span>{t(BILLING_LABELS[price.unit])}</span>
        {(props.summary?.billingUnits.length || 0) > 1 && (
          <span
            title={props.summary?.billingUnits
              .map((unit) => t(BILLING_LABELS[unit]))
              .join(' / ')}
          >
            {t('Multiple billing methods')}
          </span>
        )}
      </div>
      <div className='market-price-line'>
        <span className='market-from'>
          {t(
            props.summary?.minimumComplete === false
              ? 'Reference price'
              : 'Starting from'
          )}
        </span>
        <Zap className='size-4 shrink-0' aria-hidden />
        <strong>{formatMarketAmount(price.amount)}</strong>
        <span className='market-price-unit'>
          {t('credits')} / {t(units[price.unit])}
        </span>
      </div>
      {price.unit === 'tokens' && (
        <div className='text-muted-foreground mt-1.5 text-xs'>
          {t(price.input != null ? 'Input' : 'Output')}
          {price.input != null && price.output != null && (
            <span>
              {' '}
              · {t('Output')}{' '}
              <b className='text-foreground font-medium tabular-nums'>
                {formatMarketAmount(price.output)}
              </b>{' '}
              / {t('1M tokens')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
export function MarketMetrics(props: { summary?: ModelSummary }) {
  const { t } = useTranslation()
  const data = props.summary
  const rate = data?.statisticsAvailable ? data.successRate : null
  return (
    <div className='market-metrics'>
      <span
        className={cn(
          'market-reliability',
          rate != null && rate >= 90 && 'is-good',
          rate != null && rate < 90 && 'is-warning'
        )}
        title={t(
          'Independent tasks in the last hour; repeated retries are not counted as separate tasks.'
        )}
      >
        <Activity className='size-3.5 shrink-0' aria-hidden />
        <span>
          {rate == null ? (
            t('No recent samples')
          ) : (
            <>
              <b>{rate.toFixed(1)}%</b>{' '}
              <span className='market-metric-caption'>
                {t('Success rate (1h)')}
              </span>
            </>
          )}
        </span>
      </span>
      <span
        title={
          data ? t('{{count}} samples', { count: data.samples }) : undefined
        }
      >
        <Network className='size-3.5 shrink-0' aria-hidden />
        {data
          ? t('{{count}} routes', { count: data.routeCount })
          : t('Routes pending')}
      </span>
    </div>
  )
}
export const MarketCard = memo(function MarketCard(props: {
  model: PlatformModel
  summary?: ModelSummary
  loading?: boolean
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const model = props.model
  return (
    <Card className='market-card' data-model-id={model.id}>
      <Button
        variant='ghost'
        className='market-open'
        onClick={props.onOpen}
        aria-label={t('View model {{name}}', { name: model.name })}
      >
        <span className='sr-only'>{model.name}</span>
      </Button>
      <div className='market-card-identity'>
        <MarketModelIcon model={model} />
        <div className='min-w-0 flex-1'>
          <h2 className='market-card-title'>{model.name}</h2>
          <div className='market-model-id'>
            <code title={model.id}>{model.id}</code>
            <span>· {t(model.vendor || 'Other')}</span>
          </div>
        </div>
        <Badge variant='outline' className='market-type-badge'>
          {t(TYPE_LABELS[model.type])}
        </Badge>
      </div>
      <div className='market-card-price'>
        <MarketPrice summary={props.summary} loading={props.loading} />
      </div>
      <div className='market-card-capability'>
        <p className='text-muted-foreground line-clamp-2 text-xs leading-5'>
          {model.description}
        </p>
        <div className='market-tags'>
          {model.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant='secondary'>
              {t(tag)}
            </Badge>
          ))}
        </div>
      </div>
      <div className='market-card-metrics'>
        <MarketMetrics summary={props.summary} />
      </div>
      <div className='market-card-footer'>
        <span className='text-muted-foreground text-xs'>
          {t(model.type === 'chat' ? 'OpenAI compatible' : 'Media API')}
          {!model.available && ` · ${t('Temporarily unavailable')}`}
        </span>
        <span className='market-card-copy'>
          <CopyButton
            value={model.id}
            size='sm'
            aria-label={t('Copy model ID')}
          />
        </span>
        <span className='market-card-action' aria-hidden>
          {t('View routes')}
          <ArrowUpRight className='size-4' />
        </span>
      </div>
    </Card>
  )
})
