# Pembelian Phase 2b — Tukar Faktur Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `tukar_faktur` entity + RPCs + UI (search-and-add Jurnal-style) on top of Phase 2a foundation, with foreign-faktur escape via relaxed `pi_type_linkage_check` and on-demand Tanda Terima PDF.

**Architecture:** New `tukar_faktur` table with derived status (no DRAFT/TERTANDA enum). Relation Tagihan → TF via existing `purchase_invoices.tukar_faktur_id` (1:N). Pembayaran junction unchanged from Phase 2a. JT override at view layer via `COALESCE(tf.payment_due_at, pi.payment_due_at)`. Tanda Terima PDF regenerated client-side via jsPDF.

**Tech Stack:** Supabase Postgres (migration slot `20260627000001+`) + React + Vite + TypeScript + Tailwind + lucide-react + jsPDF (already in deps).

**Spec:** `docs/superpowers/specs/2026-06-19-pembelian-phase2b-tukar-faktur-design.md`
**Mockup:** `tmp/pembelian-phase2b-tukar-faktur-mockup.html`
**Worktree:** Recommend `.claude/worktrees/pembelian-phase2b` on branch `feat/pembelian-phase2b`

---

## Task 1: Schema migration — TF table + relaxed CHECK + is_tf_quick_add

**Files:**
- Create: `supabase/migrations/20260627000001_phase2b_tukar_faktur_schema.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260627000001_phase2b_tukar_faktur_schema.sql
-- Phase 2b: Tukar Faktur entity + foreign-faktur escape via relaxed pi_type_linkage_check.
-- No DRAFT/TERTANDA state machine — status derived from paid_amount vs total_amount.

BEGIN;

-- Tukar Faktur table
CREATE TABLE public.tukar_faktur (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tf_number              text NOT NULL UNIQUE,
  supplier_id            uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  tukar_date             date NOT NULL,
  payment_due_at         date NOT NULL,
  total_amount           numeric NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  paid_amount            numeric NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  photo_urls             text[] NOT NULL DEFAULT '{}',
  tanda_terima_printed_at timestamptz NULL,
  notes                  text NULL,
  created_by_user_id     uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  voided_at              timestamptz NULL,
  voided_by_user_id      uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason            text NULL,
  CHECK (paid_amount <= total_amount)
);

CREATE INDEX tukar_faktur_supplier_id_idx ON public.tukar_faktur(supplier_id);
CREATE INDEX tukar_faktur_due_at_idx ON public.tukar_faktur(payment_due_at)
  WHERE voided_at IS NULL;

-- updated_at trigger
CREATE TRIGGER tukar_faktur_set_updated_at
BEFORE UPDATE ON public.tukar_faktur
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS deny-by-default (RPCs run SECURITY DEFINER)
ALTER TABLE public.tukar_faktur ENABLE ROW LEVEL SECURITY;

-- purchase_invoices: add is_tf_quick_add flag
ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS is_tf_quick_add boolean NOT NULL DEFAULT false;

-- Relax pi_type_linkage_check: STOCK can link via Pesanan OR TF OR be tf_quick_add
ALTER TABLE public.purchase_invoices DROP CONSTRAINT IF EXISTS pi_type_linkage_check;

ALTER TABLE public.purchase_invoices ADD CONSTRAINT pi_type_linkage_check CHECK (
  (type = 'PASSTHROUGH' AND order_id IS NOT NULL AND pesanan_id IS NULL)
  OR
  (type = 'STOCK' AND order_id IS NULL AND (
    pesanan_id IS NOT NULL
    OR tukar_faktur_id IS NOT NULL
    OR is_tf_quick_add = true
  ))
);

COMMIT;
```

- [ ] **Step 2: Apply via Supabase MCP**

```bash
# Via mcp__plugin_supabase_supabase__apply_migration (project_id: ekhhojaezdfjfwuxyjkl)
# Name: phase2b_tukar_faktur_schema
```

Expected: `{"success": true}`

- [ ] **Step 3: Verify schema**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'tukar_faktur'
ORDER BY ordinal_position;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'purchase_invoices' AND column_name = 'is_tf_quick_add';
```

Expected: tukar_faktur has 16 columns; is_tf_quick_add column exists with default false.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260627000001_phase2b_tukar_faktur_schema.sql
git commit -m "feat(pembelian): tukar_faktur table + is_tf_quick_add flag + relaxed pi_type_linkage_check (Phase 2b Task 1)"
```

---

## Task 2: Trigger — `_tf_recompute_paid_amount`

**Files:**
- Create: `supabase/migrations/20260627000002_phase2b_tf_paid_trigger.sql`

- [ ] **Step 1: Write the trigger migration**

```sql
-- supabase/migrations/20260627000002_phase2b_tf_paid_trigger.sql
-- Maintain tukar_faktur.paid_amount from pembayaran_items sum.
-- Mirrors Phase 2a _recompute_tagihan_status pattern for Tagihan.

BEGIN;

CREATE OR REPLACE FUNCTION public._tf_recompute_paid_amount() RETURNS trigger AS $$
DECLARE v_tf_id uuid;
BEGIN
  v_tf_id := COALESCE(NEW.tukar_faktur_id, OLD.tukar_faktur_id);
  IF v_tf_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  UPDATE public.tukar_faktur
  SET paid_amount = COALESCE((
    SELECT SUM(pi_item.amount)
    FROM public.pembayaran_items pi_item
    JOIN public.pembayaran p ON p.id = pi_item.pembayaran_id
    WHERE pi_item.tukar_faktur_id = v_tf_id
      AND p.status = 'LUNAS'
      AND p.voided_at IS NULL
  ), 0)
  WHERE id = v_tf_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER _tf_recompute_after_pembayaran_items
AFTER INSERT OR UPDATE OR DELETE ON public.pembayaran_items
FOR EACH ROW
EXECUTE FUNCTION public._tf_recompute_paid_amount();

COMMIT;
```

- [ ] **Step 2: Apply via MCP + verify trigger exists**

```sql
SELECT trigger_name FROM information_schema.triggers
WHERE trigger_name = '_tf_recompute_after_pembayaran_items';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260627000002_phase2b_tf_paid_trigger.sql
git commit -m "feat(pembelian): _tf_recompute_paid_amount trigger (Phase 2b Task 2)"
```

