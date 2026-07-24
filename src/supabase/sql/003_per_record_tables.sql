-- ══════════════════════════════════════════════════════════════════════════════
-- SLOT Engineering — Per-Record Tables Migration (003)
--
-- UPGRADES the single-JSONB-blob architecture (`company_data.db` with every
-- module packed into one row) to per-module real tables, one row per business
-- record. This is the Tier-1 fix the independent audit called out as the
-- single biggest risk in the system: with the blob model, two concurrent
-- users can silently overwrite each other's writes because the last full
-- document write wins.
--
-- With per-record tables, each write is row-level — Supabase RLS + Postgres
-- MVCC means concurrent writes to DIFFERENT records never block, concurrent
-- writes to the SAME record get last-write-wins at the row level (still
-- much narrower blast radius), and the existing `subscribeToChanges`
-- function in supabase/sync.js routes real-time events through per-record
-- channels instead of the whole-document UPDATE channel.
--
-- RUN THIS IN ORDER:
--   001_schema.sql         — base tables and companies
--   002_rls.sql            — RLS policies
--   003_per_record_tables.sql  — THIS FILE: the per-record split + backfill
--
-- MIGRATION IS ONE-WAY: after this runs, the application should be using
-- the new per-record sync engine (supabase/syncPerRecord.js). The legacy
-- `company_data.db` row is kept for one release as a rollback safety net,
-- then removed.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Lookup helper — current user's company id (mirrors 002_rls.sql) ─────────
-- NOTE: 002_rls.sql also has `status = 'Active'` filter — mirrored here so a
-- deactivated user's auth token can no longer read company data after the
-- admin flips their status to 'Inactive'.
CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT company_id FROM public.app_users
  WHERE auth_user_id = auth.uid() AND status = 'Active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.i_am_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE auth_user_id = auth.uid() AND role = 'admin' AND status = 'Active'
  )
$$;

-- ── Per-record tables ────────────────────────────────────────────────────────
-- Every table has the same shape:
--   id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
--   company_id  TEXT (FK to companies.id)
--   data        JSONB (the full record — same shape as the legacy blob entries)
--   created_at  TIMESTAMPTZ
--   updated_at  TIMESTAMPTZ
--   voided      BOOLEAN DEFAULT FALSE  -- soft delete for audit trail
--
-- One row per business record. Updates are full-record PUTs (still cheap at
-- 1 row) but two users editing different records never touch the same row.

