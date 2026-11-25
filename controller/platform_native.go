// Copyright (C) 2026 QuantumNous and contributors. Licensed under AGPL-3.0-or-later.
// Modified for platform-native reference uploads, voice cloning, usage, model pricing and feedback on the portal.
package controller

import (
	"bytes"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// platformVoiceModel is the platform model whose key policy governs voice
// cloning and activation (server/public-api/publicVoiceRoutes.js).
const platformVoiceModel = "speech-2.8"

// Request ceilings mirror the platform: /v1/upload admits 110 MiB of files plus
// 2 MiB of multipart framing; the reference uploads take one 2 MiB image or one
// 50 MiB video, allowed 1 MiB of framing. The platform still enforces each file.
var platformUploadLimits = map[string]int64{
	"/v1/upload":         112 << 20,
	"/v1/uploads/images": 3 << 20,
	"/v1/uploads/videos": 51 << 20,
}

// Large uploads are bounded by the client's connection, not a total deadline;
// the request context ends with the client. The header timeout starts only
// after the whole body is sent and matches the main site's 600 s portal proxy;
// it also covers a voice clone, which waits up to 180 s for its upstream.
var platformNativeClient = func() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 10 * time.Minute
	return &http.Client{Transport: transport,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
}()

func abortPlatformRelay(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}

// relayPlatformRequest forwards one end-user request to the same platform path
// with the portal service key and the user's relay identity. The platform owns
// storage, review, prices, idempotency and the wallet; a user without a platform
// OAuth binding is refused instead of falling back to the service account.
func relayPlatformRequest(c *gin.Context, path string, body io.Reader, size int64, contentType, keyModel, unknown string) {
	origin, ok := common.PlatformPortalOrigin(c.Request)
	if !ok {
		abortPlatformRelay(c, http.StatusServiceUnavailable, "platform_unavailable", "Platform gateway is not configured")
		return
	}
	identity, err := service.PlatformRelayIdentityHeaders(c.GetInt("id"))
	if err != nil {
		abortPlatformRelay(c, http.StatusForbidden, "platform_account_required", "Sign in with your platform account to continue")
		return
	}
	keyContext := ""
	if keyModel != "" {
		keyContext, err = service.PlatformKeyRoutingHeader(c.GetInt("id"), c.GetInt("token_id"), keyModel)
		if err != nil {
			abortPlatformRelay(c, http.StatusForbidden, "key_model_forbidden", err.Error())
			return
		}
	}
	key, err := platformPortalServiceKey()
	if err != nil {
		abortPlatformRelay(c, http.StatusServiceUnavailable, "platform_unavailable", "Platform gateway is not ready")
		return
	}
	request, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, origin+path, body)
	if err != nil {
		abortPlatformRelay(c, http.StatusServiceUnavailable, "platform_unavailable", "Platform request is unavailable")
		return
	}
	// A streamed body keeps the caller's exact length; the platform requires it.
	request.ContentLength = size
	request.Header.Set("Accept", "application/json")
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if idempotencyKey := c.GetHeader("Idempotency-Key"); idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}
	for name, value := range identity {
		request.Header.Set(name, value)
	}
	if keyContext != "" {
		request.Header.Set(service.PlatformKeyContextHeader, keyContext)
	}
	request.Header.Set("Authorization", "Bearer "+key)
	response, err := platformNativeClient.Do(request)
	if err != nil {
		abortPlatformRelay(c, http.StatusServiceUnavailable, "platform_result_unknown", unknown)
		return
	}
	defer response.Body.Close()
	if err := copyPlatformJSONResponse(c, response); err != nil {
		abortPlatformRelay(c, http.StatusServiceUnavailable, "platform_response_invalid", "Invalid platform response")
	}
}

// PostPlatformUpload streams one multipart upload to the platform path of the
// same name. The body is never buffered here; its declared size is checked
// against the platform ceiling before any byte reaches the platform.
func PostPlatformUpload(c *gin.Context) {
	path := c.FullPath()
	limit, ok := platformUploadLimits[path]
	if !ok {
		abortPlatformRelay(c, http.StatusNotFound, "not_found", "Not found")
		return
	}
	mediaType, params, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "multipart/form-data" || params["boundary"] == "" {
		abortPlatformRelay(c, http.StatusBadRequest, "invalid_request_error", "Upload files with multipart/form-data")
		return
	}
	if encoding := c.GetHeader("Content-Encoding"); encoding != "" && !strings.EqualFold(encoding, "identity") {
		abortPlatformRelay(c, http.StatusUnsupportedMediaType, "unsupported_content_encoding", "Send uploads without Content-Encoding")
		return
	}
	if c.Request.ContentLength < 0 {
		abortPlatformRelay(c, http.StatusLengthRequired, "length_required", "Uploads must declare Content-Length")
		return
	}
	if c.Request.ContentLength == 0 {
		abortPlatformRelay(c, http.StatusBadRequest, "invalid_request_error", "Upload body is empty")
		return
	}
	if c.Request.ContentLength > limit {
		abortPlatformRelay(c, http.StatusRequestEntityTooLarge, "payload_too_large",
			"Upload exceeds the platform limit for "+path)
		return
	}
	relayPlatformRequest(c, path, c.Request.Body, c.Request.ContentLength, c.GetHeader("Content-Type"), "",
		"Upload result is unknown; retry the upload")
}

