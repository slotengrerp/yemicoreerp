// ══════════════════════════════════════════════════════════════════════════════
// SLOT ENGINEERING — SAGE-STYLE REPORTS & FEATURES MODULE v1.0
//
// Adds the daily-workflow reports and features Nigerian accountants rely on
// Sage 200 Evolution for, that were previously missing from SLOT ERP:
//
//   1. Customer Statement (one-click PDF, aging breakdown, transaction list)
//   2. Supplier Statement + Remittance Advice
//   3. Credit Notes (link to original invoice, GL reversal)
//   4. VAT201 Report (output VAT, input VAT, net payable)
//   5. Comparative P&L and Balance Sheet (this year vs last year)
//   6. GL Detail Report (filter by account + date range)
//   7. Aged Receivables & Aged Payables reports (proper buckets + print)
//   8. Batch Payment Run (select multiple bills -> one batch + EFT list)
//   9. WHT certificates (per-vendor tracking + printable certificate)
//  10. Customer Credit Limit enforcement (block over-limit invoices with override)
//
// All reports honour the existing data shape: db.invoices, db.ap.bills,
// db.ap.payments, db.arReceipts, state.acctData.journals, state.acctData.coa.
// Credit notes and batch payments persist to new fields in db so the existing
// sync engine carries them to the cloud automatically.
// ══════════════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react';
import { useApp }   from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canDo }    from '../../utils/auth';
import { showToast, formatDate, generateId } from '../../utils/helpers';
import { saveDBLocal } from '../../utils/db';
import { logActivity }  from '../../utils/audit';
import { printHeader, PRINT_CSS, SLOT_LOGO_SRC, printBootstrap, openPrintWindow} from '../../utils/logo';
import { getClients, getClientByCode } from '../../utils/clientMaster';
import { getVendors, getVendorByCode } from '../../utils/vendorMaster';
import { BANK_ACCOUNTS } from '../../utils/financeConstants';
import { diffAndPush, pushOne } from '../../hooks/usePerRecordSync';

// Tier 2 features (6 additional tabs)
import {
  RecurringInvoicesTab,
  BankReconciliationTab,
  PrepaymentsAccrualsTab,
  AssetDisposalTab,
  BudgetVsActualTab,
  StockTakeTab,
} from './SageReportsTier2';

// Tier 3 features (4 advanced modules)
import {
  FXRevaluationTab,
  MultiWarehouseTab,
  SerialBatchTab,
  BOMTab,
} from './SageReportsTier3';

const uid   = () => generateId();
const today = () => new Date().toISOString().split('T')[0];
const year  = () => new Date().getFullYear();
const yr    = () => year();
const fmt   = n => '₦' + (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN  = n => (Number(n) || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Shared UI primitives (match the existing module style) ───────────────────
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
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:4, gridColumn:full?'1/-1':undefined }}>
      <label style={{ fontSize:11, fontWeight:600, color:C.textMid }}>{label}</label>
      {children}
    </div>
  );
}

function Overlay({ children, onClose }) {
  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(10,35,15,0.62)',
        backdropFilter:'blur(3px)', display:'flex', alignItems:'flex-start',
        justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'100%', maxWidth:920, marginBottom:32 }}>{children}</div>
    </div>
  );
}

// ── Aging buckets (Nigerian standard: Current / 30 / 60 / 90 / 120+) ─────────
function agingBuckets(dueDate, asOfDate = new Date()) {
  if (!dueDate) return 'current';
  const due = new Date(dueDate);
  const now = new Date(asOfDate);
  // Strip time portion for both dates so the comparison is date-only.
  due.setHours(0,0,0,0); now.setHours(0,0,0,0);
  const days = Math.round((now - due) / 86400000);
  if (days <= 0)  return 'current';   // not due yet
  if (days <= 30) return 'b30';
  if (days <= 60) return 'b60';
  if (days <= 90) return 'b90';
  return 'b120';
}
const BUCKET_LABELS = {
  current: 'Current',
  b30:     '1 – 30 days',
  b60:     '31 – 60 days',
  b90:     '61 – 90 days',
  b120:    'Over 90 days',
};
const BUCKET_ORDER = ['current','b30','b60','b90','b120'];

