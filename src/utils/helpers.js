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

export function totalRecords(db) {
  if (!db) return 0;
  return [...MODULE_IDS, ...EXTENDED_IDS, '_trash'].reduce((a, k) => a + (db[k]?.length || 0), 0);
}


// ── Deep-link navigation helpers ───────────────────────────────────────────────
// Dashboard alert banners write: sessionStorage.setItem('bizcore_nav_tab_MODULE', 'tabkey')
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
    const key = 'bizcore_nav_tab_' + moduleId;
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
  try { sessionStorage.setItem('bizcore_nav_tab_' + moduleId, tabKey); } catch {}
}