// PlatformVoice relays voice listing, cloning and activation. Clone and the
// activation endpoints carry the key's speech-2.8 policy exactly where the
// platform resolves it; listing and reading an owned voice do not need one.
func PlatformVoice(c *gin.Context) {
	route := c.FullPath()
	// A dot segment would let the forwarded path leave the voice resource.
	if id := c.Param("voice_id"); id == "." || id == ".." {
		abortPlatformRelay(c, http.StatusNotFound, "not_found", "Voice not found")
		return
	}
	path := strings.Replace(route, ":voice_id", url.PathEscape(c.Param("voice_id")), 1)
	keyModel := ""
	if route == "/v1/voices/clone" || strings.Contains(route, "/activation") {
		keyModel = platformVoiceModel
	}
	if route == "/v1/voices" {
		if model := c.Query("model"); model != "" {
			path += "?" + url.Values{"model": {model}}.Encode()
		}
	}
	var body io.Reader
	size, contentType := int64(0), ""
	if c.Request.Method == http.MethodPost {
		data, err := io.ReadAll(io.LimitReader(c.Request.Body, (1<<20)+1))
		if err != nil || len(data) > 1<<20 {
			abortPlatformRelay(c, http.StatusRequestEntityTooLarge, "payload_too_large", "Request is too large")
			return
		}
		var payload map[string]any
		if common.Unmarshal(data, &payload) != nil {
			abortPlatformRelay(c, http.StatusBadRequest, "invalid_request_error", "JSON object required")
			return
		}
		body, size, contentType = bytes.NewReader(data), int64(len(data)), "application/json"
	}
	relayPlatformRequest(c, path, body, size, contentType, keyModel,
		"Platform request result is unknown; retry with the same Idempotency-Key or query the original voice")
}

// platformUsageQuery lists the filters GET /v1/usage reads on the platform
// (server/public-api/publicApiUsage.js); nothing else crosses the relay.
var platformUsageQuery = []string{"days", "start_time", "end_time", "scope", "detail", "model", "limit", "offset"}

// PlatformUsage relays GET /v1/usage and GET /v1/usage/:task_id. The platform
// answers for the relayed end user; through the shared service key its
// scope=key covers all of that user's portal calls.
func PlatformUsage(c *gin.Context) {
	path := "/v1/usage"
	if c.FullPath() == "/v1/usage/:task_id" {
		id := c.Param("task_id")
		if id == "." || id == ".." {
			abortPlatformRelay(c, http.StatusNotFound, "not_found", "Task not found")
			return
		}
		path += "/" + url.PathEscape(id)
	} else {
		query := url.Values{}
		for _, name := range platformUsageQuery {
			if value, ok := c.GetQuery(name); ok {
				query.Set(name, value)
			}
		}
		if len(query) > 0 {
			path += "?" + query.Encode()
		}
	}
	relayPlatformRequest(c, path, nil, 0, "", "", "Platform usage lookup failed; retry")
}

// PlatformModelPricing relays GET /v1/models/{model}/pricing. It is served by
// the /v1/models/:model/*rest catch-all so that a model ID sent with %2F keeps
// its slash, as on the platform. The key's policy for that model marks which
// routes this key may use.
func PlatformModelPricing(c *gin.Context) {
	rest, ok := strings.CutSuffix(c.Param("rest"), "/pricing")
	name := c.Param("model") + rest
	if !ok || name == "." || name == ".." || strings.Contains(name, "//") {
		RelayNotFound(c)
		return
	}
	relayPlatformRequest(c, "/v1/models/"+url.PathEscape(name)+"/pricing", nil, 0, "", name,
		"Platform pricing lookup failed; retry")
}

// PlatformFeedback relays GET and POST /v1/feedback; the platform files the
// feedback under the relayed end user and applies its hourly limit.
func PlatformFeedback(c *gin.Context) {
	if c.Request.Method != http.MethodPost {
		relayPlatformRequest(c, "/v1/feedback", nil, 0, "", "", "Platform feedback lookup failed; retry")
		return
	}
	data, err := io.ReadAll(io.LimitReader(c.Request.Body, (64<<10)+1))
	if err != nil || len(data) > 64<<10 {
		abortPlatformRelay(c, http.StatusRequestEntityTooLarge, "payload_too_large", "Request is too large")
		return
	}
	var payload map[string]any
	if common.Unmarshal(data, &payload) != nil {
		abortPlatformRelay(c, http.StatusBadRequest, "invalid_request_error", "JSON object required")
		return
	}
	relayPlatformRequest(c, "/v1/feedback", bytes.NewReader(data), int64(len(data)), "application/json", "",
		"Feedback result is unknown; check GET /v1/feedback before sending it again")
}