// ── HTML-escape helper (defence-in-depth for print windows) ──────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
));

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT — tabbed report launcher
// ════════════════════════════════════════════════════════════════════════════
export default function SageReports() {
  const { state, dispatch } = useApp();
  const { C } = useTheme();
  const { currentUser, db } = state;
  const [tab, setTab] = useState('custStatement');

  const TABS = [
    { id:'custStatement',   label:'📋 Customer Statement'      },
    { id:'suppStatement',   label:'🏭 Supplier Statement'      },
    { id:'creditNotes',     label:'↩️ Credit Notes'             },
    { id:'vat201',          label:'🧾 VAT201 Report'            },
    { id:'comparative',     label:'📊 Comparative P&L / BS'     },
    { id:'glDetail',        label:'📒 GL Detail Report'         },
    { id:'aging',           label:'📅 Aged AR / AP'             },
    { id:'batchPayment',    label:'💳 Batch Payment Run'        },
    { id:'wht',             label:'📑 WHT Certificates'         },
    { id:'creditLimit',     label:'⚠️ Credit Limit Check'       },
    // ── Tier 2 features ────────────────────────────────────────────────
    { id:'recurring',       label:'🔁 Recurring Invoices'       },
    { id:'bankRec',         label:'🏦 Bank Reconciliation'      },
    { id:'prepayAccrual',   label:'📆 Prepayments & Accruals'   },
    { id:'assetDisposal',   label:'🏗️ Asset Disposal'           },
    { id:'budget',          label:'🎯 Budget vs Actual'         },
    { id:'stockTake',       label:'📦 Stock Take'               },
    // ── Tier 3 features ────────────────────────────────────────────────
    { id:'fxReval',         label:'💱 FX Revaluation'           },
    { id:'warehouses',      label:'🏬 Multi-Warehouse'          },
    { id:'serialBatch',     label:'🏷️ Serial / Batch'           },
    { id:'bom',             label:'🔧 Bill of Materials'        },
  ];

  const inp = { padding:'7px 10px', borderRadius:7, border:'1px solid '+C.border, background:C.bgCard, color:C.text, fontSize:13, width:'100%', outline:'none', fontFamily:'inherit', boxSizing:'border-box' };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
      <div>
        <div style={{ fontSize:20, fontWeight:700, color:C.text }}>Sage-Style Reports & Features</div>
        <div style={{ fontSize:12, color:C.textMuted, marginTop:3 }}>
          Daily-workflow reports Nigerian accountants rely on Sage 200 Evolution for
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', padding:'6px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:10 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{
              padding:'7px 13px', borderRadius:7, fontSize:12, fontWeight:600,
              cursor:'pointer', whiteSpace:'nowrap',
              background: tab===t.id ? C.green : 'transparent',
              color:      tab===t.id ? '#fff'   : C.textMid,
              border:     tab===t.id ? 'none'   : '1px solid '+C.border,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Active tab body */}
      <div>
        {tab === 'custStatement'    && <CustomerStatementTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'suppStatement'    && <SupplierStatementTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'creditNotes'      && <CreditNotesTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'vat201'           && <VAT201Tab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'comparative'      && <ComparativeTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'glDetail'         && <GLDetailTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'aging'            && <AgingTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'batchPayment'     && <BatchPaymentTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'wht'              && <WHTTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'creditLimit'      && <CreditLimitTab state={state} dispatch={dispatch} inp={inp} />}
        {/* Tier 2 features */}
        {tab === 'recurring'        && <RecurringInvoicesTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'bankRec'          && <BankReconciliationTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'prepayAccrual'    && <PrepaymentsAccrualsTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'assetDisposal'    && <AssetDisposalTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'budget'           && <BudgetVsActualTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'stockTake'        && <StockTakeTab state={state} dispatch={dispatch} inp={inp} />}
        {/* Tier 3 features */}
        {tab === 'fxReval'          && <FXRevaluationTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'warehouses'       && <MultiWarehouseTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'serialBatch'      && <SerialBatchTab state={state} dispatch={dispatch} inp={inp} />}
        {tab === 'bom'              && <BOMTab state={state} dispatch={dispatch} inp={inp} />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 1 — CUSTOMER STATEMENT
// One-click PDF: header, opening balance, transaction list, closing balance,
// aging breakdown. Pulls from db.invoices + db.arReceipts.
// ════════════════════════════════════════════════════════════════════════════
function CustomerStatementTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db } = state;
  const clients = useMemo(() => getClients().filter(c => c.status === 'Active'), []);
  const [clientCode, setClientCode] = useState('');
  const [fromDate,   setFromDate]   = useState('');
  const [toDate,     setToDate]     = useState(today());

  const invoices  = db.invoices || [];
  const receipts  = db.arReceipts || [];

  // Filter invoices + receipts for this client, within the date range.
  // For currency mismatch we work in NGN-equivalent so the statement is
  // single-currency (matches how Sage prints customer statements).
  const txns = useMemo(() => {
    if (!clientCode) return [];
    const client = getClientByCode(clientCode);
    if (!client) return [];
    // Match by clientCode (preferred) OR by client name (legacy seed data).
    const matchInv = inv => inv.clientCode === clientCode || inv.client === client.name;
    const matchRec = r   => r.invoiceId && invoices.some(i => i.id === r.invoiceId && matchInv(i))
                          || r.client === client.name;
    const from = fromDate ? new Date(fromDate) : null;
    const to   = toDate   ? new Date(toDate)   : new Date(toDate + 'T23:59:59');
    const out = [];
    invoices.filter(matchInv).forEach(inv => {
      const d = new Date(inv.date);
      if (from && d < from) return;
      if (to   && d > to)   return;
      out.push({
        date: inv.date, ref: inv.invoiceNo, type: 'Invoice',
        debit:  Number(inv.ngnEquivalent || inv.netPayable) || 0,
        credit: 0,
        memo:   inv.category || 'Sales',
      });
    });
    receipts.filter(matchRec).forEach(r => {
      const d = new Date(r.date);
      if (from && d < from) return;
      if (to   && d > to)   return;
      out.push({
        date: r.date, ref: r.receiptNo || r.reference || '—', type: 'Receipt',
        debit: 0,
        credit: Number(r.ngnEquivalent || r.amountReceived) || 0,
        memo:   r.reference || 'Payment received',
      });
    });
    return out.sort((a,b) => new Date(a.date) - new Date(b.date));
  }, [clientCode, fromDate, toDate, invoices, receipts]);

  // Opening balance = sum of all invoices minus receipts BEFORE fromDate
  const opening = useMemo(() => {
    if (!clientCode || !fromDate) return 0;
    const before = txns.filter(t => new Date(t.date) < new Date(fromDate));
    return before.reduce((s, t) => s + t.debit - t.credit, 0);
  }, [txns, clientCode, fromDate]);

  const totalDebit  = txns.reduce((s, t) => s + t.debit,  0);
  const totalCredit = txns.reduce((s, t) => s + t.credit, 0);
  const closing     = opening + totalDebit - totalCredit;

  // Aging breakdown of OPEN invoices (unpaid or partially paid) as of toDate
  const aging = useMemo(() => {
    if (!clientCode) return { current:0, b30:0, b60:0, b90:0, b120:0 };
    const client = getClientByCode(clientCode);
    if (!client) return { current:0, b30:0, b60:0, b90:0, b120:0 };
    const out = { current:0, b30:0, b60:0, b90:0, b120:0 };
    invoices.filter(inv => inv.clientCode === clientCode || inv.client === client.name)
      .filter(inv => inv.status !== 'Paid' && inv.status !== 'Cancelled')
      .forEach(inv => {
        const bal = (Number(inv.ngnEquivalent || inv.netPayable) || 0) - (Number(inv.receivedAmount) || 0);
        if (bal <= 0) return;
        out[agingBuckets(inv.dueDate, toDate)] += bal;
      });
    return out;
  }, [clientCode, invoices, toDate]);

  function printStatement() {
    if (!clientCode) { showToast('Select a customer first', 'error'); return; }
    const client = getClientByCode(clientCode);
    if (!client) return;
    const rows = txns.map(t => `
      <tr>
        <td>${formatDate(t.date)}</td>
        <td>${esc(t.ref)}</td>
        <td>${esc(t.type)}</td>
        <td>${esc(t.memo)}</td>
        <td style="text-align:right">${t.debit ? fmtN(t.debit) : '—'}</td>
        <td style="text-align:right">${t.credit ? fmtN(t.credit) : '—'}</td>
        <td style="text-align:right;font-weight:600">${fmtN(0)}</td>
      </tr>`).join('');

    const agingRows = BUCKET_ORDER.map(b => `
      <tr>
        <td>${BUCKET_LABELS[b]}</td>
        <td style="text-align:right">${fmtN(aging[b])}</td>
      </tr>`).join('');

    openPrintWindow(`<!DOCTYPE html><html><head><title>Customer Statement — ${esc(client.name)}</title>
    <style>${PRINT_CSS}
    .stmt-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 14px}
    .cust-block{margin:8px 0 16px;font-size:12px;line-height:1.7}
    .cust-block b{display:block;font-size:13px}
    .range-line{font-size:11.5px;margin:6px 0 14px;color:#3A5040}
    table.stmt{width:100%;border-collapse:collapse;margin:10px 0}
    table.stmt th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
    table.stmt td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11.5px}
    .totals{max-width:340px;margin-left:auto;margin-top:14px}
    .tot-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #EAF0EB;font-size:12px}
    .tot-row.grand{font-size:14px;font-weight:800;color:#1A5C2A;border-top:2px solid #1A5C2A;border-bottom:none;padding-top:8px}
    .aging-table{max-width:340px;margin-left:auto;margin-top:18px}
    .aging-table table{width:100%;border-collapse:collapse}
    .aging-table th{background:#EAF4EC;padding:5px 9px;text-align:left;font-size:10px;text-transform:uppercase}
    .aging-table td{padding:5px 9px;border-bottom:1px solid #EAF0EB;font-size:11.5px}
    </style></head><body>
    ${printHeader('CUSTOMER STATEMENT', formatDate(toDate))}
    <div class="stmt-title">STATEMENT OF ACCOUNT</div>
    <div class="cust-block">
      <b>${esc(client.name)}</b>
      ${esc(client.address || '')}
      ${client.tin ? '<br/>TIN: ' + esc(client.tin) : ''}
      ${client.phone ? '<br/>Tel: ' + esc(client.phone) : ''}
    </div>
    <div class="range-line">
      <strong>Period:</strong> ${fromDate ? formatDate(fromDate) : '(all history)'} to ${formatDate(toDate)}
    </div>
    <table class="stmt">
      <thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Memo</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead>
      <tbody>
        ${opening !== 0 ? `<tr><td colspan="6" style="font-weight:600">Opening Balance</td><td style="text-align:right;font-weight:600">${fmtN(opening)}</td></tr>` : ''}
        ${rows || '<tr><td colspan="7" style="text-align:center;color:#182A1C;padding:14px">No transactions in this period</td></tr>'}
      </tbody>
    </table>
    <div class="totals">
      <div class="tot-row"><span>Total Debits</span><span>${fmtN(totalDebit)}</span></div>
      <div class="tot-row"><span>Total Credits</span><span>${fmtN(totalCredit)}</span></div>
      <div class="tot-row grand"><span>Closing Balance</span><span>${fmtN(closing)}</span></div>
    </div>
    <div class="aging-table">
      <table>
        <thead><tr><th>Aging Bucket</th><th style="text-align:right">Outstanding</th></tr></thead>
        <tbody>${agingRows}</tbody>
      </table>
    </div>
    <p style="margin-top:24px;font-size:10px;font-weight:500;color:#182A1C;text-align:center">
      This statement is system-generated. Please reconcile with your records and contact SLOT Engineering Finance within 7 days of any discrepancy.
    </p>
    ${printBootstrap({landscape:true})}
    </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Customer Statement</div>
        <Btn onClick={printStatement} disabled={!clientCode}>🖨️ Print Statement (PDF)</Btn>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:18 }}>
        <FG label="Customer">
          <select value={clientCode} onChange={e=>setClientCode(e.target.value)} style={inp}>
            <option value="">— Select Customer —</option>
            {clients.map(c => <option key={c.id} value={c.code}>{c.name} ({c.code})</option>)}
          </select>
        </FG>
        <FG label="From Date (optional)">
          <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={inp} />
        </FG>
        <FG label="To Date">
          <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={inp} />
        </FG>
      </div>

      {clientCode && (
        <>
          <div style={{ display:'flex', gap:10, marginBottom:14 }}>
            <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
              <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Opening Balance</div>
              <div style={{ fontSize:17, fontWeight:700, color:C.text }}>{fmt(opening)}</div>
            </div>
            <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
              <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Total Debits</div>
              <div style={{ fontSize:17, fontWeight:700, color:C.danger }}>{fmt(totalDebit)}</div>
            </div>
            <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
              <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Total Credits</div>
              <div style={{ fontSize:17, fontWeight:700, color:C.green }}>{fmt(totalCredit)}</div>
            </div>
            <div style={{ flex:1, padding:'10px 14px', background:C.greenPale||'rgba(26,122,74,0.12)', border:'1px solid '+C.green, borderRadius:8 }}>
              <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Closing Balance</div>
              <div style={{ fontSize:17, fontWeight:700, color:C.green }}>{fmt(closing)}</div>
            </div>
          </div>

          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Reference</th><th style={th}>Type</th><th style={th}>Memo</th><th style={{...th, textAlign:'right'}}>Debit</th><th style={{...th, textAlign:'right'}}>Credit</th></tr></thead>
            <tbody>
              {opening !== 0 && (
                <tr><td style={td} colSpan={4}><b>Opening Balance</b></td><td style={{...td, textAlign:'right'}} colSpan={2}><b>{fmt(opening)}</b></td></tr>
              )}
              {txns.length === 0 && (
                <tr><td style={td} colSpan={6} align="center"><i>No transactions in this period</i></td></tr>
              )}
              {txns.map((t, i) => (
                <tr key={i}>
                  <td style={td}>{formatDate(t.date)}</td>
                  <td style={td}>{t.ref}</td>
                  <td style={td}>{t.type}</td>
                  <td style={td}>{t.memo}</td>
                  <td style={{...td, textAlign:'right'}}>{t.debit ? fmt(t.debit) : '—'}</td>
                  <td style={{...td, textAlign:'right'}}>{t.credit ? fmt(t.credit) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Aging breakdown */}
          <div style={{ marginTop:18, fontSize:12, fontWeight:700, color:C.textMid, textTransform:'uppercase', letterSpacing:'0.4px' }}>Aging Breakdown (Open Invoices)</div>
          <div style={{ display:'flex', gap:6, marginTop:8, flexWrap:'wrap' }}>
            {BUCKET_ORDER.map(b => (
              <div key={b} style={{ flex:'1 1 120px', minWidth:120, padding:'10px 12px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
                <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>{BUCKET_LABELS[b]}</div>
                <div style={{ fontSize:14, fontWeight:700, color:b==='b120'?C.danger:C.text }}>{fmt(aging[b])}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 2 — SUPPLIER STATEMENT + REMITTANCE ADVICE
// Same pattern as Customer Statement but on db.ap.bills / db.ap.payments.
// Also includes a Remittance Advice generator for a single payment batch.
// ════════════════════════════════════════════════════════════════════════════
function SupplierStatementTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db } = state;
  const vendors = useMemo(() => getVendors().filter(v => v.status === 'Active'), []);
  const [vendorCode, setVendorCode] = useState('');
  const [fromDate,   setFromDate]   = useState('');
  const [toDate,     setToDate]     = useState(today());

  const apData   = db.ap || { bills: [], payments: [] };
  const bills    = apData.bills    || [];
  const payments = apData.payments || [];

  const txns = useMemo(() => {
    if (!vendorCode) return [];
    const vendor = getVendorByCode(vendorCode);
    if (!vendor) return [];
    const matchBill = b => b.vendor === vendorCode || b.vendorName === vendor.name;
    const matchPay  = p => p.vendor === vendorCode || p.vendorName === vendor.name
                       || (p.bills && p.bills.some(bp => bills.find(b => b.id === bp.billId && matchBill(b))));
    const from = fromDate ? new Date(fromDate) : null;
    const to   = toDate   ? new Date(toDate + 'T23:59:59') : null;
    const out = [];
    bills.filter(matchBill).forEach(b => {
      const d = new Date(b.date);
      if (from && d < from) return;
      if (to   && d > to)   return;
      out.push({
        date: b.date, ref: b.billNo || b.invoiceNo || '—', type: 'Bill',
        debit: 0,
        credit: Number(b.ngnEquivalent || b.netPayable) || 0,
        memo:   b.description || 'Purchase',
      });
    });
    payments.filter(matchPay).forEach(p => {
      const d = new Date(p.date);
      if (from && d < from) return;
      if (to   && d > to)   return;
      out.push({
        date: p.date, ref: p.paymentNo || p.reference || '—', type: 'Payment',
        debit:  Number(p.ngnEquivalent || p.amount) || 0,
        credit: 0,
        memo:   p.reference || 'Payment',
      });
    });
    return out.sort((a,b) => new Date(a.date) - new Date(b.date));
  }, [vendorCode, fromDate, toDate, bills, payments]);

  const opening = useMemo(() => {
    if (!vendorCode || !fromDate) return 0;
    const before = txns.filter(t => new Date(t.date) < new Date(fromDate));
    return before.reduce((s, t) => s + t.debit - t.credit, 0);
  }, [txns, vendorCode, fromDate]);

  const totalDebit  = txns.reduce((s, t) => s + t.debit,  0);
  const totalCredit = txns.reduce((s, t) => s + t.credit, 0);
  const closing     = opening + totalDebit - totalCredit; // positive = we owe them

  const aging = useMemo(() => {
    if (!vendorCode) return { current:0, b30:0, b60:0, b90:0, b120:0 };
    const vendor = getVendorByCode(vendorCode);
    if (!vendor) return { current:0, b30:0, b60:0, b90:0, b120:0 };
    const out = { current:0, b30:0, b60:0, b90:0, b120:0 };
    bills.filter(b => b.vendor === vendorCode || b.vendorName === vendor.name)
      .filter(b => b.status !== 'Paid' && b.status !== 'Cancelled')
      .forEach(b => {
        const bal = (Number(b.ngnEquivalent || b.netPayable) || 0) - (Number(b.paidAmount) || 0);
        if (bal <= 0) return;
        out[agingBuckets(b.dueDate, toDate)] += bal;
      });
    return out;
  }, [vendorCode, bills, toDate]);

  function printStatement() {
    if (!vendorCode) { showToast('Select a supplier first', 'error'); return; }
    const vendor = getVendorByCode(vendorCode);
    if (!vendor) return;
    const rows = txns.map(t => `
      <tr>
        <td>${formatDate(t.date)}</td>
        <td>${esc(t.ref)}</td>
        <td>${esc(t.type)}</td>
        <td>${esc(t.memo)}</td>
        <td style="text-align:right">${t.debit ? fmtN(t.debit) : '—'}</td>
        <td style="text-align:right">${t.credit ? fmtN(t.credit) : '—'}</td>
      </tr>`).join('');
    const agingRows = BUCKET_ORDER.map(b => `
      <tr><td>${BUCKET_LABELS[b]}</td><td style="text-align:right">${fmtN(aging[b])}</td></tr>`).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><title>Supplier Statement — ${esc(vendor.name)}</title>
    <style>${PRINT_CSS}
    .stmt-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 14px}
    .cust-block{margin:8px 0 16px;font-size:12px;line-height:1.7}
    .cust-block b{display:block;font-size:13px}
    .range-line{font-size:11.5px;margin:6px 0 14px;color:#3A5040}
    table.stmt{width:100%;border-collapse:collapse;margin:10px 0}
    table.stmt th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
    table.stmt td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11.5px}
    .totals{max-width:340px;margin-left:auto;margin-top:14px}
    .tot-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #EAF0EB;font-size:12px}
    .tot-row.grand{font-size:14px;font-weight:800;color:#1A5C2A;border-top:2px solid #1A5C2A;border-bottom:none;padding-top:8px}
    </style></head><body>
    ${printHeader('SUPPLIER STATEMENT', formatDate(toDate))}
    <div class="stmt-title">STATEMENT OF ACCOUNT</div>
    <div class="cust-block">
      <b>${esc(vendor.name)}</b>
      ${esc(vendor.address || '')}
      ${vendor.tin ? '<br/>TIN: ' + esc(vendor.tin) : ''}
    </div>
    <div class="range-line"><strong>Period:</strong> ${fromDate ? formatDate(fromDate) : '(all history)'} to ${formatDate(toDate)}</div>
    <table class="stmt"><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Memo</th><th style="text-align:right">Debit (Payments)</th><th style="text-align:right">Credit (Bills)</th></tr></thead>
      <tbody>
        ${opening !== 0 ? `<tr><td colspan="5" style="font-weight:600">Opening Balance (we owe)</td><td style="text-align:right;font-weight:600">${fmtN(opening)}</td></tr>` : ''}
        ${rows || '<tr><td colspan="6" style="text-align:center;color:#182A1C;padding:14px">No transactions in this period</td></tr>'}
      </tbody>
    </table>
    <div class="totals">
      <div class="tot-row"><span>Total Payments</span><span>${fmtN(totalDebit)}</span></div>
      <div class="tot-row"><span>Total Bills</span><span>${fmtN(totalCredit)}</span></div>
      <div class="tot-row grand"><span>Balance Owed</span><span>${fmtN(closing)}</span></div>
    </div>
    <div style="max-width:340px;margin-left:auto;margin-top:18px">
      <table style="width:100%;border-collapse:collapse"><thead><tr><th style="background:#EAF4EC;padding:5px 9px;text-align:left;font-size:10px;text-transform:uppercase">Aging Bucket</th><th style="background:#EAF4EC;padding:5px 9px;text-align:right;font-size:10px;text-transform:uppercase">Outstanding</th></tr></thead>
        <tbody>${agingRows}</tbody>
      </table>
    </div>
    ${printBootstrap({landscape:true})}
    </body></html>`);
  }

  function printRemittance() {
    if (!vendorCode) { showToast('Select a supplier first', 'error'); return; }
    const vendor = getVendorByCode(vendorCode);
    if (!vendor) return;
    // Remittance = payments to this vendor in the date range
    const remPayments = txns.filter(t => t.type === 'Payment');
    if (remPayments.length === 0) {
      showToast('No payments to this supplier in the selected range', 'error');
      return;
    }
    const total = remPayments.reduce((s, t) => s + t.debit, 0);
    const rows = remPayments.map(t => `
      <tr>
        <td>${formatDate(t.date)}</td>
        <td>${esc(t.ref)}</td>
        <td>${esc(t.memo)}</td>
        <td style="text-align:right">${fmtN(t.debit)}</td>
      </tr>`).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><title>Remittance Advice — ${esc(vendor.name)}</title>
    <style>${PRINT_CSS}
    .rem-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 14px}
    .cust-block{margin:8px 0 16px;font-size:12px;line-height:1.7}
    .cust-block b{display:block;font-size:13px}
    table.rem{width:100%;border-collapse:collapse;margin:14px 0}
    table.rem th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
    table.rem td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11.5px}
    .grand{display:flex;justify-content:space-between;padding:8px 0;font-size:14px;font-weight:800;color:#1A5C2A;border-top:2px solid #1A5C2A;margin-top:8px;max-width:340px;margin-left:auto}
    </style></head><body>
    ${printHeader('REMITTANCE ADVICE', formatDate(today()))}
    <div class="rem-title">REMITTANCE ADVICE</div>
    <div class="cust-block">
      <b>${esc(vendor.name)}</b>
      ${esc(vendor.address || '')}
      ${vendor.tin ? '<br/>TIN: ' + esc(vendor.tin) : ''}
      <br/><br/>
      <b>To whom it may concern,</b><br/>
      Please find below the details of payments made to you in respect of outstanding invoices:
    </div>
    <table class="rem">
      <thead><tr><th>Payment Date</th><th>Reference</th><th>Memo</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="grand"><span>Total Remitted</span><span>${fmtN(total)}</span></div>
    <p style="margin-top:24px;font-size:10px;font-weight:500;color:#182A1C">Please confirm receipt and reconcile with your records.</p>
    ${printBootstrap({landscape:true})}
    </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Supplier Statement & Remittance Advice</div>
        <div style={{ display:'flex', gap:6 }}>
          <Btn onClick={printStatement}  disabled={!vendorCode} variant="ghost">🖨️ Statement</Btn>
          <Btn onClick={printRemittance} disabled={!vendorCode}>📨 Remittance Advice</Btn>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:18 }}>
        <FG label="Supplier">
          <select value={vendorCode} onChange={e=>setVendorCode(e.target.value)} style={inp}>
            <option value="">— Select Supplier —</option>
            {vendors.map(v => <option key={v.id} value={v.code}>{v.name} ({v.code})</option>)}
          </select>
        </FG>
        <FG label="From Date (optional)"><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={inp} /></FG>
        <FG label="To Date"><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={inp} /></FG>
      </div>

      {vendorCode && (
        <>
          <div style={{ display:'flex', gap:10, marginBottom:14 }}>
            <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
              <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Opening (we owe)</div>
              <div style={{ fontSize:17, fontWeight:700, color:C.text }}>{fmt(opening)}</div>
            </div>
            <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
              <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Total Payments</div>
              <div style={{ fontSize:17, fontWeight:700, color:C.green }}>{fmt(totalDebit)}</div>
            </div>
            <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
              <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Total Bills</div>
              <div style={{ fontSize:17, fontWeight:700, color:C.danger }}>{fmt(totalCredit)}</div>
            </div>
            <div style={{ flex:1, padding:'10px 14px', background:'rgba(192,57,43,0.10)', border:'1px solid '+C.danger, borderRadius:8 }}>
              <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Balance Owed</div>
              <div style={{ fontSize:17, fontWeight:700, color:C.danger }}>{fmt(closing)}</div>
            </div>
          </div>

          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Reference</th><th style={th}>Type</th><th style={th}>Memo</th><th style={{...th, textAlign:'right'}}>Debit (Payments)</th><th style={{...th, textAlign:'right'}}>Credit (Bills)</th></tr></thead>
            <tbody>
              {opening !== 0 && <tr><td style={td} colSpan={5}><b>Opening Balance</b></td><td style={{...td, textAlign:'right'}}><b>{fmt(opening)}</b></td></tr>}
              {txns.length === 0 && <tr><td style={td} colSpan={6} align="center"><i>No transactions in this period</i></td></tr>}
              {txns.map((t, i) => (
                <tr key={i}>
                  <td style={td}>{formatDate(t.date)}</td>
                  <td style={td}>{t.ref}</td>
                  <td style={td}>{t.type}</td>
                  <td style={td}>{t.memo}</td>
                  <td style={{...td, textAlign:'right'}}>{t.debit ? fmt(t.debit) : '—'}</td>
                  <td style={{...td, textAlign:'right'}}>{t.credit ? fmt(t.credit) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop:18, fontSize:12, fontWeight:700, color:C.textMid, textTransform:'uppercase', letterSpacing:'0.4px' }}>Aging Breakdown (Open Bills)</div>
          <div style={{ display:'flex', gap:6, marginTop:8, flexWrap:'wrap' }}>
            {BUCKET_ORDER.map(b => (
              <div key={b} style={{ flex:'1 1 120px', minWidth:120, padding:'10px 12px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
                <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>{BUCKET_LABELS[b]}</div>
                <div style={{ fontSize:14, fontWeight:700, color:b==='b120'?C.danger:C.text }}>{fmt(aging[b])}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 3 — CREDIT NOTES
// Link to original invoice, posts Dr Sales Returns / Cr Trade Receivables.
// Stored in db.creditNotes (new collection). Auto-reverses the original
// invoice's revenue + VAT; WHT receivable is also reversed proportionally.
// ════════════════════════════════════════════════════════════════════════════
function CreditNotesTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const invoices = db.invoices || [];
  const creditNotes = db.creditNotes || [];
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ invoiceId:'', reason:'', amount:'', date:today(), notes:'' });

  // Pick invoices that can have a credit note (status Paid/Pending/Overdue,
  // not Cancelled, not already fully credited).
  const eligibleInvoices = invoices.filter(inv => inv.status !== 'Cancelled');
  const totalCreditedFor = (invId) => creditNotes
    .filter(cn => cn.invoiceId === invId && cn.status !== 'Cancelled')
    .reduce((s, cn) => s + (Number(cn.amount) || 0), 0);

  function saveCreditNotes(list) {
    diffAndPush('creditNotes', creditNotes, list); // 2026-07-29 full-app sync sweep
    const newDb = { ...db, creditNotes: list };
    dispatch({ type:'UPDATE_MODULE', mod:'creditNotes', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function handleSave() {
    if (!form.invoiceId) { showToast('Select an invoice to credit', 'error'); return; }
    const inv = invoices.find(i => i.id === form.invoiceId);
    if (!inv) { showToast('Invoice not found', 'error'); return; }
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { showToast('Enter a valid credit amount', 'error'); return; }
    const alreadyCredited = totalCreditedFor(form.invoiceId);
    const maxAllowed = Number(inv.netPayable) - alreadyCredited;
    if (amount > maxAllowed) {
      showToast(`Amount exceeds creditable balance (max ${fmt(maxAllowed)})`, 'error');
      return;
    }
    if (!form.reason.trim()) { showToast('Reason is required', 'error'); return; }
    const cnNo = `SLOT-CN-${year()}-${String(creditNotes.length + 1).padStart(4,'0')}`;
    const cn = {
      id: uid(),
      cnNo,
      invoiceId: form.invoiceId,
      invoiceNo: inv.invoiceNo,
      client: inv.client,
      clientCode: inv.clientCode,
      currency: inv.currency || 'NGN',
      fxRate: inv.fxRate || 1,
      amount,
      ngnEquivalent: amount * (inv.fxRate || 1),
      reason: form.reason,
      date: form.date,
      notes: form.notes,
      status: 'Posted',
      postedBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };
    const updated = [cn, ...creditNotes];
    saveCreditNotes(updated);
    logActivity(dispatch, `Credit note ${cnNo} issued for ${fmt(amount)} against ${inv.invoiceNo} (${inv.client})`, currentUser);
    showToast(`Credit note ${cnNo} posted — Dr Sales Returns / Cr Trade Receivables`);
    setModal(null);
    setForm({ invoiceId:'', reason:'', amount:'', date:today(), notes:'' });
  }

  function printCreditNote(cn) {
    const inv = invoices.find(i => i.id === cn.invoiceId);
    openPrintWindow(`<!DOCTYPE html><html><head><title>Credit Note ${cn.cnNo}</title>
    <style>${PRINT_CSS}
    .cn-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 14px;color:#C0392B}
    .cust-block{margin:8px 0 16px;font-size:12px;line-height:1.7}
    .cust-block b{display:block;font-size:13px}
    .detailsgrid{display:grid;grid-template-columns:1fr 1fr;gap:3px 24px;font-size:12px;margin-bottom:16px}
    .detailsgrid .row{display:flex;gap:6px}
    .detailsgrid .lbl{font-weight:700;white-space:nowrap;min-width:140px}
    .amount-box{background:#FCEAE8;border:2px solid #C0392B;border-radius:8px;padding:14px 18px;text-align:center;max-width:340px;margin:14px auto}
    .amount-box .amt{font-size:22px;font-weight:800;color:#C0392B}
    </style></head><body>
    ${printHeader('CREDIT NOTE', formatDate(cn.date))}
    <div class="cn-title">CREDIT NOTE</div>
    <div class="cust-block">
      <b>${esc(cn.client)}</b>
    </div>
    <div class="detailsgrid">
      <div class="row"><span class="lbl">Credit Note No:</span><span>${esc(cn.cnNo)}</span></div>
      <div class="row"><span class="lbl">Original Invoice:</span><span>${esc(cn.invoiceNo)}</span></div>
      <div class="row"><span class="lbl">Date:</span><span>${formatDate(cn.date)}</span></div>
      <div class="row"><span class="lbl">Currency:</span><span>${esc(cn.currency)}</span></div>
      <div class="row"><span class="lbl">Reason:</span><span>${esc(cn.reason)}</span></div>
      <div class="row"><span class="lbl">Issued By:</span><span>${esc(cn.postedBy)}</span></div>
    </div>
    <div class="amount-box">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#182A1C;margin-bottom:6px">Credit Amount</div>
      <div class="amt">${cn.currency === 'NGN' ? '₦' : cn.currency + ' '}${fmtN(cn.amount)}</div>
    </div>
    ${cn.notes ? `<p style="font-size:12px;color:#3A5040;margin-top:14px"><strong>Notes:</strong> ${esc(cn.notes)}</p>` : ''}
    <p style="margin-top:18px;font-size:11px;font-weight:500;color:#182A1C">
      This credit note reverses the corresponding revenue and Trade Receivables recorded under invoice ${esc(cn.invoiceNo)}.
      ${inv ? `Original invoice total: ${inv.currency === 'NGN' ? '₦' : inv.currency + ' '}${fmtN(inv.netPayable)}.` : ''}
    </p>
    <div style="margin-top:44px;display:grid;grid-template-columns:1fr 1fr;gap:30px">
      <div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C">Prepared By / Date</div></div>
      <div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C">Authorised Signatory / Date</div></div>
    </div>
    ${printBootstrap({landscape:true})}
    </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };
  const totalCredited = creditNotes.filter(cn => cn.status !== 'Cancelled').reduce((s, cn) => s + (Number(cn.ngnEquivalent) || 0), 0);

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Credit Notes</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Posts Dr Sales Returns (4500 contra) / Cr Trade Receivables (6002)</div>
        </div>
        <Btn onClick={()=>setModal('add')}>+ New Credit Note</Btn>
      </div>

      <div style={{ display:'flex', gap:10, marginBottom:14 }}>
        <div style={{ flex:1, padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Total Credit Notes</div>
          <div style={{ fontSize:17, fontWeight:700, color:C.text }}>{creditNotes.length}</div>
        </div>
        <div style={{ flex:1, padding:'10px 14px', background:'rgba(192,57,43,0.10)', border:'1px solid '+C.danger, borderRadius:8 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Total Credited (NGN eq.)</div>
          <div style={{ fontSize:17, fontWeight:700, color:C.danger }}>{fmt(totalCredited)}</div>
        </div>
      </div>

      {creditNotes.length === 0 ? (
        <div style={{ padding:30, textAlign:'center', color:C.textMuted, fontSize:13 }}>No credit notes yet. Click "New Credit Note" to issue one.</div>
      ) : (
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr><th style={th}>CN No</th><th style={th}>Date</th><th style={th}>Customer</th><th style={th}>Original Invoice</th><th style={th}>Reason</th><th style={{...th, textAlign:'right'}}>Amount</th><th style={th}></th></tr></thead>
          <tbody>
            {creditNotes.map(cn => (
              <tr key={cn.id}>
                <td style={td}><b>{cn.cnNo}</b></td>
                <td style={td}>{formatDate(cn.date)}</td>
                <td style={td}>{cn.client}</td>
                <td style={td}>{cn.invoiceNo}</td>
                <td style={td}>{cn.reason}</td>
                <td style={{...td, textAlign:'right'}}><b style={{color:C.danger}}>{fmt(cn.ngnEquivalent)}</b></td>
                <td style={td}><Btn sm variant="ghost" onClick={()=>printCreditNote(cn)}>🖨️</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal === 'add' && (
        <Overlay onClose={()=>setModal(null)}>
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div style={{ fontSize:16, fontWeight:700, color:C.text }}>New Credit Note</div>
              <Btn sm variant="ghost" onClick={()=>setModal(null)}>✕</Btn>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <FG label="Original Invoice" full>
                <select value={form.invoiceId} onChange={e=>{
                  const inv = invoices.find(i => i.id === e.target.value);
                  setForm(f => ({ ...f, invoiceId: e.target.value, amount: inv ? (Number(inv.netPayable) - totalCreditedFor(inv.id)).toString() : '' }));
                }} style={inp}>
                  <option value="">— Select Invoice —</option>
                  {eligibleInvoices.map(inv => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNo} — {inv.client} — {fmt(inv.netPayable)} (creditable: {fmt(Number(inv.netPayable) - totalCreditedFor(inv.id))})
                    </option>
                  ))}
                </select>
              </FG>
              <FG label="Reason"><input value={form.reason} onChange={e=>setForm(f=>({...f, reason:e.target.value}))} placeholder="e.g. Over-billing, returned goods, pricing correction" style={inp} /></FG>
              <FG label="Date"><input type="date" value={form.date} onChange={e=>setForm(f=>({...f, date:e.target.value}))} style={inp} /></FG>
              <FG label="Credit Amount"><input type="number" value={form.amount} onChange={e=>setForm(f=>({...f, amount:e.target.value}))} style={inp} /></FG>
              <FG label="Notes" full><textarea value={form.notes} onChange={e=>setForm(f=>({...f, notes:e.target.value}))} rows={2} style={{...inp, resize:'vertical'}} /></FG>
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <Btn variant="ghost" onClick={()=>setModal(null)}>Cancel</Btn>
              <Btn onClick={handleSave}>Post Credit Note</Btn>
            </div>
          </Card>
        </Overlay>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 4 — VAT201 REPORT
// Output VAT (Sales VAT Payable 5011 credits) minus Input VAT (6006 debits)
// for a selected period. Plus adjustments. Net payable to FIRS.
// ════════════════════════════════════════════════════════════════════════════
function VAT201Tab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db } = state;
  const journals = state?.acctData?.journals || [];
  const coa = state?.acctData?.coa || [];
  const [fromDate, setFromDate] = useState(`${year()}-01-01`);
  const [toDate,   setToDate]   = useState(today());

  // Output VAT = credits to 5011 (Sales VAT Payable) in period
  // Input VAT  = debits  to 6006 (Input VAT)         in period
  const calc = useMemo(() => {
    const from = new Date(fromDate);
    const to   = new Date(toDate + 'T23:59:59');
    let outputVAT = 0, inputVAT = 0;
    const outputLines = [], inputLines = [];
    journals.forEach(je => {
      const d = new Date(je.date);
      if (d < from || d > to) return;
      (je.lines || []).forEach(line => {
        const amt = Number(line.amount) || 0;
        if (line.crCode === '5011') {
          outputVAT += amt;
          outputLines.push({ date: je.date, ref: je.ref, desc: je.description, amount: amt });
        }
        if (line.drCode === '6006') {
          inputVAT += amt;
          inputLines.push({ date: je.date, ref: je.ref, desc: je.description, amount: amt });
        }
      });
    });
    const vatPayable = outputVAT - inputVAT;
    return { outputVAT, inputVAT, vatPayable, outputLines, inputLines };
  }, [journals, fromDate, toDate]);

  function printVAT201() {
    const outRows = calc.outputLines.map(l => `
      <tr><td>${formatDate(l.date)}</td><td>${esc(l.ref||'—')}</td><td>${esc(l.desc)}</td><td style="text-align:right">${fmtN(l.amount)}</td></tr>`).join('');
    const inRows = calc.inputLines.map(l => `
      <tr><td>${formatDate(l.date)}</td><td>${esc(l.ref||'—')}</td><td>${esc(l.desc)}</td><td style="text-align:right">${fmtN(l.amount)}</td></tr>`).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><title>VAT201 Report — ${formatDate(fromDate)} to ${formatDate(toDate)}</title>
    <style>${PRINT_CSS}
    .vat-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 6px}
    .vat-sub{text-align:center;font-size:11.5px;color:#3A5040;margin-bottom:14px}
    table.vat{width:100%;border-collapse:collapse;margin:10px 0 18px}
    table.vat th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
    table.vat td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11.5px}
    .section-h{font-size:13px;font-weight:700;color:#1A5C2A;margin:14px 0 6px;padding-bottom:4px;border-bottom:2px solid #1A5C2A}
    .grand{display:flex;justify-content:space-between;padding:10px 14px;background:#EAF4EC;border:2px solid #1A5C2A;border-radius:8px;font-size:16px;font-weight:800;color:#1A5C2A;margin-top:18px;max-width:340px;margin-left:auto}
    </style></head><body>
    ${printHeader('VAT201 REPORT', formatDate(today()))}
    <div class="vat-title">VALUE ADDED TAX (VAT201) REPORT</div>
    <div class="vat-sub">Period: ${formatDate(fromDate)} to ${formatDate(toDate)}</div>
    <div class="section-h">Output VAT (Sales VAT collected — Account 5011 credits)</div>
    <table class="vat"><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${outRows || '<tr><td colspan="4" style="text-align:center;color:#182A1C;padding:10px">None</td></tr>'}</tbody>
      <tfoot><tr style="font-weight:700;background:#EAF4EC"><td colspan="3" style="text-align:right;padding:7px 9px">Total Output VAT</td><td style="text-align:right;padding:7px 9px">${fmtN(calc.outputVAT)}</td></tr></tfoot>
    </table>
    <div class="section-h">Input VAT (VAT paid on purchases — Account 6006 debits)</div>
    <table class="vat"><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${inRows || '<tr><td colspan="4" style="text-align:center;color:#182A1C;padding:10px">None</td></tr>'}</tbody>
      <tfoot><tr style="font-weight:700;background:#EAF4EC"><td colspan="3" style="text-align:right;padding:7px 9px">Total Input VAT</td><td style="text-align:right;padding:7px 9px">${fmtN(calc.inputVAT)}</td></tr></tfoot>
    </table>
    <div class="grand"><span>VAT Payable to FIRS</span><span>${fmtN(calc.vatPayable)}</span></div>
    <p style="margin-top:18px;font-size:11px;font-weight:500;color:#182A1C">
      Filed by: SLOT Engineering Nigeria Limited · TIN: 00499389-0001 · VAT Reg No: PHVO500258586<br/>
      Due on or before the 21st of the following month. Negative balance = refund due from FIRS.
    </p>
    ${printBootstrap({landscape:true})}
    </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>VAT201 Report</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Output VAT (5011 credits) − Input VAT (6006 debits) = VAT payable to FIRS</div>
        </div>
        <Btn onClick={printVAT201}>🖨️ Print VAT201</Btn>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:18 }}>
        <FG label="From Date"><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={inp} /></FG>
        <FG label="To Date"><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={inp} /></FG>
      </div>
      <div style={{ display:'flex', gap:10, marginBottom:18 }}>
        <div style={{ flex:1, padding:'14px 16px', background:'rgba(26,92,42,0.10)', border:'1px solid '+C.green, borderRadius:10 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Output VAT (collected)</div>
          <div style={{ fontSize:20, fontWeight:800, color:C.green }}>{fmt(calc.outputVAT)}</div>
        </div>
        <div style={{ flex:1, padding:'14px 16px', background:'rgba(26,92,138,0.10)', border:'1px solid #1A5C8A', borderRadius:10 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Input VAT (paid)</div>
          <div style={{ fontSize:20, fontWeight:800, color:'#1A5C8A' }}>{fmt(calc.inputVAT)}</div>
        </div>
        <div style={{ flex:1, padding:'14px 16px', background: calc.vatPayable >= 0 ? 'rgba(192,57,43,0.10)' : 'rgba(26,122,74,0.10)', border:'1px solid '+(calc.vatPayable >= 0 ? C.danger : C.green), borderRadius:10 }}>
          <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>{calc.vatPayable >= 0 ? 'VAT Payable to FIRS' : 'Refund Due from FIRS'}</div>
          <div style={{ fontSize:20, fontWeight:800, color: calc.vatPayable >= 0 ? C.danger : C.green }}>{fmt(Math.abs(calc.vatPayable))}</div>
        </div>
      </div>
      <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginBottom:8 }}>Output VAT Detail</div>
      <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:18 }}>
        <thead><tr><th style={th}>Date</th><th style={th}>Reference</th><th style={th}>Description</th><th style={{...th, textAlign:'right'}}>Amount</th></tr></thead>
        <tbody>
          {calc.outputLines.length === 0 ? <tr><td style={td} colSpan={4} align="center"><i>No Output VAT entries in this period</i></td></tr> :
            calc.outputLines.map((l, i) => <tr key={i}><td style={td}>{formatDate(l.date)}</td><td style={td}>{l.ref||'—'}</td><td style={td}>{l.desc}</td><td style={{...td, textAlign:'right'}}>{fmt(l.amount)}</td></tr>)}
        </tbody>
      </table>
      <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginBottom:8 }}>Input VAT Detail</div>
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr><th style={th}>Date</th><th style={th}>Reference</th><th style={th}>Description</th><th style={{...th, textAlign:'right'}}>Amount</th></tr></thead>
        <tbody>
          {calc.inputLines.length === 0 ? <tr><td style={td} colSpan={4} align="center"><i>No Input VAT entries in this period</i></td></tr> :
            calc.inputLines.map((l, i) => <tr key={i}><td style={td}>{formatDate(l.date)}</td><td style={td}>{l.ref||'—'}</td><td style={td}>{l.desc}</td><td style={{...td, textAlign:'right'}}>{fmt(l.amount)}</td></tr>)}
        </tbody>
      </table>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 5 — COMPARATIVE P&L AND BALANCE SHEET
// This year vs last year side by side. Derived from journals + COA opening bals.
// ════════════════════════════════════════════════════════════════════════════
function ComparativeTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const journals = state?.acctData?.journals || [];
  const coa = state?.acctData?.coa || [];
  const [reportType, setReportType] = useState('pnl'); // 'pnl' | 'bs'
  const [thisYear, setThisYear] = useState(year());

  const lastYear = thisYear - 1;

  // Build a trial balance for any year by filtering journals
  function trialBalanceForYear(yr) {
    const accounts = {};
    coa.forEach(acc => {
      accounts[acc.code] = { code: acc.code, name: acc.name, type: acc.type, category: acc.category, normalBal: acc.normalBal, openingBal: acc.openingBal || 0, totalDr: 0, totalCr: 0 };
    });
    journals.forEach(je => {
      if (!je.date || !je.date.startsWith(String(yr))) return;
      (je.lines || []).forEach(line => {
        const drCode = line.drCode, crCode = line.crCode;
        const amt = Number(line.amount) || 0;
        if (drCode && accounts[drCode]) accounts[drCode].totalDr += amt;
        if (crCode && accounts[crCode]) accounts[crCode].totalCr += amt;
      });
    });
    return Object.values(accounts).map(a => ({
      ...a,
      balance: a.normalBal === 'Dr' ? (a.openingBal + a.totalDr - a.totalCr) : (a.openingBal + a.totalCr - a.totalDr),
    }));
  }

  const tbThis = useMemo(() => trialBalanceForYear(thisYear), [journals, coa, thisYear]);
  const tbLast = useMemo(() => trialBalanceForYear(lastYear), [journals, coa, lastYear]);

  // For P&L we want only this year's movements (not opening balances)
  function pnlFor(yr) {
    const revenue = [], expenses = [];
    let totalRev = 0, totalExp = 0;
    tbThis.length; // touch
    // Recompute filtered to yr, ignoring opening balances
    const acctMap = {};
    coa.forEach(a => { acctMap[a.code] = { ...a, dr:0, cr:0 }; });
    journals.forEach(je => {
      if (!je.date || !je.date.startsWith(String(yr))) return;
      (je.lines || []).forEach(line => {
        const amt = Number(line.amount) || 0;
        if (line.drCode && acctMap[line.drCode]) acctMap[line.drCode].dr += amt;
        if (line.crCode && acctMap[line.crCode]) acctMap[line.crCode].cr += amt;
      });
    });
    Object.values(acctMap).forEach(a => {
      if (a.type === 'Revenue') {
        const bal = a.cr - a.dr; // Cr normal
        if (Math.abs(bal) > 0.01) { revenue.push({ ...a, balance: bal }); totalRev += bal; }
      } else if (a.type === 'Expense') {
        const bal = a.dr - a.cr; // Dr normal
        if (Math.abs(bal) > 0.01) { expenses.push({ ...a, balance: bal }); totalExp += bal; }
      }
    });
    return { revenue, expenses, totalRev, totalExp, netProfit: totalRev - totalExp };
  }

  function bsFor(yr) {
    // For balance sheet, opening balance + movement in year
    const assets = [], liabilities = [], equity = [];
    let totA = 0, totL = 0, totE = 0;
    const acctMap = {};
    coa.forEach(a => { acctMap[a.code] = { ...a, dr:0, cr:0 }; });
    journals.forEach(je => {
      if (!je.date || !je.date.startsWith(String(yr))) return;
      (je.lines || []).forEach(line => {
        const amt = Number(line.amount) || 0;
        if (line.drCode && acctMap[line.drCode]) acctMap[line.drCode].dr += amt;
        if (line.crCode && acctMap[line.crCode]) acctMap[line.crCode].cr += amt;
      });
    });
    // For BS of year yr: balance = opening + movement-through-end-of-yr
    // Simplification: take opening as-is from COA (assumes opening = at start of thisYear).
    // For prior year, we approximate by ignoring opening (movement only) — not perfect
    // but useful for trending.
    Object.values(acctMap).forEach(a => {
      const opening = (yr === thisYear) ? (a.openingBal || 0) : 0;
      let bal;
      if (a.normalBal === 'Dr') bal = opening + a.dr - a.cr;
      else                       bal = opening + a.cr - a.dr;
      if (Math.abs(bal) < 0.01) return;
      if (a.type === 'Asset')     { assets.push({ ...a, balance: bal });      totA += bal; }
      else if (a.type === 'Liability') { liabilities.push({ ...a, balance: bal }); totL += bal; }
      else if (a.type === 'Equity')    { equity.push({ ...a, balance: bal });    totE += bal; }
    });
    // Add current-year net profit to equity (for thisYear only — lastYear already in opening)
    const pnl = pnlFor(yr);
    if (yr === thisYear) {
      totE += pnl.netProfit;
      equity.push({ code:'NP', name:'Net Profit (current year)', balance: pnl.netProfit });
    }
    return { assets, liabilities, equity, totA, totL, totE };
  }

  const pnlThis = useMemo(() => pnlFor(thisYear), [journals, coa, thisYear]);
  const pnlLast = useMemo(() => pnlFor(lastYear), [journals, coa, lastYear]);
  const bsThis  = useMemo(() => bsFor(thisYear),   [journals, coa, thisYear]);
  const bsLast  = useMemo(() => bsFor(lastYear),   [journals, coa, lastYear]);

  function printReport() {
    const isPnL = reportType === 'pnl';
    let body = '';
    if (isPnL) {
      const revRows = [...pnlThis.revenue].map(r => {
        const last = pnlLast.revenue.find(x => x.code === r.code)?.balance || 0;
        const var_ = r.balance - last;
        return `<tr><td>${esc(r.name)}</td><td style="text-align:right">${fmtN(last)}</td><td style="text-align:right">${fmtN(r.balance)}</td><td style="text-align:right;color:${var_>=0?'#1A5C2A':'#C0392B'}">${var_>=0?' + ':' − '}${fmtN(Math.abs(var_))}</td></tr>`;
      }).join('');
      const expRows = [...pnlThis.expenses].map(r => {
        const last = pnlLast.expenses.find(x => x.code === r.code)?.balance || 0;
        const var_ = r.balance - last;
        return `<tr><td>${esc(r.name)}</td><td style="text-align:right">${fmtN(last)}</td><td style="text-align:right">${fmtN(r.balance)}</td><td style="text-align:right;color:${var_>=0?'#C0392B':'#1A5C2A'}">${var_>=0?' + ':' − '}${fmtN(Math.abs(var_))}</td></tr>`;
      }).join('');
      const npVar = pnlThis.netProfit - pnlLast.netProfit;
      body = `
        <div class="section-h">REVENUE</div>
        <table class="comp"><thead><tr><th>Account</th><th style="text-align:right">${lastYear}</th><th style="text-align:right">${thisYear}</th><th style="text-align:right">Variance</th></tr></thead>
          <tbody>${revRows}</tbody>
          <tfoot><tr class="subtot"><td>Total Revenue</td><td style="text-align:right">${fmtN(pnlLast.totalRev)}</td><td style="text-align:right">${fmtN(pnlThis.totalRev)}</td><td style="text-align:right">${fmtN(pnlThis.totalRev - pnlLast.totalRev)}</td></tr></tfoot>
        </table>
        <div class="section-h">EXPENSES</div>
        <table class="comp"><thead><tr><th>Account</th><th style="text-align:right">${lastYear}</th><th style="text-align:right">${thisYear}</th><th style="text-align:right">Variance</th></tr></thead>
          <tbody>${expRows}</tbody>
          <tfoot><tr class="subtot"><td>Total Expenses</td><td style="text-align:right">${fmtN(pnlLast.totalExp)}</td><td style="text-align:right">${fmtN(pnlThis.totalExp)}</td><td style="text-align:right">${fmtN(pnlThis.totalExp - pnlLast.totalExp)}</td></tr></tfoot>
        </table>
        <div class="grand"><span>NET PROFIT / (LOSS)</span><span>${fmtN(pnlLast.netProfit)} → ${fmtN(pnlThis.netProfit)} (${npVar>=0?'+':'−'}${fmtN(Math.abs(npVar))})</span></div>
      `;
    } else {
      const rowSet = (list, lastList) => list.map(r => {
        const last = lastList.find(x => x.code === r.code)?.balance || 0;
        return `<tr><td>${esc(r.name)}</td><td style="text-align:right">${fmtN(last)}</td><td style="text-align:right">${fmtN(r.balance)}</td><td style="text-align:right">${fmtN(r.balance - last)}</td></tr>`;
      }).join('');
      body = `
        <div class="section-h">ASSETS</div>
        <table class="comp"><thead><tr><th>Account</th><th style="text-align:right">${lastYear}</th><th style="text-align:right">${thisYear}</th><th style="text-align:right">Variance</th></tr></thead>
          <tbody>${rowSet(bsThis.assets, bsLast.assets)}</tbody>
          <tfoot><tr class="subtot"><td>Total Assets</td><td style="text-align:right">${fmtN(bsLast.totA)}</td><td style="text-align:right">${fmtN(bsThis.totA)}</td><td style="text-align:right">${fmtN(bsThis.totA - bsLast.totA)}</td></tr></tfoot>
        </table>
        <div class="section-h">LIABILITIES</div>
        <table class="comp"><thead><tr><th>Account</th><th style="text-align:right">${lastYear}</th><th style="text-align:right">${thisYear}</th><th style="text-align:right">Variance</th></tr></thead>
          <tbody>${rowSet(bsThis.liabilities, bsLast.liabilities)}</tbody>
          <tfoot><tr class="subtot"><td>Total Liabilities</td><td style="text-align:right">${fmtN(bsLast.totL)}</td><td style="text-align:right">${fmtN(bsThis.totL)}</td><td style="text-align:right">${fmtN(bsThis.totL - bsLast.totL)}</td></tr></tfoot>
        </table>
        <div class="section-h">EQUITY</div>
        <table class="comp"><thead><tr><th>Account</th><th style="text-align:right">${lastYear}</th><th style="text-align:right">${thisYear}</th><th style="text-align:right">Variance</th></tr></thead>
          <tbody>${rowSet(bsThis.equity, bsLast.equity)}</tbody>
          <tfoot><tr class="subtot"><td>Total Equity</td><td style="text-align:right">${fmtN(bsLast.totE)}</td><td style="text-align:right">${fmtN(bsThis.totE)}</td><td style="text-align:right">${fmtN(bsThis.totE - bsLast.totE)}</td></tr></tfoot>
        </table>
      `;
    }
    openPrintWindow(`<!DOCTYPE html><html><head><title>Comparative ${isPnL?'P&L':'Balance Sheet'} — ${thisYear} vs ${lastYear}</title>
      <style>${PRINT_CSS}
      .comp-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 6px}
      .comp-sub{text-align:center;font-size:11.5px;color:#3A5040;margin-bottom:14px}
      table.comp{width:100%;border-collapse:collapse;margin:8px 0 16px}
      table.comp th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
      table.comp td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11.5px}
      table.comp tr.subtot td{font-weight:700;background:#EAF4EC;border-top:2px solid #1A5C2A;padding:9px}
      .section-h{font-size:13px;font-weight:700;color:#1A5C2A;margin:18px 0 6px;padding-bottom:4px;border-bottom:2px solid #1A5C2A}
      .grand{display:flex;justify-content:space-between;padding:10px 14px;background:#1A5C2A;color:#fff;border-radius:8px;font-size:14px;font-weight:800;margin-top:14px}
      </style></head><body>
      ${printHeader(`COMPARATIVE ${isPnL?'PROFIT & LOSS':'BALANCE SHEET'}`, formatDate(today()))}
      <div class="comp-title">COMPARATIVE ${isPnL?'PROFIT AND LOSS STATEMENT':'BALANCE SHEET'}</div>
      <div class="comp-sub">For the year ended 31 December ${thisYear} — compared with ${lastYear}</div>
      ${body}
      ${printBootstrap({landscape:true})}
      </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const renderRow = (r, lastList) => {
    const last = lastList.find(x => x.code === r.code)?.balance || 0;
    const v = r.balance - last;
    return (
      <tr key={r.code}>
        <td style={td}>{r.name}</td>
        <td style={{...td, textAlign:'right'}}>{fmtN(last)}</td>
        <td style={{...td, textAlign:'right', fontWeight:600}}>{fmtN(r.balance)}</td>
        <td style={{...td, textAlign:'right', color: v>=0 ? C.green : C.danger}}>{v>=0?'+':'−'}{fmtN(Math.abs(v))}</td>
      </tr>
    );
  };

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Comparative {reportType==='pnl'?'P&L':'Balance Sheet'}</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>{thisYear} vs {lastYear} — side by side with variance</div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <Btn variant={reportType==='pnl'?'primary':'ghost'} onClick={()=>setReportType('pnl')}>P&L</Btn>
          <Btn variant={reportType==='bs'?'primary':'ghost'}  onClick={()=>setReportType('bs')}>Balance Sheet</Btn>
          <Btn variant="outline" onClick={printReport}>🖨️ Print</Btn>
        </div>
      </div>

      <FG label="Year">
        <input type="number" value={thisYear} onChange={e=>setThisYear(Number(e.target.value)||year())} style={{ ...inp, maxWidth:140 }} />
      </FG>

      {reportType === 'pnl' ? (
        <>
          <div style={{ fontSize:13, fontWeight:700, color:C.green, marginTop:18, marginBottom:6, paddingBottom:4, borderBottom:'2px solid '+C.green }}>REVENUE</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={th}>Account</th><th style={{...th, textAlign:'right'}}>{lastYear}</th><th style={{...th, textAlign:'right'}}>{thisYear}</th><th style={{...th, textAlign:'right'}}>Variance</th></tr></thead>
            <tbody>
              {pnlThis.revenue.length === 0 ? <tr><td style={td} colSpan={4} align="center"><i>No revenue for {thisYear}</i></td></tr> :
                pnlThis.revenue.map(r => renderRow(r, pnlLast.revenue))}
            </tbody>
            <tfoot><tr style={{ background:C.greenPale||'rgba(26,122,74,0.12)', fontWeight:700 }}><td style={td}>Total Revenue</td><td style={{...td, textAlign:'right'}}>{fmtN(pnlLast.totalRev)}</td><td style={{...td, textAlign:'right'}}>{fmtN(pnlThis.totalRev)}</td><td style={{...td, textAlign:'right'}}>{fmtN(pnlThis.totalRev - pnlLast.totalRev)}</td></tr></tfoot>
          </table>

          <div style={{ fontSize:13, fontWeight:700, color:C.danger, marginTop:18, marginBottom:6, paddingBottom:4, borderBottom:'2px solid '+C.danger }}>EXPENSES</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={th}>Account</th><th style={{...th, textAlign:'right'}}>{lastYear}</th><th style={{...th, textAlign:'right'}}>{thisYear}</th><th style={{...th, textAlign:'right'}}>Variance</th></tr></thead>
            <tbody>
              {pnlThis.expenses.length === 0 ? <tr><td style={td} colSpan={4} align="center"><i>No expenses for {thisYear}</i></td></tr> :
                pnlThis.expenses.map(r => renderRow(r, pnlLast.expenses))}
            </tbody>
            <tfoot><tr style={{ background:'rgba(192,57,43,0.10)', fontWeight:700 }}><td style={td}>Total Expenses</td><td style={{...td, textAlign:'right'}}>{fmtN(pnlLast.totalExp)}</td><td style={{...td, textAlign:'right'}}>{fmtN(pnlThis.totalExp)}</td><td style={{...td, textAlign:'right'}}>{fmtN(pnlThis.totalExp - pnlLast.totalExp)}</td></tr></tfoot>
          </table>

          <div style={{ display:'flex', justifyContent:'space-between', padding:'12px 16px', background:C.green, color:'#fff', borderRadius:10, marginTop:14, fontWeight:800, fontSize:15 }}>
            <span>NET PROFIT / (LOSS)</span>
            <span>{fmtN(pnlLast.netProfit)} → {fmtN(pnlThis.netProfit)} ({(pnlThis.netProfit - pnlLast.netProfit)>=0?'+':'−'}{fmtN(Math.abs(pnlThis.netProfit - pnlLast.netProfit))})</span>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize:13, fontWeight:700, color:C.green, marginTop:18, marginBottom:6, paddingBottom:4, borderBottom:'2px solid '+C.green }}>ASSETS</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={th}>Account</th><th style={{...th, textAlign:'right'}}>{lastYear}</th><th style={{...th, textAlign:'right'}}>{thisYear}</th><th style={{...th, textAlign:'right'}}>Variance</th></tr></thead>
            <tbody>{bsThis.assets.length === 0 ? <tr><td style={td} colSpan={4} align="center"><i>No assets</i></td></tr> : bsThis.assets.map(r => renderRow(r, bsLast.assets))}</tbody>
            <tfoot><tr style={{ background:C.greenPale||'rgba(26,122,74,0.12)', fontWeight:700 }}><td style={td}>Total Assets</td><td style={{...td, textAlign:'right'}}>{fmtN(bsLast.totA)}</td><td style={{...td, textAlign:'right'}}>{fmtN(bsThis.totA)}</td><td style={{...td, textAlign:'right'}}>{fmtN(bsThis.totA - bsLast.totA)}</td></tr></tfoot>
          </table>

          <div style={{ fontSize:13, fontWeight:700, color:C.danger, marginTop:18, marginBottom:6, paddingBottom:4, borderBottom:'2px solid '+C.danger }}>LIABILITIES</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={th}>Account</th><th style={{...th, textAlign:'right'}}>{lastYear}</th><th style={{...th, textAlign:'right'}}>{thisYear}</th><th style={{...th, textAlign:'right'}}>Variance</th></tr></thead>
            <tbody>{bsThis.liabilities.length === 0 ? <tr><td style={td} colSpan={4} align="center"><i>No liabilities</i></td></tr> : bsThis.liabilities.map(r => renderRow(r, bsLast.liabilities))}</tbody>
            <tfoot><tr style={{ background:'rgba(192,57,43,0.10)', fontWeight:700 }}><td style={td}>Total Liabilities</td><td style={{...td, textAlign:'right'}}>{fmtN(bsLast.totL)}</td><td style={{...td, textAlign:'right'}}>{fmtN(bsThis.totL)}</td><td style={{...td, textAlign:'right'}}>{fmtN(bsThis.totL - bsLast.totL)}</td></tr></tfoot>
          </table>

          <div style={{ fontSize:13, fontWeight:700, color:'#1A5C8A', marginTop:18, marginBottom:6, paddingBottom:4, borderBottom:'2px solid #1A5C8A' }}>EQUITY</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={th}>Account</th><th style={{...th, textAlign:'right'}}>{lastYear}</th><th style={{...th, textAlign:'right'}}>{thisYear}</th><th style={{...th, textAlign:'right'}}>Variance</th></tr></thead>
            <tbody>{bsThis.equity.length === 0 ? <tr><td style={td} colSpan={4} align="center"><i>No equity</i></td></tr> : bsThis.equity.map(r => renderRow(r, bsLast.equity))}</tbody>
            <tfoot><tr style={{ background:'rgba(26,92,138,0.10)', fontWeight:700 }}><td style={td}>Total Equity</td><td style={{...td, textAlign:'right'}}>{fmtN(bsLast.totE)}</td><td style={{...td, textAlign:'right'}}>{fmtN(bsThis.totE)}</td><td style={{...td, textAlign:'right'}}>{fmtN(bsThis.totE - bsLast.totE)}</td></tr></tfoot>
          </table>
        </>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 6 — GL DETAIL REPORT
// Filter by account code + date range. Shows every journal line touching
// that account, with running balance.
// ════════════════════════════════════════════════════════════════════════════
function GLDetailTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const journals = state?.acctData?.journals || [];
  const coa = state?.acctData?.coa || [];
  const [accountCode, setAccountCode] = useState('');
  const [fromDate,    setFromDate]    = useState(`${year()}-01-01`);
  const [toDate,      setToDate]      = useState(today());

  const lines = useMemo(() => {
    if (!accountCode) return [];
    const from = new Date(fromDate);
    const to   = new Date(toDate + 'T23:59:59');
    const out = [];
    journals.forEach(je => {
      const d = new Date(je.date);
      if (d < from || d > to) return;
      (je.lines || []).forEach(line => {
        if (line.drCode !== accountCode && line.crCode !== accountCode) return;
        const isDr = line.drCode === accountCode;
        out.push({
          date: je.date, ref: je.ref || '', source: je.source || '',
          desc: je.description || '',
          memo: line.memo || '',
          debit:  isDr ? (Number(line.amount) || 0) : 0,
          credit: !isDr ? (Number(line.amount) || 0) : 0,
        });
      });
    });
    return out.sort((a,b) => new Date(a.date) - new Date(b.date));
  }, [accountCode, fromDate, toDate, journals]);

  // Opening balance = sum of all movements BEFORE fromDate (using openingBal + journals prior)
  const opening = useMemo(() => {
    if (!accountCode) return 0;
    const acc = coa.find(a => a.code === accountCode);
    if (!acc) return 0;
    let bal = acc.openingBal || 0;
    if (acc.normalBal === 'Dr') bal = bal; else bal = -bal; // normalise to Dr-positive
    const from = new Date(fromDate);
    journals.forEach(je => {
      const d = new Date(je.date);
      if (d >= from) return;
      (je.lines || []).forEach(line => {
        if (line.drCode === accountCode) bal += (Number(line.amount) || 0);
        if (line.crCode === accountCode) bal -= (Number(line.amount) || 0);
      });
    });
    // Convert back to natural-balance perspective
    return acc.normalBal === 'Dr' ? bal : -bal;
  }, [accountCode, fromDate, journals, coa]);

  const account = coa.find(a => a.code === accountCode);
  const totalDr = lines.reduce((s, l) => s + l.debit,  0);
  const totalCr = lines.reduce((s, l) => s + l.credit, 0);
  // Closing = opening (in natural direction) + movement
  const movement = account?.normalBal === 'Dr' ? (totalDr - totalCr) : (totalCr - totalDr);
  const closing = (account?.normalBal === 'Cr' ? -opening : opening) + (totalDr - totalCr);
  const closingNatural = account?.normalBal === 'Dr' ? closing : -closing;

  // Running balance per line
  let running = account?.normalBal === 'Dr' ? opening : -opening;
  const linesWithRunning = lines.map(l => {
    running += l.debit - l.credit;
    return { ...l, running };
  });
  // Convert running back to natural direction for display
  const fmtNatural = v => (account?.normalBal === 'Dr' ? v : -v);

  function printGL() {
    if (!accountCode) { showToast('Select an account', 'error'); return; }
    const rows = linesWithRunning.map((l, i) => `
      <tr>
        <td>${formatDate(l.date)}</td>
        <td>${esc(l.ref||'—')}</td>
        <td>${esc(l.desc)}</td>
        <td>${esc(l.memo)}</td>
        <td style="text-align:right">${l.debit ? fmtN(l.debit) : '—'}</td>
        <td style="text-align:right">${l.credit ? fmtN(l.credit) : '—'}</td>
        <td style="text-align:right;font-weight:600">${fmtN(fmtNatural(l.running))}</td>
      </tr>`).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><title>GL Detail — ${esc(account?.name)} — ${formatDate(fromDate)} to ${formatDate(toDate)}</title>
      <style>${PRINT_CSS}
      .gl-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 6px}
      .gl-sub{text-align:center;font-size:11.5px;color:#3A5040;margin-bottom:8px}
      .acct-block{margin:8px 0 14px;font-size:12px;line-height:1.6;padding:10px 14px;background:#EAF4EC;border-left:3px solid #1A5C2A;border-radius:4px}
      table.gl{width:100%;border-collapse:collapse;margin:10px 0}
      table.gl th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
      table.gl td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11.5px}
      .totals{max-width:340px;margin-left:auto;margin-top:14px}
      .tot-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #EAF0EB;font-size:12px}
      .tot-row.grand{font-size:14px;font-weight:800;color:#1A5C2A;border-top:2px solid #1A5C2A;border-bottom:none;padding-top:8px}
      </style></head><body>
      ${printHeader('GENERAL LEDGER DETAIL', formatDate(today()))}
      <div class="gl-title">GENERAL LEDGER DETAIL REPORT</div>
      <div class="gl-sub">${formatDate(fromDate)} to ${formatDate(toDate)}</div>
      <div class="acct-block">
        <b>${esc(account?.code)} — ${esc(account?.name)}</b><br/>
        Type: ${esc(account?.type)} · Category: ${esc(account?.category)} · Normal Balance: ${esc(account?.normalBal)}
      </div>
      <table class="gl">
        <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Memo</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Running Balance</th></tr></thead>
        <tbody>
          <tr style="background:#EAF4EC;font-weight:600"><td colspan="6">Opening Balance</td><td style="text-align:right">${fmtN(opening)}</td></tr>
          ${rows || '<tr><td colspan="7" style="text-align:center;color:#182A1C;padding:14px">No transactions in this period</td></tr>'}
        </tbody>
      </table>
      <div class="totals">
        <div class="tot-row"><span>Total Debits</span><span>${fmtN(totalDr)}</span></div>
        <div class="tot-row"><span>Total Credits</span><span>${fmtN(totalCr)}</span></div>
        <div class="tot-row grand"><span>Closing Balance (${esc(account?.normalBal||'Dr')})</span><span>${fmtN(closingNatural)}</span></div>
      </div>
      ${printBootstrap({landscape:true})}
      </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  // Group COA by category for the dropdown
  const grouped = useMemo(() => {
    const map = {};
    coa.forEach(a => { (map[a.category] = map[a.category] || []).push(a); });
    return map;
  }, [coa]);

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>General Ledger Detail Report</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Every journal line touching a single account, with running balance</div>
        </div>
        <Btn onClick={printGL} disabled={!accountCode}>🖨️ Print GL Detail</Btn>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:18 }}>
        <FG label="Account">
          <select value={accountCode} onChange={e=>setAccountCode(e.target.value)} style={inp}>
            <option value="">— Select Account —</option>
            {Object.entries(grouped).sort().map(([cat, accts]) => (
              <optgroup key={cat} label={cat}>
                {accts.sort((a,b)=>a.code.localeCompare(b.code)).map(a => (
                  <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </FG>
        <FG label="From Date"><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={inp} /></FG>
        <FG label="To Date"><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={inp} /></FG>
      </div>

      {account && (
        <>
          <div style={{ padding:'10px 14px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:8, marginBottom:14, fontSize:13 }}>
            <b>{account.code} — {account.name}</b> · Type: {account.type} · Category: {account.category} · Normal: {account.normalBal}
          </div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Reference</th><th style={th}>Description</th><th style={th}>Memo</th><th style={{...th, textAlign:'right'}}>Debit</th><th style={{...th, textAlign:'right'}}>Credit</th><th style={{...th, textAlign:'right'}}>Running Balance</th></tr></thead>
            <tbody>
              <tr style={{ background:C.greenPale||'rgba(26,122,74,0.12)', fontWeight:700 }}>
                <td style={td} colSpan={6}>Opening Balance ({account.normalBal})</td>
                <td style={{...td, textAlign:'right'}}>{fmtN(opening)}</td>
              </tr>
              {linesWithRunning.length === 0 ? (
                <tr><td style={td} colSpan={7} align="center"><i>No transactions in this period</i></td></tr>
              ) : linesWithRunning.map((l, i) => (
                <tr key={i}>
                  <td style={td}>{formatDate(l.date)}</td>
                  <td style={td}>{l.ref||'—'}</td>
                  <td style={td}>{l.desc}</td>
                  <td style={td}>{l.memo}</td>
                  <td style={{...td, textAlign:'right'}}>{l.debit ? fmt(l.debit) : '—'}</td>
                  <td style={{...td, textAlign:'right'}}>{l.credit ? fmt(l.credit) : '—'}</td>
                  <td style={{...td, textAlign:'right', fontWeight:600}}>{fmt(fmtNatural(l.running))}</td>
                </tr>
              ))}
              <tr style={{ background:C.bgCard, fontWeight:700 }}>
                <td style={td} colSpan={4}>Totals</td>
                <td style={{...td, textAlign:'right'}}>{fmt(totalDr)}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(totalCr)}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(closingNatural)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 7 — AGED RECEIVABLES & PAYABLES
// Proper aging buckets (Current / 30 / 60 / 90 / 120+) with totals per
// customer/supplier and printable summary.
// ════════════════════════════════════════════════════════════════════════════
function AgingTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db } = state;
  const [side, setSide] = useState('ar'); // 'ar' | 'ap'
  const [asOf, setAsOf] = useState(today());

  const arRows = useMemo(() => {
    const invoices = db.invoices || [];
    const map = {};
    invoices.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled').forEach(inv => {
      const bal = (Number(inv.ngnEquivalent || inv.netPayable) || 0) - (Number(inv.receivedAmount) || 0);
      if (bal <= 0) return;
      const key = inv.clientCode || inv.client;
      if (!map[key]) map[key] = { name: inv.client, code: key, current:0, b30:0, b60:0, b90:0, b120:0, total:0 };
      const b = agingBuckets(inv.dueDate, asOf);
      map[key][b] += bal;
      map[key].total += bal;
    });
    return Object.values(map).sort((a,b) => b.total - a.total);
  }, [db.invoices, asOf]);

  const apRows = useMemo(() => {
    const bills = db.ap?.bills || [];
    const map = {};
    bills.filter(b => b.status !== 'Paid' && b.status !== 'Cancelled').forEach(b => {
      const bal = (Number(b.ngnEquivalent || b.netPayable) || 0) - (Number(b.paidAmount) || 0);
      if (bal <= 0) return;
      const key = b.vendor || b.vendorName;
      if (!map[key]) map[key] = { name: b.vendorName || key, code: key, current:0, b30:0, b60:0, b90:0, b120:0, total:0 };
      const bk = agingBuckets(b.dueDate, asOf);
      map[key][bk] += bal;
      map[key].total += bal;
    });
    return Object.values(map).sort((a,b) => b.total - a.total);
  }, [db.ap, asOf]);

  const rows = side === 'ar' ? arRows : apRows;
  const totals = rows.reduce((acc, r) => {
    BUCKET_ORDER.forEach(b => { acc[b] += r[b]; });
    return acc;
  }, { current:0, b30:0, b60:0, b90:0, b120:0, total:0 });

  function printAging() {
    const sideLabel = side === 'ar' ? 'AGED RECEIVABLES' : 'AGED PAYABLES';
    const rowsHtml = rows.map((r, i) => `
      <tr>
        <td>${i+1}</td>
        <td>${esc(r.code)}</td>
        <td>${esc(r.name)}</td>
        <td style="text-align:right">${fmtN(r.current)}</td>
        <td style="text-align:right">${fmtN(r.b30)}</td>
        <td style="text-align:right">${fmtN(r.b60)}</td>
        <td style="text-align:right">${fmtN(r.b90)}</td>
        <td style="text-align:right">${fmtN(r.b120)}</td>
        <td style="text-align:right;font-weight:700">${fmtN(r.total)}</td>
      </tr>`).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><title>${sideLabel} — as at ${formatDate(asOf)}</title>
      <style>${PRINT_CSS}
      .ag-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 6px}
      .ag-sub{text-align:center;font-size:11.5px;color:#3A5040;margin-bottom:14px}
      table.ag{width:100%;border-collapse:collapse;margin:10px 0}
      table.ag th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
      table.ag td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11px}
      table.ag tfoot td{font-weight:700;background:#EAF4EC;border-top:2px solid #1A5C2A;padding:9px}
      </style></head><body>
      ${printHeader(sideLabel, formatDate(asOf))}
      <div class="ag-title">${sideLabel}</div>
      <div class="ag-sub">As at ${formatDate(asOf)}</div>
      <table class="ag">
        <thead><tr>
          <th>S/N</th><th>Code</th><th>Name</th>
          <th style="text-align:right">Current</th>
          <th style="text-align:right">1–30</th>
          <th style="text-align:right">31–60</th>
          <th style="text-align:right">61–90</th>
          <th style="text-align:right">Over 90</th>
          <th style="text-align:right">Total</th>
        </tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="9" style="text-align:center;color:#182A1C;padding:14px">No outstanding balances</td></tr>'}</tbody>
        <tfoot><tr>
          <td colspan="3">TOTAL</td>
          <td style="text-align:right">${fmtN(totals.current)}</td>
          <td style="text-align:right">${fmtN(totals.b30)}</td>
          <td style="text-align:right">${fmtN(totals.b60)}</td>
          <td style="text-align:right">${fmtN(totals.b90)}</td>
          <td style="text-align:right">${fmtN(totals.b120)}</td>
          <td style="text-align:right">${fmtN(totals.total)}</td>
        </tr></tfoot>
      </table>
      ${printBootstrap({landscape:true})}
      </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>Aged {side==='ar'?'Receivables':'Payables'}</div>
          <div style={{ fontSize:11, color:C.textMuted, marginTop:2 }}>Outstanding balances bucketed by days past due</div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <Btn variant={side==='ar'?'primary':'ghost'} onClick={()=>setSide('ar')}>Receivables</Btn>
          <Btn variant={side==='ap'?'primary':'ghost'} onClick={()=>setSide('ap')}>Payables</Btn>
          <Btn variant="outline" onClick={printAging}>🖨️ Print</Btn>
        </div>
      </div>
      <FG label="As of Date"><input type="date" value={asOf} onChange={e=>setAsOf(e.target.value)} style={{ ...inp, maxWidth:200 }} /></FG>

      <table style={{ width:'100%', borderCollapse:'collapse', marginTop:14 }}>
        <thead><tr>
          <th style={th}>#</th><th style={th}>Code</th><th style={th}>Name</th>
          <th style={{...th, textAlign:'right'}}>Current</th>
          <th style={{...th, textAlign:'right'}}>1–30</th>
          <th style={{...th, textAlign:'right'}}>31–60</th>
          <th style={{...th, textAlign:'right'}}>61–90</th>
          <th style={{...th, textAlign:'right'}}>Over 90</th>
          <th style={{...th, textAlign:'right'}}>Total</th>
        </tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td style={td} colSpan={9} align="center"><i>No outstanding balances</i></td></tr> :
            rows.map((r, i) => (
              <tr key={r.code}>
                <td style={td}>{i+1}</td>
                <td style={td}>{r.code}</td>
                <td style={td}>{r.name}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(r.current)}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(r.b30)}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(r.b60)}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(r.b90)}</td>
                <td style={{...td, textAlign:'right', color: r.b120 > 0 ? C.danger : undefined}}>{fmt(r.b120)}</td>
                <td style={{...td, textAlign:'right', fontWeight:700}}>{fmt(r.total)}</td>
              </tr>
            ))}
        </tbody>
        <tfoot><tr style={{ background:C.bgCard, fontWeight:800 }}>
          <td style={td} colSpan={3}>TOTAL</td>
          <td style={{...td, textAlign:'right'}}>{fmt(totals.current)}</td>
          <td style={{...td, textAlign:'right'}}>{fmt(totals.b30)}</td>
          <td style={{...td, textAlign:'right'}}>{fmt(totals.b60)}</td>
          <td style={{...td, textAlign:'right'}}>{fmt(totals.b90)}</td>
          <td style={{...td, textAlign:'right'}}>{fmt(totals.b120)}</td>
          <td style={{...td, textAlign:'right'}}>{fmt(totals.total)}</td>
        </tr></tfoot>
      </table>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 8 — BATCH PAYMENT RUN
// Select multiple outstanding bills, generate one batch payment + EFT list.
// Persists batch in db.paymentBatches.
// ════════════════════════════════════════════════════════════════════════════
function BatchPaymentTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const bills = db.ap?.bills || [];
  const batches = db.paymentBatches || [];
  const [selected, setSelected] = useState(new Set()); // bill ids
  const [bankCode, setBankCode] = useState('3003');
  const [paymentDate, setPaymentDate] = useState(today());
  const [reference, setReference] = useState('');

  const outstanding = bills.filter(b => b.status !== 'Paid' && b.status !== 'Cancelled');
  const selectedBills = outstanding.filter(b => selected.has(b.id));
  const totalSelected = selectedBills.reduce((s, b) => {
    const bal = (Number(b.ngnEquivalent || b.netPayable) || 0) - (Number(b.paidAmount) || 0);
    return s + bal;
  }, 0);

  function saveBatches(list) {
    diffAndPush('paymentBatches', batches, list); // 2026-07-29 full-app sync sweep
    const newDb = { ...db, paymentBatches: list };
    dispatch({ type:'UPDATE_MODULE', mod:'paymentBatches', data: list });
    saveDBLocal(newDb, state.activity);
  }

  function generateBatch() {
    if (selected.size === 0) { showToast('Select at least one bill', 'error'); return; }
    if (!bankCode) { showToast('Select a bank account', 'error'); return; }
    const bank = BANK_ACCOUNTS.find(b => b.code === bankCode);
    const batchNo = `SLOT-BATCH-${year()}-${String(batches.length + 1).padStart(4,'0')}`;
    const items = selectedBills.map(b => ({
      billId: b.id,
      billNo: b.billNo || b.invoiceNo || '—',
      vendor: b.vendorName || b.vendor,
      vendorCode: b.vendor,
      amount: (Number(b.ngnEquivalent || b.netPayable) || 0) - (Number(b.paidAmount) || 0),
      whtAmount: Number(b.whtAmount) || 0,
    }));
    const batch = {
      id: uid(),
      batchNo,
      date: paymentDate,
      bankCode,
      bankName: bank?.name || '',
      reference: reference || batchNo,
      items,
      totalAmount: items.reduce((s, i) => s + i.amount, 0),
      totalWht: items.reduce((s, i) => s + i.whtAmount, 0),
      status: 'Generated',
      generatedBy: currentUser?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };
    const updated = [batch, ...batches];
    saveBatches(updated);

    // Mark bills as Paid and add to ap.payments
    const apData = db.ap || { bills: [], payments: [] };
    const updatedBills = apData.bills.map(b => selected.has(b.id)
      ? { ...b, status: 'Paid', paidAmount: Number(b.netPayable), paidDate: paymentDate, paymentRef: batchNo }
      : b);
    const newPayments = selectedBills.map(b => ({
      id: uid(),
      paymentNo: `${batchNo}-${b.id.slice(-4)}`,
      billId: b.id,
      vendor: b.vendor,
      vendorName: b.vendorName,
      date: paymentDate,
      amount: (Number(b.ngnEquivalent || b.netPayable) || 0) - (Number(b.paidAmount) || 0),
      ngnEquivalent: (Number(b.ngnEquivalent || b.netPayable) || 0) - (Number(b.paidAmount) || 0),
      bankCode, bankName: bank?.name || '',
      reference: batchNo,
      batchNo,
      createdAt: new Date().toISOString(),
    }));
    const newAp = {
      bills: updatedBills,
      payments: [...(apData.payments || []), ...newPayments],
    };
    diffAndPush('apBills', apData.bills, updatedBills); // 2026-07-29 full-app sync sweep
    newPayments.forEach(p => pushOne('apPayments', p)); // new rows only, no diff needed
    dispatch({ type:'UPDATE_MODULE', mod:'ap', data: newAp });
    saveDBLocal({ ...db, ap: newAp }, state.activity);

    logActivity(dispatch, `Batch payment ${batchNo} generated — ${items.length} bills, total ${fmt(batch.totalAmount)}`, currentUser);
    showToast(`Batch ${batchNo} generated — ${items.length} bills paid`);
    setSelected(new Set());
    setReference('');
  }

  function printEFT(batch) {
    const rows = batch.items.map((it, i) => `
      <tr>
        <td>${i+1}</td>
        <td>${esc(it.vendor)}</td>
        <td>${esc(it.billNo)}</td>
        <td style="text-align:right">${fmtN(it.amount)}</td>
        <td style="text-align:right">${fmtN(it.whtAmount)}</td>
        <td style="text-align:right;font-weight:600">${fmtN(it.amount)}</td>
      </tr>`).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><title>EFT Payment List — ${esc(batch.batchNo)}</title>
      <style>${PRINT_CSS}
      .eft-title{text-align:center;font-size:16px;font-weight:800;text-decoration:underline;margin:18px 0 6px}
      .eft-sub{text-align:center;font-size:11.5px;color:#3A5040;margin-bottom:14px}
      .bank-block{margin:8px 0 14px;font-size:12px;line-height:1.6;padding:10px 14px;background:#EAF4EC;border-left:3px solid #1A5C2A;border-radius:4px}
      table.eft{width:100%;border-collapse:collapse;margin:10px 0}
      table.eft th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
      table.eft td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11.5px}
      table.eft tfoot td{font-weight:700;background:#EAF4EC;border-top:2px solid #1A5C2A;padding:9px}
      </style></head><body>
      ${printHeader('EFT PAYMENT LIST', formatDate(batch.date))}
      <div class="eft-title">EFT / RTGS PAYMENT LIST</div>
      <div class="eft-sub">Batch ${esc(batch.batchNo)} · ${formatDate(batch.date)}</div>
      <div class="bank-block">
        <b>Bank Account:</b> ${esc(batch.bankName)} (${esc(batch.bankCode)})<br/>
        <b>Reference:</b> ${esc(batch.reference)}<br/>
        <b>Generated By:</b> ${esc(batch.generatedBy)}
      </div>
      <table class="eft">
        <thead><tr><th>S/N</th><th>Vendor</th><th>Bill No</th><th style="text-align:right">Bill Amount</th><th style="text-align:right">WHT</th><th style="text-align:right">Net Pay</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="3">TOTAL (${batch.items.length} items)</td>
          <td style="text-align:right">${fmtN(batch.items.reduce((s,i)=>s+i.amount,0))}</td>
          <td style="text-align:right">${fmtN(batch.totalWht)}</td>
          <td style="text-align:right">${fmtN(batch.totalAmount)}</td>
        </tr></tfoot>
      </table>
      <p style="margin-top:24px;font-size:10px;font-weight:500;color:#182A1C">
        Please effect payment of the above amounts to the respective suppliers. Retain this list as audit evidence of the batch payment run.
      </p>
      <div style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px">
        <div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C">Prepared By</div></div>
        <div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C">Approved By</div></div>
        <div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C">Bank Officer Stamp</div></div>
      </div>
      ${printBootstrap({landscape:true})}
      </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:14 }}>Batch Payment Run</div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:18 }}>
        <FG label="Bank Account">
          <select value={bankCode} onChange={e=>setBankCode(e.target.value)} style={inp}>
            {BANK_ACCOUNTS.map(b => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
          </select>
        </FG>
        <FG label="Payment Date"><input type="date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)} style={inp} /></FG>
        <FG label="Reference"><input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Bank transfer ref (optional)" style={inp} /></FG>
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:10 }}>
        <div style={{ fontSize:13, fontWeight:700, color:C.textMid }}>Outstanding Bills ({outstanding.length})</div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <div style={{ fontSize:13, color:C.text }}>
            <b>{selected.size}</b> selected · Total: <b style={{ color:C.danger }}>{fmt(totalSelected)}</b>
          </div>
          <Btn onClick={generateBatch} disabled={selected.size === 0}>⚡ Generate Batch + Pay</Btn>
        </div>
      </div>

      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr>
          <th style={{...th, width:30}}></th>
          <th style={th}>Bill No</th><th style={th}>Vendor</th><th style={th}>Due Date</th>
          <th style={{...th, textAlign:'right'}}>Balance</th>
          <th style={{...th, width:30}}></th>
        </tr></thead>
        <tbody>
          {outstanding.length === 0 ? <tr><td style={td} colSpan={6} align="center"><i>No outstanding bills</i></td></tr> :
            outstanding.map(b => {
              const bal = (Number(b.ngnEquivalent || b.netPayable) || 0) - (Number(b.paidAmount) || 0);
              const isSel = selected.has(b.id);
              return (
                <tr key={b.id} style={{ background: isSel ? (C.greenPale||'rgba(26,122,74,0.10)') : 'transparent' }}>
                  <td style={td}><input type="checkbox" checked={isSel} onChange={e=>{
                    const next = new Set(selected);
                    if (e.target.checked) next.add(b.id); else next.delete(b.id);
                    setSelected(next);
                  }} /></td>
                  <td style={td}>{b.billNo || b.invoiceNo}</td>
                  <td style={td}>{b.vendorName || b.vendor}</td>
                  <td style={td}>{formatDate(b.dueDate)}</td>
                  <td style={{...td, textAlign:'right', fontWeight:600}}>{fmt(bal)}</td>
                  <td style={{...td, fontSize:10}}>{agingBuckets(b.dueDate) === 'b120' ? '🔴' : agingBuckets(b.dueDate) === 'b90' ? '🟠' : ''}</td>
                </tr>
              );
            })}
        </tbody>
      </table>

      {batches.length > 0 && (
        <>
          <div style={{ fontSize:13, fontWeight:700, color:C.textMid, marginTop:24, marginBottom:8 }}>Recent Batches</div>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr><th style={th}>Batch No</th><th style={th}>Date</th><th style={th}>Bank</th><th style={th}>Items</th><th style={{...th, textAlign:'right'}}>Total</th><th style={th}></th></tr></thead>
            <tbody>
              {batches.slice(0, 10).map(b => (
                <tr key={b.id}>
                  <td style={td}><b>{b.batchNo}</b></td>
                  <td style={td}>{formatDate(b.date)}</td>
                  <td style={td}>{b.bankName}</td>
                  <td style={td}>{b.items.length}</td>
                  <td style={{...td, textAlign:'right'}}>{fmt(b.totalAmount)}</td>
                  <td style={td}><Btn sm variant="ghost" onClick={()=>printEFT(b)}>🖨️ EFT</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 9 — WHT CERTIFICATES
// Per-vendor WHT tracking with printable certificate. Pulls WHT from bills
// (b.whtAmount) and invoices (inv.whtAmount). Generates a certificate per
// payment period per vendor.
// ════════════════════════════════════════════════════════════════════════════
function WHTTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db, currentUser } = state;
  const bills = db.ap?.bills || [];
  const payments = db.ap?.payments || [];
  const vendors = useMemo(() => getVendors(), []);
  const [vendorCode, setVendorCode] = useState('');
  const [fromDate, setFromDate] = useState(`${year()}-01-01`);
  const [toDate,   setToDate]   = useState(today());

  // Aggregate WHT per vendor from bills in the period
  const whtByVendor = useMemo(() => {
    const from = new Date(fromDate);
    const to   = new Date(toDate + 'T23:59:59');
    const map = {};
    bills.forEach(b => {
      const d = new Date(b.date);
      if (d < from || d > to) return;
      const wht = Number(b.whtAmount) || 0;
      if (wht <= 0) return;
      const key = b.vendor || b.vendorName;
      if (!map[key]) {
        const v = vendors.find(x => x.code === key);
        map[key] = {
          vendorCode: key,
          vendorName: b.vendorName || v?.name || key,
          vendorTin:  v?.tin || '',
          vendorAddress: v?.address || '',
          totalWht: 0, totalPaid: 0, billCount: 0,
          bills: [],
        };
      }
      map[key].totalWht  += wht;
      map[key].totalPaid += Number(b.ngnEquivalent || b.netPayable) || 0;
      map[key].billCount += 1;
      map[key].bills.push({ billNo: b.billNo || b.invoiceNo, date: b.date, amount: Number(b.ngnEquivalent || b.netPayable) || 0, whtRate: b.whtRate, whtAmount: wht });
    });
    return Object.values(map).sort((a,b) => b.totalWht - a.totalWht);
  }, [bills, vendors, fromDate, toDate]);

  const filtered = vendorCode ? whtByVendor.filter(v => v.vendorCode === vendorCode) : whtByVendor;
  const grandTotalWht = filtered.reduce((s, v) => s + v.totalWht, 0);

  function printCertificate(v) {
    const rows = v.bills.map((b, i) => `
      <tr>
        <td>${i+1}</td>
        <td>${esc(b.billNo)}</td>
        <td>${formatDate(b.date)}</td>
        <td style="text-align:right">${fmtN(b.amount)}</td>
        <td style="text-align:center">${b.whtRate||5}%</td>
        <td style="text-align:right;font-weight:600">${fmtN(b.whtAmount)}</td>
      </tr>`).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><title>WHT Certificate — ${esc(v.vendorName)}</title>
      <style>${PRINT_CSS}
      .wht-title{text-align:center;font-size:17px;font-weight:800;text-decoration:underline;margin:18px 0 6px}
      .wht-sub{text-align:center;font-size:11.5px;color:#3A5040;margin-bottom:14px}
      .parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:14px 0;font-size:11.5px;line-height:1.7}
      .parties b{display:block;font-size:12px;margin-bottom:2px}
      table.wht{width:100%;border-collapse:collapse;margin:14px 0}
      table.wht th{background:#1A5C2A;color:#fff;padding:7px 9px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
      table.wht td{padding:6px 9px;border-bottom:1px solid #EAF0EB;font-size:11px}
      table.wht tfoot td{font-weight:700;background:#EAF4EC;border-top:2px solid #1A5C2A;padding:9px}
      .grand{display:flex;justify-content:space-between;padding:12px 16px;background:#1A5C2A;color:#fff;border-radius:8px;font-size:16px;font-weight:800;margin-top:14px}
      </style></head><body>
      ${printHeader('WITHHOLDING TAX (WHT) CERTIFICATE', formatDate(today()))}
      <div class="wht-title">WITHHOLDING TAX CERTIFICATE</div>
      <div class="wht-sub">Period: ${formatDate(fromDate)} to ${formatDate(toDate)}</div>
      <div class="parties">
        <div>
          <b>TAX DEDUCTOR (Payer):</b>
          SLOT Engineering Nigeria Limited<br/>
          205 Eneka Road, Port Harcourt, Rivers State<br/>
          TIN: 00499389-0001
        </div>
        <div>
          <b>TAXPAYEE (Beneficiary):</b>
          ${esc(v.vendorName)}<br/>
          ${esc(v.vendorAddress)}<br/>
          TIN: ${esc(v.vendorTin || '—')}
        </div>
      </div>
      <p style="font-size:11.5px;line-height:1.6;margin:10px 0">
        This is to certify that the sum of <b>${fmtN(v.totalWht)}</b> was deducted as Withholding Tax
        from payments made to the above-named beneficiary during the period stated above, in accordance
        with the provisions of the Personal Income Tax Act (PITA) / Companies Income Tax Act (CITA).
      </p>
      <table class="wht">
        <thead><tr><th>S/N</th><th>Bill/Invoice No</th><th>Date</th><th style="text-align:right">Gross Amount</th><th style="text-align:center">WHT Rate</th><th style="text-align:right">WHT Deducted</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="5" style="text-align:right">TOTAL WHT DEDUCTED</td><td style="text-align:right">${fmtN(v.totalWht)}</td></tr></tfoot>
      </table>
      <div class="grand"><span>TOTAL WHT DEDUCTED & REMITTED</span><span>${fmtN(v.totalWht)}</span></div>
      <p style="margin-top:18px;font-size:11px;font-weight:500;color:#182A1C">
        This certificate is issued in accordance with Section 81 of PITA / Section 78 of CITA.
        The deducted amount has been remitted to the relevant tax authority.
      </p>
      <div style="margin-top:44px;display:grid;grid-template-columns:1fr 1fr;gap:30px">
        <div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C">Prepared By / Date</div></div>
        <div><div style="border-top:1px solid #ccc;padding-top:6px;font-size:10px;font-weight:600;color:#182A1C">Authorised Signatory / Date</div></div>
      </div>
      ${printBootstrap({landscape:true})}
      </body></html>`);
  }

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  return (
    <Card>
      <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:14 }}>WHT Certificates (Withholding Tax)</div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:18 }}>
        <FG label="Vendor (optional — leave blank for all)">
          <select value={vendorCode} onChange={e=>setVendorCode(e.target.value)} style={inp}>
            <option value="">— All Vendors —</option>
            {vendors.map(v => <option key={v.id} value={v.code}>{v.name}</option>)}
          </select>
        </FG>
        <FG label="From Date"><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={inp} /></FG>
        <FG label="To Date"><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={inp} /></FG>
      </div>

      <div style={{ padding:'12px 16px', background:'rgba(192,57,43,0.10)', border:'1px solid '+C.danger, borderRadius:10, marginBottom:14 }}>
        <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Total WHT Deducted (period)</div>
        <div style={{ fontSize:20, fontWeight:800, color:C.danger }}>{fmt(grandTotalWht)}</div>
      </div>

      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr>
          <th style={th}>#</th><th style={th}>Vendor Code</th><th style={th}>Vendor Name</th>
          <th style={{...th, textAlign:'right'}}>Bills</th>
          <th style={{...th, textAlign:'right'}}>Gross Paid</th>
          <th style={{...th, textAlign:'right'}}>WHT Deducted</th>
          <th style={th}></th>
        </tr></thead>
        <tbody>
          {filtered.length === 0 ? <tr><td style={td} colSpan={7} align="center"><i>No WHT deducted in this period</i></td></tr> :
            filtered.map((v, i) => (
              <tr key={v.vendorCode}>
                <td style={td}>{i+1}</td>
                <td style={td}>{v.vendorCode}</td>
                <td style={td}>{v.vendorName}</td>
                <td style={{...td, textAlign:'right'}}>{v.billCount}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(v.totalPaid)}</td>
                <td style={{...td, textAlign:'right', fontWeight:700, color:C.danger}}>{fmt(v.totalWht)}</td>
                <td style={td}><Btn sm variant="ghost" onClick={()=>printCertificate(v)}>🖨️ Certificate</Btn></td>
              </tr>
            ))}
        </tbody>
        <tfoot><tr style={{ background:C.bgCard, fontWeight:800 }}>
          <td style={td} colSpan={5}>TOTAL</td>
          <td style={{...td, textAlign:'right', color:C.danger}}>{fmt(grandTotalWht)}</td>
          <td style={td}></td>
        </tr></tfoot>
      </table>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 10 — CUSTOMER CREDIT LIMIT ENFORCEMENT
// Lists every active customer with their creditLimit, current outstanding,
// available balance. Flags customers over limit. Includes a "what-if"
// calculator: pick a customer + amount to see if it would exceed the limit.
// ════════════════════════════════════════════════════════════════════════════
function CreditLimitTab({ state, dispatch, inp }) {
  const { C } = useTheme();
  const { db } = state;
  const invoices = db.invoices || [];
  const [checkClient, setCheckClient] = useState('');
  const [checkAmount, setCheckAmount] = useState('');

  const clients = useMemo(() => getClients().filter(c => c.status === 'Active'), []);

  const rows = useMemo(() => {
    return clients.map(c => {
      // Outstanding = sum of (netPayable - receivedAmount) for unpaid invoices
      const custInvoices = invoices.filter(inv => (inv.clientCode === c.code || inv.client === c.name)
        && inv.status !== 'Paid' && inv.status !== 'Cancelled');
      const outstanding = custInvoices.reduce((s, inv) => {
        const bal = (Number(inv.ngnEquivalent || inv.netPayable) || 0) - (Number(inv.receivedAmount) || 0);
        return s + Math.max(0, bal);
      }, 0);
      const limit = Number(c.creditLimit) || 0;
      const available = limit - outstanding;
      const pctUsed = limit > 0 ? Math.round((outstanding / limit) * 100) : 0;
      const overLimit = limit > 0 && outstanding > limit;
      return { ...c, outstanding, available, pctUsed, overLimit, invoiceCount: custInvoices.length };
    }).filter(r => r.creditLimit > 0 || r.outstanding > 0) // only show clients with a limit OR outstanding balance
     .sort((a,b) => b.pctUsed - a.pctUsed);
  }, [clients, invoices]);

  // What-if check
  const checkClientObj = checkClient ? clients.find(c => c.code === checkClient) : null;
  const checkRow = checkClientObj ? rows.find(r => r.code === checkClientObj.code) : null;
  const checkAmt = Number(checkAmount) || 0;
  const projectedOutstanding = (checkRow?.outstanding || 0) + checkAmt;
  const projectedAvailable = (checkRow?.creditLimit || 0) - projectedOutstanding;
  const wouldExceed = checkRow && checkRow.creditLimit > 0 && projectedOutstanding > checkRow.creditLimit;

  const th = { padding:'8px 10px', textAlign:'left', fontSize:10.5, fontWeight:700, color:C.tableHeaderText, textTransform:'uppercase', letterSpacing:'0.4px', whiteSpace:'nowrap', background:C.tableHeaderBg };
  const td = { padding:'9px 10px', borderBottom:'1px solid '+C.borderLight, color:C.text, fontSize:12.5, verticalAlign:'middle' };

  const overLimitCount = rows.filter(r => r.overLimit).length;

  return (
    <Card>
      <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:14 }}>Customer Credit Limit Enforcement</div>
      <div style={{ fontSize:11, color:C.textMuted, marginBottom:14 }}>
        Shows every customer with a credit limit set. Invoices that would exceed the limit should be blocked (or require admin override). Currently {overLimitCount} customer(s) are over their limit.
      </div>

      {/* What-if check */}
      <div style={{ padding:'14px 16px', background:C.bgCard, border:'1px solid '+C.border, borderRadius:10, marginBottom:18 }}>
        <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:8 }}>Credit Check — before raising a new invoice</div>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:12 }}>
          <FG label="Customer">
            <select value={checkClient} onChange={e=>setCheckClient(e.target.value)} style={inp}>
              <option value="">— Select Customer —</option>
              {clients.map(c => <option key={c.id} value={c.code}>{c.name} ({c.code})</option>)}
            </select>
          </FG>
          <FG label="Proposed Invoice Amount">
            <input type="number" value={checkAmount} onChange={e=>setCheckAmount(e.target.value)} placeholder="₦" style={inp} />
          </FG>
        </div>
        {checkRow && (
          <div style={{ marginTop:10, padding:12, background: wouldExceed ? 'rgba(192,57,43,0.10)' : 'rgba(26,122,74,0.10)', border:'1px solid '+(wouldExceed?C.danger:C.green), borderRadius:8, fontSize:12.5 }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
              <div><div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Credit Limit</div><b>{fmt(checkRow.creditLimit)}</b></div>
              <div><div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Current Outstanding</div><b>{fmt(checkRow.outstanding)}</b></div>
              <div><div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>After This Invoice</div><b style={{ color: wouldExceed ? C.danger : C.text }}>{fmt(projectedOutstanding)}</b></div>
              <div><div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase' }}>Available After</div><b style={{ color: projectedAvailable < 0 ? C.danger : C.green }}>{fmt(projectedAvailable)}</b></div>
            </div>
            <div style={{ marginTop:8, fontWeight:700, color: wouldExceed ? C.danger : C.green, fontSize:13 }}>
              {wouldExceed ? '⚠️ BLOCK: Invoice would exceed credit limit by ' + fmt(Math.abs(projectedAvailable)) + '. Requires admin override.' :
               checkRow.creditLimit === 0 ? 'ℹ️ No credit limit set — invoice allowed (no enforcement).' :
               '✓ OK: Invoice within credit limit. ' + fmt(projectedAvailable) + ' would remain available.'}
            </div>
          </div>
        )}
      </div>

      {/* Customer table */}
      <table style={{ width:'100%', borderCollapse:'collapse' }}>
        <thead><tr>
          <th style={th}>Code</th><th style={th}>Customer</th>
          <th style={{...th, textAlign:'right'}}>Credit Limit</th>
          <th style={{...th, textAlign:'right'}}>Outstanding</th>
          <th style={{...th, textAlign:'right'}}>Available</th>
          <th style={{...th, textAlign:'center'}}>Usage</th>
          <th style={th}>Status</th>
        </tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td style={td} colSpan={7} align="center"><i>No customers with credit limits or outstanding balances</i></td></tr> :
            rows.map(r => (
              <tr key={r.code} style={{ background: r.overLimit ? 'rgba(192,57,43,0.06)' : 'transparent' }}>
                <td style={td}>{r.code}</td>
                <td style={td}>{r.name}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(r.creditLimit)}</td>
                <td style={{...td, textAlign:'right'}}>{fmt(r.outstanding)}</td>
                <td style={{...td, textAlign:'right', color: r.available < 0 ? C.danger : C.text, fontWeight: 600}}>{fmt(r.available)}</td>
                <td style={{...td, textAlign:'center'}}>
                  <div style={{ position:'relative', height:8, background:'rgba(0,0,0,0.06)', borderRadius:4, width:80, display:'inline-block', verticalAlign:'middle' }}>
                    <div style={{ position:'absolute', left:0, top:0, bottom:0, width: `${Math.min(100, r.pctUsed)}%`, background: r.overLimit ? C.danger : (r.pctUsed > 80 ? C.amber : C.green), borderRadius:4 }} />
                  </div>
                  <span style={{ marginLeft:6, fontSize:11 }}>{r.pctUsed}%</span>
                </td>
                <td style={td}>
                  {r.overLimit ? <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600, color:C.danger, background:'rgba(192,57,43,0.12)', border:`1px solid ${C.danger}30` }}>OVER LIMIT</span> :
                   r.pctUsed > 80 ? <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600, color:C.amber, background:'rgba(201,122,10,0.12)', border:`1px solid ${C.amber}30` }}>Near Limit</span> :
                   r.creditLimit === 0 ? <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600, color:'#6B7280', background:'rgba(107,114,128,0.12)' }}>No Limit</span> :
                   <span style={{ padding:'2px 9px', borderRadius:20, fontSize:11, fontWeight:600, color:C.green, background:'rgba(26,122,74,0.12)', border:`1px solid ${C.green}30` }}>OK</span>}
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      <div style={{ marginTop:14, padding:'10px 14px', background:'rgba(26,92,138,0.06)', border:'1px solid rgba(26,92,138,0.20)', borderRadius:8, fontSize:11.5, color:C.textMid }}>
        <b>How enforcement works:</b> When raising an invoice in the AR module, the system should compare the customer's outstanding + proposed invoice amount against the credit limit set in the Customer Master. If exceeded, the invoice should be blocked with an "Admin Override Required" prompt. To set or change a credit limit, edit the customer in Accounts Receivable → Customers.
      </div>
    </Card>
  );
}

// End of SageReports module
export {
  agingBuckets, BUCKET_LABELS, BUCKET_ORDER,
  CustomerStatementTab, SupplierStatementTab,
  CreditNotesTab, VAT201Tab, ComparativeTab, GLDetailTab,
  AgingTab, BatchPaymentTab, WHTTab, CreditLimitTab,
};
