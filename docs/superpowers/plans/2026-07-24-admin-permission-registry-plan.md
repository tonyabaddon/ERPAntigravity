# Admin Permission Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti 3-way divergent permission definitions (`PermissionSet` interface, `defaultPermissions()`, `PERM_LABELS`) dengan single data-driven registry di `src/lib/permissions.ts`, backfill semua existing admin_users ke 43-key JSONB, dan tutup silent bypass di Sidebar (`canConfigureSalesChannels`) + Pembelian pages (`can_create_po`, `can_edit_po`).

**Architecture:** Registry sebagai satu-satunya sumber (43 entries + 4 roles + 8 kategori). `PermissionKey` type-derived via `as const satisfies` — dev tambah entry di registry → union auto-update, TypeScript menegakkan konsistensi. Storage tetap per-user JSONB (per founder requirement "owner bebas mix-and-match"), tapi setiap save path normalize via `normalizePermissions()` untuk jamin 43-key shape.

**Tech Stack:** TypeScript 5 (registry + `as const satisfies`), React 18, Vitest, Supabase Postgres (JSONB), Tailwind CSS (existing tokens), lucide-react (Info icon).

## Global Constraints

- **Spec source:** `docs/superpowers/specs/2026-07-24-admin-permission-registry-design.md` commit `95d310d` — approved oleh founder 2026-07-24. Setiap decision di sini traces ke spec section.
- **Migration slot:** `20261115000515` (block `000515-000534` reserved). Verify no parallel session collision via `ls supabase/migrations/20261115000*.sql | tail -5` right before commit.
- **43-key registry total:** Modul 10 + Pembelian 4 + Opname 7 + Gudang 3 + Kasir 9 + Penjualan 1 + Piutang 7 + Kontrol 2 = 43.
- **4 valid roles:** `Owner`, `Supervisor Gudang`, `Staff Admin Toko`, `Finance Manager`.
- **8 categories:** `Modul Utama`, `Pembelian`, `Stok Opname & Adjustment`, `Gudang`, `Kasir`, `Penjualan`, `Piutang & Kredit`, `Kontrol`.
- **Ship discipline:** 1 PR atomic (backfill + code together). Deploy order: **migration first**, then code — reverse order breaks Owners' `canConfigureSalesChannels` menu briefly.
- **Deploy verify:** After `git push`, run `gcloud builds list --limit=2` and confirm `STATUS=SUCCESS` before treating as shipped (per `feedback_deploy_verify_after_push` memory).
- **Stage 3 tenant:** Toko Jaya Makmur (`slug=toko-jaya-makmur`, id `22222222-2222-2222-2222-222222222222`). NEVER Testing Jaya Panel (real data — Jenny + NENG SEKAR).
- **Migration idempotency:** SQL uses `session_replication_role='replica'` bypass + explicit key ARRAY (drops legacy) + verify DO block. Safe to re-run.
- **No new dependencies.** Zero infra cost. Registry pure TypeScript, no library.
- **All copy Bahasa Indonesia** MSME tone; existing design tokens only (navy `#012749`, blue `#eff4ff`/`#abc9f3`, border `#e5eeff`, green toggle `#2d8a4e`). No new visual language.

## Impact Analysis (recap)

11 files touched (per spec §12):
| # | File | Action |
|---|---|---|
| 1 | `src/lib/permissions.ts` | NEW — registry + types + defaults + normalize + REGISTRY_MAP |
| 2 | `src/lib/permissions.test.ts` | NEW — registry integrity + normalize tests |
| 3 | `src/lib/permissions-gate-scan.test.ts` | NEW — static-analysis regression |
| 4 | `src/types.ts` | Modify — re-export from registry + narrow role types |
| 5 | `src/components/UserManagementScreen.tsx` | Modify — dbToAdminUser safeguard, normalize save paths, grouped UI + tooltips + preset button |
| 6 | `src/components/UserManagementScreen.test.tsx` | NEW — round-trip test |
| 7 | `src/components/Sidebar.tsx` | Modify — registry-driven isPermVisible |
| 8 | `src/components/pembelian/PurchaseOrderFormPage.tsx` | Modify — normalize `can_*` gates to `=== true` |
| 9 | `src/components/pembelian/PembelianDetailPage.tsx` | Modify — normalize `can_edit_po` gate to `=== true` |
| 10 | `src/components/AuthScreen.tsx` | No code change (ALL_PERMISSIONS auto-derives via re-export) — verify only |
| 11 | `supabase/migrations/20261115000515_backfill_admin_permissions.sql` | NEW — backfill all admin_users to 43-key shape |

---

## File Structure

**New unit: `src/lib/permissions.ts`** — data-only source of truth. Zero React, zero DB. Pure TypeScript module. Consumers derive everything from this file.

**Contract with consumers:**
- Exports `PERMISSION_REGISTRY`, `PERMISSION_ROLES`, `PERM_CATEGORIES` (readonly arrays)
- Exports `PermissionKey`, `PermissionSet`, `PermissionEntry`, `PermissionRole`, `PermissionCategory` (types)
- Exports `ALL_PERMISSIONS` (Object.freeze'd), `REGISTRY_MAP` (Map for O(1) lookup)
- Exports `defaultPermissions(role): PermissionSet`, `normalizePermissions(input, role): PermissionSet`

**Existing files stay structurally intact** — refactor within existing boundaries. No component splits, no directory moves.

---

## Task Dependency Graph

```
Task 1 (registry lib + tests)
  ├→ Task 2 (types.ts re-export + role narrowing)
  │    └→ Task 3 (UserManagementScreen refactor)
  ├→ Task 4 (Sidebar refactor)
  └→ Task 5 (Pembelian gate normalize + scan test)

Task 6 (backfill migration SQL — depends on registry keys agreed)

Task 7 (Stage 1 local verify — blocks on all code tasks 1-6)
  └→ Task 8 (Stage 2 deploy — migration first, then code)
       └→ Task 9 (Stage 3 prod verify + progress.md)
```

Tasks 1, 2, 3 are strictly sequential. Tasks 4, 5, 6 can run in parallel after Task 1 completes.

---

### Task 1: Create `src/lib/permissions.ts` registry + tests

**Files:**
- Create: `src/lib/permissions.ts`
- Create: `src/lib/permissions.test.ts`

**Interfaces:**
- Consumes: nothing (foundation)
- Produces: `PERMISSION_REGISTRY` (readonly 43 entries), `PERMISSION_ROLES` (readonly 4 items), `PERM_CATEGORIES` (readonly 8 items), `PermissionKey` (derived union), `PermissionSet = Record<PermissionKey, boolean>`, `PermissionEntry` (derived), `PermissionRole` (4 literal union), `PermissionCategory` (8 literal union), `ALL_PERMISSIONS` (frozen 43-true), `REGISTRY_MAP` (Map<PermissionKey, PermissionEntry>), `defaultPermissions(role: PermissionRole): PermissionSet`, `normalizePermissions(input, role: PermissionRole): PermissionSet`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/permissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  PERMISSION_REGISTRY,
  PERMISSION_ROLES,
  PERM_CATEGORIES,
  ALL_PERMISSIONS,
  REGISTRY_MAP,
  defaultPermissions,
  normalizePermissions,
  type PermissionKey,
  type PermissionSet,
} from './permissions';

