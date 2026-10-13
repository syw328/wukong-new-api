package router

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChatStreamFailureBilling(t *testing.T) {
	setupRelayRouterTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.Channel{}, &model.Log{}, &model.UserSubscription{}))
	oldCache, oldBatch, oldLogs, oldTimeout := common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled, constant.StreamingTimeout
	common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled, constant.StreamingTimeout = false, false, true, 10
	t.Cleanup(func() {
		common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled, constant.StreamingTimeout = oldCache, oldBatch, oldLogs, oldTimeout
	})
	t.Setenv("PLATFORM_RELAY_SECRET", "")
	oldRatios, err := common.Marshal(ratio_setting.GetModelRatioCopy())
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-4o-mini":1}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(oldRatios))) })
	role := `data: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}` + "\n\n"
	usage := `data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":1,"total_tokens":8}}` + "\n\n"
	errorFrame := `data: {"error":{"type":"invalid_request_error","message":"Upstream model access is unavailable"}}` + "\n\n"
	var response string
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		require.Equal(t, "/v1/chat/completions", r.URL.Path)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, response)
	}))
	t.Cleanup(upstream.Close)
	oldFetch := *system_setting.GetFetchSetting()
	system_setting.GetFetchSetting().AllowPrivateIp = true
	_, port, _ := strings.Cut(upstream.URL, "127.0.0.1:")
	system_setting.GetFetchSetting().AllowedPorts = []string{port}
	t.Cleanup(func() { *system_setting.GetFetchSetting() = oldFetch })
	channel := model.Channel{Id: 1, Type: constant.ChannelTypeOpenAI, Name: "stream-billing", Status: common.ChannelStatusEnabled, Key: "fixture", BaseURL: &upstream.URL, Models: "gpt-4o-mini", Group: "default"}
	require.NoError(t, model.DB.Create(&channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{Group: "default", Model: "gpt-4o-mini", ChannelId: 1, Enabled: true}).Error)
	service.InitHttpClient()
	engine := gin.New()
	SetRelayRouter(engine)
	cases := []struct {
		name, body string
		success    bool
	}{
		{"error-first", errorFrame, false},
		{"error-after-role", role + errorFrame, false},
		{"empty", role, false},
		{"malformed", role + "data: {broken\n\n", false},
		{"text", role + `data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}` + "\n\n" + usage, true},
		{"tools", role + `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}` + "\n\n" + usage, true},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			response = tc.body + "data: [DONE]\n\n"
			calls.Store(0)
			name := fmt.Sprintf("streamcustomer%d", i)
			user := model.User{Username: name, AffCode: name, Status: common.UserStatusEnabled, Group: "default", Quota: 5_000_000}
			require.NoError(t, model.DB.Create(&user).Error)
			token := model.Token{UserId: user.Id, Key: name, Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 5_000_000}
			require.NoError(t, model.DB.Create(&token).Error)
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"stream":true,"max_tokens":512}`))
			request.Header.Set("Authorization", "Bearer "+name)
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)
			if tc.success {
				assert.NotContains(t, recorder.Body.String(), `"error"`, recorder.Body.String())
				assert.Contains(t, recorder.Body.String(), "data: [DONE]")
			} else {
				assert.Contains(t, recorder.Body.String(), `data: {"error":`, recorder.Body.String())
				assert.Contains(t, recorder.Body.String(), "data: [DONE]")
			}
			assert.EqualValues(t, 1, calls.Load(), "a failed accepted stream must not be dispatched again")
			require.Eventually(t, func() bool {
				var current model.User
				if model.DB.First(&current, user.Id).Error != nil {
					return false
				}
				var currentToken model.Token
				if model.DB.First(&currentToken, token.Id).Error != nil {
					return false
				}
				return (tc.success && current.UsedQuota > 0 && currentToken.UsedQuota == current.UsedQuota) ||
					(!tc.success && current.Quota == 5_000_000 && currentToken.RemainQuota == 5_000_000 && currentToken.UsedQuota == 0)
			}, 3*time.Second, 10*time.Millisecond)
			require.NoError(t, model.DB.First(&user, user.Id).Error)
			require.NoError(t, model.DB.First(&token, token.Id).Error)
			if !tc.success {
				assert.Zero(t, user.UsedQuota)
				assert.Zero(t, user.RequestCount)
				assert.Zero(t, token.UsedQuota)
				assert.Equal(t, 5_000_000, token.RemainQuota)
				var n int64
				require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("user_id = ? AND type = ?", user.Id, 2).Count(&n).Error)
				assert.Zero(t, n, "failed streams must not create successful consumption history")
			} else {
				assert.Positive(t, user.UsedQuota)
				assert.Equal(t, user.UsedQuota, token.UsedQuota)
				assert.Equal(t, 5_000_000-user.UsedQuota, user.Quota)
			}
		})
	}
}
