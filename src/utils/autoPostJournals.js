// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — shared GL auto-posting logic
//
// Extracted out of Accounting.jsx on 2026-08-14. Previously this ~300-line
// routine only ran as a useEffect scoped to the Accounting module component —
// meaning it only converted invoices / AP bills / purchase invoices / petty
// cash / fixed assets / etc. into journal entries once someone actually opened
// Accounting in that browser session. Every other report or module that reads
// state.acctData.journals (Sage Reports' Comparative P&L, for instance) would
// silently show an incomplete ledger until then — confirmed live: Comparative
// P&L showed Total Expenses ₦153,676,894 (missing ₦9,151,490 of "Other Direct
// Cost" from 5 unposted purchase invoices) until Accounting was opened once,
// at which point it corrected itself to the true ₦162,828,384 with no error
// or indication anything had been missing.
//
// This file now holds the pure computation (existing journals + source
// records in → updated journals array out) so it can run from TWO places:
//   1. Accounting.jsx's own effect — unchanged behavior, still re-runs live
//      while the module is mounted so edits/voids reflect instantly.
//   2. AppContext.jsx, once after the initial db/acctData load — so the
//      ledger is always complete regardless of which module the user opens
//      first in a session.
// Both call sites are idempotent (every posted JE has a deterministic ID and
// is skipped if already present), so running it from two places is safe —
// whichever runs second just finds nothing new to add.
// ══════════════════════════════════════════════════════════════════════════════
import { journalFromPurchaseInvoice, journalFromInvoice, journalFromReceipt, journalFromAPBill, journalFromAPPayment, journalFromPettyCash, journalFromFixedAsset, journalFromDepreciation, journalFromTerminalCharge, journalFromAdvanceReceipt, journalFromAdvanceApplication, journalFromPayrollRun, journalFromPayrollPayment, journalFromFleetRepair, journalFromStockIssue, journalFromCreditNote, reverseJournal } from "./glPosting";
import { periodOf, isPeriodClosed, isYearClosed } from "./periods";

