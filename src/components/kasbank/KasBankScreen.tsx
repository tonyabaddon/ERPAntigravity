/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  Wallet,
  Landmark,
  Banknote,
  Bike,
  User,
  Plus,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import { fetchCashAccountBalances, fetchCashAccounts } from '../../lib/kasbank/service';
import type { CashAccount, CashAccountBalance, CashAccountType } from '../../lib/kasbank/types';
import { formatRp } from '../../lib/format';
import AccountFormModal from './AccountFormModal';
import { captureError } from '../../lib/captureError';
import LoadingState from '../ui/LoadingState';
import EmptyState from '../ui/EmptyState';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface KasBankScreenProps {
  currentUser: { name: string; role: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onNavigate: (page: string, params?: unknown) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns WIB timestamp string, e.g. "22 Jun 2026 14:32 WIB" */
function wibTimestamp(): string {
  return new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' WIB';
}

// Icon tile configuration by account_type
interface IconTileConfig {
  bgClass: string;
  textClass: string;
  Icon: React.ElementType;
}

function accountIconConfig(type: CashAccountType): IconTileConfig {
  switch (type) {
    case 'BANK':
      return { bgClass: 'bg-blue-100', textClass: 'text-blue-800', Icon: Landmark };
    case 'KAS':
      return { bgClass: 'bg-emerald-100', textClass: 'text-caleo-success', Icon: Banknote };
    case 'E_WALLET':
      return { bgClass: 'bg-amber-100', textClass: 'text-amber-800', Icon: Bike };
    default:
      return { bgClass: 'bg-[var(--color-caleo-cloud)]', textClass: 'text-[var(--color-caleo-primary)]', Icon: Wallet };
  }
}

// Type chip label + colors by account_type
function typeChip(type: CashAccountType): { label: string; bgClass: string; textClass: string } {
  switch (type) {
    case 'BANK':
      return { label: 'Bank', bgClass: 'bg-blue-100', textClass: 'text-blue-800' };
    case 'KAS':
      return { label: 'Kas', bgClass: 'bg-emerald-100', textClass: 'text-caleo-success' };
    case 'E_WALLET':
      return { label: 'Wallet', bgClass: 'bg-amber-100', textClass: 'text-amber-800' };
    default:
      return { label: type, bgClass: 'bg-gray-100', textClass: 'text-gray-700' };
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface AccountCardProps {
  account: CashAccountBalance;
  isPersonal?: boolean;
  onClick: () => void;
}

function AccountCard({ account, isPersonal = false, onClick }: AccountCardProps) {
  const { bgClass, textClass, Icon } = accountIconConfig(account.account_type);
  const chip = typeChip(account.account_type);

  // Subtitle: COA code + bank/provider info
  const codePart = account.account_code ? (
    <span className="font-mono font-bold">{account.account_code}</span>
  ) : null;

  const bankPart = account.bank_code && account.account_number
    ? `${account.bank_code} · ${account.account_number}`
    : account.bank_code
    ? account.bank_code
    : account.provider
    ? account.provider
    : null;

  const subtitleParts: React.ReactNode[] = [];
  if (codePart) subtitleParts.push(codePart);
  if (bankPart) subtitleParts.push(<span key="bank">{bankPart}</span>);

  const hasPendingIn = account.pending_in > 0;

  if (isPersonal) {
    return (
      <div
        className="border border-gray-200 bg-gray-50 rounded p-5 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5"
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onClick()}
      >
        {/* Header row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded flex items-center justify-center bg-gray-200 text-gray-500">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-extrabold text-gray-700">{account.internal_label}</div>
              <div className="text-caleo-11 text-gray-500 flex items-center gap-1 flex-wrap mt-0.5">
                {subtitleParts.map((part, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span>·</span>}
                    {part}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-caleo-10 font-extrabold uppercase tracking-wide bg-gray-300 text-gray-700">
            Pribadi
          </span>
        </div>

        {/* Balance */}
        <div className="text-2xl font-black text-gray-700">{formatRp(account.current_balance)}</div>

        {/* Footer */}
        <div className="mt-3 text-caleo-11 text-gray-500">
          {account.movements_this_month > 0
            ? `${account.movements_this_month} mutasi GL bulan ini`
            : <EmptyState inline message="Belum ada mutasi." />}
        </div>
      </div>
    );
  }

  return (
    <div
      className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded p-5 cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded flex items-center justify-center ${bgClass} ${textClass}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-extrabold" style={{ color: 'var(--color-primary)' }}>
              {account.internal_label}
            </div>
            <div className="text-caleo-11 text-gray-500 flex items-center gap-1 flex-wrap mt-0.5">
              {subtitleParts.map((part, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span>·</span>}
                  {part}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-caleo-10 font-extrabold uppercase tracking-wide ${chip.bgClass} ${chip.textClass}`}
        >
          {chip.label}
        </span>
      </div>

      {/* Balance */}
      <div className="text-2xl font-black" style={{ color: 'var(--color-primary)' }}>
        {formatRp(account.current_balance)}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 text-caleo-11 text-gray-500">
        <span className="flex items-center gap-1">
          <Activity className="w-3 h-3" />
          {account.movements_this_month > 0
            ? `${account.movements_this_month} mutasi GL`
            : <EmptyState inline message="Belum ada mutasi." />}
        </span>
        {hasPendingIn && (
          <span className="text-amber-700 font-bold flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {formatRp(account.pending_in)} pending
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function KasBankScreen({ currentUser, showToast, onNavigate }: KasBankScreenProps) {
  const [accounts, setAccounts] = useState<CashAccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [timestamp] = useState(() => wibTimestamp());
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<CashAccount | null>(null);

  const isOwner = currentUser?.role?.toLowerCase() === 'owner';

  function openAddModal() {
    setEditingAccount(null);
    setShowAddModal(true);
  }

  async function openEditModal(cashAccountId: string) {
    try {
      const all = await fetchCashAccounts();
      const found = all.find(a => a.id === cashAccountId);
      if (!found) {
        showToast('Akun tidak ditemukan', 'warning');
        return;
      }
      setEditingAccount(found);
      setShowAddModal(true);
    } catch (err) {
      captureError(err, { feature: 'kasbank', action: 'fetch_cash_accounts' });
      showToast('Gagal memuat detail akun', 'warning');
    }
  }

  function loadAccounts() {
    setLoading(true);
    fetchCashAccountBalances()
      .then(data => setAccounts(data))
      .catch(err => {
        captureError(err, { feature: 'kasbank', action: 'fetch_cash_account_balances' });
        showToast('Gagal memuat data kas & bank', 'warning');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Split into business vs personal
  const businessAccounts = accounts.filter(a => a.purpose !== 'OWNER_PERSONAL');
  const personalAccounts = accounts.filter(a => a.purpose === 'OWNER_PERSONAL');

  // Total liquid = sum current_balance for business accounts
  const totalLiquid = businessAccounts.reduce((sum, a) => sum + a.current_balance, 0);

  // Total pending across business accounts
  const totalPending = businessAccounts.reduce((sum, a) => sum + a.pending_in, 0);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="p-8">
        <LoadingState label="Memuat data kas & bank..." />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded bg-[var(--color-caleo-cloud)] flex items-center justify-center text-[var(--color-caleo-primary)]">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold" style={{ color: 'var(--color-primary)' }}>
              Kas &amp; Bank
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Saldo per {timestamp} · derive dari General Ledger
            </p>
          </div>
        </div>

        {isOwner && (
          <button
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 rounded-full text-xs font-bold px-3.5 py-2 bg-[var(--color-caleo-primary)] text-white hover:bg-[#01365e] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Tambah Akun
          </button>
        )}
      </div>

      {/* Total liquid hero card */}
      <div
        className="rounded p-6 text-white mb-6"
        style={{ background: 'linear-gradient(135deg, #065f46, #047857)' }}
      >
        <div className="text-caleo-11 uppercase tracking-widest text-emerald-100 font-extrabold mb-1">
          Total liquid (akun bisnis · cleared)
        </div>
        <div className="text-4xl font-black tracking-tight">{formatRp(totalLiquid)}</div>
        {totalPending > 0 && (
          <div className="text-xs text-emerald-100 mt-2 flex items-center gap-2">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            Termasuk {formatRp(totalPending)} marketplace PENDING (tidak masuk saldo cleared)
          </div>
        )}
      </div>

      {/* Akun Bisnis section */}
      <div className="mb-8">
        <div className="flex items-baseline justify-between mb-3">
          <h4
            className="text-sm font-extrabold uppercase tracking-widest"
            style={{ color: 'var(--color-primary)' }}
          >
            Akun Bisnis
          </h4>
          <span className="text-xs text-gray-500">
            {businessAccounts.length} akun aktif
          </span>
        </div>

        {businessAccounts.length === 0 ? (
          <EmptyState
            message="Belum ada akun bisnis."
            className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded"
            action={isOwner ? { label: '+ Tambah Akun', onClick: openAddModal } : undefined}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {businessAccounts.map(account => (
              <AccountCard
                key={account.cash_account_id}
                account={account}
                onClick={() => onNavigate('kasBank-detail', account.cash_account_id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Akun Pribadi section — only render if any exist */}
      {personalAccounts.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h4 className="text-sm font-extrabold uppercase tracking-widest text-gray-500 flex items-center gap-2">
              Akun Pribadi
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-caleo-10 font-extrabold bg-gray-200 text-gray-700">
                Excluded dari laporan bisnis
              </span>
            </h4>
            <span className="text-xs text-gray-500">
              {personalAccounts.length} akun
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {personalAccounts.map(account => (
              <AccountCard
                key={account.cash_account_id}
                account={account}
                isPersonal
                onClick={() => onNavigate('kasBank-detail', account.cash_account_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Full empty state — no accounts at all */}
      {accounts.length === 0 && (
        <EmptyState
          message="Belum ada akun kas atau bank"
          hint="Tambahkan rekening bank, kas toko, atau e-wallet untuk mulai mencatat saldo."
          icon={Wallet}
          className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded mt-2"
          action={isOwner ? { label: '+ Tambah Akun Pertama', onClick: openAddModal } : undefined}
        />
      )}

      {/* Add/Edit Account Modal (Task 7) */}
      <AccountFormModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSaved={loadAccounts}
        editingAccount={editingAccount}
        showToast={showToast}
      />
    </div>
  );
}
