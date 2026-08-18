// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — DASHBOARD v1.0
// Aggregates live data from all modules: Staff · Procurement · Inventory
// Terminal Ops · Invoices · Accounting · Activity feed · Alerts
// ══════════════════════════════════════════════════════════════════════════════
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { writeDeepLink, getDeepLinkTab } from '../../utils/helpers';
import { getPOStatus } from '../../utils/poStatus';

// ── Mini components ───────────────────────────────────────────────────────────
function KPI({ label, value, sub, accent, icon, onClick }) {
  const { C } = useTheme();
  const c = accent || C.green;
  return (
    <div onClick={onClick} style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'14px 16px', flex:1, minWidth:160, position:'relative', boxShadow:C.shadowCard, cursor:onClick?'pointer':'default' }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:c, borderRadius:'12px 0 0 12px' }} />
      {icon && <div style={{ position:'absolute', right:14, top:'50%', transform:'translateY(-50%)', fontSize:24, opacity:.12 }}>{icon}</div>}
      <div style={{ paddingLeft:8 }}>
        <div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:5 }}>{label}</div>
        <div style={{ fontSize:22, fontWeight:700, color:c, lineHeight:1 }}>{value}</div>
        {sub && <div style={{ fontSize:11, color:C.textMuted, marginTop:4 }}>{sub}</div>}
      </div>
    </div>
  );
}

function SectionHeader({ title, icon, count }) {
  const { C } = useTheme();
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
      <span style={{ fontSize:16 }}>{icon}</span>
      <span style={{ fontSize:14, fontWeight:700, color:C.text }}>{title}</span>
      {count != null && <span style={{ fontSize:11, padding:'1px 8px', background:C.greenPale, color:C.green, borderRadius:20, fontWeight:600 }}>{count}</span>}
    </div>
  );
}

function Tag({ status }) {
  const { C } = useTheme();
  const map = {
    'Active':['#1A7A4A','rgba(26,122,74,.12)'], 'Released':['#1A7A4A','rgba(26,122,74,.12)'],
    'Complete':['#1A7A4A','rgba(26,122,74,.12)'], 'Paid':['#1A7A4A','rgba(26,122,74,.12)'],
    'Pending':['#C97A0A','rgba(201,122,10,.12)'], 'Partial':['#C97A0A','rgba(201,122,10,.12)'],
    'Under Exam':['#9B59B6','rgba(155,89,182,.12)'], 'Approved':['#1A5C8A','rgba(26,92,138,.12)'],
    'Overdue':['#C0392B','rgba(192,57,43,.12)'], 'Held':['#C0392B','rgba(192,57,43,.12)'],
  };
  const [c, bg] = map[status] || ['#6B7280','rgba(107,114,128,.12)'];
  return <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:20, fontSize:11, fontWeight:500, color:c, background:bg, border:`1px solid ${c}30`, whiteSpace:'nowrap' }}>{status}</span>;
}

function AlertBanner({ icon, message, sub, accent, onClick }) {
  const { C } = useTheme();
  const c = accent || C.amber;
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 14px',
        background:c+'12', border:'1px solid '+c+'30', borderLeft:'4px solid '+c,
        borderRadius:8, cursor:clickable?'pointer':'default',
        transition:'background 0.15s, transform 0.1s',
      }}
      onMouseEnter={e=>{ if(clickable){ e.currentTarget.style.background=c+'22'; e.currentTarget.style.transform='translateX(2px)'; }}}
      onMouseLeave={e=>{ if(clickable){ e.currentTarget.style.background=c+'12'; e.currentTarget.style.transform='translateX(0)'; }}}
    >
      <span style={{ fontSize:18, flexShrink:0 }}>{icon}</span>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{message}</div>
        {sub && <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>{sub}</div>}
      </div>
      {clickable && <span style={{ fontSize:16, color:c, alignSelf:'center', flexShrink:0 }}>→</span>}
    </div>
  );
}

function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'16px 18px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}

