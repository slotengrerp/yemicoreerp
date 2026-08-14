// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Activity Log Module v1.0
// Full audit trail viewer: filter by module · action · user · date range
// Shows before/after diffs · Export to CSV
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo, useEffect } from 'react';
import { loadActivity } from '../../supabase/syncPerRecord';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { formatDateTime } from '../../utils/helpers';

const ACTION_COLORS = {
  create:  { bg:'rgba(26,122,74,.12)',   c:'#1A7A4A', label:'Created'  },
  edit:    { bg:'rgba(26,92,138,.12)',   c:'#1A5C8A', label:'Edited'   },
  delete:  { bg:'rgba(192,57,43,.12)',   c:'#C0392B', label:'Deleted'  },
  approve: { bg:'rgba(26,122,74,.12)',   c:'#1A7A4A', label:'Approved' },
  info:    { bg:'rgba(107,114,128,.12)', c:'#6B7280', label:'Info'     },
  login:   { bg:'rgba(142,68,173,.12)', c:'#8E44AD', label:'Login'    },
};

const MODULE_LABELS = {
  nlng:'Contract Staff', slot:'Company Staff', procurement:'Procurement',
  invoices:'Invoices', pettycash:'Petty Cash', request:'Requests',
  fixedassets:'Fixed Assets', wht:'WHT',
  accounting:'Accounting', approvals:'Approvals', users:'Users',
  settings:'Settings', backup:'Backup',
};

function ActionBadge({ action }) {
  const { C } = useTheme();
  const cfg = ACTION_COLORS[action] || ACTION_COLORS.info;
  return (
    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:20, fontSize:10.5, fontWeight:600, color:cfg.c, background:cfg.bg, border:`1px solid ${cfg.c}30`, textTransform:'capitalize' }}>
      {cfg.label}
    </span>
  );
}

function DiffViewer({ changes }) {
  const { C } = useTheme();
  if (!changes || changes.length === 0) return <div style={{ fontSize:11, color:C.textMuted }}>No field changes recorded</div>;
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
      {changes.map((ch, i) => (
        <div key={i} style={{ display:'grid', gridTemplateColumns:'120px 1fr 1fr', gap:8, fontSize:11, padding:'5px 8px', background:C.bgAlt, borderRadius:6 }}>
          <span style={{ fontWeight:600, color:C.textMid, textTransform:'capitalize' }}>{ch.field.replace(/_/g,' ')}</span>
          <span style={{ color:'#C0392B', textDecoration:'line-through', wordBreak:'break-all' }}>{String(ch.from ?? '—')}</span>
          <span style={{ color:'#1A7A4A', fontWeight:600, wordBreak:'break-all' }}>{String(ch.to ?? '—')}</span>
        </div>
      ))}
    </div>
  );
}

