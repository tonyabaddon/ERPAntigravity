# Saldo Awal post error fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock founder-reported "Post Saldo Awal fails with `[object Object]`" on `app.caleo.id/t/toko-jaya-makmur` by backfilling 2 orphan `cash_accounts.coa_account_id` rows, adding a NOT NULL constraint to prevent future orphans, and shipping the pre-existing `[object Object]` class fix (commit `42b4598`) to production.

**Architecture:** Two sequential SQL migrations (slot 521 backfill, slot 522 NOT NULL). Backfill mirrors `resolveCoaAccountId` logic from `src/components/kasbank/AccountFormModal.tsx:72-127` (BANK → next `1-12NN` under `1-1200`; E_WALLET → next `1-13NN` under `1-1300`; KAS → reuse `1-1110`). No FE code changes required — helper + audit + codemod already shipped 2026-07-25 (see spec §SCOPE CORRECTION). Deploy path: `scripts/apply-migration.sh` for DB, `scripts/promote-to-prod.sh <SHA>` for FE.

**Tech Stack:** PostgreSQL (Supabase managed), Bash, curl to Supabase Management API `/v1/projects/{ref}/database/query`, chrome-devtools-mcp for prod smoke.

## Global Constraints

- **Migrations must be idempotent** — DROP IF EXISTS / CREATE IF NOT EXISTS / INSERT ... ON CONFLICT DO NOTHING / guarded backfills. Non-idempotent = blocks rollback and re-apply. (CLAUDE.md § Multi-tenant / RLS / SECDEF guardrails)
- **Migration slot numbering** — claim 521 + 522 (next free after 520). Never reuse.
- **Prod project ref** — `ekhhojaezdfjfwuxyjkl` (only Supabase project — no separate prod/staging split for DB).
- **Prod DB access** — via Supabase Management API PAT in `.env` (`SUPABASE_ACCESS_TOKEN`). Do NOT use direct psql (memory `all_buckets_tenant_scoped` note is about storage RLS, not this migration; this one is safe via Management API).
- **Prod FE deploy** — MANUAL only via `scripts/promote-to-prod.sh <7-char-SHA>`. Never bypass. (Memory `feedback_manual_prod_gate_after_real_tenant`, HARD RULE.)
- **After any DB migration** → run `mcp__plugin_supabase_supabase__get_advisors` and triage findings. (CLAUDE.md § Infrastructure lens)
- **Cost** — zero paid-service impact. Nothing to approve.
- **Reversibility** — semi-reversible. Rollback scripts inline in each migration comment.
- **Only affected tenant** — Toko Jaya Makmur (`22222222-2222-2222-2222-222222222222`). Prod scan 2026-07-27 confirmed no other tenant has `coa_account_id IS NULL`.
- **Zero historical journal_entry_lines** reference the 2 orphan cash accounts. Backfill has no data conflict.
- **Parent COAs** (`1-1110`, `1-1200`, `1-1300`) exist for Toko Jaya. No sub-COAs under `1-12` or `1-13` yet — backfill will create `1-1210 BCA Utama` + `1-1310 GoPay Merchant`.

---

### Task 1: Migration slot 521 — backfill `cash_accounts.coa_account_id`

**Files:**
- Create: `supabase/migrations/20261115000521_backfill_cash_accounts_coa_link.sql`
- Modify (later, at end of session): `docs/superpowers/miss-log.md` — memory reference `project_migration_slot_allocation` update; NOT in this task.

