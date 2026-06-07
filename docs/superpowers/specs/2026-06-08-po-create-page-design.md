# PO Create Page + PDF Generation Design Spec

**Date:** 2026-06-08
**Sub-project:** Pembelian — Buat PO Supplier Baru (page baru + PDF)
**Status:** Approved for implementation

---

## Problem

Modal `PurchaseOrderModal.tsx` (max-w-3xl, max-h-90vh) sempit untuk PO dengan banyak items (10+ baris). Scroll-in-scroll, kolom Qty/Harga padat, dan supplier pakai `<select>` dropdown — tidak bisa search, tidak bisa create supplier baru tanpa keluar dari flow PO.

Tidak ada cara mencetak PO untuk dikirim ke supplier. Saat ini supplier menerima order via WA tulisan tangan / screenshot — tidak ada dokumen formal dengan logo toko, detail kontak, dan signed total.

Tidak ada field "tanggal diterima diharapkan", sehingga PO yang lewat deadline tidak bisa di-flag di list.

Tidak ada accountability — `purchase_orders` tidak menyimpan siapa yang create/update PO. Untuk MSME dengan multi-admin, ini gap untuk fraud-prevention dan PDF acknowledgment.

---

## Goal

Ganti modal Create/Edit PO dengan halaman penuh (sub-view di dalam `PembelianScreen`) yang:

1. Pakai full width area konten (~1200px+) — lapang untuk tabel items, tidak ada backdrop modal.
2. Supplier picker dengan search + 4 state (empty DB / opened / typing-match / typing-no-match), plus "+ Buat supplier baru" inline tanpa keluar dari form PO.
3. Tambah field "Tanggal Diterima Diharapkan" (`expected_receive_date`) — optional.
4. Generate PDF Purchase Order via jsPDF + jspdf-autotable, buka di tab baru, dengan branding Garindo Jaya Panel (icon Zap emerald + nama + alamat/phone dari `company_settings`).
5. Audit trail minimal: `created_by_user_id` + `updated_by_user_id` di `purchase_orders`, tampil di PDF "Dibuat oleh: <nama>".
6. Permission check: action permission `can_create_po` + `can_edit_po` di `permissions` JSONB, sejalan dengan Phase 2 anti-fraud foundation.
7. PDF hanya bisa di-generate setelah status ≥ ORDERED (PO Draft = bukan dokumen final).

---

## Decisions

- **Sub-view pattern, bukan ActivePage union** — `PembelianScreen` punya state `viewMode: 'list' | 'create' | { kind: 'edit', po }`. Sidebar "Pembelian" tetap highlight, tidak ada perubahan di `App.tsx`/`Sidebar.tsx`/`types.ts` untuk routing. Ikuti pola swap konten existing (OrdersTab/SuppliersTab).
- **Edit hanya untuk DRAFT** — PO ORDERED/RECEIVED/PAID = read-only di `PoDetailView`. Tidak ada perubahan dari behavior existing (PembelianScreen.tsx:280-292).
- **Modal lama (`PurchaseOrderModal.tsx`) dihapus** — bukan dipertahankan paralel. Semua flow Create/Edit Draft → page baru.
- **Stock-only items** — pakai stock existing. Tidak ada inline create stock dari form PO (kalau perlu produk baru, user buka StockManagerScreen dulu). YAGNI: scope-creep mahal.
- **jsPDF + jspdf-autotable** untuk client-side PDF rendering — ~200KB gzipped, mature, multi-page autotable, embedded font support. Alternatif (browser print, backend chromedp, react-pdf) ditolak karena inkonsistensi/overhead/bundle-size.
- **PDF buka di tab baru via `URL.createObjectURL(blob)`** — user pilih download/print sendiri dari browser. Tidak ada in-app preview modal (defer ke future enhancement kalau perlu WA share langsung).
- **Branding hardcoded** — icon Zap (SVG path inline) + "Garindo Jaya Panel" + tagline "MSME ERP Suite" sama dengan Sidebar. Tidak tambah `logo_url` di `company_settings` untuk MVP. Address/phone/email dari `company_settings` (kolom yang sudah ada).
- **Permission default Owner=true** — Owner selalu lulus check. Admin pakai value dari `permissions` JSONB. Default migration: set `can_create_po=true, can_edit_po=true` untuk semua admin existing (backfill jangan break user yang sudah aktif).
- **`expected_receive_date` optional** — kalau diisi, dipakai untuk badge "Telat X hari" di list PO ORDERED yang lewat tanggal. Validasi di form: boleh ≥ hari ini atau ≤ hari ini (lewat tanggal hanya warning, tidak blocking).
- **Inline create supplier** — block border-dashed indigo dengan 4 field sama persis dengan `SupplierModal` existing (nama / kontak / HP / term). Setelah save, supplier baru langsung ter-set di field Supplier PO. Tabel `suppliers` ter-update, available untuk PO selanjutnya.

