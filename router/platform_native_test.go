// Copyright (C) 2026 QuantumNous and contributors. Licensed under AGPL-3.0-or-later.
// Modified for platform-native reference uploads and voice cloning on the portal.
package router

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const nativeRelaySecret = "native-relay-fixture-secret-0123456789abcdef"

type platformNativeCall struct {
	method, path, query, contentType, idempotencyKey, keyContext string
	contentLength                                                int64
	digest                                                       [32]byte
}

type platformNativeTest struct {
	engine  *gin.Engine
	mu      sync.Mutex
	calls   []platformNativeCall
	tokens  map[string]*model.Token
	reply   func(w http.ResponseWriter, r *http.Request)
	onBytes func(r *http.Request) ([32]byte, error)
}

func newPlatformNativeTest(t *testing.T) *platformNativeTest {
	t.Helper()
	setupRelayRouterTestDB(t)
	require.NoError(t, i18n.Init())
	require.NoError(t, model.DB.AutoMigrate(&model.Channel{}, &model.UserOAuthBinding{}))
	previousMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() { common.MemoryCacheEnabled = previousMemoryCache })
	fixture := &platformNativeTest{tokens: map[string]*model.Token{}}
	platform := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, nativeRelaySecret, r.Header.Get("X-Platform-Relay-Secret"))
		assert.Equal(t, "platform-native-owner", r.Header.Get("X-Platform-User-Id"))
		assert.Equal(t, "Bearer fixture-native-service-key", r.Header.Get("Authorization"))
		assert.Empty(t, r.Header.Get("Cookie"))
		call := platformNativeCall{method: r.Method, path: r.URL.Path, query: r.URL.RawQuery,
			contentType: r.Header.Get("Content-Type"), idempotencyKey: r.Header.Get("Idempotency-Key"),
			keyContext: r.Header.Get("X-Platform-Key-Context"), contentLength: r.ContentLength}
		if fixture.onBytes != nil {
			digest, err := fixture.onBytes(r)
			assert.NoError(t, err)
			call.digest = digest
		} else {
			raw, err := io.ReadAll(r.Body)
			assert.NoError(t, err)
			call.digest = sha256.Sum256(raw)
		}
		fixture.mu.Lock()
		fixture.calls = append(fixture.calls, call)
		fixture.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("RateLimit-Limit", "12")
		w.Header().Set("X-Internal-Upstream", "must-not-leak")
		if fixture.reply != nil {
			fixture.reply(w, r)
			return
		}
		status := http.StatusOK
		if r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v1/upload") {
			status = http.StatusCreated
		}
		w.WriteHeader(status)
		_, _ = fmt.Fprintf(w, `{"echo":%q}`, r.URL.Path)
	}))
	t.Cleanup(platform.Close)
	t.Setenv("PLATFORM_RELAY_SECRET", nativeRelaySecret)
	t.Setenv("PLATFORM_RELAY_OAUTH_PROVIDER_ID", "1")
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{"PlatformPublicBaseURL": platform.URL}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
	for _, user := range []model.User{
		{Id: 9101, Username: "nativeowner", AffCode: "nativeowner", Status: common.UserStatusEnabled, Group: "default"},
		{Id: 9102, Username: "nativeunbound", AffCode: "nativeunbound", Status: common.UserStatusEnabled, Group: "default"},
	} {
		require.NoError(t, model.DB.Create(&user).Error)
	}
	require.NoError(t, model.DB.Create(&model.UserOAuthBinding{UserId: 9101, ProviderId: 1, ProviderUserId: "platform-native-owner"}).Error)
	for _, token := range []model.Token{
		{UserId: 9101, Key: "nativeowner", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true},
		{UserId: 9101, Key: "nativespeech", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true, ModelLimitsEnabled: true, ModelLimits: "gpt-image-2,speech-2.8"},
		{UserId: 9101, Key: "nativeimageonly", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true, ModelLimitsEnabled: true, ModelLimits: "gpt-image-2"},
		{UserId: 9101, Key: "nativedisabled", Status: common.TokenStatusDisabled, ExpiredTime: -1, UnlimitedQuota: true},
		{UserId: 9101, Key: "nativeexpired", Status: common.TokenStatusEnabled, ExpiredTime: 1, UnlimitedQuota: true},
		{UserId: 9102, Key: "nativeunbound", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true},
	} {
		require.NoError(t, model.DB.Create(&token).Error)
		fixture.tokens[token.Key] = &token
	}
	require.NoError(t, model.DB.Create(&model.Channel{Id: 1, Type: constant.ChannelTypeOpenAI, Name: "platform-gateway",
		Status: common.ChannelStatusEnabled, Key: "fixture-native-service-key", Models: "chat-test", Group: "default"}).Error)
	fixture.engine = gin.New()
	SetRelayRouter(fixture.engine)
	return fixture
}

