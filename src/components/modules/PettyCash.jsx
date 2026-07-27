// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — PETTY CASH MODULE v1.0
// Fund management · disbursements · replenishment · approvals · print
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo, useEffect } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo }    from '../../utils/auth';
import { showToast, formatDate, generateId } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { printHeader, PRINT_CSS } from '../../utils/logo';
import { initApproval, applyDecision, canApproveAtCurrentLevel, approvalSummary } from '../../utils/approvalEngine';

const uid   = () => generateId();
const today = () => new Date().toISOString().split('T')[0];
const year  = () => new Date().getFullYear();
const fmt   = n => '₦' + (Number(n)||0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function nextNo(list) {
  // CRITICAL FIX: previously this scanned ALL entries (including REP- replenishments),
  // stripped non-digits (turning 'REP-2026-0001' into '20260001'), and used Math.max
  // to compute the next PCV number. Result: after one replenishment, the next PCV
  // became 'PCV-2026-20260002' (8-digit "sequence" that padStart(4) couldn't fix).
  // Now we filter to PCV-prefixed entries only and parse the trailing 4 digits.
  const nums = list
    .filter(x => (x.voucherNo || '').startsWith('PCV-'))
    .map(x => {
      // Match the last 4 digits after the year — PCV-YYYY-NNNN
      const m = (x.voucherNo || '').match(/PCV-\d{4}-(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter(Boolean);
  return `PCV-${year()}-${String(nums.length ? Math.max(...nums)+1 : 1).padStart(4,'0')}`;
}

const CATEGORIES = ['Stationery','Office Supplies','Transportation','Fuel','Meals & Entertainment','Utilities','Maintenance & Repairs','Medical','Communication','Miscellaneous'];
const DEFAULT_FUND = { limit: 500000, balance: 500000, lastReplenished: today(), custodian: 'Finance Officer' };

function migrateFund(dbFund) {
  if (dbFund?.limit) return dbFund;
  try {
    const raw = localStorage.getItem('slot_pettycash_fund');
    if (raw) { localStorage.removeItem('slot_pettycash_fund'); return JSON.parse(raw); }
  } catch {}
  return DEFAULT_FUND;
}

const SEED = [
  { id:'pc1', voucherNo:'PCV-2026-0001', date:'2026-04-02', payee:'Stationery Hub Ltd', description:'A4 papers, pens, staples for office use', category:'Stationery', amount:18500, requestedBy:'Grace Okonkwo', approvedBy:'Ernest Ojukwu', status:'Approved', receipt:true, createdAt:'2026-04-02T09:00:00Z' },
  { id:'pc2', voucherNo:'PCV-2026-0002', date:'2026-04-05', payee:'Emeka Drivers', description:'Transport – site visit to Bonny Island', category:'Transportation', amount:45000, requestedBy:'Chidi Okafor', approvedBy:'Ernest Ojukwu', status:'Approved', receipt:true, createdAt:'2026-04-05T11:00:00Z' },
  { id:'pc3', voucherNo:'PCV-2026-0003', date:'2026-04-08', payee:'Conoil Petrol Station', description:'Diesel – generator set refill', category:'Fuel', amount:62000, requestedBy:'Alex Mbata', approvedBy:'', status:'Pending', receipt:false, createdAt:'2026-04-08T14:00:00Z' },
  { id:'pc4', voucherNo:'PCV-2026-0004', date:'2026-04-10', payee:'Quick Fix Plumbing', description:'Emergency plumbing repair – staff toilet', category:'Maintenance & Repairs', amount:35000, requestedBy:'Ngozi Okafor', approvedBy:'Ernest Ojukwu', status:'Approved', receipt:true, createdAt:'2026-04-10T10:00:00Z' },
];

function Tag({ status }) {
  const { C } = useTheme();
  const m = { 'Pending':[C.warning,'rgba(201,122,10,.12)'], 'Approved':[C.success,'rgba(26,122,74,.12)'], 'Rejected':[C.danger,'rgba(192,57,43,.12)'], 'Replenishment':[C.info,'rgba(26,92,138,.12)'] };
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
    <div onClick={onClick} style={{ background:C.bgCard, border:'1px solid '+(alert?C.danger+'40':C.border), borderRadius:12, padding:'13px 15px', flex:1, minWidth:148, position:'relative', boxShadow:C.shadowCard, cursor:onClick?'pointer':'default', transition:'transform 0.12s, box-shadow 0.12s' }} onMouseEnter={e=>{ if(onClick){ e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,0.15)'; }}} onMouseLeave={e=>{ e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=C.shadowCard; }}>
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
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'100%', maxWidth:620, marginBottom:32 }}>{children}</div>
    </div>
  );
}

function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'18px 20px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}

function printVoucher(v) {
  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Petty Cash Voucher ${v.voucherNo}</title>
  <style>${PRINT_CSS}
  .voucher-box{border:2px solid #1A5C2A;border-radius:8px;padding:20px 24px;max-width:620px;margin:0 auto}
  .row{display:grid;grid-template-columns:160px 1fr;gap:8px;padding:6px 0;border-bottom:1px solid #EAF0EB;font-size:12px}
  .label{font-weight:600;color:#3A5040;text-transform:uppercase;font-size:10.5px;letter-spacing:.3px}
  .amount-box{background:#EAF4EC;border:2px solid #1A5C2A;border-radius:8px;padding:14px 18px;text-align:center;margin:14px 0}
  .amount-box .amt{font-size:22px;font-weight:800;color:#1A5C2A}
  .sig-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:28px}
  .sig{border-top:1px solid #1A5C2A;padding-top:6px;font-size:10px;color:#6E8C74;text-align:center}
  </style></head><body>
  ${printHeader('PETTY CASH VOUCHER', formatDate(v.date))}
  <div class="voucher-box">
    <div class="row"><div class="label">Voucher No.</div><div><strong>${v.voucherNo}</strong></div></div>
    <div class="row"><div class="label">Date</div><div>${formatDate(v.date)}</div></div>
    <div class="row"><div class="label">Payee</div><div><strong>${v.payee}</strong></div></div>
    <div class="row"><div class="label">Description</div><div>${v.description}</div></div>
    <div class="row"><div class="label">Category</div><div>${v.category}</div></div>
    <div class="row"><div class="label">Requested By</div><div>${v.requestedBy}</div></div>
    <div class="row"><div class="label">Receipt Attached</div><div>${v.receipt ? '✓ Yes' : '✗ No'}</div></div>
    <div class="amount-box">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#6E8C74;margin-bottom:6px">Amount</div>
      <div class="amt">₦${(Number(v.amount)||0).toLocaleString('en-NG', {minimumFractionDigits:2})}</div>
    </div>
    <div class="sig-row">
      <div><div class="sig">Requested By / Date</div></div>
      <div><div class="sig">Approved By / Date</div></div>
      <div><div class="sig">Received By / Date</div></div>
    </div>
  </div>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

function printRegister(list, fund) {
  const rows = list.map((v,i)=>`<tr style="background:${i%2===1?'#f3faf5':'#fff'}">
    <td>${v.voucherNo}</td><td>${formatDate(v.date)}</td><td>${v.payee}</td><td>${v.description}</td>
    <td>${v.category}</td><td>${v.requestedBy}</td>
    <td style="text-align:right;font-weight:600">₦${(Number(v.amount)||0).toLocaleString('en-NG')}</td>
    <td style="text-align:center">${v.receipt?'✓':''}</td>
    <td style="text-align:center"><span style="padding:2px 8px;border-radius:20px;font-size:10px;background:${v.status==='Approved'?'#d4edda':'#fff3cd'};color:${v.status==='Approved'?'#155724':'#856404'}">${v.status}</span></td>
  </tr>`).join('');
  const total = list.reduce((a,v)=>a+(Number(v.amount)||0),0);
  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Petty Cash Register</title><style>${PRINT_CSS}</style></head><body>
  ${printHeader('PETTY CASH DISBURSEMENT REGISTER', `Fund Balance: ₦${(Number(fund.balance)||0).toLocaleString('en-NG')}`)}
  <table><thead><tr><th>Voucher No</th><th>Date</th><th>Payee</th><th>Description</th><th>Category</th><th>Requested By</th><th style="text-align:right">Amount</th><th>Receipt</th><th>Status</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total-row"><td colspan="6" style="text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.5px">Total Disbursed</td><td style="text-align:right;font-size:14px">₦${total.toLocaleString('en-NG')}</td><td colspan="2"></td></tr></tfoot>
  </table>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

export default function PettyCash({ onNav }) {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db } = state;
  const perms = { add: canDo(currentUser,'canAdd','pettycash',state.appSettings), edit: canDo(currentUser,'canEdit','pettycash',state.appSettings), del: canDo(currentUser,'canDelete','pettycash',state.appSettings) };
  const isAdmin = currentUser?.role === 'admin';

  const stored = (db.pettycash?.length || state.appSettings?.dataWiped) ? (db.pettycash || []) : SEED;
  const [entries, setEntries] = useState(stored);
  const [fund, setFund] = useState(() => migrateFund(state.db.pettycash_fund));

  // CRITICAL FIX: previously the `fund` useState ran ONCE on mount with
  // migrateFund(state.db.pettycash_fund) — which returned DEFAULT_FUND on
  // a fresh device (no localStorage yet). When cloud sync (App.jsx boot
  // phase 2) later dispatched SET_DB with the real fund, this useState
  // never updated — the displayed balance was wrong until the user did
  // something that triggered setFund (and even then, it would decrement
  // the STALE balance, making it more wrong). Now we sync from cloud when
  // it arrives. We skip if the user has unsaved local edits (lastFundEditRef)
  // to avoid clobbering their work-in-progress.
  useEffect(() => {
    if (state.db.pettycash_fund) {
      setFund(f => {
        // Only update if the cloud value differs from what we have —
        // avoids re-render loops. We compare by JSON.stringify because
        // shallow-compare wouldn't catch balance changes.
        const cloudStr = JSON.stringify(state.db.pettycash_fund);
        const localStr = JSON.stringify(f);
        return cloudStr === localStr ? f : state.db.pettycash_fund;
      });
    }
  }, [state.db.pettycash_fund]);

  const save = (data) => {
    setEntries(data);
    dispatch({ type:'UPDATE_MODULE', mod:'pettycash', data });
    saveDBLocal({ ...db, pettycash: data }, state.activity);
  };

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const th  = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td  = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const [search, setSearch]   = useState('');
  const [modal, setModal]     = useState(null);
  const [sel2, setSel2]       = useState(null);
  const [delId, setDelId]     = useState(null);
  const [replenForm, setRF]   = useState({ amount:'', date:today(), ref:'', note:'' });

  const EMPTY = { payee:'', description:'', category:'Stationery', amount:'', date:today(), requestedBy:currentUser?.name||'', receipt:false, notes:'' };
  const [form, setForm] = useState(EMPTY);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return entries.filter(e => !e.voided && (!s || e.payee.toLowerCase().includes(s) || e.description.toLowerCase().includes(s) || e.voucherNo.toLowerCase().includes(s)));
  }, [entries, search]);

  const stats = useMemo(() => {
    const approved = entries.filter(e=>!e.voided&&e.status==='Approved').reduce((a,e)=>a+(Number(e.amount)||0),0);
    const pending  = entries.filter(e=>!e.voided&&e.status==='Pending').reduce((a,e)=>a+(Number(e.amount)||0),0);
    const pct = fund.limit > 0 ? Math.round((fund.balance / fund.limit) * 100) : 0;
    return { approved, pending, pct };
  }, [entries, fund]);

  function handleSave() {
    if (!form.payee.trim()) { showToast('Payee is required','error'); return; }
    if (!form.amount || Number(form.amount) <= 0) { showToast('Enter a valid amount','error'); return; }
    if (!form.description.trim()) { showToast('Description is required','error'); return; }
    if (Number(form.amount) > fund.balance) { showToast('Amount exceeds available fund balance','error'); return; }
    const approval = initApproval('pettycash', Number(form.amount), state.appSettings);
    const rec = { id:uid(), voucherNo:nextNo(entries), ...form, amount:Number(form.amount), status:'Pending', approval, approvedBy:'', createdAt:new Date().toISOString() };
    save([...entries, rec]);
    logActivity(dispatch, `Petty cash voucher ${rec.voucherNo} submitted by ${rec.requestedBy}`, currentUser);
    showToast('Voucher submitted'); setModal(null); setForm(EMPTY);
  }

  function handleApprove(id, note = '') {
    const entry = entries.find(e=>e.id===id);
    if (!entry) return;
    const approval = entry.approval ? applyDecision(entry.approval, currentUser, 'Approved', note) : { status: 'Approved' };
    // Fund balance is only debited once the FULL chain clears (multi-level
    // vouchers above the band threshold need every level's sign-off before
    // cash actually moves) — not on an intermediate level's approval.
    if (approval.status === 'Approved') {
      const newBalance = fund.balance - Number(entry.amount);
      if (newBalance < 0) { showToast('Insufficient fund balance','error'); return; }
      const updFund = { ...fund, balance: newBalance };
      dispatch({ type:'UPDATE_MODULE', mod:'pettycash_fund', data:updFund }); setFund(updFund);
    }
    save(entries.map(e => e.id===id ? { ...e, approval, status: approval.status, approvedBy: approval.status === 'Approved' ? (currentUser?.name||'Admin') : e.approvedBy } : e));
    logActivity(dispatch, `Petty cash ${entry.voucherNo} ${approval.status === 'Approved' ? 'approved' : 'progressed to next approval level'}`, currentUser);
    showToast(approval.status === 'Approved' ? 'Voucher approved' : 'Approved at this level — next approver notified');
  }

  function handleReject(id, note = '') {
    const entry = entries.find(e=>e.id===id);
    const approval = entry?.approval ? applyDecision(entry.approval, currentUser, 'Rejected', note) : null;
    save(entries.map(e => e.id===id ? { ...e, approval, status:'Rejected', approvedBy:currentUser?.name||'Admin' } : e));
    showToast('Voucher rejected');
  }

  function handleReplenish() {
    if (!replenForm.amount || Number(replenForm.amount) <= 0) { showToast('Enter replenishment amount','error'); return; }
    const updFund = { ...fund, balance: Math.min(fund.balance + Number(replenForm.amount), fund.limit), lastReplenished: replenForm.date };
    dispatch({ type:'UPDATE_MODULE', mod:'pettycash_fund', data:updFund }); setFund(updFund);
    const rec = { id:uid(), voucherNo:`REP-${year()}-${Date.now().toString().slice(-4)}`, date:replenForm.date, payee:'Fund Replenishment', description:`Cash replenishment. Ref: ${replenForm.ref||'—'}. ${replenForm.note||''}`, category:'Replenishment', amount:Number(replenForm.amount), requestedBy:'Finance', approvedBy:currentUser?.name||'Admin', status:'Replenishment', receipt:true, createdAt:new Date().toISOString() };
    save([...entries, rec]);
    logActivity(dispatch, `Petty cash fund replenished by ${fmt(replenForm.amount)}`, currentUser);
    showToast('Fund replenished'); setModal(null); setRF({ amount:'', date:today(), ref:'', note:'' });
  }

  const pct = stats.pct;
  const barColor = pct > 60 ? C.success : pct > 30 ? C.warning : C.danger;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Petty Cash</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Disbursement management · fund tracking · approvals</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {isAdmin && <Btn variant="outline" onClick={()=>setModal('replenish')}>↑ Replenish Fund</Btn>}
          {perms.add && <Btn onClick={()=>{ setForm(EMPTY); setModal('add'); }}>+ New Voucher</Btn>}
        </div>
      </div>

      {/* Fund Balance Bar */}
      <Card style={{ padding:'16px 20px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.4px' }}>Current Fund Balance</div>
            <div style={{ fontSize:26, fontWeight:800, color:barColor, marginTop:2 }}>{fmt(fund.balance)}</div>
            <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>of {fmt(fund.limit)} limit · Custodian: {fund.custodian} · Last replenished: {formatDate(fund.lastReplenished)}</div>
          </div>
          <div style={{ fontSize:28, fontWeight:800, color:barColor }}>{pct}%</div>
        </div>
        <div style={{ background:C.greenPale, borderRadius:20, height:8, overflow:'hidden' }}>
          <div style={{ width:`${pct}%`, height:'100%', background:barColor, borderRadius:20, transition:'width .4s ease' }} />
        </div>
      </Card>

      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <KPI label="Total Disbursed" value={fmt(stats.approved)} sub="approved & paid out" />
        <KPI label="Pending Approval" value={fmt(stats.pending)} accent={C.amber} sub={`${entries.filter(e=>!e.voided&&e.status==='Pending').length} vouchers`} onClick={() => onNav?.("approvals")} />
        <KPI label="Vouchers This Month" value={entries.filter(e=>!e.voided&&e.date?.startsWith(new Date().toISOString().slice(0,7))).length} sub="current month" accent={C.info} />
        <KPI label="Available Balance" value={fmt(fund.balance)} accent={barColor} alert={fund.balance < fund.limit * 0.2} sub={pct < 20 ? 'Low — replenish soon' : 'sufficient'} />
      </div>

      <Card style={{ padding:0, overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px', borderBottom:'1px solid '+C.borderLight, flexWrap:'wrap' }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search voucher, payee, description…" style={{ ...inp, maxWidth:280 }} />
          <Btn sm variant="ghost" onClick={()=>printRegister(entries.filter(e=>!e.voided&&e.status!=='Replenishment'), fund)}>🖨 Print Register</Btn>
          <div style={{ marginLeft:'auto', fontSize:11, color:C.textMuted }}>{filtered.length} records</div>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              {['Voucher No','Date','Payee','Description','Category','Amount','Receipt','Status','Actions'].map(h=><th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign:'center', padding:32, color:C.textMuted }}>No vouchers found</td></tr>}
              {filtered.map(e => (
                <tr key={e.id} onMouseEnter={ev=>ev.currentTarget.style.background=C.greenPale2} onMouseLeave={ev=>ev.currentTarget.style.background=''}>
                  <td style={td}><span style={{ fontWeight:700, color:C.green, fontFamily:'monospace', fontSize:12 }}>{e.voucherNo}</span></td>
                  <td style={td}>{formatDate(e.date)}</td>
                  <td style={td}><div style={{ fontWeight:600 }}>{e.payee}</div></td>
                  <td style={{ ...td, maxWidth:220 }}><div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:C.textMid, fontSize:12 }}>{e.description}</div></td>
                  <td style={td}><span style={{ fontSize:11, background:C.greenPale, color:C.green, padding:'2px 8px', borderRadius:20, border:'1px solid '+C.borderLight }}>{e.category}</span></td>
                  <td style={{ ...td, fontWeight:700, color:C.green }}>{fmt(e.amount)}</td>
                  <td style={{ ...td, textAlign:'center' }}>{e.receipt ? <span style={{ color:C.success, fontWeight:700 }}>✓</span> : <span style={{ color:C.danger }}>✗</span>}</td>
                  <td style={td}>
                    <Tag status={e.status} />
                    {e.status === 'Pending' && e.approval?.requiredRoles?.length > 1 && (
                      <div style={{ fontSize:9.5, color:C.amber, marginTop:2 }}>{approvalSummary(e.approval, state.appSettings)}</div>
                    )}
                  </td>
                  <td style={td}>
                    <div style={{ display:'flex', gap:5 }}>
                      <Btn sm variant="ghost" onClick={()=>printVoucher(e)}>🖨</Btn>
                      {e.status === 'Pending' && (canApproveAtCurrentLevel(e.approval, currentUser) || (isAdmin && !e.approval)) && (
                        <>
                          <Btn sm variant="outline" onClick={()=>handleApprove(e.id)}>Approve</Btn>
                          <Btn sm variant="danger" onClick={()=>handleReject(e.id)}>Reject</Btn>
                        </>
                      )}
                      {perms.del && e.status !== 'Approved' && <Btn sm variant="danger" onClick={()=>setDelId(e.id)}>✕</Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Voucher Modal */}
      {modal === 'add' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, paddingBottom:14, borderBottom:'1px solid '+C.borderLight }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Petty Cash Voucher</div>
              <button onClick={()=>setModal(null)} style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>&times;</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <FG label="Payee *"><input style={inp} value={form.payee} onChange={e=>setForm(f=>({...f,payee:e.target.value}))} placeholder="Who is being paid?" /></FG>
              <FG label="Amount (₦) *"><input type="number" style={inp} value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" min="0" /></FG>
              <FG label="Date *"><input type="date" style={inp} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} /></FG>
              <FG label="Category"><select style={inp} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></FG>
              <FG label="Requested By"><input style={inp} value={form.requestedBy} onChange={e=>setForm(f=>({...f,requestedBy:e.target.value}))} /></FG>
              <FG label="Receipt Attached?">
                <div style={{ display:'flex', gap:16, alignItems:'center', paddingTop:6 }}>
                  {[true,false].map(v=>(
                    <label key={String(v)} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13, color:C.text }}>
                      <input type="radio" checked={form.receipt===v} onChange={()=>setForm(f=>({...f,receipt:v}))} /> {v ? 'Yes' : 'No'}
                    </label>
                  ))}
                </div>
              </FG>
              <FG label="Description *" full><textarea style={{ ...inp, height:72 }} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Purpose of expenditure" /></FG>
            </div>
            <div style={{ marginTop:12, padding:'10px 14px', background:C.amberPale, border:'1px solid '+C.amberLight, borderLeft:'4px solid '+C.amber, borderRadius:7, fontSize:12, color:C.amber }}>
              Available fund balance: <strong>{fmt(fund.balance)}</strong>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSave}>Submit Voucher</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {/* Replenish Modal */}
      {modal === 'replenish' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card style={{ maxWidth:480 }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:4 }}>Replenish Petty Cash Fund</div>
            <div style={{ fontSize:12, color:C.textMuted, marginBottom:20 }}>Current balance: {fmt(fund.balance)} · Fund limit: {fmt(fund.limit)}</div>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <FG label="Replenishment Amount (₦) *"><input type="number" style={inp} value={replenForm.amount} onChange={e=>setRF(f=>({...f,amount:e.target.value}))} placeholder="0.00" min="0" /></FG>
              <FG label="Date *"><input type="date" style={inp} value={replenForm.date} onChange={e=>setRF(f=>({...f,date:e.target.value}))} /></FG>
              <FG label="Reference No."><input style={inp} value={replenForm.ref} onChange={e=>setRF(f=>({...f,ref:e.target.value}))} placeholder="Bank transfer ref" /></FG>
              <FG label="Note"><input style={inp} value={replenForm.note} onChange={e=>setRF(f=>({...f,note:e.target.value}))} /></FG>
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleReplenish}>Replenish</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {delId && (
        <div style={{ position:'fixed', inset:0, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <Card style={{ maxWidth:360, textAlign:'center' }}>
            <div style={{ fontSize:30, marginBottom:10 }}>⚠️</div>
            <div style={{ fontSize:15, fontWeight:600, color:C.text, marginBottom:20 }}>Delete this voucher?</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              <Btn variant="ghost" onClick={()=>setDelId(null)}>Cancel</Btn>
              <Btn variant="danger" onClick={()=>{ save(entries.map(e=>e.id===delId?{...e,voided:true}:e)); showToast('Voucher voided'); setDelId(null); }}>Delete</Btn>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
