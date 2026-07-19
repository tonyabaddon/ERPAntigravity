# Pending memory correction — for founder review

## `guard_expiry_write_broken_predicate` — state drift

**Current memory says:** ~100 t_* RLS policies use broken `_guard_expiry_write() IS NULL` predicate; direct client writes to t_*-policied tables blocked; every new write path needs a SECDEF RPC.

**Reality (verified 2026-07-19 via SQL):** Only **6 residual policies** still use `_guard_expiry_write()`:
- `warehouse_transfers` (3 policies: insert/update/delete)
- `warehouse_transfer_items` (2 policies: insert/update)

All other write-path policies were migrated to `_check_expiry_ok()` (which correctly returns BOOLEAN — memory `_guard_expiry_write() RETURNS VOID` still holds for the broken predicate).

**Query used to verify:**
```sql
SELECT COUNT(*)
FROM pg_policy p
WHERE pg_get_expr(p.polqual, p.polrelid) ILIKE '%_guard_expiry_write%'
   OR pg_get_expr(p.polwithcheck, p.polrelid) ILIKE '%_guard_expiry_write%';
-- Result: 6
```

**Recommended memory body update:**

```md
Memory: guard_expiry_write_broken_predicate

Description: broken _guard_expiry_write() IS NULL predicate remaining on 6 policies
(warehouse_transfers 3 + warehouse_transfer_items 2) — not the "all t_* policies"
scope in earlier version. All other write paths migrated to _check_expiry_ok()
(BOOLEAN, works correctly).

Body: `_guard_expiry_write()` returns VOID → `void IS NULL` always FALSE → policy
always blocks direct client writes. Historically applied to ~100 t_* policies;
migration to `_check_expiry_ok()` cleanup pattern completed but 6 residual policies
on warehouse_transfer remain. Warehouse transfer flow still works because
initiate_warehouse_transfer/cancel_warehouse_transfer SECDEF RPCs bypass RLS.

Follow-up: sweep those 6 policies to _check_expiry_ok() for consistency (P2-02
in QA week findings). Zero user-visible impact today.
```

**Why not apply autonomously:** memory persists across sessions and shapes future behavior. Founder should approve the correction.

**Rationale:** Applying the memory update autonomously without founder review would (a) potentially rewrite valid nuance I'm not aware of, (b) preempt the review Anda promised, (c) contradict advisor guidance to defer memory changes to founder.

Founder action needed: read the correction above, if agreed → tell me "apply memory correction" or update yourself via `/remember` skill or direct file edit of `feedback_guard_expiry_write_broken_predicate.md`.
