# Stock Fraud Phase 4 — Owner Anomaly Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Owner a detective-control surface that catches fraud patterns preventive gates (Phase 2/3) cannot. Five read-only SQL views over the existing Phase 1-3 tables, a Dashboard "Pengawasan" section gated by `can_view_pengawasan`, a heatmap drilldown modal, notification-settings toggles, and a daily WhatsApp summary fired by the existing Go heartbeat poller at a configurable WIB hour. Zero new fact tables; zero ETL.

**Architecture:** Five `CREATE OR REPLACE VIEW` statements compute z-score risk and aggregates entirely in SQL — frontend just maps `risk_z` to a `Rendah/Sedang/Tinggi` pill. `notification_config` (the existing single-row heartbeat config table — spec calls it `heartbeat_config` colloquially) gains two columns: `pengawasan_report_enabled BOOLEAN` and `pengawasan_report_hour INT`. Owner WA recipient is read from the existing `wa_recipients` table (`role='owner' AND is_active=true`), reusing the heartbeat poller's pattern — no new column added to `company_settings`. The Go heartbeat poller's existing 1-min tick is extended with a `pengawasanTick` branch — a once-per-day fire guarded by an in-memory `lastPengawasanFiredDate` so the report sends exactly once per WIB calendar day at the configured hour. (Alternative considered: a separate daily goroutine. Extending the existing tick is simpler — one ticker, one state machine, one test surface — and chosen here.)

**Tech Stack:** Postgres 15 (Supabase) views with window functions for z-score; Go 1.25 extending `internal/heartbeat/poller.go`; React/TypeScript extending `DashboardScreen.tsx` + `NotificationSettingsScreen.tsx` + one new `PengawasanDrilldownModal.tsx`; TDD via Go integration tests against a real Supabase test database for views + poller, minimal Vitest/React-Testing-Library tests for the permission-gating logic.

**Spec:** `docs/superpowers/specs/2026-06-07-stock-fraud-prevention-design.md` (Phase 4 section)

**Depends on:** Phase 1 (`stock_movements`), Phase 2 (`stock_adjustments`, `stock_opname_sessions`, `action_permissions`, `can_view_pengawasan`), Phase 3b (`kasir_transactions.status` + `cashier_user_id` + `kasir_price_override_requests` + `kasir_returns`), Phase 3d (`warehouse_transfers`). These plans must ship before Phase 4 is run end-to-end, though the views and migrations can be authored against the spec's schema in parallel.

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260607000050_pengawasan_views.sql` | Create | Five `v_pengawasan_*` views with z-score in SQL |
| `supabase/migrations/20260607000051_notification_config_pengawasan.sql` | Create | Add `pengawasan_report_enabled` + `pengawasan_report_hour` to `notification_config` |
| `backend-go/internal/db/heartbeat.go` | Modify | Extend `HeartbeatConfig` struct + `GetHeartbeatConfig` to read new columns + new `GetOwnerWANumbers` (reads from `wa_recipients`) |
| `backend-go/internal/db/pengawasan.go` | Create | View readers used by poller and tests |
| `backend-go/internal/db/pengawasan_test.go` | Create | Integration tests for the five views |
| `backend-go/internal/heartbeat/poller.go` | Modify | Add `pengawasanTick`, daily-fire guard, payload builder |
| `backend-go/internal/heartbeat/poller_test.go` | Modify | Tests for once-per-day firing + report formatting |
| `src/types.ts` | Modify | Ensure `ActionPermissionSet.can_view_pengawasan` is present (likely added in Phase 2 — verify, add if missing) |
| `src/components/DashboardScreen.tsx` | Modify | Owner-only "Pengawasan" section + period filter + heatmap |
| `src/components/PengawasanDrilldownModal.tsx` | Create | Drilldown for a single actor's 30d activity |
| `src/components/NotificationSettingsScreen.tsx` | Modify | Toggles for `pengawasan_report_enabled` + per-section sub-toggles |
| `src/components/__tests__/DashboardScreen.pengawasan.test.tsx` | Create | Permission-gating tests |
| `progress.md` | Modify | Phase 4 DONE entry |

**Migration numbering note:** Phase 1 used `…001-005`, Phase 2 used `…006-013`, Phase 3 used `…014-049` (reserved). Phase 4 starts at `…050` per task brief to leave headroom for late Phase 3 additions.

---

## Task 1: Top Adjustments view

**Files:**
- Create: `supabase/migrations/20260607000050_pengawasan_views.sql`
- Create: `backend-go/internal/db/pengawasan_test.go`

- [ ] **Step 1: Write failing test for `v_pengawasan_top_adjustments`**

`backend-go/internal/db/pengawasan_test.go`:
```go
package db_test

import (
	"context"
	"testing"

	"github.com/username/sinar-elektrik-backend/internal/db"
)

