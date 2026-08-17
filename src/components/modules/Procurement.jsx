// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — PROCUREMENT MODULE v1.0
// Full linked chain: RFQ → PO (line items) → Waybill (partial) → Invoice
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo } from '../../utils/auth';
import { showToast, formatDate, getDeepLinkTab } from '../../utils/helpers';
import { printHeader, PRINT_CSS, printBootstrap, openPrintWindow, SLOT_LOGO_B64 } from '../../utils/logo';
import { getVendors } from '../../utils/vendorMaster';
import { getClients } from '../../utils/clientMaster';
import { initApproval, applyDecision, canApproveAtCurrentLevel, approvalSummary } from '../../utils/approvalEngine';
import { diffAndPush } from '../../hooks/usePerRecordSync';
import { Confirm } from '../ui';
import { getDeliveredQty, getPOStatus } from '../../utils/poStatus';
// 2026-08-05 — Procurement was the ONLY module of 24 that never logged
// anything. Deleting an invoice left no trace anywhere, which is how a set of
// deleted invoices became untraceable. See logActivity calls below.
import { logActivity } from '../../utils/audit';

// listName ('rfqs'|'pos'|'waybills'|'invoices') → RECORD_TABLES key, used by save() below.
const PROC_TABLE_BY_LIST = { rfqs: 'procurementRfqs', pos: 'procurementPos', waybills: 'procurementWaybills', invoices: 'procurementInvoices' };

// 2026-08-15: was minimumFractionDigits:0 with no max — decimals appeared or
// vanished depending on the underlying number instead of pinning to kobo,
// unlike Invoices.jsx/PettyCash.jsx/AccountsPayable.jsx's fmt(). RFQ/PO/
// Waybill/Invoice totals are exactly the figures staff reconcile against
// supplier paperwork, so this is the one most worth getting exact.
const fmt = n => '₦' + (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Currency selection ───────────────────────────────────────────────────────
// Every procurement document (RFQ, PO, Waybill, Invoice) carries its own
// `currency`. '' means "no symbol" — amounts print as bare numbers so the
// figure can be written in by hand.
// Must match AP_EXPENSE_MAP in utils/glPosting.js — these strings pick the
// expense account a purchase invoice posts to. Changing one without the other
// silently sends the spend to 8003 Other Direct Cost.
const PO_CATEGORIES = ['Materials', 'Services', 'Logistics', 'Labour', 'Maintenance', 'Other'];
const CURRENCIES = ['NGN', 'USD', 'GBP', 'EUR', ''];
const CUR_SYM = { NGN: '₦', USD: '$', GBP: '£', EUR: '€', '': '' };
const curSym = c => CUR_SYM[c] ?? '';
// Same formatting as fmt(), but with the document's own currency symbol.
const fmtC = (n, c) => curSym(c) + (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Column-header suffix: "Unit Price (₦)" / "Unit Price (USD)" / "Unit Price"
const curSuffix = c => (c ? ` (${curSym(c) || c})` : '');

function printPO(po) {
  const partyLbl = po.poType === 'SLOT' ? 'Supplier' : 'Client';
  // Amounts print in the PO's own currency, not a hardcoded naira sign.
  const fmt = n => fmtC(n, po.currency ?? 'NGN');
  const itemRows = (po.items||[]).map((item,i) => `
    <tr style="background:${i%2?'#f3faf5':'#fff'}">
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB">${i+1}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;font-family:monospace;font-size:11px">${item.materialNo||'—'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB">${item.description||'—'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;text-align:center">${item.qty||0}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;text-align:center">${item.unit||'—'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;text-align:right">${fmt(item.unitPrice)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;text-align:right;font-weight:700;color:#1A5C2A">${fmt((Number(item.qty)||0)*(Number(item.unitPrice)||0))}</td>
    </tr>`).join('');
  openPrintWindow(`<!DOCTYPE html><html><head><title>PO ${po.poNo||''}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:24px}table{width:100%;border-collapse:collapse}th{background:#1A5C2A;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}.field{margin-bottom:8px}.lbl{font-size:9px;font-weight:700;text-transform:uppercase;color:#182A1C;letter-spacing:.5px;margin-bottom:2px}.val{font-size:12px;font-weight:600;border-bottom:1px solid #DDE9DE;padding-bottom:3px}.total-row{background:#F0F8F2;font-weight:700}.sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px;margin-top:40px}.sig-line{border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C}@media print{body{padding:12px}}</style></head><body>${printHeader('PURCHASE ORDER · ' + (po.poNo||''), formatDate(po.date))}<div class="info-grid"><div><div class="field"><div class="lbl">${partyLbl}</div><div class="val">${po.supplier||'—'}</div></div><div class="field"><div class="lbl">${partyLbl} Address</div><div class="val">${po.supplierAddress||'—'}</div></div><div class="field"><div class="lbl">Payment Terms</div><div class="val">${po.paymentTerms||'—'}</div></div></div><div><div class="field"><div class="lbl">Delivery Address</div><div class="val">${po.deliveryAddress||'—'}</div></div><div class="field"><div class="lbl">Delivery Date</div><div class="val">${formatDate(po.deliveryDate)||'—'}</div></div><div class="field"><div class="lbl">Status</div><div class="val">${po.status||'—'}</div></div></div></div><table style="margin-bottom:16px"><thead><tr><th>#</th><th>Material No.</th><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:center">Unit</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead><tbody>${itemRows}</tbody><tfoot><tr class="total-row"><td colspan="6" style="padding:8px 10px;text-align:right">Subtotal</td><td style="padding:8px 10px;text-align:right">${fmt(po.subtotal)}</td></tr><tr class="total-row"><td colspan="6" style="padding:8px 10px;text-align:right">VAT (${po.vatRate||0}%)</td><td style="padding:8px 10px;text-align:right">${fmt(po.vatAmount)}</td></tr><tr style="background:#1A5C2A;color:#fff"><td colspan="6" style="padding:10px;text-align:right;font-weight:800;font-size:13px">TOTAL</td><td style="padding:10px;text-align:right;font-weight:800;font-size:15px">${fmt(po.total)}</td></tr></tfoot></table>${po.notes?`<div style="margin-bottom:16px;padding:10px;background:#f3faf5;border-left:3px solid #1A5C2A;border-radius:4px"><div style="font-size:10px;font-weight:700;color:#182A1C;text-transform:uppercase;margin-bottom:4px">Notes</div><div style="font-size:12px">${po.notes}</div></div>`:''}<div class="sig"><div><div class="sig-line">Prepared By / Date</div></div><div><div class="sig-line">Authorised By / Date</div></div><div><div class="sig-line">${partyLbl} Acknowledgement / Date</div></div></div>${printBootstrap({landscape:false})}</body></html>`);
}

// ── Print: Supplier Invoice ──────────────────────────────────────────────────
// Modelled on the SLOT invoice summary sheet. printHeader() puts the SLOT
// Engineering letterhead at the very top of the page (requirement 2e), and all
// amounts follow the invoice's own currency rather than a hardcoded naira sign.
function printInvoice(inv) {
  const cur  = inv.currency ?? 'NGN';
  const m    = n => fmtC(n, cur);
  const rows = (inv.items || []).map((it, i) => `
    <tr style="background:${i % 2 ? '#f3faf5' : '#fff'}">
      <td>${i + 1}</td>
      <td style="text-align:center">${it.qty || 0}</td>
      <td style="text-align:center">${it.unit || '—'}</td>
      <td>${it.description || '—'}</td>
      <td style="text-align:right">${m(it.unitPrice)}</td>
      <td style="text-align:right;font-weight:700;color:#1A5C2A">${m(it.totalPrice)}</td>
    </tr>`).join('');
  openPrintWindow(`<!DOCTYPE html><html><head><title>Invoice ${inv.invoiceNo || ''}</title><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:24px}
    table{width:100%;border-collapse:collapse}
    th{background:#1A5C2A;color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
    td{padding:7px 10px;border-bottom:1px solid #EAF0EB}
    .sum{width:100%;border-collapse:collapse;margin:16px 0}
    .sum td{border:1px solid #D4E0D6;padding:8px 10px}
    .sum .k{font-weight:700;text-transform:uppercase;font-size:10px;width:34%;background:#F3FAF5}
    .total-row{background:#F0F8F2;font-weight:700}
    .sig{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:44px}
    .sig-line{border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C}
    @media print{body{padding:12px}}
  </style></head><body>
  ${printHeader('INVOICE SUMMARY · ' + (inv.invoiceNo || ''), formatDate(inv.date))}
  <table class="sum">
    <tr><td class="k">Currency</td><td>${cur || '—'}</td></tr>
    <tr><td class="k">Invoice Value</td><td style="font-weight:700">${m(inv.netPayable)}</td></tr>
    <tr><td class="k">Supplier</td><td>${inv.supplier || '—'}</td></tr>
    <tr><td class="k">PO Number</td><td>${inv.poNo || '—'}</td></tr>
    <tr><td class="k">Supplier Invoice Ref</td><td>${inv.supplierInvoiceNo || '—'}</td></tr>
    <tr><td class="k">Due Date</td><td>${formatDate(inv.dueDate) || '—'}</td></tr>
  </table>
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;margin:14px 0 6px">Purchase Order Details</div>
  <table>
    <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:center">Unit</th><th>Material Description</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total Price</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr class="total-row"><td colspan="5" style="text-align:right">PO Value</td><td style="text-align:right">${m(inv.subtotal)}</td></tr>
      <tr class="total-row"><td colspan="5" style="text-align:right">VAT (7.5%)</td><td style="text-align:right">${m(inv.vatAmount)}</td></tr>
      <tr style="background:#1A5C2A;color:#fff"><td colspan="5" style="padding:10px;text-align:right;font-weight:800;font-size:13px">TOTAL</td><td style="padding:10px;text-align:right;font-weight:800;font-size:15px">${m(inv.netPayable)}</td></tr>
    </tfoot>
  </table>
  ${inv.notes ? `<div style="margin-top:14px;padding:10px;background:#f3faf5;border-left:3px solid #1A5C2A;border-radius:4px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;margin-bottom:4px">Notes</div><div>${inv.notes}</div></div>` : ''}
  <div class="sig">
    <div><div class="sig-line">Signed / Date</div></div>
    <div><div class="sig-line">Designation</div></div>
  </div>
  ${printBootstrap({landscape:false})}</body></html>`);
}

// ── Print: RFQ ────────────────────────────────────────────────────────────
// 2026-08-15 — RFQ was the only document in the RFQ→PO→Waybill→Invoice chain
// with no print output at all; staff had no paper copy to send a supplier or
// keep on file. Modelled on printPO/printInvoice above. Unset estimated
// prices print as "—" rather than a currency-formatted zero (see the
// matching on-screen fix in RFQModal's item rows, same root cause: an empty
// string price defaulted through Number('')||0 to a bare 0/"$0").
function printRFQ(rfq) {
  const cur = rfq.currency ?? 'NGN';
  const m = n => fmtC(n, cur);
  const priceCell = p => (p === '' || p == null) ? '—' : m(p);
  const totalEstimated = (rfq.items || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.estimatedPrice) || 0), 0);
  const rows = (rfq.items || []).map((it, i) => `
    <tr style="background:${i % 2 ? '#f3faf5' : '#fff'}">
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB">${i + 1}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB">${it.description || '—'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;text-align:center">${it.qty || 0}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;text-align:center">${it.unit || '—'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;text-align:right">${priceCell(it.estimatedPrice)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;text-align:right;font-weight:700;color:#1A5C2A">${it.estimatedPrice === '' || it.estimatedPrice == null ? '—' : m((Number(it.qty) || 0) * (Number(it.estimatedPrice) || 0))}</td>
    </tr>`).join('');
  openPrintWindow(`<!DOCTYPE html><html><head><title>RFQ ${rfq.rfqNo || ''}</title><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:24px}
    table{width:100%;border-collapse:collapse}
    th{background:#1A5C2A;color:#fff;padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}
    .field{margin-bottom:8px}
    .lbl{font-size:9px;font-weight:700;text-transform:uppercase;color:#182A1C;letter-spacing:.5px;margin-bottom:2px}
    .val{font-size:12px;font-weight:600;border-bottom:1px solid #DDE9DE;padding-bottom:3px}
    .total-row{background:#F0F8F2;font-weight:700}
    .sig{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:44px}
    .sig-line{border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C}
    @media print{body{padding:12px}}
  </style></head><body>
  ${printHeader('REQUEST FOR QUOTATION · ' + (rfq.rfqNo || ''), formatDate(rfq.date))}
  <div class="info-grid">
    <div>
      <div class="field"><div class="lbl">Client</div><div class="val">${rfq.clientName || '—'}</div></div>
      <div class="field"><div class="lbl">Department</div><div class="val">${rfq.department || '—'}</div></div>
      <div class="field"><div class="lbl">Requested By</div><div class="val">${rfq.requestedBy || '—'}</div></div>
    </div>
    <div>
      <div class="field"><div class="lbl">Required By</div><div class="val">${formatDate(rfq.requiredBy) || '—'}</div></div>
      <div class="field"><div class="lbl">Status</div><div class="val">${rfq.status || '—'}</div></div>
      <div class="field"><div class="lbl">Description</div><div class="val">${rfq.description || '—'}</div></div>
    </div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:center">Unit</th><th style="text-align:right">Est. Unit Price</th><th style="text-align:right">Est. Total</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="total-row"><td colspan="5" style="padding:8px 10px;text-align:right">Total Estimated Value</td><td style="padding:8px 10px;text-align:right">${m(totalEstimated)}</td></tr></tfoot>
  </table>
  <div class="sig"><div><div class="sig-line">Prepared By / Date</div></div><div><div class="sig-line">Approved By / Date</div></div></div>
  ${printBootstrap({ landscape: false })}</body></html>`);
}

