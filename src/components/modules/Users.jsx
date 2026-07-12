// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — USERS MODULE v1.0
// Admin-only · create / edit / deactivate system users · assign roles & modules
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { showToast, generateId } from '../../utils/helpers';
import { hashPassword, getUsers, saveUsers } from '../../utils/auth';
import { logActivity } from '../../utils/audit';
import { supabaseReady } from '../../supabase/client';

// ── Roles & Module Access ────────────────────────────────────────────────────
const ROLES = ['admin','manager','accountant','cashier','viewer'];
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

const SEED_USERS = [
  { id:'u1', name:'Admin User', email:'admin@slotengineering.com', role:'admin',
    modules: ALL_MODULES.map(m=>m.id), status:'Active', createdAt:'2026-01-01T00:00:00Z', phone:'08000000001' },
  { id:'u2', name:'Tunde Adeyemi', email:'tadeyemi@slotengineering.com', role:'manager',
    modules:['procurement','inventory','request','grn'], status:'Active', createdAt:'2026-02-01T00:00:00Z', phone:'08031234567' },
  { id:'u3', name:'Ngozi Okafor', email:'nokafor@slotengineering.com', role:'accountant',
    modules:['invoices','pettycash','grn'], status:'Active', createdAt:'2026-02-15T00:00:00Z', phone:'08041234567' },
  { id:'u4', name:'Samuel Ekwueme', email:'sekwueme@slotengineering.com', role:'viewer',
    modules:['procurement','inventory'], status:'Active', createdAt:'2026-03-01T00:00:00Z', phone:'08051234567' },
];

// Users are stored via auth.js getUsers()/saveUsers() — single source of truth
// that matches exactly what login() reads from.

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

function Tag({ role }) {
  const bg = ROLE_COLORS[role]+'22';
  const co = ROLE_COLORS[role] || '#4A6060';
  return (
    <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:20,
      fontSize:11, fontWeight:600, color:co, background:bg, border:`1px solid ${co}30`, textTransform:'capitalize' }}>
      {role}
    </span>
  );
}

