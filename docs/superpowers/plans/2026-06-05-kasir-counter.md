# Kasir Invoice Counter — Persistent Per-Channel Sequence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile frontend transaction-count-based invoice counter with an atomic DB sequence per channel per day.

**Architecture:** New `kasir_counters` table + `next_kasir_number` RPC handle the sequence atomically. `kasirService.nextInvoiceNumber` replaces the old sync `generateInvoiceNumber`. `KasirScreen.tsx` drops the expensive prefetch of all transactions (which was only needed for the counter) and awaits the RPC instead.

**Tech Stack:** React 18, TypeScript, Supabase JS client, PostgreSQL (Supabase MCP for migration)

---

## Files

| File | Change |
|---|---|
| `supabase/migrations/20260605000003_kasir_counters.sql` | Create — new table + RPC |
| `src/lib/supabaseClient.ts` | Modify — replace `generateInvoiceNumber` with async `nextInvoiceNumber` |
| `src/components/KasirScreen.tsx` | Modify — drop prefetch + sync call, await `nextInvoiceNumber` |

---

### Task 1: Create `kasir_counters` table and `next_kasir_number` RPC

**Files:**
- Create: `supabase/migrations/20260605000003_kasir_counters.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260605000003_kasir_counters.sql` with this exact content:

```sql
-- kasir_counters: persistent per-channel per-day invoice sequence
CREATE TABLE IF NOT EXISTS public.kasir_counters (
  channel TEXT NOT NULL,
  date    DATE NOT NULL,
  counter INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (channel, date)
);

ALTER TABLE public.kasir_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_kasir_counters" ON public.kasir_counters
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "auth_all_kasir_counters" ON public.kasir_counters
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Atomically increment and return the counter for a channel+date.
-- First call for a new channel+date inserts counter=1; subsequent calls increment.
CREATE OR REPLACE FUNCTION public.next_kasir_number(p_channel text, p_date date)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_counter int;
BEGIN
  INSERT INTO public.kasir_counters (channel, date, counter)
  VALUES (p_channel, p_date, 1)
  ON CONFLICT (channel, date)
  DO UPDATE SET counter = kasir_counters.counter + 1
  RETURNING counter INTO v_counter;
  RETURN v_counter;
END;
$$;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `mcp__plugin_supabase_supabase__apply_migration` tool with:
- `project_id`: `ekhhojaezdfjfwuxyjkl`
- `name`: `kasir_counters`
- `query`: *(the SQL above)*

- [ ] **Step 3: Verify the table and function exist**

Run this SQL via `mcp__plugin_supabase_supabase__execute_sql`:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'kasir_counters';

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'next_kasir_number';
```

Expected: both queries return one row each.

- [ ] **Step 4: Smoke-test the RPC**

Run via `execute_sql`:

```sql
SELECT public.next_kasir_number('walkin', CURRENT_DATE);
SELECT public.next_kasir_number('walkin', CURRENT_DATE);
SELECT public.next_kasir_number('tokopedia', CURRENT_DATE);
SELECT * FROM public.kasir_counters;
```

Expected results:
- First call returns `1`
- Second call returns `2`
- Tokopedia call returns `1` (separate counter)
- `kasir_counters` table has 2 rows: `(walkin, today, 2)` and `(tokopedia, today, 1)`

- [ ] **Step 5: Commit the migration file**

```bash
git add supabase/migrations/20260605000003_kasir_counters.sql
git commit -m "feat(db): add kasir_counters table and next_kasir_number RPC"
```

---

### Task 2: Replace `generateInvoiceNumber` with async `nextInvoiceNumber` in supabaseClient.ts

**Files:**
- Modify: `src/lib/supabaseClient.ts` (lines 897–901)

- [ ] **Step 1: Find the current function**

Open `src/lib/supabaseClient.ts`. Find this block at line 897:

```typescript
  generateInvoiceNumber(channel: 'walkin' | 'tokopedia' | 'grosir', counter: number): string {
    const prefix = { walkin: 'WLK', tokopedia: 'TPD', grosir: 'GRS' }[channel];
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${prefix}-${date}-${String(counter).padStart(3, '0')}`;
  },
