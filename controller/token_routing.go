// Copyright (C) 2026 QuantumNous and contributors. AGPL-3.0-or-later.
package controller

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetTokenRoutingOptions(c *gin.Context) {
	proxyPlatformPortal(c, "/api/developer/routing-options?model="+url.QueryEscape(c.Query("model")), true, false)
}

// Validate membership against the account's own platform before persisting a changed whitelist.
func validateTokenRouteSelection(c *gin.Context, policy *model.TokenRoutingPolicy) error {
	if policy == nil || policy.Version != 2 || policy.Mode != "custom" {
		return nil
	}
	origin, ok := common.PlatformPortalOrigin(c.Request)
	if !ok {
		return fmt.Errorf("platform routing catalog is unavailable")
	}
	headers, err := service.PlatformRelayIdentityHeaders(c.GetInt("id"))
	if err != nil {
		return err
	}
	body, err := common.Marshal(map[string]any{"model_rules": policy.ModelRules})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, origin+"/api/developer/routing-options", bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	for name, value := range headers {
		request.Header.Set(name, value)
	}
	response, err := platformPortalClient.Do(request)
	if err != nil {
		return fmt.Errorf("unable to verify selected routes; refresh the catalog and retry")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	var result struct {
		Success bool `json:"success"`
		Data    struct {
			Valid bool `json:"valid"`
		} `json:"data"`
	}
	if err != nil || len(data) > 65536 || common.Unmarshal(data, &result) != nil || response.StatusCode != 200 || !result.Success || !result.Data.Valid {
		return fmt.Errorf("selected model or route is no longer available; refresh the catalog")
	}
	return nil
}
