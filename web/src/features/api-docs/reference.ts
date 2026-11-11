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
export const balanceGuidance =
  'Query the current account balance with the same API key. This read is free and uncached. data.balance is in credits (unit: credits), not currency or the key quota; queried_at is the query time. Committed top-ups and charges appear on the next query. No user ID or model is required.'
export function balanceRequest(base: string): string {
  return `curl --fail-with-body "${base}/balance" \\\n  -H "Authorization: Bearer $PLATFORM_API_KEY"`
}
export const balanceResponse = {
  success: true,
  data: {
    balance: 125.5,
    unit: 'credits',
    queried_at: '2026-11-01T12:00:00.000Z',
  },
}
export const rechargeGuidance =
  'Create a payment QR with POST /recharge/orders using this API key and a unique Idempotency-Key. amount is a CNY string and must be one of the site’s top-up amounts (the same ones the top-up page shows); any other amount returns 400 payment_amount_unavailable with allowed_amounts listing the current choices. payment_method is wechat or alipay. The key owner receives 1 credit per yuan; bonuses are separate. No user ID, browser login or model is needed. Display qr_code_image (a PNG data URL), or encode qr_code as a QR locally. Only trust the server status, never a client payment-success message.'
export const rechargeRecovery =
  'Poll GET /recharge/orders/{id} every 5 seconds. paid with credited_at confirms settlement; then GET /balance reads the wallet. Stop normal polling on paid, failed, expired, refunded or partially_refunded. Refund amounts are CNY; credited_points, bonus_points and debt_repaid are credits. On timeout or 5xx, query the original order or retry the same body and Idempotency-Key; never create a second payment blindly. An expired QR cannot be reused; check the original order before starting a new payment. Foreign orders return 404. This API recharges the account wallet, not the API key spending quota.'
export function rechargeRequest(base: string): string {
  return `curl --fail-with-body "${base}/recharge/orders" \\\n  -H "Authorization: Bearer $PLATFORM_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: recharge-order-001" \\\n  -d '{"amount":"10.00","payment_method":"wechat"}'`
}
export function rechargeQuery(base: string): string {
  return `curl --fail-with-body "${base}/recharge/orders/$ORDER_ID" \\\n  -H "Authorization: Bearer $PLATFORM_API_KEY"`
}
export const rechargeResponse = {
  success: true,
  data: { id: 'LK_EXAMPLE_ORDER', status: 'pending', amount: '10.00', currency: 'CNY', points: 10,
    credited_points: 0, bonus_points: 0, debt_repaid: 0, refunded_amount: '0.00', payment_method: 'wechat',
    qr_code: 'weixin://example', qr_code_image: 'data:image/png;base64,...', credited_at: null, poll_after_seconds: 5 },
}
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
            'Optional. A key with a saved strategy ignores route_id. Keys without a strategy can use it to pin a route.',
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
    `## ${t('Query credit balance')}`,
    t(balanceGuidance),
    '```sh',
    balanceRequest(`${root}/v1`),
    '```',
    '```json',
    JSON.stringify(balanceResponse, null, 2),
    '```',
    `## ${t('Recharge by API')}`,
    t(rechargeGuidance), t(rechargeRecovery),
    '```sh', rechargeRequest(`${root}/v1`), rechargeQuery(`${root}/v1`), '```',
    '```json', JSON.stringify(rechargeResponse, null, 2), '```',
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
