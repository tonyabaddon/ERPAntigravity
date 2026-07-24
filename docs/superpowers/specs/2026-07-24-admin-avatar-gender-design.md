# Admin Gender-Aware Default Avatar — Design Spec

**Date:** 2026-07-24
**Author:** Claude (via founder session)
**Reversibility:** Reversible (schema-additive column + FE swap; safe to drop if not used)
**Migration slot claim:** `20261115000517` + `20261115000518` (block 000515-000534 owned by permission-registry track)
**Depends on:** admin permission registry PR shipped 2026-07-24 (`d6bf4ed` + follow-up `20779b0`) — reuses `PERMISSION_ROLES` typing infra

---

## 1. Context & Problem

Sidebar avatar (`Sidebar.tsx:313-318`) renders `<img src={currentUser.avatarUrl}>`. `avatarUrl` diambil dari Supabase Auth `user_metadata.avatar_url` — hanya terisi kalau login via Google OAuth. Untuk OTP login (mayoritas admin) → `avatarUrl = ''` → **broken image icon** di Sidebar footer.

Founder ingin: default avatar auto-generated berdasarkan gender admin — cowok dapat avatar cowok, cewek dapat avatar cewek. Style: bespoke Caleo-branded illustration (bukan emoji/CC0), "fun" vibe.

## 2. Decision

Tambahkan kolom `admin_users.gender text` (values `'M'`/`'F'`/`'N'`, default `'N'`), form field "Jenis Kelamin" di Tambah Admin Baru, dan swap Sidebar `<img>` dengan `<AvatarBadge>` component. Component renders 3 flat SVG variants dalam Caleo palette (navy `#012749`, gold `#F9B233`, cream `#FAF7F0`, emerald `#2d8a4e`). Fallback chain: OAuth avatarUrl > gender SVG > initials-in-color.

**Style locked (per founder Q&A 2026-07-24):**
- Flat + friendly + minimalist (rounded head, dot eyes, subtle smile curve)
- Inline SVG in TSX component (no external asset)
- 40×40 native size (no Sidebar layout change)

## 3. Alternatives Considered

- **Emoji 👨👩** — zero cost, universal, tapi generic + OS-dependent look. Founder rejected: not on-brand.
- **Isometric 3D CC0 avatars** — high visual quality but 40px terlalu kecil untuk detail isometric, dan CC0 head-shot isometric sangat langka. Founder accepted push-back.
- **AI-generated (Gemini image)** — best visual but paid + founder approval per CLAUDE.md cost rule; overkill for MVP.
- **DiceBear procedural library** — external dep + npm bundle; adds cost with no per-tenant benefit.

Registry-driven flat SVG chosen: zero cost, zero dep, full brand control, fast to iterate.

## 4. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  src/components/ui/AvatarBadge.tsx (NEW, ~80 lines)     │
│                                                          │
│  <AvatarBadge                                            │
│    name={string}      // for initials fallback           │
│    gender={'M'|'F'|'N'|undefined}                        │
│    avatarUrl={string|undefined}  // OAuth URL           │
│    size={number}      // default 40                     │
│  />                                                      │
│                                                          │
│  Render chain:                                           │
│  1. avatarUrl present + non-empty → <img>                │
│  2. gender='M' → <MaleAvatarSvg>                         │
│  3. gender='F' → <FemaleAvatarSvg>                       │
│  4. else → initials-in-colored-circle (getAvatarColor)   │
└─────────────────────────────────────────────────────────┘
       ▲                                    ▲
       │ imported by                        │ imported by
       │                                    │
┌──────┴────────┐                  ┌────────┴──────────┐
│ Sidebar.tsx   │                  │ (future consumers │
│ line 313-318  │                  │  — deferred)      │
│ swap <img>    │                  └───────────────────┘
└───────────────┘
```

**No consumers outside Sidebar in this PR.** UserManagementScreen admin list still uses existing initial-only circle (Task 3 refactor). Extending AvatarBadge to admin list = follow-up if founder requests.

## 5. Data Model

**Migration `20261115000517_admin_users_add_gender.sql`:**
```sql
-- Add gender column with CHECK constraint + default. Idempotent.
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS gender text NOT NULL DEFAULT 'N'
  CHECK (gender IN ('M', 'F', 'N'));

-- Backfill existing rows explicit (redundant given DEFAULT but authoritative)
UPDATE public.admin_users SET gender = 'N' WHERE gender IS NULL;

