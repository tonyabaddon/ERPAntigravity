# Tenant-aware customer ID scheme — design memo

**Date:** 2026-07-19
**Trigger:** Session 5 finding F5-05 — `uq_customers_wa` unique constraint is `(wa_number)` alone (not per-tenant). Blocks legitimate customer creation across tenants. Fix requires backend `GetOrCreateCustomer` refactor which currently uses `gjp_cust_seq` (Garindo-hardcoded sequence).
**Reviewer:** founder
**Status:** DRAFT — needs founder pick before implementation

**Related:**
- `docs/qa-week/2026-07-19-session5-findings.md` § F5-05
- `docs/qa-week/pending-fixes/pending-memory-correction.md`
- Memory: `guard_expiry_write_broken_predicate` (residual is 6 warehouse_transfers policies, not ~100)

---

## Context

**Current state:**
1. `customers.id` is TEXT NOT NULL (no default)
2. Backend `GetOrCreateCustomer` (backend-go/internal/db/customers.go:8) generates IDs via `INSERT ... VALUES ('GJP-CUST-' || lpad(nextval('gjp_cust_seq')::text, 4, '0'), $1) ON CONFLICT (wa_number) DO UPDATE`
3. FE `insertNewCustomer` (customerWrappers.ts) uses `crypto.randomUUID()` — different scheme
4. `uq_customers_wa UNIQUE (wa_number)` — table-global unique blocks cross-tenant

**Symptoms:**
- FE customer create fails 409 when a customer with same WA number exists in ANOTHER tenant (Session 5 discovered when trying to add `081234567890` to Toko Jaya; Garindo already had it)
- Backend WA bot's `ON CONFLICT (wa_number)` DO UPDATE incorrectly UPDATES existing customer even if in different tenant (potential cross-tenant data corruption if the bot is ever routed for tenant B against tenant A's existing customer)

**Constraints:**
- Garindo currently has customers with `GJP-CUST-####` IDs (from backend). Cannot rename them silently — audit_log refs, FK relationships in kasir_transactions/orders.
- FE creates new customers with random UUIDs. Two schemes coexist in production data.

---

## Options for tenant-aware customer ID

### Option A — Move to `gen_random_uuid()` for all new customers

- **New customers:** `id = gen_random_uuid()::text`
- **Backend WA bot:** stop using `gjp_cust_seq`; use `gen_random_uuid()`
- **Existing Garindo customers with `GJP-CUST-####`:** untouched — those IDs remain in use as-is
- **Migration:** DROP `uq_customers_wa`; ADD `UNIQUE (tenant_id, wa_number)`
- **Backend change:** rewrite `GetOrCreateCustomer` to use `ON CONFLICT (tenant_id, wa_number)` + `gen_random_uuid()` for new inserts
- **New sequence?** No — drop `gjp_cust_seq` eventually (leave sequence intact for backward safety; nothing references it after backend change)

**Pros:**
- Simplest — no per-tenant bootstrap needed
- No new schema
- FE + backend converge on UUID
- No collision risk

**Cons:**
- ID scheme drift in existing data (Garindo has `GJP-CUST-####`, everyone else has UUIDs)
- Loses the human-readable ordering `GJP-CUST-0042` gives (though UUIDs are searchable enough)
- **Any code assuming `GJP-CUST-` prefix breaks** — grep required (see below)

### Option B — Per-tenant sequence table with tenant prefix

- **New customers:** `id = <TENANT_PREFIX>-CUST-<seq>` where prefix comes from `tenants.slug_short` or similar
- **Schema:** new `tenant_customer_sequences` table `(tenant_id, next_seq)` — allocate + increment atomically
- **Backend change:** rewrite `GetOrCreateCustomer` to look up tenant prefix + allocate
- **Migration:** DROP `uq_customers_wa`; ADD `UNIQUE (tenant_id, wa_number)`
- **Existing Garindo customers:** untouched

**Pros:**
- Preserves human-readable ID pattern
- Extends existing convention to all tenants
- Each tenant gets clean starting seq (starts at 1 for new tenants)

**Cons:**
- New schema (tenant_customer_sequences)
- Bootstrap on tenant provision — `provision_tenant` RPC must init the sequence
- Prefix choice policy — `slug_short`? First-3-letters-of-tenant-name? Founder pick
- More code paths to test

### Option C — Composite key (drop the ID column, use natural key)

- **Schema:** `customers.id` becomes `(tenant_id, wa_number)` composite PK
- **Existing FK refs:** ALL tables referencing `customers.id` (kasir_transactions, orders, sales_orders, leads) need refactor to composite
- **Not viable** given the amount of FK refactoring required. Reject.

---

## Recommended: Option A

**Why:**
- Smallest diff
- Zero new schema
- FE already uses UUIDs — backend just converges
- Existing GJP-CUST-#### IDs preserved (backward compat)
- Onboarding new tenants doesn't need sequence bootstrap

**Risk:** any code assuming ID format. Need grep sweep.

### Impact grep (must run before choosing Option A)

```bash
# In backend-go
grep -rn "GJP-CUST-" backend-go/ --include='*.go' | grep -v _test
# In FE
grep -rn "GJP-CUST-\\|GJP_CUST_\\|customer.id.startsWith" src/ --include='*.ts' --include='*.tsx' | grep -v test
# In migrations
grep -rn "GJP-CUST-\\|gjp_cust_seq" supabase/migrations/
```

