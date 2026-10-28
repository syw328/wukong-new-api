// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package controller

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func tokenRoutingCatalogFixture(t *testing.T, db *gorm.DB) *bool {
	t.Helper()
	t.Setenv("PLATFORM_RELAY_SECRET", strings.Repeat("r", 40))
	t.Setenv("PLATFORM_RELAY_OAUTH_PROVIDER_ID", "42")
	require.NoError(t, db.AutoMigrate(&model.UserOAuthBinding{}))
	require.NoError(t, db.Create(&model.UserOAuthBinding{UserId: 71, ProviderId: 42, ProviderUserId: "owned-platform-user"}).Error)
	t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&model.UserOAuthBinding{})) })
	accept := true
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/developer/routing-options", r.URL.Path)
		assert.Equal(t, "owned-platform-user", r.Header.Get("X-Platform-User-Id"))
		assert.Empty(t, r.Header.Get("Cookie"))
		assert.Empty(t, r.Header.Get("Authorization"))
		if r.Method == http.MethodGet {
			assert.Equal(t, "gpt-image-2", r.URL.Query().Get("model"))
			_, _ = w.Write([]byte(`{"success":true,"data":{"routes":[]}}`))
			return
		}
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		assert.NotContains(t, string(body), "routing-fresh-key")
		if !accept {
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"success":false}`))
			return
		}
		_, _ = w.Write([]byte(`{"success":true,"data":{"valid":true}}`))
	}))
	t.Cleanup(upstream.Close)
	common.OptionMapRWMutex.Lock()
	previous := common.OptionMap
	common.OptionMap = map[string]string{"PlatformPublicBaseURL": upstream.URL}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() { common.OptionMapRWMutex.Lock(); common.OptionMap = previous; common.OptionMapRWMutex.Unlock() })
	return &accept
}

func TestTokenRouteSelectionCatalogFailureIsAtomic(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	allowed := tokenRoutingCatalogFixture(t, db)
	token := seedToken(t, db, 71, "routes", "routing-fresh-key")
	policy := model.TokenRoutingPolicy{Version: 2, Mode: "custom", DefaultStrategy: "balanced", AllowedStrategies: []string{"balanced"}, ModelRules: []model.TokenModelRoutingRule{{Model: "gpt-image-2", DefaultStrategy: "balanced", AllowedStrategies: []string{"balanced"}, RouteIDs: []string{strings.Repeat("a", 24)}, RouteOrder: "manual"}}}
	payload := map[string]any{"id": token.Id, "name": "custom", "expired_time": -1, "unlimited_quota": true, "model_limits_enabled": true, "model_limits": "gpt-image-2", "group": "default", "routing_policy": policy}
	*allowed = false
	c, w := newAuthenticatedContext(t, http.MethodPut, "/api/token/", payload, 71)
	UpdateToken(c)
	require.False(t, decodeAPIResponse(t, w).Success)
	var stored model.Token
	require.NoError(t, db.First(&stored, token.Id).Error)
	assert.Empty(t, stored.RoutingPolicy)
	*allowed = true
	c, w = newAuthenticatedContext(t, http.MethodPut, "/api/token/", payload, 71)
	UpdateToken(c)
	require.True(t, decodeAPIResponse(t, w).Success, w.Body.String())
	*allowed = false
	delete(payload, "routing_policy")
	payload["name"] = "renamed"
	c, w = newAuthenticatedContext(t, http.MethodPut, "/api/token/", payload, 71)
	UpdateToken(c)
	require.True(t, decodeAPIResponse(t, w).Success, w.Body.String())
	require.NoError(t, db.First(&stored, token.Id).Error)
	assert.Contains(t, stored.RoutingPolicy, strings.Repeat("a", 24))
	c, w = newAuthenticatedContext(t, http.MethodGet, "/api/token/routing-options?model=gpt-image-2", nil, 71)
	GetTokenRoutingOptions(c)
	require.Equal(t, 200, w.Code)
}
