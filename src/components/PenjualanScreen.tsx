/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { ShoppingCart } from 'lucide-react';
import { ActivePage, PermissionSet, KasirChannel } from '../types';
import { REGISTRY_MAP, type PermissionKey } from '../lib/permissions';
import TabBar, { TabDef } from './ui/TabBar';
import CatatPenjualanWizard from './penjualan/CatatPenjualanWizard';
import OrderHistoryScreen from './OrderHistoryScreen';

// WIP Rakit tab + WipListScreen removed. Phase 1B funnel
// (Daftar Pesanan → Workshop → Stage 3 → 3f Sedang Dirakit) handles the
// CP/RP cost-lock workflow end-to-end via LockSubmissionModal; the legacy
// list view here was duplicate work.
type PenjualanTab = 'input' | 'riwayat';

interface PenjualanScreenProps {
  currentUser: { id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string; gender?: 'M' | 'F' | 'N' } | null;
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
  // for `penjualanBaru` entry); Riwayat by orderHistory.
  const tabs = useMemo<TabDef<PenjualanTab>[]>(() => {
    const isVisible = (key: keyof PermissionSet): boolean => {
      if (!perms) return true;
      const entry = REGISTRY_MAP.get(key as PermissionKey);
      if (!entry) return true;                        // unknown key = default visible (safe fallback)
      const value = perms[key];
      return entry.isActionPerm ? value === true : value !== false;
    };
    const list: TabDef<PenjualanTab>[] = [];
    if (isVisible('kasir')) list.push({ id: 'input', label: 'Input Baru' });
    if (isVisible('orderHistory')) list.push({ id: 'riwayat', label: 'Riwayat' });
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
        <div className="w-10 h-10 bg-[var(--color-caleo-primary)] rounded-sm flex items-center justify-center shrink-0">
          <ShoppingCart className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-[#0b1c30]">Penjualan</h2>
          <p className="text-xs text-[#0b1c30]/50">Input transaksi baru dan riwayat pesanan</p>
        </div>
      </div>

      <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === 'input' && (
          <CatatPenjualanWizard
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
      </div>
    </div>
  );
}
