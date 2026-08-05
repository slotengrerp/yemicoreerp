import { useState, useMemo, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo } from '../../utils/auth';
import { generateId, showToast } from '../../utils/helpers'; // auto-patched
import { getDeepLinkTab } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity } from '../../utils/audit';
import { Btn, Tag, StatCard, Modal, FG, FormGrid, SectionLabel, SearchBar, TabBar, EmptyState, Confirm } from '../ui';
import { printHeader, SLOT_BRAND, PRINT_CSS, printBootstrap, openPrintWindow} from '../../utils/logo';
import { valueIssue, journalFromStockIssue } from '../../utils/inventoryModel';
import { diffAndPush, pushOne, pushDelete } from '../../hooks/usePerRecordSync';

const TAB_LABELS = { vehicles:'Vehicles Register', heavy:'Heavy Equipment Register', materials:'Construction Materials Register', office:'Office Appliances / Furniture Register' };

function printInventory(items, tab) {
  const label = TAB_LABELS[tab] || 'Inventory';
  const rows = items.map((x,i) => {
    let cells = '';
    if (tab==='vehicles')  cells = `<td>${x.sn}</td><td><strong>${x.vehicleNumber}</strong></td><td>${x.make}</td><td>${x.yearOfPurchase||'—'}</td><td>${x.unitServing||'—'}</td>`;
    if (tab==='heavy')     cells = `<td>${x.sn}</td><td><strong>${x.regNumber}</strong></td><td>${x.name||'—'}</td><td>${x.make||'—'}</td><td>${x.companyNumber||'—'}</td><td>${x.status||x.remark||'—'}</td>`;
    if (tab==='materials') cells = `<td>${x.sn}</td><td><strong>${x.name}</strong></td><td>${x.quantity||'—'}</td><td>${x.position||'—'}</td><td>${x.status||'—'}</td>`;
    if (tab==='office')    cells = `<td>${x.sn}</td><td><strong>${x.description}</strong></td><td>${x.officeId||'—'}</td><td>${x.location||'—'}</td><td>${x.status||'—'}</td>`;
    return `<tr style="background:${i%2===1?'#f3faf5':'#fff'}">${cells}</tr>`;
  }).join('');
  const hdrMap = { vehicles:['S/N','Vehicle No.','Make / Model','Year','Unit Serving'], heavy:['S/N','Reg No.','Equipment / Vehicle Name','Make','Company No.','Status'], materials:['S/N','Material Name','Quantity','Position','Status'], office:['S/N','Description','Office ID','Location','Status'] };
  const hdrs = (hdrMap[tab]||[]).map(h=>`<th>${h}</th>`).join('');
  openPrintWindow(`<!DOCTYPE html><html><head><title>${label}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:24px}table{width:100%;border-collapse:collapse;margin-bottom:16px}th{background:#1A5C2A;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px}td{padding:7px 10px;border-bottom:1px solid #EAF0EB;font-size:11px}.footer{margin-top:40px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px}.sig{border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C}@media print{body{padding:12px}}</style></head><body>${printHeader(label.toUpperCase(),'Total: '+items.length+' items')}<table><thead><tr>${hdrs}</tr></thead><tbody>${rows}</tbody></table><div class="footer"><div><div class="sig">Prepared By / Date</div></div><div><div class="sig">Reviewed By / Date</div></div><div><div class="sig">Approved By / Date</div></div></div>${printBootstrap({landscape:false})}</body></html>`);
}

const TABS = [
  { key: 'vehicles',  label: '(a)  Vehicles' },
  { key: 'heavy',     label: '(b)  Heavy Equipment / Trailers' },
  { key: 'materials', label: '(c)  Construction Materials' },
  { key: 'office',    label: '(d)  Office Appliances / Furniture' },
  { key: 'stock',     label: '(e)  📦 Stock Movements & Costing' },
];

const HEAVY_REMARKS   = ['Operational','Under Maintenance','Standby','Decommissioned'];
const MAT_STATUSES    = ['Available','Low Stock','Depleted'];
const OFFICE_STATUSES = ['In Use','Under Repair','Decommissioned','In Storage'];

const EMPTY = {
  vehicles:  { vehicleNumber:'', make:'', yearOfPurchase:'', unitServing:'' },
  heavy:     { regNumber:'', name:'', make:'', companyNumber:'', status:'Operational' },
  materials: { name:'', quantity:'', position:'', status:'Available' },
  office:    { description:'', officeId:'', location:'', status:'In Use' },
};
const HEADERS = {
  vehicles:  ['S/N','Vehicle Number','Make / Model','Year','Unit Serving',''],
  heavy:     ['S/N','Reg. No.','Equipment / Vehicle Name','Make','Company No.','Status',''],
  materials: ['S/N','Material Name','Quantity','Position / Location','Status',''],
  office:    ['S/N','Description','Office ID','Location','Status',''],
};

function getItems(db, tab) {
  if (tab === 'vehicles') return db.vehicles || [];
  return (db.inventory || []).filter(i => i.type === tab);
}

