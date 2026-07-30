// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Supabase Auth Bridge v1.1
// ══════════════════════════════════════════════════════════════════════════════
// This is the login + user-management path used throughout the app.
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
//
// v1.1 adds: onSupabaseAuthChange, requestPasswordReset, fetchAppUsers,
// updateUserProfile, updateUserPassword — completing the migration of the
// Users module off the old local getUsers()/saveUsers()/hashPassword()
// store in utils/auth.js (that store no longer exists; see the comment
// block at the top of utils/auth.js).
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
 * Subscribe to Supabase Auth state changes (SIGNED_IN, SIGNED_OUT,
 * TOKEN_REFRESHED, USER_UPDATED, etc). Call once at app boot, typically
 * right after restoreSupabaseSession(), so App.jsx stays in sync if the
 * session changes in another tab or expires server-side.
 *
 * callback receives (event, session) exactly as Supabase provides them —
 * App.jsx decides what to do with each event (e.g. re-run
 * restoreSupabaseSession() on SIGNED_IN, clear currentUser on SIGNED_OUT).
 *
 * Returns an unsubscribe function. Call it in a useEffect cleanup:
 *   useEffect(() => {
 *     const unsubscribe = onSupabaseAuthChange((event, session) => { ... });
 *     return unsubscribe;
 *   }, []);
 */
export function onSupabaseAuthChange(callback) {
  if (!supabase) return () => {};
  const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return () => listener?.subscription?.unsubscribe();
}

/**
 * Send a Supabase password-reset email to the given address. The user
 * clicks the link in the email and is taken to redirectTo (defaults to
 * the current app origin), where your reset-password screen should call
 * supabase.auth.updateUser({ password }) to finish the flow.
 *
 * Used both for "Forgot password?" on LoginScreen and for the admin-side
 * "Send Password Reset Email" action in Users.jsx.
 */
export async function requestPasswordReset(email, redirectTo) {
  if (!supabase) return { success: false, error: 'Supabase is not configured' };

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: redirectTo || `${window.location.origin}/reset-password`,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Admin-only: create a brand new login — both the Supabase Auth account
 * (email+password) AND the linked app_users row, in one call, via the
 * create-user Edge Function (supabase/functions/create-user/index.ts).
 * The service role key this needs never reaches the browser — it lives
 * only in the Edge Function's server-side environment.
 *
 * Requires the caller to already be signed in via Supabase Auth as an
 * active admin — the Edge Function itself re-checks this server-side
 * before doing anything privileged, so this isn't just a client-side gate.
 */
export async function createUserWithCloudLogin({ email, password, name, username, phone, role, modules }) {
  if (!supabase) return { success: false, error: 'Supabase is not configured' };

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) {
    return { success: false, error: 'You must be signed in via cloud login to create a cloud login for someone else' };
  }

  const { data, error } = await supabase.functions.invoke('create-user', {
    body: { email, password, name, username, phone, role, modules },
  });

  if (error) {
    // On a non-2xx response, supabase-js puts the raw Response on
    // error.context — the Edge Function's own { error: "..." } body is in
    // there, not in error.message (which is just "non-2xx status code").
    let message = error.message || 'Could not create the user';
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // error.context wasn't parseable JSON (e.g. a network-level failure
      // rather than the function itself returning an error) — keep the
      // generic message above.
    }
    return { success: false, error: message };
  }

  if (data?.error) return { success: false, error: data.error };
  return { success: true, profile: data.profile };
}

/**
 * Fetch every app_users row, for the Users admin screen. This is the
 * single source of truth the table lists from — there is no local
 * getUsers()/saveUsers() store anymore.
 *
 * NOTE: relies on Row Level Security allowing an active admin to select
 * all rows in app_users (not just their own). If your RLS policy only
 * allows a user to select their own row, you'll need an admin-scoped
 * policy (e.g. "allow select where requesting user's app_users.role =
 * 'admin'") for this to return the full list.
 */
export async function fetchAppUsers() {
  if (!supabase) return { success: false, error: 'Supabase is not configured', users: [] };

  const { data, error } = await supabase
    .from('app_users')
    .select('id, company_id, auth_user_id, username, name, email, phone, role, modules, status, created_at')
    .order('created_at', { ascending: true });

  if (error) return { success: false, error: error.message, users: [] };
  return { success: true, users: data || [] };
}

