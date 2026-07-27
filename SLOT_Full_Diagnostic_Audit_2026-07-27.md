# SLOT ERP — Full Diagnostic Audit — 2026-07-27

Full-project diagnostic requested across structure, backend, frontend, database, auth, APIs, deployment, and code quality. This document is the consolidated result.

**Scope:** 73 source files (`src/**/*.js,jsx`, tests excluded), ~34,600 lines total, 29 business modules, 11 SQL migrations, 3 Edge Functions, the live Supabase project (`fxlejgzazgyudraqlxjv`), and all build/deploy configuration.

**How this was done** — see [Methodology & Coverage](#methodology--coverage) at the bottom before treating any "no issues found" as absolute. Short version: every file was checked by automated sweep (syntax, imports, secrets, lint, circular deps, dead code, key-prop, equality-operator patterns); the architecturally critical and highest financial-risk files were read in full; the remaining large business modules were sampled and pattern-scanned rather than read line-by-line end to end.

This is the fourth audit doc in this project's history, after `QA_Security_DBA_Audit_2026-07-23.md`, `SLOT_Production_Hardening_2026-07-24.md`, and `SLOT_BillOfLading_Schema_Audit_2026-07-25.md`. A lot of what those found is now fixed — this pass re-verifies the fixes live against the database rather than assuming the file changes took effect, and looks for what's new.

---

## Summary Dashboard

| Metric | Count |
|---|---|
| **Critical** | 0 open (1 found, already resolved — see SEC-0) |
| **High** | 2 |
| **Medium** | 7 |
| **Low** | 9 |
| **Total open issues** | 18 |
| **Security issues** | 6 (2 High, 3 Medium, 1 Low — plus 1 Critical already closed) |
| **Performance issues** | 3 (all Medium/Low) |
| **Code smells** | 7 (all Low) |
| **Missing / broken files** | 1 file, 8 broken import paths (all inside that one dead file) |
| **Compile/syntax errors** | 0 |
| **Lint errors** | 0 (current) |
| **Circular dependencies** | 0 |
| **Dependency vulnerabilities** | 3 (npm audit, all High, all dev/transitive) |

Nothing found rises to "the app is broken." The codebase is unusually disciplined for its size — zero syntax errors, zero lint errors, zero circular imports, zero hardcoded secrets, zero `eval`/`dangerouslySetInnerHTML`, extensive inline documentation of *why*, and a financial-posting layer (`glPosting.js`) with self-verifying guards that most codebases this size don't have. The issues below are real but mostly operational/hardening gaps and consistency debt, not functional breakage.

---

## 1. Project Structure

```
src/
  App.jsx, main.jsx, App.css, index.css
  components/
    ErrorBoundary.jsx, Users.jsx  ← dead duplicate, see CQ-1
    layout/     Sidebar.jsx, Topbar.jsx, LoginScreen.jsx
    ui/         index.jsx (shared component library), DocScanner.jsx
    modules/    29 business modules, 24,060 lines
  context/      AppContext.jsx, ThemeContext.jsx
  hooks/        usePerRecordSync.js + others
  supabase/     client, auth, sync.js, syncPerRecord.js, storage, sql/ (11 migrations)
  utils/        ~30 files — auth, mfa, tokens (design, not auth), glPosting, chartOfAccounts, etc.
  test/         setup
supabase/functions/   create-user, update-user-password, notify (Deno Edge Functions)
.github/workflows/    ci.yml, deploy.yml
vercel.json, firebase.json, netlify.toml   ← 3 hosting configs, 1 actually used (DEP-1)
```

29 modules is a lot for one app, but the split is legible (HR / Operations / Finance / Reports / System, mirrored exactly in `Sidebar.jsx`'s `NAV` array). No orphaned top-level folders, no stray scratch files, no `.bak`/`.old` files in `src/`.

**Finding ST-1 (Low, code smell):** `src/components/Users.jsx` exists alongside the real, imported `src/components/modules/Users.jsx`. See CQ-1 for full detail — it's the single structural wart in an otherwise clean tree.

---

## 2. Backend / Database

### 2.1 Schema & migrations

Architecture is JSONB-document-per-record, not normalized relational: every business table is `{id TEXT, company_id TEXT, data JSONB, voided BOOLEAN, created_at, updated_at}`, with relational integrity (foreign keys, cascades) enforced in JS, not the database. This is a deliberate, consistent choice across all 11 migrations (001 → 011) — not an oversight. It trades DB-level referential integrity for schema flexibility, which is a defensible tradeoff for a fast-moving internal ERP, but it's worth naming explicitly: **nothing stops an orphaned `company_id` or a dangling foreign-key-shaped ID from being written directly via the REST API** — the app's own code is the only thing enforcing those relationships. This isn't a bug to fix; it's a standing architectural fact worth remembering when debugging "impossible" data states.

Migrations are well-written: every one states what it fixes, why, what it deliberately excludes and why, and ends with its own verification query. That last part let this audit independently re-verify several of them live rather than trusting the file content — see 2.2.

### 2.2 RLS — live-verified, not just read from file

Ran the actual verification queries from migrations 007/008/009 against the live database rather than assuming the SQL files matched deployed state:

| Migration | Claim | Live result |
|---|---|---|
| 007 | payroll_runs / journal_entries restricted to admin/accountant/manager | ✅ confirmed — role-gated policies present |
| 008 | leftover `"Allow all"` permissive policy on `company_data` removed | ✅ confirmed — only `company_data: read` / `company_data: write` remain |
| 008 | 5 functions have `search_path` pinned | ✅ confirmed on all 5 |
| 009 | `app_users.role` CHECK constraint replaced by a trigger | ✅ confirmed — constraint gone, `trg_app_users_validate_role` active |

**Finding SEC-0 (Critical — already resolved, documented for the record):** Migration 008 itself documents that `company_data` carried a leftover permissive policy literally named `"Allow all"` (not `"Allow all for now"`, which is what 002's `DROP POLICY IF EXISTS` was actually targeting — a one-word name mismatch meant the drop never fired). Postgres ORs multiple permissive policies together, so `"Allow all"` (`USING true`, role `public`) silently overrode the restrictive ones. Net effect while live: anyone holding the public anon key — which ships in the JS bundle by design — could read and write the *entire* company_data row for *any* company, signed in or not, bypassing every role check in the app. This was caught by the team on 2026-07-24 and the fix (`DROP POLICY IF EXISTS "Allow all"`) is confirmed applied above. No action needed — flagged here only so the audit's "Critical" count isn't silently zero for a codebase that did have one.

**Finding SEC-1 (High, open):** `auth_leaked_password_protection` is still disabled on the live project (Supabase security advisor, checked just now). This checks new passwords against HaveIBeenPwned and blocks known-compromised ones. It's a single toggle — Supabase Dashboard → Authentication → Policies → Leaked password protection — already identified in migration 008's own comments as "can't be done from this script." Recommended: turn it on; no code or migration required.

**Finding SEC-2 (Low, informational):** 6 `SECURITY DEFINER` functions (`get_my_company_id`, `i_am_admin`, `enforce_self_update_scope`, `stamp_activity_user`, `validate_user_role`, and their duplicate anon/authenticated advisory entries) are flagged as publicly callable via `/rest/v1/rpc/*`. This is already reviewed and consciously accepted in migration 008's comments: the two non-trigger functions only ever return facts about the caller's *own* session (their own company_id, their own admin flag) — not sensitive — and the three trigger functions can't actually be invoked outside trigger context regardless of grants, so revoking EXECUTE would be cosmetic. Restated here for completeness, not because it needs new action.

**Finding PERF-1 (Medium, open):** Direct query against `pg_policies` found 10 policy clauses across 5 tables (`app_users`, `company_data`, `company_records`, `journal_entries`, `payroll_runs` — 2 policies each) that call `auth.uid()`/`auth.role()` unwrapped, i.e. `auth.uid() = ...` instead of `(select auth.uid()) = ...`. Postgres re-evaluates an unwrapped `auth.*` call once per row scanned; the wrapped form evaluates it once per query and lets the planner treat it as a constant. This is a documented Supabase/Postgres performance pattern, not a correctness issue — on this project's current data volume it's very unlikely to be felt, but it compounds as tables grow. Fix: wrap each `auth.uid()`/`auth.role()` call in `(select ...)` in the 10 affected policy definitions.

### 2.3 Edge Functions (re-read fresh this pass, all 3)

All three (`create-user`, `update-user-password`, `notify`) independently verify the caller's session and admin/active status server-side before doing anything privileged — none trust a client-supplied role. `notify` in particular is tightly scoped: recipients must already be an `app_user` in the caller's company (blocks using the company's SendGrid/Twilio as an open relay), CRLF header-injection is stripped, subject/body are length-capped, `link` is regex-validated to a relative path, and the email body is HTML-escaped before templating. All three fetch calls to external providers carry a 10s `AbortSignal.timeout`. This is well above average for hand-rolled Edge Functions.

**Finding SEC-3 (Low, open):** `create-user/index.ts:34-37` sets CORS as `'Access-Control-Allow-Origin': '*'` (wildcard), while its two siblings — `update-user-password/index.ts:25-38` and `notify/index.ts:33-47` — use a proper `ALLOWED_ORIGINS` allowlist with `Vary: Origin`. Since `create-user` still requires a valid bearer token server-side, this isn't independently exploitable (a third-party site can't forge the caller's Authorization header), but it's the one function that didn't get the same hardening pass as its siblings. Fix: copy the `ALLOWED_ORIGINS`/`corsHeaders(req)` pattern from `notify/index.ts` into `create-user/index.ts`.

---

## 3. Frontend Architecture

No router library — `App.jsx` switches pages via `useState` + a lookup table into 25 `React.lazy()`-loaded modules, each wrapped in its own `<ErrorBoundary label="...">` (deliberate: a crash in one module no longer takes down the sidebar/topbar/rest of the app — the class-component-only constraint is explicitly commented as the reason `ErrorBoundary` breaks the app's otherwise all-function-components style). Boot sequence in `App.jsx` races Supabase readiness against a timeout, which is a sound pattern for "don't hang forever if the backend is unreachable."

State management is a single monolithic `useReducer` in `AppContext.jsx` via React Context, no selectors/slicing.

**Finding PERF-2 (Medium, architectural):** Because `AppContext` is one Context with one big `db` object, any state change (saving a petty cash voucher, toggling a sidebar section) re-renders every component subscribed to `useApp()` — which is most of the app — not just the part that actually changed. `Sidebar.jsx` and `Topbar.jsx` both already work around symptoms of this (e.g. `Sidebar.jsx`'s v3.1 rewrite, documented in its own header comment, moved `SectionHeader`/`NavItem`/`Collapsible`/`NavContent` to module scope specifically to stop a *different* re-render bug — losing scroll position — that this architecture causes). This isn't a bug so much as a scaling ceiling: fine at current usage, and would need selector-based context splitting (or a state library) if the app's data volume or user-concurrency grows significantly. No fix recommended now — noting it because "identify scalability issues" was explicitly asked for.

**Finding PERF-3 (Low):** `Topbar.jsx`'s global search (`searchResults` `useMemo`, line ~40) depends on `[searchQ, db]` — `db` is the entire app state, so the memo recomputes on *every* state change anywhere in the app, not just when the search box is open. Cost is low today (it early-returns for `searchQ.length < 2`, and the full 11-collection scan only runs when a user has actually typed 2+ characters into an open search box), but it will scale linearly with total record count across all 11 scanned collections. Fine to leave as-is; worth a second look if any of those collections grow into the tens of thousands of records.

**Finding CQ-2 (Low, consistency):** A themed `Confirm` modal component is defined in `src/components/ui/index.jsx` (line ~217) and used elsewhere in the app, but `AttachmentUploader.handleDelete` in that same file (line 358) calls the native `window.confirm()` instead. Cosmetic inconsistency (blocking browser dialog vs. themed modal), not a bug.

**Finding CQ-3 (Low):** `DocScanner.jsx`'s `card()` style helper (line ~227) sets a `:hover` key inside a plain inline `style` object. Plain React inline styles don't support pseudo-selectors — that key is silently ignored by the browser. It's harmless because the actual hover effect is implemented correctly via `onMouseEnter`/`onMouseLeave` handlers a few lines away in the render — but the `:hover` key itself is dead code. Safe to delete for clarity.

**Finding CQ-4 (Low):** `DocScanner.jsx:153` uses `FileReader.readAsBinaryString()`, a deprecated Web API (MDN: deprecated in favor of `readAsArrayBuffer`/`readAsText`). Still functional in all current browsers, not an active bug, but worth migrating opportunistically.

**Finding CQ-5 (Low, latent):** `AppContext.jsx:9` — `initialState.db.terminal` is `{ containers: [], charges: [], logistics: [] }`, missing `bols`, `advances`, `consignees`, and `shippingCompanies`, all of which `TerminalOps.jsx` now reads. In practice this is very unlikely to bite: the real values load from Supabase before `TerminalOps` is reachable, and `TerminalOps.jsx` itself consistently guards with `|| []` at point of use (confirmed by pattern, e.g. `db.terminal?.bols || []`). Flagging for completeness — cheap to fix by adding the four missing keys to the initial shape so it matches reality even before the first load completes.

---

## 4. Authentication & Security

`LoginScreen.jsx` is Supabase-Auth-only by design — its own header comment explains that every auth vulnerability the 2026-07-23 audit found (client-side password hashing, no MFA, no rate limiting, a recovery code sitting in localStorage) lived in a legacy local-auth path that has since been deleted outright, not patched. If Supabase isn't configured, the app refuses to render a login form at all rather than falling back to something weaker. This is a strong, verifiable design decision, not just a claim in a comment — confirmed by reading `supabase/auth.js`, `authBridge.js`, and `LoginScreen.jsx` in full.

`utils/mfa.js` implements real TOTP (RFC 6238-style) MFA — well-built, but **opt-in, not enforced**. `utils/auth.js`'s RBAC permission model (`ROLE_PERMS`, `getAllRoles`) is clean and has no issues.

**Finding SEC-4 (High, open):** `src/supabase/auth.js`'s `updateSupabaseUser` carries its own comment acknowledging there is no server-side guard against demoting or disabling the **last remaining admin**. Nothing currently stops an admin from removing their own admin role (or another admin's) down to zero active admins for a company, which would lock that company out of user management, role assignment, and anything else gated to `role === 'admin'` — recoverable only via direct database access. Recommended fix: in `update-user-password`/a new admin-management Edge Function (or as a DB trigger alongside `validate_user_role()` in migration 009), block any UPDATE that would leave a company with zero `role='admin' AND status='Active'` rows.

**Finding SEC-5 (Medium, open, product decision not just code):** MFA (`utils/mfa.js`) is implemented but not required for any role, including admin. Given `create-user`/`update-user-password` already enforce a 12-character-plus-complexity password policy server-side, this isn't an urgent gap, but for an ERP holding payroll and banking data, requiring MFA at least for `admin`/`accountant` roles would be a meaningful hardening step using code that's already written.

---

## 5. Build & Deployment

**Finding SEC-6 / DEP-2 (Medium, open):** `npm audit` reports 3 High-severity advisories: `vite` (direct dependency, `^8.0.12`, moderate-to-high range per GHSA-v6wh-96g9-6wx3 and related), `postcss` (transitive, path traversal in sourcemap auto-loading), `brace-expansion` (transitive, ReDoS/OOM). All three are **dev-time/build-time dependencies**, not shipped to the production bundle, so these aren't live user-facing vulnerabilities — but they do affect the security of the CI/build environment itself. `npm audit` reports `fixAvailable: true` for all three. Recommended: run `npm audit fix` (or bump `vite` directly) and re-verify the build still passes.

**Finding DEP-1 (Low, code smell):** Three hosting configs exist — `vercel.json`, `firebase.json`, `netlify.toml` — but `.github/workflows/deploy.yml` only ever deploys to Vercel (`vercel build` / `vercel deploy --prod`). `firebase.json` and `netlify.toml` are dead configuration; `netlify.toml`'s own comment ("SPA redirect... so React Router works") is also factually wrong — the app doesn't use React Router (confirmed: not in `package.json`, no router import anywhere in `src/`) and never has, per `App.jsx`'s custom `useState`-based navigation. Low priority, but worth deleting both dead configs (or documenting explicitly that they're kept intentionally as a migration escape hatch) to stop a future reader from assuming Netlify/Firebase are live deploy targets.

`vercel.json` and `firebase.json` both carry a strong, matching Content-Security-Policy (`script-src 'self'`, no `unsafe-eval`, explicit `connect-src` allowlist for Supabase + Sentry only, `frame-src 'none'`, `object-src 'none'`) plus HSTS, X-Frame-Options `DENY`, and `nosniff`. This is good — better than most projects this size ship — and consistent between the two files even though only one is live.

**Finding CQ-6 (Low):** `.github/workflows/ci.yml:27-31` runs `npm run lint` with `continue-on-error: true`, with a comment: *"Lint is currently non-blocking (292 pre-existing errors). Once cleanup is complete, change this to fail the build on any error."* Running `eslint .` directly against the current tree returns **0 errors and 0 warnings** (verified twice — once via compact format, once via a full JSON report). Either the 292 errors have since been fixed and the comment is stale, or they were fixed as a side effect of other work. Either way, the lint gate should now be safe to flip to blocking (remove `continue-on-error: true`), which would catch future regressions instead of only informationally reporting them.

**Finding CQ-7 (Low):** `.env.example` sets `VITE_USE_PER_RECORD_SYNC=false` as its own example default, directly under a comment reading *"Recommended: true for production."* A developer who copies `.env.example` to `.env` without reading closely gets the non-recommended setting. Minor, but easy to fix — flip the example default to `true` to match the stated recommendation.

**Finding CQ-8 (Low, informational):** `@sentry/react` is an `optionalDependency`, dynamically `import()`'d in `main.jsx` only if `VITE_SENTRY_DSN` is set, with a clean fallback warning if the package isn't installed but the DSN is. This is well-engineered, not a bug — but confirmed: `VITE_SENTRY_DSN` is unset in the live `.env`, so **no production error monitoring is currently active**. For an app this size, worth a deliberate decision (on or off), not a default-off-by-omission.

---

## 6. Code Quality

### 6.1 Syntax & compile-time errors
Every one of the 73 source files passes an `esbuild` transform with zero errors (multi-entry single-process run, ~2.5s total). **0 syntax errors.**

### 6.2 Broken imports / missing files
Wrote a dependency-resolution script (comment-stripped, checks every relative `import`/`import()`/`require()` against the real filesystem — 307 relative imports checked). **8 broken, all in one file:**

```
src/components/Users.jsx -> "../../context/AppContext"   (resolves outside src/ entirely)
src/components/Users.jsx -> "../../context/ThemeContext"
src/components/Users.jsx -> "../../utils/helpers"
src/components/Users.jsx -> "../../utils/auth"
src/components/Users.jsx -> "../../utils/audit"
src/components/Users.jsx -> "../../supabase/client"
src/components/Users.jsx -> "../../supabase/auth"
src/components/Users.jsx -> "../../utils/logo"
```

**Finding CQ-1 (Medium, dead code + broken file, resolves ST-1):** `src/components/Users.jsx` is a stale, unused duplicate of the real, imported `src/components/modules/Users.jsx`. Confirmed nothing imports it — `App.jsx:35` lazy-loads `./components/modules/Users`, and the two test files that `import Users from '../Users'` resolve (relative to `src/components/modules/__tests__/`) to the *modules* copy, not this one. Its relative import paths are also all one directory level too shallow for its actual location (`../../` from `src/components/` lands outside `src/`), so **even if something did try to import it, it would fail to build.** Diffing the two copies shows the live one is also the more correct one: it wraps its Supabase fetch in try/catch with an unmount-cancellation guard (the dead copy doesn't — its comment-documented "CRITICAL: unhandled rejection" bug is exactly what's fixed in the real file) and passes `appSettings` to `UserModal`. Recommended fix: delete `src/components/Users.jsx` outright. Nothing depends on it, and keeping it around risks a future editor "fixing a bug in Users.jsx" that has zero effect because they edited the wrong copy.

### 6.3 Circular dependencies
Wrote a DFS-based cycle detector over the same 73-file import graph. **0 real cycles.** (One self-referential false positive on `utils/logo.js` traced to a `// import {...} from '../utils/logo'` usage-example comment matching the import regex before comment-stripping was added — confirmed harmless by inspection, and the broken-imports script above, which does strip comments, found nothing wrong with `logo.js`.)

### 6.4 Dead / unused / duplicate code
Beyond `Users.jsx` (CQ-1): no other duplicate files found. `accounting.js` (distinct from `Accounting.jsx`) was reduced to an empty `export {}` stub in the 2026-07-23 audit and remains so — intentionally inert, not a new finding.

### 6.5 Secrets / hardcoded credentials
`.gitignore` correctly excludes `.env`, `.env.local`, `.env.production`; only `.env.example` (all placeholder values) is tracked in git. Pattern-scanned all of `src/` for API-key/secret/password-literal patterns — the only matches are in `utils/bankFeedProviders.js`, and those are parameter *names* for third-party bank credentials (Mono, Okra) that the user supplies at runtime, not embedded secrets. **0 hardcoded secrets found.**

### 6.6 Dangerous patterns
`0` uses of `eval()`. `0` uses of `dangerouslySetInnerHTML`. `0` `console.log` calls anywhere in `src/` (8 `console.error`, 31 `console.warn` — reasonable, deliberate logging, not debug leftovers). `0` `TODO`/`FIXME`/`HACK`/`XXX` comments.

### 6.7 React correctness patterns
Wrote a JSX-aware scanner (multiline lookahead, distinguishes JSX-rendering `.map()` from plain data-transform `.map()`): 452 JSX-list-rendering `.map()` calls found across all modules; 7 initial candidates for "missing `key=`" were manually verified and are **all false positives** (data-transformation maps my first-pass heuristic misclassified — e.g. building a ledger `rows` array, not rendering it). **0 confirmed missing-key issues.** Non-strict equality (`==`/`!=`) is essentially absent from the codebase — high discipline. No direct-mutation-of-state patterns (`state.x.push(...)` etc.) found via pattern scan.

### 6.8 Financial calculation correctness
`utils/glPosting.js` (the AR/AP/payroll/fixed-asset/terminal → General Ledger posting layer) was read in full. It's genuinely well-built: every journal line is built through a single `jLine()` helper that throws (not silently coerces) on a non-finite or negative amount, rounds to kobo (2dp) rather than whole Naira, and the file ends with a **self-verifying "drift guard"** — at module load, it checks every account code it references against the real chart of accounts (`chartOfAccounts.js`) and `console.error`s loudly if any code has drifted out of sync, specifically so a mismatch shows up immediately instead of silently posting to an "Unknown" account on the Trial Balance. This is a stronger safety net than most financial code of this size has.

**Finding CQ-9 (Low, consistency):** A shared `formatCurrency()` helper exists (`src/utils/helpers.js:33-35`, locale-aware, fixed 2dp) but is only imported in 3 files project-wide. Most modules — including `Accounting.jsx` itself (e.g. line 762) and `utils/notifications.js` — hand-roll the equivalent `` `₦${x.toLocaleString()}` `` inline instead. Functionally equivalent today, but scattered duplication makes a future currency-formatting change (e.g. adding thousands-separator options, or supporting a second currency display) a find-and-replace across dozens of call sites instead of a one-file edit.

### 6.9 Test coverage
13 test files exist, covering: `Accounting`, `AccountsPayable`, `AccountsReceivable`, `ContractStaff`, `GLIntegration`, `Procurement` (×2), `SlotStaff`, `Users` (×2), plus `usePerRecordSync`, `syncPerRecord.voided`, and `masterDataSync` at the sync-engine level. That's good coverage of the financially critical path and the sync-engine correctness risk called out in prior audits.

**Finding CQ-10 (Medium):** `TerminalOps.jsx` — at 1,515 lines, the module most recently and most heavily modified (the Bill of Lading upgrade earlier this week) — has **zero test files**. Same for `FleetMaintenance.jsx`, `Inventory.jsx`, `FixedAssets.jsx`, `Invoices.jsx`, `Settings.jsx`, and the four `SageReports*` files (2,198 + 1,607 + 1,562 + 1,007 = 6,374 lines combined). Given Terminal Ops just went through a real schema/data-model change, it's the single best next candidate for test coverage of everything in this list.

*(Note: `npm test`/`npm run build`/`npm run lint` all crash with a native `Bus error` in this specific sandbox — confirmed environment-level, not code-level, since it reproduces on the untouched pre-existing test suite too. Lint was independently re-run via bare `npx eslint .` successfully — see 5. Build/test could not be independently re-run this pass; run both locally before the next deploy.)*

---

## What's Already Clean

Explicitly listing what passed, since a 25-point audit request shouldn't read as "everything is broken":

- **0** syntax errors across all 73 files
- **0** ESLint errors/warnings (current)
- **0** circular dependencies
- **0** hardcoded secrets/credentials
- **0** `eval()`, **0** `dangerouslySetInnerHTML`, **0** `console.log` debug leftovers
- **0** confirmed missing React `key` props (452 checked)
- `.env` correctly gitignored; only placeholder `.env.example` tracked
- All 3 Edge Functions independently re-verified: server-side caller/role verification, input validation, injection defenses, request timeouts
- RLS: the one historical Critical gap is confirmed closed live; function search-paths pinned; role-validation trigger active — all re-verified against the live database, not just the migration files
- Strong CSP + full security header set on both hosting configs
- `glPosting.js`: fail-loud validation, kobo-precision rounding, self-verifying COA drift guard
- 13 test files covering the financially critical modules and both sync engines
- Clean, legible project structure; consistent theming/component patterns throughout everything read

---

## Recommended Fix Order

Grouped by effort, cheapest/highest-value first:

1. **SEC-1** — Enable "Leaked password protection" in Supabase Dashboard. *Zero code, one click.*
2. **CQ-1** — Delete `src/components/Users.jsx`. *Zero risk (confirmed unused + confirmed broken if it were used), one deletion.*
3. **CQ-6** — Remove `continue-on-error: true` from the lint step in `ci.yml`. *Zero code, one YAML line — current lint is already clean.*
4. **CQ-7** — Flip `.env.example`'s `VITE_USE_PER_RECORD_SYNC` default to `true`, matching its own recommendation comment. *One line.*
5. **SEC-3** — Bring `create-user/index.ts` CORS in line with its two siblings (copy `ALLOWED_ORIGINS`/`corsHeaders(req)` from `notify/index.ts`). *Small, mechanical.*
6. **DEP-2** — `npm audit fix` for `vite`/`postcss`/`brace-expansion`, then confirm build still runs locally.
7. **CQ-5** — Add the 4 missing keys to `AppContext.jsx:9`'s `initialState.db.terminal`. *One line.*
8. **CQ-3 / CQ-4** — Remove dead `:hover` key and migrate off `readAsBinaryString` in `DocScanner.jsx`. *Cosmetic cleanup.*
9. **SEC-4** — Add a last-admin-protection guard (block demoting/disabling the final active admin for a company). *New logic — trigger or Edge Function, needs a design decision on where it lives.*
10. **CQ-10** — Add test coverage for `TerminalOps.jsx` first (most recently changed), then the other untested large modules.
11. **PERF-1** — Wrap the 10 unwrapped `auth.*` calls in the 5 flagged RLS policies in `(select ...)`. *Mechanical but touches live policies — test in a branch first.*
12. **SEC-5** — Decide whether to require MFA for admin/accountant roles (product decision; the mechanism already exists in `utils/mfa.js`).
13. **DEP-1** — Delete or explicitly document `firebase.json`/`netlify.toml` as intentionally-kept escape hatches; fix the stale "React Router" comment either way.
14. **CQ-9** — Migrate scattered `₦${x.toLocaleString()}` call sites onto the existing `formatCurrency()` helper, opportunistically as those files are touched.
15. **PERF-2 / PERF-3** — No action needed now; revisit Context-splitting if/when data volume or concurrent-user count grows enough to make the whole-tree re-render pattern actually felt.

---

## Methodology & Coverage

Full line-by-line manual reading of all ~34,600 lines was not attempted — it isn't the right tool for a codebase this size, and would have produced a slower, less reliable audit than combining automated project-wide checks with targeted deep reads. What was actually done:

- **Read in full:** `App.jsx`, `AppContext.jsx`, `ThemeContext.jsx`, `Sidebar.jsx`, `Topbar.jsx`, `LoginScreen.jsx`, `ErrorBoundary.jsx`, `ui/index.jsx`, `DocScanner.jsx`, `utils/auth.js`, `utils/mfa.js`, `utils/tokens.js`, `utils/logo.js`, `supabase/auth.js`, `supabase/authBridge.js`, `utils/glPosting.js`, both `Users.jsx` copies, all 3 Edge Functions, migrations 002 and 007-011, `vite.config.js`, `package.json`, `eslint.config.js`, all 3 hosting configs, both GitHub Actions workflows, `.env`/`.env.example`. Plus, from the immediately preceding work this week: `TerminalOps.jsx` in full and roughly half of `Accounting.jsx` (the largest file at 3,285 lines — journal entries, recurring templates, the sections most directly tied to money).
- **Automated, project-wide (covers all 73 files, not a sample):** syntax validity (esbuild), broken-import resolution, circular-dependency graph, secrets pattern scan, `eval`/`dangerouslySetInnerHTML`/`console.log` scan, ESLint, missing-`key` JSX scan, non-strict-equality scan, npm dependency audit.
- **Sampled / pattern-scanned rather than read end-to-end:** the remaining large modules (`SageReports*`, `Procurement.jsx`, `AccountsReceivable.jsx`, `AccountsPayable.jsx`, `FleetMaintenance.jsx`, `Inventory.jsx`, and the rest of `Accounting.jsx`) — these went through every automated check above (so a syntax error, broken import, secret, or missing key *would* have surfaced), but weren't individually read top to bottom for business-logic bugs the way the architecturally central files were.
- **Live-verified against the database**, not just read from migration files: current RLS policies on `company_data`, function search-path pinning, the role-validation trigger, and current security/performance advisors.
- **Could not run:** `npm run build`, `npm test`, `npm run lint` via the npm script (all three crash with a sandbox-level `Bus error` that reproduces even on the untouched pre-existing test suite — confirmed environment-caused, not code-caused). Worked around via direct `esbuild` (syntax) and direct `npx eslint` (lint, succeeded — 0 errors). **Run `npm run build` and `npm test` locally before the next deploy** — that's the one gate this audit couldn't independently clear.

If a deeper pass through the un-sampled modules would be useful — particularly the second half of `Accounting.jsx`, or a full read of the four `SageReports*` files — that's a reasonable next audit to scope specifically.