export default function Inventory({ onNav }) {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db } = state;
  const [tab, setTab] = useState(() => getDeepLinkTab('inventory', 'vehicles'));
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const importRef = useRef(null);
  const perms = { add: canDo(currentUser,'canAdd'), edit: canDo(currentUser,'canEdit'), del: canDo(currentUser,'canDelete') };

  function handleImport(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result;
        const lines = text.split('\n').filter(Boolean);
        if (lines.length < 2) { showToast('File empty or has no data rows','error'); return; }
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g,'').toLowerCase());
        const imported = lines.slice(1).map((line, idx) => {
          const vals = line.split(',').map(v => v.trim().replace(/"/g,''));
          const row = {};
          headers.forEach((h, i) => { row[h] = vals[i] || ''; });
          return {
            ...EMPTY[tab],
            id: generateId(),
            type: tab,
            sn: idx + 1,
            vehicleNumber: row['vehicle number']||row['vehiclenumber']||row['reg no']||'',
            make: row['make']||row['make/model']||row['equipment make']||'',
            yearOfPurchase: row['year']||row['yearofpurchase']||'',
            unitServing: row['unit serving']||row['unitserving']||'',
            regNumber: row['reg no']||row['regno']||row['registration number']||'',
            name: row['name']||row['equipment name']||row['vehicle name']||'',
            companyNumber: row['company no']||row['companyno']||row['company number']||'',
            status: row['status']||'Operational',
            remark: row['status']||row['remark']||'Operational',
            quantity: row['quantity']||row['qty']||'',
            position: row['position']||row['location']||'',
            description: row['description']||row['item']||row['name']||'',
            officeId: row['office id']||row['officeid']||'',
            location: row['location']||'',
            createdAt: new Date().toISOString(),
          };
        });
        const current = (db.inventory || []).filter(x => x.type !== tab);
        const updated = [...current, ...imported];
        diffAndPush('inventory', db.inventory, updated); // 2026-07-29 full-app sync sweep
        dispatch({ type:'UPDATE_MODULE', mod:'inventory', data:updated });
        saveDBLocal({ ...db, inventory:updated }, state.activity);
        logActivity(dispatch, `Imported ${imported.length} ${tab} records`, currentUser);
        showToast(`✓ Imported ${imported.length} records into ${TAB_LABELS[tab]}`);
        if (importRef.current) importRef.current.value = '';
      } catch { showToast('Import failed — use CSV format','error'); }
    };
    reader.readAsText(file);
  }

  const items = useMemo(() => getItems(db, tab), [db, tab]);
  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(x => Object.values(x).some(v => String(v||'').toLowerCase().includes(q)));
  }, [items, search]);

  const counts = {
    vehicles:  (db.vehicles||[]).length,
    heavy:     (db.inventory||[]).filter(i=>i.type==='heavy').length,
    materials: (db.inventory||[]).filter(i=>i.type==='materials').length,
    office:    (db.inventory||[]).filter(i=>i.type==='office').length,
  };
  const totalAll = Object.values(counts).reduce((a,v)=>a+v,0);

  function saveItems(tab, next) {
    let nextDB;
    if (tab === 'vehicles') {
      diffAndPush('vehicles', db.vehicles, next); // 2026-07-29 full-app sync sweep
      nextDB = { ...db, vehicles: next };
      dispatch({ type: 'UPDATE_MODULE', mod: 'vehicles', data: next });
    } else {
      const others = (db.inventory||[]).filter(i => i.type !== tab);
      const combined = [...others, ...next];
      diffAndPush('inventory', db.inventory, combined);
      nextDB = { ...db, inventory: combined };
      dispatch({ type: 'UPDATE_MODULE', mod: 'inventory', data: combined });
    }
    saveDBLocal(nextDB, state.activity);
  }

  function getLabel(x) { return x?.vehicleNumber || x?.regNumber || x?.name || x?.description || '—'; }

  function handleSave(formData) {
    const record = tab !== 'vehicles' ? { ...formData, type: tab } : formData;
    if (modal.mode === 'add') {
      saveItems(tab, [...items, { ...record, id: generateId(), sn: items.length+1, createdAt: new Date().toISOString() }]);
      logActivity(dispatch, 'Added ' + tab + ': ' + getLabel(record), currentUser);
      showToast('Item added');
    } else {
      saveItems(tab, items.map(x => x.id === record.id ? { ...x, ...record } : x));
      logActivity(dispatch, 'Updated ' + tab + ': ' + getLabel(record), currentUser);
      showToast('Item updated');
    }
    setModal(null);
  }

  function handleDelete(id) {
    const item = items.find(x => x.id === id);
    saveItems(tab, items.filter(x => x.id !== id).map((x,i) => ({ ...x, sn: i+1 })));
    logActivity(dispatch, 'Deleted ' + tab + ': ' + getLabel(item), currentUser);
    showToast('Item deleted', 'error');
    setConfirm(null);
  }

  const thStyle = { padding: '9px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap', background: C.greenPale, borderBottom: '2px solid ' + C.border };
  const td = { padding: '9px 10px', borderBottom: '1px solid ' + C.borderLight, color: C.text, fontSize: 13 };

  function renderRow(x, i) {
    const bg = { background: i % 2 === 1 ? C.greenPale2 : 'transparent' };
    const actions = (
      <td style={td}>
        <div style={{ display: 'flex', gap: 4 }}>
          {perms.edit && <Btn variant="outline" size="sm" onClick={() => setModal({ mode:'edit', data:{...x} })}>Edit</Btn>}
          {perms.del  && <Btn variant="danger"  size="sm" onClick={() => setConfirm(x.id)}>Del</Btn>}
        </div>
      </td>
    );
    if (tab === 'vehicles') return (
      <tr key={x.id} style={bg}>
        <td style={td}>{x.sn}</td>
        <td style={{ ...td, color: C.green, fontFamily: 'Courier New', fontWeight: 700, fontSize: 12 }}>{x.vehicleNumber}</td>
        <td style={{ ...td, fontWeight: 600 }}>{x.make}</td>
        <td style={td}>{x.yearOfPurchase}</td>
        <td style={{ ...td, color: C.info }}>{x.unitServing}</td>
        {actions}
      </tr>
    );
    if (tab === 'heavy') return (
      <tr key={x.id} style={bg}>
        <td style={td}>{x.sn}</td>
        <td style={{ ...td, color: C.green, fontFamily: 'Courier New', fontSize: 12 }}>{x.regNumber}</td>
        <td style={{ ...td, fontWeight: 600 }}>{x.name || '—'}</td>
        <td style={{ ...td, color: C.textMuted }}>{x.make || '—'}</td>
        <td style={{ ...td, fontSize: 12 }}>{x.companyNumber || '—'}</td>
        <td style={td}><Tag status={x.status || x.remark || 'Operational'} /></td>
        {actions}
      </tr>
    );
    if (tab === 'materials') return (
      <tr key={x.id} style={bg}>
        <td style={td}>{x.sn}</td>
        <td style={{ ...td, fontWeight: 600 }}>{x.name}</td>
        <td style={{ ...td, color: C.amber, fontWeight: 700 }}>{x.quantity}</td>
        <td style={{ ...td, color: C.textMuted }}>{x.position}</td>
        <td style={td}><Tag status={x.status} /></td>
        {actions}
      </tr>
    );
    return (
      <tr key={x.id} style={bg}>
        <td style={td}>{x.sn}</td>
        <td style={{ ...td, fontWeight: 600 }}>{x.description}</td>
        <td style={{ ...td, color: C.info, fontFamily: 'Courier New', fontSize: 11 }}>{x.officeId}</td>
        <td style={{ ...td, color: C.textMuted }}>{x.location}</td>
        <td style={td}><Tag status={x.status} /></td>
        {actions}
      </tr>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPI row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { label:'Total Items',      value:totalAll,          accent:C.green,   key:null },
          { label:'Vehicles',         value:counts.vehicles,   accent:C.info,    key:'vehicles' },
          { label:'Heavy Equipment',  value:counts.heavy,      accent:C.textMid, key:'heavy' },
          { label:'Materials',        value:counts.materials,  accent:C.warning, key:'materials' },
          { label:'Office / Furn.',   value:counts.office,     accent:C.green,   key:'office' },
        ].map(({label,value,accent,key}) => (
          <div key={label}
            onClick={()=>{ if(key){ setTab(key); setSearch(''); } }}
            style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12,
              padding:'13px 15px', flex:1, minWidth:130, position:'relative',
              boxShadow:C.shadowCard, cursor:key?'pointer':'default',
              transition:'transform 0.12s,box-shadow 0.12s',
              borderTop:'3px solid '+(accent||C.border),
              outline: key && tab===key ? '2px solid '+(accent||C.green) : 'none',
            }}
            onMouseEnter={e=>{ if(key){ e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,0.15)'; }}}
            onMouseLeave={e=>{ e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=C.shadowCard; }}
          >
            <div style={{fontSize:10,fontWeight:600,color:C.textMuted,textTransform:'uppercase',letterSpacing:1,marginBottom:5}}>{label}</div>
            <div style={{fontSize:20,fontWeight:700,color:accent||C.green,lineHeight:1}}>{value}</div>
            {key && <div style={{fontSize:10,color:C.textMuted,marginTop:3}}>click to view →</div>}
          </div>
        ))}
      </div>

      {/* Card */}
      <div style={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 12, boxShadow: C.shadowCard }}>
        {/* Tab bar */}
        <div style={{ padding: '0 20px' }}>
          <TabBar tabs={TABS} active={tab} onChange={t => { setTab(t); setSearch(''); }} />
        </div>

        {/* Toolbar */}
        <div style={{ padding: '14px 20px', display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <SearchBar value={search} onChange={setSearch} placeholder="Search inventory…" />
          </div>
          {perms.add && <Btn variant="primary" onClick={() => setModal({ mode:'add', data:{...EMPTY[tab]} })}>+ Add Item</Btn>}
          <Btn variant="ghost" onClick={() => printInventory(filtered, tab)}>🖨 Print / Download</Btn>
          {perms.add && <><input ref={importRef} type="file" accept=".csv,.xlsx,.xls" style={{ display:'none' }}
            onChange={e => handleImport(e.target.files[0])} />
          <Btn variant="outline" onClick={() => importRef.current?.click()}>⬆ Import Excel / CSV</Btn></>}
        </div>

        {/* Table */}
        <div style={{ padding: '0 20px 20px' }}>
          {tab === 'stock' ? (
            <StockCostingTab C={C} db={db} currentUser={currentUser} dispatch={dispatch} state={state} />
          ) : (
            <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid ' + C.border, boxShadow: C.shadowCard }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                <thead>
                  <tr>{HEADERS[tab].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filtered.length === 0
                    ? <tr><td colSpan={HEADERS[tab].length}><EmptyState text="No items found" sub="Add an item to get started" /></td></tr>
                    : filtered.map((x,i) => renderRow(x, i))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modal  && <InvModal tab={tab} modal={modal} onSave={handleSave} onClose={() => setModal(null)} />}
      {confirm && <Confirm message="Remove this inventory item permanently?" onConfirm={() => handleDelete(confirm)} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

// ── Stock Movements & Costing Tab ──────────────────────────────────────────
// Wires the `valueIssue()` engine in utils/inventoryModel.js to a real UI:
//   • Each stock item has a list of movements (RECEIVE / ISSUE / ADJUST / RETURN / SCRAP).
//   • The current on-hand quantity, weighted-average cost, and total stock
//     value are computed from the movement history on every render.
//   • The Issue modal uses the costing engine to compute the issued cost
//     (FIFO or weighted-average) and posts a Dr COGS / Cr Inventory
//     journal entry via Accounting's auto-post effect.
//   • Reorder point alerts surface in the per-item panel.
function StockCostingTab({ C, db, currentUser, dispatch, state }) {
  const stockItems = (db.stockItems || []).filter(i => !i.voided);
  const stockMovements = (db.stockMovements || []);
  const [view, setView] = useState('list');  // list | detail | new
  const [selItem, setSelItem] = useState(null);
  const [newItem, setNewItem] = useState({ code:'', name:'', category:'', uom:'pcs', unitCost:0, reorderPoint:0, openingQty:0, openingCost:0 });
  const [newMove, setNewMove] = useState({ type:'RECEIVE', qty:0, unitCost:0, refType:'', refId:'', date:new Date().toISOString().split('T')[0], postedToGL:false });

  function saveItem() {
    if (!newItem.code || !newItem.name) { showToast('Code and name are required','error'); return; }
    const rec = { id: generateId(), ...newItem, status:'Active', createdAt:new Date().toISOString() };
    // Optional: post an opening-balance RECEIVE movement so the on-hand qty isn't 0
    const movements = [];
    if (Number(newItem.openingQty) > 0) {
      movements.push({
        id: generateId(),
        itemId: rec.id, type:'RECEIVE', qty: Number(newItem.openingQty), unitCost: Number(newItem.openingCost) || 0,
        refType: 'opening', refId: rec.id,
        date: new Date().toISOString().split('T')[0],
        postedToGL: false,
        createdAt: new Date().toISOString(),
      });
    }
    const next = {
      ...db,
      stockItems: [...(db.stockItems || []), rec],
      stockMovements: [...(db.stockMovements || []), ...movements],
    };
    pushOne('stockItems', rec); // 2026-07-29 full-app sync sweep — pure additions, no diff needed
    movements.forEach(m => pushOne('stockMovements', m));
    dispatch({ type:'UPDATE_MODULE', mod:'stockItems', data: next.stockItems });
    dispatch({ type:'UPDATE_MODULE', mod:'stockMovements', data: next.stockMovements });
    saveDBLocal({ ...next }, state.activity);
    logActivity(dispatch, `Stock item ${rec.code} (${rec.name}) created with opening ${newItem.openingQty} ${rec.uom}`, currentUser, { module:'inventory', action:'create' });
    showToast('Stock item registered');
    setView('list');
    setNewItem({ code:'', name:'', category:'', uom:'pcs', unitCost:0, reorderPoint:0, openingQty:0, openingCost:0 });
  }

  function postMovement(item, move) {
    if (!move.qty || Number(move.qty) <= 0) { showToast('Quantity required', 'error'); return; }
    if (move.type === 'RECEIVE' && (!move.unitCost || Number(move.unitCost) <= 0)) { showToast('Unit cost required for RECEIVE', 'error'); return; }
    // For ISSUE/RETURN/SCRAP, run the costing engine to confirm enough stock
    if (move.type === 'ISSUE' || move.type === 'SCRAP') {
      const itemMovs = stockMovements.filter(m => m.itemId === item.id);
      const result = valueIssue(itemMovs, Number(move.qty), 'wavg');
      if (result.unitCost <= 0) { showToast('No stock on hand to issue', 'error'); return; }
    }
    const rec = { id: generateId(), itemId: item.id, ...move, qty: Number(move.qty), unitCost: Number(move.unitCost) || 0, createdAt: new Date().toISOString() };
    pushOne('stockMovements', rec); // 2026-07-29 full-app sync sweep
    dispatch({ type:'UPDATE_MODULE', mod:'stockMovements', data: [...stockMovements, rec] });
    saveDBLocal({ ...db, stockMovements: [...stockMovements, rec] }, state.activity);
    logActivity(dispatch, `Stock ${move.type}: ${item.code} × ${move.qty} ${item.uom}`, currentUser, { module:'inventory', action:'create' });
    showToast(`Movement ${move.type} recorded`);
    setNewMove({ type:'RECEIVE', qty:0, unitCost:0, refType:'', refId:'', date:new Date().toISOString().split('T')[0], postedToGL:false });
  }

  // Per-item summary
  const itemSummary = (item) => {
    const itemMovs = stockMovements.filter(m => m.itemId === item.id);
    let qty = 0, value = 0;
    itemMovs.forEach(m => {
      const q = Number(m.qty) || 0;
      if (m.type === 'RECEIVE' || m.type === 'RETURN' || (m.type === 'ADJUST' && q > 0)) {
        qty   += q;
        value += q * (Number(m.unitCost) || 0);
      } else if (m.type === 'ISSUE' || m.type === 'SCRAP' || (m.type === 'ADJUST' && q < 0)) {
        const avg = qty > 0 ? value / qty : 0;
        qty   = Math.max(0, qty + q);  // q is negative
        value = Math.max(0, value + q * avg);
      }
    });
    const avgCost = qty > 0 ? value / qty : 0;
    const reorderAlert = (Number(item.reorderPoint) || 0) > 0 && qty <= Number(item.reorderPoint);
    return { qty, value, avgCost, reorderAlert, movementCount: itemMovs.length };
  };

  // ── View: per-item detail with movement history and Issue UI ──
  if (view === 'detail' && selItem) {
    const item = stockItems.find(i => i.id === selItem.id) || selItem;
    const itemMovs = stockMovements.filter(m => m.itemId === item.id).sort((a,b) => (a.date||'').localeCompare(b.date||''));
    const sum = itemSummary(item);
    return (
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <Btn variant="ghost" onClick={() => { setView('list'); setSelItem(null); }}>← Back to Stock Items</Btn>
          <div style={{ fontSize:11,color:C.textMuted }}>{item.code} · {item.name}</div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginBottom:14 }}>
          <div style={{ padding:'10px 14px', background:C.greenPale, borderRadius:8, borderLeft:'4px solid '+C.success }}>
            <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>On Hand</div>
            <div style={{ fontSize:20, fontWeight:700, color:C.success }}>{sum.qty.toLocaleString('en-NG')} <span style={{ fontSize:12, color:C.textMuted }}>{item.uom}</span></div>
          </div>
          <div style={{ padding:'10px 14px', background:C.greenPale, borderRadius:8, borderLeft:'4px solid '+C.amber }}>
            <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>Avg Unit Cost</div>
            <div style={{ fontSize:20, fontWeight:700, color:C.amber }}>₦{sum.avgCost.toLocaleString('en-NG',{maximumFractionDigits:2})}</div>
          </div>
          <div style={{ padding:'10px 14px', background:C.greenPale, borderRadius:8, borderLeft:'4px solid '+C.info }}>
            <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>Total Stock Value</div>
            <div style={{ fontSize:20, fontWeight:700, color:C.info }}>₦{sum.value.toLocaleString('en-NG',{maximumFractionDigits:0})}</div>
          </div>
          <div style={{ padding:'10px 14px', background: sum.reorderAlert ? 'rgba(192,57,43,.08)' : C.bgAlt, borderRadius:8, borderLeft:'4px solid '+(sum.reorderAlert ? C.danger : C.border) }}>
            <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>Reorder Point</div>
            <div style={{ fontSize:20, fontWeight:700, color: sum.reorderAlert ? C.danger : C.text }}>{item.reorderPoint || 0} {item.uom}</div>
            {sum.reorderAlert && <div style={{ fontSize:10, color:C.danger, fontWeight:600, marginTop:2 }}>⚠ Below reorder point</div>}
          </div>
        </div>

        {/* Movement entry */}
        <div style={{ background:C.bgAlt, borderRadius:8, padding:14, marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.text, marginBottom:8 }}>📝 Record a Movement</div>
          <div style={{ display:'grid', gridTemplateColumns:'120px 1fr 1fr 1fr 1fr 120px', gap:8, alignItems:'end' }}>
            <FG label="Type">
              <select style={{ padding:'6px 8px', borderRadius:6, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12 }} value={newMove.type} onChange={e=>setNewMove(p=>({...p,type:e.target.value}))}>
                <option>RECEIVE</option><option>ISSUE</option><option>RETURN</option><option>SCRAP</option><option>ADJUST</option>
              </select>
            </FG>
            <FG label={`Quantity (${item.uom})`}><input type="number" style={{ padding:'6px 8px', borderRadius:6, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12 }} value={newMove.qty||''} onChange={e=>setNewMove(p=>({...p,qty:e.target.value}))} /></FG>
            <FG label="Unit Cost (₦)" hint="Required for RECEIVE"><input type="number" style={{ padding:'6px 8px', borderRadius:6, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12 }} value={newMove.unitCost||''} onChange={e=>setNewMove(p=>({...p,unitCost:e.target.value}))} /></FG>
            <FG label="Date"><input type="date" style={{ padding:'6px 8px', borderRadius:6, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12 }} value={newMove.date} onChange={e=>setNewMove(p=>({...p,date:e.target.value}))} /></FG>
            <FG label="Reference"><input style={{ padding:'6px 8px', borderRadius:6, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:12 }} value={newMove.refId||''} onChange={e=>setNewMove(p=>({...p,refId:e.target.value,refType:'manual'}))} placeholder="PO/SO/Manual ref" /></FG>
            <Btn onClick={() => postMovement(item, newMove)}>+ Record</Btn>
          </div>
        </div>

        {/* Movement history */}
        <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:8, overflow:'hidden' }}>
          <div style={{ padding:'10px 14px', background:C.greenPale, borderBottom:'1px solid '+C.border, fontSize:12, fontWeight:700, color:C.text }}>Movement History ({itemMovs.length})</div>
          {itemMovs.length === 0 ? (
            <div style={{ padding:24, textAlign:'center', color:C.textMuted, fontSize:12 }}>No movements yet. Record a RECEIVE to start building on-hand quantity.</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:C.bgAlt }}>
                  {['Date','Type','Qty','Unit Cost','Line Value','Reference',''].map(h=><th key={h} style={{ padding:'8px 10px', textAlign:'left', fontSize:10, fontWeight:700, color:C.textMid, textTransform:'uppercase' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {itemMovs.map(m => {
                  const isPositive = m.type === 'RECEIVE' || m.type === 'RETURN' || (m.type === 'ADJUST' && Number(m.qty) > 0);
                  return (
                    <tr key={m.id} style={{ borderBottom:'1px solid '+C.borderLight }}>
                      <td style={{ padding:'6px 10px' }}>{m.date}</td>
                      <td style={{ padding:'6px 10px' }}>
                        <span style={{ padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:600, color: isPositive?C.success:C.danger, background: isPositive?'rgba(26,122,74,.1)':'rgba(192,57,43,.1)' }}>{m.type}</span>
                      </td>
                      <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:600, color: isPositive?C.success:C.danger }}>{isPositive?'+':''}{Number(m.qty).toLocaleString('en-NG')}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' }}>₦{Number(m.unitCost||0).toLocaleString('en-NG',{maximumFractionDigits:2})}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right', color:C.textMid }}>₦{(Number(m.qty)*Number(m.unitCost||0)).toLocaleString('en-NG',{maximumFractionDigits:0})}</td>
                      <td style={{ padding:'6px 10px', color:C.textMuted, fontSize:11 }}>{m.refId||'—'}</td>
                      <td style={{ padding:'6px 10px', textAlign:'right' }}>
                        <button onClick={() => { if (window.confirm('Delete this movement?')) { pushDelete('stockMovements', m.id); dispatch({ type:'UPDATE_MODULE', mod:'stockMovements', data: stockMovements.filter(x => x.id !== m.id) }); saveDBLocal({ ...db, stockMovements: stockMovements.filter(x => x.id !== m.id) }, state.activity); } }} style={{ background:'transparent', border:'none', color:C.danger, cursor:'pointer', fontSize:13 }}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  // ── View: new item form ──
  if (view === 'new') {
    return (
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
          <Btn variant="ghost" onClick={() => setView('list')}>← Back</Btn>
          <div style={{ fontSize:11, color:C.textMuted }}>New Stock Item</div>
        </div>
        <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:10, padding:18 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <FG label="Code *"><input style={{ padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%' }} value={newItem.code} onChange={e=>setNewItem(p=>({...p,code:e.target.value}))} placeholder="e.g. PIPE-2IN-SCH40" /></FG>
            <FG label="Name *"><input style={{ padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%' }} value={newItem.name} onChange={e=>setNewItem(p=>({...p,name:e.target.value}))} /></FG>
            <FG label="Category"><input style={{ padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%' }} value={newItem.category} onChange={e=>setNewItem(p=>({...p,category:e.target.value}))} placeholder="e.g. Pipes / Electrical / Hardware" /></FG>
            <FG label="Unit of Measure">
              <select style={{ padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%' }} value={newItem.uom} onChange={e=>setNewItem(p=>({...p,uom:e.target.value}))}>
                {['pcs','m','kg','litre','tonne','box','bundle','set','roll','sheet'].map(u=><option key={u}>{u}</option>)}
              </select>
            </FG>
            <FG label="Reorder Point" hint="Alert when on-hand drops to or below this"><input type="number" style={{ padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%' }} value={newItem.reorderPoint||''} onChange={e=>setNewItem(p=>({...p,reorderPoint:e.target.value}))} /></FG>
            <FG label="Opening Quantity" hint="Initial stock on hand (optional)"><input type="number" style={{ padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%' }} value={newItem.openingQty||''} onChange={e=>setNewItem(p=>({...p,openingQty:e.target.value}))} /></FG>
            <FG label="Opening Unit Cost (₦)" hint="Cost per {uom} of the opening balance"><input type="number" style={{ padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%' }} value={newItem.openingCost||''} onChange={e=>setNewItem(p=>({...p,openingCost:e.target.value}))} /></FG>
          </div>
          <div style={{ marginTop:14, padding:'10px 14px', background:C.greenPale, borderRadius:8, fontSize:12, color:C.textMid }}>
            💡 The opening balance is posted as a RECEIVE movement, so the on-hand quantity and weighted-average cost start from your real figures on day one. The costing engine (FIFO + weighted-average) lives in <code style={{fontFamily:'monospace'}}>utils/inventoryModel.js</code>.
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:14 }}>
            <Btn variant="ghost" onClick={() => setView('list')}>Cancel</Btn>
            <Btn onClick={saveItem}>Register Item</Btn>
          </div>
        </div>
      </div>
    );
  }

  // ── View: list of items with KPIs and reorder alerts ──
  const totalValue = stockItems.reduce((s,i) => s + (itemSummary(i).value || 0), 0);
  const totalUnits = stockItems.reduce((s,i) => s + (itemSummary(i).qty || 0), 0);
  const lowStock   = stockItems.filter(i => itemSummary(i).reorderAlert).length;
  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10, marginBottom:14 }}>
        <div style={{ padding:'12px 16px', background:C.greenPale, borderRadius:8, borderLeft:'4px solid '+C.green }}>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>Stock Items</div>
          <div style={{ fontSize:22, fontWeight:700, color:C.green }}>{stockItems.length}</div>
        </div>
        <div style={{ padding:'12px 16px', background:C.greenPale, borderRadius:8, borderLeft:'4px solid '+C.info }}>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>Total Units On Hand</div>
          <div style={{ fontSize:22, fontWeight:700, color:C.info }}>{totalUnits.toLocaleString('en-NG')}</div>
        </div>
        <div style={{ padding:'12px 16px', background:C.greenPale, borderRadius:8, borderLeft:'4px solid '+C.amber }}>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>Total Stock Value</div>
          <div style={{ fontSize:22, fontWeight:700, color:C.amber }}>₦{totalValue.toLocaleString('en-NG',{maximumFractionDigits:0})}</div>
        </div>
        <div style={{ padding:'12px 16px', background: lowStock>0 ? 'rgba(192,57,43,.08)' : C.bgAlt, borderRadius:8, borderLeft:'4px solid '+(lowStock>0?C.danger:C.border) }}>
          <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>Below Reorder Point</div>
          <div style={{ fontSize:22, fontWeight:700, color: lowStock>0 ? C.danger : C.text }}>{lowStock}</div>
        </div>
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.text }}>Stock Register</div>
        <Btn onClick={() => setView('new')}>+ Register Stock Item</Btn>
      </div>
      {stockItems.length === 0 ? (
        <div style={{ padding:32, textAlign:'center', color:C.textMuted, background:C.bgCard, borderRadius:10, border:'1px dashed '+C.border, fontSize:12 }}>
          No stock items yet. Click <strong>Register Stock Item</strong> to add your first SKU. The costing engine (FIFO + weighted-average) is built in — once you have movements, you'll see real stock valuation and reorder alerts here.
        </div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, background:C.bgCard, border:'1px solid '+C.border, borderRadius:8, overflow:'hidden' }}>
          <thead><tr style={{ background:C.greenPale }}>
            {['Code','Name','Category','UoM','On Hand','Avg Cost','Stock Value','Reorder','Movements',''].map(h=><th key={h} style={{ padding:'8px 10px', textAlign:'left', fontSize:10, fontWeight:700, color:C.textMid, textTransform:'uppercase' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {stockItems.map(item => {
              const s = itemSummary(item);
              return (
                <tr key={item.id} style={{ borderBottom:'1px solid '+C.borderLight, cursor:'pointer' }} onClick={() => { setSelItem(item); setView('detail'); }}>
                  <td style={{ padding:'8px 10px', fontFamily:'monospace', color:C.green, fontWeight:700 }}>{item.code}</td>
                  <td style={{ padding:'8px 10px' }}>{item.name}</td>
                  <td style={{ padding:'8px 10px', color:C.textMuted, fontSize:11 }}>{item.category||'—'}</td>
                  <td style={{ padding:'8px 10px', color:C.textMuted }}>{item.uom}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:600, color: s.reorderAlert ? C.danger : C.text }}>{s.qty.toLocaleString('en-NG')}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', color:C.amber }}>₦{s.avgCost.toLocaleString('en-NG',{maximumFractionDigits:2})}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontWeight:600, color:C.info }}>₦{s.value.toLocaleString('en-NG',{maximumFractionDigits:0})}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>{item.reorderPoint || '—'}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', color:C.textMuted }}>{s.movementCount}</td>
                  <td style={{ padding:'8px 10px' }}>
                    {s.reorderAlert && <span style={{ padding:'2px 7px', borderRadius:20, fontSize:10, fontWeight:600, color:C.danger, background:'rgba(192,57,43,.1)' }}>⚠ Reorder</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function InvModal({ tab, modal, onSave, onClose }) {
  const { C } = useTheme();
  const [f, setF] = useState(modal.data);
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  const isEdit = modal.mode === 'edit';
  const titles = { vehicles:'Vehicle', heavy:'Heavy Equipment / Trailer', materials:'Construction Material', office:'Office Equipment / Furniture' };
  const inp = { padding: '7px 10px', borderRadius: 7, border: '1px solid ' + C.border, background: C.bgCard, color: C.text, fontSize: 13, width: '100%', outline: 'none', fontFamily: 'inherit' };

  return (
    <Modal title={(isEdit ? 'Edit ' : 'Add ') + titles[tab]} onClose={onClose} maxWidth={500}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={() => onSave(f)}>{isEdit ? 'Update Item' : 'Save Item'}</Btn></>}
    >
      {tab === 'vehicles' && <FormGrid>
        <FG label="Vehicle Plate Number" full><input style={inp} value={f.vehicleNumber} onChange={set('vehicleNumber')} placeholder="e.g. PH-458-AHZ" /></FG>
        <FG label="Vehicle Make / Model" full><input style={inp} value={f.make} onChange={set('make')} placeholder="e.g. Toyota Hilux D4D" /></FG>
        <FG label="Year of Purchase"><input style={inp} value={f.yearOfPurchase} onChange={set('yearOfPurchase')} type="number" placeholder="e.g. 2022" /></FG>
        <FG label="Unit Serving"><input style={inp} value={f.unitServing} onChange={set('unitServing')} placeholder="e.g. Operations" /></FG>
      </FormGrid>}
      {tab === 'heavy' && <FormGrid>
        <FG label="Registration Number" full><input style={inp} value={f.regNumber||''} onChange={set('regNumber')} placeholder="e.g. AAA-123-XY" /></FG>
        <FG label="Equipment / Vehicle Name" full><input style={inp} value={f.name||''} onChange={set('name')} placeholder="e.g. Lexus LX570, Caterpillar 320D, Toyota Hilux" /></FG>
        <FG label="Make / Model"><input style={inp} value={f.make||''} onChange={set('make')} placeholder="e.g. Caterpillar, Toyota, Volvo" /></FG>
        <FG label="Company Number"><input style={inp} value={f.companyNumber||''} onChange={set('companyNumber')} placeholder="Internal company ID" /></FG>
        <FG label="Status"><select style={inp} value={f.status||f.remark||'Operational'} onChange={set('status')}>
          {['Operational','Under Maintenance','Off Road','Decommissioned','On Hire'].map(s=><option key={s}>{s}</option>)}
        </select></FG>
      </FormGrid>}
      {tab === 'materials' && <FormGrid>
        <FG label="Name of Material" full><input style={inp} value={f.name} onChange={set('name')} placeholder="e.g. Reinforcement Steel (16mm)" /></FG>
        <FG label="Quantity"><input style={inp} value={f.quantity} onChange={set('quantity')} placeholder="e.g. 500 tonnes" /></FG>
        <FG label="Position / Location"><input style={inp} value={f.position} onChange={set('position')} placeholder="e.g. Yard A – Bay 3" /></FG>
        <FG label="Status"><select style={inp} value={f.status} onChange={set('status')}>{MAT_STATUSES.map(s=><option key={s}>{s}</option>)}</select></FG>
      </FormGrid>}
      {tab === 'office' && <FormGrid>
        <FG label="Detail / Description" full><input style={inp} value={f.description} onChange={set('description')} placeholder="e.g. Dell Latitude 5520 Laptop" /></FG>
        <FG label="Office ID"><input style={inp} value={f.officeId} onChange={set('officeId')} placeholder="e.g. OFC-LPT-005" /></FG>
        <FG label="Location"><input style={inp} value={f.location} onChange={set('location')} placeholder="e.g. Port Harcourt HQ" /></FG>
        <FG label="Status"><select style={inp} value={f.status} onChange={set('status')}>{OFFICE_STATUSES.map(s=><option key={s}>{s}</option>)}</select></FG>
      </FormGrid>}
    </Modal>
  );
}
