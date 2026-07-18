# Feature Flags — developer reference

**TL;DR**: We already have a full feature-flag system. `plans.feature_bundle` defines defaults per plan; `tenant_subscriptions.feature_overrides` allows per-tenant deviations; `v_tenant_effective_features` merges the two; the FE reads via `useFeature('flag_key')`. To gate a new feature, pick a flag key, seed defaults in the migration, wrap the entry point in `useFeature`, done. **No new infra needed.**

## The system in one diagram

```
plans.feature_bundle (JSONB)           tenant_subscriptions.feature_overrides (JSONB)
  {modul_kasir: true, ...}                          {modul_ai_calista: true}
              │                                                │
              └─────────  ||  (JSONB concat)  ─────────────────┘
                                    │
                                    ▼
              v_tenant_effective_features view
                                    │
                        loaded into TenantContext.effective_features
                                    │
                                    ▼
                          useFeature('modul_ai_calista') → boolean
                                    │
                                    ▼
                       {feature ? <NewComponent /> : null}
```

## When to add a feature flag

**Add one for:**
- New paid tier / add-on feature (billing gating)
- New UI/UX experiment that we want to A/B or dark-launch (per-tenant override)
- Feature that depends on tenant-specific config (e.g. WhatsApp Business API vs Whatsmeow)
- Feature that has real cost per use (LLM calls, storage upload) and needs per-tenant kill switch
- Feature that isn't ready for all tenants yet (progressive rollout to first N)

**Don't add one for:**
- Bug fixes (just ship the fix)
- Refactors (they should be transparent)
- Universal UI polish (ships to everyone or ships nowhere)
- Backend-only performance improvements (no UX visibility)

## How to add a new feature flag

### Step 1: Pick a flag key

Convention: `snake_case`, prefixed by category:
- `modul_*` — top-level module toggle (kasir, tempo, akuntansi, ai_calista)
- `beta_*` — beta feature exposed to opt-in tenants
- `experiment_*` — A/B experiment gate
- `limit_*` — quota/cap flag with numeric value in `feature_overrides` (rare — most flags are boolean)

Example: `beta_bulk_import_v2`

### Step 2: Add default to plan bundles

Update `plans.feature_bundle` for each plan via a migration. Claim the next free slot (memory `migration_slot_allocation`).

```sql
-- Migration 2026NNNN000NNN — add beta_bulk_import_v2 flag to plans

UPDATE public.plans
SET feature_bundle = feature_bundle || jsonb_build_object('beta_bulk_import_v2', false)
WHERE code IN ('STARTER', 'GROWTH', 'PRO');

-- Optionally: enable for one specific tenant as a pilot
UPDATE public.tenant_subscriptions
SET feature_overrides = feature_overrides || jsonb_build_object('beta_bulk_import_v2', true)
WHERE tenant_id = '<pilot-tenant-uuid>';
```

Idempotent per CLAUDE.md: JSONB `||` is safe re-run.

### Step 3: Consume in FE

```tsx
import { useFeature } from '@/contexts/TenantContext';

function ImportPage() {
  const useV2 = useFeature('beta_bulk_import_v2');
  if (useV2) return <BulkImportV2 />;
  return <BulkImportV1 />;
}
```

**Rule of thumb**: gate at the highest level that makes sense — usually the entry route or top-of-page component, not deep in a leaf. Fewer gates = simpler mental model.

### Step 4: Consume in BE (Go)

The backend does not fetch `v_tenant_effective_features` per-request today (it would be a hot query). Two options:

- **RPC-based check**: call `SELECT effective_features->>'beta_bulk_import_v2' FROM v_tenant_effective_features WHERE tenant_id = $1` at request entry. Cache per tenant in-process for 60s.
- **Client-gated only**: rely on the FE gate. Backend accepts both v1 and v2 calls; the flag just picks which FE code path runs. This is what most current flags do — simpler, safer.

Default to **client-gated only** unless the backend needs a hard cost/security cutoff.

### Step 5: Enable per-tenant via admin UI

Go to `/admin/tenants/<id>/modul` — the `ModuleTogglePanel` shows every flag key present in the tenant's effective features. Toggle → calls `update_tenant_feature_override` RPC → optimistic update + rollback on error.

If the flag isn't shown, it's because the plan doesn't include the key. Add via Step 2 migration first.

### Step 6: Observe

Add a log line at the flag branch entry:

```tsx
const useV2 = useFeature('beta_bulk_import_v2');
useEffect(() => {
  if (useV2) console.info('[feature] beta_bulk_import_v2 enabled', { tenant_id });
}, [useV2, tenant_id]);
```

For revenue-impacting flags, also add a Sentry breadcrumb so any errors under the flag are tagged with which cohort saw them.

## Sunset / removal

When a flag has been on for all tenants for >30 days with zero issues:

1. Remove the `useFeature` gate — inline the new code path.
2. Migration: `UPDATE plans SET feature_bundle = feature_bundle - 'flag_key'; UPDATE tenant_subscriptions SET feature_overrides = feature_overrides - 'flag_key';`
3. Update this doc if the flag was a canonical example.

**Do not leave dead flags** — they clutter admin UI and confuse future readers.

## Real-world examples in this codebase

| Flag | Purpose | Where enforced |
|---|---|---|
| `modul_kasir` | Toggle POS/kasir entry point | `PelangganScreen`, sidebar |
| `modul_tempo` | Toggle Piutang/AR features | `PelangganScreen` credit UI |
| `modul_akuntansi` | Toggle Akuntansi sidebar item | Sidebar |
| `modul_pengiriman` | Toggle delivery order UI | Order detail |
| `modul_ai_calista` | Enable WA AI agent | `wa` inbound handler |

## Related

- Migration `20261001000001_phase_a_schema.sql` — creates `plans`, `tenant_subscriptions`, `v_tenant_effective_features` view
- Migration `20261115000038_update_tenant_feature_override_rpc.sql` — admin-scope RPC to flip a per-tenant flag
- Component `src/contexts/TenantContext.tsx` — provides `useFeature(key)` hook
- Component `src/components/admin/TenantDetail/ModuleTogglePanel.tsx` — admin UI for per-tenant toggles
- Component `src/components/admin/PlansManagement.tsx` — plan-level bundle editor

## Anti-patterns

- **`useFeature('foo') || props.forceFoo`** — bypass patterns defeat the flag. If you need an override for tests, use the TenantContext provider directly.
- **Multiple flags gating the same feature** — decide which one wins in code, not in prod config. Compose in the migration.
- **Adding a flag "just in case"** — every flag costs future removal effort. Add only for the reasons in "When to add" above.
- **Reading `plan.feature_bundle` directly, ignoring `feature_overrides`** — always read `effective_features` (merged view). Per-tenant overrides exist for a reason.
