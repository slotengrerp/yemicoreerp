# SLOT ERP — Bill of Lading Upgrade — 2026-07-25

Follow-up to `SLOT_BillOfLading_Schema_Audit_2026-07-25.md`. Closes the gaps that
could be fixed **inside the existing JSONB-per-record architecture** (the same
pattern every other module in this app already uses — clients, vendors,
invoices, terminal_bols, etc.), without a full relational rewrite. See that
audit's "Recommendation Order" for why a full rewrite was not the chosen path.

---

## What Got Built

| # | Gap (from the audit) | What changed |
|---|---|---|
| B.2 | No `Consignees` master — free-text only, no ID/address/phone/email | New `consignees` collection on `db.terminal`, new **"🏢 Master Data"** tab with add/edit/delete, new `ConsigneeModal`. Containers now carry `consigneeId` (dropdown, auto-fills the existing `consigneeName` text field) alongside the free-text field, which stays editable for cases not yet in the master list. |
| B.3 | No `ShippingCompanies` master — free-text, duplicated on BoL + container | Same pattern: new `shippingCompanies` collection, `ShippingCompanyModal`, `shippingCompanyId` dropdown on both `ContainerModal` and `BoLModal`, auto-filling the existing `shippingCompany` text field. |
| B.4 | BoL↔Container link had two competing keys (`bolId` vs free-text `billOfLading` match) that could disagree between the main tab and the "Edit BoL" modal | `BoLModal`'s `childContainers` now matches on `bolId` only, same as the main tab. Both views always agree now. |
| B.5 | `charges`/`logistics`/`advances` referenced containers by the human `containerNo` string, which carriers reuse across shipments — risk of cross-shipment mixups | `ChargeModal`, `LogisticsModal`, and `AdvanceModal` (`containersCovered[]` + `applications[]`) now capture a `containerId` when a container is selected, alongside the cached `containerNo`. A new `belongsToContainer()` helper centralises the lookup (prefers `containerId`, falls back to `containerNo` for records saved before this upgrade) and is now used everywhere a charge/logistics/advance record is matched back to its container: the Charges tab's type lookup, the BoL card's total-charges roll-up, and the "Containers Without a Logistics Record" report. |

## Deliberately Left Out (needs a product decision, not just code)

- **B.6 — unified Payments table.** The audit flagged that `advances` (many-to-many junction) and `charges` (a cost ledger) don't match the description's simple per-container Payments table, and that restructuring them is a product decision, not a pure code gap — both are already wired into GL auto-posting (`glPosting.js`, `Accounting.jsx`'s auto-post effect), so reshaping them risks a real accounting regression if done without a clear target shape. Left as-is.
- **B.7 — Invoices per container.** Not built. Only worth doing if Slot actually wants Terminal Ops to generate its own invoices rather than using the existing global Invoices/AR module.
- **B.1 — full relational rewrite.** Not done. Would put Terminal Ops out of step with every other module in this app.

If Slot wants either of these closed, that's a separate scoped piece of work — flag it and it can be sized properly.

---

## Files Touched

- `src/components/modules/TerminalOps.jsx` — SEED data (`consignees`, `shippingCompanies`), new `masters` tab + UI, `ConsigneeModal`, `ShippingCompanyModal`, `ContainerModal`/`BoLModal` dropdowns, `ChargeModal`/`LogisticsModal`/`AdvanceModal` containerId capture, `belongsToContainer()` helper, `singularOf()` helper (fixes an activity-log grammar bug the new `shippingCompanies` section name would otherwise have hit)
- `src/supabase/sql/011_terminal_master_data.sql` — **new**. Creates `terminal_consignees` and `terminal_shipping_companies` (same shape as `terminal_bols`/`terminal_advances`, `id` as TEXT not UUID per the fix in `010_fix_record_id_column_types.sql`), indexes, RLS.
- `src/supabase/syncPerRecord.js` — registered both new tables in `RECORD_TABLES` and `getRecordList()`
- `src/hooks/usePerRecordSync.js` — mirrored the same registration, plus the per-record realtime DELETE/upsert merge branches

## Data Model Extensions

- `db.terminal.consignees` — `{ id, name, address, phone, email, createdAt }`
- `db.terminal.shippingCompanies` — `{ id, name, createdAt }`
- `containers[].consigneeId`, `containers[].shippingCompanyId`, `bols[].shippingCompanyId` — new, optional (old records without them keep working off the cached text fields)
- `charges[].containerId`, `logistics[].containerId`, `advances[].containersCovered[].containerId`, `advances[].applications[].containerId` — new, optional, same backward-compatible fallback

## What YOU Need to Run

In the Supabase SQL editor, against the live project (`fxlejgzazgyudraqlxjv`): paste and run
`src/supabase/sql/011_terminal_master_data.sql`. The verification query at the
bottom confirms both tables exist with one RLS policy each. `VITE_USE_PER_RECORD_SYNC`
is already `true` in `.env`, so once the migration lands, the new master data
starts syncing through the same engine as `terminal_bols`/`terminal_advances`
immediately — no flag flip needed.

## Testing Notes

- **Sandbox limitation, not a code issue:** `npm run build`, `npm run lint`,
  and `npx vitest run` all crashed with `Bus error (core dumped)` in this
  environment — including on the pre-existing test suite I didn't touch, so
  this is the sandbox's Vite/Rollup native binary, not these changes.
  What I verified instead: every edited file passes a direct `esbuild`
  syntax parse clean (`TerminalOps.jsx`, `syncPerRecord.js`,
  `usePerRecordSync.js`), plus a manual read-through of every changed
  section for prop-name and reference consistency. **Please run
  `npm run build` and `npm test` yourself before shipping** — that's the
  one gate I couldn't clear from here.
- New containers/BoLs/charges/advances created **after** this upgrade get a
  real `containerId`/`consigneeId`/`shippingCompanyId` automatically. Records
  saved **before** this upgrade keep working exactly as before — nothing
  needs to be re-entered, the fallback logic covers them.
- Try it: Terminal Ops → **Master Data** tab → add a consignee and a shipping
  company → open a container → both now appear as dropdowns above the
  existing free-text fields.

## Status: Upgraded within the existing architecture, as scoped

- 4 of 6 audit findings closed (B.2, B.3, B.4, B.5)
- 2 left open pending a product decision (B.6, B.7), 1 rejected by design (B.1)
