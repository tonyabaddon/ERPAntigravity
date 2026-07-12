/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PermissionSet {
  dashboard: boolean;
  salesInbox: boolean;
  laporan: boolean;
  aiStock: boolean;
  pelanggan: boolean;
  orderHistory: boolean;
  userManagement: boolean;
  whatsappAi: boolean;
  notifications: boolean;
  settings: boolean;
  pembelian: boolean;
  kasir: boolean;
  piutang?: boolean;
  reconciliation?: boolean;
  // Action permissions (Phase 2 anti-fraud foundation)
  can_create_po?: boolean;
  can_edit_po?: boolean;
  // Phase 2 — stock adjustments, opname, price changes
  can_request_adjustment?: boolean;
  can_approve_adjustment?: boolean;
  can_start_opname?: boolean;
  can_witness_opname?: boolean;
  can_commit_opname?: boolean;
  can_request_price_change?: boolean;
  can_approve_price_change?: boolean;
  // Phase 3a — PO receipt witness
  can_witness_po_receipt?: boolean;
  // Phase 3b — kasir gates
  can_open_kasir_shift?: boolean;
  can_request_kasir_price_override?: boolean;
  can_approve_kasir_price_override?: boolean;
  can_request_kasir_void?: boolean;
  can_approve_kasir_void?: boolean;
  can_request_kasir_refund?: boolean;
  can_approve_kasir_refund?: boolean;
  can_override_price_floor?: boolean;
  // Phase 3d — inter-warehouse transfers
  can_initiate_transfer?: boolean;
  can_receive_transfer?: boolean;
  // Warehouse admin (2026-06-13 spec)
  can_manage_warehouses?: boolean;
  // Phase 4 — Pengawasan (immutable ledger reader)
  can_view_pengawasan?: boolean;
  // Sales channel admin (2026-06-13 spec)
  canConfigureSalesChannels?: boolean;
  // Phase 1A — Piutang/Tempo customer credit
  can_request_credit_activate?: boolean;
  can_approve_credit_activate?: boolean;
  can_request_limit_change?: boolean;
  can_approve_limit_change?: boolean;
  can_request_deactivate?: boolean;
  can_approve_deactivate?: boolean;
}

export const ALL_PERMISSIONS: PermissionSet = {
  dashboard: true,
  salesInbox: true,
  laporan: true,
  aiStock: true,
  pelanggan: true,
  orderHistory: true,
  userManagement: true,
  whatsappAi: true,
  notifications: true,
  settings: true,
  pembelian: true,
  kasir: true,
  piutang: true,
  reconciliation: true,
  can_create_po: true,
  can_edit_po: true,
  can_request_adjustment: true,
  can_approve_adjustment: true,
  can_start_opname: true,
  can_witness_opname: true,
  can_commit_opname: true,
  can_request_price_change: true,
  can_approve_price_change: true,
  can_witness_po_receipt: true,
  can_open_kasir_shift: true,
  can_request_kasir_price_override: true,
  can_approve_kasir_price_override: true,
  can_request_kasir_void: true,
  can_approve_kasir_void: true,
  can_request_kasir_refund: true,
  can_approve_kasir_refund: true,
  can_override_price_floor: true,
  can_initiate_transfer: true,
  can_receive_transfer: true,
  can_manage_warehouses: true,
  can_view_pengawasan: true,
  canConfigureSalesChannels: true,
  can_request_credit_activate: true,
  can_approve_credit_activate: true,
  can_request_limit_change: true,
  can_approve_limit_change: true,
  can_request_deactivate: true,
  can_approve_deactivate: true,
};

export type AdminStatus = 'Aktif' | 'Nonaktif';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  whatsapp: string;
  role: string;
  permissions: PermissionSet;
  status: AdminStatus;
}

export interface DbAdminUser {
  id: string;
  name: string;
  email: string | null;
  whatsapp: string | null;
  role: string;
  permissions: PermissionSet;
  status: string;
  created_at: string;
  tenant_id: string;
}

export type ChatStatusType = 'BUTUH_ADMIN' | 'WIRING_CUSTOM' | 'DIKELOLA_AI';

export interface Message {
  id: string;
  sender: 'user' | 'ai' | 'admin' | 'system';
  text: string;
  time: string;
}

export interface ChatItem {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  unreadCount: number;
  lastMessage: string;
  date: string;
  time: string;
  status: ChatStatusType;
  messages: Message[];
}

export interface ProductPhoto {
  url: string;
  path: string;
  order: number;
  uploaded_at: string;
}

export interface StockItem {
  sku: string;
  name: string;
  category: string;
  subcategory?: string | null;
  unit?: string;
  unit_alt?: string | null;
  unit_alt_factor?: number | null;
  price: number;
  price_grosir?: number | null;
  stock: number;
  stock_atas?: number;
  stock_bawah?: number;
  status: 'Sinkron' | 'Stok Tipis';
  specs: Record<string, string | number>;
  harga_modal?: number | null;
  photo_urls?: ProductPhoto[];
  description?: string | null;
  min_stock_per_product?: number | null;
  initial_stock_approved?: boolean;
}

