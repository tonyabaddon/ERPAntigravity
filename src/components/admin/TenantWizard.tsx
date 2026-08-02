// src/components/admin/TenantWizard.tsx
// Phase B Wave 6 — new-tenant onboarding wizard, /admin/tenants/new.
//
// Multi-step form that platform admins use to onboard a new tenant.
// Submit calls Edge Function create-tenant-owner which:
//   1. Validates inputs + slug uniqueness
//   2. Creates owner via supabase.auth.admin.inviteUserByEmail (service_role)
//   3. Calls provision_tenant RPC atomically
//   4. Emits PROVISION_TENANT audit event
//
// See docs/tenant-onboarding-runbook.md for the manual flow this replaces.

import type React from 'react';
import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { NumberInput } from '../ui/NumberInput';
import { adminToast } from '../../lib/adminToast';
import { PaymentInstructionBlock } from './PaymentInstructionBlock';

// ─── Edge Function error mapping ──────────────────────────────────────────────

const EDGE_ERROR_MESSAGES: Record<string, string> = {
  E1: 'Sesi expired — silakan login ulang',
  E2: 'Akses ditolak — bukan platform admin',
  E3: 'Format slug tidak valid (3-30 karakter, huruf kecil, angka, dash)',
  E4: 'Slug tidak boleh menggunakan kata reserved',
  E5: 'Slug sudah dipakai — pilih yang lain',
  E6: 'Format email tidak valid',
  E7: 'Email sudah terdaftar — user tidak dibuat',
  E8: 'Gagal membuat user (invite service error)',
  E9: 'Gagal simpan tenant — data user sudah cleanup, silakan retry',
  E10: 'Rollback gagal — hubungi support (orphan detected)',
  E11: 'Field wajib tidak lengkap',
};

function mapEdgeErrorToBahasa(code: string | undefined, fallback: string): string {
  return (code && EDGE_ERROR_MESSAGES[code]) || fallback;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'tenant' | 'owner' | 'review' | 'result';
type PlanCode = 'STARTER' | 'PRO' | 'PREMIUM';
type DurationMonths = 6 | 12;
type DiscountMode = 'none' | 'percent' | 'rupiah';

interface WizardForm {
  slug: string;
  name: string;
  planCode: PlanCode;
  expiresInMonths: DurationMonths;
  discountMode: DiscountMode;
  discountValue: number;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
}

/** Shape returned by Edge Function create-tenant-owner (201 OK). */
interface EdgeProvisionResult {
  tenant_id: string;
  slug: string;
  owner_user_id: string;
  expires_at: string;
}

/** Extended result including form-supplied fields not returned by Edge Function. */
interface ProvisionResult extends EdgeProvisionResult {
  /** Copied from form.name at submit time. */
  name: string;
  /** Copied from form.planCode at submit time. */
  plan_code: string;
  /** Copied from form.expiresInMonths at submit time (6 or 12). */
  duration_months: DurationMonths;
  /** Copied from form.discountMode at submit time. */
  discount_mode: DiscountMode;
  /** Copied from form.discountValue at submit time (raw value). */
  discount_value: number;
}

const INITIAL_FORM: WizardForm = {
  slug: '',
  name: '',
  planCode: 'STARTER',
  expiresInMonths: 12,
  discountMode: 'none',
  discountValue: 0,
  ownerUserId: '',
  ownerName: '',
  ownerEmail: '',
};

const PLAN_OPTIONS: { code: PlanCode; label: string; blurb: string }[] = [
  { code: 'STARTER', label: 'Starter', blurb: 'Toko kecil / warung — modul dasar' },
  { code: 'PRO', label: 'Pro', blurb: 'Toko menengah — akuntansi + multi-gudang' },
  { code: 'PREMIUM', label: 'Premium AI', blurb: 'Distributor / B2B — semua modul + AI' },
];

// ─── Validation helpers ───────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateSlug(slug: string): string | null {
  if (!slug) return 'Slug wajib diisi';
  if (!SLUG_RE.test(slug))
    return 'Slug 3–30 karakter, huruf-kecil / angka / dash, mulai huruf/angka';
  return null;
}
function validateUuid(v: string): string | null {
  if (!v) return 'UUID owner wajib diisi';
  if (!UUID_RE.test(v)) return 'Format UUID tidak valid';
  return null;
}
function validateEmail(v: string): string | null {
  if (!v) return 'Email wajib diisi';
  if (!EMAIL_RE.test(v)) return 'Format email tidak valid';
  return null;
}

// ─── UI tokens ────────────────────────────────────────────────────────────────

const C = {
  navy: '#0B2545',
  gold: '#F9B233',
  cream: '#FAF7F0',
  bg: '#FFFFFF',
  border: '#E2E8F0',
  muted: '#64748B',
  red: '#DC2626',
  green: '#16A34A',
};

