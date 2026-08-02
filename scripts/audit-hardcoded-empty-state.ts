// Scan src/ for inline "Belum ada" / "Tidak ada" text in JSX that should
// use the shared <EmptyState /> component from src/components/ui/.
//
// Rule: consistent visual + copy for empty states = MSME trust. Ad-hoc
// scattered text = drift.
//
// Usage: npm run audit:hardcoded-empty-state
// Exit 0 = baseline clean. Exit 1 = NEW hardcoded empty-state text added.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
// Match text nodes in JSX (loose approximation — full parse would be over-eager).
const EMPTY_RE = /(?:>|['"`])(Belum ada|Tidak ada)[^<'"]*(?:<|['"`])/g;
// Allow "Belum ada / Tidak ada" text inside design-system component prop values
// (message=, hint=, label=, empty=, title=, aria-label=) — the whole point of
// migrating to <EmptyState /> is to keep the string in a prop.
// Also skip HTML tooltip/aria attributes (title=, aria-label=) which are never
// empty-state JSX text nodes.
const PROP_ALLOWLIST_RE = /\b(message|hint|label|empty|fallback|title|aria-label)\s*=/;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
}

const BASELINE_ALLOWLIST = new Set<string>([
  'src/components/KasirScreen.tsx',
  'src/components/LaporanScreen.tsx',
  'src/components/ManajemenGudangScreen.tsx',
  'src/components/NotificationSettingsScreen.tsx',
  'src/components/OrderHistoryScreen.tsx',
  'src/components/OwnerDecisionInbox.tsx',
  'src/components/PelangganScreen.tsx',
  'src/components/PembelianScreen.tsx',
  'src/components/PengaturanScreen.tsx',
  'src/components/RekonsiliasiScreen.tsx',
  'src/components/SalesInboxScreen.tsx',
  'src/components/WhatsappAiScreen.tsx',
  'src/components/admin/CaleoBotDashboard.tsx',
  'src/components/admin/CostDashboard.tsx',
  'src/components/admin/PendingPaymentRow.tsx',
  'src/components/admin/PlansManagement.tsx',
  'src/components/admin/TenantDetail/PembayaranTab.tsx',
  'src/components/admin/TenantsList.tsx',
  'src/components/admin/TenantsTable.tsx',
  'src/components/akuntansi/CashAccountPicker.tsx', // loading/error in <option> tags (can't embed components); empty-state is amber instructional div (visual change if replaced)
  'src/components/akuntansi/OpeningBalanceWizard.tsx',
  'src/components/akuntansi/gl/BukuBesarTab.tsx',
  'src/components/akuntansi/gl/COAManagementTab.tsx',
  'src/components/akuntansi/gl/TrialBalanceTab.tsx',
  'src/components/akuntansi/manual/ManualTransferModal.tsx',
  'src/components/dashboard/PreOrderFulfillmentsCard.tsx',
  'src/components/feedback/CustomerFeedbackScreen.tsx',
  'src/components/kasbank/AccountDetailScreen.tsx',
  'src/components/kasbank/KasBankScreen.tsx',
  'src/components/kasir/HasilCariFotoModal.tsx',
  'src/components/laporan/akuntansi/CashFlowTab.tsx',
  'src/components/laporan/akuntansi/LabaRugiTab.tsx',
  'src/components/laporan/akuntansi/MutasiTab.tsx',
  'src/components/laporan/akuntansi/NeracaTab.tsx',
  'src/components/pembelian/KlaimSupplierPanel.tsx',
  'src/components/pembelian/form/SupplierPicker.tsx', // CTA button sub-description 'Tidak ada di list?...' — button copy, not empty-state; main empty states swept
  'src/components/pembelian/pembayaran/PembayaranFormPage.tsx',
  'src/components/pembelian/tagihan/TagihanFormPage.tsx',
  'src/components/pembelian/tukar-faktur/TukarFakturDetailPage.tsx',
  'src/components/pembelian/tukar-faktur/TukarFakturFormPage.tsx',
  'src/components/pengaturan/PromoProdukPanel.tsx',
  'src/components/pengaturan/RekeningBankCard.tsx',
  'src/components/pengaturan/SupportAccessPanel.tsx',
  'src/components/pengaturan/saldoAwal/Step2Aktiva.tsx',
  'src/components/pengaturan/saldoAwal/Step3Kewajiban.tsx',
  'src/components/penjualan/CartRows.tsx',
  'src/components/penjualan/DaftarPenawaranScreen.tsx',
  'src/components/penjualan/LockSubmissionModal.tsx',
  'src/components/piutang/PiutangScreen.tsx',
  'src/components/produk/BulkUploadSection.tsx', // "Belum ada produk" is inside showToast() call — not a JSX empty-state node
  'src/components/produk/ProductForm.tsx',
  'src/components/produk/StockTableView.tsx',
  'src/components/sales/ActionPanel.tsx',
  'src/components/sales/DaftarPesananScreen.tsx',
  'src/components/stok/PriceChangeRequestModal.tsx',
  'src/components/stok/StockAdjustmentModal.tsx', // false-positive: 'Tidak ada user aktif' is a toast string, not JSX
  'src/components/stok/StockOpnameScreen.tsx',
  'src/components/stok/StockOpnameSessionView.tsx',
  'src/components/warehouseTransfer/WarehouseTransferCreateScreen.tsx',
]);

const files: string[] = [];
walk(ROOT, files);

interface Hit {
  file: string;
  line: number;
  text: string;
}

const violations: Hit[] = [];
for (const f of files) {
  if (BASELINE_ALLOWLIST.has(f)) continue;
  if (f.endsWith('DesignSystemPage.tsx')) continue;
  if (f.endsWith('EmptyState.tsx')) continue;

  const body = readFileSync(f, 'utf8');
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Skip prop-value assignments (message="...", hint="...", label="...")
    // — the whole point of migrating to <EmptyState /> is putting the
    // string in a prop.
    if (PROP_ALLOWLIST_RE.test(lines[i])) continue;
    EMPTY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EMPTY_RE.exec(lines[i])) !== null) {
      violations.push({ file: f, line: i + 1, text: m[0].slice(0, 60) });
    }
  }
}

if (violations.length === 0) {
  console.log(`✓ clean — no NEW hardcoded "Belum ada"/"Tidak ada" (baseline ${BASELINE_ALLOWLIST.size} files allowlisted)`);
  process.exit(0);
}

console.error(`✗ ${violations.length} hardcoded empty-state text(s) outside allowlist:`);
console.error('');
for (const v of violations.slice(0, 20)) {
  console.error(`  ${v.file}:${v.line}  ${v.text}`);
}
console.error('');
console.error('Fix: use <EmptyState message="..." /> from src/components/ui/EmptyState.tsx');
process.exit(1);
