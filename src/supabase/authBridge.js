// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Auth Bridge for cross-cutting auth consumers
//
// A tiny, non-module-globally-instanced wrapper around Supabase auth that
// lets hooks (usePerRecordSync etc.) observe sign-in / sign-out events
// without each one re-subscribing to the same channel.
//
// The actual Supabase session API is fully encapsulated in supabase/auth.js
// for the LoginScreen / Users module flows. This file is the lightweight
// observable layer other parts of the app can hook into.
// ══════════════════════════════════════════════════════════════════════════════
import { supabase, supabaseReady } from './client';

const listeners = new Set();
let bootstrapped = false;
let currentSession = null;

function notify(event, session) {
  currentSession = session;
  for (const l of listeners) {
    try { l(event, session); } catch (e) { console.warn('[SLOT] authBridge listener:', e); }
  }
}

function bootstrap() {
  if (bootstrapped || !supabaseReady) return;
  bootstrapped = true;
  // Pull the current session once
  supabase.auth.getSession().then(({ data }) => {
    currentSession = data?.session || null;
  }).catch(() => {});
  // Subscribe to changes
  supabase.auth.onAuthStateChange((event, session) => notify(event, session));
}

bootstrap();

export function supabaseAuthChange(handler) {
  listeners.add(handler);
  // Replay current state so consumers don't have to wait for the next event
  if (currentSession) {
    try { handler('INITIAL', currentSession); } catch {}
  }
  return () => listeners.delete(handler);
}

export async function getSupabaseSession() {
  if (!supabaseReady) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session || null;
  } catch {
    return null;
  }
}
