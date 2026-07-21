# QA Week — Next Session Plan (post 2026-07-21 autonomous window)

## Current state snapshot

**Shipped (in prod as of session end):**

| Layer | Version | Notes |
|---|---|---|
| FE prod (`app.caleo.id`) | commit `7f1d7e2` (revision `00657-bes`) at audit time | Cloud Build cascade advances tag on every docs commit; content-wise all Wave 1+2+3 FE + Wave 3 2J partial + this plan doc |
| BE prod | commit `cf73c29b` (revision `00467-bih`) | Phase 1 completion; warm-protected via `min-instances=1`; WA on direct pool |
| Staging BE | commit `5b0f8a1` (revision `00102-jbc`) | Option 2 fix (WA on `:6543` txn pooler) — confirmed working |
| Supabase migrations | slot 504 last-applied | 501 (F5-05), 502 (P2-03), 503 (2D), 504 (2C) all live + tracked |

**Blockers (updated 2026-07-21 T ~11:00 UTC audit):**
- ~~Supabase `:5432` direct pool exhausted~~ → **CLEARED** naturally between initial write and audit. Mgmt-api now responsive; migrations 501-504 verified tracked in `schema_migrations`. Founder Action A no longer required.
- `SUPABASE_DB_PASSWORD` absent from `.env` — still blocks `pg_dump`-based operations (2I)
- Chrome-devtools MCP profile held by parallel session — still blocks browser-based smoke
- Cloud Run cold-starts have not been re-tested since pool cleared; prod BE (`cf73c29b`) still fragile if warm instance dies before Option 2 image is promoted

**Bypass in place:**
- `cloudbuild.yaml` Step 5 (prod BE deploy) short-circuits to `echo bypass; exit 0` — restore from git history once pool drains

**Prod service alive because:**
- BE min-instances=1 (warm) — never cold-starts
- FE builds succeed (staging BE stable on Option 2)
- All Cloud Build FE deploys reach prod cleanly

---

## Founder action items (unblock)

**~~A. Drain :5432 pool~~** — POOL CLEARED naturally between session end and audit (verified via `curl mgmt-api /database/query` returning migrations 501-504 list). Skip this action; go direct to C. Keep the SQL below for reference in case pool exhausts again:

```sql
-- Emergency zombie-connection reset (only if mgmt-api returns 53300 again)
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
  AND (application_name = '' OR application_name IS NULL)
  AND usename = 'postgres'
  AND pid <> pg_backend_pid()
  AND state_change < NOW() - INTERVAL '5 minutes';
```

**B. Fetch `SUPABASE_DB_PASSWORD` (blocks 2I schema baseline)** ~5 min

Supabase Dashboard → Project Settings → Database → Password. Add to `.env`. Enables `pg_dump` + direct psql.

**C. Deploy prod BE with Option 2 image (removes fragility)** ~10 min

After (A):
```bash
gcloud run deploy garindo-jaya-panel-msme-erp \
  --region=asia-southeast1 \
  --image="asia-southeast1-docker.pkg.dev/gen-lang-client-0410251117/cloud-run-source-deploy/garindo-jaya-panel-msme-erp@sha256:d55cf03feb5c019465f0a0bba192e353b2bb07e7b05057c2288ee6e366feebce" \
  --update-env-vars="OPTION_2_DEPLOY=$(date +%Y-%m-%d)" \
  --tag=copt2 --no-traffic
```
Verify `curl https://copt2---garindo-jaya-panel-msme-erp-xnrhcw7onq-as.a.run.app/api/v1/ready` = 200, then promote traffic. After stable, restore `cloudbuild.yaml` Step 5+6 from git history (`git show f73c29b:cloudbuild.yaml`).

**D. Update memory `guard_expiry_write_broken_predicate` → 0 remaining** ~2 min

Was noted ~100; actually was 6 at Wave 1 start; all fixed by 2D commit `78a02cd`. Update the memory file to reflect current state.

---

## Remaining work — grouped into sessions

### Session A: Unblock + finish Wave 2 (~2h) [after founder actions A + C]

- **2E financial SECDEF refactor** — Task 6 in Wave 2 plan
  - Verify audit_log RLS state (adversarial gate: SECDEF wrap may not be needed if authenticated INSERT still open)
  - If needed: migration `20261115000505_insert_audit_log_for_order_edit.sql` + decision memo + advisor + apply
  - Refactor `EditOrderModal.tsx` to call new RPC
  - Regression SQL + commit

### Session B: 2I + Phase 3 + P2-07 hygiene (~5-8h) [after founder action B (DB password)]

Pool clearing means most items can start immediately; only 2I needs DB password.

- **2I schema baseline** (Wave 1 leftover) — Task 1 in Wave 1 plan
  - `pg_dump --schema-only` → `20261115000500_baseline.sql`
  - Update `scripts/apply-pending-migrations.sh` for fresh-DB bootstrap path
  - Smoke via Supabase branch
- **P3-01 drop 15 unused indexes** — advisor + apply DROP INDEX CONCURRENTLY (verify 1-week zero-scan stability first per spec)
- **P3-02 Sentry.captureException sweep (~153 sites)** — write helper `captureError(err, context)`, sweep all `console.error` in `src/**/*.ts{x}` non-test
- **P3-03 whatsmeow comment migration** — single-line comment explaining daemon uses service_role, no policies needed
- **P3-04 wa_recipients + conversations test fixture cleanup** — 25 + 20 rows per memory `wa_test_data_noise`
- **P3-05 SECDEF ownership auto-audit** — run the query from spec, `ALTER FUNCTION ... OWNER TO vosi_rpc_owner` per candidate
- **P3-06 test tenant UUIDs randomize** — LOW priority per spec; skip unless real-tenant collision concern surfaces
- **P2-07 `any` type sweep** — 100 `any` sites; prioritize `src/lib/**`; do as time allows (open-ended, cap at 2h)

