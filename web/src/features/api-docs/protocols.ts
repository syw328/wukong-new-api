// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
// Client protocols the portal gateway relays (router/relay-router.go and the
// task protocol registry). Pure builders so the quick start, its "copy all"
// text and tests share one source.
import {
  curlExample,
  pythonExample,
} from '@/features/platform-models/model-api-examples'
import type { PlatformModel } from '@/features/platform-models/types'

type Row = [string, string, string]
export type ProtocolId = 'chat' | 'responses' | 'anthropic' | 'gemini' | 'media'
export type ProtocolGuide = {
  id: ProtocolId
  title: string
  summary: string
  endpoints: Row[]
  auth: string
  notes: string[]
  setup?: { title: string; code: string }
  legacy?: { title: string; text: string; endpoints: Row[] }
  curl: string
  python: string
}

const MODEL_PLACEHOLDER = 'MODEL_ID'

function chatModel(models: PlatformModel[], app?: string): string {
  const chat = models.filter((model) => model.type === 'chat')
  const usable = chat.filter((model) => model.available)
  const fitting = app
    ? usable.find((model) => model.client_apps?.includes(app))
    : undefined
  return (fitting || usable[0] || chat[0])?.id || MODEL_PLACEHOLDER
}

// Media examples follow a real catalog model so params match; an empty
// catalog still documents the flow with a placeholder model.
function mediaModel(models: PlatformModel[]): PlatformModel {
  const media = models.filter(
    (model) => model.type !== 'chat' && model.category !== 'tool'
  )
  return (
    media.find((model) => model.available) ||
    media[0] || {
      id: MODEL_PLACEHOLDER,
      name: MODEL_PLACEHOLDER,
      type: 'image',
      description: '',
      available: true,
      tags: [],
      parameters: [],
      endpoint: '/v1/media/generations',
    }
  )
}

