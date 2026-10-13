// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import {
  curlExample,
  pythonExample,
} from '@/features/platform-models/model-api-examples'
import type {
  PlatformModel,
  PriceRoute,
} from '@/features/platform-models/types'

type Row = [string, string, string]
export function protocolEndpoints(model: PlatformModel): Row[] {
  if (model.type === 'chat') {
    return [
      ['POST', '/chat/completions', 'Send a conversation'],
      ['GET', '/models', 'Read available models'],
    ]
  }
  return [
    ['POST', '/media/quotes', 'Request a quote'],
    ['POST', '/media/generations', 'Create a task with the confirmed quote'],
    ['GET', '/media/generations/{task_id}', 'Poll the original task'],
    ['GET', '/tasks/{task_id}/artifacts', 'Read artifact download links'],
  ]
}
export function requestFields(model: PlatformModel): Row[] {
  const common: Row[] = [
    ['model', 'string', 'Required. Use the exact model ID shown above.'],
  ]
  if (model.type === 'chat') {
    return [
      ...common,
      [
        'messages',
        'array',
        'Required. Conversation messages with role and content.',
      ],
      ['stream', 'boolean', 'Optional. Set true to receive SSE events.'],
    ]
  }
  return [
    ...common,
    ...(model.category === 'tool'
      ? []
      : ([
          [
            'prompt',
            'string',
            'Describe the requested output. Supply reference media in params when required.',
          ],
        ] as Row[])),
    [
      'params',
      'object',
      'Model parameters listed below. Selected routes may have different fields and defaults.',
    ],
    ...(model.category === 'tool'
      ? []
      : ([
          [
            'route_id',
            'string',
            'Optional. Copy a published route ID to select that route; omit it for automatic routing.',
          ],
        ] as Row[])),
    [
      'authorization_token',
      'string',
      'Creation only. Copy from the quote for this exact request.',
    ],
    [
      'authorization_max',
      'number',
      'Creation only. Confirm the quote maximum in credits before submitting.',
    ],
    [
      'confirmed_price_book_id',
      'string',
      'Creation only. Copy from the same quote without changing it.',
    ],
    [
      'Idempotency-Key',
      'header',
      'Creation only. Save one unique 8–160 character key per order; reuse it with the identical request when recovering.',
    ],
  ]
}
export const recoveryGuidance = [
  '401 / 403: check the key, its permissions and the current site. 400: check the model and request fields. 429: reduce request frequency and follow the response guidance.',
  'For media, an expired quote or changed request requires a new quote before a new submission. A conflicting Idempotency-Key must not be used for a different order.',
  'A timeout or 5xx response does not prove that generation failed. Save the request, key and task ID; query the original task before retrying. Never blindly create another paid task.',
  'Listed prices are references. Media authorization and final charges come from the server quote and settlement; unknown task results must be reconciled before assuming a refund.',
]
export function modelDocument(
  model: PlatformModel,
  root: string,
  route: PriceRoute | undefined,
  t: (text: string) => string
): string {
  const parameters = route?.parameters || model.parameters
  return [
    `# ${model.name}`,
    model.description,
    `model: ${model.id}`,
    `Base URL: ${root}/v1`,
    'Authorization: Bearer $PLATFORM_API_KEY',
    t(
      'Create an API key in this site console and save it as the PLATFORM_API_KEY environment variable on your server. Use the same key for requests, task polling and artifact downloads.'
    ),
    `## ${t('Endpoints and workflow')}`,
    ...protocolEndpoints(model).map(
      ([method, path, label]) => `${method} ${root}/v1${path} — ${t(label)}`
    ),
    `## ${t('Request fields')}`,
    ...requestFields(model).map(
      ([name, type, text]) => `${name} (${type}): ${t(text)}`
    ),
    `## ${t('Published model parameters')}`,
    ...parameters.map(
      (p) =>
        `${model.type === 'chat' ? '' : 'params.'}${p.name} (${p.type}${p.required ? ', required' : ''}): ${p.description || p.label}; default=${JSON.stringify(p.default ?? null)}; options=${p.options?.map((v) => v.value).join(', ') || '—'}; min=${p.min ?? '—'}; max=${p.max ?? '—'}`
    ),
    `## ${t('Responses and recovery')}`,
    t(responseIntro(model)),
    ...recoveryGuidance.map((text) => t(text)),
    `## ${t('Example response shape')}`,
    '```json',
    JSON.stringify(responseExample(model), null, 2),
    '```',
    '## Python',
    '```python',
    pythonExample(model, root, route),
    '```',
    '## cURL',
    '```sh',
    curlExample(model, root, route),
    '```',
  ].join('\n\n')
}

export function responseIntro(model: PlatformModel): string {
  return model.type === 'chat'
    ? 'A successful chat response contains choices[].message.content and usage. Streaming requests return SSE events instead of one JSON document.'
    : 'Task creation returns HTTP 200 with id and status. Keep the id as a string. processing means keep polling; completed means fetch artifacts; failed means inspect error. A task ID is not the generated file.'
}

// Illustrative field shapes, not live task results or usage claims.
export function responseExample(model: PlatformModel): Record<string, unknown> {
  if (model.type === 'chat') {
    return {
      id: 'chatcmpl-example',
      object: 'chat.completion',
      model: model.id,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello!' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
    }
  }
  return {
    id: 'task-example',
    object: 'media.generation',
    model: model.id,
    status: 'processing',
    billing: { currency: 'CREDITS', state: 'pending' },
    result: null,
    error: null,
    poll_after_seconds: 3,
  }
}
