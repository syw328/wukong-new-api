// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package model

import (
	"crypto/sha256"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

var TokenRoutingStrategies = []string{"balanced", "cheapest", "fastest", "most_reliable"}

// Model permissions stay in ModelLimits. This document only narrows how an
// allowed model may run; an omitted rule inherits the key's defaults.
type TokenRoutingPolicy struct {
	Version           int                     `json:"version"`
	Mode              string                  `json:"mode,omitempty"`
	DefaultStrategy   string                  `json:"default_strategy"`
	AllowedStrategies []string                `json:"allowed_strategies"`
	AllowFixedRoutes  bool                    `json:"allow_fixed_routes"`
	ModelRules        []TokenModelRoutingRule `json:"model_rules"`
}

type TokenModelRoutingRule struct {
	Model             string   `json:"model"`
	RouteIDs          []string `json:"route_ids,omitempty"`
	RouteOrder        string   `json:"route_order,omitempty"`
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
	Mode              string   `json:"mode,omitempty"`
	RouteIDs          []string `json:"route_ids,omitempty"`
	RouteOrder        string   `json:"route_order,omitempty"`
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

var tokenRouteID = regexp.MustCompile(`^(?:[a-f0-9]{24}|tool)$`)

func (policy *TokenRoutingPolicy) Validate() error {
	if policy == nil || (policy.Version != 1 && policy.Version != 2) || len(policy.ModelRules) > 500 {
		return fmt.Errorf("invalid key routing policy")
	}
	if err := validateTokenRoutingStrategies(policy.DefaultStrategy, policy.AllowedStrategies); err != nil {
		return err
	}
	if policy.Version == 2 && policy.Mode != "automatic" && policy.Mode != "custom" {
		return fmt.Errorf("invalid routing mode")
	}
	if policy.Version == 1 && policy.Mode != "" {
		return fmt.Errorf("routing mode requires policy version 2")
	}
	seen := map[string]bool{}
	for _, rule := range policy.ModelRules {
		if rule.Model == "" || len(rule.Model) > 160 || strings.TrimSpace(rule.Model) != rule.Model ||
			strings.ContainsAny(rule.Model, ",\r\n\t\x00") || strings.HasPrefix(rule.Model, "platform-media:") || seen[rule.Model] {
			return fmt.Errorf("invalid or duplicate model routing rule")
		}
		seen[rule.Model] = true
		if policy.Version == 2 && policy.Mode == "custom" {
			if len(rule.RouteIDs) == 0 || len(rule.RouteIDs) > 32 || (rule.RouteOrder != "strategy" && rule.RouteOrder != "manual") {
				return fmt.Errorf("choose 1–32 routes and a routing order for each model")
			}
			routes := map[string]bool{}
			for _, id := range rule.RouteIDs {
				if !tokenRouteID.MatchString(id) || routes[id] {
					return fmt.Errorf("invalid or duplicate route")
				}
				routes[id] = true
			}
		} else if len(rule.RouteIDs) > 0 || rule.RouteOrder != "" {
			return fmt.Errorf("route selection requires custom routing")
		}
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
	if policy.Version == 2 && policy.Mode == "custom" {
		if !token.ModelLimitsEnabled || len(token.GetModelLimitsMap()) == 0 || len(token.GetModelLimitsMap()) != len(policy.ModelRules) {
			return fmt.Errorf("custom routing requires a route rule for every allowed model")
		}
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
	if policy.Version == 2 && policy.Mode == "custom" {
		if !token.ModelLimitsEnabled || !token.GetModelLimitsMap()[modelName] || !slices.ContainsFunc(policy.ModelRules, func(rule TokenModelRoutingRule) bool { return rule.Model == modelName }) {
			return nil, fmt.Errorf("this key does not allow the requested model")
		}
	}
	result.Version, result.Mode = policy.Version, policy.Mode
	result.DefaultStrategy, result.AllowedStrategies = policy.DefaultStrategy, slices.Clone(policy.AllowedStrategies)
	result.AllowFixedRoutes = policy.AllowFixedRoutes
	for _, rule := range policy.ModelRules {
		if rule.Model == modelName {
			result.RouteIDs, result.RouteOrder = slices.Clone(rule.RouteIDs), rule.RouteOrder
			result.DefaultStrategy, result.AllowedStrategies = rule.DefaultStrategy, slices.Clone(rule.AllowedStrategies)
			break
		}
	}
	return result, nil
}
