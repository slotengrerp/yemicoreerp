// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — SETTINGS MODULE v1.0
// Company branding · system preferences · fiscal year · security · display
// ══════════════════════════════════════════════════════════════════════════════
import { useState } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { showToast } from '../../utils/helpers';
import { saveSettingsLocal, getStorageHealth } from '../../utils/db';
import { saveSettingsCloud }  from '../../utils/db';
import { logActivity } from '../../utils/audit';
import { getUsers, saveUsers } from '../../utils/auth';

function Btn({ children, onClick, variant='primary', sm, disabled, style={} }) {
  const { C } = useTheme();
  const V = { primary:{bg:C.green,co:'#fff',b:'none'}, ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border}, danger:{bg:C.danger,co:'#fff',b:'none'}, outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green} }[variant]||{};
  return <button onClick={onClick} disabled={disabled} style={{ background:V.bg, color:V.co, border:V.b, borderRadius:7, padding:sm?'4px 11px':'7px 16px', fontSize:sm?11.5:13, fontWeight:500, cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1, display:'inline-flex', alignItems:'center', gap:5, whiteSpace:'nowrap', ...style }}>{children}</button>;
}

function FG({ label, full, hint, children }) {
  const { C } = useTheme();
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, gridColumn:full?'1/-1':undefined }}>
      <label style={{ fontSize:11, fontWeight:600, color:C.textMid }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize:10.5, color:C.textMuted, lineHeight:1.5 }}>{hint}</div>}
    </div>
  );
}

function Section({ icon, title, sub, children }) {
  const { C } = useTheme();
  return (
    <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, overflow:'hidden', boxShadow:C.shadowCard }}>
      <div style={{ padding:'14px 20px', borderBottom:'1px solid '+C.borderLight, display:'flex', alignItems:'center', gap:12 }}>
        <span style={{ fontSize:22 }}>{icon}</span>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:C.text }}>{title}</div>
          {sub && <div style={{ fontSize:11.5, color:C.textMuted, marginTop:1 }}>{sub}</div>}
        </div>
      </div>
      <div style={{ padding:'20px' }}>{children}</div>
    </div>
  );
}

const CURRENCIES  = ['₦ — Nigerian Naira','$ — US Dollar','€ — Euro','£ — British Pound','GHS — Ghana Cedi'];
const DATE_FMTS   = ['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','DD-MMM-YYYY'];
const FISCAL_MOS  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const INDUSTRIES   = ['Engineering & Logistics','Oil & Gas','Construction','Manufacturing','Consulting','Finance','Technology','Transport & Logistics'];