func TestPengawasanView_TopAdjustments_OrdersByValueDesc(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Seed: two committed adjustments — one big (qty 10 × hpp 5000), one small (qty 1 × hpp 100).
	db.SeedStockWithHPP(t, client, "TEST-A", 5000)
	db.SeedStockWithHPP(t, client, "TEST-B", 100)
	db.SeedCommittedAdjustment(t, client, "TEST-A", "atas", -10, "rusak")
	db.SeedCommittedAdjustment(t, client, "TEST-B", "atas", -1, "rusak")

	rows, err := client.DB.Query(`
		SELECT sku, value_rp
		FROM public.v_pengawasan_top_adjustments
		WHERE sku IN ('TEST-A','TEST-B')
		ORDER BY value_rp DESC`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()

	var got []struct {
		SKU  string
		Val  float64
	}
	for rows.Next() {
		var r struct {
			SKU string
			Val float64
		}
		if err := rows.Scan(&r.SKU, &r.Val); err != nil {
			t.Fatalf("scan: %v", err)
		}
		got = append(got, r)
	}
	if len(got) != 2 || got[0].SKU != "TEST-A" || got[1].SKU != "TEST-B" {
		t.Fatalf("expected TEST-A first then TEST-B, got %+v", got)
	}
	if got[0].Val != 50000 || got[1].Val != 100 {
		t.Fatalf("expected values 50000 and 100, got %v %v", got[0].Val, got[1].Val)
	}
	_ = context.Background()
}
```

(Add `SeedStockWithHPP` and `SeedCommittedAdjustment` to `backend-go/internal/db/testhelpers.go` reusing the Phase 1 helpers. `SeedCommittedAdjustment` inserts both the `stock_adjustments` row with `committed_at = now()` and a paired `stock_movements` row.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestPengawasanView_TopAdjustments -v`
Expected: FAIL — `relation "v_pengawasan_top_adjustments" does not exist`.

- [ ] **Step 3: Create the migration with the first view**

`supabase/migrations/20260607000050_pengawasan_views.sql`:
```sql
-- =====================================================================
-- Phase 4 — Pengawasan views. Read-only, computed from existing tables.
-- =====================================================================

-- View 1: Top committed stock adjustments ranked by absolute rupiah value.
CREATE OR REPLACE VIEW public.v_pengawasan_top_adjustments AS
SELECT
  sa.id,
  sa.sku,
  s.name                                       AS sku_name,
  sa.warehouse,
  sa.qty_delta,
  sa.reason_code,
  sa.reason_note,
  sa.evidence_urls,
  ABS(sa.qty_delta) * COALESCE(s.harga_modal, 0)::numeric AS value_rp,
  sa.requested_by,
  au.name                                      AS actor_name,
  sa.requested_at,
  sa.committed_at,
  sa.status
FROM public.stock_adjustments sa
JOIN public.stocks s          ON s.sku = sa.sku
LEFT JOIN public.admin_users au ON au.id = sa.requested_by
WHERE sa.committed_at IS NOT NULL;

GRANT SELECT ON public.v_pengawasan_top_adjustments TO authenticated;
```

- [ ] **Step 4: Apply migration & re-run test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestPengawasanView_TopAdjustments -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000050_pengawasan_views.sql backend-go/internal/db/pengawasan_test.go backend-go/internal/db/testhelpers.go
git commit -m "feat(pengawasan): add v_pengawasan_top_adjustments view"
```

---

## Task 2: Kasir discount 7d view

**Files:**
- Modify: `supabase/migrations/20260607000050_pengawasan_views.sql`
- Modify: `backend-go/internal/db/pengawasan_test.go`

- [ ] **Step 1: Write failing test**

Append to `backend-go/internal/db/pengawasan_test.go`:
```go
func TestPengawasanView_KasirDiscount7d_AggregatesPerCashier(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	cashier := db.SeedAdminUser(t, client, "Test Kasir", "Staff Admin Toko")
	db.SeedStockWithPrice(t, client, "TEST-K", 10000) // stocks.price = 10000

	// Two committed kasir transactions: one sold at 10000 (no discount), one at 7000 (3000 discount).
	db.SeedKasirTx(t, client, cashier.ID, "TEST-K", 1, 10000)
	db.SeedKasirTx(t, client, cashier.ID, "TEST-K", 2, 7000)
	// Revenue = 10000 + 2*7000 = 24000. Discount = 0 + 2*(10000-7000) = 6000. Pct = 6000/24000 = 0.25.

	var disc, rev, pct float64
	err := client.DB.QueryRow(`
		SELECT total_discount_rp, total_revenue_rp, discount_pct_of_revenue
		FROM public.v_pengawasan_kasir_discount_7d
		WHERE cashier_user_id = $1`, cashier.ID).Scan(&disc, &rev, &pct)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if disc != 6000 || rev != 24000 {
		t.Fatalf("got disc=%v rev=%v want 6000 24000", disc, rev)
	}
	if pct < 0.249 || pct > 0.251 {
		t.Fatalf("got pct=%v want ~0.25", pct)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestPengawasanView_KasirDiscount7d -v`
Expected: FAIL — view does not exist.

- [ ] **Step 3: Append the view to the migration**

Append to `supabase/migrations/20260607000050_pengawasan_views.sql`:
```sql
-- View 2: Per-cashier discount totals over the last 7 days.
-- "Discount" = stocks.price (the listed default) minus the line's unit_price,
-- summed across committed kasir transactions. Captures both pre-Phase-3b free-form
-- price entry and Phase-3b approved overrides — both leak margin if abused.
CREATE OR REPLACE VIEW public.v_pengawasan_kasir_discount_7d AS
SELECT
  kt.cashier_user_id,
  au.name                                            AS cashier_name,
  SUM((s.price - kti.unit_price) * kti.qty)::numeric AS total_discount_rp,
  SUM(kti.unit_price * kti.qty)::numeric             AS total_revenue_rp,
  CASE
    WHEN SUM(kti.unit_price * kti.qty) > 0
      THEN SUM((s.price - kti.unit_price) * kti.qty)::numeric
           / SUM(kti.unit_price * kti.qty)::numeric
    ELSE 0
  END                                                AS discount_pct_of_revenue
FROM public.kasir_transactions kt
JOIN LATERAL jsonb_to_recordset(kt.items)
     AS kti(sku TEXT, unit_price NUMERIC, qty INT) ON TRUE
JOIN public.stocks s              ON s.sku = kti.sku
LEFT JOIN public.admin_users au   ON au.id = kt.cashier_user_id
WHERE kt.created_at >= now() - INTERVAL '7 days'
  AND kt.status     = 'committed'
GROUP BY kt.cashier_user_id, au.name;

GRANT SELECT ON public.v_pengawasan_kasir_discount_7d TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestPengawasanView_KasirDiscount7d -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000050_pengawasan_views.sql backend-go/internal/db/pengawasan_test.go
git commit -m "feat(pengawasan): add v_pengawasan_kasir_discount_7d view"
```

---

## Task 3: Outflow outliers view

**Files:**
- Modify: `supabase/migrations/20260607000050_pengawasan_views.sql`
- Modify: `backend-go/internal/db/pengawasan_test.go`

- [ ] **Step 1: Write failing test**

```go
func TestPengawasanView_OutflowOutliers_FlagsAbove3xAvg(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.SeedStockWithHPP(t, client, "TEST-OUT", 1000)
	// 90-day baseline: 90 movements of -1 each over the prior 80 days
	// (avg daily ≈ 1.0, expected weekly = 7.0).
	db.SeedHistoricalMovements(t, client, "TEST-OUT", "atas",
		/*perDayQty=*/ -1, /*startDaysAgo=*/ 80, /*days=*/ 80)
	// Last 7 days: -50 today → multiplier ≈ 7.1.
	db.SeedMovementToday(t, client, "TEST-OUT", "atas", -50)

	var mult float64
	err := client.DB.QueryRow(`
		SELECT multiplier
		FROM public.v_pengawasan_outflow_outliers
		WHERE sku = 'TEST-OUT'`).Scan(&mult)
	if err != nil {
		t.Fatalf("query: %v — expected TEST-OUT to surface as outlier", err)
	}
	if mult < 3 {
		t.Fatalf("multiplier=%v want > 3", mult)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestPengawasanView_OutflowOutliers -v`
Expected: FAIL — view does not exist.

- [ ] **Step 3: Append the view**

Append to `supabase/migrations/20260607000050_pengawasan_views.sql`:
```sql
-- View 3: SKUs whose last-7-day outflow exceeds 3× their 90-day daily average × 7.
CREATE OR REPLACE VIEW public.v_pengawasan_outflow_outliers AS
WITH outflow_7 AS (
  SELECT sku, SUM(ABS(qty_delta))::numeric AS sum_7d
  FROM public.stock_movements
  WHERE qty_delta < 0
    AND created_at >= now() - INTERVAL '7 days'
  GROUP BY sku
),
avg_90 AS (
  SELECT sku, SUM(ABS(qty_delta))::numeric / 90.0 AS avg_daily_90d
  FROM public.stock_movements
  WHERE qty_delta < 0
    AND created_at >= now() - INTERVAL '90 days'
  GROUP BY sku
)
SELECT
  o.sku,
  s.name,
  o.sum_7d,
  a.avg_daily_90d,
  o.sum_7d / NULLIF(a.avg_daily_90d * 7, 0) AS multiplier
FROM outflow_7 o
JOIN avg_90 a USING (sku)
JOIN public.stocks s ON s.sku = o.sku
WHERE o.sum_7d > 3 * a.avg_daily_90d * 7;

GRANT SELECT ON public.v_pengawasan_outflow_outliers TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestPengawasanView_OutflowOutliers -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000050_pengawasan_views.sql backend-go/internal/db/pengawasan_test.go backend-go/internal/db/testhelpers.go
git commit -m "feat(pengawasan): add v_pengawasan_outflow_outliers view"
```

---

## Task 4: Transfer aging view

**Files:**
- Modify: `supabase/migrations/20260607000050_pengawasan_views.sql`
- Modify: `backend-go/internal/db/pengawasan_test.go`

- [ ] **Step 1: Write failing test**

```go
func TestPengawasanView_TransferAging_ShowsOnlyOver24h(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	db.SeedStockWithHPP(t, client, "TEST-T", 1000)
	old := db.SeedInitiatedTransfer(t, client, "TEST-T", "atas", "bawah", 3, /*ageHours=*/ 30)
	_ = db.SeedInitiatedTransfer(t, client, "TEST-T", "atas", "bawah", 3, /*ageHours=*/ 1)

	rows, err := client.DB.Query(`
		SELECT id, hours_pending
		FROM public.v_pengawasan_transfer_aging
		WHERE sku = 'TEST-T'`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()

	count := 0
	var foundID int64
	var hours float64
	for rows.Next() {
		count++
		if err := rows.Scan(&foundID, &hours); err != nil {
			t.Fatalf("scan: %v", err)
		}
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 aged transfer, got %d", count)
	}
	if foundID != old {
		t.Fatalf("expected aged transfer id=%d, got %d", old, foundID)
	}
	if hours < 24 {
		t.Fatalf("hours_pending=%v want >= 24", hours)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — view does not exist.

- [ ] **Step 3: Append the view**

Append to `supabase/migrations/20260607000050_pengawasan_views.sql`:
```sql
-- View 4: Transfers initiated > 24 h ago that the receiver has not closed.
-- Surfaces the "transfer sat in transit, never confirmed" risk.
CREATE OR REPLACE VIEW public.v_pengawasan_transfer_aging AS
SELECT
  wt.id,
  wt.sku,
  s.name AS sku_name,
  wt.from_warehouse,
  wt.to_warehouse,
  wt.initiated_qty,
  wt.initiated_by_user_id,
  au_init.name AS initiated_by_name,
  wt.intended_receiver_user_id,
  au_recv.name AS intended_receiver_name,
  wt.initiated_at,
  EXTRACT(EPOCH FROM (now() - wt.initiated_at)) / 3600.0 AS hours_pending
FROM public.warehouse_transfers wt
JOIN public.stocks s             ON s.sku = wt.sku
LEFT JOIN public.admin_users au_init ON au_init.id = wt.initiated_by_user_id
LEFT JOIN public.admin_users au_recv ON au_recv.id = wt.intended_receiver_user_id
WHERE wt.status = 'initiated'
  AND wt.initiated_at < now() - INTERVAL '24 hours';

GRANT SELECT ON public.v_pengawasan_transfer_aging TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestPengawasanView_TransferAging -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000050_pengawasan_views.sql backend-go/internal/db/pengawasan_test.go backend-go/internal/db/testhelpers.go
git commit -m "feat(pengawasan): add v_pengawasan_transfer_aging view"
```

---

## Task 5: Actor activity heatmap with z-score risk

**Files:**
- Modify: `supabase/migrations/20260607000050_pengawasan_views.sql`
- Modify: `backend-go/internal/db/pengawasan_test.go`

The z-score must be computed in SQL so the frontend just maps it to a pill. Cutoffs: `risk_z ≤ 0.5` → `Rendah`, `0.5 < risk_z ≤ 1.5` → `Sedang`, `risk_z > 1.5` → `Tinggi`. The frontend only consumes `risk_z`; the pill mapping lives in TS.

- [ ] **Step 1: Write failing tests**

```go
func TestPengawasanView_ActorActivity_ComputesZScore(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Three actors with very different recent activity so stddev is non-zero.
	low := db.SeedAdminUser(t, client, "Low Actor", "Staff Admin Toko")
	mid := db.SeedAdminUser(t, client, "Mid Actor", "Staff Admin Toko")
	hi := db.SeedAdminUser(t, client, "Hi Actor", "Staff Admin Toko")

	// Counts within last 30 days:
	// low: 1 adjustment, 0 override, 0 refund → total 1
	// mid: 5 adjustment, 0 override, 0 refund → total 5
	// hi : 20 adjustment, 5 override, 5 refund → total 30
	db.SeedAdjustmentsForActor(t, client, low.ID, 1)
	db.SeedAdjustmentsForActor(t, client, mid.ID, 5)
	db.SeedAdjustmentsForActor(t, client, hi.ID, 20)
	db.SeedOverridesForActor(t, client, hi.ID, 5)
	db.SeedRefundsForActor(t, client, hi.ID, 5)

	rows, err := client.DB.Query(`
		SELECT id, adjust_count, override_count, refund_count, total_activity, risk_z
		FROM public.v_pengawasan_actor_activity_30d
		WHERE id IN ($1,$2,$3)
		ORDER BY total_activity DESC`, hi.ID, mid.ID, low.ID)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()

	type row struct {
		ID    string
		Adj   int
		Ovr   int
		Ref   int
		Total int
		Z     float64
	}
	var out []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.ID, &r.Adj, &r.Ovr, &r.Ref, &r.Total, &r.Z); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, r)
	}
	if len(out) != 3 {
		t.Fatalf("expected 3 rows, got %d", len(out))
	}
	if out[0].Total != 30 || out[1].Total != 5 || out[2].Total != 1 {
		t.Fatalf("totals wrong: %+v", out)
	}
	// Hi actor must show z > 1, low actor must show z < 0.
	if out[0].Z <= 1.0 {
		t.Fatalf("hi actor z=%v want > 1.0", out[0].Z)
	}
	if out[2].Z >= 0 {
		t.Fatalf("low actor z=%v want < 0", out[2].Z)
	}
}

func TestPengawasanView_ActorActivity_NoDivByZeroOnUniformActivity(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Two actors with identical totals → stddev=0 → risk_z must be 0, not NaN/error.
	a := db.SeedAdminUser(t, client, "Uniform A", "Staff Admin Toko")
	b := db.SeedAdminUser(t, client, "Uniform B", "Staff Admin Toko")
	db.SeedAdjustmentsForActor(t, client, a.ID, 3)
	db.SeedAdjustmentsForActor(t, client, b.ID, 3)

	var zA float64
	err := client.DB.QueryRow(`
		SELECT risk_z FROM public.v_pengawasan_actor_activity_30d WHERE id=$1`, a.ID).
		Scan(&zA)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if zA != 0 {
		t.Fatalf("expected risk_z=0 for uniform activity, got %v", zA)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-go && go test ./internal/db/ -run TestPengawasanView_ActorActivity -v`
Expected: FAIL — view does not exist.

- [ ] **Step 3: Append the view**

Append to `supabase/migrations/20260607000050_pengawasan_views.sql`:
```sql
-- View 5: 30-day per-actor activity heatmap with SQL-computed z-score.
-- total_activity = adjust + override + refund (void/opname tracked separately
-- via own views; this is the headline number for the dashboard heatmap).
-- risk_z is the population z-score across all actors that appear in the view.
-- NULLIF on stddev prevents division-by-zero when all actors are equally active.
CREATE OR REPLACE VIEW public.v_pengawasan_actor_activity_30d AS
WITH per_actor AS (
  SELECT
    au.id,
    au.name,
    au.role,
    COUNT(DISTINCT sa.id)                    AS adjust_count,
    COUNT(DISTINCT kpo.id)                   AS override_count,
    COUNT(DISTINCT kr.id)                    AS refund_count,
    COUNT(DISTINCT sa.id)
      + COUNT(DISTINCT kpo.id)
      + COUNT(DISTINCT kr.id)                AS total_activity
  FROM public.admin_users au
  LEFT JOIN public.stock_adjustments sa
    ON sa.requested_by = au.id
   AND sa.requested_at >= now() - INTERVAL '30 days'
  LEFT JOIN public.kasir_price_override_requests kpo
    ON kpo.requested_by = au.id
   AND kpo.requested_at >= now() - INTERVAL '30 days'
  LEFT JOIN public.kasir_returns kr
    ON kr.requested_by = au.id
   AND kr.requested_at >= now() - INTERVAL '30 days'
  GROUP BY au.id, au.name, au.role
)
SELECT
  id,
  name,
  role,
  adjust_count,
  override_count,
  refund_count,
  total_activity,
  COALESCE(
    (total_activity - AVG(total_activity) OVER ())
    / NULLIF(STDDEV_POP(total_activity) OVER (), 0),
    0
  )::numeric AS risk_z
FROM per_actor;

GRANT SELECT ON public.v_pengawasan_actor_activity_30d TO authenticated;
```

- [ ] **Step 4: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/db/ -run TestPengawasanView_ActorActivity -v`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000050_pengawasan_views.sql backend-go/internal/db/pengawasan_test.go backend-go/internal/db/testhelpers.go
git commit -m "feat(pengawasan): add v_pengawasan_actor_activity_30d with SQL z-score risk"
```

---

## Task 6: Extend `notification_config` with pengawasan toggles

**Files:**
- Create: `supabase/migrations/20260607000051_notification_config_pengawasan.sql`
- Modify: `backend-go/internal/db/heartbeat.go`
- Modify: `backend-go/internal/heartbeat/poller_test.go`

The Phase 4 spec calls the table `heartbeat_config`; the real table is `notification_config` (added in `20260602000004_notification_config.sql`). No new table — just two columns.

- [ ] **Step 1: Write failing test reading the new fields**

Append to `backend-go/internal/heartbeat/poller_test.go`:
```go
func TestHeartbeatConfig_ReadsPengawasanFields(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	_, err := client.DB.Exec(`
		UPDATE notification_config
		   SET pengawasan_report_enabled = TRUE,
		       pengawasan_report_hour    = 19`)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	cfg, err := client.GetHeartbeatConfig()
	if err != nil {
		t.Fatalf("GetHeartbeatConfig: %v", err)
	}
	if cfg == nil {
		t.Fatal("nil cfg")
	}
	if !cfg.PengawasanReportEnabled {
		t.Fatal("PengawasanReportEnabled false, want true")
	}
	if cfg.PengawasanReportHour != 19 {
		t.Fatalf("PengawasanReportHour=%d want 19", cfg.PengawasanReportHour)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/heartbeat/ -run TestHeartbeatConfig_ReadsPengawasanFields -v`
Expected: FAIL — columns do not exist, struct does not have fields.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260607000051_notification_config_pengawasan.sql`:
```sql
-- Phase 4: add daily Pengawasan report toggles to notification_config.
-- (Spec uses the colloquial name "heartbeat_config" — the real table is
--  notification_config.)
ALTER TABLE public.notification_config
  ADD COLUMN IF NOT EXISTS pengawasan_report_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pengawasan_report_hour    INT     NOT NULL DEFAULT 18
    CHECK (pengawasan_report_hour BETWEEN 0 AND 23);
```

- [ ] **Step 4: Extend the Go struct + reader**

Modify `backend-go/internal/db/heartbeat.go`:
```go
type HeartbeatConfig struct {
	Enabled                 bool
	IntervalLabel           string
	ReportRevenue           bool
	ReportStatus            bool
	LowStockAlert           int
	PengawasanReportEnabled bool
	PengawasanReportHour    int
}

func (c *Client) GetHeartbeatConfig() (*HeartbeatConfig, error) {
	var cfg HeartbeatConfig
	err := c.DB.QueryRow(`
		SELECT enabled, interval_label, report_revenue, report_status, low_stock_alert,
		       pengawasan_report_enabled, pengawasan_report_hour
		FROM notification_config
		ORDER BY id DESC LIMIT 1
	`).Scan(
		&cfg.Enabled, &cfg.IntervalLabel, &cfg.ReportRevenue, &cfg.ReportStatus, &cfg.LowStockAlert,
		&cfg.PengawasanReportEnabled, &cfg.PengawasanReportHour,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &cfg, nil
}
```

- [ ] **Step 5: Apply & re-test**

Run: `supabase db push --include-all && cd backend-go && go test ./internal/heartbeat/ -run TestHeartbeatConfig_ReadsPengawasanFields -v`
Expected: PASS.

- [ ] **Step 6: Run existing heartbeat tests to confirm no regression**

Run: `cd backend-go && go test ./internal/heartbeat/ -v`
Expected: all existing tests still PASS (new SELECT columns are append-only — backward compatible).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260607000051_notification_config_pengawasan.sql backend-go/internal/db/heartbeat.go backend-go/internal/heartbeat/poller_test.go
git commit -m "feat(pengawasan): notification_config gains pengawasan_report_{enabled,hour}"
```

---

## Task 7: SKIPPED — Owner WA destination read from `wa_recipients` table

**Decision:** No new Owner-WA-destination column is added to `company_settings`. The Owner WhatsApp recipient(s) are read from the existing `wa_recipients` table (`role='owner' AND is_active=true`), which already powers the heartbeat poller's recipient iteration (`p.db.GetActiveRecipients()` in `backend-go/internal/heartbeat/poller.go`). The pengawasan daily report reuses that same source — see **Task 9** for the Go reader and send loop.

**Existing schema reference (already in DB, no migration needed):**
```sql
CREATE TABLE wa_recipients (
  id         serial PRIMARY KEY,
  role       text NOT NULL,   -- 'admin' or 'owner'
  name       text NOT NULL DEFAULT '',
  wa_number  text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

No migration, no Go reader, no commit for this task. Skip directly to Task 8.

---

## Task 8: View readers in Go (`pengawasan.go`)

**Files:**
- Create: `backend-go/internal/db/pengawasan.go`
- Modify: `backend-go/internal/db/pengawasan_test.go`

These readers feed the poller's payload builder in Task 9. Keep them small — each returns a slice of typed row structs.

- [ ] **Step 1: Write failing test**

Append to `backend-go/internal/db/pengawasan_test.go`:
```go
func TestPengawasanReaders_ReturnRows(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()

	// Use the seeds from prior tasks; verify the readers compile and return non-nil slices.
	if _, err := client.ListTopAdjustments(30); err != nil {
		t.Fatalf("ListTopAdjustments: %v", err)
	}
	if _, err := client.ListKasirDiscount7d(); err != nil {
		t.Fatalf("ListKasirDiscount7d: %v", err)
	}
	if _, err := client.ListOutflowOutliers(); err != nil {
		t.Fatalf("ListOutflowOutliers: %v", err)
	}
	if _, err := client.ListTransferAging(); err != nil {
		t.Fatalf("ListTransferAging: %v", err)
	}
	if _, err := client.ListActorActivity30d(); err != nil {
		t.Fatalf("ListActorActivity30d: %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-go && go test ./internal/db/ -run TestPengawasanReaders_ReturnRows -v`
Expected: FAIL — methods do not exist.

- [ ] **Step 3: Create the readers**

`backend-go/internal/db/pengawasan.go`:
```go
package db

type TopAdjustmentRow struct {
	ID         int64
	SKU        string
	SKUName    string
	Warehouse  string
	QtyDelta   int
	ReasonCode string
	ActorName  string
	ValueRp    float64
}

type KasirDiscountRow struct {
	CashierUserID         string
	CashierName           string
	TotalDiscountRp       float64
	TotalRevenueRp        float64
	DiscountPctOfRevenue  float64
}

type OutflowOutlierRow struct {
	SKU          string
	Name         string
	Sum7d        float64
	AvgDaily90d  float64
	Multiplier   float64
}

type TransferAgingRow struct {
	ID                   int64
	SKU                  string
	SKUName              string
	FromWarehouse        string
	ToWarehouse          string
	InitiatedQty         int
	InitiatedByName      string
	IntendedReceiverName string
	HoursPending         float64
}

type ActorActivityRow struct {
	ID            string
	Name          string
	Role          string
	AdjustCount   int
	OverrideCount int
	RefundCount   int
	TotalActivity int
	RiskZ         float64
}

// ListTopAdjustments returns top committed adjustments by value, limited.
func (c *Client) ListTopAdjustments(limit int) ([]TopAdjustmentRow, error) {
	rows, err := c.DB.Query(`
		SELECT id, sku, sku_name, warehouse, qty_delta, reason_code,
		       COALESCE(actor_name, '(unknown)'), value_rp
		FROM public.v_pengawasan_top_adjustments
		WHERE requested_at >= now() - INTERVAL '30 days'
		ORDER BY value_rp DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TopAdjustmentRow
	for rows.Next() {
		var r TopAdjustmentRow
		if err := rows.Scan(&r.ID, &r.SKU, &r.SKUName, &r.Warehouse, &r.QtyDelta,
			&r.ReasonCode, &r.ActorName, &r.ValueRp); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListKasirDiscount7d returns per-cashier discount totals for the last 7 days.
func (c *Client) ListKasirDiscount7d() ([]KasirDiscountRow, error) {
	rows, err := c.DB.Query(`
		SELECT cashier_user_id, COALESCE(cashier_name,'(unknown)'),
		       total_discount_rp, total_revenue_rp, discount_pct_of_revenue
		FROM public.v_pengawasan_kasir_discount_7d
		ORDER BY total_discount_rp DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []KasirDiscountRow
	for rows.Next() {
		var r KasirDiscountRow
		if err := rows.Scan(&r.CashierUserID, &r.CashierName, &r.TotalDiscountRp,
			&r.TotalRevenueRp, &r.DiscountPctOfRevenue); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListOutflowOutliers returns SKUs whose 7d outflow > 3× 90d daily avg × 7.
func (c *Client) ListOutflowOutliers() ([]OutflowOutlierRow, error) {
	rows, err := c.DB.Query(`
		SELECT sku, name, sum_7d, avg_daily_90d, multiplier
		FROM public.v_pengawasan_outflow_outliers
		ORDER BY multiplier DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OutflowOutlierRow
	for rows.Next() {
		var r OutflowOutlierRow
		if err := rows.Scan(&r.SKU, &r.Name, &r.Sum7d, &r.AvgDaily90d, &r.Multiplier); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListTransferAging returns initiated transfers older than 24 h.
func (c *Client) ListTransferAging() ([]TransferAgingRow, error) {
	rows, err := c.DB.Query(`
		SELECT id, sku, sku_name, from_warehouse, to_warehouse, initiated_qty,
		       COALESCE(initiated_by_name,'(unknown)'),
		       COALESCE(intended_receiver_name,'(unknown)'),
		       hours_pending
		FROM public.v_pengawasan_transfer_aging
		ORDER BY hours_pending DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TransferAgingRow
	for rows.Next() {
		var r TransferAgingRow
		if err := rows.Scan(&r.ID, &r.SKU, &r.SKUName, &r.FromWarehouse, &r.ToWarehouse,
			&r.InitiatedQty, &r.InitiatedByName, &r.IntendedReceiverName, &r.HoursPending); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListActorActivity30d returns the heatmap rows ordered by risk_z desc.
func (c *Client) ListActorActivity30d() ([]ActorActivityRow, error) {
	rows, err := c.DB.Query(`
		SELECT id::text, name, role, adjust_count, override_count, refund_count,
		       total_activity, risk_z
		FROM public.v_pengawasan_actor_activity_30d
		ORDER BY risk_z DESC, total_activity DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ActorActivityRow
	for rows.Next() {
		var r ActorActivityRow
		if err := rows.Scan(&r.ID, &r.Name, &r.Role, &r.AdjustCount, &r.OverrideCount,
			&r.RefundCount, &r.TotalActivity, &r.RiskZ); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
```

- [ ] **Step 4: Re-run test**

Run: `cd backend-go && go test ./internal/db/ -run TestPengawasanReaders_ReturnRows -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-go/internal/db/pengawasan.go backend-go/internal/db/pengawasan_test.go
git commit -m "feat(pengawasan): add Go readers for the five views"
```

---

## Task 9: Extend heartbeat poller with daily Pengawasan fire

**Files:**
- Modify: `backend-go/internal/heartbeat/poller.go`
- Modify: `backend-go/internal/heartbeat/poller_test.go`

Choice between two options, per the brief:
- **Option A (chosen):** Extend the existing 1-min tick — add `lastPengawasanFiredDate time.Time` to the `Poller` struct; in `tick`, after the regular report branch, check `cfg.PengawasanReportEnabled && now.Hour() == cfg.PengawasanReportHour && !p.lastPengawasanFiredDate.Equal(today)`; if so, build & send the report, then set `lastPengawasanFiredDate = today`. One ticker, one goroutine, idempotent within the day.
- **Option B (rejected):** A separate daily goroutine with its own timer. Adds a second lifecycle to test and reason about. The minute-granularity of Option A is plenty for a "fires somewhere inside hour H WIB" requirement.

- [ ] **Step 1: Write failing test for once-per-day firing**

Append to `backend-go/internal/heartbeat/poller_test.go`:
```go
func TestPoller_PengawasanFiresOncePerDay(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	_, err := client.DB.Exec(`
		UPDATE notification_config
		   SET enabled = FALSE,                  -- disable regular heartbeat noise
		       pengawasan_report_enabled = TRUE,
		       pengawasan_report_hour    = $1`,
		time.Now().In(time.FixedZone("WIB", 7*3600)).Hour())
	if err != nil {
		t.Fatalf("seed cfg: %v", err)
	}
	_, _ = client.DB.Exec(`INSERT INTO wa_recipients (role, wa_number, is_active) VALUES ('owner', '6281234567890', true)
	                       ON CONFLICT DO NOTHING`)

	sender := whatsapp.NewFakeSender()
	p := heartbeat.NewPoller(client, sender)

	p.TickForTest(context.Background()) // exposed test helper, calls p.tick
	if got := sender.CountSentTo("6281234567890@s.whatsapp.net"); got != 1 {
		t.Fatalf("first tick sends=%d want 1", got)
	}
	p.TickForTest(context.Background())
	if got := sender.CountSentTo("6281234567890@s.whatsapp.net"); got != 1 {
		t.Fatalf("second tick same day sends=%d want still 1", got)
	}
}

func TestPoller_PengawasanSkipsWhenHourMismatch(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	now := time.Now().In(time.FixedZone("WIB", 7*3600))
	misHour := (now.Hour() + 3) % 24
	_, err := client.DB.Exec(`
		UPDATE notification_config
		   SET enabled = FALSE,
		       pengawasan_report_enabled = TRUE,
		       pengawasan_report_hour    = $1`, misHour)
	if err != nil {
		t.Fatalf("seed cfg: %v", err)
	}
	_, _ = client.DB.Exec(`INSERT INTO wa_recipients (role, wa_number, is_active) VALUES ('owner', '6281234567890', true)
	                       ON CONFLICT DO NOTHING`)
	sender := whatsapp.NewFakeSender()
	p := heartbeat.NewPoller(client, sender)
	p.TickForTest(context.Background())
	if got := sender.CountSentTo("6281234567890@s.whatsapp.net"); got != 0 {
		t.Fatalf("mismatched hour sends=%d want 0", got)
	}
}

func TestPoller_PengawasanSkipsWhenDisabled(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	_, _ = client.DB.Exec(`
		UPDATE notification_config
		   SET enabled = FALSE,
		       pengawasan_report_enabled = FALSE`)
	_, _ = client.DB.Exec(`INSERT INTO wa_recipients (role, wa_number, is_active) VALUES ('owner', '6281234567890', true)
	                       ON CONFLICT DO NOTHING`)
	sender := whatsapp.NewFakeSender()
	p := heartbeat.NewPoller(client, sender)
	p.TickForTest(context.Background())
	if got := sender.CountSentTo("6281234567890@s.whatsapp.net"); got != 0 {
		t.Fatalf("disabled sends=%d want 0", got)
	}
}

func TestPoller_PengawasanSkipsWhenNoActiveOwnerRecipient(t *testing.T) {
	client := db.NewTestClient(t)
	defer client.Close()
	hour := time.Now().In(time.FixedZone("WIB", 7*3600)).Hour()
	_, _ = client.DB.Exec(`
		UPDATE notification_config
		   SET enabled = FALSE,
		       pengawasan_report_enabled = TRUE,
		       pengawasan_report_hour    = $1`, hour)
	// Ensure no active owner row exists (deactivate any pre-seeded owner rows).
	_, _ = client.DB.Exec(`UPDATE wa_recipients SET is_active=false WHERE role='owner'`)
	sender := whatsapp.NewFakeSender()
	p := heartbeat.NewPoller(client, sender)
	p.TickForTest(context.Background())
	if got := sender.TotalSent(); got != 0 {
		t.Fatalf("no active owner recipient but still sent: %d", got)
	}
}
```

(`whatsapp.NewFakeSender()` / `CountSentTo` are a tiny test double — add to `backend-go/internal/whatsapp/fake_sender.go` if not present; mirror the existing `Sender.SendText` signature. `p.TickForTest` wraps `p.tick` for external test access — add it as `func (p *Poller) TickForTest(ctx context.Context) { p.tick(ctx) }`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-go && go test ./internal/heartbeat/ -run TestPoller_Pengawasan -v`
Expected: FAIL — no Pengawasan branch yet, no `TickForTest` helper yet.

- [ ] **Step 3: Extend the poller**

Modify `backend-go/internal/heartbeat/poller.go`:
```go
type Poller struct {
	db                       *db.Client
	sender                   *whatsapp.Sender
	lastFiredAt              time.Time
	lastPengawasanFiredDate  time.Time // WIB date — zero means never fired
}

// TickForTest is a test-only entrypoint to drive a single tick. Production
// code only calls Start().
func (p *Poller) TickForTest(ctx context.Context) { p.tick(ctx) }

func (p *Poller) tick(ctx context.Context) {
	cfg, err := p.db.GetHeartbeatConfig()
	if err != nil {
		log.Printf("[HEARTBEAT] GetHeartbeatConfig error: %v", err)
		return
	}
	if cfg == nil {
		return
	}

	now := time.Now().In(wibLocation)

	// --- regular heartbeat branch (existing) ---
	if cfg.Enabled && isWIBBusinessHours(now) {
		p.maybeFireRegular(ctx, cfg, now)
	}

	// --- Pengawasan daily branch (new) ---
	if cfg.PengawasanReportEnabled {
		p.maybeFirePengawasan(ctx, cfg, now)
	}
}

func (p *Poller) maybeFireRegular(ctx context.Context, cfg *db.HeartbeatConfig, now time.Time) {
	// (the existing body of tick from line 60 onward, unchanged; extracted into
	//  a method so the new branch can sit next to it cleanly.)
	// ... existing GetTodayOmset / Hpp / GetLowStockItems / buildReport / send loop
}

func (p *Poller) maybeFirePengawasan(ctx context.Context, cfg *db.HeartbeatConfig, now time.Time) {
	if now.Hour() != cfg.PengawasanReportHour {
		return
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, wibLocation)
	if !p.lastPengawasanFiredDate.IsZero() && p.lastPengawasanFiredDate.Equal(today) {
		return
	}

	// Read Owner WA destination(s) from wa_recipients (matches existing pattern in
	// heartbeat poller — see p.db.GetActiveRecipients usage for the regular branch).
	// If multiple Owner rows exist (multi-Owner MSME), iterate — do NOT LIMIT 1.
	rows, err := p.db.DB.Query(`SELECT wa_number FROM wa_recipients WHERE role='owner' AND is_active=true ORDER BY id`)
	if err != nil {
		log.Printf("[PENGAWASAN] query wa_recipients error: %v", err)
		return
	}
	var ownerNumbers []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			log.Printf("[PENGAWASAN] scan wa_recipients error: %v", err)
			return
		}
		ownerNumbers = append(ownerNumbers, n)
	}
	rows.Close()
	if len(ownerNumbers) == 0 {
		log.Printf("[PENGAWASAN] no active owner recipient in wa_recipients — skipping send")
		return
	}

	msg, err := p.buildPengawasanReport(now)
	if err != nil {
		log.Printf("[PENGAWASAN] buildPengawasanReport error: %v", err)
		return
	}

	for _, num := range ownerNumbers {
		jid := num + "@s.whatsapp.net" // wa_number is e.g. "6281234567890"
		if err := p.sender.SendText(ctx, jid, msg); err != nil {
			log.Printf("[PENGAWASAN] SendText to %s error: %v", jid, err)
			continue
		}
		log.Printf("[PENGAWASAN] Daily report sent to %s", jid)
	}

	p.lastPengawasanFiredDate = today
}

func (p *Poller) buildPengawasanReport(now time.Time) (string, error) {
	topAdj, err := p.db.ListTopAdjustments(5)
	if err != nil {
		return "", err
	}
	disc, err := p.db.ListKasirDiscount7d()
	if err != nil {
		return "", err
	}
	out, err := p.db.ListOutflowOutliers()
	if err != nil {
		return "", err
	}
	aging, err := p.db.ListTransferAging()
	if err != nil {
		return "", err
	}
	actors, err := p.db.ListActorActivity30d()
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	sb.WriteString("🛡️ *Laporan Pengawasan Harian*\n")
	sb.WriteString(fmt.Sprintf("🕐 %s\n\n", now.Format("Monday, 02 Jan 2006 - 15:04 WIB")))

	sb.WriteString("📋 *Top Adjustment 30h:*\n")
	if len(topAdj) == 0 {
		sb.WriteString("• (tidak ada)\n")
	} else {
		for _, a := range topAdj {
			sb.WriteString(fmt.Sprintf("• %s qty %+d (%s) — Rp %s — %s\n",
				a.SKU, a.QtyDelta, a.ReasonCode, formatRupiah(a.ValueRp), a.ActorName))
		}
	}

	sb.WriteString("\n💸 *Diskon Kasir 7h:*\n")
	if len(disc) == 0 {
		sb.WriteString("• (tidak ada)\n")
	} else {
		for _, d := range disc {
			sb.WriteString(fmt.Sprintf("• %s — Rp %s (%.1f%%)\n",
				d.CashierName, formatRupiah(d.TotalDiscountRp), d.DiscountPctOfRevenue*100))
		}
	}

	sb.WriteString("\n🚀 *Outflow Outlier:*\n")
	if len(out) == 0 {
		sb.WriteString("• (tidak ada)\n")
	} else {
		for _, o := range out {
			sb.WriteString(fmt.Sprintf("• %s — %.1f× rata-rata\n", o.SKU, o.Multiplier))
		}
	}

	sb.WriteString("\n⏳ *Transfer Tertunda >24j:*\n")
	if len(aging) == 0 {
		sb.WriteString("• (tidak ada)\n")
	} else {
		for _, t := range aging {
			sb.WriteString(fmt.Sprintf("• #%d %s %d unit — %.1fj — penerima: %s\n",
				t.ID, t.SKU, t.InitiatedQty, t.HoursPending, t.IntendedReceiverName))
		}
	}

	sb.WriteString("\n🔥 *Heatmap Aktor 30h (z-score):*\n")
	for _, a := range actors {
		pill := "Rendah"
		if a.RiskZ > 1.5 {
			pill = "Tinggi"
		} else if a.RiskZ > 0.5 {
			pill = "Sedang"
		}
		sb.WriteString(fmt.Sprintf("• %s — adj %d, ovr %d, ref %d → %s (z=%.2f)\n",
			a.Name, a.AdjustCount, a.OverrideCount, a.RefundCount, pill, a.RiskZ))
	}

	return sb.String(), nil
}
```

- [ ] **Step 4: Re-run tests**

Run: `cd backend-go && go test ./internal/heartbeat/ -run TestPoller_Pengawasan -v`
Expected: all four PASS.

- [ ] **Step 5: Run the full heartbeat test suite for regression**

Run: `cd backend-go && go test ./internal/heartbeat/ -v`
Expected: existing regular-heartbeat tests still PASS (refactor of `tick`-body into `maybeFireRegular` is a pure extraction).

- [ ] **Step 6: Commit**

```bash
git add backend-go/internal/heartbeat/poller.go backend-go/internal/heartbeat/poller_test.go backend-go/internal/whatsapp/fake_sender.go
git commit -m "feat(pengawasan): daily Owner WA report from heartbeat poller"
```

---

## Task 10: Frontend types & permission gating

**Files:**
- Modify: `src/types.ts` (verify Phase 2 added `can_view_pengawasan`; add if missing)
- Create: `src/components/__tests__/DashboardScreen.pengawasan.test.tsx`

- [ ] **Step 1: Verify `ActionPermissionSet.can_view_pengawasan` exists**

Run: `grep -n 'can_view_pengawasan' src/types.ts`
- If present → skip to Step 3.
- If absent (Phase 2 not yet shipped or shipped without this key) → add it.

If adding:
```ts
// src/types.ts
export interface ActionPermissionSet {
  // ... existing keys ...
  can_view_pengawasan: boolean;
}
```

- [ ] **Step 2: Write failing test**

`src/components/__tests__/DashboardScreen.pengawasan.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardScreen from "../DashboardScreen";

vi.mock("../../lib/supabaseClient", () => ({
  supabase: { from: () => ({ select: () => ({ data: [], error: null }) }) },
}));

const baseUser = (perms: Partial<{ can_view_pengawasan: boolean }>) => ({
  id: "u1",
  name: "Test",
  role: "Staff Admin Toko",
  action_permissions: { can_view_pengawasan: false, ...perms },
});

describe("DashboardScreen Pengawasan section gating", () => {
  it("hides the Pengawasan section when can_view_pengawasan is false", () => {
    render(<DashboardScreen currentUser={baseUser({ can_view_pengawasan: false }) as any} />);
    expect(screen.queryByText(/Pengawasan/i)).toBeNull();
  });

  it("shows the Pengawasan section when can_view_pengawasan is true", () => {
    render(<DashboardScreen currentUser={baseUser({ can_view_pengawasan: true }) as any} />);
    expect(screen.getByText(/Pengawasan/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- DashboardScreen.pengawasan`
Expected: FAIL — section not implemented yet.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/components/__tests__/DashboardScreen.pengawasan.test.tsx
git commit -m "test(pengawasan): permission-gating tests for Dashboard Pengawasan section"
```

(Implementation in Task 11 makes the second test pass.)

---

## Task 11: DashboardScreen — Pengawasan section + period filter + heatmap

**Files:**
- Modify: `src/components/DashboardScreen.tsx`

- [ ] **Step 1: Add the section, gated**

Append a section inside `DashboardScreen.tsx` near the bottom, before the closing tag:
```tsx
// Period filter state lives here so it can swap data without a page reload.
const [pengawasanPeriod, setPengawasanPeriod] = useState<"30d" | "7d" | "today">("30d");
const [topAdj, setTopAdj] = useState<TopAdjustmentRow[]>([]);
const [disc, setDisc] = useState<KasirDiscountRow[]>([]);
const [outliers, setOutliers] = useState<OutflowOutlierRow[]>([]);
const [aging, setAging] = useState<TransferAgingRow[]>([]);
const [actors, setActors] = useState<ActorActivityRow[]>([]);
const [drilldownActor, setDrilldownActor] = useState<ActorActivityRow | null>(null);

const canView = !!currentUser?.action_permissions?.can_view_pengawasan;

useEffect(() => {
  if (!canView) return;
  // The period filter only narrows top adjustments + discount window; the other
  // three views are time-bounded in SQL. Swap the SQL filter via .gte() on
  // requested_at / created_at as appropriate.
  const since = pengawasanPeriod === "today"
      ? new Date(new Date().setHours(0,0,0,0)).toISOString()
      : pengawasanPeriod === "7d"
        ? new Date(Date.now() - 7*24*3600*1000).toISOString()
        : new Date(Date.now() - 30*24*3600*1000).toISOString();
  (async () => {
    const a = await supabase.from("v_pengawasan_top_adjustments")
      .select("*").gte("requested_at", since).order("value_rp", { ascending: false }).limit(20);
    setTopAdj((a.data as any[]) ?? []);
    const d = await supabase.from("v_pengawasan_kasir_discount_7d").select("*");
    setDisc((d.data as any[]) ?? []);
    const o = await supabase.from("v_pengawasan_outflow_outliers").select("*");
    setOutliers((o.data as any[]) ?? []);
    const t = await supabase.from("v_pengawasan_transfer_aging").select("*");
    setAging((t.data as any[]) ?? []);
    const ac = await supabase.from("v_pengawasan_actor_activity_30d").select("*")
      .order("risk_z", { ascending: false });
    setActors((ac.data as any[]) ?? []);
  })();
}, [canView, pengawasanPeriod]);

function riskPill(z: number) {
  if (z > 1.5) return <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">Tinggi</span>;
  if (z > 0.5) return <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">Sedang</span>;
  return <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">Rendah</span>;
}

// ...

{canView && (
  <section className="mt-8 border-t pt-6">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-semibold">Pengawasan</h2>
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {(["30d","7d","today"] as const).map(p => (
          <button key={p}
            onClick={() => setPengawasanPeriod(p)}
            className={`px-3 py-1 text-sm rounded-md ${pengawasanPeriod===p ? "bg-white shadow" : "text-gray-600"}`}>
            {p === "today" ? "Hari Ini" : p === "7d" ? "7 Hari" : "30 Hari"}
          </button>
        ))}
      </div>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Top Adjustments */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-medium mb-2">Top Adjustment</h3>
        {topAdj.length === 0 ? <p className="text-sm text-gray-500">Tidak ada.</p> : (
          <ul className="text-sm space-y-1">
            {topAdj.slice(0, 8).map(a => (
              <li key={a.id} className="flex justify-between">
                <span>{a.sku} <span className="text-gray-500">({a.reason_code})</span> — {a.actor_name}</span>
                <span className="font-mono">Rp {a.value_rp.toLocaleString("id-ID")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Kasir Discount */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-medium mb-2">Diskon Kasir 7h</h3>
        {disc.length === 0 ? <p className="text-sm text-gray-500">Tidak ada.</p> : (
          <ul className="text-sm space-y-1">
            {disc.map(d => (
              <li key={d.cashier_user_id} className="flex justify-between">
                <span>{d.cashier_name}</span>
                <span className="font-mono">
                  Rp {d.total_discount_rp.toLocaleString("id-ID")} ({(d.discount_pct_of_revenue*100).toFixed(1)}%)
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Outflow Outliers */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-medium mb-2">Outflow Outlier 7h vs 90h</h3>
        {outliers.length === 0 ? <p className="text-sm text-gray-500">Tidak ada.</p> : (
          <ul className="text-sm space-y-1">
            {outliers.map(o => (
              <li key={o.sku} className="flex justify-between">
                <span>{o.sku} — {o.name}</span>
                <span className="font-mono">{o.multiplier.toFixed(1)}×</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Transfer Aging */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-medium mb-2">Transfer Aging &gt;24h</h3>
        {aging.length === 0 ? <p className="text-sm text-gray-500">Tidak ada.</p> : (
          <ul className="text-sm space-y-1">
            {aging.map(t => (
              <li key={t.id} className="flex justify-between">
                <span>#{t.id} {t.sku} {t.initiated_qty}u → {t.intended_receiver_name}</span>
                <span className="font-mono">{t.hours_pending.toFixed(1)}j</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Actor Heatmap */}
      <div className="bg-white rounded-lg border p-4 lg:col-span-2">
        <h3 className="font-medium mb-2">Heatmap Aktor 30h</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1">Nama</th><th>Role</th>
              <th className="text-right">Adj</th>
              <th className="text-right">Ovr</th>
              <th className="text-right">Ref</th>
              <th className="text-right">Total</th>
              <th className="text-right">Risiko</th>
            </tr>
          </thead>
          <tbody>
            {actors.map(a => (
              <tr key={a.id}
                  className="border-t cursor-pointer hover:bg-gray-50"
                  onClick={() => setDrilldownActor(a)}>
                <td className="py-1">{a.name}</td>
                <td>{a.role}</td>
                <td className="text-right font-mono">{a.adjust_count}</td>
                <td className="text-right font-mono">{a.override_count}</td>
                <td className="text-right font-mono">{a.refund_count}</td>
                <td className="text-right font-mono">{a.total_activity}</td>
                <td className="text-right">{riskPill(a.risk_z)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {drilldownActor && (
      <PengawasanDrilldownModal
        actor={drilldownActor}
        onClose={() => setDrilldownActor(null)}
      />
    )}
  </section>
)}
```

Plus the corresponding TS row types at the top of the file (mirror the Go reader structs).

- [ ] **Step 2: Run the permission-gating test**

Run: `npm run test -- DashboardScreen.pengawasan`
Expected: both tests PASS now (hidden when false, visible when true).

- [ ] **Step 3: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/DashboardScreen.tsx
git commit -m "feat(pengawasan): DashboardScreen Owner-only Pengawasan section + period filter"
```

---

## Task 12: PengawasanDrilldownModal

**Files:**
- Create: `src/components/PengawasanDrilldownModal.tsx`

Drilldown lists the actor's adjustments, overrides, and refunds for the last 30 days. Reads directly from base tables filtered by `requested_by = actor.id`.

- [ ] **Step 1: Create the component**

```tsx
// src/components/PengawasanDrilldownModal.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

interface Props {
  actor: { id: string; name: string; role: string };
  onClose: () => void;
}

interface Row {
  type: "adjustment" | "override" | "refund";
  ts: string;
  detail: string;
}

export default function PengawasanDrilldownModal({ actor, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    (async () => {
      const [adj, ovr, ref] = await Promise.all([
        supabase.from("stock_adjustments")
          .select("id, sku, qty_delta, reason_code, requested_at")
          .eq("requested_by", actor.id).gte("requested_at", since),
        supabase.from("kasir_price_override_requests")
          .select("id, sku, default_price, requested_price, requested_at")
          .eq("requested_by", actor.id).gte("requested_at", since),
        supabase.from("kasir_returns")
          .select("id, sku, qty, refund_amount, requested_at")
          .eq("requested_by", actor.id).gte("requested_at", since),
      ]);
      const out: Row[] = [];
      (adj.data ?? []).forEach((r: any) =>
        out.push({ type: "adjustment", ts: r.requested_at,
          detail: `${r.sku} qty ${r.qty_delta} (${r.reason_code})` }));
      (ovr.data ?? []).forEach((r: any) =>
        out.push({ type: "override", ts: r.requested_at,
          detail: `${r.sku} Rp ${r.default_price} → Rp ${r.requested_price}` }));
      (ref.data ?? []).forEach((r: any) =>
        out.push({ type: "refund", ts: r.requested_at,
          detail: `${r.sku} qty ${r.qty} — refund Rp ${r.refund_amount}` }));
      out.sort((a, b) => b.ts.localeCompare(a.ts));
      setRows(out);
      setLoading(false);
    })();
  }, [actor.id]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
         onClick={onClose}>
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-auto p-6"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-lg font-semibold">{actor.name}</h3>
            <p className="text-sm text-gray-500">{actor.role} — aktivitas 30 hari</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        {loading ? <p>Memuat...</p> : rows.length === 0 ? (
          <p className="text-gray-500">Tidak ada aktivitas dalam 30 hari terakhir.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500">
              <th className="py-1">Waktu</th><th>Jenis</th><th>Detail</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1 font-mono">{new Date(r.ts).toLocaleString("id-ID")}</td>
                  <td>{r.type}</td>
                  <td>{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Import in `DashboardScreen.tsx`**

Add `import PengawasanDrilldownModal from "./PengawasanDrilldownModal";` at the top of `DashboardScreen.tsx`.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/PengawasanDrilldownModal.tsx src/components/DashboardScreen.tsx
git commit -m "feat(pengawasan): PengawasanDrilldownModal — actor 30d activity drilldown"
```

---

## Task 13: NotificationSettingsScreen — Pengawasan toggles

**Files:**
- Modify: `src/components/NotificationSettingsScreen.tsx`

- [ ] **Step 1: Add a Pengawasan settings card**

Inside `NotificationSettingsScreen.tsx`, append a new card alongside the existing heartbeat config:
```tsx
// state additions
const [pengawasanEnabled, setPengawasanEnabled] = useState(true);
const [pengawasanHour, setPengawasanHour] = useState(18);

// in the loader effect (where the existing notification_config row is fetched):
useEffect(() => {
  // ... existing fetch ...
  setPengawasanEnabled(row.pengawasan_report_enabled ?? true);
  setPengawasanHour(row.pengawasan_report_hour ?? 18);
}, []);

async function savePengawasanSettings() {
  const { error } = await supabase
    .from("notification_config")
    .update({
      pengawasan_report_enabled: pengawasanEnabled,
      pengawasan_report_hour: pengawasanHour,
    })
    .eq("id", configId);
  if (error) {
    alert("Gagal menyimpan: " + error.message);
    return;
  }
  alert("Pengaturan Pengawasan disimpan.");
}

// in JSX:
<div className="bg-white rounded-lg border p-4 mt-4">
  <h3 className="font-medium mb-3">Laporan Pengawasan Harian</h3>
  <p className="text-sm text-gray-500 mb-3">
    Owner menerima ringkasan harian via WhatsApp: top adjustment, diskon kasir,
    outflow outlier, transfer tertunda, dan heatmap aktor.
  </p>
  <label className="flex items-center gap-2">
    <input type="checkbox" checked={pengawasanEnabled}
           onChange={e => setPengawasanEnabled(e.target.checked)} />
    <span>Aktif</span>
  </label>
  <label className="block mt-3">
    <span className="text-sm text-gray-700">Jam kirim (WIB)</span>
    <input type="number" min={0} max={23} value={pengawasanHour}
           onChange={e => setPengawasanHour(Number(e.target.value))}
           className="ml-2 border rounded px-2 py-1 w-20" />
  </label>
  <button onClick={savePengawasanSettings}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded">
    Simpan
  </button>
</div>
```

- [ ] **Step 2: Run typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Manual smoke**

Bring the app up locally; toggle off, save; verify the row is updated in Supabase. Toggle on, change hour to 19, save; verify.

- [ ] **Step 4: Commit**

```bash
git add src/components/NotificationSettingsScreen.tsx
git commit -m "feat(pengawasan): NotificationSettingsScreen toggle + hour for daily report"
```

---

## Task 14: End-to-end smoke through the running app

**Files:** none (manual verification).

- [ ] **Step 1: Bring up local dev**

Run: `npm run dev` (frontend) + Go daemon as documented. Apply all migrations: `supabase db push --include-all`.

- [ ] **Step 2: Verify Dashboard gating**

1. Log in as Owner → "Pengawasan" section visible, all five tiles render (even if empty seeded environment).
2. Log in as Staff Admin Toko (without `can_view_pengawasan`) → section hidden, no Supabase query for the views runs (verify in browser network tab).
3. As Owner: click a heatmap row → drilldown modal opens.
4. Switch period 30d → 7d → Hari Ini; tile data refreshes without page reload.

- [ ] **Step 3: Verify daily WA fire (synthetic)**

In `notification_config` set `pengawasan_report_hour` to the current WIB hour; ensure `wa_recipients` has at least one row with `role='owner' AND is_active=true AND wa_number='<your-test-account>'`. Wait ≤ 60 s for the next poller tick. Expect one WA message arriving with the five sections populated (or "(tidak ada)" lines). Tick again within the same hour → no second send.

- [ ] **Step 4: Update `progress.md`**

Add a Phase 4 — DONE entry.

- [ ] **Step 5: Commit progress note**

```bash
git add progress.md
git commit -m "docs(progress): Phase 4 Owner anomaly dashboard shipped"
```

---

## Self-Review Checklist

Run through this before declaring Phase 4 done:

- [ ] Both migrations (`…050`, `…051`) apply cleanly on a fresh database.
- [ ] All five views return rows for a seeded dataset; `risk_z = 0` when actor activity is uniform across all actors (no division-by-zero).
- [ ] `GRANT SELECT TO authenticated` set on every view; no RLS policy needed yet (gating happens client-side via `can_view_pengawasan`).
- [ ] Go tests `TestPengawasanView_*`, `TestHeartbeatConfig_ReadsPengawasanFields`, `TestPoller_Pengawasan*` all PASS.
- [ ] Existing heartbeat regular-report tests still PASS after the `tick` refactor (no regression).
- [ ] Daily Pengawasan WA fires exactly once per WIB calendar day at `pengawasan_report_hour` and not earlier or later, and not at all when `pengawasan_report_enabled=FALSE` or no `wa_recipients` row exists with `role='owner' AND is_active=true`.
- [ ] DashboardScreen Pengawasan section is hidden when `can_view_pengawasan` is `false` and visible when `true`; verified by the Vitest tests.
- [ ] Period filter (30d / 7d / Hari Ini) swaps `topAdj` data without a page reload.
- [ ] Heatmap row click opens `PengawasanDrilldownModal` and the modal lists adjustment, override, and refund rows in the last 30 days for that actor.
- [ ] `NotificationSettingsScreen` save persists `pengawasan_report_enabled` and `pengawasan_report_hour` to `notification_config`.
- [ ] `progress.md` updated with Phase 4 DONE entry.

## Out of Scope (Phase 4)

- Configurable per-metric alert thresholds (the 3× outflow multiplier, the >24 h transfer cutoff, and the z-score pill cutoffs are hardcoded — change requires a code edit).
- ML-based anomaly detection (no learned baselines; rolling 90-day average is the only baseline).
- Multi-shop aggregation (single-tenant assumption matches the spec).
- CSV export of any view beyond browser print of the rendered tables.
- RLS hardening on the views themselves (frontend gates via `can_view_pengawasan`; if the threat model later includes a hostile authenticated client, a follow-up plan adds `USING (auth.uid() IN (SELECT id FROM admin_users WHERE (action_permissions->>'can_view_pengawasan')::boolean))` policies).
- Per-section sub-toggles in the daily WA report (one master toggle only; if Owner wants to mute a single section we add it later).
- Drilldown for top-adjustments / outflow-outliers / transfer-aging tiles (only the actor heatmap has a drilldown).
- Backfill of activity for actors deleted from `admin_users` (LEFT JOIN drops orphans; spec accepts this).
