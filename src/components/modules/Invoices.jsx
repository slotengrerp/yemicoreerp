// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — INVOICES MODULE v1.0
// Client invoice creation · payment tracking · aging · print
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo }    from '../../utils/auth';
import { showToast, formatDate, generateId } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { printHeader, PRINT_CSS, SLOT_BRAND, SLOT_LOGO_SRC, printBootstrap, openPrintWindow} from '../../utils/logo';
import { getClients, getClientByCode } from '../../utils/clientMaster';
import { getProjects, getProjectByCode } from '../../utils/projectMaster';
import { diffAndPush } from '../../hooks/usePerRecordSync';

const uid = () => generateId();
const today = () => new Date().toISOString().split('T')[0];
const year  = () => new Date().getFullYear();
const fmt   = n => '₦' + (Number(n)||0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function nextInvNo(list) {
  const nums = list.map(x => parseInt((x.invoiceNo||'0').replace(/\D/g,''),10)).filter(Boolean);
  return `SLOT-INV-${year()}-${String(nums.length ? Math.max(...nums)+1 : 1).padStart(4,'0')}`;
}

const PAYMENT_TERMS = ['Net 7','Net 14','Net 30','Net 45','Net 60','50% Advance, 50% on Delivery','100% Advance','Due on Receipt'];
const CATEGORIES    = ['Engineering Services','Procurement Services','Logistics','Consultancy','Maintenance','Project Management','Equipment Supply','Labour Supply','Other'];
const VAT_RATE      = 7.5;

// 2026-07-29 — seed fallback removed permanently (was already emptied
// 2026-07-28, having held three fabricated invoices naming real customers).
// See App.jsx boot-sequence note.

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
        {onClick && <div style={{ fontSize:9, color:c, marginTop:3, fontWeight:700 }}>Click to filter →</div>}
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
  const rows = inv.items.map((it, i) => `
    <tr style="background:${i%2===1?'#f3faf5':'#fff'}">
      <td>${i+1}</td><td>${it.description}</td><td style="text-align:center">${it.qty}</td>
      <td style="text-align:center">${it.unit}</td>
      <td style="text-align:right">₦${(Number(it.unitPrice)||0).toLocaleString('en-NG')}</td>
      <td style="text-align:right;font-weight:600">₦${(Number(it.total)||0).toLocaleString('en-NG')}</td>
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

  <div class="invtitle">INVOICE</div>

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
    <div class="total-row-sm"><span>Subtotal</span><span>₦${(Number(inv.subtotal)||0).toLocaleString('en-NG')}</span></div>
    <div class="total-row-sm"><span>VAT (7.5%)</span><span>₦${(Number(inv.vatAmount)||0).toLocaleString('en-NG')}</span></div>
    <div class="total-row-sm"><span>WHT (${inv.whtRate||5}%)</span><span>– ₦${(Number(inv.whtAmount)||0).toLocaleString('en-NG')}</span></div>
    <div class="grand-total"><span>Net Payable</span><span>₦${(Number(inv.netPayable)||0).toLocaleString('en-NG')}</span></div>
  </div>

  ${inv.notes ? `<p style="margin-top:16px;font-size:12px;color:#182A1C"><strong>Notes:</strong> ${inv.notes}</p>` : ''}

  <div class="footer">
    <div><div class="sig">Prepared By / Date</div></div>
    <div><div class="sig">Authorised Signatory / Date</div></div>
    <div><div class="sig">Client Acknowledgement</div></div>
  </div>
  <div class="confidential">SLOT Engineering Nigeria Limited · This document is system-generated</div>
  ${printBootstrap({landscape:false})}</body></html>`);
}
// ── Main Component ────────────────────────────────────────────────────────────
export default function Invoices({ onNav }) {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db } = state;
  const perms = { add: canDo(currentUser,'canAdd'), edit: canDo(currentUser,'canEdit'), del: canDo(currentUser,'canDelete') };

  const stored = db.invoices || [];
  const [invoices, setInvoices] = useState(stored);

  // ── Master lists — replaces free-text Client/Project entry with proper
  // SAGE-matched dropdowns. See utils/clientMaster.js and utils/projectMaster.js.
  const [clients]  = useState(() => getClients().filter(c=>c.status==='Active'));
  const [projects] = useState(() => getProjects().filter(p=>p.status==='Active'));

  const save = (data) => {
    diffAndPush('invoices', invoices, data); // 2026-07-29 full-app sync sweep
    setInvoices(data);
    const newDb = { ...db, invoices: data };
    dispatch({ type:'UPDATE_MODULE', mod:'invoices', data });
    saveDBLocal(newDb, state.activity);
  };

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const sel = { ...inp };
  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const [tab, setTab]       = useState('list');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal]   = useState(null); // null | 'add' | 'view' | 'pay'
  const [sel2, setSel2]     = useState(null);
  const [delId, setDelId]   = useState(null);
  const [payForm, setPayForm] = useState({ paymentDate:'', paymentRef:'', note:'' });

  const EMPTY_ITEM = { id:uid(), description:'', qty:1, unit:'service', unitPrice:'', total:0 };
  const EMPTY_FORM = { client:'', clientAddress:'', projectRef:'', category:'Engineering Services', date:today(), dueDate:'', paymentTerms:'Net 30', items:[{ ...EMPTY_ITEM }], whtRate:5, notes:'', poNumber:'', poDescription:'', grnNumber:'' };
  const [form, setForm] = useState(EMPTY_FORM);
  const selectedClient = clients.find(c=>c.code===form.client) || null;

  /** When a client/customer is picked from the dropdown, auto-fill its address
   *  (if known) and surface its SAGE currency as context for this invoice. */
  const handleClientSelect = (code) => {
    const c = getClientByCode(code);
    setForm(f => ({ ...f, client: code, clientAddress: c?.address || f.clientAddress }));
  };

  const getAgingClass = (inv) => {
    if (inv.status === 'Paid') return null;
    const due = new Date(inv.dueDate);
    const now = new Date();
    const days = Math.round((now - due) / 86400000);
    return days > 0 ? days : null;
  };

  const recompute = (items, whtRate) => {
    const subtotal = items.reduce((a,it) => a+(Number(it.total)||0), 0);
    const vatAmount = Math.round(subtotal * VAT_RATE / 100);
    const whtAmount = Math.round(subtotal * (Number(whtRate)||0) / 100);
    return { subtotal, vatAmount, whtAmount, total: subtotal + vatAmount, netPayable: subtotal + vatAmount - whtAmount };
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

  const totals = useMemo(() => recompute(form.items, form.whtRate), [form.items, form.whtRate]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return invoices.filter(inv => {
      const matchSearch = !s || inv.client.toLowerCase().includes(s) || inv.invoiceNo.toLowerCase().includes(s) || (inv.projectRef||'').toLowerCase().includes(s);
      const matchFilter = filter === 'all' || inv.status.toLowerCase() === filter;
      return matchSearch && matchFilter;
    });
  }, [invoices, search, filter]);

  const stats = useMemo(() => {
    const total = invoices.reduce((a,i) => a+(Number(i.netPayable)||0), 0);
    const paid  = invoices.filter(i=>i.status==='Paid').reduce((a,i) => a+(Number(i.netPayable)||0), 0);
    const outstanding = invoices.filter(i=>i.status!=='Paid'&&i.status!=='Cancelled').reduce((a,i) => a+(Number(i.netPayable)||0), 0);
    const overdue = invoices.filter(i=>i.status==='Overdue').length;
    return { total, paid, outstanding, overdue };
  }, [invoices]);

  function handleSave() {
    if (!form.client.trim()) { showToast('Client name is required','error'); return; }
    if (!form.date || !form.dueDate) { showToast('Invoice and due dates required','error'); return; }
    if (!form.items.length || !form.items[0].description.trim()) { showToast('At least one line item required','error'); return; }
    const t = recompute(form.items, form.whtRate);
    const rec = {
      id: uid(), invoiceNo: nextInvNo(invoices),
      ...form, ...t,
      status: 'Pending', paymentDate:'', paymentRef:'',
      createdAt: new Date().toISOString(),
    };
    const updated = [...invoices, rec];
    save(updated);
    logActivity(dispatch, `Invoice ${rec.invoiceNo} created for ${rec.client}`, currentUser);
    showToast('Invoice created');
    setModal(null); setForm(EMPTY_FORM);
  }

  function handleRecordPayment() {
    if (!payForm.paymentDate) { showToast('Enter payment date','error'); return; }
    const updated = invoices.map(i => i.id === sel2.id ? { ...i, status:'Paid', paymentDate:payForm.paymentDate, paymentRef:payForm.paymentRef, notes:(i.notes ? i.notes+' | '+payForm.note : payForm.note) } : i);
    save(updated);
    logActivity(dispatch, `Payment recorded for invoice ${sel2.invoiceNo}`, currentUser);
    showToast('Payment recorded'); setModal(null); setPayForm({ paymentDate:'', paymentRef:'', note:'' });
  }

  function handleDelete(id) {
    // CRITICAL FIX: previously a Paid invoice could be hard-deleted, which
    // orphaned its GL entry (the original Dr-AR / Cr-Revenue JE stayed in the
    // GL forever) and broke Trial Balance — Trade Receivables was overstated
    // by the invoice amount even though the invoice was gone from the AR
    // subledger. Now Paid invoices can only be voided (which the auto-post
    // effect at Accounting.jsx:3123-3130 reverses with a mirror-image JE).
    const inv = invoices.find(i => i.id === id);
    if (!inv) { setDelId(null); return; }
    if (inv.status === 'Paid') {
      showToast('Cannot delete a Paid invoice — void it instead (the GL reversal will be posted automatically)', 'error');
      setDelId(null);
      return;
    }
    // Also block if any JE references this invoice — defence in depth in case
    // status field drifted out of sync with the GL.
    const journals = state?.acctData?.journals || [];
    const jeExists = journals.some(j => j.id && j.id.includes(`JE-AR-INV-${id}`));
    if (jeExists) {
      showToast('Cannot delete — GL entries exist for this invoice. Void it instead to post a reversal.', 'error');
      setDelId(null);
      return;
    }
    save(invoices.filter(i => i.id !== id));
    showToast('Invoice deleted'); setDelId(null);
  }

  const TABS = [{ key:'list', label:'All Invoices' }, { key:'aging', label:'Aging Report' }];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Client Invoices</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Issue and track client invoices · payment collection</div>
        </div>
        {perms.add && <Btn onClick={()=>{ setForm(EMPTY_FORM); setModal('add'); }}>+ New Invoice</Btn>}
      </div>

      {/* KPIs */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <KPI label="Total Invoiced" value={fmt(stats.total)} sub={`${invoices.length} invoices`}             onClick={()=>setTab('list')} />
        <KPI label="Total Received" value={fmt(stats.paid)} accent={C.success} sub="payments collected"       onClick={()=>setTab('list')} />
        <KPI label="Outstanding"    value={fmt(stats.outstanding)} accent={C.amber} sub="awaiting payment"    onClick={()=>setTab('aging')} />
        <KPI label="Overdue"        value={stats.overdue} alert={stats.overdue > 0} sub="require follow-up"   onClick={()=>setTab('aging')} />
      </div>

      {/* Tab Bar */}
      <div style={{ display:'flex', borderBottom:'2px solid '+C.borderLight, gap:0 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={()=>setTab(t.key)} style={{ padding:'10px 18px', fontSize:13, border:'none', background:'none', cursor:'pointer', fontWeight:tab===t.key?700:400, color:tab===t.key?C.green:C.textMuted, borderBottom:tab===t.key?'2px solid '+C.green:'2px solid transparent', marginBottom:-2, whiteSpace:'nowrap' }}>{t.label}</button>
        ))}
      </div>

      {tab === 'list' && (
        <Card style={{ padding:0, overflow:'hidden' }}>
          {/* Filters */}
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px', borderBottom:'1px solid '+C.borderLight, flexWrap:'wrap' }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search client, invoice no, project ref…" style={{ ...inp, maxWidth:280 }} />
            {['all','pending','paid','overdue','draft'].map(s => (
              <button key={s} onClick={()=>setFilter(s)} style={{ padding:'4px 14px', borderRadius:20, fontSize:12, border:'1px solid '+(filter===s?C.green:C.border), background:filter===s?C.green:'transparent', color:filter===s?'#fff':C.textMid, cursor:'pointer', fontWeight:filter===s?600:400, textTransform:'capitalize' }}>{s==='all'?'All':s}</button>
            ))}
            <div style={{ marginLeft:'auto', fontSize:11, color:C.textMuted }}>{filtered.length} record{filtered.length!==1?'s':''}</div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                {['Invoice No','Client','Project Ref','Date','Due Date','Net Payable','Status','Aging','Actions'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={9} style={{ ...td, textAlign:'center', padding:32, color:C.textMuted }}>No invoices found</td></tr>
                )}
                {filtered.map(inv => {
                  const aging = getAgingClass(inv);
                  return (
                    <tr key={inv.id} style={{ cursor:'pointer' }} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                      <td style={td}><span style={{ fontWeight:700, color:C.green, fontFamily:'monospace', fontSize:12 }}>{inv.invoiceNo}</span></td>
                      <td style={td}><div style={{ fontWeight:600, color:C.text }}>{inv.client}</div><div style={{ fontSize:11, color:C.textMuted }}>{inv.category}</div></td>
                      <td style={td}><span style={{ fontFamily:'monospace', fontSize:11, color:C.textMid }}>{inv.projectRef||'—'}</span></td>
                      <td style={td}>{formatDate(inv.date)}</td>
                      <td style={td}>{formatDate(inv.dueDate)}</td>
                      <td style={{ ...td, fontWeight:700, color:C.green }}>{fmt(inv.netPayable)}</td>
                      <td style={td}><Tag status={inv.status} /></td>
                      <td style={td}>{aging ? <span style={{ fontSize:11, fontWeight:600, color:C.danger, background:'rgba(192,57,43,.08)', padding:'2px 7px', borderRadius:20 }}>{aging}d overdue</span> : <span style={{ color:C.textLight, fontSize:11 }}>—</span>}</td>
                      <td style={td}>
                        <div style={{ display:'flex', gap:6 }}>
                          <Btn sm variant="ghost" onClick={()=>{ setSel2(inv); setModal('view'); }}>View</Btn>
                          {inv.status !== 'Paid' && perms.edit && <Btn sm variant="outline" onClick={()=>{ setSel2(inv); setPayForm({ paymentDate:today(), paymentRef:'', note:'' }); setModal('pay'); }}>Pay</Btn>}
                          <Btn sm variant="ghost" onClick={()=>printInvoice(inv)}>🖨 Print</Btn>
                          {perms.del && <Btn sm variant="danger" onClick={()=>setDelId(inv.id)}>✕</Btn>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'aging' && (
        <Card>
          <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:16 }}>Accounts Receivable Aging</div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                {['Client','Invoice No','Date','Due Date','Amount','0-30 Days','31-60 Days','61-90 Days','90+ Days','Status'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {invoices.filter(i=>i.status!=='Paid'&&i.status!=='Cancelled').length === 0 && (
                  <tr><td colSpan={10} style={{ ...td, textAlign:'center', padding:32, color:C.textMuted }}>No outstanding invoices</td></tr>
                )}
                {invoices.filter(i=>i.status!=='Paid'&&i.status!=='Cancelled').map(inv => {
                  const due = new Date(inv.dueDate);
                  const now = new Date();
                  const days = Math.round((now - due) / 86400000);
                  const amt = Number(inv.netPayable)||0;
                  const b0  = days <= 30 && days >= 0 ? amt : 0;
                  const b31 = days > 30 && days <= 60 ? amt : 0;
                  const b61 = days > 60 && days <= 90 ? amt : 0;
                  const b90 = days > 90 ? amt : 0;
                  return (
                    <tr key={inv.id}>
                      <td style={td}><strong>{inv.client}</strong></td>
                      <td style={{ ...td, fontFamily:'monospace', fontSize:12 }}>{inv.invoiceNo}</td>
                      <td style={td}>{formatDate(inv.date)}</td>
                      <td style={td}>{formatDate(inv.dueDate)}</td>
                      <td style={{ ...td, fontWeight:700 }}>{fmt(amt)}</td>
                      <td style={{ ...td, color: b0 ? C.amber : C.textLight }}>{b0 ? fmt(b0) : '—'}</td>
                      <td style={{ ...td, color: b31 ? C.warning : C.textLight }}>{b31 ? fmt(b31) : '—'}</td>
                      <td style={{ ...td, color: b61 ? C.danger : C.textLight }}>{b61 ? fmt(b61) : '—'}</td>
                      <td style={{ ...td, color: b90 ? C.danger : C.textLight, fontWeight: b90 ? 700 : 400 }}>{b90 ? fmt(b90) : '—'}</td>
                      <td style={td}><Tag status={inv.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Add Invoice Modal */}
      {modal === 'add' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, paddingBottom:14, borderBottom:'1px solid '+C.borderLight }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Invoice</div>
              <button onClick={()=>setModal(null)} style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>&times;</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <FG label="Client *" full>
                <select style={sel} value={form.client} onChange={e=>handleClientSelect(e.target.value)}>
                  <option value="">— Select Client —</option>
                  {clients.map(c=><option key={c.id} value={c.code}>{c.name} — {c.code} ({c.currency})</option>)}
                </select>
                {selectedClient && selectedClient.currency!=='NGN' && (
                  <div style={{ fontSize:11, color:C.amber, marginTop:4 }}>
                    ⚠ This is a {selectedClient.currency}-denominated customer account in SAGE. Multi-currency invoicing isn't built into this form yet — amounts below will post in ₦.
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
              <FG label="WHT Rate (%)"><input type="number" style={inp} value={form.whtRate} onChange={e=>setForm(f=>({...f,whtRate:e.target.value}))} min="0" max="15" /></FG>
            </div>

            <SecLabel label="Purchase Order &amp; GRN Reference" />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <FG label="Purchase Order No."><input style={inp} value={form.poNumber} onChange={e=>setForm(f=>({...f,poNumber:e.target.value}))} placeholder="e.g. 4200086660" /></FG>
              <FG label="GRN Number"><input style={inp} value={form.grnNumber} onChange={e=>setForm(f=>({...f,grnNumber:e.target.value}))} placeholder="e.g. 5000333081" /></FG>
              <FG label="Purchase Order Description" full><input style={inp} value={form.poDescription} onChange={e=>setForm(f=>({...f,poDescription:e.target.value}))} placeholder="e.g. Ball Gauge Press, Stewart Buchanan 21122071B-D" /></FG>
            </div>
            <div style={{ fontSize:10.5, color:C.textMuted, marginTop:-4, marginBottom:4, lineHeight:1.5 }}>
              GRN Number references the goods receipt confirming the client received the items/services billed. Leave blank for service-only invoices with no physical delivery.
            </div>

            <SecLabel label="Line Items" />
            <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:10 }}>
              <thead><tr>
                {['Description','Qty','Unit','Unit Price (₦)','Total (₦)',''].map(h=><th key={h} style={{ ...th, fontSize:10 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {form.items.map((it, i) => (
                  <tr key={it.id}>
                    <td style={{ padding:'4px 6px' }}><input style={inp} value={it.description} onChange={e=>updateItem(i,'description',e.target.value)} placeholder="Item description" /></td>
                    <td style={{ padding:'4px 6px', width:60 }}><input type="number" style={inp} value={it.qty} onChange={e=>updateItem(i,'qty',e.target.value)} min="0" /></td>
                    <td style={{ padding:'4px 6px', width:90 }}><input style={inp} value={it.unit} onChange={e=>updateItem(i,'unit',e.target.value)} /></td>
                    <td style={{ padding:'4px 6px', width:130 }}><input type="number" style={inp} value={it.unitPrice} onChange={e=>updateItem(i,'unitPrice',e.target.value)} placeholder="0" /></td>
                    <td style={{ padding:'4px 6px', width:130 }}><div style={{ padding:'7px 10px', background:C.greenPale, borderRadius:6, fontSize:12, fontWeight:600, color:C.green }}>{fmt(it.total)}</div></td>
                    <td style={{ padding:'4px 6px' }}><Btn sm variant="danger" onClick={()=>setForm(f=>({...f,items:f.items.filter((_,idx)=>idx!==i)}))}>✕</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Btn sm variant="ghost" onClick={()=>setForm(f=>({...f,items:[...f.items,{...EMPTY_ITEM,id:uid()}]}))} style={{ marginBottom:16 }}>+ Add Line</Btn>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 240px', gap:20 }}>
              <FG label="Notes"><textarea style={{ ...inp, height:70 }} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></FG>
              <div style={{ background:C.greenPale, borderRadius:8, padding:'12px 14px', fontSize:13 }}>
                {[['Subtotal', fmt(totals.subtotal)], ['VAT (7.5%)', fmt(totals.vatAmount)], [`WHT (${form.whtRate}%)`, `– ${fmt(totals.whtAmount)}`]].map(([k,v])=>(
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', marginBottom:5, color:C.textMid, fontSize:12 }}><span>{k}</span><span>{v}</span></div>
                ))}
                <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:15, color:C.green, borderTop:'1px solid '+C.border, paddingTop:8, marginTop:4 }}><span>Net Payable</span><span>{fmt(totals.netPayable)}</span></div>
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSave}>Save Invoice</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {/* View Modal */}
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
              {[['Client', sel2.client], ['Category', sel2.category], ['Project Ref', sel2.projectRef||'—'], ['Payment Terms', sel2.paymentTerms], ['Issue Date', formatDate(sel2.date)], ['Due Date', formatDate(sel2.dueDate)]].map(([k,v])=>(
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
                    <td style={td}>{fmt(it.unitPrice)}</td>
                    <td style={{ ...td, fontWeight:600 }}>{fmt(it.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display:'flex', justifyContent:'flex-end' }}>
              <div style={{ background:C.greenPale, borderRadius:8, padding:'12px 16px', minWidth:260 }}>
                {[['Subtotal', fmt(sel2.subtotal)], ['VAT (7.5%)', fmt(sel2.vatAmount)], [`WHT (${sel2.whtRate||5}%)`, `– ${fmt(sel2.whtAmount)}`]].map(([k,v])=>(
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', marginBottom:5, color:C.textMid, fontSize:12 }}><span>{k}</span><span>{v}</span></div>
                ))}
                <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:15, color:C.green, borderTop:'1px solid '+C.border, paddingTop:8, marginTop:4 }}><span>Net Payable</span><span>{fmt(sel2.netPayable)}</span></div>
              </div>
            </div>
            {sel2.status === 'Paid' && (
              <div style={{ marginTop:14, padding:'10px 14px', background:'rgba(26,122,74,.08)', border:'1px solid rgba(26,122,74,.2)', borderLeft:'4px solid '+C.success, borderRadius:8, fontSize:12, color:C.success }}>
                ✓ Paid on {formatDate(sel2.paymentDate)} · Ref: {sel2.paymentRef||'—'}
              </div>
            )}
            {sel2.notes && <div style={{ marginTop:12, fontSize:12, color:C.textMuted }}><strong>Notes:</strong> {sel2.notes}</div>}
          </Card>
        </Overlay>
      )}

      {/* Record Payment Modal */}
      {modal === 'pay' && sel2 && (
        <Overlay onClose={()=>setModal(null)}>
          <Card style={{ maxWidth:480 }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:4 }}>Record Payment</div>
            <div style={{ fontSize:12, color:C.textMuted, marginBottom:20 }}>{sel2.invoiceNo} · {sel2.client} · {fmt(sel2.netPayable)}</div>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <FG label="Payment Date *"><input type="date" style={inp} value={payForm.paymentDate} onChange={e=>setPayForm(f=>({...f,paymentDate:e.target.value}))} /></FG>
              <FG label="Payment Reference"><input style={inp} value={payForm.paymentRef} onChange={e=>setPayForm(f=>({...f,paymentRef:e.target.value}))} placeholder="Bank transfer ref / cheque no" /></FG>
              <FG label="Note"><input style={inp} value={payForm.note} onChange={e=>setPayForm(f=>({...f,note:e.target.value}))} placeholder="Optional note" /></FG>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleRecordPayment}>Confirm Payment</Btn>
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
    </div>
  );
}