---

## Files Changed

### New files

| File | Responsibility |
|---|---|
| `supabase/migrations/20260608000001_po_expected_date_audit_permissions.sql` | Tambah `expected_receive_date`, `created_by_user_id`, `updated_by_user_id` di `purchase_orders`. Backfill `permissions` JSONB admin existing dengan `can_create_po=true, can_edit_po=true`. |
| `src/components/pembelian/PurchaseOrderFormPage.tsx` | Orchestrator halaman: state form, validation, save, generate PDF. Menggantikan modal lama. |
| `src/components/pembelian/form/SupplierPicker.tsx` | Search input + 4-state dropdown + pinned "+ Buat baru" CTA. |
| `src/components/pembelian/form/InlineSupplierForm.tsx` | Block border-dashed inline create supplier (nama/kontak/HP/term). |
| `src/components/pembelian/form/StockPicker.tsx` | Search input untuk tambah item (extracted dari modal lama, di-share). |
| `src/components/pembelian/form/ItemRow.tsx` | 1 baris tabel items dengan inline-edit qty/harga + delete button. |
| `src/lib/pdf/purchaseOrderPdf.ts` | Pure fn `generatePoPdf(po, supplier, items, companySettings, createdByName): Blob`. Pakai jsPDF + autotable. |

### Modified files

| File | Change |
|---|---|
| `src/components/PembelianScreen.tsx` | Tambah `viewMode` state + swap render antara list vs `PurchaseOrderFormPage`. Hapus 2 conditional render `PurchaseOrderModal`. |
| `src/components/pembelian/PoDetailView.tsx` | Tambah tombol "📄 Download PDF" (hanya untuk status ≥ ORDERED). Tambah baris "Diterima paling lambat" di info block. |
| `src/lib/pembelianService.ts` | `purchaseOrderService.create` & `update` terima `expected_receive_date` + set `created_by_user_id` / `updated_by_user_id` dari current session. `fetchAll` include kolom baru di SELECT. |
| `src/types.ts` | Tambah `expected_receive_date?: string`, `created_by_user_id?: string`, `updated_by_user_id?: string` di `DbPurchaseOrder`. Tambah `can_create_po?: boolean`, `can_edit_po?: boolean` di `PermissionSet`. |
| `package.json` | Tambah dependency `jspdf` + `jspdf-autotable`. |

### Deleted files

| File | Reason |
|---|---|
| `src/components/pembelian/PurchaseOrderModal.tsx` | Diganti seluruhnya oleh `PurchaseOrderFormPage.tsx`. |

**Not changing:** `backend-go/`, `supabase/functions/`, file pengaturan auth, Sidebar, App.tsx routing, ActivePage union.

---

## Section 1: Database Migration

**File:** `supabase/migrations/20260608000001_po_expected_date_audit_permissions.sql`

### 1a. Add columns to `purchase_orders`

```sql
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS expected_receive_date DATE,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_expected_receive_date
  ON purchase_orders(expected_receive_date)
  WHERE expected_receive_date IS NOT NULL;
```

- All 3 columns NULL by default → PO existing tetap valid (no backfill required).
- ON DELETE SET NULL on FKs → menghapus admin user tidak menghapus PO yang dia buat.
- Index hanya untuk PO yang punya tanggal expected (sparse) — query "PO yang telat diterima" pakai index ini.

### 1b. Backfill `permissions` JSONB untuk admin existing

```sql
UPDATE admin_users
SET permissions = COALESCE(permissions, '{}'::jsonb) || jsonb_build_object(
  'can_create_po', true,
  'can_edit_po', true
)
WHERE permissions IS NULL
   OR NOT (permissions ? 'can_create_po')
   OR NOT (permissions ? 'can_edit_po');
```

