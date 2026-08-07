// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — ACCOUNTS RECEIVABLE MODULE v2.0
// Customer invoices (multi-currency) · receipt vouchers (WHT/NCDF pre-deduction)
// · aging · analysis. Supersedes the original Invoices.jsx — same underlying
// `db.invoices` array (so existing seed data, Topbar search, Sidebar approval
// badge, and Analytics.jsx all keep working unchanged), with the gaps the
// accountant flagged now filled in: a visible "Accounts Receivable" module,
// real multi-currency invoicing, and proper receipt vouchers instead of a
// single "mark as Paid" click.
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo, Fragment } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo }    from '../../utils/auth';
import { showToast, formatDate, generateId } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { SLOT_LOGO_SRC, printHeader, printBootstrap, openPrintWindow} from '../../utils/logo';
import { diffAndPush } from '../../hooks/usePerRecordSync';
import { getClients, getClientByCode, addClient } from '../../utils/clientMaster';
import { getProjects } from '../../utils/projectMaster';
import { BANK_ACCOUNTS, DEFAULT_FX } from '../../utils/financeConstants';
import { AttachmentUploader } from '../ui';

const uid = () => generateId();
const today = () => new Date().toISOString().split('T')[0];
const year  = () => new Date().getFullYear();

const SYM = { NGN:'₦', USD:'$', EUR:'€', GBP:'£' };
const fmt = (n, cur = 'NGN') =>
  (SYM[cur] || cur + ' ') + (Number(n)||0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function nextInvNo(list) {
  const nums = list.map(x => parseInt((x.invoiceNo||'0').replace(/\D/g,''),10)).filter(Boolean);
  return `SLOT-INV-${year()}-${String(nums.length ? Math.max(...nums)+1 : 1).padStart(4,'0')}`;
}
function nextReceiptNo(list) {
  const nums = list.map(x => parseInt((x.receiptNo||'0').replace(/\D/g,''),10)).filter(Boolean);
  return `SLOT-ARV-${year()}-${String(nums.length ? Math.max(...nums)+1 : 1).padStart(4,'0')}`;
}

const PAYMENT_TERMS = ['Net 7','Net 14','Net 30','Net 45','Net 60','50% Advance, 50% on Delivery','100% Advance','Due on Receipt'];
const CATEGORIES    = ['Engineering Services','Procurement Services','Logistics','Consultancy','Maintenance','Project Management','Equipment Supply','Labour Supply','Other'];
const VAT_RATE      = 7.5;

// 2026-07-29 — seed fallback removed permanently (was already emptied
// 2026-07-28, having held four fabricated sales invoices ~₦36m naming real
// customers, plus a matching fake receipt). See App.jsx boot-sequence note.

// ── Shared UI ────────────────────────────────────────────────────────────────
function Tag({ status }) {
  const { C } = useTheme();
  const m = {
    'Draft':['#6B7280','rgba(107,114,128,.12)'], 'Sent':['#1A5C8A','rgba(26,92,138,.12)'],
    'Pending':[C.warning,'rgba(201,122,10,.12)'], 'Paid':[C.success,'rgba(26,122,74,.12)'],
    'Overdue':[C.danger,'rgba(192,57,43,.12)'], 'Partial':[C.warning,'rgba(201,122,10,.12)'],
    'Cancelled':['#6B7280','rgba(107,114,128,.12)'], 'Disputed':['#7C3AED','rgba(124,58,237,.12)'],
  };
  const [c,bg] = m[status]||['#6B7280','rgba(107,114,128,.12)'];
  return <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:500, color:c, background:bg, border:`1px solid ${c}30`, whiteSpace:'nowrap' }}>{status}</span>;
}
function Btn({ children, onClick, variant='primary', sm, disabled, style={} }) {
  const { C } = useTheme();
  const V = { primary:{bg:C.green,co:'#fff',b:'none'}, ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border}, danger:{bg:C.danger,co:'#fff',b:'none'}, amber:{bg:C.amber,co:'#fff',b:'none'}, outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green} }[variant]||{};
  return <button onClick={onClick} disabled={disabled} style={{ background:V.bg, color:V.co, border:V.b, borderRadius:7, padding:sm?'4px 11px':'7px 16px', fontSize:sm?11.5:13, fontWeight:500, cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1, display:'inline-flex', alignItems:'center', gap:5, whiteSpace:'nowrap', ...style }}>{children}</button>;
}
function KPI({ label, value, sub, accent, alert, onClick }) {
  const { C } = useTheme();
  const c = alert ? C.danger : accent || C.green;
  return (
    <div onClick={onClick} style={{ background:C.bgCard, border:'1px solid '+(alert?C.danger+'40':C.border), borderRadius:12, padding:'13px 15px', flex:1, minWidth:148, position:'relative', boxShadow:C.shadowCard, cursor:onClick?'pointer':'default', transition:'transform .12s' }}
      onMouseEnter={e=>{ if(onClick) e.currentTarget.style.transform='translateY(-2px)'; }}
      onMouseLeave={e=>{ e.currentTarget.style.transform='translateY(0)'; }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:c, borderRadius:'12px 0 0 12px' }} />
      <div style={{ paddingLeft:8 }}>
        <div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:4 }}>{label}</div>
        <div style={{ fontSize:19, fontWeight:700, color:c, lineHeight:1 }}>{value}</div>
        {sub && <div style={{ fontSize:11, color:C.textMuted, marginTop:3 }}>{sub}</div>}
      </div>
    </div>
  );
}
function FG({ label, full, children }) {
  const { C } = useTheme();
  return <div style={{ display:'flex', flexDirection:'column', gap:4, gridColumn:full?'1/-1':undefined }}><label style={{ fontSize:11, fontWeight:600, color:C.textMid }}>{label}</label>{children}</div>;
}
function SecLabel({ label }) {
  const { C } = useTheme();
  return <div style={{ fontSize:11, fontWeight:700, color:C.textMid, textTransform:'uppercase', letterSpacing:'0.4px', margin:'16px 0 8px', paddingBottom:5, borderBottom:'2px solid '+C.greenPale }}>{label}</div>;
}
function Overlay({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'100%', maxWidth:860, marginBottom:32 }}>{children}</div>
    </div>
  );
}
function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'18px 20px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}

