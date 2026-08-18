// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — ACCOUNTS PAYABLE MODULE v1.0
// Supplier bills · payments · aging · analysis
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo }    from '../../utils/auth';
import { showToast, formatDate, generateId } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { getVendors, addVendor }   from '../../utils/vendorMaster';
import { getProjects }  from '../../utils/projectMaster';
import { BANK_ACCOUNTS, DEFAULT_FX } from '../../utils/financeConstants';
import { matchBill, decideOnVariance } from '../../utils/threeWayMatch';
import { diffAndPush } from '../../hooks/usePerRecordSync';
import { printHeader, printBootstrap, openPrintWindow} from '../../utils/logo';
import { getApSource } from '../../utils/apBridge';

const uid   = () => generateId();
const today = () => new Date().toISOString().split('T')[0];
const yr    = () => new Date().getFullYear();

const SYM = { NGN:'₦', USD:'$', EUR:'€', GBP:'£' };
const fmt = (n, cur = 'NGN') =>
  (SYM[cur] || cur + ' ') + (Number(n)||0).toLocaleString('en-NG',{ minimumFractionDigits:2, maximumFractionDigits:2 });

// Live-verify QA fix (2026-08-18): both used to strip every non-digit from
// the WHOLE number before parsing, swallowing the embedded year into the
// sequence so each new document grew by four digits ("SLOT-APB-2026-0001" →
// 20260001 → next "SLOT-APB-2026-20260002" → 202620260002 → ...). Same
// defect already found and fixed in Procurement.jsx's nextNo() — see that
// file's header comment. Now anchored to PREFIX-YEAR-(1-5 digits); an
// already-corrupted 8+ digit number simply stops matching, so the counter
// self-heals without needing a data migration.
function nextBillNo(bills) {
  const y = yr();
  const re = new RegExp('^SLOT-APB-' + y + '-(\\d{1,5})$');
  const nums = bills.map(b => { const m = re.exec(String(b.billNo||'')); return m ? parseInt(m[1],10) : 0; }).filter(Boolean);
  return `SLOT-APB-${y}-${String(nums.length ? Math.max(...nums)+1 : 1).padStart(4,'0')}`;
}
function nextPayNo(payments) {
  const y = yr();
  const re = new RegExp('^SLOT-APV-' + y + '-(\\d{1,5})$');
  const nums = payments.map(p => { const m = re.exec(String(p.paymentNo||'')); return m ? parseInt(m[1],10) : 0; }).filter(Boolean);
  return `SLOT-APV-${y}-${String(nums.length ? Math.max(...nums)+1 : 1).padStart(4,'0')}`;
}

// 2026-07-29 — seed fallback removed permanently (was already emptied
// 2026-07-28, having held five fabricated supplier bills and two fabricated
// payments against real-looking bank account numbers). See App.jsx
// boot-sequence note.

