-- ═══════════════════════════════════════════════════════════════════════════
-- 017 — Reject duplicate records at the database level
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY
--
-- Until now the ONLY unique index on any record table was the primary key on
-- `id`, and `id` is a randomly generated client-side string. That means the
-- same real-world record imported twice produced two different ids, and the
-- database accepted both without complaint. Two staff uploading the same
-- spreadsheet — routine while a team is testing, since nobody knows who has
-- already done it — silently doubled the data.
--
-- ExcelManager.jsx now detects duplicates before import and skips them. That
-- is the helpful layer: it explains what it is skipping and why. THIS is the
-- guarantee layer. A UI check only protects the paths that run it; a unique
-- index protects every path, including a direct API call, a future import
-- screen someone adds without remembering this rule, and a bug in the check
-- itself. Both layers are wanted — the app explains, the database enforces.
--
-- CHOICE OF KEYS
--
-- Keys are the fields that identify the record to a human, not to a programmer.
-- Two deliberate decisions worth keeping:
--
--   • Containers key on containerNo + billOfLading, NOT containerNo alone. A
--     physical container legitimately comes back months later on a different
--     Bill of Lading. Keying on the box number alone would reject real work.
--     The same box on the SAME BoL is always a duplicate.
--
--   • Every index is PARTIAL: `WHERE voided = false` and the key must be
--     non-blank. Voided records are the app's soft-delete — a voided invoice
--     must not block re-issuing that number. Blank keys can't be judged, so
--     they are left unconstrained rather than collapsed into one row.
--
-- These are UNIQUE INDEXES, not constraints, specifically so they can be
-- partial. Adding one fails loudly if duplicates already exist, which is the
-- correct behaviour — see the pre-flight query at the bottom.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Terminal ───────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_terminal_bols_number
  ON public.terminal_bols (company_id, upper(trim(data->>'billOfLadingNo')))
  WHERE voided = false AND coalesce(trim(data->>'billOfLadingNo'), '') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_terminal_containers_no_per_bol
  ON public.terminal_containers (
    company_id,
    upper(trim(data->>'containerNo')),
    upper(coalesce(trim(data->>'billOfLading'), ''))
  )
  WHERE voided = false AND coalesce(trim(data->>'containerNo'), '') <> '';

-- ── Finance ────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_number
  ON public.invoices (company_id, upper(trim(data->>'invoiceNo')))
  WHERE voided = false AND coalesce(trim(data->>'invoiceNo'), '') <> '';

-- ── HR ─────────────────────────────────────────────────────────────────────
-- Staff reference IDs are the payroll identity. A duplicate here means
-- somebody could be paid twice, so this is the highest-value guard of the set.
CREATE UNIQUE INDEX IF NOT EXISTS uq_nlng_staff_ref
  ON public.nlng_staff (company_id, upper(trim(data->>'refId')))
  WHERE coalesce(trim(data->>'refId'), '') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_slot_staff_ref
  ON public.slot_staff (company_id, upper(trim(data->>'refId')))
  WHERE coalesce(trim(data->>'refId'), '') <> '';

-- ── Masters — HELD BACK, NOT YET APPLIED ───────────────────────────────────
--
-- 2026-08-03: the pre-flight found these tables ALREADY contain duplicates,
-- created before any of this existed:
--
--     clients  · NIGERIA LNG LIMITED                            ×4
--     clients  · RENAISSANCE AFRICA ENERGY COMPANY OF NIG. LTD  ×3
--     clients  · ALPHADEN ENERGY & OILFIELD LIMITED             ×2
--     vendors  · CSPS                                           ×3
--
-- 12 rows where there should be 4 — proof the duplicate problem is real and
-- not theoretical. These two indexes are deliberately left commented out.
--
-- They CANNOT simply be applied: each duplicate has its own id, and invoices,
-- bills and sales orders reference clients and vendors BY id. Deleting the
-- extra copies without re-pointing everything that references them would
-- orphan those documents — trading a duplicate-name problem for a
-- missing-customer problem, which is worse.
--
-- Correct sequence: pick the surviving id for each name, re-point every
-- referencing record to it, delete the losers, THEN uncomment and apply.
-- Until that is done these two stay off so the rest of this migration can
-- land safely.
--
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_name
--   ON public.vendors (company_id, upper(trim(data->>'name')))
--   WHERE coalesce(trim(data->>'name'), '') <> '';
--
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_name
--   ON public.clients (company_id, upper(trim(data->>'name')))
--   WHERE coalesce(trim(data->>'name'), '') <> '';

-- ═══════════════════════════════════════════════════════════════════════════
-- PRE-FLIGHT — run this BEFORE applying if any table already holds data.
-- Any row returned must be resolved by hand first; the index creation will
-- fail (safely, in a transaction) until it comes back empty.
--
--   SELECT 'terminal_containers' AS tbl,
--          upper(trim(data->>'containerNo')) AS k1,
--          upper(coalesce(trim(data->>'billOfLading'),'')) AS k2,
--          count(*)
--   FROM public.terminal_containers
--   WHERE voided = false AND coalesce(trim(data->>'containerNo'),'') <> ''
--   GROUP BY 1,2,3 HAVING count(*) > 1
--   UNION ALL
--   SELECT 'nlng_staff', upper(trim(data->>'refId')), '', count(*)
--   FROM public.nlng_staff
--   WHERE coalesce(trim(data->>'refId'),'') <> ''
--   GROUP BY 1,2,3 HAVING count(*) > 1;
-- ═══════════════════════════════════════════════════════════════════════════