export interface NotificationConfig {
  enabled: boolean;
  interval: string;
  reportComponents: {
    revenue: boolean;
    queue: boolean;
    activity: boolean;
    status: boolean;
  };
  lowStockAlert: number;
  delayAlert: number;
}

export interface WhatsappAiNumber {
  id: string;
  phoneNumber: string;
  name: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'PAIRING';
  isEnabled: boolean; // Is the WA connection enabled
  isAiEnabled: boolean; // Is the AI auto-reply feature enabled
  createdAt: string;
}

// --- Supabase DB-aligned types (used by useRealtimeConversations hook) ---

export type ConversationState =
  | 'GREETING' | 'COLLECTING' | 'CLARIFYING' | 'STOCK_CHECK' | 'CONFIRMING'
  | 'BOOKED' | 'TIMEOUT_REMINDER' | 'CANCELLED' | 'APPROVED' | 'COMPLETED'
  | 'ESCALATED_ADMIN' | 'ESCALATED_WIRING' | 'ADD_MORE' | 'DELIVERY';

export interface DbConversation {
  id: string;
  wa_number_id: string;
  customer_phone: string;
  state: ConversationState;
  language: string;
  collected_data: {
    name?: string;
    company?: string;
    address?: string;
    product?: string;
    quantity?: number;
    specs?: { size?: string; color?: string; notes?: string };
  };
  clarification_round: number;
  ai_active: boolean;
  last_ai_message_at?: string;
  followup_count_today: number;
  last_followup_date?: string;
  state_locked_until: string | null;       // ISO timestamp; NULL = no lock
  state_locked_by_admin_id: string | null; // admin who set the lock
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  conversation_id: string;
  sender: 'customer' | 'ai' | 'admin' | 'system';
  text: string;
  media_url?: string;
  media_type?: string;
  created_at: string;
}

export interface DbOrder {
  id: string;
  conversation_id: string;
  customer_id?: string;
  sales_channel: OrdersChannel;  // CHECK constraint restricts to whatsapp/walkin
  warehouse?: 'atas' | 'bawah' | null;
  customer_name: string;
  customer_company: string;
  customer_address: string;
  customer_phone: string;
  items: Array<{
    sku: string;
    name: string;
    qty: number;
    unit_price: number;
    subtotal: number;
  }>;
  subtotal: number;
  shipping_fee?: number;
  total: number;
  status:
    | 'PENDING'
    | 'PENDING_ADMIN_CONFIRMATION'
    | 'PENDING_PRICE_NEGO'
    | 'PENDING_STOCK_CHECK'
    | 'PENDING_CUSTOM_QUOTE'
    | 'PENDING_WIRING_QUOTE'
    | 'APPROVED'
    | 'WAITING_PAYMENT'
    | 'WAITING_DP'
    | 'DP_UPLOADED'
    | 'DP_VERIFIED'
    | 'DP_PROOF_REJECTED'
    | 'PAYMENT_UPLOADED'
    | 'PAYMENT_VERIFIED'
    | 'PAYMENT_REJECTED'
    | 'CANCELLED'
    | 'COMPLETED'
    | 'INVOICE_TEMPO'
    | 'INVOICE_WRITTEN_OFF';
  leads_id?: string;
  booking_expires_at: string;
  gjp_order_id?: string;
  order_type?: 'STANDARD' | 'CUSTOM_PANEL' | 'WIRING_PANEL';
  delivery_type?: 'PICKUP' | 'DELIVERY';
  full_proof_url?: string | null;
  dp_proof_url?: string | null;
  payment_type?: 'FULL' | 'DP' | 'TEMPO';
  due_date?: string | null;
  written_off_at?: string | null;
  written_off_by?: string | null;
  write_off_reason?: string | null;
  dp_input_type?: 'AMOUNT' | 'PERCENTAGE' | null;
  dp_value?: number | null;
  dp_amount?: number | null;
  rejection_reason?: string | null;
  payment_verified_at?: string;
  verified_by?: string;
  created_at: string;
  updated_at: string;
  hpp_total?: number;
  /** F-11: cumulative partial payments collected against this tempo invoice.
   *  Outstanding = total - piutang_paid_amount. Flips to PAYMENT_VERIFIED
   *  when piutang_paid_amount >= total. Defaults to 0 on non-tempo orders. */
  piutang_paid_amount?: number;
}

export interface DbWaRecipient {
  id: number;
  role: 'admin' | 'owner';
  name: string;
  wa_number: string;
  is_active: boolean;
  created_at: string;
}

export interface DbCustomer {
  id: string;
  wa_number: string;
  name: string;
  company: string;
  address?: string | null;
  created_at: string;
  // Phase 1A — tempo whitelist
  allows_tempo: boolean;
  term_days: number;
  credit_limit: number;
  tempo_activated_at?: string | null;
  tempo_activated_by?: string | null;
  // Multi-tier pricing
  default_pricing_tier?: 'eceran' | 'grosir';
}

export interface DbLead {
  id: string;
  customer_id: string;
  conversation_id: string;
  wa_number: string;
  status: 'NEW' | 'IN_PROGRESS' | 'ESCALATED' | 'ORDERED' | 'DROPPED';
  confirmed_order_id: string | null;
  created_at: string;
  updated_at: string;
  customers: DbCustomer | null;
  orders?: DbOrder[];
}

