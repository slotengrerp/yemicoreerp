// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — BACKUP & RESTORE MODULE v1.0
// Export JSON · import/restore · cloud sync · backup history · integrity check
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useRef, useEffect } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { showToast, formatDate, formatDateTime, totalRecords, WIPE_FLAG_KEY } from '../../utils/helpers';
import { saveDBLocal, loadDBLocal, saveDBCloud, loadDBCloud, saveSettingsLocal, getStorageHealth } from '../../utils/db';
import { logActivity } from '../../utils/audit';
import { getVendors, saveVendors } from '../../utils/vendorMaster';
import { getClients, saveClients } from '../../utils/clientMaster';
import { saveProjects } from '../../utils/projectMaster';
import { SLOT_BRAND } from '../../utils/logo';
import { readTextSmart } from '../../utils/excelIO';
import { getActiveWipeRequest, getWipeHistory, requestWipe, approveAndExecuteWipe, cancelWipeRequest, subscribeWipeRequests } from '../../supabase/wipeGate';

const BACKUP_HISTORY_KEY = 'bc_backup_history';
function loadHistory()    { try { const r=localStorage.getItem(BACKUP_HISTORY_KEY); return r?JSON.parse(r):[]; } catch { return []; } }
function saveHistory(h)   { try { localStorage.setItem(BACKUP_HISTORY_KEY, JSON.stringify(h.slice(0,20))); } catch {} }

function Btn({ children, onClick, variant='primary', sm, disabled, loading, style={} }) {
  const { C } = useTheme();
  const V = { primary:{bg:C.green,co:'#fff',b:'none'}, ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border}, danger:{bg:C.danger,co:'#fff',b:'none'}, amber:{bg:C.amber,co:'#fff',b:'none'}, success:{bg:C.success,co:'#fff',b:'none'}, outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green} }[variant]||{};
  return <button onClick={onClick} disabled={disabled||loading} style={{ background:V.bg, color:V.co, border:V.b, borderRadius:7, padding:sm?'5px 12px':'8px 18px', fontSize:sm?12:13, fontWeight:500, cursor:(disabled||loading)?'not-allowed':'pointer', opacity:(disabled||loading)?0.6:1, display:'inline-flex', alignItems:'center', gap:6, whiteSpace:'nowrap', ...style }}>{loading?'⏳ Please wait…':children}</button>;
}

function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'20px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}

function Section({ icon, title, sub, children, accent }) {
  const { C } = useTheme();
  const borderColor = accent || C.green;
  return (
    <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, overflow:'hidden', boxShadow:C.shadowCard }}>
      <div style={{ padding:'14px 20px', borderBottom:'1px solid '+C.borderLight, display:'flex', alignItems:'center', gap:12, borderLeft:'4px solid '+borderColor }}>
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

function StatPill({ label, value, color }) {
  const { C } = useTheme();
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 12px', background:C.greenPale, borderRadius:8, marginBottom:6 }}>
      <span style={{ fontSize:12, color:C.textMid }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:700, color:color||C.green }}>{value}</span>
    </div>
  );
}

