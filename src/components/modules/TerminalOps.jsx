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
import { printHeader }  from '../../utils/logo';

// ── Status pipeline ────────────────────────────────────────────────────────────
const STATUS_STAGES = ['Arrived','Transit Applied','Received in W/H','Under Exam','Released'];
const STATUS_ALL    = [...STATUS_STAGES, 'Held'];

const CONT_TYPES  = ['20ft DV','40ft DV','40ft HC','20ft Reefer','40ft Reefer','45ft HC','20ft OT','40ft OT','LCL (Groupage)'];
const CONT_SIZES  = ['20ft','40ft','45ft'];
const PORT_TYPES  = ['Sea','Air'];

// ── Seed data — matches actual SLOT sheet structure ───────────────────────────
const SEED = {
  containers: [
    { id:'c1',containerNo:'MSCU1234567',containerType:'20ft DV',size:'20ft',portType:'Sea',
      shippingCompany:'MSC Mediterranean Shipping',shippingVessel:'MSC LUNA',
      consigneeName:'SLOT Engineering Nigeria Ltd',materialDescription:'Industrial Pipes & Fittings',
      billOfLading:'MSCUB123456',noOfContainers:1,status:'Released',createdAt:'2026-04-10T08:00:00Z' },
    { id:'c2',containerNo:'TRHU9876543',containerType:'40ft HC',size:'40ft',portType:'Sea',
      shippingCompany:'Hapag-Lloyd AG',shippingVessel:'HL DUBAI',
      consigneeName:'Nigerian LNG Complex',materialDescription:'Construction Equipment & Machinery',
      billOfLading:'HLCU9876543',noOfContainers:2,status:'Under Exam',createdAt:'2026-05-02T09:00:00Z' },
    { id:'c3',containerNo:'CMAU4561230',containerType:'20ft DV',size:'20ft',portType:'Sea',
      shippingCompany:'CMA CGM',shippingVessel:'CMA ELBE',
      consigneeName:'SLOT Engineering Nigeria Ltd',materialDescription:'Chemical Reagents & Lab Supplies',
      billOfLading:'CMAV456123',noOfContainers:1,status:'Held',createdAt:'2026-05-18T10:00:00Z' },
    { id:'c4',containerNo:'APMU7654321',containerType:'40ft DV',size:'40ft',portType:'Air',
      shippingCompany:'Ethiopian Airlines Cargo',shippingVessel:'ET-AXQ',
      consigneeName:'SLOT Engineering Nigeria Ltd',materialDescription:'Electronic Control Panels',
      billOfLading:'ET2026-00441',noOfContainers:1,status:'Transit Applied',createdAt:'2026-06-01T07:00:00Z' },
  ],
  charges: [
    { id:'ch1',containerNo:'MSCU1234567',arrivalDate:'2026-04-10',paymentDate:'2026-04-16',
      receiptNo:'RCPT-ONNE-041',equipmentCharge:45000,terminalCharge:120000,storageCharge:35000,
      totalAmount:200000,agentName:'Adeola Clearing Agency Ltd',postedToAccounting:true,postDate:'2026-04-17',createdAt:'2026-04-10T08:00:00Z' },
    { id:'ch2',containerNo:'TRHU9876543',arrivalDate:'2026-05-02',paymentDate:'',
      receiptNo:'',equipmentCharge:65000,terminalCharge:180000,storageCharge:95000,
      totalAmount:340000,agentName:'Prime Maritime Services Ltd',postedToAccounting:false,postDate:'',createdAt:'2026-05-02T09:00:00Z' },
    { id:'ch3',containerNo:'CMAU4561230',arrivalDate:'2026-05-18',paymentDate:'',
      receiptNo:'',equipmentCharge:45000,terminalCharge:120000,storageCharge:60000,
      totalAmount:225000,agentName:'Adeola Clearing Agency Ltd',postedToAccounting:false,postDate:'',createdAt:'2026-05-18T10:00:00Z' },
  ],
  logistics: [
    { id:'l1',containerNo:'MSCU1234567',transitApplicationDate:'2026-04-12',noOfContainers:1,
      billOfLading:'MSCUB123456',containerSize:'20ft',materialDescription:'Industrial Pipes & Fittings',
      consigneeName:'SLOT Engineering Nigeria Ltd',shippingCompany:'MSC Mediterranean Shipping',
      shippingVessel:'MSC LUNA',warehouseReceiptDate:'2026-04-13',examDate:'2026-04-15',
      releaseDate:'2026-04-17',status:'Released',remarks:'Cleared without issues',createdAt:'2026-04-12T08:00:00Z' },
    { id:'l2',containerNo:'TRHU9876543',transitApplicationDate:'2026-05-04',noOfContainers:2,
      billOfLading:'HLCU9876543',containerSize:'40ft',materialDescription:'Construction Equipment & Machinery',
      consigneeName:'Nigerian LNG Complex',shippingCompany:'Hapag-Lloyd AG',shippingVessel:'HL DUBAI',
      warehouseReceiptDate:'2026-05-06',examDate:'',releaseDate:'',
      status:'Under Exam',remarks:'NCS scanning in progress',createdAt:'2026-05-04T09:00:00Z' },
  ],
};

