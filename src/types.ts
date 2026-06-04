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

export interface StockItem {
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  status: 'Sinkron' | 'Stok Tipis';
  specs: Record<string, string | number>;
  harga_modal?: number | null;
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
  payment_proof_url?: string;
  payment_verified_at?: string;
  verified_by?: string;
  created_at: string;
  updated_at: string;
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
}

export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings' | 'pipeline' | 'order-history' | 'pelanggan' | 'laporan' | 'pembelian' | 'kasir';

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
  customer_phone?: string | null;
  customer_company?: string | null;
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

export interface NewSaleTransaction {
  date: string;
  channel: KasirChannel;
  items: KasirItem[];
  subtotal: number;
  hpp_total: number;
  payment_method: KasirPaymentMethod;
  customer_name?: string;
  customer_phone?: string;
  customer_company?: string;
  invoice_number: string;
}

export interface NewExpense {
  date: string;
  expense_category: KasirExpenseCategory;
  description: string;
  subtotal: number;
}
