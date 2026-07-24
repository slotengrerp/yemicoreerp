# Supabase Edge Functions — Deployment Guide

This directory contains the Edge Functions that handle privileged operations
on the server side. The browser never holds the service role key.

## Functions in this directory

| Function | Purpose |
|---|---|
| `manage-users` | Admin-only user CRUD: create / update / disable / enable / delete / reset password. Uses `auth.admin.*` server-side. |
| `notify` | Email / SMS / WhatsApp fan-out for transactional notifications (approvals, period close, bill variance, year-end close). |

## One-time setup

```bash
# 1. Install the Supabase CLI if you don't have it
brew install supabase/tap/supabase              # macOS
# or: scoop install supabase                    # Windows (scoop)
# or: npm install -g supabase                   # cross-platform

# 2. Link to your project
supabase login
supabase link --project-ref <your-project-ref>

# 3. Set the secrets the functions need
#    (the SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected
#    by Supabase — you don't set those. The function-level secrets are
#    for the third-party APIs it calls.)
supabase secrets set \
  SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxx \
  TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxx \
  TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx \
  TWILIO_FROM_SMS=+15555550100 \
  TWILIO_FROM_WA=whatsapp:+14155238886
```

## Deploy

```bash
# Deploy both functions
supabase functions deploy manage-users --no-verify-jwt
supabase functions deploy notify --no-verify-jwt
```

> The `--no-verify-jwt` flag is required because both functions do their own
> auth check (read the caller's JWT, verify they're an admin in `app_users`).
> If you prefer Supabase to verify the JWT first, drop the flag and the
> function will only run for callers with a valid signed-in session.

## Local development

```bash
# Start the function locally (for testing)
supabase functions serve manage-users --no-verify-jwt --env-file ./supabase/.env.local

# In another terminal, send a test request
curl -X POST 'http://localhost:54321/functions/v1/manage-users' \
  -H 'Authorization: Bearer <your-test-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"action":"create","payload":{"email":"newuser@example.com","password":"correcthorse","name":"Test User","role":"viewer","modules":[]}}'
```

## Action reference — `manage-users`

All requests are `POST` to `/functions/v1/manage-users` with:
```json
{ "action": "<one of the below>", "payload": { ... } }
```

| Action | Required payload | Effect |
|---|---|---|
| `create` | `email`, `password`, `name`, `role`, `modules?`, `phone?` | Creates a Supabase Auth account (auto-confirmed) + the linked `app_users` row. Rolls back the auth account if the row insert fails. |
| `update` | `id`, plus any of `name?`, `role?`, `modules?`, `phone?`, `status?` | Updates the `app_users` row. Username/email are NOT updatable here — username is the join key, email is the auth identity. |
| `disable` | `id` | Sets `status='Inactive'` on `app_users` AND bans the Supabase Auth account for 100 years (≈ permanent). |
| `enable` | `id` | Sets `status='Active'` and unbans the Supabase Auth account. |
| `delete` | `id` | Deletes the Supabase Auth account. The `app_users` row is kept (audit trail). |
| `reset_password` | `id`, `newPassword?` | If `newPassword` is provided: sets it directly. If not: triggers Supabase's standard reset-password email to the user's address. |

All actions require the caller to be signed in with `role='admin'`.

## Action reference — `notify`

`POST /functions/v1/notify` with `{ "channel": "email"|"sms"|"whatsapp", "event": { ... } }`

| Channel | Provider | Cost |
|---|---|---|
| `email` | SendGrid | Free tier: 100/day |
| `sms` | Twilio | ~$0.0079/SMS to NG numbers |
| `whatsapp` | Twilio WhatsApp Business API | ~$0.005/msg |

If the relevant API key isn't set, the function returns `{ skipped: '...' }` instead of failing — the client code in `utils/notifications.js` already handles this gracefully.

## Email template customization

The `notify` function uses a built-in HTML template. To customize:

1. Edit `supabase/functions/notify/index.ts` → `renderEmailHTML()`
2. Add your brand colours, logo URL, footer
3. Re-deploy: `supabase functions deploy notify`

For password-reset emails, Supabase's defaults are used unless you also
configure a custom SMTP provider in **Authentication → Email Templates**.
Branding the reset email there is a Supabase dashboard change, not a code
change.
