// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Per-Record Sync React Driver
//
// Connects the app's in-memory `db` to Supabase on a per-record basis:
//   • On startup: load every record from each per-record table once, then
//     subscribe to per-record change events so other devices' edits flow
//     into the local state automatically.
//   • On every dispatch: detect which collection changed and write only
//     the affected records (one upsert per row).
//   • On first sign-in: backfill any localStorage-only data into the new
//     per-record tables so nothing is lost in the migration.
//
// Toggle: VITE_USE_PER_RECORD_SYNC=true enables this engine and disables
// the legacy whole-document sync.js. With the flag off, the app runs on
// the legacy engine and Supabase is unused — useful for offline development.
// ══════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import {
  loadAll, loadAppSettings, loadJournals, loadActivity,
  saveRecord, deleteRecord, saveAppSettings, postJournalEntry, logActivityServer,
  backfillFromBlob, backfillAccountingData, saveAttachment, subscribePerRecord,
  RECORD_TABLES,
} from '../supabase/syncPerRecord';
import { supabase, supabaseReady } from '../supabase/client';
import { supabaseAuthChange, getSupabaseSession } from '../supabase/authBridge';

const USE_PER_RECORD = (import.meta?.env?.VITE_USE_PER_RECORD_SYNC === 'true');

// ── Make the active engine VISIBLE at runtime ────────────────────────────────
// 2026-07-30: this flag is a build-time inline (Vite replaces
// import.meta.env.* at build, so it is frozen into the bundle and cannot be
// inspected or changed from the browser). When the GitHub Actions secret
// VITE_USE_PER_RECORD_SYNC is blank or misspelled, the strict === 'true'
// comparison silently falls back to the LEGACY whole-document engine and
// there was no way to tell from the running app which engine was active —
// diagnosing it required comparing write timestamps in Postgres. That
// invisibility is what made the wrong engine ship unnoticed. Log it once at
// module load so anyone can confirm the truth in DevTools → Console in two
// seconds. Do not remove.
console.info(
  `[SLOT ERP] Data engine: ${USE_PER_RECORD ? 'PER-RECORD (per-row Supabase tables)' : 'LEGACY (whole-document company_data blob)'}` +
  ` — VITE_USE_PER_RECORD_SYNC=${JSON.stringify(import.meta?.env?.VITE_USE_PER_RECORD_SYNC)}`
);

// ── db-key → storage list reader (mirrors syncPerRecord.getRecordList) ──────
function getRecordList(db, key) {
  switch (key) {
    case 'terminalCharges':    return db?.terminal?.charges  || [];
    case 'terminalBols':       return db?.terminal?.bols     || [];
    case 'terminalAdvances':   return db?.terminal?.advances || [];
    case 'terminalConsignees':        return db?.terminal?.consignees        || [];
    case 'terminalShippingCompanies': return db?.terminal?.shippingCompanies || [];
    case 'fleetRepairs':       return db?.fleet?.repairs     || [];
    case 'recurringTemplates': return db?.recurringTemplates || [];
    case 'stockItems':         return db?.stockItems         || [];
    case 'stockMovements':     return db?.stockMovements     || [];
    case 'salesOrders':        return db?.salesOrders        || [];
    // FIX 2026-07-29: kept in sync with syncPerRecord.getRecordList — see the
    // comment there. apBills/apPayments live at db.ap.{bills,payments}, not
    // flat top-level keys; procurement sub-collections live at
    // db.procurement.{rfqs,pos,waybills,invoices}. Without these cases this
    // hook's own initial-load path would silently treat them as empty.
    case 'apBills':          return db?.ap?.bills    || [];
    case 'apPayments':       return db?.ap?.payments || [];
    case 'procurementRfqs':     return db?.procurement?.rfqs     || [];
    case 'procurementPos':      return db?.procurement?.pos      || [];
    case 'procurementWaybills': return db?.procurement?.waybills || [];
    case 'procurementInvoices': return db?.procurement?.invoices || [];
    // Terminal + Fleet remaining sub-collections — kept in sync with
    // syncPerRecord.getRecordList, see 015_terminal_fleet_gaps.sql.
    case 'terminalContainers':    return db?.terminal?.containers      || [];
    case 'terminalLogistics':     return db?.terminal?.logistics       || [];
    case 'fleetVehicles':         return db?.fleet?.fleet              || [];
    case 'fleetServices':         return db?.fleet?.services           || [];
    case 'fleetMaintLog':         return db?.fleet?.maintLog           || [];
    case 'fleetBreakdowns':       return db?.fleet?.breakdowns         || [];
    case 'fleetVehicleRequests':  return db?.fleet?.requests           || [];
    case 'fleetHandovers':        return db?.fleet?.handovers          || [];
    case 'fleetFacilitySchedule': return db?.fleet?.facilitySchedule   || [];
    case 'fleetCalibration':      return db?.fleet?.calibration        || [];
    default:                   return db?.[key] || [];
  }
}