```

- [ ] **Step 2: Replace with `nextInvoiceNumber`**

Replace the entire `generateInvoiceNumber` method with:

```typescript
  async nextInvoiceNumber(channel: KasirChannel, date: string): Promise<string> {
    if (!supabase) throw new Error('Supabase not configured');
    const prefix = channel === 'walkin' ? 'WLK' : channel === 'tokopedia' ? 'TPD' : 'GRS';
    const dateCompact = date.replace(/-/g, '');
    const { data, error } = await supabase.rpc('next_kasir_number', {
      p_channel: channel,
      p_date: date,
    });
    if (error) throw error;
    const counter = String(data).padStart(3, '0');
    return `${prefix}-${dateCompact}-${counter}`;
  },
```

The `KasirChannel` type is already imported from `../types` at the top of `kasirService` usage — it's defined as `'walkin' | 'tokopedia' | 'grosir'` in `src/types.ts`.

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: `✓ built in X.XXs` — no errors. (There will be a TypeScript error in `KasirScreen.tsx` about `generateInvoiceNumber` not existing — that's expected and fixed in Task 3.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabaseClient.ts
git commit -m "feat(kasir): replace generateInvoiceNumber with async nextInvoiceNumber RPC"
```

---

### Task 3: Update KasirScreen.tsx — await nextInvoiceNumber, drop expensive prefetch

**Files:**
- Modify: `src/components/KasirScreen.tsx` (lines 617–619 in `handleSave`)

**Context:** `handleSave` in the `SaleModal` component (around line 610) currently:
1. Fetches ALL transactions for the day (line 617) — only used to count by channel for the invoice number
2. Counts filtered results + 1 (line 618)
3. Calls sync `generateInvoiceNumber` (line 619)

The prefetch on line 617 is expensive (full table scan per save) and was only needed for the counter. It can be removed entirely.

- [ ] **Step 1: Locate the three lines to replace**

In `src/components/KasirScreen.tsx`, find this block inside `handleSave` (around line 617):

```typescript
      const existing = await kasirService.fetchTransactions(selectedDate);
      const counter = existing.filter(t => t.channel === channel).length + 1;
      const invoiceNumber = kasirService.generateInvoiceNumber(channel, counter);
```

- [ ] **Step 2: Replace with single async RPC call**

Replace those 3 lines with:

```typescript
      const invoiceNumber = await kasirService.nextInvoiceNumber(channel, selectedDate);
```

The `selectedDate` variable already exists in `SaleModal`'s scope (it's a prop passed down from `KasirScreen`). The `channel` variable already exists too.

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build
```

Expected: `✓ built in X.XXs` — no errors, no references to `generateInvoiceNumber` remaining.

- [ ] **Step 4: Manual test**

Start the dev server: `npm run dev`

1. Open the Kasir page, select today's date, click "Walk-in"
2. Add a product, fill customer name + phone, click "Simpan Saja"
3. The saved transaction should show invoice `WLK-20260605-001`
4. Save another Walk-in → should show `WLK-20260605-002`
5. Save a Tokopedia transaction → should show `TPD-20260605-001`
6. Refresh the page, save another Walk-in → should show `WLK-20260605-003` (not 001)
7. In Supabase dashboard, check `kasir_counters` table → rows with correct channel+date+counter

- [ ] **Step 5: Commit**

```bash
git add src/components/KasirScreen.tsx
git commit -m "fix(kasir): use DB-backed invoice counter, drop expensive prefetch"
```

---

### Task 4: Push to deploy

- [ ] **Step 1: Push**

```bash
git push origin main
```

Expected: Cloud Build triggers backend and/or frontend deploy. The migration was already applied directly via MCP in Task 1, so no DB migration runs during deploy.

- [ ] **Step 2: Update progress.md**

Add a section at the end of `progress.md`:

```markdown
## Kasir Invoice Counter — DONE (2026-06-05)

- Created `kasir_counters` table with `(channel, date)` primary key
- Created `next_kasir_number(p_channel, p_date)` RPC — atomic INSERT ON CONFLICT DO UPDATE
- `kasirService.generateInvoiceNumber` replaced with async `nextInvoiceNumber` calling the RPC
- `KasirScreen.tsx handleSave`: removed expensive `fetchTransactions` prefetch (was only used for counter); now calls `nextInvoiceNumber` directly
- Invoice numbers are now unique and sequential even across simultaneous saves and page refreshes
- Committed: feat(db), feat(kasir), fix(kasir)
```

```bash
git add progress.md
git commit -m "docs(progress): record kasir counter fix"
git push origin main
```
