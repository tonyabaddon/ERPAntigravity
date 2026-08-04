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
  email?: string;
  logo_url?: string;
  google_maps_url?: string;
  npwp?: string;
  updated_at: string;
  updated_by?: string;

  // Footer contact — telp_kantor separate from telp_wa
  telp_kantor?: string | null;
  website_url?: string | null;

  // Sales Order (Penawaran) defaults
  // NOTE: DB is NOT NULL with defaults, but marked optional here so existing test
  // fixtures (which pre-date these fields) don't require migration. Consumers that
  // render the SO PDF should default to 14 / true / false when undefined.
  default_so_validity_days?: number;     // DB NOT NULL default 14
  default_payment_terms?: string | null;
  default_lead_time_text?: string | null;
  default_so_notes?: string | null;
  default_opening_greeting?: string | null;
  default_signatory_name?: string | null;
  default_signatory_title?: string | null;

  // Footer visibility toggles (DB NOT NULL with defaults; optional here for fixture compat)
  footer_show_telp_kantor?: boolean;     // DB default TRUE
  footer_show_wa?: boolean;              // DB default TRUE
  footer_show_email?: boolean;           // DB default TRUE
  footer_show_website?: boolean;         // DB default FALSE
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
