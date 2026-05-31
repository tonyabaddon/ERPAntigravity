/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AdminUser, ChatItem, StockItem, NotificationConfig } from './types';

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

export const INITIAL_CHATS: ChatItem[] = [
  {
    id: 'bp_1',
    name: 'Budi Pratama',
    initials: 'BP',
    avatarColor: 'bg-red-50 text-red-700 border-red-100',
    unreadCount: 2,
    lastMessage: 'Halo, saya ingin menanyakan apakah stok baran...',
    date: '22 Mei',
    time: '2 mins ago',
    status: 'BUTUH_ADMIN',
    messages: [
      {
        id: 'bp_m1',
        sender: 'user',
        text: 'Halo, selamat siang. Saya mau menanyakan apakah stok Box Panel ukuran kecil ready?',
        time: '14:18 PM',
      },
      {
        id: 'bp_m2',
        sender: 'ai',
        text: 'Halo Bapak Budi! Stok Box Panel untuk tipe standar kami sedang kosong. Tetapi kami ada tipe premium anti-karat yang ready dengan selisi harga Rp 15.000 saja. Apakah berminat?',
        time: '14:18 PM',
      },
      {
        id: 'bp_m3',
        sender: 'user',
        text: 'Wah begitu ya. Bisa tolong dicarikan yang tipe biasa saja? Saya butuh 5 pcs untuk instalasi besok pagi.',
        time: '14:20 PM',
      },
      {
        id: 'bp_m4',
        sender: 'system',
        text: '👤 SYSTEM: KASUS MEMERLUKAN PENANGANAN MANUSIA (BUTUH_ADMIN). AI MENGHENTIKAN OTOMATISASI DAN MENUNGGU RESPON AGENT.',
        time: '14:21 PM',
      },
    ],
  },
  {
    id: 'sn_1',
    name: 'Siti Nurbaya',
    initials: 'SN',
    avatarColor: 'bg-orange-50 text-orange-700 border-orange-100',
    unreadCount: 0,
    lastMessage: 'Kapan paket saya akan dikirimkan? Terima kasih.',
    date: '21 Mei',
    time: '15 mins ago',
    status: 'WIRING_CUSTOM',
    messages: [
      {
        id: 'sn_m1',
        sender: 'user',
        text: 'Malam Pak, saya mau pesan Kabel Tembaga 40A tapi dipotong custom per 3 meter bisa tidak?',
        time: '11:00 AM',
      },
      {
        id: 'sn_m2',
        sender: 'ai',
        text: 'Halo Ibu Siti! Untuk pemotongan kabel tembaga custom, kami memerlukan persetujuan tim teknis gudang kami untuk memotong spool kawat. Umumnya bisa kami layani dengan biaya potong tambahan sebesar Rp 5.000.',
        time: '11:02 AM',
      },
      {
        id: 'sn_m3',
        sender: 'user',
        text: 'Kapan paket saya akan dikirimkan kalau saya pesan custom 5 potong hari ini? Terima kasih.',
        time: '11:15 AM',
      },
      {
        id: 'sn_m4',
        sender: 'system',
        text: '👤 SYSTEM: KASUS MEMERLUKAN PENANGANAN MANUSIA (WIRING / CUSTOM). AI MENGHENTIKAN OTOMATISASI.',
        time: '11:16 AM',
      },
    ],
  },
  {
    id: 'as_1',
    name: 'Andi Saputra',
    initials: 'AS',
    avatarColor: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    unreadCount: 0,
    lastMessage: 'Terima kasih atas bantuannya, AI sangat...',
    date: '20 Mei',
    time: '45 mins ago',
    status: 'DIKELOLA_AI',
    messages: [
      {
        id: 'as_m1',
        sender: 'user',
        text: 'Halo, apakah produk Keripik Tempe Super renyah masih tersedia untuk pengiriman hari ini?',
        time: '14:21 PM',
      },
      {
        id: 'as_m2',
        sender: 'ai',
        text: 'Halo Bapak Andi! Ya, stok Keripik Tempe Super kami masih tersedia. Jika Bapak melakukan pemesanan sebelum jam 16:00, barang bisa dikirimkan hari ini juga.',
        time: '14:21 PM',
      },
      {
        id: 'as_m3',
        sender: 'user',
        text: 'Bagus. Saya butuh 10 bungkus. Apakah ada promo untuk pembelian minimal 10?',
        time: '14:24 PM',
      },
      {
        id: 'as_m4',
        sender: 'ai',
        text: 'Tentu! Untuk pembelian minimal 10 bungkus, Bapak mendapatkan potongan harga 5%. Total pesanan Bapak menjadi Rp 237.500. Apakah Bapak ingin saya buatkan link pembayarannya?',
        time: '14:26 PM',
      },
    ],
  },
  {
    id: 'wk_1',
    name: 'Wati Kusuma',
    initials: 'WK',
    avatarColor: 'bg-blue-50 text-blue-700 border-blue-100',
    unreadCount: 0,
    lastMessage: 'Apakah ada diskon untuk pembelian grosir?',
    date: '14 Mei',
    time: '1 hour ago',
    status: 'DIKELOLA_AI',
    messages: [
      {
        id: 'wk_m1',
        sender: 'user',
        text: 'Selamat pagi, saya Wati dari Toko Jaya Sentosa. Kami butuh Sakelar Broco Modern dalam jumlah besar, sekitar 100 pcs. Apakah ada diskon untuk pembelian grosir?',
        time: '08:12 AM',
      },
      {
        id: 'wk_m2',
        sender: 'ai',
        text: 'Selamat pagi Ibu Wati! Sangat bisa. Untuk pembelian Sakelar Broco Modern sebanyak 100 pcs, kami memberikan diskon grosir khusus sebesar 12%. Harganya menjadi Rp 22.000/pcs dari harga normal Rp 25.000/pcs. Apakah pesanan ingin didaftarkan ke sistem?',
        time: '08:15 AM',
      },
    ],
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
