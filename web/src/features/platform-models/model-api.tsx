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
import { portalApiOrigin } from '@/lib/portal-runtime'

import { platformRequestExample } from './helpers'
import type { PlatformModel } from './types'

function pythonExample(model: PlatformModel, root: string): string {
  if (model.type === 'chat') {
    return `import os\nfrom openai import OpenAI\n\nclient = OpenAI(api_key=os.environ["PLATFORM_API_KEY"], base_url=${JSON.stringify(`${root}/v1`)})\nresponse = client.chat.completions.create(\n    model=${JSON.stringify(model.id)},\n    messages=[{"role": "user", "content": "Hello"}],\n)\nprint(response.choices[0].message.content)`
  }
  const payload = JSON.stringify(platformRequestExample(model), null, 2)
  return `import json, os, time, uuid\nimport requests\n\nROOT = ${JSON.stringify(root)}\nMAX_CREDITS = 1.0  # Set your own maximum spending authorization\nsession = requests.Session()\nsession.headers["Authorization"] = "Bearer " + os.environ["PLATFORM_API_KEY"]\nbody = json.loads(r'''${payload}''')\n\n# Replace required reference URLs and parameters before requesting a quote.\nquote_response = session.post(ROOT + "/v1/media/quotes", json=body, timeout=90)\nquote_response.raise_for_status()\nquote = quote_response.json()\nif quote["authorization_max"] > MAX_CREDITS:\n    raise RuntimeError("Quote exceeds your spending limit")\n\nbody.update({key: quote[key] for key in (\n    "authorization_token", "authorization_max", "confirmed_price_book_id"\n)})\nrequest_key = str(uuid.uuid4())  # Persist this key and body before submitting.\ncreated = session.post(ROOT + "/v1/media/generations", json=body,\n    headers={"Idempotency-Key": request_key}, timeout=600)\ncreated.raise_for_status()\ntask = created.json()\nprint("task_id:", task["id"])  # Save this ID and resume polling after disconnects.\n\nfor _ in range(900):\n    response = session.get(ROOT + "/v1/media/generations/" + task["id"], timeout=90)\n    response.raise_for_status()\n    task = response.json()\n    if task["status"] in ("completed", "failed"):\n        break\n    time.sleep(task.get("poll_after_seconds") or 3)\nelse:\n    raise TimeoutError("Task still pending. Poll the same task; do not resubmit.")\nif task["status"] == "failed":\n    raise RuntimeError(task.get("error"))\nartifacts = session.get(ROOT + "/v1/tasks/" + task["id"] + "/artifacts", timeout=90)\nartifacts.raise_for_status()\nprint(artifacts.json())  # Download the returned content_url using the same API key.\n`
}
export function ModelApi(props: { model: PlatformModel }) {
  const { t } = useTranslation()
  const root = portalApiOrigin()
  const code = pythonExample(props.model, root)
  return (
    <div className='space-y-6'>
      <div className='space-y-2 rounded-xl border p-4'>
        <h3 className='font-semibold'>{t('API connection')}</h3>
        <p className='text-muted-foreground text-sm'>
          {t(
            props.model.type === 'chat'
              ? 'Use the OpenAI-compatible chat endpoint with the model ID below.'
              : 'Images, video and audio use the platform asynchronous media API. Parameters match this model on the website; request a quote before each creation.'
          )}
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
      <section className='overflow-hidden rounded-xl border'>
        <div className='bg-muted/30 flex items-center justify-between border-b px-4 py-2'>
          <h3 className='text-sm font-medium'>{t('Python example')}</h3>
          <CopyButton value={code} size='sm' />
        </div>
        <pre className='max-h-[440px] overflow-auto p-4 text-xs leading-relaxed'>
          <code>{code}</code>
        </pre>
      </section>
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
            {props.model.parameters.map((parameter) => (
              <TableRow key={parameter.name}>
                <TableCell className='font-mono text-xs whitespace-normal'>
                  {parameter.name}
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
            {!props.model.parameters.length && (
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