// ── Print ─────────────────────────────────────────────────────────────────────
function printInvoice(inv) {
  const cur = inv.currency || 'NGN';
  const sym = SYM[cur] || cur + ' ';
  const rows = inv.items.map((it, i) => `
    <tr style="background:${i%2===1?'#f3faf5':'#fff'}">
      <td>${i+1}</td><td>${it.description}</td><td style="text-align:center">${it.qty}</td>
      <td style="text-align:center">${it.unit}</td>
      <td style="text-align:right">${sym}${(Number(it.unitPrice)||0).toLocaleString('en-NG')}</td>
      <td style="text-align:right;font-weight:600">${sym}${(Number(it.total)||0).toLocaleString('en-NG')}</td>
    </tr>`).join('');

  openPrintWindow(`<!DOCTYPE html><html><head><title>Invoice ${inv.invoiceNo}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;background:#fff;padding:30px;max-width:720px;margin:0 auto}
    .lh{line-height:1.5}
    .brandrow{display:flex;align-items:center;gap:12px;margin-bottom:4px}
    .brandrow img{height:42px;width:auto;display:block}
    .brandrow .name{font-size:16px;font-weight:800;color:#1A5C2A;letter-spacing:.3px}
    .addrblock{font-size:11px;color:#333;margin:6px 0 14px;line-height:1.6}
    .refline{display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:18px}
    .toblock{margin-bottom:16px;font-size:12px;line-height:1.7}
    .toblock b{display:block}
    .invtitle{text-align:center;font-size:15px;font-weight:800;text-decoration:underline;letter-spacing:.5px;margin:16px 0 14px}
    .detailsgrid{display:grid;grid-template-columns:1fr 1fr;gap:3px 24px;font-size:12px;margin-bottom:16px}
    .detailsgrid .row{display:flex;gap:6px}
    .detailsgrid .lbl{font-weight:700;white-space:nowrap;min-width:150px}
    table.items{width:100%;border-collapse:collapse;margin:14px 0}
    table.items th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
    table.items td{padding:7px 9px;border-bottom:1px solid #EAF0EB;font-size:11.5px}
    .total-section{max-width:340px;margin-left:auto;margin-top:12px}
    .total-row-sm{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #EAF0EB;font-size:12px;color:#3A5040}
    .grand-total{display:flex;justify-content:space-between;padding:8px 0;font-size:15px;font-weight:800;color:#1A5C2A;border-top:2px solid #1A5C2A;margin-top:4px}
    .status-badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:600;background:${inv.status==='Paid'?'#d4edda':inv.status==='Overdue'?'#f8d7da':'#fff3cd'};color:${inv.status==='Paid'?'#155724':inv.status==='Overdue'?'#721c24':'#856404'}}
    .footer{margin-top:44px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px}
    .sig{border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C}
    .confidential{text-align:center;font-size:9px;color:#4A5C4E;margin-top:24px;text-transform:uppercase;letter-spacing:1.5px}
    @media print{ body{padding:14px} }
  </style></head><body>

  <div class="brandrow">
    <img src="${SLOT_LOGO_SRC}" alt="SLOT"/>
    <div class="name">SLOT ENGINEERING NIGERIA LIMITED</div>
  </div>
  <div class="addrblock lh">
    205 Eneka Road (Opposite State Primary, Atali)<br/>
    P.O. Box 5496, Port Harcourt, Rivers State<br/>
    Phone: 08136916735 &nbsp;·&nbsp; Email: slotengineering@sloteng.com &nbsp;·&nbsp; Website: www.sloteng.com
  </div>

  <div class="refline">
    <span><strong>OUR REF:</strong> ${inv.invoiceNo}</span>
    <span><strong>DATE:</strong> ${formatDate(inv.date)}</span>
  </div>

  <div class="toblock">
    <b>THE FINANCE MANAGER</b>
    <span>${inv.client}</span>
    <span>${(inv.clientAddress||'').toUpperCase()}</span>
  </div>

  <div class="invtitle">INVOICE${cur!=='NGN' ? ' — '+cur+' DENOMINATED' : ''}</div>

  <div class="detailsgrid">
    <div class="row"><span class="lbl">Invoice No:</span><span>${inv.invoiceNo}</span></div>
    <div class="row"><span class="lbl">Bank Name:</span><span>Access Bank PLC</span></div>
    <div class="row"><span class="lbl">Account No:</span><span>1430280538</span></div>
    <div class="row"><span class="lbl">Sort Code:</span><span>185008</span></div>
    <div class="row"><span class="lbl">Account Name:</span><span>SLOT Engineering Nig. Ltd</span></div>
    <div class="row"><span class="lbl">TIN:</span><span>00499389-0001</span></div>
    ${inv.grnNumber ? `<div class="row"><span class="lbl">GRN Number:</span><span>${inv.grnNumber}</span></div>` : ''}
    <div class="row"><span class="lbl">VAT No:</span><span>PHVO500258586</span></div>
    <div class="row"><span class="lbl">Client:</span><span>${inv.client}</span></div>
    <div class="row"><span class="lbl">Client Address:</span><span>${inv.clientAddress||'—'}</span></div>
    ${inv.poNumber ? `<div class="row"><span class="lbl">Purchase Order No:</span><span>${inv.poNumber}</span></div>` : ''}
    <div class="row"><span class="lbl">Project Ref:</span><span>${inv.projectRef||'—'}</span></div>
    <div class="row"><span class="lbl">Payment Terms:</span><span>${inv.paymentTerms||'—'}</span></div>
    <div class="row"><span class="lbl">Due Date:</span><span>${formatDate(inv.dueDate)}</span></div>
    <div class="row"><span class="lbl">Status:</span><span class="status-badge">${inv.status}</span></div>
  </div>
  ${inv.poDescription ? `<div style="font-size:12px;margin-bottom:14px"><strong>Purchase Order Description:</strong> ${inv.poDescription}</div>` : ''}

  <table class="items"><thead><tr><th>S/N</th><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:center">Unit</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>${rows}</tbody></table>

  <div class="total-section">
    <div class="total-row-sm"><span>Subtotal</span><span>${sym}${(Number(inv.subtotal)||0).toLocaleString('en-NG')}</span></div>
    <div class="total-row-sm"><span>VAT (7.5%)</span><span>${sym}${(Number(inv.vatAmount)||0).toLocaleString('en-NG')}</span></div>
    <div class="total-row-sm"><span>WHT (${inv.whtRate||5}%)</span><span>– ${sym}${(Number(inv.whtAmount)||0).toLocaleString('en-NG')}</span></div>
    ${inv.ncdfAmount ? `<div class="total-row-sm"><span>NCDF (${inv.ncdfRate||1}%)</span><span>– ${sym}${(Number(inv.ncdfAmount)||0).toLocaleString('en-NG')}</span></div>` : ''}
    <div class="grand-total"><span>Net Payable</span><span>${sym}${(Number(inv.netPayable)||0).toLocaleString('en-NG')}</span></div>
  </div>
  ${cur!=='NGN' ? `<div style="text-align:right;font-size:11px;color:#182A1C;margin-top:4px">NGN equivalent at ₦${inv.fxRate}/${cur}: ₦${(Number(inv.ngnEquivalent)||0).toLocaleString('en-NG')}</div>` : ''}

  ${inv.notes ? `<p style="margin-top:16px;font-size:12px;color:#182A1C"><strong>Notes:</strong> ${inv.notes}</p>` : ''}

  <div class="footer">
    <div><div class="sig">Prepared By / Date</div></div>
    <div><div class="sig">Authorised Signatory / Date</div></div>
    <div><div class="sig">Client Acknowledgement</div></div>
  </div>
  <div class="confidential">SLOT Engineering Nigeria Limited · This document is system-generated</div>
  ${printBootstrap({landscape:false})}</body></html>`);
}