export interface DbCustomerWithStats extends DbCustomer {
  order_count: number;
  total_spend: number;
}

export interface DbCustomerProfile extends DbCustomer {
  orders: DbOrder[];
  leads: DbLead[];
  kasir_transactions: KasirTransaction[];
}

export interface DbNotificationConfig {
  id: number;
  enabled: boolean;
  interval_label: string;
  report_revenue: boolean;
  report_queue: boolean;
  report_activity: boolean;
  report_status: boolean;
  low_stock_alert: number;
  delay_alert: number;
  updated_at: string;
}

// Trimmed in the legacy Pengaturan cleanup: display fields
// (company_name, address, phone, email, npwp) no longer drive any UI —
// store_settings + store_bank_accounts are the new source of truth.
// What remains here are the columns that companySettingsService still
// reads/writes: logo_url (uploadLogo/clearLogo), opname_require_witness
// (Stok Opname witness toggle), costing_method (FIFO/Average panel).
// The `company_settings` table still exists in Postgres; we just no
// longer surface the legacy display columns to TypeScript callers.
export interface DbCompanySettings {
  tenant_id: string;        // replaces `id: number` — PK is now tenant_id
  company_name?: string;
  address?: string;
  phone?: string;
  email?: string;
  logo_url?: string | null;
  npwp?: string;
  opname_require_witness?: boolean;
  costing_method?: 'FIFO' | 'Average';
  updated_at?: string;
}

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
  expected_receive_date?: string;   // ISO date 'YYYY-MM-DD', NULL-able
  created_by_user_id?: string;      // UUID, FK admin_users(id)
  updated_by_user_id?: string;      // UUID, FK admin_users(id)
}

export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'manajemen-gudang' | 'stok-opname' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings' | 'pipeline' | 'order-history' | 'pelanggan' | 'piutang' | 'laporan' | 'pembelian' | 'kasir' | 'penjualanBaru' | 'persetujuan' | 'rekonsiliasi' | 'penjualan' | 'salesLanding' | 'daftarPesanan' | 'invoicePreview' | 'akuntansi' | 'kasBank' | 'kasBankDetail' | 'daftarPenawaran';

// ─── Kasir types ────────────────────────────────────────────

export type SalesChannel =
  | 'walkin' | 'grosir' | 'sales' | 'expo'
  | 'tokopedia' | 'shopee' | 'lazada' | 'blibli' | 'bukalapak' | 'ralali' | 'bhinneka'
  | 'whatsapp' | 'instagram' | 'website';

export type KasirChannel = SalesChannel;

// D16: narrower type for orders-flow only (matches CHECK constraint on orders.sales_channel)
export type OrdersChannel = Extract<SalesChannel, 'whatsapp' | 'walkin'>;
export type KasirPaymentMethod = 'cash' | 'transfer' | 'qris' | 'edc';
export type KasirPaymentSubtype = 'debit' | 'qris' | null;
export type KasirPaymentType = 'FULL' | 'DP' | 'TEMPO';
export type KasirDpInputType = 'AMOUNT' | 'PERCENT' | null;
export type KasirStatus = 'PAID' | 'AWAITING_LUNAS' | 'COMPLETED' | 'CANCELLED' | 'WIP' | 'PENDING_LOCK_APPROVAL';
export type WarehouseLocation = 'atas' | 'bawah';
export type KasirExpenseCategory =
  | 'Gaji' | 'Utilitas' | 'Transportasi' | 'Pembelian Stok' | 'Marketing' | 'Lain-lain';

export interface KasirItem {
  sku: string | null;
  name: string;
  qty: number;
  unit_price: number;
  hpp_per_unit: number;
  subtotal: number;
  hpp_subtotal: number;
  warehouse: WarehouseLocation | null;   // legacy — Task 22 removes
  warehouse_id?: string | null;            // new — populated by Task 14 onwards
  // Diskon fitur (Task 14): per-line discount fields. Optional for backward-compat.
  master_price_at_sale?: number;
  discount_type?: DiscountType;
  discount_value?: number | null;
  discount_amount_rp?: number;
  // Multi-tier pricing
  pricing_tier_used?: 'eceran' | 'grosir' | null;
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
  payment_subtype?: KasirPaymentSubtype;
  payment_type?: KasirPaymentType;
  dp_amount?: number;
  dp_input_type?: KasirDpInputType;
  ongkir_amount?: number;
  notes?: string | null;
  total_amount?: number;
  marketplace_order_no?: string | null;
  wa_phone?: string | null;
  wa_chat_url?: string | null;
  status?: KasirStatus;
  lunas_at?: string | null;
  lunas_payment_method?: KasirPaymentMethod | null;
  lunas_payment_subtype?: KasirPaymentSubtype;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_company?: string | null;
  delivery_address?: string | null;
  customer_id?: string | null;
  invoice_number?: string | null;
  expense_category?: KasirExpenseCategory | null;
  description?: string | null;
  po_id?: string | null;
  created_by?: string | null;
  created_at: string;
  // Diskon fitur (Task 14): order-level discount read from DB. Optional for backward-compat.
  discount_type?: DiscountType;
  discount_value?: number | null;
  discount_amount_rp?: number;
}

