# Pembelian Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete purchase order module — supplier management, PO lifecycle (DRAFT → ORDERED → RECEIVED → PAID), atomic stock update on receipt, per-item damage tracking with replacement flow, invoice/payment proof uploads, and a summary dashboard.

**Architecture:** New `PembelianScreen.tsx` page with two tabs (Purchase Orders / Supplier). Sub-components live in `src/components/pembelian/`. All Supabase calls go through `src/lib/pembelianService.ts`. Three DB tables (`suppliers`, `purchase_orders`, `purchase_order_items`) with two atomic RPC functions for stock updates.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS, lucide-react icons, Supabase (PostgreSQL + RLS + RPC + Storage), Vite.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20260604000004_pembelian_module.sql` | All 3 tables, RLS, 3 RPC functions |
| Create | `src/lib/pembelianService.ts` | All Supabase calls for this module |
| Create | `src/components/PembelianScreen.tsx` | Main page: summary cards, tab router |
| Create | `src/components/pembelian/SupplierModal.tsx` | Add / edit supplier form |
| Create | `src/components/pembelian/PurchaseOrderModal.tsx` | Create / edit PO with line items |
| Create | `src/components/pembelian/ReceiveGoodsModal.tsx` | Per-item condition + invoice upload |
| Create | `src/components/pembelian/PoDetailView.tsx` | PO detail: line items, margin, Barang Rusak |
| Create | `src/components/pembelian/MarkAsPaidModal.tsx` | Payment proof upload + confirm paid |
| Create | `src/components/pembelian/ReceiveReplacementModal.tsx` | Confirm replacement receipt |
| Modify | `src/types.ts` | Add DbSupplier, DbPurchaseOrder, DbPurchaseOrderItem, update ActivePage + PermissionSet |
| Modify | `src/initialData.ts` | Add `pembelian: false` to INITIAL_ADMINS permissions |
| Modify | `src/components/Sidebar.tsx` | Add Pembelian nav item |
| Modify | `src/App.tsx` | Import + render case + permission |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260604000004_pembelian_module.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260604000004_pembelian_module.sql

-- ── Suppliers ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  contact_name      text,
  phone             text,
  payment_term_days int  NOT NULL DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'anon full access suppliers'
  ) THEN
    CREATE POLICY "anon full access suppliers"
      ON public.suppliers FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Purchase Orders ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number         text    UNIQUE NOT NULL,
  supplier_id       uuid    NOT NULL REFERENCES public.suppliers(id),
  status            text    NOT NULL DEFAULT 'DRAFT',
  notes             text,
  ordered_at        timestamptz,
  received_at       timestamptz,
  payment_due_at    date,
  paid_at           timestamptz,
  invoice_url       text,
  payment_proof_url text,
  tax_rate          numeric NOT NULL DEFAULT 0,
  tax_amount        numeric NOT NULL DEFAULT 0,
  subtotal          numeric NOT NULL DEFAULT 0,
  total             numeric NOT NULL DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'purchase_orders' AND policyname = 'anon full access purchase_orders'
  ) THEN
    CREATE POLICY "anon full access purchase_orders"
      ON public.purchase_orders FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── Purchase Order Items ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         uuid    NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  sku           varchar REFERENCES public.stocks(sku),
  product_name  text    NOT NULL,
  qty           int     NOT NULL,
  unit_cost     numeric NOT NULL,
  subtotal      numeric NOT NULL,
  qty_received  int     NOT NULL DEFAULT 0,
  qty_damaged   int     NOT NULL DEFAULT 0,
  damage_notes  text,
  damage_status text    NOT NULL DEFAULT 'NONE'
);

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'purchase_order_items' AND policyname = 'anon full access purchase_order_items'
  ) THEN
    CREATE POLICY "anon full access purchase_order_items"
      ON public.purchase_order_items FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── RPC: generate_po_number ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_po_number()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_prefix  text;
  v_max_seq int;
BEGIN
  v_prefix := 'PO-' || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-');
  SELECT COALESCE(MAX(
    CASE
      WHEN po_number ~ '^PO-[0-9]{4}-[0-9]{2}-[0-9]{3}$'
           AND LEFT(po_number, LENGTH(v_prefix)) = v_prefix
      THEN RIGHT(po_number, 3)::int
      ELSE 0
    END
  ), 0) + 1
  INTO v_max_seq
  FROM public.purchase_orders;
  RETURN v_prefix || LPAD(v_max_seq::text, 3, '0');
END;
$$;

-- ── RPC: receive_purchase_order ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_po_id       uuid,
  p_received_at timestamptz,
  p_conditions  jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_item        record;
  v_cond        jsonb;
  v_qty_received int;
  v_qty_damaged  int;
  v_damage_notes text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_orders WHERE id = p_po_id AND status = 'ORDERED'
  ) THEN
    RAISE EXCEPTION 'PO % is not in ORDERED status', p_po_id;
  END IF;

  FOR v_item IN
    SELECT id, sku FROM public.purchase_order_items WHERE po_id = p_po_id
  LOOP
    v_cond := p_conditions -> (v_item.id::text);
    IF v_cond IS NOT NULL THEN
      v_qty_received := (v_cond ->> 'qty_received')::int;
      v_qty_damaged  := (v_cond ->> 'qty_damaged')::int;
      v_damage_notes := v_cond ->> 'damage_notes';

      UPDATE public.purchase_order_items SET
        qty_received  = v_qty_received,
        qty_damaged   = v_qty_damaged,
        damage_notes  = v_damage_notes,
        damage_status = CASE WHEN v_qty_damaged > 0 THEN 'PENDING_RETURN' ELSE 'NONE' END
      WHERE id = v_item.id;

      IF v_qty_received > 0 AND v_item.sku IS NOT NULL THEN
        UPDATE public.stocks
        SET stock = stock + v_qty_received, updated_at = now()
        WHERE sku = v_item.sku;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.purchase_orders
  SET status = 'RECEIVED', received_at = p_received_at
  WHERE id = p_po_id;
END;
$$;

-- ── RPC: receive_replacement ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.receive_replacement(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_sku         varchar;
  v_qty_damaged int;
BEGIN
  SELECT sku, qty_damaged
  INTO v_sku, v_qty_damaged
  FROM public.purchase_order_items
  WHERE id = p_item_id AND damage_status = 'RETURNED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % not found or not in RETURNED status', p_item_id;
  END IF;

  IF v_qty_damaged > 0 AND v_sku IS NOT NULL THEN
    UPDATE public.stocks
    SET stock = stock + v_qty_damaged, updated_at = now()
    WHERE sku = v_sku;
  END IF;

  UPDATE public.purchase_order_items
  SET damage_status = 'REPLACED'
  WHERE id = p_item_id;
END;
$$;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

In Claude Code, run via the Supabase MCP tool (`apply_migration`). If running manually, paste the SQL into the Supabase dashboard → SQL Editor and execute.

Verify by running in the SQL editor:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('suppliers', 'purchase_orders', 'purchase_order_items');
-- Expected: 3 rows

SELECT proname FROM pg_proc
WHERE proname IN ('generate_po_number', 'receive_purchase_order', 'receive_replacement');
-- Expected: 3 rows
```

- [ ] **Step 3: Create the Supabase Storage bucket**

In the Supabase dashboard → Storage → New bucket:
- Name: `purchase-documents`
- Public: **yes** (same pattern as existing `chat-media` bucket — URLs are stored directly as text)

Verify: the bucket appears in the Storage section.

- [ ] **Step 4: Test RPCs in SQL editor**

```sql
-- Test generate_po_number (no POs yet, should return PO-YYYY-MM-001)
SELECT public.generate_po_number();
-- Expected: 'PO-2026-06-001' (current month)
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260604000004_pembelian_module.sql
git commit -m "feat(db): add suppliers, purchase_orders, purchase_order_items tables and RPCs"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add new types to `src/types.ts`**

Add after the `DbCompanySettings` interface (around line 265):

```typescript
export interface DbSupplier {
  id: string;
  name: string;
  contact_name?: string;
  phone?: string;
  payment_term_days: number;
  created_at: string;
}

export type PurchaseOrderStatus = 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'PAID';
export type DamageStatus = 'NONE' | 'PENDING_RETURN' | 'RETURNED' | 'REPLACED';

