// ══════════════════════════════════════════════════════════════════════════════
// SLOT Engineering — Module Editor v1.0
// Admin tool to customise the sidebar: rename modules, toggle visibility,
// change icons, reorder, and set module-level descriptions.
// Changes are persisted to bc_settings.moduleConfig.
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { showToast } from '../../utils/helpers';
import { saveSettingsLocal } from '../../utils/db';
import { logActivity } from '../../utils/audit';

const DEFAULT_MODULES = [
  { id:'dashboard',   label:'Dashboard',          icon:'📊', section:'MAIN',     visible:true, locked:true  },
  { id:'nlng',        label:'Contract Staff',      icon:'👷', section:'MODULES',  visible:true, locked:false },
  { id:'slot',        label:'Company Staff',       icon:'👤', section:'MODULES',  visible:true, locked:false },
  { id:'procurement', label:'Procurement',         icon:'🛒', section:'MODULES',  visible:true, locked:false },
  { id:'inventory',   label:'Inventory',           icon:'📦', section:'MODULES',  visible:true, locked:false },
  { id:'vehicles',    label:'Fleet / Vehicles',    icon:'🚗', section:'MODULES',  visible:true, locked:false },
  { id:'terminal',    label:'Terminal Operations', icon:'🏭', section:'MODULES',  visible:true, locked:false },
  { id:'invoices',    label:'Invoices',            icon:'🧾', section:'MODULES',  visible:true, locked:false },
  { id:'pettycash',   label:'Petty Cash',          icon:'💵', section:'MODULES',  visible:true, locked:false },
  { id:'request',     label:'Requests',            icon:'📋', section:'MODULES',  visible:true, locked:false },
  { id:'fixedassets', label:'Fixed Assets',        icon:'🏗',  section:'EXTENDED', visible:true, locked:false },
  { id:'wht',         label:'WHT',                 icon:'🏛',  section:'EXTENDED', visible:true, locked:false },
  { id:'accounting',  label:'Accounting',          icon:'📒', section:'FINANCE',  visible:true, locked:false },
  { id:'approvals',   label:'Approvals',           icon:'✅', section:'FINANCE',  visible:true, locked:false },
  { id:'analytics',   label:'Analytics',           icon:'📈', section:'REPORTS',  visible:true, locked:false },
  { id:'excel',       label:'Excel Import/Export', icon:'📊', section:'ADMIN',    visible:true, locked:false },
  { id:'users',       label:'Users',               icon:'👥', section:'ADMIN',    visible:true, locked:true  },
  { id:'settings',    label:'Settings',            icon:'⚙️',  section:'ADMIN',    visible:true, locked:true  },
  { id:'backup',      label:'Backup',              icon:'💾', section:'ADMIN',    visible:true, locked:true  },
];

const SECTIONS = ['MAIN','MODULES','EXTENDED','FINANCE','REPORTS','ADMIN'];
const ICON_PRESETS = ['📊','👷','👤','🛒','📦','🚗','🏭','🧾','💵','📋','📥','🏗','🏛','📒','✅','📈','📝','⚙️','💾','👥','🔧','📁','🗂','💼','🏢','📌','🔑','📎','🗒','✏️','🖨','📱','💻','🖥'];

function Btn({ children, onClick, variant='primary', sm, disabled, style={} }) {
  const { C } = useTheme();
  const V = { primary:{bg:C.green,co:'#fff',b:'none'}, ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border}, danger:{bg:C.danger,co:'#fff',b:'none'}, outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green} }[variant] || {};
  return <button onClick={onClick} disabled={disabled} style={{ background:V.bg, color:V.co, border:V.b, borderRadius:7, padding:sm?'4px 11px':'7px 16px', fontSize:sm?11.5:13, fontWeight:500, cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1, display:'inline-flex', alignItems:'center', gap:5, ...style }}>{children}</button>;
}

function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'18px 20px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}