---

## Task 3: RPC — `generate_tf_number` + `record_tukar_faktur`

**Files:**
- Create: `supabase/migrations/20260627000003_phase2b_rpc_record_tf.sql`

- [ ] **Step 1: Write generate_tf_number (mirrors Phase 2a number generators)**

```sql
-- supabase/migrations/20260627000003_phase2b_rpc_record_tf.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.generate_tf_number() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_yyyy text := to_char((now() AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY');
  v_mm   text := to_char((now() AT TIME ZONE 'Asia/Jakarta')::date, 'MM');
  v_n    int;
  v_nnn  text;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(tf_number FROM 12) AS INT)), 0) + 1 INTO v_n
  FROM public.tukar_faktur
  WHERE tf_number LIKE 'TF-' || v_yyyy || '-' || v_mm || '-%';
  v_nnn := LPAD(v_n::text, 3, '0');
  RETURN 'TF-' || v_yyyy || '-' || v_mm || '-' || v_nnn;
END;
$$;
```

- [ ] **Step 2: Write record_tukar_faktur in same migration**

```sql
CREATE OR REPLACE FUNCTION public.record_tukar_faktur(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tf_id uuid := gen_random_uuid();
  v_tf_number text := public.generate_tf_number();
  v_supplier_id uuid := (payload->>'supplier_id')::uuid;
  v_tukar_date date := (payload->>'tukar_date')::date;
  v_due_at date := (payload->>'payment_due_at')::date;
  v_tagihan_ids uuid[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(payload->'tagihan_ids', '[]'::jsonb)))::uuid[];
  v_quick_add jsonb := COALESCE(payload->'quick_add_tagihans', '[]'::jsonb);
  v_photo_urls text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(payload->'photo_urls', '[]'::jsonb)));
  v_notes text := payload->>'notes';
  v_total numeric := 0;
  v_existing_tf text;
  v_quick_item jsonb;
  v_quick_id uuid;
  v_quick_ids uuid[] := '{}';
BEGIN
  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'supplier_id required'; END IF;
  IF v_tukar_date IS NULL THEN RAISE EXCEPTION 'tukar_date required'; END IF;
  IF v_due_at IS NULL THEN RAISE EXCEPTION 'payment_due_at required'; END IF;

  -- Same-supplier check on tagihan_ids
  IF EXISTS (
    SELECT 1 FROM public.purchase_invoices
    WHERE id = ANY(v_tagihan_ids) AND supplier_id <> v_supplier_id
  ) THEN
    RAISE EXCEPTION 'same_supplier_violation';
  END IF;

  -- Already-bundled check
  SELECT t.tf_number INTO v_existing_tf
  FROM public.purchase_invoices pi
  JOIN public.tukar_faktur t ON t.id = pi.tukar_faktur_id
  WHERE pi.id = ANY(v_tagihan_ids)
    AND t.voided_at IS NULL
  LIMIT 1;
  IF v_existing_tf IS NOT NULL THEN
    RAISE EXCEPTION 'tagihan_already_bundled: %', v_existing_tf;
  END IF;

  -- Insert quick-add Tagihans first
  FOR v_quick_item IN SELECT * FROM jsonb_array_elements(v_quick_add) LOOP
    v_quick_id := gen_random_uuid();
    INSERT INTO public.purchase_invoices (
      id, pi_number, type, supplier_id,
      pesanan_id, tukar_faktur_id, is_tf_quick_add,
      purchase_date, supplier_invoice_number,
      payment_due_at, paid_at,
      subtotal, total, status, paid_amount, notes, created_by_user_id
    ) VALUES (
      v_quick_id, public.generate_pi_number(), 'STOCK', v_supplier_id,
      NULL, v_tf_id, true,
      (v_quick_item->>'purchase_date')::date,
      v_quick_item->>'supplier_invoice_number',
      (v_quick_item->>'payment_due_at')::date, NULL,
      (v_quick_item->>'total')::numeric, (v_quick_item->>'total')::numeric,
      'BELUM_LUNAS', 0,
      'TF quick-add — items kosong, link Pesanan nanti kalau perlu',
      auth.uid()
    );
    v_quick_ids := array_append(v_quick_ids, v_quick_id);
    v_total := v_total + (v_quick_item->>'total')::numeric;
  END LOOP;

  -- Sum existing Tagihan totals
  SELECT v_total + COALESCE(SUM(total), 0) INTO v_total
  FROM public.purchase_invoices WHERE id = ANY(v_tagihan_ids);

  -- Insert TF
  INSERT INTO public.tukar_faktur (
    id, tf_number, supplier_id, tukar_date, payment_due_at,
    total_amount, photo_urls, notes, created_by_user_id
  ) VALUES (
    v_tf_id, v_tf_number, v_supplier_id, v_tukar_date, v_due_at,
    v_total, v_photo_urls, v_notes, auth.uid()
  );

  -- Link existing Tagihans
  UPDATE public.purchase_invoices SET tukar_faktur_id = v_tf_id
  WHERE id = ANY(v_tagihan_ids) AND tukar_faktur_id IS NULL;

  RETURN jsonb_build_object('tf_number', v_tf_number, 'tf_id', v_tf_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_tukar_faktur(jsonb) TO authenticated;

COMMIT;
```

- [ ] **Step 3: Apply via MCP + smoke test**

```sql
-- Quick sanity: generate a TF number twice, increments per-month
SELECT public.generate_tf_number();
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260627000003_phase2b_rpc_record_tf.sql
git commit -m "feat(pembelian): generate_tf_number + record_tukar_faktur RPC (Phase 2b Task 3)"
```

---

## Task 4: RPC — `update_tukar_faktur` + `add_tagihan_to_tf` + `remove_tagihan_from_tf` + `delete_tukar_faktur`

**Files:**
- Create: `supabase/migrations/20260627000004_phase2b_rpc_tf_mutations.sql`

- [ ] **Step 1: Write all 4 mutation RPCs**

