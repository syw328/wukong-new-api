package service

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

// 平台钱包权威（方案 B）：配置了 PLATFORM_RELAY_SECRET 时本实例是聚合平台的开放平台前台，
// 真实扣费在平台，本地 quota 只是平台余额的镜像，用于钱包展示和中转前的预检。
// OAuth 登录时写入一次；平台侧的充值、兑换和网页端消费都不会推送过来，所以预检不足时
// 和用户查看钱包时回平台重读。否则“先登录开放平台、再充值”的用户会一直被本地 0 额度拦下。

const (
	platformRelaySecretHeader = "X-Platform-Relay-Secret"
	platformRelayUserHeader   = "X-Platform-User-Id"
	platformBalancePath       = "/api/developer/relay-balance"

	// PlatformQuotaRefreshOnShortfall 限制预检不足时的回查频率：余额确实为 0 的调用方反复重试也不会打满平台。
	PlatformQuotaRefreshOnShortfall = 5 * time.Second
	// PlatformQuotaRefreshOnView 钱包、看板每次加载都会读 self，回查间隔放宽。
	PlatformQuotaRefreshOnView = 30 * time.Second
)

var platformQuotaClient = &http.Client{Timeout: 5 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}

var (
	platformQuotaMu        sync.Mutex
	platformQuotaCheckedAt = map[int]time.Time{}
)

func PlatformBillingMirrorEnabled() bool {
	return strings.TrimSpace(os.Getenv("PLATFORM_RELAY_SECRET")) != ""
}

// PlatformBalanceQuota converts a platform balance (算力) into local quota units.
func PlatformBalanceQuota(balance float64) (int, bool) {
	if math.IsNaN(balance) || math.IsInf(balance, 0) {
		return 0, false
	}
	quota := math.Round(math.Max(0, balance) * common.QuotaPerUnit)
	if quota >= common.MaxWalletQuota {
		return common.MaxWalletQuota, true
	}
	return int(quota), true
}

// PlatformRelayIdentityHeaders fails closed when the authenticated portal user
// has no platform OAuth binding. The service account is never a fallback payer.
func PlatformRelayIdentityHeaders(userID int) (map[string]string, error) {
	secret := strings.TrimSpace(os.Getenv("PLATFORM_RELAY_SECRET"))
	providerID, _ := strconv.Atoi(strings.TrimSpace(os.Getenv("PLATFORM_RELAY_OAUTH_PROVIDER_ID")))
	if len(secret) < 32 || providerID <= 0 || userID <= 0 {
		return nil, fmt.Errorf("platform relay identity is unavailable")
	}
	binding, err := model.GetUserOAuthBinding(userID, providerID)
	if err != nil || binding == nil || strings.TrimSpace(binding.ProviderUserId) == "" {
		return nil, fmt.Errorf("platform OAuth binding is required")
	}
	return map[string]string{platformRelaySecretHeader: secret, platformRelayUserHeader: strings.TrimSpace(binding.ProviderUserId)}, nil
}

// RefreshPlatformQuotaMirror re-reads the platform wallet of a platform-bound user
// and overwrites the local mirror. It reports the mirrored quota and whether the read
// succeeded. Reads are throttled per user by minInterval; any failure keeps the mirror.
func RefreshPlatformQuotaMirror(r *http.Request, userID int, minInterval time.Duration) (int, bool) {
	if !PlatformBillingMirrorEnabled() || r == nil || userID <= 0 {
		return 0, false
	}
	origin, ok := common.PlatformPortalOrigin(r)
	if !ok {
		return 0, false
	}
	headers, err := PlatformRelayIdentityHeaders(userID)
	if err != nil || !claimPlatformQuotaRefresh(userID, minInterval) {
		return 0, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), platformQuotaClient.Timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+platformBalancePath, nil)
	if err != nil {
		return 0, false
	}
	request.Header.Set("Accept", "application/json")
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := platformQuotaClient.Do(request)
	if err != nil {
		logger.LogWarn(r.Context(), fmt.Sprintf("[PlatformMirror] balance read failed for user %d: %s", userID, err.Error()))
		return 0, false
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Balance *float64 `json:"balance"`
		} `json:"data"`
	}
	if err != nil || response.StatusCode != http.StatusOK || common.Unmarshal(body, &payload) != nil || !payload.Success || payload.Data.Balance == nil {
		logger.LogWarn(r.Context(), fmt.Sprintf("[PlatformMirror] balance read rejected for user %d: HTTP %d", userID, response.StatusCode))
		return 0, false
	}
	quota, ok := PlatformBalanceQuota(*payload.Data.Balance)
	if !ok {
		return 0, false
	}
	if err := model.SetUserQuotaMirror(userID, quota); err != nil {
		logger.LogWarn(r.Context(), fmt.Sprintf("[PlatformMirror] set quota failed for user %d: %s", userID, err.Error()))
		return 0, false
	}
	return quota, true
}

func claimPlatformQuotaRefresh(userID int, minInterval time.Duration) bool {
	now := time.Now()
	platformQuotaMu.Lock()
	defer platformQuotaMu.Unlock()
	if last, ok := platformQuotaCheckedAt[userID]; ok && now.Sub(last) < minInterval {
		return false
	}
	platformQuotaCheckedAt[userID] = now
	if len(platformQuotaCheckedAt) > 50000 {
		for id, at := range platformQuotaCheckedAt {
			if now.Sub(at) > PlatformQuotaRefreshOnView {
				delete(platformQuotaCheckedAt, id)
			}
		}
	}
	return true
}
