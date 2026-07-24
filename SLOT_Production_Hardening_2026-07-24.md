# SLOT ERP — Production Hardening — 2026-07-24

Follow-up to the 2026-07-23 QA/Security/DBA audit and the pre-launch checklist.
Closes the two **critical** items that were still open, plus the two lower
ones, and lays out the last mile before this can safely be SLOT's daily
system of record with no fallback.

---

## 1. What's done — code side, verified

- **`src/supabase/sql/007_security_hardening.sql`** (new) — consolidates
  three items into one idempotent, ready-to-run script:
  - Role-based RLS on `payroll_runs` and `journal_entries` (admin/manager/
    accountant only — cashier/viewer keep their own modules but can no
    longer pull the whole GL or payroll via a direct API call, bypassing
    the UI entirely).
  - The 12 missing `(company_id, voided)` partial indexes.
  - `app_users.email` UNIQUE constraint (guarded — tells you clearly if a
    duplicate is blocking it instead of a bare error, same situation as the
    one resolved on 2026-07-23).
- **Users.jsx test suite** — 5 previously-failing tests fixed and verified
  green (separate fix, already committed — see prior session).
- **Verified in code, resolving a doc conflict**: document attachments
  (`AttachmentUploader` — wired into `AccountsReceivable.jsx`), live bank
  feed (`bankFeedProviders.js` — wired into `Accounting.jsx`'s Bank Rec
  tab), and the Sage Intelligence live-Excel export (`liveExcel.js` — wired
  into `Accounting.jsx`'s header button) are all genuinely implemented and
  called from real UI, not just present in the codebase. The pre-launch
  checklist's "known gaps" list predates these — trust the features-built
  log on these three, not the checklist.

## 2. What YOU need to run — `007_security_hardening.sql`

In the Supabase SQL editor, against the live project
(`fxlejgzazgyudraqlxjv`): paste and run
`src/supabase/sql/007_security_hardening.sql`. The verification queries at
the bottom of the file confirm it took — 4 policy rows, 12 new indexes, and
either the unique index or a NOTICE telling you what's blocking it.

## 3. The sync-engine cutover (T2-2) — do this in order, don't skip the check

This is the other critical item, and the one with real sequencing risk if
done out of order — get this wrong and users briefly see an empty app, which
is worse than leaving it as-is a little longer. I have **not** touched
`.env` yet — the flag flip is one line, but it should only happen after
step 1 below comes back clean.

**Step 1 — confirm migrations 003–006 actually landed on the live project.**
Run this read-only check in the Supabase SQL editor:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN
  ('invoices','ar_receipts','payroll_runs','sales_orders','recurring_templates','attachments')
ORDER BY table_name;
-- Expect all 6 back. If any are missing, run the corresponding
-- 003_per_record_tables.sql / 005_round2_tables.sql file first.

SELECT tablename FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename = 'payroll_runs';
-- Expect 1 row. If empty, run 006_realtime_tables.sql.
```
Tell me what comes back and I'll flip the `.env` flag the same session —
it's a one-line change I can make in a few seconds once this is confirmed.

**Step 2 — flip the flag and redeploy.**
`VITE_USE_PER_RECORD_SYNC=true` in `.env`, then `npm run build && firebase
deploy` (matches how the 2026-07-23 fixes were shipped).

**Step 3 — backfill.**
The app already has a one-click tool for this — no script needed. Log in as
admin → **Settings → System tab** → "Copy all current data into the new
per-record Supabase tables." It's idempotent (safe to click more than once;
already-migrated rows are skipped, not duplicated) and reports per-table
counts. The per-record sync hook also auto-runs this once on first sign-in
after the flag is live, so step 3 may already be partly done by the time
you look — the button is there to confirm/retry.

**Step 4 — verify.**
Spot-check that a real invoice or payroll run shows the same numbers in the
app as in the `invoices` / `payroll_runs` tables directly in the Supabase
table editor. Once confirmed, the concurrent-save-overwrite risk (the actual
"hiccup" this whole exercise started from) is closed.

## 4. What's left that isn't a coding task

Two things from the pre-launch checklist that only you (and the accountant)
can actually do — see the parallel-run tracker
(`SLOT_ParallelRun_Tracker.xlsx`) built alongside this document:

- The 8 accountant observations (control accounts, vendor/client data
  quality, exchange rates, missing clients, AP name corrections) need a
  direct check-in to confirm **closed**, not assumed.
- A full parallel-run period (one month minimum) — both systems, reconciled
  weekly, explicit go/no-go date, rollback plan agreed before cutover, not
  after.

Until both of those are done, I'd treat this as: safe for daily use
alongside Sage as a second system you're validating, not yet safe as the
sole system of record with no fallback.
