# SLOT ERP Pre-Launch Checklist

Purpose: a concrete path from "genuinely impressive progress" to "safe to trust with real financials" — not a list of vague worries, but specific things to check, in order.

---

## 1. Security — verify TODAY, before any real data goes near this

- [ ] **Confirm RLS is actually enabled on the live database**, not just written in the SQL file. Run this in the Supabase SQL editor:
  ```sql
  SELECT tablename, rowsecurity, forcerowsecurity
  FROM pg_tables WHERE tablename IN ('company_data','app_users');
  ```
  Both `rowsecurity` and `forcerowsecurity` must show `true` for both rows. If either shows `false`, run `002_rls.sql` now — this is the single highest-priority item on this whole list.
- [ ] Confirm all 6 policies exist: `SELECT policyname, tablename FROM pg_policies WHERE tablename IN ('company_data','app_users');` should return 6 rows.
- [ ] Test the anti-privilege-escalation trigger directly: log in as a genuine non-admin test user and confirm they cannot edit their own role or another user's account — test at the API level (browser dev tools / a direct request), not just by checking the button is hidden in the UI.
- [ ] Confirm every real user who'll log in on day one has a proper Supabase Auth account — no leftover local-only credentials from before the auth rewrite.
- [ ] Double check the deployed `.env` points at the production Supabase project, not a dev/test one.

## 2. Confirm this session's fixes are actually deployed

- [ ] Build + deploy the wipe fix. Test by wiping in a non-production session and confirming **every** module — Fleet, Petty Cash, Requests, Sales, AR, Accounting, and the clients/vendors/projects lists — shows genuinely empty, not demo data.
- [ ] Build + deploy the sync conflict-race fix (no separate manual test needed — covered by the existing test suite).
- [ ] Confirm the accountant's eight open observations from earlier work are actually **closed**, not "in progress": control accounts, vendor/client data quality, exchange rates, missing clients, AP name corrections. Worth a direct check-in with them rather than assuming.

## 3. Parallel-run plan

- [ ] Pick a period — one full month minimum, a full quarter if SLOT's reporting rhythm allows it.
- [ ] Enter every real transaction in **both** SLOT ERP and whatever SLOT uses today for the entire period.
- [ ] Reconcile **weekly**, not just at the end — catching a discrepancy after 3 days is cheap; catching it after 30 is not.
- [ ] Name who does the reconciliation and block real time on their calendar for it.
- [ ] Set an explicit go/no-go review date. Don't let this quietly drift into "we'll switch over eventually."

## 4. What the accountant should reconcile first (newest + highest-stakes for reported numbers)

1. **Depreciation postings** — walk one full month for a representative sample of fixed assets; confirm correct amounts hit the correct GL accounts.
2. **FX revaluation at period end** — given SLOT invoices in NGN/USD/EUR/GBP, hand-check unrealized gain/loss on 2–3 real foreign-currency balances against SLOT ERP's output.
3. **Credit limit overrides** — confirm every override actually appears in the activity log with correct user attribution.
4. **Terminal Ops** (standalone P&L/BS, advance payments, BoL-as-parent) — this is brand-new code; walk one full container/BoL lifecycle start to finish.
5. **Control accounts** (2001–2005, 6002, 7001) — cross-check against the equivalent for the same period in the current system.
6. **Trial balance + AR/AP aging** — the fundamental check: does it balance, and does it match the current system for identical transactions?

## 5. Known gaps SLOT should know about going in (not blockers, just expectations)

- No recurring/template journals yet — manual re-entry each period
- No document attachments
- No live bank feed (import/auto-match works; it's not automatic)
- No live Excel / Sage-Intelligence-style export integration

## 6. Rollback plan

- [ ] Keep the current system untouched and available for at least one full period after cutover.
- [ ] Agree in writing who can trigger a rollback and under what condition (e.g., "trial balance doesn't tie out within [X] for two consecutive weeks").

## Go-live criteria — all of these, not most of these

- [ ] Section 1 fully checked (RLS confirmed enabled + forced, both tables)
- [ ] All eight accountant observations confirmed closed
- [ ] One full parallel-run period completed, numbers reconciled or discrepancies explained
- [ ] Accountant has signed off specifically on Section 4
- [ ] Rollback plan agreed before cutover, not after