func (fixture *platformNativeTest) send(request *http.Request, token string) *httptest.ResponseRecorder {
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Cookie", "session=never-forwarded")
	request.Header.Set("X-Platform-User-Id", "forged-user")
	request.Header.Set("X-Platform-Key-Context", "forged-context")
	response := httptest.NewRecorder()
	fixture.engine.ServeHTTP(response, request)
	return response
}

func (fixture *platformNativeTest) recorded() []platformNativeCall {
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	return append([]platformNativeCall(nil), fixture.calls...)
}

func nativeMultipart(t *testing.T, field, filename string, content []byte) ([]byte, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile(field, filename)
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	return body.Bytes(), writer.FormDataContentType()
}

func TestPlatformUploadsRelayMultipartWithRelayIdentity(t *testing.T) {
	fixture := newPlatformNativeTest(t)
	for _, item := range []struct{ path, field, filename string }{
		{"/v1/upload", "files", "sample.wav"},
		{"/v1/uploads/images", "image", "first-frame.png"},
		{"/v1/uploads/videos", "video", "reference.mp4"},
	} {
		body, contentType := nativeMultipart(t, item.field, item.filename, []byte("fixture media for "+item.path))
		request := httptest.NewRequest(http.MethodPost, item.path+"?user_id=someone-else", bytes.NewReader(body))
		request.Header.Set("Content-Type", contentType)
		response := fixture.send(request, "sk-nativeowner")
		require.Equal(t, http.StatusCreated, response.Code, response.Body.String())
		assert.JSONEq(t, fmt.Sprintf(`{"echo":%q}`, item.path), response.Body.String())
		assert.Equal(t, "12", response.Header().Get("RateLimit-Limit"))
		assert.Equal(t, "private, no-store", response.Header().Get("Cache-Control"))
		assert.Empty(t, response.Header().Get("X-Internal-Upstream"))
		calls := fixture.recorded()
		call := calls[len(calls)-1]
		assert.Equal(t, platformNativeCall{method: http.MethodPost, path: item.path, contentType: contentType,
			contentLength: int64(len(body)), digest: sha256.Sum256(body)}, call,
			"the platform receives the same multipart bytes, boundary and length without the caller's query or forged context")
	}
	assert.Len(t, fixture.recorded(), 3)
}