const TABS = [
  { key:'containers', label:'📦  Container Registry' },
  { key:'charges',    label:'💰  Clearing & Charges'  },
  { key:'logistics',  label:'🚢  Logistics & Transit'  },
  { key:'reports',    label:'📊  Reports'              },
];

// ── Print: Slot Terminal Sheet (matches Image 1) ────────────────────────────
function printSlotTerminalSheet(list, containers) {
  const getType = no => (containers.find(c=>c.containerNo===no)||{}).containerType||'—';
  const fmt = n => '₦'+Number(n||0).toLocaleString('en-NG');
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
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Slot Terminal Charges</title>
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
    <td style="padding:8px;text-align:right;font-size:12px">₦${grandTotal.toLocaleString('en-NG')}</td><td></td></tr>
    </tbody>
  </table>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px;margin-top:40px">
    <div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#6E8C74">Prepared By / Date</div>
    <div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#6E8C74">Reviewed By / Date</div>
    <div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#6E8C74">Approved By / Date</div>
  </div>
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
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
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Floping Logistics Transaction Record</title>
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
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
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
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Container Registry</title>
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
  <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
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
  return <div onClick={onClose} style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(10,35,15,0.62)',backdropFilter:'blur(3px)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'24px 16px',overflowY:'auto'}}><div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:720,marginBottom:32}}>{children}</div></div>;
}

