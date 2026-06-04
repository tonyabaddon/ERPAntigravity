-- Fix admin_users RLS: replace insecure anon full-access with proper authenticated policies
-- Root cause: anon policy blocked authenticated-role requests (sign-up upsert and sign-in lookup)

DROP POLICY IF EXISTS "anon full access admin_users" ON admin_users;

-- Any authenticated user can read (needed for email lookup during sign-in)
CREATE POLICY "authenticated select admin_users"
  ON admin_users FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated user can insert their own Owner row (sign-up), OR an Owner/userManagement admin can add others
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

-- Same logic for UPDATE
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

-- Only Owner/userManagement admin can delete
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
