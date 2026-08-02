// Step4EkuitasPreview.tsx
// Wizard Step 4 — Ekuitas + Full Neraca Preview + Confirm + Submit
// Sections: Modal Owner, Prive, Laba Ditahan (auto-calculated),
// full Neraca preview table, balance check, 2 checkboxes, submit button.

import React, { useState } from 'react';
import type { Step4Ekuitas, PreviewTotals, SaldoAwalStepData, SaldoAwalSnapshot } from '../../../lib/saldoAwal/types';
import { postSaldoAwalSnapshot } from '../../../lib/saldoAwal/api';
import { NumberInput } from '../../ui/NumberInput';
import { formatIDR } from '../../../lib/formatIDR';
import { captureError } from '../../../lib/captureError';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';

interface Props {
  data: Step4Ekuitas;
  onChange: (data: Step4Ekuitas) => void;
  stepData: SaldoAwalStepData;
  snapshotId: string | null;
  cutoverDate: string;
  storeName: string;
  preview: PreviewTotals | null;
  previewLoading: boolean;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  onDone: () => void;
}

export default function Step4EkuitasPreview({
  data,
  onChange,
  stepData,
  snapshotId,
  cutoverDate,
  storeName,
  preview,
  previewLoading,
  showToast,
  onDone,
}: Props) {
  const [check1, setCheck1] = useState(false);
  const [check2, setCheck2] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [printing, setPrinting] = useState(false);

  async function handlePrint() {
    if (!snapshotId || !preview) {
      showToast('Data belum lengkap untuk cetak. Isi wizard sampai preview muncul.', 'warning');
      return;
    }
    setPrinting(true);
    try {
      const snap: SaldoAwalSnapshot = {
        id: snapshotId,
        cutover_date: cutoverDate,
        status: 'draft',
        posted_je_id: null,
        step_data: stepData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { renderSaldoAwalPDF } = await import('./SaldoAwalPDF');
      await renderSaldoAwalPDF(snap, storeName);
      showToast('PDF Ringkasan Saldo Awal berhasil diunduh.', 'success');
    } catch (err) {
      captureError(err, { feature: 'saldo_awal', action: 'generate_pdf' });
      showToast(`Gagal mencetak PDF: ${extractErrorMessage(err)}`, 'warning');
    } finally {
      setPrinting(false);
    }
  }

  const labaDitahan = preview?.laba_ditahan_balancing ?? null;
  const isBalanced =
    preview !== null &&
    preview.total_assets > 0 &&
    Math.abs(preview.total_assets - (preview.total_liab + preview.total_equity)) < 1;

  const canSubmit = check1 && check2 && isBalanced && snapshotId !== null && !submitting;

  const priveIsLarge = data.prive.amount > data.modal_owner.amount;

  async function handleSubmit() {
    if (!snapshotId) {
      showToast('Draft belum tersimpan. Coba kembali ke Step 1 lalu lanjut lagi.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      await postSaldoAwalSnapshot(snapshotId);
      showToast('Saldo Awal berhasil dipost ke Jurnal Umum!', 'success');
      onDone();
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      showToast(`Gagal post Saldo Awal: ${msg}`, 'warning');
    } finally {
      setSubmitting(false);
    }
  }

  // Build neraca preview rows from stepData
  const kasTotal = stepData.step1_cash.accounts.reduce((s, a) => s + a.opening_balance, 0);
  const piutangAmount =
    stepData.step2_aktiva.piutang.mode === 'aggregate'
      ? stepData.step2_aktiva.piutang.aggregate_amount
      : (stepData.step2_aktiva.piutang.lines ?? []).reduce((s, l) => s + l.amount, 0);
  const persediaanAmount = stepData.step2_aktiva.persediaan.final_amount;
  const aktivaTetapAmount = stepData.step2_aktiva.aktiva_tetap.amount;
  const aktivaLainTotal = stepData.step2_aktiva.lain_lain.reduce((s, l) => s + l.amount, 0);

  const hutangAmount =
    stepData.step3_kewajiban.hutang_usaha.mode === 'aggregate'
      ? stepData.step3_kewajiban.hutang_usaha.aggregate_amount
      : (stepData.step3_kewajiban.hutang_usaha.lines ?? []).reduce((s, l) => s + l.amount, 0);
  const kewajibanLainTotal = stepData.step3_kewajiban.lain_lain.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="space-y-6">
      {/* ── Ekuitas inputs ────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h4 className="text-[13px] font-bold text-slate-800">Ekuitas</h4>
          <p className="text-[12px] text-slate-500 mt-0.5">Modal awal + Laba Ditahan (dihitung otomatis sebagai angka penyeimbang)</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Modal Owner */}
          <div className="space-y-1.5">
            <label className="block text-[12px] font-semibold text-slate-700">Modal Owner (Rp)</label>
            <p className="text-[11px] text-slate-500">Investasi awal owner ke bisnis</p>
            <NumberInput
              value={data.modal_owner.amount}
              onChange={(n) => onChange({ ...data, modal_owner: { amount: n } })}
              allowDecimal={false}
              className="w-full border border-slate-200 rounded-sm px-3 py-2 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30"
              placeholder="0"
            />
            <div className="text-[11px] text-slate-400">{formatIDR(data.modal_owner.amount)}</div>
          </div>

          {/* Prive */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label className="block text-[12px] font-semibold text-slate-700">Prive (Contra-Equity)</label>
              <span className="text-amber-500 text-[13px]" title="Prive mengurangi ekuitas (contra-equity)">⚠</span>
            </div>
            <p className="text-[11px] text-slate-500">Penarikan owner dari modal. Opsional.</p>
            <NumberInput
              value={data.prive.amount}
              onChange={(n) => onChange({ ...data, prive: { amount: n } })}
              allowDecimal={false}
              className="w-full border border-slate-200 rounded-sm px-3 py-2 text-right text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30"
              placeholder="0"
            />
            <div className="text-[11px] text-slate-400">{formatIDR(data.prive.amount)}</div>
            {priveIsLarge && (
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Prive lebih besar dari Modal Owner — apakah benar?
              </div>
            )}
          </div>
        </div>

        {/* Laba Ditahan (computed) */}
        <div className="border border-slate-200 rounded-sm p-4 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] font-semibold text-slate-700">Laba Ditahan (dihitung otomatis)</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                = Aktiva − Kewajiban − (Modal − Prive)
              </div>
            </div>
            {previewLoading ? (
              <div className="text-[13px] text-slate-400">Menghitung…</div>
            ) : labaDitahan !== null ? (
              <div className={`text-[15px] font-bold ${labaDitahan >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {formatIDR(labaDitahan)}
              </div>
            ) : (
              <div className="text-[13px] text-slate-400">—</div>
            )}
          </div>
        </div>
      </section>

      {/* ── Neraca Preview ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[13px] font-bold text-slate-800">Preview Neraca</h4>
          {previewLoading ? (
            <span className="text-[12px] text-slate-400">Memuat…</span>
          ) : isBalanced ? (
            <span className="text-[12px] font-bold text-emerald-700 flex items-center gap-1">
              ✓ Balanced
            </span>
          ) : (
            <span className="text-[12px] font-bold text-rose-600 flex items-center gap-1">
              ✗ Tidak seimbang
            </span>
          )}
        </div>

        <div className="border border-slate-200 rounded-sm overflow-hidden text-[12px]">
          {/* Aktiva */}
          <div className="bg-emerald-50 px-4 py-2 border-b border-emerald-100">
            <div className="font-extrabold text-[10.5px] text-emerald-700 uppercase tracking-wider">Aktiva</div>
          </div>
          <div className="divide-y divide-slate-100">
            <NeracaRow label="Kas & Bank" amount={kasTotal} />
            <NeracaRow label="Piutang Usaha" amount={piutangAmount} />
            <NeracaRow label="Persediaan" amount={persediaanAmount} />
            <NeracaRow label="Aktiva Tetap" amount={aktivaTetapAmount} />
            {stepData.step2_aktiva.lain_lain.map((l, i) => (
              <NeracaRow key={i} label={`${l.coa_code} — ${l.coa_name}`} amount={l.amount} />
            ))}
          </div>
          <div className="bg-emerald-50 px-4 py-2 border-y border-emerald-100 flex items-center justify-between font-bold">
            <span className="text-[11px] text-emerald-800 uppercase tracking-wider">Total Aktiva</span>
            <span className="text-[13px] text-emerald-800">
              {previewLoading ? '…' : formatIDR(preview?.total_assets ?? kasTotal + piutangAmount + persediaanAmount + aktivaTetapAmount + aktivaLainTotal)}
            </span>
          </div>

          {/* Kewajiban */}
          <div className="bg-rose-50 px-4 py-2 border-b border-rose-100">
            <div className="font-extrabold text-[10.5px] text-rose-700 uppercase tracking-wider">Kewajiban</div>
          </div>
          <div className="divide-y divide-slate-100">
            <NeracaRow label="Hutang Usaha" amount={hutangAmount} />
            {stepData.step3_kewajiban.lain_lain.map((l, i) => (
              <NeracaRow key={i} label={`${l.coa_code} — ${l.coa_name}`} amount={l.amount} />
            ))}
          </div>
          <div className="bg-rose-50 px-4 py-2 border-y border-rose-100 flex items-center justify-between font-bold">
            <span className="text-[11px] text-rose-800 uppercase tracking-wider">Total Kewajiban</span>
            <span className="text-[13px] text-rose-800">
              {previewLoading ? '…' : formatIDR(preview?.total_liab ?? hutangAmount + kewajibanLainTotal)}
            </span>
          </div>

          {/* Ekuitas */}
          <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
            <div className="font-extrabold text-[10.5px] text-slate-600 uppercase tracking-wider">Ekuitas</div>
          </div>
          <div className="divide-y divide-slate-100">
            <NeracaRow label="Modal Owner" amount={data.modal_owner.amount} />
            {data.prive.amount > 0 && (
              <NeracaRow label="Prive (−)" amount={-data.prive.amount} />
            )}
            <NeracaRow
              label="Laba Ditahan"
              amount={labaDitahan ?? 0}
              loading={previewLoading}
            />
          </div>
          <div className="bg-slate-100 px-4 py-2 border-t border-slate-200 flex items-center justify-between font-bold">
            <span className="text-[11px] text-slate-700 uppercase tracking-wider">Total Kewajiban + Ekuitas</span>
            <span className="text-[13px] text-slate-700">
              {previewLoading ? '…' : formatIDR((preview?.total_liab ?? 0) + (preview?.total_equity ?? 0))}
            </span>
          </div>
        </div>
      </section>

      {/* ── Confirmation checkboxes ────────────────────────────────────────────── */}
      <section className="space-y-3 border border-amber-200 bg-amber-50 rounded-sm p-4">
        <div className="text-[12px] font-semibold text-amber-800 mb-2">Konfirmasi sebelum post</div>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={check1}
            onChange={(e) => setCheck1(e.target.checked)}
            className="mt-0.5 shrink-0"
          />
          <span className="text-[12px] text-slate-700">
            Saya sudah memverifikasi semua angka di atas benar sesuai kondisi bisnis per tanggal cutover.
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={check2}
            onChange={(e) => setCheck2(e.target.checked)}
            className="mt-0.5 shrink-0"
          />
          <span className="text-[12px] text-slate-700">
            Saya mengerti bahwa setelah di-post, data masuk ke Jurnal Umum sebagai jurnal Saldo Awal dan tidak bisa diedit langsung (harus melalui Reverse & Edit).
          </span>
        </label>
      </section>

      {/* ── Submit ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-2 flex-wrap">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-6 py-2.5 bg-[var(--color-caleo-primary)] text-white text-[13px] font-bold rounded-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? 'Menyimpan & Post…' : 'Simpan & Post Saldo Awal'}
        </button>
        <button
          type="button"
          onClick={handlePrint}
          disabled={printing || previewLoading || preview === null}
          className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 text-[13px] font-semibold rounded-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {printing ? 'Mencetak…' : '📄 Cetak Ringkasan (PDF)'}
        </button>
        {!isBalanced && !previewLoading && (
          <p className="text-[12px] text-rose-600">Neraca belum seimbang. Periksa angka Aktiva dan Kewajiban + Ekuitas.</p>
        )}
        {(!check1 || !check2) && isBalanced && (
          <p className="text-[12px] text-slate-500">Centang kedua konfirmasi untuk mengaktifkan tombol Submit.</p>
        )}
      </div>
    </div>
  );
}

function NeracaRow({
  label,
  amount,
  loading = false,
}: {
  label: string;
  amount: number;
  loading?: boolean;
}) {
  return (
    <div className="px-4 py-2 flex items-center justify-between">
      <span className="text-slate-600 truncate max-w-[65%]">{label}</span>
      {loading ? (
        <span className="text-slate-400">…</span>
      ) : (
        <span className={`font-medium shrink-0 ${amount < 0 ? 'text-rose-600' : 'text-slate-800'}`}>
          {formatIDR(Math.abs(amount))}
          {amount < 0 && ' (kredit)'}
        </span>
      )}
    </div>
  );
}
