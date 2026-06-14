# Stok Opname Blind-Count + Conditional Approval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add blind-count (admin tidak lihat `system_qty_snapshot` saat input), conditional auto-commit (variance=0 langsung selesai), audit log untuk semua opname commits, dan witness configurability per tenant.

**Architecture:** Backend masking di RPC `fetch_opname_counts` (SECURITY DEFINER, default-deny). Submit RPC dual-branch: auto-commit kalau gates lulus, else jalur approval lama. New migrations sebagai file baru (Supabase append-only pattern). Frontend conditional rendering berdasarkan `isOwner && status === 'in_progress'`.

**Tech Stack:** Supabase Postgres (plpgsql), React 19 + TypeScript, Tailwind, vitest integration tests via `@supabase/supabase-js`.

**Spec reference:** `docs/superpowers/specs/2026-06-14-stok-opname-blind-count-design.md`

**Existing code anchors (sebelum mulai, baca file-file ini):**
- `supabase/migrations/20260607000011_stock_opname.sql` — schema
- `supabase/migrations/20260607000013_opname_count_submit.sql` — `record_opname_count`, `witness_acknowledge_opname`, `submit_opname_for_owner`
- `supabase/migrations/20260607000014_commit_opname.sql` — `commit_opname` (Owner approve path)
- `src/components/stok/StockOpnameSessionView.tsx` — session view UI
- `src/lib/supabaseClient.ts` — `fetchOpnameCounts`, `submitOpnameForOwner`, etc.
- `src/types.ts` — `OpnameCount`, `OpnameSession`, `PermissionSet`

---

## Phase A — Frontend null-tolerance (foundational, must deploy first)

### Task 1: Make `OpnameCount` fields nullable in types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Update `OpnameCount` interface**

Find `OpnameCount` in `src/types.ts` and change two fields:

```ts
export interface OpnameCount {
  sessionId: number;
  sku: string;
  warehouse: string;
  systemQtySnapshot: number | null;  // ← was: number
  countedQty: number | null;
  variance: number | null;            // ← was: number
  varianceValue: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS (any consumer accessing `c.systemQtySnapshot` or `c.variance` directly will need a null check; fix those in next task)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(stok): make OpnameCount system_qty/variance nullable for blind-count masking"
```

---

### Task 2: Update `supabaseClient.ts` mappers to pass through nulls

**Files:**
- Modify: `src/lib/supabaseClient.ts` (function `fetchOpnameCounts` around line 1627)

- [ ] **Step 1: Read existing `fetchOpnameCounts` to find the field mapper**

Run: `grep -n "fetchOpnameCounts\|systemQtySnapshot\|system_qty_snapshot" src/lib/supabaseClient.ts | head -20`
Expected: see the mapper that converts snake_case DB rows to camelCase OpnameCount objects.

- [ ] **Step 2: Update mapper to preserve null**

In `fetchOpnameCounts`, find the mapping for `system_qty_snapshot` and `variance`. Change from `row.system_qty_snapshot as number` to `row.system_qty_snapshot as number | null` (or however nulls are propagated). Same for `variance`.

Example shape (adjust to existing code style):
```ts
return rows.map(row => ({
  sessionId: row.session_id,
  sku: row.sku,
  warehouse: row.warehouse,
  systemQtySnapshot: row.system_qty_snapshot ?? null,
  countedQty: row.counted_qty ?? null,
  variance: row.variance ?? null,
  varianceValue: Number(row.variance_value ?? 0),
}));
```

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(stok): preserve null system_qty/variance from fetchOpnameCounts"
```

---

### Task 3: Make `StockOpnameSessionView` gracefully render null fields

**Files:**
- Modify: `src/components/stok/StockOpnameSessionView.tsx`

- [ ] **Step 1: Find the variance-rendering and system-display locations**

Run: `grep -n "systemQtySnapshot\|varianceValue\|c\.variance\b" src/components/stok/StockOpnameSessionView.tsx`
Expected: lines around 287 (header `totalVariance`), 349 (`Sistem {c.systemQtySnapshot}`), 362-370 (variance Rp).

- [ ] **Step 2: Update `totalVariance` calculation to skip nulls**

Find the `totalVariance` derivation (typically `counts.reduce(...)`). Change to:

```tsx
const totalVariance = useMemo(
  () => counts.reduce((sum, c) => sum + (c.varianceValue ?? 0), 0),
  [counts]
);
```

If counts contain nulls, `?? 0` makes the sum safe (already 0 by mockup behavior).

- [ ] **Step 3: Update `Sistem {c.systemQtySnapshot}` to handle null**

Find the `<div className="col-span-3 text-xs text-slate-500">Sistem ...</div>` block. Wrap:

```tsx
<div className="col-span-3 text-xs text-slate-500">
  Sistem <span className="text-slate-800 font-medium">{c.systemQtySnapshot ?? '—'}</span>
</div>
```

- [ ] **Step 4: Update variance display to handle null**

Find the col-span-4 variance Rp block:

```tsx
<div className={`col-span-4 text-right font-semibold ${
  (c.varianceValue ?? 0) < 0 ? 'text-rose-600'
  : (c.varianceValue ?? 0) > 0 ? 'text-emerald-700'
  : 'text-slate-400'
}`}>
  {c.countedQty !== null && c.countedQty !== undefined
    ? formatRpDelta(c.varianceValue ?? 0)
    : '—'}
</div>
```

- [ ] **Step 5: Smoke test (manual) — verify nothing broken**

Open an existing in_progress session in dev. Verify counts render with no console errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/stok/StockOpnameSessionView.tsx
git commit -m "feat(stok): null-tolerate system_qty/variance in opname session view"
```

---

## Phase B — Backend RPC masking + re-ack on edit

### Task 4: Migration A — `fetch_opname_counts` + `get_opname_session` masking

**Files:**
- Create: `supabase/migrations/20260614000001_opname_blind_count_fetch_mask.sql`
- Create: `tests/integration/opname-blind-count.test.ts`

- [ ] **Step 1: Create migration file (per spec §4.1)**

```sql
-- Stok Opname Blind-Count Phase B Task 4:
-- fetch_opname_counts + get_opname_session masking.
--
-- When caller is NOT 'Owner' AND session.status='in_progress', return NULL
-- for system_qty_snapshot, variance, and variance_value. Counted_qty stays
-- visible (admin is allowed to see what they typed). Once status flips out
-- of in_progress, all fields return as normal — counts are frozen and
-- transparency post-input is the MSME design intent.
--
-- Default-deny: if admin_users role lookup returns NULL/error, the COALESCE
-- compares with '' which never equals 'Owner', so mask kicks in. A misconfig
-- defaults to MORE privacy, not less.

CREATE OR REPLACE FUNCTION public.fetch_opname_counts(p_session_id BIGINT)
RETURNS TABLE (
  session_id          BIGINT,
  sku                 TEXT,
  warehouse           TEXT,
  system_qty_snapshot INTEGER,
  counted_qty         INTEGER,
  variance            INTEGER,
  variance_value      NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_status public.opname_status;
  v_caller_role    TEXT;
  v_mask           BOOLEAN;
BEGIN
  SELECT status INTO v_session_status
    FROM stock_opname_sessions WHERE id = p_session_id;

  SELECT role INTO v_caller_role
    FROM admin_users WHERE id = auth.uid();

  v_mask := (v_session_status = 'in_progress'
             AND COALESCE(v_caller_role, '') <> 'Owner');

  RETURN QUERY
    SELECT
      c.session_id, c.sku, c.warehouse,
      CASE WHEN v_mask THEN NULL ELSE c.system_qty_snapshot END,
      c.counted_qty,
      CASE WHEN v_mask THEN NULL ELSE c.variance END,
      CASE WHEN v_mask THEN 0::NUMERIC ELSE c.variance_value END
    FROM stock_opname_counts c
    WHERE c.session_id = p_session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.fetch_opname_counts(BIGINT) TO authenticated;

-- Get_opname_session: mask variance_total_value with same logic.
-- During in_progress the column is 0 anyway (only filled at submit), so
-- this is consistency more than information protection.
CREATE OR REPLACE FUNCTION public.get_opname_session(p_session_id BIGINT)
RETURNS TABLE (
  id                      BIGINT,
  opname_type             public.opname_type,
  scope_payload           JSONB,
  counted_by_user_id      UUID,
  witnessed_by_user_id    UUID,
  witness_acknowledged_at TIMESTAMPTZ,
  status                  public.opname_status,
  variance_total_value    NUMERIC,
  approval_request_id     BIGINT,
  started_at              TIMESTAMPTZ,
  submitted_at            TIMESTAMPTZ,
  committed_at            TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_mask        BOOLEAN;
BEGIN
  SELECT role INTO v_caller_role FROM admin_users WHERE id = auth.uid();

  RETURN QUERY
    SELECT
      s.id, s.opname_type, s.scope_payload,
      s.counted_by_user_id, s.witnessed_by_user_id,
      s.witness_acknowledged_at, s.status,
      CASE
        WHEN s.status = 'in_progress' AND COALESCE(v_caller_role,'') <> 'Owner'
        THEN 0::NUMERIC
        ELSE s.variance_total_value
      END,
      s.approval_request_id, s.started_at, s.submitted_at, s.committed_at
    FROM stock_opname_sessions s
    WHERE s.id = p_session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_opname_session(BIGINT) TO authenticated;
```

