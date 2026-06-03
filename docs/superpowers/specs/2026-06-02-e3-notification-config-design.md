# E3: Notification Config Persistence — Design Spec

## Goal

Persist the `NotificationSettingsScreen` config to Supabase so it survives browser clears, syncs across devices, and is readable by the Go heartbeat poller (future). Remove the redundant `targetNumber` field — WA recipients are managed in Pengaturan (E1).

## What Changes

### `NotificationConfig` type (remove `targetNumber`)

```typescript
export interface NotificationConfig {
  enabled: boolean;
  interval: string;
  reportComponents: {
    revenue: boolean;
    queue: boolean;
    activity: boolean;
    status: boolean;
  };
  lowStockAlert: number;
  delayAlert: number;
}
```

### New `DbNotificationConfig` (mirrors DB row)

```typescript
export interface DbNotificationConfig {
  id: number;
  enabled: boolean;
  interval_label: string;
  report_revenue: boolean;
  report_queue: boolean;
  report_activity: boolean;
  report_status: boolean;
  low_stock_alert: number;
  delay_alert: number;
  updated_at: string;
}
```

## SQL Migration

Single-row config table (at most one row; `maybeSingle()` fetch):

```sql
CREATE TABLE IF NOT EXISTS notification_config (
  id              serial      PRIMARY KEY,
  enabled         boolean     NOT NULL DEFAULT false,
  interval_label  text        NOT NULL DEFAULT 'Setiap 4 Jam',
  report_revenue  boolean     NOT NULL DEFAULT true,
  report_queue    boolean     NOT NULL DEFAULT true,
  report_activity boolean     NOT NULL DEFAULT true,
  report_status   boolean     NOT NULL DEFAULT true,
  low_stock_alert int         NOT NULL DEFAULT 5,
  delay_alert     int         NOT NULL DEFAULT 30,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notification_config ENABLE ROW LEVEL SECURITY;
-- anon SELECT (frontend reads)
CREATE POLICY "anon_select_notification_config" ON notification_config FOR SELECT TO anon USING (true);
-- anon INSERT + UPDATE (frontend writes)
GRANT INSERT, UPDATE ON notification_config TO anon;
GRANT USAGE ON SEQUENCE notification_config_id_seq TO anon;
CREATE POLICY "anon_insert_notification_config" ON notification_config FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_notification_config" ON notification_config FOR UPDATE TO anon USING (true);
-- updated_at trigger
CREATE TRIGGER trg_notification_config_updated_at
  BEFORE UPDATE ON notification_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

## Service

```typescript
export const notificationConfigService = {
  async fetch(): Promise<DbNotificationConfig | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('notification_config')
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  async save(
    values: Omit<DbNotificationConfig, 'id' | 'updated_at'>,
    existingId?: number
  ): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    if (existingId !== undefined) {
      const { error } = await supabase
        .from('notification_config')
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', existingId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('notification_config')
        .insert(values);
      if (error) throw error;
    }
  },
};
```

## NotificationSettingsScreen changes

- On mount: fetch from Supabase; if row exists, map DB fields to form state (overrides localStorage values)
- On save: call `notificationConfigService.save()` first, then call `onConfigChange()` to keep localStorage in sync as fallback
- Remove `targetNumber` field, state, and the "Nomor WhatsApp Tujuan" box from the UI

## App.tsx / initialData.ts changes

- Remove `targetNumber` from `NotificationConfig` type usages
- Remove `targetNumber: '81234567890'` from `INITIAL_CONFIG` in `initialData.ts`
- No other App.tsx changes needed (config state and localStorage sync remain)

## Architecture — 5 Tasks

| Task | File | Change |
|------|------|--------|
| T1 | `supabase/migrations/20260602000004_notification_config.sql` | Create table + RLS + grants |
| T2 | `src/types.ts` | Remove `targetNumber` from `NotificationConfig`; add `DbNotificationConfig` |
| T3 | `src/initialData.ts` + `src/lib/supabaseClient.ts` | Remove `targetNumber` from INITIAL_CONFIG; add `notificationConfigService` |
| T4 | `src/components/NotificationSettingsScreen.tsx` | Load from Supabase on mount; save to Supabase on submit; remove targetNumber UI |
