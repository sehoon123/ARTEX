# Target HTTP identity

ARTEX uses one desktop-browser `User-Agent` for target-facing HTTP requests when
the original value is missing or is a recognizable default from an automation
client (for example Norma, Go, curl, wget, Python requests, known HTTP scanner
UAs, or headless Chrome). An explicit non-tool `User-Agent` is preserved.

The shared policy is applied to enrichment probes (when invoked) and native
custom HTTP tools. ARTEX owns the Agent WebFetch implementation: it requires the
local target proxy and fails closed instead of retrying directly. Bash
subprocesses and the seeded Playwright MCP are given the embedded local proxy,
which applies the same policy before forwarding intercepted request headers.
Proxy-aware scanner modes can use that environment, but raw sockets and clients
that ignore proxy settings are not forced through it. Inherited `NO_PROXY` values
are cleared for Agent subprocesses.

Turning **Traffic capture** off disables persistence and traffic inspection tools;
it does not disable the local normalization hop. No request or response is stored
while capture is off. A configured global proxy remains the embedded proxy's
upstream in either mode.

This policy does **not** apply to control-plane traffic such as LLM providers,
self-update, notifications, MCP control connections, or web-search providers. It
also does not claim full browser impersonation: TLS signatures, HTTP/2 behavior,
header shape/order, JavaScript browser APIs, request timing, payloads, and source
IP can still identify automation. Contradictory Chromium UA client hints and
proxy-only headers are removed only on successfully intercepted requests. Hosts
placed in the proxy's TLS pass-through list cannot have encrypted request headers
rewritten. Application protocols can also be self-identifying: Git smart-HTTP,
for example, necessarily retains Git paths, media types, payloads, and the optional
`Git-Protocol` negotiation header even though its implementation/version UA is
normalized.

Implementation:

- `targethttp/fingerprint.go` — shared policy and browser profile
- `targethttp/webfetch.go` — strict proxy-only Agent WebFetch
- `traffic/traffic.go` — pre-forward normalization and capture-only persistence
- `enrich/enrich.go` — enrichment probes
- `server/customtool.go` — native HTTP custom tools
