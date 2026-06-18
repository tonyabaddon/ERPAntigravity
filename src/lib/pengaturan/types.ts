// TypeScript interfaces matching migration 20260625000010_pengaturan_tables.sql.
// Three small tables that back the Pengaturan UI + PDF generator + WA signature.

export interface StoreSettings {
  id: 1;
  nama_toko: string;
  nama_legal?: string;
  tagline?: string;
  alamat_lengkap: string;
  kota: string;
  telp_wa: string;
  logo_url?: string;
  google_maps_url?: string;
  npwp?: string;
  updated_at: string;
  updated_by?: string;
}

export interface OperatingHour {
  // 0=Senin .. 6=Minggu — see migration 010 CHECK constraint and seed rows.
  day_of_week: number;
  is_open: boolean;
  // Postgres `time` columns serialize as 'HH:MM:SS'.
  open_time?: string;
  close_time?: string;
}

export interface BankAccount {
  id: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  is_active: boolean;
  sort_order: number;
}