// Backfills fields that didn't exist on invoices created before this AR
// upgrade (currency, fxRate, ngnEquivalent, receivedAmount, clientCode) so
// older "Paid" records don't show a phantom balance due, and so mixed old/new
// data renders consistently everywhere downstream.
//
// One extra wrinkle: the previous Invoices.jsx form saved the SAGE client
// CODE directly into the `client` field (no separate clientCode field), while
// seed/demo rows used a friendly display name in that same field. So if
// `client` happens to resolve as a real client code, treat it as the code and
// recover the proper display name; otherwise leave it as free text.
function normalizeInvoice(inv) {
  const currency = inv.currency || 'NGN';
  const fxRate = Number(inv.fxRate) || DEFAULT_FX[currency] || 1;
  const netPayable = Number(inv.netPayable) || 0;
  const receivedAmount = inv.receivedAmount != null
    ? Number(inv.receivedAmount)
    : (inv.status === 'Paid' ? netPayable : 0); // legacy "Paid" rows had no receivedAmount field at all

  let clientCode = inv.clientCode;
  let client = inv.client;
  if (!clientCode) {
    const matched = getClientByCode(inv.client);
    if (matched) { clientCode = matched.code; client = matched.name; }
    else clientCode = inv.client;
  }

  return {
    ...inv,
    client, clientCode,
    currency,
    fxRate,
    ngnEquivalent: inv.ngnEquivalent != null ? Number(inv.ngnEquivalent) : Math.round(netPayable * fxRate),
    receivedAmount,
    ncdfRate: inv.ncdfRate || 0,
    ncdfAmount: inv.ncdfAmount || 0,
  };
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AccountsReceivable() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db } = state;
  const perms = { add: canDo(currentUser,'canAdd'), edit: canDo(currentUser,'canEdit'), del: canDo(currentUser,'canDelete') };

  const storedInv = (db.invoices || []).map(normalizeInvoice);
  const storedRec = db.arReceipts || [];
  const [invoices, setInvoices] = useState(storedInv);
  const [receipts, setReceipts] = useState(storedRec);

  const [clients, setClients]  = useState(() => getClients().filter(c=>c.status==='Active'));
  const EMPTY_CUSTOMER = { code:'', groupKey:'', name:'', currency:'NGN', contact:'', phone:'', email:'', address:'', rcNo:'', tin:'', paymentTerms:'Net 30', creditLimit:0, status:'Active', notes:'' };
  const [customerForm, setCustomerForm] = useState(EMPTY_CUSTOMER);
  const [customerModal, setCustomerModal] = useState(false);
  const [projects] = useState(() => getProjects().filter(p=>p.status==='Active'));

  const save = (newInv, newRec = receipts) => {
    diffAndPush('invoices', invoices, newInv);     // 2026-07-29 full-app sync sweep
    diffAndPush('arReceipts', receipts, newRec);
    setInvoices(newInv); setReceipts(newRec);
    dispatch({ type:'UPDATE_MODULE', mod:'invoices', data: newInv });
    dispatch({ type:'UPDATE_MODULE', mod:'arReceipts', data: newRec });
    saveDBLocal({ ...db, invoices: newInv, arReceipts: newRec }, state.activity);
  };

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const sel = { ...inp };
  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const [tab, setTab]       = useState('overview');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal]   = useState(null); // null | 'add' | 'view' | 'receipt'
  const [sel2, setSel2]     = useState(null);
  const [delId, setDelId]   = useState(null);
  const [expandedId, setExpandedId] = useState(null); // invoice row currently expanded via chevron
  const [ledgerCode, setLedgerCode]   = useState(null); // customer code shown in Customer Ledger modal
  const [ledgerModal, setLedgerModal] = useState(false);

  const TABS = [
    { id:'overview', label:'📊 Overview'  },
    { id:'customers', label:'👥 Customers' },
    { id:'list',      label:'🧾 Invoices'  },
    { id:'receipts',  label:'💰 Receipts'  },
    { id:'aging',     label:'📅 Aging'     },
    { id:'analysis',  label:'📈 Analysis'  },
  ];

  const EMPTY_ITEM = { id:uid(), description:'', qty:1, unit:'service', unitPrice:'', total:0 };
  const EMPTY_FORM = { client:'', clientCode:'', clientAddress:'', projectRef:'', category:'Engineering Services', date:today(), dueDate:'', paymentTerms:'Net 30', currency:'NGN', fxRate:1, items:[{ ...EMPTY_ITEM }], whtRate:5, ncdfRate:0, notes:'', poNumber:'', poDescription:'', grnNumber:'' };
  const [form, setForm] = useState(EMPTY_FORM);
  const selectedClient = clients.find(c=>c.code===form.clientCode) || null;

  const handleClientSelect = (code) => {
    const c = getClientByCode(code);
    setForm(f => ({ ...f, clientCode: code, client: c?.name || f.client, clientAddress: c?.address || f.clientAddress, currency: c?.currency || 'NGN', fxRate: DEFAULT_FX[c?.currency] || 1 }));
  };

  const getAgingClass = (inv) => {
    if (inv.status === 'Paid') return null;
    const due = new Date(inv.dueDate);
    const now = new Date();
    const days = Math.round((now - due) / 86400000);
    return days > 0 ? days : null;
  };

  const recompute = (items, whtRate, ncdfRate, fxRate) => {
    const subtotal  = items.reduce((a,it) => a+(Number(it.total)||0), 0);
    const vatAmount = Math.round(subtotal * VAT_RATE / 100);
    const whtAmount = Math.round(subtotal * (Number(whtRate)||0) / 100);
    const ncdfAmount = Math.round(subtotal * (Number(ncdfRate)||0) / 100);
    const netPayable = subtotal + vatAmount - whtAmount - ncdfAmount;
    return { subtotal, vatAmount, whtAmount, ncdfAmount, total: subtotal + vatAmount, netPayable, ngnEquivalent: Math.round(netPayable * (Number(fxRate)||1)) };
  };

  const updateItem = (idx, field, val) => {
    const items = form.items.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: val };
      if (field === 'qty' || field === 'unitPrice') {
        updated.total = (Number(updated.qty)||0) * (Number(updated.unitPrice)||0);
      }
      return updated;
    });
    setForm(f => ({ ...f, items }));
  };

  const totals = useMemo(() => recompute(form.items, form.whtRate, form.ncdfRate, form.fxRate), [form.items, form.whtRate, form.ncdfRate, form.fxRate]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return invoices.filter(inv => {
      if (inv.voided) return false; // voided invoices stay in data for GL audit trail, just hidden here
      const matchSearch = !s || inv.client.toLowerCase().includes(s) || inv.invoiceNo.toLowerCase().includes(s) || (inv.projectRef||'').toLowerCase().includes(s);
      const matchFilter = filter === 'all' || inv.status.toLowerCase() === filter;
      return matchSearch && matchFilter;
    });
  }, [invoices, search, filter]);

  // NGN-equivalent everywhere a mixed-currency total is needed, native currency for single-record display
  const ngnEq = (inv) => Number(inv.ngnEquivalent ?? inv.netPayable) || 0;

  const stats = useMemo(() => {
    const active = invoices.filter(i=>!i.voided);
    const total = active.reduce((a,i) => a+ngnEq(i), 0);
    const paid  = active.filter(i=>i.status==='Paid').reduce((a,i) => a+ngnEq(i), 0);
    const outstanding = active.filter(i=>i.status!=='Paid'&&i.status!=='Cancelled').reduce((a,i) => a+ngnEq(i)*(1-(Number(i.receivedAmount)||0)/(Number(i.netPayable)||1)), 0);
    const overdue = active.filter(i=>i.status==='Overdue').length;
    return { total, paid, outstanding, overdue };
  }, [invoices]);

  function handleSaveCustomer() {
    if (!customerForm.code.trim() || !customerForm.name.trim()) { showToast('Code and name are required', 'error'); return; }
    if (clients.some(c => c.code === customerForm.code.trim())) { showToast('A customer with this code already exists', 'error'); return; }
    addClient({ ...customerForm, code: customerForm.code.trim(), groupKey: customerForm.groupKey.trim() || customerForm.code.trim() });
    setClients(getClients().filter(c => c.status === 'Active'));
    logActivity(dispatch, `Customer added: ${customerForm.name} (${customerForm.code})`, currentUser);
    showToast('Customer added');
    setCustomerModal(false);
  }

  function handleSave() {
    if (!form.clientCode) { showToast('Select a client','error'); return; }
    if (!form.date || !form.dueDate) { showToast('Invoice and due dates required','error'); return; }
    if (!form.items.length || !form.items[0].description.trim()) { showToast('At least one line item required','error'); return; }
    const t = recompute(form.items, form.whtRate, form.ncdfRate, form.fxRate);
    const rec = {
      id: uid(), invoiceNo: nextInvNo(invoices),
      ...form, ...t,
      status: 'Pending', paymentDate:'', paymentRef:'', receivedAmount:0,
      createdAt: new Date().toISOString(),
    };

    // ── Credit-limit enforcement (Sage-style hard block + admin override) ─
    // Compute the client's current outstanding balance (NGN equivalent of
    // all open invoices) and compare against their credit limit. Behaviour
    // mirrors Sage 200 Evolution:
    //   • Over limit → hard block. Only an admin can override, and the
    //     override is logged to the audit trail with the over-by amount.
    //   • ≥90% of limit → soft warning toast (sale proceeds automatically).
    //   • <90% → silent.
    // The override check is enforced server-side too via the privilege-
    // escalation trigger in 002_rls.sql (a non-admin cannot promote
    // themselves to admin to bypass this).
    const selClient = clients.find(c => c.code === form.clientCode);
    if (selClient && Number(selClient.creditLimit) > 0) {
      const outstandingBefore = invoices
        .filter(i => i.clientCode === form.clientCode && !i.voided && i.status !== 'Paid' && i.status !== 'Cancelled')
        .reduce((s,i) => s + ngnEq(i), 0);
      const newInvNgn = ngnEq(rec);
      const projected  = outstandingBefore + newInvNgn;
      const limit      = Number(selClient.creditLimit) || 0;
      if (projected > limit) {
        const over = projected - limit;
        // Hard block for non-admins. Admins get a confirm dialog with explicit
        // audit-trail wording — they're taking responsibility for the override.
        const isAdmin = currentUser?.role === 'admin';
        if (!isAdmin) {
          showToast(`⛔ CREDIT LIMIT BLOCKED: This invoice would push ${selClient.name} to ${fmt(projected, selClient.currency)} (over their ${fmt(limit, selClient.currency)} limit by ${fmt(over, selClient.currency)}). An admin must override.`, 'error', { duration: 6000 });
          return;
        }
        const proceed = window.confirm(
          `⚠️ CREDIT LIMIT OVERRIDE — ADMIN ACTION\n\n` +
          `You are about to create an invoice that exceeds ${selClient.name}'s credit limit.\n\n` +
          `Credit limit:         ${fmt(limit, selClient.currency)}\n` +
          `Current outstanding:  ${fmt(outstandingBefore, selClient.currency)}\n` +
          `This invoice:         ${fmt(newInvNgn, rec.currency)}\n` +
          `Projected outstanding: ${fmt(projected, selClient.currency)} (OVER by ${fmt(over, selClient.currency)})\n\n` +
          `This action will be recorded in the audit trail with your name.\n\n` +
          `Click OK to proceed with the override, or Cancel to abort.`
        );
        if (!proceed) { showToast('Invoice cancelled to respect credit limit', 'info'); return; }
        logActivity(dispatch, `CREDIT LIMIT OVERRIDE — ${selClient.name}: projected ${fmt(projected)} > limit ${fmt(limit)} (over by ${fmt(over)}) — admin override by ${currentUser?.name||'admin'}`, currentUser, { module:'ar', action:'credit_limit_override', metadata: { clientId: selClient.id, limit, outstandingBefore, newInvNgn, projected, overBy: over } });
      } else if (projected >= limit * 0.9) {
        // Soft warning: ≥90% of limit
        showToast(`⚠️ Approaching credit limit (${Math.round((projected/limit)*100)}% of ${fmt(limit, selClient.currency)})`, 'info');
      }
    }

    const updated = [...invoices, rec];
    save(updated);
    logActivity(dispatch, `Invoice ${rec.invoiceNo} created for ${rec.client} — ${fmt(rec.netPayable, rec.currency)}`, currentUser);
    showToast('Invoice created');
    setModal(null); setForm(EMPTY_FORM);
  }

  function handleDelete(id) {
    // Never hard-delete a financial record that may already be in the GL —
    // void it instead. The Accounting module detects `voided:true` and posts
    // an automatic reversing entry if (and only if) this record was already
    // posted, so the ledger stays correct with a full audit trail. Any
    // receipts already recorded against this invoice are voided too, since
    // they'd otherwise be orphaned (referencing an invoice that's gone).
    save(
      invoices.map(i => i.id === id ? { ...i, voided: true } : i),
      receipts.map(r => r.invoiceId === id ? { ...r, voided: true } : r),
    );
    showToast('Invoice voided'); setDelId(null);
  }

  // ── Receipt voucher ──────────────────────────────────────────────────────
  const EMPTY_RECEIPT = { date:today(), extraWht:0, extraNcdf:0, amountReceived:'', fxRate:1, bankCode:'3003', reference:'', notes:'' };
  const [recForm, setRecForm] = useState(EMPTY_RECEIPT);

  function openReceiptModal(inv) {
    setSel2(inv);
    const balance = (Number(inv.netPayable)||0) - (Number(inv.receivedAmount)||0);
    const matchingBank = BANK_ACCOUNTS.find(b => b.currency === inv.currency);
    setRecForm({ ...EMPTY_RECEIPT, amountReceived: balance.toString(), fxRate: inv.fxRate || DEFAULT_FX[inv.currency] || 1, bankCode: matchingBank?.code || '3003' });
    setModal('receipt');
  }

  function handleSaveReceipt() {
    if (!sel2) return;
    if (!recForm.date) { showToast('Enter receipt date','error'); return; }
    if (!Number(recForm.amountReceived)) { showToast('Enter amount received','error'); return; }
    const recvAmt = Number(recForm.amountReceived);
    const extraWht = Number(recForm.extraWht)||0;
    const extraNcdf = Number(recForm.extraNcdf)||0;
    // Gross applied = cash received + any further WHT/NCDF the customer deducted on remittance
    const grossApplied = recvAmt + extraWht + extraNcdf;
    const newReceived = (Number(sel2.receivedAmount)||0) + grossApplied;
    const newStatus = newReceived >= Number(sel2.netPayable) - 0.01 ? 'Paid' : 'Partial';
    const fx = Number(recForm.fxRate) || 1;
    const bank = BANK_ACCOUNTS.find(b => b.code === recForm.bankCode);
    const receipt = {
      id: uid(), receiptNo: nextReceiptNo(receipts), invoiceId: sel2.id, invoiceNo: sel2.invoiceNo, client: sel2.client,
      currency: sel2.currency, fxRate: fx, date: recForm.date, grossNetPayable: sel2.netPayable,
      extraWht, extraNcdf, amountReceived: recvAmt, ngnEquivalent: Math.round(recvAmt * fx),
      bankCode: recForm.bankCode, bankName: bank?.name||'', reference: recForm.reference, notes: recForm.notes,
      createdAt: new Date().toISOString(),
    };
    const newInvoices = invoices.map(i => i.id === sel2.id ? { ...i, status:newStatus, receivedAmount:newReceived, paymentDate:recForm.date, paymentRef:recForm.reference } : i);
    const newReceipts = [...receipts, receipt];
    save(newInvoices, newReceipts);
    logActivity(dispatch, `Receipt ${receipt.receiptNo} — ${sel2.client} ${fmt(recvAmt, sel2.currency)}${(extraWht||extraNcdf) ? ' (further WHT/NCDF deducted by customer)' : ''}`, currentUser);
    showToast('Receipt recorded'); setModal(null); setRecForm(EMPTY_RECEIPT); setSel2(null);
  }

  // ── Customer balances ────────────────────────────────────────────────────
  const customerBalances = useMemo(() => {
    const map = {};
    clients.forEach(c => { map[c.code] = { ...c, outstanding:0, outstandingNgn:0, invCount:0 }; });
    invoices.filter(i => !i.voided && i.status!=='Paid' && i.status!=='Cancelled').forEach(i => {
      const code = i.clientCode || i.client;
      if (!map[code]) map[code] = { code, name:i.client, currency:i.currency||'NGN', outstanding:0, outstandingNgn:0, invCount:0 };
      const bal = (Number(i.netPayable)||0) - (Number(i.receivedAmount)||0);
      map[code].outstanding += bal;
      map[code].outstandingNgn += bal * (ngnEq(i) / (Number(i.netPayable)||1));
      map[code].invCount++;
    });
    return Object.values(map).sort((a,b) => b.outstandingNgn - a.outstandingNgn);
  }, [invoices, clients]);

  // ── Aging table ──────────────────────────────────────────────────────────
  const agingTable = useMemo(() => {
    const map = {};
    invoices.filter(i=>!i.voided&&i.status!=='Paid'&&i.status!=='Cancelled').forEach(inv => {
      const days = Math.round((new Date() - new Date(inv.dueDate)) / 86400000);
      const bal  = (Number(inv.netPayable)||0) - (Number(inv.receivedAmount)||0);
      const balN = bal * (ngnEq(inv) / (Number(inv.netPayable)||1));
      const key = inv.clientCode || inv.client;
      if (!map[key]) map[key] = { client:inv.client, cur:inv.currency||'NGN', b0:0, b31:0, b61:0, b90:0, b0n:0, b31n:0, b61n:0, b90n:0 };
      const row = map[key];
      if (days <= 30)      { row.b0  += bal; row.b0n  += balN; }
      else if (days <= 60) { row.b31 += bal; row.b31n += balN; }
      else if (days <= 90) { row.b61 += bal; row.b61n += balN; }
      else                 { row.b90 += bal; row.b90n += balN; }
    });
    return Object.values(map);
  }, [invoices]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Accounts Receivable</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Customer invoices · receipts · aging · multi-currency</div>
        </div>
        {perms.add && <Btn onClick={()=>{ setForm(EMPTY_FORM); setModal('add'); }}>+ New Invoice</Btn>}
      </div>

      {/* Tab Bar */}
      <div style={{ display:'flex', borderBottom:'2px solid '+C.borderLight, gap:0, overflowX:'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:'10px 16px', fontSize:12.5, border:'none', background:'none', cursor:'pointer', fontWeight:tab===t.id?700:400, color:tab===t.id?C.green:C.textMuted, borderBottom:tab===t.id?'2px solid '+C.green:'2px solid transparent', marginBottom:-2, whiteSpace:'nowrap' }}>{t.label}</button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
            <KPI label="Total Invoiced (NGN eq.)" value={fmt(stats.total)} sub={`${invoices.length} invoices`} onClick={()=>setTab('list')} />
            <KPI label="Total Received"   value={fmt(stats.paid)} accent={C.success} sub="payments collected" onClick={()=>setTab('receipts')} />
            <KPI label="Outstanding"      value={fmt(stats.outstanding)} accent={C.amber} sub="awaiting payment" onClick={()=>setTab('aging')} />
            <KPI label="Overdue"          value={stats.overdue} alert={stats.overdue > 0} sub="require follow-up" onClick={()=>setTab('aging')} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:12 }}>Top Debtors</div>
              {customerBalances.filter(c=>c.outstanding>0).slice(0,6).map(c => (
                <div key={c.code} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid '+C.borderLight }}>
                  <div>
                    <div style={{ fontSize:12.5, fontWeight:600, color:C.text }}>{c.name}</div>
                    <div style={{ fontSize:11, color:C.textMuted }}>{c.code} · {c.currency} · {c.invCount} invoice{c.invCount!==1?'s':''}</div>
                  </div>
                  <div style={{ fontSize:13, fontWeight:700, color:C.amber }}>{fmt(c.outstanding, c.currency)}</div>
                </div>
              ))}
              {customerBalances.filter(c=>c.outstanding>0).length === 0 && <div style={{ fontSize:12, color:C.textMuted, textAlign:'center', padding:16 }}>No outstanding receivables</div>}
            </Card>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:12 }}>Aging Summary (NGN equivalent)</div>
              {[['Current (0–30 days)', agingTable.reduce((s,r)=>s+r.b0n,0), C.success], ['31–60 days', agingTable.reduce((s,r)=>s+r.b31n,0), C.amber], ['61–90 days', agingTable.reduce((s,r)=>s+r.b61n,0), C.warning], ['Over 90 days', agingTable.reduce((s,r)=>s+r.b90n,0), C.danger]].map(([label, val, color]) => {
                const total = agingTable.reduce((s,r)=>s+r.b0n+r.b31n+r.b61n+r.b90n,0)||1;
                const pct = Math.round((val/total)*100);
                return (
                  <div key={label} style={{ marginBottom:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11.5, marginBottom:3 }}>
                      <span style={{ color:C.textMid }}>{label}</span>
                      <span style={{ fontWeight:600, color }}>{fmt(val)}</span>
                    </div>
                    <div style={{ height:6, background:C.borderLight, borderRadius:3, overflow:'hidden' }}>
                      <div style={{ width:pct+'%', height:'100%', background:color, borderRadius:3, transition:'width 0.5s' }} />
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        </>
      )}

      {/* ── CUSTOMERS ── */}
      {tab === 'customers' && (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid '+C.borderLight, display:'flex', alignItems:'center', gap:10 }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer…" style={{ ...inp, maxWidth:260 }} />
            <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
              <span style={{ fontSize:11, color:C.textMuted }}>{customerBalances.length} customer accounts</span>
              {perms.add && <Btn sm onClick={()=>{ setCustomerForm(EMPTY_CUSTOMER); setCustomerModal(true); }}>+ Add Customer</Btn>}
            </div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>{['Code','Name','Currency','Open Invoices','Outstanding Balance',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {customerBalances.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.code.toLowerCase().includes(search.toLowerCase())).map(c => (
                  <tr key={c.code} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <td style={{ ...td, fontFamily:'monospace', fontSize:11.5, fontWeight:600, color:C.green }}>{c.code}</td>
                    <td style={{ ...td, fontWeight:600 }}>{c.name}</td>
                    <td style={td}><span style={{ fontSize:11, padding:'2px 7px', borderRadius:10, background:c.currency==='NGN'?C.greenPale:C.bgAlt, color:c.currency==='NGN'?C.green:C.amber, fontWeight:600 }}>{c.currency}</span></td>
                    <td style={{ ...td, textAlign:'center' }}>{c.invCount > 0 ? <span style={{ fontWeight:600, color:C.amber }}>{c.invCount}</span> : '—'}</td>
                    <td style={{ ...td, fontWeight:700, color: c.outstanding>0?C.danger:C.success }}>{c.outstanding > 0 ? fmt(c.outstanding, c.currency) : <span style={{ color:C.success }}>✓ Clear</span>}</td>
                    <td style={td}><Btn sm variant="ghost" onClick={()=>{ setLedgerCode(c.code); setLedgerModal(true); }}>📒 Ledger</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── INVOICES LIST ── */}
      {tab === 'list' && (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px', borderBottom:'1px solid '+C.borderLight, flexWrap:'wrap' }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search client, invoice no, project ref…" style={{ ...inp, maxWidth:280 }} />
            {['all','pending','paid','overdue','partial','draft'].map(s => (
              <button key={s} onClick={()=>setFilter(s)} style={{ padding:'4px 14px', borderRadius:20, fontSize:12, border:'1px solid '+(filter===s?C.green:C.border), background:filter===s?C.green:'transparent', color:filter===s?'#fff':C.textMid, cursor:'pointer', fontWeight:filter===s?600:400, textTransform:'capitalize' }}>{s==='all'?'All':s}</button>
            ))}
            <div style={{ marginLeft:'auto', fontSize:11, color:C.textMuted }}>{filtered.length} record{filtered.length!==1?'s':''}</div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                {['','Invoice No','Client','Project Ref','Date','Due Date','Net Payable','Status','Aging','Actions'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={10} style={{ ...td, textAlign:'center', padding:32, color:C.textMuted }}>No invoices found</td></tr>
                )}
                {filtered.map(inv => {
                  const aging = getAgingClass(inv);
                  const isOpen = expandedId === inv.id;
                  const invReceipts = receipts.filter(r => r.invoiceId === inv.id && !r.voided);
                  return (
                    <Fragment key={inv.id}>
                    <tr style={{ cursor:'pointer' }} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                      <td style={{ ...td, width:28, textAlign:'center' }} onClick={()=>setExpandedId(isOpen?null:inv.id)}>
                        <span style={{ display:'inline-block', transition:'transform .15s', transform: isOpen?'rotate(90deg)':'rotate(0deg)', color:C.textMuted, fontSize:12 }}>▸</span>
                      </td>
                      <td style={td} onClick={()=>setExpandedId(isOpen?null:inv.id)}><span style={{ fontWeight:700, color:C.green, fontFamily:'monospace', fontSize:12 }}>{inv.invoiceNo}</span></td>
                      <td style={td} onClick={()=>setExpandedId(isOpen?null:inv.id)}><div style={{ fontWeight:600, color:C.text }}>{inv.client}</div><div style={{ fontSize:11, color:C.textMuted }}>{inv.category} · {inv.currency||'NGN'}</div></td>
                      <td style={td} onClick={()=>setExpandedId(isOpen?null:inv.id)}><span style={{ fontFamily:'monospace', fontSize:11, color:C.textMid }}>{inv.projectRef||'—'}</span></td>
                      <td style={td} onClick={()=>setExpandedId(isOpen?null:inv.id)}>{formatDate(inv.date)}</td>
                      <td style={td} onClick={()=>setExpandedId(isOpen?null:inv.id)}>{formatDate(inv.dueDate)}</td>
                      <td style={{ ...td, fontWeight:700, color:C.green }} onClick={()=>setExpandedId(isOpen?null:inv.id)}>{fmt(inv.netPayable, inv.currency)}</td>
                      <td style={td} onClick={()=>setExpandedId(isOpen?null:inv.id)}><Tag status={inv.status} /></td>
                      <td style={td} onClick={()=>setExpandedId(isOpen?null:inv.id)}>{aging ? <span style={{ fontSize:11, fontWeight:600, color:C.danger, background:'rgba(192,57,43,.08)', padding:'2px 7px', borderRadius:20 }}>{aging}d overdue</span> : <span style={{ color:C.textLight, fontSize:11 }}>—</span>}</td>
                      <td style={td}>
                        <div style={{ display:'flex', gap:6 }}>
                          <Btn sm variant="ghost" onClick={()=>{ setSel2(inv); setModal('view'); }}>View</Btn>
                          {inv.status !== 'Paid' && inv.status !== 'Cancelled' && perms.edit && <Btn sm variant="outline" onClick={()=>openReceiptModal(inv)}>Receipt</Btn>}
                          <Btn sm variant="ghost" onClick={()=>printInvoice(inv)}>🖨 Print</Btn>
                          {perms.del && <Btn sm variant="danger" onClick={()=>setDelId(inv.id)}>✕</Btn>}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={10} style={{ padding:'12px 20px 16px 44px', background:C.bgAlt, borderBottom:'1px solid '+C.borderLight }}>
                          <div style={{ display:'flex', gap:32, flexWrap:'wrap', fontSize:12 }}>
                            <div>
                              <div style={{ color:C.textMuted, marginBottom:4 }}>Subtotal</div>
                              <div style={{ fontWeight:600 }}>{fmt(inv.subtotal, inv.currency)}</div>
                            </div>
                            <div>
                              <div style={{ color:C.textMuted, marginBottom:4 }}>VAT</div>
                              <div style={{ fontWeight:600 }}>{fmt(inv.vatAmount, inv.currency)}</div>
                            </div>
                            <div>
                              <div style={{ color:C.textMuted, marginBottom:4 }}>WHT Deducted</div>
                              <div style={{ fontWeight:600 }}>{fmt(inv.whtAmount, inv.currency)}</div>
                            </div>
                            <div>
                              <div style={{ color:C.textMuted, marginBottom:4 }}>NCDF</div>
                              <div style={{ fontWeight:600 }}>{fmt(inv.ncdfAmount||0, inv.currency)}</div>
                            </div>
                            <div>
                              <div style={{ color:C.textMuted, marginBottom:4 }}>Received to Date</div>
                              <div style={{ fontWeight:600, color:C.success }}>{fmt(inv.receivedAmount||0, inv.currency)}</div>
                            </div>
                          </div>
                          <div style={{ marginTop:12 }}>
                            <div style={{ color:C.textMuted, marginBottom:6, fontSize:11.5 }}>Receipts against this invoice ({invReceipts.length})</div>
                            {invReceipts.length === 0
                              ? <div style={{ color:C.textLight, fontSize:12 }}>None yet</div>
                              : invReceipts.map(r => (
                                  <div key={r.id} style={{ display:'flex', gap:14, fontSize:12, padding:'3px 0' }}>
                                    <span style={{ fontFamily:'monospace', color:C.textMid }}>{r.receiptNo}</span>
                                    <span style={{ color:C.textMuted }}>{formatDate(r.date)}</span>
                                    <span style={{ fontWeight:600, color:C.success }}>{fmt(r.amountReceived, r.currency)}</span>
                                  </div>
                                ))}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr style={{ background:C.bgAlt, borderTop:`2px solid ${C.border}` }}>
                    <td colSpan={5} style={{ ...td, fontWeight:700, color:C.text }}>Total ({filtered.length} invoice{filtered.length!==1?'s':''})</td>
                    <td style={{ ...td, fontWeight:800, color:C.green }}>{fmt(filtered.reduce((a,i)=>a+ngnEq(i),0), 'NGN')}</td>
                    <td colSpan={3} style={{ ...td, fontSize:11, color:C.textMuted }}>NGN-equivalent total — mixed-currency invoices converted at their recorded rate</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}

      {/* ── RECEIPTS ── */}
      {tab === 'receipts' && (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid '+C.borderLight, display:'flex', alignItems:'center' }}>
            <div style={{ fontSize:13, fontWeight:600, color:C.text }}>Receipt Voucher History</div>
            <div style={{ marginLeft:'auto', fontSize:11, color:C.textMuted }}>{receipts.filter(r=>!r.voided).length} receipts</div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>{['Receipt No','Client','Invoice No','Date','Amount Received','Further WHT/NCDF','Bank Account','Reference'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {receipts.filter(r=>!r.voided).length === 0 && <tr><td colSpan={8} style={{ ...td, textAlign:'center', padding:32, color:C.textMuted }}>No receipts recorded yet</td></tr>}
                {[...receipts].filter(r=>!r.voided).sort((a,b)=>b.date.localeCompare(a.date)).map(r => (
                  <tr key={r.id} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <td style={{ ...td, fontFamily:'monospace', fontSize:11.5, fontWeight:600, color:C.green }}>{r.receiptNo}</td>
                    <td style={{ ...td, fontWeight:600 }}>{r.client}</td>
                    <td style={{ ...td, fontFamily:'monospace', fontSize:11.5 }}>{r.invoiceNo}</td>
                    <td style={td}>{formatDate(r.date)}</td>
                    <td style={{ ...td, fontWeight:700, color:C.success }}>{fmt(r.amountReceived, r.currency)}</td>
                    <td style={{ ...td, fontSize:11.5 }}>{(r.extraWht||r.extraNcdf) ? <span style={{ color:C.amber, fontWeight:600 }}>WHT {fmt(r.extraWht||0,r.currency)} · NCDF {fmt(r.extraNcdf||0,r.currency)}</span> : <span style={{ color:C.textLight }}>—</span>}</td>
                    <td style={{ ...td, fontSize:11.5 }}>{r.bankName}</td>
                    <td style={{ ...td, fontSize:11.5 }}>{r.reference||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── AGING ── */}
      {tab === 'aging' && (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid '+C.borderLight }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Accounts Receivable Aging Report</div>
            <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Outstanding invoices grouped by days overdue, shown in native currency</div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>{['Client','Current (0–30)','31–60 Days','61–90 Days','Over 90 Days','Total'].map(h=><th key={h} style={{ ...th, textAlign: h==='Client'?'left':'right' }}>{h}</th>)}</tr></thead>
              <tbody>
                {agingTable.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign:'center', padding:32, color:C.textMuted }}>No outstanding invoices</td></tr>}
                {agingTable.map(r => {
                  const total = r.b0 + r.b31 + r.b61 + r.b90;
                  return (
                    <tr key={r.client+r.cur} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                      <td style={td}><div style={{ fontWeight:600 }}>{r.client}</div><div style={{ fontSize:11, color:C.textMuted }}>{r.cur}</div></td>
                      <td style={{ ...td, textAlign:'right', color:r.b0>0?C.text:C.textLight }}>{r.b0>0?fmt(r.b0,r.cur):'—'}</td>
                      <td style={{ ...td, textAlign:'right', color:r.b31>0?C.amber:C.textLight }}>{r.b31>0?fmt(r.b31,r.cur):'—'}</td>
                      <td style={{ ...td, textAlign:'right', color:r.b61>0?C.warning:C.textLight }}>{r.b61>0?fmt(r.b61,r.cur):'—'}</td>
                      <td style={{ ...td, textAlign:'right', fontWeight:r.b90>0?700:400, color:r.b90>0?C.danger:C.textLight }}>{r.b90>0?fmt(r.b90,r.cur):'—'}</td>
                      <td style={{ ...td, textAlign:'right', fontWeight:700, color:C.text }}>{fmt(total,r.cur)}</td>
                    </tr>
                  );
                })}
                {agingTable.length > 0 && (
                  <tr style={{ background:C.tableHeaderBg }}>
                    <td style={{ ...td, fontWeight:700, color:'#fff' }}>Total (NGN equivalent)</td>
                    {[agingTable.reduce((s,r)=>s+r.b0n,0), agingTable.reduce((s,r)=>s+r.b31n,0), agingTable.reduce((s,r)=>s+r.b61n,0), agingTable.reduce((s,r)=>s+r.b90n,0)].map((v,i) => (
                      <td key={i} style={{ ...td, textAlign:'right', fontWeight:700, color:'#fff' }}>{fmt(v)}</td>
                    ))}
                    <td style={{ ...td, textAlign:'right', fontWeight:700, color:'#fff' }}>{fmt(agingTable.reduce((s,r)=>s+r.b0n+r.b31n+r.b61n+r.b90n,0))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── ANALYSIS ── */}
      {tab === 'analysis' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <Card>
            <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:12 }}>AR by Category</div>
            {Object.entries(invoices.filter(i=>!i.voided&&i.status!=='Paid'&&i.status!=='Cancelled').reduce((m,i)=>{ const c=i.category||'Other'; m[c]=(m[c]||0)+(ngnEq(i)-(Number(i.receivedAmount)||0)); return m; },{})).sort(([,a],[,b])=>b-a).map(([cat,val]) => (
              <div key={cat} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid '+C.borderLight, fontSize:13 }}>
                <span style={{ color:C.textMid }}>{cat}</span>
                <span style={{ fontWeight:600, color:C.text }}>{fmt(val)}</span>
              </div>
            ))}
          </Card>
          <Card>
            <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:12 }}>AR by Currency</div>
            {['NGN','USD','EUR','GBP'].map(cur => {
              const val = invoices.filter(i=>!i.voided&&(i.currency||'NGN')===cur&&i.status!=='Paid'&&i.status!=='Cancelled').reduce((s,i)=>s+((Number(i.netPayable)||0)-(Number(i.receivedAmount)||0)),0);
              if (!val) return null;
              return (
                <div key={cur} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid '+C.borderLight, fontSize:13 }}>
                  <span style={{ color:C.textMid, fontWeight:600 }}>{cur}</span>
                  <span style={{ fontWeight:700, color:C.amber }}>{fmt(val, cur)}</span>
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {/* ── ADD INVOICE MODAL ── */}
      {modal === 'add' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, paddingBottom:14, borderBottom:'1px solid '+C.borderLight }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Invoice</div>
              <button onClick={()=>setModal(null)} style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>&times;</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <FG label="Client *" full>
                <select style={sel} value={form.clientCode} onChange={e=>handleClientSelect(e.target.value)}>
                  <option value="">— Select Client —</option>
                  {clients.map(c=><option key={c.id} value={c.code}>{c.name} — {c.code} ({c.currency})</option>)}
                </select>
                {selectedClient && (selectedClient.notes || Number(selectedClient.creditLimit) > 0) && (
                  <div style={{ fontSize:11, color:C.textMuted, marginTop:6, display:'flex', flexDirection:'column', gap:6 }}>
                    {Number(selectedClient.creditLimit) > 0 && (() => {
                      // Live credit utilisation for the currently selected client
                      const outstanding = invoices
                        .filter(i => i.clientCode === selectedClient.code && !i.voided && i.status !== 'Paid' && i.status !== 'Cancelled')
                        .reduce((s,i) => s + ngnEq(i), 0);
                      const limit  = Number(selectedClient.creditLimit) || 0;
                      const pct    = limit > 0 ? Math.min(100, Math.round((outstanding / limit) * 100)) : 0;
                      const barColor = pct >= 100 ? C.danger : pct >= 90 ? C.amber : C.success;
                      return (
                        <div>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
                            <span>Credit limit: <strong style={{ color:C.textMid }}>{fmt(limit, selectedClient.currency)}</strong></span>
                            <span>Outstanding: <strong style={{ color: barColor }}>{fmt(outstanding, selectedClient.currency)}</strong> · <strong style={{ color: barColor }}>{pct}%</strong></span>
                          </div>
                          <div style={{ height:6, background:C.border, borderRadius:20, overflow:'hidden' }}>
                            <div style={{ width: pct+'%', height:'100%', background: barColor, borderRadius:20, transition:'width 0.3s' }} />
                          </div>
                        </div>
                      );
                    })()}
                    {selectedClient.notes && <span style={{ fontSize:11 }}>📝 {selectedClient.notes}</span>}
                  </div>
                )}
              </FG>
              <FG label="Client Address"><input style={inp} value={form.clientAddress} onChange={e=>setForm(f=>({...f,clientAddress:e.target.value}))} placeholder="Full address" /></FG>
              <FG label="Project Reference">
                <select style={sel} value={form.projectRef} onChange={e=>setForm(f=>({...f,projectRef:e.target.value}))}>
                  <option value="">— No Project —</option>
                  {projects.map(p=><option key={p.id} value={p.code}>{p.code}{p.name&&p.name!==p.code?` — ${p.name}`:''}</option>)}
                </select>
              </FG>
              <FG label="Category"><select style={sel} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></FG>
              <FG label="Invoice Date *"><input type="date" style={inp} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} /></FG>
              <FG label="Due Date *"><input type="date" style={inp} value={form.dueDate} onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))} /></FG>
              <FG label="Payment Terms"><select style={sel} value={form.paymentTerms} onChange={e=>setForm(f=>({...f,paymentTerms:e.target.value}))}>{PAYMENT_TERMS.map(t=><option key={t}>{t}</option>)}</select></FG>
              <FG label="Currency">
                <select style={sel} value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value, fxRate:DEFAULT_FX[e.target.value]||1}))}>
                  {['NGN','USD','EUR','GBP'].map(c=><option key={c}>{c}</option>)}
                </select>
              </FG>
              {form.currency !== 'NGN' && (
                <FG label={`Exchange Rate (1 ${form.currency} = ₦)`}><input type="number" style={inp} value={form.fxRate} onChange={e=>setForm(f=>({...f,fxRate:e.target.value}))} /></FG>
              )}
              <FG label="WHT Rate (%)"><input type="number" style={inp} value={form.whtRate} onChange={e=>setForm(f=>({...f,whtRate:e.target.value}))} min="0" max="15" /></FG>
              <FG label="NCDF Rate (%)"><input type="number" style={inp} value={form.ncdfRate} onChange={e=>setForm(f=>({...f,ncdfRate:e.target.value}))} min="0" max="5" step="0.5" /></FG>
            </div>
            <div style={{ fontSize:10.5, color:C.textMuted, marginTop:6, lineHeight:1.5 }}>
              NCDF (Nigerian Content Development Fund — 1% levy) applies to NCDMB cabotage-eligible oil & gas service contracts. Leave at 0 if not applicable to this invoice.
            </div>

            <SecLabel label="Purchase Order &amp; GRN Reference" />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <FG label="Purchase Order No."><input style={inp} value={form.poNumber} onChange={e=>setForm(f=>({...f,poNumber:e.target.value}))} placeholder="e.g. 4200086660" /></FG>
              <FG label="GRN Number"><input style={inp} value={form.grnNumber} onChange={e=>setForm(f=>({...f,grnNumber:e.target.value}))} placeholder="e.g. 5000333081" /></FG>
              <FG label="Purchase Order Description" full><input style={inp} value={form.poDescription} onChange={e=>setForm(f=>({...f,poDescription:e.target.value}))} placeholder="e.g. Ball Gauge Press, Stewart Buchanan 21122071B-D" /></FG>
            </div>

            <SecLabel label="Line Items" />
            <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:10 }}>
              <thead><tr>
                {['Description','Qty','Unit',`Unit Price (${form.currency})`,`Total (${form.currency})`,''].map(h=><th key={h} style={{ ...th, fontSize:10 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {form.items.map((it, i) => (
                  <tr key={it.id}>
                    <td style={{ padding:'4px 6px' }}><input style={inp} value={it.description} onChange={e=>updateItem(i,'description',e.target.value)} placeholder="Item description" /></td>
                    <td style={{ padding:'4px 6px', width:60 }}><input type="number" style={inp} value={it.qty} onChange={e=>updateItem(i,'qty',e.target.value)} min="0" /></td>
                    <td style={{ padding:'4px 6px', width:90 }}><input style={inp} value={it.unit} onChange={e=>updateItem(i,'unit',e.target.value)} /></td>
                    <td style={{ padding:'4px 6px', width:130 }}><input type="number" style={inp} value={it.unitPrice} onChange={e=>updateItem(i,'unitPrice',e.target.value)} placeholder="0" /></td>
                    <td style={{ padding:'4px 6px', width:130 }}><div style={{ padding:'7px 10px', background:C.greenPale, borderRadius:6, fontSize:12, fontWeight:600, color:C.green }}>{fmt(it.total, form.currency)}</div></td>
                    <td style={{ padding:'4px 6px' }}><Btn sm variant="danger" onClick={()=>setForm(f=>({...f,items:f.items.filter((_,idx)=>idx!==i)}))}>✕</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Btn sm variant="ghost" onClick={()=>setForm(f=>({...f,items:[...f.items,{...EMPTY_ITEM,id:uid()}]}))} style={{ marginBottom:16 }}>+ Add Line</Btn>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 260px', gap:20 }}>
              <FG label="Notes"><textarea style={{ ...inp, height:70 }} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></FG>
              <div style={{ background:C.greenPale, borderRadius:8, padding:'12px 14px', fontSize:13 }}>
                {[['Subtotal', fmt(totals.subtotal,form.currency)], ['VAT (7.5%)', fmt(totals.vatAmount,form.currency)], [`WHT (${form.whtRate}%)`, `– ${fmt(totals.whtAmount,form.currency)}`], ...(Number(form.ncdfRate)>0 ? [[`NCDF (${form.ncdfRate}%)`, `– ${fmt(totals.ncdfAmount,form.currency)}`]] : [])].map(([k,v])=>(
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', marginBottom:5, color:C.textMid, fontSize:12 }}><span>{k}</span><span>{v}</span></div>
                ))}
                <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:15, color:C.green, borderTop:'1px solid '+C.border, paddingTop:8, marginTop:4 }}><span>Net Payable</span><span>{fmt(totals.netPayable, form.currency)}</span></div>
                {form.currency !== 'NGN' && (
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, paddingTop:6, borderTop:'1px dashed '+C.border, fontSize:11.5, fontWeight:600, color:C.amber }}><span>NGN Equivalent</span><span>{fmt(totals.ngnEquivalent,'NGN')}</span></div>
                )}
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSave}>Save Invoice</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {/* ── VIEW MODAL ── */}
      {modal === 'view' && sel2 && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, paddingBottom:14, borderBottom:'1px solid '+C.borderLight }}>
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:C.text }}>{sel2.invoiceNo}</div>
                <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>{sel2.client} · {formatDate(sel2.date)}</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <Btn sm variant="ghost" onClick={()=>printInvoice(sel2)}>🖨 Print</Btn>
                <button onClick={()=>setModal(null)} style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>&times;</button>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
              {[['Client', sel2.client], ['Category', sel2.category], ['Currency', sel2.currency||'NGN'], ['Project Ref', sel2.projectRef||'—'], ['Payment Terms', sel2.paymentTerms], ['Issue Date', formatDate(sel2.date)], ['Due Date', formatDate(sel2.dueDate)]].map(([k,v])=>(
                <div key={k}><div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:3 }}>{k}</div><div style={{ fontSize:13, color:C.text }}>{v}</div></div>
              ))}
            </div>
            {(sel2.poNumber || sel2.grnNumber) && (
              <div style={{ background:C.bgAlt, border:'1px solid '+C.border, borderRadius:8, padding:'10px 14px', marginBottom:16, display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                {sel2.poNumber && <div><div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:3 }}>Purchase Order No.</div><div style={{ fontSize:13, color:C.text, fontFamily:'monospace' }}>{sel2.poNumber}</div></div>}
                {sel2.grnNumber && <div><div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:3 }}>GRN Number</div><div style={{ fontSize:13, color:C.text, fontFamily:'monospace' }}>{sel2.grnNumber}</div></div>}
                {sel2.poDescription && <div style={{ gridColumn:'1/-1' }}><div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:3 }}>PO Description</div><div style={{ fontSize:13, color:C.text }}>{sel2.poDescription}</div></div>}
              </div>
            )}
            <SecLabel label="Line Items" />
            <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:14 }}>
              <thead><tr>{['Description','Qty','Unit','Unit Price','Total'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {sel2.items.map((it,i)=>(
                  <tr key={it.id} style={{ background: i%2===1?C.greenPale2:'' }}>
                    <td style={td}>{it.description}</td>
                    <td style={td}>{it.qty}</td>
                    <td style={td}>{it.unit}</td>
                    <td style={td}>{fmt(it.unitPrice, sel2.currency)}</td>
                    <td style={{ ...td, fontWeight:600 }}>{fmt(it.total, sel2.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display:'flex', justifyContent:'flex-end' }}>
              <div style={{ background:C.greenPale, borderRadius:8, padding:'12px 16px', minWidth:260 }}>
                {[['Subtotal', fmt(sel2.subtotal,sel2.currency)], ['VAT (7.5%)', fmt(sel2.vatAmount,sel2.currency)], [`WHT (${sel2.whtRate||5}%)`, `– ${fmt(sel2.whtAmount,sel2.currency)}`], ...(sel2.ncdfAmount ? [[`NCDF (${sel2.ncdfRate}%)`, `– ${fmt(sel2.ncdfAmount,sel2.currency)}`]] : [])].map(([k,v])=>(
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', marginBottom:5, color:C.textMid, fontSize:12 }}><span>{k}</span><span>{v}</span></div>
                ))}
                <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:15, color:C.green, borderTop:'1px solid '+C.border, paddingTop:8, marginTop:4 }}><span>Net Payable</span><span>{fmt(sel2.netPayable,sel2.currency)}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:5, color:C.textMid, fontSize:12 }}><span>Received</span><span>{fmt(sel2.receivedAmount||0,sel2.currency)}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, color:C.danger, fontSize:13 }}><span>Balance Due</span><span>{fmt((Number(sel2.netPayable)||0)-(Number(sel2.receivedAmount)||0),sel2.currency)}</span></div>
                {sel2.currency !== 'NGN' && (
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, paddingTop:6, borderTop:'1px dashed '+C.border, fontSize:11.5, fontWeight:600, color:C.amber }}><span>NGN Equivalent</span><span>{fmt(sel2.ngnEquivalent,'NGN')}</span></div>
                )}
              </div>
            </div>
            <div style={{ marginTop:14 }}><Tag status={sel2.status} /></div>
            {sel2.status === 'Paid' && (
              <div style={{ marginTop:14, padding:'10px 14px', background:'rgba(26,122,74,.08)', border:'1px solid rgba(26,122,74,.2)', borderLeft:'4px solid '+C.success, borderRadius:8, fontSize:12, color:C.success }}>
                ✓ Paid on {formatDate(sel2.paymentDate)} · Ref: {sel2.paymentRef||'—'}
              </div>
            )}
            {sel2.notes && <div style={{ marginTop:12, fontSize:12, color:C.textMuted }}><strong>Notes:</strong> {sel2.notes}</div>}
            <div style={{ marginTop:18, paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
              <div style={{ fontSize:12, fontWeight:700, color:C.text, marginBottom:8 }}>📎 Attachments</div>
              <AttachmentUploader
                attachments={sel2.attachments || []}
                onChange={(next) => {
                  const updated = { ...sel2, attachments: next };
                  setSel2(updated);
                  const newInvoices = invoices.map(i => i.id === sel2.id ? updated : i);
                  save(newInvoices);
                }}
                folder="ar-invoices"
                currentUser={currentUser}
              />
            </div>
          </Card>
        </Overlay>
      )}

      {/* ── RECEIPT VOUCHER MODAL ── */}
      {modal === 'receipt' && sel2 && (
        <Overlay onClose={()=>setModal(null)}>
          <Card style={{ maxWidth:540 }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:4 }}>Record Receipt</div>
            <div style={{ fontSize:12, color:C.textMuted, marginBottom:4 }}>{sel2.invoiceNo} · {sel2.client}</div>
            <div style={{ fontSize:13, fontWeight:600, color:C.amber, marginBottom:20 }}>Balance due: {fmt((Number(sel2.netPayable)||0)-(Number(sel2.receivedAmount)||0), sel2.currency)}</div>

            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <FG label="Receipt Date *"><input type="date" style={inp} value={recForm.date} onChange={e=>setRecForm(f=>({...f,date:e.target.value}))} /></FG>
              <FG label={`Cash Amount Received (${sel2.currency}) *`}><input type="number" style={inp} value={recForm.amountReceived} onChange={e=>setRecForm(f=>({...f,amountReceived:e.target.value}))} /></FG>

              <div style={{ background:C.bgAlt, border:'1px solid '+C.border, borderRadius:8, padding:'10px 14px' }}>
                <div style={{ fontSize:11, fontWeight:600, color:C.textMid, marginBottom:8 }}>Did the customer deduct further WHT or NCDF before remitting? (beyond what's already on the invoice — enter the amounts shown on their remittance advice)</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <FG label={`Further WHT Deducted (${sel2.currency})`}><input type="number" style={inp} value={recForm.extraWht} onChange={e=>setRecForm(f=>({...f,extraWht:e.target.value}))} placeholder="0.00" /></FG>
                  <FG label={`Further NCDF Deducted (${sel2.currency})`}><input type="number" style={inp} value={recForm.extraNcdf} onChange={e=>setRecForm(f=>({...f,extraNcdf:e.target.value}))} placeholder="0.00" /></FG>
                </div>
              </div>

              {sel2.currency !== 'NGN' && (
                <FG label={`Exchange Rate Today (1 ${sel2.currency} = ₦)`}><input type="number" style={inp} value={recForm.fxRate} onChange={e=>setRecForm(f=>({...f,fxRate:e.target.value}))} /></FG>
              )}
              <FG label="Bank Account Credited">
                <select style={inp} value={recForm.bankCode} onChange={e=>setRecForm(f=>({...f,bankCode:e.target.value}))}>
                  {BANK_ACCOUNTS.map(b=><option key={b.code} value={b.code}>{b.name} ({b.currency})</option>)}
                </select>
              </FG>
              <FG label="Payment Reference"><input style={inp} value={recForm.reference} onChange={e=>setRecForm(f=>({...f,reference:e.target.value}))} placeholder="Bank transfer ref / cheque no" /></FG>
              <FG label="Notes"><input style={inp} value={recForm.notes} onChange={e=>setRecForm(f=>({...f,notes:e.target.value}))} /></FG>
            </div>

            {(Number(recForm.amountReceived) > 0) && (
              <div style={{ background:C.greenPale, borderRadius:8, padding:'12px 14px', marginTop:14, fontSize:12.5 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}><span>Cash received</span><span style={{ fontWeight:600 }}>{fmt(Number(recForm.amountReceived), sel2.currency)}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}><span>+ Further WHT/NCDF deducted</span><span style={{ fontWeight:600 }}>{fmt((Number(recForm.extraWht)||0)+(Number(recForm.extraNcdf)||0), sel2.currency)}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, color:C.green, borderTop:'1px solid '+C.border, paddingTop:6, marginTop:2 }}><span>Total applied to invoice</span><span>{fmt(Number(recForm.amountReceived)+(Number(recForm.extraWht)||0)+(Number(recForm.extraNcdf)||0), sel2.currency)}</span></div>
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSaveReceipt}>Confirm Receipt</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {/* Confirm Delete */}
      {delId && (
        <div style={{ position:'fixed', inset:0, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <Card style={{ maxWidth:360, textAlign:'center' }}>
            <div style={{ fontSize:30, marginBottom:10 }}>⚠️</div>
            <div style={{ fontSize:15, fontWeight:600, color:C.text, marginBottom:20 }}>Delete this invoice?</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              <Btn variant="ghost" onClick={()=>setDelId(null)}>Cancel</Btn>
              <Btn variant="danger" onClick={()=>handleDelete(delId)}>Delete</Btn>
            </div>
          </Card>
        </div>
      )}

      {/* ── CUSTOMER LEDGER MODAL ── */}
      {ledgerModal && ledgerCode && (() => {
        const cust = customerBalances.find(c => c.code === ledgerCode);
        if (!cust) return null;
        // Merge invoices (money owed, +) and receipts (money received, -) chronologically,
        // then walk forward to compute a running balance — same shape as a bank statement.
        const rows = [
          ...invoices.filter(i => i.clientCode === ledgerCode && !i.voided && i.status !== 'Cancelled')
            .map(i => ({ date:i.date, type:'Invoice', ref:i.invoiceNo, desc:i.category||'', amount: ngnEq(i) })),
          ...receipts.filter(r => r.invoiceId && !r.voided && invoices.find(i=>i.id===r.invoiceId)?.clientCode === ledgerCode)
            .map(r => ({ date:r.date, type:'Receipt', ref:r.receiptNo, desc:r.reference||'', amount: -(Number(r.ngnEquivalent ?? r.amountReceived)||0) })),
        ].sort((a,b) => a.date.localeCompare(b.date));
        let running = 0;
        const withBalance = rows.map(r => { running += r.amount; return { ...r, balance: running }; });

        return (
          <Overlay onClose={()=>setLedgerModal(false)}>
            <Card style={{ maxWidth: 720 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:16, fontWeight:700, color:C.text }}>📒 Customer Ledger — {cust.name}</div>
                  <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>{cust.code} · {cust.currency}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:11, color:C.textMuted }}>Outstanding Balance (₦)</div>
                  <div style={{ fontSize:18, fontWeight:800, color: running>0?C.danger:C.success }}>{fmt(Math.abs(running), 'NGN')}</div>
                </div>
              </div>
              <div style={{ maxHeight:420, overflowY:'auto', border:`1px solid ${C.borderLight}`, borderRadius:8 }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr>{['Date','Type','Ref','Description','Amount (₦)','Balance (₦)'].map(h=><th key={h} style={{...th, position:'sticky', top:0}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {withBalance.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign:'center', padding:32, color:C.textMuted }}>No transactions for this customer yet</td></tr>}
                    {withBalance.map((r,i) => (
                      <tr key={i}>
                        <td style={td}>{r.date}</td>
                        <td style={td}><span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:600, background: r.type==='Invoice'?C.bgAlt:C.greenPale, color: r.type==='Invoice'?C.amber:C.green }}>{r.type}</span></td>
                        <td style={{ ...td, fontFamily:'monospace', fontSize:11.5 }}>{r.ref}</td>
                        <td style={{ ...td, color:C.textMuted }}>{r.desc}</td>
                        <td style={{ ...td, fontWeight:600, color: r.amount>=0?C.danger:C.success }}>{r.amount>=0?'+':''}{fmt(r.amount,'NGN')}</td>
                        <td style={{ ...td, fontWeight:700 }}>{fmt(r.balance,'NGN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:16 }}>
                <Btn variant="ghost" icon="🖨" onClick={()=>{
                  const rowsHtml = withBalance.map(r=>`<tr><td>${r.date}</td><td>${r.type}</td><td>${r.ref}</td><td>${r.desc}</td><td style="text-align:right">${fmt(r.amount,'NGN')}</td><td style="text-align:right">${fmt(r.balance,'NGN')}</td></tr>`).join('');
                  openPrintWindow(`<html><head><title>Customer Ledger — ${cust.name}</title><style>
                    body{font-family:Arial,sans-serif;padding:24px;color:#222}
                    h2{margin:0 0 4px}
                    table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
                    th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}
                    th{background:#f2f5f3}
                  </style></head><body>
                    ${printHeader('CUSTOMER LEDGER', cust.name)}
                    <div style="font-size:11px;color:#4A5C4E;margin-bottom:8px">${cust.code} · ${cust.currency}</div>
                    <table><thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Description</th><th>Amount</th><th>Balance</th></tr></thead><tbody>${rowsHtml}</tbody></table>
                    ${printBootstrap({landscape:false})}
                  </body></html>`);
                }}>Print</Btn>
                <Btn onClick={()=>setLedgerModal(false)}>Close</Btn>
              </div>
            </Card>
          </Overlay>
        );
      })()}

      {/* ── NEW CUSTOMER MODAL ── */}
      {customerModal && (
        <Overlay onClose={()=>setCustomerModal(false)}>
          <Card style={{ maxWidth:520 }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:16 }}>+ Add New Customer</div>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <FG label="Customer Code *"><input style={inp} value={customerForm.code} onChange={e=>setCustomerForm(f=>({...f,code:e.target.value.toUpperCase()}))} placeholder="e.g. NEWCLIENT (USD)" /></FG>
              <FG label="Customer Name *"><input style={inp} value={customerForm.name} onChange={e=>setCustomerForm(f=>({...f,name:e.target.value}))} placeholder="Full legal name" /></FG>
              <FG label="Currency">
                <select style={inp} value={customerForm.currency} onChange={e=>setCustomerForm(f=>({...f,currency:e.target.value}))}>
                  <option value="NGN">NGN</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
                </select>
              </FG>
              <FG label="Payment Terms">
                <select style={inp} value={customerForm.paymentTerms} onChange={e=>setCustomerForm(f=>({...f,paymentTerms:e.target.value}))}>
                  <option>Net 15</option><option>Net 30</option><option>Net 45</option><option>Net 60</option><option>Due on Receipt</option>
                </select>
              </FG>
              <FG label="Credit Limit (₦)"><input type="number" style={inp} value={customerForm.creditLimit} onChange={e=>setCustomerForm(f=>({...f,creditLimit:e.target.value}))} /></FG>
              <FG label="RC Number"><input style={inp} value={customerForm.rcNo} onChange={e=>setCustomerForm(f=>({...f,rcNo:e.target.value}))} /></FG>
              <FG label="TIN"><input style={inp} value={customerForm.tin} onChange={e=>setCustomerForm(f=>({...f,tin:e.target.value}))} /></FG>
              <FG label="Contact Person"><input style={inp} value={customerForm.contact} onChange={e=>setCustomerForm(f=>({...f,contact:e.target.value}))} /></FG>
              <FG label="Phone"><input style={inp} value={customerForm.phone} onChange={e=>setCustomerForm(f=>({...f,phone:e.target.value}))} /></FG>
              <FG label="Email"><input style={inp} value={customerForm.email} onChange={e=>setCustomerForm(f=>({...f,email:e.target.value}))} /></FG>
              <FG label="Address"><input style={inp} value={customerForm.address} onChange={e=>setCustomerForm(f=>({...f,address:e.target.value}))} /></FG>
              <FG label="Notes"><input style={inp} value={customerForm.notes} onChange={e=>setCustomerForm(f=>({...f,notes:e.target.value}))} /></FG>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
              <Btn variant="ghost" onClick={()=>setCustomerModal(false)}>Cancel</Btn>
              <Btn onClick={handleSaveCustomer}>Add Customer</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </div>
  );
}