- Idempotent: re-running tidak overwrite kalau key sudah ada (jaga kalau user sudah custom-set ke `false`).
- Default `true` agar admin existing tetap bisa kerja (no surprise lockout).
- Owner role di-handle di layer aplikasi (lihat Section 4) — selalu lulus check terlepas dari isi `permissions`.

### 1c. Tidak ada perubahan RLS

PO RLS sudah pakai pola `auth.uid()` check di migrasi sebelumnya. Kolom audit baru tidak butuh policy tambahan — `created_by_user_id` di-set di client (mirror `auth.uid()`) atau bisa di-enforce di trigger Phase 2 fraud-prevention.

---

## Section 2: Type Definitions

**File:** `src/types.ts`

### 2a. Extend `DbPurchaseOrder`

```ts
export interface DbPurchaseOrder {
  // ... existing fields ...
  expected_receive_date?: string;  // ISO date 'YYYY-MM-DD'
  created_by_user_id?: string;     // UUID
  updated_by_user_id?: string;     // UUID
}
```

### 2b. Extend `PermissionSet`

```ts
export interface PermissionSet {
  // ... existing module-level keys ...
  pembelian: boolean;
  // Action permissions (Phase 2 anti-fraud foundation)
  can_create_po?: boolean;
  can_edit_po?: boolean;
}
```

Optional di interface untuk avoid TS errors di kode yang baca `permissions` lama (sebelum migration). Runtime check pakai `permissions?.can_create_po !== false` (Owner bypass + default-true semantic).

### 2c. Helper untuk Owner bypass

Tidak perlu fn baru — `App.tsx` sudah set `permissions: ALL_PERMISSIONS` untuk Owner saat login (App.tsx:77). Tambah 2 key baru di `ALL_PERMISSIONS` const dengan value `true`.

---

## Section 3: PembelianScreen Sub-View Wiring

**File:** `src/components/PembelianScreen.tsx`

### 3a. Tambah `viewMode` state

```ts
type ViewMode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; po: DbPurchaseOrder };

const [viewMode, setViewMode] = useState<ViewMode>({ kind: 'list' });
```

### 3b. Render switch

```tsx
return (
  <div className="flex flex-col h-full overflow-hidden">
    <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
      {/* Header page tetap "Pembelian" di semua mode */}
      ...
    </div>
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      {viewMode.kind === 'list' ? (
        <>
          <SummaryCards ... />
          <Tabs ... />
          {tab === 'orders' ? (
            <OrdersTab
              orders={orders}
              suppliers={suppliers}
              stockList={stockList}
              showToast={showToast}
              onCreate={() => setViewMode({ kind: 'create' })}
              onEdit={(po) => setViewMode({ kind: 'edit', po })}
              ...
            />
          ) : (
            <SuppliersTab ... />
          )}
        </>
      ) : (
        <PurchaseOrderFormPage
          po={viewMode.kind === 'edit' ? viewMode.po : undefined}
          suppliers={suppliers}
          stockList={stockList}
          onBack={() => setViewMode({ kind: 'list' })}
          onSaved={(status) => {
            reload();
            if (status === 'ORDERED') setViewMode({ kind: 'list' });
            // Draft: stay on page
          }}
          showToast={showToast}
        />
      )}
    </div>
  </div>
);
```

### 3c. Hapus 2 conditional render `PurchaseOrderModal`

Lines 301-310 di file existing. Replace dengan tombol-tombol di `OrdersTab` yang panggil callback `onCreate`/`onEdit`.

---

## Section 4: PurchaseOrderFormPage Komponen

**File:** `src/components/pembelian/PurchaseOrderFormPage.tsx`

### 4a. Props

```ts
interface PurchaseOrderFormPageProps {
  po?: DbPurchaseOrder;  // undefined = create, defined = edit
  suppliers: DbSupplier[];
  stockList: StockItem[];
  onBack: () => void;
  onSaved: (status: 'DRAFT' | 'ORDERED') => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}
```

### 4b. State

```ts
const [supplierId, setSupplierId] = useState(po?.supplier_id ?? '');
const [expectedReceiveDate, setExpectedReceiveDate] = useState(po?.expected_receive_date ?? '');
const [notes, setNotes] = useState(po?.notes ?? '');
const [taxEnabled, setTaxEnabled] = useState((po?.tax_rate ?? 0) > 0);
const [taxRate, setTaxRate] = useState(String(((po?.tax_rate ?? 0) * 100) || 11));
const [items, setItems] = useState<PoItemDraft[]>(
  po?.items?.map(i => ({
    sku: i.sku, product_name: i.product_name, qty: i.qty,
    unit_cost: i.unit_cost, subtotal: i.subtotal
  })) ?? []
);
const [showInlineSupplier, setShowInlineSupplier] = useState(false);
const [inlineSupplierName, setInlineSupplierName] = useState('');  // prefill from typed search
const [isDirty, setIsDirty] = useState(false);
const [saving, setSaving] = useState(false);
```

