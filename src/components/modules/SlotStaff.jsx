// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — COMPANY STAFF MODULE v2.0
// Full payroll: individual payslip + print payroll register + month selector
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo }    from '../../utils/auth';
import { formatCurrency, formatDate, generateId, showToast } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { SLOT_LOGO_B64, SLOT_BRAND, printHeader, PRINT_CSS } from '../../utils/logo';
import { getProjects } from '../../utils/projectMaster';
import { calcPAYE_Nigeria } from '../../utils/financeConstants';

const DEPARTMENTS = ['Administration','Procurement','Finance','Engineering','HSE','Operations','Mechanical','Electrical','Civil','IT','Logistics','Legal','HR','Business Development'];
const WORK_LOCATIONS = ['Port Harcourt HQ','Lagos Office','Abuja Office','Bonny Island','Onne Port','Warri Office','Kaduna Office','Site Rotation'];
const BANKS = ['Access Bank','Citibank','Ecobank','Fidelity Bank','First Bank','FCMB','GTBank','Heritage Bank','Keystone Bank','Opay','Palmpay','Polaris Bank','Stanbic IBTC','Sterling Bank','UBA','Union Bank','Unity Bank','Wema Bank','Zenith Bank'];
const STATUSES = ['Active','Inactive','Suspended','On Leave'];
const SERVICE_TITLES = ['Managing Director','Director','General Manager','Deputy General Manager','Assistant General Manager','Senior Manager','Manager','Assistant Manager','Senior Officer','Officer','Assistant Officer','Coordinator','Executive','Analyst','Supervisor','Technician','Assistant'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const EMPTY = { fullName:'', refId:'', department:'', serviceTitle:'', workLocation:'Port Harcourt HQ', projectCode:'', phone:'', email:'', bank:'', accountNo:'', basicSalary:'', housing:'', transport:'', status:'Active' };

// ── Print helpers ──────────────────────────────────────────────────────────
function printPayroll(filtered, period) {
  const rows = filtered.map((s,i)=>{
    const gross=(Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0);
    return `<tr style="background:${i%2===1?'#f3faf5':'#fff'}">
      <td>${s.sn}</td><td><strong>${s.fullName}</strong></td><td style="font-family:monospace;font-size:11px">${s.refId}</td>
      <td>${s.department}</td><td>${s.serviceTitle||'—'}</td><td>${s.bank}</td>
      <td style="font-family:monospace">${s.accountNo}</td>
      <td style="text-align:right">₦${(Number(s.basicSalary)||0).toLocaleString('en-NG')}</td>
      <td style="text-align:right">₦${(Number(s.housing)||0).toLocaleString('en-NG')}</td>
      <td style="text-align:right">₦${(Number(s.transport)||0).toLocaleString('en-NG')}</td>
      <td style="text-align:right;font-weight:700;color:#1A5C2A">₦${gross.toLocaleString('en-NG')}</td>
      <td style="text-align:center"><span style="padding:2px 8px;border-radius:20px;font-size:10px;background:${s.status==='Active'?'#d4edda':'#f8d7da'};color:${s.status==='Active'?'#155724':'#721c24'}">${s.status}</span></td>
    </tr>`;
  }).join('');
  const total     = filtered.reduce((a,s)=>a+(Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0),0);
  const totalB    = filtered.reduce((a,s)=>a+(Number(s.basicSalary)||0),0);
  const totalH    = filtered.reduce((a,s)=>a+(Number(s.housing)||0),0);
  const totalT    = filtered.reduce((a,s)=>a+(Number(s.transport)||0),0);
  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>SLOT Staff Payroll — ${period}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:24px}
    .header{border-bottom:3px solid #1A5C2A;padding-bottom:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end}
    .co{font-size:18px;font-weight:800;color:#1A5C2A}
    .sub{font-size:13px;color:#3A5040;font-weight:600;margin-top:4px}
    .meta{font-size:11px;color:#6E8C74;margin-top:3px}
    .badge{background:#1A5C2A;color:#fff;padding:6px 16px;border-radius:8px;font-weight:700;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-bottom:16px}
    th{background:#1A5C2A;color:#fff;padding:8px 7px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap}
    td{padding:7px;border-bottom:1px solid #EAF0EB;font-size:11px}
    .tot td{background:#EAF4EC;font-weight:700;color:#1A5C2A;border-top:2px solid #1A5C2A}
    .footer{margin-top:40px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px}
    .sig{border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#6E8C74}
    @media print{body{padding:12px}}
  </style></head><body>
${printHeader('COMPANY STAFF — MONTHLY PAYROLL REGISTER', period)}
  <table>
    <thead><tr>
      <th>S/N</th><th>Full Name</th><th>Ref ID</th><th>Department</th><th>Service Title</th><th>Bank</th><th>Account No.</th>
      <th style="text-align:right">Basic (₦)</th><th style="text-align:right">Housing (₦)</th><th style="text-align:right">Transport (₦)</th>
      <th style="text-align:right">Gross (₦)</th><th style="text-align:center">Status</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="tot">
      <td colspan="7" style="text-align:right;text-transform:uppercase;font-size:10px;letter-spacing:.5px">Total — ${filtered.length} Staff</td>
      <td style="text-align:right">₦${totalB.toLocaleString('en-NG')}</td>
      <td style="text-align:right">₦${totalH.toLocaleString('en-NG')}</td>
      <td style="text-align:right">₦${totalT.toLocaleString('en-NG')}</td>
      <td style="text-align:right;font-size:14px">₦${total.toLocaleString('en-NG')}</td><td></td>
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

function printPayslip(s, period) {
  const basic    = Number(s.basicSalary)||0;
  const housing  = Number(s.housing)||0;
  const transport= Number(s.transport)||0;
  const medical  = Number(s.medicalAllowance)||0;
  const other    = Number(s.otherAllowances)||0;
  const gross    = basic + housing + transport + medical + other;

  function calcPAYE(annual) {
    // CRITICAL FIX: previously applied the bands directly to annual gross,
    // omitting the Consolidated Relief Allowance (CRA). Nigerian law requires
    // CRA = max(₦200,000, 1% of gross) + 20% of gross to be deducted first.
    // Now delegates to the shared PITA-compliant utility.
    return calcPAYE_Nigeria(annual / 12);
  }

  const pension     = Math.round((basic+housing+transport)*0.08);
  const paye        = calcPAYE(gross*12);
  const nhf         = Math.round(basic*0.025); // NHF 2.5% of basic
  const totalDeduct = pension + paye + nhf;
  const netPay      = gross - totalDeduct;
  const fmtN = n => '₦'+Math.round(n).toLocaleString('en-NG');

  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Payslip — ${s.fullName} — ${period}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:32px;max-width:700px;margin:0 auto}
    .green-bar{background:#1A5C2A;color:#fff;padding:8px 24px;font-size:13px;font-weight:700;display:flex;justify-content:space-between}
    .body{border:1px solid #D4E0D6;border-top:none;padding:20px 24px;border-radius:0 0 10px 10px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
    .field label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6E8C74;margin-bottom:3px;display:block}
    .field span{font-size:13px;font-weight:600;color:#182A1C}
    hr{border:none;border-top:1px solid #EAF0EB;margin:16px 0}
    table{width:100%;border-collapse:collapse}
    th{background:#EAF4EC;padding:7px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;color:#3A5040}
    th.right{text-align:right}
    td{padding:8px 10px;border-bottom:1px solid #EAF0EB;font-size:12px}
    .earn-amt{text-align:right;font-weight:600;color:#1A5C2A}
    .deduct-amt{text-align:right;font-weight:600;color:#C0392B}
    .tot td{background:#EAF4EC;font-weight:700;font-size:13px;color:#1A5C2A;border-top:2px solid #1A5C2A}
    .dtot td{background:#FDECEA;font-weight:700;font-size:13px;color:#C0392B;border-top:2px solid #C0392B}
    .two-tables{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
    .net{background:#1A5C2A;color:#fff;padding:14px 20px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;margin:16px 0}
    .net-lbl{font-size:11px;text-transform:uppercase;letter-spacing:.5px;opacity:.8}
    .net-val{font-size:24px;font-weight:800}
    .bank{background:#EAF4EC;border:1px solid #4CAF64;border-left:4px solid #1A5C2A;border-radius:8px;padding:10px 14px;margin:14px 0}
    .footer{margin-top:36px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px}
    .sig{border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#6E8C74;margin-top:30px}
    .conf{text-align:center;font-size:9px;color:#A4BAA8;margin-top:20px;text-transform:uppercase;letter-spacing:1px}
    @media print{body{padding:16px}}
  </style></head><body>
  <div style="background:linear-gradient(135deg,#0F3A1A,#1A5C2A);padding:18px 24px;border-radius:10px 10px 0 0">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="background:#fff;border-radius:8px;padding:5px 7px;box-shadow:0 2px 8px rgba(0,0,0,.3)">
        <img src="data:image/png;base64,${SLOT_LOGO_B64}" alt="SLOT" style="height:40px;width:auto;display:block"/>
      </div>
      <div>
        <div style="font-size:15px;font-weight:800;color:#fff">SLOT Engineering Nigeria Limited</div>
        <div style="font-size:10px;color:rgba(255,255,255,.65);margin-top:3px">Company Staff · Employee Payslip · Confidential</div>
      </div>
    </div>
  </div>
  <div class="green-bar"><span>PAYSLIP</span><span>${period}</span></div>
  <div class="body">
    <div class="grid2">
      <div>
        <div class="field"><label>Full Name</label><span>${s.fullName}</span></div><br>
        <div class="field"><label>Ref ID / Staff ID</label><span style="font-family:monospace;color:#1A5C2A">${s.refId||'—'}</span></div><br>
        <div class="field"><label>Department</label><span>${s.department||'—'}</span></div>
      </div>
      <div>
        <div class="field"><label>Service Title</label><span>${s.serviceTitle||'—'}</span></div><br>
        <div class="field"><label>Work Location</label><span>${s.workLocation||'—'}</span></div><br>
        <div class="field"><label>Email</label><span>${s.email||'—'}</span></div>
      </div>
    </div>
    <hr>
    <div class="two-tables">
      <div>
        <table>
          <thead><tr><th>Earnings</th><th class="right">Amount (₦)</th></tr></thead>
          <tbody>
            <tr><td>Basic Salary</td><td class="earn-amt">${fmtN(basic)}</td></tr>
            <tr><td>Housing Allowance</td><td class="earn-amt">${fmtN(housing)}</td></tr>
            <tr><td>Transport Allowance</td><td class="earn-amt">${fmtN(transport)}</td></tr>
            ${medical>0?`<tr><td>Medical Allowance</td><td class="earn-amt">${fmtN(medical)}</td></tr>`:''}
            ${other>0?`<tr><td>Other Allowances</td><td class="earn-amt">${fmtN(other)}</td></tr>`:''}
          </tbody>
          <tfoot><tr class="tot"><td>GROSS SALARY</td><td style="text-align:right">${fmtN(gross)}</td></tr></tfoot>
        </table>
      </div>
      <div>
        <table>
          <thead><tr><th>Deductions</th><th class="right">Amount (₦)</th></tr></thead>
          <tbody>
            <tr><td>PAYE Income Tax</td><td class="deduct-amt">${fmtN(paye)}</td></tr>
            <tr><td>Pension (8% Employee)</td><td class="deduct-amt">${fmtN(pension)}</td></tr>
            <tr><td>NHF (2.5% of Basic)</td><td class="deduct-amt">${fmtN(nhf)}</td></tr>
          </tbody>
          <tfoot><tr class="dtot"><td>TOTAL DEDUCTIONS</td><td style="text-align:right">${fmtN(totalDeduct)}</td></tr></tfoot>
        </table>
      </div>
    </div>
    <div class="net">
      <div><div class="net-lbl">Net Pay</div><div style="font-size:10px;opacity:.7;margin-top:2px">${period} · After all deductions</div></div>
      <div class="net-val">${fmtN(netPay)}</div>
    </div>
    <div class="bank">
      <div style="font-size:10px;font-weight:700;color:#1A5C2A;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Payment Details</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <div><div style="font-size:9px;color:#6E8C74;text-transform:uppercase">Bank</div><div style="font-weight:600">${s.bank||'—'}</div></div>
        <div><div style="font-size:9px;color:#6E8C74;text-transform:uppercase">Account Number</div><div style="font-weight:600;font-family:monospace">${s.accountNo||'—'}</div></div>
        <div><div style="font-size:9px;color:#6E8C74;text-transform:uppercase">Pension PIN</div><div style="font-weight:600;font-family:monospace">${s.pensionPin||'—'}</div></div>
      </div>
    </div>
    <div class="footer">
      <div><div class="sig">Employee Signature / Date</div></div>
      <div><div class="sig">HR / Payroll Officer / Date</div></div>
      <div><div class="sig">Authorised By / Date</div></div>
    </div>
    <div class="conf">This payslip is confidential — issued to named employee only</div>
  </div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`);
  w.document.close();
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
function Tag({ status }) {
  const { C } = useTheme();
  const map = { 'Active':[C.success,'rgba(26,122,74,.12)'], 'Inactive':[C.danger,'rgba(192,57,43,.12)'], 'Suspended':[C.warning,'rgba(201,122,10,.12)'], 'On Leave':['#1A5C8A','rgba(26,92,138,.12)'] };
  const [c, bg] = map[status]||['#6B7280','rgba(107,114,128,.12)'];
  return <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:500, color:c, background:bg, border:`1px solid ${c}30` }}>{status}</span>;
}

function Btn({ children, onClick, variant='primary', sm, style={} }) {
  const { C } = useTheme();
  const V = { primary:{bg:C.green,co:'#fff',b:'none'}, ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border}, danger:{bg:C.danger,co:'#fff',b:'none'}, outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green} }[variant]||{};
  return <button onClick={onClick} style={{ background:V.bg,color:V.co,border:V.b,borderRadius:7,padding:sm?'4px 11px':'7px 14px',fontSize:sm?11.5:13,fontWeight:500,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:5,whiteSpace:'nowrap',...style }}>{children}</button>;
}

function KPI({ label, value, sub, accent, onClick }) {
  const { C } = useTheme();
  const c = accent||C.green;
  return (
    <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'12px 15px', flex:1, minWidth:148, position:'relative', boxShadow:C.shadowCard }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:c, borderRadius:'12px 0 0 12px' }} />
      <div style={{ paddingLeft:6 }}>
        <div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:4 }}>{label}</div>
        <div style={{ fontSize:20, fontWeight:700, color:c, lineHeight:1 }}>{value}</div>
        {sub && <div style={{ fontSize:11, color:C.textMuted, marginTop:3 }}>{sub}</div>}
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

function StaffModal({ modal, onSave, onClose, projects }) {
  const { C } = useTheme();
  const isEdit = modal.mode==='edit';
  const [f, setF] = useState(modal.data);
  const set = k => e => setF(p=>({...p,[k]:e.target.value}));
  const gross=(Number(f.basicSalary)||0)+(Number(f.housing)||0)+(Number(f.transport)||0);
  const inp={ padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:14, width:'100%', maxWidth:620, marginBottom:32, boxShadow:C.shadowModal }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'18px 24px 14px', borderBottom:'1px solid '+C.borderLight }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text }}>{isEdit?'Edit Staff Record':'Add New Staff Member'}</div>
            <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>SLOT Engineering Nigeria Limited · Internal Staff</div>
          </div>
          <button onClick={onClose} aria-label="Close dialog" style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>×</button>
        </div>
        <div style={{ padding:'0 24px 20px' }}>
          <SecLabel label="Staff Information" />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FG label="Full Name" full><input style={inp} value={f.fullName} onChange={set('fullName')} placeholder="Full legal name" /></FG>
            <FG label="Ref ID"><input style={inp} value={f.refId} onChange={set('refId')} placeholder="e.g. SLOT-001" /></FG>
            <FG label="Department"><select style={inp} value={f.department} onChange={set('department')}><option value="">— Select —</option>{DEPARTMENTS.map(d=><option key={d}>{d}</option>)}</select></FG>
            <FG label="Service Title"><select style={inp} value={f.serviceTitle} onChange={set('serviceTitle')}><option value="">— Select —</option>{SERVICE_TITLES.map(t=><option key={t}>{t}</option>)}</select></FG>
            <FG label="Work Location"><select style={inp} value={f.workLocation} onChange={set('workLocation')}>{WORK_LOCATIONS.map(l=><option key={l}>{l}</option>)}</select></FG>
            <FG label="Project / Cost Centre"><select style={inp} value={f.projectCode||''} onChange={set('projectCode')}><option value="">— Unallocated —</option>{projects.map(p=><option key={p.code} value={p.code}>{p.code}</option>)}</select></FG>
            <FG label="Status"><select style={inp} value={f.status} onChange={set('status')}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></FG>
            <FG label="Phone"><input style={inp} value={f.phone} onChange={set('phone')} placeholder="080…" /></FG>
            <FG label="Email"><input style={inp} value={f.email} onChange={set('email')} type="email" placeholder="name@slot.com.ng" /></FG>
          </div>
          <SecLabel label="Payment Details" />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FG label="Bank"><select style={inp} value={f.bank} onChange={set('bank')}><option value="">— Bank —</option>{BANKS.map(b=><option key={b}>{b}</option>)}</select></FG>
            <FG label="Account Number"><input style={inp} value={f.accountNo} onChange={set('accountNo')} placeholder="10-digit account no." /></FG>
            <FG label="Basic Salary (₦)"><input style={inp} type="number" value={f.basicSalary} onChange={set('basicSalary')} placeholder="0" /></FG>
            <FG label="Housing Allowance (₦)"><input style={inp} type="number" value={f.housing} onChange={set('housing')} placeholder="0" /></FG>
            <FG label="Transport Allowance (₦)"><input style={inp} type="number" value={f.transport} onChange={set('transport')} placeholder="0" /></FG>
            <FG label="Gross Salary (Auto)">
              <div style={{ padding:'7px 10px', background:C.greenPale, border:'1px solid '+C.greenLight, borderRadius:7, color:C.green, fontWeight:700, fontSize:15 }}>{formatCurrency(gross)}</div>
            </FG>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', padding:'14px 24px', borderTop:'1px solid '+C.borderLight }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={()=>onSave(f)}>{isEdit?'Update Record':'Save Staff Member'}</Btn>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
const VIEWS = [{ key:'list', label:'Staff List' }, { key:'payroll', label:'Payroll View' }, { key:'grid', label:'Staff Cards' }];

export default function SlotStaff() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db } = state;
  const staff = db.slot || [];
  const projects = useMemo(() => getProjects(), []);
  const perms = { add:canDo(currentUser,'canAdd'), edit:canDo(currentUser,'canEdit'), del:canDo(currentUser,'canDelete') };

  const currentMonth = new Date().getMonth();
  const currentYear  = new Date().getFullYear();
  const [search,     setSearch]    = useState('');
  const [deptFilter, setDeptFilter]= useState('');
  const [view,       setView]      = useState('list');
  const [modal,      setModal]     = useState(null);
  const [confirm,    setConfirm]   = useState(null);
  const [payMonth,   setPayMonth]  = useState(currentMonth);
  const [payYear,    setPayYear]   = useState(currentYear);

  const period = `${MONTHS[payMonth]} ${payYear}`;

  const filtered = useMemo(()=>{
    let list = staff;
    if (deptFilter === 'On Leave') list=list.filter(s=>s.status==='On Leave');
    else if (deptFilter === 'Inactive') list=list.filter(s=>s.status!=='Active'&&s.status!=='On Leave');
    else if (deptFilter) list=list.filter(s=>s.department===deptFilter);
    if (search) {
      const q=search.toLowerCase();
      list=list.filter(s=>[s.fullName,s.refId,s.department,s.serviceTitle,s.workLocation,s.phone,s.email,s.status].some(f=>(f||'').toLowerCase().includes(q)));
    }
    return list;
  },[staff,search,deptFilter]);

  const active       = staff.filter(s=>s.status==='Active').length;
  const onLeave      = staff.filter(s=>s.status==='On Leave').length;
  const totalPayroll = staff.reduce((a,s)=>a+(Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0),0);
  const depts        = [...new Set(staff.map(s=>s.department).filter(Boolean))].sort();

  function updateDB(next) {
    dispatch({ type:'UPDATE_MODULE', mod:'slot', data:next });
    saveDBLocal({ ...db, slot:next }, state.activity);
  }

  // ── Payroll → General Ledger ────────────────────────────────────────────
  const periodKey = `${payYear}-${String(payMonth+1).padStart(2,'0')}`;
  const payrollRuns = db.payrollRuns || [];
  const existingRun = payrollRuns.find(r => r.staffType==='Company' && r.period===periodKey && !r.voided);

  function runPayroll() {
    const activeStaff = filtered.filter(s => s.status === 'Active');
    if (!activeStaff.length) { showToast('No active staff to run payroll for', 'error'); return; }
    const lines = activeStaff.map(s => {
      const basic=(Number(s.basicSalary)||0), housing=(Number(s.housing)||0), transport=(Number(s.transport)||0);
      const medical=(Number(s.medicalAllowance)||0), other=(Number(s.otherAllowances)||0);
      const gross=basic+housing+transport+medical+other;
      const pension=Math.round((basic+housing+transport)*0.08);
      const paye=calcPAYE_Nigeria(gross);  // shared PITA-compliant calc (with CRA)
      const nhf=Math.round(basic*0.025);
      const netPay = gross - pension - paye - nhf;
      return { staffId:s.id, refId:s.refId, fullName:s.fullName, department:s.department, projectCode:s.projectCode||'',
        basic, housing, transport, allowances:medical+other, gross, paye, pension, nhf, otherDeductions:0, netPay };
    });
    const run = {
      id: generateId(), staffType:'Company', period:periodKey, periodLabel:period,
      runDate: new Date().toISOString().split('T')[0], runBy: currentUser?.name || '',
      lines,
      totalGross: lines.reduce((a,l)=>a+l.gross,0), totalPAYE: lines.reduce((a,l)=>a+l.paye,0),
      totalPension: lines.reduce((a,l)=>a+l.pension,0), totalNHF: lines.reduce((a,l)=>a+l.nhf,0),
      totalOtherDeductions: 0, totalNetPay: lines.reduce((a,l)=>a+l.netPay,0),
      paymentDate: '', voided: false,
    };
    dispatch({ type:'UPDATE_MODULE', mod:'payrollRuns', data:[...payrollRuns, run] });
    saveDBLocal({ ...db, payrollRuns:[...payrollRuns, run] }, state.activity);
    logActivity(dispatch, `Payroll run posted: Company Staff — ${period} (${lines.length} staff, ${formatCurrency(run.totalGross)} gross)`, currentUser);
    showToast(`Payroll posted for ${period}`);
  }

  function markPayrollPaid() {
    if (!existingRun) return;
    const paymentDate = new Date().toISOString().split('T')[0];
    const next = payrollRuns.map(r => r.id===existingRun.id ? {...r, paymentDate} : r);
    dispatch({ type:'UPDATE_MODULE', mod:'payrollRuns', data:next });
    saveDBLocal({ ...db, payrollRuns:next }, state.activity);
    logActivity(dispatch, `Payroll payment recorded: Company Staff — ${period}`, currentUser);
    showToast('Marked as paid — salaries disbursed');
  }

  function handleSave(f) {
    const basic=Number(f.basicSalary)||0, housing=Number(f.housing)||0, transport=Number(f.transport)||0;
    const record={ ...f, basicSalary:basic, housing, transport, grossSalary:basic+housing+transport };
    const isEdit=modal.mode==='edit';
    if (isEdit) {
      updateDB(staff.map(s=>s.id===record.id?{...s,...record}:s));
      logActivity(dispatch,'Updated SLOT staff: '+record.fullName, currentUser);
      showToast('Record updated');
    } else {
      updateDB([...staff,{...record,id:generateId(),sn:staff.length+1,createdAt:new Date().toISOString()}]);
      logActivity(dispatch,'Added SLOT staff: '+record.fullName, currentUser);
      showToast('Staff member added');
    }
    setModal(null);
  }

  function handleDelete(id) {
    const s=staff.find(x=>x.id===id);
    updateDB(staff.filter(x=>x.id!==id).map((x,i)=>({...x,sn:i+1})));
    logActivity(dispatch,'Deleted SLOT staff: '+s?.fullName, currentUser);
    showToast('Deleted','error'); setConfirm(null);
  }

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12.5, outline:'none', fontFamily:'inherit' };
  const th  = { padding:'9px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td  = i => ({ padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12, background:i%2===1?C.greenPale2:'transparent' });

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <KPI label="Total Staff"     value={staff.length}                accent={C.green}   sub={active+' active'} onClick={()=>setDeptFilter("")} />
        <KPI label="On Leave"        value={onLeave}                     accent={C.info}    onClick={()=>setDeptFilter("On Leave")} />
        <KPI label="Inactive"        value={staff.length-active-onLeave} accent={C.danger}  onClick={()=>setDeptFilter("Inactive")} />
        <KPI label="Monthly Payroll" value={formatCurrency(totalPayroll)} accent={C.amber}   onClick={()=>setView("payroll")} sub={depts.length+' departments'} />
      </div>

      <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, boxShadow:C.shadowCard }}>
        <div style={{ padding:'12px 20px', background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)', borderRadius:'12px 12px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>👤 Company Staff Register</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,.65)', marginTop:2 }}>SLOT Engineering Nigeria Limited · Internal Employees</div>
          </div>
          {perms.add && <Btn onClick={()=>setModal({mode:'add',data:{...EMPTY}})} style={{ background:'rgba(255,255,255,.2)', color:'#fff', border:'1px solid rgba(255,255,255,.3)' }}>+ Add Staff</Btn>}
        </div>

        {/* View toggles */}
        <div style={{ display:'flex', borderBottom:'2px solid '+C.borderLight, padding:'0 20px' }}>
          {VIEWS.map(v=>(
            <button key={v.key} onClick={()=>setView(v.key)} style={{ padding:'10px 16px', fontSize:13, background:'none', border:'none', cursor:'pointer', color:view===v.key?C.green:C.textMuted, borderBottom:view===v.key?'2px solid '+C.green:'2px solid transparent', fontWeight:view===v.key?700:400, marginBottom:-2 }}>
              {v.label}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div style={{ padding:'12px 20px', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <select value={deptFilter} onChange={e=>setDeptFilter(e.target.value)} style={{ ...inp, width:'auto', minWidth:160 }}>
            <option value="">All Departments</option>
            {depts.map(d=><option key={d}>{d}</option>)}
          </select>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search staff…" style={{ ...inp, flex:1, minWidth:180 }} />

          {view==='payroll' && <>
            <select value={payMonth} onChange={e=>setPayMonth(Number(e.target.value))} style={{ ...inp, width:'auto' }}>
              {MONTHS.map((m,i)=><option key={m} value={i}>{m}</option>)}
            </select>
            <select value={payYear} onChange={e=>setPayYear(Number(e.target.value))} style={{ ...inp, width:90 }}>
              {[2024,2025,2026,2027].map(y=><option key={y}>{y}</option>)}
            </select>
            <Btn onClick={()=>printPayroll(filtered, period)} style={{ background:C.green, color:'#fff', border:'none' }}>🖨 Print Payroll</Btn>
          </>}
        </div>

        <div style={{ padding:'0 20px 20px', overflowX:'auto' }}>

          {/* LIST VIEW */}
          {view==='list' && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:800 }}>
              <thead><tr>{['S/N','Ref ID','Full Name','Department','Service Title','Location','Project','Phone','Email','Status',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.length===0&&<tr><td colSpan={11} style={{ textAlign:'center', padding:32, color:C.textMuted }}>No staff records found</td></tr>}
                {filtered.map((s,i)=>(
                  <tr key={s.id}>
                    <td style={td(i)}>{s.sn}</td>
                    <td style={{ ...td(i), color:C.green, fontFamily:'monospace', fontWeight:700, fontSize:11 }}>{s.refId}</td>
                    <td style={{ ...td(i), fontWeight:600 }}>{s.fullName}</td>
                    <td style={td(i)}>{s.department}</td>
                    <td style={{ ...td(i), color:C.textMuted }}>{s.serviceTitle}</td>
                    <td style={td(i)}>{s.workLocation}</td>
                    <td style={{ ...td(i), fontSize:11 }}>{s.projectCode || <span style={{color:C.textMuted}}>Unallocated</span>}</td>
                    <td style={{ ...td(i), fontFamily:'monospace', fontSize:11 }}>{s.phone}</td>
                    <td style={{ ...td(i), fontSize:11, color:C.textMuted }}>{s.email||'—'}</td>
                    <td style={td(i)}><Tag status={s.status} /></td>
                    <td style={td(i)}>
                      <div style={{ display:'flex', gap:4 }}>
                        {perms.edit&&<Btn variant="outline" sm onClick={()=>setModal({mode:'edit',data:{...s}})}>Edit</Btn>}
                        {perms.del &&<Btn variant="danger"  sm onClick={()=>setConfirm(s.id)}>Del</Btn>}
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
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, padding:'8px 14px', background:C.greenPale, border:'1px solid '+C.greenLight, borderLeft:'4px solid '+C.green, borderRadius:8, flexWrap:'wrap' }}>
                <span style={{ fontSize:13, fontWeight:700, color:C.green }}>📅 Payroll Period: {period}</span>
                <span style={{ fontSize:11, color:C.textMuted }}>· {filtered.filter(s=>s.status==='Active').length} active staff</span>
                <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
                  {!existingRun && perms.edit && (
                    <Btn variant="primary" sm onClick={runPayroll}>💰 Run Payroll for {period}</Btn>
                  )}
                  {existingRun && !existingRun.paymentDate && (
                    <>
                      <span style={{ fontSize:11, color:C.green, fontWeight:700 }}>✓ Posted to GL — {formatCurrency(existingRun.totalNetPay)} net pay accrued</span>
                      {perms.edit && <Btn variant="outline" sm onClick={markPayrollPaid}>Mark Salaries Paid</Btn>}
                    </>
                  )}
                  {existingRun && existingRun.paymentDate && (
                    <span style={{ fontSize:11, color:C.green, fontWeight:700 }}>✓ Paid {formatDate(existingRun.paymentDate)} — {formatCurrency(existingRun.totalNetPay)}</span>
                  )}
                </div>
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:1300 }}>
                <thead><tr>{['S/N','Full Name','Ref ID','Department','Service Title','Bank','Account No.','Basic (₦)','Housing (₦)','Transport (₦)','Gross (₦)','PAYE (₦)','Pension (₦)','NHF (₦)','Deductions (₦)','Net Pay (₦)','Status','Payslip'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {filtered.length===0&&<tr><td colSpan={18} style={{ textAlign:'center', padding:32, color:C.textMuted }}>No records found</td></tr>}
                  {filtered.map((s,i)=>{
                    const basic=(Number(s.basicSalary)||0), housing=(Number(s.housing)||0), transport=(Number(s.transport)||0);
                    const medical=(Number(s.medicalAllowance)||0), other=(Number(s.otherAllowances)||0);
                    const gross=basic+housing+transport+medical+other;
                    const pension=Math.round((basic+housing+transport)*0.08);
                    const paye=calcPAYE_Nigeria(gross);  // shared PITA-compliant calc (with CRA)
                    const nhf=Math.round(basic*0.025);
                    const totalDeduct=pension+paye+nhf;
                    const netPay=gross-totalDeduct;
                    return (
                      <tr key={s.id}>
                        <td style={td(i)}>{s.sn}</td>
                        <td style={{ ...td(i), fontWeight:700 }}>{s.fullName}</td>
                        <td style={{ ...td(i), color:C.green, fontFamily:'monospace', fontSize:11 }}>{s.refId}</td>
                        <td style={td(i)}>{s.department}</td>
                        <td style={{ ...td(i), color:C.textMuted }}>{s.serviceTitle}</td>
                        <td style={{ ...td(i), color:C.textMuted }}>{s.bank}</td>
                        <td style={{ ...td(i), fontFamily:'monospace', fontSize:11 }}>{s.accountNo}</td>
                        <td style={{ ...td(i), color:C.green, fontWeight:600 }}>{formatCurrency(basic)}</td>
                        <td style={td(i)}>{formatCurrency(housing)}</td>
                        <td style={td(i)}>{formatCurrency(transport)}</td>
                        <td style={{ ...td(i), color:C.amber, fontWeight:800 }}>{formatCurrency(gross)}</td>
                        <td style={{ ...td(i), color:C.danger, fontSize:11 }}>{formatCurrency(paye)}</td>
                        <td style={{ ...td(i), color:C.danger, fontSize:11 }}>{formatCurrency(pension)}</td>
                        <td style={{ ...td(i), color:C.danger, fontSize:11 }}>{formatCurrency(nhf)}</td>
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
                {filtered.length>0&&(
                  <tfoot>
                    <tr style={{ background:C.greenPale, fontWeight:700 }}>
                      <td colSpan={7} style={{ ...td(0), textAlign:'right', color:C.textMid, fontSize:11, textTransform:'uppercase', letterSpacing:'.5px' }}>Total — {filtered.length} Staff</td>
                      <td style={{ ...td(0), color:C.green, fontWeight:700 }}>{formatCurrency(filtered.reduce((a,s)=>a+(Number(s.basicSalary)||0),0))}</td>
                      <td style={td(0)}>{formatCurrency(filtered.reduce((a,s)=>a+(Number(s.housing)||0),0))}</td>
                      <td style={td(0)}>{formatCurrency(filtered.reduce((a,s)=>a+(Number(s.transport)||0),0))}</td>
                      <td style={{ ...td(0), color:C.amber, fontSize:14, fontWeight:800 }}>{formatCurrency(totalPayroll)}</td>
                      <td colSpan={7} style={td(0)} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </>
          )}

          {/* STAFF CARDS */}
          {view==='grid' && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:14, paddingTop:8 }}>
              {filtered.length===0&&<div style={{ gridColumn:'1/-1', textAlign:'center', padding:32, color:C.textMuted }}>No staff records</div>}
              {filtered.map(s=>{
                const initials=(s.fullName||'U').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
                const gross=(Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0);
                const sc={ Active:C.success, Inactive:C.danger, Suspended:C.warning, 'On Leave':'#1A5C8A' }[s.status]||C.textMuted;
                return (
                  <div key={s.id} style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, overflow:'hidden', boxShadow:C.shadowCard }}>
                    <div style={{ background:'linear-gradient(135deg,#0F3A1A,#2E7D40)', padding:'16px', display:'flex', alignItems:'center', gap:12 }}>
                      <div style={{ width:44, height:44, borderRadius:'50%', background:'rgba(201,122,10,.4)', border:'2px solid '+C.amber, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:800, color:'#fff', flexShrink:0 }}>{initials}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.fullName}</div>
                        <div style={{ fontSize:11, color:'rgba(255,255,255,.65)', marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.serviceTitle}</div>
                      </div>
                      <div style={{ padding:'2px 8px', borderRadius:20, background:sc+'25', border:'1px solid '+sc+'40', fontSize:10, fontWeight:600, color:sc, flexShrink:0 }}>{s.status}</div>
                    </div>
                    <div style={{ padding:'12px 14px' }}>
                      {[['Department',s.department],['Location',s.workLocation],['Ref ID',s.refId]].map(([l,v])=>(
                        <div key={l} style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                          <span style={{ fontSize:11, color:C.textMuted }}>{l}</span>
                          <span style={{ fontSize:11, fontWeight:600, color:l==='Ref ID'?C.green:C.text, fontFamily:l==='Ref ID'?'monospace':'inherit' }}>{v||'—'}</span>
                        </div>
                      ))}
                      <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid '+C.borderLight, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase', letterSpacing:'.4px' }}>Gross Salary</span>
                        <span style={{ fontSize:14, fontWeight:700, color:C.amber }}>{formatCurrency(gross)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {modal&&<StaffModal modal={modal} onSave={handleSave} onClose={()=>setModal(null)} projects={projects} />}
      {confirm&&(
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
