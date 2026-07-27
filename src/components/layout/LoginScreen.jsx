// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Login Screen v3.0
//
// Auth model: Supabase is the ONLY source of truth for authentication.
//   • Email + password is verified by Supabase Auth (server-side bcrypt)
//   • The user profile (role, modules, company) is loaded from the
//     `app_users` Postgres table, joined by auth_user_id = auth.uid()
//   • There is NO localStorage-based login, no SHA-256 client hashing,
//     no recovery code, no DEFAULT_ADMIN fallback.
//
// Why this matters: every auth-related vulnerability that the independent
// audit flagged (client-side hashing, no MFA, no rate limit, recovery
// code in localStorage) lived in the old localStorage path. Removing that
// path entirely closes them. If Supabase is not configured, you can't
// log in — and that's the correct failure mode for a system that
// explicitly refuses to hold passwords locally.
//
// Password reset: delegated to Supabase's resetPasswordForEmail() flow.
// The user receives a reset link by email, sets a new password in
// Supabase's hosted reset page, and is signed back in.
// ══════════════════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { signInWithSupabase, requestPasswordReset } from '../../supabase/auth';
import { supabaseReady, supabase } from '../../supabase/client';
import { showToast } from '../../utils/helpers';
import { SLOT_LOGO_SRC, SLOT_BRAND } from '../../utils/logo';

