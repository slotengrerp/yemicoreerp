-- SLOT Engineering — Fix id Column Types on Per-Record Tables (010)
-- ══════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER: 009_flexible_user_roles.sql
-- RUN WHERE: Supabase SQL editor, against the LIVE project (fxlejgzazgyudraqlxjv)
--
-- ── Why this exists ────────────────────────────────────────────────────────────
-- Backfill failed on vendors/clients/projects with:
--   "invalid input syntax for type uuid: 'v001'"
-- Root cause: 003_per_record_tables.sql / 005_round2_tables.sql gave every
-- per-record table `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — but the
-- application has NEVER generated UUIDs for these records. Confirmed across
-- the whole codebase:
--   - Seed/legacy master data uses short human ids: vendors v001-v028,
--     invoices inv1-inv4, receipts arv1, etc.
--   - Every "add new record" path (SalesOrders, Inventory, TerminalOps,
--     ContractStaff, SlotStaff, AccountsReceivable, ExcelManager, ...) creates
--     new ids via utils/helpers.js's generateId() — a base-36
--     timestamp+random string like "lz3k9a2xf7q", not a UUID.
--   - Journal entries (utils/glPosting.js) use deterministic prefixed ids
--     like `JE-AR-INV-${inv.id}`, `JE-PR-${run.id}` — these aren't just
--     non-UUID, the exact string is load-bearing: it's how the GL posting
--     idempotency guards detect "already posted, don't duplicate."
--
-- vendors/clients/projects are only the tables that happened to fail TODAY
-- because they're the only ones with real pre-loaded data this early in the
-- company's use of the app (master data, loaded up front; transactional
-- tables are still empty because no one's recorded a transaction through the
-- per-record engine yet). The SAME error would hit every other table the
-- moment a real invoice, sales order, inventory item, or journal entry is
-- saved through it — this closes that for all of them now, not one at a time
-- as each one happens to break.
--
-- `activity` is deliberately NOT included — logActivityServer() never
-- supplies its own id, so the UUID default is genuinely in use there and is
-- correct as-is.
--
-- Safe: every one of these tables has 0 rows today (vendors/clients/projects'
-- backfill failed outright, so nothing landed) except possibly a handful from
-- other successful backfill runs — either way, changing a column's type on a
-- near-empty table is fast and low-risk. Idempotent: checks the current type
-- before altering, so re-running this after it's already applied is a no-op.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl text;
  current_type text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'invoices','ar_receipts','ap_bills','ap_payments','pettycash','fixedassets',
    'payroll_runs','terminal_charges','terminal_bols','terminal_advances',
    'fleet_repairs','stock_items','stock_movements','sales_orders',
    'recurring_templates','vendors','clients','projects',
    'journal_entries','attachments'
  ]
  LOOP
    SELECT data_type INTO current_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'id';

    IF current_type = 'uuid' THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id DROP DEFAULT', tbl);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id TYPE TEXT', tbl);
      RAISE NOTICE 'public.%: id changed uuid -> text', tbl;
    ELSIF current_type = 'text' THEN
      RAISE NOTICE 'public.%: id already text — skipped', tbl;
    ELSE
      RAISE NOTICE 'public.%: unexpected id type % — skipped, check manually', tbl, current_type;
    END IF;
  END LOOP;
END $$;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- Should show 'text' for every row.
SELECT table_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'id'
  AND table_name IN (
    'invoices','ar_receipts','ap_bills','ap_payments','pettycash','fixedassets',
    'payroll_runs','terminal_charges','terminal_bols','terminal_advances',
    'fleet_repairs','stock_items','stock_movements','sales_orders',
    'recurring_templates','vendors','clients','projects',
    'journal_entries','attachments'
  )
ORDER BY table_name;
