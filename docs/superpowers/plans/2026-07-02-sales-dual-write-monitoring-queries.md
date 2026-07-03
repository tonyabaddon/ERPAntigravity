# Sales-Side Dual-Write — Monitoring Queries

Saved from 2026-07-02 implementation (Slice E backfill). Run daily for first week post-deploy.

---

## 1. Anomaly rate per RPC per day

```sql
SELECT date_trunc('day', created_at) AS d, source_rpc, count(*)
FROM public.gl_dual_write_anomalies
WHERE created_at > now() - interval '7 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;
```

Investigate any RPC with ≥ 5 anomalies/day.

---

## 2. JE-to-source ratio — tempo orders (target 1:1 post-backfill)

```sql
SELECT
  count(DISTINCT o.id)                AS total_tempo_orders,
  count(DISTINCT e.source_ref_id)     AS orders_with_je
FROM public.orders o
LEFT JOIN public.journal_entries e
  ON  e.source_ref_table = 'orders'
  AND e.source_ref_id    = o.id
  AND e.source_type IN ('TEMPO_INVOICE_CREATE', 'BACKFILL_TEMPO_INVOICE')
WHERE o.payment_type = 'TEMPO'
  AND o.created_at >= '2026-06-01';
```

Investigate if `total_tempo_orders != orders_with_je`.

---

## 3. JE-to-source ratio — PASSTHROUGH PIs (target 1:1 post-backfill)

```sql
SELECT
  count(DISTINCT pi.id)               AS total_passthrough_pi,
  count(DISTINCT e.source_ref_id)     AS pi_with_je
FROM public.purchase_invoices pi
LEFT JOIN public.journal_entries e
  ON  e.source_ref_table = 'purchase_invoices'
  AND e.source_ref_id    = pi.id
  AND e.source_type IN ('PI_TAGIHAN', 'BACKFILL_PI_PASSTHROUGH')
WHERE pi.type = 'PASSTHROUGH'
  AND pi.purchase_date >= '2026-06-01';
```

---

## 4. JE-to-source ratio — LUNAS PIs (payment leg coverage)

```sql
SELECT
  count(DISTINCT pmt.id)              AS total_pembayaran,
  count(DISTINCT e.source_ref_id)     AS pmt_with_je
FROM public.pembayaran pmt
LEFT JOIN public.journal_entries e
  ON  e.source_ref_table = 'pembayaran'
  AND e.source_ref_id    = pmt.id
  AND e.source_type IN ('PEMBAYARAN', 'BACKFILL_PEMBAYARAN')
WHERE pmt.status != 'VOIDED'
  AND pmt.paid_at::date >= '2026-06-01';
```

---

## 5. Per-source balance check (must be zero rows)

```sql
SELECT e.id, e.source_type, e.total_debit, e.total_credit
FROM public.journal_entries e
WHERE e.total_debit <> e.total_credit;
```

Expected: 0 rows.

---

## 6. Backfill-specific unbalanced entries

```sql
SELECT e.id, e.source_type, e.total_debit, e.total_credit
FROM public.journal_entries e
WHERE e.source_type LIKE 'BACKFILL_%'
  AND e.total_debit <> e.total_credit;
```

Expected: 0 rows.

---

## 7. Recent JE breakdown by source_type (last 24h)

```sql
SELECT source_type, count(*), min(posted_at), max(posted_at)
FROM public.journal_entries
WHERE posted_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY 2 DESC;
```

Look for missing types (e.g., zero `TEMPO_INVOICE_CREATE` despite tempo sales happening).

---

## 8. Tempo write-off coverage

```sql
SELECT count(*) AS missing_writeoff_je
FROM public.orders o
WHERE o.status = 'INVOICE_WRITTEN_OFF'
  AND o.written_off_at IS NOT NULL
  AND o.written_off_at >= '2026-06-01'
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries e
    WHERE e.source_ref_table = 'orders'
      AND e.source_ref_id    = o.id
      AND e.source_type IN ('TEMPO_WRITEOFF', 'BACKFILL_TEMPO_WRITEOFF')
  );
```

Expected: 0.

---

## 9. Backfill preview table summary (post dry-run inspection)

```sql
SELECT
  source_fn,
  count(*)                AS rows_planned,
  min(planned_date)       AS earliest_date,
  max(planned_date)       AS latest_date,
  count(DISTINCT reason)  AS distinct_reasons
FROM public._backfill_preview_je
GROUP BY 1
ORDER BY 1;
```

Run after dry-run step to confirm coverage before real run.

---

## 10. Spot-check a preview row's JE lines (pre-real-run review)

```sql
SELECT
  source_fn,
  source_row_id,
  planned_date,
  jsonb_pretty(planned_lines) AS lines_pretty,
  reason
FROM public._backfill_preview_je
ORDER BY created_at DESC
LIMIT 10;
```

Eye-check math: debits and credits in each `planned_lines` must balance.

---

## Rollback query (emergency cleanup)

```sql
-- Delete all backfill JEs (safe: BACKFILL_* source types are exclusive to this migration)
-- WARNING: Run only with explicit founder approval.
DELETE FROM public.journal_entries
WHERE source_type LIKE 'BACKFILL_%';
```

See design spec §6.3 for rollback notes and caveats on PI_TAGIHAN entries.
