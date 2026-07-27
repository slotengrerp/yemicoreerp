// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Role / Permission Helpers
//
// As of v1.2 this module holds ONLY the role and permission helpers.
// The actual authentication (signing in, sessions, password reset) was
// moved entirely to Supabase Auth — see src/supabase/auth.js and the
// updated src/components/layout/LoginScreen.jsx. There is no longer any
// local password store, no SHA-256 client-side hashing, and no DEFAULT_ADMIN.
//
// Why this file still exists:
//   The role/permission model (admin / manager / accountant / cashier /
//   viewer) and the canDo() / visibleModules() helpers are the source of
//   truth for *what each role is allowed to do*. The auth identity comes
//   from Supabase; the authorization model stays here. They are separate
//   concerns and deliberately live in separate files.
//
// The session-timeout / activity-timestamp helpers were removed in v1.2
// because Supabase Auth manages session expiry server-side (the JWT has
// an exp claim, refreshed automatically by supabase-js). Keeping a
// separate local timeout would just create the false sense of being
// signed out when the Supabase JWT is still valid.
// ══════════════════════════════════════════════════════════════════════════════

export const ROLE_PERMS = {
  admin:      { canAdd: true,  canEdit: true,  canDelete: true,  canSettings: true,  canApprove: true  },
  manager:    { canAdd: true,  canEdit: true,  canDelete: false, canSettings: false, canApprove: true  },
  accountant: { canAdd: true,  canEdit: true,  canDelete: false, canSettings: false, canApprove: false },
  cashier:    { canAdd: true,  canEdit: false, canDelete: false, canSettings: false, canApprove: false },
  viewer:     { canAdd: false, canEdit: false, canDelete: false, canSettings: false, canApprove: false },
};

export const BUILTIN_ROLES = ['admin', 'manager', 'accountant', 'cashier', 'viewer'];

// ── Permission helpers (unchanged API — still called throughout the app) ──────
// getPerms(role) keeps its original signature and behaviour for every existing
// call site. moduleKey and appSettings are OPTIONAL extra params: when both
// are supplied AND an admin has configured a per-module override in
// Settings → Permissions, that override wins over the role default below.
// Without overrides configured, behaviour is identical to before this change.
//
// Custom roles: if `role` isn't one of the 5 built-ins, this now looks it up
// in appSettings.customRoles (an admin-managed list — see Settings →
// Permissions → Manage Roles) instead of silently falling back to viewer's
// restrictive defaults. A role that's genuinely unknown (deleted, or
// appSettings not passed) still falls back to viewer — that's the safe
// default, not a bug.
export function getPerms(role, moduleKey = null, appSettings = null) {
  let base = ROLE_PERMS[role];
  if (!base) {
    const custom = appSettings?.customRoles?.find(r => r.key === role);
    base = custom
      ? { canAdd: !!custom.canAdd, canEdit: !!custom.canEdit, canDelete: !!custom.canDelete, canSettings: !!custom.canSettings, canApprove: !!custom.canApprove }
      : ROLE_PERMS.viewer;
  }
  if (!moduleKey || !appSettings) return base;
  const override = appSettings?.permissionOverrides?.[role]?.[moduleKey];
  return override ? { ...base, ...override } : base;
}

export function canDo(user, action, moduleKey = null, appSettings = null) {
  if (!user) return false;
  return getPerms(user.role, moduleKey, appSettings)[action] ?? false;
}

// ── Role listing/labels — built-ins plus whatever custom roles an admin
// has defined in Settings → Permissions. Every place in the app that used
// to hardcode the 5 built-in roles (role dropdowns, approval-chain role
// pickers, the permissions matrix) should source its role list from here
// instead, so a custom role shows up everywhere consistently.
export function getAllRoles(appSettings) {
  const builtins = BUILTIN_ROLES.map(key => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1), builtin: true }));
  const custom = (appSettings?.customRoles || []).map(r => ({ key: r.key, label: r.label, builtin: false }));
  return [...builtins, ...custom];
}

export function getRoleLabel(role, appSettings) {
  if (BUILTIN_ROLES.includes(role)) return role.charAt(0).toUpperCase() + role.slice(1);
  const custom = appSettings?.customRoles?.find(r => r.key === role);
  return custom?.label || role;
}

// ── Slug generator for new custom role keys — lowercase, underscored,
// guaranteed unique against built-ins and existing custom roles.
export function slugifyRoleKey(label, existingKeys = []) {
  let base = (label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'role';
  let key = base, n = 2;
  const taken = new Set([...BUILTIN_ROLES, ...existingKeys]);
  while (taken.has(key)) { key = `${base}_${n}`; n++; }
  return key;
}

export function visibleModules(user, allModules) {
  if (!user) return [];
  if (user.role === 'admin') return allModules;
  return (user.modules || []).filter(m => allModules.includes(m));
}

// ── Password-strength validator (still useful for client-side hints) ────────
// The actual hashing is done server-side by Supabase; this only validates
// that the password meets a complexity policy before submitting.
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
