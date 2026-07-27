# SLOT ERP — Bill of Lading Data Model — Spec Compliance Audit

Audit performed against `D:\bizcorehtml_minimax_sage` (React 19 + Vite + Supabase), cross-checked against the live Supabase project `fxlejgzazgyudraqlxjv`.
Scope: does the built Bill of Lading module (`src/components/modules/TerminalOps.jsx`) match the relational schema Slot was given (ShippingCompanies → BillsOfLading → Containers → Consignees/Payments)?

---

## A. What Matches

### A.1 One Bill of Lading → many Containers (the core hierarchy)
**Status: MET.** `TerminalOps.jsx` has a `bols` parent collection and each container carries a `bolId` foreign key (`ContainerModal`, line 792). The "Bill of Lading" tab (line 524) renders one card per BoL with child container rows, a distinct-consignee count, total charges, and free-time expiry — matching the description's parent/child picture.

This was flagged as **PARTIALLY MET** ("the data is there, the hierarchy is not") in the prior `SLOT_Feedback_Round2_Audit.md` (A.3) and was subsequently built per `SLOT_Features_Built_Round2.md`. Confirmed still in place in the current code.

### A.2 Core BoL fields
**Status: MET.** `billOfLadingNo`, `shippingCompany`, `shippingVessel`, `voyageNo`, `portOfLoading`, `portOfDischarge`, `etaDate`, `ataDate` all exist on the `bols` record (`BoLModal`, lines 909–957) and line up with the description's BL_Number / Vessel / Voyage / Shipping Line / ETA / ETD / Port of Loading / Port of Discharge.

---

## B. Where the Built System Diverges from the Description

### B.1 Storage model — JSONB documents, not normalized tables
**Status: ARCHITECTURAL MISMATCH — root cause of most items below.**

The description recommends six typed relational tables with foreign key columns. What's actually built, in both the legacy and current sync paths, is a JSON-document-per-row model:
- `db.terminal` in the app is five flat arrays: `bols`, `containers`, `charges`, `logistics`, `advances`.
- In Supabase, `terminal_bols` and `terminal_advances` are `{ id, company_id, data JSONB, voided, created_at, updated_at }` — one opaque JSON blob per record, not typed columns (`src/supabase/sql/005_round2_tables.sql`, lines 40–71).
- `containers` and `logistics` aren't even split into their own per-record tables — `RECORD_TABLES` in `syncPerRecord.js` (lines 52–55) only maps `terminalCharges`, `terminalBols`, `terminalAdvances`; containers/logistics still ride the legacy whole-document sync (`company_data.db`, per `sync.js`).
- `sync.js` says this outright in its own header comment: real field-level integrity "needs the normalized-tables rework already underway... that's a separate, larger project."

Net effect: **no foreign key is ever enforced by the database** for any of the relationships the description describes (BL_ID, ConsigneeID, ContainerID). Every link is application-level JS matching.

Verified live: `terminal_bols` and `terminal_advances` both show 0 rows in `fxlejgzazgyudraqlxjv` — consistent with `QA_Security_DBA_Audit_2026-07-23.md`'s finding that the per-record tables were never backfilled. This audit is a code/architecture comparison, not a live-data comparison.

### B.2 Consignee — no master table
**Status: NOT MET / GAP.** The description calls for a `Consignees` table (ConsigneeID, Name, Address, Phone, Email) referenced from `Containers.ConsigneeID`. The build has none of that — `consigneeName` is a free-text field typed directly on each container (`ContainerModal`, line 802). "Distinct consignees" on a BoL card (line 539) is computed as `new Set(childContainers.map(c => c.consigneeName))` — a string dedupe, not a table join. No address, phone, or email is captured anywhere for a consignee. Renaming a consignee or fixing a typo means editing every container row by hand. This gap was never raised in either prior audit — it isn't on anyone's list yet.

### B.3 ShippingCompanies — no master table
**Status: NOT MET.** Same pattern: `shippingCompany` is a free-text input, duplicated independently on both the `bols` record and every `containers` record (no shared reference), with no dropdown constraining it to previously-used values.

### B.4 Container ↔ BoL link — two competing keys
**Status: PARTIALLY MET / RISK.** The description's single `BL_ID` foreign key exists (`bolId`), but a second, older free-text link (`billOfLading`, matched against `bol.billOfLadingNo`) is still live alongside it. The main BoL tab counts children by `bolId` only (line 536); the "Edit BoL" modal counts children by `bolId` **OR** text match (line 915). The two views can disagree on how many containers are "linked" to the same BoL.

