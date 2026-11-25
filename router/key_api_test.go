// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
// New file: /v1/key self-service and the /v1/keys management key.
package router

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type keyAPITest struct {
	*platformNativeTest
}

func newKeyAPITest(t *testing.T) *keyAPITest {
	t.Helper()
	fixture := newPlatformNativeTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ManagementKey{}, &model.AuditLog{}))
	for _, name := range []string{"gpt-image-2", "speech-2.8"} {
		require.NoError(t, model.DB.Create(&model.Ability{Group: "default", Model: name, ChannelId: 1, Enabled: true}).Error)
	}
	return &keyAPITest{fixture}
}

func (fixture *keyAPITest) call(method, target, credential, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "key-api-test/1.0")
	if credential != "" {
		request.Header.Set("Authorization", "Bearer "+credential)
	}
	response := httptest.NewRecorder()
	fixture.engine.ServeHTTP(response, request)
	return response
}

// consoleManagementKey drives the console handlers as a signed-in session (or a dashboard access token).
func consoleManagementKey(t *testing.T, handler gin.HandlerFunc, method string, userID int, accessToken bool) map[string]any {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(method, "/api/token/management-key", nil)
	ctx.Set("id", userID)
	ctx.Set("use_access_token", accessToken)
	handler(ctx)
	var body map[string]any
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &body), recorder.Body.String())
	if accessToken {
		assert.Equal(t, http.StatusForbidden, recorder.Code)
	}
	return body
}

func decodeKeyAPI(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body), response.Body.String())
	return body
}

func errorCode(t *testing.T, response *httptest.ResponseRecorder) string {
	t.Helper()
	failure, _ := decodeKeyAPI(t, response)["error"].(map[string]any)
	code, _ := failure["code"].(string)
	return code
}

func TestManagementKeyIsIssuedInTheConsoleAndStoredOnlyAsAHash(t *testing.T) {
	fixture := newKeyAPITest(t)
	refused := consoleManagementKey(t, controller.RotateManagementKey, http.MethodPost, 9101, true)
	assert.Equal(t, false, refused["success"], "a dashboard access token cannot issue the management key")

	first := consoleManagementKey(t, controller.RotateManagementKey, http.MethodPost, 9101, false)
	require.Equal(t, true, first["success"], first)
	firstKey := first["data"].(map[string]any)["key"].(string)
	require.True(t, strings.HasPrefix(firstKey, "sk-mgmt-"))
	var stored model.ManagementKey
	require.NoError(t, model.DB.Where("user_id = ?", 9101).First(&stored).Error)
	assert.Equal(t, model.AccessTokenFingerprint(firstKey), stored.KeyHash)
	assert.NotContains(t, stored.KeyHash+stored.KeyTail, firstKey[len("sk-mgmt-"):len(firstKey)-4])

	status := consoleManagementKey(t, controller.GetManagementKeyStatus, http.MethodGet, 9101, false)
	assert.NotContains(t, fmt.Sprint(status), firstKey, "the status never shows the full key again")
	assert.Equal(t, "sk-mgmt-****"+firstKey[len(firstKey)-4:], status["data"].(map[string]any)["masked_key"])
	require.Equal(t, http.StatusOK, fixture.call(http.MethodGet, "/v1/keys", firstKey, "").Code)

	second := consoleManagementKey(t, controller.RotateManagementKey, http.MethodPost, 9101, false)
	secondKey := second["data"].(map[string]any)["key"].(string)
	var count int64
	require.NoError(t, model.DB.Model(&model.ManagementKey{}).Where("user_id = ?", 9101).Count(&count).Error)
	assert.Equal(t, int64(1), count, "one management key per account")
	assert.Equal(t, http.StatusUnauthorized, fixture.call(http.MethodGet, "/v1/keys", firstKey, "").Code, "reset revokes the old key")
	assert.Equal(t, http.StatusOK, fixture.call(http.MethodGet, "/v1/keys", secondKey, "").Code)

	consoleManagementKey(t, controller.DeleteManagementKey, http.MethodDelete, 9101, true)
	assert.Equal(t, http.StatusOK, fixture.call(http.MethodGet, "/v1/keys", secondKey, "").Code, "an access token cannot close it either")
	closed := consoleManagementKey(t, controller.DeleteManagementKey, http.MethodDelete, 9101, false)
	assert.Equal(t, false, closed["data"].(map[string]any)["enabled"])
	assert.Equal(t, http.StatusUnauthorized, fixture.call(http.MethodGet, "/v1/keys", secondKey, "").Code)
}

