# Kasir & Rekonsiliasi Harian Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated Kasir screen for daily P&L reconciliation across WA orders, walk-in, Tokopedia, grosir, and operational expenses — with role-gated HPP and profit visibility.

**Architecture:** New `kasir_transactions` Supabase table stores manual sales (walk-in/Tokopedia/grosir) and expenses; WA orders auto-sync from existing `orders` table filtered by `PAYMENT_VERIFIED` status. Client merges both sources for the transaction log and computes P&L. `harga_modal` column added to `stocks` for HPP snapshotting at point of sale.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS, Supabase JS client (`@supabase/supabase-js`), Lucide React icons, `window.print()` for A4 invoices.

---

### Task 1: Database — `harga_modal` column on stocks

**Files:**
- Create: `supabase/migrations/20260604000005_stocks_add_harga_modal.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260604000005_stocks_add_harga_modal.sql
ALTER TABLE public.stocks
  ADD COLUMN IF NOT EXISTS harga_modal NUMERIC(15,2);
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the Supabase MCP tool `apply_migration` with the SQL above targeting the active project.

- [ ] **Step 3: Verify column exists**

Run via MCP `execute_sql`:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'stocks' AND column_name = 'harga_modal';
```
Expected: one row, `numeric`, `YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260604000005_stocks_add_harga_modal.sql
git commit -m "feat(db): add harga_modal column to stocks for HPP tracking"
```

---

### Task 2: Database — `kasir_transactions` table

**Files:**
- Create: `supabase/migrations/20260604000006_kasir_transactions.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260604000006_kasir_transactions.sql
DO $$ BEGIN
  CREATE TYPE kasir_channel AS ENUM ('walkin', 'tokopedia', 'grosir');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kasir_payment_method AS ENUM ('cash', 'transfer', 'qris');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kasir_expense_category AS ENUM (
    'Gaji', 'Utilitas', 'Transportasi', 'Pembelian Stok', 'Marketing', 'Lain-lain'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.kasir_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  type             TEXT NOT NULL CHECK (type IN ('income', 'expense')),

  -- Income fields
  channel          kasir_channel,
  items            JSONB NOT NULL DEFAULT '[]',
  subtotal         NUMERIC(15,2) NOT NULL DEFAULT 0,
  hpp_total        NUMERIC(15,2) NOT NULL DEFAULT 0,
  payment_method   kasir_payment_method,
  customer_name    TEXT,
  invoice_number   TEXT,

  -- Expense fields
  expense_category kasir_expense_category,
  description      TEXT,

  -- PO module integration
  po_id            UUID,

  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kasir_date ON kasir_transactions(date);
CREATE INDEX IF NOT EXISTS idx_kasir_type_date ON kasir_transactions(type, date);

ALTER TABLE public.kasir_transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'kasir_transactions' AND policyname = 'anon_all_kasir'
  ) THEN
    CREATE POLICY "anon_all_kasir" ON kasir_transactions
      FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

- [ ] **Step 3: Verify table exists**

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'kasir_transactions'
ORDER BY ordinal_position;
```
Expected: 15 rows — id, date, type, channel, items, subtotal, hpp_total, payment_method, customer_name, invoice_number, expense_category, description, po_id, created_by, created_at.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260604000006_kasir_transactions.sql
git commit -m "feat(db): add kasir_transactions table with enums and RLS"
```

---

### Task 3: TypeScript types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `kasir` to `PermissionSet` and `ALL_PERMISSIONS`**

In `src/types.ts`, find the `PermissionSet` interface and add `kasir: boolean`. Find `ALL_PERMISSIONS` and add `kasir: true`.

```typescript
// In PermissionSet interface — add after 'pembelian':
kasir: boolean;

// In ALL_PERMISSIONS — add after pembelian: true:
kasir: true,
```

- [ ] **Step 2: Add `'kasir'` to `ActivePage`**

```typescript
// Find line 316, add 'kasir' to the union:
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings' | 'pipeline' | 'order-history' | 'pelanggan' | 'laporan' | 'pembelian' | 'kasir';
```

- [ ] **Step 3: Add `harga_modal` to `SupabaseStockItem` in `supabaseClient.ts`**

In `src/lib/supabaseClient.ts`, find `SupabaseStockItem` interface (line ~19) and add:
```typescript
harga_modal?: number | null;
```

- [ ] **Step 4: Add Kasir types at the end of `src/types.ts`**

```typescript
// ─── Kasir types ────────────────────────────────────────────

export type KasirChannel = 'walkin' | 'tokopedia' | 'grosir';
export type KasirPaymentMethod = 'cash' | 'transfer' | 'qris';
export type KasirExpenseCategory =
  | 'Gaji' | 'Utilitas' | 'Transportasi' | 'Pembelian Stok' | 'Marketing' | 'Lain-lain';

export interface KasirItem {
  sku: string;
  name: string;
  qty: number;
  unit_price: number;
  hpp_per_unit: number;
  subtotal: number;
  hpp_subtotal: number;
}

export interface KasirTransaction {
  id: string;
  date: string;
  type: 'income' | 'expense';
  channel?: KasirChannel | null;
  items: KasirItem[];
  subtotal: number;
  hpp_total: number;
  payment_method?: KasirPaymentMethod | null;
  customer_name?: string | null;
  invoice_number?: string | null;
  expense_category?: KasirExpenseCategory | null;
  description?: string | null;
  po_id?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface DailySummary {
  totalIncome: number;
  totalExpense: number;
  totalHpp: number;
  labaKotor: number;
  labaBersih: number;
  itemsSold: number;
  byChannel: Record<string, number>;
}

export interface NewSaleTransaction {
  date: string;
  channel: KasirChannel;
  items: KasirItem[];
  subtotal: number;
  hpp_total: number;
  payment_method: KasirPaymentMethod;
  customer_name?: string;
  invoice_number: string;
}

export interface NewExpense {
  date: string;
  expense_category: KasirExpenseCategory;
  description: string;
  subtotal: number;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/lib/supabaseClient.ts
git commit -m "feat(types): add KasirTransaction, DailySummary, kasir permission and ActivePage"
```

---

### Task 4: `kasirService` + `stockService` extensions in supabaseClient.ts

**Files:**
- Modify: `src/lib/supabaseClient.ts`

- [ ] **Step 1: Add `stockService.updateHargaModal` and `stockService.decrementStock`**

Find the existing `supabaseService` object (which handles stocks). Add a new `stockService` export after it (or add to existing service — follow the existing pattern of named service exports):

```typescript
export const stockService = {
  async updateHargaModal(sku: string, hargaModal: number | null): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('stocks')
      .update({ harga_modal: hargaModal, updated_at: new Date().toISOString() })
      .eq('sku', sku);
    if (error) throw error;
  },