function exportCSV(entries) {
  const headers = ['Time','User','Role','Module','Action','Summary','Changes'];
  const rows = entries.map(e => [
    new Date(e.time).toLocaleString('en-GB'),
    e.who || '',
    e.role || '',
    MODULE_LABELS[e.module] || e.module || '',
    e.action || '',
    e.msg || '',
    (e.changes || []).map(c => `${c.field}: "${c.from}" → "${c.to}"`).join('; '),
  ]);
  const escape = v => { const s = String(v).replace(/"/g,'""'); return s.includes(',') || s.includes('\n') ? `"${s}"` : s; };
  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `activity_log_${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export default function ActivityLog() {
  const { state } = useApp();
  const { C }     = useTheme();
  const { activity = [], currentUser } = state;

  const inp = { padding:'6px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12.5, outline:'none', fontFamily:'inherit' };
  const th  = { padding:'9px 12px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', background:C.tableHeaderBg, whiteSpace:'nowrap' };
  const td  = { padding:'10px 12px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'top' };

  const [search,     setSearch]     = useState('');
  const [modFilter,  setModFilter]  = useState('all');
  const [actFilter,  setActFilter]  = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [fromDate,   setFromDate]   = useState('');
  const [toDate,     setToDate]     = useState('');
  const [expanded,   setExpanded]   = useState(null);
  const [page,       setPage]       = useState(1);
  const PAGE_SIZE = 25;

  // ── Historical lookups ──────────────────────────────────────────────────────
  // Boot loads only the 200 most recent entries into memory. Filtering that by
  // date can never reach further back than those 200, so "what happened three
  // weeks ago" was unanswerable even though the rows exist in Supabase.
  // Setting a date range now fetches that period from the server instead.
  const [history,        setHistory]        = useState(null);   // null = use live in-memory log
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!fromDate && !toDate) { setHistory(null); return undefined; }
    let cancelled = false;
    setLoadingHistory(true);
    loadActivity({
      fromIso: fromDate ? new Date(fromDate).toISOString() : null,
      toIso:   toDate   ? new Date(toDate + 'T23:59:59').toISOString() : null,
      limit:   5000,
    })
      .then(rows => { if (!cancelled) setHistory(rows || []); })
      .catch(()   => { if (!cancelled) setHistory([]); })
      .finally(() => { if (!cancelled) setLoadingHistory(false); });
    return () => { cancelled = true; };
  }, [fromDate, toDate]);

  // With a date range set, read from the server results; otherwise the live log.
  const source = history ?? activity;

  // Unique users and modules from log
  const users   = useMemo(() => [...new Set(source.map(a => a.who).filter(Boolean))].sort(), [source]);
  const modules  = useMemo(() => [...new Set(source.map(a => a.module).filter(Boolean))].sort(), [source]);
  const actions  = useMemo(() => [...new Set(source.map(a => a.action).filter(Boolean))].sort(), [source]);

  const filtered = useMemo(() => {
    const q   = search.toLowerCase();
    const from = fromDate ? new Date(fromDate) : null;
    const to   = toDate   ? new Date(toDate + 'T23:59:59') : null;
    return source.filter(a => {
      if (modFilter  !== 'all' && a.module !== modFilter)  return false;
      if (actFilter  !== 'all' && a.action !== actFilter)  return false;
      if (userFilter !== 'all' && a.who    !== userFilter) return false;
      if (from && new Date(a.time) < from) return false;
      if (to   && new Date(a.time) > to)   return false;
      if (q && !`${a.msg}${a.who}${a.module}${a.action}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [source, search, modFilter, actFilter, userFilter, fromDate, toDate]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function clearFilters() {
    setSearch(''); setModFilter('all'); setActFilter('all');
    setUserFilter('all'); setFromDate(''); setToDate(''); setPage(1);
  }

  const hasFilters = search || modFilter !== 'all' || actFilter !== 'all' || userFilter !== 'all' || fromDate || toDate;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Activity Log</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>
            Full audit trail · {activity.length} total events · {filtered.length} shown
          </div>
        </div>
        <button
          onClick={() => exportCSV(filtered)}
          style={{ padding:'7px 16px', borderRadius:8, background:C.green, color:'#fff', border:'none', fontSize:13, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}
        >
          ⬇ Export CSV
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
        {Object.entries(ACTION_COLORS).map(([key, cfg]) => {
          const count = activity.filter(a => a.action === key).length;
          if (!count) return null;
          return (
            <div key={key} onClick={() => { setActFilter(key); setPage(1); }}
              style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:10, padding:'9px 14px', cursor:'pointer', boxShadow:C.shadowCard, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:18, fontWeight:800, color:cfg.c }}>{count}</span>
              <span style={{ fontSize:11, color:C.textMuted, textTransform:'capitalize' }}>{cfg.label}</span>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'14px 16px', display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', boxShadow:C.shadowCard }}>
        <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Search messages…" style={{ ...inp, minWidth:180 }} />
        <select value={modFilter}  onChange={e=>{setModFilter(e.target.value);setPage(1);}}  style={inp}>
          <option value="all">All Modules</option>
          {modules.map(m => <option key={m} value={m}>{MODULE_LABELS[m]||m}</option>)}
        </select>
        <select value={actFilter}  onChange={e=>{setActFilter(e.target.value);setPage(1);}}  style={inp}>
          <option value="all">All Actions</option>
          {actions.map(a => <option key={a} value={a}>{ACTION_COLORS[a]?.label||a}</option>)}
        </select>
        <select value={userFilter} onChange={e=>{setUserFilter(e.target.value);setPage(1);}} style={inp}>
          <option value="all">All Users</option>
          {users.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <input type="date" value={fromDate} onChange={e=>{setFromDate(e.target.value);setPage(1);}} style={inp} title="From date" />
        <input type="date" value={toDate}   onChange={e=>{setToDate(e.target.value);setPage(1);}}   style={inp} title="To date" />
        {hasFilters && (
          <button onClick={clearFilters} style={{ ...inp, cursor:'pointer', color:C.danger, background:'none', border:'1px solid '+C.danger }}>✕ Clear</button>
        )}
      </div>

      {/* Table */}
      <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, overflow:'hidden', boxShadow:C.shadowCard }}>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                {['Time','User · Role','Module','Action','Summary','Changes'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loadingHistory && (
                <tr><td colSpan={6} style={{ ...td, textAlign:'center', padding:36, color:C.textMuted }}>Fetching that period from the server…</td></tr>
              )}
              {!loadingHistory && paginated.length === 0 && (
                <tr><td colSpan={6} style={{ ...td, textAlign:'center', padding:36, color:C.textMuted }}>
                  {history
                    ? 'No activity was recorded in that period. Note that entries only exist from 6 August 2026, when audit logging to the server was switched on.'
                    : 'No activity matches your filters'}
                </td></tr>
              )}
              {paginated.map((a, i) => {
                const isExp = expanded === i;
                return (
                  <>
                    <tr key={i}
                      onClick={() => setExpanded(isExp ? null : i)}
                      style={{ cursor:'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = C.greenPale}
                      onMouseLeave={e => e.currentTarget.style.background = ''}
                    >
                      <td style={{ ...td, fontSize:11.5, color:C.textMuted, whiteSpace:'nowrap' }}>
                        {a.time ? formatDateTime(a.time) : '—'}
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight:600, fontSize:12.5 }}>{a.who || '—'}</div>
                        <div style={{ fontSize:10.5, color:C.textMuted, textTransform:'capitalize' }}>{a.role || ''}</div>
                      </td>
                      <td style={{ ...td, fontSize:12 }}>
                        {MODULE_LABELS[a.module] || a.module || '—'}
                      </td>
                      <td style={td}><ActionBadge action={a.action || 'info'} /></td>
                      <td style={{ ...td, maxWidth:300 }}>
                        <div style={{ fontSize:12.5, color:C.text, wordBreak:'break-word' }}>{a.msg}</div>
                      </td>
                      <td style={{ ...td, fontSize:11.5, color:C.textMuted }}>
                        {(a.changes||[]).length > 0
                          ? <span style={{ color:C.green, fontWeight:600 }}>{a.changes.length} field{a.changes.length>1?'s':''} changed ↓</span>
                          : '—'
                        }
                      </td>
                    </tr>
                    {isExp && (a.changes||[]).length > 0 && (
                      <tr key={`exp-${i}`}>
                        <td colSpan={6} style={{ padding:'10px 20px', background:C.bgAlt, borderBottom:'1px solid '+C.borderLight }}>
                          <div style={{ fontSize:11, fontWeight:600, color:C.textMid, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Field Changes</div>
                          <div style={{ display:'grid', gridTemplateColumns:'120px 1fr 1fr', gap:4, fontSize:10.5, fontWeight:700, color:C.textMuted, padding:'0 8px', marginBottom:4 }}>
                            <span>Field</span><span>Before</span><span>After</span>
                          </div>
                          <DiffViewer changes={a.changes} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderTop:'1px solid '+C.borderLight }}>
            <div style={{ fontSize:12, color:C.textMuted }}>
              Page {page} of {totalPages} · {filtered.length} entries
            </div>
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                style={{ padding:'4px 12px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.textMid, cursor:'pointer', fontSize:12, opacity:page===1?0.4:1 }}>← Prev</button>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                const pg = page <= 4 ? i+1 : page - 3 + i;
                if (pg < 1 || pg > totalPages) return null;
                return (
                  <button key={pg} onClick={() => setPage(pg)}
                    style={{ padding:'4px 10px', borderRadius:7, border:'1px solid '+(pg===page?C.green:C.border), background:pg===page?C.green:'transparent', color:pg===page?'#fff':C.textMid, cursor:'pointer', fontSize:12, fontWeight:pg===page?600:400 }}>{pg}</button>
                );
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
                style={{ padding:'4px 12px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.textMid, cursor:'pointer', fontSize:12, opacity:page===totalPages?0.4:1 }}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
