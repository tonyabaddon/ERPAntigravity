/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { ShoppingCart } from 'lucide-react';
import { ActivePage, PermissionSet, KasirChannel } from '../types';
import TabBar, { TabDef } from './ui/TabBar';
import PenjualanBaruScreen from './PenjualanBaruScreen';
import OrderHistoryScreen from './OrderHistoryScreen';
import WipListScreen from './WipListScreen';

type PenjualanTab = 'input' | 'riwayat' | 'wip';

interface PenjualanScreenProps {
  currentUser: { id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  initialTab?: PenjualanTab;
  initialChannel?: KasirChannel;
  onBack: () => void;
  onSaved: (txId: string) => void;
  onNavigate: (page: ActivePage) => void;
  onOpenCustomer: (customerId: string) => void;
}

export default function PenjualanScreen(props: PenjualanScreenProps) {
  const perms = props.currentUser?.permissions;

  // Tabs filtered by permission: Input gated by kasir (matches sidebar perm
  // for `penjualanBaru` entry); Riwayat by orderHistory; WIP by aiStock
  // (matches existing perm key used by `wip-list` sidebar entry).
  const tabs = useMemo<TabDef<PenjualanTab>[]>(() => {
    const isVisible = (key: keyof PermissionSet): boolean => {
      if (!perms) return true;
      const value = perms[key];
      if (typeof key === 'string' && key.startsWith('can_')) return value === true;
      return value !== false;
    };
    const list: TabDef<PenjualanTab>[] = [];
    if (isVisible('kasir')) list.push({ id: 'input', label: 'Input Baru' });
    if (isVisible('orderHistory')) list.push({ id: 'riwayat', label: 'Riwayat' });
    if (isVisible('aiStock')) list.push({ id: 'wip', label: 'WIP Rakit' });
    return list;
  }, [perms]);

  const [activeTab, setActiveTab] = useState<PenjualanTab>(() => {
    if (props.initialTab && tabs.some(t => t.id === props.initialTab)) return props.initialTab;
    return tabs[0]?.id ?? 'input';
  });

  if (tabs.length === 0) {
    return <div className="p-8 text-center text-slate-500 font-semibold">Akses Penjualan terbatas.</div>;
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3 px-2">
        <div className="w-10 h-10 bg-[#012749] rounded-xl flex items-center justify-center shrink-0">
          <ShoppingCart className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-[#0b1c30]">Penjualan</h2>
          <p className="text-xs text-[#0b1c30]/50">Input transaksi baru, riwayat pesanan, dan rakit WIP</p>
        </div>
      </div>

      <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div className="flex-1 min-h-0">
        {activeTab === 'input' && (
          <PenjualanBaruScreen
            currentUser={props.currentUser}
            showToast={props.showToast}
            initialChannel={props.initialChannel}
            onBack={props.onBack}
            onSaved={props.onSaved}
            onNavigate={props.onNavigate}
          />
        )}
        {activeTab === 'riwayat' && (
          <OrderHistoryScreen
            currentUser={props.currentUser}
            onOpenCustomer={props.onOpenCustomer}
            showToast={props.showToast}
          />
        )}
        {activeTab === 'wip' && (
          <WipListScreen
            currentUser={props.currentUser}
            showToast={props.showToast}
          />
        )}
      </div>
    </div>
  );
}
