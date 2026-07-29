// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — FLEET & MAINTENANCE MODULE v1.0
// Doc Ref: SLOT-MTC-001 Rev.02 (16/05/25)
// Forms: FMA-001 · FMA-002 · FMA-003 · FMA-004 · FMA-005 · FMA-006 · FMA-007/008 · FMA-010
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo }    from '../../utils/auth';
import { showToast, formatDate } from '../../utils/helpers'; // auto-patched
import { getDeepLinkTab } from '../../utils/helpers';
import { logActivity } from '../../utils/audit';
import { printHeader, PRINT_CSS } from '../../utils/logo';

// ── Print helpers ─────────────────────────────────────────────────────────────
function printFleetRegister(fleet) {
  const rows = fleet.map((v,i)=>`<tr style="background:${i%2?'#f3faf5':'#fff'}"><td>${v.regNo||'—'}</td><td><strong>${v.make} ${v.model}</strong></td><td>${v.year||'—'}</td><td>${v.type||'—'}</td><td>${v.assignedTo||'—'}</td><td>${v.status||'—'}</td></tr>`).join('');
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Fleet Register</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;padding:24px}table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#1A5C2A;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase}td{padding:7px 10px;border-bottom:1px solid #EAF0EB;font-size:11px}@media print{body{padding:12px}}</style></head><body>${printHeader('FLEET VEHICLE REGISTER','Total Vehicles: '+fleet.length)}<table><thead><tr><th>Reg No.</th><th>Make / Model</th><th>Year</th><th>Type</th><th>Assigned To</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