// The platform starts reading before the caller has finished sending, so the
// portal never holds a whole upload in memory.
func TestPlatformUploadStreamsBodyBeforeTheCallerFinishes(t *testing.T) {
	fixture := newPlatformNativeTest(t)
	payload := bytes.Repeat([]byte("v"), 4<<20)
	body, contentType := nativeMultipart(t, "video", "long.mp4", payload)
	head, tail := body[:1<<20], body[1<<20:]
	received := make(chan struct{})
	fixture.onBytes = func(r *http.Request) ([32]byte, error) {
		hash := sha256.New()
		if _, err := io.CopyN(hash, r.Body, int64(len(head))); err != nil {
			return [32]byte{}, err
		}
		close(received)
		if _, err := io.Copy(hash, r.Body); err != nil {
			return [32]byte{}, err
		}
		var digest [32]byte
		copy(digest[:], hash.Sum(nil))
		return digest, nil
	}
	reader, writer := io.Pipe()
	go func() {
		if _, err := writer.Write(head); err != nil {
			return
		}
		select {
		case <-received:
			_, err := writer.Write(tail)
			_ = writer.CloseWithError(err)
		case <-time.After(30 * time.Second):
			_ = writer.CloseWithError(errors.New("the platform received nothing before the caller finished"))
		}
	}()
	request := httptest.NewRequest(http.MethodPost, "/v1/uploads/videos", reader)
	request.ContentLength = int64(len(body))
	request.Header.Set("Content-Type", contentType)
	response := fixture.send(request, "nativeowner")
	require.Equal(t, http.StatusCreated, response.Code, response.Body.String())
	calls := fixture.recorded()
	require.Len(t, calls, 1)
	assert.Equal(t, sha256.Sum256(body), calls[0].digest)
	assert.Equal(t, int64(len(body)), calls[0].contentLength)
}

func TestPlatformUploadRejectionsNeverReachThePlatform(t *testing.T) {
	fixture := newPlatformNativeTest(t)
	small, contentType := nativeMultipart(t, "image", "ref.png", []byte("png"))
	oversized, oversizedType := nativeMultipart(t, "image", "big.png", bytes.Repeat([]byte("p"), 3<<20))
	for _, item := range []struct {
		name   string
		build  func() *http.Request
		token  string
		status int
	}{
		{"oversized image", func() *http.Request {
			request := httptest.NewRequest(http.MethodPost, "/v1/uploads/images", bytes.NewReader(oversized))
			request.Header.Set("Content-Type", oversizedType)
			return request
		}, "nativeowner", http.StatusRequestEntityTooLarge},
		{"declared upload beyond the platform request cap", func() *http.Request {
			request := httptest.NewRequest(http.MethodPost, "/v1/upload", bytes.NewReader(small))
			request.ContentLength = 112<<20 + 1
			request.Header.Set("Content-Type", contentType)
			return request
		}, "nativeowner", http.StatusRequestEntityTooLarge},
		{"unknown length", func() *http.Request {
			request := httptest.NewRequest(http.MethodPost, "/v1/uploads/images", io.MultiReader(bytes.NewReader(small)))
			request.ContentLength = -1
			request.Header.Set("Content-Type", contentType)
			return request
		}, "nativeowner", http.StatusLengthRequired},
		{"not multipart", func() *http.Request {
			request := httptest.NewRequest(http.MethodPost, "/v1/uploads/images", strings.NewReader(`{"image":"x"}`))
			request.Header.Set("Content-Type", "application/json")
			return request
		}, "nativeowner", http.StatusBadRequest},
		{"compressed body", func() *http.Request {
			request := httptest.NewRequest(http.MethodPost, "/v1/uploads/images", bytes.NewReader(small))
			request.Header.Set("Content-Type", contentType)
			request.Header.Set("Content-Encoding", "gzip")
			return request
		}, "nativeowner", http.StatusUnsupportedMediaType},
		{"invalid key", func() *http.Request {
			request := httptest.NewRequest(http.MethodPost, "/v1/upload", bytes.NewReader(small))
			request.Header.Set("Content-Type", contentType)
			return request
		}, "not-a-key", http.StatusUnauthorized},
		{"disabled key", func() *http.Request {
			request := httptest.NewRequest(http.MethodPost, "/v1/upload", bytes.NewReader(small))
			request.Header.Set("Content-Type", contentType)
			return request
		}, "nativedisabled", http.StatusUnauthorized},
		{"expired key", func() *http.Request {
			request := httptest.NewRequest(http.MethodPost, "/v1/uploads/videos", bytes.NewReader(small))
			request.Header.Set("Content-Type", contentType)
			return request
		}, "nativeexpired", http.StatusUnauthorized},
		{"no platform OAuth binding", func() *http.Request {
			request := httptest.NewRequest(http.MethodPost, "/v1/uploads/images", bytes.NewReader(small))
			request.Header.Set("Content-Type", contentType)
			return request
		}, "nativeunbound", http.StatusForbidden},
	} {
		t.Run(item.name, func(t *testing.T) {
			response := fixture.send(item.build(), item.token)
			assert.Equal(t, item.status, response.Code, response.Body.String())
		})
	}
	assert.Empty(t, fixture.recorded(), "rejected uploads must not reach the platform")
}

