// Unit tests for domain/workflows using a fake in-memory FeedRepository.
package tests

import (
	"context"
	"errors"
	"testing"
	"time"

	"backend-go/domain"
)

type fakeRepo struct {
	user  *domain.User
	posts map[int64]*domain.Post
	likes int
}

func newFakeRepo() *fakeRepo {
	alice := &domain.User{ID: 1, Username: "user_000001", DisplayName: "Alice"}
	p := &domain.Post{
		ID: 10, UserID: 1, Username: "user_000001", DisplayName: "Alice",
		Content: "hello hexagon", PostedAt: time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC),
		LikeCount: 2,
	}
	return &fakeRepo{user: alice, posts: map[int64]*domain.Post{10: p}}
}

func (f *fakeRepo) FindByUserID(_ context.Context, id int64) (*domain.User, error) {
	if id == f.user.ID {
		return f.user, nil
	}
	return nil, nil
}
func (f *fakeRepo) Feed(_ context.Context) ([]domain.Post, error) {
	posts := make([]domain.Post, 0, len(f.posts))
	for _, p := range f.posts {
		posts = append(posts, *p)
	}
	return posts, nil
}
func (f *fakeRepo) FindPostByID(_ context.Context, id int64) (*domain.Post, error) {
	if p, ok := f.posts[id]; ok {
		return p, nil
	}
	return nil, nil
}
func (f *fakeRepo) Like(_ context.Context, _, _ int64) error { f.likes++; return nil }
func (f *fakeRepo) CreatePost(_ context.Context, userID int64, content string) (domain.Post, error) {
	p := domain.Post{ID: 99, UserID: userID, Username: f.user.Username,
		DisplayName: f.user.DisplayName, Content: content,
		PostedAt: time.Now().UTC(), LikeCount: 0}
	f.posts[99] = &p
	return p, nil
}

func mustNoErr(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// Assert the error is exactly a BadRequestError (400 at the HTTP boundary),
// so a swapped error type can never silently pass.
func expectBadRequest(t *testing.T, err error) {
	t.Helper()
	var bad *domain.BadRequestError
	if !errors.As(err, &bad) {
		t.Fatalf("expected BadRequestError, got %T: %v", err, err)
	}
}

// Assert the error is exactly a NotFoundError (404 at the HTTP boundary).
func expectNotFound(t *testing.T, err error) {
	t.Helper()
	var nf *domain.NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("expected NotFoundError, got %T: %v", err, err)
	}
}

func TestParseIDRejectsInvalid(t *testing.T) {
	_, err := domain.ParseID("abc")
	expectBadRequest(t, err)
	_, err = domain.ParseID("0")
	expectBadRequest(t, err)
	_, err = domain.ParseID("-1")
	expectBadRequest(t, err)
	if _, err := domain.ParseID("7"); err != nil {
		t.Fatalf("7 should parse: %v", err)
	}
}

func TestValidateContent(t *testing.T) {
	if _, err := domain.ValidateContent("  "); err == nil {
		t.Fatal("expected error for blank content")
	}
	c, err := domain.ValidateContent("  hi  ")
	mustNoErr(t, err)
	if c != "hi" {
		t.Fatalf("expected trimmed content, got %q", c)
	}
}

func TestGetMeUnknownUser(t *testing.T) {
	svc := domain.NewFeedService(newFakeRepo())
	_, err := svc.GetMe(context.Background(), 999)
	expectNotFound(t, err)
	u, err := svc.GetMe(context.Background(), 1)
	mustNoErr(t, err)
	if u.Username != "user_000001" {
		t.Fatalf("wrong user: %+v", u)
	}
}

func TestGetPostErrors(t *testing.T) {
	svc := domain.NewFeedService(newFakeRepo())
	_, err := svc.GetPost(context.Background(), "nope")
	expectBadRequest(t, err)
	_, err = svc.GetPost(context.Background(), "999")
	expectNotFound(t, err)
	p, err := svc.GetPost(context.Background(), "10")
	mustNoErr(t, err)
	if p.ID != 10 {
		t.Fatalf("wrong post: %d", p.ID)
	}
}

func TestLikePostUnknown(t *testing.T) {
	svc := domain.NewFeedService(newFakeRepo())
	err := svc.LikePost(context.Background(), 1, "999")
	expectNotFound(t, err)
	mustNoErr(t, svc.LikePost(context.Background(), 1, "10"))
}

func TestCreatePostBlank(t *testing.T) {
	svc := domain.NewFeedService(newFakeRepo())
	_, err := svc.CreatePost(context.Background(), 1, "   ")
	expectBadRequest(t, err)
	p, err := svc.CreatePost(context.Background(), 1, "  first post ")
	mustNoErr(t, err)
	if p.Content != "first post" || p.LikeCount != 0 {
		t.Fatalf("wrong post: %+v", p)
	}
}