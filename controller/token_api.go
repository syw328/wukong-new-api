// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
// New file: keys managed over the API. A portal key reads (and, when its owner
// allowed it, edits) itself at /v1/key; the account's management key
// administers that account's keys at /v1/keys. The console /api/token handlers
// keep their own contract; both surfaces share the model validation.
package controller

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const maxKeyAPIBody = 256 << 10

type apiKeyQuotaView struct {
	Unlimited bool     `json:"unlimited"`
	Limit     *float64 `json:"limit"`
	Used      float64  `json:"used"`
	Remaining *float64 `json:"remaining"`
	Unit      string   `json:"unit"`
}

// apiKeyView is the one key representation of /v1/key and /v1/keys. Amounts
// are credits (QuotaPerUnit quota = 1 credit, the unit the console shows).
type apiKeyView struct {
	Object          string                    `json:"object"`
	Id              int                       `json:"id"`
	Name            string                    `json:"name"`
	Key             string                    `json:"key"`
	Status          string                    `json:"status"`
	RoutingStrategy string                    `json:"routing_strategy"`
	RoutingPolicy   *model.TokenRoutingPolicy `json:"routing_policy"`
	ModelLimits     []string                  `json:"model_limits"`
	Quota           apiKeyQuotaView           `json:"quota"`
	AllowIps        []string                  `json:"allow_ips"`
	ExpiresAt       *string                   `json:"expires_at"`
	CreatedAt       *string                   `json:"created_at"`
	LastUsedAt      *string                   `json:"last_used_at"`
	ApiEditAllowed  bool                      `json:"api_edit_allowed"`
}

func abortKeyAPI(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"error": gin.H{"type": code, "code": code, "message": message}})
}

func abortKeyAPIField(c *gin.Context, code, message, field string) {
	c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": gin.H{"type": code, "code": code, "message": message, "param": field}})
}

func keyAPITime(seconds int64) *string {
	if seconds <= 0 {
		return nil
	}
	value := time.Unix(seconds, 0).UTC().Format(time.RFC3339)
	return &value
}

func quotaCredits(quota int) float64 {
	return math.Round(float64(quota)/common.QuotaPerUnit*1e6) / 1e6
}

func keyAPIStatus(token *model.Token) string {
	switch {
	case token.Status == common.TokenStatusDisabled:
		return "disabled"
	case token.Status == common.TokenStatusExpired || (token.ExpiredTime != -1 && token.ExpiredTime <= common.GetTimestamp()):
		return "expired"
	case token.Status == common.TokenStatusExhausted:
		return "exhausted"
	case token.Status == common.TokenStatusEnabled:
		return "enabled"
	default:
		return "unknown"
	}
}

func buildAPIKeyView(token *model.Token) apiKeyView {
	policy, _ := token.GetRoutingPolicy()
	strategy := "default"
	if policy != nil {
		strategy = policy.DefaultStrategy
		if policy.Version == 2 && policy.Mode == "custom" {
			strategy = "custom"
		}
	}
	view := apiKeyView{Object: "api_key", Id: token.Id, Name: token.Name, Key: token.GetMaskedKey(), Status: keyAPIStatus(token),
		RoutingStrategy: strategy, RoutingPolicy: policy, AllowIps: token.GetIpLimits(),
		CreatedAt: keyAPITime(token.CreatedTime), LastUsedAt: keyAPITime(token.AccessedTime), ApiEditAllowed: token.AllowApiEdit,
		Quota: apiKeyQuotaView{Unlimited: token.UnlimitedQuota, Used: quotaCredits(token.UsedQuota), Unit: "credits"}}
	if token.ModelLimitsEnabled {
		view.ModelLimits = token.GetModelLimits()
	}
	if !token.UnlimitedQuota {
		limit, remaining := quotaCredits(token.RemainQuota+token.UsedQuota), quotaCredits(token.RemainQuota)
		view.Quota.Limit, view.Quota.Remaining = &limit, &remaining
	}
	if token.ExpiredTime != -1 {
		view.ExpiresAt = keyAPITime(token.ExpiredTime)
	}
	return view
}