- [ ] **Step 2: Write failing test**

Create `tests/integration/opname-blind-count.test.ts`:

```ts
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY!;

let svc: SupabaseClient;          // service role for setup
let sessionId: number;
let testSku: string;
let counterId: string;
let witnessId: string;
let ownerId: string;
let warehouseAtas: string;

beforeAll(async () => {
  svc = createClient(SUPABASE_URL, SERVICE_KEY);

  // Pick existing warehouse
  const { data: whs } = await svc.from('warehouses').select('id, code').is('tenant_id', null);
  warehouseAtas = whs!.find(w => w.code === 'ATAS')!.id;

  // Need three admin_users: Owner, two staff
  const { data: users } = await svc.from('admin_users').select('id, role').limit(20);
  ownerId   = users!.find(u => u.role === 'Owner')!.id;
  counterId = users!.find(u => u.role !== 'Owner')!.id;
  witnessId = users!.filter(u => u.role !== 'Owner' && u.id !== counterId)[0].id;

  // Seed SKU with stock 25
  testSku = `QA-OPNMASK-${Date.now()}`;
  await svc.from('stocks').insert({
    sku: testSku, name: 'QA mask test', category: 'QA',
    price: 1000, harga_modal: 1000, stock: 0, status: 'Sinkron',
  });
  await svc.from('stock_levels').insert({ sku: testSku, warehouse_id: warehouseAtas, qty: 25 });

  // Start opname
  const { data: sess } = await svc.rpc('start_opname_session', {
    p_opname_type: 'per_sku_list',
    p_scope_payload: { skus: [testSku] },
    p_counter_user_id: counterId,
    p_witness_user_id: witnessId,
  });
  sessionId = sess as number;
});

afterAll(async () => {
  await svc.from('stock_opname_counts').delete().eq('session_id', sessionId);
  await svc.from('stock_opname_sessions').delete().eq('id', sessionId);
  await svc.from('stock_levels').delete().eq('sku', testSku);
  await svc.from('stocks').delete().eq('sku', testSku);
});

describe('fetch_opname_counts masking', () => {
  test('service role caller during in_progress sees full data', async () => {
    const { data, error } = await svc.rpc('fetch_opname_counts', { p_session_id: sessionId });
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data![0].system_qty_snapshot).toBe(25);
  });

  // NOTE: testing per-role auth requires signed-in clients. Service role
  // bypasses RLS. This is documented as a manual smoke test (Task 17).
});
```

- [ ] **Step 3: Run test BEFORE migration applied**

Run: `npm test tests/integration/opname-blind-count.test.ts`
Expected: FAIL — `fetch_opname_counts` does not exist OR returns wrong shape.

- [ ] **Step 4: Apply migration locally**

Run: `npx supabase db reset` (or apply via your preferred method)
Expected: migration applied without error.

- [ ] **Step 5: Run test again**

Run: `npm test tests/integration/opname-blind-count.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260614000001_opname_blind_count_fetch_mask.sql tests/integration/opname-blind-count.test.ts
git commit -m "feat(stok): mask system_qty/variance in fetch_opname_counts for non-Owner during in_progress"
```

---

### Task 5: Migration C — `record_opname_count` invalidate witness ack on edit

**Files:**
- Create: `supabase/migrations/20260614000002_opname_reack_on_edit.sql`
- Modify: `tests/integration/opname-blind-count.test.ts` (add reack test block)

- [ ] **Step 1: Create migration**

```sql
-- Stok Opname Blind-Count Phase B Task 5:
-- record_opname_count invalidates witness_acknowledged_at when counter
-- edits AFTER witness has already acked.
--
-- Rationale: witness signed off on what they saw counter type. If counter
-- changes the number afterwards, witness must re-confirm. Two-person rule
-- compromise mitigated. Especially important with auto-commit path where
-- Owner is no longer the third pair of eyes.

CREATE OR REPLACE FUNCTION public.record_opname_count(
  p_session_id     BIGINT,
  p_sku            TEXT,
  p_warehouse      TEXT,
  p_counted_qty    INT,
  p_actor_user_id  UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_hpp NUMERIC;
BEGIN
  SELECT * INTO v_session FROM public.stock_opname_sessions
   WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'opname session % not found', p_session_id; END IF;

  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'opname session % is not in_progress (status=%)',
      p_session_id, v_session.status;
  END IF;

  IF p_actor_user_id <> v_session.counted_by_user_id
     AND p_actor_user_id <> v_session.witnessed_by_user_id THEN
    RAISE EXCEPTION 'caller % is neither counter nor witness for session %',
      p_actor_user_id, p_session_id;
  END IF;

  SELECT COALESCE(harga_modal, 0) INTO v_hpp FROM public.stocks WHERE sku = p_sku;

  UPDATE public.stock_opname_counts
     SET counted_qty    = p_counted_qty,
         variance_value = (COALESCE(p_counted_qty, 0) - system_qty_snapshot) * v_hpp
   WHERE session_id = p_session_id
     AND sku        = p_sku
     AND warehouse  = p_warehouse;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no opname count row for session=% sku=% warehouse=%',
      p_session_id, p_sku, p_warehouse;
  END IF;

  -- NEW: invalidate witness ack if it was already set. Witness must re-ack
  -- after counter edits.
  IF v_session.witness_acknowledged_at IS NOT NULL THEN
    UPDATE public.stock_opname_sessions
       SET witness_acknowledged_at = NULL
     WHERE id = p_session_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.record_opname_count(BIGINT, TEXT, TEXT, INT, UUID)
  TO authenticated;
```

- [ ] **Step 2: Add test (append to `opname-blind-count.test.ts`)**

```ts
describe('record_opname_count invalidates witness ack on edit', () => {
  test('edit after ack clears witness_acknowledged_at', async () => {
    // Witness ack first
    await svc.rpc('witness_acknowledge_opname', {
      p_session_id: sessionId, p_actor_user_id: witnessId,
    });
    const { data: before } = await svc.from('stock_opname_sessions')
      .select('witness_acknowledged_at').eq('id', sessionId).single();
    expect(before!.witness_acknowledged_at).not.toBeNull();

    // Counter edits count
    await svc.rpc('record_opname_count', {
      p_session_id: sessionId,
      p_sku: testSku,
      p_warehouse: 'atas',
      p_counted_qty: 24,
      p_actor_user_id: counterId,
    });

    // Ack should be reset
    const { data: after } = await svc.from('stock_opname_sessions')
      .select('witness_acknowledged_at').eq('id', sessionId).single();
    expect(after!.witness_acknowledged_at).toBeNull();
  });
});
```

- [ ] **Step 3: Run test BEFORE migration applied**

