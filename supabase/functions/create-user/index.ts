// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering ERP — create-user Edge Function
//
// This is the piece referenced (but never built) in the old comment in
// src/supabase/auth.js: "we use Supabase's admin API for this in production
// via an Edge Function with the service role key, never exposed to the
// browser". That client-side-only version used auth.signUp(), which signs
// the CALLER's own browser in as the new user — fine for nothing, dangerous
// for an admin trying to add a colleague without losing their own session.
//
// This function does the two things that actually require elevated
// privileges, server-side, where the service role key can never reach a
// browser:
//   1. auth.admin.createUser()  — creates the real login (email+password),
//      auto-confirmed, without touching the caller's own session at all.
//   2. INSERT into app_users    — links auth_user_id → the new login, with
//      the role/modules/company_id the rest of the app already expects
//      (see src/utils/auth.js's ROLE_PERMS and 001_schema.sql's app_users).
//
// Anyone can technically call this endpoint (Edge Functions are public
// HTTPS URLs), so the FIRST thing it does is verify the CALLER is a
// signed-in, active admin — before touching anything privileged. A request
// with no valid session, or a valid session that isn't an admin, is
// rejected before the service-role client is ever used for a write.
//
// DEPLOY:
//   supabase functions deploy create-user
//   (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are provided
//   automatically by Supabase — nothing to configure by hand.)
// ══════════════════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2';

// FIX (2026-07-27 diagnostic audit, SEC-3): this function was the only one of
// the three Edge Functions still using a wildcard CORS origin — its siblings
// (update-user-password, notify) were already hardened to an allowlist.
// Not independently exploitable on its own (every privileged call below still
// requires a valid bearer token a third-party site can't forge), but brought
// in line for consistent defense-in-depth.
const ALLOWED_ORIGINS = [
  'https://erp.slotengineering.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

const VALID_ROLES = ['admin', 'manager', 'accountant', 'cashier', 'viewer'];

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  // FIX (T3-2): `!` non-null assertions did nothing at runtime — if a secret
  // was actually missing, createClient() got called with `undefined` and
  // failed later with a confusing error instead of a clean 500.
  // notify/index.ts already had this guard; this brings create-user in line.
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return json(req, { error: 'Server misconfigured — missing Supabase env vars' }, 500);
  }

  // FIX (T3-2): the entire body below was NOT wrapped in try/catch. Any
  // unexpected throw (a network blip calling auth.getUser(), the app_users
  // select, etc.) became an unhandled rejection — Deno's default handler
  // returns a raw, un-CORS'd response, which surfaces to the browser as an
  // opaque "CORS error" with no usable message, and can leak a stack trace.
  try {
    // ── Step 1: who is calling? ────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(req, { error: 'Missing Authorization header — sign in and try again' }, 401);

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) return json(req, { error: 'Your session has expired — sign in again' }, 401);

    // Elevated client — only reached after the caller above is verified.
    // SERVICE_ROLE_KEY lives only here, server-side; it is never sent to,
    // stored in, or reachable from the browser.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile, error: callerProfileErr } = await adminClient
      .from('app_users')
      .select('role, status, company_id')
      .eq('auth_user_id', caller.id)
      .single();

    if (callerProfileErr || !callerProfile) {
      return json(req, { error: 'No SLOT ERP profile is linked to your account' }, 403);
    }
    if (callerProfile.status !== 'Active') {
      return json(req, { error: 'Your account is not active' }, 403);
    }
    if (callerProfile.role !== 'admin') {
      return json(req, { error: 'Only admins can create new users' }, 403);
    }

    // ── Step 2: validate the request ───────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(req, { error: 'Invalid request body' }, 400);
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const role = typeof body.role === 'string' ? body.role : 'viewer';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : null;
    const modules = Array.isArray(body.modules) ? body.modules : [];
    const username = (typeof body.username === 'string' && body.username.trim()
      ? body.username.trim()
      : email.split('@')[0]
    ).toLowerCase().replace(/[^a-z0-9._]/g, '');

    if (!email || !password || !name) {
      return json(req, { error: 'Name, email, and password are required' }, 400);
    }
    if (password.length < 12) {
      return json(req, { error: 'Password must be at least 12 characters' }, 400);
    }
    // Enforce complexity — upper, lower, and a digit or symbol. Matches the
    // client-side validatePassword() helper in src/utils/auth.js.
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9!@#$%^&*()_+]/.test(password)) {
      return json(req, { error: 'Password must contain uppercase, lowercase, and a digit or symbol' }, 400);
    }
    if (!VALID_ROLES.includes(role)) {
      return json(req, { error: `Role must be one of: ${VALID_ROLES.join(', ')}` }, 400);
    }

    // ── Step 3: create the real Auth account ───────────────────────────────
    // email_confirm: true — they can sign in immediately, no confirmation
    // email step (matches how the local-only path has always worked).
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr) {
      const msg = /already.*registered|already exists/i.test(createErr.message || '')
        ? 'A login already exists for this email'
        : createErr.message;
      return json(req, { error: msg }, 400);
    }

    // ── Step 4: link the app_users row ─────────────────────────────────────
    const { data: profile, error: linkErr } = await adminClient
      .from('app_users')
      .insert({
        company_id: callerProfile.company_id,
        auth_user_id: created.user.id,
        username,
        name,
        email,
        phone,
        role,
        modules,
        status: 'Active',
      })
      .select()
      .single();

    if (linkErr) {
      // FIX (T3-3): the compensating delete used to be fire-and-forget — if
      // it also failed, you'd end up with an orphaned Auth account (valid
      // credentials, no company/role/profile) and the caller would see the
      // same generic error as an ordinary validation failure, with no way
      // to tell the difference. True DB transactions can't span GoTrue
      // (Auth) and Postgres here, so the fix is verifying the rollback and
      // surfacing a distinct, actionable error when it fails — not "wrap it
      // in a transaction".
      const { error: rollbackErr } = await adminClient.auth.admin.deleteUser(created.user.id);
      if (rollbackErr) {
        console.error(`[create-user] ORPHANED AUTH ACCOUNT ${created.user.id} (${email}) — app_users insert failed AND rollback delete failed: ${rollbackErr.message}`);
        return json(req, { error: `Account creation failed and cleanup also failed — contact support with this email: ${email}` }, 500);
      }
      const msg = /duplicate/i.test(linkErr.message || '')
        ? 'A profile already exists for this email'
        : linkErr.message;
      return json(req, { error: msg }, 400);
    }

    return json(req, { success: true, profile });
  } catch (err) {
    console.error('create-user error:', err);
    return json(req, { error: err?.message || 'Unexpected server error' }, 500);
  }
});
