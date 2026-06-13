/**
 * Single source of truth for the 14 canonical sales channels.
 * Replaces the 5 scattered hardcoded maps (salesEntries CHANNEL_LABEL/BADGE_CLASS,
 * SalesInvoicePDF inline hash, KasirInvoiceModal inline hash, OrdersColumn CHANNEL_PILL).
 *
 * Spec: docs/superpowers/specs/2026-06-13-configurable-sales-channels-design.md
 */

import type { SalesChannel } from '../types';

export type ChannelGroup = 'offline' | 'marketplace' | 'direct';

export interface ChannelDef {
  code: SalesChannel;
  label: string;
  iconType: 'svg' | 'lucide';
  iconAsset: string;
  group: ChannelGroup;
  invoicePrefix: string;
  flow: 'kasir' | 'orders';
  requiresOrderNo: boolean;
  brandColor: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
}

export const CHANNEL_VISUAL: Record<SalesChannel, ChannelDef> = {
  walkin: {
    code: 'walkin', label: 'Walk-in', iconType: 'lucide', iconAsset: 'Store',
    group: 'offline', invoicePrefix: 'WLK', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#64748B',
    bgClass: 'bg-slate-100', textClass: 'text-slate-700', borderClass: 'border-slate-500',
  },
  grosir: {
    code: 'grosir', label: 'Grosir', iconType: 'lucide', iconAsset: 'Warehouse',
    group: 'offline', invoicePrefix: 'GSR', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#7C3AED',
    bgClass: 'bg-violet-50', textClass: 'text-violet-700', borderClass: 'border-violet-600',
  },
  sales: {
    code: 'sales', label: 'Sales Lapangan', iconType: 'lucide', iconAsset: 'Briefcase',
    group: 'offline', invoicePrefix: 'SLS', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#D97706',
    bgClass: 'bg-amber-50', textClass: 'text-amber-700', borderClass: 'border-amber-600',
  },
  expo: {
    code: 'expo', label: 'Pameran / Expo', iconType: 'lucide', iconAsset: 'Tent',
    group: 'offline', invoicePrefix: 'EXP', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#0D9488',
    bgClass: 'bg-teal-50', textClass: 'text-teal-700', borderClass: 'border-teal-600',
  },
  tokopedia: {
    code: 'tokopedia', label: 'Tokopedia / TikTok Shop', iconType: 'svg', iconAsset: '/icons/channels/tokopedia.svg',
    group: 'marketplace', invoicePrefix: 'TPD', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#03AC0E',
    bgClass: 'bg-green-50', textClass: 'text-green-700', borderClass: 'border-green-600',
  },
  shopee: {
    code: 'shopee', label: 'Shopee', iconType: 'svg', iconAsset: '/icons/channels/shopee.svg',
    group: 'marketplace', invoicePrefix: 'SHP', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#EE4D2D',
    bgClass: 'bg-orange-50', textClass: 'text-orange-700', borderClass: 'border-orange-600',
  },
  lazada: {
    code: 'lazada', label: 'Lazada', iconType: 'svg', iconAsset: '/icons/channels/lazada.svg',
    group: 'marketplace', invoicePrefix: 'LZD', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#0F146E',
    bgClass: 'bg-indigo-50', textClass: 'text-indigo-700', borderClass: 'border-indigo-700',
  },
  blibli: {
    code: 'blibli', label: 'Blibli', iconType: 'svg', iconAsset: '/icons/channels/blibli.svg',
    group: 'marketplace', invoicePrefix: 'BLB', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#0095DA',
    bgClass: 'bg-sky-50', textClass: 'text-sky-700', borderClass: 'border-sky-600',
  },
  bukalapak: {
    code: 'bukalapak', label: 'Bukalapak', iconType: 'svg', iconAsset: '/icons/channels/bukalapak.svg',
    group: 'marketplace', invoicePrefix: 'BKL', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#E31E52',
    bgClass: 'bg-rose-50', textClass: 'text-rose-700', borderClass: 'border-rose-600',
  },
  ralali: {
    code: 'ralali', label: 'Ralali', iconType: 'svg', iconAsset: '/icons/channels/ralali.svg',
    group: 'marketplace', invoicePrefix: 'RLI', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#1E3A8A',
    bgClass: 'bg-blue-50', textClass: 'text-blue-800', borderClass: 'border-blue-800',
  },
  bhinneka: {
    code: 'bhinneka', label: 'Bhinneka', iconType: 'svg', iconAsset: '/icons/channels/bhinneka.svg',
    group: 'marketplace', invoicePrefix: 'BHN', flow: 'kasir', requiresOrderNo: true,
    brandColor: '#E63946',
    bgClass: 'bg-red-50', textClass: 'text-red-700', borderClass: 'border-red-600',
  },
  whatsapp: {
    code: 'whatsapp', label: 'WhatsApp', iconType: 'svg', iconAsset: '/icons/channels/whatsapp.svg',
    group: 'direct', invoicePrefix: 'WAM', flow: 'orders', requiresOrderNo: false,
    brandColor: '#25D366',
    bgClass: 'bg-emerald-50', textClass: 'text-emerald-700', borderClass: 'border-emerald-600',
  },
  instagram: {
    code: 'instagram', label: 'Instagram DM', iconType: 'svg', iconAsset: '/icons/channels/instagram.svg',
    group: 'direct', invoicePrefix: 'IGM', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#E1306C',
    bgClass: 'bg-pink-50', textClass: 'text-pink-700', borderClass: 'border-pink-600',
  },
  website: {
    code: 'website', label: 'Website Sendiri', iconType: 'lucide', iconAsset: 'Globe',
    group: 'direct', invoicePrefix: 'WEB', flow: 'kasir', requiresOrderNo: false,
    brandColor: '#475569',
    bgClass: 'bg-slate-100', textClass: 'text-slate-700', borderClass: 'border-slate-600',
  },
};

export const CHANNEL_GROUPS: Record<ChannelGroup, SalesChannel[]> = {
  offline:     ['walkin', 'grosir', 'sales', 'expo'],
  marketplace: ['tokopedia', 'shopee', 'lazada', 'blibli', 'bukalapak', 'ralali', 'bhinneka'],
  direct:      ['whatsapp', 'instagram', 'website'],
};

export const CHANNEL_REQUIRES_ORDER_NO: Set<SalesChannel> = new Set(CHANNEL_GROUPS.marketplace);

// No channels are locked — admin can disable any of the 14 (D11 revoked 2026-06-13).
// If admin disables ALL channels, PenjualanBaru pill selector renders empty and
// operator cannot input new sales. By design — admin is trusted. Historical data
// (recon, dashboard, laporan) is unaffected by visibility.
export const CHANNEL_LOCKED: Set<SalesChannel> = new Set();

export function getChannelDef(code: SalesChannel): ChannelDef {
  return CHANNEL_VISUAL[code];
}

export function isMarketplaceChannel(code: SalesChannel): boolean {
  return CHANNEL_GROUPS.marketplace.includes(code);
}

export function getGroupOf(code: SalesChannel): ChannelGroup {
  return getChannelDef(code).group;
}