```sql
-- supabase/migrations/20260627000004_phase2b_rpc_tf_mutations.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.update_tukar_faktur(p_tf_id uuid, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.tukar_faktur SET
    tukar_date = COALESCE((payload->>'tukar_date')::date, tukar_date),
    payment_due_at = COALESCE((payload->>'payment_due_at')::date, payment_due_at),
    notes = COALESCE(payload->>'notes', notes),
    photo_urls = COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(payload->'photo_urls')),
      photo_urls
    )
  WHERE id = p_tf_id AND voided_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_tagihan_to_tf(p_tf_id uuid, p_tagihan_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_tf_supplier uuid;
  v_pi_supplier uuid;
  v_existing_tf text;
  v_pi_total numeric;
  v_pi_status text;
BEGIN
  SELECT supplier_id INTO v_tf_supplier FROM public.tukar_faktur
  WHERE id = p_tf_id AND voided_at IS NULL;
  IF v_tf_supplier IS NULL THEN RAISE EXCEPTION 'tf_not_found_or_voided'; END IF;

  SELECT supplier_id, total, status INTO v_pi_supplier, v_pi_total, v_pi_status
  FROM public.purchase_invoices WHERE id = p_tagihan_id;
  IF v_pi_supplier IS NULL THEN RAISE EXCEPTION 'tagihan_not_found'; END IF;
  IF v_pi_supplier <> v_tf_supplier THEN RAISE EXCEPTION 'same_supplier_violation'; END IF;
  IF v_pi_status = 'LUNAS' THEN RAISE EXCEPTION 'tagihan_already_paid'; END IF;

  SELECT t.tf_number INTO v_existing_tf
  FROM public.purchase_invoices pi
  JOIN public.tukar_faktur t ON t.id = pi.tukar_faktur_id
  WHERE pi.id = p_tagihan_id AND t.voided_at IS NULL;
  IF v_existing_tf IS NOT NULL THEN
    RAISE EXCEPTION 'tagihan_already_bundled: %', v_existing_tf;
  END IF;

  UPDATE public.purchase_invoices SET tukar_faktur_id = p_tf_id WHERE id = p_tagihan_id;
  UPDATE public.tukar_faktur SET total_amount = total_amount + v_pi_total WHERE id = p_tf_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_tagihan_from_tf(p_tf_id uuid, p_tagihan_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_paid numeric;
  v_pi_total numeric;
BEGIN
  SELECT paid_amount INTO v_paid FROM public.tukar_faktur WHERE id = p_tf_id;
  IF v_paid > 0 THEN RAISE EXCEPTION 'cannot_remove_from_paid_tf'; END IF;

  SELECT total INTO v_pi_total FROM public.purchase_invoices
  WHERE id = p_tagihan_id AND tukar_faktur_id = p_tf_id;
  IF v_pi_total IS NULL THEN RAISE EXCEPTION 'tagihan_not_in_tf'; END IF;

  UPDATE public.purchase_invoices SET tukar_faktur_id = NULL WHERE id = p_tagihan_id;
  UPDATE public.tukar_faktur SET total_amount = total_amount - v_pi_total WHERE id = p_tf_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_tukar_faktur(p_tf_id uuid, p_reason text DEFAULT 'manual') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_paid numeric;
BEGIN
  SELECT paid_amount INTO v_paid FROM public.tukar_faktur
  WHERE id = p_tf_id AND voided_at IS NULL;
  IF v_paid IS NULL THEN RAISE EXCEPTION 'tf_not_found_or_voided'; END IF;
  IF v_paid > 0 THEN RAISE EXCEPTION 'cannot_delete_paid_tf'; END IF;

  -- Cascade soft-delete tf_quick_add Tagihans
  UPDATE public.purchase_invoices SET
    voided_at = now(),
    voided_by_user_id = auth.uid(),
    void_reason = 'cascade from TF deletion: ' || COALESCE(p_reason, 'manual')
  WHERE tukar_faktur_id = p_tf_id AND is_tf_quick_add = true;

  -- Unlink normal Tagihans
  UPDATE public.purchase_invoices SET tukar_faktur_id = NULL
  WHERE tukar_faktur_id = p_tf_id AND is_tf_quick_add = false;

  -- Soft-delete TF
  UPDATE public.tukar_faktur SET
    voided_at = now(),
    voided_by_user_id = auth.uid(),
    void_reason = p_reason
  WHERE id = p_tf_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_tukar_faktur(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_tagihan_to_tf(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_tagihan_from_tf(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_tukar_faktur(uuid, text) TO authenticated;

COMMIT;
```