Run: `npm test tests/integration/opname-blind-count.test.ts -t "edit after ack"`
Expected: FAIL — witness_acknowledged_at still set after record.

- [ ] **Step 4: Apply migration + run test**

Run: `npx supabase db reset && npm test tests/integration/opname-blind-count.test.ts -t "edit after ack"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260614000002_opname_reack_on_edit.sql tests/integration/opname-blind-count.test.ts
git commit -m "feat(stok): invalidate witness ack when counter edits counted_qty"
```

---

## Phase C — Auto-commit branching

### Task 6: Migration B — `submit_opname_for_owner` auto-commit branch + `commit_opname_internal` helper

**Files:**
- Create: `supabase/migrations/20260614000003_opname_submit_auto_commit.sql`
- Create: `tests/integration/opname-auto-commit.test.ts`

- [ ] **Step 1: Create migration**

```sql
-- Stok Opname Blind-Count Phase C Task 6:
-- submit_opname_for_owner dual-branch + commit_opname_internal helper.
--
-- Auto-commit (selesai_otomatis): all rows have counted_qty NOT NULL AND
-- variance=0 AND witness has acked. Then session goes straight from
-- in_progress → committed. No stock_movements (all deltas are zero), no
-- approval_requests row. audit_log entry 'opname_auto_commit' written.
--
-- Pending owner (existing path): any NULL counted_qty OR any variance≠0.
-- approval_requests row created exactly as before.
--
-- Empty session: row_count=0 → reject. Defense in depth; UI already guards.
--
-- Return shape: TABLE(status TEXT, auto BOOLEAN, approval_id BIGINT). Old
-- signature returned BIGINT (approval_id). Frontend client gets updated in
-- task 7 to read new shape.

CREATE OR REPLACE FUNCTION public.commit_opname_internal(
  p_session_id BIGINT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session       RECORD;
  v_counter_name  TEXT;
  v_witness_name  TEXT;
  v_row_count     INT;
BEGIN
  SELECT * INTO v_session FROM stock_opname_sessions
   WHERE id = p_session_id FOR UPDATE;

  SELECT COUNT(*) INTO v_row_count FROM stock_opname_counts WHERE session_id = p_session_id;

  -- Flip status
  UPDATE stock_opname_sessions
     SET status = 'committed', committed_at = now()
   WHERE id = p_session_id;

  -- Audit log — names resolved from admin_users (NULL-safe for witness)
  SELECT name INTO v_counter_name FROM admin_users WHERE id = v_session.counted_by_user_id;
  SELECT name INTO v_witness_name FROM admin_users WHERE id = v_session.witnessed_by_user_id;

  INSERT INTO audit_log (event_type, actor_user_id, payload)
  VALUES (
    'opname_auto_commit',
    v_session.counted_by_user_id,
    jsonb_build_object(
      'session_id',         p_session_id,
      'counter_user_id',    v_session.counted_by_user_id,
      'counter_name',       v_counter_name,
      'witness_user_id',    v_session.witnessed_by_user_id,
      'witness_name',       v_witness_name,
      'row_count',          v_row_count,
      'total_variance_value', 0
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.commit_opname_internal(BIGINT) TO authenticated;


CREATE OR REPLACE FUNCTION public.submit_opname_for_owner(
  p_session_id     BIGINT,
  p_actor_user_id  UUID
) RETURNS TABLE (status TEXT, auto BOOLEAN, approval_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session         RECORD;
  v_variance_total  NUMERIC := 0;
  v_approval_id     BIGINT;
  v_row_count       INT;
  v_has_null        BOOLEAN;
  v_has_variance    BOOLEAN;
BEGIN
  SELECT * INTO v_session FROM stock_opname_sessions
   WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'opname session % not found', p_session_id; END IF;

  IF v_session.status <> 'in_progress' THEN
    RAISE EXCEPTION 'opname session % is not in_progress (status=%)',
      p_session_id, v_session.status;
  END IF;

  IF p_actor_user_id <> v_session.counted_by_user_id THEN
    RAISE EXCEPTION 'caller % is not the assigned counter for session %',
      p_actor_user_id, p_session_id;
  END IF;

  IF v_session.witness_acknowledged_at IS NULL THEN
    RAISE EXCEPTION 'witness has not acknowledged session %', p_session_id;
  END IF;

  -- Row count guard (defense in depth)
  SELECT COUNT(*) INTO v_row_count FROM stock_opname_counts WHERE session_id = p_session_id;
  IF v_row_count = 0 THEN
    RAISE EXCEPTION 'opname session % has no rows to count', p_session_id;
  END IF;

  -- Gate check for auto-commit
  SELECT EXISTS(SELECT 1 FROM stock_opname_counts
                 WHERE session_id = p_session_id AND counted_qty IS NULL)
    INTO v_has_null;
  SELECT EXISTS(SELECT 1 FROM stock_opname_counts
                 WHERE session_id = p_session_id AND variance <> 0)
    INTO v_has_variance;

  IF NOT v_has_null AND NOT v_has_variance THEN
    -- AUTO-COMMIT path
    PERFORM public.commit_opname_internal(p_session_id);
    RETURN QUERY SELECT 'committed'::TEXT, TRUE, NULL::BIGINT;
    RETURN;
  END IF;

  -- PENDING_OWNER path (existing logic, unchanged)
  SELECT COALESCE(SUM(variance_value), 0) INTO v_variance_total
    FROM stock_opname_counts WHERE session_id = p_session_id;

  INSERT INTO approval_requests (request_type, payload, requested_by)
  VALUES (
    'opname',
    jsonb_build_object(
      'session_id',           p_session_id,
      'variance_total_value', v_variance_total,
      'counted_by_user_id',   v_session.counted_by_user_id,
      'witnessed_by_user_id', v_session.witnessed_by_user_id
    ),
    v_session.counted_by_user_id
  )
  RETURNING id INTO v_approval_id;

  UPDATE stock_opname_sessions
     SET status = 'pending_owner',
         submitted_at = now(),
         variance_total_value = v_variance_total,
         approval_request_id = v_approval_id
   WHERE id = p_session_id;

  RETURN QUERY SELECT 'pending_owner'::TEXT, FALSE, v_approval_id;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_opname_for_owner(BIGINT, UUID) TO authenticated;
```

- [ ] **Step 2: Write failing tests**

Create `tests/integration/opname-auto-commit.test.ts`:

