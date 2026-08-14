import { useState, useMemo, useRef, useEffect } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useApp } from '../../context/AppContext';
import { Btn, ThemeToggle } from '../ui';
import { SLOT_LOGO_SRC } from '../../utils/logo';
import { LogOut, Wifi, WifiOff, CloudOff, Cloud, Menu, Search } from 'lucide-react';
import DocScanner from '../ui/DocScanner';

const PAGE_TITLES = {
  dashboard:'Dashboard', nlng:'Contract Staff (NLNG)', slot:'Company Staff',
  procurement:'Procurement', inventory:'Inventory', vehicles:'Fleet & Vehicles',
  terminal:'Terminal Operations',
  invoices:'Invoices', pettycash:'Petty Cash', request:'Requests',
  fixedassets:'Fixed Asset Register', wht:'Withholding Tax',
  accounting:'Accounting', approvals:'Approval Queue', analytics:'Analytics',
  users:'User Management', settings:'Settings', backup:'Backup & Restore',
};
const PAGE_ICONS = {
  dashboard:'📊', nlng:'👷', slot:'👤', procurement:'🛒', inventory:'📦',
  vehicles:'🚗', terminal:'🏭',
  invoices:'🧾', pettycash:'💵', request:'📋',
  fixedassets:'🏗', wht:'🏛', accounting:'📒',
  approvals:'✅', analytics:'📈', users:'👥', settings:'⚙️', backup:'💾',
};