func TestPlatformUploadKeepsPlatformErrorsAndRefusesUnsafeReplies(t *testing.T) {
	fixture := newPlatformNativeTest(t)
	body, contentType := nativeMultipart(t, "image", "ref.png", []byte("png"))
	upload := func() *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/v1/uploads/images", bytes.NewReader(body))
		request.Header.Set("Content-Type", contentType)
		return fixture.send(request, "nativeowner")
	}
	fixture.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "7")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, `{"error":{"type":"rate_limit_error","message":"slow down"}}`)
	}
	limited := upload()
	assert.Equal(t, http.StatusTooManyRequests, limited.Code)
	assert.Equal(t, "7", limited.Header().Get("Retry-After"))
	assert.JSONEq(t, `{"error":{"type":"rate_limit_error","message":"slow down"}}`, limited.Body.String())
	fixture.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "https://elsewhere.example/upload")
		w.WriteHeader(http.StatusFound)
		_, _ = io.WriteString(w, `{}`)
	}
	redirected := upload()
	assert.Equal(t, http.StatusServiceUnavailable, redirected.Code)
	assert.Empty(t, redirected.Header().Get("Location"))
	fixture.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, `<html>gateway</html>`)
	}
	page := upload()
	assert.Equal(t, http.StatusServiceUnavailable, page.Code)
	assert.NotContains(t, page.Body.String(), "gateway")
	assert.Len(t, fixture.recorded(), 3)
}

func decodeNativeKeyContext(t *testing.T, encoded string) map[string]any {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	require.NoError(t, err)
	var context map[string]any
	require.NoError(t, common.Unmarshal(raw, &context))
	return context
}

func TestPlatformVoicesRelayWithKeyPolicyWhereThePlatformResolvesIt(t *testing.T) {
	fixture := newPlatformNativeTest(t)
	clone := `{"name":"My voice","upload_id":"upload-fixture"}`
	activation := `{"authorization_token":"signed-activation","authorization_max":3.5}`
	fixture.reply = func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/activation") {
			w.WriteHeader(http.StatusAccepted)
		}
		_, _ = fmt.Fprintf(w, `{"echo":%q}`, r.URL.Path)
	}
	for _, item := range []struct {
		method, target, body, path, query string
		status                            int
		keyed                             bool
	}{
		{http.MethodGet, "/v1/voices?model=speech-2.8&user_id=someone-else", "", "/v1/voices", "model=speech-2.8", http.StatusOK, false},
		{http.MethodGet, "/v1/voices/va_fixture", "", "/v1/voices/va_fixture", "", http.StatusOK, false},
		{http.MethodPost, "/v1/voices/clone", clone, "/v1/voices/clone", "", http.StatusOK, true},
		{http.MethodGet, "/v1/voices/va_fixture/activation/quote", "", "/v1/voices/va_fixture/activation/quote", "", http.StatusOK, true},
		{http.MethodPost, "/v1/voices/va_fixture/activation", activation, "/v1/voices/va_fixture/activation", "", http.StatusAccepted, true},
		{http.MethodGet, "/v1/voices/va_fixture/activation", "", "/v1/voices/va_fixture/activation", "", http.StatusOK, true},
	} {
		t.Run(item.method+" "+item.path, func(t *testing.T) {
			request := httptest.NewRequest(item.method, item.target, strings.NewReader(item.body))
			if item.body != "" {
				request.Header.Set("Content-Type", "text/plain")
				request.Header.Set("Idempotency-Key", "voice-order-0001")
			}
			response := fixture.send(request, "nativespeech")
			require.Equal(t, item.status, response.Code, response.Body.String())
			assert.JSONEq(t, fmt.Sprintf(`{"echo":%q}`, item.path), response.Body.String())
			calls := fixture.recorded()
			call := calls[len(calls)-1]
			assert.Equal(t, item.method, call.method)
			assert.Equal(t, item.path, call.path)
			assert.Equal(t, item.query, call.query)
			assert.Equal(t, sha256.Sum256([]byte(item.body)), call.digest)
			if item.body != "" {
				assert.Equal(t, "application/json", call.contentType)
				assert.Equal(t, "voice-order-0001", call.idempotencyKey)
			}
			if !item.keyed {
				assert.Empty(t, call.keyContext, "the platform reads owned voices without a key policy")
				return
			}
			context := decodeNativeKeyContext(t, call.keyContext)
			assert.Equal(t, "speech-2.8", context["model"])
			assert.Equal(t, fmt.Sprint(fixture.tokens["nativespeech"].Id), context["key_id"])
		})
	}
	assert.Len(t, fixture.recorded(), 6)
}

