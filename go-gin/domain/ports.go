package domain

import "context"

// FeedRepository is the data-access port the domain needs fulfilled.
//
// Implementations: adapters/postgres.go (the benchmark PostgreSQL adapter).
// A second implementation (SQLite — the video's follow-up experiment) can be
// dropped in without touching workflows.
type FeedRepository interface {
	// FindByUserID: SELECT id, username, display_name FROM users WHERE id = $1
	FindByUserID(ctx context.Context, id int64) (*User, error)

	// Feed: the 20 newest posts with author + like count,
	// ORDER BY posted_at DESC, id DESC LIMIT 20.
	Feed(ctx context.Context) ([]Post, error)

	// FindPostByID: single post with author + like count.
	FindPostByID(ctx context.Context, id int64) (*Post, error)

	// Like: idempotent like — INSERT INTO likes ... ON CONFLICT DO NOTHING.
	Like(ctx context.Context, userID, postID int64) error

	// CreatePost: INSERT INTO posts ... RETURNING id, posted_at; author snapshot.
	CreatePost(ctx context.Context, userID int64, content string) (Post, error)
}