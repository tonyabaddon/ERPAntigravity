/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdminUser, StockItem, NotificationConfig } from './types';

export const INITIAL_ADMINS: AdminUser[] = [
  {
    id: '1',
    name: 'Admin Rini',
    email: 'rini@sinarelektrik.com',
    whatsapp: '+6281233445566',
    role: 'Staff Admin Toko',
    permissions: {
      dashboard: true,
      sales: true,
      stokAi: false,
      konfig: false,
    },
    status: 'Aktif',
  },
  {
    id: '2',
    name: 'Admin Agus',
    email: 'agus@sinarelektrik.com',
    whatsapp: '+6289988776655',
    role: 'Supervisor Gudang',
    permissions: {
      dashboard: true,
      sales: false,
      stokAi: true,
      konfig: false,
    },
    status: 'Aktif',
  },
];

export const INITIAL_STOCK: StockItem[] = [
  {
    sku: 'SKU-40A-01',
    name: 'Kabel Tembaga 40A',
    category: 'Kabel',
    price: 120000,
    stock: 150,
    status: 'Sinkron',
  },
  {
    sku: 'SKU-BX-SM',
    name: 'Box Panel - Ukuran Kecil',
    category: 'Panel',
    price: 650000,
    stock: 12,
    status: 'Sinkron',
  },
  {
    sku: 'SKU-WR-05',
    name: 'Sakelar Broco Modern',
    category: 'Aksesori',
    price: 25000,
    stock: 8,
    status: 'Stok Tipis',
  },
];

export const INITIAL_CONFIG: NotificationConfig = {
  enabled: true,
  interval: 'Setiap 4 Jam',
  targetNumber: '81234567890',
  reportComponents: {
    revenue: true,
    queue: true,
    activity: true,
    status: false,
  },
  lowStockAlert: 10,
  delayAlert: 30,
};
