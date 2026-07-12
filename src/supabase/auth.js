// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Supabase Auth Bridge v1.0
// ══════════════════════════════════════════════════════════════════════════════
// This is the NEW login path, added alongside the existing utils/auth.js
// (not replacing it yet). It exists so we can test real Supabase Auth
// end-to-end before switching App.jsx's login screen over to it.
//
// HOW THIS FITS WITH THE EXISTING ROLE SYSTEM:
//   - Supabase Auth (this file)   → handles password + session ONLY
//   - app_users table (Postgres)  → holds role, modules, company_id, status
//   - utils/auth.js's ROLE_PERMS, canDo(), visibleModules() → UNCHANGED,
//     still the source of truth for what a role is allowed to do
//
// A signed-in user's full app-level profile is fetched from `app_users` by
// matching `auth_user_id = auth.uid()`, then merged into the same shape the
// rest of the app already expects ({ id, name, username, role, modules }),
// so existing components don't need to change.
// ══════════════════════════════════════════════════════════════════════════════

import { supabase } from './client';

/**
 * Sign in with email + password via Supabase Auth, then load this user's
 * SLOT ERP profile (role, modules, company) from the app_users table.
 *
 * Returns { success: true, user } on success, matching the shape the old
 * utils/auth.js login() returned, so App.jsx's onLogin handler needs no change.
 */
export async function signInWithSupabase(email, password) {
  if (!supabase) {
    return { success: false, error: 'Supabase is not configured (check .env)' };
  }

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (authError) {
    // Surface a clean message — Supabase's raw error text is technical
    const friendly = authError.message.includes('Invalid login')
      ? 'Invalid email or password'
      : authError.message;
    return { success: false, error: friendly };
  }

  // Auth succeeded — now load the app-level profile (role, modules, company)
  const { data: profile, error: profileError } = await supabase
    .from('app_users')
    .select('id, company_id, username, name, role, modules, status')
    .eq('auth_user_id', authData.user.id)
    .single();

  if (profileError || !profile) {
    // Auth account exists but has no matching app_users row — this means
    // an admin created the Supabase Auth login but never linked it to an
    // app_users record. Sign them back out so they're not left half-logged-in.
    await supabase.auth.signOut();
    return {
      success: false,
      error: 'Your login was verified but no SLOT ERP profile is linked to it. Contact your administrator.',
    };
  }

  if (profile.status !== 'Active') {
    await supabase.auth.signOut();
    return { success: false, error: 'This account has been deactivated. Contact your administrator.' };
  }

  // Shape matches what the rest of the app already expects from a "user" object
  const user = {
    id: profile.id,
    companyId: profile.company_id,
    name: profile.name,
    username: profile.username,
    role: profile.role,
    modules: profile.modules || [],
  };

  return { success: true, user };
}

/** Sign out of Supabase Auth (clears the real session, not just localStorage). */
export async function signOutOfSupabase() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/**
 * Restore a session on page load. Call this once at app boot, BEFORE
 * checking the old localStorage-based getSession(), so a real Supabase
 * session takes priority once this path is fully switched on.
 *
 * Returns the same { id, companyId, name, username, role, modules } shape
 * as signInWithSupabase, or null if there's no active session.
 */
export async function restoreSupabaseSession() {
  if (!supabase) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.user) return null;

  const { data: profile, error } = await supabase
    .from('app_users')
    .select('id, company_id, username, name, role, modules, status')
    .eq('auth_user_id', sessionData.session.user.id)
    .single();

  if (error || !profile || profile.status !== 'Active') return null;

  return {
    id: profile.id,
    companyId: profile.company_id,
    name: profile.name,
    username: profile.username,
    role: profile.role,
    modules: profile.modules || [],
  };
}

/**
 * Admin-only: create a brand new login. This creates BOTH the Supabase Auth
 * account (email+password) AND the linked app_users row in one call, so
 * admins never have to deal with the two-table linkage manually.
 *
 * Requires the caller to already be signed in as an admin — RLS on
 * app_users blocks non-admins from inserting new rows (see 002_row_level_security.sql).
 */
export async function createSupabaseUser({ email, password, name, username, role, modules, companyId }) {
  if (!supabase) return { success: false, error: 'Supabase is not configured' };

  // Step 1 — create the Auth account.
  // Note: signUp() on the client creates the account AND signs in as them,
  // which would kick the admin out of their own session. We use Supabase's
  // admin API for this in production (via an Edge Function with the service
  // role key, never exposed to the browser) — see AUTH_SETUP_NOTES.md.
  // For now this client-side version is for initial setup/testing only.
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
  });
  if (authError) return { success: false, error: authError.message };

  // Step 2 — link the app_users row
  const { data: profile, error: profileError } = await supabase
    .from('app_users')
    .insert({
      company_id: companyId,
      auth_user_id: authData.user.id,
      username,
      name,
      role,
      modules: modules || [],
      status: 'Active',
    })
    .select()
    .single();

  if (profileError) return { success: false, error: profileError.message };
  return { success: true, profile };
}