```ts
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;

let svc: SupabaseClient;
let testSku: string;
let counterId: string;
let witnessId: string;
let warehouseAtas: string;

beforeAll(async () => {
  svc = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: whs } = await svc.from('warehouses').select('id, code').is('tenant_id', null);
  warehouseAtas = whs!.find(w => w.code === 'ATAS')!.id;
  const { data: users } = await svc.from('admin_users').select('id, role').limit(20);
  counterId = users!.find(u => u.role !== 'Owner')!.id;
  witnessId = users!.filter(u => u.role !== 'Owner' && u.id !== counterId)[0].id;
  testSku = `QA-OPNAUTO-${Date.now()}`;
  await svc.from('stocks').insert({
    sku: testSku, name: 'QA auto-commit', category: 'QA',
    price: 1000, harga_modal: 500, stock: 0, status: 'Sinkron',
  });
  await svc.from('stock_levels').insert({ sku: testSku, warehouse_id: warehouseAtas, qty: 10 });
});

afterAll(async () => {
  await svc.from('stocks').delete().eq('sku', testSku);
  await svc.from('stock_levels').delete().eq('sku', testSku);
});

async function freshSession(): Promise<number> {
  const { data: id } = await svc.rpc('start_opname_session', {
    p_opname_type: 'per_sku_list',
    p_scope_payload: { skus: [testSku] },
    p_counter_user_id: counterId,
    p_witness_user_id: witnessId,
  });
  return id as number;
}

describe('submit_opname_for_owner branching', () => {
  test('all counted_qty match → auto-commit, status=committed, audit_log row', async () => {
    const sid = await freshSession();
    await svc.rpc('record_opname_count', {
      p_session_id: sid, p_sku: testSku, p_warehouse: 'atas',
      p_counted_qty: 10, p_actor_user_id: counterId,
    });
    await svc.rpc('witness_acknowledge_opname', {
      p_session_id: sid, p_actor_user_id: witnessId,
    });
    const { data, error } = await svc.rpc('submit_opname_for_owner', {
      p_session_id: sid, p_actor_user_id: counterId,
    });
    expect(error).toBeNull();
    expect(data![0].status).toBe('committed');
    expect(data![0].auto).toBe(true);
    expect(data![0].approval_id).toBeNull();

    // Session status committed
    const { data: sess } = await svc.from('stock_opname_sessions')
      .select('status').eq('id', sid).single();
    expect(sess!.status).toBe('committed');

    // Audit log row written
    const { data: audit } = await svc.from('audit_log')
      .select('payload').eq('event_type', 'opname_auto_commit')
      .order('id', { ascending: false }).limit(1);
    expect((audit![0].payload as any).session_id).toBe(sid);
  });

  test('variance != 0 → pending_owner, approval_request created', async () => {
    const sid = await freshSession();
    await svc.rpc('record_opname_count', {
      p_session_id: sid, p_sku: testSku, p_warehouse: 'atas',
      p_counted_qty: 8, p_actor_user_id: counterId,
    });
    await svc.rpc('witness_acknowledge_opname', {
      p_session_id: sid, p_actor_user_id: witnessId,
    });
    const { data } = await svc.rpc('submit_opname_for_owner', {
      p_session_id: sid, p_actor_user_id: counterId,
    });
    expect(data![0].status).toBe('pending_owner');
    expect(data![0].auto).toBe(false);
    expect(data![0].approval_id).not.toBeNull();
  });

  test('counted_qty NULL → pending_owner (not auto-commit)', async () => {
    const sid = await freshSession();
    // No record_opname_count call → counted_qty stays NULL
    await svc.rpc('witness_acknowledge_opname', {
      p_session_id: sid, p_actor_user_id: witnessId,
    });
    const { data } = await svc.rpc('submit_opname_for_owner', {
      p_session_id: sid, p_actor_user_id: counterId,
    });
    expect(data![0].status).toBe('pending_owner');
    expect(data![0].auto).toBe(false);
  });

  test('witness not acked → reject', async () => {
    const sid = await freshSession();
    await svc.rpc('record_opname_count', {
      p_session_id: sid, p_sku: testSku, p_warehouse: 'atas',
      p_counted_qty: 10, p_actor_user_id: counterId,
    });
    const { error } = await svc.rpc('submit_opname_for_owner', {
      p_session_id: sid, p_actor_user_id: counterId,
    });
    expect(error?.message).toMatch(/witness/i);
  });
});
```

- [ ] **Step 3: Run tests BEFORE migration applied**

Run: `npm test tests/integration/opname-auto-commit.test.ts`
Expected: FAIL on `auto` field shape OR audit_log row.

- [ ] **Step 4: Apply migration + run tests**

Run: `npx supabase db reset && npm test tests/integration/opname-auto-commit.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260614000003_opname_submit_auto_commit.sql tests/integration/opname-auto-commit.test.ts
git commit -m "feat(stok): submit_opname auto-commit branch when variance=0 across all rows"
```

---

### Task 7: Update `submitOpnameForOwner` client to new return shape + frontend toast variants

**Files:**
- Modify: `src/lib/supabaseClient.ts` (`submitOpnameForOwner` around line 1568)
- Modify: `src/components/stok/StockOpnameSessionView.tsx` (`onSubmit` around line 219)

- [ ] **Step 1: Update client return type**

Find `submitOpnameForOwner` in supabaseClient.ts. Change signature:

```ts
export async function submitOpnameForOwner(
  sessionId: number,
  actorUserId: string,
): Promise<{ status: 'committed' | 'pending_owner'; auto: boolean; approvalId: number | null }> {
  const { data, error } = await supabase.rpc('submit_opname_for_owner', {
    p_session_id: sessionId,
    p_actor_user_id: actorUserId,
  });
  if (error) throw error;
  const row = (data as any[])[0];
  return {
    status: row.status,
    auto: row.auto,
    approvalId: row.approval_id,
  };
}
```

- [ ] **Step 2: Update `onSubmit` toast variants in `StockOpnameSessionView.tsx`**

Find `onSubmit` (around line 219). Replace toast logic:

```tsx
const onSubmit = async () => {
  if (!currentUser) return;
  if (filledCount === 0) {
    showToast('Belum ada count yang diisi', 'warning');
    return;
  }
  setBusy('submit');
  try {
    const result = await submitOpnameForOwner(sessionId, currentUser.id);
    if (result.auto) {
      showToast('Sesi selesai — semua cocok dengan sistem (Selesai Otomatis)', 'success');
    } else {
      showToast('Sesi dikirim ke Owner untuk persetujuan', 'success');
    }
    onClose();
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e), 'warning');
  } finally {
    setBusy(null);
  }
};
```

- [ ] **Step 3: TypeScript compile + manual smoke**

Run: `npx tsc --noEmit`
Manual: login dev, create opname, submit with all-match → toast "Selesai Otomatis"; submit with variance → toast "dikirim ke Owner".

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabaseClient.ts src/components/stok/StockOpnameSessionView.tsx
git commit -m "feat(stok): submit returns {status,auto} + toast variants for auto-commit vs owner approval"
```

---

### Task 8: Migration D — `commit_opname` + reject path write to audit_log

**Files:**
- Create: `supabase/migrations/20260614000004_opname_audit_log_events.sql`
- Create: `tests/integration/opname-audit-log.test.ts`

- [ ] **Step 1: Find existing reject RPC**

Run: `grep -rn "request_type.*opname\|reject_approval\|approval.*reject" supabase/migrations/ | grep -i "reject\|deny" | head -5`
Expected: existing approval reject is `reject_approval(p_approval_id, p_reason, p_actor)` in `20260607000007_approval_requests.sql` (verify path).

- [ ] **Step 2: Create migration**

```sql
-- Stok Opname Blind-Count Phase C Task 8:
-- audit_log entries for commit_opname and reject_opname paths.
--
-- Auto-commit path already writes 'opname_auto_commit' via
-- commit_opname_internal (Task 6 migration). This task adds parallel
-- entries for owner-driven paths:
--   commit_opname  → 'opname_owner_commit'
--   reject path    → 'opname_owner_reject'
--
-- Approach: wrap existing RPCs by appending audit_log INSERT at the end of
-- the success branch. We do NOT modify the existing logic of commit/reject
-- (avoid scope creep).

