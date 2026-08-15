// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — FIXED ASSETS MODULE v1.0
// Asset register · straight-line depreciation · disposal · tagging · print
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo }    from '../../utils/auth';
import { showToast, formatDate, generateId } from '../../utils/helpers'; // auto-patched
import { getDeepLinkTab } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { printHeader, PRINT_CSS, printBootstrap, openPrintWindow} from '../../utils/logo';
import { diffAndPush } from '../../hooks/usePerRecordSync';

const uid   = () => generateId();
const today = () => new Date().toISOString().split('T')[0];
const year  = () => new Date().getFullYear();
// 2026-08-15: maximumFractionDigits wasn't set, so it defaulted to 3 —
// a depreciation figure with 3 decimals (e.g. ₦1,234.567) would print as-is
// instead of rounding to kobo like every other module's fmt().
const fmt   = n => '₦' + (Number(n)||0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function nextTag(list, cat) {
  const prefix = { 'Plant & Equipment':'PE', 'Motor Vehicle':'MV', 'Office Equipment':'OE', 'Furniture & Fittings':'FF', 'Land & Building':'LB', 'IT Equipment':'IT', 'Tools & Machinery':'TM' }[cat]||'FA';
  const nums = list.filter(a=>a.assetTag?.startsWith(prefix)).map(a=>parseInt((a.assetTag||'0').replace(/\D/g,''),10)).filter(Boolean);
  return `SLOT-${prefix}-${String(nums.length?Math.max(...nums)+1:1).padStart(4,'0')}`;
}

const CATEGORIES   = ['Plant & Equipment','Motor Vehicle','Office Equipment','Furniture & Fittings','Land & Building','IT Equipment','Tools & Machinery'];
const LOCATIONS    = ['Port Harcourt HQ','Bonny Island Site','Warri Site','Abuja Office','Technical Workshop','Warehouse'];
const DEPT_LIST    = ['Engineering','Operations','Admin','Finance','Procurement','HSE','IT','Logistics'];
const COND_LIST    = ['Excellent','Good','Fair','Poor','Under Maintenance','Disposed'];
const USEFUL_LIVES = { 'Plant & Equipment':10, 'Motor Vehicle':5, 'Office Equipment':5, 'Furniture & Fittings':10, 'Land & Building':40, 'IT Equipment':3, 'Tools & Machinery':7 };

function calcDepreciation(cost, residual, usefulLife, purchaseDate) {
  const cost_ = Number(cost)||0;
  const res_  = Number(residual)||0;
  const ul_   = Number(usefulLife)||5;
  const annualDep = (cost_ - res_) / ul_;
  let months = 0;
  if (purchaseDate) {
    const start = new Date(purchaseDate);
    const now   = new Date();
    months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  }
  const accDep = Math.min(annualDep * (months / 12), cost_ - res_);
  return { annualDep, accDep: Math.max(0, accDep), nbv: Math.max(res_, cost_ - accDep) };
}

// 2026-07-29 — seed fallback removed permanently (was already emptied
// 2026-07-28, having held five fabricated fixed assets totalling ₦109.88m of
// invented cost). See App.jsx boot-sequence note.

function Tag({ status }) {
  const { C } = useTheme();
  const m = { Active:[C.success,'rgba(26,122,74,.12)'], Disposed:['#6B7280','rgba(107,114,128,.12)'], 'Under Maintenance':[C.warning,'rgba(201,122,10,.12)'], Transferred:[C.info,'rgba(26,92,138,.12)'] };
  const [c,bg] = m[status]||['#6B7280','rgba(107,114,128,.12)'];
  return <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:500, color:c, background:bg, border:`1px solid ${c}30`, whiteSpace:'nowrap' }}>{status}</span>;
}

