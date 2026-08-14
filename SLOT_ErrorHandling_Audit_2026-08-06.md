# SLOT ERP — Error-Handling Audit
**Date:** 6 August 2026 · **Scope:** all `.js` / `.jsx` under `src/`, tests excluded
**Method:** brace-matched parse of every `try/catch`, plus call-graph check of all 48 exported async persistence functions against their call sites.

**Nothing in this document has been changed.** This is a read-only diagnosis.

---

## Summary

| # | Finding | Instances | Severity |
|---|---------|-----------|----------|
| 1 | Cloud writes that are never awaited and whose failure never reaches the user | **82** | **HIGH** |
| 2 | Silent catches hiding real network failures | 4 | MEDIUM |
| 3 | Silent catches around `localStorage` | 40 | LOW (acceptable) |
| 4 | Silent catches around channel cleanup / parsing | 44 | LOW (acceptable) |
| — | Supabase calls with an unchecked `error` | **0** | clean |

---

## FINDING 1 — HIGH — 82 fire-and-forget cloud writes

### What it is

Every module persists through `diffAndPush()`, `pushOne()` or `pushDelete()`. All three are `async`. At **82 call sites across 27 files** they are called **without `await`, without `.catch()`, and without reading the returned result**.

Representative — `Procurement.jsx:1126`:

```js
if (table) diffAndPush(table, prevByList[listName], newList);
setFn(newList);
...
showToast('Invoice submitted');
```

### Why it matters

`diffAndPush` already retries once and then reports failure two ways — neither of which reaches the user:

```js
if (failed) {
  console.error(`[SLOT ERP] ${failed} of ... record(s) failed to save to the cloud after a retry.`);
}
return { ok: failed === 0, pushed, deleted, failed, failures };
```

- the `console.error` is invisible to staff — nobody has DevTools open
- the `{ ok: false }` return value is **discarded at all 82 sites**

The local React state updates regardless, and the success toast fires regardless. **A cloud write that fails looks exactly like one that succeeded.** The record is correct on the screen of the person who saved it and absent everywhere else — until they refresh, at which point their work disappears with no explanation.

This is the same failure shape as the invoice-count incident on 5 August, where one user's view and the database disagreed with no error anywhere.

### Every instance

| Count | File | Functions | Lines |
|---|---|---|---|
| 13 | `components/modules/SageReports2.jsx` | diffAndPush ×8, pushOne ×5 | 158, 236, 242, 487, 488, 489, 609, 968, 969, 1160, 1399, 1485, 1486 |
| 8 | `components/modules/SageReportsTier2.jsx` | diffAndPush ×6, pushOne ×2 | 91, 169, 555, 561, 828, 1097, 1316, 1375 |
| 8 | `components/modules/SageReportsTier3.jsx` | diffAndPush ×5, pushOne ×3 | 315, 321, 370, 371, 535, 720, 726, 801 |
| 7 | `components/modules/Inventory.jsx` | diffAndPush ×3, pushOne ×3, pushDelete ×1 | 109, 138, 144, 344, 345, 365, 467 |
| 5 | `components/modules/AccountsPayable.jsx` | diffAndPush ×4, saveAll ×1 | 133, 134, 141, 142, **283** |
| 5 | `components/modules/Settings.jsx` | saveSettingsCloud ×5 | 343, 352, 381, 392, 401 |
| 4 | `components/modules/ContractStaff.jsx` | pushOne ×3, pushDelete ×1 | 377, 380, 416, 428 |
| 4 | `components/modules/SageReports.jsx` | diffAndPush ×3, pushOne ×1 | 745, 1683, 1742, 1743 |
| 4 | `components/modules/SlotStaff.jsx` | pushOne ×3, pushDelete ×1 | 365, 368, 400, 412 |
| 3 | `components/modules/ExcelManager.jsx` | diffAndPush ×3 | 323, 324, 364 |
| 2 | `components/modules/AccountsReceivable.jsx` | diffAndPush ×2 | 266, 267 |
| 2 | `components/modules/Requests.jsx` | diffAndPush, pushOne | 149, 260 |
| 2 | `components/modules/SalesOrders.jsx` | diffAndPush, pushOne | 96, 166 |
| 2 | `hooks/usePerRecordSync.js` | pushOne, pushDelete | 587, 588 |
| 1 | `App.jsx` | saveDBCloud | 703 |
| 1 | `components/modules/Accounting.jsx` | diffAndPush | 677 |
| 1 | `components/modules/Approvals.jsx` | diffAndPush | 169 |
| 1 | `components/modules/FixedAssets.jsx` | diffAndPush | 130 |
| 1 | `components/modules/FleetMaintenance.jsx` | diffAndPush | 714 |
| 1 | `components/modules/Invoices.jsx` | diffAndPush | 212 |
| 1 | `components/modules/PettyCash.jsx` | diffAndPush | 186 |
| 1 | `components/modules/Procurement.jsx` | diffAndPush | 1126 |
| 1 | `components/modules/TerminalOps.jsx` | diffAndPush | 380 |
| 1 | `utils/audit.js` | pushActivity | 84 |
| 1 | `utils/clientMaster.js` | diffAndPush | 72 |
| 1 | `utils/projectMaster.js` | diffAndPush | 55 |
| 1 | `utils/vendorMaster.js` | diffAndPush | 82 |

