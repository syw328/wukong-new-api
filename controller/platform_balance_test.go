// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestPlatformBalanceUsesAuthenticatedBindingAndNeverTheMirror(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Token{}, &model.UserOAuthBinding{}))
	require.NoError(t, db.Create(&model.User{Id: 8801, Username: "balance-owner", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, Group: "default", Quota: 999999}).Error)
	require.NoError(t, db.Create(&model.UserOAuthBinding{UserId: 8801, ProviderId: 42, ProviderUserId: "usr_balance_owner"}).Error)
	token := seedToken(t, db, 8801, "balance", "balancequeryfixturekey")
	t.Setenv("PLATFORM_RELAY_SECRET", "balance-relay-fixture-secret-0123456789")
	t.Setenv("PLATFORM_RELAY_OAUTH_PROVIDER_ID", "42")
	reads := 0
	balance := `125.5`
	status := http.StatusOK
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads++
		require.Equal(t, "/api/developer/relay-balance", r.URL.Path)
		require.Empty(t, r.URL.RawQuery)
		require.Equal(t, "usr_balance_owner", r.Header.Get("X-Platform-User-Id"))
		require.Equal(t, "balance-relay-fixture-secret-0123456789", r.Header.Get("X-Platform-Relay-Secret"))
		require.Empty(t, r.Header.Get("Cookie"))
		require.Empty(t, r.Header.Get("Authorization"))
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"success":true,"data":{"balance":` + balance + `,"unit":"credits"}}`))
	}))
	t.Cleanup(upstream.Close)
	previous := common.OptionMap
	common.OptionMap = map[string]string{"PlatformPublicBaseURL": upstream.URL}
	t.Cleanup(func() { common.OptionMap = previous })
	router := gin.New()
	router.GET("/v1/balance", middleware.TokenAuth(), GetPlatformBalance)
	read := func(key string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/v1/balance?user_id=other", nil)
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Cookie", "session=not-forwarded")
		req.Header.Set("X-Platform-User-Id", "usr_other")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	for _, value := range []string{"125.5", "0"} {
		balance = value
		w := read("sk-" + token.Key)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		require.Equal(t, "private, no-store", w.Header().Get("Cache-Control"))
		require.Contains(t, w.Body.String(), `"balance":`+value)
	}
	require.Equal(t, 2, reads, "every query must read the platform wallet")
	status = http.StatusServiceUnavailable
	require.Equal(t, status, read("sk-"+token.Key).Code, "unavailable authority must not return the local mirror")
	require.Equal(t, http.StatusUnauthorized, read("invalid").Code)
	require.NoError(t, db.Model(token).Update("expired_time", 1).Error)
	require.Equal(t, http.StatusUnauthorized, read("sk-"+token.Key).Code)
	require.NoError(t, db.Model(token).Updates(map[string]any{"expired_time": -1, "status": common.TokenStatusDisabled}).Error)
	require.Equal(t, http.StatusUnauthorized, read("sk-"+token.Key).Code)
	require.NoError(t, db.Model(token).Update("status", common.TokenStatusEnabled).Error)
	require.NoError(t, db.Where("user_id = ?", 8801).Delete(&model.UserOAuthBinding{}).Error)
	require.Equal(t, http.StatusForbidden, read("sk-"+token.Key).Code)
	require.Equal(t, 3, reads, "invalid credentials and missing bindings never reach the wallet")
}
