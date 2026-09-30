package web

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jubishop/tdb/internal/backend"
)

func testHandler(t *testing.T) http.Handler {
	t.Helper()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeSuccess(w, map[string]string{"name": "example"}, 200)
	}))
	t.Cleanup(ts.Close)
	u, _ := url.Parse(ts.URL)
	return Handler(&backend.Backend{URL: u})
}

type envelope struct {
	Data any `json:"data"`
}

func doJSON(t *testing.T, ts *httptest.Server, method, path string, data any) (*http.Response, envelope) {
	t.Helper()
	body, _ := json.Marshal(data)
	req, _ := http.NewRequest(method, ts.URL+path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var env envelope
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		t.Fatal(err)
	}
	return resp, env
}

func TestBrowserEmbeddedAssets(t *testing.T) {
	handler := testHandler(t)
	for _, path := range []string{"/", "/assets/style.css", "/assets/details.css", "/assets/app.js", "/assets/api.js", "/assets/details.js", "/assets/workspace.js", "/assets/ui.js"} {
		req := httptest.NewRequest("GET", "http://127.0.0.1:8090"+path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != http.StatusOK || response.Body.Len() == 0 {
			t.Fatalf("%s: status %d, %s", path, response.Code, response.Body.String())
		}
		if response.Header().Get("Content-Security-Policy") == "" {
			t.Fatalf("missing CSP for %s", path)
		}
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "http://127.0.0.1/missing", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("unexpected route status: %d", response.Code)
	}
}

func TestBrowserOriginBoundary(t *testing.T) {
	handler := testHandler(t)
	for _, tc := range []struct {
		host, origin, site string
		want               int
	}{
		{"127.0.0.1:8080", "http://127.0.0.1:8080", "same-origin", 200},
		{"localhost:8080", "", "none", 200},
		{"[::1]:8080", "http://[::1]:8080", "same-origin", 200},
		{"127.0.0.1:8080", "https://example.com", "cross-site", 403},
		{"127.0.0.1:8080", "http://127.0.0.1:9090", "same-site", 403},
		{"127.0.0.1:8080", "null", "", 403},
		{"attacker.example:8080", "", "", 403},
		{"127.0.0.1:8080", "", "cross-site", 403},
	} {
		t.Run(tc.host+tc.origin+tc.site, func(t *testing.T) {
			r := httptest.NewRequest("GET", "http://"+tc.host+"/v1/project", nil)
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("Sec-Fetch-Site", tc.site)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestBrowserMarkdownSanitization(t *testing.T) {
	handler := testHandler(t)
	ts := httptest.NewServer(handler)
	defer ts.Close()
	_, env := doJSON(t, ts, "POST", "/v1/markdown", map[string]string{"text": "# Heading\n\n- [x] Done\n\n[bad](javascript:alert(1))\n\n<script>alert(1)</script><img src=x onerror=alert(2)>\n\n```go\nvar ok = true\n```"})
	html := env.Data.(map[string]interface{})["html"].(string)
	for _, forbidden := range []string{"<script", "onerror", "javascript:"} {
		if strings.Contains(html, forbidden) {
			t.Fatalf("unsafe HTML: %s", html)
		}
	}
	for _, expected := range []string{"<h1>Heading</h1>", "<pre>", "<code", `<input`, `disabled`, `checked`} {
		if !strings.Contains(html, expected) {
			t.Fatalf("missing Markdown output %s: %s", expected, html)
		}
	}
}

func TestBrowserMarkdownRejectsEncodedDangerousURLs(t *testing.T) {
	handler := testHandler(t)
	ts := httptest.NewServer(handler)
	defer ts.Close()
	for _, source := range []string{
		`[click](&#106;avascript:alert(1))`,
		`<javascript:alert(document.domain)>`,
		`![alt](&#106;avascript:alert(1))`,
	} {
		t.Run(source, func(t *testing.T) {
			var rendered bytes.Buffer
			if err := browserMarkdown.Convert([]byte(source), &rendered); err != nil {
				t.Fatal(err)
			}
			for _, attribute := range []string{`href="javascript:`, `src="javascript:`} {
				if strings.Contains(rendered.String(), attribute) {
					t.Errorf("renderer emitted an unsafe URL before sanitization: %s", rendered.String())
				}
			}
			_, env := doJSON(t, ts, "POST", "/v1/markdown", map[string]string{"text": source})
			html := env.Data.(map[string]interface{})["html"].(string)
			for _, attribute := range []string{`href="javascript:`, `src="javascript:`} {
				if strings.Contains(html, attribute) {
					t.Errorf("endpoint emitted an unsafe URL: %s", html)
				}
			}
		})
	}
}

func TestProxyPreservesConditionalWritesAndStreams(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" || r.Header.Get("Cookie") != "" {
			t.Errorf("credentials not isolated")
		}
		switch r.URL.Path {
		case "/v1/issues/td-123":
			if r.Header.Get("If-Match") != `"old"` || r.Method != "PATCH" || r.URL.Query().Get("q") != "1" {
				t.Errorf("lost request semantics")
			}
			w.Header().Set("ETag", `"new"`)
			writeError(w, "Task changed", http.StatusConflict)
		case "/v1/events":
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "event: connected\ndata: {}\n\n")
			w.(http.Flusher).Flush()
			<-r.Context().Done()
		}
	}))
	defer api.Close()
	u, _ := url.Parse(api.URL)
	frontend := httptest.NewServer(Handler(&backend.Backend{URL: u, Token: "secret"}))
	defer frontend.Close()
	req, _ := http.NewRequest("PATCH", frontend.URL+"/v1/issues/td-123?q=1", strings.NewReader(`{"title":"draft"}`))
	req.Header.Set("If-Match", `"old"`)
	req.Header.Set("Authorization", "Bearer untrusted")
	req.Header.Set("Cookie", "session=untrusted")
	client := &http.Client{Timeout: time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 409 || resp.Header.Get("ETag") != `"new"` {
		t.Fatalf("lost conflict: %+v", resp)
	}
	stream, err := client.Get(frontend.URL + "/v1/events")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	buf := make([]byte, 128)
	n, err := stream.Body.Read(buf)
	if err != nil || !strings.Contains(string(buf[:n]), "connected") {
		t.Fatalf("stream did not flush: %s %v", buf[:n], err)
	}
}
