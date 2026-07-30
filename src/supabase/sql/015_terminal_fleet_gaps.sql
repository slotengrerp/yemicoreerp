-- ══════════════════════════════════════════════════════════════════════════════
-- SLOT Engineering — Terminal + Fleet Remaining Gaps (015)
-- ══════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER: 014_full_per_record_coverage.sql
-- RUN WHERE: Supabase SQL editor, against the LIVE project (fxlejgzazgyudraqlxjv)
--
-- Why this exists — 2026-07-29, same day as 013/014, found while wiring the
-- actual push calls into every module (not just adding tables):
--
--   1. db.terminal has SEVEN sub-collections (containers, charges, logistics,
--      bols, advances, consignees, shippingCompanies) but RECORD_TABLES only
--      ever mapped five of them. `containers` and `logistics` were missed —
--      same class of bug as the original staff incident, just not yet hit in
--      practice because those two happen to be edited less often.
--
--   2. db.fleet has NINE sub-collections (fleet, services, maintLog, repairs,
--      breakdowns, requests, handovers, facilitySchedule, calibration) but
--      only `repairs` (fleetRepairs) was ever migrated (014, and before
--      that, nothing). The other eight — including the fleet vehicle roster
--      itself — have never had a cloud table.
--
-- Schema matches the proven-live pattern: TEXT id, company_id FK, data
-- JSONB, voided BOOLEAN (all ten of these are transactional/event records,
-- not standing reference data, so none go in NO_VOID_TABLES).
--
-- Idempotent: every statement is safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'Active'
$$;

DO $$
DECLARE
  t TEXT;
  voided_tables TEXT[] := ARRAY[
    'terminal_containers', 'terminal_logistics',
    'fleet_vehicles', 'fleet_services', 'fleet_maint_log', 'fleet_breakdowns',
    'fleet_vehicle_requests', 'fleet_handovers', 'fleet_facility_schedule',
    'fleet_calibration'
  ];
BEGIN
  FOREACH t IN ARRAY voided_tables LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS public.%I (
        id          TEXT PRIMARY KEY,
        company_id  TEXT NOT NULL REFERENCES public.companies(id),
        data        JSONB NOT NULL,
        voided      BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )$f$, t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(company_id)', 'idx_'||t||'_company', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_company_isolation', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR ALL
      USING (company_id = get_my_company_id())
      WITH CHECK (company_id = get_my_company_id())$f$, t||'_company_isolation', t);
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename=t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- Should return 10 rows, all id data_type = 'text'.
SELECT c.table_name, c.data_type
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.column_name='id' AND c.table_name IN (
  'terminal_containers', 'terminal_logistics',
  'fleet_vehicles', 'fleet_services', 'fleet_maint_log', 'fleet_breakdowns',
  'fleet_vehicle_requests', 'fleet_handovers', 'fleet_facility_schedule',
  'fleet_calibration'
) ORDER BY c.table_name;

SELECT tablename FROM pg_policies WHERE tablename IN (
  'terminal_containers', 'terminal_logistics',
  'fleet_vehicles', 'fleet_services', 'fleet_maint_log', 'fleet_breakdowns',
  'fleet_vehicle_requests', 'fleet_handovers', 'fleet_facility_schedule',
  'fleet_calibration'
) ORDER BY tablename;

SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename IN (
  'terminal_containers', 'terminal_logistics',
  'fleet_vehicles', 'fleet_services', 'fleet_maint_log', 'fleet_breakdowns',
  'fleet_vehicle_requests', 'fleet_handovers', 'fleet_facility_schedule',
  'fleet_calibration'
) ORDER BY tablename;