function Btn({ children, onClick, variant='primary', sm, disabled, style={} }) {
  const { C } = useTheme();
  const V = { primary:{bg:C.green,co:'#fff',b:'none'}, ghost:{bg:'transparent',co:C.textMid,b:'1px solid '+C.border}, danger:{bg:C.danger,co:'#fff',b:'none'}, amber:{bg:C.amber,co:'#fff',b:'none'}, outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green} }[variant]||{};
  return <button onClick={onClick} disabled={disabled} style={{ background:V.bg, color:V.co, border:V.b, borderRadius:7, padding:sm?'4px 11px':'7px 16px', fontSize:sm?11.5:13, fontWeight:500, cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1, display:'inline-flex', alignItems:'center', gap:5, whiteSpace:'nowrap', ...style }}>{children}</button>;
}

function KPI({ label, value, sub, accent }) {
  const { C } = useTheme();
  const c = accent || C.green;
  return (
    <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'13px 15px', flex:1, minWidth:140, position:'relative', boxShadow:C.shadowCard }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4, background:c, borderRadius:'12px 0 0 12px' }} />
      <div style={{ paddingLeft:8 }}>
        <div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:4 }}>{label}</div>
        <div style={{ fontSize:18, fontWeight:700, color:c, lineHeight:1 }}>{value}</div>
        {sub && <div style={{ fontSize:11, color:C.textMuted, marginTop:3 }}>{sub}</div>}
      </div>
    </div>
  );
}

function FG({ label, full, children }) {
  const { C } = useTheme();
  return <div style={{ display:'flex', flexDirection:'column', gap:4, gridColumn:full?'1/-1':undefined }}><label style={{ fontSize:11, fontWeight:600, color:C.textMid }}>{label}</label>{children}</div>;
}

function Overlay({ children, onClose }) {
  // 2026-08-15: backdrop no longer closes the form on click — see same fix
  // in ui/index.jsx's shared Modal and Procurement.jsx's Overlay.
  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'100%', maxWidth:780, marginBottom:32 }}>{children}</div>
    </div>
  );
}

function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'18px 20px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}

function printRegister(assets) {
  const totalCost = assets.reduce((a,x)=>a+(Number(x.cost)||0),0);
  const totalNBV  = assets.reduce((a,x)=>{ const d=calcDepreciation(x.cost,x.residualValue,x.usefulLifeYrs,x.purchaseDate); return a+d.nbv; },0);
  const rows = assets.map((a,i)=>{
    const d = calcDepreciation(a.cost,a.residualValue,a.usefulLifeYrs,a.purchaseDate);
    return `<tr style="background:${i%2===1?'#f3faf5':'#fff'}">
      <td>${a.assetTag}</td><td>${a.description}</td><td>${a.category}</td>
      <td>${formatDate(a.purchaseDate)}</td><td style="text-align:right">₦${(Number(a.cost)||0).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:right">₦${d.accDep.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="text-align:right;font-weight:700;color:#1A5C2A">₦${d.nbv.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td>${a.location}</td><td>${a.condition}</td><td>${a.status}</td>
    </tr>`;
  }).join('');
  openPrintWindow(`<!DOCTYPE html><html><head><title>Fixed Asset Register</title><style>${PRINT_CSS}</style></head><body>
  ${printHeader('FIXED ASSET REGISTER', `As at ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})}`)}
  <table><thead><tr><th>Tag</th><th>Description</th><th>Category</th><th>Purchase Date</th><th style="text-align:right">Cost</th><th style="text-align:right">Acc. Dep.</th><th style="text-align:right">NBV</th><th>Location</th><th>Condition</th><th>Status</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr class="total-row"><td colspan="4" style="text-align:right;font-size:10px;text-transform:uppercase">Totals</td><td style="text-align:right">₦${totalCost.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td></td><td style="text-align:right">₦${totalNBV.toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td colspan="3"></td></tr></tfoot>
  </table>
  ${printBootstrap({landscape:false})}</body></html>`);
}

