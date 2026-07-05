// src/components/admin/PlansManagement.tsx
// Wave 4a: read + inline edit (super-admin only).
// Edit backend gated by _assert_super_admin_from_jwt (Task 3).
// FE gate uses is_platform_admin as super-admin proxy pending Wave 4b JWT claim.
import { useEffect, useState } from 'react';
import { listPlansAdmin } from '../../lib/adminPlansApi';
import type { PlanRow } from '../../lib/adminPlansApi';
import { updatePlan } from '../../lib/adminApi';
import type { UpdatePlanInput } from '../../lib/adminTypes';
import { AdminApiError } from '../../lib/adminTypes';
import { adminToast } from '../../lib/adminToast';
import { isSuperAdmin } from '../../lib/adminAuth';

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

// ─── PlanCardView (read-only mode) ────────────────────────────────────────────

interface PlanCardViewProps {
  plan: PlanRow;
  canEdit: boolean;
  onEdit: () => void;
}

function PlanCardView({ plan, canEdit, onEdit }: PlanCardViewProps) {
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

      <div className="p-5 flex flex-col gap-3 flex-1">
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

        {plan.description && (
          <p className="text-[13px]" style={{ color: '#5A6472' }}>
            {plan.description}
          </p>
        )}

        <div
          className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-full self-start"
          style={{ background: '#ECEEF1', color: '#5A6472' }}
        >
          {plan.tenant_count} tenant aktif
        </div>

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

        {canEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="mt-2 w-full text-[13px] font-bold py-2 rounded-full bg-vosi-gold text-vosi-navy hover:brightness-95 transition"
            data-testid={`edit-btn-${plan.code}`}
          >
            Edit paket
          </button>
        ) : (
          <button
            type="button"
            disabled
            title="Butuh peran super admin"
            className="mt-2 w-full text-[13px] font-medium py-2 rounded-lg border cursor-not-allowed"
            style={{
              border: '1px solid #E2E8F0',
              color: '#9DB2CE',
              background: '#F8FAFC',
            }}
            data-testid={`edit-btn-disabled-${plan.code}`}
          >
            Butuh super admin
          </button>
        )}
      </div>
    </div>
  );
}

// ─── PlanCardEdit (inline edit form) ──────────────────────────────────────────

interface PlanCardEditProps {
  plan: PlanRow;
  onCancel: () => void;
  onSaved: () => void;
}

interface EditForm {
  description: string;
  target_segment: string;
  is_recommended: boolean;
  feature_bundle_json: string;
}

