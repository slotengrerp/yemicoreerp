// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — REQUESTS MODULE v1.0
// Internal requests: Material · Service · Leave · IT · Travel · Other
// Full approval workflow: Draft → Submitted → Approved / Rejected
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo }    from '../../utils/auth';
import { showToast, formatDate, generateId } from '../../utils/helpers'; // auto-patched
import { getDeepLinkTab } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { printHeader, PRINT_CSS, printBootstrap, openPrintWindow} from '../../utils/logo';
import { initApproval, applyDecision, canApproveAtCurrentLevel, approvalSummary } from '../../utils/approvalEngine';
import { diffAndPush, pushOne } from '../../hooks/usePerRecordSync';

const uid   = () => generateId();
const today = () => new Date().toISOString().split('T')[0];
const year  = () => new Date().getFullYear();

function nextNo(list, type) {
  const prefix = { Material:'MRQ', Service:'SRQ', Leave:'LRQ', IT:'ITQ', Travel:'TRQ', Other:'ORQ' }[type] || 'RQS';
  const nums = list.filter(r => r.requestNo?.startsWith(prefix)).map(r => parseInt((r.requestNo||'0').replace(/\D/g,''),10)).filter(Boolean);
  return `${prefix}-${year()}-${String(nums.length ? Math.max(...nums)+1 : 1).padStart(4,'0')}`;
}

const REQUEST_TYPES  = ['Material','Service','Leave','IT','Travel','Other'];
const DEPARTMENTS    = ['Engineering','HSE','Operations','Admin','Procurement','Finance','Mechanical','Electrical','Civil','IT','Legal','Logistics'];
const PRIORITIES     = ['Low','Normal','High','Urgent'];
const LEAVE_TYPES    = ['Annual Leave','Sick Leave','Maternity Leave','Paternity Leave','Compassionate','Unpaid Leave'];

// 2026-07-29 — seed fallback removed permanently (was already emptied
// 2026-07-28, having held four fabricated staff requests with invented
// approval decisions). See App.jsx boot-sequence note.

// ── Shared UI ────────────────────────────────────────────────────────────────
function Tag({ status }) {
  const { C } = useTheme();
  const m = {
    'Draft':['#6B7280','rgba(107,114,128,.12)'],
    'Submitted':['#1A5C8A','rgba(26,92,138,.12)'],
    'Approved':[C.success,'rgba(26,122,74,.12)'],
    'Rejected':[C.danger,'rgba(192,57,43,.12)'],
    'In Progress':[C.warning,'rgba(201,122,10,.12)'],
    'Closed':['#6B7280','rgba(107,114,128,.12)'],
  };
  const [c,bg] = m[status]||['#6B7280','rgba(107,114,128,.12)'];
  return <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:500, color:c, background:bg, border:`1px solid ${c}30`, whiteSpace:'nowrap' }}>{status}</span>;
}

function PriorityTag({ p }) {
  const { C } = useTheme();
  const m = { Low:['#6B7280','rgba(107,114,128,.1)'], Normal:[C.info,'rgba(26,92,138,.1)'], High:[C.warning,'rgba(201,122,10,.1)'], Urgent:[C.danger,'rgba(192,57,43,.1)'] };
  const [c,bg] = m[p]||['#6B7280','rgba(107,114,128,.1)'];
  return <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:20, fontSize:10.5, fontWeight:600, color:c, background:bg, border:`1px solid ${c}30` }}>{p}</span>;
}

function Btn({ children, onClick, variant='primary', sm, disabled, style={} }) {
  const { C } = useTheme();
  const V = { primary:{bg:C.green,co:'#fff',b:'none'}, ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border}, danger:{bg:C.danger,co:'#fff',b:'none'}, amber:{bg:C.amber,co:'#fff',b:'none'}, success:{bg:C.success,co:'#fff',b:'none'}, outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green} }[variant]||{};
  return <button onClick={onClick} disabled={disabled} style={{ background:V.bg, color:V.co, border:V.b, borderRadius:7, padding:sm?'4px 11px':'7px 16px', fontSize:sm?11.5:13, fontWeight:500, cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1, display:'inline-flex', alignItems:'center', gap:5, whiteSpace:'nowrap', ...style }}>{children}</button>;
}

