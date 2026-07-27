// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Supabase Sync Engine  (v2.1)
//
// Architecture:
//   • Primary store:  Supabase (PostgreSQL JSONB — one row per company)
//   • Offline backup: localStorage (already in place)
//   • Sync queue:     Pending writes stored locally, flushed on reconnect
//   • Conflict:       See CONFLICT HANDLING below — this is NOT a full fix,
//     just a real safety net where none existed before.
//
// CONFLICT HANDLING (v2.1 change):
//   The previous version always upserted the full local snapshot, silently
//   overwriting whatever anyone else had saved since this client last loaded
//   — no check, no warning to either person. Two people editing at the same
//   time meant one of them lost their changes with no error shown.
//
//   This version tracks the server's `updated_at` timestamp for the row this
//   client last saw (LAST_SERVER_TS_KEY — the server's clock, not ours).
//   Before writing, it re-checks the server's current `updated_at` against
//   that value:
//     - Match (or first-ever save, nothing to compare against yet) → safe to
//       write, proceed.
//     - Mismatch → someone else saved in between. We do NOT overwrite. We
//       return { ok:false, conflict:true, serverData } so the caller
//       (App.jsx) can warn the user and let them reload before retrying.
//
//   This is a check-then-write, not an atomic compare-and-swap — there's a
//   small race window between the check and the upsert. For human-speed ERP
//   editing (not concurrent machine writes) this closes the large majority
//   of the risk. It does not replace real field-level merging, which needs
//   the normalized-tables rework already underway (see
//   003_per_record_tables.sql / syncPerRecord.js) — that's a separate,
//   larger project.
//
// Supabase table (run in SQL editor):
//   CREATE TABLE company_data (
//     id          TEXT PRIMARY KEY,         -- e.g. 'slot-engineering-nigeria'
//     db          JSONB    DEFAULT '{}',
//     acct_data   JSONB    DEFAULT '{}',
//     settings    JSONB    DEFAULT '{}',
//     activity    JSONB    DEFAULT '[]',
//     updated_at  TIMESTAMPTZ DEFAULT NOW()
//   );
//   ALTER TABLE company_data ENABLE ROW LEVEL SECURITY;
//   -- Then run 002_rls.sql — do NOT leave an "Allow all for now" policy in
//   -- place; that policy is not used by this file, it was a leftover note
//   -- from an earlier draft of this schema.
// ══════════════════════════════════════════════════════════════════════════════
import { supabase } from './client';

const COMPANY_ID        = import.meta.env.VITE_COMPANY_DOC || 'slot-engineering-nigeria';
const QUEUE_KEY         = 'bc_sync_queue';
const LAST_SYNC_KEY     = 'bc_last_sync';
const LAST_SERVER_TS_KEY = 'bc_last_server_ts'; // server's updated_at, NOT our clock
const TABLE             = 'company_data';

function getLastServerTs() { return localStorage.getItem(LAST_SERVER_TS_KEY) || null; }
function setLastServerTs(ts) { try { if (ts) localStorage.setItem(LAST_SERVER_TS_KEY, ts); } catch {} }

// ── Self-echo guard for the realtime channel ──────────────────────────────────
// Supabase Realtime fires postgres_changes for the writer's OWN save too, not
// just other clients' saves. We already know the exact `updated_at` we're
// about to write before the request even goes out, so we stash it here right
// before the upsert call — the realtime handler below compares against this
// to recognise "that's my own write coming back" and skip it, instead of only
// relying on LAST_SERVER_TS_KEY, which isn't set until AFTER the write
// resolves (a race the realtime push can and does win, especially with saves
// firing on every edit). This is separate from LAST_SERVER_TS_KEY on purpose:
// that value drives conflict detection and must only advance once a write is
// confirmed, not optimistically.
// CRITICAL FIX: previously a single `let pendingSelfWriteTs = null`. If save A
// was in flight (upsert sent, response not yet received) and save B started,
// B overwrote pendingSelfWriteTs with B's ts — then when A's realtime echo
// arrived, it was treated as a REMOTE change (A.ts !== B.ts), dispatching
// SET_DB / firing a misleading toast for the user's own write. Now we use a
// Set of pending timestamps and delete on match — multiple in-flight writes
// each get recognised as self-echoes. Cap at 50 to avoid unbounded growth if
// upserts silently fail.
const pendingSelfWriteTs = new Set();
function rememberPendingSelfWrite(ts) {
  if (!ts) return;
  pendingSelfWriteTs.add(ts);
  if (pendingSelfWriteTs.size > 50) {
    const toDrop = Array.from(pendingSelfWriteTs).slice(0, 25);
    toDrop.forEach(t => pendingSelfWriteTs.delete(t));
  }
}
function isPendingSelfWrite(ts) {
  if (pendingSelfWriteTs.has(ts)) {
    pendingSelfWriteTs.delete(ts);
    return true;
  }
  return false;
}

