package plugins_test

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	builtinplugins "github.com/QuantumNous/new-api/plugins"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlatformMediaNativeProtocol(t *testing.T) {
	source, err := builtinplugins.Source("platform-media")
	require.NoError(t, err)
	source = strings.Replace(source, `const PLATFORM_MODELS = ["__platform_media__"];`, `const PLATFORM_MODELS = ["image-test","video-test","audio-test"];`, 1)
	registry := jsplugin.NewRegistry()
	plugin, err := registry.RegisterFactory(source, jsplugin.Options{Key: "platform-media"})
	require.NoError(t, err)
	decode := func(value any) map[string]any {
		data, marshalErr := common.Marshal(value)
		require.NoError(t, marshalErr)
		var result map[string]any
		require.NoError(t, common.Unmarshal(data, &result))
		return result
	}
	invoke := func(name string, args ...any) map[string]any {
		value, callErr := plugin.Engine.Call(t.Context(), name, args...)
		require.NoError(t, callErr)
		return decode(value)
	}
	request := map[string]any{"model": "image-test", "prompt": "test", "params": map[string]any{"resolution": "2K"}, "authorization_max": 0.4, "authorization_token": "signed-test-token", "confirmed_price_book_id": "book"}
	ctx := map[string]any{"baseUrl": "https://platform.test", "apiKey": "test-only-key", "authHeader": "test-only-key", "publicTaskId": "task_client", "platformRequestFingerprint": "fingerprint", "requestBody": request}
	t.Run("all three modalities share exact platform protocol, not fabricated OpenAI image semantics", func(t *testing.T) {
		assert.ElementsMatch(t, []string{"platform-media:image-test", "platform-media:video-test", "platform-media:audio-test"}, plugin.Meta.Models)
		require.Len(t, plugin.Meta.Routes, 2)
		submit := invoke("buildSubmitRequest", ctx)
		assert.Equal(t, "https://platform.test/v1/media/generations", submit["url"])
		headers := decode(submit["headers"])
		assert.Equal(t, "task_client", headers["Idempotency-Key"])
		assert.Equal(t, "Bearer test-only-key", headers["Authorization"], "the platform only accepts Bearer credentials")
		assert.Equal(t, request, submit["body"])
		assert.Equal(t, 0.4, invoke("extractUsage", ctx)["platform_credits"])
	})
	t.Run("requires quote and rejects malformed bounds before the relay", func(t *testing.T) {
		for _, cap := range []any{0, -1, 1000001, "0.4", nil} {
			bad := map[string]any{"baseUrl": "https://platform.test", "requestBody": map[string]any{"model": "image-test", "authorization_max": cap}}
			_, callErr := plugin.Engine.Call(t.Context(), "extractUsage", bad)
			require.ErrorContains(t, callErr, "confirmed_quote_required")
		}
	})
	t.Run("task identity survives polling and settlement uses actual platform credits", func(t *testing.T) {
		pending := map[string]any{"id": "act_1", "status": "processing", "modality": "image", "billing": map[string]any{"state": "pending", "charged": nil}}
		accepted := invoke("parseSubmitResponse", ctx, map[string]any{"statusCode": 202, "body": pending})
		assert.Equal(t, "act_1", accepted["taskId"])
		saved := decode(accepted["state"])
		assert.Equal(t, "fingerprint", saved["request_fingerprint"])
		assert.NotContains(t, decode(accepted["taskData"]), "authorization_token")
		queryCtx := map[string]any{"baseUrl": "https://platform.test", "apiKey": "test-only-key", "authHeader": "test-only-key", "taskId": "act_1", "state": saved}
		query := invoke("buildQueryRequest", queryCtx)
		assert.Equal(t, "Bearer test-only-key", decode(query["headers"])["Authorization"])
		completed := map[string]any{"id": "act_1", "status": "completed", "modality": "image", "billing": map[string]any{"state": "settled", "charged": 0.12}}
		parsed := invoke("parseTaskResult", queryCtx, completed)
		assert.Equal(t, "SUCCESS", parsed["status"])
		assert.Equal(t, "fingerprint", decode(parsed["state"])["request_fingerprint"])
		assert.Equal(t, 0.12, invoke("extractUsageOnComplete", queryCtx, parsed, completed)["platform_credits"])
		content := invoke("buildContentRequest", map[string]any{"baseUrl": "https://platform.test", "apiKey": "test-only-key", "authHeader": "test-only-key", "upstreamTaskId": "act_1", "artifactKey": "result"})
		assert.Equal(t, "https://platform.test/v1/media/generations/act_1/content", content["url"])
		assert.Equal(t, "Bearer test-only-key", decode(content["headers"])["Authorization"])
	})
	t.Run("AI tools expose every platform output as its own artifact", func(t *testing.T) {
		artifacts := func(state map[string]any) []map[string]any {
			value, callErr := plugin.Engine.Call(t.Context(), "listArtifacts", map[string]any{"status": "SUCCESS", "data": map[string]any{"modality": "image"}, "state": state})
			require.NoError(t, callErr)
			data, marshalErr := common.Marshal(value)
			require.NoError(t, marshalErr)
			var list []map[string]any
			require.NoError(t, common.Unmarshal(data, &list))
			return list
		}
		outputs := []any{map[string]any{"kind": "image"}, map[string]any{"kind": "image"}, map[string]any{"kind": "image"}}
		list := artifacts(map[string]any{"id": "act_2", "status": "completed", "result": map[string]any{"outputs": outputs}})
		require.Len(t, list, 3)
		assert.Equal(t, []any{"result", "result-2", "result-3"}, []any{list[0]["key"], list[1]["key"], list[2]["key"]})
		ocr := artifacts(map[string]any{"id": "act_3", "status": "completed", "result": map[string]any{"outputs": []any{map[string]any{"kind": "text"}}}})
		assert.Equal(t, "file", ocr[0]["type"])
		content := map[string]any{"baseUrl": "https://platform.test", "apiKey": "test-only-key", "authHeader": "test-only-key", "upstreamTaskId": "act_2", "artifactKey": "result-3"}
		assert.Equal(t, "https://platform.test/v1/media/generations/act_2/content?index=2", invoke("buildContentRequest", content)["url"])
		content["artifactKey"] = "result-9"
		_, callErr := plugin.Engine.Call(t.Context(), "buildContentRequest", content)
		require.Error(t, callErr)
	})
	t.Run("unknown or charged failure does not prematurely refund a request", func(t *testing.T) {
		for _, state := range []map[string]any{
			{"id": "act_1", "status": "unknown", "billing": map[string]any{"state": "pending"}},
			{"id": "act_1", "status": "failed", "billing": map[string]any{"state": "pending", "charged": 0.1}},
		} {
			assert.Equal(t, "IN_PROGRESS", invoke("parseTaskResult", map[string]any{"taskId": "act_1"}, state)["status"])
		}
		failed := map[string]any{"id": "act_1", "status": "failed", "billing": map[string]any{"state": "settled", "charged": 0}}
		assert.Equal(t, "FAILURE", invoke("parseTaskResult", map[string]any{"taskId": "act_1"}, failed)["status"])
	})
}

func TestPlatformMediaCoexistsWithFactoryModelCaseVariants(t *testing.T) {
	source, err := builtinplugins.Source("platform-media")
	require.NoError(t, err)
	source = strings.Replace(source, `const PLATFORM_MODELS = ["__platform_media__"];`, `const PLATFORM_MODELS = ["minimax-h3","gpt-image-2"];`, 1)
	plugin, err := jsplugin.NewRegistry().Register(source, jsplugin.Options{})
	require.NoError(t, err)
	require.NoError(t, jsplugin.ValidateV1Meta(plugin.Meta))
	require.NoError(t, jsplugin.PreflightRoutingConflict(jsplugin.DefaultRegistry.Generation(), plugin))
	assert.Contains(t, plugin.Meta.Models, "platform-media:minimax-h3")
}
