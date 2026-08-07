// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Per-Record Sync Engine
//
// This is the Tier-1 data-architecture fix called out in the independent
// audit: it replaces the single-JSONB-blob-per-company model with row-level
// upserts to dedicated tables. See supabase/sql/003_per_record_tables.sql
// for the corresponding schema.
//
// Why this exists:
//   The legacy sync.js writes the entire company dataset on every change.
//   Two concurrent users can therefore silently overwrite each other (each
//   client pushes its full in-memory copy back over the top of the other
//   user's edits). This engine writes per-record, so:
//
//     - Different records being edited concurrently never collide
//     - Two clients editing the SAME record converge via last-write-wins
//       at the row level (same trade-off as before, but with a single-
//       record blast radius instead of a whole-company blast radius)
//     - Real-time events fire on per-record changes, not on whole-document
//       updates, so the receive-side merge in App.jsx can be field-level
//
// How to migrate:
//   1. Run supabase/sql/003_per_record_tables.sql against your Supabase
//      project (after 001 + 002 are in place).
//   2. Call backfillFromBlob() ONCE to copy existing blob data into the
//      new tables (also useful for disaster recovery).
//   3. Set the env flag VITE_USE_PER_RECORD_SYNC=true and the rest of the
//      app routes through this engine instead of sync.js.
//
// Both engines can coexist during the migration: this engine writes only
// to the new tables, the legacy engine continues to write the company_data
// row. Once the migration is verified, the legacy engine is removed.
// ══════════════════════════════════════════════════════════════════════════════
import { supabase } from './client';

const COMPANY_ID = import.meta.env.VITE_COMPANY_DOC || 'slot-engineering-nigeria';

// ── Table map — single source of truth for which collection lives where ──────
// Each entry maps an in-app db-key to its Supabase table. Sub-collections
// (e.g. `db.terminal.charges` vs `db.terminal.bols`) are split out via the
// getRecordList() helper so the JSONB blob structure maps cleanly onto
// individual tables.
export const RECORD_TABLES = {
  // Core financials
  invoices:        'invoices',
  arReceipts:      'ar_receipts',
  apBills:         'ap_bills',
  apPayments:      'ap_payments',
  pettycash:       'pettycash',
  fixedassets:     'fixedassets',
  payrollRuns:     'payroll_runs',
  // Terminal — split by sub-collection
  terminalCharges: 'terminal_charges',
  terminalBols:    'terminal_bols',
  terminalAdvances:'terminal_advances',
  terminalConsignees:        'terminal_consignees',
  terminalShippingCompanies: 'terminal_shipping_companies',
  // Fleet — split by sub-collection
  fleetRepairs:    'fleet_repairs',
  // Inventory costing
  stockItems:      'stock_items',
  stockMovements:  'stock_movements',
  // Sales pipeline
  salesOrders:     'sales_orders',
  // Recurring journals
  recurringTemplates:'recurring_templates',
  // Master data
  vendors:         'vendors',
  clients:         'clients',
  projects:        'projects',
  // HR — staff (added 2026-07-29; see 013_staff_per_record_tables.sql for
  // why this was missing and what it broke)
  nlng:            'nlng_staff',
  slot:            'slot_staff',
  // 2026-07-29 — everything below added same day. Audited every db.* key
  // the app actually writes to (grep for UPDATE_MODULE dispatches) against
  // this list and found that, before today, only vendors/clients/projects
  // had ever been listed here — apBills/apPayments were listed but mapped
  // to the wrong db path (fixed in getRecordList() below), and nothing else
  // had a table at all. See 014_full_per_record_coverage.sql.
  //
  // Procurement — split by sub-collection, same pattern as terminal/fleet
  // (Procurement.jsx dispatches the whole db.procurement object at once).
  procurementRfqs:     'procurement_rfqs',
  procurementPos:      'procurement_pos',
  procurementWaybills: 'procurement_waybills',
  procurementInvoices: 'procurement_invoices',
  request:             'requests',
  inventory:           'inventory_items',
  vehicles:            'vehicles',
  creditNotes:         'credit_notes',
  paymentBatches:      'payment_batches',
  recurringInvoiceTemplates: 'recurring_invoice_templates',
  recurringInvoices:         'recurring_invoices',
  bankReconciliations: 'bank_reconciliations',
  prepayAccruals:      'prepay_accruals',
  assetDisposals:      'asset_disposals',
  prepayments:         'prepayments',
  accruals:            'accruals',
  budgets:             'budgets',
  stockTakes:          'stock_takes',
  warehouses:          'warehouses',
  stockTransfers:      'stock_transfers',
  serialBatches:       'serial_batches',
  boms:                'boms',
  bomBuilds:           'bom_builds',
  // 2026-07-29, discovered mid-sweep while wiring the actual push calls
  // (not just adding tables): db.terminal has 7 sub-collections but only 5
  // were ever mapped, and db.fleet has 9 but only `repairs` was. See
  // 015_terminal_fleet_gaps.sql.
  terminalContainers:  'terminal_containers',
  terminalLogistics:   'terminal_logistics',
  fleetVehicles:            'fleet_vehicles',
  fleetServices:            'fleet_services',
  fleetMaintLog:            'fleet_maint_log',
  fleetBreakdowns:          'fleet_breakdowns',
  fleetVehicleRequests:     'fleet_vehicle_requests',
  fleetHandovers:           'fleet_handovers',
  fleetFacilitySchedule:    'fleet_facility_schedule',
  fleetCalibration:         'fleet_calibration',
};

