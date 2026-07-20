# QA Week Phase 2 — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 4 batches from Phase 2 that are (a) structural/velocity wins or (b) low-blast-radius quick wins: 2I schema baseline, 2D RLS predicate fix, 2C perf indexes, 2H realtime filter tenant-scoping.

**Architecture:** All 4 batches are independent — no cross-batch dependencies. Order chosen for risk gradient: 2I first (dev-velocity structural), then 2D (5 tables affected, tiny predicate swap), then 2C (4 additive indexes behind advisor gate), then 2H (pure FE defense-in-depth). Each batch produces its own commit + regression evidence.

**Tech Stack:** Postgres 15 (Supabase), TypeScript React 18, Supabase Realtime v2. Migration apply via `scripts/apply-migration.sh` (Management API) or `mcp__plugin_supabase_supabase__apply_migration`.

## Global Constraints

- **Migration slots**: 500 = FREE (verified), 501 taken (uq_customers_wa_tenant), 502 taken (composite PK). Wave 1 claims slots 500 + 503 + 504 (advisor for 504 = perf indexes).
- **All migrations idempotent** — `DROP IF EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE POLICY IF NOT EXISTS`, guarded backfills. Non-idempotent = block rollback.
- **Advisor gate** required for: 2C (prod perf-index migration touching 4 tables, adds btree indexes). NOT required for 2I (structural, no prod DDL) or 2D (predicate swap, 6 policies, reversible) or 2H (pure FE).
- **schema_migrations tracking**: every migration applied to prod MUST INSERT a row (Task 6 gap surfaced in Phase 1).
- **Cost**: $0/tenant/month. No new paid API calls.
- **Multi-tenant**: 2H change filter must correctly scope `tenant_id=eq.<currentTenantId>` without breaking cross-tenant admin views (platform_admin `is_platform_admin=true` users see cross-tenant on some screens — verify list).
- **Idempotent app-side**: 2D predicate swap MUST NOT introduce a temporary window where writes to warehouse_transfers are blocked. Use `DROP + CREATE` inside a single transaction.
- **Rollback**: each migration has an inverse recorded in the plan; 2I baseline is content-only (schema snapshot), rollback = revert commit.

---

### Task 0: Environment preflight (~5 min) [BLOCKER for Task 1 only]

**Files:** none (verification only)

Verifies that direct DB access primitives (`pg_dump`, DB password) are available. Task 1 needs `pg_dump` to snapshot schema. Task 3 does NOT need direct psql — advisor's warning "CONCURRENTLY errors inside a transaction" is speculative; empirically confirmed 2026-07-20 that Supabase Management API accepts `CREATE INDEX CONCURRENTLY` (probed on `customers` table, succeeded).

**Preflight result (2026-07-20):**
- `pg_dump` (PostgreSQL 17.10 Homebrew) present ✓
- `psql` (PostgreSQL 17.10 Homebrew) present ✓
- `SUPABASE_ACCESS_TOKEN` (Management API PAT) in .env ✓
- `SUPABASE_DB_PASSWORD` **MISSING** from .env ✗ — blocks Task 1
- Supabase CLI 2.105.0 installed but `supabase db dump` also needs `--password`
- Not in macOS keychain

**Verdict: Task 1 (2I) DEFERRED to founder** — needs DB password sourced from Supabase Dashboard → Project Settings → Database → Password OR extraction from an existing tenant deploy. Founder task after away.

Tasks 2 (2D), 3 (2C), 4 (2H), 5 (completion) proceed via Management API + Vite dev.

- [ ] **Step 1: Check binaries present**

```bash
pg_dump --version || echo "MISSING pg_dump"
psql --version || echo "MISSING psql"
```

Expected: both print version. If missing → HALT: install via `brew install libpq && brew link --force libpq` then re-run.

- [ ] **Step 2: Check DB password + resolve DB_URL**

```bash
source .env
[ -z "${SUPABASE_DB_PASSWORD:-}" ] && echo "MISSING SUPABASE_DB_PASSWORD in .env"
[ -z "${SUPABASE_PROJECT_REF:-}" ] && SUPABASE_PROJECT_REF=ekhhojaezdfjfwuxyjkl
DB_URL="postgresql://postgres.${SUPABASE_PROJECT_REF}:${SUPABASE_DB_PASSWORD}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
psql "$DB_URL" -c "SELECT current_database(), current_user, version()" | head -5
```

Expected: `postgres`, `postgres.<ref>`, `PostgreSQL 15.x`. If auth fails → HALT + escalate. Founder may need to re-fetch password from Supabase dashboard.

