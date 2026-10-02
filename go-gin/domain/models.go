// Package domain holds pure application logic: models, errors, ports and the
// FeedService workflows. No stdlib net/http or database imports — adapters
// implement its ports.
package domain

import "time"

// User is an author/acting user (the bearer token carries the numeric id).
type User struct {
	ID          int64  `json:"-"`
	Username    string `json:"-"`
	DisplayName string `json:"-"`
}

// Post is a feed item with an author snapshot and a like count.
type Post struct {
	ID         int64
	UserID     int64
	Username   string
	DisplayName string
	Content    string
	PostedAt   time.Time // UTC
	LikeCount  int64
}