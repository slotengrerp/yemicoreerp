-- SLOT Engineering — Role/module-scoped READ access for HR + core Finance (016)
-- ══════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER: 015_terminal_fleet_gaps.sql
-- RUN WHERE: Supabase SQL editor, against the LIVE project (fxlejgzazgyudraqlxjv)
--
-- ── Why this exists ────────────────────────────────────────────────────────────
-- 2026-07-30: a "Terminal Supervisor" custom role (modules:['terminal']) could
-- still see the Dashboard, which shows company-wide HR headcount and money
-- in/out. The client-side fix (Dashboard nav + landing page now gated to
-- admin/manager/accountant, see canSeeDashboard() in utils/auth.js) stops the
-- UI from showing this — but the UI is cosmetic. Every table below only ever
-- checked company_id, not role, so any authenticated user at a company could
-- read another module's data straight from Supabase (devtools, a saved
-- personal access token, anything bypassing the app itself). payroll_runs
-- already got this right in an earlier migration; this brings 8 more tables
-- in line with the access rule the UI has always *claimed* to enforce
-- (Sidebar.jsx's isVisible(): admin always, accountant for finance tables,
-- or the record's own module explicitly assigned via app_users.modules).
--
-- Scope, deliberately narrow: only the tables matching Yemi's specific
-- complaint (HR staff + core money in/out) and only where Sidebar.jsx already
-- has a single, unambiguous existing rule to mirror. NOT touched here: fixed
-- assets, budgets, bank reconciliations, credit notes, and the rest of the
-- Sage Reports surface — those have less clear-cut existing rules and are a
-- separate pass if wanted later.
--
-- What changes, per table: the single permissive `<table>_company_isolation`
-- (FOR ALL) policy is replaced with 4 policies — INSERT/UPDATE/DELETE keep
-- the exact same company-only check as before (write behaviour UNCHANGED),
-- and a new SELECT policy adds the role/module check on top of company_id.
-- Postgres OR's multiple permissive policies for the same command together,
-- so leaving the old ALL policy in place while adding a stricter SELECT
-- policy would have done nothing — it has to be replaced, not just added to.
--
-- Idempotent: safe to re-run (DROP POLICY IF EXISTS + CREATE OR REPLACE).
-- ══════════════════════════════════════════════════════════════════════════════


-- ── Part 1 — Reusable helper, same pattern as get_my_company_id()/i_am_admin()
-- (003_per_record_tables.sql / 005_round2_tables.sql) with the search_path
-- pin from the 008 hardening pass. admin always passes; extra_roles lets a
-- table grant a blanket bypass to e.g. accountant; otherwise the caller needs
-- module_key present in their own app_users.modules (jsonb array of strings
-- — the `?` operator below tests "is this string a top-level array element").
CREATE OR REPLACE FUNCTION public.can_read_module(module_key text, extra_roles text[] DEFAULT '{}')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users au
    WHERE au.auth_user_id = auth.uid()
      AND au.status = 'Active'
      AND (
        au.role = 'admin'
        OR au.role = ANY(extra_roles)
        OR au.modules ? module_key
      )
  );
$$;


-- ── Part 2 — Replace each table's blanket ALL policy with write (unchanged)
-- + role/module-scoped read policies.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('nlng_staff',   'nlng',        ARRAY[]::text[]),
      ('slot_staff',   'slot',        ARRAY[]::text[]),
      ('invoices',     'invoices',    ARRAY['accountant']),
      ('ar_receipts',  'invoices',    ARRAY['accountant']),
      ('ap_bills',     'ap',          ARRAY['accountant']),
      ('ap_payments',  'ap',          ARRAY['accountant']),
      ('sales_orders', 'salesorders', ARRAY['accountant']),
      ('pettycash',    'pettycash',   ARRAY['accountant'])
    ) AS x(tbl, module_key, extra_roles)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_company_isolation', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_insert_company_isolation', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_update_company_isolation', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_delete_company_isolation', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_read_scoped', t.tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (company_id = get_my_company_id())',
      t.tbl || '_insert_company_isolation', t.tbl
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (company_id = get_my_company_id()) WITH CHECK (company_id = get_my_company_id())',
      t.tbl || '_update_company_isolation', t.tbl
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE USING (company_id = get_my_company_id())',
      t.tbl || '_delete_company_isolation', t.tbl
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (company_id = get_my_company_id() AND public.can_read_module(%L, %L::text[]))',
      t.tbl || '_read_scoped', t.tbl, t.module_key, t.extra_roles
    );
  END LOOP;
END $$;


-- ── Verify ────────────────────────────────────────────────────────────────────
-- Should return 32 rows (4 policies × 8 tables), none named *_company_isolation.
SELECT tablename, policyname, cmd FROM pg_policies
WHERE tablename IN ('nlng_staff','slot_staff','invoices','ar_receipts','ap_bills','ap_payments','sales_orders','pettycash')
ORDER BY tablename, cmd;

-- Should return 0 rows — the old blanket policies are gone.
SELECT tablename, policyname FROM pg_policies WHERE policyname LIKE '%_company_isolation' AND tablename IN
  ('nlng_staff','slot_staff','invoices','ar_receipts','ap_bills','ap_payments','sales_orders','pettycash');
