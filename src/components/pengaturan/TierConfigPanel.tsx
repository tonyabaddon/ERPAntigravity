import { useState, useEffect } from 'react';
import type { DbTenantSettings } from '../../types';
import { tenantSettingsService } from '../../lib/pengaturan/pengaturanServices';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import { captureError } from '../../lib/captureError';

interface Props {
  tenantSettings: DbTenantSettings;
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

/**
 * Owner-only panel to configure the 2-4 pricing tier labels per tenant.
 * Gated at the parent level (only rendered when modul_multi_tier_price = TRUE).
 * Tier 1 and Tier 2 labels are required; Tier 3 and Tier 4 are optional
 * (empty = disabled tier, pills hidden across app).
 */
export default function TierConfigPanel({ tenantSettings, onSaved, showToast }: Props) {
  const [t1, setT1] = useState(tenantSettings.tier_1_label);
  const [t2, setT2] = useState(tenantSettings.tier_2_label);
  const [t3, setT3] = useState(tenantSettings.tier_3_label ?? '');
  const [t4, setT4] = useState(tenantSettings.tier_4_label ?? '');
  const [saving, setSaving] = useState(false);

  // Observability: entry breadcrumb on mount (once per panel open)
  useEffect(() => {
    console.info('[tier_config_panel_open]', {
      feature: 'tier_config',
      action: 'open',
    });
  }, []);

  function friendlyError(err: unknown): string {
    const raw = extractErrorMessage(err);
    if (raw.includes('TCFG_LABEL_INVALID')) {
      // Extract hint from Postgres error object if present
      const hint = (err as { hint?: string })?.hint ?? '';
      const which = hint === 'tier_1' ? 'Tier 1'
                  : hint === 'tier_2' ? 'Tier 2'
                  : hint === 'tier_3' ? 'Tier 3'
                  : hint === 'tier_4' ? 'Tier 4'
                  : 'Label tier';
      return `${which} harus 3-30 karakter.`;
    }
    if (raw.includes('TCFG_LABEL_DUPLICATE')) {
      return 'Label tier duplikat — semua label harus unik.';
    }
    if (raw.includes('TCFG_FORBIDDEN')) {
      return 'Hanya Owner yang bisa mengubah tingkat harga.';
    }
    return `Gagal simpan tingkat harga: ${raw}`;
  }

  async function onSave() {
    setSaving(true);
    try {
      await tenantSettingsService.updateTierConfig({
        tier_1_label: t1.trim(),
        tier_2_label: t2.trim(),
        tier_3_label: t3.trim() || null,
        tier_4_label: t4.trim() || null,
      });
      // Observability: usage counter log
      console.info('[tier_config] updated', {
        tenant_id: tenantSettings.tenant_id,
        feature: 'tier_config',
        action: 'update',
        tier_count: 2 + (t3.trim() ? 1 : 0) + (t4.trim() ? 1 : 0),
      });
      showToast('Tingkat harga tersimpan.', 'success');
      onSaved();
    } catch (err) {
      captureError(err, { feature: 'tier_config', action: 'update' });
      showToast(friendlyError(err), 'warning');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-sm border border-gray-200 p-6 space-y-4">
      <div>
        <h2 className="text-base font-extrabold text-[var(--color-caleo-primary)]">Tingkat Harga</h2>
        <p className="text-[11px] text-slate-500 mt-1">
          Owner bisa set 2-4 tingkat harga per SKU. Tier 1 &amp; 2 wajib; Tier 3 &amp; 4 opsional (kosongkan = off).
        </p>
      </div>

      <div className="space-y-3 max-w-md">
        <label className="block">
          <span className="text-xs font-bold text-slate-700">Tier 1 (Base) <span className="text-red-500">*</span></span>
          <input
            value={t1}
            onChange={e => setT1(e.target.value)}
            aria-label="Tier 1"
            className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-sm text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-700">Tier 2 <span className="text-red-500">*</span></span>
          <input
            value={t2}
            onChange={e => setT2(e.target.value)}
            aria-label="Tier 2"
            className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-sm text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-700">Tier 3 <span className="text-slate-400 font-normal">Opsional</span></span>
          <input
            value={t3}
            onChange={e => setT3(e.target.value)}
            aria-label="Tier 3"
            placeholder="Kosongkan untuk menonaktifkan"
            className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-sm text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-700">Tier 4 <span className="text-slate-400 font-normal">Opsional</span></span>
          <input
            value={t4}
            onChange={e => setT4(e.target.value)}
            aria-label="Tier 4"
            placeholder="Kosongkan untuk menonaktifkan"
            className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-sm text-sm"
          />
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 text-xs font-bold rounded-sm bg-[var(--color-caleo-primary)] text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </div>
  );
}
