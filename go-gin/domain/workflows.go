package domain

import (
	"context"
	"strconv"
	"strings"
)

// FeedService is the application workflow layer: pure orchestrators that
// validate inputs first, then drive the FeedRepository port. No I/O and no
// framework types here — adapters translate everything else.
type FeedService struct {
	repo FeedRepository
}

func NewFeedService(repo FeedRepository) *FeedService { return &FeedService{repo: repo} }

// ParseID validates a positive integer id. Pure.
func ParseID(raw string) (int64, error) {
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0, NewBadRequestError("bad request")
	}
	return id, nil
}

// ValidateContent trims and requires non-empty content. Pure.
func ValidateContent(raw string) (string, error) {
	content := strings.TrimSpace(raw)
	if content == "" {
		return "", NewBadRequestError("content required")
	}
	return content, nil
}

// GetMe → GET /api/me
func (s *FeedService) GetMe(ctx context.Context, actingUser int64) (*User, error) {
	u, err := s.repo.FindByUserID(ctx, actingUser)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, NewNotFoundError("not found")
	}
	return u, nil
}

// GetFeed → GET /api/feed (20 newest posts)
func (s *FeedService) GetFeed(ctx context.Context) ([]Post, error) {
	return s.repo.Feed(ctx)
}

// GetPost → GET /api/posts/{id}
func (s *FeedService) GetPost(ctx context.Context, rawID string) (*Post, error) {
	id, err := ParseID(rawID)
	if err != nil {
		return nil, err
	}
	p, err := s.repo.FindPostByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, NewNotFoundError("not found")
	}
	return p, nil
}

// LikePost → POST /api/posts/{id}/like (204; 404 when the post is missing).
func (s *FeedService) LikePost(ctx context.Context, actingUser int64, rawID string) error {
	id, err := ParseID(rawID)
	if err != nil {
		return err
	}
	p, err := s.repo.FindPostByID(ctx, id)
	if err != nil {
		return err
	}
	if p == nil {
		return NewNotFoundError("not found")
	}
	return s.repo.Like(ctx, actingUser, id)
}

// CreatePost → POST /api/posts (201 with the created post).
func (s *FeedService) CreatePost(ctx context.Context, actingUser int64, rawContent string) (Post, error) {
	content, err := ValidateContent(rawContent)
	if err != nil {
		return Post{}, err
	}
	return s.repo.CreatePost(ctx, actingUser, content)
}