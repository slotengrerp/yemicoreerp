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
  saveRecord, saveAppSettings, postJournalEntry, logActivityServer,
  backfillFromBlob, backfillAccountingData, saveAttachment, subscribePerRecord,
  RECORD_TABLES,
} from '../supabase/syncPerRecord';
import { supabase, supabaseReady } from '../supabase/client';
import { supabaseAuthChange, getSupabaseSession } from '../supabase/authBridge';

const USE_PER_RECORD = (import.meta?.env?.VITE_USE_PER_RECORD_SYNC === 'true');

// ── db-key → storage list reader (mirrors syncPerRecord.getRecordList) ──────
function getRecordList(db, key) {
  switch (key) {
    case 'terminalCharges':    return db?.terminal?.charges  || [];
    case 'terminalBols':       return db?.terminal?.bols     || [];
    case 'terminalAdvances':   return db?.terminal?.advances || [];
    case 'fleetRepairs':       return db?.fleet?.repairs     || [];
    case 'recurringTemplates': return db?.recurringTemplates || [];
    case 'stockItems':         return db?.stockItems         || [];
    case 'stockMovements':     return db?.stockMovements     || [];
    case 'salesOrders':        return db?.salesOrders        || [];
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
              } else if (key === 'fleetRepairs') {
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: {
                  ...(db.fleet || {}),
                  repairs: (db.fleet?.repairs || []).filter(r => r.id !== old),
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
              } else if (key === 'fleetRepairs') {
                const next = [...(db.fleet?.repairs || []).filter(r => r.id !== newRow.id), newRow];
                dispatch({ type: 'UPDATE_MODULE', mod: 'fleet', data: { ...(db.fleet || {}), repairs: next } });
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
    // production. It would also have silently reloaded the page on every
    // background TOKEN_REFRESHED (Supabase auto-refreshes the JWT well
    // before it expires), interrupting active work every time, even once
    // the startup loop was fixed.
    //
    // Only a genuine new sign-in should trigger this — matches the pattern
    // App.jsx already uses correctly for its own onAuthStateChange listener.
    const unsubAuth = supabaseAuthChange((event) => {
      if (event === 'SIGNED_IN') window.location.reload();
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

export async function pushAll(db) {
  if (!USE_PER_RECORD || !supabaseReady) return { ok: false, reason: 'per-record-sync-disabled' };
  return backfillFromBlob(db);
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
