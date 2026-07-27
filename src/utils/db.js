// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering Nigeria Limited — Data Layer v2.2
// Comprehensive seed data covering all modules for QA testing
// ══════════════════════════════════════════════════════════════════════════════
import { STORAGE, MODULE_IDS, EXTENDED_IDS, totalRecords } from './helpers';
import { saveToSupabase, saveSettingsToSupabase, loadFromSupabase } from '../supabase/sync';

// ── localStorage size guard ───────────────────────────────────────────────────
const QUOTA_WARN_BYTES  = 4 * 1024 * 1024;
const QUOTA_LIMIT_BYTES = 4.8 * 1024 * 1024;

function localStorageUsedBytes() {
  try {
    return Object.keys(localStorage).reduce((n, k) => n + (localStorage.getItem(k)?.length || 0) * 2, 0);
  } catch { return 0; }
}

function safeWrite(key, value) {
  const data = JSON.stringify(value);
  const used = localStorageUsedBytes();
  const incoming = data.length * 2;
  // CRITICAL FIX: previously `used + incoming > QUOTA_LIMIT_BYTES` double-
  // counted the value already stored at `key`. If `bc_db` held 4 MB and the
  // new value was also ~4 MB, `used` included the OLD 4 MB so the check
  // summed to 8 MB and blocked the write — even though the NET storage after
  // the write would be ~4 MB. Subtract the old value's size to get the true
  // post-write total.
  const oldValueLen = (() => { try { return (localStorage.getItem(key)?.length || 0) * 2; } catch { return 0; } })();
  const netAfter = used - oldValueLen + incoming;
  if (netAfter > QUOTA_LIMIT_BYTES) {
    console.error('[SLOT ERP] localStorage quota exceeded — write blocked.');
    return { ok: false, quota: 'full' };
  }
  try {
    localStorage.setItem(key, data);
    return { ok: true, quota: netAfter > QUOTA_WARN_BYTES ? 'warning' : 'ok' };
  } catch (e) {
    console.error('[SLOT ERP] localStorage write error:', e);
    return { ok: false, quota: 'full' };
  }
}

export function getStorageHealth() {
  const used = localStorageUsedBytes();
  const pct  = Math.round((used / QUOTA_LIMIT_BYTES) * 100);
  return { usedMB: (used / 1024 / 1024).toFixed(2), pct, status: pct >= 96 ? 'full' : pct >= 80 ? 'warning' : 'ok' };
}

// ── Fleet schema migration ────────────────────────────────────────────────────
// FleetMaintenance.jsx was rebuilt with a fuller, current field schema
// (vehicleNo, assignedDriver, assignedUnit, vehicleLicenseExpiry,
// insuranceCertExpiry, roadWorthinessExpiry, etc.) but older saved data
// (local or cloud) may still have the previous schema (regNo, assignedTo,
// department, insuranceExpiry, roadWorthyExpiry) with no equivalent for
// several new fields at all. Records in the old shape render with the make/
// model/status columns populated (those names didn't change) but every
// other column blank, since the table simply looks for a field name that
// isn't there. This maps old-shape records to the current schema in place,
// so existing fleet data displays correctly without having to be re-entered.
// Records already in the current shape are left untouched.
export function migrateFleetData(fleetObj) {
  if (!fleetObj) return fleetObj;

  // Fail-safe: this runs on every app boot, before anything renders. If real
  // saved data has any shape this migration didn't anticipate, the worst
  // outcome must be "migration skipped this time" — never "app won't load."
  try {
    const safeMap = (arr, fn) => {
      if (!Array.isArray(arr)) return Array.isArray(arr) ? arr : (arr || []);
      return arr.map(item => {
        if (!item || typeof item !== 'object') return item;
        try { return fn(item); } catch (e) { return item; } // one bad record can't break the rest
      });
    };

    const fleet = safeMap(fleetObj.fleet, v => {
      if (v.vehicleNo || !v.regNo) return v; // already current shape, or unrecognised shape
      return {
        id: v.id,
        vehicleNo: v.regNo,
        vehicleType: v.type || '',
        make: v.make,
        model: v.model,
        year: v.year,
        engineNo: '',
        chassisNo: '',
        assignedDriver: v.assignedTo || '',
        assignedUnit: v.department || '',
        currentLocation: '',
        vehicleLicenseExpiry: '',
        insuranceCertExpiry: v.insuranceExpiry || '',
        hackneyPermitExpiry: '',
        roadWorthinessExpiry: v.roadWorthyExpiry || '',
        carrierPermitExpiry: '',
        currentKm: v.mileage != null ? String(v.mileage) : '',
        status: v.status || 'Active',
        createdAt: v.createdAt,
      };
    });

    const byId = {};
    (Array.isArray(fleet) ? fleet : []).forEach(v => { if (v && v.id) byId[v.id] = v; });

    const services = safeMap(fleetObj.services, s => {
      if (s.operation || (!s.regNo && !s.serviceType)) return s;
      const v = byId[s.vehicleId];
      return {
        id: s.id, vehicleId: s.vehicleId, vehicleNo: s.regNo || v?.vehicleNo || '',
        operation: s.serviceType || '', serviceDate: s.date || '',
        serviceKm: s.mileageAtService != null ? String(s.mileageAtService) : '',
        nextServiceDate: s.nextServiceDate || '', nextServiceKm: '',
        technicianName: s.vendor || '', remark: s.description || '',
        approvedBy: '', createdAt: s.createdAt,
      };
    });

    const repairs = safeMap(fleetObj.repairs, r => {
      if (r.natureOfRepairs || (!r.regNo && !r.description)) return r;
      const v = byId[r.vehicleId];
      return {
        id: r.id, vehicleId: r.vehicleId, vehicleNo: r.regNo || v?.vehicleNo || '',
        vehicleType: v?.vehicleType || '', date: r.date || '',
        natureOfRepairs: r.description || '', feedback: r.status || '',
        partsUsed: '', costOfParts: 0, costOfLabour: r.actualCost || r.estimatedCost || 0,
        amount: r.actualCost || r.estimatedCost || 0, mechanic: r.vendor || '',
        createdAt: r.createdAt,
      };
    });

    const breakdowns = safeMap(fleetObj.breakdowns, b => {
      if (b.detailOfFault || (!b.regNo && !b.description)) return b;
      const v = byId[b.vehicleId];
      return {
        id: b.id, date: b.date || '', driverName: b.driver || '',
        vehicleNo: b.regNo || v?.vehicleNo || '', vehicleMake: v ? [v.make, v.model].filter(Boolean).join(' ') : '',
        detailOfFault: b.description || '', status: b.status || 'Reported',
        repairDetails: b.action || '', repairedBy: '', certifiedBy: '',
        createdAt: b.createdAt,
      };
    });

    const requests = safeMap(fleetObj.requests, r => {
      if (r.assetName || (!r.regNo && !r.department)) return r;
      const v = byId[r.vehicleId];
      return {
        id: r.id, type: 'vehicle', requestNo: r.requestNo || '',
        assetName: v ? [v.make, v.model].filter(Boolean).join(' ') : '', assetNo: r.regNo || v?.vehicleNo || '',
        location: '', faultType: r.description || '', requestedBy: r.requestedBy || '',
        requestDate: r.date || '', approvedBy: r.approvedBy || '', approvalDate: '',
        workDone: '', attendedBy: '', workDate: '', certifiedBy: '', certDate: '',
        status: r.status || 'Pending', createdAt: r.createdAt,
      };
    });

    return { ...fleetObj, fleet, services, repairs, breakdowns, requests };
  } catch (e) {
    console.warn('[SLOT ERP] Fleet data migration skipped (non-fatal):', e?.message);
    return fleetObj; // never let this be the reason the app fails to load
  }
}

// ── LOCAL STORAGE ─────────────────────────────────────────────────────────────
export function loadDBLocal() {
  try {
    const raw = localStorage.getItem(STORAGE.db);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const db = parsed.db || parsed;
    [...MODULE_IDS, ...EXTENDED_IDS, '_trash', 'creditNotes', 'paymentBatches', 'recurringInvoiceTemplates', 'recurringInvoices', 'prepayAccruals', 'bankReconciliations', 'assetDisposals', 'prepayments', 'accruals', 'budgets', 'stockTakes', 'stockItems', 'stockMovements', 'warehouses', 'stockTransfers', 'serialBatches', 'boms', 'bomBuilds'].forEach(k => { if (!Array.isArray(db[k])) db[k] = []; });
    if (!db.terminal    || Array.isArray(db.terminal))    db.terminal    = { containers: [], charges: [], logistics: [] };
    if (!db.procurement || Array.isArray(db.procurement)) db.procurement = { rfqs: [], pos: [], waybills: [], invoices: [] };
    if (!db.fleet          || Array.isArray(db.fleet))          db.fleet          = { fleet: [], services: [], maintLog: [], repairs: [], breakdowns: [], requests: [], handovers: [], facilitySchedule: [], calibration: [] };
    else if (!db.fleet.calibration) db.fleet.calibration = []; // migrate existing fleet data
    db.fleet = migrateFleetData(db.fleet);
    if (!db.pettycash_fund || Array.isArray(db.pettycash_fund)) db.pettycash_fund = { balance: 100000, limit: 100000, custodian: 'Finance Officer', lastReplenished: '' };
    return { db, activity: parsed.activity || [] };
  } catch { return null; }
}

export function saveDBLocal(db, activity = []) {
  const result = safeWrite(STORAGE.db, { db, activity });
  if (!result.ok) throw new Error('STORAGE_FULL');
  return result.quota;
}

