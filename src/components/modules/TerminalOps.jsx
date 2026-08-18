// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — TERMINAL OPERATIONS MODULE v2.0
// Based on actual SLOT sheets:
//   Image 1 → Slot Terminal (Clearing Agent) — Clearing & Charges
//   Image 2 → Floping Logistics Ltd Transaction Record — Logistics & Transit
// Primary key shared across all sub-modules: Container No
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo }    from '../../utils/auth';
import { showToast, generateId, formatDate } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { printHeader, openPrintWindow}  from '../../utils/logo';
import { diffAndPush } from '../../hooks/usePerRecordSync';
import { printBootstrap } from '../../utils/logo';

// terminal sub-collection name → RECORD_TABLES key, used by persist() below.
const TERMINAL_TABLE_BY_SECTION = {
  containers: 'terminalContainers', bols: 'terminalBols', charges: 'terminalCharges',
  logistics: 'terminalLogistics', advances: 'terminalAdvances',
  consignees: 'terminalConsignees', shippingCompanies: 'terminalShippingCompanies',
};

// ── Status pipeline ────────────────────────────────────────────────────────────
const STATUS_STAGES = ['Arrived','Transit Applied','Received in W/H','Under Exam','Released'];
const STATUS_ALL    = [...STATUS_STAGES, 'Held'];

const CONT_TYPES  = ['20ft DV','40ft DV','40ft HC','20ft Reefer','40ft Reefer','45ft HC','20ft OT','40ft OT','LCL (Groupage)'];
const CONT_SIZES  = ['20ft','40ft','45ft'];
const PORT_TYPES  = ['Sea','Air'];

// ── Shared form-field label wrapper (module scope — stable identity) ────────
// FIX (cursor/focus bug): this used to be redefined as a brand-new inline
// arrow function inside every modal's render body (ContainerModal,
// ChargeModal, LogisticsModal, BoLModal, AdvanceModal, ConsigneeModal,
// ShippingCompanyModal — 6 separate copies). Every keystroke in ANY field
// called setF() -> the modal re-rendered -> LBL got a fresh function
// reference -> React saw a different component type at that position in the
// tree -> it unmounted and remounted the whole <LBL> subtree, including the
// real <input> DOM node inside it -> the input lost focus after every single
// character typed ("the cursor disappears"). Same root cause, and same fix,
// as the documented Sidebar.jsx v3.1 rewrite: hoisting to module scope gives
// LBL one stable identity across every render, so React updates the existing
// DOM node instead of recreating it. All 6 previous copies were identical
// (or a strict subset — one predated the `full` prop), so this single
// definition replaces every one of them with no call-site changes needed.
function LBL({ t, full, children }) {
  const { C } = useTheme();
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, gridColumn: full ? '1/-1' : undefined }}>
      <label style={{ fontSize:11, fontWeight:600, color:C.textMid }}>{t}</label>
      {children}
    </div>
  );
}

// ── Seed data — matches actual SLOT sheet structure ───────────────────────────
// Emptied 2026-07-28 — held four fabricated Bills of Lading, four containers,
// three clearing charges (₦765,000 total, one pre-marked as already posted to
// Accounting), two logistics records and a ₦2.5m advance payment supposedly
// received from Nigerian LNG. The consignee and shipping-company entries were
// placeholders added during the 2026-07-25 Bill of Lading upgrade, not SLOT's
// own master data, so they go too.
//
// 2026-07-29 — renamed from SEED: this holds no demo content and never
// should again (see App.jsx boot-sequence note on why a "SEED" fallback
// sitting next to a live data path is dangerous). It only exists because
// TerminalOps reads termData.containers, .charges, .bols and so on directly,
// and a missing key would throw rather than show an empty tab.
const EMPTY_TERMINAL_DATA = {
  bols: [], containers: [], charges: [], logistics: [],
  advances: [], consignees: [], shippingCompanies: [],
};

// 2026-08-03 — renamed and reordered at the terminal team's request.
//
// Their working register is organised by Bill of Lading: the BoL is written
// once and its containers listed beneath it. The 'bols' view is the screen
// that mirrors that, so it is what they mean by "where everything is
// registered" — it is now called Container Registry and comes first.
//
// The flat one-row-per-container table keeps its place as a searchable list
// of every box. They suggested calling it "Overview"; it is named "All
// Containers" instead because the KPI cards directly above the tabs are
// already the overview, and two things called overview on one screen is the
// confusion this rename exists to remove. The name says exactly what the tab
// holds, which is what someone hunting for a single container number needs.
//
// The `key` values are UNCHANGED on purpose — deep links (getDeepLinkTab),
// saved tab state and every `tab === 'containers'` check throughout this file
// still work. Only the labels and the order moved.
const TABS = [
  { key:'bols',       label:'📦  Container Registry' },
  { key:'containers', label:'📋  All Containers'     },
  { key:'masters',    label:'🏢  Master Data'         },
  { key:'charges',    label:'💰  Clearing & Charges' },
  { key:'logistics',  label:'🚢  Logistics & Transit'},
  { key:'advances',   label:'💵  Advance Payments'    },
  { key:'statements', label:'📈  Standalone P&L/BS'  },
  { key:'reports',    label:'📊  Reports'             },
];

// ── Print: Slot Terminal Sheet (matches Image 1) ────────────────────────────
function printSlotTerminalSheet(list, containers) {
  const getType = no => (containers.find(c=>c.containerNo===no)||{}).containerType||'—';
  // 2026-08-15: pinned to 2 decimals — this prints a charges sheet handed to
  // suppliers/clients, so it needs to match their kobo-precise paperwork.
  const fmt = n => '₦'+Number(n||0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rows = list.map((c,i) => `
    <tr style="background:${i%2?'#f3faf5':'#fff'}">
      <td>${i+1}</td><td><strong>${c.containerNo}</strong></td><td>${getType(c.containerNo)}</td>
      <td>${formatDate(c.arrivalDate)||'—'}</td><td>${formatDate(c.paymentDate)||'—'}</td>
      <td>${c.receiptNo||'—'}</td>
      <td style="text-align:right">${fmt(c.equipmentCharge)}</td>
      <td style="text-align:right">${fmt(c.terminalCharge)}</td>
      <td style="text-align:right">${fmt(c.storageCharge)}</td>
      <td style="text-align:right;font-weight:700;color:#1A5C2A">${fmt(c.totalAmount)}</td>
      <td>${c.agentName||'—'}</td>
    </tr>`).join('');
  const grandTotal = list.reduce((s,c)=>s+(Number(c.totalAmount)||0),0);
  openPrintWindow(`<!DOCTYPE html><html><head><title>Slot Terminal Charges</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;padding:24px}
  table{width:100%;border-collapse:collapse;margin-top:14px}
  th{background:#1A5C2A;color:#fff;padding:7px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.4px}
  th.r,td.r{text-align:right}
  td{padding:6px 8px;border-bottom:1px solid #EAF0EB;font-size:10px}
  .tot{background:#0F3A1A;color:#fff;font-weight:800}
  @media print{body{padding:12px}}</style></head><body>
  ${printHeader('SLOT TERMINAL — CLEARING CHARGES','Total: '+list.length+' containers')}
  <table>
    <thead><tr>
      <th>S/N</th><th>Container No</th><th>Container Type</th>
      <th>Arrival Date</th><th>Payment Date</th><th>Receipt No</th>
      <th class="r">Equipment Charges</th><th class="r">Terminal Charge</th>
      <th class="r">Storage Charge</th><th class="r">Total Amount</th>
      <th>Agent Name</th>
    </tr></thead>
    <tbody>${rows}
    <tr class="tot"><td colspan="9" style="padding:8px;text-align:right">GRAND TOTAL</td>
    <td style="padding:8px;text-align:right;font-size:12px">₦${grandTotal.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td></td></tr>
    </tbody>
  </table>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px;margin-top:40px">
    <div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C">Prepared By / Date</div>
    <div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C">Reviewed By / Date</div>
    <div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C">Approved By / Date</div>
  </div>
  ${printBootstrap({landscape:true})}</body></html>`);
}

// ── Print: Floping Logistics Sheet (matches Image 2) ───────────────────────
function printFlopingLogisticsSheet(list) {
  const rows = list.map((l,i) => `
    <tr style="background:${i%2?'#f3faf5':'#fff'}">
      <td>${i+1}</td>
      <td>${formatDate(l.transitApplicationDate)||'—'}</td>
      <td>${l.billOfLading||'—'}</td>
      <td style="text-align:center">${l.noOfContainers||1}</td>
      <td>${l.billOfLading||'—'}</td>
      <td>${l.containerSize||'—'}</td>
      <td><strong>${l.containerNo||'—'}</strong></td>
      <td>${l.materialDescription||'—'}</td>
      <td>${l.consigneeName||'—'}</td>
      <td>${l.shippingCompany||'—'}</td>
      <td>${l.shippingVessel||'—'}</td>
      <td>${formatDate(l.warehouseReceiptDate)||'—'}</td>
      <td>${formatDate(l.examDate)||'—'}</td>
      <td>${formatDate(l.releaseDate)||'—'}</td>
      <td>${l.status||'—'}${l.remarks?' — '+l.remarks:''}</td>
    </tr>`).join('');
  openPrintWindow(`<!DOCTYPE html><html><head><title>Floping Logistics Transaction Record</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:9.5px;padding:20px}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th{background:#1A5C2A;color:#fff;padding:6px 6px;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.3px}
  td{padding:5px 6px;border-bottom:1px solid #EAF0EB;font-size:9px;vertical-align:top}
  @media print{body{padding:10px}}</style></head><body>
  ${printHeader('FLOPING LOGISTICS LTD — TRANSACTION RECORD','Total: '+list.length+' entries')}
  <table>
    <thead><tr>
      <th>S/N</th><th>Date of Transit Application</th><th>Bill of Lading No</th>
      <th>No of Containers</th><th>Bill/Lading</th><th>Size</th>
      <th>Container No</th><th>Material Description / Packages</th>
      <th>Name of Consignee</th><th>Shipping Company</th><th>Shipping Vessel</th>
      <th>Date of Receipt into W/H</th><th>Date of Exam</th>
      <th>Date of Release</th><th>Status / Remarks</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${printBootstrap({landscape:true})}</body></html>`);
}

// ── Print: ONE Bill of Lading and its containers ──────────────────────────────
// Requested by the terminal team 2026-08-03. The registry print covers all
// 1,000+ containers at once, which is the wrong document when you need to hand
// a single consignee the sheet for THEIR shipment, or file one job.
//
// This prints the BoL as it is worked: shipment details at the top, then every
// container beneath it with the four clearing dates — the same layout as their
// own register sheet, so it can be checked against the original line by line.
function printSingleBoL(bol, childContainers, charges = []) {
  const d = v => v ? formatDate(v) : '—';
  const money = n => '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalCharges = charges.reduce((s, c) => s + (Number(c.totalAmount) || 0), 0);

  const rows = childContainers.map((c, i) => `
    <tr style="background:${i % 2 ? '#f3faf5' : '#fff'}">
      <td>${i + 1}</td>
      <td><strong>${c.containerNo || '—'}</strong></td>
      <td>${c.containerType || c.size || '—'}</td>
      <td>${c.consigneeName || '—'}</td>
      <td>${c.materialDescription || '—'}</td>
      <td>${d(c.transireDate)}</td>
      <td>${d(c.warehouseReceiptDate)}</td>
      <td>${d(c.examinationDate)}</td>
      <td>${d(c.releaseDate)}</td>
      <td>${c.status || '—'}</td>
    </tr>`).join('');

  const consignees = Array.from(new Set(childContainers.map(c => c.consigneeName).filter(Boolean)));

  openPrintWindow(`<!DOCTYPE html><html><head><title>BoL ${bol.billOfLadingNo || ''}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;padding:22px;color:#182A1C}
    table{width:100%;border-collapse:collapse;margin-top:14px}
    th{background:#1A5C2A;color:#fff;padding:7px 8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.3px}
    td{padding:6px 8px;border-bottom:1px solid #EAF0EB;font-size:10px}
    .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 18px;margin-top:6px;
          padding:12px 14px;background:#F3FAF5;border:1px solid #D4E0D6;border-radius:6px}
    .meta div span{display:block;font-size:9px;font-weight:700;color:#182A1C;text-transform:uppercase;letter-spacing:.4px}
    .meta div strong{font-size:11.5px;color:#182A1C}
    .sign{margin-top:34px;display:flex;justify-content:space-between;gap:40px}
    .sign div{flex:1;border-top:1px solid #7A8C7E;padding-top:5px;font-size:9.5px;font-weight:600;color:#182A1C}
    @media print{body{padding:10px}@page{margin:12mm}}
  </style></head><body>
  ${printHeader('BILL OF LADING — CONTAINER SHEET', 'BoL ' + (bol.billOfLadingNo || '—'))}
  <div class="meta">
    <div><span>Bill of Lading</span><strong>${bol.billOfLadingNo || '—'}</strong></div>
    <div><span>Shipping Company</span><strong>${bol.shippingCompany || '—'}</strong></div>
    <div><span>Vessel</span><strong>${bol.shippingVessel || '—'}</strong></div>
    <div><span>Containers</span><strong>${childContainers.length}</strong></div>
    <div><span>Consignee${consignees.length > 1 ? 's' : ''}</span><strong>${consignees.join(', ') || '—'}</strong></div>
    <div><span>Port of Loading</span><strong>${bol.portOfLoading || '—'}</strong></div>
    <div><span>Port of Discharge</span><strong>${bol.portOfDischarge || '—'}</strong></div>
    <div><span>Status</span><strong>${bol.status || '—'}</strong></div>
    <div><span>ETA</span><strong>${d(bol.etaDate)}</strong></div>
    <div><span>ATA</span><strong>${d(bol.ataDate)}</strong></div>
    <div><span>Free Time Expiry</span><strong>${d(bol.freeTimeExpiry)}</strong></div>
    <div><span>Total Charges</span><strong>${money(totalCharges)}</strong></div>
  </div>
  <table>
    <thead><tr>
      <th>S/N</th><th>Container No</th><th>Type</th><th>Consignee</th><th>Material</th>
      <th>Transire</th><th>Into Warehouse</th><th>Examination</th><th>Release</th><th>Status</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="10" style="text-align:center;padding:18px;color:#182A1C">No containers linked to this Bill of Lading.</td></tr>'}</tbody>
  </table>
  <div class="sign">
    <div>Prepared by — name, signature &amp; date</div>
    <div>Checked by — name, signature &amp; date</div>
    <div>Received by — name, signature &amp; date</div>
  </div>
  ${printBootstrap({landscape:true})}</body></html>`);
}

// ── Print: Container Registry ─────────────────────────────────────────────────
function printContainerRegistry(list) {
  const rows = list.map((c,i) => `
    <tr style="background:${i%2?'#f3faf5':'#fff'}">
      <td>${i+1}</td><td><strong>${c.containerNo}</strong></td>
      <td>${c.containerType||'—'}</td><td>${c.size||'—'}</td>
      <td>${c.portType||'—'}</td><td>${c.billOfLading||'—'}</td>
      <td>${c.noOfContainers||1}</td><td>${c.shippingCompany||'—'}</td>
      <td>${c.shippingVessel||'—'}</td><td>${c.consigneeName||'—'}</td>
      <td>${c.materialDescription||'—'}</td><td>${c.status||'—'}</td>
    </tr>`).join('');
  openPrintWindow(`<!DOCTYPE html><html><head><title>Container Registry</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:10px;padding:20px}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th{background:#1A5C2A;color:#fff;padding:7px 7px;text-align:left;font-size:8.5px;text-transform:uppercase}
  td{padding:6px 7px;border-bottom:1px solid #EAF0EB;font-size:9.5px}
  @media print{body{padding:10px}}</style></head><body>
  ${printHeader('CONTAINER REGISTRY','Total: '+list.length+' containers')}
  <table>
    <thead><tr>
      <th>S/N</th><th>Container No</th><th>Type</th><th>Size</th>
      <th>Port Type</th><th>Bill of Lading</th><th>No. of Cont.</th>
      <th>Shipping Company</th><th>Vessel</th>
      <th>Consignee</th><th>Material Description</th><th>Status</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${printBootstrap({landscape:true})}</body></html>`);
}

// ── Shared UI components ───────────────────────────────────────────────────────
function Btn({children,onClick,variant='primary',sm,disabled,style={}}) {
  const {C}=useTheme();
  const V={primary:{bg:C.green,co:'#fff',b:'none'},ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border},danger:{bg:C.danger,co:'#fff',b:'none'},amber:{bg:C.amber,co:'#fff',b:'none'},outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green},info:{bg:C.info,co:'#fff',b:'none'}}[variant]||{};
  return <button onClick={onClick} disabled={disabled} style={{background:V.bg,color:V.co,border:V.b,borderRadius:7,padding:sm?'4px 11px':'7px 16px',fontSize:sm?11.5:13,fontWeight:500,cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.5:1,display:'inline-flex',alignItems:'center',gap:5,whiteSpace:'nowrap',...style}}>{children}</button>;
}

