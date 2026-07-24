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
