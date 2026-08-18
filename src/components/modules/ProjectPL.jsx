// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — PROJECT P&L MODULE v1.1
// Aggregates Revenue (AR invoices, by projectRef) against Cost (AP bills, by
// projectCode, plus active-staff payroll, by projectCode) to produce a
// profit & loss view per project.
//
// METHODOLOGY NOTE (surfaced in-app, not hidden):
//   Revenue  = invoice SUBTOTAL (pre-VAT). VAT is a liability collected on
//              behalf of FIRS, not revenue — including it would overstate margin.
//   Cost     = AP bill AMOUNT (pre-VAT) plus active-staff payroll gross
//              (basic + housing + transport + allowances) for staff tagged
//              to the project. Input VAT on purchases is generally
//              recoverable, not a cost. Employer-side pension match isn't
//              modelled anywhere in this app yet, so it's excluded here too.
//   WHT/NCDF on either side are tax credits/deductions at source, not P&L
//              items — they don't change Revenue or Cost, only cash received/paid.
//   PAYROLL ALLOCATION: Contract Staff and SLOT Staff records now carry a
//              Project / Cost Centre field. Untagged staff (and untagged
//              invoices/bills) fall into UNALLOCATED so nothing silently
//              disappears from the total.
//   Multi-currency: each project's Revenue/Cost is converted to its NGN
//              equivalent (same fxRate captured on the invoice/bill) so a
//              project billing in USD can still be compared against NGN costs.
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { formatDate } from '../../utils/helpers';
import { getProjects } from '../../utils/projectMaster';
import { getApSource } from '../../utils/apBridge';

const SYM = { NGN:'₦', USD:'$', EUR:'€', GBP:'£' };
const fmt = (n, cur = 'NGN') =>
  (SYM[cur] || cur + ' ') + (Number(n)||0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Btn({ children, onClick, variant='primary', sm, style={} }) {
  const { C } = useTheme();
  const V = { primary:{bg:C.green,co:'#fff',b:'none'}, ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border}, outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green} }[variant]||{};
  return <button onClick={onClick} style={{ background:V.bg, color:V.co, border:V.b, borderRadius:7, padding:sm?'4px 11px':'7px 16px', fontSize:sm?11.5:13, fontWeight:500, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5, whiteSpace:'nowrap', ...style }}>{children}</button>;
}
function KPI({ label, value, sub, accent, alert }) {
  const { C } = useTheme();
  const c = alert ? C.danger : accent || C.green;
  return (
    <div style={{ background:C.bgCard, border:'1px solid '+(alert?C.danger+'40':C.border), borderRadius:12, padding:'13px 15px', flex:1, minWidth:148, position:'relative', boxShadow:C.shadowCard }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:c, borderRadius:'12px 0 0 12px' }} />
      <div style={{ paddingLeft:8 }}>
        <div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:4 }}>{label}</div>
        <div style={{ fontSize:19, fontWeight:700, color:c, lineHeight:1 }}>{value}</div>
        {sub && <div style={{ fontSize:11, color:C.textMuted, marginTop:3 }}>{sub}</div>}
      </div>
    </div>
  );
}
function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'18px 20px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}

