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

## 5. Follow-up — same day, after connecting live database access

- `007_security_hardening.sql` ran successfully against the live project.
  Role-gated RLS on `payroll_runs`/`journal_entries`, all 12 indexes, and the
  `app_users` email unique constraint are live and verified — zero duplicate
  emails, so the constraint applied cleanly with no manual cleanup needed.
- Migrations 003–006 confirmed landed on the live project: all 6 tables the
  sync cutover needs exist, and all 18 tables from 006 are in the realtime
  publication. They're empty (0 rows) — expected, the flag hasn't flipped yet
  so no backfill has run. **Step 1 of the sync cutover (section 3) is now
  confirmed clean** — the flag flip is unblocked whenever you're ready for
  Step 2.
- New finding, live-database-only (the 2026-07-23 audit read code, not the
  database, so this couldn't have shown up there): `company_data` — the
  legacy blob table the app is actually running on right now — had a
  leftover **"Allow all"** policy sitting alongside the correct restrictive
  ones from `002_rls.sql`. A one-word naming mismatch (`"Allow all for now"`
  vs. the live `"Allow all"`) meant the old draft policy was never actually
  dropped, and it silently overrode the real protection ever since. Anyone
  holding the anon key — which is meant to be public, that part's normal —
  could read and write the entire company_data row directly, bypassing the
  app and every role check in it. Fixed and verified:
  `008_rls_gap_and_search_path.sql` ran against the live project — confirmed
  `company_data` now has exactly the 2 correct policies (the leftover is
  gone), all 5 functions have `search_path` pinned, and a fresh security
  advisor scan no longer flags either issue.
- Informational, no action needed: `company_records`, a 472-row table live
  in the database that nothing in the current codebase references — looks
  like leftover data from an earlier design iteration, not something live
  code touches today.
- `009_flexible_user_roles.sql` — custom roles defined in Settings →
  Permissions can now actually be assigned to a user (the UI already
  offered them; a database CHECK constraint was silently rejecting the
  save). Applied and verified live with a rolled-back test transaction.
- **Sync cutover, Step 2 done, Step 3-4 next.** Users were seeing frequent
  "someone else updated this data" / "reload and re-apply your change"
  messages on login — confirmed in code (`App.jsx`) that this is the legacy
  single-shared-document engine working as designed, not a bug: every
  action (even just logging in) autosaves one shared row, and every session
  is subscribed to every other session's saves, so it only gets noisier with
  more concurrent users. `VITE_USE_PER_RECORD_SYNC=true` is now set in
  `.env`, and `npm run build` was verified clean in a sandbox copy (2401
  modules, 0 errors, 8.1s). **You still need to run `npm run build &&
  firebase deploy` yourself** — no Firebase credentials in my sandbox, same
  as every prior deploy this project. After that: Settings → System →
  "Copy all current data into the new per-record Supabase tables" (Step 3,
  one click, safe to run more than once), then spot-check a real invoice or
  payroll run against the Supabase table editor directly (Step 4).
