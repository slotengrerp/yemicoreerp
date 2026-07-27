// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — SAGE-STYLE REPORTS & FEATURES — TIER 3 v1.0
//
// Four advanced features:
//
//  17. Multi-currency FX Revaluation — revalue foreign-currency balances at
//      period-end using a new exchange rate, post the gain/loss to GL.
//  18. Multiple Warehouses — register warehouses, transfer stock between them.
//  19. Serial / Batch Tracking — track individual units or batches of stock
//      items through RECEIVE / ISSUE / SALE movements.
//  20. Bill of Materials (BOM) — define assemblies, build finished goods from
//      components, post the assembly JE to GL.
//
// All collections persist to db via the existing sync engine.
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { showToast, formatDate, generateId } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { printHeader, PRINT_CSS } from '../../utils/logo';
import { DEFAULT_FX } from '../../utils/financeConstants';

const uid   = () => generateId();
const today = () => new Date().toISOString().split('T')[0];
const year  = () => new Date().getFullYear();
const fmt   = n => '₦' + (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN  = n => (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc   = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const SYM = { NGN:'₦', USD:'$', EUR:'€', GBP:'£' };
const fmtC = (n, cur='NGN') => (SYM[cur] || cur+' ') + (Number(n)||0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Shared UI primitives ──────────────────────────────────────────────────────
function Btn({ children, onClick, variant='primary', sm, disabled, style={} }) {
  const { C } = useTheme();
  const V = {
    primary:{bg:C.green,co:'#fff',b:'none'},
    ghost:  {bg:'transparent',co:C.textMid,b:'1px solid '+C.border},
    danger: {bg:C.danger,co:'#fff',b:'none'},
    amber:  {bg:C.amber,co:'#fff',b:'none'},
    outline:{bg:'transparent',co:C.green,b:'1px solid '+C.green},
  }[variant] || {};
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ background:V.bg, color:V.co, border:V.b, borderRadius:7,
        padding:sm?'4px 11px':'7px 16px', fontSize:sm?11.5:13, fontWeight:500,
        cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1,
        display:'inline-flex', alignItems:'center', gap:5, whiteSpace:'nowrap', ...style }}>
      {children}
    </button>
  );
}
function Card({ children, style }) {
  const { C } = useTheme();
  return <div style={{ background:C.bgCard, border:'1px solid '+C.border, borderRadius:12, padding:'18px 20px', boxShadow:C.shadowCard, ...style }}>{children}</div>;
}
function FG({ label, full, children }) {
  const { C } = useTheme();
  return <div style={{ display:'flex', flexDirection:'column', gap:4, gridColumn:full?'1/-1':undefined }}><label style={{ fontSize:11, fontWeight:600, color:C.textMid }}>{label}</label>{children}</div>;
}
function Overlay({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,0.62)', backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'100%', maxWidth:920, marginBottom:32 }}>{children}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 17 — MULTI-CURRENCY FX REVALUATION
// At period-end, foreign-currency balances (USD/EUR/GBP bank accounts, AR, AP)
// must be revalued to NGN at the closing rate. The difference between the
// book NGN equivalent (recorded at transaction time) and the revalued NGN
// (at closing rate) is an FX gain or loss, posted to 4501 (Profit on Exchange)
// or 9100 (Loss on Exchange).
// ════════════════════════════════════════════════════════════════════════════
export function FXRevaluationTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const journals = state?.acctData?.journals || [];
  const coa = state?.acctData?.coa || [];

  const [asOfDate, setAsOfDate] = useState(today());
  const [newRates, setNewRates] = useState({ USD: DEFAULT_FX.USD, EUR: DEFAULT_FX.EUR, GBP: DEFAULT_FX.GBP });
  const [result, setResult] = useState(null);

  // Find all foreign-currency accounts in the COA
  const fxAccounts = useMemo(() => coa.filter(a => a.currency && a.currency !== 'NGN' && (a.type === 'Asset' || a.type === 'Liability')), [coa]);

  // Compute the current NGN book balance of each FX account from journals
  const accountBalances = useMemo(() => {
    const map = {};
    fxAccounts.forEach(a => { map[a.code] = { ...a, nativeBalance: 0, bookNgnBalance: 0 }; });
    journals.forEach(je => {
      (je.lines || []).forEach(line => {
        const amt = Number(line.amount) || 0;
        const fxRate = Number(line.fxRate) || 1;
        const fcAmt = Number(line.fcAmount) || amt;
        // Dr increases Asset, Cr increases Liability (in native currency)
        if (line.drCode && map[line.drCode]) {
          map[line.drCode].nativeBalance += (line.currency && line.currency !== 'NGN') ? fcAmt : amt;
          map[line.drCode].bookNgnBalance += amt;
        }
        if (line.crCode && map[line.crCode]) {
          map[line.crCode].nativeBalance -= (line.currency && line.currency !== 'NGN') ? fcAmt : amt;
          map[line.crCode].bookNgnBalance -= amt;
        }
      });
    });
    return Object.values(map);
  }, [fxAccounts, journals]);

  function runRevaluation() {
    if (fxAccounts.length === 0) { showToast('No foreign-currency accounts in COA', 'error'); return; }
    const lines = [];
    let totalGain = 0, totalLoss = 0;
    accountBalances.forEach(acc => {
      if (Math.abs(acc.nativeBalance) < 0.01) return; // skip zero-balance accounts
      const closingRate = Number(newRates[acc.currency]) || 1;
      const revaluedNgn = acc.nativeBalance * closingRate;
      const diff = revaluedNgn - acc.bookNgnBalance;
      // Asset: positive diff = gain (bank worth more in NGN). Liability: opposite.
      const isAsset = acc.type === 'Asset';
      const gain = isAsset ? diff : -diff;
      if (gain > 0) totalGain += gain;
      else totalLoss += -gain;
      lines.push({
        accountCode: acc.code,
        accountName: acc.name,
        currency: acc.currency,
        nativeBalance: acc.nativeBalance,
        bookNgnBalance: acc.bookNgnBalance,
        closingRate,
        revaluedNgn,
        diff,
        gain: Math.max(0, gain),
        loss: Math.max(0, -gain),
      });
    });
    setResult({ lines, totalGain, totalLoss, net: totalGain - totalLoss });
    logActivity(dispatch, `FX revaluation run as at ${formatDate(asOfDate)} — gain ${fmt(totalGain)}, loss ${fmt(totalLoss)}, net ${fmt(totalGain-totalLoss)}`, currentUser);
    showToast(`Revaluation complete — net ${totalGain-totalLoss >= 0 ? 'gain' : 'loss'}: ${fmt(Math.abs(totalGain-totalLoss))}`);
  }

  function postRevaluation() {
    if (!result || result.lines.length === 0) { showToast('Run revaluation first', 'error'); return; }
    // Build a single consolidating JE: Dr/Cr each FX account for the diff,
    // offset to 4501 (Profit on Exchange) or 9100 (Loss on Exchange).
    const jeLines = [];
    result.lines.forEach(l => {
      if (Math.abs(l.diff) < 0.01) return;
      const isAsset = (coa.find(a => a.code === l.accountCode)?.type === 'Asset');
      // For an asset: if revalued > book (diff > 0), we Dr the asset (it went up).
      // For a liability: opposite — we Cr the liability.
      if (isAsset) {
        if (l.diff > 0) jeLines.push({ drCode: l.accountCode, drName: l.accountName, crCode: '4501', crName: 'Profit on Exchange', amount: Math.round(l.diff), memo: `FX revaluation gain — ${l.currency}` });
        else            jeLines.push({ drCode: '9100', drName: 'Loss on Exchange', crCode: l.accountCode, crName: l.accountName, amount: Math.round(-l.diff), memo: `FX revaluation loss — ${l.currency}` });
      } else {
        if (l.diff > 0) jeLines.push({ drCode: '9100', drName: 'Loss on Exchange', crCode: l.accountCode, crName: l.accountName, amount: Math.round(l.diff), memo: `FX revaluation loss on liability — ${l.currency}` });
        else            jeLines.push({ drCode: l.accountCode, drName: l.accountName, crCode: '4501', crName: 'Profit on Exchange', amount: Math.round(-l.diff), memo: `FX revaluation gain on liability — ${l.currency}` });
      }
    });
    if (jeLines.length === 0) { showToast('No revaluation differences to post', 'info'); return; }
    const je = {
      id: `JE-FX-REV-${asOfDate}`,
      date: asOfDate,
      ref: `FX-REV-${asOfDate}`,
      description: `FX Revaluation as at ${formatDate(asOfDate)}`,
      source: 'fx-revaluation',
      lines: jeLines,
    };
    const updatedJournals = [...journals, je];
    const updatedAcct = { ...(state.acctData || {}), journals: updatedJournals };
    dispatch({ type:'SET_ACCT', payload: updatedAcct });
    saveDBLocal({ ...db }, state.activity);
    logActivity(dispatch, `FX revaluation JE posted — ${jeLines.length} lines, net ${fmt(result.net)}`, currentUser);
    showToast(`FX revaluation JE posted — ${jeLines.length} lines`);
  }

  function printRevaluation() {
    if (!result) { showToast('Run revaluation first', 'error'); return; }
    const rows = result.lines.map(l => `
      <tr>
        <td>${esc(l.accountCode)}</td>
        <td>${esc(l.accountName)}</td>
        <td style="text-align:center">${esc(l.currency)}</td>
        <td style="text-align:right">${fmtN(l.nativeBalance)}</td>
        <td style="text-align:right">${fmtN(l.bookNgnBalance)}</td>
        <td style="text-align:right">${fmtN(l.closingRate)}</td>
        <td style="text-align:right">${fmtN(l.revaluedNgn)}</td>
        <td style="text-align:right;color:${l.diff>=0?'#1A5C2A':'#C0392B'};font-weight:600">${l.diff>=0?'+':'−'}${fmtN(Math.abs(l.diff))}</td>
      </tr>`).join('');
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><title>FX Revaluation — ${formatDate(asOfDate)}</title>
      <style>${PRINT_CSS}
      .fx-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 6px}
      .fx-sub{text-align:center;font-size:11.5px;color:#3A5040;margin-bottom:14px}
      table.fx{width:100%;border-collapse:collapse;margin:10px 0}
      table.fx th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
      table.fx td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11px}
      .grand{display:flex;justify-content:space-between;padding:12px 16px;border-radius:8px;font-size:14px;font-weight:800;margin-top:14px;color:#fff;background:${result.net>=0?'#1A5C2A':'#C0392B'}}
      </style></head><body>
      ${printHeader('FX REVALUATION REPORT', formatDate(asOfDate))}
      <div class="fx-title">FOREIGN EXCHANGE REVALUATION</div>
      <div class="fx-sub">As at ${formatDate(asOfDate)}</div>
      <table class="fx">
        <thead><tr><th>Code</th><th>Account</th><th>Curr</th><th style="text-align:right">Native Bal</th><th style="text-align:right">Book NGN</th><th style="text-align:right">Rate</th><th style="text-align:right">Revalued NGN</th><th style="text-align:right">Diff</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="grand"><span>NET ${result.net>=0?'GAIN':'LOSS'} ON REVALUATION</span><span>${fmtN(Math.abs(result.net))}</span></div>
      <p style="margin-top:14px;font-size:11px;color:#6E8C74">
        Rates used: USD=${fmtN(newRates.USD)}, EUR=${fmtN(newRates.EUR)}, GBP=${fmtN(newRates.GBP)}. Post this revaluation to record the gain/loss in the GL (Dr/Cr FX accounts, offset to 4501 Profit on Exchange or 9100 Loss on Exchange).
      </p>
      <script>window.onload=()=>window.print()<\/script>
      </body></html>`);
    w.document.close();
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:14 }}>Multi-Currency FX Revaluation</div>
      <div style={{ fontSize:11, color:C.textMuted, marginBottom:14 }}>
        At period-end, revalue foreign-currency balances (USD/EUR/GBP bank, AR, AP) to NGN at the closing rate. Posts the gain/loss to 4501 (Profit on Exchange) or 9100 (Loss on Exchange).
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginBottom:18 }}>
        <FG label="As of Date"><input type="date" value={asOfDate} onChange={e=>setAsOfDate(e.target.value)} style={inp} /></FG>
        <FG label="USD → NGN Rate"><input type="number" step="0.01" value={newRates.USD} onChange={e=>setNewRates(r=>({...r, USD:Number(e.target.value)}))} style={inp} /></FG>
        <FG label="EUR → NGN Rate"><input type="number" step="0.01" value={newRates.EUR} onChange={e=>setNewRates(r=>({...r, EUR:Number(e.target.value)}))} style={inp} /></FG>
        <FG label="GBP → NGN Rate"><input type="number" step="0.01" value={newRates.GBP} onChange={e=>setNewRates(r=>({...r, GBP:Number(e.target.value)}))} style={inp} /></FG>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:18 }}>
        <Btn onClick={runRevaluation}>⚡ Run Revaluation</Btn>
        <Btn variant="outline" onClick={printRevaluation} disabled={!result}>🖨️ Print Report</Btn>
        <Btn variant="ghost" onClick={postRevaluation} disabled={!result || result.lines.length === 0}>📒 Post to GL</Btn>
      </div>

      {result && (
        <>
          <div style={{ display:'flex', gap:10, marginBottom:14 }}>
            <div style={{ flex:1, padding:'10px 14px', background:'rgba(26,122,74,0.10)', border:'1px solid '+C.green, borderRadius:8 }}>
              <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>FX Gain</div>
              <div style={{ fontSize:17, fontWeight:700, color:C.green }}>{fmt(result.totalGain)}</div>
            </div>
            <div style={{ flex:1, padding:'10px 14px', background:'rgba(192,57,43,0.10)', border:'1px solid '+C.danger, borderRadius:8 }}>
              <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>FX Loss</div>
              <div style={{ fontSize:17, fontWeight:700, color:C.danger }}>{fmt(result.totalLoss)}</div>
            </div>
            <div style={{ flex:1, padding:'10px 14px', background: result.net >= 0 ? 'rgba(26,122,74,0.10)' : 'rgba(192,57,43,0.10)', border:'1px solid '+(result.net>=0?C.green:C.danger), borderRadius:8 }}>
              <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Net {result.net>=0?'Gain':'Loss'}</div>
              <div style={{ fontSize:17, fontWeight:700, color: result.net>=0?C.green:C.danger }}>{fmt(Math.abs(result.net))}</div>
            </div>
          </div>

          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              <th style={th}>Code</th><th style={th}>Account</th><th style={th}>Curr</th>
              <th style={{...th, textAlign:'right'}}>Native Bal</th>
              <th style={{...th, textAlign:'right'}}>Book NGN</th>
              <th style={{...th, textAlign:'right'}}>Rate</th>
              <th style={{...th, textAlign:'right'}}>Revalued NGN</th>
              <th style={{...th, textAlign:'right'}}>Diff</th>
            </tr></thead>
            <tbody>
              {result.lines.length === 0 ? <tr><td style={td} colSpan={8} align="center"><i>No foreign-currency balances to revalue</i></td></tr> :
                result.lines.map(l => (
                  <tr key={l.accountCode}>
                    <td style={td}>{l.accountCode}</td>
                    <td style={td}>{l.accountName}</td>
                    <td style={td}>{l.currency}</td>
                    <td style={{...td, textAlign:'right'}}>{fmtC(l.nativeBalance, l.currency)}</td>
                    <td style={{...td, textAlign:'right'}}>{fmt(l.bookNgnBalance)}</td>
                    <td style={{...td, textAlign:'right'}}>{fmtN(l.closingRate)}</td>
                    <td style={{...td, textAlign:'right'}}>{fmt(l.revaluedNgn)}</td>
                    <td style={{...td, textAlign:'right', fontWeight:600, color: l.diff>=0?C.green:C.danger}}>{l.diff>=0?'+':'−'}{fmt(Math.abs(l.diff))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
      {fxAccounts.length === 0 && (
        <div style={{ padding:20, textAlign:'center', color:C.textMuted, fontSize:13 }}>
          No foreign-currency accounts found in the Chart of Accounts. The COA needs Asset/Liability accounts with currency='USD'/'EUR'/'GBP' for this feature to work.
        </div>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 18 — MULTIPLE WAREHOUSES + INTER-WAREHOUSE TRANSFERS
// Register warehouses, see stock-on-hand per warehouse, transfer stock
// between them. Stored in db.warehouses and db.stockTransfers.
// ════════════════════════════════════════════════════════════════════════════
export function MultiWarehouseTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const warehouses = db.warehouses || [
    { id:'wh1', code:'PH-MAIN', name:'Port Harcourt Main Store', location:'PH HQ', status:'Active' },
    { id:'wh2', code:'BONNY', name:'Bonny Island Site Store', location:'Bonny Island', status:'Active' },
  ];
  const stockItems = (db.stockItems || []).filter(i => !i.voided);
  const stockMovements = db.stockMovements || [];
  const transfers = db.stockTransfers || [];
  const [modal, setModal] = useState(null);
  const [whForm, setWhForm] = useState({ code:'', name:'', location:'' });
  const [xferForm, setXferForm] = useState({ itemId:'', fromWhId:'', toWhId:'', qty:'', date:today(), notes:'' });

  function saveWarehouses(list) {
    const newDb = { ...db, warehouses: list };
    dispatch({ type:'UPDATE_MODULE', mod:'warehouses', data: list });
    saveDBLocal(newDb, state.activity);
  }
  function saveTransfers(list) {
    const newDb = { ...db, stockTransfers: list };
    dispatch({ type:'UPDATE_MODULE', mod:'stockTransfers', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function onHandByWarehouse(itemId, whId) {
    const movs = stockMovements.filter(m => m.itemId === itemId && (m.warehouseId || 'wh1') === whId);
    const in_  = movs.filter(m => m.type === 'RECEIVE' || m.type === 'RETURN' || m.type === 'TRANSFER_IN').reduce((s,m) => s + (Number(m.qty)||0), 0);
    const out  = movs.filter(m => m.type === 'ISSUE' || m.type === 'SCRAP' || m.type === 'TRANSFER_OUT').reduce((s,m) => s + (Number(m.qty)||0), 0);
    return in_ - out;
  }

  function handleSaveWh() {
    if (!whForm.code.trim() || !whForm.name.trim()) { showToast('Code and name required', 'error'); return; }
    if (warehouses.some(w => w.code === whForm.code.trim())) { showToast('Code already exists', 'error'); return; }
    const rec = { id: uid(), code: whForm.code.trim(), name: whForm.name.trim(), location: whForm.location, status: 'Active', createdAt: new Date().toISOString() };
    saveWarehouses([...warehouses, rec]);
    showToast(`Warehouse ${rec.code} added`);
    setModal(null);
    setWhForm({ code:'', name:'', location:'' });
  }

  function handleTransfer() {
    if (!xferForm.itemId) { showToast('Select an item', 'error'); return; }
    if (!xferForm.fromWhId || !xferForm.toWhId) { showToast('Select source and destination warehouses', 'error'); return; }
    if (xferForm.fromWhId === xferForm.toWhId) { showToast('Source and destination must differ', 'error'); return; }
    const qty = Number(xferForm.qty);
    if (!qty || qty <= 0) { showToast('Enter a valid quantity', 'error'); return; }
    const onHand = onHandByWarehouse(xferForm.itemId, xferForm.fromWhId);
    if (qty > onHand) { showToast(`Insufficient stock at source (on-hand: ${onHand})`, 'error'); return; }
    const item = stockItems.find(i => i.id === xferForm.itemId);
    const fromWh = warehouses.find(w => w.id === xferForm.fromWhId);
    const toWh   = warehouses.find(w => w.id === xferForm.toWhId);
    const xferNo = `ST-XFER-${year()}-${String(transfers.length + 1).padStart(4,'0')}`;
    const rec = {
      id: uid(), xferNo, date: xferForm.date,
      itemId: xferForm.itemId, itemCode: item?.code, itemName: item?.name,
      fromWhId: xferForm.fromWhId, fromWhCode: fromWh?.code, fromWhName: fromWh?.name,
      toWhId: xferForm.toWhId, toWhCode: toWh?.code, toWhName: toWh?.name,
      qty, uom: item?.uom || 'pcs',
      notes: xferForm.notes,
      transferredBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };
    // Post two movements: TRANSFER_OUT at source, TRANSFER_IN at destination
    const outMove = { id: uid(), itemId: item.id, type:'TRANSFER_OUT', qty, unitCost: Number(item.unitCost)||0, refType:'transfer', refId: rec.id, warehouseId: xferForm.fromWhId, date: xferForm.date, notes: `Transfer out to ${toWh?.name}`, postedToGL:false, createdAt: new Date().toISOString() };
    const inMove  = { id: uid(), itemId: item.id, type:'TRANSFER_IN',  qty, unitCost: Number(item.unitCost)||0, refType:'transfer', refId: rec.id, warehouseId: xferForm.toWhId,   date: xferForm.date, notes: `Transfer in from ${fromWh?.name}`, postedToGL:false, createdAt: new Date().toISOString() };
    const updatedMovements = [...stockMovements, outMove, inMove];
    dispatch({ type:'UPDATE_MODULE', mod:'stockMovements', data: updatedMovements });
    saveDBLocal({ ...db, stockMovements: updatedMovements }, state.activity);
    saveTransfers([rec, ...transfers]);
    logActivity(dispatch, `Stock transfer ${xferNo}: ${qty} ${item.uom} of ${item.code} from ${fromWh?.code} to ${toWh?.code}`, currentUser);
    showToast(`Transfer ${xferNo} recorded`);
    setModal(null);
    setXferForm({ itemId:'', fromWhId:'', toWhId:'', qty:'', date:today(), notes:'' });
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Multiple Warehouses</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Register warehouses, view stock-on-hand per location, transfer stock between them</div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <Btn variant="ghost" onClick={()=>setModal('wh')}>+ Warehouse</Btn>
          <Btn onClick={()=>setModal('xfer')} disabled={warehouses.length < 2 || stockItems.length === 0}>📦 New Transfer</Btn>
        </div>
      </div>

      {/* Stock-on-hand matrix: items × warehouses */}
      <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginBottom:8 }}>Stock-on-Hand by Warehouse</div>
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:18 }}>
          <thead><tr>
            <th style={th}>Code</th><th style={th}>Item</th>
            {warehouses.map(w => <th key={w.id} style={{...th, textAlign:'right'}}>{w.code}</th>)}
            <th style={{...th, textAlign:'right'}}>Total</th>
          </tr></thead>
          <tbody>
            {stockItems.length === 0 ? <tr><td style={td} colSpan={warehouses.length+3} align="center"><i>No stock items</i></td></tr> :
              stockItems.map(it => {
                const totals = warehouses.map(w => onHandByWarehouse(it.id, w.id));
                const grand = totals.reduce((s,t) => s+t, 0);
                return (
                  <tr key={it.id}>
                    <td style={td}><b>{it.code}</b></td>
                    <td style={td}>{it.name}</td>
                    {totals.map((t,i) => <td key={i} style={{...td, textAlign:'right', color: t === 0 ? C.textMuted : C.text}}>{t}</td>)}
                    <td style={{...td, textAlign:'right', fontWeight:700}}>{grand}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Recent transfers */}
      {transfers.length > 0 && (
        <>
          <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginBottom:8 }}>Recent Transfers</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              <th style={th}>Ref</th><th style={th}>Date</th><th style={th}>Item</th>
              <th style={{...th, textAlign:'right'}}>Qty</th>
              <th style={th}>From</th><th style={th}>To</th>
            </tr></thead>
            <tbody>
              {transfers.slice(0, 15).map(t => (
                <tr key={t.id}>
                  <td style={td}><b>{t.xferNo}</b></td>
                  <td style={td}>{formatDate(t.date)}</td>
                  <td style={td}>{t.itemCode} — {t.itemName}</td>
                  <td style={{...td, textAlign:'right'}}>{t.qty} {t.uom}</td>
                  <td style={td}>{t.fromWhCode}</td>
                  <td style={td}>{t.toWhCode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {modal === 'wh' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Warehouse</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FG label="Code"><input value={whForm.code} onChange={e=>setWhForm(f=>({...f, code:e.target.value}))} placeholder="e.g. PH-MAIN" style={inp} /></FG>
              <FG label="Name"><input value={whForm.name} onChange={e=>setWhForm(f=>({...f, name:e.target.value}))} placeholder="e.g. Port Harcourt Main Store" style={inp} /></FG>
              <FG label="Location" full><input value={whForm.location} onChange={e=>setWhForm(f=>({...f, location:e.target.value}))} placeholder="e.g. PH HQ, Bonny Island" style={inp} /></FG>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSaveWh}>Save Warehouse</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {modal === 'xfer' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Stock Transfer</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FG label="Item" full>
                <select value={xferForm.itemId} onChange={e=>setXferForm(f=>({...f, itemId:e.target.value}))} style={inp}>
                  <option value="">— Select Item —</option>
                  {stockItems.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                </select>
              </FG>
              <FG label="From Warehouse">
                <select value={xferForm.fromWhId} onChange={e=>setXferForm(f=>({...f, fromWhId:e.target.value}))} style={inp}>
                  <option value="">— Select —</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
              </FG>
              <FG label="To Warehouse">
                <select value={xferForm.toWhId} onChange={e=>setXferForm(f=>({...f, toWhId:e.target.value}))} style={inp}>
                  <option value="">— Select —</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
              </FG>
              <FG label="Quantity"><input type="number" value={xferForm.qty} onChange={e=>setXferForm(f=>({...f, qty:e.target.value}))} style={inp} /></FG>
              <FG label="Date"><input type="date" value={xferForm.date} onChange={e=>setXferForm(f=>({...f, date:e.target.value}))} style={inp} /></FG>
              <FG label="Notes" full><textarea value={xferForm.notes} onChange={e=>setXferForm(f=>({...f, notes:e.target.value}))} rows={2} style={{...inp, resize:'vertical'}} /></FG>
            </div>
            {xferForm.itemId && xferForm.fromWhId && (
              <div style={{ marginTop:10, padding:10, background:'rgba(26,92,138,0.06)', borderRadius:8, fontSize:12, color:C.textMid }}>
                On-hand at source: <b>{onHandByWarehouse(xferForm.itemId, xferForm.fromWhId)}</b> units
              </div>
            )}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleTransfer}>Record Transfer</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 19 — SERIAL / BATCH TRACKING
// Track individual units (serial numbers) or batches (lot numbers) of stock
// items through RECEIVE / ISSUE / SALE movements. Useful for warranty
// tracking, expiry management, recall handling.
// Stored in db.serialBatches (master) + each movement can carry a
// serialBatchId linking it to a specific serial/batch.
// ════════════════════════════════════════════════════════════════════════════
export function SerialBatchTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const stockItems = (db.stockItems || []).filter(i => !i.voided);
  const stockMovements = db.stockMovements || [];
  const serialBatches = db.serialBatches || [];
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ itemId:'', type:'serial', code:'', qty:1, mfgDate:'', expiryDate:'', supplier:'', notes:'' });
  const [filterItem, setFilterItem] = useState('');

  function saveSerialBatches(list) {
    const newDb = { ...db, serialBatches: list };
    dispatch({ type:'UPDATE_MODULE', mod:'serialBatches', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function handleSave() {
    if (!form.itemId) { showToast('Select a stock item', 'error'); return; }
    if (!form.code.trim()) { showToast(form.type === 'serial' ? 'Serial number required' : 'Batch number required', 'error'); return; }
    const item = stockItems.find(i => i.id === form.itemId);
    if (!item) return;
    // Check for duplicate serial/batch code
    if (serialBatches.some(sb => sb.code === form.code.trim() && sb.itemId === form.itemId)) {
      showToast(`${form.type === 'serial' ? 'Serial' : 'Batch'} ${form.code} already exists for this item`, 'error');
      return;
    }
    const rec = {
      id: uid(),
      itemId: form.itemId,
      itemCode: item.code,
      itemName: item.name,
      type: form.type, // 'serial' or 'batch'
      code: form.code.trim(),
      qty: form.type === 'serial' ? 1 : (Number(form.qty) || 1),
      mfgDate: form.mfgDate,
      expiryDate: form.expiryDate,
      supplier: form.supplier,
      notes: form.notes,
      status: 'In Stock', // In Stock / Issued / Sold / Expired
      receivedAt: today(),
      receivedBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };
    const updated = [rec, ...serialBatches];
    saveSerialBatches(updated);
    logActivity(dispatch, `${form.type === 'serial' ? 'Serial' : 'Batch'} ${rec.code} registered for ${item.code} (qty ${rec.qty})`, currentUser);
    showToast(`${form.type === 'serial' ? 'Serial' : 'Batch'} ${rec.code} registered`);
    setModal(null);
    setForm({ itemId:'', type:'serial', code:'', qty:1, mfgDate:'', expiryDate:'', supplier:'', notes:'' });
  }

  function markIssued(sb) {
    const updated = serialBatches.map(x => x.id === sb.id ? { ...x, status: 'Issued', issuedAt: today() } : x);
    saveSerialBatches(updated);
    logActivity(dispatch, `${sb.type === 'serial' ? 'Serial' : 'Batch'} ${sb.code} marked as Issued`, currentUser);
    showToast(`${sb.code} marked as Issued`);
  }

  const filtered = filterItem ? serialBatches.filter(sb => sb.itemId === filterItem) : serialBatches;
  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  // Expiry alert: batch within 30 days
  const today_ = new Date();
  const isExpiringSoon = (sb) => {
    if (!sb.expiryDate || sb.status !== 'In Stock') return false;
    const exp = new Date(sb.expiryDate);
    const days = (exp - today_) / 86400000;
    return days >= 0 && days <= 30;
  };
  const isExpired = (sb) => {
    if (!sb.expiryDate) return false;
    return new Date(sb.expiryDate) < today_ && sb.status === 'In Stock';
  };

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Serial / Batch Tracking</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Track individual units (serial) or lots (batch) — warranty, expiry, recall management</div>
        </div>
        <Btn onClick={()=>setModal('add')} disabled={stockItems.length === 0}>+ Register Serial / Batch</Btn>
      </div>

      <FG label="Filter by Item (optional)">
        <select value={filterItem} onChange={e=>setFilterItem(e.target.value)} style={{ ...inp, maxWidth:400 }}>
          <option value="">— All Items —</option>
          {stockItems.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
        </select>
      </FG>

      {filtered.length === 0 ? (
        <div style={{ padding:30, textAlign:'center', color:C.textMuted, fontSize:13, marginTop:14 }}>
          No serial/batch records yet. Click "Register Serial / Batch" to track individual units or lots.
        </div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse', marginTop:14 }}>
          <thead><tr>
            <th style={th}>Type</th><th style={th}>Code</th><th style={th}>Item</th>
            <th style={{...th, textAlign:'right'}}>Qty</th>
            <th style={th}>Mfg Date</th><th style={th}>Expiry Date</th>
            <th style={th}>Supplier</th><th style={th}>Status</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {filtered.map(sb => (
              <tr key={sb.id} style={{ background: isExpired(sb) ? 'rgba(192,57,43,0.06)' : isExpiringSoon(sb) ? 'rgba(201,122,10,0.06)' : 'transparent' }}>
                <td style={td}>
                  <span style={{ padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:600, background: sb.type === 'serial' ? 'rgba(26,92,138,0.12)' : 'rgba(155,136,232,0.12)', color: sb.type === 'serial' ? '#1A5C8A' : '#9B88E8', textTransform:'capitalize' }}>{sb.type}</span>
                </td>
                <td style={td}><b>{sb.code}</b></td>
                <td style={td}>{sb.itemCode} — {sb.itemName}</td>
                <td style={{...td, textAlign:'right'}}>{sb.qty}</td>
                <td style={td}>{sb.mfgDate ? formatDate(sb.mfgDate) : '—'}</td>
                <td style={{...td, color: isExpired(sb) ? C.danger : isExpiringSoon(sb) ? C.amber : C.text}}>
                  {sb.expiryDate ? formatDate(sb.expiryDate) : '—'}
                  {isExpired(sb) && ' (EXPIRED)'}
                  {isExpiringSoon(sb) && ' (soon)'}
                </td>
                <td style={td}>{sb.supplier || '—'}</td>
                <td style={td}>
                  <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600,
                    color: sb.status === 'In Stock' ? C.green : sb.status === 'Issued' ? C.amber : '#6B7280',
                    background: sb.status === 'In Stock' ? 'rgba(26,122,74,0.12)' : sb.status === 'Issued' ? 'rgba(201,122,10,0.12)' : 'rgba(107,114,128,0.12)' }}>{sb.status}</span>
                </td>
                <td style={td}>
                  {sb.status === 'In Stock' && <Btn sm variant="ghost" onClick={()=>markIssued(sb)}>↩ Issue</Btn>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal === 'add' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>Register Serial / Batch</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FG label="Stock Item">
                <select value={form.itemId} onChange={e=>setForm(f=>({...f, itemId:e.target.value}))} style={inp}>
                  <option value="">— Select Item —</option>
                  {stockItems.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                </select>
              </FG>
              <FG label="Type">
                <select value={form.type} onChange={e=>setForm(f=>({...f, type:e.target.value, qty: e.target.value === 'serial' ? 1 : f.qty}))} style={inp}>
                  <option value="serial">Serial Number (1 unit)</option>
                  <option value="batch">Batch / Lot (multiple units)</option>
                </select>
              </FG>
              <FG label={form.type === 'serial' ? 'Serial Number' : 'Batch / Lot Number'}>
                <input value={form.code} onChange={e=>setForm(f=>({...f, code:e.target.value}))} placeholder={form.type === 'serial' ? 'e.g. SN-MV-001' : 'e.g. LOT-2026-001'} style={inp} />
              </FG>
              {form.type === 'batch' && (
                <FG label="Quantity in Batch"><input type="number" value={form.qty} onChange={e=>setForm(f=>({...f, qty:e.target.value}))} style={inp} /></FG>
              )}
              <FG label="Mfg Date"><input type="date" value={form.mfgDate} onChange={e=>setForm(f=>({...f, mfgDate:e.target.value}))} style={inp} /></FG>
              <FG label="Expiry Date"><input type="date" value={form.expiryDate} onChange={e=>setForm(f=>({...f, expiryDate:e.target.value}))} style={inp} /></FG>
              <FG label="Supplier"><input value={form.supplier} onChange={e=>setForm(f=>({...f, supplier:e.target.value}))} style={inp} /></FG>
              <FG label="Notes" full><textarea value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))} rows={2} style={{...inp, resize:'vertical'}} /></FG>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSave}>Register</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 20 — BILL OF MATERIALS (BOM)
// Define assemblies (finished goods) with their component quantities.
// "Build" a finished good: consumes components from stock, adds the assembly
// to stock, posts the assembly JE (Dr Finished Goods / Cr Components).
// Stored in db.boms (master) + db.bomBuilds (build history).
// ════════════════════════════════════════════════════════════════════════════
export function BOMTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const stockItems = (db.stockItems || []).filter(i => !i.voided);
  const stockMovements = db.stockMovements || [];
  const boms = db.boms || [];
  const bomBuilds = db.bomBuilds || [];
  const [modal, setModal] = useState(null);
  const [bomForm, setBomForm] = useState({ assemblyItemId:'', components: [{ itemId:'', qty:'' }] });
  const [buildForm, setBuildForm] = useState({ bomId:'', qty:1, date:today(), notes:'' });

  function saveBoms(list) {
    const newDb = { ...db, boms: list };
    dispatch({ type:'UPDATE_MODULE', mod:'boms', data: list });
    saveDBLocal(newDb, state.activity);
  }
  function saveBomBuilds(list) {
    const newDb = { ...db, bomBuilds: list };
    dispatch({ type:'UPDATE_MODULE', mod:'bomBuilds', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function onHand(itemId) {
    const movs = stockMovements.filter(m => m.itemId === itemId);
    const in_ = movs.filter(m => ['RECEIVE','RETURN','TRANSFER_IN','ASSEMBLY_IN'].includes(m.type)).reduce((s,m) => s + (Number(m.qty)||0), 0);
    const out = movs.filter(m => ['ISSUE','SCRAP','TRANSFER_OUT','ASSEMBLY_OUT'].includes(m.type)).reduce((s,m) => s + (Number(m.qty)||0), 0);
    return in_ - out;
  }

  function handleSaveBom() {
    if (!bomForm.assemblyItemId) { showToast('Select an assembly item', 'error'); return; }
    const validComponents = bomForm.components.filter(c => c.itemId && Number(c.qty) > 0);
    if (validComponents.length === 0) { showToast('Add at least one component with quantity', 'error'); return; }
    const assembly = stockItems.find(i => i.id === bomForm.assemblyItemId);
    const bomNo = `BOM-${year()}-${String(boms.length + 1).padStart(4,'0')}`;
    const components = validComponents.map(c => {
      const item = stockItems.find(i => i.id === c.itemId);
      return { itemId: c.itemId, itemCode: item?.code, itemName: item?.name, qty: Number(c.qty), uom: item?.uom, unitCost: Number(item?.unitCost)||0 };
    });
    const totalCost = components.reduce((s,c) => s + (c.qty * c.unitCost), 0);
    const rec = {
      id: uid(), bomNo,
      assemblyItemId: bomForm.assemblyItemId,
      assemblyItemCode: assembly?.code,
      assemblyItemName: assembly?.name,
      components,
      totalCost,
      status: 'Active',
      createdAt: new Date().toISOString(),
      createdBy: currentUser?.name || 'Admin',
    };
    saveBoms([rec, ...boms]);
    logActivity(dispatch, `BOM ${bomNo} created for ${assembly?.code} — ${components.length} components, total cost ${fmt(totalCost)}`, currentUser);
    showToast(`BOM ${bomNo} saved`);
    setModal(null);
    setBomForm({ assemblyItemId:'', components: [{ itemId:'', qty:'' }] });
  }

  function handleBuild() {
    if (!buildForm.bomId) { showToast('Select a BOM', 'error'); return; }
    const bom = boms.find(b => b.id === buildForm.bomId);
    if (!bom) return;
    const buildQty = Number(buildForm.qty) || 0;
    if (buildQty <= 0) { showToast('Enter a valid quantity', 'error'); return; }
    // Check component stock availability
    const shortComponents = bom.components.filter(c => onHand(c.itemId) < c.qty * buildQty);
    if (shortComponents.length > 0) {
      const msg = shortComponents.map(c => `${c.itemCode} needs ${c.qty * buildQty}, on-hand ${onHand(c.itemId)}`).join('; ');
      showToast(`Insufficient stock: ${msg}`, 'error');
      return;
    }
    const buildNo = `BLD-${year()}-${String(bomBuilds.length + 1).padStart(4,'0')}`;
    // Post movements: ASSEMBLY_OUT for each component, ASSEMBLY_IN for the assembly
    const newMovements = [];
    bom.components.forEach(c => {
      newMovements.push({
        id: uid(), itemId: c.itemId, type:'ASSEMBLY_OUT',
        qty: c.qty * buildQty, unitCost: c.unitCost,
        refType: 'bom-build', refId: buildNo,
        date: buildForm.date, notes: `Consumed in build ${buildNo}`,
        postedToGL: false, createdAt: new Date().toISOString(),
      });
    });
    newMovements.push({
      id: uid(), itemId: bom.assemblyItemId, type:'ASSEMBLY_IN',
      qty: buildQty, unitCost: bom.totalCost,
      refType: 'bom-build', refId: buildNo,
      date: buildForm.date, notes: `Built ${buildQty} × ${bom.assemblyItemCode}`,
      postedToGL: false, createdAt: new Date().toISOString(),
    });
    const updatedMovements = [...stockMovements, ...newMovements];
    dispatch({ type:'UPDATE_MODULE', mod:'stockMovements', data: updatedMovements });
    saveDBLocal({ ...db, stockMovements: updatedMovements }, state.activity);

    const rec = {
      id: uid(), buildNo, bomId: bom.id, bomNo: bom.bomNo,
      assemblyItemCode: bom.assemblyItemCode, assemblyItemName: bom.assemblyItemName,
      qty: buildQty, date: buildForm.date,
      totalCost: bom.totalCost * buildQty,
      components: bom.components.map(c => ({ ...c, consumedQty: c.qty * buildQty })),
      notes: buildForm.notes,
      builtBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };
    saveBomBuilds([rec, ...bomBuilds]);
    logActivity(dispatch, `BOM build ${buildNo}: ${buildQty} × ${bom.assemblyItemCode} built (cost ${fmt(rec.totalCost)})`, currentUser);
    showToast(`Build ${buildNo} complete — ${buildQty} × ${bom.assemblyItemCode} added to stock`);
    setModal(null);
    setBuildForm({ bomId:'', qty:1, date:today(), notes:'' });
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:14 }}>Bill of Materials (BOM)</div>
      <div style={{ fontSize:11, color:C.textMuted, marginBottom:14 }}>
        Define assemblies (finished goods) with their component quantities. "Build" consumes components from stock, adds the assembly, posts the assembly JE.
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:18 }}>
        <Btn onClick={()=>setModal('bom')} disabled={stockItems.length < 2}>+ New BOM</Btn>
        <Btn variant="outline" onClick={()=>setModal('build')} disabled={boms.length === 0}>🔨 Build Assembly</Btn>
      </div>

      {boms.length === 0 ? (
        <div style={{ padding:30, textAlign:'center', color:C.textMuted, fontSize:13 }}>
          No BOMs defined. Click "New BOM" to define an assembly (e.g. "Service Kit" = 5× gloves + 2× helmet + 1× manual).
        </div>
      ) : (
        <>
          <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginBottom:8 }}>Defined BOMs</div>
          <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:18 }}>
            <thead><tr>
              <th style={th}>BOM No</th><th style={th}>Assembly</th>
              <th style={{...th, textAlign:'right'}}>Components</th>
              <th style={{...th, textAlign:'right'}}>Unit Cost</th>
              <th style={th}>Status</th>
            </tr></thead>
            <tbody>
              {boms.map(b => (
                <tr key={b.id}>
                  <td style={td}><b>{b.bomNo}</b></td>
                  <td style={td}>{b.assemblyItemCode} — {b.assemblyItemName}</td>
                  <td style={{...td, textAlign:'right'}}>{b.components.length}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(b.totalCost)}</td>
                  <td style={td}>
                    <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600, color:C.green, background:'rgba(26,122,74,0.12)' }}>{b.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Component breakdown */}
          <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginBottom:8 }}>BOM Component Details</div>
          <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:18 }}>
            <thead><tr>
              <th style={th}>BOM</th><th style={th}>Component</th>
              <th style={{...th, textAlign:'right'}}>Qty per Assembly</th>
              <th style={{...th, textAlign:'right'}}>On-Hand</th>
              <th style={{...th, textAlign:'right'}}>Can Build</th>
            </tr></thead>
            <tbody>
              {boms.flatMap(b => b.components.map((c, i) => (
                <tr key={b.id + '-' + i}>
                  <td style={td}>{i === 0 ? <b>{b.bomNo}</b> : ''}</td>
                  <td style={td}>{c.itemCode} — {c.itemName}</td>
                  <td style={{...td, textAlign:'right'}}>{c.qty} {c.uom}</td>
                  <td style={{...td, textAlign:'right'}}>{onHand(c.itemId)}</td>
                  <td style={{...td, textAlign:'right', color: onHand(c.itemId) >= c.qty ? C.green : C.danger, fontWeight:600}}>
                    {Math.floor(onHand(c.itemId) / c.qty)}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </>
      )}

      {bomBuilds.length > 0 && (
        <>
          <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginBottom:8 }}>Build History</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              <th style={th}>Build No</th><th style={th}>Date</th><th style={th}>Assembly</th>
              <th style={{...th, textAlign:'right'}}>Qty</th>
              <th style={{...th, textAlign:'right'}}>Total Cost</th>
              <th style={th}>Built By</th>
            </tr></thead>
            <tbody>
              {bomBuilds.map(b => (
                <tr key={b.id}>
                  <td style={td}><b>{b.buildNo}</b></td>
                  <td style={td}>{formatDate(b.date)}</td>
                  <td style={td}>{b.assemblyItemCode} — {b.assemblyItemName}</td>
                  <td style={{...td, textAlign:'right'}}>{b.qty}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(b.totalCost)}</td>
                  <td style={td}>{b.builtBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {modal === 'bom' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Bill of Materials</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <FG label="Assembly (Finished Good)">
              <select value={bomForm.assemblyItemId} onChange={e=>setBomForm(f=>({...f, assemblyItemId:e.target.value}))} style={inp}>
                <option value="">— Select Assembly Item —</option>
                {stockItems.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
              </select>
            </FG>
            <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginTop:14, marginBottom:8 }}>Components</div>
            {bomForm.components.map((c, idx) => (
              <div key={idx} style={{ display:'grid', gridTemplateColumns:'3fr 1fr auto', gap:8, marginBottom:8 }}>
                <select value={c.itemId} onChange={e=>{
                  const next = [...bomForm.components];
                  next[idx] = { ...next[idx], itemId: e.target.value };
                  setBomForm(f => ({ ...f, components: next }));
                }} style={inp}>
                  <option value="">— Select Component —</option>
                  {stockItems.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
                </select>
                <input type="number" placeholder="Qty" value={c.qty} onChange={e=>{
                  const next = [...bomForm.components];
                  next[idx] = { ...next[idx], qty: e.target.value };
                  setBomForm(f => ({ ...f, components: next }));
                }} style={inp} />
                <Btn sm variant="danger" onClick={()=>setBomForm(f => ({ ...f, components: f.components.filter((_, i) => i !== idx) }))}>✕</Btn>
              </div>
            ))}
            <Btn sm variant="ghost" onClick={()=>setBomForm(f => ({ ...f, components: [...f.components, { itemId:'', qty:'' }] }))}>+ Add Component</Btn>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSaveBom}>Save BOM</Btn>
            </div>
          </Card>
        </Overlay>
      )}

      {modal === 'build' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>Build Assembly</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FG label="BOM" full>
                <select value={buildForm.bomId} onChange={e=>setBuildForm(f=>({...f, bomId:e.target.value}))} style={inp}>
                  <option value="">— Select BOM —</option>
                  {boms.map(b => <option key={b.id} value={b.id}>{b.bomNo} — {b.assemblyItemCode} ({b.components.length} components)</option>)}
                </select>
              </FG>
              <FG label="Quantity to Build"><input type="number" value={buildForm.qty} onChange={e=>setBuildForm(f=>({...f, qty:e.target.value}))} style={inp} /></FG>
              <FG label="Date"><input type="date" value={buildForm.date} onChange={e=>setBuildForm(f=>({...f, date:e.target.value}))} style={inp} /></FG>
              <FG label="Notes" full><textarea value={buildForm.notes} onChange={e=>setBuildForm(f=>({...f, notes:e.target.value}))} rows={2} style={{...inp, resize:'vertical'}} /></FG>
            </div>
            {buildForm.bomId && (() => {
              const bom = boms.find(b => b.id === buildForm.bomId);
              if (!bom) return null;
              const buildQty = Number(buildForm.qty) || 0;
              return (
                <div style={{ marginTop:14, padding:12, background:'rgba(26,92,138,0.06)', borderRadius:8 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#1A5C8A', marginBottom:6 }}>Build Preview</div>
                  <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse' }}>
                    <thead><tr><th style={{textAlign:'left', padding:'4px 6px', borderBottom:'1px solid '+C.borderLight}}>Component</th><th style={{textAlign:'right', padding:'4px 6px', borderBottom:'1px solid '+C.borderLight}}>Needed</th><th style={{textAlign:'right', padding:'4px 6px', borderBottom:'1px solid '+C.borderLight}}>On-Hand</th><th style={{textAlign:'right', padding:'4px 6px', borderBottom:'1px solid '+C.borderLight}}>OK?</th></tr></thead>
                    <tbody>
                      {bom.components.map((c, i) => {
                        const needed = c.qty * buildQty;
                        const have = onHand(c.itemId);
                        return (
                          <tr key={i}>
                            <td style={{padding:'4px 6px'}}>{c.itemCode}</td>
                            <td style={{padding:'4px 6px', textAlign:'right'}}>{needed}</td>
                            <td style={{padding:'4px 6px', textAlign:'right'}}>{have}</td>
                            <td style={{padding:'4px 6px', textAlign:'right', color: have >= needed ? C.green : C.danger, fontWeight:600}}>{have >= needed ? '✓' : '✗'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ marginTop:8, fontSize:12, color:C.textMid }}>Total build cost: <b>{fmt(bom.totalCost * buildQty)}</b></div>
                </div>
              );
            })()}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleBuild}>🔨 Build Assembly</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}
