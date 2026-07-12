import { useEffect, useMemo, useRef, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import ErrorBoundary from './components/ErrorBoundary';
import { AppProvider, useApp } from './context/AppContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { getSession, touchActivity, logout } from './utils/auth';
import { signOutOfSupabase } from './supabase/auth';
import { loadDBLocal, loadSettingsLocal, loadAccountingLocal, loadDBCloud, seedDemoData, saveDBLocal, saveAccountingLocal, saveDBCloud, getStorageHealth, migrateFleetData } from './utils/db';
import { showToast } from './utils/helpers';
import { DEFAULT_COA } from './utils/accounting';
import { flushQueue, getPendingCount, isOnline } from './supabase/sync';

import LoginScreen      from './components/layout/LoginScreen';
import Sidebar          from './components/layout/Sidebar';
import Topbar           from './components/layout/Topbar';
import Dashboard        from './components/modules/Dashboard';
import ContractStaff    from './components/modules/ContractStaff';
import SlotStaff        from './components/modules/SlotStaff';
import Procurement      from './components/modules/Procurement';
import Inventory        from './components/modules/Inventory';
import TerminalOps      from './components/modules/TerminalOps';
import FleetMaintenance from './components/modules/FleetMaintenance';
import Accounting       from './components/modules/Accounting';
import AccountsPayable    from './components/modules/AccountsPayable';
import AccountsReceivable from './components/modules/AccountsReceivable';
import ProjectPL          from './components/modules/ProjectPL';
import PettyCash        from './components/modules/PettyCash';
import Requests         from './components/modules/Requests';
import Approvals        from './components/modules/Approvals';
import Analytics        from './components/modules/Analytics';
import Users            from './components/modules/Users';
import Settings         from './components/modules/Settings';
import Backup           from './components/modules/Backup';
import ExcelManager     from './components/modules/ExcelManager';
import ModuleEditor     from './components/modules/ModuleEditor';
import FixedAssets      from './components/modules/FixedAssets';

const PAGES = {
  dashboard:    Dashboard,
  nlng:         ContractStaff,
  slot:         SlotStaff,
  procurement:  Procurement,
  terminal:     TerminalOps,
  inventory:    Inventory,
  vehicles:     FleetMaintenance,
  invoices:     AccountsReceivable,
  ap:           AccountsPayable,
  projectpl:    ProjectPL,
  pettycash:    PettyCash,
  request:      Requests,
  accounting:   Accounting,
  approvals:    Approvals,
  analytics:    Analytics,
  users:        Users,
  settings:     Settings,
  backup:       Backup,
  fixedassets:  FixedAssets,
  excel:        ExcelManager,
  moduleeditor: ModuleEditor,
};

const SIDEBAR_W_OPEN   = 252;
const SIDEBAR_W_CLOSED = 60;

// ── Cloud sync with hard timeout — never blocks the UI ────────────────────────
const CLOUD_TIMEOUT_MS = 5000; // 5 seconds max — then fall back to local silently

async function syncCloud(dispatch, localSnapshot) {
  try {
    const cloud = await Promise.race([
      loadDBCloud(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('cloud_timeout')), CLOUD_TIMEOUT_MS)
      ),
    ]);

    dispatch({ type: 'SET_CLOUD', payload: true });

    if (cloud) {
      let { db, settings, acctData, activity } = localSnapshot;
      if (cloud.db) {
        db = { ...db, ...cloud.db };
        ['fixedassets','wht','_trash'].forEach(k => { if (!Array.isArray(db[k])) db[k] = []; });
        if (!db.terminal      || Array.isArray(db.terminal))      db.terminal      = { containers:[], charges:[], logistics:[] };
        if (!db.procurement   || Array.isArray(db.procurement))   db.procurement   = { rfqs:[], pos:[], waybills:[], invoices:[] };
        if (!db.fleet         || Array.isArray(db.fleet))         db.fleet         = { fleet:[], services:[], maintLog:[], repairs:[], breakdowns:[], requests:[], handovers:[], facilitySchedule:[], calibration:[] };
        if (!db.fleet.calibration)                                db.fleet.calibration = [];
        db.fleet = migrateFleetData(db.fleet);
        if (!db.pettycash_fund|| Array.isArray(db.pettycash_fund))db.pettycash_fund= { balance:500000, limit:500000, custodian:'Finance Officer', lastReplenished:'' };
        // Lazy-seed: if cloud data is empty, inject demo data so modules aren't blank
        // This handles the case where cloud row was saved before data existed
        if (!db.procurement.pos?.length && !db.procurement.rfqs?.length) {
          db.procurement = seedDemoData().procurement;
        }
        if (!db.fleet.fleet?.length) {
          const freshFleet = seedDemoData();
          db.fleet = freshFleet.fleet;
        }
        dispatch({ type: 'SET_DB', payload: db });
      }
      if (cloud.settings) dispatch({ type: 'SET_SETTINGS', payload: cloud.settings });
      if (cloud.acctData) dispatch({ type: 'SET_ACCT',     payload: cloud.acctData });
      // Merge cloud activity with current local activity — preserve local entries
      // that haven't synced to cloud yet (avoids wiping activity on load)
      if (Array.isArray(cloud.activity) && cloud.activity.length) {
        const currentLocal = loadDBLocal()?.activity || [];
        const times  = new Set(currentLocal.map(e => e.time || e.timestamp));
        const merged = [...currentLocal, ...cloud.activity.filter(e => !times.has(e.time || e.timestamp))]
          .sort((a,b) => new Date(b.time||b.timestamp||0) - new Date(a.time||a.timestamp||0))
          .slice(0, 200);
        dispatch({ type: 'SET_ACTIVITY', payload: merged });
      }
    }
  } catch (err) {
    // Timeout or network error — app already running on local data, no toast needed
    if (err.message !== 'cloud_timeout') {
      dispatch({ type: 'SET_OFFLINE', payload: true });
    }
    // cloud_timeout: stay in local-only mode silently — no indicator change
  }
}

