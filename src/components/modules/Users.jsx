// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Users Module v2.0 (Supabase-backed)
//
// As of v1.2, the user list is the source of truth in the `app_users`
// Postgres table (linked to Supabase Auth via auth_user_id). There is no
// longer a local users store in localStorage. All auth lifecycle (create,
// update, deactivate) goes through this module which talks to Supabase.
//
// What this means for the form:
//   • "Add User" creates BOTH the Supabase Auth account (email+password)
//     AND the linked app_users row in one atomic call (createSupabaseUser).
//   • "Edit User" updates the app_users row only (role, modules, status).
//   • "Deactivate" sets app_users.status = 'Inactive' — Supabase Auth
//     signInWithPassword is then rejected by the linked profile check in
//     supabase/auth.js (see status !== 'Active' guard there).
//   • Password changes go through Supabase's resetPasswordForEmail flow,
//     not through this form — keeps the bcrypt hashing on the server.
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { showToast } from '../../utils/helpers';
import { validatePassword, getAllRoles, getRoleLabel } from '../../utils/auth';
import { logActivity } from '../../utils/audit';
import { supabase, supabaseReady } from '../../supabase/client';
import { createSupabaseUser, updateSupabaseUser, disableSupabaseUser, enableSupabaseUser, adminResetPassword, requestPasswordReset } from '../../supabase/auth';
import { SLOT_BRAND } from '../../utils/logo';

// ── Roles & Module Access ────────────────────────────────────────────────────
// ROLES list is now dynamic — see getAllRoles(appSettings) from utils/auth,
// which returns the 5 built-ins plus any custom roles an admin has defined
// in Settings → Permissions.
const ALL_MODULES = [
  { id:'nlng',        label:'Contract Staff (NLNG)' },
  { id:'slot',        label:'Company Staff (SLOT)'  },
  { id:'procurement', label:'Procurement'            },
  { id:'inventory',   label:'Inventory'             },
  { id:'vehicles',    label:'Fleet / Vehicles'      },
  { id:'terminal',    label:'Terminal Operations'   },
  { id:'invoices',    label:'Invoices'              },
  { id:'pettycash',   label:'Petty Cash'            },
  { id:'request',     label:'Requests'              },
  { id:'accounting',  label:'Accounting'            },
  { id:'approvals',   label:'Approvals'             },
  { id:'analytics',   label:'Analytics'             },
  { id:'fixedassets', label:'Fixed Assets'          },
];

const ROLE_COLORS = { admin:'#1A5C2A', manager:'#C97A0A', accountant:'#1A5C8A', cashier:'#6A3A8A', viewer:'#4A6060' };

const EMPTY = { name:'', email:'', phone:'', username:'', role:'viewer', modules:[], status:'Active', password:'' };

// ── Sub-components ────────────────────────────────────────────────────────────
function Btn({ children, onClick, variant='primary', sm, disabled, style={} }) {
  const { C } = useTheme();
  const V = {
    primary: { bg:C.green,  co:'#fff', b:'none' },
    ghost:   { bg:'transparent', co:C.textMid, b:'1px solid '+C.border },
    danger:  { bg:C.danger, co:'#fff', b:'none' },
    amber:   { bg:C.amber,  co:'#fff', b:'none' },
    outline: { bg:'transparent', co:C.green, b:'1px solid '+C.green },
  }[variant] || {};
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background:V.bg, color:V.co, border:V.b, borderRadius:7,
        padding:sm?'4px 11px':'7px 16px', fontSize:sm?11.5:13, fontWeight:500,
        cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1,
        display:'inline-flex', alignItems:'center', gap:5, whiteSpace:'nowrap', ...style }}>
      {children}
    </button>
  );
}

function Tag({ role, appSettings }) {
  const co = ROLE_COLORS[role] || '#4A6060';
  const bg = co + '22';
  return (
    <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:20,
      fontSize:11, fontWeight:600, color:co, background:bg, border:`1px solid ${co}30` }}>
      {getRoleLabel(role, appSettings)}
    </span>
  );
}

function KPI({ label, value, accent, onClick }) {
  const { C } = useTheme();
  return (
    <div onClick={onClick} style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'13px 15px',
      flex:1, minWidth:120, position:'relative', boxShadow:C.shadowCard, cursor:onClick?'pointer':'default' }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4,
        background:accent||C.green, borderRadius:'12px 0 0 12px' }} />
      <div style={{ paddingLeft:8 }}>
        <div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase',
          letterSpacing:'0.5px', marginBottom:4 }}>{label}</div>
        <div style={{ fontSize:22, fontWeight:700, color:accent||C.green, lineHeight:1 }}>{value}</div>
      </div>
    </div>
  );
}

