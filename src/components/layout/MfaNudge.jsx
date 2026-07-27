// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — MFA Enrollment Nudge
//
// Closes SEC-5 from SLOT_Full_Diagnostic_Audit_2026-07-27.md: utils/mfa.js has
// working TOTP MFA (real Supabase Auth enroll/verify calls) but nothing in the
// app ever prompted anyone to use it. This is the "nudge, don't block" version:
// admin/accountant users with no enrolled TOTP factor see a small dismissible
// banner after login. Dismissing snoozes it for 7 days. It never blocks access
// — a hard MFA requirement was deliberately NOT built here, since any admin who
// hasn't enrolled yet would be locked out of their own account immediately.
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useApp } from '../../context/AppContext';
import { Modal, Btn } from '../ui';
import { showToast } from '../../utils/helpers';
import { listFactors, enrollTOTP, verifyEnrollment } from '../../utils/mfa';
import { supabaseReady } from '../../supabase/client';

const SNOOZE_KEY   = 'slot_mfa_nudge_snoozed_until';
const NUDGE_ROLES  = ['admin', 'accountant'];
const SNOOZE_DAYS  = 7;

export default function MfaNudge() {
  const { C } = useTheme();
  const { state } = useApp();
  const { currentUser } = state;

  const [visible, setVisible]       = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollment, setEnrollment] = useState(null); // { factorId, qrCode, secret }
  const [code, setCode]             = useState('');
  const [busy, setBusy]             = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!supabaseReady || !currentUser || !NUDGE_ROLES.includes(currentUser.role)) return;
      const snoozedUntil = Number(localStorage.getItem(SNOOZE_KEY) || 0);
      if (snoozedUntil > Date.now()) return;
      const factors = await listFactors();
      if (cancelled) return;
      const hasTotp = factors.some(f => f.factor_type === 'totp' && f.status === 'verified');
      if (!hasTotp) setVisible(true);
    }
    check();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  function snooze() {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000)); } catch { /* storage disabled — nudge just reappears next session */ }
    setVisible(false);
  }

  async function startEnroll() {
    setBusy(true);
    try {
      const data = await enrollTOTP('SLOT ERP — ' + (currentUser?.name || currentUser?.email || 'user'));
      setEnrollment(data);
      setEnrollOpen(true);
      setVisible(false);
    } catch (e) {
      showToast('Could not start MFA setup: ' + (e?.message || 'unknown error'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll() {
    if (!enrollment?.factorId || code.trim().replace(/\s/g, '').length < 6) {
      showToast('Enter the 6-digit code from your authenticator app', 'error');
      return;
    }
    setBusy(true);
    try {
      await verifyEnrollment(enrollment.factorId, code);
      showToast('Two-factor authentication enabled', 'success');
      setEnrollOpen(false);
      setCode('');
      setEnrollment(null);
    } catch (e) {
      showToast('Verification failed: ' + (e?.message || 'invalid code'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!visible && !enrollOpen) return null;

  return (
    <>
      {visible && (
        <div style={{
          position:'fixed', bottom:16, right:16, zIndex:500, maxWidth:360,
          background:C.bgCard, border:'1px solid '+C.border, borderRadius:12,
          boxShadow:C.shadowModal, padding:'14px 16px',
        }}>
          <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
            <span style={{ fontSize:20 }}>🔐</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:4 }}>Add two-factor authentication</div>
              <div style={{ fontSize:12, color:C.textMuted, lineHeight:1.5, marginBottom:10 }}>
                Your role has access to financial and payroll data. We recommend enabling 2FA on your account.
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <Btn variant="primary" size="sm" onClick={startEnroll} disabled={busy}>Set up now</Btn>
                <Btn variant="ghost" size="sm" onClick={snooze}>Remind me later</Btn>
              </div>
            </div>
            <button onClick={snooze} title="Dismiss for 7 days" style={{ background:'none', border:'none', cursor:'pointer', color:C.textMuted, fontSize:16, lineHeight:1, padding:0 }}>×</button>
          </div>
        </div>
      )}

      {enrollOpen && enrollment && (
        <Modal title="🔐 Set up two-factor authentication" onClose={() => { setEnrollOpen(false); setCode(''); }}>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{ fontSize:12, color:C.textMuted, lineHeight:1.6 }}>
              Scan this QR code with Google Authenticator, 1Password, or any TOTP app, then enter the 6-digit code it shows.
            </div>
            {enrollment.qrCode && (
              <div style={{ textAlign:'center' }}>
                <img src={enrollment.qrCode} alt="MFA QR code" style={{ width:180, height:180, borderRadius:8, border:'1px solid '+C.border }} />
              </div>
            )}
            {enrollment.secret && (
              <div style={{ fontSize:11, color:C.textMuted, textAlign:'center' }}>
                Can't scan? Enter manually: <code style={{ fontFamily:'monospace', background:C.bgAlt, padding:'2px 6px', borderRadius:4 }}>{enrollment.secret}</code>
              </div>
            )}
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="6-digit code"
              maxLength={6}
              style={{ padding:'8px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:16, textAlign:'center', letterSpacing:'4px', fontFamily:'monospace' }}
            />
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
              <Btn variant="ghost" onClick={() => { setEnrollOpen(false); setCode(''); }}>Cancel</Btn>
              <Btn variant="primary" onClick={confirmEnroll} disabled={busy}>{busy ? 'Verifying…' : 'Verify & Enable'}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
