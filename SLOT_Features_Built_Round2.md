# SLOT ERP — Round 2 — Features Built

All 12 features from the audit feedback round 2 are now implemented and the build is clean.

## Build & Smoke Test
- `npm run build` → ✓ built in ~1.2s
- `npm run dev` → ready in 428ms, app loads on http://localhost:5173/

## What Got Built

### A. SLOT's Three Terminal Requests
| # | Request | Where to find it | How to test |
|---|---------|------------------|-------------|
| A.1 | Stand-alone Terminal financial statements | Terminal Ops → new **"📈 Standalone P&L/BS"** tab | Click into the tab — P&L and Balance Sheet built from journals with `source: 'terminal'` or `'terminal-advance'`. Net P&L and equity update as you post Terminal charges / advances. |
| A.2 | Advance payment records with container numbers | Terminal Ops → new **"💵 Advance Payments"** tab | Click **Record Advance Payment**, fill payer, amount, date. In "Containers Covered" pick the container(s) and an allocation per container. In "Apply Advance Against Container" — one click per container as it's processed. GL: Dr Bank / Cr 2099 Advance from Customer (Terminal) on receipt; Dr 2099 / Cr 4005 Logistics Income on each application. |
| A.3 | BoL as parent row, containers as serial children | Terminal Ops → new **"📄 Bill of Lading"** tab | Click **Add Bill of Lading** — vessel/voyage/POL/POD/ETA/ATA. Child containers are auto-detected by BoL number match. Container modal also has a "Link to BoL" dropdown. Each BoL card shows: container count, distinct consignees, total charges, free-time expiry, per-container rows with consignee. |

### B. Module-to-Accounting Sync — Already Working
No new build needed. The audit confirmed the auto-post effect in `Accounting.jsx` (lines 2690-2910) handles every module. New advances + terminal charges + depreciation + stock issues all flow through the same effect. Period guard and void reversal also already wired.

### C. Ten Findings from Prior Audit
| # | Finding | Status | Where to find it |
|---|---------|--------|------------------|
| C.1 / C.11 | Period locking UI | **Already built** (was wrong in audit) | Settings → Accounting tab: Close/Reopen period, Year-End Close, year-end closing entry posted automatically |
| C.2 | Depreciation auto-post to GL | ✅ **Built** | Fixed Assets → Depreciation Schedule tab → **"📅 Post Periodic Depreciation to GL"** panel. Pick year/month, see eligible assets, click Post. Each asset carries `depreciationPosted: [{periodKey, amount, ...}]` and the Accounting effect picks it up. |
| C.3 | Recurring/Template Journals | ✅ **Built** | Accounting → Journal Entries → **"🔁 Recurring Journal Templates"** collapsible panel. Build any JE, tick "Save as template", name it. One-click Post for any period (idempotent). |
| C.4 | Credit limit enforcement | ✅ **Built** | Accounts Receivable → New Invoice. When a client is selected, a live credit utilisation bar shows. If a new invoice would push them past the limit, a confirm dialog appears (Sage-style override). At ≥90% a soft warning toast. |
| C.5 | Sales Orders module | ✅ **Built** | New sidebar entry: **Sales Orders** (📋). Full Quote→SO→Invoice pipeline, status pipeline, back-order tracking per line, multi-currency, one-click "Generate AR Invoice" creates a Draft invoice in the AR module. |
| C.6 | Inventory costing wire-up | ✅ **Built** | Inventory → new **"📦 Stock Movements & Costing"** tab. Register stock items, post RECEIVE/ISSUE/RETURN/SCRAP/ADJUST movements, see live on-hand qty / weighted-avg cost / total stock value. Reorder-point alerts. The costing engine (`valueIssue()` in `utils/inventoryModel.js`) is now actually called. ISSUE movements post Dr 8004 / Cr 6001 via the auto-post effect. |
| C.7 | Document attachments | ✅ **Built** | AR invoice view modal has a new **"📎 Attachments"** section using the new `<AttachmentUploader>` component. Files upload to Supabase Storage when available, fall back to inline base64 offline. Reusable — drop it into AP bills, JEs, SOs by passing the right `attachments` array. |
| C.8 | Live bank feed | ✅ **Built** | Accounting → Bank Reconciliation → new **"🔴 Live Bank Feed"** panel. Pick Mono, Okra, or CSV. Credentials stored in `appSettings.bankFeed`. One-click Pull fetches live transactions into the bank statement list, tagged with `source: live:mono` for audit. Falls back to CSV / manual if the API call fails. Provider abstraction lives in `utils/bankFeedProviders.js` — adding a new bank is one entry. |
| C.9 | Period-end FX revaluation | ✅ **Built** | Accounting → Currency Exchange tab → new **"📈 Period-End FX Revaluation"** card. Pick period, enter closing rates (USD/EUR/GBP), see all FC-denominated balances, post unrealized G/L. Dr/Cr 2099 CTA (new COA account), 4501 gain / 9100 loss. Idempotent per period. |
| C.10 | Sage Intelligence-style live Excel | ✅ **Built** | Accounting module header → new **"📊 Sage Intelligence Template"** button. Downloads a .xlsx with one sheet per metric (Trial Balance, P&L, BS, AR/AP aging, Sales Orders, Journal, Terminal P&L, FX Revaluation). All numbers pulled live from app state at download time. Live endpoint functions live in `utils/liveExcel.js` for future Power Query integration. |

