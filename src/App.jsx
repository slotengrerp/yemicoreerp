import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { lazyWithRetry, prefetchAllChunks } from './utils/lazyWithRetry';
import { Toaster } from 'react-hot-toast';
import ErrorBoundary from './components/ErrorBoundary';
import { AppProvider, useApp, defaultAppState } from './context/AppContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { signOutOfSupabase, restoreSupabaseSession, onSupabaseAuthChange } from './supabase/auth';
import { loadDBLocal, loadSettingsLocal, loadAccountingLocal, loadDBCloud, saveDBLocal, saveAccountingLocal, saveDBCloud, getStorageHealth, migrateFleetData } from './utils/db';
import { computeAutoPostedJournals } from './utils/autoPostJournals';
import { showToast, WIPE_FLAG_KEY } from './utils/helpers';
import { flushQueue, getPendingCount, isOnline, subscribeToChanges } from './supabase/sync';
import { supabase } from './supabase/client';
import { canSeeDashboard } from './utils/auth';

import LoginScreen      from './components/layout/LoginScreen';
import Sidebar          from './components/layout/Sidebar';
import Topbar           from './components/layout/Topbar';
import MfaNudge         from './components/layout/MfaNudge';
import { usePerRecordSync, USE_PER_RECORD, pushNewJournals } from './hooks/usePerRecordSync';

// ══════════════════════════════════════════════════════════════════════════════
// ONE-TIME LOCAL PURGE — 2026-07-28
// ══════════════════════════════════════════════════════════════════════════════
// On 2026-07-28 the Supabase database was deliberately emptied: every business
// table truncated, demo seeding removed from this file for good. But localStorage
// lives in each individual browser, and stale copies there don't just linger —
// the sync engine treats them as real records and pushes them straight back into
// the clean database, undoing the wipe from any laptop that happens to open the
// app. Chasing that down device by device is not realistic.
//
// So this runs once per browser, before any data is read: clear every bc_ / slot_
// key, then stamp a version so it never runs again. Bump PURGE_VERSION to force
// another purge in future.
//
// Deliberately NOT cleared: the Supabase auth session, stored under the key
// 'slot-erp-auth' (a hyphen, not an underscore — it does not match the filter
// below). Wiping it would sign every user out and make this look like a broken
// deploy rather than a clean slate.
//
// WIPE_FLAG_KEY is set afterwards so each module's "empty means brand-new
// install, show demo records" fallback knows the emptiness is intentional.
// Bumped to -b: the first purge ran before the fabricated ₦100,000 petty cash
// float was fixed, so browsers that loaded that build have the invented figure
// saved in localStorage. The normalisation in utils/db.js only fills the key in
// when it is ABSENT, so it would never correct an already-stored value — those
// browsers need one more sweep.
const PURGE_VERSION = 'slot-purge-2026-07-28-b';
try {
  if (localStorage.getItem('slot_purge_version') !== PURGE_VERSION) {
    Object.keys(localStorage)
      .filter(k => k.startsWith('bc_') || k.startsWith('slot_'))
      .forEach(k => localStorage.removeItem(k));
    localStorage.setItem('slot_purge_version', PURGE_VERSION);
    localStorage.setItem(WIPE_FLAG_KEY, '1');
    console.info('[SLOT ERP] Local data purged — clean slate applied.');
  }
} catch (e) {
  console.warn('[SLOT ERP] Local purge could not run:', e?.message || e);
}

