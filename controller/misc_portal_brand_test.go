package controller

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetStatusNamesPlatformSignInAfterVisitedBrand(t *testing.T) {
	secret := "portal-brand-test-secret"
	t.Setenv("PLATFORM_RELAY_SECRET", secret)
	originalOptionMap := common.OptionMap
	common.OptionMap = map[string]string{}
	oauth.RegisterOrUpdateCustomProvider(&model.CustomOAuthProvider{
		Id: 1, Name: "旧品牌 AI 平台", Slug: "platform", Enabled: true, ClientId: "portal-client",
		AuthorizationEndpoint: "https://tenant.test/api/oauth/authorize", Scopes: "profile",
	})
	t.Cleanup(func() {
		oauth.UnregisterCustomProvider("platform")
		common.OptionMap = originalOptionMap
	})

	status := func(brandName string) map[string]any {
		response := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(response)
		context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)
		if brandName != "" {
			data, err := common.Marshal(common.PlatformPortal{Origin: "https://agent.test", BasePath: "/api",
				TransportPath: "/api/open-platform", BrandName: brandName})
			require.NoError(t, err)
			encoded := base64.RawURLEncoding.EncodeToString(data)
			mac := hmac.New(sha256.New, []byte(secret))
			mac.Write([]byte(encoded))
			context.Request.Header.Set("X-Platform-Portal-Context", encoded)
			context.Request.Header.Set("X-Platform-Portal-Signature", hex.EncodeToString(mac.Sum(nil)))
		}
		GetStatus(context)
		var payload struct {
			Data map[string]any `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
		return payload.Data
	}
	providerName := func(data map[string]any) string {
		providers, ok := data["custom_oauth_providers"].([]any)
		require.True(t, ok)
		require.Len(t, providers, 1)
		return providers[0].(map[string]any)["name"].(string)
	}

	agent := status("松鼠剧场")
	assert.Equal(t, "松鼠剧场", providerName(agent), "white-label domains sign in under their own brand")
	assert.Equal(t, "松鼠剧场 API 开放平台", agent["system_name"])
	assert.Equal(t, "白猪AI", providerName(status("白猪AI")))
	assert.Equal(t, "旧品牌 AI 平台", providerName(status("")), "direct access without a signed portal keeps the stored name")
}
