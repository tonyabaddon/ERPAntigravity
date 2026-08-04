import { useState } from 'react';
import type { StoreSettings } from '../../lib/pengaturan/types';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

interface Props {
  settings: StoreSettings;
  onSave: (updates: Partial<StoreSettings>) => Promise<void>;
}

export function SalesOrderDefaultsPanel({ settings, onSave }: Props) {
  const [validityDays, setValidityDays] = useState(settings.default_so_validity_days ?? 14);
  const [openingGreeting, setOpeningGreeting] = useState(settings.default_opening_greeting ?? '');
  const [paymentTerms, setPaymentTerms] = useState(settings.default_payment_terms ?? '');
  const [leadTime, setLeadTime] = useState(settings.default_lead_time_text ?? '');
  const [soNotes, setSoNotes] = useState(settings.default_so_notes ?? '');
  const [signatoryName, setSignatoryName] = useState(settings.default_signatory_name ?? '');
  const [signatoryTitle, setSignatoryTitle] = useState(settings.default_signatory_title ?? '');
  const [showTelpKantor, setShowTelpKantor] = useState(settings.footer_show_telp_kantor ?? true);
  const [showWa, setShowWa] = useState(settings.footer_show_wa ?? true);
  const [showEmail, setShowEmail] = useState(settings.footer_show_email ?? true);
  const [showWebsite, setShowWebsite] = useState(settings.footer_show_website ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        default_so_validity_days: validityDays || 14,
        default_opening_greeting: openingGreeting.trim() || null,
        default_payment_terms: paymentTerms.trim() || null,
        default_lead_time_text: leadTime.trim() || null,
        default_so_notes: soNotes.trim() || null,
        default_signatory_name: signatoryName.trim() || null,
        default_signatory_title: signatoryTitle.trim() || null,
        footer_show_telp_kantor: showTelpKantor,
        footer_show_wa: showWa,
        footer_show_email: showEmail,
        footer_show_website: showWebsite,
      });
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2';

  return (
    <div className="bg-white rounded border border-[var(--color-caleo-mist)] p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base font-extrabold text-[var(--color-caleo-primary)]">Default Penawaran (SO)</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Nilai default untuk cetak Sales Order / Penawaran. Dapat di-override per dokumen.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Masa Berlaku */}
        <div>
          <label htmlFor="so-validity-days" className="block text-xs font-bold text-slate-600 mb-1">
            Masa Berlaku Penawaran (hari)
          </label>
          <input
            id="so-validity-days"
            type="number"
            min={1}
            max={365}
            value={validityDays}
            onChange={(e) => setValidityDays(e.target.valueAsNumber || 14)}
            className="w-32 border border-slate-200 rounded px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caleo-gold focus-visible:ring-offset-2"
            disabled={saving}
          />
        </div>

        {/* Nama Penandatangan */}
        <div>
          <label htmlFor="so-signatory-name" className="block text-xs font-bold text-slate-600 mb-1">
            Nama Penandatangan Default
          </label>
          <input
            id="so-signatory-name"
            type="text"
            value={signatoryName}
            onChange={(e) => setSignatoryName(e.target.value)}
            className={inputCls}
            disabled={saving}
          />
        </div>

        {/* Jabatan Penandatangan */}
        <div>
          <label htmlFor="so-signatory-title" className="block text-xs font-bold text-slate-600 mb-1">
            Jabatan Penandatangan
          </label>
          <input
            id="so-signatory-title"
            type="text"
            value={signatoryTitle}
            onChange={(e) => setSignatoryTitle(e.target.value)}
            placeholder="Sales Engineer"
            className={inputCls}
            disabled={saving}
          />
        </div>

        {/* Cara Pembayaran */}
        <div>
          <label htmlFor="so-payment-terms" className="block text-xs font-bold text-slate-600 mb-1">
            Cara Pembayaran
          </label>
          <textarea
            id="so-payment-terms"
            rows={2}
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            className={`${inputCls} resize-none`}
            disabled={saving}
          />
        </div>

        {/* Waktu Pengadaan */}
        <div>
          <label htmlFor="so-lead-time" className="block text-xs font-bold text-slate-600 mb-1">
            Waktu Pengadaan
          </label>
          <textarea
            id="so-lead-time"
            rows={2}
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
            className={`${inputCls} resize-none`}
            disabled={saving}
          />
        </div>

        {/* Kalimat Pembuka */}
        <div className="md:col-span-2">
          <label htmlFor="so-opening-greeting" className="block text-xs font-bold text-slate-600 mb-1">
            Kalimat Pembuka
          </label>
          <textarea
            id="so-opening-greeting"
            rows={3}
            value={openingGreeting}
            onChange={(e) => setOpeningGreeting(e.target.value)}
            className={`${inputCls} resize-none`}
            disabled={saving}
          />
        </div>

        {/* Catatan Default */}
        <div className="md:col-span-2">
          <label htmlFor="so-notes" className="block text-xs font-bold text-slate-600 mb-1">
            Catatan Default
          </label>
          <textarea
            id="so-notes"
            rows={4}
            value={soNotes}
            onChange={(e) => setSoNotes(e.target.value)}
            className={`${inputCls} resize-none`}
            disabled={saving}
          />
        </div>
      </div>

      {/* Footer toggles */}
      <fieldset className="mt-4 border-t border-slate-100 pt-4">
        <legend className="text-xs font-bold text-slate-600 mb-2">Footer PDF — Tampilkan Kontak</legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showTelpKantor}
              onChange={(e) => setShowTelpKantor(e.target.checked)}
              disabled={saving}
            />
            Telepon Kantor
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showWa}
              onChange={(e) => setShowWa(e.target.checked)}
              disabled={saving}
            />
            WhatsApp
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showEmail}
              onChange={(e) => setShowEmail(e.target.checked)}
              disabled={saving}
            />
            Email
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showWebsite}
              onChange={(e) => setShowWebsite(e.target.checked)}
              disabled={saving}
            />
            Tampilkan Website
          </label>
        </div>
      </fieldset>

      {error && (
        <p className="text-caleo-danger text-sm mt-3">{error}</p>
      )}

      <div className="flex justify-end mt-6">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-[var(--color-caleo-primary)] text-white rounded-full text-xs font-bold disabled:opacity-50 hover:bg-[#01365e]"
        >
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </div>
  );
}
