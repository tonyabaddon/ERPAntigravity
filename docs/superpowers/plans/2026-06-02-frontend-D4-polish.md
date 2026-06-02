# Frontend D4: Polish & Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 3 hardcoded KPI cards and the hardcoded activity log in DashboardScreen with real Supabase queries, then remove the stale `chats` state from App.tsx and the now-unused `INITIAL_CHATS` export from initialData.ts.

**Architecture:** All changes are in 4 files: `src/lib/supabaseClient.ts` (add `statsService`), `src/components/DashboardScreen.tsx` (consume stats), `src/App.tsx` (remove stale state), `src/initialData.ts` (remove dead export). Requires D1 to be complete. D2 and D3 are not required.

**Tech Stack:** React, TypeScript, Tailwind CSS, Supabase JS client

**Prerequisite:** D1 must be complete. `npm run build` must pass before starting.

---

## File Map

| File | Change |
|---|---|
| `src/lib/supabaseClient.ts` | Add `statsService` with `fetchTodayStats` and `fetchRecentActivity` |
| `src/components/DashboardScreen.tsx` | Import `statsService`, add stats state + useEffect, replace 3 KPI cards, replace activity log, remove `chatsCount` prop |
| `src/App.tsx` | Remove `chats` state, its localStorage sync useEffect, `INITIAL_CHATS` import, and `chatsCount` prop passed to DashboardScreen |
| `src/initialData.ts` | Remove `INITIAL_CHATS` export and `ChatItem` import if no longer needed |

---

### Task 1: Add `statsService` to `src/lib/supabaseClient.ts`

**Files:**
- Modify: `src/lib/supabaseClient.ts`

**Context:** `statsService` queries three tables to compute today's KPI numbers: verified orders total + count, total conversations started today, and AI-handled conversations today. It also fetches the 5 most recent system/AI messages for the activity log. Both functions are used in DashboardScreen (Task 2).

- [ ] **Step 1: Add `statsService` after the closing `};` of `orderService`**

In `src/lib/supabaseClient.ts`, at the very end of the file (after the closing `};` of `orderService`), add:

```typescript
export const statsService = {
  async fetchTodayStats(): Promise<{
    verifiedOrdersTotal: number;
    verifiedOrdersCount: number;
    totalConversationsToday: number;
    aiConversationsToday: number;
  }> {
    if (!supabase) throw new Error('Supabase not configured');
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const iso = todayStart.toISOString();

    const [ordersRes, convsRes, aiConvsRes] = await Promise.all([
      supabase
        .from('orders')
        .select('total')
        .eq('status', 'PAYMENT_VERIFIED')
        .gte('created_at', iso),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', iso),
      supabase
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('ai_active', true)
        .gte('created_at', iso),
    ]);

    const verifiedTotal = (ordersRes.data ?? []).reduce((sum, o) => sum + (o.total ?? 0), 0);
    return {
      verifiedOrdersTotal: verifiedTotal,
      verifiedOrdersCount: ordersRes.data?.length ?? 0,
      totalConversationsToday: convsRes.count ?? 0,
      aiConversationsToday: aiConvsRes.count ?? 0,
    };
  },

  async fetchRecentActivity(): Promise<Array<{ text: string; sender: string; created_at: string }>> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data } = await supabase
      .from('messages')
      .select('text, sender, created_at')
      .in('sender', ['system', 'ai'])
      .order('created_at', { ascending: false })
      .limit(5);
    return data ?? [];
  },
};
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(supabase): add statsService with fetchTodayStats and fetchRecentActivity"
```

---

### Task 2: Wire real stats to KPI cards in `DashboardScreen.tsx`

**Files:**
- Modify: `src/components/DashboardScreen.tsx`

**Context:** DashboardScreen currently has 3 hardcoded KPI cards (revenue, orders, bot efficiency) and a hardcoded activity log. This task replaces the KPI card values with real data loaded on mount from `statsService`. Task 3 handles the activity log. The 4th KPI card (low stock warnings) uses `lowStockCount` prop — leave it unchanged.

- [ ] **Step 1: Import `statsService` and `isSupabaseConfigured`**

At the top of `src/components/DashboardScreen.tsx`, the existing import from `supabaseClient` (currently none) needs to be added. Add after the existing imports:

```typescript
import { statsService, isSupabaseConfigured } from '../lib/supabaseClient';
```

- [ ] **Step 2: Remove `chatsCount` from the props interface**

Find the `DashboardScreenProps` interface (lines 31–35):

```typescript
interface DashboardScreenProps {
  onPageChange: (page: any) => void;
  chatsCount: number;
  lowStockCount: number;
}
```

Replace with:

```typescript
interface DashboardScreenProps {
  onPageChange: (page: any) => void;
  lowStockCount: number;
}
```

- [ ] **Step 3: Remove `chatsCount` from the function signature**

Find line 57:

```typescript
export default function DashboardScreen({ onPageChange, chatsCount, lowStockCount }: DashboardScreenProps) {
```

Replace with:

```typescript
export default function DashboardScreen({ onPageChange, lowStockCount }: DashboardScreenProps) {
```

- [ ] **Step 4: Add `useEffect` import and stats state**

At the top of the file, the `React` import is already `import React, { useState } from 'react';`. Change it to:

```typescript
import React, { useState, useEffect } from 'react';
```

After the `const [approvingId, setApprovingId] = useState<string | null>(null);` line (around line 71), add:

```typescript
  const [stats, setStats] = useState<{
    verifiedOrdersTotal: number;
    verifiedOrdersCount: number;
    totalConversationsToday: number;
    aiConversationsToday: number;
  } | null>(null);

  useEffect(() => {
    if (isSupabaseConfigured) {
      statsService.fetchTodayStats().then(setStats).catch(console.error);
    }
  }, []);
```

- [ ] **Step 5: Replace Stat 1 (Revenue) hardcoded value**

Find the Stat 1 card block (around lines 111–125). Replace the two hardcoded lines inside it:

```tsx
            <span className="text-xs font-bold text-[#2d8a4e] bg-emerald-50 px-2.5 py-1 rounded-full flex items-center gap-0.5">
              +14.2% <ArrowUpRight className="w-3.5 h-3.5" />
            </span>
```

with:

```tsx
            <span className="text-xs font-bold text-[#2d8a4e] bg-emerald-50 px-2.5 py-1 rounded-full flex items-center gap-0.5">
              {stats ? 'Live' : '...'} <ArrowUpRight className="w-3.5 h-3.5" />
            </span>
```

And replace:

```tsx
          <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">
            {formatRupiah(3840000)}
          </h3>
          <p className="text-xs text-[#43474e] mt-2">Rp 3.100.000 pada hari kemarin</p>
```

with:

```tsx
          <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">
            {formatRupiah(stats?.verifiedOrdersTotal ?? 0)}
          </h3>
          <p className="text-xs text-[#43474e] mt-2">Pesanan PAYMENT_VERIFIED hari ini</p>
```

- [ ] **Step 6: Replace Stat 2 (Orders) hardcoded value**

Find the Stat 2 card block (around lines 128–142). Replace:

```tsx
          <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">
            18 Transaksi
          </h3>
```

with:

```tsx
          <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">
            {(stats?.verifiedOrdersCount ?? 0)} Transaksi
          </h3>
```

- [ ] **Step 7: Replace Stat 3 (Bot Efficiency) hardcoded value**

Find the Stat 3 card block (around lines 145–159). Replace:

```tsx
          <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">
            94.2% Efisiensi
          </h3>
          <p className="text-xs text-[#43474e] mt-2">Menghemat ~4.8 jam kerja admin toko</p>
```

with:

```tsx
          <h3 className="text-[#012749] font-extrabold text-2xl tracking-tight mt-1">
            {stats
              ? Math.round((stats.aiConversationsToday / Math.max(stats.totalConversationsToday, 1)) * 100) + '% Efisiensi'
              : '... Efisiensi'}
          </h3>
          <p className="text-xs text-[#43474e] mt-2">
            {stats
              ? `${stats.aiConversationsToday} dari ${stats.totalConversationsToday} chat ditangani AI hari ini`
              : 'Memuat data...'}
          </p>
```

- [ ] **Step 8: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add src/components/DashboardScreen.tsx
git commit -m "feat(dashboard): wire real KPI stats from statsService, remove chatsCount prop"
```

---

### Task 3: Wire real activity log in `DashboardScreen.tsx`

**Files:**
- Modify: `src/components/DashboardScreen.tsx`

**Context:** The activity log section currently renders 3 hardcoded `<div>` blocks (lines 252–284). Replace them with real data from `statsService.fetchRecentActivity()`. If the array is empty (e.g. no system/AI messages today), show a placeholder row.

- [ ] **Step 1: Add `recentActivity` state and load on mount**

After the `stats` `useEffect` added in Task 2, add:

```typescript
  const [recentActivity, setRecentActivity] = useState<Array<{ text: string; sender: string; created_at: string }>>([]);

  useEffect(() => {
    if (isSupabaseConfigured) {
      statsService.fetchRecentActivity().then(setRecentActivity).catch(console.error);
    }
  }, []);
