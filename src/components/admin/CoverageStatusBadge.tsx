// src/components/admin/CoverageStatusBadge.tsx
// Reusable coverage-status badge using VOSI design tokens.
// Used in TenantsTable (Pembayaran column), RevenueTopTenants, PembayaranTab,
// and AdminRevenue coverage-gap callout.
import type { CoverageStatus } from '../../lib/adminTypes';

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG: Record<
  CoverageStatus,
  { bgClass: string; textClass: string; label: string }
> = {
  LUNAS:   { bgClass: 'bg-caleo-success/15', textClass: 'text-caleo-success', label: 'Lunas' },
  DP_60:   { bgClass: 'bg-caleo-gold/15',    textClass: 'text-caleo-navy',    label: 'DP 60%' },
  DP_30:   { bgClass: 'bg-caleo-gold/25',    textClass: 'text-caleo-navy',    label: 'DP 30%' },
  OVERDUE: { bgClass: 'bg-caleo-danger/15',  textClass: 'text-caleo-danger',  label: 'Terlambat' },
  UNPAID:  { bgClass: 'bg-caleo-slate/15',   textClass: 'text-caleo-slate',   label: 'Belum bayar' },
};

// ─── Component ────────────────────────────────────────────────────────────────

interface CoverageStatusBadgeProps {
  /** The coverage status to display, or null/undefined to render an em-dash. */
  status: CoverageStatus | null | undefined;
}

/**
 * Displays a pill badge for a tenant's payment coverage status.
 * Renders an em-dash when status is null or undefined.
 *
 * Color palette follows VOSI Design System tokens.
 * Labels are Bahasa Indonesia.
 */
export function CoverageStatusBadge({ status }: CoverageStatusBadgeProps) {
  if (!status) {
    return (
      <span
        className="text-[12px]"
        style={{ color: '#9DB2CE' }}
        data-testid="coverage-badge-null"
      >
        —
      </span>
    );
  }

  const cfg = CONFIG[status];
  return (
    <span
      className={`inline-block text-[11px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full ${cfg.bgClass} ${cfg.textClass}`}
      data-testid={`coverage-badge-${status}`}
    >
      {cfg.label}
    </span>
  );
}