/**
 * Update an existing user's profile fields (name, phone, role, modules,
 * status). This is a direct table update, not an Edge Function — it does
 * NOT touch Supabase Auth or the password, only the app_users row.
 *
 * Relies on RLS allowing an active admin to update other users' rows.
 */
export async function updateUserProfile(userId, updates) {
  if (!supabase) return { success: false, error: 'Supabase is not configured' };

  const { data, error } = await supabase
    .from('app_users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, profile: data };
}

/**
 * Admin-only: create a new user. Same as createUserWithCloudLogin — kept
 * as a separate exported name because Users.jsx v2.0 imports it as
 * createSupabaseUser. Both names point at the same implementation so
 * either import works.
 */
export async function createSupabaseUser(args) {
  return createUserWithCloudLogin(args);
}

/**
 * Admin-only: update an existing user's profile fields (name, phone,
 * role, modules, status). Same as updateUserProfile — kept as a separate
 * exported name because Users.jsx v2.0 imports it as updateSupabaseUser
 * and calls it as updateSupabaseUser(userId, updates).
 *
 * This is still a direct app_users table update via RLS, not routed
 * through an Edge Function — but as of migration 012
 * (012_diagnostic_audit_hardening.sql, live on the production project as
 * of 2026-07-29), demoting or deactivating the LAST active admin for a
 * company is blocked server-side regardless of this function's own logic:
 * `trg_app_users_prevent_last_admin_lockout` (BEFORE UPDATE OF role,
 * status OR DELETE on app_users) raises a Postgres exception before the
 * write lands. supabase-js surfaces that as a normal `error.message` here
 * — the caller gets back { success: false, error: 'Cannot remove or
 * demote the last active admin for this company — promote another user
 * to admin first, then try again.' } — same shape as any other failed
 * update, no special-case handling needed in Users.jsx. Verified live
 * against the real slot-engineering-nigeria company (which currently has
 * exactly one active admin) inside a rolled-back transaction.
 */
export async function updateSupabaseUser(userId, updates) {
  return updateUserProfile(userId, updates);
}

/** Admin-only: set a user's app_users.status to 'Inactive'. */
export async function disableSupabaseUser(userId) {
  return updateUserProfile(userId, { status: 'Inactive' });
}

/** Admin-only: set a user's app_users.status back to 'Active'. */
export async function enableSupabaseUser(userId) {
  return updateUserProfile(userId, { status: 'Active' });
}

/**
 * Admin-only: send a password-reset EMAIL to a user, looked up by their
 * app_users.id (not their Supabase Auth UUID). This does NOT set a new
 * password directly and does NOT require an Edge Function or service
 * role — supabase.auth.resetPasswordForEmail() is a public, anon-key-safe
 * call. The user clicks the emailed link and sets their own new password.
 *
 * For an admin to set a password directly instead (no email round-trip),
 * use updateUserPassword() below, which does go through the
 * update-user-password Edge Function.
 */
export async function adminResetPassword(userId) {
  if (!supabase) return { success: false, error: 'Supabase is not configured' };

  const { data: user, error: lookupError } = await supabase
    .from('app_users')
    .select('email')
    .eq('id', userId)
    .single();

  if (lookupError || !user?.email) {
    return { success: false, error: 'Could not find this user\'s email address' };
  }

  return requestPasswordReset(user.email);
}

/**
 * Admin-only: set a NEW password for an existing user, via the
 * update-user-password Edge Function (supabase/functions/update-user-password/index.ts).
 * Mirrors createUserWithCloudLogin — the service role key needed to call
 * supabase.auth.admin.updateUserById() never reaches the browser, and the
 * Edge Function re-verifies the caller is an active admin server-side.
 *
 * targetAuthUserId is the Supabase Auth UUID (app_users.auth_user_id) of
 * the user whose password is being changed — NOT the app_users.id.
 */
export async function updateUserPassword(targetAuthUserId, newPassword) {
  if (!supabase) return { success: false, error: 'Supabase is not configured' };

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) {
    return { success: false, error: 'You must be signed in via cloud login to change another user\'s password' };
  }

  if (!targetAuthUserId) {
    return { success: false, error: 'This user has no cloud login yet — nothing to update. Create one first.' };
  }

  const { data, error } = await supabase.functions.invoke('update-user-password', {
    body: { authUserId: targetAuthUserId, newPassword },
  });

  if (error) {
    let message = error.message || 'Could not update the password';
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // not parseable — keep generic message
    }
    return { success: false, error: message };
  }

  if (data?.error) return { success: false, error: data.error };
  return { success: true };
}