func TestPlatformVoiceRejectionsNeverReachThePlatform(t *testing.T) {
	fixture := newPlatformNativeTest(t)
	clone := `{"name":"My voice","upload_id":"upload-fixture"}`
	for _, item := range []struct {
		name, method, target, body, token string
		status                            int
	}{
		{"key without speech-2.8 clones", http.MethodPost, "/v1/voices/clone", clone, "nativeimageonly", http.StatusForbidden},
		{"key without speech-2.8 quotes activation", http.MethodGet, "/v1/voices/va_fixture/activation/quote", "", "nativeimageonly", http.StatusForbidden},
		{"key without speech-2.8 activates", http.MethodPost, "/v1/voices/va_fixture/activation", `{}`, "nativeimageonly", http.StatusForbidden},
		{"no platform OAuth binding", http.MethodGet, "/v1/voices", "", "nativeunbound", http.StatusForbidden},
		{"invalid key", http.MethodPost, "/v1/voices/clone", clone, "not-a-key", http.StatusUnauthorized},
		{"disabled key", http.MethodGet, "/v1/voices/va_fixture", "", "nativedisabled", http.StatusUnauthorized},
		{"expired key", http.MethodPost, "/v1/voices/clone", clone, "nativeexpired", http.StatusUnauthorized},
		{"dot-segment voice id", http.MethodGet, "/v1/voices/..", "", "nativeowner", http.StatusNotFound},
		{"non-JSON clone", http.MethodPost, "/v1/voices/clone", `name=My voice`, "nativeowner", http.StatusBadRequest},
		{"oversized clone", http.MethodPost, "/v1/voices/clone", `{"name":"` + strings.Repeat("v", 1<<20) + `"}`, "nativeowner", http.StatusRequestEntityTooLarge},
	} {
		t.Run(item.name, func(t *testing.T) {
			request := httptest.NewRequest(item.method, item.target, strings.NewReader(item.body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Idempotency-Key", "voice-order-0002")
			response := fixture.send(request, item.token)
			assert.Equal(t, item.status, response.Code, response.Body.String())
		})
	}
	assert.Empty(t, fixture.recorded(), "rejected voice requests must not reach the platform")
	listed := fixture.send(httptest.NewRequest(http.MethodGet, "/v1/voices", nil), "nativeimageonly")
	assert.Equal(t, http.StatusOK, listed.Code, "listing owned voices follows the platform, which applies no model policy")
	assert.Len(t, fixture.recorded(), 1)
}
