// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — SALES ORDERS MODULE v1.0
// Quote → Sales Order → Invoice progression with back-order tracking
// Each SO has line items with order qty, unit price, currency.
// Status: Draft → Confirmed → Partially Invoiced / Invoiced / Closed / Cancelled
// One-click "Generate Invoice" creates an AR invoice pre-filled from the SO,
// tracks which lines have been invoiced, and supports partial invoicing
// (back-orders stay open until the remaining qty ships).
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo }    from '../../utils/auth';
import { showToast, formatDate, generateId } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { getClients } from '../../utils/clientMaster';
import { getProjects } from '../../utils/projectMaster';
import { Btn, Tag, Card, FG, SearchBar, TabBar, EmptyState, Confirm, StatCard, AttachmentUploader } from '../ui';
import { printHeader, PRINT_CSS } from '../../utils/logo';

const STATUS = ['Draft', 'Confirmed', 'Partially Invoiced', 'Invoiced', 'Closed', 'Cancelled'];
const STATUS_COLOR = {
  'Draft':              { color: '#6B7280', bg: 'rgba(107,114,128,.12)' },
  'Confirmed':          { color: '#1A5C8A', bg: 'rgba(26,92,138,.12)' },
  'Partially Invoiced': { color: '#C97A0A', bg: 'rgba(201,122,10,.12)' },
  'Invoiced':           { color: '#1A7A4A', bg: 'rgba(26,122,74,.12)' },
  'Closed':             { color: '#1A5C2A', bg: 'rgba(26,92,42,.12)' },
  'Cancelled':          { color: '#C0392B', bg: 'rgba(192,57,43,.12)' },
};

// Emptied 2026-07-28 — held three fabricated sales orders (~₦24m plus a USD
// one) against real customer names, two carrying invented invoicedQty figures
// that would have shown work as already billed.
const SEED = [];

const fmt    = n => '₦' + (Number(n)||0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
const fmtFC  = (n, c) => { const sym = { USD:'$', EUR:'€', GBP:'£' }[c] || ''; return `${sym}${(Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:2})}`; };
const STATUS_BADGE = ({ status }) => { const m = STATUS_COLOR[status] || STATUS_COLOR.Draft; return <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600, color:m.color, background:m.bg, border:`1px solid ${m.color}30`, whiteSpace:'nowrap' }}>{status}</span>; };

function nextSoNo(list) {
  const nums = list.filter(s => s.soNo?.startsWith('SO-')).map(s => parseInt((s.soNo||'0').replace(/\D/g,''),10)).filter(Boolean);
  return `SO-${String(nums.length ? Math.max(...nums) + 1 : 1).padStart(4,'0')}`;
}

function emptySo() {
  return {
    id: generateId(),
    soNo: '',
    client: '',
    clientCode: '',
    projectRef: '',
    date: new Date().toISOString().split('T')[0],
    expectedDelivery: '',
    currency: 'NGN',
    fxRate: 1,
    status: 'Draft',
    notes: '',
    items: [{ id: generateId(), description: '', qty: 1, unit: 'pcs', unitPrice: 0, orderedQty: 1, invoicedQty: 0 }],
    invoices: [],
    attachments: [],
    createdAt: new Date().toISOString(),
  };
}

function soTotals(so) {
  const subtotal = (so.items || []).reduce((s, l) => s + ((Number(l.qty)||0) * (Number(l.unitPrice)||0)), 0);
  return { subtotal, vat: subtotal * 0.075, wht: subtotal * 0.05, total: subtotal * 1.075, ngn: subtotal * (Number(so.fxRate)||1) * 1.075 };
}

function soLineProgress(l) {
  const o = Number(l.orderedQty)||0, i = Number(l.invoicedQty)||0;
  if (o <= 0) return { pct: 0, label: '—' };
  const pct = Math.min(100, Math.round((i / o) * 100));
  return { pct, label: `${i}/${o} (${pct}%)` };
}

