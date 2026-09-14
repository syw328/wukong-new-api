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

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  formatUptimePct,
  getSuccessRateDotClass,
  getSuccessRateTextClass,
} from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

import type { UptimeDayPoint } from '../lib/mock-stats'

// ---------------------------------------------------------------------------
// Uptime sparkline
// ---------------------------------------------------------------------------
//
// Compact hourly request-success visualisation: a row of small coloured bars where:
//   - Bar colour reflects per-hour success (green / amber / red)
//   - Bar height reflects severity (the lower the rate, the shorter the bar)
//   - Hovering a bar reveals the exact date and uptime
//
// Useful as a header strip ("at-a-glance" status) and as a per-row visual
// inside the per-group performance table.

type SparklineSize = 'sm' | 'md'

type UptimeSparklineProps = {
  series: UptimeDayPoint[]
  successRate: number | null
  size?: SparklineSize
  showOverall?: boolean
  emptyLabel?: string
  className?: string
}

function heightFor(uptime: number): string {
  if (uptime >= 99.9) return 'h-full'
  if (uptime >= 99.0) return 'h-[88%]'
  if (uptime >= 95.0) return 'h-[72%]'
  if (uptime >= 90.0) return 'h-[55%]'
  return 'h-[40%]'
}

export function UptimeSparkline(props: UptimeSparklineProps) {
  const { t } = useTranslation()
  const size = props.size ?? 'md'
  const showOverall = props.showOverall ?? true

  if (props.series.length === 0) {
    return (
      <span className={cn('text-muted-foreground text-xs', props.className)}>
        {props.emptyLabel ?? '—'}
      </span>
    )
  }

  const overall = props.successRate

  const containerHeight = size === 'sm' ? 'h-3.5' : 'h-5'
  const barWidth = size === 'sm' ? 'w-[3px]' : 'w-1'
  const gap = size === 'sm' ? 'gap-px' : 'gap-[2px]'

  return (
    <div className={cn('flex items-center gap-2', props.className)}>
      <div
        className={cn('flex items-end', containerHeight, gap)}
        role='img'
        aria-label={`${t('Request success rate sampled over the last 24 hours')} · ${formatUptimePct(overall)}`}
      >
        {props.series.map((day) => (
          <Tooltip key={day.date}>
            <TooltipTrigger
              render={
                <div
                  className={cn(
                    'rounded-sm transition-opacity hover:opacity-80',
                    barWidth,
                    containerHeight,
                    'flex items-end'
                  )}
                />
              }
            >
              <div
                className={cn(
                  'w-full rounded-sm',
                  getSuccessRateDotClass(day.uptime_pct),
                  heightFor(day.uptime_pct)
                )}
                aria-hidden
              />
            </TooltipTrigger>
            <TooltipContent side='top' className='font-mono text-xs'>
              <div className='font-medium'>{day.date}</div>
              <div>{day.uptime_pct.toFixed(2)}%</div>
              {day.outage_minutes > 0 && (
                <div className='text-muted-foreground'>
                  {day.outage_minutes} min outage
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      {showOverall && (
        <span
          className={cn(
            'font-mono text-sm font-semibold tabular-nums',
            getSuccessRateTextClass(overall)
          )}
        >
          {overall == null ? '—' : `${overall.toFixed(1)}%`}
        </span>
      )}
    </div>
  )
}
