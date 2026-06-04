# Admin Roles & Per-Item Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Supabase Auth OTP login to `admin_users` so each staff member's role and per-sidebar-item permissions are enforced, with an Owner role that has all 11 permissions locked on.

**Architecture:** Expand `PermissionSet` from 4 keys to 11 (one per sidebar item). After OTP verify, look up the signed-in email in `admin_users` and hydrate `currentUser` with their real role + permissions. The Sidebar filters visible menu items against those permissions. Sign-up auto-creates an Owner row. Unregistered emails are blocked at sign-in.

**Tech Stack:** React 19 + TypeScript, Supabase JS client, Tailwind CSS. No new dependencies. Verification: `npm run build` (runs tsc — zero errors = pass).

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/types.ts` | Modify | Replace 4-key `PermissionSet` with 11-key; export `ALL_PERMISSIONS` constant |
| `src/initialData.ts` | Modify | Update `INITIAL_ADMINS` to use 11-key `PermissionSet` |
| `src/lib/supabaseClient.ts` | Modify | Add `fetchByEmail` to `adminUsersService` |
| `src/App.tsx` | Modify | Add `permissions` to `currentUser` type; update session restore default |
| `src/components/AuthScreen.tsx` | Modify | Post-OTP `fetchByEmail` lookup; sign-up Owner row creation |
| `src/components/Sidebar.tsx` | Modify | Add `permKey` to each menu item; filter by `currentUser.permissions` |
| `src/components/UserManagementScreen.tsx` | Modify | Expandable rows with 11 toggles; add Owner role; lock Owner toggles |

---

## Task 1: Expand PermissionSet in types.ts + initialData.ts

**Files:**
- Modify: `src/types.ts` lines 6–11
- Modify: `src/initialData.ts` lines 8–37

- [ ] **Step 1: Replace PermissionSet interface and add ALL_PERMISSIONS in `src/types.ts`**

Find and replace the entire `PermissionSet` block (lines 6–11):

```ts
export interface PermissionSet {
  dashboard: boolean;
  salesInbox: boolean;
  laporan: boolean;
  aiStock: boolean;
  pipeline: boolean;
  pelanggan: boolean;
  orderHistory: boolean;
  userManagement: boolean;
  whatsappAi: boolean;
  notifications: boolean;
  settings: boolean;
}

export const ALL_PERMISSIONS: PermissionSet = {
  dashboard: true,
  salesInbox: true,
  laporan: true,
  aiStock: true,
  pipeline: true,
  pelanggan: true,
  orderHistory: true,
  userManagement: true,
  whatsappAi: true,
  notifications: true,
  settings: true,
};
```

- [ ] **Step 2: Update INITIAL_ADMINS in `src/initialData.ts`**

Replace the entire `INITIAL_ADMINS` array (lines 8–37):

```ts
export const INITIAL_ADMINS: AdminUser[] = [
  {
    id: '1',
    name: 'Admin Rini',
    email: 'rini@sinarelektrik.com',
    whatsapp: '+6281233445566',
    role: 'Staff Admin Toko',
    permissions: {
      dashboard: true,
      salesInbox: true,
      laporan: true,
      aiStock: false,
      pipeline: true,
      pelanggan: true,
      orderHistory: true,
      userManagement: false,
      whatsappAi: false,
      notifications: false,
      settings: false,
    },
    status: 'Aktif',
  },
  {
    id: '2',
    name: 'Admin Agus',
    email: 'agus@sinarelektrik.com',
    whatsapp: '+6289988776655',
    role: 'Supervisor Gudang',
    permissions: {
      dashboard: true,
      salesInbox: false,
      laporan: true,
      aiStock: true,
      pipeline: false,
      pelanggan: false,
      orderHistory: false,
      userManagement: false,
      whatsappAi: false,
      notifications: false,
      settings: false,
    },
    status: 'Aktif',
  },
];
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|✓ built"
```

Expected: errors about `sales`, `stokAi`, `konfig` keys used in other files (that's normal — we fix them in later tasks). If you see `✓ built` with no errors, all downstream files already used compatible code — proceed directly to Task 2.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/initialData.ts
git commit -m "feat(types): expand PermissionSet to 11 per-sidebar keys, add ALL_PERMISSIONS constant"
```