export function protocolGuides(
  origin: string,
  models: PlatformModel[]
): ProtocolGuide[] {
  const base = `${origin}/v1`
  const chat = chatModel(models)
  const responses = chatModel(models, 'codex')
  const claude = chatModel(models, 'claude')
  const gemini = chatModel(models, 'gemini')
  const geminiRoot = `${origin}/v1beta/models/${gemini}`
  const media = mediaModel(models)
  const geminiBody = '{"contents":[{"role":"user","parts":[{"text":"Hello"}]}]}'
  return [
    {
      id: 'chat',
      title: 'OpenAI Chat Completions',
      summary:
        'Send model and messages to /chat/completions. Set stream to true for SSE; process errors inside the stream as well as HTTP errors.',
      endpoints: [
        ['POST', `${base}/chat/completions`, 'Send a conversation'],
        ['GET', `${base}/models`, 'Read available models'],
      ],
      auth: 'Authorization: Bearer $PLATFORM_API_KEY',
      notes: [
        'For OpenAI SDKs, use the Base URL above including /v1. Do not add /v1 twice. Keep keys out of browser code and public repositories.',
      ],
      curl: `curl --fail-with-body "${base}/chat/completions" \\\n  -H "Authorization: Bearer $PLATFORM_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ model: chat, messages: [{ role: 'user', content: 'Hello' }] })}'`,
      python: `import os\nfrom openai import OpenAI\n\nclient = OpenAI(api_key=os.environ["PLATFORM_API_KEY"], base_url=${JSON.stringify(base)})\nstream = client.chat.completions.create(\n    model=${JSON.stringify(chat)},\n    messages=[{"role": "user", "content": "Hello"}],\n    stream=True,\n)\nfor chunk in stream:\n    if chunk.choices and chunk.choices[0].delta.content:\n        print(chunk.choices[0].delta.content, end="", flush=True)`,
    },
    {
      id: 'responses',
      title: 'OpenAI Responses',
      summary:
        'Send model and input to /responses with the OpenAI SDK or any Responses client. Set stream to true for Responses SSE events.',
      endpoints: [['POST', `${base}/responses`, 'Create a response']],
      auth: 'Authorization: Bearer $PLATFORM_API_KEY',
      notes: [
        'Requests follow the chat routing of your key. Routes with native Responses support keep inputs, reasoning, tools and stream events; other chat routes are converted to Chat Completions by the gateway.',
        'Codex needs a native Responses route. CC Switch only offers Codex the models that have one.',
      ],
      curl: `curl --fail-with-body "${base}/responses" \\\n  -H "Authorization: Bearer $PLATFORM_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ model: responses, input: 'Hello' })}'`,
      python: `import os\nfrom openai import OpenAI\n\nclient = OpenAI(api_key=os.environ["PLATFORM_API_KEY"], base_url=${JSON.stringify(base)})\nresponse = client.responses.create(model=${JSON.stringify(responses)}, input="Hello")\nprint(response.output_text)`,
    },
    {
      id: 'anthropic',
      title: 'Anthropic Messages',
      summary:
        'Claude clients and the Anthropic SDK call /v1/messages. Authenticate with x-api-key or Authorization: Bearer.',
      endpoints: [['POST', `${base}/messages`, 'Send a message']],
      auth: 'x-api-key: $PLATFORM_API_KEY',
      notes: [
        'Anthropic SDKs and Claude Code take the Base URL without /v1 and append /v1/messages themselves.',
        'Use a model the Claude client list allows for your key; CC Switch can import it with one click.',
      ],
      setup: {
        title: 'Claude Code',
        code: `export ANTHROPIC_BASE_URL=${JSON.stringify(origin)}\nexport ANTHROPIC_AUTH_TOKEN="$PLATFORM_API_KEY"\nexport ANTHROPIC_MODEL=${JSON.stringify(claude)}\nclaude`,
      },
      curl: `curl --fail-with-body "${base}/messages" \\\n  -H "x-api-key: $PLATFORM_API_KEY" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ model: claude, max_tokens: 1024, messages: [{ role: 'user', content: 'Hello' }] })}'`,
      python: `import os\nimport anthropic\n\nclient = anthropic.Anthropic(api_key=os.environ["PLATFORM_API_KEY"], base_url=${JSON.stringify(origin)})\nmessage = client.messages.create(\n    model=${JSON.stringify(claude)},\n    max_tokens=1024,\n    messages=[{"role": "user", "content": "Hello"}],\n)\nprint(message.content[0].text)`,
    },
    {
      id: 'gemini',
      title: 'Gemini',
      summary:
        'Gemini clients call generateContent, or streamGenerateContent with alt=sse for streaming. Put the key in the x-goog-api-key header.',
      endpoints: [
        [
          'POST',
          `${origin}/v1beta/models/{model}:generateContent`,
          'Generate content',
        ],
        [
          'POST',
          `${origin}/v1beta/models/{model}:streamGenerateContent?alt=sse`,
          'Stream generated content',
        ],
      ],
      auth: 'x-goog-api-key: $PLATFORM_API_KEY',
      notes: [
        'The ?key= query parameter also works, but it writes the key into URLs and logs. Prefer the header.',
      ],
      curl: `curl --fail-with-body "${geminiRoot}:generateContent" \\\n  -H "x-goog-api-key: $PLATFORM_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${geminiBody}'\n\ncurl --fail-with-body -N "${geminiRoot}:streamGenerateContent?alt=sse" \\\n  -H "x-goog-api-key: $PLATFORM_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${geminiBody}'`,
      python: `import os\nimport requests\n\nMODEL_URL = ${JSON.stringify(geminiRoot)}\nheaders = {"x-goog-api-key": os.environ["PLATFORM_API_KEY"]}\nbody = {"contents": [{"role": "user", "parts": [{"text": "Hello"}]}]}\n\nresponse = requests.post(MODEL_URL + ":generateContent", json=body, headers=headers, timeout=120)\nresponse.raise_for_status()\nprint(response.json()["candidates"][0]["content"]["parts"][0]["text"])\n\n# Streaming returns Server-Sent Events, one JSON chunk per data line.\nwith requests.post(MODEL_URL + ":streamGenerateContent?alt=sse", json=body,\n                   headers=headers, stream=True, timeout=120) as stream:\n    stream.raise_for_status()\n    for line in stream.iter_lines(decode_unicode=True):\n        if line.startswith("data: "):\n            print(line[6:])`,
    },
    {
      id: 'media',
      title: 'Images, video, audio and tools',
      summary:
        'Request a quote, confirm its spending limit, create a task, then poll and download its artifacts. The examples include every step.',
      endpoints: [
        ['POST', `${base}/media/quotes`, 'Request a quote'],
        [
          'POST',
          `${base}/media/generations`,
          'Create a task with the confirmed quote',
        ],
        [
          'GET',
          `${base}/media/generations/{task_id}`,
          'Poll the original task',
        ],
        [
          'GET',
          `${base}/tasks/{task_id}/artifacts`,
          'Read artifact download links',
        ],
      ],
      auth: 'Authorization: Bearer $PLATFORM_API_KEY',
      notes: [
        'Select a model in the directory for its parameters, routes and a complete example with those values.',
        'A timeout does not mean failure. Keep the request body and Idempotency-Key unchanged when recovering a submission; once a task ID is available, only poll that task. One request creates one output task.',
      ],
      legacy: {
        title: 'Legacy, still available',
        text: 'Tools that only speak the OpenAI image API can call the synchronous image endpoints. Each request returns one image (n=1) and runs the same quote, creation and settlement internally.',
        endpoints: [
          ['POST', `${base}/images/generations`, 'Generate one image'],
          ['POST', `${base}/images/edits`, 'Edit with reference images'],
        ],
      },
      curl: curlExample(media, origin),
      python: pythonExample(media, origin),
    },
  ]
}

// Plain text for "copy all": endpoints, authentication, notes and both
// complete examples, translated with the caller's t().
export function protocolDocument(
  guide: ProtocolGuide,
  t: (text: string) => string
): string {
  return [
    `## ${t(guide.title)}`,
    t(guide.summary),
    ...guide.endpoints.map(
      ([method, path, label]) => `${method} ${path} — ${t(label)}`
    ),
    `${t('Authentication')}: ${guide.auth}`,
    ...guide.notes.map((note) => `- ${t(note)}`),
    ...(guide.setup
      ? [`### ${guide.setup.title}`, '```sh', guide.setup.code, '```']
      : []),
    ...(guide.legacy
      ? [
          `### ${t(guide.legacy.title)}`,
          t(guide.legacy.text),
          ...guide.legacy.endpoints.map(
            ([method, path, label]) => `${method} ${path} — ${t(label)}`
          ),
        ]
      : []),
    '### cURL',
    '```sh',
    guide.curl,
    '```',
    '### Python',
    '```python',
    guide.python,
    '```',
  ].join('\n\n')
}