### B.5 Container identity — the human container number doubles as the key
**Status: DIVERGES / RISK.** The description's `Containers` table uses an auto-increment `ContainerID` as the true primary key, with `ContainerNumber` as an ordinary (reusable) attribute — realistic, since carriers reuse physical container numbers across voyages. The build's UI literally labels the field **"Container No (Primary Key)"** (`ContainerModal`, line 787), and `charges`/`logistics` records resolve back to a container by matching the `containerNo` string, not a stable ID (e.g. `ChargeModal` line 827, `containers.find(x=>x.containerNo===c.containerNo)` at line 444). If the same container number is ever reused on a later shipment, charge and logistics history could cross-associate between shipments.

### B.6 Payments — split across two structures, neither matching the spec's Payments table
**Status: DIVERGES.** The description's `Payments` table is a simple one-to-many off `ContainerID` (PaymentType, Amount, Date, Reference, Status), covering advance/balance/receipt uniformly. The build instead has:
- **`advances`** — a many-to-many junction: one advance can cover several containers via `containersCovered[]`, and is spent down against them via `applications[]` (`AdvanceModal`, lines 960–1155). Richer than the spec in one direction, but not the same shape.
- **`charges`** — a per-container cost ledger (equipment/terminal/storage charges owed, `postedToAccounting` flag), which is expense-side, not the customer-payment concept the description means by "Payments."

Nothing in the app is a distinct "Balance Payment" record the way the description's PAYMENTS box (Advance / Balance / Receipt) implies.

### B.7 Invoices — not built for Terminal Ops
**Status: NOT MET.** The description has a per-container `Invoices` table (InvoiceNumber, Amount, VAT, Total, Status) and a "Generate Invoice" step in the workflow. There is no invoice generation tied to a container or BoL anywhere in `TerminalOps.jsx`. The app does have a global Invoices/AR module (`invoices` table in Supabase), but it isn't linked by `ContainerID` and isn't reachable from Terminal Ops.

---

## Summary

| # | Description says | Built system | Status |
|---|---|---|---|
| A.1 | One BoL, many Containers | Built — `bolId` FK, parent BoL cards | ✅ MET |
| B.1 | Normalized relational tables + FKs | JSONB documents, app-level joins only | ⚠️ Architectural mismatch |
| B.2 | `Consignees` master table | Free-text `consigneeName`, no master, no ID | ❌ NOT MET |
| B.3 | `ShippingCompanies` master table | Free-text, duplicated on BoL + container | ❌ NOT MET |
| B.4 | Single `BL_ID` FK | `bolId` FK + legacy text match, can disagree | ⚠️ PARTIALLY MET |
| B.5 | `ContainerID` PK, reusable `ContainerNumber` | `containerNo` used as the de facto key | ⚠️ RISK |
| B.6 | One `Payments` table off `ContainerID` | Split: `advances` (many-to-many) + `charges` (cost ledger) | ⚠️ DIVERGES |
| B.7 | Per-container `Invoices` table | Not built in Terminal Ops | ❌ NOT MET |

---

## C. Recommendation Order (if Slot wants this closed)

1. **B.4 — collapse the dual BoL link** to `bolId` only. Smallest change, fixes a real display inconsistency today.
2. **B.2 — add a `Consignees` master collection** (id, name, address, phone, email), switch containers to a `consigneeId` reference, keep `consigneeName` as a cached display field.
3. **B.3 — add a `ShippingCompanies` master collection**, same pattern.
4. **B.6 — decide whether `advances`+`charges` is the intended final shape**, or whether Slot actually wants a unified per-container Payments ledger. This is a product decision, not just a code gap.
5. **B.5 — separate container identity from container number** so a reused container number can't cross-associate charges/logistics across shipments.
6. **B.7 — Invoices** — only worth building if Slot wants per-container billing generated from Terminal Ops rather than the existing global AR/Invoices module.
7. **B.1 — full relational rewrite** — largest, riskiest change; would put Terminal Ops out of step with every other module in this app (all ~20 other business tables use the same JSONB-per-record pattern). Only worth doing if Slot needs real DB-level referential integrity, not just correct application behavior.

---

*Generated 2026-07-25 from `D:\bizcorehtml_minimax_sage`, cross-checked against live Supabase project `fxlejgzazgyudraqlxjv` and prior audits `SLOT_Feedback_Round2_Audit.md` and `QA_Security_DBA_Audit_2026-07-23.md`.*
