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
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import {
  MarketShareSection,
  ModelsSection,
  PulseSection,
  RankingsHero,
} from './components'
import { useRankings } from './hooks/use-rankings'
import type { RankingPeriod, RankingMetric, RankingModality } from './types'

const VALID_PERIODS = new Set<RankingPeriod>([
  'today',
  'yesterday',
  'week',
  'month',
  'year',
])

export function Rankings() {
  const { t } = useTranslation()
  const search = useSearch({ from: '/rankings/' })
  const navigate = useNavigate()

  const period: RankingPeriod = VALID_PERIODS.has(
    search.period as RankingPeriod
  )
    ? (search.period as RankingPeriod)
    : 'week'

  const metric: RankingMetric = search.metric ?? 'calls'
  const category: RankingModality = search.category ?? 'all'
  const rankingsQuery = useRankings(period, metric, category)
  const snapshot = rankingsQuery.data?.data

  const handlePeriodChange = (next: RankingPeriod) => {
    navigate({
      to: '/rankings',
      search: (prev) => ({ ...prev, period: next }),
    })
  }

  let content
  if (rankingsQuery.isLoading) {
    content = <RankingsLoading />
  } else if (rankingsQuery.isError || !snapshot) {
    content = (
      <ErrorState
        title={t('Unable to load rankings')}
        onRetry={() => void rankingsQuery.refetch()}
        description={
          rankingsQuery.error instanceof Error
            ? rankingsQuery.error.message
            : t('Unable to load rankings data')
        }
      />
    )
  } else {
    content = (
      <>
        <ModelsSection
          history={snapshot.models_history}
          rows={snapshot.models}
          period={period}
          metric={snapshot.metric ?? 'tokens'}
        />

        <MarketShareSection
          history={snapshot.vendor_share_history}
          rows={snapshot.vendors}
          period={period}
          metric={snapshot.metric ?? 'tokens'}
        />

        <PulseSection
          movers={snapshot.top_movers}
          droppers={snapshot.top_droppers}
        />
      </>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 top-0 h-[600px] opacity-20 dark:opacity-[0.10]'
          style={{
            background: [
              'radial-gradient(ellipse 60% 50% at 20% 20%, oklch(0.72 0.18 250 / 80%) 0%, transparent 70%)',
              'radial-gradient(ellipse 50% 40% at 80% 15%, oklch(0.65 0.15 200 / 60%) 0%, transparent 70%)',
              'radial-gradient(ellipse 40% 35% at 50% 70%, oklch(0.70 0.12 280 / 40%) 0%, transparent 70%)',
            ].join(', '),
            maskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
          }}
        />
        <PageTransition className='relative mx-auto w-full max-w-[1280px] space-y-8 px-3 pt-16 pb-10 sm:px-6 sm:pt-20 sm:pb-12 xl:px-8'>
          <RankingsHero period={period} onPeriodChange={handlePeriodChange} />
          <div className='flex flex-wrap gap-4'>
            <Tabs
              value={metric}
              onValueChange={(value) => {
                void navigate({
                  to: '/rankings',
                  search: (prev) => ({
                    ...prev,
                    metric: value as RankingMetric,
                  }),
                })
              }}
            >
              <TabsList aria-label={t('Ranking metric')}>
                <TabsTrigger value='calls'>{t('Calls')}</TabsTrigger>
                <TabsTrigger value='tokens'>{t('Token usage')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs
              value={category}
              onValueChange={(value) => {
                void navigate({
                  to: '/rankings',
                  search: (prev) => ({
                    ...prev,
                    category: value as RankingModality,
                  }),
                })
              }}
            >
              <TabsList
                aria-label={t('Model type')}
                className='h-auto flex-wrap'
              >
                {(['all', 'chat', 'image', 'video', 'audio'] as const).map(
                  (value) => (
                    <TabsTrigger key={value} value={value}>
                      {t(
                        {
                          all: 'All',
                          chat: 'Chat',
                          image: 'Image',
                          video: 'Video',
                          audio: 'Audio',
                        }[value]
                      )}
                    </TabsTrigger>
                  )
                )}
              </TabsList>
            </Tabs>
          </div>
          {snapshot?.source === 'platform' && (
            <p className='text-muted-foreground text-xs'>
              {t(
                'Platform website and API generation records. Retries count separately; public variants sharing one model are counted once. New API logs are not added again. This is a usage ranking, not a quality benchmark.'
              )}
            </p>
          )}
          {metric === 'tokens' && (
            <p className='text-muted-foreground text-xs'>
              {t(
                'Token rankings include recorded usage from successful requests only. Missing historical Token counts are not estimated.'
              )}
            </p>
          )}
          {snapshot?.range && (
            <p className='text-muted-foreground text-xs'>
              {t('Statistics range')}:{' '}
              {new Date(snapshot.range.start).toLocaleString(undefined, {
                timeZone: snapshot.range.timezone,
              })}{' '}
              –{' '}
              {new Date(snapshot.range.end).toLocaleString(undefined, {
                timeZone: snapshot.range.timezone,
              })}{' '}
              · {snapshot.range.timezone}
            </p>
          )}

          {content}
        </PageTransition>
      </div>
    </PublicLayout>
  )
}

function RankingsLoading() {
  return (
    <div className='space-y-6'>
      <Skeleton className='h-[420px] w-full rounded-xl' />
      <Skeleton className='h-[360px] w-full rounded-xl' />
      <Skeleton className='h-[180px] w-full rounded-xl' />
    </div>
  )
}