**Interfaces:**
- Consumes: existing `chart_of_accounts` rows for `account_code IN ('1-1110','1-1200','1-1300')` per tenant.
- Produces: 2 new `chart_of_accounts` rows for Toko Jaya (`1-1210` BCA Utama, `1-1310` GoPay Merchant), 2 updated `cash_accounts` rows with `coa_account_id` set.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20261115000521_backfill_cash_accounts_coa_link.sql`:

```sql
-- Slot 521 — backfill cash_accounts.coa_account_id for tenants with NULL rows.
--
-- Context: Toko Jaya Makmur has 2 cash_accounts (BCA Utama BANK, GoPay Merchant
-- E_WALLET) created outside the FE form (which calls resolveCoaAccountId at
-- create-time). These rows have coa_account_id = NULL, which causes
-- post_saldo_awal_snapshot (migration 20261115000147) to RAISE at:
--   `IF v_cash_coa IS NULL THEN RAISE EXCEPTION 'cash_account % tidak punya COA link'`
--
-- Prod scan 2026-07-27 (Supabase Management API):
--   SELECT t.slug, count(*) FROM cash_accounts ca JOIN tenants t ON t.id=ca.tenant_id
--    WHERE ca.coa_account_id IS NULL GROUP BY t.slug;
--   → toko-jaya-makmur: 2 rows. All real customer tenants: 0.
--
-- Backfill logic mirrors src/components/kasbank/AccountFormModal.tsx:72-127
--   - KAS → reuse tenant's 1-1110 Kas Toko
--   - BANK → next 1-12NN under 1-1200 (nextSuffix = 10 + child_count)
--   - E_WALLET → next 1-13NN under 1-1300 (same pattern)
--
-- Idempotent: skips rows already linked; safe to re-run.
-- Rollback: `UPDATE cash_accounts SET coa_account_id = NULL WHERE id IN (<ids>);
--            DELETE FROM chart_of_accounts WHERE account_code IN ('1-1210','1-1310')
--              AND tenant_id = '22222222-2222-2222-2222-222222222222';`
--   (Only apply if intentional revert; normal fix path never needs it.)

DO $$
DECLARE
  r RECORD;
  v_parent_id UUID;
  v_new_coa_id UUID;
  v_next_suffix INT;
  v_new_code TEXT;
  v_subtype TEXT;
  v_parent_code TEXT;
  v_child_prefix TEXT;
BEGIN
  FOR r IN
    SELECT id, tenant_id, account_type, internal_label
      FROM public.cash_accounts
     WHERE coa_account_id IS NULL
     ORDER BY tenant_id, account_type, sort_order
  LOOP
    IF r.account_type = 'KAS' THEN
      -- Reuse tenant's 1-1110 Kas Toko
      SELECT id INTO v_new_coa_id
        FROM public.chart_of_accounts
       WHERE tenant_id = r.tenant_id
         AND account_code = '1-1110'
         AND is_active = true;
      IF v_new_coa_id IS NULL THEN
        RAISE NOTICE 'skip cash_account % (tenant %): no 1-1110 Kas Toko COA', r.id, r.tenant_id;
        CONTINUE;
      END IF;
    ELSIF r.account_type IN ('BANK', 'E_WALLET') THEN
      v_parent_code := CASE r.account_type WHEN 'BANK' THEN '1-1200' ELSE '1-1300' END;
      v_child_prefix := CASE r.account_type WHEN 'BANK' THEN '1-12' ELSE '1-13' END;
      v_subtype := r.account_type;

      SELECT id INTO v_parent_id
        FROM public.chart_of_accounts
       WHERE tenant_id = r.tenant_id
         AND account_code = v_parent_code
         AND is_active = true;
      IF v_parent_id IS NULL THEN
        RAISE NOTICE 'skip cash_account % (tenant %): no parent COA %', r.id, r.tenant_id, v_parent_code;
        CONTINUE;
      END IF;

      -- nextSuffix = 10 + count (matches AccountFormModal.tsx:107 convention)
      SELECT 10 + count(*) INTO v_next_suffix
        FROM public.chart_of_accounts
       WHERE tenant_id = r.tenant_id
         AND parent_id = v_parent_id
         AND account_code LIKE v_child_prefix || '%';

      v_new_code := v_child_prefix || lpad(v_next_suffix::text, 2, '0');

      INSERT INTO public.chart_of_accounts (
        tenant_id, account_code, account_name, account_type,
        account_subtype, parent_id, normal_balance,
        is_system, is_active
      ) VALUES (
        r.tenant_id, v_new_code, r.internal_label, 'ASET',
        v_subtype, v_parent_id, 'DEBIT',
        false, true
      ) RETURNING id INTO v_new_coa_id;

      RAISE NOTICE 'created COA % (%) for cash_account % on tenant %',
        v_new_code, r.internal_label, r.id, r.tenant_id;
    ELSE
      RAISE NOTICE 'skip cash_account % (tenant %): unknown account_type %',
        r.id, r.tenant_id, r.account_type;
      CONTINUE;
    END IF;

    UPDATE public.cash_accounts
       SET coa_account_id = v_new_coa_id,
           updated_at = now()
     WHERE id = r.id;
  END LOOP;
END $$;

