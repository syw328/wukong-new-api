package channel

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/common"
)

// Platform relay identity (方案 B：平台钱包权威).
//
// 本实例作为聚合平台的独立开放平台前台，所有渠道请求都用同一把平台服务 Key 转发到
// 平台 /v1。为了让平台按真正的最终用户记账，这里在上游请求头里附加：
//
//	X-Platform-Relay-Secret: <与平台 NEWAPI_RELAY_SECRET 一致>
//	X-Platform-User-Id:      <该用户通过平台 OAuth 登录时绑定的 provider_user_id>
//
// 环境变量：
//
//	PLATFORM_RELAY_SECRET             非空才启用
//	PLATFORM_RELAY_OAUTH_PROVIDER_ID  自定义 OAuth 提供方 ID（custom_oauth_providers.id）
//	PLATFORM_RELAY_CHANNEL_IDS        可选，逗号分隔；为空表示所有渠道都注入
//
// 用户没有对应 OAuth 绑定（例如 root 管理员本地账号）时不注入用户头，平台会按服务
// Key 本身的账号处理。

const (
	platformRelaySecretHeader = "X-Platform-Relay-Secret"
	platformRelayUserHeader   = "X-Platform-User-Id"
	platformBindingCacheTTL   = 5 * time.Minute
)

type platformRelayConfig struct {
	secret     string
	providerId int
	channelIds map[int]struct{}
}

type platformBindingEntry struct {
	providerUserId string
	expiresAt      time.Time
}

var (
	platformRelayOnce   sync.Once
	platformRelayCfg    *platformRelayConfig
	platformBindingMu   sync.RWMutex
	platformBindingByID = map[int]platformBindingEntry{}
)

func loadPlatformRelayConfig() *platformRelayConfig {
	platformRelayOnce.Do(func() {
		secret := strings.TrimSpace(os.Getenv("PLATFORM_RELAY_SECRET"))
		if secret == "" {
			return
		}
		providerId, _ := strconv.Atoi(strings.TrimSpace(os.Getenv("PLATFORM_RELAY_OAUTH_PROVIDER_ID")))
		cfg := &platformRelayConfig{secret: secret, providerId: providerId}
		if raw := strings.TrimSpace(os.Getenv("PLATFORM_RELAY_CHANNEL_IDS")); raw != "" {
			cfg.channelIds = map[int]struct{}{}
			for _, part := range strings.Split(raw, ",") {
				if id, err := strconv.Atoi(strings.TrimSpace(part)); err == nil && id > 0 {
					cfg.channelIds[id] = struct{}{}
				}
			}
		}
		platformRelayCfg = cfg
	})
	return platformRelayCfg
}

func (cfg *platformRelayConfig) appliesTo(info *common.RelayInfo) bool {
	if cfg == nil || info == nil {
		return false
	}
	if len(cfg.channelIds) == 0 {
		return true
	}
	_, ok := cfg.channelIds[info.ChannelId]
	return ok
}

func platformProviderUserId(cfg *platformRelayConfig, userId int) string {
	if cfg.providerId <= 0 || userId <= 0 {
		return ""
	}
	now := time.Now()
	platformBindingMu.RLock()
	entry, ok := platformBindingByID[userId]
	platformBindingMu.RUnlock()
	if ok && entry.expiresAt.After(now) {
		return entry.providerUserId
	}
	providerUserId := ""
	if binding, err := model.GetUserOAuthBinding(userId, cfg.providerId); err == nil && binding != nil {
		providerUserId = strings.TrimSpace(binding.ProviderUserId)
	}
	platformBindingMu.Lock()
	platformBindingByID[userId] = platformBindingEntry{providerUserId: providerUserId, expiresAt: now.Add(platformBindingCacheTTL)}
	if len(platformBindingByID) > 50000 {
		for id, item := range platformBindingByID {
			if item.expiresAt.Before(now) {
				delete(platformBindingByID, id)
			}
		}
	}
	platformBindingMu.Unlock()
	return providerUserId
}

// injectPlatformRelayHeaders 把平台记账头合并进 header override 结果；显式 override 优先。
func injectPlatformRelayHeaders(headers map[string]string, info *common.RelayInfo) {
	cfg := loadPlatformRelayConfig()
	if !cfg.appliesTo(info) || info.IsChannelTest {
		return
	}
	if _, exists := headers[platformRelaySecretHeader]; !exists {
		headers[platformRelaySecretHeader] = cfg.secret
	}
	if _, exists := headers[platformRelayUserHeader]; exists {
		return
	}
	if providerUserId := platformProviderUserId(cfg, info.UserId); providerUserId != "" {
		headers[platformRelayUserHeader] = providerUserId
	}
}

// PlatformRelayIdentityHeaders fails closed when the authenticated portal user
// has no platform OAuth binding. The service account is never a fallback payer.
func PlatformRelayIdentityHeaders(userID int) (map[string]string, error) {
	cfg := loadPlatformRelayConfig()
	if cfg == nil || len(cfg.secret) < 32 || cfg.providerId <= 0 || userID <= 0 {
		return nil, fmt.Errorf("platform relay identity is unavailable")
	}
	binding, err := model.GetUserOAuthBinding(userID, cfg.providerId)
	if err != nil || binding == nil || strings.TrimSpace(binding.ProviderUserId) == "" {
		return nil, fmt.Errorf("platform OAuth binding is required")
	}
	return map[string]string{platformRelaySecretHeader: cfg.secret, platformRelayUserHeader: strings.TrimSpace(binding.ProviderUserId)}, nil
}

// Only the managed media integration may attach identity, and only after its
// destination is matched against the operator-owned origin. No client header
// or plugin-provided URL can select a different recipient for tenant secrets.
func ApplyPlatformMediaIdentity(pluginKey, baseURL, requestURL string, userID int, headers map[string]string) error {
	if pluginKey != "platform-media" {
		return nil
	}
	expected := strings.TrimRight(os.Getenv("PLATFORM_MEDIA_BASE_URL"), "/")
	parsed, err := url.Parse(requestURL)
	base, baseErr := url.Parse(expected)
	if expected == "" || strings.TrimRight(baseURL, "/") != expected || baseErr != nil || err != nil ||
		base.User != nil || parsed.User != nil || parsed.Scheme != base.Scheme || parsed.Host != base.Host || parsed.RawQuery != "" ||
		parsed.Fragment != "" || (base.Scheme != "https" && !(base.Scheme == "http" && (base.Hostname() == "127.0.0.1" || base.Hostname() == "localhost"))) ||
		(parsed.Path != "/v1/media/generations" && !strings.HasPrefix(parsed.Path, "/v1/media/generations/")) {
		return fmt.Errorf("platform media destination is not configured correctly")
	}
	identity, err := PlatformRelayIdentityHeaders(userID)
	if err != nil {
		return err
	}
	for key := range headers {
		if strings.HasPrefix(strings.ToLower(key), "x-platform-") {
			delete(headers, key)
		}
	}
	for key, value := range identity {
		headers[key] = value
	}
	return nil
}
