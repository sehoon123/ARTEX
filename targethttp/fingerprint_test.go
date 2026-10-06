package targethttp

import (
	"net/http"
	"testing"
)

func TestNormalizeUserAgent(t *testing.T) {
	tests := []struct {
		name    string
		ua      string
		want    string
		changed bool
	}{
		{"missing", "", DefaultUserAgent, true},
		{"norma", "norma/0.4", DefaultUserAgent, true},
		{"go", "Go-http-client/1.1", DefaultUserAgent, true},
		{"curl", "curl/8.17.0", DefaultUserAgent, true},
		{"requests", "python-requests/2.32.5", DefaultUserAgent, true},
		{"scanner", "sqlmap/1.9", DefaultUserAgent, true},
		{"headless", "Mozilla/5.0 HeadlessChrome/141.0.0.0 Safari/537.36", DefaultUserAgent, true},
		{"node", "node", DefaultUserAgent, true},
		{"git", "git/2.55.0", DefaultUserAgent, true},
		{"api recon", "Mozilla/5.0 (spa-api-recon spider)", DefaultUserAgent, true},
		{"explicit browser", "Mozilla/5.0 CustomBrowser/1.0", "Mozilla/5.0 CustomBrowser/1.0", false},
		{"explicit api client", "AcmeSecurityClient/2.0", "AcmeSecurityClient/2.0", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := make(http.Header)
			if tt.ua != "" {
				h.Set("User-Agent", tt.ua)
			}
			if got := NormalizeUserAgent(h); got != tt.changed {
				t.Fatalf("changed = %v, want %v", got, tt.changed)
			}
			if got := h.Get("User-Agent"); got != tt.want {
				t.Fatalf("User-Agent = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNormalizeProxyHeadersRemovesFingerprintingHopHeaders(t *testing.T) {
	h := http.Header{
		"User-Agent":                           {"curl/8.99"},
		"Proxy-Connection":                     {"Keep-Alive"},
		"Proxy-Authorization":                  {"Basic internal"},
		"X-Artex-Internal-Preserve-User-Agent": {"1"},
		"Sec-Ch-Ua":                            {`"Chromium";v="152"`},
		"Sec-Ch-Ua-Platform":                   {`"Linux"`},
	}
	if !NormalizeProxyHeaders(h) {
		t.Fatal("recognizable tool User-Agent was not normalized")
	}
	if got := h.Get("User-Agent"); got != DefaultUserAgent {
		t.Fatalf("User-Agent = %q, want %q", got, DefaultUserAgent)
	}
	for _, key := range []string{
		"Proxy-Connection", "Proxy-Authorization",
		"X-Artex-Internal-Preserve-User-Agent", "Sec-Ch-Ua", "Sec-Ch-Ua-Platform",
	} {
		if got := h.Get(key); got != "" {
			t.Fatalf("%s leaked: %q", key, got)
		}
	}
}

func TestNormalizeProxyHeadersPreservesExplicitNonToolUserAgent(t *testing.T) {
	const custom = "CustomerApprovedClient/2.0"
	h := http.Header{"User-Agent": {custom}, "Proxy-Connection": {"keep-alive"}}
	if NormalizeProxyHeaders(h) {
		t.Fatal("explicit non-tool User-Agent was normalized")
	}
	if got := h.Get("User-Agent"); got != custom {
		t.Fatalf("User-Agent = %q, want %q", got, custom)
	}
	if got := h.Get("Proxy-Connection"); got != "" {
		t.Fatalf("Proxy-Connection leaked: %q", got)
	}
}
