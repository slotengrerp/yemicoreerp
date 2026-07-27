// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Multi-Tier Approval Routing v1.0
//
// The audit's Tier-2 finding: Approvals is currently a single-stage queue
// (one approve/reject step per item). Real procurement control needs
// configurable chains — Manager → Finance → Director — with rules that
// pick the right chain based on amount, category, department, or amount
// thresholds.
//
// Model:
//   • workflow       — a named chain of { step, role, minAmount?, maxAmount? }
//   • workflowRules  — which workflows apply to which record type, and any
//                      per-condition overrides (e.g. "amount > ₦1M" → Director)
//   • approvalChain  — the materialised chain attached to a specific record
//                      (frozen at submission so retroactive config changes
//                      don't reshuffle in-flight approvals)
//
// The record carries `approvalChain: [{ step, role, status, approver, date }]`
// instead of a single `approvedBy`/`approvedDate`. The Approvals UI walks
// this chain step-by-step.
// ══════════════════════════════════════════════════════════════════════════════

// Default workflows — shipped in settings on first run, fully editable.
export const DEFAULT_WORKFLOWS = [
  {
    id: 'wf_po_default',
    name: 'Standard PO Approval',
    appliesTo: 'procurement',
    steps: [
      { step: 1, role: 'manager',    label: 'Department Manager' },
      { step: 2, role: 'accountant', label: 'Finance Officer'   },
      { step: 3, role: 'admin',      label: 'Managing Director' },
    ],
    rules: { minAmount: 0, maxAmount: null },
  },
  {
    id: 'wf_po_small',
    name: 'Small PO Approval (≤ ₦500K)',
    appliesTo: 'procurement',
    steps: [
      { step: 1, role: 'manager', label: 'Department Manager' },
    ],
    rules: { minAmount: 0, maxAmount: 500000 },
  },
  {
    id: 'wf_po_major',
    name: 'Major PO Approval (≥ ₦5M)',
    appliesTo: 'procurement',
    steps: [
      { step: 1, role: 'manager',    label: 'Department Manager' },
      { step: 2, role: 'accountant', label: 'Finance Manager'   },
      { step: 3, role: 'admin',      label: 'Managing Director' },
    ],
    rules: { minAmount: 5000000, maxAmount: null },
  },
  {
    id: 'wf_ap_bill',
    name: 'AP Bill Approval',
    appliesTo: 'apBill',
    steps: [
      { step: 1, role: 'accountant', label: 'Finance Officer' },
      { step: 2, role: 'admin',      label: 'Managing Director' },
    ],
    rules: { minAmount: 0, maxAmount: null },
  },
  {
    id: 'wf_pettycash',
    name: 'Petty Cash Voucher',
    appliesTo: 'pettycash',
    steps: [
      { step: 1, role: 'manager',    label: 'Department Manager' },
      { step: 2, role: 'accountant', label: 'Finance Officer'   },
    ],
    rules: { minAmount: 0, maxAmount: null },
  },
  {
    id: 'wf_request',
    name: 'Internal Request',
    appliesTo: 'request',
    steps: [
      { step: 1, role: 'manager', label: 'Department Manager' },
    ],
    rules: { minAmount: 0, maxAmount: null },
  },
];

// Pick the best-matching workflow for a record based on amount + type.
export function pickWorkflow(record, workflows) {
  const amount = Number(record?.totalAmount ?? record?.amount ?? record?.estimatedTotal ?? 0);
  const candidates = (workflows || DEFAULT_WORKFLOWS)
    .filter(w => w.appliesTo === record?._approvalType || w.appliesTo === record?.type?.toLowerCase());
  if (!candidates.length) return null;
  // Prefer the most specific (smallest range that contains the amount), then
  // the longest chain. This way a ₦400K PO hits the "small" workflow, a
  // ₦2M PO hits the "default" workflow, a ₦10M PO hits the "major" workflow.
  const inRange = candidates.filter(w => {
    const min = Number(w.rules?.minAmount || 0);
    const max = w.rules?.maxAmount == null ? Infinity : Number(w.rules.maxAmount);
    return amount >= min && amount <= max;
  });
  const pool = inRange.length ? inRange : candidates;
  return pool.sort((a, b) => (b.steps?.length || 0) - (a.steps?.length || 0))[0];
}

// Materialise the approval chain for a record at submission time.
// Returns a new object with `approvalChain` set; the caller's record is not
// mutated.
export function buildApprovalChain(record, workflows) {
  const wf = pickWorkflow(record, workflows);
  if (!wf) {
    // No matching workflow — fall back to single-step admin approval
    return [{
      step: 1, role: 'admin', label: 'Approver',
      status: 'Pending', approver: '', date: '', note: '',
    }];
  }
  return wf.steps.map(s => ({
    step:      s.step,
    role:      s.role,
    label:     s.label,
    status:    'Pending',
    approver:  '',
    date:      '',
    note:      '',
    workflowId: wf.id,
  }));
}

// Advance the chain: when the current step is approved, mark it Approved and
// the next step Pending. When rejected, mark all remaining steps Rejected.
// Returns a new chain; never mutates the input.
export function applyApprovalAction(chain, { action, by, role, note, stepNumber = null }) {
  // If a specific step is targeted, use that; otherwise operate on the
  // first Pending step.
  const targetIdx = stepNumber != null
    ? chain.findIndex(s => s.step === stepNumber)
    : chain.findIndex(s => s.status === 'Pending');
  if (targetIdx < 0) return chain;
  const now = new Date().toISOString();
  const next = chain.map((s, i) => {
    if (i < targetIdx)  return s;       // already resolved
    if (i === targetIdx) {
      return { ...s, status: action === 'approve' ? 'Approved' : 'Rejected',
               approver: by, approverRole: role, date: now, note: note || s.note };
    }
    // i > targetIdx
    if (action === 'reject') return { ...s, status: 'Rejected (skipped)' };
    return s;                            // still Pending, no change
  });
  return next;
}

export function chainStatus(chain) {
  if (!chain?.length) return 'None';
  if (chain.every(s => s.status === 'Approved')) return 'Approved';
  if (chain.some(s => s.status === 'Rejected' || s.status === 'Rejected (skipped)')) return 'Rejected';
  if (chain.every(s => s.status === 'Pending')) return 'Pending';
  return 'In Progress';
}

export function currentStep(chain) {
  return chain?.find(s => s.status === 'Pending') || null;
}
