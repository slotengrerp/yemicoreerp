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
- **Incident: crash-loop on deploy, same day.** Immediately after deploying
  the Step 2 flag flip, the app went into an infinite reload loop for
  anyone already signed in. Root cause: `usePerRecordSync.js`'s auth-change
  handler reloaded the page on every event with no filtering, including a
  synthetic replay that fires immediately whenever a session already
  exists — and since the session survives a reload, it fired again on the
  very next load, forever. This was a pre-existing bug, never exercised
  before because the flag had never been on in production before. **Emergency
  response:** `.env` flag reverted to `false` right away — this alone
  restores service, independent of any code fix, since the buggy code path
  only runs when the flag is on. **Real fix:** committed
  (`e30b93e`) — the handler now only reloads on a genuine new sign-in.
  Build verified clean with the flag back on. **Not re-enabling the flag
  again without an explicit go-ahead this time** — a clean build alone
  gave false confidence last time; it can't catch a runtime-only bug like
  this one.
- **Resolved.** Added a regression test that reproduces the exact bug
  (verified it fails against the old code, passes against the fix — see
  `src/hooks/__tests__/usePerRecordSync.test.jsx`), full suite still green
  (12 files, 24 tests). Local test (flag on, `npm run dev`): logged in,
  used nearly every module, left it running — no reload loop, no false
  conflict messages. Cleared for production deploy. Next: `npm run build
  && firebase deploy`, then Step 3 (Settings → System → backfill button)
  and Step 4 (spot-check a real record against the Supabase table editor).
- **Second backfill bug, same day: `voided` column missing on vendors/
  clients/projects.** Those three are master data (standing entities, not
  transactions) — deliberately built without a `voided` column in
  `003_per_record_tables.sql`. But `saveRecord()`, `loadAll()`, and
  `backfillFromBlob()` in `syncPerRecord.js` sent/selected `voided`
  unconditionally for every table. Fixed by gating on a `NO_VOID_TABLES`
  set — see `src/supabase/sql` comments and the regression test at
  `src/supabase/__tests__/syncPerRecord.voided.test.js` (verified it fails
  against the old code, passes against the fix).
- **Third backfill bug, same day: `id` column type wrong on ~20 tables.**
  After the `voided` fix, vendors/clients/projects failed again with
  `invalid input syntax for type uuid: "v001"`. Checked the whole app's id
  generation: nothing anywhere produces UUIDs — seed/legacy data uses short
  human ids (v001, inv1...), everything created through the UI uses
  `generateId()` (a base-36 string), and journal entries use deterministic
  prefixed ids (`JE-AR-INV-{id}`) that the GL's duplicate-post guard
  depends on. Every per-record table was built with `id UUID` regardless.
  vendors/clients/projects only hit it first because they're the only
  tables with real pre-loaded data this early — every other table would
  have hit the identical error the first time a real invoice, sales order,
  or journal entry was saved. Fixed with
  `010_fix_record_id_column_types.sql` — changed `id` to `TEXT` on all 20
  affected tables in one migration, applied and verified live (`activity`
  correctly left as `uuid`, it's the one table that never gets an
  app-supplied id). No app code changes needed for this one — the code was
  always sending the right values.
- **Folder/shell access dropped mid-session, same day.** Bash lost its
  mount partway through debugging the `voided` fix; file edits kept
  working throughout (this doc and every code fix after that point were
  still written directly), but build/test/git commands needed the folder
  reconnected and the app restarted to fully recover.
- **Fourth bug, same day: the legacy sync engine was never actually
  disabled.** After a clean backfill, the old conflict/"Live data updated
  from another session" messages kept appearing exactly as before, plus a
  new symptom — the app periodically going blank for a few seconds and
  recovering. Root cause: three places in `App.jsx` — the boot-time
  `syncCloud()` call, the legacy realtime subscription, and the
  auto-save-to-cloud effect — never actually checked
  `VITE_USE_PER_RECORD_SYNC`. `usePerRecordSync.js`'s own header comment
  claims "the legacy whole-document sync is bypassed" once the flag is on,
  but nothing enforced that; both engines were running at once. The legacy
  realtime handler also unconditionally replaced `state.db` wholesale on
  every remote change, racing against the per-record engine's own
  narrower updates — almost certainly the cause of the periodic blanking.
  Fixed by gating all three on `!USE_PER_RECORD`, so the legacy engine now
  actually turns off when the per-record engine is on, matching what the
  comment always claimed. Build verified clean and the full test suite
  (13 files, 27 tests) still green in a sandbox copy — a local test (like
  the crash-loop fix) is the next step before redeploying, and this one
  still needs to be committed to git once folder/shell access is back.
