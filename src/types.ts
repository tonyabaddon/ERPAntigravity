/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  pipeline: true,
  pelanggan: true,
  orderHistory: true,
  userManagement: true,
  whatsappAi: true,
  notifications: true,
  settings: true,
  pembelian: true,
  kasir: true,
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
  | 'ESCALATED_ADMIN' | 'ESCALATED_WIRING';

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
    | 'COMPLETED';
  leads_id?: string;
  booking_expires_at: string;
  gjp_order_id?: string;
  order_type?: 'STANDARD' | 'CUSTOM_PANEL' | 'WIRING_PANEL';
  delivery_type?: 'PICKUP' | 'DELIVERY';
  full_proof_url?: string | null;
  dp_proof_url?: string | null;
  payment_type?: 'FULL' | 'DP';
  dp_input_type?: 'AMOUNT' | 'PERCENTAGE' | null;
  dp_value?: number | null;
  dp_amount?: number | null;
  rejection_reason?: string | null;
  payment_verified_at?: string;
  verified_by?: string;
  created_at: string;
  updated_at: string;
  hpp_total?: number;
}

export interface DbBankConfig {
  id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_active: boolean;
  updated_at: string;
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
  created_at: string;
  // Phase 1A — tempo whitelist
  allows_tempo: boolean;
  term_days: number;
  credit_limit: number;
  tempo_activated_at?: string | null;
  tempo_activated_by?: string | null;
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

export interface DbCompanySettings {
  id: number;
  company_name: string;
  address: string;
  phone: string;
  email: string;
  logo_url?: string | null;
  npwp?: string | null;
  opname_require_witness?: boolean;
  updated_at: string;
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

export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'manajemen-gudang' | 'stok-opname' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings' | 'pipeline' | 'order-history' | 'pelanggan' | 'laporan' | 'pembelian' | 'kasir' | 'penjualanBaru' | 'persetujuan' | 'rekonsiliasi' | 'wip-list' | 'penjualan';

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
export type KasirPaymentType = 'FULL' | 'DP';
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
  | 'adjustment'
  | 'opname'
  | 'price_change'
  | 'kasir_price_override'
  | 'kasir_void'
  | 'kasir_refund'
  | 'rakit_lock'
  | 'customer_credit_activate'
  | 'customer_credit_limit_change'
  | 'customer_credit_deactivate'
  | 'initial_stock';

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
  status: 'in_progress' | 'pending_owner' | 'committed' | 'rejected';
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