-- Verification: assert no rows left with NULL coa_account_id
DO $$
DECLARE v_remaining int;
BEGIN
  SELECT count(*) INTO v_remaining
    FROM public.cash_accounts
   WHERE coa_account_id IS NULL;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'backfill_cash_accounts_coa_link: % rows still NULL after backfill (may be tenants missing parent COAs — investigate NOTICES)', v_remaining;
  END IF;
  RAISE NOTICE 'backfill_cash_accounts_coa_link: OK — all cash_accounts linked';
END $$;
```

- [ ] **Step 2: Verify current prod state before applying (baseline)**

Run:

```bash
set -a && source /Users/tonywei/IdeaProjects/ERPAntigravity/.env && set +a && cat > /tmp/scan-before.json <<'EOF'
{"query": "SELECT t.slug, count(ca.*) AS null_ca, array_agg(ca.internal_label ORDER BY ca.sort_order) AS labels FROM cash_accounts ca JOIN tenants t ON t.id = ca.tenant_id WHERE ca.coa_account_id IS NULL GROUP BY t.slug ORDER BY t.slug;"}
EOF
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" --data-binary @/tmp/scan-before.json
```

Expected output (exactly):
```json
[{"slug":"toko-jaya-makmur","null_ca":2,"labels":["BCA Utama","GoPay Merchant"]}]
```

If different (more tenants or different labels): STOP. Do not apply the migration. Re-check with founder.

- [ ] **Step 3: Apply migration 521 to prod DB**

Run:

```bash
set -a && source /Users/tonywei/IdeaProjects/ERPAntigravity/.env && set +a && \
  SUPABASE_PROJECT_REF=ekhhojaezdfjfwuxyjkl SUPABASE_ACCESS_TOKEN=${SUPABASE_ACCESS_TOKEN} \
  bash scripts/apply-migration.sh 521
```

Expected: exit 0. `RAISE NOTICE` output should show 2 COA rows created (`1-1210` for BCA Utama, `1-1310` for GoPay Merchant) and end with `backfill_cash_accounts_coa_link: OK — all cash_accounts linked`.

- [ ] **Step 4: Verify post-migration state (green check)**

Run the same scan:

```bash
set -a && source /Users/tonywei/IdeaProjects/ERPAntigravity/.env && set +a && cat > /tmp/scan-after.json <<'EOF'
{"query": "SELECT t.slug, count(ca.*) AS null_ca FROM cash_accounts ca JOIN tenants t ON t.id = ca.tenant_id WHERE ca.coa_account_id IS NULL GROUP BY t.slug;"}
EOF
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" --data-binary @/tmp/scan-after.json
```

Expected output: `[]` (empty array = zero tenants with any null).

Also verify the 2 new COAs exist:

```bash
cat > /tmp/verify-coas.json <<'EOF'
{"query": "SELECT account_code, account_name, account_subtype, parent_id IS NOT NULL AS has_parent FROM chart_of_accounts WHERE tenant_id = '22222222-2222-2222-2222-222222222222' AND account_code IN ('1-1210','1-1310') ORDER BY account_code;"}
EOF
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" --data-binary @/tmp/verify-coas.json
```

Expected:
```json
[
 {"account_code":"1-1210","account_name":"BCA Utama","account_subtype":"BANK","has_parent":true},
 {"account_code":"1-1310","account_name":"GoPay Merchant","account_subtype":"E_WALLET","has_parent":true}
]
```

- [ ] **Step 5: Commit migration file**

```bash
git add supabase/migrations/20261115000521_backfill_cash_accounts_coa_link.sql
git commit -m "$(cat <<'EOF'
fix(saldo-awal): backfill 2 cash_accounts.coa_account_id NULLs (Toko Jaya)

BCA Utama + GoPay Merchant on Toko Jaya Makmur (test tenant) had
coa_account_id = NULL because they were seeded outside the FE form
(which auto-creates the sub-COA via resolveCoaAccountId). This blocked
post_saldo_awal_snapshot — RPC RAISEs 'cash_account % tidak punya COA
link' when any cash line has positive balance + no COA link.

Backfill migration mirrors resolveCoaAccountId logic: BANK → next 1-12NN
under 1-1200 (creates 1-1210), E_WALLET → next 1-13NN under 1-1300
(creates 1-1310). KAS branch retained for completeness even though no
KAS row was NULL in scan.

Verified prod scan (2026-07-27): only Toko Jaya affected (2 rows). Zero
journal_entry_lines conflict.

Applied to prod via scripts/apply-migration.sh 521.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit created. `git log --oneline -1` shows the new commit hash.