func TestManagementKeyReachesOnlyTheKeyEndpoints(t *testing.T) {
	fixture := newKeyAPITest(t)
	full, _, err := model.RotateManagementKey(9101)
	require.NoError(t, err)
	for _, item := range []struct{ method, target, body string }{
		{http.MethodPost, "/v1/chat/completions", `{"model":"chat-test","messages":[{"role":"user","content":"hi"}]}`},
		{http.MethodGet, "/v1/balance", ""},
		{http.MethodPost, "/v1/recharge/orders", `{"amount":"10.00","payment_method":"alipay"}`},
		{http.MethodGet, "/v1/models", ""},
		{http.MethodGet, "/v1/key", ""},
	} {
		response := fixture.call(item.method, item.target, full, item.body)
		assert.Equal(t, http.StatusUnauthorized, response.Code, "%s %s: %s", item.method, item.target, response.Body.String())
	}
	assert.Empty(t, fixture.recorded(), "the management key never reaches the platform")
	for _, item := range []struct{ method, target string }{
		{http.MethodGet, "/v1/keys"},
		{http.MethodPost, "/v1/keys"},
		{http.MethodGet, "/v1/keys/available-routes"},
		{http.MethodDelete, fmt.Sprintf("/v1/keys/%d", fixture.tokens["nativeowner"].Id)},
	} {
		response := fixture.call(item.method, item.target, "sk-nativeowner", `{"name":"x"}`)
		assert.Equal(t, http.StatusForbidden, response.Code, item.target)
		assert.Equal(t, "management_key_required", errorCode(t, response))
	}
	assert.Equal(t, http.StatusUnauthorized, fixture.call(http.MethodGet, "/v1/keys", "", "").Code)
	assert.Equal(t, "invalid_management_key", errorCode(t, fixture.call(http.MethodGet, "/v1/keys", "sk-mgmt-forged", "")))
	var tokens int64
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", fixture.tokens["nativeowner"].Id).Count(&tokens).Error)
	assert.Equal(t, int64(1), tokens, "a model key cannot delete keys")
}