// ── Hook: drive the per-record sync engine ──────────────────────────────────
//
//   usePerRecordSync({ state, dispatch })
//
// On mount:
//   1. If Supabase is configured AND a session exists, load every record
//      from every per-record table, plus app_settings, plus journals, and
//      hydrate the in-memory state.
//   2. Subscribe to per-record change events; on each event, dispatch a
//      UPDATE_MODULE for the affected collection (or a SETTINGS/SET_ACCT
//      for app_settings / journal changes).
//
// The hook intentionally does NOT push on every state change — that's the
// caller's responsibility (see pushOne / pushAll below). The legacy engine
// already pushes the whole db on every save; this engine expects the
// caller to push only the changed record.
export function usePerRecordSync({ state, dispatch }) {
  const loadedRef     = useRef(false);
  const migratingRef  = useRef(false);
  const unsubRef      = useRef(null);

  // ── CRITICAL: fresh-state refs ──────────────────────────────────────────────
  // The realtime subscription handler captures `state.db` from the closure of
  // the useEffect that set it up (which runs once per sign-in). Without these
  // refs, every remote event dispatched a stale snapshot of state.db,
  // silently wiping local edits made between sign-in and the next remote
  // event. Refs read the LIVE value at event time.
  const stateDbRef = useRef(state.db);
  useEffect(() => { stateDbRef.current = state.db; }, [state.db]);

  // ── Initial load + backfill + subscription ─────────────────────────────
  useEffect(() => {
    if (!USE_PER_RECORD || !supabaseReady) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const sess = await getSupabaseSession();
        if (!sess) return; // not signed in — nothing to load
        if (cancelled) return;

        // 1) Load app settings — replaces localStorage SETTINGS
        const cloudSettings = await loadAppSettings();
        if (cloudSettings && !cancelled) {
          dispatch({ type: 'SET_SETTINGS', payload: cloudSettings });
        }

        // 2) Load per-record db
        const cloudDb = await loadAll();
        if (cloudDb && !cancelled) {
          // Initialise empty sub-collections for safety
          const merged = {
            ...stateDbRef.current,
            ...cloudDb,
            terminal: {
              containers: stateDbRef.current?.terminal?.containers || [],
              logistics:  stateDbRef.current?.terminal?.logistics  || [],
              ...cloudDb.terminal,
            },
            fleet: {
              ...stateDbRef.current?.fleet,
              ...cloudDb.fleet,
            },
          };
          dispatch({ type: 'SET_DB', payload: merged });
        }

        // 3) Load journals
        const cloudJournals = await loadJournals();
        if (Array.isArray(cloudJournals) && cloudJournals.length && !cancelled) {
          const currentAcct = state.acctData || {};
          dispatch({
            type: 'SET_ACCT',
            payload: { ...currentAcct, journals: cloudJournals },
          });
        }

        // 4) Load activity (recent 200)
        const cloudActivity = await loadActivity({ limit: 200 });
        if (cloudActivity.length && !cancelled) {
          dispatch({ type: 'SET_ACTIVITY', payload: cloudActivity });
        }

        // 5) One-time backfill from localStorage to Supabase
        if (!migratingRef.current) {
          migratingRef.current = true;
          try {
            const backfillResults = await backfillFromBlob(stateDbRef.current);
            const acctBackfill = await backfillAccountingData(state.acctData || {}, state.appSettings || {});
            const total = backfillResults?.results?.reduce((s, r) => s + (r.count || 0), 0) || 0;
            if (total > 0) {
              console.info(`[SLOT] Migrated ${total} records to Supabase`, backfillResults.results);
            }
            if (acctBackfill?.results?.journals > 0) {
              console.info(`[SLOT] Migrated ${acctBackfill.results.journals} journal entries`);
            }
          } catch (e) {
            console.warn('[SLOT] Backfill failed:', e?.message);
          }
        }

        // 6) Subscribe to per-record change events
        if (unsubRef.current) unsubRef.current();
        unsubRef.current = subscribePerRecord(({ key, eventType, new: newRow, old }) => {
          try {
            // Read fresh state from the ref — NEVER from the closure capture.
            const db = stateDbRef.current || {};

            if (eventType === 'DELETE') {
              // For terminal_charges / fleet_repairs we know how to remove
              // from the sub-collection. For flat collections, just remove by id.
              if (key === 'terminalCharges') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'terminal', data: {
                  ...(db.terminal || {}),
                  charges: (db.terminal?.charges || []).filter(r => r.id !== old),
                }});
              } else if (key === 'terminalConsignees') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'terminal', data: {
                  ...(db.terminal || {}),
                  consignees: (db.terminal?.consignees || []).filter(r => r.id !== old),
                }});
              } else if (key === 'terminalShippingCompanies') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'terminal', data: {
                  ...(db.terminal || {}),
                  shippingCompanies: (db.terminal?.shippingCompanies || []).filter(r => r.id !== old),
                }});
              } else if (key === 'fleetRepairs') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: {
                  ...(db.fleet || {}),
                  repairs: (db.fleet?.repairs || []).filter(r => r.id !== old),
                }});
              } else if (key === 'apBills') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'ap', data: {
                  ...(db.ap || {}),
                  bills: (db.ap?.bills || []).filter(r => r.id !== old),
                }});
              } else if (key === 'apPayments') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'ap', data: {
                  ...(db.ap || {}),
                  payments: (db.ap?.payments || []).filter(r => r.id !== old),
                }});
              } else if (key === 'procurementRfqs') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'procurement', data: {
                  ...(db.procurement || {}),
                  rfqs: (db.procurement?.rfqs || []).filter(r => r.id !== old),
                }});
              } else if (key === 'procurementPos') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'procurement', data: {
                  ...(db.procurement || {}),
                  pos: (db.procurement?.pos || []).filter(r => r.id !== old),
                }});
              } else if (key === 'procurementWaybills') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'procurement', data: {
                  ...(db.procurement || {}),
                  waybills: (db.procurement?.waybills || []).filter(r => r.id !== old),
                }});
              } else if (key === 'procurementInvoices') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'procurement', data: {
                  ...(db.procurement || {}),
                  invoices: (db.procurement?.invoices || []).filter(r => r.id !== old),
                }});
              } else if (key === 'terminalContainers') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'terminal', data: {
                  ...(db.terminal || {}),
                  containers: (db.terminal?.containers || []).filter(r => r.id !== old),
                }});
              } else if (key === 'terminalLogistics') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'terminal', data: {
                  ...(db.terminal || {}),
                  logistics: (db.terminal?.logistics || []).filter(r => r.id !== old),
                }});
              } else if (key === 'fleetVehicles') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: {
                  ...(db.fleet || {}),
                  fleet: (db.fleet?.fleet || []).filter(r => r.id !== old),
                }});
              } else if (key === 'fleetServices') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: {
                  ...(db.fleet || {}),
                  services: (db.fleet?.services || []).filter(r => r.id !== old),
                }});
              } else if (key === 'fleetMaintLog') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: {
                  ...(db.fleet || {}),
                  maintLog: (db.fleet?.maintLog || []).filter(r => r.id !== old),
                }});
              } else if (key === 'fleetBreakdowns') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: {
                  ...(db.fleet || {}),
                  breakdowns: (db.fleet?.breakdowns || []).filter(r => r.id !== old),
                }});
              } else if (key === 'fleetVehicleRequests') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: {
                  ...(db.fleet || {}),
                  requests: (db.fleet?.requests || []).filter(r => r.id !== old),
                }});
              } else if (key === 'fleetHandovers') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: {
                  ...(db.fleet || {}),
                  handovers: (db.fleet?.handovers || []).filter(r => r.id !== old),
                }});
              } else if (key === 'fleetFacilitySchedule') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: {
                  ...(db.fleet || {}),
                  facilitySchedule: (db.fleet?.facilitySchedule || []).filter(r => r.id !== old),
                }});
              } else if (key === 'fleetCalibration') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: {
                  ...(db.fleet || {}),
                  calibration: (db.fleet?.calibration || []).filter(r => r.id !== old),
                }});
              } else {
                const list = db[key] || [];
                dispatch({ type: 'UPDATE_MODULE', mod: key, data: list.filter(r => r.id !== old) });
              }
            } else if (newRow) {
              if (key === 'terminalCharges') {
                const next = [...(db.terminal?.charges || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'terminal', data: { ...(db.terminal || {}), charges: next } });
              } else if (key === 'terminalBols') {
                const next = [...(db.terminal?.bols || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'terminal', data: { ...(db.terminal || {}), bols: next } });
              } else if (key === 'terminalAdvances') {
                const next = [...(db.terminal?.advances || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'terminal', data: { ...(db.terminal || {}), advances: next } });
              } else if (key === 'terminalConsignees') {
                const next = [...(db.terminal?.consignees || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'terminal', data: { ...(db.terminal || {}), consignees: next } });
              } else if (key === 'terminalShippingCompanies') {
                const next = [...(db.terminal?.shippingCompanies || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'terminal', data: { ...(db.terminal || {}), shippingCompanies: next } });
              } else if (key === 'fleetRepairs') {
                const next = [...(db.fleet?.repairs || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: { ...(db.fleet || {}), repairs: next } });
              } else if (key === 'apBills') {
                const next = [...(db.ap?.bills || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'ap', data: { ...(db.ap || {}), bills: next } });
              } else if (key === 'apPayments') {
                const next = [...(db.ap?.payments || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'ap', data: { ...(db.ap || {}), payments: next } });
              } else if (key === 'procurementRfqs') {
                const next = [...(db.procurement?.rfqs || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'procurement', data: { ...(db.procurement || {}), rfqs: next } });
              } else if (key === 'procurementPos') {
                const next = [...(db.procurement?.pos || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'procurement', data: { ...(db.procurement || {}), pos: next } });
              } else if (key === 'procurementWaybills') {
                const next = [...(db.procurement?.waybills || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'procurement', data: { ...(db.procurement || {}), waybills: next } });
              } else if (key === 'procurementInvoices') {
                const next = [...(db.procurement?.invoices || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'procurement', data: { ...(db.procurement || {}), invoices: next } });
              } else if (key === 'terminalContainers') {
                const next = [...(db.terminal?.containers || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'terminal', data: { ...(db.terminal || {}), containers: next } });
              } else if (key === 'terminalLogistics') {
                const next = [...(db.terminal?.logistics || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'terminal', data: { ...(db.terminal || {}), logistics: next } });
              } else if (key === 'fleetVehicles') {
                const next = [...(db.fleet?.fleet || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: { ...(db.fleet || {}), fleet: next } });
              } else if (key === 'fleetServices') {
                const next = [...(db.fleet?.services || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: { ...(db.fleet || {}), services: next } });
              } else if (key === 'fleetMaintLog') {
                const next = [...(db.fleet?.maintLog || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: { ...(db.fleet || {}), maintLog: next } });
              } else if (key === 'fleetBreakdowns') {
                const next = [...(db.fleet?.breakdowns || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: { ...(db.fleet || {}), breakdowns: next } });
              } else if (key === 'fleetVehicleRequests') {
                const next = [...(db.fleet?.requests || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: { ...(db.fleet || {}), requests: next } });
              } else if (key === 'fleetHandovers') {
                const next = [...(db.fleet?.handovers || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: { ...(db.fleet || {}), handovers: next } });
              } else if (key === 'fleetFacilitySchedule') {
                const next = [...(db.fleet?.facilitySchedule || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: { ...(db.fleet || {}), facilitySchedule: next } });
              } else if (key === 'fleetCalibration') {
                const next = [...(db.fleet?.calibration || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: { ...(db.fleet || {}), calibration: next } });
              } else {
                const next = [...(db[key] || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: key, data: next });
              }
            }
          } catch (e) {
            console.warn('[SLOT] Per-record merge failed:', e?.message);
          }
        });

        loadedRef.current = true;
      } catch (e) {
        console.warn('[SLOT] usePerRecordSync init failed:', e?.message);
      }
    })();

    // Listen for a NEW sign-in — re-run the loader so the freshly-signed-in
    // user's data loads cleanly.
    //
    // BUG FIXED 2026-07-24: this used to reload on EVERY event with no check
    // at all, including the synthetic 'INITIAL' replay that
    // supabaseAuthChange() fires immediately, synchronously, on subscribe
    // whenever a session already exists (see authBridge.js). Since the
    // Supabase session persists across a reload, that replay fired again on
    // the very next mount, which reloaded again, forever — a same-tab
    // infinite reload loop for anyone who was already signed in, which is
    // everyone except a brand-new login. This is what caused the crash-loop
    // reported immediately after this flag was first turned on in
    // production. Filtering to event === 'SIGNED_IN' fixed that one.
    //
    // SECOND BUG FIXED 2026-07-24, same day: filtering on event name alone
    // wasn't enough. supabase-js's own GoTrueClient attaches a
    // visibilitychange listener and re-validates the session every time the
    // browser tab regains focus — and it genuinely fires a real 'SIGNED_IN'
    // event even though nothing actually changed (same user, same session).
    // This is documented, longstanding supabase-js behavior, not something
    // specific to this app — see supabase/supabase-js#716, #1618, #1708 and
    // supabase/supabase#7250. Net effect here: switching to another browser
    // tab and back reloaded the whole page every single time, no matter how
    // many times per minute — reported as "the app refreshes itself."
    //
    // Fix: only reload when the signed-in user's id actually changed from
    // what we last saw (a real new sign-in, or a different user than
    // before) — not just because Supabase re-announced the same session.
    let lastUserId; // undefined until the first INITIAL/SIGNED_IN/SIGNED_OUT event
    const unsubAuth = supabaseAuthChange((event, session) => {
      if (event === 'SIGNED_OUT') { lastUserId = null; return; }
      if (event !== 'INITIAL' && event !== 'SIGNED_IN') return;
      const incomingId = session?.user?.id ?? null;
      if (event === 'INITIAL') {
        // First replay on subscribe — just record the baseline, don't reload.
        lastUserId = incomingId;
        return;
      }
      // event === 'SIGNED_IN'
      if (lastUserId !== undefined && incomingId === lastUserId) {
        return; // same user as before — tab-focus refire, not a real sign-in
      }
      lastUserId = incomingId;
      window.location.reload();
    });

    return () => {
      cancelled = true;
      if (unsubRef.current) unsubRef.current();
      if (typeof unsubAuth === 'function') unsubAuth();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentUser?.id]);
}