---

## Task 2: Add fetchByEmail to adminUsersService

**Files:**
- Modify: `src/lib/supabaseClient.ts` after line 610 (after `remove` method, inside `adminUsersService`)

- [ ] **Step 1: Add fetchByEmail method**

Open `src/lib/supabaseClient.ts`. Find `adminUsersService` (line 576). Inside the object, after the `remove` method's closing brace (before the final `};`), add:

```ts
  async fetchByEmail(email: string): Promise<DbAdminUser | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },
```

The full `adminUsersService` block should end like:
```ts
  async remove(id: string): Promise<void> {
    if (!supabase) throw new Error('Supabase not configured');
    const { error } = await supabase
      .from('admin_users')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  async fetchByEmail(email: string): Promise<DbAdminUser | null> {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },
};
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | grep -E "error|✓ built"
```

Expected: same error count as after Task 1 (no new errors introduced).

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(supabase): add adminUsersService.fetchByEmail for post-OTP permission lookup"
```

---

## Task 3: Widen currentUser type in App.tsx

**Files:**
- Modify: `src/App.tsx` lines 21, 48, 68–79

- [ ] **Step 1: Add PermissionSet and ALL_PERMISSIONS to the import from `./types`**

Find line 21:
```ts
import { ActivePage, StockItem, NotificationConfig } from './types';
```

Replace with:
```ts
import { ActivePage, StockItem, NotificationConfig, PermissionSet, ALL_PERMISSIONS } from './types';
```

- [ ] **Step 2: Widen the currentUser useState type**

Find line 48:
```ts
  const [currentUser, setCurrentUser] = useState<{ name: string; role: string; avatarUrl: string; storeName: string } | null>(null);
```

Replace with:
```ts
  const [currentUser, setCurrentUser] = useState<{ name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string } | null>(null);
```

- [ ] **Step 3: Update the session-restore useEffect to include permissions**

Find the `getSession` block inside the first `useEffect` (around lines 68–79):
```ts
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !currentUser) {
        const user = session.user;
        setCurrentUser({
          name: user.user_metadata?.full_name ?? (user.email?.split('@')[0] ?? 'User'),
          role: 'Owner',
          avatarUrl: user.user_metadata?.avatar_url ?? '',
          storeName: user.user_metadata?.store_name ?? '',
        });
        setActivePage('dashboard');
      }
    });
```

Replace with:
```ts
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !currentUser) {
        const user = session.user;
        setCurrentUser({
          name: user.user_metadata?.full_name ?? (user.email?.split('@')[0] ?? 'User'),
          role: 'Owner',
          permissions: ALL_PERMISSIONS,
          avatarUrl: user.user_metadata?.avatar_url ?? '',
          storeName: user.user_metadata?.store_name ?? '',
        });
        setActivePage('dashboard');
      }
    });
```

- [ ] **Step 4: Update handleLoginSuccess to accept permissions**

Find `handleLoginSuccess` (around line 168):
```ts
  const handleLoginSuccess = (user: { name: string; role: string; avatarUrl: string; storeName: string }) => {
    setCurrentUser(user);
    setActivePage('dashboard');
  };
```

Replace with:
```ts
  const handleLoginSuccess = (user: { name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string }) => {
    setCurrentUser(user);
    setActivePage('dashboard');
  };
```

- [ ] **Step 5: Verify build**

```bash
npm run build 2>&1 | grep -E "error|✓ built"
```

Expected: TypeScript will now complain that `AuthScreen`'s `onLoginSuccess` prop type is mismatched (it still passes the old shape without `permissions`). That's expected — fixed in Task 4. Sidebar will also complain about the widened `currentUser` prop — fixed in Task 5.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): add permissions to currentUser type, default ALL_PERMISSIONS on session restore"
```

---

## Task 4: Wire AuthScreen — post-OTP lookup + sign-up Owner row

**Files:**
- Modify: `src/components/AuthScreen.tsx`

- [ ] **Step 1: Add imports at the top of AuthScreen.tsx**

Find line 8:
```ts
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
```

