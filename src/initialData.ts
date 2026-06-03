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
    name: 'Kabel NYM 2.5mm² 100m/Rol',
    category: 'Kabel',
    price: 120000,
    stock: 150,
    status: 'Sinkron',
    specs: { kabel_tipe: 'NYM', kabel_mm2: 2.5, kabel_panjang: '100m/Rol' },
  },
  {
    sku: 'SKU-BX-SM',
    name: 'Panel Besi Indoor 60×40×20cm 1.5mm RAL7032 Kosong',
    category: 'Panel',
    price: 650000,
    stock: 12,
    status: 'Sinkron',
    specs: { material: 'Besi', tipe_pasang: 'Indoor', tinggi_cm: 60, lebar_cm: 40, tebal_cm: 20, ketebalan_mm: 1.5, finishing: 'RAL7032', kelengkapan: 'Kosong' },
  },
  {
    sku: 'SKU-WR-05',
    name: 'Sakelar Broco Modern',
    category: 'Aksesori',
    price: 25000,
    stock: 8,
    status: 'Stok Tipis',
    specs: { deskripsi: 'Sakelar Broco Modern' },
  },
];

export const INITIAL_CONFIG: NotificationConfig = {
  enabled: true,
  interval: 'Setiap 4 Jam',
  reportComponents: {
    revenue: true,
    queue: true,
    activity: true,
    status: false,
  },
  lowStockAlert: 10,
  delayAlert: 30,
};
