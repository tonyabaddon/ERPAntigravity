import { useEffect, useRef, useState } from 'react';
import { verifyOwnerPin } from '../../lib/supabaseClient';

interface OwnerPinPadProps {
  approvalId: number;
  onSuccess: () => void;
  onCancel: () => void;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
  onSendToWA?: () => void;
}

const PIN_LENGTH = 6;

export default function OwnerPinPad({
  approvalId,
  onSuccess,
  onCancel,
  showToast,
  onSendToWA,
}: OwnerPinPadProps) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  // Refs hold the latest onSuccess / showToast so the verify-effect can keep
  // them out of its deps. Previously including them caused the parent's
  // ApprovalInboxScreen — whose `onPinSuccess` is a new function on every
  // render (30s poll, realtime nudges, busyId state changes) — to tear down
  // this effect mid-verify (`cancelled = true`), which silently dropped the
  // success callback. The 2026-06-12 prod e2e walkthrough hit this exactly:
  // verify_owner_pin flipped the gate (counter dropped 1 → 0) but
  // commit_approved_adjustment never fired (stock stayed at 211), leaving the
  // approval half-committed.
  const onSuccessRef = useRef(onSuccess);
  const showToastRef = useRef(showToast);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  // Auto-verify when 6 digits entered. Deps intentionally narrow to (pin,
  // approvalId) so a stable identity for THIS effect run is preserved across
  // parent re-renders. submitting + the two callbacks are read via closure
  // or ref so re-renders cannot trigger the cleanup `cancelled = true`.
  useEffect(() => {
    if (pin.length !== PIN_LENGTH) return;

    let cancelled = false;
    const run = async () => {
      setSubmitting(true);
      setErrorMsg(null);
      try {
        const ok = await verifyOwnerPin(approvalId, pin);
        if (cancelled) return;
        if (ok) {
          showToastRef.current?.('PIN benar — disetujui', 'success');
          setPin('');
          onSuccessRef.current();
        } else {
          showToastRef.current?.('PIN salah', 'error');
          setErrorMsg('PIN salah — coba lagi');
          setShake(true);
          setTimeout(() => {
            if (!cancelled) {
              setPin('');
              setShake(false);
            }
          }, 1400);
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        showToastRef.current?.(msg, 'error');
        setErrorMsg(msg);
        setShake(true);
        setTimeout(() => {
          if (!cancelled) {
            setPin('');
            setShake(false);
          }
        }, 1400);
      } finally {
        if (!cancelled) setSubmitting(false);
      }
    };
    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, approvalId]);

  const press = (digit: string) => {
    if (submitting) return;
    setErrorMsg(null);
    setPin((prev) => (prev.length >= PIN_LENGTH ? prev : prev + digit));
  };

  const backspace = () => {
    if (submitting) return;
    setErrorMsg(null);
    setPin((prev) => prev.slice(0, -1));
  };

  const keys: Array<{ label: string; onClick: () => void; ariaLabel?: string } | null> = [
    { label: '1', onClick: () => press('1') },
    { label: '2', onClick: () => press('2') },
    { label: '3', onClick: () => press('3') },
    { label: '4', onClick: () => press('4') },
    { label: '5', onClick: () => press('5') },
    { label: '6', onClick: () => press('6') },
    { label: '7', onClick: () => press('7') },
    { label: '8', onClick: () => press('8') },
    { label: '9', onClick: () => press('9') },
    null,
    { label: '0', onClick: () => press('0') },
    { label: '⌫', onClick: backspace, ariaLabel: 'Hapus digit' },
  ];

  return (
    <div className="rounded-3xl border border-[#e5eeff] bg-white shadow-lg p-6">
      <div className="text-center mb-4">
        <span className="inline-block rounded-full bg-[#e5eeff] text-[#012749] text-[10px] font-extrabold uppercase tracking-wider px-3 py-1">
          Approval Sync
        </span>
        <h3 className="mt-2 text-lg font-extrabold text-[#012749]">Owner ketik PIN</h3>
        <p className="text-xs text-slate-500">
          Demo PIN: <code className="font-mono">123456</code>
        </p>
      </div>

      <div
        className={`flex justify-center gap-2 my-4 ${shake ? 'animate-pulse' : ''}`}
        aria-label="PIN dots"
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            className={`w-3.5 h-3.5 rounded-full transition-colors ${
              i < pin.length ? 'bg-[#012749]' : 'bg-slate-300'
            }`}
          />
        ))}
      </div>

      {errorMsg && (
        <p className="text-center text-xs font-bold text-rose-600 mb-3">{errorMsg}</p>
      )}

      <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
        {keys.map((k, idx) =>
          k ? (
            <button
              key={idx}
              type="button"
              onClick={k.onClick}
              disabled={submitting}
              aria-label={k.ariaLabel ?? `Tekan ${k.label}`}
              className="aspect-square rounded-2xl border border-[#e5eeff] bg-white hover:bg-blue-50 active:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <span className="text-2xl font-extrabold text-[#012749]">{k.label}</span>
            </button>
          ) : (
            <div key={idx} aria-hidden="true" />
          ),
        )}
      </div>

      {submitting && (
        <p className="text-center text-xs text-slate-500 mt-3">Memverifikasi…</p>
      )}

      <div className="flex items-center justify-between gap-2 mt-5">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-4 py-2 rounded-full border border-[#e5eeff] text-xs font-extrabold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          Batal
        </button>
        {onSendToWA && (
          <button
            type="button"
            onClick={onSendToWA}
            disabled={submitting}
            className="px-4 py-2 rounded-full bg-[#2d8a4e] text-white text-xs font-extrabold hover:bg-emerald-700 disabled:opacity-50"
          >
            Kirim ke WA Owner
          </button>
        )}
      </div>
    </div>
  );
}
