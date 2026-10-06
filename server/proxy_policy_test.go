package server

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/Autumn-27/artex/traffic"
)

func TestBrowserUserAgentArgDetection(t *testing.T) {
	for _, args := range [][]string{
		{"--headless", "--user-agent", "Custom/1.0"},
		{"--headless", "--user-agent=Custom/1.0"},
	} {
		if !hasUserAgentArg(args) {
			t.Fatalf("custom User-Agent arg not detected: %v", args)
		}
	}
	if hasUserAgentArg([]string{"--headless", "--user-agent", ""}) {
		t.Fatal("empty User-Agent arg treated as explicit override")
	}
}

func TestCaptureOffKeepsLocalNormalizationProxy(t *testing.T) {
	tr, err := traffic.Open(t.TempDir(), "127.0.0.1:18888")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tr.Close() })
	tr.SetRecordingEnabled(false)

	m := &Manager{traffic: tr, trafficOn: false, globalProxy: "socks5://127.0.0.1:1080"}
	if got, want := m.ProxyAddr(), tr.ProxyAddr(); got != want {
		t.Fatalf("ProxyAddr = %q, want local normalizer %q", got, want)
	}
	if got := m.ProxyCACert(); got == "" {
		t.Fatal("ProxyCACert empty with capture off; HTTPS normalization would be bypassed")
	}
	if tr.RecordingEnabled() {
		t.Fatal("capture-off proxy unexpectedly records traffic")
	}

	s := &Server{m: m}
	transport := s.httpProxyTransport(httpExec{UseRecordingProxy: true})
	if transport == nil || transport.Proxy == nil {
		t.Fatal("recording-proxy transport is nil")
	}
	got, err := transport.Proxy(&http.Request{URL: &url.URL{Scheme: "https", Host: "target.invalid"}})
	if err != nil {
		t.Fatal(err)
	}
	if got.String() != tr.ProxyAddr() {
		t.Fatalf("custom HTTP proxy = %q, want %q", got, tr.ProxyAddr())
	}
}
