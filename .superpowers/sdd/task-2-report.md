# Task 2 Report — 2K Idempotency Key Wiring

## Status: DONE

## Step 1 — RPCs with p_idempotency_key (full enumeration)

Grep: `grep -l "p_idempotency_key" supabase/migrations/*.sql`

Found **6 migrations** (more than brief's expected 5; includes enqueue_job):

| Migration | RPC Name | Key Type | Notes |
|---|---|---|---|
| 20261115000101 | `_insert_supplier_claim` | TEXT DEFAULT NULL | Internal helper; called by server-side RPCs only, no direct FE caller |
| 20261115000311 / 20261115000325 | `record_kasir_sale` | UUID DEFAULT NULL | Main kasir sale RPC |
| 20261115000312 | `receive_purchase_order` | UUID DEFAULT NULL | PO receipt (5-arg form) |
| 20261115000313 | `commit_opname` | UUID DEFAULT NULL | Opname commit |
| 20261115000315 / 20261115000325 | `record_pembayaran` | UUID DEFAULT NULL | Supplier payment |
| 20261115000321 / 20261115000322 | `enqueue_job` | TEXT DEFAULT NULL | Job queue; key optional, caller-supplied |

## Step 2 — FE call sites

Grep: `grep -rn "supabase.rpc(" src --include='*.ts' --include='*.tsx' | grep -v ".test."`

| RPC | File | Pre-existing key? | Action |
|---|---|---|---|
| `record_kasir_sale` | `src/lib/supabaseClient.ts:1466` | YES — `input.p_idempotency_key ?? crypto.randomUUID()` | Added console.info log |
| `commit_opname` | `src/lib/supabaseClient.ts:1963` | YES — `crypto.randomUUID()` | Extracted to var + added log |
| `receive_purchase_order` | `src/lib/pembelianService.ts:179` | YES — `crypto.randomUUID()` | Extracted to var + added log |
| `record_pembayaran` | `src/lib/pembayaranService.ts:37` | YES — `crypto.randomUUID()` | Extracted to var + added log |
| `enqueue_job` | `src/lib/jobsApi.ts:27` | YES — `opts.idempotencyKey ?? null` | Caller-supplied; no FE callers in codebase; no change needed |
| `_insert_supplier_claim` | (none) | N/A — server-side only | No FE call site; no change needed |

**Finding: all 4 primary high-value FE call sites already had p_idempotency_key wired before this task.** This task added Step 4 (audit logging) which was the only gap.

## Step 3 — Key generation strategy

**`crypto.randomUUID()`** — used everywhere. Rationale: browser-native, no import, stronger uniqueness than `Date.now() + Math.random()`. The fallback (`${feature}-${entityId}-${Date.now()}-${Math.random()}`) was not needed.

For `record_kasir_sale`: the input object allows a pre-generated key via `input.p_idempotency_key`; falls back to `crypto.randomUUID()` if not provided. This supports the pattern where the component generates the key before opening a confirmation modal (consistent key across retries).

## Step 4 — Audit logging added

Each call site now extracts the key to a named variable and logs:

```typescript
// pembelianService.ts — receive_purchase_order
const idem312 = crypto.randomUUID();
console.info('[idempotency] receive_purchase_order po=%s key=%s', poId, idem312);

// pembayaranService.ts — record_pembayaran
const idem315 = crypto.randomUUID();
console.info('[idempotency] record_pembayaran key=%s', idem315);

// supabaseClient.ts — commit_opname
const idem313 = crypto.randomUUID();
console.info('[idempotency] commit_opname approval=%s key=%s', approvalId, idem313);

// supabaseClient.ts — record_kasir_sale (inline IIFE to preserve existing structure)
const key = input.p_idempotency_key ?? crypto.randomUUID();
console.info('[idempotency] record_kasir_sale key=%s', key);
```

## Step 5 — SQL verification

File created: `tests/sql/qa-week/2k-verify.sql`

```sql
SELECT COUNT(*) AS idempotency_rows FROM t_rpc_idempotency;
```

**Status: DEFERRED** — cannot execute against prod DB in this session (pool exhaustion risk; prod backend on cf73c29b warm-protected). Expected result: > 0 after any real FE-triggered high-value write. Table exists (confirmed by migration 311/312/313/315 referencing it). Row count is 0 in fresh environment; increases with each successful idempotency-guarded RPC call.

## Step 6 — Local gates

| Gate | Result |
|---|---|
| `npm run lint` (tsc --noEmit) | PASS — clean |
| `npm run audit:numinput` | PASS — clean |
| `npm run audit:secdef-null-tenant` | PASS — 461 migration files scanned, no violations |
| `npx vitest run --changed` | PASS — 77 files, 657 passed, 2 skipped |

## Files modified

- `src/lib/pembelianService.ts` — extracted idem key to var + console.info for `receive_purchase_order`
- `src/lib/pembayaranService.ts` — extracted idem key to var + console.info for `record_pembayaran`
- `src/lib/supabaseClient.ts` — extracted idem key to var + console.info for `commit_opname` and `record_kasir_sale`
- `tests/sql/qa-week/2k-verify.sql` — new verification query

## Commit SHA

`b74f60d`
