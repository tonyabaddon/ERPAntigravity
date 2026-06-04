-- Fix admin_users RLS on ERP MSME AI Studio project (ekhhojaezdfjfwuxyjkl)
-- Same fix as 20260604000002 applied to the other project.
-- Drops insecure anon full-access + two redundant authenticated ALL policies,
-- replaces with four properly scoped authenticated policies.

DROP POLICY IF EXISTS "anon full access admin_users" ON admin_users;
DROP POLICY IF EXISTS "auth full access admin_users" ON admin_users;
DROP POLICY IF EXISTS "auth_all_admin_users" ON admin_users;

CREATE POLICY "authenticated select admin_users"
  ON admin_users FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated insert admin_users"
  ON admin_users FOR INSERT
  TO authenticated
  WITH CHECK (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.id = auth.uid()
        AND (au.role = 'Owner' OR (au.permissions->>'userManagement')::boolean = true)
    )
  );

CREATE POLICY "authenticated update admin_users"
  ON admin_users FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.id = auth.uid()
        AND (au.role = 'Owner' OR (au.permissions->>'userManagement')::boolean = true)
    )
  )
  WITH CHECK (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.id = auth.uid()
        AND (au.role = 'Owner' OR (au.permissions->>'userManagement')::boolean = true)
    )
  );

CREATE POLICY "authenticated delete admin_users"
  ON admin_users FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.id = auth.uid()
        AND (au.role = 'Owner' OR (au.permissions->>'userManagement')::boolean = true)
    )
  );