export default function Topbar({ page, onLogout, online = true, pendingSync = 0, onMenuClick, onNav }) {
  const { C } = useTheme();
  const { state, dispatch } = useApp();
  const { currentUser, cloudReady, db } = state;
  const [searchOpen, setSearchOpen]   = useState(false);
  const [searchQ, setSearchQ]         = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const searchRef = useRef(null);

  // Avatar now derives from role, not personal name — see user card below

  function handleLogout() { onLogout(); }

  // ── Global search across all modules ──────────────────────────────────────
  const searchResults = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (q.length < 2) return [];
    const results = [];

    const push = (mod, label, icon, record, fields) => {
      const hit = fields.some(f => String(record[f] || '').toLowerCase().includes(q));
      if (hit) results.push({ mod, label, icon, record, preview: fields.map(f => record[f]).filter(Boolean).join(' · ').slice(0, 80) });
    };

    (db.invoices    || []).forEach(r => push('invoices',    r.invoiceNo || 'Invoice',       '🧾', r, ['invoiceNo','client','projectRef','notes']));
    (db.procurement?.pos || []).forEach(r => push('procurement', r.poNo || 'PO',             '🛒', r, ['poNo','supplier','description']));
    (db.request     || []).forEach(r => push('request',     r.requestNo || 'Request',       '📋', r, ['requestNo','subject','requestedBy','description']));
    (db.nlng        || []).forEach(r => push('nlng',        r.fullName || 'Staff',          '👷', r, ['fullName','refId','department','email']));
    (db.slot        || []).forEach(r => push('slot',        r.fullName || 'Staff',          '👤', r, ['fullName','refId','department','email']));
    (db.pettycash   || []).forEach(r => push('pettycash',   r.voucherNo || 'Petty Cash',    '💵', r, ['voucherNo','purpose','payee','category']));
    (db.fixedassets || []).forEach(r => push('fixedassets', r.assetTag || 'Asset',          '🏗', r, ['assetTag','assetName','location','serialNo']));
    (db.wht         || []).forEach(r => push('wht',         r.refNo || 'WHT',               '🏛', r, ['refNo','vendor','invoiceRef']));
    (db.inventory   || []).forEach(r => push('inventory',   r.regNumber || r.name || 'Item','📦', r, ['name','regNumber','make','position']));
    (db.vehicles    || []).forEach(r => push('vehicles',    r.vehicleNumber || 'Vehicle',   '🚗', r, ['vehicleNumber','make','unitServing']));

    return results.slice(0, 12);
  }, [searchQ, db]);

  // Close on outside click
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) { setSearchOpen(false); setSearchQ(''); } };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchOpen]);

  // Keyboard shortcut: Ctrl+K or /
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA')) {
        e.preventDefault(); setSearchOpen(true); setTimeout(() => document.getElementById('global-search-input')?.focus(), 50);
      }
      if (e.key === 'Escape') { setSearchOpen(false); setSearchQ(''); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const GlobalSearch = () => (
    <div ref={searchRef} style={{ position:'relative' }}>
      <button
        onClick={() => { setSearchOpen(s => !s); setTimeout(() => document.getElementById('global-search-input')?.focus(), 50); }}
        title="Global search (Ctrl+K)"
        style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgAlt, color:C.textMid, cursor:'pointer', fontSize:12 }}
      >
        <Search size={13} />
        <span className="hide-mobile">Search</span>
        <span className="hide-mobile" style={{ fontSize:10, color:C.textLight, background:C.bgCard, border:'1px solid '+C.border, borderRadius:4, padding:'1px 4px', fontFamily:'monospace' }}>⌃K</span>
      </button>

      {searchOpen && (
        <div style={{ position:'fixed', top:0, left:0, right:0, bottom:0, zIndex:9998, background:'rgba(0,0,0,0.4)', backdropFilter:'blur(2px)', display:'flex', alignItems:'flex-start', justifyContent:'center', paddingTop:80, paddingLeft:16, paddingRight:16 }}
          onClick={() => { setSearchOpen(false); setSearchQ(''); }}>
          <div onClick={e => e.stopPropagation()} style={{ width:'100%', maxWidth:620, background:C.bgCard, border:'1px solid '+C.border, borderRadius:14, boxShadow:C.shadowModal, overflow:'hidden' }}>
            {/* Search input */}
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderBottom:'1px solid '+C.borderLight }}>
              <Search size={16} color={C.textMuted} />
              <input
                id="global-search-input"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                placeholder="Search across all modules — staff, invoices, POs, requests…"
                style={{ flex:1, background:'none', border:'none', outline:'none', fontSize:14, color:C.text, fontFamily:'inherit' }}
                autoFocus
              />
              <span style={{ fontSize:10, color:C.textLight }}>ESC to close</span>
            </div>

            {/* Results */}
            <div style={{ maxHeight:400, overflowY:'auto' }}>
              {searchQ.length < 2 && (
                <div style={{ padding:'24px 16px', textAlign:'center', color:C.textMuted, fontSize:13 }}>Type at least 2 characters to search…</div>
              )}
              {searchQ.length >= 2 && searchResults.length === 0 && (
                <div style={{ padding:'24px 16px', textAlign:'center', color:C.textMuted, fontSize:13 }}>No results for "{searchQ}"</div>
              )}
              {searchResults.map((r, i) => (
                <div key={i}
                  onClick={() => { if (onNav) onNav(r.mod); setSearchOpen(false); setSearchQ(''); }}
                  style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', cursor:'pointer', borderBottom:'1px solid '+C.borderLight, background:'transparent', transition:'background .1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = C.greenPale}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontSize:20, flexShrink:0 }}>{r.icon}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:C.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.label}</div>
                    <div style={{ fontSize:11, color:C.textMuted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.preview}</div>
                  </div>
                  <span style={{ fontSize:10, color:C.textLight, background:C.bgAlt, borderRadius:10, padding:'2px 8px', flexShrink:0, textTransform:'capitalize' }}>{r.mod}</span>
                </div>
              ))}
            </div>

            {searchResults.length > 0 && (
              <div style={{ padding:'8px 16px', borderTop:'1px solid '+C.borderLight, fontSize:11, color:C.textMuted }}>
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} — click any to navigate to that module
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  const SyncBadge = () => {
    if (!online) return (
      <div title="Offline — changes saved locally" style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 9px', borderRadius:20, background:'rgba(240,80,80,.12)', border:'1px solid rgba(240,80,80,.3)', fontSize:11, fontWeight:600, color:C.danger }}>
        <WifiOff size={11} /> <span className="hide-xs">Offline</span>
      </div>
    );
    if (pendingSync > 0) return (
      <div title={`${pendingSync} change(s) pending sync`} style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 9px', borderRadius:20, background:'rgba(240,160,32,.12)', border:'1px solid rgba(240,160,32,.3)', fontSize:11, fontWeight:600, color:C.warning }}>
        <CloudOff size={11} /> <span className="hide-xs">Syncing…</span>
      </div>
    );
    if (cloudReady) return (
      <div title="Live — synced with Supabase" style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 9px', borderRadius:20, background:'rgba(52,196,114,.1)', border:'1px solid rgba(52,196,114,.25)', fontSize:11, fontWeight:600, color:C.success }}>
        <Cloud size={11} /> <span className="hide-xs">Live</span>
      </div>
    );
    return (
      <div title="Local only" style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 9px', borderRadius:20, background:C.bgAlt, border:'1px solid '+C.border, fontSize:11, color:C.textMuted }}>
        <Wifi size={11} /> <span className="hide-xs">Local</span>
      </div>
    );
  };

  return (
    <>
      <style>{`
        @media (max-width: 767px) { .topbar-hamburger { display: flex !important; } .hide-mobile { display: none !important; } }
        @media (min-width: 768px) { .topbar-hamburger { display: none !important; } }
        @media (max-width: 480px) { .hide-xs { display: none !important; } .topbar-title { font-size: 14px !important; } }
      `}</style>

      <div style={{
        height:52, background:C.bgCard, borderBottom:'1px solid '+C.border,
        boxShadow:C.shadowTopbar, padding:'0 16px',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        flexShrink:0, zIndex:50,
        gap:8,
      }}>
        {/* Left — hamburger (mobile) + module title */}
        <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
          {/* Hamburger — mobile only */}
          <button
            className="topbar-hamburger"
            onClick={onMenuClick}
            style={{
              display:'none', alignItems:'center', justifyContent:'center',
              background:'none', border:'none', cursor:'pointer',
              color:C.text, padding:4, borderRadius:6, flexShrink:0,
              WebkitTapHighlightColor:'transparent',
            }}
          >
            <Menu size={22} />
          </button>

          {/* Logo — desktop only */}
          <div className="hide-mobile" style={{ background:C.greenPale, borderRadius:6, padding:'3px 5px', border:'1px solid '+C.borderLight, flexShrink:0 }}>
            <img src={SLOT_LOGO_SRC} alt="SLOT" style={{ height:22, width:'auto', display:'block' }} />
          </div>

          <span style={{ fontSize:16, flexShrink:0 }}>{PAGE_ICONS[page] || '📄'}</span>
          <span className="topbar-title" style={{ fontSize:15, fontWeight:700, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {PAGE_TITLES[page] || page}
          </span>
        </div>

        {/* Right — search, sync status, date, theme, user, logout */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <GlobalSearch />

          {/* ── Global Document Scanner button ─────────────── */}
          <button
            onClick={() => setScannerOpen(true)}
            title="Scan or upload a document"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'transparent', border: `1px solid ${C.border}`,
              borderRadius: 7, padding: '5px 10px', cursor: 'pointer',
              fontSize: 12, color: C.textMid, fontWeight: 500,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#9B59B6'; e.currentTarget.style.color = '#9B59B6'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMid; }}
          >
            📷
            <span className="hide-mobile">Scan Doc</span>
          </button>

          {scannerOpen && (
            <DocScanner
              onClose={() => setScannerOpen(false)}
              onSave={doc => {
                dispatch({ type: 'ADD_SCAN_DOC', payload: doc });
                setScannerOpen(false);
              }}
            />
          )}

          <SyncBadge />

          <span className="hide-mobile" style={{ fontSize:11, color:C.textMuted, whiteSpace:'nowrap' }}>
            {new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}
          </span>

          <ThemeToggle />

          {/* User avatar — shows role, not personal name, to avoid exposing identity in shared/demo sessions */}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{
              width:30, height:30, borderRadius:'50%', flexShrink:0,
              background:'linear-gradient(135deg, #1A5C2A, #2E7D40)',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:11, fontWeight:800, color:'#FFFFFF',
            }}>{(currentUser?.role || 'U').slice(0,2).toUpperCase()}</div>
            <div className="hide-mobile">
              <div style={{ fontSize:12, fontWeight:600, color:C.text, lineHeight:1.2, textTransform:'capitalize' }}>{currentUser?.role || 'User'}</div>
              <div style={{ fontSize:9.5, color:C.textMuted }}>{currentUser?.username || 'Signed in'}</div>
            </div>
          </div>

          <Btn variant="ghost" size="sm" onClick={handleLogout} style={{ gap:4, color:C.danger, borderColor:C.danger+'40', padding:'5px 8px' }}>
            <LogOut size={13} />
            <span className="hide-mobile">Sign Out</span>
          </Btn>
        </div>
      </div>
    </>
  );
}
