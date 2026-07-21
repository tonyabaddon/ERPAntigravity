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

export interface TenantInfo {
  slug: string;
  name: string;
  plan_code: string;
}

interface Plan {
  code: string;
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

function buildMessage(t: TenantInfo, s: PlatformSettings, p: Plan): string {
  return `Selamat! Toko Anda "${t.name}" sudah aktif di Caleo.

Untuk aktivasi paket ${t.plan_code} (${formatIDR(p.price_annual)}/tahun):
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
          .select('code, price_annual')
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
