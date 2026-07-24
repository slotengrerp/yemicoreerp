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
ALTER TABLE company_data FORCE  ROW LEVEL SECURITY;

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

-- Signed-in users can only write to their own company's row.
-- NOTE: this is FOR ALL because company_data has both INSERT and UPDATE
-- semantics (the legacy sync engine upserts the whole row). The per-record
-- engine (migration 003) writes to separate per-record tables instead.
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
--
-- PRIVILEGE ESCALATION GUARD: the WITH CHECK on the self-update path
-- verifies the row's auth_user_id matches the caller — but that alone
-- is NOT enough. Without a BEFORE UPDATE trigger, a non-admin user could
-- change their own `role`, `company_id`, or `status` columns because the
-- same policy applies to ALL columns. The trigger below rejects those
-- column changes when the caller isn't an admin. This is the single most
-- important security control in the database.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users FORCE  ROW LEVEL SECURITY;

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

-- Only admins can add new users — AND the new row's company_id must match
-- the admin's own company. Without this check, an admin from company A
-- could insert a backdoor account with company_id='company-B' that would
-- then be visible to every user in company B.
CREATE POLICY "app_users: admin insert"
  ON app_users FOR INSERT
  WITH CHECK (i_am_admin() AND company_id = get_my_company_id());

-- Admins can update any user; users can update their own row.
-- The BEFORE UPDATE trigger below enforces that non-admins cannot change
-- role, company_id, or status columns — preventing self-escalation.
CREATE POLICY "app_users: admin update or self"
  ON app_users FOR UPDATE
  USING  (i_am_admin() OR auth_user_id = auth.uid())
  WITH CHECK (i_am_admin() OR auth_user_id = auth.uid());

-- Only admins can delete (prefer deactivation via status = 'Inactive')
CREATE POLICY "app_users: admin delete"
  ON app_users FOR DELETE
  USING (i_am_admin());

-- ── Privilege-escalation guard trigger ───────────────────────────────────────
-- Without this, the self-update policy allows a non-admin to UPDATE their
-- own role/company_id/status columns (because the policy only checks the
-- row's auth_user_id matches the caller — it does NOT restrict which
-- columns may be changed). This trigger fires BEFORE UPDATE and rejects
-- sensitive column changes when the caller isn't an admin. With this in
-- place, a cashier promoting themselves to admin via direct Supabase API
-- call gets a Postgres exception instead of a new role.
CREATE OR REPLACE FUNCTION enforce_self_update_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only restrict the self-update path (admin path is allowed to change anything)
  IF NEW.auth_user_id = auth.uid() AND NOT i_am_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Self-update may not change role column (privilege escalation blocked)';
    END IF;
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'Self-update may not change company_id column (cross-tenant blocked)';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Self-update may not change status column (use admin path)';
    END IF;
    IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
      RAISE EXCEPTION 'Self-update may not change auth_user_id column';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_users_self_update_scope ON app_users;
CREATE TRIGGER trg_app_users_self_update_scope
  BEFORE UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION enforce_self_update_scope();

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