- [ ] **Step 2: Apply via MCP**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260627000004_phase2b_rpc_tf_mutations.sql
git commit -m "feat(pembelian): update/add/remove/delete TF RPCs (Phase 2b Task 4)"
```

---

## Task 5: Extend `pembayaran_suggest_outstanding` to return TFs

**Files:**
- Create: `supabase/migrations/20260627000005_phase2b_extend_suggest_outstanding.sql`

- [ ] **Step 1: Rewrite RPC to return both tagihan + tukar_faktur arrays**

```sql
-- supabase/migrations/20260627000005_phase2b_extend_suggest_outstanding.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.pembayaran_suggest_outstanding(p_supplier_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'tagihan', COALESCE((
      SELECT jsonb_agg(t ORDER BY t->>'payment_due_at')
      FROM (
        SELECT jsonb_build_object(
          'id', id, 'pi_number', pi_number,
          'total', total, 'paid_amount', paid_amount,
          'outstanding', total - paid_amount,
          'payment_due_at', payment_due_at,
          'supplier_invoice_number', supplier_invoice_number
        ) AS t
        FROM public.purchase_invoices
        WHERE supplier_id = p_supplier_id
          AND status IN ('BELUM_LUNAS','DIBAYAR_SEBAGIAN')
          AND voided_at IS NULL
          AND tukar_faktur_id IS NULL                  -- exclude bundled (TF handles its own)
      ) sub
    ), '[]'::jsonb),
    'tukar_faktur', COALESCE((
      SELECT jsonb_agg(t ORDER BY t->>'payment_due_at')
      FROM (
        SELECT jsonb_build_object(
          'id', id, 'tf_number', tf_number,
          'total', total_amount, 'paid_amount', paid_amount,
          'outstanding', total_amount - paid_amount,
          'payment_due_at', payment_due_at,
          'tagihan_count', (SELECT COUNT(*) FROM public.purchase_invoices WHERE tukar_faktur_id = tf.id)
        ) AS t
        FROM public.tukar_faktur tf
        WHERE supplier_id = p_supplier_id
          AND voided_at IS NULL
          AND total_amount > paid_amount
      ) sub
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

COMMIT;
```

- [ ] **Step 2: Apply via MCP**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260627000005_phase2b_extend_suggest_outstanding.sql
git commit -m "feat(pembelian): extend pembayaran_suggest_outstanding to include TFs (Phase 2b Task 5)"
```

---

## Task 6: Types — DbTukarFaktur + payloads

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add Phase 2b types**

After Phase 2a type block, add:

```typescript
// ===== Phase 2b: Tukar Faktur =====

export type TukarFakturStatus = 'BELUM_LUNAS' | 'DIBAYAR_SEBAGIAN' | 'LUNAS' | 'VOIDED';

export interface DbTukarFaktur {
  id: string;
  tf_number: string;
  supplier_id: string;
  supplier?: { id: string; name: string; payment_term_days: number | null };
  tukar_date: string;                       // ISO date
  payment_due_at: string;
  total_amount: number;
  paid_amount: number;
  photo_urls: string[];
  tanda_terima_printed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  voided_at: string | null;
  status: TukarFakturStatus;                // computed
  tagihans?: Array<{
    id: string;
    pi_number: string;
    supplier_invoice_number: string | null;
    purchase_date: string;
    payment_due_at: string;                  // JT asli (display strikethrough)
    total: number;
    paid_amount: number;
    is_tf_quick_add: boolean;
  }>;
}

export interface TfQuickAddTagihanDraft {
  supplier_invoice_number: string;
  purchase_date: string;
  total: number;
  payment_due_at: string;
}

export interface RecordTukarFakturPayload {
  supplier_id: string;
  tukar_date: string;
  payment_due_at: string;
  tagihan_ids: string[];
  quick_add_tagihans?: TfQuickAddTagihanDraft[];
  photo_urls?: string[];
  notes?: string;
}

export interface UpdateTukarFakturPayload {
  tukar_date?: string;
  payment_due_at?: string;
  notes?: string;
  photo_urls?: string[];
}

export interface SuggestOutstandingTukarFakturRow {
  id: string;
  tf_number: string;
  total: number;
  paid_amount: number;
  outstanding: number;
  payment_due_at: string;
  tagihan_count: number;
}
```

Also update `SuggestOutstandingResult` (Phase 2a) to include `tukar_faktur: SuggestOutstandingTukarFakturRow[]`.

- [ ] **Step 2: Run tsc**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): DbTukarFaktur + payloads + extend SuggestOutstandingResult (Phase 2b Task 6)"
```

---

## Task 7: Service — `tukarFakturService.ts`

**Files:**
- Create: `src/lib/tukarFakturService.ts`

- [ ] **Step 1: Write service wrapper**

```typescript
// src/lib/tukarFakturService.ts
// CRUD + RPC wrappers for Tukar Faktur entity.
import { supabase } from './supabaseClient';
import type {
  DbTukarFaktur, RecordTukarFakturPayload, UpdateTukarFakturPayload,
  TukarFakturStatus
} from '../types';

function deriveStatus(tf: { paid_amount: number; total_amount: number; voided_at: string | null }): TukarFakturStatus {
  if (tf.voided_at) return 'VOIDED';
  if (tf.paid_amount === 0) return 'BELUM_LUNAS';
  if (tf.paid_amount < tf.total_amount) return 'DIBAYAR_SEBAGIAN';
  return 'LUNAS';
}

export const tukarFakturService = {
  async fetchAll(): Promise<DbTukarFaktur[]> {
    const { data, error } = await supabase
      .from('tukar_faktur')
      .select(`
        id, tf_number, supplier_id, tukar_date, payment_due_at,
        total_amount, paid_amount, photo_urls, tanda_terima_printed_at,
        notes, created_at, updated_at, voided_at,
        supplier:suppliers(id, name, payment_term_days)
      `)
      .order('tukar_date', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: any) => ({ ...row, status: deriveStatus(row) }));
  },

  async fetchByNumber(tf_number: string): Promise<DbTukarFaktur | null> {
    const { data, error } = await supabase
      .from('tukar_faktur')
      .select(`
        id, tf_number, supplier_id, tukar_date, payment_due_at,
        total_amount, paid_amount, photo_urls, tanda_terima_printed_at,
        notes, created_at, updated_at, voided_at,
        supplier:suppliers(id, name, payment_term_days)
      `)
      .eq('tf_number', tf_number)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    // Fetch bundled Tagihans separately
    const { data: tagihans } = await supabase
      .from('purchase_invoices')
      .select('id, pi_number, supplier_invoice_number, purchase_date, payment_due_at, total, paid_amount, is_tf_quick_add')
      .eq('tukar_faktur_id', data.id);

    return { ...data, status: deriveStatus(data), tagihans: tagihans ?? [] };
  },

  async record(payload: RecordTukarFakturPayload): Promise<{ tf_number: string; tf_id: string }> {
    const { data, error } = await supabase.rpc('record_tukar_faktur', { payload });
    if (error) throw error;
    return data as any;
  },

  async update(p_tf_id: string, payload: UpdateTukarFakturPayload) {
    const { data, error } = await supabase.rpc('update_tukar_faktur', { p_tf_id, payload });
    if (error) throw error;
    return data;
  },

  async addTagihan(p_tf_id: string, p_tagihan_id: string) {
    const { data, error } = await supabase.rpc('add_tagihan_to_tf', { p_tf_id, p_tagihan_id });
    if (error) throw error;
    return data;
  },

  async removeTagihan(p_tf_id: string, p_tagihan_id: string) {
    const { data, error } = await supabase.rpc('remove_tagihan_from_tf', { p_tf_id, p_tagihan_id });
    if (error) throw error;
    return data;
  },

  async delete(p_tf_id: string, p_reason: string = 'manual') {
    const { data, error } = await supabase.rpc('delete_tukar_faktur', { p_tf_id, p_reason });
    if (error) throw error;
    return data;
  },

  async markPrinted(p_tf_id: string) {
    const { error } = await supabase
      .from('tukar_faktur')
      .update({ tanda_terima_printed_at: new Date().toISOString() })
      .eq('id', p_tf_id);
    if (error) throw error;
  },

  /** Lookup outstanding Tagihans for a supplier, excluding those already bundled in TF. */
  async fetchOutstandingTagihansForTf(supplier_id: string, excludeIds: string[] = []) {
    const { data, error } = await supabase
      .from('purchase_invoices')
      .select('id, pi_number, supplier_invoice_number, purchase_date, payment_due_at, total, paid_amount')
      .eq('supplier_id', supplier_id)
      .eq('type', 'STOCK')
      .in('status', ['BELUM_LUNAS', 'DIBAYAR_SEBAGIAN'])
      .is('voided_at', null)
      .is('tukar_faktur_id', null);
    if (error) throw error;
    return (data ?? []).filter(t => !excludeIds.includes(t.id));
  },
};
```

- [ ] **Step 2: Run tsc + verify import paths**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/tukarFakturService.ts
git commit -m "feat(pembelian): tukarFakturService with CRUD + RPC wrappers (Phase 2b Task 7)"
```

---

## Task 8: `TukarFakturList.tsx` — simple PesananList pattern

**Files:**
- Create: `src/components/pembelian/tukar-faktur/TukarFakturList.tsx`

- [ ] **Step 1: Component matching PesananList structure**

Reference: `src/components/pembelian/pesanan/PesananList.tsx` for exact pattern.

```tsx
// src/components/pembelian/tukar-faktur/TukarFakturList.tsx
import React, { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { tukarFakturService } from '../../../lib/tukarFakturService';
import type { DbTukarFaktur, TukarFakturStatus } from '../../../types';

const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmtDate = (s?: string|null) => s ? new Date(s).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const daysFromToday = (s?: string|null): number|null => {
  if (!s) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.round((new Date(s+'T00:00:00').getTime() - today.getTime())/86400000);
};

interface Props {
  showToast: (msg: string, type?: 'success'|'info'|'warning') => void;
  onCreate: () => void;
  onOpenDetail: (tf_number: string) => void;
}

const STATUS_BADGE: Record<TukarFakturStatus, string> = {
  BELUM_LUNAS:      'bg-amber-100 text-amber-800',
  DIBAYAR_SEBAGIAN: 'bg-sky-100 text-sky-800',
  LUNAS:            'bg-green-100 text-green-800',
  VOIDED:           'bg-gray-200 text-gray-600',
};

const STATUS_LABEL: Record<TukarFakturStatus, string> = {
  BELUM_LUNAS: 'Belum Lunas',
  DIBAYAR_SEBAGIAN: 'Dibayar Sebagian',
  LUNAS: 'Lunas',
  VOIDED: 'Dihapus',
};

export default function TukarFakturList({ showToast, onCreate, onOpenDetail }: Props) {
  const [list, setList] = useState<DbTukarFaktur[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'ALL'|TukarFakturStatus>('ALL');
  const [search, setSearch] = useState('');

  async function reload() {
    setLoading(true);
    try { setList(await tukarFakturService.fetchAll()); }
    catch (e: any) { showToast(e?.message ?? 'Gagal load Tukar Faktur', 'warning'); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  const filtered = list.filter(tf => {
    if (statusFilter !== 'ALL' && tf.status !== statusFilter) return false;
    if (search && !tf.tf_number.toLowerCase().includes(search.toLowerCase())
      && !tf.supplier?.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalOutstanding = filtered
    .filter(tf => tf.status !== 'LUNAS' && tf.status !== 'VOIDED')
    .reduce((a, tf) => a + (tf.total_amount - tf.paid_amount), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold" style={{ color: '#012749' }}>Tukar Faktur Pembelian</h2>
          <div className="text-xs text-gray-500">Bundle Tagihan supplier untuk ritual tukar faktur fisik & pembayaran kolektif</div>
        </div>
        <button onClick={onCreate} className="inline-flex items-center gap-2 text-sm font-bold text-white px-4 py-2 rounded-lg" style={{ background:'#012749' }}>
          <Plus className="w-4 h-4" /> Buat Tukar Faktur
        </button>
      </div>

      <div className="flex justify-end gap-2">
        <div className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-full pl-3 pr-1 py-1">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input className="text-xs outline-none w-52" placeholder="Cari TF / supplier..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="text-xs px-2 py-1.5 border border-gray-200 rounded-lg bg-white" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
          <option value="ALL">Semua status</option>
          <option value="BELUM_LUNAS">Belum Lunas</option>
          <option value="DIBAYAR_SEBAGIAN">Dibayar Sebagian</option>
          <option value="LUNAS">Lunas</option>
        </select>
      </div>

      <div className="bg-white/78 backdrop-blur-xl rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? <div className="p-8 text-center text-sm text-gray-500">Memuat...</div>
         : filtered.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">Belum ada Tukar Faktur — semua sudah dibayar langsung ✨</div>
         : (
          <table className="w-full">
            <thead className="bg-gray-50/80 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">TF</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Supplier</th>
                <th className="text-center px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Faktur</th>
                <th className="text-right px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Total</th>
                <th className="text-right px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Dibayar</th>
                <th className="text-center px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">JT</th>
                <th className="text-center px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(tf => {
                const days = daysFromToday(tf.payment_due_at);
                const dueSoon = tf.status !== 'LUNAS' && days !== null && days <= 7;
                return (
                  <tr key={tf.id} className={`hover:bg-slate-50 border-b border-gray-100 ${dueSoon ? 'border-l-4 border-l-amber-400' : ''}`}>
                    <td className="px-5 py-4">
                      <div className="font-bold text-sm" style={{ color:'#012749' }}>{tf.tf_number}</div>
                      <div className="text-xs text-gray-500">{fmtDate(tf.tukar_date)}</div>
                    </td>
                    <td className="px-5 py-4 text-sm font-semibold">{tf.supplier?.name ?? '—'}</td>
                    <td className="px-5 py-4 text-center text-sm">{tf.tagihans?.length ?? '—'}</td>
                    <td className="px-5 py-4 text-right text-sm font-bold">{fmtRp(tf.total_amount)}</td>
                    <td className={`px-5 py-4 text-right text-sm ${tf.paid_amount > 0 ? 'font-bold text-sky-700' : 'text-gray-400'}`}>{fmtRp(tf.paid_amount)}</td>
                    <td className="px-5 py-4 text-center">
                      <div className={`text-xs font-bold ${dueSoon ? 'text-amber-700' : 'text-gray-700'}`}>{fmtDate(tf.payment_due_at)}</div>
                      {days !== null && tf.status !== 'LUNAS' && (
                        <div className={`text-[10px] ${days < 0 ? 'text-red-600 font-bold' : dueSoon ? 'text-amber-600 font-semibold' : 'text-gray-500'}`}>
                          {days < 0 ? `⚠ Terlambat ${Math.abs(days)} hari` : days === 0 ? 'Hari ini' : `${days} hari lagi`}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[tf.status]}`}>{STATUS_LABEL[tf.status]}</span>
                    </td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      <button onClick={() => onOpenDetail(tf.tf_number)} className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50">Detail</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="bg-gray-50/80 border-t-2 border-gray-300">
                <tr>
                  <td className="px-5 py-3 text-[11px] font-bold uppercase text-gray-500" colSpan={3}>Subtotal Outstanding ({filtered.filter(t => t.status !== 'LUNAS').length} TF)</td>
                  <td className="px-5 py-3 text-right text-sm font-extrabold" style={{ color:'#012749' }}>{fmtRp(totalOutstanding)}</td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tsc**