// ── Tables with no `voided` column ────────────────────────────────────────────
// vendors/clients/projects are standing reference entities, not transactions
// you reverse or cancel (see 003_per_record_tables.sql — created deliberately
// without a voided column, unlike every transactional table). saveRecord(),
// loadAll(), and backfillFromBlob() all used to send/select `voided`
// unconditionally for every table in RECORD_TABLES, which fails against
// Supabase's schema cache for these three specifically ("Could not find the
// 'voided' column ... in the schema cache") — surfaced loudly by the backfill
// button's per-table results, but the same assumption also made loadAll()
// silently return an empty list for these three on every load, and would have
// made saveRecord() silently fail to save any vendor/client/project edit once
// live. Fixed 2026-07-24 by gating on this set instead of assuming.
// nlng_staff/slot_staff added 2026-07-29 for the same reason: staff are
// standing HR records edited over time (Active/Inactive/Terminated is a
// status field, not an accounting void), not transactions to reverse.
// warehouses/boms added same day for the same reason — a warehouse or a
// bill-of-materials definition gets edited or retired via its own status
// field, not voided the way an invoice or a PO is.
const NO_VOID_TABLES = new Set(['vendors', 'clients', 'projects', 'nlng_staff', 'slot_staff', 'warehouses', 'boms']);

