// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
// New file: quick-start sections for what a portal key can do besides calling
// models — usage and spend, route prices, the notify_url callback, the key's
// own settings, the management key, SKILL.md and feedback. Kept apart from
// reference.ts so that file stays readable; native-reference.tsx renders both.
// Behavior follows controller/platform_native.go, platform_portal.go,
// token_api.go and the platform's /v1 contract (docs/public-api.md).

type Row = [string, string, string]
export type ReferenceSection = {
  title: string
  notes: string[]
  endpoints: Row[]
  code: string
  copyLabel: string
  response?: Record<string, unknown>
}

const auth = '-H "Authorization: Bearer $PLATFORM_API_KEY"'
const management = '-H "Authorization: Bearer $MANAGEMENT_KEY"'
const json = '-H "Content-Type: application/json"'

function usageSection(base: string): ReferenceSection {
  return {
    title: 'Usage and spend',
    notes: [
      'Read the actual charge of one call after it ends: chat, Responses and Messages replies carry an X-Task-Id response header (apicall_…); pass it to GET /usage/{task_id}. is_final false means settlement is still running, so query again shortly.',
      'GET /usage summarizes by model, or lists each call with detail=1 (days 1–30, or start_time and end_time). Calls through this site reach the billing platform under one shared service key, so scope=key covers all of your account’s calls through this site, not a single key; scope=user also includes direct keys from the developer center.',
      'Media task IDs returned here (task_…) only work for polling and downloads on this site, not for GET /usage/{task_id}; read the charge from billing.charged when polling the task. A streaming reply may occasionally lack X-Task-Id; find that call with detail=1.',
    ],
    endpoints: [
      ['GET', '/usage', 'Summary or per-call details'],
      ['GET', '/usage/{task_id}', 'Actual charge of one call'],
    ],
    code: [
      `curl -sS -D headers.txt "${base}/chat/completions" \\\n  ${auth} \\\n  ${json} \\\n  -d '{"model":"MODEL_ID","messages":[{"role":"user","content":"Hello"}]}'`,
      `TASK_ID=$(grep -i '^x-task-id:' headers.txt | awk '{print $2}' | tr -d '\\r')\ncurl --fail-with-body "${base}/usage/$TASK_ID" \\\n  ${auth}`,
      `curl --fail-with-body "${base}/usage?days=7&detail=1" \\\n  ${auth}`,
    ].join('\n\n'),
    copyLabel: 'Copy usage request',
    response: {
      object: 'usage.task',
      task_id: 'apicall_20261125_examplecall0001',
      model: 'MODEL_ID',
      modality: 'chat',
      state: 'success',
      is_final: true,
      cost: 0.4,
      refunded_amount: 0.1,
      created_at: '2026-11-25T08:00:00.000Z',
      completed_at: '2026-11-25T08:00:03.000Z',
      currency: 'CREDITS',
    },
  }
}

function pricingSection(base: string): ReferenceSection {
  return {
    title: 'Route prices',
    notes: [
      'GET /models/{model}/pricing lists every route of a model with today’s price for your account, its status, recent success rate and latency. Prices keep the price book’s precision, so you can estimate costs from them. Write a slash in a model ID as %2F.',
      'available_for_this_key follows this key’s model whitelist and routing; if the key does not allow the model, the request returns 403 key_model_forbidden. A paused route carries paused_reason: route_disabled (closed or not approved), health_paused (paused after recent failures) or no_valid_price (no valid price today).',
      'A listed model with no price today still returns 200, with status paused, paused_reason no_daily_price and an empty routes list; it cannot be submitted today.',
    ],
    endpoints: [
      [
        'GET',
        '/models/{model}/pricing',
        'Route prices, status and success rates',
      ],
    ],
    code: `curl --fail-with-body "${base}/models/MODEL_ID/pricing" \\\n  ${auth}`,
    copyLabel: 'Copy route price request',
    response: {
      object: 'model.pricing',
      model: 'MODEL_ID',
      type: 'video',
      currency: 'CREDITS',
      price_book_id: 'example-price-book-id',
      valid_until: '2026-11-26T00:00:00.000Z',
      statistics_available: true,
      routes: [
        {
          route_id: '0123456789abcdef01234567',
          name: 'R-97 · Example',
          billing_unit: 'second',
          status: 'active',
          available_for_this_key: true,
          success_rate: 0.9,
          success_samples: 10,
          median_latency_seconds: 95,
          latency_metric: 'duration',
          prices: [
            {
              params: { resolution: '720p' },
              group: 'Default specification',
              billing_unit: 'second',
              unit_size: 1,
              amount: 0.0833,
            },
          ],
          price_table_complete: true,
        },
        {
          route_id: '89abcdef0123456789abcdef',
          name: 'R-35 · Example',
          billing_unit: null,
          status: 'paused',
          paused_reason: 'no_valid_price',
          available_for_this_key: false,
          prices: [],
          price_table_complete: false,
        },
      ],
    },
  }
}

