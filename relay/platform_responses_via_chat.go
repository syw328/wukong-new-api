// Copyright (C) 2026 QuantumNous and contributors. Licensed under AGPL-3.0-or-later.
// Modified for the platform wallet relay: Responses requests served through chat completions.
package relay

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relay/channel"
	openaichannel "github.com/QuantumNous/new-api/relay/channel/openai"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/relayconvert"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// platformResponsesViaChat serves POST /v1/responses on the platform relay channel
// through the platform's /v1/chat/completions. The platform's own /v1/responses only
// accepts one pinned Codex client contract, while chat completions carries every
// model, route, account price and agent markup, so ordinary Responses clients are
// converted here and the answer is converted back.
func platformResponsesViaChat(c *gin.Context, info *relaycommon.RelayInfo, adaptor channel.Adaptor, request *dto.OpenAIResponsesRequest) (*dto.Usage, *types.NewAPIError) {
	result, err := service.ConvertRequestByID(c, info, relayconvert.ConverterOpenAIResponsesToOpenAIChat, *request)
	if err != nil {
		return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	chatRequest, ok := result.Value.(*dto.GeneralOpenAIRequest)
	if !ok {
		return nil, types.NewError(fmt.Errorf("expected OpenAI chat completions request, got %T", result.Value), types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	if info.IsStream {
		chatRequest.StreamOptions = &dto.StreamOptions{IncludeUsage: true}
	}

	savedRelayMode, savedRequestURLPath := info.RelayMode, info.RequestURLPath
	defer func() {
		info.RelayMode = savedRelayMode
		info.RequestURLPath = savedRequestURLPath
	}()
	info.RelayMode = relayconstant.RelayModeChatCompletions
	info.RequestURLPath = "/v1/chat/completions"

	convertedRequest, err := adaptor.ConvertOpenAIRequest(c, info, chatRequest)
	if err != nil {
		return nil, newConvertRequestFailedError(c, info, err)
	}
	relaycommon.AppendRequestConversionFromRequest(info, convertedRequest)
	jsonData, err := common.Marshal(convertedRequest)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	jsonData, err = relaycommon.RemoveDisabledFields(jsonData, info.ChannelOtherSettings, info.ChannelSetting.PassThroughBodyEnabled)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	if len(info.ParamOverride) > 0 {
		jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
		if err != nil {
			return nil, newAPIErrorFromParamOverride(err)
		}
	}
	body, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	defer closer.Close()

	resp, err := adaptor.DoRequest(c, info, body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}
	httpResp, _ := resp.(*http.Response)
	if httpResp == nil {
		return nil, types.NewOpenAIError(nil, types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	statusCodeMappingStr := c.GetString("status_code_mapping")
	if httpResp.StatusCode != http.StatusOK {
		apiErr := service.RelayErrorHandler(c.Request.Context(), httpResp, false)
		service.ResetStatusCode(apiErr, statusCodeMappingStr)
		return nil, apiErr
	}

	var usage *dto.Usage
	var apiErr *types.NewAPIError
	if info.IsStream {
		usage, apiErr = openaichannel.OaiChatToResponsesStreamHandler(c, info, httpResp)
	} else {
		usage, apiErr = openaichannel.OaiChatToResponsesHandler(c, info, httpResp)
	}
	if apiErr != nil {
		service.ResetStatusCode(apiErr, statusCodeMappingStr)
		return nil, apiErr
	}
	return usage, nil
}

// nativeResponsesClient reports a Codex turn. Codex identifies itself in the
// User-Agent, stamps x-codex-* keys into client_metadata and declares its tools
// as additional_tools input items or namespace/custom tools — none of which a
// Chat conversion keeps — so such bodies go to the platform unchanged.
func nativeResponsesClient(c *gin.Context, request *dto.OpenAIResponsesRequest) bool {
	if c != nil && c.Request != nil && strings.HasPrefix(strings.ToLower(c.Request.UserAgent()), "codex") {
		return true
	}
	if request == nil {
		return false
	}
	var metadata map[string]json.RawMessage
	if len(request.ClientMetadata) > 0 && common.Unmarshal(request.ClientMetadata, &metadata) == nil {
		for key := range metadata {
			if strings.HasPrefix(strings.ToLower(key), "x-codex-") {
				return true
			}
		}
	}
	var items []struct {
		Type string `json:"type"`
	}
	if input := strings.TrimSpace(string(request.Input)); strings.HasPrefix(input, "[") && common.Unmarshal(request.Input, &items) == nil {
		for _, item := range items {
			if item.Type == "additional_tools" {
				return true
			}
		}
	}
	var tools []struct {
		Type string `json:"type"`
	}
	if len(request.Tools) > 0 && common.Unmarshal(request.Tools, &tools) == nil {
		for _, tool := range tools {
			if tool.Type == "namespace" || tool.Type == "custom" {
				return true
			}
		}
	}
	return false
}
