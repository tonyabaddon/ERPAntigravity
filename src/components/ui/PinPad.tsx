import React, { useEffect, useRef, useState } from 'react';

/**
 * Reusable PIN pad — 12-button numeric keypad + dot indicators.
 *
 * Consumers pass `onPinComplete(pin)` — called when user enters `pinLength`
 * digits. Callback returns Promise; PinPad auto-clears on success (via
 * resetOnSuccess=true default) and shake-error-clears on failure. Error
 * message is displayed inline if callback throws or returns { ok: false }.
 *
 * Used by:
 * - OwnerPinPad (approval flow: adjustment/opname/price_change/initial_stock)
 *   → verify_owner_pin + commit RPC
 * - ApprovalInboxScreen (customer_credit_activate) → approve_customer_credit_activate
 * - BalanceAdjustmentModal (kas & bank balance) → inline PIN capture (no auto-submit)
 *
 * Design tokens: Caleo navy #012749, blue-tinted borders, active-state blue-50.
 * Consistent across all persetujuan per founder 2026-07-24 flag.
 */
interface PinPadProps {
  /**
   * Auto-submit mode: called when user enters full pinLength digits.
   * Return { ok: false, error?: string } to show inline error + shake reset.
   * Return { ok: true } or void to auto-clear (success).
   * Throw to show inline error message.
   *
   * Mutually exclusive with onPinChange — use onPinComplete for modals that
   * submit-on-6-digits, onPinChange for embedded PIN in a bigger form.
   */
  onPinComplete?: (pin: string) => Promise<{ ok: boolean; error?: string } | void>;
  /**
   * Capture mode: called on every PIN digit change (add or backspace).
   * Parent controls when to submit (e.g. via a separate Submit button).
   * If both onPinChange and onPinComplete provided, onPinChange wins (no auto-submit).
   */
  onPinChange?: (pin: string) => void;
  /** External error message to display (used with onPinChange when parent submit fails). */
  externalError?: string | null;
  onCancel?: () => void;
  pinLength?: number;
  /** Section title above the dots. Default "Owner ketik PIN". */
  title?: string;
  /** Small subtitle text under title. Default null. */
  subtitle?: string;
  /** Show "Demo PIN: 123456" hint. Default false. */
  showDemoHint?: boolean;
  /** Custom trailing button (e.g. "Kirim ke WA Owner"). */
  trailingAction?: {
    label: string;
    onClick: () => void;
    tone?: 'emerald' | 'navy';
  };
  /** External disabled (e.g. parent modal locked). */
  disabled?: boolean;
  /** Compact size — smaller pad for embedded contexts (e.g. inside a form modal). */
  compact?: boolean;
}

