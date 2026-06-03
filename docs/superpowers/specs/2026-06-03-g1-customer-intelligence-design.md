# G1 — Customer Intelligence Design

**Date:** 2026-06-03  
**Status:** Approved — ready for implementation

---

## Overview

Build a **Pelanggan** screen (Customer 360) and improve the **Pipeline** screen. Admins get a single place to look up any customer's full history, and Pipeline becomes more informative with expandable order details and search.

**Tech Stack:** React + TypeScript, Tailwind CSS, Supabase JS client, Lucide React icons  
**Build check:** `npm run build` must pass with zero TypeScript errors after each task.  
**Do NOT touch:** `backend-go/`, any `.sql` migration files.

---

## Architecture

### New files
- `src/components/PelangganScreen.tsx` — Customer 360 split-view screen

### Modified files
- `src/types.ts` — add `'pelanggan'` to `ActivePage`; add `DbCustomerWithStats`, `DbCustomerProfile` interfaces
- `src/lib/supabaseClient.ts` — add `customersService` with `fetchAll()` and `fetchProfile(id)`; update `leadsService.fetchAll()` to include linked orders
- `src/App.tsx` — add `'pelanggan'` route; add `openCustomerId` state; pass `openCustomerId` + `onOpenCustomer` to relevant screens
- `src/components/Sidebar.tsx` — add "Pelanggan" nav item after Pipeline
- `src/components/PipelineScreen.tsx` — add search, collapsible rows, items table for ORDERED leads, quick nav links
- `src/components/OrderHistoryScreen.tsx` — customer name in collapsed row becomes a clickable link

---

## Screen: Pelanggan (Customer 360)

### Layout — Split view
Two-panel layout inside the standard `space-y-6 animate-fadeIn` page wrapper:

```
┌─────────────────────────────────────────────────────┐
│ 👥  Pelanggan                          (page header) │
├───────────────────┬─────────────────────────────────┤
│  [search]         │                                  │
│  ─────────────── │   (select a customer to view     │
│  PT. Maju Bersama │    their profile)                │
│  Bpk. Slamet W. ◀│▶ [profile panel loads here]      │
│  CV. Elektrika    │                                  │
│  Ibu Ratna Dewi   │                                  │
└───────────────────┴─────────────────────────────────┘
```

Left panel: `w-72 shrink-0`, right panel: `flex-1`. Wrapped in `flex gap-0 bg-white rounded-xl border border-gray-200 overflow-hidden`.

### Page header
```tsx
<div className="flex items-center gap-3">
  <Users className="w-6 h-6 text-gray-700" />
  <h1 className="text-2xl font-bold text-gray-800">Pelanggan</h1>
</div>
```

### Left panel — customer list
- **Search bar**: `bg-white border-b border-gray-200 p-3` — filters by `name`, `wa_number`, `company` (case-insensitive, client-side)
- **Customer rows**: `divide-y divide-gray-100`, each row `px-4 py-3 cursor-pointer hover:bg-gray-50`
  - Selected row: `bg-indigo-50 border-l-[3px] border-l-[#012749]`
  - Avatar initials: 2-letter circle, `w-9 h-9 rounded-lg bg-gray-200 text-gray-600 font-bold text-sm` (selected: `bg-[#012749] text-white`)
  - Name: `font-bold text-sm text-gray-800` (selected: `text-[#012749]`)
  - WA number: `font-mono text-[10px] text-gray-400`
  - Order count: right-aligned `text-xs font-bold text-gray-500` (selected: `text-[#012749]`)
- **Empty state**: "Belum ada data pelanggan." centered in left panel
- **Loading**: skeleton shimmer or "Memuat..." text

### Right panel — empty state (no customer selected)
Centered: `Users` icon (gray, w-10 h-10) + "Pilih pelanggan untuk melihat profilnya."

### Right panel — customer profile

#### Profile header (navy)
```
bg-[#012749] text-white p-4 flex items-center gap-3
  [avatar initials — w-11 h-11 rounded-xl bg-[#2d8a4e] font-bold text-lg]
  [name — font-extrabold text-[15px]]
  [WA + company + "Pelanggan sejak DD Mon YYYY" — text-[11px] opacity-60]
  [total spend — ml-auto, text-right]
    [amount — text-lg font-extrabold text-emerald-300]
    ["total belanja" — text-[9px] opacity-55]
```

