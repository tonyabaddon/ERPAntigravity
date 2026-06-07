# Buat PO Supplier Page + PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti modal Create/Edit PO dengan halaman penuh sub-view di `PembelianScreen`, plus PDF generation via jsPDF dengan branding Garindo Jaya Panel.

**Architecture:** Sub-view pattern dalam `PembelianScreen` (state `viewMode: 'list' | 'create' | 'edit'`), tanpa sentuh routing global. SupplierPicker dengan 4 state + inline create supplier. PDF di-generate client-side via jsPDF + autotable, buka di tab baru. Audit columns (`created_by_user_id`, `updated_by_user_id`) + permission keys baru (`can_create_po`, `can_edit_po`) di `permissions` JSONB. Field `expected_receive_date` untuk badge "Telat X hari" di list.

**Tech Stack:** React 19 + TypeScript + Tailwind 4 (existing); jsPDF + jspdf-autotable (new); Supabase (existing); Go + database/sql for migration tests.

**Spec:** `docs/superpowers/specs/2026-06-08-po-create-page-design.md`

---

## Implementation Order

Phases A → F. Tiap Phase wajib commit-clean sebelum lanjut.

- **Phase A (Foundation)**: Task 1 (migration) → Task 2 (types)
- **Phase B (Service layer)**: Task 3 (jsPDF install + pembelianService extend)
- **Phase C (Sub-components)**: Task 4 (SupplierPicker) → Task 5 (InlineSupplierForm) → Task 6 (StockPicker extract) → Task 7 (ItemRow)
- **Phase D (Orchestrator + wiring)**: Task 8 (PurchaseOrderFormPage) → Task 9 (PembelianScreen viewMode + delete modal)
- **Phase E (PDF)**: Task 10 (purchaseOrderPdf.ts) → Task 11 (Download PDF di PoDetailView)
- **Phase F (List integration)**: Task 12 (OrdersTab — kolom Tgl Diterima + badge Telat)

Total: 12 tasks. Estimasi 8-12 jam total work.

---

## Conventions

**Testing approach:**
- **Migration & backend logic**: TDD pakai Go test di `backend-go/internal/db/` (project punya live Supabase test infra). RED → migration apply → GREEN.
- **Frontend React components**: project belum punya Jest/Vitest. Workflow per task:
  1. Write component file
  2. `cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run lint` (= `tsc --noEmit`) → harus zero error
  3. Manual smoke test di dev server (`npm run dev`, buka `localhost:3000`)
  4. Commit

**Migration apply mechanism (sesuai pola progress.md):**
```bash
# Pakai psql langsung karena Docker tidak running di workstation dev
psql "$SUPABASE_DB_CONNECTION" -f supabase/migrations/<filename>.sql
```
(`SUPABASE_DB_CONNECTION` di-set di `.env`).

**Commit message format**: `<type>(<scope>): <subject>` mengikuti pola existing — `feat(po-page):`, `feat(po-pdf):`, `chore(deps):`, dst.

---

## Phase A — Foundation

### Task 1: Database migration — `expected_receive_date` + audit columns + permission backfill

**Files:**
- Create: `supabase/migrations/20260608000001_po_expected_date_audit_permissions.sql`
- Create: `backend-go/internal/db/po_audit_test.go`

- [ ] **Step 1.1: Write failing Go test**

Create file `backend-go/internal/db/po_audit_test.go`:

```go
package db_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestPurchaseOrders_ExpectedReceiveDate_Column verifies the column exists and accepts NULL.
func TestPurchaseOrders_ExpectedReceiveDate_Column(t *testing.T) {
	client := NewTestClient(t)
	defer client.DB.Close()

	// Seed a supplier
	supplierID := uuid.NewString()
	_, err := client.DB.Exec(
		`INSERT INTO suppliers (id, name, payment_term_days) VALUES ($1, $2, $3)`,
		supplierID, "Test Supplier PO Audit "+uuid.NewString()[:8], 30,
	)
	if err != nil {
		t.Fatalf("seed supplier: %v", err)
	}

	// Insert PO with expected_receive_date set
	poNumber := "TEST-" + uuid.NewString()[:8]
	expectedDate := time.Now().AddDate(0, 0, 7).Format("2006-01-02")
	_, err = client.DB.Exec(
		`INSERT INTO purchase_orders (po_number, supplier_id, status, tax_rate, tax_amount, subtotal, total, expected_receive_date)
		 VALUES ($1, $2, 'DRAFT', 0, 0, 0, 0, $3)`,
		poNumber, supplierID, expectedDate,
	)
	if err != nil {
		t.Fatalf("insert PO with expected_receive_date: %v", err)
	}

	// Read back
	var got string
	err = client.DB.QueryRow(
		`SELECT expected_receive_date::text FROM purchase_orders WHERE po_number = $1`,
		poNumber,
	).Scan(&got)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got != expectedDate {
		t.Fatalf("expected_receive_date mismatch: got %q want %q", got, expectedDate)
	}

	// Insert PO without expected_receive_date (NULL)
	poNumber2 := "TEST-" + uuid.NewString()[:8]
	_, err = client.DB.Exec(
		`INSERT INTO purchase_orders (po_number, supplier_id, status, tax_rate, tax_amount, subtotal, total)
		 VALUES ($1, $2, 'DRAFT', 0, 0, 0, 0)`,
		poNumber2, supplierID,
	)
	if err != nil {
		t.Fatalf("insert PO without expected_receive_date: %v", err)
	}
}

// TestPurchaseOrders_AuditColumns_FKBehavior verifies created_by/updated_by FK with ON DELETE SET NULL.
func TestPurchaseOrders_AuditColumns_FKBehavior(t *testing.T) {
	client := NewTestClient(t)
	defer client.DB.Close()

	// Seed admin user
	adminID := uuid.NewString()
	_, err := client.DB.Exec(
		`INSERT INTO admin_users (id, name, email, role, permissions, status)
		 VALUES ($1, $2, $3, 'Admin', '{}'::jsonb, 'Aktif')`,
		adminID, "Test Admin", "test-"+adminID[:8]+"@example.com",
	)
	if err != nil {
		t.Fatalf("seed admin: %v", err)
	}

	// Seed supplier
	supplierID := uuid.NewString()
	_, err = client.DB.Exec(
		`INSERT INTO suppliers (id, name, payment_term_days) VALUES ($1, $2, $3)`,
		supplierID, "Test Supplier FK "+uuid.NewString()[:8], 0,
	)
	if err != nil {
		t.Fatalf("seed supplier: %v", err)
	}

	// Insert PO with created_by_user_id
	poNumber := "TEST-" + uuid.NewString()[:8]
	_, err = client.DB.Exec(
		`INSERT INTO purchase_orders (po_number, supplier_id, status, tax_rate, tax_amount, subtotal, total, created_by_user_id)
		 VALUES ($1, $2, 'DRAFT', 0, 0, 0, 0, $3)`,
		poNumber, supplierID, adminID,
	)
	if err != nil {
		t.Fatalf("insert PO with created_by_user_id: %v", err)
	}

	// Delete admin user — created_by_user_id should become NULL
	_, err = client.DB.Exec(`DELETE FROM admin_users WHERE id = $1`, adminID)
	if err != nil {
		t.Fatalf("delete admin user: %v", err)
	}

	var createdByAfter *string
	err = client.DB.QueryRow(
		`SELECT created_by_user_id FROM purchase_orders WHERE po_number = $1`,
		poNumber,
	).Scan(&createdByAfter)
	if err != nil {
		t.Fatalf("read created_by_user_id after admin delete: %v", err)
	}
	if createdByAfter != nil {
		t.Fatalf("expected created_by_user_id to be NULL after admin delete, got %v", *createdByAfter)
	}

	// Cleanup
	_, _ = client.DB.Exec(`DELETE FROM purchase_orders WHERE po_number = $1`, poNumber)
}

// TestAdminUsers_BackfillPermissions verifies action perms exist with default true after migration.
func TestAdminUsers_BackfillPermissions(t *testing.T) {
	client := NewTestClient(t)
	defer client.DB.Close()

	// Seed admin without action perms
	adminID := uuid.NewString()
	_, err := client.DB.Exec(
		`INSERT INTO admin_users (id, name, email, role, permissions, status)
		 VALUES ($1, $2, $3, 'Admin', '{"pembelian": true}'::jsonb, 'Aktif')`,
		adminID, "Test Backfill", "backfill-"+adminID[:8]+"@example.com",
	)
	if err != nil {
		t.Fatalf("seed admin: %v", err)
	}

	// Apply the backfill manually (simulates the migration's UPDATE statement)
	_, err = client.DB.Exec(`
		UPDATE admin_users
		SET permissions = COALESCE(permissions, '{}'::jsonb) || jsonb_build_object(
		  'can_create_po', true,
		  'can_edit_po', true
		)
		WHERE id = $1
		  AND (NOT (permissions ? 'can_create_po') OR NOT (permissions ? 'can_edit_po'))
	`, adminID)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}

	var perms string
	err = client.DB.QueryRow(
		`SELECT permissions::text FROM admin_users WHERE id = $1`,
		adminID,
	).Scan(&perms)
	if err != nil {
		t.Fatalf("read permissions: %v", err)
	}
	if !strings.Contains(perms, `"can_create_po": true`) {
		t.Fatalf("expected can_create_po true, got %s", perms)
	}
	if !strings.Contains(perms, `"can_edit_po": true`) {
		t.Fatalf("expected can_edit_po true, got %s", perms)
	}

	// Cleanup
	_, _ = client.DB.Exec(`DELETE FROM admin_users WHERE id = $1`, adminID)
}
```

- [ ] **Step 1.2: Run test to verify it FAILS (column does not exist)**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity/backend-go
go test ./internal/db/ -run TestPurchaseOrders_ExpectedReceiveDate_Column -v
```

Expected: FAIL with `pq: column "expected_receive_date" of relation "purchase_orders" does not exist`.

- [ ] **Step 1.3: Write migration**

Create `supabase/migrations/20260608000001_po_expected_date_audit_permissions.sql`:

```sql
-- supabase/migrations/20260608000001_po_expected_date_audit_permissions.sql
-- Adds expected_receive_date + audit columns to purchase_orders.
-- Backfills permissions JSONB with action keys can_create_po / can_edit_po.

