# Sales Recording Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-page Sales Recording (Catat Penjualan) flow that replaces the modal-based `SaleModal`, supporting 4 channels (walk-in/tokpedia/grosir/whatsapp), per-row warehouse selection, DP+Lunas invoice flow with auto-printed dotmatrix PDF, and logo upload via Pengaturan.

**Architecture:** Single `PenjualanBaruScreen` page composed from focused sub-components (channel selector, item search panel, customer panel, payment panel, invoice PDF). Data model extends existing `kasir_transactions` table with new columns (no migration to `orders`). State-based routing in `App.tsx` (`activePage = 'penjualanBaru'`). PDF auto-printed via `window.print()` with `@page` CSS sized for 9.5″×11″ continuous fanfold.

**Tech Stack:** React 19 + TypeScript, Tailwind v4, lucide-react icons, Supabase (Postgres + Storage), Vite. Lint via `tsc --noEmit`. No frontend test framework exists; verification is `npm run lint` + `npm run build` + manual QA. Migrations via raw SQL in `supabase/migrations/`.

**Spec:** `docs/superpowers/specs/2026-06-07-sales-recording-overhaul-design.md`

---

## File map

**Database migrations (NEW)**
- `supabase/migrations/20260607000001_kasir_sales_recording.sql` — extend `kasir_transactions` + enum updates
- `supabase/migrations/20260607000002_company_settings_logo.sql` — add `logo_url`

**Types (MODIFY)**
- `src/types.ts` — extend `KasirChannel`, `KasirPaymentMethod`, `KasirItem`, `KasirTransaction`, `NewSaleTransaction`, `DbCompanySettings`

**Services (MODIFY)**
- `src/lib/supabaseClient.ts` — extend `kasirService.insertSaleTransaction` + new `markLunas`, `cancelTransaction`; extend `companySettingsService.uploadLogo`

**Components (NEW — directory `src/components/penjualan/`)**
- `PenjualanBaruScreen.tsx` — page shell, state owner
- `ChannelSelector.tsx` — pills + channel-specific strips
- `ItemSearchPanel.tsx` — left panel (search w/ stock-per-warehouse + cart w/ per-row warehouse)
- `CustomerPanel.tsx` — search w/ lock + new-customer block
- `PaymentPanel.tsx` — payment + DP + ongkir + notes + totals + actions
- `SalesInvoicePDF.tsx` — dotmatrix-friendly invoice (DP / Lunas variants)
- `MarkLunasModal.tsx` — pelunasan modal

**Components (MODIFY)**
- `src/App.tsx` — add `penjualanBaru` case + state for transaction-to-mark-lunas
- `src/components/Sidebar.tsx` — add "Catat Penjualan" nav entry
- `src/components/KasirScreen.tsx` — quick-action button to new page; "Belum Lunas" badge in tx list; "Tandai Lunas" action
- `src/components/PengaturanScreen.tsx` — logo upload widget

**Cleanup (deferred — separate PR after stable)**
- `src/components/KasirScreen.tsx` — remove `SaleModal` once new page proven
- `src/components/KasirInvoiceModal.tsx` — deprecate once `SalesInvoicePDF` covers all uses

---

## PHASE 0 — Database foundation

### Task 0.1: Migration — extend `kasir_transactions`

**Files:**
- Create: `supabase/migrations/20260607000001_kasir_sales_recording.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260607000001_kasir_sales_recording.sql
-- Sub-project A: Sales Recording overhaul
-- Adds channels (whatsapp), payment subtype (debit/qris), DP flow, ongkir, notes,
-- per-row warehouse (in items JSON), and pelunasan state machine.

-- 1. Add 'whatsapp' to kasir_channel enum
DO $$ BEGIN
  ALTER TYPE kasir_channel ADD VALUE IF NOT EXISTS 'whatsapp';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Add 'edc' to kasir_payment_method enum (keep 'qris' for backward compat with old rows)
DO $$ BEGIN
  ALTER TYPE kasir_payment_method ADD VALUE IF NOT EXISTS 'edc';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Add new columns to kasir_transactions
ALTER TABLE public.kasir_transactions
  ADD COLUMN IF NOT EXISTS payment_subtype TEXT,
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'FULL',
  ADD COLUMN IF NOT EXISTS dp_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dp_input_type TEXT,
  ADD COLUMN IF NOT EXISTS ongkir_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokped_order_no TEXT,
  ADD COLUMN IF NOT EXISTS wa_phone TEXT,
  ADD COLUMN IF NOT EXISTS wa_chat_url TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'PAID',
  ADD COLUMN IF NOT EXISTS lunas_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lunas_payment_method kasir_payment_method,
  ADD COLUMN IF NOT EXISTS lunas_payment_subtype TEXT;

-- 4. Check constraints
DO $$ BEGIN
  ALTER TABLE public.kasir_transactions
    ADD CONSTRAINT chk_kasir_payment_type CHECK (payment_type IN ('FULL','DP'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.kasir_transactions
    ADD CONSTRAINT chk_kasir_dp_input_type CHECK (dp_input_type IS NULL OR dp_input_type IN ('AMOUNT','PERCENT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.kasir_transactions
    ADD CONSTRAINT chk_kasir_status CHECK (status IN ('PAID','AWAITING_LUNAS','COMPLETED','CANCELLED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.kasir_transactions
    ADD CONSTRAINT chk_kasir_payment_subtype CHECK (
      payment_subtype IS NULL OR payment_subtype IN ('debit','qris')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. Backfill total_amount for existing rows (subtotal + ongkir, ongkir=0 by default)
UPDATE public.kasir_transactions
SET total_amount = subtotal
WHERE total_amount = 0 AND type = 'income';

-- 6. Index for AWAITING_LUNAS queries
CREATE INDEX IF NOT EXISTS idx_kasir_status_date
  ON public.kasir_transactions(status, date)
  WHERE status = 'AWAITING_LUNAS';
```

- [ ] **Step 2: Apply migration**

If using Supabase CLI:
```bash
supabase db push
```
Or apply via Supabase Studio SQL editor — paste contents of the migration file.

- [ ] **Step 3: Verify schema**

Run in SQL editor:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'kasir_transactions'
  AND column_name IN ('payment_subtype','payment_type','dp_amount','dp_input_type',
                      'ongkir_amount','notes','total_amount','tokped_order_no',
                      'wa_phone','wa_chat_url','status','lunas_at',
                      'lunas_payment_method','lunas_payment_subtype')
ORDER BY column_name;
```
Expected: 14 rows returned.

```sql
SELECT unnest(enum_range(NULL::kasir_channel));
SELECT unnest(enum_range(NULL::kasir_payment_method));
```
Expected: kasir_channel includes 'whatsapp'; kasir_payment_method includes 'edc'.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260607000001_kasir_sales_recording.sql
git commit -m "feat(db): extend kasir_transactions for sales recording overhaul"
```

---

### Task 0.2: Migration — `company_settings.logo_url`

**Files:**
- Create: `supabase/migrations/20260607000002_company_settings_logo.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260607000002_company_settings_logo.sql
-- Add logo_url for PDF invoice header.

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS npwp TEXT;

-- Ensure 'branding' storage bucket exists (uploaded logos go here)
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

-- Public read policy for branding (so the logo URL works without auth)
DO $$ BEGIN
  CREATE POLICY "branding_public_read" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'branding');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Anon insert/update/delete policy for branding (admin uploads via app)
DO $$ BEGIN
  CREATE POLICY "branding_anon_write" ON storage.objects
    FOR ALL TO anon
    USING (bucket_id = 'branding')
    WITH CHECK (bucket_id = 'branding');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```
Or paste in Supabase Studio.

- [ ] **Step 3: Verify**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'company_settings' AND column_name IN ('logo_url','npwp');
```
Expected: 2 rows.

```sql
SELECT id, name, public FROM storage.buckets WHERE id = 'branding';
```
Expected: 1 row, `public = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260607000002_company_settings_logo.sql
git commit -m "feat(db): add logo_url + npwp to company_settings, create branding storage bucket"
```

---

## PHASE 1 — Types & service layer

### Task 1.1: Extend TypeScript types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Update the type definitions**

Find the existing block (around lines 335-400 — search for `export type KasirChannel`):

```typescript
export type KasirChannel = 'walkin' | 'tokopedia' | 'grosir';
export type KasirPaymentMethod = 'cash' | 'transfer' | 'qris';
```

Replace with:

```typescript
export type KasirChannel = 'walkin' | 'tokopedia' | 'grosir' | 'whatsapp';
export type KasirPaymentMethod = 'cash' | 'transfer' | 'qris' | 'edc';
export type KasirPaymentSubtype = 'debit' | 'qris' | null;
export type KasirPaymentType = 'FULL' | 'DP';
export type KasirDpInputType = 'AMOUNT' | 'PERCENT' | null;
export type KasirStatus = 'PAID' | 'AWAITING_LUNAS' | 'COMPLETED' | 'CANCELLED';
export type WarehouseLocation = 'atas' | 'bawah';
```

Find `KasirItem` and update to:

```typescript
export interface KasirItem {
  sku: string;
  name: string;
  qty: number;
  unit_price: number;
  hpp_per_unit: number;
  subtotal: number;
  hpp_subtotal: number;
  warehouse: WarehouseLocation;
}
```

Find `KasirTransaction` and add the new fields (preserve existing ones):

```typescript
export interface KasirTransaction {
  id: string;
  date: string;
  type: 'income' | 'expense';
  channel?: KasirChannel | null;
  items: KasirItem[];
  subtotal: number;
  hpp_total: number;
  payment_method?: KasirPaymentMethod | null;
  payment_subtype?: KasirPaymentSubtype;
  payment_type?: KasirPaymentType;
  dp_amount?: number;
  dp_input_type?: KasirDpInputType;
  ongkir_amount?: number;
  notes?: string | null;
  total_amount?: number;
  tokped_order_no?: string | null;
  wa_phone?: string | null;
  wa_chat_url?: string | null;
  status?: KasirStatus;
  lunas_at?: string | null;
  lunas_payment_method?: KasirPaymentMethod | null;
  lunas_payment_subtype?: KasirPaymentSubtype;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_company?: string | null;
  invoice_number?: string | null;
  expense_category?: KasirExpenseCategory | null;
  description?: string | null;
  po_id?: string | null;
  created_by?: string | null;
  created_at: string;
}
```

Find `NewSaleTransaction` and update to:

```typescript
export interface NewSaleTransaction {
  date: string;
  channel: KasirChannel;
  items: KasirItem[];
  subtotal: number;
  hpp_total: number;
  payment_method: KasirPaymentMethod;
  payment_subtype?: KasirPaymentSubtype;
  payment_type: KasirPaymentType;
  dp_amount: number;
  dp_input_type?: KasirDpInputType;
  ongkir_amount: number;
  notes?: string;
  total_amount: number;
  tokped_order_no?: string;
  wa_phone?: string;
  wa_chat_url?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_company?: string;
  invoice_number: string;
}
```

Find `DbCompanySettings` (search for `bank_name: string`) — make sure it includes:

```typescript
export interface DbCompanySettings {
  id?: string;
  company_name: string;
  address: string;
  phone: string;
  email: string;
  logo_url?: string | null;
  npwp?: string | null;
  updated_at?: string;
}
```

(If fields beyond name/address/phone/email already exist, just ensure `logo_url` and `npwp` are added.)

- [ ] **Step 2: Run lint**

```bash
npm run lint
```
Expected: pass (or only pre-existing errors from progress.md notes — App.tsx / SalesInboxScreen.tsx / Sidebar.tsx / edge functions). No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): extend KasirTransaction + KasirItem + DbCompanySettings for sales recording overhaul"
```

