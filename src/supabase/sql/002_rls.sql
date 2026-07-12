-- ══════════════════════════════════════════════════════════════════════════════
-- SLOT Engineering ERP — Row Level Security v1.0
-- Migration 002: Lock down all Supabase tables so only authenticated,
--                linked users can access their company's data.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & run
--   Run AFTER 001_schema.sql
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Helper: get the company_id of the currently signed-in user ────────────────
-- SECURITY DEFINER — runs as the table owner, bypassing RLS on app_users itself
-- (which would cause a circular dependency). Safe: read-only, returns one TEXT.
-- auth.uid() is Supabase's built-in function returning the UUID of the signed-in
-- Supabase Auth user. Returns NULL if not signed in.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_my_company_id()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT company_id
  FROM   app_users
  WHERE  auth_user_id = auth.uid()
    AND  status = 'Active'
  LIMIT  1;
$$;

-- ── Helper: check whether the signed-in user holds the admin role ─────────────
CREATE OR REPLACE FUNCTION i_am_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE  auth_user_id = auth.uid()
      AND  role   = 'admin'
      AND  status = 'Active'
  );
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- TABLE: company_data
-- Every ERP module's data is stored here (db, acct_data, settings, activity).
-- Policy: any authenticated user belonging to this company can read & write.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE company_data ENABLE ROW LEVEL SECURITY;

-- Remove old policies (safe to run repeatedly)
DROP POLICY IF EXISTS "Allow all for now"        ON company_data;
DROP POLICY IF EXISTS "company_data: read"       ON company_data;
DROP POLICY IF EXISTS "company_data: write"      ON company_data;
DROP POLICY IF EXISTS "company_data read"        ON company_data;
DROP POLICY IF EXISTS "company_data write"       ON company_data;

-- Signed-in users can only see their own company's row
CREATE POLICY "company_data: read"
  ON company_data FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND id = get_my_company_id()
  );

-- Signed-in users can only write to their own company's row
CREATE POLICY "company_data: write"
  ON company_data FOR ALL
  USING  (auth.uid() IS NOT NULL AND id = get_my_company_id())
  WITH CHECK (auth.uid() IS NOT NULL AND id = get_my_company_id());

-- ════════════════════════════════════════════════════════════════════════════
-- TABLE: app_users
-- The user roster for the SLOT ERP. Readable by all users in the company
-- (needed for names in approval flows, audit log, petty cash, etc.).
-- Only admins can create, update, or delete user records.
-- A user can also update their own row (e.g. phone number, password).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Remove old policies
DROP POLICY IF EXISTS "app_users: read company"          ON app_users;
DROP POLICY IF EXISTS "app_users: admin insert"          ON app_users;
DROP POLICY IF EXISTS "app_users: admin update or self"  ON app_users;
DROP POLICY IF EXISTS "app_users: admin delete"          ON app_users;
DROP POLICY IF EXISTS "app_users read"                   ON app_users;
DROP POLICY IF EXISTS "app_users insert"                 ON app_users;
DROP POLICY IF EXISTS "app_users update"                 ON app_users;
DROP POLICY IF EXISTS "app_users delete"                 ON app_users;

-- Any authenticated user can read all users in their company
CREATE POLICY "app_users: read company"
  ON app_users FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND company_id = get_my_company_id()
  );

-- Only admins can add new users
CREATE POLICY "app_users: admin insert"
  ON app_users FOR INSERT
  WITH CHECK (i_am_admin());

-- Admins can update any user; users can update their own row
CREATE POLICY "app_users: admin update or self"
  ON app_users FOR UPDATE
  USING  (i_am_admin() OR auth_user_id = auth.uid())
  WITH CHECK (i_am_admin() OR auth_user_id = auth.uid());

-- Only admins can delete (prefer deactivation via status = 'Inactive')
CREATE POLICY "app_users: admin delete"
  ON app_users FOR DELETE
  USING (i_am_admin());

-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFY policies are active (run this after migration to confirm):
--
--   SELECT tablename, policyname, cmd, qual
--   FROM   pg_policies
--   WHERE  tablename IN ('company_data', 'app_users')
--   ORDER  BY tablename, policyname;
--
-- Expected output:
--   app_users   | app_users: admin delete          | DELETE
--   app_users   | app_users: admin insert          | INSERT
--   app_users   | app_users: admin update or self  | UPDATE
--   app_users   | app_users: read company          | SELECT
--   company_data| company_data: read               | SELECT
--   company_data| company_data: write              | ALL
-- ══════════════════════════════════════════════════════════════════════════════
