package controller

import (
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// applyPlatformBalanceMirror 用平台 userinfo 里的余额（算力）覆盖本地 quota。
// quota 是整数：QuotaPerUnit 决定 1 算力对应多少 quota。保持默认 500000，此时
// ratio = 算力/1M ÷ 2 的换算下，New API 日志里的费用与平台账本一致，界面 "$" 即算力。
// 登录之后的余额变化由 service.RefreshPlatformQuotaMirror 回平台重读。
func applyPlatformBalanceMirror(c *gin.Context, user *model.User, oauthUser *oauth.OAuthUser) {
	if !service.PlatformBillingMirrorEnabled() || user == nil || oauthUser == nil {
		return
	}
	balance, ok := oauthUser.Extra["balance"].(float64)
	if !ok {
		return
	}
	quota, ok := service.PlatformBalanceQuota(balance)
	if !ok {
		return
	}
	if err := model.SetUserQuotaMirror(user.Id, quota); err != nil {
		logger.LogWarn(c.Request.Context(), "[PlatformMirror] set quota failed for user "+user.Username+": "+err.Error())
		return
	}
	user.Quota = quota
}
