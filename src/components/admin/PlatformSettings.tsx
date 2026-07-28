// src/components/admin/PlatformSettings.tsx
// /admin/settings/payment — super_admin-only page to edit VOSI bank + WA info.
// Pattern: useEffect + async fetch + skeleton (mirrors SalesRepsList.tsx).
import React, { useEffect, useState } from 'react';
import { platformSettingsApi } from '../../lib/platformSettingsApi';
import type { PlatformSettings as PlatformSettingsRow } from '../../lib/platformSettingsApi';
import { adminToast } from '../../lib/adminToast';
import { extractErrorMessage } from '../../lib/extractErrorMessage';

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function FormSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {[0, 1, 2, 3].map((i) => (
        <div key={i}>
          <div className="h-3 w-32 rounded mb-1.5" style={{ background: '#ECEEF1' }} />
          <div className="h-10 rounded-xl" style={{ background: '#ECEEF1' }} />
        </div>
      ))}
      <div className="h-10 w-28 rounded-xl" style={{ background: '#ECEEF1' }} />
    </div>
  );
}

// ─── PlatformSettings ─────────────────────────────────────────────────────────

export function PlatformSettings() {
  const [settings, setSettings] = useState<PlatformSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form field state — mirrors the 4 editable columns
  const [bankName, setBankName] = useState('');
  const [bankAccountNo, setBankAccountNo] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [adminWaNumber, setAdminWaNumber] = useState('');

  // ─── Fetch on mount ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function fetchSettings() {
      setLoading(true);
      try {
        const data = await platformSettingsApi.get();
        if (cancelled) return;
        setSettings(data);
        setBankName(data.bank_name ?? '');
        setBankAccountNo(data.bank_account_no ?? '');
        setBankAccountName(data.bank_account_name ?? '');
        setAdminWaNumber(data.admin_wa_number ?? '');
      } catch (err) {
        if (cancelled) return;
        const msg = extractErrorMessage(err);
        adminToast.error('Gagal memuat pengaturan pembayaran', msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchSettings();
    return () => { cancelled = true; };
  }, []);

  // ─── Save ──────────────────────────────────────────────────────────────────

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await platformSettingsApi.update({
        bank_name: bankName || null,
        bank_account_no: bankAccountNo || null,
        bank_account_name: bankAccountName || null,
        admin_wa_number: adminWaNumber || null,
      });
      setSettings(updated);
      adminToast.success('Pengaturan pembayaran tersimpan.');
    } catch (err) {
      const msg = extractErrorMessage(err);
      adminToast.error('Gagal menyimpan pengaturan', msg);
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-xl font-vosi" style={{ color: '#0B2545' }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: '#0B2545' }}>
          Pengaturan Pembayaran
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: '#64748B' }}>
          Informasi bank + WhatsApp yang tampil di instruksi pembayaran ke customer
          setelah onboarding tenant.
        </p>
        {settings?.updated_at && (
          <p className="mt-1 text-[11px]" style={{ color: '#9DB2CE' }}>
            Terakhir diperbarui:{' '}
            {new Date(settings.updated_at).toLocaleString('id-ID', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        )}
      </div>

      {/* Form */}
      {loading ? (
        <FormSkeleton />
      ) : (
        <form onSubmit={(e) => { void handleSave(e); }} className="space-y-4">
          {/* Nama Bank */}
          <div>
            <label
              htmlFor="bank-name"
              className="block text-[13px] font-medium mb-1"
              style={{ color: '#0B2545' }}
            >
              Nama Bank
            </label>
            <input
              id="bank-name"
              type="text"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="Contoh: BCA"
              className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2"
              style={{
                borderColor: '#ECEEF1',
                color: '#0B2545',
                background: '#FAFAFA',
              }}
              disabled={saving}
            />
          </div>

          {/* Nomor Rekening */}
          <div>
            <label
              htmlFor="bank-account-no"
              className="block text-[13px] font-medium mb-1"
              style={{ color: '#0B2545' }}
            >
              Nomor Rekening
            </label>
            <input
              id="bank-account-no"
              type="text"
              value={bankAccountNo}
              onChange={(e) => setBankAccountNo(e.target.value)}
              placeholder="1234567890"
              className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2"
              style={{
                borderColor: '#ECEEF1',
                color: '#0B2545',
                background: '#FAFAFA',
              }}
              disabled={saving}
            />
          </div>

          {/* Atas Nama */}
          <div>
            <label
              htmlFor="bank-account-name"
              className="block text-[13px] font-medium mb-1"
              style={{ color: '#0B2545' }}
            >
              Atas Nama
            </label>
            <input
              id="bank-account-name"
              type="text"
              value={bankAccountName}
              onChange={(e) => setBankAccountName(e.target.value)}
              placeholder="PT Caleo Digital"
              className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2"
              style={{
                borderColor: '#ECEEF1',
                color: '#0B2545',
                background: '#FAFAFA',
              }}
              disabled={saving}
            />
          </div>

          {/* Nomor WhatsApp Admin */}
          <div>
            <label
              htmlFor="admin-wa-number"
              className="block text-[13px] font-medium mb-1"
              style={{ color: '#0B2545' }}
            >
              Nomor WhatsApp Admin
            </label>
            <input
              id="admin-wa-number"
              type="text"
              value={adminWaNumber}
              onChange={(e) => setAdminWaNumber(e.target.value)}
              placeholder="+62812-3456-7890"
              className="w-full px-3 py-2 rounded-xl border text-[13px] outline-none focus:ring-2"
              style={{
                borderColor: '#ECEEF1',
                color: '#0B2545',
                background: '#FAFAFA',
              }}
              disabled={saving}
            />
          </div>

          {/* Save button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl text-[13px] font-semibold transition-opacity"
              style={{
                background: saving ? '#9DB2CE' : '#0B2545',
                color: '#FFFFFF',
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Menyimpan…' : 'Simpan'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
