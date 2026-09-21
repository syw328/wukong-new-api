package service

import (
	"math"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

const platformMirrorTestSecret = "platform-mirror-test-relay-secret-0123456789"

// platformWallet stands in for the platform's /api/developer/relay-balance and
// counts reads so tests can see when the gateway went back to the authority.
func platformWallet(t *testing.T, balance string) *atomic.Int32 {
	t.Helper()
	var reads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads.Add(1)
		if r.URL.Path != platformBalancePath || r.Header.Get(platformRelaySecretHeader) != platformMirrorTestSecret ||
			r.Header.Get(platformRelayUserHeader) == "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"data":{"balance":` + balance + `}}`))
	}))
	t.Cleanup(server.Close)
	previous := common.OptionMap
	common.OptionMapRWMutex.Lock()
	common.OptionMap = map[string]string{"PlatformPublicBaseURL": server.URL}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previous
		common.OptionMapRWMutex.Unlock()
	})
	t.Setenv("PLATFORM_RELAY_SECRET", platformMirrorTestSecret)
	t.Setenv("PLATFORM_RELAY_OAUTH_PROVIDER_ID", "1")
	return &reads
}

// seedPlatformMember is a portal user who signed in with the platform while the
// platform wallet was still empty, so the local mirror holds zero.
func seedPlatformMember(t *testing.T, userID int) *relaycommon.RelayInfo {
	t.Helper()
	truncate(t)
	require.NoError(t, model.DB.AutoMigrate(&model.UserOAuthBinding{}))
	t.Cleanup(func() { model.DB.Exec("DELETE FROM user_oauth_bindings") })
	seedUser(t, userID, 0)
	seedToken(t, userID, userID, "platform-mirror-token", 0)
	require.NoError(t, model.DB.Create(&model.UserOAuthBinding{UserId: userID, ProviderId: 1, ProviderUserId: "usr_platform_member"}).Error)
	return &relaycommon.RelayInfo{UserId: userID, TokenId: userID, TokenKey: "platform-mirror-token", TokenUnlimited: true,
		ForcePreConsume: true, UserSetting: dto.UserSetting{BillingPreference: "wallet_only"}}
}

func platformRelayContext() *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	return c
}

func TestPreConsumeBillingRereadsPlatformWalletWhenMirrorIsEmpty(t *testing.T) {
	reads := platformWallet(t, "26")
	info := seedPlatformMember(t, 9101)

	apiErr := PreConsumeBilling(platformRelayContext(), 1000, info)

	require.Nil(t, apiErr)
	require.EqualValues(t, 1, reads.Load())
	quota, err := model.GetUserQuota(info.UserId, true)
	require.NoError(t, err)
	require.Equal(t, int(26*common.QuotaPerUnit)-1000, quota)
}

func TestPreConsumeBillingKeepsShortfallWhenPlatformWalletIsEmpty(t *testing.T) {
	reads := platformWallet(t, "0")
	info := seedPlatformMember(t, 9102)

	apiErr := PreConsumeBilling(platformRelayContext(), 1000, info)
	require.NotNil(t, apiErr)
	require.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())

	// A caller retrying on an empty wallet does not turn into a platform read per request.
	apiErr = PreConsumeBilling(platformRelayContext(), 1000, info)
	require.NotNil(t, apiErr)
	require.EqualValues(t, 1, reads.Load())
}

func TestPlatformQuotaMirrorNeedsBindingAndMirrorMode(t *testing.T) {
	reads := platformWallet(t, "26")
	info := seedPlatformMember(t, 9103)
	c := platformRelayContext()

	// Local accounts without a platform binding never read another user's wallet.
	_, refreshed := RefreshPlatformQuotaMirror(c.Request, 9199, PlatformQuotaRefreshOnView)
	require.False(t, refreshed)

	t.Setenv("PLATFORM_RELAY_SECRET", "")
	apiErr := PreConsumeBilling(c, 1000, info)
	require.NotNil(t, apiErr)
	require.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
	require.EqualValues(t, 0, reads.Load())
}

func TestPlatformBalanceQuotaClampsToWalletRange(t *testing.T) {
	quota, ok := PlatformBalanceQuota(-3)
	require.True(t, ok)
	require.Zero(t, quota)
	quota, ok = PlatformBalanceQuota(1e30)
	require.True(t, ok)
	require.Equal(t, common.MaxWalletQuota, quota)
	_, ok = PlatformBalanceQuota(math.NaN())
	require.False(t, ok)
}
