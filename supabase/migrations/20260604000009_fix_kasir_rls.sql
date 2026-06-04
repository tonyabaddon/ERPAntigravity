-- Replace anon-open policy with authenticated-only access
DROP POLICY IF EXISTS "anon_all_kasir" ON public.kasir_transactions;

CREATE POLICY "authenticated_kasir_all"
  ON public.kasir_transactions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
