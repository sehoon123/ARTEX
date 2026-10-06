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

// PreserveUserAgentHeader is an internal hop-by-hop signal used when ARTEX can
// prove a UA was explicitly supplied. The local proxy always removes it before
// forwarding, so it must never appear in target logs.
const PreserveUserAgentHeader = "X-Artex-Internal-Preserve-User-Agent"

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

// NormalizeProxyUserAgent applies the target policy at the local proxy boundary.
// An internal preserve signal wins once and is always stripped before forwarding.
func NormalizeProxyUserAgent(header http.Header) bool {
	if header == nil {
		return false
	}
	preserve := header.Get(PreserveUserAgentHeader) != ""
	header.Del(PreserveUserAgentHeader)
	if preserve {
		return false
	}
	return NormalizeUserAgent(header)
}

// IsRecognizableToolUserAgent reports whether a UA exposes a common automation
// client/tool name. Matching is deliberately narrow; arbitrary explicit UAs are
// not rewritten.
func IsRecognizableToolUserAgent(ua string) bool {
	lower := strings.ToLower(strings.TrimSpace(ua))
	for _, marker := range recognizableToolUserAgents {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