### 4c. Permission gate (di parent atau di komponen ini)

```ts
// At top of component:
const canAct = po
  ? currentUser?.permissions?.can_edit_po !== false   // edit mode
  : currentUser?.permissions?.can_create_po !== false; // create mode

useEffect(() => {
  if (!canAct) {
    showToast('Anda tidak punya akses untuk membuat/edit PO.', 'warning');
    onBack();
  }
}, [canAct]);
```

`currentUser` di-pass via prop atau context. Owner: `ALL_PERMISSIONS` selalu `true`. Admin: cek JSONB; absent key fallback ke `true` (default-true semantic, sejalan dengan backfill migration).

### 4d. Layout (lihat mockup v3+v4)

Section bar pakai pola card existing (`rounded-xl border border-gray-200 p-5`) + accent indigo (`w-1 h-4 bg-indigo-500 rounded-full`) di samping judul section.

- **Page sub-header**: tombol "← Kembali" + judul "Buat Purchase Order" / "Edit PO-XXX" + badge unsaved status
- **Section 1: Detail PO** — 12-col grid (Supplier 5, Tgl Diterima 3, Catatan 4)
- **Section 2: Items** — tabel + StockPicker (search inline di kanan header section)
- **Section 3: Ringkasan Biaya** — Subtotal / PPN toggle / Total
- **Sticky footer actions** — `[Generate PDF (disabled jika status < ORDERED)] [Simpan Draft] [Simpan & Pesan]`

### 4e. Validation

```ts
function validate(): string | null {
  if (!supplierId) return 'Pilih supplier terlebih dahulu.';
  if (items.length === 0) return 'Tambahkan minimal satu item.';
  if (items.some(i => i.qty <= 0 || i.unit_cost <= 0)) return 'Qty dan harga beli harus lebih dari 0.';
  if (expectedReceiveDate && new Date(expectedReceiveDate) < new Date(new Date().toDateString())) {
    // Lewat hari ini = warning di UI (bukan blocking), pas submit langsung lolos
  }
  return null;
}
```

Identik dengan logic modal lama (`PurchaseOrderModal.tsx:60-66`), tambah validasi tanggal (warning only).

### 4f. Save handler

```ts
async function handleSave(status: 'DRAFT' | 'ORDERED') {
  const err = validate();
  if (err) { showToast(err, 'warning'); return; }
  setSaving(true);
  try {
    const payload = {
      supplier_id: supplierId,
      expected_receive_date: expectedReceiveDate || null,
      notes: notes.trim() || undefined,
      tax_rate: taxEnabled ? (parseFloat(taxRate) / 100 || 0) : 0,
      tax_amount: taxAmount,
      subtotal,
      total,
      status,
      items,
    };
    if (po) {
      await purchaseOrderService.update(po.id, payload);
      if (status === 'ORDERED' && po.status === 'DRAFT') {
        await purchaseOrderService.markOrdered(po.id);
      }
    } else {
      await purchaseOrderService.create(payload);
    }
    setIsDirty(false);
    showToast(po ? 'PO diperbarui.' : `PO dibuat — status: ${status === 'DRAFT' ? 'Draft' : 'Dipesan'}.`, 'success');
    onSaved(status);
  } catch (e: any) {
    showToast(e.message ?? 'Gagal menyimpan PO.', 'warning');
  } finally {
    setSaving(false);
  }
}
```

### 4g. Back handler dengan unsaved warning

```ts
function handleBack() {
  if (isDirty && !confirm('Perubahan belum disimpan. Yakin keluar?')) return;
  onBack();
}
```

---

## Section 5: SupplierPicker Komponen

**File:** `src/components/pembelian/form/SupplierPicker.tsx`

### 5a. 4 state (lihat mockup v2)