-- Verify: every admin_users row has valid gender
DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM public.admin_users WHERE gender NOT IN ('M','F','N');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'admin_users backfill: % rows with invalid gender', v_bad;
  END IF;
END $$;
```

**Migration `20261115000518_admin_upsert_user_add_gender_param.sql`:**
`CREATE OR REPLACE FUNCTION admin_upsert_user(...)` — extend signature with `p_gender text DEFAULT 'N'` param, INSERT/UPDATE the new column. Same OWNER (postgres), same GRANTs, same body except adding `gender` to INSERT columns + UPDATE SET clause.

**Backward compatibility:** `DEFAULT 'N'` means any existing FE call that doesn't pass `p_gender` still works — row gets `'N'` implicitly.

## 6. AvatarBadge Component (TSX draft)

**File**: `src/components/ui/AvatarBadge.tsx`

```tsx
import React from 'react';

export type AvatarGender = 'M' | 'F' | 'N';

interface Props {
  name: string;
  gender?: AvatarGender;
  avatarUrl?: string;
  size?: number;
  className?: string;
}

// Caleo brand palette (verbatim from design system)
const C = {
  navy: '#012749',
  gold: '#F9B233',
  cream: '#FAF7F0',
  emerald: '#2d8a4e',
};

// Deterministic initial-color from name (reuses SalesInboxScreen pattern spirit)
function getInitialsColor(name: string): string {
  const palette = ['#2d8a4e', '#012749', '#F9B233', '#7C3AED', '#EA580C'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function getInitial(name: string): string {
  return (name?.trim().charAt(0) || '?').toUpperCase();
}

/** Flat friendly Caleo-style male avatar — navy shirt, cream face, short hair */
function MaleAvatarSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Avatar cowok">
      {/* background circle */}
      <circle cx="20" cy="20" r="20" fill="#DBEAFE" />
      {/* hair (short, chunky rounded) */}
      <path d="M 10 15 Q 20 6 30 15 L 30 19 Q 20 15 10 19 Z" fill={C.navy} />
      {/* face (rounded square) */}
      <rect x="12" y="14" width="16" height="16" rx="8" fill={C.cream} />
      {/* eyes */}
      <circle cx="16.5" cy="21" r="1.1" fill={C.navy} />
      <circle cx="23.5" cy="21" r="1.1" fill={C.navy} />
      {/* smile curve */}
      <path d="M 17 25 Q 20 27 23 25" stroke={C.navy} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      {/* shirt collar (navy V + gold accent stripe) */}
      <path d="M 8 40 Q 8 32 14 30 L 20 34 L 26 30 Q 32 32 32 40 Z" fill={C.navy} />
      <path d="M 19 33 L 20 36 L 21 33" stroke={C.gold} strokeWidth="0.8" fill="none" />
    </svg>
  );
}

/** Flat friendly Caleo-style female avatar — gold top, cream face, medium hair */
function FemaleAvatarSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Avatar cewek">
      {/* background circle */}
      <circle cx="20" cy="20" r="20" fill="#FCE7F3" />
      {/* long hair (flowing curves on both sides) */}
      <path d="M 8 30 Q 8 12 20 8 Q 32 12 32 30 L 30 30 Q 30 15 20 12 Q 10 15 10 30 Z" fill={C.navy} />
      {/* face (rounded square, slightly narrower for feminine feel) */}
      <rect x="13" y="14" width="14" height="16" rx="7" fill={C.cream} />
      {/* eyes (slightly larger — friendly feel) */}
      <circle cx="16.5" cy="21" r="1.2" fill={C.navy} />
      <circle cx="23.5" cy="21" r="1.2" fill={C.navy} />
      {/* smile curve */}
      <path d="M 17 25 Q 20 27 23 25" stroke={C.navy} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      {/* top (gold with navy neckline) */}
      <path d="M 6 40 Q 6 32 12 30 L 20 32 L 28 30 Q 34 32 34 40 Z" fill={C.gold} />
      <ellipse cx="20" cy="31" rx="4" ry="1.5" fill={C.navy} />
    </svg>
  );
}

