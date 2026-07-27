// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Notification Edge Function (HARDENED)
//
// Supabase Edge Function (Deno runtime). Deployed via:
//   supabase functions deploy notify --no-verify-jwt
//
// Secrets required (set via `supabase secrets set`):
//   SENDGRID_API_KEY    — for email
//   TWILIO_ACCOUNT_SID  — for SMS/WhatsApp
//   TWILIO_AUTH_TOKEN   — for SMS/WhatsApp
//   TWILIO_FROM_SMS     — e.g. "+15555550100"
//   TWILIO_FROM_WA      — e.g. "whatsapp:+14155238886"
//
// SECURITY: this function is invoked with --no-verify-jwt so it can read the
// caller's Authorization header itself. The FIRST thing it does is verify
// the caller has a valid Supabase session AND an active app_users row in
// the company. Without this check, the function URL was an open relay:
// anyone with the URL could send emails/SMS via the company's SendGrid /
// Twilio account, drain the budget, send phishing emails branded as SLOT
// Engineering, and get the company's email domain blacklisted.
//
// The function also:
//   • Validates event.link to be a relative path (blocks XSS via href)
//   • Validates event.to.email is a known user in the caller's company
//   • Caps subject (200) and body (4 KB) length
//   • Strips CR/LF from email headers (blocks header injection)
// ══════════════════════════════════════════════════════════════════════════════

// @ts-nocheck — Deno edge runtime, type-checked on deploy

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// erp.slotengineering.com is the intended long-term custom domain, but the
// app is served from Firebase Hosting today (yemicoreerp.web.app is the URL
// SLOT are testing on) — and until 2026-07-27 neither Firebase domain was on
// this list, so every call from the live site was blocked by CORS. Firebase
// serves the same site on both .web.app and .firebaseapp.com, so both are
// listed. Trim this back once the custom domain is live.
const ALLOWED_ORIGINS = [
  'https://erp.slotengineering.com',
  'https://yemicoreerp.web.app',
  'https://yemicoreerp.firebaseapp.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

  try {
    // ── Step 1: verify the caller is a signed-in active user ────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(req, { error: 'Missing Authorization header' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY');
    if (!SUPABASE_URL || !ANON_KEY) {
      return json(req, { error: 'Server misconfigured — missing Supabase env vars' }, 500);
    }

    // Client scoped to the caller's own JWT — used only to identify the caller.
    // We deliberately use the ANON key (not the service role key) so this
    // client is subject to RLS. If a future RLS misconfiguration accidentally
    // exposes app_users rows, this client will see the same restricted view
    // a normal user would — defence in depth.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !caller) {
      return json(req, { error: 'Invalid or expired session — sign in again' }, 401);
    }

    // Look up the caller's app_users row — confirms they're Active AND
    // gives us their company_id so we can scope recipient validation.
    const { data: callerProfile, error: profileErr } = await callerClient
      .from('app_users')
      .select('id, name, role, status, company_id')
      .eq('auth_user_id', caller.id)
      .single();

    if (profileErr || !callerProfile) {
      return json(req, { error: 'No SLOT ERP profile linked to your account' }, 403);
    }
    if (callerProfile.status !== 'Active') {
      return json(req, { error: 'Your account is not active' }, 403);
    }

    // ── Step 2: parse + validate the request body ───────────────────────────
    // FIX (T3-5): a malformed body used to fall through to the outer catch
    // and come back as a 500 (server error) instead of a 400 (client error)
    // — that matters for monitoring/alerting and for callers that treat 5xx
    // as safe to retry.
    let body;
    try {
      body = await req.json();
    } catch {
      return json(req, { error: 'Invalid request body' }, 400);
    }
    const { channel, event } = body || {};
    if (!channel || !event) {
      return json(req, { error: 'channel and event required' }, 400);
    }

    // Cap subject / body to prevent abuse (4 KB body, 200 char subject)
    const sanitizedEvent = {
      ...event,
      subject: typeof event.subject === 'string' ? event.subject.slice(0, 200) : 'Notification',
      body:    typeof event.body    === 'string' ? event.body.slice(0, 4096)   : '',
    };

    // Validate event.link — must be a relative path starting with /, no
    // protocol, no backslashes, no javascript: URLs. Anything else gets
    // dropped silently (the email still sends, just without the link).
    if (sanitizedEvent.link != null) {
      if (typeof sanitizedEvent.link !== 'string' || !/^\/[a-zA-Z0-9._\-/?=&%]*$/.test(sanitizedEvent.link)) {
        delete sanitizedEvent.link;
      }
    }

    // ── Step 3: validate the recipient is in the caller's company ───────────
    // For email: look up app_users by email within the same company. Blocks
    // arbitrary external recipients — an accountant can no longer use the
    // company's SendGrid account to email non-employees.
    if (channel === 'email') {
      const toEmail = String(sanitizedEvent.to?.email || '').trim().toLowerCase();
      if (!toEmail) return json(req, { error: 'event.to.email required' }, 400);
      // Strip CR/LF — defends against SMTP header injection in the To field
      const safeEmail = toEmail.replace(/[\r\n]/g, '');
      if (safeEmail !== toEmail) {
        return json(req, { error: 'Invalid recipient email' }, 400);
      }
      const { data: recipient, error: recipErr } = await callerClient
        .from('app_users')
        .select('id, status')
        .eq('company_id', callerProfile.company_id)
        .ilike('email', safeEmail)
        .limit(1);
      if (recipErr || !recipient || recipient.length === 0) {
        return json(req, { error: 'Recipient is not a user in your company' }, 403);
      }
      sanitizedEvent.to = { ...sanitizedEvent.to, email: safeEmail };
    } else if (channel === 'sms' || channel === 'whatsapp') {
      const toPhone = String(sanitizedEvent.to?.phone || '').trim();
      if (!toPhone) return json(req, { error: `event.to.phone required` }, 400);
      // Basic E.164-ish validation — digits, +, spaces, dashes. No letters.
      if (!/^\+?[0-9][0-9\-\s]{6,19}$/.test(toPhone)) {
        return json(req, { error: 'Invalid recipient phone format' }, 400);
      }
      // Phone recipients also must be app_users in the same company.
      const { data: recipient, error: recipErr } = await callerClient
        .from('app_users')
        .select('id, status')
        .eq('company_id', callerProfile.company_id)
        .eq('phone', toPhone)
        .limit(1);
      if (recipErr || !recipient || recipient.length === 0) {
        return json(req, { error: 'Recipient phone is not a user in your company' }, 403);
      }
      sanitizedEvent.to = { ...sanitizedEvent.to, phone: toPhone };
    }

    // ── Step 4: dispatch ────────────────────────────────────────────────────
    let result;
    switch (channel) {
      case 'email':    result = await sendEmail(sanitizedEvent); break;
      case 'sms':      result = await sendSMS(sanitizedEvent);   break;
      case 'whatsapp': result = await sendWhatsApp(sanitizedEvent); break;
      default:
        return json(req, { error: `unknown channel: ${channel}` }, 400);
    }

    return json(req, { ok: true, channel, result });
  } catch (err) {
    console.error('notify error:', err);
    return json(req, { error: String(err?.message || err) }, 500);
  }
});

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

