# Admin Roles & Per-Item Permissions Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Supabase Auth OTP login to the `admin_users` table so that each staff member's role and per-sidebar-item permissions are enforced after login, with an Owner role that has all permissions locked on.

**Architecture:** After OTP verify, look up the signed-in email in `admin_users`. If found, hydrate `currentUser` with the DB row's role and 11-key `PermissionSet`. Sidebar filters its menu items against those permissions. Sign-up auto-creates an Owner row. Unregistered emails are blocked at sign-in with a clear error message.

**Tech Stack:** React + TypeScript, Supabase (existing `admin_users` table), Tailwind CSS

---

## Current State

- `admin_users` table exists with `permissions JSONB` column (4-key: dashboard, sales, stokAi, konfig)
- After OTP login, `role` is hardcoded `'Owner'` in `AuthScreen.tsx` — `admin_users` is never queried
- `currentUser` has no `permissions` field — Sidebar shows all 11 items to everyone
- The 4 permission toggle columns in `UserManagementScreen` write to DB but are never read
- No "Owner" role in the role dropdown

---

## PermissionSet (11 keys — one per sidebar item)

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
```

Replaces the old 4-key `PermissionSet`. The `permissions` JSONB column in `admin_users` will store this shape going forward. Old rows with 4-key objects will be treated as all-false for the new keys (safe default — owner can re-enable after migration).

---

## Default Permissions per Role

| Permission Key | Owner | Finance Manager | Staff Admin Toko | Supervisor Gudang |
|---|---|---|---|---|
| dashboard | ✅ locked | ✅ | ✅ | ✅ |
| laporan | ✅ locked | ✅ | ✅ | ✅ |
| salesInbox | ✅ locked | ✅ | ✅ | ❌ |
| pipeline | ✅ locked | ✅ | ✅ | ❌ |
| pelanggan | ✅ locked | ✅ | ✅ | ❌ |
| orderHistory | ✅ locked | ✅ | ✅ | ❌ |
| aiStock | ✅ locked | ❌ | ❌ | ✅ |
| userManagement | ✅ locked | ❌ | ❌ | ❌ |
| whatsappAi | ✅ locked | ❌ | ❌ | ❌ |
| notifications | ✅ locked | ❌ | ❌ | ❌ |
| settings | ✅ locked | ❌ | ❌ | ❌ |

All non-Owner defaults are adjustable after creation via the permission toggles in UserManagementScreen. Owner permissions are locked (toggles disabled in UI).

---

## Data Flow

### Sign-in (existing staff)
```
User enters email → clicks Kirim OTP → Supabase sends OTP
User enters OTP → verifyOtp succeeds → fetchByEmail(email)
  ├─ Row found in admin_users
  │    └─ setCurrentUser({ name, role, permissions, storeName, avatarUrl })
  └─ Row not found
       └─ BLOCK: show "Email belum terdaftar sebagai admin. Minta owner untuk menambahkan akun Anda."
```

### Sign-up (new owner registering their store)
```
User fills name + store + email → verifyOtp succeeds → updateUser(metadata)
  → upsert admin_users row: { email, name, role: 'Owner', permissions: ALL_TRUE, status: 'Aktif' }
  → setCurrentUser({ name, role: 'Owner', permissions: ALL_TRUE, storeName })
