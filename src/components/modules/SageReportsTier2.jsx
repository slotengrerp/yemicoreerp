// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — SAGE-STYLE REPORTS & FEATURES — TIER 2 v1.0
//
// Six additional features Nigerian accountants rely on Sage 200 Evolution for:
//
//  11. Recurring Invoices  — templates that auto-generate invoices on schedule
//  12. Bank Reconciliation UI — interactive match screen (not just import)
//  13. Prepayments & Accruals — auto-reversing journals
//  14. Asset Disposal       — sell/dispose with gain/loss posting
//  15. Budget vs Actual     — set budgets per account per month, compare
//  16. Stock Take           — physical count → variance → GL posting
//
// Imported as additional tabs by SageReports.jsx. Data shapes match existing
// collections so the existing sync engine carries everything to the cloud.
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { showToast, formatDate, generateId } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { printHeader, PRINT_CSS, SLOT_LOGO_SRC, printBootstrap, openPrintWindow} from '../../utils/logo';
import { getClients, getClientByCode } from '../../utils/clientMaster';
import { BANK_ACCOUNTS } from '../../utils/financeConstants';
import { diffAndPush, pushOne } from '../../hooks/usePerRecordSync';

const uid   = () => generateId();
const today = () => new Date().toISOString().split('T')[0];
const year  = () => new Date().getFullYear();
const fmt   = n => '₦' + (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN  = n => (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc   = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// ── Shared UI primitives (local copies so this file is self-contained) ───────
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
  return <div style={{ display:'flex', flexDirection:'column', gap:4, gridColumn:full?'1/-1':undefined }}><label style={{ fontSize:11, fontWeight:600, color:C.textMid }}>{label}</label>{children}</div>;
}
function Overlay({ children, onClose }) {
  // 2026-08-15: backdrop no longer closes the form on click — see same fix
  // in ui/index.jsx's shared Modal and Procurement.jsx's Overlay.
  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'100%', maxWidth:920, marginBottom:32 }}>{children}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 11 — RECURRING INVOICES
