// Package adapters implements the domain ports (driving = HTTP, driven = Postgres).
package adapters

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"backend-go/domain"
)

// PostgresFeedRepository implements domain.FeedRepository with raw pgx SQL.
type PostgresFeedRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresFeedRepository creates the concrete repository with a pool whose
// max connections equals the experiment's hard limit (POOL_SIZE, default 10).
func NewPostgresFeedRepository(ctx context.Context, connectionURI string, poolSize int32) (*PostgresFeedRepository, error) {
	cfg, err := pgxpool.ParseConfig(connectionURI)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = poolSize
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return &PostgresFeedRepository{pool: pool}, nil
}

// Close releases the pool (LifetimePort hook — called by composition root).
func (r *PostgresFeedRepository) Close() { r.pool.Close() }

func (r *PostgresFeedRepository) FindByUserID(ctx context.Context, id int64) (*domain.User, error) {
	row := r.pool.QueryRow(ctx,
		"SELECT id, username, display_name FROM users WHERE id = $1", id)
	var u domain.User
	err := row.Scan(&u.ID, &u.Username, &u.DisplayName)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

const postSelect = `
	SELECT p.id, p.user_id, u.username, u.display_name, p.content, p.posted_at,
	       (SELECT count(*) FROM likes l WHERE l.post_id = p.id) AS like_count
	FROM posts p
	JOIN users u ON u.id = p.user_id`

func (r *PostgresFeedRepository) Feed(ctx context.Context) ([]domain.Post, error) {
	rows, err := r.pool.Query(ctx, postSelect+" ORDER BY p.posted_at DESC, p.id DESC LIMIT 20")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPosts(rows)
}

func (r *PostgresFeedRepository) FindPostByID(ctx context.Context, id int64) (*domain.Post, error) {
	rows, err := r.pool.Query(ctx, postSelect+" WHERE p.id = $1", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	posts, err := scanPosts(rows)
	if err != nil {
		return nil, err
	}
	if len(posts) == 0 {
		return nil, nil
	}
	return &posts[0], nil
}

func (r *PostgresFeedRepository) Like(ctx context.Context, userID, postID int64) error {
	_, err := r.pool.Exec(ctx,
		"INSERT INTO likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
		userID, postID)
	return err
}

func (r *PostgresFeedRepository) CreatePost(ctx context.Context, userID int64, content string) (domain.Post, error) {
	var p domain.Post
	err := r.pool.QueryRow(ctx,
		"INSERT INTO posts (user_id, content) VALUES ($1, $2) RETURNING id, user_id, content, posted_at",
		userID, content).Scan(&p.ID, &p.UserID, &p.Content, &p.PostedAt)
	if err != nil {
		return domain.Post{}, err
	}
	author, err := r.FindByUserID(ctx, userID)
	if err != nil {
		return domain.Post{}, err
	}
	p.Username = author.Username
	p.DisplayName = author.DisplayName
	p.LikeCount = 0
	return p, nil
}

// scanPosts maps raw rows → domain models.
func scanPosts(rows pgx.Rows) ([]domain.Post, error) {
	defer rows.Close()
	var posts []domain.Post
	for rows.Next() {
		var p domain.Post
		if err := rows.Scan(&p.ID, &p.UserID, &p.Username, &p.DisplayName,
			&p.Content, &p.PostedAt, &p.LikeCount); err != nil {
			return nil, err
		}
		posts = append(posts, p)
	}
	return posts, rows.Err()
}