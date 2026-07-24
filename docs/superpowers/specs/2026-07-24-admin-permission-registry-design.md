# Admin Permission Registry — Design Spec

**Date:** 2026-07-24
**Author:** Claude (via founder session)
**Reversibility:** Semi-reversible — schema tetap `admin_users.permissions JSONB`; hanya UI/registry + backfill data. Rollback = revert commits + revert backfill via idempotent re-run.
**Migration slot claim:** `20261115000515` (block `000515-000534` reserved untuk track ini)
**Advisor consulted:** Yes (pre-spec, 2026-07-24). All 8 gaps addressed in this doc.

---

## 1. Context & Problem Statement

### Symptom (surface)
Founder complaint 2026-07-24:
> "sudah bisa login adminnya, tapi adminnya tidak sesuai dengan fitur yang di assign"

NENG SEKAR (Staff Admin Toko, tenant Testing Jaya Panel) di-onboard oleh Jenny (Owner). Setelah login, sidebar-nya tidak menunjukkan fitur yang diharapkan Owner sudah assign.

### Root cause (verified)

Query DB terhadap `admin_users`:

```
NENG SEKAR (Staff Admin Toko): 12 permission keys stored
Tony Wei    (Owner):           33 permission keys stored
Jenny       (Owner):           33 permission keys stored
Other 4 Owners:                33 permission keys stored each
Current PermissionSet interface: 43 keys
```

3 source-of-truth divergen:

1. **`src/types.ts:6-59`** — `PermissionSet` interface (43 keys, source of truth intent)
2. **`src/components/UserManagementScreen.tsx:51-72`** — `defaultPermissions(role)` hardcoded per-role, hanya set 12 keys
3. **`src/components/UserManagementScreen.tsx:86-99`** — `PERM_LABELS` UI checkbox list, hanya 12 items

Setiap kali Phase 2/3/4 menambah action perm baru di `PermissionSet`, developer hanya update #1 dan lupa #2/#3. Efek:

- **Semua non-Owner** (dibuat via UI): default hanya 12 keys, 31 action keys `undefined` → Sidebar `isPermVisible` menghitung `value === true` untuk `can_*` → hidden. NENG SEKAR tidak bisa lihat Stok Opname, Manajemen Gudang, Transfer Gudang, Persetujuan, Keputusan Owner, dll.
- **Semua Owner** (dibuat sebelum Phase 1A): 33 keys, missing 6 piutang action perms (`can_request_credit_activate`, `can_approve_credit_activate`, `can_request_limit_change`, `can_approve_limit_change`, `can_request_deactivate`, `can_approve_deactivate`) + 4 legacy keys (`pembelian`, `kasir`, `piutang`, `reconciliation` are actually present but `pipeline` is a renamed-away legacy). Owner tidak bisa approve credit activate / limit change / deactivate.
- **`canConfigureSalesChannels`** — naming camelCase tanpa `can_` underscore. `Sidebar.tsx:129` gate `key.startsWith('can_')` return **false** untuk key ini → treated as legacy → visible-by-default untuk semua admin. **Silent security bypass**: setiap admin bisa configure sales channels tanpa izin explicit.

### Class of bug

Bukan bug tunggal — kelas bug yang akan recur setiap Phase menambah perm baru. Root fix harus **eliminasi 3-way drift permanently**.

---

## 2. Decision

Adopsi **Data-Driven Permission Registry** — single source of truth di `src/lib/permissions.ts` yang:

- Deklarasi 43 permission entries dengan `{key, label, category, description, defaultFor: {Owner, SupervisorGudang, StaffAdminToko, FinanceManager}, isActionPerm}`
- `PermissionSet` interface, `ALL_PERMISSIONS`, `defaultPermissions(role)`, UI checkbox rendering, dan Sidebar gate — **semua derive dari registry**
- Tambah perm baru = 1 entry di registry → interface, defaults, UI, dan gate update simultaneously
- Storage tetap per-user JSONB (`admin_users.permissions`) untuk preserve founder's requirement "owner bebas mix-and-match perms per admin"

### Ship strategy

**1 PR atomic** — registry + type derivation + UI refactor + Sidebar refactor + backfill migration + tests. Prevent split-brain (backfill kasih 43 keys tapi UI cuma tampilkan 12).

### Backfill strategy

- **6 existing Owners**: force `permissions = <all-43-true>`. Konsisten dengan intent "Owner = full access" + UI sudah lock `isOwner` toggle (`UserManagementScreen.tsx:485`).
- **NENG SEKAR (dan future non-Owner)**: preserve 12 existing values, fill 31 missing per preset default untuk role tersebut. SQL pattern: `defaults_for_role || existing_permissions` (right-side wins for duplicate keys).
- **Strip legacy keys**: `pipeline` dan key lain yang tidak ada di registry — remove from JSONB in same migration.

---

## 3. Alternatives Considered

### Tingkat 1 — Registry client-side (chosen)
- ✅ Zero cost, zero infra, zero dependency
- ✅ Solves 3-way drift class of bug
- ✅ Kompatibel dengan founder's flexibility requirement
- ⚠️ Per-user JSONB storage tetap — tambah perm baru di future tetap butuh backfill N rows (acceptable at current 7 admins; flag for revisit at 500+ admins)

