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

  // Identifies this one logical event across both copies of it: the optimistic
  // local entry below, and the realtime echo of the server row it becomes.
  // Server and client clocks differ, so the timestamps can't be compared —
  // this id is what lets the reducer drop the echo exactly.
  const eventId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const entry = {
    eventId,
    msg,
    who:      user?.name  || 'System',
    role:     user?.role  || 'system',
    time:     new Date().toISOString(),
    module:   module   || null,
    action:   action   || 'info',   // 'create' | 'edit' | 'delete' | 'approve' | 'info'
    recordId: recordId || null,
    changes,  // [] for creates/deletes, field diffs for edits
  };

  // Local first — the log appears instantly for the person who acted.
  dispatch({ type: 'ADD_ACTIVITY', payload: entry });

  // ── 2026-08-05: THE LOG USED TO STOP AT THE LINE ABOVE ──────────────────────
  //
  // Every entry lived only in the acting browser's React state. Two people on
  // two laptops therefore had two different, private activity logs that could
  // never agree, and refreshing lost everything not already on the server.
  // Reported by SLOT while trying to establish who had deleted some invoices —
  // the one question the log exists to answer, and could not.
  //
  // logActivityServer()/pushActivity() were written months ago and are correct;
  // nothing ever called them. A search of src/ found exactly one occurrence of
  // pushActivity: its own definition. This is that missing call.
  //
  // Deliberately fire-and-forget: an audit write must never block or break the
  // user's action, and pushActivity already resolves quietly on failure. The
  // dynamic import keeps the sync engine out of audit.js's module graph, which
  // matters because audit.js is imported by nearly every module.
  try {
    import('../hooks/usePerRecordSync').then(({ pushActivity }) => {
      pushActivity({
        userId:   user?.id   || null,
        userName: entry.who,
        userRole: entry.role,
        module:   entry.module,
        action:   entry.action,
        message:  msg,
        metadata: { recordId: entry.recordId, changes: entry.changes, eventId },
      });
    }).catch(() => {});
  } catch { /* never let audit logging break the action being audited */ }
}
