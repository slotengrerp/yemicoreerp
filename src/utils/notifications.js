// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Notifications Dispatcher v1.0
//
// The audit's Tier-2 finding: no email/SMS/WhatsApp/push anywhere in the
// codebase. This module defines the interface and the in-app toast
// implementation; the email/SMS/WhatsApp channels are intentionally
// client-side stubs that POST to a Supabase Edge Function which holds the
// actual API credentials (SendGrid for email, Twilio for SMS/WhatsApp).
//
// The pattern keeps secrets off the browser: the Edge Function reads
// SENDGRID_API_KEY / TWILIO_AUTH_TOKEN from its own env, so the anon-key
// client never sees them.
//
// Event types the dispatcher knows about:
//   • approval.requested  — sent to the approver when a chain is submitted
//   • approval.approved   — sent to the requester when a step is approved
//   • approval.rejected   — sent to the requester when rejected
//   • approval.completed  — sent to the requester when the whole chain completes
//   • period.closed       — sent to admins when a period is closed
//   • year.closed         — sent to admins when a fiscal year is closed
//   • bill.variance       — sent to procurement manager when 3-way match fails
//   • journal.blocked     — sent to the accountant when a posting is blocked
// ══════════════════════════════════════════════════════════════════════════════

import { showToast, formatCurrency } from './helpers';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const EDGE_NOTIFY = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/notify` : null;

// ── Channel routing ───────────────────────────────────────────────────────────
// Each event type can be delivered on one or more channels. Admins configure
// this in Settings → Notifications. The default below matches a typical
// Nigerian mid-size operation: WhatsApp is the primary channel (cheap,
// familiar), email is the formal record, in-app toast is always on.
const DEFAULT_CHANNELS = {
  'approval.requested': ['inapp', 'email', 'whatsapp'],
  'approval.approved':  ['inapp'],
  'approval.rejected':  ['inapp', 'email'],
  'approval.completed': ['inapp', 'email'],
  'period.closed':      ['inapp'],
  'year.closed':        ['inapp', 'email'],
  'bill.variance':      ['inapp', 'email'],
  'journal.blocked':    ['inapp'],
};

let _config = null;
export function setNotificationConfig(cfg) { _config = cfg; }
export function getNotificationConfig() {
  return _config || (() => {
    try { return JSON.parse(localStorage.getItem('bc_notification_config') || '{}'); }
    catch { return {}; }
  })();
}

function channelsFor(eventType) {
  const cfg = getNotificationConfig();
  if (cfg.channels && cfg.channels[eventType]) return cfg.channels[eventType];
  return DEFAULT_CHANNELS[eventType] || ['inapp'];
}

// ── Channel implementations ──────────────────────────────────────────────────
async function sendInApp(event) {
  // Always-on, always works — uses the existing toast system.
  const tone = event.severity === 'error' ? 'error'
             : event.severity === 'warning' ? 'info'
             : 'success';
  showToast(event.message, tone);
  return { channel: 'inapp', ok: true };
}

async function sendEmail(event) {
  if (!EDGE_NOTIFY) return { channel: 'email', ok: false, skipped: 'no-edge' };
  try {
    const res = await fetch(EDGE_NOTIFY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ channel: 'email', event }),
    });
    if (!res.ok) throw new Error(`Edge ${res.status}`);
    return { channel: 'email', ok: true };
  } catch (e) {
    console.warn('[SLOT] Email notify failed:', e.message);
    // Soft-fail — never block business logic on a notification failure
    return { channel: 'email', ok: false, error: e.message };
  }
}

async function sendSMS(event) {
  if (!EDGE_NOTIFY) return { channel: 'sms', ok: false, skipped: 'no-edge' };
  try {
    const res = await fetch(EDGE_NOTIFY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ channel: 'sms', event }),
    });
    if (!res.ok) throw new Error(`Edge ${res.status}`);
    return { channel: 'sms', ok: true };
  } catch (e) {
    return { channel: 'sms', ok: false, error: e.message };
  }
}

async function sendWhatsApp(event) {
  if (!EDGE_NOTIFY) return { channel: 'whatsapp', ok: false, skipped: 'no-edge' };
  try {
    const res = await fetch(EDGE_NOTIFY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ channel: 'whatsapp', event }),
    });
    if (!res.ok) throw new Error(`Edge ${res.status}`);
    return { channel: 'whatsapp', ok: true };
  } catch (e) {
    return { channel: 'whatsapp', ok: false, error: e.message };
  }
}

const CHANNEL_HANDLERS = {
  inapp:    sendInApp,
  email:    sendEmail,
  sms:      sendSMS,
  whatsapp: sendWhatsApp,
};

// ── Public API ───────────────────────────────────────────────────────────────
// notify(eventType, payload) → fan out to all configured channels
//
//   notify('approval.requested', {
//     to:      { name: 'Chidi Okafor', email: '...', phone: '+234...' },
//     subject: 'PO-2026-0015 awaiting your approval',
//     body:    'A purchase order from Alex Mbata for ₦1,564,125 needs your review.',
//     link:    '/procurement',
//     recordId: 'po-123',
//   })
export async function notify(eventType, payload = {}) {
  const channels = channelsFor(eventType);
  const event = {
    type:      eventType,
    timestamp: new Date().toISOString(),
    severity:  payload.severity || 'info',
    ...payload,
  };
  const results = await Promise.all(channels.map(ch => {
    const handler = CHANNEL_HANDLERS[ch];
    return handler ? handler(event) : { channel: ch, ok: false, error: 'unknown-channel' };
  }));
  return { eventType, results };
}

// ── Helpers used by the rest of the app ──────────────────────────────────────
export const notifyApprovalRequested  = (to, record) => notify('approval.requested', {
  to, severity: 'info',
  subject: `Approval requested — ${record?.poNo || record?.billNo || record?.requestNo || 'Record'}`,
  body:    `${record?.requestedBy || 'Someone'} submitted a ${record?.type || 'request'} for ${formatCurrency(record?.totalAmount || 0)} awaiting your review.`,
  link:    '/approvals', recordId: record?.id,
});

export const notifyApprovalCompleted = (to, record) => notify('approval.completed', {
  to, severity: 'success',
  subject: `Approved — ${record?.poNo || record?.billNo || record?.requestNo || 'Record'}`,
  body:    `Your ${record?.type || 'request'} for ${formatCurrency(record?.totalAmount || 0)} has been fully approved.`,
  link:    '/approvals', recordId: record?.id,
});

export const notifyApprovalRejected  = (to, record, reason) => notify('approval.rejected', {
  to, severity: 'error',
  subject: `Rejected — ${record?.poNo || record?.billNo || record?.requestNo || 'Record'}`,
  body:    `Your ${record?.type || 'request'} for ${formatCurrency(record?.totalAmount || 0)} was rejected${reason ? `: ${reason}` : '.'}`,
  link:    '/approvals', recordId: record?.id,
});

export const notifyBillVariance      = (to, bill, report) => notify('bill.variance', {
  to, severity: 'warning',
  subject: `Bill variance — ${bill?.billNo || '?'}`,
  body:    `Bill ${bill?.billNo} (${bill?.vendorName}) has a ${report.severity || ''} variance: ${report.variances.map(v => v.message).join('; ')}`,
  link:    '/ap', recordId: bill?.id,
});

export const notifyPeriodClosed      = (to, periodKey) => notify('period.closed', {
  to, severity: 'info',
  subject: `Period ${periodKey} closed`,
  body:    `Period ${periodKey} has been closed. New postings into this period are blocked.`,
  link:    '/settings',
});

export const notifyYearClosed        = (to, fy, retainedEarnings) => notify('year.closed', {
  to, severity: 'success',
  subject: `Fiscal year ${fy} closed — Net P&L ${formatCurrency(retainedEarnings||0)}`,
  body:    `Fiscal year ${fy} has been closed. Year-end closing entry posted: Net P&L ${formatCurrency(retainedEarnings||0)} to Retained Earnings.`,
  link:    '/settings',
});