// ── Sub-collection reader ────────────────────────────────────────────────────
// Returns the list of records for a given db key. Centralised here so
// callers (saveAll, loadAll, backfill) all walk the same tree.
function getRecordList(db, key) {
  switch (key) {
    case 'terminalCharges':  return db?.terminal?.charges  || [];
    case 'terminalBols':     return db?.terminal?.bols     || [];
    case 'terminalAdvances': return db?.terminal?.advances || [];
    case 'terminalConsignees':        return db?.terminal?.consignees        || [];
    case 'terminalShippingCompanies': return db?.terminal?.shippingCompanies || [];
    case 'fleetRepairs':     return db?.fleet?.repairs     || [];
    case 'recurringTemplates':return db?.recurringTemplates|| [];
    case 'stockItems':       return db?.stockItems        || [];
    case 'stockMovements':   return db?.stockMovements    || [];
    case 'salesOrders':      return db?.salesOrders       || [];
    // FIX 2026-07-29: apBills/apPayments were in RECORD_TABLES already, but
    // this function had no case for them, so the default branch looked for
    // db.apBills/db.apPayments (flat) — fields that don't exist. The real
    // data lives at db.ap.bills/db.ap.payments (AccountsPayable.jsx's own
    // saveBills/saveAll dispatch db.ap as one {bills,payments} object). Any
    // load/backfill of AP data would have silently returned empty for as
    // long as this table existed without this case.
    case 'apBills':          return db?.ap?.bills    || [];
    case 'apPayments':       return db?.ap?.payments || [];
    // Procurement — added 2026-07-29, same sub-collection pattern as
    // terminal/fleet (Procurement.jsx dispatches the whole db.procurement
    // object at once via its own save()/persist() helpers).
    case 'procurementRfqs':     return db?.procurement?.rfqs     || [];
    case 'procurementPos':      return db?.procurement?.pos      || [];
    case 'procurementWaybills': return db?.procurement?.waybills || [];
    case 'procurementInvoices': return db?.procurement?.invoices || [];
    // Terminal + Fleet remaining sub-collections — added 2026-07-29, see
    // 015_terminal_fleet_gaps.sql for why these two were missed the first
    // time (terminal) and why fleet had eight uncovered sub-collections.
    case 'terminalContainers':   return db?.terminal?.containers || [];
    case 'terminalLogistics':    return db?.terminal?.logistics  || [];
    case 'fleetVehicles':         return db?.fleet?.fleet              || [];
    case 'fleetServices':         return db?.fleet?.services           || [];
    case 'fleetMaintLog':         return db?.fleet?.maintLog            || [];
    case 'fleetBreakdowns':       return db?.fleet?.breakdowns          || [];
    case 'fleetVehicleRequests':  return db?.fleet?.requests            || [];
    case 'fleetHandovers':        return db?.fleet?.handovers           || [];
    case 'fleetFacilitySchedule': return db?.fleet?.facilitySchedule    || [];
    case 'fleetCalibration':      return db?.fleet?.calibration         || [];
    default:                 return db?.[key] || [];
  }
}

// ── Save ONE record (per-row upsert) ─────────────────────────────────────────
// The right-side caller should debounce: don't call this on every keystroke
// during a form edit — call it when the user actually commits (Save / Submit).
// The legacy engine pushed the full document; this engine pushes one row.
export async function saveRecord(table, record) {
  if (!supabase) return { ok: false, queued: true };
  if (!record?.id) return { ok: false, error: 'record.id required' };
  if (!RECORD_TABLES[table]) return { ok: false, error: `unknown table: ${table}` };

  const row = {
    id:         record.id,
    company_id: COMPANY_ID,
    data:       record,
    updated_at: new Date().toISOString(),
  };
  if (!NO_VOID_TABLES.has(RECORD_TABLES[table])) {
    row.voided = record.voided === true
      || record.status === 'Cancelled'
      || record.status === 'Rejected';
  }
  if (!record.createdAt) row.created_at = new Date().toISOString();

  try {
    const { error } = await supabase
      .from(RECORD_TABLES[table])
      .upsert(row, { onConflict: 'id' });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn(`[SLOT] Per-record save failed for ${table}/${record.id}:`, e?.message);
    // `code` carried out 2026-08-06 so the caller can tell a network failure
    // (retry may work) from a Postgres unique violation, 23505 (retrying can
    // never work). They need opposite advice, and the generic "check your
    // connection" message is actively misleading for the second.
    return { ok: false, error: e?.message, code: e?.code, queued: true };
  }
}

