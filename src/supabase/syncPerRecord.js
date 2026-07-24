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
};

// ── Sub-collection reader ────────────────────────────────────────────────────
// Returns the list of records for a given db key. Centralised here so
// callers (saveAll, loadAll, backfill) all walk the same tree.
function getRecordList(db, key) {
  switch (key) {
    case 'terminalCharges':  return db?.terminal?.charges  || [];
    case 'terminalBols':     return db?.terminal?.bols     || [];
    case 'terminalAdvances': return db?.terminal?.advances || [];
    case 'fleetRepairs':     return db?.fleet?.repairs     || [];
    case 'recurringTemplates':return db?.recurringTemplates|| [];
    case 'stockItems':       return db?.stockItems        || [];
    case 'stockMovements':   return db?.stockMovements    || [];
    case 'salesOrders':      return db?.salesOrders       || [];
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

  const isVoided = record.voided === true
    || record.status === 'Cancelled'
    || record.status === 'Rejected';
  const row = {
    id:         record.id,
    company_id: COMPANY_ID,
    data:       record,
    voided:     isVoided,
    updated_at: new Date().toISOString(),
  };
  if (!record.createdAt) row.created_at = new Date().toISOString();

  try {
    const { error } = await supabase
      .from(RECORD_TABLES[table])
      .upsert(row, { onConflict: 'id' });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    console.warn(`[SLOT] Per-record save failed for ${table}/${record.id}:`, e?.message);
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
  const out = { terminal: {}, fleet: {} };
  // FIX (T2-5): was a for-loop awaiting each of the ~17 tables one at a
  // time (17 sequential network round-trips on every login/refresh).
  // Promise.all fires them concurrently instead.
  const entries = await Promise.all(Object.keys(RECORD_TABLES).map(async key => {
    try {
      const { data, error } = await supabase
        .from(RECORD_TABLES[key])
        .select('id, data, voided, updated_at')
        .eq('company_id', COMPANY_ID);
      if (error) throw error;
      return [key, (data || []).map(r => ({ ...r.data, _updated_at: r.updated_at, _voided: r.voided }))];
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
    else if (key === 'fleetRepairs')     out.fleet.repairs     = records;
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

export async function loadActivity({ sinceIso = null, limit = 200 } = {}) {
  if (!supabase) return [];
  try {
    let q = supabase
      .from('activity')
      .select('id, user_name, user_role, module, action, message, metadata, created_at')
      .eq('company_id', COMPANY_ID)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (sinceIso) q = q.gt('created_at', sinceIso);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(r => ({
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
    const rows = list.map(rec => ({
      id:         rec.id,
      company_id: COMPANY_ID,
      data:       rec,
      voided:     rec.voided === true || rec.status === 'Cancelled' || rec.status === 'Rejected',
      updated_at: new Date().toISOString(),
    }));
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