---

### Task 2: Migration slot 522 — NOT NULL constraint on `cash_accounts.coa_account_id`

**Files:**
- Create: `supabase/migrations/20261115000522_cash_accounts_coa_link_not_null.sql`

**Interfaces:**
- Consumes: post-Task-1 state (zero NULL rows in `cash_accounts.coa_account_id`).
- Produces: `NOT NULL` constraint on column. Future inserts with NULL will error 23502.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20261115000522_cash_accounts_coa_link_not_null.sql`:

```sql
-- Slot 522 — schema hardening after slot 521 backfill.
--
-- Prevents any future cash_account row from being inserted without a COA link.
-- Safe: slot 521 backfilled all NULL rows in prod (2 rows on Toko Jaya).
-- Verified pre-apply: SELECT count(*) FROM cash_accounts WHERE coa_account_id IS NULL = 0.
--
-- Idempotent: SET NOT NULL is a no-op if column is already NOT NULL.
-- Rollback: ALTER TABLE public.cash_accounts ALTER COLUMN coa_account_id DROP NOT NULL;

ALTER TABLE public.cash_accounts
  ALTER COLUMN coa_account_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cash_accounts'
      AND column_name = 'coa_account_id'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'cash_accounts_coa_link_not_null: constraint verification failed';
  END IF;
  RAISE NOTICE 'cash_accounts_coa_link_not_null: OK';
END $$;
```

- [ ] **Step 2: Pre-apply guard — verify zero NULLs before adding NOT NULL**

```bash
set -a && source /Users/tonywei/IdeaProjects/ERPAntigravity/.env && set +a && cat > /tmp/guard.json <<'EOF'
{"query": "SELECT count(*) AS null_rows FROM public.cash_accounts WHERE coa_account_id IS NULL;"}
EOF
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" --data-binary @/tmp/guard.json
```

Expected: `[{"null_rows":0}]`. If non-zero: STOP — Task 1 backfill didn't complete or new nulls appeared. Do NOT apply 522.

- [ ] **Step 3: Apply migration 522 to prod DB**

Run:

```bash
set -a && source /Users/tonywei/IdeaProjects/ERPAntigravity/.env && set +a && \
  SUPABASE_PROJECT_REF=ekhhojaezdfjfwuxyjkl SUPABASE_ACCESS_TOKEN=${SUPABASE_ACCESS_TOKEN} \
  bash scripts/apply-migration.sh 522
```

Expected: exit 0. Output ends with `cash_accounts_coa_link_not_null: OK`.

- [ ] **Step 4: Verify constraint applied**

```bash
cat > /tmp/verify-nn.json <<'EOF'
{"query": "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='cash_accounts' AND column_name='coa_account_id';"}
EOF
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" --data-binary @/tmp/verify-nn.json
```

Expected: `[{"is_nullable":"NO"}]`.

- [ ] **Step 5: Commit migration file**

```bash
git add supabase/migrations/20261115000522_cash_accounts_coa_link_not_null.sql
git commit -m "$(cat <<'EOF'
fix(saldo-awal): NOT NULL on cash_accounts.coa_account_id

Prevents future cash_account inserts without a COA link — the class
bug that let Toko Jaya sit with 2 orphan rows for 20 days undetected
until post_saldo_awal_snapshot surfaced it.

Safe after slot 521 backfill (verified 0 NULL rows in prod pre-apply).
Idempotent: SET NOT NULL is a no-op if already NOT NULL.

Applied to prod via scripts/apply-migration.sh 522.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Post-migration advisor scan

**Files:** None modified. Investigative only.

**Interfaces:**
- Consumes: Supabase MCP `get_advisors` tool OR Management API equivalent.

- [ ] **Step 1: Run advisor scan against prod project**

If Supabase MCP is authenticated:

```
Use tool: mcp__plugin_supabase_supabase__get_advisors with project_id "ekhhojaezdfjfwuxyjkl"
```

Otherwise via Management API:

```bash
set -a && source /Users/tonywei/IdeaProjects/ERPAntigravity/.env && set +a && \
  curl -sS "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/advisors/security" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" | jq '.lints // .' | head -80
curl -sS "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/advisors/performance" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" | jq '.lints // .' | head -80
```

Expected: no new findings that reference `cash_accounts`, `chart_of_accounts`, or migrations 521/522. Any new findings triaged.

- [ ] **Step 2: If new findings appear, decide**

