# SLOT ERP — QA / Security / DBA Audit — 2026-07-23

Three-part review requested by Yemi: (1) senior QA + security review of the core financial calculation files, (2) Supabase DBA review for data leaks and missing indexes, (3) review of the Supabase Edge Functions handling ERP business logic.

**Methodology note:** every finding below was checked against actual call sites (`grep` for imports/usages across `src/`) before being rated, so severity reflects whether the bug is live and reachable today, not just theoretically possible. Two scope corrections from the original ask, agreed with Yemi before starting:
- Task 1 didn't name a file (`"this [language/framework] file"` was a template placeholder) — scoped to the four highest-risk calculation files: `accounting.js`, `glPosting.js`, `inventoryModel.js`, `threeWayMatch.js`.
- Task 3 asked for a "Firebase Cloud Function" — this app's Firebase integration was fully removed (`src/firebase/config.js` is a stub: *"Firebase has been replaced with Supabase"*; no `firebase-functions`/`firebase-admin` dependency exists). Reviewed the actual serverless functions instead: the three Supabase Edge Functions in `supabase/functions/`.

---

## Summary

| # | Severity | Area | Finding | Status |
|---|----------|------|---------|--------|
| T1-1 | 🔴 Critical | threeWayMatch.js + AccountsPayable.jsx | 3-way match (fraud control) can be silently skipped entirely | **Live** |
| T1-2 | 🔴 Critical | threeWayMatch.js | Wrong-line positional fallback defeats the match silently | **Live** |
| T1-3 | 🟠 High | glPosting.js / inventoryModel.js | Every JE line rounds to whole ₦ and silently flips sign | **Live** |
| T1-4 | 🟠 High | inventoryModel.js | `valueIssue()` doesn't check qty-on-hand; FIFO branch divides by zero | **Live** (wavg) / latent (fifo) |
| T1-5 | 🟠 High | threeWayMatch.js | `waybills = []` default doesn't cover explicit `null` | Latent |
| T1-6 | 🟡 Medium | accounting.js | `generateVATSummary()` falsy-zero bug on VAT-exempt invoices | Dead code today |
| T1-7 | 🟡 Medium | inventoryModel.js | `checkReorder()` reports "safely stocked" for undefined qty | **Live** |
| T1-8 | 🟡 Medium | accounting.js | `calculateDepreciation()` — null crash, NaN on zero cost | Dead code today |
| T1-9 | 🟡 Medium | accounting.js | Entire file is dead code except `DEFAULT_COA`; `autoPost*` trio has a real GL bug if ever wired up | Dead code |
| T1-10 | 🟢 Low | accounting.js | Report generators assume every JE has `.lines`; harden anyway | Guarded today |
| T1-11 | 🟢 Low | accounting.js | `generateCashFlow()` keyword-regex classification is fragile | Dead code today |
| T2-1 | 🔴 Critical | Supabase RLS | No role-based DB restriction — any authenticated user (incl. viewer/cashier) can read all payroll/GL data | **Live** |
| T2-2 | 🔴 Critical | Deployment config | This deployment runs the legacy whole-blob sync engine, not the safer per-record one | **Live (verified in `.env`)** |
| T2-3 | 🟠 High | Indexes | `(company_id, voided)` index missing on 12 of 15 eligible tables | Live gap |
| T2-4 | 🟡 Medium | sync.js | Check-then-write conflict detection has a TOCTOU race window | Self-documented |
| T2-5 | 🟡 Medium | syncPerRecord.js | `loadAll()`/`saveAll()` await sequentially instead of in parallel | Live perf issue |
| T2-6 | 🟢 Low | syncPerRecord.js | No pagination/date-bounding on full-history loads | Scalability note |
| T3-1 | 🟠 High | update-user-password/index.ts | CORS allowlist is built but never used — every response sends `Access-Control-Allow-Origin: *` | **Live** |
| T3-2 | 🟠 High | create-user/index.ts | No top-level `try/catch` — unhandled errors leak raw/un-CORS'd responses | **Live** |
| T3-3 | 🟡 Medium | create-user/index.ts | Compensating rollback (delete orphaned Auth user) isn't verified | **Live** |
| T3-4 | 🟡 Medium | notify/index.ts | Outbound SendGrid/Twilio `fetch()` calls have no timeout | **Live** |
| T3-5 | 🟢 Low | notify/index.ts | Malformed JSON body returns 500 instead of 400 | Live, minor |
| T3-6 | ℹ️ Info | all 3 functions | No genuine memory-leak patterns found (stateless, no top-level accumulating state) | Verified clean |
| T3-7 | 🟢 Low | app_users schema | `email` has no UNIQUE constraint at the DB level | Schema gap |

---

## Task 1 — QA & Security Review: Core Financial Calculation Files

Files reviewed: `src/utils/accounting.js`, `src/utils/glPosting.js`, `src/utils/inventoryModel.js`, `src/utils/threeWayMatch.js`.

### T1-1 🔴 CRITICAL — Three-way match can be silently bypassed entirely

**Where:** `src/components/modules/AccountsPayable.jsx:242-264` (caller) + `src/utils/threeWayMatch.js` `matchBill()`/`decideOnVariance()`.

`handleSavePayment()` only runs the match if `selBill.poId || selBill.poNumber` is set **and** that PO can actually be found in `procurement.pos`:

```js
if (selBill.poId || selBill.poNumber) {
  const po = (procurement.pos || []).find(p => p.id === selBill.poId || p.poNo === selBill.poNumber);
  if (po) {
    const report = matchBill({ bill: selBill, po, waybills });
    if (!report.ok) { /* block or hold */ }
  }
}
```

Two silent bypass paths:
1. A bill with no `poId`/`poNumber` skips the entire block — no warning shown, payment proceeds unchecked.
2. A bill whose `poId` **doesn't resolve** to a real PO (deleted PO, typo, stale reference) fails the `if (po)` check — the match is skipped just as silently, with zero toast/error to the user.

This means the exact scenario 3-way match exists to catch — paying a bill with no valid PO behind it — currently produces **no warning at all**, not even a "hold for review."

There's also a second, independent bug inside `matchBill()` itself: its own `NO_PO_LINK` early return is missing a top-level `severity` key, which (combined with T1-2's fix area) would cause `decideOnVariance()` to **auto-approve** a PO-less bill if this function is ever called directly with `bill`/`po` both null (not reachable from the current call site, since the caller already guards on `po`, but this is a shared/exported utility other code or tests could call). Fixed below as defense-in-depth.

**Fix — `threeWayMatch.js` (also fixes T1-2 and T1-5 below, same function):**

