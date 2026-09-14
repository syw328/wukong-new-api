package controller

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

var platformInsightsClient = &http.Client{
	Timeout:       10 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
}

// The admin-owned origin is synchronized by newapi-sync. No credentials or user
// headers are forwarded, and no request parameter can select an upstream URL.
func proxyPlatformInsights(c *gin.Context, resource string) bool {
	common.OptionMapRWMutex.RLock()
	base := strings.TrimRight(common.OptionMap["PlatformPublicBaseURL"], "/")
	common.OptionMapRWMutex.RUnlock()
	if portal, ok := common.PlatformPortalForRequest(c.Request); ok {
		base = portal.Origin
	}
	if base == "" {
		return false
	}
	u, err := url.Parse(base)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Hostname() == "" ||
		(u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"))) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Platform statistics origin is not configured correctly"})
		return true
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/api/developer/observability/" + resource
	query := url.Values{}
	for _, key := range []string{"model", "period", "metric", "category", "hours"} {
		value := c.Query(key)
		if len(value) > 160 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid statistics query"})
			return true
		}
		if value != "" {
			query.Set(key, value)
		}
	}
	u.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, u.String(), nil)
	if err == nil {
		req.Header.Set("Accept", "application/json")
	}
	var response *http.Response
	if err == nil {
		response, err = platformInsightsClient.Do(req)
	}
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "Platform statistics are temporarily unavailable. Please retry."})
		return true
	}
	defer response.Body.Close()
	const maxBytes = 4 << 20
	body, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	var payload map[string]any
	if err != nil || len(body) > maxBytes || common.Unmarshal(body, &payload) != nil || response.StatusCode != http.StatusOK || payload["success"] != true {
		status := http.StatusServiceUnavailable
		if response.StatusCode == 400 || response.StatusCode == 404 {
			status = response.StatusCode
		}
		c.JSON(status, gin.H{"success": false, "message": "Platform statistics could not be loaded. Please check the model and filters, then retry."})
		return true
	}
	c.Header("Cache-Control", "public, max-age=30")
	c.Data(http.StatusOK, "application/json; charset=utf-8", body)
	return true
}

func GetPlatformModelInsights(c *gin.Context) {
	if proxyPlatformInsights(c, "detail") {
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": nil})
}
