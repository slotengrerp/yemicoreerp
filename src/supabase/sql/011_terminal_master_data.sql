-- ══════════════════════════════════════════════════════════════════════════════
-- SLOT Engineering — Terminal Master Data — 011
--
-- Adds Consignee and Shipping Company master tables for Terminal Ops (Bill of
-- Lading module). Closes the gap flagged in
-- SLOT_BillOfLading_Schema_Audit_2026-07-25.md (B.2 / B.3): consignee and
-- shipping company were free-text fields on every container/BoL row, with no
-- backing entity, no stable ID, and no way to store address/phone/email.
--
-- Same shape as terminal_bols / terminal_advances (005_round2_tables.sql):
-- one JSONB `data` blob per row, company-scoped RLS, voided flag instead of
-- hard delete. `id` is TEXT, NOT UUID with a default — see
-- 010_fix_record_id_column_types.sql for why: the app's generateId() (in
-- utils/helpers.js) produces short base-36 strings, not UUIDs. Every other
-- per-record table had to be corrected after the fact for this; this one
-- starts correct.
--
-- RUN THIS AFTER: 010_fix_record_id_column_types.sql
-- RUN WHERE: Supabase SQL editor, against the live project (fxlejgzazgyudraqlxjv)
-- ══════════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE: terminal_consignees
-- Master list of consignees (cargo recipients) referenced by containers via
-- `data.consigneeId`. `containers.consigneeName` stays as a cached display
-- field, auto-filled from this table when a consignee is selected — kept so
-- existing filters/prints/reports that read consigneeName keep working
-- unchanged.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.terminal_consignees (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_terminal_consignees_company        ON public.terminal_consignees(company_id);
CREATE INDEX IF NOT EXISTS idx_terminal_consignees_updated_at     ON public.terminal_consignees(company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_consignees_active_updated ON public.terminal_consignees(company_id, updated_at DESC) WHERE voided = false;

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE: terminal_shipping_companies
-- Master list of shipping companies/carriers referenced by BoLs and
-- containers via `data.shippingCompanyId`. `shippingCompany` text stays as a
-- cached display field on both, same reasoning as above.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.terminal_shipping_companies (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_terminal_shipping_co_company        ON public.terminal_shipping_companies(company_id);
CREATE INDEX IF NOT EXISTS idx_terminal_shipping_co_updated_at     ON public.terminal_shipping_companies(company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_shipping_co_active_updated ON public.terminal_shipping_companies(company_id, updated_at DESC) WHERE voided = false;

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS — same company-isolation pattern as every other per-record table
-- (see 005_round2_tables.sql / 007_security_hardening.sql). Guarded with
-- DROP POLICY IF EXISTS first (precedent: 001_schema.sql does the same) so
-- this migration is safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.terminal_consignees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_consignees         FORCE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_shipping_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_shipping_companies FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'terminal_consignees', 'terminal_shipping_companies'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_company_isolation" ON public.%1$s', tbl);
    EXECUTE format($p$
      CREATE POLICY "%1$s_company_isolation" ON public.%1$s
        FOR ALL
        USING       (company_id = public.get_my_company_id())
        WITH CHECK  (company_id = public.get_my_company_id())
    $p$, tbl);
  END LOOP;
END $$;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- Expect both tables listed, each with one policy.
SELECT t.table_name, count(p.policyname) AS policy_count
FROM information_schema.tables t
LEFT JOIN pg_policies p ON p.tablename = t.table_name
WHERE t.table_schema = 'public'
  AND t.table_name IN ('terminal_consignees', 'terminal_shipping_companies')
GROUP BY t.table_name
ORDER BY t.table_name;
