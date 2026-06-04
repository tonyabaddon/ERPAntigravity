# Kasir Invoice Counter — Persistent Per-Channel Sequence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invoice numbers are unique and sequential per channel per day, generated atomically in the database instead of relying on the frontend transaction array length.

**Architecture:** One new Supabase table (`kasir_counters`) + one RPC (`next_kasir_number`) handle the counter. `kasirService` in `supabaseClient.ts` gets an async `nextInvoiceNumber(channel, date)` method. `KasirScreen.tsx` awaits the number before building the transaction.

**Tech Stack:** React 18, TypeScript, Supabase JS client, PostgreSQL

---

## Current Problem

`kasirService.generateInvoiceNumber(channel, counter)` in `src/lib/supabaseClient.ts` receives `counter` from the caller. In `KasirScreen.tsx`, counter is computed from `transactions.length + 1` at save time. This is wrong when:
- Two sales saved simultaneously → both get the same number
- Transactions fetched partially → counter restarts at a low number
- Page refreshed mid-day → counter starts over

---

## Schema

### New table: `kasir_counters`

```sql
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
```

### New RPC: `next_kasir_number`

```sql
CREATE OR REPLACE FUNCTION public.next_kasir_number(p_channel text, p_date date)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_counter int;
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

---

## Files Changed

### `src/lib/supabaseClient.ts`

**Remove** `generateInvoiceNumber(channel, counter)` static function (currently at end of kasirService).

**Add** `nextInvoiceNumber(channel: KasirChannel, date: string): Promise<string>` method to `kasirService`:

```typescript
async nextInvoiceNumber(channel: KasirChannel, date: string): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured');
  const prefix = channel === 'walkin' ? 'WLK' : channel === 'tokopedia' ? 'TPD' : 'GRS';
  const dateCompact = date.replace(/-/g, '');  // '20260605'
  const { data, error } = await supabase.rpc('next_kasir_number', {
    p_channel: channel,
    p_date: date,
  });
  if (error) throw error;
  const counter = String(data).padStart(3, '0');
  return `${prefix}-${dateCompact}-${counter}`;
},
```

### `src/components/KasirScreen.tsx`

In `handleSave` (inside `SaleModal`), find where `invoice_number` is set. Replace the synchronous call:

```typescript
// BEFORE
invoice_number: kasirService.generateInvoiceNumber(channel, transactions.length + 1),
```

With an async call before building `newTx`:

```typescript
// AFTER — call before building newTx
const invoiceNumber = await kasirService.nextInvoiceNumber(channel, selectedDate);
// then use invoiceNumber in the transaction object
invoice_number: invoiceNumber,
```

`handleSave` is already `async` (it awaits `deductFifo`), so no signature change needed.

---

## Error Handling

If `next_kasir_number` RPC fails (network error), the existing `try/catch` in `handleSave` catches it, shows a toast, and resets `saving = false` — no partial transaction is written.

---

## Testing

Manual test:
1. Open Kasir, sell a Walk-in transaction → invoice shows `WLK-20260605-001`
2. Sell another Walk-in same day → invoice shows `WLK-20260605-002`
3. Sell a Tokopedia transaction → invoice shows `TPD-20260605-001` (separate counter)
4. Refresh page, sell again → counter continues from where it left off (not reset to 001)
5. Check `kasir_counters` table in Supabase → rows for each channel+date with correct counter value
