package controller

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlatformInsightsProxy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/developer/observability/detail", r.URL.Path)
		assert.Equal(t, "model-one", r.URL.Query().Get("model"))
		assert.Empty(t, r.Header.Get("Authorization"))
		assert.Empty(t, r.Header.Get("Cookie"))
		assert.Empty(t, r.URL.Query().Get("url"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"routes":[]}}`))
	}))
	t.Cleanup(upstream.Close)
	common.OptionMapRWMutex.Lock()
	previous := common.OptionMap
	common.OptionMap = map[string]string{"PlatformPublicBaseURL": upstream.URL}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() { common.OptionMapRWMutex.Lock(); common.OptionMap = previous; common.OptionMapRWMutex.Unlock() })
	router := gin.New()
	router.GET("/detail", GetPlatformModelInsights)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/detail?model=model-one&url=https://example.com", nil)
	req.Header.Set("Authorization", "Bearer private-test-token")
	req.Header.Set("Cookie", "session=private-test-session")
	router.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `{"success":true,"data":{"routes":[]}}`, w.Body.String())
}

func TestPlatformInsightsRejectsRedirectAndUnavailableData(t *testing.T) {
	for _, status := range []int{http.StatusFound, http.StatusInternalServerError} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Location", "https://example.com")
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"success":false,"secret":"must-not-leak"}`))
			}))
			defer upstream.Close()
			common.OptionMapRWMutex.Lock()
			previous := common.OptionMap
			common.OptionMap = map[string]string{"PlatformPublicBaseURL": upstream.URL}
			common.OptionMapRWMutex.Unlock()
			defer func() { common.OptionMapRWMutex.Lock(); common.OptionMap = previous; common.OptionMapRWMutex.Unlock() }()
			router := gin.New()
			router.GET("/detail", GetPlatformModelInsights)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/detail?model=one", nil))
			assert.Equal(t, http.StatusServiceUnavailable, w.Code)
			assert.NotContains(t, w.Body.String(), "must-not-leak")
		})
	}
}

func TestPlatformFullCatalogAndAnonymousPrices(t *testing.T) {
	gin.SetMode(gin.TestMode)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Empty(t, r.Header.Get("Cookie"))
		assert.Empty(t, r.Header.Get("Authorization"))
		assert.Empty(t, r.Header.Get("X-Platform-User-Id"))
		if r.Method == http.MethodPost {
			assert.Equal(t, "/api/developer/model-prices", r.URL.Path)
			_, _ = w.Write([]byte(`{"success":true,"data":{"audience":"site","routes":[]}}`))
		} else {
			assert.Equal(t, "/api/developer/platform-catalog", r.URL.Path)
			_, _ = w.Write([]byte(`{"success":true,"data":{"models":[{"id":"image-test","type":"image"}]}}`))
		}
	}))
	t.Cleanup(upstream.Close)
	common.OptionMapRWMutex.Lock()
	previous := common.OptionMap
	common.OptionMap = map[string]string{"PlatformPublicBaseURL": upstream.URL}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() { common.OptionMapRWMutex.Lock(); common.OptionMap = previous; common.OptionMapRWMutex.Unlock() })
	router := gin.New()
	router.GET("/catalog", GetPlatformCatalog)
	router.POST("/prices", PostPlatformModelPrices)
	for _, path := range []string{"/catalog", "/prices"} {
		method := http.MethodGet
		var body io.Reader
		if path == "/prices" {
			method = http.MethodPost
			body = strings.NewReader(`{"model":"image-test","selections":{}}`)
		}
		req := httptest.NewRequest(method, path, body)
		req.Header.Set("Cookie", "session=not-forwarded")
		req.Header.Set("X-Platform-User-Id", "forged")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		assert.Equal(t, 200, w.Code)
		assert.Equal(t, "private, no-store", w.Header().Get("Cache-Control"))
	}
}