// ── Main export ────────────────────────────────────────────────────────────────
export default function TerminalOps({ onNav }) {
  const {state,dispatch}=useApp();
  const {C}=useTheme();
  const {currentUser,db}=state;

  const termData=useMemo(()=>(db.terminal&&!Array.isArray(db.terminal))?db.terminal:SEED,[db.terminal]);
  const containers=termData.containers||[];
  const charges   =termData.charges||[];
  const logistics =termData.logistics||[];

  // Read deep-link tab from sessionStorage (set by Dashboard alert banners)
  const [tab,setTab] = useState(() => {
    const stored = sessionStorage.getItem('bizcore_nav_tab_terminal');
    if (stored) { sessionStorage.removeItem('bizcore_nav_tab_terminal'); return stored; }
    return 'containers';
  });
  const [containerFilter,setContainerFilter]=useState('');
  const [search,setSearch]=useState('');
  const [modal,setModal]  =useState(null);

  const perms={add:canDo(currentUser,'canAdd'),edit:canDo(currentUser,'canEdit'),del:canDo(currentUser,'canDelete')};

  function persist(next) {
    dispatch({type:'UPDATE_MODULE',mod:'terminal',data:next});
    saveDBLocal({...db,terminal:next},state.activity);
  }
  function deleteItem(section,id) {
    const next={...termData,[section]:termData[section].filter(x=>x.id!==id)};
    persist(next);
    logActivity(dispatch,'Deleted terminal '+section.slice(0,-1),currentUser);
    showToast('Deleted','error');
  }
  function saveItem(section,item) {
    const list=termData[section]||[];
    const isEdit=list.some(x=>x.id===item.id);
    const next={...termData,[section]:isEdit?list.map(x=>x.id===item.id?item:x):[...list,item]};
    persist(next);
    logActivity(dispatch,(isEdit?'Updated':'Added')+' terminal '+section.slice(0,-1),currentUser);
    showToast(isEdit?'Updated':'Saved');
    setModal(null);
  }
  function postToAccounting(charge) {
    const entry={id:generateId(),date:new Date().toISOString().split('T')[0],type:'Journal',reference:'TERM-'+charge.containerNo,description:'Terminal charges — '+charge.containerNo+' (Equip+Term+Storage)',debit:charge.totalAmount,credit:0,account:'Terminal Charges Payable',posted:true,createdAt:new Date().toISOString()};
    const acctEntries=[...(db.accounting||[]),entry];
    const updatedCharges=charges.map(c=>c.id===charge.id?{...c,postedToAccounting:true,postDate:entry.date}:c);
    const next={...termData,charges:updatedCharges};
    persist(next);
    dispatch({type:'UPDATE_MODULE',mod:'accounting',data:acctEntries});
    saveDBLocal({...db,terminal:next,accounting:acctEntries},state.activity);
    logActivity(dispatch,'Posted terminal charges for '+charge.containerNo+' to Accounting',currentUser);
    showToast('✓ Posted to Accounting');
  }

  const unpaid=charges.filter(c=>!c.postedToAccounting).length;
  const active=containers.filter(c=>!['Released'].includes(c.status)).length;
  const heldOnly=containerFilter?containers.filter(c=>c.status===containerFilter):null;
  const totalCharges=charges.reduce((s,c)=>s+(Number(c.totalAmount)||0),0);
  const heldCount=containers.filter(c=>c.status==='Held').length;

  const tabBtn=k=>({padding:'9px 16px',fontSize:12,background:'none',border:'none',cursor:'pointer',color:tab===k?C.green:C.textMuted,borderBottom:tab===k?'2px solid '+C.green:'2px solid transparent',fontWeight:tab===k?700:400,whiteSpace:'nowrap',marginBottom:-2});
  const th={padding:'9px 10px',textAlign:'left',fontSize:10.5,fontWeight:700,color:C.tableHeaderText||C.textMid,textTransform:'uppercase',letterSpacing:'.4px',whiteSpace:'nowrap',background:C.tableHeaderBg||C.greenPale,borderBottom:'2px solid '+C.border};
  const td=i=>({padding:'9px 10px',borderBottom:'1px solid '+C.borderLight,color:C.text,fontSize:12.5,background:i%2===1?C.greenPale2:'transparent'});
  const inpSt={flex:1,minWidth:200,padding:'7px 11px',borderRadius:7,border:'1px solid '+C.border,background:C.bgCard,color:C.text,fontSize:13,outline:'none'};

  function fl(list,fields) {
    if(!search)return list;
    const q=search.toLowerCase();
    return q?list.filter(x=>fields.some(f=>(x[f]||'').toString().toLowerCase().includes(q))):list;
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

        <div style={{display:'flex',borderBottom:'2px solid '+C.borderLight,padding:'0 20px',overflowX:'auto'}}>
          {TABS.map(t=><button key={t.key} onClick={()=>{setTab(t.key);setSearch('');setContainerFilter('');}} style={tabBtn(t.key)}>{t.label}</button>)}
        </div>

        <div style={{padding:'14px 20px',display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          {tab!=='reports'&&<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={inpSt}/>}
          {perms.add&&tab==='containers'&&<Btn onClick={()=>setModal({type:'cont_add',data:{id:generateId(),status:'Arrived',portType:'Sea',noOfContainers:1,createdAt:new Date().toISOString()}})}>+ Add Container</Btn>}
          {perms.add&&tab==='charges'   &&<Btn onClick={()=>setModal({type:'chg_add',data:{id:generateId(),postedToAccounting:false,createdAt:new Date().toISOString()}})}>+ Add Charge Record</Btn>}
          {perms.add&&tab==='logistics' &&<Btn onClick={()=>setModal({type:'log_add',data:{id:generateId(),noOfContainers:1,status:'Transit Applied',createdAt:new Date().toISOString()}})}>+ Add Transit Record</Btn>}
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

          {/* ── TAB 2: CLEARING & CHARGES (Image 1 — Slot Terminal) ───── */}
          {tab==='charges'&&(
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:1050}}>
              <thead><tr>{['S/N','Container No','Container Type','Arrival Date','Payment Date','Receipt No','Equipment Charges','Terminal Charge','Storage Charge','Total Amount','Agent Name','Posted?',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {fl(charges,['containerNo','agentName','receiptNo']).length===0&&<tr><td colSpan={13} style={{textAlign:'center',padding:32,color:C.textMuted}}>No charge records found</td></tr>}
                {fl(charges,['containerNo','agentName','receiptNo']).map((c,i)=>{
                  const cont=containers.find(x=>x.containerNo===c.containerNo)||{};
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
                          {!c.postedToAccounting&&perms.edit&&<Btn variant="amber" sm onClick={()=>postToAccounting(c)}>Post →</Btn>}
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
                </div>
                {/* Dwell time */}
                <div style={{background:C.bgCard,border:'1px solid '+C.border,borderRadius:10,padding:14}}>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:C.text}}>Average Dwell Time</div>
                  {(()=>{
                    const released=logistics.filter(l=>l.releaseDate&&l.warehouseReceiptDate);
                    if(released.length===0)return <div style={{fontSize:12,color:C.textMuted}}>No released containers yet</div>;
                    const avg=released.reduce((s,l)=>{
                      const d1=new Date(l.warehouseReceiptDate),d2=new Date(l.releaseDate);
                      return s+(d2-d1)/(1000*60*60*24);
                    },0)/released.length;
                    return <div style={{fontSize:22,fontWeight:700,color:C.green}}>{Math.round(avg)} days<div style={{fontSize:12,fontWeight:400,color:C.textMuted}}>avg. warehouse receipt to release</div></div>;
                  })()}
                </div>
              </div>
              {/* Containers pending logistics record */}
              <div style={{background:C.bgCard,border:'1px solid '+C.border,borderRadius:10,padding:14}}>
                <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:C.text}}>Containers Without a Logistics Record</div>
                {containers.filter(c=>!logistics.some(l=>l.containerNo===c.containerNo)).length===0
                  ?<div style={{fontSize:12,color:C.success}}>✓ All containers have a logistics/transit record</div>
                  :containers.filter(c=>!logistics.some(l=>l.containerNo===c.containerNo)).map((c,i)=>(
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
            <ContainerModal data={modal.data} readonly={modal.type==='cont_view'} containers={containers}
              onSave={d=>saveItem('containers',d)} onClose={()=>setModal(null)}/>}
          {['chg_add','chg_edit'].includes(modal.type)&&
            <ChargeModal data={modal.data} containers={containers}
              onSave={d=>saveItem('charges',d)} onClose={()=>setModal(null)}/>}
          {['log_add','log_edit'].includes(modal.type)&&
            <LogisticsModal data={modal.data} containers={containers}
              onSave={d=>saveItem('logistics',d)} onClose={()=>setModal(null)}/>}
        </Overlay>
      )}
    </div>
  );
}

// ── Container Modal ─────────────────────────────────────────────────────────
function ContainerModal({data,readonly,containers,onSave,onClose}) {
  const {C}=useTheme();
  const [f,setF]=useState({...data});
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const inp={padding:'7px 10px',borderRadius:7,border:'1px solid '+C.border,background:readonly?C.bgAlt:C.bgCard,color:C.text,fontSize:13,outline:'none',fontFamily:'inherit',width:'100%'};
  const LBL=({t,children})=><div style={{display:'flex',flexDirection:'column',gap:4}}><label style={{fontSize:11,fontWeight:600,color:C.textMid}}>{t}</label>{children}</div>;
  return (
    <div style={{background:C.bgCard,borderRadius:12,border:'1px solid '+C.border,overflow:'hidden'}}>
      <div style={{padding:'14px 20px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>📦 {readonly?'Container Details · ':''}{f.containerNo||'New Container'}</div>
        <button onClick={onClose} style={{background:'rgba(255,255,255,.15)',border:'none',borderRadius:'50%',width:28,height:28,color:'#fff',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
      </div>
      <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <div style={{display:'flex',flexDirection:'column',gap:4,gridColumn:'1/-1'}}><label style={{fontSize:11,fontWeight:600,color:C.textMid}}>Container No (Primary Key)</label><input style={{...inp,fontFamily:'monospace',fontWeight:700,color:C.green}} value={f.containerNo||''} onChange={set('containerNo')} placeholder="e.g. MSCU1234567" readOnly={readonly}/></div>
        <LBL t="Container Type"><select style={inp} value={f.containerType||''} onChange={set('containerType')} disabled={readonly}>{CONT_TYPES.map(t=><option key={t}>{t}</option>)}</select></LBL>
        <LBL t="Size"><select style={inp} value={f.size||''} onChange={set('size')} disabled={readonly}>{CONT_SIZES.map(s=><option key={s}>{s}</option>)}</select></LBL>
        <LBL t="Port Type (Air / Sea)"><select style={inp} value={f.portType||'Sea'} onChange={set('portType')} disabled={readonly}>{PORT_TYPES.map(p=><option key={p}>{p}</option>)}</select></LBL>
        <LBL t="No. of Containers"><input style={inp} type="number" value={f.noOfContainers||1} onChange={set('noOfContainers')} readOnly={readonly}/></LBL>
        <LBL t="Bill of Lading No"><input style={{...inp,fontFamily:'monospace'}} value={f.billOfLading||''} onChange={set('billOfLading')} readOnly={readonly}/></LBL>
        <LBL t="Status"><select style={inp} value={f.status||'Arrived'} onChange={set('status')} disabled={readonly}>{STATUS_ALL.map(s=><option key={s}>{s}</option>)}</select></LBL>
        <LBL t="Shipping Company" ><input style={inp} value={f.shippingCompany||''} onChange={set('shippingCompany')} readOnly={readonly}/></LBL>
        <LBL t="Shipping Vessel"  ><input style={inp} value={f.shippingVessel||''} onChange={set('shippingVessel')} readOnly={readonly}/></LBL>
        <div style={{display:'flex',flexDirection:'column',gap:4,gridColumn:'1/-1'}}><label style={{fontSize:11,fontWeight:600,color:C.textMid}}>Name of Consignee</label><input style={inp} value={f.consigneeName||''} onChange={set('consigneeName')} readOnly={readonly}/></div>
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
  const [f,setF]=useState({...data});
  const calc=next=>{next.totalAmount=(Number(next.equipmentCharge)||0)+(Number(next.terminalCharge)||0)+(Number(next.storageCharge)||0);return next;};
  const set=k=>e=>{const v=e.target.value;setF(p=>calc({...p,[k]:v}));};
  const inp={padding:'7px 10px',borderRadius:7,border:'1px solid '+C.border,background:C.bgCard,color:C.text,fontSize:13,outline:'none',fontFamily:'inherit',width:'100%'};
  const LBL=({t,full,children})=><div style={{display:'flex',flexDirection:'column',gap:4,gridColumn:full?'1/-1':undefined}}><label style={{fontSize:11,fontWeight:600,color:C.textMid}}>{t}</label>{children}</div>;
  return (
    <div style={{background:C.bgCard,borderRadius:12,border:'1px solid '+C.border,overflow:'hidden'}}>
      <div style={{padding:'14px 20px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>💰 Clearing & Charge Record — Slot Terminal Sheet</div>
        <button onClick={onClose} style={{background:'rgba(255,255,255,.15)',border:'none',borderRadius:'50%',width:28,height:28,color:'#fff',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
      </div>
      <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <LBL t="Container No" full>
          <select style={inp} value={f.containerNo||''} onChange={set('containerNo')}>
            <option value="">Select container…</option>
            {containers.map(c=><option key={c.id} value={c.containerNo}>{c.containerNo} — {c.consigneeName}</option>)}
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
  const [f,setF]=useState({...data});
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const inp={padding:'7px 10px',borderRadius:7,border:'1px solid '+C.border,background:C.bgCard,color:C.text,fontSize:13,outline:'none',fontFamily:'inherit',width:'100%'};
  const LBL=({t,full,children})=><div style={{display:'flex',flexDirection:'column',gap:4,gridColumn:full?'1/-1':undefined}}><label style={{fontSize:11,fontWeight:600,color:C.textMid}}>{t}</label>{children}</div>;

  function autoFillFromContainer(containerNo) {
    const cont=containers.find(c=>c.containerNo===containerNo);
    if(cont) setF(p=>({...p,containerNo,billOfLading:cont.billOfLading||p.billOfLading,containerSize:cont.size||p.containerSize,materialDescription:cont.materialDescription||p.materialDescription,consigneeName:cont.consigneeName||p.consigneeName,shippingCompany:cont.shippingCompany||p.shippingCompany,shippingVessel:cont.shippingVessel||p.shippingVessel,noOfContainers:cont.noOfContainers||p.noOfContainers}));
    else setF(p=>({...p,containerNo}));
  }

  return (
    <div style={{background:C.bgCard,borderRadius:12,border:'1px solid '+C.border,overflow:'hidden'}}>
      <div style={{padding:'14px 20px',background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>🚢 Logistics & Transit Record — Floping Logistics Sheet</div>
        <button onClick={onClose} style={{background:'rgba(255,255,255,.15)',border:'none',borderRadius:'50%',width:28,height:28,color:'#fff',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
      </div>
      <div style={{padding:20,display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
        <LBL t="Container No (auto-fills from registry)" full>
          <select style={inp} value={f.containerNo||''} onChange={e=>autoFillFromContainer(e.target.value)}>
            <option value="">Select container…</option>
            {containers.map(c=><option key={c.id} value={c.containerNo}>{c.containerNo} — {c.consigneeName}</option>)}
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
