// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Sidebar v3.1
// Desktop: fixed, collapsible (252px ↔ 64px)
// Mobile:  hidden by default, slides in as full overlay
// Sections: collapsible accordion groups with animated dropdown
//
// v3.1: SectionHeader/NavItem/Collapsible/NavContent used to be defined
// *inside* the Sidebar function body. That meant every re-render of Sidebar
// (e.g. clicking a section header to expand/collapse it) created brand-new
// function references for all four, so React treated them as different
// component types and fully unmounted+remounted that whole subtree —
// including the scrollable nav <div>. A remounted DOM node always starts at
// scrollTop 0, which is exactly the "expand a section, sidebar jumps back to
// top, have to scroll down again" bug. Moving them to module scope keeps
// their identity stable across renders, so React just updates the existing
// DOM instead of recreating it, and scroll position survives naturally.
// ══════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { SLOT_LOGO_SRC } from '../../utils/logo';

// ── Nav items ─────────────────────────────────────────────────────────────────
const NAV = [
  // MAIN
  { id: 'dashboard',    label: 'Dashboard',           icon: '📊', section: 'MAIN' },
  // HR
  { id: 'nlng',         label: 'Contract Staff',      icon: '👷', section: 'HR' },
  { id: 'slot',         label: 'Company Staff',       icon: '👤', section: 'HR' },
  // OPERATIONS
  { id: 'procurement',  label: 'Procurement',         icon: '🛒', section: 'OPERATIONS' },
  { id: 'inventory',    label: 'Inventory',           icon: '📦', section: 'OPERATIONS' },
  { id: 'vehicles',     label: 'Fleet / Vehicles',    icon: '🚗', section: 'OPERATIONS' },
  { id: 'terminal',     label: 'Terminal Operations', icon: '🏭', section: 'OPERATIONS' },
  { id: 'request',      label: 'Requests',            icon: '📋', section: 'OPERATIONS' },
  // FINANCE
  { id: 'accounting',   label: 'Accounting',          icon: '📒', section: 'FINANCE' },
  { id: 'ap',           label: 'Accounts Payable',    icon: '📤', section: 'FINANCE' },
  { id: 'salesorders',  label: 'Sales Orders',        icon: '📋', section: 'FINANCE' },
  { id: 'invoices',     label: 'Accounts Receivable', icon: '📥', section: 'FINANCE' },
  { id: 'projectpl',    label: 'Project P&L',         icon: '📐', section: 'FINANCE' },
  { id: 'pettycash',    label: 'Petty Cash',          icon: '💵', section: 'FINANCE' },
  { id: 'fixedassets',  label: 'Fixed Assets',        icon: '🏗️',  section: 'FINANCE' },
  { id: 'approvals',    label: 'Approvals',           icon: '✅', section: 'FINANCE', badge: true },
  // REPORTS
  { id: 'analytics',    label: 'Analytics',           icon: '📈', section: 'REPORTS' },
  { id: 'sagereports',  label: 'Sage Reports',        icon: '📑', section: 'REPORTS' },
  { id: 'sagereports2', label: 'Sage Features II',    icon: '📚', section: 'REPORTS' },
  { id: 'excel',        label: 'Excel Import/Export', icon: '📊', section: 'REPORTS', adminOnly: true },
  // SYSTEM
  { id: 'users',        label: 'Users',               icon: '👥', section: 'SYSTEM', adminOnly: true },
  { id: 'settings',     label: 'Settings',            icon: '⚙️',  section: 'SYSTEM', adminOnly: true },
  { id: 'moduleeditor', label: 'Module Editor',       icon: '🔧', section: 'SYSTEM', adminOnly: true },
  { id: 'backup',       label: 'Backup',              icon: '💾', section: 'SYSTEM', adminOnly: true },
];

const SECTIONS = ['MAIN', 'HR', 'OPERATIONS', 'FINANCE', 'REPORTS', 'SYSTEM'];

// Injected by vite.config.js `define` at build time. Guarded so dev server,
// vitest, and any non-Vite consumer don't crash on an undefined global.
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';