| State | Trigger | Tampilan dropdown |
|---|---|---|
| A: Empty DB | `suppliers.length === 0` saat dropdown open | Empty illustration + CTA "Tambah supplier pertama" |
| B: Opened, no typing | Click input, suppliers ada, no search text | "Sering Dipakai" header + suppliers sorted by recent usage + pinned CTA "Tambah supplier baru" |
| C: Typing with match | `search.length > 0` && `matches.length > 0` | "X Hasil" header + matches (highlight) + pinned CTA "Buat baru: 'xxx'" |
| D: Typing no match | `search.length > 0` && `matches.length === 0` | Empty hint + pinned CTA prominent |

### 5b. Sort suppliers by usage frequency

Backend tidak perlu query baru — sort di client dari `suppliers` array. Dasar sorting: count of PO per supplier (dari `orders` yang sudah di-fetch di `PembelianScreen`). Cache hasil di `useMemo`.

```ts
const supplierUsageCount = useMemo(() => {
  const counts = new Map<string, number>();
  orders.forEach(po => counts.set(po.supplier_id, (counts.get(po.supplier_id) ?? 0) + 1));
  return counts;
}, [orders]);

const sortedSuppliers = useMemo(() =>
  [...suppliers].sort((a, b) =>
    (supplierUsageCount.get(b.id) ?? 0) - (supplierUsageCount.get(a.id) ?? 0)
  ),
  [suppliers, supplierUsageCount]
);
```

### 5c. Pinned CTA selalu di bawah dropdown

Implementation:

```tsx
<div className="absolute top-full ... bg-white rounded-lg shadow-xl">
  <div className="max-h-72 overflow-y-auto">
    {/* Suggestions list — bisa scroll */}
  </div>
  <div className="border-t-2 border-gray-100 bg-indigo-50 px-3 py-2.5 sticky bottom-0">
    {/* CTA "Buat baru" — selalu visible */}
  </div>
</div>
```

Sticky bottom dalam dropdown → user yang scroll suggestions tetap lihat CTA.

### 5d. Highlight match

```tsx
function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-amber-200 px-0.5 rounded">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}
```

---

## Section 6: InlineSupplierForm Komponen

**File:** `src/components/pembelian/form/InlineSupplierForm.tsx`

### 6a. Props

```ts
interface InlineSupplierFormProps {
  prefillName?: string;  // dari typed search di SupplierPicker
  onSaved: (newSupplier: DbSupplier) => void;  // setSupplierId di parent
  onCancel: () => void;
}
```

### 6b. Body

Identik dengan `SupplierModal.tsx` body (4 field: nama / kontak / HP / term). Bedanya cuma:
- Wrap dengan `rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/40 p-4`
- Header dalam block: "+ Tambah Supplier Baru" + tombol ✕ Batal
- Footer: "Batal" + "Simpan & Pakai"
- `prefillName` → set initial state `name`

### 6c. Save flow

```ts
async function handleSave() {
  if (!name.trim()) { showToast('Nama supplier wajib diisi.', 'warning'); return; }
  setSaving(true);
  try {
    await supplierService.upsert({ name: name.trim(), contact_name, phone, payment_term_days });
    // Re-fetch supplier list to get the new one with id
    const updated = await supplierService.fetchAll();
    const newSupplier = updated.find(s => s.name === name.trim());
    if (newSupplier) {
      onSaved(newSupplier);
      showToast('Supplier ditambahkan & dipakai untuk PO ini.', 'success');
    }
  } catch (e: any) {
    showToast(e.message ?? 'Gagal menyimpan supplier.', 'warning');
  } finally {
    setSaving(false);
  }
}
```

`supplierService.upsert` existing tidak return id-nya — workaround pakai `fetchAll` lalu cari by name. Cleanup di future: ubah `upsert` agar return `id` (out of scope spec ini).

---

## Section 7: PDF Generation

**File:** `src/lib/pdf/purchaseOrderPdf.ts`

### 7a. Dependencies

`package.json`:

```json
{
  "dependencies": {
    "jspdf": "^2.5.2",
    "jspdf-autotable": "^3.8.4"
  }
}
```

### 7b. Pure fn signature

```ts
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface GeneratePoPdfArgs {
  po: DbPurchaseOrder;
  supplier: DbSupplier;
  items: DbPurchaseOrderItem[];
  companySettings: DbCompanySettings;
  createdByName: string;  // resolved dari admin_users by po.created_by_user_id
}

export function generatePoPdf(args: GeneratePoPdfArgs): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  // ... render header, two-column info, items table via autoTable, totals, notes, footer
  return doc.output('blob');
}
```