Replace with:
```ts
import { supabase, isSupabaseConfigured, adminUsersService } from '../lib/supabaseClient';
import { PermissionSet, ALL_PERMISSIONS } from '../types';
```

- [ ] **Step 2: Widen the onLoginSuccess prop type in AuthScreenProps**

Find:
```ts
interface AuthScreenProps {
  onLoginSuccess: (userData: { name: string; role: string; avatarUrl: string; storeName: string }) => void;
}
```

Replace with:
```ts
interface AuthScreenProps {
  onLoginSuccess: (userData: { name: string; role: string; permissions: PermissionSet; avatarUrl: string; storeName: string }) => void;
}
```

- [ ] **Step 3: Update handleSignInSubmit to lookup admin_users after OTP verify**

Find the block inside `handleSignInSubmit` starting at:
```ts
    showToast('🎉 Masuk sukses! Memuat sistem ERP...');
    setTimeout(() => {
      onLoginSuccess({
        name: deriveDisplayName(user.email ?? '', user.user_metadata?.full_name),
        role: 'Owner',
        avatarUrl: user.user_metadata?.avatar_url ?? '',
        storeName: user.user_metadata?.store_name ?? '',
      });
    }, 800);
```

Replace with:
```ts
    let adminRow = null;
    try {
      adminRow = await adminUsersService.fetchByEmail(signInEmail);
    } catch (err) {
      setSignInLoading(false);
      showToast('❌ Gagal memuat data akses. Coba lagi.');
      return;
    }
    if (!adminRow) {
      setSignInLoading(false);
      showToast('❌ Email belum terdaftar sebagai admin. Minta owner untuk menambahkan akun Anda.');
      return;
    }
    showToast('🎉 Masuk sukses! Memuat sistem ERP...');
    setTimeout(() => {
      onLoginSuccess({
        name: deriveDisplayName(user.email ?? '', adminRow!.name),
        role: adminRow!.role,
        permissions: adminRow!.permissions as PermissionSet,
        avatarUrl: user.user_metadata?.avatar_url ?? '',
        storeName: user.user_metadata?.store_name ?? '',
      });
    }, 800);
```

- [ ] **Step 4: Update handleSignUpSubmit to upsert Owner row in admin_users**

Find the block after `updateUser` succeeds (after the `if (updateError)` block) and before `setSignUpLoading(false)`:

```ts
    setSignUpLoading(false);
    showToast(`🎉 Toko "${signUpStore}" sukses terdaftar! Mengalihkan ke Dashboard.`);
    setTimeout(() => {
      onLoginSuccess({
        name: signUpName,
        role: 'Owner',
        avatarUrl: '',
        storeName: signUpStore,
      });
    }, 1200);
```

Replace with:
```ts
    // Auto-create Owner row in admin_users
    if (isSupabaseConfigured && data.user) {
      try {
        await adminUsersService.upsert({
          id: data.user.id,
          name: signUpName,
          email: signUpEmail,
          whatsapp: null,
          role: 'Owner',
          permissions: ALL_PERMISSIONS,
          status: 'Aktif',
        });
      } catch (err) {
        console.error('Failed to create owner row in admin_users:', err);
        // Non-fatal: continue login with all permissions
      }
    }
    setSignUpLoading(false);
    showToast(`🎉 Toko "${signUpStore}" sukses terdaftar! Mengalihkan ke Dashboard.`);
    setTimeout(() => {
      onLoginSuccess({
        name: signUpName,
        role: 'Owner',
        permissions: ALL_PERMISSIONS,
        avatarUrl: '',
        storeName: signUpStore,
      });
    }, 1200);
```

- [ ] **Step 5: Update the dev bypass in handleSignInSubmit to include permissions**

Find:
```ts
      showToast('🎉 Masuk sukses (dev mode)!');
      setTimeout(() => devBypass(signInEmail), 1000);
```

The `devBypass` function (lines 46–53) calls `onLoginSuccess` without `permissions`. Update `devBypass`:

Find:
```ts
  const devBypass = (email: string, name?: string, storeName?: string) => {
    onLoginSuccess({
      name: name ?? deriveDisplayName(email),
      role: 'Owner',
      avatarUrl: '',
      storeName: storeName ?? 'Dev Store',
    });
  };
```