// readKeyAPIFields reads one JSON object and rejects any field outside allowed.
func readKeyAPIFields(c *gin.Context, allowed []string) (map[string]json.RawMessage, bool) {
	data, err := io.ReadAll(io.LimitReader(c.Request.Body, maxKeyAPIBody+1))
	if err != nil || len(data) > maxKeyAPIBody {
		abortKeyAPI(c, http.StatusRequestEntityTooLarge, "payload_too_large", "Request is too large")
		return nil, false
	}
	fields := map[string]json.RawMessage{}
	if common.Unmarshal(data, &fields) != nil {
		abortKeyAPI(c, http.StatusBadRequest, "invalid_request_error", "Send a JSON object")
		return nil, false
	}
	for name := range fields {
		if !slices.Contains(allowed, name) {
			abortKeyAPIField(c, "field_not_editable", fmt.Sprintf("%s cannot be set through this endpoint", name), name)
			return nil, false
		}
	}
	return fields, true
}

func isJSONNull(raw json.RawMessage) bool {
	return strings.TrimSpace(string(raw)) == "null"
}

// applyKeyAPIFields validates and applies the given fields to token. The
// routing policy is applied last so that it is checked against the final model
// whitelist; the caller verifies changed routes against the platform.
func applyKeyAPIFields(token *model.Token, fields map[string]json.RawMessage) (string, string) {
	if raw, ok := fields["name"]; ok {
		var name string
		if common.Unmarshal(raw, &name) != nil || strings.TrimSpace(name) == "" || len(name) > 50 {
			return "name", "name must be a non-empty string of at most 50 bytes"
		}
		token.Name = name
	}
	if raw, ok := fields["model_limits"]; ok {
		var models []string
		if !isJSONNull(raw) && common.Unmarshal(raw, &models) != nil {
			return "model_limits", "model_limits must be null or an array of model IDs"
		}
		seen := map[string]bool{}
		for _, name := range models {
			if name == "" || len(name) > 160 || strings.TrimSpace(name) != name || strings.ContainsAny(name, ",\r\n\t\x00") || seen[name] {
				return "model_limits", "model_limits contains an empty, invalid or duplicate model ID"
			}
			seen[name] = true
		}
		if len(models) > 500 {
			return "model_limits", "model_limits allows at most 500 models"
		}
		token.ModelLimitsEnabled, token.ModelLimits = len(models) > 0, strings.Join(models, ",")
	}
	if raw, ok := fields["quota"]; ok {
		var quota struct {
			Unlimited *bool    `json:"unlimited"`
			Limit     *float64 `json:"limit"`
		}
		if common.Unmarshal(raw, &quota) != nil || quota.Unlimited == nil {
			return "quota", "quota must be {\"unlimited\": true} or {\"unlimited\": false, \"limit\": <credits>}"
		}
		if *quota.Unlimited {
			token.UnlimitedQuota = true
		} else {
			if quota.Limit == nil || math.IsNaN(*quota.Limit) || math.IsInf(*quota.Limit, 0) || *quota.Limit < 0 {
				return "quota", "quota.limit must be zero or a positive number of credits"
			}
			limit, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromFloat(*quota.Limit).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
			if err != nil || limit > maxTokenQuota() {
				return "quota", "quota.limit is too large"
			}
			// limit counts what the key already used; the console edits the remainder.
			if limit < token.UsedQuota {
				return "quota", "quota.limit is below what this key has already used"
			}
			token.UnlimitedQuota, token.RemainQuota = false, limit-token.UsedQuota
		}
	}
	if raw, ok := fields["allow_ips"]; ok {
		var ips []string
		if !isJSONNull(raw) && common.Unmarshal(raw, &ips) != nil {
			return "allow_ips", "allow_ips must be null or an array of IP addresses or CIDR ranges"
		}
		if len(ips) > 100 {
			return "allow_ips", "allow_ips allows at most 100 entries"
		}
		for _, entry := range ips {
			if _, _, err := net.ParseCIDR(entry); err != nil && net.ParseIP(entry) == nil {
				return "allow_ips", fmt.Sprintf("%q is not an IP address or CIDR range", entry)
			}
		}
		joined := strings.Join(ips, "\n")
		token.AllowIps = &joined
	}
	if raw, ok := fields["expires_at"]; ok {
		expires, valid := parseKeyExpiry(raw)
		if !valid {
			return "expires_at", "expires_at must be null, a future Unix time in seconds or an RFC 3339 time"
		}
		token.ExpiredTime = expires
	}
	if raw, ok := fields["allow_api_edit"]; ok {
		if common.Unmarshal(raw, &token.AllowApiEdit) != nil {
			return "allow_api_edit", "allow_api_edit must be true or false"
		}
	}
	// Status last but one: enabling checks the expiry and quota set in this request.
	if raw, ok := fields["status"]; ok {
		var status string
		if common.Unmarshal(raw, &status) != nil {
			return "status", "status must be enabled or disabled"
		}
		switch status {
		case "enabled":
			if token.Status == common.TokenStatusExpired && token.ExpiredTime != -1 && token.ExpiredTime <= common.GetTimestamp() {
				return "status", "an expired key cannot be enabled; extend expires_at first"
			}
			if token.Status == common.TokenStatusExhausted && token.RemainQuota <= 0 && !token.UnlimitedQuota {
				return "status", "an exhausted key cannot be enabled; raise its quota first"
			}
			token.Status = common.TokenStatusEnabled
		case "disabled":
			token.Status = common.TokenStatusDisabled
		default:
			return "status", "status must be enabled or disabled"
		}
	}
	if raw, ok := fields["routing_policy"]; ok {
		var policy *model.TokenRoutingPolicy
		if !isJSONNull(raw) && common.Unmarshal(raw, &policy) != nil {
			return "routing_policy", "routing_policy must be null or a routing policy object"
		}
		if err := token.SetRoutingPolicy(policy); err != nil {
			return "routing_policy", err.Error()
		}
	} else if _, changed := fields["model_limits"]; changed {
		// A narrowed whitelist must still cover a stored custom policy.
		policy, err := token.GetRoutingPolicy()
		if err == nil {
			err = token.SetRoutingPolicy(policy)
		}
		if err != nil {
			return "model_limits", err.Error()
		}
	}
	return "", ""
}

