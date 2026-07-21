/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// src/components/pengaturan/PiutangWaReminderScreen.tsx
// Sprint 2 Task 2.7 — Settings page for Piutang WA Reminder templates.
// Owner edits H-3 (pre-due) and H+3 (overdue) WhatsApp reminder templates.
// Auto-saves on blur; test-send button; reset-to-default per template.

import { useEffect, useState } from 'react';
import { TemplateChipInput } from '../notification/TemplateChipInput';
import { TemplatePreview } from '../notification/TemplatePreview';
import { supabase } from '../../lib/supabaseClient';
import { useTenant } from '../../contexts/TenantContext';
import { navigate } from '../../lib/urlRoute';
import { captureError } from '../../lib/captureError';

const VARS_H3 = [
  { key: 'customer_nama', label: 'Nama Customer' },
  { key: 'toko_nama', label: 'Nama Toko' },
  { key: 'invoice_no', label: 'Nomor Invoice' },
  { key: 'jumlah', label: 'Jumlah Rp' },
  { key: 'due_date', label: 'Tanggal Jatuh Tempo' },
];

const VARS_H3_PLUS = [
  ...VARS_H3,
  { key: 'overdue_days', label: 'Hari Terlambat' },
];

const SAMPLE_DATA: Record<string, string> = {
  customer_nama: 'Pak Budi',
  toko_nama: 'Toko Jaya Makmur',
  invoice_no: 'INV-2607-0142',
  jumlah: '4.200.000',
  due_date: '22 Jul 2026',
  overdue_days: '3',
};

const DEFAULT_TEMPLATE_H3 =
  'Halo {customer_nama} 👋, ini reminder ramah dari {toko_nama}. Invoice #{invoice_no} sebesar Rp {jumlah} akan jatuh tempo pada {due_date} (3 hari lagi). Kalau sudah dibayar mohon abaikan pesan ini. Terima kasih 🙏';

const DEFAULT_TEMPLATE_H3_PLUS =
  'Halo {customer_nama}, invoice #{invoice_no} sebesar Rp {jumlah} sudah lewat jatuh tempo (H+{overdue_days}). Mohon segera dibayar ya. Kalau ada kendala bisa reply pesan ini — kami siap bantu. Terima kasih 🙏 — {toko_nama}';

