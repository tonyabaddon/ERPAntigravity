# PENDING FIX P1-05 — WIB timezone bug fix plan

**Origin:** `docs/qa-week/2026-07-19-session2-findings.md` P1-05 (WIB timezone bug across 37 FE sites).
**Author:** QA Session 4 (plan, not applied — no autonomous FE code changes).
**Reviewer:** founder.

---

## The bug

`new Date().toISOString().slice(0, 10)` returns UTC-based `YYYY-MM-DD`. At 17:00-23:59 WIB, UTC has already rolled to the next day → returns tomorrow's date. In practice: at 21:00 WIB (14:00 UTC), the returned date is still today (14:00 UTC = today UTC). But at 07:00 WIB (00:00 UTC), same problem in reverse.

More precisely: WIB is UTC+7. So UTC rolls to next day at 17:00 WIB. For 7 hours per day (17:00 - 23:59 WIB), the naive slice returns tomorrow.

## The fix

Helper already exists at `src/lib/format.ts:31`:
```ts
export function wibDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}
```

Replace pattern:
- `new Date().toISOString().slice(0, 10)` → `wibDateString()`
- `someDate.toISOString().slice(0, 10)` → `wibDateString(someDate)`

Add import: `import { wibDateString } from '@/lib/format'` (or relative path).

## All 36 sites (from grep 2026-07-19)

### Cluster A — FINANCIAL (highest priority, real-world money-impact bug)

| File | Line | Context | Impact |
|---|---|---|---|
| `admin/RecordPaymentModal.tsx` | 45 | Default payment date | **Payment posted on wrong day 17-23:59 WIB** — books misaligned |
| `admin/RecordPaymentModal.tsx` | 51 | Same modal, second default | Same |
| `pembelian/tagihan/TagihanList.tsx` | 27 | `effectiveStatus(today = ...)` — computes TERLAMBAT (overdue) | Falsely marks bill as overdue 1 day early |
| `pembelian/tagihan/TagihanList.tsx` | 77 | Same list, second use | Same |
| `pembelian/tagihan/TagihanDetailPage.tsx` | 32 | Same effectiveStatus for detail view | Same |
| `pembelian/tagihan/TagihanFormPage.tsx` | 165 | Default purchase_date on new tagihan | Bill dated wrong day |
| `pembelian/tagihan/TagihanFormPage.tsx` | 245 | Payment due default | Due date wrong |
| `pembelian/pembayaran/PembayaranFormPage.tsx` | 73 | Default paid_at on new payment | **Payment recorded on wrong day** — accounting impact |
| `pembelian/tukar-faktur/TukarFakturFormPage.tsx` | 64 | today constant for TF form | TF date wrong |
| `pembelian/tukar-faktur/TukarFakturFormPage.tsx` | 88 | Payment due default | Due date wrong |
| `pembelian/tukar-faktur/TfQuickAddTagihanModal.tsx` | 21 | today constant | Same |
| `pembelian/tukar-faktur/TfQuickAddTagihanModal.tsx` | 28 | Default dueAt | Same |
| `pembelian/bnl/BelanjaNumpangLewatFormPage.tsx` | 41 | Default purchase_date | BNL dated wrong |
| `pembelian/bnl/BelanjaNumpangLewatFormPage.tsx` | 74 | Payment due default | Due date wrong |
| `pembelian/ReceiveGoodsModal.tsx` | 21 | Receive date default | Stock movement dated wrong |
| `kasbank/AccountFormModal.tsx` | 62 | Opening balance date default | GL opening balance dated wrong |
| `kasbank/AccountFormModal.tsx` | 151 | Opening balance date on edit | Same |
| `akuntansi/manual/OwnerDrawingModal.tsx` | 31 | Default date on owner drawing | Manual journal dated wrong |
| `akuntansi/manual/ManualExpenseModal.tsx` | 41 | Default date on manual expense | Same |
| `akuntansi/manual/ManualTransferModal.tsx` | 84 | Default date on manual transfer | Same |
| `akuntansi/manual/WalletSpendModal.tsx` | 59 | Default date on wallet spend | Same |
| `akuntansi/manual/BalanceAdjustmentModal.tsx` | 33 | Default date on balance adjustment | Same |
| `pengaturan/saldoAwal/Step1KasBank.tsx` | 34 | Opening balance as_of default | Opening balance dated wrong |
| `pengaturan/saldoAwal/Step1KasBank.tsx` | 87 | Same wizard, second use | Same |
| `admin/RenewSubscriptionModal.tsx` | 40 | Subscription renewal date | Subscription lifecycle wrong |
| `admin/RenewSubscriptionModal.tsx` | 45 | Same modal, second use | Same |
| `lib/purchaseInvoiceService.ts` | 130 | `isTerlambat` default today | Overdue check wrong |
| `lib/purchaseInvoiceService.ts` | 139 | `isDueSoon` default today | Due-soon check wrong |
| `lib/piutangService.ts` | 64 | Piutang today default | Receivable date wrong |

