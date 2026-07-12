# Task 3 Report — request_kasir_discount_approval RPC (Item #4, slot 112 part B)

**Status:** DONE

## What was done
- Appended `request_kasir_discount_approval(p_sale_draft_id UUID, p_discount_amount_rp NUMERIC, p_discount_type TEXT, p_discount_value NUMERIC, p_subtotal_rp NUMERIC, p_reason TEXT) RETURNS BIGINT` to `supabase/migrations/20261115000112_kasir_discount_rpcs.sql`.
- Applied via MCP `apply_migration` (two applies: initial + expires_at NOT NULL patch).
- Smoke tests 5 and 6 appended to `tests/sql/kasir_discount_rpc_smoke.sql`. Both PASS.

## Schema drift found vs brief
| Brief assumption | Actual schema | Fix applied |
|---|---|---|
| `p_sale_draft_id BIGINT` | `kasir_transactions.id UUID` | Param changed to UUID |
| columns `subtotal_rp`, `total_rp`, `sold_at` | `subtotal`, `total_amount`, `date` | Corrected in smoke tests |
| `status='draft'` valid for insert | CHECK excludes 'draft' (only PAID/AWAITING_LUNAS/COMPLETED/CANCELLED/WIP/PENDING_LOCK_APPROVAL) | Smoke INSERT uses default status |
| `expires_at` nullable (spec: no-expire) | NOT NULL, default now()+30min | `now() + interval '100 years'` sentinel |

## Smoke result
TEST 5 PASS: request_kasir_discount_approval creates approval_requests row + sets kasir_transactions.discount_approval_status='awaiting'
TEST 6 PASS: empty reason rejected with 'reason required (min 3 chars)' error

## Concerns for downstream tasks (4/5)
- **p_sale_draft_id is UUID** — all callers (frontend + other RPCs) must pass UUID, not BIGINT.
- **expires_at sentinel** — far-future (now()+100y) satisfies NOT NULL. If expiry sweep logic is added later, kasir_discount rows will not auto-expire. Fine for MVP.
- Brief's BIGINT assumption was widespread in the spec; remaining task briefs should be interpreted with UUID for sale_draft_id.
