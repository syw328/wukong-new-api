// Copyright (C) 2026 QuantumNous and contributors. Licensed under AGPL-3.0-or-later.
// Modified for tenant-scoped catalog, account prices and media quotes.
package controller

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/plugins"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/gin-gonic/gin"
)

var platformPortalClient = &http.Client{Timeout: 90 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}

func platformPortalOrigin(c *gin.Context) (string, bool) {
	common.OptionMapRWMutex.RLock()
	base := strings.TrimRight(common.OptionMap["PlatformPublicBaseURL"], "/")
	common.OptionMapRWMutex.RUnlock()
	if portal, ok := common.PlatformPortalForRequest(c.Request); ok {
		base = portal.Origin
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Hostname() == "" || parsed.Path != "" ||
		(parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost"))) {
		return "", false
	}
	return base, true
}

func proxyPlatformPortal(c *gin.Context, path string, accountPrice bool, mediaQuote bool) {
	origin, ok := platformPortalOrigin(c)
	if !ok {
		c.JSON(503, gin.H{"success": false, "message": "Platform catalog is not configured"})
		return
	}
	var body []byte
	var err error
	if c.Request.Method == http.MethodPost {
		body, err = io.ReadAll(io.LimitReader(c.Request.Body, (1<<20)+1))
		if err != nil || len(body) > 1<<20 {
			c.JSON(413, gin.H{"success": false, "message": "Request is too large"})
			return
		}
		var payload map[string]any
		if common.Unmarshal(body, &payload) != nil {
			c.JSON(400, gin.H{"success": false, "message": "JSON object required"})
			return
		}
		if mediaQuote && c.GetBool("token_model_limit_enabled") {
			limits, valid := c.Get("token_model_limit")
			allowed, typed := limits.(map[string]bool)
			name, named := payload["model"].(string)
			if !valid || !typed || !named || !allowed[name] {
				c.JSON(403, gin.H{"success": false, "message": "This token does not allow the requested model"})
				return
			}
		}
	}
	request, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, origin+path, bytes.NewReader(body))
	if err != nil {
		c.JSON(503, gin.H{"success": false, "message": "Platform request is unavailable"})
		return
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	if (accountPrice && c.GetInt("id") > 0) || mediaQuote {
		headers, identityErr := channel.PlatformRelayIdentityHeaders(c.GetInt("id"))
		if identityErr != nil {
			c.JSON(403, gin.H{"success": false, "message": "Sign in with your platform account to continue"})
			return
		}
		for name, value := range headers {
			request.Header.Set(name, value)
		}
	}
	if mediaQuote {
		gateway, readErr := model.GetChannelById(1, true)
		if readErr != nil || gateway == nil || gateway.Status != 1 {
			c.JSON(503, gin.H{"success": false, "message": "Platform gateway is not ready"})
			return
		}
		key, _, keyErr := gateway.GetNextEnabledKey()
		if keyErr != nil || key == "" {
			c.JSON(503, gin.H{"success": false, "message": "Platform gateway is not ready"})
			return
		}
		request.Header.Set("Authorization", "Bearer "+key)
	}
	response, err := platformPortalClient.Do(request)
	if err != nil {
		c.JSON(503, gin.H{"success": false, "message": "Unable to load platform data; retry the read request"})
		return
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, (8<<20)+1))
	var payload map[string]any
	if err != nil || len(data) > 8<<20 || common.Unmarshal(data, &payload) != nil || response.StatusCode >= 300 && response.StatusCode < 400 {
		c.JSON(503, gin.H{"success": false, "message": "Invalid platform response"})
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("Vary", "Cookie, Authorization, Host")
	c.Data(response.StatusCode, "application/json; charset=utf-8", data)
}

func GetPlatformCatalog(c *gin.Context) {
	proxyPlatformPortal(c, "/api/developer/platform-catalog", false, false)
}
func PostPlatformModelPrices(c *gin.Context) {
	proxyPlatformPortal(c, "/api/developer/model-prices", true, false)
}
func PostPlatformMediaQuote(c *gin.Context) { proxyPlatformPortal(c, "/v1/media/quotes", false, true) }
func GetPlatformMediaTemplate(c *gin.Context) {
	source, err := plugins.Source("platform-media")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"source": source})
}