function PlanCardEdit({ plan, onCancel, onSaved }: PlanCardEditProps) {
  const [form, setForm] = useState<EditForm>({
    description: plan.description ?? '',
    target_segment: plan.target_segment ?? '',
    is_recommended: plan.is_recommended,
    feature_bundle_json: JSON.stringify(plan.feature_bundle, null, 2),
  });
  const [submitting, setSubmitting] = useState(false);
  const [featureError, setFeatureError] = useState<string | null>(null);

  function handleFeatureChange(v: string) {
    setForm((f) => ({ ...f, feature_bundle_json: v }));
    try {
      const parsed = JSON.parse(v);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setFeatureError('Fitur harus berupa objek JSON.');
      } else {
        setFeatureError(null);
      }
    } catch {
      setFeatureError('JSON tidak valid.');
    }
  }

  async function handleSave() {
    if (featureError) return;
    setSubmitting(true);
    try {
      const updates: UpdatePlanInput = {};
      if (form.description !== (plan.description ?? '')) updates.description = form.description;
      if (form.target_segment !== (plan.target_segment ?? '')) updates.target_segment = form.target_segment;
      if (form.is_recommended !== plan.is_recommended) updates.is_recommended = form.is_recommended;
      let featureBundle: Record<string, boolean> | null = null;
      try {
        featureBundle = JSON.parse(form.feature_bundle_json);
      } catch {
        setFeatureError('JSON tidak valid.');
        setSubmitting(false);
        return;
      }
      if (featureBundle && JSON.stringify(featureBundle) !== JSON.stringify(plan.feature_bundle)) {
        updates.feature_bundle = featureBundle;
      }
      if (Object.keys(updates).length === 0) {
        adminToast.success('Tidak ada perubahan.');
        onSaved();
        return;
      }
      await updatePlan(plan.code, updates);
      adminToast.success('Paket diperbarui.');
      onSaved();
    } catch (err) {
      const msg = err instanceof AdminApiError
        ? err.userMessage
        : 'Terjadi kesalahan tak terduga.';
      adminToast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="relative flex flex-col bg-white border rounded-xl p-5 gap-3"
      style={{ borderColor: '#0B2545', borderWidth: '2px' }}
      data-testid={`edit-form-${plan.code}`}
    >
      <h2 className="text-[15px] font-bold text-vosi-navy">
        Edit {plan.code}
      </h2>

      <label className="flex flex-col gap-1 text-[12px] font-semibold text-vosi-slate">
        Deskripsi
        <textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className="border rounded-md p-2 text-[13px] font-normal text-vosi-ink border-vosi-muted/40 focus:border-vosi-navy focus:outline-none"
          rows={2}
          data-testid={`edit-description-${plan.code}`}
        />
      </label>

      <label className="flex flex-col gap-1 text-[12px] font-semibold text-vosi-slate">
        Segmen target
        <input
          type="text"
          value={form.target_segment}
          onChange={(e) => setForm((f) => ({ ...f, target_segment: e.target.value }))}
          className="border rounded-md p-2 text-[13px] font-normal text-vosi-ink border-vosi-muted/40 focus:border-vosi-navy focus:outline-none"
          data-testid={`edit-target-${plan.code}`}
        />
      </label>

      <label className="flex items-center gap-2 text-[13px] font-semibold text-vosi-navy">
        <input
          type="checkbox"
          checked={form.is_recommended}
          onChange={(e) => setForm((f) => ({ ...f, is_recommended: e.target.checked }))}
          data-testid={`edit-recommended-${plan.code}`}
        />
        Rekomendasi (PALING POPULER)
      </label>

      <label className="flex flex-col gap-1 text-[12px] font-semibold text-vosi-slate">
        Fitur (JSON)
        <textarea
          value={form.feature_bundle_json}
          onChange={(e) => handleFeatureChange(e.target.value)}
          className="border rounded-md p-2 text-[12px] font-mono text-vosi-ink border-vosi-muted/40 focus:border-vosi-navy focus:outline-none"
          rows={6}
          spellCheck={false}
          data-testid={`edit-features-${plan.code}`}
        />
        {featureError && (
          <span className="text-[11px] text-vosi-danger" data-testid={`edit-features-error-${plan.code}`}>
            {featureError}
          </span>
        )}
      </label>

      <div className="flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="text-[13px] font-semibold px-4 py-2 rounded-full border border-vosi-navy/30 text-vosi-navy hover:bg-vosi-cream disabled:opacity-50"
          data-testid={`edit-cancel-${plan.code}`}
        >
          Batal
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={submitting || !!featureError}
          className="text-[13px] font-extrabold px-5 py-2 rounded-full bg-vosi-gold text-vosi-navy disabled:opacity-50"
          data-testid={`edit-save-${plan.code}`}
        >
          {submitting ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </div>
  );
}

// ─── PlanCard (view/edit switcher) ────────────────────────────────────────────

interface PlanCardProps {
  plan: PlanRow;
  canEdit: boolean;
  onSaved: () => void;
}

function PlanCard({ plan, canEdit, onSaved }: PlanCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  if (isEditing) {
    return (
      <PlanCardEdit
        plan={plan}
        onCancel={() => setIsEditing(false)}
        onSaved={() => {
          setIsEditing(false);
          onSaved();
        }}
      />
    );
  }
  return <PlanCardView plan={plan} canEdit={canEdit} onEdit={() => setIsEditing(true)} />;
}

// ─── PlansManagement ──────────────────────────────────────────────────────────

export function PlansManagement() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [canEdit, setCanEdit] = useState(false);

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
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await isSuperAdmin();
        if (!cancelled) setCanEdit(ok);
      } catch {
        if (!cancelled) setCanEdit(false);
      }
    })();
    return () => { cancelled = true; };
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
      <div>
        <h1
          className="text-[18px] font-bold"
          style={{ color: '#0B2545' }}
        >
          Paket ({plans.length})
        </h1>
        <p className="text-[13px] mt-0.5" style={{ color: '#9DB2CE' }}>
          {canEdit
            ? 'Klik "Edit paket" untuk mengubah deskripsi, segmen, atau bundel fitur.'
            : 'Tampilan hanya-baca. Edit paket butuh peran super admin.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {plans.map((p) => (
          <PlanCard
            key={p.code}
            plan={p}
            canEdit={canEdit}
            onSaved={() => setRefreshKey((k) => k + 1)}
          />
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
