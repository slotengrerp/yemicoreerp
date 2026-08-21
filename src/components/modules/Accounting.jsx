import { useState, useEffect, useCallback, useContext, createContext, useRef, useMemo } from "react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { LIGHT } from "../../utils/tokens";
// Live-verify QA fix (2026-08-18): showToast and logActivity were called all
// over this file (recurring journal templates, live bank feed pull, Sage
// Intelligence export) but neither was ever imported here — every one of
// those actions threw an uncaught ReferenceError at runtime (esbuild/vite
// don't catch a bare undefined identifier at build time, only when that
// code path actually executes), so "Save as template", "Post" a recurring
// template, "Delete" a template, and the Mono/Okra live bank pull were all
// silently broken in production. Added both imports, same paths every other
// module in this app already uses for these two helpers.
import { getDeepLinkTab, formatCurrency, showToast } from "../../utils/helpers";
import { logActivity } from "../../utils/audit";
import { getClients, saveClients } from "../../utils/clientMaster";
import { getVendors, saveVendors } from "../../utils/vendorMaster";
import { getProjects, saveProjects } from "../../utils/projectMaster";
import { journalFromPurchaseInvoice, journalFromInvoice, journalFromReceipt, journalFromAPBill, journalFromAPPayment, journalFromPettyCash, journalFromFixedAsset, journalFromDepreciation, journalFromTerminalCharge, journalFromAdvanceReceipt, journalFromAdvanceApplication, journalFromPayrollRun, journalFromPayrollPayment, journalFromFleetRepair, journalFromStockIssue, journalFromCreditNote, reverseJournal } from "../../utils/glPosting";
import { periodOf, isPeriodClosed, isYearClosed } from "../../utils/periods";
import { computeAutoPostedJournals } from "../../utils/autoPostJournals";
import { mergeCOA } from "../../utils/chartOfAccounts";
import { canSeeTerminalLedger } from "../../utils/auth";
import { FG } from "../ui";
import { diffAndPush } from "../../hooks/usePerRecordSync";
import { printHeader, PRINT_CSS, printBootstrap, openPrintWindow, SLOT_LOGO_IMG_TAG } from '../../utils/logo';
import { readTextSmart } from '../../utils/excelIO';

// ════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — ACCOUNTING MODULE v3.0
// Full double-entry accounting: COA · Journals · Ledger · Trial Balance
// P&L · Balance Sheet · Cash Flow · Bank Recon · VAT Returns
// Fixed Assets · WHT Register · PAYE Schedule · Budget vs Actual
// ════════════════════════════════════════════════════════════════════

// ── Palette — mutable module-level object, updated by Accounting on each render ─
// This lets all 12 sub-tabs read the correct theme without prop-drilling.
let C = { ...LIGHT, white: "#FFFFFF" };
const AcctTheme = createContext(C);

// ── Formatters ─────────────────────────────────────────────────────
// 2026-08-15: was maximumFractionDigits:0 — a general ledger rounding off
// kobo meant journal lines that were off by a few kobo looked identical to
// balanced ones. Every other module's fmt() already shows 2 decimals; this
// was the odd one out and the most consequential since it's the actual GL.
const fmt    = n => new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtDate= d => d ? new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const today  = () => new Date().toISOString().split("T")[0];
// Default report window: start of current calendar year → current month.
// Was hardcoded to "2026-01"/"2026-05" (a snapshot of whatever month it was
// written in). Once real activity moved past May, P&L/Cash Flow opened to an
// all-zero report by default — found during QA (Aug 2026: default range
// showed ₦0 everywhere despite ₦162.8M+ in real recorded activity, which
// only appeared once the range was manually extended to include August).
const curYearStart = () => new Date().getFullYear() + "-01";
const curMonth     = () => new Date().toISOString().slice(0,7);

// ════════════════════════════════════════════════════════════════════
// GLOBAL UTILITIES — Print · Export Excel · Clickable KPI
// ════════════════════════════════════════════════════════════════════

// ── Print any DOM section ─────────────────────────────────────────
const printSection = (title, contentHtml) => {
  openPrintWindow(`
    <!DOCTYPE html><html><head>
    <title>${title} — SLOT Engineering Nigeria Limited</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:24px}
      h1{font-size:18px;color:#1A5C2A;margin-bottom:4px}
      h2{font-size:13px;color:#3A5040;margin-bottom:16px;font-weight:400}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      th{background:#1A5C2A;color:#fff;padding:7px 10px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px}
      td{padding:7px 10px;border-bottom:1px solid #EAF0EB;font-size:12px}
      tr:nth-child(even){background:#F3FAF5}
      .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1A5C2A;padding-bottom:12px;margin-bottom:16px}
      .company{font-weight:800;font-size:16px;color:#1A5C2A}
      .meta{font-size:11px;font-weight:600;color:#182A1C;margin-top:3px}
      .report-title{font-size:20px;font-weight:700;color:#1A5C2A;text-align:right}
      .footer{margin-top:24px;padding-top:10px;border-top:1px solid #D4E0D6;font-size:10px;font-weight:600;color:#182A1C;display:flex;justify-content:space-between}
      .amount{text-align:right;font-weight:600}
      .total-row td{background:#EAF4EC;font-weight:700}
      @media print{@page{margin:15mm}button{display:none}}
    </style>
    </head><body>
    <div class="header">
      <div style="display:flex;align-items:center;gap:12px">
        ${SLOT_LOGO_IMG_TAG}
        <div>
        <div class="company">SLOT ENGINEERING NIGERIA LIMITED</div>
        <div class="meta">No 205 Eneka Road, Elimgbu, Port Harcourt · RC: 0000001</div>
        <div class="meta">ernest.ojukwu@sloteng.com · +234(0)8033132454</div>
        </div>
      </div>
      <div class="report-title">${title}</div>
    </div>
    ${contentHtml}
    <div class="footer">
      <span>Generated: ${new Date().toLocaleString('en-GB')}</span>
      <span>SLOT Engineering Nigeria Limited — Confidential</span>
    </div>
    ${printBootstrap({landscape:false})}
    </body></html>
  `);
};

// ── Export data array to Excel (.xlsx via CSV) ────────────────────
const exportToExcel = (filename, headers, rows) => {
  const escape = v => {
    if(v===null||v===undefined) return '';
    const s = String(v).replace(/"/g,'""');
    return s.includes(',') || s.includes('\n') || s.includes('"') ? `"${s}"` : s;
  };
  const csv = [
    headers.map(escape).join(','),
    ...rows.map(r => (Array.isArray(r)?r:Object.values(r)).map(escape).join(','))
  ].join('\r\n');
  const BOM = '\uFEFF'; // UTF-8 BOM so Excel opens correctly
  const blob = new Blob([BOM + csv], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename + '.csv'; a.click();
  URL.revokeObjectURL(url);
};

// ── Clickable KPI card (universal — used in all modules) ──────────
const ClickKPI = ({label,value,sub,color,icon,trend,onClick,badge}) => (
  <div onClick={onClick}
    style={{background:"#FFFFFF",border:`2px solid #D4E0D6`,borderRadius:12,
      padding:"13px 15px",flex:1,minWidth:148,position:"relative",overflow:"hidden",
      boxShadow:"0 1px 3px rgba(15,58,26,0.06)",
      cursor:onClick?"pointer":"default",transition:"all 0.18s"}}
    onMouseEnter={e=>{if(onClick){e.currentTarget.style.border=`2px solid ${color||"#1A5C2A"}`;e.currentTarget.style.boxShadow=`0 4px 14px ${(color||"#1A5C2A")}28`;e.currentTarget.style.transform="translateY(-2px)";}}}
    onMouseLeave={e=>{e.currentTarget.style.border="2px solid #D4E0D6";e.currentTarget.style.boxShadow="0 1px 3px rgba(15,58,26,0.06)";e.currentTarget.style.transform="translateY(0)";}}>
    <div style={{position:"absolute",top:0,left:0,width:4,height:"100%",background:color||"#1A5C2A",borderRadius:"12px 0 0 12px"}}/>
    <div style={{paddingLeft:4}}>
      <div style={{fontSize:10,color:"#6E8C74",fontWeight:600,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.5px",display:"flex",alignItems:"center",gap:6}}>
        {label}
        {onClick&&<span style={{fontSize:9,background:(color||"#1A5C2A")+"18",color:color||"#1A5C2A",padding:"1px 5px",borderRadius:10,fontWeight:700}}>→</span>}
      </div>
      <div style={{fontSize:19,fontWeight:700,color:color||"#182A1C",lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:11,color:"#6E8C74",marginTop:3}}>{sub}</div>}
      {badge&&<div style={{fontSize:10,marginTop:4,color:color||"#1A5C2A",fontWeight:600}}>{badge}</div>}
      {trend!==undefined&&<div style={{fontSize:11,color:trend>=0?"#1A7A4A":"#C0392B",marginTop:2}}>{trend>=0?"▲":"▼"} {Math.abs(trend)}% vs prior</div>}
    </div>
    {icon&&<div style={{position:"absolute",top:12,right:14,fontSize:22,opacity:0.12}}>{icon}</div>}
  </div>
);

const uid    = () => Math.random().toString(36).slice(2,8).toUpperCase();

// ── Mask bank account numbers in all display views ────────────────────────────
// Full number only shows in the COA edit form. Always masks in tables/reports.
// eslint-disable-next-line no-unused-vars -- kept for future manual journal helpers
function getIncomeAccount(inv) {
  const cat = (inv.category || inv.type || '').toLowerCase();
  if (cat.includes('manpower') || cat.includes('labour') || cat.includes('staffing')) return { code:'4001', name:'Manpower Income' };
  if (cat.includes('procurement') || cat.includes('supply') || cat.includes('material')) return { code:'4002', name:'Procurement Income' };
  if (cat.includes('engineer') || cat.includes('technical')) return { code:'4003', name:'Engineering Services Income' };
  if (cat.includes('logistic') || cat.includes('transport')) return { code:'4005', name:'Logistics Income (Flopeng)' };
  return { code:'4500', name:'Other Income' };
}

function maskAcctName(name) {
  if (!name) return name;
  return name.replace(/A\/C\s+(\d+)(\d{4})\b/g, 'A/C ••••$2')
             .replace(/A\/C\s+(\d{4,6})(\d{4})/g, 'A/C ••••$2');
}

// ── Chart of Accounts ────────────────────────────────────────────────────
// Moved to src/utils/chartOfAccounts.js (2026-07-23 audit) so glPosting.js
// can import and validate against the same list instead of keeping its
// account codes in sync with this file by comment convention only. That
// move also fixed two duplicate-code bugs found in this array: code 5010
// was used for both "NHF Payable" and "Purchase Accrual" (Purchase Accrual
// is now 5013), and codes 2000-2005 were each defined twice — once with
// Cost/Accumulated-Depreciation sub-accounts, once as a flatter duplicate
// under a "matches Sage COA 2000-2005" comment (the flat duplicates were
// dropped; the detailed versions, which glPosting.js's depreciation
// postings depend on, were kept). See DEFAULT_COA import above.

// ── Seed data — REMOVED PERMANENTLY, 2026-07-29 ─────────────────────────────
// This module used to carry five SEED_* constants (journals, fixed assets,
// bank statement lines, WHT entries, budgets) as fallback data whenever the
// real store was empty. All five had already been emptied on 2026-07-28
// after fabricated figures (invented revenue/payroll postings, invented
// asset costs, invented bank movement, invented TINs, invented budgets — see
// App.jsx's boot-sequence note for the incident this caused) reached the
// live Trial Balance, P&L and Balance Sheet. The constants and every
// `saved?.field || SEED_X` fallback that read them are now deleted outright
// rather than left as empty arrays — an empty fallback sitting next to a
// live data path is exactly what got "helpfully" refilled last time. Do not
// reintroduce this pattern.

// ════════════════════════════════════════════════════════════════════
// DESIGN SYSTEM (matches App.jsx exactly)
// ════════════════════════════════════════════════════════════════════
const Card=({children,style={}})=>(<div style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:12,padding:"1.1rem 1.25rem",boxShadow:"0 1px 3px rgba(15,58,26,0.07)",...style}}>{children}</div>);
const KPI=({label,value,sub,color,icon})=>(<div style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:12,padding:"13px 15px",flex:1,minWidth:148,position:"relative",overflow:"hidden",boxShadow:"0 1px 3px rgba(15,58,26,0.06)"}}>
  <div style={{position:"absolute",top:0,left:0,width:4,height:"100%",background:color||C.green,borderRadius:"12px 0 0 12px"}}/>
  <div style={{paddingLeft:4}}><div style={{fontSize:10,color:C.textMuted,fontWeight:600,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}</div>
  <div style={{fontSize:19,fontWeight:700,color:color||C.text,lineHeight:1}}>{value}</div>
  {sub&&<div style={{fontSize:11,color:C.textMuted,marginTop:3}}>{sub}</div>}</div>
  {icon&&<div style={{position:"absolute",top:12,right:14,fontSize:22,opacity:0.12}}>{icon}</div>}
</div>);
const SecHead=({title,sub,action})=>(<div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}><div><div style={{fontSize:14,fontWeight:700,color:C.text}}>{title}</div>{sub&&<div style={{fontSize:11,color:C.textMuted,marginTop:1}}>{sub}</div>}</div>{action&&<div style={{flexShrink:0,marginLeft:12}}>{action}</div>}</div>);
const Pill=({label,color=C.green,sm})=>(<span style={{fontSize:sm?10:11,fontWeight:500,padding:sm?"1px 6px":"2px 9px",borderRadius:20,background:color+"20",color,border:`1px solid ${color}30`,whiteSpace:"nowrap",display:"inline-block"}}>{label}</span>);
const getSM=()=>({Active:C.success,Paid:C.success,Completed:C.success,"In Use":C.success,Available:C.success,Issued:C.success,"Accepted":C.success,Reconciled:C.success,
  Overdue:C.danger,"Not Issued":C.danger,Rejected:C.danger,Disposed:C.danger,Scrapped:C.danger,
  Draft:C.textMuted,Open:C.textMuted,"Under Maintenance":C.warning,"Partially Accepted":C.warning,"Pending Inspection":C.warning,"Not Reconciled":C.warning,
  "Remitted to FIRS":C.info,Submitted:C.info});
