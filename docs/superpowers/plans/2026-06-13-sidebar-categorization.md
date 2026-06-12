# Sidebar Categorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce sidebar from 18 flat menu items to 14 items grouped in 4 categories with compact rows, by consolidating 4 standalone screens into 2 tabbed hub screens.

**Architecture:** Add a reusable `TabBar` component. Create `PenjualanScreen` wrapper that hosts 3 tabs (Input Baru / Riwayat / WIP Rakit) rendering existing screens. Modify `PengaturanScreen` to host 3 tabs (Umum / Notifikasi / WhatsApp AI) — the "Umum" tab keeps existing content; the other tabs render existing screens. Refactor `Sidebar.tsx` to group items by `category` field and render compact rows. Old `ActivePage` values (`order-history`, `wip-list`, `notifications`, `whatsapp-ai`, `penjualanBaru`) remain valid for internal callbacks (e.g., from `KasirScreen`, `DashboardScreen`) — only the sidebar emits new values.

**Tech Stack:** React 19, TypeScript 5.8, Tailwind CSS 4, Lucide icons. Type-check via `npm run lint` (= `tsc --noEmit`). Visual verification via `npm run dev`. No new dependencies.

**No unit-test infrastructure for React components exists in this repo** (only Supabase RPC integration tests in `tests/integration/`). Verification is type-checking + manual visual walk-through after each task — explicitly listed at the end of each task.

