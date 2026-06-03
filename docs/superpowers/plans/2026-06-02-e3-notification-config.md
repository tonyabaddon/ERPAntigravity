# E3: Notification Config Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `NotificationConfig` to a Supabase `notification_config` table; remove the redundant `targetNumber` field from the type, initial data, and UI.

**Architecture:** Four tasks — SQL migration, types + initialData, supabaseClient service, NotificationSettingsScreen update. Each task builds cleanly and the build must pass after each one.

**Tech Stack:** React, TypeScript, Tailwind CSS, Supabase JS client, Lucide React icons

---

## File Map

| File | Change |
|------|--------|
| New: `supabase/migrations/20260602000004_notification_config.sql` | Create table + RLS + anon grants |
| Modify: `src/types.ts` | Remove `targetNumber` from `NotificationConfig`; add `DbNotificationConfig` |
| Modify: `src/initialData.ts` | Remove `targetNumber: '81234567890'` from `INITIAL_CONFIG` |
| Modify: `src/lib/supabaseClient.ts` | Add `DbNotificationConfig` import; add `notificationConfigService` |
| Modify: `src/components/NotificationSettingsScreen.tsx` | Load from Supabase on mount; save to Supabase on submit; remove targetNumber box |

---

### Task 1: Create SQL migration

**Files:**
- Create: `supabase/migrations/20260602000004_notification_config.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260602000004_notification_config.sql` with this exact content:

```sql
-- supabase/migrations/20260602000004_notification_config.sql
-- Single-row notification config table readable by Go heartbeat poller.

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

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notification_config' AND policyname = 'anon_select_notification_config'
  ) THEN
    CREATE POLICY "anon_select_notification_config" ON notification_config FOR SELECT TO anon USING (true);
  END IF;
END $$;

GRANT INSERT, UPDATE ON notification_config TO anon;
GRANT USAGE ON SEQUENCE notification_config_id_seq TO anon;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notification_config' AND policyname = 'anon_insert_notification_config'
  ) THEN
    CREATE POLICY "anon_insert_notification_config" ON notification_config FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notification_config' AND policyname = 'anon_update_notification_config'
  ) THEN
    CREATE POLICY "anon_update_notification_config" ON notification_config FOR UPDATE TO anon USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'trg_notification_config_updated_at' AND event_object_table = 'notification_config'
  ) THEN
    CREATE TRIGGER trg_notification_config_updated_at
      BEFORE UPDATE ON notification_config
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use the Supabase MCP tool `mcp__plugin_supabase_supabase__apply_migration` with:
- `project_id`: `ekhhojaezdfjfwuxyjkl`
- `name`: `notification_config`
- `query`: the full SQL content above

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/20260602000004_notification_config.sql
git commit -m "feat(db): add notification_config table with RLS and anon grants"
```

---

### Task 2: Update types and initialData

**Files:**
- Modify: `src/types.ts`
- Modify: `src/initialData.ts`

**Context:** `NotificationConfig` is at lines 56–68 of `src/types.ts`. `targetNumber` is line 59. `INITIAL_CONFIG` is in `src/initialData.ts` at lines 66–78, `targetNumber` is line 69.

- [ ] **Step 1: Remove `targetNumber` from `NotificationConfig` in `src/types.ts`**

Replace the `NotificationConfig` interface:
```typescript
export interface NotificationConfig {
  enabled: boolean;
  interval: string;
  targetNumber: string;
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
With:
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

- [ ] **Step 2: Add `DbNotificationConfig` after `DbLead` in `src/types.ts`**

After the closing `}` of the `DbLead` interface (currently near the end of the file), add:

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

- [ ] **Step 3: Remove `targetNumber` from `INITIAL_CONFIG` in `src/initialData.ts`**

Replace:
```typescript
export const INITIAL_CONFIG: NotificationConfig = {
  enabled: true,
  interval: 'Setiap 4 Jam',
  targetNumber: '81234567890',
  reportComponents: {
    revenue: true,
    queue: true,
    activity: true,
    status: false,
  },
  lowStockAlert: 10,
  delayAlert: 30,
};
```
With:
```typescript
export const INITIAL_CONFIG: NotificationConfig = {
  enabled: true,
  interval: 'Setiap 4 Jam',
  reportComponents: {
    revenue: true,
    queue: true,
    activity: true,
    status: false,
  },
  lowStockAlert: 10,
  delayAlert: 30,
};
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -10
```

Expected: zero TypeScript errors. If `targetNumber` is referenced elsewhere (e.g., `App.tsx`), the compiler will point to the exact lines — fix them too before committing.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/initialData.ts
git commit -m "feat(types): remove targetNumber from NotificationConfig; add DbNotificationConfig"
```

---

### Task 3: Add `notificationConfigService` to supabaseClient.ts

**Files:**
- Modify: `src/lib/supabaseClient.ts`

**Context:** The import line currently is:
```typescript
import type { DbConversation, DbMessage, DbOrder, DbBankConfig, DbWaRecipient, DbCustomer, DbLead } from '../types';
```
The new service goes at the end of the file after `leadsService`.

- [ ] **Step 1: Add `DbNotificationConfig` to the import line**

Replace the import line with:
```typescript
import type { DbConversation, DbMessage, DbOrder, DbBankConfig, DbWaRecipient, DbCustomer, DbLead, DbNotificationConfig } from '../types';
```

- [ ] **Step 2: Add `notificationConfigService` at end of file**

After the closing `};` of `leadsService`, append:

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

- [ ] **Step 3: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -10
```

Expected: zero TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(supabase): add notificationConfigService with fetch and save"
```

---