function StatusBadge({status}) {
  const {C}=useTheme();
  const M={Released:[C.success,'rgba(26,122,74,.12)'],'Transit Applied':[C.info,'rgba(26,92,138,.12)'],'Received in W/H':[C.amber,'rgba(201,122,10,.12)'],'Under Exam':[C.amber,'rgba(201,122,10,.12)'],Arrived:[C.textMuted,'rgba(107,114,128,.1)'],Held:[C.danger,'rgba(192,57,43,.12)']};
  const [co,bg]=M[status]||[C.textMuted,'rgba(107,114,128,.1)'];
  return <span style={{display:'inline-block',padding:'2px 9px',borderRadius:20,fontSize:11,fontWeight:600,color:co,background:bg,border:`1px solid ${co}30`,whiteSpace:'nowrap'}}>{status}</span>;
}

function Pipeline({status}) {
  const {C}=useTheme();
  const idx=STATUS_STAGES.indexOf(status);
  const isHeld=status==='Held';
  return (
    <div style={{display:'flex',alignItems:'center',gap:0,flexWrap:'nowrap',minWidth:0}}>
      {STATUS_STAGES.map((s,i)=>{
        const done=!isHeld&&i<=idx;
        const active=!isHeld&&i===idx;
        const co=done?C.green:C.textMuted;
        return (
          <div key={s} style={{display:'flex',alignItems:'center',minWidth:0}}>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,minWidth:0}}>
              <div style={{width:12,height:12,borderRadius:'50%',background:done?C.green:C.borderLight,border:active?'2px solid '+C.green:'2px solid transparent',flexShrink:0}}/>
              <div style={{fontSize:9,color:co,fontWeight:active?700:400,whiteSpace:'nowrap',textOverflow:'ellipsis',overflow:'hidden',maxWidth:60}}>{s}</div>
            </div>
            {i<STATUS_STAGES.length-1&&<div style={{height:2,width:20,background:i<idx&&!isHeld?C.green:C.borderLight,flexShrink:0,margin:'0 2px 10px'}}/>}
          </div>
        );
      })}
      {isHeld&&<div style={{marginLeft:8,padding:'1px 8px',borderRadius:20,background:'rgba(192,57,43,.12)',color:C.danger,fontSize:10,fontWeight:700}}>HELD</div>}
    </div>
  );
}

function KPI({label,value,sub,accent,alert,onClick}) {
  const {C}=useTheme(); const c=alert?C.danger:accent||C.green;
  return <div onClick={onClick} onMouseEnter={e=>{if(onClick){e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,0.15)';}}} onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow=C.shadowCard;}} style={{background:C.bgCard,border:'1px solid '+(alert?C.danger+'40':C.border),borderRadius:12,padding:'13px 15px',flex:1,minWidth:130,position:'relative',boxShadow:C.shadowCard,cursor:onClick?'pointer':'default',transition:'transform 0.12s,box-shadow 0.12s'}}><div style={{position:'absolute',left:0,top:0,bottom:0,width:4,background:c,borderRadius:'12px 0 0 12px'}}/><div style={{paddingLeft:8}}><div style={{fontSize:10,fontWeight:600,color:C.textMuted,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>{label}</div><div style={{fontSize:22,fontWeight:700,color:c,lineHeight:1}}>{value}</div>{sub&&<div style={{fontSize:11,color:C.textMuted,marginTop:3}}>{sub}</div>}</div></div>;
}

function Overlay({children,onClose}) {
  // 2026-08-15: backdrop no longer closes the form on click — see same fix
  // in ui/index.jsx's shared Modal and Procurement.jsx's Overlay.
  return <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(10,35,15,0.62)',backdropFilter:'blur(3px)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'24px 16px',overflowY:'auto'}}><div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:720,marginBottom:32}}>{children}</div></div>;
}

