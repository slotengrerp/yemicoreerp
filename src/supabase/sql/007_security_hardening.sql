-- SLOT Engineering — Security & Performance Hardening (007)
-- ══════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER: 001-006 (needs app_users, per-record tables, and RLS in place)
-- RUN WHERE: Supabase SQL editor, against the LIVE project (fxlejgzazgyudraqlxjv)
--
-- Closes three items from the 2026-07-23 QA/Security/DBA audit that were left
-- "still outstanding — need action on the live Supabase project, not just a
-- file edit":
--   T2-1  Any authenticated user (incl. cashier/viewer) can read all
--         payroll and GL data — role restrictions were only ever enforced
--         client-side, never in the database.
--   T2-3  (company_id, voided) index missing on 12 of 15 eligible tables —
--         every "active vs voided" list view is doing a fuller scan than
--         it needs to.
--   T3-7  app_users.email has no UNIQUE constraint at the DB level.
--
-- Idempotent: every statement below is safe to re-run. Existing policies are
-- dropped before recreation; indexes use IF NOT EXISTS; the unique index is
-- wrapped so a pre-existing duplicate email gives you a clear error instead
-- of a cryptic one (see Part 3).
-- ══════════════════════════════════════════════════════════════════════════════


-- ── Part 1 — Role-based read/write restriction on payroll + GL ───────────────
-- Scope note (per the audit): this is deliberately NOT applied to every
-- table. vendors/clients/invoices/procurement etc. need to stay broadly
-- readable across roles to support approval workflows — restricting those
-- would break legitimate cashier/viewer use of the app. Payroll and the
-- General Ledger are the two the audit specifically named ("payroll/GL
-- data") as the live exposure, so those are the two this hardens. Extending
-- the same pattern to another table later is a one-block copy-paste of
-- Part 1b below with the table name changed — a business decision on which
-- tables need it, not a technical blocker.

-- 1a. Payroll runs — admin + accountant only.
DROP POLICY IF EXISTS "payroll_runs_company_isolation" ON public.payroll_runs;
DROP POLICY IF EXISTS "payroll_runs_read_privileged"   ON public.payroll_runs;
DROP POLICY IF EXISTS "payroll_runs_write_privileged"  ON public.payroll_runs;

CREATE POLICY "payroll_runs_read_privileged" ON public.payroll_runs FOR SELECT
  USING (
    company_id = public.get_my_company_id()
    AND EXISTS (SELECT 1 FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'Active' AND role IN ('admin','accountant'))
  );

CREATE POLICY "payroll_runs_write_privileged" ON public.payroll_runs FOR ALL
  USING (
    company_id = public.get_my_company_id()
    AND EXISTS (SELECT 1 FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'Active' AND role IN ('admin','accountant'))
  )
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND EXISTS (SELECT 1 FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'Active' AND role IN ('admin','accountant'))
  );

-- 1b. Journal entries (the "GL" half of the same finding) — admin + manager +
-- accountant. Cashier/viewer keep access to their own modules (petty cash,
-- read-only dashboards) but can no longer pull the whole GL via a direct
-- API call.
DROP POLICY IF EXISTS "journal_entries_company_isolation" ON public.journal_entries;
DROP POLICY IF EXISTS "journal_entries_read_privileged"   ON public.journal_entries;
DROP POLICY IF EXISTS "journal_entries_write_privileged"  ON public.journal_entries;

CREATE POLICY "journal_entries_read_privileged" ON public.journal_entries FOR SELECT
  USING (
    company_id = public.get_my_company_id()
    AND EXISTS (SELECT 1 FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'Active' AND role IN ('admin','manager','accountant'))
  );

CREATE POLICY "journal_entries_write_privileged" ON public.journal_entries FOR ALL
  USING (
    company_id = public.get_my_company_id()
    AND EXISTS (SELECT 1 FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'Active' AND role IN ('admin','manager','accountant'))
  )
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND EXISTS (SELECT 1 FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'Active' AND role IN ('admin','manager','accountant'))
  );


-- ── Part 2 — Missing (company_id, voided) partial indexes ────────────────────
-- Partial index on voided = false since that's the dominant filter for every
-- list view in the app (active records, not the voided ones).
CREATE INDEX IF NOT EXISTS idx_ar_receipts_active_updated         ON public.ar_receipts(company_id, updated_at DESC)         WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_ap_bills_active_updated            ON public.ap_bills(company_id, updated_at DESC)            WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_ap_payments_active_updated         ON public.ap_payments(company_id, updated_at DESC)         WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_pettycash_active_updated           ON public.pettycash(company_id, updated_at DESC)           WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_fixedassets_active_updated         ON public.fixedassets(company_id, updated_at DESC)         WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_terminal_charges_active_updated    ON public.terminal_charges(company_id, updated_at DESC)    WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_payroll_runs_active_updated        ON public.payroll_runs(company_id, updated_at DESC)        WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_fleet_repairs_active_updated       ON public.fleet_repairs(company_id, updated_at DESC)       WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_stock_items_active_updated         ON public.stock_items(company_id, updated_at DESC)         WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_stock_movements_active_updated     ON public.stock_movements(company_id, updated_at DESC)     WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_sales_orders_active_updated        ON public.sales_orders(company_id, updated_at DESC)        WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_recurring_templates_active_updated ON public.recurring_templates(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_attachments_active_updated         ON public.attachments(company_id, updated_at DESC)         WHERE voided = false;


-- ── Part 3 — app_users.email UNIQUE constraint ────────────────────────────────
-- Guarded: if a duplicate email slipped in again since the 2026-07-23 cleanup,
-- this raises a clear, actionable notice instead of a bare constraint-
-- violation error, and does NOT delete anything on your behalf — duplicate
-- resolution is a judgment call (which row to keep), same as last time.
DO $$
DECLARE
  dupe_count int;
BEGIN
  SELECT count(*) INTO dupe_count FROM (
    SELECT email FROM public.app_users GROUP BY email HAVING count(*) > 1
  ) d;

  IF dupe_count > 0 THEN
    RAISE NOTICE 'Skipped: % duplicate email(s) still in app_users — resolve which row to keep first (see the 2026-07-23 audit doc for the approach used last time), then re-run this file.', dupe_count;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'app_users_email_unique'
    ) THEN
      CREATE UNIQUE INDEX app_users_email_unique ON public.app_users (email);
      RAISE NOTICE 'app_users_email_unique created.';
    ELSE
      RAISE NOTICE 'app_users_email_unique already exists — skipped.';
    END IF;
  END IF;
END $$;


-- ── Verify ────────────────────────────────────────────────────────────────────
-- Part 1: should show 2 read + 2 write policies (4 rows) for these two tables.
SELECT tablename, policyname FROM pg_policies
WHERE tablename IN ('payroll_runs','journal_entries') ORDER BY tablename, policyname;

-- Part 2: should list all 12 new indexes.
SELECT indexname, tablename FROM pg_indexes
WHERE indexname LIKE 'idx_%_active_updated' ORDER BY tablename;

-- Part 3: should return exactly one row if the constraint is live, zero rows
-- (with a NOTICE above explaining why) if duplicates are still blocking it.
SELECT indexname FROM pg_indexes WHERE indexname = 'app_users_email_unique';