## Files Touched
- `src/utils/glPosting.js` — added `journalFromDepreciation`, `journalFromAdvanceReceipt`, `journalFromAdvanceApplication`, re-exported `journalFromStockIssue`
- `src/utils/periods.js` — untouched (already complete)
- `src/utils/inventoryModel.js` — untouched (already complete)
- `src/utils/bankFeedProviders.js` — **new**
- `src/utils/liveExcel.js` — **new**
- `src/components/modules/Accounting.jsx` — added depreciation, advances, stock, recurring templates, FX revaluation, live bank feed, Sage Intelligence download; new COA account 2099 CTA
- `src/components/modules/FixedAssets.jsx` — added "Post Periodic Depreciation" panel
- `src/components/modules/TerminalOps.jsx` — added BoLs, advances, standalone statements tabs + their modals; new SEED data
- `src/components/modules/AccountsReceivable.jsx` — credit-limit check at invoice save + live utilisation bar
- `src/components/modules/Inventory.jsx` — added Stock Movements & Costing tab
- `src/components/modules/SalesOrders.jsx` — **new**
- `src/components/ui/index.jsx` — added `AttachmentUploader` component
- `src/App.jsx` — registered SalesOrders module
- `src/components/layout/Sidebar.jsx` — added Sales Orders link

## Data Model Extensions
- `db.terminal.bols` — new BoL parent collection
- `db.terminal.advances` — new advance payments collection
- `db.stockItems`, `db.stockMovements` — new inventory costing collections
- `db.recurringTemplates` — new recurring journal templates collection
- `db.salesOrders` — new SO collection
- `db.fixedassets[i].depreciationPosted` — new field on each asset
- `db.appSettings.bankFeed` — new settings slot for live bank provider credentials
- `invoice.attachments` — new field on invoices (and reuses for any record via `<AttachmentUploader>`)

## Testing Notes
- `postedToAccounting` flag still controls whether a Terminal charge hits the GL — set this when a charge has been paid out.
- A new Terminal advance automatically posts its receipt JE; the application JE is created when you click "Apply" against a container in the modal.
- The new period-end FX revaluation requires entering closing rates for each currency that has FC balances — no rate, no reval (and a soft prompt).
- Live bank feed needs real Mono/Okra credentials to test against a live bank; without them, the panel falls back to the existing CSV/OFX import in the manual entry section.
- The Sage Intelligence download is a single .xlsx with all the live numbers at download time. To re-pull later, click the button again — same path, fresh numbers.

## Status: All 12 features delivered
- 1 found already built (Period Close UI)
- 11 newly built in this session
- Build clean, dev server runs, app loads
