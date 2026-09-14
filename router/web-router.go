package router

import (
	"bytes"
	"embed"
	"net/http"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"
)

// WebAssets holds the embedded dashboard frontend assets.
type WebAssets struct {
	BuildFS   embed.FS
	IndexPage []byte
}

func SetWebRouter(router *gin.Engine, assets WebAssets, pluginDispatcher gin.HandlerFunc) {
	frontendFS := common.EmbedFolder(assets.BuildFS, "web/dist")
	serveStatic := static.Serve("/", frontendFS)

	router.NoRoute(
		pluginDispatcher,
		middleware.RouteTag("web"),
		gzip.Gzip(gzip.DefaultCompression),
		middleware.AccessTokenAudit(),
		middleware.GlobalWebRateLimit(),
		middleware.Cache(),
		func(c *gin.Context) {
			if c.Request.URL.Path != "/" && c.Request.URL.Path != "/index.html" {
				serveStatic(c)
			}
		},
		func(c *gin.Context) {
			if strings.HasPrefix(c.Request.RequestURI, "/v1") || strings.HasPrefix(c.Request.RequestURI, "/api") || strings.HasPrefix(c.Request.RequestURI, "/assets") {
				controller.RelayNotFound(c)
				return
			}
			portal, mounted := common.PlatformPortalForRequest(c.Request)
			legacyOrigin := os.Getenv("PLATFORM_LEGACY_PORTAL_ORIGIN")
			primaryOrigin := os.Getenv("PLATFORM_PUBLIC_ORIGIN")
			if !mounted && legacyOrigin == "https://"+c.Request.Host && primaryOrigin != "" && !strings.HasPrefix(c.Request.URL.Path, "/oauth/") {
				target := c.Request.URL.RequestURI()
				root := strings.Split(strings.TrimPrefix(c.Request.URL.Path, "/"), "/")[0]
				switch root {
				case "channels", "chat", "chat2link", "dashboard", "errors", "keys", "models", "playground", "profile", "redemption-codes", "security", "subscriptions", "system-info", "system-settings", "task-plugins", "usage-logs", "users", "wallet":
					target = "/console" + target
				}
				c.Redirect(http.StatusFound, primaryOrigin+"/api"+target)
				return
			}
			prefix := "/"
			page := bytes.Clone(assets.IndexPage)
			if mounted {
				prefix = portal.TransportPath + "/"
				runtime, err := common.Marshal(portal)
				if err != nil {
					c.AbortWithStatus(http.StatusInternalServerError)
					return
				}
				// JSON data is not executable. Escape HTML delimiters even with alternate JSON codecs.
				runtime = bytes.ReplaceAll(runtime, []byte("<"), []byte(`\u003c`))
				runtime = bytes.ReplaceAll(runtime, []byte(">"), []byte(`\u003e`))
				page = bytes.Replace(page, []byte("<head>"), append([]byte(`<head><script type="application/json" id="platform-portal-runtime">`), append(runtime, []byte("</script>")...)...), 1)
			}
			for _, attribute := range []string{`src="static/`, `href="static/`, `src="/static/`, `href="/static/`} {
				kind, _, _ := strings.Cut(attribute, "=")
				page = bytes.ReplaceAll(page, []byte(attribute), []byte(kind+`="`+prefix+"static/"))
			}
			page = bytes.ReplaceAll(page, []byte(`href="/logo.png"`), []byte(`href="`+prefix+`logo.png"`))
			c.Header("Cache-Control", "no-store")
			c.Data(http.StatusOK, "text/html; charset=utf-8", page)
		},
	)
}