-- 1a. Add columns to purchase_orders
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS expected_receive_date DATE,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_expected_receive_date
  ON purchase_orders(expected_receive_date)
  WHERE expected_receive_date IS NOT NULL;

-- 1b. Backfill permissions JSONB for existing admin users
UPDATE admin_users
SET permissions = COALESCE(permissions, '{}'::jsonb) || jsonb_build_object(
  'can_create_po', true,
  'can_edit_po', true
)
WHERE permissions IS NULL
   OR NOT (permissions ? 'can_create_po')
   OR NOT (permissions ? 'can_edit_po');
```

- [ ] **Step 1.4: Apply migration**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
psql "$SUPABASE_DB_CONNECTION" -f supabase/migrations/20260608000001_po_expected_date_audit_permissions.sql
```

Expected output: `ALTER TABLE\nCREATE INDEX\nUPDATE X` (X = jumlah admin existing).

- [ ] **Step 1.5: Run all 3 tests to verify GREEN**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity/backend-go
go test ./internal/db/ -run "TestPurchaseOrders_ExpectedReceiveDate_Column|TestPurchaseOrders_AuditColumns_FKBehavior|TestAdminUsers_BackfillPermissions" -v
```

Expected: all 3 PASS.

- [ ] **Step 1.6: Run full backend test suite (no regressions)**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity/backend-go
go test ./...
```

Expected: PASS (no regressions). Existing tests touching `purchase_orders` should still pass karena kolom baru semua NULL-able.

- [ ] **Step 1.7: Commit**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
git add supabase/migrations/20260608000001_po_expected_date_audit_permissions.sql backend-go/internal/db/po_audit_test.go
git commit -m "$(cat <<'EOF'
feat(po): add expected_receive_date + audit columns + action permissions

Migration: adds expected_receive_date DATE, created_by_user_id/updated_by_user_id
UUID FK ON DELETE SET NULL on purchase_orders, plus sparse index on receive date.
Backfills admin_users.permissions JSONB with can_create_po / can_edit_po = true
(idempotent, preserves user-customized values).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Type definitions — extend `PermissionSet` and `DbPurchaseOrder`

**Files:**
- Modify: `src/types.ts:6-36` (PermissionSet + ALL_PERMISSIONS)
- Modify: `src/types.ts:313-332` (DbPurchaseOrder)

- [ ] **Step 2.1: Modify `PermissionSet` interface**

Edit `src/types.ts` lines 6-20. Replace:

```ts
export interface PermissionSet {
  dashboard: boolean;
  salesInbox: boolean;
  laporan: boolean;
  aiStock: boolean;
  pipeline: boolean;
  pelanggan: boolean;
  orderHistory: boolean;
  userManagement: boolean;
  whatsappAi: boolean;
  notifications: boolean;
  settings: boolean;
  pembelian: boolean;
  kasir: boolean;
}
```

with:

```ts
export interface PermissionSet {
  dashboard: boolean;
  salesInbox: boolean;
  laporan: boolean;
  aiStock: boolean;
  pipeline: boolean;
  pelanggan: boolean;
  orderHistory: boolean;
  userManagement: boolean;
  whatsappAi: boolean;
  notifications: boolean;
  settings: boolean;
  pembelian: boolean;
  kasir: boolean;
  // Action permissions (Phase 2 anti-fraud foundation)
  can_create_po?: boolean;
  can_edit_po?: boolean;
}
```

- [ ] **Step 2.2: Modify `ALL_PERMISSIONS` constant**

Edit `src/types.ts` lines 22-36. Replace:

```ts
export const ALL_PERMISSIONS: PermissionSet = {
  dashboard: true,
  salesInbox: true,
  laporan: true,
  aiStock: true,
  pipeline: true,
  pelanggan: true,
  orderHistory: true,
  userManagement: true,
  whatsappAi: true,
  notifications: true,
  settings: true,
  pembelian: true,
  kasir: true,
};
```

with:

```ts
export const ALL_PERMISSIONS: PermissionSet = {
  dashboard: true,
  salesInbox: true,
  laporan: true,
  aiStock: true,
  pipeline: true,
  pelanggan: true,
  orderHistory: true,
  userManagement: true,
  whatsappAi: true,
  notifications: true,
  settings: true,
  pembelian: true,
  kasir: true,
  can_create_po: true,
  can_edit_po: true,
};
```

- [ ] **Step 2.3: Modify `DbPurchaseOrder` interface**

Edit `src/types.ts` lines 313-332. Replace:

```ts
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

with:

```ts
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
  expected_receive_date?: string;   // ISO date 'YYYY-MM-DD', NULL-able
  created_by_user_id?: string;      // UUID, FK admin_users(id)
  updated_by_user_id?: string;      // UUID, FK admin_users(id)
}
```

- [ ] **Step 2.4: Compile check**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run lint
```

Expected: zero errors. Optional fields tidak harus dipakai di tempat lain.

- [ ] **Step 2.5: Commit**

```bash
git add src/types.ts
git commit -m "$(cat <<'EOF'
feat(types): add po audit fields + action permission keys

DbPurchaseOrder gains expected_receive_date / created_by_user_id /
updated_by_user_id (all optional). PermissionSet gains can_create_po /
can_edit_po (optional for backward-compat with kode lama yang baca
permissions JSONB). ALL_PERMISSIONS sets both to true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Service Layer

### Task 3: Install jsPDF deps + extend `purchaseOrderService`

**Files:**
- Modify: `package.json` (add deps)
- Modify: `src/lib/pembelianService.ts:38-101` (PoItemDraft + create signature)
- Modify: `src/lib/pembelianService.ts:103-123` (update signature)

- [ ] **Step 3.1: Install dependencies**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm install jspdf@^2.5.2 jspdf-autotable@^3.8.4
```

Expected: 2 packages added. `package.json` updated with deps.

- [ ] **Step 3.2: Extend `purchaseOrderService.create` signature**

Edit `src/lib/pembelianService.ts` lines 68-101. Replace:

```ts
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
```

with:

```ts
  async create(po: {
    supplier_id: string;
    notes?: string;
    tax_rate: number;
    tax_amount: number;
    subtotal: number;
    total: number;
    status: 'DRAFT' | 'ORDERED';
    items: PoItemDraft[];
    expected_receive_date?: string | null;
    created_by_user_id?: string | null;
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
        expected_receive_date: po.expected_receive_date ?? null,
        created_by_user_id: po.created_by_user_id ?? null,
        updated_by_user_id: po.created_by_user_id ?? null,
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
```

- [ ] **Step 3.3: Extend `purchaseOrderService.update` signature**

Edit `src/lib/pembelianService.ts` lines 103-123. Replace:

```ts
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
```

with:

```ts
  async update(poId: string, po: {
    supplier_id: string;
    notes?: string;
    tax_rate: number;
    tax_amount: number;
    subtotal: number;
    total: number;
    items: PoItemDraft[];
    expected_receive_date?: string | null;
    updated_by_user_id?: string | null;
  }): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error: poError } = await supabase
      .from('purchase_orders')
      .update({
        supplier_id: po.supplier_id,
        notes: po.notes,
        tax_rate: po.tax_rate,
        tax_amount: po.tax_amount,
        subtotal: po.subtotal,
        total: po.total,
        expected_receive_date: po.expected_receive_date ?? null,
        updated_by_user_id: po.updated_by_user_id ?? null,
      })
      .eq('id', poId);
    if (poError) throw poError;
    await supabase.from('purchase_order_items').delete().eq('po_id', poId);
    const { error: itemsError } = await supabase
      .from('purchase_order_items')
      .insert(po.items.map(item => ({ ...item, po_id: poId })));
    if (itemsError) throw itemsError;
  },
```

- [ ] **Step 3.4: Compile check**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run lint
```

Expected: zero errors. Modal lama (`PurchaseOrderModal.tsx`) tetap kompil karena field baru semua optional.

- [ ] **Step 3.5: Commit**

```bash
git add package.json package-lock.json src/lib/pembelianService.ts
git commit -m "$(cat <<'EOF'
feat(po): jspdf deps + extend purchaseOrderService for audit fields

Install jspdf + jspdf-autotable for PDF rendering.
purchaseOrderService.create() & update() now accept optional
expected_receive_date, created_by_user_id, updated_by_user_id.
Defaults to null when omitted — existing callers unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Sub-components

### Task 4: `SupplierPicker` component

**Files:**
- Create: `src/components/pembelian/form/SupplierPicker.tsx`

- [ ] **Step 4.1: Create directory**

```bash
mkdir -p /Users/tonywei/IdeaProjects/ERPAntigravity/src/components/pembelian/form
```

- [ ] **Step 4.2: Write component**

Create `src/components/pembelian/form/SupplierPicker.tsx`:

```tsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, Plus, ChevronRight, Package } from 'lucide-react';
import { DbSupplier, DbPurchaseOrder } from '../../../types';

interface SupplierPickerProps {
  suppliers: DbSupplier[];
  orders: DbPurchaseOrder[];          // for usage-frequency sort
  selectedSupplierId: string;
  onSelect: (supplier: DbSupplier) => void;
  onCreateNew: (prefilledName: string) => void;  // opens InlineSupplierForm in parent
}

export default function SupplierPicker({
  suppliers, orders, selectedSupplierId, onSelect, onCreateNew,
}: SupplierPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

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

  const filtered = useMemo(() => {
    if (!search) return sortedSuppliers;
    const q = search.toLowerCase();
    return sortedSuppliers.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.contact_name ?? '').toLowerCase().includes(q)
    );
  }, [sortedSuppliers, search]);

  const selected = suppliers.find(s => s.id === selectedSupplierId);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function highlight(text: string): React.ReactNode {
    if (!search) return text;
    const i = text.toLowerCase().indexOf(search.toLowerCase());
    if (i === -1) return text;
    return (
      <>
        {text.slice(0, i)}
        <mark className="bg-amber-200 px-0.5 rounded">{text.slice(i, i + search.length)}</mark>
        {text.slice(i + search.length)}
      </>
    );
  }

  function handleSelect(supplier: DbSupplier) {
    onSelect(supplier);
    setOpen(false);
    setSearch('');
  }

  function handleCreate() {
    onCreateNew(search);
    setOpen(false);
    setSearch('');
  }

  // Render: showing selected (compact) vs picker (search box + dropdown)
  if (selected && !open) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-sm border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 bg-white relative flex items-center text-left hover:border-indigo-300"
        >
          <Search className="w-4 h-4 text-gray-400 absolute left-3" />
          <span className="text-base mr-2">🏪</span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-gray-800">{selected.name}</span>
            <span className="block text-[11px] text-gray-500">
              {selected.contact_name ? `${selected.contact_name} · ` : ''}
              {selected.phone ? `${selected.phone} · ` : ''}
              {selected.payment_term_days === 0 ? 'Cash' : `Net ${selected.payment_term_days} hari`}
            </span>
          </span>
          <span className="text-[11px] font-semibold text-indigo-600 ml-2">Ganti</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3 z-10" />
      <input
        type="text"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Cari supplier..."
        className="w-full text-sm border-2 border-indigo-300 rounded-lg pl-9 pr-3 py-2.5 focus:outline-none bg-white"
      />

      {open && (
        <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded-lg shadow-xl mt-1 overflow-hidden">
          <div className="max-h-72 overflow-y-auto">
            {suppliers.length === 0 ? (
              // State A: Empty DB
              <div className="px-4 py-8 text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 flex items-center justify-center mb-3">
                  <Package className="w-6 h-6 text-gray-400" />
                </div>
                <p className="text-sm font-semibold text-gray-700">Belum ada supplier</p>
                <p className="text-xs text-gray-500 mt-1">Buat supplier pertama untuk mulai PO.</p>
              </div>
            ) : filtered.length === 0 ? (
              // State D: Typed, no match
              <div className="px-4 py-5 text-center">
                <p className="text-sm text-gray-500">
                  Tidak ada supplier dengan nama <span className="font-semibold text-gray-700">"{search}"</span>.
                </p>
              </div>
            ) : (
              <>
                {/* State B/C: List with optional header */}
                <div className="px-3 py-1.5 bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500 border-b border-gray-100">
                  {search ? `${filtered.length} Hasil` : 'Sering Dipakai'}
                </div>
                {filtered.map((s, idx) => {
                  const usage = supplierUsageCount.get(s.id) ?? 0;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSelect(s)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-indigo-50 text-left ${idx > 0 ? 'border-t border-gray-100' : ''}`}
                    >
                      <span className="text-base">🏪</span>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-gray-800">{highlight(s.name)}</div>
                        <div className="text-[11px] text-gray-500">
                          {s.contact_name ? `${s.contact_name} · ` : ''}
                          {s.payment_term_days === 0 ? 'Cash' : `Net ${s.payment_term_days}`}
                        </div>
                      </div>
                      {usage > 0 && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${usage >= 3 ? 'text-emerald-700 bg-emerald-50' : 'text-gray-500 bg-gray-100'}`}>
                          {usage} PO
                        </span>
                      )}
                    </button>
                  );
                })}
              </>
            )}
          </div>

          {/* Pinned CTA: always visible */}
          <div className="border-t-2 border-gray-100 bg-indigo-50 px-3 py-2.5 sticky bottom-0">
            <button
              type="button"
              onClick={handleCreate}
              className="w-full flex items-center gap-2.5 text-left"
            >
              <div className={`rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold ${suppliers.length === 0 || filtered.length === 0 ? 'w-8 h-8 text-base' : 'w-7 h-7 text-sm'}`}>
                <Plus className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-indigo-700">
                  {suppliers.length === 0
                    ? 'Tambah supplier pertama'
                    : search
                      ? <>Buat baru: <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-700">"{search}"</span></>
                      : 'Tambah supplier baru'}
                </div>
                <div className="text-[11px] text-indigo-500">
                  {filtered.length === 0 && search
                    ? 'Nama otomatis terisi, tinggal lengkapi kontak & term'
                    : 'Tidak ada di list? Buat di sini tanpa keluar dari PO'}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-indigo-500" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4.3: Compile check**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run lint
```

Expected: zero errors.

- [ ] **Step 4.4: Commit**

```bash
git add src/components/pembelian/form/SupplierPicker.tsx
git commit -m "$(cat <<'EOF'
feat(po-page): SupplierPicker with 4 states + pinned create CTA

Empty DB / opened / typing-with-match / typing-no-match.
Pinned "Buat supplier baru" CTA always visible at bottom of dropdown.
Sort by PO usage count, highlight matched substring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `InlineSupplierForm` component

**Files:**
- Create: `src/components/pembelian/form/InlineSupplierForm.tsx`

- [ ] **Step 5.1: Write component**

Create `src/components/pembelian/form/InlineSupplierForm.tsx`:

```tsx
import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { DbSupplier } from '../../../types';
import { supplierService } from '../../../lib/pembelianService';

interface InlineSupplierFormProps {
  prefillName?: string;
  onSaved: (newSupplier: DbSupplier) => void;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function InlineSupplierForm({
  prefillName, onSaved, onCancel, showToast,
}: InlineSupplierFormProps) {
  const [name, setName] = useState(prefillName ?? '');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [termDays, setTermDays] = useState('0');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      showToast('Nama supplier wajib diisi.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await supplierService.upsert({
        name: name.trim(),
        contact_name: contactName.trim() || undefined,
        phone: phone.trim() || undefined,
        payment_term_days: parseInt(termDays) || 0,
      });
      // Re-fetch list to retrieve the just-created supplier with its id
      const updated = await supplierService.fetchAll();
      const created = updated.find(s => s.name === name.trim());
      if (created) {
        onSaved(created);
        showToast('Supplier ditambahkan & dipakai untuk PO ini.', 'success');
      } else {
        showToast('Supplier disimpan tapi tidak ditemukan. Refresh halaman.', 'warning');
      }
    } catch (e: any) {
      console.error('Inline supplier save error:', e);
      showToast(e?.message ?? 'Gagal menyimpan supplier.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">
            <Plus className="w-4 h-4" />
          </div>
          <h4 className="text-sm font-bold text-indigo-700">Tambah Supplier Baru</h4>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-white"
        >
          <X className="w-3.5 h-3.5" /> Batal
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">
            Nama Supplier <span className="text-rose-500">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="PT Schneider Elektrik"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white placeholder-gray-400"
          />
          {prefillName && (
            <p className="text-[10px] text-emerald-600 mt-0.5">✓ Diisi dari pencarian</p>
          )}
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Nama Kontak</label>
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Budi Santoso"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white placeholder-gray-400"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Nomor HP / WA</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0812-xxxx-xxxx"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white placeholder-gray-400"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 block mb-1">Term Pembayaran (hari)</label>
          <input
            type="number"
            min="0"
            value={termDays}
            onChange={(e) => setTermDays(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
          />
          <p className="text-[10px] text-gray-500 mt-0.5">0 = Cash. 30 = Net 30 hari.</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-indigo-100">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-sm font-semibold text-gray-600 px-3 py-1.5 rounded-lg hover:bg-white disabled:opacity-50"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="text-sm font-semibold text-white bg-indigo-600 px-4 py-1.5 rounded-lg hover:bg-indigo-700 shadow-sm shadow-indigo-200 disabled:opacity-50"
        >
          {saving ? 'Menyimpan...' : 'Simpan & Pakai'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5.2: Compile check**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run lint
```

Expected: zero errors.

- [ ] **Step 5.3: Commit**

```bash
git add src/components/pembelian/form/InlineSupplierForm.tsx
git commit -m "$(cat <<'EOF'
feat(po-page): InlineSupplierForm — create supplier without leaving PO

Border-dashed indigo block with 4 fields (name/contact/HP/term).
Same data model as SupplierModal. Prefill name from picker search.
On save: upserts, re-fetches list, finds by name, returns to parent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `StockPicker` component (extract from modal)

**Files:**
- Create: `src/components/pembelian/form/StockPicker.tsx`

- [ ] **Step 6.1: Write component**

Create `src/components/pembelian/form/StockPicker.tsx`:

```tsx
import React, { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { StockItem } from '../../../types';

interface StockPickerProps {
  stockList: StockItem[];
  onPick: (stock: StockItem) => void;
  placeholder?: string;
}

export default function StockPicker({ stockList, onPick, placeholder }: StockPickerProps) {
  const [search, setSearch] = useState('');

  const suggestions = useMemo(() => {
    if (search.length === 0) return [];
    const q = search.toLowerCase();
    return stockList
      .filter(s => s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [stockList, search]);

  function handlePick(stock: StockItem) {
    onPick(stock);
    setSearch('');
  }

  return (
    <div className="relative">
      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        placeholder={placeholder ?? 'Cari produk untuk tambah...'}
      />
      {suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 overflow-hidden">
          {suggestions.map(s => (
            <button
              key={s.sku}
              type="button"
              onClick={() => handlePick(s)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-indigo-50 text-left border-b border-gray-100 last:border-b-0"
            >
              <span className="font-semibold text-gray-800">{s.name}</span>
              <span className="font-mono text-gray-400">{s.sku}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6.2: Compile check**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run lint
```

Expected: zero errors.

- [ ] **Step 6.3: Commit**

```bash
git add src/components/pembelian/form/StockPicker.tsx
git commit -m "$(cat <<'EOF'
feat(po-page): StockPicker — search input for adding items

Extracted from PurchaseOrderModal logic. Reusable: search by SKU or
name, show top 6 suggestions, callback onPick. Self-contained state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `ItemRow` component

**Files:**
- Create: `src/components/pembelian/form/ItemRow.tsx`

- [ ] **Step 7.1: Write component**

Create `src/components/pembelian/form/ItemRow.tsx`:

```tsx
import React from 'react';
import { Trash2 } from 'lucide-react';
import { PoItemDraft } from '../../../lib/pembelianService';

interface ItemRowProps {
  item: PoItemDraft;
  onChange: (patch: Partial<PoItemDraft>) => void;
  onRemove: () => void;
}

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

export default function ItemRow({ item, onChange, onRemove }: ItemRowProps) {
  function updateQty(value: string) {
    const qty = parseFloat(value) || 0;
    onChange({ qty, subtotal: qty * item.unit_cost });
  }

  function updateUnitCost(value: string) {
    const unit_cost = parseFloat(value) || 0;
    onChange({ unit_cost, subtotal: item.qty * unit_cost });
  }

  return (
    <div className="grid grid-cols-12 px-5 py-3 border-b border-gray-100 items-center hover:bg-gray-50">
      <span className="col-span-2 font-mono text-xs text-gray-500">{item.sku}</span>
      <span className="col-span-4 text-sm font-semibold text-gray-800">{item.product_name}</span>
      <div className="col-span-2 flex justify-center">
        <input
          type="number"
          min="1"
          value={item.qty}
          onChange={(e) => updateQty(e.target.value)}
          className="w-16 text-center text-sm font-semibold border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>
      <div className="col-span-2 flex justify-end">
        <div className="relative w-32">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">Rp</span>
          <input
            type="number"
            min="0"
            value={item.unit_cost || ''}
            onChange={(e) => updateUnitCost(e.target.value)}
            placeholder="0"
            className="w-full text-right text-sm border border-gray-200 rounded-lg pl-7 pr-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      </div>
      <span className="col-span-1 text-right text-sm font-bold text-gray-800">
        {formatRupiah(item.subtotal)}
      </span>
      <div className="col-span-1 flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="text-rose-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7.2: Compile check**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run lint
```

Expected: zero errors.

- [ ] **Step 7.3: Commit**

```bash
git add src/components/pembelian/form/ItemRow.tsx
git commit -m "$(cat <<'EOF'
feat(po-page): ItemRow — inline-editable item with qty/price

12-col grid row matching items table layout. Inline edit qty + unit_cost,
auto-recompute subtotal. Delete button on right. Self-contained.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Orchestrator + Wiring

### Task 8: `PurchaseOrderFormPage` orchestrator

**Files:**
- Create: `src/components/pembelian/PurchaseOrderFormPage.tsx`

- [ ] **Step 8.1: Write component**

Create `src/components/pembelian/PurchaseOrderFormPage.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import { DbPurchaseOrder, DbSupplier, StockItem, PermissionSet } from '../../types';
import { purchaseOrderService, PoItemDraft } from '../../lib/pembelianService';
import SupplierPicker from './form/SupplierPicker';
import InlineSupplierForm from './form/InlineSupplierForm';
import StockPicker from './form/StockPicker';
import ItemRow from './form/ItemRow';

interface PurchaseOrderFormPageProps {
  po?: DbPurchaseOrder;                     // undefined = create, defined = edit
  suppliers: DbSupplier[];
  orders: DbPurchaseOrder[];                // for SupplierPicker usage-count sort
  stockList: StockItem[];
  currentUserId?: string;                   // for created_by/updated_by audit
  currentUserPermissions?: PermissionSet;
  onBack: () => void;
  onSaved: (status: 'DRAFT' | 'ORDERED') => void;
  onSupplierAdded: () => void;              // trigger PembelianScreen.reload() after inline create
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

function isPastDate(iso: string): boolean {
  if (!iso) return false;
  return iso < new Date().toISOString().slice(0, 10);
}

export default function PurchaseOrderFormPage({
  po, suppliers, orders, stockList,
  currentUserId, currentUserPermissions,
  onBack, onSaved, onSupplierAdded, showToast,
}: PurchaseOrderFormPageProps) {
  const isEdit = !!po;
  const canAct = isEdit
    ? currentUserPermissions?.can_edit_po !== false
    : currentUserPermissions?.can_create_po !== false;

  // Permission gate: redirect if denied
  useEffect(() => {
    if (!canAct) {
      showToast(`Anda tidak punya akses untuk ${isEdit ? 'edit' : 'membuat'} PO.`, 'warning');
      onBack();
    }
  }, [canAct, isEdit]);

  const [supplierId, setSupplierId] = useState(po?.supplier_id ?? '');
  const [expectedReceiveDate, setExpectedReceiveDate] = useState(po?.expected_receive_date ?? '');
  const [notes, setNotes] = useState(po?.notes ?? '');
  const [taxEnabled, setTaxEnabled] = useState((po?.tax_rate ?? 0) > 0);
  const [taxRate, setTaxRate] = useState(String(((po?.tax_rate ?? 0) * 100) || 11));
  const [items, setItems] = useState<PoItemDraft[]>(
    po?.items?.map(i => ({
      sku: i.sku, product_name: i.product_name,
      qty: i.qty, unit_cost: i.unit_cost, subtotal: i.subtotal,
    })) ?? []
  );
  const [showInlineSupplier, setShowInlineSupplier] = useState(false);
  const [inlineSupplierPrefill, setInlineSupplierPrefill] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedSupplier = suppliers.find(s => s.id === supplierId);
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const taxAmount = taxEnabled ? subtotal * (parseFloat(taxRate) / 100 || 0) : 0;
  const total = subtotal + taxAmount;

  function markDirty() { if (!isDirty) setIsDirty(true); }

  function handleSupplierSelect(s: DbSupplier) {
    setSupplierId(s.id);
    markDirty();
  }

  function handleSupplierCreateNew(prefilledName: string) {
    setInlineSupplierPrefill(prefilledName);
    setShowInlineSupplier(true);
  }

  function handleSupplierInlineSaved(newSupplier: DbSupplier) {
    setSupplierId(newSupplier.id);
    setShowInlineSupplier(false);
    setInlineSupplierPrefill('');
    onSupplierAdded();
    markDirty();
  }

  function handleAddItem(stock: StockItem) {
    if (items.some(i => i.sku === stock.sku)) {
      showToast(`Produk ${stock.sku} sudah ada di list. Update qty-nya.`, 'info');
      return;
    }
    setItems(prev => [...prev, { sku: stock.sku, product_name: stock.name, qty: 1, unit_cost: 0, subtotal: 0 }]);
    markDirty();
  }

  function handleItemChange(index: number, patch: Partial<PoItemDraft>) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item));
    markDirty();
  }

  function handleItemRemove(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index));
    markDirty();
  }

  function validate(): string | null {
    if (!supplierId) return 'Pilih supplier terlebih dahulu.';
    if (items.length === 0) return 'Tambahkan minimal satu item.';
    if (items.some(i => i.qty <= 0 || i.unit_cost <= 0)) return 'Qty dan harga beli harus lebih dari 0.';
    return null;
  }

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
        items,
      };
      if (po) {
        await purchaseOrderService.update(po.id, {
          ...payload,
          updated_by_user_id: currentUserId ?? null,
        });
        if (status === 'ORDERED' && po.status === 'DRAFT') {
          await purchaseOrderService.markOrdered(po.id);
        }
      } else {
        await purchaseOrderService.create({
          ...payload,
          status,
          created_by_user_id: currentUserId ?? null,
        });
      }
      setIsDirty(false);
      showToast(
        po ? 'PO diperbarui.' : `PO dibuat — status: ${status === 'DRAFT' ? 'Draft' : 'Dipesan'}.`,
        'success'
      );
      onSaved(status);
    } catch (e: any) {
      console.error('Save PO error:', e);
      showToast(e?.message ?? 'Gagal menyimpan PO.', 'warning');
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    if (isDirty && !confirm('Perubahan belum disimpan. Yakin keluar?')) return;
    onBack();
  }

  return (
    <div className="space-y-5">
      {/* Sub-page header */}
      <div className="bg-white border border-gray-200 rounded-xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-indigo-600 -ml-2 px-2 py-1 rounded-lg hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali
          </button>
          <div className="h-5 w-px bg-gray-200" />
          <h2 className="text-base font-bold text-gray-900">
            {isEdit ? `Edit ${po!.po_number}` : 'Buat Purchase Order'}
          </h2>
        </div>
        {isDirty && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
            ● Belum disimpan
          </span>
        )}
      </div>

      {/* Section: Detail PO */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 bg-indigo-500 rounded-full" />
          <h3 className="text-sm font-bold text-gray-900">Detail PO</h3>
        </div>
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-5">
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">
              Supplier <span className="text-rose-500">*</span>
            </label>
            {showInlineSupplier ? (
              <InlineSupplierForm
                prefillName={inlineSupplierPrefill}
                onSaved={handleSupplierInlineSaved}
                onCancel={() => { setShowInlineSupplier(false); setInlineSupplierPrefill(''); }}
                showToast={showToast}
              />
            ) : (
              <SupplierPicker
                suppliers={suppliers}
                orders={orders}
                selectedSupplierId={supplierId}
                onSelect={handleSupplierSelect}
                onCreateNew={handleSupplierCreateNew}
              />
            )}
          </div>
          <div className="col-span-3">
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Tgl Diterima Diharapkan</label>
            <div className="relative">
              <input
                type="date"
                value={expectedReceiveDate}
                onChange={(e) => { setExpectedReceiveDate(e.target.value); markDirty(); }}
                className={`w-full text-sm border rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 ${
                  isPastDate(expectedReceiveDate)
                    ? 'border-amber-300 bg-amber-50/30 focus:ring-amber-300'
                    : expectedReceiveDate
                      ? 'border-emerald-300 bg-emerald-50/30 focus:ring-emerald-300'
                      : 'border-gray-200 focus:ring-indigo-300'
                }`}
              />
            </div>
            {expectedReceiveDate && isPastDate(expectedReceiveDate) ? (
              <p className="text-[10px] text-amber-700 font-semibold mt-1">⚠ Tanggal sudah lewat. Boleh disimpan, jadi acuan delay.</p>
            ) : (
              <p className="text-[10px] text-gray-400 mt-1">Optional · Kosongkan jika belum pasti</p>
            )}
          </div>
          <div className="col-span-4">
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Catatan untuk Supplier</label>
            <input
              value={notes}
              onChange={(e) => { setNotes(e.target.value); markDirty(); }}
              placeholder="(opsional)"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder-gray-400"
            />
          </div>
        </div>
      </section>

      {/* Section: Items */}
      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-indigo-500 rounded-full" />
            <h3 className="text-sm font-bold text-gray-900">Items Pembelian</h3>
            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
              {items.length} item
            </span>
          </div>
          <div className="w-72">
            <StockPicker stockList={stockList} onPick={handleAddItem} />
          </div>
        </div>

        <div className="grid grid-cols-12 px-5 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
          <span className="col-span-2">SKU</span>
          <span className="col-span-4">Nama Produk</span>
          <span className="col-span-2 text-center">Qty</span>
          <span className="col-span-2 text-right">Harga Beli</span>
          <span className="col-span-1 text-right">Subtotal</span>
          <span className="col-span-1" />
        </div>

        {items.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            Cari produk di kolom atas untuk mulai menambah item.
          </div>
        ) : (
          items.map((item, i) => (
            <ItemRow
              key={`${item.sku}-${i}`}
              item={item}
              onChange={(patch) => handleItemChange(i, patch)}
              onRemove={() => handleItemRemove(i)}
            />
          ))
        )}
      </section>

      {/* Section: Totals */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 bg-indigo-500 rounded-full" />
          <h3 className="text-sm font-bold text-gray-900">Ringkasan Biaya</h3>
        </div>
        <div className="flex justify-end">
          <div className="w-80 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span className="font-semibold text-gray-800">{formatRupiah(subtotal)}</span>
            </div>
            <div className="flex justify-between text-gray-600 items-center">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={taxEnabled}
                  onChange={(e) => { setTaxEnabled(e.target.checked); markDirty(); }}
                  className="accent-indigo-600 w-3.5 h-3.5"
                />
                PPN
                <input
                  type="number"
                  value={taxRate}
                  onChange={(e) => { setTaxRate(e.target.value); markDirty(); }}
                  disabled={!taxEnabled}
                  className="w-10 text-center text-xs border border-gray-200 rounded px-1 py-0.5 disabled:opacity-40"
                />%
              </span>
              <span className="font-semibold text-gray-800">{taxEnabled ? formatRupiah(taxAmount) : '—'}</span>
            </div>
            <div className="border-t-2 border-gray-200 pt-2 flex justify-between items-baseline">
              <span className="text-sm font-bold text-gray-900">Total</span>
              <span className="text-xl font-extrabold text-indigo-600">{formatRupiah(total)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Sticky footer actions */}
      <div className="bg-white border border-gray-200 rounded-xl px-6 py-4 flex items-center justify-between sticky bottom-0 shadow-lg shadow-gray-200/40">
        <p className="text-xs text-gray-400">
          Total <span className="font-bold text-gray-700">{items.length} item</span>
          {' · '}
          <span className="font-bold text-gray-700">{formatRupiah(total)}</span>
        </p>
        <div className="flex gap-2">
          {/* PDF button only available after PO is ORDERED (in detail view) */}
          {isEdit && po!.status !== 'DRAFT' && (
            <span className="text-[11px] text-gray-400 self-center mr-2">
              <FileText className="w-3 h-3 inline mr-1" />
              Download PDF di halaman detail PO
            </span>
          )}
          <button
            type="button"
            onClick={() => handleSave('DRAFT')}
            disabled={saving}
            className="text-sm font-semibold text-gray-700 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-100 disabled:opacity-50"
          >
            Simpan Draft
          </button>
          <button
            type="button"
            onClick={() => handleSave('ORDERED')}
            disabled={saving}
            className="text-sm font-semibold text-white bg-indigo-600 px-5 py-2 rounded-lg hover:bg-indigo-700 shadow-sm shadow-indigo-200 disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Simpan & Pesan'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8.2: Compile check**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run lint
```

Expected: zero errors.

- [ ] **Step 8.3: Commit**

```bash
git add src/components/pembelian/PurchaseOrderFormPage.tsx
git commit -m "$(cat <<'EOF'
feat(po-page): PurchaseOrderFormPage orchestrator

Full-page form for Create/Edit PO. 3 sections (Detail PO / Items / Totals)
+ sticky footer actions. Wires SupplierPicker, InlineSupplierForm,
StockPicker, ItemRow. Permission gate (can_create_po / can_edit_po),
audit fields (created_by_user_id / updated_by_user_id), expected
receive date with past-date warning, unsaved changes confirm on back.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Wire `PembelianScreen` sub-view + delete `PurchaseOrderModal`

**Files:**
- Modify: `src/components/PembelianScreen.tsx`
- Delete: `src/components/pembelian/PurchaseOrderModal.tsx`
- Modify: `src/App.tsx` (pass currentUser id + permissions to PembelianScreen)

- [ ] **Step 9.1: Update `PembelianScreen` props interface and imports**

Edit `src/components/PembelianScreen.tsx` lines 1-21. Replace imports + interface block:

```tsx
import React, { useState, useEffect } from 'react';
import { ShoppingCart } from 'lucide-react';
import { StockItem, PermissionSet } from '../types';
import { purchaseOrderService, supplierService } from '../lib/pembelianService';
import type { DbPurchaseOrder, DbPurchaseOrderItem, DbSupplier } from '../types';
import { isSupabaseConfigured } from '../lib/supabaseClient';
import SupplierModal from './pembelian/SupplierModal';
import ReceiveGoodsModal from './pembelian/ReceiveGoodsModal';
import PoDetailView from './pembelian/PoDetailView';
import MarkAsPaidModal from './pembelian/MarkAsPaidModal';
import ReceiveReplacementModal from './pembelian/ReceiveReplacementModal';
import PurchaseOrderFormPage from './pembelian/PurchaseOrderFormPage';

interface PembelianScreenProps {
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onStockRefresh: () => void;
  currentUserId?: string;
  currentUserPermissions?: PermissionSet;
}

type Tab = 'orders' | 'suppliers';
type ViewMode = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; po: DbPurchaseOrder };
```

Note: `PurchaseOrderModal` import is removed; `PurchaseOrderFormPage` import added.

- [ ] **Step 9.2: Add `viewMode` state in main component**

Edit `src/components/PembelianScreen.tsx` lines 39-46 (the component body). Add `viewMode` state and update props destructure:

```tsx
export default function PembelianScreen({
  stockList, showToast, onStockRefresh, currentUserId, currentUserPermissions,
}: PembelianScreenProps) {
  const [tab, setTab] = useState<Tab>('orders');
  const [orders, setOrders] = useState<DbPurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<DbSupplier[]>([]);
  const [summary, setSummary] = useState({ totalMtd: 0, dueMtd: 0, overdueAmount: 0, countMtd: 0 });
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>({ kind: 'list' });
  // ... rest unchanged
```

- [ ] **Step 9.3: Update render: swap list vs form page**

Edit `src/components/PembelianScreen.tsx` lines 67-141 (the JSX return). Replace:

```tsx
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
        ... (4 summary cards) ...

        {/* Tabs */}
        ... (Purchase Orders / Supplier) ...

        {loading ? (...) : tab === 'orders' ? (
          <OrdersTab ... />
        ) : (
          <SuppliersTab ... />
        )}
      </div>
    </div>
  );
}
```

with:

```tsx
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
        {viewMode.kind !== 'list' ? (
          <PurchaseOrderFormPage
            po={viewMode.kind === 'edit' ? viewMode.po : undefined}
            suppliers={suppliers}
            orders={orders}
            stockList={stockList}
            currentUserId={currentUserId}
            currentUserPermissions={currentUserPermissions}
            onBack={() => setViewMode({ kind: 'list' })}
            onSaved={(status) => {
              reload();
              // Draft: stay on page (allow continued editing). Ordered: back to list.
              if (status === 'ORDERED') setViewMode({ kind: 'list' });
            }}
            onSupplierAdded={reload}
            showToast={showToast}
          />
        ) : (
          <>
            {/* Summary cards (same as before — keep existing markup) */}
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
                <p className="text-xs text-rose-600 font-medium uppercase tracking-wide">Terlambat Bayar</p>
                <p className="text-2xl font-bold text-rose-700 mt-1">{formatRupiah(summary.overdueAmount)}</p>
                <p className="text-xs text-rose-400 mt-1">melewati jatuh tempo, belum lunas</p>
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
                onStockRefresh={onStockRefresh}
                onCreate={() => setViewMode({ kind: 'create' })}
                onEdit={(po) => setViewMode({ kind: 'edit', po })}
              />
            ) : (
              <SuppliersTab
                suppliers={suppliers}
                showToast={showToast}
                onRefresh={reload}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9.4: Update `OrdersTab` to accept onCreate/onEdit callbacks**

Edit `src/components/PembelianScreen.tsx` lines 145-152. Replace `OrdersTabProps`:

```tsx
interface OrdersTabProps {
  orders: DbPurchaseOrder[];
  suppliers: DbSupplier[];
  stockList: StockItem[];
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onRefresh: () => void;
  onStockRefresh: () => void;
  onCreate: () => void;
  onEdit: (po: DbPurchaseOrder) => void;
}
```

Then in the `OrdersTab` function body lines 154-162, remove the create/edit modal states:

```tsx
function OrdersTab({ orders, suppliers, stockList, showToast, onRefresh, onStockRefresh, onCreate, onEdit }: OrdersTabProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [receivePo, setReceivePo] = useState<DbPurchaseOrder | null>(null);
  const [payPo, setPayPo] = useState<DbPurchaseOrder | null>(null);
  const [detailPo, setDetailPo] = useState<DbPurchaseOrder | null>(null);
  const [replaceItem, setReplaceItem] = useState<DbPurchaseOrderItem | null>(null);
  // Removed: showCreateModal, editPo (handled in parent viewMode)
```

- [ ] **Step 9.5: Replace "Buat PO Baru" button onClick**

Edit `src/components/PembelianScreen.tsx` line 232. Replace:

```tsx
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700"
          >
            Buat PO Baru
          </button>
```

with:

```tsx
          <button
            onClick={onCreate}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-indigo-700"
          >
            Buat PO Baru
          </button>
```

- [ ] **Step 9.6: Replace Edit button onClick**

Edit `src/components/PembelianScreen.tsx` line 282. Replace:

```tsx
                      <button onClick={() => setEditPo(po)} className="text-xs text-gray-600 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
```

with:

```tsx
                      <button onClick={() => onEdit(po)} className="text-xs text-gray-600 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
```

- [ ] **Step 9.7: Remove old `PurchaseOrderModal` conditional render**

Edit `src/components/PembelianScreen.tsx` lines 300-310. Delete the entire block:

```tsx
      {/* Modals — wired in Tasks 8-11 */}
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

The opening `<>` fragment and remaining modals (ReceiveGoods, PoDetail, MarkAsPaid, ReceiveReplacement) stay.

- [ ] **Step 9.8: Delete `PurchaseOrderModal.tsx`**

```bash
rm /Users/tonywei/IdeaProjects/ERPAntigravity/src/components/pembelian/PurchaseOrderModal.tsx
```

- [ ] **Step 9.9: Pass currentUser props from App.tsx**

Edit `src/App.tsx`. Find the line that renders `<PembelianScreen ... />` (search for `<PembelianScreen`). Add 2 props:

```tsx
        <PembelianScreen
          stockList={stockList}
          showToast={showToast}
          onStockRefresh={loadStockFromSupabase}
          currentUserId={currentUser?.id}
          currentUserPermissions={currentUser?.permissions}
        />
```

Note: `currentUser` shape per `App.tsx:50` is `{ name; role; permissions; avatarUrl; storeName }` — it does NOT have `id`. We need to add `id` to `currentUser` shape:
- Edit `App.tsx:50` — add `id: string` to the destructured state shape.
- Edit `App.tsx:74-80` — add `id: user.id,` to the `setCurrentUser({...})` call (using `session.user.id` from Supabase Auth).

Concrete diff for `App.tsx:48-83`:

```tsx
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string } | null>(null);

  // ... existing stockList / config / toast state ...

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !currentUser) {
        const user = session.user;
        setCurrentUser({
          id: user.id,
          name: user.user_metadata?.full_name ?? (user.email?.split('@')[0] ?? 'User'),
          role: 'Owner',
          permissions: ALL_PERMISSIONS,
          avatarUrl: user.user_metadata?.avatar_url ?? '',
          storeName: user.user_metadata?.store_name ?? '',
        });
        setActivePage('dashboard');
      }
    });
    // ... rest unchanged
```

- [ ] **Step 9.10: Compile check**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run lint
```

Expected: zero errors. Will surface any callsites of `currentUser.id` that need updating.

- [ ] **Step 9.11: Manual smoke test**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run dev
```

Buka `http://localhost:3000`, login, ke menu **Pembelian**. Verifikasi:
- ✅ List PO tampil normal (tidak ada regresi)
- ✅ Klik "Buat PO Baru" → swap ke `PurchaseOrderFormPage` (sub-page header dengan "← Kembali")
- ✅ Klik "← Kembali" (form belum diisi, tidak dirty) → langsung ke list
- ✅ Klik supplier field → dropdown buka, lihat 4 state (kosong/sering-dipakai/typing-match/typing-no-match)
- ✅ Pilih supplier existing → field collapsed, tombol "Ganti" muncul
- ✅ Klik "Buat baru" → InlineSupplierForm muncul → isi nama + Save → supplier baru muncul + ter-set
- ✅ Cari stock di kolom kanan-atas section Items → klik suggestion → row muncul, edit qty + harga → subtotal recompute
- ✅ Pilih tanggal masa lalu → border amber + warning hint
- ✅ Klik "Simpan Draft" → toast "PO dibuat — status: Draft", masih di page
- ✅ Klik "Kembali" (sekarang dirty) → confirm dialog muncul; OK → ke list, Draft baru tampil
- ✅ Klik "Edit" pada Draft baru → swap ke form dengan data prefilled
- ✅ Klik "Simpan & Pesan" → toast, kembali ke list, status = "Dipesan"

- [ ] **Step 9.12: Commit**

```bash
git add src/components/PembelianScreen.tsx src/App.tsx
git rm src/components/pembelian/PurchaseOrderModal.tsx
git commit -m "$(cat <<'EOF'
feat(po-page): wire sub-view in PembelianScreen + delete modal

PembelianScreen renders PurchaseOrderFormPage when viewMode != 'list'.
OrdersTab gets onCreate/onEdit callbacks (state pulled up to parent).
App.tsx now passes currentUser.id + permissions for audit + permission gate.
PurchaseOrderModal.tsx deleted — replaced entirely by FormPage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — PDF

### Task 10: `purchaseOrderPdf.ts` — PDF rendering library

**Files:**
- Create: `src/lib/pdf/purchaseOrderPdf.ts`

- [ ] **Step 10.1: Create directory**

```bash
mkdir -p /Users/tonywei/IdeaProjects/ERPAntigravity/src/lib/pdf
```

- [ ] **Step 10.2: Write PDF generator**

Create `src/lib/pdf/purchaseOrderPdf.ts`:

```ts
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DbPurchaseOrder, DbPurchaseOrderItem, DbSupplier, DbCompanySettings } from '../../types';

interface GeneratePoPdfArgs {
  po: DbPurchaseOrder;
  supplier: DbSupplier;
  items: DbPurchaseOrderItem[];
  companySettings: DbCompanySettings | null;
  createdByName: string;
}

const BRAND_EMERALD = '#2d8a4e';
const TEXT_DARK = '#111827';
const TEXT_MUTED = '#6b7280';
const AMBER_BG = '#fef3c7';
const AMBER_TEXT = '#92400e';

function formatRupiah(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

function formatDateID(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function generatePoPdf(args: GeneratePoPdfArgs): Blob {
  const { po, supplier, items, companySettings, createdByName } = args;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  // ====== HEADER ======
  // Brand emerald box with Zap-like lightning bolt (drawn manually with lines)
  doc.setFillColor(BRAND_EMERALD);
  doc.roundedRect(margin, margin, 36, 36, 6, 6, 'F');
  doc.setDrawColor(255, 255, 255);
  doc.setFillColor(255, 255, 255);
  // Lightning bolt shape: simplified polygon
  const cx = margin + 18;
  const cy = margin + 18;
  doc.triangle(cx - 4, cy - 10, cx + 6, cy - 2, cx - 2, cy - 2, 'F');
  doc.triangle(cx + 2, cy + 2, cx - 6, cy + 10, cx + 4, cy + 2, 'F');

  // Company name + tagline
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(TEXT_DARK);
  const companyName = companySettings?.company_name ?? 'Garindo Jaya Panel';
  doc.text(companyName, margin + 48, margin + 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(BRAND_EMERALD);
  doc.text('MSME ERP SUITE', margin + 48, margin + 28);

  // Address + phone + email (3 lines)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  let infoY = margin + 42;
  if (companySettings?.address) {
    doc.text(companySettings.address, margin + 48, infoY);
    infoY += 11;
  }
  const contactParts: string[] = [];
  if (companySettings?.phone) contactParts.push(companySettings.phone);
  if (companySettings?.email) contactParts.push(companySettings.email);
  if (contactParts.length > 0) {
    doc.text(contactParts.join(' · '), margin + 48, infoY);
  }

  // Right side: PURCHASE ORDER + po_number
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(TEXT_DARK);
  doc.text('PURCHASE ORDER', pageWidth - margin, margin + 18, { align: 'right' });
  doc.setFont('courier', 'bold');
  doc.setFontSize(11);
  doc.text(po.po_number, pageWidth - margin, margin + 34, { align: 'right' });

  // Divider line under header
  doc.setDrawColor(TEXT_DARK);
  doc.setLineWidth(1.5);
  doc.line(margin, margin + 76, pageWidth - margin, margin + 76);

  // ====== TWO-COLUMN INFO ======
  const blockY = margin + 92;
  const colWidth = (pageWidth - margin * 2 - 20) / 2;

  // Left: Kepada
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('KEPADA', margin, blockY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(TEXT_DARK);
  doc.text(supplier.name, margin, blockY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  const supplierLines: string[] = [];
  if (supplier.contact_name) supplierLines.push(`Kontak: ${supplier.contact_name}`);
  if (supplier.phone) supplierLines.push(`HP/WA: ${supplier.phone}`);
  supplierLines.push(`Term: ${supplier.payment_term_days === 0 ? 'Cash' : `Net ${supplier.payment_term_days} hari`}`);
  supplierLines.forEach((line, i) => {
    doc.text(line, margin, blockY + 26 + i * 11);
  });

  // Right: Detail PO
  const rightX = margin + colWidth + 20;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text('DETAIL PO', rightX, blockY);

  // Table rows manually
  const detailRows = [
    { label: 'Tgl Pesan', value: formatDateID(po.ordered_at ?? po.created_at), highlight: false },
    { label: 'Diterima paling lambat', value: formatDateID(po.expected_receive_date), highlight: !!po.expected_receive_date },
    { label: 'Dibuat oleh', value: createdByName, highlight: false },
  ];
  let detailY = blockY + 14;
  detailRows.forEach((r) => {
    if (r.highlight) {
      doc.setFillColor(AMBER_BG);
      doc.rect(rightX - 4, detailY - 9, colWidth + 8, 14, 'F');
      doc.setTextColor(AMBER_TEXT);
      doc.setFont('helvetica', 'bold');
    } else {
      doc.setTextColor(TEXT_MUTED);
      doc.setFont('helvetica', 'normal');
    }
    doc.setFontSize(9);
    doc.text(r.label, rightX, detailY);
    doc.setFont('helvetica', 'bold');
    if (!r.highlight) doc.setTextColor(TEXT_DARK);
    doc.text(r.value, rightX + colWidth, detailY, { align: 'right' });
    detailY += 14;
  });

  // ====== ITEMS TABLE via autoTable ======
  const tableStartY = blockY + 90;
  autoTable(doc, {
    startY: tableStartY,
    head: [['No', 'SKU', 'Nama Produk', 'Qty', 'Harga', 'Subtotal']],
    body: items.map((item, i) => [
      String(i + 1),
      item.sku,
      item.product_name,
      String(item.qty),
      Math.round(item.unit_cost).toLocaleString('id-ID'),
      Math.round(item.subtotal).toLocaleString('id-ID'),
    ]),
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 6, textColor: TEXT_DARK, lineColor: '#e5e7eb', lineWidth: 0.5 },
    headStyles: { fillColor: '#f3f4f6', textColor: TEXT_MUTED, fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { halign: 'left', cellWidth: 26 },
      1: { halign: 'left', cellWidth: 80, font: 'courier' },
      2: { halign: 'left' },
      3: { halign: 'center', cellWidth: 40 },
      4: { halign: 'right', cellWidth: 70 },
      5: { halign: 'right', cellWidth: 80 },
    },
    margin: { left: margin, right: margin },
  });

  // ====== TOTALS ======
  let yAfterTable = (doc as any).lastAutoTable.finalY + 12;
  const totalsLabelX = pageWidth - margin - 160;
  const totalsValueX = pageWidth - margin;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Subtotal', totalsLabelX, yAfterTable);
  doc.setTextColor(TEXT_DARK);
  doc.text(formatRupiah(po.subtotal), totalsValueX, yAfterTable, { align: 'right' });
  yAfterTable += 14;

  if (po.tax_rate > 0) {
    doc.setTextColor(TEXT_MUTED);
    doc.text(`PPN ${(po.tax_rate * 100).toFixed(0)}%`, totalsLabelX, yAfterTable);
    doc.setTextColor(TEXT_DARK);
    doc.text(formatRupiah(po.tax_amount), totalsValueX, yAfterTable, { align: 'right' });
    yAfterTable += 14;
  }

  // Total line (bold border-top)
  doc.setDrawColor(TEXT_DARK);
  doc.setLineWidth(1.5);
  doc.line(totalsLabelX, yAfterTable - 5, totalsValueX, yAfterTable - 5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL', totalsLabelX, yAfterTable + 8);
  doc.setFontSize(13);
  doc.text(formatRupiah(po.total), totalsValueX, yAfterTable + 8, { align: 'right' });
  yAfterTable += 24;

  // ====== NOTES ======
  if (po.notes) {
    yAfterTable += 12;
    doc.setDrawColor('#e5e7eb');
    doc.setLineWidth(0.5);
    doc.line(margin, yAfterTable, pageWidth - margin, yAfterTable);
    yAfterTable += 12;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(TEXT_MUTED);
    doc.text('CATATAN', margin, yAfterTable);
    yAfterTable += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(TEXT_DARK);
    const noteLines = doc.splitTextToSize(po.notes, pageWidth - margin * 2);
    doc.text(noteLines, margin, yAfterTable);
    yAfterTable += noteLines.length * 12;
  }

  // ====== FOOTER T&C ======
  const footerY = doc.internal.pageSize.getHeight() - margin;
  doc.setDrawColor('#d1d5db');
  doc.setLineWidth(0.5);
  doc.line(margin, footerY - 14, pageWidth - margin, footerY - 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED);
  doc.text(
    'Barang yang dikirim wajib sesuai spesifikasi PO. Konfirmasi penerimaan via WA dalam 1×24 jam.',
    pageWidth / 2,
    footerY - 2,
    { align: 'center' }
  );

  return doc.output('blob');
}
```

- [ ] **Step 10.3: Compile check**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run lint
```

Expected: zero errors.

- [ ] **Step 10.4: Commit**

```bash
git add src/lib/pdf/purchaseOrderPdf.ts
git commit -m "$(cat <<'EOF'
feat(po-pdf): PDF rendering library — generatePoPdf()

jsPDF + autotable. Branded header (emerald Zap box + Garindo Jaya Panel
+ MSME ERP SUITE tagline + address/phone/email from company_settings).
Two-column info (Kepada + Detail PO with highlighted "Diterima paling
lambat" row). Items autotable with mono SKU. Totals with bold border.
Optional notes section. Footer T&C 1×24 jam.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Download PDF button in `PoDetailView`

**Files:**
- Modify: `src/components/pembelian/PoDetailView.tsx:1-15` (imports + props)
- Modify: `src/components/pembelian/PoDetailView.tsx` (add handler + button)

- [ ] **Step 11.1: Add imports**

Edit `src/components/pembelian/PoDetailView.tsx` lines 1-5. Add `FileText` to lucide-react import, add admin user fetch + PDF lib:

```tsx
import React, { useState, useEffect } from 'react';
import { X, Printer, FileText } from 'lucide-react';
import { DbPurchaseOrder, DbPurchaseOrderItem, StockItem, DbCompanySettings } from '../../types';
import { purchaseOrderService } from '../../lib/pembelianService';
import { companySettingsService, adminUsersService } from '../../lib/supabaseClient';
import { generatePoPdf } from '../../lib/pdf/purchaseOrderPdf';
```

- [ ] **Step 11.2: Add PDF download handler in component**

Edit `src/components/pembelian/PoDetailView.tsx`. Add new state + handler near top of component body (after existing `useState`/`useEffect`):

```tsx
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [companySettings, setCompanySettings] = useState<DbCompanySettings | null>(null);

  useEffect(() => {
    companySettingsService.fetch().then(s => setCompanySettings(s)).catch(() => {});
  }, []);

  async function handleDownloadPdf() {
    if (downloadingPdf) return;
    if (!po.supplier) {
      showToast('Data supplier tidak lengkap. Reload halaman.', 'warning');
      return;
    }
    if (!companySettings?.address || !companySettings?.phone) {
      const proceed = confirm(
        'Alamat atau nomor telepon toko belum diisi di Pengaturan. ' +
        'PDF akan tampil tanpa info tersebut. Tetap generate?'
      );
      if (!proceed) return;
    }
    setDownloadingPdf(true);
    try {
      let createdByName = '—';
      if (po.created_by_user_id) {
        try {
          const admins = await adminUsersService.fetchAll();
          const author = admins.find(a => a.id === po.created_by_user_id);
          if (author) createdByName = author.name;
        } catch (_) { /* fallback to '—' */ }
      }
      const blob = generatePoPdf({
        po,
        supplier: po.supplier,
        items: po.items ?? [],
        companySettings,
        createdByName,
      });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) {
        // Popup blocked — fallback to download
        const a = document.createElement('a');
        a.href = url;
        a.download = `${po.po_number}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      console.error('PDF generation error:', e);
      showToast('Gagal generate PDF. Coba lagi.', 'warning');
    } finally {
      setDownloadingPdf(false);
    }
  }
```

- [ ] **Step 11.3: Add Download PDF button to header action area**

Find the header action area in `PoDetailView.tsx` (existing buttons like Printer/close). Add `Download PDF` button next to existing buttons, but only for `po.status !== 'DRAFT'`:

Search for the JSX block where the existing `Printer` icon is used (likely a header with the close button). Replace it with:

```tsx
        <div className="flex items-center gap-2">
          {po.status !== 'DRAFT' && (
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              {downloadingPdf ? 'Memproses...' : 'Download PDF'}
            </button>
          )}
          {/* ... existing buttons (Printer / close) ... */}
        </div>
```

If you can't find the exact header structure, add the button at the top of the component's main JSX return — right after the opening `<div>` of the detail view container, before the title row.

- [ ] **Step 11.4: Compile check**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run lint
```

Expected: zero errors.

- [ ] **Step 11.5: Manual smoke test**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run dev
```

Verify:
- ✅ Detail PO Draft: tombol "Download PDF" tidak muncul
- ✅ Detail PO ORDERED: tombol muncul → klik → tab baru terbuka dengan PDF
- ✅ PDF: header brand kelihatan, supplier info benar, items semua kelihatan, total match
- ✅ Tanggal pesan + tanggal diterima diharapkan tampil
- ✅ "Dibuat oleh: <nama admin>" tampil di Detail PO block
- ✅ Footer T&C 1×24 jam tampil di bawah
- ✅ Hapus address di Pengaturan → reload → klik Download → confirm dialog muncul

- [ ] **Step 11.6: Commit**

```bash
git add src/components/pembelian/PoDetailView.tsx
git commit -m "$(cat <<'EOF'
feat(po-pdf): Download PDF button in PoDetailView

Button visible for status != DRAFT. Fetches company_settings + admin
name for "Dibuat oleh". Opens PDF in new tab via blob URL; falls back
to download link if popup blocked. Confirm prompt if company info
incomplete in Pengaturan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase F — List Integration

### Task 12: `OrdersTab` — kolom Tgl Diterima + badge "Telat X hari"

**Files:**
- Modify: `src/components/PembelianScreen.tsx` (OrdersTab table header + row)

- [ ] **Step 12.1: Add helper functions**

Edit `src/components/PembelianScreen.tsx`. Find the existing `isOverdue` function in `OrdersTab` (around line 166). Add 2 helpers right after it:

```tsx
  function isReceiveOverdue(po: DbPurchaseOrder): boolean {
    if (po.status !== 'ORDERED' || !po.expected_receive_date) return false;
    return po.expected_receive_date < today;
  }

  function daysReceiveOverdue(po: DbPurchaseOrder): number {
    if (!po.expected_receive_date) return 0;
    const ms = new Date(today).getTime() - new Date(po.expected_receive_date).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }
```

- [ ] **Step 12.2: Update table header — change from 7 cols to 8 cols**

Edit `src/components/PembelianScreen.tsx` lines 241-249. Replace:

```tsx
          <div className="grid grid-cols-7 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
            <span className="col-span-1">No. PO</span>
            <span className="col-span-1">Supplier</span>
            <span className="col-span-1 text-center">Tgl Pesan</span>
            <span className="col-span-1 text-center">Jatuh Tempo</span>
            <span className="col-span-1 text-right">Total</span>
            <span className="col-span-1 text-center">Status</span>
            <span className="col-span-1 text-center">Aksi</span>
          </div>
```

with:

```tsx
          <div className="grid grid-cols-8 px-4 py-2.5 bg-gray-50 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
            <span className="col-span-1">No. PO</span>
            <span className="col-span-1">Supplier</span>
            <span className="col-span-1 text-center">Tgl Pesan</span>
            <span className="col-span-1 text-center">Tgl Diterima</span>
            <span className="col-span-1 text-center">Jatuh Tempo Bayar</span>
            <span className="col-span-1 text-right">Total</span>
            <span className="col-span-1 text-center">Status</span>
            <span className="col-span-1 text-center">Aksi</span>
          </div>
```

- [ ] **Step 12.3: Update data row — match 8-col grid + add Tgl Diterima column**

Edit `src/components/PembelianScreen.tsx` lines 254-294. Replace the entire `filtered.map(po => ...)` block:

```tsx
            filtered.map(po => (
              <div key={po.id} className={`grid grid-cols-8 px-4 py-3 border-b border-gray-100 items-center hover:bg-gray-50 ${
                isOverdue(po) ? LEFT_BORDER.OVERDUE :
                isReceiveOverdue(po) ? LEFT_BORDER.OVERDUE :
                (LEFT_BORDER[po.status] ?? '')
              }`}>
                <span className="col-span-1 text-xs font-mono font-semibold text-gray-800">{po.po_number}</span>
                <div className="col-span-1">
                  <div className="text-sm font-semibold text-gray-800 truncate">{po.supplier?.name ?? '—'}</div>
                  <div className="text-[10px] text-gray-400">{po.supplier?.payment_term_days === 0 ? 'Cash' : `Net ${po.supplier?.payment_term_days}`}</div>
                </div>
                <span className="col-span-1 text-xs text-gray-500 text-center">{formatDate(po.ordered_at)}</span>
                <div className="col-span-1 flex flex-col items-center gap-0.5">
                  {po.expected_receive_date ? (
                    <>
                      <span className={`text-xs font-semibold ${isReceiveOverdue(po) ? 'text-rose-600' : 'text-gray-700'}`}>
                        {formatDate(po.expected_receive_date)}
                      </span>
                      {isReceiveOverdue(po) && (
                        <span className="text-[9px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full leading-tight">
                          Telat {daysReceiveOverdue(po)} hari
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </div>
                <div className="col-span-1 flex flex-col items-center gap-0.5">
                  <span className={`text-xs font-semibold ${isOverdue(po) ? 'text-rose-600' : po.payment_due_at ? 'text-amber-600' : 'text-gray-400'}`}>
                    {po.payment_due_at ? formatDate(po.payment_due_at) : '—'}
                  </span>
                  {isOverdue(po) && (
                    <span className="text-[9px] font-bold text-white bg-rose-500 px-1.5 py-0.5 rounded-full leading-tight">Terlambat</span>
                  )}
                </div>
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
                      <button onClick={() => onEdit(po)} className="text-xs text-gray-600 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">Edit</button>
                      <button onClick={() => handleMarkOrdered(po)} className="text-xs text-indigo-700 px-2 py-1 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 font-semibold">Pesan</button>
                      <button onClick={() => handleDelete(po)} className="text-xs text-rose-600 px-2 py-1 rounded border border-rose-200 hover:bg-rose-50">Hapus</button>
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
```

Note: also sort `filtered` to push `isReceiveOverdue` to top (parallel to existing `isOverdue` payment sort). Edit lines 170-181 sort block:

```tsx
    .sort((a, b) => {
      const aReceiveLate = isReceiveOverdue(a);
      const bReceiveLate = isReceiveOverdue(b);
      const aPaymentLate = isOverdue(a);
      const bPaymentLate = isOverdue(b);
      // Payment overdue (RECEIVED + past due) bubbles to top
      if (aPaymentLate && !bPaymentLate) return -1;
      if (!aPaymentLate && bPaymentLate) return 1;
      // Then receive overdue (ORDERED + past expected_receive_date)
      if (aReceiveLate && !bReceiveLate) return -1;
      if (!aReceiveLate && bReceiveLate) return 1;
      return 0;
    });
```

- [ ] **Step 12.4: Compile check**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run lint
```

Expected: zero errors.

- [ ] **Step 12.5: Manual smoke test**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run dev
```

Setup data:
1. Buat PO DRAFT dengan tanggal diterima hari ini → Pesan → status ORDERED
2. Manually di Supabase (SQL editor): `UPDATE purchase_orders SET expected_receive_date = '2026-06-01' WHERE po_number = '<no PO yg baru dibuat>'` (tanggal lebih dari beberapa hari yang lalu)
3. Reload list

Verify:
- ✅ Kolom "Tgl Diterima" muncul antara "Tgl Pesan" dan "Jatuh Tempo Bayar"
- ✅ PO ORDERED dengan expected_receive_date lewat: border kiri rose + badge merah "Telat X hari"
- ✅ PO ORDERED dengan expected_receive_date masa depan: tanggal tampil normal, tanpa badge
- ✅ PO tanpa expected_receive_date: dash "—" di kolom Tgl Diterima
- ✅ Sort: payment-overdue di paling atas, lalu receive-overdue, lalu yang normal

- [ ] **Step 12.6: Update `progress.md`**

Tambah entry baru di top of `progress.md`:

```markdown
## 2026-06-08 — PO Create Page + PDF — DONE

- **Goal**: Ganti modal PurchaseOrderModal dengan halaman penuh sub-view di PembelianScreen. Tambah SupplierPicker dengan 4 state + inline create supplier. Field expected_receive_date untuk badge "Telat X hari". PDF generation via jsPDF dengan branding Garindo Jaya Panel + audit trail (created_by/updated_by).
- **Tasks 1-12 dari plan `docs/superpowers/plans/2026-06-08-po-create-page.md` semua DONE**.
- **Migration `supabase/migrations/20260608000001_po_expected_date_audit_permissions.sql`** — 3 kolom baru di `purchase_orders` (semua NULL-able, no backfill) + idempotent backfill `admin_users.permissions` dengan `can_create_po=true, can_edit_po=true`.
- **Files baru**: `PurchaseOrderFormPage.tsx`, `form/SupplierPicker.tsx`, `form/InlineSupplierForm.tsx`, `form/StockPicker.tsx`, `form/ItemRow.tsx`, `lib/pdf/purchaseOrderPdf.ts`.
- **Files hapus**: `PurchaseOrderModal.tsx`.
- **PDF teknik**: jsPDF + jspdf-autotable, branded header dengan Zap emerald box + nama company dari `company_settings`, items autotable, totals, optional notes, footer T&C 1×24 jam. Open di tab baru via `URL.createObjectURL(blob)`, fallback download link kalau popup blocked.
- **Permission gate**: Owner bypass (selalu lulus via ALL_PERMISSIONS); Admin di-cek `permissions.can_create_po` / `can_edit_po` dengan default-true semantic (key absent → allow).
- **List integration**: kolom Tgl Diterima + badge "Telat X hari" untuk PO ORDERED yang lewat expected date. Sort: payment-overdue → receive-overdue → normal.
- **Smoke tested**: semua flow di Task 9.11, 11.5, 12.5 verified. Backend tests di Task 1.5 PASS, no regressions di full backend suite.
```

- [ ] **Step 12.7: Commit**

```bash
git add src/components/PembelianScreen.tsx progress.md
git commit -m "$(cat <<'EOF'
feat(po-page): list — Tgl Diterima column + "Telat X hari" badge

OrdersTab grid: 7 → 8 columns to fit "Tgl Diterima" between "Tgl Pesan"
and "Jatuh Tempo Bayar". ORDERED PO past expected_receive_date gets
rose border + "Telat X hari" badge. Sort priority: payment-overdue >
receive-overdue > normal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification

After all 12 tasks complete, verify end-to-end:

- [ ] **Step F.1: Full lint pass**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity
npm run lint
```

Expected: zero errors.

- [ ] **Step F.2: Full backend test pass**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity/backend-go
go test ./...
```

Expected: PASS, no regressions.

- [ ] **Step F.3: End-to-end manual test scenario**

`npm run dev`, login as Owner:

1. Pembelian → Buat PO Baru → form muncul (sub-view)
2. Cari supplier "sumb" → tidak match → klik "+ Buat baru: 'sumb'" → form inline isi (Sumber Listrik Test / Budi / 0812... / 30) → Simpan & Pakai
3. Tambah 3 items dari StockPicker
4. Isi tgl diterima = hari ini + 7 hari
5. Catatan: "Test PO end-to-end"
6. PPN 11% on
7. Simpan & Pesan → toast → kembali ke list → PO muncul status "Dipesan"
8. Klik Detail → tombol "Download PDF" muncul → klik → tab baru → PDF dengan branding lengkap, supplier "Sumber Listrik Test", items 3 baris, total benar, "Dibuat oleh: <nama Owner>", footer T&C kelihatan
9. Edit Draft (buat baru, simpan Draft, edit) → ubah qty → Simpan & Pesan → back to list

- [ ] **Step F.4: Permission scenario test**

Login as Owner, buka User Management, edit Admin user X → set `permissions.can_create_po=false` (manually edit JSONB via supabase). Logout, login as user X. Buka Pembelian → klik "Buat PO Baru" → toast warning + redirect back to list.

---

## Self-Review Notes

Spec coverage:
- ✅ Sec 1 (Migration) → Task 1
- ✅ Sec 2 (Types) → Task 2
- ✅ Sec 3 (PembelianScreen wiring) → Task 9
- ✅ Sec 4 (PurchaseOrderFormPage) → Task 8
- ✅ Sec 5 (SupplierPicker 4 states) → Task 4
- ✅ Sec 6 (InlineSupplierForm) → Task 5
- ✅ Sec 7 (PDF generation) → Tasks 3 (deps), 10 (lib), 11 (button)
- ✅ Sec 8 (Field tgl diterima UI) → Task 8 (form), Task 12 (list)
- ✅ Sec 9 (Error handling) → distributed across tasks: 5 (inline supplier save error), 8 (validation/network/popup blocker handled at Task 11), 11 (incomplete company_settings warning)
- ✅ Sec 10 (Manual UAT) → Steps F.3, F.4

Out-of-scope items in spec are NOT planned here (correct).