function notifySection(base: string): ReferenceSection {
  return {
    title: 'Task completion callback (notify_url)',
    notes: [
      'Add a top-level notify_url to POST /media/generations to be told when the task completes or fails. It must be a public http or https address of at most 2048 characters, not an internal, local or reserved host. Portal keys still need the three quote fields.',
      'Callbacks come from the platform that runs and bills the task: a POST of its task view with an X-Task-Id header. That id is the platform task number (usable with GET /usage/{task_id}), not the task_… ID returned here, and its content_url does not work with keys from this site. Put your own order ID in the notify_url query string to match the callback, then poll and download with the task ID returned here.',
      'A 2xx reply counts as delivered; otherwise it is retried 4 more times (at once, then after 10, 30 and 60 seconds). Redirects are not followed. Treat the callback as a reminder and trust the task query.',
    ],
    endpoints: [
      ['POST', '/media/generations', 'Create a task with a callback address'],
    ],
    code: `curl --fail-with-body "${base}/media/generations" \\\n  ${auth} \\\n  ${json} \\\n  -H "Idempotency-Key: order-20261125-001" \\\n  -d '{"model":"MODEL_ID","prompt":"A blue square","params":{},"authorization_token":"FROM_QUOTE","authorization_max":0.4,"confirmed_price_book_id":"FROM_QUOTE","notify_url":"https://example.com/hooks/media?order=20261125-001"}'`,
    copyLabel: 'Copy callback request',
  }
}

const keyView = {
  object: 'api_key',
  id: 42,
  name: 'production',
  key: 'AbCd**********wxyz',
  status: 'enabled',
  routing_strategy: 'balanced',
  routing_policy: {
    version: 2,
    mode: 'automatic',
    default_strategy: 'balanced',
    allowed_strategies: ['balanced'],
    allow_fixed_routes: false,
    model_rules: [],
  },
  model_limits: ['MODEL_ID'],
  quota: {
    unlimited: false,
    limit: 100,
    used: 12.5,
    remaining: 87.5,
    unit: 'credits',
  },
  allow_ips: [],
  expires_at: null,
  created_at: '2026-11-01T08:00:00Z',
  last_used_at: '2026-11-25T08:00:00Z',
  api_edit_allowed: false,
}

function keySection(base: string): ReferenceSection {
  return {
    title: 'Check your key',
    notes: [
      'GET /key returns this key’s own settings: masked key, status (enabled, disabled, expired or exhausted), routing strategy and policy, model whitelist (null means every model), quota in credits (limit equals used plus remaining; null when unlimited), IP whitelist, expiry and api_edit_allowed. The quota is this key’s spending limit, not the account balance.',
      'POST /key changes only name, routing_policy and status, and only after the owner turns on “Allow config changes via API” in this key’s settings (off by default); otherwise it returns 403 api_edit_not_allowed. Any other field returns 400 field_not_editable. A key that disables itself stops working at once; turn it back on in the console or with the management key.',
    ],
    endpoints: [
      ['GET', '/key', 'Read this key’s settings'],
      ['POST', '/key', 'Change this key’s name, routing or status'],
    ],
    code: [
      `curl --fail-with-body "${base}/key" \\\n  ${auth}`,
      `curl --fail-with-body "${base}/key" \\\n  ${auth} \\\n  ${json} \\\n  -d '{"name":"nightly-batch","routing_policy":{"version":2,"mode":"automatic","default_strategy":"cheapest","allowed_strategies":["cheapest"],"allow_fixed_routes":false,"model_rules":[]}}'`,
    ].join('\n\n'),
    copyLabel: 'Copy key request',
    response: keyView,
  }
}

