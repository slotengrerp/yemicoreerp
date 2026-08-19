// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering Nigeria Limited — Data Layer v2.3
// 2026-07-29: this file used to end with a ~270-line seedDemoData() function
// covering all 14 modules with fabricated staff, invoices, POs, assets, etc.
// It was already fully disconnected from the boot sequence on 2026-07-28
// after a real incident (472 fake records reached the production database
// via this exact path — see App.jsx's boot-sequence note for the full
// account), but the function itself, and its giant embedded fake dataset,
// was still sitting here unused. Deleted outright, not just unreferenced —
// dead demo data is exactly what got "helpfully" reintroduced last time.
// There is no seed/demo data anywhere in this app's source anymore. Real
// business reference data (client/vendor/project master lists, sourced from
// actual SAGE exports — see src/utils/clientMaster.js, vendorMaster.js,
// projectMaster.js) is a different thing and was kept; it is not fabricated.
// ══════════════════════════════════════════════════════════════════════════════
import { STORAGE, MODULE_IDS, EXTENDED_IDS } from './helpers';
import { saveToSupabase, saveSettingsToSupabase, loadFromSupabase } from '../supabase/sync';
import { saveAppSettings } from '../supabase/syncPerRecord';

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
    // 2026-07-28: was `balance: 100000, limit: 100000` — a fabricated ₦100,000
    // petty cash float conjured on every load whenever none existed. It is the
    // only reason an emptied system still showed money. Two other files
    // hardcoded the same figure as ₦500,000, so the "float" depended on which
    // code path ran first. A cash balance must be entered by a human, never
    // assumed — zero until someone replenishes it in Petty Cash.
    if (!db.pettycash_fund || Array.isArray(db.pettycash_fund)) db.pettycash_fund = { balance: 0, limit: 0, custodian: '', lastReplenished: '' };
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
//
// 2026-08-19 QA fix: this only ever wrote to the legacy company_data.settings
// blob (saveSettingsToSupabase). But boot-time settings are read from TWO
// different places depending on VITE_USE_PER_RECORD_SYNC: App.jsx's Phase 1
// reads localStorage/company_data, while usePerRecordSync's boot effect
// (which wins on every load once per-record sync is on, which it is in
// production) reads the SEPARATE app_settings table via loadAppSettings().
// Nothing was ever writing to that second table, so every settings save
// made through the UI (Settings.jsx branding/security/roles, and Module
// Editor's layout) appeared to succeed and even survived a reload if you
// looked at company_data directly — but the actually-rendered UI silently
// reverted on the very next load, because usePerRecordSync's fetch of the
// stale app_settings row ran after Phase 1 and overwrote it. Caught live:
// renamed a module, saved, confirmed the write hit company_data.settings
// via direct query, reloaded — sidebar still showed the old label. Fixed
// by writing to both tables here, once, so every caller (present and
// future) is correct regardless of which sync engine a given deployment
// is running.
export async function saveSettingsCloud(settings) {
  try {
    const [legacy, perRecord] = await Promise.allSettled([
      saveSettingsToSupabase(settings),
      saveAppSettings(settings),
    ]);
    const legacyOk    = legacy.status === 'fulfilled' && legacy.value;
    const perRecordOk = perRecord.status === 'fulfilled' && perRecord.value?.ok;
    return legacyOk || perRecordOk;
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
