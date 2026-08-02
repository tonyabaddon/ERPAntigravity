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
  'src/components/KasirScreen.tsx', // batch 10 false-positive: line ~669 "Tidak ada kategori aktif" inside <option> tag — Rule 2 skip; real empty states swept in batch 10
  'src/components/ManajemenGudangScreen.tsx', // false-positive: showToast('Tidak ada perubahan', ...) at line 128 — toast string, not JSX empty-state node (Rule 2 skip); all real empty states swept in batch 6
  'src/components/OrderHistoryScreen.tsx', // batch 10 false-positive: EMPTY_MESSAGES object literal strings at lines ~111-116 match regex but are JS values not JSX text nodes — Rule 2 skip; real empty states swept
  'src/components/PembelianScreen.tsx',
  'src/components/RekonsiliasiScreen.tsx',
  'src/components/admin/PendingPaymentRow.tsx',
  'src/components/admin/PlansManagement.tsx', // false-positive: adminToast.success('Tidak ada perubahan.') at line ~233 — JS string in toast call, not JSX empty-state node (Rule 2 skip); real empty states swept in batch 8
  'src/components/admin/TenantDetail/PembayaranTab.tsx', // batch 9 Rule 2 skip: wrapper div has data-testid="pembayaran-tab-empty" with live test coverage; empty CTA uses bespoke gold bg-caleo-gold design EmptyState can't match
  'src/components/admin/TenantsList.tsx', // false-positive: 'Belum ada grant aktif...' at line 212 — JS string in toast branch, not JSX node (Rule 2 skip)
  'src/components/akuntansi/CashAccountPicker.tsx', // loading/error in <option> tags (can't embed components); empty-state is amber instructional div (visual change if replaced)
  'src/components/akuntansi/OpeningBalanceWizard.tsx', // all "Belum ada" are inside amber/emerald intentional callout panels — Rule 2 skip (batch 7)
  'src/components/akuntansi/manual/ManualTransferModal.tsx',
  'src/components/dashboard/PreOrderFulfillmentsCard.tsx',
  'src/components/feedback/CustomerFeedbackScreen.tsx',
  'src/components/kasir/HasilCariFotoModal.tsx',
  'src/components/pembelian/form/SupplierPicker.tsx', // CTA button sub-description 'Tidak ada di list?...' — button copy, not empty-state; main empty states swept
  'src/components/pembelian/tagihan/TagihanFormPage.tsx', // batch 9 Rule 2 skip: only hit is "Belum ada Pesanan?" in field-level hint caption under input — not a JSX empty-state node
  'src/components/produk/BulkUploadSection.tsx', // "Belum ada produk" is inside showToast() call — not a JSX empty-state node
  'src/components/produk/ProductForm.tsx', // batch 10 Rule 2 skip: only hit is <option value="">— Tidak ada —</option> in SubCategoryDropdown — option tag content, not JSX empty-state node
  'src/components/sales/DaftarPesananScreen.tsx', // batch 9: real hit (Memuat pesanan...) swept; remaining false-positives: 2× alert() JS strings at lines ~223/370 (Rule 2 skip), <h3> WhatsApp fallback modal heading at line ~604 (Rule 2: intentional custom callout)
  'src/components/stok/PriceChangeRequestModal.tsx',
  'src/components/stok/StockAdjustmentModal.tsx', // false-positive: 'Tidak ada user aktif' is a toast string, not JSX
  'src/components/stok/StockOpnameScreen.tsx', // false-positive: showToast('Tidak ada user aktif', ...) at line ~165 — toast string, not JSX empty-state node (Rule 2 skip); real empty states swept in batch 8
  'src/components/stok/StockOpnameSessionView.tsx', // batch 9: real hits (Memuat sesi…, grouped empty) swept; remaining false-positive: showToast('Belum ada count...') at line ~277 — toast string, not JSX (Rule 2 skip)
  'src/components/pembelian/tukar-faktur/TukarFakturFormPage.tsx', // batch 9: real hits swept; remaining false-positive: file comment "// 3. Tidak ada? Buat Tagihan baru" at line 5 — button copy in comment, not JSX (Rule 2 skip)
  'src/components/warehouseTransfer/WarehouseTransferCreateScreen.tsx', // "Belum ada penerima" is a field-level inline caption under a form control with an embedded link — Rule 2 skip
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
