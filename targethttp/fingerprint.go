// Package targethttp defines the HTTP identity used for target-facing traffic.
// It deliberately excludes control-plane requests such as LLM providers,
// notifications, MCP control traffic, web-search providers, and self-update.
package targethttp

import (
	"net/http"
	"strings"
)

// DefaultUserAgent is intentionally an ordinary desktop-browser UA. Keep one
// value for every target-facing path so target access logs do not reveal which
// ARTEX tool produced a request.
const DefaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"

var recognizableToolUserAgents = []string{
	"norma/",
	"go-http-client/",
	"curl/",
	"wget/",
	"python-requests/",
	"python-urllib/",
	"aiohttp/",
	"httpie/",
	"libwww-perl/",
	"lwp-trivial/",
	"scrapy/",
	"mechanize/",
	"sqlmap/",
	"nikto/",
	"gobuster/",
	"ffuf/",
	"feroxbuster/",
	"dirbuster/",
	"dirb/",
	"nuclei",
	"nmap scripting engine",
	"httpx",
	"zgrab",
	"masscan/",
	"headlesschrome/",
	"playwright/",
	"git/",
	"spa-api-recon",
	"okhttp/",
	"java/",
	"powershell/",
}

var exactToolUserAgents = map[string]bool{
	"node": true,
}

// NormalizeUserAgent replaces a missing or recognizable tool-default UA with
// DefaultUserAgent. A caller-supplied non-tool UA is preserved. It returns true
// when it changed the header.
func NormalizeUserAgent(header http.Header) bool {
	if header == nil {
		return false
	}
	ua := strings.TrimSpace(header.Get("User-Agent"))
	if ua != "" && !IsRecognizableToolUserAgent(ua) {
		return false
	}
	header.Set("User-Agent", DefaultUserAgent)
	return true
}

// NormalizeProxyHeaders applies the target policy at the local proxy boundary.
// It also removes proxy-only and ARTEX-internal headers. When a tool UA is
// replaced, Chromium client hints are removed so they cannot contradict the
// shared Windows/Chrome profile. The origin can still fingerprint TLS, header
// shape, JavaScript APIs, and behavior; this is de-branding, not impersonation.
func NormalizeProxyHeaders(header http.Header) bool {
	if header == nil {
		return false
	}
	for key := range header {
		lower := strings.ToLower(key)
		if strings.HasPrefix(lower, "x-artex-") {
			delete(header, key)
		}
	}
	header.Del("Proxy-Connection")
	header.Del("Proxy-Authorization")
	changed := NormalizeUserAgent(header)
	if changed || header.Get("User-Agent") == DefaultUserAgent {
		for key := range header {
			if strings.HasPrefix(strings.ToLower(key), "sec-ch-ua") {
				delete(header, key)
			}
		}
	}
	return changed
}

// IsRecognizableToolUserAgent reports whether a UA exposes a common automation
// client/tool name. Matching is deliberately narrow; arbitrary explicit UAs are
// not rewritten.
func IsRecognizableToolUserAgent(ua string) bool {
	lower := strings.ToLower(strings.TrimSpace(ua))
	if exactToolUserAgents[lower] {
		return true
	}
	for _, marker := range recognizableToolUserAgents {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
