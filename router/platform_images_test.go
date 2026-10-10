// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package router

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/plugins"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	settingconfig "github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const imageCompatibilityCatalog = `[
 {"id":"gpt-image-2","type":"image","available":true,"parameters":[{"name":"size","required":true,"options":[{"value":"auto","is_default":true},{"value":"1024x1024"}]},{"name":"quality","options":[{"value":"auto","is_default":true},{"value":"high"}]}]},
 {"id":"gpt-image-2-guan","type":"image","available":true,"parameters":[{"name":"size","options":[{"value":"auto","is_default":true},{"value":"1024x1024"}]},{"name":"quality","options":[{"value":"auto","is_default":true}]}]},
 {"id":"gpt-image-2.5","type":"image","available":true,"parameters":[{"name":"version","required":true,"options":[{"value":"flare","is_default":true}]},{"name":"aspect_ratio","options":[{"value":"auto","is_default":true},{"value":"1:1"},{"value":"3:2"}]},{"name":"resolution","options":[{"value":"auto","is_default":true},{"value":"1K"},{"value":"2K"},{"value":"4K"}]}]},
 {"id":"gemini-3-pro-image-preview","type":"image","available":true,"parameters":[{"name":"aspect_ratio","required":true,"options":[{"value":"auto","is_default":true},{"value":"1:1"},{"value":"3:2"}]}]},
 {"id":"gemini-3-pro-image-preview-guan","type":"image","available":true,"parameters":[{"name":"aspectRatio","required":true,"options":[{"value":"1:1","is_default":true},{"value":"3:2"}]},{"name":"imageSize","required":true,"options":[{"value":"1K","is_default":true},{"value":"2K"},{"value":"4K"}]}]},
 {"id":"doubao-seedream-5-0-260128","type":"image","available":true,"parameters":[{"name":"size","options":[{"value":"2K","is_default":true},{"value":"3K"},{"value":"4K"}]},{"name":"aspect_ratio","options":[{"value":"auto","is_default":true},{"value":"1:1"},{"value":"3:2"}]},{"name":"web_search"}]}
]`

type platformImageTest struct {
	server      *httptest.Server
	engine      *gin.Engine
	mu          sync.Mutex
	submissions int
	quotes      int
	requests    map[string]map[string]any
	png         []byte
	fail        bool
	catalogDown bool
	cancelRead  context.CancelFunc
}

