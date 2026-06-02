# E1: Admin Configuration — Implementation Design

**Goal:** Give admins a dedicated "Pengaturan Sistem" screen to manage bank account details and WA notification recipients, and fix the WhatsApp number enable/AI-toggle buttons so they persist to the database.

**Architecture:** One new screen (`PengaturanScreen`), one new SQL migration (anon write grants), two service objects in `supabaseClient.ts`, two toggle fixes in `WhatsappAiScreen`, sidebar + routing wired in `Sidebar.tsx` and `App.tsx`.

**Tech Stack:** React + TypeScript, Supabase JS client, Tailwind CSS, Lucide React icons

**Module path:** `src/` (Vite + React frontend)

**Build check:** `npm run build` must pass with zero TypeScript errors after each task.

**Do NOT touch:** `backend-go/` directory, `backend-go/internal/` Go source.

**Migration note:** The SQL migration must be applied manually in Supabase dashboard SQL Editor before the frontend changes are deployed.

---

## Background

The backend already uses `bank_config` and `wa_recipients` tables in production flows:
- `GetActiveBankConfig()` — called by `HandleApprovedOrder` to populate every invoice sent to customers. Falls back to hardcoded BCA details if no DB row exists.
- `GetActiveRecipients()` — called to send WA notifications on payment upload, payment verification, and order approval. Falls back to no notifications if the table is empty.

Both tables are currently read-only from the frontend (SELECT only policies). Admins must use the Supabase dashboard to edit them, which is not acceptable for a production admin tool.

The `whatsapp_numbers` table tracks connected WA numbers. `is_enabled` and `is_ai_enabled` toggles in `WhatsappAiScreen` currently show toast messages directing admins to the Supabase dashboard instead of actually writing to the DB.

---

## Database Schema Reference

**`bank_config`** (one active row at a time):
```
id             serial PRIMARY KEY
bank_name      text NOT NULL
account_number text NOT NULL
account_name   text NOT NULL
is_active      boolean NOT NULL DEFAULT true
updated_at     timestamptz NOT NULL DEFAULT now()
```

**`wa_recipients`** (multiple rows, one per admin/owner number):
```
id         serial PRIMARY KEY
role       text NOT NULL  -- 'admin' or 'owner'
name       text NOT NULL DEFAULT ''
wa_number  text NOT NULL  -- format: 628xxx
is_active  boolean NOT NULL DEFAULT true
created_at timestamptz NOT NULL DEFAULT now()
```

**`whatsapp_numbers`** (one row per registered WA number):
```
id            text PRIMARY KEY
phone_number  text NOT NULL
name          text NOT NULL
status        wa_number_status NOT NULL  -- CONNECTED/DISCONNECTED/etc.
is_enabled    boolean NOT NULL DEFAULT true
is_ai_enabled boolean NOT NULL DEFAULT true
created_at    timestamptz NOT NULL DEFAULT now()
```

---

## File Map

| File | Change |
|------|--------|
| New: `supabase/migrations/20260602000003_admin_write_grants.sql` | Grant anon INSERT/UPDATE on `bank_config`, INSERT/UPDATE/DELETE on `wa_recipients`, column-level UPDATE on `whatsapp_numbers` |
| Modify: `src/types.ts` | Add `'settings'` to `ActivePage` union; add `DbBankConfig` and `DbWaRecipient` interfaces |
| Modify: `src/lib/supabaseClient.ts` | Add `bankConfigService` and `waRecipientsService` exports |
| New: `src/components/PengaturanScreen.tsx` | Settings screen with bank config + WA recipients sections |
| Modify: `src/components/Sidebar.tsx` | Add "Pengaturan" nav entry with Settings icon |
| Modify: `src/App.tsx` | Render `PengaturanScreen` for `activePage === 'settings'` |
| Modify: `src/components/WhatsappAiScreen.tsx` | Fix `handleToggleEnable` and `handleToggleAiEnabled` to write to Supabase |

---

## Sub-project E1-T1: SQL Migration

**File:** `supabase/migrations/20260602000003_admin_write_grants.sql`

Grant the anon role (used by the Supabase JS client with the publishable key) write access to the three tables. All statements are idempotent.