// ── Sync queue (offline pending writes) ───────────────────────────────────────
function loadQueue()      { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]'); } catch { return []; } }
function saveQueue(q)     { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch {} }
function clearQueue()     { try { localStorage.removeItem(QUEUE_KEY); } catch {} }
function enqueue(payload) {
  const q = loadQueue();
  // Only keep latest — we always push the full snapshot so older entries are stale
  saveQueue([{ payload, queuedAt: new Date().toISOString() }]);
}

// ── Network detection ─────────────────────────────────────────────────────────
export function isOnline() { return navigator.onLine; }

// ── Load from Supabase ────────────────────────────────────────────────────────
export async function loadFromSupabase() {
  if (!supabase || !isOnline()) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('db, acct_data, settings, activity, updated_at')
      .eq('id', COMPANY_ID)
      .single();

    if (error) {
      // PGRST116 = no rows found (new install) — not an error
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    setLastServerTs(data.updated_at || null);
    return {
      db:       data.db       || {},
      acctData: data.acct_data|| {},
      settings: data.settings || {},
      activity: data.activity || [],
      updatedAt: data.updated_at || null,
    };
  } catch (e) {
    console.warn('[SLOT ERP] Supabase load failed — using local data:', e.message);
    return null;
  }
}

// ── Save to Supabase ──────────────────────────────────────────────────────────
// Returns one of:
//   { ok:true,  queued:false }                          — saved successfully
//   { ok:false, queued:true  }                           — offline, queued for retry
//   { ok:false, conflict:true, serverData }              — someone else saved first;
//                                                          we did NOT overwrite them.
export async function saveToSupabase(db, acctData, settings, activity) {
  const payload = {
    id:         COMPANY_ID,
    db:         db       || {},
    acct_data:  acctData || {},
    settings:   settings || {},
    activity:   activity || [],
    updated_at: new Date().toISOString(),
  };

  if (!supabase || !isOnline()) {
    // Queue for later
    enqueue(payload);
    return { ok: false, queued: true };
  }

  try {
    // ── Conflict check ──────────────────────────────────────────────────────
    // FIX (T2-4): this used to be a separate check-then-write — a real,
    // if small, TOCTOU race window between the SELECT above and the UPSERT
    // below. Collapsed into one atomic conditional UPDATE: Postgres itself
    // enforces the compare-and-swap via the .eq('updated_at', expected)
    // clause, so there's no gap for another write to land in between.
    // Only meaningful once we've loaded at least once (getLastServerTs() is
    // null on a brand new install with nothing saved yet — nothing to
    // conflict with, so skip straight to an upsert).
    const expected = getLastServerTs();

    rememberPendingSelfWrite(payload.updated_at);

    if (expected) {
      const { data: updated, error: casErr } = await supabase
        .from(TABLE)
        .update(payload)
        .eq('id', COMPANY_ID)
        .eq('updated_at', expected)
        .select('updated_at');

      if (casErr) throw casErr;

      if (!updated || updated.length === 0) {
        // Nobody matched our CAS condition — someone else saved in between.
        pendingSelfWriteTs.delete(payload.updated_at);
        const { data: current } = await supabase
          .from(TABLE)
          .select('updated_at, db, acct_data, settings, activity')
          .eq('id', COMPANY_ID)
          .single();
        return {
          ok: false,
          conflict: true,
          serverData: current ? {
            db:        current.db        || {},
            acctData:  current.acct_data || {},
            settings:  current.settings  || {},
            activity:  current.activity  || [],
            updatedAt: current.updated_at,
          } : null,
        };
      }
    } else {
      // First-ever save — no row to CAS against yet.
      const { error } = await supabase
        .from(TABLE)
        .upsert(payload, { onConflict: 'id' });
      if (error) throw error;
    }

    clearQueue();
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    setLastServerTs(payload.updated_at);
    return { ok: true, queued: false };
  } catch (e) {
    console.warn('[SLOT ERP] Supabase save failed — queued for retry:', e.message);
    // The write never landed — clean up the Set so the stale ts doesn't
    // mask a future remote change with the same value (extremely unlikely
    // but defensive). The isPendingSelfWrite() already deletes on match,
    // this is just a belt-and-braces reset for the error path.
    pendingSelfWriteTs.clear();
    enqueue(payload);
    return { ok: false, queued: true };
  }
}

