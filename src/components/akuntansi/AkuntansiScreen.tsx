/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { BookOpenCheck } from 'lucide-react';
import { fetchAccountingConfig } from '../../lib/akuntansi/service';
import type { AccountingConfig } from '../../lib/akuntansi/types';
import OpeningBalanceWizard from './OpeningBalanceWizard';

interface Props {
  currentUser: { role: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function AkuntansiScreen({ currentUser, showToast }: Props) {
  const [config, setConfig] = useState<AccountingConfig | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Opening balance already set — Phase 0b-0d placeholder
  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
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

      <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-4 text-[13px] text-emerald-900">
        <p className="font-bold mb-1">Foundation ready</p>
        <p>
          Buku Besar, Trial Balance, dan Period Close menyusul di Phase 0b–0d.
        </p>
      </div>
    </div>
  );
}
