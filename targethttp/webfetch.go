package targethttp

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/Autumn-27/norma/permission"
	actool "github.com/Autumn-27/norma/tool"
	"golang.org/x/net/html"
)

// WebFetchConfig configures ARTEX's target-facing WebFetch tool. Proxy is
// mandatory: WebFetch must traverse the target proxy and never fall back to a
// direct connection. CACert, when set, is added to the system trust roots so
// HTTPS certificates re-signed by the local MITM proxy remain verified.
type WebFetchConfig struct {
	Proxy  string
	CACert string
}

// NewWebFetch returns the ARTEX-owned WebFetch replacement. Its model-facing
// contract and permission behavior match Norma's WebFetch, while its HTTP client
// is deliberately fail-closed: every request (including redirects) uses the one
// configured proxy transport and a proxy error is returned without a direct
// retry. This is target-plane traffic; callers must not use it for LLM, search,
// notification, MCP control, update, or other control-plane requests.
func NewWebFetch(cfg WebFetchConfig) actool.CoreTool {
	client, clientErr := newWebFetchClient(cfg)
	return actool.Build(actool.Spec{
		Name:        "WebFetch",
		Description: "Fetches an HTTP(S) HTML page, documentation page, or API response and returns it as Markdown. Do not use this tool for static assets, including JavaScript, CSS, source maps, images, fonts, audio, or video—even if their URLs are found in a fetched page or explicitly requested. Fetch the owning page instead. Set `extract=true` to list comments, scripts, stylesheets, endpoints, forms, links, and meta tags. Listed asset URLs are for inspection only and must not be fetched. Large responses may be truncated. This makes an external network request.",
		Schema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"url":     map[string]any{"type": "string", "description": "The absolute http(s) URL to fetch. JS/CSS/static-asset suffix URLs are not allowed."},
				"extract": map[string]any{"type": "boolean", "description": "When true, append a RECON section preserving HTML comments, <script src>, inline-script endpoints, forms/inputs (including hidden), links and meta tags. Default false."},
			},
			"required": []any{"url"},
		},
		// Network access is open-world: require approval rather than auto-allow.
		Permissions: func(_ context.Context, input json.RawMessage, _ permission.Context) permission.Decision {
			var in struct {
				URL string `json:"url"`
			}
			_ = json.Unmarshal(input, &in)
			return permission.AskUser("fetch external URL: " + in.URL)
		},
		Run: webFetchRunner(client, clientErr),
	})
}

const maxWebFetchBytes = 2 << 20 // 2 MiB

// newWebFetchClient constructs exactly one proxy-bound client. Configuration
// errors are retained by NewWebFetch and surfaced on Call, because CoreTool
// constructors do not return errors. In particular, an empty/invalid proxy or an
// unreadable CA can never degrade into net/http's direct transport.
func newWebFetchClient(cfg WebFetchConfig) (*http.Client, error) {
	rawProxy := strings.TrimSpace(cfg.Proxy)
	if rawProxy == "" {
		return nil, errors.New("target proxy is not configured")
	}
	proxyURL, err := url.Parse(rawProxy)
	if err != nil || proxyURL.Host == "" {
		return nil, errors.New("configured target proxy URL is invalid")
	}
	switch strings.ToLower(proxyURL.Scheme) {
	case "http", "https", "socks5", "socks5h":
	default:
		return nil, errors.New("configured target proxy URL has an unsupported scheme")
	}

	transport := &http.Transport{Proxy: http.ProxyURL(proxyURL)}
	if caPath := strings.TrimSpace(cfg.CACert); caPath != "" {
		pem, err := os.ReadFile(caPath)
		if err != nil {
			return nil, fmt.Errorf("read target proxy CA: %w", err)
		}
		pool, _ := x509.SystemCertPool()
		if pool == nil {
			pool = x509.NewCertPool()
		}
		if !pool.AppendCertsFromPEM(pem) {
			return nil, errors.New("target proxy CA contains no valid certificate")
		}
		transport.TLSClientConfig = &tls.Config{RootCAs: pool}
	}
	return &http.Client{Transport: transport}, nil
}

// staticWebFetchAssetExts are linked-resource extensions WebFetch refuses.
var staticWebFetchAssetExts = map[string]bool{
	".js": true, ".mjs": true, ".cjs": true, ".css": true, ".map": true,
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".svg": true,
	".webp": true, ".avif": true, ".ico": true, ".bmp": true,
	".woff": true, ".woff2": true, ".ttf": true, ".otf": true, ".eot": true,
	".wasm": true, ".mp4": true, ".webm": true, ".mp3": true, ".wav": true, ".ogg": true,
}

func staticWebFetchAssetExt(rawURL string) string {
	path := rawURL
	if parsed, err := url.Parse(rawURL); err == nil {
		path = parsed.Path
	}
	if i := strings.LastIndexByte(path, '/'); i >= 0 {
		path = path[i+1:]
	}
	dot := strings.LastIndexByte(path, '.')
	if dot < 0 {
		return ""
	}
	if ext := strings.ToLower(path[dot:]); staticWebFetchAssetExts[ext] {
		return ext
	}
	return ""
}