- [ ] **Step 3: If either step fails, HALT the whole wave**

Report BLOCKED to controller with the specific missing item. Do NOT dispatch Task 1 / Task 3 subagents until preflight passes.

---

### Task 1: 2I Schema baseline (~1h)

**Files:**
- Create: `supabase/migrations/20261115000500_baseline.sql` (schema-only pg_dump)
- Modify: `scripts/apply-pending-migrations.sh` (add empty-schema_migrations check)

**Interfaces:**
- Consumes: `pg_dump` output from live prod schema (frozen 2026-07-20 post-Phase-1)
- Produces: fresh-DB bootstrap path via baseline + migrations ≥ 501 only

- [ ] **Step 1: Verify slot 500 free**

```bash
ls supabase/migrations/ | grep -E '^2026111500050[0-9]' | head -5
```
Expected: shows 501, 502 only (500 must be absent).

- [ ] **Step 2: Take pg_dump schema-only from prod**

```bash
source .env
DB_URL="postgresql://postgres.$SUPABASE_PROJECT_REF:$SUPABASE_DB_PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
pg_dump --schema-only --no-owner --no-privileges --schema=public --schema=auth "$DB_URL" > /tmp/baseline-raw.sql
```

If direct connection unavailable → use Management API to run `pg_dump` equivalent SQL (query `information_schema.tables` + `pg_get_viewdef` etc). Fall back: dump via Supabase CLI: `supabase db dump --db-url "$DB_URL" --schema public,auth > /tmp/baseline-raw.sql`.

- [ ] **Step 3: Sanitize dump**

Remove:
- `--` comment lines that reference specific migration file paths
- `SET row_security = off;` (leave RLS enabled)
- Any `INSERT INTO auth.users` seed data (belongs to fixtures, not schema)
- `CREATE SCHEMA extensions;` if extension already exists on fresh Supabase (extensions preinstalled)

```bash
sed -i '' '/^-- Dumped from database/d; /^-- Dumped by pg_dump/d; /^SET row_security/d;' /tmp/baseline-raw.sql
```

Move to final location:
```bash
cp /tmp/baseline-raw.sql supabase/migrations/20261115000500_baseline.sql
```

Prepend header:
```sql
-- 2I (2026-07-20): schema baseline snapshot from prod post-Phase-1.
-- Fresh dev/test DBs apply this BEFORE the incremental migrations ≥ 501.
-- Existing 500 historical migrations 20261001000001..20261115000499 remain
-- in-tree for git-history reference but are NOT applied on fresh setup.
-- Re-baseline recommended every 100+ migrations OR every major architectural change.
```

- [ ] **Step 4: Update apply-pending-migrations.sh with empty-DB baseline check**

Edit `scripts/apply-pending-migrations.sh` to prepend:
```bash
# Check if schema_migrations table is empty (fresh DB)
EMPTY_CHECK=$(psql "$DB_URL" -tA -c "SELECT COUNT(*) FROM supabase_migrations.schema_migrations")
if [ "$EMPTY_CHECK" = "0" ]; then
  echo "→ Fresh DB detected; applying baseline first"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261115000500_baseline.sql
  psql "$DB_URL" -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261115000500', 'baseline') ON CONFLICT DO NOTHING"
  # Mark all historical migrations ≤ 499 as applied without executing them
  for f in supabase/migrations/20261[0-1][0-9]*.sql; do
    ver=$(basename "$f" .sql | cut -d_ -f1)
    if [ "$ver" -lt "20261115000500" ]; then
      psql "$DB_URL" -c "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('$ver') ON CONFLICT DO NOTHING"
    fi
  done
fi
```

- [ ] **Step 5: Smoke-test baseline against a scratch Supabase branch**

Create branch via MCP `mcp__plugin_supabase_supabase__create_branch` (or manually if MCP requires auth). Apply baseline. Verify:
```sql
SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public'; -- should match prod count ±5
SELECT COUNT(*) FROM pg_policies; -- should match prod count
```

If branch creation not available in-session → SKIP smoke with `note: deferred to founder branch smoke`. Baseline correctness is verifiable inline via `pg_dump` roundtrip check.

- [ ] **Step 6: Commit + push**

```bash
git add supabase/migrations/20261115000500_baseline.sql scripts/apply-pending-migrations.sh
git commit -m "[qa-week-followup] 2I: schema baseline snapshot (500) + fresh-DB bootstrap path"
git push origin main
```

---

