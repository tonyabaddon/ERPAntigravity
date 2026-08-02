/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Lock, X, Receipt, CheckCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { closeAccountingPeriod } from '../../../lib/akuntansi/periodClose';
import { accruePeriodTaxes, fetchAccountingConfig } from '../../../lib/akuntansi/service';
import { fetchTrialBalanceAsOf } from '../../../lib/akuntansi/glQueries';
import type { AccountingPeriod, AccountingConfig } from '../../../lib/akuntansi/types';
import { formatRp } from '../../../lib/format';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function periodMonthLabel(p: AccountingPeriod): string {
  return `${MONTH_NAMES_ID[p.period_month - 1]} ${p.period_year}`;
}

/** Returns last day of a given year/month. */
function lastDayOfMonth(year: number, month: number): string {
  // new Date(year, month, 0) → day 0 of next month = last day of current month
  const d = new Date(year, month, 0);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function periodStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

// ─── Snapshot data ────────────────────────────────────────────────────────────

interface SnapshotData {
  totalEntries: number;
  isBalanced: boolean;
  omzet: number;
}

async function fetchSnapshot(year: number, month: number): Promise<SnapshotData> {
  const sb = supabase;
  if (!sb) throw new Error('Supabase not configured');

  const start = periodStart(year, month);
  const end = lastDayOfMonth(year, month);

  // Count journal entries in period
  const { count, error: countError } = await sb
    .from('journal_entries')
    .select('*', { count: 'exact', head: true })
    .gte('entry_date', start)
    .lte('entry_date', end);
  if (countError) throw new Error(countError.message);

  // Trial balance check: scoped to entries up to period end date.
  // By double-entry invariant this is mathematically always balanced; the check is a
  // sanity guard — the real enforcement is inside the close_accounting_period RPC.
  const tbRows = await fetchTrialBalanceAsOf(end);
  const totalDebit = tbRows.reduce((s, r) => s + r.total_debit, 0);
  const totalCredit = tbRows.reduce((s, r) => s + r.total_credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  // Omzet: sum credit of PENDAPATAN accounts in the period
  // Use journal_entry_lines → chart_of_accounts join (account_id is UUID FK to coa.id)
  const { data: omzetData, error: omzetError } = await sb
    .from('journal_entry_lines')
    .select(
      `
      amount,
      journal_entries!entry_id(entry_date),
      chart_of_accounts!account_id(account_type)
      `,
    )
    .eq('side', 'CREDIT');
  if (omzetError) throw new Error(omzetError.message);

  // Filter in-memory for period range and PENDAPATAN type
  type OmzetRow = {
    amount: number;
    journal_entries: Array<{ entry_date: string }> | { entry_date: string } | null;
    chart_of_accounts: Array<{ account_type: string }> | { account_type: string } | null;
  };
  const omzetRows = (omzetData ?? []) as OmzetRow[];
  const omzet = omzetRows.reduce((sum, row) => {
    const je = Array.isArray(row.journal_entries)
      ? row.journal_entries[0]
      : row.journal_entries;
    const coa = Array.isArray(row.chart_of_accounts)
      ? row.chart_of_accounts[0]
      : row.chart_of_accounts;
    if (!je || !coa) return sum;
    if (coa.account_type !== 'PENDAPATAN') return sum;
    if (je.entry_date < start || je.entry_date > end) return sum;
    return sum + Number(row.amount);
  }, 0);

  return {
    totalEntries: count ?? 0,
    isBalanced,
    omzet,
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PeriodCloseModalProps {
  open: boolean;
  period: AccountingPeriod;
  onClose: () => void;
  onClosed: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PeriodCloseModal({
  open,
  period,
  onClose,
  onClosed,
  showToast,
}: PeriodCloseModalProps): React.ReactElement | null {
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [config, setConfig] = useState<AccountingConfig | null>(null);
  const [loadingSnap, setLoadingSnap] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);

  // Load snapshot + config on open
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoadingSnap(true);
    setSnapError(null);
    setSnapshot(null);

    Promise.all([
      fetchSnapshot(period.period_year, period.period_month),
      fetchAccountingConfig(),
    ])
      .then(([snap, cfg]) => {
        if (!cancelled) {
          setSnapshot(snap);
          setConfig(cfg);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setSnapError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSnap(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, period.id, period.period_year, period.period_month]);

  if (!open) return null;

  const monthLabel = periodMonthLabel(period);
  const showTaxAccrual = config?.pph_mode === 'UMKM_FINAL_0_5';
  const pphRate = config?.pph_rate_pct ?? 0.5;
  const taxAmount = snapshot ? snapshot.omzet * (pphRate / 100) : 0;

  // ─── Submit ──────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!snapshot) return;

    // Validate trial balance is balanced
    if (!snapshot.isBalanced) {
      showToast('Trial Balance tidak seimbang — perbaiki dulu sebelum Tutup Buku', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Accrue taxes (if applicable) — call even if not UMKM_FINAL_0_5,
      //    RPC will skip internally based on config.auto_accrue_pph_monthly flag
      if (showTaxAccrual) {
        await accruePeriodTaxes(period.period_year, period.period_month);
      }

      // 2. Close the period
      await closeAccountingPeriod(period.period_year, period.period_month);

      showToast(`✓ Periode ${monthLabel} berhasil ditutup`, 'success');
      onClosed();
      onClose();
    } catch (err) {
      const msg = extractErrorMessage(err);
      if (msg.toLowerCase().includes('owner_only')) {
        showToast('Hanya Owner yang bisa menutup periode', 'warning');
      } else if (msg.toLowerCase().includes('period_not_open')) {
        showToast('Periode ini sudah ditutup atau tidak ditemukan', 'warning');
      } else if (msg.toLowerCase().includes('trial_balance_imbalanced')) {
        showToast('Trial Balance tidak seimbang — tidak bisa tutup buku', 'warning');
      } else {
        showToast(`Gagal tutup buku: ${msg}`, 'warning');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-xl rounded-sm overflow-hidden shadow-2xl bg-white"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="px-6 py-5 border-b"
          style={{ background: '#fef2f2', borderColor: '#fecaca' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div
                className="w-10 h-10 rounded-sm flex items-center justify-center shrink-0"
                style={{ background: '#fee2e2' }}
              >
                <Lock className="w-5 h-5 text-rose-700" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1a1a1a]">
                  Tutup Buku {monthLabel} — Konfirmasi
                </h3>
                <p className="text-xs font-medium text-rose-700 mt-0.5">
                  Setelah close, entry baru ke {monthLabel} akan REJECTED
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="px-6 py-5 space-y-4">
          {/* Snapshot sub-card */}
          <div className="rounded-sm border border-[#c7d7f5] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#c7d7f5]" style={{ background: '#eff4ff' }}>
              <span className="text-[11px] font-bold text-[var(--color-caleo-primary)] uppercase tracking-wide">
                Snapshot Periode
              </span>
            </div>

            {loadingSnap ? (
              <div className="py-8 text-center text-[13px] text-gray-500">Memuat data...</div>
            ) : snapError ? (
              <div className="py-8 text-center text-[12px] text-rose-600 px-4">
                Gagal memuat snapshot: {snapError}
              </div>
            ) : snapshot ? (
              <div className="divide-y divide-gray-100">
                {/* Total entries */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-[12px] text-gray-600">Total entries</span>
                  <span className="text-[13px] font-bold text-[#1a1a1a]">
                    {snapshot.totalEntries.toLocaleString('id-ID')}
                  </span>
                </div>

                {/* Trial Balance */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-[12px] text-gray-600">Trial Balance</span>
                  <span
                    className={`inline-flex items-center gap-1.5 text-[12px] font-bold ${
                      snapshot.isBalanced ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {snapshot.isBalanced ? (
                      <>
                        <CheckCircle className="w-3.5 h-3.5" />
                        Seimbang
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Tidak Seimbang
                      </>
                    )}
                  </span>
                </div>

                {/* Omzet */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-[12px] text-gray-600">Omzet {monthLabel}</span>
                  <span className="text-[13px] font-bold text-[#1a1a1a]">
                    {formatRp(snapshot.omzet)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Tax Accrual sub-card — only shown if pph_mode = UMKM_FINAL_0_5 */}
          {!loadingSnap && showTaxAccrual && snapshot && (
            <div
              className="rounded-sm border overflow-hidden"
              style={{ background: '#fef3c7', borderColor: '#fbbf24' }}
            >
              <div
                className="px-4 py-2.5 border-b flex items-center gap-2"
                style={{ borderColor: '#fbbf24' }}
              >
                <Receipt className="w-4 h-4 text-amber-700" />
                <span className="text-[11px] font-bold text-amber-900 uppercase tracking-wide">
                  Tax Accrual Otomatis (akan posted bareng close)
                </span>
              </div>

              <div className="px-4 py-3 space-y-2">
                {/* Formula row */}
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-amber-900">
                    Omzet {monthLabel} × PPh Final {pphRate}%
                  </span>
                  <span className="text-[13px] font-bold text-amber-900">
                    {formatRp(taxAmount)}
                  </span>
                </div>

                {/* Journal preview */}
                <div
                  className="rounded-sm px-3 py-2 text-[11px] font-mono text-amber-800 leading-relaxed"
                  style={{ background: 'rgba(255,255,255,0.7)' }}
                >
                  <div>D 5-3300 Beban Pajak&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{formatRp(taxAmount)}</div>
                  <div>K 2-1210 Hutang PPh Final&nbsp;{formatRp(taxAmount)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Warning if imbalanced */}
          {!loadingSnap && snapshot && !snapshot.isBalanced && (
            <div className="rounded-sm border border-rose-300 bg-rose-50 px-4 py-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-rose-700">
                Trial Balance tidak seimbang. Perbaiki semua entry sebelum menutup periode.
              </p>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="px-6 py-4 border-t flex items-center justify-end gap-3"
          style={{ borderColor: '#e5e7eb' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-sm text-[13px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              submitting ||
              loadingSnap ||
              !snapshot ||
              !snapshot.isBalanced
            }
            className="px-5 py-2 rounded-sm text-[13px] font-bold text-white transition-colors disabled:opacity-50 inline-flex items-center gap-2"
            style={{ background: '#dc2626' }}
          >
            <Lock className="w-3.5 h-3.5" />
            {submitting
              ? 'Memproses...'
              : showTaxAccrual
              ? 'Tutup Buku + Generate Tax'
              : 'Tutup Buku'}
          </button>
        </div>
      </div>
    </div>
  );
}