func webFetchRunner(client *http.Client, clientErr error) func(context.Context, json.RawMessage, *actool.ToolContext) (actool.Result, error) {
	return func(ctx context.Context, input json.RawMessage, _ *actool.ToolContext) (actool.Result, error) {
		var in struct {
			URL     string `json:"url"`
			Extract bool   `json:"extract"`
		}
		if err := json.Unmarshal(input, &in); err != nil {
			return actool.Result{}, err
		}
		if !strings.HasPrefix(in.URL, "http://") && !strings.HasPrefix(in.URL, "https://") {
			return actool.Errorf("Error: url must start with http:// or https://"), nil
		}
		if ext := staticWebFetchAssetExt(in.URL); ext != "" {
			return actool.Errorf("Error: WebFetch does not fetch static assets (" + ext + " file). It reads HTML pages, documentation, and API responses — not linked resources like scripts, styles, images, or fonts. Fetch the page that references this asset instead."), nil
		}
		if clientErr != nil {
			return actool.Errorf("Error fetching URL: " + clientErr.Error()), nil
		}

		requestCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, in.URL, nil)
		if err != nil {
			return actool.Errorf("Error: " + err.Error()), nil
		}
		NormalizeUserAgent(req.Header)
		resp, err := client.Do(req)
		if err != nil {
			return actool.Errorf("Error fetching URL: " + err.Error()), nil
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, maxWebFetchBytes))

		header := fmt.Sprintf("[%d %s] %s\n", resp.StatusCode, http.StatusText(resp.StatusCode), in.URL)
		if server := resp.Header.Get("Server"); server != "" {
			header += "Server: " + server + "\n"
		}
		if poweredBy := resp.Header.Get("X-Powered-By"); poweredBy != "" {
			header += "X-Powered-By: " + poweredBy + "\n"
		}

		var out string
		if strings.Contains(strings.ToLower(resp.Header.Get("content-type")), "html") {
			doc, parseErr := html.Parse(strings.NewReader(string(body)))
			if parseErr != nil {
				out = string(body)
			} else {
				out = webFetchHTMLToMarkdown(doc)
				if in.Extract {
					if recon := webFetchExtractRecon(doc); recon != "" {
						out += "\n\n" + recon
					}
				}
			}
		} else {
			out = string(body)
		}
		return actool.Text(truncateWebFetch(header+strings.TrimSpace(out), 50000)), nil
	}
}

var (
	webFetchWS         = regexp.MustCompile(`[ \t]+`)
	webFetchLineTrim   = regexp.MustCompile(` *\n *`)
	webFetchBlankLines = regexp.MustCompile(`\n{2,}`)
	// webFetchEndpoint matches quoted absolute URLs and root-relative paths in inline JS.
	webFetchEndpoint = regexp.MustCompile("[\"'`](https?://[^\"'`\\s]+|/[A-Za-z0-9._~$&'()*+,;=:@%/?#\\[\\]-]{2,})[\"'`]")
)

var webFetchSkipMarkdown = map[string]bool{"script": true, "style": true, "noscript": true, "svg": true, "template": true}

func webFetchHTMLToMarkdown(doc *html.Node) string {
	var b strings.Builder
	webFetchRenderNode(&b, doc)
	out := webFetchWS.ReplaceAllString(b.String(), " ")
	out = webFetchLineTrim.ReplaceAllString(out, "\n")
	out = webFetchBlankLines.ReplaceAllString(out, "\n")
	return strings.TrimSpace(out)
}

func webFetchRenderNode(b *strings.Builder, node *html.Node) {
	switch node.Type {
	case html.TextNode:
		b.WriteString(strings.ReplaceAll(node.Data, "\n", " "))
		return
	case html.ElementNode:
		if webFetchSkipMarkdown[node.Data] {
			return
		}
	default:
		if node.Type != html.DocumentNode {
			return
		}
	}

	tag := ""
	if node.Type == html.ElementNode {
		tag = node.Data
	}
	switch tag {
	case "h1", "h2", "h3", "h4", "h5", "h6":
		b.WriteString("\n\n" + strings.Repeat("#", int(tag[1]-'0')) + " ")
		webFetchRenderChildren(b, node)
		b.WriteString("\n\n")
	case "title":
		b.WriteString("\n\n# ")
		webFetchRenderChildren(b, node)
		b.WriteString("\n\n")
	case "p", "div", "section", "article", "header", "footer", "main", "ul", "ol", "table", "tr", "blockquote":
		b.WriteString("\n\n")
		webFetchRenderChildren(b, node)
		b.WriteString("\n\n")
	case "br":
		b.WriteString("\n")
	case "hr":
		b.WriteString("\n\n---\n\n")
	case "li":
		b.WriteString("\n- ")
		webFetchRenderChildren(b, node)
	case "a":
		var inner strings.Builder
		webFetchRenderChildren(&inner, node)
		text := strings.TrimSpace(inner.String())
		if href := webFetchAttr(node, "href"); href != "" && text != "" {
			fmt.Fprintf(b, "[%s](%s)", text, href)
		} else {
			b.WriteString(text)
		}
	case "img":
		if src := webFetchAttr(node, "src"); src != "" {
			fmt.Fprintf(b, "![%s](%s)", webFetchAttr(node, "alt"), src)
		}
	case "strong", "b":
		b.WriteString("**")
		webFetchRenderChildren(b, node)
		b.WriteString("**")
	case "em", "i":
		b.WriteString("*")
		webFetchRenderChildren(b, node)
		b.WriteString("*")
	case "code":
		b.WriteString("`")
		webFetchRenderChildren(b, node)
		b.WriteString("`")
	case "pre":
		var inner strings.Builder
		webFetchTextOnly(&inner, node)
		b.WriteString("\n\n```\n" + strings.TrimSpace(inner.String()) + "\n```\n\n")
	default:
		webFetchRenderChildren(b, node)
	}
}