```js
export function matchBill({ bill, po, waybills = [], tolerancePct = 2 }) {
  if (!bill || !po) {
    return {
      ok: false,
      severity: 'critical',   // FIX: was missing, so decideOnVariance() never saw 'critical' here
      variances: [{ type: 'NO_PO_LINK', severity: 'critical', message: 'Bill is not linked to a Purchase Order' }],
      byLine: [],
    };
  }
  const poLines   = po.items || po.lines || [];
  const billLines = bill.items || bill.lines || [];
  const wbList    = Array.isArray(waybills) ? waybills : [];   // FIX T1-5: default param doesn't cover explicit null
  const byLine    = [];
  const allVars   = [];

  billLines.forEach((bLine, idx) => {
    const exactMatch = poLines.find(l =>
      (bLine.itemId && l.id === bLine.itemId) ||
      (bLine.description && l.description === bLine.description)
    );
    // FIX T1-2: positional fallback is now flagged as low-confidence instead
    // of being silently treated as equivalent to a real id/description match.
    const pLine = exactMatch || poLines[idx];
    if (!pLine) {
      allVars.push({ type: 'UNKNOWN_LINE', severity: 'high', message: `Bill line ${idx + 1} ("${bLine.description||'?'}") has no matching PO line` });
      return;
    }
    if (!exactMatch) {
      allVars.push({ type: 'UNVERIFIED_LINE_MATCH', severity: 'high', message: `Bill line ${idx + 1} ("${bLine.description||'?'}") matched PO line ${idx + 1} by position only — no itemId/description match. Verify manually.` });
    }
    const grnQty = wbList.reduce((sum, wb) => {
      const wbItems = wb.items || [];
      const matched = wbItems.find(wi =>
        (bLine.itemId && wi.id === bLine.itemId) ||
        (bLine.description && wi.description === bLine.description)
      );
      return sum + (Number(matched?.receivedQty ?? matched?.qty) || 0);
    }, 0);
    const result = matchBillLine({ billLine: bLine, poLine: pLine, grnLine: { receivedQty: grnQty }, tolerancePct });
    byLine.push({ billLine: bLine, poLine: pLine, ...result });
    result.variances.forEach(v => allVars.push(v));
  });

  const severity = allVars.reduce((acc, v) => {
    if (v.severity === 'critical') return 'critical';
    if (v.severity === 'high' && acc !== 'critical') return 'high';
    if (v.severity === 'medium' && !acc) return 'medium';
    return acc;
  }, null);
  return { ok: allVars.length === 0, severity, variances: allVars, byLine };
}
```

**Fix — `AccountsPayable.jsx:242-264` (outside the originally-requested file set, but this is the actual exploitable path, so flagging it explicitly rather than fixing only the library half):**

```js
if (selBill.poId || selBill.poNumber) {
  const procurement = db.procurement || { pos: [], waybills: [] };
  const po = (procurement.pos || []).find(p => p.id === selBill.poId || p.poNo === selBill.poNumber);
  if (!po) {
    showToast('⛔ Payment BLOCKED — this bill references a PO that no longer exists. Verify the PO before paying.', 'error');
    return;
  }
  const waybills = (procurement.waybills || []).filter(w => w.poId === po.id || w.poNo === po.poNo);
  const report = matchBill({ bill: selBill, po, waybills });
  if (!report.ok) {
    const decision = decideOnVariance(report);
    if (decision.action === 'block') {
      showToast(`⛔ Payment BLOCKED — ${decision.reason}. Variances: ${report.variances.map(v=>v.message).join('; ')}`, 'error');
      return;
    }
    if (decision.action === 'hold') {
      const proceed = window.confirm(`⚠️ 3-WAY MATCH VARIANCE DETECTED\n\n${report.variances.map(v => `• ${v.message}`).join('\n')}\n\n${decision.reason}\n\nPay anyway? (Admin override)`);
      if (!proceed) return;
    }
  }
}
```

### T1-2 🔴 CRITICAL — Positional fallback matches the wrong PO line

**Where:** `threeWayMatch.js` `matchBill()`, line `... || poLines[idx]`.

When a bill line has no `itemId` and no `description` match against the PO, the code falls back to matching by **array position** (`poLines[idx]`). Suppliers routinely bill in a different line order than the PO. A silent positional match compares unrelated line items (e.g. bill line 1 for cement gets checked against PO line 1 for cable) — producing bogus variances, or worse, a coincidental "match" that hides a real over-billing. This defeats the purpose of 3-way match while still returning `ok: true`. Fixed in the code block above (T1-1) — positional matches now emit an `UNVERIFIED_LINE_MATCH` variance instead of silent trust.

### T1-3 🟠 HIGH — Every journal line rounds to whole ₦ and silently flips sign

**Where:** `glPosting.js` `jLine()` (used by every `journalFrom*` function except stock issues), and separately `inventoryModel.js` `journalFromStockIssue()`.

```js
function jLine(drCode, drName, crCode, crName, ngnAmount, ...) {
  const amt = Math.round(Math.abs(ngnAmount));   // whole Naira only, and silently flips sign
  ...
```

Two problems in one line:
- **Kobo is discarded on every posting.** Every invoice/bill/payment/payroll amount gets rounded to the nearest whole Naira. At any real transaction volume this creates a trial balance that never quite reconciles to the kobo — a classic, guaranteed-to-occur (not edge-case) financial software bug.
- **`Math.abs()` silently corrects a caller's sign mistake instead of surfacing it.** If a caller ever passes a negative amount by mistake (bad data, a Dr/Cr swap bug), this masks it instead of failing loudly.

**Fix:**

```js
function jLine(drCode, drName, crCode, crName, ngnAmount, currency = 'NGN', fxRate = 1, fcAmount = null, memo = '', costCentre = '') {
  const n = Number(ngnAmount);
  if (!Number.isFinite(n)) {
    throw new Error(`jLine: ngnAmount must be a finite number, got ${ngnAmount} (${memo || 'no memo'})`);
  }
  if (n < 0) {
    // A negative amount means the Dr/Cr pair was built backwards upstream —
    // Math.abs() was hiding that bug. Fail loudly instead.
    throw new Error(`jLine: ngnAmount must not be negative (${n}) — check Dr/Cr order in the caller (${memo || 'no memo'})`);
  }
  const amt = Math.round(n * 100) / 100; // FIX: round to kobo (2dp), not whole Naira
  return {
    drCode, drName, crCode, crName,
    amount: amt,
    currency: currency || 'NGN',
    fxRate: Number(fxRate) || 1,
    fcAmount: fcAmount != null ? Math.abs(Number(fcAmount)) : amt,
    memo,
    costCentre: costCentre || '',
  };
}
```

`journalFromDepreciation()` pre-rounds its input before calling `jLine()` (`Math.round(amount), ..., Math.round(amount)`), which now double-rounds against the fix above — drop the outer rounding and let `jLine()` do it:

```js
jLine(
  DEPRECIATION_EXPENSE.code, DEPRECIATION_EXPENSE.name,
  accumDepAcct.code, accumDepAcct.name,
  amount, 'NGN', 1, amount,   // was Math.round(amount) twice
  `Monthly depreciation charge — ${asset.category} — ${periodKey}`,
),
```