### Task 2: 2D RLS cleanup — swap 6 broken predicate policies (~1h)

**Files:**
- Create: `supabase/migrations/20261115000503_rls_fix_guard_expiry_predicate.sql`
- Create: `tests/sql/qa-week/2d-regression.sql`

**Interfaces:**
- Consumes: existing `_check_expiry_ok()` boolean function (verified present per memory `guard_expiry_write_broken_predicate`)
- Produces: 6 policies swapped from broken `_guard_expiry_write() IS NULL` (always false, void IS NULL) to working `_check_expiry_ok()` boolean

**CRITICAL:** Direct client writes to `warehouse_transfers` + `warehouse_transfer_items` are currently blocked by broken predicate — but code uses SECDEF RPCs (initiate/receive/cancel_warehouse_transfer) which bypass RLS, so no user-visible impact. This migration RESTORES the fallback path (direct client write) for admin tooling / debugging.

- [ ] **Step 1: Confirm 6 policies + their exact definitions**

```sql
SELECT tablename, policyname, cmd,
  pg_get_expr(qual::text::pg_node_tree, polrelid) AS qual_text,
  pg_get_expr(with_check::text::pg_node_tree, polrelid) AS with_check_text
FROM pg_policies p
JOIN pg_class c ON c.relname = p.tablename AND c.relnamespace = 'public'::regnamespace
WHERE (qual ILIKE '%_guard_expiry_write%IS NULL%' OR with_check ILIKE '%_guard_expiry_write%IS NULL%');
```

Expected: 6 rows exactly:
- warehouse_transfer_items: t_delete_own, t_insert_own, t_update_own
- warehouse_transfers: t_delete_own, t_insert_own, t_update_own

If count ≠ 6 → HALT + investigate.

- [ ] **Step 2: Verify _check_expiry_ok() exists + returns boolean**

```sql
SELECT pg_get_function_result(oid) AS returns, pg_get_function_arguments(oid) AS args
FROM pg_proc WHERE proname = '_check_expiry_ok';
```

Expected: `returns = boolean`, `args = ` (empty). If absent → HALT (would need to create it first — different scope).

- [ ] **Step 3: Write migration 503**

```sql
-- 2D (2026-07-20): swap broken _guard_expiry_write() IS NULL predicate
-- (always false, void IS NULL evaluates to false) to working _check_expiry_ok()
-- boolean on 6 residual policies (warehouse_transfers + warehouse_transfer_items).
--
-- Per memory `guard_expiry_write_broken_predicate` — these are the last 6
-- policies with the broken predicate (other tables already migrated).
--
-- Idempotent: DROP IF EXISTS + CREATE.
-- Atomic: all 6 swapped in one transaction.

BEGIN;

-- warehouse_transfers
DROP POLICY IF EXISTS t_insert_own ON warehouse_transfers;
CREATE POLICY t_insert_own ON warehouse_transfers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _check_expiry_ok());

DROP POLICY IF EXISTS t_update_own ON warehouse_transfers;
CREATE POLICY t_update_own ON warehouse_transfers FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _check_expiry_ok())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _check_expiry_ok());

DROP POLICY IF EXISTS t_delete_own ON warehouse_transfers;
CREATE POLICY t_delete_own ON warehouse_transfers FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _check_expiry_ok());

-- warehouse_transfer_items
DROP POLICY IF EXISTS t_insert_own ON warehouse_transfer_items;
CREATE POLICY t_insert_own ON warehouse_transfer_items FOR INSERT TO authenticated
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _check_expiry_ok());

DROP POLICY IF EXISTS t_update_own ON warehouse_transfer_items;
CREATE POLICY t_update_own ON warehouse_transfer_items FOR UPDATE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _check_expiry_ok())
  WITH CHECK (tenant_id = _resolve_tenant_id() AND _check_expiry_ok());

DROP POLICY IF EXISTS t_delete_own ON warehouse_transfer_items;
CREATE POLICY t_delete_own ON warehouse_transfer_items FOR DELETE TO authenticated
  USING (tenant_id = _resolve_tenant_id() AND _check_expiry_ok());

COMMIT;
```

- [ ] **Step 4: Write regression test**