### 7c. Visual structure (refer ke mockup v4)

1. **Header (top)**: Icon Zap emerald (SVG path inline) + "Garindo Jaya Panel" + tagline "MSME ERP Suite" + address + phone + email (kiri); "PURCHASE ORDER" + nomor PO (kanan)
2. **Two-column info**: "Kepada" (supplier name + kontak + HP + term) (kiri); "Detail PO" (Tgl Pesan, Diterima paling lambat highlighted amber, Dibuat oleh) (kanan)
3. **Items table** via `autoTable`: No / SKU / Nama / Qty / Harga / Subtotal — multi-page otomatis
4. **Totals**: Subtotal / PPN (kalau aktif) / TOTAL (border-top tebal)
5. **Catatan** (kalau ada): label + body teks
6. **Footer**: T&C 1 baris kecil, center-aligned. Default text: "Barang yang dikirim wajib sesuai spesifikasi PO. Konfirmasi penerimaan via WA dalam 1×24 jam." Hardcoded untuk MVP (kalau perlu configurable, tambah field di `company_settings` future).

### 7d. Open in new tab

Di tombol "Download PDF" di `PoDetailView`:

```ts
async function handleDownloadPdf() {
  const settings = await companySettingsService.fetch();
  if (!settings?.address || !settings?.phone) {
    if (!confirm('Alamat / telp toko belum diisi di Pengaturan. PDF akan tampil tanpa info tersebut. Tetap generate?')) return;
  }
  const createdByName = await resolveUserName(po.created_by_user_id);  // helper, fallback to '—'
  const blob = generatePoPdf({ po, supplier: po.supplier!, items: po.items ?? [], companySettings: settings ?? {}, createdByName });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Auto-revoke setelah 1 menit (browser sudah load PDF)
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
```

### 7e. Tombol PDF di `PoDetailView`

Tambah tombol "📄 Download PDF" di header detail view, hanya muncul untuk `po.status !== 'DRAFT'`.

---

## Section 8: Field Tanggal Diterima — UI Detail

### 8a. Form input

```tsx
<div className="col-span-3">
  <label className="text-xs font-semibold text-gray-600 block mb-1.5">Tgl Diterima Diharapkan</label>
  <div className="relative">
    <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
    <input
      type="date"
      value={expectedReceiveDate}
      onChange={(e) => setExpectedReceiveDate(e.target.value)}
      className={`w-full text-sm border rounded-lg pl-9 pr-3 py-2.5 ${
        isPast(expectedReceiveDate) ? 'border-amber-300 bg-amber-50/30' :
        expectedReceiveDate ? 'border-emerald-300 bg-emerald-50/30' :
        'border-gray-200'
      }`}
    />
  </div>
  {expectedReceiveDate && isPast(expectedReceiveDate) ? (
    <p className="text-[10px] text-amber-700 font-semibold mt-1">⚠ Tanggal sudah lewat. Boleh disimpan, jadi acuan delay.</p>
  ) : (
    <p className="text-[10px] text-gray-400 mt-1">Optional · Kosongkan jika belum pasti</p>
  )}
</div>
```

### 8b. Badge "Telat X hari" di `OrdersTab`

Tambah kolom "Tgl Diterima" di list PO. Untuk PO status ORDERED yang lewat `expected_receive_date`:

```tsx
{isReceiveOverdue(po) && (
  <span className="text-[9px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full">
    Telat {daysOverdue(po.expected_receive_date)} hari
  </span>
)}
```

Helper:

```ts
function isReceiveOverdue(po: DbPurchaseOrder): boolean {
  if (po.status !== 'ORDERED' || !po.expected_receive_date) return false;
  return po.expected_receive_date < new Date().toISOString().slice(0, 10);
}
```

---

## Section 9: Error Handling

| Skenario | Behavior |
|---|---|
| Supplier picker dropdown gagal load (`suppliers` undefined) | Render input dengan placeholder "Memuat supplier..." disabled |
| Save PO RPC error (supabase) | Toast warning dengan e.message; `saving=false`; form data tetap di state |
| PDF generation error (jsPDF throw) | Toast "Gagal generate PDF. Coba lagi." — log e.message ke console |
| `company_settings` fetch return null | Pakai default text "Garindo Jaya Panel" tanpa alamat; show confirm dialog sebelum proceed |
| User tidak punya `can_create_po` permission | Redirect ke list (`onBack()`) + toast warning |
| User browser block popup `window.open` | Fallback: convert blob ke download link, klik programmatic |
| Network offline saat save | Toast "Tidak ada koneksi. Coba lagi setelah online." (deteksi via `navigator.onLine`) |

