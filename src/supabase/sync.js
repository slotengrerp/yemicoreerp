// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Supabase Sync Engine
//
// Architecture:
//   • Primary store:  Supabase (PostgreSQL JSONB — one row per company)
//   • Offline backup: localStorage (already in place)
//   • Sync queue:     Pending writes stored locally, flushed on reconnect
//   • Conflict:       Last-write-wins with timestamp. Server wins on conflict.
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
//   CREATE POLICY "Allow all for now"
//     ON company_data FOR ALL USING (true) WITH CHECK (true);
// ══════════════════════════════════════════════════════════════════════════════
import { supabase } from './client';

const COMPANY_ID   = import.meta.env.VITE_COMPANY_DOC || 'slot-engineering-nigeria';
const QUEUE_KEY    = 'bc_sync_queue';
const LAST_SYNC_KEY= 'bc_last_sync';
const TABLE        = 'company_data';

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
    return {
      db:       data.db       || {},
      acctData: data.acct_data|| {},
      settings: data.settings || {},
      activity: data.activity || [],
    };
  } catch (e) {
    console.warn('[BizCore] Supabase load failed — using local data:', e.message);
    return null;
  }
}

// ── Save to Supabase ──────────────────────────────────────────────────────────
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
    const { error } = await supabase
      .from(TABLE)
      .upsert(payload, { onConflict: 'id' });

    if (error) throw error;

    clearQueue();
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    return { ok: true, queued: false };
  } catch (e) {
    console.warn('[BizCore] Supabase save failed — queued for retry:', e.message);
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
    console.warn('[BizCore] Settings sync failed:', e.message);
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
    console.info('[BizCore] Offline queue flushed successfully');
    return true;
  } catch (e) {
    console.warn('[BizCore] Queue flush failed:', e.message);
    return false;
  }
}

// ── Real-time subscription ────────────────────────────────────────────────────
// Call this after login. Returns an unsubscribe function.
export function subscribeToChanges(onRemoteChange) {
  if (!supabase) return () => {};

  const channel = supabase
    .channel(`company-${COMPANY_ID}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: TABLE, filter: `id=eq.${COMPANY_ID}` },
      (payload) => {
        // Only fire if the change originated from a DIFFERENT client
        // (simple guard: check updated_at vs our last sync)
        const serverTs  = new Date(payload.new?.updated_at || 0).getTime();
        const ourLastTs = new Date(localStorage.getItem(LAST_SYNC_KEY) || 0).getTime();
        if (serverTs > ourLastTs + 2000) {   // 2s grace window
          onRemoteChange({
            db:       payload.new.db       || {},
            acctData: payload.new.acct_data|| {},
            settings: payload.new.settings || {},
            activity: payload.new.activity || [],
          });
        }
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// ── Pending queue info (for UI badge) ─────────────────────────────────────────
export function getPendingCount() { return loadQueue().length; }
export function getLastSyncTime() {
  const ts = localStorage.getItem(LAST_SYNC_KEY);
  return ts ? new Date(ts) : null;
}