```sql
-- supabase/migrations/20260602000003_admin_write_grants.sql
-- Grant anon write access to bank_config, wa_recipients, whatsapp_numbers
-- so the admin dashboard can manage these tables without the service role key.

-- bank_config: anon may INSERT (first-time setup) and UPDATE (editing the active row)
GRANT INSERT, UPDATE ON bank_config TO anon;
GRANT USAGE ON SEQUENCE bank_config_id_seq TO anon;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bank_config' AND policyname = 'anon_insert_bank_config'
  ) THEN
    CREATE POLICY "anon_insert_bank_config" ON bank_config FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bank_config' AND policyname = 'anon_update_bank_config'
  ) THEN
    CREATE POLICY "anon_update_bank_config" ON bank_config FOR UPDATE TO anon USING (true);
  END IF;
END $$;

-- wa_recipients: anon may INSERT (add recipient), UPDATE (toggle is_active), DELETE (remove)
GRANT INSERT, UPDATE, DELETE ON wa_recipients TO anon;
GRANT USAGE ON SEQUENCE wa_recipients_id_seq TO anon;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wa_recipients' AND policyname = 'anon_insert_wa_recipients'
  ) THEN
    CREATE POLICY "anon_insert_wa_recipients" ON wa_recipients FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wa_recipients' AND policyname = 'anon_update_wa_recipients'
  ) THEN
    CREATE POLICY "anon_update_wa_recipients" ON wa_recipients FOR UPDATE TO anon USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'wa_recipients' AND policyname = 'anon_delete_wa_recipients'
  ) THEN
    CREATE POLICY "anon_delete_wa_recipients" ON wa_recipients FOR DELETE TO anon USING (true);
  END IF;
END $$;

-- whatsapp_numbers: anon may update is_enabled and is_ai_enabled columns only
GRANT UPDATE (is_enabled, is_ai_enabled) ON whatsapp_numbers TO anon;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_numbers' AND policyname = 'anon_update_wa_numbers_toggles'
  ) THEN
    CREATE POLICY "anon_update_wa_numbers_toggles" ON whatsapp_numbers FOR UPDATE TO anon USING (true);
  END IF;
END $$;
```

**Apply manually:** paste into Supabase dashboard → SQL Editor → Run.

---

## Sub-project E1-T2: Types

**File:** `src/types.ts`

**1. Add `'settings'` to `ActivePage`:**
```typescript
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings';
```

**2. Add `DbBankConfig` interface** (after `DbOrder`):
```typescript
export interface DbBankConfig {
  id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_active: boolean;
  updated_at: string;
}
```

**3. Add `DbWaRecipient` interface** (after `DbBankConfig`):
```typescript
export interface DbWaRecipient {
  id: number;
  role: 'admin' | 'owner';
  name: string;
  wa_number: string;
  is_active: boolean;
  created_at: string;
}
```

---

## Sub-project E1-T3: supabaseClient.ts — new services

**File:** `src/lib/supabaseClient.ts`

Add two new exported service objects at the bottom of the file (after `statsService`).

**`bankConfigService`:**
```typescript
export const bankConfigService = {
  async fetch(): Promise<DbBankConfig | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('bank_config')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  async save(values: { bank_name: string; account_number: string; account_name: string }, existingId?: number): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    if (existingId !== undefined) {
      const { error } = await supabase
        .from('bank_config')
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', existingId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('bank_config')
        .insert({ ...values, is_active: true });
      if (error) throw error;
    }
  },
};
```

**`waRecipientsService`:**
```typescript
export const waRecipientsService = {
  async fetchAll(): Promise<DbWaRecipient[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('wa_recipients')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async add(values: { role: 'admin' | 'owner'; name: string; wa_number: string }): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('wa_recipients')
      .insert({ ...values, is_active: true });
    if (error) throw error;
  },

  async toggleActive(id: number, isActive: boolean): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('wa_recipients')
      .update({ is_active: isActive })
      .eq('id', id);
    if (error) throw error;
  },

  async remove(id: number): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('wa_recipients')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};
```

Both services require `DbBankConfig` and `DbWaRecipient` imported from `../types`.

---

## Sub-project E1-T4: PengaturanScreen component

**File:** `src/components/PengaturanScreen.tsx` (new file)