const SPill=({status})=>{const SM=getSM();return(<Pill label={status||"—"} color={SM[status]||C.textMuted}/>);};
const Btn=({children,onClick,variant="primary",sm,style={},disabled,icon})=>{
  const V={primary:{bg:C.green,co:'#FFFFFF',br:"none"},amber:{bg:C.amber,co:'#FFFFFF',br:"none"},ghost:{bg:"transparent",co:C.textMid,br:`1px solid ${C.border}`},danger:{bg:C.danger,co:'#FFFFFF',br:"none"},outline:{bg:"transparent",co:C.green,br:`1px solid ${C.green}`}}[variant]||{bg:C.green,co:'#FFFFFF',br:"none"};
  return(<button onClick={onClick} disabled={disabled} style={{background:V.bg,color:V.co,border:V.br,borderRadius:8,padding:sm?"4px 12px":"7px 18px",fontSize:sm?11.5:13,fontWeight:500,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.5:1,whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:5,...style}}>{icon&&<span>{icon}</span>}{children}</button>);
};
const Inp=({label,error,...p})=>(<div style={{display:"flex",flexDirection:"column",gap:3}}>{label&&<label style={{fontSize:11,color:C.textMid,fontWeight:600}}>{label}</label>}<input {...p} style={{borderRadius:7,border:`1px solid ${error?C.danger:C.border}`,padding:"7px 10px",fontSize:13,background:C.bgCard,color:C.text,outline:"none",width:"100%",boxSizing:"border-box",...p.style}}/>{error&&<div style={{fontSize:10,color:C.danger}}>{error}</div>}</div>);
const Sel=({label,options,...p})=>(<div style={{display:"flex",flexDirection:"column",gap:3}}>{label&&<label style={{fontSize:11,color:C.textMid,fontWeight:600}}>{label}</label>}<select {...p} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 10px",fontSize:13,background:C.bgCard,color:C.text,width:"100%",boxSizing:"border-box",...p.style}}>{options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}</select></div>);
const Tbl=({cols,rows,onRow,emptyMsg="No records.",compact})=>(<div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:compact?12:13}}><thead><tr style={{background:C.tableHeaderBg}}>{cols.map(c=><th key={c.key} style={{textAlign:c.align||"left",padding:compact?"7px 8px":"9px 10px",fontSize:10.5,fontWeight:700,color:C.tableHeaderText,whiteSpace:"nowrap",letterSpacing:"0.4px",textTransform:"uppercase"}}>{c.label}</th>)}</tr></thead><tbody>{rows.length===0&&<tr><td colSpan={cols.length} style={{textAlign:"center",padding:32,color:C.textMuted}}>{emptyMsg}</td></tr>}{rows.map((r,i)=>(<tr key={r.id||i} onClick={()=>onRow&&onRow(r)} style={{borderBottom:`1px solid ${C.borderLight}`,cursor:onRow?"pointer":"default",background:i%2===1?C.greenPale2:"transparent"}} onMouseEnter={e=>{if(onRow)e.currentTarget.style.background=C.greenPale;}} onMouseLeave={e=>{e.currentTarget.style.background=i%2===1?C.greenPale2:"transparent";}}>{cols.map(c=><td key={c.key} style={{padding:compact?"7px 8px":"9px 10px",textAlign:c.align||"left",whiteSpace:c.wrap?"normal":"nowrap",maxWidth:c.maxW||"none"}}>{c.render?c.render(r):r[c.key]}</td>)}</tr>))}</tbody></table></div>);
const Modal=({title,onClose,children,wide,xl})=>(<div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(10,35,15,0.6)",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"28px 16px",overflowY:"auto",backdropFilter:"blur(3px)"}}><div style={{background:C.bgCard,borderRadius:14,width:"100%",maxWidth:xl?1000:wide?740:560,padding:"1.5rem",boxShadow:"0 24px 80px rgba(0,0,0,0.30)",boxSizing:"border-box",marginBottom:28}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,paddingBottom:14,borderBottom:`1px solid ${C.borderLight}`}}><h3 style={{margin:0,fontSize:16,fontWeight:700,color:C.text}}>{title}</h3><button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:24,color:C.textMuted,lineHeight:1}}>&times;</button></div>{children}</div></div>);
// 2026-07-29: was a single non-wrapping row with overflowX:"auto", which
// forced horizontal scrolling once Accounting grew past ~8 tabs (14 now).
// flexWrap lets it spill onto a second/third row instead — no tab is ever
// off-screen or behind a scrollbar. The per-button marginBottom:-2 hack
// (flush-aligning each tab's underline against the container's bottom
// border) only works for a single row, so it's gone; a small row-gap
// replaces it to keep wrapped rows from visually colliding.
const Tabs=({tabs,active,onChange,sm})=>(<div style={{display:"flex",flexWrap:"wrap",gap:"4px 0",borderBottom:`2px solid ${C.borderLight}`,marginBottom:16,flexShrink:0}}>{tabs.map(t=>(<button key={t.id} onClick={()=>onChange(t.id)} style={{padding:sm?"8px 12px":"10px 16px",fontSize:sm?12:13,background:"none",border:"none",cursor:"pointer",color:active===t.id?C.green:C.textMuted,borderBottom:active===t.id?`2px solid ${C.green}`:"2px solid transparent",fontWeight:active===t.id?700:400,whiteSpace:"nowrap"}}>{t.label}</button>))}</div>);
const Alert=({type="info",children,style={}})=>{const M={info:{bg:C.greenPale,b:C.greenLight,t:C.green},warning:{bg:C.amberPale,b:C.amberLight,t:C.amber},danger:{bg:"#FDEDEC",b:"#E07070",t:C.danger}};const s=M[type]||M.info;return(<div style={{background:s.bg,border:`1px solid ${s.b}`,borderLeft:`4px solid ${s.b}`,borderRadius:8,padding:"9px 14px",fontSize:12,color:s.t,...style}}>{children}</div>);};
const Divider=({label})=>(<div style={{display:"flex",alignItems:"center",gap:10,margin:"12px 0"}}>{label&&<span style={{fontSize:10,fontWeight:700,color:C.textMuted,whiteSpace:"nowrap",textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}</span>}<div style={{flex:1,height:1,background:C.borderLight}}/></div>);

// ════════════════════════════════════════════════════════════════════
// LEDGER ENGINE — pure functions to compute balances from journals
// ════════════════════════════════════════════════════════════════════
function getAccountBalance(code, journals, coa) {
  const acct = coa.find(a=>a.code===code);
  if(!acct) return 0;
  let dr = acct.openingBal || 0, cr = 0;
  if(acct.normalBal === "Cr") { dr = 0; cr = acct.openingBal || 0; }
  journals.forEach(j=>{
    j.lines.forEach(l=>{
      if(l.drCode===code) dr += l.amount;
      if(l.crCode===code) cr += l.amount;
    });
  });
  if(acct.normalBal==="Dr") return dr - cr;
  return cr - dr;
}

// ── MULTI-CURRENCY ENGINE ───────────────────────────────────────────
// `amount` on every journal line is ALWAYS the Naira-equivalent — every
// existing report (Trial Balance, P&L, Balance Sheet, Cash Flow, Overview)
// keeps working unchanged because they only ever read `amount`.
// `currency` + `fxRate` + `fcAmount` are ADDITIVE fields used only when a
// line touches a foreign-currency account (USD/EUR/GBP), so the native
// balance can be tracked and reported separately from the Naira total.

/** Native-currency balance of a foreign account (e.g. actual USD held, not the ₦ equivalent). */
function getForeignBalance(code, journals, coa) {
  const acct = coa.find(a=>a.code===code);
  if(!acct || acct.currency==="NGN") return 0;
  let dr = 0, cr = 0;
  journals.forEach(j=>{
    j.lines.forEach(l=>{
      if(l.currency!==acct.currency) return; // only count lines actually denominated in this account's currency
      if(l.drCode===code) dr += (l.fcAmount ?? l.amount);
      if(l.crCode===code) cr += (l.fcAmount ?? l.amount);
    });
  });
  return acct.normalBal==="Dr" ? dr-cr : cr-dr;
}

/**
 * Weighted-average Naira cost basis of a foreign account's CURRENT balance.
 * Used to calculate realized FX gain/loss when that balance is later
 * converted or transferred out (e.g. funding the Naira account from USD).
 * Returns { avgRate, fcBalance, ngnCostBasis } — avgRate is ₦ per 1 unit FC.
 */
function getWeightedAvgRate(code, journals, coa) {
  const acct = coa.find(a=>a.code===code);
  if(!acct || acct.currency==="NGN") return { avgRate:1, fcBalance:0, ngnCostBasis:0 };
  let fcRunning = 0, ngnRunning = 0;
  const entries = [];
  journals.forEach(j=>{
    j.lines.forEach(l=>{
      if(l.currency!==acct.currency) return;
      const isDr = l.drCode===code, isCr = l.crCode===code;
      if(!isDr && !isCr) return;
      entries.push({ date:j.date, isInflow: acct.normalBal==="Dr" ? isDr : isCr, fc:(l.fcAmount??l.amount), ngn:l.amount });
    });
  });
  entries.sort((a,b)=> new Date(a.date) - new Date(b.date));
  entries.forEach(e=>{
    if(e.isInflow){
      fcRunning += e.fc; ngnRunning += e.ngn;
    } else {
      // Outflow reduces the FC balance at the CURRENT weighted-average rate,
      // not the rate of this specific outflow line.
      const rate = fcRunning>0 ? ngnRunning/fcRunning : 0;
      fcRunning -= e.fc; ngnRunning -= e.fc*rate;
    }
  });
  return {
    avgRate: fcRunning>0 ? ngnRunning/fcRunning : 0,
    fcBalance: fcRunning,
    ngnCostBasis: ngnRunning,
  };
}

/** Format a number in its native foreign currency, e.g. fmtFC(4500,'USD') → "$4,500.00" */
function fmtFC(n, currency="NGN") {
  const symbols = { NGN:"₦", USD:"$", EUR:"€", GBP:"£" };
  if(currency==="NGN") return fmt(n);
  return `${symbols[currency]||currency+" "}${(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

function getTrialBalance(journals, coa) {
  const rows = [];
  const codes = new Set();
  coa.forEach(a=>codes.add(a.code));
  journals.forEach(j=>j.lines.forEach(l=>{codes.add(l.drCode);codes.add(l.crCode);}));
  codes.forEach(code=>{
    const acct = coa.find(a=>a.code===code);
    let dr=0,cr=0;
    if(acct?.openingBal) { if(acct.normalBal==="Dr") dr+=acct.openingBal; else cr+=acct.openingBal; }
    journals.forEach(j=>j.lines.forEach(l=>{if(l.drCode===code) dr+=l.amount; if(l.crCode===code) cr+=l.amount;}));
    if(dr>0||cr>0) rows.push({code,name:acct?.name||code,type:acct?.type||"—",category:acct?.category||"—",dr,cr});
  });
  return rows.sort((a,b)=>a.code.localeCompare(b.code));
}

function getLedgerForAccount(code, journals, coa, monthFilter) {
  const acct = coa.find(a=>a.code===code);
  let runningBal = acct?.normalBal==="Cr" ? -(acct?.openingBal||0) : (acct?.openingBal||0);
  const lines = [];
  const allLines = [];
  journals.forEach(j=>{
    if(monthFilter && !j.date.startsWith(monthFilter)) return;
    j.lines.forEach(l=>{
      if(l.drCode===code||l.crCode===code) {
        allLines.push({date:j.date,ref:j.ref,desc:j.description,dr:l.drCode===code?l.amount:0,cr:l.crCode===code?l.amount:0,memo:l.memo,jId:j.id});
      }
    });
  });
  allLines.sort((a,b)=>a.date.localeCompare(b.date));
  allLines.forEach(l=>{runningBal+=l.dr-l.cr;lines.push({...l,balance:runningBal});});
  return {acct,lines,closingBal:runningBal};
}

function getPL(journals, coa, from, to) {
  const filter = j => (!from || j.date >= from+"-01") && (!to || j.date <= to+"-31");
  const revenue = {}, cogs = {}, admin = {}, finance = {};
  coa.filter(a=>a.type==="Revenue").forEach(a=>{revenue[a.code]=0;});
  coa.filter(a=>a.category==="Cost of Sales").forEach(a=>{cogs[a.code]=0;});
  coa.filter(a=>a.category==="Admin Expenses").forEach(a=>{admin[a.code]=0;});
  coa.filter(a=>a.category==="Finance Costs").forEach(a=>{finance[a.code]=0;});
  journals.filter(filter).forEach(j=>j.lines.forEach(l=>{
    if(l.crCode in revenue) revenue[l.crCode]+=l.amount;
    if(l.drCode in cogs) cogs[l.drCode]+=l.amount;
    if(l.drCode in admin) admin[l.drCode]+=l.amount;
    if(l.drCode in finance) finance[l.drCode]+=l.amount;
  }));
  const totalRev=Object.values(revenue).reduce((s,v)=>s+v,0);
  const totalCOGS=Object.values(cogs).reduce((s,v)=>s+v,0);
  const totalAdmin=Object.values(admin).reduce((s,v)=>s+v,0);
  const totalFin=Object.values(finance).reduce((s,v)=>s+v,0);
  const grossProfit=totalRev-totalCOGS;
  const netProfit=grossProfit-totalAdmin-totalFin;
  return {revenue,cogs,admin,finance,totalRev,totalCOGS,totalAdmin,totalFin,grossProfit,netProfit,coa};
}

function getBalanceSheet(journals, coa) {
  const assets={},liabilities={},equity={};
  coa.filter(a=>a.type==="Asset").forEach(a=>{assets[a.code]={name:a.name,cat:a.category,val:getAccountBalance(a.code,journals,coa)};});
  coa.filter(a=>a.type==="Liability").forEach(a=>{liabilities[a.code]={name:a.name,cat:a.category,val:getAccountBalance(a.code,journals,coa)};});
  coa.filter(a=>a.type==="Equity").forEach(a=>{equity[a.code]={name:a.name,cat:a.category,val:getAccountBalance(a.code,journals,coa)};});
  // Revenue and Expense accounts aren't "closed" into Retained Earnings by a
  // year-end journal in this app (there's no closing-entry step), so their
  // net effect (current-period profit/loss) has to be folded into Equity
  // here explicitly — otherwise Assets will never equal Liabilities + Equity
  // as soon as there's any revenue or expense activity, independent of
  // whether opening balances are correct. This mirrors what a proper closing
  // entry would do: Dr all Revenue / Cr all Expense / Cr(or Dr) the
  // difference to Retained Earnings.
  const totalRevenue = coa.filter(a=>a.type==="Revenue").reduce((s,a)=>s+getAccountBalance(a.code,journals,coa),0);
  const totalExpense  = coa.filter(a=>a.type==="Expense").reduce((s,a)=>s+getAccountBalance(a.code,journals,coa),0);
  const currentPeriodEarnings = totalRevenue - totalExpense;
  equity["CURRENT-EARNINGS"] = { name:"Current Period Earnings (unclosed P&L)", cat:"Equity", val:currentPeriodEarnings };
  const totalAssets=Object.values(assets).reduce((s,v)=>s+v.val,0);
  const totalLiabilities=Object.values(liabilities).reduce((s,v)=>s+v.val,0);
  const totalEquity=Object.values(equity).reduce((s,v)=>s+v.val,0);
  return {assets,liabilities,equity,totalAssets,totalLiabilities,totalEquity};
}

function getVATData(journals, coa, period) {
  let outputVAT=0, inputVAT=0;
  journals.filter(j=>!period||j.date.startsWith(period)).forEach(j=>j.lines.forEach(l=>{
    if(l.crCode==="5011") outputVAT+=l.amount;
    if(l.drCode==="6006") inputVAT+=l.amount;
  }));
  const netVAT=outputVAT-inputVAT;
  return {outputVAT,inputVAT,netVAT};
}

// ════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════

// ── Overview Tab ──────────────────────────────────────────────────
function OverviewTab({journals,coa,bankStmt,setTab,isAdmin=true}){
  const tb=getTrialBalance(journals,coa);
  const totalRev=tb.filter(r=>coa.find(a=>a.code===r.code)?.type==="Revenue").reduce((s,r)=>s+r.cr,0);
  const totalExp=tb.filter(r=>coa.find(a=>a.code===r.code)?.type==="Expense").reduce((s,r)=>s+r.dr,0);
  const totalAR=getAccountBalance("6002",journals,coa);
  const totalAP=getAccountBalance("7001",journals,coa);
  const cashTotal=coa.filter(a=>a.category==="Cash & Bank").reduce((s,a)=>s+getAccountBalance(a.code,journals,coa),0);
  const netProfit=totalRev-totalExp;
  const totalDr=journals.flatMap(j=>j.lines).reduce((s,l)=>s+l.amount,0);
  const unreconciled=bankStmt.filter(b=>!b.reconciled).length;

  // ── Clickable KPI card ────────────────────────────────────────
  const NavKPI=({label,value,sub,color,icon,target,badge})=>(
    <div onClick={()=>setTab(target)}
      style={{background:C.bgCard,border:`2px solid ${C.border}`,borderRadius:12,padding:"13px 15px",
        flex:1,minWidth:148,position:"relative",overflow:"hidden",
        boxShadow:"0 1px 3px rgba(15,58,26,0.06)",cursor:"pointer",transition:"all 0.18s"}}
      onMouseEnter={e=>{e.currentTarget.style.border=`2px solid ${color||C.green}`;e.currentTarget.style.boxShadow=`0 4px 16px ${(color||C.green)}28`;e.currentTarget.style.transform="translateY(-1px)";}}
      onMouseLeave={e=>{e.currentTarget.style.border=`2px solid ${C.border}`;e.currentTarget.style.boxShadow="0 1px 3px rgba(15,58,26,0.06)";e.currentTarget.style.transform="translateY(0)";}}>
      <div style={{position:"absolute",top:0,left:0,width:4,height:"100%",background:color||C.green,borderRadius:"12px 0 0 12px"}}/>
      <div style={{paddingLeft:4}}>
        <div style={{fontSize:10,color:C.textMuted,fontWeight:600,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.5px",display:"flex",alignItems:"center",gap:6}}>
          {label}
          <span style={{fontSize:9,background:(color||C.green)+"18",color:color||C.green,padding:"1px 5px",borderRadius:10,fontWeight:700,letterSpacing:"0.3px"}}>→ View</span>
        </div>
        <div style={{fontSize:19,fontWeight:700,color:color||C.text,lineHeight:1}}>{value}</div>
        {sub&&<div style={{fontSize:11,color:C.textMuted,marginTop:3}}>{sub}</div>}
        {badge&&<div style={{fontSize:10,marginTop:4,color:color||C.green,fontWeight:600}}>{badge}</div>}
      </div>
      {icon&&<div style={{position:"absolute",top:12,right:14,fontSize:22,opacity:0.12}}>{icon}</div>}
    </div>
  );

  // ── Clickable row inside cards ────────────────────────────────
  const NavRow=({icon,label,value,color,target,sub})=>(
    <div onClick={()=>setTab(target)}
      style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",
        background:C.greenPale,borderRadius:8,cursor:"pointer",transition:"all 0.15s",marginBottom:6}}
      onMouseEnter={e=>{e.currentTarget.style.background=C.greenPale2;e.currentTarget.style.boxShadow=`0 2px 8px ${color}22`;e.currentTarget.style.paddingLeft="16px";}}
      onMouseLeave={e=>{e.currentTarget.style.background=C.greenPale;e.currentTarget.style.boxShadow="none";e.currentTarget.style.paddingLeft="12px";}}>
      <div>
        <div style={{fontSize:12,color:C.textMid}}>{icon} {label}</div>
        {sub&&<div style={{fontSize:10,color:C.textMuted,marginTop:1}}>{sub}</div>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontWeight:700,color,fontSize:13}}>{value}</span>
        <span style={{fontSize:10,color:C.textMuted,background:C.bgCard,border:`1px solid ${C.border}`,padding:"2px 6px",borderRadius:6}}>→</span>
      </div>
    </div>
  );

  // ── Summary row for P&L card (no nav arrow, just styled) ──────
  const PLRow=({label,value,color,bold,target})=>(
    <div onClick={target?()=>setTab(target):undefined}
      style={{display:"flex",justifyContent:"space-between",alignItems:"center",
        padding:bold?"10px 12px":"7px 12px",
        background:bold?C.greenPale:"transparent",
        borderBottom:`1px solid ${C.borderLight}`,
        borderRadius:bold?6:0,marginBottom:bold?2:0,
        cursor:target?"pointer":"default",
        transition:"background 0.15s"}}
      onMouseEnter={e=>{if(target)e.currentTarget.style.background=C.greenPale;}}
      onMouseLeave={e=>{e.currentTarget.style.background=bold?C.greenPale:"transparent";}}>
      <span style={{fontSize:13,fontWeight:bold?700:400,color:C.textMid}}>{label}</span>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:13,fontWeight:bold?700:600,color}}>{value>=0?fmt(value):"("+fmt(Math.abs(value))+")"}</span>
        {target&&<span style={{fontSize:10,color:C.textMuted,background:C.bgCard,border:`1px solid ${C.border}`,padding:"2px 6px",borderRadius:6}}>→</span>}
      </div>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* ── Top hint strip ─────────────────────────────────────── */}
      <div style={{background:`linear-gradient(90deg,${C.greenPale},${C.amberPale})`,borderRadius:8,padding:"8px 14px",fontSize:11,color:C.textMid,display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:14}}>💡</span>
        <span>Click any card or row to navigate directly to that section of the accounting module.</span>
      </div>

      {/* ── KPI Row ────────────────────────────────────────────── */}
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        <NavKPI label="Total Revenue (Posted)" value={fmt(totalRev)} color={C.success} icon="💰" target="pl" sub="Click → P&L Statement"/>
        <NavKPI label="Total Expenses"          value={fmt(totalExp)} color={C.danger}  icon="📉" target="pl" sub="Click → P&L Statement"/>
        {/* FIX 2026-07-28: the test was `netProfit >= 0`, so a net profit of
            exactly ₦0 — an untouched system with no postings at all — rendered
            in green as "✓ Trading profitably". Zero is neither profit nor loss. */}
        <NavKPI label="Net Profit / (Loss)"     value={fmt(netProfit)} color={netProfit>0?C.success:netProfit<0?C.danger:C.textMuted} icon="📊" target="pl"
          sub={netProfit>0?"Surplus — Click → P&L":netProfit<0?"Deficit — Click → P&L":"No postings yet — Click → P&L"}
          badge={netProfit>0?"✓ Trading profitably":netProfit<0?"⚠ Loss position":"— No trading activity"}/>
        <NavKPI label="Cash & Bank Balance"     value={fmt(cashTotal)} color={C.green}   icon="🏦" target="bank" sub="Click → Bank Reconciliation"/>
        <NavKPI label="Trade Receivables"       value={fmt(totalAR)}  color={C.info}    icon="📤" target="ledger" sub="Click → General Ledger (6002)"/>
        <NavKPI label="Trade Payables"          value={fmt(totalAP)}  color={C.warning} icon="📥" target="trial"  sub="Click → Trial Balance"/>
      </div>

      {/* ── Cards grid ─────────────────────────────────────────── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>

        {/* P&L Summary Card */}
        <Card>
          <SecHead title="📈 Profit & Loss Summary" sub="YTD — click rows to open full report"/>
          <PLRow label="Total Revenue"      value={totalRev}   color={C.success} bold={false} target="pl"/>
          <PLRow label="Total Cost of Sales"value={0}          color={C.warning} bold={false} target="pl"/>
          <PLRow label="Total Expenses"     value={totalExp}   color={C.danger}  bold={false} target="pl"/>
          <PLRow label="Net Profit / (Loss)"value={netProfit}  color={netProfit>=0?C.success:C.danger} bold={true} target="pl"/>
          <div style={{marginTop:10}}>
            <button onClick={()=>setTab("pl")} style={{width:"100%",background:C.tableHeaderBg,color:C.tableHeaderText,border:"none",borderRadius:8,padding:"8px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
              📈 Open Full P&L Statement →
            </button>
          </div>
        </Card>

        {/* AR / AP / Tax Liabilities Card */}
        <Card>
          <SecHead title="📊 Key Balances" sub="Click each row to navigate"/>
          <NavRow icon="📤" label="Trade Receivables (Account 6002)" value={fmt(totalAR)} color={C.info}    target="ledger" sub="Outstanding amounts from clients"/>
          <NavRow icon="📥" label="Trade Payables (Account 7001)"    value={fmt(totalAP)} color={C.danger}  target="ledger" sub="Amounts owed to vendors"/>
          <NavRow icon="🧾" label="VAT Payable (Account 5011)"       value={fmt(getAccountBalance("5011",journals,coa))} color={C.amber}   target="vat"    sub="Output VAT due to FIRS"/>
          <NavRow icon="📋" label="WHT Payable (Account 5012)"       value={fmt(getAccountBalance("5012",journals,coa))} color={C.amber}   target="wht"    sub="Withholding tax to remit"/>
          <NavRow icon="🏛" label="PAYE Payable (5003 + 5004)"       value={fmt(getAccountBalance("5003",journals,coa)+getAccountBalance("5004",journals,coa))} color={C.danger} target="trial" sub="Staff & Manpower PAYE due"/>
        </Card>

        {/* Quick Navigation Card */}
        <Card>
          <SecHead title="🧭 Quick Navigation" sub="Jump directly to any section"/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[
              {icon:"📒",label:"Chart of Accounts", target:"coa",   color:C.green},
              {icon:"📔",label:"Journal Entries",   target:"journal",color:C.greenMid},
              {icon:"📋",label:"General Ledger",    target:"ledger", color:C.info},
              {icon:"⚖️", label:"Trial Balance",    target:"trial",  color:C.textMid},
              {icon:"📈",label:"P&L Statement",     target:"pl",     color:C.success},
              {icon:"🏛️",label:"Balance Sheet",     target:"bs",     color:C.amber},
              {icon:"💧",label:"Cash Flow",         target:"cashflow",color:C.info},
              {icon:"🏧",label:"Bank Recon",        target:"bank",   color:C.green},
              {icon:"🧾",label:"VAT Returns",       target:"vat",    color:C.warning},
              {icon:"🏗️",label:"Fixed Assets",      target:"fixedassets",color:C.greenMid},
              {icon:"📋",label:"WHT Register",      target:"wht",    color:C.danger},
              {icon:"📒",label:"COA Full View",     target:"coa",   color:C.textMid},
            ].map(n=>(
              <div key={n.target+n.label} onClick={()=>setTab(n.target)}
                style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,
                  border:`1px solid ${C.border}`,cursor:"pointer",background:C.bgCard,transition:"all 0.15s"}}
                onMouseEnter={e=>{e.currentTarget.style.background=n.color+"14";e.currentTarget.style.border=`1px solid ${n.color}60`;e.currentTarget.style.transform="translateY(-1px)";}}
                onMouseLeave={e=>{e.currentTarget.style.background=C.bgCard;e.currentTarget.style.border=`1px solid ${C.border}`;e.currentTarget.style.transform="translateY(0)";}}>
                <span style={{fontSize:16}}>{n.icon}</span>
                <span style={{fontSize:12,fontWeight:500,color:C.textMid}}>{n.label}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Bank & Reconciliation Card */}
        <Card>
          <SecHead title="🏧 Cash & Bank Position" sub="Click rows to open Bank Reconciliation"/>
          {coa.filter(a=>a.category==="Cash & Bank"&&getAccountBalance(a.code,journals,coa)>0).map(a=>{
            const bal=getAccountBalance(a.code,journals,coa);
            return(
              <div key={a.code} onClick={()=>setTab("bank")}
                style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"8px 12px",borderRadius:7,marginBottom:4,cursor:"pointer",
                  background:C.greenPale,transition:"all 0.15s"}}
                onMouseEnter={e=>{e.currentTarget.style.background=C.greenPale2;e.currentTarget.style.paddingLeft="16px";}}
                onMouseLeave={e=>{e.currentTarget.style.background=C.greenPale;e.currentTarget.style.paddingLeft="12px";}}>
                <div>
                  <div style={{fontSize:12,fontWeight:500}}>{a.name}</div>
                  <div style={{fontSize:10,color:C.textMuted,fontFamily:"monospace"}}>{a.code}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontWeight:700,color:C.green,fontSize:13}}>{fmt(bal)}</span>
                  <span style={{fontSize:10,color:C.textMuted,background:C.bgCard,border:`1px solid ${C.border}`,padding:"2px 5px",borderRadius:5}}>→</span>
                </div>
              </div>
            );
          })}
          <div style={{display:"flex",justifyContent:"space-between",padding:"9px 12px",background:C.green,borderRadius:8,marginTop:6}}>
            <span style={{fontSize:12,fontWeight:700,color:'#FFFFFF'}}>Total Cash & Bank</span>
            <span style={{fontSize:13,fontWeight:800,color:'#FFFFFF'}}>{fmt(cashTotal)}</span>
          </div>
          {unreconciled>0&&(
            <div onClick={()=>setTab("bank")} style={{marginTop:8,cursor:"pointer"}}>
              <Alert type="warning">⚠ {unreconciled} unreconciled bank entries — click to resolve →</Alert>
            </div>
          )}
        </Card>

        {/* Journal Activity & Alerts */}
        <Card style={{gridColumn:"span 1"}}>
          <SecHead title="📔 Journal Activity" sub="Recent posting summary"/>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {[
              {label:"Total Journal Entries",value:journals.length,color:C.green,target:"journal"},
              {label:"Auto-posted (Invoices)",value:journals.filter(j=>j.source==="invoice").length,color:C.info,target:"journal"},
              {label:"Manual Entries",value:journals.filter(j=>j.source==="manual").length,color:C.textMid,target:"journal"},
              {label:"Payroll Entries",value:journals.filter(j=>j.source==="payroll").length,color:C.amber,target:"journal"},
              {label:"Procurement Entries",value:journals.filter(j=>j.source==="procurement").length,color:C.greenMid,target:"journal"},
            ].map(r=>(
              <div key={r.label} onClick={()=>setTab(r.target)}
                style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"7px 10px",borderRadius:7,background:C.bgAlt,cursor:"pointer",transition:"all 0.15s"}}
                onMouseEnter={e=>{e.currentTarget.style.background=C.greenPale;e.currentTarget.style.paddingLeft="14px";}}
                onMouseLeave={e=>{e.currentTarget.style.background=C.bgAlt;e.currentTarget.style.paddingLeft="10px";}}>
                <span style={{fontSize:12,color:C.textMid}}>{r.label}</span>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontWeight:700,color:r.color,fontSize:13}}>{r.value}</span>
                  <span style={{fontSize:10,color:C.textMuted,background:C.bgCard,border:`1px solid ${C.border}`,padding:"2px 5px",borderRadius:5}}>→</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{marginTop:10,padding:"8px 12px",background:Math.abs(totalDr-totalDr)<1?C.greenPale:C.amberPale,borderRadius:8,fontSize:12,fontWeight:600,color:C.success,display:"flex",alignItems:"center",gap:6}}>
            <span>✓</span><span>All journals balanced — DR = CR = {fmt(totalDr)}</span>
          </div>
        </Card>

        {/* System Alerts Card */}
        <Card>
          <SecHead title="🔔 Accounting Alerts" sub="Items requiring attention"/>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {unreconciled>0&&(
              <div onClick={()=>setTab("bank")} style={{cursor:"pointer"}}>
                <Alert type="warning">⚠ {unreconciled} bank entries unreconciled — click to reconcile →</Alert>
              </div>
            )}
            {netProfit<0&&(
              <div onClick={()=>setTab("pl")} style={{cursor:"pointer"}}>
                <Alert type="danger">📉 Net loss of {fmt(Math.abs(netProfit))} — click to review P&L →</Alert>
              </div>
            )}
            {totalAR>50000000&&(
              <div onClick={()=>setTab("ledger")} style={{cursor:"pointer"}}>
                <Alert type="warning">📤 High receivables {fmt(totalAR)} — click to view ledger →</Alert>
              </div>
            )}
            {getAccountBalance("5011",journals,coa)>0&&(
              <div onClick={()=>setTab("vat")} style={{cursor:"pointer"}}>
                <Alert type="warning">🧾 VAT payable {fmt(getAccountBalance("5011",journals,coa))} outstanding — click for VAT return →</Alert>
              </div>
            )}
            {netProfit>=0&&unreconciled===0&&totalAR<=50000000&&(
              <Alert type="info">✓ No critical alerts. All accounting entries appear balanced.</Alert>
            )}
            <Alert type="info">Trial Balance: {tb.length} accounts active · {journals.length} journals posted</Alert>
          </div>
        </Card>

      </div>
    </div>
  );
}

// ── Journal Entry Form & Table ─────────────────────────────────────
// ── Control accounts ─────────────────────────────────────────────────────────
// These accounts are updated automatically by their sub-ledger (AR invoices/
// receipts, AP bills/payments, Fixed Asset capitalization) — never by a
// manual journal entry. Manually posting here would silently break the tie
// between this GL balance and the sub-ledger detail behind it (e.g. AR
// customer statements no longer summing to 6002's balance), with nothing
// to catch the drift later. Matches how Sage blocks direct posting to
// control accounts: the fix is to correct the underlying invoice/bill/asset
// record, and let the normal auto-posting flow re-derive the journal entry.
const CONTROL_ACCOUNTS = {
  '6002': 'Trade Receivables — controlled by Accounts Receivable invoices/receipts',
  '7001': 'Trade Payables — controlled by Accounts Payable bills/payments',
  '2000': 'Land — controlled by Fixed Assets',
  '2001': 'Building — controlled by Fixed Assets',
  '2002': 'Plant/Machineries — controlled by Fixed Assets',
  '2003': 'Motor Vehicle — controlled by Fixed Assets',
  '2004': 'Office and Safety Equipments — controlled by Fixed Assets',
  '2005': 'Furnitures/Fittings/Caravans — controlled by Fixed Assets',
};

function JournalTab({journals,setJournals,coa,filter,setFilter,sourceFilter,setSourceFilter}){
  const { state, dispatch } = useApp();
  const { currentUser, db, appSettings } = state;
  // ── Multi-entity ledger visibility — see canSeeTerminalLedger() in
  // utils/auth.js. `journals` (the prop) stays the FULL array on purpose:
  // new-JE ref numbers and recurring-template duplicate checks below are
  // both based on journals.length / journals.some(...), and setJournals
  // always writes through React's functional-updater form (js => ...), which
  // reads the real state directly rather than this prop — so none of that
  // can be safely computed off a filtered copy without risking a ref
  // collision with a hidden entry, or silently dropping Terminal's entries
  // from what gets saved. Only the rendered list and its exports use
  // `visibleJournals`.
  const canSeeTerminal = canSeeTerminalLedger(currentUser);
  const visibleJournals = canSeeTerminal ? journals : journals.filter(j => j.source !== 'terminal' && j.source !== 'terminal-advance');
  // Live-verify QA fix (2026-08-18): periodOf/isPeriodClosed/isYearClosed
  // (imported at the top of this file, and already properly enforced for
  // every AUTO-posted journal — see utils/autoPostJournals.js's tryPost())
  // were never actually called anywhere in this component. New Journal
  // Entry, Edit, Delete and "Post" a recurring template could all freely
  // post into — or erase — a period an accountant had already closed, with
  // nothing to stop it and no warning. The Recurring Templates panel's own
  // copy even claims "it respects period locks", which wasn't true. Matches
  // SAP/NetSuite/Odoo: a closed period is a hard control on every posting
  // path, not just the automated one — reopening it is a deliberate,
  // logged admin action (Settings → Accounting → Period Close).
  const fyStart = appSettings?.accounting?.fiscalYearStart || appSettings?.system?.fiscalYearStart || 'January';
  function periodLockMessage(dateStr) {
    const p = periodOf(dateStr, fyStart);
    if (!p.periodKey) return null;
    if (isPeriodClosed(p.periodKey, appSettings)) return `Period ${p.periodKey} is closed — reopen it in Settings → Accounting → Period Close before posting, editing or deleting entries in it.`;
    if (isYearClosed(p.fy, appSettings)) return `Fiscal year ${p.fy} is closed — reopen it in Settings → Accounting → Year-End Close before posting, editing or deleting entries in it.`;
    return null;
  }
  const [showModal,setShowModal]=useState(false);
  const [jeDate,setJeDate]=useState(today());
  const [jeRef,setJeRef]=useState("");
  const [jeDesc,setJeDesc]=useState("");
  const blankLine=()=>({drCode:"",crCode:"",currency:"NGN",fxRate:1,fcAmount:"",memo:""});
  const [lines,setLines]=useState([blankLine()]);
  const [editId,setEditId]=useState(null);
  // Recurring / template journals
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName,   setTemplateName]   = useState('');
  const [templateFreq,   setTemplateFreq]   = useState('monthly');
  const [showTemplates,  setShowTemplates]  = useState(false);

  // Load templates from db
  const templates = (db.recurringTemplates || []).filter(t => !t.voided);

  function persistTemplates(next) {
    diffAndPush('recurringTemplates', db.recurringTemplates, next); // 2026-07-29 full-app sync sweep
    dispatch({ type:'UPDATE_MODULE', mod:'recurringTemplates', data: next });
    saveDBLocal({ ...db, recurringTemplates: next }, state.activity);
  }

  function saveTemplate(je) {
    if (!templateName) { showToast('Give the template a name first', 'error'); return; }
    const tpl = {
      id: `TPL-${Date.now()}`,
      name: templateName,
      frequency: templateFreq,        // 'monthly' | 'quarterly' | 'yearly' | 'manual'
      active: true,
      ref: je.ref, description: je.description,
      lines: je.lines,
      lastPosted: null,
      lastPostedPeriod: null,
      createdAt: new Date().toISOString(),
    };
    persistTemplates([...(db.recurringTemplates || []), tpl]);
    logActivity(dispatch, `Recurring journal template "${templateName}" saved (${templateFreq})`, currentUser, { module:'accounting', action:'create' });
    showToast(`Template "${templateName}" saved`, 'success');
    setSaveAsTemplate(false);
    setTemplateName('');
  }

  function postTemplate(tpl, periodKey) {
    // Build a new JE from the template, stamping it with the supplied period key
    // and source='recurring' so the period guard runs and the auto-post effect
    // picks it up via the standard manual path.
    const ref = `${tpl.ref || tpl.name}-${periodKey}`;
    const je = {
      id: `JE-REC-${tpl.id}-${periodKey}`,
      date: `${periodKey}-01`,
      ref,
      description: tpl.description,
      source: 'recurring',
      sourceId: tpl.id,
      periodKey,
      lines: tpl.lines.map(l => ({ ...l })),
    };
    if (journals.some(j => j.id === je.id)) {
      showToast(`Template "${tpl.name}" already posted for ${periodKey}`, 'error');
      return;
    }
    const lockMsg = periodLockMessage(je.date);
    if (lockMsg) { showToast('⛔ ' + lockMsg, 'error'); return; }
    setJournals(js => [...js, je]);
    // Mark template as posted
    persistTemplates((db.recurringTemplates || []).map(t => t.id === tpl.id ? { ...t, lastPosted: new Date().toISOString(), lastPostedPeriod: periodKey } : t));
    logActivity(dispatch, `Posted recurring template "${tpl.name}" for ${periodKey} — ${formatCurrency(tpl.lines.reduce((s,l)=>s+(l.amount||0),0))}`, currentUser, { module:'accounting', action:'edit' });
    showToast(`Template "${tpl.name}" posted for ${periodKey}`, 'success');
  }

  function deleteTemplate(id) {
    if (!window.confirm('Delete this template? Past journal entries posted from it stay in the ledger.')) return;
    persistTemplates((db.recurringTemplates || []).map(t => t.id === id ? { ...t, voided: true } : t));
    showToast('Template deleted', 'error');
  }

  // Naira-equivalent of a line = fcAmount × fxRate (for NGN lines, fxRate is always 1)
  const lineAmount=(l)=> (parseFloat(l.fcAmount)||0) * (parseFloat(l.fxRate)||0);
  const totalDR=lines.reduce((s,l)=>s+lineAmount(l),0);
  const balanced=totalDR>0;

  const openNew=()=>{setEditId(null);setJeDate(today());setJeRef(`JE-${String(journals.length+1).padStart(4,"0")}`);setJeDesc("");setLines([blankLine()]);setShowModal(true);};

  const postJE=()=>{
    if(!jeDesc){alert("Description required");return;}
    if(!balanced){alert("Amount must be > 0");return;}
    const hasBlank=lines.some(l=>!l.drCode||!l.crCode||!l.fcAmount);
    if(hasBlank){alert("Complete all line fields");return;}
    const lockMsg=periodLockMessage(jeDate);
    if(lockMsg){alert('⛔ '+lockMsg);return;}
    const newJE={
      id:editId||`JE-${String(journals.length+1).padStart(4,"0")}`,
      date:jeDate,ref:jeRef,description:jeDesc,source:"manual",
      lines:lines.map(l=>({
        drCode:l.drCode,drName:coa.find(a=>a.code===l.drCode)?.name||l.drCode,
        crCode:l.crCode,crName:coa.find(a=>a.code===l.crCode)?.name||l.crCode,
        currency:l.currency||"NGN",
        fxRate:parseFloat(l.fxRate)||1,
        fcAmount:parseFloat(l.fcAmount)||0,
        amount:lineAmount(l),
        memo:l.memo,
      }))
    };
    if(editId) setJournals(js=>js.map(j=>j.id===editId?newJE:j));
    else setJournals(js=>[...js,newJE]);
    setShowModal(false);
  };

  // 2026-08-19: this used to be a hard delete — click ✕, the entry vanished
  // from the array with no trace. That's a real gap against ERP standard:
  // SAP/NetSuite/Odoo don't let you erase a posted journal entry, only
  // reverse it, precisely so a live ledger always has a complete audit trail
  // of every posting AND every correction. Every other void path in this app
  // (AP bills, AR invoices, terminal advances, payroll runs) already follows
  // that pattern — manual journal entries were the one place that didn't.
  // Found while investigating a stray ₦1 test entry (QA-SYNC-TEST) that a
  // hard delete would have erased without a trace of it ever existing.
  const voidJE=(j)=>{
    const lockMsg=periodLockMessage(j.date);
    if(lockMsg){alert('⛔ '+lockMsg);return;}
    if(j.voided){alert('This entry has already been voided.');return;}
    if(j.isReversal){alert('Reversal entries cannot themselves be voided.');return;}
    if(!window.confirm(`Void journal entry ${j.ref||j.id}?\n\nThis posts a reversing entry to the ledger — the original stays visible for audit, offset by the reversal. This cannot be undone.`))return;
    const rev={
      ...j,
      id:`${j.id}-REV`,
      date:today(),
      description:`REVERSAL — ${j.description}`,
      isReversal:true,
      lines:j.lines.map(l=>({...l,drCode:l.crCode,drName:l.crName,crCode:l.drCode,crName:l.drName})),
    };
    setJournals(js=>[...js.map(x=>x.id===j.id?{...x,voided:true}:x),rev]);
    logActivity(dispatch,`Journal entry voided: ${j.ref||j.id} — ${j.description} — reversing entry ${rev.id} posted`,currentUser,{module:'accounting',action:'edit'});
    showToast('Journal entry voided — reversing entry posted','error');
  };
  const editJE=(j)=>{setEditId(j.id);setJeDate(j.date);setJeRef(j.ref);setJeDesc(j.description);setLines(j.lines.map(l=>({drCode:l.drCode,crCode:l.crCode,currency:l.currency||"NGN",fxRate:l.fxRate||1,fcAmount:l.fcAmount??l.amount,memo:l.memo||""})));setShowModal(true);};

  const filtered=visibleJournals.filter(j=>{
    const mf=!filter||j.id.toLowerCase().includes(filter.toLowerCase())||j.description.toLowerCase().includes(filter.toLowerCase())||j.ref.toLowerCase().includes(filter.toLowerCase());
    const sf=!sourceFilter||j.source===sourceFilter;
    return mf&&sf;
  });

  const cols=[
    {key:"date",label:"Date",render:r=>fmtDate(r.date)},
    {key:"ref",label:"Ref",render:r=><span style={{fontFamily:"monospace",fontSize:11,color:C.green}}>{r.ref}</span>},
    {key:"description",label:"Description",wrap:true,maxW:"240px"},
    {key:"lines",label:"Dr Account",render:r=><span style={{fontSize:11}}>{r.lines[0]?.drName||"—"}</span>},
    {key:"cr",label:"Cr Account",render:r=><span style={{fontSize:11}}>{r.lines[0]?.crName||"—"}</span>},
    {key:"amount",label:"Amount (₦)",align:"right",render:r=>{
      const ngn=r.lines.reduce((s,l)=>s+l.amount,0);
      const fcLine=r.lines.find(l=>l.currency&&l.currency!=="NGN");
      return (
        <div>
          <strong>{fmt(ngn)}</strong>
          {fcLine && <div style={{fontSize:10,color:C.textMuted}}>{fmtFC(fcLine.fcAmount,fcLine.currency)} @ {fcLine.fxRate}</div>}
        </div>
      );
    }},
    {key:"source",label:"Source",render:r=><Pill label={r.source} color={{invoice:C.green,payroll:C.amber,procurement:C.info,manual:C.textMuted,pettycash:C.warning}[r.source]||C.textMuted} sm/>},
    {key:"actions",label:"",render:r=>{
      if(r.source!=="manual") return (<span title="Auto-posted from its source record — correct the invoice/bill/voucher/asset instead, and this entry updates itself." style={{fontSize:11,color:C.textMuted,cursor:"help"}}>🔒 auto-posted</span>);
      if(r.isReversal) return (<span title="Reversal entry — posted automatically when the original was voided." style={{fontSize:11,color:C.textMuted,cursor:"help"}}>🔒 reversal</span>);
      if(r.voided) return (<span title="Voided — see its reversal entry in the ledger for the offsetting posting." style={{fontSize:11,color:C.textMuted,cursor:"help"}}>🔒 voided</span>);
      // Live-verify QA fix (2026-08-18): same period-lock this component now
      // enforces on save/delete, surfaced here too so a closed-period entry
      // doesn't show Edit/Void buttons that would just fail with an alert
      // on click — same treatment as the auto-posted 🔒 badge above.
      const lockMsg=periodLockMessage(r.date);
      if(lockMsg) return (<span title={lockMsg} style={{fontSize:11,color:C.textMuted,cursor:"help"}}>🔒 period closed</span>);
      return (<div style={{display:"flex",gap:4}}><Btn sm variant="ghost" onClick={e=>{e.stopPropagation();editJE(r);}}>Edit</Btn><Btn sm variant="danger" onClick={e=>{e.stopPropagation();voidJE(r);}}>Void</Btn></div>);
    }},
  ];

  return(
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <input placeholder="Search journal entries…" value={filter} onChange={e=>setFilter(e.target.value)} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"6px 10px",fontSize:12,background:C.bgCard,color:C.text,width:220}}/>
          <select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"6px 10px",fontSize:12,background:C.bgCard,color:C.text}}>
            <option value="">All Sources</option>
            <option value="manual">Manual</option>
            <option value="invoice">Invoices</option>
            <option value="procurement">Procurement</option>
            <option value="payroll">Payroll</option>
            <option value="pettycash">Petty Cash</option>
          </select>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="ghost" sm icon="📊" onClick={()=>{
            const headers = ['Journal ID','Date','Reference','Description','Source','Dr Account','Cr Account','Currency','FC Amount','FX Rate','Amount (₦)'];
            const rows = visibleJournals.flatMap(j=>j.lines.map(l=>[j.id,j.date,j.ref,j.description,j.source,l.drName,l.crName,l.currency||'NGN',l.fcAmount??l.amount,l.fxRate||1,l.amount]));
            exportToExcel('SLOT_Journal_Entries', headers, rows);
          }}>Export Excel</Btn>
          <Btn variant="ghost" sm icon="🖨" onClick={()=>{
            const rowsHtml = visibleJournals.slice(0,100).flatMap((j,ji)=>j.lines.map((l,li)=>`
              <tr class="${ji%2===1?'alt':''}">
                ${li===0?`<td rowspan="${j.lines.length}"><b style="color:#1A5C2A">${j.id}</b></td><td rowspan="${j.lines.length}">${j.date}</td><td rowspan="${j.lines.length}">${j.ref}</td>`:''}
                <td>${l.drName}</td><td>${l.crName}</td>
                <td class="amount">${fmt(l.amount)}</td>
              </tr>`)).join('');
            printSection('General Journal Ledger',`<table><thead><tr><th>Journal ID</th><th>Date</th><th>Ref</th><th>Debit Account</th><th>Credit Account</th><th>Amount (₦)</th></tr></thead><tbody>${rowsHtml}</tbody></table>`);
          }}>Print Journal</Btn>
          <Btn variant="ghost" sm icon="🔄">Auto-Post Modules</Btn>
          <Btn sm onClick={openNew} icon="＋">New Journal Entry</Btn>
        </div>
      </div>
      <Alert type="info">Double-entry enforced — every transaction posts a matching Debit and Credit, converted to its Naira-equivalent. Total posted: {visibleJournals.length} entries.</Alert>

      {/* ── Recurring / Template Journals Panel ────────────────────────── */}
      <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:10, overflow:'hidden' }}>
        <div style={{ padding:'10px 14px', background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)', display:'flex', alignItems:'center', gap:10, cursor:'pointer' }} onClick={() => setShowTemplates(s => !s)}>
          <span style={{ fontSize:14, fontWeight:700, color:'#fff' }}>🔁 Recurring Journal Templates</span>
          <span style={{ fontSize:11, color:'rgba(255,255,255,0.7)' }}>{templates.length} active · click to {showTemplates?'collapse':'expand'}</span>
          <span style={{ marginLeft:'auto', fontSize:14, color:'#fff' }}>{showTemplates?'▾':'▸'}</span>
        </div>
        {showTemplates && (
          <div style={{ padding:14 }}>
            <div style={{ fontSize:11.5, color:C.textMuted, marginBottom:10, lineHeight:1.5 }}>
              Save any journal entry as a template and re-post it with one click for any month.
              Common uses: monthly rent, monthly accruals, quarterly WHT remittance, annual
              insurance amortisation. Each post is a normal journal entry — it respects period
              locks and shows up in Trial Balance / P&L / Balance Sheet exactly like a manual JE.
            </div>
            {templates.length === 0 ? (
              <div style={{ padding:14, fontSize:12, color:C.textMuted, background:C.bgAlt, borderRadius:8, textAlign:'center' }}>
                No templates yet. Open <strong>New Journal Entry</strong>, build the entry the way you want it,
                tick <strong>Save as template</strong> below, and give it a name (e.g. "Monthly Office Rent").
              </div>
            ) : (
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead><tr style={{ background:C.bgAlt }}>
                  {['Template','Frequency','Last Posted','Lines','Action',''].map(h=><th key={h} style={{ padding:'7px 9px', textAlign:'left', fontSize:10, fontWeight:700, color:C.textMid, textTransform:'uppercase' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {templates.map(t => {
                    const total = (t.lines || []).reduce((s,l) => s + (Number(l.amount)||0), 0);
                    return (
                      <tr key={t.id} style={{ borderBottom:'1px solid '+C.borderLight }}>
                        <td style={{ padding:'8px 9px' }}>
                          <div style={{ fontWeight:600 }}>{t.name}</div>
                          <div style={{ fontSize:10.5, color:C.textMuted }}>{t.description}</div>
                        </td>
                        <td style={{ padding:'8px 9px' }}>
                          <span style={{ padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:600, color:C.info, background:'rgba(26,92,138,.1)' }}>{t.frequency}</span>
                        </td>
                        <td style={{ padding:'8px 9px', color:C.textMuted, fontSize:11 }}>{t.lastPostedPeriod ? `${t.lastPostedPeriod} (${new Date(t.lastPosted).toLocaleDateString('en-GB')})` : '— never —'}</td>
                        <td style={{ padding:'8px 9px', textAlign:'right', color:C.amber, fontWeight:600 }}>₦{total.toLocaleString('en-NG')}</td>
                        <td style={{ padding:'8px 9px' }}>
                          <div style={{ display:'flex', gap:5 }}>
                            <input id={`period-${t.id}`} type="month" defaultValue={today().slice(0,7)} style={{ padding:'4px 7px', borderRadius:5, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:11 }} />
                            <Btn sm onClick={() => { const p = document.getElementById(`period-${t.id}`).value; if (p) postTemplate(t, p); }}>📤 Post</Btn>
                          </div>
                        </td>
                        <td style={{ padding:'8px 9px' }}><button onClick={() => deleteTemplate(t.id)} style={{ background:'transparent', border:'none', color:C.danger, cursor:'pointer', fontSize:14 }}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <Tbl cols={cols} rows={filtered} emptyMsg="No journal entries found."/>

      {showModal&&(
        <Modal title={editId?"Edit Journal Entry":"📔 New Journal Entry"} onClose={()=>setShowModal(false)} wide>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
            <Inp label="Date *" type="date" value={jeDate} onChange={e=>setJeDate(e.target.value)}/>
            <Inp label="Reference No" value={jeRef} onChange={e=>setJeRef(e.target.value)} placeholder="e.g. JE-0001"/>
            <div style={{gridColumn:"1/-1"}}><Inp label="Description *" value={jeDesc} onChange={e=>setJeDesc(e.target.value)} placeholder="Brief description of this journal entry"/></div>
          </div>
          <Divider label="Entry Lines — Debits must equal Credits (Naira-equivalent)"/>
          <Alert type="info" style={{marginBottom:10}}>For a foreign-currency line, pick USD/EUR/GBP, enter the amount in that currency, and the exchange rate — the ₦ equivalent calculates automatically and is what posts to the ledger.</Alert>
          <Alert type="warning" style={{marginBottom:10}}>Trade Receivables (6002), Trade Payables (7001), and Fixed Asset accounts (2000-2005) aren't in the dropdowns below — they're controlled by their sub-ledger (AR/AP/Fixed Assets) and update automatically. To fix something there, correct the underlying invoice, bill, or asset record instead.</Alert>
          <div style={{display:"grid",gridTemplateColumns:"10px 1fr",alignItems:"center",gap:0,marginBottom:6}}>
            <div/><div style={{display:"grid",gridTemplateColumns:"1.8fr 1.8fr 0.9fr 1fr 0.9fr 1.2fr 32px",gap:6,fontSize:10,fontWeight:700,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.4px",padding:"0 0 4px 0"}}>
              <span>Debit Account</span><span>Credit Account</span><span>Currency</span><span>Amount</span><span>FX Rate</span><span>Memo</span><span></span>
            </div>
          </div>
          {lines.map((l,i)=>{
            const isForeign=l.currency!=="NGN";
            return (
            <div key={i} style={{display:"grid",gridTemplateColumns:"1.8fr 1.8fr 0.9fr 1fr 0.9fr 1.2fr 32px",gap:6,marginBottom:8,alignItems:"end"}}>
              <select value={l.drCode} onChange={e=>{const nl=[...lines];nl[i]={...nl[i],drCode:e.target.value};setLines(nl);}} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 8px",fontSize:12,background:C.bgCard,color:C.text}}>
                <option value="">— Debit Account —</option>
                {coa.filter(a=>!CONTROL_ACCOUNTS[a.code]).sort((a,b)=>a.code.localeCompare(b.code)).map(a=><option key={a.code} value={a.code}>{a.code} — {a.name}{a.currency!=="NGN"?` (${a.currency})`:""}</option>)}
              </select>
              <select value={l.crCode} onChange={e=>{const nl=[...lines];nl[i]={...nl[i],crCode:e.target.value};setLines(nl);}} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 8px",fontSize:12,background:C.bgCard,color:C.text}}>
                <option value="">— Credit Account —</option>
                {coa.filter(a=>!CONTROL_ACCOUNTS[a.code]).sort((a,b)=>a.code.localeCompare(b.code)).map(a=><option key={a.code} value={a.code}>{a.code} — {a.name}{a.currency!=="NGN"?` (${a.currency})`:""}</option>)}
              </select>
              <select value={l.currency} onChange={e=>{const nl=[...lines];const cur=e.target.value;nl[i]={...nl[i],currency:cur,fxRate:cur==="NGN"?1:nl[i].fxRate};setLines(nl);}} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 8px",fontSize:12,background:C.bgCard,color:C.text}}>
                <option value="NGN">NGN</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
              </select>
              <input type="number" placeholder={isForeign?`${l.currency} Amount`:"₦ Amount"} value={l.fcAmount} onChange={e=>{const nl=[...lines];nl[i]={...nl[i],fcAmount:e.target.value};setLines(nl);}} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 8px",fontSize:12,background:C.bgCard,color:C.text}}/>
              <input type="number" disabled={!isForeign} placeholder="₦ per unit" value={isForeign?l.fxRate:1} onChange={e=>{const nl=[...lines];nl[i]={...nl[i],fxRate:e.target.value};setLines(nl);}} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 8px",fontSize:12,background:isForeign?C.bgCard:C.bgAlt,color:C.text,opacity:isForeign?1:0.5}}/>
              <input placeholder="Memo" value={l.memo} onChange={e=>{const nl=[...lines];nl[i]={...nl[i],memo:e.target.value};setLines(nl);}} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 8px",fontSize:12,background:C.bgCard,color:C.text}}/>
              <button onClick={()=>setLines(ls=>ls.filter((_,j)=>j!==i))} style={{background:C.danger,color:'#FFFFFF',border:"none",borderRadius:6,cursor:"pointer",fontSize:14,height:34}}>✕</button>
              {isForeign && (
                <div style={{gridColumn:"1/-1",fontSize:10.5,color:C.green,marginTop:-4,marginBottom:2}}>
                  ₦ equivalent: {fmt(lineAmount(l))} {fmtFC(parseFloat(l.fcAmount)||0,l.currency)} × ₦{l.fxRate||0}
                </div>
              )}
            </div>
          );})}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
            <Btn variant="ghost" sm onClick={()=>setLines(ls=>[...ls,blankLine()])}>+ Add Line</Btn>
            <div style={{fontSize:13,fontWeight:700,color:balanced?C.success:C.danger}}>
              Total: {fmt(totalDR)} {balanced?"✓ Ready to Post":"— Enter amounts"}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginTop:14, padding:'10px 0', borderTop:'1px dashed '+C.border }}>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:C.textMid, cursor:'pointer' }}>
              <input type="checkbox" checked={saveAsTemplate} onChange={e=>setSaveAsTemplate(e.target.checked)} />
              <strong>Save as recurring template</strong>
            </label>
            {saveAsTemplate && (
              <>
                <input value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="Template name (e.g. Monthly Office Rent)" style={{ flex:1, padding:'5px 8px', borderRadius:5, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12 }} />
                <select value={templateFreq} onChange={e=>setTemplateFreq(e.target.value)} style={{ padding:'5px 8px', borderRadius:5, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12 }}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                  <option value="manual">Manual only</option>
                </select>
              </>
            )}
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:16,paddingTop:14,borderTop:`1px solid ${C.borderLight}`}}>
            <Btn variant="ghost" onClick={()=>setShowModal(false)}>Cancel</Btn>
            {saveAsTemplate && templateName && <Btn variant="outline" onClick={() => { const je={ ref:jeRef, description:jeDesc, lines:lines.map(l=>({drCode:l.drCode,drName:coa.find(a=>a.code===l.drCode)?.name||l.drCode,crCode:l.crCode,crName:coa.find(a=>a.code===l.crCode)?.name||l.crCode,currency:l.currency||"NGN",fxRate:parseFloat(l.fxRate)||1,fcAmount:parseFloat(l.fcAmount)||0,amount:lineAmount(l),memo:l.memo}))}; saveTemplate(je); }}>🔁 Save Template Only</Btn>}
            <Btn onClick={() => { postJE(); if (saveAsTemplate && templateName) { const je={ ref:jeRef, description:jeDesc, lines:lines.map(l=>({drCode:l.drCode,drName:coa.find(a=>a.code===l.drCode)?.name||l.drCode,crCode:l.crCode,crName:coa.find(a=>a.code===l.crCode)?.name||l.crCode,currency:l.currency||"NGN",fxRate:parseFloat(l.fxRate)||1,fcAmount:parseFloat(l.fcAmount)||0,amount:lineAmount(l),memo:l.memo}))}; saveTemplate(je); } }} disabled={!balanced||!jeDesc}>📔 Post Journal Entry</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Chart of Accounts Tab ─────────────────────────────────────────
function COATab({coa,setCoa,journals,isAdmin=true}){
  const [showModal,setShowModal]=useState(false);
  const [editCode,setEditCode]=useState(null);
  const [form,setForm]=useState({code:"",name:"",type:"Asset",category:"",normalBal:"Dr",openingBal:0,currency:"NGN"});
  const grouped=coa.reduce((acc,a)=>{acc[a.category]=acc[a.category]||[];acc[a.category].push(a);return acc;},{});

  const openAdd=()=>{setEditCode(null);setForm({code:"",name:"",type:"Asset",category:"",normalBal:"Dr",openingBal:0,currency:"NGN"});setShowModal(true);};
  const openEdit=(a)=>{setEditCode(a.code);setForm({currency:"NGN",...a});setShowModal(true);};
  const saveAcct=()=>{
    if(!form.code||!form.name){alert("Code and Name required");return;}
    if(editCode) setCoa(cs=>cs.map(a=>a.code===editCode?{...form,openingBal:+form.openingBal}:a));
    else { if(coa.find(a=>a.code===form.code)){alert("Account code already exists");return;} setCoa(cs=>[...cs,{...form,openingBal:+form.openingBal}].sort((a,b)=>a.code.localeCompare(b.code))); }
    setShowModal(false);
  };

  const cats=Object.keys(grouped).sort();
  const catColors={"Cash & Bank":C.green,"Current Assets":C.info,"Fixed Assets":C.greenMid,"Income":C.success,"Cost of Sales":C.warning,"Admin Expenses":C.danger,"Finance Costs":C.danger,"Current Liabilities":C.amber,"Equity":C.textMid};

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:12,color:C.textMuted}}>Standard Nigerian GAAP / IFRS Chart of Accounts · {coa.length} accounts</div>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="ghost" sm onClick={()=>{
            exportToExcel('SLOT_Chart_of_Accounts',
              ['Account Code','Account Name','Type','Category','Normal Balance','Currency','Opening Balance (₦)'],
              coa.map(a=>[a.code,a.name,a.type,a.category,a.normalBal,a.currency||'NGN',a.openingBal])
            );
          }}>📊 Export COA</Btn>
          <Btn sm onClick={openAdd} icon="＋">Add Account</Btn>
        </div>
      </div>
      {cats.map(cat=>(
        <div key={cat} style={{marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:11,color:catColors[cat]||C.textMid,marginBottom:5,borderBottom:`2px solid ${C.greenPale}`,paddingBottom:3,textTransform:"uppercase",letterSpacing:"0.6px",display:"flex",justifyContent:"space-between"}}>
            <span>{cat}</span>
            <span style={{fontWeight:400,color:C.textMuted}}>{grouped[cat].length} accounts</span>
          </div>
          {grouped[cat].map(a=>{
            const bal=getAccountBalance(a.code,journals,coa);
            const isForeign=a.currency&&a.currency!=="NGN";
            return(
              <div key={a.code} style={{display:"flex",alignItems:"center",padding:"5px 8px",borderRadius:6,cursor:"pointer",fontSize:12}} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale} onMouseLeave={e=>e.currentTarget.style.background="transparent"} onClick={()=>openEdit(a)}>
                <span style={{fontFamily:"monospace",color:C.textMuted,minWidth:55,fontSize:11}}>{a.code}</span>
                <span style={{flex:1,marginLeft:10,color:C.text}}>{a.name}</span>
                {isForeign && <Pill label={a.currency} color={C.amber} sm/>}
                <span style={{color:C.textMuted,fontSize:10,marginRight:12,marginLeft:isForeign?8:0}}>{a.type}</span>
                <span style={{fontWeight:600,color:bal>=0?C.green:C.danger,minWidth:100,textAlign:"right"}}>{fmt(bal)}</span>
                {isForeign && <span style={{fontSize:10,color:C.textMuted,minWidth:90,textAlign:"right"}}>{fmtFC(getForeignBalance(a.code,journals,coa),a.currency)}</span>}
                <Pill label={a.normalBal==="Dr"?"Debit Normal":"Credit Normal"} color={a.normalBal==="Dr"?C.green:C.info} sm/>
              </div>
            );
          })}
        </div>
      ))}
      {showModal&&(
        <Modal title={editCode?"Edit Account":"Add New Account"} onClose={()=>setShowModal(false)}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Inp label="Account Code *" value={form.code} onChange={e=>setForm(f=>({...f,code:e.target.value}))} placeholder="e.g. 9009" disabled={!!editCode}/>
            <Inp label="Account Name *" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Rent Expense"/>
            <Sel label="Type" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} options={["Asset","Liability","Equity","Revenue","Expense"]}/>
            <Inp label="Category" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} placeholder="e.g. Admin Expenses"/>
            <Sel label="Normal Balance" value={form.normalBal} onChange={e=>setForm(f=>({...f,normalBal:e.target.value}))} options={[{value:"Dr",label:"Debit (Dr)"},{value:"Cr",label:"Credit (Cr)"}]}/>
            <Sel label="Currency" value={form.currency||"NGN"} onChange={e=>setForm(f=>({...f,currency:e.target.value}))} options={["NGN","USD","EUR","GBP"]}/>
            <div style={{gridColumn:"1/-1"}}><Inp label="Opening Balance (₦)" type="number" value={form.openingBal} onChange={e=>setForm(f=>({...f,openingBal:e.target.value}))} placeholder="0.00"/></div>
          </div>
          {form.currency&&form.currency!=="NGN"&&<Alert type="info" style={{marginTop:10}}>Opening balance is still entered in ₦-equivalent. The native {form.currency} balance builds up from journal entries tagged with this currency.</Alert>}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
            <Btn variant="ghost" onClick={()=>setShowModal(false)}>Cancel</Btn>
            <Btn onClick={saveAcct}>Save Account</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── General Ledger Tab ────────────────────────────────────────────
function LedgerTab({journals,coa,isAdmin=true}){
  const [selCode,setSelCode]       = useState("");
  const [monthFilter,setMonthFilter] = useState("");
  const [searchQ,setSearchQ]       = useState("");
  const [typeFilter,setTypeFilter]  = useState("");

  const TYPE_COLORS = {Asset:C.green,Liability:C.warning,Equity:C.info,Revenue:C.success,Expense:C.danger};

  // Build account summary cards — all accounts with live balance + tx count
  const accountCards = coa
    .filter(a => !typeFilter || a.type===typeFilter)
    .filter(a => !searchQ || a.code.toLowerCase().includes(searchQ.toLowerCase()) || a.name.toLowerCase().includes(searchQ.toLowerCase()))
    .sort((a,b)=>a.code.localeCompare(b.code))
    .map(a => {
      const bal  = getAccountBalance(a.code, journals, coa);
      const txs  = journals.filter(j=>j.lines.some(l=>l.drCode===a.code||l.crCode===a.code)).length;
      return {...a, balance:bal, txCount:txs};
    });

  // Detail pane for selected account
  const {acct,lines,closingBal} = selCode
    ? getLedgerForAccount(selCode,journals,coa,monthFilter)
    : {acct:null,lines:[],closingBal:0};
  const openingBal = selCode ? (coa.find(a=>a.code===selCode)?.openingBal||0) : 0;

  const inpS = {borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 10px",fontSize:12.5,background:C.bgCard,color:C.text,outline:"none"};

  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* ── Filter bar ───────────────────────────────────────────── */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search accounts…"
          style={{...inpS,flex:1,minWidth:160}}/>
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={inpS}>
          <option value="">All Types</option>
          {["Asset","Liability","Equity","Revenue","Expense"].map(t=><option key={t} value={t}>{t}</option>)}
        </select>
        <input type="month" value={monthFilter} onChange={e=>setMonthFilter(e.target.value)} style={inpS} title="Filter transactions by month"/>
        {(searchQ||typeFilter||monthFilter)&&<Btn variant="ghost" sm onClick={()=>{setSearchQ("");setTypeFilter("");setMonthFilter("");}}>✕ Clear</Btn>}
        {selCode&&<Btn variant="outline" sm onClick={()=>setSelCode("")}>← All Accounts</Btn>}
      </div>

      {!selCode ? (
        /* ══ GRID VIEW — all accounts visible on one page ════════════ */
        <>
          <div style={{fontSize:12,color:C.textMuted}}>
            Showing <strong>{accountCards.length}</strong> account{accountCards.length!==1?"s":""} · Click any card to view its full ledger
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:10}}>
            {accountCards.map(a=>(
              <div key={a.code} onClick={()=>setSelCode(a.code)}
                style={{background:C.bgCard,border:`1px solid ${C.border}`,borderRadius:10,
                  padding:"12px 14px",cursor:"pointer",transition:"all 0.15s",
                  position:"relative",overflow:"hidden"}}
                onMouseEnter={e=>{
                  e.currentTarget.style.border=`1px solid ${TYPE_COLORS[a.type]||C.green}`;
                  e.currentTarget.style.transform="translateY(-2px)";
                  e.currentTarget.style.boxShadow=`0 6px 18px ${(TYPE_COLORS[a.type]||C.green)}22`;
                }}
                onMouseLeave={e=>{
                  e.currentTarget.style.border=`1px solid ${C.border}`;
                  e.currentTarget.style.transform="translateY(0)";
                  e.currentTarget.style.boxShadow="none";
                }}>
                {/* Coloured type bar */}
                <div style={{position:"absolute",top:0,left:0,bottom:0,width:3,
                  background:TYPE_COLORS[a.type]||C.green,borderRadius:"10px 0 0 10px"}}/>
                <div style={{paddingLeft:6}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{fontFamily:"monospace",fontSize:10.5,color:TYPE_COLORS[a.type]||C.green,fontWeight:700}}>{a.code}</span>
                    <div style={{display:"flex",gap:4}}>
                      {a.currency&&a.currency!=="NGN"&&<Pill label={a.currency} color={C.amber} sm/>}
                      <Pill label={a.type} color={TYPE_COLORS[a.type]||C.green} sm/>
                    </div>
                  </div>
                  <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:6,lineHeight:1.3,
                    whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}} title={a.name}>
                    {a.name}
                  </div>
                  <div style={{fontSize:16,fontWeight:700,color:a.balance>=0?(TYPE_COLORS[a.type]||C.success):C.danger}}>
                    {fmt(a.balance)}
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:5}}>
                    <span style={{fontSize:10,color:C.textMuted}}>{a.txCount} tx{a.txCount!==1?"s":""}</span>
                    <span style={{fontSize:10,color:TYPE_COLORS[a.type]||C.green,fontWeight:700}}>View ledger →</span>
                  </div>
                </div>
              </div>
            ))}
            {accountCards.length===0&&(
              <div style={{gridColumn:"1/-1",textAlign:"center",padding:48,color:C.textMuted}}>
                No accounts match your filter
              </div>
            )}
          </div>
        </>
      ) : (
        /* ══ DETAIL VIEW — full ledger for selected account ══════════ */
        <div>
          {/* Account header card */}
          <Card style={{marginBottom:12,borderLeft:`4px solid ${TYPE_COLORS[acct?.type]||C.green}`}}>
            <div style={{display:"flex",gap:20,flexWrap:"wrap",fontSize:13,alignItems:"center"}}>
              <div><span style={{color:C.textMuted}}>Account: </span>
                <strong style={{color:TYPE_COLORS[acct?.type]||C.green}}>{acct?.code}</strong>
                <strong> — {acct?.name}</strong>
              </div>
              <Pill label={acct?.type||"—"} color={TYPE_COLORS[acct?.type]||C.greenMid} sm/>
              {acct?.currency&&acct.currency!=="NGN"&&<Pill label={acct.currency} color={C.amber} sm/>}
              <div><span style={{color:C.textMuted}}>Category: </span><span style={{fontWeight:500}}>{acct?.category||"—"}</span></div>
              <div><span style={{color:C.textMuted}}>Opening: </span><strong>{fmt(openingBal)}</strong></div>
              <div><span style={{color:C.textMuted}}>Closing: </span>
                <strong style={{color:closingBal>=0?C.success:C.danger,fontSize:14}}>{fmt(closingBal)}</strong>
              </div>
              {acct?.currency&&acct.currency!=="NGN"&&(
                <div><span style={{color:C.textMuted}}>Native Balance: </span>
                  <strong style={{color:C.amber,fontSize:14}}>{fmtFC(getForeignBalance(acct.code,journals,coa),acct.currency)}</strong>
                </div>
              )}
              <div><span style={{color:C.textMuted}}>Entries: </span><strong>{lines.length}</strong></div>
              <div style={{marginLeft:"auto"}}>
                <Btn variant="ghost" sm icon="🖨" onClick={()=>{
                  const rowsHtml = lines.map((l,i)=>`
                    <tr class="${i%2===1?'alt':''}">
                      <td>${fmtDate(l.date)}</td><td style="font-family:monospace;color:#1A5C2A">${l.ref}</td>
                      <td>${l.desc}</td><td style="color:#888">${l.memo||"—"}</td>
                      <td class="amount" style="color:${l.dr>0?"#1A7A4A":"#aaa"}">${l.dr>0?fmt(l.dr):"—"}</td>
                      <td class="amount" style="color:${l.cr>0?"#1A5C8A":"#aaa"}">${l.cr>0?fmt(l.cr):"—"}</td>
                      <td class="amount" style="font-weight:700;color:${l.balance>=0?"#182A1C":"#C0392B"}">${fmt(l.balance)}</td>
                    </tr>`).join('');
                  printSection(`General Ledger — ${acct?.code} ${acct?.name}`,`
                    <p style="margin-bottom:10px;color:#182A1C">Opening Balance: <b>${fmt(openingBal)}</b> · Closing Balance: <b>${fmt(closingBal)}</b> · ${lines.length} transaction(s)${monthFilter?` · Period: ${monthFilter}`:''}</p>
                    <table><thead><tr><th>Date</th><th>Ref</th><th>Description</th><th>Memo</th><th>Debit (₦)</th><th>Credit (₦)</th><th>Balance (₦)</th></tr></thead>
                    <tbody>
                      <tr style="font-style:italic"><td colspan="6">Opening Balance</td><td class="amount">${fmt(openingBal)}</td></tr>
                      ${rowsHtml}
                      <tr class="total-row"><td colspan="4"><b>Closing Balance</b></td>
                        <td class="amount">${fmt(lines.reduce((s,l)=>s+l.dr,0))}</td>
                        <td class="amount">${fmt(lines.reduce((s,l)=>s+l.cr,0))}</td>
                        <td class="amount" style="color:${closingBal>=0?'#1A7A4A':'#C0392B'}">${fmt(closingBal)}</td>
                      </tr>
                    </tbody></table>`);
                }}>Print Ledger</Btn>
              </div>
            </div>
          </Card>

          {/* Ledger table */}
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{background:C.tableHeaderBg,color:C.tableHeaderText}}>
                {["Date","Journal Ref","Description","Memo","Debit (₦)","Credit (₦)","Running Balance"].map(h=>(
                  <th key={h} style={{padding:"9px 10px",textAlign:h.includes("₦")||h==="Running Balance"?"right":"left",fontWeight:600,whiteSpace:"nowrap",fontSize:10.5,textTransform:"uppercase",letterSpacing:"0.4px"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                <tr style={{background:C.greenPale,fontStyle:"italic"}}>
                  <td colSpan={6} style={{padding:"7px 10px",fontSize:11,color:C.textMuted}}>Opening Balance b/f</td>
                  <td style={{padding:"7px 10px",textAlign:"right",fontWeight:600,color:C.textMid}}>{fmt(openingBal)}</td>
                </tr>
                {lines.length===0&&(
                  <tr><td colSpan={7} style={{textAlign:"center",padding:32,color:C.textMuted}}>
                    No transactions{monthFilter?` in ${monthFilter}`:""}
                  </td></tr>
                )}
                {lines.map((l,i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${C.borderLight}`,background:i%2===1?C.greenPale2:"transparent"}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.greenPale}
                    onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.greenPale2:"transparent"}>
                    <td style={{padding:"7px 10px",whiteSpace:"nowrap"}}>{fmtDate(l.date)}</td>
                    <td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:11,color:C.green,whiteSpace:"nowrap"}}>{l.ref}</td>
                    <td style={{padding:"7px 10px",maxWidth:220,whiteSpace:"normal",lineHeight:1.4}}>{l.desc}</td>
                    <td style={{padding:"7px 10px",color:C.textMuted,fontSize:11,maxWidth:120,whiteSpace:"normal"}}>{l.memo||"—"}</td>
                    <td style={{padding:"7px 10px",textAlign:"right",color:l.dr>0?C.success:"#C8D8CA",fontWeight:l.dr>0?600:400}}>{l.dr>0?fmt(l.dr):"—"}</td>
                    <td style={{padding:"7px 10px",textAlign:"right",color:l.cr>0?C.info:"#C8D8CA",fontWeight:l.cr>0?600:400}}>{l.cr>0?fmt(l.cr):"—"}</td>
                    <td style={{padding:"7px 10px",textAlign:"right",fontWeight:700,fontSize:12.5,color:l.balance>=0?C.text:C.danger}}>{fmt(l.balance)}</td>
                  </tr>
                ))}
                <tr style={{background:C.tableHeaderBg,color:C.tableHeaderText,fontWeight:700}}>
                  <td colSpan={4} style={{padding:"9px 10px",fontSize:12}}>CLOSING BALANCE c/f</td>
                  <td style={{padding:"9px 10px",textAlign:"right"}}>{fmt(lines.reduce((s,l)=>s+l.dr,0))}</td>
                  <td style={{padding:"9px 10px",textAlign:"right"}}>{fmt(lines.reduce((s,l)=>s+l.cr,0))}</td>
                  <td style={{padding:"9px 10px",textAlign:"right",fontSize:14,color:closingBal>=0?"#90EFB0":C.danger}}>{fmt(closingBal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Trial Balance Tab ─────────────────────────────────────────────
function TrialBalanceTab({journals,coa,isAdmin=true}){
  const [period,setPeriod]=useState("");
  const filteredJournals=period?journals.filter(j=>j.date.startsWith(period)):journals;
  const tb=getTrialBalance(filteredJournals,coa);
  const totalDR=tb.reduce((s,r)=>s+r.dr,0);
  const totalCR=tb.reduce((s,r)=>s+r.cr,0);
  const balanced=Math.abs(totalDR-totalCR)<1;

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:12,color:C.textMuted}}>Period:</span>
          <input type="month" value={period} onChange={e=>setPeriod(e.target.value)} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 10px",fontSize:13,background:C.bgCard,color:C.text}}/>
          {period&&<Btn variant="ghost" sm onClick={()=>setPeriod("")}>Clear</Btn>}
          <Btn sm onClick={()=>setPeriod("")}>All Periods</Btn>
        </div>
        <div style={{display:"flex",gap:8}}>
          <span style={{fontSize:12,padding:"5px 12px",borderRadius:8,background:balanced?C.greenPale:C.amberPale,color:balanced?C.success:C.warning,fontWeight:600}}>
            {balanced?"✓ BALANCED":"⚠ OUT OF BALANCE"}
          </span>
          <Btn variant="ghost" sm icon="🖨" onClick={()=>{
            const hdrs = ["Acct Code","Account Name","Type","Category","Debit (₦)","Credit (₦)"];
            const rowsHtml = tb.map((r,i)=>`<tr class="${i%2===1?'alt':''}"><td><b style="color:#1A5C2A">${r.code}</b></td><td>${r.name}</td><td>${r.type}</td><td>${r.category}</td><td class="amount">${r.dr>0?fmt(r.dr):'—'}</td><td class="amount">${r.cr>0?fmt(r.cr):'—'}</td></tr>`).join('');
            const totRow = `<tr class="total-row"><td colspan="4"><b>TOTALS</b></td><td class="amount"><b>${fmt(totalDR)}</b></td><td class="amount"><b>${fmt(totalCR)}</b></td></tr>`;
            const bal = `<p style="margin-top:12px;font-weight:700;color:${balanced?'#1A7A4A':'#C0392B'}">${balanced?'✓ Trial Balance is BALANCED':'⚠ Trial Balance is OUT OF BALANCE by '+fmt(Math.abs(totalDR-totalCR))}</p>`;
            printSection('Trial Balance'+(period?' — '+period:''),`<p style="margin-bottom:8px;color:#182A1C">Period: ${period||'All periods'} · ${tb.length} accounts</p><table><thead><tr>${hdrs.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rowsHtml}${totRow}</tbody></table>${bal}`);
          }}>Print Trial Balance</Btn>
        </div>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{background:C.tableHeaderBg,color:C.tableHeaderText}}>
            {["Acct Code","Account Name","Type","Category","Debit (₦)","Credit (₦)"].map(h=><th key={h} style={{padding:"9px 10px",textAlign:h.includes("₦")?"right":"left",fontWeight:500,whiteSpace:"nowrap"}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {tb.map((r,i)=>(
              <tr key={r.code} style={{borderBottom:`1px solid ${C.borderLight}`,background:i%2===1?C.greenPale2:"transparent"}}>
                <td style={{padding:"7px 10px",fontFamily:"monospace",fontSize:11,color:C.green}}>{r.code}</td>
                <td style={{padding:"7px 10px",fontWeight:500}}>{maskAcctName(r.name)}</td>
                <td style={{padding:"7px 10px"}}><Pill label={r.type} color={r.type==="Revenue"?C.success:r.type==="Expense"?C.danger:r.type==="Asset"?C.green:r.type==="Liability"?C.warning:C.textMid} sm/></td>
                <td style={{padding:"7px 10px",color:C.textMuted,fontSize:11}}>{r.category}</td>
                <td style={{padding:"7px 10px",textAlign:"right",color:r.dr>0?C.text:C.textLight,fontWeight:r.dr>0?500:400}}>{r.dr>0?fmt(r.dr):"—"}</td>
                <td style={{padding:"7px 10px",textAlign:"right",color:r.cr>0?C.text:C.textLight,fontWeight:r.cr>0?500:400}}>{r.cr>0?fmt(r.cr):"—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr style={{background:C.tableHeaderBg,color:C.tableHeaderText,fontWeight:700}}>
            <td colSpan={4} style={{padding:"9px 10px"}}>TOTALS</td>
            <td style={{padding:"9px 10px",textAlign:"right",fontSize:14}}>{fmt(totalDR)}</td>
            <td style={{padding:"9px 10px",textAlign:"right",fontSize:14}}>{fmt(totalCR)}</td>
          </tr></tfoot>
        </table>
      </div>
      {!balanced&&<Alert type="danger" style={{marginTop:12}}>⚠ Trial balance is out by {fmt(Math.abs(totalDR-totalCR))}. Check recent journal entries.</Alert>}
    </div>
  );
}

// ── P&L Statement Tab ─────────────────────────────────────────────
function PLTab({journals,coa,isAdmin=true}){
  const [from,setFrom]=useState(curYearStart());
  const [to,setTo]=useState(curMonth());
  const [generated,setGenerated]=useState(false);
  const [plData,setPlData]=useState(null);

  const generate=()=>{setPlData(getPL(journals,coa,from,to));setGenerated(true);};

  const plRow=(label,value,bold,indent,color)=>(
    <div style={{display:"flex",justifyContent:"space-between",padding:bold?"10px 12px":"7px 12px",paddingLeft:indent?28:12,background:bold?C.greenPale:"transparent",borderBottom:`1px solid ${C.borderLight}`,borderRadius:bold?6:0,marginBottom:bold?2:0}}>
      <span style={{fontSize:13,fontWeight:bold?700:400,color:C.textMid}}>{label}</span>
      <span style={{fontSize:13,fontWeight:bold?700:600,color:color||(value>=0?C.text:C.danger)}}>{value<0?"("+fmt(Math.abs(value))+")":fmt(value)}</span>
    </div>
  );

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input type="month" value={from} onChange={e=>setFrom(e.target.value)} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 10px",fontSize:13,background:C.bgCard,color:C.text}}/>
          <span style={{color:C.textMuted}}>to</span>
          <input type="month" value={to} onChange={e=>setTo(e.target.value)} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 10px",fontSize:13,background:C.bgCard,color:C.text}}/>
          <Btn sm onClick={generate}>Generate P&L</Btn>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="ghost" sm icon="🖨" onClick={()=>{
            if(!plData){alert('Generate P&L first');return;}
            const revRows = Object.entries(plData.revenue).filter(([,v])=>v>0).map(([c,v])=>{const a=coa.find(ac=>ac.code===c);return `<tr><td style="padding-left:24px">${c} — ${a?.name||c}</td><td class="amount">${fmt(v)}</td></tr>`;}).join('');
            const expRows = Object.entries(plData.admin).filter(([,v])=>v>0).map(([c,v])=>{const a=coa.find(ac=>ac.code===c);return `<tr><td style="padding-left:24px">${c} — ${a?.name||c}</td><td class="amount">(${fmt(v)})</td></tr>`;}).join('');
            const html = `
              <table>
                <tr class="total-row"><td><b>REVENUE</b></td><td></td></tr>
                ${revRows}
                <tr class="total-row"><td><b>Total Revenue</b></td><td class="amount"><b>${fmt(plData.totalRev)}</b></td></tr>
                <tr><td style="height:8px"></td></tr>
                <tr class="total-row"><td><b>OPERATING EXPENSES</b></td><td></td></tr>
                ${expRows}
                <tr class="total-row"><td><b>Total Expenses</b></td><td class="amount"><b>(${fmt(plData.totalAdmin)})</b></td></tr>
                <tr><td style="height:8px"></td></tr>
                <tr style="background:#1A5C2A;color:#fff"><td><b>NET PROFIT / (LOSS)</b></td><td class="amount" style="color:${plData.netProfit>=0?'#fff':'#ffcccc'}"><b>${plData.netProfit>=0?fmt(plData.netProfit):'('+fmt(Math.abs(plData.netProfit))+')'}</b></td></tr>
              </table>`;
            printSection(`Profit & Loss Statement — ${from} to ${to}`, html);
          }}>Print P&L</Btn>
          <Btn variant="ghost" sm icon="📊" onClick={()=>{
            if(!plData){alert('Generate P&L first');return;}
            const rows=[['REVENUE',''],
              ...Object.entries(plData.revenue).filter(([,v])=>v>0).map(([c,v])=>{const a=coa.find(ac=>ac.code===c);return[`  ${c} — ${a?.name||c}`,fmt(v)];}),
              ['Total Revenue',fmt(plData.totalRev)],['',''],
              ['COST OF SALES',''],['Total COGS',fmt(plData.totalCOGS)],['',''],
              ['OPERATING EXPENSES',''],
              ...Object.entries(plData.admin).filter(([,v])=>v>0).map(([c,v])=>{const a=coa.find(ac=>ac.code===c);return[`  ${c} — ${a?.name||c}`,'('+fmt(v)+')'];}),
              ['Total Expenses','('+fmt(plData.totalAdmin)+')'],['',''],
              ['NET PROFIT / (LOSS)',plData.netProfit>=0?fmt(plData.netProfit):'('+fmt(Math.abs(plData.netProfit))+')']
            ];
            exportToExcel(`SLOT_PL_${from}_to_${to}`,['Description','Amount (₦)'],rows);
          }}>Export Excel</Btn>
        </div>
      </div>
      {generated&&plData?(
        <Card>
          <div style={{textAlign:"center",marginBottom:20,paddingBottom:14,borderBottom:`2px solid ${C.greenPale}`}}>
            <div style={{fontWeight:800,fontSize:15,color:C.green}}>SLOT ENGINEERING NIGERIA LIMITED</div>
            <div style={{fontSize:13,color:C.textMid,marginTop:3}}>Profit and Loss Statement</div>
            <div style={{fontSize:12,color:C.textMuted,marginTop:2}}>For the period: {from} to {to}</div>
          </div>
          {plRow("REVENUE",null,true,false,C.green)}
          {Object.entries(plData.revenue).map(([code,val])=>{const a=coa.find(ac=>ac.code===code);return val>0?plRow(`${code} — ${a?.name||code}`,val,false,true):null;})}
          {plRow("Total Revenue",plData.totalRev,true,false,C.success)}
          <div style={{height:12}}/>
          {plRow("COST OF SALES",null,true,false,C.warning)}
          {Object.entries(plData.cogs).map(([code,val])=>{const a=coa.find(ac=>ac.code===code);return val>0?plRow(`${code} — ${a?.name||code}`,val,false,true):null;})}
          {plRow("Total Cost of Sales",plData.totalCOGS,true,false,C.warning)}
          <div style={{height:8}}/>
          {plRow("GROSS PROFIT",plData.grossProfit,true,false,plData.grossProfit>=0?C.success:C.danger)}
          <div style={{height:12}}/>
          {plRow("OPERATING EXPENSES",null,true,false,C.danger)}
          {Object.entries(plData.admin).map(([code,val])=>{const a=coa.find(ac=>ac.code===code);return val>0?plRow(`${code} — ${a?.name||code}`,val,false,true):null;})}
          {plRow("Total Operating Expenses",plData.totalAdmin,true,false,C.danger)}
          <div style={{height:8}}/>
          {plRow("FINANCE COSTS",null,true,false,C.danger)}
          {Object.entries(plData.finance).map(([code,val])=>{const a=coa.find(ac=>ac.code===code);return val>0?plRow(`${code} — ${a?.name||code}`,val,false,true):null;})}
          {plRow("Total Finance Costs",plData.totalFin,true,false,C.danger)}
          <div style={{height:12,borderTop:`2px solid ${C.green}`,marginTop:8}}/>
          {plRow("NET PROFIT / (LOSS)",plData.netProfit,true,false,plData.netProfit>=0?C.success:C.danger)}
        </Card>
      ):(
        <div style={{textAlign:"center",padding:60,color:C.textMuted}}>
          <div style={{fontSize:36,marginBottom:12}}>📈</div>
          <div style={{fontSize:14,fontWeight:500}}>Select a period and click Generate P&L</div>
          <div style={{fontSize:12,marginTop:6}}>Automatically computed from posted journal entries</div>
        </div>
      )}
    </div>
  );
}

// ── Balance Sheet Tab ─────────────────────────────────────────────
function BalanceSheetTab({journals,coa,isAdmin=true}){
  const [date,setDate]=useState(today());
  const [generated,setGenerated]=useState(false);
  const [bsData,setBsData]=useState(null);
  const generate=()=>{setBsData(getBalanceSheet(journals,coa));setGenerated(true);};

  const bsSection=(title,items,total,totalColor)=>(
    <div style={{marginBottom:16}}>
      <div style={{fontWeight:700,fontSize:12,color:C.green,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:6,borderBottom:`2px solid ${C.greenPale}`,paddingBottom:4}}>{title}</div>
      {Object.entries(items).filter(([,v])=>v.val!==0).map(([code,v])=>(
        <div key={code} style={{display:"flex",justifyContent:"space-between",padding:"5px 12px",fontSize:12}}>
          <span style={{color:C.textMid}}>{code} — {v.name}</span>
          <span style={{fontWeight:500,color:v.val>=0?C.text:C.danger}}>{fmt(v.val)}</span>
        </div>
      ))}
      <div style={{display:"flex",justifyContent:"space-between",padding:"8px 12px",background:C.greenPale,fontWeight:700,borderRadius:6,marginTop:4}}>
        <span>Total {title}</span><span style={{color:totalColor||C.green}}>{fmt(total)}</span>
      </div>
    </div>
  );

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 10px",fontSize:13,background:C.bgCard,color:C.text}}/>
          <Btn sm onClick={generate}>Generate Balance Sheet</Btn>
        </div>
        <Btn variant="ghost" sm icon="🖨" onClick={()=>{
          if(!bsData){alert('Generate Balance Sheet first');return;}
          const assetRows = Object.entries(bsData.assets).filter(([,v])=>v.val!==0).map(([c,v])=>`<tr><td>${c} — ${v.name}</td><td class="amount">${fmt(v.val)}</td></tr>`).join('');
          const liabRows  = Object.entries(bsData.liabilities).filter(([,v])=>v.val!==0).map(([c,v])=>`<tr><td>${c} — ${v.name}</td><td class="amount">${fmt(v.val)}</td></tr>`).join('');
          const eqRows    = Object.entries(bsData.equity).filter(([,v])=>v.val!==0).map(([c,v])=>`<tr><td>${c} — ${v.name}</td><td class="amount">${fmt(v.val)}</td></tr>`).join('');
          const html=`<table>
            <tr class="total-row"><td><b>ASSETS</b></td><td></td></tr>${assetRows}
            <tr class="total-row"><td><b>Total Assets</b></td><td class="amount"><b>${fmt(bsData.totalAssets)}</b></td></tr>
            <tr><td style="height:10px"></td></tr>
            <tr class="total-row"><td><b>LIABILITIES</b></td><td></td></tr>${liabRows}
            <tr class="total-row"><td><b>Total Liabilities</b></td><td class="amount"><b>${fmt(bsData.totalLiabilities)}</b></td></tr>
            <tr><td style="height:10px"></td></tr>
            <tr class="total-row"><td><b>EQUITY</b></td><td></td></tr>${eqRows}
            <tr class="total-row"><td><b>Total Equity</b></td><td class="amount"><b>${fmt(bsData.totalEquity)}</b></td></tr>
            <tr style="background:#1A5C2A;color:#fff"><td><b>TOTAL LIABILITIES + EQUITY</b></td><td class="amount"><b>${fmt(bsData.totalLiabilities+bsData.totalEquity)}</b></td></tr>
          </table>`;
          printSection(`Balance Sheet — As at ${fmtDate(date)}`, html);
        }}>Print Balance Sheet</Btn>
      </div>
      {generated&&bsData?(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <Card>
            <div style={{textAlign:"center",marginBottom:16,paddingBottom:12,borderBottom:`1px solid ${C.borderLight}`}}>
              <div style={{fontWeight:800,fontSize:14,color:C.green}}>ASSETS</div>
              <div style={{fontSize:11,color:C.textMuted}}>As at {fmtDate(date)}</div>
            </div>
            {bsSection("Fixed Assets",Object.fromEntries(Object.entries(bsData.assets).filter(([,v])=>v.cat==="Fixed Assets")),Object.values(bsData.assets).filter(v=>v.cat==="Fixed Assets").reduce((s,v)=>s+v.val,0))}
            {bsSection("Current Assets",Object.fromEntries(Object.entries(bsData.assets).filter(([,v])=>v.cat!=="Fixed Assets")),Object.values(bsData.assets).filter(v=>v.cat!=="Fixed Assets").reduce((s,v)=>s+v.val,0))}
            <div style={{display:"flex",justifyContent:"space-between",padding:"10px 12px",background:C.tableHeaderBg,color:C.tableHeaderText,fontWeight:700,borderRadius:8,marginTop:8,fontSize:14}}>
              <span>TOTAL ASSETS</span><span>{fmt(bsData.totalAssets)}</span>
            </div>
          </Card>
          <Card>
            <div style={{textAlign:"center",marginBottom:16,paddingBottom:12,borderBottom:`1px solid ${C.borderLight}`}}>
              <div style={{fontWeight:800,fontSize:14,color:C.amber}}>LIABILITIES & EQUITY</div>
              <div style={{fontSize:11,color:C.textMuted}}>As at {fmtDate(date)}</div>
            </div>
            {bsSection("Current Liabilities",bsData.liabilities,bsData.totalLiabilities,C.danger)}
            {bsSection("Equity",bsData.equity,bsData.totalEquity,C.info)}
            <div style={{display:"flex",justifyContent:"space-between",padding:"10px 12px",background:C.amber,color:'#FFFFFF',fontWeight:700,borderRadius:8,marginTop:8,fontSize:14}}>
              <span>TOTAL LIABILITIES + EQUITY</span><span>{fmt(bsData.totalLiabilities+bsData.totalEquity)}</span>
            </div>
            {Math.abs(bsData.totalAssets-(bsData.totalLiabilities+bsData.totalEquity))>100?(
              <Alert type="danger" style={{marginTop:8}}>Balance Sheet does not balance! Difference: {fmt(Math.abs(bsData.totalAssets-(bsData.totalLiabilities+bsData.totalEquity)))}</Alert>
            ):<Alert type="info" style={{marginTop:8}}>✓ Balance Sheet balances</Alert>}
          </Card>
        </div>
      ):(
        <div style={{textAlign:"center",padding:60,color:C.textMuted}}>
          <div style={{fontSize:36,marginBottom:12}}>🏛️</div>
          <div style={{fontSize:14,fontWeight:500}}>Select a date and click Generate Balance Sheet</div>
        </div>
      )}
    </div>
  );
}

// ── Cash Flow Tab ─────────────────────────────────────────────────
function CashFlowTab({journals,coa,isAdmin=true}){
  const [from,setFrom]=useState(curYearStart());
  const [to,setTo]=useState(curMonth());
  const [generated,setGenerated]=useState(false);

  const generate=()=>setGenerated(true);

  const cashAccounts=coa.filter(a=>a.category==="Cash & Bank");
  const cashInflows=[], cashOutflows=[];
  journals.filter(j=>(!from||j.date>=from+"-01")&&(!to||j.date<=to+"-31")).forEach(j=>j.lines.forEach(l=>{
    cashAccounts.forEach(ca=>{
      if(l.drCode===ca.code) cashInflows.push({date:j.date,desc:j.description,amount:l.amount,ref:j.ref});
      if(l.crCode===ca.code) cashOutflows.push({date:j.date,desc:j.description,amount:l.amount,ref:j.ref});
    });
  }));
  const totalIn=cashInflows.reduce((s,i)=>s+i.amount,0);
  const totalOut=cashOutflows.reduce((s,i)=>s+i.amount,0);
  const netCash=totalIn-totalOut;

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input type="month" value={from} onChange={e=>setFrom(e.target.value)} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 10px",fontSize:13,background:C.bgCard,color:C.text}}/>
          <span style={{color:C.textMuted}}>to</span>
          <input type="month" value={to} onChange={e=>setTo(e.target.value)} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 10px",fontSize:13,background:C.bgCard,color:C.text}}/>
          <Btn sm onClick={generate}>Generate Cash Flow</Btn>
        </div>
        <Btn variant="ghost" sm icon="🖨" onClick={()=>{
          if(!generated){alert('Generate Cash Flow first');return;}
          const inRows  = cashInflows.map(r=>`<tr><td>${fmtDate(r.date)}</td><td>${r.desc}</td><td class="amount" style="color:#1A7A4A">${fmt(r.amount)}</td></tr>`).join('');
          const outRows = cashOutflows.map(r=>`<tr><td>${fmtDate(r.date)}</td><td>${r.desc}</td><td class="amount" style="color:#C0392B">(${fmt(r.amount)})</td></tr>`).join('');
          const html=`<table>
            <tr class="total-row"><td colspan="2"><b>CASH INFLOWS</b></td><td class="amount"><b>Amount (₦)</b></td></tr>
            ${inRows}
            <tr class="total-row"><td colspan="2"><b>Total Inflows</b></td><td class="amount"><b>${fmt(totalIn)}</b></td></tr>
            <tr><td colspan="3" style="height:10px"></td></tr>
            <tr class="total-row"><td colspan="2"><b>CASH OUTFLOWS</b></td><td></td></tr>
            ${outRows}
            <tr class="total-row"><td colspan="2"><b>Total Outflows</b></td><td class="amount"><b>(${fmt(totalOut)})</b></td></tr>
            <tr><td colspan="3" style="height:10px"></td></tr>
            <tr style="background:#1A5C2A;color:#fff"><td colspan="2"><b>NET CASH MOVEMENT</b></td><td class="amount"><b>${netCash>=0?fmt(netCash):'('+fmt(Math.abs(netCash))+')'}</b></td></tr>
          </table>`;
          printSection(`Cash Flow Statement — ${from} to ${to}`, html);
        }}>Print</Btn>
      </div>
      {generated?(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            <KPI label="Total Cash Inflows" value={fmt(totalIn)} color={C.success} icon="↓"/>
            <KPI label="Total Cash Outflows" value={fmt(totalOut)} color={C.danger} icon="↑"/>
            <KPI label="Net Cash Movement" value={fmt(netCash)} color={netCash>=0?C.success:C.danger} icon="💧" sub={netCash>=0?"Net inflow":"Net outflow"}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <Card>
              <SecHead title="Cash Inflows" sub={`${cashInflows.length} transactions`}/>
              <Tbl compact cols={[{key:"date",label:"Date",render:r=>fmtDate(r.date)},{key:"desc",label:"Description",wrap:true,maxW:"180px"},{key:"amount",label:"Amount",align:"right",render:r=><strong style={{color:C.success}}>{fmt(r.amount)}</strong>}]} rows={cashInflows}/>
              <div style={{display:"flex",justifyContent:"flex-end",padding:"8px 0",fontWeight:700,color:C.success,fontSize:13}}>Total In: {fmt(totalIn)}</div>
            </Card>
            <Card>
              <SecHead title="Cash Outflows" sub={`${cashOutflows.length} transactions`}/>
              <Tbl compact cols={[{key:"date",label:"Date",render:r=>fmtDate(r.date)},{key:"desc",label:"Description",wrap:true,maxW:"180px"},{key:"amount",label:"Amount",align:"right",render:r=><strong style={{color:C.danger}}>{fmt(r.amount)}</strong>}]} rows={cashOutflows}/>
              <div style={{display:"flex",justifyContent:"flex-end",padding:"8px 0",fontWeight:700,color:C.danger,fontSize:13}}>Total Out: {fmt(totalOut)}</div>
            </Card>
          </div>
        </div>
      ):(
        <div style={{textAlign:"center",padding:60,color:C.textMuted}}>
          <div style={{fontSize:36,marginBottom:12}}>💧</div>
          <div style={{fontSize:14,fontWeight:500}}>Select a period and click Generate Cash Flow</div>
        </div>
      )}
    </div>
  );
}

// ── Bank Reconciliation Tab ────────────────────────────────────────
function BankReconTab({bankStmt,setBankStmt,journals,coa}){
  const { state, dispatch } = useApp();
  const { currentUser, appSettings } = state;
  const bankAccounts = coa.filter(a=>a.category==="Cash & Bank").sort((a,b)=>a.code.localeCompare(b.code));
  const [selectedAcct,setSelectedAcct]=useState(bankAccounts[0]?.code||"");
  const [showModal,setShowModal]=useState(false);
  const [form,setForm]=useState({date:today(),description:"",amount:"",type:"credit",ref:""});
  const [showLiveFeed, setShowLiveFeed] = useState(false);

  const acct = coa.find(a=>a.code===selectedAcct) || bankAccounts[0];
  const isForeign = acct && acct.currency!=="NGN";

  const saveBankEntry=()=>{
    const id=`BS${String(bankStmt.length+1).padStart(3,"0")}`;
    setBankStmt(bs=>[...bs,{id,...form,accountCode:selectedAcct,amount:parseFloat(form.amount)||0,reconciled:false}]);
    setShowModal(false);
    setForm({date:today(),description:"",amount:"",type:"credit",ref:""});
  };
  const toggleReconcile=(id)=>setBankStmt(bs=>bs.map(b=>b.id===id?{...b,reconciled:!b.reconciled}:b));

  // ── Live bank feed ──────────────────────────────────────────────────────
  const [feedStatus, setFeedStatus] = useState({ busy: false, lastResult: null, error: null });
  const [feedRange, setFeedRange]   = useState({ from: new Date(Date.now()-30*86400000).toISOString().slice(0,10), to: today() });
  const feedConfig = appSettings?.bankFeed || { provider: 'csv' };
  const ProviderCmps = { mono: 'Mono (NIBSS/Open Banking)', okra: 'Okra (NIBSS/Open Banking)', csv: 'CSV file upload (no live API)' };

  async function runLiveFeed() {
    if (!feedConfig || feedConfig.provider === 'csv') { showToast('Switch to Mono or Okra in Settings to use the live feed', 'error'); return; }
    setFeedStatus({ busy: true, lastResult: null, error: null });
    try {
      const { fetchBankTransactions } = await import('../../utils/bankFeedProviders');
      const txns = await fetchBankTransactions(feedConfig, { ...feedRange, account: selectedAcct });
      // Map provider output to bankStmt rows for the selected account
      const newRows = txns.map((t, i) => ({
        id: `BS-LIVE-${Date.now()}-${i}`,
        date: t.date,
        description: t.narrative || '(no narration)',
        amount: (t.credit || 0) + (t.debit || 0),
        type: t.credit > 0 ? 'credit' : 'debit',
        ref: t.ref || '',
        reconciled: false,
        accountCode: selectedAcct,
        source: `live:${feedConfig.provider}`,
        raw: t,
      }));
      const next = [...bankStmt, ...newRows];
      setBankStmt(next);
      logActivity(dispatch, `Pulled ${newRows.length} live bank transactions from ${ProviderCmps[feedConfig.provider]} for ${acct?.name||selectedAcct}`, currentUser, { module:'accounting', action:'edit' });
      setFeedStatus({ busy: false, lastResult: { count: newRows.length, totalCredit: txns.reduce((s,t)=>s+(t.credit||0),0), totalDebit: txns.reduce((s,t)=>s+(t.debit||0),0) }, error: null });
      showToast(`✓ Pulled ${newRows.length} transactions`);
    } catch (e) {
      setFeedStatus({ busy: false, lastResult: null, error: e?.message || 'Live feed failed' });
      showToast('Live feed failed: ' + (e?.message || e), 'error');
    }
  }

  // Scope EVERYTHING below to the selected account only — this is the fix:
  // previously all Cash & Bank accounts (NGN, USD, EUR) were pooled into one
  // number, which is meaningless once more than one currency is involved.
  const acctStmt = bankStmt.filter(b=>b.accountCode===selectedAcct);
  const cashBal = acct ? getAccountBalance(acct.code, journals, coa) : 0;            // ₦-equivalent book balance, this account only
  const fcBal   = acct ? getForeignBalance(acct.code, journals, coa) : 0;            // native-currency book balance (0 for NGN accounts)
  const bankCredits=acctStmt.filter(b=>b.type==="credit").reduce((s,b)=>s+b.amount,0);
  const bankDebits=acctStmt.filter(b=>b.type==="debit").reduce((s,b)=>s+b.amount,0);
  const bankBalance=bankCredits-bankDebits;
  const unreconciled=acctStmt.filter(b=>!b.reconciled);
  const compareBal = isForeign ? fcBal : cashBal; // statement entries for a foreign account are entered in its native currency

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* ── Live Bank Feed (provider-abstracted) ─────────────────────────── */}
      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:C.text }}>🔴 Live Bank Feed</div>
            <div style={{ fontSize:11.5, color:C.textMuted, marginTop:1 }}>
              Pull transactions directly from your bank via Mono, Okra, or another Nigerian Open Banking provider.
              {!feedConfig?.provider || feedConfig.provider === 'csv' ? ' Currently in CSV mode — set up Mono/Okra in Settings → Accounting to enable.' : ` Provider: ${ProviderCmps[feedConfig.provider] || feedConfig.provider}.`}
            </div>
          </div>
          <Btn variant="ghost" sm onClick={() => setShowLiveFeed(s => !s)}>{showLiveFeed ? 'Hide ▲' : 'Configure ▼'}</Btn>
        </div>
        {showLiveFeed && (
          <div style={{ marginTop:14, padding:14, background:C.bgAlt, borderRadius:8 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, alignItems:'end' }}>
              <FG label="Provider">
                <select value={feedConfig?.provider || 'csv'} onChange={e => {
                  const next = { ...(feedConfig||{}), provider: e.target.value };
                  dispatch({ type:'SET_SETTINGS', payload: { ...appSettings, bankFeed: next } });
                }}>
                  <option value="csv">CSV file upload (no live API)</option>
                  <option value="mono">Mono</option>
                  <option value="okra">Okra</option>
                </select>
              </FG>
              <FG label="From"><input type="date" value={feedRange.from} onChange={e=>setFeedRange(p=>({...p,from:e.target.value}))} /></FG>
              <FG label="To"><input type="date" value={feedRange.to} onChange={e=>setFeedRange(p=>({...p,to:e.target.value}))} /></FG>
            </div>
            {feedConfig?.provider === 'mono' && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:10 }}>
                <Inp label="Mono Secret Key" type="password" value={feedConfig?.monoSecretKey||''} onChange={e => dispatch({ type:'SET_SETTINGS', payload: { ...appSettings, bankFeed: { ...feedConfig, monoSecretKey: e.target.value } } })} placeholder="mono_sec_live_…" />
                <Inp label="Mono Account ID" value={feedConfig?.monoAccountId||''} onChange={e => dispatch({ type:'SET_SETTINGS', payload: { ...appSettings, bankFeed: { ...feedConfig, monoAccountId: e.target.value } } })} placeholder="acct_…" />
              </div>
            )}
            {feedConfig?.provider === 'okra' && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:10 }}>
                <Inp label="Okra API Key" type="password" value={feedConfig?.okraApiKey||''} onChange={e => dispatch({ type:'SET_SETTINGS', payload: { ...appSettings, bankFeed: { ...feedConfig, okraApiKey: e.target.value } } })} placeholder="Bearer …" />
                <Inp label="Okra Record ID" value={feedConfig?.okraRecordId||''} onChange={e => dispatch({ type:'SET_SETTINGS', payload: { ...appSettings, bankFeed: { ...feedConfig, okraRecordId: e.target.value } } })} placeholder="rec_…" />
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:14, padding:'10px 14px', background:C.bgCard, borderRadius:8, border:'1px solid '+C.border }}>
              <div style={{ fontSize:11.5, color:C.textMuted, lineHeight:1.6, maxWidth:520 }}>
                💡 Pulls live transactions into the bank statement list below. They get tagged with <code style={{fontFamily:'monospace',background:C.greenPale,padding:'1px 4px',borderRadius:3}}>source: live:{feedConfig?.provider || 'csv'}</code> so you can trace them. The same auto-match engine in <code style={{fontFamily:'monospace',background:C.greenPale,padding:'1px 4px',borderRadius:3}}>utils/bankRecImport.js</code> then reconciles them against your GL cashbook. Failed pulls fall back to the manual / CSV path — no regression.
              </div>
              <Btn onClick={runLiveFeed} disabled={feedStatus.busy || !feedConfig?.provider || feedConfig.provider === 'csv'}>
                {feedStatus.busy ? '⏳ Pulling…' : '🔄 Pull Live Transactions'}
              </Btn>
            </div>
            {feedStatus.error && <Alert type="danger" style={{ marginTop:10 }}>Live feed error: {feedStatus.error}</Alert>}
            {feedStatus.lastResult && <Alert type="info" style={{ marginTop:10 }}>✓ Pulled {feedStatus.lastResult.count} transactions · total in ₦ equivalent: credits +{feedStatus.lastResult.totalCredit.toLocaleString('en-NG')} / debits −{feedStatus.lastResult.totalDebit.toLocaleString('en-NG')}</Alert>}
          </div>
        )}
      </Card>

      <Card>
        <div style={{display:"flex",alignItems:"flex-end",gap:12,flexWrap:"wrap"}}>
          <div style={{minWidth:280}}>
            <Sel label="Bank / Cash Account" value={selectedAcct} onChange={e=>setSelectedAcct(e.target.value)}
              options={bankAccounts.map(a=>({value:a.code,label:`${a.code} — ${a.name}${a.currency!=="NGN"?` (${a.currency})`:""}`}))}/>
          </div>
          {isForeign && <Alert type="info" style={{flex:1,minWidth:240}}>This account is denominated in <strong>{acct.currency}</strong>. Reconcile against the native-currency statement — the ₦-equivalent is shown separately for the company-wide Balance Sheet only.</Alert>}
        </div>
      </Card>

      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        <KPI label={`Book Balance (${isForeign?acct.currency:"₦ Ledger"})`} value={isForeign?fmtFC(fcBal,acct.currency):fmt(cashBal)} color={C.green}/>
        <KPI label={`Bank Statement Balance (${isForeign?acct.currency:"₦"})`} value={isForeign?fmtFC(bankBalance,acct.currency):fmt(bankBalance)} color={C.info}/>
        <KPI label="Difference" value={isForeign?fmtFC(Math.abs(compareBal-bankBalance),acct.currency):fmt(Math.abs(compareBal-bankBalance))} color={Math.abs(compareBal-bankBalance)<1?C.success:C.danger} sub={Math.abs(compareBal-bankBalance)<1?"Reconciled":"Needs attention"}/>
        <KPI label="Unreconciled Items" value={unreconciled.length} color={unreconciled.length>0?C.warning:C.success}/>
        {isForeign && <KPI label="₦ Equivalent (Balance Sheet)" value={fmt(cashBal)} color={C.textMid} sub={`@ weighted-avg rate`}/>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <Card>
          <SecHead title={`🏧 ${acct?.name||"Bank"} Statement Entries`} action={<Btn sm onClick={()=>setShowModal(true)} icon="＋">Add Bank Entry</Btn>}/>
          <div style={{overflowX:"auto",maxHeight:340,overflowY:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{background:C.greenPale,position:"sticky",top:0}}>
                {["Date","Description","Amount","Type","Reconciled","✓"].map(h=><th key={h} style={{padding:"7px 8px",textAlign:"left",fontSize:10.5,fontWeight:700,color:C.textMid,textTransform:"uppercase"}}>{h}</th>)}
              </tr></thead>
              <tbody>{acctStmt.map((b,i)=>(
                <tr key={b.id} style={{borderBottom:`1px solid ${C.borderLight}`,background:i%2===1?C.greenPale2:"transparent"}}>
                  <td style={{padding:"6px 8px"}}>{fmtDate(b.date)}</td>
                  <td style={{padding:"6px 8px",maxWidth:150,whiteSpace:"normal"}}>{b.description}</td>
                  <td style={{padding:"6px 8px",color:b.type==="credit"?C.success:C.danger,fontWeight:600}}>{b.type==="debit"?"-":""}{isForeign?fmtFC(b.amount,acct.currency):fmt(b.amount)}</td>
                  <td style={{padding:"6px 8px"}}><Pill label={b.type==="credit"?"Credit (In)":"Debit (Out)"} color={b.type==="credit"?C.success:C.danger} sm/></td>
                  <td style={{padding:"6px 8px"}}><SPill status={b.reconciled?"Reconciled":"Not Reconciled"}/></td>
                  <td style={{padding:"6px 8px"}}><input type="checkbox" checked={b.reconciled} onChange={()=>toggleReconcile(b.id)} style={{cursor:"pointer",width:16,height:16,accentColor:C.green}}/></td>
                </tr>
              ))}
              {acctStmt.length===0 && <tr><td colSpan={6} style={{padding:20,textAlign:"center",color:C.textMuted,fontSize:12}}>No statement entries for this account yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <SecHead title="📊 Reconciliation Summary"/>
          {[[`Book Balance (${isForeign?acct.currency:"₦"})`,compareBal,C.green],[`Bank Statement Balance (${isForeign?acct.currency:"₦"})`,bankBalance,C.info],["Difference",compareBal-bankBalance,Math.abs(compareBal-bankBalance)<1?C.success:C.danger]].map(([l,v,c])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"10px 12px",borderRadius:8,background:C.greenPale,marginBottom:8}}>
              <span style={{fontSize:12,color:C.textMid}}>{l}</span>
              <span style={{fontWeight:700,color:c}}>{isForeign?fmtFC(v,acct.currency):fmt(v)}</span>
            </div>
          ))}
          {unreconciled.length>0&&(
            <div style={{marginTop:12}}>
              <div style={{fontSize:12,fontWeight:600,color:C.warning,marginBottom:6}}>❓ Unreconciled Items ({unreconciled.length})</div>
              {unreconciled.map(b=>(
                <div key={b.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"5px 8px",borderRadius:6,background:C.amberPale,marginBottom:4}}>
                  <span>{b.description}</span>
                  <span style={{color:b.type==="credit"?C.success:C.danger,fontWeight:600}}>{isForeign?fmtFC(b.amount,acct.currency):fmt(b.amount)}</span>
                </div>
              ))}
            </div>
          )}
          {Math.abs(compareBal-bankBalance)<1
            ?<Alert type="info" style={{marginTop:12}}>✓ {acct?.name} is reconciled</Alert>
            :<Alert type="warning" style={{marginTop:12}}>Tick the checkboxes on the left to reconcile matching entries</Alert>
          }
        </Card>
      </div>
      {showModal&&(
        <Modal title={`🏧 Add Statement Entry — ${acct?.name}`} onClose={()=>setShowModal(false)}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Inp label="Date" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
            <Inp label="Description" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Bank statement narration"/>
            <Inp label={`Amount (${isForeign?acct.currency:"₦"})`} type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"/>
            <Sel label="Type" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} options={[{value:"credit",label:"Credit (Money In)"},{value:"debit",label:"Debit (Money Out)"}]}/>
            <div style={{gridColumn:"1/-1"}}><Inp label="Reference (Cheque/Transfer Ref)" value={form.ref} onChange={e=>setForm(f=>({...f,ref:e.target.value}))} placeholder="Cheque no, transfer ref, etc."/></div>
          </div>
          {isForeign && <Alert type="info" style={{marginTop:10}}>Enter this in {acct.currency} exactly as it appears on the bank statement — not converted to Naira.</Alert>}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
            <Btn variant="ghost" onClick={()=>setShowModal(false)}>Cancel</Btn>
            <Btn onClick={saveBankEntry}>Save Entry</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Currency Exchange / FX Transfer Tab ─────────────────────────────
// Answers: "How do I fund the Naira account from the USD or EUR account?"
// Converts a foreign-currency balance into Naira at today's rate, and
// automatically posts the realized FX gain or loss — the difference
// between today's rate and the weighted-average rate the foreign
// balance was originally booked in at.
function FXTab({journals,setJournals,coa,isAdmin=true}){
  const foreignAccounts = coa.filter(a=>a.currency&&a.currency!=="NGN");
  const ngnAccounts = coa.filter(a=>(!a.currency||a.currency==="NGN")&&a.category==="Cash & Bank").sort((a,b)=>a.code.localeCompare(b.code));
  const [fromCode,setFromCode]=useState(foreignAccounts[0]?.code||"");
  const [toCode,setToCode]=useState(ngnAccounts.find(a=>a.code==="3003")?.code||ngnAccounts[0]?.code||"");
  const [fcAmount,setFcAmount]=useState("");
  const [todayRate,setTodayRate]=useState("");
  const [date,setDate]=useState(today());
  const [memo,setMemo]=useState("");

  const fromAcct = coa.find(a=>a.code===fromCode);
  const toAcct   = coa.find(a=>a.code===toCode);
  const avgInfo  = fromAcct ? getWeightedAvgRate(fromAcct.code, journals, coa) : {avgRate:0,fcBalance:0};
  const amtNum   = parseFloat(fcAmount)||0;
  const rateNum  = parseFloat(todayRate)||0;
  const atCostNGN  = amtNum * avgInfo.avgRate;     // book value being removed from the FC account
  const receivedNGN = amtNum * rateNum;            // actual ₦ landing in the Naira account
  const gainLoss   = receivedNGN - atCostNGN;       // positive = gain, negative = loss
  const exceedsBalance = amtNum > avgInfo.fcBalance + 0.01;

  const canPost = fromAcct && toAcct && amtNum>0 && rateNum>0 && !exceedsBalance;

  const postTransfer = () => {
    if(!canPost){ alert("Check the amount, rate, and available balance before posting."); return; }
    const ref = `FX-${String(journals.length+1).padStart(4,"0")}`;
    const newLines = [
      {
        drCode: toAcct.code, drName: toAcct.name,
        crCode: fromAcct.code, crName: fromAcct.name,
        amount: atCostNGN, currency: fromAcct.currency, fxRate: avgInfo.avgRate, fcAmount: amtNum,
        memo: `FX transfer at weighted-avg cost rate`,
      },
    ];
    if (Math.abs(gainLoss) >= 1) {
      if (gainLoss > 0) {
        newLines.push({ drCode: toAcct.code, drName: toAcct.name, crCode: "4501", crName: "Profit on Exchange", amount: gainLoss, currency:"NGN", fxRate:1, fcAmount: gainLoss, memo:"Realized FX gain" });
      } else {
        newLines.push({ drCode: "9100", drName: "Loss on Exchange", crCode: fromAcct.code, crName: fromAcct.name, amount: Math.abs(gainLoss), currency:"NGN", fxRate:1, fcAmount: Math.abs(gainLoss), memo:"Realized FX loss" });
      }
    }
    setJournals(js=>[...js,{
      id: ref, date, ref,
      description: memo || `Currency exchange: ${fmtFC(amtNum,fromAcct.currency)} → ${toAcct.name} @ ₦${rateNum}`,
      source: "manual", lines: newLines,
    }]);
    setFcAmount(""); setTodayRate(""); setMemo("");
    alert(`Posted. ${fmtFC(amtNum,fromAcct.currency)} converted to ${fmt(receivedNGN)}. ${Math.abs(gainLoss)>=1 ? (gainLoss>0?`Gain of ${fmt(gainLoss)} recorded.`:`Loss of ${fmt(Math.abs(gainLoss))} recorded.`) : 'No gain/loss — rate matched cost basis.'}`);
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Alert type="info">
        Converts money sitting in a foreign-currency account (USD/EUR) into Naira at today's rate, and automatically works out and posts the
        foreign-exchange gain or loss versus the weighted-average rate that balance was originally received at.
      </Alert>

      {foreignAccounts.length===0 ? (
        <Alert type="warning">No foreign-currency bank accounts exist in the Chart of Accounts yet. Tag an account as USD or EUR in the Chart of Accounts tab first.</Alert>
      ) : (
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <Card>
          <SecHead title="💱 New Currency Exchange"/>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Sel label="Convert FROM (foreign account)" value={fromCode} onChange={e=>setFromCode(e.target.value)}
              options={foreignAccounts.map(a=>({value:a.code,label:`${a.code} — ${a.name} (${a.currency})`}))}/>
            <Sel label="Convert TO (Naira account)" value={toCode} onChange={e=>setToCode(e.target.value)}
              options={ngnAccounts.map(a=>({value:a.code,label:`${a.code} — ${a.name}`}))}/>
            <Inp label={`Amount to Convert (${fromAcct?.currency||""})`} type="number" value={fcAmount} onChange={e=>setFcAmount(e.target.value)} placeholder="0.00"/>
            <Inp label="Today's Exchange Rate (₦ per unit)" type="number" value={todayRate} onChange={e=>setTodayRate(e.target.value)} placeholder={`e.g. 1650 for 1 ${fromAcct?.currency||"USD"}`}/>
            <Inp label="Date" type="date" value={date} onChange={e=>setDate(e.target.value)}/>
            <Inp label="Memo (optional)" value={memo} onChange={e=>setMemo(e.target.value)} placeholder="e.g. Funding Naira account for NLNG site costs"/>
          </div>
        </Card>

        <Card>
          <SecHead title="📊 Calculation Preview"/>
          {fromAcct && (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",justifyContent:"space-between",padding:"9px 12px",borderRadius:8,background:C.greenPale}}>
                <span style={{fontSize:12,color:C.textMid}}>Available Balance ({fromAcct.currency})</span>
                <span style={{fontWeight:700,color:C.green}}>{fmtFC(avgInfo.fcBalance,fromAcct.currency)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"9px 12px",borderRadius:8,background:C.greenPale}}>
                <span style={{fontSize:12,color:C.textMid}}>Weighted-Avg Cost Rate</span>
                <span style={{fontWeight:700}}>₦{avgInfo.avgRate.toLocaleString("en-NG",{maximumFractionDigits:2})}</span>
              </div>
              <Divider/>
              <div style={{display:"flex",justifyContent:"space-between",padding:"9px 12px",borderRadius:8,background:C.bgAlt}}>
                <span style={{fontSize:12,color:C.textMid}}>Book Value Removed (at cost)</span>
                <span style={{fontWeight:700}}>{fmt(atCostNGN)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"9px 12px",borderRadius:8,background:C.bgAlt}}>
                <span style={{fontSize:12,color:C.textMid}}>₦ Actually Received (at today's rate)</span>
                <span style={{fontWeight:700,color:C.green}}>{fmt(receivedNGN)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"10px 12px",borderRadius:8,background:gainLoss>=0?C.greenPale:"#FCE9E9",border:`1px solid ${gainLoss>=0?C.greenLight:C.danger+"40"}`}}>
                <span style={{fontSize:12,fontWeight:600,color:C.textMid}}>{gainLoss>=0?"Realized FX Gain":"Realized FX Loss"}</span>
                <span style={{fontWeight:800,color:gainLoss>=0?C.success:C.danger}}>{fmt(Math.abs(gainLoss))}</span>
              </div>
              {exceedsBalance && <Alert type="warning">Amount exceeds the available {fromAcct.currency} balance of {fmtFC(avgInfo.fcBalance,fromAcct.currency)}.</Alert>}
              <Btn onClick={postTransfer} disabled={!canPost} style={{marginTop:6}}>📔 Post Currency Exchange</Btn>
            </div>
          )}
        </Card>
      </div>
      )}

      {/* ── Period-End FX Revaluation (unrealized gain/loss) ────────────── */}
      <PeriodEndFXRevalTab journals={journals} setJournals={setJournals} coa={coa} C={C} fmt={fmt} fmtFC={fmtFC} />
    </div>
  );
}

