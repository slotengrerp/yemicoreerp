// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Auth Utility v2.0
// SECURITY FIXES:
//   1. Passwords hashed with SHA-256 (Web Crypto API) — never stored in plain text
//   2. Session timeout: last-activity timestamp enforced on every load
//   3. Strong-password validator wired to requireStrongPw setting
// ══════════════════════════════════════════════════════════════════════════════
import { STORAGE } from './helpers';

export const ROLE_PERMS = {
  admin:      { canAdd: true,  canEdit: true,  canDelete: true,  canSettings: true  },
  manager:    { canAdd: true,  canEdit: true,  canDelete: false, canSettings: false },
  accountant: { canAdd: true,  canEdit: true,  canDelete: false, canSettings: false },
  cashier:    { canAdd: true,  canEdit: false, canDelete: false, canSettings: false },
  viewer:     { canAdd: false, canEdit: false, canDelete: false, canSettings: false },
};

// ── Password hashing ──────────────────────────────────────────────────────────
// SHA-256 via Web Crypto — available in all modern browsers, no library needed.
export async function hashPassword(plain) {
  const enc = new TextEncoder().encode(plain);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Synchronous hex-SHA-256 used only at migration time (users stored with plain passwords).
// Returns null if plain text is not detectable — caller handles both cases.
function isLikelyPlainText(pw) {
  // SHA-256 hashes are always exactly 64 hex chars. Anything else is plain text.
  return !(/^[0-9a-f]{64}$/.test(pw));
}

// ── Default admin (password will be hashed on first use) ─────────────────────
export const DEFAULT_ADMIN = {
  id: 'admin_default',
  name: 'System Admin',
  username: 'admin',
  // Stored as SHA-256 of 'admin123' — change via Users module immediately
  password: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
  role: 'admin',
  modules: ['nlng','procurement','inventory','vehicles','invoices','slot','request','pettycash'],
  created: new Date().toISOString(),
};

// ── User store ────────────────────────────────────────────────────────────────
export function getUsers() {
  try {
    const raw = localStorage.getItem(STORAGE.users);
    if (!raw) return [DEFAULT_ADMIN];
    const users = JSON.parse(raw);
    return users.length ? users : [DEFAULT_ADMIN];
  } catch {
    return [DEFAULT_ADMIN];
  }
}

export function saveUsers(users) {
  try {
    localStorage.setItem(STORAGE.users, JSON.stringify(users));
  } catch {}
}

// ── Session management ────────────────────────────────────────────────────────
const ACTIVITY_KEY = 'bc_last_activity';

export function touchActivity() {
  try { localStorage.setItem(ACTIVITY_KEY, Date.now().toString()); } catch {}
}

export function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE.session);
    if (!raw) return null;
    const session = JSON.parse(raw);

    // Enforce session timeout
    const settings = (() => {
      try { return JSON.parse(localStorage.getItem('bc_settings') || '{}'); } catch { return {}; }
    })();
    const timeoutMinutes = settings?.security?.sessionTimeout || 60;
    const lastActivity   = parseInt(localStorage.getItem(ACTIVITY_KEY) || '0', 10);
    const elapsed        = (Date.now() - lastActivity) / 60000; // minutes

    if (lastActivity && elapsed > timeoutMinutes) {
      clearSession();
      return null;
    }

    touchActivity(); // refresh timestamp on valid read
    return session;
  } catch {
    return null;
  }
}

export function saveSession(user) {
  try {
    localStorage.setItem(STORAGE.session, JSON.stringify(user));
    touchActivity();
  } catch {}
}

export function clearSession() {
  try {
    localStorage.removeItem(STORAGE.session);
    localStorage.removeItem(ACTIVITY_KEY);
  } catch {}
}