- [ ] **Step 3: Commit**

```bash
git add src/components/pembelian/tukar-faktur/TukarFakturList.tsx
git commit -m "feat(pembelian): TukarFakturList component (Phase 2b Task 8)"
```

---

## Task 9: `TfQuickAddTagihanModal.tsx` — foreign-faktur escape

**Files:**
- Create: `src/components/pembelian/tukar-faktur/TfQuickAddTagihanModal.tsx`

- [ ] **Step 1: Modal component matching mockup Layar 3**

```tsx
// src/components/pembelian/tukar-faktur/TfQuickAddTagihanModal.tsx
import React, { useState } from 'react';
import { X, Check, Info } from 'lucide-react';
import type { TfQuickAddTagihanDraft } from '../../../types';

interface Props {
  prefillSupplierInvoice?: string;
  defaultPaymentTermDays: number;
  onCancel: () => void;
  onSave: (draft: TfQuickAddTagihanDraft) => void;
}

export default function TfQuickAddTagihanModal({ prefillSupplierInvoice, defaultPaymentTermDays, onCancel, onSave }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date();
  due.setDate(due.getDate() + (defaultPaymentTermDays || 30));
  const [supplierInv, setSupplierInv] = useState(prefillSupplierInvoice ?? '');
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [total, setTotal] = useState('');
  const [dueAt, setDueAt] = useState(due.toISOString().slice(0, 10));

  function handleSave() {
    const totalNum = parseFloat(total.replace(/[^0-9.-]/g, ''));
    if (!supplierInv) return alert('Nomor faktur wajib');
    if (!totalNum || totalNum <= 0) return alert('Nominal wajib > 0');
    onSave({
      supplier_invoice_number: supplierInv,
      purchase_date: purchaseDate,
      total: totalNum,
      payment_due_at: dueAt,
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold" style={{ color:'#012749' }}>Tambah Tagihan Cepat</h3>
            <div className="text-[11px] text-gray-500 mt-0.5">Faktur yang belum ada di sistem. Items barang bisa di-isi nanti.</div>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Nomor Faktur Supplier <span className="text-red-500">*</span></label>
              <input value={supplierInv} onChange={e => setSupplierInv(e.target.value)} className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 block mb-1.5">Tanggal Faktur <span className="text-red-500">*</span></label>
              <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
            </div>
          </div>
          <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-[11px] text-sky-900 flex gap-2">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span><b>Quick-add tanpa Pesanan.</b> Tagihan ini dicatat <code className="text-[10px] bg-white px-1 rounded">is_tf_quick_add=true</code>, no stock_lots. Hapus TF = hapus juga Tagihan ini.</span>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Nominal Total <span className="text-red-500">*</span></label>
            <input value={total} onChange={e => setTotal(e.target.value)} className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300 font-bold text-right" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1.5">Jatuh Tempo</label>
            <input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} className="w-full text-sm py-2 px-3 rounded-xl border border-gray-300" />
            <div className="text-[11px] text-gray-500 mt-1">Auto-fill Net {defaultPaymentTermDays} dari supplier.</div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between bg-gray-50/80 rounded-b-3xl">
          <div className="text-[11px] text-gray-500">Tagihan baru langsung ter-add ke bundle TF.</div>
          <div className="flex gap-2">
            <button onClick={onCancel} className="text-sm font-semibold text-gray-600 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">Batal</button>
            <button onClick={handleSave} className="inline-flex items-center gap-1 text-sm font-semibold text-white px-4 py-2 rounded-lg" style={{ background:'#012749' }}>
              <Check className="w-4 h-4" /> Simpan & Add ke TF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tsc + commit**

```bash
git add src/components/pembelian/tukar-faktur/TfQuickAddTagihanModal.tsx
git commit -m "feat(pembelian): TfQuickAddTagihanModal foreign-faktur escape (Phase 2b Task 9)"
```

---

## Task 10: `TukarFakturFormPage.tsx` — search-and-add core

**Files:**
- Create: `src/components/pembelian/tukar-faktur/TukarFakturFormPage.tsx`

- [ ] **Step 1: Page with supplier picker + search-and-add + ringkasan**

Component logic:
1. State: `supplier`, `tukarDate`, `paymentDueAt`, `notes`, `photoUrls`, `selected: Array<{id, pi_number, supplier_invoice_number, purchase_date, payment_due_at, total, isQuickAdd}>`, `searchQuery`, `searchMatches`
2. On supplier change → auto-fill `paymentDueAt = today + supplier.payment_term_days`
3. Search effect (200ms debounce): query `tukarFakturService.fetchOutstandingTagihansForTf(supplier.id, selected.map(s=>s.id))` filter by `searchQuery.toLowerCase()` matching `pi_number` OR `supplier_invoice_number`
4. Dropdown shows matches + "Tidak ada? Buat Tagihan baru" → opens `TfQuickAddTagihanModal` with `prefillSupplierInvoice=searchQuery`
5. Add to selected on click. Remove via × button in selected table
6. Ringkasan: 2-tile JT + Total
7. On Save: `tukarFakturService.record({ supplier_id, tukar_date, payment_due_at, tagihan_ids: selected.filter(s=>!s.isQuickAdd).map(s=>s.id), quick_add_tagihans: selected.filter(s=>s.isQuickAdd).map(({...}) => ({...})), notes, photo_urls })`

Reference mockup Layar 1 + 2 for visual structure; PesananFormPage for code patterns.

Full code provided in spec section §8.1 — adapt to the form structure shown in mockup.

- [ ] **Step 2: Run tsc + commit**

```bash
git add src/components/pembelian/tukar-faktur/TukarFakturFormPage.tsx
git commit -m "feat(pembelian): TukarFakturFormPage search-and-add (Phase 2b Task 10)"
```

---

## Task 11: `TukarFakturDetailPage.tsx`

**Files:**
- Create: `src/components/pembelian/tukar-faktur/TukarFakturDetailPage.tsx`

- [ ] **Step 1: Detail page matching mockup Layar 5**

Sections (per mockup):
- Breadcrumb + page header with status badge
- Actions: Cetak Tanda Terima · Edit Header · Hapus · Bayar Tukar Faktur
- 3 header cards: Supplier · JT Countdown · Total/Pembayaran
- Daftar Faktur table (with JT asli strikethrough rule)
- Lampiran + Riwayat (2-col grid)
- Tanda Terima preview (`<details>` collapsible)

Bayar TF button: `navigate('?screen=pembelian&pembayaran=new&prefill_tf=' + tf.id)` — TF Pembayaran form prefills 1 junction row.

Hapus button: confirm modal → `tukarFakturService.delete(tf.id, reason)` → navigate back to list.

Cetak Tanda Terima: invoke `TandaTerimaPdf.generate(tf)` (Task 12).

- [ ] **Step 2: Run tsc + commit**

```bash
git add src/components/pembelian/tukar-faktur/TukarFakturDetailPage.tsx
git commit -m "feat(pembelian): TukarFakturDetailPage (Phase 2b Task 11)"
```

---

## Task 12: `TandaTerimaPdf.ts` — jsPDF generator

**Files:**
- Create: `src/lib/tandaTerimaPdf.ts`

- [ ] **Step 1: jsPDF A5 generator**

```typescript
// src/lib/tandaTerimaPdf.ts
// Client-side Tanda Terima PDF generation, A5 thermal-printer friendly.
// Pattern matches existing BNL Print + Pesanan/Tagihan Print (Phase 1/2a).
import jsPDF from 'jspdf';
import type { DbTukarFaktur } from '../types';
import { tukarFakturService } from './tukarFakturService';