interface TenantConfig {
  enabled: boolean;
  template_h3: string;
  template_h3_plus: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function PiutangWaReminderScreen() {
  const tenant = useTenant();
  const [config, setConfig] = useState<TenantConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [testSendingH3, setTestSendingH3] = useState(false);
  const [testSendingH3Plus, setTestSendingH3Plus] = useState(false);

  useEffect(() => {
    if (!tenant?.tenant_id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase
        .from('tenant_wa_reminder_config')
        .select('enabled, template_h3, template_h3_plus')
        .eq('tenant_id', tenant.tenant_id)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        captureError(error, { feature: 'piutang_wa_reminder', action: 'fetch_reminder_config' });
        setLoadError(error.message);
        setLoading(false);
        return;
      }

      if (data) {
        setConfig({
          enabled: data.enabled as boolean,
          template_h3: data.template_h3 as string,
          template_h3_plus: data.template_h3_plus as string,
        });
      } else {
        // Row doesn't exist yet — show defaults so user can edit and save
        setConfig({
          enabled: false,
          template_h3: DEFAULT_TEMPLATE_H3,
          template_h3_plus: DEFAULT_TEMPLATE_H3_PLUS,
        });
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [tenant?.tenant_id]);

  async function saveField(
    field: keyof TenantConfig,
    value: string | boolean,
  ) {
    if (!config || !tenant?.tenant_id) return;
    setSaveState('saving');
    const next = { ...config, [field]: value };
    setConfig(next);

    const { error } = await supabase
      .from('tenant_wa_reminder_config')
      .upsert(
        {
          tenant_id: tenant.tenant_id,
          enabled: next.enabled,
          template_h3: next.template_h3,
          template_h3_plus: next.template_h3_plus,
        },
        { onConflict: 'tenant_id' },
      );

    if (error) {
      captureError(error, { feature: 'piutang_wa_reminder', action: 'save_reminder_config', field: String(field) });
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
      return;
    }
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 2000);
  }

  async function sendTest(ruleType: 'H-3' | 'H+3') {
    const setTestSending = ruleType === 'H-3' ? setTestSendingH3 : setTestSendingH3Plus;
    setTestSending(true);
    const { error } = await supabase.rpc('send_piutang_reminder_test', {
      p_rule_type: ruleType,
    });
    if (error) {
      alert('Gagal kirim test: ' + error.message);
    } else {
      alert('✓ Terkirim! Cek WhatsApp kamu.');
    }
    setTestSending(false);
  }

  function resetDefault(field: 'template_h3' | 'template_h3_plus') {
    const defaults: Record<typeof field, string> = {
      template_h3: DEFAULT_TEMPLATE_H3,
      template_h3_plus: DEFAULT_TEMPLATE_H3_PLUS,
    };
    void saveField(field, defaults[field]);
  }

  // ─── Loading / error states ────────────────────────────────────────────────

  if (!tenant) {
    return (
      <div className="pwr-loading" role="status" aria-busy="true">
        Memuat konteks tenant...
      </div>
    );
  }

  if (loading) {
    return (
      <div className="pwr-loading" role="status" aria-busy="true">
        Memuat konfigurasi...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="pwr-error" role="alert">
        <strong>Gagal memuat konfigurasi:</strong> {loadError}
      </div>
    );
  }

  if (!config) return null;

  const saveIndicatorText =
    saveState === 'saved' ? '✓ Tersimpan otomatis' :
    saveState === 'saving' ? '⏳ Menyimpan...' :
    saveState === 'error' ? '⚠️ Gagal simpan — coba lagi' :
    '';

  const testSendingAny = testSendingH3 || testSendingH3Plus;

  return (
    <div className="pwr-screen">
      {/* ── Header ── */}
      <header className="pwr-header">
        <div className="pwr-header-top">
          <button
            type="button"
            className="pwr-back-btn"
            onClick={() => navigate('settings')}
            aria-label="Kembali ke Pengaturan"
          >
            ← Pengaturan
          </button>
          <span className="pwr-badge">Premium</span>
        </div>
        <h1 className="pwr-title">WA Reminder Piutang</h1>
        <p className="pwr-subtitle">
          Atur pesan reminder yang otomatis dikirim ke customer H-3 (3 hari sebelum jatuh tempo)
          dan H+3 (3 hari setelah jatuh tempo).
        </p>
      </header>

      {/* ── Global toggle ── */}
      <div className="pwr-toggle-card">
        <label className="pwr-toggle-label">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => void saveField('enabled', e.target.checked)}
            aria-label="Aktifkan WA Reminder Scheduler"
          />
          <span>Aktifkan WA Reminder Scheduler (semua customer)</span>
        </label>
        {!config.enabled && (
          <p className="pwr-toggle-hint">
            Scheduler dimatikan. Reminder tidak akan dikirim meski jadwal cocok.
          </p>
        )}
      </div>

      {/* ── Save indicator (shared) ── */}
      {saveIndicatorText && (
        <div
          className={`pwr-save-indicator pwr-save-indicator--${saveState}`}
          role="status"
          aria-live="polite"
        >
          {saveIndicatorText}
        </div>
      )}

      {/* ── Template H-3 ── */}
      <section className="pwr-panel" aria-labelledby="pwr-h3-title">
        <h2 id="pwr-h3-title" className="pwr-panel-title">
          📩 Template H-3 <span className="pwr-panel-subtitle">(3 hari sebelum jatuh tempo)</span>
        </h2>
        <div className="pwr-editor-grid">
          <div className="pwr-editor-col">
            <TemplateChipInput
              variables={VARS_H3}
              value={config.template_h3}
              onChange={(next) => setConfig({ ...config, template_h3: next })}
              onBlur={() => void saveField('template_h3', config.template_h3)}
            />
            <div className="pwr-btn-row">
              <button
                type="button"
                className="pwr-btn pwr-btn--secondary"
                onClick={() => resetDefault('template_h3')}
              >
                🔄 Reset default
              </button>
              <button
                type="button"
                className="pwr-btn pwr-btn--primary"
                onClick={() => void sendTest('H-3')}
                disabled={testSendingAny}
              >
                {testSendingH3 ? '⏳ Mengirim...' : '📱 Kirim tes ke HP saya'}
              </button>
            </div>
          </div>
          <div className="pwr-preview-col">
            <TemplatePreview template={config.template_h3} sampleData={SAMPLE_DATA} />
          </div>
        </div>
      </section>

      {/* ── Template H+3 ── */}
      <section className="pwr-panel" aria-labelledby="pwr-h3plus-title">
        <h2 id="pwr-h3plus-title" className="pwr-panel-title">
          📩 Template H+3 <span className="pwr-panel-subtitle">(3 hari setelah jatuh tempo)</span>
        </h2>
        <div className="pwr-editor-grid">
          <div className="pwr-editor-col">
            <TemplateChipInput
              variables={VARS_H3_PLUS}
              value={config.template_h3_plus}
              onChange={(next) => setConfig({ ...config, template_h3_plus: next })}
              onBlur={() => void saveField('template_h3_plus', config.template_h3_plus)}
            />
            <div className="pwr-btn-row">
              <button
                type="button"
                className="pwr-btn pwr-btn--secondary"
                onClick={() => resetDefault('template_h3_plus')}
              >
                🔄 Reset default
              </button>
              <button
                type="button"
                className="pwr-btn pwr-btn--primary"
                onClick={() => void sendTest('H+3')}
                disabled={testSendingAny}
              >
                {testSendingH3Plus ? '⏳ Mengirim...' : '📱 Kirim tes ke HP saya'}
              </button>
            </div>
          </div>
          <div className="pwr-preview-col">
            <TemplatePreview template={config.template_h3_plus} sampleData={SAMPLE_DATA} />
          </div>
        </div>
      </section>

      <style>{`
        .pwr-screen {
          max-width: 1200px;
          margin: 0 auto;
          padding: 24px;
          font-family: 'Inter', sans-serif;
        }
        .pwr-loading, .pwr-error {
          padding: 32px;
          text-align: center;
          color: #475569;
          font-size: 14px;
        }
        .pwr-error { color: #991B1B; }

        /* Header */
        .pwr-header { margin-bottom: 24px; }
        .pwr-header-top {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 8px;
        }
        .pwr-back-btn {
          background: none;
          border: none;
          color: #475569;
          font-size: 13px;
          cursor: pointer;
          padding: 4px 0;
          text-decoration: underline;
        }
        .pwr-back-btn:hover { color: #0B2545; }
        .pwr-badge {
          background: linear-gradient(135deg, #8B5CF6, #A78BFA);
          color: white;
          padding: 3px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.5px;
        }
        .pwr-title {
          font-size: 22px;
          font-weight: 700;
          color: #0B2545;
          margin: 0 0 6px;
        }
        .pwr-subtitle {
          font-size: 14px;
          color: #64748B;
          margin: 0;
          line-height: 1.5;
        }

        /* Global toggle */
        .pwr-toggle-card {
          margin-bottom: 20px;
          padding: 16px 20px;
          background: #F8FAFC;
          border: 1px solid #E2E8F0;
          border-radius: 10px;
        }
        .pwr-toggle-label {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 14px;
          font-weight: 600;
          color: #0B2545;
          cursor: pointer;
        }
        .pwr-toggle-label input[type="checkbox"] {
          width: 16px;
          height: 16px;
          cursor: pointer;
          accent-color: #8B5CF6;
        }
        .pwr-toggle-hint {
          margin: 8px 0 0 26px;
          font-size: 12px;
          color: #92400E;
        }

        /* Save indicator */
        .pwr-save-indicator {
          margin-bottom: 16px;
          font-size: 12px;
          font-weight: 600;
          padding: 6px 12px;
          border-radius: 6px;
          display: inline-block;
        }
        .pwr-save-indicator--saved { background: #DCFCE7; color: #166534; }
        .pwr-save-indicator--saving { background: #FEF9C3; color: #854D0E; }
        .pwr-save-indicator--error { background: #FEE2E2; color: #991B1B; }

        /* Template panels */
        .pwr-panel {
          margin-bottom: 28px;
          padding: 24px;
          background: white;
          border: 1px solid #E2E8F0;
          border-radius: 12px;
        }
        .pwr-panel-title {
          font-size: 16px;
          font-weight: 700;
          color: #0B2545;
          margin: 0 0 16px;
        }
        .pwr-panel-subtitle {
          font-size: 13px;
          font-weight: 400;
          color: #64748B;
          margin-left: 6px;
        }

        /* Editor grid */
        .pwr-editor-grid {
          display: grid;
          grid-template-columns: 3fr 2fr;
          gap: 24px;
        }
        @media (max-width: 900px) {
          .pwr-editor-grid { grid-template-columns: 1fr; }
        }

        /* Button row */
        .pwr-btn-row {
          display: flex;
          gap: 8px;
          margin-top: 12px;
          flex-wrap: wrap;
        }
        .pwr-btn {
          padding: 8px 14px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, opacity 0.15s;
        }
        .pwr-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .pwr-btn--secondary {
          border: 1px solid #CBD5E1;
          background: white;
          color: #475569;
        }
        .pwr-btn--secondary:hover:not(:disabled) { background: #F8FAFC; }
        .pwr-btn--primary {
          border: 1px solid #8B5CF6;
          background: #8B5CF6;
          color: white;
        }
        .pwr-btn--primary:hover:not(:disabled) { background: #7C3AED; }
      `}</style>
    </div>
  );
}
