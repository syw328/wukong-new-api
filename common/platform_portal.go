package common

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// PlatformPortal describes one request already bound to a tenant by the host.
// Public callers cannot select an origin or influence OAuth with forwarded headers.
type PlatformPortal struct {
	Origin        string `json:"origin"`
	BasePath      string `json:"basePath"`
	TransportPath string `json:"transportPath"`
	BrandName     string `json:"brandName"`
	Logo          string `json:"logo"`
}

func PlatformPortalForRequest(r *http.Request) (PlatformPortal, bool) {
	var portal PlatformPortal
	secret := os.Getenv("PLATFORM_RELAY_SECRET")
	context := r.Header.Get("X-Platform-Portal-Context")
	if secret == "" || context == "" || len(context) > 8192 {
		return portal, false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(context))
	signature, err := hex.DecodeString(r.Header.Get("X-Platform-Portal-Signature"))
	if err != nil || !hmac.Equal(signature, mac.Sum(nil)) {
		return portal, false
	}
	data, err := base64.RawURLEncoding.DecodeString(context)
	if err != nil || Unmarshal(data, &portal) != nil {
		return PlatformPortal{}, false
	}
	origin, err := url.Parse(portal.Origin)
	if err != nil || origin.Scheme != "https" || origin.Host == "" || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" ||
		portal.BasePath != "/api" || portal.TransportPath != "/api/open-platform" {
		return PlatformPortal{}, false
	}
	return portal, true
}

// PlatformPortalOrigin is where the portal calls the platform back: the signed
// tenant origin of this request, else the configured PlatformPublicBaseURL.
func PlatformPortalOrigin(r *http.Request) (string, bool) {
	OptionMapRWMutex.RLock()
	base := strings.TrimRight(OptionMap["PlatformPublicBaseURL"], "/")
	OptionMapRWMutex.RUnlock()
	if r != nil {
		if portal, ok := PlatformPortalForRequest(r); ok {
			base = portal.Origin
		}
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Hostname() == "" || parsed.Path != "" ||
		(parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost"))) {
		return "", false
	}
	return base, true
}
