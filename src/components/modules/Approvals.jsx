// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — APPROVALS MODULE v1.0
// Centralised approval queue: Requests · POs · Invoices · Petty Cash · WHT
// One screen to review, approve, or reject anything pending across all modules
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo, useEffect, useRef } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { showToast, formatDate } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { diffAndPush } from '../../hooks/usePerRecordSync';
import { applyDecision, canApproveAtCurrentLevel } from '../../utils/approvalEngine';

// Approvals mod key → RECORD_TABLES key. 'procurement' here only ever
// touches .pos (see getModRecords/saveModRecords below), so it maps to
// procurementPos specifically, not the whole procurement collection.
const APPROVAL_TABLE_BY_MOD = { request: 'request', pettycash: 'pettycash', procurement: 'procurementPos' };

const today = () => new Date().toISOString().split('T')[0];

function Tag({ status }) {
  const { C } = useTheme();
  const m = {
    Pending:[C.warning,'rgba(201,122,10,.12)'], Submitted:['#1A5C8A','rgba(26,92,138,.12)'],
    Approved:[C.success,'rgba(26,122,74,.12)'], Rejected:[C.danger,'rgba(192,57,43,.12)'],
    Deducted:[C.warning,'rgba(201,122,10,.12)'],
  };
  const [c,bg] = m[status]||['#6B7280','rgba(107,114,128,.12)'];
  return <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:500, color:c, background:bg, border:`1px solid ${c}30`, whiteSpace:'nowrap' }}>{status}</span>;
}

function PriorityDot({ p }) {
  const { C } = useTheme();
  const c = { Low:C.textMuted, Normal:C.info, High:C.warning, Urgent:C.danger }[p]||C.textMuted;
  return <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:c, marginRight:5 }} title={p} />;
}

function Btn({ children, onClick, variant='primary', sm, disabled, style={} }) {
  const { C } = useTheme();
  const V = { primary:{bg:C.green,co:'#fff',b:'none'}, ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border}, danger:{bg:C.danger,co:'#fff',b:'none'}, success:{bg:C.success,co:'#fff',b:'none'}, amber:{bg:C.amber,co:'#fff',b:'none'} }[variant]||{};
  return <button onClick={onClick} disabled={disabled} style={{ background:V.bg, color:V.co, border:V.b, borderRadius:7, padding:sm?'4px 11px':'7px 16px', fontSize:sm?11.5:13, fontWeight:500, cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1, display:'inline-flex', alignItems:'center', gap:5, whiteSpace:'nowrap', ...style }}>{children}</button>;
}

function KPI({ label, value, sub, accent, alert, onClick }) {
  const { C } = useTheme();
  const c = alert ? C.danger : accent || C.green;
  return (
    <div onClick={onClick} style={{ background:C.bgCard, border:'1px solid '+(alert?C.danger+'40':C.border), borderRadius:12, padding:'13px 15px', flex:1, minWidth:140, position:'relative', boxShadow:C.shadowCard, cursor:onClick?'pointer':'default' }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:c, borderRadius:'12px 0 0 12px' }} />
      <div style={{ paddingLeft:8 }}>
        <div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:4 }}>{label}</div>
        <div style={{ fontSize:26, fontWeight:700, color:c, lineHeight:1 }}>{value}</div>
        {sub && <div style={{ fontSize:11, color:C.textMuted, marginTop:3 }}>{sub}</div>}
      </div>
    </div>
  );
}

function Overlay({ children, onClose }) {
  // 2026-08-15: backdrop no longer closes the form on click — see same fix
  // in ui/index.jsx's shared Modal and Procurement.jsx's Overlay.
  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px 16px' }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'100%', maxWidth:560 }}>{children}</div>
    </div>
  );
}

function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'18px 20px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}

