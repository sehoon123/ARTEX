package targethttp

import (
	"context"
	"encoding/json"
	"encoding/pem"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Autumn-27/norma/permission"
	actool "github.com/Autumn-27/norma/tool"
)

func TestWebFetchMatchesNormaToolContract(t *testing.T) {
	got := NewWebFetch(WebFetchConfig{Proxy: "http://127.0.0.1:1"})
	want := actool.NewWebFetch(actool.WebFetchConfig{})
	if got.Name() != want.Name() {
		t.Fatalf("Name = %q, want %q", got.Name(), want.Name())
	}
	if got.Description() != want.Description() {
		t.Fatal("Description differs from the SDK WebFetch contract")
	}
	if got.Prompt() != want.Prompt() {
		t.Fatalf("Prompt = %q, want %q", got.Prompt(), want.Prompt())
	}
	if !reflect.DeepEqual(got.InputSchema(), want.InputSchema()) {
		t.Fatalf("InputSchema differs:\n got: %#v\nwant: %#v", got.InputSchema(), want.InputSchema())
	}

	input := json.RawMessage(`{"url":"https://example.test/docs","extract":true}`)
	if got.IsReadOnly(input) != want.IsReadOnly(input) {
		t.Fatal("read-only behavior differs")
	}
	if got.IsConcurrencySafe(input) != want.IsConcurrencySafe(input) {
		t.Fatal("concurrency behavior differs")
	}
	gotPermission := got.CheckPermissions(context.Background(), input, permission.Context{})
	wantPermission := want.CheckPermissions(context.Background(), input, permission.Context{})
	if !reflect.DeepEqual(gotPermission, wantPermission) {
		t.Fatalf("permission = %#v, want %#v", gotPermission, wantPermission)
	}
}

func TestWebFetchProxyFailureIsFailClosed(t *testing.T) {
	var targetHits atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		targetHits.Add(1)
		_, _ = io.WriteString(w, "direct connection must not happen")
	}))
	defer target.Close()

	// Reserve an address and close it so dialing the configured proxy reliably
	// fails. NO_PROXY=* additionally proves the explicit proxy is not bypassed for
	// a loopback target.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	deadProxy := "http://" + listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NO_PROXY", "*")
	t.Setenv("no_proxy", "*")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	result := callWebFetch(t, ctx, NewWebFetch(WebFetchConfig{Proxy: deadProxy}), map[string]any{"url": target.URL})
	if !result.IsError || !strings.Contains(result.Flatten(), "Error fetching URL") {
		t.Fatalf("proxy failure = %q (isError=%v), want a tool error", result.Flatten(), result.IsError)
	}
	if hits := targetHits.Load(); hits != 0 {
		t.Fatalf("target received %d direct request(s) after proxy failure, want zero", hits)
	}
}

func TestWebFetchRequiresConfiguredProxy(t *testing.T) {
	var targetHits atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		targetHits.Add(1)
	}))
	defer target.Close()

	result := callWebFetch(t, context.Background(), NewWebFetch(WebFetchConfig{}), map[string]any{"url": target.URL})
	if !result.IsError || !strings.Contains(result.Flatten(), "target proxy is not configured") {
		t.Fatalf("missing proxy = %q (isError=%v)", result.Flatten(), result.IsError)
	}
	if hits := targetHits.Load(); hits != 0 {
		t.Fatalf("target received %d request(s) without a proxy, want zero", hits)
	}
}

func TestWebFetchTrustsConfiguredProxyCA(t *testing.T) {
	var proxyHits atomic.Int32
	proxy := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		proxyHits.Add(1)
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, "<h1>trusted proxy</h1>")
	}))
	defer proxy.Close()

	caPath := filepath.Join(t.TempDir(), "proxy-ca.pem")
	certificate := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: proxy.Certificate().Raw})
	if err := os.WriteFile(caPath, certificate, 0o600); err != nil {
		t.Fatal(err)
	}
	// The destination is intentionally closed. Success therefore proves the
	// request traversed the TLS proxy and that its configured CA was trusted.
	result := callWebFetch(t, context.Background(), NewWebFetch(WebFetchConfig{Proxy: proxy.URL, CACert: caPath}), map[string]any{"url": "http://127.0.0.1:1/page"})
	if result.IsError || !strings.Contains(result.Flatten(), "trusted proxy") {
		t.Fatalf("CA-trusted proxy fetch = %q (isError=%v)", result.Flatten(), result.IsError)
	}
	if hits := proxyHits.Load(); hits != 1 {
		t.Fatalf("proxy hits = %d, want 1", hits)
	}
}

func TestWebFetchUsesDefaultTargetProfile(t *testing.T) {
	seenUA := make(chan string, 1)
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenUA <- r.Header.Get("User-Agent")
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, "<h1>profile</h1>")
	}))
	defer target.Close()

	proxy, _ := newForwardProxy(t)
	result := callWebFetch(t, context.Background(), NewWebFetch(WebFetchConfig{Proxy: proxy.URL}), map[string]any{"url": target.URL})
	if result.IsError {
		t.Fatalf("WebFetch failed: %s", result.Flatten())
	}
	select {
	case got := <-seenUA:
		if got != DefaultUserAgent {
			t.Fatalf("target User-Agent = %q, want %q", got, DefaultUserAgent)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("target did not receive the proxied request")
	}
}