const COMPANY_NAME = 'Garindo Jaya Panel';  // TODO: Phase 3 multi-tenant -> read from store_settings

export function generateTandaTerima(tf: DbTukarFaktur): Blob {
  const doc = new jsPDF({ format: 'a5', unit: 'mm', orientation: 'portrait' });
  let y = 14;
  doc.setFontSize(11).setFont('courier', 'bold');
  doc.text('TANDA TERIMA TUKAR FAKTUR', 74, y, { align: 'center' });
  y += 5;
  doc.setFontSize(9);
  doc.text(tf.tf_number, 74, y, { align: 'center' });
  y += 4;
  doc.setLineDashPattern([1, 1], 0).line(8, y, 140, y, 'S');
  y += 4;
  doc.setFontSize(8).setFont('courier', 'normal');

  const rows = [
    ['Tanggal', new Date(tf.tukar_date).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric'})],
    ['Supplier', tf.supplier?.name ?? '—'],
    ['Penerima', COMPANY_NAME],
    ['JT Bayar', new Date(tf.payment_due_at).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric'})],
  ];
  rows.forEach(([k, v]) => {
    doc.text(k + ':', 8, y);
    doc.text(v, 140, y, { align: 'right' });
    y += 4;
  });
  y += 2;
  doc.setLineDashPattern([1, 1], 0).line(8, y, 140, y, 'S');
  y += 4;
  doc.setFont('courier', 'bold').text('DAFTAR FAKTUR:', 8, y);
  y += 4;
  doc.setFont('courier', 'normal');
  (tf.tagihans ?? []).forEach((t, idx) => {
    doc.text(`${idx + 1}. ${t.supplier_invoice_number ?? t.pi_number}`, 8, y);
    doc.text('Rp ' + Math.round(t.total).toLocaleString('id-ID'), 140, y, { align: 'right' });
    y += 4;
  });
  y += 1;
  doc.setLineDashPattern([], 0).line(8, y, 140, y, 'S');
  y += 4;
  doc.setFont('courier', 'bold');
  doc.text('TOTAL', 8, y);
  doc.text('Rp ' + Math.round(tf.total_amount).toLocaleString('id-ID'), 140, y, { align: 'right' });
  y += 16;

  // Signature blocks
  doc.setFont('courier', 'normal').setFontSize(7);
  doc.line(20, y, 60, y, 'S');
  doc.line(80, y, 120, y, 'S');
  y += 3;
  doc.text('Penerima', 40, y, { align: 'center' });
  doc.text('Penyerah', 100, y, { align: 'center' });
  y += 6;
  doc.setFontSize(6).setFont('courier', 'italic');
  doc.text(`Dicetak otomatis · ${COMPANY_NAME} · ${new Date().toLocaleString('id-ID')}`, 74, y, { align: 'center' });

  return doc.output('blob');
}

export async function printTandaTerima(tf: DbTukarFaktur) {
  const blob = generateTandaTerima(tf);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Mark printed timestamp (audit)
  await tukarFakturService.markPrinted(tf.id).catch(() => {/* non-fatal */});
}
```

- [ ] **Step 2: Verify jspdf already in deps**

```bash
grep "jspdf" package.json
```

- [ ] **Step 3: Run tsc + commit**

```bash
git add src/lib/tandaTerimaPdf.ts
git commit -m "feat(pembelian): TandaTerimaPdf jsPDF A5 generator (Phase 2b Task 12)"
```

---

## Task 13: PembelianScreen — add `tukar-faktur` sub-tab, reorder BNL

**Files:**
- Modify: `src/components/PembelianScreen.tsx`

- [ ] **Step 1: Update tab type + import + render switch**

Find existing tab enum (something like `PembelianSubTab = 'beranda'|'pesanan'|'tagihan'|'bnl'|'pembayaran'|'supplier'`).

Add `'tukar-faktur'`. Reorder tab buttons array to:
```ts
['beranda', 'pesanan', 'tagihan', 'tukar-faktur', 'pembayaran', 'bnl', 'supplier']
```

Import + render TukarFakturList / Form / Detail pages based on sub-tab + URL params.

Add 1-time toast on first render if `localStorage.getItem('pembelian_tab_reorder_shown') !== 'true'`:
```ts
showToast('Tab Pembelian sudah re-arrange. BNL sekarang di kanan Pembayaran.', 'info');
localStorage.setItem('pembelian_tab_reorder_shown', 'true');
```

- [ ] **Step 2: Run tsc + smoke locally + commit**

```bash
git add src/components/PembelianScreen.tsx
git commit -m "feat(pembelian): add tukar-faktur sub-tab + reorder BNL (Phase 2b Task 13)"
```

---

## Task 14: App.tsx — `?tf=` deep-link routing

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Extend route handler**

Pattern matches existing `?pesanan=`, `?tagihan=`, `?pembayaran=` handlers. Add:
```ts
const tfQuery = params.get('tf');
// If tf=new → render Form
// If tf=TF-... → render Detail
// Also handle ?prefill_tagihan= for secondary entry
```

Pass to PembelianScreen via props, similar to existing `initialDetailPoNumber` etc.

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat(pembelian): App.tsx ?tf= deep-link routing (Phase 2b Task 14)"
```

---

## Task 15: TagihanDetailPage — "Tambah ke TF" secondary entry

**Files:**
- Modify: `src/components/pembelian/tagihan/TagihanDetailPage.tsx`

- [ ] **Step 1: Add button + visibility logic**

In actions header, after existing Bayar/Edit/Void buttons, add:
```tsx
{tagihan.status === 'BELUM_LUNAS' && !tagihan.tukar_faktur_id && (
  <button onClick={() => navigate(`?screen=pembelian&tf=new&prefill_tagihan=${tagihan.id}`)}
    className="inline-flex items-center gap-1 text-sm font-semibold text-amber-700 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100">
    <Layers className="w-4 h-4" /> Tambah ke Tukar Faktur
  </button>
)}
{tagihan.tukar_faktur_id && (
  <a href={`?screen=pembelian&tf=${tagihan.tukar_faktur?.tf_number}`}
    className="text-xs font-semibold text-indigo-700 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200">
    Bagian dari {tagihan.tukar_faktur?.tf_number}
  </a>
)}
```

Need to extend Tagihan fetch to JOIN `tukar_faktur` for the badge — single LEFT JOIN.

- [ ] **Step 2: Commit**

```bash
git add src/components/pembelian/tagihan/TagihanDetailPage.tsx
git commit -m "feat(pembelian): Tagihan Detail Tambah ke TF secondary entry (Phase 2b Task 15)"
```

---

## Task 16: PembayaranFormPage — support `?prefill_tf=` + TF row in suggest_outstanding

**Files:**
- Modify: `src/components/pembelian/pembayaran/PembayaranFormPage.tsx`

- [ ] **Step 1: Update form to render TF rows alongside Tagihan rows**

`pembayaran_suggest_outstanding` now returns `{tagihan: [...], tukar_faktur: [...]}`. Form's outstanding table should:
- Show both lists
- Use TF row's `payment_due_at` (override) for sorting
- Operator can mix-check Tagihan + TF in same Pembayaran
- On submit, `pembayaran_items` populated with `tagihan_id` for Tagihan rows and `tukar_faktur_id` for TF rows (XOR per row)

`?prefill_tf=<id>` URL param: pre-check that TF row + scroll to it.

- [ ] **Step 2: Commit**

```bash
git add src/components/pembelian/pembayaran/PembayaranFormPage.tsx
git commit -m "feat(pembelian): Pembayaran form supports TF rows + ?prefill_tf= (Phase 2b Task 16)"
```

---

## Task 17: Integration tests — `tests/integration/phase2b-tf-rpcs.test.ts`

**Files:**
- Create: `tests/integration/phase2b-tf-rpcs.test.ts`

- [ ] **Step 1: Write happy + edge cases**

Per spec §12.1 list:
- record_tukar_faktur with 2 Tagihans → TF created, both linked, total = sum
- mixed supplier → throws same_supplier_violation
- already-bundled → throws tagihan_already_bundled
- quick_add → creates is_tf_quick_add Tagihan
- delete unpaid → unlinks normals, cascade-soft-deletes quick_add
- delete partially-paid → throws cannot_delete_paid_tf
- record_pembayaran on TF → trigger updates tf.paid_amount
- Mixed Pembayaran (Tagihan + TF same supplier) → both succeed via junction

- [ ] **Step 2: Run + commit**

```bash
npx vitest run tests/integration/phase2b-tf-rpcs.test.ts
git add tests/integration/phase2b-tf-rpcs.test.ts
git commit -m "test(pembelian): Phase 2b TF RPCs integration tests (Phase 2b Task 17)"
```

---

## Task 18: Production E2E smoke + screenshot

After all code merged + deployed:

- [ ] **Step 1: Manual smoke per spec §12.2 list (10 steps)**

- [ ] **Step 2: Update progress.md + commit**

---

## Final verification

- [ ] All 17 implementation tasks complete + committed
- [ ] `npx tsc --noEmit` clean
- [ ] `npx vitest run` all passing
- [ ] Local dev smoke passes
- [ ] PR opened + approved
- [ ] Merge → Cloud Run deploys → promote traffic
- [ ] Production E2E smoke via Chrome MCP
- [ ] progress.md updated