export default function FixedAssets() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db } = state;
  const perms = { add: canDo(currentUser,'canAdd'), del: canDo(currentUser,'canDelete') };

  const stored = db.fixedassets || [];
  const [assets, setAssets] = useState(stored);

  const save = (data) => {
    diffAndPush('fixedassets', assets, data); // 2026-07-29 full-app sync sweep
    setAssets(data);
    dispatch({ type:'UPDATE_MODULE', mod:'fixedassets', data });
    saveDBLocal({ ...db, fixedassets: data }, state.activity);
  };

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };
  const th  = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td  = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const [search, setSearch]   = useState('');
  const [catFilter, setCat]   = useState('all');
  const [tab, setTab] = useState(() => getDeepLinkTab('fixedassets', 'register'));
  const [modal, setModal]     = useState(null);
  const [sel2, setSel2]       = useState(null);
  const [delId, setDelId]     = useState(null);
  // Depreciation posting — period picker state
  const [depPost, setDepPost] = useState(() => ({
    year:  new Date().getFullYear(),
    month: new Date().getMonth() + 1,
  }));

  const EMPTY = { description:'', category:'Plant & Equipment', serialNo:'', location:'Port Harcourt HQ', department:'Engineering', purchaseDate:'', cost:'', residualValue:'', usefulLifeYrs:10, condition:'Excellent', assignedTo:'', notes:'' };
  const [form, setForm] = useState(EMPTY);

  const withDepreciation = useMemo(() => assets.filter(a=>!a.voided).map(a => {
    const d = calcDepreciation(a.cost, a.residualValue, a.usefulLifeYrs, a.purchaseDate);
    return { ...a, ...d };
  }), [assets]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return withDepreciation.filter(a => {
      const matchSearch = !s || a.description.toLowerCase().includes(s) || a.assetTag?.toLowerCase().includes(s) || a.serialNo?.toLowerCase().includes(s);
      const matchCat    = catFilter === 'all' || a.category === catFilter;
      return matchSearch && matchCat;
    });
  }, [withDepreciation, search, catFilter]);

  const totals = useMemo(() => ({
    cost:   withDepreciation.reduce((a,x)=>a+(Number(x.cost)||0),0),
    accDep: withDepreciation.reduce((a,x)=>a+x.accDep,0),
    nbv:    withDepreciation.reduce((a,x)=>a+x.nbv,0),
    count:  assets.filter(a=>!a.voided&&a.status==='Active').length,
  }), [withDepreciation, assets]);

  function handleSave() {
    if (!form.description.trim()) { showToast('Description is required','error'); return; }
    if (!form.purchaseDate)       { showToast('Purchase date is required','error'); return; }
    if (!form.cost || Number(form.cost) <= 0) { showToast('Enter cost','error'); return; }
    const ul = form.usefulLifeYrs || USEFUL_LIVES[form.category] || 5;
    const rec = { id:uid(), assetTag:nextTag(assets, form.category), ...form, cost:Number(form.cost), residualValue:Number(form.residualValue)||0, usefulLifeYrs:Number(ul), status:'Active', createdAt:new Date().toISOString() };
    save([...assets, rec]);
    logActivity(dispatch, `Asset ${rec.assetTag} (${rec.description}) registered`, currentUser);
    showToast('Asset registered'); setModal(null); setForm(EMPTY);
  }

  const TABS = [{ key:'register', label:'Asset Register' }, { key:'depreciation', label:'Depreciation Schedule' }];

  const depByCategory = useMemo(() => {
    const map = {};
    CATEGORIES.forEach(c => { map[c] = { count:0, cost:0, accDep:0, nbv:0 }; });
    withDepreciation.forEach(a => {
      if (map[a.category]) {
        map[a.category].count++;
        map[a.category].cost  += Number(a.cost)||0;
        map[a.category].accDep += a.accDep;
        map[a.category].nbv   += a.nbv;
      }
    });
    return map;
  }, [withDepreciation]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Fixed Assets</div>
          <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>Asset register · depreciation · NBV tracking</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Btn variant="ghost" onClick={()=>printRegister(withDepreciation)}>🖨 Print Register</Btn>
          {perms.add && <Btn onClick={()=>{ setForm(EMPTY); setModal('add'); }}>+ Register Asset</Btn>}
        </div>
      </div>

      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <KPI label="Active Assets" value={totals.count} sub={`${assets.length} total`} />
        <KPI label="Total Cost" value={fmt(totals.cost)} sub="acquisition value" />
        <KPI label="Accumulated Dep." value={fmt(totals.accDep)} accent={C.amber} sub="total depreciated" />
        <KPI label="Net Book Value" value={fmt(totals.nbv)} accent={C.info} sub="current book value" />
      </div>

      <div style={{ display:'flex', borderBottom:'2px solid '+C.borderLight }}>
        {TABS.map(t => <button key={t.key} onClick={()=>setTab(t.key)} style={{ padding:'9px 18px', fontSize:13, border:'none', background:'none', cursor:'pointer', fontWeight:tab===t.key?700:400, color:tab===t.key?C.green:C.textMuted, borderBottom:tab===t.key?'2px solid '+C.green:'2px solid transparent', marginBottom:-2, whiteSpace:'nowrap' }}>{t.label}</button>)}
      </div>

      {tab === 'register' && (
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px', borderBottom:'1px solid '+C.borderLight, flexWrap:'wrap' }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search description, tag, serial no…" style={{ ...inp, maxWidth:280 }} />
            <select value={catFilter} onChange={e=>setCat(e.target.value)} style={{ ...inp, width:'auto' }}>
              <option value="all">All Categories</option>
              {CATEGORIES.map(c=><option key={c}>{c}</option>)}
            </select>
            <div style={{ marginLeft:'auto', fontSize:11, color:C.textMuted }}>{filtered.length} assets</div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead><tr>
                {['Asset Tag','Description','Category','Purchase Date','Cost','Acc. Dep.','NBV','Location','Condition','Status',''].map(h=><th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={11} style={{ ...td, textAlign:'center', padding:36, color:C.textMuted }}>No assets found</td></tr>}
                {filtered.map(a => (
                  <tr key={a.id} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                    <td style={td}><span style={{ fontWeight:700, color:C.green, fontFamily:'monospace', fontSize:12 }}>{a.assetTag}</span></td>
                    <td style={td}><div style={{ fontWeight:600 }}>{a.description}</div><div style={{ fontSize:11, color:C.textMuted }}>{a.department}</div></td>
                    <td style={{ ...td, fontSize:11.5 }}>{a.category}</td>
                    <td style={td}>{formatDate(a.purchaseDate)}</td>
                    <td style={{ ...td, fontWeight:600 }}>{fmt(a.cost)}</td>
                    <td style={{ ...td, color:C.amber }}>{fmt(a.accDep)}</td>
                    <td style={{ ...td, fontWeight:700, color:C.success }}>{fmt(a.nbv)}</td>
                    <td style={{ ...td, fontSize:11.5, color:C.textMid }}>{a.location}</td>
                    <td style={td}>{a.condition}</td>
                    <td style={td}><Tag status={a.status} /></td>
                    <td style={td}>
                      <div style={{ display:'flex', gap:5 }}>
                        <Btn sm variant="ghost" onClick={()=>{ setSel2(a); setModal('view'); }}>View</Btn>
                        {perms.del && <Btn sm variant="danger" onClick={()=>setDelId(a.id)}>✕</Btn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'depreciation' && (() => {
        // ── Post monthly depreciation to the GL ───────────────────────────
        // 1. User picks a period (YYYY-MM, default = current month).
        // 2. For every active, non-Land, non-voided asset, compute the
        //    monthly depreciation charge for that period.
        // 3. Only include periods that have NOT already been posted
        //    (idempotent — re-running the same month is a no-op).
        // 4. Cap each asset's charge at its remaining depreciable balance
        //    (cost - residual - already-posted) so we never over-dep.
        // 5. On confirm: append to each asset's `depreciationPosted` list.
        //    The Accounting.jsx auto-post effect will then create the
        //    Dr 9001 / Cr Accumulated Depreciation journal entries.
        const periodKey = `${depPost.year}-${String(depPost.month).padStart(2,'0')}`;
        const monthName = new Date(depPost.year, depPost.month - 1, 1).toLocaleDateString('en-GB',{month:'long'});
        const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

        // Compute charge for one asset in a given periodKey
        const computeCharge = (asset, pKey) => {
          if (asset.voided) return 0;
          if (asset.status && asset.status !== 'Active') return 0;
          if (asset.category === 'Land' || asset.category === '2000') return 0;
          const cost = Number(asset.cost) || 0;
          const res  = Number(asset.residualValue) || 0;
          const ul   = Number(asset.usefulLifeYrs) || USEFUL_LIVES[asset.category] || 5;
          if (cost <= 0 || ul <= 0) return 0;
          if (!asset.purchaseDate) return 0;
          // Don't post depreciation for periods before the asset existed
          const purchaseYm = asset.purchaseDate.slice(0,7);
          if (pKey < purchaseYm) return 0;
          const annualDep = (cost - res) / ul;
          const monthlyDep = annualDep / 12;
          // Don't post past the asset's end-of-life
          const totalMonths = ul * 12;
          const monthsFromPurchase = (Number(pKey.slice(0,4)) - Number(purchaseYm.slice(0,4))) * 12
                                   + (Number(pKey.slice(5,7)) - Number(purchaseYm.slice(5,7))) + 1;
          if (monthsFromPurchase > totalMonths) return 0;
          // Cap at remaining depreciable balance
          const alreadyPosted = (asset.depreciationPosted || [])
            .filter(e => e && e.periodKey)
            .reduce((s,e) => s + (Number(e.amount) || 0), 0);
          const remaining = Math.max(0, (cost - res) - alreadyPosted);
          return Math.min(monthlyDep, remaining);
        };

        const previewList = withDepreciation
          .filter(a => !a.voided && a.status === 'Active' && a.category !== 'Land')
          .map(a => {
            const already = (a.depreciationPosted || []).some(e => e && e.periodKey === periodKey);
            const charge   = already ? 0 : computeCharge(a, periodKey);
            return { ...a, charge, already };
          })
          .filter(a => a.charge > 0 || a.already);
        const totalNewCharge = previewList.reduce((s,a) => s + (a.already ? 0 : a.charge), 0);
        const skippedCount   = previewList.filter(a => a.already).length;
        const eligibleCount  = previewList.filter(a => !a.already && a.charge > 0).length;

        function handlePostDepreciation() {
          if (eligibleCount === 0) { showToast('Nothing new to post for this period', 'error'); return; }
          if (!window.confirm(`Post monthly depreciation for ${monthName} ${depPost.year}? ${eligibleCount} asset(s) will hit P&L and Accumulated Depreciation for a total of ${fmt(totalNewCharge)}.`)) return;
          const stamp = new Date().toISOString();
          const next = assets.map(a => {
            if (a.voided || a.status !== 'Active' || a.category === 'Land') return a;
            const charge = computeCharge(a, periodKey);
            if (charge <= 0) return a;
            if ((a.depreciationPosted || []).some(e => e && e.periodKey === periodKey)) return a;
            return {
              ...a,
              depreciationPosted: [
                ...(a.depreciationPosted || []),
                { periodKey, amount: charge, postedDate: stamp, postedBy: currentUser?.name || 'system' },
              ],
            };
          });
          save(next);
          logActivity(dispatch, `Posted depreciation for ${monthName} ${depPost.year} — ${eligibleCount} asset(s), total ${fmt(totalNewCharge)}`, currentUser, { module:'fixedassets', action:'edit' });
          showToast(`Depreciation posted: ${fmt(totalNewCharge)} (${eligibleCount} asset${eligibleCount===1?'':'s'})`, 'success');
        }

        return (
          <>
            <Card>
              <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:16 }}>Depreciation by Category — As at {new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})}</div>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>
                  {['Category','Assets','Total Cost','Annual Dep.','Acc. Dep.','Net Book Value','Dep. %'].map(h=><th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {CATEGORIES.map(cat => {
                    const row = depByCategory[cat];
                    if (!row.count) return null;
                    const annualDep = row.cost > 0 ? (row.cost - assets.filter(a=>!a.voided&&a.category===cat).reduce((s,a)=>s+(Number(a.residualValue)||0),0)) / (USEFUL_LIVES[cat]||5) : 0;
                    const depPct = row.cost > 0 ? Math.round((row.accDep / row.cost) * 100) : 0;
                    return (
                      <tr key={cat} onMouseEnter={e=>e.currentTarget.style.background=C.greenPale2} onMouseLeave={e=>e.currentTarget.style.background=''}>
                        <td style={td}><strong>{cat}</strong></td>
                        <td style={td}>{row.count}</td>
                        <td style={{ ...td, fontWeight:600 }}>{fmt(row.cost)}</td>
                        <td style={{ ...td, color:C.amber }}>{fmt(annualDep)}</td>
                        <td style={{ ...td, color:C.amber }}>{fmt(row.accDep)}</td>
                        <td style={{ ...td, fontWeight:700, color:C.success }}>{fmt(row.nbv)}</td>
                        <td style={td}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <div style={{ flex:1, background:C.greenPale, borderRadius:20, height:6 }}><div style={{ width:`${depPct}%`, height:'100%', background:depPct>75?C.danger:depPct>50?C.warning:C.success, borderRadius:20 }}/></div>
                            <span style={{ fontSize:11, fontWeight:600, color:C.textMid, minWidth:32 }}>{depPct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background:C.greenPale }}>
                    <td style={{ ...td, fontWeight:700 }}>TOTALS</td>
                    <td style={{ ...td, fontWeight:700 }}>{assets.length}</td>
                    <td style={{ ...td, fontWeight:700 }}>{fmt(totals.cost)}</td>
                    <td style={td}></td>
                    <td style={{ ...td, fontWeight:700, color:C.amber }}>{fmt(totals.accDep)}</td>
                    <td style={{ ...td, fontWeight:700, color:C.success }}>{fmt(totals.nbv)}</td>
                    <td style={td}></td>
                  </tr>
                </tfoot>
              </table>
            </Card>

            <Card style={{ marginTop:14 }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:4 }}>📅 Post Periodic Depreciation to GL</div>
              <div style={{ fontSize:11.5, color:C.textMuted, marginBottom:14, lineHeight:1.6 }}>
                Computes one month of depreciation for every active, depreciable asset and posts it to
                the General Ledger as <code style={{ fontFamily:'monospace', background:C.greenPale, padding:'1px 5px', borderRadius:4 }}>Dr 9001 Depreciation Charges / Cr Accumulated Depreciation</code>.
                Already-posted periods are skipped — re-running the same month is a no-op. The
                charge for each asset is capped at its remaining depreciable balance so we never
                over-depreciate past residual value. Land is excluded.
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14, alignItems:'end', marginBottom:14 }}>
                <FG label="Year">
                  <select style={inp} value={depPost.year} onChange={e=>setDepPost(p=>({...p,year:Number(e.target.value)}))}>
                    {[depPost.year-2, depPost.year-1, depPost.year, depPost.year+1].map(y=><option key={y} value={y}>{y}</option>)}
                  </select>
                </FG>
                <FG label="Month">
                  <select style={inp} value={depPost.month} onChange={e=>setDepPost(p=>({...p,month:Number(e.target.value)}))}>
                    {monthNames.map((m,i)=><option key={m} value={i+1}>{m}</option>)}
                  </select>
                </FG>
                <div>
                  <Btn onClick={handlePostDepreciation} disabled={eligibleCount===0}>
                    📤 Post {monthName} {depPost.year} Depreciation ({eligibleCount})
                  </Btn>
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:14 }}>
                <div style={{ padding:'10px 14px', background:C.greenPale, borderRadius:8, borderLeft:'4px solid '+C.green }}>
                  <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>Eligible Assets</div>
                  <div style={{ fontSize:18, fontWeight:700, color:C.green }}>{eligibleCount}</div>
                </div>
                <div style={{ padding:'10px 14px', background:C.bgAlt, borderRadius:8, borderLeft:'4px solid '+C.amber }}>
                  <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>Already Posted</div>
                  <div style={{ fontSize:18, fontWeight:700, color:C.amber }}>{skippedCount}</div>
                </div>
                <div style={{ padding:'10px 14px', background:C.greenPale, borderRadius:8, borderLeft:'4px solid '+C.amber }}>
                  <div style={{ fontSize:10, color:C.textMuted, fontWeight:600, textTransform:'uppercase' }}>Total Charge</div>
                  <div style={{ fontSize:18, fontWeight:700, color:C.amber }}>{fmt(totalNewCharge)}</div>
                </div>
              </div>

              {previewList.length > 0 && (
                <div style={{ maxHeight:280, overflowY:'auto', border:'1px solid '+C.border, borderRadius:8 }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead style={{ position:'sticky', top:0, background:C.bgCard, zIndex:1 }}>
                      <tr>
                        {['Asset Tag','Description','Category','Cost','Annual Dep.','Charge This Period','Status',''].map(h=><th key={h} style={th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {previewList.map(a => (
                        <tr key={a.id}>
                          <td style={{ ...td, fontFamily:'monospace', color:C.green, fontWeight:700 }}>{a.assetTag}</td>
                          <td style={td}>{a.description}</td>
                          <td style={{ ...td, fontSize:11, color:C.textMuted }}>{a.category}</td>
                          <td style={{ ...td, textAlign:'right' }}>{fmt(a.cost)}</td>
                          <td style={{ ...td, textAlign:'right', color:C.amber }}>{fmt(a.annualDep)}</td>
                          <td style={{ ...td, textAlign:'right', fontWeight:700, color: a.already?C.textMuted:C.amber }}>{fmt(a.charge)}</td>
                          <td style={td}>
                            {a.already
                              ? <span style={{ padding:'2px 9px', borderRadius:20, background:C.amberPale, color:C.amber, fontSize:11, fontWeight:600 }}>✓ Already Posted</span>
                              : <span style={{ padding:'2px 9px', borderRadius:20, background:C.greenPale, color:C.success, fontSize:11, fontWeight:600 }}>● Pending</span>}
                          </td>
                          <td style={td}>
                            {(a.depreciationPosted || []).length > 0 && (
                              <span style={{ fontSize:10, color:C.textMuted }}>
                                {(a.depreciationPosted || []).length} period{(a.depreciationPosted || []).length===1?'':'s'} posted · total {fmt((a.depreciationPosted || []).reduce((s,e)=>s+(Number(e.amount)||0),0))}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {previewList.length === 0 && (
                <div style={{ padding:24, textAlign:'center', color:C.textMuted, fontSize:12 }}>
                  No active depreciable assets found. Register an asset first to enable periodic depreciation.
                </div>
              )}

              <div style={{ marginTop:14, padding:'10px 14px', background:'rgba(26,92,138,.08)', border:'1px solid rgba(26,92,138,.2)', borderLeft:'4px solid '+C.info, borderRadius:8, fontSize:12, color:C.info, lineHeight:1.6 }}>
                💡 <strong>Why this matters:</strong> Without periodic depreciation, your P&L never shows the
                depreciation expense, and your Balance Sheet never reflects growing Accumulated Depreciation.
                Sage does this every month automatically; this panel gives you the same one-click month-end
                posting. Periods that are already posted are safe to re-run — they're skipped automatically.
              </div>
            </Card>
          </>
        );
      })()}

      {modal === 'add' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, paddingBottom:14, borderBottom:'1px solid '+C.borderLight }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>Register New Asset</div>
              <button onClick={()=>setModal(null)} style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>&times;</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <FG label="Description *" full><input style={inp} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Full asset description" /></FG>
              <FG label="Category"><select style={inp} value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value,usefulLifeYrs:USEFUL_LIVES[e.target.value]||5}))}>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></FG>
              <FG label="Serial / Chassis No."><input style={inp} value={form.serialNo} onChange={e=>setForm(f=>({...f,serialNo:e.target.value}))} placeholder="Manufacturer serial number" /></FG>
              <FG label="Purchase Date *"><input type="date" style={inp} value={form.purchaseDate} onChange={e=>setForm(f=>({...f,purchaseDate:e.target.value}))} /></FG>
              <FG label="Cost (₦) *"><input type="number" style={inp} value={form.cost} onChange={e=>setForm(f=>({...f,cost:e.target.value}))} placeholder="Acquisition cost" /></FG>
              <FG label="Residual / Scrap Value (₦)"><input type="number" style={inp} value={form.residualValue} onChange={e=>setForm(f=>({...f,residualValue:e.target.value}))} placeholder="Expected residual value" /></FG>
              <FG label="Useful Life (Years)"><input type="number" style={inp} value={form.usefulLifeYrs} onChange={e=>setForm(f=>({...f,usefulLifeYrs:e.target.value}))} min="1" max="50" /></FG>
              <FG label="Condition"><select style={inp} value={form.condition} onChange={e=>setForm(f=>({...f,condition:e.target.value}))}>{COND_LIST.map(c=><option key={c}>{c}</option>)}</select></FG>
              <FG label="Location"><select style={inp} value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))}>{LOCATIONS.map(l=><option key={l}>{l}</option>)}</select></FG>
              <FG label="Department"><select style={inp} value={form.department} onChange={e=>setForm(f=>({...f,department:e.target.value}))}>{DEPT_LIST.map(d=><option key={d}>{d}</option>)}</select></FG>
              <FG label="Assigned To"><input style={inp} value={form.assignedTo} onChange={e=>setForm(f=>({...f,assignedTo:e.target.value}))} placeholder="Staff or unit" /></FG>
              <FG label="Notes"><input style={inp} value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Additional notes" /></FG>
            </div>
            {form.cost && form.purchaseDate && (
              <div style={{ marginTop:14, padding:'10px 14px', background:C.greenPale, borderRadius:8, fontSize:12, color:C.textMid }}>
                {(() => { const d = calcDepreciation(form.cost, form.residualValue, form.usefulLifeYrs, form.purchaseDate); return `Annual Depreciation: ${fmt(d.annualDep)} · Current NBV: ${fmt(d.nbv)}`; })()}
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20, paddingTop:14, borderTop:'1px solid '+C.borderLight }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSave}>Register Asset</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {modal === 'view' && sel2 && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:14, borderBottom:'1px solid '+C.borderLight }}>
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:C.text }}>{sel2.description}</div>
                <div style={{ fontSize:12, color:C.textMuted, marginTop:2 }}>{sel2.assetTag} · {sel2.category}</div>
              </div>
              <button onClick={()=>setModal(null)} style={{ background:'none', border:'none', fontSize:22, color:C.textMuted, cursor:'pointer' }}>&times;</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14, marginBottom:16 }}>
              {[['Serial No.',sel2.serialNo||'—'],['Purchase Date',formatDate(sel2.purchaseDate)],['Cost',fmt(sel2.cost)],['Residual Value',fmt(sel2.residualValue)],['Useful Life',`${sel2.usefulLifeYrs} years`],['Annual Dep.',fmt(sel2.annualDep)],['Acc. Depreciation',fmt(sel2.accDep)],['Net Book Value',fmt(sel2.nbv)],['Condition',sel2.condition],['Location',sel2.location],['Department',sel2.department],['Assigned To',sel2.assignedTo||'—']].map(([k,v])=>(
                <div key={k}><div style={{ fontSize:10, fontWeight:600, color:C.textMuted, textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:2 }}>{k}</div><div style={{ fontSize:13, fontWeight:500, color:k==='Net Book Value'?C.success:k.includes('Dep')?C.amber:C.text }}>{v}</div></div>
              ))}
            </div>
            {sel2.notes && <div style={{ fontSize:12, color:C.textMuted, marginTop:8 }}><strong>Notes:</strong> {sel2.notes}</div>}
          </Card>
        </Overlay>
      )}

      {delId && (
        <div style={{ position:'fixed', inset:0, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
          <Card style={{ maxWidth:360, textAlign:'center' }}>
            <div style={{ fontSize:30, marginBottom:10 }}>⚠️</div>
            <div style={{ fontSize:15, fontWeight:600, color:C.text, marginBottom:20 }}>Delete this asset record?</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
              <Btn variant="ghost" onClick={()=>setDelId(null)}>Cancel</Btn>
              <Btn variant="danger" onClick={()=>{ save(assets.map(a=>a.id===delId?{...a,voided:true}:a)); showToast('Asset voided'); setDelId(null); }}>Delete</Btn>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