function MiniTable({ headers, rows, thBg }) {
  const { C } = useTheme();
  const bg = thBg || C.green;
  const th = { padding:'7px 8px', textAlign:'left', fontSize:10, fontWeight:700, color:'#fff', textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:bg };
  const td = (i) => ({ padding:'7px 8px', borderBottom:'1px solid '+C.borderLight, fontSize:11.5, color:C.text, background:i%2===1?C.greenPale2:'transparent' });
  return (
    <div style={{ overflowX:'auto', borderRadius:8, border:'1px solid '+C.border }}>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr>{headers.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={headers.length} style={{ padding:20, textAlign:'center', color:C.textMuted, fontSize:12 }}>No records</td></tr>
            : rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} style={td(i)}>{cell}</td>)}</tr>)
          }
        </tbody>
      </table>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function Bar({ label, value, max, color, format }) {
  const { C } = useTheme();
  const pct = max > 0 ? Math.min((value/max)*100, 100) : 0;
  const c = color || C.green;
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:4 }}>
        <span style={{ color:C.textMid, fontWeight:500 }}>{label}</span>
        <span style={{ color:c, fontWeight:700 }}>{format ? format(value) : value}</span>
      </div>
      <div style={{ height:6, borderRadius:3, background:C.borderLight }}>
        <div style={{ height:'100%', width:pct+'%', background:c, borderRadius:3, transition:'width .4s' }} />
      </div>
    </div>
  );
}