func parseKeyExpiry(raw json.RawMessage) (int64, bool) {
	if isJSONNull(raw) {
		return -1, true
	}
	var seconds int64
	if common.Unmarshal(raw, &seconds) != nil {
		var text string
		if common.Unmarshal(raw, &text) != nil {
			return 0, false
		}
		parsed, err := time.Parse(time.RFC3339, text)
		if err != nil {
			return 0, false
		}
		seconds = parsed.Unix()
	}
	return seconds, seconds > common.GetTimestamp()
}

func keyAPIChangedFields(previous, current *model.Token) []string {
	changed := []string{}
	ipsOf := func(token *model.Token) string {
		if token.AllowIps == nil {
			return ""
		}
		return *token.AllowIps
	}
	for _, field := range []struct {
		name    string
		changed bool
	}{
		{"name", previous.Name != current.Name},
		{"status", previous.Status != current.Status},
		{"expired_time", previous.ExpiredTime != current.ExpiredTime},
		{"remain_quota", previous.RemainQuota != current.RemainQuota},
		{"unlimited_quota", previous.UnlimitedQuota != current.UnlimitedQuota},
		{"model_limits_enabled", previous.ModelLimitsEnabled != current.ModelLimitsEnabled},
		{"model_limits", previous.ModelLimits != current.ModelLimits},
		{"allow_ips", ipsOf(previous) != ipsOf(current)},
		{"routing_policy", previous.RoutingPolicy != current.RoutingPolicy},
		{"allow_api_edit", previous.AllowApiEdit != current.AllowApiEdit},
	} {
		if field.changed {
			changed = append(changed, field.name)
		}
	}
	return changed
}