// ── Main export ────────────────────────────────────────────────────────────────
export default function TerminalOps({ onNav }) {
  const {state,dispatch}=useApp();
  const {C}=useTheme();
  const {currentUser,db}=state;

  const termData=useMemo(()=>(db.terminal&&!Array.isArray(db.terminal))?db.terminal:EMPTY_TERMINAL_DATA,[db.terminal]);
  const containers=(termData.containers||[]).filter(c=>!c.voided);
  const bols      =(termData.bols||[]).filter(b=>!b.voided);
  const charges   =(termData.charges||[]).filter(c=>!c.voided);
  const logistics =(termData.logistics||[]).filter(l=>!l.voided);
  const advances  =(termData.advances||[]).filter(a=>!a.voided);
  const consignees=(termData.consignees||[]).filter(c=>!c.voided);
  const shippingCompanies=(termData.shippingCompanies||[]).filter(s=>!s.voided);

  // Read deep-link tab from sessionStorage (set by Dashboard alert banners)
  const [tab,setTab] = useState(() => {
    const stored = sessionStorage.getItem('slot_erp_nav_tab_terminal');
    if (stored) { sessionStorage.removeItem('slot_erp_nav_tab_terminal'); return stored; }
    // Land on the Container Registry (the BoL-grouped view) — it is the tab
    // that matches how the terminal team actually keeps their register, so it
    // is what they expect to see first. Was 'containers' (the flat list).
    return 'bols';
  });
  const [containerFilter,setContainerFilter]=useState('');
  const [search,setSearch]=useState('');
  const [modal,setModal]  =useState(null);

  const perms={add:canDo(currentUser,'canAdd','terminal',state.appSettings),edit:canDo(currentUser,'canEdit','terminal',state.appSettings),del:canDo(currentUser,'canDelete','terminal',state.appSettings)};

  function persist(next) {
    // Per-record push — 2026-07-29 full-app sync sweep. Every terminal
    // mutation (deleteItem/saveItem/saveBoLWithContainers) funnels through
    // here, so diffing all 7 sub-collections once in this one place covers
    // every caller — no need to touch each of them individually.
    for (const [section, table] of Object.entries(TERMINAL_TABLE_BY_SECTION)) {
      if (termData[section] !== next[section]) diffAndPush(table, termData[section], next[section]);
    }
    dispatch({type:'UPDATE_MODULE',mod:'terminal',data:next});
    saveDBLocal({...db,terminal:next},state.activity);
  }
  // Naive plural→singular for activity-log text (matches every section name
  // except 'shippingCompanies', where a trailing-'s' slice would produce
  // the wrong word — "shippingCompanie" — so that one is special-cased.
  function singularOf(section) {
    if (section === 'shippingCompanies') return 'shipping company';
    return section.slice(0,-1);
  }
  function deleteItem(section,id) {
    if (section === 'charges' || section === 'advances') {
      // Charges/advances can reach the GL once posted — void instead of removing, so
      // a posted entry gets an automatic reversing entry instead of just
      // vanishing from the ledger with no trace. Same pattern as AR/Petty
      // Cash/Fixed Assets.
      const next = {...termData, [section]: termData[section].map(c => c.id===id ? {...c, voided:true} : c)};
      persist(next);
      logActivity(dispatch,'Voided terminal '+(section==='charges'?'charge':'advance payment'),currentUser);
      showToast('Voided','error');
      return;
    }
    if (section === 'bols') {
      // FIX (found while verifying this upgrade): deleting a BoL used to
      // leave its child containers pointing at a bolId that no longer
      // exists — a dangling reference with no UI indication why the
      // container quietly stopped showing under any BoL. Unlink them
      // instead; the free-text billOfLading field is left as-is so the
      // historical "this arrived under BoL X" breadcrumb survives.
      const next = {
        ...termData,
        bols: termData.bols.filter(x=>x.id!==id),
        containers: (termData.containers||[]).map(c => c.bolId===id ? {...c, bolId:null} : c),
      };
      persist(next);
      logActivity(dispatch,'Deleted terminal bill of lading (unlinked its containers)',currentUser);
      showToast('Deleted','error');
      return;
    }
    const next={...termData,[section]:termData[section].filter(x=>x.id!==id)};
    persist(next);
    logActivity(dispatch,'Deleted terminal '+singularOf(section),currentUser);
    showToast('Deleted','error');
  }
  function saveItem(section,item) {
    const list=termData[section]||[];
    const isEdit=list.some(x=>x.id===item.id);
    const next={...termData,[section]:isEdit?list.map(x=>x.id===item.id?item:x):[...list,item]};
    persist(next);
    logActivity(dispatch,(isEdit?'Updated':'Added')+' terminal '+singularOf(section),currentUser);
    showToast(isEdit?'Updated':'Saved');
    setModal(null);
  }
  // Saves a Bill of Lading and its container line items in ONE state update.
  //
  // Doing both in a single persist() matters: two sequential saveItem() calls
  // would each read the same stale `termData` snapshot, so the second would
  // overwrite the first's changes. This is the same whole-object-overwrite
  // hazard the 2026-07-23 audit flagged in the legacy sync engine.
  //
  // Rows are written as real container records (bolId set), so the Container
  // Registry, Charges, Logistics and Advances keep working exactly as before.
  // A row that was removed from the table unlinks its container rather than
  // deleting it — BoLModal already refuses to remove any row that has charges
  // or logistics attached, so anything reaching here is safe to unlink, and
  // an unlinked container stays visible in the registry instead of vanishing.
  function saveBoLWithContainers(bol, rows) {
    const list = termData.bols || [];
    const isEdit = list.some(x => x.id === bol.id);
    const filled = (rows || []).filter(r => (r.containerNo || '').trim());
    const keptIds = new Set(filled.map(r => r.id));

    const nextContainers = (termData.containers || []).map(c =>
      (c.bolId === bol.id && !keptIds.has(c.id)) ? { ...c, bolId: null } : c
    );

    filled.forEach(r => {
      const idx = nextContainers.findIndex(c => c.id === r.id);
      const prev = idx >= 0 ? nextContainers[idx] : {};
      const merged = {
        ...prev,
        id: r.id,
        bolId: bol.id,
        containerNo: r.containerNo.trim(),
        containerType: r.containerType || prev.containerType || '40ft DV',
        size: r.size || prev.size || '40ft',
        consigneeId: r.consigneeId || '',
        consigneeName: r.consigneeName || '',
        materialDescription: r.materialDescription || '',
        status: r.status || prev.status || 'Arrived',
        // ── Clearing lifecycle dates ──────────────────────────────────────
        // transire application → receipt into warehouse → examination →
        // release. Added 2026-08-03 when importing FLOPENG's historical
        // register, which tracked all four per container. `?? prev.x` (not
        // `|| prev.x`) so a deliberately CLEARED date stays cleared instead
        // of silently reverting to the previous value.
        transireDate:         r.transireDate         ?? prev.transireDate         ?? '',
        warehouseReceiptDate: r.warehouseReceiptDate ?? prev.warehouseReceiptDate ?? '',
        examinationDate:      r.examinationDate      ?? prev.examinationDate      ?? '',
        releaseDate:          r.releaseDate          ?? prev.releaseDate          ?? '',
        remark:               r.remark               ?? prev.remark               ?? '',
        // Shipment details live on the BoL — mirror them onto each container
        // so the Container Registry columns and the printed sheets read
        // correctly without having to join back to the BoL every time.
        billOfLading: bol.billOfLadingNo || '',
        shippingCompany: bol.shippingCompany || '',
        shippingCompanyId: bol.shippingCompanyId || '',
        shippingVessel: bol.shippingVessel || '',
        portOfLoading: bol.portOfLoading || '',
        portOfDischarge: bol.portOfDischarge || '',
        portType: prev.portType || 'Sea',
        noOfContainers: prev.noOfContainers || 1,
        createdAt: prev.createdAt || new Date().toISOString(),
      };
      if (idx >= 0) nextContainers[idx] = merged; else nextContainers.push(merged);
    });

    persist({
      ...termData,
      bols: isEdit ? list.map(x => x.id === bol.id ? bol : x) : [...list, bol],
      containers: nextContainers,
    });
    logActivity(dispatch, (isEdit ? 'Updated' : 'Added') + ' terminal bill of lading ' + (bol.billOfLadingNo || '') + ' with ' + filled.length + ' container(s)', currentUser);
    showToast((isEdit ? 'Updated' : 'Saved') + ' — ' + filled.length + ' container' + (filled.length === 1 ? '' : 's'));
    setModal(null);
  }

  function postToAccounting(charge) {
    // This used to hand-build a journal entry and write it to db.accounting —
    // a key the real Accounting module never reads, so charges marked
    // "Posted" here never actually reached the Journal, Trial Balance, P&L,
    // or Balance Sheet. Fixed: this now just sets the flag that the real
    // auto-post effect in Accounting.jsx watches (the same pattern AR, AP,
    // Petty Cash, and Fixed Assets already use) — Accounting.jsx is the
    // single place that ever writes an actual journal entry.
    const postDate = new Date().toISOString().split('T')[0];
    const updatedCharges = charges.map(c => c.id===charge.id ? {...c, postedToAccounting:true, postDate} : c);
    const next = {...termData, charges: updatedCharges};
    persist(next);
    logActivity(dispatch,'Posted terminal charges for '+charge.containerNo+' to Accounting',currentUser);
    showToast('✓ Posted to Accounting');
  }

  const unpaid=charges.filter(c=>!c.postedToAccounting).length;
  const active=containers.filter(c=>!['Released'].includes(c.status)).length;
  const heldOnly=containerFilter?containers.filter(c=>c.status===containerFilter):null;
  const totalCharges=charges.reduce((s,c)=>s+(Number(c.totalAmount)||0),0);
  const heldCount=containers.filter(c=>c.status==='Held').length;

  const tabBtn=k=>({padding:'9px 16px',fontSize:12,background:'none',border:'none',cursor:'pointer',color:tab===k?C.green:C.textMuted,borderBottom:tab===k?'2px solid '+C.green:'2px solid transparent',fontWeight:tab===k?700:400,whiteSpace:'nowrap'});
  const th={padding:'9px 10px',textAlign:'left',fontSize:10.5,fontWeight:700,color:C.tableHeaderText||C.textMid,textTransform:'uppercase',letterSpacing:'.4px',whiteSpace:'nowrap',background:C.tableHeaderBg||C.greenPale,borderBottom:'2px solid '+C.border};
  const td=i=>({padding:'9px 10px',borderBottom:'1px solid '+C.borderLight,color:C.text,fontSize:12.5,background:i%2===1?C.greenPale2:'transparent'});
  const inpSt={flex:1,minWidth:200,padding:'7px 11px',borderRadius:7,border:'1px solid '+C.border,background:C.bgCard,color:C.text,fontSize:13,outline:'none'};

  function fl(list,fields) {
    if(!search)return list;
    const q=search.toLowerCase();
    return q?list.filter(x=>fields.some(f=>(x[f]||'').toString().toLowerCase().includes(q))):list;
  }
  // FIX (schema audit B.5): every cross-collection lookup that resolves a
  // charge/logistics/advance record back to "its" container used to match
  // on containerNo text alone — if a container number is ever reused on a
  // later shipment, that would silently cross-associate history between
  // shipments. Prefer the stable containerId link when present; fall back
  // to containerNo for records saved before this upgrade. Centralised here
  // so charges, BoL roll-ups, and reports all resolve it the same way.
  function belongsToContainer(record, container) {
    if (!record || !container) return false;
    return record.containerId ? record.containerId === container.id : record.containerNo === container.containerNo;
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
        <KPI label="Active Containers" value={active} accent={C.info} sub="not yet released" onClick={()=>{setTab("containers");setContainerFilter("");}}/>
        <KPI label="Total Containers"  value={containers.length} accent={C.green}/>
        <KPI label="Containers Held"   value={heldCount} alert={heldCount>0} sub="require attention" onClick={()=>{setTab("containers");setContainerFilter("Held");}}/>
        <KPI label="Unposted Charges"  value={unpaid} alert={unpaid>0} sub="not in accounting" onClick={() => setTab("charges")}/>
        <KPI label="Total Charges (₦)" value={'₦'+totalCharges.toLocaleString('en-NG')} accent={C.amber}/>
      </div>

      <div style={{background:C.bgCard,border:'1px solid '+C.border,borderRadius:12,boxShadow:C.shadowCard}}>
        <div style={{padding:'14px 20px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',borderRadius:'12px 12px 0 0'}}>
          <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>🏭 Terminal Operations</div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.6)',marginTop:2}}>Slot Terminal (clearing agent) · Floping Logistics (transit records) · linked by Container No</div>
        </div>

        <div style={{display:'flex',flexWrap:'wrap',gap:'4px 0',borderBottom:'2px solid '+C.borderLight,padding:'0 20px'}}>
          {TABS.map(t=><button key={t.key} onClick={()=>{setTab(t.key);setSearch('');setContainerFilter('');}} style={tabBtn(t.key)}>{t.label}</button>)}
        </div>

        <div style={{padding:'14px 20px',display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          {tab!=='reports'&&<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={inpSt}/>}
          {perms.add&&tab==='containers'&&<Btn onClick={()=>setModal({type:'cont_add',data:{id:generateId(),status:'Arrived',portType:'Sea',noOfContainers:1,createdAt:new Date().toISOString()}})}>+ Add Container</Btn>}
          {perms.add&&tab==='bols'      &&<Btn onClick={()=>setModal({type:'bol_add',data:{id:generateId(),status:'In Transit',totalContainers:1,createdAt:new Date().toISOString()}})}>+ Add Bill of Lading</Btn>}
          {perms.add&&tab==='masters'   &&<Btn onClick={()=>setModal({type:'cons_add',data:{id:generateId(),createdAt:new Date().toISOString()}})}>+ Add Consignee</Btn>}
          {perms.add&&tab==='masters'   &&<Btn variant="outline" onClick={()=>setModal({type:'sc_add',data:{id:generateId(),createdAt:new Date().toISOString()}})}>+ Add Shipping Company</Btn>}
          {perms.add&&tab==='charges'   &&<Btn onClick={()=>setModal({type:'chg_add',data:{id:generateId(),postedToAccounting:false,createdAt:new Date().toISOString()}})}>+ Add Charge Record</Btn>}
          {perms.add&&tab==='logistics' &&<Btn onClick={()=>setModal({type:'log_add',data:{id:generateId(),noOfContainers:1,status:'Transit Applied',createdAt:new Date().toISOString()}})}>+ Add Transit Record</Btn>}
          {perms.add&&tab==='advances'  &&<Btn onClick={()=>setModal({type:'adv_add',data:{id:generateId(),currency:'NGN',amount:0,containersCovered:[],applications:[],status:'Open',createdAt:new Date().toISOString()}})}>+ Record Advance Payment</Btn>}
          {tab==='containers'&&<Btn variant="ghost" onClick={()=>printContainerRegistry(fl(containers,['containerNo','consigneeName','shippingCompany','materialDescription','status'],containerFilter))}>🖨 Print Registry</Btn>}
          {tab==='charges'   &&<Btn variant="ghost" onClick={()=>printSlotTerminalSheet(fl(charges,['containerNo','agentName','receiptNo']),containers)}>🖨 Print Slot Terminal Sheet</Btn>}
          {tab==='logistics' &&<Btn variant="ghost" onClick={()=>printFlopingLogisticsSheet(fl(logistics,['containerNo','billOfLading','consigneeName','shippingCompany','status']))}>🖨 Print Floping Logistics Sheet</Btn>}
        </div>

        <div style={{padding:'0 20px 20px',overflowX:'auto'}}>

          {/* ── TAB 1: CONTAINER REGISTRY ────────────────────────────── */}
          {tab==='containers'&&(
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:1100}}>
              <thead><tr>{['S/N','Container No','Type','Size','Port Type','Bill of Lading','No. of Cont.','Shipping Company','Vessel','Consignee','Material Description','Status','Pipeline',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {fl(containers,['containerNo','consigneeName','shippingCompany','materialDescription','status'],containerFilter).length===0&&<tr><td colSpan={14} style={{textAlign:'center',padding:32,color:C.textMuted}}>No containers found</td></tr>}
                {fl(containers,['containerNo','consigneeName','shippingCompany','materialDescription','status'],containerFilter).map((c,i)=>(
                  <tr key={c.id} style={{cursor:'pointer'}} onClick={()=>setModal({type:'cont_view',data:c})}
                    onMouseEnter={e=>e.currentTarget.style.background=C.greenPale}
                    onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.greenPale2:'transparent'}>
                    <td style={td(i)}>{i+1}</td>
                    <td style={{...td(i),color:C.green,fontFamily:'monospace',fontWeight:700}}>{c.containerNo}</td>
                    <td style={{...td(i),fontSize:11,color:C.textMuted}}>{c.containerType}</td>
                    <td style={{...td(i),fontSize:11}}>{c.size}</td>
                    <td style={td(i)}><span style={{fontSize:11,fontWeight:600,color:c.portType==='Air'?C.info:C.textMid}}>{c.portType}</span></td>
                    <td style={{...td(i),fontFamily:'monospace',fontSize:11,color:C.textMuted}}>{c.billOfLading||'—'}</td>
                    <td style={{...td(i),textAlign:'center'}}>{c.noOfContainers||1}</td>
                    <td style={td(i)}>{c.shippingCompany}</td>
                    <td style={{...td(i),color:C.textMuted}}>{c.shippingVessel}</td>
                    <td style={{...td(i),fontWeight:600}}>{c.consigneeName}</td>
                    <td style={{...td(i),color:C.textMuted,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.materialDescription}</td>
                    <td style={td(i)}><StatusBadge status={c.status}/></td>
                    <td style={{...td(i),minWidth:300}}><Pipeline status={c.status}/></td>
                    <td style={td(i)} onClick={e=>e.stopPropagation()}>
                      <div style={{display:'flex',gap:4}}>
                        {perms.edit&&<Btn variant="outline" sm onClick={()=>setModal({type:'cont_edit',data:{...c}})}>Edit</Btn>}
                        {perms.del &&<Btn variant="danger"  sm onClick={()=>deleteItem('containers',c.id)}>Del</Btn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ── TAB: MASTER DATA (Consignees & Shipping Companies) ──────── */}
          {tab==='masters'&&(
            <div style={{display:'flex',flexDirection:'column',gap:20}}>
              <div style={{padding:'10px 14px',background:'rgba(26,92,138,.08)',border:'1px solid rgba(26,92,138,.2)',borderLeft:'4px solid '+C.info,borderRadius:8,fontSize:11.5,color:C.info,lineHeight:1.6}}>
                💡 Consignees and Shipping Companies added here become selectable on the Container and Bill of Lading forms, instead of being typed fresh on every record.
              </div>
              <div>
                <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:C.text}}>📋 Consignees ({consignees.length})</div>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead><tr>{['Name','Address','Phone','Email',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {consignees.length===0&&<tr><td colSpan={5} style={{textAlign:'center',padding:20,color:C.textMuted}}>No consignees yet — click "+ Add Consignee" above.</td></tr>}
                    {consignees.map((c,i)=>(
                      <tr key={c.id}>
                        <td style={{...td(i),fontWeight:600}}>{c.name}</td>
                        <td style={{...td(i),color:C.textMuted}}>{c.address||'—'}</td>
                        <td style={td(i)}>{c.phone||'—'}</td>
                        <td style={td(i)}>{c.email||'—'}</td>
                        <td style={td(i)}>
                          <div style={{display:'flex',gap:4}}>
                            {perms.edit&&<Btn variant="outline" sm onClick={()=>setModal({type:'cons_edit',data:{...c}})}>Edit</Btn>}
                            {perms.del &&<Btn variant="danger"  sm onClick={()=>deleteItem('consignees',c.id)}>Del</Btn>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div style={{fontWeight:700,fontSize:13,marginBottom:8,color:C.text}}>🚢 Shipping Companies ({shippingCompanies.length})</div>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,maxWidth:500}}>
                  <thead><tr>{['Name',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {shippingCompanies.length===0&&<tr><td colSpan={2} style={{textAlign:'center',padding:20,color:C.textMuted}}>No shipping companies yet</td></tr>}
                    {shippingCompanies.map((s,i)=>(
                      <tr key={s.id}>
                        <td style={{...td(i),fontWeight:600}}>{s.name}</td>
                        <td style={td(i)}>
                          <div style={{display:'flex',gap:4}}>
                            {perms.edit&&<Btn variant="outline" sm onClick={()=>setModal({type:'sc_edit',data:{...s}})}>Edit</Btn>}
                            {perms.del &&<Btn variant="danger"  sm onClick={()=>deleteItem('shippingCompanies',s.id)}>Del</Btn>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── TAB 2: CLEARING & CHARGES (Image 1 — Slot Terminal) ───── */}
          {tab==='charges'&&(
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:1050}}>
              <thead><tr>{['S/N','Container No','Container Type','Arrival Date','Payment Date','Receipt No','Equipment Charges','Terminal Charge','Storage Charge','Total Amount','Agent Name','Posted?',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {fl(charges,['containerNo','agentName','receiptNo']).length===0&&<tr><td colSpan={13} style={{textAlign:'center',padding:32,color:C.textMuted}}>No charge records found</td></tr>}
                {fl(charges,['containerNo','agentName','receiptNo']).map((c,i)=>{
                  const cont=containers.find(x=>belongsToContainer(c,x))||{};
                  return (
                    <tr key={c.id}>
                      <td style={td(i)}>{i+1}</td>
                      <td style={{...td(i),color:C.green,fontFamily:'monospace',fontWeight:700}}>{c.containerNo}</td>
                      <td style={{...td(i),fontSize:11,color:C.textMuted}}>{cont.containerType||'—'}</td>
                      <td style={td(i)}>{formatDate(c.arrivalDate)||'—'}</td>
                      <td style={td(i)}>{formatDate(c.paymentDate)||'—'}</td>
                      <td style={{...td(i),fontFamily:'monospace',fontSize:11}}>{c.receiptNo||'—'}</td>
                      <td style={{...td(i),textAlign:'right'}}>₦{Number(c.equipmentCharge||0).toLocaleString('en-NG')}</td>
                      <td style={{...td(i),textAlign:'right'}}>₦{Number(c.terminalCharge||0).toLocaleString('en-NG')}</td>
                      <td style={{...td(i),textAlign:'right'}}>₦{Number(c.storageCharge||0).toLocaleString('en-NG')}</td>
                      <td style={{...td(i),textAlign:'right',fontWeight:800,color:C.amber,fontSize:13}}>₦{Number(c.totalAmount||0).toLocaleString('en-NG')}</td>
                      <td style={td(i)}>{c.agentName||'—'}</td>
                      <td style={td(i)}>
                        <span style={{fontWeight:700,color:c.postedToAccounting?C.success:C.danger}}>
                          {c.postedToAccounting?'✓ Yes':'✗ No'}
                        </span>
                      </td>
                      <td style={td(i)}>
                        <div style={{display:'flex',gap:4,flexWrap:'nowrap'}}>
                          {!c.postedToAccounting&&canDo(currentUser,'canApprove','terminal',state.appSettings)&&<Btn variant="amber" sm onClick={()=>postToAccounting(c)}>Post →</Btn>}
                          {perms.edit&&<Btn variant="outline" sm onClick={()=>setModal({type:'chg_edit',data:{...c}})}>Edit</Btn>}
                          {perms.del &&<Btn variant="danger"  sm onClick={()=>deleteItem('charges',c.id)}>Del</Btn>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {charges.length>0&&<tfoot><tr style={{background:C.greenPale,fontWeight:700}}>
                <td colSpan={6} style={{...td(0),textAlign:'right',fontSize:11}}>Totals</td>
                <td style={{...td(0),textAlign:'right'}}>₦{charges.reduce((s,c)=>s+(Number(c.equipmentCharge)||0),0).toLocaleString('en-NG')}</td>
                <td style={{...td(0),textAlign:'right'}}>₦{charges.reduce((s,c)=>s+(Number(c.terminalCharge)||0),0).toLocaleString('en-NG')}</td>
                <td style={{...td(0),textAlign:'right'}}>₦{charges.reduce((s,c)=>s+(Number(c.storageCharge)||0),0).toLocaleString('en-NG')}</td>
                <td style={{...td(0),textAlign:'right',color:C.amber,fontSize:14}}>₦{totalCharges.toLocaleString('en-NG')}</td>
                <td colSpan={3} style={td(0)}/>
              </tr></tfoot>}
            </table>
          )}

          {/* ── TAB 3: LOGISTICS & TRANSIT (Image 2 — Floping Logistics) */}
          {tab==='logistics'&&(
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:1200}}>
              <thead><tr>{['S/N','Date of Transit Application','Bill of Lading No','No. of Cont.','Size','Container No','Material Description / Packages','Name of Consignee','Shipping Company','Shipping Vessel','Date of Receipt into W/H','Date of Exam','Date of Release','Status / Remarks',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {fl(logistics,['containerNo','billOfLading','consigneeName','shippingCompany','status']).length===0&&<tr><td colSpan={15} style={{textAlign:'center',padding:32,color:C.textMuted}}>No logistics records found</td></tr>}
                {fl(logistics,['containerNo','billOfLading','consigneeName','shippingCompany','status']).map((l,i)=>(
                  <tr key={l.id}>
                    <td style={td(i)}>{i+1}</td>
                    <td style={td(i)}>{formatDate(l.transitApplicationDate)||'—'}</td>
                    <td style={{...td(i),fontFamily:'monospace',fontSize:11}}>{l.billOfLading||'—'}</td>
                    <td style={{...td(i),textAlign:'center'}}>{l.noOfContainers||1}</td>
                    <td style={{...td(i),fontSize:11}}>{l.containerSize||'—'}</td>
                    <td style={{...td(i),color:C.green,fontFamily:'monospace',fontWeight:700}}>{l.containerNo}</td>
                    <td style={{...td(i),maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.textMuted}}>{l.materialDescription||'—'}</td>
                    <td style={{...td(i),fontWeight:600}}>{l.consigneeName||'—'}</td>
                    <td style={td(i)}>{l.shippingCompany||'—'}</td>
                    <td style={{...td(i),color:C.textMuted}}>{l.shippingVessel||'—'}</td>
                    <td style={td(i)}>{formatDate(l.warehouseReceiptDate)||'—'}</td>
                    <td style={td(i)}>{formatDate(l.examDate)||'—'}</td>
                    <td style={{...td(i),fontWeight:600,color:l.releaseDate?C.success:C.textMuted}}>{formatDate(l.releaseDate)||'—'}</td>
                    <td style={td(i)}>
                      <div><StatusBadge status={l.status}/></div>
                      {l.remarks&&<div style={{fontSize:10,color:C.textMuted,marginTop:3}}>{l.remarks}</div>}
                    </td>
                    <td style={td(i)}>
                      <div style={{display:'flex',gap:4}}>
                        <Btn variant="ghost" sm onClick={()=>printFlopingLogisticsSheet([l])}>🖨</Btn>
                        {perms.edit&&<Btn variant="outline" sm onClick={()=>setModal({type:'log_edit',data:{...l}})}>Edit</Btn>}
                        {perms.del &&<Btn variant="danger"  sm onClick={()=>deleteItem('logistics',l.id)}>Del</Btn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ── TAB: BILL OF LADING (parent rows with serial containers) ── */}
          {tab==='bols'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:10,marginBottom:4}}>
                <KPI label="Total BoLs"      value={bols.length} accent={C.green}/>
                <KPI label="In Transit"      value={bols.filter(b=>b.status==='In Transit').length} accent={C.info}/>
                <KPI label="Under Exam"      value={bols.filter(b=>b.status==='Under Exam').length} accent={C.amber}/>
                <KPI label="Released"        value={bols.filter(b=>b.status==='Released').length} accent={C.success}/>
                <KPI label="Containers"      value={containers.length} sub="across all BoLs"/>
              </div>
              {fl(bols,['billOfLadingNo','shippingCompany','shippingVessel','portOfDischarge','status']).length===0
                ? <div style={{textAlign:'center',padding:40,color:C.textMuted,background:C.bgCard,borderRadius:10,border:'1px dashed '+C.border}}>Nothing registered yet. Click <strong>+ Add Bill of Lading</strong> above to register a shipment, then list its containers underneath — the same way your register sheet is laid out. Importing a spreadsheet from Excel Import/Export fills this in automatically.</div>
                : fl(bols,['billOfLadingNo','shippingCompany','shippingVessel','portOfDischarge','status']).map((bol, i) => {
                  const childContainers = containers.filter(c => c.bolId === bol.id);
                  // FIX (found while verifying this upgrade): LogisticsModal
                  // never actually set `bolId` on a transit record — there
                  // was no field or auto-fill for it — so this used to be
                  // an always-empty match for any logistics record created
                  // after the hardcoded seed data (l1/l2 above). Deriving
                  // it through the container's own (reliable) bolId instead
                  // fixes both new records and any that were already
                  // silently un-linked.
                  const childLogistics  = logistics.filter(l => childContainers.some(cc => belongsToContainer(l, cc)));
                  const totalCharges    = charges.filter(c => childContainers.some(cc => belongsToContainer(c,cc))).reduce((s,c)=>s+(Number(c.totalAmount)||0),0);
                  const distinctConsignees = Array.from(new Set(childContainers.map(c => c.consigneeName).filter(Boolean)));
                  const allReleased = childContainers.length > 0 && childContainers.every(c => c.status === 'Released');
                  const anyHeld = childContainers.some(c => c.status === 'Held');
                  return (
                    <div key={bol.id} style={{background:C.bgCard,border:'1px solid '+C.border,borderRadius:10,overflow:'hidden'}}>
                      <div style={{padding:'12px 16px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                        <div style={{flex:1,minWidth:200}}>
                          <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>📄 BoL: {bol.billOfLadingNo}</div>
                          <div style={{fontSize:11,color:'rgba(255,255,255,0.7)',marginTop:2}}>{bol.shippingCompany} · {bol.shippingVessel}{bol.voyageNo?' · Voyage '+bol.voyageNo:''}</div>
                        </div>
                        <div style={{fontSize:11,color:'rgba(255,255,255,0.8)'}}>POL: {bol.portOfLoading||'—'} → POD: {bol.portOfDischarge||'—'}</div>
                        <div style={{fontSize:11,color:'rgba(255,255,255,0.8)'}}>ETA: {formatDate(bol.etaDate)||'—'} · ATA: {formatDate(bol.ataDate)||'—'}</div>
                        <div style={{display:'flex',gap:4}} onClick={e=>e.stopPropagation()}>
                          {/* Print THIS shipment only — see printSingleBoL. Available to
                              everyone who can view the tab: printing reads nothing that
                              isn't already on screen, so gating it behind edit rights
                              would only stop clerks doing their job. */}
                          <Btn variant="outline" sm style={{background:'rgba(255,255,255,0.1)',borderColor:'rgba(255,255,255,0.3)',color:'#fff'}}
                            onClick={()=>printSingleBoL(bol, childContainers, charges.filter(ch => childContainers.some(cc => belongsToContainer(ch, cc))))}>🖨 Print</Btn>
                          {perms.edit&&<Btn variant="outline" sm style={{background:'rgba(255,255,255,0.1)',borderColor:'rgba(255,255,255,0.3)',color:'#fff'}} onClick={()=>setModal({type:'bol_edit',data:{...bol}})}>Edit BoL</Btn>}
                          {perms.del &&<Btn variant="danger"  sm onClick={()=>deleteItem('bols',bol.id)}>Del</Btn>}
                        </div>
                      </div>
                      <div style={{padding:'10px 16px',display:'flex',gap:18,flexWrap:'wrap',fontSize:11.5,color:C.textMid,borderBottom:'1px solid '+C.borderLight,background:C.greenPale}}>
                        <span>Containers: <strong style={{color:C.text}}>{childContainers.length}</strong></span>
                        <span>Distinct Consignees: <strong style={{color:C.text}}>{distinctConsignees.length}</strong></span>
                        <span>Total Charges: <strong style={{color:C.amber}}>₦{totalCharges.toLocaleString('en-NG')}</strong></span>
                        <span>Free Time Expiry: <strong style={{color:bol.freeTimeExpiry && new Date(bol.freeTimeExpiry) < new Date() ? C.danger : C.text}}>{formatDate(bol.freeTimeExpiry)||'—'}</strong></span>
                        <span>Status: <strong style={{color: anyHeld ? C.danger : allReleased ? C.success : C.amber}}>{bol.status||'—'}</strong></span>
                      </div>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:11.5}}>
                        <thead><tr style={{background:C.bgAlt}}>
                          {['S/N','Container No','Type','Consignee','Material','Status',''].map(h=><th key={h} style={th}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {childContainers.length === 0 && (
                            <tr><td colSpan={7} style={{textAlign:'center',padding:16,color:C.textMuted,fontStyle:'italic'}}>No containers linked to this BoL yet. Add a container with this BoL number, or edit a container to set its bolId.</td></tr>
                          )}
                          {childContainers.map((c, idx) => (
                            <tr key={c.id}>
                              <td style={td(idx)}>{idx+1}</td>
                              <td style={{...td(idx),color:C.green,fontFamily:'monospace',fontWeight:700}}>{c.containerNo}</td>
                              <td style={{...td(idx),fontSize:10.5,color:C.textMuted}}>{c.containerType}</td>
                              <td style={td(idx)}>{c.consigneeName}</td>
                              <td style={{...td(idx),color:C.textMuted,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.materialDescription}</td>
                              <td style={td(idx)}><StatusBadge status={c.status}/></td>
                              <td style={td(idx)} onClick={e=>e.stopPropagation()}>
                                {perms.edit&&<Btn variant="outline" sm onClick={()=>setModal({type:'cont_edit',data:{...c}})}>Edit</Btn>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {childLogistics.length > 0 && (
                        <div style={{padding:'8px 16px',fontSize:10.5,color:C.textMuted,background:C.bgAlt,borderTop:'1px solid '+C.borderLight}}>
                          📋 Linked Transit Records: {childLogistics.map(l => l.containerNo).join(', ')}
                        </div>
                      )}
                    </div>
                  );
                })
              }
            </div>
          )}

          {/* ── TAB: ADVANCE PAYMENTS (consignee pre-paid for containers) ── */}
          {tab==='advances'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:10}}>
                <KPI label="Total Advances"      value={advances.length} accent={C.green}/>
                <KPI label="Open"                value={advances.filter(a=>a.status==='Open').length} accent={C.info}/>
                <KPI label="Fully Utilised"      value={advances.filter(a=>a.status==='Fully Utilised').length} accent={C.success}/>
                <KPI label="Total Received"      value={'₦'+advances.reduce((s,a)=>s+(Number(a.amount)||0),0).toLocaleString('en-NG')} accent={C.amber}/>
                <KPI label="Total Outstanding"   value={'₦'+advances.reduce((s,a)=>s+(Number(a.balanceRemaining)||0),0).toLocaleString('en-NG')} alert={advances.reduce((s,a)=>s+(Number(a.balanceRemaining)||0),0)>0} accent={C.amber}/>
              </div>
              {fl(advances,['payerName','receiptNo','purpose','status']).length===0
                ? <div style={{textAlign:'center',padding:40,color:C.textMuted,background:C.bgCard,borderRadius:10,border:'1px dashed '+C.border}}>No advance payments recorded yet. Click <strong>Record Advance Payment</strong> to add one.</div>
                : (
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:900}}>
                    <thead><tr style={{background:C.tableHeaderBg||C.greenPale}}>
                      {['S/N','Date','Payer','Purpose','Receipt No','Amount','Containers Covered','Applied','Balance','Status',''].map(h=><th key={h} style={th}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {fl(advances,['payerName','receiptNo','purpose','status']).map((a, i) => (
                        <tr key={a.id}>
                          <td style={td(i)}>{i+1}</td>
                          <td style={td(i)}>{formatDate(a.paymentDate)||'—'}</td>
                          <td style={td(i)}><strong>{a.payerName}</strong>{a.payerType && <div style={{fontSize:10,color:C.textMuted}}>{a.payerType}</div>}</td>
                          <td style={td(i)}>{a.purpose||'—'}</td>
                          <td style={{...td(i),fontFamily:'monospace',fontSize:11}}>{a.receiptNo||'—'}</td>
                          <td style={{...td(i),textAlign:'right',fontWeight:700,color:C.amber}}>₦{Number(a.amount||0).toLocaleString('en-NG')}</td>
                          <td style={td(i)}>
                            <div style={{display:'flex',flexDirection:'column',gap:2}}>
                              {(a.containersCovered||[]).map((c, ci) => (
                                <span key={ci} style={{fontFamily:'monospace',fontSize:11,color:C.green}}>{c.containerNo} <span style={{color:C.textMuted,fontFamily:'inherit'}}>· ₦{Number(c.amountAllocated||0).toLocaleString('en-NG')}</span></span>
                              ))}
                              {(!a.containersCovered || a.containersCovered.length === 0) && <span style={{color:C.textMuted,fontSize:11}}>—</span>}
                            </div>
                          </td>
                          <td style={{...td(i),textAlign:'right',color:C.success}}>₦{((a.applications||[]).reduce((s,ap)=>s+(Number(ap.amount)||0),0)).toLocaleString('en-NG')}</td>
                          <td style={{...td(i),textAlign:'right',fontWeight:700,color: (a.balanceRemaining||0)>0 ? C.amber : C.success}}>₦{Number(a.balanceRemaining||0).toLocaleString('en-NG')}</td>
                          <td style={td(i)}>
                            <span style={{padding:'2px 9px',borderRadius:20,fontSize:11,fontWeight:600,color: a.status==='Fully Utilised' ? C.success : a.status==='Partially Utilised' ? C.amber : a.status==='Refunded' ? C.info : C.textMid, background: a.status==='Fully Utilised' ? 'rgba(26,122,74,.12)' : a.status==='Partially Utilised' ? 'rgba(201,122,10,.12)' : 'rgba(107,114,128,.1)'}}>
                              {a.status}
                            </span>
                          </td>
                          <td style={td(i)} onClick={e=>e.stopPropagation()}>
                            <div style={{display:'flex',gap:4}}>
                              {perms.edit&&<Btn variant="outline" sm onClick={()=>setModal({type:'adv_view',data:{...a}})}>View</Btn>}
                              {perms.edit&&<Btn variant="outline" sm onClick={()=>setModal({type:'adv_edit',data:{...a}})}>Edit</Btn>}
                              {perms.del &&<Btn variant="danger"  sm onClick={()=>deleteItem('advances',a.id)}>Del</Btn>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              }
              <div style={{padding:'10px 14px',background:'rgba(26,92,138,.08)',border:'1px solid rgba(26,92,138,.2)',borderLeft:'4px solid '+C.info,borderRadius:8,fontSize:11.5,color:C.info,lineHeight:1.6}}>
                💡 <strong>How advance payments work:</strong> When a consignee/shipping line pays us
                upfront for clearing a list of containers, we record the receipt as
                <code style={{fontFamily:'monospace',background:C.greenPale,padding:'1px 5px',borderRadius:4,marginLeft:4,marginRight:4}}>Dr Bank / Cr 2099 Advance from Customer (Terminal)</code>.
                As each container is processed, the advance is applied against it
                (<code style={{fontFamily:'monospace',background:C.greenPale,padding:'1px 5px',borderRadius:4}}>Dr 2099 / Cr 4005 Logistics Income</code>) —
                one click per container, recorded in the advance's Applications list. Auto-post
                happens via the central sync effect in Accounting.jsx.
              </div>
            </div>
          )}

          {/* ── TAB: STAND-ALONE FINANCIAL STATEMENTS (Terminal-as-entity) ── */}
          {tab==='statements'&&(
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div style={{padding:'12px 16px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',borderRadius:10,color:'#fff'}}>
                <div style={{fontSize:14,fontWeight:700}}>📈 Terminal — Stand-alone Financial Statements</div>
                <div style={{fontSize:11.5,opacity:0.75,marginTop:2}}>P&L and Balance Sheet for the Terminal entity, derived from journals with source = 'terminal' or 'terminal-advance'.</div>
              </div>
              <TerminalStatements
                journals={state?.acctData?.journals || []}
                coa={state?.acctData?.coa || []}
                C={C}
              />
            </div>
          )}

          {/* ── TAB 4: REPORTS ─────────────────────────────────────────── */}
          {tab==='reports'&&(
            <div style={{display:'flex',flexDirection:'column',gap:16}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
                {/* Outstanding payments per agent */}
                <div style={{background:C.bgCard,border:'1px solid '+C.border,borderRadius:10,padding:14}}>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:C.text}}>Outstanding Charges by Agent</div>
                  {Object.entries(charges.filter(c=>!c.postedToAccounting).reduce((acc,c)=>{const a=c.agentName||'Unknown';acc[a]=(acc[a]||0)+(Number(c.totalAmount)||0);return acc;},{})).length===0
                    ?<div style={{fontSize:12,color:C.success}}>✓ All charges posted to accounting</div>
                    :Object.entries(charges.filter(c=>!c.postedToAccounting).reduce((acc,c)=>{const a=c.agentName||'Unknown';acc[a]=(acc[a]||0)+(Number(c.totalAmount)||0);return acc;},{})).map(([agent,amt])=>(
                      <div key={agent} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'0.5px solid '+C.borderLight,fontSize:12}}>
                        <span style={{color:C.textMid}}>{agent}</span>
                        <span style={{fontWeight:700,color:C.danger}}>₦{amt.toLocaleString('en-NG')}</span>
                      </div>
                    ))
                  }
                </div>
                {/* Container status summary */}
                <div style={{background:C.bgCard,border:'1px solid '+C.border,borderRadius:10,padding:14}}>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:C.text}}>Containers by Status</div>
                  {STATUS_ALL.map(s=>{
                    const cnt=containers.filter(c=>c.status===s).length;
                    if(cnt===0)return null;
                    return <div key={s} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:'0.5px solid '+C.borderLight,fontSize:12}}>
                      <span><StatusBadge status={s}/></span><span style={{fontWeight:700}}>{cnt}</span>
                    </div>;
                  })}
                </div>
                {/* Port type breakdown */}
                <div style={{background:C.bgCard,border:'1px solid '+C.border,borderRadius:10,padding:14}}>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:C.text}}>Port Type Breakdown</div>
                  {['Sea','Air'].map(pt=>{
                    const cnt=containers.filter(c=>c.portType===pt).length;
                    return <div key={pt} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'0.5px solid '+C.borderLight,fontSize:12}}>
                      <span style={{color:C.textMid}}>{pt} Port</span><span style={{fontWeight:700}}>{cnt} container{cnt!==1?'s':''}</span>
                    </div>;
                  })}
                  {/* Live-verify QA fix (2026-08-18): Sea+Air used to be the
                      whole breakdown, so a container imported with no Port
                      Type (the exact bug just fixed in ExcelManager.jsx's
                      import path) vanished from this report with no sign
                      anything was missing — Total Containers said 578, this
                      card silently summed to 0. Surfacing the gap instead of
                      hiding it, same as every other "unspecified" bucket
                      elsewhere in the app. */}
                  {(()=>{
                    const unspecified = containers.filter(c=>c.portType!=='Sea'&&c.portType!=='Air').length;
                    return unspecified>0 && <div style={{display:'flex',justifyContent:'space-between',padding:'6px 0',fontSize:12}}>
                      <span style={{color:C.amber}}>⚠ Unspecified</span><span style={{fontWeight:700,color:C.amber}}>{unspecified} container{unspecified!==1?'s':''}</span>
                    </div>;
                  })()}
                </div>
                {/* Dwell time */}
                <div style={{background:C.bgCard,border:'1px solid '+C.border,borderRadius:10,padding:14}}>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:C.text}}>Average Dwell Time</div>
                  {(()=>{
                    // Live-verify QA fix (2026-08-18): this only ever read the
                    // logistics collection, which stayed empty for every
                    // bulk-imported register — those rows write
                    // warehouseReceiptDate/releaseDate straight onto the
                    // CONTAINER record (see the terminal_containers import
                    // branch in excelIO.js/ExcelManager.jsx and
                    // printSingleBoL above, which already reads dates off
                    // containers for exactly this reason), never a matching
                    // logistics record. Caught live: 568 of 578 production
                    // containers show status Released, yet this always said
                    // "No released containers yet" — the same dead-source
                    // pattern as the Analytics WHT fix earlier this session.
                    // Now checks each container's own dates first and falls
                    // back to a linked logistics record, so a container is
                    // never double-counted and manually-logged transit
                    // records still count.
                    const dwellSamples = containers.map(c=>{
                      const match = c.warehouseReceiptDate && c.releaseDate ? null : logistics.find(l=>belongsToContainer(l,c));
                      const wh  = c.warehouseReceiptDate || match?.warehouseReceiptDate;
                      const rel = c.releaseDate          || match?.releaseDate;
                      return (wh && rel) ? { warehouseReceiptDate: wh, releaseDate: rel } : null;
                    }).filter(Boolean);
                    if(dwellSamples.length===0)return <div style={{fontSize:12,color:C.textMuted}}>No released containers yet</div>;
                    const avg=dwellSamples.reduce((s,l)=>{
                      const d1=new Date(l.warehouseReceiptDate),d2=new Date(l.releaseDate);
                      return s+(d2-d1)/(1000*60*60*24);
                    },0)/dwellSamples.length;
                    return <div style={{fontSize:22,fontWeight:700,color:C.green}}>{Math.round(avg)} days<div style={{fontSize:12,fontWeight:400,color:C.textMuted}}>avg. warehouse receipt to release · {dwellSamples.length} container{dwellSamples.length===1?'':'s'}</div></div>;
                  })()}
                </div>
              </div>
              {/* Containers pending logistics record */}
              <div style={{background:C.bgCard,border:'1px solid '+C.border,borderRadius:10,padding:14}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:C.text}}>Containers Without a Logistics Record</div>
                {containers.filter(c=>!logistics.some(l=>belongsToContainer(l,c))).length===0
                  ?<div style={{fontSize:12,color:C.success}}>✓ All containers have a logistics/transit record</div>
                  :containers.filter(c=>!logistics.some(l=>belongsToContainer(l,c))).map((c,i)=>(
                    <div key={c.id} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'0.5px solid '+C.borderLight,fontSize:12}}>
                      <span style={{fontFamily:'monospace',color:C.green,fontWeight:700}}>{c.containerNo}</span>
                      <span style={{color:C.textMuted}}>{c.consigneeName}</span>
                      <StatusBadge status={c.status}/>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      </div>

      {modal&&(
        <Overlay onClose={()=>setModal(null)}>
          {['cont_add','cont_edit','cont_view'].includes(modal.type)&&
            <ContainerModal data={modal.data} readonly={modal.type==='cont_view'} containers={containers} bols={bols}
              consignees={consignees} shippingCompanies={shippingCompanies}
              onSave={d=>saveItem('containers',d)} onClose={()=>setModal(null)}/>}
          {['bol_add','bol_edit','bol_view'].includes(modal.type)&&
            <BoLModal data={modal.data} readonly={modal.type==='bol_view'} containers={containers}
              consignees={consignees} shippingCompanies={shippingCompanies}
              charges={charges} logistics={logistics} belongsToContainer={belongsToContainer}
              onSave={saveBoLWithContainers} onClose={()=>setModal(null)}/>}
          {['chg_add','chg_edit'].includes(modal.type)&&
            <ChargeModal data={modal.data} containers={containers}
              onSave={d=>saveItem('charges',d)} onClose={()=>setModal(null)}/>}
          {['log_add','log_edit'].includes(modal.type)&&
            <LogisticsModal data={modal.data} containers={containers}
              onSave={d=>saveItem('logistics',d)} onClose={()=>setModal(null)}/>}
          {['adv_add','adv_edit','adv_view'].includes(modal.type)&&
            <AdvanceModal data={modal.data} readonly={modal.type==='adv_view'} containers={containers}
              onSave={d=>saveItem('advances',d)} onClose={()=>setModal(null)}/>}
          {['cons_add','cons_edit'].includes(modal.type)&&
            <ConsigneeModal data={modal.data}
              onSave={d=>saveItem('consignees',d)} onClose={()=>setModal(null)}/>}
          {['sc_add','sc_edit'].includes(modal.type)&&
            <ShippingCompanyModal data={modal.data}
              onSave={d=>saveItem('shippingCompanies',d)} onClose={()=>setModal(null)}/>}
        </Overlay>
      )}
    </div>
  );
}

// ── Container Modal ─────────────────────────────────────────────────────────
function ContainerModal({data,readonly,containers,bols,consignees,shippingCompanies,onSave,onClose}) {
  const {C}=useTheme();
  const [f,setF]=useState({...data});
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const inp={padding:'7px 10px',borderRadius:7,border:'1px solid '+C.border,background:readonly?C.bgAlt:C.bgCard,color:C.text,fontSize:13,outline:'none',fontFamily:'inherit',width:'100%'};
  return (
    <div style={{background:C.bgCard,borderRadius:12,border:'1px solid '+C.border,overflow:'hidden'}}>
      <div style={{padding:'14px 20px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>📦 {readonly?'Container Details · ':''}{f.containerNo||'New Container'}</div>
        <button onClick={onClose} aria-label="Close dialog" style={{background:'rgba(255,255,255,.15)',border:'none',borderRadius:'50%',width:28,height:28,color:'#fff',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
      </div>
      <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div style={{display:'flex',flexDirection:'column',gap:4,gridColumn:'1/-1'}}><label style={{fontSize:11,fontWeight:600,color:C.textMid}}>Container No (Primary Key)</label><input style={{...inp,fontFamily:'monospace',fontWeight:700,color:C.green}} value={f.containerNo||''} onChange={set('containerNo')} placeholder="e.g. MSCU1234567" readOnly={readonly}/></div>
        <LBL t="Container Type"><select style={inp} value={f.containerType||''} onChange={set('containerType')} disabled={readonly}>{CONT_TYPES.map(t=><option key={t}>{t}</option>)}</select></LBL>
        <LBL t="Size"><select style={inp} value={f.size||''} onChange={set('size')} disabled={readonly}>{CONT_SIZES.map(s=><option key={s}>{s}</option>)}</select></LBL>
        <LBL t="Port Type (Air / Sea)"><select style={inp} value={f.portType||'Sea'} onChange={set('portType')} disabled={readonly}>{PORT_TYPES.map(p=><option key={p}>{p}</option>)}</select></LBL>
        <LBL t="No. of Containers"><input style={inp} type="number" value={f.noOfContainers||1} onChange={set('noOfContainers')} readOnly={readonly}/></LBL>
        <LBL t="Bill of Lading (link to BoL)">
          <select style={inp} value={f.bolId||''} onChange={e=>{const bolId=e.target.value;const bol=(bols||[]).find(b=>b.id===bolId);setF(p=>({...p,bolId,billOfLading:bol?.billOfLadingNo||p.billOfLading,shippingCompany:bol?.shippingCompany||p.shippingCompany,shippingVessel:bol?.shippingVessel||p.shippingVessel,portOfDischarge:bol?.portOfDischarge||p.portOfDischarge,portOfLoading:bol?.portOfLoading||p.portOfLoading}));}} disabled={readonly}>
            <option value="">— Not linked —</option>
            {(bols||[]).map(b=><option key={b.id} value={b.id}>{b.billOfLadingNo} · {b.shippingCompany}</option>)}
          </select>
        </LBL>
        <LBL t="Bill of Lading No (free-text)"><input style={{...inp,fontFamily:'monospace'}} value={f.billOfLading||''} onChange={set('billOfLading')} readOnly={readonly}/></LBL>
        <LBL t="Status"><select style={inp} value={f.status||'Arrived'} onChange={set('status')} disabled={readonly}>{STATUS_ALL.map(s=><option key={s}>{s}</option>)}</select></LBL>
        <LBL t="Shipping Company (from master)">
          <select style={inp} value={f.shippingCompanyId||''} onChange={e=>{const shippingCompanyId=e.target.value;const sc=(shippingCompanies||[]).find(x=>x.id===shippingCompanyId);setF(p=>({...p,shippingCompanyId,shippingCompany:sc?.name||p.shippingCompany}));}} disabled={readonly}>
            <option value="">— Not linked / type below —</option>
            {(shippingCompanies||[]).map(sc=><option key={sc.id} value={sc.id}>{sc.name}</option>)}
          </select>
        </LBL>
        <LBL t="Shipping Company (free-text)" ><input style={inp} value={f.shippingCompany||''} onChange={set('shippingCompany')} readOnly={readonly}/></LBL>
        <LBL t="Shipping Vessel"  ><input style={inp} value={f.shippingVessel||''} onChange={set('shippingVessel')} readOnly={readonly}/></LBL>
        <LBL t="Consignee (from master)">
          <select style={inp} value={f.consigneeId||''} onChange={e=>{const consigneeId=e.target.value;const cons=(consignees||[]).find(x=>x.id===consigneeId);setF(p=>({...p,consigneeId,consigneeName:cons?.name||p.consigneeName}));}} disabled={readonly}>
            <option value="">— Not linked / type below —</option>
            {(consignees||[]).map(cons=><option key={cons.id} value={cons.id}>{cons.name}</option>)}
          </select>
        </LBL>
        <div style={{display:'flex',flexDirection:'column',gap:4}}><label style={{fontSize:11,fontWeight:600,color:C.textMid}}>Name of Consignee (free-text)</label><input style={inp} value={f.consigneeName||''} onChange={set('consigneeName')} readOnly={readonly}/></div>
        <div style={{display:'flex',flexDirection:'column',gap:4,gridColumn:'1/-1'}}><label style={{fontSize:11,fontWeight:600,color:C.textMid}}>Material Description / Packages</label><input style={inp} value={f.materialDescription||''} onChange={set('materialDescription')} readOnly={readonly}/></div>
        {readonly&&<div style={{gridColumn:'1/-1'}}><div style={{fontSize:11,fontWeight:600,color:C.textMid,marginBottom:6}}>Status Pipeline</div><div style={{padding:'10px 0'}}><Pipeline status={f.status}/></div></div>}
      </div>
      {!readonly&&<div style={{padding:'0 20px 20px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid '+C.borderLight,paddingTop:14}}><button onClick={onClose} style={{padding:'7px 16px',borderRadius:7,background:'transparent',border:'1px solid '+C.border,color:C.textMid,fontSize:13,cursor:'pointer'}}>Cancel</button><button onClick={()=>onSave(f)} style={{padding:'7px 18px',borderRadius:7,background:C.green,border:'none',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Save Container</button></div>}
    </div>
  );
}

// ── Charge Modal (Image 1 — Slot Terminal) ──────────────────────────────────
function ChargeModal({data,containers,onSave,onClose}) {
  const {C}=useTheme();
  // FIX (schema audit B.5): resolve a stable containerId for legacy records
  // that only have containerNo, so the select below stays populated on edit
  // and new saves carry a real ID instead of a re-usable text number.
  const initial = { ...data };
  if (!initial.containerId && initial.containerNo) {
    const match = (containers||[]).find(c => c.containerNo === initial.containerNo);
    if (match) initial.containerId = match.id;
  }
  const [f,setF]=useState(initial);
  const calc=next=>{next.totalAmount=(Number(next.equipmentCharge)||0)+(Number(next.terminalCharge)||0)+(Number(next.storageCharge)||0);return next;};
  const set=k=>e=>{const v=e.target.value;setF(p=>calc({...p,[k]:v}));};
  const inp={padding:'7px 10px',borderRadius:7,border:'1px solid '+C.border,background:C.bgCard,color:C.text,fontSize:13,outline:'none',fontFamily:'inherit',width:'100%'};
  return (
    <div style={{background:C.bgCard,borderRadius:12,border:'1px solid '+C.border,overflow:'hidden'}}>
      <div style={{padding:'14px 20px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>💰 Clearing & Charge Record — Slot Terminal Sheet</div>
        <button onClick={onClose} aria-label="Close dialog" style={{background:'rgba(255,255,255,.15)',border:'none',borderRadius:'50%',width:28,height:28,color:'#fff',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
      </div>
      <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <LBL t="Container No" full>
          <select style={inp} value={f.containerId||''} onChange={e=>{const containerId=e.target.value;const cont=(containers||[]).find(c=>c.id===containerId);setF(p=>calc({...p,containerId,containerNo:cont?.containerNo||p.containerNo}));}}>
            <option value="">Select container…</option>
            {containers.map(c=><option key={c.id} value={c.id}>{c.containerNo} — {c.consigneeName}</option>)}
          </select>
        </LBL>
        <LBL t="Arrival Date"><input style={inp} type="date" value={f.arrivalDate||''} onChange={set('arrivalDate')}/></LBL>
        <LBL t="Payment Date"><input style={inp} type="date" value={f.paymentDate||''} onChange={set('paymentDate')}/></LBL>
        <LBL t="Receipt No" full><input style={{...inp,fontFamily:'monospace'}} value={f.receiptNo||''} onChange={set('receiptNo')} placeholder="e.g. RCPT-ONNE-041"/></LBL>
        <LBL t="Equipment Charges (₦)"><input style={inp} type="number" value={f.equipmentCharge||''} onChange={set('equipmentCharge')} placeholder="0"/></LBL>
        <LBL t="Terminal Charge (₦)"><input style={inp} type="number" value={f.terminalCharge||''} onChange={set('terminalCharge')} placeholder="0"/></LBL>
        <LBL t="Storage Charge (₦)"><input style={inp} type="number" value={f.storageCharge||''} onChange={set('storageCharge')} placeholder="0"/></LBL>
        <LBL t="Total Amount (₦) — auto calculated">
          <div style={{...inp,background:C.greenPale,fontWeight:700,color:C.amber,fontSize:15}}>₦{Number(f.totalAmount||0).toLocaleString('en-NG')}</div>
        </LBL>
        <LBL t="Agent Name" full><input style={inp} value={f.agentName||''} onChange={set('agentName')} placeholder="e.g. Adeola Clearing Agency Ltd"/></LBL>
        <LBL t="Posted to Accounting?">
          <select style={inp} value={f.postedToAccounting?'yes':'no'} onChange={e=>setF(p=>({...p,postedToAccounting:e.target.value==='yes',postDate:e.target.value==='yes'?new Date().toISOString().split('T')[0]:''}))}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </LBL>
        {f.postedToAccounting&&<LBL t="Post Date"><input style={inp} type="date" value={f.postDate||''} onChange={set('postDate')}/></LBL>}
      </div>
      <div style={{padding:'0 20px 20px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid '+C.borderLight,paddingTop:14}}>
        <button onClick={onClose} style={{padding:'7px 16px',borderRadius:7,background:'transparent',border:'1px solid '+C.border,color:C.textMid,fontSize:13,cursor:'pointer'}}>Cancel</button>
        <button onClick={()=>onSave(f)} style={{padding:'7px 18px',borderRadius:7,background:C.green,border:'none',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Save Charge Record</button>
      </div>
    </div>
  );
}

// ── Logistics Modal (Image 2 — Floping Logistics) ──────────────────────────
function LogisticsModal({data,containers,onSave,onClose}) {
  const {C}=useTheme();
  // FIX (schema audit B.5): same containerId backfill as ChargeModal, so
  // editing a legacy (containerNo-only) transit record still shows the
  // right container selected.
  const initial = { ...data };
  if (!initial.containerId && initial.containerNo) {
    const match = (containers||[]).find(c => c.containerNo === initial.containerNo);
    if (match) initial.containerId = match.id;
  }
  const [f,setF]=useState(initial);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const inp={padding:'7px 10px',borderRadius:7,border:'1px solid '+C.border,background:C.bgCard,color:C.text,fontSize:13,outline:'none',fontFamily:'inherit',width:'100%'};

  function autoFillFromContainer(containerId) {
    const cont=containers.find(c=>c.id===containerId);
    // Also carries over the container's bolId (not just billOfLading text)
    // so this transit record shows up under the right BoL card — see the
    // childLogistics fix in the main render for why this was missing before.
    if(cont) setF(p=>({...p,containerId:cont.id,containerNo:cont.containerNo,bolId:cont.bolId||p.bolId,billOfLading:cont.billOfLading||p.billOfLading,containerSize:cont.size||p.containerSize,materialDescription:cont.materialDescription||p.materialDescription,consigneeName:cont.consigneeName||p.consigneeName,shippingCompany:cont.shippingCompany||p.shippingCompany,shippingVessel:cont.shippingVessel||p.shippingVessel,noOfContainers:cont.noOfContainers||p.noOfContainers}));
    else setF(p=>({...p,containerId,containerNo:''}));
  }

  return (
    <div style={{background:C.bgCard,borderRadius:12,border:'1px solid '+C.border,overflow:'hidden'}}>
      <div style={{padding:'14px 20px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>🚢 Logistics & Transit Record — Floping Logistics Sheet</div>
        <button onClick={onClose} aria-label="Close dialog" style={{background:'rgba(255,255,255,.15)',border:'none',borderRadius:'50%',width:28,height:28,color:'#fff',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
      </div>
      <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <LBL t="Container No (auto-fills from registry)" full>
          <select style={inp} value={f.containerId||''} onChange={e=>autoFillFromContainer(e.target.value)}>
            <option value="">Select container…</option>
            {containers.map(c=><option key={c.id} value={c.id}>{c.containerNo} — {c.consigneeName}</option>)}
          </select>
        </LBL>
        <LBL t="Date of Transit Application"><input style={inp} type="date" value={f.transitApplicationDate||''} onChange={set('transitApplicationDate')}/></LBL>
        <LBL t="Bill of Lading No"><input style={{...inp,fontFamily:'monospace'}} value={f.billOfLading||''} onChange={set('billOfLading')}/></LBL>
        <LBL t="No. of Containers"><input style={inp} type="number" value={f.noOfContainers||1} onChange={set('noOfContainers')}/></LBL>
        <LBL t="Size of Container"><select style={inp} value={f.containerSize||''} onChange={set('containerSize')}><option value="">Select…</option>{CONT_SIZES.map(s=><option key={s}>{s}</option>)}</select></LBL>
        <LBL t="Material Description / Packages" full><input style={inp} value={f.materialDescription||''} onChange={set('materialDescription')}/></LBL>
        <LBL t="Name of Consignee" full><input style={inp} value={f.consigneeName||''} onChange={set('consigneeName')}/></LBL>
        <LBL t="Shipping Company"><input style={inp} value={f.shippingCompany||''} onChange={set('shippingCompany')}/></LBL>
        <LBL t="Shipping Vessel"><input style={inp} value={f.shippingVessel||''} onChange={set('shippingVessel')}/></LBL>
        <LBL t="Date of Receipt into W/H"><input style={inp} type="date" value={f.warehouseReceiptDate||''} onChange={set('warehouseReceiptDate')}/></LBL>
        <LBL t="Date of Exam"><input style={inp} type="date" value={f.examDate||''} onChange={set('examDate')}/></LBL>
        <LBL t="Date of Release"><input style={inp} type="date" value={f.releaseDate||''} onChange={set('releaseDate')}/></LBL>
        <LBL t="Status"><select style={inp} value={f.status||'Transit Applied'} onChange={set('status')}>{STATUS_ALL.map(s=><option key={s}>{s}</option>)}</select></LBL>
        <LBL t="Remarks" full><input style={inp} value={f.remarks||''} onChange={set('remarks')} placeholder="Any additional remarks"/></LBL>
      </div>
      <div style={{padding:'0 20px 20px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid '+C.borderLight,paddingTop:14}}>
        <button onClick={onClose} style={{padding:'7px 16px',borderRadius:7,background:'transparent',border:'1px solid '+C.border,color:C.textMid,fontSize:13,cursor:'pointer'}}>Cancel</button>
        <button onClick={()=>printFlopingLogisticsSheet([f])} style={{padding:'7px 16px',borderRadius:7,background:'transparent',border:'1px solid '+C.border,color:C.textMid,fontSize:13,cursor:'pointer'}}>🖨 Print This Record</button>
        <button onClick={()=>onSave(f)} style={{padding:'7px 18px',borderRadius:7,background:C.green,border:'none',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Save Transit Record</button>
      </div>
    </div>
  );
}

// ── Bill of Lading Modal ────────────────────────────────────────────────────
//
// Reworked 2026-07-27 on SLOT's feedback: they asked for this to behave like
// the Purchase Order form in Procurement — the BoL header identifies the
// shipment (as the PO's Description does), and its containers are added as
// editable line-item rows right here, instead of saving the BoL and then
// creating each container separately in the registry with a dropdown pointing
// back at it.
//
// IMPORTANT — this changes the FORM, not the DATA MODEL. Each row is still
// saved as a real record in db.terminal.containers with bolId set. Charges,
// Logistics, Advances and the Container Registry all reference containers by
// id, so burying them inside the BoL record would have broken every one of
// those. The registry keeps its own "+ Add Container" for containers that
// arrive without a BoL, and for editing a container's full detail.
function BoLModal({data,readonly,containers,consignees,shippingCompanies,charges,logistics,belongsToContainer,onSave,onClose}) {
  const {C}=useTheme();
  const [f,setF]=useState({...data});
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const inp={padding:'7px 10px',borderRadius:7,border:'1px solid '+C.border,background:readonly?C.bgAlt:C.bgCard,color:C.text,fontSize:13,outline:'none',fontFamily:'inherit',width:'100%'};
  const cellInp={...inp,padding:'5px 7px',fontSize:12};

  // FIX (schema audit B.4): matching is on the bolId FK only — never the
  // free-text billOfLading string, which could disagree with the main tab.
  const blankRow=()=>({id:generateId(),containerNo:'',size:'40ft',containerType:'40ft DV',consigneeId:'',consigneeName:'',materialDescription:'',status:'Arrived',_new:true});
  const [rows,setRows]=useState(()=>{
    const existing=containers.filter(c=>c.bolId===data.id).map(c=>({
      id:c.id, containerNo:c.containerNo||'', size:c.size||'40ft', containerType:c.containerType||'40ft DV',
      consigneeId:c.consigneeId||'', consigneeName:c.consigneeName||'',
      materialDescription:c.materialDescription||'', status:c.status||'Arrived', _new:false,
    }));
    return existing.length?existing:(readonly?[]:[blankRow()]);
  });

  const setRow=(i,k,v)=>setRows(p=>p.map((r,j)=>j===i?{...r,[k]:v}:r));
  const addRow=()=>setRows(p=>[...p,blankRow()]);

  // Per SLOT's decision: refuse to remove a row whose container already has
  // money or movement recorded against it. Silently deleting those would
  // orphan posted accounting entries; unlinking would look like a delete
  // that didn't happen. Say what's blocking it and let them clear it first.
  function removeRow(i){
    const r=rows[i];
    if(!r._new){
      const cont={id:r.id,containerNo:r.containerNo};
      const nCh=(charges||[]).filter(c=>belongsToContainer(c,cont)).length;
      const nLg=(logistics||[]).filter(l=>belongsToContainer(l,cont)).length;
      if(nCh||nLg){
        const parts=[];
        if(nCh)parts.push(nCh+' charge'+(nCh===1?'':'s'));
        if(nLg)parts.push(nLg+' logistics record'+(nLg===1?'':'s'));
        showToast('Container '+(r.containerNo||'(unnamed)')+' has '+parts.join(' and ')+' against it — remove those first.','error');
        return;
      }
    }
    setRows(p=>p.filter((_,j)=>j!==i));
  }

  const filledRows=rows.filter(r=>(r.containerNo||'').trim());
  const declared=Number(f.totalContainers)||0;
  const mismatch=declared>0&&filledRows.length>0&&declared!==filledRows.length;

  function handleSave(){
    if(!(f.billOfLadingNo||'').trim()){showToast('Bill of Lading No is required','error');return;}
    const dupe=filledRows.map(r=>r.containerNo.trim().toUpperCase())
      .find((no,i,arr)=>arr.indexOf(no)!==i);
    if(dupe){showToast('Container '+dupe+' is listed twice on this Bill of Lading','error');return;}
    onSave(f,rows);
  }

  return (
    <div style={{background:C.bgCard,borderRadius:12,border:'1px solid '+C.border,overflow:'hidden'}}>
      <div style={{padding:'14px 20px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>📄 {readonly?'Bill of Lading · ':''}{f.billOfLadingNo||'New Bill of Lading'}</div>
        <button onClick={onClose} aria-label="Close dialog" style={{background:'rgba(255,255,255,.15)',border:'none',borderRadius:'50%',width:28,height:28,color:'#fff',fontSize:16,cursor:'pointer'}}>✕</button>
      </div>
      <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <LBL t="Bill of Lading No *" full>
          <input style={{...inp,fontFamily:'monospace',fontWeight:700,color:C.green}} value={f.billOfLadingNo||''} onChange={set('billOfLadingNo')} placeholder="e.g. MSCUB123456" readOnly={readonly}/>
        </LBL>
        <LBL t="Shipping Company (from master)">
          <select style={inp} value={f.shippingCompanyId||''} onChange={e=>{const shippingCompanyId=e.target.value;const sc=(shippingCompanies||[]).find(x=>x.id===shippingCompanyId);setF(p=>({...p,shippingCompanyId,shippingCompany:sc?.name||p.shippingCompany}));}} disabled={readonly}>
            <option value="">— Not linked / type below —</option>
            {(shippingCompanies||[]).map(sc=><option key={sc.id} value={sc.id}>{sc.name}</option>)}
          </select>
        </LBL>
        <LBL t="Shipping Company (free-text)"><input style={inp} value={f.shippingCompany||''} onChange={set('shippingCompany')} readOnly={readonly}/></LBL>
        <LBL t="Shipping Vessel"><input style={inp} value={f.shippingVessel||''} onChange={set('shippingVessel')} readOnly={readonly}/></LBL>
        <LBL t="Voyage No"><input style={inp} value={f.voyageNo||''} onChange={set('voyageNo')} readOnly={readonly}/></LBL>
        <LBL t="Port of Loading"><input style={inp} value={f.portOfLoading||''} onChange={set('portOfLoading')} readOnly={readonly}/></LBL>
        <LBL t="Port of Discharge"><input style={inp} value={f.portOfDischarge||''} onChange={set('portOfDischarge')} readOnly={readonly}/></LBL>
        <LBL t="ETA Date"><input style={inp} type="date" value={f.etaDate||''} onChange={set('etaDate')} readOnly={readonly}/></LBL>
        <LBL t="ATA Date"><input style={inp} type="date" value={f.ataDate||''} onChange={set('ataDate')} readOnly={readonly}/></LBL>
        <LBL t="Total Containers (declared on BoL)"><input style={inp} type="number" value={f.totalContainers||1} onChange={set('totalContainers')} readOnly={readonly}/></LBL>
        <LBL t="Free Time Expiry"><input style={inp} type="date" value={f.freeTimeExpiry||''} onChange={set('freeTimeExpiry')} readOnly={readonly}/></LBL>
        <LBL t="Status"><select style={inp} value={f.status||'In Transit'} onChange={set('status')} disabled={readonly}>
          {['In Transit','Arrived','Under Exam','Released','Held','Completed'].map(s=><option key={s}>{s}</option>)}
        </select></LBL>
      </div>

      {/* ── Containers as line items (the PO pattern SLOT asked for) ───────── */}
      <div style={{padding:'0 20px 4px'}}>
        <div style={{fontSize:11,fontWeight:600,color:C.textMid,textTransform:'uppercase',letterSpacing:'0.4px',margin:'4px 0 10px',paddingBottom:6,borderBottom:'2px solid '+C.greenPale}}>
          Containers on this Bill of Lading
        </div>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:640}}>
            <thead><tr style={{background:C.greenPale}}>
              {['#','Container No','Type','Size','Consignee','Material Description','Status',readonly?'':'Del'].filter(Boolean).map(h=>(
                <th key={h} style={{padding:'7px 6px',textAlign:'left',fontSize:10.5,fontWeight:700,color:C.textMid,textTransform:'uppercase',letterSpacing:'0.4px',whiteSpace:'nowrap'}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.length===0&&(
                <tr><td colSpan={readonly?7:8} style={{padding:'18px 8px',textAlign:'center',color:C.textMuted}}>No containers recorded on this Bill of Lading</td></tr>
              )}
              {rows.map((r,i)=>(
                <tr key={r.id} style={{background:i%2===1?C.greenPale2:'transparent'}}>
                  <td style={{padding:'4px 6px',color:C.textMuted}}>{i+1}</td>
                  <td style={{padding:'4px 6px'}}>
                    {readonly?<span style={{fontFamily:'monospace',fontWeight:600}}>{r.containerNo}</span>
                      :<input style={{...cellInp,fontFamily:'monospace',minWidth:130}} value={r.containerNo} onChange={e=>setRow(i,'containerNo',e.target.value)} placeholder="e.g. MSCU1234567"/>}
                  </td>
                  <td style={{padding:'4px 6px'}}>
                    {readonly?r.containerType
                      :<select style={{...cellInp,minWidth:110}} value={r.containerType} onChange={e=>setRow(i,'containerType',e.target.value)}>{CONT_TYPES.map(t=><option key={t}>{t}</option>)}</select>}
                  </td>
                  <td style={{padding:'4px 6px'}}>
                    {readonly?r.size
                      :<select style={{...cellInp,width:80}} value={r.size} onChange={e=>setRow(i,'size',e.target.value)}>{CONT_SIZES.map(s=><option key={s}>{s}</option>)}</select>}
                  </td>
                  <td style={{padding:'4px 6px'}}>
                    {readonly?r.consigneeName
                      :<select style={{...cellInp,minWidth:130}} value={r.consigneeId||''} onChange={e=>{const id=e.target.value;const cons=(consignees||[]).find(x=>x.id===id);setRows(p=>p.map((x,j)=>j===i?{...x,consigneeId:id,consigneeName:cons?.name||x.consigneeName}:x));}}>
                          <option value="">— select —</option>
                          {(consignees||[]).map(cons=><option key={cons.id} value={cons.id}>{cons.name}</option>)}
                        </select>}
                  </td>
                  <td style={{padding:'4px 6px'}}>
                    {readonly?r.materialDescription
                      :<input style={{...cellInp,minWidth:150}} value={r.materialDescription} onChange={e=>setRow(i,'materialDescription',e.target.value)} placeholder="Contents"/>}
                  </td>
                  <td style={{padding:'4px 6px'}}>
                    {readonly?r.status
                      :<select style={{...cellInp,minWidth:120}} value={r.status} onChange={e=>setRow(i,'status',e.target.value)}>{STATUS_ALL.map(s=><option key={s}>{s}</option>)}</select>}
                  </td>
                  {!readonly&&<td style={{padding:'4px 6px'}}>
                    <button onClick={()=>removeRow(i)} title="Remove this container from the Bill of Lading" style={{background:C.danger,color:'#fff',border:'none',borderRadius:5,padding:'2px 8px',cursor:'pointer',fontSize:12}}>✕</button>
                  </td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{background:C.greenPale}}>
                <td colSpan={readonly?6:7} style={{padding:'7px 6px',textAlign:'right',fontWeight:700,color:C.textMid}}>Containers entered</td>
                <td style={{padding:'7px 6px',fontWeight:700,color:C.green}}>{filledRows.length}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {mismatch&&(
          <div style={{marginTop:8,padding:'7px 11px',borderRadius:7,background:C.amberPale||'rgba(201,122,10,.12)',border:'1px solid '+C.amber+'55',fontSize:11.5,color:C.amber}}>
            This BoL declares {declared} container{declared===1?'':'s'} but {filledRows.length} {filledRows.length===1?'is':'are'} entered above. Saving is still allowed — the count is just a heads-up that the list may be incomplete.
          </div>
        )}
        {!readonly&&(
          <button onClick={addRow} style={{marginTop:10,padding:'6px 14px',borderRadius:7,background:'transparent',border:'1px solid '+C.green,color:C.green,fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Add Container</button>
        )}
      </div>

      {!readonly&&<div style={{padding:'0 20px 20px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid '+C.borderLight,paddingTop:14,marginTop:16}}>
        <button onClick={onClose} style={{padding:'7px 16px',borderRadius:7,background:'transparent',border:'1px solid '+C.border,color:C.textMid,fontSize:13,cursor:'pointer'}}>Cancel</button>
        <button onClick={handleSave} style={{padding:'7px 18px',borderRadius:7,background:C.green,border:'none',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Save BoL &amp; Containers</button>
      </div>}
    </div>
  );
}

// ── Advance Payment Modal ────────────────────────────────────────────────────
function AdvanceModal({data,readonly,containers,onSave,onClose}) {
  const {C}=useTheme();
  const [f,setF]=useState({
    ...data,
    containersCovered: data.containersCovered || [],
    applications:      data.applications || [],
  });
  const [newContainerId, setNewContainerId] = useState('');
  const [newAllocation,  setNewAllocation]  = useState('');
  const [newAppContainerId, setNewAppContainerId] = useState('');
  const [newAppAmount,    setNewAppAmount]   = useState('');

  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const inp={padding:'7px 10px',borderRadius:7,border:'1px solid '+C.border,background:readonly?C.bgAlt:C.bgCard,color:C.text,fontSize:13,outline:'none',fontFamily:'inherit',width:'100%'};

  // Live recompute balanceRemaining
  const totalApplied = (f.applications||[]).reduce((s,a)=>s+(Number(a.amount)||0),0);
  const balanceRemaining = Math.max(0, (Number(f.amount)||0) - totalApplied);
  const status = balanceRemaining === 0 ? 'Fully Utilised' : totalApplied > 0 ? 'Partially Utilised' : 'Open';

  function addContainerCovered() {
    if (!newContainerId || !newAllocation) return;
    if ((f.containersCovered||[]).some(c => (c.containerId||c.containerNo) === newContainerId)) {
      showToast('Container already added', 'error'); return;
    }
    // FIX (schema audit B.5): store containerId (stable) alongside
    // containerNo (cached display/legacy fallback) instead of containerNo
    // alone, so a reused container number can't cross-associate advances
    // between shipments.
    const cont = containers.find(c => c.id === newContainerId);
    setF(p => ({ ...p, containersCovered: [...(p.containersCovered||[]), { containerId: newContainerId, containerNo: cont?.containerNo||'', amountAllocated: Number(newAllocation)||0 }] }));
    setNewContainerId(''); setNewAllocation('');
  }
  function removeContainerCovered(idx) {
    setF(p => ({ ...p, containersCovered: (p.containersCovered||[]).filter((_,i)=>i!==idx) }));
  }
  function addApplication() {
    if (!newAppContainerId || !newAppAmount) return;
    const amt = Number(newAppAmount);
    if (amt > balanceRemaining) { showToast(`Cannot apply more than outstanding balance (₦${balanceRemaining.toLocaleString('en-NG')})`, 'error'); return; }
    const covered = (f.containersCovered||[]).find(c => (c.containerId||c.containerNo) === newAppContainerId);
    setF(p => ({ ...p, applications: [...(p.applications||[]), { containerId: newAppContainerId, containerNo: covered?.containerNo||'', amount: amt, date: new Date().toISOString().split('T')[0], by: 'system' }] }));
    setNewAppContainerId(''); setNewAppAmount('');
  }
  function removeApplication(idx) {
    setF(p => ({ ...p, applications: (p.applications||[]).filter((_,i)=>i!==idx) }));
  }
  function handleSave() {
    if (!f.payerName) { showToast('Payer name is required', 'error'); return; }
    if (!f.amount || Number(f.amount) <= 0) { showToast('Amount is required', 'error'); return; }
    onSave({ ...f, balanceRemaining, status });
  }

  return (
    <div style={{background:C.bgCard,borderRadius:12,border:'1px solid '+C.border,overflow:'hidden',maxWidth:780}}>
      <div style={{padding:'14px 20px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>💵 {readonly?'Advance Payment · ':''}{f.payerName||'New Advance'} {f.receiptNo?`· ${f.receiptNo}`:''}</div>
        <button onClick={onClose} aria-label="Close dialog" style={{background:'rgba(255,255,255,.15)',border:'none',borderRadius:'50%',width:28,height:28,color:'#fff',fontSize:16,cursor:'pointer'}}>✕</button>
      </div>
      <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <LBL t="Payer Name *"><input style={inp} value={f.payerName||''} onChange={set('payerName')} placeholder="e.g. Nigerian LNG Complex" readOnly={readonly}/></LBL>
        <LBL t="Payer Type">
          <select style={inp} value={f.payerType||''} onChange={set('payerType')} disabled={readonly}>
            <option value="">—</option>
            <option>Consignee</option><option>Shipping Line</option><option>Clearing Agent</option><option>Importer</option><option>Other</option>
          </select>
        </LBL>
        <LBL t="Payment Date *"><input style={inp} type="date" value={f.paymentDate||''} onChange={set('paymentDate')} readOnly={readonly}/></LBL>
        <LBL t="Amount (₦) *"><input style={inp} type="number" value={f.amount||''} onChange={set('amount')} placeholder="0" readOnly={readonly}/></LBL>
        <LBL t="Receipt No"><input style={{...inp,fontFamily:'monospace'}} value={f.receiptNo||''} onChange={set('receiptNo')} placeholder="e.g. ADV-2026-001" readOnly={readonly}/></LBL>
        <LBL t="Purpose">
          <select style={inp} value={f.purpose||''} onChange={set('purpose')} disabled={readonly}>
            <option value="">—</option>
            <option>Clearing</option><option>Forwarding</option><option>Demurrage</option><option>Storage</option><option>Other</option>
          </select>
        </LBL>
        <LBL t="Bank Account">
          <select style={inp} value={f.bankCode||''} onChange={e=>setF(p=>({...p,bankCode:e.target.value,bankName:''}))} disabled={readonly}>
            <option value="">—</option>
            <option value="3003">Access Bank (Naira A/C 0002238013)</option>
            <option value="3005">Zenith Bank (A/C 1011010033)</option>
            <option value="3007">First Bank (A/C 2008176695)</option>
            <option value="3011">UBA Bank (A/C 1015363537)</option>
          </select>
        </LBL>
        <LBL t="Link to BoL (optional)">
          <select style={inp} value={f.linkToBillOfLadingId||''} onChange={set('linkToBillOfLadingId')} disabled={readonly}>
            <option value="">—</option>
            {(containers || []).map(c => c.billOfLading).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).map(bol => <option key={bol} value={bol}>{bol}</option>)}
          </select>
        </LBL>
        <LBL t="Notes" full><input style={inp} value={f.notes||''} onChange={set('notes')} readOnly={readonly}/></LBL>
      </div>

      {/* Containers covered — the key feature SLOT asked for */}
      <div style={{padding:'0 20px 12px'}}>
        <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:6}}>📦 Containers Covered by this Advance</div>
        <div style={{fontSize:10.5,color:C.textMuted,marginBottom:8}}>List the specific containers this advance payment is intended to clear, and how much of the advance is allocated to each.</div>
        {(f.containersCovered||[]).length > 0 && (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginBottom:8}}>
            <thead><tr style={{background:C.greenPale}}>
              {['Container No','Consignee','Allocated','% of Advance',''].map(h=><th key={h} style={{padding:'6px 8px',textAlign:'left',fontSize:10,fontWeight:700,color:C.textMid,textTransform:'uppercase'}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {(f.containersCovered||[]).map((c, i) => {
                const cont = containers.find(x => c.containerId ? x.id === c.containerId : x.containerNo === c.containerNo);
                const pct = f.amount > 0 ? Math.round((c.amountAllocated / f.amount) * 100) : 0;
                return (
                  <tr key={i}>
                    <td style={{padding:'5px 8px',fontFamily:'monospace',color:C.green,fontWeight:700}}>{c.containerNo}</td>
                    <td style={{padding:'5px 8px',color:C.textMid}}>{cont?.consigneeName||'—'}</td>
                    <td style={{padding:'5px 8px',textAlign:'right',fontWeight:600,color:C.amber}}>₦{Number(c.amountAllocated||0).toLocaleString('en-NG')}</td>
                    <td style={{padding:'5px 8px',color:C.textMuted}}>{pct}%</td>
                    <td style={{padding:'5px 8px',textAlign:'right'}}>{!readonly&&<button onClick={()=>removeContainerCovered(i)} style={{background:'transparent',border:'none',color:C.danger,cursor:'pointer',fontSize:14}}>✕</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!readonly && (
          <div style={{display:'flex',gap:6,alignItems:'end'}}>
            <div style={{flex:1}}>
              <div style={{fontSize:10,fontWeight:600,color:C.textMid,marginBottom:3}}>Container No</div>
              <select style={inp} value={newContainerId} onChange={e=>setNewContainerId(e.target.value)}>
                <option value="">— Select container —</option>
                {containers.map(c => <option key={c.id} value={c.id}>{c.containerNo} — {c.consigneeName}</option>)}
              </select>
            </div>
            <div style={{width:180}}>
              <div style={{fontSize:10,fontWeight:600,color:C.textMid,marginBottom:3}}>Allocation (₦)</div>
              <input style={inp} type="number" value={newAllocation} onChange={e=>setNewAllocation(e.target.value)} placeholder="0"/>
            </div>
            <button onClick={addContainerCovered} style={{padding:'7px 14px',borderRadius:7,background:C.green,border:'none',color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>+ Add</button>
          </div>
        )}
      </div>

      {/* Applications — money applied against the advance as containers clear */}
      {!readonly && (f.applications||[]).length > 0 && (
        <div style={{padding:'0 20px 12px'}}>
          <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:6}}>✓ Applications (money applied against this advance as containers clear)</div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginBottom:8}}>
            <thead><tr style={{background:C.greenPale}}>
              {['Container No','Date','Amount',''].map(h=><th key={h} style={{padding:'6px 8px',textAlign:'left',fontSize:10,fontWeight:700,color:C.textMid,textTransform:'uppercase'}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {(f.applications||[]).map((a, i) => (
                <tr key={i}>
                  <td style={{padding:'5px 8px',fontFamily:'monospace',color:C.green,fontWeight:700}}>{a.containerNo}</td>
                  <td style={{padding:'5px 8px',color:C.textMid}}>{a.date}</td>
                  <td style={{padding:'5px 8px',textAlign:'right',fontWeight:600,color:C.success}}>₦{Number(a.amount||0).toLocaleString('en-NG')}</td>
                  <td style={{padding:'5px 8px',textAlign:'right'}}><button onClick={()=>removeApplication(i)} style={{background:'transparent',border:'none',color:C.danger,cursor:'pointer',fontSize:14}}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readonly && (
        <div style={{padding:'0 20px 12px'}}>
          <div style={{fontSize:10,fontWeight:600,color:C.textMid,marginBottom:3}}>Apply Advance Against Container</div>
          <div style={{display:'flex',gap:6,alignItems:'end'}}>
            <div style={{flex:1}}>
              <select style={inp} value={newAppContainerId} onChange={e=>setNewAppContainerId(e.target.value)}>
                <option value="">— Container to apply against —</option>
                {(f.containersCovered||[]).map((c, i) => <option key={i} value={c.containerId||c.containerNo}>{c.containerNo}</option>)}
              </select>
            </div>
            <div style={{width:180}}>
              <input style={inp} type="number" value={newAppAmount} onChange={e=>setNewAppAmount(e.target.value)} placeholder={`Max ₦${balanceRemaining.toLocaleString('en-NG')}`}/>
            </div>
            <button onClick={addApplication} style={{padding:'7px 14px',borderRadius:7,background:C.amber,border:'none',color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>Apply</button>
          </div>
        </div>
      )}

      <div style={{padding:'0 20px 16px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
        <div style={{padding:'10px 14px',background:C.greenPale,borderRadius:8,borderLeft:'4px solid '+C.amber}}>
          <div style={{fontSize:10,color:C.textMuted,fontWeight:600,textTransform:'uppercase'}}>Total Advance</div>
          <div style={{fontSize:16,fontWeight:700,color:C.amber}}>₦{Number(f.amount||0).toLocaleString('en-NG')}</div>
        </div>
        <div style={{padding:'10px 14px',background:C.greenPale,borderRadius:8,borderLeft:'4px solid '+C.success}}>
          <div style={{fontSize:10,color:C.textMuted,fontWeight:600,textTransform:'uppercase'}}>Applied</div>
          <div style={{fontSize:16,fontWeight:700,color:C.success}}>₦{totalApplied.toLocaleString('en-NG')}</div>
        </div>
        <div style={{padding:'10px 14px',background:C.bgAlt,borderRadius:8,borderLeft:'4px solid '+(balanceRemaining>0?C.amber:C.success)}}>
          <div style={{fontSize:10,color:C.textMuted,fontWeight:600,textTransform:'uppercase'}}>Balance / Status</div>
          <div style={{fontSize:16,fontWeight:700,color:balanceRemaining>0?C.amber:C.success}}>₦{balanceRemaining.toLocaleString('en-NG')}</div>
          <div style={{fontSize:10,color:C.textMuted,marginTop:2}}>Status: <strong style={{color:C.text}}>{status}</strong></div>
        </div>
      </div>

      <div style={{padding:'0 20px 20px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid '+C.borderLight,paddingTop:14}}>
        <button onClick={onClose} style={{padding:'7px 16px',borderRadius:7,background:'transparent',border:'1px solid '+C.border,color:C.textMid,fontSize:13,cursor:'pointer'}}>Cancel</button>
        {!readonly&&<button onClick={handleSave} style={{padding:'7px 18px',borderRadius:7,background:C.green,border:'none',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Save Advance</button>}
      </div>
    </div>
  );
}

// ── Consignee Modal (master data — closes gap B.2 in the schema audit) ─────
function ConsigneeModal({data,onSave,onClose}) {
  const {C}=useTheme();
  const [f,setF]=useState({...data});
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const inp={padding:'7px 10px',borderRadius:7,border:'1px solid '+C.border,background:C.bgCard,color:C.text,fontSize:13,outline:'none',fontFamily:'inherit',width:'100%'};
  function handleSave() {
    if (!f.name || !f.name.trim()) { showToast('Consignee name is required', 'error'); return; }
    onSave(f);
  }
  return (
    <div style={{background:C.bgCard,borderRadius:12,border:'1px solid '+C.border,overflow:'hidden'}}>
      <div style={{padding:'14px 20px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>📋 {f.name||'New Consignee'}</div>
        <button onClick={onClose} aria-label="Close dialog" style={{background:'rgba(255,255,255,.15)',border:'none',borderRadius:'50%',width:28,height:28,color:'#fff',fontSize:16,cursor:'pointer'}}>✕</button>
      </div>
      <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <LBL t="Name *" full><input style={inp} value={f.name||''} onChange={set('name')} placeholder="e.g. Nigerian LNG Complex"/></LBL>
        <LBL t="Address" full><input style={inp} value={f.address||''} onChange={set('address')}/></LBL>
        <LBL t="Phone"><input style={inp} value={f.phone||''} onChange={set('phone')}/></LBL>
        <LBL t="Email"><input style={inp} type="email" value={f.email||''} onChange={set('email')}/></LBL>
      </div>
      <div style={{padding:'0 20px 20px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid '+C.borderLight,paddingTop:14}}>
        <button onClick={onClose} style={{padding:'7px 16px',borderRadius:7,background:'transparent',border:'1px solid '+C.border,color:C.textMid,fontSize:13,cursor:'pointer'}}>Cancel</button>
        <button onClick={handleSave} style={{padding:'7px 18px',borderRadius:7,background:C.green,border:'none',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Save Consignee</button>
      </div>
    </div>
  );
}

// ── Shipping Company Modal (master data — closes gap B.3) ──────────────────
function ShippingCompanyModal({data,onSave,onClose}) {
  const {C}=useTheme();
  const [f,setF]=useState({...data});
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const inp={padding:'7px 10px',borderRadius:7,border:'1px solid '+C.border,background:C.bgCard,color:C.text,fontSize:13,outline:'none',fontFamily:'inherit',width:'100%'};
  function handleSave() {
    if (!f.name || !f.name.trim()) { showToast('Shipping company name is required', 'error'); return; }
    onSave(f);
  }
  return (
    <div style={{background:C.bgCard,borderRadius:12,border:'1px solid '+C.border,overflow:'hidden'}}>
      <div style={{padding:'14px 20px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>🚢 {f.name||'New Shipping Company'}</div>
        <button onClick={onClose} aria-label="Close dialog" style={{background:'rgba(255,255,255,.15)',border:'none',borderRadius:'50%',width:28,height:28,color:'#fff',fontSize:16,cursor:'pointer'}}>✕</button>
      </div>
      <div style={{padding:20}}>
        <div style={{display:'flex',flexDirection:'column',gap:4}}><label style={{fontSize:11,fontWeight:600,color:C.textMid}}>Name *</label><input style={inp} value={f.name||''} onChange={set('name')} placeholder="e.g. MSC Mediterranean Shipping"/></div>
      </div>
      <div style={{padding:'0 20px 20px',display:'flex',gap:8,justifyContent:'flex-end',borderTop:'1px solid '+C.borderLight,paddingTop:14}}>
        <button onClick={onClose} style={{padding:'7px 16px',borderRadius:7,background:'transparent',border:'1px solid '+C.border,color:C.textMid,fontSize:13,cursor:'pointer'}}>Cancel</button>
        <button onClick={handleSave} style={{padding:'7px 18px',borderRadius:7,background:C.green,border:'none',color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Save Shipping Company</button>
      </div>
    </div>
  );
}

// ── Stand-alone Terminal Financial Statements ───────────────────────────────
//
// Builds Terminal-only P&L and Balance Sheet by filtering the global journals
// down to `source` in ('terminal', 'terminal-advance'). Same line grouping
// logic as the main Accounting module's PLTab / BalanceSheetTab, but scoped
// to the Terminal entity so SLOT can answer "what did Terminal Operations
// make this period?" without any other entity's numbers mixed in.
//
// The "entity dimension" is the `source` tag on each journal — that's the
// extension point: when SLOT asks for further entity isolation (Flopeng
// Logistics as a separate sub-ledger, etc.), the same shape adds a
// `bolId` / `entityId` filter without changing the engine.
function TerminalStatements({ journals, coa, C }) {
  const terminalJournals = (journals || []).filter(j => j.source === 'terminal' || j.source === 'terminal-advance');
  const fmt = n => '₦' + (Number(n)||0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Aggregate by account code
  const balByCode = {};
  terminalJournals.forEach(j => {
    (j.lines || []).forEach(l => {
      balByCode[l.drCode] = (balByCode[l.drCode] || 0) + (Number(l.amount) || 0);
      balByCode[l.crCode] = (balByCode[l.crCode] || 0) - (Number(l.amount) || 0);
    });
  });

  // P&L: revenue (4xxx, Cr normal) and expense (8xxx/9xxx, Dr normal)
  const revenue = coa.filter(a => /^4/.test(a.code) && (balByCode[a.code] !== undefined)).map(a => ({
    ...a, balance: -balByCode[a.code],  // Cr balances shown as positive revenue
  })).filter(a => Math.abs(a.balance) >= 1);
  const expenses = coa.filter(a => (/^8/.test(a.code) || /^9/.test(a.code)) && (balByCode[a.code] !== undefined)).map(a => ({
    ...a, balance: balByCode[a.code],
  })).filter(a => Math.abs(a.balance) >= 1);
  const totalRev = revenue.reduce((s,a) => s + Math.abs(a.balance), 0);
  const totalExp = expenses.reduce((s,a) => s + Math.abs(a.balance), 0);
  const netPnL   = totalRev - totalExp;

  // BS: assets (2xxx, 3xxx) and liabilities (5xxx, 7xxx)
  const assets = coa.filter(a => /^2/.test(a.code) || /^3/.test(a.code)).map(a => ({
    ...a, balance: a.normalBal === 'Dr' ? balByCode[a.code] || 0 : -(balByCode[a.code] || 0),
  })).filter(a => Math.abs(a.balance) >= 1);
  const liabilities = coa.filter(a => /^5/.test(a.code) || /^7/.test(a.code)).map(a => ({
    ...a, balance: a.normalBal === 'Cr' ? -(balByCode[a.code] || 0) : (balByCode[a.code] || 0),
  })).filter(a => Math.abs(a.balance) >= 1);
  const totalAssets = assets.reduce((s,a) => s + Math.abs(a.balance), 0);
  const totalLiab   = liabilities.reduce((s,a) => s + Math.abs(a.balance), 0);
  const equity      = totalAssets - totalLiab;

  const cellStyle = { padding:'5px 8px', borderBottom:'1px solid '+C.borderLight, fontSize:12 };
  const headStyle = { padding:'6px 8px', textAlign:'left', fontSize:10, fontWeight:700, color:C.textMid, textTransform:'uppercase', background:C.bgAlt, borderBottom:'1px solid '+C.border };

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
      {/* P&L */}
      <div style={{background:C.bgCard,border:'1px solid '+C.border,borderRadius:10,overflow:'hidden'}}>
        <div style={{padding:'10px 14px',background:C.greenPale,borderBottom:'1px solid '+C.border}}>
          <div style={{fontSize:13,fontWeight:700,color:C.text}}>📈 Terminal P&L (cumulative to date)</div>
          <div style={{fontSize:10,color:C.textMuted,marginTop:2}}>{terminalJournals.length} journal entries tagged source=terminal*</div>
        </div>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr><th style={headStyle}>Account</th><th style={{...headStyle,textAlign:'right'}}>Amount</th></tr></thead>
          <tbody>
            <tr><td colSpan={2} style={{...cellStyle,fontWeight:700,color:C.success,background:C.greenPale2,fontSize:11,textTransform:'uppercase'}}>Revenue</td></tr>
            {revenue.length === 0 && <tr><td colSpan={2} style={{...cellStyle,color:C.textMuted,fontStyle:'italic'}}>No revenue posted yet</td></tr>}
            {revenue.map(a => (
              <tr key={a.code}>
                <td style={{...cellStyle,paddingLeft:18}}><span style={{fontFamily:'monospace',color:C.textMuted,fontSize:11,marginRight:6}}>{a.code}</span>{a.name}</td>
                <td style={{...cellStyle,textAlign:'right',color:C.success}}>{fmt(Math.abs(a.balance))}</td>
              </tr>
            ))}
            {revenue.length > 0 && <tr style={{background:C.greenPale,fontWeight:700}}><td style={cellStyle}>Total Revenue</td><td style={{...cellStyle,textAlign:'right',color:C.success}}>{fmt(totalRev)}</td></tr>}
            <tr><td colSpan={2} style={{...cellStyle,fontWeight:700,color:C.danger,background:C.greenPale2,fontSize:11,textTransform:'uppercase'}}>Expenses (Direct Costs)</td></tr>
            {expenses.length === 0 && <tr><td colSpan={2} style={{...cellStyle,color:C.textMuted,fontStyle:'italic'}}>No expenses posted yet</td></tr>}
            {expenses.map(a => (
              <tr key={a.code}>
                <td style={{...cellStyle,paddingLeft:18}}><span style={{fontFamily:'monospace',color:C.textMuted,fontSize:11,marginRight:6}}>{a.code}</span>{a.name}</td>
                <td style={{...cellStyle,textAlign:'right',color:C.danger}}>{fmt(Math.abs(a.balance))}</td>
              </tr>
            ))}
            {expenses.length > 0 && <tr style={{background:C.greenPale,fontWeight:700}}><td style={cellStyle}>Total Expenses</td><td style={{...cellStyle,textAlign:'right',color:C.danger}}>{fmt(totalExp)}</td></tr>}
            <tr style={{background: netPnL>=0 ? C.greenPale : 'rgba(192,57,43,.1)'}}>
              <td style={{...cellStyle,fontWeight:800,fontSize:13}}>Net P&L (Terminal)</td>
              <td style={{...cellStyle,textAlign:'right',fontWeight:800,fontSize:13,color: netPnL>=0?C.success:C.danger}}>{fmt(netPnL)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {/* Balance Sheet */}
      <div style={{background:C.bgCard,border:'1px solid '+C.border,borderRadius:10,overflow:'hidden'}}>
        <div style={{padding:'10px 14px',background:C.greenPale,borderBottom:'1px solid '+C.border}}>
          <div style={{fontSize:13,fontWeight:700,color:C.text}}>🏛️ Terminal Balance Sheet (cumulative to date)</div>
          <div style={{fontSize:10,color:C.textMuted,marginTop:2}}>Filtered to Terminal entity only</div>
        </div>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr><th style={headStyle}>Account</th><th style={{...headStyle,textAlign:'right'}}>Balance</th></tr></thead>
          <tbody>
            <tr><td colSpan={2} style={{...cellStyle,fontWeight:700,color:C.success,background:C.greenPale2,fontSize:11,textTransform:'uppercase'}}>Assets</td></tr>
            {assets.length === 0 && <tr><td colSpan={2} style={{...cellStyle,color:C.textMuted,fontStyle:'italic'}}>No Terminal asset movements yet</td></tr>}
            {assets.map(a => (
              <tr key={a.code}>
                <td style={{...cellStyle,paddingLeft:18}}><span style={{fontFamily:'monospace',color:C.textMuted,fontSize:11,marginRight:6}}>{a.code}</span>{a.name}</td>
                <td style={{...cellStyle,textAlign:'right',color: a.balance>=0?C.text:C.danger}}>{fmt(a.balance)}</td>
              </tr>
            ))}
            {assets.length > 0 && <tr style={{background:C.greenPale,fontWeight:700}}><td style={cellStyle}>Total Assets</td><td style={{...cellStyle,textAlign:'right'}}>{fmt(totalAssets)}</td></tr>}
            <tr><td colSpan={2} style={{...cellStyle,fontWeight:700,color:C.danger,background:C.greenPale2,fontSize:11,textTransform:'uppercase'}}>Liabilities</td></tr>
            {liabilities.length === 0 && <tr><td colSpan={2} style={{...cellStyle,color:C.textMuted,fontStyle:'italic'}}>No Terminal liability movements yet</td></tr>}
            {liabilities.map(a => (
              <tr key={a.code}>
                <td style={{...cellStyle,paddingLeft:18}}><span style={{fontFamily:'monospace',color:C.textMuted,fontSize:11,marginRight:6}}>{a.code}</span>{a.name}</td>
                <td style={{...cellStyle,textAlign:'right',color: a.balance>=0?C.text:C.danger}}>{fmt(a.balance)}</td>
              </tr>
            ))}
            {liabilities.length > 0 && <tr style={{background:C.greenPale,fontWeight:700}}><td style={cellStyle}>Total Liabilities</td><td style={{...cellStyle,textAlign:'right'}}>{fmt(totalLiab)}</td></tr>}
            <tr style={{background:C.greenPale}}>
              <td style={{...cellStyle,fontWeight:800,fontSize:13}}>Equity (Assets − Liabilities)</td>
              <td style={{...cellStyle,textAlign:'right',fontWeight:800,fontSize:13,color: equity>=0?C.success:C.danger}}>{fmt(equity)}</td>
            </tr>
          </tbody>
        </table>
        <div style={{padding:'8px 14px',background:C.bgAlt,fontSize:10,color:C.textMuted,lineHeight:1.5,borderTop:'1px solid '+C.border}}>
          Equity is implied (Assets − Liabilities). For a true year-end close, run <strong>Settings → Accounting → Year-End Close</strong> to post an explicit Retained Earnings roll-up.
        </div>
      </div>
    </div>
  );
}