// ── Dept payroll donut (CSS-based) ────────────────────────────────────────────
function DeptPayrollList({ staff }) {
  const { C } = useTheme();
  const byDept = {};
  staff.forEach(s => {
    const d = s.department || 'Other';
    byDept[d] = (byDept[d]||0) + (Number(s.basicSalary)||0) + (Number(s.housing)||0) + (Number(s.transport)||0);
  });
  const total = Object.values(byDept).reduce((a,v)=>a+v,0);
  const sorted = Object.entries(byDept).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const COLORS = [C.green, C.amber, C.info, '#9B59B6', C.success, C.warning];
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {sorted.map(([dept, val], i) => (
        <Bar key={dept} label={dept} value={val} max={total} color={COLORS[i%COLORS.length]} format={formatCurrency} />
      ))}
      {sorted.length === 0 && <div style={{ color:C.textMuted, fontSize:12 }}>No payroll data</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function Dashboard({ onNav }) {
  const { state }   = useApp();
  const { C }       = useTheme();
  const { currentUser, db, activity, appSettings } = state;

  // ── Pull data from all modules ──────────────────────────────────────────
  const nlng      = db.nlng      || [];
  const slotStaff = db.slot      || [];
  const allStaff  = [...nlng, ...slotStaff];

  // All module data now lives in the central AppContext store (Supabase-synced)
  const procData  = state.db.procurement || {};
  const termData  = state.db.terminal    || {};
  const acctData  = state.acctData;

  const pos       = procData?.pos       || [];
  const waybills  = procData?.waybills  || [];
  const suppInv   = procData?.invoices  || [];
  const containers = termData?.containers || [];
  const termCharges = termData?.charges  || [];
  const journals  = acctData?.journalEntries || acctData?.journals || [];

  const brand = appSettings?.brand || {};
  const today = new Date().toISOString().split('T')[0];

  // ── Computed stats ──────────────────────────────────────────────────────
  const totalPayroll    = allStaff.reduce((a,s) => a+(Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0), 0);
  const nlngPayroll     = nlng.reduce((a,s) => a+(Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0), 0);
  const slotPayroll     = slotStaff.reduce((a,s) => a+(Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0), 0);
  const activeStaff     = allStaff.filter(s => s.status === 'Active').length;

  // FIX 2026-08-13: this filtered on the PO's raw stored status, which can
  // lag behind reality — a PO stays "Approved" in storage even after it's
  // fully delivered, until someone manually flips it. Procurement.jsx's own
  // card instead recomputes status from actual waybill delivery data via
  // getPOStatus(), so the two screens showed different counts for the same
  // 3 real records (Dashboard: 2, Procurement: 1). Now both use the same
  // function, so they can't drift apart again.
  const activePOs       = pos.filter(p => ['Approved','Partial'].includes(getPOStatus(p, waybills, suppInv))).length;
  // Live-verify QA fix (2026-08-18): this checked status==='Draft', but a
  // Draft PO hasn't been submitted into the approval workflow at all — it's
  // still being edited, nobody is waiting on it. The KPI sub-label ("pending
  // approval") and the Dashboard alert banner ("awaiting approval") both
  // mean "submitted, sitting in someone's approval queue", which is
  // status==='Pending' (set by Procurement.jsx's submitForApproval(), same
  // status Sidebar.jsx's pendingApprovals badge and Approvals.jsx's queue
  // both key off). Caught live: Dashboard said "1 PO awaiting approval" for
  // a Draft PO while the real Approvals queue correctly showed 0 pending —
  // two screens disagreeing on the same array because of a Draft/Pending
  // mix-up, the same recurring "two screens, different status strings"
  // pattern from earlier fixes this session.
  const pendingPOs      = pos.filter(p => p.status === 'Pending').length;
  const totalPOValue    = pos.reduce((a,p) => a+(Number(p.total)||0), 0);

  const pendingInv      = suppInv.filter(i => i.status === 'Pending').length;
  const overdueInv      = suppInv.filter(i => i.status === 'Pending' && i.dueDate && i.dueDate < today).length;
  const totalInvValue   = suppInv.reduce((a,i) => a+(Number(i.netPayable)||0), 0);

  const activeContainers = containers.filter(c => c.status !== 'Released').length;
  const unpostedCharges  = termCharges.filter(c => !c.postedToAccounting && c.totalAmount > 0).length;
  const totalTermCharges = termCharges.reduce((a,c) => a+(Number(c.totalAmount)||0), 0);

  // ── Alerts ──────────────────────────────────────────────────────────────
  const alerts = [];
  if (overdueInv > 0)      alerts.push({ icon:'🚨', message:`${overdueInv} supplier invoice${overdueInv>1?'s':''} overdue`, sub:'Click to open Procurement → Supplier Invoices tab', accent:C.danger,  nav:'procurement', navTab:'invoice' });
  if (pendingPOs > 0)      alerts.push({ icon:'📋', message:`${pendingPOs} purchase order${pendingPOs>1?'s':''} awaiting approval`, sub:'Click to open Procurement → Purchase Orders tab', accent:C.warning, nav:'procurement', navTab:'po' });
  if (unpostedCharges > 0) alerts.push({ icon:'📒', message:`${unpostedCharges} terminal charge record${unpostedCharges>1?'s':''} not posted to accounting`, sub:'Click to open Terminal Operations → Clearing & Charges directly', accent:C.amber,   nav:'terminal', navTab:'charges' });

  // Calibration & Certification alerts
  const fleetData = state.db.fleet || {};
  const calRecords = fleetData.calibration || [];
  const calExpired = calRecords.filter(c => { if(!c.expiryDate) return false; return new Date(c.expiryDate) < new Date(); });
  const calDue     = calRecords.filter(c => { if(!c.expiryDate) return false; const d=Math.ceil((new Date(c.expiryDate)-new Date())/(1000*60*60*24)); return d>=0&&d<=60; });
  if (calExpired.length > 0) alerts.push({ icon:'⛔', message:`${calExpired.length} equipment certificate${calExpired.length>1?'s':''} OVERDUE for calibration/certification`, sub:'Click to open Fleet → Calibration & Cert. tab', accent:'#E24B4A', nav:'vehicles', navTab:'calibration' });
  else if (calDue.length > 0) alerts.push({ icon:'⚠️', message:`${calDue.length} equipment certificate${calDue.length>1?'s':''} due within 60 days`, sub:'Click to open Fleet → Calibration & Cert. tab', accent:C.amber, nav:'vehicles', navTab:'calibration' });

  // ── Recent POs table ─────────────────────────────────────────────────────
  const recentPOs = [...pos].sort((a,b) => new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,5).map(p => [
    <span style={{ color:C.green, fontFamily:'monospace', fontWeight:700 }}>{p.poNo}</span>,
    p.supplier,
    formatCurrency(p.total),
    <Tag status={p.status} />,
    formatDate(p.date),
  ]);

  // ── Recent containers ─────────────────────────────────────────────────────
  const recentContainers = [...containers].sort((a,b) => new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,5).map(c => [
    <span style={{ color:C.green, fontFamily:'monospace', fontWeight:700, fontSize:11 }}>{c.containerNo}</span>,
    c.portType,
    c.shippingVessel,
    <Tag status={c.status} />,
  ]);

  // ── Payroll split bars ────────────────────────────────────────────────────
  const staffSplit = [
    { label:`Contract Staff (NLNG) — ${nlng.length} staff`, value:nlngPayroll, color:C.amber },
    { label:`Company Staff (SLOT) — ${slotStaff.length} staff`, value:slotPayroll, color:C.green },
  ];

  // ── Recent journals ───────────────────────────────────────────────────────
  const recentJournals = [...journals].sort((a,b) => new Date(b.date||0)-new Date(a.date||0)).slice(0,4);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }}>

      {/* Welcome banner */}
      <div style={{ background:'linear-gradient(135deg,#0F3A1A 0%,#1A5C2A 55%,#2E7D40 100%)', borderRadius:14, padding:'20px 24px', position:'relative', overflow:'hidden', boxShadow:C.shadowBanner }}>
        <div style={{ position:'absolute', right:-40, top:-40, width:220, height:220, borderRadius:'50%', background:'rgba(255,255,255,0.05)' }} />
        <div style={{ position:'absolute', right:80, bottom:-60, width:150, height:150, borderRadius:'50%', background:'rgba(201,122,10,0.12)' }} />
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:5, background:C.amber, borderRadius:'14px 0 0 14px' }} />
        <div style={{ paddingLeft:8 }}>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.6)', letterSpacing:1, textTransform:'uppercase', marginBottom:4 }}>{greeting}, {currentUser?.name?.split(' ')[0] || 'Admin'}</div>
          <div style={{ fontSize:22, fontWeight:800, color:'#FFFFFF', lineHeight:1.2 }}>{brand.name || 'SLOT Engineering Nigeria Limited'}</div>
          <div style={{ fontSize:12, color:'rgba(255,255,255,0.65)', marginTop:6 }}>
            {new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })} &nbsp;·&nbsp; ERP v3.0
          </div>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {alerts.map((a, i) => (
          <AlertBanner key={i} {...a} onClick={a.nav ? () => {
            // Deep-link: tell the target module which sub-tab to open
            if (a.navTab) writeDeepLink(a.nav, a.navTab);
            onNav?.(a.nav);
          } : undefined} />
        ))}
        </div>
      )}

      {/* ── Top KPI row ──────────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <KPI label="Total Staff"       value={allStaff.length}                accent={C.green}   icon="👷" sub={activeStaff + ' active'}                    onClick={()=>onNav?.('nlng')} />
        <KPI label="Monthly Payroll"   value={formatCurrency(totalPayroll)}   accent={C.amber}   icon="💰" sub="All staff combined"                          onClick={()=>onNav?.('slot')} />
        <KPI label="Active POs"        value={activePOs}                      accent={C.info}    icon="🛒" sub={pendingPOs + ' pending approval'}             onClick={()=>onNav?.('procurement')} />
        {/* FIX 2026-08-13: labeled "Supp. Invoices" but the value was always
            pendingInv (Pending-status only), not the true total — so it read
            9 here while the Supplier Invoices list widget on this same page
            read 11 (9 Pending + 2 Paid). Same number as before; the label now
            says what it's actually counting, matching Procurement's own
            "Pending Invoices" card. */}
        {/* 2026-08-14: this value/label is pending SUPPLIER invoices (see the
            2026-08-13 fix note above pendingInv's computation — it matches
            Procurement's own "Pending Invoices" card), not customer Accounts
            Receivable invoices. onClick used to send users to 'invoices' (AR),
            which is a completely different, unrelated dataset — landed on an
            empty page. Relabeled and deep-linked to Procurement's own Supplier
            Invoices tab instead, which is what this number is actually
            counting. */}
        <KPI label="Supplier Invoices" value={pendingInv}                     accent={C.warning} icon="🧾" sub={formatCurrency(totalInvValue) + ' total'}    onClick={()=>{ writeDeepLink('procurement','invoice'); onNav?.('procurement'); }} />
        <KPI label="Containers Active" value={activeContainers}               accent="#9B59B6"   icon="📦" sub={containers.length + ' total'}                onClick={()=>onNav?.('terminal')} />
        <KPI label="Terminal Charges"  value={formatCurrency(totalTermCharges)} accent={C.danger} icon="🏭" sub={unpostedCharges + ' unposted'}              onClick={()=>onNav?.('terminal')} />
      </div>

      {/* ── Row 2: Staff breakdown + Payroll split ────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

        {/* Staff summary */}
        <Card>
          <SectionHeader title="Staff Overview" icon="👥" count={allStaff.length} />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
            {[
              ['Contract (NLNG)', nlng.length,                    C.amber,   'nlng'],
              ['Company (SLOT)',  slotStaff.length,               C.green,   'slot'],
              ['Active',          activeStaff,                    C.success, 'nlng'],
              ['Inactive/Other',  allStaff.length - activeStaff, C.danger,  'nlng'],
            ].map(([label, val, color, dest]) => (
              <div key={label} onClick={()=>onNav?.(dest)} style={{ padding:'10px 12px', background:C.bgAlt, borderRadius:8, border:'1px solid '+C.borderLight, cursor:'pointer', transition:'transform 0.12s' }} onMouseEnter={e=>e.currentTarget.style.transform='translateY(-1px)'} onMouseLeave={e=>e.currentTarget.style.transform=''}>
                <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase', marginBottom:3 }}>{label}</div>
                <div style={{ fontSize:20, fontWeight:700, color }}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize:11, fontWeight:700, color:C.textMid, textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:10 }}>Payroll Split</div>
          {staffSplit.map(s => <Bar key={s.label} label={s.label} value={s.value} max={totalPayroll} color={s.color} format={formatCurrency} />)}
        </Card>

        {/* Payroll by department */}
        <Card>
          <SectionHeader title="Payroll by Department" icon="📊" />
          <DeptPayrollList staff={allStaff} />
        </Card>
      </div>

      {/* ── Row 3: Procurement + Terminal ────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

        {/* Recent POs */}
        <Card>
          <SectionHeader title="Recent Purchase Orders" icon="🛒" count={pos.length} />
          <MiniTable
            headers={['PO No', 'Supplier', 'Total (₦)', 'Status', 'Date']}
            rows={recentPOs}
          />
          {pos.length === 0 && <div style={{ textAlign:'center', padding:'20px 0', color:C.textMuted, fontSize:12 }}>No purchase orders yet</div>}
        </Card>

        {/* Terminal containers */}
        <Card>
          <SectionHeader title="Terminal Operations" icon="🏭" count={containers.length} />
          {/* Status breakdown */}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
            {[['🚢 Arrived',C.info],['📋 In Transit',C.warning],['🏭 In W/H','#9B59B6'],['🔍 Under Exam',C.amber],['✅ Released',C.success]].map(([label, color]) => {
              const key = label.split(' ').slice(1).join(' ');
              const count = containers.filter(c => (c.status||'').includes(key.replace('In ',''))).length;
              return (
                <div key={label} style={{ flex:1, minWidth:80, padding:'8px 10px', background:color+'12', border:'1px solid '+color+'30', borderRadius:8, textAlign:'center' }}>
                  <div style={{ fontSize:16, fontWeight:700, color }}>{count}</div>
                  <div style={{ fontSize:9.5, color, fontWeight:600, marginTop:2 }}>{label}</div>
                </div>
              );
            })}
          </div>
          <MiniTable
            headers={['Container No', 'Port', 'Vessel', 'Status']}
            rows={recentContainers}
            thBg="#0F3A1A"
          />
        </Card>
      </div>

      {/* ── Row 4: Invoices + Journal activity ───────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

        {/* Supplier invoices summary */}
        <Card>
          <SectionHeader title="Supplier Invoices" icon="🧾" count={suppInv.length} />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:12 }}>
            {[
              ['Pending',  suppInv.filter(i=>i.status==='Pending').length,  C.warning],
              ['Paid',     suppInv.filter(i=>i.status==='Paid').length,    C.success],
              ['Overdue',  overdueInv, C.danger],
            ].map(([label, val, color]) => (
              <div key={label} style={{ padding:'10px', background:color+'12', border:'1px solid '+color+'30', borderRadius:8, textAlign:'center' }}>
                <div style={{ fontSize:20, fontWeight:700, color }}>{val}</div>
                <div style={{ fontSize:10, color, fontWeight:600, marginTop:2, textTransform:'uppercase' }}>{label}</div>
              </div>
            ))}
          </div>
          <MiniTable
            headers={['Invoice No', 'Supplier', 'Net Payable', 'Status']}
            rows={[...suppInv].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,5).map(inv => [
              <span style={{ color:C.amber, fontFamily:'monospace', fontWeight:700 }}>{inv.invoiceNo}</span>,
              inv.supplier,
              formatCurrency(inv.netPayable),
              <Tag status={inv.status} />,
            ])}
            thBg={C.amber}
          />
        </Card>

        {/* Accounting journal activity */}
        <Card>
          <SectionHeader title="Recent Journal Entries" icon="📒" count={journals.length} />
          {recentJournals.length === 0
            ? <div style={{ textAlign:'center', padding:'24px 0', color:C.textMuted, fontSize:12 }}>No journal entries yet</div>
            : recentJournals.map((je, i) => (
              <div key={je.id} style={{ padding:'10px 12px', marginBottom:8, background:C.bgAlt, borderRadius:8, border:'1px solid '+C.borderLight }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ fontSize:11, fontWeight:700, color:C.green, fontFamily:'monospace' }}>{je.id}</span>
                  <span style={{ fontSize:10, color:C.textMuted }}>{formatDate(je.date)}</span>
                </div>
                <div style={{ fontSize:12, color:C.text, marginBottom:3 }}>{je.description}</div>
                <div style={{ fontSize:11, color:C.textMuted }}>{je.lines?.length || 0} line{je.lines?.length !== 1?'s':''} · Source: <span style={{ color:C.amber, fontWeight:600 }}>{je.source || 'manual'}</span></div>
              </div>
            ))
          }
        </Card>
      </div>

      {/* ── Row 5: Activity feed ─────────────────────────────────────────── */}
      <Card>
        <div style={{ marginBottom:12 }}>
          <SectionHeader title="Activity Log" icon="📝" count={activity.length} />
        </div>
        {activity.length === 0
          ? <div style={{ textAlign:'center', padding:'24px 0', color:C.textMuted, fontSize:12 }}>No activity recorded yet</div>
          : (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {activity.slice(0,25).map((a, i) => {
                const actionColor = a.action==='create'?C.success:a.action==='delete'?C.danger:a.action==='approve'?C.green:C.info;
                const actionLabel = a.action==='create'?'Created':a.action==='delete'?'Deleted':a.action==='approve'?'Approved':a.action==='edit'?'Edited':'Info';
                return (
                  <div key={i} style={{ display:'flex', gap:10, padding:'8px 12px', background:C.bgAlt, borderRadius:8, border:'1px solid '+C.borderLight, alignItems:'flex-start' }}>
                    <div style={{ width:28, height:28, borderRadius:'50%', background:actionColor+'18', border:'1px solid '+actionColor+'40', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, flexShrink:0, fontWeight:700, color:actionColor }}>
                      {(a.who||'?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:2 }}>
                        <span style={{ fontSize:10, fontWeight:700, color:actionColor, background:actionColor+'15', padding:'1px 7px', borderRadius:20 }}>{actionLabel}</span>
                        <span style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.3px' }}>{a.module||''}</span>
                      </div>
                      <div style={{ fontSize:12, color:C.text, lineHeight:1.3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.msg}</div>
                      <div style={{ fontSize:10, color:C.textMuted, marginTop:2 }}>
                        <strong style={{ color:C.textMid }}>{a.who}</strong> · {a.role} · {a.time ? new Date(a.time).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'}
                      </div>
                    </div>
                  </div>
                );
              })}
              {activity.length > 25 && (
                <div style={{ marginTop:4, padding:'8px 12px', textAlign:'center', fontSize:12, color:C.textMuted }}>
                  Showing latest 25 of {activity.length} total entries
                </div>
              )}
            </div>
          )
        }
      </Card>

      {/* ── Footer stats bar ─────────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:16, padding:'12px 18px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:10, flexWrap:'wrap', justifyContent:'space-between' }}>
        {[
          ['Total PO Value',   formatCurrency(totalPOValue),     C.green],
          ['Total Staff',      allStaff.length + ' employees',    C.text],
          ['Journals Posted',  journals.length + ' entries',      C.info],
          ['Containers',       containers.length + ' tracked',    '#9B59B6'],
          ['Active Waybills',  waybills.filter(w=>w.status!=='Rejected').length + ' deliveries', C.amber],
        ].map(([label, val, color]) => (
          <div key={label} style={{ textAlign:'center' }}>
            <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:3 }}>{label}</div>
            <div style={{ fontSize:14, fontWeight:700, color }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
