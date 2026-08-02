/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { CalendarDays, ChevronRight, ChevronLeft, CheckCircle2, TriangleAlert, BookOpenCheck } from 'lucide-react';
import { setOpeningBalance } from '../../lib/akuntansi/service';
import type { OpeningBalanceLine } from '../../lib/akuntansi/types';
import { NumberInput } from '../ui/NumberInput';

interface Props {
  onDone: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

interface AccountInput {
  account_code: string;
  account_name: string;
  side: 'DEBIT' | 'CREDIT';
  amount: number;
}

// Initial accounts to capture (subset for Phase 0a; expand in Phase 0d UI)
const DEFAULT_ACCOUNTS: AccountInput[] = [
  { account_code: '1-1110', account_name: 'Kas Toko', side: 'DEBIT', amount: 0 },
  { account_code: '1-1210', account_name: 'BCA Operasional', side: 'DEBIT', amount: 0 },
  { account_code: '1-1220', account_name: 'Mandiri Toko', side: 'DEBIT', amount: 0 },
  { account_code: '1-1310', account_name: 'Lalamove Balance', side: 'DEBIT', amount: 0 },
  { account_code: '1-1400', account_name: 'Piutang Usaha', side: 'DEBIT', amount: 0 },
  { account_code: '1-1510', account_name: 'Persediaan Barang Jadi', side: 'DEBIT', amount: 0 },
  { account_code: '1-2100', account_name: 'Peralatan', side: 'DEBIT', amount: 0 },
  { account_code: '2-1100', account_name: 'Hutang Usaha', side: 'CREDIT', amount: 0 },
  { account_code: '2-2100', account_name: 'Hutang Bank Jangka Panjang', side: 'CREDIT', amount: 0 },
  { account_code: '3-1100', account_name: 'Modal Owner', side: 'CREDIT', amount: 0 },
];

const STEP_LABELS = ['Tanggal', 'Input Saldo', 'Balance Check', 'Confirm'];

function fmt(n: number): string {
  return n.toLocaleString('id-ID');
}

export default function OpeningBalanceWizard({ onDone, showToast }: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [balanceDate, setBalanceDate] = useState('2025-05-31');
  const [accounts, setAccounts] = useState<AccountInput[]>(DEFAULT_ACCOUNTS);
  const [submitting, setSubmitting] = useState(false);

  const totalDebit = accounts.filter(a => a.side === 'DEBIT').reduce((s, a) => s + a.amount, 0);
  const totalCredit = accounts.filter(a => a.side === 'CREDIT').reduce((s, a) => s + a.amount, 0);
  // positive = Debit > Credit → need to plug CREDIT side (Laba Ditahan CREDIT)
  const labaDitahanPlug = totalDebit - totalCredit;
  const isBalanced = labaDitahanPlug === 0;

  function updateAmount(i: number, amount: number) {
    setAccounts(acc => acc.map((a, idx) => idx === i ? { ...a, amount } : a));
  }

  async function handleSubmit() {
    if (submitting) return;

    // Build lines with auto-plug for Laba Ditahan
    const lines: OpeningBalanceLine[] = accounts
      .filter(a => a.amount > 0)
      .map(a => ({ account_code: a.account_code, side: a.side, amount: a.amount }));

    if (labaDitahanPlug !== 0) {
      lines.push({
        account_code: '3-1300',
        side: labaDitahanPlug > 0 ? 'CREDIT' : 'DEBIT',
        amount: Math.abs(labaDitahanPlug),
      });
    }

    setSubmitting(true);
    try {
      await setOpeningBalance(balanceDate, lines);
      showToast('Saldo awal berhasil di-set', 'success');
      onDone();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gagal posting';
      showToast(`Gagal: ${msg}`, 'warning');
    } finally {
      setSubmitting(false);
    }
  }

  // Balanced total for display on step 4
  const totalBalanced = Math.max(totalDebit, totalCredit);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-sm bg-[var(--color-caleo-cloud)] flex items-center justify-center text-[var(--color-caleo-primary)]">
          <BookOpenCheck className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: 'var(--color-primary, #1e3d60)' }}>
            Setup Saldo Awal — Wizard
          </h1>
          <p className="text-[12px] text-[#43474e]">
            Mandatory first-time setup sebelum bisa mulai catat transaksi GL.
          </p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-6">
        {STEP_LABELS.map((label, idx) => {
          const n = idx + 1;
          const isActive = step === n;
          const isDone = step > n;
          return (
            <React.Fragment key={n}>
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-bold transition-all ${
                  isActive
                    ? 'bg-[var(--color-caleo-primary)] text-white'
                    : isDone
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-white border border-[var(--color-caleo-mist)] text-[#43474e]'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0 ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : isDone
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {isDone ? '✓' : n}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </div>
              {n < 4 && <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Step 1: Date ── */}
      {step === 1 && (
        <div className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-sm bg-[var(--color-caleo-cloud)] flex items-center justify-center text-[var(--color-caleo-primary)]">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <p className="font-extrabold text-[14px]" style={{ color: 'var(--color-primary, #1e3d60)' }}>
                Tanggal Saldo Awal
              </p>
              <p className="text-[11px] text-[#43474e]">
                Pilih tanggal sebelum data transaksi tertua
              </p>
            </div>
          </div>

          <label className="block font-bold text-[12px] text-[#43474e] mb-1">
            Tanggal saldo awal *
          </label>
          <input
            type="date"
            value={balanceDate}
            onChange={e => setBalanceDate(e.target.value)}
            className="border border-slate-200 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30 w-full max-w-xs"
          />
          <p className="text-[11px] text-[#43474e] mt-2">
            Default: 31 Mei 2025 (sebelum kasir mulai Juni 2025).
            Pakai tanggal sebelum data transaksi tertua di sistem.
          </p>

          <button
            onClick={() => setStep(2)}
            disabled={!balanceDate}
            className="mt-5 rounded-full text-xs font-bold px-3.5 py-2 bg-[var(--color-caleo-primary)] text-white hover:bg-[#01365e] disabled:opacity-50 flex items-center gap-1.5"
          >
            Lanjut <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Step 2: Account Inputs ── */}
      {step === 2 && (
        <div className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded-sm p-6">
          <p className="text-[13px] text-[#43474e] mb-4">
            Input saldo per akun per tanggal <strong>{balanceDate}</strong>.
            Akun yang tidak relevan biarkan 0.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[10px] uppercase font-bold text-[#43474e] border-b border-[var(--color-caleo-mist-dark)]">
                  <th className="text-left py-2 pr-4">Kode</th>
                  <th className="text-left py-2 pr-4">Nama Akun</th>
                  <th className="text-center py-2 pr-4 w-20">Side</th>
                  <th className="text-right py-2 w-40">Saldo (Rp)</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a, i) => (
                  <tr key={a.account_code} className="border-b border-[var(--color-caleo-mist)] hover:bg-white/60 transition-colors">
                    <td className="py-2.5 pr-4 font-mono text-[11px] text-[#43474e]">{a.account_code}</td>
                    <td className="py-2.5 pr-4 font-semibold text-[#1e3d60]">{a.account_name}</td>
                    <td className="py-2.5 pr-4 text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        a.side === 'DEBIT'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}>
                        {a.side}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <NumberInput
                        value={a.amount}
                        onChange={n => updateAmount(i, n)}
                        className="border border-slate-200 rounded-sm px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30 w-36 text-right font-bold"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--color-caleo-mist-dark)]">
                  <td colSpan={3} className="pt-3 text-[11px] font-bold text-[#43474e]">Total Debit</td>
                  <td className="pt-3 text-right font-extrabold text-emerald-700 text-[13px]">
                    Rp {fmt(totalDebit)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={3} className="pb-1 text-[11px] font-bold text-[#43474e]">Total Credit</td>
                  <td className="pb-1 text-right font-extrabold text-rose-700 text-[13px]">
                    Rp {fmt(totalCredit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              onClick={() => setStep(1)}
              className="rounded-full text-xs font-bold px-3.5 py-2 border border-[var(--color-caleo-mist-dark)] bg-white text-[var(--color-caleo-primary)] hover:bg-[var(--color-caleo-cloud)] flex items-center gap-1.5"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Kembali
            </button>
            <button
              onClick={() => setStep(3)}
              className="rounded-full text-xs font-bold px-3.5 py-2 bg-[var(--color-caleo-primary)] text-white hover:bg-[#01365e] flex items-center gap-1.5"
            >
              Balance Check <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Balance Check ── */}
      {step === 3 && (
        <div className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded-sm p-6">
          <p className="font-extrabold text-[14px] mb-4" style={{ color: 'var(--color-primary, #1e3d60)' }}>
            Balance Check
          </p>

          <div className="space-y-3">
            <div className="flex items-center justify-between border border-[var(--color-caleo-mist-dark)] bg-white rounded-sm px-4 py-3">
              <span className="text-[13px] font-semibold text-[#43474e]">Total Debit</span>
              <strong className="text-emerald-700 text-[14px]">Rp {fmt(totalDebit)}</strong>
            </div>
            <div className="flex items-center justify-between border border-[var(--color-caleo-mist-dark)] bg-white rounded-sm px-4 py-3">
              <span className="text-[13px] font-semibold text-[#43474e]">Total Credit</span>
              <strong className="text-rose-700 text-[14px]">Rp {fmt(totalCredit)}</strong>
            </div>
            <div className={`flex items-center justify-between border rounded-sm px-4 py-3 ${
              isBalanced
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50'
            }`}>
              <span className="text-[13px] font-semibold text-[#43474e]">Selisih</span>
              <strong className={isBalanced ? 'text-emerald-700' : 'text-amber-700'}>
                {isBalanced ? '✓ Balance' : `Rp ${fmt(Math.abs(labaDitahanPlug))}`}
              </strong>
            </div>
          </div>

          {!isBalanced && (
            <div className="mt-4 border border-amber-200 bg-amber-50 rounded-sm p-4 flex gap-3">
              <TriangleAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-[12px] text-amber-900">
                <p className="font-bold mb-1">Auto-plug Laba Ditahan</p>
                <p>
                  Saldo tidak balance. Sistem akan auto-plug{' '}
                  <strong>Rp {fmt(Math.abs(labaDitahanPlug))}</strong> ke akun{' '}
                  <strong>3-1300 Laba Ditahan</strong>{' '}
                  (side: {labaDitahanPlug > 0 ? 'CREDIT' : 'DEBIT'}).
                </p>
                <p className="mt-1 text-amber-700">
                  Owner boleh kembali ke Step 2 untuk memperbaiki nilai akun jika ada breakdown akurat.
                </p>
              </div>
            </div>
          )}

          {isBalanced && (
            <div className="mt-4 border border-emerald-200 bg-emerald-50 rounded-sm p-4 flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-[12px] text-emerald-900">
                <p className="font-bold">Saldo Seimbang</p>
                <p>Debit = Credit. Tidak ada plug yang diperlukan.</p>
              </div>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              onClick={() => setStep(2)}
              className="rounded-full text-xs font-bold px-3.5 py-2 border border-[var(--color-caleo-mist-dark)] bg-white text-[var(--color-caleo-primary)] hover:bg-[var(--color-caleo-cloud)] flex items-center gap-1.5"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Kembali
            </button>
            <button
              onClick={() => setStep(4)}
              className="rounded-full text-xs font-bold px-3.5 py-2 bg-[var(--color-caleo-primary)] text-white hover:bg-[#01365e] flex items-center gap-1.5"
            >
              Konfirmasi <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Confirm + Submit ── */}
      {step === 4 && (
        <div className="border border-[var(--color-caleo-mist-dark)] bg-[#fafbff] rounded-sm p-6">
          <p className="font-extrabold text-[14px] mb-4" style={{ color: 'var(--color-primary, #1e3d60)' }}>
            Confirm &amp; Post Opening Balance
          </p>

          <div className="border border-[var(--color-caleo-mist-dark)] bg-white rounded-sm p-4 text-[13px] space-y-1.5 mb-4">
            <div className="flex justify-between">
              <span className="text-[#43474e]">Tanggal saldo awal</span>
              <strong className="text-[var(--color-caleo-primary)]">{balanceDate}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-[#43474e]">Total Debit = Credit</span>
              <strong className="text-[var(--color-caleo-primary)]">Rp {fmt(totalBalanced)}</strong>
            </div>
            {!isBalanced && (
              <div className="flex justify-between pt-1 border-t border-[var(--color-caleo-mist)]">
                <span className="text-amber-700">Auto-plug 3-1300 Laba Ditahan</span>
                <strong className="text-amber-700">
                  Rp {fmt(Math.abs(labaDitahanPlug))} ({labaDitahanPlug > 0 ? 'CREDIT' : 'DEBIT'})
                </strong>
              </div>
            )}
          </div>

          <div className="border border-amber-200 bg-amber-50 rounded-sm p-3 text-[12px] text-amber-900 mb-5">
            <TriangleAlert className="w-4 h-4 inline mr-1.5 text-amber-600" />
            Setelah submit, opening balance tidak bisa di-edit. Salah input gunakan Jurnal Penyesuaian di Phase 2.
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep(3)}
              disabled={submitting}
              className="rounded-full text-xs font-bold px-3.5 py-2 border border-[var(--color-caleo-mist-dark)] bg-white text-[var(--color-caleo-primary)] hover:bg-[var(--color-caleo-cloud)] flex items-center gap-1.5 disabled:opacity-50"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Kembali
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-full text-xs font-bold px-3.5 py-2 bg-rose-600 text-white hover:bg-rose-700 flex items-center gap-1.5 disabled:opacity-50"
            >
              {submitting ? (
                <span>Posting...</span>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Post Opening Balance
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
