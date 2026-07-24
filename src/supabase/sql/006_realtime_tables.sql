-- SLOT Engineering — Enable Realtime on Per-Record Tables (006)
-- ══════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER: 001, 002, 003, 004, 005 (needs the per-record tables to exist)
--
-- Why this exists:
--   Creating a table and enabling RLS on it does NOT automatically make it
--   broadcast over Supabase Realtime. A table only emits postgres_changes
--   events once it's explicitly added to the `supabase_realtime` publication
--   (either via this SQL, or the "Realtime" toggle per-table in the Supabase
--   dashboard). 003_per_record_tables.sql and 005_round2_tables.sql created
--   18 tables and src/supabase/syncPerRecord.js's subscribePerRecord() opens
--   a channel for every one of them — but none were ever added to the
--   publication, so those channels connect successfully and just never
--   receive anything. Cross-device live sync on the new tables has been
--   silently a no-op until now; nothing was wrong with your app code.
--
-- Idempotent: safe to re-run. Skips any table already in the publication
-- instead of erroring, so partial re-runs (or tables added later) are fine.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'invoices',
    'ar_receipts',
    'ap_bills',
    'ap_payments',
    'pettycash',
    'fixedassets',
    'payroll_runs',
    'terminal_charges',
    'terminal_bols',
    'terminal_advances',
    'fleet_repairs',
    'stock_items',
    'stock_movements',
    'sales_orders',
    'recurring_templates',
    'vendors',
    'clients',
    'projects'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
      RAISE NOTICE 'Added public.% to supabase_realtime publication', tbl;
    ELSE
      RAISE NOTICE 'public.% already in supabase_realtime publication — skipped', tbl;
    END IF;
  END LOOP;
END $$;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- After running, this should list all 18 tables above. If any are missing,
-- re-run this file — it's safe to run as many times as needed.
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
ORDER BY tablename;