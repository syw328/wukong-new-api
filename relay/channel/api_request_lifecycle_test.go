package channel

import (
	"context"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type lifecycleAdaptor struct {
	Adaptor
	target string
}

func (a lifecycleAdaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	return a.target, nil
}
func (a lifecycleAdaptor) SetupRequestHeader(c *gin.Context, h *http.Header, info *relaycommon.RelayInfo) error {
	SetupApiRequestHeader(info, c, h)
	return nil
}
func TestChatIdempotencyHeader(t *testing.T) {
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)
	got := make(chan string, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got <- r.Header.Get("Idempotency-Key")
		io.WriteString(w, "{}")
	}))
	defer upstream.Close()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader("{}"))
	c.Request.Header.Set("Idempotency-Key", "audit-unique-request")
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
	resp, err := DoApiRequest(lifecycleAdaptor{target: upstream.URL}, c, info, strings.NewReader("{}"))
	require.NoError(t, err)
	defer resp.Body.Close()
	header := <-got
	t.Logf("client idempotency key present; received upstream=%q", header)
	assert.Equal(t, "audit-unique-request", header)
}
func TestCancelledChatMustNotDispatch(t *testing.T) {
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); io.WriteString(w, "{}") }))
	defer upstream.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader("{}")).WithContext(ctx)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
	resp, err := DoApiRequest(lifecycleAdaptor{target: upstream.URL}, c, info, strings.NewReader("{}"))
	if resp != nil {
		resp.Body.Close()
	}
	t.Logf("incoming context error=%v; upstreamCalls=%d; relayError=%v", ctx.Err(), calls.Load(), err)
	assert.Error(t, err)
	assert.EqualValues(t, 0, calls.Load())
}

func TestCancellationReachesUpstreamBeforeResponseHeaders(t *testing.T) {
	service.InitHttpClient()
	for _, dispatch := range []struct {
		name string
		call func(Adaptor, *gin.Context, *relaycommon.RelayInfo, io.Reader) (*http.Response, error)
	}{{"json", DoApiRequest}, {"multipart", DoFormRequest}} {
		t.Run(dispatch.name, func(t *testing.T) {
			entered, disconnected := make(chan struct{}), make(chan struct{})
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				close(entered)
				<-r.Context().Done()
				close(disconnected)
			}))
			defer upstream.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil).WithContext(ctx)
			result := make(chan error, 1)
			go func() {
				resp, err := dispatch.call(lifecycleAdaptor{target: upstream.URL}, c, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}, strings.NewReader("{}"))
				if resp != nil {
					resp.Body.Close()
				}
				result <- err
			}()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("upstream not reached")
			}
			cancel()
			select {
			case err := <-result:
				require.ErrorIs(t, err, context.Canceled)
			case <-time.After(3 * time.Second):
				t.Fatal("request did not cancel")
			}
			select {
			case <-disconnected:
			case <-time.After(3 * time.Second):
				t.Fatal("upstream connection not cancelled")
			}
		})
	}
}
