/**
 * Single React context that loads sales_channel_settings once, subscribes
 * to realtime updates, and exposes visibility state + toggle action to consumers.
 *
 * Spec: docs/superpowers/specs/2026-06-13-configurable-sales-channels-design.md
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { SalesChannel } from '../types';
import { CHANNEL_GROUPS, CHANNEL_LOCKED, type ChannelGroup } from '../lib/salesChannels';
import { useTenant } from './TenantContext';

interface ChannelSetting {
  isVisible: boolean;
  sortOrder: number;
}

interface SalesChannelsCtxValue {
  settings: Record<SalesChannel, ChannelSetting>;
  visibleChannels: SalesChannel[];                              // sorted by sort_order
  visibleByGroup: Record<ChannelGroup, SalesChannel[]>;
  isLoading: boolean;
  toggleVisibility: (code: SalesChannel) => Promise<void>;
}

// Default state — used while loading or if Supabase unavailable.
// All channels visible by default; sort order matches CHANNEL_GROUPS canonical order.
const DEFAULT_SETTINGS: Record<SalesChannel, ChannelSetting> = (() => {
  const all = [...CHANNEL_GROUPS.offline, ...CHANNEL_GROUPS.marketplace, ...CHANNEL_GROUPS.direct];
  const out = {} as Record<SalesChannel, ChannelSetting>;
  all.forEach((code, idx) => { out[code] = { isVisible: true, sortOrder: (idx + 1) * 10 }; });
  return out;
})();

const SalesChannelsCtx = createContext<SalesChannelsCtxValue | null>(null);

export function SalesChannelsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Record<SalesChannel, ChannelSetting>>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  // useTenant() returns null when SalesChannelsProvider is mounted outside TenantProvider
  // (legacy non-tenant path in App.tsx). Guard the filter to avoid undefined filter string.
  const tenant = useTenant();
  const tenantId = tenant?.tenant_id;

  // Load initial settings
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    supabase
      .from('sales_channel_settings')
      .select('channel_code, is_visible, sort_order')
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('SalesChannelsContext load error:', error);
          setIsLoading(false);
          return;
        }
        if (data) {
          const next = { ...DEFAULT_SETTINGS };
          data.forEach(row => {
            next[row.channel_code as SalesChannel] = {
              isVisible: row.is_visible,
              sortOrder: row.sort_order,
            };
          });
          setSettings(next);
        }
        setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Subscribe realtime — suffix UUID per spec to avoid multi-tab topic collision
  // tenant_id filter is REQUIRED. Realtime bandwidth is billed per-connection;
  // unfiltered subscriptions receive all-tenant events + RLS-drop client-side.
  // Server-side filter cuts inbound bytes and enforces isolation belt-and-suspenders.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    // If tenantId is unavailable (legacy non-tenant mount), skip filtered subscription.
    // RLS on sales_channel_settings still enforces isolation; this just skips realtime.
    if (!tenantId) return;

    const topic = `sales_channel_settings:${crypto.randomUUID()}`;
    const channel = supabase
      .channel(topic)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'sales_channel_settings',
        filter: `tenant_id=eq.${tenantId}`,
      }, payload => {
        const row = (payload.new ?? payload.old) as { channel_code?: string; is_visible?: boolean; sort_order?: number };
        if (!row?.channel_code) return;
        setSettings(prev => ({
          ...prev,
          [row.channel_code as SalesChannel]: {
            isVisible: row.is_visible ?? prev[row.channel_code as SalesChannel].isVisible,
            sortOrder: row.sort_order ?? prev[row.channel_code as SalesChannel].sortOrder,
          },
        }));
      })
      .subscribe();

    return () => {
      supabase!.removeChannel(channel);
    };
  }, [tenantId]);

  const toggleVisibility = useCallback(async (code: SalesChannel): Promise<void> => {
    if (CHANNEL_LOCKED.has(code)) {
      throw new Error(`Channel ${code} is locked and cannot be hidden`);
    }
    if (!supabase) throw new Error('Supabase not configured');

    const current = settings[code].isVisible;
    // Optimistic update
    setSettings(prev => ({ ...prev, [code]: { ...prev[code], isVisible: !current } }));
    const { error } = await supabase
      .from('sales_channel_settings')
      .update({ is_visible: !current, updated_at: new Date().toISOString() })
      .eq('channel_code', code);
    if (error) {
      // Rollback on failure
      setSettings(prev => ({ ...prev, [code]: { ...prev[code], isVisible: current } }));
      throw error;
    }
  }, [settings]);

  const visibleChannels = useMemo(() => {
    return (Object.entries(settings) as Array<[SalesChannel, ChannelSetting]>)
      .filter(([, s]) => s.isVisible)
      .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
      .map(([code]) => code);
  }, [settings]);

  const visibleByGroup = useMemo<Record<ChannelGroup, SalesChannel[]>>(() => ({
    offline:     visibleChannels.filter(c => CHANNEL_GROUPS.offline.includes(c)),
    marketplace: visibleChannels.filter(c => CHANNEL_GROUPS.marketplace.includes(c)),
    direct:      visibleChannels.filter(c => CHANNEL_GROUPS.direct.includes(c)),
  }), [visibleChannels]);

  const value: SalesChannelsCtxValue = {
    settings, visibleChannels, visibleByGroup, isLoading, toggleVisibility,
  };

  return <SalesChannelsCtx.Provider value={value}>{children}</SalesChannelsCtx.Provider>;
}

export function useSalesChannels(): SalesChannelsCtxValue {
  const ctx = useContext(SalesChannelsCtx);
  if (!ctx) throw new Error('useSalesChannels must be used within SalesChannelsProvider');
  return ctx;
}
