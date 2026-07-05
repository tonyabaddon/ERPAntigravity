// src/components/admin/PlansManagement.tsx
// Read-only Paket (plans) management page — Wave 1.
// Edit CTA disabled with Wave 4a tooltip; edit ships Wave 4a.
import { useEffect, useState } from 'react';
import { listPlansAdmin } from '../../lib/adminPlansApi';
import type { PlanRow } from '../../lib/adminPlansApi';
import { adminToast } from '../../lib/adminToast';

// ─── Module display labels (shared glossary) ──────────────────────────────────

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

// ─── PlanCard ──────────────────────────────────────────────────────────────────

interface PlanCardProps {
  plan: PlanRow;
}

function PlanCard({ plan }: PlanCardProps) {
  const enabledFeatures = Object.entries(plan.feature_bundle)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);

  return (
    <div
      className="relative flex flex-col bg-white border rounded-xl overflow-hidden"
      style={{
        borderColor: plan.is_recommended ? '#F9B233' : '#E2E8F0',
        borderWidth: plan.is_recommended ? '2px' : '1px',
        boxShadow: plan.is_recommended
          ? '0 8px 24px rgba(249,178,51,0.18)'
          : '0 2px 8px rgba(11,37,69,0.06)',
      }}
    >
      {/* PALING POPULER ribbon — gold, only on is_recommended=true */}
      {plan.is_recommended && (
        <div
          className="text-center text-[11px] font-bold tracking-widest py-1.5"
          style={{
            background: '#F9B233',
            color: '#0B2545',
            fontFamily: 'JetBrains Mono, monospace',
          }}
          data-testid="paling-populer-ribbon"
        >
          PALING POPULER
        </div>
      )}

      {/* Card body */}
      <div className="p-5 flex flex-col gap-3 flex-1">
        {/* Plan code + target */}
        <div>
          <h2
            className="text-[15px] font-bold leading-tight"
            style={{ color: '#0B2545' }}
          >
            {plan.code}
          </h2>
          {plan.target_segment && (
            <p className="text-[12px] mt-0.5" style={{ color: '#9DB2CE' }}>
              Untuk siapa: {plan.target_segment}
            </p>
          )}
        </div>

        {/* Description */}
        {plan.description && (
          <p className="text-[13px]" style={{ color: '#5A6472' }}>
            {plan.description}
          </p>
        )}

        {/* Tenant count pill */}
        <div
          className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-full self-start"
          style={{ background: '#ECEEF1', color: '#5A6472' }}
        >
          {plan.tenant_count} tenant aktif
        </div>

        {/* Feature bundle */}
        <div className="flex-1">
          <p
            className="text-[11px] font-bold uppercase tracking-widest mb-2"
            style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9DB2CE' }}
          >
            Fitur termasuk
          </p>
          {enabledFeatures.length === 0 ? (
            <p className="text-[13px] italic" style={{ color: '#9DB2CE' }}>
              —
            </p>
          ) : (
            <ul
              className="space-y-1"
              data-testid={`feature-list-${plan.code}`}
            >
              {enabledFeatures.map((key) => (
                <li
                  key={key}
                  className="flex items-center gap-2 text-[13px]"
                  style={{ color: '#14161B' }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: '#1F8A5B' }}
                    aria-hidden="true"
                  />
                  {featureLabel(key)}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Disabled edit CTA */}
        <button
          type="button"
          disabled
          title="Tersedia di Wave 4a"
          className="mt-2 w-full text-[13px] font-medium py-2 rounded-lg border cursor-not-allowed"
          style={{
            border: '1px solid #E2E8F0',
            color: '#9DB2CE',
            background: '#F8FAFC',
          }}
          data-testid={`edit-btn-${plan.code}`}
        >
          Aktifkan (Wave 4a)
        </button>
      </div>
    </div>
  );
}

// ─── PlansManagement ───────────────────────────────────────────────────────────

export function PlansManagement() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listPlansAdmin();
        if (!cancelled) setPlans(data);
      } catch (err) {
        if (!cancelled) {
          adminToast.error('Gagal memuat paket', String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="text-[13px] p-4" style={{ color: '#9DB2CE' }}>
        Memuat paket...
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div>
        <h1
          className="text-[18px] font-bold"
          style={{ color: '#0B2545' }}
        >
          Paket ({plans.length})
        </h1>
        <p className="text-[13px] mt-0.5" style={{ color: '#9DB2CE' }}>
          Tampilan hanya-baca di Wave 1. Edit bundle fitur tersedia di Wave 4a.
        </p>
      </div>

      {/* 3-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {plans.map((p) => (
          <PlanCard key={p.code} plan={p} />
        ))}
      </div>

      {plans.length === 0 && (
        <p className="text-[13px] text-center py-8" style={{ color: '#9DB2CE' }}>
          Tidak ada paket ditemukan.
        </p>
      )}
    </div>
  );
}
