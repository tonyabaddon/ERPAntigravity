# E2: Sales Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Pipeline Penjualan" screen showing all leads with their linked customer info, filterable by lead status.

**Architecture:** Four tasks in dependency order — types first, then service, then screen, then wiring. No writes, no Realtime. Data loads once on mount.

**Tech Stack:** React, TypeScript, Tailwind CSS, Supabase JS client, Lucide React icons

---

## File Map

| File | Change |
|------|--------|
| Modify: `src/types.ts` | Add DbCustomer, DbLead; add `'pipeline'` to ActivePage |
| Modify: `src/lib/supabaseClient.ts` | Add leadsService with fetchAll() using join |
| New: `src/components/PipelineScreen.tsx` | Read-only leads list with filter tabs |
| Modify: `src/components/Sidebar.tsx` | Add Pipeline nav entry with TrendingUp icon |
| Modify: `src/App.tsx` | Import PipelineScreen, add `'pipeline'` case |

---

### Task 1: Update `src/types.ts`

**Files:**
- Modify: `src/types.ts`

**Context:** `ActivePage` is at line 179. `DbWaRecipient` ends at line 177. We add two new interfaces after `DbWaRecipient` and extend `ActivePage`.

- [ ] **Step 1: Add `DbCustomer` and `DbLead` after `DbWaRecipient`**

In `src/types.ts`, after the closing `}` of `DbWaRecipient` (line 177), add:

```typescript
export interface DbCustomer {
  id: string;
  wa_number: string;
  name: string;
  company: string;
  created_at: string;
}

export interface DbLead {
  id: string;
  customer_id: string;
  conversation_id: string;
  wa_number: string;
  status: 'NEW' | 'IN_PROGRESS' | 'ESCALATED' | 'ORDERED' | 'DROPPED';
  confirmed_order_id: string | null;
  created_at: string;
  updated_at: string;
  customers: DbCustomer | null;
}
```

- [ ] **Step 2: Add `'pipeline'` to `ActivePage`**

Replace line 179:
```typescript
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings';
```
With:
```typescript
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings' | 'pipeline';
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -10
```

Expected: zero TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add DbCustomer, DbLead, and 'pipeline' to ActivePage"
```

---

### Task 2: Add `leadsService` to `src/lib/supabaseClient.ts`

**Files:**
- Modify: `src/lib/supabaseClient.ts`

**Context:** The file currently imports `DbConversation`, `DbMessage`, `DbOrder`, `DbBankConfig`, `DbWaRecipient` from types. The new service goes at the end of the file after `waRecipientsService`.

- [ ] **Step 1: Add `DbCustomer` and `DbLead` to the import line**

Replace the existing import line at the top of the file:
```typescript
import type { DbConversation, DbMessage, DbOrder, DbBankConfig, DbWaRecipient } from '../types';
```
With:
```typescript
import type { DbConversation, DbMessage, DbOrder, DbBankConfig, DbWaRecipient, DbCustomer, DbLead } from '../types';
```

- [ ] **Step 2: Add `leadsService` at the end of the file**

After the closing `};` of `waRecipientsService`, append:

```typescript
export const leadsService = {
  async fetchAll(): Promise<DbLead[]> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('leads')
      .select('*, customers(*)')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DbLead[];
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
git commit -m "feat(supabase): add leadsService with fetchAll join query"
```

---

### Task 3: Create `src/components/PipelineScreen.tsx`

**Files:**
- Create: `src/components/PipelineScreen.tsx`

**Context:** Read-only screen. Loads leads on mount, filters client-side via tab selection. Status badges are color-coded. Relative timestamps ("2 jam lalu") use `Intl.RelativeTimeFormat`. No writes.

- [ ] **Step 1: Create the file with the complete implementation**

Create `src/components/PipelineScreen.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { TrendingUp } from 'lucide-react';
import { DbLead } from '../types';
import { leadsService, isSupabaseConfigured } from '../lib/supabaseClient';

interface PipelineScreenProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type FilterTab = 'all' | 'active' | 'escalated' | 'ordered' | 'dropped';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  NEW:         { label: 'Baru',      className: 'bg-gray-100 text-gray-600' },
  IN_PROGRESS: { label: 'Proses',    className: 'bg-blue-100 text-blue-700' },
  ESCALATED:   { label: 'Eskalasi',  className: 'bg-amber-100 text-amber-700' },
  ORDERED:     { label: 'Selesai',   className: 'bg-emerald-100 text-emerald-700' },
  DROPPED:     { label: 'Gugur',     className: 'bg-red-100 text-red-500' },
};

function relativeTime(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });
  if (abs < 60)   return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

function filterLeads(leads: DbLead[], tab: FilterTab): DbLead[] {
  switch (tab) {
    case 'active':    return leads.filter(l => l.status === 'NEW' || l.status === 'IN_PROGRESS');
    case 'escalated': return leads.filter(l => l.status === 'ESCALATED');
    case 'ordered':   return leads.filter(l => l.status === 'ORDERED');
    case 'dropped':   return leads.filter(l => l.status === 'DROPPED');
    default:          return leads;
  }
}

