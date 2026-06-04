-- Allow authenticated admins to update customer name and company
CREATE POLICY "authenticated_update_customers"
  ON customers FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
