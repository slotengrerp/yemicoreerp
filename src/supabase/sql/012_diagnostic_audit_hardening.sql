-- SLOT Engineering — Diagnostic Audit Hardening (012)
-- ══════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER: 011_terminal_master_data.sql
-- RUN WHERE: Supabase SQL editor, against the LIVE project (fxlejgzazgyudraqlxjv)
--
-- Closes two items from SLOT_Full_Diagnostic_Audit_2026-07-27.md:
--   PERF-1  10 RLS policies across 5 tables call auth.uid() unwrapped, so
--           Postgres re-evaluates it once per row instead of once per query.
--   SEC-4   Nothing stops an admin from demoting/deactivating the LAST active
--           admin for a company, which would lock that company out of user
--           management entirely (no one left with role='admin' to fix it).
--
-- Idempotent: every statement below is safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── Part 1 — PERF-1: wrap auth.uid() in (select ...) ──────────────────────────
-- Pure performance change — every USING/WITH CHECK expression below is
-- logically identical to what's already live (verified against the live
-- pg_policies output before writing this file); only the auth.uid() calls
-- are wrapped so Postgres evaluates them once per query (as a stable
-- sub-select) instead of once per row scanned.

-- app_users
DROP POLICY IF EXISTS "app_users: admin update or self" ON public.app_users;
CREATE POLICY "app_users: admin update or self" ON public.app_users FOR UPDATE
  USING (i_am_admin() OR (auth_user_id = (select auth.uid())))
  WITH CHECK (i_am_admin() OR (auth_user_id = (select auth.uid())));

DROP POLICY IF EXISTS "app_users: read company" ON public.app_users;
CREATE POLICY "app_users: read company" ON public.app_users FOR SELECT
  USING (((select auth.uid()) IS NOT NULL) AND (company_id = get_my_company_id()));

-- company_data
DROP POLICY IF EXISTS "company_data: read" ON public.company_data;
CREATE POLICY "company_data: read" ON public.company_data FOR SELECT
  USING (((select auth.uid()) IS NOT NULL) AND (id = get_my_company_id()));

DROP POLICY IF EXISTS "company_data: write" ON public.company_data;
CREATE POLICY "company_data: write" ON public.company_data FOR ALL
  USING (((select auth.uid()) IS NOT NULL) AND (id = get_my_company_id()))
  WITH CHECK (((select auth.uid()) IS NOT NULL) AND (id = get_my_company_id()));

-- company_records
DROP POLICY IF EXISTS "company_records: read" ON public.company_records;
CREATE POLICY "company_records: read" ON public.company_records FOR SELECT
  USING (((select auth.uid()) IS NOT NULL) AND (company_id = get_my_company_id()));

DROP POLICY IF EXISTS "company_records: write" ON public.company_records;
CREATE POLICY "company_records: write" ON public.company_records FOR ALL
  USING (((select auth.uid()) IS NOT NULL) AND (company_id = get_my_company_id()))
  WITH CHECK (((select auth.uid()) IS NOT NULL) AND (company_id = get_my_company_id()));

-- journal_entries (journal_entries_insert_only is untouched — it never
-- referenced auth.uid() directly, only get_my_company_id())
DROP POLICY IF EXISTS "journal_entries_read_privileged" ON public.journal_entries;
CREATE POLICY "journal_entries_read_privileged" ON public.journal_entries FOR SELECT
  USING (
    company_id = get_my_company_id()
    AND EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = (select auth.uid()) AND status = 'Active' AND role = ANY (ARRAY['admin','manager','accountant']))
  );

DROP POLICY IF EXISTS "journal_entries_write_privileged" ON public.journal_entries;
CREATE POLICY "journal_entries_write_privileged" ON public.journal_entries FOR ALL
  USING (
    company_id = get_my_company_id()
    AND EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = (select auth.uid()) AND status = 'Active' AND role = ANY (ARRAY['admin','manager','accountant']))
  )
  WITH CHECK (
    company_id = get_my_company_id()
    AND EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = (select auth.uid()) AND status = 'Active' AND role = ANY (ARRAY['admin','manager','accountant']))
  );

-- payroll_runs
DROP POLICY IF EXISTS "payroll_runs_read_privileged" ON public.payroll_runs;
CREATE POLICY "payroll_runs_read_privileged" ON public.payroll_runs FOR SELECT
  USING (
    company_id = get_my_company_id()
    AND EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = (select auth.uid()) AND status = 'Active' AND role = ANY (ARRAY['admin','accountant']))
  );

DROP POLICY IF EXISTS "payroll_runs_write_privileged" ON public.payroll_runs;
CREATE POLICY "payroll_runs_write_privileged" ON public.payroll_runs FOR ALL
  USING (
    company_id = get_my_company_id()
    AND EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = (select auth.uid()) AND status = 'Active' AND role = ANY (ARRAY['admin','accountant']))
  )
  WITH CHECK (
    company_id = get_my_company_id()
    AND EXISTS (SELECT 1 FROM app_users WHERE auth_user_id = (select auth.uid()) AND status = 'Active' AND role = ANY (ARRAY['admin','accountant']))
  );


-- ── Part 2 — SEC-4: last-active-admin lockout guard ───────────────────────────
-- Fires only on UPDATE that touches role/status, or on DELETE — never on
-- INSERT (so creating a company's first admin is always unaffected), and
-- only actually does anything when the row being changed is CURRENTLY an
-- active admin. Mirrors the SECURITY DEFINER + pinned search_path pattern
-- already used by validate_user_role() (009_flexible_user_roles.sql).
CREATE OR REPLACE FUNCTION public.prevent_last_admin_lockout()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  other_active_admins int;
BEGIN
  IF OLD.role = 'admin' AND OLD.status = 'Active' THEN
    -- UPDATE that keeps the row an active admin (e.g. editing name/phone/
    -- modules) — nothing to check, let it through immediately.
    IF TG_OP = 'UPDATE' AND NEW.role = 'admin' AND NEW.status = 'Active' THEN
      RETURN NEW;
    END IF;

    SELECT count(*) INTO other_active_admins
    FROM public.app_users
    WHERE company_id = OLD.company_id
      AND role = 'admin'
      AND status = 'Active'
      AND id <> OLD.id;

    IF other_active_admins = 0 THEN
      RAISE EXCEPTION 'Cannot remove or demote the last active admin for this company — promote another user to admin first, then try again.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_users_prevent_last_admin_lockout ON public.app_users;
CREATE TRIGGER trg_app_users_prevent_last_admin_lockout
  BEFORE UPDATE OF role, status OR DELETE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_admin_lockout();


-- ── Verify ────────────────────────────────────────────────────────────────────
-- Part 1: none of these 10 policy definitions should contain a bare
-- "auth.uid()" — every occurrence should now read "(SELECT auth.uid())".
SELECT tablename, policyname, qual, with_check FROM pg_policies
WHERE tablename IN ('app_users','company_data','company_records','journal_entries','payroll_runs')
ORDER BY tablename, policyname;

-- Part 2: should return exactly 1 row.
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.app_users'::regclass AND tgname = 'trg_app_users_prevent_last_admin_lockout';

-- Sanity check the trigger logic itself, without touching real data:
-- (run manually, expect the first UPDATE to raise if that user is the
-- company's only active admin, then roll back either way)
--   BEGIN;
--     UPDATE app_users SET status = 'Inactive' WHERE role = 'admin' AND status = 'Active' LIMIT 1;
--   ROLLBACK;