### Task 4: Update `NotificationSettingsScreen.tsx`

**Files:**
- Modify: `src/components/NotificationSettingsScreen.tsx`

**Context:** The screen currently manages `targetNumber` state and renders a "Nomor WhatsApp Tujuan" box (the third box in the 3-column grid). We remove that field entirely and add Supabase load/save. The `onConfigChange` prop still exists — we call it after saving to keep localStorage in sync.

- [ ] **Step 1: Add imports and a `dbConfigId` ref**

Replace the current import block at the top of the file:
```typescript
import React, { useState } from 'react';
```
With:
```typescript
import React, { useState, useEffect, useRef } from 'react';
```

After the existing lucide-react import, add:
```typescript
import { notificationConfigService, isSupabaseConfigured } from '../lib/supabaseClient';
```

- [ ] **Step 2: Remove `targetNumber` state; add `dbConfigId` ref**

Inside the component, remove:
```typescript
const [targetNumber, setTargetNumber] = useState(config.targetNumber);
```

Add after the remaining state declarations:
```typescript
const dbConfigIdRef = useRef<number | undefined>(undefined);
```

- [ ] **Step 3: Add `useEffect` to load from Supabase on mount**

After the state declarations, add:
```typescript
useEffect(() => {
  if (!isSupabaseConfigured) return;
  notificationConfigService.fetch().then(row => {
    if (!row) return;
    dbConfigIdRef.current = row.id;
    setEnabled(row.enabled);
    setIntervalVal(row.interval_label);
    setRevenueChecked(row.report_revenue);
    setQueueChecked(row.report_queue);
    setActivityChecked(row.report_activity);
    setStatusChecked(row.report_status);
    setLowStockLimit(row.low_stock_alert);
    setDelayLimit(row.delay_alert);
  }).catch(err => console.error('notificationConfig load error:', err));
}, []);
```

- [ ] **Step 4: Update `handleSave` to save to Supabase**

Replace the current `handleSave` function:
```typescript
const handleSave = () => {
  const updated: NotificationConfig = {
    enabled,
    interval,
    targetNumber,
    reportComponents: {
      revenue: revenueChecked,
      queue: queueChecked,
      activity: activityChecked,
      status: statusChecked
    },
    lowStockAlert: lowStockLimit,
    delayAlert: delayLimit
  };
  onConfigChange(updated);
  showToast("✅ Pengaturan Berhasil Disimpan! Sistem 'Detak Jantung' otomatis aktif.");
};
```

With:
```typescript
const handleSave = async () => {
  const updated: NotificationConfig = {
    enabled,
    interval,
    reportComponents: {
      revenue: revenueChecked,
      queue: queueChecked,
      activity: activityChecked,
      status: statusChecked,
    },
    lowStockAlert: lowStockLimit,
    delayAlert: delayLimit,
  };

  if (isSupabaseConfigured) {
    try {
      await notificationConfigService.save({
        enabled,
        interval_label: interval,
        report_revenue: revenueChecked,
        report_queue: queueChecked,
        report_activity: activityChecked,
        report_status: statusChecked,
        low_stock_alert: lowStockLimit,
        delay_alert: delayLimit,
      }, dbConfigIdRef.current);
      if (dbConfigIdRef.current === undefined) {
        const row = await notificationConfigService.fetch();
        if (row) dbConfigIdRef.current = row.id;
      }
    } catch (err) {
      console.error('notificationConfig save error:', err);
      showToast("⚠️ Gagal menyimpan ke cloud. Tersimpan lokal.");
      onConfigChange(updated);
      return;
    }
  }

  onConfigChange(updated);
  showToast("✅ Pengaturan Berhasil Disimpan! Sistem 'Detak Jantung' otomatis aktif.");
};
```

- [ ] **Step 5: Remove the "Nomor WhatsApp Tujuan" box from JSX**

In the 3-column grid (currently renders 3 boxes: Status Layanan, Interval Pengiriman, Nomor WhatsApp Tujuan), remove the third box entirely:

Find and delete this JSX block:
```tsx
              {/* Box 3: Target number */}
              <div className="bg-[#eff4ff]/60 p-6 rounded-3xl flex flex-col justify-between hover:bg-white hover:shadow-lg hover:border-slate-100 border border-transparent transition-all group">
                <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-4">Nomor WhatsApp Tujuan</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-[#012749]/40 select-none">+62</span>
                  <input 
                    type="text" 
                    value={targetNumber}
                    onChange={(e) => setTargetNumber(e.target.value)}
                    className="w-full bg-transparent border-none text-sm font-extrabold text-[#012749] p-0 focus:ring-0 outline-none"
                    placeholder="81234567890"
                  />
                </div>
              </div>
```

Also change the grid from `grid-cols-1 md:grid-cols-3` to `grid-cols-1 md:grid-cols-2` since only 2 boxes remain.

- [ ] **Step 6: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -10
```

Expected: zero TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/NotificationSettingsScreen.tsx
git commit -m "feat(notifications): sync config with Supabase on load/save; remove targetNumber field"
```

---

## E3 Complete

After all 4 tasks: `npm run build` passes with zero errors.

**Manual smoke test:**
1. Navigate to "Notification Settings" — form loads (Supabase values override localStorage defaults if a row exists)
2. Change "Interval Pengiriman" to "Setiap 1 Jam", click Simpan — verify `notification_config` row in Supabase has `interval_label = 'Setiap 1 Jam'`
3. Reload the page — form reflects Supabase values, not localStorage defaults
4. Toggle "Aktifkan Laporan" off, save — verify `enabled = false` in DB
5. Confirm "Nomor WhatsApp Tujuan" box is gone from the UI