```

- [ ] **Step 2: Replace the hardcoded activity items**

Find the `<div className="space-y-4">` block inside the "Detak Jantung Log Aktivitas AI" section (around lines 251–284). It contains 3 hardcoded `<div className="flex items-center gap-4 p-4 ...">` blocks.

Replace the entire `<div className="space-y-4">` block (including its closing `</div>`) with:

```tsx
        <div className="space-y-4">
          {recentActivity.length === 0 ? (
            <div className="flex items-center gap-4 p-4 text-sm text-gray-400 italic">
              Belum ada aktivitas hari ini.
            </div>
          ) : recentActivity.map((item, i) => (
            <div key={i} className="flex items-center gap-4 p-4 hover:bg-[#f8f9ff] rounded-2xl transition-colors border border-transparent hover:border-blue-100">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 text-[#2d8a4e]">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-[#012749]">
                  {item.sender === 'ai' ? 'Pesan AI' : 'Sistem'}
                </p>
                <p className="text-xs text-[#43474e] line-clamp-2">{item.text}</p>
              </div>
              <span className="text-xs text-slate-400 font-medium shrink-0">
                {new Date(item.created_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
              </span>
            </div>
          ))}
        </div>
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/DashboardScreen.tsx
git commit -m "feat(dashboard): replace hardcoded activity log with real messages from Supabase"
```

---

### Task 4: Remove stale `chats` state from `App.tsx` and clean up `initialData.ts`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/initialData.ts`

**Context:** `App.tsx` tracks a `chats` state (lines 47–49) initialized from `INITIAL_CHATS` and synced to localStorage (lines 73–75). After the SalesInboxScreen was switched to use Supabase realtime data (via `useRealtimeConversations`), this state is never read or written by any component other than the now-removed `chatsCount` prop on DashboardScreen. Removing it also removes the only consumer of `INITIAL_CHATS`, letting us clean up that export from `initialData.ts`.

- [ ] **Step 1: Remove `chats` state from `App.tsx`**

Find and remove the `chats` state declaration (lines 47–50):

```typescript
  const [chats, setChats] = useState<ChatItem[]>(() => {
    const saved = localStorage.getItem('sinar_elektrik_chats');
    return saved ? JSON.parse(saved) : INITIAL_CHATS;
  });
```

Remove the entire block (all 4 lines including the closing `}`).

- [ ] **Step 2: Remove the `chats` localStorage sync `useEffect` from `App.tsx`**

Find and remove (lines 73–75):

```typescript
  useEffect(() => {
    localStorage.setItem('sinar_elektrik_chats', JSON.stringify(chats));
  }, [chats]);
```

Remove the entire 3-line block.

- [ ] **Step 3: Remove `chatsCount` prop from `DashboardScreen` in `App.tsx`**

Find the `DashboardScreen` JSX in `renderPage()` (around line 184–189):

```tsx
        return (
          <DashboardScreen 
            onPageChange={setActivePage} 
            chatsCount={chats.length}
            lowStockCount={lowStockCount}
          />
        );
```

Replace with:

```tsx
        return (
          <DashboardScreen 
            onPageChange={setActivePage} 
            lowStockCount={lowStockCount}
          />
        );
```

- [ ] **Step 4: Remove unused imports from `App.tsx`**

In `App.tsx` line 21:

```typescript
import { ActivePage, ChatItem, StockItem, AdminUser, NotificationConfig } from './types';
```

Remove `ChatItem` from the destructure:

```typescript
import { ActivePage, StockItem, AdminUser, NotificationConfig } from './types';
```

In `App.tsx` lines 32–36:

```typescript
import { 
  INITIAL_CHATS, 
  INITIAL_STOCK, 
  INITIAL_ADMINS, 
  INITIAL_CONFIG 
} from './initialData';
```

Remove `INITIAL_CHATS,`:

```typescript
import { 
  INITIAL_STOCK, 
  INITIAL_ADMINS, 
  INITIAL_CONFIG 
} from './initialData';
```

- [ ] **Step 5: Verify build after App.tsx cleanup**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero TypeScript errors. If you see `'setChats' is declared but never used` or `'chats' is declared but never read`, those are the specific lines you just removed — they should be gone.

- [ ] **Step 6: Remove `INITIAL_CHATS` from `initialData.ts`**

Open `src/initialData.ts`. Confirm that `ChatItem` is imported only for `INITIAL_CHATS` by checking if any other exported value in the file uses `ChatItem` as a type. (The other exports are `INITIAL_ADMINS: AdminUser[]`, `INITIAL_STOCK: StockItem[]`, `INITIAL_CONFIG: NotificationConfig` — none use `ChatItem`.)

Remove `ChatItem` from the import on line 6:

```typescript
import { AdminUser, StockItem, NotificationConfig } from './types';
```

Then delete the entire `INITIAL_CHATS` export (starts at `export const INITIAL_CHATS: ChatItem[] = [` and runs to its closing `];`).

- [ ] **Step 7: Final build verification**

```bash
cd /Users/tonywei/IdeaProjects/ERPAntigravity && npm run build 2>&1 | tail -20
```

Expected: zero TypeScript errors across all files.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/initialData.ts
git commit -m "refactor(app): remove stale chats state and INITIAL_CHATS now that inbox uses Supabase realtime"
```

---

## D4 Complete

After all 4 tasks: `npm run build` passes with zero errors.

**Manual smoke test:**
1. Open Dashboard — the 3 KPI cards should show `0` values (or real values if data exists in Supabase today)
2. Stat 1 badge should show "Live" instead of "+14.2%"
3. Stat 3 should show "0% Efisiensi" if no conversations today (not "94.2%")
4. Activity log should show "Belum ada aktivitas hari ini." if no system/AI messages today
5. If there are real `PAYMENT_VERIFIED` orders created today: Stat 1 and Stat 2 should reflect them
6. Browser console: no TypeScript runtime errors