---

### Task 1.2: Extend `kasirService.insertSaleTransaction`

**Files:**
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Locate and update `insertSaleTransaction`**

Find `kasirService.insertSaleTransaction` (around line 854+ — search for `kasirService = {`). It currently maps `NewSaleTransaction` to a Supabase insert.

Update the insert payload to include the new columns. The existing function should look roughly like:

```typescript
async insertSaleTransaction(tx: NewSaleTransaction): Promise<KasirTransaction> {
  const { data, error } = await supabase
    .from('kasir_transactions')
    .insert({
      date: tx.date,
      type: 'income',
      channel: tx.channel,
      items: tx.items,
      subtotal: tx.subtotal,
      hpp_total: tx.hpp_total,
      payment_method: tx.payment_method,
      customer_name: tx.customer_name,
      // ...
      invoice_number: tx.invoice_number,
    })
    .select()
    .single();
  if (error) throw error;
  return data as KasirTransaction;
}
```

Add the new fields to the insert object:

```typescript
async insertSaleTransaction(tx: NewSaleTransaction): Promise<KasirTransaction> {
  const { data, error } = await supabase
    .from('kasir_transactions')
    .insert({
      date: tx.date,
      type: 'income',
      channel: tx.channel,
      items: tx.items,
      subtotal: tx.subtotal,
      hpp_total: tx.hpp_total,
      payment_method: tx.payment_method,
      payment_subtype: tx.payment_subtype ?? null,
      payment_type: tx.payment_type,
      dp_amount: tx.dp_amount,
      dp_input_type: tx.dp_input_type ?? null,
      ongkir_amount: tx.ongkir_amount,
      notes: tx.notes ?? null,
      total_amount: tx.total_amount,
      tokped_order_no: tx.tokped_order_no ?? null,
      wa_phone: tx.wa_phone ?? null,
      wa_chat_url: tx.wa_chat_url ?? null,
      status: tx.payment_type === 'DP' ? 'AWAITING_LUNAS' : 'PAID',
      customer_name: tx.customer_name ?? null,
      customer_phone: tx.customer_phone ?? null,
      customer_company: tx.customer_company ?? null,
      invoice_number: tx.invoice_number,
    })
    .select()
    .single();
  if (error) throw error;
  return data as KasirTransaction;
}
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```
Expected: pass (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(service): extend kasirService.insertSaleTransaction with DP, ongkir, notes, channel-specific fields"
```

---

### Task 1.3: Add `kasirService.markLunas` + `cancelTransaction`

**Files:**
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Add the two new methods**

Inside `kasirService = { ... }`, after `insertSaleTransaction`, add:

```typescript
async markLunas(
  id: string,
  lunasPayment: { method: KasirPaymentMethod; subtype?: KasirPaymentSubtype; ongkirAdjust?: number }
): Promise<KasirTransaction> {
  // Optionally recompute total_amount if ongkir adjusted
  const updates: any = {
    status: 'COMPLETED',
    lunas_at: new Date().toISOString(),
    lunas_payment_method: lunasPayment.method,
    lunas_payment_subtype: lunasPayment.subtype ?? null,
  };
  if (typeof lunasPayment.ongkirAdjust === 'number') {
    // Fetch current row to recompute total_amount
    const { data: cur, error: e1 } = await supabase
      .from('kasir_transactions').select('subtotal,ongkir_amount').eq('id', id).single();
    if (e1) throw e1;
    const newOngkir = (cur?.ongkir_amount ?? 0) + lunasPayment.ongkirAdjust;
    updates.ongkir_amount = newOngkir;
    updates.total_amount = (cur?.subtotal ?? 0) + newOngkir;
  }
  const { data, error } = await supabase
    .from('kasir_transactions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as KasirTransaction;
},

async cancelTransaction(id: string): Promise<void> {
  const { error } = await supabase
    .from('kasir_transactions')
    .update({ status: 'CANCELLED' })
    .eq('id', id);
  if (error) throw error;
},
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(service): add kasirService.markLunas + cancelTransaction"
```

---

## PHASE 2 — Pengaturan: logo upload

### Task 2.1: Add `companySettingsService.uploadLogo`

**Files:**
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Locate `companySettingsService` and add upload method**

Find `companySettingsService = { ... }`. Add a new method:

```typescript
async uploadLogo(file: File): Promise<string> {
  // Generate a deterministic path: branding/logo_{timestamp}.{ext}
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `logo_${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('branding')
    .upload(path, file, { upsert: true, cacheControl: '3600' });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from('branding').getPublicUrl(path);
  const url = pub.publicUrl;
  // Save URL to company_settings row (assumes single row)
  const { error: updErr } = await supabase
    .from('company_settings')
    .update({ logo_url: url, updated_at: new Date().toISOString() })
    .eq('id', (await this.fetch())?.id ?? '');
  if (updErr) throw updErr;
  return url;
},

async clearLogo(): Promise<void> {
  const settings = await this.fetch();
  if (!settings?.logo_url) return;
  // Best-effort delete from storage
  const filename = settings.logo_url.split('/').pop();
  if (filename) {
    await supabase.storage.from('branding').remove([filename]);
  }
  await supabase
    .from('company_settings')
    .update({ logo_url: null })
    .eq('id', settings.id ?? '');
},
```

(Note: `this.fetch()` assumes the service has a `fetch()` method that returns the single company_settings row. If not, replace with the actual fetch call used elsewhere — search for `companySettingsService.fetch` to confirm the pattern.)

- [ ] **Step 2: Run lint**

```bash
npm run lint
```
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(service): add companySettingsService.uploadLogo + clearLogo"
```

---

### Task 2.2: Logo upload widget in Pengaturan

**Files:**
- Modify: `src/components/PengaturanScreen.tsx`

- [ ] **Step 1: Add logo state + upload handler**

At the top of `PengaturanScreen` (inside the component, near existing state hooks), add:

```typescript
const [logoUrl, setLogoUrl] = useState<string | null>(null);
const [logoUploading, setLogoUploading] = useState(false);
const logoFileRef = useRef<HTMLInputElement | null>(null);
```

Add import:

```typescript
import { useRef } from 'react';
import { Upload, Image as ImageIcon, Trash2 } from 'lucide-react';
```

In the existing `useEffect` that loads `companySettingsService.fetch()`, also set `setLogoUrl(coResult?.logo_url ?? null)`.

Add handlers (before the `return`):

```typescript
async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 1024 * 1024) {
    triggerToast?.('Logo maksimal 1 MB.', 'warning');
    return;
  }
  if (!['image/png','image/jpeg','image/jpg'].includes(file.type)) {
    triggerToast?.('Format logo harus PNG atau JPG.', 'warning');
    return;
  }
  setLogoUploading(true);
  try {
    const url = await companySettingsService.uploadLogo(file);
    setLogoUrl(url);
    triggerToast?.('Logo berhasil di-upload.', 'success');
  } catch (err: any) {
    triggerToast?.(`Gagal upload logo: ${err.message ?? 'unknown'}`, 'warning');
  } finally {
    setLogoUploading(false);
    if (logoFileRef.current) logoFileRef.current.value = '';
  }
}

async function handleLogoClear() {
  if (!confirm('Hapus logo? Ini akan menghilangkan logo dari semua invoice baru.')) return;
  try {
    await companySettingsService.clearLogo();
    setLogoUrl(null);
    triggerToast?.('Logo dihapus.', 'success');
  } catch (err: any) {
    triggerToast?.(`Gagal hapus logo: ${err.message ?? 'unknown'}`, 'warning');
  }
}
```

(`triggerToast` may not exist with that name — check how toasts are dispatched in the component. If it's a prop named `showToast`, use that.)

- [ ] **Step 2: Add the logo upload UI block**

Inside the Profil Toko section (after the existing form fields), add:

```tsx
<div className="border-t border-slate-100 pt-5 mt-5">
  <label className="text-[11px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-2">
    Logo Toko (untuk invoice PDF)
  </label>
  <div className="flex items-center gap-4">
    <div className="w-20 h-20 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center overflow-hidden">
      {logoUrl ? (
        <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
      ) : (
        <ImageIcon className="w-8 h-8 text-slate-300" />
      )}
    </div>
    <div className="flex flex-col gap-2">
      <input
        ref={logoFileRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={handleLogoUpload}
      />
      <button
        type="button"
        onClick={() => logoFileRef.current?.click()}
        disabled={logoUploading}
        className="inline-flex items-center gap-2 px-4 py-2 bg-[#012749] text-white text-xs font-bold rounded-lg hover:bg-[#01365e] disabled:opacity-60"
      >
        <Upload className="w-3.5 h-3.5" />
        {logoUploading ? 'Mengunggah...' : (logoUrl ? 'Ganti Logo' : 'Upload Logo')}
      </button>
      {logoUrl && (
        <button
          type="button"
          onClick={handleLogoClear}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-rose-200 text-rose-600 text-xs font-bold rounded-lg hover:bg-rose-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Hapus Logo
        </button>
      )}
      <p className="text-[10px] text-slate-400">PNG / JPG, maks 1 MB. Rekomendasi 200×200 px (akan ter-dithered di printout dotmatrix).</p>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Build & verify**

```bash
npm run build
```
Expected: build succeeds (no new errors).

Manual: Open Pengaturan in dev (`npm run dev`), upload a PNG, see it appear; reload — still appears; click "Hapus Logo" — gone.

- [ ] **Step 4: Commit**

```bash
git add src/components/PengaturanScreen.tsx
git commit -m "feat(pengaturan): add logo upload widget + clear button"
```

---

## PHASE 3 — Page scaffold + routing

### Task 3.1: Scaffold `PenjualanBaruScreen` skeleton

**Files:**
- Create: `src/components/PenjualanBaruScreen.tsx`

- [ ] **Step 1: Create the page shell**

```tsx
import React, { useState, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import {
  KasirChannel, KasirPaymentMethod, KasirPaymentSubtype, KasirPaymentType,
  KasirDpInputType, KasirItem, WarehouseLocation, PermissionSet,
} from '../types';
import type { DbCustomerWithStats } from '../types';
import { stockService, customersService, kasirService } from '../lib/supabaseClient';
import type { SupabaseStockItem } from '../lib/supabaseClient';

export interface PenjualanBaruScreenProps {
  currentUser: { name: string; role: string; permissions: PermissionSet } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onBack: () => void;            // navigate back to kasir
  onSaved: (txId: string) => void; // after save, parent can refresh + open invoice
  initialChannel?: KasirChannel;
}

export default function PenjualanBaruScreen({
  currentUser, showToast, onBack, onSaved, initialChannel,
}: PenjualanBaruScreenProps) {
  // Channel
  const [channel, setChannel] = useState<KasirChannel>(initialChannel ?? 'walkin');

  // Channel-specific fields
  const [tokpedOrderNo, setTokpedOrderNo] = useState('');
  const [waPhone, setWaPhone] = useState('');
  const [waChatUrl, setWaChatUrl] = useState('');

  // Cart items
  const [cart, setCart] = useState<(KasirItem & { _key: number })[]>([]);

  // Customer
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCompany, setCustomerCompany] = useState('');

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<KasirPaymentMethod>('cash');
  const [paymentSubtype, setPaymentSubtype] = useState<KasirPaymentSubtype>(null);
  const [paymentType, setPaymentType] = useState<KasirPaymentType>('FULL');
  const [dpAmount, setDpAmount] = useState(0);
  const [dpInputType, setDpInputType] = useState<KasirDpInputType>('AMOUNT');

  // Extras
  const [ongkirOn, setOngkirOn] = useState(false);
  const [ongkirAmount, setOngkirAmount] = useState(0);
  const [notes, setNotes] = useState('');

  // Master data
  const [stocks, setStocks] = useState<SupabaseStockItem[]>([]);
  const [customers, setCustomers] = useState<DbCustomerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load master data once
  useEffect(() => {
    Promise.all([stockService.fetchAll(), customersService.fetchAll()])
      .then(([s, c]) => { setStocks(s); setCustomers(c); })
      .catch(err => showToast(`Gagal memuat data: ${err.message ?? 'unknown'}`, 'warning'))
      .finally(() => setLoading(false));
  }, []);

  // Totals
  const subtotal = cart.reduce((s, i) => s + i.subtotal, 0);
  const totalInvoice = subtotal + (ongkirOn ? ongkirAmount : 0);
  const sisaPelunasan = paymentType === 'DP' ? totalInvoice - dpAmount : 0;

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      {/* Top bar */}
      <div className="bg-[#012749] text-white rounded-t-2xl px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-white/80 hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="font-extrabold text-sm">📋 Catat Penjualan</div>
            <div className="text-[11px] opacity-65">Dashboard › Penjualan › Baru</div>
          </div>
        </div>
        <div className="flex gap-2 text-[11px]">
          <span className="bg-white/15 px-3 py-1 rounded-full font-bold">
            📅 {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <span className="bg-white/15 px-3 py-1 rounded-full font-bold">
            👤 {currentUser?.name ?? 'Admin'}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-b-2xl p-5 md:p-6 shadow-sm">
        {loading ? (
          <p className="text-center text-slate-400 py-12 text-sm">Memuat data...</p>
        ) : (
          <>
            {/* Channel selector + strips go here (Task 4.x) */}
            <div className="text-sm text-slate-400">[Channel selector, strips, item panel, customer panel — fill in via subsequent tasks]</div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build & verify**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/PenjualanBaruScreen.tsx
git commit -m "feat(penjualan): scaffold PenjualanBaruScreen page shell"
```

---

### Task 3.2: Wire route in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the case in the screen switcher**

Find the `case 'kasir':` block (around line 315). Right after it, add:

```tsx
case 'penjualanBaru':
  return (
    <PenjualanBaruScreen
      currentUser={currentUser}
      showToast={triggerToast}
      onBack={() => setActivePage('kasir')}
      onSaved={(_txId) => setActivePage('kasir')}
    />
  );
```

Add the import at the top with the other screen imports:

```typescript
import PenjualanBaruScreen from './components/PenjualanBaruScreen';
```

- [ ] **Step 2: Build & verify**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(routing): wire PenjualanBaruScreen into App.tsx switcher"
```

---

### Task 3.3: Sidebar nav entry

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add the menu item**

Find the existing menu config (search for `kasir` or icon imports). Add a new entry similar in style:

```tsx
{ key: 'penjualanBaru', label: 'Catat Penjualan', icon: <ShoppingCart className="w-4 h-4" /> },
```

(Use whatever icon prop pattern exists. `ShoppingCart` from lucide-react.) Add `ShoppingCart` to the lucide-react import line if not already imported. Place this entry near the Kasir entry to group sales-related items.

- [ ] **Step 2: Build & verify**

```bash
npm run build
```
Expected: build succeeds. Manual: open dev server, sidebar shows new item, clicking it routes to scaffold page with "[Channel selector, strips...]" placeholder.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(sidebar): add Catat Penjualan nav entry"
```

---

## PHASE 4 — Channel selector + strips

### Task 4.1: `ChannelSelector` component

**Files:**
- Create: `src/components/penjualan/ChannelSelector.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from 'react';
import { KasirChannel } from '../../types';

const CHANNELS: { key: KasirChannel; label: string; ico: string; activeClass: string }[] = [
  { key: 'walkin',    label: 'Walk-in',     ico: '🏪', activeClass: 'bg-blue-50 text-blue-700 border-blue-700' },
  { key: 'tokopedia', label: 'Tokopedia',   ico: '🛍️', activeClass: 'bg-amber-100 text-amber-700 border-amber-600 shadow-amber-200/40 shadow-md' },
  { key: 'grosir',    label: 'Grosir',      ico: '🏭', activeClass: 'bg-violet-100 text-violet-700 border-violet-600' },
  { key: 'whatsapp',  label: 'WhatsApp',    ico: '💬', activeClass: 'bg-green-100 text-green-700 border-green-600 shadow-green-200/40 shadow-md' },
];

export interface ChannelSelectorProps {
  value: KasirChannel;
  onChange: (next: KasirChannel) => void;
}

export default function ChannelSelector({ value, onChange }: ChannelSelectorProps) {
  return (
    <div>
      <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
        Kanal Penjualan
      </label>
      <div className="flex gap-2 flex-wrap">
        {CHANNELS.map(c => (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(c.key)}
            className={`px-4 py-2 rounded-full text-[13px] font-bold border flex items-center gap-1.5 transition ${
              value === c.key
                ? c.activeClass
                : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span>{c.ico}</span>
            <span>{c.label}</span>
            {c.key === 'whatsapp' && value === c.key && (
              <span className="ml-1 text-[10px] bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded font-extrabold">MANUAL</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount in `PenjualanBaruScreen`**

Replace the `[Channel selector, strips...]` placeholder with:

```tsx
import ChannelSelector from './penjualan/ChannelSelector';
// ...
<ChannelSelector value={channel} onChange={setChannel} />
```

- [ ] **Step 3: Build & verify**

```bash
npm run build
```
Manual: visit page, click each pill, see active style switch.

- [ ] **Step 4: Commit**

```bash
git add src/components/penjualan/ChannelSelector.tsx src/components/PenjualanBaruScreen.tsx
git commit -m "feat(penjualan): add ChannelSelector + mount in screen"
```

---

### Task 4.2: Channel-specific strips (Tokopedia + WhatsApp)

**Files:**
- Create: `src/components/penjualan/ChannelStrip.tsx`

- [ ] **Step 1: Create the strip components**

```tsx
import React from 'react';

export interface TokpedStripProps {
  value: string;
  onChange: (v: string) => void;
}

export function TokpedStrip({ value, onChange }: TokpedStripProps) {
  return (
    <div className="bg-gradient-to-r from-amber-100 to-amber-50 border border-amber-300 border-l-4 border-l-amber-600 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
      <span className="text-2xl leading-none">🛍️</span>
      <div className="flex-1">
        <label className="text-[11px] font-extrabold text-amber-700 uppercase tracking-widest block">
          Nomor Pesanan Tokopedia <span className="text-rose-600">*</span>
        </label>
        <p className="text-[11px] text-amber-800 mt-0.5">Copy dari aplikasi Seller Tokopedia.</p>
      </div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="INV/..."
        className="bg-white border border-amber-300 rounded-lg px-3 py-2 text-[13px] font-bold text-amber-900 min-w-[220px]"
      />
    </div>
  );
}

export interface WhatsappStripProps {
  phone: string;
  chatUrl: string;
  onPhoneChange: (v: string) => void;
  onChatUrlChange: (v: string) => void;
}

export function WhatsappStrip({ phone, chatUrl, onPhoneChange, onChatUrlChange }: WhatsappStripProps) {
  return (
    <div className="bg-gradient-to-r from-green-100 to-green-50 border border-green-300 border-l-4 border-l-green-600 rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
      <span className="text-2xl leading-none mt-0.5">💬</span>
      <div className="flex-1">
        <label className="text-[11px] font-extrabold text-green-700 uppercase tracking-widest block">
          Catat Pesanan WhatsApp Manual
        </label>
        <p className="text-[11px] text-green-800 mt-0.5 mb-2">Pesanan WA yang di-input manual oleh admin.</p>
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <input
            value={phone}
            onChange={e => onPhoneChange(e.target.value)}
            placeholder="No. WA pelanggan"
            className="bg-white border border-green-300 rounded-lg px-3 py-2 text-[13px] font-bold text-green-900"
          />
          <input
            value={chatUrl}
            onChange={e => onChatUrlChange(e.target.value)}
            placeholder="Link chat WA (opsional)"
            className="bg-white border border-green-300 rounded-lg px-3 py-2 text-[13px] font-bold text-green-900"
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount conditionally in `PenjualanBaruScreen`**

Right after `<ChannelSelector ... />`, add:

```tsx
import { TokpedStrip, WhatsappStrip } from './penjualan/ChannelStrip';
// ...
{channel === 'tokopedia' && (
  <div className="mt-4">
    <TokpedStrip value={tokpedOrderNo} onChange={setTokpedOrderNo} />
  </div>
)}
{channel === 'whatsapp' && (
  <div className="mt-4">
    <WhatsappStrip
      phone={waPhone}
      chatUrl={waChatUrl}
      onPhoneChange={setWaPhone}
      onChatUrlChange={setWaChatUrl}
    />
  </div>
)}
```

- [ ] **Step 3: Build & verify**

```bash
npm run build
```
Manual: switch channels — Tokped strip + WhatsApp strip appear/disappear correctly.

- [ ] **Step 4: Commit**

```bash
git add src/components/penjualan/ChannelStrip.tsx src/components/PenjualanBaruScreen.tsx
git commit -m "feat(penjualan): add Tokped + WhatsApp channel strips with conditional render"
```

---

## PHASE 5 — Item search panel

### Task 5.1: `ItemSearchPanel` — search + dropdown with stock pills

**Files:**
- Create: `src/components/penjualan/ItemSearchPanel.tsx`

- [ ] **Step 1: Create the component (search + dropdown only)**

```tsx
import React, { useState } from 'react';
import { Search } from 'lucide-react';
import type { SupabaseStockItem } from '../../lib/supabaseClient';

export interface ItemSearchPanelProps {
  stocks: SupabaseStockItem[];
  cartCount: number;
  cartSubtotal: number;
  onAdd: (stock: SupabaseStockItem) => void;
  children?: React.ReactNode; // cart content rendered below by parent
}

function formatRp(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(n);
}

export default function ItemSearchPanel({ stocks, cartCount, cartSubtotal, onAdd, children }: ItemSearchPanelProps) {
  const [q, setQ] = useState('');

  const filtered = q.trim().length > 0
    ? stocks.filter(s =>
        s.name.toLowerCase().includes(q.toLowerCase()) ||
        s.sku.toLowerCase().includes(q.toLowerCase())
      ).slice(0, 8)
    : [];

  return (
    <div className="bg-gradient-to-b from-amber-50 to-white border-2 border-amber-200 rounded-2xl overflow-hidden shadow-md">
      {/* Header */}
      <div className="bg-amber-500 text-white px-4 py-3 flex justify-between items-center">
        <h3 className="font-extrabold text-[13px] uppercase tracking-wide flex items-center gap-2">
          🛒 Tambah Barang & Keranjang
        </h3>
        <span className="bg-white text-orange-700 px-3 py-1 rounded-full text-[11px] font-extrabold">
          {cartCount} ITEM · {formatRp(cartSubtotal)}
        </span>
      </div>

      <div className="p-4">
        <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
          Cari Barang
        </label>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Ketik nama atau SKU barang…"
            className="w-full pl-10 pr-3 py-3 border-2 border-slate-200 rounded-xl text-[13px] font-semibold bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-200 outline-none"
          />
        </div>

        {filtered.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl mb-3 shadow">
            {filtered.map(s => {
              const atas = s.stock_atas ?? 0;
              const bawah = s.stock_bawah ?? 0;
              return (
                <div key={s.sku} className="px-4 py-3 grid grid-cols-[1fr_auto_auto] gap-3 items-center text-[12px] border-b border-slate-100 last:border-b-0">
                  <div>
                    <div className="font-extrabold">{s.name}</div>
                    <div className="text-slate-400 text-[11px] mt-0.5">SKU: {s.sku}</div>
                  </div>
                  <div className="flex gap-1">
                    <span className={`px-2 py-1 rounded-md text-[11px] font-extrabold border ${atas > 0 ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-rose-100 text-rose-700 border-rose-300'}`}>
                      Atas {atas}
                    </span>
                    <span className={`px-2 py-1 rounded-md text-[11px] font-extrabold border ${bawah > 0 ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-rose-100 text-rose-700 border-rose-300'}`}>
                      Bawah {bawah}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="font-extrabold text-[#012749] text-[12px]">{formatRp(s.price)}</div>
                    <button
                      type="button"
                      onClick={() => onAdd(s)}
                      disabled={atas + bawah === 0}
                      className="bg-[#2d8a4e] text-white px-3 py-1 rounded-md text-[11px] font-extrabold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      + Tambah
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Cart rendered by parent via children */}
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build & verify**

```bash
npm run build
```
Expected: build succeeds (component not yet mounted, just defined).

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/ItemSearchPanel.tsx
git commit -m "feat(penjualan): add ItemSearchPanel (search + dropdown with per-warehouse stock pills)"
```

---

### Task 5.2: `CartRows` — per-row warehouse selector + qty stepper

**Files:**
- Create: `src/components/penjualan/CartRows.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from 'react';
import { KasirItem, WarehouseLocation } from '../../types';
import type { SupabaseStockItem } from '../../lib/supabaseClient';

function formatRp(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(n);
}

export interface CartRowsProps {
  items: (KasirItem & { _key: number })[];
  stocks: SupabaseStockItem[]; // for per-warehouse stock lookup
  onQtyChange: (key: number, qty: number) => void;
  onWarehouseChange: (key: number, wh: WarehouseLocation) => void;
  onRemove: (key: number) => void;
}

export default function CartRows({ items, stocks, onQtyChange, onWarehouseChange, onRemove }: CartRowsProps) {
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);

  if (items.length === 0) {
    return (
      <div className="px-6 py-8 text-center text-slate-400 text-[13px] bg-slate-50 border border-dashed border-slate-300 rounded-xl">
        Belum ada item. Tambahkan dari hasil pencarian di atas.
      </div>
    );
  }

  return (
    <>
      <div className="bg-emerald-50 border border-emerald-300 rounded-xl px-3 py-2 mb-2 flex justify-between items-center">
        <div className="font-extrabold text-emerald-700 text-[13px] flex items-center gap-2">
          🧺 Keranjang
          <span className="bg-emerald-700 text-white px-2 py-0.5 rounded-full text-[11px] font-extrabold">{items.length} item</span>
        </div>
        <div className="font-extrabold text-emerald-700 text-[13px]">{formatRp(subtotal)}</div>
      </div>

      {items.map(item => {
        const stock = stocks.find(s => s.sku === item.sku);
        const atas = stock?.stock_atas ?? 0;
        const bawah = stock?.stock_bawah ?? 0;
        return (
          <div
            key={item._key}
            className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl mb-2 items-center text-[12px]"
          >
            <div>
              <div className="font-extrabold">{item.name}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">@ {formatRp(item.unit_price)}</div>
            </div>
            {/* Warehouse selector */}
            <div className="flex gap-0.5 bg-white border border-slate-200 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => atas > 0 && onWarehouseChange(item._key, 'atas')}
                disabled={atas === 0}
                className={`px-2 py-1 rounded-md text-[11px] font-extrabold flex items-center gap-1 ${
                  item.warehouse === 'atas'
                    ? 'bg-blue-100 text-blue-700'
                    : atas === 0 ? 'opacity-40 cursor-not-allowed' : 'text-slate-400 hover:bg-slate-50'
                }`}
              >
                Atas <span className="text-[10px] opacity-70">{atas}</span>
              </button>
              <button
                type="button"
                onClick={() => bawah > 0 && onWarehouseChange(item._key, 'bawah')}
                disabled={bawah === 0}
                className={`px-2 py-1 rounded-md text-[11px] font-extrabold flex items-center gap-1 ${
                  item.warehouse === 'bawah'
                    ? 'bg-amber-100 text-amber-700'
                    : bawah === 0 ? 'opacity-40 cursor-not-allowed' : 'text-slate-400 hover:bg-slate-50'
                }`}
              >
                Bawah <span className="text-[10px] opacity-70">{bawah}</span>
              </button>
            </div>
            {/* Qty stepper */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
              <button type="button" onClick={() => onQtyChange(item._key, Math.max(1, item.qty - 1))} className="w-6 h-6 rounded bg-slate-100 font-extrabold">−</button>
              <input
                value={item.qty}
                onChange={e => onQtyChange(item._key, Math.max(1, parseInt(e.target.value || '1', 10)))}
                className="w-10 text-center font-extrabold text-[12px] bg-transparent outline-none"
              />
              <button type="button" onClick={() => onQtyChange(item._key, item.qty + 1)} className="w-6 h-6 rounded bg-slate-100 font-extrabold">+</button>
            </div>
            <div className="font-extrabold text-[#012749] min-w-[90px] text-right text-[13px]">{formatRp(item.subtotal)}</div>
            <button type="button" onClick={() => onRemove(item._key)} className="text-slate-300 hover:text-rose-500 text-lg leading-none">✕</button>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Build & verify**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/CartRows.tsx
git commit -m "feat(penjualan): add CartRows with per-row warehouse selector + qty stepper"
```

---

### Task 5.3: Wire ItemSearchPanel + CartRows in `PenjualanBaruScreen`

**Files:**
- Modify: `src/components/PenjualanBaruScreen.tsx`

- [ ] **Step 1: Add cart manipulation handlers**

Add these inside the component, near other useState hooks:

```tsx
let _itemSeq = 0; // module-level counter at top of file (outside component)
```

Move that to module level (top of file, after imports):

```tsx
let _itemSeq = 0;
```

Inside component, add handlers:

```tsx
function addItem(stock: SupabaseStockItem) {
  const atas = stock.stock_atas ?? 0;
  const bawah = stock.stock_bawah ?? 0;
  const defaultWh: WarehouseLocation = atas > 0 ? 'atas' : (bawah > 0 ? 'bawah' : 'atas');
  setCart(prev => [
    ...prev,
    {
      _key: ++_itemSeq,
      sku: stock.sku,
      name: stock.name,
      qty: 1,
      unit_price: stock.price,
      hpp_per_unit: stock.harga_modal ?? 0,
      subtotal: stock.price,
      hpp_subtotal: stock.harga_modal ?? 0,
      warehouse: defaultWh,
    },
  ]);
}

function updateQty(key: number, qty: number) {
  setCart(prev => prev.map(i =>
    i._key === key
      ? { ...i, qty, subtotal: i.unit_price * qty, hpp_subtotal: i.hpp_per_unit * qty }
      : i
  ));
}

function updateWarehouse(key: number, wh: WarehouseLocation) {
  setCart(prev => prev.map(i => i._key === key ? { ...i, warehouse: wh } : i));
}

function removeItem(key: number) {
  setCart(prev => prev.filter(i => i._key !== key));
}
```

- [ ] **Step 2: Replace placeholder with two-column layout**

Replace `<div className="text-sm text-slate-400">[Channel selector...]</div>` (which followed the strips) with:

```tsx
<div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-4">
  <div>
    <ItemSearchPanel
      stocks={stocks}
      cartCount={cart.length}
      cartSubtotal={subtotal}
      onAdd={addItem}
    >
      <CartRows
        items={cart}
        stocks={stocks}
        onQtyChange={updateQty}
        onWarehouseChange={updateWarehouse}
        onRemove={removeItem}
      />
    </ItemSearchPanel>
  </div>
  <div>
    {/* Customer + Payment panels — wired in Phase 6+7 */}
    <div className="bg-white border border-slate-200 rounded-2xl p-4 text-sm text-slate-400">
      [Customer + Payment panels coming next]
    </div>
  </div>
</div>
```

Add the imports at top:

```tsx
import ItemSearchPanel from './penjualan/ItemSearchPanel';
import CartRows from './penjualan/CartRows';
```

- [ ] **Step 3: Build & verify**

```bash
npm run build
```
Manual: search for an item, see stock pills, click + Tambah, see it in cart; toggle warehouse per row; qty stepper works; ✕ removes row.

- [ ] **Step 4: Commit**

```bash
git add src/components/PenjualanBaruScreen.tsx
git commit -m "feat(penjualan): wire ItemSearchPanel + CartRows into screen with cart handlers"
```

---

## PHASE 6 — Customer panel

### Task 6.1: `CustomerPanel` component

**Files:**
- Create: `src/components/penjualan/CustomerPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React, { useState } from 'react';
import { Search, Lock, X } from 'lucide-react';
import type { DbCustomerWithStats } from '../../types';

function formatRp(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(n);
}

export interface CustomerPanelProps {
  customers: DbCustomerWithStats[];
  selectedCustomerId: string | null;
  customerName: string;
  customerPhone: string;
  customerCompany: string;
  onSelectExisting: (c: DbCustomerWithStats) => void;
  onClearSelection: () => void;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onCompanyChange: (v: string) => void;
}

export default function CustomerPanel(props: CustomerPanelProps) {
  const {
    customers, selectedCustomerId, customerName, customerPhone, customerCompany,
    onSelectExisting, onClearSelection, onNameChange, onPhoneChange, onCompanyChange,
  } = props;
  const [search, setSearch] = useState('');

  const isSelected = !!selectedCustomerId;

  const filtered = !isSelected && search.trim().length > 0
    ? customers.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.company?.toLowerCase().includes(search.toLowerCase()) ||
        c.wa_number?.includes(search)
      ).slice(0, 6)
    : [];

  const selected = isSelected
    ? customers.find(c => c.id === selectedCustomerId) ?? null
    : null;

  return (
    <div>
      <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
        Pelanggan
      </label>

      {/* Search input (locked when selected) */}
      <div className="relative mb-2">
        {isSelected
          ? <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
        <input
          value={isSelected ? `${selected?.name} (dipilih)` : search}
          onChange={e => !isSelected && setSearch(e.target.value)}
          readOnly={isSelected}
          placeholder="Cari nama / HP / perusahaan…"
          className={`w-full pl-10 pr-3 py-2 border rounded-xl text-[13px] outline-none ${
            isSelected
              ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
              : 'bg-slate-50 border-slate-200 focus:border-[#2d8a4e] focus:ring-1 focus:ring-[#2d8a4e]'
          }`}
        />
      </div>

      {/* Search dropdown */}
      {filtered.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow mb-2 overflow-hidden">
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onSelectExisting(c); setSearch(''); }}
              className="w-full text-left px-3 py-2 hover:bg-emerald-50 border-b border-slate-100 last:border-b-0 flex justify-between items-center text-[13px]"
            >
              <div>
                <div className="font-extrabold">{c.name}</div>
                <div className="text-[11px] text-slate-400">
                  {c.wa_number ?? '—'} · {c.company ?? '—'} · {c.order_count ?? 0} pesanan
                </div>
              </div>
              <span className="text-[10px] text-green-600 font-extrabold">PILIH</span>
            </button>
          ))}
        </div>
      )}

      {/* Selected customer chip */}
      {isSelected && selected && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-xl px-3 py-2.5 flex justify-between items-center mb-2">
          <div>
            <div className="font-extrabold text-emerald-700 text-[13px]">{selected.name}</div>
            <div className="text-[11px] text-emerald-700 opacity-75">
              📞 {selected.wa_number ?? '—'} · 🏢 {selected.company ?? '—'}
            </div>
            <div className="text-[11px] text-emerald-700 mt-0.5 font-semibold">
              🛒 {selected.order_count ?? 0} pesanan · 💰 {formatRp(selected.total_spent ?? 0)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClearSelection}
            className="text-emerald-700 text-[11px] font-extrabold bg-white px-3 py-1.5 rounded-lg border border-emerald-300 hover:bg-emerald-100 flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Ganti
          </button>
        </div>
      )}

      {/* New customer block (disabled when selected) */}
      <div className={`mt-2 rounded-xl p-3 ${
        isSelected
          ? 'bg-slate-50 border border-dashed border-slate-200 opacity-60 pointer-events-none'
          : 'bg-yellow-50 border border-dashed border-yellow-300'
      }`}>
        <label className={`text-[11px] font-extrabold uppercase tracking-widest block mb-2 ${
          isSelected ? 'text-slate-400' : 'text-amber-700'
        }`}>
          + Daftar Pelanggan Baru
        </label>
        <input
          value={customerName}
          onChange={e => onNameChange(e.target.value)}
          placeholder="Nama lengkap *"
          disabled={isSelected}
          className="w-full mb-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] disabled:bg-slate-100 disabled:text-slate-400"
        />
        <div className="grid grid-cols-[1.4fr_1fr] gap-2">
          <input
            value={customerPhone}
            onChange={e => onPhoneChange(e.target.value)}
            placeholder="Nomor HP / WA *"
            disabled={isSelected}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] disabled:bg-slate-100 disabled:text-slate-400"
          />
          <input
            value={customerCompany}
            onChange={e => onCompanyChange(e.target.value)}
            placeholder="Nama perusahaan"
            disabled={isSelected}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[13px] disabled:bg-slate-100 disabled:text-slate-400"
          />
        </div>
        <p className="text-[11px] mt-1 font-semibold text-slate-500">
          {isSelected
            ? '🔒 Nonaktif — sudah pilih pelanggan terdaftar. Klik ✕ Ganti untuk reset.'
            : '* wajib · Nama perusahaan opsional'}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build & verify**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/CustomerPanel.tsx
git commit -m "feat(penjualan): add CustomerPanel with search + lock + new-customer block"
```

---

### Task 6.2: Mount `CustomerPanel` in screen

**Files:**
- Modify: `src/components/PenjualanBaruScreen.tsx`

- [ ] **Step 1: Add the right-column container with CustomerPanel**

Add import:

```tsx
import CustomerPanel from './penjualan/CustomerPanel';
```

Replace the `[Customer + Payment panels coming next]` placeholder with:

```tsx
<div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
  <CustomerPanel
    customers={customers}
    selectedCustomerId={selectedCustomerId}
    customerName={customerName}
    customerPhone={customerPhone}
    customerCompany={customerCompany}
    onSelectExisting={(c) => {
      setSelectedCustomerId(c.id);
      setCustomerName(c.name);
      setCustomerPhone(c.wa_number ?? '');
      setCustomerCompany(c.company ?? '');
    }}
    onClearSelection={() => {
      setSelectedCustomerId(null);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerCompany('');
    }}
    onNameChange={setCustomerName}
    onPhoneChange={setCustomerPhone}
    onCompanyChange={setCustomerCompany}
  />
  <div className="text-sm text-slate-400">[Payment panel coming next]</div>
</div>
```

- [ ] **Step 2: Build & verify**

```bash
npm run build
```
Manual: search a customer, see dropdown, click → chip appears + form locked; ✕ Ganti → empty state.

- [ ] **Step 3: Commit**

```bash
git add src/components/PenjualanBaruScreen.tsx
git commit -m "feat(penjualan): wire CustomerPanel into screen"
```

---

## PHASE 7 — Payment panel

### Task 7.1: `PaymentMethodSelector` (Cash/Transfer/EDC + sub-type)

**Files:**
- Create: `src/components/penjualan/PaymentMethodSelector.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from 'react';
import { KasirPaymentMethod, KasirPaymentSubtype } from '../../types';

const METHODS: { key: KasirPaymentMethod; label: string; ico: string }[] = [
  { key: 'cash',     label: 'Cash',     ico: '💵' },
  { key: 'transfer', label: 'Transfer', ico: '🏦' },
  { key: 'edc',      label: 'EDC',      ico: '💳' },
];

export interface PaymentMethodSelectorProps {
  method: KasirPaymentMethod;
  subtype: KasirPaymentSubtype;
  onMethodChange: (m: KasirPaymentMethod) => void;
  onSubtypeChange: (s: KasirPaymentSubtype) => void;
}

export default function PaymentMethodSelector({ method, subtype, onMethodChange, onSubtypeChange }: PaymentMethodSelectorProps) {
  return (
    <div>
      <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
        Metode Pembayaran
      </label>
      <div className="grid grid-cols-3 gap-2">
        {METHODS.map(m => (
          <button
            key={m.key}
            type="button"
            onClick={() => {
              onMethodChange(m.key);
              if (m.key !== 'edc') onSubtypeChange(null);
              else if (subtype === null) onSubtypeChange('debit');
            }}
            className={`border rounded-xl py-3 px-2 text-[12px] font-bold flex flex-col items-center gap-1 ${
              method === m.key
                ? 'bg-[#012749] text-white border-[#012749]'
                : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span className="text-base">{m.ico}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      {method === 'edc' && (
        <div className="flex gap-2 mt-2">
          {(['debit','qris'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => onSubtypeChange(s)}
              className={`px-3 py-1.5 text-[11px] font-bold rounded-full border ${
                subtype === s
                  ? 'bg-amber-400 text-amber-900 border-amber-400'
                  : 'bg-white text-slate-500 border-slate-300'
              }`}
            >
              {s === 'debit' ? 'Debit' : 'QRIS'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build & verify**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/PaymentMethodSelector.tsx
git commit -m "feat(penjualan): add PaymentMethodSelector with EDC sub-type"
```

---

### Task 7.2: `PaymentPanel` (Full/DP toggle, ongkir, notes, totals, actions)

**Files:**
- Create: `src/components/penjualan/PaymentPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
import React from 'react';
import { KasirPaymentMethod, KasirPaymentSubtype, KasirPaymentType, KasirDpInputType } from '../../types';
import PaymentMethodSelector from './PaymentMethodSelector';

function formatRp(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(n);
}

export interface PaymentPanelProps {
  // payment method
  method: KasirPaymentMethod;
  subtype: KasirPaymentSubtype;
  onMethodChange: (m: KasirPaymentMethod) => void;
  onSubtypeChange: (s: KasirPaymentSubtype) => void;

  // payment type
  paymentType: KasirPaymentType;
  onPaymentTypeChange: (t: KasirPaymentType) => void;
  dpAmount: number;
  dpInputType: KasirDpInputType;
  onDpAmountChange: (n: number) => void;
  onDpInputTypeChange: (t: KasirDpInputType) => void;

  // ongkir
  ongkirOn: boolean;
  ongkirAmount: number;
  onOngkirToggle: (on: boolean) => void;
  onOngkirAmountChange: (n: number) => void;

  // notes
  notes: string;
  onNotesChange: (v: string) => void;

  // computed totals
  subtotal: number;
  totalInvoice: number;
  sisaPelunasan: number;

  // actions
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export default function PaymentPanel(props: PaymentPanelProps) {
  const {
    method, subtype, onMethodChange, onSubtypeChange,
    paymentType, onPaymentTypeChange, dpAmount, dpInputType,
    onDpAmountChange, onDpInputTypeChange,
    ongkirOn, ongkirAmount, onOngkirToggle, onOngkirAmountChange,
    notes, onNotesChange,
    subtotal, totalInvoice, sisaPelunasan,
    saving, onSave, onCancel,
  } = props;

  return (
    <div className="space-y-4">
      <PaymentMethodSelector
        method={method}
        subtype={subtype}
        onMethodChange={onMethodChange}
        onSubtypeChange={onSubtypeChange}
      />

      {/* Payment type toggle */}
      <div>
        <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
          Tipe Pembayaran
        </label>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {(['FULL','DP'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => onPaymentTypeChange(t)}
              className={`flex-1 text-center py-2 px-3 rounded-lg text-[12px] font-bold ${
                paymentType === t ? 'bg-white text-[#012749] shadow-sm' : 'text-slate-500'
              }`}
            >
              {t === 'FULL' ? 'Full Payment' : 'DP / Tanda Jadi'}
            </button>
          ))}
        </div>
        {paymentType === 'DP' && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input
              type="number"
              value={dpAmount || ''}
              onChange={e => onDpAmountChange(Number(e.target.value || 0))}
              placeholder="Jumlah DP"
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[13px]"
            />
            <select
              value={dpInputType ?? 'AMOUNT'}
              onChange={e => onDpInputTypeChange(e.target.value as KasirDpInputType)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[13px]"
            >
              <option value="AMOUNT">Nominal (Rp)</option>
              <option value="PERCENT">Persen (%)</option>
            </select>
          </div>
        )}
      </div>

      {/* Ongkir */}
      <div>
        <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
          Tambahan
        </label>
        <button
          type="button"
          onClick={() => onOngkirToggle(!ongkirOn)}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[13px] border ${
            ongkirOn ? 'bg-orange-50 border-orange-500' : 'bg-slate-50 border-dashed border-slate-300'
          }`}
        >
          <span className={`font-extrabold flex items-center gap-1.5 ${ongkirOn ? 'text-orange-700' : 'text-slate-700'}`}>
            🚚 Biaya Ongkir <span className="text-[11px] text-slate-400 font-semibold">(opsional)</span>
          </span>
          <span className={`w-8 h-4 rounded-full relative ${ongkirOn ? 'bg-orange-500' : 'bg-slate-300'}`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${ongkirOn ? 'left-4' : 'left-0.5'}`}></span>
          </span>
        </button>
        {ongkirOn && (
          <input
            type="number"
            value={ongkirAmount || ''}
            onChange={e => onOngkirAmountChange(Number(e.target.value || 0))}
            placeholder="Rp 0"
            className="mt-2 w-full bg-white border border-orange-500 rounded-lg px-3 py-2 text-[13px] font-bold text-orange-700"
          />
        )}
      </div>

      {/* Notes */}
      <div>
        <div className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5">
          <div className="flex justify-between items-center mb-1">
            <span className="font-extrabold text-sky-700 text-[13px] flex items-center gap-1">📝 Catatan</span>
            <span className="text-[10px] text-sky-700 font-extrabold uppercase tracking-widest">opsional · tampil di invoice</span>
          </div>
          <textarea
            value={notes}
            onChange={e => onNotesChange(e.target.value)}
            placeholder="Mis. Garansi 1 bulan. Antar ke alamat..."
            className="w-full min-h-[56px] bg-white border border-sky-200 rounded-lg px-3 py-2 text-[13px] text-sky-900 resize-y outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* Totals */}
      <div className="bg-slate-50 rounded-xl px-3 py-3">
        <div className="flex justify-between py-1 text-[13px] text-slate-600">
          <span>Subtotal barang</span><span>{formatRp(subtotal)}</span>
        </div>
        {ongkirOn && ongkirAmount > 0 && (
          <div className="flex justify-between py-1 text-[13px] text-orange-700 font-bold">
            <span>↳ Biaya ongkir</span><span>{formatRp(ongkirAmount)}</span>
          </div>
        )}
        {paymentType === 'DP' && (
          <>
            <div className="flex justify-between py-1 text-[13px] text-emerald-700 font-bold">
              <span>↳ DP diterima</span><span>{formatRp(dpAmount)}</span>
            </div>
            <div className="flex justify-between py-1 text-[13px] text-amber-700 font-extrabold">
              <span>↳ Sisa pelunasan</span><span>{formatRp(sisaPelunasan)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between py-2 mt-1 border-t-2 border-[#012749] text-[15px] font-extrabold text-[#012749]">
          <span>Total Invoice</span><span>{formatRp(totalInvoice)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className={`w-full py-3.5 rounded-xl text-white text-[14px] font-extrabold disabled:opacity-60 ${
            paymentType === 'DP' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-[#2d8a4e] hover:bg-green-700'
          }`}
        >
          {saving ? 'Menyimpan...' : `💾 Simpan & Cetak Invoice ${paymentType === 'DP' ? 'DP' : 'Lunas'}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full py-3.5 rounded-xl bg-white border border-slate-300 text-slate-600 text-[13px] font-bold hover:bg-slate-50"
        >
          Batal
        </button>
        <p className="text-[11px] text-slate-500 text-center">🖨️ Invoice otomatis dikirim ke printer dotmatrix</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build & verify**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/PaymentPanel.tsx
git commit -m "feat(penjualan): add PaymentPanel (DP toggle, ongkir, notes, totals, actions)"
```

---

### Task 7.3: Mount `PaymentPanel` + compute totals + save handler

**Files:**
- Modify: `src/components/PenjualanBaruScreen.tsx`

- [ ] **Step 1: Add save handler**

Add inside the component (after other handlers):

```tsx
async function handleSave() {
  // Validation
  if (cart.length === 0) { showToast('Tambahkan minimal 1 item.', 'warning'); return; }
  if (!customerName.trim()) { showToast('Nama pelanggan wajib diisi.', 'warning'); return; }
  if (!customerPhone.trim()) { showToast('Nomor HP wajib diisi.', 'warning'); return; }
  if (channel === 'tokopedia' && !tokpedOrderNo.trim()) {
    showToast('Nomor Pesanan Tokopedia wajib diisi.', 'warning'); return;
  }
  if (paymentMethod === 'edc' && !paymentSubtype) {
    showToast('Pilih sub-tipe EDC (Debit / QRIS).', 'warning'); return;
  }
  // Compute effective DP amount
  const effectiveDp = paymentType === 'DP'
    ? (dpInputType === 'PERCENT' ? Math.round(totalInvoice * dpAmount / 100) : dpAmount)
    : 0;
  if (paymentType === 'DP' && (effectiveDp <= 0 || effectiveDp >= totalInvoice)) {
    showToast('Jumlah DP harus > 0 dan < Total Invoice.', 'warning'); return;
  }

  setSaving(true);
  try {
    const invoiceNumber = await kasirService.nextInvoiceNumber(channel, new Date().toISOString().slice(0, 10));

    const newTx = {
      date: new Date().toISOString().slice(0, 10),
      channel,
      items: cart.map(({ _key, ...rest }) => rest),
      subtotal,
      hpp_total: cart.reduce((s, i) => s + i.hpp_subtotal, 0),
      payment_method: paymentMethod,
      payment_subtype: paymentSubtype,
      payment_type: paymentType,
      dp_amount: effectiveDp,
      dp_input_type: paymentType === 'DP' ? dpInputType : undefined,
      ongkir_amount: ongkirOn ? ongkirAmount : 0,
      notes: notes.trim() || undefined,
      total_amount: totalInvoice,
      tokped_order_no: channel === 'tokopedia' ? tokpedOrderNo : undefined,
      wa_phone: channel === 'whatsapp' ? waPhone : undefined,
      wa_chat_url: channel === 'whatsapp' ? waChatUrl : undefined,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_company: customerCompany || undefined,
      invoice_number: invoiceNumber,
    };

    const saved = await kasirService.insertSaleTransaction(newTx);

    // Auto-create new customer if not selected
    if (!selectedCustomerId && customerName.trim() && customerPhone.trim()) {
      try { await customersService.createCustomer(customerPhone, customerName, customerCompany); } catch {}
    }

    // Decrement stock per-row warehouse
    for (const item of cart) {
      try { await stockService.decrementStock(item.sku, item.qty, item.warehouse); }
      catch { showToast(`Gagal kurangi stok ${item.name}.`, 'warning'); }
    }

    onSaved(saved.id);
  } catch (err: any) {
    showToast(`Gagal menyimpan: ${err.message ?? 'unknown'}`, 'warning');
  } finally {
    setSaving(false);
  }
}
```

- [ ] **Step 2: Replace the `[Payment panel coming next]` placeholder**

Replace it with:

```tsx
<PaymentPanel
  method={paymentMethod}
  subtype={paymentSubtype}
  onMethodChange={setPaymentMethod}
  onSubtypeChange={setPaymentSubtype}
  paymentType={paymentType}
  onPaymentTypeChange={setPaymentType}
  dpAmount={dpAmount}
  dpInputType={dpInputType}
  onDpAmountChange={setDpAmount}
  onDpInputTypeChange={setDpInputType}
  ongkirOn={ongkirOn}
  ongkirAmount={ongkirAmount}
  onOngkirToggle={setOngkirOn}
  onOngkirAmountChange={setOngkirAmount}
  notes={notes}
  onNotesChange={setNotes}
  subtotal={subtotal}
  totalInvoice={totalInvoice}
  sisaPelunasan={sisaPelunasan}
  saving={saving}
  onSave={handleSave}
  onCancel={onBack}
/>
```

Add import:

```tsx
import PaymentPanel from './penjualan/PaymentPanel';
```

- [ ] **Step 3: Build & verify**

```bash
npm run build
```
Manual end-to-end (Walk-in, Full Payment, Cash): add item, fill new customer, click Save → toast success → list refreshes. Check Supabase row has `payment_type='FULL'`, `status='PAID'`, items contain `warehouse` field. Stock decremented from correct warehouse.

- [ ] **Step 4: Commit**

```bash
git add src/components/PenjualanBaruScreen.tsx
git commit -m "feat(penjualan): wire PaymentPanel + save flow with per-warehouse stock decrement"
```

---

## PHASE 8 — PDF Invoice (dotmatrix)

### Task 8.1: `SalesInvoicePDF` component shell + page CSS

**Files:**
- Create: `src/components/penjualan/SalesInvoicePDF.tsx`

- [ ] **Step 1: Create the component skeleton**

```tsx
import React, { useEffect, useState } from 'react';
import { X, Printer } from 'lucide-react';
import { KasirTransaction, DbCompanySettings } from '../../types';
import { companySettingsService, bankConfigService, isSupabaseConfigured } from '../../lib/supabaseClient';
import type { DbBankConfig } from '../../types';

function formatRp(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(n);
}
function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} · ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;
}

export type InvoiceVariant = 'dp' | 'lunas';

export interface SalesInvoicePDFProps {
  transaction: KasirTransaction;
  variant: InvoiceVariant;
  autoPrint?: boolean;
  onClose: () => void;
}

export default function SalesInvoicePDF({ transaction, variant, autoPrint, onClose }: SalesInvoicePDFProps) {
  const [company, setCompany] = useState<DbCompanySettings | null>(null);
  const [bank, setBank] = useState<DbBankConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    Promise.all([companySettingsService.fetch(), bankConfigService.fetch()])
      .then(([co, bk]) => { setCompany(co); setBank(bk); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (autoPrint && !loading) {
      const timer = setTimeout(() => window.print(), 300);
      return () => clearTimeout(timer);
    }
  }, [autoPrint, loading]);

  const channelLabel = {
    walkin: 'Walk-in', tokopedia: 'Tokopedia', grosir: 'Grosir', whatsapp: 'WhatsApp Manual',
  }[transaction.channel ?? 'walkin'] ?? '';

  const paymentLabel = (() => {
    if (transaction.payment_method === 'edc') {
      return `EDC ${transaction.payment_subtype === 'qris' ? 'QRIS' : 'Debit'}`;
    }
    if (transaction.payment_method === 'qris') return 'QRIS';
    if (transaction.payment_method === 'transfer') return 'Transfer';
    return 'Cash';
  })();

  return (
    <>
      <style>{`
        @media print {
          @page { size: 9.5in 11in; margin: 0.5in 0.5in; }
          body * { visibility: hidden; }
          #sales-invoice-root, #sales-invoice-root * { visibility: visible; }
          #sales-invoice-root { position: fixed; top: 0; left: 0; width: 100%; background: white; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>

      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          id="sales-invoice-root"
          className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-auto"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-2 bg-[#012749] text-white print:hidden">
            <div className="flex items-center gap-2 font-bold text-[13px]">
              Invoice {transaction.invoice_number}
            </div>
            <div className="flex gap-2">
              <button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1 bg-[#2d8a4e] rounded text-[12px] font-bold">
                <Printer className="w-3.5 h-3.5" /> Cetak Ulang
              </button>
              <button onClick={onClose}><X className="w-4 h-4" /></button>
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-400">Memuat...</div>
          ) : (
            <InvoiceBody transaction={transaction} variant={variant} company={company} bank={bank} channelLabel={channelLabel} paymentLabel={paymentLabel} formatRp={formatRp} formatDateTime={formatDateTime} />
          )}
        </div>
      </div>
    </>
  );
}

// Body extracted to its own function for clarity (still in the same file)
function InvoiceBody({
  transaction: t, variant, company, bank, channelLabel, paymentLabel, formatRp, formatDateTime,
}: any) {
  const subtotal = t.subtotal;
  const ongkir = t.ongkir_amount ?? 0;
  const total = t.total_amount ?? subtotal + ongkir;
  const dp = t.dp_amount ?? 0;
  const sisa = variant === 'dp' ? total - dp : 0;
  const sudahDibayar = variant === 'lunas' ? total : dp;

  return (
    <div className="bg-white p-8 font-mono text-[12px] leading-[1.45] text-slate-800 relative">
      {/* Stamp */}
      <div className={`absolute right-8 top-32 rotate-[-8deg] border-[3px] px-3 py-1.5 font-extrabold text-[18px] tracking-widest font-sans opacity-85 ${
        variant === 'lunas' ? 'border-emerald-700 text-emerald-700' : 'border-amber-700 text-amber-700'
      }`}>
        {variant === 'lunas' ? 'LUNAS' : 'DP'}
      </div>

      {/* Header */}
      <div className="grid grid-cols-[auto_1fr] gap-4 pb-3 border-b-2 border-slate-900 mb-3">
        <div className="w-16 h-16 bg-slate-900 text-white flex items-center justify-center font-sans font-extrabold text-[10px] text-center">
          {company?.logo_url
            ? <img src={company.logo_url} alt="Logo" className="w-full h-full object-contain" />
            : (company?.company_name ?? 'GARINDO').split(' ').slice(0,3).join(' ')}
        </div>
        <div>
          <div className="font-extrabold font-sans text-[15px]">{company?.company_name ?? 'GARINDO JAYA PANEL'}</div>
          <div className="text-[11px] mt-0.5">{company?.address ?? '—'}</div>
          <div className="text-[11px]">{company?.phone && `Telp ${company.phone}`} {company?.email && `· ${company.email}`}</div>
          {company?.npwp && <div className="text-[11px]">NPWP {company.npwp}</div>}
        </div>
      </div>

      {/* Title */}
      <div className="grid grid-cols-[1fr_auto] gap-3 mb-3">
        <div>
          <div className="font-sans font-extrabold text-[17px] tracking-wider">SALES INVOICE</div>
          <div className={`text-[11px] font-bold uppercase tracking-wide mt-0.5 ${variant === 'lunas' ? 'text-emerald-700' : 'text-amber-700'}`}>
            {variant === 'lunas' ? 'Pelunasan / Lunas' : 'Tanda Terima Uang Muka (DP)'}
          </div>
        </div>
        <div className="text-right text-[11px]">
          <div className="font-extrabold text-[13px]">{t.invoice_number}</div>
          <div>{formatDateTime(t.created_at)}</div>
          <div>Channel: {channelLabel.toUpperCase()}</div>
        </div>
      </div>

      {/* Bill-to */}
      <div className="grid grid-cols-2 gap-4 py-2 border-b border-dashed border-slate-400 mb-2 text-[11px]">
        <div>
          <div className="font-extrabold text-[10px] uppercase tracking-widest text-slate-600 mb-1">Pelanggan</div>
          <div><strong>{t.customer_name ?? '—'}</strong></div>
          {t.customer_company && <div>{t.customer_company}</div>}
          <div>{t.customer_phone ?? '—'}</div>
        </div>
        <div>
          <div className="font-extrabold text-[10px] uppercase tracking-widest text-slate-600 mb-1">Metode Bayar</div>
          <div><strong>{paymentLabel}</strong></div>
        </div>
      </div>

      {/* Items table */}
      <table className="w-full text-[11px] my-2 border-collapse">
        <thead>
          <tr>
            <th className="border-t border-b border-slate-900 px-1 py-1 text-center font-extrabold text-[10px] uppercase tracking-wide">No</th>
            <th className="border-t border-b border-slate-900 px-1 py-1 text-left font-extrabold text-[10px] uppercase tracking-wide">Deskripsi Barang</th>
            <th className="border-t border-b border-slate-900 px-1 py-1 text-center font-extrabold text-[10px] uppercase tracking-wide">Qty</th>
            <th className="border-t border-b border-slate-900 px-1 py-1 text-right font-extrabold text-[10px] uppercase tracking-wide">Harga</th>
            <th className="border-t border-b border-slate-900 px-1 py-1 text-right font-extrabold text-[10px] uppercase tracking-wide">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {(t.items as any[]).map((item, idx) => (
            <tr key={idx} className="align-top">
              <td className="px-1 py-1 text-center border-b border-dotted border-slate-300">{idx + 1}</td>
              <td className="px-1 py-1 border-b border-dotted border-slate-300">
                <div className="font-bold">{item.name}</div>
                <div className="text-[10px] text-slate-500">{item.sku}</div>
              </td>
              <td className="px-1 py-1 text-center border-b border-dotted border-slate-300">{item.qty}</td>
              <td className="px-1 py-1 text-right border-b border-dotted border-slate-300">{formatRp(item.unit_price).replace('Rp', '').trim()}</td>
              <td className="px-1 py-1 text-right border-b border-dotted border-slate-300">{formatRp(item.subtotal).replace('Rp', '').trim()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Notes */}
      {t.notes && (
        <div className="border border-dashed border-slate-400 px-2 py-1.5 my-2 text-[11px]">
          <div className="font-extrabold text-[10px] uppercase tracking-widest mb-1">📝 Catatan</div>
          <div className="whitespace-pre-wrap">{t.notes}</div>
        </div>
      )}

      {/* Totals */}
      <div className="ml-auto w-3/5 text-[12px] mt-2">
        <div className="flex justify-between py-0.5 border-t border-slate-900 mt-1 pt-1"><span>Subtotal</span><span>{formatRp(subtotal)}</span></div>
        {ongkir > 0 && <div className="flex justify-between py-0.5"><span>Biaya Ongkir</span><span>{formatRp(ongkir)}</span></div>}
        <div className="flex justify-between py-1 border-t border-slate-900 border-b-[3px] border-double border-b-slate-900 font-extrabold text-[13px]">
          <span>TOTAL TAGIHAN</span><span>{formatRp(total)}</span>
        </div>
        <div className="flex justify-between py-0.5 font-bold"><span>{variant === 'lunas' ? 'Sudah Dibayar' : 'Uang Muka (DP) Diterima'}</span><span>{formatRp(sudahDibayar)}</span></div>
        <div className={`flex justify-between py-0.5 font-extrabold ${variant === 'lunas' ? '' : ''}`}>
          <span>{variant === 'lunas' ? 'SISA' : 'SISA PELUNASAN'}</span><span>{formatRp(sisa)}</span>
        </div>
      </div>

      {/* Payment block */}
      <div className="mt-4 pt-2 border-t border-dashed border-slate-400 text-[11px]">
        <div className="font-extrabold text-[10px] uppercase tracking-widest mb-1">Rekening Pembayaran</div>
        <div>
          <strong>{bank?.bank_name ?? '—'}</strong> · {bank?.account_number ?? '—'} a/n <strong>{bank?.account_name ?? '—'}</strong>
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          {variant === 'lunas' ? 'Terima kasih atas pembayaran Anda.' : 'Sisa pelunasan ditransfer sebelum pengambilan/pengiriman barang.'}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="mt-3 border border-slate-900 px-2 py-1.5 text-center text-[10px] font-extrabold tracking-wide">
        ⚠ BARANG YANG SUDAH DIBELI TIDAK DAPAT DIKEMBALIKAN
      </div>

      {/* Footer signatures */}
      <div className="grid grid-cols-2 gap-4 mt-4 pt-3 border-t border-dashed border-slate-400 text-[11px]">
        <div className="text-center"><div className="border-b border-slate-900 h-8 mx-4 mb-1"></div><div className="font-bold text-[10px]">Penerima Barang</div></div>
        <div className="text-center"><div className="border-b border-slate-900 h-8 mx-4 mb-1"></div><div className="font-bold text-[10px]">Hormat Kami</div></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build & verify**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/SalesInvoicePDF.tsx
git commit -m "feat(penjualan): add SalesInvoicePDF with DP/Lunas variants and dotmatrix @page CSS"
```

---

### Task 8.2: Auto-open invoice after save

**Files:**
- Modify: `src/components/PenjualanBaruScreen.tsx`

- [ ] **Step 1: Add state for showing the saved transaction's invoice**

Inside component:

```tsx
const [savedTx, setSavedTx] = useState<KasirTransaction | null>(null);
```

Add import:

```tsx
import SalesInvoicePDF from './penjualan/SalesInvoicePDF';
import { KasirTransaction } from '../types';
```

- [ ] **Step 2: Update `handleSave` to capture the saved row + render the modal**

In `handleSave`, replace `onSaved(saved.id);` with:

```tsx
setSavedTx(saved);
```

At the bottom of the JSX (just before the closing root `</div>`), add:

```tsx
{savedTx && (
  <SalesInvoicePDF
    transaction={savedTx}
    variant={savedTx.payment_type === 'DP' ? 'dp' : 'lunas'}
    autoPrint
    onClose={() => { setSavedTx(null); onSaved(savedTx.id); }}
  />
)}
```

- [ ] **Step 3: Build & verify**

```bash
npm run build
```
Manual: complete a save → modal opens → browser print dialog auto-triggers → close modal → returns to Kasir.

- [ ] **Step 4: Commit**

```bash
git add src/components/PenjualanBaruScreen.tsx
git commit -m "feat(penjualan): auto-open SalesInvoicePDF after save + auto-print"
```

---

## PHASE 9 — Pelunasan flow

### Task 9.1: `MarkLunasModal` component

**Files:**
- Create: `src/components/penjualan/MarkLunasModal.tsx`

- [ ] **Step 1: Create the modal**

```tsx
import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { KasirTransaction, KasirPaymentMethod, KasirPaymentSubtype } from '../../types';
import { kasirService } from '../../lib/supabaseClient';
import PaymentMethodSelector from './PaymentMethodSelector';

function formatRp(n: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(n);
}

export interface MarkLunasModalProps {
  transaction: KasirTransaction;
  onClose: () => void;
  onMarked: (updated: KasirTransaction) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function MarkLunasModal({ transaction, onClose, onMarked, showToast }: MarkLunasModalProps) {
  const [method, setMethod] = useState<KasirPaymentMethod>('cash');
  const [subtype, setSubtype] = useState<KasirPaymentSubtype>(null);
  const [ongkirAdjust, setOngkirAdjust] = useState(0);
  const [saving, setSaving] = useState(false);

  const baseTotal = transaction.total_amount ?? transaction.subtotal;
  const newTotal = baseTotal + ongkirAdjust;
  const sisa = newTotal - (transaction.dp_amount ?? 0);

  async function handleConfirm() {
    if (method === 'edc' && !subtype) {
      showToast('Pilih sub-tipe EDC.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const updated = await kasirService.markLunas(transaction.id, {
        method,
        subtype: subtype ?? undefined,
        ongkirAdjust: ongkirAdjust !== 0 ? ongkirAdjust : undefined,
      });
      onMarked(updated);
    } catch (err: any) {
      showToast(`Gagal tandai lunas: ${err.message ?? 'unknown'}`, 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 bg-amber-500 text-white flex justify-between items-center">
          <div className="font-extrabold text-[14px]">💰 Tandai Lunas — {transaction.invoice_number}</div>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Summary */}
          <div className="bg-slate-50 rounded-xl p-3 text-[12px]">
            <div className="flex justify-between"><span>Pelanggan</span><strong>{transaction.customer_name}</strong></div>
            <div className="flex justify-between"><span>Total Tagihan</span><span>{formatRp(baseTotal)}</span></div>
            <div className="flex justify-between"><span>DP Diterima</span><span>{formatRp(transaction.dp_amount ?? 0)}</span></div>
            <div className="flex justify-between font-extrabold text-amber-700 text-[14px] mt-1 pt-1 border-t border-slate-300">
              <span>Sisa Pelunasan</span><span>{formatRp(sisa)}</span>
            </div>
          </div>

          <PaymentMethodSelector
            method={method}
            subtype={subtype}
            onMethodChange={setMethod}
            onSubtypeChange={setSubtype}
          />

          <div>
            <label className="text-[11px] font-extrabold text-slate-500 uppercase tracking-widest pl-1 block mb-2">
              Penyesuaian Ongkir (opsional)
            </label>
            <input
              type="number"
              value={ongkirAdjust || ''}
              onChange={e => setOngkirAdjust(Number(e.target.value || 0))}
              placeholder="0"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[13px]"
            />
            <p className="text-[11px] text-slate-400 mt-1">Tambahan biaya kirim saat pelunasan (boleh negatif untuk koreksi).</p>
          </div>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-[#2d8a4e] text-white font-extrabold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Check className="w-4 h-4" />
            {saving ? 'Memproses...' : 'Konfirmasi & Cetak Invoice Lunas'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build & verify**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/penjualan/MarkLunasModal.tsx
git commit -m "feat(penjualan): add MarkLunasModal for DP→Lunas pelunasan"
```

---

### Task 9.2: KasirScreen — "Belum Lunas" badge + "Tandai Lunas" action

**Files:**
- Modify: `src/components/KasirScreen.tsx`

- [ ] **Step 1: Add badge in tx row + tandai-lunas state**

Inside `KasirScreen`, add state:

```tsx
const [markLunasTx, setMarkLunasTx] = useState<KasirTransaction | null>(null);
const [lunasInvoice, setLunasInvoice] = useState<KasirTransaction | null>(null);
```

Add imports:

```tsx
import MarkLunasModal from './penjualan/MarkLunasModal';
import SalesInvoicePDF from './penjualan/SalesInvoicePDF';
```

Find where each `KasirTransaction` is rendered in the today's list (search for `transaction` or `t.invoice_number`). Next to the existing render, add badge + button when `t.status === 'AWAITING_LUNAS'`:

```tsx
{t.status === 'AWAITING_LUNAS' && (
  <div className="flex items-center gap-2 mt-1">
    <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-700 border border-amber-300">
      💰 Belum Lunas {formatRp((t.total_amount ?? t.subtotal) - (t.dp_amount ?? 0))}
    </span>
    <button
      type="button"
      onClick={() => setMarkLunasTx(t)}
      className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-500 text-white hover:bg-amber-600"
    >
      Tandai Lunas
    </button>
  </div>
)}
```

- [ ] **Step 2: Render the modal + invoice**

At the bottom of the JSX (before final `</div>`):

```tsx
{markLunasTx && (
  <MarkLunasModal
    transaction={markLunasTx}
    showToast={showToast}
    onClose={() => setMarkLunasTx(null)}
    onMarked={(updated) => {
      setMarkLunasTx(null);
      setLunasInvoice(updated);
      // Refresh tx list
      loadData?.();
    }}
  />
)}
{lunasInvoice && (
  <SalesInvoicePDF
    transaction={lunasInvoice}
    variant="lunas"
    autoPrint
    onClose={() => setLunasInvoice(null)}
  />
)}
```

(Adjust `loadData` call to whatever the screen's reload function is — check existing code; likely a function inside the component.)

- [ ] **Step 3: Build & verify**

```bash
npm run build
```
Manual: create a DP transaction → see "Belum Lunas" badge → click "Tandai Lunas" → modal opens → confirm → invoice Lunas auto-prints → list shows status=COMPLETED (badge gone).

- [ ] **Step 4: Commit**

```bash
git add src/components/KasirScreen.tsx
git commit -m "feat(kasir): show Belum Lunas badge + Tandai Lunas action on DP transactions"
```

---

### Task 9.3: KasirScreen — "Catat Penjualan" quick-action button

**Files:**
- Modify: `src/components/KasirScreen.tsx`

- [ ] **Step 1: Add a prominent button that navigates to PenjualanBaruScreen**

In KasirScreen's top action area (search for the existing "Tambah Penjualan" or similar — the modal trigger), add a NEW prominent button that calls a parent navigation callback. KasirScreen needs a new prop:

```tsx
interface KasirScreenProps {
  currentUser: { name: string; role: string; permissions: PermissionSet } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onOpenPenjualanBaru?: () => void; // NEW
}
```

In the JSX header, add:

```tsx
<button
  type="button"
  onClick={onOpenPenjualanBaru}
  className="inline-flex items-center gap-2 px-4 py-2 bg-[#2d8a4e] text-white font-extrabold text-[13px] rounded-xl hover:bg-green-700"
>
  📋 Catat Penjualan
</button>
```

- [ ] **Step 2: Wire from `App.tsx`**

In App.tsx `case 'kasir':`, pass the callback:

```tsx
<KasirScreen
  currentUser={currentUser}
  showToast={triggerToast}
  onOpenPenjualanBaru={() => setActivePage('penjualanBaru')}
/>
```

- [ ] **Step 3: Build & verify**

```bash
npm run build
```
Manual: click "Catat Penjualan" in Kasir → routes to new page.

- [ ] **Step 4: Commit**

```bash
git add src/components/KasirScreen.tsx src/App.tsx
git commit -m "feat(kasir): quick-action button opens PenjualanBaruScreen"
```

---

## PHASE 10 — QA & polish

### Task 10.1: End-to-end QA pass

- [ ] **Step 1: Walk-in Full Payment**

1. Sidebar → Catat Penjualan
2. Channel Walk-in
3. Search "MCB" → add 2 items
4. Per-row warehouse selector: 1 Atas, 1 Bawah
5. Search customer "Budi" → if exists, pick; else fill new (name + HP)
6. Payment: Cash
7. Type: Full Payment
8. Save → invoice modal appears → print dialog triggers → close
9. Verify in Supabase: status=PAID, items have warehouse field, stock_atas + stock_bawah decremented correctly

- [ ] **Step 2: Tokopedia DP**

1. Channel Tokopedia → fill order no.
2. Add 1 item
3. Pick existing customer
4. Payment: Transfer
5. Type: DP, nominal 200000
6. Ongkir on, 25000
7. Notes: "test"
8. Save → Invoice DP prints with stamp DP and SISA PELUNASAN row
9. Verify: status=AWAITING_LUNAS, dp_amount=200000, ongkir_amount=25000, total_amount=subtotal+25000

- [ ] **Step 3: Pelunasan flow**

1. Return to Kasir → DP transaction shows "Belum Lunas Rp ..." badge + Tandai Lunas button
2. Click Tandai Lunas → modal shows summary
3. Pick EDC + Debit
4. Confirm
5. Invoice Lunas prints with stamp LUNAS
6. Verify: status=COMPLETED, lunas_at set, lunas_payment_method='edc', lunas_payment_subtype='debit'

- [ ] **Step 4: WhatsApp manual + Grosir**

Repeat steps similar to above for these two channels to ensure no field-conditional bug.

- [ ] **Step 5: Validation edges**

Try saving without items, without customer, Tokped without order no, EDC without sub-type, DP=0, DP>=total — confirm each rejects with toast.

- [ ] **Step 6: Logo upload + render**

Pengaturan → upload PNG → see preview → return to Catat Penjualan → save a transaction → invoice header shows uploaded logo (browser preview) → print dialog shows logo (will dither on actual dotmatrix).

- [ ] **Step 7: Document QA results in progress.md**

Update `progress.md` with a section "Sub-project A QA results" listing pass/fail per scenario.

- [ ] **Step 8: Commit progress note**

```bash
git add progress.md
git commit -m "docs(progress): Sub-project A QA results"
```

---

### Task 10.2: Print stylesheet fine-tune (only if QA reveals issues)

If real dotmatrix print test reveals layout issues (e.g., logo too small/large, content overflow, font too dense):

- [ ] Adjust `@page` margin and font sizes in `SalesInvoicePDF.tsx`
- [ ] Re-test
- [ ] Commit fixes: `style(invoice): tune print layout for Epson dotmatrix`

This task is conditional — skip if QA Step 6 passes cleanly.

---

## Self-review notes

**Spec coverage:**

| Spec section | Task |
|---|---|
| 4 channels (walk-in, tokpedia, grosir, whatsapp) | Task 4.1 + 0.1 (enum) |
| Tokped order no. strip | Task 4.2 |
| WhatsApp strip | Task 4.2 |
| Customer search + lock + new-customer block | Task 6.1, 6.2 |
| Item search w/ per-warehouse pills | Task 5.1 |
| Per-row warehouse selector | Task 5.2 |
| Payment methods (Cash/Transfer/EDC + Debit/QRIS sub-type) | Task 7.1 + 0.1 (enum) |
| Full/DP toggle + nominal/percent | Task 7.2 |
| Ongkir optional toggle | Task 7.2 |
| Notes optional textarea | Task 7.2 |
| Totals computation | Task 7.2 + 7.3 |
| Always print invoice | Task 7.2 (no "save without print" button) + 8.2 (autoPrint) |
| Data model — kasir_transactions extensions | Task 0.1 |
| Data model — items JSON warehouse field | Task 1.1 (KasirItem type) + 7.3 (save handler) |
| Data model — company_settings.logo_url | Task 0.2 |
| PDF Invoice (DP + Lunas variants) | Task 8.1 |
| Logo upload in Pengaturan | Tasks 2.1, 2.2 |
| Pelunasan flow (Tandai Lunas + Modal) | Tasks 9.1, 9.2 + 1.3 (markLunas service) |
| Cancellation | Task 1.3 (cancelTransaction service) — UI integration is light; covered in 9.2 if needed (not in plan body — left for follow-up if user requests cancel UI; spec says manual stock correction is acceptable) |
| Routing + sidebar entry | Tasks 3.2, 3.3, 9.3 |
| Acceptance criteria checks | Task 10.1 |

**No placeholders:** Verified — every code step has complete code; no "TBD" / "TODO" remain.

**Type consistency:** `KasirItem.warehouse` field defined in Task 1.1 is used consistently in 5.2 (CartRows), 7.3 (save handler), 8.1 (invoice — actually invoice ignores it per spec).

**Cancellation UI gap:** Spec says cancellation is light; only `cancelTransaction` service method is added (Task 1.3). If user wants a "Batalkan Pesanan" button in detail view, that's a small follow-up — not blocking acceptance.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-07-sales-recording-overhaul.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for plans with 20+ tasks like this one.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Faster for small plans; slower for big ones because context fills up.

**Which approach?**