### Tingkat 2 — Role-based DB + per-user override
- Schema: `roles (id, name, permissions jsonb)`, `admin_users.role_id + permissions_override jsonb`
- ✅ Tambah perm baru = update 4 roles rows, no per-admin backfill
- ✅ Better scaling to 10K+ admins
- ❌ Bigger migration (~1 hari), 3 migrations sequential (create table, backfill, cutover)
- ❌ Sebelum implementasi UI dituntaskan, tidak add value karena founder tetap butuh per-admin toggle
- **Deferred**: dijadikan "Future Work" (see §12). Registry adalah stepping-stone yang kompatibel — Tingkat 2 nanti bisa tambah `roles` table + derive `permissions` dari registry sebagai preset templates.

### Tingkat 3 — Policy engine (CASL/Casbin/Cedar)
- ❌ Overkill — perms kamu semua boolean flat, tidak butuh conditional/time-based rules
- ❌ Bundle size +50KB (CASL) + learning curve
- ❌ Not zero cost (integration effort)
- **Rejected**: YAGNI

---

## 4. Architecture

### Component boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  src/lib/permissions.ts   (SINGLE SOURCE OF TRUTH)          │
│                                                              │
│  export const PERMISSION_REGISTRY = [ ...43 entries ] as const│
│  export const PERM_CATEGORIES     = [ 8 categories ]         │
│  export const PERMISSION_ROLES    = [ 4 roles ]              │
│                                                              │
│  export function defaultPermissions(role): PermissionSet     │
│  export function normalizePermissions(input): PermissionSet  │
│  export const ALL_PERMISSIONS: PermissionSet                 │
└─────────────────────────────────────────────────────────────┘
       ▲                    ▲                       ▲
       │ derives            │ derives               │ derives
       │                    │                       │
┌──────┴──────┐   ┌─────────┴───────────┐   ┌──────┴─────────┐
│ types.ts    │   │ UserManagement       │   │ Sidebar.tsx    │
│ Permission  │   │ Screen.tsx           │   │ isPermVisible  │
│ Set = ...   │   │ checkbox render loop │   │ (via registry) │
└─────────────┘   └──────────────────────┘   └────────────────┘
```

Consumers baca dari registry; tidak ada duplikasi keys.

### Data flow (create/edit admin)

```
Founder fills form  →  handleCreateAdmin / handleTogglePermission
                    →  normalizePermissions({...adm.permissions, [key]: value})
                       └── returns full 43-key object (missing → default per role)
                    →  admin_upsert_user RPC (REPLACE semantics)
                    →  DB row always has 43 keys
```

**Invariant (critical, enforce via test):**
> Setiap call ke `admin_upsert_user` HARUS kirim `p_permissions` yang berisi semua 43 keys defined (bukan undefined). `normalizePermissions()` adalah bottleneck function yang menjamin ini.

### Sidebar gate refactor

Sekarang (`Sidebar.tsx:126-133`):
```ts
const isPermVisible = (key) => {
  if (!perms) return true;
  const value = perms[key];
  if (typeof key === 'string' && key.startsWith('can_')) {
    return value === true;   // opt-in gate
  }
  return value !== false;    // legacy default-visible
};
```

Refactor menjadi (import registry):
```ts
import { PERMISSION_REGISTRY } from '../lib/permissions';
const REGISTRY_MAP = new Map(PERMISSION_REGISTRY.map(p => [p.key, p]));

const isPermVisible = (key) => {
  if (!perms) return true;
  const entry = REGISTRY_MAP.get(key);
  if (!entry) return true;              // unknown key → default visible (safe)
  const value = perms[key];
  return entry.isActionPerm ? value === true : value !== false;
};
```

**Fixes `canConfigureSalesChannels` silent bypass**: entry marks `isActionPerm: true`, gate menjadi opt-in tanpa rely pada string prefix.

---

## 5. Registry TypeScript Source (full 43 entries)

```ts
// src/lib/permissions.ts
// SINGLE SOURCE OF TRUTH untuk admin permissions.
// Tambah permission baru: 1 entry di sini → interface, defaults, UI, sidebar
// gate auto-update. Zero drift antara sumber.

export type PermissionKey =
  | 'dashboard' | 'salesInbox' | 'laporan' | 'aiStock' | 'pelanggan'
  | 'orderHistory' | 'userManagement' | 'whatsappAi' | 'notifications'
  | 'settings' | 'pembelian' | 'kasir' | 'piutang' | 'reconciliation'
  | 'can_create_po' | 'can_edit_po' | 'can_witness_po_receipt'
  | 'can_start_opname' | 'can_witness_opname' | 'can_commit_opname'
  | 'can_request_adjustment' | 'can_approve_adjustment'
  | 'can_request_price_change' | 'can_approve_price_change'
  | 'can_open_kasir_shift'
  | 'can_request_kasir_price_override' | 'can_approve_kasir_price_override'
  | 'can_request_kasir_void' | 'can_approve_kasir_void'
  | 'can_request_kasir_refund' | 'can_approve_kasir_refund'
  | 'can_override_price_floor'
  | 'can_initiate_transfer' | 'can_receive_transfer'
  | 'can_manage_warehouses' | 'can_view_pengawasan'
  | 'canConfigureSalesChannels'
  | 'can_request_credit_activate' | 'can_approve_credit_activate'
  | 'can_request_limit_change' | 'can_approve_limit_change'
  | 'can_request_deactivate' | 'can_approve_deactivate';

export type PermissionSet = Record<PermissionKey, boolean>;

export type PermissionRole =
  | 'Owner' | 'Supervisor Gudang' | 'Staff Admin Toko' | 'Finance Manager';

