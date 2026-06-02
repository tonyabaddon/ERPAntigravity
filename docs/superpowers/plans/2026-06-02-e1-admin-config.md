# E1: Admin Configuration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Pengaturan Sistem" screen for managing bank account details and WA notification recipients, and fix the WhatsApp number enable/AI toggles so they persist to the database.

**Architecture:** Six independent tasks in dependency order: SQL migration first (must be applied before frontend can write), then types, then services, then the new screen, then wiring, then the WA toggle fix. Each task builds cleanly and the build must pass after each one.

**Tech Stack:** React, TypeScript, Tailwind CSS, Supabase JS client (`@supabase/supabase-js`), Lucide React icons

**Prerequisite:** Apply the SQL migration (Task 1) in Supabase dashboard before running the app with Tasks 2–6. `npm run build` must pass before starting.

---

## File Map

| File | Change |
|------|--------|
| New: `supabase/migrations/20260602000003_admin_write_grants.sql` | Anon write grants for bank_config, wa_recipients, whatsapp_numbers |
| Modify: `src/types.ts` | Add `'settings'` to ActivePage; add DbBankConfig and DbWaRecipient |
| Modify: `src/lib/supabaseClient.ts` | Add bankConfigService and waRecipientsService |
| New: `src/components/PengaturanScreen.tsx` | Settings screen with two sections |
| Modify: `src/components/Sidebar.tsx` | Add Pengaturan nav entry |
| Modify: `src/App.tsx` | Import PengaturanScreen, add 'settings' case |
| Modify: `src/components/WhatsappAiScreen.tsx` | Fix toggle handlers + fix field mapping bug |

---

### Task 1: Create SQL migration file

**Files:**
- Create: `supabase/migrations/20260602000003_admin_write_grants.sql`

**Context:** The Supabase anon key (used by the frontend) can currently only SELECT from `bank_config`, `wa_recipients`, and `whatsapp_numbers`. This migration grants the anon role write access so the admin dashboard can manage these tables without exposing the service role key. All statements are idempotent.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260602000003_admin_write_grants.sql` with this exact content:

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

- [ ] **Step 2: Apply the migration manually**

Paste the entire file content into **Supabase dashboard → SQL Editor → Run**. Verify it completes with no errors. This step cannot be automated — it must be done before the frontend changes will work.

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/20260602000003_admin_write_grants.sql
git commit -m "feat(db): grant anon write access to bank_config, wa_recipients, whatsapp_numbers"
```

---

### Task 2: Add types to `src/types.ts`

**Files:**
- Modify: `src/types.ts`

**Context:** `ActivePage` is at line 161. `DbOrder` ends around line 159. We add `'settings'` to the page union and two new DB-aligned interfaces.

- [ ] **Step 1: Add `'settings'` to `ActivePage`**

In `src/types.ts`, replace line 161:

```typescript
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai';
```

With:

```typescript
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings';
```

- [ ] **Step 2: Add `DbBankConfig` and `DbWaRecipient` interfaces**

After the closing `}` of the `DbOrder` interface (line 159), add:

```typescript
export interface DbBankConfig {
  id: number;
  bank_name: string;
  account_number: string;
  account_name: string;
  is_active: boolean;
  updated_at: string;
}

export interface DbWaRecipient {
  id: number;
  role: 'admin' | 'owner';
  name: string;
  wa_number: string;
  is_active: boolean;
  created_at: string;
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -10
```

Expected: zero TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add DbBankConfig, DbWaRecipient, and 'settings' to ActivePage"
```

---

### Task 3: Add `bankConfigService` and `waRecipientsService` to `src/lib/supabaseClient.ts`

**Files:**
- Modify: `src/lib/supabaseClient.ts`

**Context:** The file currently imports `DbConversation`, `DbMessage`, `DbOrder` from types. We need to also import `DbBankConfig` and `DbWaRecipient`. The new services go after `statsService` at the end of the file (currently line 247 is the closing `};` of statsService).

- [ ] **Step 1: Add `DbBankConfig` and `DbWaRecipient` to the import line**

In `src/lib/supabaseClient.ts`, replace line 7:

```typescript
import type { DbConversation, DbMessage, DbOrder } from '../types';
```

With:

```typescript
import type { DbConversation, DbMessage, DbOrder, DbBankConfig, DbWaRecipient } from '../types';
```

- [ ] **Step 2: Add `bankConfigService` after `statsService`**

After the closing `};` of `statsService` (end of file), add:

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

- [ ] **Step 3: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -10
```

