// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — ANALYTICS MODULE v1.0
// Cross-module KPIs · revenue trends · workforce · procurement · WHT · assets
// ══════════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { formatDate } from '../../utils/helpers';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const fmt   = n => '₦' + (Number(n)||0).toLocaleString('en-NG', { maximumFractionDigits:0 });
const fmtM  = n => { const v=Number(n)||0; return v>=1e9?`₦${(v/1e9).toFixed(1)}B`:v>=1e6?`₦${(v/1e6).toFixed(1)}M`:v>=1e3?`₦${(v/1e3).toFixed(0)}K`:'₦'+v; };
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const yr = () => new Date().getFullYear();

function Card({ children, style, title, sub }) {
  const { C } = useTheme();
  return (
    <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'18px 20px', boxShadow:C.shadowCard, ...style }}>
      {title && <div style={{ marginBottom:14 }}><div style={{ fontSize:13, fontWeight:700, color:C.text }}>{title}</div>{sub&&<div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>{sub}</div>}</div>}
      {children}
    </div>
  );
}

function KPI({ label, value, sub, accent, delta, icon, onClick }) {
  const { C } = useTheme();
  const c = accent || C.green;
  const up = delta > 0;
  return (
    // 2026-08-14: onClick was destructured from props but never attached to
    // any element below — every call site that passed onClick={()=>onNav?.(...)}
    // (Total Invoiced, Revenue Received, Outstanding, Total Staff, Active
    // Assets, Pending Approvals) rendered a normal-looking card that simply
    // did nothing when clicked. Dashboard.jsx's own KPI component wires this
    // correctly (onClick={onClick} + cursor:pointer); this one didn't.
    <div onClick={onClick} style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'14px 16px', flex:1, minWidth:155, position:'relative', boxShadow:C.shadowCard, cursor:onClick?'pointer':'default' }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:c, borderRadius:'12px 0 0 12px' }} />
      <div style={{ paddingLeft:8 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.5px' }}>{label}</div>
          {icon && <span style={{ fontSize:18 }}>{icon}</span>}
        </div>
        <div style={{ fontSize:22, fontWeight:800, color:c, lineHeight:1 }}>{value}</div>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4 }}>
          {sub && <div style={{ fontSize:11, color:C.textMuted }}>{sub}</div>}
          {delta !== undefined && <span style={{ fontSize:10, fontWeight:700, color:up?C.success:C.danger, background:up?'rgba(26,122,74,.1)':'rgba(192,57,43,.1)', padding:'1px 5px', borderRadius:20 }}>{up?'↑':'↓'} {Math.abs(delta)}%</span>}
        </div>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  const { C } = useTheme();
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:8, padding:'8px 12px', fontSize:12, boxShadow:'0 4px 12px rgba(0,0,0,.15)' }}>
      <div style={{ fontWeight:700, color:C.text, marginBottom:4 }}>{label}</div>
      {payload.map((p,i)=><div key={i} style={{ color:p.color, marginBottom:2 }}>{p.name}: <strong>{typeof p.value==='number'&&p.value>10000?fmtM(p.value):p.value}</strong></div>)}
    </div>
  );
};

function SectionHeader({ title }) {
  const { C } = useTheme();
  return <div style={{ fontSize:11, fontWeight:700, color:C.textMid, textTransform:'uppercase', letterSpacing:'0.6px', margin:'8px 0 12px', paddingBottom:6, borderBottom:'2px solid '+C.greenPale }}>{title}</div>;
}

