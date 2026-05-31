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

export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai';
