// HTTP-level tests for the Gin driving adapter (adapters/http.go) via
// httptest.ResponseRecorder — no server socket and no database needed. Covers
// auth gating, status codes, contract JSON shapes, and error bodies.
package tests

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"backend-go/adapters"
	"backend-go/domain"
)

func newGinApp() *gin.Engine {
	return adapters.NewHandler(domain.NewFeedService(newFakeRepo()))
}

func do(t *testing.T, engine *gin.Engine, method, path string, body any, auth string) *httptest.ResponseRecorder {
	t.Helper()

	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}

	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}

	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	return w
}

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode body %q: %v", w.Body.String(), err)
	}
	return out
}

func TestHealthIsPublic(t *testing.T) {
	engine := newGinApp()
	w := do(t, engine, http.MethodGet, "/health", nil, "")

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	body := decode(t, w)
	if body["status"] != "ok" {
		t.Fatalf("body = %v, want status=ok", body)
	}
}

func TestAPIRoutesRequireAuth(t *testing.T) {
	engine := newGinApp()

	cases := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/me"},
		{http.MethodGet, "/api/feed"},
		{http.MethodGet, "/api/posts/10"},
		{http.MethodPost, "/api/posts/10/like"},
		{http.MethodPost, "/api/posts"},
	}
	for _, tc := range cases {
		w := do(t, engine, tc.method, tc.path, nil, "")
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s without auth: status = %d, want 401", tc.method, tc.path, w.Code)
		}
		body := decode(t, w)
		if body["error"] != "unauthorized" {
			t.Fatalf("%s %s without auth: body = %v, want error=unauthorized", tc.method, tc.path, body)
		}
	}
}

func TestMalformedBearerTokensRejected(t *testing.T) {
	engine := newGinApp()

	for _, token := range []string{"7.0", "1e3", "0x10", "+7", " 7", "7 ", "", "0", "-1"} {
		w := do(t, engine, http.MethodGet, "/api/me", nil, "Bearer "+token)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("Bearer %q: status = %d, want 401", token, w.Code)
		}
	}
}

func TestGetMe(t *testing.T) {
	engine := newGinApp()
	w := do(t, engine, http.MethodGet, "/api/me", nil, "Bearer 1")

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	body := decode(t, w)
	if body["id"] != float64(1) || body["username"] != "user_000001" || body["displayName"] != "Alice" {
		t.Fatalf("body = %v", body)
	}
}

func TestGetFeedShape(t *testing.T) {
	engine := newGinApp()
	w := do(t, engine, http.MethodGet, "/api/feed", nil, "Bearer 1")

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var posts []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &posts); err != nil {
		t.Fatalf("decode feed: %v", err)
	}
	if len(posts) != 1 {
		t.Fatalf("feed length = %d, want 1", len(posts))
	}
	first := posts[0]
	if first["id"] != float64(10) || first["postedAt"] != "2026-07-01T12:00:00.000Z" || first["likeCount"] != float64(2) {
		t.Fatalf("first post = %v", first)
	}
}

func TestGetPostStatusCodes(t *testing.T) {
	engine := newGinApp()

	ok := do(t, engine, http.MethodGet, "/api/posts/10", nil, "Bearer 1")
	if ok.Code != http.StatusOK {
		t.Fatalf("existing post: status = %d, want 200", ok.Code)
	}

	missing := do(t, engine, http.MethodGet, "/api/posts/999", nil, "Bearer 1")
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing post: status = %d, want 404", missing.Code)
	}
	body := decode(t, missing)
	if body["error"] != "not found" {
		t.Fatalf("missing post body = %v, want error=not found", body)
	}
}

func TestLikePost(t *testing.T) {
	engine := newGinApp()
	w := do(t, engine, http.MethodPost, "/api/posts/10/like", nil, "Bearer 1")

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", w.Code)
	}
	if w.Body.Len() != 0 {
		t.Fatalf("204 body = %q, want empty", w.Body.String())
	}
}

func TestCreatePost(t *testing.T) {
	engine := newGinApp()

	created := do(t, engine, http.MethodPost, "/api/posts", map[string]any{"content": "  hello gin  "}, "Bearer 1")
	if created.Code != http.StatusCreated {
		t.Fatalf("create: status = %d, want 201", created.Code)
	}
	body := decode(t, created)
	if body["content"] != "hello gin" || body["likeCount"] != float64(0) {
		t.Fatalf("created body = %v", body)
	}

	blank := do(t, engine, http.MethodPost, "/api/posts", map[string]any{"content": "   "}, "Bearer 1")
	if blank.Code != http.StatusBadRequest {
		t.Fatalf("blank: status = %d, want 400", blank.Code)
	}

	malformed := do(t, engine, http.MethodPost, "/api/posts", "not json", "Bearer 1")
	if malformed.Code != http.StatusBadRequest {
		t.Fatalf("malformed: status = %d, want 400", malformed.Code)
	}
}