// computeAutoPostedJournals(existingJournals, db, appSettings) → journals array
// Returns the SAME array reference if nothing changed (so callers can cheaply
// check `result === existingJournals` to skip a no-op state update/dispatch).
export function computeAutoPostedJournals(existingJournals, db, appSettings) {
  const js = existingJournals || [];
  const invoices    = db?.invoices    || [];
  const receipts     = db?.arReceipts  || [];
  const creditNotes  = db?.creditNotes  || [];
  const apBills      = db?.ap?.bills    || [];
  const purchaseInvoices = db?.procurement?.invoices || [];
  const apPayments   = db?.ap?.payments || [];
  const pettycash    = db?.pettycash    || [];
  const fixedassets  = db?.fixedassets  || [];
  const terminalCharges = db?.terminal?.charges || [];
  const terminalAdvances = db?.terminal?.advances || [];
  const stockMovements   = db?.stockMovements || [];
  const payrollRuns  = db?.payrollRuns  || [];
  const fleetRepairs = db?.fleet?.repairs || [];

  if (!invoices.length && !receipts.length && !creditNotes.length && !apBills.length && !apPayments.length && !purchaseInvoices.length
      && !pettycash.length && !fixedassets.length && !terminalCharges.length && !terminalAdvances.length && !stockMovements.length && !payrollRuns.length && !fleetRepairs.length) return js;

  const byId    = new Map(js.map(j => [j.id, j]));
  const ids     = new Set(js.map(j => j.id));
  const toAdd   = [];
  const settings = appSettings || {};
  const fyStart = settings?.accounting?.fiscalYearStart || settings?.system?.fiscalYearStart || 'January';

  // ── Period guard ──────────────────────────────────────────────────────
  const blocked = []; // { recordId, periodKey, reason }
  const tryPost = (je, record, reason) => {
    if (!je) return false;
    const p = periodOf(je.date, fyStart);
    je.periodKey = p.periodKey;
    if (isPeriodClosed(p.periodKey, settings)) {
      blocked.push({ recordId: record?.id, periodKey: p.periodKey, reason: reason || 'period-closed' });
      return false;
    }
    if (isYearClosed(p.fy, settings)) {
      blocked.push({ recordId: record?.id, periodKey: p.periodKey, reason: reason || 'year-closed' });
      return false;
    }
    return true;
  };

  const postReversalIfNeeded = (record, jeId) => {
    if (!record.voided) return;
    const revId = `${jeId}-REV`;
    if (ids.has(jeId) && !ids.has(revId)) {
      const rev = reverseJournal(byId.get(jeId), 'Record voided');
      if (rev) { toAdd.push(rev); ids.add(revId); }
    }
  };

  // ── AR Invoices ─────────────────────────────────────────────────────
  invoices.forEach(inv => {
    const newId = `JE-AR-INV-${inv.id}`;
    const legId = `JE-AUTO-${inv.id}`;
    const isVoided = inv.voided || inv.status === 'Cancelled';
    if (!isVoided && !ids.has(newId) && !ids.has(legId)) {
      try {
        const je = journalFromInvoice(inv);
        if (tryPost(je, inv)) { toAdd.push(je); ids.add(newId); }
      } catch (e) { /* skip malformed records */ }
    }
    if (isVoided) postReversalIfNeeded(inv, ids.has(legId) ? legId : newId);
  });

  // ── AR Credit Notes ─────────────────────────────────────────────────
  creditNotes.forEach(cn => {
    const newId = `JE-AR-CN-${cn.id}`;
    if (!cn.voided && cn.status !== 'Cancelled' && !ids.has(newId)) {
      try {
        const origInv = invoices.find(i => i.id === cn.invoiceId);
        const je = journalFromCreditNote(cn, origInv);
        if (je && tryPost(je, cn)) { toAdd.push(je); ids.add(newId); }
      } catch (e) { /* skip malformed records */ }
    }
    postReversalIfNeeded(cn, newId);
  });

  // ── AR Receipts ─────────────────────────────────────────────────────
  receipts.forEach(rec => {
    const newId = `JE-AR-REC-${rec.id}`;
    if (!rec.voided && !ids.has(newId)) {
      try {
        const je = journalFromReceipt(rec);
        if (tryPost(je, rec)) { toAdd.push(je); ids.add(newId); }
      } catch (e) { /* skip malformed records */ }
    }
    postReversalIfNeeded(rec, newId);
  });

  // ── AP Bills ────────────────────────────────────────────────────────
  apBills.forEach(bill => {
    const newId = `JE-AP-BILL-${bill.id}`;
    if (bill.status !== 'Cancelled' && !ids.has(newId)) {
      try {
        const je = journalFromAPBill(bill);
        if (tryPost(je, bill)) { toAdd.push(je); ids.add(newId); }
      } catch (e) { /* skip malformed records */ }
    }
  });

  // ── Purchase Invoices (Procurement) ─────────────────────────────────
  purchaseInvoices.forEach(inv => {
    const newId = `JE-PINV-${inv.id}`;
    if (inv.status !== 'Cancelled' && inv.deleted !== true && !ids.has(newId)) {
      try {
        const je = journalFromPurchaseInvoice(inv);
        if (tryPost(je, inv)) { toAdd.push(je); ids.add(newId); }
      } catch (e) { /* skip malformed records */ }
    }
  });

  // ── AP Payments ─────────────────────────────────────────────────────
  apPayments.forEach(pay => {
    const newId = `JE-AP-PAY-${pay.id}`;
    if (!ids.has(newId)) {
      try {
        const je = journalFromAPPayment(pay);
        if (tryPost(je, pay)) { toAdd.push(je); ids.add(newId); }
      } catch (e) { /* skip malformed records */ }
    }
  });

  // ── Petty Cash (Approved vouchers only) ──────────────────────────────
  pettycash.forEach(pc => {
    const newId = `JE-PC-${pc.id}`;
    if (pc.status === 'Approved' && !pc.voided && !ids.has(newId)) {
      try {
        const je = journalFromPettyCash(pc);
        if (tryPost(je, pc)) { toAdd.push(je); ids.add(newId); }
      } catch (e) { /* skip malformed records */ }
    }
    postReversalIfNeeded(pc, newId);
  });

  // ── Fixed Assets (capitalization entry) ──────────────────────────────
  fixedassets.forEach(asset => {
    const newId = `JE-FA-${asset.id}`;
    if (!asset.voided && !ids.has(newId)) {
      try {
        const je = journalFromFixedAsset(asset);
        if (tryPost(je, asset)) { toAdd.push(je); ids.add(newId); }
      } catch (e) { /* skip malformed records */ }
    }
    postReversalIfNeeded(asset, newId);
  });

  // ── Fixed Asset — periodic depreciation ─────────────────────────────
  fixedassets.forEach(asset => {
    if (asset.voided) return;
    if (asset.category === 'Land' || asset.category === '2000') return; // Land doesn't depreciate
    const list = Array.isArray(asset.depreciationPosted) ? asset.depreciationPosted : [];
    list.forEach(entry => {
      if (!entry || !entry.periodKey || !entry.amount) return;
      const newId = `JE-FA-DEP-${asset.id}-${entry.periodKey}`;
      if (ids.has(newId)) return;
      try {
        const [yr, mo] = entry.periodKey.split('-');
        const jeDate = `${entry.periodKey}-01`;
        const je = journalFromDepreciation({ ...asset }, entry.periodKey, entry.amount);
        je.date = jeDate;
        je.year  = Number(yr);
        je.month = Number(mo);
        if (tryPost(je, asset)) { toAdd.push(je); ids.add(newId); }
      } catch (e) { /* skip malformed records */ }
    });
  });

  // ── Terminal Operations charges ───────────────────────────────────────
  terminalCharges.forEach(charge => {
    const newId = `JE-TERM-${charge.id}`;
    if (charge.postedToAccounting && !charge.voided && !ids.has(newId)) {
      try {
        const je = journalFromTerminalCharge(charge);
        if (tryPost(je, charge)) { toAdd.push(je); ids.add(newId); }
      } catch (e) { /* skip malformed records */ }
    }
    postReversalIfNeeded(charge, newId);
  });

  // ── Terminal Operations advance payments ──────────────────────────────
  // Live-verify QA fix (2026-08-18): `if (adv.voided) return;` sat at the top
  // of this block, so voiding an advance skipped postReversalIfNeeded()
  // entirely — the receipt and every application entry stayed live in the
  // GL forever with no reversing entry, defeating the exact "void posts an
  // automatic reversal instead of vanishing from the ledger" guarantee this
  // file's terminalCharges block (just above) and every other section
  // (AR invoices, credit notes, receipts, fixed assets) already honour by
  // only gating the POSTING half behind !voided and calling the reversal
  // unconditionally afterward. Caught live: voided a test advance, Total
  // Revenue (Posted) on the Accounting Overview still showed the applied
  // amount. Also fixed: the single postReversalIfNeeded(adv, recId) call
  // only ever reversed the receipt — each per-container application entry
  // needs its own reversal too, or a partially-applied advance leaves
  // orphaned income entries behind even after its receipt is reversed.
  terminalAdvances.forEach(adv => {
    const recId = `JE-ADV-REC-${adv.id}`;
    if (!adv.voided && !ids.has(recId)) {
      try {
        const je = journalFromAdvanceReceipt(adv);
        if (tryPost(je, adv)) { toAdd.push(je); ids.add(recId); }
      } catch (e) { /* skip malformed records */ }
    }
    const appIds = [];
    (adv.applications || []).forEach((app, idx) => {
      const appId = `JE-ADV-APP-${adv.id}-${app.containerNo || 'bulk'}-${app.date || idx}`;
      appIds.push(appId);
      if (adv.voided || ids.has(appId)) return;
      try {
        const je = journalFromAdvanceApplication(adv, Number(app.amount) || 0, app.containerNo);
        if (tryPost(je, adv)) { toAdd.push(je); ids.add(appId); }
      } catch (e) { /* skip malformed records */ }
    });
    postReversalIfNeeded(adv, recId);
    appIds.forEach(appId => postReversalIfNeeded(adv, appId));
  });

  // ── Payroll (two steps: accrual, then payment) ────────────────────────
  payrollRuns.forEach(run => {
    const accrualId = `JE-PR-${run.id}`;
    const paymentId = `JE-PR-PAY-${run.id}`;
    if (!run.voided && !ids.has(accrualId)) {
      try {
        const je = journalFromPayrollRun(run);
        if (tryPost(je, run)) { toAdd.push(je); ids.add(accrualId); }
      } catch (e) { /* skip malformed records */ }
    }
    if (!run.voided && run.paymentDate && ids.has(accrualId) && !ids.has(paymentId)) {
      try {
        const je = journalFromPayrollPayment(run);
        if (tryPost(je, run)) { toAdd.push(je); ids.add(paymentId); }
      } catch (e) { /* skip malformed records */ }
    }
    postReversalIfNeeded(run, accrualId);
    // 2026-08-18: voiding a run that had already been marked paid used to
    // leave the payment leg (Dr Net Salary Payable / Cr Bank — the entry
    // saying cash actually left the bank) sitting in the ledger forever,
    // with no accrual left to clear it against. Reverse that leg too,
    // whenever it exists, so a voided-paid run nets to zero on both the
    // expense/payable side AND the cash side — matches how SAP/NetSuite/
    // Odoo handle voiding a disbursed payroll run.
    postReversalIfNeeded(run, paymentId);
  });

  // ── Stock Issues ───────────────────────────────────────────────────────
  stockMovements.forEach(m => {
    if (m.voided) return;
    if (!m.postedToGL) return;
    if (m.type !== 'ISSUE' && m.type !== 'SCRAP') return;
    const item = (db?.stockItems || []).find(i => i.id === m.itemId) || { name: m.itemId, uom: 'units', cogsAccountCode: '8004', inventoryAccountCode: '6001' };
    const refId = m.refId || m.id;
    const newId = `JE-STOCK-${refId}-${m.itemId}`;
    if (ids.has(newId)) return;
    try {
      const je = journalFromStockIssue(item, Number(m.qty) || 0, Number(m.unitCost) || 0, m.refType || 'manual', refId);
      if (tryPost(je, m)) { toAdd.push(je); ids.add(newId); }
    } catch (e) { /* skip malformed records */ }
  });

  // ── Fleet repairs ──────────────────────────────────────────────────────
  fleetRepairs.forEach(repair => {
    const newId = `JE-FLEET-${repair.id}`;
    if (repair.postedToAccounting && !repair.voided && !ids.has(newId)) {
      try {
        const je = journalFromFleetRepair(repair);
        if (tryPost(je, repair)) { toAdd.push(je); ids.add(newId); }
      } catch (e) { /* skip malformed records */ }
    }
    postReversalIfNeeded(repair, newId);
  });

  if (blocked.length) {
    const summary = blocked.reduce((acc, b) => {
      acc[b.reason] = (acc[b.reason] || 0) + 1;
      return acc;
    }, {});
    const detail = blocked.slice(0, 3).map(b => `${b.recordId} (${b.periodKey})`).join(', ');
    console.warn(
      `[SLOT] Auto-post skipped ${blocked.length} record(s) — ` +
      Object.entries(summary).map(([k,v]) => `${k}: ${v}`).join(', ') +
      (blocked.length > 3 ? ` — first 3: ${detail}…` : ` — ${detail}`)
    );
  }

  return toAdd.length ? [...js, ...toAdd] : js;
}