Expected: zero TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(supabase): add bankConfigService and waRecipientsService"
```

---

### Task 4: Create `src/components/PengaturanScreen.tsx`

**Files:**
- Create: `src/components/PengaturanScreen.tsx`

**Context:** A new self-contained screen with two white cards: bank config (single active row, inline edit) and WA recipients (list with add/toggle/delete). It manages its own data fetching via the two services added in Task 3. No props are passed down — it fetches directly.

The card style matches the rest of the app: `bg-white rounded-xl border border-gray-200 p-6`.

- [ ] **Step 1: Create the file with the complete implementation**

Create `src/components/PengaturanScreen.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { Settings, Building2, Users, Plus, Trash2, ToggleLeft, ToggleRight, Edit2, Save, X } from 'lucide-react';
import { DbBankConfig, DbWaRecipient } from '../types';
import { bankConfigService, waRecipientsService, isSupabaseConfigured } from '../lib/supabaseClient';

interface PengaturanScreenProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export default function PengaturanScreen({ showToast }: PengaturanScreenProps) {
  // Bank config state
  const [bankConfig, setBankConfig] = useState<DbBankConfig | null>(null);
  const [bankLoading, setBankLoading] = useState(true);
  const [bankEditing, setBankEditing] = useState(false);
  const [bankForm, setBankForm] = useState({ bank_name: '', account_number: '', account_name: '' });
  const [bankSaving, setBankSaving] = useState(false);