export type PermissionCategory =
  | 'Modul Utama' | 'Pembelian' | 'Stok Opname & Adjustment'
  | 'Gudang' | 'Kasir' | 'Penjualan' | 'Piutang & Kredit' | 'Kontrol';

export interface PermissionEntry {
  key: PermissionKey;
  label: string;
  category: PermissionCategory;
  description: string;             // Bahasa Indonesia, MSME tone
  isActionPerm: boolean;           // true = opt-in gate (hidden unless true)
  defaultFor: Record<PermissionRole, boolean>;
}

export const PERMISSION_ROLES: PermissionRole[] = [
  'Owner', 'Supervisor Gudang', 'Staff Admin Toko', 'Finance Manager',
];

export const PERM_CATEGORIES: PermissionCategory[] = [
  'Modul Utama', 'Pembelian', 'Stok Opname & Adjustment', 'Gudang',
  'Kasir', 'Penjualan', 'Piutang & Kredit', 'Kontrol',
];

export const PERMISSION_REGISTRY: readonly PermissionEntry[] = [
  // ─── Modul Utama (10) ─────────────────────────────────────────
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

  // ─── Pembelian (4) ────────────────────────────────────────────
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

  // ─── Stok Opname & Adjustment (7) ─────────────────────────────
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

  // ─── Gudang (3) ───────────────────────────────────────────────
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

  // ─── Kasir (9) ────────────────────────────────────────────────
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

  // ─── Penjualan (1) ────────────────────────────────────────────
  { key: 'canConfigureSalesChannels', label: 'Atur Channel Penjualan', category: 'Penjualan',
    description: 'Atur channel penjualan (marketplace, offline, WA).',
    isActionPerm: true,   // FIX: silent bypass — was treated as legacy visible
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': false } },

  // ─── Piutang & Kredit (7) ─────────────────────────────────────
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

  // ─── Kontrol (2) ──────────────────────────────────────────────
  { key: 'reconciliation', label: 'Rekonsiliasi & Tutup Buku', category: 'Kontrol',
    description: 'Rekonsiliasi bank + tutup buku bulanan.',
    isActionPerm: false,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': true } },
  { key: 'can_view_pengawasan', label: 'Lihat Pengawasan (Audit)', category: 'Kontrol',
    description: 'Lihat modul Pengawasan (audit log semua aksi).',
    isActionPerm: true,
    defaultFor: { 'Owner': true, 'Supervisor Gudang': false, 'Staff Admin Toko': false, 'Finance Manager': true } },
];

// ─── Derived exports ────────────────────────────────────────────
export const ALL_PERMISSIONS: PermissionSet = Object.freeze(
  Object.fromEntries(PERMISSION_REGISTRY.map(p => [p.key, true]))
) as PermissionSet;

export function defaultPermissions(role: PermissionRole): PermissionSet {
  return Object.fromEntries(
    PERMISSION_REGISTRY.map(p => [p.key, p.defaultFor[role]])
  ) as PermissionSet;
}

/**
 * Normalize any partial permission object into a full 43-key PermissionSet.
 * Used at every save path (toggle, preset-fill, form-submit) to prevent
 * RPC REPLACE from dropping keys that weren't in the input.
 *
 * Missing keys default to `role`-based defaults; unknown keys are dropped.
 */
export function normalizePermissions(
  input: Partial<PermissionSet> | Record<string, unknown>,
  role: PermissionRole
): PermissionSet {
  const defaults = defaultPermissions(role);
  return Object.fromEntries(
    PERMISSION_REGISTRY.map(p => [
      p.key,
      typeof input?.[p.key] === 'boolean' ? Boolean(input[p.key]) : defaults[p.key],
    ])
  ) as PermissionSet;
}

/** Registry lookup for O(1) sidebar gate check. */
export const REGISTRY_MAP: ReadonlyMap<PermissionKey, PermissionEntry> = new Map(
  PERMISSION_REGISTRY.map(p => [p.key, p])
);
```

**43 entries × 4 roles verified count**: Modul 10 + Pembelian 4 + Opname 7 + Gudang 3 + Kasir 9 + Penjualan 1 + Piutang 7 + Kontrol 2 = **43** ✓

### `types.ts` refactor

```ts
// src/types.ts (before line 6):
export type { PermissionSet, PermissionKey } from './lib/permissions';
export { ALL_PERMISSIONS } from './lib/permissions';
// remove old PermissionSet interface (lines 6-59) and ALL_PERMISSIONS const (lines 61-105)
```

---

## 6. Default Matrix (43 × 4)

| Key | Owner | Supervisor Gudang | Staff Admin Toko | Finance Manager |
|---|:-:|:-:|:-:|:-:|
| **Modul Utama** | | | | |
| dashboard | ✅ | ✅ | ✅ | ✅ |
| salesInbox | ✅ | ⬜ | ✅ | ✅ |
| laporan | ✅ | ✅ | ✅ | ✅ |
| aiStock | ✅ | ✅ | ⬜ | ⬜ |
| pelanggan | ✅ | ⬜ | ✅ | ✅ |
| orderHistory | ✅ | ⬜ | ✅ | ✅ |
| userManagement | ✅ | ⬜ | ⬜ | ⬜ |
| whatsappAi | ✅ | ⬜ | ⬜ | ⬜ |
| notifications | ✅ | ✅ | ✅ | ✅ |
| settings | ✅ | ⬜ | ⬜ | ⬜ |
| **Pembelian** | | | | |
| pembelian | ✅ | ✅ | ✅ | ⬜ |
| can_create_po | ✅ | ✅ | ⬜ | ⬜ |
| can_edit_po | ✅ | ✅ | ⬜ | ⬜ |
| can_witness_po_receipt | ✅ | ✅ | ✅ | ⬜ |
| **Stok Opname & Adjustment** | | | | |
| can_start_opname | ✅ | ✅ | ✅ | ⬜ |
| can_witness_opname | ✅ | ✅ | ✅ | ⬜ |
| can_commit_opname | ✅ | ⬜ | ⬜ | ⬜ |
| can_request_adjustment | ✅ | ✅ | ⬜ | ⬜ |
| can_approve_adjustment | ✅ | ⬜ | ⬜ | ⬜ |
| can_request_price_change | ✅ | ⬜ | ✅ | ⬜ |
| can_approve_price_change | ✅ | ⬜ | ⬜ | ✅ |
| **Gudang** | | | | |
| can_manage_warehouses | ✅ | ✅ | ⬜ | ⬜ |
| can_initiate_transfer | ✅ | ✅ | ⬜ | ⬜ |
| can_receive_transfer | ✅ | ✅ | ⬜ | ⬜ |
| **Kasir** | | | | |
| kasir | ✅ | ⬜ | ✅ | ⬜ |
| can_open_kasir_shift | ✅ | ⬜ | ✅ | ⬜ |
| can_request_kasir_price_override | ✅ | ⬜ | ✅ | ⬜ |
| can_approve_kasir_price_override | ✅ | ⬜ | ⬜ | ⬜ |
| can_request_kasir_void | ✅ | ⬜ | ✅ | ⬜ |
| can_approve_kasir_void | ✅ | ⬜ | ⬜ | ⬜ |
| can_request_kasir_refund | ✅ | ⬜ | ✅ | ⬜ |
| can_approve_kasir_refund | ✅ | ⬜ | ⬜ | ✅ |
| can_override_price_floor | ✅ | ⬜ | ⬜ | ⬜ |
| **Penjualan** | | | | |
| canConfigureSalesChannels | ✅ | ⬜ | ⬜ | ⬜ |
| **Piutang & Kredit** | | | | |
| piutang | ✅ | ⬜ | ⬜ | ✅ |
| can_request_credit_activate | ✅ | ⬜ | ✅ | ✅ |
| can_approve_credit_activate | ✅ | ⬜ | ⬜ | ✅ |
| can_request_limit_change | ✅ | ⬜ | ✅ | ✅ |
| can_approve_limit_change | ✅ | ⬜ | ⬜ | ✅ |
| can_request_deactivate | ✅ | ⬜ | ⬜ | ✅ |
| can_approve_deactivate | ✅ | ⬜ | ⬜ | ✅ |
| **Kontrol** | | | | |
| reconciliation | ✅ | ⬜ | ⬜ | ✅ |
| can_view_pengawasan | ✅ | ⬜ | ⬜ | ✅ |

**Rationale summary:**
- **Owner** = full access (locked in UI, cannot be un-ticked)
- **Supervisor Gudang** = gudang/stok/opname/PO create + witness, no approve, no financial, no kasir
- **Staff Admin Toko** = front-of-shop (kasir request-tier actions, opname start+witness, order/customer basic, credit request), no approve
- **Finance Manager** = all approve-financial (credit, refund, price change), reports/piutang/reconciliation, no operational stock changes

**Approve authority pattern**: All `can_approve_*` = Owner-only EXCEPT financial-domain (price_change, kasir_refund, all piutang approvals) which extend to Finance Manager. Rationale: separation of duties — Finance approves money-side, Owner approves stock-side.

**Founder review**: silakan tinjau baris demi baris. Edit inline via komentar; saya apply sebelum implementation.

---

## 7. UI Layout (mockup — reuse existing design system)

```
FORM ADD ADMIN (kiri, sudah ada UserManagementScreen.tsx:280-388)
┌─────────────────────────────────────────────────────────────┐
│ Tambah Admin Baru                                            │
│                                                              │
│ Nama       [__________________________]                      │
│ Email      [__________________________]                      │
│ WhatsApp   [__________________________]                      │
│ Peran      [Staff Admin Toko          ▼]                     │
│            [ Isi Preset ]  ← NEW button (bg-[#012749])       │
│                                                              │
│ [ BUAT AKUN & PILIH AKSES ]                                  │
└─────────────────────────────────────────────────────────────┘

EXPANDED ADMIN ROW (kanan, refactor UserManagementScreen.tsx:472-503)
┌─────────────────────────────────────────────────────────────┐
│ [N] NENG SEKAR                Staff Admin Toko  17/43 aktif ▼│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ MODUL UTAMA                          ← category header       │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│ │ ⓘ Dashboard │ │ⓘ Sales Inbox│ │ⓘ Laporan    │          │
│ │           ●─│ │           ●─│ │           ●─│          │
│ └──────────────┘ └──────────────┘ └──────────────┘          │
│ ... (rest of Modul Utama)                                    │
│                                                              │
│ PEMBELIAN                                                    │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│ │ⓘ Modul PO   │ │ⓘ Buat PO    │ │ⓘ Edit PO    │          │
│ │           ●─│ │           ─●│ │           ─●│          │
│ └──────────────┘ └──────────────┘ └──────────────┘          │
│                                                              │
│ (... 6 more categories)                                      │
└─────────────────────────────────────────────────────────────┘

Hover ⓘ Info icon → native browser tooltip:
   "Buat PO — Buat Purchase Order (PO) baru ke supplier."
```

### Reused components (no recreate)

| Element | Source | Usage |
|---|---|---|
| Toggle switch | `UserManagementScreen.tsx:489-498` iOS-style peer div | 43× per admin row |
| Card row + collapsible | `UserManagementScreen.tsx:436-503` `expandedId` state | unchanged |
| Grid layout | `UserManagementScreen.tsx:480` `grid-cols-2 sm:grid-cols-3 gap-3` | unchanged |
| Category header | New — reuse existing typography `text-[10px] font-bold text-slate-500 uppercase tracking-wider` (dipakai di berbagai screen) | NEW usage, existing token |
| Tooltip | Native `title="..."` (10+ existing use sites: KasirScreen, PengaturanScreen, Sidebar, etc.) | 43× per row |
| Info icon | `lucide-react` `<Info>` (library already imported for Crown, ChevronDown, Trash2) | 43× per row |
| Owner disabled state | `opacity-60 cursor-not-allowed` + Crown badge | unchanged |
| Design tokens | Navy `#012749`, blue `#eff4ff`/`#abc9f3`, border `#e5eeff`, green toggle `#2d8a4e`, form button styling | unchanged |

**Preset button behavior (scope: new-admin form only):**
- Muncul di form kiri (add-admin) di samping dropdown "Peran"
- Click → checkbox di preview section (jika ada di form add) atau langsung apply saat "BUAT AKUN" ditekan
- Untuk **new admin**: `handleAddAdmin` sudah panggil `defaultPermissions(newRole)` — button explicit sebagai UX affordance (owner tahu preset akan diterapkan)
- Untuk **existing admin** (expanded row): TIDAK ada preset button di Phase 1 — kalau owner mau reset, edit checkbox manual atau delete+recreate admin. "Reset to preset" per-row button deferred sampai founder request

**Category collapsibility** (deferred — add kalau founder feedback UI kepanjangan setelah ship): pakai native `<details><summary>` pattern (existing di `ApprovalRulesPanel.tsx:173`). Untuk PR ini semua kategori expanded — 43 items dalam 8 grup fit reasonably di layar desktop.

---

## 8. Sidebar Refactor

**File**: `src/components/Sidebar.tsx:126-133`

**Change**:
```diff
+ import { REGISTRY_MAP, type PermissionKey } from '../lib/permissions';

  const isPermVisible = (key: keyof PermissionSet): boolean => {
    if (!perms) return true;
+   const entry = REGISTRY_MAP.get(key as PermissionKey);
+   if (!entry) return true;                        // unknown key = default visible (safe fallback)
    const value = perms[key];
-   if (typeof key === 'string' && key.startsWith('can_')) {
-     return value === true;
-   }
-   return value !== false;
+   return entry.isActionPerm ? value === true : value !== false;
  };
```

**Effect**:
- `canConfigureSalesChannels` (registry `isActionPerm: true`) sekarang gated opt-in — fix silent bypass
- Semua `can_*` keys unchanged behavior (registry `isActionPerm: true`)
- Semua non-action keys unchanged behavior (registry `isActionPerm: false`)
- Unknown keys (legacy `pipeline`, dll) → default visible → tidak break existing UI

---

## 9. Backfill Migration SQL

**File**: `supabase/migrations/20261115000515_backfill_admin_permissions.sql`

```sql
-- Migration 20261115000515: backfill admin_users.permissions
-- Root cause: defaultPermissions() and PERM_LABELS ossified at 12 keys
-- while PermissionSet grew to 43. Owners missing 6+ Phase 1A action perms;
-- non-Owners missing 31 action perms entirely.
--
-- This migration backfills all existing admin_users rows to have full
-- 43-key permission JSONB per registry (see src/lib/permissions.ts).
--
-- Strategy per role:
--   - Owner: force ALL_PERMISSIONS (all 43 = true). Consistent with intent
--     'Owner = full access', matches UI lock (isOwner disables toggle).
--   - Non-Owner: preserve existing values, fill missing per role default.
--     JSONB `a || b` merges with b's keys winning; we want existing keys
--     to WIN over defaults, so: defaults || existing.
--
-- Also strips legacy keys (e.g. 'pipeline') that are not in current
-- PermissionSet — done implicitly by rebuilding the JSONB from a curated
-- key set.
--
-- Idempotent: safe to re-run — each row rebuilt from role + existing values.

DO $$
DECLARE
  v_owner_perms      jsonb;
  v_supervisor_perms jsonb;
  v_staff_perms      jsonb;
  v_finance_perms    jsonb;
  v_valid_keys       text[] := ARRAY[
    -- Modul Utama
    'dashboard','salesInbox','laporan','aiStock','pelanggan','orderHistory',
    'userManagement','whatsappAi','notifications','settings',
    -- Pembelian
    'pembelian','can_create_po','can_edit_po','can_witness_po_receipt',
    -- Stok Opname & Adjustment
    'can_start_opname','can_witness_opname','can_commit_opname',
    'can_request_adjustment','can_approve_adjustment',
    'can_request_price_change','can_approve_price_change',
    -- Gudang
    'can_manage_warehouses','can_initiate_transfer','can_receive_transfer',
    -- Kasir
    'kasir','can_open_kasir_shift',
    'can_request_kasir_price_override','can_approve_kasir_price_override',
    'can_request_kasir_void','can_approve_kasir_void',
    'can_request_kasir_refund','can_approve_kasir_refund',
    'can_override_price_floor',
    -- Penjualan
    'canConfigureSalesChannels',
    -- Piutang & Kredit
    'piutang',
    'can_request_credit_activate','can_approve_credit_activate',
    'can_request_limit_change','can_approve_limit_change',
    'can_request_deactivate','can_approve_deactivate',
    -- Kontrol
    'reconciliation','can_view_pengawasan'
  ];
BEGIN
  -- Bypass audit triggers on admin_users if any exist (defensive: per plans
  -- backfill pattern from migration 000513). Safe: this migration is
  -- authoritative rewrite by role.
  SET LOCAL session_replication_role = 'replica';

  -- Owner: all 43 = true
  v_owner_perms := (
    SELECT jsonb_object_agg(k, true) FROM unnest(v_valid_keys) AS k
  );

  -- Supervisor Gudang preset (see spec §6)
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

  -- Update Owner rows
  UPDATE public.admin_users
  SET permissions = v_owner_perms
  WHERE role = 'Owner';

  -- Update Supervisor Gudang: role preset merge with existing (existing wins)
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

  RAISE NOTICE 'admin_users backfill complete';
END $$;

-- Verify: every non-legacy admin_users row has exactly 43 permission keys
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

### Dry-run pattern (per `smoke_test_security_definer_rpcs` memory)

Before ship, run migration inside a rollback DO block via MCP `execute_sql`:

```sql
BEGIN;
-- (paste migration body)
-- Verify sample row:
SELECT id, name, role, permissions FROM public.admin_users
WHERE name IN ('Tony Wei', 'NENG SEKAR');
-- Expect: both rows have 43 keys; Tony all true; NENG SEKAR kasir=false + settings=false + userManagement=false preserved from existing, other 31 filled per preset.
ROLLBACK;  -- discard the smoke run
```

### RPC changes

**No changes to `admin_upsert_user`** — it already REPLACES `permissions` fully. Client-side `normalizePermissions()` guarantees full-shape input.

**However**: the `p_role` parameter accepts arbitrary text. Add sanity check in FE (dropdown limits to 4 valid roles). Backend RPC unchanged (keep flexible for potential future role additions).

---

## 10. `handleTogglePermission` Normalization (critical invariant)

**File**: `src/components/UserManagementScreen.tsx:125-155`

**Before** (broken):
```ts
const handleTogglePermission = async (adminId, permissionKey) => {
  const updated = admins.map(adm => {
    if (adm.id === adminId) {
      return { ...adm, permissions: { ...adm.permissions, [permissionKey]: !adm.permissions[permissionKey] } };
    }
    return adm;
  });
  // ...
  await adminUsersService.upsert({ ...updatedAdmin, tenant_id: tenant.id }); // sends only whatever keys exist in adm.permissions
};
```

**After**:
```ts
import { normalizePermissions, PermissionRole } from '../lib/permissions';

const handleTogglePermission = async (adminId, permissionKey) => {
  const target = admins.find(a => a.id === adminId);
  if (!target) return;

  // Toggle in memory
  const nextPermsPartial = { ...target.permissions, [permissionKey]: !target.permissions[permissionKey] };

  // Normalize to full 43-key shape before persisting
  const nextPerms = normalizePermissions(nextPermsPartial, target.role as PermissionRole);

  const updated = admins.map(adm => adm.id === adminId ? { ...adm, permissions: nextPerms } : adm);
  setAdmins(updated);

  if (isSupabaseConfigured && tenant) {
    const updatedAdmin = updated.find(a => a.id === adminId)!;
    await adminUsersService.upsert({ ...updatedAdmin, tenant_id: tenant.id });
  }
};
```

Same normalization applied at:
- `handleAddAdmin` (form submit) — normalize `defaultPermissions(newRole)` result before sending
- Preset button click — normalize `defaultPermissions(newRole)` result
- Any future save path

**Invariant test** (see §11):
> Toggle 1 key, save, refetch → all 43 keys still present in DB.

---

## 11. Test Plan

**New file**: `src/lib/permissions.test.ts`

```ts
describe('permissions registry', () => {
  it('registry has 43 unique keys', () => {
    expect(PERMISSION_REGISTRY.length).toBe(43);
    const keys = new Set(PERMISSION_REGISTRY.map(p => p.key));
    expect(keys.size).toBe(43);
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

  it('normalizePermissions fills missing keys per role', () => {
    const partial = { dashboard: false } as Partial<PermissionSet>;
    const result = normalizePermissions(partial, 'Staff Admin Toko');
    expect(Object.keys(result).length).toBe(43);
    expect(result.dashboard).toBe(false);                    // preserved
    expect(result.can_start_opname).toBe(true);              // filled per Staff Admin Toko default
    expect(result.can_approve_adjustment).toBe(false);       // filled per Staff Admin Toko default
  });

  it('normalizePermissions drops unknown keys (legacy strip)', () => {
    const partial = { dashboard: true, pipeline: true } as Record<string, unknown>;
    const result = normalizePermissions(partial, 'Owner');
    expect(Object.keys(result)).not.toContain('pipeline');
  });

  it('every registry key isActionPerm gate consistent with naming', () => {
    // Exceptions: canConfigureSalesChannels is action but doesn't use can_ prefix
    const specialCase = new Set(['canConfigureSalesChannels']);
    for (const p of PERMISSION_REGISTRY) {
      const startsCan = p.key.startsWith('can_');
      const expected = startsCan || specialCase.has(p.key);
      expect(p.isActionPerm).toBe(expected);
    }
  });
});
```

**Updated file**: `src/components/UserManagementScreen.test.tsx` (new)

- `handleTogglePermission round-trip`: mount screen, toggle 1 key, verify RPC payload has 43 keys.
- `defaultPermissions('Staff Admin Toko') vs registry`: assert every non-Owner role render exposes all 43 checkboxes grouped by 8 categories.

**Sidebar test**: `src/components/Sidebar.test.tsx` (extend if exists, else new)
- `canConfigureSalesChannels` gated opt-in (`false` → hidden, `undefined` → hidden, `true` → visible)
- Legacy `pembelian` (non-action) default visible when `undefined`

**Full test run**: `npx vitest run --changed` before commit.

---

## 12. Impact Analysis (per CLAUDE.md)

### Direct importers of `PermissionSet` / `ALL_PERMISSIONS` / `defaultPermissions`

```
$ grep -rn "PermissionSet\|ALL_PERMISSIONS\|defaultPermissions" src/
src/types.ts:6                                    — defines PermissionSet
src/types.ts:61                                   — defines ALL_PERMISSIONS
src/types.ts:115                                  — AdminUser.permissions: PermissionSet
src/types.ts:125                                  — DbAdminUser.permissions: PermissionSet
src/App.tsx:23                                    — import PermissionSet, ALL_PERMISSIONS
src/App.tsx:230                                   — const permissions: PermissionSet = ALL_PERMISSIONS
src/components/AuthScreen.tsx:10,54,275,291       — imports + 3 fallback usages
src/components/UserManagementScreen.tsx:15,52,428 — defaultPermissions, ALL_PERMISSIONS
src/components/Sidebar.tsx:126-133,95-108         — perm gates in isPermVisible + menuItems permKey refs
```

Total call sites: **9 files, 15+ references**. All compat via type re-export in step 5.

### Indirect callers (components consuming `currentUser.permissions`)

```
$ grep -rn "\.permissions\." src/components/
src/components/Sidebar.tsx                        — gate menuItems
src/components/stok/StockOpnameScreen.tsx:221     — disable button on can_start_opname
src/components/pembelian/PurchaseOrderFormPage.tsx:40 — gate on can_create_po
src/components/ManajemenGudangScreen.tsx          — (verify usage)
```

All read-only consumers; unchanged behavior once registry-driven `PermissionSet` matches existing keys.

### Tests exercising `PermissionSet` / `defaultPermissions`

```
$ grep -rn "defaultPermissions\|ALL_PERMISSIONS\|PermissionSet" src/**/*.test.*
(none)
```

Zero existing test coverage. NEW tests added per §11.

### DB touchpoints

- `admin_users` table (JSONB `permissions` column)
- `admin_upsert_user` RPC — unchanged, but consumers must send full 43-key `p_permissions`
- No RLS policy references `admin_users.permissions` directly (grep verified — RLS uses `tenant_users.role` enum)

### Verdict

**9 files, 15+ references, 0 existing tests, 1 RPC, 1 table.** Migration + registry + UI + Sidebar refactor + normalization + tests all in-scope for 1 PR. No deliberate deferrals.

---

## 13. Scale ceiling check (per CLAUDE.md scale-forward)

| Question | Answer |
|---|---|
| **Ceiling at 10× scale (~10K tenants, ~50K admins)** | Registry ≤200 entries realistic; each admin row JSONB ~2KB. `admin_users` table ~100MB. Backfill on new perm add = UPDATE ~50K rows in ~5 seconds. Acceptable at this scale. |
| **Hot path** | Read `admin_users` on login (indexed by `id`); toggle write via RPC (1 row UPDATE). Both O(1). |
| **Partition-ready** | `admin_users` PK = `id` (uuid), tenant-scoped via `tenant_id` column. Composite `(tenant_id, id)` not needed at scale — even 1M rows fit in single unpartitioned table (indexed `id` UNIQUE, `tenant_id` FK). Revisit at 100M+ rows. |
| **Idempotency** | Backfill migration idempotent (rebuild JSONB from role + existing). Registry TypeScript pure derivation. |
| **Long ops** | Migration <1s at current 7 rows. At 50K rows: ~5s single UPDATE. Well under 5s/RPC synchronous ceiling. |
| **Cost curve** | Per-tenant infra cost: +0. No new services, no new API calls, no new storage bucket. Zero cost expansion. |

**Trigger for Tingkat 2 upgrade** (roles table + override): >500 admins across >100 tenants (permission backfill per Phase becomes friction), or >2 new roles per year (per-user override with role FK gives cleaner delta shipping).

---

## 14. Verification plan (per CLAUDE.md Ship & Verify)

### Stage 1 — Local
1. `npm run lint` clean
2. `npm run audit:numinput` + `npm run audit:secdef-null-tenant` clean
3. `npx vitest run --changed` green (permissions.test.ts + UserManagementScreen.test.tsx)
4. UI smoke via `npm run dev` + MCP chrome-devtools:
   - Login as Jenny (Owner) → expand admin row → verify 43 checkboxes in 8 categories rendered with tooltips
   - Toggle 1 checkbox for NENG SEKAR → save → refresh → verify persists
   - Console clean, no network 4xx/5xx
5. Migration dry-run via MCP `execute_sql` with rollback (see §9)

### Stage 2 — Deploy
1. Apply migration 000515 via `SUPABASE_PROJECT_REF=ekhhojaezdfjfwuxyjkl ./scripts/apply-migration.sh 515`
2. `git push main` → wait for `cloudbuild.frontend.yaml` green (per `feedback_deploy_verify_after_push` memory — `gcloud builds list --limit=2` verify STATUS=SUCCESS)
3. Run `mcp__plugin_supabase_supabase__get_advisors` — triage findings

### Stage 3 — Prod verify on `prod-testing-tenant`
1. **NEVER** run against real tenant Garindo Jaya Panel (Jenny + NENG SEKAR are real data). Use Toko Jaya Makmur.
2. Create test admin "Test Staff" role Staff Admin Toko via UI → verify all 43 checkboxes rendered with 8 categories
3. Login as Test Staff → verify sidebar shows expected items (kasir, salesInbox, pembelian, orderHistory, pelanggan, dll)
4. Toggle 1 perm as Owner → verify persists via refresh
5. Verify Owner Tony Wei sidebar shows all Piutang approval menus (previously hidden)

### Rollback plan
- **Frontend**: revert commit; Cloud Run traffic → prev revision via `gcloud run services update-traffic`
- **Backend**: no backend changes
- **Migration 000515**: idempotent; to revert, re-run older `defaultPermissions()` — but preferred: forward-fix (roll forward with a corrected registry). Rollback DB via PITR only if backfill produces catastrophic data corruption (very unlikely — only rewrites 7 rows).

---

## 15. Consequences

**Positive:**
- Eliminates 3-way drift class of bug permanently
- Fixes silent security bypass on `canConfigureSalesChannels`
- All 6 Owners regain access to Piutang approval flows (currently silently hidden)
- NENG SEKAR + future non-Owners get full 43-key perm object matching UI expectation
- Zero cost, zero infra, zero dependency

**Negative / trade-offs:**
- UI menjadi lebih panjang (43 checkbox vs 12) — mitigasi via category grouping + collapsible in Phase 2 kalau butuh
- Per-user JSONB storage tetap — 50K rows backfill saat Phase 5 add perm baru masih manageable, tapi flag for Tingkat 2 upgrade at scale
- 43 tooltip strings hardcoded Bahasa Indonesia — future rebranding / i18n butuh 1-file update (acceptable centralized)

**Blast radius:**
- 9 files touched (types.ts, permissions.ts NEW, UserManagementScreen.tsx, Sidebar.tsx, AuthScreen.tsx, App.tsx, 3 test files)
- 1 migration (000515) — touches 7 rows in `admin_users`
- Zero downstream RLS/RPC signature change
- Zero third-party dependency change

---

## 16. Future work (Tingkat 2 hybrid — deferred)

**Not in this PR**. Flagged for revisit when triggers met (see §13):

- Add `roles` table: `(id, tenant_id NULL, name, permissions JSONB, is_system boolean)`
- Add `admin_users.role_id` FK → `roles.id`
- Add `admin_users.permissions_override JSONB NULL` for per-user diffs from role
- Migrate: seed 4 system roles per tenant, snapshot current per-user perms into overrides
- Registry (from this PR) becomes source-of-truth for **role templates**, per-user override still allows full flexibility
- Adds perm: update 4 roles table rows instead of all admin_users JSONB

**Migration path (when triggered)**: incremental. Add table + FK, dual-read from role+override, single-write to override (falling back to role template), then remove old `admin_users.permissions` column.

This design (registry + JSONB) is **forward-compatible** with Tingkat 2 — no throw-away work.

---

## 17. Follow-ups (out of scope for this spec, add to progress.md)

- **Backend enforcement gap** — backend-go tidak baca `admin_users.permissions`. Malicious URL POST bypass FE gate. Acceptable for MSME, but tech-debt for later: add middleware that validates action perms server-side for critical routes. **Not blocking current fix.**
- **Category collapsibility in UI** — kalau founder feedback UI kepanjangan setelah ship, add `<details>` accordion per kategori (existing pattern).
- **`admin_delete_user` RPC** — per `admin_upsert_user_rpc.sql:22-23` comment, DELETE still fails via broken RLS. Separate follow-up.

---

## 18. Dependencies on other work

None. This PR standalone. Migration 000515 doesn't depend on any prior unshipped migration.

Parallel session risk (per `parallel_terminals_worktree` memory): check `ls supabase/migrations/20261115000*.sql` right before push — if another session claimed 000515+, bump to next free slot in 000515-000534 range.

---

## 19. Review checklist for founder

Please tinjau item-item ini secara eksplisit sebelum saya lanjut ke writing-plans:

- [ ] **§6 default matrix** — 43×4 preset (Owner/Supervisor Gudang/Staff Admin Toko/Finance Manager). Setiap ✅/⬜ akurat? Revise inline atau reply cell-by-cell.
- [ ] **§5 tooltip descriptions** — 43 baris Bahasa Indonesia. Ada yang confusing / terlalu panjang / MSME tone off? Edit inline.
- [ ] **§8 Sidebar refactor** — `canConfigureSalesChannels` naming stays, gate switches to registry flag. OK atau prefer rename?
- [ ] **§9 backfill SQL** — Owner force-all-true acceptable? Non-Owner merge pattern `defaults || existing` benar?
- [ ] **§14 Stage 3 tenant** — use Toko Jaya Makmur (staging-safe), NOT Testing Jaya Panel (Jenny + NENG SEKAR real data). OK?
- [ ] **§16 Tingkat 2 deferred** — sepakat defer sampai trigger 500+ admins?

Setelah approve, saya lanjut ke `superpowers:writing-plans` untuk generate implementation plan.
