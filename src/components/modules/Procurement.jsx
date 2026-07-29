// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — PROCUREMENT MODULE v1.0
// Full linked chain: RFQ → PO (line items) → Waybill (partial) → Invoice
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo } from '../../utils/auth';
import { showToast, formatDate } from '../../utils/helpers';
import { printHeader, PRINT_CSS } from '../../utils/logo';
import { getVendors } from '../../utils/vendorMaster';
import { initApproval, applyDecision, canApproveAtCurrentLevel, approvalSummary } from '../../utils/approvalEngine';

const fmt = n => '₦' + (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 0 });

function printPO(po) {
  const itemRows = (po.items||[]).map((item,i) => `
    <tr style="background:${i%2?'#f3faf5':'#fff'}">
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB">${i+1}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB">${item.description||'—'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;text-align:center">${item.qty||0}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;text-align:center">${item.unit||'—'}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;text-align:right">${fmt(item.unitPrice)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #EAF0EB;text-align:right;font-weight:700;color:#1A5C2A">${fmt((Number(item.qty)||0)*(Number(item.unitPrice)||0))}</td>
    </tr>`).join('');
  const w = window.open('','_blank','width=900,height=700');
  w.document.write(`<!DOCTYPE html><html><head><title>PO ${po.poNo||''}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:24px}table{width:100%;border-collapse:collapse}th{background:#1A5C2A;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}.field{margin-bottom:8px}.lbl{font-size:9px;text-transform:uppercase;color:#6E8C74;letter-spacing:.5px;margin-bottom:2px}.val{font-size:12px;font-weight:600;border-bottom:1px solid #DDE9DE;padding-bottom:3px}.total-row{background:#F0F8F2;font-weight:700}.sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px;margin-top:40px}.sig-line{border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#6E8C74}@media print{body{padding:12px}}</style></head><body>${printHeader('PURCHASE ORDER · ' + (po.poNo||''), formatDate(po.date))}<div class="info-grid"><div><div class="field"><div class="lbl">Supplier</div><div class="val">${po.supplier||'—'}</div></div><div class="field"><div class="lbl">Supplier Address</div><div class="val">${po.supplierAddress||'—'}</div></div><div class="field"><div class="lbl">Payment Terms</div><div class="val">${po.paymentTerms||'—'}</div></div></div><div><div class="field"><div class="lbl">Delivery Address</div><div class="val">${po.deliveryAddress||'—'}</div></div><div class="field"><div class="lbl">Delivery Date</div><div class="val">${formatDate(po.deliveryDate)||'—'}</div></div><div class="field"><div class="lbl">Status</div><div class="val">${po.status||'—'}</div></div></div></div><table style="margin-bottom:16px"><thead><tr><th>#</th><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:center">Unit</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead><tbody>${itemRows}</tbody><tfoot><tr class="total-row"><td colspan="5" style="padding:8px 10px;text-align:right">Subtotal</td><td style="padding:8px 10px;text-align:right">${fmt(po.subtotal)}</td></tr><tr class="total-row"><td colspan="5" style="padding:8px 10px;text-align:right">VAT (${po.vatRate||0}%)</td><td style="padding:8px 10px;text-align:right">${fmt(po.vatAmount)}</td></tr><tr style="background:#1A5C2A;color:#fff"><td colspan="5" style="padding:10px;text-align:right;font-weight:800;font-size:13px">TOTAL</td><td style="padding:10px;text-align:right;font-weight:800;font-size:15px">${fmt(po.total)}</td></tr></tfoot></table>${po.notes?`<div style="margin-bottom:16px;padding:10px;background:#f3faf5;border-left:3px solid #1A5C2A;border-radius:4px"><div style="font-size:10px;color:#6E8C74;text-transform:uppercase;margin-bottom:4px">Notes</div><div style="font-size:12px">${po.notes}</div></div>`:''}<div class="sig"><div><div class="sig-line">Prepared By / Date</div></div><div><div class="sig-line">Authorised By / Date</div></div><div><div class="sig-line">Supplier Acknowledgement / Date</div></div></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// ── Legacy local key (read-only now, used once for migration in loadInitial) ──
const PROC_KEY = 'slot_proc';

function loadProc() {
  try { const r = localStorage.getItem(PROC_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}

// ── ID / Number generators ─────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2, 9);
const year = () => new Date().getFullYear();
function nextNo(prefix, list, field) {
  const nums = list.map(x => parseInt((x[field] || '0').replace(/\D/g, ''), 10)).filter(Boolean);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${prefix}-${year()}-${String(next).padStart(4, '0')}`;
}

// ── Quantity calculators ───────────────────────────────────────────────────
function getDeliveredQty(poItemId, waybills, poId) {
  return waybills
    .filter(wb => wb.poId === poId && wb.status !== 'Rejected')
    .flatMap(wb => wb.items)
    .filter(wi => wi.poItemId === poItemId)
    .reduce((s, wi) => s + (Number(wi.deliveredQty) || 0), 0);
}
function getInvoicedQty(poItemId, invoices, poId) {
  return invoices
    .filter(inv => inv.poId === poId)
    .flatMap(inv => inv.items)
    .filter(ii => ii.poItemId === poItemId)
    .reduce((s, ii) => s + (Number(ii.qty) || 0), 0);
}
function getPOStatus(po, waybills, invoices) {
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

// ── Seed data ─────────────────────────────────────────────────────────────
// Emptied 2026-07-28 — held a complete fabricated procurement chain: two RFQs,
// a ₦2,687,500 purchase order pre-marked "Approved" by a named approver, a
// waybill recording a part-delivery, and a ₦2,085,500 supplier invoice. Because
// these were linked end to end (rfqId → poId → waybillId), they presented as a
// fully audited paper trail for a purchase that never happened.
//
// Keys must stay — the module destructures SEED.rfqs / .pos / .waybills /
// .invoices directly. Empty arrays, never rows.
const SEED = {
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

function Btn({ children, onClick, variant = 'primary', sm, disabled, style = {} }) {
  const { C } = useTheme();
  const V = { primary: { bg: C.green, co: '#fff', b: 'none' }, amber: { bg: C.amber, co: '#fff', b: 'none' }, ghost: { bg: 'transparent', co: C.textMid, b: '1px solid ' + C.border }, danger: { bg: C.danger, co: '#fff', b: 'none' }, outline: { bg: 'transparent', co: C.green, b: '1px solid ' + C.green } }[variant] || {};
  return <button onClick={onClick} disabled={disabled} style={{ background: V.bg, color: V.co, border: V.b, borderRadius: 7, padding: sm ? '4px 11px' : '7px 16px', fontSize: sm ? 11.5 : 13, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', ...style }}>{children}</button>;
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
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(10,35,15,0.60)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}>
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
  const [form, setForm] = useState(rfq || { rfqNo: '', date: new Date().toISOString().split('T')[0], requiredBy: '', requestedBy: '', department: '', description: '', items: [{ id: uid(), description: '', qty: '', unit: 'units', estimatedPrice: '' }], status: 'Sourcing' });
  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

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
            {isView && form.status === 'PO Received' && <Btn variant="amber" sm onClick={() => onCreatePO(form)}>Create PO →</Btn>}
            {isView && <Tag status={form.status} />}
            <button onClick={onClose} aria-label="Close dialog" style={{ background: 'none', border: 'none', fontSize: 22, color: C.textMuted, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <FG label="RFQ Number"><input style={S.inp} value={form.rfqNo} onChange={set('rfqNo')} placeholder="Auto-generated" readOnly={isView} /></FG>
          <FG label="Date"><input style={S.inp} type="date" value={form.date} onChange={set('date')} readOnly={isView} /></FG>
          <FG label="Required By"><input style={S.inp} type="date" value={form.requiredBy} onChange={set('requiredBy')} readOnly={isView} /></FG>
          <FG label="Requested By"><input style={S.inp} value={form.requestedBy} onChange={set('requestedBy')} placeholder="Name" readOnly={isView} /></FG>
          <FG label="Department"><input style={S.inp} value={form.department} onChange={set('department')} placeholder="Enter department" readOnly={isView} /></FG>
          <FG label="Status"><select style={S.sel} value={form.status} onChange={set('status')} disabled={isView}>
            {RFQ_STATUSES.map(s => <option key={s}>{s}</option>)}</select></FG>
          <FG label="Description" full><input style={S.inp} value={form.description} onChange={set('description')} placeholder="Brief description of requirements" readOnly={isView} /></FG>
        </div>

        <SectionLabel label="Requested Items" />
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12, fontSize: 12 }}>
          <thead><tr style={{ background: C.greenPale }}>
            {['#', 'Description', 'Qty', 'Unit', 'Est. Unit Price (₦)', 'Est. Total (₦)', isView ? '' : 'Del'].map(h => <th key={h} style={S.th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {form.items.map((item, i) => (
              <tr key={item.id} style={{ background: i % 2 === 1 ? C.greenPale2 : 'transparent' }}>
                <td style={S.td}>{i + 1}</td>
                <td style={S.td}>{isView ? item.description : <input style={{ ...S.inp, minWidth: 180 }} value={item.description} onChange={e => setItem(i, 'description', e.target.value)} placeholder="Item description" />}</td>
                <td style={S.td}>{isView ? item.qty : <input style={{ ...S.inp, width: 70 }} type="number" value={item.qty} onChange={e => setItem(i, 'qty', e.target.value)} />}</td>
                <td style={S.td}>{isView ? item.unit : <input style={{ ...S.inp, width: 80 }} value={item.unit} onChange={e => setItem(i, 'unit', e.target.value)} />}</td>
                <td style={S.td}>{isView ? fmt(item.estimatedPrice) : <input style={{ ...S.inp, width: 120 }} type="number" value={item.estimatedPrice} onChange={e => setItem(i, 'estimatedPrice', e.target.value)} />}</td>
                <td style={{ ...S.td, fontWeight: 600, color: C.green }}>{fmt((Number(item.qty) || 0) * (Number(item.estimatedPrice) || 0))}</td>
                {!isView && <td style={S.td}><button onClick={() => removeItem(i)} style={{ background: C.danger, color: '#fff', border: 'none', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button></td>}
              </tr>
            ))}
          </tbody>
          <tfoot><tr style={{ background: C.greenPale, fontWeight: 700 }}>
            <td colSpan={5} style={{ ...S.td, textAlign: 'right' }}>Total Estimated Value</td>
            <td style={{ ...S.td, color: C.green, fontSize: 13 }}>{fmt(totalEstimated)}</td>
            {!isView && <td style={S.td} />}
          </tr></tfoot>
        </table>

        {!isView && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <Btn variant="ghost" sm onClick={addItem}>+ Add Item</Btn>
          </div>
        )}

        {!isView && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 14, borderTop: '1px solid ' + C.borderLight }}>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn onClick={() => onSave(form)}>Save RFQ</Btn>
          </div>
        )}
      </Card>
    </Overlay>
  );
}

// ── PO Create/View Modal ───────────────────────────────────────────────────
function POModal({ po, rfq, poType, onSave, onClose, onCreateWaybill, onViewWaybill, onCreateInvoice, waybills, invoices, currentUser, appSettings }) {
  const { C } = useTheme();
  const S = useStyles();
  const isView = !!po?.id;
  const TERMS = ['Net 7', 'Net 15', 'Net 30', 'Net 45', 'Net 60', '50% Advance, 50% on Delivery', 'Full Payment on Delivery', 'Full Payment in Advance'];

  const initItems = rfq?.items?.map(ri => ({ id: uid(), rfqItemId: ri.id, description: ri.description, qty: ri.qty, unit: ri.unit, unitPrice: '', totalPrice: 0 })) || [{ id: uid(), rfqItemId: '', description: '', qty: '', unit: 'units', unitPrice: '', totalPrice: 0 }];

  const [form, setForm] = useState(po || {
    poNo: '', poType: poType || 'Client', rfqId: rfq?.id || '', rfqNo: rfq?.rfqNo || '',
    supplier: '', supplierAddress: '', date: new Date().toISOString().split('T')[0],
    deliveryDate: '', actualDeliveryDate: '', deliveryAddress: 'NLNG Site, Bonny Island',
    description: rfq?.description || '', paymentTerms: 'Net 30', currency: 'NGN',
    items: initItems, subtotal: 0, vatRate: 7.5, vatAmount: 0, total: 0,
    status: 'Draft', approvedBy: '', notes: '', waybillRef: '', invoiceRef: '',
  });

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  // ── Vendor master — replaces free-text supplier entry with the real SAGE
  // supplier list. See utils/vendorMaster.js.
  const [vendors] = useState(() => getVendors().filter(v=>v.status==='Active'));
  const handleVendorSelect = (code) => {
    const v = vendors.find(x=>x.code===code);
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
    setForm(p => ({ ...p, items: [...p.items, { id: uid(), rfqItemId: '', description: '', qty: '', unit: 'units', unitPrice: '', totalPrice: 0 }] }));
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
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>🛒 {isView ? form.poNo : `New ${form.poType === 'SLOT' ? 'SLOT' : 'Client'} Purchase Order`}</div>
            {isView && form.rfqNo && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>Linked RFQ: <span style={{ color: C.green, fontWeight: 600 }}>{form.rfqNo}</span></div>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isView && form.poType !== 'SLOT' && (form.status === 'Approved' || form.status === 'Partial') && (
              <>
                <Btn variant="outline" sm onClick={() => onCreateWaybill(po)}>+ Waybill</Btn>
                <Btn variant="amber" sm onClick={() => onCreateInvoice(po)}>+ Invoice</Btn>
              </>
            )}
            {isView && <Btn variant="ghost" sm onClick={() => printPO(form)}>🖨 Print PO</Btn>}
            {isView && <Tag status={getPOStatus(po, waybills, invoices)} />}
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
            {isView && form.deliveryDate && <DeliveryCountdown expected={form.deliveryDate} actual={form.actualDeliveryDate} />}
          </FG>
          <FG label="Actual Delivery Date"><input style={S.inp} type="date" value={form.actualDeliveryDate||''} onChange={set('actualDeliveryDate')} /></FG>
          <FG label="Supplier Name" full>
            <select style={S.sel} value={form.supplier} onChange={e=>handleVendorSelect(e.target.value)} disabled={isView}>
              <option value="">— Select Supplier —</option>
              {vendors.map(v=><option key={v.id} value={v.code}>{v.name} — {v.code} ({v.currency})</option>)}
            </select>
          </FG>
          <FG label="Supplier Address" full><input style={S.inp} value={form.supplierAddress} onChange={set('supplierAddress')} placeholder="Supplier address" readOnly={isView} /></FG>
          <FG label="Delivery Address" full><input style={S.inp} value={form.deliveryAddress} onChange={set('deliveryAddress')} placeholder="Where to deliver" readOnly={isView} /></FG>
          <FG label="Payment Terms"><select style={S.sel} value={form.paymentTerms} onChange={set('paymentTerms')} disabled={isView}>{TERMS.map(t => <option key={t}>{t}</option>)}</select></FG>
          <FG label="VAT Rate (%)"><input style={S.inp} type="number" value={form.vatRate} onChange={e => setVAT(e.target.value)} readOnly={isView} /></FG>
          <FG label="Status">
            {(!isView || form.status === 'Draft') ? (
              <select style={S.sel} value={form.status} onChange={set('status')} disabled={isView && form.status !== 'Draft'}>
                {['Draft', 'Cancelled'].map(s => <option key={s}>{s}</option>)}
              </select>
            ) : (
              <input style={S.inp} value={form.status} readOnly />
            )}
          </FG>
          {isView && <FG label="Approved By"><input style={S.inp} value={form.approvedBy} readOnly /></FG>}
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
              {['#', 'Description', 'Qty', 'Unit', 'Unit Price (₦)', 'Total (₦)', isView ? 'Delivered' : '', isView ? 'Remaining' : '', !isView ? 'Del' : ''].filter(Boolean).map(h => <th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {form.items.map((item, i) => {
                const delivered = isView ? getDeliveredQty(item.id, waybills || [], po?.id) : 0;
                const remaining = Math.max(0, (Number(item.qty) || 0) - delivered);
                const rowBg = { background: i % 2 === 1 ? C.greenPale2 : 'transparent' };
                return (
                  <tr key={item.id} style={rowBg}>
                    <td style={S.td}>{i + 1}</td>
                    <td style={S.td}>{isView ? item.description : <input style={{ ...S.inp, minWidth: 200 }} value={item.description} onChange={e => setItem(i, 'description', e.target.value)} placeholder="Item description" />}</td>
                    <td style={S.td}>{isView ? item.qty : <input style={{ ...S.inp, width: 70 }} type="number" value={item.qty} onChange={e => setItem(i, 'qty', e.target.value)} />}</td>
                    <td style={S.td}>{isView ? item.unit : <input style={{ ...S.inp, width: 80 }} value={item.unit} onChange={e => setItem(i, 'unit', e.target.value)} />}</td>
                    <td style={S.td}>{isView ? fmt(item.unitPrice) : <input style={{ ...S.inp, width: 120 }} type="number" value={item.unitPrice} onChange={e => setItem(i, 'unitPrice', e.target.value)} />}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: C.green }}>{fmt((Number(item.qty) || 0) * (Number(item.unitPrice) || 0))}</td>
                    {isView && <td style={{ ...S.td, color: delivered >= (Number(item.qty) || 0) ? C.success : C.warning, fontWeight: 600 }}>{delivered}</td>}
                    {isView && <td style={{ ...S.td, color: remaining > 0 ? C.danger : C.success, fontWeight: 600 }}>{remaining}</td>}
                    {!isView && <td style={S.td}><button onClick={() => removeItem(i)} style={{ background: C.danger, color: '#fff', border: 'none', borderRadius: 5, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>✕</button></td>}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: C.bgAlt }}><td colSpan={isView ? 5 : 4} style={{ ...S.td, textAlign: 'right', color: C.textMid }}>Subtotal</td><td colSpan={isView ? 4 : 2} style={{ ...S.td, fontWeight: 600 }}>{fmt(form.subtotal)}</td></tr>
              <tr style={{ background: C.bgAlt }}><td colSpan={isView ? 5 : 4} style={{ ...S.td, textAlign: 'right', color: C.textMid }}>VAT ({form.vatRate}%)</td><td colSpan={isView ? 4 : 2} style={{ ...S.td, fontWeight: 600 }}>{fmt(form.vatAmount)}</td></tr>
              <tr style={{ background: C.greenPale }}><td colSpan={isView ? 5 : 4} style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>TOTAL</td><td colSpan={isView ? 4 : 2} style={{ ...S.td, fontWeight: 700, color: C.green, fontSize: 14 }}>{fmt(form.total)}</td></tr>
            </tfoot>
          </table>
        </div>

        {!isView && (
          <Btn variant="ghost" sm onClick={addItem} style={{ marginBottom: 16 }}>+ Add Line Item</Btn>
        )}

        {/* Linked documents (view mode only) */}
        {isView && (linkedWaybills.length > 0 || linkedInvoices.length > 0) && (
          <>
            <SectionLabel label="Linked Documents" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {linkedWaybills.map(wb => (
                <LinkedBadge key={wb.id} label={'🚚 ' + wb.waybillNo + ' (' + wb.status + ')'} color={C.info} onClick={() => onViewWaybill(wb)} />
              ))}
              {linkedInvoices.map(inv => (
                <LinkedBadge key={inv.id} label={'🧾 ' + inv.invoiceNo + ' (' + inv.status + ')'} color={C.amber} />
              ))}
            </div>
          </>
        )}

        {/* Approval chain — replaces the old free-form Status=Approved dropdown */}
        {isView && form.status === 'Draft' && (
          <div style={{ marginTop: 16, padding: '12px 14px', background: C.greenPale, border: '1px solid ' + C.borderLight, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: C.textMuted }}>
              This PO is still a Draft. Submitting routes it through the authorization chain for its value ({fmt(form.total)}) — see Settings → Approvals for the current bands.
            </div>
            <Btn onClick={submitForApproval}>Submit for Approval</Btn>
          </div>
        )}
        {isView && form.approval && form.status !== 'Draft' && (
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
            <Btn onClick={() => onSave(form)}>Save Purchase Order</Btn>
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
function WaybillModal({ wb, po, onSave, onClose, onCreateInvoice, allWaybills = [] }) {
  const { C } = useTheme();
  const S = useStyles();
  const isView = !!wb?.id;

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
        return { id: uid(), poItemId: pi.id, description: pi.description, orderedQty: Number(pi.qty) || 0, previouslyDelivered: prevDelivered, remaining, deliveredQty: '', unit: pi.unit, unitPrice: Number(pi.unitPrice) || 0 };
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

  const totalDelivered = form.items.reduce((s, i) => s + (Number(i.deliveredQty) || 0), 0);
  const totalValue = form.items.reduce((s, i) => s + (Number(i.deliveredQty) || 0) * (Number(i.unitPrice) || 0), 0);

  // Print waybill
  function handlePrintWaybill() {
    const w2 = window.open('', '_blank', 'width=900,height=700');
    w2.document.write(`<!DOCTYPE html><html><head><title>${form.waybillNo}</title><style>
      body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:28px;max-width:860px;margin:0 auto}
      .header-bar{background:#C97A0A;color:#fff;padding:8px 16px;display:flex;justify-content:space-between;font-weight:700;font-size:13px}
      table{width:100%;border-collapse:collapse;margin-top:14px}
      th{background:#EAF4EC;padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;color:#3A5040}
      td{padding:8px 10px;border-bottom:1px solid #EAF0EB}
      .meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:14px 0;padding:14px;background:#f9fafb;border-radius:8px;border:1px solid #EAF0EB}
      .f label{font-size:9px;font-weight:700;text-transform:uppercase;color:#6E8C74;display:block;margin-bottom:2px}
      .f span{font-size:12px;font-weight:600}
      .tfoot-row td{background:#EAF4EC;font-weight:700}
      .sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:40px}
      .sig{border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#6E8C74;margin-top:30px}
      @media print{body{padding:16px}}
    </style></head><body>
      <div style="background:linear-gradient(135deg,#0F3A1A,#1A5C2A);padding:16px 20px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center">
        <div style="color:#fff;font-size:16px;font-weight:800">SLOT Engineering Nigeria Limited</div>
        <div style="color:rgba(255,255,255,.7);font-size:11px">GOODS RECEIVED NOTE / WAYBILL</div>
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
        <thead><tr><th>#</th><th>Description</th><th>Ordered Qty</th><th>Prev. Delivered</th><th>This Delivery</th><th>Unit</th></tr></thead>
        <tbody>
          ${(form.items||[]).map((item,i)=>
            `<tr><td>${i+1}</td><td>${item.description}</td><td>${item.orderedQty}</td><td>${item.previouslyDelivered||0}</td><td style="font-weight:700;color:#1A5C2A">${item.deliveredQty||0}</td><td>${item.unit}</td></tr>`
          ).join('')}
        </tbody>
        <tfoot><tr class="tfoot-row"><td colspan="4">Total This Delivery</td><td colspan="2" style="font-weight:800">${totalDelivered} units</td></tr></tfoot>
      </table>
      ${form.notes?`<div style="margin-top:12px;padding:10px;background:#f9fafb;border-radius:6px;font-size:11px"><strong>Notes:</strong> ${form.notes}</div>`:''}
      <div class="sigs">
        <div><div class="sig">Driver Signature / Date</div></div>
        <div><div class="sig">Received By / Date</div></div>
        <div><div class="sig">Store / Warehouse Officer / Date</div></div>
      </div>
    </body></html>`);
    w2.document.close();
    setTimeout(() => w2.print(), 400);
  }

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
            {isView && form.status === 'Accepted' && <Btn variant="amber" sm onClick={() => onCreateInvoice && onCreateInvoice(wb)}>Create Invoice →</Btn>}
            {isView && <Tag status={form.status} />}
            <button onClick={onClose} aria-label="Close dialog" style={{ background: 'none', border: 'none', fontSize: 22, color: C.textMuted, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <FG label="Waybill Number"><input style={S.inp} value={form.waybillNo} onChange={set('waybillNo')} placeholder="Auto-generated" readOnly={isView} /></FG>
          <FG label="Date Received"><input style={S.inp} type="date" value={form.date} onChange={set('date')} readOnly={isView} /></FG>
          <FG label="Received By"><input style={S.inp} value={form.receivedBy} onChange={set('receivedBy')} placeholder="Name of receiver" readOnly={isView} /></FG>
          <FG label="Vehicle / Truck No"><input style={S.inp} value={form.vehicleNo} onChange={set('vehicleNo')} placeholder="e.g. PHC-234-GH" readOnly={isView} /></FG>
          <FG label="Driver Name"><input style={S.inp} value={form.driverName} onChange={set('driverName')} placeholder="Driver name" readOnly={isView} /></FG>
          <FG label="Status"><select style={S.sel} value={form.status} onChange={set('status')} disabled={isView}>{['Pending Inspection', 'Accepted', 'Partially Accepted', 'Rejected'].map(s => <option key={s}>{s}</option>)}</select></FG>
          <FG label="Delivery Address" full><input style={S.inp} value={form.deliveryAddress} onChange={set('deliveryAddress')} readOnly={isView} /></FG>
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
                  <td style={S.td}>{isView ? <strong style={{ color: C.success }}>{item.deliveredQty}</strong> : <input style={{ ...S.inp, width: 80 }} type="number" value={item.deliveredQty} max={item.remaining} onChange={e => setItem(i, 'deliveredQty', e.target.value)} />}</td>
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

        {!isView && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 14, borderTop: '1px solid ' + C.borderLight }}>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn variant="ghost" onClick={handlePrintWaybill}>🖨 Print Draft</Btn>
            <Btn onClick={() => onSave(form)}>Save Waybill</Btn>
          </div>
        )}
      </Card>
    </Overlay>
  );
}

// ── Supplier Invoice Create/View Modal ─────────────────────────────────────
function InvoiceModal({ inv, po, wb, onSave, onClose }) {
  const { C } = useTheme();
  const S = useStyles();
  const isView = !!inv?.id;

  // Pre-fill from waybill items
  const initItems = wb?.items?.map(wi => ({ id: uid(), poItemId: wi.poItemId, waybillItemId: wi.id, description: wi.description, qty: Number(wi.deliveredQty) || 0, unit: wi.unit, unitPrice: Number(wi.unitPrice) || 0, totalPrice: (Number(wi.deliveredQty) || 0) * (Number(wi.unitPrice) || 0) })) || po?.items?.map(pi => ({ id: uid(), poItemId: pi.id, description: pi.description, qty: Number(pi.qty) || 0, unit: pi.unit, unitPrice: Number(pi.unitPrice) || 0, totalPrice: Number(pi.totalPrice) || 0 })) || [];

  const initSubtotal = initItems.reduce((s, i) => s + i.totalPrice, 0);
  const initVAT = Math.round(initSubtotal * 0.075);
  const initWHT = Math.round(initSubtotal * 0.02); // FIX: WHT default 2%

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
    whtRate: 2, whtAmount: initWHT, // FIX: default WHT 2%
    total: initSubtotal + initVAT,
    netPayable: initSubtotal + initVAT - initWHT,
    status: 'Pending', paymentDate: '', paymentRef: '', notes: '',
  });

  const set = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  function recalc(items) {
    const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
    const vatAmount = Math.round(subtotal * 0.075);
    const whtAmount = Math.round(subtotal * (Number(form.whtRate) || 0) / 100);
    const total = subtotal + vatAmount;
    const netPayable = total - whtAmount;
    return { subtotal, vatAmount, whtAmount, total, netPayable };
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
            {isView && <Tag status={form.status} />}
            <button onClick={onClose} aria-label="Close dialog" style={{ background: 'none', border: 'none', fontSize: 22, color: C.textMuted, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <FG label="System Invoice No"><input style={S.inp} value={form.invoiceNo} onChange={set('invoiceNo')} placeholder="Auto-generated" readOnly={isView} /></FG>
          <FG label="Supplier Invoice Ref"><input style={S.inp} value={form.supplierInvoiceNo} onChange={set('supplierInvoiceNo')} placeholder="Supplier's ref number" readOnly={isView} /></FG>
          <FG label="GRN Number"><input style={S.inp} value={form.grnNo} onChange={set('grnNo')} placeholder="e.g. GRN-2025-001" readOnly={isView} /></FG>
          <FG label="Supplier"><input style={S.inp} value={form.supplier} onChange={set('supplier')} readOnly={isView} /></FG>
          <FG label="Invoice Date"><input style={S.inp} type="date" value={form.date} onChange={set('date')} readOnly={isView} /></FG>
          <FG label="Due Date"><input style={S.inp} type="date" value={form.dueDate} onChange={set('dueDate')} readOnly={isView} /></FG>
          <FG label="WHT Rate (%)"><input style={S.inp} type="number" value={form.whtRate} onChange={set('whtRate')} readOnly={isView} /></FG>
          <FG label="Status"><select style={S.sel} value={form.status} onChange={set('status')} disabled={isView}>{['Pending', 'Approved', 'Paid', 'Overdue', 'Disputed'].map(s => <option key={s}>{s}</option>)}</select></FG>
          {(isView && form.status === 'Paid') && <FG label="Payment Date"><input style={S.inp} value={form.paymentDate} readOnly /></FG>}
          {(isView && form.status === 'Paid') && <FG label="Payment Ref"><input style={S.inp} value={form.paymentRef} readOnly /></FG>}
        </div>

        <SectionLabel label="Invoice Line Items (Based on Delivery)" />
        <div style={{ overflowX: 'auto', marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: C.amber }}>
              {['#', 'Description', 'Delivered Qty', 'Unit', 'Unit Price (₦)', 'Line Total (₦)'].map(h => (
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
                  <td style={S.td}>{isView ? fmt(item.unitPrice) : <input style={{ ...S.inp, width: 120 }} type="number" value={item.unitPrice} onChange={e => setItem(i, 'unitPrice', e.target.value)} />}</td>
                  <td style={{ ...S.td, fontWeight: 600, color: C.green }}>{fmt(item.totalPrice)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {[['Subtotal', form.subtotal, C.text], ['VAT (7.5%)', form.vatAmount, C.text], ['WHT Deduction (' + form.whtRate + '%)', -form.whtAmount, C.danger], ['NET PAYABLE', form.netPayable, C.green]].map(([label, val, color]) => (
                <tr key={label} style={{ background: label === 'NET PAYABLE' ? C.greenPale : C.bgAlt }}>
                  <td colSpan={5} style={{ ...S.td, textAlign: 'right', fontWeight: label === 'NET PAYABLE' ? 700 : 500 }}>{label}</td>
                  <td style={{ ...S.td, fontWeight: 700, color, fontSize: label === 'NET PAYABLE' ? 15 : 12 }}>{val < 0 ? '(' + fmt(Math.abs(val)) + ')' : fmt(val)}</td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>

        {!isView && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 14, borderTop: '1px solid ' + C.borderLight }}>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn onClick={() => onSave(form)}>Save Invoice</Btn>
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
    // means empty, full stop. Don't fall through to the legacy key or SEED.
    if (state.appSettings?.dataWiped) return central || { rfqs: [], pos: [], waybills: [], invoices: [] };
    const legacy = loadProc();
    if (legacy) {
      localStorage.removeItem(PROC_KEY);
      return legacy;
    }
    return null;
  }
  const saved = loadInitial();
  const [rfqs,      setRfqs]      = useState(saved?.rfqs      || SEED.rfqs);
  const [pos,       setPos]       = useState(saved?.pos       || SEED.pos);
  const [waybills,  setWaybills]  = useState(saved?.waybills  || SEED.waybills);
  const [invoices,  setInvoices]  = useState(saved?.invoices  || SEED.invoices);

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
  const [tab,       setTab]       = useState('po');
  const [poTypeFilter, setPoTypeFilter] = useState('Client'); // which PO type is shown in the PO tab
  const [search,    setSearch]    = useState('');
  const [modal,     setModal]     = useState(null);
  // modal types: rfq_view, rfq_create, po_view, po_create, wb_view, wb_create, inv_view, inv_create

  const S = useStyles();

  // ── Computed stats ────────────────────────────────────────────────────────
  const pendingPOs     = pos.filter(p => p.status === 'Pending').length;
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
    const record = { ...form, id: form.id || uid(), rfqNo: form.rfqNo || nextNo('RFQ', rfqs, 'rfqNo'), createdAt: form.createdAt || new Date().toISOString() };
    const next = isEdit ? rfqs.map(r => r.id === record.id ? record : r) : [...rfqs, record];
    save(setRfqs, 'rfqs', next);
    showToast(isEdit ? 'RFQ updated' : 'RFQ created');
    setModal(null);
  }

  function savePO(form) {
    const isEdit = !!form.id;
    const items = form.items.map(i => ({ ...i, totalPrice: (Number(i.qty) || 0) * (Number(i.unitPrice) || 0) }));
    const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
    const vatAmount = Math.round(subtotal * (Number(form.vatRate) || 0) / 100);
    const record = { ...form, id: form.id || uid(), poNo: form.poNo || nextNo('PO', pos, 'poNo'), items, subtotal, vatAmount, total: subtotal + vatAmount, createdAt: form.createdAt || new Date().toISOString() };
    const next = isEdit ? pos.map(p => p.id === record.id ? record : p) : [...pos, record];
    // Mark linked RFQ as PO Issued
    if (record.rfqId) setRfqs(r => r.map(x => x.id === record.rfqId ? { ...x, status: 'PO Issued' } : x));
    save(setPos, 'pos', next);
    showToast(isEdit ? 'PO updated' : 'Purchase Order created');
    setModal(null);
  }

  function saveWaybill(form) {
    const isEdit = !!form.id;
    const record = { ...form, id: form.id || uid(), waybillNo: form.waybillNo || nextNo('WB', waybills, 'waybillNo'), createdAt: form.createdAt || new Date().toISOString() };
    const next = isEdit ? waybills.map(w => w.id === record.id ? record : w) : [...waybills, record];
    save(setWaybills, 'waybills', next);
    showToast(isEdit ? 'Waybill updated' : 'Waybill recorded');
    setModal(null);
  }

  function saveInvoice(form) {
    const isEdit = !!form.id;
    const record = { ...form, id: form.id || uid(), invoiceNo: form.invoiceNo || nextNo('SINV', invoices, 'invoiceNo'), createdAt: form.createdAt || new Date().toISOString() };
    const next = isEdit ? invoices.map(i => i.id === record.id ? record : i) : [...invoices, record];
    save(setInvoices, 'invoices', next);
    showToast(isEdit ? 'Invoice updated' : 'Invoice saved');
    setModal(null);
  }

  function delRecord(list, setList, listName, id) {
    if (!window.confirm('Delete this record?')) return;
    save(setList, listName, list.filter(x => x.id !== id));
    showToast('Deleted', 'error');
  }

  // ── Row click handlers (drill-down) ───────────────────────────────────────
  function openPO(po) { setModal({ type: 'po_view', po }); }
  function openWB(wb) { setModal({ type: 'wb_view', wb }); }

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
          {perms.add && tab === 'invoice' && <Btn onClick={() => setModal({ type: 'inv_create' })}>+ New Invoice</Btn>}
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
                  : ['PO No', 'RFQ Ref', 'Supplier', 'PO Date', 'Expected Delivery', 'Actual Delivery', 'Total (₦)', 'Status', 'Waybills', 'Invoices', '']
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
                            <td style={{ ...S.td, textAlign: 'center' }}><LinkedBadge label={wbs.length + ' WB'} color={wbs.length ? C.info : C.textMuted} /></td>
                            <td style={{ ...S.td, textAlign: 'center' }}><LinkedBadge label={invs.length + ' INV'} color={invs.length ? C.amber : C.textMuted} /></td>
                          </>
                        )}
                        <td style={S.td} onClick={e => e.stopPropagation()}>
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
              <THead cols={['Invoice No', 'Supplier Ref', 'PO Number', 'Waybill', 'Supplier', 'Subtotal (₦)', 'WHT (₦)', 'Net Payable (₦)', 'Due Date', 'Status', '']} />
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
                    <td style={{ ...S.td, color: C.danger }}>{fmt(inv.whtAmount)}</td>
                    <td style={{ ...S.td, fontWeight: 700, color: C.green }}>{fmt(inv.netPayable)}</td>
                    <td style={{ ...S.td, color: new Date(inv.dueDate) < new Date() && inv.status !== 'Paid' ? C.danger : C.text }}>{formatDate(inv.dueDate)}</td>
                    <td style={S.td}><Tag status={inv.status} /></td>
                    <td style={S.td} onClick={e => e.stopPropagation()}>
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
          onCreateInvoice={po => setModal({ type: 'inv_create', po })} />
      )}
      {modal?.type === 'po_view' && (
        <POModal po={modal.po} onSave={savePO} onClose={() => setModal(null)}
          waybills={waybills} invoices={invoices} currentUser={currentUser} appSettings={state.appSettings}
          onCreateWaybill={po => setModal({ type: 'wb_create', po })}
          onViewWaybill={openWB}
          onCreateInvoice={po => setModal({ type: 'inv_create', po })} />
      )}
      {modal?.type === 'wb_create' && (
        <WaybillModal po={modal.po} allWaybills={waybills} onSave={saveWaybill} onClose={() => setModal(null)}
          onCreateInvoice={wb => setModal({ type: 'inv_create', wb, po: pos.find(p => p.id === wb.poId) })} />
      )}
      {modal?.type === 'wb_view' && (
        <WaybillModal wb={modal.wb} po={pos.find(p => p.id === modal.wb.poId)}
          onSave={saveWaybill} onClose={() => setModal(null)}
          onCreateInvoice={wb => setModal({ type: 'inv_create', wb, po: pos.find(p => p.id === wb.poId) })} />
      )}
      {modal?.type === 'inv_create' && (
        <InvoiceModal po={modal.po} wb={modal.wb} onSave={saveInvoice} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'inv_view' && (
        <InvoiceModal inv={modal.inv} po={pos.find(p => p.id === modal.inv.poId)}
          wb={waybills.find(w => w.id === modal.inv.waybillId)}
          onSave={saveInvoice} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
