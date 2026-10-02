package adapters

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"backend-go/domain"
)

// Unit tests for the Postgres adapter's error mapping — no live DB required.
// The FK-violation → NotFound mapping is a repo-wide contract-parity decision
// (SQLSTATE 23503 on like/create → 404, not 500).

func TestNormalizeErrMapsForeignKeyViolationToNotFound(t *testing.T) {
	err := normalizeErr(&pgconn.PgError{Code: "23503"})
	if err == nil {
		t.Fatal("normalizeErr returned nil for a FK violation")
	}
	var nf *domain.NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("expected *domain.NotFoundError, got %T: %v", err, err)
	}
}

func TestNormalizeErrPassesThroughOtherErrors(t *testing.T) {
	cases := []error{
		nil,
		errors.New("boom"),
		&pgconn.PgError{Code: "23505"}, // unique violation: not a FK, must pass through
	}
	for _, in := range cases {
		out := normalizeErr(in)
		if in == nil && out != nil {
			t.Fatalf("nil in, got %v out", out)
		}
		if in != nil && out != in {
			t.Fatalf("expected original error passthrough for %v, got %v", in, out)
		}
	}
}