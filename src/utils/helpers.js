import toast from 'react-hot-toast';

const PREFIX = import.meta.env.VITE_STORAGE_PREFIX || 'bc_';

export const STORAGE = {
  db:               PREFIX + 'db',
  users:            PREFIX + 'users',
  settings:         PREFIX + 'settings',
  accounting:       PREFIX + 'accounting',
  session:          PREFIX + 'session',
  recovery:         PREFIX + 'recovery_code',
  budgets:          PREFIX + 'budgets',
  recurring:        PREFIX + 'recurring_invoices',
  backupHistory:    PREFIX + 'backup_history',
};

// Deliberately does NOT start with 'bc_' or 'slot_' — Backup.jsx's "Wipe All
// Data" clears every key with those prefixes, and this flag needs to survive
// that exact sweep. It's what lets each module's "no data yet → show demo
// records" fallback tell "brand new install" apart from "deliberately
// emptied for testing" — otherwise both look identical: an empty array.
export const WIPE_FLAG_KEY = 'slot_erp_data_wiped';

export const MODULE_IDS = ['nlng', 'procurement', 'inventory', 'vehicles', 'invoices', 'slot', 'request', 'pettycash'];
export const EXTENDED_IDS = ['fixedassets', 'wht'];
// terminal is in MODULE_IDS but stored as an object { containers, charges, logistics }
// so it is handled separately in TerminalOps — not iterated as a plain array

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function formatCurrency(amount, currency = '₦') {
  if (amount == null || isNaN(amount)) return currency + '0';
  return currency + Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

export function now() {
  return new Date().toISOString();
}

export function showToast(msg, type = 'success') {
  const opts = { duration: 3000, style: { background: '#0e1623', color: '#e8f4f8', border: '1px solid #1e3048', borderRadius: '10px', fontWeight: 600 } };
  if (type === 'success') toast.success(msg, opts);
  else if (type === 'error') toast.error(msg, opts);
  else toast(msg, opts);
}

export function truncate(str, n = 30) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// 2026-08-19 QA fix: this hardcoded MODULE_IDS/EXTENDED_IDS allowlist had
// drifted from the real `db` shape — it silently missed 'terminal' (1351
// records), 'ap', 'fleet', and every module added since this list was last
// touched, AND `db[k]?.length` returns undefined→0 for object-shaped
// modules like procurement ({ pos, rfqs, invoices, waybills }), which have
// no top-level .length at all. Net effect: the Backup page's "Total
// Records" tile — and the record counts written into local-backup files
// and cloud/file-restore history entries — showed 53 when the real total
// (matching the per-module tiles directly above it, which already handled
// this correctly) was over 1,400. Rewritten to walk every key in `db`
// generically, the same way Backup.jsx's own per-module tile calc already
// does, so it can't drift out of sync with the real module list again.
export function totalRecords(db) {
  if (!db) return 0;
  return Object.values(db).reduce((a, v) => {
    if (Array.isArray(v)) return a + v.length;
    if (v && typeof v === 'object') return a + Object.values(v).reduce((s, x) => s + (Array.isArray(x) ? x.length : 0), 0);
    return a;
  }, 0);
}


// ── Deep-link navigation helpers ───────────────────────────────────────────────
// Dashboard alert banners write: sessionStorage.setItem('slot_erp_nav_tab_MODULE', 'tabkey')
// Each module reads this on mount to jump to the right sub-tab automatically.

/**
 * Call inside useState initialiser for the tab state:
 *   const [tab, setTab] = useState(() => getDeepLinkTab('procurement', 'po'));
 *
 * @param {string} moduleId  - matches the nav/page key (e.g. 'procurement', 'terminal')
 * @param {string} defaultTab - the tab to show if no deep-link signal is present
 */
export function getDeepLinkTab(moduleId, defaultTab) {
  try {
    const key = 'slot_erp_nav_tab_' + moduleId;
    const stored = sessionStorage.getItem(key);
    if (stored) {
      sessionStorage.removeItem(key); // consume once
      return stored;
    }
  } catch {}
  return defaultTab;
}

/**
 * Write a deep-link signal before navigating — used by Dashboard and any
 * module that wants to cross-navigate to another module's specific tab.
 *
 *   writeDeepLink('accounting', 'trial');
 *   onNav('accounting');
 */
export function writeDeepLink(moduleId, tabKey) {
  try { sessionStorage.setItem('slot_erp_nav_tab_' + moduleId, tabKey); } catch {}
}