export interface DailySummary {
  totalIncome: number;
  totalExpense: number;
  totalHpp: number;
  labaKotor: number;
  labaBersih: number;
  itemsSold: number;
  byChannel: Record<string, number>;
  byPaymentMethod: Record<string, number>;
}

export interface RecordKasirSaleInput {
  date: string;
  channel: KasirChannel;
  items: KasirItem[];
  subtotal: number;
  payment_method: KasirPaymentMethod;
  payment_subtype?: KasirPaymentSubtype;
  payment_type: KasirPaymentType;
  dp_amount: number;
  dp_input_type?: KasirDpInputType;
  ongkir_amount: number;
  notes?: string;
  total_amount: number;
  marketplace_order_no?: string;
  wa_phone?: string;
  wa_chat_url?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_company?: string;
  delivery_address?: string;
  customer_id?: string;
  /**
   * Opt-in pre-order flag (T2 migration). When true, record_kasir_sale skips
   * the abort-on-shortage check and tolerates negative stock at the lot level
   * (the deduct_stock_fifo RAISE WARNING fallback already permits this — the
   * flag exists so the wizard can semantically signal "intentional pre-order"
   * for downstream T25 audit visibility). Defaults to FALSE at the DB layer.
   */
  p_allow_negative_stock?: boolean;
  /**
   * Phase 0b dual-write: cash_accounts.id where the sale proceeds land.
   * Required when payment_method != 'cash' (picker selection from
   * PenjualanBaru wizard). When null/omitted, the RPC falls back to
   * accounting_config defaults by payment_method.
   */
  cash_account_id?: string | null;
  /**
   * Diskon fitur (Task 10): optional order-level discount triple.
   * When omitted, defaults to no discount (null/null/0). Per-line discounts
   * are embedded in the items JSONB as discount_amount_rp fields.
   */
  discount?: DiscountTriple;
}

export interface NewExpense {
  date: string;
  expense_category: KasirExpenseCategory;
  description: string;
  subtotal: number;
}

export interface SalesEntry {
  source: 'order' | 'kasir';
  id: string;
  display_id: string;
  channel: SalesChannel;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_company: string | null;
  items: Array<{ name: string; qty: number; sku?: string }>;
  total: number;
  status: string;
  created_at: string;
  walkin_order_id: string | null;
}

// Phase 2: Approval data shapes ----------------------------------------------

export type ApprovalRequestType =
  // Existing 12 gates
  | 'adjustment'
  | 'opname'
  | 'initial_stock'
  | 'kasir_price_override'
  | 'kasir_void'
  | 'kasir_refund'
  | 'price_change'
  | 'customer_credit_activate'
  | 'customer_credit_limit_change'
  | 'customer_credit_deactivate'
  | 'piutang_write_off'
  | 'rakit_lock'
  // 7 Pembelian gates (Phase 1 baru)
  | 'purchase_order_create'
  | 'purchase_order_amend'
  | 'tagihan_create'
  | 'supplier_payment'
  | 'bnl_create'
  | 'tukar_faktur'
  | 'purchase_return';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRequest {
  id: number;
  requestType: ApprovalRequestType;
  payload: Record<string, unknown>;
  requestedBy: string;
  requestedAt: string; // ISO timestamp
  expiresAt: string;
  status: ApprovalStatus;
  decidedBy?: string | null;
  decidedAt?: string | null;
  decisionChannel?: 'wa_button' | 'owner_pin' | 'app_inbox' | 'auto_expire' | null;
}

export interface DbPiutangWriteOffRequest {
  approval_id: number;
  order_id: string;
  reason: string;
  created_at: string;
}

export type StockAdjustmentReason =
  | 'rusak' | 'hilang' | 'sampel' | 'koreksi_input' | 'korjual_admin';

export interface StockAdjustment {
  id: number;
  sku: string;
  warehouse: 'atas' | 'bawah';
  qtyDelta: number;
  reasonCode: StockAdjustmentReason;
  reasonNote?: string;
  evidenceUrls: string[];
  requestedBy: string;
  requestedAt: string;
  approvalRequestId: number;
  status: 'pending_approval' | 'approved' | 'rejected' | 'expired';
  committedAt?: string | null;
  committedMovementId?: number | null;
}

export interface OpnameSession {
  id: number;
  opnameType: 'full' | 'per_kategori' | 'per_sku_list';
  scopePayload: Record<string, unknown>;
  countedByUserId: string;
  witnessedByUserId: string;
  witnessAcknowledgedAt?: string | null;
  status: 'in_progress' | 'pending_owner' | 'committed' | 'rejected' | 'abandoned';
  varianceTotalValue: number;
  approvalRequestId?: number | null;
  startedAt: string;
  submittedAt?: string | null;
  committedAt?: string | null;
}

export interface OpnameCount {
  sessionId: number;
  sku: string;
  warehouse: 'atas' | 'bawah';
  systemQtySnapshot: number | null;
  countedQty?: number | null;
  variance: number | null; // generated
  varianceValue: number;
  // Rev 3: admin-flagged damage during counting. Owner decides Dispose/Klaim
  // post-opname via decide_supplier_claim RPC.
  damagedQty?: number;
  damageNotes?: string | null;
  damageEvidenceUrls?: string[] | null;
}

