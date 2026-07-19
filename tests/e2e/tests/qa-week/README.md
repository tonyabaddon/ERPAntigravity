# QA Week Playwright Specs

**Purpose:** Day 1+ UI phase execution for the QA week per `docs/superpowers/specs/2026-07-19-qa-week-comprehensive-design.md`.

**Fixtures used:** `../fixtures/auth.ts` — `tenantPage` (Toko Jaya Makmur owner) + `adminPage` (platform admin). Credentials in `.env` (`PLAYWRIGHT_TOKO_*`, `PLAYWRIGHT_ADMIN_*`).

## Design

- **Read-only navigation smokes** (no data pollution) — safe to run on prod against Toko Jaya Makmur.
- **Write-path tests** clearly marked and gated by env var `PLAYWRIGHT_ALLOW_WRITES=1`. Default OFF.
- Each spec exercises a golden path + 1-2 negative/edge cases per the scenario matrix (12 functional categories).

## Run

```bash
cd tests/e2e
# Read-only smokes (safe):
npx playwright test tests/qa-week/*-readonly.spec.ts

# Write tests (only after founder OK):
PLAYWRIGHT_ALLOW_WRITES=1 npx playwright test tests/qa-week/*-write.spec.ts
```

## Files

- `t0-auth-readonly.spec.ts` — Auth flow states (login page reachable, tenant selection, error screens)
- `t0-multi-tenant-isolation-readonly.spec.ts` — Direct URL to tenant B → expect 404/access-denied
- `t1-master-data-readonly.spec.ts` — Produk / Pelanggan / Stok / Kas & Bank read paths
- `t2-pos-golden-path-write.spec.ts` — Kasir POS golden path (**WRITES** — gated)
- `t2-pembelian-po-golden-path-write.spec.ts` — PO → Receive → Tagihan → Bayar chain (**WRITES**)
- `t2-warehouse-transfer-readonly.spec.ts` — Warehouse transfer list/detail read
- `t3-akuntansi-readonly.spec.ts` — GL + Laporan reads
- `t3-rekonsiliasi-readonly.spec.ts` — Rekonsiliasi wizard (read initial state, no write)
- `t7-admin-readonly.spec.ts` — Admin dashboard views (platform admin fixture)

## Status: skeleton — not yet expanded

Each spec has:
- Fixture import
- Base `test.describe` block
- 2-4 `test('...')` blocks with `TODO(qa-week)` marker + one navigation step
- No assertions yet (or trivial "page loads" assertion)

Founder to green-light before expansion + execution.