function printServiceRecord(s) {
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Service Record</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;padding:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.field{margin-bottom:10px}.lbl{font-size:9px;text-transform:uppercase;color:#6E8C74;letter-spacing:.5px;margin-bottom:2px}.val{font-size:12px;font-weight:600;color:#182A1C;border-bottom:1px solid #DDE9DE;padding-bottom:4px}.sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px;margin-top:40px}.sig-line{border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#6E8C74}@media print{body{padding:12px}}</style></head><body>${printHeader('SERVICE RECORD · '+(s.serviceNo||''), formatDate(s.date))}<div class="grid"><div><div class="field"><div class="lbl">Vehicle</div><div class="val">${s.regNo||'—'}</div></div><div class="field"><div class="lbl">Mileage (km)</div><div class="val">${s.mileage||'—'}</div></div><div class="field"><div class="lbl">Service Type</div><div class="val">${s.serviceType||'—'}</div></div></div><div><div class="field"><div class="lbl">Service Provider</div><div class="val">${s.provider||'—'}</div></div><div class="field"><div class="lbl">Cost (₦)</div><div class="val">${Number(s.cost||0).toLocaleString('en-NG')}</div></div><div class="field"><div class="lbl">Next Service (km)</div><div class="val">${s.nextServiceKm||'—'}</div></div></div></div><div class="field"><div class="lbl">Work Done / Remarks</div><div class="val" style="white-space:pre-wrap;min-height:60px">${s.workDone||'—'}</div></div><div class="sig"><div><div class="sig-line">Fleet Manager / Date</div></div><div><div class="sig-line">Driver / Date</div></div><div><div class="sig-line">Approved By / Date</div></div></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

function printBreakdownReport(b) {
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Breakdown Report</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;padding:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.field{margin-bottom:10px}.lbl{font-size:9px;text-transform:uppercase;color:#6E8C74;letter-spacing:.5px;margin-bottom:2px}.val{font-size:12px;font-weight:600;color:#182A1C;border-bottom:1px solid #DDE9DE;padding-bottom:4px}.sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px;margin-top:40px}.sig-line{border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#6E8C74}@media print{body{padding:12px}}</style></head><body>${printHeader('BREAKDOWN REPORT · '+(b.reportNo||''), formatDate(b.date))}<div class="grid"><div><div class="field"><div class="lbl">Vehicle</div><div class="val">${b.regNo||'—'}</div></div><div class="field"><div class="lbl">Driver</div><div class="val">${b.driver||'—'}</div></div><div class="field"><div class="lbl">Location of Breakdown</div><div class="val">${b.location||'—'}</div></div></div><div><div class="field"><div class="lbl">Date / Time</div><div class="val">${formatDate(b.date)} ${b.time||''}</div></div><div class="field"><div class="lbl">Estimated Repair Cost</div><div class="val">₦ ${Number(b.repairCost||0).toLocaleString('en-NG')}</div></div><div class="field"><div class="lbl">Status</div><div class="val">${b.status||'—'}</div></div></div></div><div class="field"><div class="lbl">Fault Description</div><div class="val" style="white-space:pre-wrap;min-height:60px">${b.faultDescription||'—'}</div></div><div class="field" style="margin-top:12px"><div class="lbl">Action Taken</div><div class="val" style="white-space:pre-wrap;min-height:48px">${b.actionTaken||'—'}</div></div><div class="sig"><div><div class="sig-line">Reported By / Date</div></div><div><div class="sig-line">Fleet Manager / Date</div></div><div><div class="sig-line">Approved By / Date</div></div></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

function printHandover(h) {
  const w=window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Vehicle Handover</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;padding:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.field{margin-bottom:10px}.lbl{font-size:9px;text-transform:uppercase;color:#6E8C74;letter-spacing:.5px;margin-bottom:2px}.val{font-size:12px;font-weight:600;color:#182A1C;border-bottom:1px solid #DDE9DE;padding-bottom:4px}.sig{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:48px}.sig-line{border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#6E8C74}@media print{body{padding:12px}}</style></head><body>${printHeader('VEHICLE HANDOVER FORM · '+(h.handoverNo||''), formatDate(h.date))}<div class="grid"><div><div class="field"><div class="lbl">Vehicle</div><div class="val">${h.regNo||'—'}</div></div><div class="field"><div class="lbl">Handed Over From</div><div class="val">${h.fromPerson||'—'}</div></div><div class="field"><div class="lbl">Mileage at Handover (km)</div><div class="val">${h.mileage||'—'}</div></div></div><div><div class="field"><div class="lbl">Handed Over To</div><div class="val">${h.toPerson||'—'}</div></div><div class="field"><div class="lbl">Department</div><div class="val">${h.department||'—'}</div></div><div class="field"><div class="lbl">Fuel Level</div><div class="val">${h.fuelLevel||'—'}</div></div></div></div><div class="field"><div class="lbl">Vehicle Condition / Remarks</div><div class="val" style="white-space:pre-wrap;min-height:60px">${h.condition||'—'}</div></div><div class="sig"><div><div class="sig-line">Handed Over By (Signature &amp; Date)</div></div><div><div class="sig-line">Received By (Signature &amp; Date)</div></div></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// ── Persistence ───────────────────────────────────────────────────────────────
// ── Fleet data loader: central store → old private key → SEED ────────────────
function migrateFleet(dbFleet, dataWiped) {
  const hasData = obj => obj && (
    obj.fleet?.length || obj.services?.length || obj.repairs?.length ||
    obj.breakdowns?.length || obj.requests?.length
  );
  // 1. Central store has data → use it
  if (hasData(dbFleet)) return dbFleet;
  // 1b. Deliberately wiped (Backup → Wipe All Data) → empty means empty;
  // don't fall through to the legacy key or the inline SEED below. (Falling
  // back to SEED here, even as an edge-case safety net, would defeat the
  // entire point of this branch.)
  if (dataWiped) return dbFleet || { fleet: [], services: [], maintLog: [], repairs: [], breakdowns: [], requests: [], handovers: [], facilitySchedule: [], calibration: [] };
  // 2. Old private localStorage key (pre-migration) → migrate once
  try {
    const raw = localStorage.getItem('slot_fleet');
    if (raw) {
      const old = JSON.parse(raw);
      localStorage.removeItem('slot_fleet');
      if (hasData(old)) return old;
    }
  } catch {}
  // 3. Both empty → fall back to inline SEED (correct schema for this module)
  return SEED;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().split('T')[0];
const fmt  = n  => '₦' + (Number(n)||0).toLocaleString('en-NG');
const daysUntil = d => d ? Math.round((new Date(d) - new Date()) / 86400000) : null;
const nextNo = (prefix, list, field) => {
  const nums = list.map(x => parseInt((x[field]||'0').replace(/\D/g,''),10)).filter(Boolean);
  return `${prefix}-${new Date().getFullYear()}-${String(nums.length ? Math.max(...nums)+1 : 1).padStart(4,'0')}`;
};

// ── Expiry badge ──────────────────────────────────────────────────────────────
function ExpiryBadge({ date, label }) {
  const { C } = useTheme();
  if (!date) return <span style={{ color:C.textLight, fontSize:11 }}>—</span>;
  const d = daysUntil(date);
  const color = d < 0 ? C.danger : d <= 30 ? C.danger : d <= 60 ? C.warning : C.success;
  const bg    = d < 0 ? 'rgba(192,57,43,.1)' : d <= 30 ? 'rgba(192,57,43,.1)' : d <= 60 ? 'rgba(201,122,10,.1)' : 'rgba(26,122,74,.1)';
  const text  = d < 0 ? `EXPIRED ${Math.abs(d)}d ago` : d === 0 ? 'Expires TODAY' : `${d}d left`;
  return (
    <div style={{ fontSize:10 }}>
      <div style={{ fontFamily:'monospace', color:C.text, fontSize:11, marginBottom:2 }}>{formatDate(date)}</div>
      <span style={{ padding:'1px 7px', borderRadius:20, background:bg, color, fontWeight:600, border:`1px solid ${color}30` }}>{text}</span>
    </div>
  );
}

// ── Shared mini-components ────────────────────────────────────────────────────
function STag({ status }) {
  const { C } = useTheme();
  const m = {
    'Active':['#1A7A4A','rgba(26,122,74,.12)'], 'Operational':['#1A7A4A','rgba(26,122,74,.12)'],
    'Completed':['#1A7A4A','rgba(26,122,74,.12)'], 'Fixed':['#1A7A4A','rgba(26,122,74,.12)'],
    'Certified':['#1A7A4A','rgba(26,122,74,.12)'],
    'In Maintenance':['#C97A0A','rgba(201,122,10,.12)'], 'In Progress':['#C97A0A','rgba(201,122,10,.12)'],
    'Being Attended':['#C97A0A','rgba(201,122,10,.12)'], 'Approved':['#1A5C8A','rgba(26,92,138,.12)'],
    'Reported':['#9B59B6','rgba(155,89,182,.12)'], 'Pending':['#9B59B6','rgba(155,89,182,.12)'],
    'Recovery Sent':['#C97A0A','rgba(201,122,10,.12)'],
    'Breakdown':['#C0392B','rgba(192,57,43,.12)'], 'Decommissioned':['#C0392B','rgba(192,57,43,.12)'],
    'Due':['#C97A0A','rgba(201,122,10,.12)'], 'Overdue':['#C0392B','rgba(192,57,43,.12)'],
    'Upcoming':['#1A7A4A','rgba(26,122,74,.12)'],
    'Returned':['#6B7280','rgba(107,114,128,.12)'],
  };
  const [c, bg] = m[status] || ['#6B7280','rgba(107,114,128,.12)'];
  return <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:500, color:c, background:bg, border:`1px solid ${c}30`, whiteSpace:'nowrap' }}>{status}</span>;
}

function Btn({ children, onClick, variant='primary', sm, disabled, style={} }) {
  const { C } = useTheme();
  const V = { primary:{bg:C.green,co:'#fff',b:'none'}, ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border}, danger:{bg:C.danger,co:'#fff',b:'none'}, amber:{bg:C.amber,co:'#fff',b:'none'}, outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green} }[variant]||{};
  return <button onClick={onClick} disabled={disabled} style={{ background:V.bg,color:V.co,border:V.b,borderRadius:7,padding:sm?'4px 11px':'7px 16px',fontSize:sm?11.5:13,fontWeight:500,cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.5:1,display:'inline-flex',alignItems:'center',gap:5,whiteSpace:'nowrap',...style }}>{children}</button>;
}

function KPI({ label, value, sub, accent, alert, onClick }) {
  const { C } = useTheme();
  const c = alert ? C.danger : accent || C.green;
  return (
    <div onClick={onClick} style={{ background:C.bgCard, border:'1px solid '+(alert?C.danger+'40':C.border), borderRadius:12, padding:'12px 15px', flex:1, minWidth:148, position:'relative', boxShadow:C.shadowCard, cursor:onClick?'pointer':'default', transition:'transform 0.12s, box-shadow 0.12s' }} onMouseEnter={e=>{ if(onClick){ e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,0.15)'; }}} onMouseLeave={e=>{ e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=C.shadowCard; }}>
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

function Overlay({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'100%', maxWidth:860, marginBottom:32 }}>{children}</div>
    </div>
  );
}

function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'18px 20px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}

// ── Seed data ─────────────────────────────────────────────────────────────────
// Emptied 2026-07-28 — held three fabricated vehicles with invented chassis and
// engine numbers, two services, two equipment maintenance logs, a breakdown,
// two maintenance requests carrying invented approval/certification sign-offs,
// a handover record, six facility schedule rows, and two repairs totalling
// ₦195,000 of invented parts and labour cost.
//
// Keys must stay — migrateFleet() and the useState calls below read each one by
// name. Empty arrays, never rows.
const SEED = {
  fleet: [],
  services: [],
  maintLog: [],
  repairs: [],
  breakdowns: [],
  requests: [],
  handovers: [],
  facilitySchedule: [],
};

// ══════════════════════════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════════════════════════

function FleetModal({ vehicle, onSave, onClose }) {
  const { C } = useTheme();
  const isView = !!vehicle?.id;
  const inpS = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12.5, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const TYPES = ['Pickup','SUV','Station Wagon','Bus/Coaster','Truck','Tanker','Crane','Flatbed','Ambulance','Generator','Compressor'];
  const STATUSES = ['Active','In Maintenance','Breakdown','Decommissioned'];
  const UNITS = ['Operations','HSE','Engineering','Management','Administration','Procurement','Logistics'];
  const [f, setF] = useState(vehicle || { vehicleNo:'', vehicleType:'Pickup', make:'', model:'', year:'', engineNo:'', chassisNo:'', assignedDriver:'', assignedUnit:'Operations', currentLocation:'', vehicleLicenseExpiry:'', insuranceCertExpiry:'', hackneyPermitExpiry:'', roadWorthinessExpiry:'', carrierPermitExpiry:'', currentKm:'', status:'Active' });
  const set = k => e => setF(p => ({ ...p, [k]:e.target.value }));

  return (
    <Overlay onClose={onClose}>
      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:12, borderBottom:'1px solid '+C.borderLight }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text }}>🚗 {isView ? f.vehicleNo + ' — ' + f.make : 'Register New Vehicle'}</div>
            <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>SLOT-FMA-002 · Vehicle Particulars Tracker</div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {isView && <STag status={f.status} />}
            <button onClick={onClose} aria-label="Close dialog" style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>×</button>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:14 }}>
          <FG label="Vehicle Number *"><input style={inpS} value={f.vehicleNo} onChange={set('vehicleNo')} placeholder="e.g. PH-458-AHZ" readOnly={isView} /></FG>
          <FG label="Vehicle Type"><select style={inpS} value={f.vehicleType} onChange={set('vehicleType')} disabled={isView}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></FG>
          <FG label="Make / Model"><input style={inpS} value={f.make} onChange={set('make')} placeholder="e.g. Toyota Hilux D4D" readOnly={isView} /></FG>
          <FG label="Year"><input style={inpS} value={f.year} onChange={set('year')} type="number" placeholder="e.g. 2022" readOnly={isView} /></FG>
          <FG label="Engine No."><input style={inpS} value={f.engineNo} onChange={set('engineNo')} placeholder="Engine number" readOnly={isView} /></FG>
          <FG label="Chassis No."><input style={inpS} value={f.chassisNo} onChange={set('chassisNo')} placeholder="Chassis/VIN number" readOnly={isView} /></FG>
          <FG label="Assigned Driver"><input style={inpS} value={f.assignedDriver} onChange={set('assignedDriver')} placeholder="Driver name" readOnly={isView} /></FG>
          <FG label="Assigned Unit"><select style={inpS} value={f.assignedUnit} onChange={set('assignedUnit')} disabled={isView}>{UNITS.map(u=><option key={u}>{u}</option>)}</select></FG>
          <FG label="Current Location"><input style={inpS} value={f.currentLocation} onChange={set('currentLocation')} placeholder="Location" readOnly={isView} /></FG>
          <FG label="Current Km/Hr Reading"><input style={inpS} value={f.currentKm} onChange={set('currentKm')} placeholder="e.g. 45,230" readOnly={isView} /></FG>
          <FG label="Status"><select style={inpS} value={f.status} onChange={set('status')} disabled={isView}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></FG>
        </div>

        <SecLabel label="Document Expiry Dates (SLOT-FMA-002)" />
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:14 }}>
          {[['vehicleLicenseExpiry','Vehicle License'],['insuranceCertExpiry','Insurance Certificate'],['hackneyPermitExpiry','Hackney Permit'],['roadWorthinessExpiry','Road Worthiness'],['carrierPermitExpiry','Carrier Permit']].map(([k,l]) => (
            <FG key={k} label={l}>
              {isView ? <ExpiryBadge date={f[k]} /> : <input style={inpS} type="date" value={f[k]} onChange={set(k)} />}
            </FG>
          ))}
        </div>

        {!isView && <div style={{ display:'flex', gap:8, justifyContent:'flex-end', paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => onSave(f)}>Register Vehicle</Btn>
        </div>}
      </Card>
    </Overlay>
  );
}