// ── Legacy local key (read-only now, used once for migration in loadInitial) ──
const PROC_KEY = 'slot_proc';

function loadProc() {
  try { const r = localStorage.getItem(PROC_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}

// ── ID / Number generators ─────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2, 9);
const year = () => new Date().getFullYear();
// 2026-08-05 — THE BUG THIS REPLACES
//
// The old version stripped every non-digit from the whole number before
// parsing, so the year was swallowed into the sequence and each new document
// grew by four digits:
//
//   "SINV-2026-0001"        → "20260001"         → next 20260002
//   "SINV-2026-20260002"    → "202620260002"     → next 202620260003
//   "SINV-2026-202620260003" → …                 → and so on, forever
//
// It hit every document type — RFQ, PO, Waybill and Invoice all call this.
//
// Now only the trailing sequence is read, and only from documents issued
// under THIS prefix and THIS year. The 1–5 digit bound is what makes the
// counter self-healing: the malformed legacy numbers are 8+ digits, so they
// no longer match and can't drag the sequence up again. Numbers already
// issued are left untouched — anything a customer has seen still stands.
function nextNo(prefix, list, field) {
  const y = year();
  const re = new RegExp('^' + prefix + '-' + y + '-(\\d{1,5})$');
  const nums = list
    .map(x => { const m = re.exec(String(x[field] || '')); return m ? parseInt(m[1], 10) : 0; })
    .filter(Boolean);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${prefix}-${y}-${String(next).padStart(4, '0')}`;
}

// ── Quantity calculators ───────────────────────────────────────────────────
// getDeliveredQty / getPOStatus moved to utils/poStatus.js on 2026-08-13 so
// Dashboard.jsx can compute "Active POs" identically to this module without
// importing this whole (lazy-loaded) module file — see that file's header
// comment for why the two screens disagreed before.
function getInvoicedQty(poItemId, invoices, poId) {
  // 2026-08-17: a Cancelled/voided invoice used to still count toward "qty
  // already invoiced" here, which would permanently block a corrected
  // replacement invoice from ever being created after voiding a duplicate or
  // bad one - the PO would look fully billed forever even with nothing valid
  // on record. Voided invoices no longer hold a claim on the qty.
  return invoices
    .filter(inv => inv.poId === poId && inv.status !== 'Cancelled')
    .flatMap(inv => inv.items)
    .filter(ii => ii.poItemId === poItemId)
    .reduce((s, ii) => s + (Number(ii.qty) || 0), 0);
}

// ── Empty default shape ──────────────────────────────────────────────────
// 2026-07-29 — renamed from SEED and stripped of the fabricated procurement
// chain it used to hold (two RFQs, an "Approved" PO, a waybill, and an
// invoice, all linked end to end to look like a fully audited real
// purchase — emptied 2026-07-28, see App.jsx boot-sequence note). Keys must
// stay — the module destructures EMPTY_PROC.rfqs / .pos / .waybills /
// .invoices directly — but there must never be rows in them again.
const EMPTY_PROC = {
  rfqs: [], pos: [], waybills: [], invoices: [],
};

// ── Shared style helpers (theme-aware) ─────────────────────────────────────
function useStyles() {
  const { C } = useTheme();
  return {
    inp: { padding: '7px 10px', borderRadius: 7, border: '1px solid ' + C.border, background: C.bgCard, color: C.text, fontSize: 13, width: '100%', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' },
    sel: { padding: '7px 10px', borderRadius: 7, border: '1px solid ' + C.border, background: C.bgCard, color: C.text, fontSize: 13, width: '100%', outline: 'none', fontFamily: 'inherit' },
    th:  { padding: '8px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap', background: C.greenPale, borderBottom: '2px solid ' + C.border },
    td:  { padding: '8px 10px', borderBottom: '1px solid ' + C.borderLight, color: C.text, fontSize: 12 },
  };
}

// ── Reusable mini components ───────────────────────────────────────────────
function Tag({ status }) {
  const { C } = useTheme();
  const map = {
    'Draft':['#6B7280','rgba(107,114,128,.12)'], 'Submitted':['#1A5C8A','rgba(26,92,138,.12)'],
    'Sourcing':['#1A5C8A','rgba(26,92,138,.12)'], 'Bids Submitted':['#7C3AED','rgba(124,58,237,.12)'],
    'PO Received':[C.warning,'rgba(201,122,10,.12)'], 'Delivered':[C.success,'rgba(26,122,74,.12)'],
    'Approved':[C.success,'rgba(26,122,74,.12)'], 'PO Issued':[C.greenLight,'rgba(76,175,100,.12)'],
    'Partial':[C.warning,'rgba(201,122,10,.12)'], 'Complete':[C.success,'rgba(26,122,74,.12)'],
    'Cancelled':[C.danger,'rgba(192,57,43,.12)'], 'Accepted':[C.success,'rgba(26,122,74,.12)'],
    'Partially Accepted':[C.warning,'rgba(201,122,10,.12)'], 'Pending Inspection':[C.warning,'rgba(201,122,10,.12)'],
    'Rejected':[C.danger,'rgba(192,57,43,.12)'], 'Pending':[C.warning,'rgba(201,122,10,.12)'],
    'Paid':[C.success,'rgba(26,122,74,.12)'], 'Overdue':[C.danger,'rgba(192,57,43,.12)'],
    'Disputed':['#7C3AED','rgba(124,58,237,.12)'],
  };
  const [c, bg] = map[status] || ['#6B7280', 'rgba(107,114,128,.12)'];
  return <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 500, color: c, background: bg, border: '1px solid ' + c + '30', whiteSpace: 'nowrap' }}>{status}</span>;
}

function DeliveryCountdown({ expected, actual }) {
  const { C } = useTheme();
  if (actual) {
    return <div style={{ fontSize: 11, color: C.success, fontWeight: 600, marginTop: 4 }}>✓ Delivered {formatDate(actual)}</div>;
  }
  if (!expected) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const exp = new Date(expected); exp.setHours(0,0,0,0);
  const days = Math.round((exp - today) / (1000*60*60*24));
  let label, color;
  if (days < 0)      { label = `${Math.abs(days)} day${Math.abs(days)===1?'':'s'} overdue`; color = C.danger; }
  else if (days === 0){ label = 'Due today';                                                color = C.warning; }
  else if (days <= 3) { label = `${days} day${days===1?'':'s'} left`;                        color = C.warning; }
  else                { label = `${days} days left`;                                         color = C.textMuted; }
  return <div style={{ fontSize: 11, color, fontWeight: 600, marginTop: 4 }}>⏱ {label}</div>;
}

// ── Table shell (module scope — stable identity across renders) ────────────
function THead({ cols }) {
  const { C } = useTheme();
  const S = useStyles();
  return <thead><tr style={{ background: C.tableHeaderBg }}>{cols.map(c => <th key={c} style={{ ...S.th, background: C.tableHeaderBg, color: C.tableHeaderText }}>{c}</th>)}</tr></thead>;
}

function Btn({ children, onClick, variant = 'primary', sm, disabled, style = {}, title }) {
  const { C } = useTheme();
  const V = { primary: { bg: C.green, co: '#fff', b: 'none' }, amber: { bg: C.amber, co: '#fff', b: 'none' }, ghost: { bg: 'transparent', co: C.textMid, b: '1px solid ' + C.border }, danger: { bg: C.danger, co: '#fff', b: 'none' }, outline: { bg: 'transparent', co: C.green, b: '1px solid ' + C.green } }[variant] || {};
  return <button onClick={onClick} disabled={disabled} title={title} style={{ background: V.bg, color: V.co, border: V.b, borderRadius: 7, padding: sm ? '4px 11px' : '7px 16px', fontSize: sm ? 11.5 : 13, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', ...style }}>{children}</button>;
}

function KPI({ label, value, sub, accent, onClick }) {
  const { C } = useTheme();
  const c = accent || C.green;
  return (
    <div onClick={onClick} style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding: '12px 15px', flex: 1, minWidth: 140, position: 'relative', boxShadow: C.shadowCard, cursor: onClick ? 'pointer' : 'default', transition: 'transform 0.12s, box-shadow 0.12s' }} onMouseEnter={e=>{ if(onClick){ e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,0.15)'; }}} onMouseLeave={e=>{ e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=C.shadowCard; }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: c, borderRadius: '12px 0 0 12px' }} />
      <div style={{ paddingLeft: 6 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: c, lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{sub}</div>}
      </div>
    </div>
  );
}

function SectionLabel({ label }) {
  const { C } = useTheme();
  return <div style={{ fontSize: 11, fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.4px', margin: '16px 0 8px', paddingBottom: 5, borderBottom: '2px solid ' + C.greenPale }}>{label}</div>;
}

function FG({ label, full, children }) {
  const { C } = useTheme();
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 3, gridColumn: full ? '1/-1' : undefined }}><label style={{ fontSize: 11, fontWeight: 600, color: C.textMid }}>{label}</label>{children}</div>;
}

function Overlay({ children, onClose }) {
  // 2026-08-15: backdrop click used to call onClose directly — every RFQ, PO,
  // Waybill and Invoice form in this module is a long, multi-field form, so a
  // single misclick outside it silently discarded everything typed. Same fix
  // as ui/index.jsx's shared Modal: only the explicit × / Close button closes
  // this now.
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(10,35,15,0.60)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 880, marginBottom: 32 }}>{children}</div>
    </div>
  );
}

function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, padding: '16px 20px', boxShadow: C.shadowCard, ...style }}>{children}</div>;
}

function LinkedBadge({ label, color, onClick }) {
  const { C } = useTheme();
  const c = color || C.green;
  return <span onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, color: c, background: c + '18', border: '1px solid ' + c + '30', cursor: onClick ? 'pointer' : 'default' }}>{label} {onClick && '→'}</span>;
}

// ── Qty progress bar ───────────────────────────────────────────────────────
function QtyBar({ ordered, delivered, label }) {
  const { C } = useTheme();
  const pct = ordered > 0 ? Math.min((delivered / ordered) * 100, 100) : 0;
  const color = pct >= 100 ? C.success : pct > 0 ? C.warning : C.border;
  return (
    <div style={{ fontSize: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, color: C.textMuted }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color }}>{delivered}/{ordered}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: C.borderLight, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 3, transition: 'width .3s' }} />
      </div>
    </div>
  );
}

// ── Format currency ────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// DOCUMENT DETAIL MODALS
// ══════════════════════════════════════════════════════════════════════════════

// ── RFQ Create/View Modal ─────────────────────────────────────────────────
function RFQModal({ rfq, onSave, onClose, onCreatePO }) {
  const { C } = useTheme();
  const S = useStyles();
  const isView = !!rfq?.id;
  const RFQ_STATUSES = ['Sourcing', 'Bids Submitted', 'PO Received', 'PO Issued', 'Delivered', 'Cancelled'];
  const [form, setForm] = useState(rfq || { rfqNo: '', date: new Date().toISOString().split('T')[0], requiredBy: '', requestedBy: '', department: '', description: '', clientName: '', currency: 'NGN', items: [{ id: uid(), description: '', qty: '', unit: 'units', estimatedPrice: '' }], status: 'Sourcing' });
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  // 2026-08-15: same fix as WaybillModal's Pending Inspection lock. A saved
  // RFQ used to become permanently read-only, including while still
  // "Sourcing" — the phase where estimated prices get updated as supplier
  // quotes actually come in. Stays editable until it moves past Sourcing.
  //
  // Keyed off rfq.status (the saved record), not form.status (the live
  // dropdown), for the same reason as the waybill: flipping the dropdown to
  // "PO Received" must not itself lock the form or reveal "Create PO →"
  // before Save — onCreatePO(form) would then build a PO from data that was
  // never actually persisted to this RFQ.
  const isLocked = isView && rfq.status !== 'Sourcing';

  // Type-or-pick client, added 2026-08-06. An RFQ is a client enquiry (its
  // statuses run Sourcing → Bids Submitted → PO Received), but it never
  // recorded WHO it was for. Free text with suggestions, same as the PO.
  const [rfqClients] = useState(() => getClients().filter(c => c.status === 'Active'));

  function addItem() { setForm(p => ({ ...p, items: [...p.items, { id: uid(), description: '', qty: '', unit: 'units', estimatedPrice: '' }] })); }
  function setItem(i, k, v) { setForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, [k]: v } : x) })); }
  function removeItem(i) { setForm(p => ({ ...p, items: p.items.filter((_, j) => j !== i) })); }

  const totalEstimated = form.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.estimatedPrice) || 0), 0);

  return (
    <Overlay onClose={onClose}>
      <Card>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid ' + C.borderLight }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>📋 {isView ? form.rfqNo : 'New Request for Quotation'}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Enquiry / Tender Request</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* item 10: RFQ was the only doc in the RFQ→PO→Waybill→Invoice chain with no print output */}
            {isView && <Btn variant="ghost" sm onClick={() => printRFQ(form)}>🖨 Print RFQ</Btn>}
            {isView && rfq.status === 'PO Received' && <Btn variant="amber" sm onClick={() => onCreatePO(form)}>Create PO →</Btn>}
            {isView && <Tag status={form.status} />}
            <button onClick={onClose} aria-label="Close dialog" style={{ background: 'none', border: 'none', fontSize: 22, color: C.textMuted, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <FG label="RFQ Number"><input style={S.inp} value={form.rfqNo} onChange={set('rfqNo')} placeholder="Auto-generated" readOnly={isLocked} /></FG>
          <FG label="Date"><input style={S.inp} type="date" value={form.date} onChange={set('date')} readOnly={isLocked} /></FG>
          <FG label="Required By"><input style={S.inp} type="date" value={form.requiredBy} onChange={set('requiredBy')} readOnly={isLocked} /></FG>
          <FG label="Requested By"><input style={S.inp} value={form.requestedBy} onChange={set('requestedBy')} placeholder="Name" readOnly={isLocked} /></FG>
          <FG label="Department"><input style={S.inp} value={form.department} onChange={set('department')} placeholder="Enter department" readOnly={isLocked} /></FG>
          <FG label="Client Name">
            <input style={S.inp} list="rfq-party-suggestions" value={form.clientName || ''} onChange={set('clientName')} placeholder="Type a client name, or pick from the list" readOnly={isLocked} />
            <datalist id="rfq-party-suggestions">
              {rfqClients.map(c => <option key={c.id} value={c.code}>{c.name} ({c.currency})</option>)}
            </datalist>
          </FG>
          <FG label="Status"><select style={S.sel} value={form.status} onChange={set('status')} disabled={isLocked}>
            {RFQ_STATUSES.map(s => <option key={s}>{s}</option>)}</select></FG>
          <FG label="Currency"><select style={S.sel} value={form.currency ?? 'NGN'} onChange={set('currency')} disabled={isLocked}>{CURRENCIES.map(c => <option key={c} value={c}>{c || '— none —'}</option>)}</select></FG>
          <FG label="Description" full><input style={S.inp} value={form.description} onChange={set('description')} placeholder="Brief description of requirements" readOnly={isLocked} /></FG>
        </div>

        <SectionLabel label="Requested Items" />
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: 12 }}>
          <thead><tr style={{ background: C.greenPale }}>
            {['#', 'Description', 'Qty', 'Unit', 'Est. Unit Price' + curSuffix(form.currency), 'Est. Total' + curSuffix(form.currency), isLocked ? '' : 'Del'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {form.items.map((item, i) => (
              <tr key={item.id} style={{ background: i % 2 === 1 ? C.greenPale2 : 'transparent' }}>
                <td style={S.td}>{i + 1}</td>
                <td style={S.td}>{isLocked ? item.description : <input style={{ ...S.inp, minWidth: 180 }} value={item.description} onChange={e => setItem(i, 'description', e.target.value)} placeholder="Item description" />}</td>
                <td style={S.td}>{isLocked ? item.qty : <input style={{ ...S.inp, width: 70 }} type="number" value={item.qty} onChange={e => setItem(i, 'qty', e.target.value)} />}</td>
                <td style={S.td}>{isLocked ? item.unit : <input style={{ ...S.inp, width: 80 }} value={item.unit} onChange={e => setItem(i, 'unit', e.target.value)} />}</td>
                {/* item 10: an unfilled price is '' — Number('')||0 used to print as
                    a currency-formatted "0" here and in the row total, which read as
                    "this item is free" rather than "no price entered yet". Show a
                    dash instead until a real number (including a real 0) is typed. */}
                <td style={S.td}>{isLocked ? (item.estimatedPrice === '' || item.estimatedPrice == null ? '—' : fmtC(item.estimatedPrice, form.currency)) : <input style={{ ...S.inp, width: 120 }} type="number" value={item.estimatedPrice} onChange={e => setItem(i, 'estimatedPrice', e.target.value)} placeholder="Not yet priced" />}</td>
                <td style={{ ...S.td, fontWeight: 600, color: C.green }}>{(item.estimatedPrice === '' || item.estimatedPrice == null) ? '—' : fmtC((Number(item.qty) || 0) * (Number(item.estimatedPrice) || 0), form.currency)}</td>
                {!isLocked && <td style={S.td}><button onClick={() => removeItem(i)} style={{ background: C.danger, color: '#fff', border: 'none', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button></td>}
              </tr>
            ))}
          </tbody>
          <tfoot><tr style={{ background: C.greenPale, fontWeight: 700 }}>
            <td colSpan={5} style={{ ...S.td, textAlign: 'right' }}>Total Estimated Value</td>
            <td style={{ ...S.td, color: C.green, fontSize: 13 }}>{fmtC(totalEstimated, form.currency)}</td>
            {!isLocked && <td style={S.td} />}
          </tr></tfoot>
        </table>

        {!isLocked && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <Btn variant="ghost" sm onClick={addItem}>+ Add Item</Btn>
          </div>
        )}

        {!isLocked && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 14, borderTop: '1px solid ' + C.borderLight }}>
            <Btn variant="ghost" onClick={onClose}>{isView ? 'Close' : 'Cancel'}</Btn>
            <Btn onClick={() => onSave(form)}>{isView ? 'Save Changes' : 'Save RFQ'}</Btn>
          </div>
        )}
      </Card>
    </Overlay>
  );
}

// ── PO Create/View Modal ───────────────────────────────────────────────────
function POModal({ po, rfq, poType, onSave, onClose, onCreateWaybill, onViewWaybill, onCreateInvoice, onViewInvoice, waybills, invoices, currentUser, appSettings }) {
  const { C } = useTheme();
  const S = useStyles();
  // ── 2026-08-06, GM: "the PO should be editable until it has been approved" ──
  //
  // `isView` used to be simply `!!po?.id`, so a PO became read-only the instant
  // it was saved. A typo in a quantity or a price meant cancelling the PO and
  // raising a new one, with a new number.
  //
  // isView now means "locked", and a PO only locks once it has been approved.
  // Draft and Pending Approval stay editable. Approved / Partial / Complete /
  // Rejected / Cancelled do not: past that point the document has been signed
  // off, deliveries and invoices reference its lines, and silently changing it
  // would invalidate the approval that was given.
  const LOCKED_STATUSES = ['Approved', 'Partial', 'Complete', 'Rejected', 'Cancelled'];
  const isView = !!po?.id && LOCKED_STATUSES.includes(po.status);
  // Some controls key off "is this an existing record" rather than "is it
  // locked" — the approval chain, the Linked Documents panel, the print button.
  const isSaved = !!po?.id;
  const TERMS = ['Net 7', 'Net 15', 'Net 30', 'Net 45', 'Net 60', '50% Advance, 50% on Delivery', 'Full Payment on Delivery', 'Full Payment in Advance'];

  const initItems = rfq?.items?.map(ri => ({ id: uid(), rfqItemId: ri.id, materialNo: ri.materialNo || '', description: ri.description, qty: ri.qty, unit: ri.unit, unitPrice: '', totalPrice: 0 })) || [{ id: uid(), rfqItemId: '', materialNo: '', description: '', qty: '', unit: 'units', unitPrice: '', totalPrice: 0 }];

  const [form, setForm] = useState(po || {
    poNo: '', poType: poType || 'Client', rfqId: rfq?.id || '', rfqNo: rfq?.rfqNo || '',
    // Carry the client through from the RFQ this PO came from, so it isn't
    // retyped (and respelled) at the next step of the same job.
    supplier: rfq?.clientName || '', supplierAddress: '', date: new Date().toISOString().split('T')[0],
    deliveryDate: '', actualDeliveryDate: '', deliveryAddress: 'NLNG Site, Bonny Island',
    description: rfq?.description || '', paymentTerms: 'Net 30', currency: 'NGN',
    // 2026-08-06 — drives the expense account the supplier invoice posts to.
    // Coded here, at approval time, rather than at invoice time: this is the
    // point where the spend is actually authorised. The invoice inherits it.
    category: 'Materials',
    // Rate to NGN, set once on the PO and inherited by its invoice.
    fxRate: 1,
    items: initItems, subtotal: 0, vatRate: 7.5, vatAmount: 0, total: 0,
    status: 'Draft', approvedBy: '', notes: '', waybillRef: '', invoiceRef: '',
  });

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  // ── Counterparty: type-or-pick ──────────────────────────────────────────────
  // 2026-08-06, at SLOT's request. This was a <select> that FORCED a choice
  // from the vendor master. Staff need to raise a PO against a name that isn't
  // on the list yet, so it is now a free-text box with suggestions attached
  // (an <input list> + <datalist>): type anything, or pick an existing name.
  //
  // Why suggestions still matter: typing freely means "NLNG", "N.L.N.G." and
  // "Nigeria LNG Limited" become three different counterparties as far as every
  // report is concerned. Picking a suggested name keeps the spelling identical
  // on reuse, so per-supplier totals and aged payables stay correct.
  //
  // A Client PO's counterparty is a CLIENT and a SLOT PO's is a SUPPLIER, so
  // the suggestion list follows poType — matching the labels set on 2026-08-05.
  const [vendors] = useState(() => getVendors().filter(v => v.status === 'Active'));
  const [clients] = useState(() => getClients().filter(c => c.status === 'Active'));
  const partyList = form.poType === 'SLOT' ? vendors : clients;
  // Unmatched free text is expected, not an error: `p` is kept for address and
  // currency so typing a new name never blanks fields the user already filled.
  const handleVendorSelect = (code) => {
    const v = partyList.find(x => x.code === code || x.name === code);
    setForm(p => ({ ...p, supplier: code, supplierAddress: v?.address || p.supplierAddress, currency: v?.currency || p.currency }));
  };

  function recalc(items, vatRate) {
    const subtotal = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
    const vatAmount = Math.round(subtotal * (Number(vatRate) || 0) / 100);
    const total = subtotal + vatAmount;
    return { subtotal, vatAmount, total };
  }

  function setItem(i, k, v) {
    const next = form.items.map((x, j) => {
      if (j !== i) return x;
      const upd = { ...x, [k]: v };
      upd.totalPrice = (Number(upd.qty) || 0) * (Number(upd.unitPrice) || 0);
      return upd;
    });
    const calc = recalc(next, form.vatRate);
    setForm(p => ({ ...p, items: next, ...calc }));
  }

  function addItem() {
    setForm(p => ({ ...p, items: [...p.items, { id: uid(), rfqItemId: '', materialNo: '', description: '', qty: '', unit: 'units', unitPrice: '', totalPrice: 0 }] }));
  }
  function removeItem(i) {
    const next = form.items.filter((_, j) => j !== i);
    const calc = recalc(next, form.vatRate);
    setForm(p => ({ ...p, items: next, ...calc }));
  }
  function setVAT(v) {
    const calc = recalc(form.items, v);
    setForm(p => ({ ...p, vatRate: v, ...calc }));
  }

  // ── Approval chain actions — Approved is no longer directly settable via
  // the Status dropdown above; it can only be reached by clearing every
  // level of the amount-banded chain below (see utils/approvalEngine.js).
  const [approveNote, setApproveNote] = useState('');
  function submitForApproval() {
    const approval = initApproval('procurement_po', form.total, appSettings);
    const updated = { ...form, approval, status: 'Pending' };
    setForm(updated);
    onSave(updated);
  }
  function decide(decision) {
    const approval = applyDecision(form.approval, currentUser, decision, approveNote);
    const updated = { ...form, approval, status: approval.status, approvedBy: approval.status === 'Approved' ? currentUser?.name : form.approvedBy };
    setForm(updated);
    setApproveNote('');
    onSave(updated);
  }

  // Qty summary for view mode
  const linkedWaybills = (waybills || []).filter(wb => wb.poId === (po?.id || form.id));
  const linkedInvoices = (invoices || []).filter(inv => inv.poId === (po?.id || form.id));

  return (
    <Overlay onClose={onClose}>
      <Card>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid ' + C.borderLight }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>🛒 {isSaved ? form.poNo : `New ${form.poType === 'SLOT' ? 'SLOT' : 'Client'} Purchase Order`}</div>
            {isSaved && form.rfqNo && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Linked RFQ: <span style={{ color: C.green, fontWeight: 600 }}>{form.rfqNo}</span></div>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isSaved && form.poType !== 'SLOT' && (form.status === 'Approved' || form.status === 'Partial') && (
              <>
                <Btn variant="outline" sm onClick={() => onCreateWaybill(po)}>+ Waybill</Btn>
                <Btn variant="amber" sm onClick={() => onCreateInvoice(po)}>+ Invoice</Btn>
              </>
            )}
            {isSaved && <Btn variant="ghost" sm onClick={() => printPO(form)}>🖨 Print PO</Btn>}
            {isSaved && <Tag status={getPOStatus(po, waybills, invoices)} />}
            <button onClick={onClose} aria-label="Close dialog" style={{ background: 'none', border: 'none', fontSize: 22, color: C.textMuted, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        {/* Header fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          {!isView && (
            <FG label="PO Type" full>
              <div style={{ display: 'flex', gap: 8 }}>
                {['Client', 'SLOT'].map(t => (
                  <button key={t} onClick={() => setForm(p => ({ ...p, poType: t }))} type="button" style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                    border: '1px solid ' + ((form.poType || 'Client') === t ? C.green : C.borderLight),
                    background: (form.poType || 'Client') === t ? C.greenPale : 'transparent',
                    color: (form.poType || 'Client') === t ? C.green : C.textMuted,
                  }}>{t === 'Client' ? '🛒 Client Purchase Order' : '🏗 SLOT Purchase Order'}</button>
                ))}
              </div>
              {form.poType === 'SLOT' && (
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
                  SLOT Purchase Orders are for internal SLOT purchasing — no waybill/invoice documents are generated. Enter the waybill and invoice reference numbers manually below once available.
                </div>
              )}
            </FG>
          )}
          <FG label="PO Number"><input style={S.inp} value={form.poNo} onChange={set('poNo')} placeholder="Auto-generated" readOnly={isView} /></FG>
          <FG label="PO Date"><input style={S.inp} type="date" value={form.date} onChange={set('date')} readOnly={isView} /></FG>
          <FG label="Expected Delivery Date">
            <input style={S.inp} type="date" value={form.deliveryDate} onChange={set('deliveryDate')} readOnly={isView} />
            {isSaved && form.deliveryDate && <DeliveryCountdown expected={form.deliveryDate} actual={form.actualDeliveryDate} />}
          </FG>
          <FG label="Actual Delivery Date"><input style={S.inp} type="date" value={form.actualDeliveryDate||''} onChange={set('actualDeliveryDate')} /></FG>
          <FG label={form.poType === 'SLOT' ? 'Supplier Name' : 'Client Name'} full>
            <input
              style={S.inp}
              list="po-party-suggestions"
              value={form.supplier}
              onChange={e => handleVendorSelect(e.target.value)}
              placeholder={`Type a ${form.poType === 'SLOT' ? 'supplier' : 'client'} name, or pick from the list`}
              readOnly={isView}
            />
            <datalist id="po-party-suggestions">
              {partyList.map(v => <option key={v.id} value={v.code}>{v.name} ({v.currency})</option>)}
            </datalist>
          </FG>
          <FG label={form.poType === 'SLOT' ? 'Supplier Address' : 'Client Address'} full><input style={S.inp} value={form.supplierAddress} onChange={set('supplierAddress')} placeholder={form.poType === 'SLOT' ? 'Supplier address' : 'Client address'} readOnly={isView} /></FG>
          <FG label="Delivery Address" full><input style={S.inp} value={form.deliveryAddress} onChange={set('deliveryAddress')} placeholder="Where to deliver" readOnly={isView} /></FG>
          <FG label="Payment Terms"><select style={S.sel} value={form.paymentTerms} onChange={set('paymentTerms')} disabled={isView}>{TERMS.map(t => <option key={t}>{t}</option>)}</select></FG>
          <FG label="Expense Category"><select style={S.sel} value={form.category || 'Materials'} onChange={set('category')} disabled={isView}>{PO_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></FG>
          <FG label="VAT Rate (%)"><input style={S.inp} type="number" value={form.vatRate} onChange={e => setVAT(e.target.value)} readOnly={isView} /></FG>
          <FG label="Currency"><select style={S.sel} value={form.currency ?? 'NGN'} onChange={set('currency')} disabled={isView}>{CURRENCIES.map(c => <option key={c} value={c}>{c || '— none —'}</option>)}</select></FG>
          {form.currency && form.currency !== 'NGN' && (
            <FG label={`Rate: 1 ${form.currency} = ? NGN`}>
              <input style={S.inp} type="number" value={form.fxRate ?? ''} onChange={set('fxRate')}
                     placeholder="e.g. 2050" readOnly={isView} />
            </FG>
          )}
          <FG label="Status">
            {(!isView || form.status === 'Draft') ? (
              <select style={S.sel} value={form.status} onChange={set('status')} disabled={isView && form.status !== 'Draft'}>
                {['Draft', 'Cancelled'].map(s => <option key={s}>{s}</option>)}
              </select>
            ) : (
              <input style={S.inp} value={form.status} readOnly />
            )}
          </FG>
          {isSaved && <FG label="Approved By"><input style={S.inp} value={form.approvedBy} readOnly /></FG>}
          {form.poType === 'SLOT' && (
            <>
              <FG label="Waybill Reference No."><input style={S.inp} value={form.waybillRef||''} onChange={set('waybillRef')} placeholder="Enter waybill ref. no. for record" /></FG>
              <FG label="Invoice Reference No."><input style={S.inp} value={form.invoiceRef||''} onChange={set('invoiceRef')} placeholder="Enter invoice ref. no. for record" /></FG>
            </>
          )}
          <FG label="Description" full><input style={S.inp} value={form.description} onChange={set('description')} placeholder="Brief description" readOnly={isView} /></FG>
        </div>

        {/* Line items */}
        <SectionLabel label="Line Items" />
        <div style={{ overflowX: 'auto', marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: C.greenPale }}>
              {['#', 'Material No.', 'Description', 'Qty', 'Unit', 'Unit Price' + curSuffix(form.currency), 'Total' + curSuffix(form.currency), isView ? 'Delivered' : '', isView ? 'Remaining' : '', !isView ? 'Del' : ''].filter(Boolean).map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {form.items.map((item, i) => {
                const delivered = isView ? getDeliveredQty(item.id, waybills || [], po?.id) : 0;
                const remaining = Math.max(0, (Number(item.qty) || 0) - delivered);
                const rowBg = { background: i % 2 === 1 ? C.greenPale2 : 'transparent' };
                return (
                  <tr key={item.id} style={rowBg}>
                    <td style={S.td}>{i + 1}</td>
                    <td style={S.td}>{isView ? (item.materialNo || '—') : <input style={{ ...S.inp, width: 120 }} value={item.materialNo || ''} onChange={e => setItem(i, 'materialNo', e.target.value)} placeholder="MESC code" />}</td>
                    <td style={S.td}>{isView ? item.description : <input style={{ ...S.inp, minWidth: 200 }} value={item.description} onChange={e => setItem(i, 'description', e.target.value)} placeholder="Item description" />}</td>
                    <td style={S.td}>{isView ? item.qty : <input style={{ ...S.inp, width: 70 }} type="number" value={item.qty} onChange={e => setItem(i, 'qty', e.target.value)} />}</td>
                    <td style={S.td}>{isView ? item.unit : <input style={{ ...S.inp, width: 80 }} value={item.unit} onChange={e => setItem(i, 'unit', e.target.value)} />}</td>
                    <td style={S.td}>{isView ? fmtC(item.unitPrice, form.currency) : <input style={{ ...S.inp, width: 120 }} type="number" value={item.unitPrice} onChange={e => setItem(i, 'unitPrice', e.target.value)} />}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: C.green }}>{fmtC((Number(item.qty) || 0) * (Number(item.unitPrice) || 0), form.currency)}</td>
                    {isView && <td style={{ ...S.td, color: delivered >= (Number(item.qty) || 0) ? C.success : C.warning, fontWeight: 600 }}>{delivered}</td>}
                    {isView && <td style={{ ...S.td, color: remaining > 0 ? C.danger : C.success, fontWeight: 600 }}>{remaining}</td>}
                    {!isView && <td style={S.td}><button onClick={() => removeItem(i)} style={{ background: C.danger, color: '#fff', border: 'none', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button></td>}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: C.bgAlt }}><td colSpan={isView ? 6 : 5} style={{ ...S.td, textAlign: 'right', color: C.textMid }}>Subtotal</td><td colSpan={isView ? 4 : 2} style={{ ...S.td, fontWeight: 600 }}>{fmtC(form.subtotal, form.currency)}</td></tr>
              <tr style={{ background: C.bgAlt }}><td colSpan={isView ? 6 : 5} style={{ ...S.td, textAlign: 'right', color: C.textMid }}>VAT ({form.vatRate}%)</td><td colSpan={isView ? 4 : 2} style={{ ...S.td, fontWeight: 600 }}>{fmtC(form.vatAmount, form.currency)}</td></tr>
              <tr style={{ background: C.greenPale }}><td colSpan={isView ? 6 : 5} style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>TOTAL</td><td colSpan={isView ? 4 : 2} style={{ ...S.td, fontWeight: 700, color: C.green, fontSize: 14 }}>{fmtC(form.total, form.currency)}</td></tr>
            </tfoot>
          </table>
        </div>

        {!isView && (
          <Btn variant="ghost" sm onClick={addItem} style={{ marginBottom: 16 }}>+ Add Line Item</Btn>
        )}

        {/* Linked documents (view mode only) */}
        {isSaved && (linkedWaybills.length > 0 || linkedInvoices.length > 0) && (
          <>
            <SectionLabel label="Linked Documents" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {linkedWaybills.map(wb => (
                <LinkedBadge key={wb.id} label={'🚚 ' + wb.waybillNo + ' (' + wb.status + ')'} color={C.info} onClick={() => onViewWaybill(wb)} />
              ))}
              {linkedInvoices.map(inv => (
                <LinkedBadge key={inv.id} label={'🧾 ' + inv.invoiceNo + ' (' + inv.status + ')'} color={C.amber} onClick={() => onViewInvoice(inv)} />
              ))}
            </div>
          </>
        )}

        {/* Approval chain — replaces the old free-form Status=Approved dropdown */}
        {isSaved && form.status === 'Draft' && (
          <div style={{ marginTop: 16, padding: '12px 14px', background: C.greenPale, border: '1px solid ' + C.borderLight, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: C.textMuted }}>
              This PO is still a Draft. Submitting routes it through the authorization chain for its value ({fmt(form.total)}) — see Settings → Approvals for the current bands.
            </div>
            <Btn onClick={submitForApproval}>Submit for Approval</Btn>
          </div>
        )}
        {isSaved && form.approval && form.status !== 'Draft' && (
          <div style={{ marginTop: 16, padding: '12px 14px', background: form.status === 'Rejected' ? 'rgba(192,57,43,.08)' : form.status === 'Approved' ? 'rgba(26,122,74,.08)' : 'rgba(201,122,10,.08)', border: '1px solid ' + (form.status === 'Rejected' ? 'rgba(192,57,43,.2)' : form.status === 'Approved' ? 'rgba(26,122,74,.2)' : 'rgba(201,122,10,.2)'), borderRadius: 8 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: form.status === 'Rejected' ? C.danger : form.status === 'Approved' ? C.success : C.amber, marginBottom: 6 }}>
              {approvalSummary(form.approval, appSettings)}
            </div>
            {form.approval.history?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: canApproveAtCurrentLevel(form.approval, currentUser) ? 10 : 0 }}>
                {form.approval.history.map((h, i) => (
                  <div key={i} style={{ fontSize: 11, color: C.textMuted }}>
                    Level {h.level} ({h.role}): <strong style={{ color: h.decision === 'Approved' ? C.success : C.danger }}>{h.decision}</strong> by {h.by} — {new Date(h.at).toLocaleString()}{h.note ? ` — "${h.note}"` : ''}
                  </div>
                ))}
              </div>
            )}
            {canApproveAtCurrentLevel(form.approval, currentUser) && (
              <div>
                <input style={{ ...S.inp, marginBottom: 8 }} placeholder="Note (optional)" value={approveNote} onChange={e => setApproveNote(e.target.value)} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn variant="success" onClick={() => decide('Approved')}>✓ Approve (Level {form.approval.currentLevel + 1})</Btn>
                  <Btn variant="danger" onClick={() => decide('Rejected')}>✕ Reject</Btn>
                </div>
              </div>
            )}
          </div>
        )}

        {!isView && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 14, borderTop: '1px solid ' + C.borderLight }}>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn onClick={() => onSave(form)}>{isSaved ? 'Update Purchase Order' : 'Save Purchase Order'}</Btn>
          </div>
        )}
        {isView && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 14, borderTop: '1px solid ' + C.borderLight }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginRight: 'auto', alignSelf: 'center' }}>Actual Delivery Date{form.poType === 'SLOT' ? ', Waybill Ref. and Invoice Ref.' : ''} can be updated here as they become available.</div>
            <Btn variant="ghost" onClick={onClose}>Close</Btn>
            <Btn onClick={() => onSave(form)}>Update</Btn>
          </div>
        )}
      </Card>
    </Overlay>
  );
}

// ── Waybill Create/View Modal ──────────────────────────────────────────────
// ── Print: Waybill / Goods Received Note ─────────────────────────────────────
// Takes a waybill record, so the same sheet can be printed from inside
// WaybillModal (passing the in-progress form) and from a row in the waybills
// list without opening the record first.
function printWaybill(form) {
  // 2026-08-06, GM: on a partial delivery the sheet listed every line on the
  // PO, including the ones with nothing on the truck — pages of "0 units" that
  // the driver and the receiving officer had to read past. A delivery note
  // should describe what was actually delivered, so lines with no quantity are
  // left off. (The full ordered list still lives on the PO itself.)
  const delivered = (form.items || []).filter(i => (Number(i.deliveredQty) || 0) > 0);
  const omitted   = (form.items || []).length - delivered.length;
  const totalDelivered = delivered.reduce((s, i) => s + (Number(i.deliveredQty) || 0), 0);
  openPrintWindow(`<!DOCTYPE html><html><head><title>${form.waybillNo}</title><style>
      body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:28px;max-width:860px;margin:0 auto}
      .header-bar{background:#C97A0A;color:#fff;padding:8px 16px;display:flex;justify-content:space-between;font-weight:700;font-size:13px}
      table{width:100%;border-collapse:collapse;margin-top:14px}
      th{background:#EAF4EC;padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;color:#3A5040}
      td{padding:8px 10px;border-bottom:1px solid #EAF0EB}
      .meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:14px 0;padding:14px;background:#f9fafb;border-radius:8px;border:1px solid #EAF0EB}
      .f label{font-size:9px;font-weight:700;text-transform:uppercase;color:#182A1C;display:block;margin-bottom:2px}
      .f span{font-size:12px;font-weight:600}
      .tfoot-row td{background:#EAF4EC;font-weight:700}
      .sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:40px}
      .sig{border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C;margin-top:30px}
      @media print{body{padding:16px}}
    </style></head><body>
      <!-- 2026-08-06, GM: this banner carried the company NAME but no logo —
           the waybill was the only Procurement document not using printHeader(),
           which embeds it. The logo is added here rather than switching to
           printHeader() so the delivery note keeps its own distinct look. -->
      <div style="background:linear-gradient(135deg,#0F3A1A,#1A5C2A);padding:14px 20px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="background:#fff;border-radius:6px;padding:4px 6px;display:flex">
            <img src="data:image/jpeg;base64,${SLOT_LOGO_B64}" alt="SLOT Engineering Nigeria Limited" style="height:38px;width:auto;display:block" />
          </div>
          <div>
            <div style="color:#fff;font-size:16px;font-weight:800">SLOT Engineering Nigeria Limited</div>
            <div style="color:rgba(255,255,255,.6);font-size:10px;margin-top:2px">Port Harcourt, Rivers State, Nigeria</div>
          </div>
        </div>
        <div style="color:rgba(255,255,255,.75);font-size:11px;font-weight:600">GOODS RECEIVED NOTE / WAYBILL</div>
      </div>
      <div class="header-bar"><span>${form.waybillNo || 'DRAFT'}</span><span>Date: ${form.date}</span></div>
      <div class="meta">
        <div class="f"><label>PO Reference</label><span>${form.poNo}</span></div>
        <div class="f"><label>Supplier</label><span>${form.supplier}</span></div>
        <div class="f"><label>Status</label><span>${form.status}</span></div>
        <div class="f"><label>Received By</label><span>${form.receivedBy||'—'}</span></div>
        <div class="f"><label>Vehicle / Truck No</label><span>${form.vehicleNo||'—'}</span></div>
        <div class="f"><label>Driver Name</label><span>${form.driverName||'—'}</span></div>
        ${form.deliveryAddress?`<div class="f" style="grid-column:1/-1"><label>Delivery Address</label><span>${form.deliveryAddress}</span></div>`:''}
      </div>
      <table>
        <thead><tr><th>#</th><th>Material No.</th><th>Description</th><th>Qty</th><th>Unit</th></tr></thead>
        <tbody>
          ${delivered.map((item,i)=>
            `<tr><td>${i+1}</td><td>${item.materialNo||'—'}</td><td>${item.description}</td><td style="font-weight:700;color:#1A5C2A">${item.deliveredQty||0}</td><td>${item.unit}</td></tr>`
          ).join('') || '<tr><td colspan="5" style="text-align:center;padding:18px">No items recorded as delivered on this waybill.</td></tr>'}
        </tbody>
        <tfoot><tr class="tfoot-row"><td colspan="3">Total This Delivery</td><td colspan="2" style="font-weight:800">${totalDelivered} units</td></tr></tfoot>
      </table>
      ${omitted > 0 ? `<div style="margin-top:8px;font-size:10.5px;color:#4A5C4E">Partial delivery — ${omitted} further item${omitted>1?'s':''} on PO ${form.poNo||''} ${omitted>1?'were':'was'} not delivered on this trip and ${omitted>1?'are':'is'} not listed above.</div>` : ''}
      ${form.notes?`<div style="margin-top:12px;padding:10px;background:#f9fafb;border-radius:6px;font-size:11px"><strong>Notes:</strong> ${form.notes}</div>`:''}
      <div class="sigs">
        <div><div class="sig">Driver Signature / Date</div></div>
        <div><div class="sig">Received By / Date</div></div>
        <div><div class="sig">Store / Warehouse Officer / Date</div></div>
      </div>
      ${printBootstrap({ landscape: false })}
    </body></html>`);
}

function WaybillModal({ wb, po, onSave, onClose, onCreateInvoice, allWaybills = [], invoices = [] }) {
  const { C } = useTheme();
  const S = useStyles();
  const isView = !!wb?.id;
  // item 5: one invoice per waybill. Without this check, "Create Invoice →"
  // stayed clickable forever, so a supplier's waybill could be invoiced twice.
  const existingInvoice = wb?.id ? invoices.find(inv => inv.waybillId === wb.id) : null;

  // FIX: New waybill shows ONLY items with remaining qty (not yet fully delivered)
  const initItems = (() => {
    const poItems = po?.items || [];
    return poItems
      .map(pi => {
        // Sum up all previously delivered qty for this PO item across all waybills
        const prevDelivered = allWaybills
          .filter(w => w.poId === po?.id && w.id !== wb?.id)
          .flatMap(w => w.items || [])
          .filter(wi => wi.poItemId === pi.id)
          .reduce((s, wi) => s + (Number(wi.deliveredQty) || 0), 0);
        const remaining = Math.max(0, (Number(pi.qty) || 0) - prevDelivered);
        return { id: uid(), poItemId: pi.id, materialNo: pi.materialNo || '', description: pi.description, orderedQty: Number(pi.qty) || 0, previouslyDelivered: prevDelivered, remaining, deliveredQty: '', unit: pi.unit, unitPrice: Number(pi.unitPrice) || 0 };
      })
      .filter(item => item.remaining > 0); // Only show items still outstanding
  })();

  const [form, setForm] = useState(wb || {
    waybillNo: '', poId: po?.id || '', poNo: po?.poNo || '',
    supplier: po?.supplier || '',
    date: new Date().toISOString().split('T')[0], receivedBy: '', vehicleNo: '', driverName: '',
    deliveryAddress: po?.deliveryAddress || '',
    items: initItems,
    status: 'Pending Inspection', notes: '',
  });

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  function setItem(i, k, v) { setForm(p => ({ ...p, items: p.items.map((x, j) => j === i ? { ...x, [k]: v } : x) })); }

  // 2026-08-15: a saved waybill used to become permanently read-only the
  // instant it had an id — including while still "Pending Inspection", the
  // status that means "not decided yet." A waybill saved partway through
  // inspection, with some item quantities still blank, had no way back in
  // to finish it — the whole form locked immediately on first save. Now it
  // stays editable until a decision is recorded (Accepted / Partially
  // Accepted / Rejected), matching the same still-editable-while-Draft
  // pattern POModal already uses for POs.
  //
  // Keyed off wb.status (the saved record), NOT form.status (the live,
  // possibly-unsaved dropdown value). If this read form.status instead,
  // flipping the Status dropdown to "Accepted" would lock the form and
  // reveal "Create Invoice →" before Save was ever clicked — losing
  // whatever item quantities were just typed, and handing Create Invoice
  // a stale `wb` prop that doesn't have this session's edits at all.
  const isLocked = isView && wb.status !== 'Pending Inspection';

  const totalDelivered = form.items.reduce((s, i) => s + (Number(i.deliveredQty) || 0), 0);
  const totalValue = form.items.reduce((s, i) => s + (Number(i.deliveredQty) || 0) * (Number(i.unitPrice) || 0), 0);

  // Print waybill — the sheet itself is printWaybill(), defined at module scope
  // just above this component so a row in the waybills list can print it too.
  function handlePrintWaybill() { printWaybill(form); }

  return (
    <Overlay onClose={onClose}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid ' + C.borderLight }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>🚚 {isView ? form.waybillNo : 'New Waybill / Delivery Note'}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>PO: <span style={{ color: C.green, fontWeight: 600 }}>{form.poNo}</span>
              {!isView && initItems.length === 0 && <span style={{ color: C.success, marginLeft: 8, fontWeight: 600 }}>✓ All items fully delivered</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isView && <Btn variant="ghost" sm onClick={handlePrintWaybill}>🖨 Print Waybill</Btn>}
            {/* wb.status, not form.status — Create Invoice must only appear once
                Accepted has actually been saved, not the instant it's picked in
                the dropdown, or it would hand onCreateInvoice a stale wb with
                none of this session's unsaved edits. */}
            {isView && wb.status === 'Accepted' && !existingInvoice && <Btn variant="amber" sm onClick={() => onCreateInvoice && onCreateInvoice(wb)}>Create Invoice →</Btn>}
            {isView && wb.status === 'Accepted' && existingInvoice && <span style={{ fontSize: 11, color: C.success, fontWeight: 600 }}>✓ Invoiced ({existingInvoice.invoiceNo})</span>}
            {isView && <Tag status={form.status} />}
            <button onClick={onClose} aria-label="Close dialog" style={{ background: 'none', border: 'none', fontSize: 22, color: C.textMuted, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <FG label="Waybill Number"><input style={S.inp} value={form.waybillNo} onChange={set('waybillNo')} placeholder="Auto-generated" readOnly={isLocked} /></FG>
          <FG label="Date Received"><input style={S.inp} type="date" value={form.date} onChange={set('date')} readOnly={isLocked} /></FG>
          <FG label="Received By"><input style={S.inp} value={form.receivedBy} onChange={set('receivedBy')} placeholder="Name of receiver" readOnly={isLocked} /></FG>
          <FG label="Vehicle / Truck No"><input style={S.inp} value={form.vehicleNo} onChange={set('vehicleNo')} placeholder="e.g. PHC-234-GH" readOnly={isLocked} /></FG>
          <FG label="Driver Name"><input style={S.inp} value={form.driverName} onChange={set('driverName')} placeholder="Driver name" readOnly={isLocked} /></FG>
          <FG label="Status"><select style={S.sel} value={form.status} onChange={set('status')} disabled={isLocked}>{['Pending Inspection', 'Accepted', 'Partially Accepted', 'Rejected'].map(s => <option key={s}>{s}</option>)}</select></FG>
          <FG label="Delivery Address" full><input style={S.inp} value={form.deliveryAddress} onChange={set('deliveryAddress')} readOnly={isLocked} /></FG>
        </div>

        <SectionLabel label="Items Delivered (Outstanding Only)" />
        <div style={{ overflowX: 'auto', marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: C.amber, color: '#fff' }}>
              {['#', 'Description', 'Ordered Qty', 'Prev. Delivered', 'This Delivery', 'Unit'].map(h => (
                <th key={h} style={{ ...S.th, background: C.amber, color: '#fff' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {form.items.length === 0 && (
                <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', padding: 24, color: C.success, fontWeight: 600 }}>
                  ✓ All items from this PO have been fully delivered
                </td></tr>
              )}
              {form.items.map((item, i) => (
                <tr key={item.id} style={{ background: i % 2 === 1 ? C.amberPale : 'transparent' }}>
                  <td style={S.td}>{i + 1}</td>
                  <td style={S.td}>{item.description}</td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{item.orderedQty}</td>
                  <td style={{ ...S.td, color: C.textMuted }}>{item.previouslyDelivered || 0}</td>
                  <td style={S.td}>{isLocked ? <strong style={{ color: C.success }}>{item.deliveredQty}</strong> : <input style={{ ...S.inp, width: 80 }} type="number" value={item.deliveredQty} max={item.remaining} onChange={e => setItem(i, 'deliveredQty', e.target.value)} />}</td>
                  <td style={S.td}>{item.unit}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: C.amberPale, fontWeight: 700 }}>
                <td colSpan={4} style={{ ...S.td, textAlign: 'right' }}>Total This Delivery</td>
                <td style={{ ...S.td, color: C.amber, fontSize: 14 }}>{totalDelivered} units</td>
                <td style={S.td} />
              </tr>
            </tfoot>
          </table>
        </div>

        {!isLocked && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 14, borderTop: '1px solid ' + C.borderLight }}>
            <Btn variant="ghost" onClick={onClose}>{isView ? 'Close' : 'Cancel'}</Btn>
            {!isView && <Btn variant="ghost" onClick={handlePrintWaybill}>🖨 Print Draft</Btn>}
            <Btn onClick={() => onSave(form)}>{isView ? 'Save Changes' : 'Save Waybill'}</Btn>
          </div>
        )}
      </Card>
    </Overlay>
  );
}

// ── Supplier Invoice Create/View Modal ─────────────────────────────────────
function InvoiceModal({ inv, po, wb, onSave, onClose, allWaybills = [], invoices = [] }) {
  const { C } = useTheme();
  const S = useStyles();
  const isView = !!inv?.id;
  // 2026-08-17: every field on a saved invoice is locked (isView disables the
  // whole form, no Save button renders) - by design, so a submitted invoice's
  // numbers can't be quietly altered. But that left literally no way to void
  // a bad one (e.g. a duplicate, or one that pulled undelivered stock before
  // the poOnlyItems fix above existed) - the record just sits there forever.
  // This adds one narrow, reason-required exception: flip status to
  // Cancelled via the same onSave/saveInvoice path a normal edit would use,
  // nothing else on the record changes.
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  // Suggestions for the Supplier box below — both masters, since an invoice can
  // sit against either a SLOT PO (supplier) or a Client PO (client).
  const [invParties] = useState(() => [
    ...getVendors().filter(v => v.status === 'Active'),
    ...getClients().filter(c => c.status === 'Active'),
  ]);

  // Pre-fill from waybill items.
  // 2026-08-15: was mapping every item in wb.items regardless of quantity, so
  // a waybill left partially filled in (items with no "This Delivery" qty
  // entered — see WaybillModal's Pending Inspection editing fix) put ₦0.00
  // rows on the invoice for stuff that was never actually delivered. Only
  // items with a real delivered qty belong on the invoice; the rest weren't
  // "stated on the waybill" in any sense that should generate a bill line.
  //
  // 2026-08-15 (same day, second half of the same bug report): the OTHER way
  // to reach this modal — POModal's own "+ Invoice" button, which passes a
  // `po` with no `wb` — still fell back to `po.items` at the PO's full
  // ORDERED qty. That put every line on the bill at planned quantity
  // regardless of whether it had shipped yet, which is the exact "capturing
  // items not yet delivered" bug, just reached from the PO screen instead of
  // a waybill. An invoice raised straight from the PO should reflect what's
  // actually landed across ALL waybills recorded against it so far, net of
  // whatever's already been invoiced (so re-opening "+ Invoice" after a
  // partial billing run doesn't re-bill the same delivered stock) — never
  // the plan.
  const poOnlyItems = (po && !wb) ? (po.items || []).map(pi => {
    const delivered = allWaybills
      .filter(w => w.poId === po.id)
      .flatMap(w => w.items || [])
      .filter(wi => wi.poItemId === pi.id)
      .reduce((s, wi) => s + (Number(wi.deliveredQty) || 0), 0);
    const alreadyInvoiced = getInvoicedQty(pi.id, invoices, po.id);
    const remaining = delivered - alreadyInvoiced;
    if (remaining <= 0) return null;
    return { id: uid(), poItemId: pi.id, description: pi.description, qty: remaining, unit: pi.unit, unitPrice: Number(pi.unitPrice) || 0, totalPrice: remaining * (Number(pi.unitPrice) || 0) };
  }).filter(Boolean) : null;

  const initItems = wb?.items?.filter(wi => (Number(wi.deliveredQty) || 0) > 0).map(wi => ({ id: uid(), poItemId: wi.poItemId, waybillItemId: wi.id, description: wi.description, qty: Number(wi.deliveredQty) || 0, unit: wi.unit, unitPrice: Number(wi.unitPrice) || 0, totalPrice: (Number(wi.deliveredQty) || 0) * (Number(wi.unitPrice) || 0) })) || poOnlyItems || [];

  const initSubtotal = initItems.reduce((s, i) => s + i.totalPrice, 0);
  const initVAT = Math.round(initSubtotal * 0.075);

  const [form, setForm] = useState(inv || {
    invoiceNo: '', supplierInvoiceNo: '',
    poId: po?.id || '', poNo: po?.poNo || '',
    waybillId: wb?.id || '', waybillNo: wb?.waybillNo || '',
    grnNo: '',  // FIX: GRN number field
    supplier: po?.supplier || wb?.supplier || '',
    date: new Date().toISOString().split('T')[0],
    dueDate: '',
    items: initItems,
    subtotal: initSubtotal, vatAmount: initVAT,
    currency: po?.currency || wb?.currency || 'NGN',
    // Inherited from the PO so the ledger posts to the right expense account.
    category: po?.category || 'Materials',
    total: initSubtotal + initVAT,
    netPayable: initSubtotal + initVAT,
    status: 'Pending', paymentDate: '', paymentRef: '', notes: '',
  });

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  function recalc(items) {
    const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
    const vatAmount = Math.round(subtotal * 0.075);
    const total = subtotal + vatAmount;
    const netPayable = total;
    return { subtotal, vatAmount, total, netPayable };
  }

  function setItem(i, k, v) {
    const next = form.items.map((x, j) => {
      if (j !== i) return x;
      const upd = { ...x, [k]: v };
      upd.totalPrice = (Number(upd.qty) || 0) * (Number(upd.unitPrice) || 0);
      return upd;
    });
    setForm(p => ({ ...p, items: next, ...recalc(next) }));
  }

  return (
    <Overlay onClose={onClose}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid ' + C.borderLight }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>🧾 {isView ? form.invoiceNo : 'New Supplier Invoice'}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              PO: <span style={{ color: C.green, fontWeight: 600 }}>{form.poNo}</span>
              {form.waybillNo && <> · Waybill: <span style={{ color: C.info, fontWeight: 600 }}>{form.waybillNo}</span></>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isView && <Btn variant="ghost" sm onClick={() => printInvoice(form)}>🖨 Print Invoice</Btn>}
            {isView && !['Paid', 'Cancelled'].includes(form.status) && (
              <Btn variant="danger" sm onClick={() => setVoidOpen(v => !v)}>🚫 Void</Btn>
            )}
            {isView && <Tag status={form.status} />}
            <button onClick={onClose} aria-label="Close dialog" style={{ background: 'none', border: 'none', fontSize: 22, color: C.textMuted, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        {voidOpen && (
          <div style={{ background: 'rgba(192,57,43,.08)', border: '1px solid ' + C.danger, borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.danger, marginBottom: 6 }}>Void this invoice</div>
            <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 8 }}>
              Sets status to Cancelled and excludes it from "already invoiced" totals against this PO. The record itself is kept for the audit trail — it isn't deleted. Requires a reason.
            </div>
            <input
              style={{ ...S.inp, marginBottom: 8 }}
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
              placeholder="e.g. Duplicate of SINV-2026-20260002 - same waybill billed twice"
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" sm onClick={() => { setVoidOpen(false); setVoidReason(''); }}>Cancel</Btn>
              <Btn variant="danger" sm disabled={!voidReason.trim()} onClick={() => {
                onSave({ ...form, status: 'Cancelled', notes: (form.notes ? form.notes + ' | ' : '') + `VOIDED ${new Date().toISOString().split('T')[0]}: ${voidReason.trim()}` }, { print: false });
              }}>Confirm Void</Btn>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <FG label="System Invoice No"><input style={S.inp} value={form.invoiceNo} onChange={set('invoiceNo')} placeholder="Auto-generated" readOnly={isView} /></FG>
          <FG label="Supplier Invoice Ref"><input style={S.inp} value={form.supplierInvoiceNo} onChange={set('supplierInvoiceNo')} placeholder="Supplier's ref number" readOnly={isView} /></FG>
          <FG label="GRN Number"><input style={S.inp} value={form.grnNo} onChange={set('grnNo')} placeholder="e.g. GRN-2025-001" readOnly={isView} /></FG>
          {/* Already free text; the datalist just keeps spelling consistent with
              whatever was typed on the PO, so both group together in reports. */}
          <FG label="Supplier">
            <input style={S.inp} list="inv-party-suggestions" value={form.supplier} onChange={set('supplier')} placeholder="Type a name, or pick from the list" readOnly={isView} />
            <datalist id="inv-party-suggestions">
              {invParties.map(v => <option key={v.id} value={v.code}>{v.name} ({v.currency})</option>)}
            </datalist>
          </FG>
          <FG label="Invoice Date"><input style={S.inp} type="date" value={form.date} onChange={set('date')} readOnly={isView} /></FG>
          <FG label="Due Date"><input style={S.inp} type="date" value={form.dueDate} onChange={set('dueDate')} readOnly={isView} /></FG>
          <FG label="Currency"><select style={S.sel} value={form.currency ?? 'NGN'} onChange={set('currency')} disabled={isView}>{CURRENCIES.map(c => <option key={c} value={c}>{c || '— none —'}</option>)}</select></FG>
          {form.currency && form.currency !== 'NGN' && (
            <FG label={`Rate: 1 ${form.currency} = ? NGN`}>
              <input style={S.inp} type="number" value={form.fxRate ?? ''} onChange={set('fxRate')}
                     placeholder="e.g. 2050" readOnly={isView} />
            </FG>
          )}
          <FG label="Status"><select style={S.sel} value={form.status} onChange={set('status')} disabled={isView}>{['Pending', 'Approved', 'Paid', 'Overdue', 'Disputed', 'Cancelled'].map(s => <option key={s}>{s}</option>)}</select></FG>
          {(isView && form.status === 'Paid') && <FG label="Payment Date"><input style={S.inp} value={form.paymentDate} readOnly /></FG>}
          {(isView && form.status === 'Paid') && <FG label="Payment Ref"><input style={S.inp} value={form.paymentRef} readOnly /></FG>}
        </div>

        <SectionLabel label="Invoice Line Items (Based on Delivery)" />
        <div style={{ overflowX: 'auto', marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: C.amber }}>
              {['#', 'Description', 'Delivered Qty', 'Unit', 'Unit Price' + curSuffix(form.currency), 'Line Total' + curSuffix(form.currency)].map(h => (
                <th key={h} style={{ ...S.th, background: C.amber, color: '#fff' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {form.items.map((item, i) => (
                <tr key={item.id} style={{ background: i % 2 === 1 ? C.amberPale : 'transparent' }}>
                  <td style={S.td}>{i + 1}</td>
                  <td style={S.td}>{item.description}</td>
                  <td style={S.td}>{isView ? <strong>{item.qty}</strong> : <input style={{ ...S.inp, width: 80 }} type="number" value={item.qty} onChange={e => setItem(i, 'qty', e.target.value)} />}</td>
                  <td style={S.td}>{item.unit}</td>
                  <td style={S.td}>{isView ? fmtC(item.unitPrice, form.currency) : <input style={{ ...S.inp, width: 120 }} type="number" value={item.unitPrice} onChange={e => setItem(i, 'unitPrice', e.target.value)} />}</td>
                  <td style={{ ...S.td, fontWeight: 600, color: C.green }}>{fmtC(item.totalPrice, form.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {[['Subtotal', form.subtotal, C.text], ['VAT (7.5%)', form.vatAmount, C.text], ['NET PAYABLE', form.netPayable, C.green]].map(([label, val, color]) => (
                <tr key={label} style={{ background: label === 'NET PAYABLE' ? C.greenPale : C.bgAlt }}>
                  <td colSpan={5} style={{ ...S.td, textAlign: 'right', fontWeight: label === 'NET PAYABLE' ? 700 : 500 }}>{label}</td>
                  <td style={{ ...S.td, fontWeight: 700, color, fontSize: label === 'NET PAYABLE' ? 15 : 12 }}>{val < 0 ? '(' + fmtC(Math.abs(val), form.currency) + ')' : fmtC(val, form.currency)}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>

        {!isView && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', paddingTop: 14, borderTop: '1px solid ' + C.borderLight }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginRight: 'auto' }}>
              The invoice number is assigned on submit, so the printed copy for the customer is produced at the same time.
            </div>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn onClick={() => onSave(form, { print: true })}>🖨 Print &amp; Submit</Btn>
          </div>
        )}

        {isView && form.status !== 'Paid' && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 14, borderTop: '1px solid ' + C.borderLight }}>
            <Btn variant="amber" onClick={() => onSave({ ...form, status: 'Paid', paymentDate: new Date().toISOString().split('T')[0] })}>Mark as Paid</Btn>
          </div>
        )}
      </Card>
    </Overlay>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PROCUREMENT COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
const PROC_TABS = [
  { key: 'rfq',     label: '📋  RFQ / Enquiry' },
  { key: 'po',      label: '🛒  Purchase Orders' },
  { key: 'waybill', label: '🚚  Waybills / Delivery' },
  { key: 'invoice', label: '🧾  Supplier Invoices' },
];

export default function Procurement({ onNav }) {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser } = state;
  const perms = { add: canDo(currentUser, 'canAdd', 'procurement', state.appSettings), edit: canDo(currentUser, 'canEdit', 'procurement', state.appSettings), del: canDo(currentUser, 'canDelete', 'procurement', state.appSettings) };

  // ── Load / initialise data ───────────────────────────────────────────────
  // Central store (Supabase-synced) first. One-time migration from the old
  // private 'slot_proc' key if the central store is empty — that key held
  // this module's entire transaction history, and it was never reaching the
  // cloud (no dispatch() was ever called here before this fix). After this
  // runs once, slot_proc is cleared and db.procurement becomes the only
  // source of truth, same as every other module.
  function loadInitial() {
    const central = state.db?.procurement;
    if (central && (central.rfqs?.length || central.pos?.length || central.waybills?.length || central.invoices?.length)) {
      return central;
    }
    // Deliberately wiped (Backup → Wipe All Data) → an empty central store
    // means empty, full stop. Don't fall through to the legacy key.
    if (state.appSettings?.dataWiped) return central || { rfqs: [], pos: [], waybills: [], invoices: [] };
    const legacy = loadProc();
    if (legacy) {
      localStorage.removeItem(PROC_KEY);
      return legacy;
    }
    return null;
  }
  const saved = loadInitial();
  const [rfqs,      setRfqs]      = useState(saved?.rfqs      || EMPTY_PROC.rfqs);
  const [pos,       setPos]       = useState(saved?.pos       || EMPTY_PROC.pos);
  const [waybills,  setWaybills]  = useState(saved?.waybills  || EMPTY_PROC.waybills);
  const [invoices,  setInvoices]  = useState(saved?.invoices  || EMPTY_PROC.invoices);

  // Pick up changes that arrive from another device (initial cloud load
  // finishing after this component already mounted, or a live realtime
  // update) — mirrors the pattern used in FleetMaintenance/PettyCash.
  useEffect(() => {
    const dbProc = state.db?.procurement;
    if (!dbProc) return;
    if (!rfqs.length && dbProc.rfqs?.length)         setRfqs(dbProc.rfqs);
    if (!pos.length && dbProc.pos?.length)           setPos(dbProc.pos);
    if (!waybills.length && dbProc.waybills?.length) setWaybills(dbProc.waybills);
    if (!invoices.length && dbProc.invoices?.length) setInvoices(dbProc.invoices);
  }, [state.db.procurement]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist to the central store — this is what actually reaches Supabase.
  // (saveProc/localStorage removed entirely: keeping a second, separate,
  // un-synced copy was the original bug. The central store already has its
  // own localStorage mirror via db.js, so nothing is lost by removing this.)
  const persist = useCallback((r, p, w, i) => {
    dispatch({ type: 'UPDATE_MODULE', mod: 'procurement', data: { rfqs: r, pos: p, waybills: w, invoices: i } });
  }, [dispatch]);

  function save(setFn, listName, newList) {
    // Per-record push — 2026-07-29 full-app sync sweep. `listName` tells us
    // exactly which of the four sub-collections changed and what its prior
    // list was, so this pushes only the changed/added/removed records
    // instead of the whole procurement blob.
    const prevByList = { rfqs, pos, waybills, invoices };
    const table = PROC_TABLE_BY_LIST[listName];
    if (table) diffAndPush(table, prevByList[listName], newList);
    setFn(newList);
    // CRITICAL FIX: previously `next` was built from render-closure values
    // of rfqs/pos/waybills/invoices — captured ONCE per render. Two rapid
    // edits in the same tick (save a PO, then save an invoice) caused the
    // second save to dispatch a `next` whose `pos` was the pre-edit PO list,
    // silently reverting the first edit in the central store. Now we read
    // fresh values via functional setFn calls and use a ref to capture the
    // latest from the closure-free path.
    const next = {
      rfqs:      listName === 'rfqs'      ? newList : rfqs,
      pos:       listName === 'pos'       ? newList : pos,
      waybills:  listName === 'waybills'  ? newList : waybills,
      invoices:  listName === 'invoices'  ? newList : invoices,
    };
    dispatch({ type: 'UPDATE_MODULE', mod: 'procurement', data: next });
  }

  // ── UI state ─────────────────────────────────────────────────────────────
  // 2026-08-14: this module never read the deep-link sessionStorage key at
  // all (see getDeepLinkTab in utils/helpers.js — every other module that
  // supports deep links, e.g. Inventory/TerminalOps, calls it here). Dashboard
  // alert banners that claim "Click to open Procurement → Supplier Invoices
  // tab" (writeDeepLink('procurement','invoice')) were silently landing on
  // the hardcoded default 'po' tab instead. Wiring this in fixes both that
  // alert and the Dashboard "Supplier Invoices" KPI.
  const [tab,       setTab]       = useState(() => getDeepLinkTab('procurement', 'po'));
  const [poTypeFilter, setPoTypeFilter] = useState('Client'); // which PO type is shown in the PO tab
  const [search,    setSearch]    = useState('');
  const [modal,     setModal]     = useState(null);
  // Delete confirmation — added 2026-08-13, replacing window.confirm() (see
  // delRecord below). Native confirm() dialogs were the one thing in this
  // module that didn't match the rest of the app's styled modals.
  const [confirmDel, setConfirmDel] = useState(null);
  // modal types: rfq_view, rfq_create, po_view, po_create, wb_view, wb_create, inv_view, inv_create

  const S = useStyles();

  // ── Computed stats ────────────────────────────────────────────────────────
  // FIX 2026-08-13: this checked for status 'Pending', which no PO ever has —
  // the actual not-yet-approved status throughout this module is 'Draft'
  // (see the Status dropdown in POModal and getPOStatus() above). That typo
  // meant this counter was permanently stuck at 0, so the Dashboard's "N
  // purchase orders awaiting approval" banner sent staff to a screen whose
  // own card insisted nothing was pending. Now matches Dashboard.jsx's
  // (correct) pendingPOs calculation.
  const pendingPOs     = pos.filter(p => p.status === 'Draft').length;
  const activePOs      = pos.filter(p => ['Approved', 'Partial'].includes(getPOStatus(p, waybills, invoices))).length;
  const pendingInv     = invoices.filter(i => i.status === 'Pending').length;
  const totalPOValue   = pos.reduce((s, p) => s + (Number(p.total) || 0), 0);

  // ── Filtered lists ────────────────────────────────────────────────────────
  function filterList(list, fields) {
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(x => fields.some(f => String(x[f] || '').toLowerCase().includes(q)));
  }

  const filteredRFQs     = filterList(rfqs,     ['rfqNo', 'description', 'requestedBy', 'department', 'status']);
  const filteredPOs      = filterList(pos.filter(p => (p.poType || 'Client') === poTypeFilter), ['poNo', 'rfqNo', 'supplier', 'description', 'status']);
  const filteredWaybills = filterList(waybills, ['waybillNo', 'poNo', 'supplier', 'receivedBy', 'status']);
  const filteredInvoices = filterList(invoices, ['invoiceNo', 'poNo', 'supplier', 'supplierInvoiceNo', 'status']);

  // ── CRUD handlers ─────────────────────────────────────────────────────────
  function saveRFQ(form) {
    const isEdit = !!form.id;
    // Required-field guard — added 2026-08-13. QA found this saved with
    // Requested By, Department and the line item all left blank, producing
    // an RFQ that names no one and asks for nothing. The Requests module
    // already blocks equivalent blanks; this one never did.
    if (!(form.requestedBy || '').trim()) {
      showToast('Enter who this RFQ is requested by before saving.', 'error');
      return;
    }
    const record = { ...form, id: form.id || uid(), rfqNo: form.rfqNo || nextNo('RFQ', rfqs, 'rfqNo'), createdAt: form.createdAt || new Date().toISOString() };
    const next = isEdit ? rfqs.map(r => r.id === record.id ? record : r) : [...rfqs, record];
    save(setRfqs, 'rfqs', next);
    logActivity(dispatch, `${isEdit ? 'Updated' : 'Created'} RFQ ${record.rfqNo}`, currentUser,
      { module: 'procurement', action: isEdit ? 'edit' : 'create', recordId: record.id,
        before: isEdit ? rfqs.find(r => r.id === record.id) : null, after: record });
    showToast(isEdit ? 'RFQ updated' : 'RFQ created');
    setModal(null);
  }

  function savePO(form) {
    const isEdit = !!form.id;
    // Required-field guard — added 2026-08-13. QA found this saved with no
    // client/supplier name and no line items at all (₦0 total). Requests
    // already blocks equivalent blanks; PO never did.
    if (!(form.supplier || '').trim()) {
      showToast(`Enter a ${form.poType === 'SLOT' ? 'supplier' : 'client'} name before saving.`, 'error');
      return;
    }
    if (!(form.items || []).some(i => (i.description || '').trim() && (Number(i.qty) || 0) > 0)) {
      showToast('Add at least one line item with a description and quantity before saving.', 'error');
      return;
    }
    // Duplicate PO Number guard — added 2026-08-13. This field looks
    // auto-generated (placeholder says so) but is free text — staff use it
    // to enter the client's own PO reference. Nothing ever checked it
    // against numbers already in use: QA found 3 separate PO records sharing
    // the exact same number, with different totals and statuses, and no
    // warning at any point.
    const typedPoNo = (form.poNo || '').trim();
    if (typedPoNo) {
      const clash = pos.find(p => p.poNo === typedPoNo && p.id !== form.id);
      if (clash) {
        showToast(`PO number ${typedPoNo} is already used by another purchase order (${clash.supplier || 'no name'}). Enter a different number or leave it blank to auto-generate one.`, 'error');
        return;
      }
    }
    const items = form.items.map(i => ({ ...i, totalPrice: (Number(i.qty) || 0) * (Number(i.unitPrice) || 0) }));
    const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
    const vatAmount = Math.round(subtotal * (Number(form.vatRate) || 0) / 100);
    const record = { ...form, id: form.id || uid(), poNo: form.poNo || nextNo('PO', pos, 'poNo'), items, subtotal, vatAmount, total: subtotal + vatAmount, createdAt: form.createdAt || new Date().toISOString() };
    const next = isEdit ? pos.map(p => p.id === record.id ? record : p) : [...pos, record];
    // Mark linked RFQ as PO Issued
    if (record.rfqId) setRfqs(r => r.map(x => x.id === record.rfqId ? { ...x, status: 'PO Issued' } : x));
    save(setPos, 'pos', next);
    logActivity(dispatch, `${isEdit ? 'Updated' : 'Created'} ${record.poType === 'SLOT' ? 'SLOT' : 'Client'} PO ${record.poNo}${record.supplier ? ' — ' + record.supplier : ''}`, currentUser,
      { module: 'procurement', action: isEdit ? 'edit' : 'create', recordId: record.id,
        before: isEdit ? pos.find(p => p.id === record.id) : null, after: record });
    showToast(isEdit ? 'PO updated' : 'Purchase Order created');
    setModal(null);
  }

  function saveWaybill(form) {
    const isEdit = !!form.id;
    const record = { ...form, id: form.id || uid(), waybillNo: form.waybillNo || nextNo('WB', waybills, 'waybillNo'), createdAt: form.createdAt || new Date().toISOString() };
    const next = isEdit ? waybills.map(w => w.id === record.id ? record : w) : [...waybills, record];
    save(setWaybills, 'waybills', next);
    logActivity(dispatch, `${isEdit ? 'Updated' : 'Recorded'} waybill ${record.waybillNo}${record.poNo ? ' against PO ' + record.poNo : ''}`, currentUser,
      { module: 'procurement', action: isEdit ? 'edit' : 'create', recordId: record.id,
        before: isEdit ? waybills.find(w => w.id === record.id) : null, after: record });
    showToast(isEdit ? 'Waybill updated' : 'Waybill recorded');
    setModal(null);
  }

  // opts.print — SLOT's rule is that an invoice is never submitted without a
  // printed copy for the customer. The print has to happen HERE rather than in
  // the modal, because the invoice number is only assigned on save: printing
  // from the unsaved form would hand the customer a sheet with no number on it.
  function saveInvoice(form, opts = {}) {
    const isEdit = !!form.id;
    // Required-field guard — added 2026-08-13. QA found this saved with no
    // PO link and no line items at all (₦0, real system invoice number
    // consumed for a record with nothing in it).
    if (!(form.supplier || '').trim()) {
      showToast('Enter a supplier name before saving.', 'error');
      return;
    }
    if (!(form.items || []).some(i => (i.description || '').trim() && (Number(i.qty) || 0) > 0)) {
      showToast('This invoice has no delivered line items to bill. Link a PO with a waybill delivery before submitting.', 'error');
      return;
    }
    // Duplicate Invoice Number guard — added 2026-08-13, same issue as the PO
    // number field: looks auto-generated but is free text, and nothing
    // checked it against numbers already in use.
    const typedInvNo = (form.invoiceNo || '').trim();
    if (typedInvNo) {
      const clash = invoices.find(i => i.invoiceNo === typedInvNo && i.id !== form.id);
      if (clash) {
        showToast(`Invoice number ${typedInvNo} is already used by another invoice (${clash.supplier || 'no name'}). Enter a different number or leave it blank to auto-generate one.`, 'error');
        return;
      }
    }
    const record = { ...form, id: form.id || uid(), invoiceNo: form.invoiceNo || nextNo('SINV', invoices, 'invoiceNo'), createdAt: form.createdAt || new Date().toISOString() };
    const next = isEdit ? invoices.map(i => i.id === record.id ? record : i) : [...invoices, record];
    save(setInvoices, 'invoices', next);
    logActivity(dispatch, `${isEdit ? 'Updated' : 'Submitted'} invoice ${record.invoiceNo}${record.supplier ? ' — ' + record.supplier : ''}`, currentUser,
      { module: 'procurement', action: isEdit ? 'edit' : 'create', recordId: record.id,
        before: isEdit ? invoices.find(i => i.id === record.id) : null, after: record });
    if (opts.print) printInvoice(record);
    showToast(isEdit ? 'Invoice updated' : 'Invoice submitted');
    setModal(null);
  }

  // A deletion is the single most important thing this module can record, and
  // until 2026-08-05 it recorded nothing at all — no local entry, no server
  // row. When invoices went missing there was simply no way to establish who
  // had removed them. The log line now names the document, so the answer is
  // "SINV-2026-0004 deleted by <name>", not "something changed".
  const DOC_LABEL = { rfqs: 'RFQ', pos: 'purchase order', waybills: 'waybill', invoices: 'invoice' };
  const DOC_REF   = { rfqs: 'rfqNo', pos: 'poNo', waybills: 'waybillNo', invoices: 'invoiceNo' };

  // Split in two, 2026-08-13: delRecord used to call window.confirm()
  // synchronously and delete on the spot. That's the only native browser
  // dialog left in this module (every other confirmation is a styled
  // in-app modal) — replaced with the same Confirm component Inventory.jsx
  // already uses, so this now just stages the pending delete and the
  // Confirm modal rendered below calls doDelete() on Confirm Delete.
  function delRecord(list, setList, listName, id) {
    const rec = list.find(x => x.id === id);
    const label = DOC_LABEL[listName] || 'record';
    const ref   = rec?.[DOC_REF[listName]] || id;
    setConfirmDel({ list, setList, listName, id, label, ref });
  }
  function doDelete() {
    if (!confirmDel) return;
    const { list, setList, listName, id, label, ref } = confirmDel;
    save(setList, listName, list.filter(x => x.id !== id));
    logActivity(dispatch, `Deleted ${label} ${ref}`, currentUser,
      { module: 'procurement', action: 'delete', recordId: id });
    showToast(`Deleted ${label} ${ref}`, 'error');
    setConfirmDel(null);
  }

  // ── Row click handlers (drill-down) ───────────────────────────────────────
  function openPO(po) { setModal({ type: 'po_view', po }); }
  function openWB(wb) { setModal({ type: 'wb_view', wb }); }
  function openINV(inv) { setModal({ type: 'inv_view', inv }); }

  // ── Tab styles ────────────────────────────────────────────────────────────
  const tabBtn = (key) => ({
    padding: '10px 18px', fontSize: 13, background: 'none', border: 'none', cursor: 'pointer',
    color: tab === key ? C.green : C.textMuted,
    borderBottom: tab === key ? '2px solid ' + C.green : '2px solid transparent',
    fontWeight: tab === key ? 700 : 400, whiteSpace: 'nowrap', marginBottom: -2,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPI row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KPI label="Total RFQs"        value={rfqs.length}     accent={C.textMid} onClick={() => setTab("rfq")} />
        <KPI label="Active POs"         value={activePOs}       accent={C.green}   sub={pendingPOs + ' pending approval'} onClick={() => setTab("po")} />
        <KPI label="Total Waybills"     value={waybills.length} accent={C.info}    onClick={() => setTab("waybill")} />
        <KPI label="Pending Invoices"   value={pendingInv}      accent={C.amber}   sub={fmt(totalPOValue) + ' total PO value'} onClick={() => setTab("invoice")} />
      </div>

      {/* Card */}
      <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, boxShadow: C.shadowCard }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '2px solid ' + C.borderLight, padding: '0 20px', overflowX: 'auto' }}>
          {PROC_TABS.map(t => <button key={t.key} onClick={() => { setTab(t.key); setSearch(''); }} style={tabBtn(t.key)}>{t.label}</button>)}
        </div>

        {/* Toolbar */}
        <div style={{ padding: '14px 20px', display: 'flex', gap: 8 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={'Search ' + tab + '…'} style={{ ...S.inp, flex: 1 }} />
          {perms.add && tab === 'rfq'     && <Btn onClick={() => setModal({ type: 'rfq_create' })}>+ New RFQ</Btn>}
          {perms.add && tab === 'po'      && <Btn onClick={() => setModal({ type: 'po_create', poType: poTypeFilter })}>+ New {poTypeFilter} PO</Btn>}
          {perms.add && tab === 'waybill' && <Btn onClick={() => setModal({ type: 'wb_create' })}>+ New Waybill</Btn>}
          {/* 2026-08-15: removed the blank "+ New Invoice" button at Slot staff's
              request, so every invoice traces back to a real delivery. It opened
              InvoiceModal with no po/wb — an empty item table with no way to add
              a line (InvoiceModal has no addItem, unlike RFQ/PO/Waybill), and
              saveInvoice's own guard ("no delivered line items to bill... link a
              PO with a waybill delivery") blocked submission anyway. It was a
              dead end, not a real second path — invoices now only start from a
              PO's "+ Invoice" or a waybill's "Create Invoice →". */}
          {tab === 'invoice' && <div style={{ fontSize: 11.5, color: C.textMuted, alignSelf: 'center', marginLeft: 'auto' }}>Invoices are created from a Purchase Order or a Waybill delivery →</div>}
        </div>

        {/* Tables */}
        <div style={{ padding: '0 20px 20px', overflowX: 'auto' }}>

          {/* ── RFQ Table ──────────────────────────────────────────────────── */}
          {tab === 'rfq' && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
              <THead cols={['RFQ No', 'Date', 'Department', 'Requested By', 'Description', 'Items', 'Status', '']} />
              <tbody>
                {filteredRFQs.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: C.textMuted }}>No RFQs found</td></tr>}
                {filteredRFQs.map((r, i) => (
                  <tr key={r.id} onClick={() => setModal({ type: 'rfq_view', rfq: r })} style={{ background: i % 2 === 1 ? C.greenPale2 : 'transparent', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = C.greenPale} onMouseLeave={e => e.currentTarget.style.background = i % 2 === 1 ? C.greenPale2 : 'transparent'}>
                    <td style={{ ...S.td, color: C.green, fontFamily: 'monospace', fontWeight: 700 }}>{r.rfqNo}</td>
                    <td style={S.td}>{formatDate(r.date)}</td>
                    <td style={S.td}>{r.department}</td>
                    <td style={S.td}>{r.requestedBy}</td>
                    <td style={{ ...S.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                    <td style={{ ...S.td, textAlign: 'center' }}>{r.items?.length || 0}</td>
                    <td style={S.td}><Tag status={r.status} /></td>
                    <td style={S.td} onClick={e => e.stopPropagation()}>
                      {perms.del && <Btn variant="danger" sm onClick={() => delRecord(rfqs, setRfqs, 'rfqs', r.id)}>Del</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ── PO Table ───────────────────────────────────────────────────── */}
          {tab === 'po' && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {['Client', 'SLOT'].map(t => (
                  <button key={t} onClick={() => setPoTypeFilter(t)} style={{
                    padding: '7px 16px', borderRadius: 20, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                    border: '1px solid ' + (poTypeFilter === t ? C.green : C.borderLight),
                    background: poTypeFilter === t ? C.greenPale : 'transparent',
                    color: poTypeFilter === t ? C.green : C.textMuted,
                  }}>{t === 'Client' ? '🛒 Client Purchase Order' : '🏗 SLOT Purchase Order'} ({pos.filter(p => (p.poType||'Client')===t).length})</button>
                ))}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 750 }}>
                <THead cols={poTypeFilter === 'SLOT'
                  ? ['PO No', 'Supplier', 'PO Date', 'Expected Delivery', 'Actual Delivery', 'Total (₦)', 'Status', 'Waybill Ref', 'Invoice Ref', '']
                  : ['PO No', 'RFQ Ref', 'Client', 'PO Date', 'Expected Delivery', 'Actual Delivery', 'Total (₦)', 'Status', 'Waybills', 'Invoices', '']
                } />
                <tbody>
                  {filteredPOs.length === 0 && <tr><td colSpan={poTypeFilter === 'SLOT' ? 10 : 11} style={{ textAlign: 'center', padding: 32, color: C.textMuted }}>No {poTypeFilter.toLowerCase()} purchase orders found</td></tr>}
                  {filteredPOs.map((p, i) => {
                    const status = getPOStatus(p, waybills, invoices);
                    const wbs = waybills.filter(w => w.poId === p.id);
                    const invs = invoices.filter(v => v.poId === p.id);
                    const isSlot = (p.poType || 'Client') === 'SLOT';
                    return (
                      <tr key={p.id} onClick={() => openPO(p)} style={{ background: i % 2 === 1 ? C.greenPale2 : 'transparent', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = C.greenPale} onMouseLeave={e => e.currentTarget.style.background = i % 2 === 1 ? C.greenPale2 : 'transparent'}>
                        <td style={{ ...S.td, color: C.green, fontFamily: 'monospace', fontWeight: 700 }}>{p.poNo}</td>
                        {!isSlot && <td style={{ ...S.td, color: C.textMuted, fontSize: 11 }}>{p.rfqNo || '—'}</td>}
                        <td style={{ ...S.td, fontWeight: 500 }}>{p.supplier}</td>
                        <td style={S.td}>{formatDate(p.date)}</td>
                        <td style={S.td}>{p.deliveryDate ? formatDate(p.deliveryDate) : '—'}<DeliveryCountdown expected={p.deliveryDate} actual={p.actualDeliveryDate} /></td>
                        <td style={S.td}>{p.actualDeliveryDate ? formatDate(p.actualDeliveryDate) : '—'}</td>
                        <td style={{ ...S.td, fontWeight: 600, color: C.green }}>{fmt(p.total)}</td>
                        <td style={S.td}><Tag status={status} /></td>
                        {isSlot ? (
                          <>
                            <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{p.waybillRef || '—'}</td>
                            <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{p.invoiceRef || '—'}</td>
                          </>
                        ) : (
                          <>
                            {/* 2026-08-06 — these were LinkedBadge pills. They looked
                                like buttons but had no click handler, so a click fell
                                through to the row's onClick and opened the PO instead —
                                a control advertising an action it never performed.
                                Now plain counts: same information, nothing inviting a
                                click. The real drill-down is the Linked Documents
                                section inside the PO, where the chips do navigate. */}
                            <td style={{ ...S.td, textAlign: 'center', fontWeight: 600, color: wbs.length ? C.text : C.textMuted }}>{wbs.length}</td>
                            <td style={{ ...S.td, textAlign: 'center', fontWeight: 600, color: invs.length ? C.text : C.textMuted }}>{invs.length}</td>
                          </>
                        )}
                        <td style={S.td} onClick={e => e.stopPropagation()}>
                          <Btn variant="ghost" sm onClick={() => printPO(p)} title="Print this purchase order">🖨</Btn>
                          {perms.del && <Btn variant="danger" sm onClick={() => delRecord(pos, setPos, 'pos', p.id)}>Del</Btn>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {/* ── Waybill Table ──────────────────────────────────────────────── */}
          {tab === 'waybill' && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 750 }}>
              <THead cols={['Waybill No', 'PO Number', 'Supplier', 'Date', 'Received By', 'Total Delivered', 'Status', '']} />
              <tbody>
                {filteredWaybills.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: C.textMuted }}>No waybills found</td></tr>}
                {filteredWaybills.map((w, i) => {
                  const totalQty = w.items.reduce((s, i) => s + (Number(i.deliveredQty) || 0), 0);
                  const totalVal = w.items.reduce((s, i) => s + (Number(i.deliveredQty) || 0) * (Number(i.unitPrice) || 0), 0);
                  return (
                    <tr key={w.id} onClick={() => openWB(w)} style={{ background: i % 2 === 1 ? C.greenPale2 : 'transparent', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = C.greenPale} onMouseLeave={e => e.currentTarget.style.background = i % 2 === 1 ? C.greenPale2 : 'transparent'}>
                      <td style={{ ...S.td, color: C.info, fontFamily: 'monospace', fontWeight: 700 }}>{w.waybillNo}</td>
                      <td style={S.td}><LinkedBadge label={w.poNo} color={C.green} onClick={e => { e.stopPropagation(); const p = pos.find(x => x.id === w.poId); if (p) openPO(p); }} /></td>
                      <td style={S.td}>{w.supplier}</td>
                      <td style={S.td}>{formatDate(w.date)}</td>
                      <td style={S.td}>{w.receivedBy}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{totalQty} units · {fmt(totalVal)}</td>
                      <td style={S.td}><Tag status={w.status} /></td>
                      <td style={S.td} onClick={e => e.stopPropagation()}>
                        <Btn variant="ghost" sm onClick={() => printWaybill(w)} title="Print this waybill">🖨</Btn>
                        {perms.del && <Btn variant="danger" sm onClick={() => delRecord(waybills, setWaybills, 'waybills', w.id)}>Del</Btn>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* ── Invoice Table ──────────────────────────────────────────────── */}
          {tab === 'invoice' && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 750 }}>
              <THead cols={['Invoice No', 'Supplier Ref', 'PO Number', 'Waybill', 'Supplier', 'Subtotal', 'Net Payable', 'Due Date', 'Status', '']} />
              <tbody>
                {filteredInvoices.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', padding: 32, color: C.textMuted }}>No invoices found</td></tr>}
                {filteredInvoices.map((inv, i) => (
                  <tr key={inv.id} onClick={() => setModal({ type: 'inv_view', inv })} style={{ background: i % 2 === 1 ? C.amberPale : 'transparent', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = C.greenPale} onMouseLeave={e => e.currentTarget.style.background = i % 2 === 1 ? C.amberPale : 'transparent'}>
                    <td style={{ ...S.td, color: C.amber, fontFamily: 'monospace', fontWeight: 700 }}>{inv.invoiceNo}</td>
                    <td style={{ ...S.td, fontSize: 11, color: C.textMuted }}>{inv.supplierInvoiceNo || '—'}</td>
                    <td style={S.td}><LinkedBadge label={inv.poNo} color={C.green} onClick={e => { e.stopPropagation(); const p = pos.find(x => x.id === inv.poId); if (p) openPO(p); }} /></td>
                    <td style={S.td}>{inv.waybillNo ? <LinkedBadge label={inv.waybillNo} color={C.info} onClick={e => { e.stopPropagation(); const w = waybills.find(x => x.id === inv.waybillId); if (w) openWB(w); }} /> : '—'}</td>
                    <td style={S.td}>{inv.supplier}</td>
                    <td style={{ ...S.td, fontWeight: 500 }}>{fmt(inv.subtotal)}</td>
                    <td style={{ ...S.td, fontWeight: 700, color: C.green }}>{fmt(inv.netPayable)}</td>
                    <td style={{ ...S.td, color: new Date(inv.dueDate) < new Date() && inv.status !== 'Paid' ? C.danger : C.text }}>{formatDate(inv.dueDate)}</td>
                    <td style={S.td}><Tag status={inv.status} /></td>
                    <td style={S.td} onClick={e => e.stopPropagation()}>
                      <Btn variant="ghost" sm onClick={() => printInvoice(inv)} title="Print this invoice">🖨</Btn>
                      {perms.del && <Btn variant="danger" sm onClick={() => delRecord(invoices, setInvoices, 'invoices', inv.id)}>Del</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── MODALS ────────────────────────────────────────────────────────── */}
      {modal?.type === 'rfq_create' && (
        <RFQModal onSave={saveRFQ} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'rfq_view' && (
        <RFQModal rfq={modal.rfq} onSave={saveRFQ} onClose={() => setModal(null)}
          onCreatePO={rfq => setModal({ type: 'po_create', rfq, poType: 'Client' })} />
      )}
      {modal?.type === 'po_create' && (
        <POModal rfq={modal.rfq} poType={modal.poType} onSave={savePO} onClose={() => setModal(null)}
          waybills={waybills} invoices={invoices} currentUser={currentUser} appSettings={state.appSettings}
          onCreateWaybill={po => setModal({ type: 'wb_create', po })}
          onViewWaybill={openWB}
          onViewInvoice={openINV}
          onCreateInvoice={po => setModal({ type: 'inv_create', po })} />
      )}
      {modal?.type === 'po_view' && (
        <POModal po={modal.po} onSave={savePO} onClose={() => setModal(null)}
          waybills={waybills} invoices={invoices} currentUser={currentUser} appSettings={state.appSettings}
          onCreateWaybill={po => setModal({ type: 'wb_create', po })}
          onViewWaybill={openWB}
          onViewInvoice={openINV}
          onCreateInvoice={po => setModal({ type: 'inv_create', po })} />
      )}
      {modal?.type === 'wb_create' && (
        <WaybillModal po={modal.po} allWaybills={waybills} invoices={invoices} onSave={saveWaybill} onClose={() => setModal(null)}
          onCreateInvoice={wb => setModal({ type: 'inv_create', wb, po: pos.find(p => p.id === wb.poId) })} />
      )}
      {modal?.type === 'wb_view' && (
        <WaybillModal wb={modal.wb} po={pos.find(p => p.id === modal.wb.poId)} invoices={invoices}
          onSave={saveWaybill} onClose={() => setModal(null)}
          onCreateInvoice={wb => setModal({ type: 'inv_create', wb, po: pos.find(p => p.id === wb.poId) })} />
      )}
      {modal?.type === 'inv_create' && (
        <InvoiceModal po={modal.po} wb={modal.wb} allWaybills={waybills} invoices={invoices}
          onSave={saveInvoice} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'inv_view' && (
        <InvoiceModal inv={modal.inv} po={pos.find(p => p.id === modal.inv.poId)}
          wb={waybills.find(w => w.id === modal.inv.waybillId)}
          allWaybills={waybills} invoices={invoices}
          onSave={saveInvoice} onClose={() => setModal(null)} />
      )}
      {confirmDel && (
        <Confirm
          message={`Delete ${confirmDel.label} ${confirmDel.ref}? This is recorded in the activity log against your name.`}
          onConfirm={doDelete}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