export interface PriceChangeRequest {
  id: number;
  sku: string;
  field: 'price' | 'harga_modal';
  oldValue: number;
  newValue: number;
  reasonNote: string;
  approvalRequestId: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requestedBy: string;
  requestedAt: string;
  decidedAt?: string | null;
  decidedBy?: string | null;
  committedAt?: string | null;
}

// ─── Monthly Reconciliation Types ─────────────────────────────────────────

export interface BankAccount {
  id: string;
  bank_code: 'BCA' | 'MANDIRI' | 'BRI' | 'BNI' | 'PERMATA' | 'CIMB' | 'OTHER';
  account_number: string;
  account_label: string;
  purpose: 'OPERATIONAL' | 'OWNER_PERSONAL' | 'SAVINGS' | 'OTHER';
  is_active: boolean;
}

export interface BankImport {
  id: string;
  bank_account_id: string;
  period_start: string;
  period_end: string;
  filename: string;
  line_count: number;
  matched_count: number;
  status: 'PROCESSING' | 'READY' | 'FAILED';
  error_message?: string;
}

export type BankLineKind =
  | 'CUSTOMER_PAYMENT' | 'CASH_DEPOSIT' | 'EDC_SETTLEMENT' | 'SUPPLIER_PAYMENT'
  | 'EXPENSE' | 'BANK_FEE' | 'INTERNAL_TRANSFER' | 'CUSTOMER_TOPUP'
  | 'OWNER_DRAWING' | 'OWNER_TOPUP' | 'REFUND' | 'OTHER_INCOME'
  | 'LEGACY_PERIOD' | 'UNKNOWN';

export type Lane = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' | 'GRAY';

export interface BankStatementLine {
  id: string;
  bank_account_id: string;
  txn_date: string;
  amount: number;
  direction: 'IN' | 'OUT';
  description: string;
  counterparty?: string;
  line_kind: BankLineKind;
  lane: Lane;
  match_confidence?: number;
  match_reason?: string;
}

export interface PayableSlot {
  id: string;
  order_id: string;
  slot_type: 'FULL' | 'DP' | 'BALANCE';
  expected_amount: number;
  matched_amount: number;
  status: 'OPEN' | 'MATCHED' | 'WRITTEN_OFF' | 'EXTENDED';
  due_date?: string;
}

export interface CashDepositBatch {
  id: string;
  deposit_date?: string;
  bank_line_id?: string;
  deposited_amount?: number;
  expected_amount: number;
  variance: number;
  variance_reason?: 'PETTY_CASH' | 'HITUNG_KURANG' | 'HITUNG_LEBIH' | 'LAINNYA';
  status: 'PENDING' | 'DEPOSITED' | 'CARRY_OVER';
}

export interface ReconciliationPeriod {
  id: string;
  year: number;
  month: number;
  status: 'OPEN' | 'CLOSING' | 'CLOSED';
  closed_at?: string;
  summary?: Record<string, unknown>;
}

// === Rakit Workflow (Sub-project B) ===

export type RakitServiceType = 'jasa_rakit' | 'jasa_custom_panel';
export type RakitTrackingMode = 'detail' | 'lumpsum';

export interface RakitComponent {
  id?: string;
  rakitLineId?: string;
  sku: string;
  name: string;
  qty: number;
  warehouse: 'atas' | 'bawah';
  fifoCostSnapshot: number;
}

export interface RakitJobLine {
  id: string;
  transactionId: string;
  lineNumber: number;
  serviceType: RakitServiceType;
  description: string;
  estimatedPrice: number;
  finalPrice: number | null;
  trackingMode: RakitTrackingMode;
  laborCost: number;
  lumpSumHpp: number;
  hppOwnerOverride: number | null;
  hppFinal: number | null;
  components?: RakitComponent[];
}

export type RakitLockRequestStatus =
  | 'pending_approval' | 'approved' | 'rejected' | 'expired' | 'withdrawn' | 'superseded';

export interface RakitLockRequest {
  id: number;
  transactionId: string;
  approvalRequestId: number;
  /**
   * Snapshot of rakit lines at lock submission time. Stored as JSONB in the DB
   * with snake_case keys (final_price, tracking_mode, labor_cost, lump_sum_hpp,
   * components: [{sku, name, qty, warehouse, fifo_cost}]). Typed as unknown[]
   * to force consumers to validate the shape rather than assume RakitJobLine.
   */
  linesSnapshot: unknown[];
  requestedBy: string;
  requestedAt: string;
  status: RakitLockRequestStatus;
  committedAt: string | null;
  isMaterialEdit: boolean;
  priorLockRequestId: number | null;
}

// ─── Warehouse model (configurable N warehouses, 2026-06-13 spec) ───────────

