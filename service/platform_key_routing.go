// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package service

import (
	"encoding/base64"
	"fmt"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const PlatformKeyContextHeader = "X-Platform-Key-Context"

// Read the current owned token row for each new quote/submission. In-flight
// work and result polling keep their frozen authorization; a stale token cache
// must never re-enable a model or strategy that its owner just removed.
func PlatformKeyRoutingHeader(userID, tokenID int, modelName string) (string, error) {
	if tokenID <= 0 || userID <= 0 {
		return "", fmt.Errorf("platform key identity is required")
	}
	token, err := model.GetTokenByIds(tokenID, userID)
	if err != nil || token == nil || token.Status != common.TokenStatusEnabled ||
		(token.ExpiredTime != -1 && token.ExpiredTime <= common.GetTimestamp()) {
		return "", fmt.Errorf("platform key is unavailable")
	}
	policy, err := token.PlatformRoutingContext(modelName)
	if err != nil {
		return "", err
	}
	encoded, err := common.Marshal(policy)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

// Unsupported channel implementations must not silently ignore a saved policy.
func CheckKeyRoutingTarget(userID, tokenID int, platform bool) error {
	if platform || tokenID <= 0 {
		return nil
	}
	token, err := model.GetTokenByIds(tokenID, userID)
	if err != nil {
		return fmt.Errorf("key permissions are unavailable")
	}
	if token.RoutingPolicy != "" {
		return fmt.Errorf("this key requires platform routing; this channel does not support its policy")
	}
	return nil
}

func PlatformKeyRoutingEnabled() bool {
	return strings.TrimSpace(os.Getenv("PLATFORM_RELAY_SECRET")) != ""
}