// Module configs: which db key, what fields to show, what status = "pending"
const MODULE_CONFIGS = {
  request: {
    label:'Requests', icon:'📋',
    pendingStatuses:['Submitted','Pending'],
    getTitle: r => r.subject || r.requestNo,
    getSubtitle: r => `${r.type} · ${r.requestedBy} · ${r.department}`,
    getDate: r => r.date,
    getPriority: r => r.priority,
    getRef: r => r.requestNo,
    // QA fix: same nested-approval-chain issue as procurement above.
    // Requests.jsx's own approve/reject (lines ~207/216) route through
    // `item.approval` (requiredRoles/currentLevel/history) when present;
    // this queue used to set only the top-level `status`, which would skip
    // remaining levels on a multi-approver chain and desync `approval.status`
    // from Requests.jsx's own approval panel.
    approve: (item, note, user) => {
      if (!item.approval) return { ...item, status:'Approved', approvedBy:user?.name||'Admin', approvedDate:today(), approvalNote:note };
      const approval = applyDecision(item.approval, user, 'Approved', note);
      return { ...item, approval, status:approval.status, approvedBy:user?.name||'Admin', approvedDate:today(), approvalNote:note };
    },
    reject: (item, note, user) => {
      if (!item.approval) return { ...item, status:'Rejected', approvedBy:user?.name||'Admin', approvedDate:today(), approvalNote:note };
      const approval = applyDecision(item.approval, user, 'Rejected', note);
      return { ...item, approval, status:approval.status, approvedBy:user?.name||'Admin', approvedDate:today(), approvalNote:note };
    },
    dispatchMod: 'request',
  },
  pettycash: {
    label:'Petty Cash', icon:'💵',
    pendingStatuses:['Pending'],
    getTitle: r => r.payee || r.voucherNo,
    getSubtitle: r => `${r.category} · Requested by: ${r.requestedBy} · ₦${(Number(r.amount)||0).toLocaleString('en-NG')}`,
    getDate: r => r.date,
    getPriority: r => 'Normal',
    getRef: r => r.voucherNo,
    // QA fix: same nested-approval-chain issue as procurement/request above —
    // PettyCash.jsx's own approve/reject (lines ~232/249) route through
    // item.approval via applyDecision(). Mirrored here, including PettyCash's
    // own quirk that reject always finalizes to 'Rejected' outright (no
    // partial-chain "rejected at this level" state) while approve can stay
    // 'Pending' if more approval levels remain.
    approve: (item, note, user) => {
      const approval = item.approval ? applyDecision(item.approval, user, 'Approved', note) : { status: 'Approved' };
      return { ...item, approval, status: approval.status, approvedBy: approval.status === 'Approved' ? (user?.name||'Admin') : item.approvedBy };
    },
    reject: (item, note, user) => {
      const approval = item.approval ? applyDecision(item.approval, user, 'Rejected', note) : null;
      return { ...item, approval, status:'Rejected', approvedBy:user?.name||'Admin' };
    },
    dispatchMod: 'pettycash',
  },
  // 2026-08-18 QA fix: removed the 'invoices' tile. It pointed at db.invoices
  // (AR's customer invoices), and its approve() set status:'Paid' directly —
  // a single click with no receivedAmount, payment date, or bank reference.
  // AccountsReceivable.jsx v2.0's own header comment explains this exact
  // "mark as Paid" shortcut was deliberately replaced there with proper
  // receipt vouchers (amount/date/ref, WHT/NCDF deductions, partial-payment
  // support) — this queue still had the old shortcut wired to the same
  // table, so it was a live backdoor that could fake a customer payment
  // (inflating collected revenue and hiding true AR outstanding/aging,
  // since those calcs key off receivedAmount, not just status). Every AR
  // invoice is also created with status:'Pending' — that means "awaiting
  // customer payment", not "awaiting internal sign-off" — so 100% of
  // invoices ever raised were incorrectly surfaced here as pending approval.
  // Standard ERP practice (SAP, NetSuite, Odoo) never lets a generic
  // "approve" action record customer payment — that always goes through a
  // dedicated receipt/cash-application screen, which AR already has. If a
  // genuine pre-payment sign-off is wanted for vendor bills (AP), that
  // belongs on Procurement's real invoices once AP is wired up (see the
  // separate "wire Accounts Payable to real Procurement invoices" item),
  // not on AR's customer invoices.
  procurement: {
    label:'Purchase Orders', icon:'🛒',
    // QA fix (2026-08-14): was ['Pending Approval','Submitted'] — those
    // strings are never actually set anywhere. Procurement.jsx's own
    // submitForApproval() sets status:'Pending' (see approvalEngine.js
    // initApproval()), so every PO ever submitted for approval was
    // permanently invisible to this centralised queue. Same recurring
    // pattern as the earlier poStatus.js drift bug: two screens
    // computing/checking the same status field with different string sets
    // that silently fall out of sync.
    pendingStatuses:['Pending'],
    getTitle: r => r.subject || r.poNo || r.id,
    getSubtitle: r => `${r.supplier||r.vendor||''} · ₦${(Number(r.totalAmount||r.total||r.amount)||0).toLocaleString('en-NG')}`,
    getDate: r => r.date || r.createdAt,
    getPriority: r => r.priority || 'Normal',
    getRef: r => r.poNo || r.id,
    // QA fix: approve/reject here used to set only the top-level `status`
    // field directly. POs actually carry a multi-level approval chain in
    // `item.approval` (requiredRoles/currentLevel/history — see
    // Procurement.jsx's own decide(), which calls applyDecision()). Setting
    // status:'Approved' directly from here would (a) skip any remaining
    // approval levels on a multi-approver chain instead of advancing it one
    // step, and (b) leave `approval.status` stuck on 'Pending' forever,
    // desyncing this queue's action from Procurement's own approval panel.
    // Routing through the same applyDecision() the PO screen uses keeps both
    // entry points consistent.
    approve: (item, note, user) => {
      if (!item.approval) return { ...item, status:'Approved', approvedBy:user?.name||'Admin', approvalNote:note };
      const approval = applyDecision(item.approval, user, 'Approved', note);
      return { ...item, approval, status:approval.status, approvedBy: approval.status === 'Approved' ? (user?.name||'Admin') : item.approvedBy, approvalNote:note };
    },
    reject: (item, note, user) => {
      if (!item.approval) return { ...item, status:'Rejected', approvalNote:note };
      const approval = applyDecision(item.approval, user, 'Rejected', note);
      return { ...item, approval, status:approval.status, approvalNote:note };
    },
    dispatchMod: 'procurement',
  },
};