func newPlatformImageTest(t *testing.T) *platformImageTest {
	t.Helper()
	setupRelayRouterTestDB(t)
	// An optional, disposable database exercises the same HTTP/billing cases on
	// the deployment's actual database engine. Never point this at business data.
	if dsn := os.Getenv("PLATFORM_IMAGES_TEST_DSN"); dsn != "" {
		previous, err := model.DB.DB()
		require.NoError(t, err)
		require.NoError(t, previous.Close())
		t.Setenv("SQL_DSN", dsn)
		require.NoError(t, model.InitDB())
		model.LOG_DB = model.DB
		require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Token{}, &model.Ability{}))
	}
	require.NoError(t, model.DB.AutoMigrate(&model.Channel{}, &model.Task{}, &model.Log{}, &model.UserOAuthBinding{}, &model.UserSubscription{}))
	previousRegistry := jsplugin.DefaultRegistry
	previousMemoryCache, previousBatch, previousLog := common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled
	previousSecret, previousAddress := common.CryptoSecret, system_setting.ServerAddress
	previousPoll := service.GetTaskAdaptorFunc
	previousQueryLimit := constant.TaskQueryLimit
	constant.TaskQueryLimit = 100
	previousExpressions := billing_setting.GetPluginBillingExprCopy()
	common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled = false, false, true
	common.CryptoSecret = "fixture-artifact-secret"
	system_setting.ServerAddress = "https://images.example/api/open-platform"
	service.GetTaskAdaptorFunc = func(platform constant.TaskPlatform) service.TaskPollingAdaptor { return relay.GetTaskAdaptor(platform) }
	t.Cleanup(func() {
		jsplugin.DefaultRegistry = previousRegistry
		common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled = previousMemoryCache, previousBatch, previousLog
		common.CryptoSecret, system_setting.ServerAddress = previousSecret, previousAddress
		service.GetTaskAdaptorFunc = previousPoll
		constant.TaskQueryLimit = previousQueryLimit
		encoded, err := common.Marshal(previousExpressions)
		require.NoError(t, err)
		require.NoError(t, settingconfig.GlobalConfig.LoadFromDB(map[string]string{billing_setting.PluginBillingExprOption: string(encoded)}))
	})
	fixture := &platformImageTest{requests: make(map[string]map[string]any)}
	var encoded bytes.Buffer
	require.NoError(t, png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 16, 16))))
	fixture.png = encoded.Bytes()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if request.URL.Path == "/api/developer/platform-catalog" {
			if fixture.catalogDown {
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = io.WriteString(w, `{"success":false}`)
				return
			}
			_, _ = io.WriteString(w, `{"success":true,"data":{"models":`+imageCompatibilityCatalog+`}}`)
			return
		}
		assert.Equal(t, "fixture-relay-secret-01234567890123456789", request.Header.Get("X-Platform-Relay-Secret"))
		assert.Equal(t, "platform-alice", request.Header.Get("X-Platform-User-Id"))
		assert.Equal(t, "Bearer fixture-service-key", request.Header.Get("Authorization"))
		fixture.mu.Lock()
		defer fixture.mu.Unlock()
		switch {
		case request.URL.Path == "/v1/media/quotes":
			fixture.quotes++
			_, _ = io.WriteString(w, `{"authorization_max":0.4,"authorization_token":"signed-fixture-quote","confirmed_price_book_id":"fixture-book"}`)
		case request.Method == http.MethodPost && request.URL.Path == "/v1/media/generations":
			fixture.submissions++
			var input map[string]any
			require.NoError(t, common.DecodeJson(request.Body, &input))
			fixture.requests[input["model"].(string)] = input
			assert.Equal(t, .4, input["authorization_max"])
			assert.Equal(t, "signed-fixture-quote", input["authorization_token"])
			assert.Equal(t, "fixture-book", input["confirmed_price_book_id"])
			_, _ = fmt.Fprintf(w, `{"id":"act_%d","status":"processing","modality":"image","billing":{"state":"pending"}}`, fixture.submissions)
		case strings.HasSuffix(request.URL.Path, "/content"):
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(fixture.png)
		case request.Method == http.MethodGet && strings.HasPrefix(request.URL.Path, "/v1/media/generations/"):
			id := strings.TrimPrefix(request.URL.Path, "/v1/media/generations/")
			status, charge := "completed", .12
			if fixture.fail {
				status, charge = "failed", 0
			}
			_, _ = fmt.Fprintf(w, `{"id":%q,"status":%q,"modality":"image","billing":{"state":"settled","charged":%v}}`, id, status, charge)
		default:
			http.NotFound(w, request)
		}
	}))
	t.Cleanup(upstream.Close)
	previousFetch := *system_setting.GetFetchSetting()
	_, fixturePort, _ := strings.Cut(upstream.URL, "127.0.0.1:")
	system_setting.GetFetchSetting().AllowPrivateIp = true
	system_setting.GetFetchSetting().AllowedPorts = []string{fixturePort}
	t.Cleanup(func() { *system_setting.GetFetchSetting() = previousFetch })
	t.Setenv("PLATFORM_RELAY_SECRET", "fixture-relay-secret-01234567890123456789")
	t.Setenv("PLATFORM_RELAY_OAUTH_PROVIDER_ID", "1")
	t.Setenv("PLATFORM_RELAY_CHANNEL_IDS", "1")
	t.Setenv("PLATFORM_MEDIA_BASE_URL", upstream.URL)
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	previousOrigin := common.OptionMap["PlatformPublicBaseURL"]
	common.OptionMap["PlatformPublicBaseURL"] = upstream.URL
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap["PlatformPublicBaseURL"] = previousOrigin
		if previousOptions == nil {
			common.OptionMap = nil
		}
		common.OptionMapRWMutex.Unlock()
	})
	var catalog []struct {
		ID string `json:"id"`
	}
	require.NoError(t, common.UnmarshalJsonStr(imageCompatibilityCatalog, &catalog))
	names, mapping, expressions := make([]string, 0, len(catalog)), make(map[string]string), make(map[string]string)
	for _, item := range catalog {
		names = append(names, item.ID)
		mapping[item.ID] = "platform-media:" + item.ID
		expressions["platform-media::platform-media:"+item.ID] = `tier("platform", u("platform_credits") * 1)`
	}
	encodedNames, err := common.Marshal(names)
	require.NoError(t, err)
	source, err := plugins.Source("platform-media")
	require.NoError(t, err)
	source = strings.Replace(source, `const PLATFORM_MODELS = ["__platform_media__"];`, "const PLATFORM_MODELS = "+string(encodedNames)+";", 1)
	jsplugin.DefaultRegistry = jsplugin.NewRegistry()
	_, err = jsplugin.DefaultRegistry.RegisterFactory(source, jsplugin.Options{Key: "platform-media"})
	require.NoError(t, err)
	encodedMapping, err := common.Marshal(mapping)
	require.NoError(t, err)
	mappingText := string(encodedMapping)
	settingText := `{"task_plugin_key":"platform-media"}`
	encodedExpressions, err := common.Marshal(expressions)
	require.NoError(t, err)
	require.NoError(t, settingconfig.GlobalConfig.LoadFromDB(map[string]string{billing_setting.PluginBillingExprOption: string(encodedExpressions)}))
	for _, user := range []model.User{{Id: 7, Username: "imagesalice", Status: common.UserStatusEnabled, Group: "default", Quota: 5_000_000}, {Id: 8, Username: "imagesbob", Status: common.UserStatusEnabled, Group: "default", Quota: 5_000_000}} {
		user.AffCode = user.Username
		require.NoError(t, model.DB.Create(&user).Error)
		require.NoError(t, model.DB.Create(&model.Token{UserId: user.Id, Key: user.Username, Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true}).Error)
	}
	require.NoError(t, model.DB.Create(&model.UserOAuthBinding{UserId: 7, ProviderId: 1, ProviderUserId: "platform-alice"}).Error)
	require.NoError(t, model.DB.Create(&model.Token{UserId: 7, Key: "imagesrestricted", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true, ModelLimitsEnabled: true, ModelLimits: "gpt-image-2.5"}).Error)
	channels := []model.Channel{
		{Id: 1, Type: constant.ChannelTypeOpenAI, Name: "platform-chat", Status: common.ChannelStatusEnabled, Key: "fixture-service-key", BaseURL: &upstream.URL, Models: "chat-test", Group: "default"},
		{Id: 2, Type: constant.ChannelTypeTaskPlugin, Name: "platform-media", Status: common.ChannelStatusEnabled, Key: "fixture-service-key", BaseURL: &upstream.URL, Models: strings.Join(names, ","), ModelMapping: &mappingText, Group: "default", Setting: &settingText},
	}
	for _, channel := range channels {
		require.NoError(t, model.DB.Create(&channel).Error)
		for name := range strings.SplitSeq(channel.Models, ",") {
			require.NoError(t, model.DB.Create(&model.Ability{Group: "default", Model: name, ChannelId: channel.Id, Enabled: true}).Error)
		}
	}
	service.InitHttpClient()
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		if c.Request.Method == http.MethodGet && strings.HasPrefix(c.Request.URL.Path, "/v1/media/generations/") {
			if fixture.cancelRead != nil {
				fixture.cancelRead()
			}
			service.RunTaskPollingOnce(c.Request.Context(), nil)
		}
		c.Next()
	})
	engine.GET("/api/platform-catalog", controller.GetPlatformCatalog)
	SetRelayRouter(engine)
	SetTaskRouter(engine)
	engine.NoRoute(SetPluginRouter(engine), func(c *gin.Context) { c.Status(http.StatusNotFound) })
	fixture.server = httptest.NewServer(engine)
	fixture.engine = engine
	t.Cleanup(fixture.server.Close)
	return fixture
}

