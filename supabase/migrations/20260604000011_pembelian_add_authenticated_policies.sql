-- Add authenticated role access to all pembelian tables.
-- The anon policies (from the initial migration) remain for backward
-- compatibility with the backend daemon and unauthenticated reads.
-- These new policies cover admin users who are logged in via Supabase OTP.

CREATE POLICY "authenticated full access suppliers"
  ON suppliers FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access purchase_orders"
  ON purchase_orders FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access purchase_order_items"
  ON purchase_order_items FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