export default function Approvals() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db } = state;
  // 2026-08-18 QA fix: Sidebar.jsx grants the Approvals menu item itself to
  // admin, manager, AND accountant (layout/Sidebar.jsx: `isAdmin || role ===
  // 'manager' || isAccountant`), but this screen's own action-gating flag
  // only checked admin/manager — so an accountant could open the queue but
  // every approve/reject control was hidden and the "view-only" banner
  // showed, even though accountants are exactly who normally signs off on
  // petty cash, invoices, and vendor POs in practice. Matched to Sidebar's
  // rule so visibility and action rights agree.
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'accountant';

  // 2026-08-18 QA fix: `isAdmin` above is a coarse "can see approval
  // controls at all" flag. It was the ONLY gate on the ✓/✗ buttons and
  // batch-approve here, meaning any manager (or now accountant) could click
  // through EVERY level of a multi-level chain from this centralised
  // screen — e.g. a >₦2M PO's Manager→Accountant→Admin band (see
  // approvalEngine.js DEFAULT_APPROVAL_RULES) could be fully approved by a
  // manager alone, since applyDecision() itself doesn't check who's acting,
  // only the caller does. Procurement/Requests/PettyCash's own screens gate
  // per-level via canApproveAtCurrentLevel(); this queue never did. That
  // defeats the whole point of amount-banded chains (segregation of
  // duties), matching SAP/NetSuite/Odoo's standard authorization-limit
  // behavior where each level can only be actioned by its assigned role
  // (or admin, which always bypasses). Items with no `.approval` chain
  // (legacy flat status) fall back to the coarse isAdmin gate unchanged.
  const canActOn = (item) => item?.approval ? canApproveAtCurrentLevel(item.approval, currentUser) : isAdmin;

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const th  = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td  = { padding:'10px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const [modFilter, setModFilter] = useState('all');
  const [modal, setModal]         = useState(null);
  const [sel2, setSel2]           = useState(null);
  const [note, setNote]           = useState('');
  const [batchSel, setBatchSel]   = useState(new Set());

  // ── FIX: Notify when new items arrive in the approval queue ───────────────
  const prevCountRef = useRef(null);

  // db.procurement is an object {rfqs, pos, waybills, invoices} — POs live in .pos
  // All other approval modules use flat arrays in db[mod]
  function getModRecords(mod) {
    if (mod === 'procurement') return db.procurement?.pos || [];
    return db[mod] || [];
  }
  function saveModRecords(mod, updated) {
    // Per-record push — 2026-07-29 full-app sync sweep. getModRecords(mod)
    // above is the exact same reader used to build `allPending`, so it's
    // also the correct "prev" list to diff against here.
    const table = APPROVAL_TABLE_BY_MOD[mod];
    if (table) diffAndPush(table, getModRecords(mod), updated);
    if (mod === 'procurement') {
      const next = { ...db.procurement, pos: updated };
      dispatch({ type:'UPDATE_MODULE', mod:'procurement', data: next });
      saveDBLocal({ ...db, procurement: next }, state.activity);
    } else {
      dispatch({ type:'UPDATE_MODULE', mod, data: updated });
      saveDBLocal({ ...db, [mod]: updated }, state.activity);
    }
  }

  // Collect all pending items across all modules — MUST be declared before the useEffect below
  const allPending = useMemo(() => {
    const list = [];
    Object.entries(MODULE_CONFIGS).forEach(([mod, cfg]) => {
      const records = getModRecords(mod);
      records.forEach(item => {
        if (cfg.pendingStatuses.includes(item.status)) {
          list.push({ item, mod, cfg });
        }
      });
    });
    return list.sort((a,b) => new Date(b.cfg.getDate(b.item)||0) - new Date(a.cfg.getDate(a.item)||0));
  }, [db]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── FIX: Notify when new items arrive in the approval queue ───────────────
  useEffect(() => {
    if (prevCountRef.current === null) { prevCountRef.current = allPending.length; return; }
    if (allPending.length > prevCountRef.current) {
      const diff = allPending.length - prevCountRef.current;
      showToast(`${diff} new item${diff > 1 ? 's' : ''} added to the approval queue`, 'info');
    }
    prevCountRef.current = allPending.length;
  }, [allPending.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (modFilter === 'all') return allPending;
    return allPending.filter(x => x.mod === modFilter);
  }, [allPending, modFilter]);

  const countByMod = useMemo(() => {
    const map = {};
    allPending.forEach(x => { map[x.mod] = (map[x.mod]||0) + 1; });
    return map;
  }, [allPending]);

  function applyAction(item, mod, cfg, action, actionNote) {
    const records  = getModRecords(mod);
    const before   = records.find(r => r.id === item.id);
    // Guard: if the record was deleted between render and click, bail out
    // cleanly instead of passing `undefined` to logActivity which left a
    // diff-less audit entry (the approval happened but no before-state was
    // captured).
    if (!before) {
      showToast('Record no longer exists', 'error');
      return;
    }
    // Defense in depth — the buttons that call this are already gated by
    // canActOn(), but re-check here against the live record in case it
    // advanced to a different level (e.g. someone else actioned it) between
    // render and click.
    if (!canActOn(before)) {
      showToast('Your role cannot action this item at its current approval level', 'error');
      return;
    }
    const updated  = records.map(r => r.id === item.id ? cfg[action](r, actionNote, currentUser) : r);
    const after    = updated.find(r => r.id === item.id);
    saveModRecords(mod, updated);
    logActivity(
      dispatch,
      `${action === 'approve' ? 'Approved' : 'Rejected'}: ${cfg.getRef(item)} (${cfg.label})`,
      currentUser,
      { module: mod, action: action === 'approve' ? 'approve' : 'edit', recordId: item.id, before, after }
    );
    showToast(action === 'approve' ? '✓ Approved' : '✕ Rejected');
  }

  function handleAction(action) {
    if (!sel2) return;
    applyAction(sel2.item, sel2.mod, sel2.cfg, action, note);
    setModal(null); setNote(''); setSel2(null);
  }

  function handleBatchApprove() {
    if (batchSel.size === 0) return;
    // CRITICAL FIX: previously this looped over batchSel and called applyAction
    // per-item, each of which dispatched UPDATE_MODULE + saveDBLocal using
    // the SAME render-closure snapshot of `db`. Synchronous dispatches land
    // in React's batched reducer, but saveDBLocal writes to localStorage
    // immediately — so only the LAST item per module survived a page reload.
    // Now we group items by module, compute the full updated list in one
    // pass per module, and dispatch + saveDBLocal ONCE per module.
    const byModule = new Map(); // mod -> { cfg, items: [{item, before, after}] }
    batchSel.forEach(key => {
      const [mod, id] = key.split('::');
      const cfg = MODULE_CONFIGS[mod];
      if (!cfg) return;
      // For procurement, records live in db.procurement.pos; for everything
      // else, db[mod]. Same lookup as getModRecords but inlined so we don't
      // re-read from the closure between iterations.
      const records = mod === 'procurement' ? (db.procurement?.pos || []) : (db[mod] || []);
      const before = records.find(r => r.id === id);
      if (!before) return; // deleted between render and click — skip
      if (!canActOn(before)) return; // not this user's level to action — skip
      const after = cfg.approve(before, '', currentUser);
      if (!byModule.has(mod)) byModule.set(mod, { cfg, records, updates: [] });
      byModule.get(mod).updates.push({ id, before, after });
    });

    byModule.forEach(({ cfg, records, updates }, mod) => {
      const updatedList = records.map(r => {
        const u = updates.find(x => x.id === r.id);
        return u ? u.after : r;
      });
      saveModRecords(mod, updatedList);
      // One audit-log entry per item (preserves per-item history) but only
      // one saveDBLocal per module (preserves the data).
      updates.forEach(({ item: before, after }) => {
        // `before` here is actually the original record — extract ref
        logActivity(
          dispatch,
          `Approved: ${cfg.getRef(before)} (${cfg.label})`,
          currentUser,
          { module: mod, action: 'approve', recordId: before.id, before, after }
        );
      });
    });

    const approvedCount = Array.from(byModule.values()).reduce((s, m) => s + m.updates.length, 0);
    const skipped = batchSel.size - approvedCount;
    showToast(skipped > 0
      ? `${approvedCount} item${approvedCount===1?'':'s'} approved — ${skipped} skipped (not your approval level)`
      : `${approvedCount} item${approvedCount===1?'':'s'} approved`);
    setBatchSel(new Set());
  }

  const toggleBatch = (key) => {
    setBatchSel(prev => {
      const s = new Set(prev);
      s.has(key) ? s.delete(key) : s.add(key);
      return s;
    });
  };

  const MOD_LABELS = { all:'All', ...Object.fromEntries(Object.entries(MODULE_CONFIGS).map(([k,v])=>[k,v.label])) };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Approvals</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Centralised approval queue — review and action pending items across all modules</div>
        </div>
        {batchSel.size > 0 && isAdmin && (
          <Btn variant="success" onClick={handleBatchApprove}>✓ Approve Selected ({batchSel.size})</Btn>
        )}
      </div>

      {!isAdmin && (
        <div style={{ padding:'12px 16px', background:'rgba(26,92,138,.08)', border:'1px solid rgba(26,92,138,.25)', borderLeft:'4px solid '+C.info, borderRadius:8, fontSize:12, color:C.info }}>
          You have view-only access to the approval queue. Contact an Admin or Manager to approve items.
        </div>
      )}

      {/* Summary KPIs */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <KPI label="Total Pending" value={allPending.length} alert={allPending.length>0} sub="across all modules" onClick={()=>setModFilter('all')} />
        {Object.entries(MODULE_CONFIGS).map(([mod,cfg]) => (
          countByMod[mod] ? (
            <KPI key={mod} label={cfg.label} value={countByMod[mod]} accent={C.amber} sub="awaiting action" onClick={()=>setModFilter(mod)} />
          ) : null
        ))}
      </div>

      {/* Empty state */}
      {allPending.length === 0 && (
        <Card style={{ textAlign:'center', padding:'48px 20px' }}>
          <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
          <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:6 }}>All clear — nothing pending approval</div>
          <div style={{ fontSize:13, color:C.textMuted }}>When requests, purchase orders, invoices, or petty cash vouchers need approval, they'll appear here.</div>
        </Card>
      )}

      {allPending.length > 0 && (
        <Card style={{ padding:0, overflow:'hidden' }}>
          {/* Filter tabs */}
          <div style={{ display:'flex', alignItems:'center', gap:0, borderBottom:'1px solid '+C.borderLight, padding:'0 16px', overflowX:'auto' }}>
            {Object.entries(MOD_LABELS).map(([key,label]) => (
              <button key={key} onClick={()=>setModFilter(key)} style={{ padding:'11px 16px', fontSize:12.5, border:'none', background:'none', cursor:'pointer', fontWeight:modFilter===key?700:400, color:modFilter===key?C.green:C.textMuted, borderBottom:modFilter===key?'2px solid '+C.green:'2px solid transparent', marginBottom:-1, whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:5 }}>
                {label}
                {key!=='all' && countByMod[key] ? <span style={{ background:C.danger, color:'#fff', borderRadius:20, fontSize:10, fontWeight:700, padding:'1px 6px', minWidth:16 }}>{countByMod[key]}</span> : null}
              </button>
            ))}
          </div>

          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                {isAdmin && <th style={{ ...th, width:36 }}><input type="checkbox" onChange={e=>{ if(e.target.checked) setBatchSel(new Set(filtered.filter(x=>canActOn(x.item)).map(x=>`${x.mod}::${x.item.id}`))); else setBatchSel(new Set()); }} /></th>}
                <th style={th}>Module</th>
                <th style={th}>Ref No.</th>
                <th style={th}>Subject / Description</th>
                <th style={th}>Date</th>
                <th style={th}>Priority</th>
                <th style={th}>Status</th>
                <th style={th}>Actions</th>
              </tr></thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={isAdmin?8:7} style={{ ...td, textAlign:'center', padding:32, color:C.textMuted }}>No items in this category</td></tr>}
                {filtered.map(({ item, mod, cfg }) => {
                  const key = `${mod}::${item.id}`;
                  const isChecked = batchSel.has(key);
                  return (
                    <tr key={key} style={{ background:isChecked?C.greenPale2:'' }} onMouseEnter={e=>{ if(!isChecked) e.currentTarget.style.background=C.greenPale2; }} onMouseLeave={e=>{ if(!isChecked) e.currentTarget.style.background=''; }}>
                      {isAdmin && <td style={td}><input type="checkbox" checked={isChecked} disabled={!canActOn(item)} title={!canActOn(item) ? 'Not your approval level yet' : undefined} onChange={()=>toggleBatch(key)} /></td>}
                      <td style={td}><span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:20, background:C.greenPale, color:C.green, border:'1px solid '+C.borderLight }}>{cfg.icon} {cfg.label}</span></td>
                      <td style={td}><span style={{ fontFamily:'monospace', fontWeight:700, color:C.green, fontSize:12 }}>{cfg.getRef(item)}</span></td>
                      <td style={{ ...td, maxWidth:260 }}>
                        <div style={{ fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cfg.getTitle(item)}</div>
                        <div style={{ fontSize:11, color:C.textMuted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cfg.getSubtitle(item)}</div>
                      </td>
                      <td style={td}>{formatDate(cfg.getDate(item))}</td>
                      <td style={td}>
                        {cfg.getPriority(item) !== 'Normal' ? (
                          <span style={{ fontSize:11, fontWeight:600, color:cfg.getPriority(item)==='Urgent'?C.danger:C.warning }}>
                            <PriorityDot p={cfg.getPriority(item)} />{cfg.getPriority(item)}
                          </span>
                        ) : <span style={{ fontSize:11, color:C.textMuted }}><PriorityDot p="Normal" />Normal</span>}
                      </td>
                      <td style={td}><Tag status={item.status} /></td>
                      <td style={td}>
                        <div style={{ display:'flex', gap:5 }}>
                          <Btn sm variant="ghost" onClick={()=>{ setSel2({ item, mod, cfg }); setNote(''); setModal('view'); }}>View</Btn>
                          {canActOn(item) && (
                            <>
                              <Btn sm variant="success" onClick={()=>{ setSel2({ item, mod, cfg }); setNote(''); setModal('approve'); }}>✓</Btn>
                              <Btn sm variant="danger" onClick={()=>{ setSel2({ item, mod, cfg }); setNote(''); setModal('reject'); }}>✗</Btn>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding:'10px 16px', borderTop:'1px solid '+C.borderLight, fontSize:11, color:C.textMuted, display:'flex', justifyContent:'space-between' }}>
            <span>{filtered.length} item{filtered.length!==1?'s':''} pending</span>
            {batchSel.size > 0 && <span style={{ color:C.green, fontWeight:600 }}>{batchSel.size} selected</span>}
          </div>
        </Card>
      )}

      {/* View Modal */}
      {modal === 'view' && sel2 && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:14, borderBottom:'1px solid '+C.borderLight }}>
              <div>
                <div style={{ fontSize:15, fontWeight:700, color:C.text }}>{sel2.cfg.getTitle(sel2.item)}</div>
                <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>{sel2.cfg.icon} {sel2.cfg.label} · {sel2.cfg.getRef(sel2.item)}</div>
              </div>
              <button onClick={()=>setModal(null)} style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>&times;</button>
            </div>
            <div style={{ fontSize:13, color:C.textMid, lineHeight:1.8 }}>{sel2.cfg.getSubtitle(sel2.item)}</div>
            {sel2.item.description && <div style={{ marginTop:12, background:C.greenPale, borderRadius:8, padding:'10px 12px', fontSize:12, color:C.textMid, lineHeight:1.7 }}>{sel2.item.description}</div>}
            {canActOn(sel2.item) ? (
              <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
                <Btn variant="danger" onClick={()=>{ setModal('reject'); }}>Reject</Btn>
                <Btn variant="success" onClick={()=>{ setModal('approve'); }}>Approve</Btn>
              </div>
            ) : sel2.item.approval && (
              <div style={{ marginTop:16, padding:'8px 12px', background:'rgba(201,122,10,.08)', border:'1px solid rgba(201,122,10,.25)', borderLeft:'4px solid '+C.warning, borderRadius:8, fontSize:11.5, color:C.warning }}>
                This item is waiting on level {sel2.item.approval.currentLevel+1} of {sel2.item.approval.requiredRoles.length} ({sel2.item.approval.requiredRoles[sel2.item.approval.currentLevel]}) — your role can't action it yet.
              </div>
            )}
          </Card>
        </Overlay>
      )}

      {/* Approve / Reject Modals */}
      {(modal === 'approve' || modal === 'reject') && sel2 && (
        <Overlay onClose={()=>setModal(null)}>
          <Card style={{ maxWidth:480 }}>
            <div style={{ fontSize:16, fontWeight:700, color:modal==='approve'?C.success:C.danger, marginBottom:4 }}>
              {modal === 'approve' ? '✓ Approve' : '✗ Reject'} — {sel2.cfg.label}
            </div>
            <div style={{ fontSize:12, color:C.textMuted, marginBottom:14 }}>{sel2.cfg.getTitle(sel2.item)}</div>
            <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:16 }}>
              <label style={{ fontSize:11, fontWeight:600, color:C.textMid }}>Note (optional)</label>
              <textarea style={{ ...inp, height:72 }} value={note} onChange={e=>setNote(e.target.value)} placeholder={modal==='approve'?'Add approval note or instruction…':'State reason for rejection…'} />
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn variant={modal==='approve'?'success':'danger'} onClick={()=>handleAction(modal==='approve'?'approve':'reject')}>
                {modal==='approve'?'Confirm Approval':'Confirm Rejection'}
              </Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </div>
  );
}