/** Flat friendly Caleo-style neutral avatar — emerald top, cream face */
function NeutralAvatarSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Avatar netral">
      {/* background circle */}
      <circle cx="20" cy="20" r="20" fill="#D1FAE5" />
      {/* generic short hair */}
      <path d="M 11 16 Q 20 8 29 16 L 29 20 Q 20 16 11 20 Z" fill={C.emerald} />
      {/* face */}
      <rect x="12" y="14" width="16" height="16" rx="8" fill={C.cream} />
      {/* eyes */}
      <circle cx="16.5" cy="21" r="1.1" fill={C.navy} />
      <circle cx="23.5" cy="21" r="1.1" fill={C.navy} />
      {/* neutral face — subtle smile */}
      <path d="M 17 25 Q 20 26 23 25" stroke={C.navy} strokeWidth="1.2" strokeLinecap="round" fill="none" />
      {/* top (emerald) */}
      <path d="M 8 40 Q 8 32 14 30 L 20 34 L 26 30 Q 32 32 32 40 Z" fill={C.emerald} />
    </svg>
  );
}

/** Initials circle fallback (matches SalesInboxScreen `getAvatarColor` spirit) */
function InitialsAvatar({ name, size }: { name: string; size: number }) {
  const color = getInitialsColor(name);
  const initial = getInitial(name);
  return (
    <div
      role="img"
      aria-label={`Avatar ${name}`}
      style={{
        width: size, height: size, borderRadius: '20%',
        background: color, color: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.floor(size * 0.4), fontWeight: 800,
      }}
    >
      {initial}
    </div>
  );
}