// ── Shared UI ─────────────────────────────────────────────────────────────────
function BillTag({ status }) {
  const { C } = useTheme();
  const map = {
    Unpaid:    [C.amber,  'rgba(201,122,10,.12)'],
    Partial:   [C.warning,'rgba(201,122,10,.12)'],
    Paid:      [C.success,'rgba(26,122,74,.12)' ],
    Overdue:   [C.danger, 'rgba(192,57,43,.12)' ],
    Cancelled: ['#6B7280','rgba(107,114,128,.12)'],
  };
  const [co, bg] = map[status] || map.Unpaid;
  return <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600, color:co, background:bg, border:`1px solid ${co}30`, whiteSpace:'nowrap' }}>{status}</span>;
}
function Btn({ children, onClick, variant='primary', sm, disabled, style={} }) {
  const { C } = useTheme();
  const V = { primary:{bg:C.green,co:'#fff',b:'none'}, ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border}, danger:{bg:C.danger,co:'#fff',b:'none'}, outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green} }[variant]||{};
  return <button onClick={onClick} disabled={disabled} style={{ background:V.bg,color:V.co,border:V.b,borderRadius:7,padding:sm?'4px 11px':'7px 16px',fontSize:sm?11.5:13,fontWeight:500,cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.5:1,display:'inline-flex',alignItems:'center',gap:5,whiteSpace:'nowrap',...style }}>{children}</button>;
}
function KPI({ label, value, sub, accent, alert, onClick }) {
  const { C } = useTheme();
  const c = alert ? C.danger : accent || C.green;
  return (
    <div onClick={onClick} style={{ background:C.bgCard, border:'1px solid '+(alert?C.danger+'40':C.border), borderRadius:12, padding:'13px 15px', flex:1, minWidth:140, position:'relative', boxShadow:C.shadowCard, cursor:onClick?'pointer':'default' }} onMouseEnter={e=>{ if(onClick) e.currentTarget.style.transform='translateY(-2px)'; }} onMouseLeave={e=>{ e.currentTarget.style.transform='translateY(0)'; }}>
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
function Overlay({ children, onClose }) {
  // 2026-08-15: backdrop no longer closes the form on click — see same fix
  // in ui/index.jsx's shared Modal and Procurement.jsx's Overlay.
  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'100%', maxWidth:780, marginBottom:32 }}>{children}</div>
    </div>
  );
}
function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'18px 20px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}
function SecLabel({ label }) {
  const { C } = useTheme();
  return <div style={{ fontSize:11, fontWeight:700, color:C.textMid, textTransform:'uppercase', letterSpacing:'0.4px', margin:'16px 0 8px', paddingBottom:5, borderBottom:'2px solid '+C.greenPale }}>{label}</div>;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AccountsPayable() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db } = state;
  const perms = { add: canDo(currentUser,'canAdd'), edit: canDo(currentUser,'canEdit'), del: canDo(currentUser,'canDelete') };

  const apData  = db.ap || { bills: [], payments: [] };
  // 2026-08-17 fix: this module used to read ONLY the manual ledger below,
  // which a 2026-08-14 code comment already found has "zero real entries
  // anywhere in the system" — every actual supplier invoice is created in
  // Procurement -> Supplier Invoices instead, so AP showed nothing for real
  // payables and there was no way to record a payment against a real
  // invoice. manualBills/manualPayments below are the true db.ap ledger
  // (only what's entered directly in this module — that's what gets written
  // back on save). bills/payments are the real, merged view every READ in
  // this file should use — see utils/apBridge.js.
  const [manualBills,    setManualBills]    = useState(apData.bills    || []);
  const [manualPayments, setManualPayments] = useState(apData.payments || []);
  const bills    = useMemo(() => getApSource(db).bills,    [db.procurement, db.ap]);
  const payments = useMemo(() => getApSource(db).payments, [db.procurement, db.ap]);
  const [tab,    setTab]    = useState('overview');
  const [modal,  setModal]  = useState(null);
  const [ledgerCode, setLedgerCode] = useState(null); // supplier code currently shown in the Supplier Ledger modal
  const EMPTY_SUPPLIER = { code:'', groupKey:'', name:'', currency:'NGN', category:'Other', contact:'', phone:'', email:'', address:'', rc:'', tin:'', status:'Active', rating:0, notes:'' };
  const [supplierForm, setSupplierForm] = useState(EMPTY_SUPPLIER);
  const [selBill, setSelBill] = useState(null);
  const [search, setSearch] = useState('');

  const [vendors, setVendors] = useState(() => getVendors().filter(v => v.status === 'Active'));
  const projects = useMemo(() => getProjects().filter(p => p.status === 'Active'), []);

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const th  = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td  = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const TABS = [
    { id:'overview',  label:'📊 Overview'   },
    { id:'suppliers', label:'🏭 Suppliers'  },
    { id:'bills',     label:'📋 Bills'      },
    { id:'payments',  label:'💳 Payments'   },
    { id:'aging',     label:'📅 Aging'      },
    { id:'analysis',  label:'📈 Analysis'   },
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────
  function saveBills(newBills, newPayments = manualPayments) {
    // Per-record push — 2026-07-29, part of the full-app sync sweep. See
    // ContractStaff.jsx's updateDB for the original pattern this reuses via
    // diffAndPush. apBills/apPayments already had tables (pre-existing) but
    // nothing ever pushed to them — see syncPerRecord.js's getRecordList fix.
    // Operates on the manual ledger only — newBills/newPayments must never
    // include the procurement-derived rows from the merged `bills`/`payments`
    // above, or they'd get written into db.ap.bills as duplicate real records.
    diffAndPush('apBills', manualBills, newBills);
    diffAndPush('apPayments', manualPayments, newPayments);
    setManualBills(newBills);
    const newAp = { bills: newBills, payments: newPayments };
    dispatch({ type:'UPDATE_MODULE', mod:'ap', data: newAp });
    saveDBLocal({ ...db, ap: newAp }, state.activity);
  }
  function saveAll(newBills, newPayments) {
    diffAndPush('apBills', manualBills, newBills);
    diffAndPush('apPayments', manualPayments, newPayments);
    setManualBills(newBills); setManualPayments(newPayments);
    const newAp = { bills: newBills, payments: newPayments };
    dispatch({ type:'UPDATE_MODULE', mod:'ap', data: newAp });
    saveDBLocal({ ...db, ap: newAp }, state.activity);
  }
  // Pays a REAL Procurement supplier invoice. A `source:'procurement'` bill
  // is a computed view over db.procurement.invoices (see utils/apBridge.js) —
  // there's no matching db.ap.bills record to update, so this writes the
  // status straight to the source invoice instead, using the same
  // dispatch+diffAndPush persistence Procurement.jsx's own save() uses for
  // this table so Supabase sync stays consistent no matter which module made
  // the edit.
  function payProcurementInvoice(invoiceId, newStatus) {
    const proc = db.procurement || { rfqs: [], pos: [], waybills: [], invoices: [] };
    const prevInvoices = proc.invoices || [];
    const newInvoices = prevInvoices.map(inv => inv.id === invoiceId ? { ...inv, status: newStatus } : inv);
    diffAndPush('procurementInvoices', prevInvoices, newInvoices);
    const newProc = { ...proc, invoices: newInvoices };
    dispatch({ type: 'UPDATE_MODULE', mod: 'procurement', data: newProc });
    saveDBLocal({ ...db, procurement: newProc }, state.activity);
  }

  const outstanding = useMemo(() =>
    bills.filter(b => b.status !== 'Paid' && b.status !== 'Cancelled')
         .reduce((s, b) => {
           const balRatio = ((Number(b.netPayable)||0) - (Number(b.paidAmount)||0)) / (Number(b.netPayable) || 1);
           return s + (Number(b.ngnEquivalent || b.netPayable)||0) * balRatio;
         }, 0),
  [bills]);

  const overdue = useMemo(() =>
    bills.filter(b => b.status !== 'Paid' && b.status !== 'Cancelled' && new Date(b.dueDate) < new Date()).length,
  [bills]);

  const ytdPaid = useMemo(() =>
    payments.filter(p => p.date?.startsWith(yr().toString()))
             .reduce((s, p) => s + (Number(p.ngnEquivalent || p.amount)||0), 0),
  [payments]);

  const dueThisMonth = useMemo(() => {
    const m = new Date().toISOString().slice(0,7);
    return bills.filter(b => b.status !== 'Paid' && b.status !== 'Cancelled' && b.dueDate?.startsWith(m))
                .reduce((s,b) => {
                  const balRatio = ((Number(b.netPayable)||0) - (Number(b.paidAmount)||0)) / (Number(b.netPayable) || 1);
                  return s + (Number(b.ngnEquivalent || b.netPayable)||0) * balRatio;
                }, 0);
  }, [bills]);

  function agingDays(b) {
    if (b.status === 'Paid' || b.status === 'Cancelled') return null;
    return Math.round((new Date() - new Date(b.dueDate)) / 86400000);
  }

  // ── Bill Form ─────────────────────────────────────────────────────────────
  const EMPTY_BILL = { vendor:'', vendorName:'', currency:'NGN', fxRate:1, category:'', date:today(), dueDate:'', projectCode:'', description:'', amount:'', vatAmount:'', whtRate:5, whtAmount:'', netPayable:'', notes:'' };
  const [form, setForm] = useState(EMPTY_BILL);

  function handleVendorChange(code) {
    const v = vendors.find(v => v.code === code);
    const cur = v?.currency || 'NGN';
    setForm(f => ({ ...f, vendor: code, vendorName: v?.name||'', currency: cur, fxRate: DEFAULT_FX[cur] || 1, category: v?.category||'' }));
  }

  function recomputeBill(f) {
    const amount  = Number(f.amount)  || 0;
    const vatAmt  = Math.round(amount * 7.5 / 100);
    const whtAmt  = Math.round(amount * (Number(f.whtRate)||0) / 100);
    const net     = amount + vatAmt - whtAmt;
    const fxRate  = Number(f.fxRate) || 1;
    return { ...f, vatAmount: vatAmt, whtAmount: whtAmt, netPayable: net, fxRate, ngnEquivalent: Math.round(net * fxRate) };
  }

  function handleSaveBill() {
    if (!form.vendor) { showToast('Select a supplier','error'); return; }
    if (!form.date || !form.dueDate) { showToast('Dates required','error'); return; }
    if (!form.description.trim()) { showToast('Description required','error'); return; }
    if (!Number(form.amount)) { showToast('Enter bill amount','error'); return; }
    const computed = recomputeBill(form);
    const rec = { id: uid(), billNo: nextBillNo(manualBills), ...computed, status:'Unpaid', paidAmount:0, createdAt: new Date().toISOString() };
    const updated = [...manualBills, rec];
    saveBills(updated);
    logActivity(dispatch, `AP Bill ${rec.billNo} created — ${rec.vendorName} ${fmt(rec.netPayable, rec.currency)}`, currentUser);
    showToast('Bill saved'); setModal(null); setForm(EMPTY_BILL);
  }

  // ── Payment Form ──────────────────────────────────────────────────────────
  const EMPTY_PAY = { date:today(), amount:'', fxRate:1, bankCode:'3003', reference:'', notes:'' };
  const [payForm, setPayForm] = useState(EMPTY_PAY);

  function openPayModal(bill) {
    setSelBill(bill);
    const matchingBank = BANK_ACCOUNTS.find(b => b.currency === bill.currency);
    setPayForm({ ...EMPTY_PAY, amount: ((Number(bill.netPayable)||0)-(Number(bill.paidAmount)||0)).toString(), fxRate: bill.fxRate || DEFAULT_FX[bill.currency] || 1, bankCode: matchingBank?.code || '3003' });
    setModal('pay');
  }

  function handleSaveSupplier() {
    if (!supplierForm.code.trim() || !supplierForm.name.trim()) { showToast('Code and name are required', 'error'); return; }
    if (vendors.some(v => v.code === supplierForm.code.trim())) { showToast('A supplier with this code already exists', 'error'); return; }
    addVendor({ ...supplierForm, code: supplierForm.code.trim(), groupKey: supplierForm.groupKey.trim() || supplierForm.code.trim() });
    setVendors(getVendors().filter(v => v.status === 'Active'));
    logActivity(dispatch, `Supplier added: ${supplierForm.name} (${supplierForm.code})`, currentUser);
    showToast('Supplier added');
    setModal(null);
  }

  function handleSavePayment() {
    if (!selBill) return;
    if (!payForm.date) { showToast('Enter payment date','error'); return; }
    if (!Number(payForm.amount)) { showToast('Enter payment amount','error'); return; }

    // Real Procurement invoices don't have a "Partial" status to move to
    // (see InvoiceModal's status list in Procurement.jsx) and don't track a
    // running paidAmount the way a manual AP bill does — paying one here
    // only makes sense as a single full payment. The amount field is
    // read-only for these in the modal below; this is the actual guard.
    if (selBill.source === 'procurement') {
      const balance = (Number(selBill.netPayable)||0) - (Number(selBill.paidAmount)||0);
      if (Math.abs(Number(payForm.amount) - balance) > 0.5) {
        showToast('This is a real Procurement invoice — it can only be paid in full from here. Partial payments on Procurement invoices aren’t tracked yet.', 'error');
        return;
      }
    }

    // ── 3-WAY MATCH CHECK ──────────────────────────────────────────────────
    // Tier 3 fix: previously the AP module paid any bill without verifying
    // that the billed qty/price matched the PO and the goods-received note.
    // Now we run the threeWayMatch utility against the linked PO + waybills
    // and BLOCK payment on critical variances (over-receipt, over-billing).
    // The user can override with a confirmation prompt for non-critical
    // variances, but critical ones require an admin to edit the bill first.
    if (selBill.poId || selBill.poNumber) {
      const procurement = db.procurement || { pos: [], waybills: [] };
      const po = (procurement.pos || []).find(p => p.id === selBill.poId || p.poNo === selBill.poNumber);
      // FIX (T1-1): previously, a bill that named a PO which couldn't be
      // resolved (deleted PO, typo, stale reference) silently skipped the
      // entire 3-way match with no warning — payment proceeded unchecked.
      // That's the exact scenario 3-way match exists to catch.
      if (!po) {
        showToast('⛔ Payment BLOCKED — this bill references a PO that no longer exists. Verify the PO before paying.', 'error');
        return;
      }
      const waybills = (procurement.waybills || []).filter(w => w.poId === po.id || w.poNo === po.poNo);
      const report = matchBill({ bill: selBill, po, waybills });
      if (!report.ok) {
        const decision = decideOnVariance(report);
        if (decision.action === 'block') {
          showToast(`⛔ Payment BLOCKED — ${decision.reason}. Variances: ${report.variances.map(v=>v.message).join('; ')}`, 'error');
          return;
        }
        if (decision.action === 'hold') {
          const proceed = window.confirm(
            `⚠️ 3-WAY MATCH VARIANCE DETECTED\n\n` +
            report.variances.map(v => `• ${v.message}`).join('\n') +
            `\n\n${decision.reason}\n\nPay anyway? (Admin override)`
          );
          if (!proceed) return;
        }
      }
    }

    const payAmt  = Number(payForm.amount);
    const payFx   = Number(payForm.fxRate) || 1;
    const newPaid = (Number(selBill.paidAmount)||0) + payAmt;
    const newStatus = newPaid >= Number(selBill.netPayable) - 0.01 ? 'Paid' : 'Partial';
    const bank = BANK_ACCOUNTS.find(b => b.code === payForm.bankCode);
    const pay = { id:uid(), paymentNo:nextPayNo(payments), billId:selBill.id, billNo:selBill.billNo, vendor:selBill.vendor, vendorName:selBill.vendorName, currency:selBill.currency, fxRate:payFx, date:payForm.date, amount:payAmt, ngnEquivalent:Math.round(payAmt*payFx), bankCode:payForm.bankCode, bankName:bank?.name||'', reference:payForm.reference, notes:payForm.notes, createdAt:new Date().toISOString() };

    if (selBill.source === 'procurement') {
      // The bill IS the Procurement invoice — update the real record (always
      // 'Paid', since partial was already blocked above), and still log the
      // payment itself in the manual ledger's payments list so it shows up
      // in the Payments tab / supplier ledger like any other payment.
      payProcurementInvoice(selBill.id, 'Paid');
      const newPayments = [...manualPayments, pay];
      diffAndPush('apPayments', manualPayments, newPayments);
      setManualPayments(newPayments);
      const newAp = { bills: manualBills, payments: newPayments };
      dispatch({ type:'UPDATE_MODULE', mod:'ap', data: newAp });
      saveDBLocal({ ...db, ap: newAp }, state.activity);
    } else {
      const newBills = manualBills.map(b => b.id === selBill.id ? { ...b, status:newStatus, paidAmount:newPaid } : b);
      const newPayments = [...manualPayments, pay];
      saveAll(newBills, newPayments);
    }
    logActivity(dispatch, `AP Payment ${pay.paymentNo} — ${selBill.vendorName} ${fmt(payAmt, selBill.currency)}`, currentUser);
    showToast('Payment recorded'); setModal(null); setPayForm(EMPTY_PAY); setSelBill(null);
  }

  // ── Filtered bills ─────────────────────────────────────────────────────────
  const filteredBills = useMemo(() => {
    const s = search.toLowerCase();
    return bills.filter(b => !s || b.vendorName.toLowerCase().includes(s) || b.billNo.toLowerCase().includes(s) || (b.projectCode||'').toLowerCase().includes(s));
  }, [bills, search]);

  // ── Aging buckets ─────────────────────────────────────────────────────────
  const agingTable = useMemo(() => {
    const map = {};
    bills.filter(b => b.status !== 'Paid' && b.status !== 'Cancelled').forEach(b => {
      const days = Math.round((new Date() - new Date(b.dueDate)) / 86400000);
      const bal  = (Number(b.netPayable)||0) - (Number(b.paidAmount)||0);
      const balNgn = bal * ((Number(b.ngnEquivalent || b.netPayable)||0) / (Number(b.netPayable)||1));
      if (!map[b.vendor]) map[b.vendor] = { vendor:b.vendor, name:b.vendorName, cur:b.currency, b0:0, b31:0, b61:0, b90:0, b0n:0, b31n:0, b61n:0, b90n:0 };
      const row = map[b.vendor];
      if (days <= 30)      { row.b0  += bal; row.b0n  += balNgn; }
      else if (days <= 60) { row.b31 += bal; row.b31n += balNgn; }
      else if (days <= 90) { row.b61 += bal; row.b61n += balNgn; }
      else                 { row.b90 += bal; row.b90n += balNgn; }
    });
    return Object.values(map);
  }, [bills]);

  // ── Supplier balances ──────────────────────────────────────────────────────
  const supplierBalances = useMemo(() => {
    const map = {};
    vendors.forEach(v => { map[v.code] = { ...v, outstanding:0, outstandingNgn:0, billCount:0 }; });
    bills.filter(b => b.status !== 'Paid' && b.status !== 'Cancelled').forEach(b => {
      if (map[b.vendor]) {
        const bal = (Number(b.netPayable)||0) - (Number(b.paidAmount)||0);
        map[b.vendor].outstanding += bal;
        map[b.vendor].outstandingNgn += bal * ((Number(b.ngnEquivalent || b.netPayable)||0) / (Number(b.netPayable)||1));
        map[b.vendor].billCount++;
      }
    });
    return Object.values(map).sort((a,b) => b.outstandingNgn - a.outstandingNgn);
  }, [bills, vendors]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Accounts Payable</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Supplier bills · payments · aging · analysis</div>
        </div>
        {perms.add && <Btn onClick={()=>{ setForm(EMPTY_BILL); setModal('new-bill'); }}>+ New Bill</Btn>}
      </div>

      {/* Tab Bar */}
      <div style={{ display:'flex', borderBottom:'2px solid '+C.borderLight, gap:0, overflowX:'auto' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:'10px 16px', fontSize:12.5, border:'none', background:'none', cursor:'pointer', fontWeight:tab===t.id?700:400, color:tab===t.id?C.green:C.textMuted, borderBottom:tab===t.id?'2px solid '+C.green:'2px solid transparent', marginBottom:-2, whiteSpace:'nowrap' }}>{t.label}</button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === 'overview' && (
        <>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
            <KPI label="Total Outstanding" value={fmt(outstanding)} sub={`${bills.filter(b=>b.status!=='Paid'&&b.status!=='Cancelled').length} open bills`} onClick={()=>setTab('bills')} />
            <KPI label="Overdue"          value={overdue} alert={overdue>0} sub="bills past due date" onClick={()=>setTab('aging')} />
            <KPI label="Due This Month"   value={fmt(dueThisMonth)} accent={C.amber} sub="due in current month" onClick={()=>setTab('aging')} />
            <KPI label="YTD Payments"     value={fmt(ytdPaid)} accent={C.success} sub={`${payments.filter(p=>p.date?.startsWith(yr().toString())).length} payments made`} onClick={()=>setTab('payments')} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, flexWrap:'wrap' }}>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:12 }}>Top Creditors</div>
              {supplierBalances.filter(s=>s.outstanding>0).slice(0,6).map(s => (
                <div key={s.code} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid '+C.borderLight }}>
                  <div>
                    <div style={{ fontSize:12.5, fontWeight:600, color:C.text }}>{s.name}</div>
                    <div style={{ fontSize:11, color:C.textMuted }}>{s.code} · {s.currency} · {s.billCount} bill{s.billCount!==1?'s':''}</div>
                  </div>
                  <div style={{ fontSize:13, fontWeight:700, color:C.amber }}>{fmt(s.outstanding, s.currency)}</div>
                </div>
              ))}
              {supplierBalances.filter(s=>s.outstanding>0).length === 0 && <div style={{ fontSize:12, color:C.textMuted, textAlign:'center', padding:16 }}>No outstanding payables</div>}
            </Card>
            <Card>
              <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:12 }}>Aging Summary (NGN)</div>
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

      {/* ── SUPPLIERS TAB ── */}
      {tab === 'suppliers' && (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid '+C.borderLight, display:'flex', alignItems:'center', gap:10 }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search supplier…" style={{ ...inp, maxWidth:260 }} />
            <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
              <span style={{ fontSize:11, color:C.textMuted }}>{supplierBalances.length} suppliers</span>
              {perms.add && <Btn sm onClick={()=>{ setSupplierForm(EMPTY_SUPPLIER); setModal('new-supplier'); }}>+ Add Supplier</Btn>}
            </div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>{['Code','Name','Currency','Category','Open Bills','Outstanding Balance',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {supplierBalances.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.code.toLowerCase().includes(search.toLowerCase())).map(s => (
                  <tr key={s.code} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <td style={{ ...td, fontFamily:'monospace', fontSize:11.5, fontWeight:600, color:C.green }}>{s.code}</td>
                    <td style={{ ...td, fontWeight:600 }}>{s.name}</td>
                    <td style={td}><span style={{ fontSize:11, padding:'2px 7px', borderRadius:10, background:s.currency==='NGN'?C.greenPale:C.bgAlt, color:s.currency==='NGN'?C.green:C.amber, fontWeight:600 }}>{s.currency}</span></td>
                    <td style={td}>{s.category||'—'}</td>
                    <td style={{ ...td, textAlign:'center' }}>{s.billCount > 0 ? <span style={{ fontWeight:600, color:C.amber }}>{s.billCount}</span> : '—'}</td>
                    <td style={{ ...td, fontWeight:700, color: s.outstanding>0?C.danger:C.success }}>{s.outstanding > 0 ? fmt(s.outstanding, s.currency) : <span style={{ color:C.success }}>✓ Clear</span>}</td>
                    <td style={td}><Btn sm variant="ghost" onClick={()=>{ setLedgerCode(s.code); setModal('supplier-ledger'); }}>📒 Ledger</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── BILLS TAB ── */}
      {tab === 'bills' && (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderBottom:'1px solid '+C.borderLight, flexWrap:'wrap' }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search vendor, bill no, project…" style={{ ...inp, maxWidth:280 }} />
            <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
              <span style={{ fontSize:11, color:C.textMuted }}>{filteredBills.length} record{filteredBills.length!==1?'s':''}</span>
              {perms.add && <Btn sm onClick={()=>{ setForm(EMPTY_BILL); setModal('new-bill'); }}>+ New Bill</Btn>}
            </div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>{['Bill No','Supplier','Project','Date','Due Date','Net Payable','Status','Aging','Actions'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {filteredBills.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign:'center', padding:32, color:C.textMuted }}>No bills found</td></tr>}
                {filteredBills.map(b => {
                  const days = agingDays(b);
                  return (
                    <tr key={b.id} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                      <td style={{ ...td, fontFamily:'monospace', fontSize:11.5, fontWeight:600, color:C.green }}>{b.billNo}</td>
                      <td style={td}><div style={{ fontWeight:600 }}>{b.vendorName}</div><div style={{ fontSize:11, color:C.textMuted }}>{b.vendor} · {b.currency}</div></td>
                      <td style={{ ...td, fontSize:11.5 }}>{b.projectCode||'—'}</td>
                      <td style={td}>{formatDate(b.date)}</td>
                      <td style={td}>{formatDate(b.dueDate)}</td>
                      <td style={{ ...td, fontWeight:700, color:C.text }}>{fmt(b.netPayable, b.currency)}</td>
                      <td style={td}><BillTag status={b.status} /></td>
                      <td style={td}>{days > 0 ? <span style={{ fontSize:11, fontWeight:600, color:C.danger, background:'rgba(192,57,43,.08)', padding:'2px 7px', borderRadius:20 }}>{days}d overdue</span> : <span style={{ color:C.textLight, fontSize:11 }}>—</span>}</td>
                      <td style={td}>
                        <div style={{ display:'flex', gap:5 }}>
                          <Btn sm variant="ghost" onClick={()=>{ setSelBill(b); setModal('view-bill'); }}>View</Btn>
                          {b.status !== 'Paid' && b.status !== 'Cancelled' && perms.edit && <Btn sm variant="outline" onClick={()=>openPayModal(b)}>Pay</Btn>}
                          {/* A source:'procurement' row is a real supplier invoice, not a
                              db.ap.bills record — deleting it here would have nothing to
                              delete. Removing a real invoice is Procurement's job (it has
                              its own audited delete flow); void it there instead. */}
                          {perms.del && b.source !== 'procurement' && <Btn sm variant="danger" onClick={()=>{ saveBills(manualBills.filter(x=>x.id!==b.id)); showToast('Bill deleted'); }}>✕</Btn>}
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

      {/* ── PAYMENTS TAB ── */}
      {tab === 'payments' && (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid '+C.borderLight, display:'flex', alignItems:'center' }}>
            <div style={{ fontSize:13, fontWeight:600, color:C.text }}>Payment History</div>
            <div style={{ marginLeft:'auto', fontSize:11, color:C.textMuted }}>{payments.length} payments</div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>{['Payment No','Supplier','Bill No','Date','Amount','Bank Account','Reference'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {payments.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign:'center', padding:32, color:C.textMuted }}>No payments recorded yet</td></tr>}
                {[...payments].sort((a,b)=>b.date.localeCompare(a.date)).map(p => (
                  <tr key={p.id} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <td style={{ ...td, fontFamily:'monospace', fontSize:11.5, fontWeight:600, color:C.green }}>{p.paymentNo}</td>
                    <td style={{ ...td, fontWeight:600 }}>{p.vendorName}</td>
                    <td style={{ ...td, fontFamily:'monospace', fontSize:11.5 }}>{p.billNo}</td>
                    <td style={td}>{formatDate(p.date)}</td>
                    <td style={{ ...td, fontWeight:700, color:C.success }}>{fmt(p.amount, p.currency)}</td>
                    <td style={{ ...td, fontSize:11.5 }}>{p.bankName}</td>
                    <td style={{ ...td, fontSize:11.5 }}>{p.reference||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── AGING TAB ── */}
      {tab === 'aging' && (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:'1px solid '+C.borderLight }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Accounts Payable Aging Report</div>
            <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Outstanding bills grouped by days overdue</div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>{['Supplier','Current (0–30)','31–60 Days','61–90 Days','Over 90 Days','Total'].map(h=><th key={h} style={{ ...th, textAlign: h==='Supplier'?'left':'right' }}>{h}</th>)}</tr></thead>
              <tbody>
                {agingTable.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign:'center', padding:32, color:C.textMuted }}>No outstanding bills</td></tr>}
                {agingTable.map(r => {
                  const total = r.b0 + r.b31 + r.b61 + r.b90;
                  return (
                    <tr key={r.vendor} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                      <td style={td}><div style={{ fontWeight:600 }}>{r.name}</div><div style={{ fontSize:11, color:C.textMuted }}>{r.vendor} · {r.cur}</div></td>
                      <td style={{ ...td, textAlign:'right', color:r.b0>0?C.text:C.textLight }}>{r.b0>0?fmt(r.b0,r.cur):'—'}</td>
                      <td style={{ ...td, textAlign:'right', color:r.b31>0?C.amber:C.textLight }}>{r.b31>0?fmt(r.b31,r.cur):'—'}</td>
                      <td style={{ ...td, textAlign:'right', color:r.b61>0?C.warning:C.textLight }}>{r.b61>0?fmt(r.b61,r.cur):'—'}</td>
                      <td style={{ ...td, textAlign:'right', fontWeight:r.b90>0?700:400, color:r.b90>0?C.danger:C.textLight }}>{r.b90>0?fmt(r.b90,r.cur):'—'}</td>
                      <td style={{ ...td, textAlign:'right', fontWeight:700, color:C.text }}>{fmt(total,r.cur)}</td>
                    </tr>
                  );
                })}
                {agingTable.length > 0 && (
                  <tr style={{ background:C.tableHeaderBg, fontWeight:700 }}>
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

      {/* ── ANALYSIS TAB ── */}
      {tab === 'analysis' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <Card>
            <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:12 }}>AP by Category</div>
            {Object.entries(bills.filter(b=>b.status!=='Paid'&&b.status!=='Cancelled').reduce((m,b)=>{ const c=b.category||'Other'; m[c]=(m[c]||0)+((Number(b.netPayable)||0)-(Number(b.paidAmount)||0)); return m; },{})).sort(([,a],[,b])=>b-a).map(([cat,val]) => (
              <div key={cat} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid '+C.borderLight, fontSize:13 }}>
                <span style={{ color:C.textMid }}>{cat}</span>
                <span style={{ fontWeight:600, color:C.text }}>{fmt(val)}</span>
              </div>
            ))}
          </Card>
          <Card>
            <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:12 }}>AP by Currency</div>
            {['NGN','USD','EUR','GBP'].map(cur => {
              const val = bills.filter(b=>b.currency===cur&&b.status!=='Paid'&&b.status!=='Cancelled').reduce((s,b)=>s+((Number(b.netPayable)||0)-(Number(b.paidAmount)||0)),0);
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

      {/* ── NEW BILL MODAL ── */}
      {/* ── NEW SUPPLIER MODAL ── */}
      {modal === 'new-supplier' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card style={{ maxWidth:520 }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:16 }}>+ Add New Supplier</div>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <FG label="Supplier Code *"><input style={inp} value={supplierForm.code} onChange={e=>setSupplierForm(f=>({...f,code:e.target.value.toUpperCase()}))} placeholder="e.g. NEWCO ENERGY LTD" /></FG>
              <FG label="Supplier Name *"><input style={inp} value={supplierForm.name} onChange={e=>setSupplierForm(f=>({...f,name:e.target.value}))} placeholder="Full legal name" /></FG>
              <FG label="Currency">
                <select style={inp} value={supplierForm.currency} onChange={e=>setSupplierForm(f=>({...f,currency:e.target.value}))}>
                  <option value="NGN">NGN</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
                </select>
              </FG>
              <FG label="Category">
                <select style={inp} value={supplierForm.category} onChange={e=>setSupplierForm(f=>({...f,category:e.target.value}))}>
                  <option>Materials</option><option>Services</option><option>Logistics</option><option>Labour</option><option>Maintenance</option><option>Catering</option><option>Other</option>
                </select>
              </FG>
              <FG label="RC Number"><input style={inp} value={supplierForm.rc} onChange={e=>setSupplierForm(f=>({...f,rc:e.target.value}))} /></FG>
              <FG label="TIN"><input style={inp} value={supplierForm.tin} onChange={e=>setSupplierForm(f=>({...f,tin:e.target.value}))} /></FG>
              <FG label="Contact Person"><input style={inp} value={supplierForm.contact} onChange={e=>setSupplierForm(f=>({...f,contact:e.target.value}))} /></FG>
              <FG label="Phone"><input style={inp} value={supplierForm.phone} onChange={e=>setSupplierForm(f=>({...f,phone:e.target.value}))} /></FG>
              <FG label="Email"><input style={inp} value={supplierForm.email} onChange={e=>setSupplierForm(f=>({...f,email:e.target.value}))} /></FG>
              <FG label="Address"><input style={inp} value={supplierForm.address} onChange={e=>setSupplierForm(f=>({...f,address:e.target.value}))} /></FG>
              <FG label="Notes"><input style={inp} value={supplierForm.notes} onChange={e=>setSupplierForm(f=>({...f,notes:e.target.value}))} /></FG>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSaveSupplier}>Add Supplier</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {modal === 'new-bill' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, paddingBottom:14, borderBottom:'1px solid '+C.borderLight }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Supplier Bill</div>
              <button onClick={()=>setModal(null)} style={{ background:'none',border:'none',fontSize:22,color:C.textMuted,cursor:'pointer' }}>&times;</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <FG label="Supplier *" full>
                <select style={{ ...inp }} value={form.vendor} onChange={e=>handleVendorChange(e.target.value)}>
                  <option value="">— Select Supplier —</option>
                  {vendors.map(v=><option key={v.id} value={v.code}>{v.name} — {v.code} ({v.currency})</option>)}
                </select>
              </FG>
              <FG label="Invoice / Bill Reference *"><input style={inp} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Supplier's invoice reference or description" /></FG>
              <FG label="Bill Date *"><input type="date" style={inp} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} /></FG>
              <FG label="Due Date *"><input type="date" style={inp} value={form.dueDate} onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))} /></FG>
              <FG label="Project Code">
                <select style={inp} value={form.projectCode} onChange={e=>setForm(f=>({...f,projectCode:e.target.value}))}>
                  <option value="">— No Project —</option>
                  {projects.map(p=><option key={p.id} value={p.code}>{p.code}{p.name&&p.name!==p.code?` — ${p.name}`:''}</option>)}
                </select>
              </FG>
              <FG label="Category"><input style={inp} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} placeholder="e.g. Materials, Services, Logistics" /></FG>
            </div>
            <SecLabel label="Amounts" />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
              <FG label={`Bill Amount (${form.currency||'NGN'}) *`}><input type="number" style={inp} value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" /></FG>
              <FG label="WHT Rate (%)"><input type="number" style={inp} value={form.whtRate} onChange={e=>setForm(f=>({...f,whtRate:e.target.value}))} min="0" max="15" /></FG>
              <FG label="Currency"><select style={inp} value={form.currency} onChange={e=>setForm(f=>({...f,currency:e.target.value, fxRate:DEFAULT_FX[e.target.value]||1}))}>
                {['NGN','USD','EUR','GBP'].map(c=><option key={c}>{c}</option>)}
              </select></FG>
              {form.currency !== 'NGN' && (
                <FG label={`Exchange Rate (1 ${form.currency} = ₦)`}><input type="number" style={inp} value={form.fxRate} onChange={e=>setForm(f=>({...f,fxRate:e.target.value}))} placeholder="e.g. 1545" /></FG>
              )}
            </div>
            {Number(form.amount) > 0 && (() => {
              const computed = recomputeBill(form);
              return (
                <div style={{ background:C.greenPale, borderRadius:8, padding:'12px 14px', marginTop:12, fontSize:13 }}>
                  {[['Bill Amount', fmt(Number(form.amount),form.currency)], ['VAT (7.5%)', fmt(computed.vatAmount,form.currency)], [`WHT (${form.whtRate}%)`, `– ${fmt(computed.whtAmount,form.currency)}`], ['Net Payable', fmt(computed.netPayable,form.currency)]].map(([k,v],i)=>
                    <div key={k} style={{ display:'flex', justifyContent:'space-between', marginBottom:4, fontWeight:i===3?700:400, color:i===3?C.green:C.textMid, fontSize:i===3?14:12, borderTop:i===3?'1px solid '+C.border:undefined, paddingTop:i===3?8:0 }}><span>{k}</span><span>{v}</span></div>
                  )}
                  {form.currency !== 'NGN' && (
                    <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, paddingTop:6, borderTop:'1px dashed '+C.border, fontSize:12.5, fontWeight:700, color:C.amber }}><span>NGN Equivalent (base currency)</span><span>{fmt(computed.ngnEquivalent,'NGN')}</span></div>
                  )}
                </div>
              );
            })()}
            <FG label="Notes" full><textarea style={{ ...inp, height:60, marginTop:12 }} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></FG>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSaveBill}>Save Bill</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {/* ── VIEW BILL MODAL ── */}
      {modal === 'view-bill' && selBill && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:12, borderBottom:'1px solid '+C.borderLight }}>
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:C.text }}>{selBill.billNo}</div>
                <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>{selBill.vendorName} · {formatDate(selBill.date)}</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                {selBill.status !== 'Paid' && selBill.status !== 'Cancelled' && perms.edit && <Btn sm variant="outline" onClick={()=>openPayModal(selBill)}>Record Payment</Btn>}
                <button onClick={()=>setModal(null)} style={{ background:'none',border:'none',fontSize:22,color:C.textMuted,cursor:'pointer' }}>&times;</button>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              {[['Supplier Code', selBill.vendor], ['Currency', selBill.currency], ['Bill Date', formatDate(selBill.date)], ['Due Date', formatDate(selBill.dueDate)], ['Project', selBill.projectCode||'—'], ['Category', selBill.category||'—']].map(([k,v])=>(
                <div key={k}><div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:3 }}>{k}</div><div style={{ fontSize:13, color:C.text }}>{v}</div></div>
              ))}
            </div>
            <div style={{ marginTop:14, background:C.greenPale, borderRadius:8, padding:'12px 14px' }}>
              <div style={{ fontSize:13, color:C.textMid, marginBottom:6 }}>{selBill.description}</div>
              {[['Bill Amount', fmt(selBill.amount,selBill.currency)], ['VAT (7.5%)', fmt(selBill.vatAmount,selBill.currency)], [`WHT (${selBill.whtRate}%)`, `– ${fmt(selBill.whtAmount,selBill.currency)}`], ['Net Payable', fmt(selBill.netPayable,selBill.currency)], ['Amount Paid', fmt(selBill.paidAmount||0,selBill.currency)], ['Balance Due', fmt((Number(selBill.netPayable)||0)-(Number(selBill.paidAmount)||0),selBill.currency)]].map(([k,v],i)=>(
                <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:i<5?'1px solid '+C.borderLight:undefined, fontWeight:i>=3?700:400, color:i===3?C.green:i===5?C.danger:C.textMid, fontSize:i>=3?14:12 }}><span>{k}</span><span>{v}</span></div>
              ))}
              {selBill.currency !== 'NGN' && (
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, paddingTop:6, borderTop:'1px dashed '+C.border, fontSize:12, fontWeight:700, color:C.amber }}><span>NGN Equivalent (at {selBill.fxRate} per {selBill.currency})</span><span>{fmt(selBill.ngnEquivalent,'NGN')}</span></div>
              )}
            </div>
            <div style={{ marginTop:12 }}><BillTag status={selBill.status} /></div>
            {selBill.notes && <div style={{ marginTop:10, fontSize:12, color:C.textMuted }}><strong>Notes:</strong> {selBill.notes}</div>}
          </Card>
        </Overlay>
      )}

      {/* ── RECORD PAYMENT MODAL ── */}
      {modal === 'pay' && selBill && (
        <Overlay onClose={()=>setModal(null)}>
          <Card style={{ maxWidth:500 }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:4 }}>Record Payment</div>
            <div style={{ fontSize:12, color:C.textMuted, marginBottom:4 }}>{selBill.billNo} · {selBill.vendorName}</div>
            <div style={{ fontSize:13, fontWeight:600, color:C.amber, marginBottom:20 }}>Balance due: {fmt((Number(selBill.netPayable)||0)-(Number(selBill.paidAmount)||0), selBill.currency)}</div>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <FG label="Payment Date *"><input type="date" style={inp} value={payForm.date} onChange={e=>setPayForm(f=>({...f,date:e.target.value}))} /></FG>
              <FG label={`Amount Paid (${selBill.currency}) *`}>
                <input type="number" style={inp} value={payForm.amount} onChange={e=>setPayForm(f=>({...f,amount:e.target.value}))} readOnly={selBill.source==='procurement'} />
              </FG>
              {selBill.source === 'procurement' && (
                <div style={{ fontSize:11, color:C.textMuted, marginTop:-8 }}>This is a real Procurement invoice — full balance only, partial payments aren't tracked on it yet.</div>
              )}
              {selBill.currency !== 'NGN' && (
                <FG label={`Exchange Rate Today (1 ${selBill.currency} = ₦)`}><input type="number" style={inp} value={payForm.fxRate} onChange={e=>setPayForm(f=>({...f,fxRate:e.target.value}))} /></FG>
              )}
              <FG label="Bank Account">
                <select style={inp} value={payForm.bankCode} onChange={e=>setPayForm(f=>({...f,bankCode:e.target.value}))}>
                  {BANK_ACCOUNTS.map(b=><option key={b.code} value={b.code}>{b.name} ({b.currency})</option>)}
                </select>
              </FG>
              <FG label="Payment Reference"><input style={inp} value={payForm.reference} onChange={e=>setPayForm(f=>({...f,reference:e.target.value}))} placeholder="Bank transfer ref / cheque no" /></FG>
              <FG label="Notes"><input style={inp} value={payForm.notes} onChange={e=>setPayForm(f=>({...f,notes:e.target.value}))} /></FG>
            </div>
            {selBill.currency !== 'NGN' && Number(payForm.amount) > 0 && (() => {
              const payNgn = Number(payForm.amount) * (Number(payForm.fxRate)||1);
              const billNgnPortion = (Number(payForm.amount) / (Number(selBill.netPayable)||1)) * (Number(selBill.ngnEquivalent)||0);
              const fxDiff = payNgn - billNgnPortion;
              return (
                <div style={{ background:C.bgAlt, borderRadius:8, padding:'10px 14px', marginTop:14, fontSize:12 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, color:C.textMid }}><span>NGN equivalent at today's rate</span><span style={{ fontWeight:600 }}>{fmt(payNgn,'NGN')}</span></div>
                  <div style={{ display:'flex', justifyContent:'space-between', color: Math.abs(fxDiff)<1 ? C.textMuted : fxDiff>0?C.danger:C.success }}>
                    <span>FX {fxDiff>0?'loss':'gain'} vs. bill rate (₦{selBill.fxRate})</span>
                    <span style={{ fontWeight:700 }}>{fmt(Math.abs(fxDiff),'NGN')}</span>
                  </div>
                </div>
              );
            })()}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSavePayment}>Confirm Payment</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {/* ── SUPPLIER LEDGER MODAL ── */}
      {modal === 'supplier-ledger' && ledgerCode && (() => {
        const supp = supplierBalances.find(s => s.code === ledgerCode);
        if (!supp) return null;
        // Merge bills (money owed, +) and payments (money paid, -) chronologically,
        // then walk forward to compute a running balance — same shape as a bank statement.
        const rows = [
          ...bills.filter(b => b.vendor === ledgerCode && b.status !== 'Cancelled')
            .map(b => ({ date:b.date, type:'Bill', ref:b.billNo, desc:b.description||b.category||'', amount: Number(b.netPayable)||0 })),
          ...payments.filter(p => p.vendor === ledgerCode)
            .map(p => ({ date:p.date, type:'Payment', ref:p.paymentNo, desc:p.reference||'', amount: -(Number(p.amount)||0) })),
        ].sort((a,b) => a.date.localeCompare(b.date));
        let running = 0;
        const withBalance = rows.map(r => { running += r.amount; return { ...r, balance: running }; });

        return (
          <Overlay onClose={()=>setModal(null)}>
            <Card style={{ maxWidth: 720 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:16, fontWeight:700, color:C.text }}>📒 Supplier Ledger — {supp.name}</div>
                  <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>{supp.code} · {supp.currency}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:11, color:C.textMuted }}>Outstanding Balance</div>
                  <div style={{ fontSize:18, fontWeight:800, color: running>0?C.danger:C.success }}>{fmt(Math.abs(running), supp.currency)}</div>
                </div>
              </div>
              <div style={{ maxHeight:420, overflowY:'auto', border:`1px solid ${C.borderLight}`, borderRadius:8 }}>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead><tr>{['Date','Type','Ref','Description','Amount','Balance'].map(h=><th key={h} style={{...th, position:'sticky', top:0}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {withBalance.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign:'center', padding:32, color:C.textMuted }}>No transactions for this supplier yet</td></tr>}
                    {withBalance.map((r,i) => (
                      <tr key={i}>
                        <td style={td}>{r.date}</td>
                        <td style={td}><span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, fontWeight:600, background: r.type==='Bill'?C.bgAlt:C.greenPale, color: r.type==='Bill'?C.amber:C.green }}>{r.type}</span></td>
                        <td style={{ ...td, fontFamily:'monospace', fontSize:11.5 }}>{r.ref}</td>
                        <td style={{ ...td, color:C.textMuted }}>{r.desc}</td>
                        <td style={{ ...td, fontWeight:600, color: r.amount>=0?C.danger:C.success }}>{r.amount>=0?'+':''}{fmt(r.amount, supp.currency)}</td>
                        <td style={{ ...td, fontWeight:700 }}>{fmt(r.balance, supp.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:16 }}>
                <Btn variant="ghost" icon="🖨" onClick={()=>{
                  const rowsHtml = withBalance.map(r=>`<tr><td>${r.date}</td><td>${r.type}</td><td>${r.ref}</td><td>${r.desc}</td><td style="text-align:right">${fmt(r.amount,supp.currency)}</td><td style="text-align:right">${fmt(r.balance,supp.currency)}</td></tr>`).join('');
                  openPrintWindow(`<html><head><title>Supplier Ledger — ${supp.name}</title><style>
                    body{font-family:Arial,sans-serif;padding:24px;color:#222}
                    h2{margin:0 0 4px}
                    table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
                    th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}
                    th{background:#f2f5f3}
                  </style></head><body>
                    ${printHeader('SUPPLIER LEDGER', supp.name)}
                    <div style="font-size:11px;color:#4A5C4E;margin-bottom:8px">${supp.code} · ${supp.currency}</div>
                    <table><thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Description</th><th>Amount</th><th>Balance</th></tr></thead><tbody>${rowsHtml}</tbody></table>
                    ${printBootstrap({landscape:false})}
                  </body></html>`);
                }}>Print</Btn>
                <Btn onClick={()=>setModal(null)}>Close</Btn>
              </div>
            </Card>
          </Overlay>
        );
      })()}
    </div>
  );
}