// ── Push helpers — call these from a state-change effect ────────────────────
//
// `pushOne(table, record)` — upsert a single record. Use this on per-row
// edits in modules that opt in (everything the new per-record engine
// supports). The legacy engine's whole-document push still runs alongside
// to keep localStorage in sync; this one only writes to Supabase.
//
// `pushAll(db)` — bulk backfill. Use sparingly (e.g. the initial sync after
// a new module is built). One row per record, chunked at 100.
export async function pushOne(table, record) {
  if (!USE_PER_RECORD || !supabaseReady) return { ok: false, reason: 'per-record-sync-disabled' };
  return saveRecord(table, record);
}

// `pushDelete(table, id)` — hard-delete a single record. Only meaningful for
// NO_VOID_TABLES (standing reference data — vendors/clients/projects/staff);
// transactional tables should void via pushOne(table, {...record, voided:true})
// instead, never delete.
export async function pushDelete(table, id) {
  if (!USE_PER_RECORD || !supabaseReady) return { ok: false, reason: 'per-record-sync-disabled' };
  return deleteRecord(table, id);
}

export async function pushAll(db) {
  if (!USE_PER_RECORD || !supabaseReady) return { ok: false, reason: 'per-record-sync-disabled' };
  return backfillFromBlob(db);
}

