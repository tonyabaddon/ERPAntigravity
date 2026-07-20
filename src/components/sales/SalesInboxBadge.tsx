// Sales Inbox sidebar badge — red count when there are conversations needing action.
// Uses categoryCounts().butuhAksi as single source of truth — same predicate as
// the "Butuh Aksi" category shown in SalesInboxScreen.
// Realtime subscription on conversations table (debounced 2s) — same pattern as PiutangBadge.
import { useEffect, useRef, useState } from 'react';
import { supabase, conversationService } from '../../lib/supabaseClient';
import { categoryCounts } from '../../lib/salesInboxCategorize';
import { useTenant } from '../../contexts/TenantContext';

interface SalesInboxBadgeProps {
  size?: 'sm' | 'md';
  className?: string;
}

const SIZES = {
  sm: { pill: 'min-w-[18px] h-[18px] text-[10px] px-1' },
  md: { pill: 'min-w-[20px] h-5 text-[11px] px-1.5' },
} as const;

export default function SalesInboxBadge({ size = 'md', className }: SalesInboxBadgeProps) {
  const tenant = useTenant();
  const tenantId = tenant?.tenant_id;
  const [count, setCount] = useState<number>(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      conversationService
        .fetchConversations()
        .then(convs => setCount(categoryCounts(convs).butuhAksi))
        .catch(() => {});
    }, 2000);
  };

  useEffect(() => {
    // Immediate initial load
    conversationService
      .fetchConversations()
      .then(convs => setCount(categoryCounts(convs).butuhAksi))
      .catch(() => {});

    if (!supabase) return;
    if (!tenantId) return;
    // tenant_id filter is REQUIRED. Realtime bandwidth is billed per-connection;
    // unfiltered subscriptions receive all-tenant events + RLS-drop client-side.
    // Server-side filter cuts inbound bytes and enforces isolation belt-and-suspenders.
    const ch = supabase
      .channel('sales-inbox-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `tenant_id=eq.${tenantId}` }, refresh)
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
      title={`${count} percakapan butuh aksi`}
      aria-label={`${count} percakapan butuh aksi`}
      className={`${base} ${dims.pill} font-extrabold text-white`}
    >
      {label}
    </span>
  );
}
