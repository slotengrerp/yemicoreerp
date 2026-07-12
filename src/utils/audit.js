// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Audit Utility v2.0
// FIX: Now captures before/after field values, not just "X happened" messages.
// Every add/edit/delete records a full change set readable by management.
// ══════════════════════════════════════════════════════════════════════════════

// Fields never included in diffs (binary/noisy)
const SKIP_FIELDS = new Set(['createdAt', 'updatedAt', 'id', 'sn']);

/**
 * Compute a human-readable diff between two objects.
 * Returns an array of { field, from, to } objects for changed fields only.
 */
export function diffRecords(before, after) {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const k of keys) {
    if (SKIP_FIELDS.has(k)) continue;
    const a = JSON.stringify(before[k]);
    const b = JSON.stringify(after[k]);
    if (a !== b) {
      changes.push({
        field: k,
        from:  before[k] ?? null,
        to:    after[k]  ?? null,
      });
    }
  }
  return changes;
}

/**
 * Log a create/edit/delete activity entry.
 *
 * @param {Function} dispatch  - AppContext dispatch
 * @param {string}   msg       - Human-readable summary ("Invoice INV-001 created")
 * @param {object}   user      - Current user object
 * @param {object}   [options] - Optional { module, action, before, after, recordId }
 */
export function logActivity(dispatch, msg, user, options = {}) {
  const { module, action, before, after, recordId } = options;
  const changes = (action === 'edit' && before && after) ? diffRecords(before, after) : [];

  dispatch({
    type: 'ADD_ACTIVITY',
    payload: {
      msg,
      who:      user?.name  || 'System',
      role:     user?.role  || 'system',
      time:     new Date().toISOString(),
      module:   module   || null,
      action:   action   || 'info',   // 'create' | 'edit' | 'delete' | 'approve' | 'info'
      recordId: recordId || null,
      changes,  // [] for creates/deletes, field diffs for edits
    },
  });
}