export default function PipelineScreen({ showToast }: PipelineScreenProps) {
  const [leads, setLeads] = useState<DbLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    leadsService.fetchAll()
      .then(setLeads)
      .catch(err => {
        console.error('PipelineScreen load error:', err);
        showToast('Gagal memuat data pipeline.', 'warning');
      })
      .finally(() => setLoading(false));
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-bold text-gray-800">Pipeline Penjualan</h1>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-yellow-800 text-sm font-medium">
          Supabase belum dikonfigurasi. Tambahkan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY ke file .env untuk menggunakan fitur ini.
        </div>
      </div>
    );
  }

  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all',       label: `Semua (${leads.length})` },
    { id: 'active',    label: `Aktif (${leads.filter(l => l.status === 'NEW' || l.status === 'IN_PROGRESS').length})` },
    { id: 'escalated', label: `Eskalasi (${leads.filter(l => l.status === 'ESCALATED').length})` },
    { id: 'ordered',   label: `Selesai (${leads.filter(l => l.status === 'ORDERED').length})` },
    { id: 'dropped',   label: `Gugur (${leads.filter(l => l.status === 'DROPPED').length})` },
  ];

  const visible = filterLeads(leads, activeTab);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center gap-3">
        <TrendingUp className="w-6 h-6 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-800">Pipeline Penjualan</h1>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
              activeTab === tab.id
                ? 'bg-[#012749] text-white shadow-sm'
                : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Memuat pipeline...</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            {leads.length === 0
              ? 'Belum ada lead. Lead dibuat otomatis saat percakapan WhatsApp baru masuk.'
              : 'Tidak ada lead dengan status ini.'}
          </div>
        ) : (
          visible.map(lead => {
            const badge = STATUS_BADGE[lead.status] ?? STATUS_BADGE.NEW;
            const customer = lead.customers;
            return (
              <div key={lead.id} className="flex items-center gap-4 px-6 py-4">
                {/* Customer info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm text-gray-800 truncate">
                      {customer?.name || lead.wa_number}
                    </span>
                    {customer?.company && (
                      <span className="text-xs text-gray-400 truncate hidden sm:block">
                        · {customer.company}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-mono text-gray-400">{lead.wa_number}</p>
                </div>

                {/* Lead ID */}
                <div className="hidden md:block shrink-0">
                  <p className="text-xs font-mono text-gray-400">{lead.id}</p>
                </div>

                {/* Status badge */}
                <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${badge.className}`}>
                  {badge.label}
                </span>

                {/* Updated time */}
                <span className="shrink-0 text-xs text-gray-400 hidden sm:block">
                  {relativeTime(lead.updated_at)}
                </span>
              </div>
            );
          })
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

Expected: zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PipelineScreen.tsx
git commit -m "feat(ui): add read-only PipelineScreen with lead status filter tabs"
```

---

### Task 4: Wire Sidebar and App.tsx

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

**Context:** `TrendingUp` is not yet imported in Sidebar.tsx. The menuItems array currently ends with the `'settings'` entry (lines 71–76). App.tsx `renderPage()` switch has `case 'settings'` as the last case.

- [ ] **Step 1: Add `TrendingUp` to Sidebar.tsx imports**

In `src/components/Sidebar.tsx`, replace the lucide-react import block:
```typescript
import { 
  LayoutDashboard, 
  Inbox, 
  Package, 
  Users, 
  Bell, 
  Settings, 
  LogOut, 
  Zap,
  UserCheck,
  Bot
} from 'lucide-react';
```
With:
```typescript
import { 
  LayoutDashboard, 
  Inbox, 
  Package, 
  Users, 
  Bell, 
  Settings, 
  LogOut, 
  Zap,
  UserCheck,
  Bot,
  TrendingUp
} from 'lucide-react';
```

- [ ] **Step 2: Add Pipeline entry to `menuItems` in Sidebar.tsx**

After the `'settings'` entry in `menuItems`, add:
```tsx
    {
      id: 'pipeline' as ActivePage,
      label: 'Pipeline',
      icon: TrendingUp,
      description: 'Leads & Prospek',
    },
```

- [ ] **Step 3: Import `PipelineScreen` in App.tsx**

In `src/App.tsx`, after the `PengaturanScreen` import line, add:
```typescript
import PipelineScreen from './components/PipelineScreen';
```

- [ ] **Step 4: Add `'pipeline'` case to `renderPage()` in App.tsx**

In `src/App.tsx`, after the `case 'settings':` block, add:
```tsx
      case 'pipeline':
        return (
          <PipelineScreen showToast={triggerToast} />
        );
```

- [ ] **Step 5: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -10
```

Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat(nav): add Pipeline to sidebar and App.tsx routing"
```

---

## E2 Complete

After all 4 tasks: `npm run build` passes with zero errors.

**Manual smoke test:**
1. Navigate to "Pipeline" in the sidebar — page loads
2. If Supabase is configured and has leads: rows appear with customer name, WA number, status badge, relative time
3. Click each filter tab — list updates correctly (counts in tab labels match visible rows)
4. If no leads exist: empty state message shown
5. If Supabase not configured: yellow banner shown
