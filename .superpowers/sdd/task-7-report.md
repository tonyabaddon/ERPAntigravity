### Task 7 Report: LabaRugiTab + PDF SAK EMKM wiring

**Branch:** `worktree-akuntansi-phase4` (confirmed)
**Base commit:** 97ad719

---

## Files Created / Modified

### Created
- `src/components/laporan/akuntansi/LabaRugiTab.tsx` — P&L component (SAK EMKM format)

### Modified
- `src/components/laporan/akuntansi/AkuntansiLaporanTab.tsx` — replaced stub with real `LabaRugiTab`

---

## Implementation Notes

### Data sources
- `fetchLabaRugi(fromDate, toDate)` — P&L aggregation from reportQueries
- `fetchAccountingConfig()` — for `pph_rate_pct` (PPh label in beban pajak row)
- `tenantSettingsService.fetch()` — for `pajak_npwp` (passed to PDF company info)

### Corrections from brief (based on actual codebase)
1. **NPWP from `DbTenantSettings.pajak_npwp`**, not from `AccountingConfig` (which has no npwp field)
2. **Address is `null`** — `DbTenantSettings` has no address field; PDF gracefully skips null
3. **`diskonPenjualan: 0`** — `LabaRugiResult` doesn't expose kontra total separately; PDF skips row when 0
4. **Period presets: 3 only** (Bulan ini / 30 hari / Tahun ini) — no Custom, matching MutasiTab parity
5. **HPP subtotal row rendered** with `data.totalHpp` from `LabaRugiResult`

### PDF wiring
- `generateLabaRugiPDF(pdfData, options)` called on PDF button click
- Download via `URL.createObjectURL` + `<a>.click()` + `URL.revokeObjectURL`
- `fileName` pattern: `laba-rugi-{fromDate}-{toDate}.pdf`

### TypeScript
- Zero `any` usage — all `unknown` error handling via `instanceof Error`
- `npx tsc --noEmit` → clean (no output)

---

## Verification

- [x] Branch = `worktree-akuntansi-phase4`
- [x] `tsc --noEmit` clean
- [x] `LabaRugiTab` wired into `AkuntansiLaporanTab` (stub replaced)
- [x] PDF export calls real `generateLabaRugiPDF` with correct shape
- [x] Emerald gradient hero, period selector, structured P&L table, info banner, export buttons