func TestManagementKeyAdministersOnlyItsOwnAccount(t *testing.T) {
	fixture := newKeyAPITest(t)
	full, row, err := model.RotateManagementKey(9101)
	require.NoError(t, err)
	foreign := fixture.tokens["nativeunbound"]

	listed := fixture.call(http.MethodGet, "/v1/keys?p=1&size=50", full, "")
	require.Equal(t, http.StatusOK, listed.Code, listed.Body.String())
	page := decodeKeyAPI(t, listed)
	assert.EqualValues(t, 5, page["total"])
	assert.NotContains(t, listed.Body.String(), "nativeunbound")
	assert.NotContains(t, listed.Body.String(), `"nativeowner"`, "listed keys are masked")
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
		response := fixture.call(method, fmt.Sprintf("/v1/keys/%d", foreign.Id), full, `{"name":"taken over"}`)
		assert.Equal(t, http.StatusNotFound, response.Code, method)
		assert.Equal(t, "key_not_found", errorCode(t, response))
	}
	var untouched model.Token
	require.NoError(t, model.DB.First(&untouched, foreign.Id).Error)
	assert.Equal(t, foreign.Name, untouched.Name)

	created := fixture.call(http.MethodPost, "/v1/keys", full, `{"name":"ci-bot","model_limits":["gpt-image-2"],
		"quota":{"unlimited":false,"limit":12.5},"allow_ips":["10.0.0.0/8","203.0.113.7"],"expires_at":4102444800,"allow_api_edit":true}`)
	require.Equal(t, http.StatusCreated, created.Code, created.Body.String())
	key := decodeKeyAPI(t, created)
	fullKey := key["key"].(string)
	require.True(t, strings.HasPrefix(fullKey, "sk-") && len(fullKey) == 51, fullKey)
	id := int(key["id"].(float64))
	assert.Equal(t, map[string]any{"unlimited": false, "limit": 12.5, "used": 0.0, "remaining": 12.5, "unit": "credits"}, key["quota"])
	assert.Equal(t, []any{"gpt-image-2"}, key["model_limits"])
	assert.Equal(t, []any{"10.0.0.0/8", "203.0.113.7"}, key["allow_ips"])
	assert.Equal(t, "2100-01-01T00:00:00Z", key["expires_at"])
	assert.Equal(t, true, key["api_edit_allowed"])
	assert.Equal(t, "balanced", key["routing_strategy"], "new keys get the console's default strategy")
	var saved model.Token
	require.NoError(t, model.DB.First(&saved, id).Error)
	assert.Equal(t, 9101, saved.UserId)
	assert.Equal(t, int(12.5*common.QuotaPerUnit), saved.RemainQuota)
	assert.Equal(t, "sk-"+saved.Key, fullKey)
	read := fixture.call(http.MethodGet, fmt.Sprintf("/v1/keys/%d", id), full, "")
	require.Equal(t, http.StatusOK, read.Code)
	assert.NotContains(t, read.Body.String(), saved.Key, "only the create response carries the full key")

	updated := fixture.call(http.MethodPost, fmt.Sprintf("/v1/keys/%d", id), full, `{"name":"ci-bot-2","status":"disabled","allow_ips":null}`)
	require.Equal(t, http.StatusOK, updated.Code, updated.Body.String())
	assert.Equal(t, "disabled", decodeKeyAPI(t, updated)["status"])
	assert.Equal(t, http.StatusBadRequest, fixture.call(http.MethodPost, fmt.Sprintf("/v1/keys/%d", id), full, `{"group":"vip"}`).Code)
	assert.Equal(t, http.StatusBadRequest, fixture.call(http.MethodPost, fmt.Sprintf("/v1/keys/%d", id), full, `{"allow_ips":["not-an-ip"]}`).Code)
	deleted := fixture.call(http.MethodDelete, fmt.Sprintf("/v1/keys/%d", id), full, "")
	require.Equal(t, http.StatusOK, deleted.Code)
	assert.Equal(t, http.StatusNotFound, fixture.call(http.MethodGet, fmt.Sprintf("/v1/keys/%d", id), full, "").Code)

	var audits []model.AuditLog
	require.NoError(t, model.DB.Where("route LIKE ?", "/v1/keys%").Order("id").Find(&audits).Error)
	actions := []string{}
	for _, audit := range audits {
		actions = append(actions, fmt.Sprintf("%s:%t", audit.Action, audit.Success))
		assert.Equal(t, "management_key", audit.AuthMethod)
		assert.Equal(t, row.KeyHash, audit.TokenRef)
		assert.Equal(t, "key-api-test/1.0", audit.UserAgent)
		assert.NotEmpty(t, audit.Ip)
		assert.Equal(t, 9101, audit.UserId)
		assert.NotContains(t, fmt.Sprint(audit.Other), saved.Key)
	}
	assert.Equal(t, []string{"token.update:false", "token.delete:false", "token.create:true", "token.update:true",
		"token.update:false", "token.update:false", "token.delete:true"}, actions,
		"every create, update and delete is audited, including refused cross-account attempts")
}

func TestManagedKeyRoutesComeFromTheAccountAndThePlatform(t *testing.T) {
	fixture := newKeyAPITest(t)
	full, _, err := model.RotateManagementKey(9101)
	require.NoError(t, err)
	listed := fixture.call(http.MethodGet, "/v1/keys/available-routes", full, "")
	require.Equal(t, http.StatusOK, listed.Code, listed.Body.String())
	assert.JSONEq(t, `{"object":"key.available_routes","strategies":["balanced","cheapest","fastest","most_reliable"],
		"models":["gpt-image-2","speech-2.8"]}`, listed.Body.String())

	options := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/developer/routing-options", r.URL.Path)
		assert.Equal(t, "gpt-image-2", r.URL.Query().Get("model"))
		assert.Equal(t, nativeRelaySecret, r.Header.Get("X-Platform-Relay-Secret"))
		assert.Equal(t, "platform-native-owner", r.Header.Get("X-Platform-User-Id"))
		_, _ = io.WriteString(w, `{"success":true,"data":{"model":{"id":"gpt-image-2"},"routes":[{"id":"aaaaaaaaaaaaaaaaaaaaaaaa"}],"statisticsAvailable":false}}`)
	}))
	t.Cleanup(options.Close)
	common.OptionMapRWMutex.Lock()
	common.OptionMap = map[string]string{"PlatformPublicBaseURL": options.URL}
	common.OptionMapRWMutex.Unlock()
	routes := fixture.call(http.MethodGet, "/v1/keys/available-routes?model=gpt-image-2", full, "")
	require.Equal(t, http.StatusOK, routes.Code, routes.Body.String())
	body := decodeKeyAPI(t, routes)
	assert.Equal(t, map[string]any{"id": "gpt-image-2"}, body["model"])
	assert.Equal(t, []any{map[string]any{"id": "aaaaaaaaaaaaaaaaaaaaaaaa"}}, body["routes"])
}