function KPI({ label, value, accent, onClick }) {
  const { C } = useTheme();
  return (
    <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'13px 15px',
      flex:1, minWidth:120, position:'relative', boxShadow:C.shadowCard }}>
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
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:9999,
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

  // Single source of truth: same getUsers() that login() reads from
  const [users, setUsers] = useState(() => {
    const stored = getUsers();
    // If only DEFAULT_ADMIN exists (fresh install), seed with SLOT staff placeholders
    if (stored.length === 1 && stored[0].id === 'admin_default') {
      const seeded = [...stored, ...SEED_USERS];
      saveUsers(seeded);
      return seeded;
    }
    return stored;
  });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [modal, setModal]   = useState(null); // null | {mode:'add'|'edit', data}
  const [confirm, setConfirm] = useState(null); // userId to toggle

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

  function persist(list) {
    setUsers(list);
    saveUsers(list);
  }

  function handleSave(form) {
    if (!form.name?.trim() || !form.email?.trim()) { showToast('Name and email are required','error'); return; }
    if (modal.mode==='add') {
      const exists = users.some(u=>u.email.toLowerCase()===form.email.toLowerCase());
      if (exists) { showToast('Email already exists','error'); return; }
      // Auto-generate username from email if blank (e.g. tunde.adeyemi@sloteng.com → tunde.adeyemi)
      const autoUsername = (form.username?.trim() || form.email.split('@')[0]).toLowerCase().replace(/[^a-z0-9._]/g,'');
      if (!form.password?.trim()) { showToast('Password is required for new users','error'); return; }
      // Hash password before storing (async — wrap the rest in the handler)
      hashPassword(form.password.trim()).then(hashed => {
        const newUser = {
          ...form,
          id: generateId(),
          username: autoUsername,
          password: hashed,
          createdAt: new Date().toISOString(),
        };
        persist([...users, newUser]);
        logActivity(dispatch, `Created user: ${form.name} (${form.role}) — username: ${autoUsername}`, currentUser);
        showToast(`✅ User created! Login: ${autoUsername} (or email) + their password`, 'success');
        setModal(null);
      }).catch(() => showToast('Password hashing failed — try again','error'));
      return; // early return since we continue inside .then()
    } else {
      // If admin entered a new password → hash it; if left blank → keep existing hash
      if (form.password?.trim()) {
        hashPassword(form.password.trim()).then(hashed => {
          const updates = { ...form, password: hashed };
          persist(users.map(u => u.id===form.id ? { ...u, ...updates } : u));
          logActivity(dispatch, `Updated user (password changed): ${form.name}`, currentUser);
          showToast('User updated');
          setModal(null);
        }).catch(() => showToast('Password hashing failed — try again','error'));
      } else {
        // No new password — strip the blank field so existing hash is preserved
        const { password: _drop, ...safeForm } = form;
        persist(users.map(u => u.id===form.id ? { ...u, ...safeForm } : u));
        logActivity(dispatch, `Updated user: ${form.name}`, currentUser);
        showToast('User updated');
        setModal(null);
      }
    }
  }

  function handleToggle(userId) {
    const u = users.find(x=>x.id===userId);
    if (!u) return;
    const next = u.status==='Active' ? 'Inactive' : 'Active';
    persist(users.map(x => x.id===userId ? {...x, status:next} : x));
    logActivity(dispatch, `${next==='Inactive'?'Deactivated':'Reactivated'} user: ${u.name}`, currentUser);
    showToast(`User ${next==='Inactive'?'deactivated':'reactivated'}`);
    setConfirm(null);
  }

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border,
    background:C.bgCard, color:C.text, fontSize:13, outline:'none', fontFamily:'inherit', width:'100%' };
  const th = { padding:'9px 10px', textAlign:'left', fontSize:10.5, fontWeight:700,
    color:C.tableHeaderText||C.textMid, textTransform:'uppercase', letterSpacing:'.4px',
    whiteSpace:'nowrap', background:C.tableHeaderBg||C.greenPale, borderBottom:'2px solid '+C.border };
  const td = i => ({ padding:'9px 10px', borderBottom:'1px solid '+C.borderLight,
    color:C.text, fontSize:12.5, background:i%2===1?C.greenPale2:'transparent' });

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* ── Supabase Cloud Login Setup Guide ─────────────────────────────── */}
      {supabaseReady && (
        <div style={{ background:C.bgCard, border:'1px solid '+C.green+'40', borderRadius:12, overflow:'hidden', boxShadow:C.shadowCard }}>
          <div style={{ padding:'12px 18px', background:C.green+'18', borderBottom:'1px solid '+C.green+'30', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.green }}>🔐 Cloud Login Setup (Supabase Auth)</div>
            <span style={{ fontSize:11, color:C.textMuted }}>One-time task per user — admin only</span>
          </div>
          <div style={{ padding:'14px 18px', display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))', gap:14 }}>
            {[
              { step:'1', title:'Create Auth account', body:'Supabase Dashboard → Authentication → Users → Add User. Enter email + strong password. Tick "Auto Confirm User".' },
              { step:'2', title:'Copy the UUID', body:'Click the new user row. Copy the UUID from the User details panel (looks like xxxxxxxx-xxxx-xxxx-...).' },
              { step:'3', title:'Link in SQL Editor', body:"UPDATE app_users SET auth_user_id = '<uuid>' WHERE email = 'their@email.com';" },
              { step:'4', title:'Done', body:'The user logs in at the app with their email address. The 🔐 badge below confirms the link is active.' },
            ].map(({ step, title, body }) => (
              <div key={step} style={{ display:'flex', gap:10 }}>
                <div style={{ width:24, height:24, borderRadius:'50%', background:C.green, color:'#fff', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1 }}>{step}</div>
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:C.text, marginBottom:3 }}>{title}</div>
                  <div style={{ fontSize:11, color:C.textMuted, lineHeight:1.55, fontFamily:'monospace' }}>{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
            Control who can access BizCore and what they can see
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ padding:'14px 20px', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Search by name, email, role…"
            style={{ ...inp, flex:1, minWidth:220 }} />
          <Btn onClick={()=>setModal({mode:'add', data:{...EMPTY}})}>+ Add User</Btn>
        </div>

        {/* Table */}
        <div style={{ padding:'0 20px 20px', overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:800 }}>
            <thead>
              <tr>
                {['S/N','Name','Email','Phone','Role','Modules','Status','Cloud','Action'].map(h =>
                  <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.length===0 && (
                <tr><td colSpan={8} style={{ textAlign:'center', padding:40, color:C.textMuted }}>
                  No users found
                </td></tr>
              )}
              {filtered.map((u, i) => (
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
                  <td style={td(i)}><Tag role={u.role} /></td>
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
                    {supabaseReady
                      ? (u.email
                          ? <span style={{ fontSize:11, color:C.green, fontWeight:600 }} title="Supabase Auth linked — user can log in with email">🔐 Ready</span>
                          : <span style={{ fontSize:11, color:C.textMuted }} title="No email set — cannot use cloud login">—</span>)
                      : <span style={{ fontSize:11, color:C.textMuted }}>—</span>
                    }
                  </td>
                  <td style={td(i)}>
                    <div style={{ display:'flex', gap:4 }}>
                      <Btn variant="outline" sm onClick={()=>setModal({mode:'edit',data:{...u,password:''}})}>Edit</Btn>
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
          <UserModal mode={modal.mode} data={modal.data} onSave={handleSave} onClose={()=>setModal(null)} />
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
                  ? `${u?.name} will lose access to BizCore immediately.`
                  : `${u?.name} will regain access to BizCore.`}
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
function UserModal({ mode, data, onSave, onClose }) {
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
            <input style={inp} type="email" value={f.email} onChange={set('email')} placeholder="user@slotengineering.com" />
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
              {ROLES.map(r=><option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
            </select>
          </FG>
          <FG label={isEdit ? 'New Password (leave blank to keep current)' : 'Password'} full>
            <input style={inp} type="password" value={f.password||''} onChange={set('password')}
              placeholder={isEdit ? 'Leave blank to keep current password' : 'Set a strong password'} />
          </FG>
          <FG label="Status">
            <select style={inp} value={f.status} onChange={set('status')}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </FG>
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
          <button onClick={()=>onSave(f)}
            style={{ padding:'7px 18px', borderRadius:7, background:C.green,
              border:'none', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer' }}>
            {isEdit ? 'Update User' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}