// `diffAndPush(table, prevList, nextList)` — added 2026-07-29 as part of the
// full-app per-record wiring sweep. Every module's save/persist function
// has the same shape: it knows the list BEFORE the edit (component state,
// or db[key] read at the top of the function) and the list AFTER. Rather
// than hand-writing the same Map/Set diff in 15+ files (the way
// ContractStaff.jsx/SlotStaff.jsx originally did for staff), call this once
// from each module's save choke point. It pushes only what actually
// changed — added or edited records via pushOne, removed records via
// pushDelete — never the whole list. Fire-and-forget, same contract as
// pushOne/pushDelete (never throws/rejects; resolves quietly on failure).
// ── How this used to lose data ───────────────────────────────────────────────
// 2026-08-04: this fired pushOne() inside a plain for-loop and never awaited
// it. One edit means one request, so nobody noticed. A bulk import means
// N requests launched in the same tick — importing 1,139 terminal containers
// opened 1,139 simultaneous connections. The browser and PostgREST shed the
// excess, and because every returned promise was dropped unread, each failure
// was silent: no error, no toast, no console warning. 578 of 1,139 rows
// arrived and the app reported complete success.
//
// Now: a bounded worker pool, one retry per record, and a tally the caller
// can await. Awaiting is optional — the 40+ existing single-record callers
// still work unchanged — but a failure can no longer pass unnoticed, because
// anything still failing after its retry is reported loudly to the console
// and returned in `failed`.
const PUSH_CONCURRENCY = 5;