export interface DbPurchaseOrderItem {
  id: string;
  po_id: string;
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
  subtotal: number;
  qty_received: number;
  qty_damaged: number;
  damage_notes?: string;
  damage_status: DamageStatus;
}

export interface DbPurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier?: DbSupplier;
  status: PurchaseOrderStatus;
  notes?: string;
  ordered_at?: string;
  received_at?: string;
  payment_due_at?: string;
  paid_at?: string;
  invoice_url?: string;
  payment_proof_url?: string;
  tax_rate: number;
  tax_amount: number;
  subtotal: number;
  total: number;
  created_at: string;
  items?: DbPurchaseOrderItem[];
}
```

- [ ] **Step 2: Update `PermissionSet` and `ALL_PERMISSIONS` in `src/types.ts`**

In `PermissionSet` (line 6), add:
```typescript
  pembelian: boolean;
```

In `ALL_PERMISSIONS` (line 20), add:
```typescript
  pembelian: true,
```

- [ ] **Step 3: Update `ActivePage` type in `src/types.ts`**

Find the `ActivePage` type (last line of types.ts) and add `'pembelian'`:
```typescript
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings' | 'pipeline' | 'order-history' | 'pelanggan' | 'laporan' | 'pembelian';
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: errors only about missing `pembelian` in `INITIAL_ADMINS` (fixed in Task 3). No other errors.

---

## Task 3: Navigation Wiring

**Files:**
- Modify: `src/initialData.ts`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `pembelian` to `INITIAL_ADMINS` in `src/initialData.ts`**

In each admin object inside `INITIAL_ADMINS`, add `pembelian: false` to the `permissions` object:
```typescript
permissions: {
  dashboard: true,
  salesInbox: true,
  laporan: true,
  aiStock: false,
  pipeline: true,
  pelanggan: true,
  orderHistory: true,
  userManagement: false,
  whatsappAi: false,
  notifications: false,
  settings: false,
  pembelian: false,   // ← add this line to both admin objects
},
```

- [ ] **Step 2: Add Pembelian to sidebar in `src/components/Sidebar.tsx`**

At the top of the file, add `ShoppingCart` to the lucide-react import.

In the `menuItems` array, add after the `ai-stock` entry:
```typescript
{ id: 'pembelian', label: 'Pembelian', icon: ShoppingCart, description: 'PO & Supplier', permKey: 'pembelian' },
```

- [ ] **Step 3: Wire the page in `src/App.tsx`**

Add import at the top of the file with the other screen imports:
```typescript
import PembelianScreen from './components/PembelianScreen';
```

In the `renderPage()` switch, add before the `default` case:
```typescript
      case 'pembelian':
        return (
          <PembelianScreen
            stockList={stockList}
            showToast={triggerToast}
          />
        );
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: one error — `PembelianScreen` module not found (created in Task 4). No other errors.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/initialData.ts src/components/Sidebar.tsx src/App.tsx
git commit -m "feat(nav): add Pembelian page to sidebar and type system"
```

---

## Task 4: Service Layer

**Files:**
- Create: `src/lib/pembelianService.ts`

- [ ] **Step 1: Create `src/lib/pembelianService.ts`**

```typescript
import { supabase } from './supabaseClient';
import type { DbSupplier, DbPurchaseOrder } from '../types';

export const supplierService = {
  async fetchAll(): Promise<DbSupplier[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []) as DbSupplier[];
  },

  async upsert(supplier: Omit<DbSupplier, 'id' | 'created_at'> & { id?: string }): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    if (supplier.id) {
      const { error } = await supabase
        .from('suppliers')
        .update({ name: supplier.name, contact_name: supplier.contact_name, phone: supplier.phone, payment_term_days: supplier.payment_term_days })
        .eq('id', supplier.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('suppliers')
        .insert({ name: supplier.name, contact_name: supplier.contact_name, phone: supplier.phone, payment_term_days: supplier.payment_term_days });
      if (error) throw error;
    }
  },

  async remove(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) throw error;
  },
};

export type PoItemDraft = {
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
  subtotal: number;
};

export const purchaseOrderService = {
  async fetchAll(): Promise<DbPurchaseOrder[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('*, suppliers(*), purchase_order_items(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      ...row,
      supplier: row.suppliers,
      items: row.purchase_order_items ?? [],
    })) as DbPurchaseOrder[];
  },

  async generatePoNumber(): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.rpc('generate_po_number');
    if (error) throw error;
    return data as string;
  },

  async create(po: {
    supplier_id: string;
    notes?: string;
    tax_rate: number;
    tax_amount: number;
    subtotal: number;
    total: number;
    status: 'DRAFT' | 'ORDERED';
    items: PoItemDraft[];
  }): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const po_number = await purchaseOrderService.generatePoNumber();
    const { data: poData, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        po_number,
        supplier_id: po.supplier_id,
        notes: po.notes,
        tax_rate: po.tax_rate,
        tax_amount: po.tax_amount,
        subtotal: po.subtotal,
        total: po.total,
        status: po.status,
        ...(po.status === 'ORDERED' ? { ordered_at: new Date().toISOString() } : {}),
      })
      .select('id')
      .single();
    if (poError) throw poError;
    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .insert(po.items.map(item => ({ ...item, po_id: poData.id })));
    if (itemsError) throw itemsError;
    return poData.id as string;
  },

  async update(poId: string, po: {
    supplier_id: string;
    notes?: string;
    tax_rate: number;
    tax_amount: number;
    subtotal: number;
    total: number;
    items: PoItemDraft[];
  }): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error: poError } = await supabase
      .from('purchase_orders')
      .update({ supplier_id: po.supplier_id, notes: po.notes, tax_rate: po.tax_rate, tax_amount: po.tax_amount, subtotal: po.subtotal, total: po.total })
      .eq('id', poId);
    if (poError) throw poError;
    await supabase.from('purchase_order_items').delete().eq('po_id', poId);
    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .insert(po.items.map(item => ({ ...item, po_id: poId })));
    if (itemsError) throw itemsError;
  },

  async markOrdered(poId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('purchase_orders')
      .update({ status: 'ORDERED', ordered_at: new Date().toISOString() })
      .eq('id', poId);
    if (error) throw error;
  },

  async receiveGoods(poId: string, params: {
    received_at: string;
    payment_due_at: string;
    invoice_url?: string;
    conditions: Record<string, { qty_received: number; qty_damaged: number; damage_notes?: string }>;
  }): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    if (params.invoice_url !== undefined) {
      await supabase.from('purchase_orders')
        .update({ invoice_url: params.invoice_url, payment_due_at: params.payment_due_at })
        .eq('id', poId);
    } else {
      await supabase.from('purchase_orders')
        .update({ payment_due_at: params.payment_due_at })
        .eq('id', poId);
    }
    const { error } = await supabase.rpc('receive_purchase_order', {
      p_po_id: poId,
      p_received_at: params.received_at,
      p_conditions: params.conditions,
    });
    if (error) throw error;
  },

  async markPaid(poId: string, paymentProofUrl?: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('purchase_orders')
      .update({ status: 'PAID', paid_at: new Date().toISOString(), payment_proof_url: paymentProofUrl })
      .eq('id', poId);
    if (error) throw error;
  },

  async updateDamageStatus(itemId: string, damageStatus: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('purchase_order_items')
      .update({ damage_status: damageStatus })
      .eq('id', itemId);
    if (error) throw error;
  },

  async receiveReplacement(itemId: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase.rpc('receive_replacement', { p_item_id: itemId });
    if (error) throw error;
  },

  async uploadDocument(file: File, path: string): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const ext = file.name.split('.').pop() ?? 'pdf';
    const fullPath = `${path}.${ext}`;
    const { error } = await supabase.storage
      .from('purchase-documents')
      .upload(fullPath, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('purchase-documents').getPublicUrl(fullPath);
    return data.publicUrl;
  },

  async fetchSummary(): Promise<{ totalMtd: number; dueMtd: number; totalUnpaid: number; countMtd: number }> {
    if (!supabase) return { totalMtd: 0, dueMtd: 0, totalUnpaid: 0, countMtd: 0 };
    const { data } = await supabase
      .from('purchase_orders')
      .select('total, status, payment_due_at, created_at');
    const rows = (data ?? []) as Array<{ total: number; status: string; payment_due_at?: string; created_at: string }>;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const monthStartDate = monthStart.slice(0, 10);
    const totalMtd = rows.filter(r => r.created_at >= monthStart).reduce((s, r) => s + Number(r.total), 0);
    const countMtd = rows.filter(r => r.created_at >= monthStart).length;
    const dueMtd = rows
      .filter(r => r.status === 'RECEIVED' && r.payment_due_at && r.payment_due_at >= monthStartDate && r.payment_due_at <= monthEndDate)
      .reduce((s, r) => s + Number(r.total), 0);
    const totalUnpaid = rows
      .filter(r => r.status === 'RECEIVED')
      .reduce((s, r) => s + Number(r.total), 0);
    return { totalMtd, dueMtd, totalUnpaid, countMtd };
  },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: the only remaining error is `PembelianScreen` not found (created in Task 5). No errors in `pembelianService.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pembelianService.ts
