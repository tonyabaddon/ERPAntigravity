# E2: Sales Pipeline Screen — Design Spec

## Goal

Add a read-only "Pipeline Penjualan" screen that displays all leads with their linked customer info and status, filterable by lead stage. No writes — the Go backend owns all status transitions.

## Architecture

Four tasks in dependency order:

1. **Types** — add `DbCustomer` and `DbLead` interfaces to `src/types.ts`; add `'pipeline'` to `ActivePage`
2. **Service** — add `leadsService` to `src/lib/supabaseClient.ts` with a single `fetchAll()` using a Supabase join to get leads + embedded customer in one query
3. **Screen** — new `src/components/PipelineScreen.tsx` — read-only list with filter tabs, status badges, empty states
4. **Wiring** — add "Pipeline" entry to `src/components/Sidebar.tsx` and `case 'pipeline'` to `src/App.tsx`

No Realtime subscription needed — this is a snapshot view. Data loads on mount; admin can manually refresh if needed (future concern).

## Data Model

### DbCustomer (mirrors `customers` table)

```typescript
export interface DbCustomer {
  id: string;           // GJP-CUST-XXXX
  wa_number: string;
  name: string;
  company: string;
  created_at: string;
}
```

### DbLead (mirrors `leads` table with embedded customer)

```typescript
export interface DbLead {
  id: string;           // GJP-LEAD-YYYYMMDD-XXXX
  customer_id: string;
  conversation_id: string;
  wa_number: string;
  status: 'NEW' | 'IN_PROGRESS' | 'ESCALATED' | 'ORDERED' | 'DROPPED';
  confirmed_order_id: string | null;
  created_at: string;
  updated_at: string;
  customers: DbCustomer | null;  // joined from Supabase select('*, customers(*)')
}
```

## Service

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

## Screen Layout

### Header
- Page title: "Pipeline Penjualan" with `TrendingUp` icon
- Filter tabs row: **Semua · Aktif · Eskalasi · Selesai · Gugur**
  - Semua = all
  - Aktif = NEW + IN_PROGRESS
  - Eskalasi = ESCALATED
  - Selesai = ORDERED
  - Gugur = DROPPED
- Count badge on each tab (computed from loaded data)

### List (white card, one row per lead)

Each row shows:
- **Lead ID** (`GJP-LEAD-YYYYMMDD-XXXX`) — monospace, small, gray
- **Customer block**: name (bold) + company (if non-empty, gray) + WA number (monospace)
- **Status badge** (pill, color-coded — see below)
- **Updated** timestamp (relative: "2 jam lalu", "kemarin")

Status badge colors:
| Status | Color |
|--------|-------|
| NEW | gray |
| IN_PROGRESS | blue |
| ESCALATED | amber |
| ORDERED | green |
| DROPPED | red/muted |

### Empty states
- No leads at all: "Belum ada lead. Lead dibuat otomatis saat percakapan WhatsApp baru masuk."
- Filter has no results: "Tidak ada lead dengan status ini."

### Supabase-not-configured fallback
- Yellow banner: same pattern as PengaturanScreen

## Navigation

Sidebar entry added after "Pengaturan":
- id: `'pipeline'`
- label: `'Pipeline'`
- icon: `TrendingUp` (from lucide-react)
- description: `'Leads & Prospek'`

## What This Does NOT Include

- No write operations (status changes, notes, assignments)
- No Realtime subscription (snapshot on mount is sufficient for this view)
- No pagination (leads volume for an MSME fits in one page; add later if needed)
- No link to Sales Inbox conversation (possible future enhancement)
