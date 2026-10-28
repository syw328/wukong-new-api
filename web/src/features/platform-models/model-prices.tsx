// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { ChevronDown, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'

import { usePlatformPrices } from './api'
import { formatPriceBookDate, routePriceOrder } from './helpers'
import { RouteOptionCard } from './route-option-card'
import type {
  PriceField,
  PriceRoute,
  PriceSelections,
  Scalar,
  BillingUnit,
  StartingPrice,
} from './types'

const RATE_LABELS: Record<string, string> = {
  input: 'Input',
  output: 'Output',
  cachedInput: 'Cached input',
  cacheWrite: 'Cache write',
  inputImage: 'Image input',
  referenceVideo: 'Reference video',
}
const FIELD_LABELS: Record<string, string> = {
  resolution: 'Resolution',
  size: 'Image size',
  quality: 'Quality',
  duration: 'Duration',
  seconds: 'Duration',
  aspect_ratio: 'Aspect ratio',
  audio: 'Audio',
  generate_audio: 'Audio',
  text_characters: 'Text characters',
}
function amount(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) || value < 0
    ? '—'
    : String(value)
}
function PriceControl(props: {
  field: PriceField
  id: string
  onChange: (value: Scalar) => void
}) {
  const { t } = useTranslation()
  const label = t(
    FIELD_LABELS[props.field.name] || props.field.label || props.field.name
  )
  const options = props.field.options || []
  if (options.length || ['boolean', 'switch'].includes(props.field.type)) {
    const entries = options.length
      ? options
      : [
          { value: false, label: t('Off') },
          { value: true, label: t('On') },
        ]
    return (
      <div className='space-y-2'>
        <Label htmlFor={props.id}>{label}</Label>
        <Select
          value={String(props.field.value ?? '')}
          onValueChange={(raw) => {
            const option = entries.find((entry) => String(entry.value) === raw)
            if (option) props.onChange(option.value)
          }}
        >
          <SelectTrigger id={props.id} className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {entries.map((entry) => (
              <SelectItem key={String(entry.value)} value={String(entry.value)}>
                {t(entry.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }
  return (
    <div className='space-y-2'>
      <Label htmlFor={props.id}>{label}</Label>
      <Input
        key={String(props.field.value)}
        id={props.id}
        type='number'
        defaultValue={Number(props.field.value ?? props.field.min ?? 1)}
        min={props.field.min}
        max={props.field.max}
        step={props.field.step || 1}
        onBlur={(event) => {
          const value = Number(event.currentTarget.value)
          if (
            event.currentTarget.value &&
            Number.isFinite(value) &&
            value >= (props.field.min ?? 0) &&
            value <= (props.field.max ?? Infinity) &&
            value !== props.field.value
          ) {
            props.onChange(value)
          }
        }}
      />
    </div>
  )
}
function RouteCard(props: {
  route: PriceRoute
  type: string
  statisticsAvailable: boolean
  referenceOnly?: boolean
  onChange: (variant: number, values: Record<string, Scalar>) => void
}) {
  const { t } = useTranslation()
  const route = props.route
  function unit(nativeUnit: string): string {
    if (nativeUnit === 'call') {
      return props.type === 'image' ? t('image') : t('request')
    }
    if (nativeUnit === 'second') return t('second')
    if (nativeUnit === 'characters') return t('1M characters')
    if (nativeUnit === 'tokens') return t('1M tokens')
    return t(nativeUnit)
  }
  const summary = routePriceOrder(route)
  const startingPrice: StartingPrice | null = Number.isFinite(summary.amount)
    ? {
        amount: summary.amount,
        unit: summary.unit as BillingUnit,
        routeId: route.id,
        variantIndex: route.variantIndex,
        values: {},
        input: route.rows[0]?.tokenRates.find((rate) => rate.label === 'input')
          ?.amount,
        output: route.rows[0]?.tokenRates.find(
          (rate) => rate.label === 'output'
        )?.amount,
      }
    : null
  return (
    <section className='market-route-card min-w-0 overflow-hidden rounded-2xl border'>
      <RouteOptionCard
        chat={props.type === 'chat'}
        route={{
          ...route,
          available: route.available ?? !!route.rows.length,
          reason: route.reason || '',
          successRate: props.statisticsAvailable ? route.successRate : null,
          speed: route.speed || null,
          startingPrice,
        }}
      />
      <Collapsible>
        <div className='flex items-center justify-between gap-3 px-4 py-2'>
          <CollapsibleTrigger className='flex flex-1 items-center gap-2 text-left text-sm'>
            {t('Specifications and full prices')}
            <ChevronDown className='size-4' />
          </CollapsibleTrigger>
          <CopyButton
            size='sm'
            aria-label={t('Copy route prices')}
            value={[
              route.provider,
              route.sku,
              ...(props.referenceOnly
                ? [
                    t(
                      'Reference prices for a 1-second video; request a live quote for your actual video.'
                    ),
                  ]
                : []),
              ...route.rows.flatMap((row) =>
                row.tokenRates.length &&
                (props.type === 'chat' || row.estimate?.nativeUnit === 'tokens')
                  ? row.tokenRates.map(
                      (rate) =>
                        `${t(row.name)} · ${t(RATE_LABELS[rate.label] || rate.label)}: ${amount(rate.amount)} ${t('credits')} / ${t('1M tokens')}`
                    )
                  : [
                      `${t(row.name)}: ${amount(row.estimate?.nativeUnit === 'call' ? row.estimate.amount : row.estimate?.unitPrice)} ${t('credits')} / ${unit(row.estimate?.nativeUnit || '')}`,
                    ]
              ),
            ].join('\n')}
          />
        </div>
        <CollapsibleContent>
          {props.type !== 'chat' && route.parameters && (
            <div className='flex min-w-0 items-center gap-2 border-b px-5 py-3'>
              <code className='min-w-0 flex-1 text-xs break-all'>
                route_id: {route.id}
              </code>
              <CopyButton
                value={route.id}
                size='sm'
                aria-label={t('Copy route ID')}
              />
            </div>
          )}
          {route.variants.length > 1 && (
            <div
              className='flex flex-wrap gap-2 border-b p-4'
              role='group'
              aria-label={t('Published specifications')}
            >
              {route.variants.map((variant) => (
                <Button
                  key={variant.index}
                  variant={
                    variant.index === route.variantIndex
                      ? 'secondary'
                      : 'outline'
                  }
                  size='sm'
                  className='h-auto flex-col items-start gap-1 py-2 text-left text-xs whitespace-normal'
                  aria-pressed={variant.index === route.variantIndex}
                  onClick={() =>
                    props.onChange(variant.index, variant.price?.values || {})
                  }
                >
                  <span>{t(variant.label)}</span>
                  {variant.price && (
                    <span className='font-mono text-[var(--market-amber)]'>
                      {amount(variant.price.amount)} {t('credits')} /{' '}
                      {unit(variant.price.unit)}
                    </span>
                  )}
                </Button>
              ))}
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='pl-5'>{t('Specification')}</TableHead>
                <TableHead className='text-right'>
                  {t(props.referenceOnly ? 'Reference price' : 'Sale price')}
                </TableHead>
                <TableHead>{t('Billing unit')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {route.rows.flatMap((row) => {
                const tokenRows =
                  row.tokenRates.length &&
                  (props.type === 'chat' ||
                    row.estimate?.nativeUnit === 'tokens')
                if (tokenRows) {
                  return [
                    ...row.tokenRates.map((rate) => (
                      <TableRow key={`${row.key}:${rate.label}`}>
                        <TableCell className='max-w-64 pl-5 text-xs whitespace-normal'>
                          {t(row.name)} ·{' '}
                          {t(RATE_LABELS[rate.label] || rate.label)}
                          {row.contextThreshold
                            ? ` (≤ ${row.contextThreshold.toLocaleString()})`
                            : ''}
                        </TableCell>
                        <TableCell className='text-right font-semibold text-amber-500 tabular-nums dark:text-amber-300'>
                          {amount(rate.amount)}
                        </TableCell>
                        <TableCell className='text-muted-foreground text-xs'>
                          {t('credits')} / {t('1M tokens')}
                        </TableCell>
                      </TableRow>
                    )),
                    ...row.longContextRates.map((rate) => (
                      <TableRow key={`${row.key}:long:${rate.label}`}>
                        <TableCell className='pl-5 text-xs whitespace-normal'>
                          {t(row.name)} ·{' '}
                          {t(RATE_LABELS[rate.label] || rate.label)} (&gt;{' '}
                          {row.contextThreshold?.toLocaleString()})
                        </TableCell>
                        <TableCell className='text-right font-semibold text-amber-500 tabular-nums dark:text-amber-300'>
                          {amount(rate.amount)}
                        </TableCell>
                        <TableCell className='text-muted-foreground text-xs'>
                          {t('credits')} / {t('1M tokens')}
                        </TableCell>
                      </TableRow>
                    )),
                  ]
                }
                let price = row.estimate?.unitPrice
                if (row.estimate?.nativeUnit === 'call') {
                  price = row.estimate.amount
                }
                if (row.estimate?.nativeUnit === 'characters') {
                  price = row.characterUnit ?? undefined
                }
                return [
                  <TableRow key={row.key}>
                    <TableCell className='pl-5 text-xs whitespace-normal'>
                      {t(row.name)}
                    </TableCell>
                    <TableCell className='text-right text-base font-semibold text-amber-500 tabular-nums dark:text-amber-300'>
                      {amount(price)}
                    </TableCell>
                    <TableCell className='text-muted-foreground text-xs'>
                      {row.estimate
                        ? `${t('credits')} / ${unit(row.estimate.nativeUnit)}`
                        : '—'}
                    </TableCell>
                  </TableRow>,
                  !props.referenceOnly &&
                  row.estimate &&
                  row.estimate.nativeUnit !== 'call' ? (
                    <TableRow
                      key={`${row.key}:estimate`}
                      className='bg-muted/30'
                    >
                      <TableCell className='pl-5 text-xs'>
                        {t('Estimated total')}
                      </TableCell>
                      <TableCell className='text-right font-semibold'>
                        {amount(row.estimate.amount)}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-xs'>
                        {t('credits')}
                      </TableCell>
                    </TableRow>
                  ) : null,
                ]
              })}
              {!route.rows.length && (
                <TableRow>
                  <TableCell colSpan={3}>
                    {t(
                      props.referenceOnly
                        ? 'Quoted per video before each task'
                        : 'Price temporarily unavailable'
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {(route.variants.length > 1 || route.fields.length > 0) && (
            <Collapsible className='border-t'>
              <CollapsibleTrigger className='text-muted-foreground flex w-full items-center justify-between px-5 py-3 text-xs'>
                {t('Adjust specification')}
                <ChevronDown className='size-4' />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className='grid gap-4 px-5 pb-5 sm:grid-cols-2'>
                  {route.variants.length > 1 && (
                    <div className='space-y-2 sm:col-span-2'>
                      <Label>{t('Specification')}</Label>
                      <Select
                        value={String(route.variantIndex)}
                        onValueChange={(value) =>
                          props.onChange(Number(value), {})
                        }
                      >
                        <SelectTrigger className='w-full'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {route.variants.map((variant) => (
                            <SelectItem
                              key={variant.index}
                              value={String(variant.index)}
                            >
                              {t(variant.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {route.fields.map((field) => (
                    <PriceControl
                      key={field.name}
                      field={field}
                      id={`${route.id}-${field.name}`}
                      onChange={(value) =>
                        props.onChange(route.variantIndex, {
                          ...Object.fromEntries(
                            route.fields.map((item) => [item.name, item.value])
                          ),
                          [field.name]: value,
                        })
                      }
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
export function ModelPrices(props: { model: string }) {
  const { t, i18n } = useTranslation()
  const [selections, setSelections] = useState<PriceSelections>({})
  const [sort, setSort] = useState('price')
  const query = usePlatformPrices(props.model, selections)
  if (query.isLoading) {
    return <LoadingState message={t('Loading current prices...')} />
  }
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title={t('Unable to load model prices')}
        description={t(
          'No outdated or estimated fallback prices are shown. Retry after the current price book becomes available.'
        )}
        onRetry={() => {
          setSelections({})
          void query.refetch()
        }}
      />
    )
  }
  const data = query.data
  const date = (value: string) => formatPriceBookDate(value, i18n.language)
  const orderedRoutes = [...data.routes].sort((left, right) => {
    if (sort === 'success') {
      return (right.successRate ?? -1) - (left.successRate ?? -1)
    }
    const a = routePriceOrder(left),
      b = routePriceOrder(right)
    return a.unit.localeCompare(b.unit) || a.amount - b.amount
  })

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-4'>
        <p className='text-muted-foreground max-w-2xl text-sm'>
          {t(
            data.audience === 'account'
              ? 'Your account prices. Final server-authorized settlement is authoritative.'
              : 'Current site public prices. Sign in to see the prices applicable to your account.'
          )}
        </p>
        <div className='text-right'>
          <p className='text-muted-foreground text-xs'>
            {t('Model success rate (1h)')}
          </p>
          <strong className='text-xl tabular-nums'>
            {data.statisticsAvailable && data.successRate != null
              ? `${amount(data.successRate)}%`
              : '—'}
          </strong>
          <span className='text-muted-foreground ml-2 text-xs'>
            {t('{{count}} samples', { count: data.samples })}
          </span>
        </div>
      </div>
      {!data.liveQuote && !data.statisticsAvailable && (
        <p role='status' className='text-muted-foreground text-sm'>
          {t(
            'Statistics are temporarily unavailable; prices are still available.'
          )}
        </p>
      )}
      <div className='bg-muted/20 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3'>
        <div className='flex flex-wrap items-center gap-2 text-xs'>
          <strong>
            {t('{{count}} routes', {
              count: data.routes.length + data.unavailable.length,
            })}
          </strong>
          <Badge variant='secondary'>
            {data.liveQuote
              ? t('Quoted per video before each task')
              : t('{{count}} priced routes', { count: data.routes.length })}
          </Badge>
          {data.unavailable.length > 0 && (
            <Badge variant='outline'>
              {t('{{count}} prices unavailable', {
                count: data.unavailable.length,
              })}
            </Badge>
          )}
        </div>
        <Select
          value={sort}
          onValueChange={(value) => {
            if (value) setSort(value)
          }}
        >
          <SelectTrigger
            className='h-8 max-w-full text-xs'
            aria-label={t('Sort routes')}
          >
            <SelectValue>
              {t(
                sort === 'success'
                  ? 'Success rate: high to low'
                  : 'Price: low to high (same unit)'
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='price'>
              {t('Price: low to high (same unit)')}
            </SelectItem>
            <SelectItem value='success'>
              {t('Success rate: high to low')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      {data.liveQuote && (
        <p className='text-muted-foreground text-sm'>
          {t(
            'Reference prices for a 1-second video; request a live quote for your actual video.'
          )}
        </p>
      )}
      <div className='grid grid-cols-1 items-start gap-4 lg:grid-cols-2'>
        {orderedRoutes.map((route) => (
          <RouteCard
            key={route.id}
            route={route}
            type={data.model.type}
            statisticsAvailable={data.statisticsAvailable}
            referenceOnly={data.liveQuote}
            onChange={(variantIndex, values) =>
              setSelections((previous) => ({
                ...previous,
                [route.id]: { variantIndex, values },
              }))
            }
          />
        ))}
        {data.unavailable.map((route) => (
          <section key={route.id} className='space-y-3 rounded-2xl border p-5'>
            <strong>{route.provider}</strong>
            <p className='text-muted-foreground text-xs'>{route.sku}</p>
            <p className='text-muted-foreground text-sm'>
              {t('Price temporarily unavailable')}
            </p>
          </section>
        ))}
      </div>
      {data.liveQuote && (
        <p className='text-muted-foreground rounded-xl border p-6 text-sm'>
          {t(
            'Video HD is priced per video by duration, target resolution, frame rate and mode. Request /v1/media/quotes with your video to get the exact amount before creating the task; the final charge never exceeds that quote.'
          )}
        </p>
      )}
      {!data.liveQuote && !data.routes.length && !data.unavailable.length && (
        <p className='text-muted-foreground rounded-xl border p-6'>
          {t('No published route prices are available.')}
        </p>
      )}
      <footer className='bg-background/95 flex flex-wrap items-center justify-between gap-3 border-t py-4 text-xs backdrop-blur'>
        <div className='text-muted-foreground flex flex-wrap gap-x-6 gap-y-2'>
          <span>
            {t(
              data.liveQuote ? 'Reference prices checked' : 'Daily price book'
            )}{' '}
            · {date(data.lockedAt)}
          </span>
          {!data.liveQuote && (
            <span>
              {t('Valid until')} · {date(data.validUntil)} · UTC+8
            </span>
          )}
        </div>
        <Button
          size='sm'
          variant='outline'
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className='size-3.5' />
          {t('Refresh')}
        </Button>
      </footer>
    </div>
  )
}