git commit -m "feat(service): add pembelianService and supplierService"
```

---

## Task 5: PembelianScreen Shell

**Files:**
- Create: `src/components/PembelianScreen.tsx`

- [ ] **Step 1: Create the screen with summary cards and tab structure**

```typescript
import React, { useState, useEffect } from 'react';
import { ShoppingCart } from 'lucide-react';
import { StockItem } from '../types';
import { purchaseOrderService, supplierService } from '../lib/pembelianService';
import type { DbPurchaseOrder, DbPurchaseOrderItem, DbSupplier } from '../types';
import { isSupabaseConfigured } from '../lib/supabaseClient';

interface PembelianScreenProps {
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type Tab = 'orders' | 'suppliers';

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

export default function PembelianScreen({ stockList, showToast }: PembelianScreenProps) {
  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<DbPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<DbSupplier[]>([]);
  const [summary, setSummary] = useState({ totalMtd: 0, dueMtd: 0, totalUnpaid: 0, countMtd: 0 });
  const [loading, setLoading] = useState(true);

  async function reload() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    try {
      const [ords, sups, sum] = await Promise.all([
        purchaseOrderService.fetchAll(),
        supplierService.fetchAll(),
        purchaseOrderService.fetchSummary(),
      ]);
      setOrders(ords);
      setSuppliers(sups);
      setSummary(sum);
    } catch {
      showToast('Gagal memuat data pembelian.', 'warning');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3 flex-shrink-0">
        <div className="bg-indigo-100 p-2 rounded-lg">
          <ShoppingCart className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-base font-bold text-gray-900">Pembelian</h1>
          <p className="text-xs text-gray-500">Manajemen Supplier & Purchase Order</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total PO Bulan Ini</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatRupiah(summary.totalMtd)}</p>
            <p className="text-xs text-gray-400 mt-1">{summary.countMtd} purchase order</p>
          </div>
          <div className="bg-white rounded-xl border border-amber-200 p-4">
            <p className="text-xs text-amber-600 font-medium uppercase tracking-wide">Jatuh Tempo Bulan Ini</p>
            <p className="text-2xl font-bold text-amber-700 mt-1">{formatRupiah(summary.dueMtd)}</p>
            <p className="text-xs text-amber-400 mt-1">belum dibayar, jatuh tempo bulan ini</p>
          </div>
          <div className="bg-white rounded-xl border border-rose-200 p-4">
            <p className="text-xs text-rose-600 font-medium uppercase tracking-wide">Total Belum Dibayar</p>
            <p className="text-2xl font-bold text-rose-700 mt-1">{formatRupiah(summary.totalUnpaid)}</p>
            <p className="text-xs text-rose-400 mt-1">semua PO outstanding</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Jumlah PO Bulan Ini</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{summary.countMtd}</p>
            <p className="text-xs text-gray-400 mt-1">purchase order dibuat</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          <button
            onClick={() => setTab('orders')}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px ${tab === 'orders' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Purchase Orders
          </button>
          <button
            onClick={() => setTab('suppliers')}
            className={`px-4 py-2.5 text-sm font-medium -mb-px ${tab === 'suppliers' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Supplier
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-sm text-gray-400">Memuat data...</div>
        ) : tab === 'orders' ? (
          <OrdersTab
            orders={orders}
            suppliers={suppliers}
            stockList={stockList}
            showToast={showToast}
            onRefresh={reload}
          />
        ) : (
          <SuppliersTab
            suppliers={suppliers}
            showToast={showToast}
            onRefresh={reload}
          />
        )}
      </div>
    </div>
  );
}

// Placeholder sub-components — implemented in Tasks 6 and 7
function OrdersTab(_props: any) { return <div className="text-sm text-gray-400">Orders tab — coming in Task 7</div>; }
function SuppliersTab(_props: any) { return <div className="text-sm text-gray-400">Suppliers tab — coming in Task 6</div>; }
```

- [ ] **Step 2: Verify the page renders in the browser**

Run the dev server:
```bash
npm run dev
```
Navigate to the Pembelian page via the sidebar. You should see:
- Page header with shopping cart icon
- Four summary cards (all Rp 0 if no data)
- Two tabs: "Purchase Orders" and "Supplier"
- Placeholder content in each tab

- [ ] **Step 3: Commit**

```bash
git add src/components/PembelianScreen.tsx
git commit -m "feat(ui): add PembelianScreen shell with summary cards and tab navigation"
```

---

## Task 6: Supplier Tab

**Files:**
- Create: `src/components/pembelian/SupplierModal.tsx`
- Modify: `src/components/PembelianScreen.tsx` (replace `SuppliersTab` placeholder)

- [ ] **Step 1: Create `src/components/pembelian/SupplierModal.tsx`**

```typescript
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { DbSupplier } from '../../types';
import { supplierService } from '../../lib/pembelianService';

interface SupplierModalProps {
  supplier?: DbSupplier;
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function SupplierModal({ supplier, onClose, onSaved, showToast }: SupplierModalProps) {
  const [name, setName] = useState(supplier?.name ?? '');
  const [contactName, setContactName] = useState(supplier?.contact_name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [termDays, setTermDays] = useState(String(supplier?.payment_term_days ?? 0));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) { showToast('Nama supplier wajib diisi.', 'warning'); return; }
    setSaving(true);
    try {
      await supplierService.upsert({
        id: supplier?.id,
        name: name.trim(),
        contact_name: contactName.trim() || undefined,
        phone: phone.trim() || undefined,
        payment_term_days: parseInt(termDays) || 0,
      });
      showToast(supplier ? 'Supplier diperbarui.' : 'Supplier ditambahkan.', 'success');
      onSaved();
      onClose();
    } catch {
      showToast('Gagal menyimpan supplier.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">{supplier ? 'Edit Supplier' : 'Tambah Supplier'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Nama Supplier <span className="text-rose-500">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="PT Schneider Elektrik" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Nama Kontak</label>
              <input value={contactName} onChange={e => setContactName(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="Budi Santoso" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Nomor HP</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="0812-xxxx-xxxx" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Term Pembayaran (hari)</label>
            <input type="number" min="0" value={termDays} onChange={e => setTermDays(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="30" />
            <p className="text-[10px] text-gray-400 mt-1">0 = Cash. 30 = Net 30, dst.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleSave} disabled={saving} className="text-sm font-semibold text-white bg-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `SuppliersTab` placeholder in `src/components/PembelianScreen.tsx`**

Remove the placeholder `SuppliersTab` function and replace with:

```typescript
import SupplierModal from './pembelian/SupplierModal';

interface SuppliersTabProps {
  suppliers: DbSupplier[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onRefresh: () => void;
}

function SuppliersTab({ suppliers, showToast, onRefresh }: SuppliersTabProps) {
  const [search, setSearch] = useState('');
  const [modalSupplier, setModalSupplier] = useState<DbSupplier | null | undefined>(undefined);

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.contact_name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  async function handleDelete(s: DbSupplier) {
    if (!confirm(`Hapus supplier "${s.name}"?`)) return;
    try {
      await supplierService.remove(s.id);
      showToast('Supplier dihapus.', 'success');
      onRefresh();
    } catch {
      showToast('Gagal menghapus supplier.', 'warning');
    }
  }

  function termLabel(days: number): string {
    if (days === 0) return 'Cash';
    return `Net ${days}`;
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="relative">
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="Cari supplier..."
            />
          </div>
          <button
            onClick={() => setModalSupplier(null)}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700"
          >
            Tambah Supplier
          </button>
        </div>
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">Belum ada supplier.</div>
        ) : (
          <>
            <div className="grid grid-cols-5 px-4 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              <span className="col-span-2">Nama Supplier</span>
              <span className="col-span-1">Kontak</span>
              <span className="col-span-1 text-center">Term Bayar</span>
              <span className="col-span-1 text-center">Aksi</span>
            </div>
            {filtered.map(s => (
              <div key={s.id} className="grid grid-cols-5 px-4 py-3 border-b border-gray-100 items-center hover:bg-gray-50">
                <div className="col-span-2">
                  <div className="text-sm font-semibold text-gray-800">{s.name}</div>
                  {s.contact_name && <div className="text-[10px] text-gray-400">{s.contact_name}</div>}
                </div>
                <span className="text-xs text-gray-600">{s.phone ?? '—'}</span>
                <div className="flex justify-center">
                  <span className="bg-blue-100 text-blue-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">{termLabel(s.payment_term_days)}</span>
                </div>
                <div className="flex justify-center gap-1">
                  <button onClick={() => setModalSupplier(s)} className="text-xs text-gray-500 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
                  <button onClick={() => handleDelete(s)} className="text-xs text-rose-500 px-2 py-1 rounded border border-rose-100 hover:bg-rose-50">Hapus</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      {modalSupplier !== undefined && (
        <SupplierModal
          supplier={modalSupplier ?? undefined}
          onClose={() => setModalSupplier(undefined)}
          onSaved={onRefresh}
          showToast={showToast}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Test in browser**

- Navigate to Pembelian → Supplier tab
- Click "Tambah Supplier" → modal opens
- Fill in name, contact, phone, term days → Save → appears in table
- Click Edit → modal pre-filled → change name → Save → updates in table
- Click Hapus → confirm → row removed

- [ ] **Step 4: Commit**

```bash
git add src/components/pembelian/SupplierModal.tsx src/components/PembelianScreen.tsx
git commit -m "feat(ui): add Supplier tab with add/edit/delete supplier"
```

---

## Task 7: PO List Tab

**Files:**
- Modify: `src/components/PembelianScreen.tsx` (replace `OrdersTab` placeholder)

- [ ] **Step 1: Replace `OrdersTab` placeholder in `src/components/PembelianScreen.tsx`**

Add these status-display helpers near the top of the file (before the component):

```typescript
const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  DRAFT:    { label: '📝 Draft',    className: 'bg-gray-100 text-gray-600' },
  ORDERED:  { label: '🚚 Dipesan',  className: 'bg-blue-100 text-blue-800' },
  RECEIVED: { label: '📦 Diterima', className: 'bg-amber-100 text-amber-800' },
  PAID:     { label: '✓ Lunas',    className: 'bg-green-100 text-green-800' },
};

const LEFT_BORDER: Record<string, string> = {
  ORDERED:  'border-l-4 border-l-blue-400',
  RECEIVED: 'border-l-4 border-l-amber-400',
};
```

Replace the `OrdersTab` placeholder function:

```typescript
interface OrdersTabProps {
  orders: DbPurchaseOrder[];
  suppliers: DbSupplier[];
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onRefresh: () => void;
}

function OrdersTab({ orders, suppliers, stockList, showToast, onRefresh }: OrdersTabProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editPo, setEditPo] = useState<DbPurchaseOrder | null>(null);
  const [receivePo, setReceivePo] = useState<DbPurchaseOrder | null>(null);
  const [payPo, setPayPo] = useState<DbPurchaseOrder | null>(null);
  const [detailPo, setDetailPo] = useState<DbPurchaseOrder | null>(null);

  const filtered = orders.filter(o => {
    const matchSearch = o.po_number.toLowerCase().includes(search.toLowerCase()) ||
      (o.supplier?.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  async function handleMarkOrdered(po: DbPurchaseOrder) {
    try {
      await purchaseOrderService.markOrdered(po.id);
      showToast(`${po.po_number} ditandai Dipesan.`, 'success');
      onRefresh();
    } catch {
      showToast('Gagal mengubah status PO.', 'warning');
    }
  }

  function formatDate(iso?: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              className="flex-1 max-w-sm text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              placeholder="Cari no. PO atau supplier..."
            />
            <select
              value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              <option value="">Semua Status</option>
              <option value="DRAFT">Draft</option>
              <option value="ORDERED">Dipesan</option>
              <option value="RECEIVED">Diterima</option>
              <option value="PAID">Lunas</option>
            </select>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700"
          >
            Buat PO Baru
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-7 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
            <span className="col-span-1">No. PO</span>
            <span className="col-span-1">Supplier</span>
            <span className="col-span-1 text-center">Tgl Pesan</span>
            <span className="col-span-1 text-center">Jatuh Tempo</span>
            <span className="col-span-1 text-right">Total</span>
            <span className="col-span-1 text-center">Status</span>
            <span className="col-span-1 text-center">Aksi</span>
          </div>

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">Belum ada purchase order.</div>
          ) : (
            filtered.map(po => (
              <div key={po.id} className={`grid grid-cols-7 px-4 py-3 border-b border-gray-100 items-center hover:bg-gray-50 ${LEFT_BORDER[po.status] ?? ''}`}>
                <span className="col-span-1 text-xs font-mono font-semibold text-gray-800">{po.po_number}</span>
                <div className="col-span-1">
                  <div className="text-sm font-semibold text-gray-800 truncate">{po.supplier?.name ?? '—'}</div>
                  <div className="text-[10px] text-gray-400">{po.supplier?.payment_term_days === 0 ? 'Cash' : `Net ${po.supplier?.payment_term_days}`}</div>
                </div>
                <span className="col-span-1 text-xs text-gray-500 text-center">{formatDate(po.ordered_at)}</span>
                <span className={`col-span-1 text-xs text-center font-semibold ${po.payment_due_at ? 'text-amber-600' : 'text-gray-400'}`}>
                  {po.payment_due_at ? formatDate(po.payment_due_at) : '—'}
                </span>
                <span className={`col-span-1 text-sm font-bold text-right ${po.status === 'PAID' ? 'text-green-700' : 'text-gray-800'}`}>
                  {formatRupiah(po.total)}
                </span>
                <div className="col-span-1 flex justify-center">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[po.status]?.className}`}>
                    {STATUS_BADGE[po.status]?.label}
                  </span>
                </div>
                <div className="col-span-1 flex justify-center gap-1">
                  <button onClick={() => setDetailPo(po)} className="text-xs text-gray-500 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Detail</button>
                  {po.status === 'DRAFT' && (
                    <>
                      <button onClick={() => setEditPo(po)} className="text-xs text-gray-600 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
                      <button onClick={() => handleMarkOrdered(po)} className="text-xs text-indigo-700 px-2 py-1 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 font-semibold">Pesan</button>
                    </>
                  )}
                  {po.status === 'ORDERED' && (
                    <button onClick={() => setReceivePo(po)} className="text-xs text-indigo-700 px-2 py-1 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 font-semibold">Terima</button>
                  )}
                  {po.status === 'RECEIVED' && (
                    <button onClick={() => setPayPo(po)} className="text-xs text-green-700 px-2 py-1 rounded border border-green-200 bg-green-50 hover:bg-green-100 font-semibold">Bayar</button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modals wired in Tasks 8-10 */}
      {(showCreateModal || editPo) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 text-sm text-gray-500">PurchaseOrderModal — Task 8</div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Test in browser**

- Navigate to Pembelian → Purchase Orders tab
- See empty state or list
- Search and filter controls are functional
- "Buat PO Baru" shows placeholder modal

- [ ] **Step 3: Commit**

```bash
git add src/components/PembelianScreen.tsx
git commit -m "feat(ui): add PO list tab with status badges and action buttons"
```

---

## Task 8: PurchaseOrderModal

**Files:**
- Create: `src/components/pembelian/PurchaseOrderModal.tsx`
- Modify: `src/components/PembelianScreen.tsx` (replace PO modal placeholder)

- [ ] **Step 1: Create `src/components/pembelian/PurchaseOrderModal.tsx`**

```typescript
import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { DbPurchaseOrder, DbSupplier, StockItem } from '../../types';
import { purchaseOrderService, PoItemDraft } from '../../lib/pembelianService';

interface PurchaseOrderModalProps {
  po?: DbPurchaseOrder;
  suppliers: DbSupplier[];
  stockList: StockItem[];
  onClose: () => void;
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

export default function PurchaseOrderModal({ po, suppliers, stockList, onClose, onSaved, showToast }: PurchaseOrderModalProps) {
  const [supplierId, setSupplierId] = useState(po?.supplier_id ?? '');
  const [notes, setNotes] = useState(po?.notes ?? '');
  const [taxEnabled, setTaxEnabled] = useState((po?.tax_rate ?? 0) > 0);
  const [taxRate, setTaxRate] = useState(String((po?.tax_rate ?? 0.11) * 100));
  const [items, setItems] = useState<PoItemDraft[]>(
    po?.items?.map(i => ({ sku: i.sku, product_name: i.product_name, qty: i.qty, unit_cost: i.unit_cost, subtotal: i.subtotal })) ?? []
  );
  const [skuSearch, setSkuSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const supplier = suppliers.find(s => s.id === supplierId);
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const taxAmount = taxEnabled ? subtotal * (parseFloat(taxRate) / 100 || 0) : 0;
  const total = subtotal + taxAmount;

  const skuSuggestions = skuSearch.length > 0
    ? stockList.filter(s =>
        s.sku.toLowerCase().includes(skuSearch.toLowerCase()) ||
        s.name.toLowerCase().includes(skuSearch.toLowerCase())
      ).slice(0, 6)
    : [];

  function addItem(stock: StockItem) {
    setItems(prev => [...prev, { sku: stock.sku, product_name: stock.name, qty: 1, unit_cost: 0, subtotal: 0 }]);
    setSkuSearch('');
  }

  function updateItem(index: number, field: keyof PoItemDraft, value: string) {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      const updated = { ...item, [field]: field === 'qty' || field === 'unit_cost' ? parseFloat(value) || 0 : value };
      updated.subtotal = updated.qty * updated.unit_cost;
      return updated;
    }));
  }

  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSave(status: 'DRAFT' | 'ORDERED') {
    if (!supplierId) { showToast('Pilih supplier terlebih dahulu.', 'warning'); return; }
    if (items.length === 0) { showToast('Tambahkan minimal satu item.', 'warning'); return; }
    if (items.some(i => i.qty <= 0 || i.unit_cost <= 0)) {
      showToast('Qty dan harga beli harus lebih dari 0.', 'warning'); return;
    }
    setSaving(true);
    try {
      const payload = {
        supplier_id: supplierId,
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
        await purchaseOrderService.create({ ...payload, status });
      }
      showToast(po ? 'PO diperbarui.' : `PO dibuat — status: ${status === 'DRAFT' ? 'Draft' : 'Dipesan'}.`, 'success');
      onSaved();
      onClose();
    } catch (e: any) {
      showToast(e.message ?? 'Gagal menyimpan PO.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-sm font-bold text-gray-900">{po ? `Edit PO — ${po.po_number}` : 'Buat Purchase Order'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Supplier + Notes */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Supplier <span className="text-rose-500">*</span></label>
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="">Pilih supplier...</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {supplier && <p className="text-[10px] text-gray-400 mt-1">Term: {supplier.payment_term_days === 0 ? 'Cash' : `Net ${supplier.payment_term_days} hari`}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Catatan</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="Catatan untuk supplier..." />
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-600">Item Pembelian</label>
            </div>

            {/* SKU search */}
            <div className="relative mb-3">
              <input
                value={skuSearch}
                onChange={e => setSkuSearch(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="Ketik nama produk atau SKU untuk menambah item..."
              />
              {skuSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 overflow-hidden">
                  {skuSuggestions.map(s => (
                    <button key={s.sku} onClick={() => addItem(s)} className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-indigo-50 text-left">
                      <span className="font-semibold text-gray-800">{s.name}</span>
                      <span className="font-mono text-gray-400">{s.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-12 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                <span className="col-span-1">SKU</span>
                <span className="col-span-4">Nama Produk</span>
                <span className="col-span-2 text-center">Qty</span>
                <span className="col-span-2 text-right">Harga Beli</span>
                <span className="col-span-2 text-right">Subtotal</span>
                <span className="col-span-1"></span>
              </div>
              {items.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">Belum ada item. Cari produk di atas.</div>
              ) : (
                items.map((item, i) => (
                  <div key={i} className="grid grid-cols-12 px-3 py-2.5 border-b border-gray-100 items-center">
                    <span className="col-span-1 font-mono text-[10px] text-gray-400">{item.sku}</span>
                    <span className="col-span-4 text-xs font-semibold text-gray-800">{item.product_name}</span>
                    <div className="col-span-2 flex justify-center">
                      <input type="number" min="1" value={item.qty} onChange={e => updateItem(i, 'qty', e.target.value)} className="w-16 text-center text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <input type="number" min="0" value={item.unit_cost || ''} onChange={e => updateItem(i, 'unit_cost', e.target.value)} className="w-28 text-right text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-300" placeholder="0" />
                    </div>
                    <span className="col-span-2 text-right text-sm font-bold text-gray-800">{formatRupiah(item.subtotal)}</span>
                    <div className="col-span-1 flex justify-end">
                      <button onClick={() => removeItem(i)} className="text-rose-400 hover:text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))
              )}
              {/* Totals */}
              <div className="flex justify-end gap-8 px-3 py-2.5 border-t-2 border-gray-200 bg-gray-50 text-[11px]">
                <div className="text-right text-gray-400 leading-relaxed">
                  Subtotal<br />
                  <span className="flex items-center gap-1 justify-end">
                    PPN <input type="checkbox" checked={taxEnabled} onChange={e => setTaxEnabled(e.target.checked)} className="accent-indigo-600" />
                    <input type="number" value={taxRate} onChange={e => setTaxRate(e.target.value)} disabled={!taxEnabled} className="w-10 text-right text-[11px] border border-gray-200 rounded px-1 py-0.5 disabled:opacity-40" />%
                  </span>
                  <strong className="text-gray-700">Total</strong>
                </div>
                <div className="text-right text-gray-600 leading-relaxed min-w-[120px]">
                  {formatRupiah(subtotal)}<br />
                  {taxEnabled ? formatRupiah(taxAmount) : '—'}<br />
                  <strong className="text-gray-800">{formatRupiah(total)}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 sticky bottom-0 bg-white">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={() => handleSave('DRAFT')} disabled={saving} className="text-sm font-semibold text-gray-700 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50">Simpan Draft</button>
          <button onClick={() => handleSave('ORDERED')} disabled={saving} className="text-sm font-semibold text-white bg-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Menyimpan...' : 'Simpan & Pesan'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the modal into `OrdersTab` in `src/components/PembelianScreen.tsx`**

Add the import at the top of the file:
```typescript
import PurchaseOrderModal from './pembelian/PurchaseOrderModal';
```

Replace the PO modal placeholder in `OrdersTab` with:
```typescript
      {(showCreateModal || editPo) && (
        <PurchaseOrderModal
          po={editPo ?? undefined}
          suppliers={suppliers}
          stockList={stockList}
          onClose={() => { setShowCreateModal(false); setEditPo(null); }}
          onSaved={onRefresh}
          showToast={showToast}
        />
      )}
```

- [ ] **Step 3: Test in browser**

- Click "Buat PO Baru" → modal opens
- Select a supplier → term hint appears below dropdown
- Type a product name in the search → autocomplete suggestions appear
- Click a suggestion → row added to the items table
- Enter qty and harga beli → subtotal updates
- Enable PPN checkbox → tax row appears, total updates
- Click "Simpan Draft" → PO appears in list with Draft badge
- Click "Simpan & Pesan" → PO appears with Dipesan badge
- Click Edit on a Draft PO → modal opens pre-filled

- [ ] **Step 4: Commit**

```bash
git add src/components/pembelian/PurchaseOrderModal.tsx src/components/PembelianScreen.tsx
git commit -m "feat(ui): add PurchaseOrderModal with SKU search, line items, optional PPN"
```

---

## Task 9: ReceiveGoodsModal

**Files:**
- Create: `src/components/pembelian/ReceiveGoodsModal.tsx`
- Modify: `src/components/PembelianScreen.tsx` (wire receive modal)

- [ ] **Step 1: Create `src/components/pembelian/ReceiveGoodsModal.tsx`**

```typescript
import React, { useState } from 'react';
import { X, Upload } from 'lucide-react';
import { DbPurchaseOrder, DbPurchaseOrderItem } from '../../types';
import { purchaseOrderService } from '../../lib/pembelianService';

interface ReceiveGoodsModalProps {
  po: DbPurchaseOrder;
  onClose: () => void;
  onReceived: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type ItemCondition = { qty_received: number; qty_damaged: number; damage_notes: string };

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ReceiveGoodsModal({ po, onClose, onReceived, showToast }: ReceiveGoodsModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const supplierTermDays = po.supplier?.payment_term_days ?? 0;
  const defaultDueDate = supplierTermDays > 0 ? addDays(today, supplierTermDays) : today;

  const [receivedAt, setReceivedAt] = useState(today);
  const [paymentDueAt, setPaymentDueAt] = useState(defaultDueDate);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [conditions, setConditions] = useState<Record<string, ItemCondition>>(
    Object.fromEntries((po.items ?? []).map(item => [
      item.id,
      { qty_received: item.qty, qty_damaged: 0, damage_notes: '' }
    ]))
  );
  const [saving, setSaving] = useState(false);

  function updateCondition(itemId: string, field: keyof ItemCondition, value: string | number) {
    setConditions(prev => {
      const current = prev[itemId];
      const updated = { ...current, [field]: value };
      return { ...prev, [itemId]: updated };
    });
  }

  function validate(): string | null {
    for (const item of (po.items ?? [])) {
      const cond = conditions[item.id];
      if (!cond) continue;
      if (cond.qty_received + cond.qty_damaged !== item.qty) {
        return `Qty Baik + Qty Rusak harus sama dengan ${item.qty} untuk "${item.product_name}".`;
      }
      if (cond.qty_damaged > 0 && !cond.damage_notes.trim()) {
        return `Catatan kerusakan wajib diisi untuk "${item.product_name}".`;
      }
    }
    return null;
  }

  async function handleConfirm() {
    const err = validate();
    if (err) { showToast(err, 'warning'); return; }
    setSaving(true);
    try {
      let invoiceUrl: string | undefined;
      if (invoiceFile) {
        invoiceUrl = await purchaseOrderService.uploadDocument(invoiceFile, `invoices/${po.id}`);
      }
      await purchaseOrderService.receiveGoods(po.id, {
        received_at: new Date(receivedAt).toISOString(),
        payment_due_at: paymentDueAt,
        invoice_url: invoiceUrl,
        conditions: Object.fromEntries(
          Object.entries(conditions).map(([id, c]) => [
            id,
            { qty_received: c.qty_received, qty_damaged: c.qty_damaged, damage_notes: c.damage_notes || undefined }
          ])
        ),
      });
      showToast(`${po.po_number} diterima. Stok diperbarui.`, 'success');
      onReceived();
      onClose();
    } catch (e: any) {
      showToast(e.message ?? 'Gagal mengkonfirmasi penerimaan.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">Terima Barang — {po.po_number}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700">
            Stok akan bertambah sesuai <strong>Qty Baik</strong> yang diterima. Barang rusak tidak masuk stok dan akan ditrack untuk retur.
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Tanggal Terima <span className="text-rose-500">*</span></label>
              <input type="date" value={receivedAt} onChange={e => setReceivedAt(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1">Jatuh Tempo Pembayaran <span className="text-rose-500">*</span></label>
              <input type="date" value={paymentDueAt} onChange={e => setPaymentDueAt(e.target.value)} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <p className="text-[10px] text-gray-400 mt-1">
                Pre-filled {supplierTermDays > 0 ? `Net ${supplierTermDays}` : 'Cash'}. Sesuaikan dengan invoice supplier.
              </p>
            </div>
          </div>

          {/* Per-item condition */}
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-2">Kondisi Barang per Item</label>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-12 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                <span className="col-span-4">Produk</span>
                <span className="col-span-1 text-center">Dipesan</span>
                <span className="col-span-2 text-center text-emerald-600">Qty Baik</span>
                <span className="col-span-2 text-center text-rose-500">Qty Rusak</span>
                <span className="col-span-3">Catatan Kerusakan</span>
              </div>
              {(po.items ?? []).map(item => {
                const cond = conditions[item.id] ?? { qty_received: item.qty, qty_damaged: 0, damage_notes: '' };
                const hasDamage = cond.qty_damaged > 0;
                return (
                  <div key={item.id} className={hasDamage ? 'bg-rose-50' : ''}>
                    <div className="grid grid-cols-12 px-3 py-2.5 items-center border-b border-gray-100">
                      <div className="col-span-4">
                        <div className="text-xs font-semibold text-gray-800">{item.product_name}</div>
                        <div className="font-mono text-[9px] text-gray-400">{item.sku}</div>
                      </div>
                      <span className="col-span-1 text-center text-xs text-gray-500">{item.qty}</span>
                      <div className="col-span-2 flex justify-center">
                        <input
                          type="number" min="0" max={item.qty}
                          value={cond.qty_received}
                          onChange={e => {
                            const qr = parseInt(e.target.value) || 0;
                            const qd = Math.max(0, item.qty - qr);
                            updateCondition(item.id, 'qty_received', qr);
                            updateCondition(item.id, 'qty_damaged', qd);
                          }}
                          className="w-14 text-center text-sm border border-emerald-300 rounded-lg px-2 py-1 bg-emerald-50 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                        />
                      </div>
                      <div className="col-span-2 flex justify-center">
                        <input
                          type="number" min="0" max={item.qty}
                          value={cond.qty_damaged}
                          onChange={e => {
                            const qd = parseInt(e.target.value) || 0;
                            const qr = Math.max(0, item.qty - qd);
                            updateCondition(item.id, 'qty_damaged', qd);
                            updateCondition(item.id, 'qty_received', qr);
                          }}
                          className={`w-14 text-center text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-1 ${hasDamage ? 'border-rose-300 text-rose-700 font-bold bg-white focus:ring-rose-400' : 'border-gray-200 focus:ring-indigo-300'}`}
                        />
                      </div>
                      <div className="col-span-3 pl-2">
                        {hasDamage ? (
                          <input
                            value={cond.damage_notes}
                            onChange={e => updateCondition(item.id, 'damage_notes', e.target.value)}
                            className="w-full text-xs border border-rose-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-rose-300 placeholder-rose-300"
                            placeholder="Jelaskan kerusakan..."
                          />
                        ) : (
                          <span className="text-[10px] text-gray-300 italic">—</span>
                        )}
                      </div>
                    </div>
                    {hasDamage && (
                      <p className="px-3 pb-2 text-[10px] text-rose-500">⚠ {cond.qty_damaged} item rusak tidak masuk stok — akan ditrack untuk retur.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Invoice upload */}
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Upload Invoice Supplier</label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-lg px-4 py-4 text-xs text-gray-400 hover:border-indigo-300 cursor-pointer">
              <Upload className="w-6 h-6 mb-1 text-gray-300" />
              {invoiceFile ? invoiceFile.name : 'Klik atau drag file invoice (PDF / JPG)'}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setInvoiceFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleConfirm} disabled={saving} className="text-sm font-semibold text-white bg-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Memproses...' : 'Konfirmasi Terima Barang'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the modal in `OrdersTab` in `src/components/PembelianScreen.tsx`**

Add the import:
```typescript
import ReceiveGoodsModal from './pembelian/ReceiveGoodsModal';
```

In the `OrdersTab` JSX, after the PurchaseOrderModal block, add:
```typescript
      {receivePo && (
        <ReceiveGoodsModal
          po={receivePo}
          onClose={() => setReceivePo(null)}
          onReceived={onRefresh}
          showToast={showToast}
        />
      )}
```

- [ ] **Step 3: Test in browser**

- Create a PO with 2 items and mark it as Ordered
- Click "Terima" → ReceiveGoodsModal opens
- The per-item table shows each item with Qty Baik pre-filled = ordered qty, Qty Rusak = 0
- Change Qty Rusak to 2 on one item → Qty Baik auto-adjusts, row turns red, damage notes field appears
- Leave damage notes empty → click Confirm → toast warns about missing notes
- Fill in damage notes → click Confirm without invoice → proceeds (invoice is optional)
- PO status changes to RECEIVED in the list
- In Supabase SQL editor, verify: `SELECT stock FROM stocks WHERE sku = '<the sku>';` — should have increased by qty_received only

- [ ] **Step 4: Commit**

```bash
git add src/components/pembelian/ReceiveGoodsModal.tsx src/components/PembelianScreen.tsx
git commit -m "feat(ui): add ReceiveGoodsModal with per-item condition tracking and atomic stock update"
```

---

## Task 10: PO Detail View with Margin and Barang Rusak

**Files:**
- Create: `src/components/pembelian/PoDetailView.tsx`
- Modify: `src/components/PembelianScreen.tsx` (wire detail view)

- [ ] **Step 1: Create `src/components/pembelian/PoDetailView.tsx`**

```typescript
import React, { useState } from 'react';
import { X, Printer } from 'lucide-react';
import { DbPurchaseOrder, DbPurchaseOrderItem, StockItem } from '../../types';
import { purchaseOrderService } from '../../lib/pembelianService';

interface PoDetailViewProps {
  po: DbPurchaseOrder;
  stockList: StockItem[];
  onClose: () => void;
  onRefresh: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onReceiveReplacement: (item: DbPurchaseOrderItem) => void;
}

const DAMAGE_STATUS_OPTIONS = [
  { value: 'PENDING_RETURN', label: '⏳ Pending Return' },
  { value: 'RETURNED',       label: '✓ Returned' },
  { value: 'REPLACED',       label: '🔄 Replaced' },
];

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '📝 Draft', ORDERED: '🚚 Dipesan', RECEIVED: '📦 Diterima', PAID: '✓ Lunas',
};

export default function PoDetailView({ po, stockList, onClose, onRefresh, showToast, onReceiveReplacement }: PoDetailViewProps) {
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);

  async function handleDamageStatusChange(item: DbPurchaseOrderItem, newStatus: string) {
    setUpdatingItemId(item.id);
    try {
      await purchaseOrderService.updateDamageStatus(item.id, newStatus);
      showToast('Status kerusakan diperbarui.', 'success');
      onRefresh();
    } catch {
      showToast('Gagal memperbarui status.', 'warning');
    } finally {
      setUpdatingItemId(null);
    }
  }

  const damagedItems = (po.items ?? []).filter(i => i.qty_damaged > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto print:shadow-none print:border-none print:max-h-none print:overflow-visible" id="po-print-area">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 print:hidden">
          <div>
            <h2 className="text-sm font-bold text-gray-900">{po.po_number}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{po.supplier?.name} · {STATUS_LABEL[po.status]}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="text-xs text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Print header (visible only when printing) */}
        <div className="hidden print:block px-5 py-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900">Purchase Order</h1>
          <p className="text-sm text-gray-600">{po.po_number} · {formatDate(po.ordered_at ?? po.created_at)}</p>
          <p className="text-sm text-gray-600">Supplier: {po.supplier?.name}</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* PO meta */}
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-gray-400">Tanggal Pesan</p>
              <p className="font-semibold text-gray-800">{formatDate(po.ordered_at)}</p>
            </div>
            <div>
              <p className="text-gray-400">Tanggal Terima</p>
              <p className="font-semibold text-gray-800">{formatDate(po.received_at)}</p>
            </div>
            <div>
              <p className="text-gray-400">Jatuh Tempo</p>
              <p className={`font-semibold ${po.payment_due_at ? 'text-amber-600' : 'text-gray-400'}`}>{formatDate(po.payment_due_at)}</p>
            </div>
          </div>

          {/* Line items with margin */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-2">Item Pembelian</p>
            <div className="border border-gray-200 rounded-xl overflow-hidden text-xs">
              <div className="grid grid-cols-6 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                <span className="col-span-2">Produk</span>
                <span className="text-center">Diterima</span>
                <span className="text-right">Harga Beli</span>
                <span className="text-right">Harga Jual</span>
                <span className="text-right">Margin</span>
              </div>
              {(po.items ?? []).map(item => {
                const stockItem = stockList.find(s => s.sku === item.sku);
                const sellingPrice = stockItem?.price ?? 0;
                const margin = sellingPrice > 0 ? ((sellingPrice - item.unit_cost) / sellingPrice * 100) : 0;
                return (
                  <div key={item.id} className="grid grid-cols-6 px-3 py-2.5 border-b border-gray-100 items-center">
                    <div className="col-span-2">
                      <div className="font-semibold text-gray-800">{item.product_name}</div>
                      <div className="font-mono text-[9px] text-gray-400">
                        {item.sku}{item.qty_damaged > 0 && <span className="text-rose-500"> · {item.qty_damaged} rusak</span>}
                      </div>
                    </div>
                    <span className="text-center text-gray-600">{item.qty_received}</span>
                    <span className="text-right text-gray-600">{formatRupiah(item.unit_cost)}</span>
                    <span className="text-right text-gray-600">{sellingPrice > 0 ? formatRupiah(sellingPrice) : '—'}</span>
                    <span className={`text-right font-bold ${margin > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {sellingPrice > 0 ? `+${margin.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                );
              })}
              {/* Totals */}
              <div className="flex justify-end gap-8 px-3 py-2.5 border-t-2 border-gray-200 bg-gray-50 text-[11px]">
                <div className="text-right text-gray-400 leading-relaxed">
                  Subtotal<br />
                  {po.tax_rate > 0 && <>PPN ({(po.tax_rate * 100).toFixed(0)}%)<br /></>}
                  <strong className="text-gray-700">Total</strong>
                </div>
                <div className="text-right text-gray-600 leading-relaxed min-w-[120px]">
                  {formatRupiah(po.subtotal)}<br />
                  {po.tax_rate > 0 && <>{formatRupiah(po.tax_amount)}<br /></>}
                  <strong className="text-gray-800">{formatRupiah(po.total)}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Barang Rusak section */}
          {damagedItems.length > 0 && (
            <div className="print:hidden">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-rose-500">⚠ Barang Rusak</p>
                <span className="bg-rose-100 text-rose-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">{damagedItems.reduce((s, i) => s + i.qty_damaged, 0)} item</span>
              </div>
              <div className="border border-rose-200 rounded-xl overflow-hidden text-xs">
                <div className="grid grid-cols-12 px-3 py-2 bg-rose-50 border-b border-rose-200 text-[10px] font-bold uppercase tracking-wide text-rose-400">
                  <span className="col-span-3">Produk</span>
                  <span className="col-span-1 text-center">Qty</span>
                  <span className="col-span-4">Catatan</span>
                  <span className="col-span-4 text-center">Status Retur</span>
                </div>
                {damagedItems.map(item => (
                  <div key={item.id} className="grid grid-cols-12 px-3 py-2.5 items-center border-b border-rose-100 bg-white last:border-b-0">
                    <div className="col-span-3">
                      <div className="font-semibold text-gray-800">{item.product_name}</div>
                      <div className="font-mono text-[9px] text-gray-400">{item.sku}</div>
                    </div>
                    <span className="col-span-1 text-center font-bold text-rose-600">{item.qty_damaged}</span>
                    <span className="col-span-4 text-gray-500 text-[11px]">{item.damage_notes ?? '—'}</span>
                    <div className="col-span-4 flex justify-center items-center gap-2">
                      {item.damage_status === 'REPLACED' ? (
                        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">🔄 Replaced</span>
                      ) : (
                        <>
                          <select
                            value={item.damage_status}
                            disabled={updatingItemId === item.id}
                            onChange={e => handleDamageStatusChange(item, e.target.value)}
                            className="text-[11px] border border-amber-200 rounded-lg px-2 py-1 bg-amber-50 text-amber-700 font-semibold focus:outline-none disabled:opacity-50"
                          >
                            {DAMAGE_STATUS_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                          {item.damage_status === 'RETURNED' && (
                            <button
                              onClick={() => onReceiveReplacement(item)}
                              className="text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-1 rounded-lg whitespace-nowrap"
                            >
                              Terima Pengganti
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Attachments */}
          {(po.invoice_url || po.payment_proof_url) && (
            <div className="print:hidden space-y-1">
              {po.invoice_url && (
                <a href={po.invoice_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline block">📎 Lihat Invoice Supplier</a>
              )}
              {po.payment_proof_url && (
                <a href={po.payment_proof_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline block">📎 Lihat Bukti Pembayaran</a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire detail view in `OrdersTab` in `src/components/PembelianScreen.tsx`**

Add the import:
```typescript
import PoDetailView from './pembelian/PoDetailView';
```

Add a new state for replace modal in `OrdersTab`:
```typescript
  const [replaceItem, setReplaceItem] = useState<DbPurchaseOrderItem | null>(null);
```

In the JSX, after the ReceiveGoodsModal block:
```typescript
      {detailPo && (
        <PoDetailView
          po={detailPo}
          stockList={stockList}
          onClose={() => setDetailPo(null)}
          onRefresh={() => { onRefresh(); setDetailPo(null); }}
          showToast={showToast}
          onReceiveReplacement={item => { setReplaceItem(item); }}
        />
      )}
```

- [ ] **Step 3: Test in browser**

- Click "Detail" on any PO → PoDetailView opens
- For a RECEIVED PO, line items show Qty Diterima, Harga Beli, Harga Jual, and Margin %
- If a PO had damaged items, the "Barang Rusak" section appears below
- Change damage status from "Pending Return" to "Returned" → "Terima Pengganti" button appears
- Click Print → `window.print()` fires; sidebar hidden in print

- [ ] **Step 4: Commit**

```bash
git add src/components/pembelian/PoDetailView.tsx src/components/PembelianScreen.tsx
git commit -m "feat(ui): add PoDetailView with margin visibility and Barang Rusak damage tracking"
```

---

## Task 11: MarkAsPaidModal + ReceiveReplacementModal

**Files:**
- Create: `src/components/pembelian/MarkAsPaidModal.tsx`
- Create: `src/components/pembelian/ReceiveReplacementModal.tsx`
- Modify: `src/components/PembelianScreen.tsx` (wire both modals)

- [ ] **Step 1: Create `src/components/pembelian/MarkAsPaidModal.tsx`**

```typescript
import React, { useState } from 'react';
import { X, Upload } from 'lucide-react';
import { DbPurchaseOrder } from '../../types';
import { purchaseOrderService } from '../../lib/pembelianService';

interface MarkAsPaidModalProps {
  po: DbPurchaseOrder;
  onClose: () => void;
  onPaid: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

export default function MarkAsPaidModal({ po, onClose, onPaid, showToast }: MarkAsPaidModalProps) {
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    setSaving(true);
    try {
      let proofUrl: string | undefined;
      if (proofFile) {
        proofUrl = await purchaseOrderService.uploadDocument(proofFile, `payment-proofs/${po.id}`);
      }
      await purchaseOrderService.markPaid(po.id, proofUrl);
      showToast(`${po.po_number} ditandai Lunas.`, 'success');
      onPaid();
      onClose();
    } catch {
      showToast('Gagal menandai PO sebagai lunas.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">Tandai Lunas — {po.po_number}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="bg-gray-50 rounded-lg px-3 py-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Supplier</span>
              <span className="font-semibold text-gray-800">{po.supplier?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total</span>
              <span className="font-bold text-gray-800">{formatRupiah(po.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Jatuh Tempo</span>
              <span className="font-semibold text-amber-600">
                {po.payment_due_at ? new Date(po.payment_due_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
              </span>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">Upload Bukti Pembayaran</label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-lg px-4 py-4 text-xs text-gray-400 hover:border-indigo-300 cursor-pointer">
              <Upload className="w-6 h-6 mb-1 text-gray-300" />
              {proofFile ? proofFile.name : 'Klik atau drag bukti transfer (PDF / JPG)'}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => setProofFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleConfirm} disabled={saving} className="text-sm font-semibold text-white bg-green-600 px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Memproses...' : 'Konfirmasi Lunas'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/pembelian/ReceiveReplacementModal.tsx`**

```typescript
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { DbPurchaseOrderItem } from '../../types';
import { purchaseOrderService } from '../../lib/pembelianService';

interface ReceiveReplacementModalProps {
  item: DbPurchaseOrderItem;
  onClose: () => void;
  onReplaced: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function ReceiveReplacementModal({ item, onClose, onReplaced, showToast }: ReceiveReplacementModalProps) {
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    setSaving(true);
    try {
      await purchaseOrderService.receiveReplacement(item.id);
      showToast(`${item.qty_damaged} unit pengganti "${item.product_name}" diterima. Stok bertambah.`, 'success');
      onReplaced();
      onClose();
    } catch {
      showToast('Gagal mengkonfirmasi penerimaan pengganti.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-900">Terima Barang Pengganti</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700">
            Stok akan bertambah otomatis setelah pengganti dikonfirmasi.
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Produk</span>
              <span className="font-semibold text-gray-800">{item.product_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">SKU</span>
              <span className="font-mono text-gray-500">{item.sku}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Qty Pengganti</span>
              <span className="font-bold text-emerald-600">{item.qty_damaged} unit</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={onClose} className="text-sm font-medium text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
          <button onClick={handleConfirm} disabled={saving} className="text-sm font-semibold text-white bg-emerald-600 px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'Memproses...' : 'Konfirmasi Terima'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire both modals in `src/components/PembelianScreen.tsx`**

Add imports:
```typescript
import MarkAsPaidModal from './pembelian/MarkAsPaidModal';
import ReceiveReplacementModal from './pembelian/ReceiveReplacementModal';
```

In `OrdersTab` JSX, add after the PoDetailView block:
```typescript
      {payPo && (
        <MarkAsPaidModal
          po={payPo}
          onClose={() => setPayPo(null)}
          onPaid={onRefresh}
          showToast={showToast}
        />
      )}
      {replaceItem && (
        <ReceiveReplacementModal
          item={replaceItem}
          onClose={() => setReplaceItem(null)}
          onReplaced={() => { setReplaceItem(null); setDetailPo(null); onRefresh(); }}
          showToast={showToast}
        />
      )}
```

- [ ] **Step 4: Verify full lifecycle in browser**

Run through the complete workflow end-to-end:
1. Add a supplier (Net 14)
2. Create a PO with 2 items → save as Draft
3. Mark as Ordered → badge changes to Dipesan
4. Terima → fill qty baik/rusak (mark 1 item as 2 rusak) → confirm → badge changes to Diterima, stok naik
5. Open Detail → Barang Rusak section shows damaged item; change status to "Returned" → "Terima Pengganti" button appears
6. Click "Terima Pengganti" → confirm → stok naik lagi, status shows Replaced
7. Click "Bayar" → upload proof → confirm → badge changes to Lunas

Verify in Supabase SQL:
```sql
SELECT po_number, status, total FROM purchase_orders ORDER BY created_at DESC LIMIT 3;
SELECT id, product_name, qty_received, qty_damaged, damage_status FROM purchase_order_items WHERE po_id = '<the po id>';
SELECT sku, stock FROM stocks WHERE sku IN ('<sku1>', '<sku2>');
```

- [ ] **Step 5: Commit**

```bash
git add src/components/pembelian/MarkAsPaidModal.tsx src/components/pembelian/ReceiveReplacementModal.tsx src/components/PembelianScreen.tsx
git commit -m "feat(ui): add MarkAsPaidModal and ReceiveReplacementModal — full PO lifecycle complete"
```

- [ ] **Step 6: Final TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Update progress.md**

Add a record to `progress.md` that the Pembelian module is complete.

- [ ] **Step 8: Final commit**

```bash
git add progress.md
git commit -m "docs(progress): record Pembelian module completion"
```