**Spec reference:** `docs/superpowers/specs/2026-06-13-sidebar-categorization-design.md`
**Preview:** `tmp/sidebar-preview.html`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/components/ui/TabBar.tsx` | Create | Reusable horizontal tab bar with active indicator |
| `src/components/PenjualanScreen.tsx` | Create | Wrapper rendering 3 tabs over existing inner screens |
| `src/components/PengaturanScreen.tsx` | Modify | Add TabBar; existing content becomes "Umum" tab |
| `src/components/Sidebar.tsx` | Modify | Add `category` to MenuItem; group rendering; compact rows; remove 4 items; 3 renames |
| `src/types.ts` | Modify | Add `'penjualan'` to `ActivePage` union |
| `src/App.tsx` | Modify | Import + route `'penjualan'`; pass new props to PengaturanScreen |

Legacy `ActivePage` values are **kept** for internal navigation by other screens — do NOT remove them in this plan.

---

## Task 1: Create reusable `TabBar` component

**Files:**
- Create: `src/components/ui/TabBar.tsx`

- [ ] **Step 1: Create directory and file**

Run: `mkdir -p src/components/ui`

- [ ] **Step 2: Write `TabBar` component**

Create `src/components/ui/TabBar.tsx`:

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

export interface TabDef<T extends string> {
  id: T;
  label: string;
}

interface TabBarProps<T extends string> {
  tabs: TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
}

export default function TabBar<T extends string>({ tabs, active, onChange }: TabBarProps<T>) {
  return (
    <div className="border-b border-[#1e3d60]/10 flex gap-1">
      {tabs.map(tab => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`px-5 py-3 text-sm border-b-2 transition-colors cursor-pointer ${
              isActive
                ? 'font-bold text-[#012749] border-[#2d8a4e]'
                : 'font-semibold text-[#0b1c30]/50 border-transparent hover:text-[#0b1c30]'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/TabBar.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add reusable TabBar component

Generic on tab id type. Active indicator uses emerald border-bottom
matching design system tokens.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `'penjualan'` ActivePage + Create `PenjualanScreen` wrapper

**Files:**
- Modify: `src/types.ts:393` (add `'penjualan'` to `ActivePage` union)
- Create: `src/components/PenjualanScreen.tsx`
- Modify: `src/App.tsx:21` (import), `src/App.tsx:42` (import), `src/App.tsx:240-394` (renderPage switch)

- [ ] **Step 1: Add `'penjualan'` to ActivePage type**

Modify `src/types.ts:393`. The existing line is:

```ts
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'manajemen-gudang' | 'stok-opname' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings' | 'pipeline' | 'order-history' | 'pelanggan' | 'laporan' | 'pembelian' | 'kasir' | 'penjualanBaru' | 'persetujuan' | 'rekonsiliasi' | 'wip-list';
```

Add `| 'penjualan'` at the end:

```ts
export type ActivePage = 'dashboard' | 'sales-inbox' | 'ai-stock' | 'manajemen-gudang' | 'stok-opname' | 'user-management' | 'notifications' | 'auth' | 'whatsapp-ai' | 'settings' | 'pipeline' | 'order-history' | 'pelanggan' | 'laporan' | 'pembelian' | 'kasir' | 'penjualanBaru' | 'persetujuan' | 'rekonsiliasi' | 'wip-list' | 'penjualan';
```

- [ ] **Step 2: Create `PenjualanScreen` wrapper**

Create `src/components/PenjualanScreen.tsx`:

```tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { ShoppingCart } from 'lucide-react';
import { ActivePage, PermissionSet, KasirChannel } from '../types';
import TabBar, { TabDef } from './ui/TabBar';
import PenjualanBaruScreen from './PenjualanBaruScreen';
import OrderHistoryScreen from './OrderHistoryScreen';
import WipListScreen from './WipListScreen';

type PenjualanTab = 'input' | 'riwayat' | 'wip';

interface PenjualanScreenProps {
  currentUser: { id: string; name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string } | null;
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  initialTab?: PenjualanTab;
  initialChannel?: KasirChannel;
  onBack: () => void;
  onSaved: (txId: string) => void;
  onNavigate: (page: ActivePage) => void;
  onOpenCustomer: (customerId: string) => void;
}

export default function PenjualanScreen(props: PenjualanScreenProps) {
  const perms = props.currentUser?.permissions;

  // Tabs filtered by permission: Input is gated by kasir (matches sidebar perm
  // for `penjualanBaru` entry); Riwayat by orderHistory; WIP by aiStock (matches
  // existing perm key used by `wip-list` sidebar entry).
  const tabs = useMemo<TabDef<PenjualanTab>[]>(() => {
    const isVisible = (key: keyof PermissionSet): boolean => {
      if (!perms) return true;
      const value = perms[key];
      if (typeof key === 'string' && key.startsWith('can_')) return value === true;
      return value !== false;
    };
    const list: TabDef<PenjualanTab>[] = [];
    if (isVisible('kasir')) list.push({ id: 'input', label: 'Input Baru' });
    if (isVisible('orderHistory')) list.push({ id: 'riwayat', label: 'Riwayat' });
    if (isVisible('aiStock')) list.push({ id: 'wip', label: 'WIP Rakit' });
    return list;
  }, [perms]);

  const [activeTab, setActiveTab] = useState<PenjualanTab>(() => {
    if (props.initialTab && tabs.some(t => t.id === props.initialTab)) return props.initialTab;
    return tabs[0]?.id ?? 'input';
  });

  if (tabs.length === 0) {
    return <div className="p-8 text-center text-slate-500 font-semibold">Akses Penjualan terbatas.</div>;
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Hub header */}
      <div className="flex items-center gap-3 px-2">
        <div className="w-10 h-10 bg-[#012749] rounded-xl flex items-center justify-center shrink-0">
          <ShoppingCart className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-[#0b1c30]">Penjualan</h2>
          <p className="text-xs text-[#0b1c30]/50">Input transaksi baru, riwayat pesanan, dan rakit WIP</p>
        </div>
      </div>

      <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div className="flex-1 min-h-0">
        {activeTab === 'input' && (
          <PenjualanBaruScreen
            currentUser={props.currentUser}
            showToast={props.showToast}
            initialChannel={props.initialChannel}
            onBack={props.onBack}
            onSaved={props.onSaved}
            onNavigate={props.onNavigate}
          />
        )}
        {activeTab === 'riwayat' && (
          <OrderHistoryScreen
            currentUser={props.currentUser}
            onOpenCustomer={props.onOpenCustomer}
            showToast={props.showToast}
          />
        )}
        {activeTab === 'wip' && (
          <WipListScreen
            currentUser={props.currentUser}
            showToast={props.showToast}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire `'penjualan'` route in `App.tsx`**

Modify `src/App.tsx`. Add import after the existing `PenjualanBaruScreen` import (line 37):

```tsx
import PenjualanScreen from './components/PenjualanScreen';
```

In the `renderPage()` switch, find the `case 'penjualanBaru':` block (line 358-377). Immediately BEFORE it, add a new case:

```tsx
case 'penjualan':
  return (
    <PenjualanScreen
      currentUser={currentUser}
      showToast={triggerToast}
      initialChannel={penjualanInitialChannel}
      onBack={() => {
        setPenjualanInitialChannel(undefined);
        setActivePage('kasir');
      }}
      onSaved={(_txId) => {
        setPenjualanInitialChannel(undefined);
        setActivePage('kasir');
      }}
      onNavigate={(page) => {
        setPenjualanInitialChannel(undefined);
        setActivePage(page);
      }}
      onOpenCustomer={handleOpenCustomer}
    />
  );
```

Keep the existing `case 'penjualanBaru':` block UNCHANGED — internal callers (e.g., KasirScreen `onOpenPenjualanBaru`) still use it.

- [ ] **Step 4: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`

In a browser, you cannot reach `'penjualan'` from the sidebar yet (sidebar refactor is Task 4). To verify routing works, temporarily edit `App.tsx` to set initial `useState<ActivePage>('penjualan')` instead of `'auth'` — verify the wrapper renders with 3 tabs and tab switching works (Input Baru / Riwayat / WIP Rakit). Then REVERT the temporary edit before committing.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/components/PenjualanScreen.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat(penjualan): add PenjualanScreen wrapper with 3 tabs

Hub screen for Input Baru / Riwayat / WIP Rakit. Renders existing
PenjualanBaruScreen, OrderHistoryScreen, WipListScreen as tab content.
Tabs filtered by permission. Legacy 'penjualanBaru' route retained for
internal callbacks (KasirScreen.onOpenPenjualanBaru).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add tabs to `PengaturanScreen`

**Files:**
- Modify: `src/components/PengaturanScreen.tsx` (entire file — wrap existing content as "Umum" tab, add tabs)
- Modify: `src/App.tsx:307-310` (pass new props to PengaturanScreen)

- [ ] **Step 1: Update `PengaturanScreen` to host tabs**

Modify `src/components/PengaturanScreen.tsx`. The existing component's content (bank config, company settings, WA recipients) becomes the "Umum" tab. Two new tabs render `NotificationSettingsScreen` and `WhatsappAiScreen`.

First, update the imports at the top of the file. Find the existing import block (lines 1-4):

```tsx
import React, { useState, useEffect, useRef } from 'react';
import { Settings, Building2, Users, Plus, Trash2, ToggleLeft, ToggleRight, Edit2, Save, X, MapPin, Upload, Image as ImageIcon } from 'lucide-react';
import { DbBankConfig, DbWaRecipient, DbCompanySettings } from '../types';
import { bankConfigService, waRecipientsService, companySettingsService, isSupabaseConfigured } from '../lib/supabaseClient';
```

Replace with:

```tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Settings, Building2, Users, Plus, Trash2, ToggleLeft, ToggleRight, Edit2, Save, X, MapPin, Upload, Image as ImageIcon } from 'lucide-react';
import { DbBankConfig, DbWaRecipient, DbCompanySettings, NotificationConfig, StockItem, PermissionSet, ActivePage } from '../types';
import { bankConfigService, waRecipientsService, companySettingsService, isSupabaseConfigured } from '../lib/supabaseClient';
import TabBar, { TabDef } from './ui/TabBar';
import NotificationSettingsScreen from './NotificationSettingsScreen';
import WhatsappAiScreen from './WhatsappAiScreen';
```

- [ ] **Step 2: Expand props interface and tab logic**

Find the existing props interface (lines 6-8):

```tsx
interface PengaturanScreenProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}
```

Replace with:

```tsx
type PengaturanTab = 'umum' | 'notifikasi' | 'whatsapp-ai';

interface PengaturanScreenProps {
  showToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
  // Required by Notifikasi tab
  notificationConfig: NotificationConfig;
  onNotificationConfigChange: (cfg: NotificationConfig) => void;
  // Required by WhatsApp AI tab
  stockList: StockItem[];
  onNavigate: (page: ActivePage) => void;
  // Permission filtering for tabs
  permissions?: PermissionSet;
  // Optional deep-link
  initialTab?: PengaturanTab;
}
```

- [ ] **Step 3: Wrap existing content in tab structure**

Find the `export default function PengaturanScreen({ showToast }: PengaturanScreenProps) {` line. Replace the function signature with:

```tsx
export default function PengaturanScreen(props: PengaturanScreenProps) {
  const { showToast } = props;
```

Then at the very top of the function body (before any existing `useState`), add the tab management code:

```tsx
  const tabs = useMemo<TabDef<PengaturanTab>[]>(() => {
    const perms = props.permissions;
    const isVisible = (key: keyof PermissionSet): boolean => {
      if (!perms) return true;
      const value = perms[key];
      if (typeof key === 'string' && key.startsWith('can_')) return value === true;
      return value !== false;
    };
    const list: TabDef<PengaturanTab>[] = [{ id: 'umum', label: 'Umum' }];
    if (isVisible('notifications')) list.push({ id: 'notifikasi', label: 'Notifikasi' });
    if (isVisible('whatsappAi')) list.push({ id: 'whatsapp-ai', label: 'WhatsApp AI' });
    return list;
  }, [props.permissions]);

  const [activeTab, setActiveTab] = useState<PengaturanTab>(() => {
    if (props.initialTab && tabs.some(t => t.id === props.initialTab)) return props.initialTab;
    return 'umum';
  });
```

Now find the existing `return (` statement of the component. The existing JSX (with all the bank/company/recipients UI) needs to be wrapped as the Umum tab content. The simplest restructure:

1. Keep the existing JSX inside a helper variable
2. Wrap with the tab structure

Find the existing top-level `return (` and the matching closing `)` of the component. Replace the entire return block with:

```tsx
  const umumContent = (
    <>
      {/* EXISTING UMUM CONTENT — keep everything that was previously inside the top-level return, intact, here */}
    </>
  );

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3 px-2">
        <div className="w-10 h-10 bg-[#012749] rounded-xl flex items-center justify-center shrink-0">
          <Settings className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-[#0b1c30]">Pengaturan</h2>
          <p className="text-xs text-[#0b1c30]/50">Konfigurasi umum, notifikasi, dan integrasi WhatsApp AI</p>
        </div>
      </div>

      <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div className="flex-1 min-h-0">
        {activeTab === 'umum' && umumContent}
        {activeTab === 'notifikasi' && (
          <NotificationSettingsScreen
            config={props.notificationConfig}
            onConfigChange={props.onNotificationConfigChange}
            showToast={showToast}
          />
        )}
        {activeTab === 'whatsapp-ai' && (
          <WhatsappAiScreen
            stockList={props.stockList}
            showToast={showToast}
            onNavigate={props.onNavigate}
          />
        )}
      </div>
    </div>
  );
}
```

**Important:** the `{/* EXISTING UMUM CONTENT ... */}` placeholder must be replaced with the previous return's JSX content. Move the entire previous JSX block (the existing `<div className="..."> ... </div>` that the function used to return) into the `umumContent` fragment, exactly as it was. Do not modify the existing Umum markup or behavior.

- [ ] **Step 4: Update App.tsx to pass new props**

Modify `src/App.tsx`. Find the `case 'settings':` block (lines 307-310):

```tsx
case 'settings':
  return (
    <PengaturanScreen showToast={triggerToast} />
  );
```

Replace with:

```tsx
case 'settings':
  return (
    <PengaturanScreen
      showToast={triggerToast}
      notificationConfig={config}
      onNotificationConfigChange={setConfig}
      stockList={stockList}
      onNavigate={setActivePage}
      permissions={currentUser?.permissions}
    />
  );
```

- [ ] **Step 5: Type-check**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`

Log in, navigate to "Pengaturan" via the existing sidebar (still labelled "Pengaturan", still routes to `'settings'`). Verify:
1. Top header shows "Pengaturan" with gear icon and subtitle
2. Three tabs visible: Umum / Notifikasi / WhatsApp AI
3. "Umum" tab shows existing bank/company/recipient UI exactly as before
4. "Notifikasi" tab shows the notification settings screen
5. "WhatsApp AI" tab shows the WhatsApp AI screen
6. Tab clicks switch content with active emerald underline

- [ ] **Step 7: Commit**

```bash
git add src/components/PengaturanScreen.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat(pengaturan): add tabs hub (Umum / Notifikasi / WhatsApp AI)

Existing PengaturanScreen content becomes the "Umum" tab. New tabs
render existing NotificationSettingsScreen and WhatsappAiScreen with
their original props passed through from App. Tabs gated by
permission keys (notifications, whatsappAi).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Restructure `Sidebar.tsx` with categories + compact rows

**Files:**
- Modify: `src/components/Sidebar.tsx` (entire `menuItems` array + render logic)

- [ ] **Step 1: Add Category type and CATEGORY_LABELS**

Modify `src/components/Sidebar.tsx`. Find the `type MenuItem = { ... }` block (lines 38-45) and replace it with:

```tsx
type Category = 'operasional' | 'inventory' | 'kontrol' | 'sistem';

const CATEGORY_LABELS: Record<Category, string> = {
  operasional: 'Operasional',
  inventory: 'Inventory',
  kontrol: 'Kontrol & Laporan',
  sistem: 'Sistem',
};

const CATEGORY_ORDER: Category[] = ['operasional', 'inventory', 'kontrol', 'sistem'];

type MenuItem = {
  id: ActivePage;
  label: string;
  icon: React.ElementType;
  category: Category;
  /** When an array is provided, the entry is visible if ANY listed key is truthy. */
  permKey: keyof PermissionSet | Array<keyof PermissionSet>;
};
```

The `description` field is removed from `MenuItem` (compact rows no longer render descriptions).

- [ ] **Step 2: Rewrite `menuItems` array (14 items, categorized)**

Find the `const menuItems: Array<MenuItem> = [ ... ];` block (lines 54-79). Replace the entire array with:

```tsx
  const menuItems: Array<MenuItem> = [
    // Operasional
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, category: 'operasional', permKey: 'dashboard' },
    { id: 'sales-inbox', label: 'Sales Inbox', icon: Inbox, category: 'operasional', permKey: 'salesInbox' },
    { id: 'penjualan', label: 'Penjualan', icon: ShoppingCart, category: 'operasional', permKey: 'kasir' },
    { id: 'kasir', label: 'Kasir', icon: Receipt, category: 'operasional', permKey: 'kasir' },
    { id: 'pelanggan', label: 'Pelanggan', icon: Users, category: 'operasional', permKey: 'pelanggan' },
    { id: 'pipeline', label: 'Pipeline', icon: TrendingUp, category: 'operasional', permKey: 'pipeline' },
    // Inventory
    { id: 'ai-stock', label: 'Stok', icon: Package, category: 'inventory', permKey: 'aiStock' },
    { id: 'stok-opname', label: 'Stok Opname', icon: PackageSearch, category: 'inventory', permKey: 'can_start_opname' },
    { id: 'pembelian', label: 'Pembelian', icon: ShoppingBag, category: 'inventory', permKey: 'pembelian' },
    // Kontrol & Laporan
    { id: 'persetujuan', label: 'Persetujuan', icon: ClipboardCheck, category: 'kontrol', permKey: ['can_approve_adjustment', 'can_approve_price_change', 'can_commit_opname'] },
    { id: 'rekonsiliasi', label: 'Rekonsiliasi & Tutup Buku', icon: BookCheck, category: 'kontrol', permKey: 'reconciliation' as keyof PermissionSet },
    { id: 'laporan', label: 'Laporan', icon: BarChart2, category: 'kontrol', permKey: 'laporan' },
    // Sistem
    { id: 'user-management', label: 'User Management', icon: UserCheck, category: 'sistem', permKey: 'userManagement' },
    { id: 'settings', label: 'Pengaturan', icon: Settings, category: 'sistem', permKey: 'settings' },
  ];
```

Removed entries (no longer in sidebar): `order-history`, `wip-list`, `notifications`, `whatsapp-ai`.

Renames applied: `penjualanBaru` → `penjualan`; "AI Stock Manager" → "Stok"; "Rekonsiliasi" → "Rekonsiliasi & Tutup Buku".

Replacements: `ShoppingCart` icon now used for Penjualan (instead of duplicate previously used for both Pembelian and PenjualanBaru). `ShoppingBag` for Pembelian.

- [ ] **Step 3: Update Lucide icon imports**

Find the Lucide import block (lines 7-26). Replace with:

```tsx
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
  TrendingUp,
  BarChart2,
  ShoppingCart,
  ShoppingBag,
  Receipt,
  ClipboardCheck,
  PackageSearch,
  BookCheck,
} from 'lucide-react';
```

Removed icons that no longer used in the sidebar: `ClipboardList` (was for Riwayat Pesanan), `Clock` (was for WIP Rakit). `Bell` and `Bot` remain imported only if used elsewhere in this file — confirm by searching the file; if not used, remove them too. Add: `ShoppingBag`, `BookCheck`.

- [ ] **Step 4: Replace render logic to group by category**

Find the `<nav>` block (lines 159-193). Replace the entire `<nav>...</nav>` block with:

```tsx
      {/* Navigation Links — grouped by category */}
      <nav className="flex-1 px-3 overflow-y-auto">
        {CATEGORY_ORDER.map((cat, catIdx) => {
          const itemsInCategory = visibleItems.filter(item => item.category === cat);
          if (itemsInCategory.length === 0) return null;
          const isFirst = catIdx === 0 || !CATEGORY_ORDER.slice(0, catIdx).some(c => visibleItems.some(v => v.category === c));
          return (
            <div key={cat} className="space-y-0.5">
              {/* Section header (expanded) or divider (collapsed) */}
              {isExpanded ? (
                <div className={`px-4 ${isFirst ? 'pt-1' : 'pt-3'} pb-1.5`}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400/70 whitespace-nowrap">
                    {CATEGORY_LABELS[cat]}
                  </p>
                </div>
              ) : (
                !isFirst && (
                  <div className="py-1.5 px-3">
                    <div className="h-px bg-white/10"></div>
                  </div>
                )
              )}

              {itemsInCategory.map(item => {
                const IconComponent = item.icon;
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onPageChange(item.id)}
                    className={`w-full flex items-center gap-3 py-2.5 px-4 rounded-full text-left transition-all duration-200 cursor-pointer group/item ${
                      isActive
                        ? 'bg-white/15 text-emerald-300 font-bold shadow-lg shadow-white/5'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`}
                    title={!isExpanded ? item.label : undefined}
                  >
                    <div className="relative shrink-0">
                      <IconComponent className={`w-5 h-5 transition-transform duration-200 group-hover/item:scale-110 ${isActive ? 'text-emerald-300' : ''}`} />
                      {item.id === 'persetujuan' && pendingCount > 0 && !isExpanded && (
                        <span className="absolute -top-1.5 -right-1.5">
                          <PendingApprovalBadge count={pendingCount} size="sm" />
                        </span>
                      )}
                    </div>
                    <span className={`text-sm font-semibold flex-1 whitespace-nowrap transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                      {item.label}
                    </span>
                    {item.id === 'persetujuan' && pendingCount > 0 && isExpanded && (
                      <span className="transition-opacity duration-300 opacity-100 shrink-0">
                        <PendingApprovalBadge count={pendingCount} size="md" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
```

The compact row drops the description line entirely. The `title` attribute provides tooltip on hover when collapsed.

- [ ] **Step 5: Type-check**

Run: `npm run lint`
Expected: no errors. Common issues:
- If `Bell` or `Bot` are now unused, TypeScript may not flag them but `tsc` won't error. Search and clean up if desired (not strictly required).
- `BookCheck` and `ShoppingBag` must be available in `lucide-react`. They are in `lucide-react ^0.546.0` per `package.json`.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`

Log in and check:

1. **Collapsed (default):** sidebar shows 14 icons in 4 groups separated by thin dividers. Hover over each icon to confirm tooltip shows label.
2. **Hover to expand:** section headers appear: "OPERASIONAL" (top, no top padding) / "INVENTORY" / "KONTROL & LAPORAN" / "SISTEM". All in emerald color.
3. **Click each menu** — verify navigation:
   - Dashboard → DashboardScreen
   - Sales Inbox → SalesInboxScreen
   - Penjualan → **PenjualanScreen with 3 tabs** (this is the key new behavior)
   - Kasir → KasirScreen
   - Pelanggan → PelangganScreen
   - Pipeline → PipelineScreen
   - Stok → StockManagerScreen (formerly "AI Stock Manager")
   - Stok Opname → StockOpnameScreen
   - Pembelian → PembelianScreen
   - Persetujuan → ApprovalInboxScreen (badge still works)
   - Rekonsiliasi & Tutup Buku → RekonsiliasiScreen (label wraps to 2 lines, left-aligned)
   - Laporan → LaporanScreen
   - User Management → UserManagementScreen
   - Pengaturan → PengaturanScreen (with 3 tabs from Task 3)
4. **Verify removed entries are NOT in sidebar:** Riwayat Pesanan, WIP Rakit, Notification Settings, WhatsApp AI.
5. **Permission filtering:** log in as a non-Owner user (if possible) and verify only permitted categories/items show, and empty categories don't show their header.

- [ ] **Step 7: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "$(cat <<'EOF'
feat(sidebar): categorize 14 menu in 4 groups + compact rows

18 menu → 14 (4 layar pindah jadi tab di Penjualan/Pengaturan).
Group by category: Operasional / Inventory / Kontrol & Laporan / Sistem.
Compact row: py-2.5, no description, text-left. Section header on
expanded; divider line on collapsed. Renames: Catat Penjualan →
Penjualan; AI Stock Manager → Stok; Rekonsiliasi → Rekonsiliasi &
Tutup Buku.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update progress.md

**Files:**
- Modify: `progress.md`

- [ ] **Step 1: Read existing progress.md**

Run: `cat progress.md | head -40` to see the existing format.

- [ ] **Step 2: Append entry for sidebar categorization**

Open `progress.md` and add an entry near the top (or in the most recent section, matching the existing style) describing:
- 18 → 14 menu items consolidated
- 4 categories added
- Compact rows
- Files touched: `Sidebar.tsx`, `PengaturanScreen.tsx`, new `PenjualanScreen.tsx` + `TabBar.tsx`, `types.ts`, `App.tsx`
- Spec: `docs/superpowers/specs/2026-06-13-sidebar-categorization-design.md`

Keep the entry brief — one paragraph or 3-5 bullets, matching surrounding format.

- [ ] **Step 3: Commit**

```bash
git add progress.md
git commit -m "$(cat <<'EOF'
chore(progress): record sidebar categorization completion

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification Walk-Through (do once at the end)

Run `npm run dev` and walk through:

1. **Sidebar layout (collapsed):** 14 icons in 4 visual groups separated by hairlines.
2. **Sidebar layout (expanded):** 4 section headers + 14 left-aligned labels, no description sub-text. "Rekonsiliasi & Tutup Buku" wraps without center-alignment.
3. **Penjualan hub:** click Penjualan → 3 tabs render. Switch between tabs, each shows correct inner screen. No errors in console.
4. **Pengaturan hub:** click Pengaturan → 3 tabs (Umum / Notifikasi / WhatsApp AI). Umum tab shows the original company/bank/recipient UI exactly as before. Tab switching works.
5. **Backward compatibility:** From DashboardScreen "lihat semua" (if it links to order-history) or from KasirScreen → Catat Penjualan flow, verify legacy `ActivePage` values still route correctly (PenjualanBaruScreen, OrderHistoryScreen, WipListScreen, NotificationSettingsScreen, WhatsappAiScreen still reachable via internal callbacks).
6. **Bell button (top header):** still navigates to `'notifications'` showing NotificationSettingsScreen as a full-page (legacy route preserved). Acceptable for this iteration; future iteration may redirect to `settings` with `initialTab='notifikasi'`.

---

## Out of Scope (future iteration)

- Migrate Bell button + KasirScreen `onOpenPenjualanBaru` to use new `'penjualan'` route with `initialTab` prop
- Remove legacy `ActivePage` values once all callsites migrated
- Search/filter inside sidebar
- Mobile-responsive sidebar
- Tab state persistence across navigationsuba
