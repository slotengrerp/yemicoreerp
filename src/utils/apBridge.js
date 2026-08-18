// ── AP Bills adapter ─────────────────────────────────────────────────────────
// Originally added 2026-08-14 inside SageReports.jsx to fix Supplier
// Statement, Aged Payables, Batch Payment Run and WHT Certificates, which all
// read exclusively from db.ap.bills / db.ap.payments — a manual bill ledger
// that has zero real entries anywhere in the system. Every actual supplier
// invoice is created in Procurement -> Supplier Invoices (db.procurement.
// invoices) instead, so those four reports showed ₦0.00 / "no records" for
// every vendor despite real pending invoices.
//
// 2026-08-17: moved out of SageReports.jsx into its own shared file, because
// the Accounts Payable MODULE ITSELF (AccountsPayable.jsx) had exactly the
// same gap — it also only reads db.ap.bills, so Slot staff could open AP,
// see nothing, and have no way to record a payment against a real supplier
// invoice at all. Both SageReports.jsx and AccountsPayable.jsx now import
// this same bridge, so there's one definition of "what a procurement invoice
// looks like as a bill" instead of two that can drift apart.
//
// This maps db.procurement.invoices into the exact "bill" shape AP's
// rendering/aging/print logic already expects, so none of that logic needs
// to change — only where each consumer sources `bills`/`payments` from.
// Real db.ap.bills entries (manually entered directly in AP) are still
// included, appended after the procurement-derived ones.
//
// FX SAFETY: mirrors the rule utils/glPosting.js's journalFromPurchaseInvoice
// already applies for the GL — a foreign-currency invoice with no captured
// exchange rate is never guessed into NGN (that would silently misstate what
// SLOT owes on a document that can go out to a real vendor). Its
// ngnEquivalent is left at 0 (so it can't corrupt a total) and
// needsFxRate:true is set so callers can surface the gap instead of quietly
// dropping it.
export function procurementInvoicesAsBills(procurement) {
  const invoices = procurement?.invoices || [];
  return invoices.map(inv => {
    const currency  = inv.currency || 'NGN';
    const rate      = Number(inv.fxRate);
    const needsRate = currency !== 'NGN';
    const hasRate   = !needsRate || (Number.isFinite(rate) && rate > 0);
    const fx        = needsRate ? rate : 1;
    const native    = Number(inv.netPayable ?? inv.total) || 0;
    const ngn       = hasRate ? Math.round(native * fx) : 0;
    return {
      id:            inv.id,
      vendor:        inv.supplier,
      vendorName:    inv.supplier,
      date:          inv.date,
      billNo:        inv.invoiceNo,
      invoiceNo:     inv.invoiceNo,
      poId:          inv.poId,
      poNo:          inv.poNo,
      description:   inv.items?.[0]?.description || `PO ${inv.poNo || '—'}`,
      status:        inv.status,
      dueDate:       inv.dueDate,
      currency,
      needsFxRate:   needsRate && !hasRate,
      nativeAmount:  native,
      // Bill Amount / VAT fields the AP "View Bill" modal renders — mapped
      // from the invoice's own subtotal/VAT so a real invoice doesn't show
      // ₦0.00 in those rows just because it uses different field names.
      amount:        Number(inv.subtotal ?? native) || 0,
      vatAmount:     Number(inv.vatAmount) || 0,
      ngnEquivalent: ngn,
      netPayable:    ngn,
      paidAmount:    inv.status === 'Paid' ? ngn : 0,
      whtRate:       inv.whtRate,
      whtAmount:     hasRate ? Math.round((Number(inv.whtAmount) || 0) * fx) : 0,
      source:        'procurement',
    };
  });
}

// A Paid procurement invoice IS the payment leg (Procurement doesn't track a
// separate payment record) — one synthetic payment per Paid invoice with a
// resolved NGN amount.
export function procurementInvoicesAsPayments(procurement) {
  return procurementInvoicesAsBills(procurement)
    .filter(b => b.status === 'Paid' && !b.needsFxRate)
    .map(b => ({
      id:            `pay-${b.id}`,
      billId:        b.id,
      vendor:        b.vendor,
      vendorName:    b.vendorName,
      date:          b.date,
      paymentNo:     `PAY-${b.invoiceNo}`,
      reference:     b.invoiceNo,
      ngnEquivalent: b.ngnEquivalent,
      amount:        b.ngnEquivalent,
      source:        'procurement',
    }));
}

export function getApSource(db) {
  const manual = db.ap || { bills: [], payments: [] };
  return {
    bills:    [...procurementInvoicesAsBills(db.procurement), ...(manual.bills || [])],
    payments: [...procurementInvoicesAsPayments(db.procurement), ...(manual.payments || [])],
  };
}
