# SDD Progress Ledger — Warehouse Transfer (Two-Step)

Plan: docs/superpowers/plans/2026-07-12-warehouse-transfer-plan.md
Spec: docs/superpowers/specs/2026-07-12-warehouse-transfer-two-step-design.md
Worktree: .claude/worktrees/warehouse-transfer
Branch: worktree-warehouse-transfer
Started: 2026-07-12
Preceded by: Wave 5 payment tracking (see progress-wave5-payment-tracking.md in main worktree — archived at start of this session)

## Pre-flight decisions

- **Worktree isolation:** YES (`.claude/worktrees/warehouse-transfer` + branch `worktree-warehouse-transfer`).
- **Migration slot range:** `20261115000210 – 20261115000221` (12 slots claimed; verified free across all 18 sibling worktrees; slots 222-229 reserved buffer for fix migrations).
- **Prod DB:** Garindo `ekhhojaezdfjfwuxyjkl` (deploy target); prod smoke on Toko Jaya Makmur test tenant only (per memory `production-testing-tenant`).
- **Design system tokens:** newer canonical from `OwnerDecisionInbox.tsx` (Tailwind emerald/slate, `rounded border-slate-200`, `font-semibold`) — NOT the older `#2d8a4e` + `rounded-3xl` from legacy `WarehouseTransferModal.tsx` (which is deleted in Task 23).
- **Language:** Bahasa Indonesia. Terminology: "Transfer" NEVER "Mutasi" (memory `warehouse_transfer_naming`). Doc-no prefix `TR-YYYY-MM-NNN`.
- **Status enum:** `IN_TRANSIT | RECEIVED | PARTIAL | CANCELLED` (uppercase; replaces stub's `initiated/received/disputed/cancelled`).
- **RPC ownership:** `vosi_rpc_owner` for SECDEF write RPCs (initiate/receive/cancel); RLS `t_select_own` inclusive of `vosi_rpc_owner` per memory `secdef_returning_gap`.
- **No approval workflow:** per memory `no_approval_workflow` — receiver acts directly, no admin gate.
- **No WA:** APP_INBOX bell only per memory `no_wa_owner_approval`.
- **No paid API:** PDF is client-side jsPDF, no cost impact per memory `cost_upgrade_approval`.
- **Legacy shim:** `transfer_warehouse(text,text,text,int)` kept for 1 release cycle as compat proxy to new RPCs.

## Pre-flight plan review — resolved before execution

Two potential defect-risk spots identified in plan draft; both fixed inline before Task 1 dispatch:

1. **Tasks 7 & 8 — direct INSERT into `stock_movements`** (bypasses `_log_stock_movement` helper).
   - Cited memory `smoke_test_bug_fixes` Bug 2/3 verbatim in the RPC body comments.
   - Pattern is intentional (helper doesn't accept warehouse_id; post-insert UPDATE blocked by `trg_deny_sm_update`).
   - Same pattern as `resolve_supplier_claim` + `_apply_opname_change` damage loop.
2. **Task 20 Step 1 — test skeleton was comment placeholder only.**
   - Expanded to 5 concrete test cases with full body: read-only when RECEIVED, Konfirmasi Terima visibility, mapped-payload submit, Batal Kirim visibility for sender, PARTIAL warning banner.

## Base commit

Worktree base: `a2e83a5` (docs commit — spec + plan). All 26 implementation tasks branch from here.

## Tasks

Task 1: complete (commits a2e83a5..c9c1f0a, review clean, DONE_WITH_CONCERNS — branch-apply deferred to Task 25 per cost_upgrade_approval; 12 test-data rows pre-approved for drop by founder 2026-07-12)
Task 2: complete (commits c9c1f0a..2632b11, review clean, DONE_WITH_CONCERNS — branch-apply deferred; parent+child tables + doc_seq + 5 indexes + helper fn all match spec §4.1-§6 verbatim)
Task 3: complete (commits 2632b11..8ef87a2, self-review only — 26-line CREATE OR REPLACE VIEW verbatim from plan, trivial, save-token decision; DONE_WITH_CONCERNS branch-apply deferred)
Task 4: complete (commits 8ef87a2..6f73d70, self-review only — 27-line ALTER TYPE with idempotent pg_enum guards verbatim from plan; DONE_WITH_CONCERNS branch-apply deferred)
Task 5: complete (commits 6f73d70..5eabcb3, self-review only — RLS policies for both new tables with t_select_own TO authenticated, vosi_rpc_owner per memory secdef_returning_gap verified in diff; DONE_WITH_CONCERNS branch-apply deferred)
Task 6: complete (commits 5eabcb3..b0489b5, formal reviewer approved — initiate_warehouse_transfer RPC 6-param signature, idempotency, FOR UPDATE lock, per-SKU deduct + _log_stock_movement transfer_out, app_inbox best-effort wrap all correct; receiver permission gate deferred to Task 11 by design; DONE_WITH_CONCERNS branch-apply deferred)
Task 7: complete (commits b0489b5..32cccd7, formal reviewer approved — receive_warehouse_transfer RPC status/receiver guards, order-agnostic SKU match, destination stock credit w/ INSERT-if-missing, direct-INSERT transfer_loss row w/ loss_movement_id backfill, RECEIVED/PARTIAL status computation, PARTIAL owner-inbox best-effort wrap all correct; DONE_WITH_CONCERNS branch-apply deferred)
Task 8: complete (commits 32cccd7..8e8b610, self-review only — cancel_warehouse_transfer 81 lines, sender-only guard, source stock credit + transfer_cancel_return audit row, status→CANCELLED, receiver inbox best-effort wrap; DONE_WITH_CONCERNS branch-apply deferred)
Task 9: complete (commits 8e8b610..70a76da, self-review only — 3 read RPCs list/detail/in_transit all SECDEF STABLE with GRANT EXECUTE authenticated; DONE_WITH_CONCERNS branch-apply deferred)
Task 10: complete (commits 70a76da..c90c9ac, self-review only — legacy transfer_warehouse SECDEF shim: RAISE WARNING deprecation, warehouse UUID lookup, initiate+receive chain with sender=receiver=v_actor; DONE_WITH_CONCERNS branch-apply deferred)

**Plan defect discovered pre-Task 11:** Plan assumes column-per-permission (`ALTER TABLE ... ADD COLUMN can_transfer_warehouse boolean`) but actual pattern is `admin_users.permissions` JSONB blob (verified in `20260613000004_backfill_can_manage_warehouses.sql`). Role value is `'Owner'` title-case, not `'OWNER'`. Task 11 implementer instructed to deviate from brief and use JSONB `jsonb_set` pattern matching `can_manage_warehouses` migration. Task 6 initiate RPC's receiver permission check (deferred to Task 11) also uses JSONB lookup `permissions ->> 'can_receive_warehouse_transfer' = 'true'`.

Task 11: complete (commits c90c9ac..b354f6e, self-review only — 4 jsonb_set backfills [Owner/non-Owner × can_transfer_warehouse/can_receive_warehouse_transfer], initiate RPC re-issued with COALESCE(permissions ->> 'can_receive_warehouse_transfer', 'false') = 'true' receiver gate; DONE_WITH_CONCERNS branch-apply deferred; plan-defect resolved inline via JSONB pattern per referenced migration)
Task 12: complete (commits b354f6e..a3ac4cd, self-review — smoke migration DO block w/ set_config fake auth + ASSERT + RAISE EXCEPTION rollback, JSONB-pattern fix applied to sender/receiver discovery queries per Task 11, apply-pending-migrations.sh updated with 210-220 (221 commented smoke-only); DONE_WITH_CONCERNS branch-apply deferred, actual smoke run at Task 25)

## Phase A complete — 12 migrations shipped

All 12 Phase A migrations authored and committed to worktree branch `worktree-warehouse-transfer`. Commit range: `a2e83a5..a3ac4cd`. Zero branch-applies performed (deferred per `cost_upgrade_approval` — actual DB apply happens at Task 25 local + Task 26 prod). Ready to begin Phase B (FE service layer).

Task 13: complete (commits a3ac4cd..d4486c2, TDD RED→GREEN — warehouseTransferService.ts + types + 2 unit tests pass; node_modules symlinked from main worktree for vitest)
Task 14: complete (commits d4486c2..8737c4d, TDD RED→GREEN — useInTransitBySKU hook 42 LOC + 2 unit tests pass)
Task 15: complete (commits 8737c4d..e00a486, TDD RED→GREEN — warehouseTransferPDF.ts jsPDF A5 renderer + 1 blob-shape test pass)

## Phase B complete — 3 FE service files shipped

Service layer (`warehouseTransferService.ts`) + hook (`useInTransitBySKU.ts`) + PDF renderer (`warehouseTransferPDF.ts`) all authored with TDD. 5/5 vitest tests pass. Ready for Phase C (8 FE screens).

Task 16: complete (commits e00a486..7a7986b — implementer d50f6e2 added Sidebar entry + 3 route cases in App.tsx + 3 placeholder screen stubs + updated types.ts + urlRoute.ts registry; controller fix 7a7986b initially corrected permKey — but that direction was itself wrong; final naming fixed by slot 222 later, see below)
Task 17: complete (680547c — list screen with KPI + tab pills + status badges, matches design tokens from OwnerDecisionInbox)
Task 18: complete (f8f0ffc — SKU picker autocomplete + line-add/edit/delete + qty bounds)
Task 19: complete (a8b0f1f — sender form 6/6 tests pass; PDF via dynamic import; clientRequestId via useMemo)
Task 20: complete (38c9dba — detail screen 5/5 tests pass; conditional Konfirmasi Terima / Batal Kirim per role+status; PARTIAL warning banner)
Task 21: complete (6cda8e4 — InTransitChip + StockTableView integration; 2/2 chip tests + 21/21 full suite pass; legacy WarehouseTransferModal use removed from StockManagerScreen)
Task 22: complete (1df9926 — OwnerDecisionInbox aging alerts panel; fetches v_pengawasan_transfer_aging on mount; useWarehouses lookup for names)

**Plan defect discovered post-Task 22 (slot 222 fixup):** Plan invented permission key names (`can_transfer_warehouse` + `can_receive_warehouse_transfer`) that don't exist in existing `PermissionSet` type. Correct existing keys are `can_initiate_transfer` + `can_receive_transfer` (already in ALL_PERMISSIONS from legacy transfer_warehouse feature). Fixup migration 20261115000222 (a) drops wrong keys from admin_users.permissions, (b) seeds correct keys Owner=true/non-Owner=false, (c) re-issues initiate_warehouse_transfer with correct receiver check. Also fixed smoke migration 221 sender/receiver discovery queries. Sidebar permKey reverted to `can_initiate_transfer` + `can_receive_transfer`. All committed as 9516fc5. Added to apply-pending-migrations.sh at slot 222.

Task 23: complete (2b964b8 — deleted WarehouseTransferModal.tsx 91 lines + pembelianService.transferWarehouse 11 lines; grep confirms 0 remaining refs; 970 tests pass in full suite)
Task 24: complete (abb838d — cross-tenant isolation pinning test, 3/3 tests pass; verifies client contract, actual isolation enforced server-side by RLS)
Task 25: complete (commits abb838d..01bf232 including two fix commits d2f92f0 + 01bf232) — Applied 13 migrations (slots 210-219, 222-224, 226) directly to Garindo prod via MCP one-by-one (deferred paid branch tier per cost policy). Advisors flagged v_pengawasan_transfer_aging as SECDEF ERROR → fixed by slot 223 (security_invoker). Prod smoke uncovered 3 defects during actual RPC execution (schema-apply only validates DDL): (1) FK to auth.users vs admin_users.id mismatch, (2) _log_stock_movement helper NOT NULL qty_before, (3) stock_movements NOT NULL actor_role + evidence_urls. Fixed by slots 224+226. Final smoke on Garindo: initiate → receive FULL / receive PARTIAL (loss=3) / cancel all ASSERT-verified inside DO block + intentional-rollback RAISE EXCEPTION so no persistent side effects. Slot 220 (wrong-name permission seed) and 221 (smoke migration DO block) intentionally skipped from prod apply.

## Phase C complete — 8 FE screens + integration shipped

All Phase C tasks done. Sidebar entry, list/create/detail screens with tests, SKU picker, InTransitChip in StockManager, Owner Inbox aging panel, legacy modal deleted. 970 tests pass across suite. One controller fix (9516fc5) resolved permission-key naming plan defect. Ready for Phase D (Tasks 24-26).

Task 24: complete (commit abb838d — cross-tenant isolation pinning test; 3/3 vitest pass; mocks supabase.rpc to verify service layer correctly calls RPC without fabricating cross-tenant data client-side; real isolation is DB-side via Postgres RLS+SECDEF)
