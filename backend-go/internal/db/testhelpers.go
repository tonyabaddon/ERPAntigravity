package db

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/joho/godotenv"
)

// NewTestClient returns a *Client connected to the database identified by
// SUPABASE_DB_CONNECTION. It is the standard helper for integration tests in
// internal/db. If the env var is missing the test is skipped — tests should
// not be a noisy failure when run on a workstation without the connection
// string exported.
//
// The helper walks up the directory tree looking for a .env file (so that
// running `go test ./internal/db/...` from the repository root or from
// backend-go/ both work without extra setup).
func NewTestClient(t testing.TB) *Client {
	t.Helper()

	conn := os.Getenv("SUPABASE_DB_CONNECTION")
	if conn == "" {
		if path, ok := findEnvFile(); ok {
			_ = godotenv.Load(path)
			conn = os.Getenv("SUPABASE_DB_CONNECTION")
		}
	}
	if conn == "" {
		t.Skip("SUPABASE_DB_CONNECTION not set; skipping integration test")
	}

	client, err := NewClientWithoutListener(conn)
	if err != nil {
		t.Fatalf("connect to test DB: %v", err)
	}
	return client
}

// findEnvFile walks up from the current working directory looking for the
// nearest .env file. Returns the absolute path and true if found.
func findEnvFile() (string, bool) {
	dir, err := os.Getwd()
	if err != nil {
		return "", false
	}
	for {
		candidate := filepath.Join(dir, ".env")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}
