# Target HTTP identity

ARTEX uses one desktop-browser `User-Agent` for target-facing HTTP requests when
the original value is missing or is a recognizable default from an automation
client (for example Norma, Go, curl, wget, Python requests, scanners, or headless
Chrome). An explicit non-tool `User-Agent` is preserved.

The shared policy is applied to automatic enrichment and native custom HTTP
tools. Agent WebFetch, Bash subprocesses, scanners, and the seeded Playwright MCP
also use the embedded local proxy, which applies the same policy before forwarding
request headers.

Turning **Traffic capture** off disables persistence and traffic inspection tools;
it does not disable the local normalization hop. No request or response is stored
while capture is off. A configured global proxy remains the embedded proxy's
upstream in either mode.

This policy does **not** apply to control-plane traffic such as LLM providers,
self-update, notifications, MCP control connections, or web-search providers. It
also does not claim full browser impersonation: TLS signatures, HTTP/2 behavior,
and header ordering can still identify a non-browser client. Hosts placed in the
proxy's TLS pass-through list cannot have encrypted request headers rewritten.

Implementation:

- `targethttp/fingerprint.go` — shared policy and browser profile
- `traffic/traffic.go` — pre-forward normalization and capture-only persistence
- `enrich/enrich.go` — enrichment probes
- `server/customtool.go` — native HTTP custom tools