async function runPool(items, worker, concurrency = PUSH_CONCURRENCY) {
  const queue = [...items];
  const failures = [];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        const res = await worker(item);
        // saveRecord resolves {ok:false} on a handled error rather than throwing.
        if (res && res.ok === false) throw new Error(res.error || res.reason || 'push rejected');
      } catch (first) {
        try {
          await new Promise(r => setTimeout(r, 400));   // brief backoff, then one retry
          const res = await worker(item);
          if (res && res.ok === false) throw new Error(res.error || res.reason || 'push rejected');
        } catch (second) {
          failures.push({ item, error: second?.message || String(second) });
        }
      }
    }
  });
  await Promise.all(runners);
  return failures;
}

export async function diffAndPush(table, prevList, nextList) {
  if (!USE_PER_RECORD || !supabaseReady) return { ok: false, pushed: 0, failed: 0, reason: 'per-record-sync-disabled' };

  const prevById = new Map((prevList || []).filter(Boolean).map(r => [r.id, r]));
  const next = (nextList || []).filter(Boolean);
  const nextIds = new Set(next.map(r => r.id));

  const changed = next.filter(rec => {
    const prev = prevById.get(rec.id);
    return !prev || JSON.stringify(prev) !== JSON.stringify(rec);
  });
  const removed = [...prevById.keys()].filter(id => !nextIds.has(id));

  const writeFails = await runPool(changed, rec => pushOne(table, rec));
  const delFails   = await runPool(removed, id  => pushDelete(table, id));
  const failed = writeFails.length + delFails.length;

  if (failed) {
    console.error(
      `[SLOT ERP] ${failed} of ${changed.length + removed.length} "${table}" record(s) failed to save to the cloud after a retry.`,
      writeFails.concat(delFails).slice(0, 10)
    );
  }

  return {
    ok: failed === 0,
    table,
    pushed: changed.length - writeFails.length,
    deleted: removed.length - delFails.length,
    failed,
    failures: writeFails.concat(delFails),
  };
}

export async function pushSettings(settings) {
  if (!USE_PER_RECORD || !supabaseReady) return { ok: false };
  return saveAppSettings(settings);
}

export async function pushJournal(journal) {
  if (!USE_PER_RECORD || !supabaseReady) return { ok: false };
  return postJournalEntry(journal);
}

export async function pushActivity({ userId, userName, userRole, module, action, message, metadata }) {
  if (!USE_PER_RECORD || !supabaseReady) return { ok: false };
  return logActivityServer({ userId, userName, userRole, module, action, message, metadata });
}

export async function pushAttachment({ parentType, parentId, att }) {
  if (!USE_PER_RECORD || !supabaseReady) return { ok: false };
  return saveAttachment({ parentType, parentId, att });
}

export { USE_PER_RECORD };
