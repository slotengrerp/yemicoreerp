// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — CONTRACT STAFF (NLNG) MODULE v2.0
// Full payroll: individual payslip + print payroll register + month selector
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo }    from '../../utils/auth';
import { formatCurrency, formatDate, generateId, showToast } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { Users, DollarSign, UserCheck, UserX } from 'lucide-react';
import { SLOT_LOGO_B64, SLOT_BRAND, printHeader, PRINT_CSS } from '../../utils/logo';
import { getProjects } from '../../utils/projectMaster';

const DEPARTMENTS = ['Engineering','HSE','Operations','Admin','Procurement','Finance','Mechanical','Electrical','Civil','IT','Legal','Logistics'];
const STATES = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'];
const BANKS   = ['Access Bank','Citibank','Ecobank','Fidelity Bank','First Bank','FCMB','GTBank','Heritage Bank','Keystone Bank','Polaris Bank','Stanbic IBTC','Sterling Bank','UBA','Union Bank','Unity Bank','Wema Bank','Zenith Bank'];
const STATUSES = ['Active','Inactive','Suspended'];
const EMPTY = {
  fullName:'', email:'', refId:'', department:'', role:'', workLocation:'',
  dob:'', stateOfOrigin:'', lga:'', phone:'', bank:'', accountNo:'',
  employmentDate:'', refIndicator:'', projectCode:'',
  basicSalary:'', housing:'', transport:'',
  bonnyAllowance:'', leaveAllowance:'', eoyBonus:'', overtimeAllowance:'',
  voluntaryPension:'', salaryAdvance:'', loan:'',
  status:'Active',
};
const TABS = [{ key:'list', label:'Staff Records' }, { key:'payroll', label:'Payroll View' }];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ── Print helpers ──────────────────────────────────────────────────────────
function printPayroll(staff, period, filtered) {
  const rows = filtered.map((s, i) => {
    const gross = (Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0);
    return `<tr style="background:${i%2===1?'#f3faf5':'#fff'}">
      <td>${s.sn}</td><td><strong>${s.fullName}</strong></td><td style="font-family:monospace;font-size:11px">${s.refId}</td>
      <td>${s.department}</td><td>${s.bank}</td><td style="font-family:monospace">${s.accountNo}</td>
      <td style="text-align:right">₦${(Number(s.basicSalary)||0).toLocaleString('en-NG')}</td>
      <td style="text-align:right">₦${(Number(s.housing)||0).toLocaleString('en-NG')}</td>
      <td style="text-align:right">₦${(Number(s.transport)||0).toLocaleString('en-NG')}</td>
      <td style="text-align:right;font-weight:700;color:#1A5C2A">₦${gross.toLocaleString('en-NG')}</td>
      <td style="text-align:center"><span style="padding:2px 8px;border-radius:20px;font-size:10px;background:${s.status==='Active'?'#d4edda':'#f8d7da'};color:${s.status==='Active'?'#155724':'#721c24'}">${s.status}</span></td>
    </tr>`;
  }).join('');
  const total = filtered.reduce((a,s)=>a+(Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0),0);
  const totalBasic = filtered.reduce((a,s)=>a+(Number(s.basicSalary)||0),0);
  const totalHousing = filtered.reduce((a,s)=>a+(Number(s.housing)||0),0);
  const totalTransport = filtered.reduce((a,s)=>a+(Number(s.transport)||0),0);

  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>NLNG Contract Staff Payroll — ${period}</title>
  <style>${PRINT_CSS}</style></head><body>
${printHeader('NLNG CONTRACT STAFF — MONTHLY PAYROLL REGISTER', period)}
  <table>
    <thead><tr>
      <th>S/N</th><th>Full Name</th><th>Ref ID</th><th>Department</th><th>Bank</th><th>Account No.</th>
      <th style="text-align:right">Basic (₦)</th><th style="text-align:right">Housing (₦)</th><th style="text-align:right">Transport (₦)</th>
      <th style="text-align:right">Gross (₦)</th><th style="text-align:center">Status</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="total-row">
      <td colspan="6" style="text-align:right;text-transform:uppercase;font-size:10px;letter-spacing:.5px">Total — ${filtered.length} Staff Members</td>
      <td style="text-align:right">₦${totalBasic.toLocaleString('en-NG')}</td>
      <td style="text-align:right">₦${totalHousing.toLocaleString('en-NG')}</td>
      <td style="text-align:right">₦${totalTransport.toLocaleString('en-NG')}</td>
      <td style="text-align:right;font-size:14px">₦${total.toLocaleString('en-NG')}</td>
      <td></td>
    </tr></tfoot>
  </table>
  <div class="footer">
    <div><div class="sig">Prepared By / Date</div></div>
    <div><div class="sig">Reviewed By / Date</div></div>
    <div><div class="sig">Approved By / Date</div></div>
  </div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`);
  w.document.close();
}

function printPayslip(s, period, company) {
  const basic     = Number(s.basicSalary)||0;
  const housing   = Number(s.housing)||0;
  const transport = Number(s.transport)||0;
  const bonny     = Number(s.bonnyAllowance)||0;
  const leaveAll  = Number(s.leaveAllowance)||0;
  const eoyBonus  = Number(s.eoyBonus)||0;
  const overtime  = Number(s.overtimeAllowance)||0;
  const gross     = basic + housing + transport + bonny + leaveAll + eoyBonus + overtime;

  // PAYE (simplified progressive — Nigerian tax table, applied monthly on annualised gross)
  function calcPAYE(annual) {
    const bands = [[300000,7],[300000,11],[500000,15],[500000,19],[1600000,21],[Infinity,24]];
    let tax=0, rem=annual;
    for(const [limit,rate] of bands){ const slice=Math.min(rem,limit); tax+=slice*(rate/100); rem-=slice; if(rem<=0)break; }
    return Math.round(tax/12);
  }

  // Employee Pension — 8% statutory contribution on (Basic + Housing + Transport)
  const pensionBase     = basic + housing + transport;
  const employeePension = Math.round(pensionBase * 0.08);
  const paye             = calcPAYE(gross * 12);
  const voluntaryPension = Number(s.voluntaryPension)||0;
  const salaryAdvance    = Number(s.salaryAdvance)||0;
  const loan             = Number(s.loan)||0;
  // NOTE: WHT (Withholding Tax) does NOT apply to employee payroll — it is a
  // deduction on payments to VENDORS/CONTRACTORS for goods & services (see
  // Procurement/Invoices module), never on staff salaries. Removed from payslip.
  const totalDeduct = paye + employeePension + voluntaryPension + salaryAdvance + loan;
  const netPay       = gross - totalDeduct;

  const fmtN = n => n > 0 ? n.toLocaleString('en-NG', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '-';
  const monthShort = (() => {
    try {
      const [m, y] = period.split(' ');
      const mi = MONTHS.indexOf(m);
      return mi>=0 ? `${MONTHS[mi].slice(0,3)}-${String(y).slice(-2)}` : period;
    } catch { return period; }
  })();
  const employmentDateFmt = s.employmentDate
    ? new Date(s.employmentDate).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }).replace(/ /g,'-')
    : '—';
  const today = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' }).toUpperCase();

  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Pay Slip — ${s.fullName} — ${period}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;background:#fff;padding:28px;max-width:680px;margin:0 auto}
    .outer{border:2px solid #000;padding:18px 22px}
    .brandrow{display:flex;align-items:center;gap:12px;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:10px}
    .brandrow img{height:46px;width:auto;display:block}
    .brandrow .name{font-size:17px;font-weight:800;color:#1A5C2A;letter-spacing:.3px}
    .titlebar{text-align:center;margin:8px 0 14px}
    .titlebar .t1{font-size:14px;font-weight:800;text-decoration:underline;letter-spacing:.5px}
    .hdrgrid{display:grid;grid-template-columns:1fr 1fr;gap:2px 18px;margin-bottom:4px;font-size:12px}
    .hdrgrid .row{display:flex;gap:6px}
    .hdrgrid .lbl{font-weight:700;white-space:nowrap}
    .hdrgrid .month-row{grid-column:1/-1;display:flex;justify-content:space-between;font-weight:800;font-size:13px;margin-bottom:4px}
    table.pay{width:100%;border-collapse:collapse;margin-top:10px}
    table.pay th{background:#fff;border:1px solid #000;padding:5px 8px;text-align:left;font-size:11.5px;font-weight:700}
    table.pay th.amt{text-align:right}
    table.pay td{border:1px solid #000;padding:5px 8px;font-size:12px}
    table.pay td.amt{text-align:right;font-family:'Courier New',monospace}
    table.pay tr.section td{font-weight:800;background:#f2f2f2}
    table.pay tr.net td{font-weight:800;font-size:13px;background:#f2f2f2}
    .sigblock{margin-top:34px;text-align:center}
    .sigblock img{height:46px;display:block;margin:0 auto 4px}
    .sigblock .for{font-weight:700;font-size:12px;margin-bottom:18px}
    .sigblock .label{font-size:11px;margin-top:2px}
    .sigblock .date{font-weight:700;font-size:11.5px;margin-top:2px}
    @media print{ body{padding:10px} }
  </style></head><body>
  <div class="outer">

    <div class="brandrow">
      <img src="data:image/png;base64,${SLOT_LOGO_B64}" alt="SLOT"/>
      <div class="name">SLOT ENGINEERING NIGERIA LIMITED</div>
    </div>

    <div class="titlebar"><div class="t1">MONTHLY PAY SLIP</div></div>

    <div class="hdrgrid">
      <div class="month-row"><span>MONTH</span><span>${monthShort}</span></div>
      <div class="row"><span class="lbl">Employee Name:</span><span>${s.fullName||'—'}</span></div>
      <div class="row"><span class="lbl">Employee ID:</span><span>${s.refId||'—'}</span></div>
      <div class="row"><span class="lbl">Position:</span><span>${s.role||'—'}</span></div>
      <div class="row"><span class="lbl">Employment Date:</span><span>${employmentDateFmt}</span></div>
      <div class="row"><span class="lbl">Job Location:</span><span>${s.workLocation||'—'}</span></div>
      <div class="row"><span class="lbl">Ref Indicator:</span><span>${s.refIndicator||'—'}</span></div>
    </div>

    <table class="pay">
      <thead><tr><th>EARNINGS</th><th class="amt">AMOUNT (₦)</th></tr></thead>
      <tbody>
        <tr><td>Basic Salary</td><td class="amt">${fmtN(basic)}</td></tr>
        <tr><td>Housing Allowance</td><td class="amt">${fmtN(housing)}</td></tr>
        <tr><td>Transport Allowance</td><td class="amt">${fmtN(transport)}</td></tr>
        <tr><td>Bonny Location Allowance</td><td class="amt">${fmtN(bonny)}</td></tr>
        <tr><td>Leave Allowance</td><td class="amt">${fmtN(leaveAll)}</td></tr>
        <tr><td>End of Year Bonus</td><td class="amt">${fmtN(eoyBonus)}</td></tr>
        <tr><td>Overtime Allowance</td><td class="amt">${fmtN(overtime)}</td></tr>
        <tr class="section"><td>GROSS EMOLUMENT</td><td class="amt">${fmtN(gross)}</td></tr>
        <tr class="section"><td colspan="2">DEDUCTIONS</td></tr>
        <tr><td>PAYE</td><td class="amt">${fmtN(paye)}</td></tr>
        <tr><td>Employee Pension</td><td class="amt">${fmtN(employeePension)}</td></tr>
        <tr><td>Voluntary Pension</td><td class="amt">${fmtN(voluntaryPension)}</td></tr>
        <tr><td>Salary Advance</td><td class="amt">${fmtN(salaryAdvance)}</td></tr>
        <tr><td>Loan</td><td class="amt">${fmtN(loan)}</td></tr>
        <tr class="section"><td>TOTAL DEDUCTIONS</td><td class="amt">${fmtN(totalDeduct)}</td></tr>
        <tr class="net"><td>NET SALARY (TAKE HOME)</td><td class="amt">${fmtN(netPay)}</td></tr>
      </tbody>
    </table>

    <div class="sigblock">
      <div class="for">For: SLOT ENGINEERING NIG LIMITED</div>
      <div class="label">Authorised Signature</div>
      <div class="date">Date: ${today}</div>
    </div>

  </div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`);
  w.document.close();
}
// ── Shared UI ─────────────────────────────────────────────────────────────────
function Tag({ status }) {
  const { C } = useTheme();
  const map = { 'Active':[C.success,'rgba(26,122,74,.12)'], 'Inactive':[C.danger,'rgba(192,57,43,.12)'], 'Suspended':[C.warning,'rgba(201,122,10,.12)'] };
  const [c, bg] = map[status] || ['#6B7280','rgba(107,114,128,.12)'];
  return <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:500, color:c, background:bg, border:`1px solid ${c}30` }}>{status}</span>;
}

