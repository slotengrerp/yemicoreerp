// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Three-Way Match Validation v1.0
//
// The audit's Tier-2 finding: procurement has PO ↔ waybill/GRN linkage, and
// AP has bill ↔ PO linkage, but no automated check that the invoiced amount
// matches the PO and the received quantity. This module does the cross-
// document check.
//
// Three-way match is the standard purchasing control: the supplier invoice
// is only paid when its (quantity × price) reconciles to BOTH the
// purchase order (what was agreed) AND the goods-received note (what was
// actually delivered). In SLOT ERP:
//
//   1. PO line: { qty, unitPrice, total }     — what was committed
//   2. GRN line: { receivedQty }              — what was delivered
//   3. Bill line: { qty, unitPrice, total }    — what was billed
//
// Variance types:
//   • QTY_VARIANCE    — bill qty ≠ PO qty      (or > GRN qty, suggests over-billing)
//   • PRICE_VARIANCE  — bill unitPrice ≠ PO unitPrice
//   • AMOUNT_VARIANCE — bill line total ≠ (qty × unitPrice) — usually a calc error
//   • OVER_BILLING    — bill total > PO total  — common fraud signal
//   • OVER_RECEIPT    — bill qty > GRN qty     — invoicing for undelivered goods
//
// The function returns a structured variance report; the caller decides
// whether to block the bill, hold for approval, or allow with a tolerance.
// ══════════════════════════════════════════════════════════════════════════════

// Match one bill line against its corresponding PO line + GRN line.
// Returns { ok, variances: [{type, severity, expected, actual, message}] }.
export function matchBillLine({ billLine, poLine, grnLine, tolerancePct = 2 }) {
  const variances = [];
  const bQty   = Number(billLine?.qty) || 0;
  const bPrice = Number(billLine?.unitPrice) || 0;
  const bTotal = Number(billLine?.total != null ? billLine.total : bQty * bPrice);
  const pQty   = Number(poLine?.qty) || 0;
  const pPrice = Number(poLine?.unitPrice) || 0;
  const pTotal = Number(poLine?.total != null ? poLine.total : pQty * pPrice);
  const gQty   = Number(grnLine?.receivedQty ?? grnLine?.qty) || 0;

  // Within-tolerance helper (rounds to nearest naira before comparing)
  const within = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * (tolerancePct / 100));

  if (!within(bQty, pQty) && pQty > 0) {
    variances.push({
      type: 'QTY_VARIANCE',
      severity: 'high',
      expected: pQty, actual: bQty,
      message: `Bill qty ${bQty} differs from PO qty ${pQty}`,
    });
  }
  if (!within(bPrice, pPrice) && pPrice > 0) {
    variances.push({
      type: 'PRICE_VARIANCE',
      severity: 'high',
      expected: pPrice, actual: bPrice,
      message: `Bill unit price ${bPrice} differs from PO unit price ${pPrice}`,
    });
  }
  const calcTotal = bQty * bPrice;
  if (!within(bTotal, calcTotal) && bQty && bPrice) {
    variances.push({
      type: 'AMOUNT_VARIANCE',
      severity: 'medium',
      expected: calcTotal, actual: bTotal,
      message: `Bill total ${bTotal} ≠ qty × price (${calcTotal}) — possible calculation error`,
    });
  }
  if (bTotal > pTotal + 1 && pTotal > 0) {
    variances.push({
      type: 'OVER_BILLING',
      severity: 'high',
      expected: pTotal, actual: bTotal,
      message: `Bill total ${bTotal} exceeds PO total ${pTotal} by ${(bTotal - pTotal).toLocaleString()}`,
    });
  }
  if (bQty > gQty && gQty > 0) {
    variances.push({
      type: 'OVER_RECEIPT',
      severity: 'critical',
      expected: gQty, actual: bQty,
      message: `Bill qty ${bQty} exceeds received qty ${gQty} — invoiced for undelivered goods`,
    });
  }
  return { ok: variances.length === 0, variances };
}

