-- ══════════════════════════════════════════════════════════════════════════════
-- SLOT Engineering ERP — Database Schema v1.0
-- Migration 001: app_users table
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New Query → paste & run
--   Run this file BEFORE 002_rls.sql
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Remove the old wide-open policy on company_data ────────────────────────
-- This table was created in initial setup with USING(true) — 002_rls.sql
-- replaces it with a properly scoped policy. Drop it here first so there's
-- no conflict when 002_rls.sql runs.
DROP POLICY IF EXISTS "Allow all for now" ON company_data;

-- ── 2. Create app_users table ─────────────────────────────────────────────────
-- One row per SLOT ERP user account.
--
-- auth_user_id → links to Supabase's auth.users (Supabase Auth identity).
--                NULL until the admin creates the Supabase Auth account and
--                runs the UPDATE below to link it. ON DELETE SET NULL means
--                the app_users row survives auth account deletion (audit trail).
-- company_id   → matches company_data.id — scopes all RLS policies to a company.
-- role         → drives the app's permission matrix (ROLE_PERMS in utils/auth.js).
-- modules      → JSON array of module IDs this user can see.
-- status       → Active users can log in; Inactive ones are blocked at login.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    TEXT        NOT NULL DEFAULT 'slot-engineering-nigeria',
  auth_user_id  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  username      TEXT,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  phone         TEXT,
  role          TEXT        NOT NULL DEFAULT 'viewer'
                            CHECK (role IN ('admin','manager','accountant','cashier','viewer')),
  modules       JSONB       NOT NULL DEFAULT '[]',
  status        TEXT        NOT NULL DEFAULT 'Active'
                            CHECK (status IN ('Active','Inactive')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for the three queries that happen on every login and page load
CREATE UNIQUE INDEX IF NOT EXISTS app_users_auth_uid ON app_users (auth_user_id)
  WHERE auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_users_email   ON app_users (lower(email));
CREATE INDEX IF NOT EXISTS app_users_company ON app_users (company_id);

-- Auto-bump updated_at whenever a row changes
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_app_users_touch ON app_users;
CREATE TRIGGER trg_app_users_touch
  BEFORE UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── 3. Seed initial admin account ─────────────────────────────────────────────
-- auth_user_id is left NULL here — you link it in Step 3 of the guide below.
-- ON CONFLICT DO NOTHING so re-running this migration is safe.
INSERT INTO app_users (company_id, username, name, email, role, modules, status)
VALUES (
  'slot-engineering-nigeria',
  'admin',
  'SLOT Admin',
  'admin@slotengineering.com',
  'admin',
  '["nlng","slot","procurement","inventory","vehicles","terminal","invoices","pettycash",
    "request","accounting","approvals","analytics","users","settings","backup",
    "activitylog","excel","fixedassets"]'::jsonb,
  'Active'
)
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- AFTER RUNNING THIS MIGRATION — link the admin Supabase Auth account:
--
-- Step 1: Supabase Dashboard → Authentication → Users → Add User
--         Email:    admin@slotengineering.com
--         Password: (choose a strong password, 12+ chars)
--         ✓ Auto Confirm User
--
-- Step 2: Click the new user row, copy the UUID from the User details panel
--
-- Step 3: Run this in SQL Editor (replace the UUID with the one you copied):
--
--   UPDATE app_users
--   SET auth_user_id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
--   WHERE email = 'admin@slotengineering.com';
--
-- Step 4: Sign in to the app with admin@slotengineering.com and that password.
--         The app will find the auth_user_id → app_users link and log you in.
--
-- Repeat Steps 1–3 for every user who needs a Supabase login.
-- ══════════════════════════════════════════════════════════════════════════════