function ServiceModal({ rec, fleet, onSave, onClose }) {
  const { C } = useTheme();
  const inpS = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12.5, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const isView = !!rec?.id;
  const OPERATIONS = ['Oil & Filter Change','Full Service','Brake Pads Replacement','Tyre Rotation','Battery Replacement','Coolant Flush','Gearbox Service','Clutch Replacement','Air Filter Change','Wheel Alignment','Other'];
  const [f, setF] = useState(rec || { vehicleId:'', vehicleNo:'', operation:'Oil & Filter Change', serviceDate:today(), serviceKm:'', nextServiceDate:'', nextServiceKm:'', technicianName:'Alex Mbata', remark:'', approvedBy:'Ernest Ojukwu' });
  const set = k => e => {
    const next = { ...f, [k]:e.target.value };
    if (k === 'vehicleId') { const v = fleet.find(x=>x.id===e.target.value); next.vehicleNo = v?.vehicleNo||''; }
    setF(next);
  };

  return (
    <Overlay onClose={onClose}>
      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, paddingBottom:12, borderBottom:'1px solid '+C.borderLight }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text }}>🔧 {isView ? 'Service Record — '+f.vehicleNo : 'New Routine Service Record'}</div>
            <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>SLOT-FMA-001 · Routine Service Record</div>
          </div>
          <button onClick={onClose} aria-label="Close dialog" style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>×</button>
        </div>

        {!isView && <div style={{ marginBottom:14 }}>
          <FG label="Select Vehicle *">
            <select style={inpS} value={f.vehicleId} onChange={set('vehicleId')}>
              <option value="">— Select Vehicle —</option>
              {fleet.map(v => <option key={v.id} value={v.id}>{v.vehicleNo} — {v.make}</option>)}
            </select>
          </FG>
        </div>}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:14 }}>
          <FG label="Operation / Service Type">
            {isView ? <span style={{ fontSize:13, fontWeight:600, color:C.text }}>{f.operation}</span> : <select style={inpS} value={f.operation} onChange={set('operation')}>{OPERATIONS.map(o=><option key={o}>{o}</option>)}</select>}
          </FG>
          <FG label="Service Date"><input style={inpS} type="date" value={f.serviceDate} onChange={set('serviceDate')} readOnly={isView} /></FG>
          <FG label="Service km/hr Reading"><input style={inpS} value={f.serviceKm} onChange={set('serviceKm')} placeholder="e.g. 45,000" readOnly={isView} /></FG>
          <FG label="Next Service Date"><input style={inpS} type="date" value={f.nextServiceDate} onChange={set('nextServiceDate')} readOnly={isView} /></FG>
          <FG label="Next Service Due km/hr"><input style={inpS} value={f.nextServiceKm} onChange={set('nextServiceKm')} placeholder="e.g. 50,000" readOnly={isView} /></FG>
          <FG label="Technician Name"><input style={inpS} value={f.technicianName} onChange={set('technicianName')} readOnly={isView} /></FG>
          <FG label="Approved By"><input style={inpS} value={f.approvedBy} onChange={set('approvedBy')} readOnly={isView} /></FG>
          <FG label="Remark" full><input style={inpS} value={f.remark} onChange={set('remark')} placeholder="Service notes and observations" readOnly={isView} /></FG>
        </div>

        {!isView && <div style={{ display:'flex', gap:8, justifyContent:'flex-end', paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => onSave(f)}>Save Service Record</Btn>
        </div>}
      </Card>
    </Overlay>
  );
}

function RepairModal({ rec, fleet, onSave, onClose, onPostToAccounting }) {
  const { C } = useTheme();
  const inpS = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12.5, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const isView = !!rec?.id;
  const [f, setF] = useState(rec || { vehicleId:'', vehicleNo:'', vehicleType:'', date:today(), natureOfRepairs:'', feedback:'', partsUsed:'', costOfParts:'', costOfLabour:'', amount:0, mechanic:'', postedToAccounting:false });
  const set = k => e => {
    const next = { ...f, [k]:e.target.value };
    if (k==='vehicleId') { const v=fleet.find(x=>x.id===e.target.value); next.vehicleNo=v?.vehicleNo||''; next.vehicleType=v?.vehicleType||''; }
    next.amount = (Number(next.costOfParts)||0) + (Number(next.costOfLabour)||0);
    setF(next);
  };

  return (
    <Overlay onClose={onClose}>
      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, paddingBottom:12, borderBottom:'1px solid '+C.borderLight }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text }}>🔩 {isView ? 'Repair Record — '+f.vehicleNo : 'New Maintenance / Repair Record'}</div>
            <div style={{ fontSize:11, color:C.textMuted }}>SLOT-FMA-003 · Equipment/Vehicle Repairs History</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {isView && !f.postedToAccounting && (
              <Btn variant="outline" sm onClick={()=>{ onPostToAccounting(f); onClose(); }}>Post to Accounting</Btn>
            )}
            {isView && f.postedToAccounting && (
              <span style={{ fontSize:11, color:C.green, fontWeight:700 }}>✓ Posted to Accounting</span>
            )}
            <button onClick={onClose} aria-label="Close dialog" style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>×</button>
          </div>
        </div>

        {!isView && <div style={{ marginBottom:14 }}><FG label="Select Vehicle *"><select style={inpS} value={f.vehicleId} onChange={set('vehicleId')}><option value="">— Select —</option>{fleet.map(v=><option key={v.id} value={v.id}>{v.vehicleNo} — {v.make}</option>)}</select></FG></div>}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:14 }}>
          <FG label="Date of Repair"><input style={inpS} type="date" value={f.date} onChange={set('date')} readOnly={isView} /></FG>
          <FG label="Mechanic / Workshop"><input style={inpS} value={f.mechanic} onChange={set('mechanic')} placeholder="Mechanic or workshop name" readOnly={isView} /></FG>
          <FG label="Feedback"><input style={inpS} value={f.feedback} onChange={set('feedback')} placeholder="Outcome of repair" readOnly={isView} /></FG>
          <FG label="Nature of Repairs" full><input style={inpS} value={f.natureOfRepairs} onChange={set('natureOfRepairs')} placeholder="Describe repair carried out" readOnly={isView} /></FG>
          <FG label="Parts Used" full><input style={inpS} value={f.partsUsed} onChange={set('partsUsed')} placeholder="Parts name and specification" readOnly={isView} /></FG>
          <FG label="Cost of Parts (₦)"><input style={inpS} type="number" value={f.costOfParts} onChange={set('costOfParts')} placeholder="0" readOnly={isView} /></FG>
          <FG label="Cost of Labour (₦)"><input style={inpS} type="number" value={f.costOfLabour} onChange={set('costOfLabour')} placeholder="0" readOnly={isView} /></FG>
          <FG label="Total Amount (₦)">
            <div style={{ padding:'7px 10px', background:C.greenPale, border:'1px solid '+C.greenLight, borderRadius:7, fontWeight:700, color:C.green, fontSize:14 }}>{fmt(f.amount)}</div>
          </FG>
        </div>

        {!isView && <div style={{ display:'flex', gap:8, justifyContent:'flex-end', paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => onSave(f)}>Save Repair Record</Btn>
        </div>}
      </Card>
    </Overlay>
  );
}

function BreakdownModal({ rec, fleet, onSave, onClose }) {
  const { C } = useTheme();
  const inpS = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12.5, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const isView = !!rec?.id;
  const STATUSES = ['Reported','Being Attended','Recovery Sent','Fixed','Certified'];
  const [f, setF] = useState(rec || { date:today(), driverName:'', vehicleNo:'', vehicleMake:'', detailOfFault:'', status:'Reported', repairDetails:'', repairedBy:'', certifiedBy:'' });
  const set = k => e => setF(p => ({ ...p, [k]:e.target.value }));

  return (
    <Overlay onClose={onClose}>
      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, paddingBottom:12, borderBottom:'1px solid '+C.borderLight }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text }}>🚨 {isView ? 'Breakdown Report — '+f.vehicleNo : 'New Breakdown Report'}</div>
            <div style={{ fontSize:11, color:C.textMuted }}>SLOT-FMA-004 · Vehicle/Equipment Breakdown Report</div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {isView && <STag status={f.status} />}
            <button onClick={onClose} aria-label="Close dialog" style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>×</button>
          </div>
        </div>

        <SecLabel label="(A) Breakdown Report" />
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <FG label="Date"><input style={inpS} type="date" value={f.date} onChange={set('date')} readOnly={isView} /></FG>
          <FG label="Driver / Operator Name"><input style={inpS} value={f.driverName} onChange={set('driverName')} placeholder="Driver name" readOnly={isView} /></FG>
          <FG label="Vehicle / Equipment No."><input style={inpS} value={f.vehicleNo} onChange={set('vehicleNo')} placeholder="e.g. PH-458-AHZ" readOnly={isView} /></FG>
          <FG label="Vehicle / Equipment Make"><input style={inpS} value={f.vehicleMake} onChange={set('vehicleMake')} placeholder="e.g. Toyota Hilux" readOnly={isView} /></FG>
          <FG label="Detail of Fault" full><textarea style={{ ...inpS, minHeight:80, resize:'vertical' }} value={f.detailOfFault} onChange={set('detailOfFault')} placeholder="Describe the fault in detail" readOnly={isView} /></FG>
          <FG label="Status"><select style={inpS} value={f.status} onChange={set('status')} disabled={isView}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></FG>
        </div>

        <SecLabel label="(B) Repair Report" />
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <FG label="Repair Details" full><textarea style={{ ...inpS, minHeight:70, resize:'vertical' }} value={f.repairDetails} onChange={set('repairDetails')} placeholder="Details of work done" readOnly={isView} /></FG>
          <FG label="Repaired / Attended To By"><input style={inpS} value={f.repairedBy} onChange={set('repairedBy')} readOnly={isView} /></FG>
          <FG label="Certified Fit By"><input style={inpS} value={f.certifiedBy} onChange={set('certifiedBy')} readOnly={isView} /></FG>
        </div>

        {!isView && <div style={{ display:'flex', gap:8, justifyContent:'flex-end', paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" onClick={() => onSave(f)}>Submit Breakdown Report</Btn>
        </div>}
        {isView && f.status !== 'Fixed' && f.status !== 'Certified' && (
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
            <Btn variant="amber" onClick={() => onSave({ ...f, status:'Being Attended' })}>Mark: Being Attended</Btn>
            <Btn onClick={() => onSave({ ...f, status:'Fixed' })}>Mark: Fixed ✓</Btn>
          </div>
        )}
      </Card>
    </Overlay>
  );
}

