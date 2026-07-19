/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// src/components/pengaturan/NotificationPrefsScreen.tsx
// Sprint 5 Task 5.5 — Settings UI for notification_prefs:
//   Card 1: 🌙 Jam Tenang        — quiet_hours_start / quiet_hours_end
//   Card 2: 📦 Gabungkan Notif   — consolidation_window_seconds (range slider)
//   Card 3: 💤 Skip Hari Kosong  — skip_digest_on_zero_omset (checkbox)
//
// Auto-save on blur (matches Task 2.7 PiutangWaReminderScreen pattern).
// Reset-to-defaults button per card.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useTenant } from '../../contexts/TenantContext';
import { navigate } from '../../lib/urlRoute';

// ─── Defaults (mirrors DB DEFAULT values) ────────────────────────────────────
const DEFAULT_QUIET_START = '22:00';
const DEFAULT_QUIET_END = '07:00';
const DEFAULT_CONSOLIDATION_SECONDS = 300;
const DEFAULT_SKIP_DIGEST = true;

// ─── Types ────────────────────────────────────────────────────────────────────
interface NotificationPrefs {
  quiet_hours_start: string;
  quiet_hours_end: string;
  consolidation_window_seconds: number;
  skip_digest_on_zero_omset: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatConsolidation(seconds: number): string {
  if (seconds === 0) return 'Disabled (kirim langsung)';
  if (seconds < 60) return `${seconds} detik`;
  const minutes = seconds / 60;
  return minutes === Math.floor(minutes) ? `${minutes} menit` : `${minutes.toFixed(1)} menit`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NotificationPrefsScreen() {
  const tenant = useTenant();

  const [prefs, setPrefs] = useState<NotificationPrefs>({
    quiet_hours_start: DEFAULT_QUIET_START,
    quiet_hours_end: DEFAULT_QUIET_END,
    consolidation_window_seconds: DEFAULT_CONSOLIDATION_SECONDS,
    skip_digest_on_zero_omset: DEFAULT_SKIP_DIGEST,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!tenant?.tenant_id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);

      const { data, error } = await supabase
        .from('notification_prefs')
        .select('quiet_hours_start, quiet_hours_end, consolidation_window_seconds, skip_digest_on_zero_omset')
        .eq('tenant_id', tenant.tenant_id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }

      if (data) {
        // Postgres TIME comes as "HH:MM:SS" — trim to "HH:MM" for <input type="time">
        const trimTime = (t: string) => (t ?? '').slice(0, 5);
        setPrefs({
          quiet_hours_start: trimTime(data.quiet_hours_start as string) || DEFAULT_QUIET_START,
          quiet_hours_end: trimTime(data.quiet_hours_end as string) || DEFAULT_QUIET_END,
          consolidation_window_seconds: (data.consolidation_window_seconds as number) ?? DEFAULT_CONSOLIDATION_SECONDS,
          skip_digest_on_zero_omset: (data.skip_digest_on_zero_omset as boolean) ?? DEFAULT_SKIP_DIGEST,
        });
      }
      // Row guaranteed to exist (seeded in migration), so no else branch needed.

      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [tenant?.tenant_id]);

  // ── Save helper ───────────────────────────────────────────────────────────

  async function savePrefs(patch: Partial<NotificationPrefs>) {
    if (!tenant?.tenant_id) return;
    setSaveState('saving');

    const merged = { ...prefs, ...patch };
    setPrefs(merged);

    const { error } = await supabase
      .from('notification_prefs')
      .upsert(
        {
          tenant_id: tenant.tenant_id,
          quiet_hours_start: merged.quiet_hours_start,
          quiet_hours_end: merged.quiet_hours_end,
          consolidation_window_seconds: merged.consolidation_window_seconds,
          skip_digest_on_zero_omset: merged.skip_digest_on_zero_omset,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id' },
      );

    if (error) {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
      return;
    }
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 2000);
  }

  // ── Render guards ─────────────────────────────────────────────────────────

  if (!tenant) {
    return (
      <div className="nps-loading" role="status" aria-busy="true">
        Memuat konteks tenant...
      </div>
    );
  }

  if (loading) {
    return (
      <div className="nps-loading" role="status" aria-busy="true">
        Memuat konfigurasi notifikasi...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="nps-error" role="alert">
        <strong>Gagal memuat konfigurasi:</strong> {loadError}
      </div>
    );
  }

  // ── Save indicator text ───────────────────────────────────────────────────

  const saveIndicatorText =
    saveState === 'saved' ? '✓ Tersimpan' :
    saveState === 'saving' ? '⏳ Menyimpan...' :
    saveState === 'error' ? '⚠️ Gagal simpan' :
    '';

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="nps-screen">

      {/* ── Header ── */}
      <header className="nps-header">
        <div className="nps-header-top">
          <button
            type="button"
            className="nps-back-btn"
            onClick={() => navigate('settings')}
            aria-label="Kembali ke Pengaturan"
          >
            ← Pengaturan
          </button>
        </div>
        <h1 className="nps-title">Preferensi Notifikasi</h1>
        <p className="nps-subtitle">
          Atur jam tenang, penggabungan notifikasi, dan opsi ringkasan harian.
          Perubahan disimpan otomatis saat kamu pindah ke field berikutnya.
        </p>
      </header>

      {/* ── Save indicator ── */}
      {saveIndicatorText && (
        <div
          className={`nps-save-indicator nps-save-indicator--${saveState}`}
          role="status"
          aria-live="polite"
        >
          {saveIndicatorText}
        </div>
      )}

      <div className="nps-cards">

        {/* ── Card 1: Jam Tenang ── */}
        <section className="nps-card" aria-labelledby="nps-quiet-title">
          <div className="nps-card-header">
            <span className="nps-card-icon" aria-hidden="true">🌙</span>
            <div className="nps-card-title-group">
              <h2 id="nps-quiet-title" className="nps-card-title">Jam Tenang</h2>
              <p className="nps-card-desc">
                Notifikasi non-critical akan ditahan selama jam ini.
                Approval SLA + session-health alert bypass jam tenang.
              </p>
            </div>
          </div>

          <div className="nps-field-row">
            <div className="nps-field">
              <label htmlFor="nps-quiet-start" className="nps-label">Mulai</label>
              <input
                id="nps-quiet-start"
                type="time"
                className="nps-input-time"
                value={prefs.quiet_hours_start}
                onChange={(e) => setPrefs({ ...prefs, quiet_hours_start: e.target.value })}
                onBlur={() => void savePrefs({ quiet_hours_start: prefs.quiet_hours_start })}
                aria-label="Jam tenang mulai"
              />
            </div>
            <div className="nps-field">
              <label htmlFor="nps-quiet-end" className="nps-label">Sampai</label>
              <input
                id="nps-quiet-end"
                type="time"
                className="nps-input-time"
                value={prefs.quiet_hours_end}
                onChange={(e) => setPrefs({ ...prefs, quiet_hours_end: e.target.value })}
                onBlur={() => void savePrefs({ quiet_hours_end: prefs.quiet_hours_end })}
                aria-label="Jam tenang selesai"
              />
            </div>
          </div>

          <div className="nps-btn-row">
            <button
              type="button"
              className="nps-reset-btn"
              onClick={() => void savePrefs({
                quiet_hours_start: DEFAULT_QUIET_START,
                quiet_hours_end: DEFAULT_QUIET_END,
              })}
            >
              🔄 Reset default (22:00 – 07:00)
            </button>
          </div>
        </section>

        {/* ── Card 2: Gabungkan Notifikasi ── */}
        <section className="nps-card" aria-labelledby="nps-consolidation-title">
          <div className="nps-card-header">
            <span className="nps-card-icon" aria-hidden="true">📦</span>
            <div className="nps-card-title-group">
              <h2 id="nps-consolidation-title" className="nps-card-title">Gabungkan Notifikasi</h2>
              <p className="nps-card-desc">
                Beberapa notif dalam window ini digabung jadi 1 pesan. 0 = disabled.
              </p>
            </div>
          </div>

          <div className="nps-slider-row">
            <label htmlFor="nps-consolidation-slider" className="nps-label">
              Window: <strong>{formatConsolidation(prefs.consolidation_window_seconds)}</strong>
            </label>
            <input
              id="nps-consolidation-slider"
              type="range"
              min={0}
              max={1800}
              step={60}
              className="nps-slider"
              value={prefs.consolidation_window_seconds}
              onChange={(e) => setPrefs({
                ...prefs,
                consolidation_window_seconds: parseInt(e.target.value, 10),
              })}
              onBlur={() => void savePrefs({
                consolidation_window_seconds: prefs.consolidation_window_seconds,
              })}
              aria-label={`Window penggabungan: ${formatConsolidation(prefs.consolidation_window_seconds)}`}
              aria-valuemin={0}
              aria-valuemax={1800}
              aria-valuenow={prefs.consolidation_window_seconds}
              aria-valuetext={formatConsolidation(prefs.consolidation_window_seconds)}
            />
            <div className="nps-slider-ticks">
              <span>0 (off)</span>
              <span>5 menit</span>
              <span>15 menit</span>
              <span>30 menit</span>
            </div>
          </div>

          <div className="nps-btn-row">
            <button
              type="button"
              className="nps-reset-btn"
              onClick={() => void savePrefs({
                consolidation_window_seconds: DEFAULT_CONSOLIDATION_SECONDS,
              })}
            >
              🔄 Reset default (5 menit)
            </button>
          </div>
        </section>

        {/* ── Card 3: Skip Hari Kosong ── */}
        <section className="nps-card" aria-labelledby="nps-skip-title">
          <div className="nps-card-header">
            <span className="nps-card-icon" aria-hidden="true">💤</span>
            <div className="nps-card-title-group">
              <h2 id="nps-skip-title" className="nps-card-title">Skip Hari Kosong</h2>
              <p className="nps-card-desc">
                Skip ringkasan harian kalau omset hari itu = 0.
              </p>
            </div>
          </div>

          <div className="nps-checkbox-row">
            <label className="nps-checkbox-label" htmlFor="nps-skip-digest">
              <input
                id="nps-skip-digest"
                type="checkbox"
                className="nps-checkbox"
                checked={prefs.skip_digest_on_zero_omset}
                onChange={(e) => void savePrefs({ skip_digest_on_zero_omset: e.target.checked })}
              />
              <span>Aktifkan skip hari kosong</span>
            </label>
          </div>

          <div className="nps-btn-row">
            <button
              type="button"
              className="nps-reset-btn"
              onClick={() => void savePrefs({
                skip_digest_on_zero_omset: DEFAULT_SKIP_DIGEST,
              })}
            >
              🔄 Reset default (aktif)
            </button>
          </div>
        </section>

      </div>

      <style>{`
        .nps-screen {
          max-width: 720px;
          margin: 0 auto;
          padding: 24px;
          font-family: 'Inter', sans-serif;
        }
        .nps-loading, .nps-error {
          padding: 32px;
          text-align: center;
          font-size: 14px;
          color: #475569;
        }
        .nps-error { color: #991B1B; }

        /* Header */
        .nps-header { margin-bottom: 24px; }
        .nps-header-top { margin-bottom: 8px; }
        .nps-back-btn {
          background: none;
          border: none;
          color: #475569;
          font-size: 13px;
          cursor: pointer;
          padding: 4px 0;
          text-decoration: underline;
        }
        .nps-back-btn:hover { color: #0B2545; }
        .nps-title {
          font-size: 22px;
          font-weight: 700;
          color: #0B2545;
          margin: 0 0 6px;
        }
        .nps-subtitle {
          font-size: 14px;
          color: #64748B;
          margin: 0;
          line-height: 1.5;
        }

        /* Save indicator */
        .nps-save-indicator {
          display: inline-block;
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
          margin-bottom: 16px;
        }
        .nps-save-indicator--saved { background: #DCFCE7; color: #166534; }
        .nps-save-indicator--saving { background: #FEF9C3; color: #854D0E; }
        .nps-save-indicator--error { background: #FEE2E2; color: #991B1B; }

        /* Cards */
        .nps-cards { display: flex; flex-direction: column; gap: 20px; }
        .nps-card {
          background: white;
          border: 1px solid #E2E8F0;
          border-radius: 12px;
          padding: 20px 24px;
        }

        /* Card header */
        .nps-card-header {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          margin-bottom: 18px;
        }
        .nps-card-icon {
          font-size: 22px;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .nps-card-title-group { flex: 1; min-width: 0; }
        .nps-card-title {
          font-size: 15px;
          font-weight: 700;
          color: #0B2545;
          margin: 0 0 4px;
        }
        .nps-card-desc {
          font-size: 13px;
          color: #64748B;
          margin: 0;
          line-height: 1.4;
        }

        /* Time inputs */
        .nps-field-row {
          display: flex;
          gap: 24px;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }
        .nps-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .nps-label {
          font-size: 12px;
          font-weight: 600;
          color: #475569;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .nps-input-time {
          font-size: 14px;
          font-weight: 600;
          color: #0B2545;
          border: 1px solid #CBD5E1;
          border-radius: 8px;
          padding: 8px 12px;
          background: #F8FAFC;
          cursor: pointer;
          accent-color: #8B5CF6;
          outline: none;
          transition: border-color 0.15s;
        }
        .nps-input-time:focus {
          border-color: #8B5CF6;
          background: white;
        }

        /* Range slider */
        .nps-slider-row { margin-bottom: 14px; }
        .nps-slider {
          width: 100%;
          max-width: 420px;
          accent-color: #8B5CF6;
          display: block;
          margin-top: 8px;
        }
        .nps-slider-ticks {
          display: flex;
          justify-content: space-between;
          max-width: 420px;
          font-size: 11px;
          color: #94A3B8;
          margin-top: 4px;
        }

        /* Checkbox */
        .nps-checkbox-row { margin-bottom: 14px; }
        .nps-checkbox-label {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 14px;
          font-weight: 500;
          color: #0B2545;
          cursor: pointer;
        }
        .nps-checkbox {
          width: 16px;
          height: 16px;
          cursor: pointer;
          accent-color: #8B5CF6;
          flex-shrink: 0;
        }

        /* Reset button */
        .nps-btn-row { margin-top: 4px; }
        .nps-reset-btn {
          background: none;
          border: 1px solid #CBD5E1;
          border-radius: 6px;
          padding: 7px 12px;
          font-size: 13px;
          font-weight: 600;
          color: #475569;
          cursor: pointer;
          transition: background 0.1s, border-color 0.1s;
        }
        .nps-reset-btn:hover {
          background: #F8FAFC;
          border-color: #94A3B8;
        }

        @media (max-width: 600px) {
          .nps-screen { padding: 16px; }
          .nps-card { padding: 16px; }
          .nps-field-row { gap: 16px; }
        }
      `}</style>
    </div>
  );
}
