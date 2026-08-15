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
import { pushOne, pushDelete } from '../../hooks/usePerRecordSync';
import { SLOT_LOGO_B64, SLOT_BRAND, printHeader, PRINT_CSS, openPrintWindow, printBootstrap} from '../../utils/logo';
import { getProjects } from '../../utils/projectMaster';
// calcPAYE_Nigeria import removed 2026-08-05 — PAYE is now entered per staff
// member on the staff form rather than calculated.

const DEPARTMENTS = ['Administration','Procurement','Finance','Engineering','HSE','Operations','Mechanical','Electrical','Civil','IT','Logistics','Legal','HR','Business Development'];
const WORK_LOCATIONS = ['Port Harcourt HQ','Lagos Office','Abuja Office','Bonny Island','Onne Port','Warri Office','Kaduna Office','Site Rotation'];
const BANKS = ['Access Bank','Citibank','Ecobank','Fidelity Bank','First Bank','FCMB','GTBank','Heritage Bank','Keystone Bank','Opay','Palmpay','Polaris Bank','Stanbic IBTC','Sterling Bank','UBA','Union Bank','Unity Bank','Wema Bank','Zenith Bank'];
const STATUSES = ['Active','Inactive','Suspended','On Leave'];
const SERVICE_TITLES = ['Managing Director','Director','General Manager','Deputy General Manager','Assistant General Manager','Senior Manager','Manager','Assistant Manager','Senior Officer','Officer','Assistant Officer','Coordinator','Executive','Analyst','Supervisor','Technician','Assistant'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const EMPTY = { fullName:'', refId:'', department:'', serviceTitle:'', workLocation:'Port Harcourt HQ', employmentDate:'', projectCode:'', phone:'', email:'', bank:'', accountNo:'', basicSalary:'', housing:'', transport:'', otherAddition:'', paye:'', status:'Active', photoUrl:'', photoPosY:50 };
// item 2: staff photo uploads reuse the same Supabase Storage bucket/helper
// as DocScanner rather than standing up a new bucket — uploadDocument()
// already falls back to inline base64 if Supabase Storage is unavailable.
const PHOTO_COMPANY_ID = import.meta.env.VITE_COMPANY_DOC || 'slot-engineering-nigeria';

// ── Print helpers ──────────────────────────────────────────────────────────
function printPayroll(filtered, period) {
  const rows = filtered.map((s,i)=>{
    const otherAdd = Number(s.otherAddition)||0;
    const gross=(Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0)+otherAdd;
    const empDate = s.employmentDate ? new Date(s.employmentDate).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—';
    return `<tr style="background:${i%2===1?'#f3faf5':'#fff'}">
      <td>${s.sn}</td><td><strong>${s.fullName}</strong></td><td style="font-family:monospace;font-size:11px">${s.refId}</td>
      <td>${empDate}</td>
      <td>${s.department}</td><td>${s.serviceTitle||'—'}</td><td>${s.bank}</td>
      <td style="font-family:monospace">${s.accountNo}</td>
      <td style="text-align:right">₦${(Number(s.basicSalary)||0).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:right">₦${(Number(s.housing)||0).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:right">₦${(Number(s.transport)||0).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:right">₦${otherAdd.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:right;font-weight:700;color:#1A5C2A">₦${gross.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:center"><span style="padding:2px 8px;border-radius:20px;font-size:10px;background:${s.status==='Active'?'#d4edda':'#f8d7da'};color:${s.status==='Active'?'#155724':'#721c24'}">${s.status}</span></td>
    </tr>`;
  }).join('');
  const totalOtherAdd = filtered.reduce((a,s)=>a+(Number(s.otherAddition)||0),0);
  const total     = filtered.reduce((a,s)=>a+(Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0),0) + totalOtherAdd;
  const totalB    = filtered.reduce((a,s)=>a+(Number(s.basicSalary)||0),0);
  const totalH    = filtered.reduce((a,s)=>a+(Number(s.housing)||0),0);
  const totalT    = filtered.reduce((a,s)=>a+(Number(s.transport)||0),0);
  openPrintWindow(`<!DOCTYPE html><html><head><title>SLOT Staff Payroll — ${period}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:24px}
    .header{border-bottom:3px solid #1A5C2A;padding-bottom:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end}
    .co{font-size:18px;font-weight:800;color:#1A5C2A}
    .sub{font-size:13px;color:#3A5040;font-weight:600;margin-top:4px}
    .meta{font-size:11px;font-weight:600;color:#182A1C;margin-top:3px}
    .badge{background:#1A5C2A;color:#fff;padding:6px 16px;border-radius:8px;font-weight:700;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-bottom:16px}
    th{background:#1A5C2A;color:#fff;padding:8px 7px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap}
    td{padding:7px;border-bottom:1px solid #EAF0EB;font-size:11px}
    .tot td{background:#EAF4EC;font-weight:700;color:#1A5C2A;border-top:2px solid #1A5C2A}
    .footer{margin-top:40px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px}
    .sig{border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C}
    @media print{body{padding:12px}}
  </style></head><body>
${printHeader('COMPANY STAFF — MONTHLY PAYROLL REGISTER', period)}
  <table>
    <thead><tr>
      <th>S/N</th><th>Full Name</th><th>Employee ID</th><th>Employment Date</th><th>Department</th><th>Service Title</th><th>Bank</th><th>Account No.</th>
      <th style="text-align:right">Basic (₦)</th><th style="text-align:right">Housing (₦)</th><th style="text-align:right">Transport (₦)</th>
      <th style="text-align:right">Other Addition (₦)</th><th style="text-align:right">Gross (₦)</th><th style="text-align:center">Status</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="tot">
      <td colspan="8" style="text-align:right;text-transform:uppercase;font-size:10px;letter-spacing:.5px">Total — ${filtered.length} Staff</td>
      <td style="text-align:right">₦${totalB.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:right">₦${totalH.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:right">₦${totalT.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:right">₦${totalOtherAdd.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:right;font-size:14px">₦${total.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td></td>
    </tr></tfoot>
  </table>
  <div class="footer">
    <div><div class="sig">Prepared By / Date</div></div>
    <div><div class="sig">Reviewed By / Date</div></div>
    <div><div class="sig">Approved By / Date</div></div>
  </div>
  ${printBootstrap({landscape:false})}
  </body></html>`);
}

function printPayslip(s, period) {
  const basic    = Number(s.basicSalary)||0;
  const housing  = Number(s.housing)||0;
  const transport= Number(s.transport)||0;
  const medical  = Number(s.medicalAllowance)||0;
  const other    = Number(s.otherAllowances)||0;
  const otherAdd = Number(s.otherAddition)||0;
  const gross    = basic + housing + transport + medical + other + otherAdd;

  // 2026-08-05: PAYE is no longer computed. It is entered per staff member on
  // the staff form and simply reproduced here — blank stays blank on the slip.
  const pension     = Math.round((basic+housing+transport)*0.08);
  const paye        = Number(s.paye)||0;
  const nhf         = Math.round(basic*0.025); // NHF 2.5% of basic
  const totalDeduct = pension + paye + nhf;
  const netPay      = gross - totalDeduct;
  // 2026-08-15: was Math.round(n) — rounded every figure on this payslip to
  // whole naira, while ContractStaff.jsx's printPayslip (the same document
  // for NLNG contract staff) already shows 2 decimals. Matched so the two
  // payslip formats are consistent regardless of which staff list someone's on.
  const fmtN = n => '₦'+Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  openPrintWindow(`<!DOCTYPE html><html><head><title>Payslip — ${s.fullName} — ${period}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:32px;max-width:700px;margin:0 auto}
    .green-bar{background:#1A5C2A;color:#fff;padding:8px 24px;font-size:13px;font-weight:700;display:flex;justify-content:space-between}
    .body{border:1px solid #D4E0D6;border-top:none;padding:20px 24px;border-radius:0 0 10px 10px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
    .field label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#182A1C;margin-bottom:3px;display:block}
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
    .sig{border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C;margin-top:30px}
    .conf{text-align:center;font-size:9px;color:#4A5C4E;margin-top:20px;text-transform:uppercase;letter-spacing:1px}
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
        <div class="field"><label>Employee ID</label><span style="font-family:monospace;color:#1A5C2A">${s.refId||'—'}</span></div><br>
        <div class="field"><label>Employment Date</label><span>${s.employmentDate ? new Date(s.employmentDate).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—'}</span></div><br>
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
            <tr><td>Medical Allowance</td><td class="earn-amt">${fmtN(medical)}</td></tr>
            <tr><td>Other Allowances</td><td class="earn-amt">${fmtN(other)}</td></tr>
            <tr><td>Other Addition</td><td class="earn-amt">${fmtN(otherAdd)}</td></tr>
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
        <div><div style="font-size:9px;color:#182A1C;text-transform:uppercase">Bank</div><div style="font-weight:600">${s.bank||'—'}</div></div>
        <div><div style="font-size:9px;color:#182A1C;text-transform:uppercase">Account Number</div><div style="font-weight:600;font-family:monospace">${s.accountNo||'—'}</div></div>
        <div><div style="font-size:9px;color:#182A1C;text-transform:uppercase">Pension PIN</div><div style="font-weight:600;font-family:monospace">${s.pensionPin||'—'}</div></div>
      </div>
    </div>
    <div class="footer">
      <div><div class="sig">Employee Signature / Date</div></div>
      <div><div class="sig">HR / Payroll Officer / Date</div></div>
      <div><div class="sig">Authorised By / Date</div></div>
    </div>
    <div class="conf">This payslip is confidential — issued to named employee only</div>
  </div>
  ${printBootstrap({landscape:false})}
  </body></html>`);
}

// ── Print: Staff ID Card ─────────────────────────────────────────────────────
// 2026-08-15 — requested once staff cards started carrying a real photo: a
// physical badge to laminate/put in a holder. CR80 badge size (53.98×85.6mm
// portrait — a credit card turned upright), front only. Uses printBootstrap's
// new pageSize/margin overrides instead of the app's usual A4 sheet, since a
// full A4 margin would consume most of a card this small.
function printStaffCard(s) {
  const initials = (s.fullName||'U').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const photoBlock = s.photoUrl
    ? `<img src="${s.photoUrl}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:center ${s.photoPosY ?? 50}%" />`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff">${initials}</div>`;
  openPrintWindow(`<!DOCTYPE html><html><head><title>Staff ID — ${s.fullName}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;color:#182A1C}
    .card{width:53.98mm;height:85.6mm;border:1px solid #D4E0D6;border-radius:3mm;overflow:hidden;
      display:flex;flex-direction:column;position:relative}
    .band{background:linear-gradient(135deg,#0F3A1A,#1A5C2A);padding:3mm 3mm 2mm;text-align:center}
    .band img{height:8mm;width:auto;display:block;margin:0 auto 1mm}
    .band .co{color:#fff;font-size:6.2pt;font-weight:800;letter-spacing:.2px;line-height:1.15}
    .band .tag{color:rgba(255,255,255,.7);font-size:4.8pt;margin-top:0.5mm}
    .photo{width:22mm;height:22mm;border-radius:50%;overflow:hidden;background:#C97A0A;
      border:0.6mm solid #fff;margin:3mm auto 2mm;flex-shrink:0;box-shadow:0 1mm 2mm rgba(0,0,0,.15)}
    .name{text-align:center;font-size:9.5pt;font-weight:800;color:#182A1C;padding:0 2mm;line-height:1.2}
    .title{text-align:center;font-size:6.5pt;color:#C97A0A;font-weight:700;margin-top:0.8mm}
    .divider{border-top:0.3mm solid #EAF0EB;margin:2.5mm 4mm}
    .field{padding:0 4mm;margin-bottom:1.8mm}
    .field .lbl{font-size:4.6pt;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#8FA894}
    .field .val{font-size:6.8pt;font-weight:600;color:#182A1C;margin-top:0.3mm}
    .idband{background:#F0F8F2;text-align:center;padding:2mm 2mm 3mm;margin-top:auto}
    .idband .val{font-size:8pt;font-weight:800;color:#1A5C2A;font-family:'Courier New',monospace;letter-spacing:.5px}
    .idband .val2{font-size:4.6pt;color:#8FA894;margin-top:1mm}
  </style></head><body>
  <div class="card">
    <div class="band">
      <img src="data:image/jpeg;base64,${SLOT_LOGO_B64}" alt="SLOT" />
      <div class="co">SLOT ENGINEERING NIGERIA LTD</div>
      <div class="tag">Staff Identification Card</div>
    </div>
    <div class="photo">${photoBlock}</div>
    <div class="name">${s.fullName || '—'}</div>
    <div class="title">${s.serviceTitle || '—'}</div>
    <div class="divider"></div>
    <div class="field"><div class="lbl">Department</div><div class="val">${s.department || '—'}</div></div>
    <div class="field"><div class="lbl">Location</div><div class="val">${s.workLocation || '—'}</div></div>
    <div class="idband">
      <div class="val">${s.refId || '—'}</div>
      <div class="val2">If found, please return to SLOT Engineering, Port Harcourt</div>
    </div>
  </div>
  ${printBootstrap({ pageSize: '53.98mm 85.6mm', margin: '0mm' })}
  </body></html>`);
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
    // 2026-08-14: onClick was destructured but never wired — the 4 call sites
    // (setDeptFilter/setView shortcuts) rendered as normal cards that did
    // nothing when clicked. See same fix in Analytics.jsx / Users.jsx.
    <div onClick={onClick} style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'12px 15px', flex:1, minWidth:148, position:'relative', boxShadow:C.shadowCard, cursor:onClick?'pointer':'default' }}>
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
  const [photoBusy, setPhotoBusy] = useState(false);
  const set = k => e => setF(p=>({...p,[k]:e.target.value}));
  const gross=(Number(f.basicSalary)||0)+(Number(f.housing)||0)+(Number(f.transport)||0)+(Number(f.otherAddition)||0);
  const inp={ padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const initials=(f.fullName||'U').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

  // item 2: staff cards had no photo, only initials. Shows an instant local
  // preview while the upload runs in the background, then swaps in the
  // stored URL (or the inline base64 data URL if Supabase Storage isn't
  // reachable — uploadDocument() handles that fallback itself).
  function handlePhotoPick() {
    if (photoBusy) return; // Btn has no native disabled prop — guard here instead
    const inpEl = document.createElement('input');
    inpEl.type = 'file';
    inpEl.accept = 'image/png,image/jpeg,image/webp';
    inpEl.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async ev => {
        const dataUrl = ev.target.result;
        // Reset the position slider on every new upload — an offset dialed in
        // for the previous photo is very unlikely to be right for this one.
        setF(p => ({ ...p, photoUrl: dataUrl, photoPosY: 50 })); // instant preview
        setPhotoBusy(true);
        try {
          const { uploadDocument } = await import('../../supabase/storage');
          const up = await uploadDocument({
            dataUrl, name: `staff-${f.refId || 'photo'}`, contentType: file.type, companyId: PHOTO_COMPANY_ID,
          });
          if (up?.url) setF(p => ({ ...p, photoUrl: up.url }));
        } catch (err) {
          showToast('Photo upload failed — kept a local copy for now.', 'error');
        } finally {
          setPhotoBusy(false);
        }
      };
      reader.readAsDataURL(file);
    };
    inpEl.click();
  }

  return (
    // 2026-08-15: backdrop no longer closes the form on click — see same fix
    // in ui/index.jsx's shared Modal and Procurement.jsx's Overlay.
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:14, width:'100%', maxWidth:620, marginBottom:32, boxShadow:C.shadowModal }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'18px 24px 14px', borderBottom:'1px solid '+C.borderLight }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text }}>{isEdit?'Edit Staff Record':'Add New Staff Member'}</div>
            <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>SLOT Engineering Nigeria Limited · Internal Staff</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {/* Only an already-saved record has a real Employee ID worth printing */}
            {isEdit && <Btn variant="ghost" sm onClick={()=>printStaffCard(f)}>🖨 Print ID Card</Btn>}
            <button onClick={onClose} aria-label="Close dialog" style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>×</button>
          </div>
        </div>
        <div style={{ padding:'0 24px 20px' }}>
          {/* item 2: photo slot — staff cards showed initials only, with no
              way to attach a real photo. */}
          <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:16, paddingTop:18 }}>
            <div style={{ width:64, height:64, borderRadius:'50%', overflow:'hidden', background:'linear-gradient(135deg,#0F3A1A,#2E7D40)', border:'2px solid '+C.amber, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, fontWeight:800, color:'#fff', flexShrink:0 }}>
              {f.photoUrl ? <img src={f.photoUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition:'center '+(f.photoPosY ?? 50)+'%' }} /> : initials}
            </div>
            <div style={{ flex:1 }}>
              <div>
                <Btn variant="ghost" sm onClick={handlePhotoPick} style={{ opacity:photoBusy?0.6:1, cursor:photoBusy?'not-allowed':'pointer' }}>{photoBusy ? 'Uploading…' : (f.photoUrl ? '📷 Change Photo' : '📷 Add Photo')}</Btn>
                {f.photoUrl && !photoBusy && <button onClick={()=>setF(p=>({...p,photoUrl:'',photoPosY:50}))} style={{ marginLeft:8, background:'none', border:'none', color:C.textMuted, fontSize:11, cursor:'pointer', textDecoration:'underline' }}>Remove</button>}
              </div>
              {/* Passport-style photos usually have headroom above the face, so a
                  dead-center crop into a circle often clips the top of the head.
                  Lets a photo be nudged instead of re-uploaded, and the same
                  photoPosY value is used everywhere this photo renders — Staff
                  Cards grid and the printed ID card — so one adjustment fixes it
                  in every place, not just this preview. */}
              {f.photoUrl && (
                <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:10, color:C.textMuted, whiteSpace:'nowrap' }}>Adjust photo</span>
                  <input type="range" min="0" max="100" value={f.photoPosY ?? 50} onChange={e=>setF(p=>({...p,photoPosY:Number(e.target.value)}))} style={{ flex:1, maxWidth:160 }} />
                </div>
              )}
            </div>
          </div>
          <SecLabel label="Staff Information" />
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <FG label="Full Name *" full><input style={inp} value={f.fullName} onChange={set('fullName')} placeholder="Full legal name" /></FG>
            <FG label="Employee ID *"><input style={inp} value={f.refId} onChange={set('refId')} placeholder="e.g. SLOT-001" /></FG>
            <FG label="Employment Date"><input style={inp} type="date" value={f.employmentDate||''} onChange={set('employmentDate')} /></FG>
            {/* item 1: was a closed <select> — staff whose department/title
                wasn't already on the fixed list had no way to enter it. Same
                free-type + datalist combo already used for Supplier/Client
                fields in Procurement.jsx and Service Title in ContractStaff.jsx. */}
            <FG label="Department">
              <input style={inp} list="slotstaff-department-suggestions" value={f.department} onChange={set('department')} placeholder="Type a department, or pick from the list" />
              <datalist id="slotstaff-department-suggestions">{DEPARTMENTS.map(d=><option key={d} value={d} />)}</datalist>
            </FG>
            <FG label="Service Title">
              <input style={inp} list="slotstaff-title-suggestions" value={f.serviceTitle} onChange={set('serviceTitle')} placeholder="Type a service title, or pick from the list" />
              <datalist id="slotstaff-title-suggestions">{SERVICE_TITLES.map(t=><option key={t} value={t} />)}</datalist>
            </FG>
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
            <FG label="Other Addition (₦)"><input style={inp} type="number" value={f.otherAddition} onChange={set('otherAddition')} placeholder="0" /></FG>
            <FG label="PAYE (₦)"><input style={inp} type="number" value={f.paye} onChange={set('paye')} placeholder="Leave blank if not applicable" /></FG>
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

    // Per-record push — fire-and-forget (pushOne/pushDelete never reject,
    // they resolve {ok:false} on failure, same contract as saveDBCloud).
    // Only new/changed records are pushed, not the whole list on every
    // edit — added 2026-07-29 after staff data had no cloud path at all
    // under VITE_USE_PER_RECORD_SYNC=true. See 013_staff_per_record_tables.sql.
    const prevById = new Map(staff.map(s => [s.id, s]));
    const nextIds  = new Set(next.map(s => s.id));
    for (const rec of next) {
      const prev = prevById.get(rec.id);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(rec)) pushOne('slot', rec);
    }
    for (const id of prevById.keys()) {
      if (!nextIds.has(id)) pushDelete('slot', id);
    }
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
      const medical=(Number(s.medicalAllowance)||0), other=(Number(s.otherAllowances)||0), otherAdd=(Number(s.otherAddition)||0);
      const gross=basic+housing+transport+medical+other+otherAdd;
      const pension=Math.round((basic+housing+transport)*0.08);
      const paye=Number(s.paye)||0;        // entered per staff member, not calculated
      const nhf=Math.round(basic*0.025);
      const netPay = gross - pension - paye - nhf;
      return { staffId:s.id, refId:s.refId, fullName:s.fullName, department:s.department, projectCode:s.projectCode||'', employmentDate:s.employmentDate||'',
        basic, housing, transport, allowances:medical+other+otherAdd, gross, paye, pension, nhf, otherDeductions:0, netPay };
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
    pushOne('payrollRuns', run); // 2026-07-29 full-app sync sweep — one new record
    dispatch({ type:'UPDATE_MODULE', mod:'payrollRuns', data:[...payrollRuns, run] });
    saveDBLocal({ ...db, payrollRuns:[...payrollRuns, run] }, state.activity);
    logActivity(dispatch, `Payroll run posted: Company Staff — ${period} (${lines.length} staff, ${formatCurrency(run.totalGross)} gross)`, currentUser);
    showToast(`Payroll posted for ${period}`);
  }

  function markPayrollPaid() {
    if (!existingRun) return;
    const paymentDate = new Date().toISOString().split('T')[0];
    const updatedRun = { ...existingRun, paymentDate };
    const next = payrollRuns.map(r => r.id===existingRun.id ? updatedRun : r);
    pushOne('payrollRuns', updatedRun); // 2026-07-29 full-app sync sweep — one edited record
    dispatch({ type:'UPDATE_MODULE', mod:'payrollRuns', data:next });
    saveDBLocal({ ...db, payrollRuns:next }, state.activity);
    logActivity(dispatch, `Payroll payment recorded: Company Staff — ${period}`, currentUser);
    showToast('Marked as paid — salaries disbursed');
  }

  function handleSave(f) {
    // QA fix: same missing-validation bug as ContractStaff.jsx — blank
    // "Save Staff Member" silently created a real staff record with no name
    // or ID, counted in Total/Active Staff and Monthly Payroll.
    if (!(f.fullName || '').trim()) {
      showToast('Enter the staff member\'s full name before saving.', 'error');
      return;
    }
    if (!(f.refId || '').trim()) {
      showToast('Enter an Employee ID before saving.', 'error');
      return;
    }
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
              <thead><tr>{['S/N','Employee ID','Full Name','Department','Service Title','Location','Employment Date','Phone','Email','Status',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
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
                    <td style={{ ...td(i), fontSize:11 }}>{formatDate(s.employmentDate)}</td>
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
                <thead><tr>{['S/N','Full Name','Employee ID','Employment Date','Department','Service Title','Bank','Account No.','Basic (₦)','Housing (₦)','Transport (₦)','Other Addition (₦)','Gross (₦)','PAYE (₦)','Pension (₦)','NHF (₦)','Deductions (₦)','Net Pay (₦)','Status','Payslip'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {filtered.length===0&&<tr><td colSpan={20} style={{ textAlign:'center', padding:32, color:C.textMuted }}>No records found</td></tr>}
                  {filtered.map((s,i)=>{
                    const basic=(Number(s.basicSalary)||0), housing=(Number(s.housing)||0), transport=(Number(s.transport)||0);
                    const medical=(Number(s.medicalAllowance)||0), other=(Number(s.otherAllowances)||0);
                    const otherAdd=(Number(s.otherAddition)||0);
                    const gross=basic+housing+transport+medical+other+otherAdd;
                    const pension=Math.round((basic+housing+transport)*0.08);
                    const paye=Number(s.paye)||0;        // entered per staff member, not calculated
                    const nhf=Math.round(basic*0.025);
                    const totalDeduct=pension+paye+nhf;
                    const netPay=gross-totalDeduct;
                    return (
                      <tr key={s.id}>
                        <td style={td(i)}>{s.sn}</td>
                        <td style={{ ...td(i), fontWeight:700 }}>{s.fullName}</td>
                        <td style={{ ...td(i), color:C.green, fontFamily:'monospace', fontSize:11 }}>{s.refId}</td>
                        <td style={{ ...td(i), fontSize:11 }}>{formatDate(s.employmentDate)}</td>
                        <td style={td(i)}>{s.department}</td>
                        <td style={{ ...td(i), color:C.textMuted }}>{s.serviceTitle}</td>
                        <td style={{ ...td(i), color:C.textMuted }}>{s.bank}</td>
                        <td style={{ ...td(i), fontFamily:'monospace', fontSize:11 }}>{s.accountNo}</td>
                        <td style={{ ...td(i), color:C.green, fontWeight:600 }}>{formatCurrency(basic)}</td>
                        <td style={td(i)}>{formatCurrency(housing)}</td>
                        <td style={td(i)}>{formatCurrency(transport)}</td>
                        <td style={td(i)}>{formatCurrency(otherAdd)}</td>
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
                      <td colSpan={8} style={{ ...td(0), textAlign:'right', color:C.textMid, fontSize:11, textTransform:'uppercase', letterSpacing:'.5px' }}>Total — {filtered.length} Staff</td>
                      <td style={{ ...td(0), color:C.green, fontWeight:700 }}>{formatCurrency(filtered.reduce((a,s)=>a+(Number(s.basicSalary)||0),0))}</td>
                      <td style={td(0)}>{formatCurrency(filtered.reduce((a,s)=>a+(Number(s.housing)||0),0))}</td>
                      <td style={td(0)}>{formatCurrency(filtered.reduce((a,s)=>a+(Number(s.transport)||0),0))}</td>
                      <td style={td(0)}>{formatCurrency(filtered.reduce((a,s)=>a+(Number(s.otherAddition)||0),0))}</td>
                      <td style={{ ...td(0), color:C.amber, fontSize:14, fontWeight:800 }}>{formatCurrency(filtered.reduce((a,s)=>a+(Number(s.basicSalary)||0)+(Number(s.housing)||0)+(Number(s.transport)||0)+(Number(s.medicalAllowance)||0)+(Number(s.otherAllowances)||0)+(Number(s.otherAddition)||0),0))}</td>
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
                const sc={ Active:C.success, Inactive:C.danger, Suspended:C.warning, 'On Leave':'#1A5C8A' }[s.status]||C.textMuted;
                return (
                  <div key={s.id} style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, overflow:'hidden', boxShadow:C.shadowCard }}>
                    <div style={{ background:'linear-gradient(135deg,#0F3A1A,#2E7D40)', padding:'16px', display:'flex', alignItems:'center', gap:12 }}>
                      {/* item 2: photo if the staff record has one, else the
                          same initials-circle fallback as before */}
                      <div style={{ width:44, height:44, borderRadius:'50%', overflow:'hidden', background:'rgba(201,122,10,.4)', border:'2px solid '+C.amber, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:800, color:'#fff', flexShrink:0 }}>
                        {s.photoUrl ? <img src={s.photoUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition:'center '+(s.photoPosY ?? 50)+'%' }} /> : initials}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.fullName}</div>
                        <div style={{ fontSize:11, color:'rgba(255,255,255,.65)', marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.serviceTitle}</div>
                      </div>
                      <div style={{ padding:'2px 8px', borderRadius:20, background:sc+'25', border:'1px solid '+sc+'40', fontSize:10, fontWeight:600, color:sc, flexShrink:0 }}>{s.status}</div>
                    </div>
                    {/* item 2: Gross Salary removed — a card grid staff browse
                        anyone can click through isn't the right place to
                        surface pay figures. Salary stays in the staff form
                        and the Payroll View, both of which are permission-gated. */}
                    <div style={{ padding:'12px 14px' }}>
                      {[['Department',s.department],['Location',s.workLocation],['Employee ID',s.refId]].map(([l,v])=>(
                        <div key={l} style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                          <span style={{ fontSize:11, color:C.textMuted }}>{l}</span>
                          <span style={{ fontSize:11, fontWeight:600, color:l==='Employee ID'?C.green:C.text, fontFamily:l==='Employee ID'?'monospace':'inherit' }}>{v||'—'}</span>
                        </div>
                      ))}
                      {/* Staff ID card print — CR80 badge, front only (see printStaffCard) */}
                      <button onClick={()=>printStaffCard(s)} style={{ width:'100%', marginTop:8, padding:'6px 10px', borderRadius:7, border:'1px solid '+C.border, background:'transparent', color:C.textMid, fontSize:11, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>🖨 Print ID Card</button>
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
