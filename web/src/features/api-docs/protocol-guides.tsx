// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { PlatformModel } from '@/features/platform-models/types'
import { portalPublicApiOrigin } from '@/lib/portal-runtime'

import { protocolDocument, protocolGuides } from './protocols'

function ExampleBlock(props: { title: string; code: string; label: string }) {
  return (
    <div className='min-w-0 overflow-hidden rounded-xl border'>
      <div className='bg-muted/30 flex items-center justify-between gap-2 border-b px-4 py-2'>
        <span className='text-sm'>{props.title}</span>
        <CopyButton value={props.code} aria-label={props.label} size='sm' />
      </div>
      <pre className='max-h-[440px] overflow-auto p-4 text-xs leading-6'>
        <code>{props.code}</code>
      </pre>
    </div>
  )
}

function EndpointList(props: { endpoints: Array<[string, string, string]> }) {
  const { t } = useTranslation()
  return (
    <div className='space-y-2'>
      {props.endpoints.map(([method, path, label]) => (
        <div
          key={method + path}
          className='flex min-w-0 flex-wrap items-center gap-3 rounded-lg border px-4 py-3'
        >
          <strong className='text-primary text-xs'>{method}</strong>
          <code className='min-w-56 flex-[2_1_18rem] text-xs break-all'>
            {path}
          </code>
          <span className='text-muted-foreground min-w-0 flex-[1_1_12rem] text-xs'>
            {t(label)}
          </span>
        </div>
      ))}
    </div>
  )
}

// Quick-start guide for every client protocol the portal relays; each tab
// copies as one document so it can be pasted into an integration ticket.
export function ProtocolGuides(props: { models: PlatformModel[] }) {
  const { t } = useTranslation()
  const guides = protocolGuides(portalPublicApiOrigin(), props.models)
  return (
    <section className='space-y-4' aria-label={t('Supported protocols')}>
      <h2 className='text-xl font-semibold'>{t('Supported protocols')}</h2>
      <p className='text-muted-foreground text-sm leading-6'>
        {t(
          'One API key works with every protocol below. Pick the one your client or SDK speaks; the same prices and key routing apply.'
        )}
      </p>
      <Tabs defaultValue='chat' className='min-w-0'>
        <TabsList className='h-auto max-w-full flex-wrap justify-start'>
          {guides.map((guide) => (
            <TabsTrigger key={guide.id} value={guide.id}>
              {t(guide.title)}
            </TabsTrigger>
          ))}
        </TabsList>
        {guides.map((guide) => (
          <TabsContent
            key={guide.id}
            value={guide.id}
            className='min-w-0 space-y-4 pt-2'
          >
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <p className='text-muted-foreground max-w-2xl text-sm leading-6'>
                {t(guide.summary)}
              </p>
              <CopyButton
                size='sm'
                variant='outline'
                value={protocolDocument(guide, t)}
                aria-label={t('Copy all for {{protocol}}', {
                  protocol: t(guide.title),
                })}
              >
                {t('Copy all')}
              </CopyButton>
            </div>
            <EndpointList endpoints={guide.endpoints} />
            <p className='text-sm'>
              <span className='text-muted-foreground'>
                {t('Authentication')}:{' '}
              </span>
              <code className='break-all'>{guide.auth}</code>
            </p>
            <ul className='text-muted-foreground list-disc space-y-2 pl-5 text-sm leading-6'>
              {guide.notes.map((note) => (
                <li key={note}>{t(note)}</li>
              ))}
            </ul>
            {guide.setup && (
              <ExampleBlock
                title={guide.setup.title}
                code={guide.setup.code}
                label={t('Copy {{name}} setup', { name: guide.setup.title })}
              />
            )}
            <ExampleBlock
              title='cURL'
              code={guide.curl}
              label={t('Copy cURL example for {{protocol}}', {
                protocol: t(guide.title),
              })}
            />
            <ExampleBlock
              title='Python'
              code={guide.python}
              label={t('Copy Python example for {{protocol}}', {
                protocol: t(guide.title),
              })}
            />
            {guide.legacy && (
              <div className='space-y-3 rounded-xl border border-dashed p-4'>
                <Badge variant='outline'>{t(guide.legacy.title)}</Badge>
                <p className='text-muted-foreground text-sm leading-6'>
                  {t(guide.legacy.text)}
                </p>
                <EndpointList endpoints={guide.legacy.endpoints} />
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  )
}