`journalFromStockIssue()` in `inventoryModel.js` builds its line manually (it doesn't call `jLine()`) and has the identical whole-₦ rounding bug independently:

```js
// inventoryModel.js — same fix, second location
const total = Math.round((Number(issueQty) || 0) * (Number(unitCost) || 0) * 100) / 100;
```

### T1-4 🟠 HIGH — `valueIssue()` doesn't validate quantity on hand; FIFO branch divides by zero

**Where:** `inventoryModel.js` `valueIssue()`. Confirmed live: `Inventory.jsx:357` calls this with `method: 'wavg'` (the only method actually wired to the UI today).

Two independent bugs in one function:
- **Weighted-average branch (live):** after replaying history to get the current `totalQty`/`unitCost`, the function computes `totalCost: issueQty * unitCost` using the **caller's requested** `issueQty` — never checked against `totalQty` (actual qty on hand). Issuing more than what's on hand is silently accepted, overstates COGS for the phantom quantity, and lets stock go negative. `Inventory.jsx:358` only guards `result.unitCost <= 0`, which doesn't catch a partial over-issue (e.g. 60 on hand, issuing 100).
- **FIFO branch (not reachable via the current UI, but exported and callable):** `totalCost / (issueQty - remaining)` divides by zero — producing `NaN` — whenever there are zero open layers to consume (e.g. issuing stock for an item with no recorded receipts). That `NaN` would flow straight into `journalFromStockIssue()`'s GL amount if this path is ever wired up.

**Fix:**

```js
export function valueIssue(movements, issueQty, method = 'wavg') {
  if (!issueQty || issueQty <= 0) return { unitCost: 0, totalCost: 0, layersConsumed: [], qtyOnHand: 0, insufficientStock: false };

  if (method === 'fifo') {
    const layers = [];
    for (const m of movements) {
      const qty = Number(m.qty) || 0;
      if (m.type === 'RECEIVE' || m.type === 'RETURN' || (m.type === 'ADJUST' && qty > 0)) {
        layers.push({ qty: Math.abs(qty), unitCost: Number(m.unitCost) || 0, refId: m.id });
      } else if (m.type === 'ISSUE' || m.type === 'SCRAP' || (m.type === 'ADJUST' && qty < 0)) {
        let toConsume = Math.abs(qty);
        for (const l of layers) {
          if (toConsume <= 0) break;
          const take = Math.min(l.qty, toConsume);
          l.qty -= take; toConsume -= take;
        }
      }
    }
    const open = layers.filter(l => l.qty > 1e-6);
    const qtyOnHand = open.reduce((s, l) => s + l.qty, 0);
    let remaining = issueQty, totalCost = 0;
    const consumed = [];
    for (const l of open) {
      if (remaining <= 0) break;
      const take = Math.min(l.qty, remaining);
      totalCost += take * l.unitCost;
      consumed.push({ qty: take, unitCost: l.unitCost, refId: l.refId });
      remaining -= take;
    }
    const qtyCosted = issueQty - remaining;
    // FIX: guard the division — was NaN whenever there were no open layers.
    const unitCost = qtyCosted > 0 ? totalCost / qtyCosted : 0;
    return { unitCost, totalCost, layersConsumed: consumed, qtyOnHand, insufficientStock: remaining > 1e-6 };
  }

  let totalQty = 0, totalValue = 0;
  for (const m of movements) {
    const qty = Number(m.qty) || 0;
    if (m.type === 'RECEIVE' || m.type === 'RETURN' || (m.type === 'ADJUST' && qty > 0)) {
      totalQty += Math.abs(qty);
      totalValue += Math.abs(qty) * (Number(m.unitCost) || 0);
    } else if (m.type === 'ISSUE' || m.type === 'SCRAP' || (m.type === 'ADJUST' && qty < 0)) {
      const avg = totalQty > 0 ? totalValue / totalQty : 0;
      totalQty = Math.max(0, totalQty - Math.abs(qty));
      totalValue = Math.max(0, totalValue - Math.abs(qty) * avg);
    }
  }
  const unitCost = totalQty > 0 ? totalValue / totalQty : 0;
  // FIX: cap at qty actually on hand instead of blindly costing the full
  // requested issueQty; report the shortfall so the caller can block/warn.
  const cappedQty = Math.min(issueQty, totalQty);
  return {
    unitCost,
    totalCost: cappedQty * unitCost,
    layersConsumed: [{ qty: cappedQty, unitCost }],
    qtyOnHand: totalQty,
    insufficientStock: issueQty > totalQty + 1e-6,
  };
}
```

`Inventory.jsx:358` (out of scope but the reason this matters) should also check `result.insufficientStock`, not just `unitCost <= 0`.

### T1-6 🟡 MEDIUM — `generateVATSummary()` treats an explicit `0` as "not set"

**Where:** `accounting.js:69`. Currently dead code (see T1-9) but a real logic bug if ever wired up.

```js
const outputVAT = (invoices || []).filter(i => i.status === 'Paid')
  .reduce((s, i) => s + (Number(i.vatAmount) || (Number(i.amount) || 0) * 0.075), 0);
```

`Number(0) || fallback` evaluates to the fallback because `0` is falsy in JS. A legitimately VAT-exempt invoice (`vatAmount: 0`) silently gets 7.5% VAT calculated on its amount anyway.

**Fix:**

```js
const outputVAT = (invoices || []).filter(i => i.status === 'Paid').reduce((s, i) => {
  const vat = i.vatAmount != null ? Number(i.vatAmount) : (Number(i.amount) || 0) * 0.075;
  return s + (Number.isFinite(vat) ? vat : 0);
}, 0);
```

### T1-7 🟡 MEDIUM — `checkReorder()` reports "safely stocked" for undefined quantity

**Where:** `inventoryModel.js` `checkReorder(item, currentQty)`. Live and exported, but no confirmed caller passing bad data today — flagging because the failure mode is dangerous if one ever does.

```js
export function checkReorder(item, currentQty) {
  if (currentQty <= 0)        return { alert: 'BELOW', ... };
  if (currentQty <= rp)       return { alert: 'AT', ... };
  if (currentQty <= rp * 1.2) return { alert: 'NEAR', ... };
  return { alert: 'ABOVE', ... };   // ← falls through here if currentQty is undefined/NaN
}
```

`currentQty` is never coerced with `Number(...)`. If a caller passes `undefined` (a broken quantity feed, a typo'd field name), every comparison against `undefined` is `false`, so the function falls through to `'ABOVE'` — reporting the item as safely stocked when its quantity is actually unknown. For a function whose entire job is flagging low stock, silently defaulting to "all clear" on bad data is backwards.

**Fix:**

```js
export function checkReorder(item, currentQty) {
  const rp = Number(item?.reorderPoint) || 0;
  const ro = Number(item?.reorderQty) || 0;
  const qty = Number(currentQty);
  if (!Number.isFinite(qty)) return { alert: 'UNKNOWN', reorderQty: ro, currentQty: null, reorderPoint: rp };
  if (qty <= 0)        return { alert: 'BELOW', reorderQty: ro, currentQty: qty, reorderPoint: rp };
  if (qty <= rp)        return { alert: 'AT',    reorderQty: ro, currentQty: qty, reorderPoint: rp };
  if (qty <= rp * 1.2)  return { alert: 'NEAR',  reorderQty: ro, currentQty: qty, reorderPoint: rp };
  return                       { alert: 'ABOVE', reorderQty: 0,  currentQty: qty, reorderPoint: rp };
}
```

### T1-8 🟡 MEDIUM — `calculateDepreciation()`: null crash, NaN on zero cost

**Where:** `accounting.js:82-102`. Dead code today (T1-9), fixed for correctness / in case it's revived.

No guard on `asset` itself (`asset.cost` throws on `undefined`). For the reducing-balance method, `residual / cost` is `NaN`/`Infinity` when `cost` is `0`, which propagates through the entire depreciation schedule silently. No validation that `residual <= cost` or `usefulLife > 0`.

**Fix:**

```js
export function calculateDepreciation(asset) {
  if (!asset) return { accumDepr: 0, nbv: 0, annualCharge: 0, error: 'asset is required' };

  const cost = Number(asset.cost) || 0;
  const residual = Math.min(Number(asset.residualValue) || 0, cost); // FIX: cap at cost
  const life = Number(asset.usefulLife) > 0 ? Number(asset.usefulLife) : 5; // FIX: reject life <= 0
  const yearsOwned = asset.purchaseDate
    ? Math.max(0, (new Date() - new Date(asset.purchaseDate)) / (365.25 * 24 * 3600 * 1000))
    : 0;

  if (asset.depreciationMethod === 'reducing') {
    if (cost <= 0) return { accumDepr: 0, nbv: 0, annualCharge: 0 }; // FIX: was NaN via residual/cost
    const rate = 1 - Math.pow(residual / cost, 1 / life);
    const accumDepr = cost * (1 - Math.pow(1 - rate, yearsOwned));
    const nbv = cost - accumDepr;
    return { accumDepr, nbv: Math.max(nbv, residual), annualCharge: nbv * rate };
  }
  const annualCharge = (cost - residual) / life;
  const accumDepr = Math.min(annualCharge * yearsOwned, cost - residual);
  const nbv = cost - accumDepr;
  return { accumDepr, nbv: Math.max(nbv, residual), annualCharge };
}
```

### T1-9 🟡 MEDIUM — `accounting.js` is almost entirely dead code, and its unused GL functions are wrong

This is worth flagging on its own. Grepping every export from `accounting.js` against the rest of `src/`: **only `DEFAULT_COA` is imported anywhere** (`App.jsx:9`, for seeding the chart of accounts). `generateTrialBalance`, `generateProfitAndLoss`, `generateBalanceSheet`, `generateCashFlow`, `generateVATSummary`, `validateJournalEntry`, `calculateDepreciation`, `autoPostInvoice`, `autoPostProcurement`, and `autoPostPayroll` are never called from any component. The live trial balance / P&L / GL-posting logic must live elsewhere (most likely inline in `Accounting.jsx`, per the prior audit doc's note that it's "the single source of truth for the GL").

This matters beyond housekeeping because the file's own header claims *"the double-entry logic... is correct and tested"* — and it isn't, for the unused `autoPost*` trio specifically:

- `autoPostInvoice()` posts `Dr Bank / Cr Accounts Receivable` directly — i.e. it records an invoice as if cash were already collected, with **no revenue line at all**. Compare to the live pattern in `glPosting.js`: `journalFromInvoice()` (Dr AR / Cr Revenue, on raise) + `journalFromReceipt()` (Dr Bank / Cr AR, on collection) as two separate, correct steps. If `autoPostInvoice` were ever wired up, revenue would never post.
- `autoPostPayroll()`'s journal id is `'je_pay_' + Date.now()` — the only non-deterministic id in either file. Every other JE id here is derived from the source record's own id specifically so a re-firing effect can detect "already posted" and skip (see `journalFromDepreciation`'s comment: *"so Accounting.jsx can detect a re-post and skip it"*). A `Date.now()`-based id breaks that invariant — a double-fired effect would post payroll expense twice under two different ids, both accepted.

**Recommendation:** delete `autoPostInvoice`/`autoPostProcurement`/`autoPostPayroll` and point any future caller at the `glPosting.js` equivalents (`journalFromInvoice`/`journalFromAPBill`/`journalFromPayrollRun`) — patching these to add the missing revenue line would just be reinventing functions that already exist correctly. If you want to keep them as a reference, at minimum fix the id:

```js
export function autoPostPayroll(payrollTotal, period, periodKey) {
  return {
    id: 'je_pay_' + (periodKey || period || 'unknown'), // FIX: was Date.now() — broke re-post/dedupe detection
    ...
```

### T1-10 🟢 LOW — Report generators assume every JE has `.lines` (defense-in-depth)

`generateTrialBalance`/`generateProfitAndLoss`/`generateBalanceSheet`/`generateCashFlow` all do `(je.lines || [])`, which throws if `je` itself is `null` — and `glPosting.js`'s `journalFromCreditNote()` and `reverseJournal()` can both return `null`. **Checked and this is not currently live**: both real call sites in `Accounting.jsx` (lines 3131-3132 and 3160-3161) already guard with `if (je && ...)`/`if (rev) {...}` before use. Still worth hardening the shared, exported functions themselves rather than relying on every future caller remembering the guard:

```js
(journalEntries || []).filter(Boolean).forEach(je => {
  (je.lines || []).forEach(line => { ... });
});
```

### T1-11 🟢 LOW — `generateCashFlow()`'s classification is keyword-regex guesswork

Dead code today (T1-9). Operating/investing/financing classification is done by regex-matching keywords in the free-text `je.description` (`/salary|payroll|revenue|.../i` vs `/asset|equipment|vehicle/i`), with anything matching neither defaulting to "financing." A description matching both lists resolves to whichever regex is checked first, silently. If this is ever revived, an explicit `cashFlowCategory` field set by the poster (each `journalFrom*` function already knows what kind of transaction it is) would be far more reliable than text-sniffing — not a quick one-line fix, flagging as a design recommendation rather than a patch.

---

## Task 2 — Supabase DBA Review: Data Leaks & Missing Indexes

Reviewed: all six SQL migrations (`src/supabase/sql/001`–`006`), `client.js`, `storage.js`, `sync.js` (legacy engine), `syncPerRecord.js`, `authBridge.js`, `.env`/`.env.example`, `.gitignore`.

**What's already solid**, briefly, for context: RLS is enabled and `FORCE`d on every table (closes the table-owner-bypass hole), there's a genuine privilege-escalation trigger stopping a user from promoting their own role via a direct API call, the activity log is server-stamped so a user can't spoof who performed an action, `journal_entries`/`activity` are insert-only at the policy level (true DB-level immutability), the storage bucket is private with company-scoped path policies and signed URLs, and the `.env` key in use is the public/publishable anon key (correctly gitignored, not a service-role key). This is a codebase that's already been through at least one serious security pass. The findings below are what's left.

### T2-1 🔴 CRITICAL — No role-based restriction inside a company; any authenticated user can read all payroll/GL data

Every per-record table's RLS policy (`003_per_record_tables.sql`, `005_round2_tables.sql`) is scoped **only by `company_id`**:

```sql
CREATE POLICY "payroll_runs_company_isolation" ON public.payroll_runs
  FOR ALL
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());
```

This is identical for `journal_entries`, `invoices`, `ap_bills`, `fixedassets`, etc. Tenant isolation (company A can't see company B) is solid. But **within** a company, a `viewer` or `cashier` role has exactly the same database-level read/write access as an `admin` — the `role` column in `app_users` (`admin | manager | accountant | cashier | viewer`) is only enforced client-side (`ROLE_PERMS` in `utils/auth.js`). Anyone with a valid session can call the Supabase JS client directly — bypassing the UI entirely — and read `payroll_runs` for the whole company.

This isn't theoretical: `src/supabase/sync.js` (the **currently active** engine — see T2-2) proves the app already does this by design. `loadFromSupabase()` and the pre-write conflict check inside `saveToSupabase()` both pull the **entire** company blob — `db, acct_data, settings, activity` — on every page load and every save, for every user, regardless of role:

```js
const { data, error } = await supabase.from('company_data')
  .select('db, acct_data, settings, activity, updated_at')
  .eq('id', COMPANY_ID).single();
```

A cashier who only ever sees the Petty Cash screen already has the full payroll dataset sitting in their browser's memory every session.

**Fix — example for `payroll_runs` (replicate the pattern for whichever other tables the business wants role-restricted; not all of them necessarily should be — `vendors`/`invoices` likely need to stay broadly readable for approval workflows, so this is a per-table decision, not a blanket one):**

```sql
DROP POLICY IF EXISTS "payroll_runs_company_isolation" ON public.payroll_runs;

CREATE POLICY "payroll_runs_read_privileged" ON public.payroll_runs FOR SELECT
  USING (
    company_id = public.get_my_company_id()
    AND EXISTS (SELECT 1 FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'Active' AND role IN ('admin','accountant'))
  );

CREATE POLICY "payroll_runs_write_privileged" ON public.payroll_runs FOR ALL
  USING (
    company_id = public.get_my_company_id()
    AND EXISTS (SELECT 1 FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'Active' AND role IN ('admin','accountant'))
  )
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND EXISTS (SELECT 1 FROM public.app_users WHERE auth_user_id = auth.uid() AND status = 'Active' AND role IN ('admin','accountant'))
  );
```

### T2-2 🔴 CRITICAL — This deployment is running the legacy whole-blob sync engine

Verified in the actual `.env` (not just `.env.example`): `VITE_USE_PER_RECORD_SYNC` is **not set**. `usePerRecordSync.js:28` does a strict check — `=== 'true'` — so anything other than the literal string `'true'` (including unset) falls back to the legacy engine. This SLOT ERP instance is therefore running `sync.js`, not `syncPerRecord.js`, right now.

The codebase's own comments describe exactly why that matters — `syncPerRecord.js`'s file header calls the blob model *"the Tier-1 data-architecture fix called out in the independent audit"* and `.env.example` documents the legacy mode as having *"known concurrency limitations where two simultaneous saves silently overwrite each other."* Migrations 003-006 already built the safer schema; it's just not switched on.

**Fix:** confirm migrations 003-006 have been applied to the live Supabase project, run the backfill (`backfillFromBlob()`), then set `VITE_USE_PER_RECORD_SYNC=true` in the real `.env` and redeploy. This is a config/ops change, not a code change.

### T2-3 🟠 HIGH — `(company_id, voided)` index missing on most tables

Of the 15 per-record tables with a `voided` column, only 3 (`invoices`, `terminal_bols`, `terminal_advances`) have an index that includes it. The other 12 (`ar_receipts`, `ap_bills`, `ap_payments`, `pettycash`, `fixedassets`, `terminal_charges`, `payroll_runs`, `fleet_repairs`, `stock_items`, `stock_movements`, `sales_orders`, `recurring_templates`, `attachments`) only have `(company_id)` and `(company_id, updated_at)`. Given every list view in this app filters "active" vs "voided" records, this looks like an oversight where the pattern from migration 003's first table wasn't carried through the rest of 003 and all of 005.

**Fix** — partial index (smaller and faster than a plain 2-column btree, since `voided = false` is the dominant filter for list views):

```sql
CREATE INDEX IF NOT EXISTS idx_ar_receipts_active_updated       ON public.ar_receipts(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_ap_bills_active_updated          ON public.ap_bills(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_ap_payments_active_updated       ON public.ap_payments(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_pettycash_active_updated         ON public.pettycash(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_fixedassets_active_updated       ON public.fixedassets(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_terminal_charges_active_updated  ON public.terminal_charges(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_payroll_runs_active_updated      ON public.payroll_runs(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_fleet_repairs_active_updated     ON public.fleet_repairs(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_stock_items_active_updated       ON public.stock_items(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_stock_movements_active_updated   ON public.stock_movements(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_sales_orders_active_updated      ON public.sales_orders(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_recurring_templates_active_updated ON public.recurring_templates(company_id, updated_at DESC) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_attachments_active_updated       ON public.attachments(company_id, updated_at DESC) WHERE voided = false;
```

Note: the app's current `loadAll()` doesn't yet filter server-side by `voided` (it loads everything and filters client-side), so these indexes are prep for T2-6's pagination fix as much as for today's queries — worth doing together.

### T2-4 🟡 MEDIUM — `sync.js` conflict check has a check-then-write race window

Already self-documented in the file's own comments (*"This is a check-then-write, not an atomic compare-and-swap... there's a small race window between the check and the upsert"*) — not claiming this as an undiscovered bug, just proposing the stronger fix since a DBA review is exactly where it belongs: collapse the separate check + upsert into one atomic conditional `UPDATE`, so Postgres itself enforces the compare-and-swap instead of two round-trips with a gap between them.

```js
export async function saveToSupabase(db, acctData, settings, activity) {
  const payload = { id: COMPANY_ID, db: db||{}, acct_data: acctData||{}, settings: settings||{}, activity: activity||[], updated_at: new Date().toISOString() };
  if (!supabase || !isOnline()) { enqueue(payload); return { ok: false, queued: true }; }

  const expected = getLastServerTs();
  try {
    rememberPendingSelfWrite(payload.updated_at);
    if (expected) {
      // Atomic CAS: only updates the row if updated_at still matches what we last saw.
      const { data, error } = await supabase.from(TABLE).update(payload).eq('id', COMPANY_ID).eq('updated_at', expected).select('updated_at');
      if (error) throw error;
      if (!data || data.length === 0) {
        const { data: current } = await supabase.from(TABLE).select('updated_at, db, acct_data, settings, activity').eq('id', COMPANY_ID).single();
        return { ok: false, conflict: true, serverData: current ? { db: current.db||{}, acctData: current.acct_data||{}, settings: current.settings||{}, activity: current.activity||[], updatedAt: current.updated_at } : null };
      }
    } else {
      const { error } = await supabase.from(TABLE).upsert(payload, { onConflict: 'id' });
      if (error) throw error;
    }
    clearQueue();
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    setLastServerTs(payload.updated_at);
    return { ok: true, queued: false };
  } catch (e) {
    console.warn('[SLOT ERP] Supabase save failed — queued for retry:', e.message);
    pendingSelfWriteTs.clear();
    enqueue(payload);
    return { ok: false, queued: true };
  }
}
```

### T2-5 🟡 MEDIUM — `loadAll()`/`saveAll()` await sequentially instead of in parallel

**Where:** `syncPerRecord.js:141-163` and `124-134`. Both loop over the ~17 tables in `RECORD_TABLES` with a plain `for...of` and `await` inside — one network round-trip after another, not `Promise.all`. On login/refresh this adds real, avoidable latency (17× round-trip time, easily 1-2+ seconds), and `saveAll()` does the same nested per-record.

**Fix:**

```js
export async function loadAll() {
  if (!supabase) return null;
  const out = { terminal: {}, fleet: {} };
  const entries = await Promise.all(Object.keys(RECORD_TABLES).map(async key => {
    try {
      const { data, error } = await supabase.from(RECORD_TABLES[key]).select('id, data, voided, updated_at').eq('company_id', COMPANY_ID);
      if (error) throw error;
      return [key, (data || []).map(r => ({ ...r.data, _updated_at: r.updated_at, _voided: r.voided }))];
    } catch (e) {
      console.warn(`[SLOT] Per-record load failed for ${RECORD_TABLES[key]}:`, e?.message);
      return [key, []];
    }
  }));
  for (const [key, records] of entries) {
    if (key === 'terminalCharges')       out.terminal.charges  = records;
    else if (key === 'terminalBols')     out.terminal.bols     = records;
    else if (key === 'terminalAdvances') out.terminal.advances = records;
    else if (key === 'fleetRepairs')     out.fleet.repairs     = records;
    else                                 out[key] = records;
  }
  return out;
}

export async function saveAll(db) {
  const perTable = await Promise.all(Object.keys(RECORD_TABLES).map(async key => {
    const list = getRecordList(db, key);
    const results = [];
    for (const rec of list) {
      const r = await saveRecord(key, rec);
      results.push({ table: RECORD_TABLES[key], id: rec?.id, ...r });
    }
    return results;
  }));
  return perTable.flat();
}
```

### T2-6 🟢 LOW — No pagination or date-bounding on full-history loads

`loadAll()` and `loadJournals()` fetch every row for the company, unfiltered and unbounded (`loadActivity()` at least has a `limit`). Indexing quality won't stop these from getting slower as history accumulates — once `journal_entries` or `stock_movements` cross tens of thousands of rows per company, every login pays for the full table. Illustrative fix for `loadJournals()`:

```js
export async function loadJournals({ sinceIso = null, limit = 5000 } = {}) {
  if (!supabase) return [];
  try {
    let q = supabase.from('journal_entries').select('id, data, period_key, source, created_at')
      .eq('company_id', COMPANY_ID).order('created_at', { ascending: true }).limit(limit);
    if (sinceIso) q = q.gte('created_at', sinceIso);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(r => r.data);
  } catch (e) {
    console.warn('[SLOT] Journal load failed:', e?.message);
    return [];
  }
}
```

---

## Task 3 — Supabase Edge Functions (ERP business logic)

Firebase Cloud Functions don't exist in this codebase (see scope note at top). Reviewed the three actual serverless functions: `supabase/functions/{create-user,notify,update-user-password}/index.ts`.

### T3-1 🟠 HIGH — `update-user-password`: CORS allowlist is built but never applied

The file defines a proper origin allowlist for the preflight response:

```ts
function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0], ... };
}
```

...but the `json()` helper used for **every actual response** (success and error alike) hardcodes a wildcard instead of using it:

```ts
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },  // ← ignores ALLOWED_ORIGINS entirely
  });
}
```

So the allowlist only ever protects the empty `OPTIONS` preflight response — the response that actually carries data (including the success/failure of a password change) goes out with `*`. The sibling function `notify/index.ts` shows the correct pattern (`headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }`) — this fix brings `update-user-password` in line with it. Full corrected file:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGINS = [
  'https://erp.slotengineering.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }, // FIX: was a hardcoded '*'
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(req, { error: 'Missing Authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json(req, { error: 'Server misconfigured — missing Supabase env vars' }, 500);
    }

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: callerAuth, error: callerAuthError } = await callerClient.auth.getUser();
    if (callerAuthError || !callerAuth?.user) return json(req, { error: 'Could not verify caller identity' }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerProfile, error: callerProfileError } = await adminClient
      .from('app_users').select('role, status').eq('auth_user_id', callerAuth.user.id).single();

    if (callerProfileError || !callerProfile) return json(req, { error: 'Caller has no linked SLOT ERP profile' }, 403);
    if (callerProfile.role !== 'admin' || callerProfile.status !== 'Active') {
      return json(req, { error: 'Only active admins can change another user\'s password' }, 403);
    }

    const { authUserId, newPassword } = await req.json();
    if (!authUserId || !newPassword) return json(req, { error: 'authUserId and newPassword are required' }, 400);
    if (typeof newPassword !== 'string' || newPassword.length < 12) {
      return json(req, { error: 'Password must be at least 12 characters' }, 400);
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9!@#$%^&*()_+]/.test(newPassword)) {
      return json(req, { error: 'Password must contain uppercase, lowercase, and a digit or symbol' }, 400);
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(authUserId, { password: newPassword });
    if (updateError) return json(req, { error: updateError.message }, 400);

    return json(req, { success: true });
  } catch (err) {
    return json(req, { error: err?.message || 'Unexpected server error' }, 500);
  }
});
```

### T3-2 🟠 HIGH — `create-user`: no top-level `try/catch`

Unlike its two sibling functions (both of which wrap their whole handler body), `create-user/index.ts` has no outer `try/catch`. Any unexpected throw — a network blip calling `auth.getUser()`, a transient error on the `app_users` select/insert/`createUser` calls — becomes an unhandled rejection. Deno's default handler for that returns a raw, non-CORS'd response, which the browser reports as an opaque CORS failure with no usable error message, and can leak a stack trace to the client.

Also missing: the env-var presence check that both siblings already have. `SUPABASE_URL!`/`ANON_KEY!`/`SERVICE_ROLE_KEY!` use TypeScript's non-null assertion (`!`), which does nothing at runtime — if a secret is actually missing, `createClient()` gets called with `undefined` and fails later with a confusing error instead of a clean 500.

This also folds in the fix for **T3-3 🟡 MEDIUM** (below): the compensating `deleteUser()` rollback after a failed `app_users` insert isn't currently verified — if the delete itself fails, you're left with an orphaned Auth login (valid credentials, no company/role/profile) and the caller has no way to tell the difference from an ordinary validation error. True DB transactions can't span GoTrue (Auth) and Postgres here, so the fix isn't "wrap it in a transaction" — it's verifying the rollback and surfacing a distinct, actionable error when it fails.

**Fix (full corrected function):**

```ts
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {          // FIX: was `!`-asserted, not actually checked
    return json({ error: 'Server misconfigured — missing Supabase env vars' }, 500);
  }

  try {                                                            // FIX: whole body now guarded
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header — sign in and try again' }, 401);

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json({ error: 'Your session has expired — sign in again' }, 401);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: callerProfile, error: callerProfileErr } = await adminClient
      .from('app_users').select('role, status, company_id').eq('auth_user_id', caller.id).single();

    if (callerProfileErr || !callerProfile) return json({ error: 'No SLOT ERP profile is linked to your account' }, 403);
    if (callerProfile.status !== 'Active') return json({ error: 'Your account is not active' }, 403);
    if (callerProfile.role !== 'admin') return json({ error: 'Only admins can create new users' }, 403);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const role = typeof body.role === 'string' ? body.role : 'viewer';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : null;
    const modules = Array.isArray(body.modules) ? body.modules : [];
    const username = (typeof body.username === 'string' && body.username.trim() ? body.username.trim() : email.split('@')[0])
      .toLowerCase().replace(/[^a-z0-9._]/g, '');

    if (!email || !password || !name) return json({ error: 'Name, email, and password are required' }, 400);
    if (password.length < 12) return json({ error: 'Password must be at least 12 characters' }, 400);
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9!@#$%^&*()_+]/.test(password)) {
      return json({ error: 'Password must contain uppercase, lowercase, and a digit or symbol' }, 400);
    }
    if (!VALID_ROLES.includes(role)) return json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}` }, 400);

    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true });
    if (createErr) {
      const msg = /already.*registered|already exists/i.test(createErr.message || '') ? 'A login already exists for this email' : createErr.message;
      return json({ error: msg }, 400);
    }

    const { data: profile, error: linkErr } = await adminClient
      .from('app_users')
      .insert({ company_id: callerProfile.company_id, auth_user_id: created.user.id, username, name, email, phone, role, modules, status: 'Active' })
      .select().single();

    if (linkErr) {
      const { error: rollbackErr } = await adminClient.auth.admin.deleteUser(created.user.id);  // FIX: now checked
      if (rollbackErr) {
        console.error(`[create-user] ORPHANED AUTH ACCOUNT ${created.user.id} (${email}) — insert failed AND rollback failed: ${rollbackErr.message}`);
        return json({ error: `Account creation failed and cleanup also failed — contact support with this email: ${email}` }, 500);
      }
      const msg = /duplicate/i.test(linkErr.message || '') ? 'A profile already exists for this email' : linkErr.message;
      return json({ error: msg }, 400);
    }

    return json({ success: true, profile });
  } catch (err) {
    console.error('create-user error:', err);
    return json({ error: err?.message || 'Unexpected server error' }, 500);
  }
});
```

### T3-4 🟡 MEDIUM — `notify`: outbound SendGrid/Twilio calls have no timeout

`sendEmail`/`sendSMS`/`sendWhatsApp` each `fetch()` an external API with no timeout. If SendGrid or Twilio hangs, the call ties up the entire function invocation for the platform's full request timeout instead of failing fast — under a provider outage, many simultaneous hung invocations compete for the function's concurrency, which is the practical equivalent of a memory/resource leak in a stateless Edge Function.

**Fix (same one-line addition to all three `fetch()` calls in this file):**

```js
const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ ... }),
  signal: AbortSignal.timeout(10_000), // FIX: fail fast instead of hanging for the platform's full timeout
});
```

### T3-5 🟢 LOW — `notify`: malformed JSON body returns 500 instead of 400

`const body = await req.json();` (line 94) isn't individually try/catched, so a malformed body falls through to the outer catch and comes back as a 500 — miscategorizing a client error as a server error, which matters for monitoring/alerting and for callers that treat 5xx as "safe to retry."

```js
let body;
try { body = await req.json(); } catch { return json(req, { error: 'Invalid request body' }, 400); }
const { channel, event } = body || {};
```

### T3-6 ℹ️ INFO — No genuine memory-leak patterns found

Checked all three functions for the classic serverless memory-leak shape — module-level mutable state that accumulates across invocations (Supabase Edge Function isolates are reused between requests). None of the three have any top-level `let`/growing array/Map/uncleared timer — `corsHeaders`, `ALLOWED_ORIGINS`, `VALID_ROLES` are constants, and all mutable state is request-scoped inside the handler. Noting this explicitly rather than manufacturing a finding to fill the category — the closest real issue is T3-4 (hung requests under provider failure), which is resource-exhaustion-flavored but not a leak in the traditional sense.

### T3-7 🟢 LOW — `app_users.email` has no UNIQUE constraint (schema note, found while reading `create-user`)

`001_schema.sql` declares `email TEXT NOT NULL` with only a non-unique index (`lower(email)`). Uniqueness today is enforced indirectly, only via Supabase Auth's own unique-email constraint on `auth.users` (since `auth.admin.createUser()` rejects a duplicate). That protects against two rows pointing at the same *auth* account, but not against two `app_users` rows independently carrying the same email string via other paths (manual inserts, an auth account later deleted and recreated). Worth a real constraint:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique ON public.app_users (company_id, lower(email));
```

---

## Suggested next step

`accounting.js` (Task 1) turned out to be dead code — the live trial balance / P&L / GL engine almost certainly lives inline in `Accounting.jsx`, which wasn't in the original scope for this pass. Given T1-9's finding, that component is probably worth the same review if you want the calculation logic that's actually running checked, not just the unused module.

---

## Addendum — `utils/accounting.js`: is it needed? (follow-up, 2026-07-23)

**Verdict: safe to delete.** Traced three separate ways, not just by checking imports:

1. **No function from `accounting.js` is called anywhere** except `DEFAULT_COA`, imported once in `App.jsx:9`.
2. **That one import is itself dead.** `App.jsx` never references `DEFAULT_COA` again after the import line — it's imported and unused. So in practice, *zero* exports of this file do anything at runtime today.
3. **`Accounting.jsx` already has its own, independent, correct replacement for every single export:**
   - `DEFAULT_COA` → `Accounting.jsx:144`, a real 90-account chart of accounts sourced from the company's actual Sage export (*"CURRENT General Ledger Chart of Accounts_20260529_123438.xlsx"*), with real bank accounts and opening balances (e.g. Access Bank ₦42,500,000). `glPosting.js`'s hardcoded account codes (6002, 7001, 8001, 9001, 200102, etc.) match *this* COA, not `accounting.js`'s 15-account placeholder — confirming `glPosting.js` was built against the real COA and `accounting.js` was left behind by an earlier refactor.
   - `generateTrialBalance` → `getTrialBalance()` (`Accounting.jsx:476`), live, wired to the Trial Balance tab.
   - `generateBalanceSheet` → `getBalanceSheet()` (`Accounting.jsx:531`), live, wired to the Balance Sheet tab.
   - `generateProfitAndLoss` → the live P&L Statement feature (`Accounting.jsx` ~line 1517).
   - `autoPostInvoice`/`autoPostProcurement`/`autoPostPayroll` → superseded by the correct `journalFrom*` functions in `glPosting.js`, which are what's actually wired to `Accounting.jsx`'s posting effect.

Nothing in `utils/accounting.js` is a missing feature waiting to be revived — it's an orphaned first draft, and the version that replaced it (inline in `Accounting.jsx`) is what the app has actually been running on.

**Recommended action:** delete `src/utils/accounting.js`; remove the unused `import { DEFAULT_COA } from './utils/accounting'` in `App.jsx:9`.

**Worth doing at the same time (optional, arguably higher-value than the deletion itself):** `glPosting.js`'s account codes are kept in sync with `Accounting.jsx`'s COA only by a comment (*"must match DEFAULT_COA in Accounting.jsx exactly"*) — there's no code-level enforcement. Moving the real 90-account COA out of `Accounting.jsx` and into a shared module (e.g. repurposing the now-empty `src/utils/accounting.js`, or `financeConstants.js`) that both `Accounting.jsx` and `glPosting.js` import would close that drift risk permanently instead of relying on the comment holding forever.

**Bonus finding — unrelated to the dead-code question, found while reading the real COA:** `Accounting.jsx`'s live 90-account chart of accounts has a duplicate code. `5010` is assigned to two different accounts:

```js
{code:"5010", name:"NHF Payable",      type:"Liability", ...},  // Accounting.jsx:212
{code:"5010", name:"Purchase Accrual", type:"Liability", ...},  // Accounting.jsx:213
```

Any code that indexes the COA by `code` as a key (the exact pattern the dead `generateTrialBalance` used: `accounts[line.account] = {...}`) will let one of these silently shadow the other, and any GL posting to `5010` is ambiguous between an NHF withholding liability and a purchase accrual — two unrelated things. This needs an actual chart-of-accounts decision (which one keeps `5010`, what the other gets renumbered to), not a guess from me.

Lower-confidence, same COA: `9026 Development Levy` is typed `Liability` while sitting in the middle of a block of `Expense`-type admin accounts (9025, 9027...). May be intentional (accrues before it hits P&L) or may be a data-entry slip — worth a glance from whoever owns the chart of accounts.

### Actions taken (approved by Yemi — delete + wire glPosting.js to the real COA; NHF Payable keeps 5010)

- **Created `src/utils/chartOfAccounts.js`** — the real 90-account COA, moved out of `Accounting.jsx`, now the single source of truth. Exports `DEFAULT_COA`, `COA_BY_CODE`, `isKnownAccount()`, `getAccountName()`.
- **Fixed both duplicate-code bugs during the move**: `5010` (Purchase Accrual → renumbered to `5013`, free code; NHF Payable keeps `5010` per Yemi's call — this also matches what `glPosting.js`'s `NHF_PAYABLE` constant already assumed) and the `2000`-`2005` block (dropped the 6 flat duplicates, kept the detailed versions with the Cost/Accumulated-Depreciation sub-accounts glPosting.js's depreciation postings use). Also fixed the same `5010`→`5013` duplicate in the separate `SAGE_COA_ACCOUNTS` import-mapping table inside `Accounting.jsx` for consistency.
- **`Accounting.jsx`** now imports `DEFAULT_COA` from the shared module instead of defining its own local copy.
- **`App.jsx`**: removed the dead `import { DEFAULT_COA } from './utils/accounting'` line.
- **`glPosting.js`**: imports `isKnownAccount()` from the shared module and now runs a validation pass at module load that `console.error`s if any account code referenced in the file doesn't exist in the real COA — turning the old "must match DEFAULT_COA in Accounting.jsx exactly" comment into an enforced, immediate check instead of an honor system. Verified clean: every code currently referenced in `glPosting.js` exists in the consolidated COA.
- **`src/utils/accounting.js`**: could not be physically deleted (no shell access in this session — the sandbox is out of disk space). Replaced its contents with an empty, clearly-labeled stub (`export {};` plus a comment explaining what replaced it), matching the same pattern already used in this codebase for `src/firebase/config.js`. Nothing imports it anymore — confirmed by grep. It's safe to delete the file outright whenever there's normal file-system access; nothing depends on it.

Not touched in this pass (still just recommendations in the sections above, not applied): the `jLine()` rounding/sign fix, the three-way-match bypass fixes, the RLS role-restriction policies, and everything else in Tasks 1-3 outside this specific COA cleanup.

### Second round — applied 2026-07-23

Everything fixable by editing files directly has now been applied:

- **T1-1, T1-2, T1-5** (`threeWayMatch.js`, `AccountsPayable.jsx`): `matchBill()`'s `NO_PO_LINK` return now carries `severity: 'critical'`; positional line-matching now emits `UNVERIFIED_LINE_MATCH` instead of silent trust; `waybills` is coerced to an array instead of trusting the default param. `AccountsPayable.jsx` now blocks payment (with a toast) when a bill references a PO that can't be resolved, instead of silently skipping the match.
- **T1-3** (`glPosting.js`, `inventoryModel.js`): `jLine()` now rounds to kobo (2dp) instead of whole Naira, and throws on a negative or non-finite amount instead of silently `Math.abs()`-ing it. `journalFromDepreciation()`'s redundant outer rounding removed. `journalFromStockIssue()`'s matching whole-Naira rounding fixed the same way.
- **T1-4** (`inventoryModel.js`): `valueIssue()`'s FIFO branch no longer divides by zero when there are no open layers; the weighted-average branch now caps the costed quantity at what's actually on hand and returns `qtyOnHand`/`insufficientStock` instead of silently costing the full requested (possibly over-issued) quantity.
- **T3-1** (`update-user-password/index.ts`): `json()` now uses `corsHeaders(req)` (the real origin allowlist) instead of a hardcoded `'*'`.
- **T3-2, T3-3** (`create-user/index.ts`): whole handler now wrapped in `try/catch`; env vars are checked before use instead of `!`-asserted; the compensating `deleteUser()` rollback is now verified, with a distinct error surfaced if it also fails.
- **T3-4, T3-5** (`notify/index.ts`): all three outbound `fetch()` calls (SendGrid, Twilio SMS, Twilio WhatsApp) now have a 10s timeout; a malformed request body now returns 400 instead of falling through to a 500.
- **T2-4** (`sync.js`): `saveToSupabase()`'s check-then-write replaced with a single atomic conditional `UPDATE` (CAS via `.eq('updated_at', expected)`), closing the TOCTOU race window.
- **T2-5** (`syncPerRecord.js`): `loadAll()` and `saveAll()` now run their ~17 tables in parallel via `Promise.all` instead of sequentially.
- **T2-6** (`syncPerRecord.js`): `loadJournals()` now accepts optional `sinceIso`/`limit` params (backward-compatible, defaults preserve current behavior) instead of always pulling the entire table.

**Still outstanding — these need action on the live Supabase project, not just a file edit:**

- **T2-1** — role-based RLS policies (e.g. restricting `payroll_runs` to admin/accountant) need to be run in the Supabase SQL editor. Business decision on which tables/roles is still open.
- **T2-2** — switching off the legacy blob-sync engine needs migrations 003-006 confirmed applied + backfill run, then `VITE_USE_PER_RECORD_SYNC=true` set and redeployed.
- **T2-3** — the `(company_id, voided)` partial indexes need to be run in the Supabase SQL editor.
- **T3-7** — the `app_users` email UNIQUE constraint needs to be run in the Supabase SQL editor.

All the ready-to-run SQL for these four is already in the sections above.

### Troubleshooting notes — T2-1 and T3-7 (2026-07-23)

- **T2-1**: the original SQL was correct; the `policy "payroll_runs_company_isolation" already exists` error Yemi hit came from re-running `003_per_record_tables.sql` itself (not idempotent for its `CREATE POLICY` statements), not from this fix. Confirmed migrations 003/005 are applied to the live project. The T2-1 SQL above now also `DROP POLICY IF EXISTS`s its own two new policy names first, so it's safe to re-run.
- **T3-7**: hit `could not create unique index — duplicate key ... (slot-engineering-nigeria, admin@slotengineering.com) is duplicated`. Root cause: `001_schema.sql`'s seed insert uses `ON CONFLICT DO NOTHING` with no conflict target — since `id` is a fresh random UUID each time and there was no unique constraint on email (the exact gap this fix closes), that guard never had anything to catch, so re-running the seed created a second admin row. Resolved by ranking duplicate rows (preferring the one with a linked `auth_user_id`, then `status = 'Active'`, then most recent) and deleting the non-kept row, confirmed with Yemi before running. The unique index should apply cleanly after that.

---

## Pre-handoff data wipe (2026-07-23)

Before handing the app to SLOT, Yemi asked to clear all data so the client starts from zero and enters everything through the app's own upload/import flow going forward.

**Mechanism used:** the app already has a purpose-built wipe — `Backup.jsx`'s "Danger Zone → Wipe All Data" (admin-only, double-confirmed via a `window.confirm` + a "type DELETE ALL" prompt). Reused it rather than hand-writing destructive SQL, since it already: clears every `bc_*`/`slot_*` localStorage key; resets clients/vendors/projects; writes a seed-version gate + `WIPE_FLAG_KEY` so the per-module demo-data fallbacks (Procurement, Fleet, Petty Cash, Sales Orders, AR, Invoices, Fixed Assets, Accounting) don't silently repopulate; and pushes the empty dataset to the live Supabase `company_data` blob table via `saveDBCloud`. Confirmed the app is running in **legacy blob-sync mode** (`VITE_USE_PER_RECORD_SYNC` unset in the real `.env` — see T2-2), so that last step is the one that actually matters for this instance's cloud data.

**Pre-wipe diagnostics (read-only), run in the Supabase SQL editor:**
- All 21 per-record tables (`invoices`, `ar_receipts`, `ap_bills`, `ap_payments`, `pettycash`, `fixedassets`, `terminal_charges`, `terminal_bols`, `terminal_advances`, `payroll_runs`, `fleet_repairs`, `journal_entries`, `vendors`, `clients`, `projects`, `stock_items`, `stock_movements`, `sales_orders`, `recurring_templates`, `activity`, `attachments`) — **all 0 rows.** Confirms the per-record tables were never backfilled, consistent with T2-2 never having been actioned.
- `storage.objects` for the `scanner-docs` bucket — **empty.** No documents were ever scanned/uploaded, so there was nothing to clear there.
- `app_users` — 3 rows: the real `admin@slotengineering.com` (SLOT Admin), plus two personal-Gmail test accounts Yemi created while testing (`uncomfortableforex@gmail.com` / accountant, `femite80@gmail.com` / manager). The two test accounts were removed: their `app_users` rows via a targeted `DELETE ... WHERE id IN (...)`, and their actual Supabase Auth logins via the Dashboard (Authentication → Users) — the SQL delete alone only removes the app profile, not the credential itself.

**Opening-balance investigation:** the Accounting Overview kept showing non-zero Cash & Bank (₦82,550,000), Trade Receivables (₦45,200,000), and Trade Payables (₦5,780,000) even with Journal Entries empty. Traced to `getAccountBalance()` (`Accounting.jsx:252`), which seeds each account's balance from `coa[].openingBal` before summing journal lines — so these were never transactional data, they're **opening balances baked into the chart of accounts itself** (`chartOfAccounts.js`), which the wipe correctly preserves as configuration (`coa: state.acctData?.coa || []`). Found 11 accounts carrying non-zero opening balances (7 named Nigerian bank accounts, Trade Receivables, Trade Payables, Retained Earnings), balancing exactly to ₦127,750,000 Dr = Cr. Confirmed with Yemi: these are SLOT's real Sage-derived opening trial balance, not placeholder data — kept as-is, no code change needed.

**Deployment (before the final wipe, so the clean state runs on the fixed code, not the pre-audit version):**
- `npm run build && firebase deploy` — ships this session's source fixes (three-way match, `glPosting.js`, `inventoryModel.js`, `chartOfAccounts.js` consolidation, `sync.js`/`syncPerRecord.js`) to the live Firebase-hosted frontend. Confirmed `firebase.json` only configures static hosting (`dist/`) — Supabase remains the actual backend.
- `supabase functions deploy` for `create-user`, `update-user-password`, and `notify` — the three Edge Function fixes (T3-1 through T3-5) live outside the frontend bundle and needed this separate step.

**Result:** wipe executed and confirmed working as intended — the app reset cleanly (transactional data, journals, local storage all cleared; demo-data fallbacks correctly suppressed by `WIPE_FLAG_KEY`), while the chart of accounts (with SLOT's real opening balances), company settings, approval rules, and the one legitimate admin login all persisted, exactly as designed. The Accounting Overview still showing ₦82.5M/₦45.2M/₦5.78M after the wipe is expected — that's the preserved real opening position, not leftover demo data.
