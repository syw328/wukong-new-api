// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package model

import (
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func TestCustomTokenRoutingPolicy(t *testing.T) {
	var policy TokenRoutingPolicy
	require.NoError(t, common.UnmarshalJsonStr(`{"version":2,"mode":"custom","default_strategy":"balanced","allowed_strategies":["balanced"],"model_rules":[{"model":"image","default_strategy":"balanced","allowed_strategies":["balanced"],"route_ids":["aaaaaaaaaaaaaaaaaaaaaaaa","bbbbbbbbbbbbbbbbbbbbbbbb"],"route_order":"manual"}]}`, &policy))
	token := &Token{Id: 23, ModelLimitsEnabled: true, ModelLimits: "image"}
	require.NoError(t, token.SetRoutingPolicy(&policy))
	context, err := token.PlatformRoutingContext("platform-media:image")
	require.NoError(t, err)
	raw, err := common.Marshal(context)
	require.NoError(t, err)
	assert.Contains(t, string(raw), `"route_order":"manual"`)
	assert.Contains(t, string(raw), strings.Repeat("a", 24))
	_, err = token.PlatformRoutingContext("other")
	require.Error(t, err)
	token.ModelLimitsEnabled = false
	require.Error(t, token.SetRoutingPolicy(&policy))
	token.ModelLimitsEnabled = true
	token.ModelLimits = "image,other"
	require.Error(t, token.SetRoutingPolicy(&policy))
}

func TestAutomaticKeyStrategyOverridesLegacyModelDefaults(t *testing.T) {
	for _, version := range []int{1, 2} {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			policy := TokenRoutingPolicy{Version: version, DefaultStrategy: "most_reliable",
				AllowedStrategies: []string{"balanced", "cheapest", "most_reliable"}, AllowFixedRoutes: true,
				ModelRules: []TokenModelRoutingRule{{Model: "image", DefaultStrategy: "cheapest", AllowedStrategies: []string{"cheapest"}}}}
			if version == 2 {
				policy.Mode = "automatic"
			}
			token := &Token{Id: 23, ModelLimitsEnabled: true, ModelLimits: "image,chat"}
			require.NoError(t, token.SetRoutingPolicy(&policy))
			for _, modelName := range []string{"image", "chat"} {
				context, err := token.PlatformRoutingContext(modelName)
				require.NoError(t, err)
				assert.Equal(t, "most_reliable", context.DefaultStrategy)
				assert.Equal(t, []string{"most_reliable"}, context.AllowedStrategies)
			}
		})
	}
}
