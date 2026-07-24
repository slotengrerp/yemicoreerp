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
import { SLOT_BRAND } from '../../utils/logo';
import { periodsInFY, isPeriodClosed, isYearClosed, closePeriod, reopenPeriod, closeYear, reopenYear, buildYearEndClosingEntry } from '../../utils/periods';
import { backfillFromBlob, backfillAccountingData } from '../../supabase/syncPerRecord';
import { USE_PER_RECORD } from '../../hooks/usePerRecordSync';
import { supabaseReady } from '../../supabase/client';
import { DEFAULT_APPROVAL_RULES, APPROVAL_WORKFLOWS, ROLE_LABELS } from '../../utils/approvalEngine';
import { ROLE_PERMS, getAllRoles, slugifyRoleKey } from '../../utils/auth';

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
    approvalRules: appSettings?.approvalRules
      ? JSON.parse(JSON.stringify(appSettings.approvalRules))
      : JSON.parse(JSON.stringify(DEFAULT_APPROVAL_RULES)),
    permissionOverrides: appSettings?.permissionOverrides
      ? JSON.parse(JSON.stringify(appSettings.permissionOverrides))
      : {},
    customRoles: appSettings?.customRoles
      ? JSON.parse(JSON.stringify(appSettings.customRoles))
      : [],
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
      approvalRules: s.approvalRules,
      permissionOverrides: s.permissionOverrides,
      customRoles: s.customRoles,
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

  // ── One-time backfill: legacy blob data → per-record tables ────────────────
  // Only relevant once VITE_USE_PER_RECORD_SYNC=true and the 003/005 SQL
  // migrations have been run. Copies whatever is currently in state.db /
  // state.acctData into the new per-record tables. Safe to run more than
  // once — backfillFromBlob/backfillAccountingData use upsert with
  // ignoreDuplicates, so already-migrated rows are simply skipped.
  const [backfilling, setBackfilling] = useState(false);
  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRolePerms, setNewRolePerms] = useState({});
  const [backfillResult, setBackfillResult] = useState(null);

  async function handleBackfill() {
    if (!window.confirm('Copy all current data into the new per-record Supabase tables? This is safe to run more than once.')) return;
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const dataResult = await backfillFromBlob(state.db);
      const acctResult = await backfillAccountingData(state.acctData, appSettings);
      setBackfillResult({ dataResult, acctResult });
      const failed = (dataResult.results || []).filter(r => !r.ok);
      if (failed.length) {
        showToast(`Backfill finished with ${failed.length} table(s) failing — see details below`, 'error');
      } else {
        const migrated = (dataResult.results || []).reduce((sum, r) => sum + (r.count || 0), 0);
        showToast(`Backfill complete — ${migrated} record(s) + ${acctResult.results?.journals || 0} journal(s) migrated`);
      }
      logActivity(dispatch, `Backfilled data to per-record tables (${currentUser?.name})`, currentUser, { module:'settings', action:'backfill' });
    } catch (e) {
      showToast(`Backfill failed: ${e.message}`, 'error');
    } finally {
      setBackfilling(false);
    }
  }

  const TABS = [
    { key:'company',     label:'Company',    icon:'🏢' },
    { key:'system',      label:'System',     icon:'⚙️' },
    { key:'accounting',  label:'Accounting', icon:'📒' },
    { key:'approvals',   label:'Approvals',  icon:'✅' },
    { key:'permissions', label:'Permissions',icon:'🛡️' },
    { key:'security',    label:'Security',   icon:'🔒' },
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

      {/* Data Migration — one-time backfill into per-record Supabase tables */}
      {activeTab === 'system' && USE_PER_RECORD && (
        <Section icon="🗄️" title="Data Migration" sub="Per-record sync is enabled — copy existing data into the new tables">
          <div style={{ fontSize:12.5, color:C.textMuted, lineHeight:1.6, marginBottom:14 }}>
            <code style={{ fontFamily:'monospace', background:C.greenPale, padding:'1px 4px', borderRadius:3 }}>VITE_USE_PER_RECORD_SYNC</code> is on, so the app is now writing to the new per-record tables.
            Run this once to copy whatever's currently in local/legacy storage across — it's safe to run more than once,
            already-migrated records are skipped rather than duplicated.
          </div>
          {!supabaseReady && (
            <div style={{ marginBottom:14, padding:'10px 14px', background:'rgba(217,119,6,.08)', border:'1px solid rgba(217,119,6,.2)', borderLeft:'4px solid '+C.amber, borderRadius:8, fontSize:12, color:C.amber }}>
              Supabase isn't configured — check your <code style={{ fontFamily:'monospace' }}>.env</code> credentials before running this.
            </div>
          )}
          <Btn onClick={handleBackfill} disabled={backfilling || !supabaseReady}>
            {backfilling ? 'Backfilling…' : 'Backfill Data to Per-Record Tables'}
          </Btn>

          {backfillResult && (
            <div style={{ marginTop:16, display:'flex', flexDirection:'column', gap:6 }}>
              <div style={{ fontSize:12.5, fontWeight:700, color:C.text }}>Results</div>
              {(backfillResult.dataResult.results || []).map(r => (
                <div key={r.table} style={{ display:'flex', justifyContent:'space-between', fontSize:12, padding:'6px 10px', borderRadius:6, background:r.ok?C.greenPale:'rgba(217,60,60,.08)', color:r.ok?C.textMuted:C.danger }}>
                  <span>{r.table}</span>
                  <span>{r.ok ? (r.skipped ? 'skipped (empty)' : `${r.count} migrated`) : `failed — ${r.error}`}</span>
                </div>
              ))}
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, padding:'6px 10px', borderRadius:6, background:backfillResult.acctResult.ok?C.greenPale:'rgba(217,60,60,.08)', color:backfillResult.acctResult.ok?C.textMuted:C.danger }}>
                <span>journal_entries</span>
                <span>{backfillResult.acctResult.ok ? `${backfillResult.acctResult.results?.journals || 0} migrated` : 'failed'}</span>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Accounting Settings — Period & Fiscal Year Locking */}
      {activeTab === 'accounting' && (() => {
        const fyStart = s.system.fiscalYearStart || 'January';
        const closedPeriods = appSettings?.accounting?.closedPeriods || [];
        const closedYears   = appSettings?.accounting?.closedYears   || [];
        const yec           = appSettings?.accounting?.yearEndClosings || {};
        // Show current FY + previous FY so admins can lock down a closed year
        const thisYear = new Date().getFullYear();
        const yearsToShow = [String(thisYear), String(thisYear - 1), String(thisYear + 1)];

        function doClosePeriod(periodKey) {
          if (!window.confirm(`Close period ${periodKey}? New journal entries with a date in this period will be blocked until you reopen it.`)) return;
          const next = closePeriod(periodKey, appSettings);
          dispatch({ type:'SET_SETTINGS', payload: next });
          saveSettingsLocal(next);
          if (cloudReady) saveSettingsCloud(next);
          logActivity(dispatch, `Period ${periodKey} closed by ${currentUser?.name}`, currentUser, { module:'settings', action:'edit' });
          showToast(`Period ${periodKey} closed`, 'success');
        }
        function doReopenPeriod(periodKey) {
          if (!window.confirm(`Reopen period ${periodKey}? This will allow new postings into it.`)) return;
          const next = reopenPeriod(periodKey, appSettings);
          dispatch({ type:'SET_SETTINGS', payload: next });
          saveSettingsLocal(next);
          if (cloudReady) saveSettingsCloud(next);
          logActivity(dispatch, `Period ${periodKey} reopened by ${currentUser?.name}`, currentUser, { module:'settings', action:'edit' });
          showToast(`Period ${periodKey} reopened`, 'info');
        }
        function doCloseYear(fy) {
          // CRITICAL FIX: previously this function had no idempotency check.
          // If an admin clicked "Close FY 2026" twice (accidentally, or because
          // they missed the first success toast), a second mirror closing entry
          // was appended to the GL — zeroing revenue and expense accounts a
          // second time and doubling Retained Earnings. The Balance Sheet then
          // didn't balance. Now we refuse if the FY is already marked closed
          // AND we dedupe by JE id (JE-YEC-${fy}) just in case the settings
          // flag was somehow cleared but the closing entry is still in the GL.
          if (isYearClosed(fy, appSettings)) {
            showToast(`FY ${fy} is already closed`, 'error');
            return;
          }
          if (!window.confirm(`Close fiscal year ${fy}? This will close all 12 periods and post a year-end closing entry. This is a significant action — only do this after all entries for the year are complete.`)) return;
          const journals = state?.acctData?.journals || [];
          const coa = state?.acctData?.coa || [];
          // Idempotency guard at the GL level — refuse to re-post if a JE
          // with id JE-YEC-${fy} already exists.
          const yecId = `JE-YEC-${fy}`;
          if (journals.some(j => j.id === yecId)) {
            showToast(`Closing entry for FY ${fy} already exists in the GL — not re-posting`, 'error');
            // Still close the year in settings (the entry is there, the flag isn't)
            const next = closeYear(fy, appSettings, { postedBy: currentUser?.name });
            dispatch({ type:'SET_SETTINGS', payload: next });
            saveSettingsLocal(next);
            if (cloudReady) saveSettingsCloud(next);
            return;
          }
          const yecEntry = buildYearEndClosingEntry(fy, journals, coa, currentUser);
          // Persist the closing entry into acctData.journals
          const nextAcct = { ...(state.acctData || {}), journals: [...journals, yecEntry] };
          dispatch({ type:'SET_ACCT', payload: nextAcct });
          // Then close the year
          const next = closeYear(fy, appSettings, { retainedEarnings: yecEntry.netIncome, sumRev: yecEntry.sumRev, sumExp: yecEntry.sumExp, postedBy: currentUser?.name });
          dispatch({ type:'SET_SETTINGS', payload: next });
          saveSettingsLocal(next);
          if (cloudReady) saveSettingsCloud(next);
          logActivity(dispatch, `Fiscal year ${fy} closed — Net P&L: ${(yecEntry.netIncome||0).toLocaleString()} (by ${currentUser?.name})`, currentUser, { module:'settings', action:'edit' });
          showToast(`FY ${fy} closed — Net P&L: ${(yecEntry.netIncome||0).toLocaleString()}`, 'success');
        }
        function doReopenYear(fy) {
          if (!window.confirm(`Reopen fiscal year ${fy}? This will allow new postings into all 12 periods of the year again.`)) return;
          const next = reopenYear(fy, appSettings);
          dispatch({ type:'SET_SETTINGS', payload: next });
          saveSettingsLocal(next);
          if (cloudReady) saveSettingsCloud(next);
          logActivity(dispatch, `Fiscal year ${fy} reopened by ${currentUser?.name}`, currentUser, { module:'settings', action:'edit' });
          showToast(`FY ${fy} reopened`, 'info');
        }

        return (
          <>
            <Section icon="📒" title="Period & Fiscal Year Locking" sub={`Fiscal year starts ${fyStart} · 12 monthly periods per year`}>
              <div style={{ fontSize:12, color:C.textMuted, marginBottom:14, lineHeight:1.6 }}>
                Closing a period locks its journal entries from further editing. Closing a fiscal year
                locks all 12 periods, posts a year-end closing entry (zeroing revenue and expense to
                Retained Earnings), and prevents any further posting to that year. Use this once an
                accountant has signed off on the period/year — reopens require explicit confirmation
                and are logged to the audit trail.
              </div>

              {yearsToShow.map(fy => {
                const yearIsClosed = isYearClosed(fy, appSettings);
                const periods = periodsInFY(fy, fyStart);
                const yearClosing = yec[fy];
                return (
                  <div key={fy} style={{ border:'1px solid '+C.border, borderRadius:10, marginBottom:14, overflow:'hidden' }}>
                    <div style={{ padding:'12px 16px', background: yearIsClosed ? C.amberPale : C.greenPale, borderBottom:'1px solid '+C.border, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                      <div style={{ fontSize:14, fontWeight:700, color:C.text }}>Fiscal Year {fy}</div>
                      {yearClosing && (
                        <div style={{ fontSize:11, color:C.textMuted }}>
                          Net P&L: <strong style={{ color: yearClosing.retainedEarnings >= 0 ? C.success : C.danger }}>
                            {SLOT_BRAND.currency}{(yearClosing.retainedEarnings||0).toLocaleString()}
                          </strong>
                          {' · '}
                          Revenue {(yearClosing.sumRev||0).toLocaleString()} − Expense {(yearClosing.sumExp||0).toLocaleString()}
                          {' · '}
                          Closed by {yearClosing.postedBy||'system'}
                        </div>
                      )}
                      <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
                        {!yearIsClosed && <Btn variant="amber" sm onClick={()=>doCloseYear(fy)}>📕 Close FY {fy}</Btn>}
                        {yearIsClosed && <Btn variant="ghost" sm onClick={()=>doReopenYear(fy)}>🔓 Reopen FY {fy}</Btn>}
                      </div>
                    </div>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                      <thead>
                        <tr style={{ background:C.bgCard2 }}>
                          {['Period','Range','Status','Action'].map(h => (
                            <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:11, color:C.textMuted, fontWeight:600, borderBottom:'1px solid '+C.borderLight }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {periods.map(p => {
                          const closed = isPeriodClosed(p.periodKey, appSettings);
                          return (
                            <tr key={p.periodKey} style={{ borderBottom:'1px solid '+C.borderLight }}>
                              <td style={{ padding:'8px 12px', fontWeight:600, color:C.text }}>{p.periodKey}</td>
                              <td style={{ padding:'8px 12px', color:C.textMid }}>{p.monthName}</td>
                              <td style={{ padding:'8px 12px' }}>
                                {closed
                                  ? <span style={{ padding:'2px 8px', borderRadius:10, background:C.amberPale, color:C.amber, fontSize:11, fontWeight:600 }}>🔒 Closed</span>
                                  : <span style={{ padding:'2px 8px', borderRadius:10, background:C.greenPale, color:C.success, fontSize:11, fontWeight:600 }}>🟢 Open</span>}
                              </td>
                              <td style={{ padding:'8px 12px' }}>
                                {yearIsClosed
                                  ? <span style={{ fontSize:11, color:C.textMuted }}>— locked by FY</span>
                                  : (closed
                                      ? <Btn variant="ghost" sm onClick={()=>doReopenPeriod(p.periodKey)}>Reopen</Btn>
                                      : <Btn variant="outline" sm onClick={()=>doClosePeriod(p.periodKey)}>Close</Btn>)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}

              <div style={{ padding:'10px 14px', background:C.greenPale, border:'1px solid '+C.greenLight, borderLeft:'4px solid '+C.green, borderRadius:8, fontSize:12, color:C.textMid, lineHeight:1.7 }}>
                💡 <strong>How period close works:</strong> When a period is closed, any new journal
                entry with a date in that period is silently blocked from posting. The
                source-module record (invoice, bill, etc.) is preserved and can be either
                corrected (if needed) or reposted once the period is reopened. Void-and-reverse
                operations still work — they post the reversal into the current open period.
              </div>
            </Section>
          </>
        );
      })()}

      {/* Approval Chains */}
      {activeTab === 'approvals' && (
        <Section icon="✅" title="Approval Chains" sub="Multi-level, amount-banded authorization limits — the same pattern as Sage's approval matrices">
          <div style={{ fontSize:12.5, color:C.textMuted, lineHeight:1.6, marginBottom:16 }}>
            For each workflow, set value bands and which role(s) must sign off, in order, before an item counts as fully Approved.
            Admin can always approve at any level as a safety valve. Changes apply to items submitted after you save — items already
            mid-chain keep the chain they started with.
          </div>
          {APPROVAL_WORKFLOWS.map(wfKey => {
            const wf = s.approvalRules[wfKey] || DEFAULT_APPROVAL_RULES[wfKey];
            function updateBand(i, patch) {
              setS(p => {
                const bands = p.approvalRules[wfKey].bands.map((b, j) => j === i ? { ...b, ...patch } : b);
                return { ...p, approvalRules: { ...p.approvalRules, [wfKey]: { ...p.approvalRules[wfKey], bands } } };
              });
            }
            function toggleRole(i, role) {
              const band = wf.bands[i];
              const roles = band.roles.includes(role) ? band.roles.filter(r => r !== role) : [...band.roles, role];
              updateBand(i, { roles });
            }
            function addBand() {
              setS(p => {
                const bands = [...p.approvalRules[wfKey].bands];
                const prevUpTo = bands.length >= 2 ? bands[bands.length - 2].upTo : 0;
                const newUpTo = prevUpTo > 0 ? prevUpTo * 2 : 100000;
                bands.splice(bands.length - 1, 0, { upTo: newUpTo, roles: ['manager'] });
                return { ...p, approvalRules: { ...p.approvalRules, [wfKey]: { ...p.approvalRules[wfKey], bands } } };
              });
            }
            function removeBand(i) {
              setS(p => {
                const bands = p.approvalRules[wfKey].bands.filter((_, j) => j !== i);
                return { ...p, approvalRules: { ...p.approvalRules, [wfKey]: { ...p.approvalRules[wfKey], bands } } };
              });
            }
            return (
              <div key={wfKey} style={{ marginBottom:22, paddingBottom:18, borderBottom:'1px solid '+C.borderLight }}>
                <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:10 }}>{wf.label}</div>
                {wf.bands.map((band, i) => {
                  const isLast = i === wf.bands.length - 1;
                  return (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 10px', background:i%2?C.greenPale2:'transparent', borderRadius:6, marginBottom:4 }}>
                      <div style={{ fontSize:12, color:C.textMuted, minWidth:150 }}>
                        {isLast ? 'Above previous band' : (
                          <>Up to ₦<input type="number" value={band.upTo} onChange={e=>updateBand(i,{upTo:Number(e.target.value)||0})} style={{ width:90, padding:'3px 6px', borderRadius:5, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12 }} /></>
                        )}
                      </div>
                      <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                        {getAllRoles({ customRoles: s.customRoles }).map(({ key: role, label: roleLabel }) => (
                          <label key={role} style={{ display:'flex', alignItems:'center', gap:4, fontSize:11.5, color:C.text, cursor:'pointer' }}>
                            <input type="checkbox" checked={band.roles.includes(role)} onChange={()=>toggleRole(i, role)} />
                            {roleLabel}
                          </label>
                        ))}
                      </div>
                      {wf.bands.length > 1 && (
                        <button onClick={()=>removeBand(i)} style={{ marginLeft:'auto', background:'none', border:'none', color:C.danger, cursor:'pointer', fontSize:13 }}>✕</button>
                      )}
                    </div>
                  );
                })}
                <Btn sm variant="ghost" onClick={addBand} style={{ marginTop:8 }}>+ Add Band</Btn>
              </div>
            );
          })}
        </Section>
      )}

      {/* Permissions Matrix */}
      {activeTab === 'permissions' && (
        <Section icon="🛡️" title="Role Permissions" sub="Per-module overrides on top of each role's defaults — currently enforced on Procurement, Requests, Petty Cash, and Terminal Operations">
          <div style={{ fontSize:12.5, color:C.textMuted, lineHeight:1.6, marginBottom:16 }}>
            Admin always has full access and can't be restricted here. Unchecked defaults come from the role's baseline —
            override only the modules that need to differ from it.
          </div>

          {/* ── Manage Roles ── */}
          <div style={{ marginBottom:24, paddingBottom:20, borderBottom:'1px solid '+C.borderLight }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:10 }}>Manage Roles</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:14 }}>
              {['admin','manager','accountant','cashier','viewer'].map(key => (
                <span key={key} style={{ fontSize:11.5, padding:'4px 10px', borderRadius:20, background:C.greenPale, color:C.textMuted, border:'1px solid '+C.borderLight }}>
                  {key.charAt(0).toUpperCase()+key.slice(1)} <span style={{ opacity:0.6 }}>(built-in)</span>
                </span>
              ))}
              {s.customRoles.map(r => (
                <span key={r.key} style={{ fontSize:11.5, padding:'4px 6px 4px 10px', borderRadius:20, background:'rgba(201,122,10,.1)', color:C.amber, border:'1px solid rgba(201,122,10,.3)', display:'inline-flex', alignItems:'center', gap:6 }}>
                  {r.label}
                  <button onClick={() => setS(p => ({ ...p, customRoles: p.customRoles.filter(x=>x.key!==r.key) }))}
                    style={{ background:'none', border:'none', color:C.amber, cursor:'pointer', fontWeight:700, fontSize:12, lineHeight:1 }}>✕</button>
                </span>
              ))}
            </div>
            {!newRoleOpen ? (
              <Btn sm variant="ghost" onClick={()=>setNewRoleOpen(true)}>+ Add Role</Btn>
            ) : (
              <div style={{ padding:12, background:C.greenPale2, borderRadius:8 }}>
                <input placeholder="Role name (e.g. Terminal Supervisor)" value={newRoleName} onChange={e=>setNewRoleName(e.target.value)}
                  style={{ width:'100%', padding:'7px 10px', borderRadius:6, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, marginBottom:10 }} />
                <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginBottom:12 }}>
                  {['canAdd','canEdit','canDelete','canApprove','canSettings'].map(action => (
                    <label key={action} style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:C.text, cursor:'pointer' }}>
                      <input type="checkbox" checked={!!newRolePerms[action]} onChange={()=>setNewRolePerms(p=>({...p,[action]:!p[action]}))} />
                      {({canAdd:'Add',canEdit:'Edit',canDelete:'Delete',canApprove:'Approve',canSettings:'Settings'})[action]}
                    </label>
                  ))}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <Btn sm variant="ghost" onClick={()=>{ setNewRoleOpen(false); setNewRoleName(''); setNewRolePerms({}); }}>Cancel</Btn>
                  <Btn sm onClick={()=>{
                    if (!newRoleName.trim()) { showToast('Enter a role name','error'); return; }
                    const key = slugifyRoleKey(newRoleName, s.customRoles.map(r=>r.key));
                    setS(p => ({ ...p, customRoles: [...p.customRoles, { key, label:newRoleName.trim(), ...newRolePerms }] }));
                    setNewRoleOpen(false); setNewRoleName(''); setNewRolePerms({});
                    showToast('Role added — remember to click Save below');
                  }}>Add</Btn>
                </div>
              </div>
            )}
          </div>

          {[...getAllRoles({ customRoles: s.customRoles }).filter(r => r.key !== 'admin')].map(({ key: role, label: roleLabel }) => {
            const modules = [
              { key:'procurement', label:'Procurement' },
              { key:'request',     label:'Requests' },
              { key:'pettycash',   label:'Petty Cash' },
              { key:'terminal',    label:'Terminal Operations' },
            ];
            const actions = ['canAdd','canEdit','canDelete','canApprove'];
            const actionLabels = { canAdd:'Add', canEdit:'Edit', canDelete:'Delete', canApprove:'Approve' };
            function basePerm(action) {
              if (ROLE_PERMS[role]) return ROLE_PERMS[role][action] ?? false;
              const custom = s.customRoles.find(r=>r.key===role);
              return !!custom?.[action];
            }
            function toggle(moduleKey, action) {
              setS(p => {
                const roleOverrides = p.permissionOverrides[role] || {};
                const moduleOverride = roleOverrides[moduleKey] || {};
                const current = moduleOverride[action] ?? basePerm(action);
                return {
                  ...p,
                  permissionOverrides: {
                    ...p.permissionOverrides,
                    [role]: { ...roleOverrides, [moduleKey]: { ...moduleOverride, [action]: !current } },
                  },
                };
              });
            }
            return (
              <div key={role} style={{ marginBottom:20 }}>
                <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:8 }}>{roleLabel}</div>
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign:'left', fontSize:10.5, color:C.textMuted, padding:'4px 8px', textTransform:'uppercase' }}>Module</th>
                      {actions.map(a => <th key={a} style={{ fontSize:10.5, color:C.textMuted, padding:'4px 8px', textTransform:'uppercase' }}>{actionLabels[a]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map(mod => (
                      <tr key={mod.key} style={{ borderTop:'1px solid '+C.borderLight }}>
                        <td style={{ fontSize:12, color:C.text, padding:'6px 8px' }}>{mod.label}</td>
                        {actions.map(action => {
                          const override = s.permissionOverrides[role]?.[mod.key]?.[action];
                          const checked = override ?? basePerm(action);
                          return (
                            <td key={action} style={{ textAlign:'center', padding:'6px 8px' }}>
                              <input type="checkbox" checked={checked} onChange={()=>toggle(mod.key, action)} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </Section>
      )}


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
                    ['Application',SLOT_BRAND.short],
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
