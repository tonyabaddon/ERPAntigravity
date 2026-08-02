// Step1KasBank.tsx
// Wizard Step 1 — Kas & Bank opening balances.
// Fetches cash_accounts, lets owner enter opening_balance + as_of per account.
// Shows cross-check warning if total differs from current DB values.

import { useEffect, useState } from 'react';
import { fetchCashAccounts } from '../../../lib/kasbank/service';
import type { CashAccount } from '../../../lib/kasbank/types';
import type { Step1Cash, Step1CashAccount } from '../../../lib/saldoAwal/types';
import { NumberInput } from '../../ui/NumberInput';
import { formatIDR } from '../../../lib/formatIDR';
import { wibDateString } from '../../../lib/format';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';

interface Props {
  data: Step1Cash;
  onChange: (data: Step1Cash) => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function Step1KasBank({ data, onChange, showToast }: Props) {
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Load cash_accounts on mount
  useEffect(() => {
    fetchCashAccounts()
      .then((fetched) => {
        setAccounts(fetched);
        // Seed step data if not yet initialised (empty accounts array)
        if (data.accounts.length === 0) {
          const seeded: Step1CashAccount[] = fetched.map((a) => ({
            cash_account_id: a.id,
            cash_account_name: a.internal_label,
            opening_balance: a.opening_balance ?? 0,
            as_of: a.opening_balance_date ?? wibDateString(),
          }));
          onChange({ accounts: seeded });
        }
      })
      .catch((err: unknown) => {
        const msg = extractErrorMessage(err);
        showToast(`Gagal memuat akun Kas & Bank: ${msg}`, 'warning');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="py-10 text-center text-[13px] text-slate-400">Memuat akun Kas & Bank…</div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="py-10 text-center space-y-2">
        <p className="text-[13px] text-slate-600 font-medium">Belum ada akun Kas & Bank.</p>
        <p className="text-[12px] text-slate-500">
          Setup akun Kas & Bank di menu Kas & Bank terlebih dahulu sebelum mengisi Saldo Awal.
        </p>
      </div>
    );
  }

  const stepAccounts = data.accounts;

  // Cross-check: compare wizard total vs DB total
  const wizardTotal = stepAccounts.reduce((s, a) => s + (a.opening_balance ?? 0), 0);
  const dbTotal = accounts.reduce((s, a) => s + (a.opening_balance ?? 0), 0);
  const diffAbs = Math.abs(wizardTotal - dbTotal);
  const showCrossCheck = dbTotal !== 0 && diffAbs > 100; // only warn if meaningful diff

  function updateAccount(id: string, patch: Partial<Step1CashAccount>) {
    onChange({
      accounts: stepAccounts.map((a) =>
        a.cash_account_id === id ? { ...a, ...patch } : a,
      ),
    });
  }

  // Sync balances from current DB values
  function syncFromDB() {
    onChange({
      accounts: accounts.map((a) => ({
        cash_account_id: a.id,
        cash_account_name: a.internal_label,
        opening_balance: a.opening_balance ?? 0,
        as_of: a.opening_balance_date ?? wibDateString(),
      })),
    });
    showToast('Saldo disinkronkan dari data Kas & Bank', 'success');
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[14px] font-bold text-[var(--color-caleo-primary)] mb-1">Kas & Bank — Saldo Awal</h3>
        <p className="text-[12px] text-slate-500">
          Masukkan saldo awal setiap akun per tanggal cutover. Angka ini akan masuk ke Jurnal Saldo Awal sebagai sisi Debit.
        </p>
      </div>

      {showCrossCheck && (
        <div className="border border-amber-200 bg-amber-50 rounded px-4 py-3 text-[12px] text-amber-800 space-y-1">
          <div className="font-semibold">Perhatian: Saldo wizard berbeda dari data Kas & Bank saat ini</div>
          <div>Total wizard: <strong>{formatIDR(wizardTotal)}</strong> · Total saat ini: <strong>{formatIDR(dbTotal)}</strong></div>
          <button
            type="button"
            onClick={syncFromDB}
            className="mt-1 text-amber-700 font-semibold underline text-[12px] hover:text-amber-900"
          >
            Sinkronkan dari Kas & Bank
          </button>
        </div>
      )}

      <div className="border border-slate-200 rounded overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left">
              <th className="px-4 py-2.5 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider">Akun</th>
              <th className="px-4 py-2.5 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider text-right">Saldo Awal</th>
              <th className="px-4 py-2.5 text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider">Tanggal Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stepAccounts.map((acc) => {
              const master = accounts.find((a) => a.id === acc.cash_account_id);
              return (
                <tr key={acc.cash_account_id} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{acc.cash_account_name}</div>
                    {master && (
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {master.account_type === 'BANK' ? `${master.bank_code ?? ''} · ${master.account_number ?? ''}` : master.account_type}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right w-44">
                    <NumberInput
                      value={acc.opening_balance}
                      onChange={(n) => updateAccount(acc.cash_account_id, { opening_balance: n })}
                      allowDecimal={false}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-right text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-4 py-3 w-40">
                    <input
                      type="date"
                      value={acc.as_of}
                      onChange={(e) => updateAccount(acc.cash_account_id, { as_of: e.target.value })}
                      className="w-full border border-slate-200 rounded px-3 py-1.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 border-t border-slate-200">
              <td className="px-4 py-2.5 text-[12px] font-bold text-slate-600">Total Kas & Bank</td>
              <td className="px-4 py-2.5 text-right font-bold text-[13px] text-emerald-700">
                {formatIDR(wizardTotal)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