CREATE OR REPLACE FUNCTION public.commit_opname(
  p_approval_id BIGINT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session         RECORD;
  v_counter_name    TEXT;
  v_witness_name    TEXT;
  v_approver_name   TEXT;
  v_row_count       INT;
  v_affected_count  INT := 0;
  v_appr            RECORD;
BEGIN
  -- Existing logic (verify approval, walk session counts, write ledger, flip status).
  -- COPY exact body of existing commit_opname here from
  -- supabase/migrations/20260607000014_commit_opname.sql lines 50-end,
  -- preserving every SELECT/UPDATE/INSERT. Then append the audit_log block
  -- shown below before the final RETURN.

  -- (... existing body ...)

  -- After session UPDATE status='committed' but before RETURN: write audit_log.
  SELECT * INTO v_session FROM stock_opname_sessions WHERE id = (
    SELECT (payload->>'session_id')::BIGINT FROM approval_requests WHERE id = p_approval_id
  );
  SELECT name INTO v_counter_name FROM admin_users WHERE id = v_session.counted_by_user_id;
  SELECT name INTO v_witness_name FROM admin_users WHERE id = v_session.witnessed_by_user_id;
  SELECT name INTO v_approver_name FROM admin_users WHERE id = auth.uid();
  SELECT COUNT(*) INTO v_row_count FROM stock_opname_counts WHERE session_id = v_session.id;

  INSERT INTO audit_log (event_type, actor_user_id, payload)
  VALUES (
    'opname_owner_commit',
    auth.uid(),
    jsonb_build_object(
      'session_id',           v_session.id,
      'counter_user_id',      v_session.counted_by_user_id,
      'counter_name',         v_counter_name,
      'witness_user_id',      v_session.witnessed_by_user_id,
      'witness_name',         v_witness_name,
      'approved_by_user_id',  auth.uid(),
      'approved_by_name',     v_approver_name,
      'row_count',            v_row_count,
      'total_variance_value', v_session.variance_total_value
    )
  );

  RETURN v_affected_count;
END $$;

-- Reject path: hook into existing reject_approval OR add explicit reject_opname
-- wrapper. If reject_approval is generic, we add a TRIGGER on approval_requests
-- status change that writes audit_log for opname-type requests.

CREATE OR REPLACE FUNCTION public._audit_opname_reject() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_session     RECORD;
  v_counter_name TEXT;
  v_witness_name TEXT;
  v_rejector_name TEXT;
  v_row_count    INT;
BEGIN
  -- Fire only when an approval_requests row transitions to 'rejected' for an
  -- opname-type request.
  IF NEW.status = 'rejected' AND OLD.status <> 'rejected' AND NEW.request_type = 'opname' THEN
    SELECT * INTO v_session FROM stock_opname_sessions
     WHERE id = (NEW.payload->>'session_id')::BIGINT;
    SELECT name INTO v_counter_name FROM admin_users WHERE id = v_session.counted_by_user_id;
    SELECT name INTO v_witness_name FROM admin_users WHERE id = v_session.witnessed_by_user_id;
    SELECT name INTO v_rejector_name FROM admin_users WHERE id = NEW.rejected_by;
    SELECT COUNT(*) INTO v_row_count FROM stock_opname_counts WHERE session_id = v_session.id;

    INSERT INTO audit_log (event_type, actor_user_id, payload)
    VALUES (
      'opname_owner_reject',
      NEW.rejected_by,
      jsonb_build_object(
        'session_id',           v_session.id,
        'counter_user_id',      v_session.counted_by_user_id,
        'counter_name',         v_counter_name,
        'witness_user_id',      v_session.witnessed_by_user_id,
        'witness_name',         v_witness_name,
        'rejected_by_user_id',  NEW.rejected_by,
        'rejected_by_name',     v_rejector_name,
        'rejection_reason',     NEW.rejection_reason,
        'row_count',            v_row_count,
        'total_variance_value', v_session.variance_total_value
      )
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_opname_reject ON public.approval_requests;
CREATE TRIGGER trg_audit_opname_reject
  AFTER UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION public._audit_opname_reject();
```

> **IMPORTANT:** Step 2 above has a placeholder `(... existing body ...)`. Before applying this migration, manually paste the body of existing `commit_opname` from `supabase/migrations/20260607000014_commit_opname.sql` into the new RPC, then append the audit_log block at the end of the success branch. DO NOT skip this — the existing ledger logic must be preserved.

- [ ] **Step 3: Write failing tests**

Create `tests/integration/opname-audit-log.test.ts`:

```ts
import { describe, test, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;

let svc: SupabaseClient;

beforeAll(async () => {
  svc = createClient(SUPABASE_URL, SERVICE_KEY);
});

describe('audit_log entries for opname commit/reject paths', () => {
  test('opname_owner_commit entry includes counter + witness names', async () => {
    // Setup: run full opname → submit variance → approve via approval flow.
    // Then assert audit_log has 'opname_owner_commit' row with names.
    // (Use the same fixture helpers from opname-auto-commit.test.ts)
    // ...
    const { data } = await svc.from('audit_log')
      .select('payload').eq('event_type', 'opname_owner_commit')
      .order('id', { ascending: false }).limit(1);
    expect(data!.length).toBeGreaterThan(0);
    const p = data![0].payload as any;
    expect(p.counter_name).toBeTruthy();
    expect(p.witness_name).toBeTruthy();
    expect(p.approved_by_name).toBeTruthy();
  });

  test('opname_owner_reject entry includes rejection_reason', async () => {
    // Setup: full opname → submit variance → reject via approval flow with reason.
    // ...
    const { data } = await svc.from('audit_log')
      .select('payload').eq('event_type', 'opname_owner_reject')
      .order('id', { ascending: false }).limit(1);
    const p = data![0].payload as any;
    expect(p.rejection_reason).toBeTruthy();
  });
});
```

- [ ] **Step 4: Apply migration + run tests**

Run: `npx supabase db reset && npm test tests/integration/opname-audit-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260614000004_opname_audit_log_events.sql tests/integration/opname-audit-log.test.ts
git commit -m "feat(stok): audit_log entries for commit/reject opname paths with counter+witness names"
```

---

## Phase D — Frontend blind-mode UI

### Task 9: Add `isBlindMode` derived state + conditional header

**Files:**
- Modify: `src/components/stok/StockOpnameSessionView.tsx`

- [ ] **Step 1: Add derived state at top of component**

Find the component body. Add after `useEffect`s:

```tsx
const isOwner = currentUser?.role === 'Owner';
const isBlindMode = session?.status === 'in_progress' && !isOwner;
```

- [ ] **Step 2: Conditional header right block (around line 286)**

Replace the existing `<div className="text-right">` block (totalVariance display):

```tsx
<div className="text-right">
  {isBlindMode ? (
    <>
      <span className="inline-block px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-700 border border-slate-300">
        🔒 Tanpa Lihat Sistem
      </span>
      <p className="text-xs text-slate-500 mt-2">Diisi: {filledCount}/{totalCount}</p>
    </>
  ) : (
    <>
      <p className="text-xs uppercase tracking-wide text-slate-500">Total Selisih</p>
      <p className={`font-bold text-xl ${totalVariance < 0 ? 'text-rose-600' : totalVariance > 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
        {formatRpDelta(totalVariance)}
      </p>
      <p className="text-xs text-slate-500 mt-1">Diisi: {filledCount}/{totalCount}</p>
    </>
  )}
</div>
```

- [ ] **Step 3: Manual smoke**

Login as admin → in_progress session → header shows badge. Login as Owner → same session → header shows "Total Selisih".

- [ ] **Step 4: Commit**

```bash
git add src/components/stok/StockOpnameSessionView.tsx
git commit -m "feat(stok): conditional opname header — blind badge for non-Owner during in_progress"
```

---

### Task 10: Conditional per-row grid layout (blind vs full)

**Files:**
- Modify: `src/components/stok/StockOpnameSessionView.tsx`

- [ ] **Step 1: Find the per-row grid block (around lines 340-372)**

Run: `grep -n "grid-cols-12 px-3 py-2 items-center border-t" src/components/stok/StockOpnameSessionView.tsx`
Expected: see the grid rendering Sistem + input + variance.

- [ ] **Step 2: Add column header row (above first row of each SKU group)**

Inside each SKU group card, BEFORE the `groupEntries.map`, insert a header row that adapts:

```tsx
{isBlindMode ? (
  <div className="grid grid-cols-12 px-3 py-1 items-center border-t border-slate-100 text-xs text-slate-400 uppercase tracking-wide bg-slate-50/50">
    <div className="col-span-3">Gudang</div>
    <div className="col-span-6 text-right pr-3">Stok Fisik (yang Anda hitung)</div>
    <div className="col-span-3"></div>
  </div>
) : (
  <div className="grid grid-cols-12 px-3 py-1 items-center border-t border-slate-100 text-xs text-slate-400 uppercase tracking-wide bg-slate-50/50">
    <div className="col-span-2">Gudang</div>
    <div className="col-span-3 text-right">Sistem</div>
    <div className="col-span-3 text-right">Fisik (input)</div>
    <div className="col-span-4 text-right">Selisih</div>
  </div>
)}
```

- [ ] **Step 3: Replace per-row grid with conditional layout**

Replace the existing inner grid (the one rendering Sistem + input + variance) with:

```tsx
{isBlindMode ? (
  <div className="grid grid-cols-12 px-3 py-2 items-center border-t border-slate-100 text-sm">
    <div className="col-span-3 text-xs uppercase tracking-wide text-slate-500">
      {warehouseName(wh)}
    </div>
    <div className="col-span-6 text-right">
      <input
        type="number"
        value={inputValue}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        onBlur={() => onBlurCount(c)}
        disabled={!isEditable || busy === key}
        className="border border-slate-300 rounded px-2 py-1 w-32 text-right text-sm disabled:bg-slate-50"
      />
    </div>
    <div className="col-span-3"></div>
  </div>
) : (
  <div className="grid grid-cols-12 px-3 py-2 items-center border-t border-slate-100 text-sm">
    <div className="col-span-2 text-xs uppercase tracking-wide text-slate-500">
      {warehouseName(wh)}
    </div>
    <div className="col-span-3 text-right text-slate-800 font-medium">
      {c.systemQtySnapshot ?? '—'}
    </div>
    <div className="col-span-3 text-right">
      <input
        type="number"
        value={inputValue}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        onBlur={() => onBlurCount(c)}
        disabled={!isEditable || busy === key}
        className="border border-slate-300 rounded px-2 py-1 w-20 text-right text-sm disabled:bg-slate-50"
      />
    </div>
    <div className={`col-span-4 text-right font-semibold ${
      (c.variance ?? 0) < 0 ? 'text-rose-600'
      : (c.variance ?? 0) > 0 ? 'text-emerald-700'
      : 'text-slate-400'
    }`}>
      {c.countedQty !== null && c.countedQty !== undefined
        ? <>{c.variance} <span className="text-xs font-normal">({formatRpDelta(c.varianceValue ?? 0)})</span></>
        : <span className="text-xs italic">belum dihitung</span>
      }
    </div>
  </div>
)}
```

- [ ] **Step 4: Manual smoke**

Login admin → cek kolom Sistem & Variance hilang, kolom header "Stok Fisik" tampak. Login Owner → cek 4 kolom dengan Selisih digabung `-1 (-Rp 25.000)`.

- [ ] **Step 5: Commit**

```bash
git add src/components/stok/StockOpnameSessionView.tsx
git commit -m "feat(stok): conditional grid — blind 3-col layout for admin, full 4-col with merged selisih for Owner"
```

---

### Task 11: Re-ack banner + bahasa updates

**Files:**
- Modify: `src/components/stok/StockOpnameSessionView.tsx`

- [ ] **Step 1: Add re-ack banner when witness ack was reset**

Track whether witness was previously acked and is now NULL (means counter edited after ack):

```tsx
const [prevAcked, setPrevAcked] = useState(false);
useEffect(() => {
  if (session?.witnessAcknowledgedAt) setPrevAcked(true);
}, [session?.witnessAcknowledgedAt]);

const ackInvalidated = prevAcked && !session?.witnessAcknowledgedAt;
```

Add banner near the action bar (in_progress only):

```tsx
{session?.status === 'in_progress' && ackInvalidated && (
  <div className="rounded bg-amber-50 border border-amber-300 px-3 py-2 text-sm text-amber-900">
    Counter mengubah angka — saksi perlu acknowledge ulang sebelum submit.
  </div>
)}
```

- [ ] **Step 2: Update submit button text + status pill labels**

Find `STATUS_LABEL`:
```tsx
const STATUS_LABEL: Record<OpnameSession['status'], string> = {
  in_progress: 'Berlangsung',
  pending_owner: 'Menunggu Persetujuan',  // was 'Menunggu Owner'
  committed: 'Selesai',
  rejected: 'Ditolak',
};
```

Find submit button label (around line 408): `'Kirim ke Owner untuk Commit'` → `'Kirim ke Owner untuk Disetujui'`.

Find committed banner (around line 419-422): `'Sesi sudah di-commit oleh Owner.'` → `'Sesi sudah disetujui Owner.'`

- [ ] **Step 3: Manual smoke**

Counter edits after witness ack → banner kuning muncul, witness tab → re-ack → banner hilang.

- [ ] **Step 4: Commit**

```bash
git add src/components/stok/StockOpnameSessionView.tsx
git commit -m "feat(stok): re-ack banner + bahasa update (Disetujui/Selesai/Menunggu Persetujuan)"
```

---

## Phase E — Witness configurability (tenant SOP)

### Task 12: Migration E1 — schema relax (witness nullable, conditional CHECK)

**Files:**
- Create: `supabase/migrations/20260614000005_opname_witness_optional_schema.sql`
- Create: `tests/integration/opname-witness-config.test.ts`

- [ ] **Step 1: Create migration**

```sql
-- Stok Opname Phase E Task 12:
-- Make witness optional at schema level so tenant SOP can vary.
-- Default app behavior remains witness-required via settings row added in
-- this same migration. RPCs will read the setting in Task 13.

ALTER TABLE public.stock_opname_sessions
  ALTER COLUMN witnessed_by_user_id DROP NOT NULL;

ALTER TABLE public.stock_opname_sessions
  DROP CONSTRAINT chk_two_person;

ALTER TABLE public.stock_opname_sessions
  ADD CONSTRAINT chk_two_person_when_witness_present
  CHECK (witnessed_by_user_id IS NULL
         OR counted_by_user_id <> witnessed_by_user_id);

-- Settings row. We use tenant_settings if it exists; otherwise app_settings.
-- Verify table name first; this migration assumes tenant_settings(key text PK,
-- value text, value_type text). Adjust column names if your schema differs.
INSERT INTO public.tenant_settings (key, value, value_type)
VALUES ('opname_require_witness', 'true', 'boolean')
ON CONFLICT (key) DO NOTHING;
```

> **IMPORTANT:** Before applying, run:
> `grep -rn "CREATE TABLE.*tenant_settings\|CREATE TABLE.*app_settings\|CREATE TABLE.*system_settings" supabase/migrations/ | head -5`
> If `tenant_settings` does not exist, create it first OR use an alternate existing settings table. Adjust the INSERT statement accordingly.

- [ ] **Step 2: Test schema relax**

Create `tests/integration/opname-witness-config.test.ts`:

```ts
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY!;

let svc: SupabaseClient;
let counterId: string;

beforeAll(async () => {
  svc = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: users } = await svc.from('admin_users').select('id, role').limit(5);
  counterId = users!.find(u => u.role !== 'Owner')!.id;
});

describe('schema: witness optional', () => {
  test('can insert session with NULL witness', async () => {
    const { error } = await svc.from('stock_opname_sessions').insert({
      opname_type: 'full',
      scope_payload: {},
      counted_by_user_id: counterId,
      witnessed_by_user_id: null,
    });
    expect(error).toBeNull();
    // cleanup
    await svc.from('stock_opname_sessions')
      .delete().eq('counted_by_user_id', counterId).is('witnessed_by_user_id', null);
  });

  test('default setting opname_require_witness=true exists', async () => {
    const { data } = await svc.from('tenant_settings')
      .select('value').eq('key', 'opname_require_witness').single();
    expect(data!.value).toBe('true');
  });
});
```

- [ ] **Step 3: Apply migration + run tests**

Run: `npx supabase db reset && npm test tests/integration/opname-witness-config.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260614000005_opname_witness_optional_schema.sql tests/integration/opname-witness-config.test.ts
git commit -m "feat(stok): relax witness schema + default opname_require_witness=true setting"
```

---

### Task 13: Migration E2 — RPCs read `opname_require_witness` setting

**Files:**
- Create: `supabase/migrations/20260614000006_opname_witness_optional_rpcs.sql`
- Modify: `tests/integration/opname-witness-config.test.ts` (add RPC tests)

- [ ] **Step 1: Create migration**

```sql
-- Stok Opname Phase E Task 13:
-- RPCs that branch on opname_require_witness setting.
-- Affected: start_opname_session, submit_opname_for_owner, witness_acknowledge_opname,
-- record_opname_count.
--
-- Helper to read boolean setting (consider extracting to a separate util migration
-- if not already present).

CREATE OR REPLACE FUNCTION public._setting_bool(p_key TEXT, p_default BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_val TEXT;
BEGIN
  SELECT value INTO v_val FROM tenant_settings WHERE key = p_key;
  RETURN COALESCE(v_val::BOOLEAN, p_default);
END $$;

GRANT EXECUTE ON FUNCTION public._setting_bool(TEXT, BOOLEAN) TO authenticated;

-- start_opname_session: allow witness NULL only when setting is FALSE.
-- COPY the existing body from 20260607000012_start_opname_session.sql and add
-- the conditional check right after parameter validation.

CREATE OR REPLACE FUNCTION public.start_opname_session(
  p_opname_type      public.opname_type,
  p_scope_payload    JSONB,
  p_counter_user_id  UUID,
  p_witness_user_id  UUID  -- now nullable from caller perspective
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_require_witness BOOLEAN;
  v_session_id      BIGINT;
BEGIN
  v_require_witness := public._setting_bool('opname_require_witness', TRUE);

  IF v_require_witness AND p_witness_user_id IS NULL THEN
    RAISE EXCEPTION 'witness is required (tenant setting opname_require_witness=true)';
  END IF;

  IF p_witness_user_id IS NOT NULL AND p_witness_user_id = p_counter_user_id THEN
    RAISE EXCEPTION 'counter and witness must be different users';
  END IF;

  -- (... PASTE the existing body of start_opname_session here from
  -- supabase/migrations/20260607000012_start_opname_session.sql, including
  -- the INSERT into stock_opname_sessions and stock_opname_counts. Replace
  -- the v_witness_user_id literal with p_witness_user_id so it can be NULL.)

  RETURN v_session_id;
END $$;

-- submit_opname_for_owner: skip witness ack gate when require_witness=FALSE.
-- We need to RE-DECLARE the function from Task 6 to add this branch.
-- COPY the body from migration 20260614000003 and replace the witness ack
-- check with:
--
--   IF public._setting_bool('opname_require_witness', TRUE)
--      AND v_session.witness_acknowledged_at IS NULL THEN
--     RAISE EXCEPTION 'witness has not acknowledged session %', p_session_id;
--   END IF;

CREATE OR REPLACE FUNCTION public.submit_opname_for_owner(
  p_session_id     BIGINT,
  p_actor_user_id  UUID
) RETURNS TABLE (status TEXT, auto BOOLEAN, approval_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
-- (... COPY body from Task 6 migration, replace witness ack check as shown above ...)
$$;

-- record_opname_count: skip re-ack invalidation when require_witness=FALSE
-- (there's no ack to invalidate). Same pattern: COPY body from Task 5 migration
-- and gate the ack-clear with the setting.
```

> **IMPORTANT:** Step 1 has placeholders `(... PASTE ...)` and `(... COPY ...)`. Before applying, manually paste the full bodies from the referenced earlier migrations and apply the noted conditional checks. The migration MUST be self-contained with complete bodies.

- [ ] **Step 2: Add RPC tests for witness=OFF mode**

Append to `tests/integration/opname-witness-config.test.ts`:

```ts
describe('RPCs respect opname_require_witness setting', () => {
  test('with setting=false: start_opname_session accepts NULL witness', async () => {
    await svc.from('tenant_settings').upsert({ key: 'opname_require_witness', value: 'false', value_type: 'boolean' });
    try {
      const { data, error } = await svc.rpc('start_opname_session', {
        p_opname_type: 'full',
        p_scope_payload: {},
        p_counter_user_id: counterId,
        p_witness_user_id: null,
      });
      expect(error).toBeNull();
      expect(data).toBeTruthy();
    } finally {
      await svc.from('tenant_settings').upsert({ key: 'opname_require_witness', value: 'true', value_type: 'boolean' });
    }
  });

  test('with setting=true: start_opname_session rejects NULL witness', async () => {
    const { error } = await svc.rpc('start_opname_session', {
      p_opname_type: 'full',
      p_scope_payload: {},
      p_counter_user_id: counterId,
      p_witness_user_id: null,
    });
    expect(error?.message).toMatch(/witness is required/i);
  });

  test('with setting=false: submit auto-commits without witness ack', async () => {
    // setup similar to auto-commit test but with setting OFF and NULL witness
    // ...
  });
});
```

- [ ] **Step 3: Apply migration + run tests**

Run: `npx supabase db reset && npm test tests/integration/opname-witness-config.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260614000006_opname_witness_optional_rpcs.sql tests/integration/opname-witness-config.test.ts
git commit -m "feat(stok): RPCs read opname_require_witness setting; single-operator opname allowed when off"
```

---

### Task 14: Pengaturan toggle UI

**Files:**
- Modify: `src/components/PengaturanScreen.tsx`

- [ ] **Step 1: Find existing settings rendering pattern**

Run: `grep -n "tenant_settings\|upsertSetting\|fetchSetting" src/lib/supabaseClient.ts | head -5`
Expected: existing setting client helpers OR use generic `supabase.from('tenant_settings')`.

- [ ] **Step 2: Add toggle in Pengaturan (Owner only)**

Find a section header like "Modul Stok" or add a new one. Insert:

```tsx
{currentUser.role === 'Owner' && (
  <section className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
    <h3 className="text-sm font-semibold text-slate-800">Modul Stok Opname</h3>
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={requireWitness}
        onChange={async (e) => {
          const v = e.target.checked;
          setRequireWitness(v);
          await supabase.from('tenant_settings').upsert({
            key: 'opname_require_witness',
            value: String(v),
            value_type: 'boolean',
          });
          showToast(`Saksi wajib: ${v ? 'AKTIF' : 'NONAKTIF'}`, 'success');
        }}
        className="mt-1"
      />
      <div>
        <div className="text-sm text-slate-800 font-medium">Wajibkan saksi saat opname</div>
        <div className="text-xs text-slate-500 mt-1">
          Saat aktif: setiap sesi butuh saksi (counter ≠ saksi), saksi acknowledge sebelum submit.
          Saat nonaktif: counter bisa kerja sendiri. Rekomendasi: AKTIF untuk toko dengan staff &gt; 1.
        </div>
      </div>
    </label>
  </section>
)}
```

Add state + initial load:

```tsx
const [requireWitness, setRequireWitness] = useState(true);
useEffect(() => {
  supabase.from('tenant_settings')
    .select('value').eq('key', 'opname_require_witness').single()
    .then(({ data }) => {
      if (data) setRequireWitness(data.value === 'true');
    });
}, []);
```

- [ ] **Step 3: Manual smoke**

Login Owner → Pengaturan → toggle off → reload → toggle still off. Login non-Owner → section tidak muncul.

- [ ] **Step 4: Commit**

```bash
git add src/components/PengaturanScreen.tsx
git commit -m "feat(stok): Pengaturan toggle for opname_require_witness (Owner-only)"
```

---

### Task 15: `StockOpnameScreen` conditional witness prompt at start

**Files:**
- Modify: `src/components/stok/StockOpnameScreen.tsx`

- [ ] **Step 1: Read existing start-session modal/UI**

Run: `grep -n "witness\|saksi\|start_opname_session" src/components/stok/StockOpnameScreen.tsx | head -20`
Expected: see the witness dropdown / form field.

- [ ] **Step 2: Add setting fetch + conditional render**

Add at top of component:

```tsx
const [requireWitness, setRequireWitness] = useState(true);
useEffect(() => {
  supabase.from('tenant_settings')
    .select('value').eq('key', 'opname_require_witness').single()
    .then(({ data }) => { if (data) setRequireWitness(data.value === 'true'); });
}, []);
```

Wrap witness dropdown with `{requireWitness && (...)}`. Update form submission to pass `witnessUserId: requireWitness ? witnessUserId : null`.

- [ ] **Step 3: Manual smoke**

Toggle off → start modal: no witness dropdown, can start. Toggle on → dropdown returns, required.

- [ ] **Step 4: Commit**

```bash
git add src/components/stok/StockOpnameScreen.tsx
git commit -m "feat(stok): skip witness prompt at session start when setting=false"
```

---

### Task 16: `StockOpnameSessionView` conditional witness UI

**Files:**
- Modify: `src/components/stok/StockOpnameSessionView.tsx`

- [ ] **Step 1: Add setting fetch derived state**

```tsx
const [requireWitness, setRequireWitness] = useState(true);
useEffect(() => {
  supabase.from('tenant_settings')
    .select('value').eq('key', 'opname_require_witness').single()
    .then(({ data }) => { if (data) setRequireWitness(data.value === 'true'); });
}, []);
```

- [ ] **Step 2: Conditional header info**

Wrap `Saksi: <b>...</b>` with `{requireWitness && (...)}`.

- [ ] **Step 3: Conditional "Saya Saksi" button**

Wrap the entire `<button onClick={onAcknowledge}>` block with `{requireWitness && (...)}`.

- [ ] **Step 4: Conditional submit gate**

Find `canSubmit` derivation. When `!requireWitness`, ignore `witnessAcked` requirement:

```tsx
const canSubmit = isCounter && (requireWitness ? witnessAcked : true) && session?.status === 'in_progress';
```

- [ ] **Step 5: Hide re-ack banner when witness disabled**

The `ackInvalidated` banner from Task 11 should only render when `requireWitness === true`:

```tsx
{requireWitness && session?.status === 'in_progress' && ackInvalidated && (
  <div className="rounded bg-amber-50 ...">Counter mengubah angka — saksi perlu acknowledge ulang sebelum submit.</div>
)}
```

- [ ] **Step 6: Manual smoke**

Setting off + counter solo → no witness UI, can submit without ack. Setting on → witness ack flow returns.

- [ ] **Step 7: Commit**

```bash
git add src/components/stok/StockOpnameSessionView.tsx
git commit -m "feat(stok): conditional witness UI in session view based on require_witness setting"
```

---

## Phase F — Pengawasan audit UI

### Task 17: `Catatan Audit Opname` table in Pengawasan

**Files:**
- Modify: existing Pengawasan screen file (find via `grep -rln "Pengawasan\|pengawasan" src/components/ | head -3`)
- Modify: `src/lib/supabaseClient.ts` (add `fetchOpnameAuditLog`)

- [ ] **Step 1: Add client helper**

In `supabaseClient.ts`:

```ts
export interface OpnameAuditEntry {
  id: number;
  eventType: 'opname_auto_commit' | 'opname_owner_commit' | 'opname_owner_reject';
  createdAt: string;
  sessionId: number;
  counterName: string | null;
  witnessName: string | null;
  totalVarianceValue: number;
  approvedByName?: string;
  rejectedByName?: string;
  rejectionReason?: string;
}

export async function fetchOpnameAuditLog(
  daysBack: number = 7,
): Promise<OpnameAuditEntry[]> {
  const since = new Date(Date.now() - daysBack * 86400_000).toISOString();
  const { data, error } = await supabase
    .from('audit_log')
    .select('id, event_type, created_at, payload')
    .in('event_type', ['opname_auto_commit', 'opname_owner_commit', 'opname_owner_reject'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map(row => {
    const p = row.payload as any;
    return {
      id: row.id,
      eventType: row.event_type,
      createdAt: row.created_at,
      sessionId: p.session_id,
      counterName: p.counter_name ?? null,
      witnessName: p.witness_name ?? null,
      totalVarianceValue: Number(p.total_variance_value ?? 0),
      approvedByName: p.approved_by_name,
      rejectedByName: p.rejected_by_name,
      rejectionReason: p.rejection_reason,
    };
  });
}
```

- [ ] **Step 2: Add table component in Pengawasan**

Per the mockup at `docs/superpowers/specs/2026-06-13-stok-opname-blind-count-mockup.html` "Catatan Audit Opname" section. Render columns: Waktu, Sesi#, Penghitung, Saksi, Total Selisih, Status. Use existing Pengawasan styling.

Status pill mapping:
- `opname_auto_commit` → "Selesai Otomatis" (emerald)
- `opname_owner_commit` → "Disetujui Owner" (blue)
- `opname_owner_reject` → "Ditolak" (rose)

Witness display: `entry.witnessName ?? '—'` (em-dash for solo sessions).

- [ ] **Step 3: Manual smoke**

Open Pengawasan → Catatan Audit Opname → see entries for last 7 days with 3 status types.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabaseClient.ts src/components/PengawasanScreen.tsx
git commit -m "feat(stok): Catatan Audit Opname table in Pengawasan with counter/witness names"
```

---

## Phase G — Final validation

### Task 18: Manual smoke per acceptance criteria

- [ ] **Step 1: Run full test suite**

Run: `npm test tests/integration/opname-*.test.ts`
Expected: all PASS.

- [ ] **Step 2: Manual smoke matrix (verify spec §14 acceptance criteria)**

Login as admin (non-Owner):
- [ ] Start sesi → tidak lihat Sistem / Selisih / Total ✓
- [ ] Column header "Stok Fisik (yang Anda hitung)" tampak ✓
- [ ] Badge "🔒 Tanpa Lihat Sistem" di header kanan ✓

Login as Owner:
- [ ] Buka sesi yang sama → semua angka tampil ✓
- [ ] Kolom Selisih digabung `-1 (-Rp 25.000)` ✓
- [ ] Total Selisih di header kanan ✓

Submit flows:
- [ ] Admin submit semua match → status langsung committed ✓
- [ ] Toast: "Sesi selesai — semua cocok dengan sistem (Selesai Otomatis)" ✓
- [ ] Admin submit dengan variance → status pending_owner ✓
- [ ] Toast: "Sesi dikirim ke Owner untuk persetujuan" ✓

Owner approval flow:
- [ ] Owner reject → status rejected, audit_log `opname_owner_reject` dengan reason ✓
- [ ] Owner commit → stock sistem disesuaikan ke fisik, audit_log `opname_owner_commit` ✓

Edit + re-ack:
- [ ] Counter edit setelah witness ack → witness_acknowledged_at reset, banner kuning muncul ✓
- [ ] Tombol submit di-disable sampai witness re-ack ✓

Defense:
- [ ] RPC reject empty session (via direct rpc call, row_count=0) ✓
- [ ] Curl/Postman with admin token → fetch_opname_counts returns null fields ✓

Audit table:
- [ ] Catatan Audit Opname di Pengawasan tampilkan 3 status (Selesai Otomatis, Disetujui Owner, Ditolak) ✓
- [ ] Kolom Penghitung + Saksi terisi ✓

Witness config:
- [ ] Toggle "Wajibkan saksi" di Pengaturan berfungsi ✓
- [ ] Setting OFF + counter solo + match → auto-commit jalan ✓
- [ ] Setting ON + start tanpa witness → RPC reject ✓
- [ ] Audit table kolom Saksi tampil "—" untuk sesi solo ✓

- [ ] **Step 3: Update progress.md**

Add entry summarizing completion (see existing pattern in `progress.md`).

- [ ] **Step 4: Final commit**

```bash
git add progress.md
git commit -m "docs(progress): stok opname blind-count + conditional approval implementation complete"
```

---

## Deploy order (production rollout per spec §10)

When ready to ship, deploy in this sequence:

1. **Frontend null-tolerance (Tasks 1-3)** — deploy first. Hard refresh users.
2. **Migration A (Task 4)** — masking. Verify with admin login.
3. **Migration C (Task 5)** — re-ack on edit.
4. **Migration B (Task 6)** + **client update (Task 7)** — auto-commit branch.
5. **Migration D (Task 8)** — audit log entries.
6. **Frontend blind UI (Tasks 9-11)** — visible blind mode.
7. **Migrations E1+E2 (Tasks 12-13)** — witness config (default TRUE = zero behavioral change).
8. **Frontend witness config (Tasks 14-16)** — Pengaturan toggle + screens.
9. **Pengawasan audit table (Task 17)** — Owner visibility.

Each step can be reverted independently if issues surface.
