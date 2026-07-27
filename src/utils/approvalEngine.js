// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Multi-Level Approval Chain Engine
//
// Replaces flat "Pending → Approved/Rejected" single-click approval with
// configurable, amount-banded authorization chains (e.g. "PO under ₦500k
// needs a Manager; ₦500k–₦2M needs Manager then Accountant; over ₦2M needs
// Manager, Accountant, then Admin"). This is the standard authorization-limit
// pattern from commercial ERPs (Sage 200 Evolution, etc.) — each workflow
// (Purchase Orders, Staff Requests, Petty Cash) has its own band table.
//
// Design choices, deliberately:
//   - Records keep their existing flat `status` field ('Pending'/'Approved'/
//     'Rejected') in sync with the chain's overall status. Every existing
//     dashboard, filter, KPI, and report elsewhere in the app that reads
//     `.status` keeps working unchanged — the chain drives WHO can click
//     Approve and HOW MANY clicks it takes, not what the outward field is
//     called. This was a deliberate choice to add real capability without
//     rewriting the ~40 other places that already read `.status`.
//   - Admin can always approve at any level, matching the existing
//     admin-bypass convention already used throughout the app (canDo()).
//   - Rules are configurable per-company via appSettings.approvalRules,
//     defaulting to DEFAULT_APPROVAL_RULES below when not customized.
// ══════════════════════════════════════════════════════════════════════════════

// ── Default authorization bands ──────────────────────────────────────────────
// `upTo` is inclusive, in NGN. The LAST band should always be Infinity so
// every amount matches something. `roles` is the ORDERED chain — level 1
// first, then level 2, etc.
export const DEFAULT_APPROVAL_RULES = {
  procurement_po: {
    label: 'Purchase Orders',
    bands: [
      { upTo: 500000,   roles: ['manager'] },
      { upTo: 2000000,  roles: ['manager', 'accountant'] },
      { upTo: Infinity, roles: ['manager', 'accountant', 'admin'] },
    ],
  },
  requests: {
    label: 'Staff Requests',
    bands: [
      { upTo: Infinity, roles: ['manager'] },
    ],
  },
  pettycash: {
    label: 'Petty Cash Vouchers',
    bands: [
      { upTo: 50000,    roles: ['admin'] },
      { upTo: Infinity, roles: ['admin', 'accountant'] },
    ],
  },
};

export const APPROVAL_WORKFLOWS = Object.keys(DEFAULT_APPROVAL_RULES);

// ── Rule lookup — custom overrides win, falls back to defaults ──────────────
export function getApprovalRules(workflowKey, appSettings) {
  const custom = appSettings?.approvalRules?.[workflowKey];
  return custom || DEFAULT_APPROVAL_RULES[workflowKey] || { label: workflowKey, bands: [{ upTo: Infinity, roles: ['admin'] }] };
}

// ── Which role chain applies to a given amount ───────────────────────────────
export function getRequiredChain(workflowKey, amount, appSettings) {
  const rules = getApprovalRules(workflowKey, appSettings);
  const amt = Number(amount) || 0;
  const band = rules.bands.find(b => amt <= b.upTo) || rules.bands[rules.bands.length - 1];
  return band.roles;
}

// ── Start a new approval chain for a freshly-submitted record ───────────────
export function initApproval(workflowKey, amount, appSettings) {
  const requiredRoles = getRequiredChain(workflowKey, amount, appSettings);
  return { requiredRoles, currentLevel: 0, history: [], status: 'Pending' };
}

// ── Can this user act on the CURRENT level of this chain right now? ─────────
export function canApproveAtCurrentLevel(approval, user) {
  if (!approval || approval.status !== 'Pending') return false;
  if (!user) return false;
  const requiredRole = approval.requiredRoles?.[approval.currentLevel];
  if (!requiredRole) return false;
  return user.role === requiredRole || user.role === 'admin';
}

// ── Apply an Approve/Reject decision at the current level ───────────────────
export function applyDecision(approval, user, decision, note = '') {
  const entry = {
    level:      approval.currentLevel + 1,
    role:       approval.requiredRoles[approval.currentLevel],
    by:         user?.name || 'Unknown',
    actingRole: user?.role || '',
    at:         new Date().toISOString(),
    decision,
    note,
  };
  const history = [...(approval.history || []), entry];

  if (decision === 'Rejected') {
    return { ...approval, history, status: 'Rejected' };
  }

  const nextLevel = approval.currentLevel + 1;
  const done = nextLevel >= approval.requiredRoles.length;
  return {
    ...approval,
    history,
    currentLevel: nextLevel,
    status: done ? 'Approved' : 'Pending',
  };
}

// ── Human-readable summary for UI badges ─────────────────────────────────────
// appSettings is optional — pass it when available so a custom role's real
// display name shows up instead of its raw key (e.g. "Terminal Supervisor"
// instead of "terminal_supervisor").
export function approvalSummary(approval, appSettings = null) {
  if (!approval || !approval.requiredRoles?.length) return '';
  if (approval.status === 'Approved') {
    return approval.requiredRoles.length > 1
      ? `Approved — ${approval.requiredRoles.length}-level chain complete`
      : 'Approved';
  }
  if (approval.status === 'Rejected') {
    const last = approval.history[approval.history.length - 1];
    return `Rejected at level ${last?.level || '?'} by ${last?.by || 'unknown'}`;
  }
  const total = approval.requiredRoles.length;
  if (total <= 1) return 'Pending approval';
  const cur = approval.currentLevel + 1;
  const roleKey = approval.requiredRoles[approval.currentLevel];
  const customLabel = appSettings?.customRoles?.find(r => r.key === roleKey)?.label;
  const roleLabel = customLabel || ROLE_LABELS[roleKey] || roleKey;
  return `Pending — level ${cur} of ${total} (needs ${roleLabel})`;
}

export const ROLE_LABELS = {
  admin: 'Admin', manager: 'Manager', accountant: 'Accountant', cashier: 'Cashier', viewer: 'Viewer',
};