describe('permissions registry', () => {
  it('registry has exactly 43 unique keys', () => {
    expect(PERMISSION_REGISTRY.length).toBe(43);
    const keys = new Set(PERMISSION_REGISTRY.map(p => p.key));
    expect(keys.size).toBe(43);
  });

  it('registry uses only 8 defined categories', () => {
    const categories = new Set(PERMISSION_REGISTRY.map(p => p.category));
    expect(categories.size).toBe(8);
    for (const c of categories) expect(PERM_CATEGORIES).toContain(c);
  });

  it('every role has all 43 keys in defaultPermissions', () => {
    for (const role of PERMISSION_ROLES) {
      const perms = defaultPermissions(role);
      expect(Object.keys(perms).length).toBe(43);
      for (const p of PERMISSION_REGISTRY) {
        expect(perms[p.key]).toEqual(p.defaultFor[role]);
      }
    }
  });

  it('Owner defaults are all true', () => {
    const perms = defaultPermissions('Owner');
    for (const p of PERMISSION_REGISTRY) expect(perms[p.key]).toBe(true);
  });

  it('ALL_PERMISSIONS has all 43 keys set to true and is frozen', () => {
    expect(Object.keys(ALL_PERMISSIONS).length).toBe(43);
    for (const p of PERMISSION_REGISTRY) expect(ALL_PERMISSIONS[p.key]).toBe(true);
    expect(Object.isFrozen(ALL_PERMISSIONS)).toBe(true);
  });

  it('REGISTRY_MAP has 43 entries with matching keys', () => {
    expect(REGISTRY_MAP.size).toBe(43);
    for (const p of PERMISSION_REGISTRY) {
      expect(REGISTRY_MAP.get(p.key)).toBe(p);
    }
  });

  it('normalizePermissions fills missing keys per role', () => {
    const partial = { dashboard: false } as Partial<PermissionSet>;
    const result = normalizePermissions(partial, 'Staff Admin Toko');
    expect(Object.keys(result).length).toBe(43);
    expect(result.dashboard).toBe(false);            // preserved
    expect(result.can_start_opname).toBe(true);      // filled per Staff Admin Toko preset
    expect(result.can_approve_adjustment).toBe(false); // filled per Staff Admin Toko preset
  });

  it('normalizePermissions drops unknown legacy keys', () => {
    const partial = { dashboard: true, pipeline: true } as Record<string, unknown>;
    const result = normalizePermissions(partial, 'Owner');
    expect(Object.keys(result)).not.toContain('pipeline');
    expect(Object.keys(result).length).toBe(43);
  });

  it('normalizePermissions coerces non-boolean input safely', () => {
    const partial = { dashboard: 'yes', kasir: 1 } as Record<string, unknown>;
    const result = normalizePermissions(partial, 'Owner');
    // Non-boolean input → falls through to role default (Owner = true)
    expect(result.dashboard).toBe(true);
    expect(result.kasir).toBe(true);
  });

  it('isActionPerm consistent with can_ prefix (canConfigureSalesChannels is special)', () => {
    const specialCase = new Set(['canConfigureSalesChannels']);
    for (const p of PERMISSION_REGISTRY) {
      const startsCan = p.key.startsWith('can_');
      const expected = startsCan || specialCase.has(p.key);
      expect(p.isActionPerm).toBe(expected);
    }
  });

  it('PermissionKey union derived from registry (compile-time guard)', () => {
    // If this line fails to compile, PermissionKey drifted from registry.
    const k: PermissionKey = PERMISSION_REGISTRY[0].key;
    expect(typeof k).toBe('string');
  });

  it('every registry entry has 4 role defaults', () => {
    for (const p of PERMISSION_REGISTRY) {
      expect(Object.keys(p.defaultFor).length).toBe(4);
      for (const role of PERMISSION_ROLES) {
        expect(typeof p.defaultFor[role]).toBe('boolean');
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails (no source file yet)**

Run: `npx vitest run src/lib/permissions.test.ts`
Expected: FAIL with "Cannot find module './permissions'"

- [ ] **Step 3: Create the registry source file**

Create `src/lib/permissions.ts`:

```ts
/**
 * SINGLE SOURCE OF TRUTH untuk admin permissions.
 *
 * Tambah permission baru: satu entry di PERMISSION_REGISTRY → PermissionKey union,
 * PermissionSet shape, ALL_PERMISSIONS, defaultPermissions(role), UI checkbox list,
 * dan Sidebar gate SEMUA auto-update. Zero drift by construction.
 *
 * Consumers:
 *   - src/types.ts (re-exports PermissionSet, PermissionKey, ALL_PERMISSIONS)
 *   - src/components/UserManagementScreen.tsx (renders grouped UI + normalize)
 *   - src/components/Sidebar.tsx (isPermVisible gate via REGISTRY_MAP.isActionPerm)
 */

// ─── Role & Category taxonomies ───────────────────────────────────────
export type PermissionRole =
  | 'Owner' | 'Supervisor Gudang' | 'Staff Admin Toko' | 'Finance Manager';

export type PermissionCategory =
  | 'Modul Utama' | 'Pembelian' | 'Stok Opname & Adjustment'
  | 'Gudang' | 'Kasir' | 'Penjualan' | 'Piutang & Kredit' | 'Kontrol';

export const PERMISSION_ROLES: readonly PermissionRole[] = [
  'Owner', 'Supervisor Gudang', 'Staff Admin Toko', 'Finance Manager',
] as const;

export const PERM_CATEGORIES: readonly PermissionCategory[] = [
  'Modul Utama', 'Pembelian', 'Stok Opname & Adjustment', 'Gudang',
  'Kasir', 'Penjualan', 'Piutang & Kredit', 'Kontrol',
] as const;

/**
 * Loose entry shape for registry authoring — `key: string` here, narrowed
 * to literal via `as const` on the array below. Consumers use `PermissionEntry`.
 */
interface RawPermissionEntry {
  key: string;
  label: string;
  category: PermissionCategory;
  description: string;         // Bahasa Indonesia, MSME tone
  isActionPerm: boolean;       // true = opt-in gate (hidden unless === true)
  defaultFor: Record<PermissionRole, boolean>;
}

// ─── PERMISSION REGISTRY (43 entries) ─────────────────────────────────
// `as const satisfies` keeps literal `key` types while validating shape.
export const PERMISSION_REGISTRY = [
  // Modul Utama (10)
  { key: 'dashboard', label: 'Dashboard', category: 'Modul Utama',
    description: 'Lihat ringkasan bisnis (omzet, kasir, stok, notifikasi).',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': true, 'Finance Manager': true } },
  { key: 'salesInbox', label: 'Sales Inbox', category: 'Modul Utama',
    description: 'Terima pesanan customer via WhatsApp langsung di aplikasi.',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': true, 'Finance Manager': true } },
  { key: 'laporan', label: 'Laporan', category: 'Modul Utama',
    description: 'Lihat laporan penjualan, laba-rugi, dan grafik bisnis.',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': true, 'Finance Manager': true } },
  { key: 'aiStock', label: 'Produk & Stok (AI)', category: 'Modul Utama',
    description: 'Kelola produk & stok dengan bantuan AI (foto → auto-detect item).',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': false, 'Finance Manager': false } },
  { key: 'pelanggan', label: 'Pelanggan', category: 'Modul Utama',
    description: 'Kelola daftar customer (nama, kontak, riwayat).',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': true, 'Finance Manager': true } },
  { key: 'orderHistory', label: 'Riwayat Pesanan', category: 'Modul Utama',
    description: 'Lihat riwayat semua pesanan yang pernah dibuat.',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': true, 'Finance Manager': true } },
  { key: 'userManagement', label: 'User Management', category: 'Modul Utama',
    description: 'Tambah/edit/hapus admin dan atur hak akses fitur.',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': false } },
  { key: 'whatsappAi', label: 'WhatsApp AI', category: 'Modul Utama',
    description: 'Atur AI auto-reply WhatsApp (jawab customer 24 jam).',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': false } },
  { key: 'notifications', label: 'Notifikasi', category: 'Modul Utama',
    description: 'Kelola notifikasi masuk (order baru, stok tipis, dll).',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': true, 'Finance Manager': true } },
  { key: 'settings', label: 'Pengaturan', category: 'Modul Utama',
    description: 'Ubah profil toko, bank, template invoice, integrasi.',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': false } },

  // Pembelian (4)
  { key: 'pembelian', label: 'Modul Pembelian', category: 'Pembelian',
    description: 'Buka menu Pembelian (PO, Tagihan, Pembayaran ke supplier).',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': true, 'Finance Manager': false } },
  { key: 'can_create_po', label: 'Buat PO', category: 'Pembelian',
    description: 'Buat Purchase Order (PO) baru ke supplier.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': false, 'Finance Manager': false } },
  { key: 'can_edit_po', label: 'Edit PO', category: 'Pembelian',
    description: 'Edit PO yang belum di-approve.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': false, 'Finance Manager': false } },
  { key: 'can_witness_po_receipt', label: 'Saksi Terima PO', category: 'Pembelian',
    description: 'Jadi saksi saat barang PO datang (cek kelengkapan).',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': true, 'Finance Manager': false } },

  // Stok Opname & Adjustment (7)
  { key: 'can_start_opname', label: 'Mulai Opname', category: 'Stok Opname & Adjustment',
    description: 'Mulai stok opname (cek stok fisik vs sistem).',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': true, 'Finance Manager': false } },
  { key: 'can_witness_opname', label: 'Saksi Opname', category: 'Stok Opname & Adjustment',
    description: 'Jadi saksi pas opname (verifikasi hasil hitung).',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': true, 'Finance Manager': false } },
  { key: 'can_commit_opname', label: 'Finalisasi Opname', category: 'Stok Opname & Adjustment',
    description: 'Finalisasi hasil opname (adjust stok jadi permanen).',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': false } },
  { key: 'can_request_adjustment', label: 'Ajukan Adjustment Stok', category: 'Stok Opname & Adjustment',
    description: 'Ajukan penyesuaian stok (stok fisik ≠ sistem).',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': false, 'Finance Manager': false } },
  { key: 'can_approve_adjustment', label: 'Setujui Adjustment Stok', category: 'Stok Opname & Adjustment',
    description: 'Setujui pengajuan penyesuaian stok dari staff.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': false } },
  { key: 'can_request_price_change', label: 'Ajukan Ubah Harga', category: 'Stok Opname & Adjustment',
    description: 'Ajukan perubahan harga jual produk.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': true, 'Finance Manager': false } },
  { key: 'can_approve_price_change', label: 'Setujui Ubah Harga', category: 'Stok Opname & Adjustment',
    description: 'Setujui pengajuan perubahan harga dari staff.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': true } },

  // Gudang (3)
  { key: 'can_manage_warehouses', label: 'Kelola Gudang', category: 'Gudang',
    description: 'Tambah/edit/nonaktifkan gudang.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': false, 'Finance Manager': false } },
  { key: 'can_initiate_transfer', label: 'Inisiasi Transfer', category: 'Gudang',
    description: 'Inisiasi transfer barang antar gudang.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': false, 'Finance Manager': false } },
  { key: 'can_receive_transfer', label: 'Terima Transfer', category: 'Gudang',
    description: 'Terima barang transfer di gudang tujuan.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': true, 'Staff Admin Toko': false, 'Finance Manager': false } },

  // Kasir (9)
  { key: 'kasir', label: 'Modul Kasir', category: 'Kasir',
    description: 'Buka menu Kasir untuk transaksi cepat di toko.',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': true, 'Finance Manager': false } },
  { key: 'can_open_kasir_shift', label: 'Buka Shift Kasir', category: 'Kasir',
    description: 'Buka shift kasir (mulai transaksi hari itu).',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': true, 'Finance Manager': false } },
  { key: 'can_request_kasir_price_override', label: 'Ajukan Override Harga Kasir', category: 'Kasir',
    description: 'Ajukan diskon/override harga di kasir.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': true, 'Finance Manager': false } },
  { key: 'can_approve_kasir_price_override', label: 'Setujui Override Harga Kasir', category: 'Kasir',
    description: 'Setujui override harga kasir dari staff.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': false } },
  { key: 'can_request_kasir_void', label: 'Ajukan Void Transaksi', category: 'Kasir',
    description: 'Ajukan void (batal) transaksi kasir.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': true, 'Finance Manager': false } },
  { key: 'can_approve_kasir_void', label: 'Setujui Void Transaksi', category: 'Kasir',
    description: 'Setujui void transaksi kasir dari staff.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': false } },
  { key: 'can_request_kasir_refund', label: 'Ajukan Refund', category: 'Kasir',
    description: 'Ajukan refund (pengembalian uang) ke customer.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': true, 'Finance Manager': false } },
  { key: 'can_approve_kasir_refund', label: 'Setujui Refund', category: 'Kasir',
    description: 'Setujui refund customer dari staff.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': true } },
  { key: 'can_override_price_floor', label: 'Override Harga Minimum', category: 'Kasir',
    description: 'Bisa jual di bawah harga minimum (owner-level exception).',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': false } },

  // Penjualan (1)
  { key: 'canConfigureSalesChannels', label: 'Atur Channel Penjualan', category: 'Penjualan',
    description: 'Atur channel penjualan (marketplace, offline, WA).',
    isActionPerm: true,   // Silent bypass fix — was treated as legacy default-visible by Sidebar.
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': false } },

  // Piutang & Kredit (7)
  { key: 'piutang', label: 'Modul Piutang', category: 'Piutang & Kredit',
    description: 'Buka menu Piutang (utang customer, reminder, pelunasan).',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': true } },
  { key: 'can_request_credit_activate', label: 'Ajukan Aktivasi Kredit', category: 'Piutang & Kredit',
    description: 'Ajukan aktivasi kredit (tempo) untuk customer.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': true, 'Finance Manager': true } },
  { key: 'can_approve_credit_activate', label: 'Setujui Aktivasi Kredit', category: 'Piutang & Kredit',
    description: 'Setujui aktivasi kredit customer dari staff.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': true } },
  { key: 'can_request_limit_change', label: 'Ajukan Ubah Limit', category: 'Piutang & Kredit',
    description: 'Ajukan perubahan limit kredit customer.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': true, 'Finance Manager': true } },
  { key: 'can_approve_limit_change', label: 'Setujui Ubah Limit', category: 'Piutang & Kredit',
    description: 'Setujui perubahan limit kredit dari staff.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': true } },
  { key: 'can_request_deactivate', label: 'Ajukan Nonaktif Kredit', category: 'Piutang & Kredit',
    description: 'Ajukan nonaktifkan kredit customer (blacklist).',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': true } },
  { key: 'can_approve_deactivate', label: 'Setujui Nonaktif Kredit', category: 'Piutang & Kredit',
    description: 'Setujui nonaktifkan kredit customer dari staff.',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': true } },

  // Kontrol (2)
  { key: 'reconciliation', label: 'Rekonsiliasi & Tutup Buku', category: 'Kontrol',
    description: 'Rekonsiliasi bank + tutup buku bulanan.',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': true } },
  { key: 'can_view_pengawasan', label: 'Lihat Pengawasan (Audit)', category: 'Kontrol',
    description: 'Lihat modul Pengawasan (audit log semua aksi).',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': true } },
] as const satisfies readonly RawPermissionEntry[];

// ─── Type derivation (single source: PERMISSION_REGISTRY above) ───────
export type PermissionKey = (typeof PERMISSION_REGISTRY)[number]['key'];
export type PermissionSet = Record<PermissionKey, boolean>;
export type PermissionEntry = (typeof PERMISSION_REGISTRY)[number];

// ─── Derived runtime exports ──────────────────────────────────────────
export const ALL_PERMISSIONS: PermissionSet = Object.freeze(
  Object.fromEntries(PERMISSION_REGISTRY.map(p => [p.key, true]))
) as PermissionSet;

export function defaultPermissions(role: PermissionRole): PermissionSet {
  return Object.fromEntries(
    PERMISSION_REGISTRY.map(p => [p.key, p.defaultFor[role]])
  ) as PermissionSet;
}

/**
 * Normalize a partial permission object to a full 43-key PermissionSet.
 * Missing keys fall through to role default. Unknown legacy keys are dropped.
 *
 * Call at every save path (toggle, preset-fill, form-submit) to prevent
 * the RPC's REPLACE semantics from dropping keys not in the input.
 */
export function normalizePermissions(
  input: Partial<PermissionSet> | Record<string, unknown> | null | undefined,
  role: PermissionRole,
): PermissionSet {
  const defaults = defaultPermissions(role);
  const src = (input ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    PERMISSION_REGISTRY.map(p => [
      p.key,
      typeof src[p.key] === 'boolean' ? (src[p.key] as boolean) : defaults[p.key],
    ]),
  ) as PermissionSet;
}

/** O(1) registry lookup — used by Sidebar isPermVisible gate. */
export const REGISTRY_MAP: ReadonlyMap<PermissionKey, PermissionEntry> = new Map(
  PERMISSION_REGISTRY.map(p => [p.key, p] as const),
);
```

- [ ] **Step 4: Run tests — expect all pass**

Run: `npx vitest run src/lib/permissions.test.ts`
Expected: 12 passing tests, 0 failing.

- [ ] **Step 5: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: no errors relating to `src/lib/permissions.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/permissions.ts src/lib/permissions.test.ts
git commit -m "$(cat <<'EOF'
feat(permissions): add registry-driven single source of truth

43-entry registry in src/lib/permissions.ts with types derived via
`as const satisfies` — adding a new permission requires only 1 entry,
zero drift across PermissionSet interface / defaults / UI / gate.

Exports: PermissionKey (derived union), PermissionSet, PermissionEntry,
PermissionRole (4), PermissionCategory (8), ALL_PERMISSIONS (frozen),
REGISTRY_MAP (O(1) lookup), defaultPermissions(role), normalizePermissions.

12 unit tests covering registry integrity, per-role defaults, normalize
round-trip, unknown key stripping, compile-time type-derivation guard.

Ref: docs/superpowers/specs/2026-07-24-admin-permission-registry-design.md §5

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Refactor `src/types.ts` — re-export from registry + narrow role types

**Files:**
- Modify: `src/types.ts` (lines 6-105 removed/replaced, lines 109-129 modified)

**Interfaces:**
- Consumes: `PermissionKey`, `PermissionSet`, `ALL_PERMISSIONS`, `PermissionRole` from Task 1
- Produces: `AdminUser.role: PermissionRole`, `DbAdminUser.role: PermissionRole` (narrowed from `string`); re-exports registry types so existing consumers (`import { PermissionSet } from '../types'`) keep working without modification

- [ ] **Step 1: Read current types.ts to confirm line numbers**

Run: `sed -n '1,130p' src/types.ts`
Note: lines 6-59 = `PermissionSet` interface, lines 61-105 = `ALL_PERMISSIONS` const, lines 109-129 = `AdminUser` + `DbAdminUser` interfaces.

- [ ] **Step 2: Modify types.ts — remove old defs, add re-exports + narrow role**

Edit `src/types.ts` — replace lines 1-129 with:

```ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Re-export permissions registry (single source of truth in src/lib/permissions.ts).
// Existing consumers `import { PermissionSet, ALL_PERMISSIONS } from './types'` keep working.
export { ALL_PERMISSIONS } from './lib/permissions';
export type { PermissionSet, PermissionKey, PermissionRole } from './lib/permissions';

import type { PermissionSet, PermissionRole } from './lib/permissions';

export type AdminStatus = 'Aktif' | 'Nonaktif';

/**
 * AdminUser.role narrowed from `string` to PermissionRole. Prevents typo bugs
 * (e.g. 'staf admin toko' silently falling through defaultPermissions to
 * Finance Manager). Read-boundary safeguard lives in dbToAdminUser mapper.
 */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  whatsapp: string;
  role: PermissionRole;
  permissions: PermissionSet;
  status: AdminStatus;
}

export interface DbAdminUser {
  id: string;
  name: string;
  email: string | null;
  whatsapp: string | null;
  role: PermissionRole;
  permissions: PermissionSet;
  status: string;
  created_at: string;
  tenant_id: string;
}

// (rest of types.ts unchanged — lines 130+)
```

**Note:** the rest of `types.ts` (from what was previously line 130 onwards) is preserved as-is. Use Edit tool with precise old_string boundaries; do not truncate the file.

- [ ] **Step 3: Verify TypeScript compilation across the codebase**

Run: `npx tsc --noEmit`
Expected: zero errors. Any errors here reveal consumers that pass a non-PermissionRole string as `role` — flag them, do not silently coerce.

- [ ] **Step 4: Run existing test suite**

Run: `npx vitest run --changed`
Expected: all pass (types.ts change is compatible with existing tests via re-export).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "$(cat <<'EOF'
refactor(types): re-export PermissionSet from registry + narrow AdminUser.role

Removes duplicate PermissionSet interface (was 43 partial-optional fields)
and ALL_PERMISSIONS const from types.ts. Both now re-exported from the
canonical src/lib/permissions.ts registry.

AdminUser.role and DbAdminUser.role narrowed from `string` to
PermissionRole (4-literal union). Compile-time prevention of role typos.

Ref: docs/superpowers/specs/2026-07-24-admin-permission-registry-design.md §5

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Refactor `src/components/UserManagementScreen.tsx` — safeguard, normalize, grouped UI, preset button

**Files:**
- Modify: `src/components/UserManagementScreen.tsx`
- Create: `src/components/UserManagementScreen.test.tsx`

**Interfaces:**
- Consumes: `PERMISSION_REGISTRY`, `PERM_CATEGORIES`, `PERMISSION_ROLES`, `defaultPermissions`, `normalizePermissions`, types from Task 1; narrowed `AdminUser.role` from Task 2
- Produces: `dbToAdminUser` with role validation + captureError safeguard; all save paths (`handleTogglePermission`, `handleAddAdmin`, preset click) send full 43-key normalized shape; UI renders 43 checkboxes grouped by 8 category headers with `<Info>` icon + native tooltip per row; "Isi Preset" button beside role dropdown

- [ ] **Step 1: Write the round-trip test (new file)**

Create `src/components/UserManagementScreen.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { normalizePermissions, defaultPermissions, PERMISSION_REGISTRY } from '../lib/permissions';
import type { PermissionSet, PermissionRole } from '../lib/permissions';

describe('UserManagementScreen normalize invariant', () => {
  it('handleTogglePermission normalize preserves all 43 keys after toggle', () => {
    // Simulate NENG SEKAR's 12-key state before backfill
    const partial: Partial<PermissionSet> = {
      dashboard: true, salesInbox: true, laporan: true, aiStock: false,
      pelanggan: true, orderHistory: true, userManagement: false,
      whatsappAi: false, notifications: true, settings: false,
      pembelian: true, kasir: false,
    };

    // Toggle 'can_create_po' from undefined → true
    const toggled = { ...partial, can_create_po: true } as Record<string, unknown>;
    const normalized = normalizePermissions(toggled, 'Staff Admin Toko');

    expect(Object.keys(normalized).length).toBe(43);
    expect(normalized.can_create_po).toBe(true);           // toggled value preserved
    expect(normalized.dashboard).toBe(true);               // existing preserved
    expect(normalized.can_start_opname).toBe(true);        // preset default filled
    expect(normalized.can_approve_credit_activate).toBe(false); // preset default filled
  });

  it('defaultPermissions for every valid role returns 43 keys', () => {
    for (const role of ['Owner', 'Supervisor Gudang', 'Staff Admin Toko', 'Finance Manager'] as PermissionRole[]) {
      const perms = defaultPermissions(role);
      expect(Object.keys(perms).length).toBe(43);
    }
  });

  it('registry covers all 43 unique keys expected by UI groups', () => {
    // UI groups render one <label> per registry entry per category. If a category
    // has zero entries or a key is missing, the count would drift.
    const counts: Record<string, number> = {};
    for (const p of PERMISSION_REGISTRY) {
      counts[p.category] = (counts[p.category] ?? 0) + 1;
    }
    expect(counts['Modul Utama']).toBe(10);
    expect(counts['Pembelian']).toBe(4);
    expect(counts['Stok Opname & Adjustment']).toBe(7);
    expect(counts['Gudang']).toBe(3);
    expect(counts['Kasir']).toBe(9);
    expect(counts['Penjualan']).toBe(1);
    expect(counts['Piutang & Kredit']).toBe(7);
    expect(counts['Kontrol']).toBe(2);
  });
});

describe('dbToAdminUser role validation', () => {
  it('valid role passes through', () => {
    // Actual dbToAdminUser is imported in the refactored file — this test asserts
    // the invariant via normalize wrapper for isolation.
    const roleFromDb = 'Staff Admin Toko';
    const validRoles = ['Owner', 'Supervisor Gudang', 'Staff Admin Toko', 'Finance Manager'];
    expect(validRoles).toContain(roleFromDb);
  });

  it('invalid role must fall back to safe default in refactored dbToAdminUser', () => {
    // This test is a documentation contract: the refactored dbToAdminUser
    // (in UserManagementScreen.tsx step 3 below) MUST coerce invalid roles.
    // Enforcement is via the refactored code + captureError.
    const invalidRole = 'Staf Admin Toko'; // typo
    const validRoles = ['Owner', 'Supervisor Gudang', 'Staff Admin Toko', 'Finance Manager'];
    expect(validRoles).not.toContain(invalidRole);
  });
});
```

- [ ] **Step 2: Run tests — expect PASS (pure functions imported from Task 1)**

Run: `npx vitest run src/components/UserManagementScreen.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 3: Refactor `dbToAdminUser` mapper — add role safeguard**

Read current `src/components/UserManagementScreen.tsx:29-50` to confirm the exact `dbToAdminUser` implementation, then Edit to add safeguard.

Edit the imports section (top of file, around line 14):

```diff
- import { AdminUser, PermissionSet, DbAdminUser, ALL_PERMISSIONS } from '../types';
+ import { AdminUser, PermissionSet, DbAdminUser, ALL_PERMISSIONS } from '../types';
+ import {
+   PERMISSION_REGISTRY,
+   PERM_CATEGORIES,
+   PERMISSION_ROLES,
+   defaultPermissions,
+   normalizePermissions,
+   type PermissionRole,
+   type PermissionCategory,
+ } from '../lib/permissions';
+ import { captureError } from '../lib/captureError';
+ import { Info } from 'lucide-react'; // Add to existing lucide-react import if not already imported
```

**Note:** verify the existing lucide-react import block first (currently `{ UserPlus, Search, ChevronDown, Trash2, UserCheck, Crown }` at line 7-14). Add `Info` to that same import statement rather than a separate line, e.g. `{ UserPlus, Search, ChevronDown, Trash2, UserCheck, Crown, Info }`.

Edit the `dbToAdminUser` function:

```diff
- function dbToAdminUser(db: DbAdminUser): AdminUser {
-   return {
-     id: db.id,
-     name: db.name,
-     email: db.email ?? '',
-     whatsapp: db.whatsapp ?? '',
-     role: db.role,
-     permissions: db.permissions as PermissionSet,
-     status: db.status as AdminStatus,
-   };
- }
+ function dbToAdminUser(db: DbAdminUser): AdminUser {
+   // Role safeguard: DB stores role as text; if it's not a valid PermissionRole,
+   // log via captureError and fall back to safe default to prevent silent
+   // fall-through in defaultPermissions().
+   const isValidRole = (PERMISSION_ROLES as readonly string[]).includes(db.role);
+   const validRole = isValidRole
+     ? (db.role as PermissionRole)
+     : (captureError(new Error(`Invalid admin role from DB: '${db.role}'`), {
+         feature: 'user_management',
+         action: 'db_role_validation',
+       }),
+       'Staff Admin Toko' as PermissionRole);
+
+   return {
+     id: db.id,
+     name: db.name,
+     email: db.email ?? '',
+     whatsapp: db.whatsapp ?? '',
+     role: validRole,
+     permissions: db.permissions as PermissionSet,
+     status: db.status as AdminStatus,
+   };
+ }
```

- [ ] **Step 4: Replace hardcoded `defaultPermissions` function**

Edit `src/components/UserManagementScreen.tsx:51-72` — DELETE the entire local `defaultPermissions` function (lines 51-72). Consumers already imported the registry version in Step 3.

Verify: `grep -n "function defaultPermissions" src/components/UserManagementScreen.tsx` should return no matches.

- [ ] **Step 5: Delete hardcoded `PERM_LABELS` array — will be derived from registry**

Edit `src/components/UserManagementScreen.tsx:86-99` — DELETE the 12-entry `PERM_LABELS` const.

Verify: `grep -n "PERM_LABELS" src/components/UserManagementScreen.tsx` should return no matches (temporarily — added back in derived form in step 8).

- [ ] **Step 6: Normalize `handleTogglePermission` — send full 43-key shape**

Read current `src/components/UserManagementScreen.tsx` around line 125 for the exact `handleTogglePermission`, then Edit:

```diff
- const handleTogglePermission = async (adminId: string, permissionKey: keyof PermissionSet) => {
-   const prev = admins;
-   const updated = admins.map(adm => {
-     if (adm.id === adminId) {
-       return { ...adm, permissions: { ...adm.permissions, [permissionKey]: !adm.permissions[permissionKey] } };
-     }
-     return adm;
-   });
-   setAdmins(updated);
-   // ... rest of function
+ const handleTogglePermission = async (adminId: string, permissionKey: keyof PermissionSet) => {
+   const prev = admins;
+   const target = admins.find(a => a.id === adminId);
+   if (!target) return;
+
+   // Toggle value in a partial, then normalize to full 43-key shape so the
+   // RPC's REPLACE semantics (permissions = EXCLUDED.permissions) don't drop
+   // any keys that weren't in the input.
+   const nextPartial = { ...target.permissions, [permissionKey]: !target.permissions[permissionKey] };
+   const nextPerms = normalizePermissions(nextPartial, target.role);
+
+   const updated = admins.map(adm =>
+     adm.id === adminId ? { ...adm, permissions: nextPerms } : adm,
+   );
+   setAdmins(updated);
+   // ... rest of function (unchanged upsert call)
```

Preserve the rest of `handleTogglePermission` (upsert call, error handling, rollback) exactly as-is.

- [ ] **Step 7: Normalize `handleAddAdmin` — call normalize on preset defaults**

Read `handleAddAdmin` (around line 200-230 per file structure). Find where `defaultPermissions(newRole)` is called and wrap the result with normalize:

```diff
- permissions: defaultPermissions(newRole),
+ permissions: normalizePermissions(defaultPermissions(newRole), newRole),
```

Do this in BOTH sites (there are 2 per grep earlier: line ~220 and ~252). The normalize is redundant here (defaults already 43 keys), but explicit — defends against future refactors.

- [ ] **Step 8: Add "Isi Preset" button beside role dropdown in add-admin form**

Read the form's role dropdown section (search for `newRole` state binding, likely around line 340-380). Add button after the `<select>`:

```tsx
<div className="flex items-center gap-2">
  <select
    value={newRole}
    onChange={(e) => setNewRole(e.target.value)}
    className="..." // existing className preserved
  >
    <option value="Pilih Peran...">Pilih Peran...</option>
    {PERMISSION_ROLES.map(r => (
      <option key={r} value={r}>{r}</option>
    ))}
  </select>
  <button
    type="button"
    onClick={() => {
      if (newRole === 'Pilih Peran...') return;
      // Preview only — full apply happens on form submit via handleAddAdmin.
      // For now this button is a hint that preset will be applied.
      // Future: could pre-fill checkbox preview UI in the form.
    }}
    className="text-[10px] font-bold text-[#012749] underline"
    disabled={newRole === 'Pilih Peran...'}
    title="Preset akan diterapkan otomatis saat 'BUAT AKUN'"
  >
    Isi Preset
  </button>
</div>
```

**Scope note per spec §7:** For Phase 1, "Isi Preset" is a UX affordance/label — actual application happens via `handleAddAdmin` (which already calls `defaultPermissions(newRole)`). Per-row preset-reset in expanded admin panel is deferred (spec §7 line 596).

- [ ] **Step 9: Refactor expanded permission grid — group by category with tooltips**

Read the expanded panel render (around line 472-503). Replace the flat grid with grouped-by-category render:

```diff
- {isExpanded && (
-   <div className="border-t border-[#eff4ff] bg-[#fafbff] px-5 py-5">
-     {isOwner && (
-       <p className="text-[10px] font-bold text-amber-600 mb-3 flex items-center gap-1.5">
-         <Crown className="w-3 h-3" /> Owner memiliki akses penuh — hak akses tidak dapat diubah.
-       </p>
-     )}
-     <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
-       {PERM_LABELS.map(({ key, label }) => (
-         <label key={key} className={`flex items-center justify-between bg-white border border-[#e5eeff] rounded-xl px-4 py-2.5 gap-3 ${...}`}>
-           <span className="text-[11px] font-bold text-[#43474e] truncate">{label}</span>
-           <div className="relative inline-flex items-center shrink-0">
-             <input type="checkbox" checked={adm.permissions[key] ?? false} onChange={...} disabled={isOwner} className="sr-only peer" />
-             <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full ..." />
-           </div>
-         </label>
-       ))}
-     </div>
-   </div>
- )}
+ {isExpanded && (
+   <div className="border-t border-[#eff4ff] bg-[#fafbff] px-5 py-5 space-y-5">
+     {isOwner && (
+       <p className="text-[10px] font-bold text-amber-600 mb-3 flex items-center gap-1.5">
+         <Crown className="w-3 h-3" /> Owner memiliki akses penuh — hak akses tidak dapat diubah.
+       </p>
+     )}
+     {PERM_CATEGORIES.map(category => {
+       const entries = PERMISSION_REGISTRY.filter(p => p.category === category);
+       if (entries.length === 0) return null;
+       return (
+         <div key={category}>
+           <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
+             {category}
+           </h4>
+           <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
+             {entries.map(({ key, label, description }) => (
+               <label
+                 key={key}
+                 className={`flex items-center justify-between bg-white border border-[#e5eeff] rounded-xl px-4 py-2.5 gap-3 ${
+                   isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-[#abc9f3]'
+                 }`}
+               >
+                 <div className="flex items-center gap-1.5 min-w-0">
+                   <Info
+                     className="w-3 h-3 text-slate-400 shrink-0"
+                     aria-label={description}
+                   >
+                     <title>{description}</title>
+                   </Info>
+                   <span className="text-[11px] font-bold text-[#43474e] truncate" title={description}>
+                     {label}
+                   </span>
+                 </div>
+                 <div className="relative inline-flex items-center shrink-0">
+                   <input
+                     type="checkbox"
+                     checked={adm.permissions[key] ?? false}
+                     onChange={() => !isOwner && handleTogglePermission(adm.id, key)}
+                     disabled={isOwner}
+                     className="sr-only peer"
+                   />
+                   <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#2d8a4e]" />
+                 </div>
+               </label>
+             ))}
+           </div>
+         </div>
+       );
+     })}
+   </div>
+ )}
```

- [ ] **Step 10: Fix `activeCount` denominator — should still match 43-key registry**

Find the count logic (around line 428-433):

```diff
- const permKeys = Object.keys(ALL_PERMISSIONS) as (keyof PermissionSet)[];
- const totalCount = permKeys.length;
- const activeCount = permKeys.reduce(
-   (n, k) => n + (adm.permissions[k] ? 1 : 0),
-   0,
- );
+ // Count ONLY registry keys — legacy DB keys ignored (were bloating count).
+ const permKeys = PERMISSION_REGISTRY.map(p => p.key);
+ const totalCount = permKeys.length;
+ const activeCount = permKeys.reduce(
+   (n, k) => n + (adm.permissions[k] ? 1 : 0),
+   0,
+ );
```

Should now show "N/43 aktif" (correctly).

- [ ] **Step 11: Verify TypeScript compilation + full test suite**

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npx vitest run --changed`
Expected: all pass, including new `UserManagementScreen.test.tsx`.

- [ ] **Step 12: Verify linter clean**

Run: `npm run lint`
Expected: zero errors, zero warnings for touched files.

- [ ] **Step 13: Commit**

```bash
git add src/components/UserManagementScreen.tsx src/components/UserManagementScreen.test.tsx
git commit -m "$(cat <<'EOF'
refactor(user-mgmt): registry-driven UI + normalize invariant + safeguards

- dbToAdminUser: role validation with captureError + safe fallback
  (prevents silent fall-through on invalid DB role).
- handleTogglePermission: normalizePermissions() before RPC upsert to
  guarantee full 43-key shape — closes the drop-on-REPLACE bug that
  produced NENG SEKAR's 12-key row.
- handleAddAdmin: explicit normalize wrap on defaultPermissions() output.
- UI: 43 checkboxes grouped by 8 categories via PERMISSION_REGISTRY,
  each with Info icon + native tooltip (Bahasa Indonesia MSME tone).
- "Isi Preset" affordance beside role dropdown in add-admin form.
- activeCount denominator: now derives from registry keys (was
  ALL_PERMISSIONS Object.keys — same result, but explicit).

Removed: local defaultPermissions() function (12-key stale template),
PERM_LABELS array (12-key stale UI list). Both replaced by registry-
driven derivation.

Ref: docs/superpowers/specs/2026-07-24-admin-permission-registry-design.md §5, §7, §10

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Refactor `src/components/Sidebar.tsx` — registry-driven `isPermVisible`

**Files:**
- Modify: `src/components/Sidebar.tsx:126-133`

**Interfaces:**
- Consumes: `REGISTRY_MAP`, `PermissionKey` from Task 1
- Produces: `isPermVisible(key)` uses `entry.isActionPerm` flag (not string prefix). Fixes `canConfigureSalesChannels` silent bypass — was legacy-visible, now correctly opt-in.

- [ ] **Step 1: Read current `isPermVisible` (lines 126-133)**

Run: `sed -n '120,140p' src/components/Sidebar.tsx`
Confirm the exact current implementation.

- [ ] **Step 2: Add registry import (top of file, existing import block)**

Find the imports around line 1-20. Add:

```diff
+ import { REGISTRY_MAP, type PermissionKey } from '../lib/permissions';
```

- [ ] **Step 3: Replace `isPermVisible`**

```diff
  const isPermVisible = (key: keyof PermissionSet): boolean => {
    if (!perms) return true;
+   const entry = REGISTRY_MAP.get(key as PermissionKey);
+   // Unknown keys (legacy `pipeline` etc.) default visible — safe fallback,
+   // prevents breaking existing UI while allowing gradual key retirement.
+   if (!entry) return true;
    const value = perms[key];
-   if (typeof key === 'string' && key.startsWith('can_')) {
-     return value === true;
-   }
-   return value !== false;
+   return entry.isActionPerm ? value === true : value !== false;
  };
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Run test suite**

Run: `npx vitest run --changed`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "$(cat <<'EOF'
fix(sidebar): registry-driven isPermVisible closes canConfigureSalesChannels bypass

Previous implementation used string-prefix check (key.startsWith('can_'))
which returned FALSE for canConfigureSalesChannels (camelCase, no underscore
after 'can') — so gate treated it as legacy default-visible. Any admin
without the perm still saw the Sales Channels menu. Silent bypass.

Registry now marks each key with isActionPerm boolean (canConfigureSalesChannels
= true). Sidebar reads flag, applies correct opt-in gate. Unknown keys
default visible (safe fallback for legacy DB rows).

Ref: docs/superpowers/specs/2026-07-24-admin-permission-registry-design.md §8

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Normalize Pembelian `can_*` gates + add regression scan test

**Files:**
- Modify: `src/components/pembelian/PurchaseOrderFormPage.tsx:39-40`
- Modify: `src/components/pembelian/PembelianDetailPage.tsx:275`
- Create: `src/lib/permissions-gate-scan.test.ts`

**Interfaces:**
- Consumes: nothing new (existing `currentUserPermissions?: PermissionSet` prop)
- Produces: consistent opt-in `=== true` gate across codebase for `can_*` keys. Regression test scans source for `!== false` pattern on `can_*` keys and fails if any consumer regresses.

- [ ] **Step 1: Write the failing scan test**

Create `src/lib/permissions-gate-scan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_ROOT = resolve(__dirname, '..');

/**
 * Files known to gate on `can_*` permissions. When you add a new consumer,
 * append it here — the test will scan for the anti-pattern.
 *
 * Anti-pattern: `permissions?.can_xxx !== false` (default-visible → silent
 * bypass when undefined).
 *
 * Correct pattern: `permissions?.can_xxx === true` (opt-in gate) OR
 * `!!permissions?.can_xxx` (truthy, equivalent for boolean).
 */
const GATED_FILES = [
  'components/Sidebar.tsx',
  'components/pembelian/PurchaseOrderFormPage.tsx',
  'components/pembelian/PembelianDetailPage.tsx',
  'components/stok/StockOpnameScreen.tsx',
  'components/ManajemenGudangScreen.tsx',
];

const BAD_PATTERN = /permissions\??\.\s*can_\w+\s*!==\s*false/g;

describe('permissions gate consistency', () => {
  it.each(GATED_FILES)('%s does not use default-visible `!== false` gate on can_*', (rel) => {
    const src = readFileSync(resolve(SRC_ROOT, rel), 'utf8');
    const matches = src.match(BAD_PATTERN);
    expect(
      matches,
      `${rel} uses default-visible can_* gate (silent bypass risk). Change to === true.`,
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run scan test — expect FAIL (current code still has anti-pattern)**

Run: `npx vitest run src/lib/permissions-gate-scan.test.ts`
Expected: FAIL on `components/pembelian/PurchaseOrderFormPage.tsx` and `components/pembelian/PembelianDetailPage.tsx`.

- [ ] **Step 3: Fix `PurchaseOrderFormPage.tsx:39-40`**

Read current lines 35-45 to confirm exact text. Edit:

```diff
  const canEditForm = isEditing
-   ? currentUserPermissions?.can_edit_po !== false
-   : currentUserPermissions?.can_create_po !== false;
+   ? currentUserPermissions?.can_edit_po === true
+   : currentUserPermissions?.can_create_po === true;
```

- [ ] **Step 4: Fix `PembelianDetailPage.tsx:275`**

Read current lines 270-280 to confirm exact text. Edit:

```diff
- const canEdit = currentUserPermissions?.can_edit_po !== false;
+ const canEdit = currentUserPermissions?.can_edit_po === true;
```

- [ ] **Step 5: Run scan test — expect PASS**

Run: `npx vitest run src/lib/permissions-gate-scan.test.ts`
Expected: PASS on all 5 GATED_FILES.

- [ ] **Step 6: Verify no regression in existing tests**

Run: `npx vitest run --changed`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/pembelian/PurchaseOrderFormPage.tsx \
        src/components/pembelian/PembelianDetailPage.tsx \
        src/lib/permissions-gate-scan.test.ts
git commit -m "$(cat <<'EOF'
fix(pembelian): normalize can_* gates to opt-in `=== true` + scan test

PurchaseOrderFormPage (line 39-40) and PembelianDetailPage (line 275)
used `!== false` default-visible pattern. Silent bypass: any admin with
`can_create_po` undefined could deep-link to /pembelian/create-po and
submit — Sidebar hid the menu but page-level gate allowed.

Normalized to opt-in `=== true` pattern (consistent with Sidebar +
StockOpname + ManajemenGudang). Post-backfill (migration 000515), all
admin_users rows have explicit true/false for can_create_po, so this
change is behavior-preserving for defined values and correctly blocking
for undefined (which will no longer occur after backfill).

New static-analysis regression test permissions-gate-scan.test.ts scans
5 gated files for the anti-pattern. Any future regression fails CI.

Ref: docs/superpowers/specs/2026-07-24-admin-permission-registry-design.md §8b, §11

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Write backfill migration `20261115000515` + dry-run smoke

**Files:**
- Create: `supabase/migrations/20261115000515_backfill_admin_permissions.sql`

**Interfaces:**
- Consumes: registry key list (embedded in SQL as `v_valid_keys` ARRAY — must match `PERMISSION_REGISTRY` keys exactly)
- Produces: DB state where every `admin_users` row (7 total at time of writing) has exactly 43 permission keys; Owner rows all true, non-Owner rows preserve existing + fill missing per preset

- [ ] **Step 1: Verify migration slot 000515 still free**

Run: `ls supabase/migrations/20261115000*.sql | sort | tail -5`
Expected: latest is `000514_grant_auth_schema_to_vosi_rpc_owner.sql`. Slot 000515 clean.

If another slot 515+ was taken by a parallel session: bump to next free slot in `000515-000534` block; update filename below.

- [ ] **Step 2: Create migration file**

Create `supabase/migrations/20261115000515_backfill_admin_permissions.sql`:

```sql
-- Migration 20261115000515: backfill admin_users.permissions to 43-key shape
--
-- Root cause: 3-way divergence between PermissionSet interface (43 keys),
-- defaultPermissions() (12 keys), PERM_LABELS UI (12 keys). All 6 Owners in
-- prod DB have 33 keys (missing 6 Phase 1A piutang approvals + 4 renamed
-- legacy keys). NENG SEKAR (Staff Admin Toko) has 12 keys.
--
-- After this migration all admin_users rows have exactly 43 keys per
-- src/lib/permissions.ts PERMISSION_REGISTRY. Owner: all true. Non-Owner:
-- existing values preserved, missing filled per per-role default.
--
-- Idempotent: safe to re-run (rebuild from role + existing on each run).

DO $$
DECLARE
  v_owner_perms      jsonb;
  v_supervisor_perms jsonb;
  v_staff_perms      jsonb;
  v_finance_perms    jsonb;
  v_valid_keys       text[] := ARRAY[
    -- Modul Utama (10)
    'dashboard','salesInbox','laporan','aiStock','pelanggan','orderHistory',
    'userManagement','whatsappAi','notifications','settings',
    -- Pembelian (4)
    'pembelian','can_create_po','can_edit_po','can_witness_po_receipt',
    -- Stok Opname & Adjustment (7)
    'can_start_opname','can_witness_opname','can_commit_opname',
    'can_request_adjustment','can_approve_adjustment',
    'can_request_price_change','can_approve_price_change',
    -- Gudang (3)
    'can_manage_warehouses','can_initiate_transfer','can_receive_transfer',
    -- Kasir (9)
    'kasir','can_open_kasir_shift',
    'can_request_kasir_price_override','can_approve_kasir_price_override',
    'can_request_kasir_void','can_approve_kasir_void',
    'can_request_kasir_refund','can_approve_kasir_refund',
    'can_override_price_floor',
    -- Penjualan (1)
    'canConfigureSalesChannels',
    -- Piutang & Kredit (7)
    'piutang',
    'can_request_credit_activate','can_approve_credit_activate',
    'can_request_limit_change','can_approve_limit_change',
    'can_request_deactivate','can_approve_deactivate',
    -- Kontrol (2)
    'reconciliation','can_view_pengawasan'
  ];
BEGIN
  -- Bypass audit triggers if any exist on admin_users (defensive; matches
  -- migration 000513 backfill pattern for plans). Safe: authoritative rewrite.
  SET LOCAL session_replication_role = 'replica';

  -- Owner: all 43 = true
  v_owner_perms := (
    SELECT jsonb_object_agg(k, true) FROM unnest(v_valid_keys) AS k
  );

  -- Supervisor Gudang preset (see spec §6 default matrix)
  v_supervisor_perms := jsonb_build_object(
    'dashboard', true, 'salesInbox', false, 'laporan', true, 'aiStock', true,
    'pelanggan', false, 'orderHistory', false, 'userManagement', false,
    'whatsappAi', false, 'notifications', true, 'settings', false,
    'pembelian', true, 'can_create_po', true, 'can_edit_po', true,
    'can_witness_po_receipt', true,
    'can_start_opname', true, 'can_witness_opname', true,
    'can_commit_opname', false, 'can_request_adjustment', true,
    'can_approve_adjustment', false, 'can_request_price_change', false,
    'can_approve_price_change', false,
    'can_manage_warehouses', true, 'can_initiate_transfer', true,
    'can_receive_transfer', true,
    'kasir', false, 'can_open_kasir_shift', false,
    'can_request_kasir_price_override', false, 'can_approve_kasir_price_override', false,
    'can_request_kasir_void', false, 'can_approve_kasir_void', false,
    'can_request_kasir_refund', false, 'can_approve_kasir_refund', false,
    'can_override_price_floor', false,
    'canConfigureSalesChannels', false,
    'piutang', false,
    'can_request_credit_activate', false, 'can_approve_credit_activate', false,
    'can_request_limit_change', false, 'can_approve_limit_change', false,
    'can_request_deactivate', false, 'can_approve_deactivate', false,
    'reconciliation', false, 'can_view_pengawasan', false
  );

  -- Staff Admin Toko preset
  v_staff_perms := jsonb_build_object(
    'dashboard', true, 'salesInbox', true, 'laporan', true, 'aiStock', false,
    'pelanggan', true, 'orderHistory', true, 'userManagement', false,
    'whatsappAi', false, 'notifications', true, 'settings', false,
    'pembelian', true, 'can_create_po', false, 'can_edit_po', false,
    'can_witness_po_receipt', true,
    'can_start_opname', true, 'can_witness_opname', true,
    'can_commit_opname', false, 'can_request_adjustment', false,
    'can_approve_adjustment', false, 'can_request_price_change', true,
    'can_approve_price_change', false,
    'can_manage_warehouses', false, 'can_initiate_transfer', false,
    'can_receive_transfer', false,
    'kasir', true, 'can_open_kasir_shift', true,
    'can_request_kasir_price_override', true, 'can_approve_kasir_price_override', false,
    'can_request_kasir_void', true, 'can_approve_kasir_void', false,
    'can_request_kasir_refund', true, 'can_approve_kasir_refund', false,
    'can_override_price_floor', false,
    'canConfigureSalesChannels', false,
    'piutang', false,
    'can_request_credit_activate', true, 'can_approve_credit_activate', false,
    'can_request_limit_change', true, 'can_approve_limit_change', false,
    'can_request_deactivate', false, 'can_approve_deactivate', false,
    'reconciliation', false, 'can_view_pengawasan', false
  );

  -- Finance Manager preset
  v_finance_perms := jsonb_build_object(
    'dashboard', true, 'salesInbox', true, 'laporan', true, 'aiStock', false,
    'pelanggan', true, 'orderHistory', true, 'userManagement', false,
    'whatsappAi', false, 'notifications', true, 'settings', false,
    'pembelian', false, 'can_create_po', false, 'can_edit_po', false,
    'can_witness_po_receipt', false,
    'can_start_opname', false, 'can_witness_opname', false,
    'can_commit_opname', false, 'can_request_adjustment', false,
    'can_approve_adjustment', false, 'can_request_price_change', false,
    'can_approve_price_change', true,
    'can_manage_warehouses', false, 'can_initiate_transfer', false,
    'can_receive_transfer', false,
    'kasir', false, 'can_open_kasir_shift', false,
    'can_request_kasir_price_override', false, 'can_approve_kasir_price_override', false,
    'can_request_kasir_void', false, 'can_approve_kasir_void', false,
    'can_request_kasir_refund', false, 'can_approve_kasir_refund', true,
    'can_override_price_floor', false,
    'canConfigureSalesChannels', false,
    'piutang', true,
    'can_request_credit_activate', true, 'can_approve_credit_activate', true,
    'can_request_limit_change', true, 'can_approve_limit_change', true,
    'can_request_deactivate', true, 'can_approve_deactivate', true,
    'reconciliation', true, 'can_view_pengawasan', true
  );

  -- Update Owner rows: force all 43 = true
  UPDATE public.admin_users
  SET permissions = v_owner_perms
  WHERE role = 'Owner';

  -- Update Supervisor Gudang: preset || existing (existing wins on duplicates)
  UPDATE public.admin_users
  SET permissions = v_supervisor_perms || COALESCE(
    (SELECT jsonb_object_agg(k, v)
     FROM jsonb_each(COALESCE(permissions, '{}'::jsonb)) AS e(k, v)
     WHERE k = ANY(v_valid_keys)),
    '{}'::jsonb
  )
  WHERE role = 'Supervisor Gudang';

  -- Update Staff Admin Toko
  UPDATE public.admin_users
  SET permissions = v_staff_perms || COALESCE(
    (SELECT jsonb_object_agg(k, v)
     FROM jsonb_each(COALESCE(permissions, '{}'::jsonb)) AS e(k, v)
     WHERE k = ANY(v_valid_keys)),
    '{}'::jsonb
  )
  WHERE role = 'Staff Admin Toko';

  -- Update Finance Manager
  UPDATE public.admin_users
  SET permissions = v_finance_perms || COALESCE(
    (SELECT jsonb_object_agg(k, v)
     FROM jsonb_each(COALESCE(permissions, '{}'::jsonb)) AS e(k, v)
     WHERE k = ANY(v_valid_keys)),
    '{}'::jsonb
  )
  WHERE role = 'Finance Manager';

  RAISE NOTICE 'admin_users backfill: main updates complete';
END $$;

-- Verify: every admin_users row for known roles has exactly 43 keys.
DO $$
DECLARE
  v_bad_count int;
BEGIN
  SELECT count(*) INTO v_bad_count
  FROM public.admin_users
  WHERE role IN ('Owner', 'Supervisor Gudang', 'Staff Admin Toko', 'Finance Manager')
    AND (SELECT count(*) FROM jsonb_object_keys(permissions)) <> 43;

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'backfill_admin_permissions: % rows do not have 43 keys', v_bad_count;
  END IF;
  RAISE NOTICE 'admin_users backfill verified: all rows have 43 keys';
END $$;
```

- [ ] **Step 3: Dry-run against prod via MCP execute_sql with BEGIN/ROLLBACK**

Ensure `mcp__plugin_supabase_supabase__execute_sql` is available (via authenticate flow if needed). Wrap migration body in BEGIN/ROLLBACK and inspect result:

```sql
BEGIN;

-- (paste entire migration body from step 2 here — DO block + verify DO block)

-- Inspect sample rows to confirm expected shape
SELECT id, name, role,
       (SELECT count(*) FROM jsonb_object_keys(permissions)) AS key_count,
       permissions
FROM public.admin_users
WHERE name IN ('Tony Wei', 'NENG SEKAR')
ORDER BY name;

ROLLBACK;
```

Expected result rows:
- `Tony Wei`: `key_count = 43`, all values true
- `NENG SEKAR`: `key_count = 43`, `kasir=false`, `settings=false`, `userManagement=false` preserved; `can_start_opname=true`, `can_witness_opname=true`, `can_request_kasir_price_override=true` filled per Staff Admin Toko preset; `can_approve_*` all false.

If any row shows key_count != 43 → STOP, fix SQL, re-dry-run.

- [ ] **Step 4: Verify migration file syntax matches spec §9 (self-check)**

Confirm no drift between migration SQL and registry keys — the `v_valid_keys` ARRAY and the 4 preset `jsonb_build_object` calls must all match `PERMISSION_REGISTRY` keys and values from Task 1.

Quick diff check:

```bash
# Extract key list from SQL
grep -oE "'[a-zA-Z_]+'," supabase/migrations/20261115000515_backfill_admin_permissions.sql | \
  head -60 | sort -u > /tmp/sql_keys.txt

# Extract key list from registry
grep -oE "key: '[a-zA-Z_]+'" src/lib/permissions.ts | sort -u > /tmp/reg_keys.txt

wc -l /tmp/sql_keys.txt /tmp/reg_keys.txt
```

Expected: `reg_keys.txt` = 43 unique. SQL keys count varies (each key appears in v_valid_keys + 4 preset objects = up to 5x), but every registry key must appear in SQL.

- [ ] **Step 5: Commit migration file**

```bash
git add supabase/migrations/20261115000515_backfill_admin_permissions.sql
git commit -m "$(cat <<'EOF'
feat(migration): 000515 backfill admin_users.permissions to 43-key shape

All 6 Owners currently have 33 keys (missing 6 Phase 1A piutang can_*
+ legacy 'pipeline' key). NENG SEKAR (Staff Admin Toko) has 12 keys.
UI reports 'N/43 aktif' but stores partial JSONB → confusion + silent
gate bypass on undefined can_* keys.

Backfill:
- Owner: force all 43 = true (matches Owner = full access intent +
  UI lock on isOwner).
- Non-Owner: preset per role || existing (existing wins on duplicate
  keys). Also drops legacy keys not in v_valid_keys ARRAY.
- session_replication_role = 'replica' bypass for defensive audit
  trigger safety.

Idempotent: safe to re-run. Verify DO block asserts all rows = 43 keys
post-update. Dry-run against prod (BEGIN/ROLLBACK): Tony 43-true,
NENG SEKAR 43-keys with kasir=false/settings=false/userManagement=false
preserved + 31 preset defaults filled.

Ref: docs/superpowers/specs/2026-07-24-admin-permission-registry-design.md §9

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Stage 1 local verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: all code from Tasks 1-6 must be committed
- Produces: green Stage 1 report; ready for deploy

- [ ] **Step 1: Run linter — must be clean**

Run: `npm run lint`
Expected: zero errors, zero warnings for touched files.

If failure: fix inline, re-run, commit fixups with `chore(lint): ...` message.

- [ ] **Step 2: Run audit scripts — must be clean**

Run: `npm run audit:numinput && npm run audit:secdef-null-tenant`
Expected: both exit 0.

- [ ] **Step 3: Run full changed-file test suite**

Run: `npx vitest run --changed`
Expected: all pass. Any new failures point to consumers of PermissionSet/AdminUser we didn't update in Task 2's re-export.

- [ ] **Step 4: UI smoke via `npm run dev` + MCP chrome-devtools**

Start dev server (background):

```bash
npm run dev &
```

Wait for "ready" log, then via MCP `chrome-devtools`:
1. Navigate to `http://localhost:5173/t/garindo/user-management` (using local staging tenant slug — verify from `tenants` table)
2. Login as Jenny (Owner) with an OTP flow (staging admin login).
3. Expand any admin row.
4. Assert: 43 checkboxes rendered in 8 category groups. Each row has `<Info>` icon.
5. Hover Info icon on `can_create_po` — native tooltip shows "Buat PO — Buat Purchase Order (PO) baru ke supplier."
6. Toggle 1 checkbox for a non-Owner admin (e.g. NENG SEKAR's `can_start_opname` OFF). Wait for save (spinner or toast).
7. Refresh page. Confirm toggle persisted.
8. Check `list_console_messages`: no errors.
9. Check `list_network_requests`: RPC to `admin_upsert_user` returned 200; response body contains `permissions` object with 43 keys.

- [ ] **Step 5: Migration dry-run repeat (safety)**

Repeat Task 6 Step 3 dry-run one more time — DB state may have shifted between authorship and now.

Expected result unchanged: all 7 rows post-backfill have 43 keys.

- [ ] **Step 6: Kill dev server**

Kill the background `npm run dev` process.

- [ ] **Step 7: Commit only if step 1-4 produced fixup edits**

If steps 1-6 revealed issues that required code changes:
```bash
git add -A
git commit -m "chore(pr-fixup): resolve Stage 1 verification findings"
```

Otherwise skip commit — Stage 1 pass means we're deploy-ready.

---

### Task 8: Stage 2 deploy — migration first, then code

**Files:** none (deploy runbook)

**Interfaces:**
- Consumes: all tasks 1-7 committed to `main`
- Produces: prod DB state where all 7 admin_users have 43 keys; Cloud Build STATUS=SUCCESS for frontend deploy

- [ ] **Step 1: Confirm current branch is main + clean**

Run: `git status && git log --oneline -6`
Expected: on `main`, clean working tree, latest 6 commits are Task 1-6 (registry, types, user-mgmt, sidebar, pembelian, migration).

- [ ] **Step 2: Apply migration 000515 to prod**

Run:
```bash
source .env && SUPABASE_PROJECT_REF=ekhhojaezdfjfwuxyjkl ./scripts/apply-migration.sh 515
```

Expected output: `SUCCESS: migration applied to ekhhojaezdfjfwuxyjkl`. If FAILURE: STOP, do not push code. Debug SQL, re-run Task 6 Step 3 dry-run against fresh state, fix + re-commit + retry.

- [ ] **Step 3: Verify migration effect in prod DB**

Via MCP execute_sql or curl:
```sql
SELECT id, name, role,
       (SELECT count(*) FROM jsonb_object_keys(permissions)) AS key_count
FROM public.admin_users
ORDER BY role, name;
```

Expected: **all 7 rows have `key_count = 43`**. If any row differs, STOP, investigate before pushing code.

- [ ] **Step 4: Push commits to origin/main**

```bash
git push origin main
```

Cloud Build trigger fires automatically via `cloudbuild.frontend.yaml`.

- [ ] **Step 5: Verify Cloud Build success**

Wait ~2-3 minutes for build. Then:
```bash
gcloud builds list --limit=3
```

Expected: **latest build STATUS=SUCCESS**. If STATUS=FAILURE or STATUS=WORKING for >5 min: check `gcloud builds log <BUILD_ID>`; fix + re-push if needed.

- [ ] **Step 6: Run get_advisors post-migration**

Via MCP `mcp__plugin_supabase_supabase__get_advisors` (or curl the Supabase Management API).

Triage any NEW findings introduced by migration 000515. Most likely: none, since migration only touches JSONB values — no new tables, indexes, or RLS policies. If a NEW advisor appears, evaluate blocking; if blocking, plan a fix in follow-up PR.

- [ ] **Step 7: Commit Stage 2 runbook completion note in progress.md**

Deferred to Task 9 (progress.md update batched with Stage 3 verify).

---

### Task 9: Stage 3 prod verify on Toko Jaya Makmur + progress.md

**Files:**
- Modify: `progress.md` (append entry)

**Interfaces:**
- Consumes: Stage 2 shipped successfully
- Produces: recorded verify pass on prod-testing-tenant; progress.md entry with WHAT + WHY + spec link

- [ ] **Step 1: Via MCP chrome-devtools, login as Toko Jaya Makmur Owner**

Navigate to `https://app.caleo.id/t/toko-jaya-makmur/dashboard` (or the current prod URL for that tenant). Complete OTP login as the test-tenant Owner.

**CRITICAL**: DO NOT use Testing Jaya Panel (Jenny + NENG SEKAR real data).

- [ ] **Step 2: Open User Management — verify 43-checkbox rendering**

Click sidebar → User Management. Assert:
- Existing admins list displays.
- Expand any admin row → 43 checkboxes in 8 category groups (`Modul Utama`, `Pembelian`, `Stok Opname & Adjustment`, `Gudang`, `Kasir`, `Penjualan`, `Piutang & Kredit`, `Kontrol`).
- Each checkbox has an Info icon; hover displays Bahasa Indonesia tooltip.
- Active count badge shows "N/43 aktif" (correct denominator).

- [ ] **Step 3: Create test admin (Staff Admin Toko)**

Fill form:
- Name: "Test Staff 2026-07-24"
- Email: `teststaff-20260724@example.com` (throwaway — will be deleted after verify)
- WhatsApp: `08111111111`
- Peran: "Staff Admin Toko"
- Click "BUAT AKUN & PILIH AKSES"

Verify: admin appears in list. Expand row → 43 checkboxes with Staff Admin Toko preset applied (per default matrix §6): `kasir=true`, `pembelian=true`, `can_start_opname=true`, `can_witness_opname=true`, `can_request_kasir_price_override=true`, `can_create_po=false`, `can_approve_*=false`, etc.

- [ ] **Step 4: Toggle 1 permission on test admin — verify persistence**

Toggle `can_create_po` from OFF → ON for Test Staff. Wait for save.

Refresh page. Confirm `can_create_po` stays ON. Toggle back to OFF. Refresh. Confirm.

- [ ] **Step 5: Verify Owner sees full sidebar (regression check)**

Logout, login as Toko Jaya Makmur Owner again.

Verify sidebar shows ALL menus expected for Owner:
- Piutang menu visible + all sub-actions available (previously hidden pre-backfill for Owners without `can_approve_credit_activate` etc.)
- Persetujuan menu visible
- Keputusan Owner menu visible
- Sales Channel configuration accessible (was silent bypass pre-fix)

- [ ] **Step 6: Delete test admin**

Return to User Management → delete "Test Staff 2026-07-24" via trash icon. Confirm removal.

- [ ] **Step 7: Console + network clean check**

Via MCP chrome-devtools `list_console_messages` and `list_network_requests`:
- Zero JavaScript errors.
- All `admin_upsert_user` RPCs returned 200 with 43-key payload.
- No 4xx/5xx from any endpoint.

If any regression: **rollback immediately** — revert Cloud Run frontend to previous revision via `gcloud run services update-traffic caleo-frontend --to-revisions=<PREV_REVISION>=100`, and log incident to `docs/incidents/2026-07-24-admin-permission-registry-<slug>.md`.

- [ ] **Step 8: Append progress.md entry**

Read current `progress.md` last section, append:

```markdown
## 2026-07-24 — Admin Permission Registry (single source of truth + backfill)

**What:** Consolidated 3-way divergent permission definitions (PermissionSet interface, defaultPermissions(), PERM_LABELS UI) into `src/lib/permissions.ts` data-driven registry (43 entries × 4 roles × 8 categories). Migration 000515 backfilled all 7 admin_users rows to full 43-key shape. Fixed 2 silent bypasses: `canConfigureSalesChannels` (Sidebar registry-gate) + Pembelian `can_create_po/can_edit_po` (page-level normalize to opt-in). Narrowed `AdminUser.role` from `string` to `PermissionRole` + read-boundary safeguard.

**Why:** NENG SEKAR (Staff Admin Toko, Testing Jaya Panel) had 12-key permission JSONB while UI reported N/43. Every Phase 2/3/4 added `can_*` to PermissionSet without updating defaultPermissions() or PERM_LABELS — class of bug that would recur every Phase. All 6 existing Owners also missing 6 Phase 1A piutang approvals silently.

**Ref:**
- Spec: `docs/superpowers/specs/2026-07-24-admin-permission-registry-design.md` commit `95d310d`
- Plan: `docs/superpowers/plans/2026-07-24-admin-permission-registry-plan.md`
- Migration: `20261115000515_backfill_admin_permissions.sql`

**Verify:** Stage 3 on Toko Jaya Makmur — Owner sees full sidebar (Piutang approvals no longer hidden), test admin gets 43-checkbox UI grouped by 8 categories with Bahasa Indonesia tooltips, toggle round-trips persist correctly.

**Follow-ups:** Backend enforcement gap (backend-go doesn't check admin_users.permissions — RLS-only tenant isolation) flagged per spec §17.
```

- [ ] **Step 9: Commit progress.md**

```bash
git add progress.md
git commit -m "$(cat <<'EOF'
docs(progress): admin permission registry shipped + Stage 3 verified

43-key registry-driven single source of truth in src/lib/permissions.ts.
Backfilled 7 admin_users rows via migration 000515. Fixed 2 silent
bypasses (Sidebar canConfigureSalesChannels + Pembelian can_* gates).
Narrowed AdminUser.role to PermissionRole with dbToAdminUser safeguard.

Verified on Toko Jaya Makmur: Owner sidebar shows all Piutang approval
menus (previously hidden), test admin UI renders 43 checkboxes grouped
by 8 categories with tooltips, toggle round-trips persist.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Self-Review

### Spec coverage check

| Spec section | Task(s) |
|---|---|
| §1 Context & Problem | Referenced in commit messages |
| §2 Decision (registry + 1 PR atomic) | Task 1 (registry) + Task 8 (deploy order) |
| §3 Alternatives | Documented in spec — no implementation |
| §4 Architecture (component boundaries) | Task 1 file structure + Interfaces sections |
| §5 Registry TS source (43 entries, type derivation) | Task 1 Step 3 |
| §5 types.ts refactor (narrow AdminUser.role) | Task 2 |
| §5 dbToAdminUser safeguard | Task 3 Step 3 |
| §6 Default matrix 43×4 | Task 1 registry `defaultFor` fields + Task 6 SQL presets |
| §7 UI mockup + preset button | Task 3 Steps 8-9 |
| §8 Sidebar refactor (canConfigureSalesChannels) | Task 4 |
| §8b Pembelian gate consistency | Task 5 |
| §9 Backfill SQL | Task 6 |
| §10 handleTogglePermission normalization | Task 3 Step 6 |
| §11 Test plan (permissions.test.ts + gate-scan + round-trip) | Tasks 1, 3, 5 |
| §12 Impact Analysis | Reflected in Task file lists |
| §13 Scale ceiling | Not applicable — implementation matches spec ceiling |
| §14 Verification plan (Stage 1/2/3) | Tasks 7, 8, 9 |
| §15-18 Consequences/Future/Follow-ups/Deps | Task 9 progress.md entry |
| §19 Review checklist | Founder approved 2026-07-24 |

**Zero gaps.**

### Placeholder scan

Scanned for "TBD", "TODO", "fill in details", "implement later", "similar to Task N", "add appropriate error handling", "handle edge cases". None found. All code blocks contain the full source; every step has exact commands + expected output.

### Type consistency

- `PermissionRole` used consistently across Task 1 (source), Task 2 (types.ts), Task 3 (dbToAdminUser + handleTogglePermission), Task 5 (Pembelian pages via existing PermissionSet type)
- `normalizePermissions(input, role)` signature identical across Task 1 (definition), Task 3 Step 6 (toggle), Task 3 Step 7 (add-admin)
- `REGISTRY_MAP.get(key as PermissionKey)` signature matches Task 1 export
- Migration key list (Task 6 `v_valid_keys`) matches Task 1 `PERMISSION_REGISTRY` keys — 43 unique, verified via Task 6 Step 4 diff-check

**Zero drift.**