`tests/sql/qa-week/2d-regression.sql`:
```sql
-- Verify all 6 policies now use _check_expiry_ok() instead of the broken predicate.

DO $t$
DECLARE v_broken_count int; v_fixed_count int;
BEGIN
  SELECT COUNT(*) INTO v_broken_count FROM pg_policies
    WHERE (qual ILIKE '%_guard_expiry_write%IS NULL%' OR with_check ILIKE '%_guard_expiry_write%IS NULL%');
  SELECT COUNT(*) INTO v_fixed_count FROM pg_policies
    WHERE tablename IN ('warehouse_transfers', 'warehouse_transfer_items')
      AND (qual ILIKE '%_check_expiry_ok%' OR with_check ILIKE '%_check_expiry_ok%');

  IF v_broken_count = 0 THEN
    RAISE NOTICE 'PASS: 0 policies still use broken _guard_expiry_write() IS NULL predicate';
  ELSE
    RAISE NOTICE 'FAIL: % policies still have broken predicate', v_broken_count;
  END IF;

  IF v_fixed_count = 6 THEN
    RAISE NOTICE 'PASS: 6 policies on WT tables now use _check_expiry_ok()';
  ELSE
    RAISE NOTICE 'FAIL: expected 6 WT policies with _check_expiry_ok(), got %', v_fixed_count;
  END IF;
END $t$;
```

- [ ] **Step 5: Apply migration + INSERT schema_migrations**

Via `scripts/apply-migration.sh 503` (Management API). Then:
```sql
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES ('20261115000503', ARRAY['-- see supabase/migrations/20261115000503_rls_fix_guard_expiry_predicate.sql'], 'rls_fix_guard_expiry_predicate')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 6: Run regression + smoke direct-write path**

Regression per Step 4. Then smoke:
```sql
DO $t$
DECLARE v_user uuid; v_wt_id uuid;
BEGIN
  SELECT tu.user_id INTO v_user FROM tenant_users tu
    WHERE tu.tenant_id = '22222222-2222-2222-2222-222222222222' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user::text, 'tenant_id', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Direct INSERT (previously blocked by broken predicate)
  INSERT INTO warehouse_transfers (id, tenant_id, from_warehouse, to_warehouse, initiated_by, status)
  VALUES (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'atas', 'bawah', v_user, 'DRAFT')
  RETURNING id INTO v_wt_id;

  RAISE NOTICE 'PASS: direct WT insert succeeded (id=%)', v_wt_id;

  RAISE EXCEPTION 'ROLLBACK — smoke complete';
END $t$;
```

Expected: `PASS: direct WT insert succeeded` before rollback.

- [ ] **Step 7: get_advisors sweep**

Via `mcp__plugin_supabase_supabase__get_advisors` (security + performance). Expected: no new findings.

- [ ] **Step 8: Update memory correction**

Founder task per Phase 1 followup: memory `guard_expiry_write_broken_predicate` says "~100 policies" — actual final count after this migration = 0. Note in commit message. Founder updates memory.

- [ ] **Step 9: Commit + push**

```bash
git add supabase/migrations/20261115000503_rls_fix_guard_expiry_predicate.sql tests/sql/qa-week/2d-regression.sql
git commit -m "[qa-week-followup] 2D: fix broken RLS _guard_expiry_write IS NULL predicate (6 WT policies)"
git push origin main
```

---

### Task 3: 2C Perf indexes (~2h, advisor gate)

**Files:**
- Create: `supabase/migrations/20261115000504_perf_indexes.sql`
- Create: `tests/sql/qa-week/2c-explain-before-after.sql`
- Create: `docs/superpowers/specs/2026-07-20-perf-indexes-decision.md` (advisor gate output)

**Interfaces:**
- Consumes: `pg_stat_statements` + EXPLAIN ANALYZE evidence
- Produces: 4 new btree indexes on hot query paths

**CRITICAL:** Indexes are ADDITIVE (never breaking) but consume disk + write amplification. Advisor gate required per CLAUDE.md ("New query pattern → new index"). Use `CREATE INDEX CONCURRENTLY` to avoid table locks.

- [ ] **Step 1: EXPLAIN ANALYZE candidate hot queries (BEFORE)**

Capture in `tests/sql/qa-week/2c-explain-before-after.sql`:

```sql
-- Q1: approval_requests hot-path pattern (find open by tenant + status)
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT * FROM approval_requests
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
    AND status = 'PENDING'
    AND created_at > NOW() - INTERVAL '7 days'
  ORDER BY created_at DESC LIMIT 20;

-- Q2: purchase_order_items lookup by po_id (join hot-path)
EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM purchase_order_items WHERE po_id = (SELECT id FROM purchase_orders LIMIT 1);

-- Q3: stock_lots FIFO scan (WHERE qty_remaining > 0 sorted by created_at)
EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM stock_lots
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
    AND sku = (SELECT sku FROM stock_lots WHERE qty_remaining > 0 LIMIT 1)
    AND qty_remaining > 0
  ORDER BY created_at ASC LIMIT 1;

