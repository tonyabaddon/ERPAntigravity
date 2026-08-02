// SaldoAwalWizard.tsx
// 4-step wizard shell for Saldo Awal onboarding.
// Step 1: Kas & Bank | Step 2: Aktiva | Step 3: Kewajiban | Step 4: Ekuitas + Preview + Submit
//
// Wizard owns:
//  - cutover_date (date picker, default = today - 1)
//  - all step data state
//  - auto-save draft on step transition (via saveSaldoAwalDraft)
//  - debounced live preview panel (via previewSaldoAwalTotals)
//  - snapshot_id (returned from saveSaldoAwalDraft, passed to Step4 for post)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SaldoAwalSnapshot, SaldoAwalStepData, PreviewTotals } from '../../../lib/saldoAwal/types';
import { EMPTY_STEP_DATA } from '../../../lib/saldoAwal/types';
import { saveSaldoAwalDraft, previewSaldoAwalTotals } from '../../../lib/saldoAwal/api';
import { formatIDR } from '../../../lib/formatIDR';
import Step1KasBank from './Step1KasBank';
import Step2Aktiva from './Step2Aktiva';
import Step3Kewajiban from './Step3Kewajiban';
import Step4EkuitasPreview from './Step4EkuitasPreview';
import { wibDateString } from '../../../lib/format';
import { extractErrorMessage } from '../../../lib/extractErrorMessage';

interface Props {
  initialSnapshot: SaldoAwalSnapshot | null;
  storeName: string;
  onDone: () => void;
  onCancel: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type WizardStep = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Kas & Bank',
  2: 'Aktiva',
  3: 'Kewajiban',
  4: 'Ekuitas',
};

// Default cutover = yesterday
function defaultCutoverDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return wibDateString(d);
}

