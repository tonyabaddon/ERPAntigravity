/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// src/components/pengaturan/NotificationCronScreen.tsx
// Sprint 4 Task 4.5 — Configuration UI for the 4 scheduled notification jobs:
//   1. Ringkasan Piutang Harian  (08:00 WIB, persists to tenant_wa_reminder_config.enabled)
//   2. Ringkasan Hutang Harian   (07:30 WIB, UI-only — no backend config table yet)
//   3. Approval SLA Breach Alert (2h threshold, UI-only — no backend config table yet)
//   4. Feedback Customer Post-Order (7-day delay, UI-only — no backend config table yet)
//
// Cards 2-4 are intentionally read-only / non-persistent: the Go pollers are
// hardcoded; a Sprint 5 backend task must add a tenant_notification_cron_config
// table before persistence can be wired. This is documented in task-4.5-report.md.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useTenant } from '../../contexts/TenantContext';
import { navigate } from '../../lib/urlRoute';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// ─── Piutang card state (backed by tenant_wa_reminder_config) ────────────────

interface PiutangConfig {
  enabled: boolean;
}

export function NotificationCronScreen() {
  const tenant = useTenant();

  // Piutang overdue — persisted
  const [piutangConfig, setPiutangConfig] = useState<PiutangConfig | null>(null);
  const [piutangLoading, setPiutangLoading] = useState(true);
  const [piutangError, setPiutangError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // Hutang overdue — UI only
  const [hutangEnabled, setHutangEnabled] = useState(true);

  // Approval SLA — UI only (threshold in minutes)
  const [slaEnabled, setSlaEnabled] = useState(true);
  const [slaThresholdMinutes, setSlaThresholdMinutes] = useState(120); // 2h default

  // Feedback — UI only (delay in days)
  const [feedbackEnabled, setFeedbackEnabled] = useState(true);
  const [feedbackDelayDays, setFeedbackDelayDays] = useState(7);

  useEffect(() => {
    if (!tenant?.tenant_id) return;
    let cancelled = false;

    (async () => {
      setPiutangLoading(true);
      setPiutangError(null);
      const { data, error } = await supabase
        .from('tenant_wa_reminder_config')
        .select('enabled')
        .eq('tenant_id', tenant.tenant_id)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setPiutangError(error.message);
        setPiutangLoading(false);
        return;
      }
      setPiutangConfig({ enabled: data?.enabled ?? true });
      setPiutangLoading(false);
    })();

    return () => { cancelled = true; };
  }, [tenant?.tenant_id]);

  async function togglePiutang(next: boolean) {
    if (!tenant?.tenant_id) return;
    setPiutangConfig((prev) => (prev ? { ...prev, enabled: next } : { enabled: next }));
    setSaveState('saving');
    const { error } = await supabase
      .from('tenant_wa_reminder_config')
      .upsert(
        { tenant_id: tenant.tenant_id, enabled: next },
        { onConflict: 'tenant_id' },
      );
    if (error) {
      setSaveState('error');
      setPiutangConfig((prev) => (prev ? { ...prev, enabled: !next } : prev));
      setTimeout(() => setSaveState('idle'), 3000);
      return;
    }
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 2000);
  }

  const saveIndicatorText =
    saveState === 'saved' ? '✓ Tersimpan' :
    saveState === 'saving' ? '⏳ Menyimpan...' :
    saveState === 'error' ? '⚠️ Gagal simpan' :
    '';

  function formatSlaThreshold(minutes: number): string {
    if (minutes < 60) return `${minutes} menit`;
    const h = minutes / 60;
    return h === Math.floor(h) ? `${h} jam` : `${h.toFixed(1)} jam`;
  }

  if (!tenant) {
    return (
      <div className="ncs-loading" role="status" aria-busy="true">
        Memuat konteks tenant...
      </div>
    );
  }

  return (
    <div className="ncs-screen">
      {/* ── Header ── */}
      <header className="ncs-header">
        <div className="ncs-header-top">
          <button
            type="button"
            className="ncs-back-btn"
            onClick={() => navigate('settings')}
            aria-label="Kembali ke Pengaturan"
          >
            ← Pengaturan
          </button>
        </div>
        <h1 className="ncs-title">Konfigurasi Notifikasi Terjadwal</h1>
        <p className="ncs-subtitle">
          Atur notifikasi WhatsApp otomatis yang dikirim secara terjadwal ke owner/admin.
          Notifikasi berjalan di server — tidak tergantung aplikasi dibuka atau tidak.
        </p>
      </header>

      {/* ── Save indicator ── */}
      {saveIndicatorText && (
        <div
          className={`ncs-save-indicator ncs-save-indicator--${saveState}`}
          role="status"
          aria-live="polite"
        >
          {saveIndicatorText}
        </div>
      )}

      <div className="ncs-cards">

        {/* ── Card 1: Piutang Overdue ── */}
        <section className="ncs-card" aria-labelledby="ncs-piutang-title">
          <div className="ncs-card-header">
            <div className="ncs-card-icon">🕗</div>
            <div className="ncs-card-title-group">
              <h2 id="ncs-piutang-title" className="ncs-card-title">
                Ringkasan Piutang Harian
              </h2>
              <p className="ncs-card-desc">
                Kirim ringkasan invoice piutang yang sudah melewati jatuh tempo ke owner setiap pagi.
              </p>
            </div>
            <label className="ncs-toggle" aria-label="Aktifkan Ringkasan Piutang Harian">
              <input
                type="checkbox"
                checked={piutangConfig?.enabled ?? true}
                disabled={piutangLoading}
                onChange={(e) => void togglePiutang(e.target.checked)}
              />
              <span className="ncs-toggle-track" />
            </label>
          </div>

          <div className="ncs-card-meta">
            <div className="ncs-meta-item">
              <span className="ncs-meta-label">Waktu kirim</span>
              <span className="ncs-meta-value">08:00 WIB (terjadwal server)</span>
            </div>
            <div className="ncs-meta-item">
              <span className="ncs-meta-label">Penerima</span>
              <span className="ncs-meta-value">Owner (semua penerima WA role owner)</span>
            </div>
          </div>

          {piutangError && (
            <p className="ncs-card-error">Gagal memuat: {piutangError}</p>
          )}

          <button
            type="button"
            className="ncs-edit-template-btn"
            onClick={() => navigate('notification-templates')}
          >
            ✏️ Edit template notifikasi
          </button>
        </section>

        {/* ── Card 2: Hutang Overdue (UI-only) ── */}
        <section className="ncs-card ncs-card--readonly" aria-labelledby="ncs-hutang-title">
          <div className="ncs-card-header">
            <div className="ncs-card-icon">🕐</div>
            <div className="ncs-card-title-group">
              <h2 id="ncs-hutang-title" className="ncs-card-title">
                Ringkasan Hutang Harian
              </h2>
              <p className="ncs-card-desc">
                Kirim ringkasan tagihan hutang yang sudah jatuh tempo ke owner setiap pagi.
              </p>
            </div>
            <label className="ncs-toggle" aria-label="Aktifkan Ringkasan Hutang Harian">
              <input
                type="checkbox"
                checked={hutangEnabled}
                onChange={(e) => setHutangEnabled(e.target.checked)}
              />
              <span className="ncs-toggle-track" />
            </label>
          </div>

          <div className="ncs-card-meta">
            <div className="ncs-meta-item">
              <span className="ncs-meta-label">Waktu kirim</span>
              <span className="ncs-meta-value">07:30 WIB (terjadwal server)</span>
            </div>
            <div className="ncs-meta-item">
              <span className="ncs-meta-label">Penerima</span>
              <span className="ncs-meta-value">Owner (semua penerima WA role owner)</span>
            </div>
          </div>

          <div className="ncs-pending-note" role="note">
            ℹ️ Konfigurasi per-tenant untuk notifikasi ini akan tersedia di Sprint 5.
            Saat ini jadwal diatur di server (07:30 WIB).
          </div>

          <button
            type="button"
            className="ncs-edit-template-btn"
            onClick={() => navigate('notification-templates')}
          >
            ✏️ Edit template notifikasi
          </button>
        </section>

        {/* ── Card 3: Approval SLA Breach (UI-only) ── */}
        <section className="ncs-card ncs-card--readonly" aria-labelledby="ncs-sla-title">
          <div className="ncs-card-header">
            <div className="ncs-card-icon">⚠️</div>
            <div className="ncs-card-title-group">
              <h2 id="ncs-sla-title" className="ncs-card-title">
                Approval SLA Breach Alert
              </h2>
              <p className="ncs-card-desc">
                Alert ke owner jika ada permintaan persetujuan yang belum direspons melebihi batas waktu.
              </p>
            </div>
            <label className="ncs-toggle" aria-label="Aktifkan Approval SLA Breach Alert">
              <input
                type="checkbox"
                checked={slaEnabled}
                onChange={(e) => setSlaEnabled(e.target.checked)}
              />
              <span className="ncs-toggle-track" />
            </label>
          </div>

          <div className="ncs-card-meta">
            <div className="ncs-meta-item">
              <span className="ncs-meta-label">Threshold</span>
              <span className="ncs-meta-value">{formatSlaThreshold(slaThresholdMinutes)}</span>
            </div>
            <div className="ncs-meta-item">
              <span className="ncs-meta-label">Penerima</span>
              <span className="ncs-meta-value">Owner</span>
            </div>
          </div>

          <div className="ncs-slider-row">
            <label htmlFor="ncs-sla-slider" className="ncs-slider-label">
              Batas waktu: <strong>{formatSlaThreshold(slaThresholdMinutes)}</strong>
            </label>
            <input
              id="ncs-sla-slider"
              type="range"
              min={30}
              max={480}
              step={30}
              value={slaThresholdMinutes}
              onChange={(e) => setSlaThresholdMinutes(Number(e.target.value))}
              className="ncs-slider"
              aria-label={`Threshold SLA: ${formatSlaThreshold(slaThresholdMinutes)}`}
            />
            <div className="ncs-slider-ticks">
              <span>30m</span>
              <span>2j</span>
              <span>4j</span>
              <span>8j</span>
            </div>
          </div>

          <div className="ncs-pending-note" role="note">
            ℹ️ Konfigurasi per-tenant untuk notifikasi ini akan tersedia di Sprint 5.
            Saat ini threshold baku 2 jam diatur di server.
          </div>

          <button
            type="button"
            className="ncs-edit-template-btn"
            onClick={() => navigate('notification-templates')}
          >
            ✏️ Edit template notifikasi
          </button>
        </section>

        {/* ── Card 4: Feedback Post-Order (UI-only) ── */}
        <section className="ncs-card ncs-card--readonly" aria-labelledby="ncs-feedback-title">
          <div className="ncs-card-header">
            <div className="ncs-card-icon">📝</div>
            <div className="ncs-card-title-group">
              <h2 id="ncs-feedback-title" className="ncs-card-title">
                Feedback Customer Post-Order
              </h2>
              <p className="ncs-card-desc">
                Kirim WA ke customer beberapa hari setelah order selesai untuk meminta ulasan dan rating.
              </p>
            </div>
            <label className="ncs-toggle" aria-label="Aktifkan Feedback Customer Post-Order">
              <input
                type="checkbox"
                checked={feedbackEnabled}
                onChange={(e) => setFeedbackEnabled(e.target.checked)}
              />
              <span className="ncs-toggle-track" />
            </label>
          </div>

          <div className="ncs-card-meta">
            <div className="ncs-meta-item">
              <span className="ncs-meta-label">Delay kirim</span>
              <span className="ncs-meta-value">{feedbackDelayDays} hari setelah order selesai</span>
            </div>
            <div className="ncs-meta-item">
              <span className="ncs-meta-label">Penerima</span>
              <span className="ncs-meta-value">Customer (via WA)</span>
            </div>
          </div>

          <div className="ncs-slider-row">
            <label htmlFor="ncs-feedback-slider" className="ncs-slider-label">
              Delay: <strong>{feedbackDelayDays} hari</strong>
            </label>
            <input
              id="ncs-feedback-slider"
              type="range"
              min={3}
              max={14}
              step={1}
              value={feedbackDelayDays}
              onChange={(e) => setFeedbackDelayDays(Number(e.target.value))}
              className="ncs-slider"
              aria-label={`Delay feedback: ${feedbackDelayDays} hari`}
            />
            <div className="ncs-slider-ticks">
              <span>3 hari</span>
              <span>7 hari</span>
              <span>14 hari</span>
            </div>
          </div>

          <div className="ncs-pending-note" role="note">
            ℹ️ Konfigurasi per-tenant untuk notifikasi ini akan tersedia di Sprint 5.
            Saat ini delay baku 7 hari diatur di server.
          </div>

          <button
            type="button"
            className="ncs-edit-template-btn"
            onClick={() => navigate('notification-templates')}
          >
            ✏️ Edit template notifikasi
          </button>
        </section>

      </div>

      <style>{`
        .ncs-screen {
          max-width: 800px;
          margin: 0 auto;
          padding: 24px;
          font-family: 'Inter', sans-serif;
        }
        .ncs-loading {
          padding: 32px;
          text-align: center;
          color: #475569;
          font-size: 14px;
        }

        /* Header */
        .ncs-header { margin-bottom: 24px; }
        .ncs-header-top { margin-bottom: 8px; }
        .ncs-back-btn {
          background: none;
          border: none;
          color: #475569;
          font-size: 13px;
          cursor: pointer;
          padding: 4px 0;
          text-decoration: underline;
        }
        .ncs-back-btn:hover { color: #0B2545; }
        .ncs-title {
          font-size: 22px;
          font-weight: 700;
          color: #0B2545;
          margin: 0 0 6px;
        }
        .ncs-subtitle {
          font-size: 14px;
          color: #64748B;
          margin: 0;
          line-height: 1.5;
        }

        /* Save indicator */
        .ncs-save-indicator {
          display: inline-block;
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
          margin-bottom: 16px;
        }
        .ncs-save-indicator--saved { background: #DCFCE7; color: #166534; }
        .ncs-save-indicator--saving { background: #FEF9C3; color: #854D0E; }
        .ncs-save-indicator--error { background: #FEE2E2; color: #991B1B; }

        /* Cards */
        .ncs-cards { display: flex; flex-direction: column; gap: 20px; }

        .ncs-card {
          background: white;
          border: 1px solid #E2E8F0;
          border-radius: 12px;
          padding: 20px 24px;
        }
        .ncs-card--readonly {
          background: #FAFAFA;
        }

        .ncs-card-header {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          margin-bottom: 16px;
        }
        .ncs-card-icon {
          font-size: 22px;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .ncs-card-title-group { flex: 1; min-width: 0; }
        .ncs-card-title {
          font-size: 15px;
          font-weight: 700;
          color: #0B2545;
          margin: 0 0 4px;
        }
        .ncs-card-desc {
          font-size: 13px;
          color: #64748B;
          margin: 0;
          line-height: 1.4;
        }

        /* Toggle */
        .ncs-toggle {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          cursor: pointer;
          position: relative;
        }
        .ncs-toggle input[type="checkbox"] {
          position: absolute;
          opacity: 0;
          width: 0;
          height: 0;
        }
        .ncs-toggle-track {
          width: 40px;
          height: 22px;
          background: #CBD5E1;
          border-radius: 99px;
          transition: background 0.2s;
          position: relative;
          display: block;
        }
        .ncs-toggle-track::after {
          content: '';
          position: absolute;
          top: 3px;
          left: 3px;
          width: 16px;
          height: 16px;
          background: white;
          border-radius: 50%;
          transition: transform 0.2s;
          box-shadow: 0 1px 3px rgba(0,0,0,.2);
        }
        .ncs-toggle input:checked + .ncs-toggle-track {
          background: #8B5CF6;
        }
        .ncs-toggle input:checked + .ncs-toggle-track::after {
          transform: translateX(18px);
        }
        .ncs-toggle input:disabled + .ncs-toggle-track {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Meta grid */
        .ncs-card-meta {
          display: flex;
          gap: 24px;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }
        .ncs-meta-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .ncs-meta-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #94A3B8;
        }
        .ncs-meta-value {
          font-size: 13px;
          color: #334155;
          font-weight: 500;
        }

        /* Slider */
        .ncs-slider-row {
          margin-bottom: 14px;
        }
        .ncs-slider-label {
          display: block;
          font-size: 13px;
          color: #475569;
          margin-bottom: 6px;
        }
        .ncs-slider {
          width: 100%;
          max-width: 360px;
          accent-color: #8B5CF6;
          display: block;
        }
        .ncs-slider-ticks {
          display: flex;
          justify-content: space-between;
          max-width: 360px;
          font-size: 11px;
          color: #94A3B8;
          margin-top: 4px;
        }

        /* Pending note */
        .ncs-pending-note {
          font-size: 12px;
          color: #92400E;
          background: #FFFBEB;
          border: 1px solid #FDE68A;
          border-radius: 6px;
          padding: 8px 12px;
          margin-bottom: 14px;
          line-height: 1.5;
        }

        /* Error */
        .ncs-card-error {
          font-size: 12px;
          color: #991B1B;
          background: #FEE2E2;
          border-radius: 6px;
          padding: 8px 12px;
          margin-bottom: 10px;
        }

        /* Edit template button */
        .ncs-edit-template-btn {
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
        .ncs-edit-template-btn:hover {
          background: #F8FAFC;
          border-color: #94A3B8;
        }

        @media (max-width: 600px) {
          .ncs-screen { padding: 16px; }
          .ncs-card { padding: 16px; }
          .ncs-card-meta { gap: 16px; }
        }
      `}</style>
    </div>
  );
}