### Imports needed
```typescript
import React, { useState, useEffect } from 'react';
import { Settings, Building2, Users, Plus, Trash2, ToggleLeft, ToggleRight, Edit2, Save, X } from 'lucide-react';
import { DbBankConfig, DbWaRecipient } from '../types';
import { bankConfigService, waRecipientsService, isSupabaseConfigured } from '../lib/supabaseClient';
```

### Props
```typescript
interface PengaturanScreenProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}
```

### Component structure

**State:**
```typescript
const [bankConfig, setBankConfig] = useState<DbBankConfig | null>(null);
const [bankLoading, setBankLoading] = useState(true);
const [bankEditing, setBankEditing] = useState(false);
const [bankForm, setBankForm] = useState({ bank_name: '', account_number: '', account_name: '' });
const [bankSaving, setBankSaving] = useState(false);

const [recipients, setRecipients] = useState<DbWaRecipient[]>([]);
const [recipientsLoading, setRecipientsLoading] = useState(true);
const [showAddForm, setShowAddForm] = useState(false);
const [addForm, setAddForm] = useState({ role: 'admin' as 'admin' | 'owner', name: '', wa_number: '' });
const [addSaving, setAddSaving] = useState(false);
```

**On mount:** Load both via `Promise.all([bankConfigService.fetch(), waRecipientsService.fetchAll()])`. Set state from results.

**Bank config section behavior:**
- Default view: shows `bank_name`, `account_number`, `account_name` in read-only rows with an "Edit" (pencil) button in the top-right of the card
- Clicking "Edit": pre-fills `bankForm` from `bankConfig`, sets `bankEditing = true`, fields become `<input>` elements
- Clicking "Simpan": calls `bankConfigService.save(bankForm, bankConfig?.id)`, updates local state, sets `bankEditing = false`
- Clicking "Batal": resets `bankForm`, sets `bankEditing = false`
- Empty state (no DB row): shows "Belum ada rekening tersimpan" + "Tambah Rekening" button that sets `bankEditing = true` with empty form

**WA recipients section behavior:**
- List: each row shows name, WA number, role badge (admin = `bg-blue-100 text-blue-700`, owner = `bg-purple-100 text-purple-700`), active toggle, delete button
- Toggle: calls `waRecipientsService.toggleActive(id, !current)` then updates local state optimistically
- Delete: shows `window.confirm('Hapus penerima ini?')`, calls `waRecipientsService.remove(id)`, filters from local state
- "+ Tambah Penerima" opens inline add form below the list: name input, WA number input (placeholder: "628xxxx"), role `<select>` (Admin / Owner), Save + Cancel buttons
- On save: calls `waRecipientsService.add(addForm)`, re-fetches full list, resets form

**Empty state (no recipients):** Shows "Belum ada penerima notifikasi. Tambahkan nomor admin yang akan menerima notifikasi pembayaran." with the add button.

**Note text below recipients section:** "Nomor-nomor ini menerima notifikasi WA saat pelanggan mengunggah bukti pembayaran, admin memverifikasi, atau pesanan disetujui."

### JSX skeleton
```tsx
export default function PengaturanScreen({ showToast }: PengaturanScreenProps) {
  // ... state and handlers ...
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-800">Pengaturan Sistem</h1>
      </div>

      {/* Bank config card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-bold text-gray-800">Rekening Bank</h2>
          </div>
          {bankConfig && !bankEditing && (
            <button onClick={startEdit} className="p-2 rounded-lg hover:bg-gray-100">
              <Edit2 className="w-4 h-4 text-gray-600" />
            </button>
          )}
        </div>
        {/* bank content — read/edit views */}
      </div>

      {/* WA recipients card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-bold text-gray-800">Penerima Notifikasi WA</h2>
          </div>
          <button onClick={() => setShowAddForm(true)} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700">
            <Plus className="w-4 h-4" /> Tambah Penerima
          </button>
        </div>
        {/* recipients list + add form */}
      </div>
    </div>
  );
}
```

---

## Sub-project E1-T5: Sidebar + App.tsx wiring

### Sidebar.tsx

Add "Pengaturan" entry to the nav list. Import `Settings` from lucide-react (already in the codebase). Add nav item:

```tsx
{
  id: 'settings',
  label: 'Pengaturan',
  icon: <Settings className="w-5 h-5" />,
}
```

Position: after the "Notifikasi" entry (second to last, before auth/user management).

### App.tsx

