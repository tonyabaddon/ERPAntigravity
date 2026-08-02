import React, { useEffect, useState } from 'react';
import { AlertTriangle, X, ArrowRight } from 'lucide-react';
import { getSaldoAwalState } from '../../../lib/saldoAwal/api';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SaldoAwalBannerProps {
  /** Called when user clicks "Set Saldo Awal →"; navigate to settings page. */
  onNavigate: (page: string) => void;
}

const SESSION_KEY = 'saldoAwalBannerDismissed';

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Persistent nudge banner shown on Laporan Akuntansi tabs when Saldo Awal
 * has not been posted (NULL state or reversed with no re-post).
 *
 * Dismissable per browser session via sessionStorage.
 * Returns null when: saldo awal is posted, OR user has dismissed this session.
 */
export default function SaldoAwalBanner({ onNavigate }: SaldoAwalBannerProps): React.ReactElement | null {
  const [show, setShow] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // If already dismissed this session, skip fetch entirely
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
      setLoaded(true);
      return;
    }

    let cancelled = false;
    getSaldoAwalState()
      .then(snapshot => {
        if (cancelled) return;
        // Show banner if no snapshot exists OR snapshot is reversed (not yet re-posted)
        const needsBanner = snapshot === null || snapshot.status === 'reversed';
        setShow(needsBanner);
        setLoaded(true);
      })
      .catch(() => {
        // On error, silently hide banner — do not block the accounting report
        if (!cancelled) setLoaded(true);
      });

    return () => { cancelled = true; };
  }, []);

  function handleDismiss() {
    sessionStorage.setItem(SESSION_KEY, '1');
    setShow(false);
  }

  // Don't render until we know whether to show
  if (!loaded || !show) return null;

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded border text-[13px]"
      style={{
        background: '#fffbeb',
        borderColor: '#fde68a',
        color: '#92400e',
      }}
      role="alert"
    >
      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
      <span className="flex-1">
        <span className="font-semibold">Anda belum set Saldo Awal</span>
        {' — laporan mencerminkan data dari tanggal sistem mulai dipakai, bukan Year-to-Date sebenarnya.'}
      </span>
      <button
        onClick={() => onNavigate('settings')}
        className="inline-flex items-center gap-1 font-bold text-[12px] px-3 py-1 rounded-full shrink-0 transition-colors"
        style={{
          background: '#fef3c7',
          borderWidth: 1,
          borderColor: '#fcd34d',
          color: '#92400e',
        }}
        aria-label="Set Saldo Awal di Pengaturan"
      >
        Set Saldo Awal
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded-full p-0.5 transition-colors hover:bg-amber-100"
        aria-label="Tutup banner"
      >
        <X className="w-4 h-4 text-amber-600" />
      </button>
    </div>
  );
}
