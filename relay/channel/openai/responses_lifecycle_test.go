package openai

import (
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func TestResponsesTruncatedChatMustNotComplete(t *testing.T) {
	constant.StreamingTimeout = 30
	service.InitTokenEncoders()
	body := `data: {"id":"chatcmpl_audit","object":"chat.completion.chunk","model":"gpt-test","choices":[{"index":0,"delta":{"content":"partial answer"},"finish_reason":null}]}` + "\n\n"
	c, recorder, resp, info := newResponsesChatTestContext(t, body, true)
	usage, err := OaiChatToResponsesStreamHandler(c, info, resp)
	assert.NotNil(t, err)
	_ = usage
	assert.False(t, strings.Contains(recorder.Body.String(), "event: response.completed"), "incomplete input emitted completed")
}
func TestNativeIncompleteMustKeepReportedUsage(t *testing.T) {
	constant.StreamingTimeout = 30
	service.InitTokenEncoders()
	body := `data: {"type":"response.output_text.delta","delta":"partial"}` + "\n\n" + `data: {"type":"response.incomplete","response":{"id":"resp_audit","status":"incomplete","usage":{"input_tokens":1200,"output_tokens":300,"total_tokens":1500},"incomplete_details":{"reason":"max_output_tokens"}}}` + "\n\n"
	c, _, resp, info := newResponsesChatTestContext(t, body, true)
	usage, err := OaiResponsesStreamHandler(c, info, resp)
	require.Nil(t, err)
	require.NotNil(t, usage)
	t.Logf("reported=1200+300; returned=%d+%d", usage.PromptTokens, usage.CompletionTokens)
	assert.Equal(t, 1200, usage.PromptTokens)
	assert.Equal(t, 300, usage.CompletionTokens)
}
func TestNativeFailedMustReturnRelayError(t *testing.T) {
	constant.StreamingTimeout = 30
	service.InitTokenEncoders()
	body := `data: {"type":"response.failed","response":{"id":"resp_audit","status":"failed","error":{"type":"server_error","message":"upstream overloaded"}}}` + "\n\n"
	c, _, resp, info := newResponsesChatTestContext(t, body, true)
	_, err := OaiResponsesStreamHandler(c, info, resp)
	assert.NotNil(t, err)
	assert.True(t, types.IsSkipRetryError(err))
}

func TestChatStreamErrorMustFailWithoutRetryOrCompletedEvent(t *testing.T) {
	body := "data: {\"error\":{\"type\":\"server_error\",\"message\":\"overloaded\"}}\n\n"
	c, recorder, resp, info := newResponsesChatTestContext(t, body, true)
	_, err := OaiChatToResponsesStreamHandler(c, info, resp)
	require.NotNil(t, err)
	assert.True(t, types.IsSkipRetryError(err))
	assert.Contains(t, recorder.Body.String(), "event: response.failed")
	assert.NotContains(t, recorder.Body.String(), "event: response.completed")
}

func TestNativeTerminalReceiptKeepsExplicitZeroUsage(t *testing.T) {
	body := `data: {"type":"response.output_text.delta","delta":"cached text"}` + "\n\n" +
		`data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}` + "\n\n"
	c, _, resp, info := newResponsesChatTestContext(t, body, true)
	usage, err := OaiResponsesStreamHandler(c, info, resp)
	require.Nil(t, err)
	assert.Zero(t, usage.TotalTokens)
}

func TestNativeTruncatedStreamIsNotSuccess(t *testing.T) {
	c, _, resp, info := newResponsesChatTestContext(t, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n", true)
	_, err := OaiResponsesStreamHandler(c, info, resp)
	require.NotNil(t, err)
	assert.True(t, types.IsSkipRetryError(err))
}