export default function SalesOrders() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db } = state;
  const stored = ((db.salesOrders?.length || state.appSettings?.dataWiped) ? (db.salesOrders || []) : SEED);
  const [sos, setSos] = useState(stored);
  const [tab, setTab] = useState('list');           // list | detail | new
  const [sel, setSel]   = useState(null);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const perms = { add: canDo(currentUser,'canAdd'), edit: canDo(currentUser,'canEdit'), del: canDo(currentUser,'canDelete') };

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };

  function persist(next) {
    setSos(next);
    dispatch({ type:'UPDATE_MODULE', mod:'salesOrders', data: next });
    saveDBLocal({ ...db, salesOrders: next }, state.activity);
  }

  function handleSave() {
    if (!editing) return;
    if (!editing.client) { showToast('Select a client', 'error'); return; }
    if (!editing.items?.length) { showToast('At least one line item required', 'error'); return; }
    const isEdit = sos.some(s => s.id === editing.id);
    const so = isEdit ? editing : { ...editing, soNo: editing.soNo || nextSoNo(sos) };
    const next = isEdit ? sos.map(s => s.id === so.id ? so : s) : [so, ...sos];
    persist(next);
    logActivity(dispatch, `${isEdit?'Updated':'Created'} Sales Order ${so.soNo} for ${so.client}`, currentUser, { module:'salesorders', action: isEdit?'edit':'create' });
    showToast(isEdit ? `Updated ${so.soNo}` : `Created ${so.soNo}`);
    setEditing(null);
    setTab('list');
  }

  function handleDelete(id) {
    const so = sos.find(s => s.id === id);
    if (!so) return;
    persist(sos.map(s => s.id === id ? { ...s, voided: true } : s));
    logActivity(dispatch, `Cancelled Sales Order ${so.soNo}`, currentUser, { module:'salesorders', action:'delete' });
    showToast(`Sales Order ${so.soNo} cancelled`, 'error');
  }

  // Generate an AR invoice from this SO, pre-filling line items with
  // the remaining-to-invoice qty. This is the link between the sales
  // pipeline and the AR module — same shape the existing AR invoices use.
  function generateInvoice(so) {
    const remaining = (so.items || []).filter(l => Number(l.invoicedQty) < Number(l.orderedQty));
    if (remaining.length === 0) { showToast('All lines already fully invoiced', 'error'); return; }
    // The new invoice goes into the AR `invoices` collection with a
    // `salesOrderId` back-reference so the SO can show which invoices
    // it's been billed through. Quantity on the invoice = orderedQty -
    // invoicedQty for each line.
    const newInv = {
      id: generateId(),
      invoiceNo: '', // AR module assigns on save
      salesOrderId: so.id,
      salesOrderNo: so.soNo,
      client: so.client,
      clientCode: so.clientCode,
      projectRef: so.projectRef,
      date: new Date().toISOString().split('T')[0],
      dueDate: '',
      paymentTerms: 'Net 30',
      category: 'Other',
      currency: so.currency,
      fxRate: so.fxRate,
      items: remaining.map(l => ({
        id: generateId(),
        description: l.description,
        qty: (Number(l.orderedQty)||0) - (Number(l.invoicedQty)||0),
        unit: l.unit,
        unitPrice: l.unitPrice,
        total: ((Number(l.orderedQty)||0) - (Number(l.invoicedQty)||0)) * (Number(l.unitPrice)||0),
      })),
      whtRate: 5,
      ncdfRate: 0,
      notes: `Generated from Sales Order ${so.soNo}`,
      status: 'Draft',
      createdAt: new Date().toISOString(),
    };
    // Push to db.invoices as a Draft — the user can open the AR module,
    // review, and post from there. This keeps the SO module from
    // accidentally posting revenue without review.
    const nextInv = [...(db.invoices || []), newInv];
    dispatch({ type:'UPDATE_MODULE', mod:'invoices', data: nextInv });
    saveDBLocal({ ...db, invoices: nextInv, salesOrders: sos }, state.activity);
    logActivity(dispatch, `Generated AR invoice draft from Sales Order ${so.soNo}`, currentUser, { module:'salesorders', action:'create' });
    showToast(`Invoice draft created from ${so.soNo}. Open Invoices module to review and post.`, 'success');
  }

  // Helper used by the AR module: when an SO-linked invoice is posted,
  // the AR save path can call this to bump the SO's invoicedQty on each
  // line and roll the status forward. Exposed on window for now; in a
  // future refactor this would live in a shared module.
  function markLinesInvoiced(soId, lines) {
    const next = sos.map(s => {
      if (s.id !== soId) return s;
      const items = s.items.map((sl, i) => lines[i] ? { ...sl, invoicedQty: (Number(sl.invoicedQty)||0) + (Number(lines[i].qty)||0) } : sl);
      const allInvoiced = items.every(sl => Number(sl.invoicedQty) >= Number(sl.orderedQty));
      const anyInvoiced = items.some(sl => Number(sl.invoicedQty) > 0);
      let status = s.status;
      if (allInvoiced) status = 'Invoiced';
      else if (anyInvoiced) status = 'Partially Invoiced';
      return { ...s, items, status };
    });
    persist(next);
  }
  // Expose for cross-module calls (AR save path can call this)
  if (typeof window !== 'undefined') window.__sotBumpInvoice = markLinesInvoiced;

  // ── View: list ──
  const filtered = useMemo(() => {
    return sos.filter(s => !s.voided).filter(s => {
      const m = !filter || (s.soNo||'').toLowerCase().includes(filter.toLowerCase()) || (s.client||'').toLowerCase().includes(filter.toLowerCase()) || (s.projectRef||'').toLowerCase().includes(filter.toLowerCase());
      const ms = statusFilter === 'all' || s.status === statusFilter;
      return m && ms;
    });
  }, [sos, filter, statusFilter]);

  const stats = useMemo(() => {
    const open = sos.filter(s => !s.voided && ['Draft','Confirmed','Partially Invoiced'].includes(s.status));
    const invoiced = sos.filter(s => !s.voided && s.status === 'Invoiced');
    const totalValue = sos.filter(s => !s.voided).reduce((s, so) => s + (soTotals(so).ngn || 0), 0);
    const openValue = open.reduce((s, so) => s + (soTotals(so).ngn || 0), 0);
    return { total: sos.filter(s => !s.voided).length, open: open.length, invoiced: invoiced.length, totalValue, openValue };
  }, [sos]);

  if (tab === 'detail' && sel) {
    return <SODetail so={sel} C={C} inp={inp} onBack={() => { setSel(null); setTab('list'); }} onGenerateInvoice={() => generateInvoice(sel)} />;
  }

  if (tab === 'new' || modal === 'edit') {
    return <SOForm so={editing || emptySo()} setSo={setEditing} onSave={handleSave} onCancel={() => { setEditing(null); setTab('list'); setModal(null); }} C={C} inp={inp} currentUser={currentUser} />;
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Sales Orders</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Quote → Sales Order → Invoice progression · back-order tracking per line</div>
        </div>
        {perms.add && <Btn onClick={() => { setEditing({ ...emptySo(), soNo: nextSoNo(sos) }); setTab('new'); }}>+ New Sales Order</Btn>}
      </div>

      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <StatCard label="Total SOs"     value={stats.total}     accent={C.green} />
        <StatCard label="Open"          value={stats.open}      accent={C.info} />
        <StatCard label="Invoiced"      value={stats.invoiced}  accent={C.success} />
        <StatCard label="Open Value"    value={'₦'+(stats.openValue||0).toLocaleString('en-NG',{maximumFractionDigits:0})} sub="NGN equivalent" accent={C.amber} />
      </div>

      <Card padding="0">
        <div style={{ padding:'14px 20px', display:'flex', gap:8, alignItems:'center', borderBottom:'1px solid '+C.borderLight, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:200 }}>
            <SearchBar value={filter} onChange={setFilter} placeholder="Search SO no, client, project…" />
          </div>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{ ...inp, width:'auto' }}>
            <option value="all">All Statuses</option>
            {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <Btn variant="ghost" onClick={() => { setFilter(''); setStatusFilter('all'); }}>Reset</Btn>
        </div>
        {filtered.length === 0 ? (
          <EmptyState text="No sales orders found" sub="Create one to start the Quote → SO → Invoice pipeline" />
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:C.tableHeaderBg }}>
                  {['SO No','Date','Expected Delivery','Client','Project','Currency','Total (NGN eq.)','Status','Action'].map(h => <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontSize:10, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => {
                  const t = soTotals(s);
                  return (
                    <tr key={s.id} style={{ borderBottom:'1px solid '+C.borderLight, background: i%2===1 ? C.greenPale2 : 'transparent' }}>
                      <td style={{ padding:'8px 10px', fontFamily:'monospace', color:C.green, fontWeight:700 }}>{s.soNo}</td>
                      <td style={{ padding:'8px 10px' }}>{formatDate(s.date)}</td>
                      <td style={{ padding:'8px 10px' }}>{formatDate(s.expectedDelivery) || '—'}</td>
                      <td style={{ padding:'8px 10px', fontWeight:600 }}>{s.client}</td>
                      <td style={{ padding:'8px 10px', color:C.textMuted }}>{s.projectRef || '—'}</td>
                      <td style={{ padding:'8px 10px' }}>{s.currency}</td>
                      <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:700, color:C.amber }}>₦{(t.ngn||0).toLocaleString('en-NG',{maximumFractionDigits:0})}</td>
                      <td style={{ padding:'8px 10px' }}><STATUS_BADGE status={s.status} /></td>
                      <td style={{ padding:'8px 10px' }}>
                        <div style={{ display:'flex', gap:4 }}>
                          <Btn sm variant="ghost" onClick={() => { setSel(s); setTab('detail'); }}>View</Btn>
                          {perms.edit && <Btn sm variant="outline" onClick={() => { setEditing({ ...s }); setTab('new'); }}>Edit</Btn>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {confirm && <Confirm message="Cancel this Sales Order? It will be marked voided but kept for audit." onConfirm={() => { handleDelete(confirm); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

function SODetail({ so, C, inp, onBack, onGenerateInvoice }) {
  const t = soTotals(so);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
        <div>
          <Btn variant="ghost" onClick={onBack}>← Back to Sales Orders</Btn>
          <div style={{ fontSize:18, fontWeight:700, color:C.text, marginTop:6 }}>{so.soNo} · {so.client}</div>
          <div style={{ fontSize:12, color:C.textMuted }}>{so.projectRef || '—'} · Date {formatDate(so.date)} · Expected Delivery {formatDate(so.expectedDelivery) || '—'}</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <STATUS_BADGE status={so.status} />
          {so.status !== 'Cancelled' && so.status !== 'Invoiced' && so.status !== 'Closed' && (
            <Btn onClick={onGenerateInvoice}>📤 Generate AR Invoice</Btn>
          )}
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10 }}>
        <div style={{ padding:'10px 14px', background:C.greenPale, borderRadius:8, borderLeft:'4px solid '+C.amber }}>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>Subtotal ({so.currency})</div>
          <div style={{ fontSize:18, fontWeight:700, color:C.amber }}>{fmtFC(t.subtotal, so.currency)}</div>
          {so.currency !== 'NGN' && <div style={{ fontSize:11, color:C.textMuted }}>₦{(t.subtotal*so.fxRate).toLocaleString('en-NG',{maximumFractionDigits:0})}</div>}
        </div>
        <div style={{ padding:'10px 14px', background:C.greenPale, borderRadius:8, borderLeft:'4px solid '+C.info }}>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>VAT 7.5%</div>
          <div style={{ fontSize:18, fontWeight:700, color:C.info }}>{fmtFC(t.vat, so.currency)}</div>
        </div>
        <div style={{ padding:'10px 14px', background:C.greenPale, borderRadius:8, borderLeft:'4px solid '+C.danger }}>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>WHT 5% (deducted at invoice)</div>
          <div style={{ fontSize:18, fontWeight:700, color:C.danger }}>– {fmtFC(t.wht, so.currency)}</div>
        </div>
        <div style={{ padding:'10px 14px', background:C.greenPale, borderRadius:8, borderLeft:'4px solid '+C.success }}>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>Total (NGN eq.)</div>
          <div style={{ fontSize:18, fontWeight:700, color:C.success }}>₦{(t.ngn||0).toLocaleString('en-NG',{maximumFractionDigits:0})}</div>
        </div>
      </div>
      <Card>
        <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:10 }}>Line Items</div>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead>
            <tr style={{ background:C.greenPale }}>
              {['#','Description','Qty Ordered','Qty Invoiced','Back-Order','Unit','Unit Price','Line Total','Progress'].map(h => <th key={h} style={{ padding:'8px 10px', textAlign:'left', fontSize:10, fontWeight:700, color:C.textMid, textTransform:'uppercase' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {(so.items || []).map((l, i) => {
              const prog = soLineProgress(l);
              const backOrder = (Number(l.orderedQty)||0) - (Number(l.invoicedQty)||0);
              return (
                <tr key={l.id} style={{ borderBottom:'1px solid '+C.borderLight }}>
                  <td style={{ padding:'8px 10px' }}>{i+1}</td>
                  <td style={{ padding:'8px 10px' }}>{l.description}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>{l.orderedQty} {l.unit}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', color: l.invoicedQty>0?C.success:C.textMuted }}>{l.invoicedQty} {l.unit}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:700, color: backOrder>0?C.amber:C.success }}>{backOrder>0 ? `${backOrder} ${l.unit}` : '✓ Fully billed'}</td>
                  <td style={{ padding:'8px 10px', color:C.textMuted }}>{l.unit}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>{fmtFC(l.unitPrice, so.currency)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:600 }}>{fmtFC(((Number(l.qty)||0) * (Number(l.unitPrice)||0)), so.currency)}</td>
                  <td style={{ padding:'8px 10px', minWidth:140 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <div style={{ flex:1, background:C.greenPale, borderRadius:20, height:6 }}>
                        <div style={{ width:`${prog.pct}%`, height:'100%', background: prog.pct===100?C.success: prog.pct>0?C.amber:C.border, borderRadius:20 }} />
                      </div>
                      <span style={{ fontSize:10, fontWeight:600, color:C.textMid, minWidth:50, textAlign:'right' }}>{prog.label}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {so.notes && <div style={{ padding:14, background:C.bgAlt, borderRadius:8, fontSize:12, color:C.textMid }}>📝 <strong>Notes:</strong> {so.notes}</div>}
    </div>
  );
}

function SOForm({ so: initial, setSo, onSave, onCancel, C, inp, currentUser }) {
  const [f, setF] = useState(initial);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const setItem = (idx, k, v) => setF(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, [k]: v } : it) }));
  const clients = getClients().filter(c => c.status === 'Active');
  const projects = getProjects().filter(p => p.status === 'Active');
  const t = soTotals(f);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <Btn variant="ghost" onClick={onCancel}>← Cancel</Btn>
        <div style={{ fontSize:11, color:C.textMuted }}>{f.soNo || 'New Sales Order'}</div>
      </div>
      <Card>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
          <FG label="SO Number"><input style={{ ...inp, fontFamily:'monospace', fontWeight:700, color:C.green }} value={f.soNo||''} onChange={e=>set('soNo', e.target.value)} /></FG>
          <FG label="Order Date"><input type="date" style={inp} value={f.date||''} onChange={e=>set('date', e.target.value)} /></FG>
          <FG label="Expected Delivery"><input type="date" style={inp} value={f.expectedDelivery||''} onChange={e=>set('expectedDelivery', e.target.value)} /></FG>
          <FG label="Client *">
            <select style={inp} value={f.clientCode||''} onChange={e => { const c = clients.find(x => x.code === e.target.value); setF(p => ({ ...p, clientCode: e.target.value, client: c?.name || p.client, currency: c?.currency || p.currency, fxRate: c?.currency && c.currency !== 'NGN' ? (p.fxRate || 1500) : 1 })); }}>
              <option value="">— Select client —</option>
              {clients.map(c => <option key={c.id} value={c.code}>{c.name} — {c.code} ({c.currency})</option>)}
            </select>
          </FG>
          <FG label="Project Ref">
            <select style={inp} value={f.projectRef||''} onChange={e => set('projectRef', e.target.value)}>
              <option value="">—</option>
              {projects.map(p => <option key={p.id} value={p.code}>{p.code} — {p.name}</option>)}
            </select>
          </FG>
          <FG label="Status">
            <select style={inp} value={f.status||'Draft'} onChange={e=>set('status', e.target.value)}>
              {STATUS.map(s => <option key={s}>{s}</option>)}
            </select>
          </FG>
          <FG label="Currency">
            <select style={inp} value={f.currency||'NGN'} onChange={e => { setF(p => ({ ...p, currency: e.target.value, fxRate: e.target.value === 'NGN' ? 1 : (p.fxRate || 1500) })); }}>
              <option>NGN</option><option>USD</option><option>EUR</option><option>GBP</option>
            </select>
          </FG>
          <FG label="FX Rate (₦ per unit)"><input type="number" style={inp} value={f.fxRate||1} onChange={e=>set('fxRate', Number(e.target.value)||1)} disabled={f.currency==='NGN'} /></FG>
          <FG label="Notes" full><textarea style={{ ...inp, height:60 }} value={f.notes||''} onChange={e=>set('notes', e.target.value)} /></FG>
        </div>
      </Card>
      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Line Items</div>
          <Btn variant="ghost" sm onClick={() => setF(p => ({ ...p, items: [...p.items, { id: generateId(), description:'', qty:1, unit:'pcs', unitPrice:0, orderedQty:1, invoicedQty:0 }] }))}>+ Add Line</Btn>
        </div>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead><tr style={{ background:C.greenPale }}>
            {['Description','Qty','Unit','Unit Price','Line Total',''].map(h => <th key={h} style={{ padding:'6px 8px', textAlign:'left', fontSize:10, fontWeight:700, color:C.textMid, textTransform:'uppercase' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {f.items.map((it, i) => (
              <tr key={it.id} style={{ borderBottom:'1px solid '+C.borderLight }}>
                <td style={{ padding:'4px 6px' }}><input style={inp} value={it.description} onChange={e=>setItem(i,'description', e.target.value)} placeholder="Description" /></td>
                <td style={{ padding:'4px 6px' }}><input type="number" style={inp} value={it.orderedQty||it.qty||''} onChange={e=>setItem(i,'orderedQty', Number(e.target.value))} /></td>
                <td style={{ padding:'4px 6px' }}><input style={inp} value={it.unit||''} onChange={e=>setItem(i,'unit', e.target.value)} /></td>
                <td style={{ padding:'4px 6px' }}><input type="number" style={inp} value={it.unitPrice||''} onChange={e=>setItem(i,'unitPrice', Number(e.target.value))} /></td>
                <td style={{ padding:'4px 6px', textAlign:'right', fontWeight:600 }}>{fmtFC(((Number(it.orderedQty)||0) * (Number(it.unitPrice)||0)), f.currency)}</td>
                <td style={{ padding:'4px 6px', textAlign:'right' }}><button onClick={() => setF(p => ({ ...p, items: p.items.filter((_, j) => j !== i) }))} style={{ background:'transparent', border:'none', color:C.danger, cursor:'pointer', fontSize:14 }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:14, padding:'10px 14px', background:C.greenPale, borderRadius:8 }}>
          <div style={{ fontSize:12, color:C.textMid }}>Subtotal (excl. VAT/WHT — applied at invoice)</div>
          <div style={{ fontSize:18, fontWeight:700, color:C.amber }}>{fmtFC(t.subtotal, f.currency)} {f.currency !== 'NGN' && <span style={{ fontSize:12, color:C.textMuted, fontWeight:400 }}>· ₦{(t.subtotal*f.fxRate).toLocaleString('en-NG',{maximumFractionDigits:0})}</span>}</div>
        </div>
      </Card>
      <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn onClick={() => { setSo(f); setTimeout(onSave, 0); }}>💾 Save Sales Order</Btn>
      </div>
    </div>
  );
}
