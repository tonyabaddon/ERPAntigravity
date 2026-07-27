// Scan src/ for the `err instanceof Error ? err.message : String(err)`
// anti-pattern. Supabase's PostgrestError is not an Error instance, so this
// ternary yields `[object Object]` in the fallback branch and hides the real
// message from users.
//
// Fix: use extractErrorMessage(err) from src/lib/extractErrorMessage.ts.
//
// Allowlist: 31 pre-existing files carry this pattern as inherited debt.
// They pass the audit as-is so it can catch NEW violations without cascade-
// failing on the codebase state. Remove entries from ALLOWLIST as they get
// cleaned up.
//
// Usage: npm run audit:no-string-err-fallback
// Exit 0 = clean (no new violations), exit 1 = new violation found.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'src';
const PATTERN = /:\s*String\((err|e|error)\)/;
const EXTRACT_HELPER = 'src/lib/extractErrorMessage.ts';

// Pre-existing violations. Do NOT add to this list; fix the file instead.
const ALLOWLIST = new Set<string>([
  'src/components/admin/AdminLayout.tsx',
  'src/components/admin/CaleoBotDashboard.tsx',
  'src/components/admin/CostDashboard.tsx',
  'src/components/admin/PendingPaymentRow.tsx',
  'src/components/admin/PendingPaymentsQueue.tsx',
  'src/components/admin/PlatformSettings.tsx',
  'src/components/admin/SalesRepsList.tsx',
  'src/components/admin/TenantDetail/PembayaranTab.tsx',
  'src/components/admin/TenantDetail/TenantDangerZone.tsx',
  'src/components/admin/TenantsList.tsx',
  'src/components/akuntansi/gl/PeriodCloseModal.tsx',
  'src/components/akuntansi/gl/YearEndCloseModal.tsx',
  'src/components/pembelian/KlaimSupplierPanel.tsx',
  'src/components/pengaturan/SupportAccessPanel.tsx',
  'src/components/pengaturan/saldoAwal/SaldoAwalWizard.tsx',
  'src/components/pengaturan/saldoAwal/Step1KasBank.tsx',
  'src/components/pengaturan/saldoAwal/Step2Aktiva.tsx',
  'src/components/pengaturan/saldoAwal/Step4EkuitasPreview.tsx',
  'src/components/penjualan/CatatPenjualanWizard.tsx',
  'src/components/penjualan/DaftarPenawaranScreen.tsx',
  'src/components/penjualan/LockSubmissionModal.tsx',
  'src/components/penjualan/wizard/NewProductInlineForm.tsx',
  'src/components/penjualan/wizard/Step3Payment.tsx',
  'src/components/promo/PromoInlineEdit.tsx',
  'src/components/stok/DamageFlagModal.tsx',
  'src/components/stok/PriceChangeRequestModal.tsx',
  'src/components/stok/StockAdjustmentModal.tsx',
  'src/components/stok/StockOpnameScreen.tsx',
  'src/components/stok/StockOpnameSessionView.tsx',
  'src/components/warehouseTransfer/WarehouseTransferDetailScreen.tsx',
  'src/hooks/useWarehouses.ts',
]);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
}

const files: string[] = [];
walk(ROOT, files);

const violations: Array<{ file: string; line: number; text: string }> = [];
for (const f of files) {
  const rel = relative('.', f);
  if (rel === EXTRACT_HELPER) continue;
  if (ALLOWLIST.has(rel)) continue;
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((text, i) => {
    if (PATTERN.test(text)) violations.push({ file: rel, line: i + 1, text: text.trim() });
  });
}

if (violations.length === 0) {
  process.exit(0);
}

console.error('audit:no-string-err-fallback — NEW violations found:');
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`);
}
console.error('\nFix: use extractErrorMessage(err) from src/lib/extractErrorMessage.ts');
console.error('Supabase PostgrestError is not an Error instance, so String(err) renders [object Object].');
process.exit(1);