  // WA recipients state
  const [recipients, setRecipients] = useState<DbWaRecipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<{ role: 'admin' | 'owner'; name: string; wa_number: string }>({
    role: 'admin',
    name: '',
    wa_number: '',
  });
  const [addSaving, setAddSaving] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setBankLoading(false);
      setRecipientsLoading(false);
      return;
    }
    Promise.all([bankConfigService.fetch(), waRecipientsService.fetchAll()])
      .then(([bank, recips]) => {
        setBankConfig(bank);
        setRecipients(recips);
      })
      .catch(err => {
        console.error('PengaturanScreen load error:', err);
        showToast('Gagal memuat data pengaturan.', 'warning');
      })
      .finally(() => {
        setBankLoading(false);
        setRecipientsLoading(false);
      });
  }, []);

  // Bank config handlers
  const startEdit = () => {
    setBankForm({
      bank_name: bankConfig?.bank_name ?? '',
      account_number: bankConfig?.account_number ?? '',
      account_name: bankConfig?.account_name ?? '',
    });
    setBankEditing(true);
  };

  const cancelEdit = () => {
    setBankEditing(false);
  };

  const saveBank = async (): Promise<void> => {
    if (!bankForm.bank_name || !bankForm.account_number || !bankForm.account_name) {
      showToast('Semua kolom rekening wajib diisi.', 'warning');
      return;
    }
    setBankSaving(true);
    try {
      await bankConfigService.save(bankForm, bankConfig?.id);
      const updated = await bankConfigService.fetch();
      setBankConfig(updated);
      setBankEditing(false);
      showToast('Rekening bank berhasil disimpan.', 'success');
    } catch (err) {
      console.error('saveBank error:', err);
      showToast('Gagal menyimpan rekening bank.', 'warning');
    } finally {
      setBankSaving(false);
    }
  };

  // WA recipients handlers
  const handleToggleRecipient = async (id: number, currentActive: boolean): Promise<void> => {
    const newActive = !currentActive;
    setRecipients(prev => prev.map(r => r.id === id ? { ...r, is_active: newActive } : r));
    try {
      await waRecipientsService.toggleActive(id, newActive);
    } catch (err) {
      console.error('toggleActive error:', err);
      setRecipients(prev => prev.map(r => r.id === id ? { ...r, is_active: currentActive } : r));
      showToast('Gagal mengubah status penerima.', 'warning');
    }
  };

  const handleDeleteRecipient = async (id: number, waNumber: string): Promise<void> => {
    if (!window.confirm(`Hapus penerima ${waNumber}?`)) return;
    setRecipients(prev => prev.filter(r => r.id !== id));
    try {
      await waRecipientsService.remove(id);
      showToast('Penerima berhasil dihapus.', 'success');
    } catch (err) {
      console.error('remove recipient error:', err);
      showToast('Gagal menghapus penerima.', 'warning');
      const refreshed = await waRecipientsService.fetchAll();
      setRecipients(refreshed);
    }
  };

  const handleAddRecipient = async (): Promise<void> => {
    if (!addForm.name || !addForm.wa_number) {
      showToast('Nama dan nomor WA wajib diisi.', 'warning');
      return;
    }
    setAddSaving(true);
    try {
      await waRecipientsService.add(addForm);
      const refreshed = await waRecipientsService.fetchAll();
      setRecipients(refreshed);
      setAddForm({ role: 'admin', name: '', wa_number: '' });
      setShowAddForm(false);
      showToast('Penerima berhasil ditambahkan.', 'success');
    } catch (err) {
      console.error('add recipient error:', err);
      showToast('Gagal menambahkan penerima.', 'warning');
    } finally {
      setAddSaving(false);
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-800">Pengaturan Sistem</h1>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-yellow-800 text-sm font-medium">
          Supabase belum dikonfigurasi. Tambahkan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY ke file .env untuk menggunakan fitur ini.
        </div>
      </div>
    );
  }

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
            <button onClick={startEdit} className="p-2 rounded-lg hover:bg-gray-100" title="Edit rekening">
              <Edit2 className="w-4 h-4 text-gray-600" />
            </button>
          )}
        </div>

        {bankLoading ? (
          <p className="text-sm text-gray-400">Memuat...</p>
        ) : bankEditing ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Nama Bank</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Contoh: BCA"
                value={bankForm.bank_name}
                onChange={e => setBankForm(prev => ({ ...prev, bank_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Nomor Rekening</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Contoh: 1234567890"
                value={bankForm.account_number}
                onChange={e => setBankForm(prev => ({ ...prev, account_number: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Nama Pemilik Rekening</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Contoh: PT Garindo Jaya Panel"
                value={bankForm.account_name}
                onChange={e => setBankForm(prev => ({ ...prev, account_name: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={saveBank}
                disabled={bankSaving}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {bankSaving ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button
                onClick={cancelEdit}
                disabled={bankSaving}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
                Batal
              </button>
            </div>
          </div>
        ) : bankConfig ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-sm">
              <span className="w-40 text-gray-500 font-medium">Nama Bank</span>
              <span className="font-semibold text-gray-800">{bankConfig.bank_name}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="w-40 text-gray-500 font-medium">Nomor Rekening</span>
              <span className="font-mono font-semibold text-gray-800">{bankConfig.account_number}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="w-40 text-gray-500 font-medium">Atas Nama</span>
              <span className="font-semibold text-gray-800">{bankConfig.account_name}</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Detail ini tampil di setiap invoice yang dikirim ke pelanggan.
            </p>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-sm text-gray-500 mb-3">Belum ada rekening tersimpan.</p>
            <button
              onClick={startEdit}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 mx-auto"
            >
              <Plus className="w-4 h-4" />
              Tambah Rekening
            </button>
          </div>
        )}
      </div>

      {/* WA recipients card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-bold text-gray-800">Penerima Notifikasi WA</h2>
          </div>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700"
            >
              <Plus className="w-4 h-4" /> Tambah Penerima
            </button>
          )}
        </div>

        {recipientsLoading ? (
          <p className="text-sm text-gray-400">Memuat...</p>
        ) : (
          <>
            {recipients.length === 0 && !showAddForm ? (
              <p className="text-sm text-gray-500 py-4 text-center">
                Belum ada penerima notifikasi. Tambahkan nomor admin yang akan menerima notifikasi pembayaran.
              </p>
            ) : (
              <div className="space-y-2 mb-3">
                {recipients.map(r => (
                  <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-800 truncate">{r.name}</span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          r.role === 'owner' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {r.role === 'owner' ? 'Owner' : 'Admin'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{r.wa_number}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleToggleRecipient(r.id, r.is_active)}
                        title={r.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        className="text-gray-400 hover:text-gray-700"
                      >
                        {r.is_active
                          ? <ToggleRight className="w-6 h-6 text-emerald-500" />
                          : <ToggleLeft className="w-6 h-6 text-gray-300" />
                        }
                      </button>
                      <button
                        onClick={() => handleDeleteRecipient(r.id, r.wa_number)}
                        title="Hapus"
                        className="text-gray-300 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showAddForm && (
              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
                <p className="text-sm font-semibold text-gray-700">Tambah Penerima Baru</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Nama</label>
                    <input
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Nama admin"
                      value={addForm.name}
                      onChange={e => setAddForm(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">Role</label>
                    <select
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      value={addForm.role}
                      onChange={e => setAddForm(prev => ({ ...prev, role: e.target.value as 'admin' | 'owner' }))}
                    >
                      <option value="admin">Admin</option>
                      <option value="owner">Owner</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Nomor WA</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="628xxxx"
                    value={addForm.wa_number}
                    onChange={e => setAddForm(prev => ({ ...prev, wa_number: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAddRecipient}
                    disabled={addSaving}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {addSaving ? 'Menyimpan...' : 'Simpan'}
                  </button>
                  <button
                    onClick={() => { setShowAddForm(false); setAddForm({ role: 'admin', name: '', wa_number: '' }); }}
                    disabled={addSaving}
                    className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                    Batal
                  </button>
                </div>
              </div>
            )}

            <p className="text-xs text-gray-400 mt-3">
              Nomor-nomor ini menerima notifikasi WA saat pelanggan mengunggah bukti pembayaran, admin memverifikasi, atau pesanan disetujui.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -10
```

Expected: zero TypeScript errors. `PengaturanScreen` is defined but not yet imported anywhere — that's fine, no unused-export error in Vite.

- [ ] **Step 3: Commit**

```bash
git add src/components/PengaturanScreen.tsx
git commit -m "feat(ui): add PengaturanScreen with bank config and WA recipients management"
```

---

### Task 5: Wire Sidebar and App.tsx

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

**Context:** `Sidebar.tsx` already imports `Settings` from lucide-react (line 13) but doesn't use it in `menuItems`. `App.tsx` uses a `switch(activePage)` in `renderPage()` starting at line 171. We add the Pengaturan entry between 'whatsapp-ai' and the bottom of the list.

- [ ] **Step 1: Add "Pengaturan" to `menuItems` in `Sidebar.tsx`**

In `src/components/Sidebar.tsx`, find the `menuItems` array (around line 34). After the `whatsapp-ai` entry (the last item, around line 66–70), add:

```tsx
    {
      id: 'settings' as ActivePage,
      label: 'Pengaturan',
      icon: Settings,
      description: 'Konfigurasi Sistem',
    },
```

The full updated `menuItems` array should be:

```tsx
  const menuItems = [
    {
      id: 'dashboard' as ActivePage,
      label: 'Dashboard',
      icon: LayoutDashboard,
      description: 'Ringkasan Toko'
    },
    {
      id: 'sales-inbox' as ActivePage,
      label: 'Sales Inbox',
      icon: Inbox,
      description: 'Percakapan WA'
    },
    {
      id: 'ai-stock' as ActivePage,
      label: 'AI Stock Manager',
      icon: Package,
      description: 'Stok & Harga'
    },
    {
      id: 'user-management' as ActivePage,
      label: 'User Management',
      icon: Users,
      description: 'Akses Admin'
    },
    {
      id: 'notifications' as ActivePage,
      label: 'Notification Settings',
      icon: Bell,
      description: 'Detak Jantung WA'
    },
    {
      id: 'whatsapp-ai' as ActivePage,
      label: 'WhatsApp AI',
      icon: Bot,
      description: 'whatsmeow & Gemini'
    },
    {
      id: 'settings' as ActivePage,
      label: 'Pengaturan',
      icon: Settings,
      description: 'Konfigurasi Sistem',
    },
  ];
```

- [ ] **Step 2: Import `PengaturanScreen` in `App.tsx`**

In `src/App.tsx`, after the `WhatsappAiScreen` import line (line 29), add:

```typescript
import PengaturanScreen from './components/PengaturanScreen';
```

- [ ] **Step 3: Add `'settings'` case to the `renderPage()` switch in `App.tsx`**

In `src/App.tsx`, inside `renderPage()`, find the `case 'whatsapp-ai':` block (around line 207). After its closing `);`, add:

```tsx
      case 'settings':
        return (
          <PengaturanScreen showToast={triggerToast} />
        );
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -10
```

Expected: zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat(nav): add Pengaturan to sidebar and App.tsx routing"
```

---

### Task 6: Fix WhatsApp number toggles in `WhatsappAiScreen.tsx`

**Files:**
- Modify: `src/components/WhatsappAiScreen.tsx`

**Context:** Two bugs to fix together:

**Bug 1 (field mapping):** `WhatsappAiScreen` loads `whatsapp_numbers` rows from Supabase and casts them directly as `WhatsappAiNumber[]` (line 66). But the DB uses snake_case (`is_enabled`, `is_ai_enabled`, `phone_number`, `created_at`) while `WhatsappAiNumber` uses camelCase (`isEnabled`, `isAiEnabled`, `phoneNumber`, `createdAt`). At runtime, `num.isEnabled` is always `undefined`. This must be fixed with an explicit mapping.

**Bug 2 (no-op handlers):** `handleToggleEnable` and `handleToggleAiEnabled` only push a terminal log and show a toast — they never write to the DB.

- [ ] **Step 1: Fix the Supabase load mapping**

In `src/components/WhatsappAiScreen.tsx`, replace lines 65–68 (the `.then()` callback in the `useEffect`):

```typescript
    supabase.from('whatsapp_numbers').select('*').order('created_at').then(({ data }) => {
      if (data) setWaNumbers(data as WhatsappAiNumber[]);
      setLoading(false);
    });
```

With:

```typescript
    supabase.from('whatsapp_numbers').select('*').order('created_at').then(({ data }) => {
      if (data) setWaNumbers(data.map(row => ({
        id: row.id,
        phoneNumber: row.phone_number,
        name: row.name,
        status: row.status,
        isEnabled: row.is_enabled,
        isAiEnabled: row.is_ai_enabled,
        createdAt: row.created_at,
      } as WhatsappAiNumber)));
      setLoading(false);
    });
```

- [ ] **Step 2: Fix the Realtime UPDATE handler**

In the same `useEffect`, find the Realtime channel callback (around lines 72–77):

```typescript
        (payload) => {
          setWaNumbers(prev =>
            prev.map(n => n.id === payload.new.id ? { ...n, ...payload.new } as WhatsappAiNumber : n)
          );
        })
```

Replace with a proper mapping so camelCase fields are updated correctly:

```typescript
        (payload) => {
          const row = payload.new;
          setWaNumbers(prev => prev.map(n => n.id === row.id ? {
            ...n,
            isEnabled: row.is_enabled,
            isAiEnabled: row.is_ai_enabled,
            status: row.status,
          } : n));
        })
```

- [ ] **Step 3: Replace `handleToggleEnable` with a real Supabase UPDATE**

Find `handleToggleEnable` (around line 160–166) and replace the entire function:

```typescript
  const handleToggleEnable = async (id: string): Promise<void> => {
    const num = waNumbers.find(n => n.id === id);
    if (!num) return;
    const newValue = !num.isEnabled;
    setWaNumbers(prev => prev.map(n => n.id === id ? { ...n, isEnabled: newValue } : n));
    try {
      const { error } = await supabase!.from('whatsapp_numbers')
        .update({ is_enabled: newValue })
        .eq('id', id);
      if (error) throw error;
      showToast(`Nomor ${num.phoneNumber} ${newValue ? 'diaktifkan' : 'dinonaktifkan'}.`, 'success');
    } catch (err) {
      console.error('handleToggleEnable error:', err);
      setWaNumbers(prev => prev.map(n => n.id === id ? { ...n, isEnabled: !newValue } : n));
      showToast('Gagal mengubah status nomor.', 'warning');
    }
  };
```

- [ ] **Step 4: Replace `handleToggleAiEnabled` with a real Supabase UPDATE**

Find `handleToggleAiEnabled` (around line 168–174) and replace the entire function:

```typescript
  const handleToggleAiEnabled = async (id: string): Promise<void> => {
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
      console.error('handleToggleAiEnabled error:', err);
      setWaNumbers(prev => prev.map(n => n.id === id ? { ...n, isAiEnabled: !newValue } : n));
      showToast('Gagal mengubah status AI.', 'warning');
    }
  };
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -10
```

Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/WhatsappAiScreen.tsx
git commit -m "fix(whatsapp): fix field mapping bug and persist is_enabled/is_ai_enabled toggles to DB"
```

---

## E1 Complete

After all 6 tasks: `npm run build` passes with zero errors.

**Manual smoke test:**
1. Apply migration in Supabase SQL Editor (Task 1, Step 2) if not already done
2. Navigate to "Pengaturan" in the sidebar — page loads with both cards
3. Add a bank account (Tambah Rekening) — verify row in `bank_config` table in Supabase
4. Edit the bank account — verify `updated_at` timestamp changes in DB
5. Add a WA recipient with role "admin" — verify row in `wa_recipients` table
6. Toggle a recipient inactive — verify `is_active = false` in DB
7. Delete a recipient — verify row removed from DB
8. Go to WhatsApp AI screen — WA numbers now show correct enabled/AI state from DB
9. Toggle `is_enabled` off for a number — verify `whatsapp_numbers.is_enabled = false` in DB
10. Toggle `is_ai_enabled` off — verify `whatsapp_numbers.is_ai_enabled = false` in DB