func (fixture *platformImageTest) generate(t *testing.T, input, key, token string) (int, http.Header, []byte) {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, fixture.server.URL+"/v1/images/generations", strings.NewReader(input))
	require.NoError(t, err)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Idempotency-Key", key)
	response, err := fixture.server.Client().Do(request)
	require.NoError(t, err)
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	return response.StatusCode, response.Header, body
}

func TestPlatformImagesCompatibilityGeneratesSixModelsAndSettlesOnce(t *testing.T) {
	fixture := newPlatformImageTest(t)
	for index, item := range []struct {
		name     string
		expected map[string]any
	}{
		{"gpt-image-2", map[string]any{"size": "1024x1024", "quality": "auto"}},
		{"gpt-image-2-guan", map[string]any{"size": "1024x1024", "quality": "auto"}},
		{"gpt-image-2.5", map[string]any{"aspect_ratio": "1:1", "resolution": "1K", "version": "flare"}},
		{"gemini-3-pro-image-preview", map[string]any{"aspect_ratio": "1:1"}},
		{"gemini-3-pro-image-preview-guan", map[string]any{"aspectRatio": "1:1", "imageSize": "1K"}},
		{"doubao-seedream-5-0-260128", map[string]any{"aspect_ratio": "1:1", "size": "2K"}},
	} {
		t.Run(item.name, func(t *testing.T) {
			input := fmt.Sprintf(`{"model":%q,"prompt":"A red square on white","size":"1024x1024","quality":"standard","n":1}`, item.name)
			key := fmt.Sprintf("fixture-image-%d", index)
			status, headers, body := fixture.generate(t, input, key, "imagesalice")
			require.Equal(t, http.StatusOK, status, string(body))
			var response struct {
				Created int64 `json:"created"`
				Data    []struct {
					Base64 string `json:"b64_json"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(body, &response))
			require.Len(t, response.Data, 1)
			decoded, err := base64.StdEncoding.DecodeString(response.Data[0].Base64)
			require.NoError(t, err)
			assert.Equal(t, fixture.png, decoded)
			assert.Positive(t, response.Created)
			assert.Equal(t, item.expected, fixture.requests[item.name]["params"])
			assert.NotEmpty(t, headers.Get("X-Task-Id"))
			fixture.catalogDown = true
			status, replayHeaders, replayBody := fixture.generate(t, input, key, "imagesalice")
			fixture.catalogDown = false
			require.Equal(t, http.StatusOK, status, string(replayBody))
			assert.Equal(t, "true", replayHeaders.Get("Idempotent-Replayed"))
			assert.Equal(t, headers.Get("X-Task-Id"), replayHeaders.Get("X-Task-Id"))
		})
	}
	assert.Equal(t, 6, fixture.submissions)
	assert.Equal(t, 6, fixture.quotes)
	var user model.User
	require.NoError(t, model.DB.First(&user, 7).Error)
	assert.Equal(t, 5_000_000-6*60_000, user.Quota, "native reservations must settle to measured platform cost once")
}

func TestPlatformImagesCompatibilityRejectsUnsafeRequestsAndPreservesOwnership(t *testing.T) {
	fixture := newPlatformImageTest(t)
	input := `{"model":"gpt-image-2","prompt":"A red square","response_format":"url"}`
	status, _, body := fixture.generate(t, input, "fixture-valid-image", "imagesalice")
	require.Equal(t, http.StatusOK, status, string(body))
	assert.Contains(t, string(body), `"url":"https://images.example/api/open-platform/v1/tasks/`)
	assert.Contains(t, string(body), "access=")
	for _, invalid := range []string{
		`{"model":"gpt-image-2","prompt":"x","n":0}`,
		`{"model":"gpt-image-2","prompt":"x","n":2}`,
		`{"model":"gpt-image-2","prompt":"x","n":18446744073686646784}`,
		`{"model":"gpt-image-2","prompt":"x","stream":true}`,
		`{"model":"gpt-image-2","prompt":"x","response_format":"bad"}`,
		`{"model":"gpt-image-2","prompt":"x","authorization_max":0}`,
		`{"model":"gemini-3-pro-image-preview-guan","prompt":"x","size":"bad"}`,
	} {
		status, _, response := fixture.generate(t, invalid, "fixture-rejected-image", "imagesalice")
		assert.Equal(t, http.StatusBadRequest, status, string(response))
	}
	status, _, response := fixture.generate(t, input, "fixture-valid-image", "imagesrestricted")
	assert.Equal(t, http.StatusForbidden, status, string(response))
	status, _, response = fixture.generate(t, strings.Replace(input, "A red square", "A blue square", 1), "fixture-valid-image", "imagesalice")
	assert.Equal(t, http.StatusConflict, status, string(response))
	status, _, response = fixture.generate(t, input, "fixture-valid-image", "imagesbob")
	assert.Equal(t, http.StatusForbidden, status, "an unbound user must not replay or pay as Alice: "+string(response))
	assert.Equal(t, 1, fixture.submissions)
	var bob model.User
	require.NoError(t, model.DB.First(&bob, 8).Error)
	assert.Equal(t, 5_000_000, bob.Quota)
}

func TestPlatformImagesCompatibilityRefundsConfirmedFailure(t *testing.T) {
	fixture := newPlatformImageTest(t)
	fixture.fail = true
	status, headers, body := fixture.generate(t, `{"model":"gpt-image-2","prompt":"fixture failure"}`, "fixture-failed-image", "imagesalice")
	require.Equal(t, http.StatusBadGateway, status, string(body))
	assert.Contains(t, string(body), "image_generation_failed")
	assert.NotEmpty(t, headers.Get("X-Task-Id"))
	var user model.User
	require.NoError(t, model.DB.First(&user, 7).Error)
	assert.Equal(t, 5_000_000, user.Quota)
	assert.Equal(t, 1, fixture.submissions)
}

func TestPlatformImagesCompatibilityCountsOnePublicRequestForRateLimits(t *testing.T) {
	fixture := newPlatformImageTest(t)
	previousEnabled, previousCount, previousSuccess := setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount
	previousGroups := setting.ModelRequestRateLimitGroup
	setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount = true, 1, 1
	setting.ModelRequestRateLimitGroup = map[string][2]int{}
	t.Cleanup(func() {
		setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount = previousEnabled, previousCount, previousSuccess
		setting.ModelRequestRateLimitGroup = previousGroups
	})
	input := `{"model":"gpt-image-2","prompt":"one public request"}`
	status, _, body := fixture.generate(t, input, "fixture-rate-limited", "imagesalice")
	require.Equal(t, http.StatusOK, status, string(body))
	status, _, body = fixture.generate(t, input, "fixture-next-request", "imagesalice")
	assert.Equal(t, http.StatusTooManyRequests, status, string(body))
	assert.Equal(t, 1, fixture.submissions)
}

func TestPlatformImagesCompatibilityResumesAfterInterruptedWait(t *testing.T) {
	fixture := newPlatformImageTest(t)
	input := `{"model":"gpt-image-2","prompt":"resume this image"}`
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	fixture.cancelRead = cancel
	request := httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(input)).WithContext(ctx)
	request.Header.Set("Authorization", "Bearer imagesalice")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "fixture-resume-image")
	response := httptest.NewRecorder()
	fixture.engine.ServeHTTP(response, request)
	require.Equal(t, http.StatusGatewayTimeout, response.Code, response.Body.String())
	assert.Contains(t, response.Body.String(), "image_generation_pending")
	taskID := response.Header().Get("X-Task-Id")
	require.NotEmpty(t, taskID)
	assert.Equal(t, 1, fixture.submissions)
	fixture.cancelRead = nil
	status, headers, body := fixture.generate(t, input, "fixture-resume-image", "imagesalice")
	require.Equal(t, http.StatusOK, status, string(body))
	assert.Equal(t, "true", headers.Get("Idempotent-Replayed"))
	assert.Equal(t, taskID, headers.Get("X-Task-Id"))
	assert.Equal(t, 1, fixture.submissions)
	assert.Equal(t, 1, fixture.quotes)
	var user model.User
	require.NoError(t, model.DB.First(&user, 7).Error)
	assert.Equal(t, 5_000_000-60_000, user.Quota)
}
