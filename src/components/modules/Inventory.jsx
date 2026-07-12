import { useState, useMemo, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo } from '../../utils/auth';
import { generateId, showToast } from '../../utils/helpers'; // auto-patched
import { getDeepLinkTab } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity } from '../../utils/audit';
import { Btn, Tag, StatCard, Modal, FG, FormGrid, SectionLabel, SearchBar, TabBar, EmptyState, Confirm } from '../ui';
import { printHeader, SLOT_BRAND, PRINT_CSS } from '../../utils/logo';

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
  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>${label}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#182A1C;padding:24px}table{width:100%;border-collapse:collapse;margin-bottom:16px}th{background:#1A5C2A;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.4px}td{padding:7px 10px;border-bottom:1px solid #EAF0EB;font-size:11px}.footer{margin-top:40px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:40px}.sig{border-top:1px solid #ccc;padding-top:6px;font-size:10px;color:#6E8C74}@media print{body{padding:12px}}</style></head><body>${printHeader(label.toUpperCase(),'Total: '+items.length+' items')}<table><thead><tr>${hdrs}</tr></thead><tbody>${rows}</tbody></table><div class="footer"><div><div class="sig">Prepared By / Date</div></div><div><div class="sig">Reviewed By / Date</div></div><div><div class="sig">Approved By / Date</div></div></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

const TABS = [
  { key: 'vehicles',  label: '(a)  Vehicles' },
  { key: 'heavy',     label: '(b)  Heavy Equipment / Trailers' },
  { key: 'materials', label: '(c)  Construction Materials' },
  { key: 'office',    label: '(d)  Office Appliances / Furniture' },
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
      nextDB = { ...db, vehicles: next };
      dispatch({ type: 'UPDATE_MODULE', mod: 'vehicles', data: next });
    } else {
      const others = (db.inventory||[]).filter(i => i.type !== tab);
      const combined = [...others, ...next];
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
        </div>
      </div>

      {modal  && <InvModal tab={tab} modal={modal} onSave={handleSave} onClose={() => setModal(null)} />}
      {confirm && <Confirm message="Remove this inventory item permanently?" onConfirm={() => handleDelete(confirm)} onCancel={() => setConfirm(null)} />}
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
