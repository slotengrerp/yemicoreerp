// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Login Screen v2.0
// Auth path priority:
//   1. Email input + Supabase ready → signInWithSupabase()
//   2. Username input (no @) OR Supabase not configured → legacy localStorage login
// Both paths call saveSession() so the session-timeout watcher in App.jsx works.
// ══════════════════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { login, saveSession, hashPassword, validatePassword, getUsers, saveUsers } from '../../utils/auth';
import { signInWithSupabase } from '../../supabase/auth';
import { supabaseReady } from '../../supabase/client';
import { showToast } from '../../utils/helpers';
import { SLOT_LOGO_SRC, SLOT_BRAND } from '../../utils/logo';

function getRecoveryCode() {
  try {
    const s = JSON.parse(localStorage.getItem('bc_settings') || '{}');
    return s?.security?.recoveryCode || '';
  } catch { return ''; }
}

export default function LoginScreen({ onLogin }) {
  const { C } = useTheme();
  const [mode,       setMode]       = useState('login');
  const [credential, setCredential] = useState(''); // accepts email OR username
  const [password,   setPassword]   = useState('');
  const [loading,    setLoading]    = useState(false);
  const [showPw,     setShowPw]     = useState(false);
  const [fpUser,     setFpUser]     = useState('');
  const [fpCode,     setFpCode]     = useState('');
  const [fpNew,      setFpNew]      = useState('');
  const [fpConfirm,  setFpConfirm]  = useState('');
  const [fpTarget,   setFpTarget]   = useState(null);

  const inp = {
    padding:'8px 10px', borderRadius:7, border:'1px solid '+C.border,
    background:C.bgCard, color:C.text, fontSize:13, width:'100%',
    outline:'none', fontFamily:'inherit', boxSizing:'border-box',
  };

  async function handleLogin(e) {
    e.preventDefault();
    const cred = credential.trim();
    if (!cred || !password) {
      showToast('Enter your email or username and password', 'error');
      return;
    }
    setLoading(true);
    try {
      const isEmail = cred.includes('@');

      // ── Step 1: Try Supabase Auth (only for email credentials when Supabase is ready) ──
      // Users with a Supabase Auth account get the full cloud-authenticated session.
      if (isEmail && supabaseReady) {
        const supaResult = await signInWithSupabase(cred, password);
        if (supaResult.success) {
          saveSession(supaResult.user);
          showToast('Welcome, ' + supaResult.user.name);
          onLogin(supaResult.user);
          return;
        }
        // Supabase rejected — could be wrong password OR user has no Supabase Auth account.
        // Always fall through to the local system before giving up.
      }

      // ── Step 2: Local user system (bc_users in localStorage) ──────────────────
      // Covers: users created in the Users module, legacy accounts, and any email
      // user whose Supabase login failed above. login() matches by email OR username.
      const localResult = await login(cred, password);
      if (localResult.success) {
        showToast('Welcome, ' + localResult.user.name);
        onLogin(localResult.user);
        return;
      }

      // ── Step 3: Nothing worked — show a clear, honest error ──────────────────
      // If both paths failed, show the specific error from the local system
      // (rate limit message, inactive account, wrong password count, etc.)
      showToast(localResult.error || 'Invalid credentials. Check your details and try again.', 'error');

    } catch (err) {
      console.error('[LoginScreen] handleLogin error:', err);
      showToast('Login failed. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleForgotVerify(e) {
    e.preventDefault();
    if (!fpUser.trim()) { showToast('Enter your username', 'error'); return; }
    if (!fpCode.trim()) { showToast('Enter the recovery code', 'error'); return; }
    const users = getUsers();
    const user  = users.find(u => u.username === fpUser.trim().toLowerCase());
    if (!user) { showToast('Username not found', 'error'); return; }
    const storedCode = getRecoveryCode();
    if (!storedCode) { showToast('No recovery code set. Contact your administrator.', 'error'); return; }
    if (fpCode.trim() !== storedCode) { showToast('Recovery code is incorrect', 'error'); return; }
    setFpTarget(user);
    setMode('reset');
  }

  async function handlePasswordReset(e) {
    e.preventDefault();
    const err = validatePassword(fpNew, true);
    if (err) { showToast(err, 'error'); return; }
    if (fpNew !== fpConfirm) { showToast('Passwords do not match', 'error'); return; }
    setLoading(true);
    try {
      const hashed  = await hashPassword(fpNew);
      const updated = getUsers().map(u => u.id === fpTarget.id ? { ...u, password: hashed } : u);
      saveUsers(updated);
      showToast('Password reset successfully. Please sign in.', 'success');
      setMode('login');
      setFpUser(''); setFpCode(''); setFpNew(''); setFpConfirm(''); setFpTarget(null);
    } catch {
      showToast('Reset failed. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }

  // Always accept email or username — both paths handle both
  const credLabel        = 'Email or Username';
  const credPlaceholder  = 'user@slotengineering.com or username';
  const credAutoComplete = credential.includes('@') ? 'email' : 'username';

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

          {mode === 'login' && (
            <>
              <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:20 }}>Sign in to your account</div>
              <form onSubmit={handleLogin} style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:5 }}>
                    {credLabel}
                  </label>
                  <input
                    style={inp}
                    value={credential}
                    onChange={e => setCredential(e.target.value)}
                    placeholder={credPlaceholder}
                    autoComplete={credAutoComplete}
                    autoFocus
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

              {/* Auth-mode indicator */}
              <div style={{ marginTop:12, padding:'10px 12px', background:C.green+'10', border:'1px solid '+C.green+'30', borderRadius:8, fontSize:11, color:C.textMuted, lineHeight:1.7 }}>
                🔑 Enter your <strong>email address</strong> or <strong>username</strong> and password.
                {supabaseReady && <span> Cloud authentication is active.</span>}
              </div>
            </>
          )}

          {mode === 'forgot' && (
            <>
              <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:6 }}>Reset Password — Step 1</div>
              <div style={{ fontSize:12, color:C.textMuted, marginBottom:20, lineHeight:1.6 }}>Enter your username and the recovery code set by your administrator.</div>
              <form onSubmit={handleForgotVerify} style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:5 }}>Username</label>
                  <input style={inp} value={fpUser} onChange={e => setFpUser(e.target.value)} placeholder="Your username" autoFocus />
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:5 }}>Recovery Code</label>
                  <input style={inp} value={fpCode} onChange={e => setFpCode(e.target.value)} placeholder="Provided by administrator" />
                </div>
                <button type="submit" style={{ padding:'9px 0', background:C.green, color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>Verify →</button>
              </form>
              <div style={{ marginTop:14, textAlign:'center' }}>
                <button onClick={() => setMode('login')} style={{ background:'none', border:'none', color:C.textMid, fontSize:12, cursor:'pointer' }}>← Back to login</button>
              </div>
              <div style={{ marginTop:12, padding:'10px 12px', background:'rgba(201,122,10,.08)', border:'1px solid rgba(201,122,10,.3)', borderRadius:8, fontSize:11, color:C.textMid, lineHeight:1.7 }}>
                ⚠ Recovery code is set in <strong>Settings → Security → Recovery Code</strong>. Only admins can set it.
              </div>
            </>
          )}

          {mode === 'reset' && fpTarget && (
            <>
              <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:4 }}>Reset Password — Step 2</div>
              <div style={{ fontSize:12, color:C.textMuted, marginBottom:20 }}>Setting new password for <strong>{fpTarget.name}</strong></div>
              <form onSubmit={handlePasswordReset} style={{ display:'flex', flexDirection:'column', gap:14 }}>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:5 }}>New Password</label>
                  <input type={showPw ? 'text' : 'password'} style={inp} value={fpNew} onChange={e => setFpNew(e.target.value)} placeholder="Min 8 chars, upper+lower, number/symbol" autoFocus />
                </div>
                <div>
                  <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:5 }}>Confirm Password</label>
                  <input type={showPw ? 'text' : 'password'} style={inp} value={fpConfirm} onChange={e => setFpConfirm(e.target.value)} />
                </div>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12, color:C.textMid }}>
                  <input type="checkbox" checked={showPw} onChange={() => setShowPw(p => !p)} /> Show passwords
                </label>
                <button
                  type="submit"
                  disabled={loading}
                  style={{ padding:'9px 0', background:C.green, color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:600, cursor:loading ? 'not-allowed' : 'pointer', opacity:loading ? 0.7 : 1 }}
                >
                  {loading ? 'Resetting…' : 'Reset Password →'}
                </button>
              </form>
            </>
          )}

          <div style={{ marginTop:14, textAlign:'center', fontSize:10, color:C.textLight }}>{SLOT_BRAND.name} · {SLOT_BRAND.address}</div>
        </div>
      </div>
    </div>
  );
}