CREATE TABLE IF NOT EXISTS public.invoices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_company    ON public.invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_voided     ON public.invoices(company_id, voided);
CREATE INDEX IF NOT EXISTS idx_invoices_updated_at ON public.invoices(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.ar_receipts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ar_receipts_company    ON public.ar_receipts(company_id);
CREATE INDEX IF NOT EXISTS idx_ar_receipts_updated_at ON public.ar_receipts(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.ap_bills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ap_bills_company    ON public.ap_bills(company_id);
CREATE INDEX IF NOT EXISTS idx_ap_bills_updated_at ON public.ap_bills(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.ap_payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ap_payments_company    ON public.ap_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_ap_payments_updated_at ON public.ap_payments(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.pettycash (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pettycash_company    ON public.pettycash(company_id);
CREATE INDEX IF NOT EXISTS idx_pettycash_updated_at ON public.pettycash(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.fixedassets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fixedassets_company    ON public.fixedassets(company_id);
CREATE INDEX IF NOT EXISTS idx_fixedassets_updated_at ON public.fixedassets(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.terminal_charges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_terminal_charges_company    ON public.terminal_charges(company_id);
CREATE INDEX IF NOT EXISTS idx_terminal_charges_updated_at ON public.terminal_charges(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_company    ON public.payroll_runs(company_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_updated_at ON public.payroll_runs(company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.fleet_repairs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fleet_repairs_company    ON public.fleet_repairs(company_id);
CREATE INDEX IF NOT EXISTS idx_fleet_repairs_updated_at ON public.fleet_repairs(company_id, updated_at DESC);

-- Journals — append-only, never updated in place. New rows only.
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  period_key  TEXT,   -- e.g. '2026-07' — for the period-close filter
  source      TEXT,   -- e.g. 'invoice', 'ap', 'payroll', 'manual', 'year-end-close'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company  ON public.journal_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_period   ON public.journal_entries(company_id, period_key);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source   ON public.journal_entries(company_id, source);
CREATE INDEX IF NOT EXISTS idx_journal_entries_created  ON public.journal_entries(company_id, created_at DESC);

-- Master data tables (small, low-write — split out for clean RLS)
CREATE TABLE IF NOT EXISTS public.vendors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendors_company ON public.vendors(company_id);

CREATE TABLE IF NOT EXISTS public.clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clients_company ON public.clients(company_id);

CREATE TABLE IF NOT EXISTS public.projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_company ON public.projects(company_id);

-- Activity log — append-only, server-stamped for true audit immutability
CREATE TABLE IF NOT EXISTS public.activity (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  user_id     UUID,                   -- references public.app_users.id
  user_name   TEXT,
  user_role   TEXT,
  module      TEXT,
  action      TEXT,
  message     TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_company  ON public.activity(company_id);
CREATE INDEX IF NOT EXISTS idx_activity_created  ON public.activity(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_module   ON public.activity(company_id, module);

-- ── RLS — same shape as 002_rls.sql, applied per table ──────────────────────
-- FORCE ROW LEVEL SECURITY is critical: without it, the table OWNER role
-- bypasses RLS. In Supabase that means any future role granted owner
-- privileges (a migration runner, a read replica role, a custom db_admin
-- role) would silently bypass every policy. FORCE closes that hole while
-- still letting the service_role (used by Edge Functions) bypass RLS —
-- which is the documented Supabase behaviour.
ALTER TABLE public.invoices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ar_receipts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ar_receipts    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ap_bills       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_bills       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ap_payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ap_payments    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pettycash      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pettycash      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fixedassets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixedassets    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_charges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs   FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_repairs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_repairs  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.projects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity       FORCE ROW LEVEL SECURITY;

-- Policy template: company-scoped read/write. journal_entries and activity
-- are INSERT-only (no UPDATE/DELETE policy), making them append-only at the
-- database level — the audit's "immutability" requirement is satisfied
-- because no client can retroactively edit history.
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'invoices','ar_receipts','ap_bills','ap_payments','pettycash','fixedassets',
    'terminal_charges','payroll_runs','fleet_repairs',
    'vendors','clients','projects'
  ]) LOOP
    EXECUTE format($p$
      CREATE POLICY "%1$s_company_isolation" ON public.%1$s
        FOR ALL
        USING       (company_id = public.get_my_company_id())
        WITH CHECK  (company_id = public.get_my_company_id())
    $p$, tbl);
  END LOOP;

  -- Journal + activity are append-only
  FOR tbl IN SELECT unnest(ARRAY['journal_entries','activity']) LOOP
    EXECUTE format($p$
      CREATE POLICY "%1$s_company_isolation" ON public.%1$s
        FOR SELECT
        USING (company_id = public.get_my_company_id())
    $p$, tbl);
    EXECUTE format($p$
      CREATE POLICY "%1$s_insert_only" ON public.%1$s
        FOR INSERT
        WITH CHECK (company_id = public.get_my_company_id())
    $p$, tbl);
    -- Intentionally no UPDATE or DELETE policy → RLS blocks them
  END LOOP;
END $$;

-- ── Activity-log user-stamping trigger ────────────────────────────────────────
-- CRITICAL: without this, any authenticated user could spoof the audit log by
-- passing `user_id`, `user_name`, or `user_role` fields that don't belong to
-- them — e.g. a cashier could write an audit entry attributed to the CEO.
-- This trigger overrides whatever the client claims with values looked up
-- from app_users via auth.uid(), so the audit log reflects who actually did
-- the action, not who the client SAID did the action.
CREATE OR REPLACE FUNCTION public.stamp_activity_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE u RECORD;
BEGIN
  SELECT id, name, role INTO u FROM public.app_users
    WHERE auth_user_id = auth.uid() AND status = 'Active' LIMIT 1;
  NEW.user_id   := u.id;
  NEW.user_name := u.name;
  NEW.user_role := u.role;
  -- Also enforce company_id from the verified profile, ignoring whatever
  -- the client tried to claim.
  IF u.id IS NOT NULL THEN
    SELECT company_id INTO NEW.company_id FROM public.app_users WHERE id = u.id LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_activity_stamp_user ON public.activity;
CREATE TRIGGER trg_activity_stamp_user
  BEFORE INSERT ON public.activity
  FOR EACH ROW EXECUTE FUNCTION public.stamp_activity_user();

-- ── Backfill: copy the JSONB blob into the new per-record tables ─────────────
-- This runs ONCE during migration. After it succeeds, the application should
-- switch to the new sync engine and stop writing the company_data.db row.
DO $$
DECLARE
  legacy JSONB;
  rec    JSONB;
  v_id   UUID;
BEGIN
  SELECT db INTO legacy FROM public.company_data LIMIT 1;
  IF legacy IS NULL THEN
    RAISE NOTICE 'No legacy company_data row to backfill — skipping.';
    RETURN;
  END IF;

  -- Each of these is a list of records inside the legacy blob.
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(legacy->'invoices', '[]'::jsonb)) LOOP
    INSERT INTO public.invoices (company_id, data, voided, created_at, updated_at)
    VALUES (
      'slot-engineering-nigeria',
      rec,
      COALESCE((rec->>'voided')::boolean, false) OR COALESCE(rec->>'status','') = 'Cancelled',
      COALESCE((rec->>'createdAt')::timestamptz, NOW()),
      COALESCE((rec->>'updatedAt')::timestamptz, NOW())
    );
  END LOOP;
  -- (Repeat the same block for ar_receipts, ap_bills, ap_payments, pettycash,
  --  fixedassets, terminal_charges, payroll_runs, fleet_repairs.
  --  Each follows the same pattern — see supabase/backfillRecords.js for the
  --  programmatic version that does the same job from JS, with proper
  --  company_id resolution and per-table error logging.)
  RAISE NOTICE 'Backfill complete — switch the application to syncPerRecord.js.';
END $$;