**1. Import `PengaturanScreen`:**
```typescript
import PengaturanScreen from './components/PengaturanScreen';
```

**2. Add case in the `renderActivePage` switch** (or equivalent conditional render):
```tsx
case 'settings':
  return <PengaturanScreen showToast={triggerToast} />;
```

No new state needed in App.tsx — `PengaturanScreen` manages its own data fetching.

---

## Sub-project E1-T6: Fix WhatsappAiScreen toggles

**File:** `src/components/WhatsappAiScreen.tsx`

### Fix `handleToggleEnable`

Replace the toast-only handler with an actual Supabase UPDATE:

```typescript
const handleToggleEnable = async (id: string) => {
  const num = waNumbers.find(n => n.id === id);
  if (!num) return;
  const newValue = !num.isEnabled;
  // Optimistic update
  setWaNumbers(prev => prev.map(n => n.id === id ? { ...n, isEnabled: newValue } : n));
  try {
    const { error } = await supabase!.from('whatsapp_numbers')
      .update({ is_enabled: newValue })
      .eq('id', id);
    if (error) throw error;
    showToast(`Nomor ${num.phoneNumber} ${newValue ? 'diaktifkan' : 'dinonaktifkan'}.`, 'success');
  } catch (err) {
    // Revert on failure
    setWaNumbers(prev => prev.map(n => n.id === id ? { ...n, isEnabled: !newValue } : n));
    showToast('Gagal mengubah status nomor.', 'warning');
  }
};
```

### Fix `handleToggleAiEnabled`

```typescript
const handleToggleAiEnabled = async (id: string) => {
  const num = waNumbers.find(n => n.id === id);
  if (!num) return;
  const newValue = !num.isAiEnabled;
  setWaNumbers(prev => prev.map(n => n.id === id ? { ...n, isAiEnabled: newValue } : n));
  try {
    const { error } = await supabase!.from('whatsapp_numbers')
      .update({ is_ai_enabled: newValue })
      .eq('id', id);
    if (error) throw error;
    showToast(`Auto-reply AI untuk ${num.phoneNumber} ${newValue ? 'diaktifkan' : 'dinonaktifkan'}.`, 'success');
  } catch (err) {
    setWaNumbers(prev => prev.map(n => n.id === id ? { ...n, isAiEnabled: !newValue } : n));
    showToast('Gagal mengubah status AI.', 'warning');
  }
};
```

Note: `supabase` is already imported in `WhatsappAiScreen.tsx` via `import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'`. The `!` non-null assertion is safe here because the toggles are only rendered when Supabase is configured (the WA numbers list is loaded from Supabase, so if we're showing numbers, Supabase is available).

Check the `waNumbers` item type in that file — verify field names `isEnabled` and `isAiEnabled` match the mapped state shape. If the component maps `is_enabled → isEnabled` and `is_ai_enabled → isAiEnabled` on load, the optimistic update above is correct. If it uses snake_case directly, adjust accordingly.

---

## Error Handling Rules

- All Supabase errors: `console.error` + `showToast('...', 'warning')`
- Bank config save failure: revert `bankEditing = true` so admin can retry
- WA recipient add failure: keep the add form open so admin can retry
- Toggle failure: optimistic revert + warning toast (pattern matches D2's optimistic removal)
- `isSupabaseConfigured = false`: show "Supabase belum dikonfigurasi" placeholder in each section instead of the content

## TypeScript Rules

- No `any` — use `DbBankConfig` and `DbWaRecipient` throughout
- All async handlers have explicit `Promise<void>` return type
- `npm run build` zero errors after each task

## Manual Smoke Test (after all tasks)

1. Apply migration in Supabase SQL Editor
2. Open Pengaturan screen — both sections load without errors
3. Add a bank account — verify row appears in `bank_config` table in Supabase
4. Edit the bank account — verify `updated_at` changes in DB
5. Add a WA recipient with role "admin" — verify row in `wa_recipients`
6. Toggle a recipient inactive — verify `is_active = false` in DB
7. Delete a recipient — verify row removed from DB
8. In WhatsApp AI screen: toggle `is_enabled` off — verify `whatsapp_numbers.is_enabled = false` in DB
9. Toggle `is_ai_enabled` off — verify `whatsapp_numbers.is_ai_enabled = false` in DB
