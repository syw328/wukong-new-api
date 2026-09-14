package controller

import (
	"math"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/gin-gonic/gin"
)

// platformBillingMirrorEnabled 与 relay/channel/platform_relay.go 共用同一个开关：
// 配置了 PLATFORM_RELAY_SECRET 即表示本实例是聚合平台的前台，钱包以平台为权威。
func platformBillingMirrorEnabled() bool {
	return strings.TrimSpace(os.Getenv("PLATFORM_RELAY_SECRET")) != ""
}

// applyPlatformBalanceMirror 用平台 userinfo 里的余额（算力）覆盖本地 quota。
// quota 是整数：QuotaPerUnit 决定 1 算力对应多少 quota。保持默认 500000，此时
// ratio = 算力/1M ÷ 2 的换算下，New API 日志里的费用与平台账本一致，界面 "$" 即算力。
func applyPlatformBalanceMirror(c *gin.Context, user *model.User, oauthUser *oauth.OAuthUser) {
	if !platformBillingMirrorEnabled() || user == nil || oauthUser == nil {
		return
	}
	balance, ok := oauthUser.Extra["balance"].(float64)
	if !ok || math.IsNaN(balance) || math.IsInf(balance, 0) {
		return
	}
	quota := int(math.Round(math.Max(0, balance) * common.QuotaPerUnit))
	if quota > common.MaxWalletQuota {
		quota = common.MaxWalletQuota
	}
	if err := model.SetUserQuotaMirror(user.Id, quota); err != nil {
		logger.LogWarn(c.Request.Context(), "[PlatformMirror] set quota failed for user "+user.Username+": "+err.Error())
		return
	}
	user.Quota = quota
}
