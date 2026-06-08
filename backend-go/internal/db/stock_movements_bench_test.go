package db_test

import (
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

// BenchmarkLogStockMovement establishes a baseline for the per-call overhead
// of the _log_stock_movement helper RPC. Each iteration is a single round-trip
// to Supabase invoking the SECURITY DEFINER function with a zero-delta row.
//
// Acceptance target: ≤ 5 ms p95 in-DB. Because this benchmark hits a remote
// Supabase instance, the reported ns/op is dominated by network RTT — the
// goal here is to capture a baseline number, not to optimize.
//
// Skips silently when SUPABASE_DB_CONNECTION is unset (see NewTestClient).
func BenchmarkLogStockMovement(b *testing.B) {
	client := db.NewTestClient(b)
	defer client.Close()
	db.EnsureSKUStock(b, client, "TEST-IMM", "atas", 1_000_000)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := client.DB.Exec(
			`SELECT public._log_stock_movement(
			   p_sku=>'TEST-IMM', p_warehouse=>'atas', p_qty_delta=>0,
			   p_qty_before=>0, p_source=>'adjustment'::public.stock_movement_source,
			   p_actor_user_id=>'00000000-0000-0000-0000-000000000001'::uuid,
			   p_actor_role=>'bench')`)
		if err != nil {
			b.Fatal(err)
		}
	}
}