export interface Warehouse {
  id: string;
  tenant_id: string | null;
  code: string;
  name: string;
  address: string | null;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type WarehouseAuditAction =
  | 'create'
  | 'rename'
  | 'set_default'
  | 'deactivate'
  | 'force_deactivate'
  | 'reactivate'
  | 'address_update'
  | 'sort_update';

export interface WarehouseAuditLogRow {
  id: number;
  warehouse_id: string;
  actor_user_id: string;
  action: WarehouseAuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason_note: string | null;
  created_at: string;
}

// ─── Product Registry (M2) ─────────────────────────────────────────────────
export interface ProductCategory {
  id: string;
  tenant_id: string | null;
  name: string;
  parent_id: string | null;
  created_at: string;
}

export interface ProductBrand {
  id: string;
  tenant_id: string | null;
  name: string;
  created_at: string;
}

export interface ProductUnit {
  id: string;
  tenant_id: string | null;
  name: string;
  is_default: boolean;
  created_at: string;
}

// ─── Cari by Foto result ───────────────────────────────────────────────────
export interface WarehouseStockSlice {
  warehouse_id: string;
  code: string;
  name: string;
  qty: number;
}

export interface ProductPhotoSearchResult {
  sku: string;
  name: string;
  category: string;
  similarity: number;
  thumbnail_url: string | null;
  total_stock: number;
  warehouse_stock: WarehouseStockSlice[];
  price: number;
  unit: string;
  min_stock: number;
}

export interface ProductPhotoSearchResponse {
  query_description: string;
  results: ProductPhotoSearchResult[];
}

// ─── Costing method (Pengaturan) ──────────────────────────────────────────
export type CostingMethod = 'FIFO' | 'Average';

// ─── AI Call Log ──────────────────────────────────────────────────────────
export interface AiCallLogStat {
  model: 'flash-2.5-vision' | 'text-embedding-004';
  success: number;
  error: number;
  rate_limit: number;
  p50_ms: number | null;
  p95_ms: number | null;
  last_error_at: string | null;
}

// ── Belanja Numpang Lewat (Phase 1) ──
// Pass-through purchase invoice linked to a Sales Order.
// type='PASSTHROUGH' has zero stock impact; type='STOCK' reserved for Phase 2.
export type PiStatus = 'BELUM_LUNAS' | 'LUNAS' | 'TERLAMBAT';
export type PiPaymentMethod = 'CASH' | 'TRANSFER' | 'TEMPO';
export type PiType = 'PASSTHROUGH' | 'STOCK';

export interface DbPurchaseInvoiceItem {
  id: string;
  pi_id: string;
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
  sell_price: number;
  subtotal: number;
  created_at: string;
  // Task 16: discount fields (optional, backward-compat with old PIs)
  master_unit_cost?: number | null;
  discount_type?: DiscountType;
  discount_value?: number | null;
  discount_amount_rp?: number;
}

export interface DbPurchaseInvoice {
  id: string;
  pi_number: string;
  type: PiType;
  supplier_id: string;
  order_id: string | null;
  purchase_date: string;
  supplier_invoice_number: string | null;
  supplier_invoice_photo_url: string | null;
  payment_method: PiPaymentMethod;
  payment_due_at: string | null;
  paid_at: string | null;
  payment_proof_url: string | null;
  subtotal: number;
  total: number;
  status: 'BELUM_LUNAS' | 'LUNAS';
  notes: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  // Phase 2: extended columns
  pesanan_id?: string | null;
  tukar_faktur_id?: string | null;
  paid_amount?: number;
  is_tf_quick_add?: boolean;
  // Task 16: order-level discount fields (optional, backward-compat with old PIs)
  discount_type?: DiscountType;
  discount_value?: number | null;
  discount_amount_rp?: number;
  // joined
  supplier?: DbSupplier;
  order?: { id: string; customer_name?: string };
  items?: DbPurchaseInvoiceItem[];
}

export interface PiItemDraft {
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
  sell_price: number;
}

export interface RecordPiPayload {
  supplier_id: string;
  order_id: string;
  purchase_date?: string;
  supplier_invoice_number?: string;
  supplier_invoice_photo_url?: string;
  payment_method: PiPaymentMethod;
  payment_due_at?: string;
  initial_status: 'BELUM_LUNAS' | 'LUNAS';
  payment_proof_url?: string;
  notes?: string;
  items: PiItemDraft[];
  ignore_duplicate_warning?: boolean;
}

export interface OrderCogsBreakdownRow {
  order_id: string;
  line_index: number;
  sku: string;
  order_qty: number;
  sell_price: number;
  source_pi_number: string | null;
  pi_unit_cost: number | null;
  qty_from_pi: number;
  qty_from_stock: number;
}

// ── Phase 2: Pesanan + Pembayaran ──
export type PesananStatus = 'DRAFT' | 'ORDERED' | 'CLOSED';
export type TagihanStatus = 'BELUM_LUNAS' | 'DIBAYAR_SEBAGIAN' | 'LUNAS';
export type PembayaranStatus = 'LUNAS' | 'VOIDED';

export interface DbPesananItem {
  id: string;
  pesanan_id: string;
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
  subtotal: number;
  qty_received_total: number;
  created_at: string;
}

export interface DbPesanan {
  id: string;
  pesanan_number: string;
  supplier_id: string;
  status: PesananStatus;
  notes: string | null;
  ordered_at: string | null;
  expected_receive_at: string | null;
  closed_at: string | null;
  tax_rate: number;
  tax_amount: number;
  subtotal: number;
  total: number;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
  supplier?: DbSupplier;
  items?: DbPesananItem[];
}

export interface PesananItemDraft {
  sku: string;
  product_name: string;
  qty: number;
  unit_cost: number;
}

export interface RecordPesananPayload {
  supplier_id: string;
  initial_status: 'DRAFT' | 'ORDERED';
  notes?: string;
  expected_receive_at?: string;
  tax_rate?: number;
  items: PesananItemDraft[];
}

export interface DbPembayaranItem {
  id: string;
  pembayaran_id: string;
  tagihan_id: string | null;
  tukar_faktur_id: string | null;
  amount: number;
  created_at: string;
}

export interface DbPembayaran {
  id: string;
  pembayaran_number: string;
  supplier_id: string;
  paid_at: string;
  payment_method: 'CASH' | 'TRANSFER' | 'CHEQUE' | 'EDC';
  account_id: string | null;
  account_label: string | null;
  amount_total: number;
  discount_amount: number;
  proof_url: string | null;
  status: PembayaranStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  void_reason: string | null;
  supplier?: DbSupplier;
  items?: DbPembayaranItem[];
}

export interface PembayaranItemDraft {
  tagihan_id?: string;
  tukar_faktur_id?: string;
  amount: number;
}

export interface RecordPembayaranPayload {
  supplier_id: string;
  paid_at?: string;
  payment_method: 'CASH' | 'TRANSFER' | 'CHEQUE' | 'EDC';
  account_id?: string;
  account_label?: string;
  discount_amount?: number;
  proof_url?: string;
  notes?: string;
  items: PembayaranItemDraft[];
}

export interface SuggestOutstandingTagihanRow {
  id: string;
  pi_number: string;
  total: number;
  paid_amount: number;
  outstanding: number;
  payment_due_at: string | null;
  supplier_invoice_number: string | null;
}

export interface ApDashboardLite {
  kpi: {
    total_outstanding: number;
    due_this_month: number;
    next_7_days: number;
    overdue: { amount: number; count: number };
  };
  per_supplier: Array<{
    supplier_id: string;
    supplier_name: string;
    outstanding: number;
    tagihan_count: number;
    due_soonest: string | null;
  }>;
}

// ── Phase 2b: Tukar Faktur ──
export type TukarFakturStatus = 'BELUM_LUNAS' | 'DIBAYAR_SEBAGIAN' | 'LUNAS' | 'VOIDED';

export interface DbTukarFaktur {
  id: string;
  tf_number: string;
  supplier_id: string;
  supplier?: { id: string; name: string; payment_term_days: number | null };
  tukar_date: string;                       // ISO date
  payment_due_at: string;
  total_amount: number;
  paid_amount: number;
  photo_urls: string[];
  tanda_terima_printed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  status: TukarFakturStatus;                // computed client-side
  tagihans?: Array<{
    id: string;
    pi_number: string;
    supplier_invoice_number: string | null;
    purchase_date: string;
    payment_due_at: string;                  // JT asli (display strikethrough)
    total: number;
    paid_amount: number;
    is_tf_quick_add: boolean;
  }>;
}

export interface TfQuickAddTagihanDraft {
  supplier_invoice_number: string;
  purchase_date: string;
  total: number;
  payment_due_at: string;
}

export interface RecordTukarFakturPayload {
  supplier_id: string;
  tukar_date: string;
  payment_due_at: string;
  tagihan_ids: string[];
  quick_add_tagihans?: TfQuickAddTagihanDraft[];
  photo_urls?: string[];
  notes?: string;
}

export interface UpdateTukarFakturPayload {
  tukar_date?: string;
  payment_due_at?: string;
  notes?: string;
  photo_urls?: string[];
}

export interface SuggestOutstandingTukarFakturRow {
  id: string;
  tf_number: string;
  total: number;
  paid_amount: number;
  outstanding: number;
  payment_due_at: string;
  tagihan_count: number;
}

/** Result shape returned by `pembayaran_suggest_outstanding` after Phase 2b extension. */
export interface SuggestOutstandingResult {
  tagihan: SuggestOutstandingTagihanRow[];
  tukar_faktur: SuggestOutstandingTukarFakturRow[];
}

// ── Piutang Phase 1B — Tempo invoice + Piutang screen ──
export interface CreateTempoInvoiceItemPayload {
  sku: string;
  name?: string;
  qty: number;
  unit_price: number;
  subtotal: number;
  // Discount fields (optional — defaults to no discount for backward-compat)
  master_price_at_sale?: number;
  discount_type?: DiscountType;
  discount_value?: number | null;
  discount_amount_rp?: number;
  // Multi-tier pricing (Task 8) — optional; server validates when modul_multi_tier_price ON
  pricing_tier_used?: 'eceran' | 'grosir' | null;
}

export interface CreateTempoInvoicePayload {
  customer_id: string;
  customer_name?: string;
  customer_phone?: string;
  customer_company?: string;
  delivery_address?: string;
  delivery_type?: 'PICKUP' | 'DELIVERY';
  channel?: 'walkin' | 'whatsapp' | 'grosir' | 'tokopedia' | string;
  sales_channel?: string;
  items: CreateTempoInvoiceItemPayload[];
  subtotal: number;
  shipping_fee?: number;
  total: number;
  // Order-level discount fields (optional — defaults to no discount for backward-compat)
  discount_type?: DiscountType;
  discount_value?: number | null;
  discount_amount_rp?: number;
}

export type CreateTempoInvoiceResult =
  | { kind: 'ok'; order_id: string }
  | { kind: 'credit_limit_exceeded'; outstanding: number; new_amount: number; limit: number; shortage: number }
  | { kind: 'tempo_not_enabled' }
  | { kind: 'invalid'; message: string };

export interface PiutangTier {
  key: 'overdue' | 'today' | 'h3' | 'future';
  label: string;
  rowBg: string;
  badgeClass: string;
}

export interface PiutangRow {
  order: DbOrder;
  customer?: DbCustomer;
  daysToDue: number; // negative = overdue
  tier: PiutangTier['key'];
}

// ─── Pengaturan MSME Configurability (Phase 1) ─────────────────────────
// See docs/superpowers/specs/2026-06-21-pengaturan-msme-configurability-design.md

export type ApprovalVerificationMethod = 'NONE' | 'PIN' | 'WA_BUTTON' | 'APP_INBOX';

export interface DbApprovalSettings {
  id: number;
  tenant_id: string | null;
  request_type: ApprovalRequestType;
  approval_required: boolean;
  verification_method: ApprovalVerificationMethod;
  threshold_amount: number | null;
  threshold_qty: number | null;
  threshold_percent: number | null;
  approver_role: string;
  requestor_bypass_self: boolean;
  reason_required: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export type PajakMode = 'PKP' | 'NON_PKP' | 'FINAL_UMKM';
export type JenisBadan = 'PT' | 'CV' | 'OP' | 'KOPERASI' | 'FIRMA';

export type ModulSwitchKey =
  | 'modul_kasir'
  | 'modul_tempo'
  | 'modul_pengiriman'
  | 'modul_multi_warehouse'
  | 'modul_akuntansi'
  | 'modul_jasa_layanan'
  | 'modul_bom_recipe'
  | 'modul_diskon_kasir'
  | 'modul_diskon_penjualan'
  | 'modul_diskon_tagihan'
  | 'modul_multi_tier_price';

export interface DbTenantSettings {
  id: number;
  tenant_id: string | null;
  modul_kasir: boolean;
  modul_tempo: boolean;
  modul_pengiriman: boolean;
  modul_multi_warehouse: boolean;
  modul_akuntansi: boolean;
  modul_jasa_layanan: boolean;
  modul_bom_recipe: boolean;
  modul_diskon_kasir: boolean;
  modul_diskon_penjualan: boolean;
  modul_diskon_tagihan: boolean;
  modul_multi_tier_price: boolean;
  pajak_mode: PajakMode;
  pajak_ppn_rate_umum: number;
  pajak_ppn_rate_mewah: number;
  pajak_final_rate: number;
  pajak_umkm_jenis_badan: JenisBadan | null;
  pajak_umkm_terdaftar_at: string | null;
  pajak_umkm_expires_at: string | null;
  pajak_npwp: string | null;
  pajak_nik_as_npwp: boolean;
  pajak_efaktur_enabled: boolean;
  pajak_pkp_registered_at: string | null;
  pajak_coretax_id: string | null;
  pajak_regulation_year: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export type PricingModel = 'LUMP_SUM' | 'PER_HOUR' | 'PER_METER' | 'PER_UNIT';

export interface DbServiceType {
  id: number;
  tenant_id: string | null;
  code: string;
  name: string;
  description: string | null;
  pricing_model: PricingModel;
  requires_material_lock: boolean;
  default_account_revenue: number | null;
  default_account_cogs: number | null;
  color_hex: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// ─── Diskon (2026-06-23) ────────────────────────────────────────────────
export type DiscountType = 'PERCENT' | 'AMOUNT' | null;

export interface DiscountTriple {
  discount_type: DiscountType;
  discount_value: number | null;
  discount_amount_rp: number;
}

export interface CartItemWithDiscount extends DiscountTriple {
  master_price_at_sale: number;
  pricing_tier_used?: 'eceran' | 'grosir' | null;
}

// ─── Sales Order / Penawaran (PR #55) ───────────────────────────────────
/**
 * Sales Order (Penawaran) — pre-commit quote to customer.
 * No stock movement, no payment fields. Items shape mirrors kasir_transactions.items.
 * Convert path: status='OPEN' → 'CONVERTED' (with either converted_to_kasir_tx_id
 * for LUNAS/DP/WIP, or converted_to_order_id for TEMPO; never both) OR
 * 'CLOSED' (manual, with closed_reason). Terminal once non-OPEN.
 */
export interface DbSalesOrder {
  id: string;
  so_number: string;
  date: string;                  // ISO date
  channel: string;               // OrdersChannel-compatible
  items: KasirItem[];            // sku nullable for jasa lump-sum
  subtotal: number;              // products + jasa, no ongkir
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_company: string | null;
  notes: string | null;
  status: 'OPEN' | 'CONVERTED' | 'CLOSED';
  converted_to_kasir_tx_id: string | null;
  converted_to_order_id: string | null;
  closed_reason: string | null;
  created_at: string;            // ISO timestamp
  created_by: string | null;     // uuid
}
