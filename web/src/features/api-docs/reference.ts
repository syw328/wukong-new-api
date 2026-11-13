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
// Platform-native uploads and voice cloning (server/public-api/publicVoiceRoutes.js,
// publicApiRoutes.js /uploads/*); limits follow the platform, not this portal.
export const uploadGuidance =
  'Upload local files with the same API key before using them in a request. Uploads are free and need no Idempotency-Key. Send multipart/form-data with a Content-Length header. Uploaded files belong to the key owner; other accounts cannot use them.'
export const uploadEndpoints: Row[] = [
  ['POST', '/uploads/images', 'File field image: one PNG, JPG or WebP image up to 2 MB. Returns a url valid for 24 hours.'],
  ['POST', '/uploads/videos', 'File field video: one MP4 or MOV video up to 50 MB. Returns a url valid for 24 hours.'],
  ['POST', '/upload', 'File field files: up to 10 images, videos or audio files, 100 MB each and 110 MB per request. Returns files[].id and needs a positive balance.'],
]
export const uploadUsage =
  'Put the returned url into the media request params, for example params.images or params.videos. Public HTTPS links can be used directly without uploading. An oversized request returns 413.'
export function uploadRequest(base: string): string {
  return `curl --fail-with-body "${base}/uploads/images" \\\n  -H "Authorization: Bearer $PLATFORM_API_KEY" \\\n  -F "image=@./first-frame.png"\n\ncurl --fail-with-body "${base}/uploads/videos" \\\n  -H "Authorization: Bearer $PLATFORM_API_KEY" \\\n  -F "video=@./reference.mp4"`
}
export const uploadResponse = {
  id: 'file_example',
  object: 'file',
  purpose: 'video_reference',
  filename: 'first-frame.png',
  bytes: 456789,
  mime_type: 'image/png',
  url: 'https://example.com/uploads/public-api-reference-example.png',
  expires_at: '2026-11-02T12:00:00.000Z',
}
export const voiceGuidance =
  'Clone a speech-2.8 voice with the same API key. Upload a 10–60 second recording (mp3, wav or flac; m4a, aac and ogg are converted) with POST /upload, then create the voice with files[0].id as upload_id. The key must allow speech-2.8 and must not use custom routes. Cloning and activation are charged, and each needs its own new Idempotency-Key.'
export const voiceEndpoints: Row[] = [
  ['POST', '/upload', 'Upload the recording'],
  ['POST', '/voices/clone', 'Create the voice and submit it for review'],
  ['GET', '/voices?model=speech-2.8', 'List your voices and review status'],
  ['GET', '/voices/{asset_id}', 'Read one voice'],
  ['GET', '/voices/{asset_id}/activation/quote', 'Quote the one-time activation'],
  ['POST', '/voices/{asset_id}/activation', 'Confirm the activation with the quote'],
  ['GET', '/voices/{asset_id}/activation', 'Query the original activation'],
]
export const voiceReview =
  'Poll GET /voices/{asset_id} every 5–10 seconds. Use asset.voice_id in speech-2.8 requests only when review_status is approved and usable is true; review_note explains a rejection. An approved voice with can_activate true needs a one-time activation: read the quote, confirm authorization_max, then send authorization_token and authorization_max unchanged.'
export const voiceRecovery =
  'After 202, poll GET /voices/{asset_id}/activation until activation.status is completed; failed releases the hold, and unknown keeps the authorization for reconciliation. After a timeout, repeat the same request with the same Idempotency-Key or query the original voice; never clone, activate or pay again with a new key.'
export function voiceRequest(base: string): string {
  return [
    `curl --fail-with-body "${base}/upload" \\\n  -H "Authorization: Bearer $PLATFORM_API_KEY" \\\n  -F "files=@./sample.wav"`,
    `curl --fail-with-body "${base}/voices/clone" \\\n  -H "Authorization: Bearer $PLATFORM_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: voice-clone-001" \\\n  -d '{"name":"My voice","upload_id":"REPLACE_WITH_FILES_0_ID"}'`,
    `curl --fail-with-body "${base}/voices/$ASSET_ID" \\\n  -H "Authorization: Bearer $PLATFORM_API_KEY"`,
  ].join('\n\n')
}
export const voiceResponse = {
  asset: {
    id: 'ASSET_ID',
    voice_id: 'VOICE_ID',
    review_status: 'pending',
    usable: false,
    can_activate: false,
    activation_required: true,
  },
  cost: 1,
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