// Match a full bill against a PO and the PO's waybills/GRNs.
// Returns { ok, variances (flat), byLine (per-line variances) }.
export function matchBill({ bill, po, waybills = [], tolerancePct = 2 }) {
  if (!bill || !po) {
    return {
      ok: false,
      severity: 'critical', // FIX (T1-1): was missing — decideOnVariance() never saw 'critical' here, so a PO-less bill could fall through to auto-approve
      variances: [{ type: 'NO_PO_LINK', severity: 'critical', message: 'Bill is not linked to a Purchase Order' }],
      byLine: [],
    };
  }
  const poLines   = po.items || po.lines || [];
  const billLines = bill.items || bill.lines || [];
  const wbList    = Array.isArray(waybills) ? waybills : []; // FIX (T1-5): default param doesn't cover explicit null
  const byLine    = [];
  const allVars   = [];

  billLines.forEach((bLine, idx) => {
    // Try to match by itemId first, fall back to description
    const exactMatch = poLines.find(l =>
      (bLine.itemId && l.id === bLine.itemId) ||
      (bLine.description && l.description === bLine.description)
    );
    // FIX (T1-2): positional fallback is now flagged as low-confidence
    // instead of being silently treated as equivalent to a real match —
    // suppliers routinely bill in a different line order than the PO.
    const pLine = exactMatch || poLines[idx];
    if (!pLine) {
      allVars.push({ type: 'UNKNOWN_LINE', severity: 'high', message: `Bill line ${idx + 1} ("${bLine.description||'?'}") has no matching PO line` });
      return;
    }
    if (!exactMatch) {
      allVars.push({ type: 'UNVERIFIED_LINE_MATCH', severity: 'high', message: `Bill line ${idx + 1} ("${bLine.description||'?'}") matched PO line ${idx + 1} by position only — no itemId/description match. Verify manually.` });
    }
    // Find corresponding GRN (waybill) line — match by itemId/description, sum if multiple
    const grnQty = wbList.reduce((sum, wb) => {
      const wbItems = wb.items || [];
      const matched = wbItems.find(wi =>
        (bLine.itemId && wi.id === bLine.itemId) ||
        (bLine.description && wi.description === bLine.description)
      );
      return sum + (Number(matched?.receivedQty ?? matched?.qty) || 0);
    }, 0);
    const grnLine = { receivedQty: grnQty };
    const result  = matchBillLine({ billLine: bLine, poLine: pLine, grnLine, tolerancePct });
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

// Decide what to do with a bill based on its variance report.
// Returns { action: 'auto-approve'|'hold'|'block', reason }.
export function decideOnVariance(report, policy = {}) {
  const p = {
    autoApproveBelow:   policy.autoApproveBelow   ?? 0,         // variance threshold ₦ for auto-approve
    blockOnCritical:    policy.blockOnCritical    ?? true,      // block on critical (over-receipt)
    holdOnHigh:         policy.holdOnHigh         ?? true,      // hold for approval on high severity
    ...policy,
  };
  if (!report.variances.length) return { action: 'auto-approve', reason: 'All three lines reconcile within tolerance' };
  if (p.blockOnCritical && report.severity === 'critical') {
    return { action: 'block', reason: 'Critical variance (over-receipt or over-billing) — manual review required' };
  }
  const maxVariance = report.variances.reduce((m, v) => Math.max(m, Math.abs((v.actual||0) - (v.expected||0))), 0);
  if (maxVariance <= p.autoApproveBelow) return { action: 'auto-approve', reason: `Max variance ${maxVariance} below auto-approve threshold` };
  if (p.holdOnHigh && (report.severity === 'high' || report.severity === 'medium')) {
    return { action: 'hold', reason: `Variance severity ${report.severity} — held for approval` };
  }
  return { action: 'hold', reason: 'Variance detected — held for review' };
}
