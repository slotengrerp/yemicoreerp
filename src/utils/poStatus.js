// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — shared Purchase Order status logic
//
// Moved out of Procurement.jsx on 2026-08-13 so Dashboard.jsx can compute
// "Active POs" the exact same way Procurement's own screen does. Both used to
// have their own copy: Dashboard filtered on the PO's raw stored `status`
// field, Procurement recomputed status from actual waybill delivery data via
// getPOStatus(). A PO stays "Approved" in storage even after it's fully
// delivered until someone manually flips it, so the two screens showed
// different counts for the same 3 real records (Dashboard: 2, Procurement: 1)
// — found during a QA pass, tracked back to this drift.
//
// Deliberately NOT re-exported from Procurement.jsx: Dashboard.jsx and
// Procurement.jsx are both route-level lazy-loaded modules, and importing
// one module component file from another would pull Procurement's whole
// chunk into Dashboard's, defeating the code-splitting. A standalone utility
// file has no such coupling.
// ══════════════════════════════════════════════════════════════════════════════

export function getDeliveredQty(poItemId, waybills, poId) {
  return waybills
    .filter(wb => wb.poId === poId && wb.status !== 'Rejected')
    .flatMap(wb => wb.items)
    .filter(wi => wi.poItemId === poItemId)
    .reduce((s, wi) => s + (Number(wi.deliveredQty) || 0), 0);
}

export function getPOStatus(po, waybills, invoices) {
  if (po.status === 'Draft' || po.status === 'Cancelled') return po.status;
  if ((po.poType || 'Client') === 'SLOT') {
    // SLOT POs never get waybill/invoice records — delivery is tracked via
    // the manual Actual Delivery Date field instead.
    if (po.actualDeliveryDate) return 'Complete';
    return po.status === 'Approved' ? 'Approved' : 'PO Issued';
  }
  const totalOrdered = po.items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const totalDelivered = po.items.reduce((s, i) => s + getDeliveredQty(i.id, waybills, po.id), 0);
  if (totalDelivered === 0) return po.status === 'Approved' ? 'Approved' : 'PO Issued';
  if (totalDelivered >= totalOrdered) return 'Complete';
  return 'Partial';
}
