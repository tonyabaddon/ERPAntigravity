// Piutang sidebar badge — red dot+count when there are overdue tempo invoices.
// Realtime subscription on orders table (debounced 2s) — same pattern as
// PendingApprovalBadge. Cap at 9+ visually.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { fetchOverdueCount } from '../../lib/piutangService';
import { useTenant } from '../../contexts/TenantContext';

interface PiutangBadgeProps {
  size?: 'sm' | 'md';
  className?: string;
}

const SIZES = {
  sm: { dot: 'w-2 h-2', pill: 'min-w-[18px] h-[18px] text-caleo-10 px-1' },
  md: { dot: 'w-2.5 h-2.5', pill: 'min-w-[20px] h-5 text-caleo-11 px-1.5' },
} as const;

export default function PiutangBadge({ size = 'md', className }: PiutangBadgeProps) {
  const tenant = useTenant();
  const tenantId = tenant?.tenant_id;
  const [count, setCount] = useState<number>(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchOverdueCount().then(setCount).catch(() => {});
    }, 2000);
  };

  useEffect(() => {
    fetchOverdueCount().then(setCount).catch(() => {});
    if (!supabase) return;
    if (!tenantId) return;
    // tenant_id filter is REQUIRED. Realtime bandwidth is billed per-connection;
    // unfiltered subscriptions receive all-tenant events + RLS-drop client-side.
    // Server-side filter cuts inbound bytes and enforces isolation belt-and-suspenders.
    const ch = supabase
      .channel('piutang-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, refresh)
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase!.removeChannel(ch);
    };
  }, [tenantId]);

  if (count === 0) return null;

  const dims = SIZES[size];
  const base = `inline-flex items-center justify-center rounded-full bg-red-500 ${className ?? ''}`;
  const label = count > 9 ? '9+' : String(count);
  return (
    <span
      title={`${count} faktur tempo overdue`}
      aria-label={`${count} faktur tempo overdue`}
      className={`${base} ${dims.pill} font-extrabold text-white`}
    >
      {label}
    </span>
  );
}