// Code-split heavy modules — they each get their own chunk and load on
// demand the first time the user navigates to them. Cuts the initial
// payload from a single ~917KB bundle to a much smaller landing bundle.
const Dashboard        = lazyWithRetry(() => import('./components/modules/Dashboard'), 'Dashboard');
const ContractStaff    = lazyWithRetry(() => import('./components/modules/ContractStaff'), 'ContractStaff');
const SlotStaff        = lazyWithRetry(() => import('./components/modules/SlotStaff'), 'SlotStaff');
const Procurement      = lazyWithRetry(() => import('./components/modules/Procurement'), 'Procurement');
const Inventory        = lazyWithRetry(() => import('./components/modules/Inventory'), 'Inventory');
const TerminalOps      = lazyWithRetry(() => import('./components/modules/TerminalOps'), 'TerminalOps');
const FleetMaintenance = lazyWithRetry(() => import('./components/modules/FleetMaintenance'), 'FleetMaintenance');
const Accounting       = lazyWithRetry(() => import('./components/modules/Accounting'), 'Accounting');
const AccountsPayable  = lazyWithRetry(() => import('./components/modules/AccountsPayable'), 'AccountsPayable');
const AccountsReceivable = lazyWithRetry(() => import('./components/modules/AccountsReceivable'), 'AccountsReceivable');
const ProjectPL        = lazyWithRetry(() => import('./components/modules/ProjectPL'), 'ProjectPL');
const PettyCash        = lazyWithRetry(() => import('./components/modules/PettyCash'), 'PettyCash');
const Requests         = lazyWithRetry(() => import('./components/modules/Requests'), 'Requests');
const Approvals        = lazyWithRetry(() => import('./components/modules/Approvals'), 'Approvals');
const Analytics        = lazyWithRetry(() => import('./components/modules/Analytics'), 'Analytics');
const Users            = lazyWithRetry(() => import('./components/modules/Users'), 'Users');
const Settings         = lazyWithRetry(() => import('./components/modules/Settings'), 'Settings');
const Backup           = lazyWithRetry(() => import('./components/modules/Backup'), 'Backup');
const ActivityLog      = lazyWithRetry(() => import('./components/modules/ActivityLog'), 'ActivityLog');
const ExcelManager     = lazyWithRetry(() => import('./components/modules/ExcelManager'), 'ExcelManager');
const ModuleEditor     = lazyWithRetry(() => import('./components/modules/ModuleEditor'), 'ModuleEditor');
const FixedAssets      = lazyWithRetry(() => import('./components/modules/FixedAssets'), 'FixedAssets');
const SalesOrders      = lazyWithRetry(() => import('./components/modules/SalesOrders'), 'SalesOrders');
const SageReports      = lazyWithRetry(() => import('./components/modules/SageReports'), 'SageReports');
// SageReports2 ("Sage Features II") removed 2026-08-14 per Yemi's instruction —
// it was a second, independently-built implementation of 6 features already
// covered by SageReports ("Slot Reports"): Recurring Invoices, Bank
// Reconciliation, Prepayments & Accruals, and Asset Disposal each wrote to
// their own separate, disconnected Supabase table there, so data entered
// through one module was invisible in the other. Whether those 4 tables
// (recurring_invoices, prepay_accruals, bank_reconciliations, asset_disposals)
// ever had real data was NOT verified before this removal — the QA-recommended
// check query was blocked by the environment's own SQL safety classifier and
// was not independently re-run. Removing the route makes the data merely
// unreachable from the UI, not deleted, so this is reversible: re-add
// `const SageReports2 = lazyWithRetry(...)` here, `sagereports2: SageReports2`
// in PAGES below, and the Sidebar.jsx nav entry to bring it back. The
// component file and its tables are left in place. See SageReportsTier2.jsx
// for the equivalent, single-source-of-truth versions of these 6 features.

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
  activitylog:  ActivityLog,
  fixedassets:  FixedAssets,
  salesorders:  SalesOrders,
  sagereports:  SageReports,
  excel:        ExcelManager,
  moduleeditor: ModuleEditor,
};

// ── Password-recovery link detection ──────────────────────────────────────
// Supabase's reset-password email sends the user back to redirectTo
// (requestPasswordReset in supabase/auth.js) with either a recovery token
// or an error in the URL hash:
//   success: #access_token=...&type=recovery&...
//   failure: #error=access_denied&error_code=otp_expired&error_description=...
// There was previously NO code anywhere reading either of these — the app
// only ever sent the email; nothing handled what happens after the user
// clicks it. With detectSessionInUrl defaulting to true, a valid recovery
// link would silently sign the browser in (via the temporary recovery
// session) with no prompt to actually set a new password, and an
// expired/invalid link just landed on a blank app with no explanation. This
// parses the hash once on boot so Shell can show a dedicated screen instead.
function parseRecoveryHash() {
  if (typeof window === 'undefined' || !window.location.hash) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (params.get('error')) {
    return {
      mode: 'error',
      code: params.get('error_code') || params.get('error'),
      description: params.get('error_description') || 'This link is invalid or has expired.',
    };
  }
  if (params.get('type') === 'recovery') {
    return { mode: 'recovery' };
  }
  return null;
}

// ── Home page per role ─────────────────────────────────────────────────────
// Dashboard aggregates data across every module (HR headcount, money
// in/out), so it's only a valid "home" for admin/manager/accountant — see
// canSeeDashboard() in utils/auth.js. Everyone else (built-in cashier/
// viewer or any custom role, e.g. "Terminal Supervisor") lands on the first
// module actually assigned to them instead. Returns null if the user
// somehow has no modules assigned — handled explicitly at the render site
// below rather than silently falling back to Dashboard, which would defeat
// the whole point of this restriction.
function computeHomePage(user) {
  if (!user) return 'dashboard';
  if (canSeeDashboard(user)) return 'dashboard';
  return (user.modules || []).find(m => PAGES[m]) || null;
}

const SIDEBAR_W_OPEN   = 252;
const SIDEBAR_W_CLOSED = 60;

// ── Cloud sync with hard timeout — never blocks the UI ────────────────────────
const CLOUD_TIMEOUT_MS = 5000; // 5 seconds max — then fall back to local silently