// saveKeyAPIChange verifies changed custom routes against the platform, saves
// the key and fills the audit record. It answers the request on failure.
func saveKeyAPIChange(c *gin.Context, previous, token *model.Token) bool {
	if token.RoutingPolicy != previous.RoutingPolicy {
		policy, err := token.GetRoutingPolicy()
		if err == nil {
			err = validateTokenRouteSelection(c, policy)
		}
		if err != nil {
			abortKeyAPI(c, http.StatusBadRequest, "invalid_routing_policy", err.Error())
			return false
		}
	}
	if err := token.Update(); err != nil {
		common.SysError(fmt.Sprintf("failed to update token %d over the API: %v", token.Id, err))
		abortKeyAPI(c, http.StatusInternalServerError, "database_error", "The key could not be saved")
		return false
	}
	params := tokenAuditParams(c)
	params["id"], params["name"], params["changed_fields"] = token.Id, token.Name, keyAPIChangedFields(previous, token)
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	return true
}

func ownedKey(c *gin.Context, id int) (*model.Token, bool) {
	token, err := model.GetTokenByIds(id, c.GetInt("id"))
	if err == nil {
		return token, true
	}
	if errors.Is(err, gorm.ErrRecordNotFound) || id <= 0 {
		abortKeyAPI(c, http.StatusNotFound, "key_not_found", "Key not found")
	} else {
		common.SysError("failed to read token over the API: " + err.Error())
		abortKeyAPI(c, http.StatusInternalServerError, "database_error", "The key could not be read")
	}
	return nil, false
}

// GetOwnKey answers GET /v1/key with the calling portal key's own settings.
func GetOwnKey(c *gin.Context) {
	token, ok := ownedKey(c, c.GetInt("token_id"))
	if !ok {
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, buildAPIKeyView(token))
}

// UpdateOwnKey answers POST /v1/key. Only a key whose owner enabled
// allow_api_edit may rename itself, change its routing or disable itself;
// quota, IP whitelist and every other setting stay console-only.
func UpdateOwnKey(c *gin.Context) {
	token, ok := ownedKey(c, c.GetInt("token_id"))
	if !ok {
		return
	}
	params := tokenAuditParams(c)
	params["id"], params["name"] = token.Id, token.Name
	if !token.AllowApiEdit {
		abortKeyAPI(c, http.StatusForbidden, "api_edit_not_allowed", "This key may not change its settings over the API; its owner can allow it in the console")
		return
	}
	fields, ok := readKeyAPIFields(c, []string{"name", "routing_policy", "status"})
	if !ok {
		return
	}
	previous := *token
	if field, message := applyKeyAPIFields(token, fields); field != "" {
		abortKeyAPIField(c, "invalid_request_error", message, field)
		return
	}
	if !saveKeyAPIChange(c, &previous, token) {
		return
	}
	c.JSON(http.StatusOK, buildAPIKeyView(token))
}

var managedKeyFields = []string{"name", "status", "routing_policy", "model_limits", "quota", "allow_ips", "expires_at", "allow_api_edit"}

// ListManagedKeys answers GET /v1/keys for the management key's account.
func ListManagedKeys(c *gin.Context) {
	page := common.GetPageQuery(c)
	tokens, err := model.GetAllUserTokens(c.GetInt("id"), page.GetStartIdx(), page.GetPageSize())
	if err != nil {
		abortKeyAPI(c, http.StatusInternalServerError, "database_error", "Keys could not be read")
		return
	}
	total, _ := model.CountUserTokens(c.GetInt("id"))
	views := make([]apiKeyView, 0, len(tokens))
	for _, token := range tokens {
		views = append(views, buildAPIKeyView(token))
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{"object": "list", "data": views, "total": total, "page": page.GetPage(),
		"page_size": page.GetPageSize(), "has_more": int64(page.GetStartIdx()+len(views)) < total})
}

func GetManagedKey(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	token, ok := ownedKey(c, id)
	if !ok {
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, buildAPIKeyView(token))
}

