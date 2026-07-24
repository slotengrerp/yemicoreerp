// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Supabase Client
// Online-first with localStorage offline fallback.
// If Supabase is unreachable the app continues fully on local data.
//
// AUTH NOTE (added during database normalization, step: Supabase Auth):
// persistSession is now TRUE. Real Supabase Auth sessions are required for
// the Row Level Security policies in supabase/sql/002_row_level_security.sql
// to work — those policies check auth.uid(), which only exists once a user
// has signed in through supabase.auth, not through the old custom localStorage
// login. The app's own role/permission system (ROLE_PERMS, canDo, etc in
// utils/auth.js) is unchanged — only the password+session mechanism moves
// to Supabase.
// ══════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  || '';
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Export null-safe client — all callers guard with `if (!supabase) return null`
export const supabase = SUPABASE_URL && SUPABASE_ANON
  ? createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: {
        persistSession: true,        // Supabase now manages the session (was false)
        autoRefreshToken: true,      // keep the session alive without re-login
        storageKey: 'slot-erp-auth', // distinct key so it never collides with old session data
      },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

export const supabaseReady = !!supabase;
