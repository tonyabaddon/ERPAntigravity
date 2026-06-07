package db_test

import (
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// TestStockMovements_TableExists is the foundation test for Phase 1: the
// immutable stock_movements ledger must exist in the public schema after
// migration 20260607000001_stock_movements.sql is applied.
func TestStockMovements_TableExists(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	var n int
	err := client.DB.QueryRow(
		`SELECT 1 FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_name = 'stock_movements'`).Scan(&n)
	if err != nil {
		t.Fatalf("stock_movements table missing: %v", err)
	}
	if n != 1 {
		t.Fatalf("expected scan to yield 1, got %d", n)
	}
}