// CreateManagedKey answers POST /v1/keys. The full key is in this response only.
func CreateManagedKey(c *gin.Context) {
	fields, ok := readKeyAPIFields(c, managedKeyFields)
	if !ok {
		return
	}
	if _, named := fields["name"]; !named {
		abortKeyAPIField(c, "invalid_request_error", "name is required", "name")
		return
	}
	count, err := model.CountUserTokens(c.GetInt("id"))
	if err != nil {
		abortKeyAPI(c, http.StatusInternalServerError, "database_error", "Keys could not be counted")
		return
	}
	if maxTokens := operation_setting.GetMaxUserTokens(); int(count) >= maxTokens {
		abortKeyAPI(c, http.StatusBadRequest, "key_limit_reached", fmt.Sprintf("This account already has the maximum of %d keys", maxTokens))
		return
	}
	now := common.GetTimestamp()
	token := &model.Token{UserId: c.GetInt("id"), Status: common.TokenStatusEnabled, CreatedTime: now, AccessedTime: now,
		ExpiredTime: -1, UnlimitedQuota: true}
	// Same default as the console's new-key drawer: one automatic balanced strategy.
	if _, set := fields["routing_policy"]; !set && service.PlatformKeyRoutingEnabled() {
		fields["routing_policy"] = json.RawMessage(`{"version":2,"mode":"automatic","default_strategy":"balanced","allowed_strategies":["balanced"],"allow_fixed_routes":false,"model_rules":[]}`)
	}
	if field, message := applyKeyAPIFields(token, fields); field != "" {
		abortKeyAPIField(c, "invalid_request_error", message, field)
		return
	}
	policy, err := token.GetRoutingPolicy()
	if err == nil {
		err = validateTokenRouteSelection(c, policy)
	}
	if err != nil {
		abortKeyAPI(c, http.StatusBadRequest, "invalid_routing_policy", err.Error())
		return
	}
	key, err := common.GenerateKey()
	if err != nil {
		abortKeyAPI(c, http.StatusInternalServerError, "key_generation_failed", "The key could not be generated")
		return
	}
	token.Key = key
	if err := token.Insert(); err != nil {
		common.SysError("failed to create token over the API: " + err.Error())
		abortKeyAPI(c, http.StatusInternalServerError, "database_error", "The key could not be saved")
		return
	}
	params := tokenAuditParams(c)
	params["id"], params["name"] = token.Id, token.Name
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	view := buildAPIKeyView(token)
	view.Key = "sk-" + key
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusCreated, view)
}

// UpdateManagedKey answers POST /v1/keys/:id; omitted fields keep their value.
func UpdateManagedKey(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	token, ok := ownedKey(c, id)
	if !ok {
		return
	}
	params := tokenAuditParams(c)
	params["id"], params["name"] = token.Id, token.Name
	fields, ok := readKeyAPIFields(c, managedKeyFields)
	if !ok {
		return
	}
	previous := *token
	if field, message := applyKeyAPIFields(token, fields); field != "" {
		abortKeyAPIField(c, "invalid_request_error", message, field)
		return
	}
	if !saveKeyAPIChange(c, &previous, token) {
		return
	}
	c.JSON(http.StatusOK, buildAPIKeyView(token))
}

func DeleteManagedKey(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	token, ok := ownedKey(c, id)
	if !ok {
		return
	}
	params := tokenAuditParams(c)
	params["id"], params["name"] = token.Id, token.Name
	if err := token.Delete(); err != nil {
		abortKeyAPI(c, http.StatusInternalServerError, "database_error", "The key could not be deleted")
		return
	}
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	c.JSON(http.StatusOK, gin.H{"object": "api_key.deleted", "id": token.Id, "deleted": true})
}