// ── Legacy login rate limiter ─────────────────────────────────────────────────
// Prevents brute-force attacks on the localStorage-based user system.
// Uses sessionStorage (clears on browser close) to track failed attempts.
const RATE_KEY    = 'bc_login_rate';
const MAX_ATTEMPTS = 3;
const LOCKOUT_MS   = 5 * 60 * 1000; // 5 minutes

function getRateState()  {
  try { return JSON.parse(sessionStorage.getItem(RATE_KEY) || '{}'); } catch { return {}; }
}
function checkRateLimit() {
  const { attempts = 0, lockedUntil = 0 } = getRateState();
  if (lockedUntil > Date.now()) {
    const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
    return { allowed: false, error: `Too many failed attempts. Try again in ${mins} minute(s).` };
  }
  return { allowed: true, attempts };
}
function recordFailedAttempt() {
  const { attempts = 0 } = getRateState();
  const next = attempts + 1;
  const lockedUntil = next >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0;
  try { sessionStorage.setItem(RATE_KEY, JSON.stringify({ attempts: next, lockedUntil })); } catch {}
}
function clearRateLimit() {
  try { sessionStorage.removeItem(RATE_KEY); } catch {}
}

// ── Login — async because password comparison is async ────────────────────────
export async function login(username, password) {
  // Rate limit check first
  const rate = checkRateLimit();
  if (!rate.allowed) return { success: false, error: rate.error };
  const users = getUsers();
  const cred  = username.trim().toLowerCase();
  const user  = users.find(u =>
    u.username?.toLowerCase() === cred ||
    u.email?.toLowerCase()    === cred
  );
  if (!user) return { success: false, error: 'Invalid username or password' };
  if (user.status && user.status !== 'Active') return { success: false, error: 'Account is inactive. Contact your administrator.' };

  const hashed = await hashPassword(password);

  // Migration path: if stored password is plain text, compare then upgrade on match
  // Guard: if stored password is null/undefined the account was created with a bug
  if (!user.password) {
    return { success: false, error: 'This account has no password set. Ask your administrator to edit the account and set a password.' };
  }

  let match = false;
  if (isLikelyPlainText(user.password)) {
    // Plain text: compare directly, then upgrade to hash in-place
    if (user.password === password.trim()) {
      match = true;
      const upgraded = users.map(u => u.id === user.id ? { ...u, password: hashed } : u);
      saveUsers(upgraded);
    }
  } else {
    match = hashed === user.password;
  }

  if (!match) {
    recordFailedAttempt();
    const remaining = MAX_ATTEMPTS - getRateState().attempts;
    const msg = remaining > 0
      ? `Invalid username or password. ${remaining} attempt(s) remaining.`
      : 'Account locked — too many failed attempts. Try again in 5 minutes.';
    return { success: false, error: msg };
  }
  clearRateLimit(); // reset on successful login
  saveSession(user);
  return { success: true, user };
}

export function logout() {
  clearSession();
  clearRateLimit();
}

// ── Permission helpers ────────────────────────────────────────────────────────
export function getPerms(role) {
  return ROLE_PERMS[role] || ROLE_PERMS.viewer;
}

export function canDo(user, action) {
  if (!user) return false;
  return getPerms(user.role)[action] ?? false;
}

export function visibleModules(user, allModules) {
  if (!user) return [];
  if (user.role === 'admin') return allModules;
  return (user.modules || []).filter(m => allModules.includes(m));
}

// ── Password strength validator ───────────────────────────────────────────────
export function validatePassword(pw, requireStrong = true) {
  if (!pw)              return 'Password is required';
  if (pw.length < 6)   return 'Password must be at least 6 characters';
  if (requireStrong) {
    if (pw.length < 8)                     return 'Strong password requires at least 8 characters';
    if (!/[A-Z]/.test(pw))                 return 'Must contain at least one uppercase letter';
    if (!/[a-z]/.test(pw))                 return 'Must contain at least one lowercase letter';
    if (!/[0-9!@#$%^&*()_+]/.test(pw))    return 'Must contain at least one number or symbol';
  }
  return null; // valid
}
