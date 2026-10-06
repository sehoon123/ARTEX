package server

import (
	"testing"

	"github.com/Autumn-27/artex/traffic"
)

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
}