export default function Backup() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db, activity, appSettings, acctData, cloudReady } = state;
  const isAdmin = currentUser?.role === 'admin';

  // Hooks must run unconditionally on every render (Rules of Hooks) — declared
  // here, before the admin gate below, so hook order can't shift if the
  // current user's role changes while this component stays mounted.
  const [history, setHistory]   = useState(loadHistory);
  const [loading, setLoading]   = useState({});
  const [verifyResult, setVR]   = useState(null);
  const fileRef = useRef();

  // ── Two-admin wipe approval gate ─────────────────────────────────────────
  const [wipeRequest, setWipeRequest] = useState(null);   // active pending request, or null
  const [wipeHistory, setWipeHistory] = useState([]);      // past completed/cancelled/expired requests
  const [wipeReason, setWipeReason]   = useState('');
  const [wipeBusy, setWipeBusy]       = useState(false);
  const [wipeLoaded, setWipeLoaded]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [active, past] = await Promise.all([getActiveWipeRequest(), getWipeHistory(10)]);
        if (!cancelled) { setWipeRequest(active); setWipeHistory(past); }
      } catch (e) {
        console.warn('[SLOT] Could not load wipe request state:', e?.message);
      } finally {
        if (!cancelled) setWipeLoaded(true);
      }
    }
    refresh();
    // Live updates — so a second admin sees a new pending request (or its
    // cancellation/completion) appear without needing to reload the page.
    const unsub = subscribeWipeRequests(() => refresh());
    return () => { cancelled = true; unsub(); };
  }, []);

  // ── Admin-only gate ─────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:60, gap:16, textAlign:'center' }}>
        <div style={{ fontSize:48 }}>🔒</div>
        <div style={{ fontSize:18, fontWeight:700, color:C.text }}>Admin Access Only</div>
        <div style={{ fontSize:13, color:C.textMuted, maxWidth:380, lineHeight:1.7 }}>
          The Backup & Restore module contains full company data and is restricted to administrators.
          Contact <strong>SLOT Admin</strong> if you need a data export for a specific module.
        </div>
      </div>
    );
  }

  const setLoad = (key, val) => setLoading(l => ({ ...l, [key]: val }));

  const dbStats = {
    modules: Object.entries(db).map(([k,v])=>{
      // Flat arrays: use .length directly
      // Object-type modules (procurement, terminal, fleet): sum their nested arrays
      let count = 0;
      if (Array.isArray(v)) count = v.length;
      else if (v && typeof v === 'object') count = Object.values(v).reduce((s,a)=>s+(Array.isArray(a)?a.length:0),0);
      return { k, count };
    }).filter(x=>x.count>0),
    total:   totalRecords(db),
    activity: activity?.length||0,
  };

  function pushHistory(entry) {
    const h = [{ ...entry, date: new Date().toISOString() }, ...loadHistory()];
    saveHistory(h);
    setHistory(h);
  }

  // ── LOCAL BACKUP ──────────────────────────────────────────────────────────
  function handleLocalBackup() {
    try {
      const payload = {
        _meta: { version:'2.0', app:SLOT_BRAND.short, company:appSettings?.brand?.name||SLOT_BRAND.name, exportedAt:new Date().toISOString(), exportedBy:currentUser?.name||'Admin', totalRecords:dbStats.total },
        db, activity: activity||[], settings: appSettings, acctData,
        // User accounts live in Supabase Auth + app_users table — not in
        // the backup file. v1.2 backup files do not include user records.
        // vendors and clients (master data) are still local.
        vendors: getVendors(),
        clients: getClients(),
      };
      const blob  = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
      const url   = URL.createObjectURL(blob);
      const a     = document.createElement('a');
      a.href      = url;
      a.download  = `${SLOT_BRAND.initials.toLowerCase()}-erp_backup_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      pushHistory({ type:'Local Export', records:dbStats.total, status:'Success' });
      logActivity(dispatch, `Database exported to JSON by ${currentUser?.name}`, currentUser, { module:'backup', action:'info' });
      showToast('Backup exported');
    } catch (e) {
      showToast('Export failed: '+e.message,'error');
    }
  }

  // ── CLOUD BACKUP ──────────────────────────────────────────────────────────
  async function handleCloudBackup() {
    if (!cloudReady) { showToast('Cloud not connected','error'); return; }
    setLoad('cloud', true);
    try {
      const ok = await saveDBCloud(db, activity||[], appSettings, acctData);
      pushHistory({ type:'Cloud Sync', records:dbStats.total, status: ok?'Success':'Failed' });
      if (ok) { logActivity(dispatch, `Cloud backup completed by ${currentUser?.name}`, currentUser); showToast('Cloud backup complete'); }
      else showToast('Cloud backup failed','error');
    } catch(e) {
      showToast('Cloud error: '+e.message,'error');
    }
    setLoad('cloud', false);
  }

  // ── CLOUD RESTORE ─────────────────────────────────────────────────────────
  async function handleCloudRestore() {
    if (!cloudReady) { showToast('Cloud not connected','error'); return; }
    if (!window.confirm('Restore from cloud? This will overwrite all local data.')) return;
    setLoad('cloudRestore', true);
    try {
      const data = await loadDBCloud();
      if (!data) { showToast('No cloud backup found','error'); setLoad('cloudRestore',false); return; }
      if (data.db)       { dispatch({ type:'SET_DB', payload:data.db }); saveDBLocal(data.db, data.activity||[]); }
      if (data.settings) { dispatch({ type:'SET_SETTINGS', payload:data.settings }); saveSettingsLocal(data.settings); }
      if (data.acctData) { dispatch({ type:'SET_ACCT', payload:data.acctData }); }
      pushHistory({ type:'Cloud Restore', records:totalRecords(data.db||{}), status:'Success' });
      logActivity(dispatch, `Cloud restore completed by ${currentUser?.name}`, currentUser);
      showToast('Cloud restore complete');
    } catch(e) {
      showToast('Restore failed: '+e.message,'error');
    }
    setLoad('cloudRestore', false);
  }

  // ── FILE RESTORE ──────────────────────────────────────────────────────────
  function handleFileRestore(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!window.confirm(`Restore from "${file.name}"? This will overwrite all current data.`)) return;
    // 2026-08-14: readTextSmart, not readAsText — see excelIO.js. Backup files
    // this app writes are UTF-8, but a backup that has been round-tripped
    // through a Windows editor can come back ANSI-encoded, and readAsText would
    // quietly replace every non-ASCII character in the restored data.
    readTextSmart(file).then(text => {
      try {
        const payload = JSON.parse(text);
        // Validate structure
        if (!payload.db && !payload._meta) { showToast('Invalid backup file','error'); return; }
        const dbData = payload.db || payload;
        const actData = payload.activity || [];
        const sets    = payload.settings || null;
        const acct    = payload.acctData || null;
        dispatch({ type:'SET_DB', payload:dbData });
        saveDBLocal(dbData, actData);
        if (sets) { dispatch({ type:'SET_SETTINGS', payload:sets }); saveSettingsLocal(sets); }
        if (acct) dispatch({ type:'SET_ACCT', payload:acct });
        // User accounts come from Supabase, not the backup file. Restoring
        // an old v1.x backup that includes a `users` field is silently
        // ignored — no user records are written.
        if (payload.vendors?.length) saveVendors(payload.vendors);
        if (payload.clients?.length) saveClients(payload.clients);
        pushHistory({ type:'File Restore', file:file.name, records:totalRecords(dbData), status:'Success' });
        logActivity(dispatch, `Database restored from file: ${file.name}`, currentUser, { module:'backup', action:'info' });
        showToast('Restore complete — page will reload');
        setTimeout(()=>window.location.reload(), 1500);
      } catch {
        showToast('Failed to parse backup file','error');
      }
    }).catch(() => showToast('Failed to parse backup file','error'));
    e.target.value = '';
  }

  // ── VERIFY INTEGRITY ──────────────────────────────────────────────────────
  function handleVerify() {
    const issues = [];
    const local  = loadDBLocal();
    if (!local) { issues.push('No local data found'); }
    else {
      if (local.db) {
        Object.entries(local.db).forEach(([k,v]) => {
          if (!Array.isArray(v)) issues.push(`Module "${k}" is corrupted (not an array)`);
        });
      }
    }
    if (issues.length === 0) {
      setVR({ ok:true, records:dbStats.total, checked:Object.keys(db).length });
    } else {
      setVR({ ok:false, issues });
    }
  }

  // ── WIPE DATA ─────────────────────────────────────────────────────────────
  // Recursively empties every array in a nested object while preserving its
  // shape — used so wiping doesn't turn e.g. db.fleet (an object with
  // several sub-arrays) into a bare [], which would break every module that
  // expects db.fleet.fleet / db.fleet.services / etc. to exist as arrays.
  // Scalar fields (numbers, strings — e.g. pettycash_fund.balance) are left
  // as-is; adjust those manually afterward if you want a different starting
  // value.
  function clearDeep(obj) {
    if (Array.isArray(obj)) return [];
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const k of Object.keys(obj)) out[k] = clearDeep(obj[k]);
      return out;
    }
    return obj;
  }

  // Runs after a wipe has actually been executed server-side (both real
  // per-record tables AND the legacy blob are now empty in Supabase) — puts
  // this browser into the same clean state so the reload that follows
  // doesn't briefly flash stale local data before the next sync catches up.
  async function clearLocalAfterWipe() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('bc_') || k.startsWith('slot_'));
    keys.forEach(k => localStorage.removeItem(k));
    saveClients([]);
    saveVendors([]);
    saveProjects([]);
    localStorage.setItem('slot_seed_version', 'slot-seed-v3');
    localStorage.setItem(WIPE_FLAG_KEY, '1');
    const wipedSettings = { ...appSettings, dataWiped: true };
    const emptyDb = clearDeep(db);
    const emptyAcct = { journals: [], coa: state.acctData?.coa || [], bankStmt: [], vatAdj: [], whtEntries: [], assets: [] };
    saveDBLocal(emptyDb, []);
    try { localStorage.setItem('bc_accounting', JSON.stringify(emptyAcct)); } catch {}
    // Also clear the legacy company_data blob for hygiene — nothing reads it
    // on boot while per-record sync is on, but leaving stale data sitting in
    // it serves no purpose either.
    if (cloudReady) { try { await saveDBCloud(emptyDb, [], wipedSettings, emptyAcct); } catch {} }
  }

  // ── STEP 1 of 2: an admin requests a wipe. This does not delete anything —
  // it just opens a pending request that a DIFFERENT admin must approve.
  // The distinct-admin check happens server-side (execute_company_wipe), not
  // here, so this button cannot itself be the whole authorization.
  async function handleRequestWipe() {
    if (!cloudReady) { showToast('Cloud not connected — cannot request a wipe','error'); return; }
    if (!window.confirm('Request a full data wipe? This starts a pending request that a DIFFERENT admin must approve before anything is actually deleted. Nothing is deleted yet.')) return;
    setWipeBusy(true);
    try {
      const req = await requestWipe(wipeReason.trim());
      setWipeRequest(req);
      setWipeReason('');
      logActivity(dispatch, `Data wipe REQUESTED by ${currentUser?.name} — awaiting a second admin's approval`, currentUser, { module:'backup', action:'info' });
      showToast('Wipe requested — waiting for a second admin to approve', 'error');
    } catch (e) {
      showToast('Could not request wipe: ' + (e.message || 'unknown error'), 'error');
    }
    setWipeBusy(false);
  }

  // ── STEP 2 of 2: a DIFFERENT admin approves. Approving IS executing — the
  // actual delete runs inside execute_company_wipe(), which independently
  // re-checks that the approver differs from the requester before touching
  // any data. If someone tried to approve their own request (e.g. by
  // calling the API directly, bypassing this UI), the database rejects it.
  async function handleApproveWipe() {
    if (!wipeRequest) return;
    if (wipeRequest.requested_by_name === currentUser?.name) {
      showToast('You requested this wipe — a different admin must approve it', 'error');
      return;
    }
    const confirm1 = window.confirm(`⚠️ DANGER: Approve and PERMANENTLY delete ALL business data?\n\nRequested by: ${wipeRequest.requested_by_name}\nReason: ${wipeRequest.reason || '(none given)'}\n\nThis clears every live table — HR, payroll, procurement, accounting, everything — for this company. Company details, user accounts, and settings are kept. This cannot be undone.`);
    if (!confirm1) return;
    const confirm2 = window.prompt('Type "DELETE ALL" to confirm you understand this is permanent:');
    if (confirm2 !== 'DELETE ALL') { showToast('Wipe not approved'); return; }
    setWipeBusy(true);
    try {
      await approveAndExecuteWipe(wipeRequest.id);
      await clearLocalAfterWipe();
      logActivity(dispatch, `Data wipe APPROVED and executed by ${currentUser?.name} (requested by ${wipeRequest.requested_by_name})`, currentUser, { module:'backup', action:'info' });
      showToast('Wipe approved and executed — reloading…', 'error');
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      showToast('Wipe failed: ' + (e.message || 'unknown error'), 'error');
    }
    setWipeBusy(false);
  }

  async function handleCancelWipeRequest() {
    if (!wipeRequest) return;
    if (!window.confirm('Cancel this pending wipe request? No data will be deleted.')) return;
    setWipeBusy(true);
    try {
      await cancelWipeRequest(wipeRequest.id);
      logActivity(dispatch, `Data wipe request cancelled by ${currentUser?.name} (originally requested by ${wipeRequest.requested_by_name})`, currentUser, { module:'backup', action:'info' });
      setWipeRequest(null);
      showToast('Wipe request cancelled');
    } catch (e) {
      showToast('Could not cancel: ' + (e.message || 'unknown error'), 'error');
    }
    setWipeBusy(false);
  }

  const th = { padding:'8px 12px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', background:C.tableHeaderBg };
  const td = { padding:'9px 12px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div>
        <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Backup & Restore</div>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Protect your data · export · restore · cloud sync</div>
      </div>

      {/* Data snapshot */}
      <Card>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <div style={{ fontSize:14, fontWeight:700, color:C.text }}>Current Data Snapshot</div>
          <div style={{ fontSize:11, color:C.textMuted }}>In-memory + localStorage</div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:8 }}>
          {dbStats.modules.map(({ k, count }) => (
            <div key={k} style={{ background:C.greenPale, borderRadius:8, padding:'10px 12px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:11.5, color:C.textMid, textTransform:'capitalize' }}>{k}</span>
              <span style={{ fontSize:15, fontWeight:700, color:C.green }}>{count}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop:12, padding:'10px 14px', background:C.greenPale, borderRadius:8, display:'flex', justifyContent:'space-between' }}>
          <span style={{ fontSize:13, fontWeight:600, color:C.text }}>Total Records</span>
          <span style={{ fontSize:18, fontWeight:800, color:C.green }}>{dbStats.total}</span>
        </div>
      </Card>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        {/* Local Backup */}
        <Section icon="💾" title="Local Backup" sub="Export all data as a JSON file to your device">
          <p style={{ fontSize:12.5, color:C.textMid, lineHeight:1.7, marginBottom:16 }}>Download a complete snapshot of all modules, settings, and activity log. Store the file securely — it can be used to fully restore your data.</p>
          <StatPill label="Records to export" value={dbStats.total} />
          <StatPill label="Activity log entries" value={dbStats.activity} />
          <Btn onClick={handleLocalBackup} style={{ marginTop:12, width:'100%', justifyContent:'center' }}>⬇ Download Backup</Btn>
        </Section>

        {/* Cloud Backup */}
        <Section icon="☁️" title="Cloud Backup" sub="Sync to Firebase Firestore" accent={cloudReady?C.success:C.textMuted}>
          {!cloudReady ? (
            <div style={{ padding:'16px', background:'rgba(107,114,128,.08)', borderRadius:8, fontSize:12, color:C.textMuted, lineHeight:1.7 }}>
              Cloud sync requires Firebase credentials in your <code style={{ fontFamily:'monospace', background:C.greenPale, padding:'1px 4px', borderRadius:3 }}>.env</code> file. Contact your system administrator to configure Firebase.
            </div>
          ) : (
            <>
              <p style={{ fontSize:12.5, color:C.textMid, lineHeight:1.7, marginBottom:16 }}>Push all current data to Firebase cloud storage. Previous cloud backup will be overwritten.</p>
              <div style={{ display:'flex', gap:8, marginTop:4 }}>
                <Btn variant="outline" loading={loading.cloud} onClick={handleCloudBackup} style={{ flex:1, justifyContent:'center' }}>☁ Backup to Cloud</Btn>
                <Btn variant="ghost" loading={loading.cloudRestore} onClick={handleCloudRestore} style={{ flex:1, justifyContent:'center' }}>⬆ Restore from Cloud</Btn>
              </div>
            </>
          )}
        </Section>
      </div>

      {/* Restore from File */}
      <Section icon="📂" title="Restore from File" sub="Import a previously exported JSON backup" accent={C.amber}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ flex:1, fontSize:12.5, color:C.textMid, lineHeight:1.7 }}>
            Select a <code style={{ fontFamily:'monospace', fontSize:12, background:C.greenPale, padding:'1px 5px', borderRadius:4 }}>.json</code> backup file previously exported from {SLOT_BRAND.short}. <strong style={{ color:C.danger }}>Warning: this will overwrite all current data.</strong>
          </div>
          <div>
            <input ref={fileRef} type="file" accept=".json" onChange={handleFileRestore} style={{ display:'none' }} />
            <Btn variant="amber" onClick={()=>fileRef.current?.click()}>📂 Choose Backup File</Btn>
          </div>
        </div>
      </Section>

      {/* Integrity Check */}
      <Section icon="🔍" title="Data Integrity Check" sub="Verify local storage is intact and consistent">
        <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom: verifyResult ? 16 : 0 }}>
          <div style={{ flex:1, fontSize:12.5, color:C.textMid }}>Scan all stored modules for corruption, missing keys, or invalid data structures.</div>
          <Btn variant="outline" onClick={handleVerify}>Run Check</Btn>
        </div>
        {verifyResult && (
          verifyResult.ok ? (
            <div style={{ padding:'12px 16px', background:'rgba(26,122,74,.08)', border:'1px solid rgba(26,122,74,.2)', borderLeft:'4px solid '+C.success, borderRadius:8, fontSize:12.5, color:C.success }}>
              ✓ Integrity check passed — {verifyResult.records} records across {verifyResult.checked} modules. All data structures valid.
            </div>
          ) : (
            <div style={{ padding:'12px 16px', background:'rgba(192,57,43,.08)', border:'1px solid rgba(192,57,43,.2)', borderLeft:'4px solid '+C.danger, borderRadius:8, fontSize:12.5, color:C.danger }}>
              ✗ Issues found:<br />
              <ul style={{ margin:'6px 0 0 16px' }}>{verifyResult.issues.map((iss,i)=><li key={i}>{iss}</li>)}</ul>
            </div>
          )
        )}
      </Section>

      {/* Backup History */}
      {history.length > 0 && (
        <Section icon="🗂" title="Backup History" sub="Last 20 backup and restore operations">
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                {['Date & Time','Operation','Records','File','Status'].map(h=><th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {history.map((h,i)=>(
                  <tr key={i} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <td style={{ ...td, fontSize:12, fontFamily:'monospace' }}>{formatDateTime(h.date)}</td>
                    <td style={td}><span style={{ fontSize:11.5, fontWeight:600, color:h.type.includes('Restore')?C.amber:C.green }}>{h.type}</span></td>
                    <td style={{ ...td, fontWeight:600 }}>{h.records||'—'}</td>
                    <td style={{ ...td, fontSize:11.5, color:C.textMuted }}>{h.file||'—'}</td>
                    <td style={td}><span style={{ fontSize:11, fontWeight:600, color:h.status==='Success'?C.success:C.danger }}>{h.status==='Success'?'✓':''} {h.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Danger Zone */}
      <Section icon="⚠️" title="Danger Zone" sub="Irreversible actions — use with extreme caution" accent={C.danger}>
        <div style={{ fontSize:12.5, color:C.textMid, lineHeight:1.7, marginBottom:16 }}>
          <strong style={{ color:C.danger }}>Wipe all data</strong> — permanently deletes every live business record (HR, payroll, procurement, accounting, everything) for this company. Company details, user accounts, and settings are kept. This cannot be undone. Export a backup first.
        </div>

        <div style={{ padding:'10px 14px', background:'rgba(26,122,74,.06)', border:'1px solid rgba(26,122,74,.15)', borderLeft:'4px solid '+C.green, borderRadius:8, fontSize:11.5, color:C.textMid, marginBottom:16 }}>
          🔒 Two-admin approval required. One admin requests the wipe, a <strong>different</strong> admin must independently approve before anything is deleted. Requests expire automatically after 24 hours if not approved.
        </div>

        {!wipeLoaded ? (
          <div style={{ fontSize:12, color:C.textMuted }}>Loading wipe request status…</div>
        ) : wipeRequest ? (
          // ── A request is pending ──────────────────────────────────────
          <div style={{ padding:'16px', background:'rgba(192,57,43,.06)', border:'1px solid rgba(192,57,43,.25)', borderLeft:'4px solid '+C.danger, borderRadius:8 }}>
            <div style={{ fontSize:13, fontWeight:700, color:C.danger, marginBottom:6 }}>⚠️ Wipe request pending approval</div>
            <div style={{ fontSize:12.5, color:C.text, lineHeight:1.8 }}>
              <div>Requested by <strong>{wipeRequest.requested_by_name}</strong> on {formatDateTime(wipeRequest.requested_at)}</div>
              {wipeRequest.reason && <div>Reason: {wipeRequest.reason}</div>}
              <div style={{ color:C.textMuted, fontSize:11.5 }}>Expires {formatDateTime(wipeRequest.expires_at)} if not approved</div>
            </div>
            <div style={{ display:'flex', gap:8, marginTop:14 }}>
              {wipeRequest.requested_by_name === currentUser?.name ? (
                <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic', display:'flex', alignItems:'center' }}>
                  Waiting for a different admin to approve — you requested this, so you can't approve it yourself.
                </div>
              ) : (
                <Btn variant="danger" loading={wipeBusy} onClick={handleApproveWipe}>🗑 Approve &amp; Execute Wipe</Btn>
              )}
              <Btn variant="ghost" loading={wipeBusy} onClick={handleCancelWipeRequest}>Cancel Request</Btn>
            </div>
          </div>
        ) : (
          // ── No request pending — start one ───────────────────────────
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <input
              value={wipeReason}
              onChange={e => setWipeReason(e.target.value)}
              placeholder="Reason for this wipe (shown to the approving admin)"
              style={{ padding:'8px 12px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12.5, outline:'none', fontFamily:'inherit' }}
            />
            <div style={{ display:'flex', justifyContent:'flex-end' }}>
              <Btn variant="danger" loading={wipeBusy} onClick={handleRequestWipe}>🗑 Request Data Wipe</Btn>
            </div>
          </div>
        )}

        {wipeHistory.length > 0 && (
          <div style={{ marginTop:18 }}>
            <div style={{ fontSize:11.5, fontWeight:700, color:C.textMuted, textTransform:'uppercase', letterSpacing:'.4px', marginBottom:8 }}>Past wipe requests</div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>{['Requested','By','Status','Approved / Cancelled By','When'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {wipeHistory.map(h => (
                    <tr key={h.id}>
                      <td style={{ ...td, fontSize:11.5 }}>{formatDateTime(h.requested_at)}</td>
                      <td style={td}>{h.requested_by_name}</td>
                      <td style={td}>
                        <span style={{ fontSize:11, fontWeight:600, color: h.status==='completed'?C.danger : h.status==='cancelled'?C.textMuted : C.amber }}>
                          {h.status==='completed'?'✓ Executed':h.status==='cancelled'?'Cancelled':'Expired'}
                        </span>
                      </td>
                      <td style={{ ...td, fontSize:11.5 }}>{h.approved_by_name || h.cancelled_by_name || '—'}</td>
                      <td style={{ ...td, fontSize:11.5 }}>{formatDateTime(h.executed_at || h.cancelled_at || h.requested_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