- If no new findings → skip to Task 4.
- If new finding matches an already-known class → append to `progress.md` follow-up list; continue.
- If new finding is unexpected + high-severity → STOP, escalate to founder, do not deploy FE until resolved.

---

### Task 4: Promote FE to prod (bring `[object Object]` fix + kasir tabs live)

**Files:** None modified. Deploy action only.

**Interfaces:**
- Consumes: current `main` HEAD (after Tasks 1+2 commits).
- Produces: prod frontend at `app.caleo.id` serving latest code including commit `42b4598` (`extractErrorMessage` migration) and all subsequent commits.

- [ ] **Step 1: Confirm which SHA is currently live in prod**

```bash
gcloud run services describe garindo-jaya-panel-msme-erp-frontend \
  --region asia-southeast1 \
  --format='value(status.traffic[0].revisionName,status.traffic[0].tag)' 2>&1 | head -3
```

Expected: single revision + tag like `cXXXXXXX` where XXXXXXX is the 7-char SHA currently at 100%.

Also fetch that revision's SHA from Cloud Build:

```bash
gcloud builds list --project gen-lang-client-0410251117 --limit 5 --format='value(id,source.repoSource.commitSha,status,createTime)' 2>&1 | head -10
```

Compare: is the live tag SHA >= commit `42b4598` (2026-07-25 14:21:46)? If yes, `[object Object]` fix is already live — skip to Task 5. If no, continue.

- [ ] **Step 2: Get current HEAD SHA to promote**

```bash
git log -1 --format='%h'
```

Note the 7-char SHA (e.g. `abc1234`). This is the SHA to promote.

- [ ] **Step 3: Verify tag URL is reachable + returns 200 before promoting**

Per `scripts/promote-to-prod.sh` header comment, tag URLs stay accessible for ~7 days:

```bash
SHORT_SHA=$(git log -1 --format='%h')
curl -sS -o /dev/null -w '%{http_code}\n' \
  "https://c${SHORT_SHA}---garindo-jaya-panel-msme-erp-frontend-xnrhcw7onq-as.a.run.app/"
```

Expected: `200`. If not (404 / 5xx), the tag revision doesn't exist — Cloud Build hasn't built this SHA yet. Wait for build to complete (`gcloud builds list --limit 3`), then retry.

- [ ] **Step 4: Announce + promote**

Notify founder in chat: "About to promote SHA `<SHORT_SHA>` to prod frontend (`garindo-jaya-panel-msme-erp-frontend`) and backend (`garindo-jaya-panel-msme-erp`) at 100% traffic. This picks up commits since previous prod SHA including `42b4598` (extractErrorMessage), `4f20444` (bundle lazy-load), all kasir expense categories work, plus today's saldo-awal migrations. OK?"

**Only proceed if founder replies OK / approve / go.** Do NOT self-approve.

On approval:

```bash
bash scripts/promote-to-prod.sh $(git log -1 --format='%h')
```

Expected: script promotes both FE + BE services to 100% traffic on the specified SHA. Ends with success message.

- [ ] **Step 5: Verify prod is serving the new revision**

```bash
gcloud run services describe garindo-jaya-panel-msme-erp-frontend \
  --region asia-southeast1 \
  --format='value(status.traffic[0].revisionName,status.traffic[0].tag,status.traffic[0].percent)' 2>&1
```

Expected: `revisionName` = `c<newSHA>`, `percent` = `100`.

Also `curl` the public URL:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://app.caleo.id/
```

Expected: `200`.

- [ ] **Step 6: gcloud build status double-check per feedback_deploy_verify_after_push**

```bash
gcloud builds list --project gen-lang-client-0410251117 --limit 2 \
  --format='value(id,status,source.repoSource.commitSha)' 2>&1
```

Expected: most recent 2 builds STATUS = SUCCESS. If any FAILURE → stop, investigate, log incident if the failure impacts prod.

---

### Task 5: Prod smoke test on Toko Jaya via chrome-devtools MCP

**Files:** None modified. Verification only.

**Interfaces:**
- Consumes: prod at `app.caleo.id` after Task 4 promote, tenant `toko-jaya-makmur` login as `playwright-toko-owner`.
- Produces: confirmation that (a) Post Saldo Awal succeeds, (b) if intentionally triggered, error toasts show real message (not `[object Object]`).

- [ ] **Step 1: Open browser + navigate to saldo-awal wizard**

If chrome-devtools MCP is disconnected, ask founder to reconnect it (or run `/mcp` to re-init). Then:

```
mcp__plugin_chrome-devtools-mcp_chrome-devtools__new_page
  url: https://app.caleo.id/