export function AvatarBadge({
  name, gender, avatarUrl, size = 40, className,
}: Props) {
  // OAuth-provided photo takes precedence
  if (avatarUrl && avatarUrl.trim().length > 0) {
    return (
      <img
        alt={`Avatar ${name}`}
        src={avatarUrl}
        width={size} height={size}
        referrerPolicy="no-referrer"
        className={className}
        style={{ borderRadius: '20%', objectFit: 'cover' }}
      />
    );
  }
  // Gender-based Caleo avatar
  if (gender === 'M') return <div className={className}><MaleAvatarSvg size={size} /></div>;
  if (gender === 'F') return <div className={className}><FemaleAvatarSvg size={size} /></div>;
  if (gender === 'N') return <div className={className}><NeutralAvatarSvg size={size} /></div>;
  // Unset (older row that somehow missed backfill) → initials fallback
  return <div className={className}><InitialsAvatar name={name} size={size} /></div>;
}
```

**Design intent:**
- **Male**: navy short hair (2-chunk shape), navy shirt with subtle gold V-neck stripe
- **Female**: navy flowing curves hair, gold top with navy scoop neckline
- **Neutral**: emerald short hair, emerald top (matches existing toggle green)
- All: cream face (Caleo brand skin tone), navy dot eyes + subtle smile
- Background: soft tinted circle matching gender (blue-100, pink-100, emerald-100) — subtle differentiation even at glance

**Iteration expected:** founder likely wants to tweak SVG detail after seeing live. Component isolates all SVG in one file for fast iteration.

## 7. Form UI Change

**File**: `src/components/UserManagementScreen.tsx` — add field between "No. WhatsApp Aktif" and "Peran/Role Default":

```tsx
<div>
  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
    Jenis Kelamin
  </label>
  <div className="flex gap-2">
    {[
      { value: 'M' as const, label: 'Cowok' },
      { value: 'F' as const, label: 'Cewek' },
      { value: 'N' as const, label: 'Netral' },
    ].map(({ value, label }) => (
      <button
        key={value}
        type="button"
        onClick={() => setNewGender(value)}
        className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-colors border ${
          newGender === value
            ? 'bg-[#012749] text-white border-[#012749]'
            : 'bg-white text-[#43474e] border-[#e5eeff] hover:border-[#abc9f3]'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
</div>
```

State: `const [newGender, setNewGender] = useState<'M'|'F'|'N'>('N');`

Default: `'N'` (netral) — owner explicit pick if want gendered avatar.

## 8. Sidebar Swap

**File**: `src/components/Sidebar.tsx:313-318`

```diff
+ import { AvatarBadge } from './ui/AvatarBadge';
  // ... existing imports

- <img
-   alt="User Avatar"
-   className="w-10 h-10 rounded-xl object-cover shrink-0 ring-2 ring-emerald-500/30"
-   src={currentUser.avatarUrl}
-   referrerPolicy="no-referrer"
- />
+ <AvatarBadge
+   name={currentUser.name}
+   gender={currentUser.gender}
+   avatarUrl={currentUser.avatarUrl}
+   size={40}
+   className="shrink-0 ring-2 ring-emerald-500/30 rounded-xl overflow-hidden"
+ />
```

Preserves ring styling; AvatarBadge component handles the visual.

## 9. Type Changes

**`src/types.ts`:**
```diff
  export interface AdminUser {
    ...
    permissions: PermissionSet;
    status: AdminStatus;
+   gender: 'M' | 'F' | 'N';
  }

  export interface DbAdminUser {
    ...
    permissions: PermissionSet;
    status: string;
    created_at: string;
    tenant_id: string;
+   gender: 'M' | 'F' | 'N';
  }
```

**`src/App.tsx`, `src/components/AuthScreen.tsx`, `src/components/Sidebar.tsx`:** currentUser type extends with `gender: 'M' | 'F' | 'N'`. `AuthScreen.handleLoginSuccess` payload includes gender from admin_users row fetch.

**Fallback for existing OAuth code paths that don't fetch admin_users:** default to `'N'`.

## 10. Files touched (9 files)

| # | File | Action |
|---|---|---|
| 1 | `supabase/migrations/20261115000517_admin_users_add_gender.sql` | NEW — ADD COLUMN + backfill + verify |
| 2 | `supabase/migrations/20261115000518_admin_upsert_user_add_gender_param.sql` | NEW — RPC signature extend |
| 3 | `src/components/ui/AvatarBadge.tsx` | NEW — component + 3 SVG variants |
| 4 | `src/components/ui/AvatarBadge.test.tsx` | NEW — render tests per variant + fallback |
| 5 | `src/types.ts` | Modify — AdminUser + DbAdminUser add gender |
| 6 | `src/components/Sidebar.tsx:313-318` | Modify — swap `<img>` for `<AvatarBadge>` + import |
| 7 | `src/components/UserManagementScreen.tsx` | Modify — add radio "Jenis Kelamin" + state + pass gender to upsert |
| 8 | `src/components/AuthScreen.tsx` | Modify — fetch + pass gender in currentUser payload |
| 9 | `src/App.tsx` | Modify — currentUser type + threading gender through login flow |

## 11. Test Plan

**`src/components/ui/AvatarBadge.test.tsx`:**
```ts
describe('AvatarBadge', () => {
  it('renders <img> when avatarUrl provided', () => {
    const { container } = render(<AvatarBadge name="X" avatarUrl="https://a.com/b.jpg" />);
    expect(container.querySelector('img[src="https://a.com/b.jpg"]')).toBeTruthy();
  });

  it('renders male SVG when gender=M and no avatarUrl', () => {
    const { getByRole } = render(<AvatarBadge name="Budi" gender="M" />);
    expect(getByRole('img', { name: 'Avatar cowok' })).toBeTruthy();
  });

  it('renders female SVG when gender=F', () => {
    const { getByRole } = render(<AvatarBadge name="Siti" gender="F" />);
    expect(getByRole('img', { name: 'Avatar cewek' })).toBeTruthy();
  });

  it('renders neutral SVG when gender=N', () => {
    const { getByRole } = render(<AvatarBadge name="X" gender="N" />);
    expect(getByRole('img', { name: 'Avatar netral' })).toBeTruthy();
  });

  it('falls back to initials when gender undefined + no avatarUrl', () => {
    const { getByText } = render(<AvatarBadge name="Rina" />);
    expect(getByText('R')).toBeTruthy();
  });

  it('prefers avatarUrl over gender', () => {
    const { container } = render(<AvatarBadge name="X" gender="M" avatarUrl="https://a.com/b.jpg" />);
    expect(container.querySelector('img')).toBeTruthy();
    expect(container.querySelector('[aria-label="Avatar cowok"]')).toBeFalsy();
  });
});
```

**Full test suite green** (existing `permissions.test.ts` + `permissions-gate-scan.test.ts` + `UserManagementScreen.test.tsx` unaffected).

## 12. Impact Analysis

**Direct importers:**
- `Sidebar.tsx` — line 313-318 swap. Zero other visual consumers of `currentUser.avatarUrl`.

**Prop passthrough sites (type extension needed, no rendering change):**
- `App.tsx:127,247,443` — currentUser state + login payload
- `AuthScreen.tsx:14,55,195,292` — onLoginSuccess signature + 3 code paths
- `OrderHistoryScreen.tsx:19`, `PenjualanScreen.tsx:21` — receive currentUser as prop (only read `.name`, not `.avatarUrl`, but type must match)

**RPC/DB:**
- `admin_upsert_user` — signature extend + backward-compat default (migration 000518)
- No RLS policy references `admin_users.gender`

**Backend Go:** none — backend doesn't read `admin_users.gender`.

**Test suite:** new AvatarBadge tests; existing suite untouched.

## 13. Migration slot

`20261115000517` + `20261115000518` from block 000515-000534 (owned by permission-registry track, per memory `migration_slot_allocation`). Verify no parallel session claimed 000517+ right before commit.

## 14. Scale ceiling check

- Ceiling at 10× (50K admins): column adds ~1 byte/row = 50KB total. Negligible.
- Hot path: read on login. Column already in SELECT * for admin_users. No new query.
- Cost curve: +0 (no infra, no API, no dep).

## 15. Verification plan

### Stage 1 — Local
1. `npm run lint` clean
2. `npx vitest run src/components/ui/AvatarBadge.test.tsx` — 6 tests pass
3. `npx tsc --noEmit` clean
4. `npm run dev` + MCP chrome:
   - Login as Owner → Sidebar shows initials fallback (gender not set yet for existing accounts)
   - Add new admin "Test Cowok" gender=M → verify appears in list
   - Login as Test Cowok → Sidebar shows cowok SVG (navy + gold)
   - Repeat gender=F → verify pink-tinted female SVG
   - Repeat gender=N → verify emerald neutral SVG

### Stage 2 — Deploy
1. Apply migrations 000517 + 000518 via `apply-migration.sh 517` + `518`
2. Verify: `SELECT gender, count(*) FROM admin_users GROUP BY gender` — expect all rows N (backfill)
3. `git push origin main` → Cloud Build
4. Verify Cloud Build SUCCESS both FE + BE
5. **Manual promote** via `./scripts/promote-to-prod.sh <SHA>` per memory `feedback_manual_prod_gate_after_real_tenant`

### Stage 3 — Prod verify on Toko Jaya Makmur
1. Login as playwright-toko-owner → Sidebar shows initials fallback (gender = N default from backfill)
2. Add test admin gender=M → login as that admin → verify cowok SVG rendered in Sidebar
3. Delete test admin. Zero console errors.

## 16. Consequences

**Positive:**
- Broken image icon fixed for all OTP-login admins
- On-brand Caleo visual identity
- Zero cost, zero dep
- Iteration-friendly (single component file)

**Trade-offs:**
- Gender-binary (with Netral escape) — MSME context accepts this; if founder wants full non-binary later, expand enum to add more variants (schema-compat via CHECK constraint)
- SVG detail at 40px is minimal — first-draft may need visual tuning after founder sees live

**Blast radius:**
- 9 files touched. 1 new component. 2 additive migrations (safe rollback = drop column).

## 17. Follow-ups (out of scope)

- Extend AvatarBadge to UserManagementScreen admin list (currently uses initials-only)
- Extend to KasirScreen shift display, ApprovalInbox approver display, PengaturanScreen notification recipient list — all currently show name text only, could enrich with avatar
- Per-tenant custom avatar upload — future feature request
- Add more gender variants if MSME feedback requests (schema-compat)

## 18. Dependencies

- Admin permission registry PR shipped (`d6bf4ed` + `20779b0`) — reuses `PermissionRole` typing infra + design tokens. Standalone otherwise.

## 19. Review checklist for founder

- [ ] **§6 AvatarBadge SVG** — 3 draft variants in Caleo palette (navy/gold/cream/emerald). Style match your "flat + friendly" intent? Any tweak inline?
- [ ] **§7 form UI** — 3 pill buttons (Cowok/Cewek/Netral) using existing design tokens. Position after WhatsApp before Peran/Role. OK atau prefer dropdown?
- [ ] **§5 default 'N'** — new admins default to Netral until owner picks. Alternative: force explicit pick (validation error if not set). OK?
- [ ] **§10 impact scope** — 9 files, 1 new component. Sidebar-only visual change (admin list unchanged). Accept?
- [ ] **§15 Stage 3 tenant** — Toko Jaya Makmur, NOT real customer. OK?

Approve → saya invoke `superpowers:writing-plans` untuk implementation plan.
