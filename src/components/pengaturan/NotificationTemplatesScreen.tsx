/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// src/components/pengaturan/NotificationTemplatesScreen.tsx
// Sprint 3 Task 3.4 — Universal settings page for all 10 WA notification templates.
// Sidebar lists templates grouped by audience. Editor reuses TemplateChipInput +
// TemplatePreview (Sprint 2). History modal shows last 50 edits with restore.
// defaultContent strings mirror the Go DefaultXXXTemplate constants verbatim.

import { useEffect, useState } from 'react';
import { TemplateChipInput } from '../notification/TemplateChipInput';
import { TemplatePreview } from '../notification/TemplatePreview';
import { TemplateHistoryModal } from '../notification/TemplateHistoryModal';
import { supabase } from '../../lib/supabaseClient';
import { navigate } from '../../lib/urlRoute';
import { captureError } from '../../lib/captureError';

interface TemplateDef {
  id: string;
  label: string;
  group: 'customer' | 'staff';
  variables: { key: string; label: string }[];
  sampleData: Record<string, string>;
  defaultContent: string;
}

// defaultContent mirrors the Go DefaultXXXTemplate constants (or fmt.Sprintf
// equivalents) verbatim so the DB default and the frontend fallback stay in sync.
// Templates without a Go const (staff_escalation_payment, followup_customer,
// booking_expiry, heartbeat_digest) use the canonical string from the spec.
const TEMPLATES: TemplateDef[] = [
  {
    id: 'order_created',
    label: 'Konfirmasi Order Baru',
    group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' },
      { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' },
      { key: 'amount', label: 'Jumlah Rp' },
    ],
    sampleData: {
      customer_nama: 'Pak Budi',
      toko_nama: 'Toko Jaya',
      invoice_no: 'INV-001',
      amount: '4.200.000',
    },
    // Go: DefaultOrderCreatedTemplate
    defaultContent:
      'Halo {customer_nama} 👋, terima kasih sudah order di {toko_nama}!\n\nInvoice: #{invoice_no}\nTotal: Rp {amount}\n\nKami akan segera proses pesanan Anda. Terima kasih 🙏',
  },
  {
    id: 'payment_verified',
    label: 'Pembayaran Diverifikasi',
    group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' },
      { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' },
      { key: 'amount', label: 'Jumlah Rp' },
    ],
    sampleData: {
      customer_nama: 'Pak Budi',
      toko_nama: 'Toko Jaya',
      invoice_no: 'INV-001',
      amount: '4.200.000',
    },
    // Go: DefaultPaymentVerifiedTemplate
    defaultContent:
      'Halo {customer_nama} 👋, pembayaran untuk invoice #{invoice_no} sudah kami terima dan verifikasi.\n\nJumlah: Rp {amount}\n\nTerima kasih! Pesanan akan segera diproses 🙏 — {toko_nama}',
  },
  {
    id: 'dp_verified',
    label: 'DP Diverifikasi',
    group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' },
      { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' },
      { key: 'sisa_amount', label: 'Sisa Rp' },
      { key: 'due_date', label: 'Deadline' },
    ],
    sampleData: {
      customer_nama: 'Pak Budi',
      toko_nama: 'Toko Jaya',
      invoice_no: 'INV-001',
      sisa_amount: '2.100.000',
      due_date: '25 Jul 2026',
    },
    // Go: DefaultDPVerifiedTemplate
    defaultContent:
      'Halo {customer_nama} 👋, DP untuk invoice #{invoice_no} sudah kami terima.\n\nSisa: Rp {sisa_amount}\nDeadline pelunasan: {due_date}\n\nTerima kasih 🙏 — {toko_nama}',
  },
  {
    id: 'payment_rejected',
    label: 'Pembayaran Ditolak',
    group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' },
      { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' },
      { key: 'reason', label: 'Alasan' },
    ],
    sampleData: {
      customer_nama: 'Pak Budi',
      toko_nama: 'Toko Jaya',
      invoice_no: 'INV-001',
      reason: 'Nominal transfer tidak sesuai',
    },
    // Go: DefaultPaymentRejectedTemplate
    defaultContent:
      'Halo {customer_nama}, mohon maaf pembayaran untuk invoice #{invoice_no} belum bisa kami verifikasi.\n\nAlasan: {reason}\n\nSilakan cek dan kirim ulang bukti transfer. Terima kasih 🙏 — {toko_nama}',
  },
  {
    id: 'order_approved',
    label: 'Order Disetujui',
    group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' },
      { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' },
    ],
    sampleData: {
      customer_nama: 'Pak Budi',
      toko_nama: 'Toko Jaya',
      invoice_no: 'INV-001',
    },
    // Go: DefaultOrderApprovedTemplate
    defaultContent:
      'Halo {customer_nama} 👋, order kamu #{invoice_no} sudah kami approve!\n\nKami akan proses secepatnya. Terima kasih 🙏 — {toko_nama}',
  },
  {
    id: 'order_shipped',
    label: 'Order Dikirim',
    group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' },
      { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' },
    ],
    sampleData: {
      customer_nama: 'Pak Budi',
      toko_nama: 'Toko Jaya',
      invoice_no: 'INV-001',
    },
    // Go: DefaultOrderShippedTemplate
    defaultContent:
      'Halo {customer_nama} 📦, pesanan #{invoice_no} Anda sudah selesai kami proses!\n\nMohon dicek ya. Kalau ada pertanyaan balas pesan ini. Terima kasih 🙏 — {toko_nama}',
  },
  {
    id: 'booking_expiry',
    label: 'Reminder Booking Expiry',
    group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' },
      { key: 'toko_nama', label: 'Nama Toko' },
      { key: 'invoice_no', label: 'Nomor Invoice' },
    ],
    sampleData: {
      customer_nama: 'Pak Budi',
      toko_nama: 'Toko Jaya',
      invoice_no: 'INV-001',
    },
    // Go: booking_expiry.go fmt.Sprintf (no const) — reconstructed verbatim
    defaultContent:
      'Halo {customer_nama} 👋,\n\nPesanan #{invoice_no} di {toko_nama} akan expired dalam 24 jam ke depan. Kalau mau lanjut pembayaran, silakan chat kami. Kalau tidak, pesanan akan dibatalkan otomatis.\n\nTerima kasih 🙏',
  },
  {
    id: 'followup_customer',
    label: 'Follow-up Silent Customer',
    group: 'customer',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' },
      { key: 'toko_nama', label: 'Nama Toko' },
    ],
    sampleData: { customer_nama: 'Pak Budi', toko_nama: 'Toko Jaya' },
    defaultContent:
      'Halo {customer_nama} 👋, sudah lama tidak dengar kabar. Ada yang bisa kami bantu? Kalau ada order baru langsung chat aja. Terima kasih 🙏 — {toko_nama}',
  },
  {
    id: 'staff_escalation_payment',
    label: 'Escalation Pembayaran',
    group: 'staff',
    variables: [
      { key: 'customer_nama', label: 'Nama Customer' },
      { key: 'invoice_no', label: 'Nomor Invoice' },
      { key: 'reason', label: 'Alasan' },
    ],
    sampleData: {
      customer_nama: 'Pak Budi',
      invoice_no: 'INV-001',
      reason: 'Nominal transfer tidak match',
    },
    defaultContent:
      '🚨 Escalation: pembayaran {invoice_no} dari {customer_nama} butuh verifikasi manual.\n\nAlasan: {reason}\n\nBuka Sales Inbox untuk cek bukti transfer.',
  },
  {
    id: 'heartbeat_digest',
    label: 'Ringkasan Harian Owner',
    group: 'staff',
    variables: [
      { key: 'tanggal', label: 'Tanggal' },
      { key: 'omset_hari', label: 'Omset Hari' },
      { key: 'laba_hari', label: 'Laba Hari' },
      { key: 'low_stock_count', label: 'Jumlah Stok Menipis' },
    ],
    sampleData: {
      tanggal: '19 Jul 2026',
      omset_hari: '5.000.000',
      laba_hari: '1.250.000',
      low_stock_count: '3',
    },
    // Go: heartbeat_digest.go strings.Builder (no const) — spec canonical string
    defaultContent:
      '📊 *Ringkasan Hari Ini — {tanggal}*\n\n💰 Omset: Rp {omset_hari}\n💵 Laba: Rp {laba_hari}\n\n⚠️ Stok menipis: {low_stock_count} item',
  },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function NotificationTemplatesScreen() {
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string>(TEMPLATES[0].id);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await supabase
        .from('tenant_notification_templates')
        .select('template_id, content');
      if (cancelled) return;
      if (error) {
        captureError(error, { feature: 'notification_templates', action: 'fetch_templates' });
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      const map = (data || []).reduce<Record<string, string>>(
        (acc, row) => ({ ...acc, [row.template_id as string]: row.content as string }),
        {},
      );
      setTemplates(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const selected = TEMPLATES.find((t) => t.id === selectedId)!;
  const currentContent = templates[selectedId] ?? selected.defaultContent;

  async function saveTemplate(contentOverride?: string) {
    const contentToSave = contentOverride ?? currentContent;
    setSaveState('saving');
    const { error } = await supabase
      .from('tenant_notification_templates')
      .upsert(
        { template_id: selectedId, content: contentToSave },
        { onConflict: 'tenant_id,template_id' },
      );
    if (error) {
      captureError(error, { feature: 'notification_templates', action: 'save_template', templateId: selectedId });
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
      return;
    }
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 2000);
  }

  function handleChange(value: string) {
    setTemplates((prev) => ({ ...prev, [selectedId]: value }));
  }

  function handleBlur() {
    void saveTemplate();
  }

  function resetDefault() {
    const next = { ...templates, [selectedId]: selected.defaultContent };
    setTemplates(next);
    void saveTemplate(selected.defaultContent);
  }

  async function sendTest() {
    setTestSending(true);
    const { error } = await supabase.rpc('send_notification_test', {
      p_template_id: selectedId,
    });
    if (error) {
      alert('Gagal kirim tes: ' + error.message);
    } else {
      alert('✓ Terkirim! Cek WhatsApp kamu.');
    }
    setTestSending(false);
  }

  function handleRestore(content: string) {
    const next = { ...templates, [selectedId]: content };
    setTemplates(next);
    setHistoryOpen(false);
    void saveTemplate(content);
  }

  const saveIndicatorText =
    saveState === 'saved' ? '✓ Tersimpan otomatis' :
    saveState === 'saving' ? '⏳ Menyimpan...' :
    saveState === 'error' ? '⚠️ Gagal simpan — coba lagi' :
    '';

  if (loading) {
    return (
      <div className="nts-loading" role="status" aria-busy="true">
        Memuat template...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="nts-error" role="alert">
        <strong>Gagal memuat template:</strong> {loadError}
      </div>
    );
  }

  const customerTemplates = TEMPLATES.filter((t) => t.group === 'customer');
  const staffTemplates = TEMPLATES.filter((t) => t.group === 'staff');

  return (
    <div className="nts-screen">
      {/* ── Header ── */}
      <header className="nts-header">
        <div className="nts-header-top">
          <button
            type="button"
            className="nts-back-btn"
            onClick={() => navigate('settings')}
            aria-label="Kembali ke Pengaturan"
          >
            ← Pengaturan
          </button>
        </div>
        <h1 className="nts-title">Template Notifikasi WhatsApp</h1>
        <p className="nts-subtitle">
          Kustomisasi semua pesan otomatis yang dikirim ke customer dan staff. Perubahan tersimpan otomatis.
        </p>
      </header>

      {/* ── Main grid ── */}
      <div className="nts-grid">
        {/* Sidebar */}
        <aside className="nts-sidebar">
          <div className="nts-group-label">Untuk Customer</div>
          {customerTemplates.map((t) => {
            const isCustomized = templates[t.id] != null && templates[t.id] !== t.defaultContent;
            return (
              <button
                key={t.id}
                type="button"
                className={`nts-sidebar-btn${selectedId === t.id ? ' nts-sidebar-btn--active' : ''}`}
                onClick={() => setSelectedId(t.id)}
              >
                <span className="nts-sidebar-label">{t.label}</span>
                {isCustomized && (
                  <span className="nts-edited-badge" title="Sudah dikustomisasi">✏️</span>
                )}
              </button>
            );
          })}

          <div className="nts-group-label nts-group-label--mt">Untuk Staff &amp; Owner</div>
          {staffTemplates.map((t) => {
            const isCustomized = templates[t.id] != null && templates[t.id] !== t.defaultContent;
            return (
              <button
                key={t.id}
                type="button"
                className={`nts-sidebar-btn${selectedId === t.id ? ' nts-sidebar-btn--active' : ''}`}
                onClick={() => setSelectedId(t.id)}
              >
                <span className="nts-sidebar-label">{t.label}</span>
                {isCustomized && (
                  <span className="nts-edited-badge" title="Sudah dikustomisasi">✏️</span>
                )}
              </button>
            );
          })}
        </aside>

        {/* Editor panel */}
        <main className="nts-editor">
          <h2 className="nts-editor-title">{selected.label}</h2>

          {saveIndicatorText && (
            <div
              className={`nts-save-indicator nts-save-indicator--${saveState}`}
              role="status"
              aria-live="polite"
            >
              {saveIndicatorText}
            </div>
          )}

          <div className="nts-editor-grid">
            <div className="nts-editor-col">
              <TemplateChipInput
                variables={selected.variables}
                value={currentContent}
                onChange={handleChange}
                onBlur={handleBlur}
              />
              <div className="nts-btn-row">
                <button
                  type="button"
                  className="nts-btn nts-btn--secondary"
                  onClick={resetDefault}
                >
                  🔄 Reset ke default
                </button>
                <button
                  type="button"
                  className="nts-btn nts-btn--primary"
                  onClick={() => void sendTest()}
                  disabled={testSending}
                >
                  {testSending ? '⏳ Mengirim...' : '📱 Kirim tes ke HP saya'}
                </button>
                <button
                  type="button"
                  className="nts-btn nts-btn--secondary"
                  onClick={() => setHistoryOpen(true)}
                >
                  📜 Riwayat perubahan
                </button>
              </div>
            </div>
            <div className="nts-preview-col">
              <TemplatePreview template={currentContent} sampleData={selected.sampleData} />
            </div>
          </div>
        </main>
      </div>

      {/* ── History modal ── */}
      {historyOpen && (
        <TemplateHistoryModal
          templateId={selectedId}
          onClose={() => setHistoryOpen(false)}
          onRestore={handleRestore}
        />
      )}

      <style>{`
        .nts-screen {
          max-width: 1200px;
          margin: 0 auto;
          padding: 24px;
          font-family: 'Inter', sans-serif;
        }
        .nts-loading, .nts-error {
          padding: 32px;
          text-align: center;
          color: #475569;
          font-size: 14px;
        }
        .nts-error { color: #991B1B; }

        /* Header */
        .nts-header { margin-bottom: 24px; }
        .nts-header-top { margin-bottom: 8px; }
        .nts-back-btn {
          background: none;
          border: none;
          color: #475569;
          font-size: 13px;
          cursor: pointer;
          padding: 4px 0;
          text-decoration: underline;
        }
        .nts-back-btn:hover { color: #0B2545; }
        .nts-title {
          font-size: 22px;
          font-weight: 700;
          color: #0B2545;
          margin: 0 0 6px;
        }
        .nts-subtitle {
          font-size: 14px;
          color: #64748B;
          margin: 0;
          line-height: 1.5;
        }

        /* Main grid */
        .nts-grid {
          display: grid;
          grid-template-columns: 260px 1fr;
          gap: 24px;
          align-items: start;
        }
        @media (max-width: 900px) {
          .nts-grid { grid-template-columns: 1fr; }
        }

        /* Sidebar */
        .nts-sidebar {
          border-right: 1px solid #E2E8F0;
          padding-right: 16px;
        }
        @media (max-width: 900px) {
          .nts-sidebar {
            border-right: none;
            border-bottom: 1px solid #E2E8F0;
            padding-right: 0;
            padding-bottom: 16px;
          }
        }
        .nts-group-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #94A3B8;
          margin: 8px 0 6px 12px;
        }
        .nts-group-label--mt { margin-top: 20px; }
        .nts-sidebar-btn {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          text-align: left;
          padding: 10px 12px;
          background: white;
          border: 1px solid transparent;
          border-radius: 8px;
          margin-bottom: 2px;
          cursor: pointer;
          font-size: 13px;
          color: #334155;
          transition: background 0.1s, border-color 0.1s;
        }
        .nts-sidebar-btn:hover { background: #F8FAFC; border-color: #E2E8F0; }
        .nts-sidebar-btn--active {
          background: #F0F9FF;
          border-color: #0EA5E9;
          color: #0369A1;
          font-weight: 600;
        }
        .nts-sidebar-label { flex: 1; }
        .nts-edited-badge { font-size: 12px; margin-left: 6px; }

        /* Editor */
        .nts-editor-title {
          font-size: 18px;
          font-weight: 700;
          color: #0B2545;
          margin: 0 0 12px;
        }
        .nts-save-indicator {
          display: inline-block;
          font-size: 12px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: 6px;
          margin-bottom: 12px;
        }
        .nts-save-indicator--saved { background: #DCFCE7; color: #166534; }
        .nts-save-indicator--saving { background: #FEF9C3; color: #854D0E; }
        .nts-save-indicator--error { background: #FEE2E2; color: #991B1B; }

        .nts-editor-grid {
          display: grid;
          grid-template-columns: 3fr 2fr;
          gap: 24px;
        }
        @media (max-width: 1024px) {
          .nts-editor-grid { grid-template-columns: 1fr; }
        }

        .nts-btn-row {
          display: flex;
          gap: 8px;
          margin-top: 12px;
          flex-wrap: wrap;
        }
        .nts-btn {
          padding: 8px 14px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, opacity 0.15s;
        }
        .nts-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .nts-btn--secondary {
          border: 1px solid #CBD5E1;
          background: white;
          color: #475569;
        }
        .nts-btn--secondary:hover:not(:disabled) { background: #F8FAFC; }
        .nts-btn--primary {
          border: 1px solid #8B5CF6;
          background: #8B5CF6;
          color: white;
        }
        .nts-btn--primary:hover:not(:disabled) { background: #7C3AED; }
      `}</style>
    </div>
  );
}
