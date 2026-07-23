// src/components/admin/PaymentInstructionBlock.tsx
// Wave 6 Task 10 — renders payment instruction for newly onboarded tenant.
// Fetches platform_settings + plan.price_annual, shows copy-pasteable message
// with Copy button and WhatsApp share link.

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { adminToast } from '../../lib/adminToast';
import { platformSettingsApi } from '../../lib/platformSettingsApi';
import type { PlatformSettings } from '../../lib/platformSettingsApi';
import { formatIDR } from '../../lib/formatIDR';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DurationMonths = 6 | 12;
export type DiscountMode = 'none' | 'percent' | 'rupiah';

export interface TenantInfo {
  slug: string;
  name: string;
  plan_code: string;
  /** 6 = komit setengah tahun (HEMAT 39% dari landing) · 12 = tahunan (HEMAT 50%). Default 12 for backward compat. */
  duration_months?: DurationMonths;
  /** Diskon on-top yang founder kasih saat onboarding. Default 'none'. */
  discount_mode?: DiscountMode;
  /** Nilai diskon (percent 0-100 kalau mode=percent, rupiah kalau mode=rupiah). */
  discount_value?: number;
}

interface Plan {
  code: string;
  /** Rp untuk komit 6 bulan (dengan HEMAT 39%). Nullable — pre-migration 000513. */
  price_6mo: number | null;
  /** Rp untuk komit 12 bulan (dengan HEMAT 50%). */
  price_annual: number;
}

interface Props {
  tenant: TenantInfo;
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

const C = {
  navy: '#0B2545',
  gold: '#F9B233',
  cream: '#FAF7F0',
  bg: '#FFFFFF',
  border: '#E2E8F0',
  muted: '#64748B',
  green: '#16A34A',
};

const FONT = 'Plus Jakarta Sans, system-ui, sans-serif';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Pick base price sesuai durasi. Fallback ke price_annual kalau price_6mo belum di-set. */
function pickBasePrice(p: Plan, months: DurationMonths): number {
  if (months === 6 && p.price_6mo != null) return Number(p.price_6mo);
  return Number(p.price_annual);
}

/** Calculate final total setelah discount. */
function computeTotal(basePrice: number, mode: DiscountMode, value: number): {
  discountAmount: number;
  finalPrice: number;
} {
  if (mode === 'none' || !value || value <= 0) {
    return { discountAmount: 0, finalPrice: basePrice };
  }
  if (mode === 'percent') {
    const clamped = Math.max(0, Math.min(100, value));
    const discountAmount = Math.round(basePrice * clamped / 100);
    return { discountAmount, finalPrice: Math.max(0, basePrice - discountAmount) };
  }
  // rupiah
  const discountAmount = Math.min(basePrice, Math.max(0, value));
  return { discountAmount, finalPrice: basePrice - discountAmount };
}

function buildMessage(t: TenantInfo, s: PlatformSettings, p: Plan): string {
  const months: DurationMonths = t.duration_months ?? 12;
  const mode: DiscountMode = t.discount_mode ?? 'none';
  const value = t.discount_value ?? 0;
  const durationLabel = months === 6 ? 'komit 6 bulan' : 'komit 12 bulan';

  const basePrice = pickBasePrice(p, months);
  const { discountAmount, finalPrice } = computeTotal(basePrice, mode, value);

  const priceLine = discountAmount > 0
    ? `${formatIDR(basePrice)} − ${mode === 'percent' ? `${value}%` : formatIDR(discountAmount)} = ${formatIDR(finalPrice)}`
    : formatIDR(finalPrice);

  return `Selamat! Toko Anda "${t.name}" sudah aktif di Caleo.

Untuk aktivasi paket ${t.plan_code} (${durationLabel}):
💰 Total: ${priceLine}
🏦 Transfer ke: ${s.bank_name ?? '-'} ${s.bank_account_no ?? '-'}
   a/n: ${s.bank_account_name ?? '-'}
💬 Berita transfer: ${t.slug}
📱 Kirim bukti transfer ke: ${s.admin_wa_number ?? '-'}

Terima kasih! 🙏`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PaymentInstructionBlock({ tenant }: Props) {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const s = await platformSettingsApi.get();
        const { data: p, error: perr } = await supabase
          .from('plans')
          .select('code, price_6mo, price_annual')
          .eq('code', tenant.plan_code)
          .single();
        if (cancelled) return;
        if (perr) throw new Error(perr.message);
        setSettings(s);
        setPlan(p as Plan);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Gagal memuat instruksi pembayaran');
        }
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [tenant.plan_code]);

  if (error) {
    return (
      <div
        className="p-3 rounded-lg text-[13px]"
        style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FCA5A5' }}
        data-testid="payment-instruction-error"
      >
        {error}
      </div>
    );
  }

  if (!settings || !plan) {
    return (
      <div
        className="p-4 rounded-lg text-[13px] animate-pulse"
        style={{ background: C.cream, color: C.muted }}
        data-testid="payment-instruction-loading"
      >
        Memuat instruksi pembayaran…
      </div>
    );
  }

  const message = buildMessage(tenant, settings, plan);
  const waLink = `https://wa.me/?text=${encodeURIComponent(message)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message);
      adminToast.success('Instruksi tersalin. Paste ke WhatsApp customer.');
    } catch {
      adminToast.error('Gagal copy', 'Browser blokir clipboard');
    }
  }

  return (
    <div
      className="space-y-3 p-4 rounded-xl"
      style={{ background: C.cream, border: `1px solid ${C.gold}`, fontFamily: FONT }}
      data-testid="payment-instruction-block"
    >
      <h3 className="text-[14px] font-semibold" style={{ color: C.navy }}>
        Instruksi Pembayaran
      </h3>

      <pre
        className="font-mono text-[12px] whitespace-pre-wrap rounded-lg p-3"
        style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.navy }}
        data-testid="payment-instruction-message"
      >
        {message}
      </pre>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="flex-1 py-2 rounded-lg text-[13px] font-bold"
          style={{ background: C.navy, color: C.gold }}
          data-testid="payment-instruction-copy"
        >
          Salin Pesan
        </button>
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 py-2 rounded-lg text-[13px] font-bold text-center"
          style={{ background: C.gold, color: C.navy }}
          data-testid="payment-instruction-wa"
        >
          Kirim via WhatsApp
        </a>
      </div>

      <p className="text-[11px]" style={{ color: C.muted }}>
        Berita transfer harus tepat: <strong>{tenant.slug}</strong> — dipakai tim
        untuk verifikasi otomatis.
      </p>
    </div>
  );
}