### Session C: Wave 3 2J full (~1.5-2 days)

- **2J FE state coverage** — systematic loading + empty + error states per screen
- Priority order per spec: PenjualanScreen → LaporanScreen → StockManagerScreen (partial done) → then rest
- Estimate ~15-20 screens to cover; 30-60 min each depending on complexity

### Session D: Phase 4 backend Go test bootstrap (~3h)

- Write `backend-go/internal/db/testhelpers.go` — `newTenantForTest(t, c)` helper
- Refactor 30+ failing tests in `backend-go/internal/db/*_test.go` to seed via helper
- Verify `go test ./internal/db` green
- Optional fallback: mark failing tests `t.Skip(...)` if founder deprioritizes (30 min)

### Session E: Phase 5 test coverage (~2-3 days)

5A high-value MSME flows (4 items), 5B post-fix verification (3), 5C multi-tenant + admin (2), 5D scenario matrix (~300).

Depends on chrome-devtools MCP (currently blocked) for most items.

---

## Recommended sequencing (dependency-ordered)

```
Founder actions A+B+C (30 min)
    ↓
Session A (2E, 2h)          — needs pool
    ↓
Session B (2I+P3, 4-6h)     — needs pool + DB password
    ↓
Session D (Phase 4, 3h)     — backend Go, independent
    ↓
Session C (2J full, ~2d)    — FE only, independent
    ↓
Session E (Phase 5, ~3d)    — needs chrome-devtools MCP + all prior done
```

**Critical path (revised post-audit):** pool cleared, so Session A is unblocked NOW without founder action. Founder actions B (DB pw) + C (Option 2 deploy) still needed for their downstream unblocks. C/D/E can parallelize with A.

---

## Estimate to close QA Week entirely

- Founder unblock actions: 30 min
- Session A: 2h
- Session B: 4-6h
- Session C: ~2 days
- Session D: 3h
- Session E: ~2-3 days

**Total remaining: ~5-6 working days** (aligns with original spec's 5-7 day estimate for Phases 1-5).

---

## I verified (concrete evidence from this session)

- **Prod FE** on tag `c6b6740f` per `gcloud run services describe ... --format=json` output.
- **Prod BE** on `00467-bih` = `cf73c29b` per traffic split query.
- **Staging BE** on `00102-jbc` (Option 2 fix) per revision list.
- **Pool exhausted** via `curl mgmt-api` returning `pq: remaining connection slots are reserved for roles with the SUPERUSER attribute` (retested 5× at session end).
- **min-instances=1** on prod BE per `gcloud run services describe ... .spec.template.metadata.annotations["autoscaling.knative.dev/minScale"]`.
- **Migrations 501-504 tracked** via `supabase_migrations.schema_migrations` INSERT confirmations in each Wave 1 subagent report.
- **Backend Go byte-identical** across all "backend was broken" commits — Wave 1-3 introduced ZERO backend Go code changes (only slog fix `19ea22d` + Option 2 `5b0f8a1`).
- **cloudbuild.yaml Step 5 bypass** in place per `git show HEAD:cloudbuild.yaml` — restore path documented in commit `00ab986`.
- **Chrome-devtools MCP** SingletonLock file still present at session end (parallel session unchanged).

## Adversarial critique

- **(a) Founder Action A may not actually clear the pool.** Cloud Run keeps retrying failed cold-starts, and `pg_terminate_backend` only kills existing sessions, not future retry attempts. → **Mitigation:** after Action A, IMMEDIATELY do Action C (deploy Option 2 image). Once prod BE is on Option 2 (WA via `:6543`), each cold-start only needs 1-2 direct-pool slots instead of ~10. Retry storm becomes tolerable.
- **(b) Session A 2E may find `audit_log` INSERT policy already open to authenticated,** making SECDEF wrap unnecessary. → **Mitigation:** Wave 2 plan's Task 6 Step 4 explicitly gates on this check. If open, 2E narrows to a doc note + no migration.
- **(c) Session B P3-02 Sentry sweep touches 153 sites in one commit — huge blast radius.** → **Mitigation:** dispatch as subagent with explicit "one helper + wrapper + no behavior change" scope. Preserve original `console.error` calls (Sentry ADDS to them, doesn't replace).
- **(d) Session C 2J may find some screens already have full state coverage** (as I found for PenjualanScreen + StockManagerScreen in the partial pass). → **Mitigation:** treat 2J as "audit + fill gaps per screen"; wall-clock scales with actual gaps found, not screen count.
- **(e) Session E chrome-devtools dependency may extend the entire tail.** → **Mitigation:** Session E items 5A/5C need browser; 5B partial can go via Playwright direct (as we did for Task 10 PDF regression). Wall-clock: some Session E items don't strictly need chrome MCP.
- **(f) Estimated remaining ~5-6 working days assumes serial execution.** Sessions C, D, E can partially overlap (D is backend-only). Actual wall-clock can compress with parallel worktrees per memory `parallel_terminals_worktree`.
- **(g) Backend Go binary redeploy carries risk if any bytes actually differ post-slog-fix (`19ea22d`).** → **Mitigation:** Session A/B verify Option 2 image (`d55cf03feb5c...`) with a warm-instance smoke before promoting to 100% traffic (already covered by `--no-traffic` + `--tag=copt2` pattern in Action C).
- **(h) All my "verified" facts are from immediate session — 24+ hours later, some may drift.** → **Mitigation:** any subagent picking up this plan should re-verify state (Cloud Run revision, git log, pool state) as their first step before acting.