- **Fifth bug, same day: fix #4 above introduced a real regression —
  "cloud" status got stuck permanently off.** After testing fix #4
  locally, the pop-ups were gone (confirmed working) but two new symptoms
  showed up: the sidebar/topbar cloud badge stuck on "Local only" /
  "Connecting…", and Settings changes silently stopped reaching the cloud.
  Root cause: `dispatch({type:'SET_CLOUD', payload:true})` — the one line
  in the whole app that marks the cloud connection ready — lives *inside*
  the legacy `syncCloud()` function. Fix #4 wrapped the entire call to
  `syncCloud()` in `if (!USE_PER_RECORD)`, so that dispatch stopped firing
  at all once the per-record engine was on, and `cloudReady` was
  permanently stuck at its default `false`. This wasn't just cosmetic:
  Settings.jsx gates every cloud save on `if (cloudReady) saveSettingsCloud(...)`
  — so with `cloudReady` stuck false, changes in Settings (including
  custom role definitions) were saving locally only, silently, with no
  error. Fixed by dispatching `SET_CLOUD:true` directly in the `else`
  branch — per-record mode doesn't need the legacy blob round-trip to know
  the cloud connection is up, Phase 1 of boot already confirms a live
  session by that point. Verified in a sandbox copy: clean build, and the
  two directly-relevant regression test files plus 3 other component test
  files (10 tests) all still green. Still needs: your local test (confirm
  the cloud badge shows "Live"/"Cloud Synced" and a Settings change
  actually appears in Supabase), then a git commit once folder/shell
  access is back.
- **Separately noticed, not yet fixed — needs your go-ahead:** Settings
  saves still write to the legacy `company_data.settings` blob
  (`saveSettingsCloud`), but the per-record engine's startup load reads
  settings from the new `app_settings` table (`loadAppSettings`). These
  are two different tables. Net effect: a Settings change (e.g. a new
  custom role) saves fine and works immediately on the device that made
  it, but won't show up for a *different* device/session until someone
  wires the write side to the new table too. Not urgent — nothing crashes,
  and this predates today's bugs — but worth closing before multiple
  admins are actively managing roles/settings day to day.
- **Sixth bug, same day: "the app refreshes itself" on every browser tab
  switch — real root cause found and fixed.** Precise repro from testing:
  switch to another browser tab and back within a minute, and the app
  reloads — every single time, no cooldown, confirmed by clicking back and
  forth 10 times in 1 minute. Root cause: this is documented, longstanding
  `supabase-js` behavior, not a bug specific to this app — the Supabase
  client attaches its own tab-visibility listener and re-validates the
  session every time the tab regains focus, and genuinely fires a real
  `SIGNED_IN` event even when nothing changed (same user, same session).
  See supabase/supabase-js#716, #1618, #1708 and supabase/supabase#7250.
  The crash-loop fix earlier today (filtering to `event === 'SIGNED_IN'`)
  was necessary but not sufficient — it correctly told apart the synthetic
  replay from a real event, but had no way to tell a real-but-harmless
  refire apart from a real-and-genuine new sign-in, since both are the
  same event name. Fixed in `usePerRecordSync.js` by tracking the
  last-seen signed-in user id and only reloading when it actually changes
  (a genuine new or different sign-in) — a same-user refire is now
  ignored. Two new regression tests added (one per scenario) alongside the
  existing crash-loop test; confirmed the new "ignore same-user refire"
  test fails against the old code (reloaded 3 times, matching the
  "10 times in 1 minute" report) and passes against the fix. Full local
  suite (4 files touched by today's changes, 11 tests) green, build clean.
  Still needs: your local test (switch tabs several times, confirm no
  reload), then a git commit once folder/shell access is back.