function Shell() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, loading } = state;
  const [page, setPage]                         = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const scrollRef = useRef(null);

  // ── Reset scroll to top on every page navigation — no jump, no flash ──
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [page]);
  const [mobileOpen, setMobileOpen]             = useState(false);
  const [online, setOnline]                     = useState(isOnline());
  const [pendingSync, setPendingSync]           = useState(0);

  // ── Online / offline detection ─────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = async () => {
      setOnline(true);
      const flushed = await flushQueue();
      if (flushed) showToast('Back online — offline changes synced ☁', 'success');
      else showToast('Back online', 'success');
    };
    const handleOffline = () => {
      setOnline(false);
      showToast('Offline — changes saved locally', 'info');
    };
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── Session timeout watcher ────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const intervalId = setInterval(() => {
      const session = getSession();
      if (!session) {
        showToast('Session expired — please sign in again', 'info');
        dispatch({ type: 'SET_USER', payload: null });
      }
    }, 60_000);
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    const onActivity = () => touchActivity();
    events.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }));
    return () => {
      clearInterval(intervalId);
      events.forEach(ev => window.removeEventListener(ev, onActivity));
    };
  }, [currentUser, dispatch]);

  // ── Boot: Phase 1 — local data → show app immediately ────────────────────
  // Phase 2 — cloud sync runs in background with 5s timeout (never blocks UI)
  useEffect(() => {
    function init() {
      const session       = getSession();
      const local         = loadDBLocal();
      const localSettings = loadSettingsLocal();
      const localAcct     = loadAccountingLocal();

      // ── Seed version gate — bump SEED_VERSION to force a re-seed ──────────
      // This replaces the old totalRecords() guard which was unreliable because
      // procurement: [] (empty array) made totalRecords > 0 on old sessions,
      // causing the seed to be skipped even when all real data was missing.
      const SEED_VERSION = 'slot-seed-v3';
      const seeded = localStorage.getItem('slot_seed_version') === SEED_VERSION;

      let db       = (!seeded || !local) ? seedDemoData() : local.db;
      let activity = (!seeded || !local?.activity?.length) ? [] : local.activity;
      let settings = localSettings || state.appSettings;
      // Migrate from old acctData field names (chartOfAccounts→coa, journalEntries→journals, etc.)
      let acctData = localAcct || {};
      if (acctData.chartOfAccounts && !acctData.coa) {
        acctData = { journals: acctData.journalEntries||[], coa: acctData.chartOfAccounts||[], bankStmt: acctData.bankEntries||[], vatAdj: acctData.vatAdjustments||[], whtEntries: acctData.whtEntries||[], assets: acctData.assets||[] };
      }
      if (!acctData.coa) acctData = { journals:[], coa:[], bankStmt:[], vatAdj:[], whtEntries:[], assets:[] };

      // If first-ever load or seed version changed, force-write seed to localStorage
      if (!seeded) {
        try {
          saveDBLocal(db, []);
          // Also clear stale module-specific keys so they get re-seeded below
          localStorage.removeItem('slot_proc');
          localStorage.removeItem('slot_pettycash_fund');
          localStorage.setItem('slot_seed_version', SEED_VERSION);
        } catch(e) { console.warn('Seed write failed:', e.message); }
      }


            // ── Lazy-seed: inject module data when central store is empty ──────────
      // Runs for users already on the current seed version (seeded=true) but
      // who lost procurement/fleet data due to the private-key migration.
      // Safe: only fills in when length is 0 — never overwrites real data.
      if (!db.procurement?.pos?.length && !db.procurement?.rfqs?.length) {
        const freshSeed = seedDemoData();
        db.procurement = freshSeed.procurement;
      }
      if (!db.fleet?.fleet?.length) {
        const freshSeed = seedDemoData();
        db.fleet = freshSeed.fleet;
      }

      // ── Generate seed activity log ─────────────────────────────────────────
      if (!activity.length) {
        // Seed entries use the SAME schema as logActivity() — {msg, who, role, time, module, action}
        const t = (ms) => new Date(Date.now() - ms).toISOString();
        activity = [
          { msg:'System initialised — SLOT Engineering demo data loaded across all modules.', who:'System',        role:'system',      time:t(1000*60*5),    module:'System',      action:'info'    },
          { msg:'Invoice SLOT-INV-2026-0003 marked as Paid — NLNG Mar retainer ₦4,612,500. Ref: NLNG-TRF-0331.', who:'Grace Okonkwo', role:'accountant', time:t(1000*60*60*2),  module:'Invoices',    action:'edit'    },
          { msg:'GRN-2026-0005 created — Mikano International, Perkins generator spare parts kit (3 units).',     who:'Alex Mbata',    role:'manager',     time:t(1000*60*60*5),  module:'Procurement', action:'create'  },
          { msg:'PO-2026-0015 approved — Mikano Perkins spare parts, value ₦1,564,125.',                          who:'Ernest Ojukwu', role:'admin',       time:t(1000*60*60*8),  module:'Procurement', action:'approve' },
          { msg:'Leave request LRQ-2026-0002 submitted — Ngozi Okafor, annual leave 22–28 April 2026.',           who:'Ngozi Okafor',  role:'viewer',      time:t(1000*60*60*24), module:'Requests',    action:'create'  },
          { msg:'Petty cash voucher PCV-2026-0014 raised — Transport to Onne Port, ₦38,000. Awaiting approval.', who:'Ngozi Okafor',  role:'cashier',     time:t(1000*60*60*26), module:'Petty Cash',  action:'create'  },
          { msg:'Container TRHU9876543 (Hapag-Lloyd 40ft HC) status updated to Under Exam.',                      who:'Chidi Okafor',  role:'manager',     time:t(1000*60*60*48), module:'Terminal',    action:'edit'    },
          { msg:'Breakdown reported — LA-123-BCD (Ford Ranger), engine warning light. Emeka Electrical engaged.', who:'Chidi Okafor',  role:'manager',     time:t(1000*60*60*72), module:'Fleet',       action:'create'  },
          { msg:'Invoice SLOT-INV-2026-0007 created — Chevron PPE supply, ₦4,730,000. Status: Draft.',            who:'Grace Okonkwo', role:'accountant',  time:t(1000*60*60*96), module:'Invoices',    action:'create'  },
          { msg:'Request ITQ-2026-0001 approved — Dell laptop replacement for Finance, budget ₦450,000.',         who:'Ernest Ojukwu', role:'admin',       time:t(1000*60*60*120),module:'Requests',    action:'approve' },
        ];
      }

      // ── Phase 1: show app immediately on local data ──
      dispatch({ type: 'SET_DB',       payload: db       });
      dispatch({ type: 'SET_SETTINGS', payload: settings });
      dispatch({ type: 'SET_ACCT',     payload: acctData });
      dispatch({ type: 'SET_ACTIVITY', payload: activity });
      if (session) dispatch({ type: 'SET_USER', payload: session });
      dispatch({ type: 'SET_LOADING',  payload: false    }); // ← UI visible NOW

      setPendingSync(getPendingCount());

      // Storage quota warning
      try {
        const health = getStorageHealth();
        if (health.status === 'warning') showToast(`Storage ${health.pct}% full — consider a backup`, 'info');
        else if (health.status === 'full') showToast('⚠ Storage nearly full! Export backup now.', 'error');
      } catch {}

      // ── Phase 2: cloud sync in background — non-blocking ──
      syncCloud(dispatch, { db, settings, acctData, activity });
    }

    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stable page component — must be above ALL conditional returns ───────────
  // useMemo must never be called after an early return (Rules of Hooks).
  const PageComponent = useMemo(
    () => PAGES[page] || (() => <div style={{ padding:40, color:C.textMuted }}>Module not found</div>),
    [page]
  );

  // ── Persistence: save to localStorage whenever db or activity changes ─────
  // This is the fix for data wiping on hard refresh (Ctrl+Shift+R).
  // We skip the very first render (loading=true) to avoid overwriting with
  // empty initialState before the boot useEffect has loaded real data.
  useEffect(() => {
    if (loading) return; // don't save before data is loaded
    try {
      saveDBLocal(state.db, state.activity);
    } catch (err) {
      if (err.message === 'STORAGE_FULL') {
        showToast('⚠ Storage nearly full — export a backup now', 'error');
      }
    }
    // Also push to Supabase cloud — fire-and-forget (no await, won't block UI)
    if (state.cloudReady) {
      saveDBCloud(state.db, state.activity, state.appSettings, state.acctData)
        .catch(e => console.warn('[BizCore] Auto cloud save failed:', e.message));
    }
  }, [state.db, state.activity, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist accounting data whenever it changes ───────────────────────────
  useEffect(() => {
    if (loading) return;
    try { saveAccountingLocal(state.acctData); } catch {}
  }, [state.acctData, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:C.bg, flexDirection:'column', gap:14 }}>
      <div style={{ fontSize:22, fontWeight:800, color:C.green }}>SLOT Engineering ERP</div>
      <div style={{ fontSize:12, color:C.textMuted }}>Starting…</div>
    </div>
  );

  if (!currentUser) return (
    <LoginScreen onLogin={user => { dispatch({ type:'SET_USER', payload:user }); touchActivity(); }} />
  );

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden', background:C.bg, fontFamily:"'Segoe UI','Trebuchet MS',system-ui,sans-serif" }}>
      <ErrorBoundary label="the navigation sidebar">
        <Sidebar
          active={page}
          onNav={setPage}
          collapsed={sidebarCollapsed}
          onCollapse={setSidebarCollapsed}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />
      </ErrorBoundary>
      <div style={{
        flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0,
        marginLeft: `clamp(0px, calc((100vw - 767px) * 999), ${sidebarCollapsed ? SIDEBAR_W_CLOSED : SIDEBAR_W_OPEN}px)`,
        transition:'margin-left 0.22s ease',
      }}>
        <ErrorBoundary label="the top bar">
          <Topbar
            page={page}
            online={online}
            pendingSync={pendingSync}
            onMenuClick={() => setMobileOpen(true)}
            onNav={setPage}
            onLogout={async () => { await signOutOfSupabase(); logout(); dispatch({ type:'SET_USER', payload:null }); setPage('dashboard'); }}
          />
        </ErrorBoundary>
        <div ref={scrollRef} style={{ flex:1, overflowY:'auto', padding:'16px 16px 24px', background:C.bg }}>
          <ErrorBoundary label={`the ${page} module`} onGoHome={() => setPage('dashboard')} key={page}>
            <PageComponent onNav={setPage} />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary label="SLOT ERP" fullPage onReset={() => window.location.reload()}>
      <ThemeProvider>
        <AppProvider>
          <Toaster position="bottom-center" toastOptions={{ style: { fontFamily:"'Segoe UI',system-ui,sans-serif", fontSize:13 } }} />
          <Shell />
        </AppProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