export default function ModuleEditor() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { appSettings, currentUser } = state;

  // Load saved config or use defaults
  const [modules, setModules] = useState(() => {
    const saved = appSettings?.moduleConfig;
    if (saved && saved.length) {
      // Merge: add any new default modules not in saved
      const savedIds = new Set(saved.map(m => m.id));
      const newDefaults = DEFAULT_MODULES.filter(m => !savedIds.has(m.id));
      return [...saved, ...newDefaults];
    }
    return DEFAULT_MODULES;
  });

  const [editing,     setEditing]     = useState(null); // id being edited inline
  const [editLabel,   setEditLabel]   = useState('');
  const [editIcon,    setEditIcon]    = useState('');
  const [editSection, setEditSection] = useState('');
  const [showIcons,   setShowIcons]   = useState(false);
  const [filter,      setFilter]      = useState('');
  const [dirty,       setDirty]       = useState(false);

  const inp = { padding:'6px 9px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12.5, outline:'none', fontFamily:'inherit' };

  const filtered = useMemo(() => {
    if (!filter) return modules;
    const q = filter.toLowerCase();
    return modules.filter(m => m.label.toLowerCase().includes(q) || m.id.includes(q));
  }, [modules, filter]);

  const grouped = useMemo(() => {
    const g = {};
    SECTIONS.forEach(s => { g[s] = filtered.filter(m => m.section === s); });
    return g;
  }, [filtered]);

  function update(id, changes) {
    setModules(prev => prev.map(m => m.id === id ? { ...m, ...changes } : m));
    setDirty(true);
  }

  function startEdit(mod) {
    setEditing(mod.id);
    setEditLabel(mod.label);
    setEditIcon(mod.icon);
    setEditSection(mod.section);
    setShowIcons(false);
  }

  function commitEdit(id) {
    if (!editLabel.trim()) { showToast('Label cannot be empty', 'error'); return; }
    update(id, { label: editLabel.trim(), icon: editIcon, section: editSection });
    setEditing(null);
  }

  function moveUp(id) {
    const idx = modules.findIndex(m => m.id === id);
    if (idx <= 0) return;
    const next = [...modules];
    [next[idx-1], next[idx]] = [next[idx], next[idx-1]];
    setModules(next); setDirty(true);
  }

  function moveDown(id) {
    const idx = modules.findIndex(m => m.id === id);
    if (idx >= modules.length - 1) return;
    const next = [...modules];
    [next[idx], next[idx+1]] = [next[idx+1], next[idx]];
    setModules(next); setDirty(true);
  }

  function resetDefaults() {
    if (!window.confirm('Reset all module configuration to defaults?')) return;
    setModules(DEFAULT_MODULES);
    setDirty(true);
  }

  async function handleSave() {
    const newSettings = { ...appSettings, moduleConfig: modules };
    dispatch({ type:'SET_SETTINGS', payload: newSettings });
    saveSettingsLocal(newSettings);
    logActivity(dispatch, `Module layout updated by ${currentUser?.name}`, currentUser, { module:'settings', action:'edit' });
    showToast('Module configuration saved. Reload to see sidebar changes.');
    setDirty(false);
  }

  const visibleCount = modules.filter(m => m.visible).length;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Module Editor</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>
            Rename · reorder · show/hide · change icons for sidebar modules · {visibleCount} of {modules.length} visible
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Btn variant="ghost" sm onClick={resetDefaults}>↺ Reset Defaults</Btn>
          <Btn onClick={handleSave} disabled={!dirty}>{dirty ? '💾 Save Changes' : '✓ Saved'}</Btn>
        </div>
      </div>

      {dirty && (
        <div style={{ padding:'10px 14px', background:'rgba(201,122,10,.1)', border:'1px solid rgba(201,122,10,.4)', borderRadius:8, fontSize:12, color:C.amber, display:'flex', alignItems:'center', gap:8 }}>
          ⚠ You have unsaved changes. Click <strong>Save Changes</strong> to apply them.
        </div>
      )}

      {/* Search */}
      <Card style={{ padding:'12px 16px' }}>
        <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filter modules…" style={{ ...inp, width:'100%', boxSizing:'border-box' }} />
      </Card>

      {/* Module list by section */}
      {SECTIONS.map(section => {
        const items = grouped[section];
        if (!items || items.length === 0) return null;
        return (
          <Card key={section}>
            <div style={{ fontSize:11, fontWeight:700, color:C.textMuted, textTransform:'uppercase', letterSpacing:'1px', marginBottom:12 }}>{section}</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {items.map((mod, idx) => {
                const isEditing = editing === mod.id;
                return (
                  <div key={mod.id}
                    style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:9, border:'1px solid '+(isEditing?C.green:C.borderLight), background:isEditing?C.greenPale:C.bgAlt, transition:'all .15s' }}>

                    {/* Drag handles / order */}
                    <div style={{ display:'flex', flexDirection:'column', gap:2, flexShrink:0 }}>
                      <button onClick={() => moveUp(mod.id)} title="Move up" style={{ background:'none', border:'none', cursor:'pointer', color:C.textMuted, fontSize:10, padding:'1px 3px', lineHeight:1 }}>▲</button>
                      <button onClick={() => moveDown(mod.id)} title="Move down" style={{ background:'none', border:'none', cursor:'pointer', color:C.textMuted, fontSize:10, padding:'1px 3px', lineHeight:1 }}>▼</button>
                    </div>

                    {/* Visibility toggle */}
                    <label title={mod.locked ? 'This module cannot be hidden' : 'Toggle visibility'} style={{ cursor:mod.locked?'not-allowed':'pointer', flexShrink:0 }}>
                      <input type="checkbox" checked={mod.visible} disabled={mod.locked}
                        onChange={() => update(mod.id, { visible: !mod.visible })}
                        style={{ accentColor:C.green, width:14, height:14 }} />
                    </label>

                    {/* Icon + label display / edit */}
                    {isEditing ? (
                      <div style={{ flex:1, display:'flex', gap:8, alignItems:'flex-start', flexWrap:'wrap' }}>
                        {/* Icon picker */}
                        <div style={{ position:'relative' }}>
                          <button onClick={() => setShowIcons(p=>!p)} style={{ fontSize:20, background:C.bgCard, border:'1px solid '+C.border, borderRadius:7, padding:'4px 8px', cursor:'pointer' }}>{editIcon}</button>
                          {showIcons && (
                            <div style={{ position:'absolute', top:'110%', left:0, zIndex:10, background:C.bgCard, border:'1px solid '+C.border, borderRadius:10, padding:10, display:'flex', flexWrap:'wrap', gap:4, width:240, boxShadow:C.shadowModal }}>
                              {ICON_PRESETS.map(ic => (
                                <button key={ic} onClick={() => { setEditIcon(ic); setShowIcons(false); }}
                                  style={{ fontSize:18, background:ic===editIcon?C.greenPale:'none', border:'1px solid '+(ic===editIcon?C.green:'transparent'), borderRadius:6, padding:'3px 5px', cursor:'pointer' }}>{ic}</button>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* Label */}
                        <input value={editLabel} onChange={e=>setEditLabel(e.target.value)} style={{ ...inp, flex:1, minWidth:120 }} placeholder="Module label" />
                        {/* Section */}
                        <select value={editSection} onChange={e=>setEditSection(e.target.value)} style={inp}>
                          {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <Btn sm onClick={() => commitEdit(mod.id)}>✓ Save</Btn>
                        <Btn sm variant="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
                      </div>
                    ) : (
                      <div style={{ flex:1, display:'flex', alignItems:'center', gap:10, opacity:mod.visible?1:0.4 }}>
                        <span style={{ fontSize:18 }}>{mod.icon}</span>
                        <div>
                          <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{mod.label}</div>
                          <div style={{ fontSize:10.5, color:C.textMuted, fontFamily:'monospace' }}>{mod.id}</div>
                        </div>
                        {mod.locked && <span style={{ fontSize:10, color:C.textLight, background:C.bgAlt, border:'1px solid '+C.border, borderRadius:10, padding:'1px 7px' }}>locked</span>}
                        {!mod.visible && <span style={{ fontSize:10, color:C.danger, background:'rgba(192,57,43,.08)', border:'1px solid rgba(192,57,43,.2)', borderRadius:10, padding:'1px 7px' }}>hidden</span>}
                      </div>
                    )}

                    {!isEditing && (
                      <Btn sm variant="ghost" onClick={() => startEdit(mod)}>✏ Edit</Btn>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      {/* Save footer */}
      <Card style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontSize:12, color:C.textMuted }}>
          Changes take effect after saving and reloading the page. Locked modules cannot be hidden.
        </div>
        <Btn onClick={handleSave} disabled={!dirty}>{dirty ? '💾 Save Configuration' : '✓ All Saved'}</Btn>
      </Card>
    </div>
  );
}