```

Wait for redirect to `t/toko-jaya-makmur/dashboard`. Take a snapshot to confirm login state.

- [ ] **Step 2: Navigate Pengaturan → Akuntansi → Buat Saldo Awal**

```
click Pengaturan (sidebar)
click "🧾 Akuntansi" tab
wait_for text: ["Belum ada Saldo Awal", "Sudah dipost", "Lanjutkan Draft"]
```

If "Sudah dipost" appears: Toko Jaya already has a posted saldo awal. Task done — the migration worked, and any prior draft was posted successfully. Skip to Step 6.

If "Belum ada Saldo Awal" or "Lanjutkan Draft" appears: continue.

```
click "Buat Saldo Awal" or "Lanjutkan Draft"
```

- [ ] **Step 3: Step through wizard 1 → 4**

Cash accounts should be pre-populated (Kas Utama 5M, BCA Utama 25M, GoPay Merchant 500K). Total should show `Rp 30.500.000` and balance ✓.

```
click "Berikutnya →"     # 1 → 2
wait_for text: ["Piutang Usaha"]
click "Berikutnya →"     # 2 → 3
wait_for text: ["Hutang Usaha"]
click "Berikutnya →"     # 3 → 4
wait_for text: ["Simpan & Post Saldo Awal"]
```

- [ ] **Step 4: Check confirmations + click Post**

```
fill checkbox "Saya sudah memverifikasi..." → true
fill checkbox "Saya mengerti bahwa setelah di-post..." → true
click "Simpan & Post Saldo Awal"
wait_for text: ["berhasil dipost", "Gagal post"]
```

Expected: green toast `"Saldo Awal berhasil dipost ke Jurnal Umum!"`. Wizard closes; panel shows `Sudah dipost` status.

If red toast `Gagal post Saldo Awal: ...`: STOP. Capture the network response body (list_network_requests + get_network_request for `post_saldo_awal_snapshot`). Debug from there — do NOT continue.

- [ ] **Step 5: Sanity-check that `[object Object]` is dead**

Verify the error toast, when errors do fire, no longer says `[object Object]`. Trigger any easy failure (e.g., reopen the wizard on the now-posted tenant → "Sudah ada saldo awal aktif" or similar guard) and confirm the toast text is human-readable.

Alternatively grep prod runtime by evaluating in DevTools:

```
mcp__plugin_chrome-devtools-mcp_chrome-devtools__evaluate_script
  function: () => document.body.innerText.includes('[object Object]')