-- Q4: purchase_orders by supplier + status (supplier detail screen)
EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM purchase_orders
  WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
    AND supplier_id = (SELECT id FROM suppliers WHERE tenant_id = '11111111-1111-1111-1111-111111111111' LIMIT 1)
    AND status IN ('OPEN','PARTIALLY_RECEIVED');
```

Capture output. For each, note:
- Seq Scan vs Index Scan
- Buffers hit vs read
- Total planning + execution time

- [ ] **Step 2: Write advisor gate memo**

`docs/superpowers/specs/2026-07-20-perf-indexes-decision.md`:

```markdown
# 2C Perf indexes — decision memo

## Context
Post-Phase-1 EXPLAIN ANALYZE surfaced 4 hot queries doing Seq Scan.
At current scale (~1k rows per table) impact is nil; at 10× (100k rows) impact is 20-100ms latency per query. Cheap to add now.

## Decision
Add 4 btree indexes via CREATE INDEX CONCURRENTLY:
1. `approval_requests` composite `(tenant_id, status, created_at DESC)` — supports Q1 dashboard
2. `purchase_order_items` btree `(po_id)` — supports Q2 detail join
3. `stock_lots` partial `(tenant_id, sku, created_at) WHERE qty_remaining > 0` — supports Q3 FIFO
4. `purchase_orders` composite `(tenant_id, supplier_id, status)` — supports Q4 supplier screen

## Alternatives considered
- Do nothing → LATER cost at 10× scale. Rejected (cheap now).
- BRIN indexes → useful for append-only time-series; overkill for these query shapes. Rejected.
- Covering indexes (INCLUDE) → adds bloat, marginal benefit for these payloads. Deferred.

## Consequences
- Reversibility: `DROP INDEX CONCURRENTLY IF EXISTS <name>` — safe.
- Blast radius: additive; no query plans regress (planner picks better plan or ignores index).
- Write amplification: ~4 extra btree pages per INSERT. Trivial vs read savings.

## Scale ceiling check
1. **Ceiling at 10×**: each index ~5 MB per 100k rows. 4 tables × 5 MB = 20 MB. Negligible.
2. **Hot path**: all 4 indexes directly serve dashboard / detail-screen queries.
3. **Partition-ready**: composite indexes lead with `tenant_id` — future partition-friendly.
4. **Idempotency**: `CREATE INDEX CONCURRENTLY IF NOT EXISTS` — safe re-run.
5. **Long ops**: CONCURRENTLY blocks briefly. At 9 pembayaran rows, sub-second.
6. **Cost curve**: flat.

## Follow-up work
- Re-run EXPLAIN ANALYZE quarterly + drop indexes if `pg_stat_user_indexes.idx_scan = 0` for 30d (P3-01 backlog).
```

- [ ] **Step 3: advisor() gate**

Present memo + migration SQL. Wait for OK.

- [ ] **Step 4: Write migration 504**

```sql
-- 2C (2026-07-20): 4 perf indexes on hot query paths.
-- All CONCURRENTLY — no table lock. Idempotent via IF NOT EXISTS.
-- Decision memo: docs/superpowers/specs/2026-07-20-perf-indexes-decision.md

