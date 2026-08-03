// SaldoAwalPanel.tsx
// Entry panel for Saldo Awal under Pengaturan → Akuntansi tab.
// States: null/reversed (empty → Buat), draft (Lanjutkan), posted (display + Reverse & Edit).

import React, { useEffect, useState } from 'react';
import type { SaldoAwalSnapshot } from '../../lib/saldoAwal/types';
import { getSaldoAwalState, reverseSaldoAwal } from '../../lib/saldoAwal/api';
import { formatIDR } from '../../lib/formatIDR';
import SaldoAwalWizard from './saldoAwal/SaldoAwalWizard';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import LoadingState from '../ui/LoadingState';
import EmptyState from '../ui/EmptyState';

interface Props {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  storeName?: string;
}

export default function SaldoAwalPanel({ showToast, storeName = 'Perusahaan Anda' }: Props) {
  const [snapshot, setSnapshot] = useState<SaldoAwalSnapshot | null | undefined>(undefined); // undefined = loading
  const [wizardOpen, setWizardOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);

  async function loadState() {
    try {
      const s = await getSaldoAwalState();
      setSnapshot(s);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      showToast(`Gagal memuat status Saldo Awal: ${msg}`, 'warning');
      setSnapshot(null);
    }
  }

  useEffect(() => {
    void loadState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleReverse() {
    if (!snapshot || !reverseReason.trim()) {
      showToast('Alasan reversal wajib diisi', 'warning');
      return;
    }
    setReversing(true);
    try {
      await reverseSaldoAwal(snapshot.id, reverseReason.trim());
      showToast('Saldo Awal berhasil di-reverse. Silakan isi ulang via wizard.', 'success');
      setReverseOpen(false);
      setReverseReason('');
      await loadState();
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      showToast(`Gagal reverse: ${msg}`, 'warning');
    } finally {
      setReversing(false);
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (snapshot === undefined) {
    return <LoadingState label="Memuat status Saldo Awal…" />;
  }

  // ── Posted state ──────────────────────────────────────────────────────────
  if (snapshot?.status === 'posted') {
    const sd = snapshot.step_data;
    const kasTotal = sd.step1_cash.accounts.reduce((s, a) => s + a.opening_balance, 0);
    const piutangAmount =
      sd.step2_aktiva.piutang.mode === 'aggregate'
        ? sd.step2_aktiva.piutang.aggregate_amount
        : (sd.step2_aktiva.piutang.lines ?? []).reduce((s, l) => s + l.amount, 0);
    const persediaanAmount = sd.step2_aktiva.persediaan.final_amount;
    const aktivaTetapAmount = sd.step2_aktiva.aktiva_tetap.amount;
    const aktivaLainTotal = sd.step2_aktiva.lain_lain.reduce((s, l) => s + l.amount, 0);
    const totalAktiva = kasTotal + piutangAmount + persediaanAmount + aktivaTetapAmount + aktivaLainTotal;

    const hutangAmount =
      sd.step3_kewajiban.hutang_usaha.mode === 'aggregate'
        ? sd.step3_kewajiban.hutang_usaha.aggregate_amount
        : (sd.step3_kewajiban.hutang_usaha.lines ?? []).reduce((s, l) => s + l.amount, 0);
    const kewajibanLainTotal = sd.step3_kewajiban.lain_lain.reduce((s, l) => s + l.amount, 0);
    const totalKewajiban = hutangAmount + kewajibanLainTotal;
    const modalOwner = sd.step4_ekuitas.modal_owner.amount;
    const prive = sd.step4_ekuitas.prive.amount;

    const cutoverFormatted = new Date(snapshot.cutover_date + 'T00:00:00').toLocaleDateString('id-ID', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
    const postedFormatted = new Date(snapshot.updated_at).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    return (
      <>
        <div className="space-y-4">
          {/* Status header */}
          <div className="bg-emerald-50 border border-emerald-200 rounded p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-caleo-11 px-2 py-0.5 rounded-full bg-emerald-100 text-caleo-success border border-emerald-200 font-bold uppercase tracking-wide">
                  Terpost
                </span>
                <span className="text-caleo-13 font-bold text-caleo-success">
                  Saldo Awal per {cutoverFormatted}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setReverseOpen(true)}
                className="text-xs text-caleo-danger border border-rose-200 bg-white rounded px-3 py-1.5 hover:bg-rose-50 font-semibold"
              >
                Reverse & Edit
              </button>
            </div>
            <div className="text-caleo-11 text-caleo-success">
              Dipost pada {postedFormatted}
              {snapshot.posted_je_id && (
                <span className="ml-2 font-mono">(Jurnal Umum ID: {snapshot.posted_je_id.slice(0, 8)}…)</span>
              )}
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard label="Total Aktiva" value={totalAktiva} color="emerald" />
            <SummaryCard label="Total Kewajiban" value={totalKewajiban} color="rose" />
            <SummaryCard label="Modal Owner (neto)" value={modalOwner - prive} color="slate" />
          </div>

          {/* Detail */}
          <div className="border border-slate-200 rounded overflow-hidden text-xs">
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 font-extrabold text-caleo-10 text-slate-500 uppercase tracking-wider">
              Ringkasan Aktiva
            </div>
            <div className="divide-y divide-slate-100">
              <SummaryRow label="Kas & Bank" value={kasTotal} />
              <SummaryRow label="Piutang Usaha" value={piutangAmount} />
              <SummaryRow label="Persediaan" value={persediaanAmount} />
              <SummaryRow label="Aktiva Tetap" value={aktivaTetapAmount} />
              {aktivaLainTotal > 0 && <SummaryRow label="Aktiva Lain-lain" value={aktivaLainTotal} />}
            </div>
          </div>
        </div>

        {/* Reversal confirmation modal */}
        {reverseOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setReverseOpen(false); }}
          >
            <div className="bg-white rounded shadow-2xl w-full max-w-md">
              <div className="px-4 py-4 border-b border-slate-200">
                <h3 className="text-sm font-bold text-caleo-danger">Reverse Saldo Awal?</h3>
                <p className="text-xs text-slate-600 mt-1">
                  Ini akan membuat Jurnal Reversal dan mereset status ke draft. Setelah ini kamu bisa isi ulang via wizard.
                </p>
              </div>
              <div className="px-4 py-4 space-y-3">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">Alasan reversal *</span>
                  <textarea
                    value={reverseReason}
                    onChange={(e) => setReverseReason(e.target.value)}
                    rows={3}
                    placeholder="Misal: Angka modal awal salah, perlu koreksi piutang"
                    className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-caleo-13 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
                  />
                </label>
              </div>
              <div className="px-4 py-4 border-t border-slate-200 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setReverseOpen(false); setReverseReason(''); }}
                  disabled={reversing}
                  className="px-4 py-2 text-caleo-13 font-semibold text-slate-600 bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleReverse}
                  disabled={reversing || reverseReason.trim().length < 3}
                  className="px-4 py-2 text-caleo-13 font-semibold text-white bg-rose-600 rounded hover:bg-rose-700 disabled:opacity-50"
                >
                  {reversing ? 'Memproses…' : 'Reverse & Reset'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Draft state ────────────────────────────────────────────────────────────
  if (snapshot?.status === 'draft') {
    const cutoverFormatted = new Date(snapshot.cutover_date + 'T00:00:00').toLocaleDateString('id-ID', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
    const updatedFormatted = new Date(snapshot.updated_at).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return (
      <>
        <div className="border border-amber-200 bg-amber-50 rounded p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-caleo-11 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-bold uppercase tracking-wide">
              Draft
            </span>
            <span className="text-caleo-13 font-semibold text-amber-800">
              Cutover: {cutoverFormatted}
            </span>
          </div>
          <p className="text-xs text-amber-800">
            Draft tersimpan pada {updatedFormatted}. Klik "Lanjutkan" untuk melanjutkan pengisian wizard.
          </p>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="px-4 py-2 bg-[var(--color-caleo-primary)] text-white text-caleo-13 font-bold rounded hover:opacity-90"
          >
            Lanjutkan Wizard
          </button>
        </div>

        {wizardOpen && (
          <SaldoAwalWizard
            initialSnapshot={snapshot}
            storeName={storeName}
            onDone={async () => { setWizardOpen(false); await loadState(); }}
            onCancel={async () => { setWizardOpen(false); await loadState(); }}
            showToast={showToast}
          />
        )}
      </>
    );
  }

  // ── Empty / reversed state ─────────────────────────────────────────────────
  return (
    <>
      <EmptyState
        message="Belum ada Saldo Awal."
        hint="Masukkan data neraca per tanggal cutover agar laporan Neraca, Laba Rugi, dan Piutang Aging mencerminkan kondisi sebenarnya."
        action={{ label: 'Buat Saldo Awal', onClick: () => setWizardOpen(true) }}
      />

      {wizardOpen && (
        <SaldoAwalWizard
          initialSnapshot={null}
          storeName={storeName}
          onDone={async () => { setWizardOpen(false); await loadState(); }}
          onCancel={async () => { setWizardOpen(false); await loadState(); }}
          showToast={showToast}
        />
      )}
    </>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: 'emerald' | 'rose' | 'slate' }) {
  const colorClass =
    color === 'emerald'
      ? 'bg-emerald-50 border-emerald-200 text-caleo-success'
      : color === 'rose'
      ? 'bg-rose-50 border-rose-200 text-caleo-danger'
      : 'bg-slate-50 border-slate-200 text-slate-700';
  return (
    <div className={`border rounded p-3 ${colorClass}`}>
      <div className="text-caleo-11 font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-sm font-bold mt-1">{formatIDR(value)}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-4 py-2 flex items-center justify-between text-xs">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium text-slate-800">{formatIDR(value)}</span>
    </div>
  );
}
