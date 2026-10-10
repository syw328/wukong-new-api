// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
import { platformRequestExample } from './helpers'
import type { PlatformModel, PriceRoute } from './types'

export function curlExample(
  model: PlatformModel,
  root: string,
  route?: PriceRoute
): string {
  const request = platformRequestExample(model, route)
  if (model.type === 'chat') {
    return [
      'curl --fail-with-body ' +
        JSON.stringify(root + '/v1/chat/completions') +
        ' \\',
      '  -H "Authorization: Bearer $PLATFORM_API_KEY" -H "Content-Type: application/json" \\',
      "  --data '" +
        JSON.stringify({
          model: model.id,
          messages: [{ role: 'user', content: 'Hello' }],
        }) +
        "'",
    ].join('\n')
  }
  return [
    '# Requires curl and jq. Keep the same order UUID when recovering a submission.',
    'API_ROOT=' + JSON.stringify(root),
    'MAX_CREDITS=10 # Set your own spending limit.',
    'IDEMPOTENCY_KEY="${PLATFORM_IDEMPOTENCY_KEY:?Set and save a unique order UUID}"',
    "REQUEST=$(cat <<'JSON'",
    JSON.stringify(request, null, 2),
    'JSON',
    ')',
    'QUOTE=$(curl --fail-with-body -sS "$API_ROOT/v1/media/quotes" \\',
    '  -H "Authorization: Bearer $PLATFORM_API_KEY" -H "Content-Type: application/json" \\',
    '  --data "$REQUEST") || exit 1',
    'echo "$QUOTE" | jq .',
    'echo "$QUOTE" | jq -e --argjson cap "$MAX_CREDITS" \'.authorization_max > 0 and .authorization_max <= $cap\' >/dev/null || exit 1',
    'CREATE=$(jq -n --argjson body "$REQUEST" --argjson quote "$QUOTE" \\',
    "  '$body + ($quote | {authorization_token, authorization_max, confirmed_price_book_id})')",
    '# Persist CREATE and IDEMPOTENCY_KEY before the paid request.',
    'TASK=$(curl --fail-with-body -sS "$API_ROOT/v1/media/generations" \\',
    '  -H "Authorization: Bearer $PLATFORM_API_KEY" -H "Content-Type: application/json" \\',
    '  -H "Idempotency-Key: $IDEMPOTENCY_KEY" --data "$CREATE") || exit 1',
    'echo "$TASK" | jq .',
    'TASK_ID=$(echo "$TASK" | jq -er \'.id\') || exit 1',
    'for attempt in $(seq 1 900); do',
    '  STATUS=$(echo "$TASK" | jq -r \'.status\')',
    '  case "$STATUS" in queued|processing) ;; *) break ;; esac',
    '  sleep 3',
    '  TASK=$(curl --fail-with-body -sS "$API_ROOT/v1/media/generations/$TASK_ID" \\',
    '    -H "Authorization: Bearer $PLATFORM_API_KEY") || exit 1',
    'done',
    'echo "$TASK" | jq -e \'.status == "completed"\' >/dev/null || { echo "$TASK" | jq .; exit 1; }',
    '# Download the content_url returned by this artifact list using the same API key.',
    'curl --fail-with-body -sS "$API_ROOT/v1/tasks/$TASK_ID/artifacts" \\',
    '  -H "Authorization: Bearer $PLATFORM_API_KEY"',
  ].join('\n')
}

export function pythonExample(
  model: PlatformModel,
  root: string,
  route?: PriceRoute
): string {
  if (model.type === 'chat') {
    return `import os\nfrom openai import OpenAI\n\nclient = OpenAI(api_key=os.environ["PLATFORM_API_KEY"], base_url=${JSON.stringify(`${root}/v1`)})\nresponse = client.chat.completions.create(\n    model=${JSON.stringify(model.id)},\n    messages=[{"role": "user", "content": "Hello"}],\n)\nprint(response.choices[0].message.content)`
  }
  const payload = JSON.stringify(platformRequestExample(model, route), null, 2)
  return `import json, os, time, uuid\nimport requests\n\nROOT = ${JSON.stringify(root)}\nMAX_CREDITS = 10.0  # Set your own maximum spending authorization\nsession = requests.Session()\nsession.headers["Authorization"] = "Bearer " + os.environ["PLATFORM_API_KEY"]\nbody = json.loads(r'''${payload}''')\n\n# Replace required reference URLs and parameters before requesting a quote.\nquote_response = session.post(ROOT + "/v1/media/quotes", json=body, timeout=90)\nquote_response.raise_for_status()\nquote = quote_response.json()\nif not 0 < quote["authorization_max"] <= MAX_CREDITS:\n    raise RuntimeError("Quote exceeds your spending limit")\n\nbody.update({key: quote[key] for key in (\n    "authorization_token", "authorization_max", "confirmed_price_book_id"\n)})\nrequest_key = os.getenv("PLATFORM_IDEMPOTENCY_KEY") or str(uuid.uuid4())  # Persist this key and body before submitting.\ncreated = session.post(ROOT + "/v1/media/generations", json=body,\n    headers={"Idempotency-Key": request_key}, timeout=600)\ncreated.raise_for_status()\ntask = created.json()\nprint("task_id:", task["id"])  # Save this ID and resume polling after disconnects.\n\nfor _ in range(900):\n    response = session.get(ROOT + "/v1/media/generations/" + task["id"], timeout=90)\n    response.raise_for_status()\n    task = response.json()\n    if task["status"] in ("completed", "failed"):\n        break\n    time.sleep(task.get("poll_after_seconds") or 3)\nelse:\n    raise TimeoutError("Task still pending. Poll the same task; do not resubmit.")\nif task["status"] == "failed":\n    raise RuntimeError(task.get("error"))\nartifacts = session.get(ROOT + "/v1/tasks/" + task["id"] + "/artifacts", timeout=90)\nartifacts.raise_for_status()\nprint(artifacts.json())  # Download the returned content_url using the same API key.\n`
}
