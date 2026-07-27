-- SLOT Engineering — Close Leftover RLS Gap + Function Search-Path Hardening (008)
-- ══════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER: 007_security_hardening.sql
-- RUN WHERE: Supabase SQL editor, against the LIVE project (fxlejgzazgyudraqlxjv)
--
-- Found 2026-07-24 via Supabase's own security advisor (get_advisors), while
-- verifying 007 — NOT in the 2026-07-23 audit, because that audit was done by
-- reading source code, and this is a live-database-only defect: the code has
-- always been correct.
--
-- ── What's actually wrong ──────────────────────────────────────────────────────
-- 002_rls.sql creates two correct, restrictive policies on company_data
-- ("company_data: read", "company_data: write" — signed-in users, own company
-- row only) and explicitly tries to drop a draft leftover policy first:
--     DROP POLICY IF EXISTS "Allow all for now" ON company_data;
-- But the live database's leftover policy is actually named "Allow all"
-- (no "for now") — a one-word mismatch, so the DROP never matched it. Both
-- policies have been live side by side ever since. Postgres OR's multiple
-- permissive policies together, so "Allow all" (USING true, roles: public)
-- silently overrides the restrictive ones — confirmed directly against the
-- live table:
--     policyname            | cmd  | roles
--     Allow all              | ALL  | {public}
--     company_data: read     | SELECT | {public}
--     company_data: write    | ALL  | {public}
-- Net effect: anyone holding the anon key (which ships in the public JS
-- bundle by Supabase's own design — that part is normal) can currently read
-- and write the entire company_data row directly via the REST API, signed in
-- or not, bypassing the app UI and every role check in it entirely. This is
-- the live production data store today (VITE_USE_PER_RECORD_SYNC is unset),
-- so this is the single highest-priority item in this file.
--
-- The fix is one line — the correct policies already exist and work; the
-- leftover just needs to actually be dropped this time.
--
-- Idempotent: safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── Part 1 — Drop the leftover permissive policy ──────────────────────────────
DROP POLICY IF EXISTS "Allow all" ON public.company_data;


-- ── Part 2 — Pin search_path on SECURITY DEFINER / trigger functions ─────────
-- Advisor finding: these 5 functions don't pin search_path, so it's inherited
-- from the calling session. A caller who can create objects in a schema that
-- sorts earlier in their own search_path could in theory shadow an unqualified
-- reference (e.g. app_users) inside these functions. Pinning to `public`
-- (where every referenced table/schema in these functions actually lives)
-- closes that without changing behavior — nothing here is renamed or
-- requalified, so no application code changes needed.
ALTER FUNCTION public.get_my_company_id()        SET search_path = public;
ALTER FUNCTION public.i_am_admin()               SET search_path = public;
ALTER FUNCTION public.enforce_self_update_scope() SET search_path = public;
ALTER FUNCTION public.stamp_activity_user()       SET search_path = public;
ALTER FUNCTION public.touch_updated_at()          SET search_path = public;


-- ── Deliberately NOT included, and why ────────────────────────────────────────
-- - SECURITY DEFINER functions callable via RPC by anon/authenticated
--   (get_my_company_id, i_am_admin, enforce_self_update_scope,
--   stamp_activity_user): get_my_company_id/i_am_admin only ever return
--   something about the CALLER'S OWN session (their own company_id / their own
--   admin flag) — not sensitive, and revoking EXECUTE risks breaking RLS
--   itself, since policies across every table call these two by name under
--   the querying role. enforce_self_update_scope/stamp_activity_user are
--   RETURNS TRIGGER functions — Postgres does not allow calling a trigger
--   function directly outside trigger context, so the "exposed" RPC path
--   already errors on its own; revoking EXECUTE would be cosmetic only.
--   Net: touching function grants here is where a "hardening" pass could
--   accidentally break the whole app's RLS — left alone on purpose.
-- - `public.companies` has RLS enabled with zero policies (default-deny).
--   Confirmed no client code ever queries it directly (it's FK-referenced
--   only) — default-deny is already the correct, safe state. Adding a policy
--   here would only be needed if something starts reading it directly.
-- - Leaked password protection (Auth advisor, disabled): not a SQL change —
--   it's a single toggle in Supabase Dashboard → Authentication → Policies →
--   "Leaked password protection". Worth turning on; just can't be done from
--   this script.


-- ── Verify ────────────────────────────────────────────────────────────────────
-- Should show exactly 2 rows now (the leftover is gone).
SELECT policyname, cmd, roles FROM pg_policies
WHERE tablename = 'company_data' ORDER BY policyname;

-- Should show 'public' for all 5.
SELECT proname, proconfig FROM pg_proc
WHERE proname IN ('get_my_company_id','i_am_admin','enforce_self_update_scope','stamp_activity_user','touch_updated_at')
  AND pronamespace = 'public'::regnamespace;