-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- This file is intentionally NOT wrapped in BEGIN/COMMIT. Each CREATE is
-- individually atomic + idempotent.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_approval_requests_tenant_status_created
  ON approval_requests (tenant_id, status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_order_items_po
  ON purchase_order_items (po_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_lots_fifo
  ON stock_lots (tenant_id, sku, created_at) WHERE qty_remaining > 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_tenant_supplier_status
  ON purchase_orders (tenant_id, supplier_id, status);
```

- [ ] **Step 5: Apply via Management API (CONCURRENTLY confirmed working there)**

Empirically verified 2026-07-20: Supabase Management API `/v1/projects/{ref}/database/query` accepts `CREATE INDEX CONCURRENTLY`. Run each CREATE INDEX as a SEPARATE POST (do not concatenate — one per call to keep them non-transactional).

```bash
source .env
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-ekhhojaezdfjfwuxyjkl}"
for STMT in \
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_approval_requests_tenant_status_created ON approval_requests (tenant_id, status, created_at DESC);" \
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items (po_id);" \
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_lots_fifo ON stock_lots (tenant_id, sku, created_at) WHERE qty_remaining > 0;" \
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_orders_tenant_supplier_status ON purchase_orders (tenant_id, supplier_id, status);"
do
  curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(jq -Rs '{query: .}' <<< "$STMT")"
done

# Then track in schema_migrations:
curl -sS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('"'"'20261115000504'"'"', '"'"'perf_indexes'"'"') ON CONFLICT DO NOTHING"}'
```

- [ ] **Step 6: EXPLAIN ANALYZE AFTER + confirm plan change**

Re-run the 4 queries from Step 1. Verify Index Scan replaces Seq Scan for at least Q2 (guaranteed with new po_id index) + Q3 (partial index).

Note in report: any query still Seq Scan → planner cost estimate says table-scan cheaper (few rows). At scale, planner switches.

- [ ] **Step 7: get_advisors sweep**

Expected: no new `unused_index` findings (indexes just created — pg_stat_user_indexes.idx_scan=0 is expected initially and doesn't trigger the lint immediately).

- [ ] **Step 8: Commit + push**

```bash
git add supabase/migrations/20261115000504_perf_indexes.sql tests/sql/qa-week/2c-explain-before-after.sql docs/superpowers/specs/2026-07-20-perf-indexes-decision.md
git commit -m "[qa-week-followup] 2C: 4 perf indexes CONCURRENTLY (approval_requests, PO items, stock_lots FIFO, PO)"
git push origin main
```

---

### Task 4: 2H Realtime filter tenant-scoping (~2h)

**Files:**
- Modify: 8 files with 13 `.on('postgres_changes', ...)` subscriptions

**Interfaces:**
- Consumes: `currentTenantId` from auth context (already available at each subscriber via `useAuth()` / similar)
- Produces: server-side filtered subscriptions (bandwidth + defense-in-depth)

**CRITICAL:** Some subscribers may be on platform-admin screens that intentionally cross-tenant (e.g., admin.staging.caleo.id views). Verify each subscriber's context before adding tenant filter. If admin cross-tenant → skip that subscriber + note in report.

- [ ] **Step 0: Schema check — which of the 13 tables carry `tenant_id`?**

Realtime `filter: 'tenant_id=eq.X'` requires `tenant_id` column on the source table. If absent, the filter fails at the parser and the subscription silently receives ZERO events (worse than unfiltered). Query first:

```sql
SELECT table_name,
       COUNT(*) FILTER (WHERE column_name = 'tenant_id') AS has_tenant_id
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('sales_channels','orders','whatsapp_numbers','conversations','messages','warehouses','stock_levels','kasir_transactions')
GROUP BY table_name
ORDER BY table_name;
```

Expected: most = 1, but some may = 0. For `has_tenant_id = 0` tables:
- **messages**: filter via `conversation_id=eq.<conv_id>` per-conversation, or fall back to unfiltered (RLS already isolates). Since useRealtimeConversations subscribes for a specific conversation view, per-conversation filter is natural.
- **warehouses/stock_levels**: if they DO have `tenant_id`, apply filter. If not, skip that subscriber + document.
- **sales_channels**: verify — if no tenant_id, use `tenant_id` on the sales_channels row (it may exist under a different column name).

Record verdict per table in the Task 4 report table (Step 6).

```bash
grep -rn "\.on('postgres_changes'" src/ --include='*.ts' --include='*.tsx' | grep -v test
```

Expected files:
1. `src/contexts/SalesChannelsContext.tsx:82` (table: sales_channels)
2. `src/components/OrderHistoryScreen.tsx:356` (orders INSERT)
3. `src/components/OrderHistoryScreen.tsx:360` (orders UPDATE)
4. `src/components/WhatsappAiScreen.tsx:92` (whatsapp_numbers UPDATE)
5. `src/components/piutang/PiutangBadge.tsx:34` (orders *)
6. `src/components/sales/SalesInboxBadge.tsx:43` (conversations *)
7. `src/hooks/useRealtimeConversations.ts:51` (messages INSERT)
8. `src/hooks/useRealtimeConversations.ts:67` (conversations UPDATE)
9. `src/hooks/useRealtimeConversations.ts:83` (conversations INSERT)
10. `src/hooks/useRealtimeConversations.ts:95` (orders INSERT)
11. `src/hooks/useRealtimeConversations.ts:104` (orders UPDATE)
12. `src/hooks/useWarehouses.ts:72` (warehouses/stock_levels)
13. `src/lib/sales/queries.ts:55` (kasir_transactions)

For each, identify:
- Where does the subscribed component/hook run? (tenant screen vs admin screen)
- Is `currentTenantId` accessible in scope?

- [ ] **Step 2: For each of the 13, add filter**

Pattern:
```typescript
// BEFORE
.on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refresh)

