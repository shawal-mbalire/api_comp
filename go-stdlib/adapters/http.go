package adapters

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"backend-go/domain"
)

// ─── Driving adapter: stdlib net/http surface ────────────────────────────────
// Translates wire formats → domain calls via FeedService, and maps domain
// results/errors → HTTP. No SQL, no business rules here.

// Handler wires the routes to the FeedService. Uses Go 1.22+ method+path
// patterns ("GET /api/posts/{id}").
func NewHandler(service *domain.FeedService) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("GET /api/me", auth(func(w http.ResponseWriter, r *http.Request, user int64) {
		u, err := service.GetMe(r.Context(), user)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id": u.ID, "username": u.Username, "displayName": u.DisplayName,
		})
	}))

	mux.HandleFunc("GET /api/feed", auth(func(w http.ResponseWriter, r *http.Request, _ int64) {
		posts, err := service.GetFeed(r.Context())
		if err != nil {
			writeError(w, err)
			return
		}
		out := make([]map[string]any, 0, len(posts))
		for _, p := range posts {
			out = append(out, postDto(p))
		}
		writeJSON(w, http.StatusOK, out)
	}))

	mux.HandleFunc("GET /api/posts/{id}", auth(func(w http.ResponseWriter, r *http.Request, _ int64) {
		p, err := service.GetPost(r.Context(), r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, postDto(*p))
	}))

	mux.HandleFunc("POST /api/posts/{id}/like", auth(func(w http.ResponseWriter, r *http.Request, user int64) {
		if err := service.LikePost(r.Context(), user, r.PathValue("id")); err != nil {
			writeError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	mux.HandleFunc("POST /api/posts", auth(func(w http.ResponseWriter, r *http.Request, user int64) {
		var body struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
			return
		}
		p, err := service.CreatePost(r.Context(), user, body.Content)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, postDto(p))
	}))

	return mux
}

// auth extracts the acting user id (Bearer token) and gates any /api route.
func auth(fn func(http.ResponseWriter, *http.Request, int64)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := actingUserID(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		fn(w, r, user)
	}
}

// actingUserID: benchmark simplification — the bearer token IS the numeric id.
func actingUserID(r *http.Request) (int64, bool) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return 0, false
	}
	id, err := strconv.ParseInt(strings.TrimSpace(header[len("Bearer "):]), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// postDto maps the domain model to the contract's camelCase JSON.
func postDto(p domain.Post) map[string]any {
	return map[string]any{
		"id":          p.ID,
		"userId":      p.UserID,
		"username":    p.Username,
		"displayName": p.DisplayName,
		"content":     p.Content,
		// Contract: ISO-8601 UTC with fixed millisecond precision (.mmmZ).
		// RFC3339Nano strips trailing zeros (e.g. .120 -> .12), so use a
		// fixed layout that always renders exactly 3 fractional digits.
		"postedAt":    p.PostedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		"likeCount":   p.LikeCount,
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError maps domain errors → HTTP; unknown errors become 500.
func writeError(w http.ResponseWriter, err error) {
	var bad *domain.BadRequestError
	if errors.As(err, &bad) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad request"})
		return
	}
	var nf *domain.NotFoundError
	if errors.As(err, &nf) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
}