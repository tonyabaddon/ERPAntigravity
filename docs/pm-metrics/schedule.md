# PM Metrics Retrospective Schedule

Tracker for post-launch feature metrics. Add entries when shipping a feature
that has a defined success metric with a specific retrospective date. Review at
the top of each week to see what's due.

## Format

- **Feature:** what shipped
- **Ship date:** date PR merged to main
- **Metric:** the numeric signal to measure
- **Retrospective date:** when to compute the metric
- **Threshold:** interpretation guide
- **Query:** ready-to-run SQL or measurement command
- **Status:** `pending` / `computed <date>` / `waived`

---

## Pending

### `used_custom_ratio` — Kasir owner-configurable expense categories

- **Feature:** Owner can add/edit/delete/reorder Kasir expense categories via Pengaturan panel (PR #64, `f2d8778`).
- **Ship date:** 2026-07-28
- **Metric:** `used_custom_ratio` — % of kasir_transactions rows where `expense_category` is NOT one of the 5 default seed labels (Gaji, Utilitas, Transportasi, Marketing, Lain-lain), scoped per tenant.
- **Retrospective date:** **2026-08-25** (Week 4 post-launch)
- **Threshold:**
  - `< 5%` across all tenants → feature underused, reconsider UX or roll back
  - `5-20%` → validated for a subset of tenants; keep, monitor another 4 weeks
  - `> 20%` → strong signal, roll out follow-ups (icon picker, COA mapping, etc.)
- **Query (ready to run):**
  ```sql
  WITH defaults AS (
    SELECT unnest(ARRAY['Gaji','Utilitas','Transportasi','Marketing','Lain-lain','Pembelian Stok','Pembelian Pass-Through','MDR EDC']) AS label
  ),
  per_tenant AS (
    SELECT
      t.id AS tenant_id,
      t.name,
      COUNT(*) FILTER (WHERE k.expense_category NOT IN (SELECT label FROM defaults)) AS custom_count,
      COUNT(*) FILTER (WHERE k.type = 'expense') AS expense_count
    FROM public.tenants t
    LEFT JOIN public.kasir_transactions k ON k.tenant_id = t.id
      AND k.date >= '2026-07-28' AND k.type = 'expense'
    GROUP BY t.id, t.name
  )
  SELECT
    name,
    expense_count,
    custom_count,
    CASE WHEN expense_count = 0 THEN 0
         ELSE ROUND(100.0 * custom_count / expense_count, 1)
    END AS used_custom_pct
  FROM per_tenant
  ORDER BY used_custom_pct DESC;
  ```
- **Status:** pending

---

## Waived / Computed

(Empty — first entry is the one above.)