export default function ProjectPL() {
  const { state } = useApp();
  const { C } = useTheme();
  const { db } = state;

  const projects = useMemo(() => getProjects(), []);

  const [selProject, setSelProject] = useState(null);
  const [showMethod, setShowMethod] = useState(false);

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  // ── Aggregate by project ───────────────────────────────────────────────────
  const projectPL = useMemo(() => {
    const map = {};
    const ensure = (code) => {
      if (!map[code]) {
        const p = projects.find(pr => pr.code === code);
        map[code] = { code, name: p?.name && p.name !== code ? p.name : code, revenue:0, cost:0, revenueLines:[], costLines:[] };
      }
      return map[code];
    };

    // 2026-08-18: was `i.status !== 'Cancelled'` only — AR voids an invoice
    // by setting voided:true (AccountsReceivable.jsx's handleDelete), never
    // by changing status to the literal string 'Cancelled' (nothing in the
    // codebase ever sets that on an AR invoice — same dead-status pattern
    // as the Overdue KPI fix). A voided invoice was still being counted as
    // real revenue here. The bills-side filter below is unaffected since
    // Procurement's own void flow does set status:'Cancelled'.
    (db.invoices || []).filter(i => i.status !== 'Cancelled' && !i.voided).forEach(inv => {
      const code = inv.projectRef || 'UNALLOCATED';
      const row = ensure(code);
      const ngnRevenue = Number(inv.subtotal||0) * ((Number(inv.ngnEquivalent ?? inv.netPayable)||0) / (Number(inv.netPayable)||1));
      row.revenue += ngnRevenue;
      row.revenueLines.push({ ref:inv.invoiceNo, party:inv.client, date:inv.date, amount:inv.subtotal, currency:inv.currency||'NGN', ngn:ngnRevenue, status:inv.status });
    });

    // 2026-08-17: was db.ap?.bills directly — the same "empty manual ledger"
    // gap found in AccountsPayable.jsx (see utils/apBridge.js). Real supplier
    // invoice cost from Procurement was invisible here too. Bills bridged in
    // from Procurement don't carry a projectCode yet (POs don't have a
    // project field), so they land in UNALLOCATED same as any other untagged
    // bill — consistent with this module's own stated "nothing silently
    // disappears" design, not a new gap.
    (getApSource(db).bills || []).filter(b => b.status !== 'Cancelled').forEach(bill => {
      const code = bill.projectCode || 'UNALLOCATED';
      const row = ensure(code);
      const ngnCost = Number(bill.amount||0) * ((Number(bill.ngnEquivalent ?? bill.netPayable)||0) / (Number(bill.netPayable)||1));
      row.cost += ngnCost;
      row.costLines.push({ ref:bill.billNo, party:bill.vendorName, date:bill.date, amount:bill.amount, currency:bill.currency||'NGN', ngn:ngnCost, status:bill.status });
    });

    // ── Payroll cost (Contract Staff + SLOT Staff) ────────────────────────────
    // Only active staff are counted — inactive/suspended staff aren't drawing
    // current salary. Cost = basic + housing + transport (+ medical/other
    // allowances + other addition, where present), the same recurring
    // monthly gross each staff record's Payroll View row is built from.
    // Staff with no project tagged fall into UNALLOCATED, same as untagged
    // invoices/bills.
    const monthLabel = new Date().toLocaleString('en-US', { month:'long', year:'numeric' });
    // 2026-08-18: this used ONE shared gross formula (basic+housing+
    // transport+medicalAllowance+otherAllowances+otherAddition) for BOTH
    // staff types, but medicalAllowance/otherAllowances only exist on SLOT
    // (Company) Staff records — Contract Staff's own gross (see
    // ContractStaff.jsx's payslip/payroll-view/print, all consistent) is
    // basic+housing+transport+bonnyAllowance+leaveAllowance+
    // overtimeAllowance+eoyBonus+otherAddition instead. Every NLNG
    // project's payroll cost here was silently missing all four of those
    // allowance fields — often a large share of a contract staff member's
    // real gross (e.g. EOY bonus, location/leave/overtime allowances).
    const contractStaffGross = s => (Number(s.basicSalary)||0) + (Number(s.housing)||0) + (Number(s.transport)||0)
      + (Number(s.bonnyAllowance)||0) + (Number(s.leaveAllowance)||0) + (Number(s.overtimeAllowance)||0) + (Number(s.eoyBonus)||0) + (Number(s.otherAddition)||0);
    const slotStaffGross = s => (Number(s.basicSalary)||0) + (Number(s.housing)||0) + (Number(s.transport)||0)
      + (Number(s.medicalAllowance)||0) + (Number(s.otherAllowances)||0) + (Number(s.otherAddition)||0);
    const payrollCost = (staffList, source, grossFn) => {
      staffList.filter(s => s.status === 'Active').forEach(s => {
        const code = s.projectCode || 'UNALLOCATED';
        const row = ensure(code);
        const gross = grossFn(s);
        if (gross <= 0) return;
        row.cost += gross;
        row.costLines.push({ ref:s.refId||s.id, party:s.fullName, date:monthLabel, amount:gross, currency:'NGN', ngn:gross, status:`${source} payroll` });
      });
    };
    payrollCost(db.nlng || [], 'Contract Staff', contractStaffGross);
    payrollCost(db.slot || [], 'SLOT Staff', slotStaffGross);

    // Include active projects with zero activity too, so the accountant sees the full project list (gap #3 in their original list)
    projects.forEach(p => ensure(p.code));

    return Object.values(map).map(r => ({
      ...r,
      margin: r.revenue - r.cost,
      marginPct: r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : null,
    })).sort((a,b) => b.revenue - a.revenue);
  }, [db.invoices, db.ap, db.procurement, db.nlng, db.slot, projects]);

  const totals = useMemo(() => {
    const withActivity = projectPL.filter(p => p.revenue > 0 || p.cost > 0);
    return {
      revenue: withActivity.reduce((s,p)=>s+p.revenue,0),
      cost:    withActivity.reduce((s,p)=>s+p.cost,0),
      margin:  withActivity.reduce((s,p)=>s+p.margin,0),
      activeCount: withActivity.length,
    };
  }, [projectPL]);

  const detail = selProject ? projectPL.find(p => p.code === selProject) : null;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Project P&amp;L</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Revenue vs. cost by project, in NGN equivalent</div>
        </div>
        <Btn variant="ghost" sm onClick={()=>setShowMethod(s=>!s)}>{showMethod ? 'Hide' : 'How is this calculated?'}</Btn>
      </div>

      {showMethod && (
        <Card style={{ background:C.bgAlt }}>
          <div style={{ fontSize:12.5, color:C.textMid, lineHeight:1.7 }}>
            <strong style={{ color:C.text }}>Revenue</strong> is each invoice's subtotal (before VAT) tagged to the project on the invoice. <strong style={{ color:C.text }}>Cost</strong> is each supplier bill's amount (before VAT) tagged to the project in Accounts Payable, plus the monthly gross pay (basic + housing + transport + allowances) of active Contract Staff and SLOT Staff tagged to the project. VAT is excluded on both sides since it's a liability collected for FIRS, not P&amp;L. WHT and NCDF are tax deductions at source — they reduce cash received/paid, not the revenue or cost figure itself. Foreign-currency invoices and bills are converted to NGN at the exchange rate recorded when each one was entered.
            <div style={{ marginTop:8, padding:'8px 12px', background:C.amberPale||'rgba(201,122,10,.08)', borderRadius:6, borderLeft:'3px solid '+C.amber }}>
              <strong style={{ color:C.amber }}>Known gap:</strong> employer-side pension contribution isn't modelled anywhere in the app yet, so it's excluded from payroll cost here too. Staff not yet tagged with a project (or invoices/bills not tagged with a project) are grouped under <strong>UNALLOCATED</strong> rather than silently dropped — check that bucket periodically to catch untagged records.
            </div>
          </div>
        </Card>
      )}

      {/* KPIs */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <KPI label="Total Revenue" value={fmt(totals.revenue)} sub={`${totals.activeCount} active projects`} />
        <KPI label="Total Cost"    value={fmt(totals.cost)} accent={C.warning} sub="materials, services, logistics" />
        <KPI label="Gross Margin"  value={fmt(totals.margin)} accent={totals.margin>=0?C.success:C.danger} alert={totals.margin<0} sub={totals.revenue>0 ? `${((totals.margin/totals.revenue)*100).toFixed(1)}% of revenue` : '—'} />
      </div>

      {/* Project table */}
      <Card style={{ padding:0, overflow:'hidden' }}>
        <div style={{ padding:'12px 16px', borderBottom:'1px solid '+C.borderLight }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.text }}>Profit &amp; Loss by Project</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Click a project to see its revenue and cost lines</div>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>{['Project','Revenue','Cost','Margin','Margin %'].map(h=><th key={h} style={{ ...th, textAlign: h==='Project'?'left':'right' }}>{h}</th>)}</tr></thead>
            <tbody>
              {projectPL.map(p => (
                <tr key={p.code} onClick={()=>setSelProject(p.code)} style={{ cursor:'pointer' }} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                  <td style={td}>
                    <div style={{ fontWeight:600 }}>{p.code}</div>
                    {p.name !== p.code && <div style={{ fontSize:11, color:C.textMuted }}>{p.name}</div>}
                  </td>
                  <td style={{ ...td, textAlign:'right', color:p.revenue>0?C.text:C.textLight }}>{p.revenue>0?fmt(p.revenue):'—'}</td>
                  <td style={{ ...td, textAlign:'right', color:p.cost>0?C.warning:C.textLight }}>{p.cost>0?fmt(p.cost):'—'}</td>
                  <td style={{ ...td, textAlign:'right', fontWeight:700, color: (p.revenue||p.cost) ? (p.margin>=0?C.success:C.danger) : C.textLight }}>{(p.revenue||p.cost) ? fmt(p.margin) : '—'}</td>
                  <td style={{ ...td, textAlign:'right', fontWeight:600, color: p.marginPct==null ? C.textLight : p.marginPct>=0?C.success:C.danger }}>{p.marginPct==null ? '—' : p.marginPct.toFixed(1)+'%'}</td>
                </tr>
              ))}
              <tr style={{ background:C.tableHeaderBg }}>
                <td style={{ ...td, fontWeight:700, color:'#fff' }}>Total</td>
                <td style={{ ...td, textAlign:'right', fontWeight:700, color:'#fff' }}>{fmt(totals.revenue)}</td>
                <td style={{ ...td, textAlign:'right', fontWeight:700, color:'#fff' }}>{fmt(totals.cost)}</td>
                <td style={{ ...td, textAlign:'right', fontWeight:700, color:'#fff' }}>{fmt(totals.margin)}</td>
                <td style={{ ...td, textAlign:'right', fontWeight:700, color:'#fff' }}>{totals.revenue>0 ? ((totals.margin/totals.revenue)*100).toFixed(1)+'%' : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Project detail drill-down */}
      {detail && (
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, paddingBottom:12, borderBottom:'1px solid '+C.borderLight }}>
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:C.text }}>{detail.code}{detail.name!==detail.code?` — ${detail.name}`:''}</div>
              <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Revenue {fmt(detail.revenue)} · Cost {fmt(detail.cost)} · Margin {fmt(detail.margin)}</div>
            </div>
            <Btn sm variant="ghost" onClick={()=>setSelProject(null)}>Close</Btn>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:C.success, textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:8 }}>Revenue Lines ({detail.revenueLines.length})</div>
              {detail.revenueLines.length === 0 && <div style={{ fontSize:12, color:C.textMuted, padding:'8px 0' }}>No invoices tagged to this project yet</div>}
              {detail.revenueLines.map((l,i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid '+C.borderLight, fontSize:12 }}>
                  <div>
                    <div style={{ fontFamily:'monospace', color:C.green, fontWeight:600 }}>{l.ref}</div>
                    <div style={{ color:C.textMuted, fontSize:11 }}>{l.party} · {formatDate(l.date)}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontWeight:600 }}>{fmt(l.amount, l.currency)}</div>
                    {l.currency!=='NGN' && <div style={{ fontSize:10.5, color:C.textMuted }}>{fmt(l.ngn)} eq.</div>}
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize:11, fontWeight:700, color:C.warning, textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:8 }}>Cost Lines ({detail.costLines.length})</div>
              {detail.costLines.length === 0 && <div style={{ fontSize:12, color:C.textMuted, padding:'8px 0' }}>No supplier bills tagged to this project yet</div>}
              {detail.costLines.map((l,i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid '+C.borderLight, fontSize:12 }}>
                  <div>
                    <div style={{ fontFamily:'monospace', color:C.amber, fontWeight:600 }}>{l.ref}</div>
                    <div style={{ color:C.textMuted, fontSize:11 }}>{l.party} · {formatDate(l.date)}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontWeight:600 }}>{fmt(l.amount, l.currency)}</div>
                    {l.currency!=='NGN' && <div style={{ fontSize:10.5, color:C.textMuted }}>{fmt(l.ngn)} eq.</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
