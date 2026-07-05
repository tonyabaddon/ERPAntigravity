# Task 3 Report — payment-proofs Storage bucket + RLS

**Status:** DONE
**Migration:** `20261115000022_phase_b_wave5_payment_proofs_bucket.sql`
**Applied to:** Garindo prod `ekhhojaezdfjfwuxyjkl` via MCP

## What was done

1. **Bucket upserted** (bucket already existed with wrong settings — used ON CONFLICT DO UPDATE):
   - `public=false` (was `true`)
   - `file_size_limit=5242880` (was 10485760 / 10MB)
   - `allowed_mime_types=['image/jpeg','image/png','application/pdf']` (was jpeg/png/webp/heic)

2. **Legacy policy dropped:** `"authenticated full access payment-proofs"` (ALL, {authenticated}, no path scoping) — replaced by the two new policies.

3. **`p_platform_admin_crud`** — FOR ALL TO authenticated, USING + WITH CHECK on `_is_platform_admin_from_jwt()`.

4. **`t_tenant_owner_read`** — FOR SELECT TO authenticated, path-scoped to `<slug>/*` via `_resolve_tenant_id()` → tenants.slug.

## Smoke test results (post-apply)

- Bucket: `public=false`, `file_size_limit=5242880`, `allowed_mime_types={image/jpeg,image/png,application/pdf}` ✓
- `p_platform_admin_crud` present (cmd=ALL, roles={authenticated}) ✓
- `t_tenant_owner_read` present (cmd=SELECT, roles={authenticated}) ✓
- Legacy policy gone ✓

## Concerns

- **None blocking.** `storage.objects` owner is `supabase_storage_admin` but `postgres` role has USAGE on storage schema; `CREATE POLICY` from migration executed successfully.
- **Anon/cross-tenant isolation tests** cannot run inside pgTAP (SET ROLE not available to postgres in Supabase Cloud). Documented as manual verification steps A/B/C in the test file.
- FE must enforce 5MB + mime-type at upload time (Storage API will also reject, but client-side guard improves UX).

## Files

- `supabase/migrations/20261115000022_phase_b_wave5_payment_proofs_bucket.sql`
- `supabase/tests/wave5/payment_proofs_bucket.sql` (7 pgTAP assertions)