func TestPortalKeyReadsItselfAndEditsOnlyWhenAllowed(t *testing.T) {
	fixture := newKeyAPITest(t)
	self := fixture.call(http.MethodGet, "/v1/key", "sk-nativespeech", "")
	require.Equal(t, http.StatusOK, self.Code, self.Body.String())
	view := decodeKeyAPI(t, self)
	assert.Equal(t, "api_key", view["object"])
	assert.EqualValues(t, fixture.tokens["nativespeech"].Id, view["id"])
	assert.Equal(t, []any{"gpt-image-2", "speech-2.8"}, view["model_limits"])
	assert.Equal(t, false, view["api_edit_allowed"])
	assert.Equal(t, "enabled", view["status"])
	assert.Equal(t, "default", view["routing_strategy"])
	assert.NotContains(t, self.Body.String(), "nativespeech", "the key is masked")

	denied := fixture.call(http.MethodPost, "/v1/key", "sk-nativespeech", `{"name":"renamed"}`)
	assert.Equal(t, http.StatusForbidden, denied.Code)
	assert.Equal(t, "api_edit_not_allowed", errorCode(t, denied))

	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", fixture.tokens["nativespeech"].Id).Update("allow_api_edit", true).Error)
	for _, body := range []string{`{"quota":{"unlimited":false,"limit":1}}`, `{"allow_ips":["10.0.0.1"]}`, `{"allow_api_edit":false}`, `{"model_limits":null}`} {
		refused := fixture.call(http.MethodPost, "/v1/key", "sk-nativespeech", body)
		assert.Equal(t, http.StatusBadRequest, refused.Code, body)
		assert.Equal(t, "field_not_editable", errorCode(t, refused), body)
	}
	renamed := fixture.call(http.MethodPost, "/v1/key", "sk-nativespeech", `{"name":"renamed","routing_policy":{"version":2,"mode":"automatic",
		"default_strategy":"cheapest","allowed_strategies":["cheapest"],"allow_fixed_routes":false,"model_rules":[]}}`)
	require.Equal(t, http.StatusOK, renamed.Code, renamed.Body.String())
	assert.Equal(t, "renamed", decodeKeyAPI(t, renamed)["name"])
	assert.Equal(t, "cheapest", decodeKeyAPI(t, renamed)["routing_strategy"])
	var saved model.Token
	require.NoError(t, model.DB.First(&saved, fixture.tokens["nativespeech"].Id).Error)
	assert.True(t, saved.UnlimitedQuota)
	assert.Equal(t, "gpt-image-2,speech-2.8", saved.ModelLimits)

	disabled := fixture.call(http.MethodPost, "/v1/key", "sk-nativespeech", `{"status":"disabled"}`)
	require.Equal(t, http.StatusOK, disabled.Code)
	assert.Equal(t, http.StatusUnauthorized, fixture.call(http.MethodGet, "/v1/key", "sk-nativespeech", "").Code)

	var audits []model.AuditLog
	require.NoError(t, model.DB.Where("route = ?", "/v1/key").Order("id").Find(&audits).Error)
	require.Len(t, audits, 7)
	assert.False(t, audits[0].Success, "the refused edit is audited too")
	assert.True(t, audits[6].Success)
	assert.Equal(t, "api_key", audits[6].AuthMethod)
	assert.Equal(t, 1, audits[6].ActorRole)
	assert.Contains(t, fmt.Sprintf("%s", audits[6].Other.Op.Params["changed_fields"]), `"status"`)
	assert.Empty(t, fixture.recorded(), "an automatic policy needs no platform route check")
}
