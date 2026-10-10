// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
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

import type { PriceRoute } from './types'

export function MediaRouteSelector(props: {
  routes: PriceRoute[]
  value: string
  onChange: (value: string) => void
  loading: boolean
  error: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <section className='min-w-0 space-y-3 rounded-xl border p-4'>
      <Label htmlFor='media-api-route'>{t('Generation route')}</Label>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Set route_id at the top level of both requests. The model ID stays the same. An explicit route never switches to another route; omit route_id for automatic selection.'
        )}
      </p>
      {props.loading && <p role='status'>{t('Loading routes…')}</p>}
      {props.error && (
        <div role='alert' className='space-y-2'>
          <p>
            {t(
              'Unable to load routes. Refresh before copying an explicit route example.'
            )}
          </p>
          <Button variant='outline' size='sm' onClick={props.onRetry}>
            {t('Refresh')}
          </Button>
        </div>
      )}
      {!props.loading && !props.error && (
        <>
          <Select
            value={props.value || 'auto'}
            onValueChange={(value, details) => {
              // A refreshed catalog can remove an option. Only user selection may change the route.
              if (value && details.reason !== 'none') {
                props.onChange(value === 'auto' ? '' : value)
              }
            }}
          >
            <SelectTrigger id='media-api-route' className='w-full'>
              <SelectValue>
                {props.value
                  ? props.routes
                      .filter((route) => route.id === props.value)
                      .map((route) => `${route.provider} · ${route.sku}`)
                      .join('') || props.value
                  : t('Automatic selection (omit route_id)')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='auto'>
                {t('Automatic selection (omit route_id)')}
              </SelectItem>
              {props.routes.map((route) => (
                <SelectItem key={route.id} value={route.id}>
                  {route.provider} · {route.sku}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {props.value &&
            !props.routes.some((route) => route.id === props.value) && (
              <p role='alert'>
                {t(
                  'This route is no longer available. Select a current route and request a new quote.'
                )}
              </p>
            )}
          <Table className='table-fixed'>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Generation route')}</TableHead>
                <TableHead>route_id</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.routes.map((route) => (
                <TableRow key={route.id}>
                  <TableCell className='text-xs whitespace-normal'>
                    {route.provider} · {route.sku}
                  </TableCell>
                  <TableCell className='whitespace-normal'>
                    <div className='flex min-w-0 items-center gap-2'>
                      <code className='min-w-0 flex-1 text-xs break-all'>
                        {route.id}
                      </code>
                      <CopyButton
                        value={route.id}
                        size='sm'
                        aria-label={t('Copy route ID')}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!props.routes.length && (
            <p>{t('No priced routes are currently available.')}</p>
          )}
          <p className='text-muted-foreground text-xs'>
            {t(
              'Selecting a route updates the examples and parameter table below. Use a fresh quote after changing any parameter or route.'
            )}
          </p>
        </>
      )}
    </section>
  )
}
