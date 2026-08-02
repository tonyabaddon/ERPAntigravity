// src/components/admin/TenantDetail/OverviewTab.tsx
// 4-quadrant read-only tenant overview:
//   Profil | Paket & masa aktif | Aktivitas | Fitur aktif
// Receives tenant row from TenantDetailShell (reuses already-loaded AdminTenantRow).
// Fetches extra fields (annual_revenue_range + effective_features) via
// getTenantOverviewExtras — stored separately in company_settings +
// v_tenant_effective_features.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { RenewSubscriptionModal } from '../RenewSubscriptionModal';
import type { RenewSubscriptionResult } from '../../../lib/adminTypes';
import { getTenantOverviewExtras } from '../../../lib/adminApi';
import type { AdminTenantRow, TenantOverviewExtras } from '../../../lib/adminTypes';

// ─── VOSI color constants ─────────────────────────────────────────────────────

const C = {
  navy: '#0B2545',
  gold: '#F9B233',
  cream: '#FAF7F0',
  slate: '#5A6472',
  muted: '#9DB2CE',
  surface: '#ECEEF1',
  ink: '#14161B',
  success: '#1F8A5B',
  danger: '#C0392B',
  info: '#2A6FDB',
} as const;

// ─── Small primitives ─────────────────────────────────────────────────────────

function Em() {
  return (
    <span
      title="Belum diisi"
      style={{ color: C.muted, fontFamily: 'JetBrains Mono, monospace' }}
    >
      —
    </span>
  );
}