  async decrementStock(sku: string, qty: number): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('decrement_stock', { p_sku: sku, p_qty: qty });
    if (error) {
      // Fallback: fetch current stock, then update
      const { data, error: fetchErr } = await supabase
        .from('stocks')
        .select('stock')
        .eq('sku', sku)
        .single();
      if (fetchErr) throw fetchErr;
      const newStock = Math.max(0, (data.stock as number) - qty);
      const { error: updateErr } = await supabase
        .from('stocks')
        .update({ stock: newStock, updated_at: new Date().toISOString() })
        .eq('sku', sku);
      if (updateErr) throw updateErr;
    }
  },

  async fetchAll(): Promise<import('../types').StockItem[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('stocks')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []) as import('../types').StockItem[];
  },
};
```

- [ ] **Step 2: Add `kasirService`**

```typescript
import type {
  KasirTransaction, DailySummary, NewSaleTransaction, NewExpense
} from '../types';

export const kasirService = {
  async fetchTransactions(date: string): Promise<KasirTransaction[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('kasir_transactions')
      .select('*')
      .eq('date', date)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as KasirTransaction[];
  },

  async fetchWaOrdersForDate(date: string): Promise<DbOrder[]> {
    if (!supabase) throw new Error('Supabase not configured');
    // Orders where payment was verified on the given date
    const start = `${date}T00:00:00.000Z`;
    const end   = `${date}T23:59:59.999Z`;
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'PAYMENT_VERIFIED')
      .gte('updated_at', start)
      .lte('updated_at', end)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DbOrder[];
  },

  computeDailySummary(
    transactions: KasirTransaction[],
    waOrders: DbOrder[],
    stockMap: Record<string, number | null>
  ): DailySummary {
    let totalIncome = 0;
    let totalExpense = 0;
    let totalHpp = 0;
    let itemsSold = 0;
    const byChannel: Record<string, number> = { walkin: 0, tokopedia: 0, grosir: 0, wa_order: 0 };

    for (const tx of transactions) {
      if (tx.type === 'income') {
        totalIncome += tx.subtotal;
        totalHpp += tx.hpp_total;
        itemsSold += tx.items.reduce((s, i) => s + i.qty, 0);
        if (tx.channel) byChannel[tx.channel] = (byChannel[tx.channel] ?? 0) + tx.subtotal;
      } else {
        totalExpense += tx.subtotal;
      }
    }

    for (const order of waOrders) {
      totalIncome += order.total;
      byChannel.wa_order = (byChannel.wa_order ?? 0) + order.total;
      itemsSold += order.items.reduce((s: number, i: { qty: number }) => s + i.qty, 0);
      // HPP from stockMap snapshot
      for (const item of order.items) {
        const hpp = stockMap[item.sku] ?? 0;
        totalHpp += hpp * item.qty;
      }
    }

    const labaKotor = totalIncome - totalHpp;
    const labaBersih = labaKotor - totalExpense;
    return { totalIncome, totalExpense, totalHpp, labaKotor, labaBersih, itemsSold, byChannel };
  },

  async insertSaleTransaction(tx: NewSaleTransaction): Promise<KasirTransaction> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('kasir_transactions')
      .insert({ ...tx, type: 'income' })
      .select()
      .single();
    if (error) throw error;
    return data as KasirTransaction;
  },

  async insertExpense(tx: NewExpense): Promise<KasirTransaction> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('kasir_transactions')
      .insert({ ...tx, type: 'expense' })
      .select()
      .single();
    if (error) throw error;
    return data as KasirTransaction;
  },

  generateInvoiceNumber(channel: 'walkin' | 'tokopedia' | 'grosir', counter: number): string {
    const prefix = { walkin: 'WLK', tokopedia: 'TPD', grosir: 'GRS' }[channel];
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${prefix}-${date}-${String(counter).padStart(3, '0')}`;
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(service): add kasirService and stockService with HPP and decrement support"
```

---

### Task 5: StockManager — `harga_modal` column

**Files:**
- Modify: `src/components/StockManagerScreen.tsx`

- [ ] **Step 1: Add `harga_modal` to the table header**

Find the table header row in `StockManagerScreen.tsx`. It currently has columns: SKU, Nama, Kategori, Harga Jual, Stok, Status, Aksi. Add `Harga Modal` after `Harga Jual`:

```tsx
<th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-gray-500">Harga Modal</th>
```

- [ ] **Step 2: Add `harga_modal` value in each table row**

In each stock item row, after the `price` cell:
```tsx
<td className="px-4 py-3 text-xs font-semibold text-gray-700">
  {item.harga_modal != null
    ? `Rp ${item.harga_modal.toLocaleString('id-ID')}`
    : <span className="text-amber-500 font-bold" title="Belum diisi — P&L tidak akurat">—</span>
  }
</td>
```

- [ ] **Step 3: Add `Harga Modal` field in the inline edit form**

Find the inline edit form fields. After the `price` input field, add:
```tsx
<div className="space-y-1">
  <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1">
    Harga Modal (HPP)
  </label>
  <input
    type="number"
    min="0"
    value={editItem.harga_modal ?? ''}
    onChange={e => setEditItem(prev => ({ ...prev!, harga_modal: e.target.value ? Number(e.target.value) : null }))}
    placeholder="Harga beli / modal"
    className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
  />
</div>
```

- [ ] **Step 4: Include `harga_modal` in the upsert call**

In the save/upsert logic for the edit form, include `harga_modal: editItem.harga_modal ?? null` in the payload passed to `supabaseService.upsertStock`.

Also update `SupabaseStockItem` usage: when mapping to local `StockItem`, pass `harga_modal` through (it's already optional, so no cast needed).

- [ ] **Step 5: Update CSV template download**

Find the CSV template generation code (headers array). Add `'harga_modal'` after `'price'` in the headers. Add `''` as its default value in the sample row.

- [ ] **Step 6: Update CSV import parser**

In the CSV import handler, after parsing `price`, add:
```typescript
const harga_modal = row['harga_modal'] ? parseFloat(row['harga_modal']) : null;
```
And include `harga_modal` in the item object passed to upsert.

- [ ] **Step 7: Commit**

```bash
git add src/components/StockManagerScreen.tsx
git commit -m "feat(stock): add harga_modal column, edit field, and CSV support"
```

---

### Task 6: Wire Kasir into navigation

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `Receipt` icon import to Sidebar.tsx**

```tsx
import { ..., Receipt } from 'lucide-react';
```

- [ ] **Step 2: Add `kasir` nav item to `menuItems` in Sidebar.tsx**

After the `ai-stock` entry, insert:
```tsx
{ id: 'kasir', label: 'Kasir', icon: Receipt, description: 'Rekonsiliasi Harian', permKey: 'kasir' },
```

- [ ] **Step 3: Add KasirScreen import in App.tsx**

```tsx
import KasirScreen from './components/KasirScreen';
```

- [ ] **Step 4: Add `kasir` case to `renderPage()` in App.tsx**

After the `laporan` case:
```tsx
case 'kasir':
  return (
    <KasirScreen
      currentUser={currentUser}
      showToast={triggerToast}
    />
  );
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat(nav): add Kasir to sidebar and app router"
```

---

### Task 7: `KasirInvoiceModal.tsx`

**Files:**
- Create: `src/components/KasirInvoiceModal.tsx`

- [ ] **Step 1: Create the component**

This follows the exact same pattern as `InvoiceModal.tsx` but accepts a `KasirTransaction`:

```tsx
import React, { useEffect, useState } from 'react';
import { X, Download, FileText } from 'lucide-react';
import { KasirTransaction } from '../types';
import { DbCompanySettings } from '../types';
import { companySettingsService, isSupabaseConfigured } from '../lib/supabaseClient';

interface KasirInvoiceModalProps {
  transaction: KasirTransaction;
  onClose: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Tunai',
  transfer: 'Transfer Bank',
  qris: 'QRIS',
};

const CHANNEL_LABEL: Record<string, string> = {
  walkin: 'Walk-in / Konter',
  tokopedia: 'Tokopedia',
  grosir: 'Grosir / Partai',
};

export default function KasirInvoiceModal({ transaction, onClose }: KasirInvoiceModalProps) {
  const [company, setCompany] = useState<DbCompanySettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    companySettingsService.fetch()
      .then(setCompany)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handlePrint = () => window.print();

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #kasir-invoice-root, #kasir-invoice-root * { visibility: visible; }
          #kasir-invoice-root { position: fixed; top: 0; left: 0; width: 100%; background: white; z-index: 9999; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>

      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          id="kasir-invoice-root"
          className="bg-white rounded-2xl overflow-hidden shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Toolbar */}
          <div className="flex items-center justify-between px-5 py-3 bg-[#012749] text-white print:hidden">
            <div className="flex items-center gap-2 font-bold text-sm">
              <FileText className="w-4 h-4" />
              Invoice {transaction.invoice_number}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-[#2d8a4e] text-white text-xs font-bold rounded-lg hover:bg-green-700"
              >
                <Download className="w-3.5 h-3.5" /> Cetak / PDF
              </button>
              <button onClick={onClose} className="opacity-60 hover:opacity-100 text-xl leading-none">×</button>
            </div>
          </div>

          {/* Invoice body */}
          <div className="overflow-y-auto bg-gray-100 p-4 flex-1">
            <div className="bg-white rounded-lg shadow-sm p-7 font-serif text-sm">
              {loading ? (
                <p className="text-center text-gray-400 py-8">Memuat...</p>
              ) : (
                <>
                  {/* Header */}
                  <div className="flex justify-between items-start pb-5 mb-5 border-b-2 border-[#012749]">
                    <div>
                      <div className="text-xl font-black text-[#012749] tracking-tight">
                        {company?.company_name ?? 'Garindo Jaya Panel'}
                      </div>
                      <div className="text-[11px] text-gray-500 font-sans mt-1">
                        {company?.address ?? 'Alamat belum diisi'}
                      </div>
                      <div className="text-[11px] text-gray-500 font-sans">
                        {company?.phone && `${company.phone} · `}{company?.email ?? ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-black text-[#012749] tracking-widest uppercase">Sales Invoice</div>
                      <div className="text-xs font-mono font-bold text-gray-700 mt-1">
                        {transaction.invoice_number}
                      </div>
                      <div className="text-[10px] text-gray-400 font-sans mt-0.5">
                        Tanggal: {formatDate(transaction.created_at)}
                      </div>
                      <div className="text-[10px] text-gray-500 font-sans mt-0.5">
                        {transaction.channel ? CHANNEL_LABEL[transaction.channel] : ''}
                      </div>
                    </div>
                  </div>

                  {/* Bill to */}
                  {transaction.customer_name && (
                    <div className="mb-5">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 font-sans">
                        Kepada Yth.
                      </div>
                      <div className="font-bold text-gray-800">{transaction.customer_name}</div>
                    </div>
                  )}

                  {/* Line items */}
                  <table className="w-full text-xs font-sans border-collapse mb-4">
                    <thead>
                      <tr className="bg-[#012749] text-white">
                        <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-bold">No.</th>
                        <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide font-bold">Produk / SKU</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-bold">Qty</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-bold">Harga Satuan</th>
                        <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide font-bold">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transaction.items.map((item, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-gray-800">{item.name}</div>
                            <div className="font-mono text-[9px] text-gray-400">{item.sku}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">{item.qty}</td>
                          <td className="px-3 py-2 text-right text-gray-500">
                            Rp {item.unit_price.toLocaleString('id-ID')}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-gray-800">
                            Rp {item.subtotal.toLocaleString('id-ID')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Totals */}
                  <div className="flex justify-end mb-4">
                    <div className="min-w-[200px] text-xs font-sans">
                      <div className="flex justify-between py-2 font-black text-[#012749] text-sm border-t-2 border-[#012749]">
                        <span>TOTAL</span>
                        <span>Rp {transaction.subtotal.toLocaleString('id-ID')}</span>
                      </div>
                      {transaction.payment_method && (
                        <div className="flex justify-between py-1 text-gray-500 text-[10px]">
                          <span>Metode Bayar</span>
                          <span className="font-bold">{PAYMENT_LABEL[transaction.payment_method]}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="text-center text-[10px] text-gray-400 font-sans border-t border-gray-100 pt-3 mt-2">
                    Terima kasih atas kepercayaan Anda · {company?.company_name ?? 'Garindo Jaya Panel'}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/KasirInvoiceModal.tsx
git commit -m "feat(kasir): add KasirInvoiceModal for walk-in and grosir A4 invoice printing"
```

---

### Task 8: `KasirScreen.tsx` — full component

**Files:**
- Create: `src/components/KasirScreen.tsx`

This is the main screen. Build it in one task since all parts are tightly coupled through shared state.

- [ ] **Step 1: Create `src/components/KasirScreen.tsx`**

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  Receipt, TrendingUp, TrendingDown, Package, DollarSign,
  Plus, Printer, X, Search, ChevronDown, AlertTriangle, Lock
} from 'lucide-react';
import {
  KasirTransaction, KasirChannel, KasirPaymentMethod, KasirExpenseCategory,
  KasirItem, NewSaleTransaction, NewExpense, DailySummary, PermissionSet
} from '../types';
import { DbOrder } from '../types';
import {
  kasirService, stockService, isSupabaseConfigured
} from '../lib/supabaseClient';
import { SupabaseStockItem } from '../lib/supabaseClient';
import KasirInvoiceModal from './KasirInvoiceModal';

interface KasirScreenProps {
  currentUser: { name: string; role: string; permissions: PermissionSet } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

// ─── helpers ─────────────────────────────────────────────────

const CHANNEL_LABEL: Record<KasirChannel, string> = {
  walkin: '🏪 Walk-in',
  tokopedia: '🛍️ Tokopedia',
  grosir: '🏭 Grosir',
};

const PAYMENT_LABEL: Record<KasirPaymentMethod, string> = {
  cash: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS',
};

const EXPENSE_CATEGORIES: KasirExpenseCategory[] = [
  'Gaji', 'Utilitas', 'Transportasi', 'Pembelian Stok', 'Marketing', 'Lain-lain',
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatRp(val: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(val);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

// ─── Sub-components ──────────────────────────────────────────

function ChannelPill({ channel }: { channel: KasirChannel }) {
  const styles: Record<KasirChannel, string> = {
    walkin: 'bg-blue-50 text-blue-700',
    tokopedia: 'bg-yellow-50 text-yellow-700',
    grosir: 'bg-violet-50 text-violet-700',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${styles[channel]}`}>
      {CHANNEL_LABEL[channel]}
    </span>
  );
}

// ─── KpiCard ────────────────────────────────────────────────

interface KpiCardProps {
  label: string; value: string; sub: string;
  color: 'green' | 'red' | 'amber' | 'navy'; icon: React.ReactNode;
  locked?: boolean;
}

function KpiCard({ label, value, sub, color, icon, locked }: KpiCardProps) {
  const colorMap = {
    green: 'bg-emerald-50 border-emerald-100',
    red: 'bg-red-50 border-red-100',
    amber: 'bg-amber-50 border-amber-100',
    navy: 'bg-[#012749] border-[#012749]',
  };
  const topBar = {
    green: 'from-[#2d8a4e] to-emerald-400',
    red: 'from-red-600 to-red-400',
    amber: 'from-amber-600 to-amber-400',
    navy: 'from-[#012749] to-[#1e3d60]',
  };
  const textColor = color === 'navy' ? 'text-white' : 'text-[#012749]';
  const subColor = color === 'navy' ? 'text-white/50' : 'text-gray-400';
  const labelColor = color === 'navy' ? 'text-white/50' : 'text-gray-500';

  if (locked) {
    return (
      <div className="bg-white border border-dashed border-gray-200 rounded-3xl p-5 flex flex-col items-center justify-center gap-1">
        <Lock className="w-5 h-5 text-gray-300" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-300">{label}</span>
      </div>
    );
  }

  return (
    <div className={`rounded-3xl p-5 border relative overflow-hidden ${colorMap[color]}`}>
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${topBar[color]}`} />
      <div className={`text-lg mb-2 ${color === 'navy' ? 'text-white' : ''}`}>{icon}</div>
      <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${labelColor}`}>{label}</div>
      <div className={`text-xl font-black leading-none ${textColor}`}>{value}</div>
      <div className={`text-[10px] font-semibold mt-1.5 ${subColor}`}>{sub}</div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────

export default function KasirScreen({ currentUser, showToast }: KasirScreenProps) {
  const isOwner = currentUser?.role?.toLowerCase() === 'owner';

  const [selectedDate, setSelectedDate] = useState<string>(todayISO());
  const [transactions, setTransactions] = useState<KasirTransaction[]>([]);
  const [waOrders, setWaOrders] = useState<DbOrder[]>([]);
  const [stockMap, setStockMap] = useState<Record<string, SupabaseStockItem>>({});
  const [allStocks, setAllStocks] = useState<SupabaseStockItem[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'walkin' | 'wa' | 'online' | 'expense'>('all');

  // Modal states
  const [showSaleModal, setShowSaleModal] = useState<KasirChannel | null>(null);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [printTx, setPrintTx] = useState<KasirTransaction | null>(null);

  // ── Load data ──
  const loadData = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const [txs, orders, stocks] = await Promise.all([
        kasirService.fetchTransactions(selectedDate),
        kasirService.fetchWaOrdersForDate(selectedDate),
        stockService.fetchAll(),
      ]);
      setTransactions(txs);
      setWaOrders(orders);
      const map: Record<string, SupabaseStockItem> = {};
      stocks.forEach((s: any) => { map[s.sku] = s; });
      setStockMap(map);
      setAllStocks(stocks as any);
      const hppMap: Record<string, number | null> = {};
      stocks.forEach((s: any) => { hppMap[s.sku] = s.harga_modal ?? null; });
      setSummary(kasirService.computeDailySummary(txs, orders, hppMap));
    } catch (e) {
      showToast('Gagal memuat data kasir.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Filtered log ──
  const allEntries = [
    ...transactions.map(tx => ({ _src: 'kasir' as const, tx, order: null as DbOrder | null })),
    ...waOrders.map(o => ({ _src: 'wa' as const, tx: null as KasirTransaction | null, order: o })),
  ].sort((a, b) => {
    const aTime = a._src === 'kasir' ? a.tx!.created_at : a.order!.updated_at;
    const bTime = b._src === 'kasir' ? b.tx!.created_at : b.order!.updated_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  const filteredEntries = allEntries.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'wa') return e._src === 'wa';
    if (filter === 'expense') return e._src === 'kasir' && e.tx!.type === 'expense';
    if (filter === 'walkin') return e._src === 'kasir' && e.tx!.channel === 'walkin';
    if (filter === 'online') return e._src === 'kasir' && (e.tx!.channel === 'tokopedia' || e.tx!.channel === 'grosir');
    return true;
  });

  const missingHpp = summary && isOwner
    ? transactions.filter(tx =>
        tx.type === 'income' && tx.items.some(i => i.hpp_per_unit === 0)
      ).length
    : 0;

  // ── Render ──
  return (
    <div className="space-y-5 animate-fadeIn pb-24">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/70 backdrop-blur-md p-6 rounded-[2.5rem] border border-[#e5eeff] shadow-lg">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black tracking-widest text-[#2d8a4e] uppercase bg-emerald-50 border border-emerald-100 px-3 py-1 rounded-full flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
              Rekonsiliasi Aktif
            </span>
          </div>
          <h2 className="text-xl font-black text-[#012749] tracking-tight">Kasir Harian</h2>
          <p className="text-xs text-slate-500 font-semibold mt-1">
            {new Date(selectedDate).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {isOwner && (
            <input
              type="date"
              value={selectedDate}
              max={todayISO()}
              onChange={e => setSelectedDate(e.target.value)}
              className="bg-white border border-[#e5eeff] rounded-xl px-3 py-2 text-xs font-semibold text-[#012749] outline-none focus:ring-1 focus:ring-[#012749]"
            />
          )}
          {isOwner && (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold bg-white border border-[#e5eeff] text-[#012749] hover:border-[#012749] transition-all"
            >
              <Printer className="w-3.5 h-3.5" /> Cetak Laporan
            </button>
          )}
          <button
            onClick={() => setShowSaleModal('walkin')}
            className="flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold bg-[#012749] text-white shadow hover:bg-[#1e3d60] transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> Catat Penjualan
          </button>
        </div>
      </div>

      {/* KPI strip */}
      {!loading && summary && (
        <div className={`grid gap-4 ${isOwner ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3'}`}>
          <KpiCard
            label="Total Pemasukan" color="green" icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
            value={formatRp(summary.totalIncome)} sub={`${allEntries.filter(e => e._src === 'wa' || (e._src === 'kasir' && e.tx!.type === 'income')).length} transaksi`}
          />
          <KpiCard
            label="Total Pengeluaran" color="red" icon={<TrendingDown className="w-5 h-5 text-red-600" />}
            value={formatRp(summary.totalExpense)} sub={`${transactions.filter(t => t.type === 'expense').length} pos`}
          />
          {isOwner ? (
            <>
              <KpiCard
                label="HPP (Harga Modal)" color="amber" icon={<Package className="w-5 h-5 text-amber-600" />}
                value={formatRp(summary.totalHpp)} sub={missingHpp > 0 ? `⚠ ${missingHpp} item tanpa HPP` : 'Semua item ada HPP'}
              />
              <KpiCard
                label="Laba Bersih" color="navy" icon={<DollarSign className="w-5 h-5 text-white" />}
                value={formatRp(summary.labaBersih)}
                sub={`Kotor: ${formatRp(summary.labaKotor)}`}
              />
            </>
          ) : (
            <>
              <KpiCard
                label="Item Terjual" color="amber" icon={<Package className="w-5 h-5 text-amber-600" />}
                value={String(summary.itemsSold)} sub="dari semua channel"
              />
              <KpiCard
                label="Laba Bersih" color="navy" icon={<Lock className="w-5 h-5" />}
                value="" sub="" locked
              />
            </>
          )}
        </div>
      )}

      {/* Main columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Transaction log — takes 2 cols */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-[#e5eeff] shadow-xl overflow-hidden flex flex-col">
          <div className="p-6 pb-3 border-b border-slate-50">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-extrabold text-[#012749]">Log Transaksi</h3>
                <p className="text-xs text-gray-400 mt-0.5">Real-time · semua channel</p>
              </div>
            </div>
            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
              {([
                ['all', 'Semua'],
                ['walkin', 'Walk-in'],
                ['wa', 'WA Order'],
                ['online', 'Online'],
                ['expense', 'Pengeluaran'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                    filter === key ? 'bg-[#012749] text-white' : 'bg-slate-50 text-gray-500 hover:text-[#012749]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2 max-h-[480px]">
            {loading && <p className="text-xs text-gray-400 text-center py-8">Memuat...</p>}
            {!loading && filteredEntries.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-12">Belum ada transaksi.</p>
            )}
            {filteredEntries.map((entry, idx) => {
              if (entry._src === 'wa' && entry.order) {
                const o = entry.order;
                const waHpp = isOwner
                  ? o.items.reduce((s: number, i: { sku: string; qty: number }) => s + (stockMap[i.sku]?.harga_modal ?? 0) * i.qty, 0)
                  : 0;
                return (
                  <div key={`wa-${o.id}`} className="flex items-center gap-3 p-3 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-emerald-50/30 transition-all">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-700 flex-shrink-0">
                      💬 WA Order
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-slate-800 truncate">
                        {o.gjp_order_id ?? o.id.slice(0, 8)} — {o.customer_name}
                      </div>
                      <div className="text-[10px] text-gray-400 font-medium">Auto-sync · {formatTime(o.updated_at)}</div>
                    </div>
                    {isOwner && waHpp > 0 && (
                      <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-lg flex-shrink-0">
                        HPP {formatRp(waHpp)}
                      </span>
                    )}
                    <span className="text-sm font-black text-emerald-600 flex-shrink-0">+{formatRp(o.total)}</span>
                  </div>
                );
              }
              const tx = entry.tx!;
              const isIncome = tx.type === 'income';
              return (
                <div key={`tx-${tx.id}`} className="flex items-center gap-3 p-3 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-blue-50/20 transition-all">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isIncome ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {tx.channel ? (
                    <ChannelPill channel={tx.channel} />
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 flex-shrink-0">
                      📤 Keluar
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">
                      {tx.type === 'expense'
                        ? `${tx.expense_category} — ${tx.description}`
                        : tx.items.map(i => `${i.name} ×${i.qty}`).join(', ')}
                    </div>
                    <div className="text-[10px] text-gray-400 font-medium flex items-center gap-2">
                      {tx.invoice_number && <span>{tx.invoice_number}</span>}
                      {tx.payment_method && <span>· {PAYMENT_LABEL[tx.payment_method]}</span>}
                      {tx.po_id && <span className="text-violet-500">🔗 dari PO</span>}
                      <span>· {formatTime(tx.created_at)}</span>
                    </div>
                  </div>
                  {isOwner && isIncome && tx.hpp_total > 0 && (
                    <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-lg flex-shrink-0">
                      HPP {formatRp(tx.hpp_total)}
                    </span>
                  )}
                  <span className={`text-sm font-black flex-shrink-0 ${isIncome ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isIncome ? '+' : '−'}{formatRp(tx.subtotal)}
                  </span>
                  {isIncome && tx.invoice_number && (
                    <button
                      onClick={() => setPrintTx(tx)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-gray-400 hover:text-[#012749] transition-all flex-shrink-0"
                      title="Cetak invoice"
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex flex-col gap-4">

          {/* Add transaction */}
          <div className="bg-white rounded-[2.5rem] border border-[#e5eeff] shadow-xl p-5">
            <h3 className="text-sm font-extrabold text-[#012749] mb-1">Catat Transaksi</h3>
            <p className="text-[10px] text-gray-400 mb-4">Pilih jenis transaksi</p>

            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-start gap-2.5 mb-4">
              <span className="w-2 h-2 mt-1 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <div>
                <div className="text-[11px] font-bold text-emerald-800">WA Orders — Auto-Sync</div>
                <div className="text-[10px] text-emerald-600">Order terverifikasi otomatis masuk</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {(['walkin', 'tokopedia', 'grosir'] as KasirChannel[]).map(ch => (
                <button
                  key={ch}
                  onClick={() => setShowSaleModal(ch)}
                  className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 text-center transition-all hover:scale-[1.02] ${
                    ch === 'walkin' ? 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100' :
                    ch === 'tokopedia' ? 'bg-yellow-50 border-yellow-200 text-yellow-800 hover:bg-yellow-100' :
                    'bg-violet-50 border-violet-200 text-violet-800 hover:bg-violet-100'
                  }`}
                >
                  <span className="text-xl mb-1">
                    {ch === 'walkin' ? '🏪' : ch === 'tokopedia' ? '🛍️' : '🏭'}
                  </span>
                  <span className="text-[11px] font-black uppercase tracking-wide">
                    {ch === 'walkin' ? 'Walk-in' : ch === 'tokopedia' ? 'Tokopedia' : 'Grosir'}
                  </span>
                </button>
              ))}
              <button
                onClick={() => setShowExpenseModal(true)}
                className="flex flex-col items-center justify-center p-4 rounded-2xl border-2 bg-red-50 border-red-200 text-red-700 hover:bg-red-100 transition-all hover:scale-[1.02] text-center"
              >
                <span className="text-xl mb-1">📤</span>
                <span className="text-[11px] font-black uppercase tracking-wide">Pengeluaran</span>
              </button>
            </div>
          </div>

          {/* Closing summary — owner only */}
          {isOwner && summary && (
            <div className="bg-white rounded-[2.5rem] border border-[#e5eeff] shadow-xl overflow-hidden">
              <div className="p-5 pb-4">
                <h3 className="text-sm font-extrabold text-[#012749] mb-1">Tutup Buku Harian</h3>
                <p className="text-[10px] text-gray-400 mb-4">Ringkasan & cetak laporan</p>
              </div>
              <div className="mx-5 mb-5 bg-gradient-to-br from-[#012749] to-[#1e3d60] rounded-2xl p-4 text-white">
                <div className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-3">
                  Rekap {new Date(selectedDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                {Object.entries(summary.byChannel).filter(([, v]) => v > 0).map(([ch, val]) => (
                  <div key={ch} className="flex justify-between items-center mb-1.5">
                    <span className="text-xs opacity-70 capitalize">{ch === 'wa_order' ? 'WA Orders' : CHANNEL_LABEL[ch as KasirChannel] ?? ch}</span>
                    <span className="text-xs font-bold text-emerald-300">+{formatRp(val)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs opacity-70">− HPP</span>
                  <span className="text-xs font-bold text-yellow-300">−{formatRp(summary.totalHpp)}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs opacity-70">− Biaya Operasional</span>
                  <span className="text-xs font-bold text-red-300">−{formatRp(summary.totalExpense)}</span>
                </div>
                <div className="border-t border-white/15 pt-2 flex justify-between items-center">
                  <span className="text-sm font-black">Laba Bersih</span>
                  <span className={`text-xl font-black ${summary.labaBersih >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatRp(summary.labaBersih)}
                  </span>
                </div>
                <button
                  onClick={() => window.print()}
                  className="mt-3 w-full py-2 rounded-xl bg-white/10 border border-white/20 text-white text-xs font-bold uppercase tracking-wide hover:bg-white/20 transition-all"
                >
                  🖨️ Cetak Laporan Harian
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showSaleModal && (
        <SaleModal
          channel={showSaleModal}
          stocks={allStocks}
          selectedDate={selectedDate}
          isOwner={isOwner}
          onClose={() => setShowSaleModal(null)}
          onSaved={async (tx) => {
            setShowSaleModal(null);
            await loadData();
            showToast('Transaksi disimpan.', 'success');
            if (tx.invoice_number) setPrintTx(tx);
          }}
          showToast={showToast}
        />
      )}
      {showExpenseModal && (
        <ExpenseModal
          selectedDate={selectedDate}
          onClose={() => setShowExpenseModal(false)}
          onSaved={async () => {
            setShowExpenseModal(false);
            await loadData();
            showToast('Pengeluaran dicatat.', 'success');
          }}
          showToast={showToast}
        />
      )}
      {printTx && (
        <KasirInvoiceModal transaction={printTx} onClose={() => setPrintTx(null)} />
      )}
    </div>
  );
}

// ─── SaleModal ───────────────────────────────────────────────

interface SaleModalProps {
  channel: KasirChannel;
  stocks: SupabaseStockItem[];
  selectedDate: string;
  isOwner: boolean;
  onClose: () => void;
  onSaved: (tx: KasirTransaction) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function SaleModal({ channel, stocks, selectedDate, isOwner, onClose, onSaved, showToast }: SaleModalProps) {
  const [customerName, setCustomerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<KasirPaymentMethod>('cash');
  const [items, setItems] = useState<(KasirItem & { _key: number })[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = stocks.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.sku.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 8);

  function addItem(stock: SupabaseStockItem) {
    setItems(prev => [...prev, {
      _key: Date.now(),
      sku: stock.sku,
      name: stock.name,
      qty: 1,
      unit_price: stock.price,
      hpp_per_unit: stock.harga_modal ?? 0,
      subtotal: stock.price,
      hpp_subtotal: stock.harga_modal ?? 0,
    }]);
    setSearch('');
  }

  function updateQty(key: number, qty: number) {
    setItems(prev => prev.map(i =>
      i._key === key
        ? { ...i, qty, subtotal: i.unit_price * qty, hpp_subtotal: i.hpp_per_unit * qty }
        : i
    ));
  }

  function removeItem(key: number) {
    setItems(prev => prev.filter(i => i._key !== key));
  }

  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const hppTotal = items.reduce((s, i) => s + i.hpp_subtotal, 0);

  async function handleSave(print: boolean) {
    if (items.length === 0) { showToast('Tambahkan minimal 1 item.', 'warning'); return; }
    if (channel === 'grosir' && !customerName.trim()) { showToast('Nama customer wajib untuk Grosir.', 'warning'); return; }

    setSaving(true);
    try {
      // Count today's transactions for same channel to generate invoice number
      const existing = await kasirService.fetchTransactions(selectedDate);
      const counter = existing.filter(t => t.channel === channel).length + 1;
      const invoiceNumber = kasirService.generateInvoiceNumber(channel, counter);

      const newTx: NewSaleTransaction = {
        date: selectedDate,
        channel,
        items: items.map(({ _key, ...rest }) => rest),
        subtotal,
        hpp_total: hppTotal,
        payment_method: paymentMethod,
        customer_name: customerName || undefined,
        invoice_number: invoiceNumber,
      };

      const saved = await kasirService.insertSaleTransaction(newTx);

      // Decrement stock for each item
      for (const item of items) {
        try {
          await stockService.decrementStock(item.sku, item.qty);
        } catch {
          showToast(`Gagal kurangi stok ${item.name}.`, 'warning');
        }
      }

      onSaved(print ? saved : { ...saved, invoice_number: null });
    } catch (e) {
      showToast('Gagal menyimpan transaksi.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-extrabold text-[#012749]">
              Catat Penjualan — {channel === 'walkin' ? 'Walk-in' : channel === 'tokopedia' ? 'Tokopedia' : 'Grosir'}
            </h3>
            <p className="text-xs text-gray-400">Pilih item dari stok</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Customer name */}
          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">
              Nama Customer {channel === 'grosir' ? <span className="text-red-500">*</span> : '(opsional)'}
            </label>
            <input
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              placeholder="Nama pembeli..."
              className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
            />
          </div>

          {/* Item search */}
          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">
              Cari & Tambah Item
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Ketik nama atau SKU..."
                className="w-full bg-white rounded-xl pl-9 pr-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
              />
            </div>
            {search && (
              <div className="mt-1 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-lg max-h-44 overflow-y-auto">
                {filtered.length === 0 && (
                  <p className="text-xs text-gray-400 p-3 text-center">Tidak ditemukan.</p>
                )}
                {filtered.map(s => (
                  <button
                    key={s.sku}
                    onClick={() => addItem(s)}
                    className="w-full flex justify-between items-center px-3 py-2 hover:bg-blue-50 text-left border-b border-slate-50 last:border-0"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800">{s.name}</div>
                      <div className="text-[10px] text-gray-400">{s.sku} · Stok: {s.stock}</div>
                    </div>
                    <span className="text-xs font-black text-[#2d8a4e]">{formatRp(s.price)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Item list */}
          {items.length > 0 && (
            <div className="space-y-2">
              <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block">
                Item Dipilih
              </label>
              {items.map(item => (
                <div key={item._key} className="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">{item.name}</div>
                    <div className="text-[10px] text-gray-400">{formatRp(item.unit_price)} /pcs</div>
                  </div>
                  <input
                    type="number" min="1" value={item.qty}
                    onChange={e => updateQty(item._key, Math.max(1, Number(e.target.value)))}
                    className="w-14 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-center outline-none"
                  />
                  <span className="text-xs font-black text-[#2d8a4e] w-20 text-right">{formatRp(item.subtotal)}</span>
                  <button onClick={() => removeItem(item._key)} className="text-gray-300 hover:text-red-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {isOwner && hppTotal > 0 && (
                <div className="text-[10px] text-violet-600 font-bold pl-1">
                  HPP total: {formatRp(hppTotal)}
                </div>
              )}
            </div>
          )}

          {/* Payment method */}
          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">
              Metode Pembayaran
            </label>
            <div className="flex gap-2">
              {(['cash', 'transfer', 'qris'] as KasirPaymentMethod[]).map(m => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                    paymentMethod === m
                      ? 'bg-[#012749] text-white border-[#012749]'
                      : 'bg-white text-gray-600 border-slate-200 hover:border-[#012749]'
                  }`}
                >
                  {PAYMENT_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-bold text-gray-500">Total</span>
            <span className="text-xl font-black text-[#012749]">{formatRp(subtotal)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleSave(false)}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-white border border-slate-200 text-[#012749] hover:border-[#012749] transition-all disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan Saja'}
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-[#012749] text-white hover:bg-[#1e3d60] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" />
              Simpan & Cetak
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ExpenseModal ────────────────────────────────────────────

interface ExpenseModalProps {
  selectedDate: string;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function ExpenseModal({ selectedDate, onClose, onSaved, showToast }: ExpenseModalProps) {
  const [category, setCategory] = useState<KasirExpenseCategory>('Utilitas');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const val = parseFloat(amount.replace(/\D/g, ''));
    if (!val || val <= 0) { showToast('Masukkan jumlah yang valid.', 'warning'); return; }
    if (!description.trim()) { showToast('Deskripsi wajib diisi.', 'warning'); return; }
    setSaving(true);
    try {
      await kasirService.insertExpense({
        date: selectedDate,
        expense_category: category,
        description: description.trim(),
        subtotal: val,
      });
      onSaved();
    } catch {
      showToast('Gagal menyimpan pengeluaran.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-base font-extrabold text-[#012749]">Catat Pengeluaran</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">Kategori</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as KasirExpenseCategory)}
              className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
            >
              {EXPENSE_CATEGORIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">Deskripsi</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Contoh: Galon air x2, Bayar WiFi Indihome..."
              className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
            />
          </div>

          <div>
            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest pl-1 block mb-1">Jumlah (Rp)</label>
            <input
              type="number"
              min="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              className="w-full bg-white rounded-xl px-3 py-2 border border-slate-200 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-[#2d8a4e]"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-2.5 rounded-xl text-xs font-bold bg-[#012749] text-white hover:bg-[#1e3d60] transition-all disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Simpan Pengeluaran'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app compiles**

```bash
npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors. Fix any type mismatches before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/components/KasirScreen.tsx
git commit -m "feat(kasir): add KasirScreen with sale/expense modals, P&L summary, and role-gated HPP"
```

---

### Task 9: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify Kasir appears in sidebar**

Open the app. Log in. Confirm "Kasir" icon appears in the sidebar between Stok and Pelanggan. Click it — KasirScreen loads.

- [ ] **Step 3: Verify KPI cards render correctly**

- As admin role: 3 cards visible (Pemasukan, Pengeluaran, Laba Bersih locked 🔒)
- As owner role: 4 cards visible including HPP and Laba Bersih (navy card)

- [ ] **Step 4: Verify transaction entry — Walk-in**

Click "Walk-in" channel button → SaleModal opens → search an item → add it → set qty → pick payment method → click "Simpan & Cetak" → transaction appears in log → KasirInvoiceModal opens → print preview works.

- [ ] **Step 5: Verify expense entry**

Click "📤 Pengeluaran" → ExpenseModal → fill category, description, amount → save → appears in log as red row.

- [ ] **Step 6: Verify owner-only closing summary**

As owner: right panel shows "Tutup Buku Harian" with breakdown formula. "Cetak Laporan Harian" triggers browser print.

- [ ] **Step 7: Verify WA orders auto-appear**

If there are any PAYMENT_VERIFIED orders updated today, they should appear in the log as "💬 WA Order" rows automatically.

- [ ] **Step 8: Verify StockManager harga_modal column**

Navigate to AI Stock Manager — "Harga Modal" column visible. Edit an item — "Harga Modal (HPP)" field present. Items without HPP show amber "—".

- [ ] **Step 9: Final commit**

```bash
git add progress.md
git commit -m "feat(kasir): complete kasir rekonsiliasi harian feature

Walk-in/Tokopedia/grosir POS with stock deduction, A4 invoice print, HPP-based true P&L, role-split owner vs admin views, WA orders auto-sync, expense tracking with categories.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Section 1 (DB migrations) → Tasks 1 & 2
- ✅ Section 2 (StockManager harga_modal) → Task 5
- ✅ Section 3 (KasirScreen + modals + kasirService) → Tasks 3, 4, 6, 8
- ✅ Section 4 (KasirInvoiceModal) → Task 7
- ✅ Section 5 (historical navigation, owner only) → Task 8 (date picker in KasirScreen header)
- ✅ Role access table → KpiCard `locked` prop, conditional renders throughout KasirScreen
- ✅ PO integration (`po_id` column) → Task 2 (migration), displayed in log as "🔗 dari PO" badge
- ✅ Error handling → try/catch in all service calls, showToast on failure

**Type consistency check:**
- `KasirTransaction`, `KasirItem`, `DailySummary`, `NewSaleTransaction`, `NewExpense` defined in Task 3 and used consistently throughout Tasks 7 and 8
- `kasirService.computeDailySummary` returns `DailySummary` shape matching `KpiCard` usage
- `stockService.fetchAll()` returns items with `harga_modal?: number | null` — used in `stockMap` and HPP computation

**No placeholders confirmed:** all steps have complete code or exact commands.
