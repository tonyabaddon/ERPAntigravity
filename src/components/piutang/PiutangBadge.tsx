// Piutang sidebar badge — red dot+count when there are overdue tempo invoices.
// Realtime subscription on orders table (debounced 2s) — same pattern as
// PendingApprovalBadge. Cap at 9+ visually.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { fetchOverdueCount } from '../../lib/piutangService';

interface PiutangBadgeProps {
  size?: 'sm' | 'md';
  className?: string;
}

const SIZES = {
  sm: { dot: 'w-2 h-2', pill: 'min-w-[18px] h-[18px] text-[10px] px-1' },
  md: { dot: 'w-2.5 h-2.5', pill: 'min-w-[20px] h-5 text-[11px] px-1.5' },
} as const;

export default function PiutangBadge({ size = 'md', className }: PiutangBadgeProps) {
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
    const ch = supabase
      .channel('piutang-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refresh)
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase!.removeChannel(ch);
    };
  }, []);

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