**Financial impact sites: 29.**

### Cluster B — UI-cosmetic (lower priority)

| File | Line | Impact |
|---|---|---|
| `admin/CostDashboard.tsx` | 17 | "Today" label wrong |
| `admin/AuditLogViewer.tsx` | 68 | CSV filename wrong |
| `pengaturan/PromoProdukPanel.tsx` | 375 | Date picker `min` — user can't pick today after 17:00 WIB |
| `pengaturan/saldoAwal/SaldoAwalWizard.tsx` | 43 | Helper function inside wizard |
| `pengaturan/saldoAwal/SaldoAwalWizard.tsx` | 172 | Date picker `max` — user can't pick today after 17:00 WIB |
| `pengaturan/PajakSettingsPanel.tsx` | 17 | Tax expiry formatting |
| `promo/PromoInlineEdit.tsx` | 173 | Promo start date picker `min` |

**Cosmetic sites: 7.**

## Rollout strategy

**Phase 1 (highest priority):** Fix financial sites (29 sites in 15 files). Ship as one PR.

**Phase 2 (medium):** Fix cosmetic UI sites (7 sites in 6 files). Ship as second PR.

**Per-file edit pattern:**
```ts
// BEFORE:
const today = new Date().toISOString().slice(0, 10);

// AFTER:
import { wibDateString } from '@/lib/format';  // or relative path
const today = wibDateString();
```

For sites passing a Date variable:
```ts
// BEFORE:
setPaidAt(d.toISOString().slice(0, 10));

// AFTER:
setPaidAt(wibDateString(d));
```

## Testing

**Automated:**
1. Add unit tests to `src/lib/format.test.ts` covering:
   - `wibDateString()` at various UTC times (mock Date.now())
   - Specifically test 17:00 WIB = 10:00 UTC → correct day
   - Test 07:00 WIB = 00:00 UTC → correct day
2. Add regression tests for financial functions (`isTerlambat`, `isDueSoon`, `piutangService`).

**Manual (post-PR merge, chrome-devtools MCP):**
1. Open PembayaranFormPage at 21:00 WIB — verify default paid_at = today (not tomorrow).
2. Open PromoInlineEdit at 21:00 WIB — verify date picker allows "today".
3. Open TagihanList at 21:00 WIB — verify overdue status matches expectation.

## Backfill query (audit historical damage)

Query to find records that MIGHT have been affected by the bug (posted between 17:00-23:59 WIB on any day):

```sql
-- Payments where created_at is in the evening WIB window
SELECT id, created_at, paid_at
FROM pembayaran
WHERE EXTRACT(hour FROM created_at AT TIME ZONE 'Asia/Jakarta') BETWEEN 17 AND 23
  AND paid_at::date <> (created_at AT TIME ZONE 'Asia/Jakarta')::date
ORDER BY created_at DESC
LIMIT 50;
```

If matches found, may need forensic correction with founder review.

## Priority within cluster

If time-boxed on Phase 1:
1. `RecordPaymentModal.tsx` — 2 sites — highest value (single-modal impact)
2. `PembayaranFormPage.tsx:73` — direct payment recording
3. `TagihanList.tsx` + `TagihanDetailPage.tsx` — overdue status logic
4. Rest of Cluster A.

## Advisor gate

- Diff spans >3 files (29 sites in ~15 files) → advisor per CLAUDE.md
- No RLS/SECDEF change → normal advisor
- No migration → no migration slot needed
- Regression test added → satisfies "bug fixed permanently" per CLAUDE.md rule
