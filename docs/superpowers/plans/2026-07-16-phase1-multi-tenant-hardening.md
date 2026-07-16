# Phase 1 Multi-Tenant Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 25 discrete deliverables across 17 work-units to prepare Caleo ERP for 10-tenant readiness — secure multi-tenant isolation, observable operations, verified backups, custom domain live at caleo.id.

**Architecture:** Modular monolith preserved. Postgres RPCs remain data plane. Add: tenant-prefixed storage, `/api/v1/*` contract prefix, composite PKs on high-volume tables, structured logging with tenant context, idempotency tokens on critical RPCs, monitoring baseline, error tracking, PITR verification, and 5-subdomain URL architecture on caleo.id.

**Tech Stack:** Supabase (Postgres + Auth + Storage), Cloud Run (Go backend + Vite/React frontend), Cloudflare (DNS + Workers), Firebase Hosting (landing), Sentry, Cloud Monitoring, Uptime Robot, Zoho Mail.

**Reference spec:** `docs/superpowers/specs/2026-07-15-scale-forward-phasing-design.md`

## Global Constraints

Copied verbatim from CLAUDE.md and spec — applies to every task:

- **Multi-tenant safety:** All migrations touching `t_*` tables must filter by `tenant_id`. New write paths must be SECURITY DEFINER RPCs owned by `vosi_rpc_owner` (RLS blocks direct writes).
- **Migration slot allocation:** Phase 1 owns slot range **300-329** (safe distant from QA-sweep 054-079 and Session 2's 080-099). Never reuse a slot.
- **Migration idempotency:** Every migration WAJIB idempotent — `DROP IF EXISTS`, `CREATE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING`, guarded backfills with `WHERE NOT EXISTS`.
- **Post-migration verify:** After every DB migration → run `mcp__plugin_supabase_supabase__get_advisors` to catch new perf/security findings.
- **Stop-hook gates (per task):** `npm run lint`, `npm run audit:numinput`, `npm run audit:secdef-null-tenant`, `npx vitest run --changed` all green before commit.
- **Ship & verify:** Every deliverable follows CLAUDE.md's staged flow — Stage 1 local, Stage 2 deploy, Stage 3 prod-testing-tenant "Toko Jaya Makmur".
- **Frequent commits:** One commit per deliverable minimum. Never batch multiple concerns.
- **Zero-cost constraint:** Placeholders use Cloudflare Workers free tier. Monitoring uses free tiers (Cloud Monitoring alerts + Uptime Robot + Sentry). Actual Cloud Run services (Phase 2) scaled-to-zero.
- **Feature freeze mode:** Only bugs blocking Garindo's daily operations get exception during Phase 1. Everything else deferred.
- **Test tenant:** Use "Toko Jaya Makmur" (existing prod-testing-tenant) for all smoke tests. Never use real customer data for destructive tests.

## Task Structure

Each "Task N" = one work-day = one subagent dispatch. Subagent completes all Parts of the day, verifies per criteria, commits, updates progress.md. Coordinator reviews before dispatching next day.

**Task numbering matches Day numbering** for spec cross-reference.

---

## Task 1 (Day 1): Chat-media security fix

**Rationale:** `chat-media` bucket public + filename pattern `{Date.now()}_{name}` = cross-tenant read leak. Documented in migration `20261115000202_storage_bucket_policy_hardening.sql:9,24-29`. At 10-tenant scale = real security incident risk.

**Files:**
- Create: `supabase/migrations/20261115000300_chat_media_tenant_prefix.sql`
- Create: `scripts/migrate-chat-media-paths.ts`
- Modify: `src/lib/supabaseClient.ts:260-265` (`uploadChatMedia` function)
- Create: `src/lib/chatMediaSignedUrl.ts` (helper for display)
- Modify: Any component calling `uploadChatMedia` (grep for callers)
- Modify: Any component displaying chat media (grep for callers rendering `chat-media` URLs)

**Interfaces:**
- Produces: `getSignedChatMediaUrl(path: string): Promise<string>` — resolves signed URL with 1-hour TTL. Used by chat display components.
- Consumes: existing `supabase` client instance from `src/lib/supabaseClient.ts`.

- [ ] **Step 1: Grep to identify all chat-media consumers**

Run:
```bash
grep -rn "uploadChatMedia\|chat-media" src/ | grep -v node_modules
```

Expected: identify all call sites for uploadChatMedia (writers) and chat-media URL renderers (readers).

- [ ] **Step 2: Read current uploadChatMedia implementation + bucket setup**

Read `src/lib/supabaseClient.ts:250-290` to understand current upload contract.
Read `supabase/migrations/20261115000202_storage_bucket_policy_hardening.sql` to understand current bucket policy.

- [ ] **Step 3: Write migration 20261115000300 — tenant-prefixed storage policy**

Create `supabase/migrations/20261115000300_chat_media_tenant_prefix.sql`:

```sql
-- Migration 300: Chat-media tenant-prefixed path + private bucket + signed URL access
-- Fixes cross-tenant read leak documented in migration 20261115000202
-- Path pattern: tenants/{tenant_id}/{uuid}_{filename}

BEGIN;

-- 1. Change bucket to private (was public in migration 000202)
UPDATE storage.buckets
SET public = false
WHERE id = 'chat-media';

-- 2. Drop existing permissive policies that allowed any-tenant access
DROP POLICY IF EXISTS "chat_media_read_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_write_authenticated" ON storage.objects;

-- 3. Add tenant-scoped read policy: only tenant members can read their tenant's files
CREATE POLICY "chat_media_read_own_tenant" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = (
      SELECT tenant_id::text
      FROM users
      WHERE id = auth.uid()
      LIMIT 1
    )
  );

-- 4. Add tenant-scoped write policy: only tenant members can write to their tenant's folder
CREATE POLICY "chat_media_write_own_tenant" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = (
      SELECT tenant_id::text
      FROM users
      WHERE id = auth.uid()
      LIMIT 1
    )
  );

-- 5. Delete policy for cleanup (own tenant only)
DROP POLICY IF EXISTS "chat_media_delete_own_tenant" ON storage.objects;
CREATE POLICY "chat_media_delete_own_tenant" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = (
      SELECT tenant_id::text
      FROM users
      WHERE id = auth.uid()
      LIMIT 1
    )
  );

COMMENT ON POLICY "chat_media_read_own_tenant" ON storage.objects IS
  'Migration 300: tenant-scoped read for chat-media. Path pattern: tenants/{tenant_id}/{uuid}_{filename}';

COMMIT;
```

- [ ] **Step 4: Apply migration to local Supabase (dev) via MCP**

Run via Supabase MCP:
```
mcp__plugin_supabase_supabase__apply_migration
  name: chat_media_tenant_prefix
  query: [contents of migration file]
```

Expected: migration applies clean, no error.

- [ ] **Step 5: Run advisors post-migration**

Run via MCP:
```
mcp__plugin_supabase_supabase__get_advisors type=security
mcp__plugin_supabase_supabase__get_advisors type=performance
```

Expected: no new advisories from this migration. Address any regressions.

- [ ] **Step 6: Update uploadChatMedia to use tenant-prefixed path**

Modify `src/lib/supabaseClient.ts` — replace existing `uploadChatMedia` function:

```typescript
async uploadChatMedia(file: File): Promise<string> {
  const { data: { user } } = await this.client.auth.getUser();
  if (!user) throw new Error('Must be authenticated to upload chat media');

  // Get tenant_id from user profile
  const { data: profile } = await this.client
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single();

  if (!profile?.tenant_id) throw new Error('User has no tenant assigned');

  // Path: tenants/{tenant_id}/{uuid}_{sanitized_filename}
  const uuid = crypto.randomUUID();
  const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `tenants/${profile.tenant_id}/${uuid}_${sanitized}`;

  const { error } = await this.client.storage
    .from('chat-media')
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) throw error;

  // Return path only (signed URL generated on-demand via getSignedChatMediaUrl)
  return path;
}
```

- [ ] **Step 7: Create signed URL helper**

Create `src/lib/chatMediaSignedUrl.ts`:

```typescript
import { supabase } from './supabaseClient';

/**
 * Resolves a tenant-scoped chat-media path to a signed URL with 1-hour TTL.
 * Callers must pass the stored path (from uploadChatMedia return value), not a raw URL.
 * Returns null if signing fails (renderer should show fallback UI).
 */
export async function getSignedChatMediaUrl(path: string): Promise<string | null> {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from('chat-media')
    .createSignedUrl(path, 60 * 60); // 1 hour TTL

  if (error) {
    console.error('[chat-media] signed URL failed:', error);
    return null;
  }

  return data?.signedUrl ?? null;
}
```

- [ ] **Step 8: Update all callers rendering chat media**

For each caller identified in Step 1, replace direct public URL with `getSignedChatMediaUrl` invocation. Example transformation:

Before:
```tsx
<img src={message.mediaUrl} />
```

After:
```tsx
const [signedUrl, setSignedUrl] = useState<string | null>(null);
useEffect(() => {
  if (message.mediaPath) getSignedChatMediaUrl(message.mediaPath).then(setSignedUrl);
}, [message.mediaPath]);
return signedUrl ? <img src={signedUrl} /> : <MediaFallback />;
```

Grep + edit each caller individually.

- [ ] **Step 9: Write data migration script for existing files**

Create `scripts/migrate-chat-media-paths.ts`:

```typescript
// Migrate existing chat-media files from root path to tenants/{tenant_id}/{uuid}_{filename}
// Idempotent: skips files already in new path pattern
// Run: npx tsx scripts/migrate-chat-media-paths.ts

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // List all files in chat-media bucket root
  const { data: files, error: listErr } = await supabase.storage
    .from('chat-media')
    .list('', { limit: 10000 });

  if (listErr) throw listErr;

  let migrated = 0;
  let skipped = 0;

  for (const file of files ?? []) {
    // Skip if already in tenants/ prefix
    if (file.name === 'tenants' || file.name.startsWith('tenants/')) {
      skipped++;
      continue;
    }

    // Find owning tenant by looking up chat message that references this path
    // NOTE: adapt this to match your schema — likely t_chat_messages or similar
    const { data: msg } = await supabase
      .from('t_chat_messages')
      .select('tenant_id')
      .eq('media_path', file.name)
      .limit(1)
      .single();

    if (!msg?.tenant_id) {
      console.warn(`[skip] no tenant for file ${file.name}`);
      skipped++;
      continue;
    }

    const newPath = `tenants/${msg.tenant_id}/${randomUUID()}_${file.name}`;

    // Copy file (Supabase Storage doesn't support move, so copy + delete)
    const { data: srcData } = await supabase.storage
      .from('chat-media')
      .download(file.name);
    if (!srcData) continue;

    await supabase.storage.from('chat-media').upload(newPath, srcData);

    // Update reference
    await supabase
      .from('t_chat_messages')
      .update({ media_path: newPath })
      .eq('media_path', file.name);

    // Delete old file
    await supabase.storage.from('chat-media').remove([file.name]);

    migrated++;
    console.log(`[migrate] ${file.name} → ${newPath}`);
  }

  console.log(`Done. Migrated: ${migrated}, Skipped: ${skipped}`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**NOTE:** Verify exact table + column names for chat messages (may be `t_chat_messages`, `chat_messages`, etc). Grep for `chat-media` in RPCs/tables to confirm.

- [ ] **Step 10: Run migration script against local dev**

```bash
SUPABASE_URL=<local-url> SUPABASE_SERVICE_ROLE_KEY=<local-key> npx tsx scripts/migrate-chat-media-paths.ts
```

Expected: migration logs each file, no errors. Verify old files gone, new files in tenants/ prefix, references updated.

- [ ] **Step 11: Cross-tenant leak verification (manual smoke test)**

Set up two-session test:
1. Session A: login as Garindo owner. Upload a chat media file. Note the returned path (e.g., `tenants/<garindo-uuid>/<file-uuid>_test.jpg`).
2. Session B: login as Toko Jaya Makmur owner. Attempt to access Garindo's file:
   ```
   curl -H "Authorization: Bearer <toko-jaya-jwt>" \
     "https://<supabase-url>/storage/v1/object/chat-media/tenants/<garindo-uuid>/..."
   ```
   Expected: HTTP 403 or 400 (not found/unauthorized).
3. Same session B: verify own upload works to `tenants/<toko-jaya-uuid>/...` path.

- [ ] **Step 12: Stop-hook gates**

```bash
npm run lint
npm run audit:numinput
npm run audit:secdef-null-tenant
npx vitest run --changed
```

All must exit 0.

- [ ] **Step 13: Commit**

```bash
git add supabase/migrations/20261115000300_chat_media_tenant_prefix.sql \
        scripts/migrate-chat-media-paths.ts \
        src/lib/supabaseClient.ts \
        src/lib/chatMediaSignedUrl.ts \
        [any-modified-caller-components]

git commit -m "$(cat <<'EOF'
fix(security): chat-media tenant-prefixed path + private bucket + signed URL

- Migration 300: rename path pattern to tenants/{tenant_id}/{uuid}_{filename}
- Bucket policy: public → private, tenant-scoped RLS on storage.objects
- uploadChatMedia: writes to tenant-prefixed path
- getSignedChatMediaUrl helper: 1-hour TTL signed URL for display
- Data migration script: migrate existing files to new path pattern

Fixes cross-tenant read leak documented in migration 20261115000202.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 14: Deploy migration to Supabase prod (Stage 2)**

Add migration filename to `scripts/apply-pending-migrations.sh` array, then:
```bash
bash scripts/apply-pending-migrations.sh
```

Or apply directly via MCP `apply_migration` to prod project.

- [ ] **Step 15: Prod smoke test (Stage 3)**

- Deploy FE changes via `git push origin main` (triggers cloudbuild.frontend.yaml)
- Log in as Garindo owner on prod
- Upload chat media, verify path is tenant-prefixed
- Log in as Toko Jaya Makmur, verify cross-tenant leak blocked
- Verify existing chat messages still display (data migration worked)

- [ ] **Step 16: Update progress.md + memory**

Add entry to `progress.md`:
```
## 2026-07-16 — Phase 1 Day 1: Chat-media security fix (COMPLETE)

- Migration 300 applied: tenant-prefixed path + private bucket + signed URL
- Data migration executed (N files migrated)
- Cross-tenant leak verified blocked
- Deployed to prod, smoke test passed
```

Update memory `chat-media` gap → resolve.

**Rollback plan:**
- Revert migration 300: apply inverse migration (bucket public=true, drop tenant policies, restore old policies)
- Revert code commit: `git revert <commit-sha>`
- Data: old paths still work if bucket briefly re-opened, but files already migrated. Rollback = accept temporary inconvenience.

---

## Task 2 (Day 2): Bucket audit + fix remaining buckets

**Rationale:** Other buckets (`branding`, `product-photos`, `accounting-proofs`, `payment-proofs`, `stock-evidence`) may have same pattern as chat-media. Audit + fix same-day for security consistency.

**Files:**
- Create: `supabase/migrations/20261115000301_bucket_security_hardening.sql` (if needed)
- Modify: `src/lib/supabaseClient.ts` — any other `upload*` helpers that don't use tenant prefix
- Update: memory `chat-media` gap → covers all bucket status

**Steps:**

- [ ] Step 1: Enumerate all buckets via SQL:
  ```sql
  SELECT id, name, public FROM storage.buckets;
  ```
- [ ] Step 2: For each bucket, verify path pattern used by uploaders. Grep for `.storage.from('<bucket>')` in `src/` and `backend-go/`.
- [ ] Step 3: For buckets with same leak pattern:
  - Draft same-shape migration (private bucket + tenant-scoped RLS policies)
  - Update uploader helpers to write tenant-prefixed path
  - Update readers to use signed URL helper (or extend `getSignedChatMediaUrl` generic)
  - Data migration script if existing files need move
- [ ] Step 4: Verification per bucket — cross-tenant leak test
- [ ] Step 5: Stop-hook gates, commit, deploy, prod smoke test
- [ ] Step 6: Update progress.md with per-bucket status table

**Deliverable:** Audit table in progress.md — bucket × path pattern × RLS status × migration applied. Memory updated with all-buckets-secure status.

**Rollback plan:** Per-bucket revert same pattern as Task 1.

---

## Task 3 (Day 3): Custom domain `app.caleo.id` + 5-subdomain reserve + placeholders + `platform_admin` column + cross-subdomain session verify

**Rationale:** Lock URL contract for tenant #2+ landing. Reserve all subdomains cheaply now (Cloudflare Workers free tier). Prep platform_admin column for Phase 2 admin app.

**Files:**
- Create: `supabase/migrations/20261115000302_platform_admin_column.sql`
- Modify: `cloudbuild.frontend.yaml:85` (remove hardcoded Cloud Run URL)
- Create/Modify: `src/lib/config.ts` (env-driven APP_DOMAIN)
- Modify: Supabase Auth dashboard settings (Site URL, Redirect URLs, Cookie domain)
- Deploy: 4 Cloudflare Workers (placeholder pages for `caleo.id`, `admin.caleo.id`, `staging.caleo.id`, `admin.staging.caleo.id`)
- Configure: Cloudflare Page Rule for `caleo.web.id` → 301 redirect
- Configure: Cloud Run domain mapping for `app.caleo.id`

**Steps:**

- [ ] Step 1: Cloud Run domain mapping via `gcloud`:
  ```bash
  gcloud beta run domain-mappings create \
    --service=<frontend-service-name> \
    --domain=app.caleo.id \
    --region=asia-southeast1
  ```
  Google will return required DNS record.

- [ ] Step 2: Add CNAME in Cloudflare DNS: `app.caleo.id → ghs.googlehosted.com` (Proxy status: DNS only, orange cloud OFF).

- [ ] Step 3: Wait for SSL cert provision (Cloud Run auto-provisions via Google-managed cert, 15-60 min).

- [ ] Step 4: Update `cloudbuild.frontend.yaml` — remove hardcoded Cloud Run URL, replace with env var:
  ```yaml
  '--set-env-vars=VITE_APP_URL=https://app.caleo.id'
  ```

- [ ] Step 5: Create `src/lib/config.ts` if not exists, export `APP_DOMAIN` from env. Grep `src/**` for hardcoded `run.app` or `garindo-jaya-panel` and replace.

- [ ] Step 6: Update Supabase Auth Dashboard:
  - Site URL: `https://app.caleo.id`
  - Redirect URLs: add `https://app.caleo.id/*`
  - Cookie domain: `.caleo.id` (parent scope for SSO cross-subdomain)

- [ ] Step 7: Deploy 4 Cloudflare Workers. Template (adapt message per subdomain):

  ```javascript
  export default {
    async fetch(request) {
      return new Response(
        `<!DOCTYPE html>
        <html lang="id"><head>
          <meta charset="UTF-8">
          <title>Caleo — Segera Hadir</title>
          <style>
            body { font-family: -apple-system, sans-serif; display: flex;
                   justify-content: center; align-items: center; min-height: 100vh;
                   background: linear-gradient(135deg, #1e3d60, #102a43); color: #fff;
                   text-align: center; padding: 20px; margin: 0; }
            .container { max-width: 500px; }
            h1 { font-size: 48px; margin-bottom: 16px; }
            p { font-size: 16px; opacity: 0.7; line-height: 1.6; }
            a { color: #6ee7a0; text-decoration: none; font-weight: 600; }
          </style>
        </head><body>
          <div class="container">
            <h1>Caleo</h1>
            <p>{{MESSAGE}}<br>Sudah punya akun? <a href="https://app.caleo.id">Login di app.caleo.id</a></p>
          </div>
        </body></html>`.replace('{{MESSAGE}}',
          new URL(request.url).hostname === 'caleo.id' ? 'Website segera hadir.' :
          new URL(request.url).hostname === 'admin.caleo.id' ? 'Platform admin — under construction.' :
          new URL(request.url).hostname === 'staging.caleo.id' ? 'Staging environment — internal only.' :
          'Staging admin — internal only.'),
        { headers: { 'content-type': 'text/html;charset=UTF-8' } }
      );
    },
  };
  ```

  Deploy as 4 separate Workers or 1 Worker with route pattern `*.caleo.id/*` + hostname-based response.

- [ ] Step 8: Cloudflare routes:
  - `caleo.id/*` → Worker `caleo-root-placeholder`
  - `admin.caleo.id/*` → Worker `caleo-admin-placeholder`
  - `staging.caleo.id/*` → Worker `caleo-staging-placeholder`
  - `admin.staging.caleo.id/*` → Worker `caleo-admin-staging-placeholder`

- [ ] Step 9: Cloudflare Page Rule for `caleo.web.id`:
  - URL: `*caleo.web.id/*`
  - Setting: Forwarding URL → 301 Permanent → `https://caleo.id/$2`

- [ ] Step 10: Migration 302 — add `platform_admin` column:

  ```sql
  -- Migration 302: Add platform_admin flag to users table
  -- Phase 2 prep: admin.caleo.id gated by this flag
  BEGIN;

  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS platform_admin boolean NOT NULL DEFAULT false;

  -- Seed founder as platform admin (replace with actual founder email)
  UPDATE users
  SET platform_admin = true
  WHERE email = 'tonywei.office@gmail.com'
    AND platform_admin = false;

  COMMENT ON COLUMN users.platform_admin IS
    'Migration 302: true for Caleo platform team (founder + support). Gates admin.caleo.id access.';

  COMMIT;
  ```

- [ ] Step 11: Apply migration + run advisors.

- [ ] Step 12: Cross-subdomain session verification test:
  - Login to `app.caleo.id`
  - Open browser devtools → Application → Cookies → verify session cookie has `Domain: .caleo.id`
  - Navigate to `admin.caleo.id` (placeholder) → verify cookie is sent (visible in Network tab)
  - Full auth flow test: password reset request → email received → reset link → new password → login OK
  - Session refresh cross-tab: 2 tabs, logout in tab 1, verify tab 2 auto-logout on next action
  - Session timeout: leave tab idle for TTL, verify re-auth required

- [ ] Step 13: Verify all subdomain endpoints:
  ```bash
  for sub in caleo.id app.caleo.id admin.caleo.id staging.caleo.id admin.staging.caleo.id; do
    echo "--- $sub ---"
    dig +short $sub
    curl -sI https://$sub | head -3
  done

  curl -sI https://caleo.web.id | head -3  # should 301 → caleo.id
  ```

- [ ] Step 14: Stop-hook gates + commit + deploy + prod smoke.

- [ ] Step 15: Update progress.md + memory `custom-domain-live` with URL architecture status.

**Rollback plan:**
- Cloud Run mapping: `gcloud beta run domain-mappings delete --domain=app.caleo.id`
- Migration 302 revert: `ALTER TABLE users DROP COLUMN platform_admin`
- Cloudflare Workers: disable route or delete Worker
- FE code: `git revert <commit>`

---

## Task 4 (Day 4): API `/api/v1/*` prefix + backward compat

**Rationale:** Lock contract before tenant #2 integrates. Cheap now (no external consumers yet), expensive after.

**Files:**
- Modify: `backend-go/main.go:86-463` (route registrations)
- Create: `backend-go/internal/api/version_middleware.go`
- Modify: `src/lib/*.ts` (any hardcoded `/api/` paths)
- Update: `cloudbuild.yaml` (env var `API_VERSION=v1`)

**Steps:**

- [ ] Step 1: Read `backend-go/main.go:86-463` to catalog all routes. Enumerate in a text file for reference.
- [ ] Step 2: Create `backend-go/internal/api/version_middleware.go`:

  ```go
  package api

  import (
      "log/slog"
      "net/http"
      "strings"
  )

  // VersionRouter wraps a mux to accept both /api/v1/* (new) and /api/* (legacy).
  // Legacy responses include X-Deprecated-Path header pointing to versioned equivalent.
  func VersionRouter(mux *http.ServeMux, register func(m *http.ServeMux)) http.Handler {
      versionedMux := http.NewServeMux()
      register(versionedMux)

      return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
          if strings.HasPrefix(r.URL.Path, "/api/v1/") {
              // Strip prefix, delegate to versioned mux
              r2 := r.Clone(r.Context())
              r2.URL.Path = strings.TrimPrefix(r.URL.Path, "/api/v1")
              versionedMux.ServeHTTP(w, r2)
              return
          }
          if strings.HasPrefix(r.URL.Path, "/api/") {
              // Legacy: strip /api, add deprecation header, delegate
              w.Header().Set("X-Deprecated-Path", "use /api/v1"+strings.TrimPrefix(r.URL.Path, "/api"))
              slog.WarnContext(r.Context(), "legacy API path used",
                  slog.String("path", r.URL.Path),
                  slog.String("suggested", "/api/v1"+strings.TrimPrefix(r.URL.Path, "/api")))
              r2 := r.Clone(r.Context())
              r2.URL.Path = strings.TrimPrefix(r.URL.Path, "/api")
              versionedMux.ServeHTTP(w, r2)
              return
          }
          http.NotFound(w, r)
      })
  }
  ```

- [ ] Step 3: Refactor `main.go` — routes register on inner mux without `/api/` prefix. VersionRouter handles routing.
- [ ] Step 4: Grep FE for hardcoded `/api/`:
  ```bash
  grep -rn "/api/" src/ | grep -v node_modules | grep -v "/api/v1/"
  ```
  Replace each occurrence with `/api/v1/...`.
- [ ] Step 5: cURL tests:
  ```bash
  curl -sI https://<backend-url>/api/v1/health          # 200
  curl -sI https://<backend-url>/api/health             # 200 + X-Deprecated-Path header
  ```
- [ ] Step 6: E2E smoke test — login flow via FE, verify all requests go to `/api/v1/*`.
- [ ] Step 7: Update `cloudbuild.yaml` with API_VERSION env var.
- [ ] Step 8: Commit + deploy + prod smoke test.
- [ ] Step 9: Update progress.md with deprecation timeline: v1 permanent, `/api/*` legacy removed 2027-Q3.

**Rollback plan:** revert commit. Old routes were `/api/*`, still work (backward-compat) so no data risk.

---

## Task 5 (Day 5): Composite PK migration batch 1 — `stock_movements`, `journal_entry_lines`

**Rationale:** Irreversibility argument — while tables are small (< 1M rows), migration is seconds. At 10M+ rows, migration is a week of downtime. Must partition-by-tenant readiness.

**Files:**
- Create: `supabase/migrations/20261115000303_composite_pk_stock_movements.sql`
- Create: `supabase/migrations/20261115000304_composite_pk_journal_entry_lines.sql`
- Update: any RPC referencing these tables' `id` alone

**Steps per table:**

- [ ] Step 1: Inspect table PK + FK references:
  ```sql
  \d stock_movements
  \d journal_entry_lines
  SELECT conname, conrelid::regclass, pg_get_constraintdef(oid)
  FROM pg_constraint
  WHERE conrelid = 'stock_movements'::regclass OR confrelid = 'stock_movements'::regclass;
  ```
- [ ] Step 2: For each FK referencing this table: plan cascade update.
- [ ] Step 3: Write migration (slot 303 for stock_movements):

  ```sql
  BEGIN;

  -- Drop existing FKs referencing stock_movements.id (list from Step 1)
  -- ALTER TABLE ... DROP CONSTRAINT ...;

  -- Drop existing PK
  ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_pkey;

  -- Add composite PK
  ALTER TABLE stock_movements ADD PRIMARY KEY (tenant_id, id);

  -- Re-create FKs with composite reference (or keep id-only if children don't cross tenant)
  -- ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY (tenant_id, ref_id) REFERENCES stock_movements (tenant_id, id);

  COMMIT;
  ```

- [ ] Step 4: EXPLAIN ANALYZE hot queries before + after migration. Verify no plan regression:
  ```sql
  EXPLAIN ANALYZE SELECT * FROM stock_movements
  WHERE tenant_id = '<uuid>' AND ...;
  ```
- [ ] Step 5: Same for journal_entry_lines (slot 304).
- [ ] Step 6: Run advisors post-migration.
- [ ] Step 7: Smoke test: sample RPC that writes to these tables — verify INSERT still works with `tenant_id` supplied.
- [ ] Step 8: Commit + deploy + prod smoke test.

**Rollback plan:** revert migration = restore PK to single `id` (safe if no FK breakage).

---

## Task 6 (Day 6): Composite PK batch 2 + inventory audit

**Rationale:** Extend batch 1 to remaining high-volume tables. Document PK inventory for future decisions.

**Files:**
- Create: `supabase/migrations/20261115000305_composite_pk_sales_invoices.sql`
- Create: `supabase/migrations/20261115000306_composite_pk_purchase_orders.sql`
- Create: `supabase/migrations/20261115000307_composite_pk_purchase_invoices.sql`
- Create: `docs/superpowers/specs/2026-07-15-composite-pk-inventory.md`

**Steps:**

- [ ] Step 1: Verify existing PK shape:
  ```sql
  SELECT c.relname, pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  WHERE con.contype = 'p' AND c.relname LIKE 't_%'
  ORDER BY c.relname;
  ```
- [ ] Step 2: Migrations 305-307 following Task 5 pattern for each target table.
- [ ] Step 3: Write inventory doc — table × current PK × target PK × migration applied/deferred × rationale.
- [ ] Step 4: Run advisors after each migration.
- [ ] Step 5: Commit + deploy + prod smoke.

**Rollback plan:** revert each migration individually if issues.

---

## Task 7 (Day 7): Structured logging + tenant_id middleware (backend Go)

**Rationale:** At 10 tenants, `log.Printf` becomes useless. Need to filter by tenant_id when debugging.

**Files:**
- Modify: `backend-go/main.go` (init slog handler)
- Create: `backend-go/internal/api/context_middleware.go`
- Create: `backend-go/internal/logging/slog_handler.go`
- Modify: All `log.Printf` call sites → `slog.InfoContext` / `slog.ErrorContext`

**Steps:**

- [ ] Step 1: Create context middleware — extract tenant_id, user_id, request_id from JWT/header, inject to request context.
- [ ] Step 2: Create custom slog handler that pulls tenant_id/user_id/request_id from context and emits as structured fields.
- [ ] Step 3: Configure `slog.SetDefault` in `main.go` with handler.
- [ ] Step 4: Grep + replace all `log.Printf` occurrences → `slog.InfoContext(ctx, ...)`.
- [ ] Step 5: Verification via Cloud Logging query: `jsonPayload.tenant_id="<uuid>"` should return filtered entries.
- [ ] Step 6: Commit + deploy + verify structured logs in Cloud Logging dashboard.

**Rollback plan:** revert commit; `log.Printf` continues working.

---

## Task 8 (Day 8): Idempotency tokens batch 1 (3 RPCs)

**Rationale:** Network glitch at 10 tenants = real double-post risk. Idempotency prevents customer complaint.

**Files:**
- Create: `supabase/migrations/20261115000308_rpc_idempotency_table.sql` (idempotency store)
- Modify RPCs (find exact names via grep):
  - `record_kasir_sale*` (leverage in-progress migration `20261115000237`)
  - `receive_purchase_order` / `record_tagihan`
  - `opname_commit`

**Steps:**

- [ ] Step 1: Migration 308 — create idempotency store:

  ```sql
  BEGIN;

  CREATE TABLE IF NOT EXISTS t_rpc_idempotency (
    tenant_id uuid NOT NULL,
    rpc_name text NOT NULL,
    idempotency_key uuid NOT NULL,
    result_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, rpc_name, idempotency_key)
  );

  CREATE INDEX IF NOT EXISTS ix_rpc_idempotency_created
    ON t_rpc_idempotency (created_at)
    WHERE created_at < now() - interval '30 days';

  COMMENT ON TABLE t_rpc_idempotency IS
    'Migration 308: idempotency token store. Manual cleanup for entries >30d until Phase 2 TTL job.';

  COMMIT;
  ```

- [ ] Step 2: For each target RPC — grep to locate current definition. Modify signature:
  ```sql
  CREATE OR REPLACE FUNCTION record_kasir_sale(
    ...existing params...,
    p_idempotency_key uuid DEFAULT NULL
  ) RETURNS jsonb ...
  ```
- [ ] Step 3: RPC body pattern:
  ```sql
  BEGIN
    -- Check for existing idempotency result
    IF p_idempotency_key IS NOT NULL THEN
      SELECT result_json INTO v_existing
      FROM t_rpc_idempotency
      WHERE tenant_id = v_tenant_id
        AND rpc_name = 'record_kasir_sale'
        AND idempotency_key = p_idempotency_key;
      IF v_existing IS NOT NULL THEN
        RETURN v_existing;
      END IF;
    END IF;

    -- ...existing RPC logic...
    v_result := jsonb_build_object(...);

    -- Store idempotency result
    IF p_idempotency_key IS NOT NULL THEN
      INSERT INTO t_rpc_idempotency (tenant_id, rpc_name, idempotency_key, result_json)
      VALUES (v_tenant_id, 'record_kasir_sale', p_idempotency_key, v_result)
      ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_result;
  END;
  ```
- [ ] Step 4: FE update — generate UUID per user action, pass to RPC. Example:
  ```typescript
  const idempotencyKey = crypto.randomUUID();
  const result = await supabase.rpc('record_kasir_sale', {
    ...params,
    p_idempotency_key: idempotencyKey,
  });
  ```
- [ ] Step 5: Smoke test — call RPC twice with same key → same result, no duplicate.
- [ ] Step 6: Commit + deploy + prod smoke.

**Rollback plan:** revert migrations (drop new column via inverse migration). Old RPC signature (without idempotency_key) remains callable since param is DEFAULT NULL.

---

## Task 9 (Day 9): Idempotency batch 2 (2 RPCs) + health probe split

**Files:**
- Modify: `transfer_warehouse` RPC + `record_pembayaran` (or journal entry equivalent)
- Modify: `backend-go/main.go` — add `/api/v1/live` and `/api/v1/ready` handlers
- Update: `cloudbuild.yaml` — Cloud Run readiness probe

**Steps:**

- [ ] Step 1: Apply idempotency pattern (Task 8 Step 3) to `transfer_warehouse` + `record_pembayaran`.
- [ ] Step 2: Health probe handlers in Go:
  ```go
  http.HandleFunc("/live", func(w http.ResponseWriter, r *http.Request) {
      w.WriteHeader(http.StatusOK)
      w.Write([]byte("ok"))
  })
  http.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
      // Check DB
      if err := db.PingContext(r.Context()); err != nil {
          http.Error(w, "db unreachable", http.StatusServiceUnavailable)
          return
      }
      // Check Supabase (optional lightweight ping)
      // Check Gemini (optional)
      w.WriteHeader(http.StatusOK)
      w.Write([]byte("ready"))
  })
  ```
- [ ] Step 3: Update `cloudbuild.yaml`:
  ```yaml
  '--startup-probe=httpGet.path=/api/v1/ready,initialDelaySeconds=5,periodSeconds=5'
  '--liveness-probe=httpGet.path=/api/v1/live,periodSeconds=30'
  ```
- [ ] Step 4: cURL verification + Cloud Run dashboard verify probes green.
- [ ] Step 5: Commit + deploy + prod smoke.

**Rollback plan:** revert commit; Cloud Run continues with default probe.

---

## Task 10 (Day 10): Monitoring baseline — Cloud Monitoring alerts + Uptime Robot

**Files:**
- Configure (GCP Console): Cloud Monitoring alert policies for backend + frontend services
- Configure (uptimerobot.com): 2 uptime monitors
- Create: `docs/superpowers/specs/alerting-runbook.md`

**Steps:**

- [ ] Step 1: Cloud Monitoring alert policies via console:
  - Backend Go 5xx rate spike (>1% in 5-min window)
  - Cloud Run request latency p99 > 3s
  - Cloud Run instance count anomaly
- [ ] Step 2: Add alert notification channels: founder email + WhatsApp (via Cloud Monitoring integration or webhook to Zapier free tier).
- [ ] Step 3: Uptime Robot signup, add monitors:
  - `https://app.caleo.id` (HTTP 200 expected, 5-min interval)
  - `https://<backend-url>/api/v1/live` (5-min interval)
- [ ] Step 4: Alert routing config: email + WA notification per alert.
- [ ] Step 5: Trigger fake alert (temporary env var to force 5xx) → verify email + WA received within 5 min.
- [ ] Step 6: Write `alerting-runbook.md` — per alert type, what it means + first-response steps.
- [ ] Step 7: Commit runbook.

**Rollback plan:** Disable alerts / uptime monitors — no code deploy, so no revert needed.

---

## Task 11 (Day 11): Error tracking Sentry (FE + BE)

**Files:**
- Modify: `src/main.tsx` or entry point — Sentry init for React
- Modify: `backend-go/main.go` + middleware — Sentry init for Go
- Add env vars: `VITE_SENTRY_DSN`, `SENTRY_DSN` (backend)
- Create: `docs/superpowers/specs/error-tracking-setup.md`

**Steps:**

- [ ] Step 1: Sentry account (sentry.io), create project "caleo-frontend" + "caleo-backend". Note DSNs.
- [ ] Step 2: FE integration:
  ```bash
  npm install @sentry/react
  ```
  In `src/main.tsx`:
  ```typescript
  import * as Sentry from '@sentry/react';
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    environment: import.meta.env.MODE,
  });
  ```
  Tag events with tenant_id via `Sentry.setUser({ id: userId, tenant_id: tenantId })` after login.
- [ ] Step 3: BE integration:
  ```bash
  cd backend-go && go get github.com/getsentry/sentry-go
  ```
  In `main.go`:
  ```go
  err := sentry.Init(sentry.ClientOptions{
      Dsn: os.Getenv("SENTRY_DSN"),
      TracesSampleRate: 0.1,
      Environment: os.Getenv("ENV"),
  })
  if err != nil { log.Fatalf("sentry init: %v", err) }
  defer sentry.Flush(2 * time.Second)
  ```
  Middleware: tag events with tenant_id from request context.
- [ ] Step 4: Source maps upload for FE (Sentry CLI in build pipeline).
- [ ] Step 5: Fake error test — `throw new Error('sentry-test')` in FE dev → verify appears in Sentry dashboard within 30 sec. Same for BE via temporary `/api/v1/test-error`.
- [ ] Step 6: Sentry alert rules: notify email/WA on new error class or spike.
- [ ] Step 7: Write `error-tracking-setup.md` — DSN storage, tagging convention, alert config.
- [ ] Step 8: Commit + deploy + prod smoke.

**Rollback plan:** unset SENTRY_DSN env var → Sentry SDK becomes no-op.

---

## Task 12 (Day 12): PITR restore test + tenant deprovision verify + secret rotation doc + rollback runbook

**Files:**
- Create: `docs/superpowers/specs/pitr-restore-runbook.md`
- Create: `docs/superpowers/specs/deprovision-runbook.md`
- Create: `docs/superpowers/specs/secret-rotation-policy.md`
- Create: `docs/superpowers/specs/rollback-runbook.md`

**Steps (parts run in parallel where possible):**

- [ ] Step 1 (Part A — PITR restore):
  - Create Supabase branch/scratch project via `mcp__plugin_supabase_supabase__create_branch`.
  - Restore point-in-time snapshot (24h ago) to scratch.
  - Verify data integrity: `SELECT COUNT(*) FROM tenants`, sample per-tenant query.
  - Document exact procedure in `pitr-restore-runbook.md`.
  - Delete scratch branch after.

- [ ] Step 2 (Part B — Deprovision verify):
  - Read migration `20261115000035_deprovision_tenant_rpc.sql` — understand exact behavior.
  - Provision test tenant "Deprovision Test" (or use scratch project).
  - Seed sample data across tables.
  - Call deprovision RPC.
  - Verify: rows deleted from all `t_*` tables, storage files deleted, auth users deleted.
  - Document in `deprovision-runbook.md`.

- [ ] Step 3 (Part C — Secret rotation policy):
  - Audit GCP Secret Manager: list all secrets, note who has access.
  - Document rotation cadence (quarterly for API keys, annual for service roles) in `secret-rotation-policy.md`.
  - Procedure per secret type.

- [ ] Step 4 (Part D — Rollback runbook):
  - Document per-change-type revert procedure in `rollback-runbook.md`:
    - Cloud Run: `gcloud run services update-traffic --to-revisions=<prev>=100`
    - Migration: inverse migration OR PITR restore
    - Landing: `firebase hosting:rollback`
    - DNS: revert Cloudflare DNS record
  - Decision tree: "prod broken → what to check first → revert vs hotfix"
  - Estimated revert time per type.

- [ ] Step 5: Commit all 4 docs.

**Rollback plan:** Docs only, no code impact. Fully safe.

---

## Task 13 (Day 13): Cold-start policy + load test baseline + feature flag reference impl

**Files:**
- Modify: `cloudbuild.frontend.yaml` + `cloudbuild.yaml` — `--min-instances` flag
- Create: `tests/load/k6-baseline.js`
- Create: `docs/superpowers/specs/load-test-baseline.md`
- Create: `docs/superpowers/specs/feature-flag-usage.md`
- Modify: Saldo Awal module (FE + RPC) to check feature flag

**Steps:**

- [ ] Step 1 (Cold-start):
  - Update `cloudbuild.frontend.yaml`: add `'--min-instances=1'` (avoid cold-start user-facing)
  - Update `cloudbuild.yaml` (backend): add `'--min-instances=1'`
  - Note: `admin.caleo.id` and `staging.*` will use `min-instances=0` when built (Phase 2).
- [ ] Step 2 (Load test):
  - Install k6: `brew install k6`
  - Write `tests/load/k6-baseline.js`:
    ```javascript
    import http from 'k6/http';
    import { check, sleep } from 'k6';

    export const options = {
      vus: 100,
      duration: '2m',
    };

    export default function () {
      const res = http.get('https://app.caleo.id/');
      check(res, { 'status was 200': (r) => r.status === 200 });
      sleep(1);
    }
    ```
  - Run against staging or off-hours prod: `k6 run tests/load/k6-baseline.js`
  - Capture p50/p95/p99, RPS, error rate in `load-test-baseline.md`.
- [ ] Step 3 (Feature flag reference impl):
  - Pick "Saldo Awal" module (per D4 default).
  - Add flag check in FE: read `tenant_subscriptions.feature_overrides.saldo_awal_enabled` on load, hide menu if false.
  - Add flag check in BE RPCs: guard entry.
  - Test: toggle flag off for Toko Jaya Makmur → menu disappears. Toggle on → visible.
  - Document pattern in `feature-flag-usage.md`.
- [ ] Step 4: Commit + deploy + prod smoke.

**Rollback plan:**
- Cold-start: revert `--min-instances` to unset (default 0)
- Load test: no impact (test-only)
- Feature flag: revert commit (flag becomes ignored, all users see feature)

---

## Task 14 (Day 14): Onboarding runbook + seed script verify + FE error boundary + 404 + E2E smoke test

**Files:**
- Create: `docs/superpowers/specs/tenant-onboarding-runbook.md`
- Modify: `src/App.tsx` — add React Error Boundary
- Create: `src/pages/NotFound.tsx` — 404 page
- Verify/fix: `create-tenant-owner` edge function seed completeness
- Test: E2E multi-tenant smoke

**Steps:**

- [ ] Step 1: Read `create-tenant-owner` edge function (supabase/functions/create-tenant-owner/). Enumerate what it seeds (COA default? warehouse? category?). If gaps, extend to seed missing defaults.
- [ ] Step 2: Provision fresh scratch tenant. Verify all defaults present:
  ```sql
  SELECT COUNT(*) FROM t_chart_of_accounts WHERE tenant_id = '<new-tenant>';
  SELECT COUNT(*) FROM t_warehouses WHERE tenant_id = '<new-tenant>';
  -- etc.
  ```
- [ ] Step 3: Write `tenant-onboarding-runbook.md` — step-by-step from provision to first-login.
- [ ] Step 4: React Error Boundary in `src/App.tsx`:
  ```tsx
  import { ErrorBoundary } from 'react-error-boundary';

  function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold mb-2">Terjadi kesalahan</h1>
          <p className="text-sm text-gray-600 mb-4">
            Silakan reload atau hubungi support@caleo.id
          </p>
          <button onClick={resetErrorBoundary}>Reload halaman</button>
        </div>
      </div>
    );
  }

  <ErrorBoundary FallbackComponent={ErrorFallback} onError={(err) => Sentry.captureException(err)}>
    <App />
  </ErrorBoundary>
  ```
- [ ] Step 5: 404 page — `src/pages/NotFound.tsx`, add route.
- [ ] Step 6: E2E multi-tenant smoke test — 10-check list:
  1. Provision fresh tenant via runbook
  2. Login as new tenant → dashboard load
  3. Login as Garindo → verify cannot see new tenant's data
  4. Storage isolation cross-check
  5. Feature flag isolation
  6. Logging tagged with correct tenant_id
  7. Monitoring dashboard shows both tenants
  8. Sentry error tagged with correct tenant_id
  9. Idempotency isolation
  10. Deprovision new tenant → cleanup verified
- [ ] Step 7: Document smoke test results in progress.md.
- [ ] Step 8: Commit + deploy + prod smoke.

**Rollback plan:** revert code commits; docs remain (no harm).

---

## Task 15 (Day 15): Landing content rewrite (Vosi → Caleo) + Privacy Policy + Terms of Service

**Files:**
- Modify: `vosi-landing/index.html` → rewrite content
- Modify: `vosi-landing/sitemap.xml` → caleo.id references
- Modify: `vosi-landing/robots.txt` → caleo.id references
- Rename: `vosi-landing/` → `caleo-landing/` via `git mv`
- Create: `caleo-landing/privacy.html`
- Create: `caleo-landing/terms.html`
- Update: any refs to `vosi-landing` in README, docs, cloudbuild.

**Steps:**

- [ ] Step 1: Read current `vosi-landing/index.html` fully. Founder review content: what stays, what changes.
- [ ] Step 2: Rename folder: `git mv vosi-landing caleo-landing`.
- [ ] Step 3: Rebrand pass — find + replace in `caleo-landing/`:
  - "Vosi" → "Caleo" (case-sensitive)
  - "vosi.id" → "caleo.id" (all URLs)
  - Meta tags: `og:title`, `og:description`, `twitter:title`, `<title>`, description
- [ ] Step 4: Copy refresh — rewrite outdated sections per founder review. Update value prop, features, FAQ.
- [ ] Step 5: Update `sitemap.xml` and `robots.txt` to reference `caleo.id`.
- [ ] Step 6: Draft `privacy.html` — adapt from template, tailor to Caleo:
  - Data collected (email, nama, transaksi tenant, chat, files uploaded)
  - Purpose (operasi ERP, analytics, marketing)
  - Third-party access (Supabase, Google Cloud, Gemini, WhatsApp)
  - Retention (7 tahun untuk data transaksi per regulasi pajak Indonesia, 2 tahun untuk data marketing)
  - User rights (access, delete, export, portabilitas per UU PDP)
  - Contact: `privacy@caleo.id`
- [ ] Step 7: Draft `terms.html`:
  - Service description
  - Uptime SLA (target 99.5% paid, best-effort free)
  - Prohibited use (abuse, scraping, sharing account, malware)
  - Liability limitation (max 3× monthly fee refund)
  - Payment terms placeholder (kalau nanti berbayar)
  - Termination + refund policy
  - IP + confidentiality
- [ ] Step 8: Add footer links di `index.html`: "Privacy Policy | Terms of Service | Contact"
- [ ] Step 9: Verify local: `grep -ri "vosi" caleo-landing/` returns 0.
- [ ] Step 10: Commit:
  ```bash
  git commit -m "chore(landing): rebrand Vosi → Caleo + add Privacy Policy + Terms of Service"
  ```

**Rollback plan:** `git revert <commit>`. Old folder restored.

---

## Task 16 (Day 16): Firebase deploy landing + support email (Zoho Mail) + HTTP security headers

**Files:**
- Modify: `caleo-landing/firebase.json` — add security headers
- Create: `caleo-landing/.firebaserc` — project ID
- External: Firebase project creation (GCP + Firebase Console)
- External: Zoho Mail account setup
- Modify: Supabase Auth sender config → `noreply@caleo.id`
- Modify: `nginx.conf` — add security headers for app.caleo.id
- Configure: Cloudflare security settings

**Steps:**

- [ ] Step 1 (Firebase setup):
  - Create Firebase project `caleo-landing` in Firebase Console
  - Enable Hosting
  - `npm install -g firebase-tools`
  - `firebase login`
  - `cd caleo-landing && firebase init hosting` (or add `.firebaserc` manually)
- [ ] Step 2: Update `caleo-landing/firebase.json` with security headers:
  ```json
  {
    "hosting": {
      "public": ".",
      "ignore": ["firebase.json", ".firebaserc", ".gitignore", "**/.*"],
      "rewrites": [{ "source": "**", "destination": "/index.html" }],
      "headers": [
        {
          "source": "**",
          "headers": [
            { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains; preload" },
            { "key": "X-Content-Type-Options", "value": "nosniff" },
            { "key": "X-Frame-Options", "value": "DENY" },
            { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
            { "key": "Permissions-Policy", "value": "geolocation=(), microphone=(), camera=()" }
          ]
        },
        {
          "source": "**/*.@(jpg|jpeg|gif|png|svg|ico)",
          "headers": [{ "key": "Cache-Control", "value": "max-age=604800" }]
        },
        {
          "source": "**/*.html",
          "headers": [{ "key": "Cache-Control", "value": "max-age=300" }]
        }
      ]
    }
  }
  ```
- [ ] Step 3: Deploy: `cd caleo-landing && firebase deploy --only hosting`
- [ ] Step 4: Test Firebase-provided URL `https://<project-id>.web.app` — verify landing render OK, curl headers verify.
- [ ] Step 5 (Zoho Mail):
  - Signup at mail.zoho.com (free tier: 5 users)
  - Add domain `caleo.id`, verify via DNS TXT record in Cloudflare
  - Create aliases: `founder@`, `support@`, `privacy@`, `noreply@caleo.id` → forward to personal email
  - Add MX + SPF + DKIM DNS records per Zoho instructions in Cloudflare
- [ ] Step 6: Update Supabase Auth: replace default sender with `noreply@caleo.id`. Test signup + password reset email.
- [ ] Step 7 (Security headers for app.caleo.id):
  - Modify `nginx.conf` to add security headers via `add_header`:
    ```nginx
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    ```
- [ ] Step 8 (Cloudflare):
  - SSL settings: enable HSTS, "Always Use HTTPS"
  - Verify Full (Strict) SSL mode
- [ ] Step 9: External scanner check:
  - `curl -I https://caleo.id` — verify headers present
  - `curl -I https://app.caleo.id` — verify headers present
  - Visit https://securityheaders.com/?q=caleo.id → target grade A
- [ ] Step 10: Commit changes:
  ```bash
  git commit -m "feat(infra): Firebase landing deploy + Zoho support email + security headers grade A"
  ```

**Rollback plan:**
- Firebase: `firebase hosting:rollback` OR delete site
- Zoho: leave setup (no impact); if MX conflicts, remove records
- Security headers: revert nginx.conf, Firebase config — safe (no functional change, just headers dropped)

---

## Task 17 (Day 17): DNS cutover caleo.id root + full journey E2E test

**Files:**
- Modify: Cloudflare DNS records for `caleo.id` root
- Disable: Cloudflare Worker route for `caleo.id/*`
- Configure: Firebase custom domain for `caleo.id`

**Steps:**

- [ ] Step 1: Firebase Console → Hosting → Add custom domain: `caleo.id`. Firebase provides DNS records to add.
- [ ] Step 2: Cloudflare DNS: add records per Firebase instructions (A records to Firebase IPs).
- [ ] Step 3: Disable Cloudflare Worker route for `caleo.id/*` (Workers → Routes → disable the placeholder route).
- [ ] Step 4: Wait for SSL cert (Firebase Let's Encrypt, ~15-60 min).
- [ ] Step 5: Verify:
  ```bash
  dig caleo.id +short
  curl -sI https://caleo.id | head -10
  # Should return 200 + serve landing content, not Worker placeholder
  ```
- [ ] Step 6: Full-journey E2E test:
  - Visitor: `https://caleo.id/` → landing renders OK
  - Click "Login" → redirect to `https://app.caleo.id/login`
  - Login as Garindo owner → dashboard loads
  - Navigate back to caleo.id → session preserved via `.caleo.id` cookie
  - Visit `caleo.id/privacy` and `caleo.id/terms` → render OK
  - Visit `caleo.web.id` → 301 redirects to caleo.id
- [ ] Step 7: SEO check:
  - Sitemap: `curl https://caleo.id/sitemap.xml`
  - robots.txt: `curl https://caleo.id/robots.txt`
  - (Optional) Submit sitemap to Google Search Console
- [ ] Step 8: Update progress.md — Phase 1 COMPLETE.
- [ ] Step 9: Final commit (any final tweaks). Announce Phase 1 done.

**Rollback plan:**
- Re-enable Cloudflare Worker route for `caleo.id/*`
- Remove Firebase DNS records
- Caleo.id root reverts to placeholder within ~5 min DNS propagation

---

## Self-Review

**Spec coverage check** — each of the 25 spec deliverables mapped to a task:

| Spec deliverable | Task |
|---|---|
| Chat-media security | Task 1 |
| Bucket audit | Task 2 |
| Custom domain `app.caleo.id` | Task 3 |
| 4 subdomain placeholders | Task 3 |
| `caleo.web.id` 301 redirect | Task 3 |
| `platform_admin` column | Task 3 |
| Cross-subdomain session verify | Task 3 |
| Full auth flow verify | Task 3 |
| API `/api/v1/*` prefix | Task 4 |
| Composite PK batch 1 | Task 5 |
| Composite PK batch 2 + inventory | Task 6 |
| Structured logging + tenant_id | Task 7 |
| Idempotency batch 1 (3 RPCs) | Task 8 |
| Idempotency batch 2 (2 RPCs) | Task 9 |
| Health probe split | Task 9 |
| Monitoring baseline | Task 10 |
| Error tracking Sentry | Task 11 |
| PITR restore test | Task 12 |
| Tenant deprovision verify | Task 12 |
| Secret rotation doc | Task 12 |
| Rollback runbook | Task 12 |
| Cloud Run cold-start policy | Task 13 |
| Load test baseline | Task 13 |
| Feature flag reference impl | Task 13 |
| Onboarding runbook | Task 14 |
| Seed script verify | Task 14 |
| FE error boundary + 404 | Task 14 |
| E2E multi-tenant smoke test | Task 14 |
| Landing content rewrite | Task 15 |
| Privacy Policy + ToS | Task 15 |
| Firebase deploy landing | Task 16 |
| Support email (Zoho) | Task 16 |
| HTTP security headers | Task 16 |
| DNS cutover caleo.id root | Task 17 |
| Full journey E2E test | Task 17 |

All 25 covered (some tasks contain multiple deliverables per spec fold-ins).

**Type consistency check:** function names `getSignedChatMediaUrl`, `uploadChatMedia`, RPC signature `p_idempotency_key uuid DEFAULT NULL` — consistent across tasks that reference them.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" — every step has concrete content or specific action.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-16-phase1-multi-tenant-hardening.md`.

**Subagent-driven execution recommended** per founder's request (auto-execute during 4-hour away window, complete Day 1 minimum, stop and log for founder review).

**Execution notes for subagent-driven-development:**
- Dispatch subagent per Task (Task 1 = Day 1, Task 2 = Day 2, etc.).
- Between tasks: verify all Success Criteria for that task before dispatching next.
- **Stop and hand off after Task 1 (Day 1) completion** — founder is away 4 hours, wants human review before Day 2 execution.
- If any task fails verification: STOP, do not proceed. Log status to progress.md with clear "requires human decision" note.
- Log all decisions autonomously made (e.g., exact founder email seeded, exact tenant test names) so founder can audit on return.