// ── Save settings only ────────────────────────────────────────────────────────
export async function saveSettingsToSupabase(settings) {
  if (!supabase || !isOnline()) return false;
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert({ id: COMPANY_ID, settings, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('[SLOT ERP] Settings sync failed:', e.message);
    return false;
  }
}

// ── Flush pending queue on reconnect ─────────────────────────────────────────
export async function flushQueue() {
  const queue = loadQueue();
  if (!queue.length || !supabase || !isOnline()) return false;

  try {
    const latest = queue[queue.length - 1]; // only need the most recent full snapshot
    const { error } = await supabase
      .from(TABLE)
      .upsert(latest.payload, { onConflict: 'id' });
    if (error) throw error;
    clearQueue();
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    console.info('[SLOT ERP] Offline queue flushed successfully');
    return true;
  } catch (e) {
    console.warn('[SLOT ERP] Queue flush failed:', e.message);
    return false;
  }
}

// ── Real-time subscription ────────────────────────────────────────────────────
// Call this after login. Resolves to an unsubscribe function.
//
// Subscribes to Supabase postgres_changes on the company_data row. When a
// DIFFERENT client writes, this fires `onRemoteChange` with the new row's
// payload. "Different client" is now decided by comparing the incoming
// updated_at against LAST_SERVER_TS_KEY — the exact server timestamp this
// client last recorded (from its own last load or its own last successful
// save) — rather than a fixed grace window against our local clock. A
// postgres_changes event also fires for the writer's own session, so this
// is what filters those self-echoes out; comparing exact server timestamp
// strings avoids the edge cases a fixed time window has under clock skew
// or slow connections.
//
// Concurrent-write safety: with the single-JSONB-blob schema this is
// inherently last-write-wins at the row level. The proper fix is per-record
// tables (see 003_per_record_tables.sql), at which point this same function
// routes through per-record channels and merges row-by-row. The signature
// and caller in App.jsx don't change — that's the point of centralising it
// here.
export function subscribeToChanges(onRemoteChange) {
  if (!supabase) return Promise.resolve(() => {});

  return new Promise((resolve) => {
    const channel = supabase
      .channel(`company-${COMPANY_ID}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: TABLE, filter: `id=eq.${COMPANY_ID}` },
        (payload) => {
          const incomingTs = payload.new?.updated_at || null;

          // Self-echo check FIRST: deterministic guard, see note above. If it
          // matches, this event is just our own write bouncing back — advance
          // the conflict-detection timestamp (the write really did land) but
          // don't surface it to the user as a "remote" change.
          if (incomingTs && isPendingSelfWrite(incomingTs)) {
            setLastServerTs(incomingTs);
            // Self-echo already consumed by isPendingSelfWrite() — just advance
            // the conflict-detection timestamp (the write really did land).
            // Do NOT clear pendingSelfWriteTs here; isPendingSelfWrite already did.
            return;
          }

          const knownTs = getLastServerTs();
          if (incomingTs && incomingTs !== knownTs) {
            setLastServerTs(incomingTs);
            try {
              onRemoteChange({
                db:        payload.new?.db        || {},
                acctData:  payload.new?.acct_data || {},
                settings:  payload.new?.settings  || {},
                activity:  payload.new?.activity  || [],
                updatedAt: incomingTs,
              });
            } catch (e) {
              console.warn('[SLOT] Real-time handler threw:', e?.message || e);
            }
          }
        }
      )
      .subscribe((status) => {
        // Resolve the unsubscribe handle as soon as the channel is ready
        // (or has failed — caller still gets an unsubscribe that no-ops).
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          resolve(() => {
            try { supabase.removeChannel(channel); } catch {}
          });
        }
      });
  });
}

// ── Pending queue info (for UI badge) ─────────────────────────────────────────
export function getPendingCount() { return loadQueue().length; }
export function getLastSyncTime() {
  const ts = localStorage.getItem(LAST_SYNC_KEY);
  return ts ? new Date(ts) : null;
}