func webFetchRenderChildren(b *strings.Builder, node *html.Node) {
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		webFetchRenderNode(b, child)
	}
}

func webFetchExtractRecon(doc *html.Node) string {
	var comments, scriptSources, inlineEndpoints, forms, metas, links []string
	seenLink := map[string]bool{}

	var walk func(*html.Node)
	walk = func(node *html.Node) {
		switch node.Type {
		case html.CommentNode:
			if comment := webFetchOneLine(node.Data, 300); comment != "" {
				comments = append(comments, comment)
			}
		case html.ElementNode:
			switch node.Data {
			case "script":
				if src := webFetchAttr(node, "src"); src != "" {
					scriptSources = append(scriptSources, src)
				} else {
					var body strings.Builder
					webFetchTextOnly(&body, node)
					for _, match := range webFetchEndpoint.FindAllStringSubmatch(body.String(), 40) {
						inlineEndpoints = append(inlineEndpoints, match[1])
					}
				}
			case "form":
				forms = append(forms, webFetchDescribeForm(node))
			case "meta":
				name := webFetchAttr(node, "name")
				if name == "" {
					name = webFetchAttr(node, "property")
				}
				if content := webFetchAttr(node, "content"); name != "" && content != "" {
					metas = append(metas, name+"="+webFetchOneLine(content, 120))
				}
			case "a", "link":
				if href := webFetchAttr(node, "href"); href != "" && !seenLink[href] {
					seenLink[href] = true
					links = append(links, href)
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(doc)

	var b strings.Builder
	b.WriteString("=== RECON ===")
	webFetchReconSection(&b, "COMMENTS", comments)
	webFetchReconSection(&b, "SCRIPTS (src)", webFetchDedup(scriptSources))
	webFetchReconSection(&b, "INLINE ENDPOINTS", webFetchDedup(inlineEndpoints))
	webFetchReconSection(&b, "FORMS", forms)
	webFetchReconSection(&b, "META", metas)
	webFetchReconSection(&b, "LINKS", webFetchCapSlice(links, 100))
	if b.Len() == len("=== RECON ===") {
		return ""
	}
	return b.String()
}

func webFetchDescribeForm(form *html.Node) string {
	method := strings.ToUpper(webFetchAttr(form, "method"))
	if method == "" {
		method = http.MethodGet
	}
	var inputs []string
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			switch node.Data {
			case "input", "textarea", "select":
				inputType := webFetchAttr(node, "type")
				if inputType == "" {
					inputType = node.Data
				}
				description := webFetchAttr(node, "name") + "(" + inputType
				if inputType == "hidden" {
					if value := webFetchAttr(node, "value"); value != "" {
						description += "=" + webFetchOneLine(value, 60)
					}
				}
				inputs = append(inputs, description+")")
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(form)
	return fmt.Sprintf("%s %s → %s", method, webFetchAttr(form, "action"), strings.Join(inputs, " "))
}

func webFetchAttr(node *html.Node, key string) string {
	for _, attribute := range node.Attr {
		if attribute.Key == key {
			return attribute.Val
		}
	}
	return ""
}

func webFetchTextOnly(b *strings.Builder, node *html.Node) {
	if node.Type == html.TextNode {
		b.WriteString(node.Data)
		return
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		webFetchTextOnly(b, child)
	}
}

func webFetchOneLine(value string, max int) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) > max {
		return value[:max] + "…"
	}
	return value
}

func webFetchReconSection(b *strings.Builder, title string, items []string) {
	if len(items) == 0 {
		return
	}
	b.WriteString("\n\n## " + title + "\n")
	for _, item := range items {
		b.WriteString("- " + item + "\n")
	}
}

func webFetchDedup(in []string) []string {
	seen := map[string]bool{}
	out := in[:0:0]
	for _, value := range in {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func webFetchCapSlice(in []string, max int) []string {
	if len(in) <= max {
		return in
	}
	return append(in[:max:max], fmt.Sprintf("… (%d more)", len(in)-max))
}

func truncateWebFetch(value string, max int) string {
	if max <= 0 || len(value) <= max {
		return value
	}
	half := max / 2
	return value[:half] + fmt.Sprintf("\n\n... [%d characters truncated] ...\n\n", len(value)-max) + value[len(value)-half:]
}