function RequestModal({ rec, onSave, onClose }) {
  const { C } = useTheme();
  const inpS = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12.5, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const isView = !!rec?.id;
  const STATUSES = ['Pending','Approved','In Progress','Completed'];
  const [f, setF] = useState(rec || { type:'vehicle', requestNo:'', assetName:'', assetNo:'', location:'', faultType:'', requestedBy:'', requestDate:today(), approvedBy:'', approvalDate:'', workDone:'', attendedBy:'', workDate:'', certifiedBy:'', certDate:'', status:'Pending' });
  const set = k => e => setF(p => ({ ...p, [k]:e.target.value }));

  return (
    <Overlay onClose={onClose}>
      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, paddingBottom:12, borderBottom:'1px solid '+C.borderLight }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text }}>📋 {isView ? 'Maintenance Request — '+f.requestNo : 'New Maintenance Request'}</div>
            <div style={{ fontSize:11, color:C.textMuted }}>{f.type==='vehicle' ? 'SLOT-FMA-008 · Vehicle Maintenance Request/Report' : 'SLOT-FMA-007 · Equipment Maintenance Request/Report'}</div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            {isView && <STag status={f.status} />}
            <button onClick={onClose} aria-label="Close dialog" style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>×</button>
          </div>
        </div>

        <div style={{ display:'flex', gap:8, marginBottom:14 }}>
          {!isView && ['vehicle','equipment'].map(t => (
            <button key={t} onClick={() => setF(p=>({...p,type:t}))} style={{ padding:'6px 16px', borderRadius:7, border:'1px solid '+(f.type===t?C.green:C.border), background:f.type===t?C.green:'transparent', color:f.type===t?'#fff':C.textMid, fontSize:12, fontWeight:500, cursor:'pointer' }}>
              {t==='vehicle'?'🚗 Vehicle':'⚙️ Equipment'}
            </button>
          ))}
        </div>

        <SecLabel label="(A) Maintenance Request" />
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <FG label={f.type==='vehicle'?'Vehicle Name/Type':'Equipment Name/Type'} full><input style={inpS} value={f.assetName} onChange={set('assetName')} placeholder="Name or type" readOnly={isView} /></FG>
          <FG label={f.type==='vehicle'?'Vehicle No.':'Equipment Serial No.'}><input style={inpS} value={f.assetNo} onChange={set('assetNo')} readOnly={isView} /></FG>
          <FG label="Location"><input style={inpS} value={f.location} onChange={set('location')} readOnly={isView} /></FG>
          <FG label="Request Date"><input style={inpS} type="date" value={f.requestDate} onChange={set('requestDate')} readOnly={isView} /></FG>
          <FG label="Type of Fault Noticed" full><textarea style={{ ...inpS, minHeight:70 }} value={f.faultType} onChange={set('faultType')} placeholder="Describe the fault" readOnly={isView} /></FG>
          <FG label="Request Made By"><input style={inpS} value={f.requestedBy} onChange={set('requestedBy')} readOnly={isView} /></FG>
          <FG label="Approved By"><input style={inpS} value={f.approvedBy} onChange={set('approvedBy')} readOnly={isView} /></FG>
          <FG label="Approval Date"><input style={inpS} type="date" value={f.approvalDate} onChange={set('approvalDate')} readOnly={isView} /></FG>
        </div>

        <SecLabel label="(B) Maintenance Report" />
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <FG label="Details of Work Done" full><textarea style={{ ...inpS, minHeight:70 }} value={f.workDone} onChange={set('workDone')} placeholder="Work performed" readOnly={isView} /></FG>
          <FG label="Attended To By"><input style={inpS} value={f.attendedBy} onChange={set('attendedBy')} readOnly={isView} /></FG>
          <FG label="Date of Work Done"><input style={inpS} type="date" value={f.workDate} onChange={set('workDate')} readOnly={isView} /></FG>
          <FG label="Certified Fit By"><input style={inpS} value={f.certifiedBy} onChange={set('certifiedBy')} readOnly={isView} /></FG>
          <FG label="Certification Date"><input style={inpS} type="date" value={f.certDate} onChange={set('certDate')} readOnly={isView} /></FG>
          <FG label="Status"><select style={inpS} value={f.status} onChange={set('status')} disabled={isView}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></FG>
        </div>

        {!isView && <div style={{ display:'flex', gap:8, justifyContent:'flex-end', paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => onSave(f)}>Submit Request</Btn>
        </div>}
      </Card>
    </Overlay>
  );
}

