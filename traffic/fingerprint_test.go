package traffic

import (
	"net/http"
	"testing"

	"github.com/Autumn-27/artex/targethttp"
	mproxy "github.com/lqqyt2423/go-mitmproxy/proxy"
)

func TestSinkNormalizesToolUserAgentBeforeForwarding(t *testing.T) {
	tr := &Traffic{}
	s := &sink{t: tr}
	flow := &mproxy.Flow{Request: &mproxy.Request{Header: http.Header{"User-Agent": {"norma/0.4"}}}}

	s.Requestheaders(flow)
	if got := flow.Request.Header.Get("User-Agent"); got != targethttp.DefaultUserAgent {
		t.Fatalf("User-Agent = %q, want %q", got, targethttp.DefaultUserAgent)
	}
}

func TestSinkPreservesExplicitNonToolUserAgent(t *testing.T) {
	tr := &Traffic{}
	s := &sink{t: tr}
	const custom = "CustomerApprovedClient/2.0"
	flow := &mproxy.Flow{Request: &mproxy.Request{Header: http.Header{"User-Agent": {custom}}}}

	s.Requestheaders(flow)
	if got := flow.Request.Header.Get("User-Agent"); got != custom {
		t.Fatalf("User-Agent = %q, want %q", got, custom)
	}
}

func TestSinkPreserveMarkerIsConsumedBeforeForwarding(t *testing.T) {
	const custom = "curl/8.99 custom-audit-profile"
	flow := &mproxy.Flow{Request: &mproxy.Request{Header: http.Header{
		"User-Agent":                       {custom},
		targethttp.PreserveUserAgentHeader: {"1"},
	}}}
	(&sink{t: &Traffic{}}).Requestheaders(flow)
	if got := flow.Request.Header.Get("User-Agent"); got != custom {
		t.Fatalf("User-Agent = %q, want %q", got, custom)
	}
	if got := flow.Request.Header.Get(targethttp.PreserveUserAgentHeader); got != "" {
		t.Fatalf("internal preserve header leaked: %q", got)
	}
}

func TestRecordingToggleDoesNotDisableNormalization(t *testing.T) {
	tr := &Traffic{}
	tr.SetRecordingEnabled(false)
	if tr.RecordingEnabled() {
		t.Fatal("recording unexpectedly enabled")
	}
	flow := &mproxy.Flow{
		Request:  &mproxy.Request{Header: make(http.Header)},
		Response: &mproxy.Response{StatusCode: http.StatusNoContent},
	}
	s := &sink{t: tr}
	s.Requestheaders(flow)
	if got := flow.Request.Header.Get("User-Agent"); got != targethttp.DefaultUserAgent {
		t.Fatalf("capture-off User-Agent = %q, want %q", got, targethttp.DefaultUserAgent)
	}
	// A nil DB would panic in record; capture-off must return before persistence.
	s.Response(flow)
}