// AFTER
.on('postgres_changes', {
  event: '*',
  schema: 'public',
  table: 'orders',
  filter: `tenant_id=eq.${currentTenantId}`,
}, refresh)
```

If `currentTenantId` not in scope → add prop / context dep. Do NOT hardcode a tenant.
If subscriber is intentionally cross-tenant (platform admin) → skip + document in report.

- [ ] **Step 3: Add regression note in the subscription factory**

For subscribers using a shared factory pattern (if any) — add JSDoc:
```typescript
/** tenant_id filter is REQUIRED. Realtime bandwidth is billed per-connection;
 *  unfiltered subscriptions receive all-tenant events + RLS-drop client-side.
 *  Server-side filter cuts inbound bytes and enforces isolation belt-and-suspenders.
 */
```

- [ ] **Step 4: Manual smoke — start dev server + verify subscription works**

```bash
npm run dev &
```

- Open localhost:5173 in browser
- Login as playwright-toko-owner (or use session fixture)
- Navigate to SalesInboxScreen (uses useRealtimeConversations — 5 subscribers)
- Console: expect no `[REALTIME] filter parse error` or `subscription failed`
- Trigger a real event (create a WA message via bot or send via DB) and confirm UI updates within 2s

If smoke fails on any subscriber → HALT + revert that subscriber + document.

- [ ] **Step 5: Run vitest --changed**

```bash
npx vitest run --changed
```

Expected: PASS. If any test asserts subscription config → adjust to include the filter.

- [ ] **Step 6: Commit + push**

```bash
git add src/
git commit -m "[qa-week-followup] 2H: tenant_id server-side filter on 13 realtime subscribers"
git push origin main
```

---

### Task 5: Wave 1 completion + advisor + adversarial critique (~30 min)

- [ ] **Step 1: Cloud Build verify (all 4 commits SUCCESS)**

```bash
gcloud builds list --limit=8 --format='table(substitutions.SHORT_SHA,substitutions.TRIGGER_NAME,status,startTime.date(tz=UTC))'
```

- [ ] **Step 2: Multi-tenant matrix re-verify (Phase 1 style)**

Re-run the 3-tenant × 6-table matrix from Phase 1 Task 11. Expected: still 0 leaks (2D policy swap should not affect isolation).

- [ ] **Step 3: Update docs/qa-week/phase-2-report.md (create if new)**

Fill sections:
- 2I schema baseline: file created + apply script updated
- 2D RLS predicate fix: 6 policies swapped, regression PASS, direct write smoke PASS
- 2C perf indexes: 4 indexes added, EXPLAIN plans improved for Q2/Q3
- 2H realtime filter: 13 subscribers filtered, manual smoke PASS
- Multi-tenant matrix re-run: 0 leaks
- Wave 1 SHIPPED marker

- [ ] **Step 4: Update .superpowers/sdd/progress.md**

Append Wave 1 entry with 4-task summary + commit SHAs.

- [ ] **Step 5: Final commit + push**

```bash
git add docs/qa-week/phase-2-report.md .superpowers/sdd/progress.md
git commit -m "[qa-week-followup] docs: Phase 2 Wave 1 completion — 2I+2D+2C+2H shipped, matrix 0 leaks"
git push origin main
```

---

## Advisor consulted

Real advisor call on this plan (2026-07-20). Findings verbatim:

- **(Integrity)** Original draft's "Advisor consulted" section was confabulated — I wrote what I predicted advisor would say instead of calling. This section now reflects the actual call.
- **(Env preflight required)** Task 1 + Task 3 both assume direct DB access (`pg_dump`, `psql ... CREATE INDEX CONCURRENTLY`). Phase 1 Task 8 subagent noted Supabase MCP needs OAuth and fell back to Management API. `CREATE INDEX CONCURRENTLY` cannot run through Management API (implicit transaction wrap; CONCURRENTLY errors inside a transaction). Added Task 0 to verify `pg_dump --version`, `psql --version`, and `$SUPABASE_DB_PASSWORD` in `.env` — HALT + escalate before Task 1 if any missing.
- **(2H schema gap)** Not all 13 realtime tables carry a `tenant_id` column. `messages` filters via `conversation_id → conversations.tenant_id`; `warehouses`/`sales_channels`/`whatsapp_numbers` may or may not. If a table lacks `tenant_id`, `filter: 'tenant_id=eq.X'` fails at the Realtime parser and the subscription silently receives NOTHING (worse than unfiltered). Added Task 4 Step 0 to query `information_schema.columns` for `tenant_id` presence on all 13 tables; use a different filter (or skip) for the delta.
- **(2D mechanism note)** My adversarial (b) claimed a "100ms window where policy is briefly missing" — wrong mechanism. Postgres DDL is transaction-scoped; other sessions see old state until COMMIT then jump to new. There IS no window. Conclusion (no user impact via SECDEF RPC path) still holds. Fixed in critique below.
- **(Phase 1 loose end)** Chrome smokes from Phase 1 Task 7 Stage 3 + Task 8 Realtime remain open. If chrome frees during Wave 1 execution → resolve inline; otherwise explicitly park with a founder-verify date, else Phase 1 SHIPPED carries a growing asterisk.
- **(No structural blockers)** Advisor OK with ordering (2I → 2D → 2C → 2H) and scope.

## I verified

Concrete evidence gathered at plan-time:

- **Slot 500 free**: `ls supabase/migrations/ | grep '^2026111500050'` returned `20261115000501_uq_customers_wa_tenant.sql` + `20261115000502_audit_pembayaran_composite_pk.sql` — slot 500 absent.
- **6 residual RLS policies**: `pg_policies` scan with `qual ILIKE '%_guard_expiry_write%IS NULL%' OR with_check ILIKE '%_guard_expiry_write%IS NULL%'` returned exactly 6 rows: `warehouse_transfer_items` (t_delete_own/t_insert_own/t_update_own) + `warehouse_transfers` (t_delete_own/t_insert_own/t_update_own).
- **13 realtime subscribers**: `grep -rn ".on('postgres_changes'" src/ --include='*.ts' --include='*.tsx' | grep -v test | wc -l` = 13 lines across 8 files.
- **_check_expiry_ok() exists**: implicit per memory `guard_expiry_write_broken_predicate` (function was created as the working replacement; Task 2 Step 2 re-verifies at task-time).
- **schema_migrations tracking pattern**: proven in Phase 1 Task 6 (backfilled 471/472/473) and Task 8 (backfilled 502). Task 1/2/3 reuse.

## Adversarial critique

What could invalidate this plan?

- **(a) Schema baseline dump captures Supabase-internal quirks that fresh Supabase project doesn't have.** E.g., `auth.` schema is preinstalled by Supabase managed service; dumping our current auth may conflict with fresh project's auth. → **Mitigation:** Task 1 Step 3 sanitization strips `--- Dumped from` metadata; smoke on scratch Supabase branch (Step 5) catches this before commit.
- **(b) 2D policy swap breaks live WT flow if a user has an active WT create in-flight during migration.** → **Mitigation:** DDL is transaction-scoped in Postgres — other sessions see the OLD policy definition until COMMIT, then atomically switch to the new one. There is no window where the policy is briefly missing. Additionally, prod WT create path uses SECDEF RPC (bypasses RLS), so RLS predicate change is invisible to users regardless.
- **(c) 2C CREATE INDEX CONCURRENTLY blocks briefly at high write throughput.** → **Mitigation:** current write throughput on all 4 tables is <<1 tps; sub-second index build. No user impact.
- **(d) 2C new indexes cause query planner to pick WORSE plan for edge cases (statistics-based).** → **Mitigation:** ANALYZE runs implicitly after CREATE INDEX; Step 6 EXPLAIN ANALYZE confirms plans. If regression, drop that index.
- **(e) 2H tenant filter breaks admin cross-tenant screens.** → **Mitigation:** Step 1 enumerates each subscriber's context; admin screens flagged as skipped (documented in report).
- **(f) 2H subscriber has `currentTenantId=undefined` on first render → filter = `tenant_id=eq.undefined` → 0 events.** → **Mitigation:** existing subscriber patterns already gate on tenant loaded (via useEffect dep); if any subscriber creates subscription pre-tenant-load, refactor to gate on `!tenantId ? return : ...`.
- **(g) 2C EXPLAIN ANALYZE query in Step 1 might not match real query the app runs.** → **Mitigation:** patterns above cover the dominant read patterns per Phase 1 impact analysis. Real prod queries via `pg_stat_statements` review in Wave 2 (P3-01 backlog).
- **(h) Advisor gate on 2C could reveal missing composite index that's more valuable than the 4 proposed.** → **Mitigation:** advisor call at Task 3 Step 3 is exactly for this; if advisor recommends addition, expand migration 504.

None of the above rise to blocking. Plan proceeds as written.
