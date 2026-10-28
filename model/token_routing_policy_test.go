// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package model

import (
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