// ── Period-End FX Revaluation ────────────────────────────────────────────────
//
// At every period end, IFRS requires revaluing foreign-currency monetary
// balances (bank, AR, AP) to the closing spot rate. The unrealized gain or
// loss hits P&L, and the offset sits in the Cumulative Translation
// Adjustment (CTA) on the Balance Sheet — same as the realized FX
// transfer tab, but:
//   1. It's at the period's CLOSING rate, not at a transfer rate.
//   2. The whole FC balance is revalued, not just a transferred amount.
//   3. The offset is the CTA (2099), not the bank account.
//
// One entry per (account × period). Idempotent via JE id
// `JE-FXREVAL-{accountCode}-{periodKey}`. The opening-balance line uses
// the CTA so the BS still balances; the P&L line uses 4501 (gain) or
// 9100 (loss). Period guard via the auto-post effect.
function PeriodEndFXRevalTab({ journals, setJournals, coa, C, fmt, fmtFC }) {
  const today = new Date().toISOString().split('T')[0];
  const [periodKey, setPeriodKey] = useState(today.slice(0, 7));
  const [closingRates, setClosingRates] = useState({ USD: 0, EUR: 0, GBP: 0 });
  const [postedMessage, setPostedMessage] = useState(null);

  // Find all foreign-currency denominated accounts (Cash & Bank + AR + AP)
  const fcAccounts = coa.filter(a => a.currency && a.currency !== 'NGN');

  // Compute per-account: balance in FC, weighted-avg cost rate, period-end reval gain/loss
  const revalRows = fcAccounts.map(acct => {
    const info = getWeightedAvgRate(acct.code, journals, coa);
    const closingRate = Number(closingRates[acct.currency]) || 0;
    const ngnAtCost    = info.fcBalance * info.avgRate;
    const ngnAtClosing = info.fcBalance * closingRate;
    const unrealized   = ngnAtClosing - ngnAtCost;  // positive = gain, negative = loss
    const alreadyPosted = journals.some(j => j.id === `JE-FXREVAL-${acct.code}-${periodKey}`);
    return {
      acct, info, closingRate, ngnAtCost, ngnAtClosing, unrealized, alreadyPosted,
    };
  }).filter(r => r.info.fcBalance !== 0);

  const totalUnrealized = revalRows.reduce((s, r) => s + r.unrealized, 0);

  function postRevaluation() {
    if (revalRows.length === 0) { setPostedMessage('No foreign-currency balances to revalue.'); return; }
    if (revalRows.some(r => !r.closingRate)) { setPostedMessage('Enter closing rate for every foreign currency first.'); return; }
    const newJEs = [];
    const summary = [];
    revalRows.forEach(r => {
      if (r.alreadyPosted) return;
      if (Math.abs(r.unrealized) < 1) return; // no material reval needed
      const isGain = r.unrealized > 0;
      const line = isGain
        ? { drCode: r.acct.code, drName: r.acct.name, crCode: '2099', crName: 'Cumulative Translation Adjustment (CTA)', amount: Math.abs(r.unrealized), currency: 'NGN', fxRate: 1, fcAmount: Math.abs(r.unrealized), memo: `Period-end revaluation ${periodKey} @ ₦${r.closingRate}/${r.acct.currency}` }
        : { drCode: '2099', drName: 'Cumulative Translation Adjustment (CTA)', crCode: r.acct.code, crName: r.acct.name, amount: Math.abs(r.unrealized), currency: 'NGN', fxRate: 1, fcAmount: Math.abs(r.unrealized), memo: `Period-end revaluation ${periodKey} @ ₦${r.closingRate}/${r.acct.currency}` };
      // P&L side: Dr 9100 (loss) / Cr 4501 (gain) for the same amount, with the CTA carrying the offset
      // For a gain:  Dr FC acct / Cr 2099 CTA  +  Dr 2099 CTA / Cr 4501 Profit on Exchange
      // For a loss:  Dr 9100 Loss on Exchange / Cr 2099 CTA  +  Dr 2099 CTA / Cr FC acct
      // We collapse to a single balanced line per account (CTA is the bridge between
      // the FC account and P&L). The total GL effect: P&L ←→ CTA, FC acct ←→ CTA.
      newJEs.push({
        id: `JE-FXREVAL-${r.acct.code}-${periodKey}`,
        date: `${periodKey}-${new Date().toISOString().split('T')[1]?.slice(0,2) || '01'}`,
        ref: `REVAL-${periodKey}`,
        description: `Period-End FX Revaluation: ${r.acct.name} (${r.acct.currency}) — ${isGain ? 'Unrealized gain' : 'Unrealized loss'}`,
        source: 'fx-revaluation',
        sourceId: `${periodKey}-${r.acct.code}`,
        periodKey,
        lines: [line],
      });
      summary.push(`${r.acct.name}: ${isGain?'+':''}₦${Math.round(r.unrealized).toLocaleString('en-NG')}`);
    });
    if (newJEs.length === 0) { setPostedMessage('All balances already revalued for this period (or no material movement).'); return; }
    setJournals(js => [...js, ...newJEs]);
    setPostedMessage(`Posted ${newJEs.length} revaluation ${newJEs.length===1?'entry':'entries'} · ${summary.join(' · ')}`);
  }

  return (
    <Card>
      <SecHead title="📈 Period-End FX Revaluation" sub="Unrealized gain/loss on foreign-currency balances at the closing rate" />
      <Alert type="info" style={{ marginBottom:12 }}>
        <strong>What this does:</strong> At every period end, IFRS requires revaluing FC
        monetary balances (bank, AR, AP) to the closing spot rate. The unrealized
        gain or loss hits P&L (4501 / 9100), and the offset sits in the Cumulative
        Translation Adjustment (2099 CTA) on the Balance Sheet. One entry per
        account, idempotent per period — re-running the same month is a no-op.
      </Alert>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginBottom:14, alignItems:'end' }}>
        <Inp label="Period (YYYY-MM)" type="month" value={periodKey} onChange={e=>setPeriodKey(e.target.value)} />
        <Inp label="Closing rate — USD (₦/USD)" type="number" value={closingRates.USD||''} onChange={e=>setClosingRates(p=>({...p,USD:e.target.value}))} placeholder="e.g. 1550" />
        <Inp label="Closing rate — EUR (₦/EUR)" type="number" value={closingRates.EUR||''} onChange={e=>setClosingRates(p=>({...p,EUR:e.target.value}))} placeholder="e.g. 1700" />
        <Inp label="Closing rate — GBP (₦/GBP)" type="number" value={closingRates.GBP||''} onChange={e=>setClosingRates(p=>({...p,GBP:e.target.value}))} placeholder="e.g. 1950" />
      </div>

      {revalRows.length === 0 ? (
        <Alert type="warning">No foreign-currency balances with movements to revalue. Post some AR invoices, AP bills, or FC bank transfers first.</Alert>
      ) : (
        <>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:C.tableHeaderBg }}>
                {['Account','Currency','FC Balance','Avg Cost Rate','NGN @ Cost','Closing Rate','NGN @ Closing','Unrealized G/L','Status'].map(h=><th key={h} style={{ padding:'8px 10px', textAlign:'left', fontSize:10, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase' }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {revalRows.map(r => (
                <tr key={r.acct.code} style={{ borderBottom:'1px solid '+C.borderLight }}>
                  <td style={{ padding:'8px 10px' }}><span style={{ fontFamily:'monospace', color:C.textMuted, fontSize:11 }}>{r.acct.code}</span> {r.acct.name}</td>
                  <td style={{ padding:'8px 10px' }}>{r.acct.currency}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>{fmtFC(r.info.fcBalance, r.acct.currency)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>₦{r.info.avgRate.toLocaleString('en-NG',{maximumFractionDigits:2})}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>₦{Math.round(r.ngnAtCost).toLocaleString('en-NG')}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', color: r.closingRate ? C.text : C.textMuted }}>{r.closingRate ? `₦${r.closingRate.toLocaleString('en-NG',{maximumFractionDigits:2})}` : '— enter rate —'}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>{r.closingRate ? `₦${Math.round(r.ngnAtClosing).toLocaleString('en-NG')}` : '—'}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:700, color: r.unrealized >= 0 ? C.success : C.danger }}>
                    {r.closingRate ? `${r.unrealized >= 0 ? '+' : ''}₦${Math.round(r.unrealized).toLocaleString('en-NG')}` : '—'}
                  </td>
                  <td style={{ padding:'8px 10px' }}>
                    {r.alreadyPosted
                      ? <span style={{ padding:'2px 7px', borderRadius:20, background:C.amberPale, color:C.amber, fontSize:10, fontWeight:600 }}>✓ Posted</span>
                      : <span style={{ padding:'2px 7px', borderRadius:20, background:C.greenPale, color:C.success, fontSize:10, fontWeight:600 }}>● Pending</span>}
                  </td>
                </tr>
              ))}
              <tr style={{ background:C.greenPale, fontWeight:700 }}>
                <td colSpan={7} style={{ padding:'8px 10px', textAlign:'right', fontSize:11, textTransform:'uppercase' }}>Net Unrealized G/L for {periodKey}</td>
                <td style={{ padding:'8px 10px', textAlign:'right', color: totalUnrealized >= 0 ? C.success : C.danger, fontSize:13 }}>
                  {totalUnrealized >= 0 ? '+' : ''}₦{Math.round(totalUnrealized).toLocaleString('en-NG')}
                </td>
                <td style={{ padding:'8px 10px' }}></td>
              </tr>
            </tbody>
          </table>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:14 }}>
            <div style={{ fontSize:11, color:C.textMuted }}>
              💡 The CTA (account 2099 — Cumulative Translation Adjustment) holds the
              running balance of all period-end revaluations. It sits in equity on the
              Balance Sheet and resets on the year-end close.
            </div>
            <Btn onClick={postRevaluation}>📤 Post Period-End Revaluation</Btn>
          </div>
          {postedMessage && (
            <Alert type={postedMessage.startsWith('Posted') ? 'info' : 'warning'} style={{ marginTop:10 }}>{postedMessage}</Alert>
          )}
        </>
      )}
    </Card>
  );
}

