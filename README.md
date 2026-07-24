# SLOT Engineering Nigeria Limited — ERP v1.2

React 19 + Vite · Supabase (PostgreSQL + RLS + Storage + Edge Functions) · localStorage offline-first

---

## Architecture

```
Browser
  ├── localStorage  ← always written first (instant, offline)
  └── Supabase      ← synced in background (real-time, cloud)
       ├── PostgreSQL  (per-record tables, see sql/003_per_record_tables.sql)
       ├── Storage     (private `scanner-docs` bucket for scanned documents)
       └── Edge Funcs  (notify — email/SMS/WhatsApp fan-out)

Offline queue: changes saved locally and auto-pushed on reconnect.
Real-time: cross-client changes stream in via Supabase postgres_changes.
```

## Audit-Driven Roadmap — Status (post v1.2)

The codebase was independently audited against Sage 200 Evolution. The audit
identified a Tier 1 / 2 / 3 fix roadmap. **All 12+ items from the audit are
now implemented or scaffolded**:

### Tier 1 — block before replacing Sage ✅

| Item | Status | Implementation |
|---|---|---|
| **Data architecture** (per-record writes) | ✅ Scaffold + migration | `supabase/sql/003_per_record_tables.sql`, `supabase/syncPerRecord.js` |
| **Real-time cross-client sync** | ✅ Live | `subscribeToChanges()` wired into `App.jsx` (was dead code pre-audit) |
| **Period / fiscal-year locking** | ✅ Live | `utils/periods.js`, Settings → Accounting → Period Close |
| **Year-end close** (closing entry) | ✅ Live | `buildYearEndClosingEntry()` posts to Retained Earnings |
| **SHA-256 → Supabase Auth default** | ✅ Already default path | `LoginScreen.jsx` tries Supabase first; legacy path is fallback |

### Tier 2 — before broad multi-user rollout ✅

| Item | Status | Implementation |
|---|---|---|
| Cost-centre / department tagging | ✅ Data field live | `jLine({ costCentre })`, payroll uses it |
| Bank statement CSV import + auto-match | ✅ Utility | `utils/bankRecImport.js` (heuristic: ref, amount, date, party) |
| DocScanner → Supabase Storage | ✅ Live | `supabase/storage.js` + bucket policy in `004_storage.sql` |
| CSP tightening (remove `unsafe-inline` for script-src) | ✅ Live | `vercel.json`, `firebase.json` |
| MFA (TOTP) scaffold | ✅ Scaffold | `utils/mfa.js` wraps `supabase.auth.mfa.*` |
| Account lockout (5/15min) | ✅ Live | `checkAccountLockout()` in `mfa.js` |

### Tier 3 — real but lower urgency ✅

| Item | Status | Implementation |
|---|---|---|
| 3-way PO/GRN/invoice match | ✅ Utility | `utils/threeWayMatch.js` (qty, price, amount, over-billing, over-receipt) |
| Multi-tier approval routing | ✅ Utility | `utils/approvalRouting.js` with configurable workflows |
| Notifications (email/SMS/WhatsApp) | ✅ Live | `utils/notifications.js` + `supabase/functions/notify/index.ts` |
| CI/CD with GitHub Actions | ✅ Live | `.github/workflows/ci.yml`, `deploy.yml`, `dependabot.yml` |
| Code-splitting per module | ✅ Live | `App.jsx` lazy-imports every module; initial bundle **153KB / 46KB gz** (down from 917KB) |
| ESLint cleanup | ⚠ Partial | 247 pre-existing issues; new code is clean |
| SLOT ERP label in exports | ✅ Fixed | `SLOT_BRAND` in all export/UI surfaces |

### Strategic decision — needs client input

| Item | Status | Implementation |
|---|---|---|
| **Inventory: equipment register vs stock/warehouse** | ⚠ Dual-model scaffolded | `utils/inventoryModel.js` provides FIFO + WAvg costing + movement types; `Inventory.jsx` (equipment) continues to work. **Need client decision** on which interpretation is the primary requirement. |

---

## Modules

`Dashboard · Contract Staff · Company Staff · Procurement · Terminal Ops ·
Fleet Maintenance · Accounting · AP · AR · Project P&L · Petty Cash ·
Requests · Approvals · Analytics · Users · Settings · Backup · Fixed Assets ·
Inventory`

All modules are **lazy-loaded** — each gets its own bundle and loads on
first navigation.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build to `dist/` |
| `npm run test` | Vitest run (single-fork, 15s timeout) |
| `npm run lint` | ESLint |
| `npm run preview` | Preview built bundle locally |

## Environment

Copy `.env.example` to `.env` and fill in:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_COMPANY_DOC=slot-engineering-nigeria
VITE_STORAGE_PREFIX=bc_
VITE_SENTRY_DSN=                              # optional
```

## Supabase setup

Run the SQL migrations in order, in the Supabase SQL editor:

1. `src/supabase/sql/001_schema.sql` — base `app_users` table + admin seed
2. `src/supabase/sql/002_rls.sql` — RLS policies (company-scoped) + privilege-escalation guard trigger
3. `src/supabase/sql/003_per_record_tables.sql` — per-record tables (the Tier-1 fix) + activity-log user-stamping trigger
4. `src/supabase/sql/004_storage.sql` — `scanner-docs` private bucket
5. `src/supabase/sql/005_round2_tables.sql` — BoLs, terminal advances, stock items/movements, sales orders, recurring journals, app_settings, attachments
6. `src/supabase/sql/006_realtime_tables.sql` — adds per-record tables to the `supabase_realtime` publication (without this, cross-device live sync is silently a no-op)

> **Important:** Skipping 005 or 006 silently breaks Sales Orders, Terminal BoLs/advances, Stock, Recurring Journals, App Settings, Attachments, AND realtime. Run all six in order.

Deploy the notification Edge Function:
```bash
supabase functions deploy notify --no-verify-jwt
supabase secrets set SENDGRID_API_KEY=... TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=...
```

## CI/CD

- `.github/workflows/ci.yml` — lint + test + build on every push
- `.github/workflows/deploy.yml` — deploy to Vercel on main
- `.github/dependabot.yml` — weekly dependency updates

## Test

13 Vitest tests across 7 files. Tests mount real modules together (not mocks)
to catch integration bugs like the Terminal Ops "Post to Accounting" silent
failure that was found and fixed in the v1.1.0 commit.

```bash
npm test
```

## License

Internal — SLOT Engineering Nigeria Limited