// ── Client/Project/Vendor master data bridge ──────────────────────────────────
// See the long comment at its call site in syncCloud() for why this exists.
function mirrorMasterData(localKey, modName, cloudValue, pushLocalToCloud) {
  try {
    if (Array.isArray(cloudValue) && cloudValue.length > 0) {
      // Cloud has data for this module — keep the local plain-function read
      // path (getClients/getProjects/getVendors) in sync with it.
      localStorage.setItem(localKey, JSON.stringify(cloudValue));
    } else {
      // Cloud is empty for this module — if this device has local-only data
      // from before this fix existed, migrate it up so it finally syncs.
      const raw = localStorage.getItem(localKey);
      if (raw) {
        const local = JSON.parse(raw);
        if (Array.isArray(local) && local.length) pushLocalToCloud(local);
      }
    }
  } catch { /* non-fatal — worst case, master data stays local-only a bit longer */ }
}

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
        // Normalize Sage Features II module keys — these are stored as arrays
        // but may arrive from cloud as undefined or wrong shape
        ['recurringInvoices','recurringInvoiceTemplates','prepayAccruals','bankReconciliations','assetDisposals','prepayments','accruals','budgets','stockTakes','stockItems','stockMovements','warehouses','stockTransfers','serialBatches','boms','bomBuilds','creditNotes','paymentBatches','arReceipts'].forEach(k => { if (!Array.isArray(db[k])) db[k] = []; });
        // Normalize ap object (used by Bank Recon tab in SageReports2)
        if (!db.ap || Array.isArray(db.ap)) db.ap = { bills: [], payments: [] };
        if (!Array.isArray(db.ap.bills)) db.ap.bills = [];
        if (!Array.isArray(db.ap.payments)) db.ap.payments = [];
        if (!db.terminal      || Array.isArray(db.terminal))      db.terminal      = { containers:[], charges:[], logistics:[], bols:[], advances:[] };
        if (!db.procurement   || Array.isArray(db.procurement))   db.procurement   = { rfqs:[], pos:[], waybills:[], invoices:[] };
        if (!db.fleet         || Array.isArray(db.fleet))         db.fleet         = { fleet:[], services:[], maintLog:[], repairs:[], breakdowns:[], requests:[], handovers:[], facilitySchedule:[], calibration:[] };
        if (!db.fleet.calibration)                                db.fleet.calibration = [];
        db.fleet = migrateFleetData(db.fleet);
        // 2026-07-28: was balance/limit 500000 — see utils/db.js. Never invent cash.
        if (!db.pettycash_fund|| Array.isArray(db.pettycash_fund))db.pettycash_fund= { balance:0, limit:0, custodian:'', lastReplenished:'' };
        // NOTE: a "lazy-seed if empty" guard used to live here (re-injecting
        // demo procurement/fleet data whenever those arrays were empty). It
        // was a one-time migration safety net for a past private-key bug,
        // but it made "intentionally empty, ready for real data" impossible
        // to reach — every reload would silently refill demo records. That
        // migration is long done, so this was removed rather than kept as a
        // permanent trap. An empty module now stays empty until real data
        // (import or manual entry) puts something there.
        dispatch({ type: 'SET_DB', payload: db });
      }

      // ── Client/Project/Vendor master data ──────────────────────────────────
      // These three used to live ONLY in their own private localStorage keys
      // (bc_clients/bc_projects/bc_vendors), completely disconnected from the
      // Supabase-synced db object — meaning none of it ever reached the cloud.
      // Now: db.clients/db.projects/db.vendors are part of the synced object.
      //   - If the cloud copy has data, mirror it into the local keys so
      //     getClients()/getProjects()/getVendors() (plain functions, not
      //     hooks — they read localStorage directly) see the latest version
      //     regardless of which device it came from.
      //   - If the cloud copy is empty but this device has local-only data
      //     (the pre-fix state), pull it into `db` once so it finally gets
      //     pushed to the cloud on the next save.
      mirrorMasterData('bc_clients',  'clients',  db.clients,  x => dispatch({ type: 'UPDATE_MODULE', mod: 'clients',  data: x }));
      mirrorMasterData('bc_projects', 'projects', db.projects, x => dispatch({ type: 'UPDATE_MODULE', mod: 'projects', data: x }));
      mirrorMasterData('bc_vendors',  'vendors',  db.vendors,  x => dispatch({ type: 'UPDATE_MODULE', mod: 'vendors',  data: x }));
      if (cloud.settings) {
        dispatch({ type: 'SET_SETTINGS', payload: cloud.settings });
        if (cloud.settings.dataWiped) {
          try { localStorage.setItem(WIPE_FLAG_KEY, '1'); } catch {}
        }
      }
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
  const [recovery]                              = useState(() => parseRecoveryHash());
  const scrollRef = useRef(null);
  const conflictNoticeShown = useRef(false);
  const wipeNoticeShown = useRef(false);

  // ── CRITICAL: fresh-state refs for realtime handlers ────────────────────────
  // The legacy realtime subscription (subscribeToChanges) is set up in a
  // useEffect with deps=[currentUser, dispatch]. Without these refs, every
  // remote postgres_changes event read state.activity from the closure
  // captured at sign-in — so any local activity entries created after sign-in
  // (every logActivity call) were silently dropped from the merge. Refs are
  // updated on every render so the realtime handler reads the LIVE value when
  // an event arrives minutes/hours later.
  const stateActivityRef = useRef(state.activity);
  useEffect(() => { stateActivityRef.current = state.activity; }, [state.activity]);

  // Toast-throttle ref — without this, every remote postgres_changes event
  // fired a toast. Two users editing at the same time → both clients got a
  // toast every few seconds. Throttled to once per 5 seconds; only the first
  // remote change in a 5-second window shows a toast.
  const lastRemoteToastRef = useRef(0);

  // ── Per-record Supabase sync — opt-in via VITE_USE_PER_RECORD_SYNC=true ──
  // When enabled, the legacy whole-document sync is bypassed and the
  // app talks to Supabase one row at a time. This is the architectural
  // direction called for in the project profile (Supabase as the
  // single source of truth, not localStorage).
  usePerRecordSync({ state, dispatch });

  // ── Global GL auto-posting — QA fix (2026-08-14) ─────────────────────────
  // computeAutoPostedJournals() (extracted from Accounting.jsx) used to only
  // ever run inside Accounting's own component effect — so any other module
  // or report reading state.acctData.journals before the user had opened
  // Accounting at least once in that browser session silently saw an
  // incomplete ledger, with nothing telling them numbers were missing.
  // Confirmed live: Sage Reports' Comparative P&L showed Total Expenses
  // ₦153,676,894 (missing ₦9,151,490 of "Other Direct Cost" from 5 unposted
  // purchase invoices) until Accounting was visited once, at which point it
  // silently corrected to ₦162,828,384 with no indication anything had
  // changed. Running the same idempotent computation here — every JE has a
  // deterministic ID and is skipped if already present — means the ledger is
  // complete regardless of which module is opened first. Only dispatches
  // when something actually changed (computeAutoPostedJournals returns the
  // same array reference otherwise), so this can't loop against Accounting's
  // own copy of the same effect or against itself.
  useEffect(() => {
    if (loading) return;
    const current = state.acctData?.journals;
    const next = computeAutoPostedJournals(current, state.db, state.appSettings);
    if (next !== current) {
      dispatch({ type: 'SET_ACCT', payload: { ...state.acctData, journals: next } });
    }
  }, [state.db, state.acctData, state.appSettings, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Push new/auto-posted journal entries to Supabase — QA fix (2026-08-14) ──
  // pushJournal()/pushNewJournals() (usePerRecordSync.js) existed as callable
  // primitives but nothing ever called them. Every journal entry — manual
  // posts from Accounting's JournalTab, FX revaluation entries, entries from
  // the journal Import tab, and GL auto-posted entries from the effect just
  // above — only ever reached state.acctData.journals and, under the LEGACY
  // engine, the whole-document blob save. The per-record engine has no
  // equivalent whole-document save for acctData (journals live in their own
  // append-only journal_entries table), so on the per-record engine every
  // journal created after page load lived only in that one browser tab —
  // gone on reload, invisible on every other device. Not urgent while
  // production ran the legacy engine; became live-urgent the moment
  // production's build picked up VITE_USE_PER_RECORD_SYNC=true from a local
  // .env (2026-08-14).
  //
  // This is the one place guaranteed to see every journal regardless of
  // which of the ~6 places created it, since all of them funnel through
  // state.acctData.journals before anything renders — watching that single
  // value here can't miss a source the way wiring each creation site
  // individually could (the exact class of bug flagged elsewhere in this
  // file: a fix applied to one door while others stay open).
  //
  // journalsRef starts at the FIRST value observed so entries already in
  // Supabase (just loaded by usePerRecordSync's own loadJournals()) aren't
  // re-pushed on every mount — pushNewJournals() also independently diffs by
  // id and postJournalEntry() treats duplicates as success, so even a
  // mistimed baseline (this effect racing usePerRecordSync's async initial
  // load) fails safe: at worst a few redundant, harmless insert-attempts.
  const journalsRef = useRef(null);
  useEffect(() => {
    const journals = state.acctData?.journals;
    if (!Array.isArray(journals)) return;
    if (journalsRef.current === null) {
      journalsRef.current = journals; // first observation — baseline, not "new"
      return;
    }
    const prev = journalsRef.current;
    journalsRef.current = journals;
    if (journals !== prev) pushNewJournals(prev, journals);
  }, [state.acctData]);

  // ── Reset scroll to top on every page navigation — no jump, no flash ──
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [page]);

  // ── Clear the recovery hash once it's been read ───────────────────────────
  // Leaving #access_token=...&type=recovery in the URL means a page refresh
  // (or the user copying the URL) re-triggers this same recovery flow later,
  // possibly with a token Supabase has since invalidated. Strip it right
  // after the initial render has captured it into `recovery` above.
  useEffect(() => {
    if (recovery) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Land restricted roles on their own module, not Dashboard ─────────────
  // page defaults to 'dashboard' before we know who's signed in. Once
  // ── Warm every module's code once the user is in ──────────────────────────
  // Modules are code-split, so their JavaScript is normally only fetched at
  // the moment someone clicks into them — which is precisely when a weak
  // connection will bite. SLOT staff reported the "Something went wrong in
  // the ... module" screen constantly for this reason. Pulling all the chunks
  // into cache while the user reads the dashboard means that click no longer
  // needs the network at all. See prefetchAllChunks() for the throttling.
  useEffect(() => {
    if (!currentUser) return;
    prefetchAllChunks();
  }, [currentUser]);

  // currentUser loads, redirect away from it if this role isn't allowed to
  // see the cross-module view (see computeHomePage/canSeeDashboard). This
  // also self-corrects after the SIGNED_OUT and logout handlers below reset
  // page to 'dashboard' — the next sign-in re-runs this effect. The
  // PageComponent guard further down is a render-time backstop for the same
  // rule, in case page is ever 'dashboard' for a restricted user for a beat.
  useEffect(() => {
    if (!currentUser || canSeeDashboard(currentUser)) return;
    if (page === 'dashboard') {
      const home = computeHomePage(currentUser);
      if (home) setPage(home);
    }
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mobileOpen, setMobileOpen]             = useState(false);
  const [online, setOnline]                     = useState(isOnline());
  const [pendingSync, setPendingSync]           = useState(0);

  // ── Unsaved-work banner ─────────────────────────────────────────────────────
  // 2026-08-06. A cloud write that fails is lost for good — there is no retry
  // queue for the per-record engine. Confirmed by test: 3 staff records edited
  // offline, reconnected, refreshed, checked in two browsers, nothing saved.
  // The toast that warns about it fades after a few seconds, so someone who
  // looks away and then closes the tab never learns their work was lost.
  // usePerRecordSync counts failed writes and fires 'slot:unsavedChanges'; this
  // holds a banner up until a save succeeds, and warns before the tab closes.
  const [unsaved, setUnsaved] = useState(0);
  useEffect(() => {
    const onUnsaved = e => setUnsaved(e?.detail?.count || 0);
    window.addEventListener('slot:unsavedChanges', onUnsaved);
    return () => window.removeEventListener('slot:unsavedChanges', onUnsaved);
  }, []);
  useEffect(() => {
    if (!unsaved) return undefined;
    // Browsers ignore custom text here and show their own wording; returnValue
    // must still be set for the prompt to appear at all.
    const warn = e => { e.preventDefault(); e.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

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

  // ── Client/Project/Vendor master data → central store bridge ──────────────
  // clientMaster.js/projectMaster.js/vendorMaster.js are plain utility
  // modules, not components — they can't call dispatch() directly. They fire
  // this event on every save instead; we catch it here and fold the change
  // into the central store, which is what actually reaches Supabase.
  useEffect(() => {
    function handleMasterDataChanged(e) {
      const { mod, data } = e.detail || {};
      if (mod && data) dispatch({ type: 'UPDATE_MODULE', mod, data });
    }
    window.addEventListener('slot:masterDataChanged', handleMasterDataChanged);
    return () => window.removeEventListener('slot:masterDataChanged', handleMasterDataChanged);
  }, [dispatch]);

  // ── Real-time cross-client sync (audit Finding #1 fix) ─────────────────────
  // While the app is open and a user is logged in, subscribe to Supabase
  // postgres_changes on the company_data row. When ANOTHER client writes,
  // we receive the new row here and merge it into our local state — but only
  // if the remote write is strictly newer than our own most recent local
  // change. If a remote change arrives while we have unsaved local edits,
  // we keep our local edits (and surface a banner telling the user another
  // session has newer data, so they can choose to pull it).
  //
  // Proper per-record conflict resolution requires the per-record table
  // migration (see src/supabase/sql/003_per_record_tables.sql). This
  // subscribe call is the live bridge to that future schema — once those
  // tables exist, the same subscribeToChanges function routes through them
  // automatically.
  useEffect(() => {
    // FIX 2026-07-24: this never checked USE_PER_RECORD, so the legacy
    // whole-document realtime subscription — and its "Live data updated
    // from another session" toast — kept firing on every OTHER session's
    // legacy save (including things as small as a login activity stamp)
    // even after the per-record engine went live. The header comment above
    // usePerRecordSync's own effect claims "the legacy whole-document sync
    // is bypassed" once the flag is on; this is what makes that actually
    // true instead of aspirational. It also unconditionally replaced
    // state.db wholesale (line ~290 below) whenever it fired — racing
    // against the per-record engine's own, narrower per-record updates,
    // which is almost certainly what caused the periodic "app goes blank
    // then comes back" symptom reported after the cutover.
    if (!currentUser || USE_PER_RECORD) return undefined;

    let unsub;
    let cancelled = false;

    (async () => {
      try {
        unsub = await subscribeToChanges((remote) => {
          if (cancelled) return;
          if (!remote) return;

          // Server is the source of truth for cross-client merges. We apply
          // it directly — the last-write-wins semantic is the trade-off
          // explicitly documented in supabase/sync.js until per-record tables
          // are deployed. With a fresh page-load this is the desired
          // behaviour; with a long-lived session, local edits between two
          // syncs are still preserved because the persistence useEffect
          // pushes them to Supabase *before* the next remote event could
          // race past them in most realistic human-scale workflows.
          if (remote.db && Object.keys(remote.db).length) {
            dispatch({ type: 'SET_DB', payload: remote.db });
          }
          if (remote.settings && Object.keys(remote.settings).length) {
            dispatch({ type: 'SET_SETTINGS', payload: remote.settings });
          }
          if (remote.acctData && Object.keys(remote.acctData).length) {
            dispatch({ type: 'SET_ACCT', payload: remote.acctData });
          }
          if (Array.isArray(remote.activity) && remote.activity.length) {
            // Merge: keep any local activity entries not present in the
            // remote snapshot (e.g. ones created seconds ago that haven't
            // been picked up by the channel yet), then cap to the most
            // recent 200 entries.
            const remoteTimes = new Set(remote.activity.map(e => e.time || e.timestamp));
            // CRITICAL FIX: read fresh state.activity from the ref instead of
            // the closure capture. Without this, any activity entry created
            // locally between sign-in and the next remote event was silently
            // dropped from the merge — audit-log holes of every kind.
            const liveActivity = stateActivityRef.current || [];
            const localExtra  = liveActivity.filter(
              e => !remoteTimes.has(e.time || e.timestamp)
            );
            const merged = [...remote.activity, ...localExtra]
              .sort((a, b) => new Date(b.time || b.timestamp || 0) - new Date(a.time || a.timestamp || 0))
              .slice(0, 200);
            dispatch({ type: 'SET_ACTIVITY', payload: merged });
          }
          // Throttled toast: at most once per 5 seconds. Without this, every
          // remote postgres_changes event fired a toast, and two users editing
          // at the same time → both clients got a toast every few seconds.
          const now = Date.now();
          if (now - lastRemoteToastRef.current > 5000) {
            lastRemoteToastRef.current = now;
            showToast('☁ Live data updated from another session', 'info');
          }
        });
      } catch (e) {
        // Subscription is non-critical — app keeps working on local data
        console.warn('[SLOT] Real-time subscribe failed:', e?.message || e);
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsub === 'function') unsub();
    };
  }, [currentUser, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session timeout watcher ────────────────────────────────────────────────
  // Supabase JWT has its own exp claim and supabase-js auto-refreshes it.
  // The activity-tracking side effect was removed in v1.2 (no longer
  // meaningful — there is no local session object to time out). If the
  // Supabase session is ever revoked server-side (signOut from another
  // device, password reset, admin force-revoke), the onAuthStateChange
  // listener in the supabase client will fire and we'll react to it
  // there.
  useEffect(() => {
    if (!currentUser) return;
    const unsub = onSupabaseAuthChange((event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        showToast('Signed out — please sign in again', 'info');
        dispatch({ type: 'SET_USER', payload: null });
        setPage('dashboard');
      }
    });
    return unsub;
  }, [currentUser, dispatch]);

  // ── Boot: Phase 1 — local data → show app immediately ────────────────────
  // Phase 2 — cloud sync runs in background with 5s timeout (never blocks UI)
  useEffect(() => {
    async function init() {
      // Whole-function safety net: if ANYTHING below throws unexpectedly,
      // the finally block still guarantees SET_LOADING fires, so the app
      // can never get stuck on the "Starting…" screen forever — worst case
      // it boots with whatever partial/default state exists instead of
      // hanging indefinitely.
      try {
      // restoreSupabaseSession() previously had no try/catch or timeout —
      // if it threw (network error, RLS misconfiguration, etc.) or the
      // request just hung, SET_LOADING never fired and the app was stuck
      // on the "Starting…" screen forever. This contradicted the Phase 1
      // design intent above ("show app immediately") so it's fixed the
      // same way Phase 2 already handles this: try/catch + a timeout race,
      // falling back to "no session" rather than blocking boot.
      let session = null;
      try {
        session = await Promise.race([
          restoreSupabaseSession(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('session_restore_timeout')), CLOUD_TIMEOUT_MS)
          ),
        ]);
      } catch (e) {
        console.warn('[SLOT ERP] Session restore failed or timed out — continuing without it:', e?.message || e);
      }
      const local         = loadDBLocal();
      const localSettings = loadSettingsLocal();
      const localAcct     = loadAccountingLocal();

      // ── Seed version gate — bump SEED_VERSION to force a re-seed ──────────
      // This replaces the old totalRecords() guard which was unreliable because
      // procurement: [] (empty array) made totalRecords > 0 on old sessions,
      // causing the seed to be skipped even when all real data was missing.
      const SEED_VERSION = 'slot-seed-v3';
      const seeded = localStorage.getItem('slot_seed_version') === SEED_VERSION;

      // 2026-07-28 — DEMO SEEDING IS GONE. PERMANENTLY. DO NOT REINTRODUCE IT.
      //
      // This line used to read:
      //     let db = (!seeded || !local) ? seedDemoData() : local.db;
      //
      // which meant any browser missing one localStorage key — cleared
      // storage, incognito, a new laptop, or simply a DIFFERENT DOMAIN, since
      // localStorage is per-origin — silently filled app state with the full
      // demo dataset at boot. The sync engine then did its job and wrote that
      // state to Supabase. On 2026-07-17 that put 472 fake records into the
      // production database, where they sat until 2026-07-28. Every client
      // afterwards dutifully downloaded them, which is why demo data appeared
      // to come back "from nowhere" on its own, and why opening the app on a
      // brand-new domain showed fake records everywhere instantly.
      //
      // An empty app is the CORRECT thing to show a browser with no local
      // data. Real records arrive from Supabase a moment later. If you are
      // ever tempted to add a "helpful" demo fallback here again: it cannot
      // tell itself apart from real data once it reaches the database.
      let db       = local?.db || defaultAppState.db;
      let activity = local?.activity?.length ? local.activity : [];
      let settings = localSettings || state.appSettings;
      // Fold in bc_data_wiped-equivalent flag (set by Backup.jsx's
      // handleWipe, immune to the wipe's own key sweep by design) so every
      // module's "no data yet → show demo records" fallback can tell a
      // deliberate wipe apart from a brand new install.
      if (localStorage.getItem(WIPE_FLAG_KEY) === '1' && !settings.dataWiped) {
        settings = { ...settings, dataWiped: true };
      }
      // Migrate from old acctData field names (chartOfAccounts→coa, journalEntries→journals, etc.)
      let acctData = localAcct || {};
      if (acctData.chartOfAccounts && !acctData.coa) {
        acctData = { journals: acctData.journalEntries||[], coa: acctData.chartOfAccounts||[], bankStmt: acctData.bankEntries||[], vatAdj: acctData.vatAdjustments||[], whtEntries: acctData.whtEntries||[], assets: acctData.assets||[] };
      }
      if (!acctData.coa) acctData = { journals:[], coa:[], bankStmt:[], vatAdj:[], whtEntries:[], assets:[] };

      // Initialise localStorage on a first-ever load so subsequent boots have a
      // real (empty) db to read. No seeding — see the note above.
      if (!seeded) {
        try {
          saveDBLocal(db, []);
          // Drop stale module-specific keys left by older versions.
          localStorage.removeItem('slot_proc');
          localStorage.removeItem('slot_pettycash_fund');
          localStorage.setItem('slot_seed_version', SEED_VERSION);
        } catch(e) { console.warn('Local init write failed:', e.message); }
      }

      // REMOVED 2026-07-28 — fabricated activity-log entries.
      //
      // This used to inject ten hard-coded entries ("Invoice SLOT-INV-2026-0003
      // marked as Paid", "PO-2026-0015 approved", named staff, exact naira
      // figures) whenever the activity list was empty. They looked identical to
      // genuine audit entries, were written by real usernames and roles, and
      // synced to Supabase like anything else — an audit trail describing events
      // that never happened. With the database now deliberately empty the list
      // is always empty, so this would have fired on every single load.
      //
      // An empty activity log is correct for a system with no activity yet.

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
      // FIX 2026-07-24: only pull from the legacy company_data blob when the
      // per-record engine is OFF. With it on, usePerRecordSync's own effect
      // loads everything from the per-record tables — running this too meant
      // both engines raced to set state.db from two different sources
      // (whichever finished last won), and the legacy blob doesn't contain
      // anything saved through the new tables. This was silently fighting
      // with the per-record load on every boot.
      //
      // FIX 2026-07-24 (part 2): the line above skips syncCloud() entirely
      // when per-record is on — but SET_CLOUD:true only ever got dispatched
      // *inside* syncCloud(). That made state.cloudReady permanently false
      // once the cutover happened, which made Topbar's SyncBadge fall
      // through to "Local only" forever, even though the per-record engine
      // was saving to Supabase correctly the whole time. This was a real
      // regression from the fix above, not a pre-existing bug — cloud
      // readiness for the per-record engine just means "we have a live
      // Supabase session," which is true by the time we get here (Phase 1
      // already resolved session/db above), so it's safe to mark it ready
      // directly instead of going through the legacy blob round-trip.
      if (!USE_PER_RECORD) {
        syncCloud(dispatch, { db, settings, acctData, activity });
      } else {
        dispatch({ type: 'SET_CLOUD', payload: true });
      }
      } catch (e) {
        console.warn('[SLOT ERP] Boot init failed unexpectedly — showing app with whatever state is available:', e?.message || e);
      } finally {
        // Guaranteed even if something above threw before the normal
        // SET_LOADING dispatch on the happy path — the redundant dispatch
        // on the happy path is harmless (reducer no-ops on the same value).
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }

    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stable page component — must be above ALL conditional returns ───────────
  // useMemo must never be called after an early return (Rules of Hooks).
  // Render-time backstop for the redirect effect above: if page is ever
  // 'dashboard' while the signed-in user isn't allowed to see it (a stale
  // value for one render, a future setPage('dashboard') call site someone
  // adds later, etc.), resolve to their own home module instead of ever
  // mounting the real Dashboard component for them.
  const PageComponent = useMemo(() => {
    if (page === 'dashboard' && currentUser && !canSeeDashboard(currentUser)) {
      const home = computeHomePage(currentUser);
      if (home) return PAGES[home];
      return () => (
        <div style={{ padding:40, textAlign:'center', color:C.textMuted }}>
          No modules are assigned to your account yet — contact your administrator.
        </div>
      );
    }
    return PAGES[page] || (() => <div style={{ padding:40, color:C.textMuted }}>Module not found</div>);
  }, [page, currentUser]);

  // ── Persistence: save to localStorage whenever db or activity changes ─────
  // This is the fix for data wiping on hard refresh (Ctrl+Shift+R).
  // We skip the very first render (loading=true) to avoid overwriting with
  // empty initialState before the boot useEffect has loaded real data.
  //
  // CRITICAL FIX: previously this effect had deps=[state.db, state.activity,
  // loading] only — but the body ALSO read state.appSettings and state.acctData
  // (for the cloud save). The result: a user editing Settings → Save Changes
  // dispatched SET_SETTINGS, but the persistence effect DID NOT FIRE because
  // state.db didn't change — the new settings never reached saveDBCloud. Then
  // the next time state.db DID change, the cloud save used a STALE appSettings
  // closure, silently reverting the user's settings change in the cloud copy.
  // Now appSettings and acctData are in deps so every change fires the save.
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
    // FIX 2026-07-24: gated on !USE_PER_RECORD — this used to run
    // unconditionally, meaning the legacy whole-document save (and its own
    // "Your last change is saved on this device, but not yet in the cloud"
    // conflict message) kept firing after the per-record cutover too, on
    // every state change from every user. With the per-record engine on,
    // saves already go through saveRecord()/saveAppSettings() per-record —
    // this legacy path is redundant and is exactly what those messages were
    // still coming from.
    if (state.cloudReady && !USE_PER_RECORD) {
      saveDBCloud(state.db, state.activity, state.appSettings, state.acctData)
        .then(result => {
          if (result?.conflict && !conflictNoticeShown.current) {
            // Someone else saved since we last loaded — we did NOT overwrite
            // them, but that also means THIS client's most recent edit is
            // currently only saved locally, not in the cloud. Say so plainly
            // rather than staying silent, which was the original bug.
            conflictNoticeShown.current = true;
            showToast('Your last change is saved on this device, but not yet in the cloud — someone else updated this data first. Reload to get the latest version, then re-apply your change.', 'error');
          }
          if (result?.blockedWipe && !wipeNoticeShown.current) {
            // See findSuspiciousWipes() in supabase/sync.js — a save that
            // would have zeroed out data this client itself saw populated
            // was refused before it ever reached Supabase. Nothing was
            // lost, but this client's own copy of that data is wrong, so
            // don't let it keep trying (and don't let it touch that data)
            // until a reload gives it the real thing back.
            wipeNoticeShown.current = true;
            const sections = (result.wipes || []).map(w => w.key).join(', ') || 'some data';
            showToast(`⚠ Stopped a save that would have erased ${sections} — nothing was lost. Please reload this page before making further changes.`, 'error');
            console.error('[SLOT ERP] Blocked wipe — affected keys:', result.wipes);
          }
        })
        .catch(e => console.warn('[SLOT ERP] Auto cloud save failed:', e.message));
    }
  }, [state.db, state.activity, state.appSettings, state.acctData, loading, state.cloudReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist accounting data whenever it changes ───────────────────────────
  useEffect(() => {
    if (loading) return;
    try { saveAccountingLocal(state.acctData); } catch {}
  }, [state.acctData, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Takes priority over the loading/currentUser checks below: a valid
  // recovery link makes supabase-js auto-establish a session (see
  // parseRecoveryHash's comment above), which would otherwise fall through
  // to the normal signed-in Shell with no password ever having been reset.
  if (recovery) return (
    <LoginScreen
      initialMode={recovery.mode === 'error' ? 'reset-error' : 'reset'}
      recoveryInfo={recovery}
      onLogin={user => { dispatch({ type:'SET_USER', payload:user }); }}
    />
  );

  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:C.bg, flexDirection:'column', gap:14 }}>
      <div style={{ fontSize:22, fontWeight:800, color:C.green }}>SLOT Engineering ERP</div>
      <div style={{ fontSize:12, color:C.textMuted }}>Starting…</div>
    </div>
  );

  if (!currentUser) return (
    <LoginScreen onLogin={user => { dispatch({ type:'SET_USER', payload:user }); }} />
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
        {unsaved > 0 && (
          <div style={{
            flexShrink:0, background:'#C0392B', color:'#fff',
            padding:'9px 16px', fontSize:13, fontWeight:600,
            display:'flex', alignItems:'center', gap:10, lineHeight:1.4,
          }}>
            <span style={{ fontSize:16 }}>⚠</span>
            <span>
              {unsaved} change{unsaved > 1 ? 's have' : ' has'} NOT saved to the cloud and exist{unsaved > 1 ? '' : 's'} only on this computer.
              {' '}Do not close this page. Reconnect, then open the record and save it again.
            </span>
          </div>
        )}
        <ErrorBoundary label="the top bar">
          <Topbar
            page={page}
            online={online}
            pendingSync={pendingSync}
            onMenuClick={() => setMobileOpen(true)}
            onNav={setPage}
            onLogout={async () => { await signOutOfSupabase(); dispatch({ type:'SET_USER', payload:null }); setPage('dashboard'); }}
          />
        </ErrorBoundary>
        <div ref={scrollRef} style={{ flex:1, overflowY:'auto', padding:'16px 16px 24px', background:C.bg }}>
          <ErrorBoundary label={`the ${page} module`} onGoHome={() => setPage('dashboard')} key={page}>
            <Suspense fallback={
              <div style={{ padding:40, textAlign:'center', color:C.textMuted, fontSize:13 }}>
                <div style={{ display:'inline-block', width:24, height:24, border:'3px solid '+C.border, borderTopColor:C.green, borderRadius:'50%', animation:'slot-spin 0.8s linear infinite' }} />
                <div style={{ marginTop:10 }}>Loading module…</div>
              </div>
            }>
              <PageComponent onNav={setPage} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
      <ErrorBoundary label="the security nudge">
        <MfaNudge />
      </ErrorBoundary>
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