// ── Delete ONE record (hard delete, NO_VOID_TABLES only) ────────────────────
// Transactional tables use the voided flag (set via saveRecord, never
// physically removed — audit trail). Standing-reference tables (vendors,
// clients, projects, and as of 2026-07-29 staff) have no voided column, and
// their modules DO hard-delete records (see ContractStaff.jsx/SlotStaff.jsx
// handleDelete) — this was the missing piece: those local deletes had
// nothing to call to remove the row from Supabase, so a deleted-locally
// staff member would otherwise linger in the cloud table forever.
// ── 2026-08-06: THE RULE ABOVE WAS DOCUMENTED BUT NEVER ENFORCED ─────────────
//
// The header comment has always said transactional records are voided and
// "never physically removed — audit trail". The code below did an
// unconditional hard DELETE on every table regardless. So deleting an invoice
// destroyed the row outright: no way to see what it contained, who removed it,
// or to put it back.
//
// SLOT hit this directly — asked how to investigate a deletion from weeks ago
// and the honest answer was that nothing survived to investigate.
//
// Now the documented rule is the actual behaviour:
//   • NO_VOID_TABLES (vendors, clients, projects, staff, warehouses, boms)
//     have no `voided` column, so they still hard-delete. Unchanged.
//   • Everything else is marked voided = true and KEPT. loadAll() already
//     returns the flag as `_voided`, so the UI can filter it out and the row
//     stays available for audit and recovery.
export async function deleteRecord(table, id) {
  if (!supabase) return { ok: false, queued: true };
  if (!id) return { ok: false, error: 'id required' };
  if (!RECORD_TABLES[table]) return { ok: false, error: `unknown table: ${table}` };
  const physical = RECORD_TABLES[table];
  const hardDelete = NO_VOID_TABLES.has(physical);
  try {
    if (hardDelete) {
      const { error } = await supabase
        .from(physical)
        .delete()
        .eq('id', id)
        .eq('company_id', COMPANY_ID);
      if (error) throw error;
      return { ok: true, mode: 'deleted' };
    }
    // Soft delete — the record survives, flagged and stamped.
    //
    // `voided` alone is NOT enough to mean "deleted": saveRecord() already sets
    // it for any record whose status is Cancelled or Rejected, and those must
    // stay visible. So a deletion is marked inside `data` as well, and loadAll()
    // filters on THAT. Without this, deleting would appear to work and the row
    // would come straight back on the next refresh.
    const { data: rows, error: readErr } = await supabase
      .from(physical)
      .select('data')
      .eq('id', id)
      .eq('company_id', COMPANY_ID)
      .limit(1);
    if (readErr) throw readErr;
    const existing = rows?.[0]?.data || {};
    const { error } = await supabase
      .from(physical)
      .update({
        voided:     true,
        data:       { ...existing, deleted: true, deletedAt: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('company_id', COMPANY_ID);
    if (error) throw error;
    return { ok: true, mode: 'voided' };
  } catch (e) {
    console.warn(`[SLOT] Per-record delete failed for ${table}/${id}:`, e?.message);
    return { ok: false, error: e?.message, queued: true };
  }
}

// ── Bulk save — persists ALL records in a db snapshot, but per-row ───────────
// Returns an array of { table, id, ok, error } so the caller can show
// partial-failure UI if any record failed.
export async function saveAll(db) {
  // FIX (T2-5): was a single for-loop awaiting every record across every
  // table one at a time. Now runs the ~17 tables in parallel (writes within
  // a table stay sequential, to avoid hammering one table with unbounded
  // concurrent upserts) — cuts real, avoidable latency on large saves.
  const perTable = await Promise.all(Object.keys(RECORD_TABLES).map(async key => {
    const list = getRecordList(db, key);
    const results = [];
    for (const rec of list) {
      const r = await saveRecord(key, rec);
      results.push({ table: RECORD_TABLES[key], id: rec?.id, ...r });
    }
    return results;
  }));
  return perTable.flat();
}

// ── Load — fetch every record for this company across all tables ────────────
// Returns a db-shaped object the existing app code can consume unchanged.
// Sub-collections (terminal.charges / bols / advances, fleet.repairs) are
// re-assembled into the same shape the legacy blob model used, so no
// module code has to change.
export async function loadAll() {
  if (!supabase) return null;
  const out = { terminal: {}, fleet: {}, ap: {}, procurement: {} };
  // FIX (T2-5): was a for-loop awaiting each of the ~17 tables one at a
  // time (17 sequential network round-trips on every login/refresh).
  // Promise.all fires them concurrently instead.
  const entries = await Promise.all(Object.keys(RECORD_TABLES).map(async key => {
    try {
      const cols = NO_VOID_TABLES.has(RECORD_TABLES[key]) ? 'id, data, updated_at' : 'id, data, voided, updated_at';
      const { data, error } = await supabase
        .from(RECORD_TABLES[key])
        .select(cols)
        .eq('company_id', COMPANY_ID);
      if (error) throw error;
      // Soft-deleted rows are kept in the database for the audit trail (see
      // deleteRecord) but must not come back into the app, or deleting would
      // look like it silently failed. Filtered on data.deleted specifically —
      // NOT on `voided`, which is also set for Cancelled/Rejected records that
      // are supposed to stay visible.
      return [key, (data || [])
        .filter(r => r?.data?.deleted !== true)
        .map(r => ({ ...r.data, _updated_at: r.updated_at, _voided: r.voided }))];
    } catch (e) {
      console.warn(`[SLOT] Per-record load failed for ${RECORD_TABLES[key]}:`, e?.message);
      return [key, []];
    }
  }));
  for (const [key, records] of entries) {
    // Re-assemble sub-collections
    if (key === 'terminalCharges')       out.terminal.charges  = records;
    else if (key === 'terminalBols')     out.terminal.bols     = records;
    else if (key === 'terminalAdvances') out.terminal.advances = records;
    else if (key === 'terminalConsignees')        out.terminal.consignees        = records;
    else if (key === 'terminalShippingCompanies') out.terminal.shippingCompanies = records;
    else if (key === 'terminalContainers')        out.terminal.containers        = records;
    else if (key === 'terminalLogistics')         out.terminal.logistics         = records;
    // FIX 2026-07-30: these two were missing entirely — fell through to the
    // generic `else out[key] = records` below, producing flat out.apBills /
    // out.procurementRfqs etc. instead of the nested db.ap.bills /
    // db.procurement.rfqs shape AccountsPayable.jsx and Procurement.jsx
    // actually read (state.db.ap, state.db.procurement). Caught auditing
    // loadAll() before recommending the per-record flag flip — the realtime
    // merge handler in usePerRecordSync.js already had this right (see its
    // getRecordList), which is what exposed the inconsistency here.
    else if (key === 'apBills')          out.ap.bills          = records;
    else if (key === 'apPayments')       out.ap.payments       = records;
    else if (key === 'procurementRfqs')     out.procurement.rfqs     = records;
    else if (key === 'procurementPos')      out.procurement.pos      = records;
    else if (key === 'procurementWaybills') out.procurement.waybills = records;
    else if (key === 'procurementInvoices') out.procurement.invoices = records;
    else if (key === 'fleetRepairs')     out.fleet.repairs     = records;
    else if (key === 'fleetVehicles')         out.fleet.fleet              = records;
    else if (key === 'fleetServices')         out.fleet.services           = records;
    else if (key === 'fleetMaintLog')         out.fleet.maintLog           = records;
    else if (key === 'fleetBreakdowns')       out.fleet.breakdowns         = records;
    else if (key === 'fleetVehicleRequests')  out.fleet.requests           = records;
    else if (key === 'fleetHandovers')        out.fleet.handovers          = records;
    else if (key === 'fleetFacilitySchedule') out.fleet.facilitySchedule   = records;
    else if (key === 'fleetCalibration')      out.fleet.calibration        = records;
    else                                 out[key] = records;
  }
  return out;
}

// ── Journal entries — append-only ────────────────────────────────────────────
// There is no update path. Voids go through the standard void-and-reverse
// flow, which posts a NEW mirror-image entry; the original stays forever.
export async function postJournalEntry(journal) {
  if (!supabase) return { ok: false, queued: true };
  if (!journal?.id) return { ok: false, error: 'journal.id required' };
  try {
    const { error } = await supabase
      .from('journal_entries')
      .insert({
        id:         journal.id,
        company_id: COMPANY_ID,
        data:       journal,
        period_key: journal.periodKey || null,
        source:     journal.source    || 'manual',
      });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    // Unique violation = already posted. Treat as success (idempotent).
    if (e?.code === '23505') return { ok: true, alreadyPosted: true };
    console.warn(`[SLOT] Journal post failed for ${journal.id}:`, e?.message);
    return { ok: false, error: e?.message, queued: true };
  }
}

// FIX (T2-6): was an unbounded, unfiltered full-table load — fine today,
// but indexing quality alone won't stop this from getting slower as journal
// history accumulates. sinceIso/limit are optional and backward-compatible
// (existing no-arg callers keep working unchanged) so date-windowing can be
// adopted incrementally wherever it matters most.
export async function loadJournals({ sinceIso = null, limit = 5000 } = {}) {
  if (!supabase) return [];
  try {
    let q = supabase
      .from('journal_entries')
      .select('id, data, period_key, source, created_at')
      .eq('company_id', COMPANY_ID)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (sinceIso) q = q.gte('created_at', sinceIso);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(r => r.data);
  } catch (e) {
    console.warn('[SLOT] Journal load failed:', e?.message);
    return [];
  }
}

// ── Activity log — append-only, server-stamped, true immutability ────────────
export async function logActivityServer({ userId, userName, userRole, module, action, message, metadata }) {
  if (!supabase) return { ok: false, queued: true };
  try {
    const { error } = await supabase.from('activity').insert({
      company_id: COMPANY_ID,
      user_id:    userId    || null,
      user_name:  userName  || 'System',
      user_role:  userRole  || 'system',
      module:     module    || null,
      action:     action    || null,
      message:    message   || '',
      metadata:   metadata  || null,
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn('[SLOT] Activity log failed:', e?.message);
    return { ok: false, error: e?.message };
  }
}

// ── Live activity feed ───────────────────────────────────────────────────────
// 2026-08-05. The `activity` table is deliberately NOT in RECORD_TABLES (it is
// append-only and server-stamped, not a synced business collection), which
// meant subscribePerRecord never covered it. Consequence: the log only ever
// refreshed at sign-in, so two people working at the same time saw two
// different histories and neither could see the other's actions arrive.
//
// Rows are mapped into exactly the shape loadActivity() returns, so a live
// entry and a reloaded one are indistinguishable to the UI.
export function subscribeActivity(onInsert) {
  if (!supabase) return () => {};
  const ch = supabase
    .channel(`activity-${COMPANY_ID}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity', filter: `company_id=eq.${COMPANY_ID}` },
      (payload) => {
        try {
          const r = payload.new;
          if (!r) return;
          onInsert({
            eventId: r.metadata?.eventId || null,  // lets the reducer drop the
            who:    r.user_name,                   // actor's own optimistic copy
            role:   r.user_role,
            module: r.module,
            action: r.action,
            msg:    r.message,
            time:   r.created_at,
          });
        } catch (e) {
          console.warn('[SLOT] Activity realtime handler threw:', e?.message);
        }
      }
    )
    .subscribe();
  return () => { try { supabase.removeChannel(ch); } catch {} };
}

// fromIso/toIso added 2026-08-06. Boot loads only the most recent `limit`
// entries, which is fine for "what happened today" but makes an investigation
// into last month impossible — the rows are in the database but never reach
// the browser. The Activity Log's date filter now passes a range through to
// here so any period can be pulled on demand, however large the log grows.
export async function loadActivity({ sinceIso = null, fromIso = null, toIso = null, limit = 200 } = {}) {
  if (!supabase) return [];
  try {
    let q = supabase
      .from('activity')
      .select('id, user_name, user_role, module, action, message, metadata, created_at')
      .eq('company_id', COMPANY_ID)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (sinceIso) q = q.gt('created_at', sinceIso);
    if (fromIso)  q = q.gte('created_at', fromIso);
    if (toIso)    q = q.lte('created_at', toIso);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(r => ({
      eventId: r.metadata?.eventId || null,
      who:   r.user_name,
      role:  r.user_role,
      module: r.module,
      action: r.action,
      msg:   r.message,
      time:  r.created_at,
    }));
  } catch (e) {
    console.warn('[SLOT] Activity load failed:', e?.message);
    return [];
  }
}

// ── Backfill from the legacy JSONB blob (run once during migration) ──────────
// Walks the company_data.db JSONB and inserts every record into its new
// per-record table. Idempotent — safe to re-run; uses ON CONFLICT DO NOTHING
// at the SQL level (records have a unique id field).
//
// Handles the original 003-era tables AND the round-2 tables (BoLs,
// terminal advances, stock items / movements, sales orders, recurring
// templates). Call once on first sign-in to lift any localStorage-only
// data into Supabase — the result is reported per-table so the UI can
// show "Migrated 247 records to Supabase" or surface failures.
export async function backfillFromBlob(legacyDb) {
  if (!supabase) return { ok: false, reason: 'supabase-not-ready' };
  const results = [];
  for (const key of Object.keys(RECORD_TABLES)) {
    const list = getRecordList(legacyDb, key);
    if (!list.length) {
      results.push({ table: RECORD_TABLES[key], count: 0, ok: true, skipped: 'empty' });
      continue;
    }
    const noVoid = NO_VOID_TABLES.has(RECORD_TABLES[key]);
    const rows = list.map(rec => {
      const row = {
        id:         rec.id,
        company_id: COMPANY_ID,
        data:       rec,
        updated_at: new Date().toISOString(),
      };
      if (!noVoid) {
        row.voided = rec.voided === true || rec.status === 'Cancelled' || rec.status === 'Rejected';
      }
      return row;
    });
    try {
      // chunked insert to keep individual requests small
      const CHUNK = 100;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error } = await supabase
          .from(RECORD_TABLES[key])
          .upsert(slice, { onConflict: 'id', ignoreDuplicates: true });
        if (error) throw error;
      }
      results.push({ table: RECORD_TABLES[key], count: rows.length, ok: true });
    } catch (e) {
      results.push({ table: RECORD_TABLES[key], ok: false, error: e?.message });
    }
  }
  return { ok: true, results };
}

// ── Backfill accounting data — journals, COA, bank stmt, assets ──────────────
// The Accounting module's data isn't a list of records; it's a small set
// of "documents" (coa, journals, bankStmt, vatAdj, whtEntries, assets).
// These are still useful to back up in the per-record world: journals
// go to journal_entries (per-row, append-only); the others live on
// app_settings under an `accounting` key.
export async function backfillAccountingData(acctData, settings) {
  if (!supabase) return { ok: false };
  const results = { journals: 0, appSettings: false };
  // Journals: insert one row per JE
  if (Array.isArray(acctData?.journals) && acctData.journals.length) {
    const CHUNK = 100;
    for (let i = 0; i < acctData.journals.length; i += CHUNK) {
      const slice = acctData.journals.slice(i, i + CHUNK);
      const rows = slice.map(j => ({
        id:         j.id,
        company_id: COMPANY_ID,
        data:       j,
        period_key: j.periodKey || null,
        source:     j.source    || 'manual',
      }));
      const { error } = await supabase
        .from('journal_entries')
        .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
      results.journals += rows.length;
    }
  }
  // Settings blob — also stash the rest of the accounting data on the
  // app_settings row for quick offline load (coa, bankStmt, etc.)
  const merged = { ...(settings || {}), accounting: { ...(settings?.accounting || {}), coa: acctData?.coa || [], bankStmt: acctData?.bankStmt || [], vatAdj: acctData?.vatAdj || [], whtEntries: acctData?.whtEntries || [], assets: acctData?.assets || [] } };
  const r = await saveAppSettings(merged);
  results.appSettings = r.ok;
  return { ok: true, results };
}

// ── Per-record real-time subscription ────────────────────────────────────────
// Replaces the whole-document channel in sync.js. Subscribes once per table;
// each event carries a single record's id + new data, so the App.jsx merge
// can update just that record in local state — no full-state replace.
//
// Returns an unsubscribe function (NOT a Promise, unlike subscribeToChanges
// in sync.js — channels are independent and resolve immediately).
export function subscribePerRecord(onChange) {
  if (!supabase) return () => {};

  const channels = [];
  for (const [key, table] of Object.entries(RECORD_TABLES)) {
    const ch = supabase
      .channel(`${table}-${COMPANY_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `company_id=eq.${COMPANY_ID}` },
        (payload) => {
          try {
            onChange({
              key,                  // e.g. 'invoices'
              eventType: payload.eventType,  // 'INSERT' | 'UPDATE' | 'DELETE'
              new: payload.new?.data ? { ...payload.new.data, _updated_at: payload.new.updated_at } : null,
              old: payload.old?.id || null,
            });
          } catch (e) {
            console.warn(`[SLOT] Per-record handler (${table}) threw:`, e?.message);
          }
        }
      )
      .subscribe();
    channels.push(ch);
  }
  return () => {
    for (const ch of channels) {
      try { supabase.removeChannel(ch); } catch {}
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// App settings — one row per company, keyed by company_id
// ══════════════════════════════════════════════════════════════════════════════
export async function saveAppSettings(settings) {
  if (!supabase) return { ok: false, queued: true };
  try {
    const { error } = await supabase
      .from('app_settings')
      .upsert({
        company_id: COMPANY_ID,
        data:       settings,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'company_id' });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn('[SLOT] saveAppSettings failed:', e?.message);
    return { ok: false, error: e?.message, queued: true };
  }
}

export async function loadAppSettings() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('data, updated_at')
      .eq('company_id', COMPANY_ID)
      .single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    return data?.data || null;
  } catch (e) {
    console.warn('[SLOT] loadAppSettings failed:', e?.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Attachments — cross-module document index
// ══════════════════════════════════════════════════════════════════════════════
//
// Attachments live in the `scanner-docs` Supabase Storage bucket; the
// `attachments` table is the lookup index. The actual binary bytes are
// uploaded via supabase/storage.js (or AttachmentUploader in the UI).
// This module only deals with the row-level metadata.
//
//   saveAttachment({parentType:'ar-invoice', parentId:inv.id, att:{...}})
//   loadAttachments('ar-invoice', inv.id)
//   deleteAttachment(id)
//
export async function saveAttachment({ parentType, parentId, att }) {
  if (!supabase) return { ok: false, queued: true };
  if (!att?.id || !parentType || !parentId) return { ok: false, error: 'att.id, parentType, parentId required' };
  try {
    const { error } = await supabase
      .from('attachments')
      .upsert({
        id:         att.id,
        company_id: COMPANY_ID,
        data:       { ...att, parentType, parentId },
        parent_type: parentType,
        parent_id:   parentId,
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'id' });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn(`[SLOT] saveAttachment failed:`, e?.message);
    return { ok: false, error: e?.message, queued: true };
  }
}

export async function loadAttachments(parentType, parentId) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('attachments')
      .select('id, data')
      .eq('company_id', COMPANY_ID)
      .eq('parent_type', parentType)
      .eq('parent_id',   parentId)
      .eq('voided',      false);
    if (error) throw error;
    return (data || []).map(r => r.data).filter(Boolean);
  } catch (e) {
    console.warn('[SLOT] loadAttachments failed:', e?.message);
    return [];
  }
}

export async function deleteAttachment(attId, { storagePath = null } = {}) {
  if (!supabase) return { ok: false };
  try {
    // Mark as voided rather than physically deleting (audit trail)
    const { error } = await supabase
      .from('attachments')
      .update({ voided: true, updated_at: new Date().toISOString() })
      .eq('id', attId);
    if (error) throw error;
    // Best-effort: also delete the underlying file from storage if a path
    // was supplied and the bucket is reachable.
    if (storagePath) {
      try {
        const { deleteDocument } = await import('./storage');
        await deleteDocument(storagePath);
      } catch (e) { /* non-fatal */ }
    }
    return { ok: true };
  } catch (e) {
    console.warn('[SLOT] deleteAttachment failed:', e?.message);
    return { ok: false, error: e?.message };
  }
}