#### Stats row
Three equal columns separated by `border-r border-gray-200`, `border-b border-gray-200`:
- **Pesanan**: count of orders
- **Leads**: count of leads  
- **Konversi**: `(ORDERED leads / total leads * 100)%` — green if 100%, amber if >0%, gray if 0%

#### Riwayat Pesanan section
`px-5 py-4`, section label `text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2`.

Each order card: `border border-gray-200 rounded-lg p-3 mb-2 last:mb-0 text-xs`
- Row 1: `gjp_order_id` (monospace, bold) + status badge (right, same classes as OrderHistoryScreen `STATUS_BADGE`)
- Row 2: first item name + delivery type emoji + formatted date — `text-gray-500 text-[11px]`
- Row 3: total amount — `font-extrabold text-sm` (color from `TOTAL_COLOR` map)

Empty state: "Belum ada pesanan."

#### Leads section
`px-5 py-4 border-t border-gray-100`, same section label pattern.

Each lead row: `border border-gray-200 rounded-lg p-3 mb-2 last:mb-0 flex justify-between items-center`
- Left: lead `id` (monospace, `text-[11px]`) + created date below (`text-[10px] text-gray-400`)
- Right: status badge + "Kelola di Pipeline →" link (`text-[10px] text-gray-400 underline cursor-pointer`) that calls `onNavigate('pipeline')`

Empty state: "Belum ada lead."

---

## Screen: Pipeline (improvements)

### Search bar
Add below the filter tabs, same pattern as OrderHistoryScreen:
```tsx
<div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-400">
  <Search className="w-4 h-4 shrink-0" />
  <input placeholder="Cari nama, nomor WA, perusahaan..." ... />
</div>
```
Filters client-side against `lead.customers?.name`, `lead.wa_number`, `lead.customers?.company`.

### Collapsible rows
Each lead row gains:
- A `ChevronDown` icon (rightmost, rotates when expanded)
- `expandedId` state (same pattern as OrderHistoryScreen)
- Click on row header toggles expansion

**Collapsed row layout** — same as current but add chevron and make customer name a link:
```
[customer name (link)] · [company]    [lead ID]  [time ago]  [badge]  [chevron]
[wa number mono]
```
Customer name: `font-semibold text-sm text-[#012749] underline cursor-pointer` — clicking navigates to Pelanggan screen with that customer pre-selected.

### Expanded row — ORDERED lead (green theme)
Background `bg-green-50`, border-top `border-green-200`.

**Meta grid** (3 cols, `text-xs`):
- Pelanggan / No. WA / Pesanan Terkait

Pesanan Terkait shows `gjp_order_id` as a link (`text-[#012749] underline cursor-pointer`) that calls `onNavigate('order-history')`.

**Items table** — duplicate the `ItemsTable` component pattern from OrderHistoryScreen directly into PipelineScreen (do not extract to shared file), header class `bg-green-100 text-green-700`.

**Quick links row** (bottom, `flex gap-3 mt-2`):
- `→ Buka Percakapan` — navigates to `'sales-inbox'`
- (no status dropdown — read-only)

### Expanded row — non-ORDERED lead (default theme)
Background `bg-gray-50`, border-top `border-gray-200`.

**Meta grid** (3 cols): Pelanggan / No. WA / Status

Info box: `bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-500 text-center mb-2`
> "Lead ini belum memiliki pesanan terkonfirmasi."

**Quick links row**: `→ Buka Percakapan` only.

### No status dropdown
Pipeline is fully read-only. Status is managed by the backend automatically.

---

## Cross-screen: Customer name links

### OrderHistoryScreen
In the collapsed row, wrap `order.customer_name` in a clickable element:
```tsx
<span
  className="font-bold text-sm text-[#012749] underline cursor-pointer hover:text-[#012749]/80"
  onClick={e => { e.stopPropagation(); onOpenCustomer(order.customer_id); }}
>
  {order.customer_name}
</span>
```
Add `onOpenCustomer: (customerId: string) => void` prop to `OrderHistoryScreenProps`.

