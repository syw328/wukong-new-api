import { useState } from 'react'
// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { portalApiOrigin } from '@/lib/portal-runtime'

import { usePlatformPrices } from './api'
import { MediaRouteSelector } from './media-route-selector'
import { pythonExample, curlExample } from './model-api-examples'
import type { PlatformModel } from './types'

function apiIntro(model: PlatformModel): string {
  if (model.type === 'chat') {
    return 'Use the OpenAI-compatible chat endpoint with the model ID below.'
  }
  if (model.category === 'tool') {
    return 'AI tools use the same asynchronous media API: pass the source image or video as a public URL (or the ID of an earlier task), request a quote, then create the task. Prices match the website toolbox.'
  }
  return 'Images, video and audio use the platform asynchronous media API. Parameters match this model on the website; request a quote before each creation.'
}
export function ModelApi(props: { model: PlatformModel }) {
  const { t } = useTranslation()
  const root = portalApiOrigin()
  const [routeId, setRouteId] = useState('')
  const prices = usePlatformPrices(
    props.model.type !== 'chat' && props.model.category !== 'tool'
      ? props.model.id
      : '',
    {}
  )
  const routes = prices.data?.routes || []
  const route = routes.find((item) => item.id === routeId)
  const parameters = route?.parameters || props.model.parameters
  const code = pythonExample(props.model, root, route)
  const curl = curlExample(props.model, root, route)
  return (
    <div className='space-y-6'>
      <div className='space-y-2 rounded-xl border p-4'>
        <h3 className='font-semibold'>{t('API connection')}</h3>
        <p className='text-muted-foreground text-sm'>
          {t(apiIntro(props.model))}
        </p>
        <div className='flex min-w-0 items-center gap-2'>
          <code className='min-w-0 flex-1 text-xs break-all'>{`${root}${props.model.endpoint}`}</code>
          <CopyButton value={`${root}${props.model.endpoint}`} size='sm' />
        </div>
        <p className='text-muted-foreground text-xs'>
          {t(
            'The portal API key belongs to this site. Never send the key to an upstream provider.'
          )}
        </p>
      </div>
      {props.model.type !== 'chat' && props.model.category !== 'tool' && (
        <MediaRouteSelector
          routes={routes}
          value={routeId}
          onChange={setRouteId}
          loading={prices.isLoading}
          error={prices.isError}
          onRetry={() => {
            void prices.refetch()
          }}
        />
      )}
      {(!routeId || route) && (
        <Tabs defaultValue='python' className='min-w-0'>
          <TabsList>
            <TabsTrigger value='python'>Python</TabsTrigger>
            <TabsTrigger value='curl'>cURL</TabsTrigger>
          </TabsList>
          {[
            ['python', code],
            ['curl', curl],
          ].map(([language, example]) => (
            <TabsContent
              key={language}
              value={language}
              className='min-w-0 overflow-hidden rounded-xl border'
            >
              <div className='bg-muted/30 flex items-center justify-between border-b px-4 py-2'>
                <h3 className='text-sm font-medium'>
                  {language === 'python'
                    ? t('Python example')
                    : t('cURL example')}
                </h3>
                <CopyButton
                  value={example}
                  size='sm'
                  aria-label={t('Copy request example')}
                />
              </div>
              <pre className='max-h-[440px] overflow-auto p-4 text-xs leading-relaxed'>
                <code>{example}</code>
              </pre>
            </TabsContent>
          ))}
        </Tabs>
      )}
      {props.model.type !== 'chat' && (
        <p className='text-muted-foreground text-sm'>
          {t(
            'A timeout does not mean failure. Keep the request body and Idempotency-Key unchanged when recovering a submission; once a task ID is available, only poll that task. One request creates one output task.'
          )}
        </p>
      )}
      <section className='space-y-3'>
        <h3 className='font-semibold'>{t('Published model parameters')}</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Parameter')}</TableHead>
              <TableHead>{t('Type')}</TableHead>
              <TableHead>{t('Default / options')}</TableHead>
              <TableHead>{t('Description')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parameters.map((parameter) => (
              <TableRow key={parameter.name}>
                <TableCell className='font-mono text-xs whitespace-normal'>
                  {props.model.type === 'chat'
                    ? parameter.name
                    : `params.${parameter.name}`}
                  {parameter.required ? ' *' : ''}
                </TableCell>
                <TableCell className='text-xs'>{parameter.type}</TableCell>
                <TableCell className='max-w-xs text-xs break-words whitespace-normal'>
                  {parameter.options
                    ?.map((option) => String(option.value))
                    .join(' / ') || String(parameter.default ?? '—')}
                  {parameter.min != null || parameter.max != null
                    ? ` (${parameter.min ?? '—'} ~ ${parameter.max ?? '—'})`
                    : ''}
                </TableCell>
                <TableCell className='max-w-sm text-xs whitespace-normal'>
                  {parameter.description || parameter.label}
                </TableCell>
              </TableRow>
            ))}
            {!parameters.length && (
              <TableRow>
                <TableCell colSpan={4} className='text-muted-foreground'>
                  {t(
                    'Use standard chat parameters. Model-specific parameters are not published.'
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