export default function Analytics({ onNav }) {
  const { state } = useApp();
  const { C } = useTheme();
  const { db, acctData, currentUser } = state;
  const [period, setPeriod] = useState('ytd');

  // ── FIX: Date range controls — not locked to current year ─────────────────
  const currentYear = new Date().getFullYear();
  const [rangeYear,  setRangeYear]  = useState(currentYear);
  const [rangeFrom,  setRangeFrom]  = useState('');
  const [rangeTo,    setRangeTo]    = useState('');

  // Resolves the active [fromDate, toDate] for data filtering
  const dateRange = useMemo(() => {
    if (period === 'custom' && rangeFrom && rangeTo) {
      return [new Date(rangeFrom), new Date(rangeTo + 'T23:59:59')];
    }
    const now = new Date();
    const y   = period === 'prev' ? rangeYear - 1 : rangeYear;
    if (period === 'q1')  return [new Date(y, 0, 1),  new Date(y, 2, 31, 23, 59)];
    if (period === 'q2')  return [new Date(y, 3, 1),  new Date(y, 5, 30, 23, 59)];
    if (period === 'q3')  return [new Date(y, 6, 1),  new Date(y, 8, 30, 23, 59)];
    if (period === 'q4')  return [new Date(y, 9, 1),  new Date(y, 11, 31, 23, 59)];
    if (period === 'prev')return [new Date(y, 0, 1),  new Date(y, 11, 31, 23, 59)];
    // ytd default
    return [new Date(y, 0, 1), now];
  }, [period, rangeYear, rangeFrom, rangeTo]);

  // Convenience date filter function
  const inRange = (dateStr) => {
    const d = new Date(dateStr || '');
    if (isNaN(d)) return false;
    return d >= dateRange[0] && d <= dateRange[1];
  };

  // 2026-08-18 QA fix: several cards hardcoded the label "FY2026" regardless
  // of what the date-range picker above them was actually set to — once the
  // picker is fixed to actually filter (see kpis/invoiceStatus below),
  // leaving a static "FY2026" caption next to numbers that now change with
  // the picker would be actively misleading. This reflects the real
  // selection instead.
  const periodLabel = useMemo(() => {
    if (period === 'custom' && rangeFrom && rangeTo) return `${rangeFrom} to ${rangeTo}`;
    if (period === 'prev') return `FY${rangeYear-1}`;
    if (period === 'q1' || period === 'q2' || period === 'q3' || period === 'q4') return `${period.toUpperCase()} ${rangeYear}`;
    return `YTD ${rangeYear}`;
  }, [period, rangeYear, rangeFrom, rangeTo]);

  // ── Data from all modules ──────────────────────────────────────────────────
  const invoices    = db.invoices    || [];
  const requests    = db.request     || [];
  const pettycash   = db.pettycash   || [];
  const fixedassets = db.fixedassets || [];
  // 2026-08-18 QA fix: this read `db.wht`, which nothing in the app ever
  // writes to (grep confirms it's initialized empty in AppContext.jsx and
  // never dispatched to) — a dead data source. The real WHT register staff
  // actually use lives in Accounting.jsx's WHT tab, which is backed by
  // `acctData.whtEntries`, an entirely separate state slice. Every WHT
  // figure on this page (KPI totals, the Deducted-vs-Remitted chart, the
  // Module Summary tile) was reading an array that can never contain data,
  // regardless of how many real WHT entries exist.
  const wht         = acctData?.whtEntries || [];
  const nlng        = db.nlng        || [];
  const slot        = db.slot        || [];
  const procurement = db.procurement?.pos || [];  // db.procurement is {rfqs,pos,waybills,invoices}
  const journals    = acctData?.journals || []; // v2: key was renamed from journalEntries to journals

  // ── Invoice revenue by month ───────────────────────────────────────────────
  const revenueByMonth = useMemo(() => {
    const map = {};
    MONTHS.forEach((m,i) => { map[i] = { month:m, invoiced:0, received:0 }; });
    invoices.forEach(inv => {
      const d = new Date(inv.date||'');
      if (!inRange(d.toISOString())) return;
      const mo = d.getMonth();
      // Use the NGN-equivalent (netPayable × fxRate, captured when the invoice
      // was entered) rather than raw netPayable — otherwise USD/EUR/GBP
      // invoices get added straight into the same total as NGN ones.
      const ngnAmt = Number(inv.ngnEquivalent ?? inv.netPayable)||0;
      map[mo].invoiced += ngnAmt;
      if (inv.status==='Paid') map[mo].received += ngnAmt;
    });
    return Object.values(map).filter((_,i)=>i<=new Date().getMonth());
  }, [invoices, dateRange]);

  // ── Invoice status breakdown ───────────────────────────────────────────────
  // 2026-08-18 QA fix: `dateRange` was already in the dependency list (so
  // this recomputed whenever the date picker changed) but the count itself
  // never called inRange() — the picker looked wired but silently returned
  // the same all-time totals no matter what period was selected.
  const invoiceStatus = useMemo(() => {
    const m = { Paid:0, Pending:0, Overdue:0, Draft:0, Other:0 };
    invoices.filter(i=>inRange(i.date)).forEach(i=>{ const k=m[i.status]!==undefined?i.status:'Other'; m[k]++; });
    return Object.entries(m).filter(([,v])=>v>0).map(([name,value])=>({ name,value }));
  }, [invoices, dateRange]);

  // ── Procurement category breakdown ─────────────────────────────────────────
  // 2026-08-18 QA fix: wasn't date-filtered at all — a page-level date
  // picker that only moved 2 of 8 cards was confusing/wrong regardless of
  // which 2. Matches Procurement's own date fallback (Approvals.jsx's
  // getDate: r => r.date || r.createdAt) since not every PO has `.date` set.
  const procByCategory = useMemo(() => {
    const map = {};
    procurement.filter(p=>inRange(p.date||p.createdAt)).forEach(p => {
      const cat = p.category||'Other';
      map[cat] = (map[cat]||0) + (Number(p.totalAmount||p.total||p.amount)||0);
    });
    return Object.entries(map).map(([name,value])=>({ name, value })).sort((a,b)=>b.value-a.value).slice(0,6);
  }, [procurement, dateRange]);

  // ── WHT summary by month ───────────────────────────────────────────────────
  // 2026-08-18 QA fix: field names now match the real WHTTab record shape
  // (utils/Accounting.jsx WHTTab's saveWHT()) — the amount field is `amount`,
  // not `whtAmount`, and the remittance flag is `certStatus === 'Remitted to
  // FIRS'` (a 3-state certificate field: Not Issued / Issued / Remitted to
  // FIRS), not a `status === 'Remitted'` field that never existed.
  const whtByMonth = useMemo(() => {
    const map = {};
    MONTHS.forEach((m,i) => { map[i] = { month:m, deducted:0, remitted:0 }; });
    wht.forEach(e => {
      const d = new Date(e.date||'');
      if (!inRange(d.toISOString())) return;
      const mo = d.getMonth();
      map[mo].deducted += Number(e.amount)||0;
      if (e.certStatus==='Remitted to FIRS') map[mo].remitted += Number(e.amount)||0;
    });
    return Object.values(map).filter((_,i)=>i<=new Date().getMonth());
  }, [wht, dateRange]);

  // ── Petty cash by category ─────────────────────────────────────────────────
  // 2026-08-18 QA fix: also wasn't date-filtered — same page-wide
  // consistency fix as procByCategory above.
  const pettyCatData = useMemo(() => {
    const map = {};
    pettycash.filter(e=>e.status==='Approved'&&inRange(e.date)).forEach(e => {
      const cat = e.category||'Other';
      map[cat] = (map[cat]||0) + (Number(e.amount)||0);
    });
    return Object.entries(map).map(([name,value])=>({ name, value })).sort((a,b)=>b.value-a.value);
  }, [pettycash, dateRange]);

  // ── Request type breakdown ─────────────────────────────────────────────────
  // 2026-08-18 QA fix: also wasn't date-filtered — same page-wide
  // consistency fix as procByCategory/pettyCatData above.
  const reqByType = useMemo(() => {
    const map = {};
    requests.filter(r=>inRange(r.date)).forEach(r => { map[r.type||'Other'] = (map[r.type||'Other']||0)+1; });
    return Object.entries(map).map(([name,value])=>({ name, value }));
  }, [requests, dateRange]);

  // ── Top-level KPIs ─────────────────────────────────────────────────────────
  // 2026-08-18 QA fix: the whole point of the date-range picker at the top
  // of this page is to scope what's shown — but this useMemo didn't even
  // list `dateRange` in its dependency array, let alone call inRange()
  // anywhere. Every one of these 6 KPI cards (the most prominent numbers on
  // the page) showed the same all-time totals no matter what period was
  // selected, while the two charts directly below correctly responded. Flow
  // metrics (invoiced/received/WHT) are now scoped to the selected period,
  // same convention as revenueByMonth/whtByMonth. Point-in-time snapshots
  // (headcount, active assets, NBV as of today, current pending queue)
  // intentionally stay unfiltered — "Total Staff right now" isn't a
  // per-period figure, same reasoning as a balance sheet number.
  const kpis = useMemo(() => {
    // NGN-equivalent helper — same convention as AccountsReceivable.jsx:
    // ngnEquivalent = netPayable × fxRate captured at entry time. Falls back
    // to netPayable itself for NGN invoices (fxRate 1, so they're equal).
    const ngnEq = i => Number(i.ngnEquivalent ?? i.netPayable) || 0;
    const invoicesInRange = invoices.filter(i=>inRange(i.date));
    const whtInRange      = wht.filter(e=>inRange(e.date));
    const totalInvoiced  = invoicesInRange.reduce((a,i)=>a+ngnEq(i),0);
    const totalReceived  = invoicesInRange.filter(i=>i.status==='Paid').reduce((a,i)=>a+ngnEq(i),0);
    const outstanding    = totalInvoiced - totalReceived;
    const totalWHT       = whtInRange.reduce((a,e)=>a+(Number(e.amount)||0),0);
    const whtOutstanding = whtInRange.filter(e=>e.certStatus!=='Remitted to FIRS').reduce((a,e)=>a+(Number(e.amount)||0),0);
    const totalStaff     = nlng.length + slot.length;
    const activeAssets   = fixedassets.filter(a=>!a.voided&&a.status==='Active').length;
    const assetNBV       = fixedassets.filter(f=>!f.voided).reduce((a,f)=>{
      const ul=Number(f.usefulLifeYrs)||5, cost=Number(f.cost)||0, res=Number(f.residualValue)||0;
      const months = f.purchaseDate ? (new Date()-new Date(f.purchaseDate))/2592000000 : 0;
      const dep = Math.min((cost-res)/ul*(months/12), cost-res);
      return a + Math.max(res, cost-dep);
    },0);
    // QA fix: this only ever counted requests + petty cash, so it silently
    // undercounted against the real approval queue (Approvals.jsx), which
    // also tracks procurement POs and invoices. Confirmed live: Dashboard's
    // "1 purchase order awaiting approval" banner vs this KPI showing 0 for
    // the same PO. Statuses here match Approvals.jsx's MODULE_CONFIGS
    // pendingStatuses after its own QA fix (procurement really uses
    // status:'Pending', set by Procurement.jsx's submitForApproval()).
    const pendingApprovals = [
      ...requests.filter(r=>r.status==='Submitted'||r.status==='Pending'),
      ...pettycash.filter(p=>p.status==='Pending'),
      ...procurement.filter(p=>p.status==='Pending'),
      ...invoices.filter(i=>i.status==='Pending'),
    ].length;
    return { totalInvoiced, totalReceived, outstanding, totalWHT, whtOutstanding, totalStaff, activeAssets, assetNBV, pendingApprovals };
  }, [invoices, wht, nlng, slot, fixedassets, requests, pettycash, procurement, dateRange]);

  // ── Asset depreciation by category ────────────────────────────────────────
  const assetDepData = useMemo(() => {
    const map = {};
    fixedassets.forEach(a => {
      const cat = a.category||'Other';
      if (!map[cat]) map[cat] = { cost:0, nbv:0 };
      const ul=Number(a.usefulLifeYrs)||5, cost=Number(a.cost)||0, res=Number(a.residualValue)||0;
      const months = a.purchaseDate ? (new Date()-new Date(a.purchaseDate))/2592000000 : 0;
      const dep = Math.min((cost-res)/ul*(months/12), cost-res);
      map[cat].cost += cost;
      map[cat].nbv  += Math.max(res, cost-dep);
    });
    return Object.entries(map).map(([name,{cost,nbv}])=>({ name:name.split(' ')[0], cost, dep:cost-nbv, nbv }));
  }, [fixedassets]);

  const COLORS = [C.green, C.amber, C.info, '#9B59B6', '#16A085', '#E74C3C', '#34495E'];

  const PILL = (label, key) => (
    <button key={key} onClick={()=>setPeriod(key)} style={{ padding:'4px 14px', borderRadius:20, fontSize:12, border:'1px solid '+(period===key?C.green:C.border), background:period===key?C.green:'transparent', color:period===key?'#fff':C.textMid, cursor:'pointer', fontWeight:period===key?600:400 }}>{label}</button>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Analytics</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Business intelligence · cross-module KPIs · trends</div>
        </div>
        {/* FIX: Full date range controls — year selector + quarters + custom */}
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <select value={rangeYear} onChange={e=>setRangeYear(Number(e.target.value))} style={{ padding:'4px 8px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12, outline:'none' }}>
            {[currentYear-2, currentYear-1, currentYear].map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          {[['YTD','ytd'],['Q1','q1'],['Q2','q2'],['Q3','q3'],['Q4','q4'],['Prev Year','prev'],['Custom','custom']].map(([l,k])=>PILL(l,k))}
          {period === 'custom' && <>
            <input type="date" value={rangeFrom} onChange={e=>setRangeFrom(e.target.value)} style={{ padding:'4px 8px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12 }} />
            <span style={{ fontSize:11, color:C.textMuted }}>to</span>
            <input type="date" value={rangeTo}   onChange={e=>setRangeTo(e.target.value)}   style={{ padding:'4px 8px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12 }} />
          </>}
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <KPI label="Total Invoiced" value={fmtM(kpis.totalInvoiced)} sub={periodLabel} icon="🧾" accent={C.green} onClick={()=>onNav?.("invoices")} />
        <KPI label="Revenue Received" value={fmtM(kpis.totalReceived)} sub="payments collected" icon="💰" accent={C.success} onClick={()=>onNav?.("invoices")} />
        <KPI label="Outstanding" value={fmtM(kpis.outstanding)} sub="accounts receivable" icon="⏳" accent={kpis.outstanding>0?C.amber:C.success} onClick={()=>onNav?.("invoices")} />
        <KPI label="Total Staff" value={kpis.totalStaff} sub={`${nlng.length} NLNG · ${slot.length} SLOT`} icon="👥" onClick={()=>onNav?.("nlng")} />
        <KPI label="Active Assets" value={kpis.activeAssets} sub={`NBV: ${fmtM(kpis.assetNBV)}`} icon="🏗" accent={C.info} onClick={()=>onNav?.("fixedassets")} />
        <KPI label="Pending Approvals" value={kpis.pendingApprovals} sub="awaiting action" icon="✅" accent={kpis.pendingApprovals>0?C.danger:C.success} onClick={()=>onNav?.("approvals")} />
      </div>

      {/* Row 1: Revenue trend + Invoice status */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16 }}>
        <Card title={`Revenue Trend — ${periodLabel}`} sub="Monthly invoiced vs received">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={revenueByMonth} margin={{ top:4, right:8, bottom:0, left:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.borderLight} />
              <XAxis dataKey="month" tick={{ fontSize:11, fill:C.textMuted }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtM} tick={{ fontSize:10, fill:C.textMuted }} axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize:11 }} />
              <Bar dataKey="invoiced" name="Invoiced" fill={C.green} opacity={0.7} radius={[4,4,0,0]} />
              <Bar dataKey="received" name="Received" fill={C.success} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Invoice Status" sub="Breakdown by count">
          {invoiceStatus.length === 0 ? (
            <div style={{ textAlign:'center', padding:'60px 0', color:C.textMuted, fontSize:12 }}>No invoice data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={invoiceStatus} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value" label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {invoiceStatus.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v)=>`${v} invoice${v!==1?'s':''}`} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Row 2: WHT trend + Asset Depreciation */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <Card title="WHT — Deducted vs Remitted" sub={`Monthly withholding tax · ${periodLabel}`}>
          {whtByMonth.every(d=>d.deducted===0) ? (
            <div style={{ textAlign:'center', padding:'60px 0', color:C.textMuted, fontSize:12 }}>No WHT data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={whtByMonth} margin={{ top:4, right:8, bottom:0, left:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.borderLight} />
                <XAxis dataKey="month" tick={{ fontSize:11, fill:C.textMuted }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtM} tick={{ fontSize:10, fill:C.textMuted }} axisLine={false} tickLine={false} width={52} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize:11 }} />
                <Line type="monotone" dataKey="deducted" name="Deducted" stroke={C.amber} strokeWidth={2} dot={{ r:3 }} />
                <Line type="monotone" dataKey="remitted" name="Remitted to FIRS" stroke={C.success} strokeWidth={2} dot={{ r:3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
          {kpis.whtOutstanding > 0 && (
            <div style={{ marginTop:8, padding:'6px 10px', background:'rgba(201,122,10,.08)', borderRadius:6, fontSize:11, color:C.amber }}>
              ⚠ Outstanding: {fmt(kpis.whtOutstanding)} pending FIRS remittance
            </div>
          )}
        </Card>

        <Card title="Fixed Asset Book Value" sub="Cost vs NBV by category">
          {assetDepData.length === 0 ? (
            <div style={{ textAlign:'center', padding:'60px 0', color:C.textMuted, fontSize:12 }}>No asset data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={assetDepData} layout="vertical" margin={{ top:0, right:8, bottom:0, left:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.borderLight} horizontal={false} />
                <XAxis type="number" tickFormatter={fmtM} tick={{ fontSize:10, fill:C.textMuted }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize:11, fill:C.textMuted }} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize:11 }} />
                <Bar dataKey="nbv" name="NBV" stackId="a" fill={C.success} radius={[0,4,4,0]} />
                <Bar dataKey="dep" name="Depreciated" stackId="a" fill={C.amber} opacity={0.6} radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Row 3: Petty Cash + Request Types */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <Card title="Petty Cash by Category" sub="Approved disbursements">
          {pettyCatData.length === 0 ? (
            <div style={{ textAlign:'center', padding:'40px 0', color:C.textMuted, fontSize:12 }}>No disbursement data yet</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {pettyCatData.map((item,i) => {
                const max = pettyCatData[0]?.value||1;
                const pct = Math.round((item.value/max)*100);
                return (
                  <div key={item.name}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                      <span style={{ fontSize:12, color:C.text }}>{item.name}</span>
                      <span style={{ fontSize:12, fontWeight:600, color:C.green }}>{fmt(item.value)}</span>
                    </div>
                    <div style={{ background:C.greenPale, borderRadius:20, height:6 }}>
                      <div style={{ width:`${pct}%`, height:'100%', background:COLORS[i%COLORS.length], borderRadius:20 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Requests by Type" sub="Volume breakdown">
          {reqByType.length === 0 ? (
            <div style={{ textAlign:'center', padding:'40px 0', color:C.textMuted, fontSize:12 }}>No request data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={reqByType} cx="50%" cy="50%" outerRadius={85} paddingAngle={2} dataKey="value" label={({name,value})=>`${name}: ${value}`} labelLine={true} fontSize={11}>
                  {reqByType.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v)=>`${v} request${v!==1?'s':''}`} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Summary Table */}
      <Card title="Module Summary" sub="Records count and activity across all modules">
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:12 }}>
          {[
            { label:'NLNG Staff',      count:nlng.length,        icon:'👷', active:nlng.filter(s=>s.status==='Active').length },
            { label:'SLOT Staff',      count:slot.length,        icon:'👤', active:slot.filter(s=>s.status==='Active').length },
            { label:'Procurement POs', count:procurement.length, icon:'🛒', active:procurement.filter(p=>p.status==='Approved').length },
            { label:'Invoices',        count:invoices.length,    icon:'🧾', active:invoices.filter(i=>i.status==='Paid').length },
            { label:'Petty Cash',      count:pettycash.length,   icon:'💵', active:pettycash.filter(p=>p.status==='Approved').length },
            { label:'Requests',        count:requests.length,    icon:'📋', active:requests.filter(r=>r.status==='Approved').length },
            { label:'Fixed Assets',    count:fixedassets.filter(a=>!a.voided).length, icon:'🏗',  active:fixedassets.filter(a=>!a.voided&&a.status==='Active').length },
            { label:'WHT Entries',     count:wht.length,         icon:'🏛',  active:wht.filter(e=>e.certStatus==='Remitted to FIRS').length },
          ].map(({ label, count, icon, active }) => (
            <div key={label} style={{ background:C.greenPale, borderRadius:10, padding:'12px 14px' }}>
              <div style={{ fontSize:20, marginBottom:6 }}>{icon}</div>
              <div style={{ fontSize:12, fontWeight:600, color:C.text }}>{label}</div>
              <div style={{ fontSize:22, fontWeight:800, color:C.green, lineHeight:1, marginTop:4 }}>{count}</div>
              <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>{active} {label.includes('Staff')?'active':label.includes('Asset')?'active':label.includes('WHT')?'remitted':'approved'}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
