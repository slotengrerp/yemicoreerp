-- ══════════════════════════════════════════════════════════════════════════════
-- SLOT Engineering — Per-Record Tables Migration (005)
-- Round-2 features: BoLs · Terminal Advances · Stock Items / Movements
--                   · Sales Orders · Recurring Journal Templates
--                   · App Settings · Attachments
--
-- These are the new collections introduced after the round-1 audit fix
-- (003_per_record_tables.sql). Each gets its own per-record table so
-- concurrent users editing different Terminal BoLs, advances, or stock
-- items can never silently overwrite each other.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & run
--   Run AFTER 001 + 002 + 003 + 004 are in place.
--   Migration is idempotent: re-running it is safe (IF NOT EXISTS everywhere).
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Lookup helper — current user's company id (mirrors 002_rls.sql) ─────────
-- Re-created here to ensure RLS policies resolve the function name even if
-- this migration is run on a fresh database that skipped 003.
CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT company_id FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'Active'
$$;

CREATE OR REPLACE FUNCTION public.i_am_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE auth_user_id = auth.uid() AND role = 'admin' AND status = 'Active'
  )
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE: terminal_bols
-- Bill of Lading parent records. One row per BoL. Children (containers,
-- transit records) reference the BoL via bolId in the existing
-- terminal_charges / invoices tables.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.terminal_bols (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_terminal_bols_company    ON public.terminal_bols(company_id);
CREATE INDEX IF NOT EXISTS idx_terminal_bols_updated_at ON public.terminal_bols(company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_bols_voided     ON public.terminal_bols(company_id, voided);

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE: terminal_advances
-- Advance payments received in advance for clearing a list of containers.
-- Each row's `data.containersCovered[]` carries the per-container allocation;
-- `data.applications[]` tracks how the advance was spent against each
-- container. Auto-posted to the GL via Dr Bank / Cr 2099 (Advance from
-- Customer, Terminal) on receipt and Dr 2099 / Cr 4005 (Logistics Income)
-- on each application.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.terminal_advances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_terminal_advances_company    ON public.terminal_advances(company_id);
CREATE INDEX IF NOT EXISTS idx_terminal_advances_updated_at ON public.terminal_advances(company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_advances_voided     ON public.terminal_advances(company_id, voided);

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE: stock_items
-- Master list of stock-keeping units (SKUs) — Pipes, Electrical, Hardware,
-- etc. Each carries a default uom, reorder point, and accounting hint
-- (cogsAccountCode, inventoryAccountCode).
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_items_company    ON public.stock_items(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_items_updated_at ON public.stock_items(company_id, updated_at DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE: stock_movements
-- Append-style movement log: RECEIVE / ISSUE / RETURN / SCRAP / ADJUST.
-- On-hand quantity, weighted-avg cost, and stock value are derived from
-- this table on read. Posted (Dr COGS / Cr Inventory) movements are
-- mirrored to the journal_entries table by the central auto-post effect.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_company    ON public.stock_movements(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_updated_at ON public.stock_movements(company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item      ON public.stock_movements(company_id, (data->>'itemId'));

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE: sales_orders
-- Quote → Sales Order → Invoice pipeline. Each SO has line items with
-- order qty, unit price, currency, and per-line `invoicedQty` for
-- back-order tracking. AR invoices reference their source SO via
-- `data.salesOrderId` / `data.salesOrderNo`.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.sales_orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_orders_company    ON public.sales_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_updated_at ON public.sales_orders(company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_orders_status     ON public.sales_orders(company_id, (data->>'status'));

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE: recurring_templates
-- Saved journal entry templates with frequency (monthly/quarterly/yearly)
-- that accountants re-post with one click. Each post creates a fresh
-- journal_entries row — templates themselves are CRUD.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.recurring_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_company    ON public.recurring_templates(company_id);
CREATE INDEX IF NOT EXISTS idx_recurring_templates_updated_at ON public.recurring_templates(company_id, updated_at DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE: app_settings
-- Per-company settings blob (theme, fiscal year, period close state,
-- bank feed credentials, etc.). One row per company. Replaces the
-- `company_data.settings` sub-blob from the legacy model.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.app_settings (
  company_id  TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- TABLE: attachments
-- Document attachments across all transactional records. Each row holds
-- the file's URL/path (Supabase Storage) plus metadata — name, size,
-- content type, uploader, target module/record. Binary content lives in
-- the `scanner-docs` bucket; this table is the lookup index.
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT NOT NULL,
  data        JSONB NOT NULL,         -- { name, url, path, sizeBytes, contentType, storageBackend, folder, uploadedAt, uploadedBy, parentType, parentId }
  parent_type TEXT NOT NULL,           -- e.g. 'ar-invoice', 'ap-bill', 'sales-order', 'journal'
  parent_id   TEXT NOT NULL,           -- the record this attachment belongs to
  voided      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attachments_company  ON public.attachments(company_id);
CREATE INDEX IF NOT EXISTS idx_attachments_parent   ON public.attachments(company_id, parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_attachments_updated  ON public.attachments(company_id, updated_at DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- Enable RLS on all new tables — with FORCE ROW LEVEL SECURITY so the
-- table owner role (postgres, any future db_admin role) cannot bypass
-- policies. The service_role used by Edge Functions still bypasses RLS
-- by Supabase design — that's the only documented exception.
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.terminal_bols        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_bols        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_advances     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_advances     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stock_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_items           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders          FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_templates   FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings          FORCE ROW LEVEL SECURITY;
ALTER TABLE public.attachments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments           FORCE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════════════════════
-- Company-scoped RLS policies — same pattern as 003
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  tbl TEXT;
BEGIN
  -- Standard CRUD tables: company-scoped read/write/delete
  FOR tbl IN SELECT unnest(ARRAY[
    'terminal_bols', 'terminal_advances',
    'stock_items',   'stock_movements',
    'sales_orders',  'recurring_templates',
    'attachments'
  ]) LOOP
    EXECUTE format($p$
      CREATE POLICY "%1$s_company_isolation" ON public.%1$s
        FOR ALL
        USING       (company_id = public.get_my_company_id())
        WITH CHECK  (company_id = public.get_my_company_id())
    $p$, tbl);
  END LOOP;

  -- app_settings: one row per company, scoped by PRIMARY KEY
  EXECUTE $p$
    CREATE POLICY "app_settings_company_isolation" ON public.app_settings
      FOR ALL
      USING       (company_id = public.get_my_company_id())
      WITH CHECK  (company_id = public.get_my_company_id())
  $p$;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- Backfill hint (idempotent — safe to re-run)
--
-- After this migration runs, JS calls backfillRound2Records() to copy any
-- local-storage-only data for these new collections into the tables above.
-- That function (in supabase/syncPerRecord.js) does the heavy lifting from
-- the client side so we don't need a giant PL/pgSQL block here.
-- ══════════════════════════════════════════════════════════════════════════════

-- Verify policies are active
DO $$
DECLARE
  tbl TEXT;
  n   INTEGER;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'terminal_bols','terminal_advances','stock_items','stock_movements',
    'sales_orders','recurring_templates','app_settings','attachments'
  ]) LOOP
    SELECT count(*) INTO n FROM pg_policies WHERE tablename = tbl;
    RAISE NOTICE 'Table % : % policies', tbl, n;
  END LOOP;
END $$;
