// src/components/admin/TenantDetail/ModuleTogglePanel.tsx
// "Pengaturan Modul" — per-module feature toggle for a tenant.
// Reads effective_features from v_tenant_effective_features (plan bundle ||
// per-tenant overrides), renders one row per module with a toggle switch.
// Toggle → update_tenant_feature_override RPC → optimistic update + rollback
// on error.
// Visible to BOTH super_admin and sales_rep (no role gate here).
// VOSI tokens: navy heading, gold accent bar, no red.
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { adminToast } from '../../../lib/adminToast';

// ─── VOSI color constants ─────────────────────────────────────────────────────

const C = {
  navy:    '#0B2545',
  gold:    '#F9B233',
  slate:   '#5A6472',
  muted:   '#9DB2CE',
  surface: '#ECEEF1',
  border:  '#ECEEF1',
  bg:      '#ffffff',
} as const;

// ─── Module labels (Bahasa Indonesia) ────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  modul_kasir:           'Kasir (POS)',
  modul_tempo:           'Piutang Tempo',
  modul_akuntansi:       'Akuntansi',
  modul_bom_recipe:      'BOM / Racikan',
  modul_pengiriman:      'Pengiriman',
  modul_diskon_kasir:    'Diskon Kasir',
  modul_jasa_layanan:    'Jasa Layanan',
  modul_diskon_tagihan:  'Diskon Tagihan',
  modul_multi_warehouse: 'Multi Warehouse',
  modul_diskon_penjualan:'Diskon Penjualan',
  modul_multi_tier_price:'Multi-Tier Price',
};

function moduleLabel(key: string): string {
  return MODULE_LABELS[key] ?? key.replace(/_/g, ' ');
}

// ─── Toggle switch primitive ──────────────────────────────────────────────────

interface ToggleSwitchProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}

function ToggleSwitch({ checked, disabled, onChange, label }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex flex-shrink-0 h-5 w-9 rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1"
      style={{
        background: checked ? C.gold : C.surface,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        borderColor: checked ? C.gold : C.border,
        boxShadow: `0 0 0 0`,
      }}
    >
      <span
        className="inline-block h-4 w-4 rounded-full shadow transform transition-transform duration-150"
        style={{
          background: '#ffffff',
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  tenantId: string;
}

// ─── ModuleTogglePanel ────────────────────────────────────────────────────────

export function ModuleTogglePanel({ tenantId }: Props) {
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [togglingKeys, setTogglingKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function load() {
      if (!supabase) return;
      const { data, error } = await supabase
        .from('v_tenant_effective_features')
        .select('effective_features')
        .eq('tenant_id', tenantId)
        .single();

      if (cancelled) return;
      if (error) {
        setLoadError(error.message ?? 'Gagal memuat fitur.');
        return;
      }
      const ef = (data as { effective_features: Record<string, boolean> } | null)
        ?.effective_features ?? {};
      setFeatures(ef);
    }

    load();
    return () => { cancelled = true; };
  }, [tenantId]);

  async function toggle(moduleKey: string, current: boolean) {
    if (!supabase) return;
    const nextValue = !current;

    // Optimistic update
    setFeatures(prev => prev ? { ...prev, [moduleKey]: nextValue } : prev);
    setTogglingKeys(prev => new Set(prev).add(moduleKey));

    const { error } = await supabase.rpc('update_tenant_feature_override', {
      p_tenant_id:  tenantId,
      p_module_key: moduleKey,
      p_enabled:    nextValue,
      p_reason:     null,
    });

    setTogglingKeys(prev => {
      const next = new Set(prev);
      next.delete(moduleKey);
      return next;
    });

    if (error) {
      // Rollback optimistic update
      setFeatures(prev => prev ? { ...prev, [moduleKey]: current } : prev);
      adminToast.error('Gagal update modul', error.message ?? String(error));
    } else {
      adminToast.success(nextValue ? 'Modul diaktifkan' : 'Modul dimatikan');
    }
  }

  // ─── States ────────────────────────────────────────────────────────────────

  const moduleEntries = features ? Object.entries(features) : [];

  return (
    <section
      className="border rounded-sm p-5 mt-4"
      style={{ borderColor: C.border, background: C.bg }}
      data-testid="module-toggle-panel"
      aria-label="Pengaturan Modul"
    >
      {/* Gold accent bar + heading */}
      <div className="flex items-center gap-3 mb-1">
        <div
          className="w-1 h-5 rounded-full flex-shrink-0"
          style={{ background: C.gold }}
          aria-hidden="true"
        />
        <h2
          className="text-[14px] font-bold"
          style={{ color: C.navy, fontFamily: 'var(--font-caleo, inherit)' }}
        >
          Pengaturan Modul
        </h2>
      </div>
      <p
        className="text-[12px] mb-4 ml-4"
        style={{ color: C.slate }}
      >
        Aktifkan atau matikan modul untuk tenant ini. Override paket default.
      </p>

      {/* Load error */}
      {loadError && (
        <p
          className="text-[12px] px-3 py-2 rounded-sm mb-3"
          style={{ background: '#fff7ed', color: '#92400e' }}
          data-testid="module-toggle-error"
        >
          {loadError}
        </p>
      )}

      {/* Loading skeleton */}
      {features === null && !loadError && (
        <p
          className="text-[12px] animate-pulse"
          style={{ color: C.muted }}
          data-testid="module-toggle-loading"
        >
          Memuat modul…
        </p>
      )}

      {/* Empty state */}
      {features !== null && moduleEntries.length === 0 && (
        <p
          className="text-[12px]"
          style={{ color: C.muted }}
          data-testid="module-toggle-empty"
        >
          Tidak ada modul terdaftar.
        </p>
      )}

      {/* Module rows */}
      {moduleEntries.length > 0 && (
        <div
          className="divide-y"
          style={{ borderColor: C.border }}
          data-testid="module-toggle-list"
        >
          {moduleEntries.map(([key, rawEnabled]) => {
            const enabled = Boolean(rawEnabled);
            return (
              <div
                key={key}
                className="flex items-center justify-between py-2.5 px-1"
                data-testid={`module-row-${key}`}
              >
                <div>
                  <p
                    className="text-[13px] font-medium"
                    style={{ color: C.navy }}
                  >
                    {moduleLabel(key)}
                  </p>
                  <p
                    className="text-[11px]"
                    style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    {key}
                  </p>
                </div>
                <ToggleSwitch
                  checked={enabled}
                  disabled={togglingKeys.has(key)}
                  onChange={() => toggle(key, enabled)}
                  label={`Toggle ${moduleLabel(key)}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