function Btn({ children, onClick, variant='primary', sm, style={} }) {
  const { C } = useTheme();
  const V = { primary:{bg:C.green,co:'#fff',b:'none'}, amber:{bg:C.amber,co:'#fff',b:'none'}, ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border}, danger:{bg:C.danger,co:'#fff',b:'none'}, outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green} }[variant]||{};
  return <button onClick={onClick} style={{ background:V.bg,color:V.co,border:V.b,borderRadius:7,padding:sm?'4px 11px':'7px 14px',fontSize:sm?11.5:13,fontWeight:500,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:5,whiteSpace:'nowrap',...style }}>{children}</button>;
}

function StatCard({ label, value, accent, icon: Icon, onClick }) {
  const { C } = useTheme();
  const c = accent || C.green;
  return (
    <div onClick={onClick} style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'13px 15px', flex:1, minWidth:148, position:'relative', overflow:'hidden', boxShadow:C.shadowCard, cursor:onClick?'pointer':'default', transition:'transform 0.12s,box-shadow 0.12s' }} onMouseEnter={e=>{if(onClick){e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,0.15)';}}} onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow=C.shadowCard;}}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:c, borderRadius:'12px 0 0 12px' }} />
      {Icon && <Icon size={22} style={{ position:'absolute', right:14, top:'50%', transform:'translateY(-50%)', opacity:.12, color:c }} />}
      <div style={{ paddingLeft:8 }}>
        <div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:1, marginBottom:5 }}>{label}</div>
        <div style={{ fontSize:19, fontWeight:700, color:c, lineHeight:1 }}>{value}</div>
      </div>
    </div>
  );
}

