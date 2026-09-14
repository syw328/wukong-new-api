/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { formatLatency } from '@/features/performance-metrics/lib/format'

import {
  usePlatformInsights,
  type PlatformModelInsights,
} from '../hooks/use-platform-insights'

const STATES: Record<string, string> = {
  open: 'Temporarily paused',
  degraded: 'Degraded',
  price_stale: 'Price needs refresh',
  healthy: 'Healthy',
  watch: 'Under observation',
  probation: 'Insufficient samples',
  paused: 'Temporarily paused',
  probing: 'Recovering',
  unobserved: 'No recent samples',
}

export function PlatformRoutes(props: { data: PlatformModelInsights }) {
  const { t } = useTranslation()
  return (
    <section className='space-y-3'>
      <h2 className='text-base font-semibold'>
        {t('Available upstream routes')}
      </h2>
      <p className='text-muted-foreground text-sm'>
        {t('{{count}} upstream routes', { count: props.data.routes.length })}
        {' · '}
        {t('{{count}} price groups', {
          count: props.data.routes.reduce(
            (sum, route) => sum + route.prices.length,
            0
          ),
        })}
      </p>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Routes are selected automatically. Success rate covers the last hour; median latency covers successful requests in the last 7 days. Each price group uses only its own recorded requests; missing samples remain unknown.'
        )}
      </p>
      {props.data.routes.length === 0 && (
        <p>{t('No published route prices are available.')}</p>
      )}
      {props.data.routes.map((route, index) => (
        <div key={route.id} className='space-y-3 rounded-lg border p-4'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h3 className='font-medium'>
              {t('Route {{number}}', { number: index + 1 })}
            </h3>
            <Badge variant='outline'>
              {t(STATES[route.state] ?? 'Under observation')}
            </Badge>
          </div>
          <dl className='grid grid-cols-2 gap-3 text-sm sm:grid-cols-4'>
            <div>
              <dt className='text-muted-foreground'>
                {t('Success rate (1h)')}
              </dt>
              <dd>
                {route.success_rate == null
                  ? t('No recent samples')
                  : `${route.success_rate.toFixed(1)}%`}
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>{t('Samples (1h)')}</dt>
              <dd>{route.samples.toLocaleString()}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>
                {t('Median latency (7d)')}
              </dt>
              <dd>{formatLatency(route.p50_duration_ms ?? 0)}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>
                {t('Latency samples (7d)')}
              </dt>
              <dd>{route.speed_samples.toLocaleString()}</dd>
            </div>
          </dl>
          {route.samples > 0 && route.samples < 20 && (
            <p className='text-muted-foreground text-xs'>
              {t(
                'Small sample size; this rate does not establish long-term reliability.'
              )}
            </p>
          )}
          <StaticDataTable
            data={route.prices}
            getRowKey={(price, i) => `${price.name}:${i}`}
            columns={[
              {
                id: 'name',
                header: t('Price group'),
                cell: (price) => price.name,
              },
              {
                id: 'samples',
                header: t('Samples (1h)'),
                cell: (price) => price.samples.toLocaleString(),
              },
              {
                id: 'success',
                header: t('Success rate (1h)'),
                cell: (price) =>
                  price.success_rate == null
                    ? t('No recent samples')
                    : `${price.success_rate.toFixed(1)}%`,
              },
              {
                id: 'latency',
                header: t('Median latency (7d)'),
                cell: (price) => formatLatency(price.p50_duration_ms ?? 0),
              },
              {
                id: 'input',
                header: t('Input / 1M tokens'),
                cell: (price) =>
                  price.input_per_million == null
                    ? '—'
                    : `${price.input_per_million} ${price.unit}`,
              },
              {
                id: 'output',
                header: t('Output / 1M tokens'),
                cell: (price) =>
                  price.output_per_million == null
                    ? '—'
                    : `${price.output_per_million} ${price.unit}`,
              },
            ]}
          />
        </div>
      ))}
      <p className='text-muted-foreground text-xs'>
        {t(
          'Public reference prices. Your account quote and final settlement are authoritative.'
        )}
      </p>
    </section>
  )
}

export function PlatformApiContract(props: {
  data: PlatformModelInsights | null
}) {
  const { t } = useTranslation()
  if (!props.data) {
    return (
      <p className='text-muted-foreground text-sm'>
        {t(
          'Model-specific parameters and rate limits have not been published. Contact the administrator for the actual limits.'
        )}
      </p>
    )
  }
  return (
    <div className='space-y-6'>
      <section className='space-y-2'>
        <h3 className='font-semibold'>{t('Published model parameters')}</h3>
        <StaticDataTable
          data={props.data.parameters}
          getRowKey={(p) => p.name}
          columns={[
            {
              id: 'name',
              header: t('Parameter'),
              cell: (p) => <code>{p.name}</code>,
            },
            { id: 'type', header: t('Type'), cell: (p) => p.type },
            {
              id: 'range',
              header: t('Range'),
              cell: (p) => `${p.min ?? '—'} ~ ${p.max ?? '—'}`,
            },
            {
              id: 'default',
              header: t('Default'),
              cell: (p) => String(p.default ?? '—'),
            },
            {
              id: 'description',
              header: t('Description'),
              cell: (p) => p.description || '—',
            },
          ]}
        />
        <p className='text-muted-foreground text-xs'>
          {t(
            'These are the parameters published by the platform for this model. Additional parameters are not guaranteed.'
          )}
        </p>
      </section>
      <section className='space-y-2'>
        <h3 className='font-semibold'>{t('Rate limits')}</h3>
        <p>
          {t('Platform create requests: {{count}} per minute per user.', {
            count: props.data.rate_limits.createPerMinute,
          })}
        </p>
        <p>
          {t('Platform read requests: {{count}} per minute per user.', {
            count: props.data.rate_limits.readPerMinute,
          })}
        </p>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Gateway, token and concurrency limits may be lower. No fixed TPM or daily request allowance is published. Retry with backoff after HTTP 429.'
          )}
        </p>
      </section>
    </div>
  )
}

export function PlatformModelInsightsSection(props: {
  model: string
  view: 'routes' | 'api'
}) {
  const { t } = useTranslation()
  const query = usePlatformInsights(props.model)
  if (query.isLoading) {
    return <LoadingState message={t('Loading model statistics...')} />
  }
  if (query.isError) {
    return (
      <ErrorState
        title={t('Unable to load model statistics')}
        onRetry={() => void query.refetch()}
      />
    )
  }
  if (props.view === 'api') {
    return <PlatformApiContract data={query.data ?? null} />
  }
  return query.data ? <PlatformRoutes data={query.data} /> : null
}
