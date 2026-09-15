// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package middleware

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type platformMediaLock struct {
	mu   sync.Mutex
	refs int
}

var platformMediaLocks = struct {
	sync.Mutex
	entries map[string]*platformMediaLock
}{entries: make(map[string]*platformMediaLock)}
var platformMediaIdempotencyKey = regexp.MustCompile(`^[A-Za-z0-9_.:-]{8,160}$`)

// Each tenant portal is a single process. Serialize identical submissions here;
// a deterministic task ID is also the platform's durable billing idempotency key.
// The platform remains idempotent across a portal restart or an uncertain reply.
func PlatformMediaIdempotency() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodPost || (c.Request.URL.Path != "/v1/media/generations" && c.Request.URL.Path != "/v1/tasks/platform-media") {
			c.Next()
			return
		}
		key := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
		if !platformMediaIdempotencyKey.MatchString(key) {
			c.AbortWithStatusJSON(400, gin.H{"error": gin.H{"code": "idempotency_key_required", "message": "Provide an 8-160 character Idempotency-Key"}})
			return
		}
		body, err := io.ReadAll(io.LimitReader(c.Request.Body, (1<<20)+1))
		if err != nil || len(body) > 1<<20 {
			c.AbortWithStatusJSON(413, gin.H{"error": gin.H{"code": "request_too_large"}})
			return
		}
		var input map[string]any
		if common.Unmarshal(body, &input) != nil {
			c.AbortWithStatusJSON(400, gin.H{"error": gin.H{"code": "invalid_json"}})
			return
		}
		normalized, err := common.Marshal(input)
		if err != nil {
			c.AbortWithStatusJSON(400, gin.H{"error": gin.H{"code": "invalid_json"}})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(body))
		identity := fmt.Sprintf("%d:%s", c.GetInt("id"), key)
		hash := sha256.Sum256([]byte(identity))
		taskID := fmt.Sprintf("task_%x", hash[:16])
		fingerprint := fmt.Sprintf("%x", sha256.Sum256(normalized))
		platformMediaLocks.Lock()
		entry := platformMediaLocks.entries[taskID]
		if entry == nil {
			if len(platformMediaLocks.entries) >= 10000 {
				platformMediaLocks.Unlock()
				c.AbortWithStatus(429)
				return
			}
			entry = &platformMediaLock{}
			platformMediaLocks.entries[taskID] = entry
		}
		entry.refs++
		platformMediaLocks.Unlock()
		entry.mu.Lock()
		defer func() {
			entry.mu.Unlock()
			platformMediaLocks.Lock()
			entry.refs--
			if entry.refs == 0 {
				delete(platformMediaLocks.entries, taskID)
			}
			platformMediaLocks.Unlock()
		}()
		previous, exists, err := model.GetByTaskId(c.GetInt("id"), taskID)
		if err != nil {
			c.AbortWithStatusJSON(503, gin.H{"error": gin.H{"code": "idempotency_unavailable"}})
			return
		}
		if exists {
			var data map[string]any
			if previous.GetData(&data) != nil {
				data = nil
			}
			if data["request_fingerprint"] != fingerprint && len(previous.PrivateData.PluginState) > 0 {
				_ = common.Unmarshal(previous.PrivateData.PluginState, &data)
			}
			if data["request_fingerprint"] != fingerprint {
				c.AbortWithStatusJSON(409, gin.H{"error": gin.H{"code": "idempotency_conflict", "message": "This key belongs to a different request"}})
				return
			}
			status := "processing"
			if previous.Status == model.TaskStatusSuccess {
				status = "completed"
			}
			if previous.Status == model.TaskStatusFailure {
				status = "failed"
			}
			c.AbortWithStatusJSON(200, gin.H{"id": taskID, "object": "media.generation", "status": status,
				"replayed": true, "task_url": "/v1/media/generations/" + taskID})
			return
		}
		c.Set("platform_media_public_task_id", taskID)
		c.Set("platform_media_request_fingerprint", fingerprint)
		c.Next()
	}
}
