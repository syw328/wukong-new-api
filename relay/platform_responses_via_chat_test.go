package relay

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	openaichannel "github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	relaytypes "github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type platformChatCall struct {
	path string
	body map[string]any
}

// platformChatServer stands in for the platform's /v1/chat/completions.
func platformChatServer(t *testing.T, contentType, reply string) (*httptest.Server, chan platformChatCall) {
	t.Helper()
	calls := make(chan platformChatCall, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		calls <- platformChatCall{path: r.URL.Path, body: body}
		w.Header().Set("Content-Type", contentType)
		_, _ = w.Write([]byte(reply))
	}))
	t.Cleanup(server.Close)
	return server, calls
}

func platformResponsesContext(stream bool, baseURL string) (*gin.Context, *httptest.ResponseRecorder, *relaycommon.RelayInfo) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Request.Header.Set("Content-Type", "application/json")
	info := &relaycommon.RelayInfo{
		RelayMode:              relayconstant.RelayModeResponses,
		RelayFormat:            relaytypes.RelayFormatOpenAIResponses,
		RequestURLPath:         "/v1/responses",
		OriginModelName:        "gpt-5.6-sol",
		IsStream:               stream,
		RequestConversionChain: []relaytypes.RelayFormat{relaytypes.RelayFormatOpenAIResponses},
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeOpenAI,
			ChannelBaseUrl:    baseURL,
			ApiKey:            "platform-service-key",
			UpstreamModelName: "gpt-5.6-sol",
		},
	}
	return c, recorder, info
}

func platformResponsesRequest(stream bool) *dto.OpenAIResponsesRequest {
	return &dto.OpenAIResponsesRequest{
		Model:        "gpt-5.6-sol",
		Instructions: json.RawMessage(`"Answer briefly."`),
		Input:        json.RawMessage(`"hi"`),
		Stream:       &stream,
	}
}

func TestPlatformResponsesViaChatSendsChatCompletionsAndAnswersAsResponses(t *testing.T) {
	server, calls := platformChatServer(t, "application/json", `{
		"id":"chatcmpl_1","object":"chat.completion","created":1,"model":"gpt-5.6-sol",
		"choices":[{"index":0,"message":{"role":"assistant","content":"hello there"},"finish_reason":"stop"}],
		"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}
	}`)
	c, recorder, info := platformResponsesContext(false, server.URL)
	adaptor := &openaichannel.Adaptor{}
	adaptor.Init(info)

	usage, apiErr := platformResponsesViaChat(c, info, adaptor, platformResponsesRequest(false))

	require.Nil(t, apiErr)
	call := <-calls
	assert.Equal(t, "/v1/chat/completions", call.path)
	assert.Equal(t, "gpt-5.6-sol", call.body["model"])
	messages, _ := call.body["messages"].([]any)
	require.NotEmpty(t, messages)
	assert.Contains(t, mustJSON(t, messages), "hi")
	assert.Contains(t, mustJSON(t, messages), "Answer briefly.")
	assert.Nil(t, call.body["input"], "the platform receives a chat body, not a Responses body")
	require.NotNil(t, usage)
	assert.Equal(t, 10, usage.TotalTokens)
	var answer map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &answer))
	assert.Equal(t, "response", answer["object"])
	assert.Contains(t, recorder.Body.String(), "hello there")
	assert.Equal(t, relayconstant.RelayModeResponses, info.RelayMode, "relay mode is restored for billing and logs")
	assert.Equal(t, "/v1/responses", info.RequestURLPath)
}

func TestPlatformResponsesViaChatStreamsResponsesEvents(t *testing.T) {
	server, calls := platformChatServer(t, "text/event-stream", strings.Join([]string{
		`data: {"id":"chatcmpl_2","object":"chat.completion.chunk","created":1,"model":"gpt-5.6-sol","choices":[{"index":0,"delta":{"role":"assistant","content":"hel"}}]}`,
		`data: {"id":"chatcmpl_2","object":"chat.completion.chunk","created":1,"model":"gpt-5.6-sol","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}]}`,
		`data: {"id":"chatcmpl_2","object":"chat.completion.chunk","created":1,"model":"gpt-5.6-sol","choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}`,
		`data: [DONE]`,
		``,
	}, "\n\n"))
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 300
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })
	c, recorder, info := platformResponsesContext(true, server.URL)
	adaptor := &openaichannel.Adaptor{}
	adaptor.Init(info)

	usage, apiErr := platformResponsesViaChat(c, info, adaptor, platformResponsesRequest(true))

	require.Nil(t, apiErr)
	call := <-calls
	assert.Equal(t, "/v1/chat/completions", call.path)
	assert.Equal(t, true, call.body["stream"])
	assert.Equal(t, map[string]any{"include_usage": true}, call.body["stream_options"])
	require.NotNil(t, usage)
	assert.Equal(t, 9, usage.TotalTokens)
	body := recorder.Body.String()
	assert.Contains(t, body, "response.output_text.delta")
	assert.Contains(t, body, "response.completed")
}

func TestPlatformResponsesViaChatPassesPlatformErrorsThrough(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{"error":{"type":"insufficient_quota","code":"insufficient_quota","message":"算力不足"}}`))
	}))
	defer server.Close()
	c, _, info := platformResponsesContext(false, server.URL)
	adaptor := &openaichannel.Adaptor{}
	adaptor.Init(info)

	usage, apiErr := platformResponsesViaChat(c, info, adaptor, platformResponsesRequest(false))

	assert.Nil(t, usage)
	require.NotNil(t, apiErr)
	assert.Equal(t, http.StatusPaymentRequired, apiErr.StatusCode)
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	require.NoError(t, err)
	return string(raw)
}

func TestNativeResponsesClientRecognisesCodexTurns(t *testing.T) {
	gin.SetMode(gin.TestMode)
	contextWithAgent := func(agent string) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
		c.Request.Header.Set("User-Agent", agent)
		return c
	}
	plain := &dto.OpenAIResponsesRequest{Model: "gpt-5.6-sol", Input: json.RawMessage(`"hi"`)}
	assert.True(t, nativeResponsesClient(contextWithAgent("codex_cli_rs/0.154.0 (Mac OS 26.5.0; arm64)"), plain))
	assert.False(t, nativeResponsesClient(contextWithAgent("OpenAI/Python 2.3.0"), plain), "ordinary clients keep the chat conversion")

	sdk := contextWithAgent("OpenAI/Python 2.3.0")
	assert.True(t, nativeResponsesClient(sdk, &dto.OpenAIResponsesRequest{Model: "gpt-5.6-sol",
		ClientMetadata: json.RawMessage(`{"x-codex-turn-metadata":"{}","thread_id":"t"}`)}))
	assert.True(t, nativeResponsesClient(sdk, &dto.OpenAIResponsesRequest{Model: "gpt-5.6-sol",
		Input: json.RawMessage(`[{"type":"additional_tools","role":"developer","tools":[]},{"type":"message","role":"user","content":"hi"}]`)}))
	assert.True(t, nativeResponsesClient(sdk, &dto.OpenAIResponsesRequest{Model: "gpt-5.6-sol",
		Tools: json.RawMessage(`[{"type":"function","name":"shell"},{"type":"namespace","name":"mcp__docs"}]`)}))
	assert.False(t, nativeResponsesClient(sdk, &dto.OpenAIResponsesRequest{Model: "gpt-5.6-sol",
		Tools: json.RawMessage(`[{"type":"function","name":"lookup"}]`), ClientMetadata: json.RawMessage(`{"thread_id":"t"}`)}))
}
