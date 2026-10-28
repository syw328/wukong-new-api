// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'

import { formatMarketAmount } from './helpers'
import type { PriceRoute, StartingPrice } from './types'

export type RouteOption = PriceRoute & {
  available: boolean
  reason: string
  startingPrice: StartingPrice | null
  speed: {
    p50Ms: number
    metric: string
    samples: number
    window: string
  } | null
}
export function RouteOptionCard(props: {
  route: RouteOption
  chat?: boolean
  selected?: boolean
  onSelect?: (checked: boolean) => void
}) {
  const { t } = useTranslation()
  const route = props.route
  const price = route.startingPrice
  const units = {
    call: 'request',
    second: 'second',
    tokens: '1M tokens',
    characters: '1M characters',
  }
  const reasons: Record<string, string> = {
    disabled: 'Route disabled',
    paused: 'Temporarily paused',
    pricing: 'Price temporarily unavailable',
  }
  return (
    <section
      className='route-option-card'
      data-selected={props.selected || undefined}
      aria-label={`${route.provider} ${route.sku}`}
    >
      <div className='flex items-start gap-3'>
        {props.onSelect && (
          <Checkbox
            aria-label={t('Select route {{name}}', {
              name: `${route.provider} ${route.sku}`,
            })}
            checked={props.selected}
            disabled={!route.available && !props.selected}
            onCheckedChange={props.onSelect}
          />
        )}
        <div className='min-w-0 flex-1'>
          <strong className='block text-sm'>{route.provider}</strong>
          <span className='text-muted-foreground text-xs break-words'>
            {route.sku}
          </span>
        </div>
        <Badge variant={route.available ? 'secondary' : 'outline'}>
          {t(
            route.available
              ? 'Available'
              : reasons[route.reason] || 'Route unavailable'
          )}
        </Badge>
      </div>
      <div className='route-option-price'>
        {price ? (
          <>
            <strong>{formatMarketAmount(price.amount)}</strong>
            <span>
              {t('credits')} / {t(units[price.unit])}
            </span>
          </>
        ) : (
          <span>{t('Price temporarily unavailable')}</span>
        )}
        {price?.unit === 'tokens' && (
          <span>
            {t(price.input != null ? 'Input' : 'Output')}
            {price.input != null && price.output != null && (
              <>
                {' '}
                · {t('Output')} {formatMarketAmount(price.output)}
              </>
            )}
          </span>
        )}
      </div>
      <div className='route-option-metrics'>
        <span>
          {t('Success rate (1h)')}{' '}
          <b>
            {route.successRate == null
              ? '—'
              : `${route.successRate.toFixed(1)}%`}
          </b>{' '}
          <small>{t('{{count}} samples', { count: route.samples })}</small>
        </span>
        <span
          title={
            route.speed
              ? t('{{count}} samples', { count: route.speed.samples })
              : undefined
          }
        >
          {t(
            props.chat || route.speed?.metric === 'first_token'
              ? 'Median first token (7d)'
              : 'Median completion (7d)'
          )}{' '}
          <b>
            {route.speed
              ? `${(route.speed.p50Ms / 1000).toFixed(1)}s`
              : t('No recent samples')}
          </b>
        </span>
      </div>
    </section>
  )
}
