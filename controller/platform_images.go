// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package controller

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/gin-gonic/gin"
)

var platformImageIdempotencyKey = regexp.MustCompile(`^[A-Za-z0-9_.:-]{8,160}$`)

// PlatformImagesCompatibility adapts OpenAI's synchronous image response to the
// existing authenticated task API. It owns neither billing nor upstream calls.
// The normal image relay remains available for models outside platform-media.
func PlatformImagesCompatibility(router http.Handler) gin.HandlerFunc {
	return func(c *gin.Context) {
		plugin, enabled := pluginruntime.DefaultRegistry.Get("platform-media")
		if !enabled {
			c.Next()
			return
		}
		body, err := io.ReadAll(io.LimitReader(c.Request.Body, (1<<20)+1))
		if err != nil || len(body) > 1<<20 {
			c.AbortWithStatusJSON(413, gin.H{"error": gin.H{"code": "request_too_large", "message": "Image request exceeds 1 MiB"}})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		var input map[string]any
		if common.Unmarshal(body, &input) != nil || input == nil {
			c.Next()
			return
		}
		name, ok := input["model"].(string)
		if !ok || !slices.Contains(plugin.Meta.Models, "platform-media:"+name) {
			c.Next()
			return
		}
		// Abort the synchronous distributor even when the adapter fails validation.
		defer c.Abort()
		if c.GetBool("token_model_limit_enabled") {
			limits, present := c.Get("token_model_limit")
			allowed, typed := limits.(map[string]bool)
			if !present || !typed || !allowed[name] {
				c.JSON(403, gin.H{"error": gin.H{"code": "model_access_denied", "message": "This token does not allow the requested image model"}})
				return
			}
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Minute)
		defer cancel()
		bridge := platformImageBridge{router: router, request: c.Request.WithContext(ctx)}
		key := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
		if key == "" {
			key = "image-" + common.GetUUID()
		}
		if !platformImageIdempotencyKey.MatchString(key) {
			bridge.fail(c, 400, "invalid_idempotency_key", "Provide an 8-160 character Idempotency-Key", "")
			return
		}
		c.Header("Idempotency-Key", key)
		c.Header("Cache-Control", "private, no-store")
		normalized, err := common.Marshal(input)
		if err != nil {
			bridge.fail(c, 400, "invalid_request_error", "Invalid image request", "")
			return
		}
		fingerprint := fmt.Sprintf("%x", sha256.Sum256(normalized))
		taskID := middleware.PlatformMediaTaskID(c.GetInt("id"), key)
		previous, exists, err := model.GetByTaskId(c.GetInt("id"), taskID)
		if err != nil {
			bridge.fail(c, 503, "idempotency_unavailable", "Unable to read the original image request", "")
			return
		}
		format := "b64_json"
		if input["response_format"] == "url" {
			format = "url"
		}
		if exists {
			var saved map[string]any
			_ = previous.GetData(&saved)
			if saved["request_fingerprint"] != fingerprint && len(previous.PrivateData.PluginState) > 0 {
				_ = common.Unmarshal(previous.PrivateData.PluginState, &saved)
			}
			if saved["request_fingerprint"] != fingerprint {
				bridge.fail(c, 409, "idempotency_conflict", "This key belongs to a different image request", "")
				return
			}
			c.Header("Idempotent-Replayed", "true")
		} else {
			if _, configured := common.PlatformPortalOrigin(c.Request); !configured {
				bridge.fail(c, 503, "platform_unavailable", "The platform image service is not configured", "")
				return
			}
			catalog, err := bridge.call(http.MethodGet, "/api/platform-catalog", nil, "", "", 8<<20)
			if err != nil {
				bridge.fail(c, 502, "catalog_unavailable", "Unable to read the image catalog", "")
				return
			}
			if catalog.status != http.StatusOK {
				bridge.forwardError(c, catalog, "")
				return
			}
			var published struct {
				Success bool `json:"success"`
				Data    struct {
					Models []platformImageModel `json:"models"`
				} `json:"data"`
			}
			if common.Unmarshal(catalog.body.Bytes(), &published) != nil || !published.Success {
				bridge.fail(c, 502, "catalog_unavailable", "Invalid image catalog", "")
				return
			}
			index := slices.IndexFunc(published.Data.Models, func(item platformImageModel) bool { return item.ID == name })
			if index < 0 {
				bridge.fail(c, 400, "model_not_found", "This image model is unavailable on the current site", "")
				return
			}
			params, selectedFormat, err := platformImageParameters(input, published.Data.Models[index])
			if err != nil {
				bridge.fail(c, 400, "invalid_request_error", err.Error(), "")
				return
			}
			format = selectedFormat
			native := map[string]any{"model": name, "prompt": input["prompt"], "params": params}
			quote, err := bridge.call(http.MethodPost, "/v1/media/quotes", native, "", "", 1<<20)
			if err != nil {
				bridge.fail(c, 502, "quote_unavailable", "Unable to price the image request", "")
				return
			}
			if quote.status != http.StatusOK {
				bridge.forwardError(c, quote, "")
				return
			}
			var authorization map[string]any
			if common.Unmarshal(quote.body.Bytes(), &authorization) != nil {
				bridge.fail(c, 502, "quote_unavailable", "Invalid image quote", "")
				return
			}
			for _, field := range []string{"authorization_token", "authorization_max", "confirmed_price_book_id"} {
				if authorization[field] == nil {
					bridge.fail(c, 502, "quote_unavailable", "Incomplete image quote", "")
					return
				}
				native[field] = authorization[field]
			}
			// One submission only. A read error retains this deterministic task ID;
			// retries with the same key recover through native durable idempotency.
			created, err := bridge.call(http.MethodPost, "/v1/media/generations", native, key, fingerprint, 1<<20)
			if err != nil {
				bridge.fail(c, 504, "image_submission_unknown", "Query the original task or retry with the same Idempotency-Key", taskID)
				return
			}
			if created.status != http.StatusOK {
				bridge.forwardError(c, created, taskID)
				return
			}
			var accepted struct {
				ID string `json:"id"`
			}
			if common.Unmarshal(created.body.Bytes(), &accepted) != nil || accepted.ID != taskID {
				bridge.fail(c, 502, "image_submission_unknown", "Query the original task before submitting another image", taskID)
				return
			}
		}
		c.Header("X-Task-Id", taskID)
		c.Header("Location", "/v1/media/generations/"+taskID)
		for {
			status, err := bridge.call(http.MethodGet, "/v1/media/generations/"+taskID, nil, "", "", 1<<20)
			if err != nil {
				bridge.fail(c, 504, "image_generation_pending", "Query the original task; do not create another image request", taskID)
				return
			}
			if status.status != http.StatusOK {
				bridge.forwardError(c, status, taskID)
				return
			}
			var task struct {
				Status string `json:"status"`
			}
			if common.Unmarshal(status.body.Bytes(), &task) != nil {
				bridge.fail(c, 502, "invalid_task_response", "Query the original task before retrying", taskID)
				return
			}
			if task.Status == "completed" {
				bridge.result(c, taskID, format)
				return
			}
			if task.Status == "failed" {
				bridge.fail(c, 502, "image_generation_failed", "Image generation failed; check the original task and billing record before retrying", taskID)
				return
			}
			if task.Status != "processing" && task.Status != "unknown" {
				bridge.fail(c, 502, "invalid_task_response", "Query the original task before retrying", taskID)
				return
			}
			select {
			case <-ctx.Done():
				bridge.fail(c, 504, "image_generation_pending", "The image task is still pending; reuse its task ID and Idempotency-Key", taskID)
				return
			case <-time.After(3 * time.Second):
			}
		}
	}
}

type platformImageBridge struct {
	router  http.Handler
	request *http.Request
}

// Dispatch in-process to fixed native routes. User credentials never leave this
// gateway, while authentication, ownership, billing and artifact checks run as
// they do for an ordinary media API client.
func (bridge platformImageBridge) call(method, path string, body any, key, fingerprint string, maximum int) (*platformImageResponse, error) {
	if err := bridge.request.Context().Err(); err != nil {
		return nil, err
	}
	var data []byte
	var err error
	if body != nil {
		data, err = common.Marshal(body)
		if err != nil {
			return nil, err
		}
	}
	request := bridge.request.Clone(middleware.PlatformImageRequestContext(bridge.request.Context(), fingerprint))
	request.Method = method
	request.URL = &url.URL{Path: path}
	request.RequestURI = path
	request.Body = io.NopCloser(bytes.NewReader(data))
	request.GetBody = nil
	request.ContentLength = int64(len(data))
	request.TransferEncoding = nil
	for _, name := range []string{"Content-Encoding", "Accept-Encoding", "Idempotency-Key", "Content-Length"} {
		request.Header.Del(name)
	}
	request.Header.Set("Content-Type", "application/json")
	if key != "" {
		request.Header.Set("Idempotency-Key", key)
	}
	response := &platformImageResponse{headers: make(http.Header), maximum: maximum}
	bridge.router.ServeHTTP(response, request)
	// Cancellation can make a native presenter return an error after its task
	// was durably accepted. Keep that outcome pending, rather than a new failure.
	if err := request.Context().Err(); err != nil {
		return nil, err
	}
	if response.err != nil {
		return nil, response.err
	}
	if response.status == 0 {
		response.status = http.StatusOK
	}
	return response, nil
}

func (bridge platformImageBridge) result(c *gin.Context, taskID, format string) {
	artifacts, err := bridge.call(http.MethodGet, "/v1/tasks/"+taskID+"/artifacts", nil, "", "", 1<<20)
	if err != nil {
		bridge.fail(c, 502, "artifact_unavailable", "The image task completed; retry the same request to retrieve its image", taskID)
		return
	}
	if artifacts.status != http.StatusOK {
		bridge.forwardError(c, artifacts, taskID)
		return
	}
	var result struct {
		Artifacts []taskArtifactResponse `json:"artifacts"`
	}
	if common.Unmarshal(artifacts.body.Bytes(), &result) != nil || len(result.Artifacts) != 1 || result.Artifacts[0].Type != "image" {
		bridge.fail(c, 502, "artifact_unavailable", "The image task did not return an image artifact", taskID)
		return
	}
	image := result.Artifacts[0]
	if image.ContentURL == "" {
		bridge.fail(c, 502, "artifact_unavailable", "The completed image has no artifact content URL", taskID)
		return
	}
	item := gin.H{}
	if format == "url" {
		item["url"] = image.ContentURL
	} else {
		content, err := bridge.call(http.MethodGet, "/v1/tasks/"+taskID+"/artifacts/"+url.PathEscape(image.Key)+"/content", nil, "", "", 32<<20)
		if err != nil {
			bridge.fail(c, 502, "artifact_unavailable", "The task completed; retry the same request to retrieve its image", taskID)
			return
		}
		if content.status != http.StatusOK {
			bridge.forwardError(c, content, taskID)
			return
		}
		if content.body.Len() == 0 || !strings.HasPrefix(content.headers.Get("Content-Type"), "image/") {
			bridge.fail(c, 502, "artifact_unavailable", "The completed task did not return image content", taskID)
			return
		}
		item["b64_json"] = base64.StdEncoding.EncodeToString(content.body.Bytes())
	}
	c.JSON(http.StatusOK, gin.H{"created": time.Now().Unix(), "data": []gin.H{item}})
}

func (bridge platformImageBridge) fail(c *gin.Context, status int, code, message, taskID string) {
	errorBody := gin.H{"code": code, "type": "new_api_error", "message": message}
	if taskID != "" {
		errorBody["task_id"] = taskID
		errorBody["task_url"] = "/v1/media/generations/" + taskID
		c.Header("X-Task-Id", taskID)
	}
	c.JSON(status, gin.H{"error": errorBody})
}

func (bridge platformImageBridge) forwardError(c *gin.Context, response *platformImageResponse, taskID string) {
	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = common.Unmarshal(response.body.Bytes(), &payload)
	code, message := payload.Error.Code, payload.Error.Message
	if code == "" {
		code = "image_request_failed"
	}
	if message == "" {
		message = "The native image request failed; retry with the same Idempotency-Key if a task was accepted"
	}
	bridge.fail(c, response.status, code, message, taskID)
}

type platformImageResponse struct {
	headers http.Header
	body    bytes.Buffer
	status  int
	maximum int
	err     error
}

func (response *platformImageResponse) Header() http.Header { return response.headers }
func (response *platformImageResponse) WriteHeader(status int) {
	if response.status == 0 {
		response.status = status
	}
}
func (response *platformImageResponse) Write(data []byte) (int, error) {
	if response.body.Len()+len(data) > response.maximum {
		response.err = fmt.Errorf("native image response exceeds the size limit")
		return 0, response.err
	}
	response.WriteHeader(http.StatusOK)
	return response.body.Write(data)
}
func (response *platformImageResponse) Flush() { response.WriteHeader(http.StatusOK) }
