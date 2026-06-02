/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PermissionSet {
  dashboard: boolean;
  sales: boolean;
  stokAi: boolean;
  konfig: boolean;
}

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
}

export interface NotificationConfig {
  enabled: boolean;
  interval: string;
  targetNumber: string;
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
  booking_expires_at: string;
  gjp_order_id?: string;
  order_type?: 'STANDARD' | 'CUSTOM_PANEL' | 'WIRING_PANEL';
  delivery_type?: 'PICKUP' | 'DELIVERY';
  payment_proof_url?: string;
  payment_verified_at?: string;
  verified_by?: string;
  updated_at: string;
}

export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai';
