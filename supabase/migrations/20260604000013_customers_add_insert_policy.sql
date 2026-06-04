CREATE POLICY "authenticated_insert_customers"
  ON public.customers
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
