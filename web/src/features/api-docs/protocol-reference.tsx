// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { PlatformModel } from '@/features/platform-models/types'
import { portalApiOrigin } from '@/lib/portal-runtime'

import {
  protocolEndpoints,
  requestFields,
  recoveryGuidance,
  responseIntro,
  responseExample,
} from './reference'

export function ProtocolReference(props: { model?: PlatformModel }) {
  const { t } = useTranslation()
  const base = `${portalApiOrigin()}/v1`
  const discovery = `curl --fail-with-body "${base}/models" \\\n  -H "Authorization: Bearer $PLATFORM_API_KEY"`
  return (
    <div className='mt-8 space-y-8'>
      <section className='bg-muted/20 rounded-xl border p-5'>
        <h2 className='mb-3 text-lg font-semibold'>
          {t('Authentication and Base URL')}
        </h2>
        <p className='text-muted-foreground mb-3 text-sm leading-6'>
          {t(
            'Create an API key in this site console and save it as the PLATFORM_API_KEY environment variable on your server. Use the same key for requests, task polling and artifact downloads.'
          )}
        </p>
        <code className='text-sm break-all'>
          Authorization: Bearer $PLATFORM_API_KEY
        </code>
        <p className='text-muted-foreground mt-3 text-sm'>
          {t(
            'For OpenAI SDKs, use the Base URL above including /v1. Do not add /v1 twice. Keep keys out of browser code and public repositories.'
          )}
        </p>
      </section>
      {!props.model && (
        <section className='space-y-4'>
          <h2 className='text-xl font-semibold'>
            {t('Read available models')}
          </h2>
          <p className='text-muted-foreground text-sm'>
            {t(
              'The models endpoint lists models allowed by your key. Select a model in the directory for its request fields and complete Python or cURL example.'
            )}
          </p>
          <div className='overflow-hidden rounded-xl border'>
            <div className='bg-muted/30 flex items-center justify-between border-b px-4 py-2'>
              <span className='text-sm'>GET /models</span>
              <CopyButton
                value={discovery}
                aria-label={t('Copy request example')}
                size='sm'
              />
            </div>
            <pre className='overflow-auto p-4 text-xs leading-6'>
              <code>{discovery}</code>
            </pre>
          </div>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='rounded-xl border p-5'>
              <h3 className='font-semibold'>{t('Language models')}</h3>
              <p className='text-muted-foreground mt-2 text-sm leading-6'>
                {t(
                  'Send model and messages to /chat/completions. Set stream to true for SSE; process errors inside the stream as well as HTTP errors.'
                )}
              </p>
            </div>
            <div className='rounded-xl border p-5'>
              <h3 className='font-semibold'>
                {t('Images, video, audio and tools')}
              </h3>
              <p className='text-muted-foreground mt-2 text-sm leading-6'>
                {t(
                  'Request a quote, confirm its spending limit, create a task, then poll and download its artifacts. The examples include every step.'
                )}
              </p>
            </div>
          </div>
        </section>
      )}
      {props.model && (
        <>
          <section className='space-y-3'>
            <h2 className='text-xl font-semibold'>
              {t('Endpoints and workflow')}
            </h2>
            {protocolEndpoints(props.model).map(([method, path, label]) => (
              <div
                key={path}
                className='flex min-w-0 flex-wrap items-center gap-3 rounded-lg border px-4 py-3'
              >
                <strong className='text-primary text-xs'>{method}</strong>
                <code className='min-w-0 flex-1 text-xs break-all'>
                  {base}
                  {path}
                </code>
                <span className='text-muted-foreground text-xs'>
                  {t(label)}
                </span>
              </div>
            ))}
          </section>
          <section className='space-y-3'>
            <h2 className='text-xl font-semibold'>{t('Request fields')}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Parameter')}</TableHead>
                  <TableHead>{t('Type')}</TableHead>
                  <TableHead>{t('Description')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requestFields(props.model).map(([name, type, description]) => (
                  <TableRow key={name}>
                    <TableCell className='font-mono text-xs whitespace-normal'>
                      {name}
                    </TableCell>
                    <TableCell>{type}</TableCell>
                    <TableCell className='text-muted-foreground text-sm whitespace-normal'>
                      {t(description)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
          <section className='space-y-3'>
            <h2 className='text-xl font-semibold'>
              {t('Responses and recovery')}
            </h2>
            <p className='text-muted-foreground text-sm leading-6'>
              {t(responseIntro(props.model))}
            </p>
            <p className='text-muted-foreground text-xs'>
              {t('Example response shape')} ·{' '}
              {t(
                'Illustrative values only; use the actual response from your request.'
              )}
            </p>
            <pre className='bg-muted/20 overflow-auto rounded-xl border p-4 text-xs leading-6'>
              <code>
                {JSON.stringify(responseExample(props.model), null, 2)}
              </code>
            </pre>
            <ul className='text-muted-foreground list-disc space-y-2 pl-5 text-sm leading-6'>
              {recoveryGuidance.map((line) => (
                <li key={line}>{t(line)}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
