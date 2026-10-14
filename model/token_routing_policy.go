// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package model

import (
	"crypto/sha256"
	"fmt"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

var TokenRoutingStrategies = []string{"balanced", "cheapest", "fastest", "most_reliable"}

// Model permissions stay in ModelLimits. This document only narrows how an
// allowed model may run; an omitted rule inherits the key's defaults.
type TokenRoutingPolicy struct {
	Version           int                     `json:"version"`
	DefaultStrategy   string                  `json:"default_strategy"`
	AllowedStrategies []string                `json:"allowed_strategies"`
	AllowFixedRoutes  bool                    `json:"allow_fixed_routes"`
	ModelRules        []TokenModelRoutingRule `json:"model_rules"`
}

type TokenModelRoutingRule struct {
	Model             string   `json:"model"`
	DefaultStrategy   string   `json:"default_strategy"`
	AllowedStrategies []string `json:"allowed_strategies"`
}

// Only this small, model-bound projection crosses the trusted platform relay.
// Raw keys, model lists and database records never become request headers.
type PlatformKeyRoutingContext struct {
	Version           int      `json:"version"`
	KeyID             string   `json:"key_id"`
	Model             string   `json:"model"`
	DefaultStrategy   string   `json:"default_strategy"`
	AllowedStrategies []string `json:"allowed_strategies"`
	AllowFixedRoutes  bool     `json:"allow_fixed_routes"`
	PolicyHash        string   `json:"policy_hash"`
	Configured        bool     `json:"configured"`
}

func validateTokenRoutingStrategies(defaultStrategy string, allowed []string) error {
	if len(allowed) == 0 || len(allowed) > len(TokenRoutingStrategies) || !slices.Contains(allowed, defaultStrategy) {
		return fmt.Errorf("choose a default routing strategy from the allowed strategies")
	}
	seen := map[string]bool{}
	for _, strategy := range allowed {
		if !slices.Contains(TokenRoutingStrategies, strategy) || seen[strategy] {
			return fmt.Errorf("invalid or duplicate routing strategy")
		}
		seen[strategy] = true
	}
	return nil
}

func (policy *TokenRoutingPolicy) Validate() error {
	if policy == nil || policy.Version != 1 || len(policy.ModelRules) > 500 {
		return fmt.Errorf("invalid key routing policy")
	}
	if err := validateTokenRoutingStrategies(policy.DefaultStrategy, policy.AllowedStrategies); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, rule := range policy.ModelRules {
		if rule.Model == "" || len(rule.Model) > 160 || strings.TrimSpace(rule.Model) != rule.Model ||
			strings.ContainsAny(rule.Model, ",\r\n\t\x00") || strings.HasPrefix(rule.Model, "platform-media:") || seen[rule.Model] {
			return fmt.Errorf("invalid or duplicate model routing rule")
		}
		seen[rule.Model] = true
		if err := validateTokenRoutingStrategies(rule.DefaultStrategy, rule.AllowedStrategies); err != nil {
			return err
		}
	}
	return nil
}

func (token *Token) GetRoutingPolicy() (*TokenRoutingPolicy, error) {
	if token.RoutingPolicy == "" {
		return nil, nil
	}
	var policy TokenRoutingPolicy
	if len(token.RoutingPolicy) > 192*1024 || common.UnmarshalJsonStr(token.RoutingPolicy, &policy) != nil {
		return nil, fmt.Errorf("invalid stored key routing policy")
	}
	if err := policy.Validate(); err != nil {
		return nil, err
	}
	return &policy, nil
}

func (token *Token) SetRoutingPolicy(policy *TokenRoutingPolicy) error {
	if policy == nil {
		token.RoutingPolicy = ""
		return nil
	}
	if err := policy.Validate(); err != nil {
		return err
	}
	if token.ModelLimitsEnabled {
		allowed := token.GetModelLimitsMap()
		for _, rule := range policy.ModelRules {
			if !allowed[rule.Model] {
				return fmt.Errorf("routing rules may only reference models allowed by this key")
			}
		}
	}
	encoded, err := common.Marshal(policy)
	if err != nil {
		return err
	}
	if len(encoded) > 192*1024 {
		return fmt.Errorf("key routing policy is too large")
	}
	token.RoutingPolicy = string(encoded)
	return nil
}

func (token *Token) PlatformRoutingContext(modelName string) (*PlatformKeyRoutingContext, error) {
	modelName = strings.TrimPrefix(modelName, "platform-media:")
	if modelName == "" || len(modelName) > 160 || token.Id <= 0 {
		return nil, fmt.Errorf("invalid platform key routing context")
	}
	if token.ModelLimitsEnabled && !token.GetModelLimitsMap()[modelName] {
		return nil, fmt.Errorf("this key does not allow the requested model")
	}
	policy, err := token.GetRoutingPolicy()
	if err != nil {
		return nil, err
	}
	result := &PlatformKeyRoutingContext{Version: 1, KeyID: fmt.Sprint(token.Id), Model: modelName,
		DefaultStrategy: "balanced", AllowedStrategies: slices.Clone(TokenRoutingStrategies), AllowFixedRoutes: true,
		PolicyHash: fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%t:%s:%s", token.ModelLimitsEnabled, token.ModelLimits, token.RoutingPolicy)))),
		Configured: policy != nil}
	if policy == nil {
		return result, nil
	}
	result.DefaultStrategy, result.AllowedStrategies = policy.DefaultStrategy, slices.Clone(policy.AllowedStrategies)
	result.AllowFixedRoutes = policy.AllowFixedRoutes
	for _, rule := range policy.ModelRules {
		if rule.Model == modelName {
			result.DefaultStrategy, result.AllowedStrategies = rule.DefaultStrategy, slices.Clone(rule.AllowedStrategies)
			break
		}
	}
	return result, nil
}
