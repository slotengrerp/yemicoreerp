// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — SAGE-STYLE FEATURES MODULE v2.0 (Tier 2)
//
// Six additional features that accountants use in Sage 200 Evolution:
//
//   11. Recurring Invoices (templates + auto-generate on schedule)
//   12. Bank Reconciliation UI (interactive match screen)
//   13. Prepayments & Accruals (auto-reversing journals)
//   14. Asset Disposal with gain/loss posting
//   15. Budget vs Actual reporting
//   16. Stock Take module (count sheet + variance posting)
//
// All features persist to new fields in db so the existing sync engine
// carries them to the cloud. Asset disposal auto-posts to the GL via the
// existing Accounting.jsx auto-post effect (extended to recognise disposal
// records). Prepayments/Accruals post a manual JE now + schedule a reversal
// JE for the next period.
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { showToast, formatDate, generateId } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { printHeader, PRINT_CSS, printBootstrap, openPrintWindow} from '../../utils/logo';
import { getClients, getClientByCode } from '../../utils/clientMaster';
import { BANK_ACCOUNTS } from '../../utils/financeConstants';
import { diffAndPush, pushOne } from '../../hooks/usePerRecordSync';

const uid   = () => generateId();
const today = () => new Date().toISOString().split('T')[0];
const year  = () => new Date().getFullYear();
const fmt   = n => '₦' + (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN  = n => (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Shared UI primitives (same style as SageReports.jsx)
function Btn({ children, onClick, variant='primary', sm, disabled, style={} }) {
  const { C } = useTheme();
  const V = {
    primary:{bg:C.green,co:'#fff',b:'none'},
    ghost:  {bg:'transparent',co:C.textMid,b:'1px solid '+C.border},
    danger: {bg:C.danger,co:'#fff',b:'none'},
    amber:  {bg:C.amber,co:'#fff',b:'none'},
    outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green},
  }[variant] || {};
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background:V.bg, color:V.co, border:V.b, borderRadius:7,
        padding:sm?'4px 11px':'7px 16px', fontSize:sm?11.5:13, fontWeight:500,
        cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1,
        display:'inline-flex', alignItems:'center', gap:5, whiteSpace:'nowrap', ...style }}>
      {children}
    </button>
  );
}
function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'18px 20px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}
function FG({ label, full, children }) {
  const { C } = useTheme();
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, gridColumn:full?'1/-1':undefined }}>
      <label style={{ fontSize:11, fontWeight:600, color:C.textMid }}>{label}</label>
      {children}
    </div>
  );
}
function Overlay({ children, onClose }) {
  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,0.62)',
        backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start',
        justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'100%', maxWidth:920, marginBottom:32 }}>{children}</div>
    </div>
  );
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
));

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT — Tier 2 tabbed launcher
// ════════════════════════════════════════════════════════════════════════════
export default function SageReports2() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const [tab, setTab] = useState('recurring');

  const TABS = [
    { id:'recurring',  label:'🔁 Recurring Invoices'        },
    { id:'bankrec',    label:'🏦 Bank Reconciliation'        },
    { id:'preaccr',    label:'📊 Prepayments & Accruals'     },
    { id:'disposal',   label:'🏗️ Asset Disposal'             },
    { id:'budget',     label:'💰 Budget vs Actual'           },
    { id:'stocktake',  label:'📦 Stock Take'                 },
  ];

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
      <div>
        <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Sage-Style Features — Tier 2</div>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>
          Six more daily-workflow features from Sage 200 Evolution
        </div>
      </div>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap', padding:'6px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:10 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{
              padding:'7px 13px', borderRadius:7, fontSize:12, fontWeight:600,
              cursor:'pointer', whiteSpace:'nowrap',
              background: tab===t.id ? C.green : 'transparent',
              color:      tab===t.id ? '#fff'   : C.textMid,
              border:     tab===t.id ? 'none'   : '1px solid '+C.border,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'recurring'  && <RecurringInvoicesTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'bankrec'    && <BankReconciliationTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'preaccr'    && <PrepaymentsAccrualsTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'disposal'   && <AssetDisposalTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'budget'     && <BudgetVsActualTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'stocktake'  && <StockTakeTab state={state} dispatch={dispatch} inp={inp} />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 11 — RECURRING INVOICES
// Templates that auto-generate invoices on a monthly/quarterly/yearly
// schedule. Stored in db.recurringInvoices. Click "Generate Now" creates
// the actual invoice in db.invoices.
// ════════════════════════════════════════════════════════════════════════════
function RecurringInvoicesTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const clients = useMemo(() => getClients().filter(c => c.status === 'Active'), []);
  const recurring = db.recurringInvoices || [];
  const invoices  = db.invoices || [];
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({
    clientCode:'', description:'', amount:'', whtRate:5,
    frequency:'Monthly', startDate:today(), endDate:'',
    paymentTerms:'Net 30', category:'Engineering Services', notes:'',
  });

  function saveRecurring(list) {
    diffAndPush('recurringInvoices', recurring, list); // 2026-07-29 full-app sync sweep
    const newDb = { ...db, recurringInvoices: list };
    dispatch({ type:'UPDATE_MODULE', mod:'recurringInvoices', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function handleSave() {
    if (!form.clientCode) { showToast('Select a customer', 'error'); return; }
    if (!form.description.trim()) { showToast('Description required', 'error'); return; }
    if (!Number(form.amount) || Number(form.amount) <= 0) { showToast('Enter a valid amount', 'error'); return; }
    const client = getClientByCode(form.clientCode);
    const tpl = {
      id: uid(),
      tplNo: `SLOT-REC-${year()}-${String(recurring.length + 1).padStart(4,'0')}`,
      clientCode: form.clientCode,
      clientName: client?.name || form.clientCode,
      description: form.description,
      amount: Number(form.amount),
      whtRate: Number(form.whtRate) || 0,
      frequency: form.frequency,
      startDate: form.startDate,
      endDate: form.endDate || '',
      paymentTerms: form.paymentTerms,
      category: form.category,
      notes: form.notes,
      lastGenerated: '',
      nextDue: form.startDate,
      status: 'Active',
      createdBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };
    const updated = [tpl, ...recurring];
    saveRecurring(updated);
    logActivity(dispatch, `Recurring invoice template ${tpl.tplNo} created for ${tpl.clientName} — ${fmt(tpl.amount)} ${tpl.frequency}`, currentUser);
    showToast(`Template ${tpl.tplNo} created`);
    setModal(null);
    setForm({ clientCode:'', description:'', amount:'', whtRate:5, frequency:'Monthly', startDate:today(), endDate:'', paymentTerms:'Net 30', category:'Engineering Services', notes:'' });
  }

  // Generate an actual invoice from a template — calculates the next due
  // date based on frequency, creates the invoice in db.invoices, updates
  // template.lastGenerated and template.nextDue.
  function generateNow(tpl) {
    const client = getClientByCode(tpl.clientCode);
    if (!client) { showToast('Customer not found in master', 'error'); return; }
    const amt = Number(tpl.amount) || 0;
    const whtAmt = Math.round(amt * (Number(tpl.whtRate) || 0) / 100);
    const vatAmt = Math.round(amt * 7.5 / 100);
    const netPayable = amt + vatAmt - whtAmt;
    const todayDate = today();
    // Due date = today + 30 days (Net 30) — simple default
    const due = new Date(); due.setDate(due.getDate() + 30);
    const dueDate = due.toISOString().split('T')[0];
    // Next invoice number
    const nums = invoices.map(x => parseInt((x.invoiceNo||'0').replace(/\D/g,''),10)).filter(Boolean);
    const nextNo = `SLOT-INV-${year()}-${String(nums.length ? Math.max(...nums)+1 : 1).padStart(4,'0')}`;
    const newInv = {
      id: uid(),
      invoiceNo: nextNo,
      clientCode: tpl.clientCode,
      client: tpl.clientName,
      clientAddress: client.address || '',
      category: tpl.category,
      date: todayDate,
      dueDate,
      paymentTerms: tpl.paymentTerms,
      currency: client.currency || 'NGN',
      fxRate: 1,
      items: [{ id: uid(), description: tpl.description, qty: 1, unit: 'service', unitPrice: amt, total: amt }],
      subtotal: amt, vatAmount: vatAmt, whtRate: tpl.whtRate, whtAmount: whtAmt, ncdfRate: 0, ncdfAmount: 0,
      total: amt + vatAmt, netPayable, ngnEquivalent: netPayable,
      status: 'Pending', paymentDate: '', paymentRef: '', receivedAmount: 0,
      notes: `Auto-generated from recurring template ${tpl.tplNo}. ${tpl.notes||''}`,
      recurringTplId: tpl.id,
      createdAt: new Date().toISOString(),
    };
    // Save invoice
    const newInvoices = [newInv, ...invoices];
    pushOne('invoices', newInv); // 2026-07-29 full-app sync sweep — one new record
    dispatch({ type:'UPDATE_MODULE', mod:'invoices', data: newInvoices });
    // Update template: lastGenerated = today, nextDue = next period
    const nextDue = computeNextDue(todayDate, tpl.frequency);
    const updatedTpl = { ...tpl, lastGenerated: todayDate, nextDue };
    const updatedTpls = recurring.map(t => t.id === tpl.id ? updatedTpl : t);
    pushOne('recurringInvoices', updatedTpl); // one edited record
    const newDb = { ...db, invoices: newInvoices, recurringInvoices: updatedTpls };
    saveDBLocal(newDb, state.activity);
    logActivity(dispatch, `Recurring invoice ${nextNo} generated from template ${tpl.tplNo} for ${tpl.clientName} — ${fmt(netPayable)}`, currentUser);
    showToast(`Invoice ${nextNo} created`);
  }

  function computeNextDue(fromDate, frequency) {
    const d = new Date(fromDate);
    if (frequency === 'Monthly')   d.setMonth(d.getMonth() + 1);
    else if (frequency === 'Quarterly') d.setMonth(d.getMonth() + 3);
    else if (frequency === 'Yearly')    d.setFullYear(d.getFullYear() + 1);
    else if (frequency === 'Weekly')    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  }

  function toggleStatus(tpl) {
    const updated = recurring.map(t => t.id === tpl.id ? { ...t, status: t.status === 'Active' ? 'Paused' : 'Active' } : t);
    saveRecurring(updated);
    showToast(`Template ${tpl.tplNo} ${tpl.status === 'Active' ? 'paused' : 'resumed'}`);
  }

  function deleteTpl(tpl) {
    if (!window.confirm(`Delete template ${tpl.tplNo}? Already-generated invoices are NOT affected.`)) return;
    saveRecurring(recurring.filter(t => t.id !== tpl.id));
    showToast('Template deleted');
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  // Templates due for generation (nextDue <= today and Active)
  const dueNow = recurring.filter(t => t.status === 'Active' && t.nextDue && new Date(t.nextDue) <= new Date(today() + 'T23:59:59'));

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Recurring Invoices</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Templates that auto-generate invoices on a schedule</div>
        </div>
        <Btn onClick={()=>setModal('add')}>+ New Template</Btn>
      </div>

      {dueNow.length > 0 && (
        <div style={{ padding:'12px 16px', background:'rgba(201,122,10,0.10)', border:'1px solid '+C.amber, borderRadius:10, marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.amber, marginBottom:6 }}>⏰ {dueNow.length} template(s) due for generation</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {dueNow.map(t => (
              <Btn key={t.id} sm variant="amber" onClick={()=>generateNow(t)}>
                Generate {t.tplNo} — {t.clientName} ({fmt(t.amount)})
              </Btn>
            ))}
          </div>
        </div>
      )}

      {recurring.length === 0 ? (
        <div style={{ padding:30, textAlign:'center', color:C.textMuted, fontSize:13 }}>No recurring invoice templates yet. Click "New Template" to create one for retainer clients (e.g. monthly NLNG support).</div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>
            <th style={th}>Template No</th><th style={th}>Customer</th><th style={th}>Description</th>
            <th style={{...th, textAlign:'right'}}>Amount</th><th style={th}>Frequency</th>
            <th style={th}>Last Gen.</th><th style={th}>Next Due</th><th style={th}>Status</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {recurring.map(t => (
              <tr key={t.id}>
                <td style={td}><b>{t.tplNo}</b></td>
                <td style={td}>{t.clientName}</td>
                <td style={td} title={t.description}>{t.description.length > 40 ? t.description.slice(0,40)+'…' : t.description}</td>
                <td style={{...td, textAlign:'right'}}><b>{fmt(t.amount)}</b></td>
                <td style={td}>{t.frequency}</td>
                <td style={td}>{t.lastGenerated ? formatDate(t.lastGenerated) : '—'}</td>
                <td style={td}>{t.nextDue ? formatDate(t.nextDue) : '—'}</td>
                <td style={td}>
                  <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600,
                    color: t.status === 'Active' ? C.green : C.textMuted,
                    background: t.status === 'Active' ? 'rgba(26,122,74,0.12)' : 'rgba(107,114,128,0.12)' }}>
                    {t.status}
                  </span>
                </td>
                <td style={td}>
                  <div style={{ display:'flex', gap:4 }}>
                    <Btn sm variant="outline" onClick={()=>generateNow(t)}>⚡ Generate</Btn>
                    <Btn sm variant="ghost" onClick={()=>toggleStatus(t)}>{t.status === 'Active' ? '⏸' : '▶'}</Btn>
                    <Btn sm variant="danger" onClick={()=>deleteTpl(t)}>✕</Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal === 'add' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Recurring Invoice Template</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FG label="Customer" full>
                <select value={form.clientCode} onChange={e=>setForm(f=>({...f, clientCode:e.target.value}))} style={inp}>
                  <option value="">— Select Customer —</option>
                  {clients.map(c => <option key={c.id} value={c.code}>{c.name} ({c.code})</option>)}
                </select>
              </FG>
              <FG label="Description (appears on each generated invoice)" full>
                <input value={form.description} onChange={e=>setForm(f=>({...f, description:e.target.value}))} placeholder="e.g. Monthly engineering support retainer" style={inp} />
              </FG>
              <FG label="Amount (NGN)"><input type="number" value={form.amount} onChange={e=>setForm(f=>({...f, amount:e.target.value}))} style={inp} /></FG>
              <FG label="WHT Rate (%)">
                <select value={form.whtRate} onChange={e=>setForm(f=>({...f, whtRate:e.target.value}))} style={inp}>
                  <option value="0">0% (none)</option><option value="5">5% (services)</option><option value="10">10% (professional)</option>
                </select>
              </FG>
              <FG label="Frequency">
                <select value={form.frequency} onChange={e=>setForm(f=>({...f, frequency:e.target.value}))} style={inp}>
                  <option>Weekly</option><option>Monthly</option><option>Quarterly</option><option>Yearly</option>
                </select>
              </FG>
              <FG label="Category">
                <select value={form.category} onChange={e=>setForm(f=>({...f, category:e.target.value}))} style={inp}>
                  {['Engineering Services','Procurement Services','Logistics','Consultancy','Maintenance','Project Management','Equipment Supply','Labour Supply','Other'].map(c => <option key={c}>{c}</option>)}
                </select>
              </FG>
              <FG label="Start Date (first generation)"><input type="date" value={form.startDate} onChange={e=>setForm(f=>({...f, startDate:e.target.value, nextDue:e.target.value}))} style={inp} /></FG>
              <FG label="End Date (optional — blank = ongoing)"><input type="date" value={form.endDate} onChange={e=>setForm(f=>({...f, endDate:e.target.value}))} style={inp} /></FG>
              <FG label="Payment Terms">
                <select value={form.paymentTerms} onChange={e=>setForm(f=>({...f, paymentTerms:e.target.value}))} style={inp}>
                  {['Net 7','Net 14','Net 30','Net 45','Net 60','Due on Receipt'].map(p => <option key={p}>{p}</option>)}
                </select>
              </FG>
              <FG label="Notes" full><textarea value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))} rows={2} style={{...inp, resize:'vertical'}} /></FG>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSave}>Save Template</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 12 — BANK RECONCILIATION UI
// Interactive screen: import (or manually enter) bank statement lines,
// match against cashbook entries (db.ap.payments + db.arReceipts), mark
// matched/unmatched, finalize. Persists reconciliation state in
// db.bankReconciliations.
// ════════════════════════════════════════════════════════════════════════════
function BankReconciliationTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const [bankCode, setBankCode] = useState('3003');
  const [stmtDate, setStmtDate] = useState(today());
  const [stmtBalance, setStmtBalance] = useState('');
  // Statement lines: manually entered or pasted from CSV
  const [stmtLines, setStmtLines] = useState([]);
  const [newLine, setNewLine] = useState({ date:'', description:'', amount:'', ref:'' });

  // Cashbook entries = AR receipts + AP payments for this bank account
  const cashbook = useMemo(() => {
    const out = [];
    (db.arReceipts || []).forEach(r => {
      if (r.voided) return;
      if (r.bankCode && r.bankCode !== bankCode) return;
      out.push({ id: r.id, type: 'AR Receipt', date: r.date, description: `Receipt from ${r.client || 'customer'}`, amount: Number(r.ngnEquivalent || r.amountReceived) || 0, ref: r.receiptNo || r.reference || '', matched: r.reconciled === true, source: r });
    });
    (db.ap?.payments || []).forEach(p => {
      if (p.voided) return;
      if (p.bankCode && p.bankCode !== bankCode) return;
      out.push({ id: p.id, type: 'AP Payment', date: p.date, description: `Payment to ${p.vendorName || p.vendor || 'supplier'}`, amount: -(Number(p.ngnEquivalent || p.amount) || 0), ref: p.paymentNo || p.reference || '', matched: p.reconciled === true, source: p });
    });
    return out.sort((a,b) => new Date(a.date) - new Date(b.date));
  }, [db.arReceipts, db.ap, bankCode]);

  const unmatchedCb = cashbook.filter(c => !c.matched);
  const unmatchedSt = stmtLines.filter(s => !s.matchedLineId);

  // Simple auto-match: same amount (within ₦1) + same date
  function autoMatch() {
    let matchCount = 0;
    const updatedLines = stmtLines.map(s => {
      if (s.matchedLineId) return s;
      // Find a cashbook entry with same absolute amount and same date
      const match = unmatchedCb.find(c => !c.matched && Math.abs(Math.abs(c.amount) - Math.abs(s.amount)) < 2 && c.date === s.date);
      if (match) {
        matchCount++;
        return { ...s, matchedLineId: match.id };
      }
      return s;
    });
    if (matchCount === 0) { showToast('No auto-matches found — try manual match', 'info'); return; }
    setStmtLines(updatedLines);
    showToast(`Auto-matched ${matchCount} line(s)`);
  }

  function manualMatch(stmtLineId, cbId) {
    setStmtLines(lines => lines.map(s => s.id === stmtLineId ? { ...s, matchedLineId: cbId } : s));
  }

  function unmatch(stmtLineId) {
    setStmtLines(lines => lines.map(s => s.id === stmtLineId ? { ...s, matchedLineId: null } : s));
  }

  function addLine() {
    if (!newLine.date || !newLine.amount || !newLine.description.trim()) { showToast('Fill date, description, amount', 'error'); return; }
    setStmtLines([...stmtLines, { id: uid(), ...newLine, amount: Number(newLine.amount), matchedLineId: null }]);
    setNewLine({ date:'', description:'', amount:'', ref:'' });
  }

  function clearAll() {
    if (!window.confirm('Clear all statement lines? Unsaved reconciliation will be lost.')) return;
    setStmtLines([]);
  }

  function finalize() {
    if (unmatchedSt.length > 0) { showToast(`${unmatchedSt.length} unmatched statement line(s) — reconcile before finalizing`, 'error'); return; }
    if (unmatchedCb.length > 0 && !window.confirm(`There are ${unmatchedCb.length} unmatched cashbook entries. These will be flagged as outstanding. Finalize anyway?`)) return;
    // Mark matched cashbook entries as reconciled
    const matchedCbIds = new Set(stmtLines.filter(s => s.matchedLineId).map(s => s.matchedLineId));
    const newReceipts = (db.arReceipts || []).map(r => matchedCbIds.has(r.id) ? { ...r, reconciled: true, reconciledDate: stmtDate } : r);
    const newPayments = (db.ap?.payments || []).map(p => matchedCbIds.has(p.id) ? { ...p, reconciled: true, reconciledDate: stmtDate } : p);
    const newAp = { ...(db.ap || {bills:[], payments:[]}), payments: newPayments };
    const newDb = { ...db, arReceipts: newReceipts, ap: newAp };
    // Save reconciliation record
    const recon = {
      id: uid(), date: stmtDate, bankCode,
      bankName: BANK_ACCOUNTS.find(b => b.code === bankCode)?.name || '',
      stmtBalance: Number(stmtBalance) || 0,
      matchedCount: stmtLines.filter(s => s.matchedLineId).length,
      unmatchedStmt: unmatchedSt.length,
      unmatchedCb: unmatchedCb.length,
      finalizedBy: currentUser?.name || 'Admin',
      finalizedAt: new Date().toISOString(),
    };
    const recList = [recon, ...(db.bankReconciliations || [])];
    const finalDb = { ...newDb, bankReconciliations: recList };
    // Per-record push — 2026-07-29 full-app sync sweep.
    diffAndPush('arReceipts', db.arReceipts, newReceipts);
    diffAndPush('apPayments', db.ap?.payments, newPayments);
    pushOne('bankReconciliations', recon); // one new record
    dispatch({ type:'UPDATE_MODULE', mod:'arReceipts', data: newReceipts });
    dispatch({ type:'UPDATE_MODULE', mod:'ap', data: newAp });
    dispatch({ type:'UPDATE_MODULE', mod:'bankReconciliations', data: recList });
    saveDBLocal(finalDb, state.activity);
    logActivity(dispatch, `Bank reconciliation finalized for ${recon.bankName} as at ${formatDate(stmtDate)} — ${recon.matchedCount} matched`, currentUser);
    showToast('✓ Bank reconciliation finalized');
    setStmtLines([]);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:14 }}>Bank Reconciliation</div>
      <div style={{ fontSize:11, color:C.textMuted, marginBottom:14 }}>
        Match bank statement lines against cashbook entries (AR receipts + AP payments for the selected bank). Mark matched, finalize.
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:18 }}>
        <FG label="Bank Account">
          <select value={bankCode} onChange={e=>setBankCode(e.target.value)} style={inp}>
            {BANK_ACCOUNTS.map(b => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
          </select>
        </FG>
        <FG label="Statement Date"><input type="date" value={stmtDate} onChange={e=>setStmtDate(e.target.value)} style={inp} /></FG>
        <FG label="Statement Closing Balance"><input type="number" value={stmtBalance} onChange={e=>setStmtBalance(e.target.value)} style={inp} /></FG>
      </div>

      {/* Add statement line */}
      <div style={{ padding:'12px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8, marginBottom:14 }}>
        <div style={{ fontSize:12, fontWeight:700, color:C.textMid, marginBottom:8 }}>Add Bank Statement Line</div>
        <div style={{ display:'grid', gridTemplateColumns:'120px 2fr 120px 1fr auto', gap:8, alignItems:'end' }}>
          <FG label="Date"><input type="date" value={newLine.date} onChange={e=>setNewLine(f=>({...f, date:e.target.value}))} style={inp} /></FG>
          <FG label="Description"><input value={newLine.description} onChange={e=>setNewLine(f=>({...f, description:e.target.value}))} style={inp} /></FG>
          <FG label="Amount"><input type="number" value={newLine.amount} onChange={e=>setNewLine(f=>({...f, amount:e.target.value}))} style={inp} /></FG>
          <FG label="Ref (optional)"><input value={newLine.ref} onChange={e=>setNewLine(f=>({...f, ref:e.target.value}))} style={inp} /></FG>
          <Btn onClick={addLine}>+ Add</Btn>
        </div>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:10 }}>
        <Btn variant="outline" onClick={autoMatch} disabled={stmtLines.length === 0}>⚡ Auto-match</Btn>
        <Btn variant="ghost" onClick={clearAll} disabled={stmtLines.length === 0}>Clear All</Btn>
        <Btn variant="primary" onClick={finalize} disabled={stmtLines.length === 0}>✓ Finalize Reconciliation</Btn>
      </div>

      {/* Statement lines */}
      <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginTop:14, marginBottom:6 }}>Statement Lines ({stmtLines.length})</div>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr><th style={th}>Date</th><th style={th}>Description</th><th style={{...th, textAlign:'right'}}>Amount</th><th style={th}>Ref</th><th style={th}>Matched To</th><th style={th}></th></tr></thead>
        <tbody>
          {stmtLines.length === 0 ? <tr><td style={td} colSpan={6} align="center"><i>No statement lines yet. Add lines above or paste from your bank statement.</i></td></tr> :
            stmtLines.map(s => {
              const matched = s.matchedLineId ? cashbook.find(c => c.id === s.matchedLineId) : null;
              return (
                <tr key={s.id} style={{ background: matched ? 'rgba(26,122,74,0.06)' : 'transparent' }}>
                  <td style={td}>{formatDate(s.date)}</td>
                  <td style={td}>{s.description}</td>
                  <td style={{...td, textAlign:'right', fontWeight:600}}>{fmt(s.amount)}</td>
                  <td style={td}>{s.ref || '—'}</td>
                  <td style={td}>{matched ? <span style={{ color:C.green }}>✓ {matched.type} — {matched.ref || matched.description}</span> :
                    <select value="" onChange={e=>e.target.value && manualMatch(s.id, e.target.value)} style={{ ...inp, padding:'3px 6px', fontSize:11 }}>
                      <option value="">— Select cashbook entry —</option>
                      {unmatchedCb.filter(c => Math.abs(Math.abs(c.amount) - Math.abs(s.amount)) < 100).map(c => (
                        <option key={c.id} value={c.id}>{c.type} {formatDate(c.date)} {fmt(Math.abs(c.amount))} — {c.description}</option>
                      ))}
                    </select>}
                  </td>
                  <td style={td}>{matched && <Btn sm variant="ghost" onClick={()=>unmatch(s.id)}>Unmatch</Btn>}</td>
                </tr>
              );
            })}
        </tbody>
      </table>

      {/* Cashbook summary */}
      <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginTop:18, marginBottom:6 }}>Cashbook Entries ({cashbook.length})</div>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr><th style={th}>Date</th><th style={th}>Type</th><th style={th}>Description</th><th style={{...th, textAlign:'right'}}>Amount</th><th style={th}>Ref</th><th style={th}>Status</th></tr></thead>
        <tbody>
          {cashbook.slice(0, 20).map(c => (
            <tr key={c.id} style={{ background: c.matched ? 'rgba(26,122,74,0.06)' : 'transparent' }}>
              <td style={td}>{formatDate(c.date)}</td>
              <td style={td}>{c.type}</td>
              <td style={td}>{c.description}</td>
              <td style={{...td, textAlign:'right', color: c.amount < 0 ? C.danger : C.green}}>{c.amount < 0 ? '-' : ''}{fmt(Math.abs(c.amount))}</td>
              <td style={td}>{c.ref || '—'}</td>
              <td style={td}>{c.matched ? <span style={{ color:C.green }}>✓ Reconciled</span> : <span style={{ color:C.amber }}>Unmatched</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cashbook.length > 20 && <div style={{ textAlign:'center', padding:8, color:C.textMuted, fontSize:11 }}>Showing first 20 of {cashbook.length}</div>}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 13 — PREPAYMENTS & ACCRUALS
// Auto-reversing journals. Post a manual JE now (e.g. Dr Insurance Expense /
// Cr Prepaid Insurance) and schedule the reversal for next period. The
// reversal is stored in db.prepayAccruals and surfaced to Accounting.jsx
// for posting on the scheduled date.
// ════════════════════════════════════════════════════════════════════════════
function PrepaymentsAccrualsTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const coa = state?.acctData?.coa || [];
  const journals = state?.acctData?.journals || [];
  const prepayAccruals = db.prepayAccruals || [];
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({
    type: 'Prepayment', description:'', amount:'',
    drCode:'', crCode:'', postingDate:today(), reversalDate:'',
    notes:'',
  });

  function savePrepay(list) {
    diffAndPush('prepayAccruals', prepayAccruals, list); // 2026-07-29 full-app sync sweep
    const newDb = { ...db, prepayAccruals: list };
    dispatch({ type:'UPDATE_MODULE', mod:'prepayAccruals', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function handleSave() {
    if (!form.description.trim()) { showToast('Description required', 'error'); return; }
    if (!Number(form.amount) || Number(form.amount) <= 0) { showToast('Enter valid amount', 'error'); return; }
    if (!form.drCode || !form.crCode) { showToast('Select both accounts', 'error'); return; }
    if (!form.reversalDate) { showToast('Reversal date required', 'error'); return; }
    const drAcc = coa.find(a => a.code === form.drCode);
    const crAcc = coa.find(a => a.code === form.crCode);
    if (!drAcc || !crAcc) { showToast('Account not found in COA', 'error'); return; }
    const amt = Number(form.amount);
    const paNo = `SLOT-PA-${year()}-${String(prepayAccruals.length + 1).padStart(4,'0')}`;
    const pa = {
      id: uid(),
      paNo,
      type: form.type, // 'Prepayment' or 'Accrual'
      description: form.description,
      amount: amt,
      drCode: form.drCode, drName: drAcc.name,
      crCode: form.crCode, crName: crAcc.name,
      postingDate: form.postingDate,
      reversalDate: form.reversalDate,
      notes: form.notes,
      status: 'Posted', // Posted → Reversed after reversal fires
      postedBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };
    // 1) Post the JE now (add to journals)
    const newJE = {
      id: `JE-PA-${pa.id}`,
      date: form.postingDate,
      ref: paNo,
      description: `${form.type}: ${form.description}`,
      source: 'prepay-accrual',
      sourceId: pa.id,
      lines: [{
        drCode: form.drCode, drName: drAcc.name,
        crCode: form.crCode, crName: crAcc.name,
        amount: amt, currency: 'NGN', fxRate: 1, fcAmount: amt,
        memo: form.description, costCentre: '',
      }],
    };
    const newJournals = [newJE, ...journals];
    dispatch({ type:'SET_ACCT', payload: { ...(state.acctData || {}), journals: newJournals } });
    saveDBLocal({ ...db, prepayAccruals: [pa, ...prepayAccruals] }, state.activity);
    // Save journals separately via the acctData persistence
    setTimeout(() => {
      try {
        const raw = localStorage.getItem('bc_accounting');
        const parsed = raw ? JSON.parse(raw) : {};
        const updated = { ...parsed, journals: newJournals };
        localStorage.setItem('bc_accounting', JSON.stringify(updated));
      } catch {}
    }, 100);
    savePrepay([pa, ...prepayAccruals]);
    logActivity(dispatch, `${form.type} ${paNo} posted — Dr ${drAcc.name} / Cr ${crAcc.name} for ${fmt(amt)} (reverses ${formatDate(form.reversalDate)})`, currentUser);
    showToast(`${form.type} ${paNo} posted — reversal scheduled for ${formatDate(form.reversalDate)}`);
    setModal(null);
    setForm({ type:'Prepayment', description:'', amount:'', drCode:'', crCode:'', postingDate:today(), reversalDate:'', notes:'' });
  }

  function postReversalNow(pa) {
    // Post the mirror-image reversal JE
    const revJE = {
      id: `JE-PA-REV-${pa.id}`,
      date: today(),
      ref: `${pa.paNo}-REV`,
      description: `Reversal: ${pa.type} ${pa.paNo} — ${pa.description}`,
      source: 'prepay-accrual',
      sourceId: pa.id,
      lines: [{
        drCode: pa.crCode, drName: pa.crName,  // swap Dr/Cr
        crCode: pa.drCode, crName: pa.drName,
        amount: pa.amount, currency: 'NGN', fxRate: 1, fcAmount: pa.amount,
        memo: `Reversal of ${pa.paNo}`, costCentre: '',
      }],
    };
    const newJournals = [revJE, ...journals];
    dispatch({ type:'SET_ACCT', payload: { ...(state.acctData || {}), journals: newJournals } });
    const updated = prepayAccruals.map(p => p.id === pa.id ? { ...p, status: 'Reversed', reversedDate: today() } : p);
    savePrepay(updated);
    setTimeout(() => {
      try {
        const raw = localStorage.getItem('bc_accounting');
        const parsed = raw ? JSON.parse(raw) : {};
        const updatedAcct = { ...parsed, journals: newJournals };
        localStorage.setItem('bc_accounting', JSON.stringify(updatedAcct));
      } catch {}
    }, 100);
    logActivity(dispatch, `Reversal posted for ${pa.paNo} — Dr ${pa.crName} / Cr ${pa.drName} for ${fmt(pa.amount)}`, currentUser);
    showToast(`Reversal posted for ${pa.paNo}`);
  }

  // Grouped COA for dropdowns
  const grouped = useMemo(() => {
    const map = {};
    coa.forEach(a => { (map[a.category] = map[a.category] || []).push(a); });
    return map;
  }, [coa]);

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const dueForReversal = prepayAccruals.filter(p => p.status === 'Posted' && p.reversalDate && new Date(p.reversalDate) <= new Date(today() + 'T23:59:59'));

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Prepayments & Accruals</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Auto-reversing journals — post now, reverse next period</div>
        </div>
        <Btn onClick={()=>setModal('add')}>+ New Prepayment / Accrual</Btn>
      </div>

      {dueForReversal.length > 0 && (
        <div style={{ padding:'12px 16px', background:'rgba(201,122,10,0.10)', border:'1px solid '+C.amber, borderRadius:10, marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.amber, marginBottom:6 }}>⏰ {dueForReversal.length} entry(ies) due for reversal</div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {dueForReversal.map(p => (
              <Btn key={p.id} sm variant="amber" onClick={()=>postReversalNow(p)}>
                Reverse {p.paNo} — {fmt(p.amount)}
              </Btn>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize:11, color:C.textMuted, marginBottom:14, padding:'10px 14px', background:'rgba(26,92,138,0.06)', border:'1px solid rgba(26,92,138,0.20)', borderRadius:8 }}>
        <b>How it works:</b> A prepayment (e.g. annual insurance paid upfront) posts Dr Insurance Expense / Cr Prepaid Insurance now. The reversal (Dr Prepaid / Cr Insurance Expense) is scheduled for next period — recognising the expense in the correct period. An accrual works the same way but in reverse: post the expense now (Dr Expense / Cr Accrued), reverse next period when the actual invoice arrives.
      </div>

      {prepayAccruals.length === 0 ? (
        <div style={{ padding:30, textAlign:'center', color:C.textMuted, fontSize:13 }}>No prepayments or accruals yet.</div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>
            <th style={th}>No</th><th style={th}>Type</th><th style={th}>Description</th>
            <th style={th}>Dr → Cr</th><th style={{...th, textAlign:'right'}}>Amount</th>
            <th style={th}>Posted</th><th style={th}>Reversal Date</th><th style={th}>Status</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {prepayAccruals.map(p => (
              <tr key={p.id}>
                <td style={td}><b>{p.paNo}</b></td>
                <td style={td}>{p.type}</td>
                <td style={td}>{p.description}</td>
                <td style={td} title={`${p.drName} → ${p.crName}`}><span style={{ fontSize:11 }}>{p.drName.slice(0,18)} → {p.crName.slice(0,18)}</span></td>
                <td style={{...td, textAlign:'right'}}>{fmt(p.amount)}</td>
                <td style={td}>{formatDate(p.postingDate)}</td>
                <td style={td}>{formatDate(p.reversalDate)}</td>
                <td style={td}>
                  <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600,
                    color: p.status === 'Reversed' ? C.green : (p.reversalDate && new Date(p.reversalDate) <= new Date(today()+'T23:59:59') ? C.amber : C.textMid),
                    background: p.status === 'Reversed' ? 'rgba(26,122,74,0.12)' : 'rgba(107,114,128,0.12)' }}>
                    {p.status}
                  </span>
                </td>
                <td style={td}>{p.status === 'Posted' && <Btn sm variant="outline" onClick={()=>postReversalNow(p)}>Reverse Now</Btn>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal === 'add' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Prepayment / Accrual</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FG label="Type">
                <select value={form.type} onChange={e=>setForm(f=>({...f, type:e.target.value}))} style={inp}>
                  <option>Prepayment</option><option>Accrual</option>
                </select>
              </FG>
              <FG label="Amount"><input type="number" value={form.amount} onChange={e=>setForm(f=>({...f, amount:e.target.value}))} style={inp} /></FG>
              <FG label="Description" full><input value={form.description} onChange={e=>setForm(f=>({...f, description:e.target.value}))} placeholder="e.g. Annual insurance — Jan 2026" style={inp} /></FG>
              <FG label="Debit Account">
                <select value={form.drCode} onChange={e=>setForm(f=>({...f, drCode:e.target.value}))} style={inp}>
                  <option value="">— Select —</option>
                  {Object.entries(grouped).sort().map(([cat, accts]) => (
                    <optgroup key={cat} label={cat}>
                      {accts.sort((a,b)=>a.code.localeCompare(b.code)).map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </FG>
              <FG label="Credit Account">
                <select value={form.crCode} onChange={e=>setForm(f=>({...f, crCode:e.target.value}))} style={inp}>
                  <option value="">— Select —</option>
                  {Object.entries(grouped).sort().map(([cat, accts]) => (
                    <optgroup key={cat} label={cat}>
                      {accts.sort((a,b)=>a.code.localeCompare(b.code)).map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </FG>
              <FG label="Posting Date"><input type="date" value={form.postingDate} onChange={e=>setForm(f=>({...f, postingDate:e.target.value}))} style={inp} /></FG>
              <FG label="Reversal Date"><input type="date" value={form.reversalDate} onChange={e=>setForm(f=>({...f, reversalDate:e.target.value}))} style={inp} /></FG>
              <FG label="Notes" full><textarea value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))} rows={2} style={{...inp, resize:'vertical'}} /></FG>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSave}>Post Journal + Schedule Reversal</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 14 — ASSET DISPOSAL WITH GAIN/LOSS POSTING
// Sell or dispose of a fixed asset. Computes gain/loss = proceeds − NBV.
// Posts: Dr Bank (proceeds) / Dr Accumulated Depr (clear) / Cr Asset Cost / Cr Gain on Disposal (or Dr Loss on Disposal)
// ════════════════════════════════════════════════════════════════════════════
function AssetDisposalTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const assets = db.fixedassets || [];
  const journals = state?.acctData?.journals || [];
  const disposals = db.assetDisposals || [];
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ assetId:'', disposalDate:today(), proceeds:'', method:'Sale', notes:'' });

  // Compute current NBV for an asset (cost − accumulated depreciation posted)
  function assetNBV(asset) {
    if (asset.voided) return 0;
    const cost = Number(asset.cost) || 0;
    const accumDepr = (asset.depreciationPosted || []).reduce((s, d) => s + (Number(d.amount) || 0), 0);
    return cost - accumDepr;
  }

  function handleSave() {
    if (!form.assetId) { showToast('Select an asset', 'error'); return; }
    const asset = assets.find(a => a.id === form.assetId);
    if (!asset) { showToast('Asset not found', 'error'); return; }
    if (asset.status === 'Disposed') { showToast('Asset already disposed', 'error'); return; }
    const proceeds = Number(form.proceeds) || 0;
    const nbv = assetNBV(asset);
    const gainLoss = proceeds - nbv; // positive = gain, negative = loss

    const dispNo = `SLOT-DISP-${year()}-${String(disposals.length + 1).padStart(4,'0')}`;
    const disp = {
      id: uid(),
      dispNo,
      assetId: asset.id,
      assetCode: asset.code || asset.assetCode || '',
      assetName: asset.name || asset.description || 'Asset',
      category: asset.category,
      cost: Number(asset.cost) || 0,
      accumDepr: (asset.depreciationPosted || []).reduce((s, d) => s + (Number(d.amount) || 0), 0),
      nbv,
      proceeds,
      gainLoss,
      disposalDate: form.disposalDate,
      method: form.method,
      notes: form.notes,
      postedBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };

    // Build the disposal JE — multi-line:
    //   Dr Bank (proceeds)
    //   Dr Accumulated Depreciation (clear the accum depr balance)
    //   Cr Asset Cost (clear the original cost)
    //   Cr Gain on Disposal (if gain > 0) OR Dr Loss on Disposal (if loss < 0)
    // Account 4500 = Other Income (used as gain), 9100 = Loss on Exchange/Disposal
    // (Note: 9100 is "Loss on Exchange" — for a proper disposal-loss account
    // the COA would need a dedicated code. Using 9100 as the closest existing.)
    const lines = [];
    // Dr Bank (proceeds)
    lines.push({ drCode: '3003', drName: 'Access Bank (Naira)', crCode: '', crName: '', amount: proceeds, memo: `Disposal proceeds — ${disp.dispNo}` });
    // Dr Accumulated Depreciation
    if (disp.accumDepr > 0) {
      // Find the asset's accumulated depreciation account (typically 200X02)
      // Simplification: use category-based mapping
      const accumAcct = accumDeprAccount(asset.category);
      lines.push({ drCode: accumAcct.code, drName: accumAcct.name, crCode: '', crName: '', amount: disp.accumDepr, memo: `Clear accumulated depreciation on disposal` });
    }
    // Cr Asset Cost (clear original cost)
    const costAcct = costAccount(asset.category);
    lines.push({ drCode: '', drName: '', crCode: costAcct.code, crName: costAcct.name, amount: disp.cost, memo: `Clear asset cost on disposal` });
    // Cr Gain / Dr Loss
    if (gainLoss > 0) {
      lines.push({ drCode: '', drName: '', crCode: '4500', crName: 'Other Income (Gain on Disposal)', amount: gainLoss, memo: `Gain on disposal of ${asset.name}` });
    } else if (gainLoss < 0) {
      lines.push({ drCode: '9100', drName: 'Loss on Disposal', crCode: '', crName: '', amount: Math.abs(gainLoss), memo: `Loss on disposal of ${asset.name}` });
    }

    // Build balanced journal lines using the paired-dr-cr format Accounting.jsx expects
    // We need to convert the multi-line above into balanced dr/cr pairs.
    // Approach: post as separate journal entries — one per pair.
    // Simpler: build a single multi-line JE using the format the GL detail report understands.
    // For compatibility with the existing journal format (which uses paired Dr/Cr lines),
    // we'll create multiple journal entries — one per balanced pair.
    const jePairs = [];
    if (proceeds > 0) {
      jePairs.push({
        id: `JE-DISP-${disp.id}-PROCEEDS`,
        date: form.disposalDate, ref: disp.dispNo,
        description: `Disposal proceeds — ${asset.name} (${disp.dispNo})`,
        source: 'asset-disposal', sourceId: disp.id,
        lines: [{ drCode: '3003', drName: 'Access Bank (Naira)', crCode: costAcct.code, crName: costAcct.name, amount: proceeds, currency:'NGN', fxRate:1, fcAmount: proceeds, memo: `Proceeds from disposal of ${asset.name}`, costCentre: '' }],
      });
    }
    if (disp.accumDepr > 0) {
      const accumAcct = accumDeprAccount(asset.category);
      jePairs.push({
        id: `JE-DISP-${disp.id}-DEPR`,
        date: form.disposalDate, ref: disp.dispNo,
        description: `Clear accumulated depreciation — ${asset.name} (${disp.dispNo})`,
        source: 'asset-disposal', sourceId: disp.id,
        lines: [{ drCode: accumAcct.code, drName: accumAcct.name, crCode: costAcct.code, crName: costAcct.name, amount: disp.accumDepr, currency:'NGN', fxRate:1, fcAmount: disp.accumDepr, memo: `Clear accumulated depreciation`, costCentre: '' }],
      });
    }
    if (gainLoss > 0) {
      jePairs.push({
        id: `JE-DISP-${disp.id}-GAIN`,
        date: form.disposalDate, ref: disp.dispNo,
        description: `Gain on disposal — ${asset.name} (${disp.dispNo})`,
        source: 'asset-disposal', sourceId: disp.id,
        lines: [{ drCode: costAcct.code, drName: costAcct.name, crCode: '4500', crName: 'Other Income (Gain on Disposal)', amount: gainLoss, currency:'NGN', fxRate:1, fcAmount: gainLoss, memo: `Gain on disposal`, costCentre: '' }],
      });
    } else if (gainLoss < 0) {
      jePairs.push({
        id: `JE-DISP-${disp.id}-LOSS`,
        date: form.disposalDate, ref: disp.dispNo,
        description: `Loss on disposal — ${asset.name} (${disp.dispNo})`,
        source: 'asset-disposal', sourceId: disp.id,
        lines: [{ drCode: '9100', drName: 'Loss on Disposal', crCode: costAcct.code, crName: costAcct.name, amount: Math.abs(gainLoss), currency:'NGN', fxRate:1, fcAmount: Math.abs(gainLoss), memo: `Loss on disposal`, costCentre: '' }],
      });
    }

    // Save JE pairs to journals
    const newJournals = [...jePairs, ...journals];
    dispatch({ type:'SET_ACCT', payload: { ...(state.acctData || {}), journals: newJournals } });
    setTimeout(() => {
      try {
        const raw = localStorage.getItem('bc_accounting');
        const parsed = raw ? JSON.parse(raw) : {};
        const updatedAcct = { ...parsed, journals: newJournals };
        localStorage.setItem('bc_accounting', JSON.stringify(updatedAcct));
      } catch {}
    }, 100);

    // Mark asset as Disposed
    const newAssets = assets.map(a => a.id === asset.id ? { ...a, status: 'Disposed', disposalDate: form.disposalDate, disposalRef: disp.dispNo, voided: true } : a);
    // Save disposal record
    const newDisposals = [disp, ...disposals];
    const newDb = { ...db, fixedassets: newAssets, assetDisposals: newDisposals };
    diffAndPush('fixedassets', assets, newAssets); // 2026-07-29 full-app sync sweep
    pushOne('assetDisposals', disp); // one new record
    dispatch({ type:'UPDATE_MODULE', mod:'fixedassets', data: newAssets });
    dispatch({ type:'UPDATE_MODULE', mod:'assetDisposals', data: newDisposals });
    saveDBLocal(newDb, state.activity);
    logActivity(dispatch, `Asset disposed: ${asset.name} — NBV ${fmt(nbv)}, proceeds ${fmt(proceeds)}, ${gainLoss >= 0 ? 'gain' : 'loss'} ${fmt(Math.abs(gainLoss))} (${disp.dispNo})`, currentUser);
    showToast(`Asset disposed — ${gainLoss >= 0 ? 'Gain' : 'Loss'} of ${fmt(Math.abs(gainLoss))} posted to GL`);
    setModal(null);
    setForm({ assetId:'', disposalDate:today(), proceeds:'', method:'Sale', notes:'' });
  }

  // Map asset category → cost account and accumulated depreciation account
  function costAccount(category) {
    const map = {
      'Building':                  { code:'200101', name:'Building — Cost' },
      'Plant/Machineries':         { code:'200201', name:'Plant/Machineries — Cost' },
      'Motor Vehicle':             { code:'200301', name:'Motor Vehicle — Cost' },
      'Office and Safety Equipments': { code:'200401', name:'Office & Safety Equipment — Cost' },
      'Furnitures/Fittings/Caravans': { code:'200501', name:'Furniture/Fittings/Caravans — Cost' },
    };
    return map[category] || { code:'200201', name:'Plant/Machineries — Cost' };
  }
  function accumDeprAccount(category) {
    const map = {
      'Building':                  { code:'200102', name:'Building — Accumulated Depreciation' },
      'Plant/Machineries':         { code:'200202', name:'Plant/Machineries — Accumulated Depreciation' },
      'Motor Vehicle':             { code:'200302', name:'Motor Vehicle — Accumulated Depreciation' },
      'Office and Safety Equipments': { code:'200402', name:'Office & Safety Equipment — Accumulated Depreciation' },
      'Furnitures/Fittings/Caravans': { code:'200502', name:'Furniture/Fittings/Caravans — Accumulated Depreciation' },
    };
    return map[category] || { code:'200202', name:'Plant/Machineries — Accumulated Depreciation' };
  }

  const eligibleAssets = assets.filter(a => !a.voided && a.status !== 'Disposed');
  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const totalGain = disposals.filter(d => d.gainLoss > 0).reduce((s, d) => s + d.gainLoss, 0);
  const totalLoss = disposals.filter(d => d.gainLoss < 0).reduce((s, d) => s + Math.abs(d.gainLoss), 0);

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Asset Disposal</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Sell or dispose of a fixed asset — gain/loss auto-posted to GL</div>
        </div>
        <Btn onClick={()=>setModal('add')}>+ New Disposal</Btn>
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:14 }}>
        <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Total Disposals</div>
          <div style={{ fontSize:17, fontWeight:700, color:C.text }}>{disposals.length}</div>
        </div>
        <div style={{ flex:1, padding:'10px 14px', background:'rgba(26,122,74,0.10)', border:'1px solid '+C.green, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Total Gains</div>
          <div style={{ fontSize:17, fontWeight:700, color:C.green }}>{fmt(totalGain)}</div>
        </div>
        <div style={{ flex:1, padding:'10px 14px', background:'rgba(192,57,43,0.10)', border:'1px solid '+C.danger, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Total Losses</div>
          <div style={{ fontSize:17, fontWeight:700, color:C.danger }}>{fmt(totalLoss)}</div>
        </div>
      </div>

      <div style={{ fontSize:11, color:C.textMuted, marginBottom:14, padding:'10px 14px', background:'rgba(26,92,138,0.06)', border:'1px solid rgba(26,92,138,0.20)', borderRadius:8 }}>
        <b>GL impact:</b> Dr Bank (proceeds) · Dr Accumulated Depreciation (clear) · Cr Asset Cost (clear) · Cr Gain on Disposal (4500) OR Dr Loss on Disposal (9100). Gain/Loss = Proceeds − Net Book Value.
      </div>

      {disposals.length === 0 ? (
        <div style={{ padding:30, textAlign:'center', color:C.textMuted, fontSize:13 }}>No disposals recorded yet.</div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>
            <th style={th}>Disposal No</th><th style={th}>Date</th><th style={th}>Asset</th>
            <th style={{...th, textAlign:'right'}}>Cost</th><th style={{...th, textAlign:'right'}}>Accum. Depr</th>
            <th style={{...th, textAlign:'right'}}>NBV</th><th style={{...th, textAlign:'right'}}>Proceeds</th>
            <th style={{...th, textAlign:'right'}}>Gain/(Loss)</th><th style={th}>Method</th>
          </tr></thead>
          <tbody>
            {disposals.map(d => (
              <tr key={d.id}>
                <td style={td}><b>{d.dispNo}</b></td>
                <td style={td}>{formatDate(d.disposalDate)}</td>
                <td style={td}>{d.assetName}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(d.cost)}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(d.accumDepr)}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(d.nbv)}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(d.proceeds)}</td>
                <td style={{...td, textAlign:'right', fontWeight:700, color: d.gainLoss >= 0 ? C.green : C.danger}}>{d.gainLoss >= 0 ? '+' : '-'}{fmt(Math.abs(d.gainLoss))}</td>
                <td style={td}>{d.method}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal === 'add' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>Dispose of Asset</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FG label="Asset" full>
                <select value={form.assetId} onChange={e=>{
                  const a = assets.find(x => x.id === e.target.value);
                  setForm(f => ({ ...f, assetId: e.target.value, proceeds: a ? String(assetNBV(a)) : '' }));
                }} style={inp}>
                  <option value="">— Select Asset —</option>
                  {eligibleAssets.map(a => (
                    <option key={a.id} value={a.id}>{a.name || a.description} — Cost {fmt(Number(a.cost)||0)}, NBV {fmt(assetNBV(a))}</option>
                  ))}
                </select>
              </FG>
              <FG label="Disposal Date"><input type="date" value={form.disposalDate} onChange={e=>setForm(f=>({...f, disposalDate:e.target.value}))} style={inp} /></FG>
              <FG label="Disposal Method">
                <select value={form.method} onChange={e=>setForm(f=>({...f, method:e.target.value}))} style={inp}>
                  <option>Sale</option><option>Scrap</option><option>Donation</option><option>Write-off</option>
                </select>
              </FG>
              <FG label="Proceeds (NGN)"><input type="number" value={form.proceeds} onChange={e=>setForm(f=>({...f, proceeds:e.target.value}))} style={inp} /></FG>
              <FG label="Notes" full><textarea value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))} rows={2} style={{...inp, resize:'vertical'}} /></FG>
            </div>
            {form.assetId && (() => {
              const a = assets.find(x => x.id === form.assetId);
              if (!a) return null;
              const nbv = assetNBV(a);
              const proceeds = Number(form.proceeds) || 0;
              const gl = proceeds - nbv;
              return (
                <div style={{ marginTop:12, padding:12, background: gl >= 0 ? 'rgba(26,122,74,0.10)' : 'rgba(192,57,43,0.10)', border:'1px solid '+(gl >= 0 ? C.green : C.danger), borderRadius:8, fontSize:12.5 }}>
                  <b>Preview:</b> NBV {fmt(nbv)} − Proceeds {fmt(proceeds)} = <b style={{ color: gl >= 0 ? C.green : C.danger }}>{gl >= 0 ? 'Gain' : 'Loss'} of {fmt(Math.abs(gl))}</b>
                </div>
              );
            })()}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSave}>Post Disposal</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 15 — BUDGET VS ACTUAL REPORTING
// Set annual budgets per GL account, compare against actual movement.
// Stored in db.budgets as [{ year, accountCode, accountName, amount, jan, feb, ... }] .
// ════════════════════════════════════════════════════════════════════════════
function BudgetVsActualTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const coa = state?.acctData?.coa || [];
  const journals = state?.acctData?.journals || [];
  const budgets = db.budgets || [];
  const [budgetYear, setBudgetYear] = useState(year());
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ accountCode:'', amount:'', jan:'', feb:'', mar:'', apr:'', may:'', jun:'', jul:'', aug:'', sep:'', oct:'', nov:'', dec:'' });

  const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

  // Actual movement per account for the year
  const actuals = useMemo(() => {
    const map = {};
    journals.forEach(je => {
      if (!je.date || !je.date.startsWith(String(budgetYear))) return;
      (je.lines || []).forEach(line => {
        const amt = Number(line.amount) || 0;
        const month = MONTHS[new Date(je.date).getMonth()];
        // Dr-normal accounts: actual = dr - cr. Cr-normal: actual = cr - dr.
        // For budget comparison we use absolute movement in the natural direction.
        const acc = coa.find(a => a.code === line.drCode) || coa.find(a => a.code === line.crCode);
        if (!acc) return;
        if (!map[acc.code]) map[acc.code] = { code: acc.code, name: acc.name, type: acc.type, normalBal: acc.normalBal, total: 0, months: {} };
        if (line.drCode === acc.code) {
          map[acc.code].total += acc.normalBal === 'Dr' ? amt : -amt;
          map[acc.code].months[month] = (map[acc.code].months[month] || 0) + (acc.normalBal === 'Dr' ? amt : -amt);
        }
        if (line.crCode === acc.code) {
          map[acc.code].total += acc.normalBal === 'Cr' ? amt : -amt;
          map[acc.code].months[month] = (map[acc.code].months[month] || 0) + (acc.normalBal === 'Cr' ? amt : -amt);
        }
      });
    });
    return map;
  }, [journals, coa, budgetYear]);

  function saveBudgets(list) {
    diffAndPush('budgets', budgets, list); // 2026-07-29 full-app sync sweep
    const newDb = { ...db, budgets: list };
    dispatch({ type:'UPDATE_MODULE', mod:'budgets', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function handleSave() {
    if (!form.accountCode) { showToast('Select an account', 'error'); return; }
    const acc = coa.find(a => a.code === form.accountCode);
    if (!acc) { showToast('Account not found', 'error'); return; }
    const total = Number(form.amount) || 0;
    if (total <= 0) { showToast('Enter a valid annual budget', 'error'); return; }
    // Auto-distribute across months if monthly figures not provided
    const monthly = {};
    let monthlySum = 0;
    MONTHS.forEach(m => { monthly[m] = Number(form[m]) || 0; monthlySum += monthly[m]; });
    if (monthlySum === 0) {
      // Even distribution
      const even = Math.round(total / 12);
      MONTHS.forEach((m, i) => { monthly[m] = (i === 11) ? (total - even * 11) : even; });
    }
    // Replace existing budget for this account+year
    const existing = budgets.filter(b => !(b.accountCode === form.accountCode && b.year === budgetYear));
    const newBudget = {
      id: uid(),
      year: budgetYear,
      accountCode: form.accountCode,
      accountName: acc.name,
      accountType: acc.type,
      amount: total,
      ...monthly,
      setBy: currentUser?.name || 'Admin',
      setAt: new Date().toISOString(),
    };
    saveBudgets([newBudget, ...existing]);
    logActivity(dispatch, `Budget set for ${acc.name} ${budgetYear}: ${fmt(total)}`, currentUser);
    showToast(`Budget saved for ${acc.name}`);
    setModal(null);
    setForm({ accountCode:'', amount:'', jan:'', feb:'', mar:'', apr:'', may:'', jun:'', jul:'', aug:'', sep:'', oct:'', nov:'', dec:'' });
  }

  function deleteBudget(b) {
    if (!window.confirm(`Delete budget for ${b.accountName} (${b.year})?`)) return;
    saveBudgets(budgets.filter(x => x.id !== b.id));
    showToast('Budget deleted');
  }

  function printBudget() {
    const rows = budgets.filter(b => b.year === budgetYear).map(b => {
      const actual = actuals[b.accountCode]?.total || 0;
      const var_ = b.amount - actual;
      const pct = b.amount > 0 ? Math.round((actual / b.amount) * 100) : 0;
      return `
        <tr>
          <td>${esc(b.accountCode)}</td>
          <td>${esc(b.accountName)}</td>
          <td style="text-align:right">${fmtN(b.amount)}</td>
          <td style="text-align:right">${fmtN(actual)}</td>
          <td style="text-align:right;color:${var_>=0?'#1A5C2A':'#C0392B'}">${fmtN(var_)}</td>
          <td style="text-align:center">${pct}%</td>
        </tr>`;
    }).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><title>Budget vs Actual — ${budgetYear}</title>
      <style>${PRINT_CSS}
      .bva-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 6px}
      .bva-sub{text-align:center;font-size:11.5px;color:#3A5040;margin-bottom:14px}
      table.bva{width:100%;border-collapse:collapse;margin:10px 0}
      table.bva th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
      table.bva td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11.5px}
      </style></head><body>
      ${printHeader('BUDGET VS ACTUAL', formatDate(today()))}
      <div class="bva-title">BUDGET VS ACTUAL REPORT</div>
      <div class="bva-sub">For the year ${budgetYear}</div>
      <table class="bva"><thead><tr><th>Code</th><th>Account</th><th style="text-align:right">Budget</th><th style="text-align:right">Actual</th><th style="text-align:right">Variance</th><th style="text-align:center">Used %</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#182A1C;padding:14px">No budgets set</td></tr>'}</tbody>
      </table>
      ${printBootstrap({landscape:true})}
      </body></html>`);
  }

  const grouped = useMemo(() => {
    const map = {};
    coa.filter(a => a.type === 'Revenue' || a.type === 'Expense').forEach(a => { (map[a.category] = map[a.category] || []).push(a); });
    return map;
  }, [coa]);

  const yearBudgets = budgets.filter(b => b.year === budgetYear);
  const totalBudget = yearBudgets.reduce((s, b) => s + b.amount, 0);
  const totalActual = yearBudgets.reduce((s, b) => s + (actuals[b.accountCode]?.total || 0), 0);
  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Budget vs Actual</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Set annual budgets per GL account, compare against actual movement</div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <Btn variant="ghost" onClick={printBudget} disabled={yearBudgets.length === 0}>🖨️ Print</Btn>
          <Btn onClick={()=>setModal('add')}>+ Set Budget</Btn>
        </div>
      </div>

      <FG label="Year"><input type="number" value={budgetYear} onChange={e=>setBudgetYear(Number(e.target.value)||year())} style={{ ...inp, maxWidth:140 }} /></FG>

      <div style={{ display:'flex', gap:10, marginTop:14, marginBottom:14 }}>
        <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Total Budget</div>
          <div style={{ fontSize:17, fontWeight:700, color:C.text }}>{fmt(totalBudget)}</div>
        </div>
        <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Total Actual</div>
          <div style={{ fontSize:17, fontWeight:700, color:C.green }}>{fmt(totalActual)}</div>
        </div>
        <div style={{ flex:1, padding:'10px 14px', background: totalBudget - totalActual >= 0 ? 'rgba(26,122,74,0.10)' : 'rgba(192,57,43,0.10)', border:'1px solid '+(totalBudget - totalActual >= 0 ? C.green : C.danger), borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Variance</div>
          <div style={{ fontSize:17, fontWeight:700, color: totalBudget - totalActual >= 0 ? C.green : C.danger }}>{fmt(totalBudget - totalActual)}</div>
        </div>
      </div>

      {yearBudgets.length === 0 ? (
        <div style={{ padding:30, textAlign:'center', color:C.textMuted, fontSize:13 }}>No budgets set for {budgetYear}. Click "Set Budget" to create one.</div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>
            <th style={th}>Code</th><th style={th}>Account</th>
            <th style={{...th, textAlign:'right'}}>Budget</th><th style={{...th, textAlign:'right'}}>Actual</th>
            <th style={{...th, textAlign:'right'}}>Variance</th><th style={{...th, textAlign:'center'}}>Used %</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {yearBudgets.map(b => {
              const actual = actuals[b.accountCode]?.total || 0;
              const var_ = b.amount - actual;
              const pct = b.amount > 0 ? Math.round((actual / b.amount) * 100) : 0;
              return (
                <tr key={b.id}>
                  <td style={td}>{b.accountCode}</td>
                  <td style={td}>{b.accountName}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(b.amount)}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(actual)}</td>
                  <td style={{...td, textAlign:'right', color: var_ >= 0 ? C.green : C.danger, fontWeight:600}}>{fmt(var_)}</td>
                  <td style={{...td, textAlign:'center'}}>
                    <div style={{ position:'relative', height:8, background:'rgba(0,0,0,0.06)', borderRadius:4, width:60, display:'inline-block', verticalAlign:'middle' }}>
                      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${Math.min(100, pct)}%`, background: pct > 100 ? C.danger : (pct > 80 ? C.amber : C.green), borderRadius:4 }} />
                    </div>
                    <span style={{ marginLeft:6, fontSize:11 }}>{pct}%</span>
                  </td>
                  <td style={td}><Btn sm variant="danger" onClick={()=>deleteBudget(b)}>✕</Btn></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {modal === 'add' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>Set Budget for {budgetYear}</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FG label="Account" full>
                <select value={form.accountCode} onChange={e=>setForm(f=>({...f, accountCode:e.target.value}))} style={inp}>
                  <option value="">— Select Account —</option>
                  {Object.entries(grouped).sort().map(([cat, accts]) => (
                    <optgroup key={cat} label={cat}>
                      {accts.sort((a,b)=>a.code.localeCompare(b.code)).map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </FG>
              <FG label="Annual Budget Amount"><input type="number" value={form.amount} onChange={e=>setForm(f=>({...f, amount:e.target.value}))} style={inp} /></FG>
              <FG label="Monthly breakdown (optional — leave blank for even distribution)" full>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:6, marginTop:4 }}>
                  {MONTHS.map(m => (
                    <div key={m}>
                      <label style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>{m.slice(0,3)}</label>
                      <input type="number" value={form[m]} onChange={e=>setForm(f=>({...f, [m]:e.target.value}))} style={{ ...inp, padding:'4px 6px', fontSize:11 }} />
                    </div>
                  ))}
                </div>
              </FG>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSave}>Save Budget</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 16 — STOCK TAKE
// Physical inventory count sheet: select stock items, enter counted qty,
// system computes variance vs system qty, posts adjustment to GL
// (Dr/Cr Inventory / Dr/Cr Stock Adjustment 8006).
// ════════════════════════════════════════════════════════════════════════════
function StockTakeTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const stockItems = db.stockItems || [];
  const stockMovements = db.stockMovements || [];
  const stockTakes = db.stockTakes || [];
  const journals = state?.acctData?.journals || [];
  const [modal, setModal] = useState(null);
  const [counts, setCounts] = useState({}); // { itemId: countedQty }
  const [countName, setCountName] = useState(`Stock Take — ${formatDate(today())}`);
  const [countDate, setCountDate] = useState(today());

  // System quantity per item (sum of movements: RECEIVE positive, ISSUE negative)
  function systemQty(itemId) {
    return (stockMovements || [])
      .filter(m => m.itemId === itemId && !m.voided)
      .reduce((s, m) => {
        const qty = Number(m.qty) || 0;
        const type = (m.type || '').toUpperCase();
        if (type === 'RECEIVE' || type === 'RETURN') return s + qty;
        if (type === 'ISSUE' || type === 'SCRAP')   return s - qty;
        if (type === 'ADJUST') return s + qty; // signed
        return s;
      }, 0);
  }

  // Weighted-avg cost per item (sum of RECEIVE cost / sum of RECEIVE qty)
  function avgCost(itemId) {
    const receives = (stockMovements || []).filter(m => m.itemId === itemId && !m.voided && (m.type||'').toUpperCase() === 'RECEIVE');
    const totCost = receives.reduce((s, m) => s + (Number(m.unitCost) || 0) * (Number(m.qty) || 0), 0);
    const totQty  = receives.reduce((s, m) => s + (Number(m.qty) || 0), 0);
    return totQty > 0 ? totCost / totQty : 0;
  }

  function saveStockTakes(list) {
    diffAndPush('stockTakes', stockTakes, list); // 2026-07-29 full-app sync sweep
    const newDb = { ...db, stockTakes: list };
    dispatch({ type:'UPDATE_MODULE', mod:'stockTakes', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function finalizeCount() {
    const items = stockItems.filter(it => !it.voided);
    if (items.length === 0) { showToast('No stock items to count', 'error'); return; }
    const lines = items.map(it => {
      const sysQty = systemQty(it.id);
      const counted = counts[it.id] !== undefined ? Number(counts[it.id]) : sysQty;
      const variance = counted - sysQty;
      const cost = avgCost(it.id);
      const varValue = variance * cost;
      return { itemId: it.id, itemCode: it.code || it.itemCode, itemName: it.name || it.description, systemQty: sysQty, countedQty: counted, variance, unitCost: cost, varianceValue: varValue };
    }).filter(l => l.variance !== 0);

    if (lines.length === 0) { showToast('No variances — system matches physical count. No adjustment needed.', 'info'); return; }

    const stNo = `SLOT-ST-${year()}-${String(stockTakes.length + 1).padStart(4,'0')}`;
    const st = {
      id: uid(),
      stNo,
      name: countName,
      date: countDate,
      lines,
      totalVarValue: lines.reduce((s, l) => s + l.varianceValue, 0),
      countedBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };

    // Post stock movement adjustments for each variance line
    const newMovements = lines.map(l => ({
      id: uid(),
      itemId: l.itemId,
      type: 'ADJUST',
      qty: l.variance,
      unitCost: l.unitCost,
      date: countDate,
      ref: stNo,
      reason: `Stock take adjustment — ${stNo}`,
      postedBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    }));
    const updatedMovements = [...newMovements, ...(stockMovements || [])];

    // Post GL adjustment JEs: Dr/Cr Inventory (6001) / Dr/Cr Stock Adjustment (8006)
    // For each variance: if positive (more stock than system), Dr Inventory / Cr Stock Adjustment
    // If negative (less stock), Dr Stock Adjustment / Cr Inventory
    const jePairs = lines.filter(l => l.varianceValue !== 0).map(l => ({
      id: `JE-ST-${st.id}-${l.itemId}`,
      date: countDate,
      ref: stNo,
      description: `Stock adjustment — ${l.itemName} (${stNo})`,
      source: 'stock-take',
      sourceId: st.id,
      lines: l.variance > 0 ? [{
        drCode: '6001', drName: 'Inventories',
        crCode: '8006', crName: 'Stock Adjustment',
        amount: Math.abs(l.varianceValue), currency:'NGN', fxRate:1, fcAmount: Math.abs(l.varianceValue),
        memo: `Adjustment +${l.variance} units — ${l.itemName}`, costCentre: '',
      }] : [{
        drCode: '8006', drName: 'Stock Adjustment',
        crCode: '6001', crName: 'Inventories',
        amount: Math.abs(l.varianceValue), currency:'NGN', fxRate:1, fcAmount: Math.abs(l.varianceValue),
        memo: `Adjustment ${l.variance} units — ${l.itemName}`, costCentre: '',
      }],
    }));
    const newJournals = [...jePairs, ...journals];
    dispatch({ type:'SET_ACCT', payload: { ...(state.acctData || {}), journals: newJournals } });
    setTimeout(() => {
      try {
        const raw = localStorage.getItem('bc_accounting');
        const parsed = raw ? JSON.parse(raw) : {};
        const updatedAcct = { ...parsed, journals: newJournals };
        localStorage.setItem('bc_accounting', JSON.stringify(updatedAcct));
      } catch {}
    }, 100);

    // Save stock take record + movements
    const newDb = {
      ...db,
      stockTakes: [st, ...stockTakes],
      stockMovements: updatedMovements,
    };
    pushOne('stockTakes', st); // 2026-07-29 full-app sync sweep — one new record
    diffAndPush('stockMovements', stockMovements, updatedMovements);
    dispatch({ type:'UPDATE_MODULE', mod:'stockTakes', data: [st, ...stockTakes] });
    dispatch({ type:'UPDATE_MODULE', mod:'stockMovements', data: updatedMovements });
    saveDBLocal(newDb, state.activity);
    logActivity(dispatch, `Stock take ${stNo} finalized — ${lines.length} variance(s), total ${fmt(Math.abs(st.totalVarValue))}`, currentUser);
    showToast(`Stock take ${stNo} finalized — ${lines.length} adjustments posted to GL`);
    setModal(null);
    setCounts({});
  }

  function printCountSheet() {
    const items = stockItems.filter(it => !it.voided);
    if (items.length === 0) { showToast('No stock items', 'error'); return; }
    const rows = items.map((it, i) => `
      <tr>
        <td>${i+1}</td>
        <td>${esc(it.code || it.itemCode || '')}</td>
        <td>${esc(it.name || it.description || '')}</td>
        <td style="text-align:center">${systemQty(it.id)}</td>
        <td style="text-align:center;height:30px"></td>
        <td style="text-align:center;height:30px"></td>
      </tr>`).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><title>Stock Take Count Sheet — ${esc(countName)}</title>
      <style>${PRINT_CSS}
      .st-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 6px}
      .st-sub{text-align:center;font-size:11.5px;color:#3A5040;margin-bottom:14px}
      table.st{width:100%;border-collapse:collapse;margin:10px 0}
      table.st th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
      table.st td{padding:8px 9px;border:1px solid #ccc;font-size:11.5px}
      </style></head><body>
      ${printHeader('STOCK TAKE COUNT SHEET', formatDate(countDate))}
      <div class="st-title">${esc(countName)}</div>
      <div class="st-sub">Count Date: ${formatDate(countDate)}</div>
      <table class="st"><thead><tr><th>S/N</th><th>Item Code</th><th>Item Name</th><th style="text-align:center">System Qty</th><th style="text-align:center">Counted Qty</th><th style="text-align:center">Variance</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:24px;font-size:11px;color:#182A1C">Counted by: ____________________________ &nbsp;&nbsp; Date: ____________ &nbsp;&nbsp; Witnessed by: ____________________________</p>
      ${printBootstrap({landscape:true})}
      </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };
  const items = stockItems.filter(it => !it.voided);

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Stock Take</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Physical count vs system qty — variances posted to GL automatically</div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <Btn variant="ghost" onClick={printCountSheet} disabled={items.length === 0}>🖨️ Print Count Sheet</Btn>
          <Btn onClick={()=>setModal('count')} disabled={items.length === 0}>+ New Stock Take</Btn>
        </div>
      </div>

      <div style={{ fontSize:11, color:C.textMuted, marginBottom:14, padding:'10px 14px', background:'rgba(26,92,138,0.06)', border:'1px solid rgba(26,92,138,0.20)', borderRadius:8 }}>
        <b>Workflow:</b> 1) Print the count sheet and physically count stock. 2) Open "New Stock Take", enter counted quantities. 3) Click "Finalize" — the system posts ADJUST stock movements and Dr/Cr Inventory (6001) / Stock Adjustment (8006) JEs for every variance.
      </div>

      {stockTakes.length === 0 ? (
        <div style={{ padding:30, textAlign:'center', color:C.textMuted, fontSize:13 }}>No stock takes recorded yet.</div>
      ) : (
        <>
          <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginBottom:6 }}>Recent Stock Takes</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              <th style={th}>ST No</th><th style={th}>Date</th><th style={th}>Name</th>
              <th style={{...th, textAlign:'right'}}>Variances</th><th style={{...th, textAlign:'right'}}>Total Value</th><th style={th}>Counted By</th>
            </tr></thead>
            <tbody>
              {stockTakes.slice(0, 10).map(st => (
                <tr key={st.id}>
                  <td style={td}><b>{st.stNo}</b></td>
                  <td style={td}>{formatDate(st.date)}</td>
                  <td style={td}>{st.name}</td>
                  <td style={{...td, textAlign:'right'}}>{st.lines?.length || 0}</td>
                  <td style={{...td, textAlign:'right', fontWeight:600, color: st.totalVarValue < 0 ? C.danger : C.green}}>{fmt(Math.abs(st.totalVarValue))}</td>
                  <td style={td}>{st.countedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {modal === 'count' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>Stock Take — Enter Counted Quantities</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:12, marginBottom:14 }}>
              <FG label="Count Name"><input value={countName} onChange={e=>setCountName(e.target.value)} style={inp} /></FG>
              <FG label="Count Date"><input type="date" value={countDate} onChange={e=>setCountDate(e.target.value)} style={inp} /></FG>
            </div>
            <div style={{ maxHeight:400, overflowY:'auto', border:'1px solid '+C.border, borderRadius:8 }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>
                  <th style={th}>Item</th><th style={{...th, textAlign:'right'}}>System Qty</th>
                  <th style={{...th, textAlign:'right'}}>Counted Qty</th><th style={{...th, textAlign:'right'}}>Variance</th>
                </tr></thead>
                <tbody>
                  {items.map(it => {
                    const sys = systemQty(it.id);
                    const counted = counts[it.id] !== undefined ? Number(counts[it.id]) : sys;
                    const var_ = counted - sys;
                    return (
                      <tr key={it.id}>
                        <td style={td}>{it.name || it.description}</td>
                        <td style={{...td, textAlign:'right'}}>{sys}</td>
                        <td style={{...td, textAlign:'right'}}>
                          <input type="number" value={counts[it.id] !== undefined ? counts[it.id] : ''} onChange={e=>setCounts(c => ({ ...c, [it.id]: e.target.value }))} style={{ ...inp, width:80, padding:'4px 6px', textAlign:'right' }} placeholder={String(sys)} />
                        </td>
                        <td style={{...td, textAlign:'right', fontWeight:600, color: var_ < 0 ? C.danger : (var_ > 0 ? C.green : undefined)}}>{var_ > 0 ? '+' : ''}{var_}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={finalizeCount}>✓ Finalize & Post Adjustments</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}
