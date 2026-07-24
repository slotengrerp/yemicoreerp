// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Edge Function: update-user-password
// ══════════════════════════════════════════════════════════════════════════════
// Lets an authenticated, active admin set a NEW password for another user's
// Supabase Auth account. This mirrors create-user/index.ts: the service
// role key needed for supabase.auth.admin.updateUserById() lives only here,
// server-side — it never reaches the browser.
//
// IMPORTANT: this function re-verifies the CALLER is an active admin using
// their own JWT before doing anything privileged. A client-side role check
// is not sufficient on its own — someone could call this function directly
// with a valid-but-non-admin token if the server didn't check too.
//
// Deploy with:
//   supabase functions deploy update-user-password
//
// Required environment variables (set automatically by Supabase, or via
// `supabase secrets set` if running locally):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (server-side only — never expose to client)
// ══════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

// FIX (T3-1): every response used to go out with a hardcoded
// 'Access-Control-Allow-Origin': '*' here, completely bypassing the
// ALLOWED_ORIGINS allowlist built above — that allowlist only ever
// protected the empty OPTIONS preflight response, not the actual data.
// json() now takes req and reuses corsHeaders(req), matching notify/index.ts.
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json(req, { error: 'Missing Authorization header' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return json(req, { error: 'Server misconfigured — missing Supabase env vars' }, 500);
    }

    // Client scoped to the CALLER's own JWT — used only to identify who is calling.
    // IMPORTANT: uses the ANON key (not the service-role key) so this client is
    // subject to RLS. If we used the service-role key here, any future logging
    // or debugging that exposed this client object would leak the service-role
    // key to function logs — a critical secret. The anon key is publishable.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: callerAuth, error: callerAuthError } = await callerClient.auth.getUser();
    if (callerAuthError || !callerAuth?.user) {
      return json(req, { error: 'Could not verify caller identity' }, 401);
    }

    // Admin client for privileged operations (service role — bypasses RLS)
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Re-verify server-side that the caller is an active admin — do NOT
    // trust anything the client claims about its own role.
    const { data: callerProfile, error: callerProfileError } = await adminClient
      .from('app_users')
      .select('role, status')
      .eq('auth_user_id', callerAuth.user.id)
      .single();

    if (callerProfileError || !callerProfile) {
      return json(req, { error: 'Caller has no linked SLOT ERP profile' }, 403);
    }
    if (callerProfile.role !== 'admin' || callerProfile.status !== 'Active') {
      return json(req, { error: 'Only active admins can change another user\'s password' }, 403);
    }

    const { authUserId, newPassword } = await req.json();

    if (!authUserId || !newPassword) {
      return json(req, { error: 'authUserId and newPassword are required' }, 400);
    }
    if (typeof newPassword !== 'string' || newPassword.length < 12) {
      return json(req, { error: 'Password must be at least 12 characters' }, 400);
    }
    // Enforce complexity — upper, lower, and a digit or symbol. Matches the
    // client-side validatePassword() helper in src/utils/auth.js.
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9!@#$%^&*()_+]/.test(newPassword)) {
      return json(req, { error: 'Password must contain uppercase, lowercase, and a digit or symbol' }, 400);
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(authUserId, {
      password: newPassword,
    });

    if (updateError) {
      return json(req, { error: updateError.message }, 400);
    }

    return json(req, { success: true });
  } catch (err) {
    return json(req, { error: err?.message || 'Unexpected server error' }, 500);
  }
});