export default function PinPad({
  onPinComplete,
  onPinChange,
  externalError,
  onCancel,
  pinLength = 6,
  title = 'Owner ketik PIN',
  subtitle,
  showDemoHint = false,
  trailingAction,
  disabled = false,
  compact = false,
}: PinPadProps) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  // Refs pin the latest callback so the auto-submit effect stays stable
  // across parent re-renders (mirrors the OwnerPinPad 2026-06-12 fix that
  // prevented mid-verify effect teardown).
  const onCompleteRef = useRef(onPinComplete);
  const onChangeRef = useRef(onPinChange);
  useEffect(() => { onCompleteRef.current = onPinComplete; }, [onPinComplete]);
  useEffect(() => { onChangeRef.current = onPinChange; }, [onPinChange]);

  // Fire onPinChange on every mutation (capture mode).
  useEffect(() => {
    if (onChangeRef.current) onChangeRef.current(pin);
  }, [pin]);

  // Auto-submit when full length entered — capture mode wins if provided.
  useEffect(() => {
    if (onChangeRef.current) return;    // capture mode: parent controls submit
    if (!onCompleteRef.current) return; // no submit callback wired
    if (pin.length !== pinLength) return;

    let cancelled = false;
    const run = async () => {
      setSubmitting(true);
      setErrorMsg(null);
      try {
        const cb = onCompleteRef.current;
        if (!cb) return;
        const result = await cb(pin);
        if (cancelled) return;
        // Success (no result, or { ok: true }): clear silently.
        if (!result || result.ok) {
          setPin('');
        } else {
          const msg = result.error ?? 'PIN salah — coba lagi';
          setErrorMsg(msg);
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
        // Extract message from Supabase PostgrestError or Error instance.
        let msg: string;
        if (e instanceof Error) {
          msg = e.message;
        } else if (
          e !== null &&
          typeof e === 'object' &&
          'message' in e &&
          typeof (e as { message: unknown }).message === 'string'
        ) {
          msg = (e as { message: string }).message;
        } else {
          msg = String(e);
        }
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

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, pinLength]);

  const busy = submitting || disabled;

  const press = (digit: string) => {
    if (busy) return;
    setErrorMsg(null);
    setPin((prev) => (prev.length >= pinLength ? prev : prev + digit));
  };

  const backspace = () => {
    if (busy) return;
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

  const containerCls = compact
    ? 'rounded border border-[var(--color-caleo-mist)] bg-white p-4'
    : 'rounded border border-[var(--color-caleo-mist)] bg-white shadow-lg p-6';

  const dotSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const buttonCls = compact ? 'text-xl' : 'text-2xl';
  const gridMaxW = compact ? 'max-w-[240px]' : 'max-w-xs';

  return (
    <div className={containerCls}>
      {(title || subtitle || showDemoHint) && (
        <div className="text-center mb-4">
          <span className="inline-block rounded-full bg-[var(--color-caleo-mist)] text-[var(--color-caleo-primary)] text-[10px] font-extrabold uppercase tracking-wider px-3 py-1">
            Approval Sync
          </span>
          {title && (
            <h3 className={`mt-2 font-extrabold text-[var(--color-caleo-primary)] ${compact ? 'text-base' : 'text-lg'}`}>
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
          )}
          {showDemoHint && (
            <p className="text-xs text-slate-500">
              Demo PIN: <code className="font-mono">123456</code>
            </p>
          )}
        </div>
      )}

      <div
        className={`flex justify-center gap-2 my-4 ${shake ? 'animate-pulse' : ''}`}
        aria-label="PIN dots"
      >
        {Array.from({ length: pinLength }).map((_, i) => (
          <span
            key={i}
            className={`${dotSize} rounded-full transition-colors ${
              i < pin.length ? 'bg-[var(--color-caleo-primary)]' : 'bg-slate-300'
            }`}
          />
        ))}
      </div>

      {(errorMsg || externalError) && (
        <p className="text-center text-xs font-bold text-rose-600 mb-3">{errorMsg ?? externalError}</p>
      )}

      <div className={`grid grid-cols-3 gap-3 ${gridMaxW} mx-auto`}>
        {keys.map((k, idx) =>
          k ? (
            <button
              key={idx}
              type="button"
              onClick={k.onClick}
              disabled={busy}
              aria-label={k.ariaLabel ?? `Tekan ${k.label}`}
              className="aspect-square rounded border border-[var(--color-caleo-mist)] bg-white hover:bg-blue-50 active:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <span className={`font-extrabold text-[var(--color-caleo-primary)] ${buttonCls}`}>{k.label}</span>
            </button>
          ) : (
            <div key={idx} aria-hidden="true" />
          ),
        )}
      </div>

      {submitting && (
        <p className="text-center text-xs text-slate-500 mt-3">Memverifikasi…</p>
      )}

      {(onCancel || trailingAction) && (
        <div className="flex items-center justify-between gap-2 mt-5">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-2 rounded-full border border-[var(--color-caleo-mist)] text-xs font-extrabold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Batal
            </button>
          ) : <span />}
          {trailingAction && (
            <button
              type="button"
              onClick={trailingAction.onClick}
              disabled={busy}
              className={`px-4 py-2 rounded-full text-white text-xs font-extrabold disabled:opacity-50 ${
                trailingAction.tone === 'emerald' || !trailingAction.tone
                  ? 'bg-[#2d8a4e] hover:bg-emerald-700'
                  : 'bg-[var(--color-caleo-primary)] hover:opacity-90'
              }`}
            >
              {trailingAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