`AccountsPayable.jsx:283` (`saveAll(newBills, newPayments)`) is the most exposed of these — `saveAll` writes **every** record in the snapshot, so a failure there is broad rather than single-record.

### Note on intent

This is deliberate design, not an oversight — the header comment on `diffAndPush` reads *"Fire-and-forget … never throws/rejects; resolves quietly on failure."* The design decision is sound (a failed sync should not crash the UI). What is missing is the other half: **the user is never told.**

### Smallest possible remedy

One change, in one place, fixes all 82 without touching a single module: have `diffAndPush` / `pushOne` / `pushDelete` raise a toast when `failed > 0`. Roughly six lines in `hooks/usePerRecordSync.js`. Every call site keeps its current fire-and-forget shape.

---

## FINDING 2 — MEDIUM — 4 silent catches hiding real network failures

| File:Line | Operation swallowed | Consequence |
|---|---|---|
| `supabase/storage.js:78` | `storage.createSignedUrl()` | A document link silently fails to generate; the user sees nothing happen. |
| `supabase/storage.js:90` | `storage.remove()` | A deleted attachment stays in the bucket. Returns as if it succeeded. |
| `supabase/storage.js:104` | `storage.list()` | Attachment list silently comes back empty — indistinguishable from "no documents". |
| `supabase/authBridge.js:52` | `auth.getSession()` | Session check fails and is read as "not signed in". |

The third is the one to watch: **an empty attachment list and a failed fetch look identical to the user.**

---

## FINDING 3 & 4 — LOW — 84 acceptable silent catches

- **40** wrap `localStorage` / `sessionStorage` / `indexedDB`. Correct practice — these throw in private browsing and when quota is exceeded, and the app is designed to degrade rather than fail.
- **3** wrap `supabase.removeChannel()` during cleanup. Benign.
- **41** wrap `JSON.parse` of stored data, date parsing, and per-record loops that deliberately skip malformed rows (16 of these are in `Accounting.jsx`, each marked `/* skip malformed records */`).

No action recommended.

---

## Checked and found clean

- **Supabase `error` handling** — every `const { error } = await supabase…` is checked. Two apparent misses (`supabase/auth.js:52`, `supabase/sync.js:226`) alias the variable to `profileError` and `casErr` and check both correctly.
- **`syncPerRecord.js:574`** — appeared to be a silent catch over a DB write, but records the failure into its `results[]` array, which `backfillFromBlob` returns to the caller.
- **Login, MFA and scanner error paths** — all set user-visible error state.

---

## Recommended order

1. **Finding 1** — surface sync failures. One edit in `usePerRecordSync.js` covers all 82 sites. This is the one that has already cost real time.
2. **`storage.js:104`** — distinguish "no documents" from "could not fetch documents".
3. Findings 3 and 4 — leave alone.
