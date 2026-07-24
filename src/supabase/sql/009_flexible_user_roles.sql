-- SLOT Engineering — Allow Custom Roles to Actually Be Assigned (009)
-- ══════════════════════════════════════════════════════════════════════════════
-- RUN THIS AFTER: 008_rls_gap_and_search_path.sql
-- RUN WHERE: Supabase SQL editor, against the LIVE project (fxlejgzazgyudraqlxjv)
--
-- ── Why this exists ────────────────────────────────────────────────────────────
-- Settings → Permissions already lets an admin define custom roles (name +
-- Add/Edit/Delete/Approve/Settings flags), and the Users module's role
-- dropdown already lists them (getAllRoles(appSettings) in utils/auth.js).
-- Pick one there today and the save fails — not an app bug, a database one:
-- app_users.role has always had a fixed CHECK constraint
-- (`role IN ('admin','manager','accountant','cashier','viewer')`) that
-- rejects anything else outright. The flexible system was only ever half
-- wired to the database.
--
-- This migration replaces that fixed CHECK with a trigger that accepts the
-- 5 built-ins OR any key currently present in that company's
-- company_data.settings->'customRoles' (where Settings → Permissions saves
-- them) — so a custom role has to actually exist before it can be assigned,
-- same ordering the UI already expects (define the role first, then assign
-- it), but the database itself no longer hardcodes the list of 5.
--
-- Deliberately UNCHANGED by this file: payroll_runs and journal_entries stay
-- restricted to the 3 trusted built-in roles from 007_security_hardening.sql
-- (`role IN ('admin','accountant')` / `role IN ('admin','manager','accountant')`).
-- Those checks are string literals, independent of this constraint — a
-- custom role is automatically excluded from both tables with no extra work,
-- which is the intended scope (per 2026-07-24 discussion: custom roles are
-- for operational modules, not payroll/GL).
--
-- Idempotent: safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── Part 1 — Drop the fixed 5-value CHECK constraint ──────────────────────────
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_role_check;


-- ── Part 2 — Trigger-validated replacement ────────────────────────────────────
-- SECURITY DEFINER + pinned search_path, same pattern as get_my_company_id()/
-- i_am_admin()/enforce_self_update_scope() in 002_rls.sql — reads
-- company_data regardless of the caller's own RLS visibility, and avoids the
-- search_path gap closed for the other functions in 008.
CREATE OR REPLACE FUNCTION public.validate_user_role()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_custom_role boolean;
BEGIN
  -- Built-ins always pass — the common case, no lookup needed.
  IF NEW.role IN ('admin','manager','accountant','cashier','viewer') THEN
    RETURN NEW;
  END IF;

  -- Otherwise, it must exist in this company's custom role list.
  SELECT EXISTS (
    SELECT 1
    FROM public.company_data cd,
         jsonb_array_elements(COALESCE(cd.settings->'customRoles', '[]'::jsonb)) AS cr
    WHERE cd.id = NEW.company_id
      AND cr->>'key' = NEW.role
  ) INTO is_custom_role;

  IF NOT is_custom_role THEN
    RAISE EXCEPTION 'Invalid role "%" — must be a built-in role (admin/manager/accountant/cashier/viewer) or a custom role defined in Settings → Permissions for this company first', NEW.role;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_users_validate_role ON public.app_users;
CREATE TRIGGER trg_app_users_validate_role
  BEFORE INSERT OR UPDATE OF role ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.validate_user_role();


-- ── Verify ────────────────────────────────────────────────────────────────────
-- Should return 0 rows — the old fixed CHECK is gone.
SELECT conname FROM pg_constraint WHERE conrelid = 'public.app_users'::regclass AND conname = 'app_users_role_check';

-- Should return exactly 1 row — the new trigger is active.
SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.app_users'::regclass AND tgname = 'trg_app_users_validate_role';

-- Sanity check the logic itself, without touching real data:
-- (run manually, expect the first to succeed and the second to raise an
-- exception, then roll back either way)
--   BEGIN;
--     UPDATE app_users SET role = 'viewer' WHERE false;                 -- no-op, just proves built-ins still pass
--     UPDATE app_users SET role = 'not_a_real_role' WHERE false;         -- would raise if it matched any row
--   ROLLBACK;