---

## Section 10: Testing

### 10a. Manual UAT (no automated FE tests in this project)

Project ini tidak punya FE testing infra (no Jest/Vitest setup di `package.json`). Test sepenuhnya manual via dev server. Setelah implementation:

1. **Smoke**: buat PO baru dengan 1 supplier existing + 3 items + tanggal diterima + Pesan → status ORDERED, masuk di list
2. **Empty supplier DB**: hapus semua supplier → buka form → SupplierPicker harus tampilkan empty state + CTA "Tambah supplier pertama"
3. **Inline create supplier**: ketik nama yang tidak ada → klik "+ Buat baru" → isi form → Simpan & Pakai → field Supplier ter-set + supplier baru muncul di tab Suppliers
4. **Edit Draft**: buat Draft → kembali ke list → klik Edit → ubah qty + tambah item → Simpan & Pesan → status ORDERED
5. **PDF generation**: PO ORDERED → klik Download PDF → tab baru buka dengan PDF berisi branding + items + dibuat oleh
6. **Expected date past**: pilih tanggal kemarin → border amber + warning hint; save tetap sukses
7. **Telat receive badge**: PO ORDERED dengan `expected_receive_date < today` → badge "Telat X hari" di list
8. **Permission**: set `can_create_po=false` di Owner panel untuk Admin → login as Admin → klik "Buat PO" → toast + redirect back
9. **Unsaved changes**: isi form → klik Kembali → confirm dialog muncul

### 10b. Backend integration (opsional)

Project punya `backend-go/internal/db/testhelpers.go` dengan live Supabase. Migration 1a perlu test minimum:
- INSERT PO dengan `expected_receive_date` non-null → success
- INSERT PO tanpa `expected_receive_date` → success (NULL)
- UPDATE PO dengan invalid `created_by_user_id` (random UUID) → FK ON DELETE SET NULL aktif

File: `backend-go/internal/db/po_audit_test.go` (optional, kalau ada bandwidth).

---

## Out of Scope (Future Enhancement)

| # | Topik | Trigger untuk implement |
|---|---|---|
| 1 | Tombol "Kirim PDF ke supplier via WA" langsung dari app | Kalau WA infra ready dan client minta one-click share |
| 2 | Upload logo custom di Pengaturan (kolom `logo_url`) | Multi-tenant atau client request branding sendiri |
| 3 | PIN approval untuk PO total > threshold | Phase 2 anti-fraud (sudah ada plan-nya) |
| 4 | Activity log table khusus untuk PO (full history view) | Phase forensics dengan schema audit_log baru |
| 5 | Tax per-item (PPN beda per baris) | Belum ada use case |
| 6 | In-app PDF preview modal (bukan tab baru) | Kalau perlu inline preview + WA share button |
| 7 | Inline create stock item dari form PO | Kalau onboarding user baru terhambat oleh keharusan stock dulu |
| 8 | Mobile responsive table items | Kalau client request mobile-first; sekarang horizontal scroll cukup |
| 9 | Virtual scroll untuk PO dengan 100+ items | Kalau ada user yang break threshold |
| 10 | Configurable footer T&C di `company_settings` | Kalau ada client minta custom |

---

## Implementation Order

Saran sequence untuk plan berikutnya:

1. **Phase A — Foundation** (1 migration + types): migration 1a + 1b, update `types.ts`, update `ALL_PERMISSIONS`
2. **Phase B — Service layer** (pembelianService changes): add `expected_receive_date` + audit fields ke create/update, install jsPDF deps
3. **Phase C — Sub-components** (form/*): SupplierPicker (with 4 states), InlineSupplierForm, StockPicker (extract), ItemRow
4. **Phase D — Orchestrator + wiring**: PurchaseOrderFormPage + PembelianScreen viewMode swap + hapus PurchaseOrderModal
5. **Phase E — PDF**: purchaseOrderPdf.ts + tombol di PoDetailView + edge case handling
6. **Phase F — List integration**: kolom "Tgl Diterima" + badge "Telat X hari" di OrdersTab

Tiap phase: write code → smoke test manual → commit. Phase A wajib first (semua phase setelahnya depend on types + migration).