// ── Channel implementations ──────────────────────────────────────────────────
async function sendEmail(event) {
  const apiKey = Deno.env.get('SENDGRID_API_KEY');
  if (!apiKey) return { skipped: 'SENDGRID_API_KEY not set' };

  const to = event?.to?.email;
  if (!to) return { skipped: 'no recipient email' };

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to, name: event?.to?.name || '' }] }],
      from: { email: 'no-reply@slotengineering.com', name: 'SLOT Engineering ERP' },
      subject: event?.subject || 'Notification',
      content: [{
        type: 'text/html',
        value: renderEmailHTML(event),
      }],
    }),
    signal: AbortSignal.timeout(10_000), // FIX (T3-4): fail fast instead of hanging for the platform's full request timeout
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SendGrid ${res.status}: ${text}`);
  }
  return { providerId: res.headers.get('x-message-id') };
}

async function sendSMS(event) {
  const sid   = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from  = Deno.env.get('TWILIO_FROM_SMS');
  if (!sid || !token || !from) return { skipped: 'Twilio creds not set' };

  const to = event?.to?.phone;
  if (!to) return { skipped: 'no recipient phone' };

  const body = new URLSearchParams({ To: to, From: from, Body: event?.body || event?.subject || '' });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${sid}:${token}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(10_000), // FIX (T3-4): fail fast instead of hanging for the platform's full request timeout
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio SMS ${res.status}: ${text}`);
  }
  const data = await res.json();
  return { providerId: data.sid };
}

async function sendWhatsApp(event) {
  const sid   = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from  = Deno.env.get('TWILIO_FROM_WA');
  if (!sid || !token || !from) return { skipped: 'Twilio WhatsApp creds not set' };

  const to = event?.to?.phone;
  if (!to) return { skipped: 'no recipient phone' };
  const waTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

  const body = new URLSearchParams({ To: waTo, From: from, Body: event?.body || event?.subject || '' });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(`${sid}:${token}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(10_000), // FIX (T3-4): fail fast instead of hanging for the platform's full request timeout
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio WhatsApp ${res.status}: ${text}`);
  }
  const data = await res.json();
  return { providerId: data.sid };
}

// ── Email template ───────────────────────────────────────────────────────────
function renderEmailHTML(event) {
  // Link was already validated upstream — only relative paths starting
  // with / reach here. We still encodeURI it for defence in depth.
  const link = event?.link
    ? `<p style="margin:16px 0"><a href="https://erp.slotengineering.com${encodeURI(event.link)}" style="background:#1A5C2A;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Open in ERP</a></p>`
    : '';
  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;color:#182A1C">
      <div style="background:#1A5C2A;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;opacity:0.7">SLOT ENGINEERING · ERP</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px">${escapeHTML(event?.subject || 'Notification')}</div>
      </div>
      <div style="background:#fff;border:1px solid #DDE9DE;border-top:none;border-radius:0 0 8px 8px;padding:20px 24px">
        <p style="font-size:14px;line-height:1.6;color:#182A1C">${escapeHTML(event?.body || '')}</p>
        ${link}
        <p style="font-size:11px;color:#6E8C74;margin-top:24px;border-top:1px solid #DDE9DE;padding-top:12px">
          This is an automated message from the SLOT Engineering ERP. You're receiving this because of your role in the system.
        </p>
      </div>
    </div>
  `;
}

function escapeHTML(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
