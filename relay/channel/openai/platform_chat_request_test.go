package openai

import (
	"os"
	"os/exec"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlatformChatControlsReachPlatformValidation(t *testing.T) {
	// Platform channel configuration is process-cached; give this contract its own process.
	if os.Getenv("TEST_PLATFORM_CHAT_CONTROLS") != "1" {
		command := exec.Command(os.Args[0], "-test.run=^TestPlatformChatControlsReachPlatformValidation$")
		command.Env = append(os.Environ(), "TEST_PLATFORM_CHAT_CONTROLS=1", "PLATFORM_RELAY_SECRET=test-only", "PLATFORM_RELAY_CHANNEL_IDS=913")
		output, err := command.CombinedOutput()
		require.NoError(t, err, "%s", output)
		return
	}
	topP, temperature := 0.2, 0.0
	request := &dto.GeneralOpenAIRequest{Model: "gpt-6-astra", TopP: &topP, Temperature: &temperature, ReasoningEffort: "high", RoutingPreference: []byte(`"cheapest"`)}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelId: 913, ChannelType: constant.ChannelTypeOpenAI, UpstreamModelName: request.Model}}
	result, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, request)
	require.NoError(t, err)
	converted := result.(*dto.GeneralOpenAIRequest)
	require.NotNil(t, converted.TopP, "the platform must reject or honor the supplied control")
	assert.Equal(t, topP, *converted.TopP)
	require.NotNil(t, converted.Temperature)
	assert.Equal(t, temperature, *converted.Temperature)
	assert.JSONEq(t, `"cheapest"`, string(converted.RoutingPreference))
}