```

`storeName` comes from Supabase `user_metadata.store_name` (set during sign-up) or falls back to empty string for sign-in users.

---

## File Changes

### 1. `src/types.ts`
- Replace 4-key `PermissionSet` with 11-key version (see above)
- Add `permissions: PermissionSet` to the `currentUser` inline type used in `App.tsx`

### 2. `src/lib/supabaseClient.ts`
Add to `adminUsersService`:
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

### 3. `src/components/AuthScreen.tsx`

**Sign-in (`handleSignInSubmit`)** — after `verifyOtp` succeeds, before calling `onLoginSuccess`:
```ts
const adminRow = await adminUsersService.fetchByEmail(signInEmail);
if (!adminRow) {
  showToast('❌ Email belum terdaftar sebagai admin. Minta owner untuk menambahkan akun Anda.');
  setSignInLoading(false);
  return;
}
onLoginSuccess({
  name: deriveDisplayName(signInEmail, adminRow.name),
  role: adminRow.role,
  permissions: adminRow.permissions as PermissionSet,
  avatarUrl: user.user_metadata?.avatar_url ?? '',
  storeName: user.user_metadata?.store_name ?? '',
});
```

**Sign-up (`handleSignUpSubmit`)** — after `updateUser` succeeds, before calling `onLoginSuccess`:
```ts
const ALL_PERMISSIONS: PermissionSet = {
  dashboard: true, salesInbox: true, laporan: true, aiStock: true,
  pipeline: true, pelanggan: true, orderHistory: true,
  userManagement: true, whatsappAi: true, notifications: true, settings: true,
};
await adminUsersService.upsert({
  id: user.id,  // use Supabase Auth UUID as admin_users id
  name: signUpName,
  email: signUpEmail,
  whatsapp: null,
  role: 'Owner',
  permissions: ALL_PERMISSIONS,
  status: 'Aktif',
});
onLoginSuccess({
  name: signUpName,
  role: 'Owner',
  permissions: ALL_PERMISSIONS,
  avatarUrl: '',
  storeName: signUpStore,
});
```

### 4. `src/App.tsx`
Widen the `currentUser` state type:
```ts
const [currentUser, setCurrentUser] = useState<{
  name: string;
  role: string;
  permissions: PermissionSet;
  avatarUrl: string;
  storeName: string;
} | null>(null);
```
Import `PermissionSet` from `./types`. The `handleLoginSuccess` function already receives the object from `AuthScreen` — its parameter type widens to match.

Session-restore `useEffect`: when restoring from `getSession`, no `admin_users` row is fetched (to avoid a DB call on every page refresh). Instead, permissions default to all-true if role is `'Owner'` from metadata, empty otherwise — the user can re-login if their session is stale. (Simple, avoids complexity.)

### 5. `src/components/Sidebar.tsx`

Add `permKey` to each menu item definition:
```ts
const menuItems = [
  { id: 'dashboard', label: 'Dashboard', permKey: 'dashboard', ... },
  { id: 'sales-inbox', label: 'Sales Inbox', permKey: 'salesInbox', ... },
  { id: 'laporan', label: 'Laporan', permKey: 'laporan', ... },
  { id: 'ai-stock', label: 'AI Stock Manager', permKey: 'aiStock', ... },
  { id: 'pipeline', label: 'Pipeline', permKey: 'pipeline', ... },
  { id: 'pelanggan', label: 'Pelanggan', permKey: 'pelanggan', ... },
  { id: 'order-history', label: 'Riwayat Pesanan', permKey: 'orderHistory', ... },
  { id: 'user-management', label: 'User Management', permKey: 'userManagement', ... },
  { id: 'notifications', label: 'Notification Settings', permKey: 'notifications', ... },
  { id: 'whatsapp-ai', label: 'WhatsApp AI', permKey: 'whatsappAi', ... },
  { id: 'settings', label: 'Pengaturan', permKey: 'settings', ... },
];
```

Filter before render:
```ts
const visibleItems = menuItems.filter(item =>
  !currentUser.permissions || currentUser.permissions[item.permKey as keyof PermissionSet] !== false
);
```

If `activePage` is not in `visibleItems`, call `onPageChange('dashboard')` via `useEffect`.

### 6. `src/components/UserManagementScreen.tsx`

**Role dropdown** — add "Owner":
```tsx
<option value="Owner">Owner</option>
<option value="Supervisor Gudang">Supervisor Gudang</option>
<option value="Staff Admin Toko">Staff Admin Toko</option>
<option value="Finance Manager">Finance Manager</option>
```

**Default permissions for each role** (used when creating):
```ts
function defaultPermissions(role: string): PermissionSet {
  const all = { dashboard: true, salesInbox: true, laporan: true, aiStock: true,
    pipeline: true, pelanggan: true, orderHistory: true,
    userManagement: true, whatsappAi: true, notifications: true, settings: true };
  if (role === 'Owner') return all;
  if (role === 'Supervisor Gudang') return {
    ...all, salesInbox: false, pipeline: false, pelanggan: false,
    orderHistory: false, aiStock: true, userManagement: false, whatsappAi: false,
    notifications: false, settings: false,
  };
  if (role === 'Staff Admin Toko') return {
    ...all, aiStock: false, userManagement: false, whatsappAi: false,
    notifications: false, settings: false,
  };
  // Finance Manager
  return {
    ...all, aiStock: false, userManagement: false, whatsappAi: false,
    notifications: false, settings: false,
  };
}
```

**Permissions table UI** — replace horizontal 4-column toggles with expandable rows:

Collapsed row shows: avatar + name + email | role badge | "N/11 aktif" count badge | status | expand chevron + delete button.

Expanded row (below the collapsed row, full-width) shows a 3-column grid of 11 labeled toggle switches. Owner rows render all toggles `disabled` with a lock icon.

Permission labels for the grid:
```
Dashboard | Sales Inbox | Laporan
AI Stock  | Pipeline    | Pelanggan
Riwayat Pesanan | User Mgmt | WhatsApp AI
Notifikasi | Pengaturan
```

### 7. `src/initialData.ts`
Update `INITIAL_ADMINS` to use the 11-key `PermissionSet`. Each demo admin gets sensible defaults matching their role.

---

## Error States

| Scenario | Behavior |
|---|---|
| Sign-in email not in `admin_users` | Block login, show toast error |
| Sign-in succeeds but `fetchByEmail` throws | Block login, show "Gagal memuat data akses" toast |
| Sign-up `upsert` to `admin_users` fails | Log error, continue login with all-true permissions (non-fatal — owner can retry) |
| Active page hidden after permission change | Auto-navigate to dashboard |
| Session restore (page refresh) | Owner defaults to all-true from metadata; non-owner defaults to all-true until next login (acceptable — session restore is best-effort) |

---

## What Does NOT Change

- The `admin_users` DB schema — `permissions JSONB` column already exists, just stores a wider object
- Supabase RLS policies — already have authenticated role access from previous fix
- The `upsert` / `remove` / `fetchAll` methods in `adminUsersService`
- The visual design of the sidebar, auth screen panels, or any other screen
