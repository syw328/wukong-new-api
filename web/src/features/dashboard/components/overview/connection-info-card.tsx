// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { Link } from '@tanstack/react-router'
import { Copy, PlugZap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { portalPublicApiOrigin } from '@/lib/portal-runtime'

import { useRealKeyCopy } from '../../hooks/use-real-key-copy'
import { buildCurlCommand } from '../../lib/connection'

type Snippet = { title: string; build: (apiKey: string) => string }

/**
 * Base URL, protocol endpoints and ready-to-paste snippets for the current
 * site. Snippets display a masked key; copying fetches the real key.
 */
export function ConnectionInfoCard(props: {
  id: string
  keyId?: number
  displayKey: string
  model: string
  claudeModel: string
}) {
  const { t } = useTranslation()
  const { copy, copying } = useRealKeyCopy(props.keyId)
  const origin = portalPublicApiOrigin()
  const base = `${origin}/v1`
  const endpoints: Array<[string, string]> = [
    ['OpenAI Chat Completions', `${base}/chat/completions`],
    ['OpenAI Responses', `${base}/responses`],
    ['Anthropic Messages', `${base}/messages`],
    ['Gemini', `${origin}/v1beta/models/{model}:generateContent`],
    ['Images, video, audio and tools', `${base}/media/quotes`],
  ]
  const snippets: Snippet[] = [
    {
      title: 'First request (cURL)',
      build: (apiKey) =>
        buildCurlCommand({
          endpoint: `${base}/chat/completions`,
          apiKey,
          model: props.model,
        }),
    },
    {
      title: 'Claude Code',
      build: (apiKey) =>
        `export ANTHROPIC_BASE_URL="${origin}"\nexport ANTHROPIC_AUTH_TOKEN="${apiKey}"\nexport ANTHROPIC_MODEL="${props.claudeModel}"\nclaude`,
    },
    {
      title: 'OpenAI SDK and compatible tools',
      build: (apiKey) =>
        `export OPENAI_BASE_URL="${base}"\nexport OPENAI_API_KEY="${apiKey}"`,
    },
  ]
  return (
    <section
      id={props.id}
      tabIndex={-1}
      aria-labelledby={`${props.id}-title`}
      className='bg-card rounded-2xl border p-4 shadow-xs outline-none sm:p-5'
    >
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex min-w-0 items-start gap-3'>
          <IconBadge tone='info'>
            <PlugZap />
          </IconBadge>
          <div className='min-w-0'>
            <h3 id={`${props.id}-title`} className='text-lg font-semibold'>
              {t('Connection details')}
            </h3>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Use one API key with any protocol below. Claude Code takes the Base URL without /v1; OpenAI SDKs take it with /v1.'
              )}
            </p>
          </div>
        </div>
        {!props.keyId && (
          <Button size='sm' variant='outline' render={<Link to='/keys' />}>
            {t('Create API Key')}
          </Button>
        )}
      </div>

      <div className='bg-muted/30 mt-4 flex min-w-0 flex-wrap items-center gap-2 rounded-xl border px-3 py-2'>
        <span className='text-muted-foreground text-xs font-medium'>
          Base URL
        </span>
        <code className='min-w-0 flex-1 text-sm break-all'>{base}</code>
        <CopyButton value={base} size='sm' aria-label={t('Copy Base URL')} />
      </div>

      <ul className='mt-3 grid gap-1.5' aria-label={t('Protocol endpoints')}>
        {endpoints.map(([label, url]) => (
          <li
            key={label}
            className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2'
          >
            <span className='w-full text-xs font-medium sm:w-56'>
              {t(label)}
            </span>
            <code className='text-muted-foreground min-w-0 flex-1 text-xs break-all'>
              {url}
            </code>
            <CopyButton
              value={url}
              size='sm'
              aria-label={t('Copy {{name}} endpoint', { name: t(label) })}
            />
          </li>
        ))}
      </ul>

      <div className='mt-4 grid gap-3 lg:grid-cols-3'>
        {snippets.map((snippet) => (
          <div
            key={snippet.title}
            className='flex min-w-0 flex-col overflow-hidden rounded-xl border'
          >
            <div className='bg-muted/30 flex items-center justify-between gap-2 border-b px-3 py-2'>
              <span className='truncate text-sm font-medium'>
                {t(snippet.title)}
              </span>
              <Button
                variant='outline'
                size='sm'
                className='h-7 gap-1.5 px-2 text-xs'
                disabled={!props.keyId || copying}
                onClick={() => void copy(snippet.build)}
                aria-label={t('Copy {{name}} with your API key', {
                  name: t(snippet.title),
                })}
              >
                <Copy data-icon='inline-start' />
                {t('Copy')}
              </Button>
            </div>
            <pre className='flex-1 overflow-auto p-3 text-xs leading-5'>
              <code>{snippet.build(props.displayKey)}</code>
            </pre>
          </div>
        ))}
      </div>
      {!props.keyId && (
        <p className='text-muted-foreground mt-3 text-xs'>
          {t('Create an API key to unlock the real request')}
        </p>
      )}
    </section>
  )
}