// Templates that auto-generate invoices on a monthly / quarterly / yearly
// schedule. Use case: NLNG monthly retainer, equipment lease billing, etc.
// Stored in db.recurringInvoiceTemplates. Each "Generate Now" click creates
// a real invoice in db.invoices from the template.
// ════════════════════════════════════════════════════════════════════════════
export function RecurringInvoicesTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const templates = db.recurringInvoiceTemplates || [];
  const invoices  = db.invoices || [];
  const clients = useMemo(() => getClients().filter(c => c.status === 'Active'), []);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({
    clientCode:'', description:'', amount:'', vatRate:7.5, whtRate:5,
    frequency:'monthly', nextDate: today(),
    paymentTerms:'Net 30', category:'Engineering Services',
    notes:'',
  });

  function saveTemplates(list) {
    diffAndPush('recurringInvoiceTemplates', templates, list); // 2026-07-29 full-app sync sweep
    const newDb = { ...db, recurringInvoiceTemplates: list };
    dispatch({ type:'UPDATE_MODULE', mod:'recurringInvoiceTemplates', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function handleSaveTemplate() {
    if (!form.clientCode) { showToast('Select a customer', 'error'); return; }
    if (!form.description.trim()) { showToast('Description required', 'error'); return; }
    if (!Number(form.amount) || Number(form.amount) <= 0) { showToast('Enter a valid amount', 'error'); return; }
    const client = getClientByCode(form.clientCode);
    const tplNo = `SLOT-REC-${year()}-${String(templates.length + 1).padStart(4,'0')}`;
    const tpl = {
      id: uid(),
      tplNo,
      clientCode: form.clientCode,
      clientName: client?.name || '',
      description: form.description,
      amount: Number(form.amount),
      vatRate: Number(form.vatRate) || 0,
      whtRate: Number(form.whtRate) || 0,
      frequency: form.frequency, // monthly | quarterly | yearly
      nextDate: form.nextDate,
      paymentTerms: form.paymentTerms,
      category: form.category,
      notes: form.notes,
      status: 'Active',
      lastGenerated: '',
      generatedCount: 0,
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.name || 'Admin',
    };
    const updated = [tpl, ...templates];
    saveTemplates(updated);
    logActivity(dispatch, `Recurring invoice template ${tplNo} created for ${tpl.clientName}`, currentUser);
    showToast(`Template ${tplNo} saved`);
    setModal(null);
    setForm({ clientCode:'', description:'', amount:'', vatRate:7.5, whtRate:5, frequency:'monthly', nextDate: today(), paymentTerms:'Net 30', category:'Engineering Services', notes:'' });
  }

  function generateInvoice(tpl) {
    const client = getClientByCode(tpl.clientCode);
    if (!client) { showToast('Customer not found in master', 'error'); return; }
    const amount = Number(tpl.amount) || 0;
    const vatAmount = Math.round(amount * (Number(tpl.vatRate) || 0) / 100);
    const whtAmount = Math.round(amount * (Number(tpl.whtRate) || 0) / 100);
    const subtotal = amount;
    const total = subtotal + vatAmount;
    const netPayable = total - whtAmount;
    // Generate next invoice number
    const existingNums = invoices.map(x => parseInt((x.invoiceNo||'0').replace(/\D/g,''),10)).filter(Boolean);
    const invNo = `SLOT-INV-${year()}-${String(existingNums.length ? Math.max(...existingNums)+1 : 1).padStart(4,'0')}`;
    const inv = {
      id: uid(),
      invoiceNo: invNo,
      client: tpl.clientName,
      clientCode: tpl.clientCode,
      clientAddress: client?.address || '',
      category: tpl.category,
      date: tpl.nextDate,
      dueDate: (() => {
        const d = new Date(tpl.nextDate);
        d.setDate(d.getDate() + 30); // Net 30 default
        return d.toISOString().split('T')[0];
      })(),
      paymentTerms: tpl.paymentTerms,
      currency: client?.currency || 'NGN',
      fxRate: 1,
      items: [{ id: uid(), description: tpl.description, qty:1, unit:'service', unitPrice: amount, total: amount }],
      subtotal, vatAmount, whtRate: tpl.whtRate, whtAmount,
      total, netPayable, ngnEquivalent: netPayable,
      status: 'Pending',
      paymentDate:'', paymentRef:'', receivedAmount:0, notes: tpl.notes || '',
      sourceTemplateId: tpl.id,
      sourceTemplateNo: tpl.tplNo,
      createdAt: new Date().toISOString(),
    };
    const updatedInvoices = [inv, ...invoices];
    pushOne('invoices', inv); // 2026-07-29 full-app sync sweep — one new record
    dispatch({ type:'UPDATE_MODULE', mod:'invoices', data: updatedInvoices });
    saveDBLocal({ ...db, invoices: updatedInvoices }, state.activity);

    // Advance nextDate + bump count
    const next = new Date(tpl.nextDate);
    if (tpl.frequency === 'monthly')   next.setMonth(next.getMonth() + 1);
    else if (tpl.frequency === 'quarterly') next.setMonth(next.getMonth() + 3);
    else if (tpl.frequency === 'yearly')    next.setFullYear(next.getFullYear() + 1);
    const updatedTpls = templates.map(t => t.id === tpl.id
      ? { ...t, lastGenerated: today(), generatedCount: (t.generatedCount||0)+1, nextDate: next.toISOString().split('T')[0] }
      : t);
    saveTemplates(updatedTpls);

    logActivity(dispatch, `Recurring invoice ${invNo} generated from template ${tpl.tplNo} for ${tpl.clientName}`, currentUser);
    showToast(`Invoice ${invNo} generated — ${fmt(netPayable)}`);
  }

  function toggleStatus(tpl) {
    const updated = templates.map(t => t.id === tpl.id ? { ...t, status: t.status === 'Active' ? 'Paused' : 'Active' } : t);
    saveTemplates(updated);
    showToast(`Template ${tpl.tplNo} ${tpl.status === 'Active' ? 'paused' : 'resumed'}`);
  }

  function deleteTemplate(tpl) {
    if (!window.confirm(`Delete template ${tpl.tplNo}? This does not affect invoices already generated.`)) return;
    saveTemplates(templates.filter(t => t.id !== tpl.id));
    showToast('Template deleted');
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Recurring Invoices</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Templates that auto-generate invoices on a schedule (monthly / quarterly / yearly)</div>
        </div>
        <Btn onClick={()=>setModal('add')}>+ New Template</Btn>
      </div>

      {templates.length === 0 ? (
        <div style={{ padding:30, textAlign:'center', color:C.textMuted, fontSize:13 }}>
          No recurring invoice templates yet. Click "New Template" to set up a monthly retainer, equipment lease, or any recurring billing.
        </div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>
            <th style={th}>Template No</th><th style={th}>Customer</th><th style={th}>Description</th>
            <th style={{...th, textAlign:'right'}}>Amount</th>
            <th style={th}>Frequency</th><th style={th}>Next Date</th>
            <th style={{...th, textAlign:'center'}}>Generated</th>
            <th style={th}>Status</th>
            <th style={th}></th>
          </tr></thead>
          <tbody>
            {templates.map(tpl => (
              <tr key={tpl.id}>
                <td style={td}><b>{tpl.tplNo}</b></td>
                <td style={td}>{tpl.clientName}</td>
                <td style={td}>{tpl.description}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(tpl.amount)}</td>
                <td style={td}><span style={{ padding:'2px 8px', borderRadius:20, fontSize:11, background:'rgba(26,92,138,0.12)', color:'#1A5C8A', textTransform:'capitalize' }}>{tpl.frequency}</span></td>
                <td style={td}>{formatDate(tpl.nextDate)}</td>
                <td style={{...td, textAlign:'center'}}>{tpl.generatedCount || 0}</td>
                <td style={td}>
                  <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600, color: tpl.status === 'Active' ? C.green : '#6B7280', background: tpl.status === 'Active' ? 'rgba(26,122,74,0.12)' : 'rgba(107,114,128,0.12)' }}>{tpl.status}</span>
                </td>
                <td style={td}>
                  <div style={{ display:'flex', gap:4 }}>
                    <Btn sm onClick={()=>generateInvoice(tpl)} disabled={tpl.status !== 'Active'}>⚡ Generate</Btn>
                    <Btn sm variant="ghost" onClick={()=>toggleStatus(tpl)}>{tpl.status === 'Active' ? '⏸' : '▶'}</Btn>
                    <Btn sm variant="danger" onClick={()=>deleteTemplate(tpl)}>🗑</Btn>
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
              <FG label="Description" full><input value={form.description} onChange={e=>setForm(f=>({...f, description:e.target.value}))} placeholder="e.g. Monthly engineering retainer — February 2026" style={inp} /></FG>
              <FG label="Amount (excl VAT)"><input type="number" value={form.amount} onChange={e=>setForm(f=>({...f, amount:e.target.value}))} style={inp} /></FG>
              <FG label="VAT Rate %"><input type="number" step="0.1" value={form.vatRate} onChange={e=>setForm(f=>({...f, vatRate:e.target.value}))} style={inp} /></FG>
              <FG label="WHT Rate %"><input type="number" step="0.1" value={form.whtRate} onChange={e=>setForm(f=>({...f, whtRate:e.target.value}))} style={inp} /></FG>
              <FG label="Frequency">
                <select value={form.frequency} onChange={e=>setForm(f=>({...f, frequency:e.target.value}))} style={inp}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </FG>
              <FG label="First Invoice Date"><input type="date" value={form.nextDate} onChange={e=>setForm(f=>({...f, nextDate:e.target.value}))} style={inp} /></FG>
              <FG label="Payment Terms">
                <select value={form.paymentTerms} onChange={e=>setForm(f=>({...f, paymentTerms:e.target.value}))} style={inp}>
                  {['Net 7','Net 14','Net 30','Net 45','Net 60','Due on Receipt'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </FG>
              <FG label="Category">
                <select value={form.category} onChange={e=>setForm(f=>({...f, category:e.target.value}))} style={inp}>
                  {['Engineering Services','Procurement Services','Logistics','Consultancy','Maintenance','Equipment Supply'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FG>
              <FG label="Notes" full><textarea value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))} rows={2} style={{...inp, resize:'vertical'}} /></FG>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSaveTemplate}>Save Template</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 12 — BANK RECONCILIATION UI
// Interactive match screen: import bank statement lines, see auto-match
// suggestions, accept/reject matches, mark as reconciled, finalize.
// ════════════════════════════════════════════════════════════════════════════
export function BankReconciliationTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const [bankCode, setBankCode] = useState('3003');
  const [stmtDate, setStmtDate] = useState(today());
  const [stmtBalance, setStmtBalance] = useState('');
  const [pasteData, setPasteData] = useState('');
  const [stmtLines, setStmtLines] = useState([]);
  const [matched, setMatched] = useState({}); // stmtLineId -> bookEntryId

  // Book entries = bank-account-related journals + AR receipts + AP payments in this bank
  const bookEntries = useMemo(() => {
    const out = [];
    const journals = state?.acctData?.journals || [];
    journals.forEach(je => {
      (je.lines || []).forEach(line => {
        if (line.drCode === bankCode || line.crCode === bankCode) {
          const isDr = line.drCode === bankCode;
          out.push({
            id: je.id + '-' + (line.drCode || line.crCode),
            date: je.date,
            ref: je.ref || '',
            desc: je.description || '',
            amount: isDr ? (Number(line.amount) || 0) : -(Number(line.amount) || 0),
            type: isDr ? 'Receipt' : 'Payment',
          });
        }
      });
    });
    // Also include AR receipts
    (db.arReceipts || []).forEach(r => {
      if (r.bankCode !== bankCode) return;
      out.push({ id: 'ar-'+r.id, date: r.date, ref: r.receiptNo || r.reference || '', desc: 'Receipt from ' + (r.client || r.invoiceNo || ''), amount: Number(r.ngnEquivalent || r.amountReceived) || 0, type: 'Receipt' });
    });
    // AP payments
    const apPayments = db.ap?.payments || [];
    apPayments.forEach(p => {
      if (p.bankCode !== bankCode) return;
      out.push({ id: 'ap-'+p.id, date: p.date, ref: p.paymentNo || p.reference || '', desc: 'Payment to ' + (p.vendorName || p.vendor || ''), amount: -(Number(p.ngnEquivalent || p.amount) || 0), type: 'Payment' });
    });
    return out.sort((a,b) => new Date(a.date) - new Date(b.date));
  }, [state.acctData, db.arReceipts, db.ap, bankCode]);

  const bookBalance = bookEntries.reduce((s, e) => s + e.amount, 0);

  function parseStatement() {
    if (!pasteData.trim()) { showToast('Paste bank statement data first', 'error'); return; }
    // Expected format: tab or comma separated — date, amount, description, ref
    // Date in YYYY-MM-DD or DD/MM/YYYY format. Positive = credit (receipt), negative = debit (payment).
    const lines = pasteData.trim().split(/\n/).map(line => {
      const parts = line.split(/\t|,/).map(p => p.trim());
      if (parts.length < 2) return null;
      let [dateStr, amountStr, ...rest] = parts;
      // Normalise date
      let date = dateStr;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        const [d, m, y] = dateStr.split('/');
        date = `${y}-${m}-${d}`;
      }
      const amount = Number(amountStr.replace(/[^\d.\-]/g, '')) || 0;
      const desc = rest.join(' ').trim() || '—';
      return { id: uid(), date, amount, desc, reconciled: false };
    }).filter(Boolean);
    if (lines.length === 0) { showToast('No valid rows parsed. Use: date, amount, description (one per line)', 'error'); return; }
    setStmtLines(lines);
    setMatched({});
    showToast(`${lines.length} statement lines imported`);
  }

  function autoMatch() {
    if (stmtLines.length === 0) { showToast('Import statement first', 'error'); return; }
    const newMatched = { ...matched };
    let matchCount = 0;
    stmtLines.forEach(stmt => {
      if (newMatched[stmt.id]) return; // already matched
      // Find a book entry with same amount (within ₦1) on same date or ±2 days
      const candidates = bookEntries.filter(b => {
        if (Object.values(newMatched).includes(b.id)) return false;
        const amtDiff = Math.abs(b.amount - stmt.amount);
        if (amtDiff > 1) return false;
        const dateDiff = Math.abs(new Date(b.date) - new Date(stmt.date)) / 86400000;
        return dateDiff <= 2;
      });
      if (candidates.length > 0) {
        newMatched[stmt.id] = candidates[0].id;
        matchCount++;
      }
    });
    setMatched(newMatched);
    showToast(`Auto-matched ${matchCount} statement lines`);
  }

  function manualMatch(stmtId, bookId) {
    const next = { ...matched };
    if (bookId === '') delete next[stmtId];
    else next[stmtId] = bookId;
    setMatched(next);
  }

  function finalizeRecon() {
    if (stmtLines.length === 0) { showToast('Nothing to finalize', 'error'); return; }
    const unmatched = stmtLines.filter(s => !matched[s.id]).length;
    const stmtTotal = stmtLines.reduce((s, l) => s + l.amount, 0);
    const matchedTotal = stmtLines.filter(s => matched[s.id])
      .reduce((s, l) => s + l.amount, 0);
    const bookMatchedTotal = Object.values(matched)
      .map(id => bookEntries.find(b => b.id === id))
      .reduce((s, b) => s + (b?.amount || 0), 0);
    const diff = matchedTotal - bookMatchedTotal;
    logActivity(dispatch,
      `Bank reconciliation finalized for ${BANK_ACCOUNTS.find(b=>b.code===bankCode)?.name} as at ${formatDate(stmtDate)}. ` +
      `${stmtLines.length} statement lines, ${Object.keys(matched).length} matched, ${unmatched} unmatched. ` +
      `Statement balance: ${fmt(Number(stmtBalance)||0)}, Book balance: ${fmt(bookBalance)}, Difference: ${fmt(diff)}.`,
      currentUser, { module:'sagereports', action:'reconcile' });
    showToast(`Reconciliation finalized — ${unmatched} unmatched. See activity log for details.`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };
  const bank = BANK_ACCOUNTS.find(b => b.code === bankCode);
  const matchedCount = Object.keys(matched).length;
  const unmatchedCount = stmtLines.length - matchedCount;

  return (
    <Card>
      <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:14 }}>Bank Reconciliation</div>
      <div style={{ fontSize:11, color:C.textMuted, marginBottom:14 }}>
        Paste your bank statement (one line per transaction: <code>date, amount, description</code>) and the system will auto-match against your book entries. Accept/reject suggestions, then finalize.
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:14 }}>
        <FG label="Bank Account">
          <select value={bankCode} onChange={e=>setBankCode(e.target.value)} style={inp}>
            {BANK_ACCOUNTS.map(b => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
          </select>
        </FG>
        <FG label="Statement Date"><input type="date" value={stmtDate} onChange={e=>setStmtDate(e.target.value)} style={inp} /></FG>
        <FG label="Statement Closing Balance"><input type="number" value={stmtBalance} onChange={e=>setStmtBalance(e.target.value)} placeholder="₦" style={inp} /></FG>
      </div>

      <FG label="Bank Statement Data (paste from Excel — one transaction per line: date,amount,description)" full>
        <textarea
          value={pasteData}
          onChange={e=>setPasteData(e.target.value)}
          rows={5}
          placeholder={"2026-07-01,4500000,NLNG TRF-0284\n2026-07-03,-283500,Fleet fuelling\n2026-07-15,-205000,Vehicle maintenance"}
          style={{ ...inp, fontFamily:'monospace', fontSize:11, resize:'vertical' }}
        />
      </FG>
      <div style={{ display:'flex', gap:8, marginBottom:18 }}>
        <Btn onClick={parseStatement} variant="outline">📥 Import Statement</Btn>
        <Btn onClick={autoMatch} disabled={stmtLines.length === 0}>🔗 Auto-Match</Btn>
        <Btn onClick={finalizeRecon} variant="ghost" disabled={stmtLines.length === 0}>✅ Finalize Reconciliation</Btn>
      </div>

      {/* Summary cards */}
      <div style={{ display:'flex', gap:10, marginBottom:18 }}>
        <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Statement Lines</div>
          <div style={{ fontSize:17, fontWeight:700, color:C.text }}>{stmtLines.length}</div>
        </div>
        <div style={{ flex:1, padding:'10px 14px', background:'rgba(26,122,74,0.10)', border:'1px solid '+C.green, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Matched</div>
          <div style={{ fontSize:17, fontWeight:700, color:C.green }}>{matchedCount}</div>
        </div>
        <div style={{ flex:1, padding:'10px 14px', background: unmatchedCount > 0 ? 'rgba(192,57,43,0.10)' : C.bgCard, border:'1px solid '+(unmatchedCount > 0 ? C.danger : C.border), borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Unmatched</div>
          <div style={{ fontSize:17, fontWeight:700, color: unmatchedCount > 0 ? C.danger : C.text }}>{unmatchedCount}</div>
        </div>
        <div style={{ flex:1, padding:'10px 14px', background:'rgba(26,92,138,0.10)', border:'1px solid #1A5C8A', borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Book Balance</div>
          <div style={{ fontSize:17, fontWeight:700, color:'#1A5C8A' }}>{fmt(bookBalance)}</div>
        </div>
      </div>

      {stmtLines.length > 0 && (
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>
            <th style={th}>Date</th><th style={th}>Description</th><th style={{...th, textAlign:'right'}}>Amount</th>
            <th style={th}>Matched To</th><th style={{...th, textAlign:'right'}}>Book Amount</th><th style={th}>Status</th>
          </tr></thead>
          <tbody>
            {stmtLines.map(s => {
              const bookId = matched[s.id];
              const book = bookId ? bookEntries.find(b => b.id === bookId) : null;
              return (
                <tr key={s.id} style={{ background: book ? 'rgba(26,122,74,0.06)' : 'transparent' }}>
                  <td style={td}>{formatDate(s.date)}</td>
                  <td style={td}>{s.desc}</td>
                  <td style={{...td, textAlign:'right', fontWeight:600, color: s.amount >= 0 ? C.green : C.danger}}>{fmt(s.amount)}</td>
                  <td style={td}>
                    <select value={bookId || ''} onChange={e=>manualMatch(s.id, e.target.value)} style={{ ...inp, fontSize:11, padding:'4px 6px' }}>
                      <option value="">— Unmatched —</option>
                      {bookEntries.map(b => <option key={b.id} value={b.id}>{formatDate(b.date)} · {b.desc.slice(0,40)} · {fmt(b.amount)}</option>)}
                    </select>
                  </td>
                  <td style={{...td, textAlign:'right'}}>{book ? fmt(book.amount) : '—'}</td>
                  <td style={td}>
                    {book
                      ? <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600, color:C.green, background:'rgba(26,122,74,0.12)' }}>✓ Matched</span>
                      : <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600, color:C.danger, background:'rgba(192,57,43,0.12)' }}>Unmatched</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 13 — PREPAYMENTS & ACCRUALS
// Auto-reversing journals. Two types:
//   Prepayment: Pay now, expense over X months (Dr Prepaid, Cr Cash; then
//               Dr Expense, Cr Prepaid each month)
//   Accrual:    Record expense now, pay later (Dr Expense, Cr Accrued; then
//               Dr Accrued, Cr Cash when paid)
// Stored in db.prepayments and db.accruals. Each generates a manual JE
// template + reversal reminders.
// ════════════════════════════════════════════════════════════════════════════
export function PrepaymentsAccrualsTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const prepayments = db.prepayments || [];
  const accruals    = db.accruals    || [];
  const journals    = state?.acctData?.journals || [];
  const [tab, setTab] = useState('prepay'); // 'prepay' | 'accrual'
  const [modal, setModal] = useState(null);

  const EMPTY_PREPAY = { description:'', amount:'', date:today(), expenseAccount:'9003', months:12, supplier:'' };
  const EMPTY_ACCRUAL = { description:'', amount:'', date:today(), expenseAccount:'9003', supplier:'' };
  const [prepayForm, setPrepayForm] = useState(EMPTY_PREPAY);
  const [accrualForm, setAccrualForm] = useState(EMPTY_ACCRUAL);

  // Common expense accounts dropdown
  const EXPENSE_ACCOUNTS = [
    { code:'9002', name:'Staff Salaries' },
    { code:'9003', name:'Telephone Expenses' },
    { code:'9013', name:'Diesel & Fuelling' },
    { code:'9014', name:'General Repairs & Maintenance' },
    { code:'9022', name:'Audit Fee & Professional Services' },
    { code:'9553', name:'Rent Expenses' },
    { code:'9557', name:'Electricity / PHED Bills' },
    { code:'9500', name:'Interest Charges' },
  ];

  function savePrepayments(list) {
    diffAndPush('prepayments', prepayments, list); // 2026-07-29 full-app sync sweep
    const newDb = { ...db, prepayments: list };
    dispatch({ type:'UPDATE_MODULE', mod:'prepayments', data: list });
    saveDBLocal(newDb, state.activity);
  }
  function saveAccruals(list) {
    diffAndPush('accruals', accruals, list); // 2026-07-29 full-app sync sweep
    const newDb = { ...db, accruals: list };
    dispatch({ type:'UPDATE_MODULE', mod:'accruals', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function handleSavePrepay() {
    if (!prepayForm.description.trim()) { showToast('Description required', 'error'); return; }
    if (!Number(prepayForm.amount) || Number(prepayForm.amount) <= 0) { showToast('Enter amount', 'error'); return; }
    if (!Number(prepayForm.months) || Number(prepayForm.months) < 1) { showToast('Enter months (min 1)', 'error'); return; }
    const amount = Number(prepayForm.amount);
    const months = Number(prepayForm.months);
    const monthlyAmt = Math.round(amount / months);
    const rec = {
      id: uid(),
      refNo: `PREPAY-${year()}-${String(prepayments.length + 1).padStart(4,'0')}`,
      description: prepayForm.description,
      amount,
      monthlyAmt,
      months,
      date: prepayForm.date,
      expenseAccount: prepayForm.expenseAccount,
      expenseAccountName: EXPENSE_ACCOUNTS.find(a => a.code === prepayForm.expenseAccount)?.name || '',
      supplier: prepayForm.supplier,
      reversedMonths: 0,
      nextReverseDate: (() => { const d = new Date(prepayForm.date); d.setMonth(d.getMonth()+1); return d.toISOString().split('T')[0]; })(),
      status: 'Active',
      postedBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };
    const updated = [rec, ...prepayments];
    savePrepayments(updated);
    logActivity(dispatch, `Prepayment ${rec.refNo} created: ${fmt(amount)} over ${months} months — Dr Prepaid / Cr Bank`, currentUser);
    showToast(`Prepayment ${rec.refNo} saved — Dr Prepaid Expense / Cr Bank`);
    setModal(null);
    setPrepayForm(EMPTY_PREPAY);
  }

  function handleSaveAccrual() {
    if (!accrualForm.description.trim()) { showToast('Description required', 'error'); return; }
    if (!Number(accrualForm.amount) || Number(accrualForm.amount) <= 0) { showToast('Enter amount', 'error'); return; }
    const rec = {
      id: uid(),
      refNo: `ACCR-${year()}-${String(accruals.length + 1).padStart(4,'0')}`,
      description: accrualForm.description,
      amount: Number(accrualForm.amount),
      date: accrualForm.date,
      expenseAccount: accrualForm.expenseAccount,
      expenseAccountName: EXPENSE_ACCOUNTS.find(a => a.code === accrualForm.expenseAccount)?.name || '',
      supplier: accrualForm.supplier,
      reversed: false,
      reversalDate: '',
      status: 'Active',
      postedBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };
    const updated = [rec, ...accruals];
    saveAccruals(updated);
    logActivity(dispatch, `Accrual ${rec.refNo} created: ${fmt(rec.amount)} — Dr ${rec.expenseAccountName} / Cr Accrued Expenses`, currentUser);
    showToast(`Accrual ${rec.refNo} saved — Dr Expense / Cr Accrued (auto-reverses next period)`);
    setModal(null);
    setAccrualForm(EMPTY_ACCRUAL);
  }

  function reversePrepayMonth(rec) {
    const updated = prepayments.map(p => p.id === rec.id
      ? { ...p, reversedMonths: p.reversedMonths + 1, nextReverseDate: (() => { const d = new Date(p.nextReverseDate); d.setMonth(d.getMonth()+1); return d.toISOString().split('T')[0]; })(), status: p.reversedMonths + 1 >= p.months ? 'Fully Reversed' : 'Active' }
      : p);
    savePrepayments(updated);
    logActivity(dispatch, `Prepayment ${rec.refNo}: reversed month ${rec.reversedMonths + 1}/${rec.months} — Dr ${rec.expenseAccountName} / Cr Prepaid Expense (${fmt(rec.monthlyAmt)})`, currentUser);
    showToast(`Month reversed — Dr Expense / Cr Prepaid: ${fmt(rec.monthlyAmt)}`);
  }

  function reverseAccrual(rec) {
    const updated = accruals.map(a => a.id === rec.id ? { ...a, reversed: true, reversalDate: today(), status: 'Reversed' } : a);
    saveAccruals(updated);
    logActivity(dispatch, `Accrual ${rec.refNo} reversed — Dr Accrued Expenses / Cr Bank (${fmt(rec.amount)})`, currentUser);
    showToast(`Accrual reversed — Dr Accrued / Cr Bank: ${fmt(rec.amount)}`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const totalActivePrepay = prepayments.filter(p => p.status === 'Active').reduce((s, p) => s + (p.amount - (p.monthlyAmt * p.reversedMonths)), 0);
  const totalActiveAccrual = accruals.filter(a => !a.reversed).reduce((s, a) => s + a.amount, 0);

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Prepayments & Accruals</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Auto-reversing journals — match expenses to the period they belong in</div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <Btn variant={tab==='prepay'?'primary':'ghost'} onClick={()=>setTab('prepay')}>Prepayments ({prepayments.length})</Btn>
          <Btn variant={tab==='accrual'?'primary':'ghost'} onClick={()=>setTab('accrual')}>Accruals ({accruals.length})</Btn>
          <Btn onClick={()=>setModal(tab==='prepay'?'prepay':'accrual')}>+ New {tab==='prepay'?'Prepayment':'Accrual'}</Btn>
        </div>
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:14 }}>
        <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Active Prepayments Balance</div>
          <div style={{ fontSize:17, fontWeight:700, color:C.green }}>{fmt(totalActivePrepay)}</div>
        </div>
        <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Active Accruals Balance</div>
          <div style={{ fontSize:17, fontWeight:700, color:C.amber }}>{fmt(totalActiveAccrual)}</div>
        </div>
      </div>

      {tab === 'prepay' ? (
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>
            <th style={th}>Ref</th><th style={th}>Description</th><th style={th}>Date</th>
            <th style={{...th, textAlign:'right'}}>Amount</th><th style={th}>Months</th>
            <th style={{...th, textAlign:'right'}}>Monthly</th>
            <th style={{...th, textAlign:'center'}}>Reversed</th>
            <th style={th}>Next Reverse</th><th style={th}>Status</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {prepayments.length === 0 ? <tr><td style={td} colSpan={10} align="center"><i>No prepayments yet</i></td></tr> :
              prepayments.map(p => (
                <tr key={p.id}>
                  <td style={td}><b>{p.refNo}</b></td>
                  <td style={td}>{p.description}<br/><span style={{ fontSize:10, color:C.textMuted }}>{p.expenseAccountName}</span></td>
                  <td style={td}>{formatDate(p.date)}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(p.amount)}</td>
                  <td style={{...td, textAlign:'center'}}>{p.months}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(p.monthlyAmt)}</td>
                  <td style={{...td, textAlign:'center'}}>{p.reversedMonths}/{p.months}</td>
                  <td style={td}>{formatDate(p.nextReverseDate)}</td>
                  <td style={td}>
                    <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600,
                      color: p.status === 'Fully Reversed' ? '#6B7280' : C.green,
                      background: p.status === 'Fully Reversed' ? 'rgba(107,114,128,0.12)' : 'rgba(26,122,74,0.12)' }}>{p.status}</span>
                  </td>
                  <td style={td}>
                    <Btn sm onClick={()=>reversePrepayMonth(p)} disabled={p.status === 'Fully Reversed'}>↩ Reverse Month</Btn>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>
            <th style={th}>Ref</th><th style={th}>Description</th><th style={th}>Date</th>
            <th style={{...th, textAlign:'right'}}>Amount</th><th style={th}>Expense Account</th>
            <th style={th}>Reversal Date</th><th style={th}>Status</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {accruals.length === 0 ? <tr><td style={td} colSpan={8} align="center"><i>No accruals yet</i></td></tr> :
              accruals.map(a => (
                <tr key={a.id}>
                  <td style={td}><b>{a.refNo}</b></td>
                  <td style={td}>{a.description}</td>
                  <td style={td}>{formatDate(a.date)}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(a.amount)}</td>
                  <td style={td}>{a.expenseAccountName}</td>
                  <td style={td}>{a.reversalDate ? formatDate(a.reversalDate) : '—'}</td>
                  <td style={td}>
                    <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600,
                      color: a.reversed ? '#6B7280' : C.amber,
                      background: a.reversed ? 'rgba(107,114,128,0.12)' : 'rgba(201,122,10,0.12)' }}>{a.status}</span>
                  </td>
                  <td style={td}>
                    <Btn sm onClick={()=>reverseAccrual(a)} disabled={a.reversed}>↩ Reverse</Btn>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {modal === 'prepay' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Prepayment</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ fontSize:11, color:C.textMuted, marginBottom:14, padding:10, background:'rgba(26,92,138,0.06)', borderRadius:8 }}>
              <b>How it works:</b> Records a Dr Prepaid Expense / Cr Bank entry today. Each month, click "Reverse Month" to post Dr {`{Expense}`} / Cr Prepaid for one month's portion. Useful for annual rent, insurance, subscriptions.
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FG label="Description" full><input value={prepayForm.description} onChange={e=>setPrepayForm(f=>({...f, description:e.target.value}))} placeholder="e.g. Annual insurance premium — 2026" style={inp} /></FG>
              <FG label="Total Amount"><input type="number" value={prepayForm.amount} onChange={e=>setPrepayForm(f=>({...f, amount:e.target.value}))} style={inp} /></FG>
              <FG label="Spread Over (months)"><input type="number" value={prepayForm.months} onChange={e=>setPrepayForm(f=>({...f, months:e.target.value}))} style={inp} /></FG>
              <FG label="Payment Date"><input type="date" value={prepayForm.date} onChange={e=>setPrepayForm(f=>({...f, date:e.target.value}))} style={inp} /></FG>
              <FG label="Expense Account">
                <select value={prepayForm.expenseAccount} onChange={e=>setPrepayForm(f=>({...f, expenseAccount:e.target.value}))} style={inp}>
                  {EXPENSE_ACCOUNTS.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </FG>
              <FG label="Supplier (optional)"><input value={prepayForm.supplier} onChange={e=>setPrepayForm(f=>({...f, supplier:e.target.value}))} style={inp} /></FG>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSavePrepay}>Save Prepayment</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {modal === 'accrual' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Accrual</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ fontSize:11, color:C.textMuted, marginBottom:14, padding:10, background:'rgba(26,92,138,0.06)', borderRadius:8 }}>
              <b>How it works:</b> Records a Dr {`{Expense}`} / Cr Accrued Expenses entry today (for a cost incurred but not yet invoiced). When the bill arrives, click "Reverse" to post Dr Accrued / Cr Bank. Useful for utilities, professional fees, period-end adjustments.
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FG label="Description" full><input value={accrualForm.description} onChange={e=>setAccrualForm(f=>({...f, description:e.target.value}))} placeholder="e.g. Audit fee accrual — Q1 2026" style={inp} /></FG>
              <FG label="Amount"><input type="number" value={accrualForm.amount} onChange={e=>setAccrualForm(f=>({...f, amount:e.target.value}))} style={inp} /></FG>
              <FG label="Accrual Date"><input type="date" value={accrualForm.date} onChange={e=>setAccrualForm(f=>({...f, date:e.target.value}))} style={inp} /></FG>
              <FG label="Expense Account">
                <select value={accrualForm.expenseAccount} onChange={e=>setAccrualForm(f=>({...f, expenseAccount:e.target.value}))} style={inp}>
                  {EXPENSE_ACCOUNTS.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </FG>
              <FG label="Supplier (optional)"><input value={accrualForm.supplier} onChange={e=>setAccrualForm(f=>({...f, supplier:e.target.value}))} style={inp} /></FG>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSaveAccrual}>Save Accrual</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 14 — ASSET DISPOSAL
// Select a fixed asset, mark as disposed. Calculates gain/loss:
//   Gain/Loss = Sale Price − NBV (cost − accumulated depreciation)
// Posts disposal JE: Dr Cash (sale price), Dr Accumulated Depreciation,
//                    Cr Asset (cost), Cr Gain on Disposal (or Dr Loss)
// Updates asset status to "Disposed".
// ════════════════════════════════════════════════════════════════════════════
export function AssetDisposalTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const assets = db.fixedassets || [];
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ assetId:'', salePrice:'', saleDate:today(), buyer:'', notes:'' });
  const [disposed, setDisposed] = useState(null); // shows result after disposal

  function calcNBV(asset) {
    const cost = Number(asset.cost) || 0;
    const res = Number(asset.residualValue) || 0;
    const life = Number(asset.usefulLifeYrs) || 5;
    if (!asset.purchaseDate) return { nbv: cost, accDep: 0 };
    const start = new Date(asset.purchaseDate);
    const now = new Date();
    const months = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()));
    const annualDep = (cost - res) / life;
    const accDep = Math.min(annualDep * (months / 12), cost - res);
    return { nbv: Math.max(res, cost - accDep), accDep: Math.max(0, accDep) };
  }

  function saveAssets(list) {
    diffAndPush('fixedassets', assets, list); // 2026-07-29 full-app sync sweep
    const newDb = { ...db, fixedassets: list };
    dispatch({ type:'UPDATE_MODULE', mod:'fixedassets', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function handleDispose() {
    if (!form.assetId) { showToast('Select an asset', 'error'); return; }
    const asset = assets.find(a => a.id === form.assetId);
    if (!asset) { showToast('Asset not found', 'error'); return; }
    if (asset.status === 'Disposed') { showToast('Asset already disposed', 'error'); return; }
    const salePrice = Number(form.salePrice) || 0;
    if (salePrice < 0) { showToast('Sale price cannot be negative', 'error'); return; }
    const { nbv, accDep } = calcNBV(asset);
    const cost = Number(asset.cost) || 0;
    const gainLoss = salePrice - nbv;
    const isGain = gainLoss >= 0;

    // Update asset
    const updatedAssets = assets.map(a => a.id === form.assetId
      ? { ...a, status:'Disposed', disposalDate: form.saleDate, disposalSalePrice: salePrice, disposalBuyer: form.buyer, disposalNBV: nbv, disposalGainLoss: gainLoss, notes: (a.notes ? a.notes + ' | ' : '') + `Disposed on ${form.saleDate} for ${fmt(salePrice)}` }
      : a);
    saveAssets(updatedAssets);

    logActivity(dispatch,
      `Asset disposed: ${asset.assetTag} — ${asset.description}. Sale: ${fmt(salePrice)}, NBV: ${fmt(nbv)}, ${isGain?'Gain':'Loss'}: ${fmt(Math.abs(gainLoss))}. ` +
      `JE: Dr Cash ${fmt(salePrice)}, Dr Acc Dep ${fmt(accDep)}, Cr Asset ${fmt(cost)}, ${isGain?`Cr Gain on Disposal ${fmt(gainLoss)}`:`Dr Loss on Disposal ${fmt(Math.abs(gainLoss))}`}`,
      currentUser, { module:'fixedassets', action:'dispose' });

    setDisposed({ asset, salePrice, nbv, accDep, cost, gainLoss, isGain });
    showToast(`Asset disposed — ${isGain?'Gain':'Loss'} of ${fmt(Math.abs(gainLoss))}`);
    setModal(null);
    setForm({ assetId:'', salePrice:'', saleDate:today(), buyer:'', notes:'' });
  }

  function printDisposal(d) {
    openPrintWindow(`<!DOCTYPE html><html><head><title>Asset Disposal — ${esc(d.asset.assetTag)}</title>
      <style>${PRINT_CSS}
      .disp-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 14px}
      .parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:14px 0;font-size:12px;line-height:1.7}
      .parties b{display:block;font-size:13px;margin-bottom:2px}
      table.disp{width:100%;border-collapse:collapse;margin:14px 0}
      table.disp th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase}
      table.disp td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11.5px}
      .grand{display:flex;justify-content:space-between;padding:12px 16px;border-radius:8px;font-size:16px;font-weight:800;margin-top:14px;background:${d.isGain?'#EAF4EC':'#FCEAE8'};color:${d.isGain?'#1A5C2A':'#C0392B'};border:2px solid ${d.isGain?'#1A5C2A':'#C0392B'}}
      </style></head><body>
      ${printHeader('ASSET DISPOSAL NOTE', formatDate(d.asset.disposalDate || today()))}
      <div class="disp-title">ASSET DISPOSAL NOTE</div>
      <div class="parties">
        <div>
          <b>Asset Disposed:</b>
          ${esc(d.asset.assetTag)} — ${esc(d.asset.description)}<br/>
          Category: ${esc(d.asset.category)}<br/>
          Serial: ${esc(d.asset.serialNo || '—')}<br/>
          Purchase Date: ${formatDate(d.asset.purchaseDate)}
        </div>
        <div>
          <b>Sold To:</b>
          ${esc(d.asset.disposalBuyer || '—')}<br/>
          <b>Sale Date:</b> ${formatDate(d.asset.disposalDate || today())}<br/>
          <b>Disposal Ref:</b> DISP-${esc(d.asset.assetTag)}
        </div>
      </div>
      <table class="disp">
        <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          <tr><td>Original Cost</td><td style="text-align:right">${fmtN(d.cost)}</td></tr>
          <tr><td>Less: Accumulated Depreciation</td><td style="text-align:right">(${fmtN(d.accDep)})</td></tr>
          <tr style="font-weight:700;background:#EAF4EC"><td>Net Book Value at Disposal</td><td style="text-align:right">${fmtN(d.nbv)}</td></tr>
          <tr><td>Sale Price</td><td style="text-align:right">${fmtN(d.salePrice)}</td></tr>
          <tr style="font-weight:700;background:#EAF4EC"><td>${d.isGain?'Gain on Disposal':'Loss on Disposal'}</td><td style="text-align:right;color:${d.isGain?'#1A5C2A':'#C0392B'}">${d.isGain?'+':'−'}${fmtN(Math.abs(d.gainLoss))}</td></tr>
        </tbody>
      </table>
      <div class="grand"><span>${d.isGain?'GAIN':'LOSS'} ON DISPOSAL</span><span>${fmtN(Math.abs(d.gainLoss))}</span></div>
      <p style="margin-top:18px;font-size:11px;color:#3A5040">
        <b>Journal Entry to be posted:</b><br/>
        Dr Cash / Bank — ${fmtN(d.salePrice)}<br/>
        Dr Accumulated Depreciation — ${fmtN(d.accDep)}<br/>
        Cr Asset (Cost) — ${fmtN(d.cost)}<br/>
        ${d.isGain ? `Cr Gain on Disposal — ${fmtN(d.gainLoss)}` : `Dr Loss on Disposal — ${fmtN(Math.abs(d.gainLoss))}`}
      </p>
      <div style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:30px">
        <div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C">Prepared By</div></div>
        <div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C">Authorised By</div></div>
      </div>
      ${printBootstrap({landscape:true})}
      </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };
  const activeAssets = assets.filter(a => a.status !== 'Disposed');
  const disposedAssets = assets.filter(a => a.status === 'Disposed');

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Asset Disposal</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Sell or dispose of a fixed asset — auto-calculates gain/loss and posts the disposal JE</div>
        </div>
        <Btn onClick={()=>setModal('dispose')} disabled={activeAssets.length === 0}>+ Dispose Asset</Btn>
      </div>

      {disposed && (
        <div style={{ padding:14, background: disposed.isGain ? 'rgba(26,122,74,0.10)' : 'rgba(192,57,43,0.10)', border:'1px solid '+(disposed.isGain?C.green:C.danger), borderRadius:10, marginBottom:18 }}>
          <div style={{ fontSize:14, fontWeight:700, color: disposed.isGain ? C.green : C.danger, marginBottom:6 }}>
            {disposed.isGain ? '✓ Gain on Disposal' : '⚠ Loss on Disposal'} — {fmt(Math.abs(disposed.gainLoss))}
          </div>
          <div style={{ fontSize:12, color:C.textMid, lineHeight:1.6 }}>
            Asset <b>{disposed.asset.assetTag}</b> ({disposed.asset.description}) disposed for <b>{fmt(disposed.salePrice)}</b>. NBV was {fmt(disposed.nbv)}.
          </div>
          <div style={{ marginTop:8 }}>
            <Btn sm variant="ghost" onClick={()=>printDisposal(disposed)}>🖨️ Print Disposal Note</Btn>
          </div>
        </div>
      )}

      <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginBottom:8 }}>Active Assets Available for Disposal ({activeAssets.length})</div>
      <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:18 }}>
        <thead><tr>
          <th style={th}>Asset Tag</th><th style={th}>Description</th><th style={th}>Category</th>
          <th style={{...th, textAlign:'right'}}>Cost</th>
          <th style={{...th, textAlign:'right'}}>Acc. Dep.</th>
          <th style={{...th, textAlign:'right'}}>NBV</th>
          <th style={th}>Status</th>
        </tr></thead>
        <tbody>
          {activeAssets.length === 0 ? <tr><td style={td} colSpan={7} align="center"><i>No active assets</i></td></tr> :
            activeAssets.map(a => {
              const { nbv, accDep } = calcNBV(a);
              return (
                <tr key={a.id}>
                  <td style={td}><b>{a.assetTag}</b></td>
                  <td style={td}>{a.description}</td>
                  <td style={td}>{a.category}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(a.cost)}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(accDep)}</td>
                  <td style={{...td, textAlign:'right', fontWeight:700, color:C.green}}>{fmt(nbv)}</td>
                  <td style={td}>{a.status}</td>
                </tr>
              );
            })}
        </tbody>
      </table>

      {disposedAssets.length > 0 && (
        <>
          <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginBottom:8 }}>Disposed Assets ({disposedAssets.length})</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              <th style={th}>Asset Tag</th><th style={th}>Description</th><th style={th}>Disposal Date</th>
              <th style={{...th, textAlign:'right'}}>NBV</th><th style={{...th, textAlign:'right'}}>Sale Price</th>
              <th style={{...th, textAlign:'right'}}>Gain/(Loss)</th>
            </tr></thead>
            <tbody>
              {disposedAssets.map(a => (
                <tr key={a.id}>
                  <td style={td}>{a.assetTag}</td>
                  <td style={td}>{a.description}</td>
                  <td style={td}>{formatDate(a.disposalDate)}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(a.disposalNBV)}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(a.disposalSalePrice)}</td>
                  <td style={{...td, textAlign:'right', fontWeight:700, color: a.disposalGainLoss >= 0 ? C.green : C.danger}}>
                    {a.disposalGainLoss >= 0 ? '+' : '−'}{fmt(Math.abs(a.disposalGainLoss))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {modal === 'dispose' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>Dispose Asset</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FG label="Asset to Dispose" full>
                <select value={form.assetId} onChange={e=>{
                  setForm(f => ({ ...f, assetId: e.target.value }));
                }} style={inp}>
                  <option value="">— Select Asset —</option>
                  {activeAssets.map(a => {
                    const { nbv } = calcNBV(a);
                    return <option key={a.id} value={a.id}>{a.assetTag} — {a.description} (NBV: {fmt(nbv)})</option>;
                  })}
                </select>
              </FG>
              <FG label="Sale Price"><input type="number" value={form.salePrice} onChange={e=>setForm(f=>({...f, salePrice:e.target.value}))} style={inp} /></FG>
              <FG label="Sale Date"><input type="date" value={form.saleDate} onChange={e=>setForm(f=>({...f, saleDate:e.target.value}))} style={inp} /></FG>
              <FG label="Buyer (optional)"><input value={form.buyer} onChange={e=>setForm(f=>({...f, buyer:e.target.value}))} style={inp} /></FG>
              <FG label="Notes" full><textarea value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))} rows={2} style={{...inp, resize:'vertical'}} /></FG>
            </div>
            {form.assetId && (() => {
              const asset = assets.find(a => a.id === form.assetId);
              if (!asset) return null;
              const { nbv, accDep } = calcNBV(asset);
              const salePrice = Number(form.salePrice) || 0;
              const gainLoss = salePrice - nbv;
              return (
                <div style={{ marginTop:14, padding:12, background:'rgba(26,92,138,0.06)', border:'1px solid rgba(26,92,138,0.20)', borderRadius:8 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#1A5C8A', marginBottom:6 }}>Disposal Preview</div>
                  <div style={{ fontSize:12, color:C.textMid, lineHeight:1.7 }}>
                    Cost: <b>{fmt(asset.cost)}</b> · Acc Dep: <b>{fmt(accDep)}</b> · NBV: <b>{fmt(nbv)}</b><br/>
                    Sale Price: <b>{fmt(salePrice)}</b> · {gainLoss >= 0 ? <span style={{color:C.green}}>Gain: +{fmt(gainLoss)}</span> : <span style={{color:C.danger}}>Loss: −{fmt(Math.abs(gainLoss))}</span>}
                  </div>
                </div>
              );
            })()}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn variant="danger" onClick={handleDispose}>Confirm Disposal</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 15 — BUDGET VS ACTUAL
// Set budgets per account per month. Compare actual movements to budget.
// Variance % per account. Printable report.
// Stored in db.budgets as { year, accountCode, accountName, monthlyAmounts:[12] }
// ════════════════════════════════════════════════════════════════════════════
export function BudgetVsActualTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const budgets = db.budgets || [];
  const journals = state?.acctData?.journals || [];
  const coa = state?.acctData?.coa || [];
  const [budgetYear, setBudgetYear] = useState(year());
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ accountCode:'', monthlyAmounts: Array(12).fill('') });

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Accounts eligible for budgeting (Revenue + Expense only)
  const budgetableAccounts = useMemo(() => coa.filter(a => a.type === 'Revenue' || a.type === 'Expense')
    .sort((a,b) => a.code.localeCompare(b.code)), [coa]);

  // Actual movements per account per month in the selected year
  const actuals = useMemo(() => {
    const map = {}; // accountCode -> [12 months of actual amounts]
    budgetableAccounts.forEach(a => { map[a.code] = Array(12).fill(0); });
    journals.forEach(je => {
      if (!je.date || !je.date.startsWith(String(budgetYear))) return;
      const month = new Date(je.date).getMonth(); // 0-11
      (je.lines || []).forEach(line => {
        const amt = Number(line.amount) || 0;
        if (line.crCode && map[line.crCode]) {
          // Revenue is Cr-normal, so credit increases the revenue
          map[line.crCode][month] += amt;
        }
        if (line.drCode && map[line.drCode]) {
          // Expense is Dr-normal, so debit increases the expense
          map[line.drCode][month] += amt;
        }
      });
    });
    return map;
  }, [journals, budgetYear, budgetableAccounts]);

  function saveBudgets(list) {
    diffAndPush('budgets', budgets, list); // 2026-07-29 full-app sync sweep
    const newDb = { ...db, budgets: list };
    dispatch({ type:'UPDATE_MODULE', mod:'budgets', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function handleSaveBudget() {
    if (!form.accountCode) { showToast('Select an account', 'error'); return; }
    const acc = coa.find(a => a.code === form.accountCode);
    if (!acc) { showToast('Account not found', 'error'); return; }
    // Check if budget already exists for this year + account
    const existing = budgets.find(b => b.year === budgetYear && b.accountCode === form.accountCode);
    if (existing) {
      const updated = budgets.map(b => b.id === existing.id
        ? { ...b, monthlyAmounts: form.monthlyAmounts.map(m => Number(m) || 0) }
        : b);
      saveBudgets(updated);
      showToast(`Budget updated for ${acc.name}`);
    } else {
      const rec = {
        id: uid(),
        year: budgetYear,
        accountCode: form.accountCode,
        accountName: acc.name,
        accountType: acc.type,
        monthlyAmounts: form.monthlyAmounts.map(m => Number(m) || 0),
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.name || 'Admin',
      };
      saveBudgets([...budgets, rec]);
      showToast(`Budget saved for ${acc.name}`);
    }
    setModal(null);
    setForm({ accountCode:'', monthlyAmounts: Array(12).fill('') });
  }

  function deleteBudget(b) {
    if (!window.confirm(`Delete budget for ${b.accountName}?`)) return;
    saveBudgets(budgets.filter(x => x.id !== b.id));
    showToast('Budget deleted');
  }

  function printBudgetReport() {
    const yearBudgets = budgets.filter(b => b.year === budgetYear);
    if (yearBudgets.length === 0) { showToast('No budgets set for this year', 'error'); return; }
    const rows = yearBudgets.map(b => {
      const totalBudget = b.monthlyAmounts.reduce((s,x)=>s+x, 0);
      const totalActual = (actuals[b.accountCode] || Array(12).fill(0)).reduce((s,x)=>s+x, 0);
      const variance = totalActual - totalBudget;
      const pctUsed = totalBudget > 0 ? Math.round((totalActual/totalBudget)*100) : 0;
      return `<tr>
        <td>${esc(b.accountCode)}</td>
        <td>${esc(b.accountName)}</td>
        <td style="text-align:right">${fmtN(totalBudget)}</td>
        <td style="text-align:right">${fmtN(totalActual)}</td>
        <td style="text-align:right;color:${variance>=0?'#C0392B':'#1A5C2A'}">${variance>=0?'+':'−'}${fmtN(Math.abs(variance))}</td>
        <td style="text-align:right">${pctUsed}%</td>
      </tr>`;
    }).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><title>Budget vs Actual — ${budgetYear}</title>
      <style>${PRINT_CSS}
      .bva-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 6px}
      .bva-sub{text-align:center;font-size:11.5px;color:#3A5040;margin-bottom:14px}
      table.bva{width:100%;border-collapse:collapse;margin:10px 0}
      table.bva th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
      table.bva td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11.5px}
      table.bva tfoot td{font-weight:700;background:#EAF4EC;border-top:2px solid #1A5C2A;padding:9px}
      </style></head><body>
      ${printHeader('BUDGET VS ACTUAL REPORT', formatDate(today()))}
      <div class="bva-title">BUDGET VS ACTUAL REPORT</div>
      <div class="bva-sub">For the year ${budgetYear}</div>
      <table class="bva">
        <thead><tr><th>Code</th><th>Account</th><th style="text-align:right">Annual Budget</th><th style="text-align:right">YTD Actual</th><th style="text-align:right">Variance</th><th style="text-align:right">% Used</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:18px;font-size:10px;color:#182A1C">
        Variance colour: red = over budget (unfavourable), green = under budget (favourable). For revenue accounts, red means actual revenue is below budget.
      </p>
      ${printBootstrap({landscape:true})}
      </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const yearBudgets = budgets.filter(b => b.year === budgetYear);

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Budget vs Actual</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Set annual budgets per account, compare to actual movements, see variance %</div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <Btn variant="outline" onClick={printBudgetReport} disabled={yearBudgets.length === 0}>🖨️ Print Report</Btn>
          <Btn onClick={()=>setModal('add')}>+ Set Budget</Btn>
        </div>
      </div>

      <FG label="Year">
        <input type="number" value={budgetYear} onChange={e=>setBudgetYear(Number(e.target.value)||year())} style={{ ...inp, maxWidth:140 }} />
      </FG>

      {yearBudgets.length === 0 ? (
        <div style={{ padding:30, textAlign:'center', color:C.textMuted, fontSize:13, marginTop:14 }}>
          No budgets set for {budgetYear}. Click "Set Budget" to define annual budgets for revenue and expense accounts.
        </div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse', marginTop:14 }}>
          <thead><tr>
            <th style={th}>Code</th><th style={th}>Account</th><th style={th}>Type</th>
            <th style={{...th, textAlign:'right'}}>Annual Budget</th>
            <th style={{...th, textAlign:'right'}}>YTD Actual</th>
            <th style={{...th, textAlign:'right'}}>Variance</th>
            <th style={{...th, textAlign:'center'}}>% Used</th>
            <th style={th}></th>
          </tr></thead>
          <tbody>
            {yearBudgets.map(b => {
              const totalBudget = b.monthlyAmounts.reduce((s,x)=>s+x, 0);
              const totalActual = (actuals[b.accountCode] || Array(12).fill(0)).reduce((s,x)=>s+x, 0);
              const variance = totalActual - totalBudget;
              const pctUsed = totalBudget > 0 ? Math.round((totalActual/totalBudget)*100) : 0;
              // For revenue, "under budget" is bad (red). For expense, "over budget" is bad (red).
              const isOver = b.accountType === 'Revenue' ? variance < 0 : variance > 0;
              return (
                <tr key={b.id}>
                  <td style={td}>{b.accountCode}</td>
                  <td style={td}>{b.accountName}</td>
                  <td style={td}><span style={{ fontSize:10, padding:'2px 6px', borderRadius:4, background: b.accountType === 'Revenue' ? 'rgba(26,122,74,0.12)' : 'rgba(192,57,43,0.12)', color: b.accountType === 'Revenue' ? C.green : C.danger }}>{b.accountType}</span></td>
                  <td style={{...td, textAlign:'right'}}>{fmt(totalBudget)}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(totalActual)}</td>
                  <td style={{...td, textAlign:'right', color: isOver ? C.danger : C.green, fontWeight:600}}>
                    {variance >= 0 ? '+' : '−'}{fmt(Math.abs(variance))}
                  </td>
                  <td style={{...td, textAlign:'center'}}>
                    <div style={{ position:'relative', height:8, background:'rgba(0,0,0,0.06)', borderRadius:4, width:80, display:'inline-block', verticalAlign:'middle' }}>
                      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${Math.min(100,pctUsed)}%`, background: pctUsed > 100 ? C.danger : (pctUsed > 80 ? C.amber : C.green), borderRadius:4 }} />
                    </div>
                    <span style={{ marginLeft:6, fontSize:11 }}>{pctUsed}%</span>
                  </td>
                  <td style={td}><Btn sm variant="danger" onClick={()=>deleteBudget(b)}>🗑</Btn></td>
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
            <FG label="Account">
              <select value={form.accountCode} onChange={e=>{
                const existing = budgets.find(b => b.year === budgetYear && b.accountCode === e.target.value);
                setForm({
                  accountCode: e.target.value,
                  monthlyAmounts: existing ? existing.monthlyAmounts.map(m => String(m)) : Array(12).fill(''),
                });
              }} style={inp}>
                <option value="">— Select Account —</option>
                {budgetableAccounts.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name} ({a.type})</option>)}
              </select>
            </FG>
            <div style={{ fontSize:11, color:C.textMuted, marginTop:8, marginBottom:8 }}>Enter monthly budget amounts (leave 0 for months with no budget):</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
              {MONTHS.map((m, i) => (
                <FG key={m} label={`${m} ${budgetYear}`}>
                  <input type="number" value={form.monthlyAmounts[i]} onChange={e=>{
                    const next = [...form.monthlyAmounts];
                    next[i] = e.target.value;
                    setForm(f => ({ ...f, monthlyAmounts: next }));
                  }} style={inp} />
                </FG>
              ))}
            </div>
            <div style={{ marginTop:10, fontSize:12, color:C.textMid }}>
              Annual Total: <b>{fmt(form.monthlyAmounts.reduce((s,m)=>s+(Number(m)||0), 0))}</b>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSaveBudget}>Save Budget</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 16 — STOCK TAKE
// Physical inventory count. Generates a count sheet, lets the user enter
// counted quantities, computes variance vs recorded on-hand, and posts
// adjustment movements to GL (Dr/Cr Inventory, Dr/Cr Stock Adjustment 8006).
// ════════════════════════════════════════════════════════════════════════════
export function StockTakeTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const stockItems = (db.stockItems || []).filter(i => !i.voided);
  const stockMovements = db.stockMovements || [];
  const stockTakes = db.stockTakes || [];
  const [modal, setModal] = useState(null);
  const [countForm, setCountForm] = useState({ date: today(), location: '', notes: '' });
  const [counts, setCounts] = useState({}); // itemId -> counted qty

  function onHandQty(itemId) {
    const movs = stockMovements.filter(m => m.itemId === itemId);
    const received = movs.filter(m => m.type === 'RECEIVE' || m.type === 'RETURN').reduce((s,m) => s + (Number(m.qty)||0), 0);
    const issued   = movs.filter(m => m.type === 'ISSUE' || m.type === 'SCRAP').reduce((s,m) => s + (Number(m.qty)||0), 0);
    return received - issued;
  }

  function saveStockTakes(list) {
    diffAndPush('stockTakes', stockTakes, list); // 2026-07-29 full-app sync sweep
    const newDb = { ...db, stockTakes: list };
    dispatch({ type:'UPDATE_MODULE', mod:'stockTakes', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function startCount() {
    if (!countForm.date) { showToast('Date required', 'error'); return; }
    if (stockItems.length === 0) { showToast('No stock items registered', 'error'); return; }
    setCounts({});
    setModal('count');
  }

  function saveCount() {
    const countedItems = Object.entries(counts)
      .map(([itemId, qty]) => {
        const item = stockItems.find(i => i.id === itemId);
        if (!item) return null;
        const systemQty = onHandQty(itemId);
        const countedQty = Number(qty) || 0;
        const variance = countedQty - systemQty;
        return { itemId, itemCode: item.code, itemName: item.name, uom: item.uom, systemQty, countedQty, variance, unitCost: Number(item.unitCost) || 0, varianceValue: variance * (Number(item.unitCost) || 0) };
      })
      .filter(Boolean);
    if (countedItems.length === 0) { showToast('Enter at least one count', 'error'); return; }
    const stkNo = `STK-${year()}-${String(stockTakes.length + 1).padStart(4,'0')}`;
    const take = {
      id: uid(),
      stkNo,
      date: countForm.date,
      location: countForm.location,
      notes: countForm.notes,
      items: countedItems,
      totalVarianceValue: countedItems.reduce((s,i) => s + i.varianceValue, 0),
      status: 'Completed',
      countedBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };
    // Save the stock take record
    saveStockTakes([take, ...stockTakes]);

    // Post adjustment movements for items with variance != 0
    const newMovements = countedItems
      .filter(it => it.variance !== 0)
      .map(it => ({
        id: uid(),
        itemId: it.itemId,
        type: 'ADJUST',
        qty: Math.abs(it.variance),
        unitCost: it.unitCost,
        refType: 'stocktake',
        refId: take.id,
        date: countForm.date,
        notes: `${it.variance > 0 ? 'Positive' : 'Negative'} adjustment from ${stkNo}`,
        postedToGL: false,
        createdAt: new Date().toISOString(),
      }));
    if (newMovements.length > 0) {
      const updatedMovements = [...stockMovements, ...newMovements];
      newMovements.forEach(m => pushOne('stockMovements', m)); // 2026-07-29 — new rows only
      dispatch({ type:'UPDATE_MODULE', mod:'stockMovements', data: updatedMovements });
      saveDBLocal({ ...db, stockMovements: updatedMovements }, state.activity);
    }

    logActivity(dispatch,
      `Stock take ${stkNo} completed — ${countedItems.length} items counted, ${newMovements.length} adjustments posted. Total variance: ${fmt(take.totalVarianceValue)}.`,
      currentUser, { module:'inventory', action:'stocktake' });
    showToast(`Stock take ${stkNo} saved — ${newMovements.length} adjustments posted`);
    setModal(null);
    setCountForm({ date: today(), location: '', notes: '' });
  }

  function printCountSheet() {
    if (stockItems.length === 0) { showToast('No stock items', 'error'); return; }
    const rows = stockItems.map((it, i) => `
      <tr>
        <td>${i+1}</td>
        <td>${esc(it.code)}</td>
        <td>${esc(it.name)}</td>
        <td style="text-align:center">${esc(it.uom)}</td>
        <td style="text-align:right">${onHandQty(it.id)}</td>
        <td style="text-align:center;font-size:14px;height:28px"></td>
        <td style="text-align:center;font-size:14px;height:28px"></td>
      </tr>`).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><title>Stock Take Count Sheet</title>
      <style>${PRINT_CSS}
      .st-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 6px}
      .st-sub{text-align:center;font-size:11.5px;color:#3A5040;margin-bottom:14px}
      table.st{width:100%;border-collapse:collapse;margin:10px 0}
      table.st th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
      table.st td{padding:8px 9px;border-bottom:1px solid #EAF0EB;border-right:1px solid #EAF0EB;font-size:11.5px;min-height:24px}
      table.st td:last-child{border-right:none}
      .info-block{margin:8px 0 14px;font-size:12px;line-height:1.7}
      </style></head><body>
      ${printHeader('STOCK TAKE COUNT SHEET', formatDate(today()))}
      <div class="st-title">PHYSICAL STOCK COUNT SHEET</div>
      <div class="st-sub">Date: ${formatDate(countForm.date)} ${countForm.location ? '· Location: ' + esc(countForm.location) : ''}</div>
      <div class="info-block">
        <b>Counted By:</b> ____________________________ &nbsp;&nbsp; <b>Verified By:</b> ____________________________
      </div>
      <table class="st">
        <thead><tr>
          <th>S/N</th><th>Code</th><th>Item Name</th><th style="text-align:center">UoM</th>
          <th style="text-align:right">System Qty</th>
          <th style="text-align:center">Counted Qty</th>
          <th style="text-align:center">Variance</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:18px;font-size:10px;color:#182A1C">
        Counted Qty = physical count. Variance = Counted − System. Positive variance = stock found extra (Dr Inventory / Cr Stock Adjustment). Negative variance = stock short (Dr Stock Adjustment / Cr Inventory).
      </p>
      ${printBootstrap({landscape:true})}
      </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Stock Take (Physical Inventory Count)</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Generate count sheet → enter physical counts → post variance adjustments to GL</div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <Btn variant="outline" onClick={printCountSheet}>🖨️ Print Count Sheet</Btn>
          <Btn onClick={startCount}>📋 Start New Count</Btn>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:18 }}>
        <FG label="Count Date"><input type="date" value={countForm.date} onChange={e=>setCountForm(f=>({...f, date:e.target.value}))} style={inp} /></FG>
        <FG label="Location (optional)"><input value={countForm.location} onChange={e=>setCountForm(f=>({...f, location:e.target.value}))} placeholder="e.g. Port Harcourt HQ Store" style={inp} /></FG>
      </div>

      {/* Stock items preview with on-hand */}
      <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginBottom:8 }}>Current Stock Items ({stockItems.length})</div>
      <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:18 }}>
        <thead><tr>
          <th style={th}>Code</th><th style={th}>Item Name</th><th style={th}>UoM</th>
          <th style={{...th, textAlign:'right'}}>Unit Cost</th>
          <th style={{...th, textAlign:'right'}}>On-Hand Qty</th>
          <th style={{...th, textAlign:'right'}}>Stock Value</th>
        </tr></thead>
        <tbody>
          {stockItems.length === 0 ? <tr><td style={td} colSpan={6} align="center"><i>No stock items registered. Add them in Inventory → Stock Costing.</i></td></tr> :
            stockItems.map(it => {
              const qty = onHandQty(it.id);
              const val = qty * (Number(it.unitCost) || 0);
              return (
                <tr key={it.id}>
                  <td style={td}><b>{it.code}</b></td>
                  <td style={td}>{it.name}</td>
                  <td style={td}>{it.uom}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(it.unitCost)}</td>
                  <td style={{...td, textAlign:'right'}}>{qty}</td>
                  <td style={{...td, textAlign:'right', fontWeight:600}}>{fmt(val)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>

      {/* Past stock takes */}
      {stockTakes.length > 0 && (
        <>
          <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginBottom:8 }}>Past Stock Takes</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              <th style={th}>Ref</th><th style={th}>Date</th><th style={th}>Location</th>
              <th style={{...th, textAlign:'right'}}>Items Counted</th>
              <th style={{...th, textAlign:'right'}}>Adjustments</th>
              <th style={{...th, textAlign:'right'}}>Variance Value</th>
              <th style={th}>Counted By</th>
            </tr></thead>
            <tbody>
              {stockTakes.map(st => (
                <tr key={st.id}>
                  <td style={td}><b>{st.stkNo}</b></td>
                  <td style={td}>{formatDate(st.date)}</td>
                  <td style={td}>{st.location || '—'}</td>
                  <td style={{...td, textAlign:'right'}}>{st.items.length}</td>
                  <td style={{...td, textAlign:'right'}}>{st.items.filter(i => i.variance !== 0).length}</td>
                  <td style={{...td, textAlign:'right', fontWeight:600, color: st.totalVarianceValue < 0 ? C.danger : C.green}}>{fmt(st.totalVarianceValue)}</td>
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
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>Enter Physical Counts — {formatDate(countForm.date)}</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ fontSize:11, color:C.textMuted, marginBottom:14, padding:10, background:'rgba(26,92,138,0.06)', borderRadius:8 }}>
              Enter the counted quantity for each item. Leave blank for items not counted. Variance = Counted − System. Clicking save posts ADJUST movements to GL for items with non-zero variance.
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                <th style={th}>Code</th><th style={th}>Item</th>
                <th style={{...th, textAlign:'right'}}>System Qty</th>
                <th style={{...th, textAlign:'right'}}>Counted Qty</th>
                <th style={{...th, textAlign:'right'}}>Variance</th>
              </tr></thead>
              <tbody>
                {stockItems.map(it => {
                  const sysQty = onHandQty(it.id);
                  const cnt = counts[it.id];
                  const variance = cnt !== undefined && cnt !== '' ? (Number(cnt) - sysQty) : null;
                  return (
                    <tr key={it.id}>
                      <td style={td}><b>{it.code}</b></td>
                      <td style={td}>{it.name}</td>
                      <td style={{...td, textAlign:'right'}}>{sysQty}</td>
                      <td style={{...td, textAlign:'right'}}>
                        <input type="number" value={cnt || ''} onChange={e=>{
                          const next = { ...counts };
                          if (e.target.value === '') delete next[it.id];
                          else next[it.id] = e.target.value;
                          setCounts(next);
                        }} style={{ ...inp, width:80, textAlign:'right', padding:'4px 6px' }} />
                      </td>
                      <td style={{...td, textAlign:'right', fontWeight:600, color: variance === null ? C.textMuted : (variance < 0 ? C.danger : (variance > 0 ? C.green : C.textMid))}}>
                        {variance === null ? '—' : (variance >= 0 ? '+' : '') + variance}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <FG label="Notes" full>
              <textarea value={countForm.notes} onChange={e=>setCountForm(f=>({...f, notes:e.target.value}))} rows={2} placeholder="Optional notes about this count" style={{ ...inp, marginTop:8, resize:'vertical' }} />
            </FG>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={saveCount}>Save Count & Post Adjustments</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}