export function loadSettingsLocal() {
  try { const raw = localStorage.getItem(STORAGE.settings); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function saveSettingsLocal(settings) { safeWrite(STORAGE.settings, settings); }

export function loadAccountingLocal() {
  try { const raw = localStorage.getItem(STORAGE.accounting); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function saveAccountingLocal(acctData) { safeWrite(STORAGE.accounting, acctData); }

// ── CLOUD — SUPABASE ──────────────────────────────────────────────────────────
export async function loadDBCloud() {
  try { return await loadFromSupabase(); } catch { return null; }
}

// Alias used by Settings.jsx — saves settings to Supabase
export async function saveSettingsCloud(settings) {
  try {
    await saveSettingsToSupabase(settings);
    return true;
  } catch { return false; }
}

// Returns the full sync.js result object — { ok, conflict?, serverData?, queued? } —
// so callers (App.jsx) can react to a conflict instead of it being swallowed
// into a plain boolean, which was hiding the "someone else saved" case entirely.
export async function saveDBCloud(db, activity, settings, acctData) {
  try {
    // saveToSupabase(db, acctData, settings, activity) — positional args, must match sync.js signature
    return await saveToSupabase(db, acctData, settings, activity);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE SEED DATA — SLOT Engineering Nigeria Limited
// Covers all 14 modules with realistic oil & gas / engineering context
// ══════════════════════════════════════════════════════════════════════════════
export function seedDemoData() {
  return {

    // ── NLNG CONTRACT STAFF (60 staff — representative 15-person sample) ──────
    nlng: [
      { id:'nl01',sn:1, fullName:'Adewale Okonkwo',       email:'a.okonkwo@nlng.com',    refId:'NLNG-ENG-001', department:'Engineering',   role:'Project Engineer',       workLocation:'Bonny Island',    dob:'1988-04-15', stateOfOrigin:'Rivers',   lga:'Port Harcourt', phone:'08034567890', bank:'GTBank',        accountNo:'0123456789', basicSalary:420000,  housing:84000,  transport:42000,  grossSalary:546000,  status:'Active',   createdAt:'2024-01-15T08:00:00Z' },
      { id:'nl02',sn:2, fullName:'Chisom Eze',             email:'c.eze@nlng.com',        refId:'NLNG-HSE-002', department:'HSE',           role:'HSE Officer',            workLocation:'Bonny Island',    dob:'1992-08-22', stateOfOrigin:'Anambra',  lga:'Awka',          phone:'07098765432', bank:'Access Bank',   accountNo:'9876543210', basicSalary:320000,  housing:64000,  transport:32000,  grossSalary:416000,  status:'Active',   createdAt:'2024-01-15T08:00:00Z' },
      { id:'nl03',sn:3, fullName:'Bello Usman',            email:'b.usman@nlng.com',      refId:'NLNG-OPS-003', department:'Operations',    role:'Site Supervisor',        workLocation:'Bonny Island',    dob:'1985-11-10', stateOfOrigin:'Kano',     lga:'Fagge',         phone:'08156789012', bank:'Zenith Bank',   accountNo:'1234567890', basicSalary:380000,  housing:76000,  transport:38000,  grossSalary:494000,  status:'Active',   createdAt:'2024-01-15T08:00:00Z' },
      { id:'nl04',sn:4, fullName:'Ngozi Obiora',           email:'n.obiora@nlng.com',     refId:'NLNG-ENG-004', department:'Engineering',   role:'Mechanical Technician',  workLocation:'Bonny Island',    dob:'1990-03-18', stateOfOrigin:'Imo',      lga:'Owerri',        phone:'08023456789', bank:'First Bank',    accountNo:'2023456789', basicSalary:290000,  housing:58000,  transport:29000,  grossSalary:377000,  status:'Active',   createdAt:'2024-02-01T08:00:00Z' },
      { id:'nl05',sn:5, fullName:'Samuel Okafor',          email:'s.okafor@nlng.com',     refId:'NLNG-PRO-005', department:'Procurement',   role:'Procurement Officer',    workLocation:'Port Harcourt',   dob:'1987-07-05', stateOfOrigin:'Enugu',    lga:'Enugu North',   phone:'07034567891', bank:'UBA',           accountNo:'3034567891', basicSalary:310000,  housing:62000,  transport:31000,  grossSalary:403000,  status:'Active',   createdAt:'2024-02-01T08:00:00Z' },
      { id:'nl06',sn:6, fullName:'Emeka Nwosu',            email:'e.nwosu@nlng.com',      refId:'NLNG-LOG-006', department:'Logistics',     role:'Transport Coordinator',  workLocation:'Port Harcourt',   dob:'1989-12-25', stateOfOrigin:'Imo',      lga:'Ikeduru',       phone:'08112345678', bank:'GTBank',        accountNo:'4012345678', basicSalary:260000,  housing:52000,  transport:26000,  grossSalary:338000,  status:'Active',   createdAt:'2024-02-15T08:00:00Z' },
      { id:'nl07',sn:7, fullName:'Fatima Aliyu',           email:'f.aliyu@nlng.com',      refId:'NLNG-FIN-007', department:'Finance',       role:'Finance Analyst',        workLocation:'Port Harcourt',   dob:'1993-06-14', stateOfOrigin:'Kaduna',   lga:'Kaduna North',  phone:'07023456789', bank:'Access Bank',   accountNo:'5023456789', basicSalary:350000,  housing:70000,  transport:35000,  grossSalary:455000,  status:'Active',   createdAt:'2024-03-01T08:00:00Z' },
      { id:'nl08',sn:8, fullName:'Augustine Okoye',        email:'a.okoye@nlng.com',      refId:'NLNG-ENG-008', department:'Engineering',   role:'Electrical Technician',  workLocation:'Bonny Island',    dob:'1986-09-30', stateOfOrigin:'Delta',    lga:'Oshimili North',phone:'08045678901', bank:'Zenith Bank',   accountNo:'6045678901', basicSalary:300000,  housing:60000,  transport:30000,  grossSalary:390000,  status:'Active',   createdAt:'2024-03-01T08:00:00Z' },
      { id:'nl09',sn:9, fullName:'Halima Musa',            email:'h.musa@nlng.com',       refId:'NLNG-ADM-009', department:'Administration','role':'Admin Assistant',      workLocation:'Port Harcourt',   dob:'1994-02-11', stateOfOrigin:'Sokoto',   lga:'Sokoto North',  phone:'07045678902', bank:'First Bank',    accountNo:'7045678902', basicSalary:220000,  housing:44000,  transport:22000,  grossSalary:286000,  status:'Active',   createdAt:'2024-03-15T08:00:00Z' },
      { id:'nl10',sn:10,fullName:'Chukwuemeka Ibiam',      email:'c.ibiam@nlng.com',      refId:'NLNG-ENG-010', department:'Engineering',   role:'Civil Engineer',         workLocation:'Bonny Island',    dob:'1984-05-20', stateOfOrigin:'Ebonyi',   lga:'Abakaliki',     phone:'08056789012', bank:'Fidelity Bank', accountNo:'8056789012', basicSalary:460000,  housing:92000,  transport:46000,  grossSalary:598000,  status:'Active',   createdAt:'2024-04-01T08:00:00Z' },
      { id:'nl11',sn:11,fullName:'Adeola Adeyemi',         email:'a.adeyemi@nlng.com',    refId:'NLNG-HSE-011', department:'HSE',           role:'Safety Inspector',       workLocation:'Bonny Island',    dob:'1991-10-08', stateOfOrigin:'Ogun',     lga:'Ijebu Ode',     phone:'07056789013', bank:'Sterling Bank', accountNo:'9056789013', basicSalary:340000,  housing:68000,  transport:34000,  grossSalary:442000,  status:'Active',   createdAt:'2024-04-01T08:00:00Z' },
      { id:'nl12',sn:12,fullName:'Musa Garba',             email:'m.garba@nlng.com',      refId:'NLNG-OPS-012', department:'Operations',    role:'Equipment Operator',     workLocation:'Bonny Island',    dob:'1988-01-17', stateOfOrigin:'Borno',    lga:'Maiduguri',     phone:'08067890123', bank:'UBA',           accountNo:'0067890123', basicSalary:260000,  housing:52000,  transport:26000,  grossSalary:338000,  status:'Active',   createdAt:'2024-04-15T08:00:00Z' },
      { id:'nl13',sn:13,fullName:'Ifeoma Nwachukwu',       email:'i.nwachukwu@nlng.com',  refId:'NLNG-ENG-013', department:'Engineering',   role:'Instrumentation Tech.',  workLocation:'Bonny Island',    dob:'1995-07-22', stateOfOrigin:'Anambra',  lga:'Onitsha',       phone:'07067890124', bank:'GTBank',        accountNo:'1067890124', basicSalary:310000,  housing:62000,  transport:31000,  grossSalary:403000,  status:'Active',   createdAt:'2024-05-01T08:00:00Z' },
      { id:'nl14',sn:14,fullName:'Babatunde Fashola',      email:'b.fashola@nlng.com',    refId:'NLNG-MAN-014', department:'Management',    role:'Site Manager',           workLocation:'Bonny Island',    dob:'1980-03-04', stateOfOrigin:'Lagos',    lga:'Surulere',      phone:'08078901234', bank:'Zenith Bank',   accountNo:'2078901234', basicSalary:580000,  housing:116000, transport:58000,  grossSalary:754000,  status:'Active',   createdAt:'2024-05-01T08:00:00Z' },
      { id:'nl15',sn:15,fullName:'Precious Okoro',         email:'p.okoro@nlng.com',      refId:'NLNG-ENG-015', department:'Engineering',   role:'Piping Technician',      workLocation:'Bonny Island',    dob:'1993-11-15', stateOfOrigin:'Rivers',   lga:'Obio-Akpor',    phone:'07078901235', bank:'Access Bank',   accountNo:'3078901235', basicSalary:285000,  housing:57000,  transport:28500,  grossSalary:370500,  status:'On Leave', createdAt:'2024-05-15T08:00:00Z' },
    ],

    // ── SLOT INTERNAL STAFF ───────────────────────────────────────────────────
    slot: [
      { id:'sl01',sn:1, fullName:'Ernest Ojukwu',    email:'e.ojukwu@sloteng.com',  staffId:'SLOT-MD-001',  department:'Management',  role:'Managing Director',          dob:'1975-04-10', stateOfOrigin:'Anambra', lga:'Onitsha',      phone:'08033456789', bank:'Zenith Bank',   accountNo:'1011010033', basicSalary:650000,  housing:130000, transport:65000,  grossSalary:845000,  status:'Active', createdAt:'2020-01-01T08:00:00Z' },
      { id:'sl02',sn:2, fullName:'Grace Okonkwo',    email:'g.okonkwo@sloteng.com', staffId:'SLOT-FIN-002', department:'Finance',     role:'Finance Manager',            dob:'1983-08-20', stateOfOrigin:'Rivers',  lga:'Port Harcourt', phone:'07033456790', bank:'GTBank',        accountNo:'0123456789', basicSalary:480000,  housing:96000,  transport:48000,  grossSalary:624000,  status:'Active', createdAt:'2020-01-01T08:00:00Z' },
      { id:'sl03',sn:3, fullName:'Chidi Okafor',     email:'c.okafor@sloteng.com',  staffId:'SLOT-OPS-003', department:'Operations',  role:'Operations Manager',         dob:'1980-06-15', stateOfOrigin:'Enugu',   lga:'Enugu North',   phone:'08043456791', bank:'First Bank',    accountNo:'2008176695', basicSalary:500000,  housing:100000, transport:50000,  grossSalary:650000,  status:'Active', createdAt:'2020-01-01T08:00:00Z' },
      { id:'sl04',sn:4, fullName:'Alex Mbata',       email:'a.mbata@sloteng.com',   staffId:'SLOT-TEC-004', department:'Technical',   role:'Technical Manager',          dob:'1982-11-30', stateOfOrigin:'Imo',     lga:'Owerri',        phone:'07043456792', bank:'Access Bank',   accountNo:'9876543210', basicSalary:450000,  housing:90000,  transport:45000,  grossSalary:585000,  status:'Active', createdAt:'2020-02-01T08:00:00Z' },
      { id:'sl05',sn:5, fullName:'Ngozi Okafor',     email:'n.okafor@sloteng.com',  staffId:'SLOT-ADM-005', department:'Admin',       role:'Admin Officer',              dob:'1990-02-14', stateOfOrigin:'Anambra', lga:'Awka',          phone:'08053456793', bank:'UBA',           accountNo:'1015363537', basicSalary:250000,  housing:50000,  transport:25000,  grossSalary:325000,  status:'Active', createdAt:'2020-03-01T08:00:00Z' },
      { id:'sl06',sn:6, fullName:'Michael Eze',      email:'m.eze@sloteng.com',     staffId:'SLOT-PRO-006', department:'Procurement', role:'Procurement Officer',        dob:'1988-09-05', stateOfOrigin:'Enugu',   lga:'Igbo Eze',      phone:'07053456794', bank:'Fidelity Bank', accountNo:'4011553970', basicSalary:280000,  housing:56000,  transport:28000,  grossSalary:364000,  status:'Active', createdAt:'2020-03-01T08:00:00Z' },
      { id:'sl07',sn:7, fullName:'Blessing Nwankwo', email:'b.nwankwo@sloteng.com', staffId:'SLOT-ACC-007', department:'Accounts',    role:'Accountant',                 dob:'1991-05-19', stateOfOrigin:'Rivers',  lga:'Obio-Akpor',    phone:'08063456795', bank:'GTBank',        accountNo:'5012345678', basicSalary:300000,  housing:60000,  transport:30000,  grossSalary:390000,  status:'Active', createdAt:'2020-04-01T08:00:00Z' },
      { id:'sl08',sn:8, fullName:'Daniel Obi',       email:'d.obi@sloteng.com',     staffId:'SLOT-HSE-008', department:'HSE',         role:'HSE Coordinator',            dob:'1985-07-22', stateOfOrigin:'Delta',   lga:'Warri',         phone:'07063456796', bank:'Sterling Bank', accountNo:'0068919961', basicSalary:320000,  housing:64000,  transport:32000,  grossSalary:416000,  status:'Active', createdAt:'2020-05-01T08:00:00Z' },
    ],

    // ── PROCUREMENT ──────────────────────────────────────────────────────────
    procurement: {
      rfqs: [
        { id:'rfq01', rfqNo:'RFQ-2026-001', title:'Supply of PPE and Safety Equipment', supplier:'Global Safety Solutions Ltd', category:'Safety', date:'2026-01-10', dueDate:'2026-01-24', status:'Responded', totalAmount:1850000, items:[{id:'ri1',description:'Safety Helmets (Class E)',qty:20,unit:'pcs',unitPrice:12500,total:250000},{id:'ri2',description:'Safety Boots (sizes 40–45)',qty:20,unit:'pairs',unitPrice:18000,total:360000},{id:'ri3',description:'Reflective Coveralls',qty:20,unit:'pcs',unitPrice:35000,total:700000},{id:'ri4',description:'Safety Harness Full Body',qty:10,unit:'pcs',unitPrice:54000,total:540000}], notes:'Urgent — site mobilisation 1 Feb', createdAt:'2026-01-10T08:00:00Z' },
        { id:'rfq02', rfqNo:'RFQ-2026-002', title:'Perkins Generator Spare Parts Kit', supplier:'Mikano International Ltd', category:'Mechanical', date:'2026-01-20', dueDate:'2026-02-05', status:'Responded', totalAmount:1564125, items:[{id:'ri5',description:'Perkins 1006 Overhaul Kit',qty:1,unit:'set',unitPrice:780000,total:780000},{id:'ri6',description:'Engine Oil Filter (6-pack)',qty:3,unit:'packs',unitPrice:45000,total:135000},{id:'ri7',description:'Fuel Filter Assembly',qty:2,unit:'pcs',unitPrice:38000,total:76000},{id:'ri8',description:'Radiator Hose Set',qty:2,unit:'sets',unitPrice:28000,total:56000},{id:'ri9',description:'Service Labour',qty:3,unit:'days',unitPrice:171375,total:171375}], notes:'3 units to overhaul before April site ops', createdAt:'2026-01-20T09:00:00Z' },
        { id:'rfq03', rfqNo:'RFQ-2026-003', title:'Office IT Equipment', supplier:'Computer Village Supplies', category:'IT', date:'2026-02-14', dueDate:'2026-02-28', status:'Pending', totalAmount:0, items:[{id:'ri10',description:'Dell Latitude 5540 Laptop i5',qty:2,unit:'pcs',unitPrice:0,total:0},{id:'ri11',description:'27-inch LED Monitor',qty:3,unit:'pcs',unitPrice:0,total:0},{id:'ri12',description:'HP LaserJet Pro Printer',qty:1,unit:'pcs',unitPrice:0,total:0}], notes:'Finance and Admin department upgrade', createdAt:'2026-02-14T10:00:00Z' },
      ],
      pos: [
        { id:'po01', poNo:'PO-2026-001', supplier:'Global Safety Solutions Ltd', category:'Safety', date:'2026-01-28', dueDate:'2026-02-15', status:'Delivered', totalAmount:1850000, items:[{id:'pi1',description:'Safety Helmets (Class E)',qty:20,unit:'pcs',unitPrice:12500,total:250000},{id:'pi2',description:'Safety Boots (sizes 40–45)',qty:20,unit:'pairs',unitPrice:18000,total:360000},{id:'pi3',description:'Reflective Coveralls',qty:20,unit:'pcs',unitPrice:35000,total:700000},{id:'pi4',description:'Safety Harness Full Body',qty:10,unit:'pcs',unitPrice:54000,total:540000}], rfqRef:'RFQ-2026-001', approvedBy:'Ernest Ojukwu', notes:'Delivered 10 Feb 2026. GRN issued.', createdAt:'2026-01-28T08:00:00Z' },
        { id:'po02', poNo:'PO-2026-002', supplier:'Mikano International Ltd', category:'Mechanical', date:'2026-02-10', dueDate:'2026-03-05', status:'Approved', totalAmount:1564125, items:[{id:'pi5',description:'Perkins 1006 Overhaul Kit',qty:1,unit:'set',unitPrice:780000,total:780000},{id:'pi6',description:'Engine Oil Filter (6-pack)',qty:3,unit:'packs',unitPrice:45000,total:135000},{id:'pi7',description:'Fuel Filter Assembly',qty:2,unit:'pcs',unitPrice:38000,total:76000},{id:'pi8',description:'Radiator Hose Set',qty:2,unit:'sets',unitPrice:28000,total:56000},{id:'pi9',description:'Service Labour',qty:3,unit:'days',unitPrice:171375,total:171375}], rfqRef:'RFQ-2026-002', approvedBy:'Ernest Ojukwu', notes:'Parts confirmed in stock', createdAt:'2026-02-10T09:00:00Z' },
        { id:'po03', poNo:'PO-2026-003', supplier:'Conoil Petroleum Products', category:'Fuel', date:'2026-03-01', dueDate:'2026-03-15', status:'Pending Approval', totalAmount:540000, items:[{id:'pi10',description:'AGO (Diesel) — 600 litres',qty:600,unit:'litres',unitPrice:900,total:540000}], rfqRef:'', approvedBy:'', notes:'Monthly fuel supply for fleet and generator', createdAt:'2026-03-01T08:00:00Z' },
        { id:'po04', poNo:'PO-2026-004', supplier:'Emerson Electric West Africa', category:'Instrumentation', date:'2026-04-02', dueDate:'2026-04-30', status:'Pending Approval', totalAmount:2340000, items:[{id:'pi11',description:'Pressure Transmitter 4-20mA',qty:4,unit:'pcs',unitPrice:385000,total:1540000},{id:'pi12',description:'Flow Meter — 2 inch Flanged',qty:2,unit:'pcs',unitPrice:400000,total:800000}], rfqRef:'', approvedBy:'', notes:'Instrumentation upgrade — NLNG site', createdAt:'2026-04-02T10:00:00Z' },
      ],
      waybills: [
        { id:'wb01', waybillNo:'WB-2026-001', poRef:'PO-2026-001', supplier:'Global Safety Solutions Ltd', date:'2026-02-10', receivedBy:'Alex Mbata', items:[{description:'Safety Helmets',qtyOrdered:20,qtyReceived:20},{description:'Safety Boots',qtyOrdered:20,qtyReceived:20},{description:'Reflective Coveralls',qtyOrdered:20,qtyReceived:18,note:'2 pcs wrong size — to be replaced'},{description:'Safety Harness',qtyOrdered:10,qtyReceived:10}], condition:'Good', notes:'2 coveralls returned for size exchange', createdAt:'2026-02-10T14:00:00Z' },
        { id:'wb02', waybillNo:'WB-2026-002', poRef:'PO-2026-002', supplier:'Mikano International Ltd', date:'2026-03-08', receivedBy:'Alex Mbata', items:[{description:'Perkins 1006 Overhaul Kit',qtyOrdered:1,qtyReceived:1},{description:'Engine Oil Filter',qtyOrdered:3,qtyReceived:3},{description:'Fuel Filter Assembly',qtyOrdered:2,qtyReceived:2},{description:'Radiator Hose Set',qtyOrdered:2,qtyReceived:2}], condition:'Good', notes:'Labour team on site from 10 March', createdAt:'2026-03-08T11:00:00Z' },
      ],
      invoices: [
        { id:'si01', invoiceNo:'SUPP-INV-2026-001', supplier:'Global Safety Solutions Ltd', poRef:'PO-2026-001', date:'2026-02-12', dueDate:'2026-03-12', amount:1850000, status:'Paid', paidDate:'2026-03-05', notes:'Full payment on delivery confirmation', createdAt:'2026-02-12T09:00:00Z' },
        { id:'si02', invoiceNo:'SUPP-INV-2026-002', supplier:'Mikano International Ltd', poRef:'PO-2026-002', date:'2026-03-10', dueDate:'2026-04-09', amount:1564125, status:'Pending', paidDate:'', notes:'Net 30 terms', createdAt:'2026-03-10T10:00:00Z' },
      ],
    },

    // ── INVOICES (Sales Invoices to clients) ──────────────────────────────────
    invoices: [
      { id:'inv1', invoiceNo:'SLOT-INV-2026-0001', client:'Nigeria LNG Limited', clientAddress:'NLNG Complex, Bonny Island, Rivers State', projectRef:'SLOT-NLNG-2026-001', category:'Engineering Services', date:'2026-01-01', dueDate:'2026-02-01', paymentTerms:'Net 30',
        items:[{id:'ii1',description:'Engineering & Technical Support – Jan 2026',qty:1,unit:'month',unitPrice:4500000,total:4500000}],
        subtotal:4500000,vatAmount:337500,whtRate:5,whtAmount:225000,total:4837500,netPayable:4612500,
        status:'Paid',paymentDate:'2026-01-30',paymentRef:'NLNG-TRF-0241',notes:'Monthly retainer fee',createdAt:'2026-01-01T08:00:00Z' },
      { id:'inv2', invoiceNo:'SLOT-INV-2026-0002', client:'Nigeria LNG Limited', clientAddress:'NLNG Complex, Bonny Island, Rivers State', projectRef:'SLOT-NLNG-2026-002', category:'Engineering Services', date:'2026-02-01', dueDate:'2026-03-02', paymentTerms:'Net 30',
        items:[{id:'ii2',description:'Engineering & Technical Support – Feb 2026',qty:1,unit:'month',unitPrice:4500000,total:4500000}],
        subtotal:4500000,vatAmount:337500,whtRate:5,whtAmount:225000,total:4837500,netPayable:4612500,
        status:'Paid',paymentDate:'2026-02-28',paymentRef:'NLNG-TRF-0284',notes:'Monthly retainer fee',createdAt:'2026-02-01T08:00:00Z' },
      { id:'inv3', invoiceNo:'SLOT-INV-2026-0003', client:'Nigeria LNG Limited', clientAddress:'NLNG Complex, Bonny Island, Rivers State', projectRef:'SLOT-NLNG-2026-003', category:'Engineering Services', date:'2026-03-01', dueDate:'2026-03-31', paymentTerms:'Net 30',
        items:[{id:'ii3',description:'Engineering & Technical Support – Mar 2026',qty:1,unit:'month',unitPrice:4500000,total:4500000}],
        subtotal:4500000,vatAmount:337500,whtRate:5,whtAmount:225000,total:4837500,netPayable:4612500,
        status:'Paid',paymentDate:'2026-03-28',paymentRef:'NLNG-TRF-0331',notes:'Monthly retainer fee',createdAt:'2026-03-01T08:00:00Z' },
      { id:'inv4', invoiceNo:'SLOT-INV-2026-0004', client:'Nigeria LNG Limited', clientAddress:'NLNG Complex, Bonny Island, Rivers State', projectRef:'SLOT-NLNG-2026-004', category:'Engineering Services', date:'2026-04-01', dueDate:'2026-05-01', paymentTerms:'Net 30',
        items:[{id:'ii4',description:'Engineering & Technical Support – Apr 2026',qty:1,unit:'month',unitPrice:4500000,total:4500000}],
        subtotal:4500000,vatAmount:337500,whtRate:5,whtAmount:225000,total:4837500,netPayable:4612500,
        status:'Pending',paymentDate:'',paymentRef:'',notes:'Monthly retainer fee',createdAt:'2026-04-01T08:00:00Z' },
      { id:'inv5', invoiceNo:'SLOT-INV-2026-0005', client:'Total Energies EP Nigeria', clientAddress:'2 Churchgate Street, Victoria Island, Lagos', projectRef:'SLOT-TEN-2026-001', category:'Logistics', date:'2026-03-05', dueDate:'2026-04-04', paymentTerms:'Net 30',
        items:[{id:'ii5',description:'Logistics & Haulage Support – March 2026',qty:3,unit:'trips',unitPrice:850000,total:2550000},{id:'ii6',description:'Standby Crew Allowance',qty:12,unit:'days',unitPrice:25000,total:300000}],
        subtotal:2850000,vatAmount:213750,whtRate:5,whtAmount:142500,total:3063750,netPayable:2921250,
        status:'Pending',paymentDate:'',paymentRef:'',notes:'',createdAt:'2026-03-05T09:00:00Z' },
      { id:'inv6', invoiceNo:'SLOT-INV-2026-0006', client:'Shell Petroleum Development Company', clientAddress:'Shell Industrial Area, Port Harcourt', projectRef:'SLOT-SPDC-2026-001', category:'Maintenance', date:'2026-01-15', dueDate:'2026-02-14', paymentTerms:'Net 30',
        items:[{id:'ii7',description:'Preventive Maintenance – Generator Set GEN-001',qty:1,unit:'job',unitPrice:1200000,total:1200000},{id:'ii8',description:'Spare Parts Supply',qty:1,unit:'lot',unitPrice:380000,total:380000}],
        subtotal:1580000,vatAmount:118500,whtRate:5,whtAmount:79000,total:1698500,netPayable:1619500,
        status:'Overdue',paymentDate:'',paymentRef:'',notes:'Second follow-up sent 01/03/2026',createdAt:'2026-01-15T08:00:00Z' },
      { id:'inv7', invoiceNo:'SLOT-INV-2026-0007', client:'Chevron Nigeria Limited', clientAddress:'2 Chevron Drive, Lekki, Lagos', projectRef:'SLOT-CVX-2026-001', category:'Procurement', date:'2026-04-10', dueDate:'2026-05-10', paymentTerms:'Net 30',
        items:[{id:'ii9',description:'Supply of Safety PPE Kits',qty:50,unit:'sets',unitPrice:85000,total:4250000},{id:'ii10',description:'Delivery & Handling',qty:1,unit:'lot',unitPrice:150000,total:150000}],
        subtotal:4400000,vatAmount:330000,whtRate:5,whtAmount:220000,total:4730000,netPayable:4510000,
        status:'Draft',paymentDate:'',paymentRef:'',notes:'Awaiting client PO confirmation',createdAt:'2026-04-10T10:00:00Z' },
    ],

    // ── PETTY CASH ────────────────────────────────────────────────────────────
    pettycash: [
      { id:'pc01',voucherNo:'PCV-2026-0001',date:'2026-01-08',payee:'Stationery Hub Ltd',          description:'A4 papers, pens, folders, staples for office',          category:'Stationery',            amount:22500,  requestedBy:'Ngozi Okafor',   approvedBy:'Ernest Ojukwu',status:'Approved',receipt:true, notes:'', createdAt:'2026-01-08T09:00:00Z' },
      { id:'pc02',voucherNo:'PCV-2026-0002',date:'2026-01-15',payee:'Conoil Petrol Station',       description:'Diesel for Perkins generator — 80 litres',               category:'Fuel',                  amount:72000,  requestedBy:'Alex Mbata',     approvedBy:'Ernest Ojukwu',status:'Approved',receipt:true, notes:'', createdAt:'2026-01-15T11:00:00Z' },
      { id:'pc03',voucherNo:'PCV-2026-0003',date:'2026-01-22',payee:'Emeka Drivers Services',      description:'Staff transport — site visit Bonny Island return trip',  category:'Transportation',        amount:55000,  requestedBy:'Chidi Okafor',   approvedBy:'Ernest Ojukwu',status:'Approved',receipt:true, notes:'', createdAt:'2026-01-22T14:00:00Z' },
      { id:'pc04',voucherNo:'PCV-2026-0004',date:'2026-02-05',payee:'Quick Fix Plumbing',          description:'Emergency plumbing repair — staff toilets block',         category:'Maintenance & Repairs', amount:38000,  requestedBy:'Ngozi Okafor',   approvedBy:'Ernest Ojukwu',status:'Approved',receipt:true, notes:'', createdAt:'2026-02-05T10:00:00Z' },
      { id:'pc05',voucherNo:'PCV-2026-0005',date:'2026-02-12',payee:'Printex Nigeria Ltd',         description:'Business cards reprinting — senior management (50 pcs)',  category:'Printing & Stationery',amount:18000,  requestedBy:'Grace Okonkwo',  approvedBy:'Ernest Ojukwu',status:'Approved',receipt:true, notes:'', createdAt:'2026-02-12T09:00:00Z' },
      { id:'pc06',voucherNo:'PCV-2026-0006',date:'2026-02-20',payee:'Conoil Petrol Station',       description:'Diesel for generator — 100 litres',                      category:'Fuel',                  amount:90000,  requestedBy:'Alex Mbata',     approvedBy:'Ernest Ojukwu',status:'Approved',receipt:true, notes:'', createdAt:'2026-02-20T08:00:00Z' },
      { id:'pc07',voucherNo:'PCV-2026-0007',date:'2026-03-04',payee:'MTN Business',                description:'Office internet data — March bundle',                    category:'Communication',         amount:45000,  requestedBy:'Ngozi Okafor',   approvedBy:'Grace Okonkwo', status:'Approved',receipt:true, notes:'', createdAt:'2026-03-04T09:00:00Z' },
      { id:'pc08',voucherNo:'PCV-2026-0008',date:'2026-03-10',payee:'Ideal Cleaning Services',    description:'Monthly office cleaning contract — March',               category:'Cleaning',              amount:35000,  requestedBy:'Ngozi Okafor',   approvedBy:'Grace Okonkwo', status:'Approved',receipt:true, notes:'', createdAt:'2026-03-10T08:00:00Z' },
      { id:'pc09',voucherNo:'PCV-2026-0009',date:'2026-03-18',payee:'Air Peace Airlines',          description:'Flight ticket — E. Ojukwu Lagos to PH return',           category:'Travel & Accommodation',amount:125000, requestedBy:'Grace Okonkwo',  approvedBy:'Ernest Ojukwu',status:'Approved',receipt:true, notes:'Board meeting trip', createdAt:'2026-03-18T10:00:00Z' },
      { id:'pc10',voucherNo:'PCV-2026-0010',date:'2026-04-02',payee:'Conoil Petrol Station',       description:'Diesel for generator — 120 litres',                      category:'Fuel',                  amount:108000, requestedBy:'Alex Mbata',     approvedBy:'Ernest Ojukwu',status:'Approved',receipt:true, notes:'', createdAt:'2026-04-02T08:00:00Z' },
      { id:'pc11',voucherNo:'PCV-2026-0011',date:'2026-04-08',payee:'Lagos Catering Services',     description:'Lunch for client meeting — 8 guests',                    category:'Entertainment',         amount:42000,  requestedBy:'Ernest Ojukwu',  approvedBy:'',              status:'Pending', receipt:false,notes:'Awaiting receipt', createdAt:'2026-04-08T14:00:00Z' },
      { id:'pc12',voucherNo:'PCV-2026-0012',date:'2026-04-15',payee:'Ifeoma Couriers',             description:'DHL courier — urgent contract documents to Abuja',       category:'Postage & Courier',     amount:28500,  requestedBy:'Ngozi Okafor',   approvedBy:'Grace Okonkwo', status:'Approved',receipt:true, notes:'', createdAt:'2026-04-15T11:00:00Z' },
      { id:'pc13',voucherNo:'PCV-2026-0013',date:'2026-05-02',payee:'Electricity Prepaid Token',   description:'PHED prepaid token — Port Harcourt office',              category:'Electricity',           amount:55000,  requestedBy:'Ngozi Okafor',   approvedBy:'Grace Okonkwo', status:'Approved',receipt:true, notes:'', createdAt:'2026-05-02T09:00:00Z' },
      { id:'pc14',voucherNo:'PCV-2026-0014',date:'2026-05-10',payee:'Emeka Drivers Services',      description:'Site visit transport — Onne Port terminal',              category:'Transportation',        amount:38000,  requestedBy:'Chidi Okafor',   approvedBy:'',              status:'Pending', receipt:false,notes:'', createdAt:'2026-05-10T14:00:00Z' },
    ],

    // ── REQUESTS ──────────────────────────────────────────────────────────────
    request: [
      { id:'rq01',requestNo:'MRQ-2026-0001',type:'Material',date:'2026-01-20',requiredBy:'2026-02-05',requestedBy:'Samuel Okafor',department:'Engineering',priority:'Urgent',subject:'Welding consumables — NLNG Bonny Island pipeline repair',description:'E6013 welding rods (5kg x 10 boxes), angle grinder discs (100pcs), safety gloves (15 pairs) for urgent pipeline repair at Bonny Island. Works scheduled for 06/02/2026.',items:[{description:'E6013 Welding Rods 5kg',qty:10,unit:'box'},{description:'Angle Grinder Discs 115mm',qty:100,unit:'pcs'},{description:'Safety Gloves (Size L)',qty:15,unit:'pairs'}],status:'Approved',approvedBy:'Ernest Ojukwu',approvedDate:'2026-01-21',approvalNote:'Approved. Procurement to raise PO immediately — works cannot wait.',createdAt:'2026-01-20T08:00:00Z' },
      { id:'rq02',requestNo:'SRQ-2026-0001',type:'Service',date:'2026-02-03',requiredBy:'2026-02-20',requestedBy:'Alex Mbata',department:'Technical',priority:'High',subject:'External overhaul — Perkins GEN-001 (200KVA)',description:'GEN-001 has developed intermittent shutdowns under load. Internal team capacity insufficient. Recommend engaging Perkins authorised service centre for full injector overhaul and load test.',items:[],status:'Approved',approvedBy:'Ernest Ojukwu',approvedDate:'2026-02-04',approvalNote:'Approved. Get three quotations before engaging.',createdAt:'2026-02-03T09:00:00Z' },
      { id:'rq03',requestNo:'LRQ-2026-0001',type:'Leave',date:'2026-02-10',requiredBy:'2026-02-24',requestedBy:'Chisom Eze',department:'HSE',priority:'Normal',subject:'Annual leave — 10 working days',description:'Requesting annual leave 17/02/2026 to 28/02/2026 (10 working days). Full handover will be completed by 14/02/2026. All HSE inspection reports are up to date.',leaveType:'Annual Leave',leaveFrom:'2026-02-17',leaveTo:'2026-02-28',leaveDays:10,items:[],status:'Approved',approvedBy:'Ernest Ojukwu',approvedDate:'2026-02-11',approvalNote:'Approved.',createdAt:'2026-02-10T10:00:00Z' },
      { id:'rq04',requestNo:'ITQ-2026-0001',type:'IT',date:'2026-03-05',requiredBy:'2026-03-20',requestedBy:'Grace Okonkwo',department:'Finance',priority:'High',subject:'Laptop replacement — Dell Latitude keyboard/display failure',description:'Dell Latitude 5520 (serial FIN-LAP-002) has total keyboard failure and display flickering. Cannot process payroll reliably. Requesting replacement or urgent repair.',items:[{description:'Dell Latitude 5530 or equivalent',qty:1,unit:'unit'}],status:'Approved',approvedBy:'Ernest Ojukwu',approvedDate:'2026-03-06',approvalNote:'Approved. Get quote from Slot IT. Maximum budget ₦450,000.',createdAt:'2026-03-05T11:00:00Z' },
      { id:'rq05',requestNo:'MRQ-2026-0002',type:'Material',date:'2026-03-18',requiredBy:'2026-04-01',requestedBy:'Augustine Okoye',department:'Engineering',priority:'Normal',subject:'Electrical materials — panel maintenance',description:'Required for scheduled preventive maintenance on MCC panels at Bonny Island site. Items per attached BOM.',items:[{description:'3-Phase Circuit Breaker 63A',qty:5,unit:'pcs'},{description:'PVC Cable 4mm² Red/Blue/Yellow',qty:100,unit:'metres'},{description:'Cable Lugs Assorted',qty:50,unit:'pcs'}],status:'Pending',approvedBy:'',approvedDate:'',approvalNote:'',createdAt:'2026-03-18T09:00:00Z' },
      { id:'rq06',requestNo:'LRQ-2026-0002',type:'Leave',date:'2026-04-10',requiredBy:'2026-04-21',requestedBy:'Ngozi Okafor',department:'Admin',priority:'Normal',subject:'Annual leave — 5 working days',description:'Requesting leave 22/04/2026 to 25/04/2026 (4 working days) plus public holiday 28/04 = effective 5 days. Handover note will be provided.',leaveType:'Annual Leave',leaveFrom:'2026-04-22',leaveTo:'2026-04-28',leaveDays:5,items:[],status:'Submitted',approvedBy:'',approvedDate:'',approvalNote:'',createdAt:'2026-04-10T14:00:00Z' },
      { id:'rq07',requestNo:'SRQ-2026-0002',type:'Service',date:'2026-04-20',requiredBy:'2026-05-10',requestedBy:'Daniel Obi',department:'HSE',priority:'Urgent',subject:'HSE audit — third party certification renewal (ISO 45001)',description:'Our ISO 45001 certification expires 30/06/2026. Need to engage Bureau Veritas or equivalent for pre-audit assessment and certification renewal. Budget estimated ₦1.2M.',items:[],status:'Pending',approvedBy:'',approvedDate:'',approvalNote:'',createdAt:'2026-04-20T10:00:00Z' },
    ],

    // ── GRN ───────────────────────────────────────────────────────────────────
    grn: [
      { id:'g01',grnNo:'GRN-2026-0001',date:'2026-01-25',poRef:'PO-2026-0001',supplier:'Tagos Thermal Insulation Ltd',deliveredBy:'Tagos Delivery Van',receivedBy:'Chidi Okafor',store:'Technical Store — Bonny Island',inspectedBy:'Augustine Okoye',inspectionDate:'2026-01-25',overallCondition:'Good / Accepted',
        items:[{id:'gi1',description:'Thermal Insulation Pipe 2"',qtyOrdered:100,qtyReceived:60,qtyAccepted:60,qtyRejected:0,unit:'metres',condition:'Good / Accepted',remarks:'Partial delivery — 40m deferred to next delivery per supplier'},{id:'gi2',description:'Insulation Blanket 3m×1m',qtyOrdered:50,qtyReceived:50,qtyAccepted:50,qtyRejected:0,unit:'sheets',condition:'Good / Accepted',remarks:'All items match spec'}],
        notes:'Partial delivery confirmed by supplier. Balance expected by 15/02/2026.',status:'Accepted',createdAt:'2026-01-25T14:00:00Z' },
      { id:'g02',grnNo:'GRN-2026-0002',date:'2026-02-18',poRef:'PO-2026-0003',supplier:'Dangote Industries Ltd',deliveredBy:'Dangote Fleet',receivedBy:'Alex Mbata',store:'Main Warehouse — Port Harcourt',inspectedBy:'Alex Mbata',inspectionDate:'2026-02-18',overallCondition:'Good / Accepted',
        items:[{id:'gi3',description:'Portland Cement 50kg (Dangote)',qtyOrdered:500,qtyReceived:500,qtyAccepted:500,qtyRejected:0,unit:'bags',condition:'Good / Accepted',remarks:'All bags intact, no spillage'},{id:'gi4',description:'Sharp Sand (20-tonne truck)',qtyOrdered:2,qtyReceived:2,qtyAccepted:2,qtyRejected:0,unit:'trucks',condition:'Good / Accepted',remarks:''}],
        notes:'Full delivery. Stored in Yard B.',status:'Accepted',createdAt:'2026-02-18T10:00:00Z' },
      { id:'g03',grnNo:'GRN-2026-0003',date:'2026-03-14',poRef:'PO-2026-0007',supplier:'Stallion Group Nigeria',deliveredBy:'Stallion Logistics',receivedBy:'Samuel Okafor',store:'Technical Store — Port Harcourt',inspectedBy:'Augustine Okoye',inspectionDate:'2026-03-15',overallCondition:'Partially Accepted',
        items:[{id:'gi5',description:'Caterpillar Hydraulic Hose 1"',qtyOrdered:20,qtyReceived:18,qtyAccepted:15,qtyRejected:3,unit:'metres',condition:'Partially Accepted',remarks:'3 metres with visible cracking/delamination — rejected. Supplier notified.'},{id:'gi6',description:'Hydraulic Fittings Assorted',qtyOrdered:50,qtyReceived:50,qtyAccepted:50,qtyRejected:0,unit:'pcs',condition:'Good / Accepted',remarks:''}],
        notes:'Shortage of 2m on hose. 3m rejected for quality. Supplier to replace within 7 days.',status:'Partial',createdAt:'2026-03-14T11:00:00Z' },
      { id:'g04',grnNo:'GRN-2026-0004',date:'2026-04-08',poRef:'PO-2026-0011',supplier:'Afrimash Nigeria Ltd',deliveredBy:'Direct Delivery',receivedBy:'Ngozi Okafor',store:'Office Store — Port Harcourt',inspectedBy:'',inspectionDate:'',overallCondition:'Pending Inspection',
        items:[{id:'gi7',description:'HP LaserJet Pro Toner Cartridge CF258A',qtyOrdered:10,qtyReceived:10,qtyAccepted:0,qtyRejected:0,unit:'pcs',condition:'Pending Inspection',remarks:''},{id:'gi8',description:'A4 Photocopy Paper 75gsm (Hammermill)',qtyOrdered:20,qtyReceived:20,qtyAccepted:0,qtyRejected:0,unit:'reams',condition:'Pending Inspection',remarks:''}],
        notes:'Awaiting storekeeper inspection. Items received end of day.',status:'Pending',createdAt:'2026-04-08T16:00:00Z' },
      { id:'g05',grnNo:'GRN-2026-0005',date:'2026-04-22',poRef:'PO-2026-0015',supplier:'Mikano International Ltd',deliveredBy:'Mikano Delivery',receivedBy:'Alex Mbata',store:'Technical Store — Port Harcourt',inspectedBy:'Alex Mbata',inspectionDate:'2026-04-22',overallCondition:'Good / Accepted',
        items:[{id:'gi9',description:'Perkins Generator Spare Parts Kit (Service Pack A)',qtyOrdered:3,qtyReceived:3,qtyAccepted:3,qtyRejected:0,unit:'kits',condition:'Good / Accepted',remarks:'Parts match Perkins part numbers. Stored in secure technical store.'}],
        notes:'All items verified against PO. Engineer sign-off obtained.',status:'Accepted',createdAt:'2026-04-22T13:00:00Z' },
    ],

    // ── FLEET / VEHICLES ──────────────────────────────────────────────────────
    vehicles: [
      { id:'v01',sn:1, vehicleNumber:'PH-458-AHZ',make:'Toyota Hilux D4D 2.4',         yearOfPurchase:'2021',unitServing:'Operations',        assignedDriver:'Emeka Nwosu',     status:'Active',          currentKm:'47,230', createdAt:'2021-03-01T08:00:00Z' },
      { id:'v02',sn:2, vehicleNumber:'LA-123-BCD',make:'Ford Ranger Wildtrak 3.2',      yearOfPurchase:'2020',unitServing:'HSE',               assignedDriver:'Chidi Okafor',    status:'In Maintenance',  currentKm:'62,100', createdAt:'2020-06-15T08:00:00Z' },
      { id:'v03',sn:3, vehicleNumber:'AB-789-EFG',make:'Toyota Land Cruiser 200 GX',   yearOfPurchase:'2022',unitServing:'Management',        assignedDriver:'Augustine Okoye',status:'Active',          currentKm:'28,540', createdAt:'2022-01-10T08:00:00Z' },
      { id:'v04',sn:4, vehicleNumber:'PH-321-KLM',make:'Toyota Hiace Commuter Bus',     yearOfPurchase:'2019',unitServing:'Staff Transport',   assignedDriver:'Musa Ibrahim',    status:'Active',          currentKm:'89,450', createdAt:'2019-08-01T08:00:00Z' },
      { id:'v05',sn:5, vehicleNumber:'RV-654-NOP',make:'Mitsubishi Canter Flatbed',     yearOfPurchase:'2020',unitServing:'Logistics',         assignedDriver:'Babatunde Ojo',   status:'Active',          currentKm:'54,880', createdAt:'2020-11-01T08:00:00Z' },
    ],

    // ── FLEET (FleetMaintenance module) ─────────────────────────────────────
    fleet: {
      fleet: [
        { id:'fl01', vehicleNo:'AA-001-PH',  vehicleType:'SUV',          make:'Toyota',    model:'Land Cruiser 200', year:2020, engineNo:'ENG-FL01-2020', chassisNo:'CHS-FL01-2020', assignedDriver:'Ernest Ojukwu', assignedUnit:'Management', currentLocation:'Port Harcourt HQ', vehicleLicenseExpiry:'2026-12-31', insuranceCertExpiry:'2026-12-31', hackneyPermitExpiry:'2026-12-31', roadWorthinessExpiry:'2026-09-30', carrierPermitExpiry:'', currentKm:'87,450',  status:'Active',           createdAt:'2020-06-01T08:00:00Z' },
        { id:'fl02', vehicleNo:'LA-123-BCD', vehicleType:'Pickup',       make:'Ford',      model:'Ranger XLT 4x4',   year:2019, engineNo:'ENG-FL02-2019', chassisNo:'CHS-FL02-2019', assignedDriver:'Chidi Okafor',  assignedUnit:'Operations', currentLocation:'Lagos Office',     vehicleLicenseExpiry:'2026-11-15', insuranceCertExpiry:'2026-11-15', hackneyPermitExpiry:'2026-11-15', roadWorthinessExpiry:'2026-07-31', carrierPermitExpiry:'', currentKm:'112,300', status:'Active',           createdAt:'2019-08-01T08:00:00Z' },
        { id:'fl03', vehicleNo:'AA-456-PH',  vehicleType:'Pickup',       make:'Toyota',    model:'Hilux 2.8 GD-6',   year:2021, engineNo:'ENG-FL03-2021', chassisNo:'CHS-FL03-2021', assignedDriver:'Alex Mbata',    assignedUnit:'Technical',  currentLocation:'Port Harcourt HQ', vehicleLicenseExpiry:'2026-10-20', insuranceCertExpiry:'2026-10-20', hackneyPermitExpiry:'2026-10-20', roadWorthinessExpiry:'2026-08-15', carrierPermitExpiry:'', currentKm:'54,200',  status:'Active',           createdAt:'2021-03-15T08:00:00Z' },
        { id:'fl04', vehicleNo:'AA-789-PH',  vehicleType:'Mini Truck',   make:'Mitsubishi',model:'Canter FE84D',     year:2018, engineNo:'ENG-FL04-2018', chassisNo:'CHS-FL04-2018', assignedDriver:'Michael Eze',   assignedUnit:'Logistics',  currentLocation:'Port Harcourt HQ', vehicleLicenseExpiry:'2026-08-30', insuranceCertExpiry:'2026-08-30', hackneyPermitExpiry:'2026-08-30', roadWorthinessExpiry:'2026-06-30', carrierPermitExpiry:'2026-08-30', currentKm:'198,700', status:'Active',           createdAt:'2018-05-01T08:00:00Z' },
        { id:'fl05', vehicleNo:'AA-321-PH',  vehicleType:'Bus/Coaster',  make:'Toyota',    model:'Coaster Bus',      year:2020, engineNo:'ENG-FL05-2020', chassisNo:'CHS-FL05-2020', assignedDriver:'Pool',          assignedUnit:'Admin',      currentLocation:'Port Harcourt HQ', vehicleLicenseExpiry:'2026-12-01', insuranceCertExpiry:'2026-12-01', hackneyPermitExpiry:'2026-12-01', roadWorthinessExpiry:'2026-09-01', carrierPermitExpiry:'', currentKm:'143,500', status:'Active',           createdAt:'2020-01-10T08:00:00Z' },
        { id:'fl06', vehicleNo:'AA-654-PH',  vehicleType:'Pickup',       make:'Ford',      model:'Ranger Raptor',    year:2022, engineNo:'ENG-FL06-2022', chassisNo:'CHS-FL06-2022', assignedDriver:'Daniel Obi',    assignedUnit:'HSE',        currentLocation:'Port Harcourt HQ', vehicleLicenseExpiry:'2027-01-15', insuranceCertExpiry:'2027-01-15', hackneyPermitExpiry:'2027-01-15', roadWorthinessExpiry:'2026-11-30', carrierPermitExpiry:'', currentKm:'31,200',  status:'Under Maintenance', createdAt:'2022-04-20T08:00:00Z' },
      ],
      services: [
        { id:'sv01', vehicleId:'fl01', vehicleNo:'AA-001-PH',  operation:'Routine Service',   serviceDate:'2025-12-15', serviceKm:'82,000',  nextServiceDate:'2026-06-15', nextServiceKm:'92,000',  technicianName:'Toyota Nigeria Ltd — PH',   remark:'60,000km service: engine oil, filters, brake pads', approvedBy:'Ernest Ojukwu', createdAt:'2025-12-15T10:00:00Z' },
        { id:'sv02', vehicleId:'fl02', vehicleNo:'LA-123-BCD', operation:'Routine Service',   serviceDate:'2026-01-22', serviceKm:'109,500', nextServiceDate:'2026-07-22', nextServiceKm:'119,500', technicianName:'Ford Authorised Service PH', remark:'Oil change, air filter, fuel filter replacement',   approvedBy:'Chidi Okafor',  createdAt:'2026-01-22T09:00:00Z' },
        { id:'sv03', vehicleId:'fl04', vehicleNo:'AA-789-PH',  operation:'Tyre Replacement',  serviceDate:'2026-02-10', serviceKm:'195,000', nextServiceDate:'2026-08-10', nextServiceKm:'205,000', technicianName:'Bridgestone Tyres Depot PH', remark:'4 x 7.00R16 tyres replaced — worn below 2mm',        approvedBy:'Michael Eze',   createdAt:'2026-02-10T11:00:00Z' },
      ],
      maintLog: [
        { id:'ml01', vehicleId:'fl03', regNo:'AA-456-PH', date:'2026-03-05', issue:'AC compressor intermittent fault', action:'Belt tightened, refrigerant recharged', cost:45000, vendor:'Auto Cool PH', status:'Resolved', createdAt:'2026-03-05T09:00:00Z' },
        { id:'ml02', vehicleId:'fl06', regNo:'AA-654-PH', date:'2026-04-15', issue:'Right front suspension knocking', action:'Shock absorber replacement required — vehicle grounded', cost:0, vendor:'', status:'Open', createdAt:'2026-04-15T14:00:00Z' },
      ],
      repairs: [
        { id:'rp01', vehicleId:'fl06', vehicleNo:'AA-654-PH', vehicleType:'Pickup', date:'2026-04-15', natureOfRepairs:'Right front shock absorber and control arm bushing replacement', feedback:'In Progress', partsUsed:'Shock absorber, control arm bushing', costOfParts:130000, costOfLabour:50000, amount:180000, mechanic:'Fatoumata Auto Workshop', createdAt:'2026-04-15T15:00:00Z' },
        { id:'rp02', vehicleId:'fl02', vehicleNo:'LA-123-BCD', vehicleType:'Pickup', date:'2026-02-28', natureOfRepairs:'EGR valve cleaning and reset (engine warning light)', feedback:'Completed', partsUsed:'EGR gasket kit', costOfParts:18000, costOfLabour:30000, amount:48000, mechanic:'Emeka Electrical Works', createdAt:'2026-02-28T10:00:00Z' },
      ],
      breakdowns: [
        { id:'bd01', date:'2026-02-27', driverName:'Chidi Okafor', vehicleNo:'LA-123-BCD', vehicleMake:'Ford Ranger XLT 4x4', detailOfFault:'Engine warning light — EGR fault at East-West Road Km 12, Oyigbo. Vehicle managed back to yard.', status:'Resolved', repairDetails:'Booked with Emeka Electrical. Recovered same day.', repairedBy:'Emeka Electrical Works', certifiedBy:'Alex Mbata', createdAt:'2026-02-27T14:30:00Z' },
      ],
      requests: [
        { id:'mr01', type:'vehicle', requestNo:'VMR-2026-0001', assetName:'Toyota Land Cruiser 200', assetNo:'AA-001-PH', location:'Port Harcourt HQ', faultType:'Windscreen wiper blades worn — smearing in rain', requestedBy:'Grace Okonkwo', requestDate:'2026-04-01', approvedBy:'Chidi Okafor', approvalDate:'2026-04-01', workDone:'', attendedBy:'', workDate:'', certifiedBy:'', certDate:'', status:'Approved', createdAt:'2026-04-01T09:00:00Z' },
      ],
      handovers: [],
      facilitySchedule: [],
      calibration: [
        { id:'cal01', equipmentName:'Crane — 20T Mobile (LIEBHERR LTM 1090)', equipmentId:'CRANE-001', certType:'Inspection',   certNo:'DPR/INS/2025/CR-001',   authority:'DPR (Dept. of Petroleum Resources)', issueDate:'2025-10-15', expiryDate:'2026-04-15', notes:'Annual crane inspection — renewal overdue', createdAt:'2025-10-15T08:00:00Z' },
        { id:'cal02', equipmentName:'Pressure Vessel PV-002 (Air Receiver 1000L)', equipmentId:'PV-002',   certType:'Pressure Test', certNo:'SON/PT/2026/002',       authority:'SON (Standards Organisation of Nigeria)', issueDate:'2026-01-20', expiryDate:'2026-07-20', notes:'6-month pressure test certificate', createdAt:'2026-01-20T09:00:00Z' },
        { id:'cal03', equipmentName:'Fork Lift Truck 3T Electric (TOYOTA 8FBE)', equipmentId:'FLT-003',  certType:'Calibration',   certNo:'COREN/CAL/2026/FLT-003', authority:'COREN', issueDate:'2026-02-01', expiryDate:'2026-08-01', notes:'', createdAt:'2026-02-01T08:00:00Z' },
        { id:'cal04', equipmentName:'Weighbridge 60T (AVERY WEIGH-TRONIX)', equipmentId:'WB-001',      certType:'Calibration',   certNo:'SON/WB/2025/011',        authority:'SON (Standards Organisation of Nigeria)', issueDate:'2025-09-01', expiryDate:'2026-03-01', notes:'OVERDUE — renewal in progress with SON Lagos', createdAt:'2025-09-01T08:00:00Z' },
        { id:'cal05', equipmentName:'Overhead Crane 5T Fixed Gantry (Workshop)', equipmentId:'OHC-001',  certType:'Inspection',    certNo:'LR/OHC/2026/001',        authority:"Lloyd's Register", issueDate:'2026-03-10', expiryDate:'2026-09-10', notes:'', createdAt:'2026-03-10T08:00:00Z' },
      ],
    },

    // ── INVENTORY ────────────────────────────────────────────────────────────
    inventory: [
      { id:'hv01',sn:1, regNumber:'HDE/2021/001',make:'Caterpillar 320D Excavator',       companyNumber:'CAT-EXC-001',remark:'Operational — Bonny Island site',type:'heavy',serialNo:'CAT0320DKDP00123',yearOfManufacture:'2019',location:'Bonny Island',status:'Active',createdAt:'2021-01-15T08:00:00Z' },
      { id:'hv02',sn:2, regNumber:'HDE/2021/002',make:'Atlas Copco QAS 200 Generator',    companyNumber:'ATL-GEN-002',remark:'Standby power — PH HQ',             type:'heavy',serialNo:'ATQAS200A2301',   yearOfManufacture:'2021',location:'PH HQ',     status:'Active',createdAt:'2021-06-01T08:00:00Z' },
      { id:'hv03',sn:3, regNumber:'HDE/2022/003',make:'Perkins 200KVA Generator (GEN-001)',companyNumber:'PER-GEN-003',remark:'Primary power — PH HQ',           type:'heavy',serialNo:'PE2506C2026001',   yearOfManufacture:'2020',location:'PH HQ',     status:'Under Maintenance',createdAt:'2022-03-01T08:00:00Z' },
      { id:'hv04',sn:4, regNumber:'HDE/2022/004',make:'Hiab 099 B-2 HiPro Crane Truck',  companyNumber:'HIB-CRN-004',remark:'Cargo lifting — Onne Port',         type:'heavy',serialNo:'HIB0992022044',   yearOfManufacture:'2022',location:'Onne Port', status:'Active',createdAt:'2022-07-01T08:00:00Z' },
      { id:'hv05',sn:5, regNumber:'HDE/2023/005',make:'Hitachi 5HP Air Compressor',       companyNumber:'HIT-CMP-005',remark:'Workshop tools — PH HQ',           type:'heavy',serialNo:'HT2024-CMP-002',  yearOfManufacture:'2023',location:'PH HQ',     status:'Active',createdAt:'2023-02-01T08:00:00Z' },
      { id:'mt01',sn:1, name:'Reinforcement Steel (16mm Y16)',    quantity:2500,unit:'kg',   position:'Yard A – Bay 3',  status:'Available',type:'material',supplier:'Stallion Group',unitCost:780, totalValue:1950000,createdAt:'2026-02-10T08:00:00Z' },
      { id:'mt02',sn:2, name:'Portland Cement 50kg (Dangote)',    quantity:320, unit:'bags',  position:'Yard B – Bay 1',  status:'Available',type:'material',supplier:'Dangote Industries',unitCost:5800,totalValue:1856000,createdAt:'2026-02-18T08:00:00Z' },
      { id:'mt03',sn:3, name:'Thermal Insulation Pipe 2"',        quantity:110, unit:'metres',position:'Tech Store – Rack 4',status:'Available',type:'material',supplier:'Tagos Thermal',unitCost:14000,totalValue:1540000,createdAt:'2026-01-25T08:00:00Z' },
      { id:'mt04',sn:4, name:'PVC Electrical Cable 4mm² (100m reel)',quantity:12,unit:'reels',position:'Tech Store – Rack 2',status:'Available',type:'material',supplier:'Coleman Cables',unitCost:48000,totalValue:576000,createdAt:'2026-03-05T08:00:00Z' },
      { id:'mt05',sn:5, name:'Safety Helmet (EN397 standard)',     quantity:35,  unit:'pcs',  position:'HSE Store',       status:'Available',type:'material',supplier:'Protector Nigeria',unitCost:8500,totalValue:297500,createdAt:'2026-01-10T08:00:00Z' },
      { id:'of01',sn:1, name:'HP LaserJet Pro M404dn Printer',    quantity:2,   unit:'units', position:'Office – PH HQ',  status:'In Use',   type:'office',  serialNo:'MXBC123456,MXBC123457',purchaseDate:'2023-04-01',purchaseCost:380000,createdAt:'2023-04-01T08:00:00Z' },
      { id:'of02',sn:2, name:'Dell Latitude 5530 Laptop',         quantity:6,   unit:'units', position:'Various (Finance/Admin/Procurement)',status:'In Use',type:'office',serialNo:'Multiple',purchaseDate:'2024-01-15',purchaseCost:420000,createdAt:'2024-01-15T08:00:00Z' },
      { id:'of03',sn:3, name:'HP A3 Colour Copier MFP E78528dn',  quantity:1,   unit:'unit',  position:'Office – PH HQ',  status:'In Use',   type:'office',  serialNo:'HPC2023-001',purchaseDate:'2023-07-01',purchaseCost:1450000,createdAt:'2023-07-01T08:00:00Z' },
    ],

    // ── TERMINAL OPERATIONS ───────────────────────────────────────────────────
    terminal: {
      containers: [
        { id:'c01',containerNo:'MSCU1234567',containerType:'20ft DV',size:'20ft',portType:'Sea',shippingCompany:'MSC Mediterranean Shipping Co.',shippingVessel:'MSC LUNA',consigneeName:'SLOT Engineering Nigeria Ltd',materialDescription:'Industrial Pipes & Fittings (PN: TI-2026-001)',billOfLading:'MSCUB1234567',noOfContainers:1,status:'Released',createdAt:'2026-01-20T08:00:00Z' },
        { id:'c02',containerNo:'TRHU9876543',containerType:'40ft HC',size:'40ft',portType:'Sea',shippingCompany:'Hapag-Lloyd AG',shippingVessel:'HL DUBAI',consigneeName:'Nigeria LNG Limited',materialDescription:'Construction Equipment & Machinery (CAT Spares)',billOfLading:'HLCU9876543',noOfContainers:2,status:'Under Exam',createdAt:'2026-03-05T09:00:00Z' },
        { id:'c03',containerNo:'CMAU4561230',containerType:'20ft DV',size:'20ft',portType:'Sea',shippingCompany:'CMA CGM',shippingVessel:'CMA ELBE',consigneeName:'SLOT Engineering Nigeria Ltd',materialDescription:'Chemical Reagents & Lab Supplies',billOfLading:'CMAV4561230',noOfContainers:1,status:'Held',createdAt:'2026-04-10T10:00:00Z' },
        { id:'c04',containerNo:'APMU7654321',containerType:'40ft DV',size:'40ft',portType:'Air',shippingCompany:'Ethiopian Airlines Cargo',shippingVessel:'ET-AXQ',consigneeName:'SLOT Engineering Nigeria Ltd',materialDescription:'Electronic Control Panels & SCADA Components',billOfLading:'ET2026-00441',noOfContainers:1,status:'Transit Applied',createdAt:'2026-05-01T07:00:00Z' },
        { id:'c05',containerNo:'MSKU3210987',containerType:'20ft RF',size:'20ft',portType:'Sea',shippingCompany:'Maersk Line',shippingVessel:'MAERSK ESSEX',consigneeName:'SLOT Engineering Nigeria Ltd',materialDescription:'Temperature-Sensitive Chemical Reagents',billOfLading:'MSKU3210987X',noOfContainers:1,status:'Released',createdAt:'2026-02-14T08:00:00Z' },
      ],
      charges: [
        { id:'ch01',containerNo:'MSCU1234567',arrivalDate:'2026-01-20',paymentDate:'2026-01-26',receiptNo:'RCPT-ONNE-0281',equipmentCharge:45000,terminalCharge:120000,storageCharge:35000,totalAmount:200000,agentName:'Adeola Clearing Agency Ltd',postedToAccounting:true, postDate:'2026-01-27',createdAt:'2026-01-20T08:00:00Z' },
        { id:'ch02',containerNo:'MSKU3210987',arrivalDate:'2026-02-14',paymentDate:'2026-02-20',receiptNo:'RCPT-ONNE-0312',equipmentCharge:45000,terminalCharge:120000,storageCharge:28000,totalAmount:193000,agentName:'Prime Maritime Services Ltd',postedToAccounting:true, postDate:'2026-02-21',createdAt:'2026-02-14T08:00:00Z' },
        { id:'ch03',containerNo:'TRHU9876543',arrivalDate:'2026-03-05',paymentDate:'',          receiptNo:'',               equipmentCharge:65000,terminalCharge:180000,storageCharge:95000,totalAmount:340000,agentName:'Prime Maritime Services Ltd',postedToAccounting:false,postDate:'',createdAt:'2026-03-05T09:00:00Z' },
        { id:'ch04',containerNo:'CMAU4561230',arrivalDate:'2026-04-10',paymentDate:'',          receiptNo:'',               equipmentCharge:45000,terminalCharge:120000,storageCharge:72000,totalAmount:237000,agentName:'Adeola Clearing Agency Ltd',postedToAccounting:false,postDate:'',createdAt:'2026-04-10T10:00:00Z' },
      ],
      logistics: [
        { id:'l01',containerNo:'MSCU1234567',transitApplicationDate:'2026-01-22',noOfContainers:1,billOfLading:'MSCUB1234567',containerSize:'20ft DV',materialDescription:'Industrial Pipes & Fittings',consigneeName:'SLOT Engineering Nigeria Ltd',shippingCompany:'MSC Mediterranean Shipping',shippingVessel:'MSC LUNA',warehouseReceiptDate:'2026-01-23',examDate:'2026-01-25',releaseDate:'2026-01-27',status:'Released',remarks:'Cleared without issues. Delivered to PH warehouse.',createdAt:'2026-01-22T08:00:00Z' },
        { id:'l02',containerNo:'MSKU3210987',transitApplicationDate:'2026-02-16',noOfContainers:1,billOfLading:'MSKU3210987X',containerSize:'20ft RF',materialDescription:'Temperature-Sensitive Chemical Reagents',consigneeName:'SLOT Engineering Nigeria Ltd',shippingCompany:'Maersk Line',shippingVessel:'MAERSK ESSEX',warehouseReceiptDate:'2026-02-17',examDate:'2026-02-18',releaseDate:'2026-02-20',status:'Released',remarks:'Cold chain integrity confirmed. Delivered to bonded warehouse.',createdAt:'2026-02-16T08:00:00Z' },
        { id:'l03',containerNo:'TRHU9876543',transitApplicationDate:'2026-03-07',noOfContainers:2,billOfLading:'HLCU9876543',containerSize:'40ft HC',materialDescription:'Construction Equipment & Machinery',consigneeName:'Nigeria LNG Limited',shippingCompany:'Hapag-Lloyd AG',shippingVessel:'HL DUBAI',warehouseReceiptDate:'2026-03-09',examDate:'',releaseDate:'',status:'Under Exam',remarks:'NCS scanning scheduled. Awaiting exam results.',createdAt:'2026-03-07T09:00:00Z' },
        { id:'l04',containerNo:'APMU7654321',transitApplicationDate:'2026-05-03',noOfContainers:1,billOfLading:'ET2026-00441',containerSize:'40ft DV',materialDescription:'Electronic Control Panels & SCADA Components',consigneeName:'SLOT Engineering Nigeria Ltd',shippingCompany:'Ethiopian Airlines Cargo',shippingVessel:'ET-AXQ',warehouseReceiptDate:'',examDate:'',releaseDate:'',status:'Transit Applied',remarks:'Awaiting warehouse receipt confirmation from Onne Port.',createdAt:'2026-05-03T07:00:00Z' },
      ],
    },

    // ── FIXED ASSETS ─────────────────────────────────────────────────────────
    fixedassets: [
      { id:'fa01',assetNo:'FA-2020-001',description:'Perkins 200KVA Soundproof Generator',category:'Plant & Machinery',cost:8500000, accumulatedDep:2380000,netBookValue:6120000,purchaseDate:'2020-06-01',location:'PH HQ',status:'Active',serialNo:'PE2506C2026001',supplier:'Mikano International Ltd',depRate:20,createdAt:'2020-06-01T08:00:00Z' },
      { id:'fa02',assetNo:'FA-2021-001',description:'Toyota Hilux D4D 2.4 Pickup',         category:'Motor Vehicles',   cost:9200000, accumulatedDep:4140000,netBookValue:5060000,purchaseDate:'2021-03-01',location:'PH HQ',status:'Active',serialNo:'MROHZ39G501098765',supplier:'Elizade Nigeria Ltd',depRate:25,createdAt:'2021-03-01T08:00:00Z' },
      { id:'fa03',assetNo:'FA-2022-001',description:'Toyota Land Cruiser 200 GX',           category:'Motor Vehicles',   cost:22500000,accumulatedDep:5625000,netBookValue:16875000,purchaseDate:'2022-01-10',location:'Abuja',status:'Active',serialNo:'JTMHV05J904321098',supplier:'Cfao Motors Nigeria',depRate:25,createdAt:'2022-01-10T08:00:00Z' },
      { id:'fa04',assetNo:'FA-2022-002',description:'HP A3 Colour Copier MFP E78528dn',    category:'Office Equipment', cost:1450000, accumulatedDep:483333, netBookValue:966667, purchaseDate:'2023-07-01',location:'PH HQ',status:'Active',serialNo:'HPC2023-001',supplier:'HP Nigeria Ltd',depRate:33,createdAt:'2023-07-01T08:00:00Z' },
      { id:'fa05',assetNo:'FA-2023-001',description:'Caterpillar 320D Excavator',           category:'Plant & Machinery',cost:48000000,accumulatedDep:9600000,netBookValue:38400000,purchaseDate:'2019-05-01',location:'Bonny Island',status:'Active',serialNo:'CAT0320DKDP00123',supplier:'Mantrac Nigeria Ltd',depRate:20,createdAt:'2019-05-01T08:00:00Z' },
    ],

    // ── WHT REGISTER ─────────────────────────────────────────────────────────
    wht: [
      { id:'wh01',whtRef:'WHT-2026-0001',date:'2026-01-31',vendor:'Tagos Thermal Insulation Ltd', invoiceRef:'SINV-2026-0001',grossAmount:2085500,whtRate:5,whtAmount:104275, netPaid:1981225,remittedDate:'2026-02-20',remittanceRef:'FIRS-REM-0041',status:'Remitted',createdAt:'2026-01-31T08:00:00Z' },
      { id:'wh02',whtRef:'WHT-2026-0002',date:'2026-02-28',vendor:'Dangote Industries Ltd',        invoiceRef:'SINV-2026-0003',grossAmount:1450000,whtRate:5,whtAmount:72500,  netPaid:1377500,remittedDate:'2026-03-20',remittanceRef:'FIRS-REM-0058',status:'Remitted',createdAt:'2026-02-28T08:00:00Z' },
      { id:'wh03',whtRef:'WHT-2026-0003',date:'2026-03-31',vendor:'Mikano International Ltd',      invoiceRef:'SINV-2026-0006',grossAmount:980000, whtRate:5,whtAmount:49000,  netPaid:931000, remittedDate:'2026-04-20',remittanceRef:'FIRS-REM-0071',status:'Remitted',createdAt:'2026-03-31T08:00:00Z' },
      { id:'wh04',whtRef:'WHT-2026-0004',date:'2026-04-30',vendor:'Stallion Group Nigeria',        invoiceRef:'SINV-2026-0008',grossAmount:875000, whtRate:5,whtAmount:43750,  netPaid:831250, remittedDate:'',           remittanceRef:'',status:'Pending Remittance',createdAt:'2026-04-30T08:00:00Z' },
      { id:'wh05',whtRef:'WHT-2026-0005',date:'2026-05-31',vendor:'Adeola Clearing Agency Ltd',    invoiceRef:'SINV-2026-0010',grossAmount:437000, whtRate:5,whtAmount:21850,  netPaid:415150, remittedDate:'',           remittanceRef:'',status:'Pending Remittance',createdAt:'2026-05-31T08:00:00Z' },
    ],

    // ── Sage Feature II module keys — initialized empty on fresh seed ────────
    recurringInvoices: [],       // SageReports2 reads this key
    arReceipts: [],              // Bank reconciliation reads this
    ap: { bills: [], payments: [] },  // Bank reconciliation reads this
    prepayAccruals: [],          // Prepayments & accruals tab
    bankReconciliations: [],     // Bank reconciliation records
    assetDisposals: [],          // Asset disposal records
    budgets: [],                 // Budget vs actual tab
    stockTakes: [],              // Stock take records
    stockItems: [],              // Stock item master
    stockMovements: [],          // Stock movement history

    _trash: [],
  };
}
