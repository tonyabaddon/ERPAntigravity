/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { List, Edit, Lock } from 'lucide-react';
import { fetchCoaTree } from '../../../lib/akuntansi/glQueries';
import type { CoaTreeRow } from '../../../lib/akuntansi/glQueries';
import type { AccountType } from '../../../lib/akuntansi/types';
import COAEditModal from './COAEditModal';
import { captureError } from '../../../lib/captureError';

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_TYPE_ORDER: AccountType[] = [
  'ASET',
  'LIABILITAS',
  'MODAL',
  'PENDAPATAN',
  'BEBAN',
];

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASET: '1 ASET',
  LIABILITAS: '2 LIABILITAS',
  MODAL: '3 MODAL',
  PENDAPATAN: '4 PENDAPATAN',
  BEBAN: '5 BEBAN',
};

interface TypeStyle {
  headerBg: string;
  headerColor: string;
}

const ACCOUNT_TYPE_STYLES: Record<AccountType, TypeStyle> = {
  ASET: {
    headerBg: 'bg-blue-50/30',
    headerColor: '#1e40af',
  },
  LIABILITAS: {
    headerBg: 'bg-rose-50/30',
    headerColor: '#9f1239',
  },
  MODAL: {
    headerBg: 'bg-violet-50/30',
    headerColor: '#6b21a8',
  },
  PENDAPATAN: {
    headerBg: 'bg-emerald-50/30',
    headerColor: '#065f46',
  },
  BEBAN: {
    headerBg: 'bg-orange-50/30',
    headerColor: '#9a3412',
  },
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface COAManagementTabProps {
  currentUser: { role: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function COAManagementTab({
  currentUser,
  showToast,
}: COAManagementTabProps): React.ReactElement {
  const [accounts, setAccounts] = useState<CoaTreeRow[]>([]);
  const [filtered, setFiltered] = useState<CoaTreeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyActive, setOnlyActive] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingAccount, setEditingAccount] = useState<CoaTreeRow | null>(null);

  const isOwner = currentUser?.role?.toLowerCase() === 'owner';

  // Compute depth from parent_id chain
  function getDepth(account: CoaTreeRow, allAccounts: CoaTreeRow[]): number {
    let depth = 0;
    let current = account;
    while (current.parent_id) {
      depth++;
      current = allAccounts.find(a => a.id === current.parent_id) ?? current;
      if (current.parent_id === undefined) break;
    }
    return depth;
  }

  // Load COA tree
  useEffect(() => {
    let cancelled = false;

    async function loadAccounts() {
      setLoading(true);
      try {
        const data = await fetchCoaTree(true); // includeInactive=true
        if (!cancelled) {
          setAccounts(data);
        }
      } catch (err) {
        if (!cancelled) {
          captureError(err, { feature: 'akuntansi_coa', action: 'load_coa_tree' });
          showToast('Gagal memuat Chart of Accounts', 'warning');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAccounts();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply filters when accounts, onlyActive, or search changes
  useEffect(() => {
    let result = accounts;

    if (onlyActive) {
      result = result.filter(a => a.is_active);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(a =>
        a.account_code.toLowerCase().includes(q) ||
        a.account_name.toLowerCase().includes(q)
      );
    }

    setFiltered(result);
  }, [accounts, onlyActive, searchQuery]);

  function handleEditClick(account: CoaTreeRow) {
    setEditingAccount(account);
  }

  function handleEditClose() {
    setEditingAccount(null);
  }

  function handleEditSaved() {
    // Reload accounts after successful update
    setLoading(true);
    fetchCoaTree(true)
      .then(data => {
        setAccounts(data);
      })
      .catch(err => {
        captureError(err, { feature: 'akuntansi_coa', action: 'reload_coa_tree_after_edit' });
        showToast('Gagal memuat Chart of Accounts', 'warning');
      })
      .finally(() => setLoading(false));
  }

  const accountCount = accounts.filter(a => a.is_active).length;

  return (
    <div className="rounded-sm border border-[var(--color-caleo-mist-dark)] bg-white overflow-hidden">
      {/* ── Header ── */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-sm bg-[var(--color-caleo-cloud)] flex items-center justify-center text-[var(--color-caleo-primary)] shrink-0">
            <List className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-[var(--color-caleo-primary)]">Chart of Accounts</h3>
            <p className="text-xs text-gray-600">
              {accountCount} akun · 59 SAK EMKM standard
            </p>
          </div>
        </div>

        {/* ── Filter Bar ── */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Toggle pills */}
          <div className="flex items-center gap-2 rounded-sm border border-[var(--color-caleo-mist-dark)] p-1 bg-white">
            <button
              className={`px-3 py-1.5 rounded-sm text-xs font-medium transition-colors ${
                onlyActive
                  ? 'bg-[var(--color-caleo-mist-dark)] text-[var(--color-caleo-primary)]'
                  : 'text-gray-600 hover:text-[var(--color-caleo-primary)]'
              }`}
              onClick={() => setOnlyActive(true)}
            >
              Aktif Saja
            </button>
            <button
              className={`px-3 py-1.5 rounded-sm text-xs font-medium transition-colors ${
                !onlyActive
                  ? 'bg-[var(--color-caleo-mist-dark)] text-[var(--color-caleo-primary)]'
                  : 'text-gray-600 hover:text-[var(--color-caleo-primary)]'
              }`}
              onClick={() => setOnlyActive(false)}
            >
              Semua
            </button>
          </div>

          {/* Search box */}
          <input
            type="text"
            placeholder="Cari kode atau nama..."
            className="flex-1 min-w-[200px] border border-[var(--color-caleo-mist-dark)] rounded-sm px-3 py-1.5 text-xs text-[#43474e] bg-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-mist-dark)]"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* ── Non-owner banner ── */}
      {!isOwner && (
        <div className="mx-6 mt-4 rounded-sm border border-gray-300 bg-gray-50 p-3 text-[12px] text-gray-700">
          <strong>Tampilan Read-only</strong> · hanya Owner bisa mengedit Chart of Accounts
        </div>
      )}

      {/* ── Account list ── */}
      <div className="px-6 pb-6 mt-6">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-gray-500">Memuat...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-gray-500">
            Tidak ada akun yang cocok
          </div>
        ) : (
          <div className="space-y-1">
            {ACCOUNT_TYPE_ORDER.map(accountType => {
              const typeRows = filtered.filter(a => a.account_type === accountType);
              if (typeRows.length === 0) return null;

              const style = ACCOUNT_TYPE_STYLES[accountType];
              const label = ACCOUNT_TYPE_LABELS[accountType];

              return (
                <div key={accountType}>
                  {/* Section header */}
                  <div
                    className={`${style.headerBg} font-bold py-2 px-3 rounded-sm mb-2`}
                    style={{ color: style.headerColor }}
                  >
                    ━━ {label} ━━
                  </div>

                  {/* Account rows */}
                  <div className="space-y-1.5">
                    {typeRows.map(account => {
                      const depth = getDepth(account, filtered);
                      const isInactive = !account.is_active;

                      return (
                        <div
                          key={account.id}
                          className={`bg-[#fafbff] border border-[var(--color-caleo-mist-dark)] rounded-sm p-3 flex items-center gap-3 transition-opacity ${
                            isInactive ? 'opacity-60' : ''
                          }`}
                        >
                          {/* Left: code + indent */}
                          <div
                            className={`font-mono text-[13px] font-bold text-[var(--color-caleo-primary)] whitespace-nowrap ${
                              isInactive ? 'text-gray-500' : ''
                            }`}
                            style={{ paddingLeft: `${depth * 16}px` }}
                          >
                            {account.account_code}
                          </div>

                          {/* Middle: name + lock icon */}
                          <div className="flex-1 min-w-0">
                            <div
                              className={`text-[13px] flex items-center gap-2 ${
                                isInactive
                                  ? 'text-gray-500'
                                  : 'text-[#43474e]'
                              }`}
                            >
                              <span className="truncate">{account.account_name}</span>
                              {account.is_system && (
                                <Lock className="w-3.5 h-3.5 shrink-0 text-gray-600" />
                              )}
                            </div>
                          </div>

                          {/* Right: active chip + edit button */}
                          <div className="flex items-center gap-2 shrink-0">
                            <div
                              className={`px-2 py-1 rounded-full text-[11px] font-medium ${
                                account.is_active
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-gray-200 text-gray-700'
                              }`}
                            >
                              {account.is_active ? 'Aktif' : 'Nonaktif'}
                            </div>
                            {isOwner && (
                              <button
                                className="p-1.5 rounded-sm hover:bg-[var(--color-caleo-cloud)] transition-colors text-[var(--color-caleo-primary)]"
                                onClick={() => handleEditClick(account)}
                                title="Edit akun"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Edit Modal ── */}
      {editingAccount && (
        <COAEditModal
          open={!!editingAccount}
          account={editingAccount}
          onClose={handleEditClose}
          onSaved={handleEditSaved}
          showToast={showToast}
        />
      )}
    </div>
  );
}