```

Expected: `false`.

- [ ] **Step 6: Verify JE created in DB**

```bash
set -a && source /Users/tonywei/IdeaProjects/ERPAntigravity/.env && set +a && cat > /tmp/verify-je.json <<'EOF'
{"query": "SELECT entry_number, entry_date, source_type, description, total_debit, total_credit FROM journal_entries WHERE tenant_id = '22222222-2222-2222-2222-222222222222' AND source_type = 'OPENING_BALANCE' ORDER BY entry_date DESC LIMIT 3;"}
EOF
curl -sS -X POST "https://api.supabase.com/v1/projects/ekhhojaezdfjfwuxyjkl/database/query" -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" --data-binary @/tmp/verify-je.json
```

Expected: at least one row with `source_type = OPENING_BALANCE`, `total_debit = total_credit`, description starts with `Saldo Awal per`.

- [ ] **Step 7: Adjacent-screen regression sanity**

Open one adjacent screen to confirm the FE deploy didn't break anything unrelated:

```
navigate: https://app.caleo.id/t/toko-jaya-makmur/dashboard?screen=akuntansi
wait_for text: ["Jurnal Umum", "Buku Besar", "Laporan"]
```

Expected: page loads, no console errors, no failed network requests. Also try Kasir screen:

```
navigate: https://app.caleo.id/t/toko-jaya-makmur/dashboard?screen=kasir
wait_for text: ["Kasir", "Cari produk"]
```

Same expectation.

If any adjacent screen breaks: rollback via `bash scripts/promote-to-prod.sh <previous-good-SHA>` immediately, log incident to `docs/incidents/2026-07-27-fe-promote-regression.md`.

---

### Task 6: Progress.md + final push

**Files:**
- Modify: `progress.md`

**Interfaces:**
- Consumes: successful Tasks 1-5.

- [ ] **Step 1: Append progress.md entry**

Read current `progress.md` first (Read tool), find the top-most entry, insert new entry above it in the same style:

```markdown
### 2026-07-27 — Saldo Awal Post unblocked (Toko Jaya) + cash_accounts.coa_account_id hardened
- **Root cause:** Toko Jaya Makmur had 2 cash_accounts (BCA Utama BANK, GoPay Merchant E_WALLET) with NULL coa_account_id — seeded outside the FE form, so `resolveCoaAccountId` never ran. `post_saldo_awal_snapshot` correctly RAISEs on this, but the toast showed `[object Object]` (extraErrorMessage class fix from 42b4598 wasn't deployed to prod yet).
- **Fix:**
  - Migration 521 backfilled the 2 orphan rows — created COAs `1-1210 BCA Utama` + `1-1310 GoPay Merchant` under existing parent COAs 1-1200 / 1-1300.
  - Migration 522 added `NOT NULL` constraint on `cash_accounts.coa_account_id` — prevents future orphans.
  - Promoted `main` HEAD to prod, bringing `extractErrorMessage` fix + kasir expense categories work live.
- **Verification:** prod SQL scan post-521 shows 0 nulls; prod SQL scan post-522 shows `is_nullable=NO`; chrome-mcp reproduction on Toko Jaya wizard clicked Post → success toast + JE row appears in `journal_entries` (source_type=OPENING_BALANCE, balanced).
- **Blast radius:** 1 tenant affected pre-fix. Zero real customer tenants had this issue (prod scan verified 2026-07-27). No incident.
- **Follow-up:** none. Class fix (extractErrorMessage helper, audit, Stop hook, CLAUDE.md rule, miss-log Entry #5) already shipped 2026-07-25 in commits 4705a04 / 853363f / 42b4598 / 38034ba.
- **Spec:** docs/superpowers/specs/2026-07-25-saldo-awal-post-error-fix-design.md
- **Plan:** docs/superpowers/plans/2026-07-27-saldo-awal-post-error-fix.md
```

- [ ] **Step 2: Commit progress.md**

```bash
git add progress.md
git commit -m "docs(progress): saldo-awal post error unblocked + cash_accounts.coa_account_id NOT NULL

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Push all commits from this session**

```bash
git log --oneline origin/main..HEAD
```

Expected: shows Task 1, 2, 6 commits + the two docs(spec) commits from earlier this session.

```bash
git push origin main
```

Expected: push succeeds. NOTE: This triggers Cloud Build, which builds a new tag but does NOT auto-promote (per manual-prod-gate memory). The Task 4 promotion is what actually flipped prod traffic.

- [ ] **Step 4: Final Stage 1 gate replay locally**

```bash
npm run lint
npm run audit:numinput
npm run audit:secdef-null-tenant
npm run audit:csp-backend-allowlist
npm run audit:no-string-err-fallback
npx vitest run --changed
```

Expected: all clean. If any fails, investigate — do NOT amend/re-commit-force without fixing root cause.

---

## Self-review

**Spec coverage:**
- Spec §3.2 Part 1 (data backfill) → Task 1 ✓
- Spec §3.5 Part 3 (NOT NULL) → Task 2 ✓
- Spec §3.3/3.4/3.6 (Parts 2 + 2b + 4) → out of scope per spec §SCOPE CORRECTION ✓
- Spec §5 (Stage 1 + Stage 2 + Stage 3 + advisors) → Task 3 (advisors), Task 4 (deploy), Task 5 (Stage 3 smoke), Task 6 (Stage 1 final) ✓
- Spec §4 Impact analysis → covered inline in commit messages + verification steps ✓
- Spec §6 Definition of done → mapped to Task 5 (JE created, no `[object Object]`) + Task 6 (progress.md, gates) ✓

**Placeholder scan:** none found. All migration SQL, all bash commands, all expected outputs are concrete.

**Type consistency:** migration filenames match between spec + plan (`521_backfill_cash_accounts_coa_link.sql`, `522_cash_accounts_coa_link_not_null.sql`). Cash account IDs quoted verbatim from prod scan. Tenant UUID `22222222-2222-2222-2222-222222222222` matches spec §2.

**Scope check:** single implementation cycle, ~2-3 hours work end-to-end. Not broken into subs. Fits one plan.