const SECTION_META = {
  MAIN:       { label: 'Main',       icon: '🏠', accent: '#4CAF64', bg: 'rgba(76,175,100,0.12)' },
  HR:         { label: 'HR',         icon: '👥', accent: '#9B88E8', bg: 'rgba(155,136,232,0.12)' },
  OPERATIONS: { label: 'Operations', icon: '⚙️',  accent: '#E8A830', bg: 'rgba(232,168,48,0.12)'  },
  FINANCE:    { label: 'Finance',    icon: '💰', accent: '#3BB87A', bg: 'rgba(59,184,122,0.12)'  },
  REPORTS:    { label: 'Reports',    icon: '📊', accent: '#4A90D9', bg: 'rgba(74,144,217,0.12)'  },
  SYSTEM:     { label: 'System',     icon: '🔧', accent: '#A0A0B0', bg: 'rgba(160,160,176,0.10)' },
};

// ── Section header (module scope — stable identity across renders) ─────────
function SectionHeader({ section, meta, isOpen, itemCount, collapsed, onToggle }) {
  const isMain = section === 'MAIN';

  if (collapsed) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'10px 0 4px', gap:4 }}>
        <span style={{ fontSize:16 }}>{meta.icon}</span>
        <div style={{ width:20, height:2, borderRadius:1, background: meta.accent, opacity:0.6 }} />
      </div>
    );
  }

  return (
    <div
      onClick={() => !isMain && onToggle(section)}
      style={{
        display:'flex', alignItems:'center', gap:9,
        padding:'12px 14px 8px',
        cursor: isMain ? 'default' : 'pointer',
        userSelect:'none',
        WebkitTapHighlightColor:'transparent',
      }}
    >
      <div style={{ width:3, height:18, borderRadius:2, background: meta.accent, flexShrink:0 }} />
      <span style={{ fontSize:15, flexShrink:0 }}>{meta.icon}</span>
      <span style={{
        flex:1, fontSize:12, fontWeight:700, color: meta.accent,
        letterSpacing:'1px', textTransform:'uppercase',
      }}>
        {meta.label}
      </span>
      {!isMain && !isOpen && (
        <span style={{
          background: meta.bg, color: meta.accent, fontSize:10, fontWeight:700,
          borderRadius:10, padding:'1px 7px', border:`1px solid ${meta.accent}40`,
        }}>
          {itemCount}
        </span>
      )}
      {!isMain && (
        <span style={{
          fontSize:11, color: meta.accent, opacity:0.8,
          transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition:'transform 0.2s ease', flexShrink:0,
        }}>
          ▾
        </span>
      )}
    </div>
  );
}

// ── Nav item (module scope) ─────────────────────────────────────────────────
function NavItem({ item, meta, collapsed, isActive, badge, onClick }) {
  return (
    <div
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      style={{
        display:'flex', alignItems:'center', gap: collapsed ? 0 : 11,
        padding: collapsed ? '11px 0' : '10px 14px 10px 28px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        cursor:'pointer', position:'relative',
        borderLeft: isActive ? `3px solid ${meta.accent}` : '3px solid transparent',
        background: isActive ? meta.bg : 'transparent',
        color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.62)',
        fontSize:13.5, fontWeight: isActive ? 600 : 400,
        marginBottom:1, transition:'background .15s, color .15s',
        WebkitTapHighlightColor:'transparent',
        borderRadius: collapsed ? 0 : '0 8px 8px 0',
        marginRight: collapsed ? 0 : 8,
      }}
      onMouseEnter={e => {
        if (!isActive) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
          e.currentTarget.style.color = '#fff';
        }
      }}
      onMouseLeave={e => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'rgba(255,255,255,0.62)';
        }
      }}
    >
      <span style={{ fontSize:18, width:22, textAlign:'center', flexShrink:0 }}>
        {item.icon}
      </span>
      {!collapsed && (
        <span style={{ flex:1, lineHeight:1.3 }}>{item.label}</span>
      )}
      {!collapsed && badge > 0 && (
        <span style={{
          background:'#E8A830', color:'#fff', borderRadius:10, padding:'1px 7px',
          fontSize:10, fontWeight:800, flexShrink:0,
        }}>
          {badge}
        </span>
      )}
      {collapsed && badge > 0 && (
        <span style={{
          position:'absolute', top:8, right:10,
          width:8, height:8, borderRadius:'50%', background:'#E8A830',
        }} />
      )}
    </div>
  );
}