function KPI({ label, value, sub, accent, alert, onClick }) {
  const { C } = useTheme();
  const c = alert ? C.danger : accent || C.green;
  return (
    <div onClick={onClick} style={{ background:C.bgCard, border:'1px solid '+(alert?C.danger+'40':C.border), borderRadius:12, padding:'13px 15px', flex:1, minWidth:140, position:'relative', boxShadow:C.shadowCard, cursor:onClick?'pointer':'default', transition:'transform 0.12s, box-shadow 0.12s' }} onMouseEnter={e=>{ if(onClick){ e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,0.15)'; }}} onMouseLeave={e=>{ e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=C.shadowCard; }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:c, borderRadius:'12px 0 0 12px' }} />
      <div style={{ paddingLeft:8 }}>
        <div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:4 }}>{label}</div>
        <div style={{ fontSize:22, fontWeight:700, color:c, lineHeight:1 }}>{value}</div>
        {sub && <div style={{ fontSize:11, color:C.textMuted, marginTop:3 }}>{sub}</div>}
      </div>
    </div>
  );
}

function FG({ label, full, half, children }) {
  const { C } = useTheme();
  return <div style={{ display:'flex', flexDirection:'column', gap:4, gridColumn:full?'1/-1':half?'span 1':undefined }}><label style={{ fontSize:11, fontWeight:600, color:C.textMid }}>{label}</label>{children}</div>;
}

function Overlay({ children, onClose, wide }) {
  // 2026-08-15: backdrop no longer closes the form on click — see same fix
  // in ui/index.jsx's shared Modal and Procurement.jsx's Overlay.
  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'100%', maxWidth: wide ? 900 : 680, marginBottom:32 }}>{children}</div>
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