const FONT = 'Plus Jakarta Sans, system-ui, sans-serif';

// ─── Component ────────────────────────────────────────────────────────────────

export function TenantWizard() {
  const [step, setStep] = useState<Step>('tenant');
  const [form, setForm] = useState<WizardForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionResult | null>(null);

  const update = <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setError(null);
  };

  const goNext = () => {
    if (step === 'tenant') {
      const slugErr = validateSlug(form.slug);
      if (slugErr) return setError(slugErr);
      if (!form.name.trim()) return setError('Nama tenant wajib diisi');
      if (form.expiresInMonths < 1 || form.expiresInMonths > 60)
        return setError('Masa aktif 1–60 bulan');
      setStep('owner');
    } else if (step === 'owner') {
      if (!form.ownerName.trim()) return setError('Nama owner wajib diisi');
      const emailErr = validateEmail(form.ownerEmail);
      if (emailErr) return setError(emailErr);
      setStep('review');
    }
  };

  const goBack = () => {
    setError(null);
    if (step === 'owner') setStep('tenant');
    else if (step === 'review') setStep('owner');
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { data: { session } } = await supabase!.auth.getSession();
      if (!session) {
        const msg = mapEdgeErrorToBahasa('E1', 'Sesi expired — silakan login ulang');
        setError(msg);
        adminToast.error('Gagal onboarding', msg);
        return;
      }
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-tenant-owner`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            slug: form.slug,
            name: form.name,
            plan_code: form.planCode,
            expires_in_months: form.expiresInMonths,
            owner_email: form.ownerEmail,
            owner_name: form.ownerName,
          }),
        }
      );
      const data = await resp.json() as EdgeProvisionResult & { code?: string; message?: string };
      if (!resp.ok) {
        const msg = mapEdgeErrorToBahasa(data.code, data.message ?? 'Provision gagal');
        setError(msg);
        adminToast.error('Gagal onboarding', msg);
        return;
      }
      const r: ProvisionResult = {
        ...(data as EdgeProvisionResult),
        name: form.name,
        plan_code: form.planCode,
        duration_months: form.expiresInMonths,
        discount_mode: form.discountMode,
        discount_value: form.discountValue,
      };
      setResult(r);
      setStep('result');
      adminToast.success(`Tenant ${form.name} berhasil di-onboard.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      adminToast.error('Gagal onboarding', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="max-w-3xl mx-auto p-6 space-y-6"
      style={{ fontFamily: FONT, color: C.navy }}
      data-testid="tenant-wizard"
    >
      <Header step={step} />

      {step === 'tenant' && (
        <TenantStep form={form} update={update} />
      )}
      {step === 'owner' && <OwnerStep form={form} update={update} />}
      {step === 'review' && <ReviewStep form={form} />}
      {step === 'result' && result && <ResultStep result={result} />}

      {error && (
        <div
          className="p-3 rounded text-caleo-13"
          style={{ background: '#FEF2F2', color: C.red, border: `1px solid #FCA5A5` }}
        >
          {error}
        </div>
      )}

      {step !== 'result' && (
        <div className="flex justify-between pt-4">
          {step !== 'tenant' ? (
            <button
              onClick={goBack}
              className="px-4 py-2 rounded text-caleo-13 font-semibold"
              style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.navy }}
            >
              ← Kembali
            </button>
          ) : (
            <span />
          )}
          {step === 'review' ? (
            <button
              onClick={submit}
              disabled={submitting}
              className="px-6 py-2 rounded text-caleo-13 font-bold disabled:opacity-50"
              style={{ background: C.gold, color: C.navy }}
            >
              {submitting ? 'Memproses…' : 'Onboard tenant'}
            </button>
          ) : (
            <button
              onClick={goNext}
              className="px-6 py-2 rounded text-caleo-13 font-bold"
              style={{ background: C.navy, color: '#FFFFFF' }}
            >
              Lanjut →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Header (stepper) ─────────────────────────────────────────────────────────

function Header({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'tenant', label: '1. Tenant' },
    { key: 'owner', label: '2. Owner' },
    { key: 'review', label: '3. Review' },
    { key: 'result', label: '4. Selesai' },
  ];
  const currentIdx = steps.findIndex(s => s.key === step);
  return (
    <div>
      <h1 className="text-xl font-extrabold" style={{ color: C.navy }}>
        Onboard tenant baru
      </h1>
      <p className="text-caleo-13 mt-1" style={{ color: C.muted }}>
        Wizard ini onboard tenant baru via Edge Function. Owner auth.users dibuat
        otomatis via email invite — tidak perlu buat manual di Dashboard.
      </p>
      <div className="flex gap-2 mt-4">
        {steps.map((s, idx) => (
          <div
            key={s.key}
            className="flex-1 py-2 rounded text-caleo-11 font-bold text-center uppercase tracking-widest"
            style={{
              background: idx <= currentIdx ? C.navy : C.cream,
              color: idx <= currentIdx ? '#FFFFFF' : C.muted,
            }}
          >
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Step 1: Tenant details ───────────────────────────────────────────────────

interface StepProps {
  form: WizardForm;
  update: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void;
}

function TenantStep({ form, update }: StepProps) {
  return (
    <section className="space-y-4">
      <Field
        label="Slug (URL path)"
        hint="3–30 karakter, huruf-kecil, angka, dash. Contoh: warung-sinar-rezeki"
      >
        <input
          type="text"
          value={form.slug}
          onChange={e => update('slug', e.target.value.toLowerCase())}
          placeholder="warung-sinar-rezeki"
          className="w-full border rounded px-3 py-2 text-caleo-13"
          style={{ borderColor: C.border }}
        />
      </Field>
      <Field label="Nama tenant" hint="Ditampilkan di header dashboard + PDF">
        <input
          type="text"
          value={form.name}
          onChange={e => update('name', e.target.value)}
          placeholder="Warung Sinar Rezeki"
          className="w-full border rounded px-3 py-2 text-caleo-13"
          style={{ borderColor: C.border }}
        />
      </Field>
      <Field label="Paket">
        <div className="grid grid-cols-3 gap-2">
          {PLAN_OPTIONS.map(p => {
            const selected = form.planCode === p.code;
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => update('planCode', p.code)}
                className="text-left p-3 rounded border-2 transition-all"
                style={{
                  borderColor: selected ? C.gold : C.border,
                  background: selected ? C.cream : C.bg,
                }}
              >
                <div className="font-bold text-caleo-13" style={{ color: C.navy }}>
                  {p.label}
                </div>
                <div className="text-caleo-11 mt-1" style={{ color: C.muted }}>
                  {p.blurb}
                </div>
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Durasi komitmen" hint="6 bulan (HEMAT 39%) atau 12 bulan (HEMAT 50%). Match tier landing caleo.id.">
        <div className="grid grid-cols-2 gap-2">
          {([6, 12] as DurationMonths[]).map(m => {
            const selected = form.expiresInMonths === m;
            const savings = m === 12 ? 'HEMAT 50%' : 'HEMAT 39%';
            return (
              <button
                key={m}
                type="button"
                onClick={() => update('expiresInMonths', m)}
                className="p-3 rounded border-2 transition-all text-left"
                style={{
                  borderColor: selected ? C.gold : C.border,
                  background: selected ? C.cream : C.bg,
                }}
              >
                <div className="font-bold text-caleo-13" style={{ color: C.navy }}>
                  {m} Bulan
                </div>
                <div className="text-caleo-11 mt-1" style={{ color: C.green }}>
                  {savings}
                </div>
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Diskon tambahan" hint="Diskon on top selain promo landing. Kosongkan kalau tidak kasih diskon.">
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {([
              { mode: 'none' as DiscountMode, label: 'Tanpa diskon' },
              { mode: 'percent' as DiscountMode, label: 'Persen (%)' },
              { mode: 'rupiah' as DiscountMode, label: 'Rupiah (Rp)' },
            ]).map(o => {
              const selected = form.discountMode === o.mode;
              return (
                <button
                  key={o.mode}
                  type="button"
                  onClick={() => {
                    update('discountMode', o.mode);
                    if (o.mode === 'none') update('discountValue', 0);
                  }}
                  className="py-2 rounded border-2 text-xs font-semibold transition-all"
                  style={{
                    borderColor: selected ? C.gold : C.border,
                    background: selected ? C.cream : C.bg,
                    color: C.navy,
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {form.discountMode !== 'none' && (
            <NumberInput
              allowDecimal={form.discountMode === 'percent'}
              value={form.discountValue}
              onChange={n => update('discountValue', n)}
              className="w-full border rounded px-3 py-2 text-caleo-13"
              style={{ borderColor: C.border }}
            />
          )}
        </div>
      </Field>
    </section>
  );
}

// ─── Step 2: Owner details ────────────────────────────────────────────────────

function OwnerStep({ form, update }: StepProps) {
  return (
    <section className="space-y-4">
      <div
        className="p-3 rounded text-xs"
        style={{ background: C.cream, color: C.navy, border: `1px solid ${C.gold}` }}
      >
        <strong>Info:</strong> Edge Function akan kirim email invite otomatis ke
        owner. Pastikan email valid dan belum terdaftar di sistem.
      </div>
      <Field label="Nama owner" hint="Ditampilkan di sidebar user management">
        <input
          type="text"
          value={form.ownerName}
          onChange={e => update('ownerName', e.target.value)}
          placeholder="Budi Santoso"
          className="w-full border rounded px-3 py-2 text-caleo-13"
          style={{ borderColor: C.border }}
        />
      </Field>
      <Field label="Email owner" hint="Owner akan menerima link aktivasi via email ini">
        <input
          type="email"
          value={form.ownerEmail}
          onChange={e => update('ownerEmail', e.target.value)}
          placeholder="budi@warungsinar.com"
          className="w-full border rounded px-3 py-2 text-caleo-13"
          style={{ borderColor: C.border }}
        />
      </Field>
    </section>
  );
}

// ─── Step 3: Review ───────────────────────────────────────────────────────────

function ReviewStep({ form }: { form: WizardForm }) {
  const discountLabel =
    form.discountMode === 'none'
      ? '—'
      : form.discountMode === 'percent'
        ? `${form.discountValue}%`
        : `Rp ${form.discountValue.toLocaleString('id-ID')}`;
  return (
    <section className="space-y-3">
      <p className="text-caleo-13" style={{ color: C.muted }}>
        Cek ulang. Setelah klik <strong>Onboard tenant</strong>, Edge Function{' '}
        <code className="font-mono text-caleo-11">create-tenant-owner</code> akan
        buat auth.users invite + seed 4 tabel atomik.
      </p>
      <ReviewRow label="Slug" value={form.slug} />
      <ReviewRow label="Nama tenant" value={form.name} />
      <ReviewRow label="Paket" value={form.planCode} />
      <ReviewRow label="Durasi komitmen" value={`${form.expiresInMonths} bulan`} />
      <ReviewRow label="Diskon tambahan" value={discountLabel} />
      <ReviewRow label="Nama owner" value={form.ownerName} />
      <ReviewRow label="Email owner" value={form.ownerEmail} />
    </section>
  );
}

function ReviewRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      className="flex justify-between items-center py-2 border-b"
      style={{ borderColor: C.border }}
    >
      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: C.muted }}>
        {label}
      </span>
      <span
        className={`text-caleo-13 ${mono ? 'font-mono' : 'font-semibold'}`}
        style={{ color: C.navy }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Step 4: Result ───────────────────────────────────────────────────────────

function ResultStep({ result }: { result: ProvisionResult }) {
  const tenantUrl = `${window.location.origin}/t/${result.slug}/dashboard`;
  const detailUrl = `/admin/tenants/${result.slug}`;
  return (
    <section className="space-y-4">
      <div
        className="p-6 rounded space-y-4"
        style={{ background: C.cream, border: `2px solid ${C.gold}` }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-base"
            style={{ background: C.green, color: '#FFFFFF' }}
            aria-hidden
          >
            ✓
          </div>
          <div>
            <h2 className="text-lg font-extrabold" style={{ color: C.navy }}>
              Tenant berhasil di-onboard
            </h2>
            <p className="text-xs" style={{ color: C.muted }}>
              Rows tersimpan di tenants + tenant_subscriptions + tenant_users + admin_users.
              Email invite terkirim ke owner.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <ReviewRow label="Tenant ID" value={result.tenant_id} mono />
          <ReviewRow label="Slug" value={result.slug} />
          <ReviewRow label="Nama" value={result.name} />
          <ReviewRow label="Paket" value={result.plan_code} />
          <ReviewRow label="Aktif s/d" value={new Date(result.expires_at).toLocaleDateString('id-ID')} />
        </div>

        <div className="flex gap-3 pt-2">
          <a
            href={detailUrl}
            className="flex-1 text-center py-2 rounded text-caleo-13 font-bold"
            style={{ background: C.navy, color: '#FFFFFF' }}
          >
            Buka detail tenant →
          </a>
          <a
            href={tenantUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center py-2 rounded text-caleo-13 font-bold"
            style={{ background: C.bg, color: C.navy, border: `1px solid ${C.border}` }}
          >
            Preview dashboard ↗
          </a>
        </div>

        <p className="text-caleo-11 pt-2" style={{ color: C.muted }}>
          Owner akan menerima email invite untuk set password dan login pertama kali.
        </p>
      </div>

      <PaymentInstructionBlock
        tenant={{
          slug: result.slug,
          name: result.name,
          plan_code: result.plan_code,
          duration_months: result.duration_months,
          discount_mode: result.discount_mode,
          discount_value: result.discount_value,
        }}
      />
    </section>
  );
}

// ─── Shared Field wrapper ─────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-caleo-11 font-bold uppercase tracking-widest" style={{ color: C.navy }}>
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint && (
        <p className="text-caleo-11 mt-1" style={{ color: C.muted }}>
          {hint}
        </p>
      )}
    </div>
  );
}