// ── Animated collapsible wrapper (module scope) ─────────────────────────────
function Collapsible({ isOpen, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    if (isOpen) {
      ref.current.style.maxHeight = ref.current.scrollHeight + 'px';
      ref.current.style.opacity   = '1';
    } else {
      ref.current.style.maxHeight = '0px';
      ref.current.style.opacity   = '0.3';
    }
  }, [isOpen]);

  return (
    <div
      ref={ref}
      style={{
        maxHeight:'500px', // initial open state
        overflow:'hidden',
        opacity:1,
        transition:'max-height 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease',
      }}
    >
      {children}
    </div>
  );
}

// ── Main nav content (module scope) ─────────────────────────────────────────
function NavContent({
  scrollRef, collapsed, currentUser, offlineMode, cloudReady,
  openSections, toggleSection, active, pendingApprovals, isVisible, handleNav, onCollapse,
}) {
  return (
    <>
      {/* Logo */}
      <div style={{
        padding:'14px 14px',
        borderBottom:'1px solid rgba(255,255,255,0.10)',
        background:'rgba(0,0,0,0.2)',
        flexShrink:0,
      }}>
        {collapsed ? (
          <div style={{ display:'flex', justifyContent:'center' }}>
            <div style={{ background:'#fff', borderRadius:6, padding:'4px 5px' }}>
              <img src={SLOT_LOGO_SRC} alt="SLOT" style={{ height:28, width:'auto', display:'block' }} />
            </div>
          </div>
        ) : (
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ background:'#fff', borderRadius:8, padding:'5px 6px', flexShrink:0, boxShadow:'0 2px 8px rgba(0,0,0,.3)' }}>
              <img src={SLOT_LOGO_SRC} alt="SLOT Engineering" style={{ height:34, width:'auto', display:'block' }} />
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:800, color:'#FFFFFF', lineHeight:1.3 }}>SLOT Engineering</div>
              <div style={{ fontSize:9, color:'rgba(255,255,255,0.5)', marginTop:2, letterSpacing:'0.5px' }}>NIGERIA LIMITED · ERP v3.0</div>
              <div title="Build currently running in your browser — if this doesn't change after a deploy, you're on a cached bundle" style={{ fontSize:8, color:'rgba(255,255,255,0.32)', marginTop:1, fontFamily:'monospace' }}>{BUILD_ID}</div>
            </div>
          </div>
        )}
      </div>

      {/* Sync status */}
      {!collapsed && (
        <div style={{
          padding:'6px 16px',
          display:'flex', alignItems:'center', gap:7,
          fontSize:11, color:'rgba(255,255,255,0.45)',
          borderBottom:'1px solid rgba(255,255,255,0.06)',
          flexShrink:0,
        }}>
          <span style={{
            width:7, height:7, borderRadius:'50%',
            background: offlineMode ? '#E05040' : cloudReady ? '#4CAF64' : '#C97A0A',
            display:'inline-block', flexShrink:0,
          }} />
          {offlineMode ? 'Offline Mode' : cloudReady ? 'Cloud Synced' : 'Connecting…'}
        </div>
      )}

      {/* Nav sections */}
      <div ref={scrollRef} style={{ flex:1, paddingBottom:8, overflowY:'auto', overflowX:'hidden' }}>
        {SECTIONS.map(section => {
          const items = NAV.filter(n => n.section === section && isVisible(n));
          if (!items.length) return null;
          const meta   = SECTION_META[section];
          const isOpen = openSections[section] !== false; // default true
          const isMain = section === 'MAIN';

          return (
            <div key={section} style={{ marginTop: section === 'MAIN' ? 6 : 2 }}>
              <SectionHeader
                section={section}
                meta={meta}
                isOpen={isOpen}
                itemCount={items.length}
                collapsed={collapsed}
                onToggle={toggleSection}
              />
              {isMain ? (
                items.map(item => (
                  <NavItem
                    key={item.id}
                    item={item}
                    meta={meta}
                    collapsed={collapsed}
                    isActive={active === item.id}
                    badge={item.badge && pendingApprovals > 0 ? pendingApprovals : null}
                    onClick={() => handleNav(item.id)}
                  />
                ))
              ) : (
                <Collapsible isOpen={!collapsed && isOpen}>
                  {items.map(item => (
                    <NavItem
                      key={item.id}
                      item={item}
                      meta={meta}
                      collapsed={collapsed}
                      isActive={active === item.id}
                      badge={item.badge && pendingApprovals > 0 ? pendingApprovals : null}
                      onClick={() => handleNav(item.id)}
                    />
                  ))}
                </Collapsible>
              )}
              {!collapsed && (
                <div style={{
                  margin:'6px 14px 2px',
                  height:1,
                  background:'rgba(255,255,255,0.06)',
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Collapse toggle */}
      <div
        onClick={() => onCollapse(d => !d)}
        style={{
          padding:'12px 16px',
          borderTop:'1px solid rgba(255,255,255,0.08)',
          background:'rgba(255,255,255,0.04)',
          cursor:'pointer',
          color:'rgba(255,255,255,0.45)',
          fontSize:12,
          display:'flex', alignItems:'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap:9, flexShrink:0,
          WebkitTapHighlightColor:'transparent',
          transition:'background .15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.08)'}
        onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.04)'}
      >
        <span style={{ fontSize:16 }}>{collapsed ? '→' : '←'}</span>
        {!collapsed && <span>Collapse sidebar</span>}
      </div>

      {/* User footer */}
      {!collapsed && currentUser && (
        <div style={{
          padding:'12px 16px',
          borderTop:'1px solid rgba(255,255,255,0.08)',
          flexShrink:0,
          display:'flex', alignItems:'center', gap:9,
        }}>
          <div style={{
            width:30, height:30, borderRadius:'50%',
            background: SECTION_META.HR.bg,
            border:`1px solid ${SECTION_META.HR.accent}50`,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:12, fontWeight:700, color: SECTION_META.HR.accent,
            flexShrink:0,
          }}>
            {(currentUser.name || 'U').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()}
          </div>
          <div style={{ overflow:'hidden' }}>
            <div style={{ fontSize:12.5, fontWeight:600, color:'#FFFFFF', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
              {currentUser.name}
            </div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.4)', textTransform:'capitalize', marginTop:1 }}>
              {currentUser.role}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Sidebar (top level) ──────────────────────────────────────────────────────
export default function Sidebar({ active, onNav, collapsed, onCollapse, mobileOpen, onMobileClose }) {
  const { state } = useApp();
  const { C } = useTheme();
  const { currentUser, db, cloudReady, offlineMode } = state;
  const role         = currentUser?.role || 'viewer';
  const isAdmin      = role === 'admin';
  const isAccountant = role === 'accountant';

  const [openSections, setOpenSections] = useState(
    () => Object.fromEntries(SECTIONS.map(s => [s, s === 'MAIN']))
  );

  function toggleSection(section) {
    if (section === 'MAIN') return;
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  }

  const navScrollRef = useRef(null);
  const savedScrollY = useRef(0);

  function handleNav(id) {
    savedScrollY.current = navScrollRef.current?.scrollTop || 0;
    onNav(id);
    onMobileClose();
  }

  useEffect(() => {
    const activeItem = NAV.find(n => n.id === active);
    let didExpand = false;
    if (activeItem && openSections[activeItem.section] === false) {
      setOpenSections(prev => ({ ...prev, [activeItem.section]: true }));
      didExpand = true;
    }
    const restore = () => {
      if (navScrollRef.current) navScrollRef.current.scrollTop = savedScrollY.current;
    };
    if (didExpand) {
      requestAnimationFrame(() => requestAnimationFrame(restore));
    } else {
      requestAnimationFrame(restore);
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && mobileOpen) onMobileClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const pendingApprovals = [
    ...(db?.invoices    || []).filter(i => !i.approvedBy && (Number(i.amount)||Number(i.total)||0) >= 500000),
    ...(db?.pettycash   || []).filter(p => !p.approvedBy && (Number(p.amount)||0) >= 100000),
    ...(db?.procurement?.pos || []).filter(p => p.status === 'Pending Approval'),
    ...(db?.request     || []).filter(r => r.status === 'Pending'),
  ].length;

  function isVisible(item) {
    if (item.adminOnly && !isAdmin) return false;
    switch (item.section) {
      case 'MAIN':       return true;
      case 'HR':         return isAdmin || (currentUser?.modules || []).includes(item.id);
      case 'OPERATIONS': return isAdmin || (currentUser?.modules || []).includes(item.id);
      case 'FINANCE':
        if (item.id === 'accounting') return isAdmin || isAccountant;
        if (item.id === 'approvals')  return isAdmin || role === 'manager' || isAccountant;
        if (item.id === 'invoices')   return isAdmin || isAccountant || (currentUser?.modules || []).includes('invoices');
        if (item.id === 'salesorders')return isAdmin || isAccountant || (currentUser?.modules || []).includes('salesorders');
        if (item.id === 'ap')         return isAdmin || isAccountant || (currentUser?.modules || []).includes('ap');
        if (item.id === 'projectpl')  return isAdmin || isAccountant || role === 'manager';
        if (item.id === 'pettycash')  return isAdmin || isAccountant || (currentUser?.modules || []).includes('pettycash');
        return isAdmin || isAccountant;
      case 'REPORTS':
        return item.id === 'analytics' ? (isAdmin || isAccountant) : isAdmin;
      case 'SYSTEM':     return isAdmin;
      default:           return isAdmin;
    }
  }

  const W = collapsed ? 64 : 252;

  const navContentProps = {
    collapsed, currentUser, offlineMode, cloudReady,
    openSections, toggleSection, active, pendingApprovals, isVisible, handleNav, onCollapse,
  };

  return (
    <>
      <nav
        className="desktop-sidebar"
        style={{
          position:'fixed', left:0, top:0, bottom:0, width:W,
          background:C.sidebarBg, boxShadow:C.shadowSidebar,
          display:'flex', flexDirection:'column', zIndex:100,
          overflowY:'hidden', overflowX:'hidden',
          transition:'width 0.22s ease',
        }}
      >
        <NavContent scrollRef={navScrollRef} {...navContentProps} />
      </nav>

      {mobileOpen && (
        <div
          onClick={onMobileClose}
          style={{
            position:'fixed', inset:0, zIndex:200,
            background:'rgba(0,0,0,0.6)',
            backdropFilter:'blur(2px)',
          }}
        />
      )}

      <nav
        className="mobile-sidebar"
        style={{
          position:'fixed', left:0, top:0, bottom:0, width:280,
          background:C.sidebarBg,
          display:'flex', flexDirection:'column', zIndex:201,
          overflowY:'hidden', overflowX:'hidden',
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition:'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: mobileOpen ? '4px 0 24px rgba(0,0,0,0.5)' : 'none',
        }}
      >
        <button
          onClick={onMobileClose}
          style={{
            position:'absolute', top:10, right:10, zIndex:1,
            background:'rgba(255,255,255,0.15)', border:'none',
            borderRadius:'50%', width:30, height:30,
            color:'#fff', fontSize:16, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            WebkitTapHighlightColor:'transparent',
          }}
        >✕</button>
        <NavContent {...navContentProps} />
      </nav>

      <style>{`
        @media (max-width: 767px) { .desktop-sidebar { display: none !important; } }
        @media (min-width: 768px) { .mobile-sidebar  { display: none !important; } }
      `}</style>
    </>
  );
}
