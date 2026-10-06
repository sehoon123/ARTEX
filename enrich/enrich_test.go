package enrich

import (
	"strings"
	"testing"

	"github.com/Autumn-27/artex/targethttp"
)

func TestProbeRequestUsesBrowserUserAgent(t *testing.T) {
	req, err := newProbeRequest("https://example.com/")
	if err != nil {
		t.Fatal(err)
	}
	got := req.Header.Get("User-Agent")
	if got != targethttp.DefaultUserAgent {
		t.Fatalf("User-Agent = %q, want %q", got, targethttp.DefaultUserAgent)
	}
	if !strings.HasPrefix(got, "Mozilla/5.0 ") || !strings.Contains(got, "Chrome/") {
		t.Fatalf("User-Agent does not look like a common browser: %q", got)
	}
	if strings.Contains(strings.ToLower(got), "artex") {
		t.Fatalf("User-Agent discloses ARTEX: %q", got)
	}
}

func TestProbeRequestRejectsInvalidURL(t *testing.T) {
	if _, err := newProbeRequest("://bad"); err == nil {
		t.Fatal("newProbeRequest accepted an invalid URL")
	}
}