Expected result: mentions in migrations (fine — historical), maybe legacy backend code (fine — replaced by refactor), zero in FE (customerWrappers uses randomUUID already).

If grep finds a FE call site that assumes `startsWith('GJP-')`, that's a red flag — refactor scope grows.

---

## Migration plan (assuming founder picks Option A)

### Phase 1 — Backend refactor (2-3h)

1. Rewrite `backend-go/internal/db/customers.go` `GetOrCreateCustomer(tenantID, waNumber)` — takes explicit tenant, uses `gen_random_uuid()` for new inserts, `ON CONFLICT (tenant_id, wa_number)` for upsert.
2. Update ALL callers of `GetOrCreateCustomer` — grep for callsites, thread `tenantID` through.
3. Add backend unit test verifying: (a) new customer created with UUID + tenant_id, (b) existing customer for same tenant returns same row, (c) different tenant same phone creates new row.
4. Local run — verify no test regression.

### Phase 2 — Schema migration (10 min)

1. Claim migration slot (per memory `migration_slot_allocation` — 100+ range).
2. Migration:
   ```sql
   BEGIN;
   ALTER TABLE customers DROP CONSTRAINT uq_customers_wa;
   ALTER TABLE customers ADD CONSTRAINT uq_customers_wa_tenant UNIQUE (tenant_id, wa_number);
   COMMIT;
   ```
3. Verify existing data satisfies new constraint (should — old was stronger). Advisor confirmed safe by construction.

### Phase 3 — Ship & verify staged flow (30 min - 1h)

1. Stage 1 backend: `go test ./...` clean, `npm run lint` clean.
2. Stage 2 backend: `git push main` triggers `cloudbuild.yaml` → Cloud Run deploy. `gcloud builds list --limit=2` verify STATUS!=FAILURE per memory `deploy_verify_after_push`.
3. Stage 3 backend: WA bot lookup smoke test — send a fake webhook, verify customer resolved correctly (or draft SQL smoke: as service_role, call `GetOrCreateCustomer` for existing Garindo customer, verify same ID returned).
4. Apply migration via `mcp__plugin_supabase_supabase__apply_migration` or `scripts/apply-pending-migrations.sh`.
5. Regression test: as tenant A (Garindo), insert customer with phone X. As tenant B (Toko Jaya), insert customer with phone X. Both succeed. Same tenant same phone still 409.

### Phase 4 — FE cleanup (5 min)

1. FE `customerWrappers.ts` already uses `crypto.randomUUID()` — no code change needed.
2. Verify by creating a customer from FE — should now succeed even if phone exists in another tenant.

---

## Rollback plan

- Backend rollback: revert Cloud Run to previous revision (memory `rollback-procedures`).
- Migration rollback:
  ```sql
  ALTER TABLE customers DROP CONSTRAINT uq_customers_wa_tenant;
  ALTER TABLE customers ADD CONSTRAINT uq_customers_wa UNIQUE (wa_number);
  ```
  — safe because old constraint was stronger, current data satisfies both.

---

## Scale ceiling check (per CLAUDE.md)

1. **Ceiling at 10× scale (~10K tenants, ~100M customers):** unique index `(tenant_id, wa_number)` btree — index size grows linearly. At 100M rows, index ~5GB. Acceptable at Supabase Free scale.
2. **Hot path:** `SELECT ... WHERE tenant_id = $1 AND wa_number = $2` — hits the new index directly. Fast.
3. **Partition-ready:** customers table PK is currently `(id)` (single column). At 10M+ rows, partition by `tenant_id`. Composite PK `(tenant_id, id)` would enable this — separate future migration.
4. **Idempotency:** `GetOrCreateCustomer` retry-safe (ON CONFLICT DO UPDATE).
5. **Long ops:** Under 100ms per call. No queue needed.
6. **Cost curve:** Flat per-tenant.

---

## Follow-ups (post-fix)

- Deprecate `gjp_cust_seq` — nothing should reference it after refactor. DROP in a future cleanup migration.
- Consider adding `customers` composite PK `(tenant_id, id)` for partition-readiness (semi-reversible; separate design memo).
- Audit other places where WA bot logic is Garindo-hardcoded — memory `calista_tenant_identity_env` had a similar pattern for AI prompts.

---

## Decision needed from founder

1. **Confirm Option A** (UUID for new customers, keep Garindo's legacy IDs)? Or pick Option B (per-tenant prefix)?
2. **Advisor gate:** this is irreversible-adjacent. My draft above is the recommendation. Sign-off before I execute?
3. **Timing:** apply this after P1-05 WIB and P1-07 jspdf are also decided? Or batch it now?

---

## Impact grep results (verified 2026-07-19)

**Backend Go:** 3 refs to `GJP-CUST-` — all in `db/customers.go` (production, will be rewritten) + `db/fixtures.go` (test seed generator). Zero external callers assume the format.

**FE:** **ZERO** refs to `GJP-CUST`, `startsWith('GJP')`, or any prefix check. Clean.

**Migrations:** 9 refs — all are DOCUMENTATION comments ("customers.id is TEXT ... legacy GJP-CUST format") + 1 `CREATE SEQUENCE gjp_cust_seq` in the original schema migration. Zero code that ENFORCES the format.

**Verdict:** Option A is safe. Migration comments will become outdated ("legacy GJP-CUST-XXXX format" → "legacy Garindo customer IDs; new customers use UUID") but don't need code fixes.

**Ready to implement on founder OK. Estimated 2-3h backend refactor + 15 min migration + 30 min Ship & verify.**