// GetManagedKeyRoutes answers GET /v1/keys/available-routes with the models a
// key of this account may allow and the strategies a policy may name; with
// ?model= it adds that model's routes from the same platform source the
// console's key drawer reads.
func GetManagedKeyRoutes(c *gin.Context) {
	user, err := model.GetUserCache(c.GetInt("id"))
	if err != nil {
		abortKeyAPI(c, http.StatusInternalServerError, "database_error", "The account could not be read")
		return
	}
	groups := []string{}
	for group := range service.GetUserUsableGroups(user.Group) {
		groups = append(groups, group)
	}
	models := service.GetGroupsEnabledModels(groups)
	slices.Sort(models)
	body := gin.H{"object": "key.available_routes", "strategies": model.TokenRoutingStrategies, "models": models}
	name := c.Query("model")
	if name == "" {
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, body)
		return
	}
	origin, ok := common.PlatformPortalOrigin(c.Request)
	if !ok {
		abortKeyAPI(c, http.StatusServiceUnavailable, "platform_unavailable", "Platform gateway is not configured")
		return
	}
	identity, err := service.PlatformRelayIdentityHeaders(c.GetInt("id"))
	if err != nil {
		abortKeyAPI(c, http.StatusForbidden, "platform_account_required", "Sign in with your platform account to continue")
		return
	}
	request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet,
		origin+"/api/developer/routing-options?model="+url.QueryEscape(name), nil)
	if err != nil {
		abortKeyAPI(c, http.StatusServiceUnavailable, "platform_unavailable", "Platform request is unavailable")
		return
	}
	request.Header.Set("Accept", "application/json")
	for header, value := range identity {
		request.Header.Set(header, value)
	}
	response, err := platformPortalClient.Do(request)
	if err != nil {
		abortKeyAPI(c, http.StatusBadGateway, "platform_unavailable", "Platform lookup failed")
		return
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, (8<<20)+1))
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			Model  any `json:"model"`
			Routes any `json:"routes"`
		} `json:"data"`
	}
	if err != nil || len(data) > 8<<20 || common.Unmarshal(data, &result) != nil {
		abortKeyAPI(c, http.StatusBadGateway, "platform_unavailable", "Invalid platform response")
		return
	}
	if response.StatusCode == http.StatusNotFound {
		abortKeyAPI(c, http.StatusNotFound, "model_not_found", "Model not found")
		return
	}
	if response.StatusCode != http.StatusOK || !result.Success {
		abortKeyAPI(c, http.StatusBadGateway, "platform_unavailable", "Platform lookup failed")
		return
	}
	body["model"], body["routes"] = result.Data.Model, result.Data.Routes
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, body)
}

type managementKeyStatus struct {
	Enabled    bool    `json:"enabled"`
	MaskedKey  string  `json:"masked_key,omitempty"`
	CreatedAt  *string `json:"created_at"`
	LastUsedAt *string `json:"last_used_at"`
}

func managementKeyStatusOf(key *model.ManagementKey) managementKeyStatus {
	if key == nil {
		return managementKeyStatus{}
	}
	return managementKeyStatus{Enabled: true, MaskedKey: key.MaskedKey(), CreatedAt: keyAPITime(key.CreatedAt), LastUsedAt: keyAPITime(key.LastUsedAt)}
}

// Generating, resetting and closing the management key are console actions:
// a dashboard access token (or any API credential) cannot issue one.
func requireConsoleSession(c *gin.Context) bool {
	if c.GetBool("use_access_token") {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "Manage the API management key from the console"})
		return false
	}
	return true
}

func GetManagementKeyStatus(c *gin.Context) {
	key, err := model.GetManagementKey(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, managementKeyStatusOf(key))
}

// RotateManagementKey creates the account's management key or replaces it. The
// full value is shown in this response once and only its hash is kept.
func RotateManagementKey(c *gin.Context) {
	if !requireConsoleSession(c) {
		return
	}
	previous, err := model.GetManagementKey(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	full, key, err := model.RotateManagementKey(c.GetInt("id"))
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgTokenGenerateFailed)
		common.SysError("failed to rotate management key: " + err.Error())
		return
	}
	tokenAuditParams(c)["rotated"] = previous != nil
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	c.Header("Cache-Control", "no-store")
	common.ApiSuccess(c, gin.H{"key": full, "status": managementKeyStatusOf(key)})
}

func DeleteManagementKey(c *gin.Context) {
	if !requireConsoleSession(c) {
		return
	}
	deleted, err := model.DeleteManagementKey(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	tokenAuditParams(c)["changed"] = deleted
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, managementKeyStatusOf(nil))
}