function Overlay({ children, onClose }) {
  // 2026-08-15: backdrop no longer closes the form on click — see same fix
  // in ui/index.jsx's shared Modal and Procurement.jsx's Overlay.
  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999,
      background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)',
      display:'flex', alignItems:'flex-start', justifyContent:'center',
      padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'100%', maxWidth:640, marginBottom:32 }}>
        {children}
      </div>
    </div>
  );
}

function FG({ label, children, full }) {
  const { C } = useTheme();
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, gridColumn:full?'1/-1':undefined }}>
      <label style={{ fontSize:11, fontWeight:600, color:C.textMid }}>{label}</label>
      {children}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Users() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser } = state;

  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [modal, setModal]       = useState(null); // null | {mode:'add'|'edit', data}
  const [confirm, setConfirm]   = useState(null); // userId to toggle

  // Load users from app_users table.
  // CRITICAL: previously the IIFE had no try/catch — a network error, RLS
  // denial, or supabase.from() being undefined (e.g. when supabaseReady is
  // true but the client failed to initialise) became an UNHANDLED REJECTION
  // that crashed the test suite and would silently leave the loading spinner
  // spinning forever in production. Now every failure path sets a clear
  // toast and setLoading(false).
  useEffect(() => {
    if (!supabaseReady) { setUsers([]); return; }
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('app_users')
          .select('id, username, name, email, role, modules, status, phone, created_at')
          .order('created_at', { ascending: true });
        if (cancelled) return;
        if (error) {
          showToast('Failed to load users: ' + error.message, 'error');
          setUsers([]);
        } else {
          setUsers(data || []);
        }
      } catch (e) {
        if (!cancelled) {
          showToast('Failed to load users: ' + (e?.message || 'unknown error'), 'error');
          setUsers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabaseReady]);

  const filtered = useMemo(() => {
    let list = users;
    if (roleFilter === 'active')   list = list.filter(u => u.status === 'Active');
    if (roleFilter === 'inactive') list = list.filter(u => u.status !== 'Active');
    if (roleFilter === 'admin')    list = list.filter(u => u.role === 'admin');
    const q = search.toLowerCase();
    return list.filter(u =>
      [u.name, u.email, u.role, u.phone, u.status].some(v => (v||'').toLowerCase().includes(q))
    );
  }, [users, search, roleFilter]);

  const counts = {
    total:  users.length,
    active: users.filter(u=>u.status==='Active').length,
    admin:  users.filter(u=>u.role==='admin').length,
    inactive: users.filter(u=>u.status!=='Active').length,
  };

  async function handleSave(form) {
    if (!form.name?.trim() || !form.email?.trim()) { showToast('Name and email are required','error'); return; }
    if (modal.mode === 'add') {
      if (!form.password?.trim()) { showToast('Password is required for new users', 'error'); return; }
      const pwErr = validatePassword(form.password, true);
      if (pwErr) { showToast(pwErr, 'error'); return; }
      setLoading(true);
      const result = await createSupabaseUser({
        email:    form.email.trim().toLowerCase(),
        password: form.password,
        name:     form.name.trim(),
        username: (form.username?.trim() || form.email.split('@')[0]).toLowerCase().replace(/[^a-z0-9._]/g,''),
        role:     form.role,
        modules:  form.modules || [],
        // companyId is implicit from RLS — the new row will be inserted
        // with the same company_id as the current admin (the trigger in
        // 002_rls.sql uses auth.uid() to derive it). For multi-company
        // deployments, a service-role call would set it explicitly.
      });
      setLoading(false);
      if (!result.success) {
        showToast('Failed to create user: ' + (result.error || 'unknown error'), 'error');
        return;
      }
      // Reload the list to pick up the new row
      const { data } = await supabase.from('app_users').select('id, username, name, email, role, modules, status, phone, created_at').order('created_at', { ascending: true });
      setUsers(data || []);
      logActivity(dispatch, `Created user: ${form.name} (${form.role})`, currentUser);
      showToast(`✅ User created — they can sign in with ${form.email}`, 'success');
      setModal(null);
    } else {
      // Edit: route through the manage-users Edge Function so the admin
      // keeps their own session, and so any future server-side validation
      // (e.g. "can't demote the last admin") is enforced in one place.
      setLoading(true);
      const result = await updateSupabaseUser(form.id, {
        name:    form.name.trim(),
        role:    form.role,
        modules: form.modules || [],
        status:  form.status,
        phone:   form.phone || null,
      });
      setLoading(false);
      if (!result.success) {
        showToast('Failed to update user: ' + (result.error || 'unknown error'), 'error');
        return;
      }
      // Refresh the row from the server response so the UI shows the canonical state
      setUsers(users.map(u => u.id===form.id ? { ...u, ...result.profile, password: undefined } : u));
      logActivity(dispatch, `Updated user: ${form.name}`, currentUser);
      showToast('User updated');
      setModal(null);
    }
  }

  async function handleToggle(userId) {
    const u = users.find(x=>x.id===userId);
    if (!u) return;
    const next = u.status==='Active' ? 'Inactive' : 'Active';
    setLoading(true);
    const result = next === 'Inactive' ? await disableSupabaseUser(userId) : await enableSupabaseUser(userId);
    setLoading(false);
    if (!result.success) {
      showToast('Failed to update status: ' + (result.error || 'unknown error'), 'error');
      return;
    }
    setUsers(users.map(x => x.id===userId ? {...x, status:next} : x));
    logActivity(dispatch, `${next==='Inactive'?'Deactivated':'Reactivated'} user: ${u.name}`, currentUser);
    showToast(`User ${next==='Inactive'?'deactivated':'reactivated'}`);
    setConfirm(null);
  }

  async function handleSendReset(userId, email) {
    if (!userId) return;
    setLoading(true);
    // Routes through the Edge Function so the reset email is sent from
    // server-side (Supabase's built-in reset flow).
    const result = await adminResetPassword(userId);
    setLoading(false);
    if (result.success) {
      showToast(`Password-reset link sent to ${email}`, 'success');
    } else {
      showToast('Could not send reset link: ' + (result.error || 'unknown error'), 'error');
    }
  }

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border,
    background:C.bgCard, color:C.text, fontSize:13, outline:'none', fontFamily:'inherit', width:'100%' };
  const th = { padding:'9px 10px', textAlign:'left', fontSize:10.5, fontWeight:700,
    color:C.tableHeaderText||C.textMid, textTransform:'uppercase', letterSpacing:'.4px',
    whiteSpace:'nowrap', background:C.tableHeaderBg||C.greenPale, borderBottom:'2px solid '+C.border };
  const td = i => ({ padding:'9px 10px', borderBottom:'1px solid '+C.borderLight,
    color:C.text, fontSize:12.5, background:i%2===1?C.greenPale2:'transparent' });

  if (!supabaseReady) {
    return (
      <div style={{ padding:40, textAlign:'center', color:C.textMuted }}>
        <div style={{ fontSize:15, fontWeight:600, marginBottom:8 }}>Supabase is not configured</div>
        <div style={{ fontSize:13 }}>User management requires a Supabase connection. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your <code>.env</code>.</div>
      </div>
    );
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* Cloud-Login explainer — kept as a one-liner since users are now
          always cloud-managed; the elaborate 4-step setup guide from the
          v1.x era is gone (no manual SQL linking needed). */}
      <div style={{ background:C.green+'10', border:'1px solid '+C.green+'40', borderRadius:10, padding:'10px 16px', fontSize:12, color:C.textMid, lineHeight:1.6 }}>
        🔐 <strong>Cloud-managed users.</strong> This list is the <code style={{ background:C.greenPale, padding:'1px 5px', borderRadius:3 }}>app_users</code> table in Supabase. New users get a Supabase Auth account automatically when you add them here. Password changes go through the email-reset flow — never stored in the browser.
      </div>

      {/* KPI row */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <KPI label="Total Users"    value={counts.total}    accent={C.green}   onClick={()=>setRoleFilter("")} />
        <KPI label="Active"         value={counts.active}   accent={C.success} onClick={()=>setRoleFilter("active")} />
        <KPI label="Admin Accounts" value={counts.admin}    accent={C.amber}   onClick={()=>setRoleFilter("admin")} />
        <KPI label="Inactive"       value={counts.inactive} accent={C.danger}  onClick={()=>setRoleFilter("inactive")} />
      </div>

      {/* Main card */}
      <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, boxShadow:C.shadowCard }}>
        <div style={{ padding:'14px 20px', background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',
          borderRadius:'12px 12px 0 0' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>👥 System User Management</div>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.6)', marginTop:2 }}>
            Control who can access {SLOT_BRAND.short} and what they can see
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ padding:'14px 20px', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search by name, email, role…"
            style={{ ...inp, flex:1, minWidth:220 }} />
          <Btn onClick={()=>setModal({mode:'add', data:{...EMPTY}})} disabled={loading}>+ Add User</Btn>
        </div>

        {/* Table */}
        <div style={{ padding:'0 20px 20px', overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:800 }}>
            <thead>
              <tr>
                {['S/N','Name','Email','Phone','Role','Modules','Status','Action'].map(h =>
                  <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} style={{ textAlign:'center', padding:40, color:C.textMuted }}>Loading…</td></tr>
              )}
              {!loading && filtered.length===0 && (
                <tr><td colSpan={8} style={{ textAlign:'center', padding:40, color:C.textMuted }}>
                  No users found
                </td></tr>
              )}
              {!loading && filtered.map((u, i) => (
                <tr key={u.id}>
                  <td style={td(i)}>{i+1}</td>
                  <td style={{ ...td(i), fontWeight:600 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ width:30, height:30, borderRadius:'50%', flexShrink:0,
                        background:ROLE_COLORS[u.role]+'33', border:'1.5px solid '+ROLE_COLORS[u.role]+'60',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:11, fontWeight:700, color:ROLE_COLORS[u.role] }}>
                        {(u.name||'U').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}
                      </div>
                      {u.name}
                    </div>
                  </td>
                  <td style={{ ...td(i), fontSize:11, color:C.textMuted }}>{u.email}</td>
                  <td style={{ ...td(i), fontSize:11 }}>{u.phone||'—'}</td>
                  <td style={td(i)}><Tag role={u.role} appSettings={state.appSettings} /></td>
                  <td style={td(i)}>
                    {u.role==='admin'
                      ? <span style={{ fontSize:11, color:C.green, fontWeight:600 }}>All Modules</span>
                      : <span style={{ fontSize:11, color:C.textMuted }}>{(u.modules||[]).length} module{(u.modules||[]).length!==1?'s':''}</span>
                    }
                  </td>
                  <td style={td(i)}>
                    <span style={{ fontSize:11, fontWeight:600,
                      color:u.status==='Active'?C.success:C.danger }}>
                      {u.status==='Active'?'● Active':'○ Inactive'}
                    </span>
                  </td>
                  <td style={td(i)}>
                    <div style={{ display:'flex', gap:4 }}>
                      <Btn variant="outline" sm onClick={()=>setModal({mode:'edit',data:{...u,password:''}})}>Edit</Btn>
                      <Btn variant="ghost" sm onClick={()=>handleSendReset(u.id, u.email)} disabled={!u.email}
                        title="Send password-reset email">🔑</Btn>
                      {u.id !== currentUser?.id && (
                        <Btn variant={u.status==='Active'?'danger':'ghost'} sm
                          onClick={()=>setConfirm(u.id)}>
                          {u.status==='Active'?'Deactivate':'Activate'}
                        </Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {modal && (
        <Overlay onClose={()=>setModal(null)}>
          <UserModal mode={modal.mode} data={modal.data} onSave={handleSave} onClose={()=>setModal(null)} loading={loading} appSettings={state.appSettings} />
        </Overlay>
      )}

      {/* Confirm deactivate/activate */}
      {confirm && (() => {
        const u = users.find(x=>x.id===confirm);
        return (
          <Overlay onClose={()=>setConfirm(null)}>
            <div style={{ background:C.bgCard, borderRadius:12, padding:24, border:'1px solid '+C.border }}>
              <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>
                {u?.status==='Active' ? '⚠️ Deactivate User?' : '✅ Reactivate User?'}
              </div>
              <div style={{ fontSize:13, color:C.textMuted, marginBottom:20 }}>
                {u?.status==='Active'
                  ? `${u?.name} will lose access to ${SLOT_BRAND.short} immediately.`
                  : `${u?.name} will regain access to ${SLOT_BRAND.short}.`}
              </div>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                <Btn variant="ghost" onClick={()=>setConfirm(null)}>Cancel</Btn>
                <Btn variant={u?.status==='Active'?'danger':'primary'}
                  onClick={()=>handleToggle(confirm)}>
                  {u?.status==='Active'?'Yes, Deactivate':'Yes, Reactivate'}
                </Btn>
              </div>
            </div>
          </Overlay>
        );
      })()}
    </div>
  );
}

// ── User Form Modal ───────────────────────────────────────────────────────────
function UserModal({ mode, data, onSave, onClose, loading, appSettings }) {
  const { C } = useTheme();
  const [f, setF] = useState({ ...data });
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  const isEdit = mode === 'edit';

  function toggleModule(id) {
    setF(p => ({
      ...p,
      modules: p.modules.includes(id) ? p.modules.filter(m=>m!==id) : [...p.modules, id],
    }));
  }

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border,
    background:C.bgCard, color:C.text, fontSize:13, outline:'none', fontFamily:'inherit', width:'100%' };

  return (
    <div style={{ background:C.bgCard, borderRadius:12, border:'1px solid '+C.border, overflow:'hidden' }}>
      {/* Header */}
      <div style={{ padding:'14px 20px', background:'linear-gradient(135deg,#0F3A1A,#1A5C2A)',
        display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>
          {isEdit ? '✏️ Edit User' : '+ Add New User'}
        </div>
        <button onClick={onClose} style={{ background:'rgba(255,255,255,0.15)', border:'none',
          borderRadius:'50%', width:28, height:28, color:'#fff', fontSize:16,
          cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
      </div>

      <div style={{ padding:20 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
          <FG label="Full Name" full>
            <input style={inp} value={f.name} onChange={set('name')} placeholder="e.g. Tunde Adeyemi" />
          </FG>
          <FG label="Email Address">
            <input style={inp} type="email" value={f.email} onChange={set('email')} placeholder="user@slotengineering.com"
              disabled={isEdit} title={isEdit ? 'Email is managed by Supabase Auth — change it in the Supabase Dashboard' : ''} />
          </FG>
          <FG label="Phone Number">
            <input style={inp} value={f.phone||''} onChange={set('phone')} placeholder="e.g. 08031234567" />
          </FG>
          <FG label="Username (auto-generated from email if blank)">
            <input style={inp} value={f.username||''} onChange={set('username')}
              placeholder={f.email ? f.email.split('@')[0].toLowerCase() : 'e.g. tunde.adeyemi'}
              disabled={isEdit}
              title={isEdit ? 'Username cannot be changed after creation' : 'Leave blank to auto-generate from email'} />
          </FG>
          <FG label="Role">
            <select style={inp} value={f.role} onChange={set('role')}>
              {getAllRoles(appSettings).map(r=><option key={r.key} value={r.key}>{r.label}{!r.builtin ? ' (custom)' : ''}</option>)}
            </select>
          </FG>
          {!isEdit && (
            <FG label="Password (Supabase Auth handles the hashing)" full>
              <input style={inp} type="password" value={f.password||''} onChange={set('password')}
                placeholder="Min 8 chars, mixed case, number/symbol" autoComplete="new-password" />
            </FG>
          )}
          {isEdit && (
            <FG label="Status" full>
              <select style={inp} value={f.status} onChange={set('status')}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </FG>
          )}
        </div>

        {/* Module access (hide for admin — they get everything) */}
        {f.role !== 'admin' && (
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:600, color:C.textMid, marginBottom:8,
              textTransform:'uppercase', letterSpacing:'.4px' }}>
              Module Access
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:6 }}>
              {ALL_MODULES.map(m => {
                const checked = (f.modules||[]).includes(m.id);
                return (
                  <label key={m.id} style={{ display:'flex', alignItems:'center', gap:8,
                    padding:'6px 10px', borderRadius:7, cursor:'pointer',
                    background:checked?C.green+'15':C.bgAlt||C.bgCard,
                    border:'1px solid '+(checked?C.green:C.border) }}>
                    <input type="checkbox" checked={checked} onChange={()=>toggleModule(m.id)}
                      style={{ width:14, height:14, accentColor:C.green }} />
                    <span style={{ fontSize:12, color:checked?C.green:C.text }}>{m.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        {f.role === 'admin' && (
          <div style={{ padding:'10px 14px', background:C.green+'15', border:'1px solid '+C.green+'40',
            borderRadius:8, marginBottom:16, fontSize:12, color:C.green }}>
            ✓ Admin users automatically have access to all modules
          </div>
        )}

        {/* Footer */}
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', paddingTop:14,
          borderTop:'1px solid '+C.borderLight }}>
          <button onClick={onClose} style={{ padding:'7px 16px', borderRadius:7,
            background:'transparent', border:'1px solid '+C.border, color:C.textMid,
            fontSize:13, cursor:'pointer' }}>Cancel</button>
          <button onClick={()=>onSave(f)} disabled={loading}
            style={{ padding:'7px 18px', borderRadius:7, background:C.green,
              border:'none', color:'#fff', fontSize:13, fontWeight:600,
              cursor:loading?'not-allowed':'pointer', opacity:loading?0.7:1 }}>
            {isEdit ? 'Update User' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}