function printRequest(r) {
  const itemsHtml = r.items?.length ? `
    <table style="width:100%;border-collapse:collapse;margin-top:12px">
      <thead><tr style="background:#EAF4EC"><th style="padding:6px 10px;text-align:left;font-size:11px;text-transform:uppercase">Description</th><th style="padding:6px 10px;text-align:center;font-size:11px">Qty</th><th style="padding:6px 10px;text-align:left;font-size:11px">Unit</th></tr></thead>
      <tbody>${r.items.map((it,i)=>`<tr style="background:${i%2===1?'#f3faf5':'#fff'}"><td style="padding:6px 10px;font-size:12px">${it.description}</td><td style="padding:6px 10px;text-align:center;font-size:12px">${it.qty}</td><td style="padding:6px 10px;font-size:12px">${it.unit||''}</td></tr>`).join('')}</tbody>
    </table>` : '';
  openPrintWindow(`<!DOCTYPE html><html><head><title>Request ${r.requestNo}</title>
  <style>${PRINT_CSS}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
  .info-item .lbl{font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#182A1C;font-weight:600;margin-bottom:2px}
  .info-item .val{font-size:12px;color:#182A1C}
  .desc-box{background:#f8fbf8;border:1px solid #D4E0D6;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:12px;line-height:1.7;color:#182A1C}
  .approval-box{background:${r.status==='Approved'?'#EAF7EF':r.status==='Rejected'?'#FDEDED':'#FFF8E7'};border:1px solid ${r.status==='Approved'?'#A8D5B5':r.status==='Rejected'?'#F5C6C6':'#FFE082'};border-radius:8px;padding:12px 14px;margin-top:16px}
  </style></head><body>
  ${printHeader(`${r.type.toUpperCase()} REQUEST · ${r.requestNo}`, formatDate(r.date))}
  <div class="info-grid">
    <div class="info-item"><div class="lbl">Requested By</div><div class="val"><strong>${r.requestedBy}</strong></div></div>
    <div class="info-item"><div class="lbl">Department</div><div class="val">${r.department}</div></div>
    <div class="info-item"><div class="lbl">Date</div><div class="val">${formatDate(r.date)}</div></div>
    <div class="info-item"><div class="lbl">Required By</div><div class="val">${formatDate(r.requiredBy)}</div></div>
    <div class="info-item"><div class="lbl">Priority</div><div class="val">${r.priority}</div></div>
    <div class="info-item"><div class="lbl">Status</div><div class="val">${r.status}</div></div>
  </div>
  <div class="desc-box"><strong>Subject:</strong> ${r.subject}<br><br>${r.description}</div>
  ${itemsHtml}
  ${r.approvedBy ? `<div class="approval-box"><strong>${r.status} by:</strong> ${r.approvedBy} on ${formatDate(r.approvedDate)}<br>${r.approvalNote ? `<em>${r.approvalNote}</em>` : ''}</div>` : ''}
  <div class="footer">
    <div><div class="sig">Requested By / Date</div></div>
    <div><div class="sig">Approved By / Date</div></div>
    <div><div class="sig">HOD / Date</div></div>
  </div>
  ${printBootstrap({landscape:false})}</body></html>`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Requests({ onNav }) {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db } = state;
  const perms  = { add: canDo(currentUser,'canAdd','request',state.appSettings), edit: canDo(currentUser,'canEdit','request',state.appSettings), del: canDo(currentUser,'canDelete','request',state.appSettings) };
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'manager';

  const stored = db.request || [];
  const [reqs, setReqs] = useState(stored);

  const save = (data) => {
    diffAndPush('request', reqs, data); // 2026-07-29 full-app sync sweep
    setReqs(data);
    dispatch({ type:'UPDATE_MODULE', mod:'request', data });
    saveDBLocal({ ...db, request: data }, state.activity);
  };

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const th  = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td  = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const [tab, setTab] = useState(() => getDeepLinkTab('request', 'all'));
  const [search, setSearch]   = useState('');
  const [typeFilter, setTF]   = useState('all');
  const [modal, setModal]     = useState(null);
  const [sel2, setSel2]       = useState(null);
  const [delId, setDelId]     = useState(null);
  const [approvalForm, setAF] = useState({ note:'' });

  const EMPTY_ITEM = { id:uid(), description:'', qty:1, unit:'pcs' };
  const EMPTY = { type:'Material', subject:'', description:'', department:currentUser?.role==='admin'?'Engineering':DEPARTMENTS[0], priority:'Normal', date:today(), requiredBy:'', requestedBy:currentUser?.name||'', leaveType:'Annual Leave', leaveFrom:'', leaveTo:'', leaveDays:'', items:[{ ...EMPTY_ITEM }] };
  const [form, setForm] = useState(EMPTY);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return reqs.filter(r => {
      const matchSearch = !s || r.subject.toLowerCase().includes(s) || r.requestedBy.toLowerCase().includes(s) || r.requestNo.toLowerCase().includes(s);
      const matchType   = typeFilter === 'all' || r.type === typeFilter;
      // Live-verify QA fix (2026-08-18): this module's own handleSave() only
      // ever writes status:'Submitted' on submission (never 'Pending' — that
      // only appears inside r.approval.status for the chain engine). Because
      // this "pending" tab checked r.status==='Pending' alone, it was dead —
      // no request could ever land here, so the "Awaiting Action"/"Urgent
      // Pending" KPIs (which correctly count Pending+Submitted, matching
      // Approvals.jsx's own pendingStatuses:['Submitted','Pending'] for this
      // same module) linked straight to a permanently-empty tab. Now matches
      // both statuses here too, same as those two other places already do.
      const matchTab    = tab === 'all' || (tab === 'pending' && (r.status === 'Pending' || r.status === 'Submitted')) || (tab === 'submitted' && r.status === 'Submitted') || (tab === 'approved' && r.status === 'Approved') || (tab === 'mine' && r.requestedBy === currentUser?.name);
      return matchSearch && matchType && matchTab;
    });
  }, [reqs, search, typeFilter, tab, currentUser]);

  const stats = useMemo(() => ({
    total:    reqs.length,
    pending:  reqs.filter(r=>r.status==='Pending'||r.status==='Submitted').length,
    approved: reqs.filter(r=>r.status==='Approved').length,
    urgent:   reqs.filter(r=>r.priority==='Urgent'&&(r.status==='Pending'||r.status==='Submitted')).length,
  }), [reqs]);

  function handleSave(asDraft) {
    if (!form.subject.trim()) { showToast('Subject is required','error'); return; }
    if (!form.requiredBy)     { showToast('Required-by date is needed','error'); return; }
    const rec = {
      id: uid(), requestNo: nextNo(reqs, form.type), ...form,
      status: asDraft ? 'Draft' : 'Submitted',
      approval: asDraft ? null : initApproval('requests', 0, state.appSettings),
      approvedBy:'', approvedDate:'', approvalNote:'',
      createdAt: new Date().toISOString(),
    };
    save([...reqs, rec]);
    logActivity(dispatch, `Request ${rec.requestNo} ${asDraft?'saved as draft':'submitted'} by ${rec.requestedBy}`, currentUser);
    showToast(asDraft ? 'Request saved as draft' : 'Request submitted');
    setModal(null); setForm(EMPTY);
  }

  function handleApprove(id) {
    const r = reqs.find(x=>x.id===id);
    const approval = r.approval ? applyDecision(r.approval, currentUser, 'Approved', approvalForm.note) : null;
    const updated = reqs.map(x => x.id===id ? { ...x, approval, status: approval ? approval.status : 'Approved', approvedBy:currentUser?.name||'Admin', approvedDate:today(), approvalNote:approvalForm.note } : x);
    save(updated);
    logActivity(dispatch, `Request ${r?.requestNo} approved by ${currentUser?.name}`, currentUser);
    showToast('Request approved'); setSel2(null); setModal(null); setAF({ note:'' });
  }

  function handleReject(id) {
    const r = reqs.find(x=>x.id===id);
    const approval = r.approval ? applyDecision(r.approval, currentUser, 'Rejected', approvalForm.note) : null;
    const updated = reqs.map(x => x.id===id ? { ...x, approval, status: approval ? approval.status : 'Rejected', approvedBy:currentUser?.name||'Admin', approvedDate:today(), approvalNote:approvalForm.note } : x);
    save(updated);
    logActivity(dispatch, `Request ${r?.requestNo} rejected`, currentUser);
    showToast('Request rejected'); setSel2(null); setModal(null); setAF({ note:'' });
  }

  // ── Convert approved Material/Service request → Procurement PO ───────────
  function handleConvertToPO(req) {
    // Mark request as converted so the button disappears
    const updated = reqs.map(x => x.id === req.id ? { ...x, convertedToPO: true } : x);
    save(updated);

    // Load current procurement data from central store (Supabase-synced)
    let proc = state.db.procurement || { rfqs:[], pos:[], waybills:[], invoices:[] };

    const year = new Date().getFullYear();
    const poNums = (proc.pos||[]).map(p => parseInt((p.poNo||'0').replace(/\D/g,''),10)).filter(Boolean);
    const nextNum = poNums.length ? Math.max(...poNums)+1 : 1;
    const poNo = `PO-${year}-${String(nextNum).padStart(4,'0')}`;

    const newPO = {
      id: Math.random().toString(36).slice(2,9),
      poNo,
      rfqId: '', rfqNo: '',
      sourceRequestNo: req.requestNo,
      supplier: '', supplierAddress: '',
      date: today(), deliveryDate: req.requiredBy || '',
      deliveryAddress: '',
      description: req.subject,
      paymentTerms: 'Net 30', currency: 'NGN',
      items: (req.items||[]).map(it => ({
        id: Math.random().toString(36).slice(2,9),
        description: it.description,
        qty: it.qty || 1,
        unit: it.unit || 'pcs',
        unitPrice: '',
        totalPrice: 0,
      })),
      subtotal: 0, vatRate: 7.5, vatAmount: 0, total: 0,
      status: 'Draft', approvedBy: '', notes: `Auto-created from Request ${req.requestNo}`,
      createdAt: new Date().toISOString(),
    };

    const updatedProc = { ...proc, pos: [...(proc.pos||[]), newPO] };
    pushOne('procurementPos', newPO); // 2026-07-29 — one new record, no diff needed
    dispatch({ type: 'UPDATE_MODULE', mod: 'procurement', data: updatedProc });

    setModal(null);
    setSel2(null);
    showToast(`PO ${poNo} created in Procurement (Draft) — open Procurement to fill supplier details`, 'success');
    logActivity(dispatch, `Request ${req.requestNo} converted to ${poNo} by ${currentUser?.name}`, currentUser, { module:'request', action:'edit', recordId:req.id });
  }

  const TABS = [
    { key:'all', label:'All' },
    { key:'submitted', label:'Submitted' },
    { key:'pending', label:'Pending' },
    { key:'approved', label:'Approved' },
    { key:'mine', label:'My Requests' },
  ];

  const typeColor = { Material:'#1A5C8A', Service:'#9B59B6', Leave:'#C97A0A', IT:'#16A085', Travel:'#2C3E50', Other:'#6B7280' };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Requests</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Internal requests · approval workflow · tracking</div>
        </div>
        {perms.add && <Btn onClick={()=>{ setForm(EMPTY); setModal('add'); }}>+ New Request</Btn>}
      </div>

      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <KPI label="Total Requests" value={stats.total} sub="all time" />
        <KPI label="Awaiting Action" value={stats.pending} accent={C.amber} alert={stats.pending>0} sub="submitted / pending" onClick={() => setTab("pending")} />
        <KPI label="Approved" value={stats.approved} accent={C.success} sub="processed" onClick={() => setTab("approved")} />
        <KPI label="Urgent Pending" value={stats.urgent} alert={stats.urgent>0} sub="need immediate action" onClick={() => { setTab("pending"); }} />
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'2px solid '+C.borderLight }}>
        {TABS.map(t => (
          <button key={t.key} onClick={()=>setTab(t.key)} style={{ padding:'9px 16px', fontSize:12.5, border:'none', background:'none', cursor:'pointer', fontWeight:tab===t.key?700:400, color:tab===t.key?C.green:C.textMuted, borderBottom:tab===t.key?'2px solid '+C.green:'2px solid transparent', marginBottom:-2, whiteSpace:'nowrap' }}>{t.label}</button>
        ))}
      </div>

      <Card style={{ padding:0, overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px', borderBottom:'1px solid '+C.borderLight, flexWrap:'wrap' }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search subject, requester, request no…" style={{ ...inp, maxWidth:280 }} />
          <select value={typeFilter} onChange={e=>setTF(e.target.value)} style={{ ...inp, width:'auto' }}>
            <option value="all">All Types</option>
            {REQUEST_TYPES.map(t=><option key={t}>{t}</option>)}
          </select>
          <div style={{ marginLeft:'auto', fontSize:11, color:C.textMuted }}>{filtered.length} record{filtered.length!==1?'s':''}</div>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              {['Request No','Type','Subject','Requested By','Dept','Required By','Priority','Status','Actions'].map(h=><th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={9} style={{ ...td, textAlign:'center', padding:36, color:C.textMuted }}>No requests found</td></tr>}
              {filtered.map(r => (
                <tr key={r.id} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                  <td style={td}><span style={{ fontFamily:'monospace', fontWeight:700, color:C.green, fontSize:12 }}>{r.requestNo}</span></td>
                  <td style={td}><span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20, background: typeColor[r.type]+'18', color: typeColor[r.type], border:`1px solid ${typeColor[r.type]}30` }}>{r.type}</span></td>
                  <td style={{ ...td, maxWidth:220 }}><div style={{ fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.subject}</div></td>
                  <td style={td}>{r.requestedBy}</td>
                  <td style={{ ...td, fontSize:11, color:C.textMuted }}>{r.department}</td>
                  <td style={td}>{formatDate(r.requiredBy)}</td>
                  <td style={td}><PriorityTag p={r.priority} /></td>
                  <td style={td}><Tag status={r.status} /></td>
                  <td style={td}>
                    <div style={{ display:'flex', gap:5 }}>
                      <Btn sm variant="ghost" onClick={()=>{ setSel2(r); setAF({ note:'' }); setModal('view'); }}>View</Btn>
                      {(canApproveAtCurrentLevel(r.approval, currentUser) || (isAdmin && !r.approval)) && (r.status==='Submitted'||r.status==='Pending') && <Btn sm variant="success" onClick={()=>{ setSel2(r); setAF({ note:'' }); setModal('approve'); }}>Review</Btn>}
                      <Btn sm variant="ghost" onClick={()=>printRequest(r)}>🖨</Btn>
                      {perms.del && r.status==='Draft' && <Btn sm variant="danger" onClick={()=>setDelId(r.id)}>✕</Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add Modal */}
      {modal === 'add' && (
        <Overlay onClose={()=>setModal(null)} wide>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, paddingBottom:14, borderBottom:'1px solid '+C.borderLight }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Request</div>
              <button onClick={()=>setModal(null)} style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>&times;</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
              <FG label="Request Type"><select style={inp} value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>{REQUEST_TYPES.map(t=><option key={t}>{t}</option>)}</select></FG>
              <FG label="Department"><select style={inp} value={form.department} onChange={e=>setForm(f=>({...f,department:e.target.value}))}>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select></FG>
              <FG label="Priority"><select style={inp} value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}>{PRIORITIES.map(p=><option key={p}>{p}</option>)}</select></FG>
              <FG label="Request Date"><input type="date" style={inp} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} /></FG>
              <FG label="Required By *"><input type="date" style={inp} value={form.requiredBy} onChange={e=>setForm(f=>({...f,requiredBy:e.target.value}))} /></FG>
              <FG label="Requested By"><input style={inp} value={form.requestedBy} onChange={e=>setForm(f=>({...f,requestedBy:e.target.value}))} /></FG>
              <FG label="Subject *" full><input style={inp} value={form.subject} onChange={e=>setForm(f=>({...f,subject:e.target.value}))} placeholder="Brief title for this request" /></FG>
              <FG label="Description / Justification" full><textarea style={{ ...inp, height:90 }} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Detailed description and business justification…" /></FG>

              {form.type === 'Leave' && (
                <>
                  <FG label="Leave Type"><select style={inp} value={form.leaveType} onChange={e=>setForm(f=>({...f,leaveType:e.target.value}))}>{LEAVE_TYPES.map(t=><option key={t}>{t}</option>)}</select></FG>
                  <FG label="Leave From"><input type="date" style={inp} value={form.leaveFrom} onChange={e=>setForm(f=>({...f,leaveFrom:e.target.value}))} /></FG>
                  <FG label="Leave To"><input type="date" style={inp} value={form.leaveTo} onChange={e=>setForm(f=>({...f,leaveTo:e.target.value}))} /></FG>
                  <FG label="Number of Days"><input type="number" style={inp} value={form.leaveDays} onChange={e=>setForm(f=>({...f,leaveDays:e.target.value}))} min="1" /></FG>
                </>
              )}
            </div>

            {(form.type === 'Material' || form.type === 'IT') && (
              <>
                <SecLabel label="Items Required" />
                <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:8 }}>
                  <thead><tr>{['Description','Qty','Unit',''].map(h=><th key={h} style={{ ...th, fontSize:10 }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {form.items.map((it,i)=>(
                      <tr key={it.id}>
                        <td style={{ padding:'4px 6px' }}><input style={inp} value={it.description} onChange={e=>{ const items=[...form.items]; items[i]={...items[i],description:e.target.value}; setForm(f=>({...f,items})); }} placeholder="Item description" /></td>
                        <td style={{ padding:'4px 6px', width:70 }}><input type="number" style={inp} value={it.qty} onChange={e=>{ const items=[...form.items]; items[i]={...items[i],qty:e.target.value}; setForm(f=>({...f,items})); }} min="1" /></td>
                        <td style={{ padding:'4px 6px', width:100 }}><input style={inp} value={it.unit} onChange={e=>{ const items=[...form.items]; items[i]={...items[i],unit:e.target.value}; setForm(f=>({...f,items})); }} /></td>
                        <td style={{ padding:'4px 6px' }}><Btn sm variant="danger" onClick={()=>setForm(f=>({...f,items:f.items.filter((_,idx)=>idx!==i)}))}>✕</Btn></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Btn sm variant="ghost" onClick={()=>setForm(f=>({...f,items:[...f.items,{id:uid(),description:'',qty:1,unit:'pcs'}]}))} style={{ marginBottom:8 }}>+ Add Item</Btn>
              </>
            )}

            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn variant="ghost" onClick={()=>handleSave(true)}>Save Draft</Btn>
              <Btn onClick={()=>handleSave(false)}>Submit Request</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {/* View Modal */}
      {modal === 'view' && sel2 && (
        <Overlay onClose={()=>setModal(null)} wide>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, paddingBottom:14, borderBottom:'1px solid '+C.borderLight }}>
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:C.text }}>{sel2.subject}</div>
                <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>{sel2.requestNo} · {sel2.type} Request · {formatDate(sel2.date)}</div>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <Btn sm variant="ghost" onClick={()=>printRequest(sel2)}>🖨 Print</Btn>
                {sel2.status === 'Approved' && (sel2.type === 'Material' || sel2.type === 'Service') && !sel2.convertedToPO && (
                  <Btn sm variant="amber" onClick={() => handleConvertToPO(sel2)}>🛒 Raise PO</Btn>
                )}
                {sel2.convertedToPO && (
                  <span style={{ fontSize:11, color:'#1A5C8A', fontWeight:600, padding:'4px 10px', background:'rgba(26,92,138,.1)', borderRadius:20 }}>✓ PO Raised</span>
                )}
                <button onClick={()=>setModal(null)} style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>&times;</button>
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14, marginBottom:16 }}>
              {[['Requested By',sel2.requestedBy],['Department',sel2.department],['Priority',sel2.priority],['Date',formatDate(sel2.date)],['Required By',formatDate(sel2.requiredBy)],['Status',sel2.status]].map(([k,v])=>(
                <div key={k}><div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:3 }}>{k}</div><div style={{ fontSize:13, color:C.text }}>{k==='Status'?<Tag status={v}/>:k==='Priority'?<PriorityTag p={v}/>:v}</div></div>
              ))}
            </div>

            <div style={{ background:C.greenPale, borderRadius:8, padding:'12px 14px', fontSize:13, color:C.text, lineHeight:1.7, marginBottom:14 }}>{sel2.description}</div>

            {sel2.items?.length > 0 && (
              <>
                <SecLabel label="Items" />
                <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:14 }}>
                  <thead><tr>{['Description','Qty','Unit'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>{sel2.items.map((it,i)=><tr key={it.id} style={{ background:i%2===1?C.greenPale2:'' }}><td style={td}>{it.description}</td><td style={td}>{it.qty}</td><td style={td}>{it.unit}</td></tr>)}</tbody>
                </table>
              </>
            )}

            {sel2.approvedBy && (
              <div style={{ padding:'10px 14px', background:sel2.status==='Approved'?'rgba(26,122,74,.08)':'rgba(192,57,43,.08)', border:'1px solid '+(sel2.status==='Approved'?'rgba(26,122,74,.2)':'rgba(192,57,43,.2)'), borderLeft:'4px solid '+(sel2.status==='Approved'?C.success:C.danger), borderRadius:8, fontSize:12, color:sel2.status==='Approved'?C.success:C.danger }}>
                <strong>{sel2.status} by {sel2.approvedBy}</strong> on {formatDate(sel2.approvedDate)}{sel2.approvalNote ? ` — ${sel2.approvalNote}` : ''}
              </div>
            )}
          </Card>
        </Overlay>
      )}

      {/* Approve Modal */}
      {modal === 'approve' && sel2 && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:4 }}>Review Request</div>
            <div style={{ fontSize:12, color:C.textMuted, marginBottom:16 }}>{sel2.requestNo} · {sel2.requestedBy} · {sel2.type}</div>
            <div style={{ background:C.greenPale, borderRadius:8, padding:'11px 14px', fontSize:13, marginBottom:16 }}><strong>{sel2.subject}</strong><br/><span style={{ color:C.textMid, fontSize:12 }}>{sel2.description}</span></div>
            {sel2.approval && <div style={{ fontSize:12, fontWeight:600, color:C.amber, marginBottom:12 }}>{approvalSummary(sel2.approval, state.appSettings)}</div>}
            <FG label="Approval Note (optional)"><textarea style={{ ...inp, height:70 }} value={approvalForm.note} onChange={e=>setAF(f=>({...f,note:e.target.value}))} placeholder="Add a comment or instruction…" /></FG>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              {(canApproveAtCurrentLevel(sel2.approval, currentUser) || (isAdmin && !sel2.approval)) && <>
                <Btn variant="danger" onClick={()=>handleReject(sel2.id)}>Reject</Btn>
                <Btn variant="success" onClick={()=>handleApprove(sel2.id)}>Approve</Btn>
              </>}
            </div>
          </Card>
        </Overlay>
      )}

      {delId && (
        <div style={{ position:'fixed', inset:0, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <Card style={{ maxWidth:360, textAlign:'center' }}>
            <div style={{ fontSize:30, marginBottom:10 }}>⚠️</div>
            <div style={{ fontSize:15, fontWeight:600, color:C.text, marginBottom:20 }}>Delete this draft request?</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              <Btn variant="ghost" onClick={()=>setDelId(null)}>Cancel</Btn>
              <Btn variant="danger" onClick={()=>{ save(reqs.filter(r=>r.id!==delId)); showToast('Deleted'); setDelId(null); }}>Delete</Btn>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