export default function Settings() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, appSettings, cloudReady } = state;

  const [s, setS] = useState(() => ({
    brand: {
      name:      appSettings?.brand?.name     || 'SLOT Engineering Nigeria Limited',
      short:     appSettings?.brand?.short    || 'SLOT Engineering',
      tagline:   appSettings?.brand?.tagline  || 'Engineering Excellence · Delivering Value',
      color:     appSettings?.brand?.color    || '#1A5C2A',
      amber:     appSettings?.brand?.amber    || '#C97A0A',
      currency:  appSettings?.brand?.currency || '₦',
      industry:  appSettings?.brand?.industry || 'Engineering & Logistics',
      address:   appSettings?.brand?.address  || 'Port Harcourt, Rivers State, Nigeria',
      phone:     appSettings?.brand?.phone    || '',
      email:     appSettings?.brand?.email    || '',
      rc:        appSettings?.brand?.rc       || '',
      tin:       appSettings?.brand?.tin      || '',
      website:   appSettings?.brand?.website  || 'www.slotengineeringng.com',
    },
    system: {
      dateFormat:    appSettings?.system?.dateFormat   || 'DD/MM/YYYY',
      fiscalYearStart: appSettings?.system?.fiscalYearStart || 'January',
      timezone:      appSettings?.system?.timezone     || 'Africa/Lagos',
      language:      appSettings?.system?.language     || 'English',
      autoSave:      appSettings?.system?.autoSave     ?? true,
      cloudSync:     appSettings?.system?.cloudSync    ?? true,
      auditTrail:    appSettings?.system?.auditTrail   ?? true,
    },
    security: {
      sessionTimeout: appSettings?.security?.sessionTimeout || 60,
      requireStrongPw: appSettings?.security?.requireStrongPw ?? true,
      recoveryCode: appSettings?.security?.recoveryCode || '',
      allowMultiSession: appSettings?.security?.allowMultiSession ?? false,
    },
  }));

  const [saving, setSaving] = useState(false);
  const [activeTab, setAT]  = useState('company');

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };

  async function handleSave() {
    if (!s.brand.name.trim()) { showToast('Company name is required','error'); return; }
    setSaving(true);
    const newSettings = {
      ...appSettings,
      brand:    s.brand,
      system:   s.system,
      security: s.security,
    };
    dispatch({ type:'SET_SETTINGS', payload: newSettings });
    saveSettingsLocal(newSettings);
    // FIX: session timeout is read directly from bc_settings by auth.js getSession()
    // saveSettingsLocal writes to bc_settings, so timeout is now truly enforced.
    if (cloudReady && s.system.cloudSync) {
      await saveSettingsCloud(newSettings);
    }
    logActivity(dispatch, `Settings updated by ${currentUser?.name}`, currentUser, { module:'settings', action:'edit' });
    showToast('Settings saved');
    setSaving(false);
  }

  const TABS = [
    { key:'company',  label:'Company',   icon:'🏢' },
    { key:'system',   label:'System',    icon:'⚙️' },
    { key:'security', label:'Security',  icon:'🔒' },
  ];

  const Toggle = ({ value, onChange, label }) => (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 0', borderBottom:'1px solid '+C.borderLight }}>
      <span style={{ fontSize:13, color:C.text }}>{label}</span>
      <div onClick={onChange} style={{ width:44, height:24, borderRadius:20, background:value?C.green:C.border, cursor:'pointer', position:'relative', transition:'background .2s', flexShrink:0 }}>
        <div style={{ position:'absolute', top:3, left:value?23:3, width:18, height:18, borderRadius:'50%', background:'#fff', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.3)' }} />
      </div>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Settings</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Company configuration · system preferences · security</div>
        </div>
        <Btn onClick={handleSave} disabled={saving}>{saving?'Saving…':'Save Changes'}</Btn>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', borderBottom:'2px solid '+C.borderLight }}>
        {TABS.map(t => (
          <button key={t.key} onClick={()=>setAT(t.key)} style={{ padding:'9px 18px', fontSize:13, border:'none', background:'none', cursor:'pointer', fontWeight:activeTab===t.key?700:400, color:activeTab===t.key?C.green:C.textMuted, borderBottom:activeTab===t.key?'2px solid '+C.green:'2px solid transparent', marginBottom:-2, display:'flex', alignItems:'center', gap:7, whiteSpace:'nowrap' }}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Company Settings */}
      {activeTab === 'company' && (
        <>
          <Section icon="🏢" title="Company Identity" sub="Legal name, branding, and registration details">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <FG label="Legal Company Name *" full><input style={inp} value={s.brand.name} onChange={e=>setS(p=>({...p,brand:{...p.brand,name:e.target.value}}))} /></FG>
              <FG label="Short Name / Trading Name"><input style={inp} value={s.brand.short} onChange={e=>setS(p=>({...p,brand:{...p.brand,short:e.target.value}}))} /></FG>
              <FG label="Tagline" full><input style={inp} value={s.brand.tagline} onChange={e=>setS(p=>({...p,brand:{...p.brand,tagline:e.target.value}}))} /></FG>
              <FG label="Industry"><select style={inp} value={s.brand.industry} onChange={e=>setS(p=>({...p,brand:{...p.brand,industry:e.target.value}}))}>{INDUSTRIES.map(i=><option key={i}>{i}</option>)}</select></FG>
              <FG label="RC Number"><input style={inp} value={s.brand.rc} onChange={e=>setS(p=>({...p,brand:{...p.brand,rc:e.target.value}}))} placeholder="CAC registration number" /></FG>
              <FG label="Tax ID Number (TIN)"><input style={inp} value={s.brand.tin} onChange={e=>setS(p=>({...p,brand:{...p.brand,tin:e.target.value}}))} /></FG>
              <FG label="Address" full><input style={inp} value={s.brand.address} onChange={e=>setS(p=>({...p,brand:{...p.brand,address:e.target.value}}))} /></FG>
              <FG label="Phone"><input style={inp} value={s.brand.phone} onChange={e=>setS(p=>({...p,brand:{...p.brand,phone:e.target.value}}))} placeholder="+234..." /></FG>
              <FG label="Email"><input style={inp} value={s.brand.email} onChange={e=>setS(p=>({...p,brand:{...p.brand,email:e.target.value}}))} placeholder="info@company.com" /></FG>
              <FG label="Website"><input style={inp} value={s.brand.website} onChange={e=>setS(p=>({...p,brand:{...p.brand,website:e.target.value}}))} /></FG>
            </div>
          </Section>

          <Section icon="🎨" title="Brand & Display" sub="Primary color, currency symbol">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
              <FG label="Primary Brand Color" hint="Used on documents, reports, and print headers">
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <input type="color" value={s.brand.color} onChange={e=>setS(p=>({...p,brand:{...p.brand,color:e.target.value}}))} style={{ width:48, height:38, borderRadius:7, border:'1px solid '+C.border, cursor:'pointer', padding:2 }} />
                  <input style={{ ...inp, fontFamily:'monospace' }} value={s.brand.color} onChange={e=>setS(p=>({...p,brand:{...p.brand,color:e.target.value}}))} placeholder="#1A5C2A" />
                </div>
              </FG>
              <FG label="Accent Color (Amber)" hint="Used for warnings and secondary elements">
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <input type="color" value={s.brand.amber} onChange={e=>setS(p=>({...p,brand:{...p.brand,amber:e.target.value}}))} style={{ width:48, height:38, borderRadius:7, border:'1px solid '+C.border, cursor:'pointer', padding:2 }} />
                  <input style={{ ...inp, fontFamily:'monospace' }} value={s.brand.amber} onChange={e=>setS(p=>({...p,brand:{...p.brand,amber:e.target.value}}))} placeholder="#C97A0A" />
                </div>
              </FG>
              <FG label="Currency Symbol">
                <select style={inp} value={s.brand.currency} onChange={e=>setS(p=>({...p,brand:{...p.brand,currency:e.target.value.split(' ')[0]}}))}>
                  {CURRENCIES.map(c=><option key={c}>{c}</option>)}
                </select>
              </FG>
            </div>
            <div style={{ marginTop:16, padding:'14px 16px', background:C.greenPale, borderRadius:10, display:'flex', alignItems:'center', gap:16 }}>
              <div style={{ width:40, height:40, borderRadius:8, background:s.brand.color, flexShrink:0 }} />
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:s.brand.color }}>{s.brand.name}</div>
                <div style={{ fontSize:11, color:C.textMuted, marginTop:1 }}>{s.brand.tagline}</div>
              </div>
              <div style={{ marginLeft:'auto', padding:'4px 12px', borderRadius:20, background:s.brand.amber, color:'#fff', fontSize:12, fontWeight:600 }}>Preview</div>
            </div>
          </Section>
        </>
      )}

      {/* System Settings */}
      {activeTab === 'system' && (
        <Section icon="⚙️" title="System Preferences" sub="Date format, fiscal year, auto-save, cloud sync">
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
            <FG label="Date Format">
              <select style={inp} value={s.system.dateFormat} onChange={e=>setS(p=>({...p,system:{...p.system,dateFormat:e.target.value}}))}>
                {DATE_FMTS.map(f=><option key={f}>{f}</option>)}
              </select>
            </FG>
            <FG label="Fiscal Year Start">
              <select style={inp} value={s.system.fiscalYearStart} onChange={e=>setS(p=>({...p,system:{...p.system,fiscalYearStart:e.target.value}}))}>
                {FISCAL_MOS.map(m=><option key={m}>{m}</option>)}
              </select>
            </FG>
            <FG label="Timezone">
              <select style={inp} value={s.system.timezone} onChange={e=>setS(p=>({...p,system:{...p.system,timezone:e.target.value}}))}>
                {['Africa/Lagos','Africa/Accra','Africa/Nairobi','Europe/London','America/New_York','America/Chicago','Asia/Dubai'].map(t=><option key={t}>{t}</option>)}
              </select>
            </FG>
            <FG label="Display Language">
              <select style={inp} value={s.system.language} onChange={e=>setS(p=>({...p,system:{...p.system,language:e.target.value}}))}>
                {['English','French','Hausa','Yoruba','Igbo'].map(l=><option key={l}>{l}</option>)}
              </select>
            </FG>
          </div>
          <Toggle value={s.system.autoSave} onChange={()=>setS(p=>({...p,system:{...p.system,autoSave:!p.system.autoSave}}))} label="Auto-save changes to local storage" />
          <Toggle value={s.system.cloudSync} onChange={()=>setS(p=>({...p,system:{...p.system,cloudSync:!p.system.cloudSync}}))} label="Enable cloud sync (requires Firebase setup)" />
          <Toggle value={s.system.auditTrail} onChange={()=>setS(p=>({...p,system:{...p.system,auditTrail:!p.system.auditTrail}}))} label="Maintain audit trail of all changes" />

          {!cloudReady && (
            <div style={{ marginTop:14, padding:'10px 14px', background:'rgba(26,92,138,.08)', border:'1px solid rgba(26,92,138,.2)', borderLeft:'4px solid '+C.info, borderRadius:8, fontSize:12, color:C.info }}>
              Cloud sync is currently offline. Add Firebase credentials to your <code style={{ fontFamily:'monospace', background:C.greenPale, padding:'1px 4px', borderRadius:3 }}>.env</code> file to enable cloud backup.
            </div>
          )}
        </Section>
      )}

      {/* Security Settings */}
      {activeTab === 'security' && (
        <>
          <Section icon="🔒" title="Security Preferences" sub="Session management, password policy">
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
              <FG label="Session Timeout (minutes)" hint="Users are logged out after this period of inactivity">
                <input type="number" style={inp} value={s.security.sessionTimeout} onChange={e=>setS(p=>({...p,security:{...p.security,sessionTimeout:e.target.value}}))} min="5" max="480" />
              </FG>
            </div>
            <Toggle value={s.security.requireStrongPw} onChange={()=>setS(p=>({...p,security:{...p.security,requireStrongPw:!p.security.requireStrongPw}}))} label="Require strong passwords (min 8 chars, mixed case)" />
            <FG label="Recovery Code" hint="Users enter this code on the login screen to reset their own password without admin help. Keep it secure and share it only with staff.">
              <input style={inp} value={s.security.recoveryCode} onChange={e=>setS(p=>({...p,security:{...p.security,recoveryCode:e.target.value}}))} placeholder="e.g. SLOT-RESET-2025 (leave blank to disable self-reset)" />
            </FG>
            <Toggle value={s.security.allowMultiSession} onChange={()=>setS(p=>({...p,security:{...p.security,allowMultiSession:!p.security.allowMultiSession}}))} label="Allow multiple simultaneous sessions per user" />
          </Section>

          <Section icon="ℹ️" title="System Information" sub="Version and environment details">
            {(() => {
              const health = (() => { try { return getStorageHealth ? getStorageHealth() : { usedMB:'—', pct:0, status:'ok' }; } catch { return { usedMB:'—', pct:0, status:'ok' }; } })();
              const storageLabel = `${health.usedMB} MB used (${health.pct}%) — ${health.status === 'ok' ? '✓ Healthy' : health.status === 'warning' ? '⚠ Getting full' : '✗ Nearly full'}`;
              const storageColor = health.status === 'ok' ? C.success : health.status === 'warning' ? C.warning : C.danger;
              return (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                  {[
                    ['Application','BizCore ERP'],
                    ['Version','2.0.0'],
                    ['Build','React + Vite + Supabase'],
                    ['Environment','Production'],
                    ['Cloud Status', cloudReady ? '✓ Connected' : '✗ Offline'],
                    ['Session Timeout', `${s.security.sessionTimeout} minutes`],
                    ['Cloud Sync', s.system.cloudSync ? '✓ Enabled' : '✗ Disabled'],
                    ['Local Storage', storageLabel],
                  ].map(([k,v])=>(
                    <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'8px 12px', background:C.greenPale, borderRadius:8 }}>
                      <span style={{ fontSize:12, color:C.textMuted }}>{k}</span>
                      <span style={{ fontSize:12, fontWeight:600, color: k==='Cloud Status'?(cloudReady?C.success:C.danger) : k==='Local Storage'?storageColor : v.includes('✓')?C.success:v.includes('✗')?C.danger:C.text }}>{v}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Section>
        </>
      )}

      {/* Save strip */}
      <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'14px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', boxShadow:C.shadowCard }}>
        <span style={{ fontSize:12, color:C.textMuted }}>Session timeout and cloud sync take effect immediately after saving.</span>
        <Btn onClick={handleSave} disabled={saving}>{saving?'Saving…':'Save All Settings'}</Btn>
      </div>
    </div>
  );
}