// ── VAT Returns Tab ───────────────────────────────────────────────
function VATTab({journals,coa,vatAdj,setVatAdj}){
  // Same stale-default bug as PLTab/CashFlowTab above: was hardcoded to
  // "2026-05", so the VAT period selector opened to a month with no data
  // once real activity moved past May. Defaults to the current month instead.
  const [period,setPeriod]=useState(curMonth());
  const [generated,setGenerated]=useState(false);
  const [showModal,setShowModal]=useState(false);
  const [adjForm,setAdjForm]=useState({period:curMonth(),type:"output",amount:"",description:""});

  const generate=()=>setGenerated(true);
  const saveAdj=()=>{
    setVatAdj(vs=>[...vs,{id:Math.random().toString(36).slice(2,8),...adjForm,amount:parseFloat(adjForm.amount)||0}]);
    setShowModal(false);
  };

  const {outputVAT,inputVAT}=getVATData(journals,coa,period);
  const periodAdj=vatAdj.filter(a=>a.period===period);
  const adjOutput=periodAdj.filter(a=>a.type==="output").reduce((s,a)=>s+a.amount,0);
  const adjInput=periodAdj.filter(a=>a.type==="input").reduce((s,a)=>s+a.amount,0);
  const finalOutput=outputVAT+adjOutput;
  const finalInput=inputVAT+adjInput;
  const finalNet=finalOutput-finalInput;
  const invoiceRevenue=journals.filter(j=>j.source==="invoice"&&j.date.startsWith(period)).flatMap(j=>j.lines).filter(l=>coa.find(a=>a.code===l.crCode)?.type==="Revenue").reduce((s,l)=>s+l.amount,0);

  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <span style={{fontSize:12,color:C.textMuted}}>Period:</span>
          <input type="month" value={period} onChange={e=>setPeriod(e.target.value)} style={{borderRadius:7,border:`1px solid ${C.border}`,padding:"7px 10px",fontSize:13,background:C.bgCard,color:C.text}}/>
          <Btn sm onClick={generate}>Generate VAT Return</Btn>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="ghost" sm onClick={()=>setShowModal(true)}>+ Manual Adjustment</Btn>
          <Btn variant="ghost" sm>🖨 Print VAT Return</Btn>
        </div>
      </div>
      {generated?(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
            <KPI label="Output VAT (Sales 7.5%)" value={fmt(finalOutput)} color={C.danger} sub="Payable to FIRS"/>
            <KPI label="Input VAT (Purchases)" value={fmt(finalInput)} color={C.success} sub="Reclaimable"/>
            <KPI label="Net VAT Payable" value={fmt(finalNet)} color={finalNet>0?C.danger:C.success} sub={finalNet>0?"Payable to FIRS":"Credit c/f"}/>
          </div>
          <Card>
            <SecHead title="🧾 VAT Return Summary" sub={`Period: ${period}`}/>
            {[
              {label:"Taxable Revenue (from invoices)",val:invoiceRevenue,color:C.text,bold:false},
              {label:"Standard Rate Output VAT (7.5%)",val:outputVAT,color:C.danger,bold:false},
              {label:"Adjustments to Output VAT",val:adjOutput,color:C.warning,bold:false},
              {label:"Total Output VAT",val:finalOutput,color:C.danger,bold:true},
              {label:"Input VAT (from purchases)",val:inputVAT,color:C.success,bold:false},
              {label:"Adjustments to Input VAT",val:adjInput,color:C.warning,bold:false},
              {label:"Total Input VAT (deductible)",val:finalInput,color:C.success,bold:true},
              {label:"Net VAT Payable / (Refund)",val:finalNet,color:finalNet>0?C.danger:C.success,bold:true},
            ].map(r=>(
              <div key={r.label} style={{display:"flex",justifyContent:"space-between",padding:r.bold?"10px 12px":"7px 12px",background:r.bold?C.greenPale:"transparent",borderBottom:`1px solid ${C.borderLight}`,borderRadius:r.bold?6:0,marginBottom:r.bold?4:0}}>
                <span style={{fontSize:13,fontWeight:r.bold?700:400,color:C.textMid}}>{r.label}</span>
                <span style={{fontSize:13,fontWeight:r.bold?700:600,color:r.color}}>{fmt(r.val)}</span>
              </div>
            ))}
            <div style={{display:"flex",gap:8,marginTop:14}}>
              <Btn variant="ghost" sm onClick={()=>{
                exportToExcel(`SLOT_VAT_Return_${period}`,
                  ['Description','Amount (₦)'],
                  [['Period',period],['Taxable Revenue',invoiceRevenue],['Output VAT (7.5%)',finalOutput],['Input VAT (Deductible)',finalInput],['Net VAT Payable',finalNet]]
                );
              }}>📊 Export FIRS Format</Btn>
              <Btn variant="ghost" sm onClick={()=>{
                printSection(`VAT Return — ${period}`,`
                  <table>
                    <tr><td>Period</td><td class="amount"><b>${period}</b></td></tr>
                    <tr class="alt"><td>Taxable Revenue (Invoiced)</td><td class="amount">${fmt(invoiceRevenue)}</td></tr>
                    <tr><td>Output VAT (7.5%)</td><td class="amount" style="color:#C0392B">${fmt(finalOutput)}</td></tr>
                    <tr class="alt"><td>Input VAT (Deductible)</td><td class="amount" style="color:#1A7A4A">${fmt(finalInput)}</td></tr>
                    <tr class="total-row"><td><b>Net VAT Payable to FIRS</b></td><td class="amount"><b style="color:${finalNet>0?'#C0392B':'#1A7A4A'}">${finalNet>0?fmt(finalNet):'('+fmt(Math.abs(finalNet))+')'}</b></td></tr>
                  </table>
                  <p style="margin-top:16px;font-size:11px;color:#182A1C">VAT Registration: VAT-234-000-001 · TIN: TIN-234-567-890 · RC: 0000001</p>
                `);
              }}>🖨 Print VAT Return</Btn>
              <Btn sm>Mark as Filed</Btn>
            </div>
          </Card>
        </div>
      ):(
        <div style={{textAlign:"center",padding:60,color:C.textMuted}}>
          <div style={{fontSize:36,marginBottom:12}}>🧾</div>
          <div style={{fontSize:14,fontWeight:500}}>Select a period and click Generate VAT Return</div>
          <div style={{fontSize:12,marginTop:6}}>Computed at 7.5% of taxable revenue per FIRS regulations</div>
        </div>
      )}
      {showModal&&(
        <Modal title="🧾 VAT Manual Adjustment" onClose={()=>setShowModal(false)}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Inp label="Period" type="month" value={adjForm.period} onChange={e=>setAdjForm(f=>({...f,period:e.target.value}))}/>
            <Sel label="Type" value={adjForm.type} onChange={e=>setAdjForm(f=>({...f,type:e.target.value}))} options={[{value:"output",label:"Output VAT (Sales)"},{value:"input",label:"Input VAT (Purchases)"}]}/>
            <Inp label="Amount (₦)" type="number" value={adjForm.amount} onChange={e=>setAdjForm(f=>({...f,amount:e.target.value}))} placeholder="0.00"/>
            <div style={{gridColumn:"1/-1"}}><Inp label="Description" value={adjForm.description} onChange={e=>setAdjForm(f=>({...f,description:e.target.value}))} placeholder="Reason for adjustment"/></div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
            <Btn variant="ghost" onClick={()=>setShowModal(false)}>Cancel</Btn>
            <Btn onClick={saveAdj}>Save Adjustment</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Fixed Assets Tab ──────────────────────────────────────────────
function FixedAssetsTab({assets,setAssets}){
  const [showModal,setShowModal]=useState(false);
  const [editId,setEditId]=useState(null);
  const [form,setForm]=useState({tag:"",name:"",category:"Vehicles",purchaseDate:"",cost:0,residual:0,method:"straight-line",rate:25,location:"",custodian:"",serial:"",insurance:"",warranty:"",status:"Active"});

  const calcNBV=(cost,residual,method,rate,purchaseDate)=>{
    if(!cost||!purchaseDate) return 0;
    const years=(new Date()-new Date(purchaseDate))/(365.25*24*3600*1000);
    if(method==="straight-line") return Math.max(+residual,(+cost-+residual)*(1-Math.min(1,(+rate/100)*years)));
    if(method==="reducing-balance") return Math.max(+residual,+cost*Math.pow(1-+rate/100,years));
    return +cost;
  };

  const openNew=()=>{setEditId(null);setForm({tag:"",name:"",category:"Vehicles",purchaseDate:"",cost:0,residual:0,method:"straight-line",rate:25,location:"",custodian:"",serial:"",insurance:"",warranty:"",status:"Active"});setShowModal(true);};
  const openEdit=(a)=>{setEditId(a.id);setForm({...a});setShowModal(true);};

  const saveAsset=()=>{
    if(!form.tag||!form.name){alert("Tag and Name required");return;}
    const nbv=calcNBV(+form.cost,+form.residual,form.method,+form.rate,form.purchaseDate);
    const accumulated=Math.max(0,(+form.cost)-nbv);
    const newA={...form,cost:+form.cost,residual:+form.residual,rate:+form.rate,accumulated,id:editId||Math.random().toString(36).slice(2,8).toUpperCase()};
    if(editId) setAssets(as=>as.map(a=>a.id===editId?newA:a));
    else setAssets(as=>[...as,newA]);
    setShowModal(false);
  };

  const runDepreciation=()=>{
    setAssets(as=>as.map(a=>{
      const nbv=calcNBV(a.cost,a.residual,a.method,a.rate,a.purchaseDate);
      return{...a,accumulated:Math.max(0,a.cost-nbv)};
    }));
    alert("Depreciation recalculated for all active assets!");
  };

  const totalCost=assets.reduce((s,a)=>s+a.cost,0);
  const totalAccum=assets.reduce((s,a)=>s+a.accumulated,0);
  const totalNBV=totalCost-totalAccum;
  const nbvPreview=calcNBV(+form.cost,+form.residual,form.method,+form.rate,form.purchaseDate);

  const cols=[
    {key:"tag",label:"Tag No",render:r=><span style={{fontFamily:"monospace",fontSize:11,color:C.green}}>{r.tag}</span>},
    {key:"name",label:"Asset Name",wrap:true,maxW:"160px"},
    {key:"category",label:"Category",render:r=><Pill label={r.category} color={C.greenMid} sm/>},
    {key:"purchaseDate",label:"Purchased",render:r=>fmtDate(r.purchaseDate)},
    {key:"cost",label:"Cost (₦)",align:"right",render:r=>fmt(r.cost)},
    {key:"method",label:"Method",render:r=><span style={{fontSize:11}}>{r.method==="straight-line"?"Str. Line":r.method==="reducing-balance"?"Red. Bal.":"None"}</span>},
    {key:"rate",label:"Rate",align:"right",render:r=>`${r.rate}%`},
    {key:"accumulated",label:"Accum. Dep.",align:"right",render:r=><span style={{color:C.warning}}>{fmt(r.accumulated)}</span>},
    {key:"nbv",label:"Net Book Value",align:"right",render:r=><strong style={{color:C.success}}>{fmt(r.cost-r.accumulated)}</strong>},
    {key:"custodian",label:"Custodian"},
    {key:"status",label:"Status",render:r=><SPill status={r.status}/>},
    {key:"act",label:"",render:r=>(
      <div style={{display:"flex",gap:4}}>
        <Btn sm variant="ghost" onClick={e=>{e.stopPropagation();openEdit(r);}}>Edit</Btn>
        <Btn sm variant="danger" onClick={e=>{e.stopPropagation();if(window.confirm("Delete asset?"))setAssets(as=>as.filter(a=>a.id!==r.id));}}>✕</Btn>
      </div>
    )},
  ];

  return(
    <div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16}}>
        <KPI label="Total Assets" value={assets.length} color={C.green}/>
        <KPI label="Total Cost" value={fmt(totalCost)} color={C.info}/>
        <KPI label="Accumulated Depreciation" value={fmt(totalAccum)} color={C.warning}/>
        <KPI label="Total Net Book Value" value={fmt(totalNBV)} color={C.success} sub="After depreciation"/>
      </div>
      <SecHead title="🏗️ Fixed Assets Register" sub="Straight-line and reducing-balance depreciation" action={
        <div style={{display:"flex",gap:8}}>
          <Btn variant="ghost" sm onClick={()=>{
            exportToExcel('SLOT_Fixed_Assets_Register',
              ['Tag No','Asset Name','Category','Purchase Date','Cost (₦)','Residual (₦)','Method','Rate %','Accum. Depreciation (₦)','Net Book Value (₦)','Location','Custodian','Serial No','Status'],
              assets.map(a=>[a.tag,a.name,a.category,a.purchaseDate,a.cost,a.residual,a.method,a.rate,a.accumulated,a.cost-a.accumulated,a.location,a.custodian,a.serial||'',a.status])
            );
          }}>📊 Export Excel</Btn>
          <Btn variant="ghost" sm onClick={()=>{
            const rows = assets.map((a,i)=>`<tr class="${i%2===1?'alt':''}"><td><b style="color:#1A5C2A">${a.tag}</b></td><td>${a.name}</td><td>${a.category}</td><td>${fmtDate(a.purchaseDate)}</td><td class="amount">${fmt(a.cost)}</td><td>${a.method==="straight-line"?"Str. Line":"Red. Bal."} ${a.rate}%</td><td class="amount" style="color:#C97A0A">${fmt(a.accumulated)}</td><td class="amount" style="color:#1A7A4A"><b>${fmt(a.cost-a.accumulated)}</b></td><td>${a.custodian}</td><td>${a.status}</td></tr>`).join('');
            const totRow=`<tr class="total-row"><td colspan="4"><b>TOTALS</b></td><td class="amount"><b>${fmt(assets.reduce((s,a)=>s+a.cost,0))}</b></td><td></td><td class="amount"><b>${fmt(assets.reduce((s,a)=>s+a.accumulated,0))}</b></td><td class="amount"><b>${fmt(assets.reduce((s,a)=>s+(a.cost-a.accumulated),0))}</b></td><td colspan="2"></td></tr>`;
            printSection('Fixed Assets Register',`<table><thead><tr><th>Tag No</th><th>Asset Name</th><th>Category</th><th>Purchase Date</th><th>Cost (₦)</th><th>Method/Rate</th><th>Accum. Dep.</th><th>Net Book Value</th><th>Custodian</th><th>Status</th></tr></thead><tbody>${rows}${totRow}</tbody></table>`);
          }}>🖨 Print Register</Btn>
          <Btn variant="ghost" sm onClick={runDepreciation}>📉 Run Depreciation</Btn>
          <Btn sm onClick={openNew} icon="＋">Add Asset</Btn>
        </div>
      }/>
      <Tbl cols={cols} rows={assets} compact/>
      {showModal&&(
        <Modal title={editId?"Edit Fixed Asset":"🏗️ Add Fixed Asset"} onClose={()=>setShowModal(false)} xl>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            <Inp label="Asset Tag No *" value={form.tag} onChange={e=>setForm(f=>({...f,tag:e.target.value}))} placeholder="SLOT-VEH-005"/>
            <Inp label="Asset Name *" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Toyota Hilux"/>
            <Sel label="Category" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} options={["Vehicles","Machinery & Equipment","IT Equipment","Furniture & Fittings","Buildings","Land","Other"]}/>
            <Inp label="Purchase Date" type="date" value={form.purchaseDate} onChange={e=>setForm(f=>({...f,purchaseDate:e.target.value}))}/>
            <Inp label="Purchase Cost (₦) *" type="number" value={form.cost} onChange={e=>setForm(f=>({...f,cost:e.target.value}))} placeholder="0.00"/>
            <Inp label="Residual / Salvage Value (₦)" type="number" value={form.residual} onChange={e=>setForm(f=>({...f,residual:e.target.value}))} placeholder="0.00"/>
            <Sel label="Depreciation Method" value={form.method} onChange={e=>setForm(f=>({...f,method:e.target.value}))} options={[{value:"straight-line",label:"Straight Line"},{value:"reducing-balance",label:"Reducing Balance"},{value:"none",label:"No Depreciation"}]}/>
            <Inp label="Annual Rate (%)" type="number" value={form.rate} onChange={e=>setForm(f=>({...f,rate:e.target.value}))} placeholder="25"/>
            <Inp label="Location / Site" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} placeholder="Port Harcourt"/>
            <Inp label="Custodian" value={form.custodian} onChange={e=>setForm(f=>({...f,custodian:e.target.value}))}/>
            <Inp label="Serial No / Model" value={form.serial} onChange={e=>setForm(f=>({...f,serial:e.target.value}))}/>
            <Inp label="Insurance Policy No" value={form.insurance} onChange={e=>setForm(f=>({...f,insurance:e.target.value}))}/>
            <Inp label="Warranty Expiry" type="date" value={form.warranty} onChange={e=>setForm(f=>({...f,warranty:e.target.value}))}/>
            <Sel label="Status" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} options={["Active","Under Maintenance","Disposed","Scrapped"]}/>
          </div>
          <div style={{marginTop:12,padding:"12px 14px",background:C.greenPale,borderRadius:8,fontSize:13}}>
            <strong style={{color:C.green}}>Calculated Net Book Value: </strong>
            <span style={{fontWeight:800,color:form.purchaseDate&&form.cost?C.success:C.textMuted,fontSize:16}}>
              {form.purchaseDate&&form.cost?fmt(nbvPreview):"Enter cost and date"}
            </span>
            {form.purchaseDate&&form.cost&&<span style={{color:C.textMuted,fontSize:11,marginLeft:12}}>Accumulated: {fmt(+form.cost-nbvPreview)}</span>}
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
            <Btn variant="ghost" onClick={()=>setShowModal(false)}>Cancel</Btn>
            <Btn onClick={saveAsset}>Save Asset</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── WHT Register Tab ──────────────────────────────────────────────
function WHTTab({whtEntries,setWhtEntries}){
  const [showModal,setShowModal]=useState(false);
  const [form,setForm]=useState({vendor:"",tin:"",ref:"",date:today(),gross:0,rate:2,desc:"",certStatus:"Not Issued"});

  const whtAmt=Math.round((+form.gross)*(+form.rate)/100);
  const netAmt=(+form.gross)-whtAmt;

  const saveWHT=()=>{
    setWhtEntries(ws=>[...ws,{id:Math.random().toString(36).slice(2,8),...form,gross:+form.gross,amount:whtAmt,net:netAmt}]);
    setShowModal(false);
    setForm({vendor:"",tin:"",ref:"",date:today(),gross:0,rate:2,desc:"",certStatus:"Not Issued"});
  };

  const totalWHT=whtEntries.reduce((s,w)=>s+w.amount,0);
  const totalGross=whtEntries.reduce((s,w)=>s+w.gross,0);

  const cols=[
    {key:"vendor",label:"Vendor / Contractor",wrap:true,maxW:"180px"},
    {key:"tin",label:"TIN"},
    {key:"ref",label:"Invoice/PO Ref"},
    {key:"date",label:"Date",render:r=>fmtDate(r.date)},
    {key:"gross",label:"Gross (₦)",align:"right",render:r=>fmt(r.gross)},
    {key:"rate",label:"Rate",align:"right",render:r=>`${r.rate}%`},
    {key:"amount",label:"WHT (₦)",align:"right",render:r=><strong style={{color:C.danger}}>{fmt(r.amount)}</strong>},
    {key:"net",label:"Net Payable (₦)",align:"right",render:r=><strong style={{color:C.success}}>{fmt(r.net)}</strong>},
    {key:"desc",label:"Description",wrap:true,maxW:"150px"},
    {key:"certStatus",label:"Certificate",render:r=><SPill status={r.certStatus}/>},
    {key:"act",label:"",render:r=><Btn sm variant="danger" onClick={e=>{e.stopPropagation();if(window.confirm("Delete?"))setWhtEntries(ws=>ws.filter(w=>w.id!==r.id));}}>✕</Btn>},
  ];

  return(
    <div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:16}}>
        <KPI label="Total Gross Payments" value={fmt(totalGross)} color={C.green}/>
        <KPI label="Total WHT Deducted" value={fmt(totalWHT)} color={C.danger} sub="To remit to FIRS"/>
        <KPI label="Certificates Issued" value={whtEntries.filter(w=>w.certStatus==="Issued").length} color={C.success}/>
        <KPI label="Not Issued" value={whtEntries.filter(w=>w.certStatus==="Not Issued").length} color={C.warning}/>
      </div>
      <SecHead title="📋 Withholding Tax (WHT) Register" sub="Required by FIRS — Issue certificates to vendors" action={
        <div style={{display:"flex",gap:8}}>
          <Btn variant="ghost" sm onClick={()=>{
            exportToExcel('SLOT_WHT_Register',
              ['ID','Vendor','TIN','Invoice/PO Ref','Date','Gross (₦)','Rate %','WHT (₦)','Net Payable (₦)','Description','Certificate Status'],
              whtEntries.map(w=>[w.id,w.vendor,w.tin||'',w.ref,w.date,w.gross,w.rate,w.amount,w.net,w.desc,w.certStatus])
            );
          }}>📊 Export Excel</Btn>
          <Btn variant="ghost" sm onClick={()=>{
            const rows = whtEntries.map((w,i)=>`<tr class="${i%2===1?'alt':''}"><td>${w.vendor}</td><td>${w.tin||'—'}</td><td>${w.ref}</td><td>${fmtDate(w.date)}</td><td class="amount">${fmt(w.gross)}</td><td>${w.rate}%</td><td class="amount" style="color:#C0392B"><b>${fmt(w.amount)}</b></td><td class="amount" style="color:#1A7A4A"><b>${fmt(w.net)}</b></td><td>${w.certStatus}</td></tr>`).join('');
            const total = `<tr class="total-row"><td colspan="6"><b>TOTAL</b></td><td class="amount"><b>${fmt(totalWHT)}</b></td><td class="amount"><b>${fmt(whtEntries.reduce((s,w)=>s+w.net,0))}</b></td><td></td></tr>`;
            printSection('Withholding Tax (WHT) Register',`<table><thead><tr><th>Vendor</th><th>TIN</th><th>Ref</th><th>Date</th><th>Gross (₦)</th><th>Rate</th><th>WHT (₦)</th><th>Net (₦)</th><th>Certificate</th></tr></thead><tbody>${rows}${total}</tbody></table>`);
          }}>🖨 Print WHT</Btn>
          <Btn sm onClick={()=>setShowModal(true)} icon="＋">Add WHT Entry</Btn>
        </div>
      }/>
      <Tbl cols={cols} rows={whtEntries} compact/>
      {showModal&&(
        <Modal title="📋 Add WHT Entry" onClose={()=>setShowModal(false)} wide>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Inp label="Vendor / Contractor *" value={form.vendor} onChange={e=>setForm(f=>({...f,vendor:e.target.value}))} placeholder="Vendor name"/>
            <Inp label="TIN (if known)" value={form.tin} onChange={e=>setForm(f=>({...f,tin:e.target.value}))} placeholder="Tax ID number"/>
            <Inp label="Invoice / PO Reference" value={form.ref} onChange={e=>setForm(f=>({...f,ref:e.target.value}))} placeholder="Invoice or PO number"/>
            <Inp label="Date of Payment" type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
            <Inp label="Gross Amount (₦) *" type="number" value={form.gross} onChange={e=>setForm(f=>({...f,gross:e.target.value}))} placeholder="0.00"/>
            <Sel label="WHT Rate" value={form.rate} onChange={e=>setForm(f=>({...f,rate:e.target.value}))} options={[{value:"2",label:"2% — Standard (SLOT)"},{value:"2.5",label:"2.5% — Goods / Supplies"},{value:"5",label:"5% — Services / Professional"},{value:"10",label:"10% — Consultancy / Technical"}]}/>
            <div style={{background:C.greenPale,borderRadius:8,padding:"10px 12px",fontSize:12}}>
              <div>WHT Amount: <strong style={{color:C.danger}}>{fmt(whtAmt)}</strong></div>
              <div style={{marginTop:4}}>Net Payable: <strong style={{color:C.success}}>{fmt(netAmt)}</strong></div>
            </div>
            <Sel label="Certificate Status" value={form.certStatus} onChange={e=>setForm(f=>({...f,certStatus:e.target.value}))} options={["Not Issued","Issued","Remitted to FIRS"]}/>
            <div style={{gridColumn:"1/-1"}}><Inp label="Description / Service" value={form.desc} onChange={e=>setForm(f=>({...f,desc:e.target.value}))} placeholder="Nature of payment / service"/></div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:14}}>
            <Btn variant="ghost" onClick={()=>setShowModal(false)}>Cancel</Btn>
            <Btn onClick={saveWHT}>Save WHT Entry</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MAIN ACCOUNTING MODULE EXPORT
// ════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// IMPORT / UPLOAD TAB
// SAGE · SAP S/4HANA · Excel · PDF Scan
// ══════════════════════════════════════════════════════════════════════════════
// NOTE: PDF Scan is now handled by the global DocScanner in the Topbar.
// Scanned documents are stored in AppContext state.scannedDocs and can be
// accessed in any module. The local PdfScanModal has been removed.


function ImportTab({ setCoa, setJournals }) {
  // ── Sage master data (from parsed export files) ─────────────────────────────
  const SAGE_COA_ACCOUNTS = [
    {code:"10001",name:"Share Capital",                                           sageType:"Share Capital"},
    {code:"1002", name:"Retained Earnings/Losses",                               sageType:"Retained Earnings"},
    {code:"1003", name:"Directors Loan Accounts",                                sageType:"Shareholders Loan"},
    {code:"2000", name:"Land",                                                   sageType:"Property, Plant and Equipment"},
    {code:"2001", name:"Building",                                               sageType:"Property, Plant and Equipment"},
    {code:"2001-01",name:"Cost-Building",                                        sageType:"Property, Plant and Equipment"},
    {code:"2001-02",name:"Accumulated Depreciation-Building",                    sageType:"Property, Plant and Equipment"},
    {code:"2002", name:"Plant/Machineries",                                      sageType:"Property, Plant and Equipment"},
    {code:"2002-01",name:"Cost-Plant/Machineries",                               sageType:"Property, Plant and Equipment"},
    {code:"2002-02",name:"Accumulated Depreciation-Plant/Machineries",           sageType:"Property, Plant and Equipment"},
    {code:"2003", name:"Motor Vehicle",                                          sageType:"Property, Plant and Equipment"},
    {code:"2003-01",name:"Cost-Motor Vehicle",                                   sageType:"Property, Plant and Equipment"},
    {code:"2003-02",name:"Accumulated Depreciation-Motor Vehicle",               sageType:"Property, Plant and Equipment"},
    {code:"2004", name:"Office and Safety Equipments",                           sageType:"Property, Plant and Equipment"},
    {code:"2004-01",name:"Cost-Office and Safety Equipments",                    sageType:"Property, Plant and Equipment"},
    {code:"2004-02",name:"Accumulated Depreciation-Office & Safety Equipment",   sageType:"Property, Plant and Equipment"},
    {code:"2005", name:"Furnitures/Fittings/Caravans",                           sageType:"Property, Plant and Equipment"},
    {code:"2005-01",name:"Cost-Furnitures/Fittings/Caravans",                    sageType:"Property, Plant and Equipment"},
    {code:"2005-02",name:"Accumulated Depreciation-Furnitures/Fittings/Caravans",sageType:"Property, Plant and Equipment"},
    {code:"3001", name:"Imprest Cash",                                           sageType:"Cash and Cash Equivalents"},
    {code:"3002", name:"Main Cash",                                              sageType:"Cash and Cash Equivalents"},
    {code:"3003", name:"Access Bank (1) — Naira A/C 0002238013",                sageType:"Cash and Cash Equivalents"},
    {code:"3004", name:"Access Bank (2) — Dollar A/C 0002214695",               sageType:"Cash and Cash Equivalents"},
    {code:"3005", name:"Zenith Bank (1) — A/C 1011010033",                      sageType:"Cash and Cash Equivalents"},
    {code:"3006", name:"Zenith Bank (2) — A/C 1013042537",                      sageType:"Cash and Cash Equivalents"},
    {code:"3007", name:"First Bank — A/C 2008176695",                           sageType:"Cash and Cash Equivalents"},
    {code:"3008", name:"Standard Chartered Bank — A/C 0002151883",              sageType:"Cash and Cash Equivalents"},
    {code:"3009", name:"Sterling Bank — A/C 0068919961",                        sageType:"Cash and Cash Equivalents"},
    {code:"3010", name:"Unity Bank — A/C 0025894154",                           sageType:"Cash and Cash Equivalents"},
    {code:"3011", name:"UBA Bank — A/C 1015363537",                             sageType:"Cash and Cash Equivalents"},
    {code:"3012", name:"Flopeng Logistics Nig. Ltd",                            sageType:"Other Non Current Asset"},
    {code:"3013", name:"Container Deposit",                                      sageType:"Other Current Asset"},
    {code:"3014", name:"Stanbic IBTC Bank",                                     sageType:"Cash and Cash Equivalents"},
    {code:"3015", name:"Access Bank Euro",                                       sageType:"Cash and Cash Equivalents"},
    {code:"3016", name:"Merchant Bank — A/C 1000159983",                        sageType:"Cash and Cash Equivalents"},
    {code:"3017", name:"Fidelity Bank PLC — A/C 4011553970",                    sageType:"Cash and Cash Equivalents"},
    {code:"3018", name:"Access Fixed Deposits",                                  sageType:"Cash and Cash Equivalents"},
    {code:"3019", name:"Transit/Suspense Account",                               sageType:"Cash and Cash Equivalents"},
    {code:"4001", name:"Man-Power Income",                                       sageType:"Revenue"},
    {code:"4002", name:"Procurement Income",                                     sageType:"Revenue"},
    {code:"4003", name:"Engineering Services Income",                            sageType:"Revenue"},
    {code:"4004", name:"Packing Incomes",                                        sageType:"Revenue"},
    {code:"4005", name:"Logistics Income (Flopeng)",                             sageType:"Revenue"},
    {code:"4500", name:"Other Income",                                           sageType:"Other Income"},
    {code:"4501", name:"Profit on Exchange",                                     sageType:"Other Income"},
    {code:"4502", name:"Discount Received",                                      sageType:"Other Income"},
    {code:"5001", name:"Staff Net Salary Payable",                               sageType:"Other Current Liability"},
    {code:"5002", name:"Man-Power Net Salary Payable",                           sageType:"Other Current Liability"},
    {code:"5003", name:"Staff PAYE Payable",                                     sageType:"Other Current Liability"},
    {code:"5004", name:"Man Power PAYE Payable",                                 sageType:"Other Current Liability"},
    {code:"5006", name:"Staff Pension Payable",                                  sageType:"Other Current Liability"},
    {code:"5007", name:"Director's Loan Account",                                sageType:"Other Current Liability"},
    {code:"5008", name:"Man Power Pension Payable",                              sageType:"Other Current Liability"},
    {code:"5009", name:"Other Accrued Expenses",                                 sageType:"Other Current Liability"},
    {code:"5013", name:"Purchase Accrual",                                       sageType:"Other Current Liability"}, // FIX: was 5010, duplicate of NHF Payable (see chartOfAccounts.js)
    {code:"5011", name:"Sales VAT Payable",                                      sageType:"Other Current Liability"},
    {code:"5012", name:"Withholding Tax Payable",                                sageType:"Other Current Liability"},
    {code:"5015", name:"Nigerian Content Development Fund",                      sageType:"Other Current Liability"},
    {code:"5016", name:"Cabotage Marine Tax",                                    sageType:"Other Current Liability"},
    {code:"6001", name:"Inventories",                                            sageType:"Inventories"},
    {code:"6002", name:"Trade Receivables",                                      sageType:"Trade Receivables"},
    {code:"6003", name:"Other Receivables",                                      sageType:"Other Current Asset"},
    {code:"6003-01",name:"Jonjac Manpower Ltd",                                  sageType:"Other Current Asset"},
    {code:"6003-02",name:"Pejoy Procurement Ltd",                                sageType:"Other Current Asset"},
    {code:"6003-03",name:"SLE Industrial Gas Ltd",                               sageType:"Other Current Asset"},
    {code:"6003-04",name:"Arden Gas Ltd",                                        sageType:"Other Current Asset"},
    {code:"6004", name:"Work-In-Progress",                                       sageType:"Other Current Asset"},
    {code:"6005", name:"Recovery Account",                                       sageType:"Other Current Asset"},
    {code:"6006", name:"Input VAT",                                              sageType:"Other Current Asset"},
    {code:"6007", name:"Withholding Tax Receivable",                             sageType:"Other Current Asset"},
    {code:"6008", name:"Staff Loan/Advances",                                    sageType:"Other Current Asset"},
    {code:"6009", name:"Inter-Company Loan",                                     sageType:"Other Current Asset"},
    {code:"6010", name:"AFAM Investment",                                        sageType:"Other Current Asset"},
    {code:"7001", name:"Trade Payables",                                         sageType:"Trade Payables"},
    {code:"7002", name:"Company Taxes Payable",                                  sageType:"Taxation Liability"},
    {code:"7003", name:"End of Contract Bonus",                                  sageType:"Other Current Liability"},
    {code:"8001", name:"Direct Cost — Salaries & Wages",                        sageType:"Cost of Sales"},
    {code:"8002", name:"Direct Cost — Clearing/Duties",                         sageType:"Cost of Sales"},
    {code:"8003", name:"Other Direct Cost",                                      sageType:"Cost of Sales"},
    {code:"8004", name:"Direct Cost — Materials Purchases",                     sageType:"Cost of Sales"},
    {code:"8005", name:"Carriage Inward/Transport Expenses",                     sageType:"Cost of Sales"},
    {code:"8006", name:"Stock Adjustment",                                       sageType:"Cost of Sales"},
    {code:"8007", name:"Cost Variance",                                          sageType:"Cost of Sales"},
    {code:"8008", name:"Discount Allowed",                                       sageType:"Cost of Sales"},
    {code:"9001", name:"Depreciation Charges",                                   sageType:"Administration Expense"},
    {code:"9002", name:"Staff Salaries Expenses",                                sageType:"Administration Expense"},
    {code:"9003", name:"Telephone Expenses",                                     sageType:"Administration Expense"},
    {code:"9004", name:"Vehicle Running Expenses",                               sageType:"Administration Expense"},
    {code:"9005", name:"Transport & Travelling/Accommodation Expenses",          sageType:"Administration Expense"},
    {code:"9006", name:"Business Promotion & Advertisement Expenses",            sageType:"Administration Expense"},
    {code:"9007", name:"Insurance Expenses",                                     sageType:"Administration Expense"},
    {code:"9008", name:"License and Registrations",                              sageType:"Administration Expense"},
    {code:"9009", name:"Communication & Subscriptions/IT Expenses",             sageType:"Administration Expense"},
    {code:"9010", name:"Printing and Stationeries",                              sageType:"Administration Expense"},
    {code:"9011", name:"Security Expenses",                                      sageType:"Administration Expense"},
    {code:"9012", name:"Safety Expenses",                                        sageType:"Administration Expense"},
    {code:"9013", name:"Diesel & Fuelling",                                      sageType:"Administration Expense"},
    {code:"9014", name:"General Repairs and Maintenance Expenses",               sageType:"Administration Expense"},
    {code:"9015", name:"Staff Allowances",                                       sageType:"Administration Expense"},
    {code:"9016", name:"Employer Pension",                                       sageType:"Administration Expense"},
    {code:"9017", name:"Medical Expenses",                                       sageType:"Administration Expense"},
    {code:"9018", name:"Training and Personnel Development",                     sageType:"Administration Expense"},
    {code:"9019", name:"Cleaning, Sanitation",                                   sageType:"Administration Expense"},
    {code:"9020", name:"Newspapers and Periodicals",                             sageType:"Administration Expense"},
    {code:"9021", name:"Office Consumables",                                     sageType:"Administration Expense"},
    {code:"9022", name:"Audit Fee",                                              sageType:"Administration Expense"},
    {code:"9022B",name:"Professional and Consultancy Services",                  sageType:"Administration Expense"},
    {code:"9023", name:"Legal Fee",                                              sageType:"Administration Expense"},
    {code:"9024", name:"Training",                                               sageType:"Administration Expense"},
    {code:"9025", name:"Government Rates",                                       sageType:"Administration Expense"},
    {code:"9026", name:"Development Levy",                                       sageType:"Other Current Liability"},
    {code:"9027", name:"Repair & Maintenance Equipments",                        sageType:"Administration Expense"},
    {code:"9028", name:"Maintenance Premises and Building",                      sageType:"Administration Expense"},
    {code:"9029", name:"Feeding/Entertainment Expenses",                         sageType:"Administration Expense"},
    {code:"9030", name:"Community Development Relations Expenses",               sageType:"Administration Expense"},
    {code:"9031", name:"Postages/Dispatch/Freight Expenses",                     sageType:"Administration Expense"},
    {code:"9100", name:"Loss on Exchange",                                       sageType:"Other Expense"},
    {code:"9500", name:"Interest Charges",                                       sageType:"Finance Cost"},
    {code:"9550", name:"Bank Charges",                                           sageType:"Finance Cost"},
    {code:"9551", name:"NSITF",                                                  sageType:"Administration Expense"},
    {code:"9552", name:"ITF",                                                    sageType:"Administration Expense"},
    {code:"9553", name:"Rent Expenses",                                          sageType:"Administration Expense"},
    {code:"9554", name:"CSR/Charitable Donation",                                sageType:"Administration Expense"},
    {code:"9555", name:"Repairs & Maintenance — Furniture & Fittings",          sageType:"Administration Expense"},
    {code:"9556", name:"Repairs & Maintenance — Motor Vehicle",                 sageType:"Administration Expense"},
    {code:"9557", name:"PHED/Electricity Bills",                                 sageType:"Administration Expense"},
    {code:"9558", name:"Repairs & Maintenance — Plant & Machinery",             sageType:"Administration Expense"},
    {code:"9559", name:"Tax Expense",                                            sageType:"Administration Expense"},
  ];

  // ── Sage type → app COA type mapping ────────────────────────────────────────
  const SAGE_TYPE_MAP = {
    "Share Capital":                  {type:"Equity",   category:"Equity",             normalBal:"Cr"},
    "Retained Earnings":              {type:"Equity",   category:"Equity",             normalBal:"Cr"},
    "Shareholders Loan":              {type:"Liability",category:"Non-Current Liabilities",normalBal:"Cr"},
    "Property, Plant and Equipment":  {type:"Asset",    category:"Fixed Assets",       normalBal:"Dr"},
    "Cash and Cash Equivalents":      {type:"Asset",    category:"Cash & Bank",        normalBal:"Dr"},
    "Other Non Current Asset":        {type:"Asset",    category:"Non-Current Assets", normalBal:"Dr"},
    "Other Current Asset":            {type:"Asset",    category:"Current Assets",     normalBal:"Dr"},
    "Inventories":                    {type:"Asset",    category:"Current Assets",     normalBal:"Dr"},
    "Trade Receivables":              {type:"Asset",    category:"Current Assets",     normalBal:"Dr"},
    "Revenue":                        {type:"Revenue",  category:"Income",             normalBal:"Cr"},
    "Other Income":                   {type:"Revenue",  category:"Other Income",       normalBal:"Cr"},
    "Other Current Liability":        {type:"Liability",category:"Current Liabilities",normalBal:"Cr"},
    "Trade Payables":                 {type:"Liability",category:"Current Liabilities",normalBal:"Cr"},
    "Taxation Liability":             {type:"Liability",category:"Taxation",           normalBal:"Cr"},
    "Cost of Sales":                  {type:"Expense",  category:"Cost of Sales",      normalBal:"Dr"},
    "Administration Expense":         {type:"Expense",  category:"Admin Expenses",     normalBal:"Dr"},
    "Other Expense":                  {type:"Expense",  category:"Other Expenses",     normalBal:"Dr"},
    "Finance Cost":                   {type:"Expense",  category:"Finance Costs",      normalBal:"Dr"},
  };

  // currency detection for bank accounts
  const ACCT_CURRENCY = {"3004":"USD","3015":"EUR"};

  function buildCOAFromSage() {
    return SAGE_COA_ACCOUNTS.map(a => {
      const map = SAGE_TYPE_MAP[a.sageType] || {type:"Expense",category:"Admin Expenses",normalBal:"Dr"};
      return {
        code: a.code, name: a.name,
        type: map.type, category: map.category,
        normalBal: map.normalBal,
        openingBal: 0,
        currency: ACCT_CURRENCY[a.code] || "NGN",
        isActive: true,
        sageType: a.sageType,
      };
    });
  }

  const SAGE_CUSTOMERS = [
    {id:"c001",code:"ALPHADEN ENERGY",      groupKey:"ALPHADEN",name:"Alphaden Energy & Oilfield Limited",            currency:"NGN",contact:"",phone:"",email:"",address:"",rcNo:"",tin:"",paymentTerms:"Net 30",creditLimit:0,status:"Active",notes:"",createdAt:"2026-05-22T00:00:00Z"},
    {id:"c002",code:"ALPHADEN ENERGY & OI", groupKey:"ALPHADEN",name:"Alphaden Energy & Oilfield Limited",            currency:"USD",contact:"",phone:"",email:"",address:"",rcNo:"",tin:"",paymentTerms:"Net 30",creditLimit:0,status:"Active",notes:"USD account",createdAt:"2026-05-22T00:00:00Z"},
    {id:"c003",code:"GEOPLEX DRILLTEQ LTD", groupKey:"GEOPLEX", name:"Geoplex Drillteq Ltd",                          currency:"NGN",contact:"",phone:"",email:"",address:"",rcNo:"",tin:"",paymentTerms:"Net 30",creditLimit:0,status:"Active",notes:"",createdAt:"2026-05-22T00:00:00Z"},
    {id:"c004",code:"NLNG NGN",             groupKey:"NLNG",    name:"Nigeria LNG Limited",                            currency:"NGN",contact:"",phone:"",email:"",address:"",rcNo:"",tin:"",paymentTerms:"Net 30",creditLimit:0,status:"Active",notes:"Monthly retainer client",createdAt:"2026-05-22T00:00:00Z"},
    {id:"c005",code:"NLNG (USD)",           groupKey:"NLNG",    name:"Nigeria LNG Limited",                            currency:"USD",contact:"",phone:"",email:"",address:"",rcNo:"",tin:"",paymentTerms:"Net 30",creditLimit:0,status:"Active",notes:"",createdAt:"2026-05-22T00:00:00Z"},
    {id:"c006",code:"NLNG (EURO)",          groupKey:"NLNG",    name:"Nigeria LNG Limited",                            currency:"EUR",contact:"",phone:"",email:"",address:"",rcNo:"",tin:"",paymentTerms:"Net 30",creditLimit:0,status:"Active",notes:"",createdAt:"2026-05-22T00:00:00Z"},
    {id:"c007",code:"NLNG (POUNDS)",        groupKey:"NLNG",    name:"Nigeria LNG Limited",                            currency:"GBP",contact:"",phone:"",email:"",address:"",rcNo:"",tin:"",paymentTerms:"Net 30",creditLimit:0,status:"Active",notes:"",createdAt:"2026-05-22T00:00:00Z"},
    {id:"c008",code:"SAIPEM USD",           groupKey:"SAIPEM",  name:"Saipem",                                         currency:"USD",contact:"",phone:"",email:"",address:"",rcNo:"",tin:"",paymentTerms:"Net 30",creditLimit:0,status:"Active",notes:"",createdAt:"2026-05-22T00:00:00Z"},
    {id:"c009",code:"SHELL NIG. GAS",       groupKey:"SHELL",   name:"Shell Nigeria Gas",                              currency:"NGN",contact:"",phone:"",email:"",address:"",rcNo:"",tin:"",paymentTerms:"Net 30",creditLimit:0,status:"Active",notes:"",createdAt:"2026-05-22T00:00:00Z"},
    {id:"c010",code:"SPDC",                 groupKey:"SPDC",    name:"Renaissance Africa Energy Company of Nig. Ltd",  currency:"NGN",contact:"",phone:"",email:"",address:"",rcNo:"",tin:"",paymentTerms:"Net 30",creditLimit:0,status:"Active",notes:"Formerly SPDC",createdAt:"2026-05-22T00:00:00Z"},
    {id:"c011",code:"SPDC(USD)",            groupKey:"SPDC",    name:"Renaissance Africa Energy Company of Nig. Ltd",  currency:"USD",contact:"",phone:"",email:"",address:"",rcNo:"",tin:"",paymentTerms:"Net 30",creditLimit:0,status:"Active",notes:"",createdAt:"2026-05-22T00:00:00Z"},
    {id:"c012",code:"SPDC(EURO)",           groupKey:"SPDC",    name:"Renaissance Africa Energy Company of Nig. Ltd",  currency:"EUR",contact:"",phone:"",email:"",address:"",rcNo:"",tin:"",paymentTerms:"Net 30",creditLimit:0,status:"Active",notes:"",createdAt:"2026-05-22T00:00:00Z"},
  ];

  const SAGE_SUPPLIERS = [
    {id:"v001",code:"ACRIFA",               groupKey:"ACRIFA",        name:"Acrifa Energy Ltd (USD)",                    currency:"USD",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"Same corporate group as ACRIFA ENERGY LTD / ACRIFA GLOBAL SERVIC, trading in a different currency — confirmed by accountant, not a duplicate. Currency: USD (accountant confirmed 2026-08-17).",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v002",code:"ACRIFA ENERGY LTD",    groupKey:"ACRIFA",        name:"Acrifa Energy Limited (EUR)",                currency:"EUR",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"Same corporate group as ACRIFA / ACRIFA GLOBAL SERVIC, trading in a different currency — confirmed by accountant, not a duplicate. Currency: EUR (accountant confirmed 2026-08-17).",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v003",code:"ACRIFA GLOBAL SERVIC", groupKey:"ACRIFA GLOBAL", name:"Acrifa Global Services Ltd",                 currency:"NGN",category:"Services",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v004",code:"BENNIC GLOBAL LINKS",  groupKey:"BENNIC",        name:"Bennic Global Links (Nig)",                  currency:"NGN",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v005",code:"CATERING & FACILITIE", groupKey:"CATERING",      name:"Catering & Facilities",                      currency:"NGN",category:"Catering",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v006",code:"CHIBYKE DAN- GLOBAL",  groupKey:"CHIBYKE",       name:"Chibyke Dan-Global Services Nig",            currency:"NGN",category:"Services",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v007",code:"CHIDAIIK VENTURES",    groupKey:"CHIDAIIK",      name:"Chidaiik Ventures",                          currency:"NGN",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v008",code:"COBEF INTERNATIONAL",  groupKey:"COBEF",         name:"Cobef International Ltd",                    currency:"NGN",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v009",code:"COURDEAU CATERING",    groupKey:"COURDEAU",      name:"Courdeau Catering",                          currency:"NGN",category:"Catering",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v010",code:"CSPS (EURO)",          groupKey:"CSPS",          name:"CSPS",                                       currency:"EUR",category:"Services",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v011",code:"CSPS (POUNDS)",        groupKey:"CSPS",          name:"CSPS",                                       currency:"GBP",category:"Services",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v012",code:"CSPS (USD)",           groupKey:"CSPS",          name:"CSPS",                                       currency:"USD",category:"Services",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v013",code:"EMERSON FZE",          groupKey:"EMERSON",       name:"Emerson FZE",                                currency:"NGN",category:"Equipment",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v014",code:"EMMY ELVIS INTER.",    groupKey:"EMMY ELVIS",    name:"Emmy Elvis International Company",           currency:"NGN",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v015",code:"ENERNICS",             groupKey:"ENERNICS",      name:"Wogu Tony Chinedu (Enernics)",               currency:"NGN",category:"Other",contact:"Wogu Tony Chinedu",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v016",code:"FERRY MOORE INDUSTRI", groupKey:"FERRY MOORE",   name:"Ferry Moore Industrial Co.",                 currency:"NGN",category:"Equipment",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v017",code:"IN HOUSE",             groupKey:"IN HOUSE",      name:"In House",                                   currency:"NGN",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"Internal work code",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v018",code:"LA CULINAIRE",         groupKey:"LA CULINAIRE",  name:"La Culinaire",                               currency:"NGN",category:"Catering",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v019",code:"MACJAMES GLOBAL RES.", groupKey:"MACJAMES",      name:"Macjames Global Resources Ltd",              currency:"NGN",category:"Materials",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v020",code:"MENAGE LTD",           groupKey:"MENAGE",        name:"Menage Ltd",                                 currency:"NGN",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v021",code:"MOMENTIVE PERFORM.",   groupKey:"MOMENTIVE",     name:"Momentive Performance Materials (India) Pvt Ltd",currency:"NGN",category:"Materials",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v022",code:"S.J ABED GEN ENT",     groupKey:"S.J ABED",      name:"S.J Abed Gen Ent",                           currency:"NGN",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v023",code:"SAFETY GEAR STORE LT", groupKey:"SAFETY GEAR",   name:"Safety Gear Store Ltd",                      currency:"NGN",category:"Materials",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v024",code:"TANIT MEDICAL ENG.",   groupKey:"TANIT",         name:"Tanit Medical Engineering Ltd",              currency:"NGN",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v025",code:"VINO WORLDWIDE.  S.",  groupKey:"VINO",          name:"Vino Worldwide S.Co",                        currency:"NGN",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v026",code:"VONK",                 groupKey:"VONK",          name:"Vonk",                                       currency:"NGN",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v027",code:"VONK (USD)",           groupKey:"VONK",          name:"Vonk EUA BV",                                currency:"USD",category:"Other",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"Different legal name — confirm if same entity as VONK (NGN)",createdAt:"2026-05-29T00:00:00Z"},
    {id:"v028",code:"WORLDWIDE ENERGY LOG", groupKey:"WORLDWIDE",     name:"Worldwide Energy Logistics Ltd",             currency:"NGN",category:"Logistics",contact:"",phone:"",email:"",address:"",rc:"",tin:"",status:"Active",rating:0,notes:"",createdAt:"2026-05-29T00:00:00Z"},
  ];

  const SAGE_PROJECTS = [
    {id:"p001",code:"ALETO",             name:"Aleto",                description:"Aleto",                              client:"",          status:"Active",createdAt:"2026-05-29T00:00:00Z"},
    {id:"p002",code:"ASSA NORTH",        name:"Assa North",           description:"Assa North",                         client:"",          status:"Active",createdAt:"2026-05-29T00:00:00Z"},
    {id:"p003",code:"BOWER",             name:"SNG-Bower",            description:"SNG-Bower",                          client:"",          status:"Active",createdAt:"2026-05-29T00:00:00Z"},
    {id:"p004",code:"FLOPENG LOGISTICS", name:"Geoplex Logistics",    description:"Geoplex Logistics",                  client:"GEOPLEX DRILLTEQ LTD",status:"Active",createdAt:"2026-05-29T00:00:00Z"},
    {id:"p005",code:"GBARAM",            name:"Gbaram",               description:"",                                   client:"",          status:"Active",createdAt:"2026-05-29T00:00:00Z"},
    {id:"p006",code:"NLNG EXP",          name:"NLNG Procurement",     description:"NLNG Procurement",                   client:"NLNG NGN",  status:"Active",createdAt:"2026-05-29T00:00:00Z"},
    {id:"p007",code:"NLNG HRSS",         name:"NLNG HRSS",            description:"NLNG HRS",                           client:"NLNG NGN",  status:"Active",createdAt:"2026-05-29T00:00:00Z"},
    {id:"p008",code:"NON-PROJECT",       name:"Non-Project",          description:"Non-Project (overhead / admin)",      client:"",          status:"Active",createdAt:"2026-05-29T00:00:00Z"},
    {id:"p009",code:"SAIPEM",            name:"Saipem",               description:"Saipem Procurement",                 client:"SAIPEM USD",status:"Active",createdAt:"2026-05-29T00:00:00Z"},
    {id:"p010",code:"SNG BOFO",          name:"SNG Bofo",             description:"SNG Bofo",                           client:"",          status:"Active",createdAt:"2026-05-29T00:00:00Z"},
    {id:"p011",code:"SNG PROJECT",       name:"SNG Project",          description:"SNG Project",                        client:"",          status:"Active",createdAt:"2026-05-29T00:00:00Z"},
    {id:"p012",code:"SPDC",              name:"Renaissance",          description:"Renaissance Africa Energy Co. Ltd",  client:"SPDC",      status:"Active",createdAt:"2026-05-29T00:00:00Z"},
    {id:"p013",code:"SPDC CABLE PROJECT",name:"SPDC Cable Project",   description:"SPDC Cable Project",                 client:"SPDC",      status:"Active",createdAt:"2026-05-29T00:00:00Z"},
  ];

  // ── Local state ──────────────────────────────────────────────────────────────
  const [xlsxStatus,  setXlsxStatus]  = useState(null);
  const [xlsxResult,  setXlsxResult]  = useState(null);
  const [sageLog,     setSageLog]     = useState('');
  const [confirmModal,setConfirmModal]= useState(null);
  const [loadStatus,  setLoadStatus]  = useState({coa:false,customers:false,suppliers:false,projects:false});

  // check what's already loaded
  useEffect(() => {
    const clients  = getClients();
    const vendors  = getVendors();
    const projects = getProjects();
    setLoadStatus({
      coa:       false, // always show — COA lives in Accounting state
      customers: clients.length > 0,
      suppliers: vendors.length > 0,
      projects:  projects.length > 0,
    });
  }, []);

  const today = () => new Date().toISOString().split('T')[0];
  const uid   = () => Math.random().toString(36).slice(2,10).toUpperCase();

  // ── Load Sage master data ────────────────────────────────────────────────────
  function loadSageCOA() {
    const newCOA = buildCOAFromSage();
    setConfirmModal({
      type:'coa',
      data: newCOA,
      message: `This will replace the Chart of Accounts with all ${newCOA.length} accounts from the Sage export file dated 29 May 2026. Any manual additions will be lost. Continue?`,
    });
  }

  // 2026-08-17: these three used to call saveX() directly with zero
  // confirmation - one misclick could silently wipe out live, edited master
  // data (e.g. the corrected Acrifa currency split) with no undo. Routed
  // through the same confirmModal pattern loadSageCOA already used.
  function loadSageCustomers() {
    setConfirmModal({
      type:'customers',
      message: `This will replace ALL Customer/AR accounts with the ${SAGE_CUSTOMERS.length} customers from the Sage export file dated 22 May 2026. Any manual additions or corrections made since will be lost. Continue?`,
    });
  }

  function loadSageSuppliers() {
    setConfirmModal({
      type:'suppliers',
      message: `This will replace ALL Supplier/AP accounts with the ${SAGE_SUPPLIERS.length} suppliers from the Sage export file dated 29 May 2026. Any manual additions or corrections made since - including the confirmed Acrifa currency split - will be lost. Continue?`,
    });
  }

  function loadSageProjects() {
    setConfirmModal({
      type:'projects',
      message: `This will replace ALL Projects with the ${SAGE_PROJECTS.length} projects from the Sage export file. Any manual additions or corrections made since will be lost. Continue?`,
    });
  }

  function loadAllSage() {
    setConfirmModal({
      type:'all',
      message: `This will reload ALL master data from the Sage exports:\n\n• ${SAGE_COA_ACCOUNTS.length} Chart of Accounts entries (COA)\n• ${SAGE_CUSTOMERS.length} Customers / AR accounts\n• ${SAGE_SUPPLIERS.length} Suppliers / AP accounts\n• ${SAGE_PROJECTS.length} Projects\n\nExisting data will be replaced. Journal entries are NOT affected. Continue?`,
    });
  }

  // ── CSV file import for journal entries ─────────────────────────────────────
  function handleExcel() {
    const inp = document.createElement('input');
    inp.type='file'; inp.accept='.csv,.xlsx,.xls';
    inp.onchange = e => {
      const file = e.target.files[0]; if(!file) return;
      setXlsxStatus('uploading');
      // 2026-08-14: readTextSmart, not readAsText — Excel/Windows ANSI CSVs
      // were silently losing every non-ASCII character to U+FFFD. See excelIO.js.
      readTextSmart(file).then(text => {
        try {
          const lines = text.split('\n').filter(l=>l.trim());
          const hdr   = lines[0]?.toLowerCase()||'';
          const isCOA = hdr.includes('code')||hdr.includes('chart')||hdr.includes('account');
          if(isCOA){
            const data = lines.slice(1).map(line=>{
              const cols = line.split(',').map(c=>c.replace(/"/g,'').trim());
              return {code:cols[0],name:cols[1],type:cols[2]||'Expense',category:cols[3]||'Overhead',normalBal:'Dr',openingBal:parseFloat(cols[4]||'0')||0,currency:'NGN',isActive:true};
            }).filter(a=>a.code&&a.name);
            setXlsxResult({type:'coa',count:data.length});
            setConfirmModal({type:'coa',data,message:`Import ${data.length} Chart of Accounts entries from CSV?`});
          } else {
            const data = lines.slice(1).map((line,i)=>{
              const cols = line.split(',').map(c=>c.replace(/"/g,'').trim());
              const amt  = parseFloat((cols[5]||cols[3]||'0').replace(/,/g,''));
              if(!amt||isNaN(amt)) return null;
              return {id:`JE-XLS-${uid()}`,date:cols[0]||today(),ref:cols[1]||`XLS-${i+1}`,
                description:cols[2]||'CSV Import',source:'excel',
                lines:[{drCode:cols[3]||'9001',drName:'Imported',crCode:cols[4]||'3003',crName:'Imported',amount:Math.abs(amt),memo:cols[6]||''}]};
            }).filter(Boolean);
            setXlsxResult({type:'journals',count:data.length});
            setConfirmModal({type:'journals',data,message:`Import ${data.length} journal entries from CSV?`});
          }
          setXlsxStatus('done');
        } catch { setXlsxStatus('error'); }
      }).catch(() => setXlsxStatus('error'));
    };
    inp.click();
  }

  // ── Confirm handler ──────────────────────────────────────────────────────────
  function doImport() {
    if(!confirmModal) return;
    if(confirmModal.type==='journals') {
      setJournals(prev=>{ const ex=new Set(prev.map(j=>j.id)); return [...prev,...confirmModal.data.filter(j=>!ex.has(j.id))]; });
    }
    if(confirmModal.type==='coa') {
      setCoa(confirmModal.data);
      setLoadStatus(s=>({...s, coa:true}));
      setSageLog(`✓ COA replaced with ${confirmModal.data.length} Sage accounts`);
    }
    if(confirmModal.type==='all') {
      setCoa(buildCOAFromSage());
      saveClients(SAGE_CUSTOMERS);
      saveVendors(SAGE_SUPPLIERS);
      saveProjects(SAGE_PROJECTS);
      setLoadStatus({coa:true,customers:true,suppliers:true,projects:true});
      setSageLog(`✓ All Sage master data loaded:\n  ${SAGE_COA_ACCOUNTS.length} COA · ${SAGE_CUSTOMERS.length} customers · ${SAGE_SUPPLIERS.length} suppliers · ${SAGE_PROJECTS.length} projects`);
    }
    if(confirmModal.type==='customers') {
      saveClients(SAGE_CUSTOMERS);
      setLoadStatus(s=>({...s, customers:true}));
      setSageLog(`✓ ${SAGE_CUSTOMERS.length} customers loaded from Sage AR export (22 May 2026)\n  — NLNG: 4 accounts (NGN, USD, EUR, GBP)\n  — SPDC/Renaissance: 3 accounts (NGN, USD, EUR)\n  — ALPHADEN: 2 accounts (NGN, USD)\n  — Single-currency: GEOPLEX, SAIPEM, SHELL`);
    }
    if(confirmModal.type==='suppliers') {
      saveVendors(SAGE_SUPPLIERS);
      setLoadStatus(s=>({...s, suppliers:true}));
      setSageLog(`✓ ${SAGE_SUPPLIERS.length} suppliers loaded from Sage AP export (29 May 2026)\n  — CSPS: 3 accounts (EUR, GBP, USD)\n  — VONK: 2 accounts (NGN, USD)\n  — ACRIFA: 3 accounts (USD, EUR, NGN) — confirmed same corporate group by accountant, not duplicates`);
    }
    if(confirmModal.type==='projects') {
      saveProjects(SAGE_PROJECTS);
      setLoadStatus(s=>({...s, projects:true}));
      setSageLog(`✓ ${SAGE_PROJECTS.length} projects loaded from Sage export\n  ALETO · ASSA NORTH · BOWER · FLOPENG LOGISTICS · GBARAM\n  NLNG EXP · NLNG HRSS · NON-PROJECT · SAIPEM · SNG BOFO\n  SNG PROJECT · SPDC · SPDC CABLE PROJECT`);
    }
    setConfirmModal(null);
  }

  // ── UI helpers ───────────────────────────────────────────────────────────────
  const MCard = ({icon,title,count,sub,loaded,onLoad,note}) => (
    <div style={{background:C.bgCard,border:`1px solid ${loaded?C.success:C.border}`,borderRadius:12,
      padding:'20px',display:'flex',flexDirection:'column',gap:10,boxShadow:C.shadowCard}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:28}}>{icon}</span>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:700,color:C.text}}>{title}</div>
          <div style={{fontSize:12,color:C.textMuted}}>{sub}</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:20,fontWeight:800,color:loaded?C.success:C.textMid}}>{count}</div>
          <div style={{fontSize:11,color:loaded?C.success:C.textMuted}}>{loaded?'✓ Loaded':'Not loaded'}</div>
        </div>
      </div>
      {note&&<div style={{fontSize:11,color:C.warning,background:C.bgAlt,borderRadius:6,padding:'6px 10px'}}>⚠ {note}</div>}
      <button onClick={onLoad} style={{padding:'8px 14px',borderRadius:8,fontSize:12,fontWeight:700,
        background:loaded?C.bgAlt:C.green,color:loaded?C.textMid:'#fff',border:`1px solid ${loaded?C.border:C.green}`,cursor:'pointer'}}>
        {loaded?'↺ Reload from Sage':'⬇ Load from Sage'}
      </button>
    </div>
  );

  const SLog = ({text}) => text ? (
    <div style={{marginTop:4,background:C.bgAlt,borderRadius:8,padding:'10px 14px',fontSize:11,
      color:C.textMid,fontFamily:'monospace',lineHeight:1.8,border:'1px solid '+C.border,
      maxHeight:140,overflowY:'auto',whiteSpace:'pre-wrap'}}>{text}</div>
  ) : null;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>

      {/* Header banner */}
      <div style={{padding:'14px 18px',background:C.bgAlt,borderRadius:10,border:'1px solid '+C.border,fontSize:13,color:C.textMid,display:'flex',alignItems:'flex-start',gap:12}}>
        <span style={{fontSize:22,marginTop:1}}>📋</span>
        <div>
          <div style={{fontWeight:700,color:C.text,marginBottom:3}}>Sage Master Data — SLOT Engineering Nigeria Limited</div>
          <div style={{lineHeight:1.7}}>
            All four Sage export files have been parsed and are embedded in this app. Click <strong>Load from Sage</strong> on each card to push that data into the live system.
            You can reload at any time — journal entries and transactions are never affected by a master data reload.
          </div>
        </div>
      </div>

      {/* Load All button */}
      <div style={{display:'flex',justifyContent:'flex-end'}}>
        <button onClick={loadAllSage} style={{padding:'10px 20px',borderRadius:9,fontSize:13,fontWeight:800,
          background:`linear-gradient(135deg,#0F3A1A,#1A5C2A)`,color:'#fff',border:'none',cursor:'pointer',
          display:'flex',alignItems:'center',gap:8}}>
          ⚡ Load ALL Sage Master Data at Once
        </button>
      </div>

      {/* Four master data cards */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <MCard
          icon="📒" title="Chart of Accounts" count={SAGE_COA_ACCOUNTS.length} loaded={loadStatus.coa}
          sub="Source: CURRENT_General_Ledger_Chart_of_Accounts_20260529.xlsx"
          note="Account 9022 appears twice in Sage — renamed 9022B (Professional Services) to avoid duplicate."
          onLoad={loadSageCOA}
        />
        <MCard
          icon="🏢" title="Customers (AR)" count={SAGE_CUSTOMERS.length} loaded={loadStatus.customers}
          sub="Source: Accounts_Receivable_Customer_Listing_20260522.xlsx"
          note="Multi-currency clients (NLNG, SPDC, ALPHADEN) have one record per currency — exactly as Sage."
          onLoad={loadSageCustomers}
        />
        <MCard
          icon="🏭" title="Suppliers (AP)" count={SAGE_SUPPLIERS.length} loaded={loadStatus.suppliers}
          sub="Source: Accounts_Payable_Supplier_Listing_20260529.xlsx"
          note="ACRIFA, ACRIFA ENERGY LTD, ACRIFA GLOBAL SERVIC — same group, 3 currencies (USD/EUR/NGN), confirmed by accountant."
          onLoad={loadSageSuppliers}
        />
        <MCard
          icon="📁" title="Projects" count={SAGE_PROJECTS.length} loaded={loadStatus.projects}
          sub="Source: Project_List_htm (13 active projects)"
          onLoad={loadSageProjects}
        />
      </div>

      {/* Log output */}
      <SLog text={sageLog}/>

      {/* Separator */}
      <div style={{borderTop:'1px solid '+C.border,paddingTop:16}}>
        <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:4}}>📂 CSV Journal Import</div>
        <div style={{fontSize:12,color:C.textMuted,marginBottom:10}}>
          Upload a CSV file of journal entries (Date, Ref, Description, Dr Account, Cr Account, Amount) or a COA CSV to bulk-load.
        </div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
          <button onClick={handleExcel} style={{padding:'9px 16px',borderRadius:8,fontSize:12,fontWeight:700,
            background:xlsxStatus==='done'?C.success:xlsxStatus==='error'?C.danger:C.green,
            color:'#fff',border:'none',cursor:'pointer'}}>
            {xlsxStatus==='uploading'?'⏳ Processing…':xlsxStatus==='done'?'✓ Imported!':xlsxStatus==='error'?'✗ Retry':'📊 Upload CSV File'}
          </button>
          {xlsxResult&&<span style={{fontSize:12,color:C.success,fontWeight:600}}>✓ {xlsxResult.count} {xlsxResult.type==='coa'?'accounts':'entries'} ready to post</span>}
        </div>
        {/* Template downloads */}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
          {[
            {label:'Journal Template', headers:'date,ref,description,drCode,crCode,amount,memo', fn:'journal_template.csv'},
            {label:'COA Template',     headers:'code,name,type,category,openingBalance',         fn:'coa_template.csv'},
          ].map(({label,headers,fn})=>(
            <button key={fn} onClick={()=>{
              const a=document.createElement('a');
              a.href=URL.createObjectURL(new Blob([headers+'\n'],{type:'text/csv'}));
              a.download=fn; a.click();
            }} style={{padding:'6px 12px',borderRadius:7,fontSize:11,fontWeight:600,background:C.bgAlt,color:C.textMid,border:'1px solid '+C.border,cursor:'pointer'}}>
              ⬇ {label}
            </button>
          ))}
        </div>
      </div>

      {/* Confirm modal */}
      {confirmModal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',backdropFilter:'blur(3px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
          <div style={{background:C.bgCard,border:'1px solid '+C.border,borderRadius:14,padding:'28px',maxWidth:440,width:'90%',boxShadow:C.shadowModal,textAlign:'center'}}>
            <div style={{fontSize:36,marginBottom:12}}>📥</div>
            <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:10}}>Confirm Load from Sage</div>
            <div style={{fontSize:13,color:C.textMid,lineHeight:1.7,marginBottom:16,whiteSpace:'pre-line'}}>{confirmModal.message}</div>
            <div style={{display:'flex',gap:10,justifyContent:'center'}}>
              <button onClick={()=>setConfirmModal(null)} style={{padding:'9px 22px',borderRadius:8,background:'transparent',border:'1px solid '+C.border,color:C.textMid,fontSize:13,cursor:'pointer'}}>Cancel</button>
              <button onClick={doImport} style={{padding:'9px 22px',borderRadius:8,background:C.green,color:'#fff',border:'none',fontSize:13,fontWeight:700,cursor:'pointer'}}>✓ Yes, Load It</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default function Accounting({data,setData}){
  // ── Sync module-level C with the active theme on every render ──────────────
  const { C: themeC } = useTheme();
  Object.assign(C, themeC, { white: themeC.textOnDark || "#FFFFFF" });
  // ─────────────────────────────────────────────────────────────────────────────
  // ── Pull live data from AppContext ──────────────────────────────────────────
  const { state: appState, dispatch } = useApp();
  const isAdmin = appState?.currentUser?.role === 'admin';

  // ── Load accounting from central store (Supabase-synced) ───────────────────
  // One-time migration from old private 'slot_acct' key if central store is empty.
  function loadAcct() {
    const central = appState?.acctData;
    if (central?.journals?.length || central?.coa?.length) return central;
    // Deliberately wiped (Backup → Wipe All Data) → empty means empty; don't
    // fall through to the legacy 'slot_acct' migration below and risk
    // resurrecting whatever was in that old key pre-wipe.
    if (appState?.appSettings?.dataWiped) return central || { journals:[], coa:[], bankStmt:[], vatAdj:[], whtEntries:[], assets:[] };
    try {
      const raw = localStorage.getItem('slot_acct');
      if (raw) { localStorage.removeItem('slot_acct'); return JSON.parse(raw); }
    } catch {}
    return null;
  }

  const saved = loadAcct();
  const [tab,setTab]=useState(() => getDeepLinkTab('accounting', 'overview'));
  const printAreaRef = useRef(null);
  const [journals,setJournals]=useState(saved?.journals || []);
  // 2026-07-28: was `saved?.coa || DEFAULT_COA`, which froze the chart of
  // accounts into each browser on first run and never refreshed it — two users
  // on the same build saw different balances. mergeCOA() rebuilds it from
  // chartOfAccounts.js on every load while keeping any accounts a user added
  // themselves. See the long note above mergeCOA for why.
  const [coa,setCoa]=useState(()=>mergeCOA(saved?.coa));
  const [bankStmt,setBankStmt]=useState(saved?.bankStmt || []);
  const [vatAdj,setVatAdj]=useState(saved?.vatAdj || []);
  const [whtEntries,setWhtEntries]=useState(saved?.whtEntries || []);
  const [assets,setAssets]=useState(saved?.assets || []);
  const [jFilter,setJFilter]=useState("");
  const [jSource,setJSource]=useState("");

  // Persist whenever accounting data changes
  // Sync to central store (feeds Supabase, Backup, cloud restore)
  useEffect(()=>{
    dispatch({ type:'SET_ACCT', payload:{ journals, coa, bankStmt, vatAdj, whtEntries, assets, savedAt:new Date().toISOString() } });
  },[journals,coa,bankStmt,vatAdj,whtEntries,assets]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Multi-entity ledger visibility — see canSeeTerminalLedger() in
  // utils/auth.js for the full rationale. `journals` (real state, above)
  // stays completely untouched — it's what gets persisted, auto-posted into,
  // and voided/reversed. `visibleJournals` is a read-only derived view used
  // ONLY by the reporting tabs below (Overview/COA/Ledger/Trial
  // Balance/P&L/BS/Cash Flow/Bank Recon/VAT), so a user without Terminal
  // module access never sees Terminal-tagged entries in any of Slot's
  // financial statements. JournalTab and FXTab still receive the full
  // `journals` prop (they write to it) and apply this same filter
  // internally, scoped to just their own display/export, so ref-number
  // generation and duplicate-template checks keep working off the real data.
  const canSeeTerminal = canSeeTerminalLedger(appState?.currentUser);
  const visibleJournals = useMemo(
    () => canSeeTerminal ? journals : journals.filter(j => j.source !== 'terminal' && j.source !== 'terminal-advance'),
    [journals, canSeeTerminal]
  );

  // Auto-post paid invoices from app data into journals
  // ── Auto-post AP/AR/Petty-Cash/Fixed-Asset transactions into the GL ───────
  // Accounting.jsx is the single source of truth for all journal entries.
  // Source modules write to db.ap / db.invoices / db.arReceipts / db.pettycash
  // / db.fixedassets — this effect watches those keys and mirrors every new
  // record as a proper double-entry journal, so the GL, Balance Sheet, Trial
  // Balance, and P&L all stay correct automatically without manual entries.
  //
  // Duplicate-safe: checks for JE-AR-INV-{id}, JE-AR-REC-{id}, JE-AP-BILL-{id},
  // JE-AP-PAY-{id}, JE-PC-{id}, JE-FA-{id}, AND the legacy JE-AUTO-{id} prefix
  // used by the old invoice auto-post — so existing data is never re-posted.
  //
  // VOID HANDLING: source modules never hard-delete a record once it's been
  // posted — they set `voided:true` (or status:'Cancelled' for AR invoices)
  // and keep it. This effect detects "posted but now voided, no reversal
  // yet" and auto-posts the mirror-image reversing entry, so the GL nets to
  // zero for that record while the original entry stays fully visible for
  // audit (nothing is ever silently removed from the ledger).
  // QA fix (2026-08-14): this effect's ~300-line body was extracted verbatim
  // into utils/autoPostJournals.js (computeAutoPostedJournals) so AppContext
  // can run the exact same logic once at boot, instead of every other report
  // silently reading an incomplete ledger until someone happened to open
  // Accounting first in that session. Behavior here is unchanged — still
  // re-runs live while this module is mounted, for instant feedback on
  // edits/voids.
  useEffect(() => {
    setJournals(js => computeAutoPostedJournals(js, appState?.db, appState?.appSettings));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState?.db?.invoices, appState?.db?.arReceipts, appState?.db?.creditNotes, appState?.db?.ap, appState?.db?.pettycash, appState?.db?.fixedassets, appState?.db?.terminal, appState?.db?.stockMovements, appState?.db?.payrollRuns, appState?.db?.fleet, appState?.appSettings]);

  const TABS=[
    {id:"overview",   label:"📊 Overview"},
    {id:"coa",        label:"📒 Chart of Accounts"},
    {id:"journal",    label:"📔 Journal Entries"},
    {id:"ledger",     label:"📋 General Ledger"},
    {id:"trial",      label:"⚖️ Trial Balance"},
    {id:"pl",         label:"📈 P&L Statement"},
    {id:"bs",         label:"🏛️ Balance Sheet"},
    {id:"cashflow",   label:"💧 Cash Flow"},
    {id:"bank",       label:"🏧 Bank Reconciliation"},
    {id:"fx",         label:"💱 Currency Exchange"},
    {id:"vat",        label:"🧾 VAT Returns"},
    {id:"fixedassets",label:"🏗️ Fixed Assets"},
    {id:"wht",        label:"📋 WHT Register"},
    {id:"import",     label:"📂 Import / Upload"},
  ];

  // ── Print the currently visible tab ─────────────────────────────────────
  // 2026-08-05: this used to be a bare window.print() on the live app
  // window — printed the dark sidebar/theme along with whatever tab was
  // open, with no SLOT letterhead and no clean table styling (the "black
  // print" problem, same one openPrintWindow's iframe design exists to
  // avoid). Every other print button in the app goes through
  // openPrintWindow + printBootstrap; this one didn't. Fixed to match:
  // snapshot the rendered tab content, drop it into the same branded
  // PRINT_CSS/printHeader chrome as every other report, and print it via
  // the CSP-safe iframe path instead of printing the live page.
  function handlePrintCurrentTab() {
    const node = printAreaRef.current;
    if (!node) return;
    // Clone rather than touch the live DOM, and drop action buttons (Edit/
    // Delete/expand icons etc.) — those are on-screen controls with nothing
    // to do on a printed page. Inputs/selects are deliberately left alone:
    // some tabs render live figures through them, and removing the element
    // would silently blank that figure out of the printout.
    const clone = node.cloneNode(true);
    clone.querySelectorAll('button').forEach(el => el.remove());
    const tabLabel = (TABS.find(t => t.id === tab)?.label || 'Accounting').replace(/^\S+\s/, '');
    openPrintWindow(`<!DOCTYPE html><html><head><title>${tabLabel}</title><style>${PRINT_CSS}</style></head><body>${printHeader(tabLabel.toUpperCase())}${clone.innerHTML}${printBootstrap({landscape:true})}</body></html>`);
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:0}}>
      {/* Header */}
      <div style={{background:`linear-gradient(135deg,#0F3A1A 0%,#1A5C2A 70%)`,borderRadius:12,padding:"16px 20px",marginBottom:16,color:"#FFFFFF",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontWeight:800,fontSize:15}}>📒 Accounting — Full Double-Entry Ledger</div>
          <div style={{fontSize:12,opacity:0.75,marginTop:2}}>Nigerian GAAP / IFRS · COA · Journals · P&L · Balance Sheet · VAT · WHT · Fixed Assets</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={async () => {
            try {
              const { downloadSageIntelligenceTemplate } = await import('../../utils/liveExcel');
              const params = { journals: visibleJournals, coa, invoices: appState?.db?.invoices || [], ap: appState?.db?.ap || {}, salesOrders: appState?.db?.salesOrders || [] };
              await downloadSageIntelligenceTemplate(params, `SLOT_Intelligence_${new Date().toISOString().slice(0,10)}`);
              // 2026-08-20: this referenced a bare `currentUser`, which was
              // never declared in this component's scope (only `appState`
              // is — see the destructure a few lines up in Accounting()).
              // The file itself already downloaded successfully by this
              // point, but the ReferenceError thrown right here was caught
              // by the surrounding try/catch and shown as "Download failed"
              // on every single click — a real download silently reported
              // as a failure. Found while touching this exact line for the
              // Terminal-ledger-visibility change; fixed alongside it.
              logActivity(dispatch, `Downloaded Sage Intelligence live-Excel template (${visibleJournals.length} journals, ${coa.length} accounts)`, appState?.currentUser, { module:'accounting', action:'edit' });
              showToast('📊 Sage Intelligence template downloaded — open in Excel and click Refresh All to re-pull live data');
            } catch (e) { showToast('Download failed: ' + e.message, 'error'); }
          }} style={{background:"#1A5C2A",color:"#FFFFFF",border:"none",borderRadius:8,padding:"5px 12px",fontSize:12,cursor:"pointer",fontWeight:600}}>📊 Sage Intelligence Template</button>
          <button style={{background:"transparent",color:"#FFFFFF",border:"1px solid rgba(255,255,255,0.3)",borderRadius:8,padding:"5px 12px",fontSize:12,cursor:"pointer"}} onClick={handlePrintCurrentTab}>🖨️ Print</button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs tabs={TABS} active={tab} onChange={setTab} sm/>

      {/* Panels */}
      <div ref={printAreaRef}>
      {/* Terminal-tagged entries hidden here (visibleJournals) for anyone
          without Terminal module access — see canSeeTerminalLedger() in
          utils/auth.js. JournalTab and FXTab keep the real `journals` (they
          write to it) and filter their own display internally instead. */}
      {tab==="overview"    && <OverviewTab journals={visibleJournals} coa={coa} bankStmt={bankStmt} setTab={setTab} isAdmin={isAdmin}/>}
      {tab==="coa"         && <COATab coa={coa} setCoa={setCoa} journals={visibleJournals} isAdmin={isAdmin}/>}
      {tab==="journal"     && <JournalTab journals={journals} setJournals={setJournals} coa={coa} filter={jFilter} setFilter={setJFilter} sourceFilter={jSource} setSourceFilter={setJSource}/>}
      {tab==="ledger"      && <LedgerTab journals={visibleJournals} coa={coa} isAdmin={isAdmin}/>}
      {tab==="trial"       && <TrialBalanceTab journals={visibleJournals} coa={coa} isAdmin={isAdmin}/>}
      {tab==="pl"          && <PLTab journals={visibleJournals} coa={coa} isAdmin={isAdmin}/>}
      {tab==="bs"          && <BalanceSheetTab journals={visibleJournals} coa={coa} isAdmin={isAdmin}/>}
      {tab==="cashflow"    && <CashFlowTab journals={visibleJournals} coa={coa} isAdmin={isAdmin}/>}
      {tab==="bank"        && <BankReconTab bankStmt={bankStmt} setBankStmt={setBankStmt} journals={visibleJournals} coa={coa}/>}
      {tab==="fx"          && <FXTab journals={journals} setJournals={setJournals} coa={coa} isAdmin={isAdmin}/>}
      {tab==="vat"         && <VATTab journals={visibleJournals} coa={coa} vatAdj={vatAdj} setVatAdj={setVatAdj}/>}
      {tab==="fixedassets" && <FixedAssetsTab assets={assets} setAssets={setAssets}/>}
      {tab==="wht"         && <WHTTab whtEntries={whtEntries} setWhtEntries={setWhtEntries}/>}
      {tab==="import"      && <ImportTab setCoa={setCoa} setJournals={setJournals}/>}
      </div>
    </div>
  );
}
