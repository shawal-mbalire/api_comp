package adapters

// ─── Driving adapter: Gin HTTP surface (gin-gonic) ───────────────────────────
// Translates wire formats → domain calls via FeedService, and maps domain
// results/errors → HTTP. No SQL, no business rules here.

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"backend-go/domain"
)

// Context key where the auth middleware stashes the acting user id.
const actingUserKey = "actingUserID"

// NewHandler wires the routes to the FeedService. Uses Gin (gin-gonic) as the
// driving adapter: group /api behind the auth middleware, /health public.
func NewHandler(service *domain.FeedService) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)

	engine := gin.New()
	engine.Use(gin.Recovery())
	engine.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	})

	engine.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	api := engine.Group("/api", auth())
	api.GET("/me", func(c *gin.Context) {
		u, err := service.GetMe(c.Request.Context(), userID(c))
		if err != nil {
			errorJSON(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"id": u.ID, "username": u.Username, "displayName": u.DisplayName,
		})
	})

	api.GET("/feed", func(c *gin.Context) {
		posts, err := service.GetFeed(c.Request.Context())
		if err != nil {
			errorJSON(c, err)
			return
		}
		out := make([]map[string]any, 0, len(posts))
		for _, p := range posts {
			out = append(out, postDto(p))
		}
		c.JSON(http.StatusOK, out)
	})

	api.GET("/posts/:id", func(c *gin.Context) {
		p, err := service.GetPost(c.Request.Context(), c.Param("id"))
		if err != nil {
			errorJSON(c, err)
			return
		}
		c.JSON(http.StatusOK, postDto(*p))
	})

	api.POST("/posts/:id/like", func(c *gin.Context) {
		if err := service.LikePost(c.Request.Context(), userID(c), c.Param("id")); err != nil {
			errorJSON(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	})

	api.POST("/posts", func(c *gin.Context) {
		var body struct {
			Content string `json:"content"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
			return
		}
		p, err := service.CreatePost(c.Request.Context(), userID(c), body.Content)
		if err != nil {
			errorJSON(c, err)
			return
		}
		c.JSON(http.StatusCreated, postDto(p))
	})

	return engine
}

// userID returns the acting user id the auth middleware stashed on the context.
func userID(c *gin.Context) int64 {
	return c.GetInt64(actingUserKey)
}

// auth gates every /api/* route (all except /health, per the contract).
func auth() gin.HandlerFunc {
	return func(c *gin.Context) {
		user, ok := actingUserID(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Set(actingUserKey, user)
		c.Next()
	}
}

// actingUserID: benchmark simplification — the bearer token IS the numeric id.
// The token must be a bare positive integer; floats, hex, exponents, signs and
// surrounding whitespace are all malformed → false (parity across all stacks).
func actingUserID(c *gin.Context) (int64, bool) {
	header := c.GetHeader("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return 0, false
	}

	token := header[len("Bearer "):]
	if !isDigitsOnly(token) {
		return 0, false
	}

	id, err := strconv.ParseInt(token, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// isDigitsOnly reports whether s is a non-empty run of ASCII digits.
func isDigitsOnly(s string) bool {
	if s == "" {
		return false
	}
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
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

// errorJSON maps domain errors → HTTP; unknown errors become 500.
func errorJSON(c *gin.Context, err error) {
	var bad *domain.BadRequestError
	if errors.As(err, &bad) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"})
		return
	}
	var nf *domain.NotFoundError
	if errors.As(err, &nf) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	log.Printf("internal error: %v", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
}