### PipelineScreen
Same pattern on customer name in collapsed row. Add `onOpenCustomer: (customerId: string) => void` prop to `PipelineScreenProps`.

---

## App.tsx changes

### New state
```tsx
const [openCustomerId, setOpenCustomerId] = useState<string | null>(null);
```

### ActivePage addition
Add `'pelanggan'` to the `ActivePage` union in `types.ts`.

### Route
```tsx
case 'pelanggan':
  return (
    <PelangganScreen
      openCustomerId={openCustomerId}
      onNavigate={setActivePage}
      showToast={triggerToast}
    />
  );
```

### onOpenCustomer handler
```tsx
const handleOpenCustomer = (customerId: string) => {
  setOpenCustomerId(customerId);
  setActivePage('pelanggan');
};
```
Pass `onOpenCustomer={handleOpenCustomer}` to `<PipelineScreen>` and `<OrderHistoryScreen>`.

When `activePage` changes away from `'pelanggan'`, reset `openCustomerId` to `null`.

---

## Sidebar

Add after Pipeline entry:
```tsx
{ id: 'pelanggan', label: 'Pelanggan', icon: Users, description: 'Profil & Riwayat' }
```
Import `Users` from `lucide-react` (already available in Lucide set).

---

## Supabase service additions

### Types to add (`src/types.ts`)

```typescript
// Customer with computed stats for list view
export interface DbCustomerWithStats extends DbCustomer {
  order_count: number;
  total_spend: number;
}

// Customer with full profile data
export interface DbCustomerProfile extends DbCustomer {
  orders: DbOrder[];
  leads: DbLead[];
}
```

Also add `'pelanggan'` to `ActivePage` union.

### `customersService` (`src/lib/supabaseClient.ts`)

```typescript
export const customersService = {
  // Fetch all customers; orders joined to compute count + total spend client-side
  async fetchAll(): Promise<DbCustomerWithStats[]> {
    const { data, error } = await supabase!
      .from('customers')
      .select('*, orders(id, total)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(c => ({
      ...c,
      order_count: c.orders?.length ?? 0,
      total_spend: (c.orders ?? []).reduce((s: number, o: any) => s + (o.total ?? 0), 0),
      orders: undefined,  // strip raw orders from the stats object
    }));
  },

  // Fetch full profile for one customer
  async fetchProfile(customerId: string): Promise<DbCustomerProfile> {
    const { data, error } = await supabase!
      .from('customers')
      .select('*, orders(*), leads(*)')
      .eq('id', customerId)
      .single();
    if (error) throw error;
    const profile = data as any;
    profile.orders = (profile.orders ?? []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    profile.leads = (profile.leads ?? []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return profile as DbCustomerProfile;
  },
};
```

### `leadsService.fetchAll()` update

Extend select to include linked orders for ORDERED leads:
```typescript
async fetchAll(): Promise<DbLead[]> {
  const { data, error } = await supabase!
    .from('leads')
    .select('*, customers(*), orders!leads_id(id, gjp_order_id, items, subtotal, shipping_fee, total, status, created_at, delivery_type)')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DbLead[];
},
```

Add `orders?: DbOrder[]` to `DbLead` interface in `types.ts`.

---

## Empty states

| Screen | Condition | Message |
|--------|-----------|---------|
| Pelanggan list | No customers | "Belum ada data pelanggan." |
| Pelanggan list | Search returns nothing | "Tidak ada pelanggan yang cocok dengan pencarian." |
| Pelanggan right panel | None selected | "Pilih pelanggan untuk melihat profilnya." |
| Pelanggan orders | No orders | "Belum ada pesanan." |
| Pelanggan leads | No leads | "Belum ada lead." |
| Pipeline search | No results | "Tidak ada lead yang cocok dengan pencarian." |

---

## Out of scope

- Editing customer profile data (name, company, WA) — managed by Go backend
- Adding notes to leads
- Exporting customer list
- Pagination (customer volume is low)
- Direct link to specific conversation from Pipeline (SalesInbox pre-selection is a separate feature)