function HandoverModal({ rec, fleet, onSave, onClose }) {
  const { C } = useTheme();
  const inpS = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12.5, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const isView = !!rec?.id;
  const [f, setF] = useState(rec || { vehicleNo:'', handoverDate:today(), receiverName:'', handedOverBy:'', condition:'No damage', damageNotes:'', hasJack:false, hasSpareTyre:false, hasTriangle:false, hasFireExtinguisher:false, hasDocuments:false, status:'Active' });
  const set = k => e => setF(p => ({ ...p, [k]:e.target.value }));
  const tog = k => () => setF(p => ({ ...p, [k]:!p[k] }));

  const CheckItem = ({ k, label }) => (
    <div onClick={!isView ? tog(k) : undefined} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:f[k]?C.greenPale:C.bgAlt, border:'1px solid '+(f[k]?C.greenLight:C.borderLight), borderRadius:8, cursor:isView?'default':'pointer' }}>
      <div style={{ width:20, height:20, borderRadius:4, background:f[k]?C.green:C.bgCard, border:'2px solid '+(f[k]?C.green:C.border), display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, color:'#fff', flexShrink:0 }}>{f[k]&&'✓'}</div>
      <span style={{ fontSize:13, fontWeight:f[k]?600:400, color:f[k]?C.green:C.text }}>{label}</span>
    </div>
  );

  return (
    <Overlay onClose={onClose}>
      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, paddingBottom:12, borderBottom:'1px solid '+C.borderLight }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text }}>🤝 {isView ? 'Vehicle Handover — '+f.vehicleNo : 'New Vehicle Handover Form'}</div>
            <div style={{ fontSize:11, color:C.textMuted }}>SLOT-FMA-005 · Vehicles Handover Form</div>
          </div>
          <button onClick={onClose} aria-label="Close dialog" style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>×</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <FG label="Vehicle No.">
            {isView ? <span style={{ fontFamily:'monospace', fontWeight:700, color:C.green }}>{f.vehicleNo}</span>
              : <select style={inpS} value={f.vehicleNo} onChange={set('vehicleNo')}><option value="">— Select —</option>{fleet.map(v=><option key={v.id}>{v.vehicleNo}</option>)}</select>}
          </FG>
          <FG label="Date of Handover"><input style={inpS} type="date" value={f.handoverDate} onChange={set('handoverDate')} readOnly={isView} /></FG>
          <FG label="Receiver Name"><input style={inpS} value={f.receiverName} onChange={set('receiverName')} placeholder="Person receiving the vehicle" readOnly={isView} /></FG>
          <FG label="Handed Over By"><input style={inpS} value={f.handedOverBy} onChange={set('handedOverBy')} placeholder="Person handing over" readOnly={isView} /></FG>
          <FG label="Condition">
            <select style={inpS} value={f.condition} onChange={set('condition')} disabled={isView}><option>No damage</option><option>Has damage</option></select>
          </FG>
          {f.condition === 'Has damage' && <FG label="Damage Notes" full><input style={inpS} value={f.damageNotes} onChange={set('damageNotes')} placeholder="Describe dents or scratches" readOnly={isView} /></FG>}
        </div>

        <SecLabel label="Documents & Accessories Checklist" />
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
          <CheckItem k="hasJack"            label="a) Jack" />
          <CheckItem k="hasSpareTyre"       label="b) Spare Tyre" />
          <CheckItem k="hasTriangle"        label="c) Triangular Reflector" />
          <CheckItem k="hasFireExtinguisher" label="d) Fire Extinguisher" />
          <CheckItem k="hasDocuments"       label="e) Complete Vehicle Particulars (License, Insurance, ECMR, Ownership)" />
        </div>

        {!isView && <div style={{ display:'flex', gap:8, justifyContent:'flex-end', paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={() => onSave(f)}>Save Handover Form</Btn>
        </div>}
      </Card>
    </Overlay>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
const TABS = [
  { key:'fleet',       label:'🚗  Fleet Registry'        },
  { key:'service',     label:'🔧  Service Records'        },
  { key:'repairs',     label:'🔩  Repair Records'         },
  { key:'breakdown',   label:'🚨  Breakdown Reports'      },
  { key:'requests',    label:'📋  Maint. Requests'        },
  { key:'handover',    label:'🤝  Vehicle Handovers'      },
  { key:'facility',    label:'🏢  Facility Schedule'      },
  { key:'calibration', label:'🎯  Calibration & Cert.'   },
];

// ── Calibration helpers ────────────────────────────────────────────────────────
const CAL_STATUS = (expiryDate) => {
  if (!expiryDate) return { label:'No Date', color:'#888', days: null };
  const today = new Date(); today.setHours(0,0,0,0);
  const exp   = new Date(expiryDate);
  const days  = Math.ceil((exp - today) / (1000*60*60*24));
  if (days < 0)   return { label:'OVERDUE',  color:'#E24B4A', days };
  if (days <= 60) return { label:'DUE SOON', color:'#C97A0A', days };
  return               { label:'CURRENT',  color:'#2E7D40', days };
};
const CAL_TYPES = ['Calibration','Certification','Inspection','Classification','Type Approval','Pressure Test'];
const CAL_AUTHORITIES = ["SON (Standards Organisation of Nigeria)","DPR (Dept. of Petroleum Resources)","NAFDAC","Lloyd's Register","Bureau Veritas","DNV GL","Class NK","COREN","NUPRC","Other"];

// ── CalibrationModal ──────────────────────────────────────────────────────────
function CalibrationModal({ rec, fleet, onSave, onClose }) {
  const { C } = useTheme();
  const today = new Date().toISOString().split('T')[0];

  // Auto-calculate expiry: issue date + 6 months
  function addSixMonths(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().split('T')[0];
  }

  const [f, setF] = useState(rec ? { ...rec } : {
    equipmentName: '', equipmentId: '', certType: 'Calibration',
    certNo: '', authority: '', issueDate: today,
    expiryDate: addSixMonths(today), notes: '',
  });

  const set = k => e => {
    const val = e.target.value;
    setF(prev => {
      const next = { ...prev, [k]: val };
      // Auto-update expiry when issue date changes
      if (k === 'issueDate' && val) next.expiryDate = addSixMonths(val);
      return next;
    });
  };

  const inp = { padding:'8px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', boxSizing:'border-box', fontFamily:'inherit' };
  const lbl = { fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:4 };

  const st  = CAL_STATUS(f.expiryDate);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }}>
      <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:14, width:'100%', maxWidth:560, maxHeight:'90vh', overflow:'auto', boxShadow:C.shadowCard }}>
        <div style={{ padding:'16px 20px', background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)', borderRadius:'14px 14px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>🎯 {rec ? 'Edit' : 'Add'} Calibration / Certification</div>
          <button onClick={onClose} aria-label="Close dialog" style={{ background:'none', border:'none', color:'#fff', fontSize:18, cursor:'pointer' }}>✕</button>
        </div>
        <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14 }}>

          {/* Equipment */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={lbl}>Equipment Name *</label>
              <input style={inp} value={f.equipmentName} onChange={set('equipmentName')} placeholder="e.g. Crane No. 3 / Pressure Vessel A" />
            </div>
            <div>
              <label style={lbl}>Equipment ID / Reg No.</label>
              <input style={inp} value={f.equipmentId||''} onChange={set('equipmentId')} placeholder="e.g. CRANE-003" />
            </div>
          </div>

          {/* Type + Authority */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={lbl}>Certificate Type *</label>
              <select style={inp} value={f.certType} onChange={set('certType')}>
                {CAL_TYPES.map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Certifying Authority</label>
              <select style={inp} value={f.authority||''} onChange={set('authority')}>
                <option value="">— Select —</option>
                {CAL_AUTHORITIES.map(a=><option key={a}>{a}</option>)}
              </select>
            </div>
          </div>

          {/* Cert No. */}
          <div>
            <label style={lbl}>Certificate / Reference Number</label>
            <input style={inp} value={f.certNo||''} onChange={set('certNo')} placeholder="e.g. SON/CAL/2026/00123" />
          </div>

          {/* Dates */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={lbl}>Issue Date *</label>
              <input type="date" style={inp} value={f.issueDate||''} onChange={set('issueDate')} />
            </div>
            <div>
              <label style={lbl}>Expiry Date * <span style={{ fontWeight:400, color:C.textMuted }}>(auto: issue + 6 months)</span></label>
              <input type="date" style={inp} value={f.expiryDate||''} onChange={set('expiryDate')} />
            </div>
          </div>

          {/* Live status preview */}
          {f.expiryDate && (
            <div style={{ padding:'10px 14px', background:st.color+'15', border:'1px solid '+st.color+'40', borderRadius:8, display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:20 }}>{st.label==='OVERDUE'?'⛔':st.label==='DUE SOON'?'⚠️':'✅'}</span>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:st.color }}>{st.label}</div>
                <div style={{ fontSize:11, color:C.textMuted }}>
                  {st.days===null ? '—' : st.days < 0 ? `Expired ${Math.abs(st.days)} day(s) ago` : `${st.days} day(s) remaining`}
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label style={lbl}>Notes / Remarks</label>
            <textarea style={{ ...inp, minHeight:70, resize:'vertical' }} value={f.notes||''} onChange={set('notes')} placeholder="e.g. Renewal in progress, surveyor booked…" />
          </div>

          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:4 }}>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn onClick={() => {
              if (!f.equipmentName?.trim()) { showToast('Equipment name is required','error'); return; }
              if (!f.issueDate || !f.expiryDate) { showToast('Issue and expiry dates are required','error'); return; }
              onSave(f);
              onClose();
            }}>
              {rec ? 'Save Changes' : 'Add Record'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FleetMaintenance({ onNav }) {
  const { state, dispatch } = useApp();
  const { C }        = useTheme();
  const { currentUser } = state;
  const perms = { add:canDo(currentUser,'canAdd'), edit:canDo(currentUser,'canEdit'), del:canDo(currentUser,'canDelete') };

  const saved = migrateFleet(state.db.fleet, state.appSettings?.dataWiped);
  const [fleet,     setFleet]    = useState(saved?.fleet     || SEED.fleet);
  const [services,  setServices] = useState(saved?.services  || SEED.services);
  const [maintLog,  setMaintLog] = useState(saved?.maintLog  || SEED.maintLog);
  const [repairs,   setRepairs]  = useState(saved?.repairs   || SEED.repairs);
  const [breakdowns,setBreakdowns]=useState(saved?.breakdowns|| SEED.breakdowns);
  const [requests,  setRequests] = useState(saved?.requests  || SEED.requests);
  const [handovers, setHandovers]= useState(saved?.handovers || SEED.handovers);
  const [facility,     setFacility]    = useState(saved?.facilitySchedule || SEED.facilitySchedule);
  const [calibration,  setCalibration] = useState(saved?.calibration || []);
  const [tab, setTab] = useState(() => getDeepLinkTab('fleet', 'fleet'));

  // Re-sync local arrays if central store (state.db.fleet) arrives after mount
  // (happens when syncCloud returns data after initial render with empty local arrays)
  useEffect(() => {
    const dbFleet = state.db.fleet;
    if (!dbFleet?.fleet?.length) return;
    if (!fleet.length)      setFleet(dbFleet.fleet);
    if (!services.length)   setServices(dbFleet.services   || []);
    if (!maintLog.length)   setMaintLog(dbFleet.maintLog   || []);
    if (!repairs.length)    setRepairs(dbFleet.repairs     || []);
    if (!breakdowns.length) setBreakdowns(dbFleet.breakdowns || []);
    if (!requests.length)   setRequests(dbFleet.requests   || []);
    if (!handovers.length)  setHandovers(dbFleet.handovers || []);
    if (!calibration.length)setCalibration(dbFleet.calibration || []);
  }, [state.db.fleet]); // eslint-disable-line react-hooks/exhaustive-deps
  const [search, setSearch] = useState('');
  const [modal,  setModal]  = useState(null);

  function persist(updates) {
    const next = { fleet, services, maintLog, repairs, breakdowns, requests, handovers, facilitySchedule:facility, calibration, ...updates };
    dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: next });
  }

  function crud(list, setFn, key, form) {
    const isEdit = !!form.id;
    const record = { ...form, id:form.id||uid(), createdAt:form.createdAt||new Date().toISOString() };
    const next = isEdit ? list.map(x=>x.id===record.id?record:x) : [...list, record];
    setFn(next); persist({ [key]:next });
    showToast(isEdit ? 'Record updated' : 'Record saved');
    setModal(null);
  }

  function postRepairToAccounting(repair) {
    // Same fix as Terminal Ops: this only sets the flag the real auto-post
    // effect in Accounting.jsx watches — it never hand-builds a journal
    // entry itself, so there's no dead-end data store to write to by mistake.
    const next = repairs.map(r => r.id===repair.id ? {...r, postedToAccounting:true} : r);
    setRepairs(next);
    persist({ repairs: next });
    logActivity(dispatch, `Posted repair cost for ${repair.vehicleNo} to Accounting`, currentUser);
    showToast('✓ Posted to Accounting');
  }

  function del(list, setFn, key, id) {
    if (!window.confirm('Delete this record?')) return;
    if (key === 'repairs') {
      // Repairs can reach the GL once posted — void instead of removing, so
      // a posted repair gets an automatic reversing entry instead of just
      // vanishing with no trace. Same pattern as AR/Petty Cash/Fixed
      // Assets/Terminal Ops charges.
      const next = list.map(x => x.id===id ? {...x, voided:true} : x);
      setFn(next); persist({ [key]:next });
      showToast('Voided','error');
      return;
    }
    const next = list.filter(x=>x.id!==id); setFn(next); persist({ [key]:next });
    showToast('Deleted','error');
  }

  // ── Computed alerts ─────────────────────────────────────────────────────
  const docExpiring = fleet.filter(v => {
    const dates = [v.vehicleLicenseExpiry,v.insuranceCertExpiry,v.hackneyPermitExpiry,v.roadWorthinessExpiry];
    return dates.some(d => d && daysUntil(d) <= 60);
  }).length;
  const openBreakdowns = breakdowns.filter(b => !['Fixed','Certified'].includes(b.status)).length;
  const pendingRequests = requests.filter(r => r.status==='Pending').length;
  const totalRepairCost = repairs.filter(r=>!r.voided).reduce((a,r)=>a+(Number(r.amount)||0),0);
  const overdueSchedule = facility.filter(f=>f.status==='Overdue').length;

  // ── Filter ──────────────────────────────────────────────────────────────
  function fl(list, fields) {
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(x=>fields.some(f=>String(x[f]||'').toLowerCase().includes(q)));
  }

  const inpS = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12.5, outline:'none', fontFamily:'inherit' };
  const th = { padding:'8px 10px', textAlign:'left', fontSize:10, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = (i) => ({ padding:'8px 10px', borderBottom:'1px solid '+C.borderLight, fontSize:12, color:C.text, background:i%2===1?C.greenPale2:'transparent' });
  const tabBtn = k => ({ padding:'9px 16px', fontSize:12, background:'none', border:'none', cursor:'pointer', color:tab===k?C.green:C.textMuted, borderBottom:tab===k?'2px solid '+C.green:'2px solid transparent', fontWeight:tab===k?700:400, whiteSpace:'nowrap', marginBottom:-2 });

  // Calibration computed values
  const calOverdue  = calibration.filter(c => CAL_STATUS(c.expiryDate).label === 'OVERDUE').length;
  const calDueSoon  = calibration.filter(c => CAL_STATUS(c.expiryDate).label === 'DUE SOON').length;
  const calAlert    = calOverdue + calDueSoon;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* KPI row */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <KPI label="Fleet Size"          value={fleet.length}         accent={C.green}   sub={fleet.filter(v=>v.status==='Active').length+' active'} onClick={() => setTab("fleet")} />
        <KPI label="Expiring Docs"       value={docExpiring}          alert={docExpiring>0} sub="within 60 days" onClick={()=>setTab("docs")} />
        <KPI label="Open Breakdowns"     value={openBreakdowns}       alert={openBreakdowns>0} sub="requiring action" onClick={() => setTab("breakdown")} />
        <KPI label="Pending Requests"    value={pendingRequests}      accent={C.amber}   sub="maintenance requests" onClick={() => setTab("requests")} />
        <KPI label="Total Repair Cost"   value={fmt(totalRepairCost)} accent={C.info}    sub={repairs.length+' repair records'} onClick={() => setTab("repairs")} />
        <KPI label="Overdue Facility"    value={overdueSchedule}      alert={overdueSchedule>0} sub="scheduled maintenance" onClick={() => setTab("facility")} />
        <KPI label="Cal/Cert Alerts"     value={calAlert}             alert={calAlert>0} sub={calOverdue+' overdue · '+calDueSoon+' due soon'} onClick={() => setTab("calibration")} />
      </div>

      {/* Main card */}
      <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, boxShadow:C.shadowCard }}>
        <div style={{ padding:'14px 20px', background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)', borderRadius:'12px 12px 0 0' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>🔧 Fleet & Maintenance Management</div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.65)', marginTop:2 }}>Doc Ref: SLOT-MTC-001 Rev.02 · Forms FMA-001 to FMA-010</div>
        </div>

        <div style={{ display:'flex', borderBottom:'2px solid '+C.borderLight, padding:'0 20px', overflowX:'auto' }}>
          {TABS.map(t=><button key={t.key} onClick={()=>{setTab(t.key);setSearch('');}} style={tabBtn(t.key)}>{t.label}</button>)}
        </div>

        <div style={{ padding:'14px 20px', display:'flex', gap:8 }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{ ...inpS, flex:1 }} />
          {perms.add && tab==='fleet'     && <Btn onClick={()=>setModal({type:'fleet_create'})}>+ Register Vehicle</Btn>}
          {perms.add && tab==='service'   && <Btn onClick={()=>setModal({type:'service_create'})}>+ Service Record</Btn>}
          {perms.add && tab==='repairs'   && <Btn onClick={()=>setModal({type:'repair_create'})}>+ Repair Record</Btn>}
          {perms.add && tab==='breakdown' && <Btn variant="danger" onClick={()=>setModal({type:'bd_create'})}>+ Breakdown Report</Btn>}
          {perms.add && tab==='requests'  && <Btn onClick={()=>setModal({type:'req_create'})}>+ New Request</Btn>}
          {perms.add && tab==='handover'  && <Btn onClick={()=>setModal({type:'ho_create'})}>+ Handover Form</Btn>}
          {perms.add && tab==='calibration' && <Btn onClick={()=>setModal({type:'cal_create'})}>+ Add Calibration / Cert</Btn>}
          {tab==='fleet' && <Btn variant="ghost" onClick={()=>printFleetRegister(fleet)}>🖨 Print Register</Btn>}
        </div>

        <div style={{ padding:'0 20px 20px', overflowX:'auto' }}>

          {/* ── FLEET REGISTRY ──────────────────────────────────────────── */}
          {tab==='fleet' && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:900 }}>
              <thead><tr>
                {['S/N','Vehicle No.','Type','Make','Assigned Driver','Unit','License Expiry','Insurance Expiry','Road Worthiness','Status',''].map(h=><th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {fl(fleet,['vehicleNo','make','assignedDriver','assignedUnit','currentLocation','status']).length===0 && <tr><td colSpan={11} style={{ textAlign:'center', padding:32, color:C.textMuted }}>No fleet records</td></tr>}
                {fl(fleet,['vehicleNo','make','assignedDriver','assignedUnit','currentLocation','status']).map((v,i)=>(
                  <tr key={v.id} onClick={()=>setModal({type:'fleet_view',vehicle:v})} style={{ cursor:'pointer' }} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale} onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.greenPale2:'transparent'}>
                    <td style={td(i)}>{i+1}</td>
                    <td style={{ ...td(i), color:C.green, fontFamily:'monospace', fontWeight:700 }}>{v.vehicleNo}</td>
                    <td style={td(i)}>{v.vehicleType}</td>
                    <td style={td(i)}>{v.make}</td>
                    <td style={td(i)}>{v.assignedDriver}</td>
                    <td style={td(i)}>{v.assignedUnit}</td>
                    <td style={td(i)}><ExpiryBadge date={v.vehicleLicenseExpiry} /></td>
                    <td style={td(i)}><ExpiryBadge date={v.insuranceCertExpiry} /></td>
                    <td style={td(i)}><ExpiryBadge date={v.roadWorthinessExpiry} /></td>
                    <td style={td(i)}><STag status={v.status} /></td>
                    <td style={td(i)} onClick={e=>e.stopPropagation()}>
                      {perms.del && <Btn variant="danger" sm onClick={()=>del(fleet,setFleet,'fleet',v.id)}>Del</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* ── SERVICE RECORDS ─────────────────────────────────────────── */}
          {tab==='service' && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:850 }}>
              <thead><tr>{['S/N','Vehicle No.','Operation','Service Date','km/hr','Next Service','Next km/hr','Technician','Approved By',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {fl(services,['vehicleNo','operation','technicianName','approvedBy']).map((s,i)=>(
                  <tr key={s.id} onClick={()=>setModal({type:'service_view',rec:s})} style={{ cursor:'pointer' }} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale} onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.greenPale2:'transparent'}>
                    <td style={td(i)}>{i+1}</td>
                    <td style={{ ...td(i), color:C.green, fontFamily:'monospace', fontWeight:700 }}>{s.vehicleNo}</td>
                    <td style={td(i)}>{s.operation}</td>
                    <td style={td(i)}>{formatDate(s.serviceDate)}</td>
                    <td style={td(i)}>{s.serviceKm}</td>
                    <td style={{ ...td(i), color:daysUntil(s.nextServiceDate)<=14?C.danger:C.text }}>{formatDate(s.nextServiceDate)}</td>
                    <td style={td(i)}>{s.nextServiceKm}</td>
                    <td style={td(i)}>{s.technicianName}</td>
                    <td style={td(i)}>{s.approvedBy}</td>
                    <td style={td(i)} onClick={e=>e.stopPropagation()}>{perms.del&&<Btn variant="danger" sm onClick={()=>del(services,setServices,'services',s.id)}>Del</Btn>}</td>
                  </tr>
                ))}
                {fl(services,['vehicleNo','operation','technicianName']).length===0&&<tr><td colSpan={10} style={{ textAlign:'center', padding:32, color:C.textMuted }}>No service records</td></tr>}
              </tbody>
            </table>
          )}

          {/* ── REPAIR RECORDS ───────────────────────────────────────────── */}
          {tab==='repairs' && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:850 }}>
              <thead><tr>{['S/N','Date','Vehicle No.','Nature of Repairs','Parts Used','Parts Cost','Labour Cost','Total (₦)','Mechanic',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {fl(repairs.filter(r=>!r.voided),['vehicleNo','natureOfRepairs','mechanic','partsUsed']).map((r,i)=>(
                  <tr key={r.id} onClick={()=>setModal({type:'repair_view',rec:r})} style={{ cursor:'pointer' }} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale} onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.greenPale2:'transparent'}>
                    <td style={td(i)}>{i+1}</td>
                    <td style={td(i)}>{formatDate(r.date)}</td>
                    <td style={{ ...td(i), color:C.green, fontFamily:'monospace', fontWeight:700 }}>{r.vehicleNo}</td>
                    <td style={{ ...td(i), maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.natureOfRepairs}</td>
                    <td style={{ ...td(i), color:C.textMuted }}>{r.partsUsed}</td>
                    <td style={td(i)}>{fmt(r.costOfParts)}</td>
                    <td style={td(i)}>{fmt(r.costOfLabour)}</td>
                    <td style={{ ...td(i), fontWeight:700, color:C.green }}>{fmt(r.amount)}</td>
                    <td style={td(i)}>{r.mechanic}</td>
                    <td style={td(i)} onClick={e=>e.stopPropagation()}>{perms.del&&<Btn variant="danger" sm onClick={()=>del(repairs,setRepairs,'repairs',r.id)}>Del</Btn>}</td>
                  </tr>
                ))}
                {fl(repairs.filter(r=>!r.voided),['vehicleNo','natureOfRepairs','mechanic']).length===0&&<tr><td colSpan={10} style={{ textAlign:'center', padding:32, color:C.textMuted }}>No repair records</td></tr>}
              </tbody>
              {repairs.length>0&&<tfoot><tr style={{ background:C.greenPale, fontWeight:700 }}>
                <td colSpan={7} style={{ ...td(0), textAlign:'right' }}>Grand Total</td>
                <td style={{ ...td(0), color:C.green, fontSize:13 }}>{fmt(totalRepairCost)}</td>
                <td colSpan={2} style={td(0)} />
              </tr></tfoot>}
            </table>
          )}

          {/* ── BREAKDOWNS ────────────────────────────────────────────────── */}
          {tab==='breakdown' && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:750 }}>
              <thead><tr>{['S/N','Date','Driver/Operator','Vehicle No.','Vehicle Make','Detail of Fault','Status',''].map(h=><th key={h} style={{ ...th, background:C.danger }}>{h}</th>)}</tr></thead>
              <tbody>
                {fl(breakdowns,['driverName','vehicleNo','vehicleMake','detailOfFault','status']).map((b,i)=>(
                  <tr key={b.id} onClick={()=>setModal({type:'bd_view',rec:b})} style={{ cursor:'pointer', background:i%2===1?'rgba(192,57,43,.04)':'transparent' }} onMouseEnter={e=>e.currentTarget.style.background='rgba(192,57,43,.08)'} onMouseLeave={e=>e.currentTarget.style.background=i%2===1?'rgba(192,57,43,.04)':'transparent'}>
                    <td style={td(i)}>{i+1}</td>
                    <td style={td(i)}>{formatDate(b.date)}</td>
                    <td style={td(i)}>{b.driverName}</td>
                    <td style={{ ...td(i), color:C.green, fontFamily:'monospace', fontWeight:700 }}>{b.vehicleNo}</td>
                    <td style={td(i)}>{b.vehicleMake}</td>
                    <td style={{ ...td(i), maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.detailOfFault}</td>
                    <td style={td(i)}><STag status={b.status} /></td>
                    <td style={td(i)} onClick={e=>e.stopPropagation()}>{perms.del&&<Btn variant="danger" sm onClick={()=>del(breakdowns,setBreakdowns,'breakdowns',b.id)}>Del</Btn>}</td>
                  </tr>
                ))}
                {fl(breakdowns,['vehicleNo','driverName','vehicleMake']).length===0&&<tr><td colSpan={8} style={{ textAlign:'center', padding:32, color:C.textMuted }}>No breakdown reports</td></tr>}
              </tbody>
            </table>
          )}

          {/* ── MAINTENANCE REQUESTS ─────────────────────────────────────── */}
          {tab==='requests' && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:750 }}>
              <thead><tr>{['S/N','Request No.','Type','Asset','Asset No.','Fault','Requested By','Date','Status',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {fl(requests,['requestNo','assetName','assetNo','faultType','requestedBy','status']).map((r,i)=>(
                  <tr key={r.id} onClick={()=>setModal({type:'req_view',rec:r})} style={{ cursor:'pointer' }} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale} onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.greenPale2:'transparent'}>
                    <td style={td(i)}>{i+1}</td>
                    <td style={{ ...td(i), color:C.green, fontFamily:'monospace', fontSize:11 }}>{r.requestNo}</td>
                    <td style={td(i)}>{r.type==='vehicle'?'🚗 Vehicle':'⚙️ Equipment'}</td>
                    <td style={td(i)}>{r.assetName}</td>
                    <td style={{ ...td(i), fontFamily:'monospace', fontSize:11 }}>{r.assetNo}</td>
                    <td style={{ ...td(i), maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:C.textMuted }}>{r.faultType}</td>
                    <td style={td(i)}>{r.requestedBy}</td>
                    <td style={td(i)}>{formatDate(r.requestDate)}</td>
                    <td style={td(i)}><STag status={r.status} /></td>
                    <td style={td(i)} onClick={e=>e.stopPropagation()}>{perms.del&&<Btn variant="danger" sm onClick={()=>del(requests,setRequests,'requests',r.id)}>Del</Btn>}</td>
                  </tr>
                ))}
                {fl(requests,['requestNo','assetName','assetNo']).length===0&&<tr><td colSpan={10} style={{ textAlign:'center', padding:32, color:C.textMuted }}>No maintenance requests</td></tr>}
              </tbody>
            </table>
          )}

          {/* ── HANDOVERS ─────────────────────────────────────────────────── */}
          {tab==='handover' && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:700 }}>
              <thead><tr>{['S/N','Vehicle No.','Date','Receiver','Handed Over By','Condition','Checklist','Status',''].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {fl(handovers,['vehicleNo','receiverName','handedOverBy','condition','status']).map((h,i)=>{
                  const checks = [h.hasJack,h.hasSpareTyre,h.hasTriangle,h.hasFireExtinguisher,h.hasDocuments];
                  const passed = checks.filter(Boolean).length;
                  return (
                    <tr key={h.id} onClick={()=>setModal({type:'ho_view',rec:h})} style={{ cursor:'pointer' }} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale} onMouseLeave={e=>e.currentTarget.style.background=i%2===1?C.greenPale2:'transparent'}>
                      <td style={td(i)}>{i+1}</td>
                      <td style={{ ...td(i), color:C.green, fontFamily:'monospace', fontWeight:700 }}>{h.vehicleNo}</td>
                      <td style={td(i)}>{formatDate(h.handoverDate)}</td>
                      <td style={td(i)}>{h.receiverName}</td>
                      <td style={td(i)}>{h.handedOverBy}</td>
                      <td style={td(i)}><span style={{ color:h.condition==='No damage'?C.success:C.danger, fontWeight:600 }}>{h.condition}</span></td>
                      <td style={td(i)}><span style={{ color:passed===5?C.success:C.warning, fontWeight:700 }}>{passed}/5 ✓</span></td>
                      <td style={td(i)}><STag status={h.status} /></td>
                      <td style={td(i)} onClick={e=>e.stopPropagation()}>
                        <div style={{display:'flex',gap:4}}>
                          <Btn variant="ghost" sm onClick={()=>printHandover(h)}>🖨</Btn>
                          {perms.del&&<Btn variant="danger" sm onClick={()=>del(handovers,setHandovers,'handovers',h.id)}>Del</Btn>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {fl(handovers,['vehicleNo','receiverName']).length===0&&<tr><td colSpan={9} style={{ textAlign:'center', padding:32, color:C.textMuted }}>No handover forms</td></tr>}
              </tbody>
            </table>
          )}

          {/* ── FACILITY SCHEDULE (FMA-010) ───────────────────────────────── */}
          {tab==='facility' && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:800 }}>
              <thead><tr>{['S/N','Description','3 Months','6 Months','Yearly','2 Years','As Needed','Last Done','Next Due','Assigned To','Status'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {facility.map((f,i)=>{
                  const chk = v => v ? <span style={{ color:C.success, fontWeight:700 }}>✓</span> : <span style={{ color:C.textLight }}>—</span>;
                  return (
                    <tr key={f.id} style={{ background:f.status==='Overdue'?'rgba(192,57,43,.04)':i%2===1?C.greenPale2:'transparent' }}>
                      <td style={td(i)}>{i+1}</td>
                      <td style={{ ...td(i), fontWeight:600 }}>{f.description}</td>
                      <td style={{ ...td(i), textAlign:'center' }}>{chk(f.schedule3Months)}</td>
                      <td style={{ ...td(i), textAlign:'center' }}>{chk(f.schedule6Months)}</td>
                      <td style={{ ...td(i), textAlign:'center' }}>{chk(f.scheduleYearly)}</td>
                      <td style={{ ...td(i), textAlign:'center' }}>{chk(f.schedule2Years)}</td>
                      <td style={{ ...td(i), textAlign:'center' }}>{chk(f.scheduleAsNeeded)}</td>
                      <td style={td(i)}>{formatDate(f.lastDone)||'—'}</td>
                      <td style={{ ...td(i), color:f.status==='Overdue'?C.danger:f.status==='Due'?C.warning:C.text, fontWeight:f.status!=='Upcoming'?700:400 }}>{formatDate(f.nextDue)||'—'}</td>
                      <td style={td(i)}>{f.assignedTo}</td>
                      <td style={td(i)}><STag status={f.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* ── CALIBRATION & CERTIFICATION ──────────────────────────────── */}
          {tab==='calibration' && (() => {
            const rows = fl(calibration, ['equipmentName','certType','certNo','authority','expiryDate']);
            return (
              <>
                {calAlert > 0 && (
                  <div style={{ marginBottom:12, padding:'10px 14px', background:calOverdue>0?'#E24B4A18':'#C97A0A18', border:'1px solid '+(calOverdue>0?'#E24B4A40':'#C97A0A40'), borderLeft:'4px solid '+(calOverdue>0?'#E24B4A':'#C97A0A'), borderRadius:8 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:C.text }}>
                      {calOverdue > 0 && `⛔ ${calOverdue} certificate${calOverdue>1?'s':''} OVERDUE. `}
                      {calDueSoon > 0 && `⚠️ ${calDueSoon} certificate${calDueSoon>1?'s':''} due within 60 days.`}
                    </div>
                    <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Renew overdue certificates immediately to maintain regulatory compliance.</div>
                  </div>
                )}
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:1050 }}>
                  <thead><tr>
                    {['S/N','Equipment Name','Cert. Type','Certificate No.','Certifying Authority','Issue Date','Expiry Date','Days Left','Status',''].map(h=><th key={h} style={th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.length===0 && <tr><td colSpan={10} style={{ textAlign:'center', padding:32, color:C.textMuted }}>No calibration or certification records yet. Click "+ Add Calibration / Cert" to register equipment certificates.</td></tr>}
                    {rows.map((c,i)=>{
                      const st = CAL_STATUS(c.expiryDate);
                      return (
                        <tr key={c.id}>
                          <td style={td(i)}>{i+1}</td>
                          <td style={{ ...td(i), fontWeight:600 }}>{c.equipmentName}</td>
                          <td style={td(i)}>{c.certType}</td>
                          <td style={td(i)}>{c.certNo||'—'}</td>
                          <td style={td(i)}>{c.authority||'—'}</td>
                          <td style={td(i)}>{c.issueDate||'—'}</td>
                          <td style={{ ...td(i), fontWeight:600 }}>{c.expiryDate||'—'}</td>
                          <td style={{ ...td(i), fontWeight:700, color:st.color }}>
                            {st.days!==null?(st.days<0?`${Math.abs(st.days)}d overdue`:`${st.days}d`):'—'}
                          </td>
                          <td style={td(i)}>
                            <span style={{ padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700, background:st.color+'22', color:st.color }}>{st.label}</span>
                          </td>
                          <td style={td(i)}>
                            <div style={{ display:'flex', gap:4 }}>
                              {perms.edit && <Btn sm onClick={()=>setModal({type:'cal_edit',data:{...c}})}>Edit</Btn>}
                              {perms.del  && <Btn sm variant="danger" onClick={()=>del(calibration,setCalibration,'calibration',c.id)}>Del</Btn>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {rows.length>0 && (
                  <div style={{ marginTop:8, fontSize:11, color:C.textMuted }}>
                    {calibration.length} total · {calOverdue} overdue · {calDueSoon} due within 60 days · {calibration.length-calOverdue-calDueSoon} current
                  </div>
                )}
              </>
            );
          })()}

        </div>
      </div>

      {/* ── MODALS ────────────────────────────────────────────────────────── */}
      {(modal?.type==='fleet_create')   && <FleetModal onSave={f=>crud(fleet,setFleet,'fleet',f)} onClose={()=>setModal(null)} />}
      {(modal?.type==='fleet_view')     && <FleetModal vehicle={modal.vehicle} onSave={f=>crud(fleet,setFleet,'fleet',f)} onClose={()=>setModal(null)} />}
      {(modal?.type==='service_create') && <ServiceModal fleet={fleet} onSave={f=>{f.requestNo=f.requestNo||nextNo('SVC',services,'requestNo');crud(services,setServices,'services',f);}} onClose={()=>setModal(null)} />}
      {(modal?.type==='service_view')   && <ServiceModal rec={modal.rec} fleet={fleet} onSave={f=>crud(services,setServices,'services',f)} onClose={()=>setModal(null)} />}
      {(modal?.type==='repair_create')  && <RepairModal fleet={fleet} onSave={f=>crud(repairs,setRepairs,'repairs',f)} onClose={()=>setModal(null)} />}
      {(modal?.type==='repair_view')    && <RepairModal rec={modal.rec} fleet={fleet} onSave={f=>crud(repairs,setRepairs,'repairs',f)} onClose={()=>setModal(null)} onPostToAccounting={postRepairToAccounting} />}
      {(modal?.type==='bd_create')      && <BreakdownModal fleet={fleet} onSave={f=>crud(breakdowns,setBreakdowns,'breakdowns',f)} onClose={()=>setModal(null)} />}
      {(modal?.type==='bd_view')        && <BreakdownModal rec={modal.rec} fleet={fleet} onSave={f=>crud(breakdowns,setBreakdowns,'breakdowns',f)} onClose={()=>setModal(null)} />}
      {(modal?.type==='req_create')     && <RequestModal onSave={f=>{f.requestNo=f.requestNo||nextNo(f.type==='vehicle'?'VMR':'EMR',requests,'requestNo');crud(requests,setRequests,'requests',f);}} onClose={()=>setModal(null)} />}
      {(modal?.type==='req_view')       && <RequestModal rec={modal.rec} onSave={f=>crud(requests,setRequests,'requests',f)} onClose={()=>setModal(null)} />}
      {(modal?.type==='ho_create')      && <HandoverModal fleet={fleet} onSave={f=>crud(handovers,setHandovers,'handovers',f)} onClose={()=>setModal(null)} />}
      {(modal?.type==='ho_view')        && <HandoverModal rec={modal.rec} fleet={fleet} onSave={f=>crud(handovers,setHandovers,'handovers',f)} onClose={()=>setModal(null)} />}
      {(modal?.type==='cal_create')     && <CalibrationModal fleet={fleet} onSave={f=>crud(calibration,setCalibration,'calibration',f)} onClose={()=>setModal(null)} />}
      {(modal?.type==='cal_edit')       && <CalibrationModal rec={modal.data} fleet={fleet} onSave={f=>crud(calibration,setCalibration,'calibration',f)} onClose={()=>setModal(null)} />}
    </div>
  );
}