function FG({ label, full, children }) {
  const { C } = useTheme();
  return <div style={{ display:'flex', flexDirection:'column', gap:3, gridColumn:full?'1/-1':undefined }}><label style={{ fontSize:11, fontWeight:600, color:C.textMid }}>{label}</label>{children}</div>;
}

function SecLabel({ label }) {
  const { C } = useTheme();
  return <div style={{ fontSize:11, fontWeight:700, color:C.textMid, textTransform:'uppercase', letterSpacing:'0.4px', margin:'16px 0 8px', paddingBottom:5, borderBottom:'2px solid '+C.greenPale }}>{label}</div>;
}

// ── Staff Form Modal ──────────────────────────────────────────────────────────
function StaffModal({ modal, onSave, onClose, projects }) {
  const { C } = useTheme();
  const isEdit = modal.mode === 'edit';
  const [f, setF] = useState(modal.data);
  const set = k => e => setF(p => ({ ...p, [k]:e.target.value }));
  const gross = (Number(f.basicSalary)||0)+(Number(f.housing)||0)+(Number(f.transport)||0)+(Number(f.bonnyAllowance)||0)+(Number(f.leaveAllowance)||0)+(Number(f.eoyBonus)||0)+(Number(f.overtimeAllowance)||0);
  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:14, width:'100%', maxWidth:620, marginBottom:32, boxShadow:C.shadowModal }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'18px 24px 14px', borderBottom:'1px solid '+C.borderLight }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text }}>{isEdit?'Edit Staff Record':'Add New Contract Staff'}</div>
            <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>NLNG Contract Staff · SLOT Engineering</div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>×</button>
        </div>
        <div style={{ padding:'0 24px 20px' }}>
          <SecLabel label="Personal Information" />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FG label="Full Name" full><input style={inp} value={f.fullName} onChange={set('fullName')} placeholder="Full legal name" /></FG>
            <FG label="Ref ID"><input style={inp} value={f.refId} onChange={set('refId')} placeholder="e.g. NLNG-ENG-005" /></FG>
            <FG label="Email"><input style={inp} value={f.email} onChange={set('email')} type="email" /></FG>
            <FG label="Phone"><input style={inp} value={f.phone} onChange={set('phone')} placeholder="080…" /></FG>
            <FG label="Date of Birth"><input style={inp} value={f.dob} onChange={set('dob')} type="date" /></FG>
            <FG label="State of Origin"><select style={inp} value={f.stateOfOrigin} onChange={set('stateOfOrigin')}><option value="">— State —</option>{STATES.map(s=><option key={s}>{s}</option>)}</select></FG>
            <FG label="LGA"><input style={inp} value={f.lga} onChange={set('lga')} placeholder="Local Govt. Area" /></FG>
          </div>
          <SecLabel label="Work Information" />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FG label="Department"><select style={inp} value={f.department} onChange={set('department')}><option value="">— Dept —</option>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select></FG>
            <FG label="Service Title / Role"><input style={inp} value={f.role} onChange={set('role')} placeholder="e.g. Site Engineer" /></FG>
            <FG label="Work Location"><input style={inp} value={f.workLocation} onChange={set('workLocation')} placeholder="e.g. NLNG Bonny Island, Rivers State" /></FG>
            <FG label="Project / Cost Centre"><select style={inp} value={f.projectCode||''} onChange={set('projectCode')}><option value="">— Unallocated —</option>{projects.map(p=><option key={p.code} value={p.code}>{p.code}</option>)}</select></FG>
            <FG label="Employment Date"><input style={inp} type="date" value={f.employmentDate} onChange={set('employmentDate')} /></FG>
            <FG label="Ref Indicator"><input style={inp} value={f.refIndicator} onChange={set('refIndicator')} placeholder="e.g. TEA/22C" /></FG>
            <FG label="Status"><select style={inp} value={f.status} onChange={set('status')}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></FG>
          </div>
          <SecLabel label="Payment Details" />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FG label="Bank"><select style={inp} value={f.bank} onChange={set('bank')}><option value="">— Bank —</option>{BANKS.map(b=><option key={b}>{b}</option>)}</select></FG>
            <FG label="Account Number"><input style={inp} value={f.accountNo} onChange={set('accountNo')} placeholder="10-digit account no." /></FG>
          </div>

          <SecLabel label="Earnings" />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FG label="Basic Salary (₦)"><input style={inp} type="number" value={f.basicSalary} onChange={set('basicSalary')} placeholder="0" /></FG>
            <FG label="Housing Allowance (₦)"><input style={inp} type="number" value={f.housing} onChange={set('housing')} placeholder="0" /></FG>
            <FG label="Transport Allowance (₦)"><input style={inp} type="number" value={f.transport} onChange={set('transport')} placeholder="0" /></FG>
            <FG label="Bonny Location Allowance (₦)"><input style={inp} type="number" value={f.bonnyAllowance} onChange={set('bonnyAllowance')} placeholder="0" /></FG>
            <FG label="Leave Allowance (₦)"><input style={inp} type="number" value={f.leaveAllowance} onChange={set('leaveAllowance')} placeholder="0" /></FG>
            <FG label="End of Year Bonus (₦)"><input style={inp} type="number" value={f.eoyBonus} onChange={set('eoyBonus')} placeholder="0" /></FG>
            <FG label="Overtime Allowance (₦)"><input style={inp} type="number" value={f.overtimeAllowance} onChange={set('overtimeAllowance')} placeholder="0" /></FG>
            <FG label="Gross Emolument (Auto)">
              <div style={{ padding:'7px 10px', background:C.greenPale, border:'1px solid '+C.greenLight, borderRadius:7, color:C.green, fontWeight:700, fontSize:15 }}>{formatCurrency(gross)}</div>
            </FG>
          </div>

          <SecLabel label="Deductions" />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FG label="Voluntary Pension (₦)"><input style={inp} type="number" value={f.voluntaryPension} onChange={set('voluntaryPension')} placeholder="0" /></FG>
            <FG label="Salary Advance (₦)"><input style={inp} type="number" value={f.salaryAdvance} onChange={set('salaryAdvance')} placeholder="0" /></FG>
            <FG label="Loan (₦)"><input style={inp} type="number" value={f.loan} onChange={set('loan')} placeholder="0" /></FG>
          </div>
          <div style={{ fontSize:10.5, color:C.textMuted, marginTop:6, lineHeight:1.5 }}>
            PAYE and Employee Pension (8%) are calculated automatically on the payslip — no manual entry needed.
          </div>
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', padding:'14px 24px', borderTop:'1px solid '+C.borderLight }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => onSave(f)}>{isEdit?'Update Record':'Save Staff Member'}</Btn>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function ContractStaff() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db } = state;
  const staff = db.nlng || [];
  const projects = useMemo(() => getProjects(), []);
  const perms = { add:canDo(currentUser,'canAdd'), edit:canDo(currentUser,'canEdit'), del:canDo(currentUser,'canDelete') };

  const currentMonth = new Date().getMonth();
  const currentYear  = new Date().getFullYear();
  const [search,  setSearch]  = useState('');
  const [view,    setView]    = useState('list');
  const [statusFilter, setStatusFilter] = useState('');
  const [modal,   setModal]   = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [payMonth, setPayMonth] = useState(currentMonth);
  const [payYear,  setPayYear]  = useState(currentYear);

  const period = `${MONTHS[payMonth]} ${payYear}`;

  const filtered = useMemo(() => {
    let list = staff;
    if (statusFilter === 'Active')   list = list.filter(s => s.status === 'Active');
    if (statusFilter === 'Inactive') list = list.filter(s => s.status !== 'Active');
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => [s.fullName,s.refId,s.department,s.role,s.workLocation,s.phone,s.email,s.status].some(f=>(f||'').toLowerCase().includes(q)));
    }
    return list;
  }, [staff, search, statusFilter]);

  const active       = staff.filter(s=>s.status==='Active').length;
  const totalPayroll = staff.reduce((a,s)=>a+(Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0),0);

  function updateDB(next) {
    dispatch({ type:'UPDATE_MODULE', mod:'nlng', data:next });
    saveDBLocal({ ...db, nlng:next }, state.activity);
  }

  // ── Payroll → General Ledger ────────────────────────────────────────────
  // periodKey is the stable YYYY-MM dedup key; `period` (defined above) is
  // just the human-readable label ("July 2026") used on screen and in the
  // journal description.
  const periodKey = `${payYear}-${String(payMonth+1).padStart(2,'0')}`;
  const payrollRuns = db.payrollRuns || [];
  const existingRun = payrollRuns.find(r => r.staffType==='Contract' && r.period===periodKey && !r.voided);

  function runPayroll() {
    const activeStaff = filtered.filter(s => s.status === 'Active');
    if (!activeStaff.length) { showToast('No active staff to run payroll for', 'error'); return; }
    const lines = activeStaff.map(s => {
      const basic=(Number(s.basicSalary)||0), housing=(Number(s.housing)||0), transport=(Number(s.transport)||0);
      const extraEarnings=(Number(s.bonnyAllowance)||0)+(Number(s.leaveAllowance)||0)+(Number(s.eoyBonus)||0)+(Number(s.overtimeAllowance)||0);
      const gross=basic+housing+transport+extraEarnings;
      const pension=Math.round((basic+housing+transport)*0.08);
      const paye=(()=>{ const bands=[[300000,7],[300000,11],[500000,15],[500000,19],[1600000,21],[Infinity,24]]; let tax=0,rem=gross*12; for(const [lim,rate] of bands){const sl=Math.min(rem,lim);tax+=sl*(rate/100);rem-=sl;if(rem<=0)break;} return Math.round(tax/12); })();
      const otherDeductions=(Number(s.voluntaryPension)||0)+(Number(s.salaryAdvance)||0)+(Number(s.loan)||0);
      const netPay = gross - pension - paye - otherDeductions;
      return { staffId:s.id, refId:s.refId, fullName:s.fullName, department:s.department, projectCode:s.projectCode||'',
        basic, housing, transport, allowances:extraEarnings, gross, paye, pension, nhf:0, otherDeductions, netPay };
    });
    const run = {
      id: generateId(), staffType:'Contract', period:periodKey, periodLabel:period,
      runDate: new Date().toISOString().split('T')[0], runBy: currentUser?.name || '',
      lines,
      totalGross: lines.reduce((a,l)=>a+l.gross,0), totalPAYE: lines.reduce((a,l)=>a+l.paye,0),
      totalPension: lines.reduce((a,l)=>a+l.pension,0), totalNHF: 0,
      totalOtherDeductions: lines.reduce((a,l)=>a+l.otherDeductions,0), totalNetPay: lines.reduce((a,l)=>a+l.netPay,0),
      paymentDate: '', voided: false,
    };
    dispatch({ type:'UPDATE_MODULE', mod:'payrollRuns', data:[...payrollRuns, run] });
    saveDBLocal({ ...db, payrollRuns:[...payrollRuns, run] }, state.activity);
    logActivity(dispatch, `Payroll run posted: Contract Staff — ${period} (${lines.length} staff, ${formatCurrency(run.totalGross)} gross)`, currentUser);
    showToast(`Payroll posted for ${period}`);
  }

  function markPayrollPaid() {
    if (!existingRun) return;
    const paymentDate = new Date().toISOString().split('T')[0];
    const next = payrollRuns.map(r => r.id===existingRun.id ? {...r, paymentDate} : r);
    dispatch({ type:'UPDATE_MODULE', mod:'payrollRuns', data:next });
    saveDBLocal({ ...db, payrollRuns:next }, state.activity);
    logActivity(dispatch, `Payroll payment recorded: Contract Staff — ${period}`, currentUser);
    showToast('Marked as paid — salaries disbursed');
  }

  function handleSave(f) {
    const basic=Number(f.basicSalary)||0, housing=Number(f.housing)||0, transport=Number(f.transport)||0;
    const record = { ...f, basicSalary:basic, housing, transport, grossSalary:basic+housing+transport };
    const isEdit = modal.mode==='edit';
    if (isEdit) {
      updateDB(staff.map(s=>s.id===record.id?{...s,...record}:s));
      logActivity(dispatch,'Updated staff: '+record.fullName, currentUser);
      showToast('Record updated');
    } else {
      updateDB([...staff,{...record,id:generateId(),sn:staff.length+1,createdAt:new Date().toISOString()}]);
      logActivity(dispatch,'Added NLNG staff: '+record.fullName, currentUser);
      showToast('Staff member added');
    }
    setModal(null);
  }

  function handleDelete(id) {
    const s = staff.find(x=>x.id===id);
    updateDB(staff.filter(x=>x.id!==id).map((x,i)=>({...x,sn:i+1})));
    logActivity(dispatch,'Deleted NLNG staff: '+s?.fullName, currentUser);
    showToast('Deleted','error');
    setConfirm(null);
  }

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12.5, outline:'none', fontFamily:'inherit' };
  const th  = { padding:'9px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:'#fff', textTransform:'uppercase', letterSpacing:'.4px', whiteSpace:'nowrap', background:C.amber };
  const td  = i => ({ padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12, background:i%2===1?C.amberPale:'transparent' });

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* KPI row */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <StatCard label="Total Staff"     value={staff.length}              accent={C.amber}   icon={Users}      onClick={()=>{setStatusFilter('');setView('list');}} />
        <StatCard label="Active"          value={active}                    accent={C.success} icon={UserCheck}  onClick={()=>{setStatusFilter('Active');setView('list');}} />
        <StatCard label="Inactive"        value={staff.length-active}       accent={C.danger}  icon={UserX}      onClick={()=>{setStatusFilter('Inactive');setView('list');}} />
        <StatCard label="Monthly Payroll" value={formatCurrency(totalPayroll)} accent={C.green}  icon={DollarSign} onClick={()=>{setStatusFilter('');setView('payroll');}} />
      </div>

      <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, boxShadow:C.shadowCard }}>
        {/* Module header */}
        <div style={{ padding:'12px 20px', background:'linear-gradient(135deg,#7a5000,#C97A0A)', borderRadius:'12px 12px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>👷 NLNG Contract Staff</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,.65)', marginTop:2 }}>Contract Staff Register · SLOT Engineering Nigeria Limited</div>
          </div>
          {perms.add && <Btn onClick={()=>setModal({mode:'add',data:{...EMPTY}})} style={{ background:'rgba(255,255,255,.2)', color:'#fff', border:'1px solid rgba(255,255,255,.3)' }}>+ Add Staff</Btn>}
        </div>

        {/* Tab bar */}
        <div style={{ display:'flex', borderBottom:'2px solid '+C.borderLight, padding:'0 20px' }}>
          {TABS.map(t=>(
            <button key={t.key} onClick={()=>setView(t.key)} style={{ padding:'10px 16px', fontSize:13, background:'none', border:'none', cursor:'pointer', color:view===t.key?C.amber:C.textMuted, borderBottom:view===t.key?'2px solid '+C.amber:'2px solid transparent', fontWeight:view===t.key?700:400, marginBottom:-2 }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div style={{ padding:'12px 20px', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search staff by name, ref ID, department, role…" style={{ ...inp, flex:1, minWidth:200 }} />

          {/* Period selector — shown on payroll view */}
          {view==='payroll' && <>
            <select value={payMonth} onChange={e=>setPayMonth(Number(e.target.value))} style={{ ...inp, width:'auto' }}>
              {MONTHS.map((m,i)=><option key={m} value={i}>{m}</option>)}
            </select>
            <select value={payYear} onChange={e=>setPayYear(Number(e.target.value))} style={{ ...inp, width:90 }}>
              {[2024,2025,2026,2027].map(y=><option key={y}>{y}</option>)}
            </select>
            <Btn variant="amber" onClick={()=>printPayroll(staff, period, filtered)} style={{ gap:5 }}>🖨 Print Payroll</Btn>
          </>}
        </div>

        {/* Tables */}
        <div style={{ padding:'0 20px 20px', overflowX:'auto' }}>

          {/* LIST VIEW */}
          {view==='list' && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:800 }}>
              <thead><tr>
                {['S/N','Ref ID','Full Name','Department','Role','Work Location','Project','Phone','Email','Status',''].map(h=><th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.length===0 && <tr><td colSpan={11} style={{ textAlign:'center', padding:32, color:C.textMuted }}>No staff records found</td></tr>}
                {filtered.map((s,i)=>(
                  <tr key={s.id} style={{ cursor:'default' }}>
                    <td style={td(i)}>{s.sn}</td>
                    <td style={{ ...td(i), color:C.amber, fontFamily:'monospace', fontWeight:700, fontSize:11 }}>{s.refId}</td>
                    <td style={{ ...td(i), fontWeight:600 }}>{s.fullName}</td>
                    <td style={td(i)}>{s.department}</td>
                    <td style={{ ...td(i), color:C.textMuted }}>{s.role}</td>
                    <td style={td(i)}>{s.workLocation}</td>
                    <td style={{ ...td(i), fontSize:11 }}>{s.projectCode || <span style={{color:C.textMuted}}>Unallocated</span>}</td>
                    <td style={td(i)}>{s.phone}</td>
                    <td style={{ ...td(i), fontSize:11, color:C.textMuted }}>{s.email||'—'}</td>
                    <td style={td(i)}><Tag status={s.status} /></td>
                    <td style={td(i)}>
                      <div style={{ display:'flex', gap:4 }}>
                        {perms.edit && <Btn variant="outline" sm onClick={()=>setModal({mode:'edit',data:{...s}})}>Edit</Btn>}
                        {perms.del  && <Btn variant="danger"  sm onClick={()=>setConfirm(s.id)}>Del</Btn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* PAYROLL VIEW */}
          {view==='payroll' && (
            <>
              {/* Period badge */}
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, padding:'8px 14px', background:C.amberPale, border:'1px solid '+C.amberLight, borderLeft:'4px solid '+C.amber, borderRadius:8, flexWrap:'wrap' }}>
                <span style={{ fontSize:13, fontWeight:700, color:C.amber }}>📅 Payroll Period: {period}</span>
                <span style={{ fontSize:11, color:C.textMuted }}>· {filtered.filter(s=>s.status==='Active').length} active staff</span>
                <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
                  {!existingRun && perms.edit && (
                    <Btn variant="amber" sm onClick={runPayroll}>💰 Run Payroll for {period}</Btn>
                  )}
                  {existingRun && !existingRun.paymentDate && (
                    <>
                      <span style={{ fontSize:11, color:C.success, fontWeight:700 }}>✓ Posted to GL — {formatCurrency(existingRun.totalNetPay)} net pay accrued</span>
                      {perms.edit && <Btn variant="outline" sm onClick={markPayrollPaid}>Mark Salaries Paid</Btn>}
                    </>
                  )}
                  {existingRun && existingRun.paymentDate && (
                    <span style={{ fontSize:11, color:C.success, fontWeight:700 }}>✓ Paid {formatDate(existingRun.paymentDate)} — {formatCurrency(existingRun.totalNetPay)}</span>
                  )}
                </div>
              </div>

              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:900 }}>
                <thead><tr>
                  {['S/N','Full Name','Ref ID','Department','Bank','Account No.','Basic (₦)','Housing (₦)','Transport (₦)','Gross (₦)','PAYE (₦)','Pension (₦)','Deductions (₦)','Net Pay (₦)','Status','Payslip'].map(h=><th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {filtered.length===0 && <tr><td colSpan={16} style={{ textAlign:'center', padding:32, color:C.textMuted }}>No records found</td></tr>}
                  {filtered.map((s,i)=>{
                    const basic=(Number(s.basicSalary)||0), housing=(Number(s.housing)||0), transport=(Number(s.transport)||0);
                    const extraEarnings=(Number(s.bonnyAllowance)||0)+(Number(s.leaveAllowance)||0)+(Number(s.eoyBonus)||0)+(Number(s.overtimeAllowance)||0);
                    const gross=basic+housing+transport+extraEarnings;
                    const pension=Math.round((basic+housing+transport)*0.08);
                    const paye=(()=>{ const bands=[[300000,7],[300000,11],[500000,15],[500000,19],[1600000,21],[Infinity,24]]; let tax=0,rem=gross*12; for(const [lim,rate] of bands){const sl=Math.min(rem,lim);tax+=sl*(rate/100);rem-=sl;if(rem<=0)break;} return Math.round(tax/12); })();
                    const otherDeductions=(Number(s.voluntaryPension)||0)+(Number(s.salaryAdvance)||0)+(Number(s.loan)||0);
                    const totalDeduct=pension+paye+otherDeductions;
                    const netPay=gross-totalDeduct;
                    return (
                      <tr key={s.id}>
                        <td style={td(i)}>{s.sn}</td>
                        <td style={{ ...td(i), fontWeight:700 }}>{s.fullName}</td>
                        <td style={{ ...td(i), color:C.amber, fontFamily:'monospace', fontSize:11 }}>{s.refId}</td>
                        <td style={td(i)}>{s.department}</td>
                        <td style={{ ...td(i), color:C.textMuted }}>{s.bank}</td>
                        <td style={{ ...td(i), fontFamily:'monospace', fontSize:11 }}>{s.accountNo}</td>
                        <td style={{ ...td(i), color:C.green, fontWeight:600 }}>{formatCurrency(basic)}</td>
                        <td style={td(i)}>{formatCurrency(housing)}</td>
                        <td style={td(i)}>{formatCurrency(transport)}</td>
                        <td style={{ ...td(i), color:C.amber, fontWeight:800 }}>{formatCurrency(gross)}</td>
                        <td style={{ ...td(i), color:C.danger, fontSize:11 }}>{formatCurrency(paye)}</td>
                        <td style={{ ...td(i), color:C.danger, fontSize:11 }}>{formatCurrency(pension)}</td>
                        <td style={{ ...td(i), color:C.danger, fontWeight:700 }}>{formatCurrency(totalDeduct)}</td>
                        <td style={{ ...td(i), color:C.success, fontWeight:800, fontSize:13 }}>{formatCurrency(netPay)}</td>
                        <td style={td(i)}><Tag status={s.status} /></td>
                        <td style={td(i)}>
                          <Btn variant="ghost" sm onClick={()=>printPayslip(s, period)} style={{ fontSize:11 }}>🖨 Payslip</Btn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {filtered.length>0 && (
                  <tfoot>
                    <tr style={{ background:C.amberPale, fontWeight:700 }}>
                      <td colSpan={6} style={{ ...td(0), textAlign:'right', color:C.textMid, fontSize:11, textTransform:'uppercase', letterSpacing:'.5px' }}>
                        Total — {filtered.length} Staff
                      </td>
                      <td style={{ ...td(0), color:C.green, fontWeight:700 }}>{formatCurrency(filtered.reduce((a,s)=>a+(Number(s.basicSalary)||0),0))}</td>
                      <td style={td(0)}>{formatCurrency(filtered.reduce((a,s)=>a+(Number(s.housing)||0),0))}</td>
                      <td style={td(0)}>{formatCurrency(filtered.reduce((a,s)=>a+(Number(s.transport)||0),0))}</td>
                      <td style={{ ...td(0), color:C.amber, fontSize:14, fontWeight:800 }}>{formatCurrency(totalPayroll)}</td>
                      <td colSpan={6} style={td(0)} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </>
          )}
        </div>
      </div>

      {modal   && <StaffModal modal={modal} onSave={handleSave} onClose={()=>setModal(null)} projects={projects} />}
      {confirm && (
        <div onClick={()=>setConfirm(null)} style={{ position:'fixed', inset:0, background:'rgba(10,35,15,.6)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:14, padding:28, maxWidth:380, width:'100%', textAlign:'center', boxShadow:C.shadowModal }}>
            <div style={{ fontSize:32, marginBottom:12 }}>⚠️</div>
            <div style={{ fontSize:15, fontWeight:600, color:C.text, marginBottom:20 }}>Delete this staff record permanently?</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              <Btn variant="ghost" onClick={()=>setConfirm(null)}>Cancel</Btn>
              <Btn variant="danger" onClick={()=>handleDelete(confirm)}>Confirm Delete</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
