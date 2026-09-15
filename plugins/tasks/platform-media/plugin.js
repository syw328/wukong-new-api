// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
// Platform wallet is authoritative. A signed quote binds user, request and cap.
// The synchronizer changes only these two declarations using the public catalog.
const PLATFORM_MODELS = ["__platform_media__"];
const PLATFORM_VERSION = "1.0.0";
export const meta = {
  apiVersion: 1, key: "platform-media", name: "Platform media", version: PLATFORM_VERSION,
  author: { name: "Platform contributors" },
  description: { en: "Platform images, video and audio with confirmed account pricing", zh: "平台图片、视频与音频，按账号确认价格生成" },
  models: PLATFORM_MODELS, auth: { type: "api_key" }, fetchMode: "per_task",
  usageSchema: {
    platform_credits: { type: "number", unit: "credit", description: { en: "Platform generation credit unit price", zh: "平台生成算力单价" } },
  },
  usageExamples: [{ label: "Confirmed platform quote", facts: { platform_credits: 1 } }],
  routes: [
    { method: "POST", path: "/v1/media/generations", type: "submit", decode: "decodeSubmit", render: "renderTask" },
    { method: "GET", path: "/v1/media/generations/:task_id", type: "query", render: "renderTask" },
  ],
};
function bodyOf(value) { return typeof value === "string" ? JSON.parse(value) : value; }
function request(ctx) {
  const input = ctx.requestBody || {};
  if (!input.model || !PLATFORM_MODELS.includes(input.model)) throw new Error("model_not_available");
  if (typeof input.authorization_max !== "number" || !Number.isFinite(input.authorization_max) || input.authorization_max <= 0 || input.authorization_max > 1000000) throw new Error("confirmed_quote_required");
  if (typeof input.authorization_token !== "string" || input.authorization_token.length > 3000 || !input.confirmed_price_book_id) throw new Error("confirmed_quote_required");
  return { model: input.model, prompt: input.prompt || "", params: input.params || {},
    authorization_token: input.authorization_token, authorization_max: input.authorization_max,
    confirmed_price_book_id: input.confirmed_price_book_id };
}
function platformState(data) {
  if (!data || !data.id || !["completed", "failed", "processing", "unknown"].includes(data.status)) throw new Error("invalid_platform_task_response");
  if (data.status === "completed" && data.billing && data.billing.state === "settled") return "SUCCESS";
  if (data.status === "failed" && data.billing && data.billing.state === "settled" && data.billing.charged === 0) return "FAILURE";
  return "IN_PROGRESS";
}
export function buildSubmitRequest(ctx) {
  return { method: "POST", url: ctx.baseUrl.replace(/\/+$/, "") + "/v1/media/generations",
    headers: { Authorization: ctx.authHeader, "Content-Type": "application/json", "Idempotency-Key": ctx.publicTaskId },
    body: request(ctx), responseType: "json" };
}
export function extractUsage(ctx) { return { platform_credits: request(ctx).authorization_max }; }
export function parseSubmitResponse(ctx, response) {
  const data = bodyOf(response.body);
  if (response.statusCode < 200 || response.statusCode >= 300 || !data || !data.id) throw new Error("platform_submission_not_accepted");
  const status = platformState(data);
  const saved = Object.assign({}, data, { request_fingerprint: ctx.platformRequestFingerprint || "" });
  // The host persists this projection; no request body, token or upstream URL is retained.
  return { taskId: data.id, taskData: saved, state: saved,
    immediate: status === "SUCCESS" ? { status: "SUCCESS", progress: "100%", url: "", data: saved } : undefined };
}
export function buildQueryRequest(ctx) {
  return { method: "GET", url: ctx.baseUrl.replace(/\/+$/, "") + "/v1/media/generations/" + encodeURIComponent(ctx.taskId),
    headers: { Authorization: ctx.authHeader }, responseType: "json" };
}
export function parseTaskResult(ctx, body) {
  const data = bodyOf(body); const status = platformState(data);
  return { taskId: ctx.taskId, status: status, progress: status === "SUCCESS" || status === "FAILURE" ? "100%" : "0%",
    reason: status === "FAILURE" ? "Generation failed; platform charge is zero" : "", state: Object.assign({}, data, { request_fingerprint: (ctx.state || ctx.data || {}).request_fingerprint || "" }) };
}
export function extractUsageOnSubmit(ctx, taskData) {
  const data = taskData || {};
  if (data.status === "completed" && data.billing && data.billing.state === "settled" && Number.isFinite(data.billing.charged) && data.billing.charged >= 0) return { platform_credits: data.billing.charged };
  return { platform_credits: request(ctx).authorization_max };
}
export function extractUsageOnComplete(ctx, result, raw) {
  const data = bodyOf(raw) || (ctx && ctx.data) || (result && result.data) || {};
  if (data.billing && data.billing.state === "settled" && Number.isFinite(data.billing.charged) && data.billing.charged >= 0) return { platform_credits: data.billing.charged };
  return {};
}
export function listArtifacts(task) {
  const data = task.data || {};
  if (String(task.status).toUpperCase() !== "SUCCESS") return [];
  const type = ["image", "video", "audio"].includes(data.modality) ? data.modality : "file";
  return [{ key: "result", type: type }];
}
export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "result") throw new Error("artifact_not_found");
  return { method: "GET", url: ctx.baseUrl.replace(/\/+$/, "") + "/v1/media/generations/" + encodeURIComponent(ctx.upstreamTaskId || ctx.taskId) + "/content",
    headers: { Authorization: ctx.authHeader } };
}
function renderTask(ctx, task) {
  const data = task.data || {};
  const status = { SUCCESS: "completed", FAILURE: "failed" }[String(task.status).toUpperCase()] || "processing";
  const artifacts = task.artifacts || [];
  return { id: task.task_id, object: "media.generation", model: task.model || data.model, modality: data.modality,
    status: status, billing: { currency: "CREDITS", state: status === "processing" ? "pending" : "settled" },
    result: status === "completed" ? { artifacts_url: "/v1/tasks/" + encodeURIComponent(task.task_id) + "/artifacts", artifacts: artifacts } : null,
    error: status === "failed" ? { code: "generation_failed", message: task.fail_reason || "Generation failed" } : null,
    poll_after_seconds: status === "processing" ? 3 : null };
}
export const native = {
  decodeSubmit: function(ctx) {
    if (!ctx.body || ctx.body.kind !== "json" || !ctx.body.value) throw new Error("json_body_required");
    return { kind: "submit", model: ctx.body.value.model, action: "GENERATE", requestBody: ctx.body.value };
  },
  renderTask: renderTask,
  error: function(ctx, err) { return { error: { code: err.code, message: err.message } }; },
};
