-- P2-03 regression: verify composite PK enforced + FK survives.
-- Reads index KEY ORDER (unnest indkey WITH ORDINALITY), not table attnum,
-- so it correctly reports (tenant_id, id) regardless of how columns were added
-- to the table.

DO $t$
DECLARE
  v_audit_pk text; v_pembayaran_pk text; v_fk_def text;
BEGIN
  SELECT string_agg(a.attname::text, ',' ORDER BY k.ord) INTO v_audit_pk
  FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indexrelid = 'public.audit_log_pkey'::regclass;
  IF v_audit_pk = 'tenant_id,id' THEN
    RAISE NOTICE 'PASS: audit_log PK is (tenant_id, id)';
  ELSE
    RAISE NOTICE 'FAIL: audit_log PK is (%)', v_audit_pk;
  END IF;

  SELECT string_agg(a.attname::text, ',' ORDER BY k.ord) INTO v_pembayaran_pk
  FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indexrelid = 'public.pembayaran_pkey'::regclass;
  IF v_pembayaran_pk = 'tenant_id,id' THEN
    RAISE NOTICE 'PASS: pembayaran PK is (tenant_id, id)';
  ELSE
    RAISE NOTICE 'FAIL: pembayaran PK is (%)', v_pembayaran_pk;
  END IF;

  -- Verify FK survived + is composite
  SELECT pg_get_constraintdef(oid) INTO v_fk_def
  FROM pg_constraint WHERE conname = 'pembayaran_items_pembayaran_id_fkey';
  IF v_fk_def ILIKE '%tenant_id%' THEN
    RAISE NOTICE 'PASS: pembayaran_items FK is composite';
  ELSE
    RAISE NOTICE 'FAIL: pembayaran_items FK definition = %', v_fk_def;
  END IF;
END $t$;
