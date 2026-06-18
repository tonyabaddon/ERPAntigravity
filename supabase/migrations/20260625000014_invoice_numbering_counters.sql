-- Phase 1B PR A — invoice numbering counters.
-- Replaces the ad-hoc per-doc-type counters used in older record_*_sale
-- variants with a single atomic source-of-truth keyed by (doc_type, year).
-- Doc types in scope: SO, INV-DP, INV-PEL, INV-LUNAS, SJ, CANCEL.

CREATE TABLE IF NOT EXISTS invoice_counters (
  doc_type text NOT NULL,
  year smallint NOT NULL,
  counter int NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, year)
);

CREATE OR REPLACE FUNCTION next_invoice_number(p_doc_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year smallint := EXTRACT(YEAR FROM NOW())::smallint;
  v_counter int;
BEGIN
  INSERT INTO invoice_counters(doc_type, year, counter)
  VALUES (p_doc_type, v_year, 1)
  ON CONFLICT (doc_type, year) DO UPDATE SET counter = invoice_counters.counter + 1
  RETURNING counter INTO v_counter;
  RETURN p_doc_type || '/' || v_year || '/' || LPAD(v_counter::text, 5, '0');
END;
$$;

REVOKE ALL ON FUNCTION next_invoice_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_invoice_number(text) TO authenticated;

COMMENT ON FUNCTION next_invoice_number IS 'Atomically increment per-type per-year counter. Returns formatted number like SO/2026/00001.';