export default function LoginScreen({ onLogin }) {
  const { C } = useTheme();
  const [mode,       setMode]       = useState('login');
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [loading,    setLoading]    = useState(false);
  const [showPw,     setShowPw]     = useState(false);

  // If Supabase isn't configured, we can't authenticate at all — render a
  // setup-required screen instead of a form that pretends to work. This
  // intentionally removes the "username" / "local fallback" path that the
  // audit called out as a security risk.
  const authConfigured = supabaseReady && !!supabase;

  const inp = {
    padding:'8px 10px', borderRadius:7, border:'1px solid '+C.border,
    background:C.bgCard, color:C.text, fontSize:13, width:'100%',
    outline:'none', fontFamily:'inherit', boxSizing:'border-box',
  };

  async function handleLogin(e) {
    e.preventDefault();
    const eAddr = email.trim().toLowerCase();
    if (!eAddr || !password) {
      showToast('Enter your email and password', 'error');
      return;
    }
    if (!authConfigured) {
      showToast('Authentication service is not configured. Contact your administrator.', 'error');
      return;
    }
    setLoading(true);
    try {
      const result = await signInWithSupabase(eAddr, password);
      if (result.success) {
        showToast('Welcome, ' + result.user.name);
        onLogin(result.user);
        return;
      }
      showToast(result.error || 'Sign-in failed. Please try again.', 'error');
    } catch (err) {
      console.error('[LoginScreen] handleLogin error:', err);
      showToast('Sign-in failed. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    const eAddr = email.trim().toLowerCase();
    if (!eAddr) { showToast('Enter your email address first', 'error'); return; }
    if (!authConfigured) {
      showToast('Authentication service is not configured. Contact your administrator.', 'error');
      return;
    }
    setLoading(true);
    try {
      const result = await requestPasswordReset(eAddr);
      if (result.success) {
        showToast('Password-reset link sent. Check your email.', 'success');
        setMode('login');
      } else {
        showToast(result.error || 'Could not send reset link. Try again.', 'error');
      }
    } catch (err) {
      showToast('Reset request failed. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ width:'100%', maxWidth:420 }}>

        {/* Banner */}
        <div style={{ background:'linear-gradient(135deg,#0F3A1A 0%,#1A5C2A 55%,#2E7D40 100%)', borderRadius:'14px 14px 0 0', padding:'28px 32px 24px', position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', left:0, top:0, bottom:0, width:6, background:'#C97A0A', borderRadius:'14px 0 0 14px' }} />
          <div style={{ display:'flex', alignItems:'center', gap:16, paddingLeft:8 }}>
            <div style={{ background:'#fff', borderRadius:10, padding:'6px 8px', flexShrink:0 }}>
              <img src={SLOT_LOGO_SRC} alt="SLOT Engineering" style={{ height:48, width:'auto', display:'block' }} />
            </div>
            <div>
              <div style={{ fontSize:10, color:'rgba(255,255,255,0.6)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:5 }}>Enterprise Resource Portal</div>
              <div style={{ fontSize:18, fontWeight:800, color:'#FFFFFF' }}>{SLOT_BRAND.name}</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.65)', marginTop:5 }}>{SLOT_BRAND.tagline}</div>
            </div>
          </div>
        </div>

        {/* Card */}
        <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderTop:'none', borderRadius:'0 0 14px 14px', padding:'28px 32px', boxShadow:C.shadowCard }}>

          {!authConfigured ? (
            // ── Supabase not configured — refuse to render a login form ─────
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:C.danger, marginBottom:10 }}>⚠ Authentication not configured</div>
              <div style={{ fontSize:13, color:C.textMid, lineHeight:1.6, marginBottom:14 }}>
                Supabase Auth is required to sign in. Add these to your
                <code style={{ fontFamily:'monospace', background:C.greenPale, padding:'2px 5px', borderRadius:4, margin:'0 4px' }}>.env</code>
                and redeploy:
              </div>
              <pre style={{ background:'#0b1410', color:'#DDE9DE', padding:'12px 14px', borderRadius:8, fontSize:11.5, fontFamily:'monospace', lineHeight:1.6, overflowX:'auto', margin:'0 0 12px' }}>
{`VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>`}
              </pre>
              <div style={{ fontSize:11, color:C.textMuted, lineHeight:1.5 }}>
                Then create at least one user in
                <strong> Supabase Dashboard → Authentication → Users</strong>
                and link it to an
                <code style={{ fontFamily:'monospace', background:C.greenPale, padding:'1px 4px', borderRadius:3, margin:'0 3px' }}>app_users</code>
                row in the SQL editor.
              </div>
            </div>
          ) : mode === 'login' ? (
            <>
              <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:20 }}>Sign in to your account</div>
              <form onSubmit={handleLogin} style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:5 }}>Email</label>
                  <input
                    style={inp}
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@slotengineering.com"
                    autoComplete="email"
                    autoFocus
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:5 }}>Password</label>
                  <div style={{ position:'relative' }}>
                    <input
                      style={{ ...inp, paddingRight:40 }}
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Enter password"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(p => !p)}
                      style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:C.textMuted, fontSize:14, padding:0 }}
                    >
                      {showPw ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  style={{ marginTop:4, padding:'9px 0', background:C.green, color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:loading ? 'not-allowed' : 'pointer', opacity:loading ? 0.7 : 1 }}
                >
                  {loading ? 'Signing in…' : 'Sign In →'}
                </button>
              </form>
              <div style={{ marginTop:14, textAlign:'center' }}>
                <button onClick={() => setMode('forgot')} style={{ background:'none', border:'none', color:C.green, fontSize:12, cursor:'pointer', textDecoration:'underline' }}>
                  Forgot password?
                </button>
              </div>
              <div style={{ marginTop:12, padding:'10px 12px', background:C.green+'10', border:'1px solid '+C.green+'30', borderRadius:8, fontSize:11, color:C.textMuted, lineHeight:1.7 }}>
                🔒 Authentication is handled by <strong>Supabase Auth</strong>. Your password is never sent to or stored by this application.
              </div>
            </>
          ) : (
            // mode === 'forgot'
            <>
              <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:6 }}>Reset password</div>
              <div style={{ fontSize:12, color:C.textMuted, marginBottom:20, lineHeight:1.6 }}>
                Enter your email address and we'll send you a link to choose a new password.
              </div>
              <form onSubmit={handleForgot} style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:5 }}>Email</label>
                  <input
                    style={inp}
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@slotengineering.com"
                    autoComplete="email"
                    autoFocus
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  style={{ padding:'9px 0', background:C.green, color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:loading ? 'not-allowed' : 'pointer', opacity:loading ? 0.7 : 1 }}
                >
                  {loading ? 'Sending…' : 'Send reset link →'}
                </button>
              </form>
              <div style={{ marginTop:14, textAlign:'center' }}>
                <button onClick={() => setMode('login')} style={{ background:'none', border:'none', color:C.textMid, fontSize:12, cursor:'pointer' }}>← Back to sign in</button>
              </div>
            </>
          )}

          <div style={{ marginTop:14, textAlign:'center', fontSize:10, color:C.textLight }}>{SLOT_BRAND.name} · {SLOT_BRAND.address}</div>
        </div>
      </div>
    </div>
  );
}