export default function SaldoAwalWizard({ initialSnapshot, storeName, onDone, onCancel, showToast }: Props) {
  const [step, setStep] = useState<WizardStep>(1);
  const [cutoverDate, setCutoverDate] = useState<string>(
    initialSnapshot?.cutover_date ?? defaultCutoverDate(),
  );

  // Merge initial snapshot step_data with EMPTY_STEP_DATA as base (defensive against schema drift)
  const [stepData, setStepData] = useState<SaldoAwalStepData>(() => {
    if (!initialSnapshot?.step_data) return EMPTY_STEP_DATA;
    return {
      ...EMPTY_STEP_DATA,
      ...initialSnapshot.step_data,
      step2_aktiva: {
        ...EMPTY_STEP_DATA.step2_aktiva,
        ...initialSnapshot.step_data.step2_aktiva,
        persediaan: {
          ...EMPTY_STEP_DATA.step2_aktiva.persediaan,
          ...initialSnapshot.step_data.step2_aktiva?.persediaan,
        },
      },
      step3_kewajiban: {
        ...EMPTY_STEP_DATA.step3_kewajiban,
        ...initialSnapshot.step_data.step3_kewajiban,
      },
      step4_ekuitas: {
        ...EMPTY_STEP_DATA.step4_ekuitas,
        ...initialSnapshot.step_data.step4_ekuitas,
      },
    };
  });

  const [snapshotId, setSnapshotId] = useState<string | null>(initialSnapshot?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewTotals | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced preview update
  const schedulePreview = useCallback((data: SaldoAwalStepData) => {
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const result = await previewSaldoAwalTotals(data);
        setPreview(result);
      } catch {
        // Silent — preview is best-effort
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
  }, []);

  // Update step data + schedule preview
  function updateStepData(patch: Partial<SaldoAwalStepData>) {
    setStepData((prev) => {
      const next = { ...prev, ...patch };
      schedulePreview(next);
      return next;
    });
  }

  // Load preview on mount
  useEffect(() => {
    schedulePreview(stepData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save draft on step transition
  async function saveAndAdvance(targetStep: WizardStep) {
    setSaving(true);
    try {
      const id = await saveSaldoAwalDraft(stepData, cutoverDate);
      setSnapshotId(id);
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      showToast(`Gagal simpan draft: ${msg}`, 'warning');
      setSaving(false);
      return; // don't advance if save fails
    }
    setSaving(false);
    setStep(targetStep);
  }

  function handleNext() {
    if (step < 4) {
      void saveAndAdvance((step + 1) as WizardStep);
    }
  }

  function handleBack() {
    if (step > 1) setStep((step - 1) as WizardStep);
  }

  const isBalanced =
    preview !== null &&
    preview.total_assets > 0 &&
    Math.abs(preview.total_assets - (preview.total_liab + preview.total_equity)) < 1;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded shadow-2xl w-full max-w-3xl mx-auto my-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-[15px] font-extrabold text-[var(--color-caleo-primary)]">Saldo Awal — Onboarding</h2>
            <p className="text-[12px] text-slate-500 mt-0.5">
              Step {step} dari 4 — {STEP_LABELS[step]}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none px-2 py-1 rounded hover:bg-slate-100"
            title="Tutup wizard"
          >
            ×
          </button>
        </div>

        {/* Cutover date */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-4">
          <label className="text-[12px] font-semibold text-slate-600 shrink-0">Tanggal Cutover:</label>
          <input
            type="date"
            value={cutoverDate}
            max={wibDateString()}
            onChange={(e) => setCutoverDate(e.target.value)}
            className="border border-slate-200 rounded px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-caleo-primary)]/30 bg-white"
          />
          <span className="text-[11px] text-slate-500">
            Jurnal Umum Saldo Awal akan diposting per tanggal ini (cutover − 1 hari di backend)
          </span>
        </div>

        {/* Progress dots */}
        <div className="px-6 py-4 flex items-center gap-0 border-b border-slate-100">
          {([1, 2, 3, 4] as WizardStep[]).map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && (
                <div
                  className={`h-0.5 flex-1 ${
                    s <= step ? 'bg-[var(--color-caleo-primary)]' : 'bg-slate-200'
                  }`}
                />
              )}
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 transition-colors ${
                    s === step
                      ? 'bg-[var(--color-caleo-primary)] text-white border-[var(--color-caleo-primary)]'
                      : s < step
                      ? 'bg-emerald-500 text-white border-emerald-500'
                      : 'bg-white text-slate-400 border-slate-300'
                  }`}
                >
                  {s < step ? '✓' : s}
                </div>
                <span
                  className={`text-[10px] font-semibold ${
                    s === step ? 'text-[var(--color-caleo-primary)]' : s < step ? 'text-emerald-600' : 'text-slate-400'
                  }`}
                >
                  {STEP_LABELS[s]}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* Step content */}
        <div className="px-6 py-5 max-h-[52vh] overflow-y-auto">
          {step === 1 && (
            <Step1KasBank
              data={stepData.step1_cash}
              onChange={(d) => updateStepData({ step1_cash: d })}
              showToast={showToast}
            />
          )}
          {step === 2 && (
            <Step2Aktiva
              data={stepData.step2_aktiva}
              onChange={(d) => updateStepData({ step2_aktiva: d })}
              showToast={showToast}
            />
          )}
          {step === 3 && (
            <Step3Kewajiban
              data={stepData.step3_kewajiban}
              onChange={(d) => updateStepData({ step3_kewajiban: d })}
              showToast={showToast}
            />
          )}
          {step === 4 && (
            <Step4EkuitasPreview
              data={stepData.step4_ekuitas}
              onChange={(d) => updateStepData({ step4_ekuitas: d })}
              stepData={stepData}
              snapshotId={snapshotId}
              cutoverDate={cutoverDate}
              storeName={storeName}
              preview={preview}
              previewLoading={previewLoading}
              showToast={showToast}
              onDone={onDone}
            />
          )}
        </div>

        {/* Live preview panel */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center gap-6 text-[12px]">
            <span className="text-slate-500 font-semibold shrink-0">Preview Neraca:</span>
            {previewLoading ? (
              <span className="text-slate-400">Menghitung…</span>
            ) : preview ? (
              <div className="flex items-center gap-4 flex-wrap">
                <span>
                  <span className="text-emerald-700 font-bold">Aktiva:</span>{' '}
                  <span className="font-medium">{formatIDR(preview.total_assets)}</span>
                </span>
                <span className="text-slate-300">·</span>
                <span>
                  <span className="text-rose-700 font-bold">Kewajiban:</span>{' '}
                  <span className="font-medium">{formatIDR(preview.total_liab)}</span>
                </span>
                <span className="text-slate-300">·</span>
                <span>
                  <span className="text-slate-600 font-bold">Ekuitas:</span>{' '}
                  <span className="font-medium">{formatIDR(preview.total_equity)}</span>
                </span>
                <span className="text-slate-300">·</span>
                <span className={`font-bold ${isBalanced ? 'text-emerald-700' : 'text-amber-600'}`}>
                  {isBalanced ? '✓ Balanced' : 'Belum seimbang'}
                </span>
              </div>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </div>
        </div>

        {/* Navigation buttons */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-[13px] font-semibold text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
            >
              Batal
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 1}
              className="px-4 py-2 text-[13px] font-semibold text-slate-700 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Sebelumnya
            </button>
            {step < 4 && (
              <button
                type="button"
                onClick={handleNext}
                disabled={saving}
                className="px-4 py-2 text-[13px] font-bold bg-[var(--color-caleo-primary)] text-white rounded hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? 'Menyimpan draft…' : 'Berikutnya →'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