func TestWebFetchHTMLAPIAndExtract(t *testing.T) {
	const page = `<html><head><title>Demo</title><meta name="generator" content="ARTEX fixture"></head><body>
		<!-- TODO inspect /admin.php -->
		<h1>Readable heading</h1><p>Hello &amp; bye</p>
		<form method="post" action="/login"><input name="user"><input type="hidden" name="csrf" value="token123"></form>
		<script src="/static/app.js"></script><script>fetch("/api/v1/users")</script>
		<a href="/admin">Admin</a>
	</body></html>`
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/page":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = io.WriteString(w, page)
		case "/api":
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"ok":true,"items":["a","b"]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer target.Close()
	proxy, _ := newForwardProxy(t)
	tool := NewWebFetch(WebFetchConfig{Proxy: proxy.URL})

	htmlResult := callWebFetch(t, context.Background(), tool, map[string]any{"url": target.URL + "/page"})
	htmlOut := htmlResult.Flatten()
	if htmlResult.IsError {
		t.Fatalf("HTML fetch failed: %s", htmlOut)
	}
	for _, want := range []string{"[200 OK]", "# Demo", "# Readable heading", "Hello & bye", "[Admin](/admin)"} {
		if !strings.Contains(htmlOut, want) {
			t.Fatalf("HTML output missing %q:\n%s", want, htmlOut)
		}
	}
	for _, unwanted := range []string{"RECON", "/api/v1/users", "TODO inspect"} {
		if strings.Contains(htmlOut, unwanted) {
			t.Fatalf("extract=false HTML output unexpectedly contains %q:\n%s", unwanted, htmlOut)
		}
	}

	reconResult := callWebFetch(t, context.Background(), tool, map[string]any{"url": target.URL + "/page", "extract": true})
	reconOut := reconResult.Flatten()
	if reconResult.IsError {
		t.Fatalf("HTML extract fetch failed: %s", reconOut)
	}
	for _, want := range []string{"=== RECON ===", "TODO inspect /admin.php", "/static/app.js", "/api/v1/users", "POST /login", "csrf(hidden=token123)", "generator=ARTEX fixture"} {
		if !strings.Contains(reconOut, want) {
			t.Fatalf("recon output missing %q:\n%s", want, reconOut)
		}
	}

	apiResult := callWebFetch(t, context.Background(), tool, map[string]any{"url": target.URL + "/api"})
	if apiResult.IsError {
		t.Fatalf("API fetch failed: %s", apiResult.Flatten())
	}
	if got := apiResult.Flatten(); !strings.Contains(got, `{"ok":true,"items":["a","b"]}`) {
		t.Fatalf("API body not preserved: %s", got)
	}
}

func TestWebFetchRedirectsStayOnProxyClient(t *testing.T) {
	var targetHits atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetHits.Add(1)
		if r.URL.Path == "/start" {
			http.Redirect(w, r, "/final", http.StatusFound)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, "<h1>redirected</h1>")
	}))
	defer target.Close()
	proxy, observations := newForwardProxy(t)

	result := callWebFetch(t, context.Background(), NewWebFetch(WebFetchConfig{Proxy: proxy.URL}), map[string]any{"url": target.URL + "/start"})
	if result.IsError || !strings.Contains(result.Flatten(), "redirected") {
		t.Fatalf("redirect fetch = %q (isError=%v)", result.Flatten(), result.IsError)
	}
	if hits := targetHits.Load(); hits != 2 {
		t.Fatalf("target hits = %d, want redirect + final", hits)
	}
	paths, userAgents := observations.snapshot()
	if len(paths) != 2 || paths[0] != "/start" || paths[1] != "/final" {
		t.Fatalf("proxy paths = %v, want [/start /final]", paths)
	}
	for i, userAgent := range userAgents {
		if userAgent != DefaultUserAgent {
			t.Fatalf("proxy request %d User-Agent = %q, want %q", i, userAgent, DefaultUserAgent)
		}
	}
}

func callWebFetch(t *testing.T, ctx context.Context, tool actool.CoreTool, input map[string]any) actool.Result {
	t.Helper()
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	result, err := tool.Call(ctx, raw, &actool.ToolContext{})
	if err != nil {
		t.Fatalf("WebFetch.Call: %v", err)
	}
	return result
}

type proxyObservations struct {
	mu         sync.Mutex
	paths      []string
	userAgents []string
}

func (o *proxyObservations) add(r *http.Request) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.paths = append(o.paths, r.URL.Path)
	o.userAgents = append(o.userAgents, r.Header.Get("User-Agent"))
}

func (o *proxyObservations) snapshot() ([]string, []string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([]string(nil), o.paths...), append([]string(nil), o.userAgents...)
}

// newForwardProxy is a localhost-only HTTP forward proxy used by the tests. Its
// outbound transport has Proxy=nil, keeping the test isolated from environment
// proxy settings while making every WebFetch hop observable.
func newForwardProxy(t *testing.T) (*httptest.Server, *proxyObservations) {
	t.Helper()
	observations := &proxyObservations{}
	transport := &http.Transport{}
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observations.add(r)
		outbound := r.Clone(r.Context())
		outbound.RequestURI = ""
		outbound.Header.Del("Proxy-Connection")
		response, err := transport.RoundTrip(outbound)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		for key, values := range response.Header {
			w.Header()[key] = append([]string(nil), values...)
		}
		w.WriteHeader(response.StatusCode)
		_, _ = io.Copy(w, response.Body)
	}))
	t.Cleanup(func() {
		proxy.Close()
		transport.CloseIdleConnections()
	})
	return proxy, observations
}