Replace with:
```ts
  const devBypass = (email: string, name?: string, storeName?: string) => {
    onLoginSuccess({
      name: name ?? deriveDisplayName(email),
      role: 'Owner',
      permissions: ALL_PERMISSIONS,
      avatarUrl: '',
      storeName: storeName ?? 'Dev Store',
    });
  };
```

- [ ] **Step 6: Verify build**

```bash
npm run build 2>&1 | grep -E "error|✓ built"
```

Expected: TypeScript errors about Sidebar `currentUser` prop (still uses old type) and UserManagementScreen (still uses old `PermissionSet` keys). Those are fixed in Tasks 5 and 6.

- [ ] **Step 7: Commit**

```bash
git add src/components/AuthScreen.tsx
git commit -m "feat(auth): post-OTP admin_users lookup, block unregistered emails, auto-create Owner on sign-up"
```

---

## Task 5: Sidebar per-item permission filtering

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add PermissionSet to the import from `../types`**

Find:
```ts
import { ActivePage } from '../types';
```

Replace with:
```ts
import { ActivePage, PermissionSet } from '../types';
```

- [ ] **Step 2: Widen the currentUser prop type in SidebarProps**

Find:
```ts
  currentUser: { name: string; role: string; avatarUrl: string } | null;
```

Replace with:
```ts
  currentUser: { name: string; role: string; permissions: PermissionSet; avatarUrl: string } | null;
```

- [ ] **Step 3: Add permKey to each menu item and filter before render**

Replace the entire `menuItems` array and the `return` statement's nav section. First, replace the `menuItems` array:

```ts
  const menuItems: Array<{ id: ActivePage; label: string; icon: React.ElementType; description: string; permKey: keyof PermissionSet }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Ringkasan Toko', permKey: 'dashboard' },
    { id: 'sales-inbox', label: 'Sales Inbox', icon: Inbox, description: 'Percakapan WA', permKey: 'salesInbox' },
    { id: 'laporan', label: 'Laporan', icon: BarChart2, description: 'Analitik & Tren', permKey: 'laporan' },
    { id: 'ai-stock', label: 'AI Stock Manager', icon: Package, description: 'Stok & Harga', permKey: 'aiStock' },
    { id: 'pipeline', label: 'Pipeline', icon: TrendingUp, description: 'Leads & Prospek', permKey: 'pipeline' },
    { id: 'pelanggan', label: 'Pelanggan', icon: Users, description: 'Profil & Riwayat', permKey: 'pelanggan' },
    { id: 'order-history', label: 'Riwayat Pesanan', icon: ClipboardList, description: 'Semua Pesanan', permKey: 'orderHistory' },
    { id: 'user-management', label: 'User Management', icon: UserCheck, description: 'Akses Admin', permKey: 'userManagement' },
    { id: 'notifications', label: 'Notification Settings', icon: Bell, description: 'Detak Jantung WA', permKey: 'notifications' },
    { id: 'whatsapp-ai', label: 'WhatsApp AI', icon: Bot, description: 'whatsmeow & Gemini', permKey: 'whatsappAi' },
    { id: 'settings', label: 'Pengaturan', icon: Settings, description: 'Konfigurasi Sistem', permKey: 'settings' },
  ];
```

- [ ] **Step 4: Filter menuItems by permissions before rendering**

Add these lines immediately after the `menuItems` array definition (before the `return`):

```ts
  const visibleItems = currentUser?.permissions
    ? menuItems.filter(item => currentUser.permissions[item.permKey] !== false)
    : menuItems;
```

- [ ] **Step 5: Replace `menuItems.map` with `visibleItems.map` in the nav**

Find:
```tsx
        {menuItems.map((item) => {
```

Replace with:
```tsx
        {visibleItems.map((item) => {
```

- [ ] **Step 6: Add useEffect import and redirect if active page is hidden**

Find the React import at the top:
```ts
import React, { useState } from 'react';
```

Replace with:
```ts
import React, { useState, useEffect } from 'react';
```

Add this `useEffect` immediately after the `const visibleItems = ...` line:

```ts
  useEffect(() => {
    if (currentUser?.permissions && activePage !== 'auth') {
      const isVisible = visibleItems.some(item => item.id === activePage);
      if (!isVisible) {
        onPageChange('dashboard');
      }
    }
  }, [currentUser?.permissions]);
```

- [ ] **Step 7: Verify build**

```bash
npm run build 2>&1 | grep -E "error|✓ built"
```

Expected: Errors remaining only in `UserManagementScreen.tsx` (old `PermissionSet` keys). Tasks 1–5 combined should now compile cleanly except for that file.

- [ ] **Step 8: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(sidebar): filter menu items by per-item permissions, redirect to dashboard if page hidden"
```

---

## Task 6: UserManagementScreen — expandable rows, Owner role, 11 toggles

**Files:**
- Modify: `src/components/UserManagementScreen.tsx` (full rewrite of table section and logic)

This is the largest task. The horizontal 4-column toggle table is replaced with a card list where each row expands to show 11 labeled toggles.

- [ ] **Step 1: Update imports — add ALL_PERMISSIONS and ChevronDown**

Find:
```ts
import {
  UserPlus,
  Search,
  ChevronLeft,
  ChevronRight,
  Settings,
  UserCheck
} from 'lucide-react';
import { AdminUser, PermissionSet, DbAdminUser } from '../types';
import { adminUsersService, isSupabaseConfigured } from '../lib/supabaseClient';
import { INITIAL_ADMINS } from '../initialData';
```

Replace with:
```ts
import {
  UserPlus,
  Search,
  ChevronDown,
  Trash2,
  UserCheck,
  Crown,
} from 'lucide-react';
import { AdminUser, PermissionSet, DbAdminUser, ALL_PERMISSIONS } from '../types';
import { adminUsersService, isSupabaseConfigured } from '../lib/supabaseClient';
import { INITIAL_ADMINS } from '../initialData';
```

- [ ] **Step 2: Add expandedId state and PERM_LABELS constant**

After the existing `useState` declarations (after `const [searchQuery, setSearchQuery] = useState('');`), add:

```ts
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const PERM_LABELS: { key: keyof PermissionSet; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'salesInbox', label: 'Sales Inbox' },
    { key: 'laporan', label: 'Laporan' },
    { key: 'aiStock', label: 'AI Stock' },
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'pelanggan', label: 'Pelanggan' },
    { key: 'orderHistory', label: 'Riwayat Pesanan' },
    { key: 'userManagement', label: 'User Management' },
    { key: 'whatsappAi', label: 'WhatsApp AI' },
    { key: 'notifications', label: 'Notifikasi' },
    { key: 'settings', label: 'Pengaturan' },
  ];
```

- [ ] **Step 3: Update defaultPermissions helper and newAdmin creation**

Replace the `handleCreateAdminSubmit` permissions block. Find:
```ts
      permissions: {
        dashboard: true,
        sales: newRole === 'Staff Admin Toko',
        stokAi: newRole === 'Supervisor Gudang',
        konfig: false,
      },
```

Replace with a `defaultPermissions` function defined above the component (before `export default function UserManagementScreen`):

```ts
function defaultPermissions(role: string): PermissionSet {
  if (role === 'Owner') return { ...ALL_PERMISSIONS };
  if (role === 'Supervisor Gudang') return {
    dashboard: true, salesInbox: false, laporan: true, aiStock: true,
    pipeline: false, pelanggan: false, orderHistory: false,
    userManagement: false, whatsappAi: false, notifications: false, settings: false,
  };
  if (role === 'Staff Admin Toko') return {
    dashboard: true, salesInbox: true, laporan: true, aiStock: false,
    pipeline: true, pelanggan: true, orderHistory: true,
    userManagement: false, whatsappAi: false, notifications: false, settings: false,
  };
  // Finance Manager
  return {
    dashboard: true, salesInbox: true, laporan: true, aiStock: false,
    pipeline: true, pelanggan: true, orderHistory: true,
    userManagement: false, whatsappAi: false, notifications: false, settings: false,
  };
}
```

Then in `handleCreateAdminSubmit`, replace the permissions line:
```ts
      permissions: defaultPermissions(newRole),
