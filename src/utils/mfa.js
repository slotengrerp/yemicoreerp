/* eslint-disable no-empty */
// Empty catch blocks in this file are intentional: localStorage writes and
// the rate-limiter persistence can fail when storage is disabled or quota
// is hit, and there's no recovery action — the user just falls back to the
// in-memory or default state. Failing loudly here would degrade UX without
// benefit.

// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — MFA (TOTP) Scaffold v1.0
//
// The audit's Tier-2 finding: no MFA, no account lockout (the legacy
// localStorage system has a sessionStorage-based 3-strike / 5-min lockout
// but it's tied to a single browser; a determined attacker on a different
// browser gets unlimited tries).
//
// The proper fix is server-side MFA via Supabase Auth, which has built-in
// TOTP support. This module:
//   • Calls supabase.auth.mfa.enroll() to start enrolment
//   • Stores the QR code URL + secret in component state for the user to
//     scan with Google Authenticator / 1Password
//   • Calls supabase.auth.mfa.verify() with the user's first 6-digit code
//     to confirm they set it up correctly
//   • Calls supabase.auth.mfa.challenge() + verify() at every login to
//     gate access behind a fresh code
//
// The current code path is "available" but not "enforced by default" —
// admins can opt in per-company via Settings → Security → MFA Required.
// ══════════════════════════════════════════════════════════════════════════════
import { supabase, supabaseReady } from '../supabase/client';

const MFA_KEY = 'bc_mfa_factor_id';

// ── Enrolment ────────────────────────────────────────────────────────────────
// Returns { qrCode (data URL), secret, factorId } on success.
// Throws on failure.
export async function enrollTOTP(friendlyName = 'SLOT ERP') {
  if (!supabaseReady) throw new Error('Supabase not configured — MFA requires Supabase Auth');
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'TOTP',
    friendlyName,
  });
  if (error) throw error;
  return {
    factorId: data?.id,
    qrCode:   data?.totp?.qr_code,    // data: URL for <img src>
    secret:   data?.totp?.secret,    // base32 secret for manual entry
    uri:      data?.totp?.uri,
  };
}

// ── Verification during enrolment — confirm the user can produce a valid code
export async function verifyEnrollment(factorId, code) {
  if (!supabaseReady) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: String(code).replace(/\s/g, ''),
  });
  if (error) throw error;
  try { localStorage.setItem(MFA_KEY, factorId); } catch {}
  return data;
}

// ── Challenge + verify on every login ───────────────────────────────────────
export async function challengeMFA(factorId) {
  if (!supabaseReady) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.mfa.challenge({ factorId });
  if (error) throw error;
  return data;  // { id: challengeId, expires_at }
}

export async function verifyChallenge(challengeId, code) {
  if (!supabaseReady) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.mfa.verify({
    challengeId,
    code: String(code).replace(/\s/g, ''),
  });
  if (error) throw error;
  return data;
}

// ── List / unenrol ───────────────────────────────────────────────────────────
export async function listFactors() {
  if (!supabaseReady) return [];
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return [];
  return data?.all || [];
}

export async function unenrollFactor(factorId) {
  if (!supabaseReady) return false;
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return false;
  try { localStorage.removeItem(MFA_KEY); } catch {}
  return true;
}

// ── Account lockout (client-side rate limiter, audit Tier-2 finding) ────────
// A determined attacker can clear localStorage, so this is defence-in-depth
// only — server-side lockout via Supabase Auth is the real barrier (built-in
// rate limiting on signInWithPassword). This catches casual brute-force on
// the legacy localStorage path.
const RATE_KEY     = 'bc_login_rate_v2';
const MAX_ATTEMPTS = 5;          // 5 strikes
const LOCKOUT_MS   = 15 * 60_000; // 15 minutes

function getRateState() {
  try { return JSON.parse(localStorage.getItem(RATE_KEY) || '{}'); } catch { return {}; }
}
function saveRateState(s) {
  try { localStorage.setItem(RATE_KEY, JSON.stringify(s)); } catch {}
}
export function checkAccountLockout() {
  const { lockedUntil = 0 } = getRateState();
  if (lockedUntil > Date.now()) {
    const mins = Math.ceil((lockedUntil - Date.now()) / 60_000);
    return { locked: true, minutesRemaining: mins };
  }
  return { locked: false };
}
export function recordFailedLogin() {
  const s = getRateState();
  s.attempts = (s.attempts || 0) + 1;
  s.lockedUntil = s.attempts >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0;
  saveRateState(s);
  return { attempts: s.attempts, locked: s.lockedUntil > Date.now() };
}
export function clearLoginLockout() {
  try { localStorage.removeItem(RATE_KEY); } catch {}
}
