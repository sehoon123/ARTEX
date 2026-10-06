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

func TestNormalizeProxyUserAgentPreservesExplicitMarkerAndStripsIt(t *testing.T) {
	const custom = "curl/8.99 custom-audit-profile"
	h := http.Header{
		"User-Agent":            {custom},
		PreserveUserAgentHeader: {"1"},
	}
	if NormalizeProxyUserAgent(h) {
		t.Fatal("marked explicit User-Agent was normalized")
	}
	if got := h.Get("User-Agent"); got != custom {
		t.Fatalf("User-Agent = %q, want %q", got, custom)
	}
	if got := h.Get(PreserveUserAgentHeader); got != "" {
		t.Fatalf("internal preserve header leaked: %q", got)
	}
}
