/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { BookOpenCheck, Scale, BookOpen, Lock, List } from 'lucide-react';
import { fetchAccountingConfig } from '../../lib/akuntansi/service';
import type { AccountingConfig } from '../../lib/akuntansi/types';
import OpeningBalanceWizard from './OpeningBalanceWizard';
import TrialBalanceTab from './gl/TrialBalanceTab';
import BukuBesarTab from './gl/BukuBesarTab';
import TutupBukuTab from './gl/TutupBukuTab';
import COAManagementTab from './gl/COAManagementTab';

interface Props {
  currentUser: { role: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type AkuntansiTab = 'trial-balance' | 'buku-besar' | 'tutup-buku' | 'coa';

export default function AkuntansiScreen({ currentUser, showToast }: Props) {
  const [config, setConfig] = useState<AccountingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AkuntansiTab>('trial-balance');
  const [bukuBesarAccountId, setBukuBesarAccountId] = useState<string | null>(null);
  const [cameFromTB, setCameFromTB] = useState(false);

  function loadConfig() {
    fetchAccountingConfig()
      .then(setConfig)
      .catch(err => {
        console.error(err);
        showToast('Gagal load akuntansi config', 'warning');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadConfig();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-[#43474e] text-[13px]">Memuat...</div>
    );
  }

  const isOwner = currentUser?.role?.toLowerCase() === 'owner';

  const handleDrillDown = (accountId: string) => {
    setBukuBesarAccountId(accountId);
    setCameFromTB(true);
    setActiveTab('buku-besar');
  };

  const handleBackToTB = () => {
    setActiveTab('trial-balance');
    setCameFromTB(false);
  };

  // Opening balance not yet set
  if (!config?.opening_balance_set) {
    if (!isOwner) {
      return (
        <div className="p-8 max-w-2xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#eff4ff] flex items-center justify-center text-[#012749]">
              <BookOpenCheck className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-extrabold text-[#012749]">Akuntansi</h1>
          </div>
          <div className="border border-[#c7d7f5] bg-[#fafbff] rounded-xl p-6 text-[13px] text-[#43474e]">
            Setup saldo awal belum dilakukan. Owner perlu menyelesaikan wizard pertama kali.
          </div>
        </div>
      );
    }
    return (
      <OpeningBalanceWizard
        onDone={() => {
          setLoading(true);
          loadConfig();
        }}
        showToast={showToast}
      />
    );
  }

  // Opening balance already set — render 4-tab layout
  const tabs: Array<{ key: AkuntansiTab; label: string; icon: React.ComponentType<{ className: string }> }> = [
    { key: 'trial-balance', label: 'Trial Balance', icon: Scale },
    { key: 'buku-besar', label: 'Buku Besar', icon: BookOpen },
    { key: 'tutup-buku', label: 'Tutup Buku', icon: Lock },
    { key: 'coa', label: 'COA', icon: List },
  ];

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="p-8 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#eff4ff] flex items-center justify-center text-[#012749]">
            <BookOpenCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-[#012749]">Akuntansi MSME</h1>
            <p className="text-[12px] text-[#43474e]">
              Saldo awal di-set per{' '}
              <strong>{config.opening_balance_date ?? '—'}</strong>
            </p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200 px-6 flex gap-1 overflow-x-auto bg-white">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-3 text-[13px] whitespace-nowrap transition-colors inline-flex items-center gap-2 ${
                activeTab === t.key
                  ? 'font-extrabold border-b-2 border-emerald-600 text-[#012749]'
                  : 'font-bold text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-8">
        {activeTab === 'trial-balance' && (
          <TrialBalanceTab onDrillDown={handleDrillDown} showToast={showToast} />
        )}
        {activeTab === 'buku-besar' && (
          <BukuBesarTab
            initialAccountId={bukuBesarAccountId}
            onBackToTB={cameFromTB ? handleBackToTB : undefined}
            showToast={showToast}
          />
        )}
        {activeTab === 'tutup-buku' && (
          <TutupBukuTab showToast={showToast} />
        )}
        {activeTab === 'coa' && (
          <COAManagementTab currentUser={currentUser} showToast={showToast} />
        )}
      </div>
    </div>
  );
}
