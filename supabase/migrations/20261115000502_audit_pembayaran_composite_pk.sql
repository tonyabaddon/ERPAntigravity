-- P2-03 (2026-07-20): composite PK (tenant_id, id) on audit_log + pembayaran.
-- audit_log has 0 FKs referencing it -> simple DROP + ADD.
-- pembayaran has 1 FK (pembayaran_items_pembayaran_id_fkey) -> must handle:
--   DROP FK -> DROP PK -> ADD composite PK -> RE-ADD composite FK.
-- Composite FK uses pembayaran_items.tenant_id (verified present with 0 mismatches).
--
-- Idempotent via pg_index shape check.

BEGIN;

-- audit_log: simple PK swap
-- Idempotency check uses index KEY ORDER (indkey position), not table attnum.
DO $$
BEGIN
  IF (SELECT array_agg(a.attname::text ORDER BY k.ord)
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE i.indexrelid = 'public.audit_log_pkey'::regclass)
     IS DISTINCT FROM ARRAY['tenant_id','id']::text[]
  THEN
    ALTER TABLE audit_log DROP CONSTRAINT audit_log_pkey;
    ALTER TABLE audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (tenant_id, id);
  END IF;
END $$;

-- pembayaran: FK-drop-first pattern
-- Idempotency check uses index KEY ORDER (indkey position), not table attnum.
DO $$
BEGIN
  IF (SELECT array_agg(a.attname::text ORDER BY k.ord)
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE i.indexrelid = 'public.pembayaran_pkey'::regclass)
     IS DISTINCT FROM ARRAY['tenant_id','id']::text[]
  THEN
    -- Drop dependent FK
    ALTER TABLE pembayaran_items DROP CONSTRAINT IF EXISTS pembayaran_items_pembayaran_id_fkey;

    -- Swap PK
    ALTER TABLE pembayaran DROP CONSTRAINT pembayaran_pkey;
    ALTER TABLE pembayaran ADD CONSTRAINT pembayaran_pkey PRIMARY KEY (tenant_id, id);

    -- Re-add FK as composite (tenant_id column exists on pembayaran_items, verified consistent)
    ALTER TABLE pembayaran_items
      ADD CONSTRAINT pembayaran_items_pembayaran_id_fkey
      FOREIGN KEY (tenant_id, pembayaran_id) REFERENCES pembayaran(tenant_id, id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
