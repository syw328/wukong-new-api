package common

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlatformPortalRequiresAuthenticatedTenantContext(t *testing.T) {
	secret := "portal-test-secret"
	t.Setenv("PLATFORM_RELAY_SECRET", secret)
	r := httptest.NewRequest("GET", "https://tenant.test/pricing", nil)
	data, err := Marshal(PlatformPortal{Origin: "https://tenant.test", BasePath: "/api", TransportPath: "/api/open-platform"})
	require.NoError(t, err)
	context := base64.RawURLEncoding.EncodeToString(data)
	r.Header.Set("X-Platform-Portal-Context", context)
	_, ok := PlatformPortalForRequest(r)
	assert.False(t, ok)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(context))
	r.Header.Set("X-Platform-Portal-Signature", hex.EncodeToString(mac.Sum(nil)))
	portal, ok := PlatformPortalForRequest(r)
	require.True(t, ok)
	assert.Equal(t, "https://tenant.test", portal.Origin)
	r.Header.Set("X-Platform-Portal-Context", context+"x")
	_, ok = PlatformPortalForRequest(r)
	assert.False(t, ok)
}