function Chip({
  children,
  gold = false,
}: {
  children: ReactNode;
  gold?: boolean;
}) {
  return (
    <span
      className="inline-block rounded-full text-[11px] font-semibold px-2 py-0.5"
      style={
        gold
          ? { background: C.gold, color: C.navy, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.05em' }
          : { background: '#EDF4FF', color: C.info }
      }
    >
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <td
        className="py-1 pr-3 align-top whitespace-nowrap text-[12px]"
        style={{ color: C.muted, width: '130px' }}
      >
        {label}
      </td>
      <td className="py-1 text-[13px]" style={{ color: C.ink }}>
        {children}
      </td>
    </tr>
  );
}

function Panel({
  title,
  children,
  headerAction,
}: {
  title: string;
  children: ReactNode;
  headerAction?: ReactNode;
}) {
  return (
    <div
      className="rounded p-4 border"
      style={{ background: '#ffffff', borderColor: C.surface }}
    >
      <div className="flex items-center justify-between mb-3">
        <div
          className="text-[11px] font-bold tracking-widest uppercase"
          style={{
            color: C.muted,
            fontFamily: 'JetBrains Mono, monospace',
            letterSpacing: '0.12em',
          }}
        >
          {title}
        </div>
        {headerAction}
      </div>
      <table className="w-full">
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// ─── Expiry state label ───────────────────────────────────────────────────────

function ExpiryStateBadge({ mode }: { mode: AdminTenantRow['expiry_mode'] }) {
  if (!mode) return <Em />;
  if (mode === 'ACTIVE') {
    return <span style={{ color: C.success, fontWeight: 600 }}>● Aktif</span>;
  }
  if (mode === 'GRACE') {
    return <span style={{ color: '#C98B00', fontWeight: 600 }}>● Grace period</span>;
  }
  // READONLY
  return <span style={{ color: C.danger, fontWeight: 600 }}>● Read-only</span>;
}

// ─── Usage status label ───────────────────────────────────────────────────────

function UsageStatusBadge({ status }: { status: AdminTenantRow['usage_status'] }) {
  const map: Record<AdminTenantRow['usage_status'], { label: string; color: string }> = {
    SANGAT_AKTIF: { label: 'Sangat aktif', color: C.success },
    AKTIF: { label: 'Aktif', color: C.info },
    IDLE: { label: 'Idle', color: '#C98B00' },
    VAKUM: { label: 'Vakum', color: C.danger },
  };
  const s = map[status];
  return <span style={{ color: s.color, fontWeight: 600 }}>● {s.label}</span>;
}

// ─── Date formatter ───────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// ─── Feature list display names ───────────────────────────────────────────────

const FEATURE_LABELS: Record<string, string> = {
  modul_kasir: 'Kasir (POS)',
  modul_tempo: 'Penjualan Tempo',
  modul_akuntansi: 'Akuntansi',
  modul_bom_recipe: 'BOM & Resep',
  modul_pengiriman: 'Pengiriman',
  modul_diskon_kasir: 'Diskon Kasir',
  modul_jasa_layanan: 'Jasa & Layanan',
  modul_diskon_tagihan: 'Diskon Tagihan',
  modul_multi_warehouse: 'Multi-Gudang',
  modul_diskon_penjualan: 'Diskon Penjualan',
  modul_multi_tier_price: 'Multi-Tier Harga',
};

function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key;
}

// ─── OverviewTab ──────────────────────────────────────────────────────────────

interface Props {
  tenant: AdminTenantRow;
  onDataChange?: () => void;
}

export function OverviewTab({ tenant, onDataChange }: Props) {
  const [extras, setExtras] = useState<TenantOverviewExtras | null>(null);
  const [loadingExtras, setLoadingExtras] = useState(true);
  const [isRenewOpen, setIsRenewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingExtras(true);
    getTenantOverviewExtras(tenant.tenant_id)
      .then((data) => {
        if (!cancelled) {
          setExtras(data);
          setLoadingExtras(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExtras({ annual_revenue_range: null, effective_features: null });
          setLoadingExtras(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tenant.tenant_id]);

  function handleRenewSuccess(_result: RenewSubscriptionResult) {
    setIsRenewOpen(false);
    onDataChange?.();
  }

  // ── Feature list (enabled then disabled) ───────────────────────────────────
  const featureEntries =
    extras?.effective_features != null
      ? Object.entries(extras.effective_features).sort(
          ([, a], [, b]) => Number(b) - Number(a),
        )
      : null;

  // ── Expiry row ──────────────────────────────────────────────────────────────
  const expiring =
    tenant.days_until_expiry !== null && tenant.days_until_expiry <= 45;

  return (
    <>
    <RenewSubscriptionModal
      open={isRenewOpen}
      tenant={tenant}
      onClose={() => setIsRenewOpen(false)}
      onSuccess={handleRenewSuccess}
    />
    <div
      className="grid grid-cols-2 gap-3"
      data-testid="overview-tab"
    >
      {/* ── Card 1: Profil ───────────────────────────────────────────────────── */}
      <Panel title="Profil">
        <Row label="Nama toko">{tenant.name}</Row>
        <Row label="Slug">
          <code
            className="text-[12px]"
            style={{ fontFamily: 'JetBrains Mono, monospace', color: C.slate }}
          >
            {tenant.slug}
          </code>
        </Row>
        <Row label="Industri">
          {tenant.industry ? <Chip>{tenant.industry}</Chip> : <Em />}
        </Row>
        <Row label="Jumlah karyawan">
          {tenant.employee_range ? <Chip>{tenant.employee_range}</Chip> : <Em />}
        </Row>
        <Row label="Omzet tahunan">
          {loadingExtras ? (
            <span style={{ color: C.muted, fontSize: '12px' }}>…</span>
          ) : extras?.annual_revenue_range ? (
            <Chip>{extras.annual_revenue_range}</Chip>
          ) : (
            <Em />
          )}
        </Row>
        <Row label="Bergabung">
          {fmtDate(tenant.onboarded_at) ?? <Em />}
        </Row>
      </Panel>

      {/* ── Card 2: Paket & masa aktif ────────────────────────────────────────── */}
      <Panel
        title="Paket & masa aktif"
        headerAction={
          <button
            type="button"
            onClick={() => setIsRenewOpen(true)}
            className="bg-caleo-gold text-caleo-navy font-extrabold rounded-full px-3 py-1 text-[11px] hover:opacity-90 transition-opacity"
            data-testid="perpanjang-cta"
          >
            Perpanjang
          </button>
        }
      >
        <Row label="Paket">
          {tenant.plan_code ? (
            <Chip gold>{tenant.plan_code}</Chip>
          ) : (
            <Em />
          )}
        </Row>
        <Row label="Aktif sejak">
          {fmtDate(tenant.activated_at) ?? <Em />}
        </Row>
        <Row label="Masa aktif s/d">
          {tenant.expires_at ? (
            <span
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                color: expiring ? C.danger : C.ink,
                fontWeight: expiring ? 600 : 400,
              }}
            >
              {tenant.expires_at}
              {expiring && tenant.days_until_expiry !== null && (
                <span
                  className="ml-1.5 text-[11px]"
                  style={{ color: C.danger }}
                >
                  ({tenant.days_until_expiry}d)
                </span>
              )}
            </span>
          ) : (
            <Em />
          )}
        </Row>
        <Row label="Status masa aktif">
          <ExpiryStateBadge mode={tenant.expiry_mode} />
        </Row>
      </Panel>

      {/* ── Card 3: Aktivitas ─────────────────────────────────────────────────── */}
      <Panel title="Aktivitas">
        <Row label="Login terakhir">
          {tenant.last_login_at ? (
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' }}>
              {fmtDate(tenant.last_login_at)}
            </span>
          ) : (
            <Em />
          )}
        </Row>
        <Row label="Transaksi 7 hari">
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {tenant.txn_7d}
          </span>
        </Row>
        <Row label="Rata-rata/hari">
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {tenant.avg_daily_txn.toFixed(1)}
          </span>
        </Row>
        <Row label="Status pemakaian">
          <UsageStatusBadge status={tenant.usage_status} />
        </Row>
        <Row label="Jumlah user">
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {tenant.user_count}
          </span>
        </Row>
        <Row label="Jumlah SKU">
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {tenant.sku_count}
          </span>
        </Row>
      </Panel>

      {/* ── Card 4: Fitur aktif ───────────────────────────────────────────────── */}
      <Panel title="Fitur aktif">
        {loadingExtras ? (
          <tr>
            <td
              colSpan={2}
              className="py-2 text-[12px]"
              style={{ color: C.muted }}
            >
              Memuat fitur…
            </td>
          </tr>
        ) : featureEntries === null || featureEntries.length === 0 ? (
          <tr>
            <td
              colSpan={2}
              className="py-2 text-[12px]"
              style={{ color: C.muted }}
            >
              Data fitur tidak tersedia.
            </td>
          </tr>
        ) : (
          featureEntries.map(([key, enabled]) => (
            <tr key={key}>
              <td
                colSpan={2}
                className="py-0.5 text-[12px]"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: enabled ? C.success : C.surface }}
                    aria-hidden="true"
                  />
                  <span style={{ color: enabled ? C.ink : C.muted }}>
                    {featureLabel(key)}
                  </span>
                  {!enabled && (
                    <span
                      className="text-[11px] ml-auto"
                      style={{ color: C.muted }}
                    >
                      nonaktif
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))
        )}
      </Panel>
    </div>
    </>
  );
}
