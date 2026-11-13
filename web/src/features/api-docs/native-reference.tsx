// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { portalApiOrigin } from '@/lib/portal-runtime'

import {
  uploadEndpoints,
  uploadGuidance,
  uploadRequest,
  uploadResponse,
  uploadUsage,
  voiceEndpoints,
  voiceGuidance,
  voiceRecovery,
  voiceRequest,
  voiceResponse,
  voiceReview,
} from './reference'

// Kept apart from protocol-reference.tsx so that file stays within the
// component size guideline; both sections only render on the quick start.
export function NativeReference() {
  const { t } = useTranslation()
  const base = `${portalApiOrigin()}/v1`
  const sections = [
    {
      title: 'Upload reference media',
      notes: [uploadGuidance, uploadUsage],
      endpoints: uploadEndpoints,
      code: uploadRequest(base),
      copyLabel: 'Copy upload request',
      response: uploadResponse,
    },
    {
      title: 'Voice cloning',
      notes: [voiceGuidance, voiceReview, voiceRecovery],
      endpoints: voiceEndpoints,
      code: voiceRequest(base),
      copyLabel: 'Copy voice cloning request',
      response: voiceResponse,
    },
  ]
  return (
    <>
      {sections.map((section) => (
        <section
          key={section.title}
          className='space-y-4'
          aria-label={t(section.title)}
        >
          <h2 className='text-xl font-semibold'>{t(section.title)}</h2>
          {section.notes.map((note) => (
            <p key={note} className='text-muted-foreground text-sm leading-6'>
              {t(note)}
            </p>
          ))}
          <div className='space-y-2'>
            {section.endpoints.map(([method, path, label]) => (
              <div
                key={method + path}
                className='flex min-w-0 flex-wrap items-center gap-3 rounded-lg border px-4 py-3'
              >
                <strong className='text-primary text-xs'>{method}</strong>
                <code className='min-w-56 flex-[2_1_18rem] text-xs break-all'>
                  {base}
                  {path}
                </code>
                <span className='text-muted-foreground min-w-0 flex-[1_1_12rem] text-xs'>
                  {t(label)}
                </span>
              </div>
            ))}
          </div>
          <div className='overflow-hidden rounded-xl border'>
            <div className='bg-muted/30 flex items-center justify-between border-b px-4 py-2'>
              <span className='text-sm'>cURL</span>
              <CopyButton
                value={section.code}
                aria-label={t(section.copyLabel)}
                size='sm'
              />
            </div>
            <pre className='overflow-auto p-4 text-xs leading-6'>
              <code>{section.code}</code>
            </pre>
          </div>
          <pre className='bg-muted/20 overflow-auto rounded-xl border p-4 text-xs leading-6'>
            <code>{JSON.stringify(section.response, null, 2)}</code>
          </pre>
        </section>
      ))}
    </>
  )
}