```

- [ ] **Step 4: Add "Owner" to the role dropdown**

Find:
```tsx
                <option value="Pilih Peran...">Pilih Peran...</option>
                <option value="Supervisor Gudang">Supervisor Gudang</option>
                <option value="Staff Admin Toko">Staff Admin Toko</option>
                <option value="Finance Manager">Finance Manager</option>
```

Replace with:
```tsx
                <option value="Pilih Peran...">Pilih Peran...</option>
                <option value="Owner">Owner</option>
                <option value="Supervisor Gudang">Supervisor Gudang</option>
                <option value="Staff Admin Toko">Staff Admin Toko</option>
                <option value="Finance Manager">Finance Manager</option>
```

- [ ] **Step 5: Replace the permissions table with expandable card list**

Replace the entire right column `<section>` (from `{/* RIGHT COLUMN: Permissions Table */}` to its closing `</section>`) with the following:

```tsx
        {/* RIGHT COLUMN: Admin List with Expandable Permission Rows */}
        <section className="lg:col-span-8 bg-white rounded-[2.5rem] p-8 border border-[#e5eeff] shadow-xl overflow-hidden">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-[#2d8a4e] flex items-center justify-center shrink-0 border border-emerald-100">
                <span className="material-symbols-outlined font-black">verified</span>
              </div>
              <h3 className="text-[#012749] font-extrabold text-lg leading-tight">Hak Akses Menu Aplikasi</h3>
            </div>
            <div className="bg-[#eff4ff] px-5 py-2.5 rounded-full border border-blue-50 flex items-center gap-2.5 w-full sm:w-auto">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari admin..."
                className="bg-transparent border-none text-xs font-bold text-slate-700 focus:ring-0 p-0 w-full sm:w-44 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-3">
            {filteredAdmins.length === 0 ? (
              <p className="text-center py-10 text-xs font-semibold text-slate-400">
                Tidak ditemukan record admin.
              </p>
            ) : (
              filteredAdmins.map((adm) => {
                const isOwner = adm.role === 'Owner';
                const activeCount = Object.values(adm.permissions).filter(Boolean).length;
                const isExpanded = expandedId === adm.id;
                return (
                  <div key={adm.id} className="border border-[#e5eeff] rounded-2xl overflow-hidden">
                    {/* Collapsed row */}
                    <div
                      className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-[#eff4ff]/40 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : adm.id)}
                    >
                      <div className="w-10 h-10 rounded-full bg-[#abc9f3]/40 flex items-center justify-center text-[#012749] font-black text-sm select-none shrink-0">
                        {adm.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-extrabold text-[#012749] text-sm leading-none truncate">{adm.name}</p>
                          {isOwner && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                        </div>
                        <p className="text-[10px] font-semibold text-gray-400 mt-0.5 truncate">{adm.email}</p>
                      </div>
                      <span className="text-[10px] font-bold text-[#43474e] hidden sm:block shrink-0">{adm.role}</span>
                      <span className={`text-[10px] font-black px-2.5 py-1 rounded-full shrink-0 ${
                        isOwner ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {isOwner ? 'Semua akses' : `${activeCount}/11 aktif`}
                      </span>
                      <span className="inline-block px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-full bg-emerald-50 text-[#0b743b] border border-emerald-100 shrink-0">
                        {adm.status}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveAdmin(adm.id); }}
                          className="w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer text-rose-400 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded permission grid */}
                    {isExpanded && (
                      <div className="border-t border-[#eff4ff] bg-[#fafbff] px-5 py-5">
                        {isOwner && (
                          <p className="text-[10px] font-bold text-amber-600 mb-3 flex items-center gap-1.5">
                            <Crown className="w-3 h-3" /> Owner memiliki akses penuh — hak akses tidak dapat diubah.
                          </p>
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {PERM_LABELS.map(({ key, label }) => (
                            <label
                              key={key}
                              className={`flex items-center justify-between bg-white border border-[#e5eeff] rounded-xl px-4 py-2.5 gap-3 ${
                                isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-[#abc9f3]'
                              }`}
                            >
                              <span className="text-[11px] font-bold text-[#43474e] truncate">{label}</span>
                              <div className="relative inline-flex items-center shrink-0">
                                <input
                                  type="checkbox"
                                  checked={adm.permissions[key] ?? false}
                                  onChange={() => !isOwner && handleTogglePermission(adm.id, key)}
                                  disabled={isOwner}
                                  className="sr-only peer"
                                />
                                <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#2d8a4e]" />
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-[#eff4ff] flex justify-between items-center select-none">
            <p className="text-xs text-gray-500 font-semibold">
              Menampilkan {filteredAdmins.length} dari total {admins.length} Admin pengurus.
            </p>
          </div>
        </section>
```

- [ ] **Step 6: Update handleTogglePermission signature to use keyof PermissionSet**

The existing signature already uses `keyof PermissionSet` — it will automatically work with the new 11 keys once `PermissionSet` is updated in Task 1.

Verify the signature reads:
```ts
  const handleTogglePermission = async (adminId: string, permissionKey: keyof PermissionSet) => {
```

No change needed here.

- [ ] **Step 7: Verify build — zero TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error|✓ built"
```

Expected: `✓ built in X.XXs` with zero TypeScript errors.

- [ ] **Step 8: Browser smoke test — create a Staff Admin Toko**

```
1. Run: npm run dev
2. Log in with an Owner email
3. Navigate to User Management
4. Fill form: Name="Test Staf", Email="test@test.com", WhatsApp="+62123", Role="Staff Admin Toko"
5. Click BUAT AKUN
6. Confirm the new row appears in the list
7. Click the row to expand — verify 11 toggle grid appears
8. Verify: salesInbox, dashboard, laporan, pipeline, pelanggan, orderHistory are ON; aiStock, userManagement, whatsappAi, notifications, settings are OFF
```

- [ ] **Step 9: Browser smoke test — Owner row is locked**

```
1. If you have an Owner row in the list, click it to expand
2. Verify: Crown icon visible, "Owner memiliki akses penuh" message shown
3. Verify: all 11 toggles are checked and visually grayed (disabled)
4. Verify: clicking a toggle does NOT change its state
```

- [ ] **Step 10: Browser smoke test — Sidebar filtering**

```
1. Log in as a non-Owner (requires an admin_users row with restricted permissions)
   OR: temporarily patch session restore in App.tsx to use a restricted PermissionSet for testing
2. Verify: sidebar only shows items where permissions[key] === true
3. Navigate to a hidden page via URL — sidebar should redirect to dashboard
```

- [ ] **Step 11: Commit**

```bash
git add src/components/UserManagementScreen.tsx
git commit -m "feat(user-mgmt): expandable 11-toggle permission rows, Owner role, locked Owner toggles"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ 11-key PermissionSet replacing 4-key — Task 1
- ✅ ALL_PERMISSIONS exported constant — Task 1
- ✅ fetchByEmail added to adminUsersService — Task 2
- ✅ currentUser widened with permissions — Task 3
- ✅ Post-OTP lookup in sign-in, block unregistered — Task 4
- ✅ Auto-create Owner row on sign-up — Task 4
- ✅ Dev bypass includes ALL_PERMISSIONS — Task 4
- ✅ Session restore defaults to ALL_PERMISSIONS — Task 3
- ✅ Sidebar permKey per item, filter by permissions — Task 5
- ✅ Redirect to dashboard if active page hidden — Task 5
- ✅ Owner role in dropdown — Task 6
- ✅ defaultPermissions function per role — Task 6
- ✅ Expandable rows with 11 labeled toggles — Task 6
- ✅ Owner toggles locked/disabled, Crown badge — Task 6
- ✅ INITIAL_ADMINS uses 11-key PermissionSet — Task 1

**2. Placeholder scan:** No TBDs, no vague steps. All code is complete. ✅

**3. Type consistency:**
- `PermissionSet` defined in Task 1, used consistently in Tasks 2–6 ✅
- `ALL_PERMISSIONS` defined in Task 1, imported in Tasks 3, 4, 6 ✅
- `fetchByEmail` returns `DbAdminUser | null` — cast to `PermissionSet` at call site in Task 4 ✅
- `keyof PermissionSet` in `handleTogglePermission` is unchanged and works with 11 new keys ✅
- `permKey: keyof PermissionSet` in Sidebar's menu item type matches Task 1's PermissionSet ✅