function managementSection(base: string): ReferenceSection {
  return {
    title: 'Manage keys via API',
    notes: [
      'Only the account owner can create the management key, in the console: open API Keys, choose “Manage keys via API” and turn it on. Each account has one (sk-mgmt-…). It is shown once, and resetting or turning it off revokes it at once.',
      'Whoever holds it can create keys, change their quota, IP whitelist, expiry and routing, and delete keys of this account. It cannot call models, read the balance or recharge. Keep it out of code repositories and reset it at once if it leaks.',
      'Keep it in your own server-side secret store; do not give it to AI coding tools or put it in API_KEY. Another account’s key returns 404 key_not_found, a model key returns 403 management_key_required, and a reset management key returns 401 invalid_management_key.',
      'POST /keys and POST /keys/{id} accept name, status, routing_policy, model_limits, quota ({"unlimited": false, "limit": credits}), allow_ips, expires_at and allow_api_edit; other fields return 400 field_not_editable. The full key appears only in the creation response. List pages use p and page_size (up to 100).',
    ],
    endpoints: [
      ['GET', '/keys', 'List keys'],
      ['POST', '/keys', 'Create a key'],
      ['GET', '/keys/{id}', 'View a key'],
      ['POST', '/keys/{id}', 'Change a key'],
      ['DELETE', '/keys/{id}', 'Delete a key'],
      ['GET', '/keys/available-routes', 'Models and routes a key can use'],
    ],
    code: [
      `curl --fail-with-body "${base}/keys" \\\n  ${management} \\\n  ${json} \\\n  -d '{"name":"ci-bot","model_limits":["MODEL_ID"],"quota":{"unlimited":false,"limit":100}}'`,
      `curl --fail-with-body "${base}/keys?p=1&page_size=50" \\\n  ${management}`,
      `curl --fail-with-body "${base}/keys/KEY_ID" \\\n  ${management} \\\n  ${json} \\\n  -d '{"status":"disabled"}'`,
      `curl --fail-with-body -X DELETE "${base}/keys/KEY_ID" \\\n  ${management}`,
    ].join('\n\n'),
    copyLabel: 'Copy management key requests',
    response: {
      ...keyView,
      name: 'ci-bot',
      key: 'sk-SHOWN_ONLY_IN_THIS_RESPONSE',
      quota: { ...keyView.quota, used: 0, remaining: 100 },
      created_at: '2026-11-25T08:00:00Z',
    },
  }
}

function skillsSection(base: string): ReferenceSection {
  return {
    title: 'SKILL.md for AI coding tools',
    notes: [
      'GET /skills (JSON) and GET /skills/SKILL.md describe this site’s endpoints, authentication, billing, errors and retries for AI coding tools such as Cursor and Claude Code. They need no key. Put SKILL.md in .claude/skills/<name>/ or .cursor/skills/<name>/; the console overview also offers a download.',
      'The file tells the tool to read the key only from API_KEY in the project .env, and never to ask for or keep a management key.',
    ],
    endpoints: [
      ['GET', '/skills', 'Machine-readable description'],
      ['GET', '/skills/SKILL.md', 'Download SKILL.md'],
    ],
    code: `curl -s "${base}/skills"\ncurl -s "${base}/skills/SKILL.md" -o SKILL.md`,
    copyLabel: 'Copy SKILL.md request',
  }
}

function feedbackSection(base: string): ReferenceSection {
  return {
    title: 'Report a problem',
    notes: [
      'Send POST /feedback when the documentation differs from actual behavior, you suspect a bug or you need a missing feature; the platform handles it manually. type is doc, bug or feature; content is required (up to 4000 characters); endpoint and request_id are optional. Do not paste keys.',
      'Each account can send 10 per hour; more returns 429 with Retry-After. GET /feedback lists your latest 20 with their status and replies.',
    ],
    endpoints: [
      ['POST', '/feedback', 'Send feedback'],
      ['GET', '/feedback', 'Read your feedback and replies'],
    ],
    code: `curl --fail-with-body "${base}/feedback" \\\n  ${auth} \\\n  ${json} \\\n  -d '{"type":"doc","endpoint":"POST /v1/media/generations","request_id":"req_example","content":"The documentation says …, the response was …"}'`,
    copyLabel: 'Copy feedback request',
    response: {
      id: 'feedback_example',
      status: 'open',
      created_at: '2026-11-25T08:00:00.000Z',
    },
  }
}

export function selfServiceSections(base: string): ReferenceSection[] {
  return [
    usageSection(base),
    pricingSection(base),
    notifySection(base),
    keySection(base),
    managementSection(base),
    skillsSection(base),
    feedbackSection(base),
  ]
}
